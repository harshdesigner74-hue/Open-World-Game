import { SpatialHash, obbCorners, obbOverlap, pick, rand, randInt, type RNG, clamp } from '../utils/math'
import { SIGN_COLS, SIGN_ROWS } from '../utils/textures'
import { axisOf } from '../traffic/signals'
import { RoadIndex, SIDEWALK_W, SIDEWALK_Y, insideRoad, roadDir } from './roads'
import type {
  Area,
  ArcBuilding,
  Building,
  ChunkContent,
  District,
  Interactable,
  InteractionType,
  PolyBuilding,
  Prop,
  PropType,
  Road,
  RingRoad,
  Signal,
  SidewalkSeg,
  WalkGraph,
} from './types'

/* ------------------------------------------------------------------------------------------------
 * Generic, city-agnostic procedural generation. A city file (e.g. delhi.ts) supplies a road
 * network + zones; everything here turns that into buildings, pavements, props and AI graphs.
 * ---------------------------------------------------------------------------------------------- */

export interface GenContext {
  rng: RNG
  roads: Road[]
  idx: RoadIndex
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  districtAt: (x: number, z: number) => District
  /** true where nothing may be built (parks, water, landmark plazas...) */
  noBuild: (x: number, z: number) => boolean
  /** true where pedestrians may not walk (water...) */
  noWalk: (x: number, z: number) => boolean
  buildings: Building[]
  bHash: SpatialHash<Building>
  props: Prop[]
  pHash: SpatialHash<Prop>
  interactables: Interactable[]
  /** cheap pre-check before full placement sampling */
  quickReject?: (x: number, z: number) => boolean
}

export function createContext(
  seed: RNG,
  roads: Road[],
  bounds: GenContext['bounds'],
  districtAt: GenContext['districtAt'],
  noBuild: GenContext['noBuild'],
  noWalk: GenContext['noWalk'],
): GenContext {
  return {
    rng: seed,
    roads,
    idx: new RoadIndex(roads),
    bounds,
    districtAt,
    noBuild,
    noWalk,
    buildings: [],
    bHash: new SpatialHash<Building>(40),
    props: [],
    pHash: new SpatialHash<Prop>(20),
    interactables: [],
  }
}

/* --------------------------------------- buildings ------------------------------------------- */

const PALETTE = {
  residential: ['#e9dcc2', '#ead48e', '#dca286', '#e6bdb6', '#bcd5b3', '#b4cbe0', '#efebe3', '#d09a74', '#e8c9a0', '#d7d0f0'],
  market: ['#f0d27a', '#e59a7a', '#9fc7e6', '#f1e7d0', '#e7b26d', '#c9e0a5', '#f4c6c6'],
  office: ['#9fb4c4', '#b7c7c0', '#cfc8b8', '#a9b8c9', '#d4d6d8', '#8fa9a0'],
  government: ['#dcb98d', '#cf9a72', '#e6cfa8', '#c9805c'],
}
const ROOFS = ['#8f8a82', '#9b958c', '#7d7974', '#a39d92']

export function buildingSpec(rng: RNG, district: District) {
  switch (district) {
    case 'office': {
      const floors = randInt(rng, 6, 18)
      return {
        w: rand(rng, 20, 34), d: rand(rng, 16, 26), floors, floorH: 3.6, style: 'office' as const,
        color: pick(rng, PALETTE.office), shopFloor: false, tanks: 0, signChance: 0.25,
      }
    }
    case 'government':
      return {
        w: rand(rng, 34, 64), d: rand(rng, 18, 28), floors: randInt(rng, 3, 6), floorH: 4.2, style: 'government' as const,
        color: pick(rng, PALETTE.government), shopFloor: false, tanks: 0, signChance: 0,
      }
    case 'market':
    case 'cp':
      return {
        w: rand(rng, 7, 13), d: rand(rng, 11, 18), floors: randInt(rng, 2, 4), floorH: 3.1, style: 'residential' as const,
        color: pick(rng, PALETTE.market), shopFloor: true, tanks: randInt(rng, 0, 2), signChance: 0.95,
      }
    case 'lutyens':
      return {
        w: rand(rng, 14, 22), d: rand(rng, 12, 18), floors: randInt(rng, 1, 2), floorH: 3.6, style: 'colonial' as const,
        color: pick(rng, ['#f1ece0', '#efe6cf', '#e9e0cc', '#f4efe6']), shopFloor: false, tanks: 0, signChance: 0,
      }
    default: {
      const floors = rng() < 0.12 ? randInt(rng, 6, 9) : randInt(rng, 2, 5)
      return {
        w: rand(rng, 9, 17), d: rand(rng, 10, 18), floors, floorH: 3.1, style: 'residential' as const,
        color: pick(rng, PALETTE.residential), shopFloor: rng() < 0.3, tanks: randInt(rng, 1, 3), signChance: 0.5,
      }
    }
  }
}

