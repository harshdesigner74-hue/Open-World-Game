import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { QUALITY, useGame } from '../state/store'
import { pedestrianMayCross } from '../traffic/signals'
import { SpatialHash, clamp, dampAngle, mulberry32, pick } from '../utils/math'
import type { CityData } from '../world/types'
import { signalPoles } from '../world/chunkBuilder'
import { BUMP, chatterLine, lineFor, vendorCall, type NPCKind } from './dialogue'
import { weather } from '../env/weather'
import { PART, PART_COUNT, faceTexture, hideBody, makeAppearance, newPose, partGeometries, writeBody, type Appearance, type Pose } from './humanBody'

/**
 * Pedestrian simulation.
 *  - Walkers follow the pavement graph with individual routines: commuting, window-shopping
 *    pauses, phone checks, waiting for the green man at signals, sidestepping each other & you.
 *  - Anchored NPCs: vendors behind stalls, customers sipping chai, people on benches,
 *    traffic police at junctions, security guards at office doors.
 *  - Spawned around the player and recycled when far away (density depends on district,
 *    time of day and the quality setting).
 */

type State = 'walk' | 'wait' | 'pause' | 'phone' | 'talk' | 'stand' | 'sit' | 'vendor' | 'police'

interface NPC {
  active: boolean
  anchored: boolean
  kind: NPCKind
  ap: Appearance
  pose: Pose
  x: number
  z: number
  y: number
  yaw: number
  homeYaw: number
  speed: number
  baseSpeed: number
  lane: number
  from: number
  to: number
  prev: number
  state: State
  timer: number
  phase: number
  talkCooldown: number
  anchorId: number
  look: number
  seed: number
  umbrella: boolean
}

interface Anchor {
  id: number
  x: number
  z: number
  yaw: number
  kind: NPCKind
  state: State
  active: boolean
  slots: number[]
}

const MAX_ANCHORED = 80
/** share of the pedestrian budget out on the street, by hour of day */
const HOURLY = [0.15, 0.1, 0.07, 0.07, 0.1, 0.22, 0.45, 0.75, 1, 1, 0.9, 0.85, 0.9, 0.85, 0.8, 0.85, 0.95, 1, 1, 0.95, 0.85, 0.7, 0.45, 0.28]
/** working hours of anchored NPCs (vendors set up & pack up, police shifts, people on benches...) */
function onDuty(a: { state: string; kind: string }, h: number) {
  if (a.kind === 'guard') return true
  if (a.state === 'vendor') return h >= 6.5 && h < 23.5
  if (a.state === 'police') return h >= 8 && h < 22
  if (a.state === 'sit') return h >= 6 && h < 22
  return h >= 7 && h < 23
}

/** Public API used by the interaction system. */
export const npcApi = {
  nearest: (_x: number, _z: number, _r: number): number => -1,
  talk: (_id: number): string | null => null,
  position: (_id: number): { x: number; z: number } | null => null,
}

