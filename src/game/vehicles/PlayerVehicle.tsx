import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier'
import type { Collider } from '@dimforge/rapier3d-compat'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { input } from '../input/input'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { clamp, damp, wrapAngle } from '../utils/math'
import { materials } from '../world/materials'
import { VEHICLE_DIMS, vehicleTemplate, type VehicleKind } from '../world/models'
import { DRIVE } from './specs'
import { bump } from '../progress/progress'

/** Public helpers for other systems (garage delivery, missions). */
export const driveApi = {
  /** put the player in a vehicle immediately */
  enter: (_v: { kind: VehicleKind; color: string; x: number; z: number; rot: number; health: number; fuel: number; owned: boolean; ownedId?: number }) => {},
  exit: () => {},
}

export function PlayerVehicle() {
  const [session, setSession] = useState<{ n: number; kind: VehicleKind; color: string; x: number; z: number; rot: number } | null>(null)
  const D = runtime.drive

  const enter: typeof driveApi.enter = (v) => {
    Object.assign(D, { active: true, kind: v.kind, color: v.color, x: v.x, z: v.z, yaw: v.rot, speed: 0, steer: 0, lean: 0, health: v.health, fuel: v.fuel, owned: v.owned, ownedId: v.ownedId ?? -1 })
    setSession((s) => ({ n: (s?.n ?? 0) + 1, kind: v.kind, color: v.color, x: v.x, z: v.z, rot: v.rot }))
    audio.blip(240, 0.05, 0.12)
    audio.engineStart(v.kind)
    bump((p) => ({ rides: p.rides + 1 }))
  }
  const exit = () => {
    if (!D.active) return
    if (D.y > 1.2) {
      useGame.getState().toast('🚧 No stopping on the flyover — drive down the ramp first.', 'warn')
      return
    }
    const spec = DRIVE[D.kind]!
    const dims = VEHICLE_DIMS[D.kind]
    // India drives on the left: car driver sits on the RIGHT (local -x); riders hop off to the left
    const side = spec.twoWheeler ? 1 : -1
    const off = dims.w / 2 + 0.85
    const rx = Math.cos(D.yaw) * side,
      rz = -Math.sin(D.yaw) * side
    runtime.player.teleport = { x: D.x + rx * off, z: D.z + rz * off, yaw: D.yaw }
    runtime.parked?.add({ kind: D.kind, color: D.color, x: D.x, z: D.z, rot: D.yaw, owned: D.owned, health: D.health, fuel: D.fuel, ownedId: D.owned ? D.ownedId : undefined })
    if (D.owned && D.ownedId >= 0) {
      const city = useGame.getState().cityId
      bump((p) => ({ vehicles: p.vehicles.map((o) => (o.id === D.ownedId ? { ...o, city, x: D.x, z: D.z, rot: D.yaw, health: D.health, fuel: D.fuel } : o)) }))
    }
    D.active = false
    D.speed = 0
    setSession(null)
    useGame.setState({ vehicleHud: null })
    audio.engineStop()
    audio.blip(200, 0.05, 0.1)
  }
  driveApi.enter = enter
  driveApi.exit = exit

  // headlight (always in the scene so toggling never recompiles shaders)
  const spot = useMemo(() => {
    const s = new THREE.SpotLight('#fff3d6', 0, 60, 0.55, 0.5, 1.4)
    // never let light and target coincide (undefined direction → NaN pixels → bloom artefacts)
    s.position.set(0, -50, 0)
    s.target.position.set(0, -60, 1)
    return s
  }, [])
  useEffect(() => () => audio.engineStop(), [])

  useFrame(() => {
    const g = useGame.getState()
    const playing = g.panel === null && g.screen === 'playing'
    // enter / exit
    if (playing && input.consume('KeyF')) {
      if (D.active) {
        if (Math.abs(D.speed) < 4) exit()
        else g.toast('Slow down to get out', 'warn')
      } else if (!runtime.player.sitting) {
        const p = runtime.parked?.nearest(runtime.player.pos.x, runtime.player.pos.z, 3.4)
        if (p && DRIVE[p.kind]) {
          p.taken = true
          runtime.parked!.version++
          enter({ kind: p.kind, color: p.color, x: p.x, z: p.z, rot: p.rot, health: p.health, fuel: p.fuel, owned: p.owned, ownedId: p.ownedId })
        }
      }
    }
    const night = 1 - runtime.time.daylight
    spot.intensity = D.active ? night * 90 : 0
    if (D.active) {
      const fx = Math.sin(D.yaw),
        fz = Math.cos(D.yaw)
      spot.position.set(D.x + fx * 1.5, 1.1, D.z + fz * 1.5)
      spot.target.position.set(D.x + fx * 20, 0, D.z + fz * 20)
      spot.target.updateMatrixWorld()
    }
  })

  return (
    <>
      <primitive object={spot} />
      <primitive object={spot.target} />
      {session && <DrivenVehicle key={session.n} kind={session.kind} color={session.color} x={session.x} z={session.z} rot={session.rot} />}
    </>
  )
}