function rectSamples(x: number, z: number, w: number, d: number, rot: number, n = 4) {
  const c = Math.cos(rot),
    s = Math.sin(rot)
  const out: [number, number][] = []
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const lx = (i / n - 0.5) * w
      const lz = (j / n - 0.5) * d
      out.push([x + lx * c + lz * s, z - lx * s + lz * c])
    }
  return out
}

export function canPlaceRect(ctx: GenContext, x: number, z: number, w: number, d: number, rot: number, roadMargin: number, samples = 4) {
  const { bounds } = ctx
  if (ctx.quickReject?.(x, z)) return false
  for (const [px, pz] of rectSamples(x, z, w, d, rot, samples)) {
    if (px < bounds.minX || px > bounds.maxX || pz < bounds.minZ || pz > bounds.maxZ) return false
    if (ctx.idx.at(px, pz, roadMargin)) return false
    if (ctx.noBuild(px, pz)) return false
  }
  const r = Math.hypot(w, d) / 2
  const cand = ctx.bHash.query(x - r, z - r, x + r, z + r)
  for (const b of cand) if (obbOverlap({ x, z, w, d, rot }, b, 1.2)) return false
  return true
}

export function addBuilding(ctx: GenContext, b: Building) {
  ctx.buildings.push(b)
  const r = Math.hypot(b.w, b.d) / 2
  ctx.bHash.insertBox(b, b.x - r, b.z - r, b.x + r, b.z + r)
}

function makeBuilding(ctx: GenContext, x: number, z: number, w: number, d: number, rot: number, spec: ReturnType<typeof buildingSpec>, district: District): Building {
  const rng = ctx.rng
  return {
    x, z, w, d, rot,
    h: spec.floors * spec.floorH + (spec.shopFloor ? 1 : 0),
    style: spec.style,
    color: spec.color,
    roof: pick(rng, ROOFS),
    shopFloor: spec.shopFloor,
    tanks: spec.tanks,
    sign: rng() < spec.signChance ? Math.floor(rng() * SIGN_COLS * SIGN_ROWS) : -1,
    district,
  }
}

/** Line both sides of every road with buildings facing the street. */
export function placeFrontage(ctx: GenContext, opts: { setback: number; skip?: (r: Road) => boolean; ringSides?: Record<number, ('in' | 'out')[]> }) {
  const rng = ctx.rng
  for (const road of ctx.roads) {
    if (opts.skip?.(road)) continue
    if (road.kind === 'straight') {
      const dir = roadDir(road)
      const nx = dir.z,
        nz = -dir.x
      for (const side of [-1, 1]) {
        let s = rand(rng, 1, 6)
        while (s < dir.len) {
          const px = road.ax + dir.x * s
          const pz = road.az + dir.z * s
          const district = ctx.districtAt(px + nx * side * 20, pz + nz * side * 20)
          if (district === 'vista' || district === 'park' || district === 'station') {
            s += 10
            continue
          }
          const spec = buildingSpec(rng, district)
          let w = spec.w
          let placed = false
          for (let attempt = 0; attempt < 2 && !placed; attempt++) {
            const off = road.width / 2 + SIDEWALK_W + (district === 'lutyens' ? 14 : opts.setback) + spec.d / 2
            const cx = road.ax + dir.x * (s + w / 2) + nx * side * off
            const cz = road.az + dir.z * (s + w / 2) + nz * side * off
            // front (+local z) faces the road
            const rot = Math.atan2(-nx * side, -nz * side)
            if (canPlaceRect(ctx, cx, cz, w, spec.d, rot, SIDEWALK_W + opts.setback - 0.6)) {
              addBuilding(ctx, makeBuilding(ctx, cx, cz, w, spec.d, rot, spec, district))
              placed = true
            } else w *= 0.6
          }
          const gap = district === 'lutyens' ? rand(rng, 25, 55) : rng() < 0.12 ? rand(rng, 4, 9) : rand(rng, 0.3, 1.5)
          s += placed ? w + gap : 3
        }
      }
    } else {
      const sides = opts.ringSides?.[road.id] ?? []
      for (const sideName of sides) {
        const baseR = sideName === 'out' ? road.r1 + SIDEWALK_W + opts.setback : road.r0 - SIDEWALK_W - opts.setback
        let a = rng() * 0.1
        while (a < Math.PI * 2) {
          const px = road.cx + Math.sin(a) * baseR
          const pz = road.cz - Math.cos(a) * baseR
          const district = ctx.districtAt(px, pz)
          const spec = buildingSpec(rng, district)
          const rc = sideName === 'out' ? baseR + spec.d / 2 : baseR - spec.d / 2
          const am = a + spec.w / 2 / baseR
          const cx = road.cx + Math.sin(am) * rc
          const cz = road.cz - Math.cos(am) * rc
          // front faces centre for 'out', away for 'in'
          const tx = (road.cx - cx) * (sideName === 'out' ? 1 : -1)
          const tz = (road.cz - cz) * (sideName === 'out' ? 1 : -1)
          const rot = Math.atan2(tx, tz)
          if (district !== 'vista' && district !== 'park' && canPlaceRect(ctx, cx, cz, spec.w, spec.d, rot, SIDEWALK_W + opts.setback - 0.6)) {
            addBuilding(ctx, makeBuilding(ctx, cx, cz, spec.w, spec.d, rot, spec, district))
            a += (spec.w + rand(rng, 0.5, 2)) / baseR
          } else a += 4 / baseR
        }
      }
    }
  }
}

