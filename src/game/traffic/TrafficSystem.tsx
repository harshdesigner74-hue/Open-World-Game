import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { runtime, type VehicleState } from '../state/runtime'
import { QUALITY, useGame } from '../state/store'
import { GeoBuilder } from '../utils/geoBuilder'
import { SpatialHash, dampAngle, mulberry32, pick } from '../utils/math'
import { materials } from '../world/materials'
import { CAR_COLORS, VEHICLE_DIMS, seatedRider, vehicleTemplate, type VehicleKind } from '../world/models'
import type { CityData, NetEdge, RoadNet } from '../world/types'
import { axisOf, signalLight } from './signals'

/**
 * AI traffic on the real road graph (OpenStreetMap ways split at junctions).
 *  - Drive on the LEFT; one-way streets & roundabouts respected.
 *  - At each junction pick an onward edge (prefers going straight, avoids U-turns).
 *  - Stop at the real signalised junctions (phase chosen by approach direction).
 *  - Keep a gap to vehicles, pedestrians and the player; honk when blocked.
 *  - A fixed pool of vehicles is (re)spawned in a ring around the player.
 */
const DRIVE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'])
const TRAFFIC_HOURLY = [0.25, 0.18, 0.14, 0.14, 0.18, 0.3, 0.55, 0.85, 1, 1, 0.9, 0.85, 0.85, 0.85, 0.85, 0.9, 0.95, 1, 1, 1, 0.9, 0.75, 0.55, 0.38]
const SPEED: Record<string, number> = { trunk: 15, primary: 13, secondary: 12, tertiary: 10, unclassified: 8, residential: 7 }

interface Lane {
  edge: NetEdge
  fwd: boolean // a→b
  pts: number[] // lane polyline (offset to the left of travel)
  /** per-point height (flyovers), else undefined = ground */
  hs?: number[]
  cum: number[]
  len: number
  endNode: number
  startNode: number
}

interface Car {
  slot: number
  active: boolean
  lane: Lane | null
  next: Lane | null
  s: number
  speed: number
  cruise: number
  kind: VehicleKind
  w: number
  l: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  blocked: number
  ignoreCross: number
  pub: VehicleState
  rider: THREE.BufferGeometry | null
  color: string
}

function laneFor(net: RoadNet, edge: NetEdge, fwd: boolean, offset: number): Lane {
  const src = edge.pts
  const n = src.length / 2
  const pts: number[] = []
  for (let k = 0; k < n; k++) {
    const i = fwd ? k : n - 1 - k
    const x = src[i * 2], z = src[i * 2 + 1]
    // direction at this vertex (travel direction)
    const pi = fwd ? Math.max(0, i - 1) : Math.min(n - 1, i + 1)
    const ni = fwd ? Math.min(n - 1, i + 1) : Math.max(0, i - 1)
    let dx = src[ni * 2] - src[pi * 2], dz = src[ni * 2 + 1] - src[pi * 2 + 1]
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    // left of travel = (dz, -dx)
    pts.push(x + dz * offset, z - dx * offset)
  }
  const cum = [0]
  for (let k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]))
  void net
  const hs = edge.h ? (fwd ? edge.h.slice() : edge.h.slice().reverse()) : undefined
  return { edge, fwd, pts, hs, cum, len: cum[cum.length - 1], endNode: fwd ? edge.b : edge.a, startNode: fwd ? edge.a : edge.b }
}

function pointOn(l: Lane, s: number) {
  s = Math.max(0, Math.min(l.len, s))
  let i = 1
  while (i < l.cum.length - 1 && l.cum[i] < s) i++
  const t = (s - l.cum[i - 1]) / Math.max(1e-6, l.cum[i] - l.cum[i - 1])
  const ax = l.pts[(i - 1) * 2], az = l.pts[(i - 1) * 2 + 1], bx = l.pts[i * 2], bz = l.pts[i * 2 + 1]
  const y = l.hs ? l.hs[i - 1] + (l.hs[i] - l.hs[i - 1]) * t : 0
  const dy = l.hs ? l.hs[i] - l.hs[i - 1] : 0
  return { x: ax + (bx - ax) * t, y, z: az + (bz - az) * t, dx: bx - ax, dy, dz: bz - az }
}

