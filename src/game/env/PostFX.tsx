import { useFrame, useThree } from '@react-three/fiber'
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  KernelSize,
  RenderPass,
  SMAAEffect,
  ShaderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { weather } from './weather'

/** Linear-space exposure (applied before tone mapping). */
class ExposureEffect extends Effect {
  constructor() {
    super('Exposure', `uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }`, {
      uniforms: new Map([['exposure', new THREE.Uniform(1)]]),
    })
  }
}

/** Cinematic grade: saturation, contrast and warm-highlight / cool-shadow split toning. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'Grade',
      `uniform float saturation; uniform float contrast; uniform float warmth;
       void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
         vec3 c = inputColor.rgb;
         float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
         c = mix(vec3(l), c, saturation);
         c = (c - 0.45) * contrast + 0.45;
         vec3 shadowTint = vec3(0.94, 1.0, 1.07);
         vec3 hiTint = vec3(1.0 + 0.07 * warmth, 1.0 + 0.01 * warmth, 1.0 - 0.07 * warmth);
         c *= mix(shadowTint, hiTint, smoothstep(0.05, 0.85, l));
         // smooth highlight shoulder: channels never hard-clip at 1.0 (hard clipping of the bright
         // sky showed up as a crisp pale ellipse where the brightest channel crossed 1.0)
         c = max(c, 0.0);
         vec3 over = max(c - 0.78, 0.0);
         c = min(c, 0.78) + 0.22 * (1.0 - exp(-over / 0.22));
         outputColor = vec4(c, inputColor.a);
       }`,
      {
        blendFunction: BlendFunction.NORMAL,
        uniforms: new Map([
          ['saturation', new THREE.Uniform(1.12)],
          ['contrast', new THREE.Uniform(1.08)],
          ['warmth', new THREE.Uniform(1)],
        ]),
      },
    )
  }
}

/** Replaces NaN/Inf and clamps extreme HDR so bloom can never smear a bad pixel. */
function sanitizeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { inputBuffer: { value: null } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `uniform sampler2D inputBuffer; varying vec2 vUv;
      void main(){ vec4 c = texture2D(inputBuffer, vUv);
        // overflowed specular (inf) becomes the max, only true NaNs are dropped
        vec3 r = vec3(isnan(c.r) ? 0.0 : c.r, isnan(c.g) ? 0.0 : c.g, isnan(c.b) ? 0.0 : c.b);
        gl_FragColor = vec4(min(max(r, vec3(0.0)), vec3(8.0)), 1.0); }`,
    depthWrite: false,
    depthTest: false,
  })
}

/**
 * The "open-world blockbuster" look: bloom on lights, ACES tone mapping, saturated/contrasty
 * grade with warm highlights, cool shadows and a soft highlight shoulder, then SMAA (high) / FXAA (medium).
 * (The vignette is a CSS overlay in GameUI — a shader vignette here produced a visible edge.)
 * Runs its own composer (priority-1 frame loop replaces R3F's default render).
 */
export function PostFX() {
  const quality = useGame((s) => s.settings.quality)
  const enabled = useGame((s) => s.settings.postfx) && quality !== 'low'
  return enabled ? <Composer high={quality === 'high'} /> : null
}

function Composer({ high }: { high: boolean }) {
  const { gl, scene, camera, size } = useThree()
  const fx = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType })
    composer.addPass(new RenderPass(scene, camera))
    // clamp HDR spikes (the analytic sky sun reaches 1000s) so bloom stays a glow, not a disc
    composer.addPass(new ShaderPass(sanitizeMaterial(), "inputBuffer"))
    const bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: false,
      kernelSize: high ? KernelSize.LARGE : KernelSize.SMALL,
      resolutionScale: high ? 0.5 : 0.35,
      intensity: 0.5,
      luminanceThreshold: 1.6,
      luminanceSmoothing: 0.2,
    })
    const exposure = new ExposureEffect()
    const grade = new GradeEffect()
    composer.addPass(new EffectPass(camera, bloom, exposure, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), grade, high ? new SMAAEffect() : new FXAAEffect()))
    return { composer, bloom, exposure, grade }
  }, [gl, scene, camera, high])
  useEffect(() => {
    const prev = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__iowFX = fx
    return () => {
      gl.toneMapping = prev
      fx.composer.dispose()
    }
  }, [gl, fx])
  useEffect(() => {
    fx.composer.setSize(size.width, size.height)
  }, [fx, size])
  useFrame((_, dt) => {
    const night = 1 - runtime.time.daylight
    ;(fx.exposure.uniforms.get('exposure') as THREE.Uniform).value = gl.toneMappingExposure * 1.05
    ;(fx.grade.uniforms.get('saturation') as THREE.Uniform).value = 1.14 - weather.cloud * 0.18 - weather.fog * 0.15
    ;(fx.grade.uniforms.get('contrast') as THREE.Uniform).value = 1.1 - weather.fog * 0.12
    ;(fx.grade.uniforms.get('warmth') as THREE.Uniform).value = (1 - night * 0.8) * (1 - weather.cloud * 0.6)
    fx.bloom.intensity = 0.18 + night * 0.85 + weather.rain * 0.15
    fx.composer.render(dt)
  }, 1)
  return null
}
