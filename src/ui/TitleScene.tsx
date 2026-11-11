import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { animateRig, buildCharacter, type Rig } from '../game/player/characterModel'
import { buildFaceTexture } from '../game/player/faceTexture'
import { useGame } from '../game/state/store'
import { materials } from '../game/world/materials'
import { vehicleTemplate } from '../game/world/models'

/**
 * Title-screen key art, rendered live: the player's own hero (built from their reference
 * sheet, same rig as in-game) standing on a Delhi street at golden hour, a car parked behind,
 * India Gate and a hazy skyline against the setting sun. The camera drifts slowly, like the
 * idle shot of an open-world game's main menu.
 */

const SUN = new THREE.Vector3(0.02, 0.07, -1).normalize()

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uSun: { value: SUN } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uSun; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -0.2, 1.0);
            vec3 zen = vec3(0.10, 0.11, 0.26);
            vec3 mid = vec3(0.62, 0.30, 0.36);
            vec3 hor = vec3(1.25, 0.62, 0.28);
            vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
            col = mix(col, zen, smoothstep(0.16, 0.65, h));
            float s = max(dot(d, uSun), 0.0);
            col += vec3(1.6, 0.9, 0.45) * pow(s, 18.0) * 0.9;
            col += vec3(1.0, 0.55, 0.25) * pow(s, 4.0) * 0.35;
            col += vec3(1.9, 0.95, 0.38) * smoothstep(0.99955, 0.99985, s);
            // soft cloud bands
            float band = sin(d.x * 9.0 + d.y * 40.0) * 0.5 + 0.5;
            float clouds = smoothstep(0.55, 0.95, band) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.12, 0.3, h));
            col = mix(col, vec3(0.95, 0.45, 0.38) * (0.7 + pow(s, 3.0)), clouds * 0.35);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  )
  return (
    <mesh material={mat}>
      <sphereGeometry args={[900, 48, 24]} />
    </mesh>
  )
}

/** Night-falling skyline: towers with lit windows, India Gate, a domed monument, palms. */
function Skyline() {
  const geo = useMemo(() => {
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2030', roughness: 0.9 })
    const stone = new THREE.MeshStandardMaterial({ color: '#b98a66', roughness: 0.85 })
    const group = new THREE.Group()
    const rnd = (() => {
      let s = 7
      return () => ((s = (s * 16807) % 2147483647) / 2147483647)
    })()
    // window texture for towers
    const cv = document.createElement('canvas')
    cv.width = 64
    cv.height = 128
    const g = cv.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, 64, 128)
    for (let y = 4; y < 128; y += 8)
      for (let x = 4; x < 64; x += 8)
        if (rnd() < 0.38) {
          g.fillStyle = rnd() < 0.7 ? '#ffc875' : '#bcd6ff'
          g.fillRect(x, y, 4, 4)
        }
    const win = new THREE.CanvasTexture(cv)
    win.wrapS = win.wrapT = THREE.RepeatWrapping
    win.colorSpace = THREE.SRGBColorSpace
    for (let i = 0; i < 46; i++) {
      const a = -1.25 + (i / 46) * 2.2 + (rnd() - 0.5) * 0.04
      if (a > -0.32 && a < 0.2) continue
      const r = 230 + rnd() * 160
      const w = 14 + rnd() * 22,
        h = 18 + rnd() * rnd() * 110,
        d = 14 + rnd() * 18
      const t = win.clone()
      t.repeat.set(w / 12, h / 18)
      t.needsUpdate = true
      const m = new THREE.MeshStandardMaterial({ color: '#2b2333', roughness: 0.8, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.1 })
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      b.position.set(Math.sin(a) * r, h / 2, -Math.cos(a) * r)
      b.rotation.y = -a + (rnd() - 0.5) * 0.3
      group.add(b)
    }
    // India Gate (arch), framed in the middle distance near the sun
    const gate = new THREE.Group()
    const add = (w: number, h: number, d: number, x: number, y: number, m = stone) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      b.position.set(x, y, 0)
      gate.add(b)
    }
    add(9, 26, 8, -10.5, 13)
    add(9, 26, 8, 10.5, 13)
    add(30, 7, 8, 0, 29.5)
    add(32, 1.4, 9, 0, 33.7)
    add(22, 4, 7, 0, 36.4)
    add(14, 2.4, 6.5, 0, 39.6)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), stone)
    dome.position.set(0, 40.8, 0)
    gate.add(dome)
    gate.position.set(3, 0, -175)
    gate.rotation.y = -0.05
    group.add(gate)
    // domed monument with minarets (left)
    const mon = new THREE.Group()
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 16, 24), stone)
    drum.position.y = 8
    const big = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e9dccb', roughness: 0.7 }))
    big.position.y = 16
    mon.add(drum, big)
    for (const x of [-20, 20]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, 34, 12), stone)
      t.position.set(x, 17, 0)
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), stone)
      cap.position.set(x, 35, 0)
      mon.add(t, cap)
    }
    mon.position.set(-75, 0, -260)
    mon.rotation.y = 0.3
    group.add(mon)
    // palms and street trees silhouettes
    for (let i = 0; i < 26; i++) {
      const x = -140 + rnd() * 280,
        z = -70 - rnd() * 80
      if (Math.abs(x - 3) < 30) continue
      const palm = rnd() < 0.55
      const h = palm ? 10 + rnd() * 8 : 6 + rnd() * 4
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), dark)
      trunk.position.set(x, h / 2, z)
      trunk.rotation.z = palm ? (rnd() - 0.5) * 0.25 : 0
      group.add(trunk)
      if (palm)
        for (let k = 0; k < 7; k++) {
          const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5.5, 4), dark)
          f.position.set(x, h, z)
          f.rotation.set(1.9, (k / 7) * Math.PI * 2, 0, 'YXZ')
          f.translateY(2.4)
          group.add(f)
        }
      else {
        const c = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 1.6, 14, 10), dark)
        c.position.set(x, h + 2, z)
        group.add(c)
      }
    }
    return group
  }, [])
  return <primitive object={geo} />
}

