import { SpatialHash, distToSegment, hash2, mulberry32, pick, rand, type RNG } from '../utils/math'
import { SIGN_COLS, SIGN_ROWS, type FacadeStyle } from '../utils/textures'
import { axisOf } from '../traffic/signals'
import {
  addInteractive,
  addProp,
  buildWalkGraph,
  chunkify,
  clipLines,
  createContext,
  dressStreets,
  parkAlongKerbs,
  placeFrontage,
  sidewalkSegs,
  zebrasFromGraph,
  type GenContext,
  type SidewalkLine,
} from './generator'
import { SIDEWALK_W, offsetPolyline, roadDir } from './roads'
import type {
  Flyover,
  Area,
  AreaKind,
  Building,
  CityData,
  District,
  Interactable,
  Landmark,
  LabelSpot,
  LandmarkBuilder,
  NetEdge,
  PolyBuilding,
  PolyKind,
  Road,
  RoadNet,
  Signal,
  StraightRoad,
} from './types'

/* ============================================================================================
 * Generic OpenStreetMap city builder. Input: the compact JSON written by scripts/osm-import.mjs.
 * Real (1:1) roads, footprints, parks, water, rail, signals, crossings, bus stops, metro gates,
 * ATMs, benches… plus procedural infill where OSM has no buildings mapped.
 * ========================================================================================== */

export interface OsmJson {
  meta: {
    id: string
    name: string
    origin: [number, number]
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
    attribution: string
    osmTimestamp?: string
  }
  nodes: number[]
  edges: { a: number; b: number; pts: number[]; name: string; cls: string; w: number; oneway: boolean; car: boolean; ra: number }[]
  /** flyovers/bridges + their ramps, with per-point deck height */
  elev?: { a: number; b: number; pts: number[]; h: number[]; name: string; cls: string; w: number; oneway: boolean; car: boolean }[]
  foot: { name: string; pts: [number, number][] }[]
  buildings: { pts: number[]; h: number; k: string; n: string; id: number; osmTag: string; c?: string }[]
  areas: { k: string; pts: number[]; n: string }[]
  rails: number[][]
  pois: { k: string; x: number; z: number; n?: string; sub?: string | number; brand?: number; ref?: string }[]
  zones?: { d: string; pts: number[] }[]
  places?: { n: string; x: number; z: number; k: string }[]
}

export interface Plaque {
  match: RegExp
  title: string
  text: string
}

export interface OsmCityConfig {
  seed: number
  /** optional hand-drawn zoning; otherwise OSM land-use zones are used */
  districtAt?: (x: number, z: number) => District
  areaName?: (x: number, z: number) => string
  districtLabels?: { text: string; x: number; z: number }[]
  /** radius around the origin treated as the bustling old market/centre */
  centreRadius?: number
  /** override building colour palettes (e.g. Jaipur's pink city) */
  palette?: Partial<Record<'colonial' | 'market' | 'residential' | 'office' | 'government' | 'bungalow', string[]>>
  /** custom-modelled landmarks, matched by name (building or POI) */
  customLandmarks?: { id: string; match: RegExp; radius: number }[]
  /** buildings that get a big dome on the roof */
  domed?: RegExp
  /** default: nearest pavement to the map origin */
  spawn?: { x: number; z: number; yaw: number }
  plaques: Plaque[]
  flag?: { x: number; z: number }
  tropical?: boolean
  /** name of the main railway station POI, to park trains & sign the building */
  mainStation?: { poi: string; sign: string }
  credits: string[]
}

const WALK_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'])
const MARKED_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary'])
const FILL_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential'])
const AREA_KIND: Record<string, AreaKind> = {
  grass: 'grass', forest: 'forest', water: 'water', parking: 'parking', rail: 'rail', plaza: 'plaza', campus: 'campus', sand: 'sand',
}

