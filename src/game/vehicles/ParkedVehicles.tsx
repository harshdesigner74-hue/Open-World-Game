import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { materials } from '../world/materials'
import { VEHICLE_DIMS, vehicleTemplate } from '../world/models'
import type { CityData } from '../world/types'
import { buildParkedRegistry, type Parked } from './parked'

const RENDER_R = 160
const PHYS_R = 50

/** Instanced rendering of parked vehicles near the player + their physics colliders. */
export function ParkedVehicles({ city }: { city: CityData }) {
  const reg = useMemo(() => {
    const r = buildParkedRegistry(city, useGame.getState().progress.vehicles)
    runtime.parked = r
    return r
  }, [city])
  const [groups, setGroups] = useState<{ key: string; items: Parked[] }[]>([])
  const st = useRef({ t: 0, sig: '', physSig: '' })
  const { world, rapier } = useRapier()
  const bodyRef = useRef<ReturnType<typeof world.createRigidBody> | null>(null)

  useEffect(
    () => () => {
      const b = bodyRef.current
      bodyRef.current = null
      st.current.physSig = '' // force a rebuild if remounted (StrictMode)
      try {
        if (b && world.getRigidBody(b.handle)) world.removeRigidBody(b)
      } catch {
        /* world disposed */
      }
    },
    [world],
  )

  useFrame((_, dt) => {
    st.current.t -= dt
    if (st.current.t > 0) return
    st.current.t = 0.4
    const P = runtime.player.pos
    const near = reg.near(P.x, P.z, RENDER_R)
    const sig = near.map((p) => p.id).join(',') + '#' + reg.version
    if (sig !== st.current.sig) {
      st.current.sig = sig
      const m = new Map<string, Parked[]>()
      for (const p of near) {
        const k = p.kind + '|' + p.color
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(p)
      }
      setGroups([...m.entries()].map(([key, items]) => ({ key, items })))
    }
    // colliders for the closest ones
    const phys = reg.near(P.x, P.z, PHYS_R)
    const psig = phys.map((p) => p.id).join(',') + '#' + reg.version
    if (psig !== st.current.physSig) {
      st.current.physSig = psig
      const old = bodyRef.current
      bodyRef.current = null
      if (old && world.getRigidBody(old.handle)) world.removeRigidBody(old)
      const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
      const q = new THREE.Quaternion()
      for (const p of phys) {
        const D = VEHICLE_DIMS[p.kind]
        q.setFromEuler(new THREE.Euler(0, p.rot, 0))
        world.createCollider(
          rapier.ColliderDesc.cuboid(D.w / 2, D.h / 2, D.l / 2).setTranslation(p.x, D.h / 2 + 0.03, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
          body,
        )
      }
      bodyRef.current = body
    }
  })

  return (
    <>
      {groups.map((g) => (
        <ParkedGroup key={g.key + g.items.length} groupKey={g.key} items={g.items} />
      ))}
    </>
  )
}

function ParkedGroup({ groupKey, items }: { groupKey: string; items: Parked[] }) {
  const [kind, color] = groupKey.split('|')
  const tpl = vehicleTemplate(kind as Parked['kind'], color)
  const body = useRef<THREE.InstancedMesh>(null)
  const glow = useRef<THREE.InstancedMesh>(null)
  const m = materials()
  useEffect(() => {
    const mat = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (const im of [body.current, glow.current]) {
      if (!im) continue
      items.forEach((p, i) => {
        q.setFromEuler(new THREE.Euler(0, p.rot, 0))
        mat.compose(new THREE.Vector3(p.x, 0.03, p.z), q, new THREE.Vector3(1, 1, 1))
        im.setMatrixAt(i, mat)
      })
      im.count = items.length
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
    }
  }, [items])
  return (
    <>
      <instancedMesh ref={body} args={[tpl.body, m.vehicle, items.length]} castShadow receiveShadow />
      <instancedMesh ref={glow} args={[tpl.glow, m.glow, items.length]} />
    </>
  )
}