/** Fill the deep interiors of large blocks (back lanes, inner colony houses). */
export function backfill(ctx: GenContext, attempts: number, rotAt: (x: number, z: number) => number) {
  const rng = ctx.rng
  const { bounds } = ctx
  for (let i = 0; i < attempts; i++) {
    const x = rand(rng, bounds.minX + 10, bounds.maxX - 10)
    const z = rand(rng, bounds.minZ + 10, bounds.maxZ - 10)
    const district = ctx.districtAt(x, z)
    if (district === 'vista' || district === 'park' || district === 'station' || district === 'cp') continue
    const spec = buildingSpec(rng, district === 'market' ? 'residential' : district)
    const rot = rotAt(x, z) + (rng() < 0.5 ? 0 : Math.PI)
    if (canPlaceRect(ctx, x, z, spec.w, spec.d, rot, SIDEWALK_W + 6))
      addBuilding(ctx, makeBuilding(ctx, x, z, spec.w, spec.d, rot, { ...spec, shopFloor: false, signChance: 0 }, district))
  }
}

/* ------------------------------------- pavements & graph ------------------------------------- */

export interface SidewalkLine {
  pts: { x: number; z: number }[]
  away: { x: number; z: number }[]
  closed: boolean
  roadId: number
  straight: boolean
  footpath: boolean
  /** paving width (defaults: 4 m pavement, 2.6 m park path) */
  w?: number
}

export function sidewalkLines(roads: Road[], step = 3): SidewalkLine[] {
  const lines: SidewalkLine[] = []
  for (const r of roads) {
    if (r.kind === 'straight') {
      const dir = roadDir(r)
      const nx = dir.z,
        nz = -dir.x
      for (const side of [-1, 1]) {
        const off = r.width / 2 + SIDEWALK_W / 2
        const n = Math.max(2, Math.ceil(dir.len / step))
        const pts = []
        const away = []
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * dir.len
          pts.push({ x: r.ax + dir.x * t + nx * side * off, z: r.az + dir.z * t + nz * side * off })
          away.push({ x: nx * side, z: nz * side })
        }
        lines.push({ pts, away, closed: false, roadId: r.id, straight: true, footpath: false })
      }
    } else {
      const radii: [number, number][] = []
      if (r.r0 > SIDEWALK_W + 3) radii.push([r.r0 - SIDEWALK_W / 2, -1])
      radii.push([r.r1 + SIDEWALK_W / 2, 1])
      for (const [rad, sgn] of radii) {
        const n = Math.ceil((Math.PI * 2 * rad) / step)
        const pts = []
        const away = []
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          pts.push({ x: r.cx + Math.sin(a) * rad, z: r.cz - Math.cos(a) * rad })
          away.push({ x: Math.sin(a) * sgn, z: -Math.cos(a) * sgn })
        }
        lines.push({ pts, away, closed: true, roadId: r.id, straight: false, footpath: false })
      }
    }
  }
  return lines
}

export interface Piece extends SidewalkLine {
  nodeIds: number[]
}

export function clipLines(ctx: GenContext, lines: SidewalkLine[]): SidewalkLine[] {
  const valid = (x: number, z: number, footpath: boolean) =>
    !ctx.idx.at(x, z, footpath ? 0.3 : 0.4) && !ctx.noWalk(x, z)
  const out: SidewalkLine[] = []
  for (const L of lines) {
    const n = L.pts.length
    const ok = L.pts.map((p) => valid(p.x, p.z, L.footpath))
    if (L.closed && ok.every(Boolean)) {
      out.push(L)
      continue
    }
    // start iteration at an invalid point for closed lines
    let start = 0
    if (L.closed) start = ok.findIndex((v) => !v)
    const total = L.closed ? n : n
    let run: number[] = []
    const flush = () => {
      if (run.length >= 2) {
        const pts = run.map((i) => ({ ...L.pts[i] }))
        const away = run.map((i) => L.away[i])
        // refine ends towards the invalid neighbour with a short binary search
        const refine = (inside: { x: number; z: number }, outside: { x: number; z: number }) => {
          let a = { ...inside },
            b = { ...outside }
          for (let k = 0; k < 6; k++) {
            const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
            if (valid(m.x, m.z, L.footpath)) a = m
            else b = m
          }
          return a
        }
        const first = run[0]
        const last = run[run.length - 1]
        const prevI = L.closed ? (first - 1 + n) % n : first - 1
        const nextI = L.closed ? (last + 1) % n : last + 1
        if (prevI >= 0 && prevI < n && !ok[prevI]) pts[0] = refine(L.pts[first], L.pts[prevI])
        if (nextI >= 0 && nextI < n && !ok[nextI]) pts[pts.length - 1] = refine(L.pts[last], L.pts[nextI])
        out.push({ ...L, pts, away, closed: false })
      }
      run = []
    }
    for (let k = 0; k < total; k++) {
      const i = (start + k) % n
      if (ok[i]) run.push(i)
      else flush()
    }
    flush()
  }
  return out
}