export function TrafficSystem({ city }: { city: CityData }) {
  const quality = useGame((s) => s.settings.quality)
  const count = QUALITY[quality].vehicles
  const bodies = useRef<(RapierRigidBody | null)[]>([])
  const net = city.net

  const sim = useMemo(() => {
    const rng = mulberry32(777)
    const drivable = net.edges.filter((e) => e.car && DRIVE.has(e.cls) && e.len > 4)
    const laneCache = new Map<string, Lane>()
    const lane = (e: NetEdge, fwd: boolean) => {
      const k = e.id + (fwd ? 'f' : 'r')
      let l = laneCache.get(k)
      if (!l) {
        const off = e.oneway ? (e.w >= 8 ? (rng() < 0.5 ? -1 : 1) * e.w * 0.2 : 0) : e.w / 4
        l = laneFor(net, e, fwd, off)
        laneCache.set(k, l)
      }
      return l
    }
    const edgeHash = new SpatialHash<NetEdge>(60)
    for (const e of drivable) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (let i = 0; i < e.pts.length; i += 2) {
        x0 = Math.min(x0, e.pts[i]); x1 = Math.max(x1, e.pts[i])
        z0 = Math.min(z0, e.pts[i + 1]); z1 = Math.max(z1, e.pts[i + 1])
      }
      edgeHash.insertBox(e, x0, z0, x1, z1)
    }
    const cars: Car[] = []
    for (let i = 0; i < count; i++) {
      const roll = rng()
      const kind: VehicleKind =
        roll < 0.34 ? 'hatch' : roll < 0.47 ? 'sedan' : roll < 0.57 ? 'suv' : roll < 0.73 ? 'auto' : roll < 0.83 ? 'bike' : roll < 0.89 ? 'scooter' : roll < 0.93 ? 'taxi' : roll < 0.975 ? 'bus' : 'truck'
      const color = kind === 'bus' ? pick(rng, ['#c0392b', '#2f8a4c', '#d35400']) : kind === 'truck' ? pick(rng, ['#1f4e8c', '#c0392b', '#d98b2b']) : pick(rng, CAR_COLORS)
      const D = VEHICLE_DIMS[kind]
      let rider: THREE.BufferGeometry | null = null
      if (kind === 'auto' || kind === 'bike' || kind === 'scooter') {
        const rb = new GeoBuilder()
        seatedRider(rb, 0, 0, 0, kind === 'auto' ? 0.55 : -0.15, kind === 'auto' ? 0.55 : 0.6, pick(rng, ['#f2f2ee', '#c9b48a', '#2e86de', '#c0392b', '#444']), pick(rng, ['#8d5a3b', '#a8714c', '#6f4430']))
        if (kind !== 'auto') rb.prim('sphere', 0, 1.42, -0.15, 0.27, 0.27, 0.29, pick(rng, ['#111', '#c0392b', '#f1f1f1']))
        rider = rb.build()
      }
      cars.push({
        slot: i, active: false, lane: null, next: null, s: 0, speed: 0, cruise: 10, kind, w: D.w, l: D.l, x: 0, y: 0, z: -9999, yaw: 0, pitch: 0,
        blocked: 0, ignoreCross: 0, pub: { x: 0, z: -9999, yaw: 0, speed: 0, kind, honkCooldown: rng() * 10 }, rider, color,
      })
    }
    runtime.vehicles = cars.map((c) => c.pub)
    return { rng, drivable, lane, edgeHash, cars, spawnTick: 0 }
  }, [net, count])

  /** choose the onward lane at a junction */
  const chooseNext = (cur: Lane): Lane | null => {
    const node = cur.endNode
    const opts: { l: Lane; w: number }[] = []
    const ex = cur.pts[cur.pts.length - 2] - cur.pts[cur.pts.length - 4]
    const ez = cur.pts[cur.pts.length - 1] - cur.pts[cur.pts.length - 3]
    const el = Math.hypot(ex, ez) || 1
    for (const ei of net.inc[node]) {
      const e = net.edges[ei]
      if (!e.car || !DRIVE.has(e.cls) || e.len < 2) continue
      for (const fwd of [true, false]) {
        if ((fwd ? e.a : e.b) !== node) continue
        if (e.oneway && !fwd) continue
        if (e.id === cur.edge.id && fwd !== cur.fwd) continue // no U-turn on the same edge
        const l = sim.lane(e, fwd)
        const dx = l.pts[2] - l.pts[0], dz = l.pts[3] - l.pts[1]
        const dl = Math.hypot(dx, dz) || 1
        const straight = (dx * ex + dz * ez) / (dl * el)
        if (straight < -0.6) continue
        const classW = e.w / 10
        opts.push({ l, w: Math.max(0.05, 1 + straight * 1.6) * classW })
      }
    }
    if (!opts.length) {
      // dead end: U-turn
      return cur.edge.oneway ? null : sim.lane(cur.edge, !cur.fwd)
    }
    let r = sim.rng() * opts.reduce((a, o) => a + o.w, 0)
    for (const o of opts) if ((r -= o.w) <= 0) return o.l
    return opts[opts.length - 1].l
  }

  const spawn = (c: Car, minR: number, maxR: number) => {
    const P = runtime.player.pos
    for (let tries = 0; tries < 30; tries++) {
      const a = sim.rng() * Math.PI * 2
      const r = minR + sim.rng() * (maxR - minR)
      const x = P.x + Math.sin(a) * r, z = P.z + Math.cos(a) * r
      const cand = [...sim.edgeHash.query(x - 40, z - 40, x + 40, z + 40)]
      if (!cand.length) continue
      const e = cand[Math.floor(sim.rng() * cand.length)]
      const fwd = e.oneway ? true : sim.rng() < 0.5
      const l = sim.lane(e, fwd)
      const s = sim.rng() * l.len
      const p = pointOn(l, s)
      if (Math.hypot(p.x - P.x, p.z - P.z) < minR * 0.8) continue
      // keep spacing
      if (sim.cars.some((o) => o.active && Math.hypot(o.x - p.x, o.z - p.z) < 12)) continue
      c.active = true
      c.lane = l
      c.next = null
      c.s = s
      c.cruise = (SPEED[e.cls.replace('_link', '')] ?? 8) * (c.kind === 'bus' || c.kind === 'truck' ? 0.8 : c.kind === 'bike' || c.kind === 'scooter' ? 1.1 : 0.85 + sim.rng() * 0.3)
      c.speed = c.cruise * 0.6
      c.x = p.x
      c.y = p.y
      c.z = p.z
      c.yaw = Math.atan2(p.dx, p.dz)
      c.blocked = 0
      return true
    }
    return false
  }

  const tmpQ = useMemo(() => new THREE.Quaternion(), [])
  const tmpE = useMemo(() => new THREE.Euler(), [])

  useFrame((_, rawDt) => {
    const g = useGame.getState()
    const paused = g.panel !== null && g.panel !== 'info'
    const dt = paused ? 0 : Math.min(rawDt, 0.05)
    const t = runtime.time.elapsed
    const P = runtime.player.pos
    const npcs = runtime.npcs
    const SPAWN_MIN = 90, SPAWN_MAX = 300, DESPAWN = 380

    // population management: hourly traffic curve (rush hours busiest, night thin)
    const h = Math.floor(runtime.time.minutes / 60) % 24
    const target = Math.round(sim.cars.length * TRAFFIC_HOURLY[h])
    let activeN = sim.cars.reduce((n, c) => n + (c.active ? 1 : 0), 0)
    let budget = 3
    for (const c of sim.cars) {
      const d = Math.hypot(c.x - P.x, c.z - P.z)
      if (c.active && (d > DESPAWN || (activeN > target + 2 && d > 160))) {
        c.active = false
        activeN--
      }
      if (!c.active && budget > 0 && activeN < target) {
        activeN++
        budget--
        spawn(c, sim.cars.every((o) => !o.active) ? 15 : SPAWN_MIN, SPAWN_MAX)
      }
    }

    const cars = sim.cars
    // the runtime may have been reset after this system was created (city load) — re-publish
    if (runtime.vehicles.length !== cars.length || runtime.vehicles[0] !== cars[0]?.pub) runtime.vehicles = cars.map((c) => c.pub)
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      const body = bodies.current[i]
      if (!c.active || !c.lane) {
        c.pub.x = 0
        c.pub.z = -99999
        if (body) body.setNextKinematicTranslation({ x: c.slot * 4, y: -60, z: 0 })
        continue
      }
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw)
      let gap = 60
      let blockedByCrossing = false
      let blockedByPerson = false
      for (let j = 0; j < cars.length; j++) {
        if (j === i) continue
        const o = cars[j]
        if (!o.active) continue
        const rx = o.x - c.x, rz = o.z - c.z
        if (Math.abs(rx) > 40 || Math.abs(rz) > 40 || Math.abs(o.y - c.y) > 3) continue
        const along = rx * fx + rz * fz
        if (along <= 0 || along > 40) continue
        const lat = Math.abs(rx * fz - rz * fx)
        if (lat > (c.w + o.w) / 2 + 0.4) continue
        const same = Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz > 0.5
        if (!same && c.ignoreCross > 0) continue
        const d = along - (c.l + o.l) / 2
        if (d < gap) {
          gap = d
          blockedByCrossing = !same
        }
      }
      const people = (x: number, z: number, isPlayer: boolean, y = 0) => {
        if (Math.abs(y - c.y) > 3) return
        const rx = x - c.x, rz = z - c.z
        const along = rx * fx + rz * fz
        if (along <= 0 || along > 22) return
        const lat = Math.abs(rx * fz - rz * fx)
        const pv = isPlayer && runtime.drive.active ? VEHICLE_DIMS[runtime.drive.kind] : null
        if (lat > c.w / 2 + (pv ? pv.w / 2 + 0.4 : isPlayer ? 1.1 : 0.7)) return
        const d = along - c.l / 2 - (pv ? pv.l / 2 + 0.6 : 0.8)
        if (d < gap) {
          gap = d
          blockedByPerson = true
          blockedByCrossing = false
        }
      }
      people(P.x, P.z, true, P.y)
      for (const n of npcs) if (Math.abs(n.x - c.x) < 25 && Math.abs(n.z - c.z) < 25) people(n.x, n.z, false)

      // signal at the end of this lane (only when entering the junction)
      const ln = c.lane
      const sigId = net.nodeSignal[ln.endNode]
      if (sigId >= 0 && net.nodeSignal[ln.startNode] !== sigId) {
        const toEnd = ln.len - c.s - c.l / 2
        if (toEnd > -1 && toEnd < 45) {
          const sig = city.signals[sigId]
          const end = pointOn(ln, ln.len)
          const light = signalLight(sig, axisOf(sig, end.dx, end.dz), t)
          if (light === 'r' || (light === 'y' && toEnd > 6)) {
            if (toEnd - 1 < gap) {
              gap = Math.max(0, toEnd - 1)
              blockedByCrossing = false
              blockedByPerson = false
            }
          }
        }
      }
      // slow down for tight turns at the end of the lane
      if (!c.next) c.next = chooseNext(ln)
      if (c.next) {
        const a = pointOn(ln, ln.len), b = pointOn(c.next, 0.1)
        const turn = 1 - (a.dx * b.dx + a.dz * b.dz) / ((Math.hypot(a.dx, a.dz) || 1) * (Math.hypot(b.dx, b.dz) || 1))
        const remain = ln.len - c.s
        if (turn > 0.3 && remain < 25) gap = Math.min(gap, remain + 4 + (1 - turn) * 10)
      }

      const safe = Math.max(0, gap - 2.2)
      const target = Math.min(c.cruise, safe * 0.85 + (gap > 20 ? 3 : 0))
      const accel = target > c.speed ? 2.4 : 7.5
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), accel * dt)
      if (gap < 0.6) c.speed = 0
      c.ignoreCross -= dt
      if (c.speed < 0.2 && dt > 0) {
        c.blocked += dt
        if (blockedByCrossing && c.blocked > 4) {
          c.ignoreCross = 3
          c.blocked = 0
        }
      } else c.blocked = 0
      c.pub.honkCooldown -= dt
      if (c.pub.honkCooldown <= 0 && ((blockedByPerson && c.blocked > 1.0) || (c.blocked > 3 && Math.random() < 0.02) || Math.random() < 0.0006)) {
        c.pub.honkCooldown = 3 + Math.random() * 6
        audio.horn(c.x, c.z, c.kind)
      }
      // advance along the lane, hopping to the next lane at the junction
      c.s += c.speed * dt
      while (c.lane && c.s > c.lane.len) {
        const over = c.s - c.lane.len
        const nx: Lane | null = c.next ?? chooseNext(c.lane)
        if (!nx) {
          c.active = false
          break
        }
        c.lane = nx
        c.next = null
        c.s = over
      }
      if (!c.active || !c.lane) continue
      const p = pointOn(c.lane, c.s)
      // look-ahead point (may be on the next lane) for smooth turning
      let lx: number, lz: number
      const ahead = c.s + Math.max(3, c.l * 0.7)
      if (ahead <= c.lane.len || !c.next) {
        const q = pointOn(c.lane, ahead)
        lx = q.x
        lz = q.z
      } else {
        const q = pointOn(c.next, ahead - c.lane.len)
        lx = q.x
        lz = q.z
      }
      // ease position across junction gaps
      const jump = Math.hypot(p.x - c.x, p.z - c.z)
      const k = jump > 12 ? 1 : Math.min(1, dt * 10)
      c.x += (p.x - c.x) * k
      c.y += (p.y - c.y) * k
      c.z += (p.z - c.z) * k
      const seg = Math.hypot(p.dx, p.dz)
      c.pitch += ((seg > 0.01 ? -Math.atan2(p.dy, seg) : 0) - c.pitch) * Math.min(1, dt * 6)
      c.yaw = dampAngle(c.yaw, Math.atan2(lx - c.x, lz - c.z), 6, Math.max(dt, 0.0001))
      c.pub.x = c.x
      c.pub.y = c.y
      c.pub.z = c.z
      c.pub.yaw = c.yaw
      c.pub.speed = c.speed
      if (body) {
        body.setNextKinematicTranslation({ x: c.x, y: c.y + 0.03, z: c.z })
        tmpQ.setFromEuler(tmpE.set(c.pitch, c.yaw, 0, 'YXZ'))
        body.setNextKinematicRotation(tmpQ)
      }
    }
    runtime.stats.vehicles = cars.filter((c) => c.active).length
  })

  const m = materials()
  return (
    <>
      {sim.cars.map((c, i) => {
        const tpl = vehicleTemplate(c.kind, c.color)
        const D = VEHICLE_DIMS[c.kind]
        return (
          <RigidBody
            key={i}
            ref={(r) => {
              bodies.current[i] = r
            }}
            type="kinematicPosition"
            colliders={false}
            position={[i * 4, -60, 0]}
          >
            <CuboidCollider args={[D.w / 2, D.h / 2, D.l / 2]} position={[0, D.h / 2, 0]} />
            <mesh geometry={tpl.body} material={m.vehicle} castShadow />
            <mesh geometry={tpl.glow} material={m.glow} />
            {c.rider && <mesh geometry={c.rider} material={m.props} castShadow />}
          </RigidBody>
        )
      })}
    </>
  )
}