function DrivenVehicle({ kind, color, x, z, rot }: { kind: VehicleKind; color: string; x: number; z: number; rot: number }) {
  const body = useRef<RapierRigidBody>(null)
  const col = useRef<Collider>(null)
  const lean = useRef<THREE.Group>(null)
  const { world } = useRapier()
  const ctrl = useRef<ReturnType<typeof world.createCharacterController> | null>(null)
  const spec = DRIVE[kind]!
  const dims = VEHICLE_DIMS[kind]
  const tpl = vehicleTemplate(kind, color)
  const m = materials()
  const st = useRef({ ui: 0, crashCd: 0, odo: 0, vy: 0 })
  const q = useMemo(() => new THREE.Quaternion(), [])

  useEffect(() => {
    const c = world.createCharacterController(0.06)
    c.enableAutostep(0.3, 0.2, true)
    c.enableSnapToGround(0.4)
    c.setSlideEnabled(true)
    ctrl.current = c
    return () => {
      ctrl.current = null
      try {
        world.removeCharacterController(c)
      } catch {
        /* world disposed */
      }
    }
  }, [world])

  useFrame((_, rawDt) => {
    const D = runtime.drive
    const b = body.current,
      c = col.current,
      k = ctrl.current
    if (!D.active || !b || !c || !k) return
    runtime.driveBody = b
    const g = useGame.getState()
    const paused = g.panel !== null && g.panel !== 'info'
    const dt = paused ? 0 : Math.min(rawDt, 0.05)
    if (dt === 0) return
    const fwd = input.enabled && (input.keys.has('KeyW') || input.keys.has('ArrowUp'))
    const back = input.enabled && (input.keys.has('KeyS') || input.keys.has('ArrowDown'))
    const left = input.enabled && (input.keys.has('KeyA') || input.keys.has('ArrowLeft'))
    const right = input.enabled && (input.keys.has('KeyD') || input.keys.has('ArrowRight'))
    const hand = input.enabled && input.keys.has('Space')
    if (input.consume('KeyH')) audio.horn(D.x, D.z, D.kind)
    const dead = D.health <= 0
    const dry = D.fuel <= 0
    let s = D.speed
    if (fwd && !dead && !dry) {
      if (s < -0.5) s += spec.brake * dt
      else s += spec.accel * Math.max(0.05, 1 - s / spec.maxSpeed) * dt
    } else if (back) {
      if (s > 0.5) s -= spec.brake * dt
      else if (!dead && !dry) s = Math.max(-spec.reverse, s - 3 * dt)
    } else s -= Math.sign(s) * Math.min(Math.abs(s), (0.7 + 0.015 * s * s) * dt)
    if (hand) s -= Math.sign(s) * Math.min(Math.abs(s), 14 * dt)
    D.throttle = fwd ? 1 : 0
    const steerIn = (left ? 1 : 0) - (right ? 1 : 0)
    const steerMax = spec.steer / (1 + Math.abs(s) * 0.055)
    D.steer = damp(D.steer, steerIn * steerMax, 7, dt)
    const yawRate = (s / spec.wheelbase) * Math.tan(D.steer) * (hand ? 1.35 : 1)
    D.yaw = wrapAngle(D.yaw + yawRate * dt)
    const fx = Math.sin(D.yaw),
      fz = Math.cos(D.yaw)
    // gravity (so the car follows ramps down and doesn't float off a flyover crest)
    st.current.vy = Math.max(-30, st.current.vy - 22 * dt)
    const want = { x: fx * s * dt, y: st.current.vy * dt, z: fz * s * dt }
    k.computeColliderMovement(c, want)
    const mv = k.computedMovement()
    if (k.computedGrounded()) st.current.vy = -1
    // body pitch follows the slope we're driving on
    const horiz = Math.hypot(mv.x, mv.z)
    if (horiz > 0.02 && k.computedGrounded()) {
      const along = (mv.x * fx + mv.z * fz) >= 0 ? 1 : -1
      D.pitch = damp(D.pitch, clamp(-Math.atan2(mv.y, horiz) * along, -0.2, 0.2), 8, dt)
    } else if (horiz <= 0.02) D.pitch = damp(D.pitch, 0, 2, dt)
    const t = b.translation()
    const next = { x: t.x + mv.x, y: Math.max(0, t.y + mv.y), z: t.z + mv.z }
    const bd = runtime.city?.bounds
    if (bd) {
      next.x = clamp(next.x, bd.minX + 3, bd.maxX - 3)
      next.z = clamp(next.z, bd.minZ + 3, bd.maxZ - 3)
    }
    b.setNextKinematicTranslation(next)
    q.setFromEuler(new THREE.Euler(D.pitch, D.yaw, 0, 'YXZ'))
    b.setNextKinematicRotation(q)
    D.y = next.y
    // collision response: lost speed → damage
    const moved = Math.hypot(mv.x, mv.z) / dt
    st.current.crashCd -= dt
    if (Math.abs(s) > 2.5 && moved < Math.abs(s) * 0.45) {
      const impact = Math.abs(s) - moved
      if (impact > 3 && st.current.crashCd <= 0) {
        D.health = Math.max(0, D.health - impact * 2.2)
        st.current.crashCd = 0.6
        audio.crash(impact)
        if (D.health <= 0) g.toast('💥 Vehicle wrecked — get out and find another (or repair at a petrol pump)', 'warn')
      }
      s = Math.sign(s) * moved * 0.6
    }
    D.speed = s
    D.x = next.x
    D.z = next.z
    st.current.odo += Math.hypot(mv.x, mv.z)
    D.fuel = Math.max(0, D.fuel - (Math.hypot(mv.x, mv.z) / 1000) * spec.fuelPerKm)
    if (D.fuel <= 0 && st.current.odo > 5) {
      st.current.odo = -1e9
      g.toast('⛽ Out of fuel! Push on to a petrol pump (E to refuel there).', 'warn')
    }
    D.lean = spec.twoWheeler ? damp(D.lean, clamp(-D.steer * Math.abs(s) * 0.09, -0.45, 0.45), 6, dt) : 0
    if (lean.current) lean.current.rotation.z = D.lean
    audio.engine(Math.abs(s) / spec.maxSpeed, D.throttle)
    st.current.ui -= dt
    if (st.current.ui <= 0) {
      st.current.ui = 0.12
      useGame.setState({ vehicleHud: { name: spec.name, speed: Math.round(Math.abs(s) * 3.6), health: Math.round(D.health), fuel: Math.round(D.fuel) } })
    }
  })

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[x, 0.03, z]} rotation={[0, rot, 0]}>
      <CuboidCollider ref={col} args={[dims.w / 2, dims.h / 2 - 0.12, dims.l / 2]} position={[0, dims.h / 2 + 0.1, 0]} />
      <group ref={lean}>
        <mesh geometry={tpl.body} material={m.vehicle} castShadow />
        <mesh geometry={tpl.glow} material={m.glow} />
      </group>
    </RigidBody>
  )
}