export function sidewalkSegs(pieces: SidewalkLine[]): SidewalkSeg[] {
  const segs: SidewalkSeg[] = []
  for (const p of pieces) {
    const w = p.w ?? (p.footpath ? 2.6 : SIDEWALK_W)
    if (p.straight && !p.footpath) {
      const a = p.pts[0],
        b = p.pts[p.pts.length - 1]
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w })
      continue
    }
    const n = p.pts.length
    for (let i = 0; i < n - (p.closed ? 0 : 1); i++) {
      const a = p.pts[i],
        b = p.pts[(i + 1) % n]
      segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w })
    }
  }
  return segs
}

const DENSITY: Record<District, number> = {
  cp: 1, market: 1, office: 0.65, residential: 0.45, government: 0.3, vista: 0.75, station: 1, park: 0.55, lutyens: 0.22,
}

export function buildWalkGraph(ctx: GenContext, pieces: SidewalkLine[], signals: Signal[]) {
  const xs: number[] = [],
    zs: number[] = [],
    ys: number[] = []
  const adj: number[][] = []
  const edges: WalkGraph['edges'] = new Map()
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  const link = (a: number, b: number, meta?: { cross?: number; signal?: number; axis?: 0 | 1 }) => {
    if (a === b || adj[a].includes(b)) return
    adj[a].push(b)
    adj[b].push(a)
    if (meta) edges.set(key(a, b), meta)
  }
  const addNode = (x: number, z: number, y: number) => {
    xs.push(x)
    zs.push(z)
    ys.push(y)
    adj.push([])
    return xs.length - 1
  }

  interface EP {
    node: number
    piece: number
    ox: number
    oz: number
    footpath: boolean
  }
  const eps: EP[] = []
  const nodeHash = new SpatialHash<number>(10)
  pieces.forEach((p, pi) => {
    const ids: number[] = []
    // thin straight pieces to ~6m spacing to keep the graph small
    const stepKeep = p.straight ? 2 : 1
    p.pts.forEach((pt, i) => {
      if (i % stepKeep !== 0 && i !== p.pts.length - 1) return
      const id = addNode(pt.x, pt.z, p.footpath ? 0.05 : SIDEWALK_Y)
      nodeHash.insertPoint(id, pt.x, pt.z)
      ids.push(id)
    })
    for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i])
    if (p.closed && ids.length > 2) link(ids[ids.length - 1], ids[0])
    if (!p.closed) {
      const a = ids[0],
        a2 = ids[1]
      const b = ids[ids.length - 1],
        b2 = ids[ids.length - 2]
      const ol = (n1: number, n2: number) => {
        const dx = xs[n1] - xs[n2],
          dz = zs[n1] - zs[n2]
        const l = Math.hypot(dx, dz) || 1
        return { ox: dx / l, oz: dz / l }
      }
      eps.push({ node: a, piece: pi, ...ol(a, a2), footpath: p.footpath })
      eps.push({ node: b, piece: pi, ...ol(b, b2), footpath: p.footpath })
    }
  })

  // closed, uncut loops (e.g. around a park inside a roundabout) get "ports" every ~40 m that may
  // link across the road to any node on the other side
  const closedPorts: { node: number; piece: number }[] = []
  {
    let nodeCursor = 0
    pieces.forEach((p, pi) => {
      const stepKeep = p.straight ? 2 : 1
      const count = p.pts.filter((_, i) => i % stepKeep === 0 || i === p.pts.length - 1).length
      if (p.closed && !p.footpath) {
        const every = Math.max(1, Math.round(40 / 3))
        for (let k = 0; k < count; k += every) closedPorts.push({ node: nodeCursor + k, piece: pi })
      }
      nodeCursor += count
    })
  }
  const pieceOf = new Int32Array(xs.length)
  {
    let nodeCursor = 0
    pieces.forEach((p, pi) => {
      const stepKeep = p.straight ? 2 : 1
      const count = p.pts.filter((_, i) => i % stepKeep === 0 || i === p.pts.length - 1).length
      for (let k = 0; k < count; k++) pieceOf[nodeCursor + k] = pi
      nodeCursor += count
    })
  }

  const epHash = new SpatialHash<EP>(30)
  for (const e of eps) epHash.insertPoint(e, xs[e.node], zs[e.node])
  const roadById = new Map(ctx.roads.map((r) => [r.id, r]))
  const sigHash = new SpatialHash<Signal>(40)
  for (const s of signals) sigHash.insertPoint(s, s.x, s.z)

  for (const e of eps) {
    const ex = xs[e.node],
      ez = zs[e.node]
    if (e.footpath) {
      // T-junction to the closest node of a different line
      let best = -1,
        bd = 6
      for (const n of nodeHash.query(ex - 6, ez - 6, ex + 6, ez + 6)) {
        if (n === e.node || adj[e.node].includes(n)) continue
        const d = Math.hypot(xs[n] - ex, zs[n] - ez)
        if (d < bd && ctx.idx.crossed(ex, ez, xs[n], zs[n]).size === 0) {
          bd = d
          best = n
        }
      }
      if (best >= 0) link(e.node, best)
    }
    const corners: [number, EP][] = []
    const crossings = new Map<number, [number, EP]>()
    for (const f of epHash.query(ex - 28, ez - 28, ex + 28, ez + 28)) {
      if (f.piece === e.piece) continue
      const fx = xs[f.node],
        fz = zs[f.node]
      const d = Math.hypot(fx - ex, fz - ez)
      if (d > 28 || d < 0.01) continue
      const dot = ((fx - ex) * e.ox + (fz - ez) * e.oz) / d
      if (dot < -0.35) continue
      const crossed = ctx.idx.crossed(ex, ez, fx, fz)
      const groups = crossingGroups(crossed)
      if (crossed.size === 0) {
        if (d < 12) corners.push([d, f])
      } else if (groups) {
        const R = groups.road
        const sx = (fx - ex) / d,
          sz = (fz - ez) / d
        let ok = false
        let width = 0
        if (R.kind === 'straight') {
          const rd = roadDir(R)
          width = groups.width
          ok = Math.abs(sx * rd.x + sz * rd.z) < 0.45
        } else {
          width = R.r1 - R.r0
          const mx = (ex + fx) / 2 - R.cx,
            mz = (ez + fz) / 2 - R.cz
          const ml = Math.hypot(mx, mz) || 1
          ok = Math.abs((sx * mx + sz * mz) / ml) > 0.8
        }
        if (ok && d < width + SIDEWALK_W + 5) {
          const prev = crossings.get(R.id)
          if (!prev || prev[0] > d) crossings.set(R.id, [d, f])
        }
      }
    }
    corners.sort((a, b) => a[0] - b[0])
    for (const [, f] of corners.slice(0, 2)) link(e.node, f.node)
    for (const [rid, [, f]] of crossings) {
      const mx = (ex + xs[f.node]) / 2,
        mz = (ez + zs[f.node]) / 2
      let sig: Signal | undefined
      for (const s of sigHash.query(mx - 30, mz - 30, mx + 30, mz + 30))
        if (Math.hypot(s.x - mx, s.z - mz) < 30) sig = s
      const R = roadById.get(rid)!
      let axis: 0 | 1 = 1
      if (R.kind === 'straight') {
        const rd = roadDir(R)
        axis = sig ? axisOf(sig, rd.x, rd.z) : Math.abs(rd.z) > Math.abs(rd.x) ? 0 : 1
      }
      link(e.node, f.node, { cross: rid, signal: sig?.id, axis })
    }
  }

  for (const port of closedPorts) {
    const ex = xs[port.node],
      ez = zs[port.node]
    let best = -1,
      bd = Infinity,
      bestRoad: Road | null = null
    for (const n of nodeHash.query(ex - 26, ez - 26, ex + 26, ez + 26)) {
      if (pieceOf[n] === port.piece) continue
      const d = Math.hypot(xs[n] - ex, zs[n] - ez)
      if (d >= bd || d > 26) continue
      const crossed = ctx.idx.crossed(ex, ez, xs[n], zs[n])
      if (crossed.size !== 1) continue
      const R = [...crossed][0]
      let ok = false
      const sx = (xs[n] - ex) / d,
        sz = (zs[n] - ez) / d
      if (R.kind === 'ring') {
        const mx = (ex + xs[n]) / 2 - R.cx,
          mz = (ez + zs[n]) / 2 - R.cz
        const ml = Math.hypot(mx, mz) || 1
        ok = Math.abs((sx * mx + sz * mz) / ml) > 0.9 && d < R.r1 - R.r0 + SIDEWALK_W + 3
      } else {
        const rd = roadDir(R)
        ok = Math.abs(sx * rd.x + sz * rd.z) < 0.3 && d < R.width + SIDEWALK_W + 3
      }
      if (ok) {
        best = n
        bd = d
        bestRoad = R
      }
    }
    if (best >= 0 && bestRoad) link(port.node, best, { cross: bestRoad.id, axis: 1 })
  }

  const density = new Float32Array(xs.length)
  for (let i = 0; i < xs.length; i++) density[i] = DENSITY[ctx.districtAt(xs[i], zs[i])]
  const graph: WalkGraph = {
    x: Float32Array.from(xs),
    z: Float32Array.from(zs),
    y: Float32Array.from(ys),
    adj,
    edges,
    density,
  }
  return graph
}

