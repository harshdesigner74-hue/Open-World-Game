import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { npcApi } from '../npc/NPCSystem'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { SpatialHash, clamp, dampAngle, wrapAngle } from '../utils/math'
import { driveApi } from '../vehicles/PlayerVehicle'
import { materials } from '../world/materials'
import { VEHICLE_DIMS, vehicleTemplate } from '../world/models'
import type { CityData, RoadNet } from '../world/types'
import { cinema } from '../../ui/Social'
import { crime, payFine, publish, reportRam, resetCrime, updateCrime } from './crime'

/**
 * Police pursuit. While the player is wanted, police cars (white, red/blue light bar, siren)
 * spawn out of sight, plan a route to the player's last known position along the real road
 * network (A* over the OSM junction graph), then close in directly and box the player in.
 * Stop (or get stopped) next to one for a couple of seconds and you're busted.
 */

const MAX_COPS = 5
const DIMS = VEHICLE_DIMS.sedan

interface Cop {
  active: boolean
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  /** route as x, y, z triples */
  route: number[]
  ri: number
  repath: number
  life: number
  leaving: boolean
}

/** Shared with other systems (theft witnesses, minimap). */
export const policeApi = {
  /** distance from (x, z) to the nearest police car */
  nearestCop: (_x: number, _z: number): number => Infinity,
}

class Heap {
  private a: number[] = []
  private p: number[] = []
  get size() {
    return this.a.length
  }
  push(v: number, pr: number) {
    const a = this.a, p = this.p
    a.push(v)
    p.push(pr)
    let i = a.length - 1
    while (i > 0) {
      const u = (i - 1) >> 1
      if (p[u] <= p[i]) break
      ;[a[u], a[i]] = [a[i], a[u]]
      ;[p[u], p[i]] = [p[i], p[u]]
      i = u
    }
  }
  pop() {
    const a = this.a, p = this.p
    const top = a[0]
    const la = a.pop()!, lp = p.pop()!
    if (a.length) {
      a[0] = la
      p[0] = lp
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        if (l < a.length && p[l] < p[m]) m = l
        if (r < a.length && p[r] < p[m]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        ;[p[m], p[i]] = [p[i], p[m]]
        i = m
      }
    }
    return top
  }
}

/** A* over drivable junctions; returns the route as x,y,z triples (police ignore one-way rules) */
function planRoute(net: RoadNet, from: number, to: number): number[] | null {
  if (from === to) return [net.nx[to], 0, net.nz[to]]
  const n = net.nx.length
  const gScore = new Float32Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const h = (i: number) => Math.hypot(net.nx[i] - net.nx[to], net.nz[i] - net.nz[to])
  const open = new Heap()
  gScore[from] = 0
  open.push(from, h(from))
  let expanded = 0
  while (open.size && expanded++ < 9000) {
    const u = open.pop()
    if (u === to) break
    if (closed[u]) continue
    closed[u] = 1
    for (const ei of net.inc[u]) {
      const e = net.edges[ei]
      if (!e.car) continue
      const v = e.a === u ? e.b : e.a
      const ng = gScore[u] + e.len
      if (ng < gScore[v]) {
        gScore[v] = ng
        via[v] = ei
        open.push(v, ng + h(v))
      }
    }
  }
  if (via[to] < 0) return null
  // walk back, then emit edge polylines in travel order
  const edges: { ei: number; fwd: boolean }[] = []
  let cur = to
  let guard = 0
  while (cur !== from && guard++ < 5000) {
    const e = net.edges[via[cur]]
    const fwd = e.b === cur
    edges.push({ ei: via[cur], fwd })
    cur = fwd ? e.a : e.b
  }
  edges.reverse()
  const out: number[] = []
  for (const { ei, fwd } of edges) {
    const e = net.edges[ei]
    const k = e.pts.length / 2
    for (let j = 1; j < k; j++) {
      const i = fwd ? j : k - 1 - j
      out.push(e.pts[i * 2], e.h ? e.h[i] : 0, e.pts[i * 2 + 1])
    }
  }
  return out
}