export function NPCSystem({ city }: { city: CityData }) {
  const quality = useGame((s) => s.settings.quality)
  const Q = QUALITY[quality]
  const capacity = QUALITY.high.npcs + MAX_ANCHORED
  const camera = useThree((s) => s.camera)

  const geos = useMemo(() => partGeometries(), [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.82 }), [])
  // heads get the face texture (white = skin, tinted per instance)
  const headMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.6, map: faceTexture() }), [])
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([])

  const sim = useMemo(() => {
    const rng = mulberry32(4242)
    const g = city.graph
    const nodeHash = new SpatialHash<number>(25)
    for (let i = 0; i < g.x.length; i++) nodeHash.insertPoint(i, g.x[i], g.z[i])
    // anchors
    const anchors: Anchor[] = []
    const push = (x: number, z: number, yaw: number, kind: NPCKind, state: State) =>
      anchors.push({ id: anchors.length, x, z, yaw, kind, state, active: false, slots: [] })
    for (const it of city.interactables) {
      const px = (it.data?.propX as number) ?? it.x
      const pz = (it.data?.propZ as number) ?? it.z
      const fx = Math.sin(it.rot),
        fz = Math.cos(it.rot)
      if (it.type === 'tea' || it.type === 'food' || it.type === 'fruit' || it.type === 'pan') {
        const back = it.type === 'pan' ? 0.25 : 0.95
        push(px - fx * back, pz - fz * back, it.rot, 'vendor', 'vendor')
        const customers = rng() < 0.55 ? (rng() < 0.4 ? 2 : 1) : 0
        for (let k = 0; k < customers; k++) {
          const side = k === 0 ? -0.6 : 0.65
          const rx = -Math.cos(it.rot),
            rz = Math.sin(it.rot)
          push(it.x + fx * 0.6 + rx * side, it.z + fz * 0.6 + rz * side, it.rot + Math.PI + (rng() - 0.5) * 0.6, pick(rng, ['office', 'student', 'shopper', 'delivery', 'elderly'] as NPCKind[]), 'stand')
        }
      } else if (it.type === 'bench' && rng() < 0.38) {
        const rx = -Math.cos(it.rot),
          rz = Math.sin(it.rot)
        push(px + rx * 0.5 + fx * 0.05, pz + rz * 0.5 + fz * 0.05, it.rot, pick(rng, ['elderly', 'shopper', 'student', 'office', 'tourist'] as NPCKind[]), 'sit')
      }
    }
    for (const s of city.signals) {
      if (rng() < 0.45) {
        const pole = signalPoles(s)[0]
        const px = pole.x + (pole.x - s.x) * 0.08, pz = pole.z + (pole.z - s.z) * 0.08
        push(px, pz, Math.atan2(s.x - px, s.z - pz), 'police', 'police')
      }
    }
    for (const b of city.buildings) {
      if (b.style !== 'office' || rng() > 0.35) continue
      const fx = Math.sin(b.rot),
        fz = Math.cos(b.rot)
      push(b.x + fx * (b.d / 2 + 1.2), b.z + fz * (b.d / 2 + 1.2), b.rot, 'guard', 'stand')
    }
    // chatting pairs on busy pavements
    for (let i = 0; i < g.x.length; i += 37) {
      if (g.density[i] < 0.9 || rng() > 0.3) continue
      const a = rng() * Math.PI * 2
      push(g.x[i] + Math.sin(a) * 0.55, g.z[i] + Math.cos(a) * 0.55, a + Math.PI, pick(rng, ['office', 'student', 'shopper', 'tourist'] as NPCKind[]), 'talk')
      push(g.x[i] - Math.sin(a) * 0.55, g.z[i] - Math.cos(a) * 0.55, a, pick(rng, ['office', 'student', 'shopper', 'family'] as NPCKind[]), 'talk')
    }
    const anchorHash = new SpatialHash<Anchor>(40)
    for (const a of anchors) anchorHash.insertPoint(a, a.x, a.z)
    const npcs: NPC[] = Array.from({ length: capacity }, (_, i) => ({
      active: false, anchored: false, kind: 'office' as NPCKind, ap: makeAppearance('office', i), pose: newPose(),
      x: 0, z: 0, y: 0, yaw: 0, homeYaw: 0, speed: 0, baseSpeed: 1.3, lane: 0, from: 0, to: 0, prev: -1,
      state: 'walk' as State, timer: 0, phase: 0, talkCooldown: 0, anchorId: -1, look: 0, seed: i, umbrella: false,
    }))
    return { rng, nodeHash, anchors, anchorHash, npcs, crowd: new SpatialHash<number>(3), spawnTick: 0, anchorTick: 0, bumpCooldown: 0, seedCounter: 1000, chatCooldown: 3 }
  }, [city, capacity])

  // instance colours are (re)written when an NPC spawns
  const setColors = (i: number, ap: Appearance) => {
    const ms = meshRefs.current
    for (let p = 0; p < PART_COUNT; p++) ms[p]?.setColorAt(i, ap.colors[p])
  }

  useEffect(() => {
    const ms = meshRefs.current as THREE.InstancedMesh[]
    for (let i = 0; i < capacity; i++) hideBody(ms, i)
    for (const m of ms) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.instanceMatrix.needsUpdate = true
      m.setColorAt(0, new THREE.Color('#888'))
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }, [capacity])

  // expose API
  useEffect(() => {
    npcApi.nearest = (x, z, r) => {
      let best = -1,
        bd = r
      for (let i = 0; i < sim.npcs.length; i++) {
        const n = sim.npcs[i]
        if (!n.active || n.state === 'sit') continue
        const d = Math.hypot(n.x - x, n.z - z)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return best
    }
    npcApi.talk = (id) => {
      const n = sim.npcs[id]
      if (!n?.active) return null
      const night = runtime.time.daylight < 0.4
      const line = lineFor(n.kind, night, Math.random())
      n.talkCooldown = 6
      if (!n.anchored) {
        n.state = 'talk'
        n.timer = 5
      }
      const p = runtime.player.pos
      n.homeYaw = Math.atan2(p.x - n.x, p.z - n.z)
      runtime.speech = { x: n.x, y: n.y + 2.05 * n.ap.height, z: n.z, text: `${line.hi}\n(${line.en})`, until: runtime.time.elapsed + 5 }
      return line.hi
    }
    npcApi.position = (id) => (sim.npcs[id]?.active ? { x: sim.npcs[id].x, z: sim.npcs[id].z } : null)
  }, [sim])

  const spawnWalker = (i: number, node: number) => {
    const n = sim.npcs[i]
    const r = sim.rng
    const d = city.districtAt(city.graph.x[node], city.graph.z[node])
    const kinds: NPCKind[] =
      d === 'office' ? ['office', 'office', 'office', 'delivery', 'shopper', 'student']
        : d === 'vista' ? ['tourist', 'tourist', 'family', 'family', 'student', 'elderly', 'shopper']
          : d === 'residential' ? ['shopper', 'elderly', 'student', 'family', 'delivery', 'office']
            : ['shopper', 'shopper', 'office', 'student', 'tourist', 'delivery', 'family', 'elderly']
    const h = runtime.time.minutes / 60
    const rush = (h >= 7.5 && h < 10.5) || (h >= 17 && h < 20)
    const evening = h >= 18 && h < 23
    n.kind = pick(r, [...kinds, ...(rush ? (['office', 'office', 'office', 'student'] as NPCKind[]) : []), ...(evening ? (['family', 'family', 'shopper'] as NPCKind[]) : [])])
    n.ap = makeAppearance(n.kind, sim.seedCounter++)
    n.active = true
    n.anchored = false
    n.x = city.graph.x[node]
    n.z = city.graph.z[node]
    n.y = city.graph.y[node]
    const adj = city.graph.adj[node]
    n.from = node
    n.prev = -1
    n.to = adj.length ? pick(r, adj) : node
    n.baseSpeed = (n.ap.elderly ? 0.85 : n.kind === 'delivery' ? 1.65 : 1.15) + r() * 0.35 + (rush && n.kind === 'office' ? 0.25 : 0)
    n.umbrella = r() < 0.65
    n.speed = n.baseSpeed
    n.lane = (r() - 0.5) * 2.2
    n.state = 'walk'
    n.timer = 0
    n.phase = r() * 10
    n.yaw = Math.atan2(city.graph.x[n.to] - n.x, city.graph.z[n.to] - n.z)
    n.talkCooldown = 0
    n.pose = newPose()
    setColors(i, n.ap)
  }

  const spawnAnchored = (i: number, a: Anchor) => {
    const n = sim.npcs[i]
    n.kind = a.kind
    n.ap = makeAppearance(a.kind, a.id * 7919 + 13)
    n.active = true
    n.anchored = true
    n.anchorId = a.id
    n.x = a.x
    n.z = a.z
    n.y = 0.09
    n.yaw = n.homeYaw = a.yaw
    n.state = a.state
    n.speed = 0
    n.phase = Math.random() * 10
    n.timer = Math.random() * 5
    n.pose = newPose()
    setColors(i, n.ap)
  }

  const tmpSet = useMemo(() => new Set<number>(), [])

  useFrame((_, rawDt) => {
    const ms = meshRefs.current as THREE.InstancedMesh[]
    if (ms.length < PART_COUNT || ms.some((m) => !m)) return
    const g = useGame.getState()
    const paused = g.panel !== null && g.panel !== 'info'
    const dt = paused ? 0 : Math.min(rawDt, 0.05)
    const P = runtime.player.pos
    const t = runtime.time.elapsed
    const graph = city.graph
    const night = 1 - runtime.time.daylight
    const hour = runtime.time.minutes / 60
    // daily rhythm: morning & evening rush, quiet nights, fewer people out in the rain
    const target = Math.round(Q.npcs * HOURLY[Math.floor(hour) % 24] * (1 - weather.rain * 0.45))
    const SPAWN_R = 115,
      DESPAWN_R = 140
    sim.bumpCooldown -= dt

    /* ---------------------- anchors (every 0.5 s) ---------------------- */
    sim.anchorTick -= rawDt
    if (sim.anchorTick <= 0) {
      sim.anchorTick = 0.5
      for (const a of sim.anchors) {
        const d = Math.hypot(a.x - P.x, a.z - P.z)
        if (a.active && (d > DESPAWN_R || !onDuty(a, hour))) {
          for (const s of a.slots) {
            sim.npcs[s].active = false
            hideBody(ms, s)
          }
          a.slots = []
          a.active = false
        }
      }
      tmpSet.clear()
      for (const a of sim.anchorHash.query(P.x - SPAWN_R, P.z - SPAWN_R, P.x + SPAWN_R, P.z + SPAWN_R)) {
        if (a.active || Math.hypot(a.x - P.x, a.z - P.z) > SPAWN_R) continue
        if (!onDuty(a, hour)) continue
        const slot = sim.npcs.findIndex((n, i) => !n.active && i >= QUALITY.high.npcs)
        if (slot < 0) break
        a.active = true
        a.slots = [slot]
        spawnAnchored(slot, a)
      }
    }

    /* ---------------------- walker population ---------------------- */
    let active = 0
    for (let i = 0; i < QUALITY.high.npcs; i++) {
      const n = sim.npcs[i]
      if (!n.active) continue
      if (Math.hypot(n.x - P.x, n.z - P.z) > DESPAWN_R || i >= Q.npcs) {
        n.active = false
        hideBody(ms, i)
        continue
      }
      active++
    }
    const camDir = new THREE.Vector3()
    camera.getWorldDirection(camDir)
    let spawns = active < target ? 6 : 0
    let tries = 0
    while (spawns > 0 && tries++ < 40) {
      const ang = Math.random() * Math.PI * 2
      const r = active < target * 0.5 ? 8 + Math.random() * (SPAWN_R - 8) : 45 + Math.random() * (SPAWN_R - 45)
      const cx = P.x + Math.sin(ang) * r,
        cz = P.z + Math.cos(ang) * r
      const cand = [...sim.nodeHash.query(cx - 12, cz - 12, cx + 12, cz + 12)]
      if (!cand.length) continue
      const node = cand[Math.floor(Math.random() * cand.length)]
      if (Math.random() > graph.density[node]) continue
      // avoid popping in right in front of the camera
      const dx = graph.x[node] - camera.position.x,
        dz = graph.z[node] - camera.position.z
      const dd = Math.hypot(dx, dz)
      if (active > 10 && dd < 70 && (dx * camDir.x + dz * camDir.z) / dd > 0.35) continue
      const slot = sim.npcs.findIndex((n, i) => !n.active && i < Q.npcs)
      if (slot < 0) break
      spawnWalker(slot, node)
      active++
      spawns--
    }

    /* ---------------------- crowd hash for avoidance ---------------------- */
    sim.crowd.clear()
    const list = sim.npcs
    for (let i = 0; i < list.length; i++) if (list[i].active) sim.crowd.insertPoint(i, list[i].x, list[i].z)

    /* ---------------------- overheard chatter & vendor calls ---------------------- */
    sim.chatCooldown -= dt
    if (sim.chatCooldown <= 0 && !(runtime.speech && runtime.speech.until > t)) {
      sim.chatCooldown = 2
      let best = -1,
        bd = 8
      for (const j of sim.crowd.query(P.x - 8, P.z - 8, P.x + 8, P.z + 8)) {
        const o = sim.npcs[j]
        if (!o.anchored || (o.state !== 'talk' && o.state !== 'stand' && o.state !== 'vendor')) continue
        const d = Math.hypot(o.x - P.x, o.z - P.z)
        if (d < bd) {
          bd = d
          best = j
        }
      }
      if (best >= 0 && Math.random() < 0.55) {
        const o = sim.npcs[best]
        const l = o.state === 'vendor' ? vendorCall(Math.random()) : chatterLine(weather.rain > 0.3, night > 0.6, Math.random())
        runtime.speech = { x: o.x, y: o.y + 2.05 * o.ap.height, z: o.z, text: `${l.hi}\n(${l.en})`, until: t + 3.5 }
        sim.chatCooldown = 6 + Math.random() * 6
      }
    }

    /* ---------------------- simulate + pose ---------------------- */
    const pub = runtime.npcs
    let pubN = 0
    let count = 0
    const playerSpeed = runtime.player.speed
    for (let i = 0; i < list.length; i++) {
      const n = list[i]
      if (!n.active) continue
      count++
      n.talkCooldown -= dt
      const pd = Math.hypot(P.x - n.x, P.z - n.z)
      // react to the player: glance, step aside, complain when bumped
      const lookAtPlayer = pd < 4 && n.state !== 'sit'
      if (pd < 0.75 && dt > 0) {
        const push = (0.75 - pd) * 0.6
        n.x += ((n.x - P.x) / (pd || 1)) * push
        n.z += ((n.z - P.z) / (pd || 1)) * push
        if (playerSpeed > 4.5 && sim.bumpCooldown <= 0) {
          sim.bumpCooldown = 4
          const l = BUMP[Math.floor(Math.random() * BUMP.length)]
          runtime.speech = { x: n.x, y: n.y + 2.05 * n.ap.height, z: n.z, text: `${l.hi}\n(${l.en})`, until: t + 3 }
          if (!n.anchored) {
            n.state = 'pause'
            n.timer = 1.2
          }
        }
      }

      // jump out of the way of the player's vehicle
      const DV = runtime.drive
      if (DV.active && Math.abs(DV.speed) > 2 && pd < 12 && dt > 0) {
        const fx = Math.sin(DV.yaw) * Math.sign(DV.speed), fz = Math.cos(DV.yaw) * Math.sign(DV.speed)
        const rx = n.x - DV.x, rz = n.z - DV.z
        const along = rx * fx + rz * fz
        const lat = rx * fz - rz * fx
        if (along > -1 && along < 3 + Math.abs(DV.speed) * 0.6 && Math.abs(lat) < 2.4) {
          const away = lat >= 0 ? 1 : -1
          n.x += fz * away * 4.5 * dt
          n.z += -fx * away * 4.5 * dt
          if (sim.bumpCooldown <= 0 && Math.abs(DV.speed) > 6) {
            sim.bumpCooldown = 5
            const l = BUMP[Math.floor(Math.random() * BUMP.length)]
            runtime.speech = { x: n.x, y: n.y + 2.05 * n.ap.height, z: n.z, text: `${l.hi}\n(${l.en})`, until: t + 3 }
          }
        }
      }
      if (!n.anchored) stepWalker(n, dt, t, pd)
      else if (n.state === 'talk' || n.state === 'stand' || n.state === 'vendor' || n.state === 'police') {
        n.yaw = dampAngle(n.yaw, lookAtPlayer && n.talkCooldown > 0 ? Math.atan2(P.x - n.x, P.z - n.z) : n.homeYaw, 3, dt)
      }

      // pose
      const p = n.pose
      const walking = n.state === 'walk' && n.speed > 0.1
      n.phase += walking ? dt * Math.PI * (1.2 + n.speed * 0.55) : 0
      const s = Math.sin(n.phase)
      const amp = walking ? (n.ap.elderly ? 0.28 : 0.42) * Math.min(1.4, n.speed / 1.3) : 0
      p.thighL = -s * amp
      p.thighR = s * amp
      p.kneeL = walking ? 0.06 + Math.max(0, Math.sin(n.phase + 0.9)) * 0.7 * amp * 2 : 0.02
      p.kneeR = walking ? 0.06 + Math.max(0, Math.sin(n.phase + 0.9 + Math.PI)) * 0.7 * amp * 2 : 0.02
      p.armL = s * amp * 0.8
      p.armR = -s * amp * 0.8
      p.armZL = 0.07
      p.armZR = -0.07
      p.elbowL = p.elbowR = -0.15 - amp * 0.3
      p.lean = walking ? 0.04 : Math.sin(t * 1.3 + i) * 0.01
      p.twist = s * amp * 0.15
      p.hipsY = 0.93 + (walking ? Math.cos(n.phase * 2) * 0.012 : 0)
      p.phone = false
      p.umbrella = !n.anchored && n.umbrella && weather.rain > 0.25
      if (p.umbrella) {
        p.armR = -0.55
        p.elbowR = -1.25
        n.baseSpeed = Math.max(n.baseSpeed, 1.35)
      }
      p.headPitch = 0
      const wantLook = lookAtPlayer ? clamp(((Math.atan2(P.x - n.x, P.z - n.z) - n.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1.1, 1.1) : 0
      n.look += (wantLook - n.look) * Math.min(1, dt * 4)
      p.headYaw = n.look
      switch (n.state) {
        case 'phone':
          p.phone = true
          p.armR = -0.35
          p.elbowR = -1.45
          p.armL = -0.3
          p.elbowL = -1.3
          p.armZR = 0.12
          p.armZL = -0.12
          p.headPitch = 0.45
          break
        case 'talk': {
          const k = Math.sin(t * 2.2 + i * 1.7)
          p.armR = -0.2 + k * 0.25
          p.elbowR = -0.9 - Math.max(0, k) * 0.5
          p.armL = 0.05
          break
        }
        case 'sit':
          p.thighL = p.thighR = -1.5
          p.kneeL = p.kneeR = 1.5
          p.hipsY = 0.53
          p.armL = p.armR = -0.4
          p.elbowL = p.elbowR = -0.55
          p.lean = -0.05
          break
        case 'vendor': {
          const call = Math.sin(t * 0.7 + i) > 0.85
          p.armL = p.armR = -0.45
          p.elbowL = p.elbowR = -0.8
          if (call) {
            p.armR = -2.4
            p.elbowR = -0.4 + Math.sin(t * 8) * 0.3
          }
          p.lean = 0.12
          break
        }
        case 'police': {
          const wave = Math.sin(t * 0.5 + i) > 0.4
          if (wave) {
            p.armR = -1.55
            p.armZR = -0.2
            p.elbowR = Math.sin(t * 5) * 0.6 - 0.3
          }
          break
        }
        case 'stand':
          if (n.kind !== 'guard') {
            // sipping chai
            p.armR = -0.3
            p.elbowR = -1.9 + Math.max(0, Math.sin(t * 0.6 + i)) * 0.3
          } else {
            p.armL = p.armR = 0.15
            p.elbowL = p.elbowR = -0.2
          }
          break
      }
      writeBody(ms, i, n.x, n.y, n.z, n.yaw, n.ap, p)
      if (!n.anchored) {
        let o = pub[pubN]
        if (!o) o = pub[pubN] = { x: 0, z: 0, yaw: 0, talking: 0 }
        o.x = n.x
        o.z = n.z
        o.yaw = n.yaw
        pubN++
      }
    }
    pub.length = pubN
    runtime.stats.npcs = count
    for (const m of ms) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    void night
  })

  /** Walker routine: follow the graph, obey pedestrian signals, pause, avoid. */
  function stepWalker(n: NPC, dt: number, t: number, playerDist: number) {
    const g = city.graph
    if (n.state === 'talk' || n.state === 'pause' || n.state === 'phone') {
      n.timer -= dt
      n.speed = 0
      if (n.state === 'talk') {
        const p = runtime.player.pos
        n.yaw = dampAngle(n.yaw, Math.atan2(p.x - n.x, p.z - n.z), 5, dt)
      }
      if (n.timer <= 0) n.state = 'walk'
      return
    }
    if (n.state === 'wait') {
      const meta = g.edges.get(n.from < n.to ? `${n.from}_${n.to}` : `${n.to}_${n.from}`)
      const sig = meta?.signal !== undefined ? city.signals[meta.signal] : undefined
      n.speed = 0
      if (!sig || pedestrianMayCross(sig, meta!.axis ?? 0, t)) n.state = 'walk'
      else return
    }
    // target point with a per-NPC lateral lane offset
    const ax = g.x[n.from],
      az = g.z[n.from]
    const bx = g.x[n.to],
      bz = g.z[n.to]
    const ex = bx - ax,
      ez = bz - az
    const el = Math.hypot(ex, ez) || 1
    const meta = g.edges.get(n.from < n.to ? `${n.from}_${n.to}` : `${n.to}_${n.from}`)
    const crossing = meta?.cross !== undefined
    const lane = crossing ? clamp(n.lane, -0.8, 0.8) : g.y[n.to] < 0.07 ? n.lane * 0.4 : n.lane
    const tx = bx + (ez / el) * lane,
      tz = bz - (ex / el) * lane
    let dx = tx - n.x,
      dz = tz - n.z
    const d = Math.hypot(dx, dz)
    if (d < 0.5) {
      // arrived: choose next node, preferring to keep going straight
      const adj = g.adj[n.to]
      let next = n.from
      if (adj.length > 1 || (adj.length === 1 && adj[0] !== n.from)) {
        let best = -Infinity
        for (const c of adj) {
          if (c === n.from && adj.length > 1) continue
          const cx = g.x[c] - bx,
            cz = g.z[c] - bz
          const cl = Math.hypot(cx, cz) || 1
          const straight = (cx * ex + cz * ez) / (cl * el)
          const score = straight * 0.8 + Math.random() * 1.3
          if (score > best) {
            best = score
            next = c
          }
        }
      }
      n.prev = n.from
      n.from = n.to
      n.to = next
      n.y = g.y[n.from]
      const nm = g.edges.get(n.from < n.to ? `${n.from}_${n.to}` : `${n.to}_${n.from}`)
      if (nm?.signal !== undefined) {
        const sig = city.signals[nm.signal]
        if (!pedestrianMayCross(sig, nm.axis ?? 0, t)) {
          n.state = 'wait'
          return
        }
      }
      const roll = Math.random()
      if (!nm?.cross && roll < 0.025) {
        n.state = 'phone'
        n.timer = 4 + Math.random() * 7
      } else if (!nm?.cross && roll < 0.05) {
        n.state = 'pause'
        n.timer = 1.5 + Math.random() * 3
      }
      return
    }
    dx /= d
    dz /= d
    // separation from neighbours
    let sx = 0,
      sz = 0
    for (const j of sim.crowd.query(n.x - 1.2, n.z - 1.2, n.x + 1.2, n.z + 1.2)) {
      const o = sim.npcs[j]
      if (o === n) continue
      const ox = n.x - o.x,
        oz = n.z - o.z
      const od = Math.hypot(ox, oz)
      if (od > 0.001 && od < 1.0) {
        const w = (1.0 - od) / od
        sx += ox * w
        sz += oz * w
      }
    }
    const P = runtime.player.pos
    let slow = 1
    if (playerDist < 2.2) {
      const ox = n.x - P.x,
        oz = n.z - P.z
      const ahead = -(ox * dx + oz * dz)
      if (ahead > 0) {
        // player in front: sidestep to the left of travel and slow down
        sx += dz * 1.2
        sz += -dx * 1.2
        slow = 0.55
      }
    }
    const want = n.baseSpeed * slow * (crossing ? 1.25 : 1)
    n.speed += (want - n.speed) * Math.min(1, dt * 3)
    const vx = dx * n.speed + clamp(sx, -1.5, 1.5) * 0.9
    const vz = dz * n.speed + clamp(sz, -1.5, 1.5) * 0.9
    n.x += vx * dt
    n.z += vz * dt
    // height: kerb → road on crossings
    const tt = clamp(1 - d / el, 0, 1)
    n.y = crossing ? (tt > 0.15 && tt < 0.85 ? 0.03 : Math.max(g.y[n.from], g.y[n.to])) : g.y[n.from] + (g.y[n.to] - g.y[n.from]) * tt
    n.yaw = dampAngle(n.yaw, Math.atan2(vx, vz), 7, dt)
  }

  return (
    <>
      {geos.map((geo, i) => (
        <instancedMesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m
          }}
          args={[geo, i === PART.head ? headMat : mat, capacity]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </>
  )
}