export function pointInPoly(x: number, z: number, pts: number[]) {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i],
      zi = pts[i + 1],
      xj = pts[j],
      zj = pts[j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Minimum-area oriented bounding box (edge-aligned candidates). */
function obbOf(pts: number[]) {
  let best = { area: Infinity, x: 0, z: 0, w: 0, d: 0, rot: 0 }
  const n = pts.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const th = Math.atan2(pts[j * 2 + 1] - pts[i * 2 + 1], pts[j * 2] - pts[i * 2])
    const c = Math.cos(th),
      s = Math.sin(th)
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity
    for (let k = 0; k < n; k++) {
      const x = pts[k * 2],
        z = pts[k * 2 + 1]
      const u = x * c + z * s,
        v = -x * s + z * c
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (area < best.area) {
      const uc = (u0 + u1) / 2,
        vc = (v0 + v1) / 2
      best = { area, x: uc * c - vc * s, z: uc * s + vc * c, w: u1 - u0, d: v1 - v0, rot: -th }
    }
  }
  return best
}

const PALETTE: Record<string, string[]> = {
  colonial: ['#f2eee4', '#efe9dc', '#f4f0e6'],
  market: ['#f0d27a', '#e59a7a', '#9fc7e6', '#f1e7d0', '#e7b26d', '#c9e0a5', '#f4c6c6', '#d7d0f0', '#e9dcc2'],
  residential: ['#e9dcc2', '#ead48e', '#dca286', '#e6bdb6', '#bcd5b3', '#b4cbe0', '#efebe3', '#d09a74', '#e8c9a0'],
  office: ['#9fb4c4', '#b7c7c0', '#cfc8b8', '#a9b8c9', '#d4d6d8', '#8fa9a0'],
  government: ['#dcb98d', '#cf9a72', '#e6cfa8', '#c9805c'],
  bungalow: ['#f1ece0', '#efe6cf', '#e9e0cc', '#f4efe6'],
}

export function buildOsmCity(data: OsmJson, cfg: OsmCityConfig): CityData {
  const rng: RNG = mulberry32(cfg.seed)
  const bounds = data.meta.bounds
  const pal = { ...PALETTE, ...cfg.palette } as Record<keyof typeof PALETTE, string[]>
  // generic zoning from OSM land use (+ the historic centre)
  const zoneHash = new SpatialHash<{ d: string; pts: number[] }>(80)
  for (const z of data.zones ?? []) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < z.pts.length; i += 2) {
      x0 = Math.min(x0, z.pts[i]); x1 = Math.max(x1, z.pts[i])
      z0 = Math.min(z0, z.pts[i + 1]); z1 = Math.max(z1, z.pts[i + 1])
    }
    zoneHash.insertBox(z, x0, z0, x1, z1)
  }
  const districtAt: (x: number, z: number) => District =
    cfg.districtAt ??
    ((x, z) => {
      if (Math.hypot(x, z) < (cfg.centreRadius ?? 450)) return 'market'
      for (const zn of zoneHash.query(x, z, x, z)) if (pointInPoly(x, z, zn.pts)) return zn.d as District
      return 'residential'
    })
  const places = data.places ?? []
  const areaName =
    cfg.areaName ??
    ((x: number, z: number) => {
      let best = data.meta.name,
        bd = 1400
      for (const p of places) {
        const d = Math.hypot(p.x - x, p.z - z) * (p.k === 'suburb' ? 0.8 : 1)
        if (d < bd) {
          bd = d
          best = p.n
        }
      }
      return best
    })

  /* ------------------------------------------------------------------ roads */
  const roads: Road[] = []
  let rid = 0
  const edgeFirstRoad: number[] = []
  data.edges.forEach((e, ei) => {
    edgeFirstRoad.push(rid)
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const r: StraightRoad = {
        kind: 'straight', id: rid++, name: e.name, ax: e.pts[i], az: e.pts[i + 1], bx: e.pts[i + 2], bz: e.pts[i + 3],
        width: e.w, lanes: e.oneway ? 0 : 1, group: ei, cls: e.cls, oneway: e.oneway,
      }
      roads.push(r)
    }
  })

  /* ------------------------------------------------------------------ areas */
  const areas: Area[] = []
  const areaHash = new SpatialHash<Area>(60)
  const pushArea = (a: Area) => {
    areas.push(a)
    const s = a.shape
    if (s.type === 'poly') areaHash.insertBox(a, s.minX, s.minZ, s.maxX, s.maxZ)
    else if (s.type === 'circle') areaHash.insertBox(a, s.cx - s.r, s.cz - s.r, s.cx + s.r, s.cz + s.r)
  }
  const polyBox = (pts: number[]) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i])
      minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1])
    }
    return { minX, minZ, maxX, maxZ }
  }
  // draw order: big/low-priority kinds first
  const ORDER = ['campus', 'rail', 'parking', 'plaza', 'grass', 'forest', 'water']
  for (const k of ORDER)
    for (const a of data.areas) {
      if (a.k !== k) continue
      pushArea({ kind: AREA_KIND[a.k], shape: { type: 'poly', pts: a.pts, ...polyBox(a.pts) }, name: a.n || undefined })
    }
  const areaAt = (x: number, z: number, kinds?: Set<AreaKind>) => {
    for (const a of areaHash.query(x, z, x, z)) {
      if (kinds && !kinds.has(a.kind)) continue
      const s = a.shape
      if (s.type === 'poly' ? pointInPoly(x, z, s.pts) : s.type === 'circle' ? Math.hypot(x - s.cx, z - s.cz) < s.r : false) return a
    }
    return null
  }

  // roundabout islands (Delhi's tree-filled rotaries)
  {
    const parent = new Map<number, number>()
    const find = (x: number): number => {
      while (parent.get(x) !== x) x = parent.get(x)!
      return x
    }
    const ra = data.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.ra)
    for (const { e } of ra) {
      if (!parent.has(e.a)) parent.set(e.a, e.a)
      if (!parent.has(e.b)) parent.set(e.b, e.b)
      parent.set(find(e.a), find(e.b))
    }
    const comps = new Map<number, typeof ra>()
    for (const r of ra) {
      const k = find(r.e.a)
      if (!comps.has(k)) comps.set(k, [])
      comps.get(k)!.push(r)
    }
    for (const list of comps.values()) {
      const pts: number[] = []
      for (const { e } of list) pts.push(...e.pts)
      let cx = 0, cz = 0
      for (let i = 0; i < pts.length; i += 2) {
        cx += pts[i]
        cz += pts[i + 1]
      }
      cx /= pts.length / 2
      cz /= pts.length / 2
      let mr = 0
      for (let i = 0; i < pts.length; i += 2) mr += Math.hypot(pts[i] - cx, pts[i + 1] - cz)
      mr /= pts.length / 2
      const w = Math.min(...list.map((l) => l.e.w))
      const r = mr - w / 2 - 0.6
      if (r < 5 || r > 60) continue // skip tiny ones and CP-scale circles
      pushArea({ kind: 'grass', shape: { type: 'circle', cx, cz, r } })
    }
  }

  const ctxNoBuildKinds = new Set<AreaKind>(['grass', 'water', 'forest', 'rail', 'plaza', 'parking', 'campus'])
  const ctx: GenContext = createContext(
    rng,
    roads,
    bounds,
    districtAt,
    (x, z) => districtAt(x, z) === 'vista' || !!areaAt(x, z, ctxNoBuildKinds),
    (x, z) => !!areaAt(x, z, new Set<AreaKind>(['water'])),
  )

  /* --------------------------------------------------------------- polygons */
  const polys: PolyBuilding[] = []
  const polyHash = new SpatialHash<PolyBuilding>(40)
  const landmarkBuilders: LandmarkBuilder[] = []
  const customNames: { name: string; x: number; z: number }[] = []
  for (const cl of cfg.customLandmarks ?? []) {
    const b = data.buildings.find((b) => cl.match.test(b.n))
    let pos: { x: number; z: number } | null = null
    if (b) {
      let cx = 0, cz = 0
      for (let i = 0; i < b.pts.length; i += 2) {
        cx += b.pts[i]
        cz += b.pts[i + 1]
      }
      pos = { x: cx / (b.pts.length / 2), z: cz / (b.pts.length / 2) }
    } else {
      const p = data.pois.find((p) => p.n && cl.match.test(p.n) && (p.k === 'landmark' || p.k === 'worship' || p.k === 'park'))
      if (p) pos = { x: p.x, z: p.z }
    }
    if (pos) {
      landmarkBuilders.push({ id: cl.id, x: pos.x, z: pos.z, radius: cl.radius })
      customNames.push({ name: b?.n || data.pois.find((p) => p.n && cl.match.test(p.n))?.n || cl.id, x: pos.x, z: pos.z })
    }
  }
  let nextSign = 0
  for (const b of data.buildings) {
    const n = b.pts.length / 2
    let cx = 0, cz = 0
    for (let i = 0; i < n; i++) {
      cx += b.pts[i * 2]
      cz += b.pts[i * 2 + 1]
    }
    cx /= n
    cz /= n
    let r = 0
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(b.pts[i * 2] - cx, b.pts[i * 2 + 1] - cz))
    // footprints replaced by (or duplicating) a custom-modelled landmark
    if (landmarkBuilders.some((l) => Math.hypot(l.x - cx, l.z - cz) < l.radius * 0.6)) continue
    const district = districtAt(cx, cz)
    let kind = b.k as PolyKind
    if (/Yantra/i.test(b.n)) kind = 'yantra'
    const obb = obbOf(b.pts)
    const footArea = obb.w * obb.d
    let style: FacadeStyle = 'residential'
    let color = pick(rng, pal.residential)
    let h = b.h
    let shopy = false
    switch (kind) {
      case 'canopy':
        color = '#c9ccd0'
        h ||= 6
        break
      case 'station':
        color = '#8e3b2e'
        style = 'government'
        h ||= 15
        break
      case 'temple':
        color = pick(rng, ['#f3e3c3', '#efc28a', '#f6ead6'])
        style = 'government'
        h ||= 7
        break
      case 'gurdwara':
        color = '#f6f4ee'
        style = 'colonial'
        h ||= 10
        break
      case 'mosque':
        color = pick(rng, ['#efe6d2', '#e9dcc4', '#f2ede2'])
        style = 'colonial'
        h ||= 8
        break
      case 'church':
        color = '#ece6dc'
        style = 'colonial'
        h ||= 12
        break
      case 'yantra':
        color = '#c8674a'
        style = 'government'
        h ||= /Samrat/i.test(b.n) ? 21 : /Jai Prakash/i.test(b.n) ? 2.5 : 6.5
        break
      case 'monument':
        color = '#d1a77c'
        style = 'government'
        h ||= /Baoli/i.test(b.n) ? 2.5 : 9
        break
      case 'public':
        style = 'government'
        color = pick(rng, pal.government)
        h ||= footArea > 2500 ? 16 : 12
        break
      case 'office':
        style = 'office'
        color = pick(rng, pal.office)
        h ||= footArea > 1500 ? 34 + rng() * 30 : 18 + rng() * 14
        break
      default:
        if (district === 'cp') {
          style = 'colonial'
          color = pick(rng, pal.colonial)
          h ||= 13
          shopy = true
        } else if (district === 'market' || kind === 'commercial') {
          style = 'residential'
          color = pick(rng, pal.market)
          h ||= (3 + Math.floor(rng() * 3)) * 3.2 + 1
          shopy = true
        } else if (district === 'lutyens') {
          style = 'colonial'
          color = pick(rng, pal.bungalow)
          h ||= footArea > 1200 ? 11 : 7.5
        } else if (district === 'office') {
          style = footArea > 900 ? 'office' : 'residential'
          color = pick(rng, style === 'office' ? pal.office : pal.residential)
          h ||= style === 'office' ? 24 + rng() * 34 : 12 + rng() * 8
          shopy = style !== 'office'
        } else if (district === 'government' || district === 'vista') {
          style = 'government'
          color = pick(rng, pal.government)
          h ||= 14
        } else if (district === 'station') {
          style = 'residential'
          color = pick(rng, pal.market)
          h ||= 11
          shopy = true
        } else {
          h ||= footArea < 120 ? 7 : (3 + Math.floor(rng() * 2)) * 3.2
          shopy = rng() < 0.3
        }
    }
    h = Math.max(2.5, Math.min(h, 120))
    // respect OSM building:colour where mappers recorded it
    if (b.c && kind !== 'yantra') {
      const named: Record<string, string> = { white: '#f2efe8', cream: '#efe4c8', beige: '#e3d3b4', red: '#b5523c', brown: '#9a6b4f', yellow: '#ead48e', grey: '#a9a9a6', gray: '#a9a9a6', pink: '#e6b5b0', orange: '#e59a5a', blue: '#9fb9d6', green: '#a9c9a0' }
      color = b.c.startsWith('#') ? b.c : named[b.c.toLowerCase()] ?? color
    }
    const pb: PolyBuilding = {
      pts: b.pts, h, style, color, roof: pick(rng, ['#8f8a82', '#9b958c', '#7d7974', '#a39d92']), kind, name: b.n,
      shop: new Array(n).fill(false), sign: -1, cx, cz, r, district, source: 'osm', domed: !!cfg.domed?.test(b.n),
    }
    // ground-floor shops on edges that face a drivable street
    if (shopy && h > 4) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const ax = b.pts[i * 2], az = b.pts[i * 2 + 1], bx = b.pts[j * 2], bz = b.pts[j * 2 + 1]
        const L = Math.hypot(bx - ax, bz - az)
        if (L < 4) continue
        const ox = (bz - az) / L, oz = -(bx - ax) / L // outward normal
        const mx = (ax + bx) / 2, mz = (az + bz) / 2
        for (const k of [4, 8, 13]) {
          const R = ctx.idx.at(mx + ox * k, mz + oz * k, 0.5)
          if (R && R.kind === 'straight' && R.cls !== 'service') {
            pb.shop[i] = true
            break
          }
        }
      }
      if (pb.shop.some(Boolean)) pb.sign = (nextSign++ * 7 + Math.floor(rng() * 5)) % (SIGN_COLS * SIGN_ROWS)
    }
    polys.push(pb)
    polyHash.insertBox(pb, cx - r, cz - r, cx + r, cz + r)
    // reserve the footprint for procedural placement checks
    const pseudo = { x: obb.x, z: obb.z, w: obb.w, d: obb.d, rot: obb.rot } as Building
    ctx.bHash.insertBox(pseudo, cx - r, cz - r, cx + r, cz + r)
  }
  const polyAt = (x: number, z: number) => {
    for (const p of polyHash.query(x, z, x, z)) if (pointInPoly(x, z, p.pts)) return p
    return null
  }

  /* --------------------------------------------------- procedural infill */
  // Only where OpenStreetMap has no buildings mapped nearby (gaps in coverage)
  ctx.quickReject = (x, z) => {
    for (const p of polyHash.query(x - 30, z - 30, x + 30, z + 30)) if (Math.hypot(p.cx - x, p.cz - z) < p.r + 22) return true
    return false
  }
  placeFrontage(ctx, { setback: 2.5, skip: (r) => !(r.kind === 'straight' && FILL_CLASSES.has(r.cls ?? '')) })

  /* ---------------------------------------------------------------- road net */
  const nNodes = data.nodes.length / 2
  const net: RoadNet = {
    nx: new Float32Array(nNodes),
    nz: new Float32Array(nNodes),
    edges: [],
    inc: Array.from({ length: nNodes }, () => []),
    nodeSignal: new Int32Array(nNodes).fill(-1),
  }
  for (let i = 0; i < nNodes; i++) {
    net.nx[i] = data.nodes[i * 2]
    net.nz[i] = data.nodes[i * 2 + 1]
  }
  data.edges.forEach((e, i) => {
    const cum = [0]
    for (let k = 2; k < e.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]))
    const ne: NetEdge = {
      id: i, a: e.a, b: e.b, pts: e.pts, cum, len: cum[cum.length - 1], w: e.w, oneway: e.oneway, car: e.car, cls: e.cls,
      name: e.name, roundabout: !!e.ra,
    }
    net.edges.push(ne)
    net.inc[e.a].push(i)
    if (e.b !== e.a) net.inc[e.b].push(i)
  })
  // flyovers join the same graph (they share nodes with ground roads at the ramp feet)
  const flyovers: Flyover[] = []
  for (const e of data.elev ?? []) {
    const i = net.edges.length
    const cum = [0]
    for (let k = 2; k < e.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]))
    net.edges.push({ id: i, a: e.a, b: e.b, pts: e.pts, cum, len: cum[cum.length - 1], w: e.w, oneway: e.oneway, car: e.car, cls: e.cls, name: e.name, roundabout: false, h: e.h })
    net.inc[e.a].push(i)
    if (e.b !== e.a) net.inc[e.b].push(i)
    flyovers.push({ pts: e.pts, h: e.h, w: e.w, name: e.name, oneway: e.oneway })
  }
  // ends where 3+ roads meet (branches / merges) get no parapet so lanes can cross over
  ;(data.elev ?? []).forEach((e, k) => {
    flyovers[k].openA = net.inc[e.a].length > 2
    flyovers[k].openB = net.inc[e.b].length > 2
  })

  /* ----------------------------------------------------------------- signals */
  const signals: Signal[] = []
  {
    const clusters: { x: number; z: number; n: number }[] = []
    for (const p of data.pois) {
      if (p.k !== 'signal') continue
      const c = clusters.find((c) => Math.hypot(c.x / c.n - p.x, c.z / c.n - p.z) < 35)
      if (c) {
        c.x += p.x
        c.z += p.z
        c.n++
      } else clusters.push({ x: p.x, z: p.z, n: 1 })
    }
    const nodeHash = new SpatialHash<number>(30)
    for (let i = 0; i < nNodes; i++) if (net.inc[i].some((e) => net.edges[e].car)) nodeHash.insertPoint(i, net.nx[i], net.nz[i])
    for (const c of clusters) {
      const x = c.x / c.n,
        z = c.z / c.n
      const nodes = [...nodeHash.query(x - 30, z - 30, x + 30, z + 30)].filter((i) => Math.hypot(net.nx[i] - x, net.nz[i] - z) < 30)
      if (!nodes.length) continue
      // phase axis: direction of the widest road at the junction
      let best = -1,
        axis = 0
      for (const nd of nodes)
        for (const ei of net.inc[nd]) {
          const e = net.edges[ei]
          if (!e.car || e.w <= best) continue
          best = e.w
          axis = Math.atan2(e.pts[2] - e.pts[0], e.pts[3] - e.pts[1])
        }
      const s: Signal = { id: signals.length, x, z, group: signals.length & 1, axis, hw0: 9, hw1: 9 }
      // junction half-extents from node spread
      let e0 = 0,
        e1 = 0
      for (const nd of nodes) {
        const dx = net.nx[nd] - x,
          dz = net.nz[nd] - z
        e0 = Math.max(e0, Math.abs(dx * Math.sin(axis) + dz * Math.cos(axis)))
        e1 = Math.max(e1, Math.abs(dx * Math.cos(axis) - dz * Math.sin(axis)))
      }
      s.hw0 = Math.min(26, Math.max(7, e0 + best / 2 + 1))
      s.hw1 = Math.min(26, Math.max(7, e1 + best / 2 + 1))
      signals.push(s)
      for (const nd of nodes) net.nodeSignal[nd] = s.id
    }
  }

  /* ------------------------------------------------------- pavements + graph */
  const lines: SidewalkLine[] = []
  const resample = (pts: { x: number; z: number }[], step: number) => {
    const out: { x: number; z: number }[] = [pts[0]]
    let carry = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const L = Math.hypot(b.x - a.x, b.z - a.z)
      let t = step - carry
      while (t < L) {
        out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L })
        t += step
      }
      carry = L - (t - step)
    }
    const last = pts[pts.length - 1]
    if (Math.hypot(last.x - out[out.length - 1].x, last.z - out[out.length - 1].z) > 0.5) out.push(last)
    return out
  }
  data.edges.forEach((e, ei) => {
    if (!WALK_CLASSES.has(e.cls)) return
    const P: { x: number; z: number }[] = []
    for (let i = 0; i < e.pts.length; i += 2) P.push({ x: e.pts[i], z: e.pts[i + 1] })
    const closed = e.a === e.b && P.length > 3
    for (const side of [1, -1]) {
      const off = offsetPolyline(P, side * (e.w / 2 + SIDEWALK_W / 2), closed)
      const pts = resample(closed ? [...off, off[0]] : off, 4)
      if (pts.length < 2) continue
      const away = pts.map((_, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
        const dx = b.x - a.x, dz = b.z - a.z
        const l = Math.hypot(dx, dz) || 1
        return { x: (side * dz) / l, z: (-side * dx) / l }
      })
      lines.push({ pts, away, closed: false, roadId: edgeFirstRoad[ei], straight: false, footpath: false })
    }
  })
  for (const f of data.foot) {
    const pts = resample(f.pts.map(([x, z]) => ({ x, z })), 4)
    if (pts.length >= 2) lines.push({ pts, away: pts.map(() => ({ x: 0, z: 1 })), closed: false, roadId: -1, straight: false, footpath: true, w: 5 })
  }
  const pieces = clipLines(ctx, lines)
  const graph = buildWalkGraph(ctx, pieces, signals)
  const zebras = zebrasFromGraph(graph)

  // zebra crossings at real OSM crossing nodes (+ pedestrian links across the road)
  {
    const nh = new SpatialHash<number>(8)
    for (let i = 0; i < graph.x.length; i++) nh.insertPoint(i, graph.x[i], graph.z[i])
    const nearest = (x: number, z: number, r: number) => {
      let best = -1, bd = r
      for (const i of nh.query(x - r, z - r, x + r, z + r)) {
        const d = Math.hypot(graph.x[i] - x, graph.z[i] - z)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return best
    }
    const sigHash = new SpatialHash<Signal>(40)
    for (const s of signals) sigHash.insertPoint(s, s.x, s.z)
    for (const p of data.pois) {
      if (p.k !== 'crossing') continue
      const R = ctx.idx.at(p.x, p.z, 1.5)
      if (!R || R.kind !== 'straight' || !WALK_CLASSES.has(R.cls ?? '')) continue
      const d = roadDir(R)
      const t = distToSegment(p.x, p.z, R.ax, R.az, R.bx, R.bz).t
      const cx = R.ax + (R.bx - R.ax) * t, cz = R.az + (R.bz - R.az) * t
      const nx = d.z, nz = -d.x
      const off = R.width / 2 + SIDEWALK_W / 2
      const A = nearest(cx + nx * off, cz + nz * off, 4)
      const B = nearest(cx - nx * off, cz - nz * off, 4)
      zebras.push({ x: cx, z: cz, rot: Math.atan2(nx, nz), len: R.width - 0.6 })
      if (A < 0 || B < 0 || A === B || graph.adj[A].includes(B)) continue
      graph.adj[A].push(B)
      graph.adj[B].push(A)
      let sig: Signal | undefined
      for (const s of sigHash.query(cx - 30, cz - 30, cx + 30, cz + 30)) if (Math.hypot(s.x - cx, s.z - cz) < 30) sig = s
      graph.edges.set(A < B ? `${A}_${B}` : `${B}_${A}`, { cross: R.id, signal: sig?.id, axis: sig ? axisOf(sig, d.x, d.z) : 1 })
    }
  }

  /* -------------------------------------------------------------- POI props */
  const roadById = new Map(roads.map((r) => [r.id, r]))
  const snap = (x: number, z: number, maxD = 30) => {
    let best: { R: StraightRoad; px: number; pz: number; nx: number; nz: number; d: number } | null = null
    for (const R of ctx.idx.near(x, z)) {
      if (R.kind !== 'straight' || R.cls === 'service') continue
      const q = distToSegment(x, z, R.ax, R.az, R.bx, R.bz)
      if (q.d > maxD || (best && q.d >= best.d)) continue
      const px = R.ax + (R.bx - R.ax) * q.t, pz = R.az + (R.bz - R.az) * q.t
      let nx = x - px, nz = z - pz
      const l = Math.hypot(nx, nz)
      if (l < 0.01) {
        const d = roadDir(R)
        nx = d.z
        nz = -d.x
      } else {
        nx /= l
        nz /= l
      }
      best = { R, px, pz, nx, nz, d: q.d }
    }
    return best
  }
  const kerbSide = (x: number, z: number, out: number) => {
    const s = snap(x, z)
    if (!s) return null
    const off = s.R.width / 2 + SIDEWALK_W + out
    return { x: s.px + s.nx * off, z: s.pz + s.nz * off, rot: Math.atan2(-s.nx, -s.nz) }
  }
  const occupied = new SpatialHash<{ x: number; z: number }>(10)
  const free = (x: number, z: number, r: number) => {
    for (const o of occupied.query(x - r, z - r, x + r, z + r)) if (Math.hypot(o.x - x, o.z - z) < r) return false
    return !polyAt(x, z) && !ctx.idx.at(x, z, 0.3)
  }
  const mark = (x: number, z: number) => occupied.insertPoint({ x, z }, x, z)
  const metroStations = new Set<string>()
  // doors into real shops/restaurants (enterable interiors)
  const DOOR_NAMES = {
    dhaba: ['Shree Dhaba', 'Punjabi Rasoi', 'Annapurna Bhojnalaya', 'Udupi Café', 'Biryani Ghar', 'Haveli Dhaba', 'Sagar Ratna-style Café'],
    store: ['Kirana General Store', 'Gupta Provision Store', 'Daily Needs', 'Lakshmi Stores', 'Apna Bazaar'],
    clothes: ['Fashion Point', 'Kapda Ghar', 'Style Hub', 'Saree Sangam', 'Trendz'],
  }
  let doorN = 0
  const doorFor = (x: number, z: number) => {
    let best: { x: number; z: number; rot: number; d: number } | null = null
    for (const pb of polyHash.query(x - 30, z - 30, x + 30, z + 30)) {
      if (pb.kind !== 'generic' && pb.kind !== 'commercial' && pb.kind !== 'residential') continue
      const n = pb.pts.length / 2
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const ax = pb.pts[i * 2], az = pb.pts[i * 2 + 1], bx = pb.pts[j * 2], bz = pb.pts[j * 2 + 1]
        const L = Math.hypot(bx - ax, bz - az)
        if (L < 3) continue
        const q = distToSegment(x, z, ax, az, bx, bz)
        if (best && q.d >= best.d) continue
        const ox = (bz - az) / L, oz = -(bx - ax) / L
        const px = ax + (bx - ax) * q.t + ox * 0.9, pz = az + (bz - az) * q.t + oz * 0.9
        if (ctx.idx.at(px, pz, 0.2) || polyAt(px, pz)) continue
        best = { x: px, z: pz, rot: Math.atan2(-ox, -oz), d: q.d }
      }
    }
    return best && best.d < 25 ? best : null
  }
  const addDoor = (p: { x: number; z: number; brand?: number; sub?: string | number }, kind: 'dhaba' | 'store' | 'clothes') => {
    if (doorN >= 90) return
    const d = doorFor(p.x, p.z)
    if (!d || !free(d.x, d.z, 6)) return
    mark(d.x, d.z)
    const name = pick(rng, DOOR_NAMES[kind])
    doorN++
    ctx.interactables.push({
      id: ctx.interactables.length, type: 'door', x: d.x, z: d.z, rot: d.rot, radius: 1.7,
      label: `Enter ${name}`, data: { kind, name },
    })
  }
  let foodN = 0
  for (const p of data.pois) {
    switch (p.k) {
      case 'bus_stop': {
        const k = kerbSide(p.x, p.z, 1.0)
        if (k && free(k.x, k.z, 6)) {
          addInteractive(ctx, 'bus_stop', k.x, k.z, k.rot)
          mark(k.x, k.z)
        }
        break
      }
      case 'metro_gate': {
        if (!p.n) break
        if (p.x < bounds.minX + 25 || p.x > bounds.maxX - 25 || p.z < bounds.minZ + 25 || p.z > bounds.maxZ - 25) break
        const s = snap(p.x, p.z, 40)
        const rot = s ? Math.atan2(-s.nx, -s.nz) : 0
        let x = p.x, z = p.z
        if (ctx.idx.at(x, z, 1) && s) {
          x = s.px + s.nx * (s.R.width / 2 + SIDEWALK_W + 2.5)
          z = s.pz + s.nz * (s.R.width / 2 + SIDEWALK_W + 2.5)
        }
        if (!free(x, z, 5)) break
        const name = p.n || 'Metro'
        metroStations.add(name)
        addProp(ctx, 'metro_entrance', x, z, rot)
        mark(x, z)
        ctx.interactables.push({
          id: ctx.interactables.length, type: 'metro', x: x + Math.sin(rot) * 3.2, z: z + Math.cos(rot) * 3.2, rot, radius: 2.6,
          label: `Enter metro — ${name}`, data: { station: name },
        })
        break
      }
      case 'atm': {
        const k = kerbSide(p.x, p.z, 0.8)
        const at = k && Math.hypot(k.x - p.x, k.z - p.z) < 30 ? k : null
        if (at && free(at.x, at.z, 3)) {
          addInteractive(ctx, 'atm', at.x, at.z, at.rot)
          mark(at.x, at.z)
        }
        break
      }
      case 'bench':
        if (free(p.x, p.z, 1.5)) {
          addInteractive(ctx, 'bench', p.x, p.z, hash2(p.x, p.z) * Math.PI * 2)
          mark(p.x, p.z)
        }
        break
      case 'fountain':
        if (free(p.x, p.z, 3) && areaAt(p.x, p.z, new Set<AreaKind>(['grass', 'plaza']))) {
          addProp(ctx, 'fountain', p.x, p.z, 0)
          mark(p.x, p.z)
        }
        break
      case 'bin':
        if (!polyAt(p.x, p.z) && !ctx.idx.at(p.x, p.z, 0.3)) addProp(ctx, 'bin', p.x, p.z, 0)
        break
      case 'food': {
        if (/^(restaurant|cafe|fast_food|food_court)$/.test(String(p.sub)) && rng() < 0.6) addDoor(p, 'dhaba')
        const k = kerbSide(p.x, p.z, 1.3)
        if (!k || Math.hypot(k.x - p.x, k.z - p.z) > 35 || !free(k.x, k.z, 9)) break
        const type = (['food_stall', 'tea_stall', 'fruit_cart', 'food_stall', 'pan_shop'] as const)[foodN++ % 5]
        addInteractive(ctx, type, k.x, k.z, k.rot)
        mark(k.x, k.z)
        break
      }
      case 'fuel': {
        const k = kerbSide(p.x, p.z, 7)
        if (k && free(k.x, k.z, 8)) {
          addProp(ctx, 'petrol_pump', k.x, k.z, k.rot)
          mark(k.x, k.z)
          ctx.interactables.push({ id: ctx.interactables.length, type: 'fuel', x: k.x, z: k.z, rot: k.rot, radius: 9, label: 'Refuel & repair vehicle' })
        }
        break
      }
      case 'station': {
        if (p.sub || !p.n || /metro|airport/i.test(p.n)) break
        const k = kerbSide(p.x, p.z, 1.5)
        if (!k || !free(k.x, k.z, 4)) break
        mark(k.x, k.z)
        ctx.interactables.push({ id: ctx.interactables.length, type: 'train', x: k.x, z: k.z, rot: k.rot, radius: 3.2, label: `Book a train — ${p.n}`, data: { station: p.n } })
        break
      }
      case 'shop': {
        const sub = String(p.sub ?? '')
        if (/^(convenience|supermarket|general|grocery|kiosk|bakery|confectionery)$/.test(sub) && rng() < 0.7) addDoor(p, 'store')
        else if (/^(clothes|fashion|boutique|tailor|fabric)$/.test(sub) && rng() < 0.5) addDoor(p, 'clothes')
        const clothes = /^(clothes|fashion|boutique|tailor|shoes|fabric)$/.test(sub)
        const cars = /^(car|motorcycle|scooter)$/.test(sub)
        if (!clothes && !cars) break
        if (clothes && ctx.interactables.filter((i) => i.type === 'shop_clothes').length >= 12) break
        const k = kerbSide(p.x, p.z, 1.2)
        if (!k || Math.hypot(k.x - p.x, k.z - p.z) > 30 || !free(k.x, k.z, 5)) break
        mark(k.x, k.z)
        ctx.interactables.push(
          clothes
            ? { id: ctx.interactables.length, type: 'shop_clothes', x: k.x, z: k.z, rot: k.rot, radius: 2.6, label: 'Clothes shop — browse outfits' }
            : { id: ctx.interactables.length, type: 'dealer', x: k.x, z: k.z, rot: k.rot, radius: 3, label: 'Vehicle showroom — buy a ride' },
        )
        break
      }
      case 'police': {
        const k = kerbSide(p.x, p.z, 1.2)
        if (k && free(k.x, k.z, 4)) {
          addProp(ctx, 'police_booth', k.x, k.z, k.rot)
          mark(k.x, k.z)
        }
        break
      }
      case 'worship':
        if (!polyAt(p.x, p.z) && free(p.x, p.z, 3) && p.sub === 'temple') {
          const sn = snap(p.x, p.z)
          addProp(ctx, 'shrine', p.x, p.z, sn ? Math.atan2(-sn.nx, -sn.nz) : 0)
          mark(p.x, p.z)
        }
        break
    }
  }

  // trees in parks / forests
  let treeBudget = 16000
  for (const a of areas) {
    if (a.kind !== 'grass' && a.kind !== 'forest') continue
    const s = a.shape
    let x0: number, z0: number, x1: number, z1: number
    if (s.type === 'poly') [x0, z0, x1, z1] = [s.minX, s.minZ, s.maxX, s.maxZ]
    else if (s.type === 'circle') [x0, z0, x1, z1] = [s.cx - s.r, s.cz - s.r, s.cx + s.r, s.cz + s.r]
    else continue
    const area = (x1 - x0) * (z1 - z0)
    const count = Math.min(400, Math.floor(area / (a.kind === 'forest' ? 70 : 260)))
    for (let i = 0; i < count && treeBudget > 0; i++) {
      const x = rand(rng, x0, x1), z = rand(rng, z0, z1)
      const inside = s.type === 'poly' ? pointInPoly(x, z, s.pts) : Math.hypot(x - s.cx, z - s.cz) < s.r - 2
      if (!inside || !free(x, z, 3.5)) continue
      addProp(ctx, 'tree', x, z, rng() * 6)
      mark(x, z)
      treeBudget--
    }
  }

  {
    const nope = new Set<AreaKind>(['water', 'rail', 'parking', 'plaza'])
    const want: Partial<Record<District, number>> = { lutyens: 0.9, government: 0.5, vista: 0.35, residential: 0.35, office: 0.25, station: 0.1, market: 0.12 }
    let urbanBudget = 14000
    for (let i = 0; i < 60000 && urbanBudget > 0; i++) {
      const x = rand(rng, bounds.minX + 5, bounds.maxX - 5), z = rand(rng, bounds.minZ + 5, bounds.maxZ - 5)
      if (rng() > (want[districtAt(x, z)] ?? 0)) continue
      if (ctx.idx.at(x, z, 4) || polyAt(x, z) || areaAt(x, z, nope) || !free(x, z, 6)) continue
      let blocked = false
      for (const b of ctx.bHash.query(x - 12, z - 12, x + 12, z + 12))
        if (Math.abs(b.x - x) < b.w / 2 + 3 + b.d / 2 && Math.abs(b.z - z) < b.d / 2 + 3 + b.w / 2) {
          blocked = true
          break
        }
      if (blocked) continue
      addProp(ctx, 'tree', x, z, rng() * 6)
      mark(x, z)
      urbanBudget--
    }
  }
  if (cfg.flag) addProp(ctx, 'flagpole', cfg.flag.x, cfg.flag.z, 0)
  dressStreets(ctx, pieces, roadById, { busStops: false, stallDensity: 0.3 })
  parkAlongKerbs(ctx, 2.6)

  // parked trains at the main station
  if (cfg.mainStation) {
    const st = data.pois.find((p) => p.k === 'station' && p.n === cfg.mainStation!.poi && !p.sub)
    if (st) {
      let trains = 0
      for (const r of data.rails) {
        if (trains >= 4) break
        let len = 0
        for (let i = 2; i < r.length; i += 2) len += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1])
        if (len < 200 || Math.hypot(r[0] - st.x, r[1] - st.z) > 700) continue
        let placed = 0
        let acc = 0
        for (let i = 2; i < r.length && placed < 12; i += 2) {
          const ax = r[i - 2], az = r[i - 1], bx = r[i], bz = r[i + 1]
          const L = Math.hypot(bx - ax, bz - az)
          for (let s = acc; s < L && placed < 12; s += 23.5) {
            const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L
            if (Math.hypot(x - st.x, z - st.z) > 650) continue
            const p = addProp(ctx, 'coach', x, z, Math.atan2(bx - ax, bz - az))
            p.v = placed === 0 ? 0.01 : 0.5 + trains * 0.1
            placed++
          }
          acc = Math.max(0, acc - L)
        }
        if (placed >= 6) trains++
      }
    }
    // station buildings get the name board
    for (const p of polys) if (p.kind === 'station' && /Railway Station/i.test(p.name)) p.name = cfg.mainStation.sign
  }

  /* ---------------------------------------------------------------- landmarks */
  const landmarks: Landmark[] = []
  const seen = new Set<string>()
  const CAT: Record<string, Landmark['category']> = { landmark: 'monument', station: 'transport', worship: 'monument', park: 'park' }
  for (const p of data.pois) {
    if (!p.n || !CAT[p.k] || /graveyard|information/i.test(p.n)) continue
    // only heritage/memorial landmarks — no commercial venues (galleries, museums run by brands, attractions)
    if (p.k === 'landmark' && !/^(monument|memorial|archaeological_site|tomb|ruins|castle|fort|city_gate|building|wayside_shrine|mosque|temple)$/.test(String(p.sub))) continue
    const key = p.n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    landmarks.push({
      id: 'lm' + landmarks.length, name: p.n, x: p.x, z: p.z, category: CAT[p.k], accuracy: 'osm',
      description: p.k === 'worship' ? `Place of worship (${p.sub})` : p.k === 'station' ? (p.sub ? 'Delhi Metro station' : 'Railway station') : p.k === 'park' ? 'Park' : `Historic site / attraction`,
    })
  }
  for (const pb of polys)
    if (pb.name && (pb.kind === 'gurdwara' || pb.kind === 'mosque' || pb.kind === 'church' || pb.kind === 'temple' || pb.kind === 'monument' || pb.kind === 'yantra') && !seen.has(pb.name.toLowerCase())) {
      seen.add(pb.name.toLowerCase())
      landmarks.push({ id: 'lm' + landmarks.length, name: pb.name, x: pb.cx, z: pb.cz, category: 'monument', accuracy: 'osm', description: 'Landmark' })
    }
  for (const lb of landmarkBuilders)
    if (lb.id === 'india_gate')
      landmarks.unshift({ id: 'india_gate', name: 'India Gate', x: lb.x, z: lb.z, category: 'monument', accuracy: 'osm', description: 'All India War Memorial (1931), designed by Edwin Lutyens.' })
  for (const c of customNames)
    if (!seen.has(c.name.toLowerCase()) && c.name !== 'India Gate') {
      seen.add(c.name.toLowerCase())
      landmarks.unshift({ id: 'custom-' + landmarks.length, name: c.name, x: c.x, z: c.z, category: 'monument', accuracy: 'osm', description: 'Landmark (simplified custom model)' })
    }
  const canopy = data.pois.find((p) => p.k === 'landmark' && /canopy/i.test(p.n ?? ''))
  if (canopy) landmarkBuilders.push({ id: 'canopy', x: canopy.x, z: canopy.z, radius: 12 })

  // plaques: info interactables on the nearest pavement node to each matching landmark
  for (const pq of cfg.plaques) {
    const lm = landmarks.find((l) => pq.match.test(l.name))
    if (!lm) continue
    let best = -1, bd = 120
    for (let i = 0; i < graph.x.length; i++) {
      const d = Math.hypot(graph.x[i] - lm.x, graph.z[i] - lm.z)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    const x = best >= 0 ? graph.x[best] : lm.x
    const z = best >= 0 ? graph.z[best] : lm.z
    ctx.interactables.push({
      id: ctx.interactables.length, type: 'info', x, z, rot: 0, radius: 3.5, label: `Read plaque — ${pq.title}`,
      data: { title: pq.title, text: pq.text },
    } as Interactable)
  }

  /* ------------------------------------------------------------------ labels */
  const labels: LabelSpot[] = []
  const longest = new Map<string, NetEdge>()
  for (const e of net.edges) {
    if (!e.name || e.cls === 'service') continue
    const cur = longest.get(e.name)
    if (!cur || e.len > cur.len) longest.set(e.name, e)
  }
  for (const e of longest.values()) {
    const mid = Math.floor(e.pts.length / 4) * 2
    const ax = e.pts[Math.max(0, mid - 2)], az = e.pts[Math.max(1, mid - 1)]
    const bx = e.pts[Math.min(e.pts.length - 2, mid + 2)], bz = e.pts[Math.min(e.pts.length - 1, mid + 3)]
    labels.push({ text: e.name, x: (ax + bx) / 2, z: (az + bz) / 2, size: e.w >= 12 ? 12 : 10, kind: 'road', angle: Math.atan2(bz - az, bx - ax) })
  }
  for (const d of cfg.districtLabels ?? places.filter((p) => p.k !== 'locality').slice(0, 14).map((p) => ({ text: p.n.toUpperCase(), x: p.x, z: p.z })))
    labels.push({ text: d.text, x: d.x, z: d.z, size: 16, kind: 'district' })

  // procedural buildings as polys too? (kept as boxes — cheaper)
  const chunkSize = 100
  // nothing may poke through a flyover deck or stand on a ramp: clear props in their footprint
  if (flyovers.length) {
    const fh = new SpatialHash<[number, number, number, number, number]>(40)
    for (const f of flyovers)
      for (let i = 0; i + 3 < f.pts.length; i += 2) {
        const [ax, az, bx, bz] = [f.pts[i], f.pts[i + 1], f.pts[i + 2], f.pts[i + 3]]
        const r = f.w / 2 + 2
        fh.insertBox([ax, az, bx, bz, r], Math.min(ax, bx) - r, Math.min(az, bz) - r, Math.max(ax, bx) + r, Math.max(az, bz) + r)
      }
    const before = ctx.props.length
    ctx.props = ctx.props.filter((p) => {
      for (const s of fh.query(p.x, p.z, p.x, p.z)) if (distToSegment(p.x, p.z, s[0], s[1], s[2], s[3]).d < s[4]) return false
      return true
    })
    void before
  }
  const chunks = chunkify(chunkSize, ctx.buildings, [], ctx.props, roads, polys, areas)
  for (const lb of landmarkBuilders) {
    const cx = Math.floor(lb.x / chunkSize), cz = Math.floor(lb.z / chunkSize)
    const k = `${cx},${cz}`
    if (!chunks.has(k)) chunks.set(k, { key: k, cx, cz, buildings: [], arcs: [], props: [], polys: [], areas: [], roadIds: new Set() })
  }

  // make sure the spawn isn't inside a footprint
  let spawn = cfg.spawn ? { ...cfg.spawn } : { x: 0, z: 0, yaw: 0 }
  if (!cfg.spawn) {
    let best = 0, bd = Infinity
    for (let i = 0; i < graph.x.length; i++) {
      const d = Math.hypot(graph.x[i], graph.z[i])
      if (d < bd && graph.adj[i].length) {
        bd = d
        best = i
      }
    }
    spawn = { x: graph.x[best], z: graph.z[best], yaw: Math.atan2(-graph.x[best], -graph.z[best]) }
  }
  for (let k = 0; k < 40 && polyAt(spawn.x, spawn.z); k++) spawn.z += 3
  // a few flats for sale (safehouses) in residential buildings 250–1100 m from the centre
  {
    let made = 0
    const cands = polys.filter((p) => (p.kind === 'residential' || (p.kind === 'generic' && p.district === 'residential')) && Math.hypot(p.cx - spawn.x, p.cz - spawn.z) > 250 && Math.hypot(p.cx - spawn.x, p.cz - spawn.z) < 1100)
    for (let i = 0; i < cands.length && made < 3; i += Math.max(1, Math.floor(cands.length / 7))) {
      const d = doorFor(cands[i].cx, cands[i].cz)
      if (!d) continue
      const price = 150000 + made * 75000
      ctx.interactables.push({
        id: ctx.interactables.length, type: 'property', x: d.x, z: d.z, rot: d.rot, radius: 1.8,
        label: `Flat for sale — ₹${price.toLocaleString('en-IN')} (enter if owned)`, data: { key: `${data.meta.id}:${Math.round(d.x)},${Math.round(d.z)}`, price },
      })
      made++
    }
  }
  // guarantee essential services near the centre (marked as fictional in their labels)
  const services: [string, string, number][] = [
    ['shop_clothes', 'Fashion store (fictional) — browse outfits', 18],
    ['dealer', 'Vehicle showroom (fictional) — buy a ride', 36],
  ]
  for (const [type, label, along] of services) {
    if (ctx.interactables.some((i) => i.type === type && Math.hypot(i.x - spawn.x, i.z - spawn.z) < 900)) continue
    const k = kerbSide(spawn.x + along, spawn.z + along * 0.3, 1.2) ?? { x: spawn.x + along, z: spawn.z, rot: 0 }
    ctx.interactables.push({ id: ctx.interactables.length, type: type as Interactable['type'], x: k.x, z: k.z, rot: k.rot, radius: 3, label })
  }
  // every city gets a travel booking counter near the centre (plus real station counters)
  if (!ctx.interactables.some((i) => i.type === 'train')) {
    const k = kerbSide(spawn.x, spawn.z, 1.4)
    const at = k ?? { x: spawn.x + 2, z: spawn.z, rot: 0 }
    const shelter = addProp(ctx, 'bus_stop', at.x, at.z, at.rot)
    const ck = `${Math.floor(at.x / chunkSize)},${Math.floor(at.z / chunkSize)}`
    if (!chunks.has(ck)) chunks.set(ck, { key: ck, cx: Math.floor(at.x / chunkSize), cz: Math.floor(at.z / chunkSize), buildings: [], arcs: [], props: [], polys: [], areas: [], roadIds: new Set() })
    chunks.get(ck)!.props.push(shelter)
    ctx.interactables.push({ id: ctx.interactables.length, type: 'train', x: at.x + Math.sin(at.rot) * 1.2, z: at.z + Math.cos(at.rot) * 1.2, rot: at.rot, radius: 3, label: 'Travel booking counter — trains to other cities', data: { station: 'city centre' } })
  }

  return {
    id: data.meta.id,
    name: data.meta.name,
    bounds,
    roads,
    buildings: ctx.buildings,
    arcs: [],
    areas,
    props: ctx.props,
    landmarks,
    interactables: ctx.interactables,
    labels,
    graph,
    signals,
    net,
    flyovers,
    polys,
    rails: data.rails,
    areaName,
    attribution: data.meta.attribution,
    spawn,
    districtAt,
    chunkSize,
    chunks,
    landmarkBuilders,
    sidewalkSegs: sidewalkSegs(pieces),
    zebras,
    credits: cfg.credits,
    flag: cfg.flag,
    tropical: cfg.tropical,
  }
}

export { MARKED_CLASSES }