export function PoliceSystem({ city }: { city: CityData }) {
  const net = city.net
  const bodies = useRef<(RapierRigidBody | null)[]>([])
  const groups = useRef<(THREE.Group | null)[]>([])
  const st = useRef({ spawnCd: 0, ui: 0, bustLock: false })

  const sim = useMemo(() => {
    const nodeHash = new SpatialHash<number>(50)
    for (let i = 0; i < net.nx.length; i++) if (net.inc[i].some((ei) => net.edges[ei].car)) nodeHash.insertPoint(i, net.nx[i], net.nz[i])
    const cops: Cop[] = Array.from({ length: MAX_COPS }, () => ({ active: false, x: 0, y: -80, z: 0, yaw: 0, speed: 0, route: [], ri: 0, repath: 0, life: 0, leaving: false }))
    const stations = city.props.filter((p) => p.type === 'police_booth')
    return { nodeHash, cops, stations }
  }, [net, city])

  const nearestNode = (x: number, z: number, r = 120) => {
    let best = -1
    let bd = Infinity
    for (const i of sim.nodeHash.query(x - r, z - r, x + r, z + r)) {
      const d = Math.hypot(net.nx[i] - x, net.nz[i] - z)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  // light bar: shared red / blue materials, flashed every frame
  const lightMats = useMemo(
    () => [new THREE.MeshBasicMaterial({ color: '#ff1a1a', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#1a4dff', toneMapped: false })],
    [],
  )
  const barMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.5 }), [])
  const stripeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1d3f8f', roughness: 0.6 }), [])

  useEffect(() => {
    resetCrime()
    policeApi.nearestCop = (x, z) => {
      let bd = Infinity
      for (const c of sim.cops) if (c.active) bd = Math.min(bd, Math.hypot(c.x - x, c.z - z))
      return bd
    }
    return () => {
      policeApi.nearestCop = () => Infinity
      runtime.police = []
      audio.siren(0)
      resetCrime()
    }
  }, [sim])

  const spawn = (c: Cop) => {
    const P = runtime.player.pos
    const camYaw = runtime.cam.yaw
    for (let tries = 0; tries < 25; tries++) {
      // prefer behind the camera, 70–130 m away
      const a = camYaw + Math.PI + (Math.random() - 0.5) * (tries < 12 ? 2.2 : 6.2)
      const r = 70 + Math.random() * 60
      const n = nearestNode(P.x + Math.sin(a) * r, P.z + Math.cos(a) * r, 40)
      if (n < 0) continue
      const x = net.nx[n], z = net.nz[n]
      const d = Math.hypot(x - P.x, z - P.z)
      if (d < 55 || d > 170) continue
      if (sim.cops.some((o) => o.active && Math.hypot(o.x - x, o.z - z) < 12)) continue
      Object.assign(c, { active: true, x, y: 0, z, yaw: Math.atan2(P.x - x, P.z - z), speed: 6, route: [], ri: 0, repath: 0, life: 0, leaving: false })
      return true
    }
    return false
  }

  const busted = () => {
    const g = useGame.getState()
    const D = runtime.drive
    const fine = 1000 * crime.level + 500 * crime.charges.length
    const charges = crime.charges.join(', ').toLowerCase() || 'trouble'
    if (D.active) {
      D.speed = 0
      D.y = 0
      driveApi.exit()
    }
    const paid = payFine(fine)
    resetCrime()
    for (const c of sim.cops) c.active = false
    st.current.bustLock = true
    cinema('🚔 BUSTED')
    audio.siren(0)
    setTimeout(() => {
      const P = runtime.player.pos
      let best: { x: number; z: number; rot: number } | null = null
      let bd = Infinity
      for (const s of sim.stations) {
        const d = Math.hypot(s.x - P.x, s.z - P.z)
        if (d < bd) {
          bd = d
          best = { x: s.x, z: s.z, rot: s.rot }
        }
      }
      const at = best ? { x: best.x + Math.sin(best.rot) * 2.5, z: best.z + Math.cos(best.rot) * 2.5, yaw: best.rot } : { x: city.spawn.x, z: city.spawn.z, yaw: city.spawn.yaw }
      runtime.player.teleport = at
      st.current.bustLock = false
      g.toast(`🚔 Busted for ${charges}. Fined ₹${paid.toLocaleString('en-IN')} and released from the police booth.`, 'warn')
    }, 1100)
  }

  const tmpQ = useMemo(() => new THREE.Quaternion(), [])
  const tmpE = useMemo(() => new THREE.Euler(), [])

  useFrame((_, rawDt) => {
    const g = useGame.getState()
    const paused = g.panel !== null && g.panel !== 'info'
    const dt = paused ? 0 : Math.min(rawDt, 0.05)
    const t = runtime.time.elapsed
    const P = runtime.player.pos
    const D = runtime.drive
    const tx = D.active ? D.x : P.x, tz = D.active ? D.z : P.z, ty = D.active ? D.y : Math.max(0, P.y - 0.05)
    const pSpeed = D.active ? Math.abs(D.speed) : runtime.player.speed
    const level = crime.level
    const want = level === 0 ? 0 : Math.min(MAX_COPS, level)

    // population
    st.current.spawnCd -= dt
    const active = sim.cops.filter((c) => c.active && !c.leaving).length
    if (dt > 0 && active < want && st.current.spawnCd <= 0 && !runtime.interior) {
      const free = sim.cops.find((c) => !c.active)
      if (free && spawn(free)) st.current.spawnCd = 2.5
    }
    if (level === 0) for (const c of sim.cops) if (c.active) c.leaving = true

    // flashing light bar
    const ph = Math.floor(t * 6) % 2
    lightMats[0].color.setRGB(ph ? 4 : 0.25, 0, 0)
    lightMats[1].color.setRGB(0, 0.05, ph ? 0.25 : 4)

    let sees = false
    let nearest = Infinity
    const pub: { x: number; z: number }[] = []
    for (let i = 0; i < sim.cops.length; i++) {
      const c = sim.cops[i]
      const body = bodies.current[i]
      const grp = groups.current[i]
      if (!c.active) {
        if (body) body.setNextKinematicTranslation({ x: i * 5, y: -80, z: 40 })
        if (grp) grp.visible = false
        continue
      }
      if (grp) grp.visible = true
      c.life += dt
      const d = Math.hypot(tx - c.x, tz - c.z)
      if ((c.leaving && (d > 90 || c.life > 25)) || d > 320) {
        c.active = false
        continue
      }
      nearest = Math.min(nearest, d)
      if (!c.leaving && d < 70 + level * 15) sees = true

      // where to go
      let ax: number, az: number, ay = 0
      const direct = !c.leaving && d < 38
      if (direct) {
        // pursuit with a little lead on a moving car
        const lead = D.active ? clamp(d / 20, 0, 0.8) : 0
        ax = tx + Math.sin(D.yaw) * D.speed * lead
        az = tz + Math.cos(D.yaw) * D.speed * lead
        ay = ty
      } else {
        c.repath -= dt
        if (c.repath <= 0 || c.ri * 3 >= c.route.length) {
          c.repath = 2 + Math.random()
          const goal = c.leaving ? { x: c.x + Math.sin(c.yaw) * 200, z: c.z + Math.cos(c.yaw) * 200 } : crime.lastKnown
          const a = nearestNode(c.x, c.z)
          const b = nearestNode(goal.x, goal.z, 200)
          const r = a >= 0 && b >= 0 ? planRoute(net, a, b) : null
          c.route = r ?? []
          c.ri = 0
          // skip route points behind us
          while (c.ri * 3 + 3 < c.route.length && Math.hypot(c.route[c.ri * 3] - c.x, c.route[c.ri * 3 + 2] - c.z) < 8) c.ri++
        }
        while (c.ri * 3 + 3 < c.route.length && Math.hypot(c.route[c.ri * 3] - c.x, c.route[c.ri * 3 + 2] - c.z) < 7) c.ri++
        if (c.route.length) {
          ax = c.route[c.ri * 3]
          ay = c.route[c.ri * 3 + 1]
          az = c.route[c.ri * 3 + 2]
        } else {
          ax = tx
          az = tz
        }
      }

      // steer & speed
      const aim = Math.atan2(ax - c.x, az - c.z)
      const diff = Math.abs(wrapAngle(aim - c.yaw))
      const vmax = c.leaving ? 10 : 21 + level * 2.5
      let vt = vmax * clamp(1.15 - diff / 1.4, 0.2, 1)
      if (direct) {
        // brake to box the player in, never drive through them
        const stopAt = D.active ? 4.8 : 4.2
        vt = Math.min(vt, Math.max(0, (d - stopAt) * 2.2))
      }
      // keep apart from the other police cars
      for (const o of sim.cops) {
        if (o === c || !o.active) continue
        const dd = Math.hypot(o.x - c.x, o.z - c.z)
        if (dd < 5.5) {
          const ahead = (o.x - c.x) * Math.sin(c.yaw) + (o.z - c.z) * Math.cos(c.yaw)
          if (ahead > 0) vt = Math.min(vt, Math.max(0, dd - 4))
        }
      }
      c.speed += clamp(vt - c.speed, -16 * dt, 9 * dt)
      c.yaw = dampAngle(c.yaw, aim, clamp(1 + c.speed * 0.25, 1.5, 4.5), Math.max(dt, 1e-4))
      c.x += Math.sin(c.yaw) * c.speed * dt
      c.z += Math.cos(c.yaw) * c.speed * dt
      c.y += (ay - c.y) * Math.min(1, dt * 4)
      // never drive into the player (kinematic bodies don't push each other)
      {
        const ox = c.x - tx, oz = c.z - tz
        const od = Math.hypot(ox, oz) || 1
        let minGap = 2.6
        if (D.active) {
          // bigger gap nose-to-tail than side-by-side
          const PD = VEHICLE_DIMS[D.kind]
          const along = Math.abs((ox * Math.sin(D.yaw) + oz * Math.cos(D.yaw)) / od)
          minGap = 0.6 + along * (PD.l + DIMS.l) / 2 + Math.sqrt(1 - along * along) * (PD.w + DIMS.w) / 2
        }
        if (od < minGap && Math.abs(c.y - ty) < 2) {
          c.x = tx + (ox / od) * minGap
          c.z = tz + (oz / od) * minGap
          c.speed = Math.min(c.speed, 1)
        }
      }

      // the player rammed this car
      if (D.active && d < (DIMS.l + VEHICLE_DIMS[D.kind].l) / 2 + 0.2 && Math.abs(D.speed) > 7) reportRam()

      if (body) {
        body.setNextKinematicTranslation({ x: c.x, y: c.y + 0.03, z: c.z })
        tmpQ.setFromEuler(tmpE.set(0, c.yaw, 0))
        body.setNextKinematicRotation(tmpQ)
      }
      pub.push({ x: c.x, z: c.z })
    }
    runtime.police = pub

    // officers on foot (traffic police at junctions) also spot and grab you
    const foot = level > 0 && !D.active ? npcApi.policeNear(P.x, P.z, 30) : Infinity
    if (foot < 30) sees = true

    // arrest: slow / on foot next to a police car, or grabbed by an officer
    if (level > 0 && dt > 0 && !st.current.bustLock) {
      const pinned = (nearest < 7.5 && pSpeed < 3) || foot < 2.2
      crime.bust = clamp(crime.bust + (pinned ? dt / 2.5 : -dt / 1.5), 0, 1)
      if (crime.bust >= 1) busted()
    }
    if (dt > 0) updateCrime(dt, sees)

    // siren: loudest from the nearest car
    audio.siren(nearest < 200 ? clamp(1 - nearest / 200, 0, 1) * (crime.level > 0 ? 1 : 0.4) : 0)

    st.current.ui -= rawDt
    if (st.current.ui <= 0) {
      st.current.ui = 0.15
      publish()
    }
  })

  const m = materials()
  const tpl = vehicleTemplate('sedan', '#f3f3f1')
  return (
    <>
      {sim.cops.map((_, i) => (
        <RigidBody
          key={i}
          ref={(r) => {
            bodies.current[i] = r
          }}
          type="kinematicPosition"
          colliders={false}
          position={[i * 5, -80, 40]}
        >
          <CuboidCollider args={[DIMS.w / 2, DIMS.h / 2, DIMS.l / 2]} position={[0, DIMS.h / 2, 0]} />
          <group
            ref={(gr) => {
              groups.current[i] = gr
            }}
            visible={false}
          >
            <mesh geometry={tpl.body} material={m.vehicle} castShadow />
            <mesh geometry={tpl.glow} material={m.glow} />
            {/* blue livery stripe along both sides */}
            <mesh material={stripeMat} position={[0, 0.62, 0]}>
              <boxGeometry args={[DIMS.w + 0.02, 0.14, DIMS.l * 0.8]} />
            </mesh>
            {/* roof light bar */}
            <mesh material={barMat} position={[0, DIMS.h + 0.04, -0.1]}>
              <boxGeometry args={[1.1, 0.1, 0.3]} />
            </mesh>
            <mesh material={lightMats[0]} position={[-0.28, DIMS.h + 0.13, -0.1]}>
              <boxGeometry args={[0.46, 0.1, 0.24]} />
            </mesh>
            <mesh material={lightMats[1]} position={[0.28, DIMS.h + 0.13, -0.1]}>
              <boxGeometry args={[0.46, 0.1, 0.24]} />
            </mesh>
          </group>
        </RigidBody>
      ))}
    </>
  )
}
