import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, useRapier } from '@react-three/rapier'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { QUALITY, useGame } from '../state/store'
import { detailTexture, flagTexture, textTexture } from '../utils/textures'
import { chunksWithin, ensureDetail, ensureLod, evictDetail, getDetail, hasDetail, setCity } from './chunkCache'
import type { Decal } from './landmarks'
import { materials } from './materials'
import { signalPoles } from './chunkBuilder'
import { signalLight } from '../traffic/signals'
import type { CityData } from './types'

export function World({ city }: { city: CityData }) {
  const quality = useGame((s) => s.settings.quality)
  const Q = QUALITY[quality]
  const [view, setView] = useState<{ detail: string[]; lod: string[]; phys: string[] }>({ detail: [], lod: [], phys: [] })
  const st = useRef({ t: 0, sig: '' })
  useMemo(() => setCity(city), [city])

  useFrame((_, dt) => {
    const p = runtime.player.pos
    const want = chunksWithin(city, p.x, p.z, Q.detailRadius)
    // time-sliced building, nearest first (keeps frame times smooth while streaming)
    const t0 = performance.now()
    let built = false
    // at most one chunk per frame (a second only if the first was very cheap) so streaming
    // never stacks several 4–9 ms builds into one frame while you drive or sprint
    for (const w of want) {
      if (hasDetail(w.key)) continue
      ensureDetail(city, w.key)
      built = true
      if (performance.now() - t0 > 1.5) break
    }
    st.current.t -= dt
    if (st.current.t > 0 && !built) return
    st.current.t = 0.3
    const phys = chunksWithin(city, p.x, p.z, Q.physicsRadius).map((w) => w.key)
    for (const k of phys) ensureDetail(city, k)
    const detail = want.filter((w) => hasDetail(w.key)).map((w) => w.key)
    const dset = new Set(detail)
    const lod = chunksWithin(city, p.x, p.z, Q.lodRadius)
      .map((w) => w.key)
      .filter((k) => !dset.has(k))
    for (const k of lod) ensureLod(city, k)
    const sig = detail.join('|') + '#' + lod.join('|') + '#' + phys.join('|')
    if (sig !== st.current.sig) {
      st.current.sig = sig
      setView({ detail, lod, phys })
      evictDetail(new Set(chunksWithin(city, p.x, p.z, Q.detailRadius * 1.4).map((w) => w.key)))
      runtime.stats.chunks = detail.length
      runtime.stats.lodChunks = lod.length
      runtime.stats.physChunks = phys.length
      runtime.loadedChunks = dset
    }
  })

  return (
    <>
      <Ground city={city} />
      {view.detail.map((k) => (
        <ChunkView key={k} chunkKey={k} />
      ))}
      {view.lod.map((k) => (
        <LodView key={k} city={city} chunkKey={k} />
      ))}
      {view.phys.map((k) => (
        <PhysicsChunk key={k} city={city} chunkKey={k} />
      ))}
      <SignalsLayer city={city} />
      <NightLights city={city} />
      {city.flag && <Flag x={city.flag.x} z={city.flag.z} />}
    </>
  )
}

const ChunkView = memo(function ChunkView({ chunkKey }: { chunkKey: string }) {
  const b = getDetail(chunkKey)
  const m = materials()
  if (!b) return null
  return (
    <group>
      {b.ground && <mesh geometry={b.ground} material={m.ground} receiveShadow />}
      {b.water && <mesh geometry={b.water} material={m.water} receiveShadow />}
      {b.buildings && <mesh geometry={b.buildings} material={m.facades} castShadow receiveShadow />}
      {b.props && <mesh geometry={b.props} material={m.props} castShadow receiveShadow />}
      {b.glow && <mesh geometry={b.glow} material={m.glow} />}
      {b.signs && <mesh geometry={b.signs} material={m.signs} />}
      {b.pools && <mesh geometry={b.pools} material={m.pools} renderOrder={2} />}
      {b.leaves && <mesh geometry={b.leaves} material={m.foliage} castShadow receiveShadow />}
      {b.fronds && <mesh geometry={b.fronds} material={m.frond} castShadow receiveShadow />}
      {b.decals.map((d, i) => (
        <DecalMesh key={i} d={d} />
      ))}
    </group>
  )
})

