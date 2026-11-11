import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { runtime } from '../state/runtime'
import { textTexture } from '../utils/textures'
import { materials } from '../world/materials'
import type { CityData, Interactable } from '../world/types'
import { buildInterior, buildMetroTrain, type InteriorKind, type InteriorOut } from './interiors'

export interface ActiveInterior {
  kind: InteriorKind
  name: string
  origin: { x: number; z: number }
  ret: { x: number; z: number; yaw: number }
  out: InteriorOut
  station?: string
}

/** Global API used by interaction handlers and the metro panel. */
export const interiorApi = {
  enter: (_kind: InteriorKind, _name: string, _ret: { x: number; z: number; yaw: number }, _station?: string) => {},
  exit: () => {},
  /** leave without teleporting (another system moves the player) */
  clear: () => {},
}

const SPOT_BASE = 900000

export function InteriorSystem({ city }: { city: CityData }) {
  const [active, setActive] = useState<ActiveInterior | null>(null)
  const seed = useRef(1)

  interiorApi.enter = (kind, name, ret, station) => {
    const out = buildInterior(kind, seed.current++, name)
    const origin = { x: city.bounds.maxX + 900, z: city.bounds.minZ - 400 }
    const a: ActiveInterior = { kind, name, origin, ret, out, station }
    runtime.interior = a
    runtime.interiorSpots = out.spots.map((s, i) => ({ ...s, id: SPOT_BASE + i, x: s.x + origin.x, z: s.z + origin.z, data: { ...s.data, ...(s.data?.propX !== undefined ? { propX: (s.data.propX as number) + origin.x, propZ: (s.data.propZ as number) + origin.z } : {}), station } }) as Interactable)
    runtime.player.teleport = { x: origin.x + out.spawn.x, z: origin.z + out.spawn.z, yaw: out.spawn.yaw }
    setActive(a)
    audio.blip(330, 0.04, 0.15)
  }
  interiorApi.clear = () => {
    runtime.interior = null
    runtime.interiorSpots = []
    runtime.trainBoardable = false
    setActive(null)
  }
  interiorApi.exit = () => {
    const a = runtime.interior as ActiveInterior | null
    if (!a) return
    runtime.player.teleport = { ...a.ret }
    interiorApi.clear()
    audio.blip(260, 0.04, 0.15)
  }
  useEffect(() => () => interiorApi.clear(), [])
  return active ? <InteriorView key={active.origin.x + active.name + seed.current} a={active} /> : null
}

function InteriorView({ a }: { a: ActiveInterior }) {
  const { world, rapier } = useRapier()
  const m = materials()
  const geo = useMemo(() => ({ body: a.out.b.build(), glow: a.out.g.build() }), [a])
  const train = useMemo(() => (a.kind === 'metro' ? buildMetroTrain() : null), [a])
  const trainRef = useRef<THREE.Group>(null)
  const lights = useRef<(THREE.PointLight | null)[]>([])

  useEffect(() => {
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
    const q = new THREE.Quaternion()
    for (const c of a.out.colliders) {
      q.setFromEuler(new THREE.Euler(0, c.rot, 0))
      world.createCollider(rapier.ColliderDesc.cuboid(c.hw, c.hh, c.hd).setTranslation(c.x + a.origin.x, c.y, c.z + a.origin.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), body)
    }
    return () => {
      try {
        if (world.getRigidBody(body.handle)) world.removeRigidBody(body)
      } catch {
        /* world disposed */
      }
      geo.body.dispose()
      geo.glow.dispose()
    }
  }, [world, rapier, a, geo])

  // metro: a train arrives every 45 s, dwells 14 s, departs
  useFrame(() => {
    if (!train || !trainRef.current) return
    const t = runtime.time.elapsed % 45
    let x: number
    if (t < 6) {
      const k = 1 - t / 6
      x = -k * k * 130
    } else if (t < 20) x = 0
    else if (t < 26) {
      const k = (t - 20) / 6
      x = k * k * 150
    } else x = 400
    trainRef.current.position.x = x
    trainRef.current.visible = x < 300
    const wasBoardable = runtime.trainBoardable
    runtime.trainBoardable = t >= 6 && t < 19
    if (runtime.trainBoardable && !wasBoardable) audio.blip(660, 0.05, 0.4)
  })

  return (
    <group position={[a.origin.x, 0, a.origin.z]}>
      <mesh geometry={geo.body} material={m.props} castShadow receiveShadow />
      <mesh geometry={geo.glow} material={m.glow} />
      {a.out.texts.map((t, i) => (
        <mesh key={i} position={[t.x, t.y, t.z]} rotation={[0, t.rot, 0]}>
          <planeGeometry args={[t.w, t.h]} />
          <meshStandardMaterial map={textTexture(t.text, { bg: t.bg, fg: t.fg, w: 1024, h: Math.max(64, Math.round((1024 * t.h) / t.w)) })} />
        </mesh>
      ))}
      {a.out.lights.map((l, i) => (
        <pointLight key={i} ref={(r) => { lights.current[i] = r }} position={[l.x, l.y, l.z]} color={l.color} intensity={l.intensity * 1.3} distance={0} decay={2} />
      ))}
      {train && a.out.trackZ !== undefined && (
        <group ref={trainRef} position={[-130, 0, a.out.trackZ]}>
          <mesh geometry={train.body} material={m.vehicle} castShadow />
          <mesh geometry={train.glow} material={m.glow} />
        </group>
      )}
    </group>
  )
}