function Street() {
  const asphalt = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#3a3438', roughness: 0.35, metalness: 0.15 })
    return m
  }, [])
  const kerb = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8e7f72', roughness: 0.8 }), [])
  const paint = useMemo(() => new THREE.MeshBasicMaterial({ color: '#d9c9a8' }), [])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={asphalt}>
        <planeGeometry args={[600, 600]} />
      </mesh>
      {/* footpath under the hero */}
      <mesh position={[0, 0.08, 3]} receiveShadow material={kerb}>
        <boxGeometry args={[60, 0.16, 5]} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-30 + i * 5, 0.01, -3.2]} rotation={[-Math.PI / 2, 0, 0]} material={paint}>
          <planeGeometry args={[2.4, 0.16]} />
        </mesh>
      ))}
    </group>
  )
}

function Car() {
  const tpl = useMemo(() => vehicleTemplate('sedan', '#b3122b'), [])
  const m = materials()
  return (
    <group position={[2.0, 0.02, -0.6]} rotation={[0, -2.2, 0]} scale={1.05}>
      <mesh geometry={tpl.body} material={m.vehicle} castShadow receiveShadow />
      <mesh geometry={tpl.glow} material={m.glow} />
    </group>
  )
}

function Hero() {
  const photoFace = useGame((s) => s.settings.photoFace)
  const [rig, setRig] = useState<Rig | null>(null)
  useEffect(() => {
    let alive = true
    buildFaceTexture(photoFace).then(({ texture, skin }) => {
      if (alive) setRig(buildCharacter(texture, skin, useGame.getState().outfit))
    })
    return () => {
      alive = false
    }
  }, [photoFace])
  const t = useRef(0)
  useFrame((_, dt) => {
    if (!rig) return
    t.current += dt
    animateRig(rig, { speed: 0, grounded: true, vy: 0, sitting: false, time: t.current, sprinting: false }, dt)
    // a confident, slightly turned stance that glances toward the camera
    rig.head.rotation.y = -0.25 + Math.sin(t.current * 0.4) * 0.12
    rig.chest.rotation.y = -0.12
  })
  if (!rig) return null
  return <primitive object={rig.root} position={[-0.25, 0.16, 3.4]} rotation={[0, 0.3, 0]} />
}

function Dust() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(500 * 3)
    for (let i = 0; i < 500; i++) {
      p[i * 3] = (Math.random() - 0.5) * 40
      p[i * 3 + 1] = Math.random() * 8
      p[i * 3 + 2] = -Math.random() * 30 + 6
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [])
  const ref = useRef<THREE.Points>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.01
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#ffcf8a" size={0.06} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

function CameraRig() {
  const camera = useThree((s) => s.camera)
  const t = useRef(0)
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    t.current += dt
    const k = t.current
    // slow cinematic drift; hero sits in the right third, sun and India Gate behind
    camera.position.set(-2.4 + Math.sin(k * 0.08) * 0.45, 1.05 + Math.sin(k * 0.11) * 0.05, 8.4 + Math.cos(k * 0.07) * 0.3)
    look.set(-1.8, 2.05, -2)
    camera.lookAt(look)
  })
  return null
}

export function TitleScene() {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <Canvas
      className="title-canvas"
      shadows
      dpr={[1, Math.min(2, window.devicePixelRatio || 1)]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, near: 0.1, far: 2000, position: [-1.6, 1.25, 6.4] }}
      frameloop={reduce ? 'demand' : 'always'}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        scene.fog = new THREE.Fog('#a8584a', 60, 420)
      }}
    >
      <Sky />
      <hemisphereLight args={['#ffb27a', '#3a2440', 0.9]} />
      {/* low sun from behind: warm rim light on the hero and car */}
      <directionalLight
        position={[SUN.x * 60, 18, SUN.z * 60]}
        color="#ffb066"
        intensity={3.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-bias={-0.0005}
      />
      {/* soft cool fill from the camera side so the face reads */}
      <directionalLight position={[-4, 3, 8]} color="#9fb4ff" intensity={0.9} />
      <pointLight position={[-1.2, 1.9, 5]} color="#ffd2a8" intensity={5} distance={6} />
      <Skyline />
      <Street />
      <Car />
      <Hero />
      <Dust />
      <CameraRig />
    </Canvas>
  )
}
