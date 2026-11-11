import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { weather } from './weather'
import { runtime } from '../state/runtime'

/** GPU rain: thousands of streaks wrapped around the camera, animated entirely in the shader. */
export function Rain({ count = 6000 }: { count?: number }) {
  const camera = useThree((s) => s.camera)
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 2 * 3)
    const end = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 70, y = Math.random() * 40, z = Math.random() * 70
      pos.set([x, y, z, x, y, z], i * 6)
      end[i * 2] = 0
      end[i * 2 + 1] = 1
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: 0.3 }, uOpacity: { value: 0 }, uLen: { value: 0.9 } },
      vertexShader: `
        attribute float aEnd;
        uniform float uTime; uniform vec3 uCam; uniform float uWind; uniform float uLen;
        varying float vEnd;
        void main() {
          vec3 p = position;
          float speed = 22.0 + fract(p.x * 13.1) * 6.0;
          p.y = mod(p.y - uTime * speed, 40.0);
          p.x = mod(p.x + uWind * uTime * 6.0 - uCam.x, 70.0) - 35.0 + uCam.x;
          p.z = mod(p.z - uCam.z, 70.0) - 35.0 + uCam.z;
          p.y += uCam.y - 14.0;
          p += aEnd * vec3(uWind * 0.35, -uLen, 0.0);
          vEnd = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity; varying float vEnd;
        void main() { gl_FragColor = vec4(0.75, 0.8, 0.88, uOpacity * (0.35 + 0.65 * vEnd)); }`,
    })
    return { geo: g, mat: m }
  }, [count])
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt
    mat.uniforms.uCam.value.copy(camera.position)
    mat.uniforms.uWind.value = weather.wind
    mat.uniforms.uOpacity.value = runtime.interior ? 0 : Math.min(0.55, weather.rain * 0.6)
    geo.setDrawRange(0, Math.floor(count * 2 * Math.min(1, weather.rain * 1.2)))
  })
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
}