/** Zebra crossings derived from the crossing edges of the pedestrian graph. */
export function zebrasFromGraph(g: WalkGraph) {
  const out: { x: number; z: number; rot: number; len: number }[] = []
  const seen = new Set<string>()
  for (const [k, meta] of g.edges) {
    if (meta.cross === undefined) continue
    const [a, b] = k.split('_').map(Number)
    const mx = (g.x[a] + g.x[b]) / 2,
      mz = (g.z[a] + g.z[b]) / 2
    const kk = `${Math.round(mx / 4)}_${Math.round(mz / 4)}`
    if (seen.has(kk)) continue
    seen.add(kk)
    out.push({ x: mx, z: mz, rot: Math.atan2(g.x[b] - g.x[a], g.z[b] - g.z[a]), len: Math.hypot(g.x[b] - g.x[a], g.z[b] - g.z[a]) - SIDEWALK_W })
  }
  return out
}

/** Roads crossed by a pedestrian segment, grouped by OSM edge. Accepts one road, or a dual
 * carriageway (two parallel groups). Returns the representative road and the total width. */
function crossingGroups(crossed: Set<Road>): { road: Road; width: number } | null {
  if (crossed.size === 0) return null
  const groups = new Map<number, Road>()
  for (const r of crossed) groups.set(r.kind === 'straight' && r.group !== undefined ? r.group : -1 - r.id, r)
  if (groups.size === 1) {
    const r = [...groups.values()][0]
    return { road: r, width: r.kind === 'straight' ? r.width : r.r1 - r.r0 }
  }
  if (groups.size === 2) {
    const [a, b] = [...groups.values()]
    if (a.kind !== 'straight' || b.kind !== 'straight') return null
    const da = roadDir(a),
      db = roadDir(b)
    if (Math.abs(da.x * db.x + da.z * db.z) < 0.85) return null
    return { road: a, width: a.width + b.width + 4 }
  }
  return null
}