function DecalMesh({ d }: { d: Decal }) {
  const tex = useMemo(() => textTexture(d.text, { bg: d.bg, fg: d.fg, w: 1024, h: Math.max(64, Math.round((1024 * d.h) / d.w)) }), [d])
  return (
    <mesh position={[d.x, d.y, d.z]} rotation={[0, d.rot, 0]}>
      <planeGeometry args={[d.w, d.h]} />
      <meshStandardMaterial map={tex} roughness={0.85} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  )
}

const LodView = memo(function LodView({ city, chunkKey }: { city: CityData; chunkKey: string }) {
  const g = ensureLod(city, chunkKey)
  if (!g) return null
  return <mesh geometry={g} material={materials().lod} />
})

/** Static colliders for nearby chunks, created imperatively (fast) in Rapier. */
function PhysicsChunk({ city, chunkKey }: { city: CityData; chunkKey: string }) {
  const { world, rapier } = useRapier()
  useEffect(() => {
    const b = ensureDetail(city, chunkKey)
    if (!b) return
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (const c of b.colliders) {
      q.setFromEuler(e.set(0, c.rot, 0))
      world.createCollider(
        rapier.ColliderDesc.cuboid(c.hw, c.hh, c.hd).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        body,
      )
    }
    return () => {
      // on scene teardown the physics world may already be freed; nothing left to clean then
      try {
        world.removeRigidBody(body)
      } catch {
        /* world disposed */
      }
    }
  }, [world, rapier, city, chunkKey])
  return null
}

function Ground({ city }: { city: CityData }) {
  const mat = useMemo(() => {
    const t = detailTexture().clone()
    t.repeat.set(400, 400)
    t.needsUpdate = true
    return new THREE.MeshStandardMaterial({ color: '#86805f', map: t, roughness: 1 })
  }, [])
  const { minX, maxX, minZ, maxZ } = city.bounds
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2
  const w = maxX - minX,
    d = maxZ - minZ
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow material={mat}>
        <planeGeometry args={[w + 2400, d + 2400]} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[w, 1, d]} position={[cx, -1, cz]} />
        <CuboidCollider args={[1, 30, d / 2]} position={[minX - 1, 30, cz]} />
        <CuboidCollider args={[1, 30, d / 2]} position={[maxX + 1, 30, cz]} />
        <CuboidCollider args={[w / 2, 30, 1]} position={[cx, 30, minZ - 1]} />
        <CuboidCollider args={[w / 2, 30, 1]} position={[cx, 30, maxZ + 1]} />
      </RigidBody>
    </>
  )
}

/** Waving national flag (Central Park). Cloth motion is a cheap vertex wave. */
function Flag({ x, z }: { x: number; z: number }) {
  const geo = useMemo(() => new THREE.PlaneGeometry(21, 14, 32, 20), [])
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo])
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    const p = runtime.player.pos
    if (Math.hypot(p.x - x, p.z - z) > 700) return
    const t = clock.elapsedTime
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3],
        by = base[i * 3 + 1]
      const u = (bx + 10.5) / 21
      const w = Math.sin(u * 5 - t * 3.2 + by * 0.12) * 0.9 * u + Math.sin(u * 11 - t * 5) * 0.25 * u
      pos.setXYZ(i, bx, by - u * u * 0.8, w)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  })
  return (
    <mesh ref={ref} geometry={geo} position={[x + 10.8, 39.5, z]} castShadow>
      <meshStandardMaterial map={flagTexture()} side={THREE.DoubleSide} roughness={0.9} />
    </mesh>
  )
}

