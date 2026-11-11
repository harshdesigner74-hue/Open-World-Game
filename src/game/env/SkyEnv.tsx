import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { weather } from './weather'

/**
 * Image-based lighting: the live sky is rendered into a pre-filtered environment map
 * (PMREM) a few times per minute, so glass, car paint, wet roads and water reflect the
 * actual time of day and weather.
 */
export function SkyReflections() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const env = useMemo(() => {
    // bounded-radiance gradient sky (three's physical Sky is far too hot to light with)
    const s = new THREE.Scene()
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
      },
      depthWrite: false,
      // pinned to the far plane so everything (incl. stars and clouds) draws in front of it
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = vec4(p.xy, p.w * 0.99995, p.w); }`,
      fragmentShader: `uniform vec3 uZenith, uHorizon, uGround, uSunCol; uniform vec3 uSun; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir);
          vec3 sky = mix(uHorizon, uZenith, pow(max(d.y, 0.0), 0.55));
          vec3 col = d.y >= 0.0 ? sky : mix(uHorizon * 0.6, uGround, min(1.0, -d.y * 4.0));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += uSunCol * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(col, 1.0); }`,
    })
    const geo = new THREE.SphereGeometry(500, 48, 24)
    s.add(new THREE.Mesh(geo, mat))
    // the same sky, drawn in the main scene around the camera
    const visible = new THREE.Mesh(geo, mat)
    visible.frustumCulled = false
    visible.renderOrder = -2
    return { s, mat, visible }
  }, [])
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl])
  const st = useRef({ t: 0, rt: null as THREE.WebGLRenderTarget | null, sun: new THREE.Vector3(9, 9, 9), cloud: -1 })
  useEffect(
    () => () => {
      st.current.rt?.dispose()
      pmrem.dispose()
      scene.environment = null
    },
    [pmrem, scene],
  )
  useEffect(() => {
    scene.add(env.visible)
    return () => {
      scene.remove(env.visible)
    }
  }, [scene, env])
  const camera = useThree((s) => s.camera)
  useFrame((_, dt) => {
    const T = runtime.time
    const night = 1 - T.daylight
    scene.environmentIntensity = runtime.interior ? 0.3 : 1.0 + (1 - T.daylight) * 3.5
    env.visible.position.copy(camera.position)
    env.visible.visible = !runtime.interior
    // sky colours update every frame (the visible dome); the reflection probe re-bakes only on change
    const u = env.mat.uniforms
    const golden = Math.max(0, Math.min(1, 1 - T.sunDir.y * 3)) * T.daylight
    const gloom = Math.max(weather.cloud * 0.8, weather.fog * 0.7)
    const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b)
    const zen = C(0.11, 0.29, 0.7).lerp(C(0.32, 0.36, 0.55), golden).lerp(C(0.45, 0.48, 0.52), gloom).lerp(C(0.028, 0.032, 0.048), night)
    const hor = C(0.64, 0.75, 0.88).lerp(C(1.0, 0.62, 0.36), golden).lerp(C(0.6, 0.63, 0.66), gloom).lerp(C(0.06, 0.062, 0.075), night)
    ;(u.uZenith.value as THREE.Color).copy(zen)
    ;(u.uHorizon.value as THREE.Color).copy(hor)
    ;(u.uGround.value as THREE.Color).setRGB(0.24 - night * 0.2, 0.22 - night * 0.18, 0.19 - night * 0.16)
    u.uSun.value.copy(T.sunDir)
    ;(u.uSunCol.value as THREE.Color).setRGB(1, 0.9 - golden * 0.3, 0.75 - golden * 0.4).multiplyScalar((1 - night) * (1 - gloom * 0.85))
    st.current.t -= dt
    if (st.current.t > 0) return
    st.current.t = 1
    if (st.current.sun.distanceTo(T.sunDir) < 0.03 && Math.abs(st.current.cloud - weather.cloud) < 0.05 && st.current.rt) return
    st.current.sun.copy(T.sunDir)
    st.current.cloud = weather.cloud
    const rt = pmrem.fromScene(env.s, 0.02, 0.5, 2000)
    st.current.rt?.dispose()
    st.current.rt = rt
    scene.environment = rt.texture
  })
  return null
}

/** Procedural cloud layer on a dome around the camera (fbm noise, sun-lit, weather-driven). */
export function Clouds() {
  const camera = useThree((s) => s.camera)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uCover: { value: 0.35 },
          uSun: { value: new THREE.Vector3(0, 1, 0) },
          uSunCol: { value: new THREE.Color('#fff4e0') },
          uNight: { value: 0 },
          uDark: { value: 0 },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uTime, uCover, uNight, uDark; uniform vec3 uSun, uSunCol; varying vec3 vDir;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
          void main(){
            vec3 d = normalize(vDir);
            if (d.y < 0.01) discard;
            vec2 uv = d.xz / (d.y + 0.18) * 5.5 + vec2(uTime * 0.012, uTime * 0.004);
            float f = fbm(uv);
            float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, f) * smoothstep(0.04, 0.3, d.y);
            if (dens < 0.01) discard;
            float shade = fbm(uv + uSun.xz * 0.06) ;
            float lit = clamp(0.55 + (f - shade) * 2.2, 0.25, 1.0);
            float toward = pow(max(dot(d, normalize(uSun)), 0.0), 8.0);
            vec3 day = mix(vec3(0.62,0.66,0.72), uSunCol, lit) + uSunCol * toward * 0.6 * (1.0 - dens);
            vec3 col = mix(day, vec3(0.42,0.45,0.5), uDark);
            col = mix(col, vec3(0.13,0.14,0.18) + vec3(0.06) * lit, uNight);
            float a = dens * (0.9 - uNight * 0.45);
            gl_FragColor = vec4(col, a);
          }`,
      }),
    [],
  )
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    const T = runtime.time
    mat.uniforms.uTime.value += dt
    mat.uniforms.uCover.value = 0.4 + weather.cloud * 0.52
    mat.uniforms.uSun.value.copy(T.sunDir)
    const golden = Math.max(0, 1 - T.sunDir.y * 3)
    ;(mat.uniforms.uSunCol.value as THREE.Color).setRGB(1, 0.95 - golden * 0.3, 0.88 - golden * 0.45)
    mat.uniforms.uNight.value = 1 - T.daylight
    mat.uniforms.uDark.value = Math.max(weather.rain, weather.cloud * 0.5)
    if (ref.current) {
      ref.current.position.copy(camera.position)
      ref.current.visible = !runtime.interior
    }
  })
  return (
    <mesh ref={ref} material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[6500, 32, 16]} />
    </mesh>
  )
}