/* ------------------------------------------- props ------------------------------------------- */

export function addProp(ctx: GenContext, type: PropType, x: number, z: number, rot: number) {
  const p: Prop = { type, x, z, rot, v: ctx.rng() }
  ctx.props.push(p)
  ctx.pHash.insertPoint(p, x, z)
  return p
}

const INTERACT: Partial<Record<PropType, { type: InteractionType; label: string; radius: number }>> = {
  tea_stall: { type: 'tea', label: 'Buy cutting chai (₹15)', radius: 2.6 },
  food_stall: { type: 'food', label: 'Buy samosa & chaat (₹40)', radius: 2.6 },
  fruit_cart: { type: 'fruit', label: 'Buy fresh fruit (₹30)', radius: 2.4 },
  pan_shop: { type: 'pan', label: 'Buy meetha paan (₹20)', radius: 2.4 },
  atm: { type: 'atm', label: 'Use ATM', radius: 1.8 },
  bench: { type: 'bench', label: 'Sit on bench', radius: 1.6 },
  bus_stop: { type: 'bench', label: 'Sit at bus stop', radius: 2.2 },
}

export function addInteractive(ctx: GenContext, type: PropType, x: number, z: number, rot: number) {
  const p = addProp(ctx, type, x, z, rot)
  const def = INTERACT[type]
  if (def) {
    // interaction point is in front of the prop (+local z)
    const fx = Math.sin(rot),
      fz = Math.cos(rot)
    const front = type === 'bench' ? 0.6 : type === 'bus_stop' ? 0.6 : type === 'atm' ? 0.7 : 1.4
    ctx.interactables.push({
      id: ctx.interactables.length,
      type: def.type,
      x: x + fx * front,
      z: z + fz * front,
      rot,
      radius: def.radius,
      label: def.label,
      data: { propX: x, propZ: z },
    })
  }
  return p
}

function propClear(ctx: GenContext, x: number, z: number, r: number, roadMargin = 0.2) {
  if (ctx.idx.at(x, z, roadMargin)) return false
  for (const b of ctx.bHash.query(x - 30, z - 30, x + 30, z + 30))
    if (obbOverlap({ x, z, w: r * 2, d: r * 2, rot: 0 }, b, 0.2)) return false
  for (const p of ctx.pHash.query(x - r - 2, z - r - 2, x + r + 2, z + r + 2)) if (Math.hypot(p.x - x, p.z - z) < r + 1.2) return false
  return true
}