/** Live traffic-light lamps (instanced). Pole geometry is part of the chunk meshes. */
function SignalsLayer({ city }: { city: CityData }) {
  const count = city.signals.length * 4 * 2
  const refs = [useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null), useRef<THREE.InstancedMesh>(null)]
  const geo = useMemo(() => new THREE.SphereGeometry(0.13, 10, 8), [])
  const mats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ toneMapped: false })), [])
  const heads = useMemo(() => {
    const out: { x: number; y: number; z: number; axis: 0 | 1; sig: number }[] = []
    for (const s of city.signals) for (const pole of signalPoles(s)) for (const h of pole.heads) out.push({ x: h.x, y: 0, z: h.z, axis: h.axis, sig: s.id })
    return out
  }, [city])
  useEffect(() => {
    const m = new THREE.Matrix4()
    refs.forEach((r, li) => {
      const im = r.current
      if (!im) return
      heads.forEach((h, i) => {
        m.makeTranslation(h.x, 3.95 - li * 0.35, h.z)
        im.setMatrixAt(i, m)
        im.setColorAt(i, new THREE.Color('#111'))
      })
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.computeBoundingSphere()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heads])
  const st = useRef({ acc: 1, last: '' })
  const ON = [new THREE.Color('#ff2a1a'), new THREE.Color('#ffb31a'), new THREE.Color('#2bff6a')]
  const OFF = [new THREE.Color('#3a0b08'), new THREE.Color('#3a2a08'), new THREE.Color('#0a3014')]
  useFrame((_, dt) => {
    st.current.acc += dt
    if (st.current.acc < 0.25) return
    st.current.acc = 0
    const t = runtime.time.elapsed
    const sigStates = city.signals.map((s) => [signalLight(s, 0, t), signalLight(s, 1, t)])
    const key = sigStates.map((x) => x.join('')).join('')
    if (key === st.current.last) return
    st.current.last = key
    refs.forEach((r, li) => {
      const im = r.current
      if (!im) return
      heads.forEach((h, i) => {
        const state = sigStates[h.sig][h.axis]
        const on = (li === 0 && state === 'r') || (li === 1 && state === 'y') || (li === 2 && state === 'g')
        im.setColorAt(i, on ? ON[li] : OFF[li])
      })
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    })
  })
  return (
    <>
      {refs.map((r, i) => (
        <instancedMesh key={i} ref={r} args={[geo, mats[i], count]} frustumCulled={false} />
      ))}
    </>
  )
}

/** At night a small pool of real point lights hops to the street lamps nearest the player. */
function NightLights({ city }: { city: CityData }) {
  const N = 8
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const lamps = useMemo(() => city.props.filter((p) => p.type === 'lamp'), [city])
  const st = useRef({ acc: 1, on: new Array(8).fill(0) as number[] })
  useFrame((_, dt) => {
    const night = 1 - runtime.time.daylight
    st.current.acc += dt
    if (st.current.acc > 0.4) {
      st.current.acc = 0
      const P = runtime.player.pos
      const near = lamps
        .filter((l) => Math.abs(l.x - P.x) < 60 && Math.abs(l.z - P.z) < 60)
        .map((l) => ({ l, d: Math.hypot(l.x - P.x, l.z - P.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, N)
      lights.current.forEach((pl, i) => {
        if (!pl) return
        const n = near[i]
        st.current.on[i] = n ? 1 : 0
        if (n) pl.position.set(n.l.x + Math.sin(n.l.rot) * 1.7, 6.2, n.l.z + Math.cos(n.l.rot) * 1.7)
      })
    }
    // lights stay in the scene permanently (toggling visibility would recompile every shader)
    lights.current.forEach((pl, i) => {
      if (pl) pl.intensity = night * 260 * st.current.on[i]
    })
  })
  return (
    <>
      {Array.from({ length: N }, (_, i) => (
        <pointLight
          key={i}
          ref={(r) => {
            lights.current[i] = r
          }}
          color="#ffc98a"
          distance={26}
          decay={2}
          intensity={0}
        />
      ))}
    </>
  )
}