/** Walk every pavement piece and dress it: trees, street lights, stalls, dogs, ATMs, bus stops. */
export function dressStreets(ctx: GenContext, pieces: SidewalkLine[], roadById: Map<number, Road>, opts: { busStops?: boolean; stallDensity?: number } = {}) {
  const stallDensity = opts.stallDensity ?? 1
  const rng = ctx.rng
  for (const p of pieces) {
    if (p.footpath) continue
    const road = roadById.get(p.roadId)!
    const major = road.kind === 'ring' || road.width >= 16
    // arc-length parameterisation
    const cum = [0]
    for (let i = 1; i < p.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].z - p.pts[i - 1].z))
    const L = cum[cum.length - 1]
    if (L < 12) continue
    const at = (s: number) => {
      let i = 1
      while (i < cum.length - 1 && cum[i] < s) i++
      const t = (s - cum[i - 1]) / Math.max(0.001, cum[i] - cum[i - 1])
      const a = p.pts[i - 1],
        b = p.pts[i]
      const aw = p.away[Math.min(i, p.away.length - 1)]
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ax: aw.x, az: aw.z, tx: (b.x - a.x) / Math.max(0.001, cum[i] - cum[i - 1]), tz: (b.z - a.z) / Math.max(0.001, cum[i] - cum[i - 1]) }
    }
    const lampGap = major ? 26 : 32
    for (let s = 8; s < L - 8; s += lampGap) {
      const q = at(s)
      const x = q.x - q.ax * (SIDEWALK_W / 2 - 0.35),
        z = q.z - q.az * (SIDEWALK_W / 2 - 0.35)
      if (propClear(ctx, x, z, 0.3)) addProp(ctx, 'lamp', x, z, Math.atan2(-q.ax, -q.az))
    }
    const district = ctx.districtAt(p.pts[0].x, p.pts[0].z)
    const treeGap = district === 'lutyens' ? 9 : district === 'government' || district === 'vista' ? 11 : district === 'residential' ? 14 : 19
    for (let s = 6 + rng() * 6; s < L - 6; s += treeGap * rand(rng, 0.8, 1.3)) {
      const q = at(s)
      const x = q.x - q.ax * (SIDEWALK_W / 2 - 0.55),
        z = q.z - q.az * (SIDEWALK_W / 2 - 0.55)
      if (propClear(ctx, x, z, 0.6)) addProp(ctx, 'tree', x, z, rng() * 6.28)
    }
    // stuff on the building side of the pavement (forecourt)
    for (let s = 10 + rng() * 10; s < L - 10; s += rand(rng, 14, 30) / Math.max(0.05, stallDensity * (district === 'market' || district === 'cp' ? 2.2 : district === 'lutyens' ? 0.25 : 1))) {
      const q = at(s)
      const fx = q.x + q.ax * (SIDEWALK_W / 2 + 1.25),
        fz = q.z + q.az * (SIDEWALK_W / 2 + 1.25)
      const faceRoad = Math.atan2(-q.ax, -q.az)
      const busy = district === 'market' || district === 'cp' || district === 'station' || district === 'vista'
      const roll = rng()
      let type: PropType | null = null
      if (busy) {
        if (roll < 0.17) type = 'tea_stall'
        else if (roll < 0.3) type = 'food_stall'
        else if (roll < 0.4) type = 'fruit_cart'
        else if (roll < 0.47) type = 'pan_shop'
        else if (roll < 0.62) type = 'scooter_parked'
        else if (roll < 0.68) type = 'dog'
        else if (roll < 0.74) type = 'bench'
      } else {
        if (roll < 0.05) type = 'tea_stall'
        else if (roll < 0.08) type = 'pan_shop'
        else if (roll < 0.34) type = 'scooter_parked'
        else if (roll < 0.44) type = 'car_parked'
        else if (roll < 0.5) type = 'dog'
        else if (roll < 0.53) type = 'bench'
        else if (roll < 0.535) type = 'cow'
      }
      if (!type) continue
      const size = type === 'car_parked' ? 2.4 : type === 'scooter_parked' || type === 'dog' ? 0.7 : 1.3
      if (!propClear(ctx, fx, fz, size, 0.6)) continue
      if (type === 'car_parked' || type === 'scooter_parked') addProp(ctx, type, fx, fz, Math.atan2(q.tx, q.tz) + (rng() < 0.5 ? 0 : Math.PI))
      else if (type === 'dog' || type === 'cow') addProp(ctx, type, fx, fz, rng() * 6.28)
      else addInteractive(ctx, type, fx, fz, faceRoad)
    }
    // bus stops on major roads (curb side)
    if (opts.busStops !== false && road.kind === 'straight' && road.width >= 14 && L > 90 && rng() < 0.75) {
      const q = at(L * rand(rng, 0.35, 0.65))
      const x = q.x + q.ax * (SIDEWALK_W / 2 + 1.0),
        z = q.z + q.az * (SIDEWALK_W / 2 + 1.0)
      if (propClear(ctx, x, z, 2.2, 0.6)) addInteractive(ctx, 'bus_stop', x, z, Math.atan2(-q.ax, -q.az))
    }
  }
  // ATMs on some shop-floor building fronts
  for (const b of ctx.buildings) {
    if (!b.shopFloor || rng() > 0.07) continue
    const fx = Math.sin(b.rot),
      fz = Math.cos(b.rot)
    const lx = rand(rng, -b.w / 3, b.w / 3)
    const c = Math.cos(b.rot),
      s = Math.sin(b.rot)
    const x = b.x + lx * c + fx * (b.d / 2 + 0.35)
    const z = b.z - lx * s + fz * (b.d / 2 + 0.35)
    if (!ctx.idx.at(x, z, 0.5)) addInteractive(ctx, 'atm', x, z, b.rot)
  }
}

/** Parked cars along the kerb of quieter two-way roads. */
export function parkAlongKerbs(ctx: GenContext, spacing = 1) {
  const rng = ctx.rng
  for (const r of ctx.roads) {
    if (r.kind !== 'straight' || r.width > 14 || r.lanes < 1) continue
    const dir = roadDir(r)
    const nx = dir.z,
      nz = -dir.x
    for (const side of [-1, 1]) {
      for (let s = 15; s < dir.len - 15; s += rand(rng, 7, 26) * spacing) {
        const off = r.width / 2 - 1.25
        const x = r.ax + dir.x * s + nx * side * off
        const z = r.az + dir.z * s + nz * side * off
        if (ctx.idx.at(x, z, 7, r)) continue // keep clear of junctions
        const d = ctx.districtAt(x, z)
        if (d === 'vista' || d === 'cp') continue
        const type: PropType = rng() < 0.75 ? 'car_parked' : 'auto_parked'
        // drive on the left: side +1 (left normal) faces travel direction
        const rot = Math.atan2(dir.x * side, dir.z * side)
        addProp(ctx, type, x, z, rot)
        s += 4
      }
    }
  }
}

/* ------------------------------------------ chunking ----------------------------------------- */

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`

export function chunkify(
  size: number,
  buildings: Building[],
  arcs: ArcBuilding[],
  props: Prop[],
  roads: Road[],
  polys: PolyBuilding[] = [],
  areas: Area[] = [],
) {
  const chunks = new Map<string, ChunkContent>()
  const at = (cx: number, cz: number) => {
    const k = chunkKey(cx, cz)
    let c = chunks.get(k)
    if (!c) chunks.set(k, (c = { key: k, cx, cz, buildings: [], arcs: [], props: [], polys: [], areas: [], roadIds: new Set() }))
    return c
  }
  const get = (x: number, z: number) => at(Math.floor(x / size), Math.floor(z / size))
  for (const b of buildings) get(b.x, b.z).buildings.push(b)
  for (const p of polys) get(p.cx, p.cz).polys.push(p)
  for (const a of arcs) {
    const am = (a.aIn0 + a.aIn1) / 2
    const rm = (a.r0 + a.r1) / 2
    get(a.cx + Math.sin(am) * rm, a.cz - Math.cos(am) * rm).arcs.push(a)
  }
  for (const p of props) get(p.x, p.z).props.push(p)
  areas.forEach((a, i) => {
    let x0: number, z0: number, x1: number, z1: number
    const s = a.shape
    if (s.type === 'poly') [x0, z0, x1, z1] = [s.minX, s.minZ, s.maxX, s.maxZ]
    else if (s.type === 'circle') [x0, z0, x1, z1] = [s.cx - s.r, s.cz - s.r, s.cx + s.r, s.cz + s.r]
    else [x0, z0, x1, z1] = [s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2]
    for (let cx = Math.floor(x0 / size); cx <= Math.floor(x1 / size); cx++)
      for (let cz = Math.floor(z0 / size); cz <= Math.floor(z1 / size); cz++) at(cx, cz).areas.push(i)
  })
  for (const r of roads) {
    if (r.kind === 'straight') {
      const dir = roadDir(r)
      for (let s = 0; s <= dir.len; s += 5) get(r.ax + dir.x * s, r.az + dir.z * s).roadIds.add(r.id)
      get(r.bx, r.bz).roadIds.add(r.id)
    } else {
      const n = Math.ceil((2 * Math.PI * r.r1) / 5)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        get(r.cx + Math.sin(a) * r.r1, r.cz - Math.cos(a) * r.r1).roadIds.add(r.id)
      }
    }
  }
  return chunks
}

export function obbFootprint(b: { x: number; z: number; w: number; d: number; rot: number }) {
  return obbCorners(b)
}

export { clamp, insideRoad }
export type { RingRoad }
