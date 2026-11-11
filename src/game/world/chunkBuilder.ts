import * as THREE from 'three'
import { GeoBuilder } from '../utils/geoBuilder'
import { SpatialHash, hash2 } from '../utils/math'
import { SIGN_COLS, SIGN_ROWS, facadeTexture } from '../utils/textures'
import { buildLandmark, type Decal } from './landmarks'
import { FACADE_ORDER } from './materials'
import { buildProp, type ColliderSpec } from './models'
import { ROAD_Y, RoadIndex, SIDEWALK_Y, roadDir } from './roads'
import type { Area, ArcBuilding, Building, CityData, ChunkContent, PolyBuilding, Road, Signal, SidewalkSeg } from './types'

export interface BuiltChunk {
  key: string
  ground: THREE.BufferGeometry | null
  water: THREE.BufferGeometry | null
  buildings: THREE.BufferGeometry | null
  props: THREE.BufferGeometry | null
  glow: THREE.BufferGeometry | null
  signs: THREE.BufferGeometry | null
  pools: THREE.BufferGeometry | null
  leaves: THREE.BufferGeometry | null
  fronds: THREE.BufferGeometry | null
  colliders: ColliderSpec[]
  decals: Decal[]
}

/* -------------------------------- per-city cached indices -------------------------------- */
interface CityCache {
  idx: RoadIndex
  segHash: SpatialHash<SidewalkSeg>
  zebraHash: SpatialHash<CityData['zebras'][number]>
  signalHash: SpatialHash<CityData['signals'][number]>
}
const caches = new WeakMap<CityData, CityCache>()
function cacheFor(city: CityData): CityCache {
  let c = caches.get(city)
  if (!c) {
    const segHash = new SpatialHash<SidewalkSeg>(50)
    for (const s of city.sidewalkSegs)
      segHash.insertBox(s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz))
    const zebraHash = new SpatialHash<CityData['zebras'][number]>(50)
    for (const z of city.zebras) zebraHash.insertPoint(z, z.x, z.z)
    const signalHash = new SpatialHash<CityData['signals'][number]>(50)
    for (const s of city.signals) signalHash.insertPoint(s, s.x, s.z)
    c = { idx: new RoadIndex(city.roads), segHash, zebraHash, signalHash }
    caches.set(city, c)
  }
  return c
}

/** Clip segment A→B to an axis-aligned rect; returns param interval or null (Liang–Barsky). */
function clipSeg(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): [number, number] | null {
  let t0 = 0,
    t1 = 1
  const dx = bx - ax,
    dz = bz - az
  const p = [-dx, dx, -dz, dz]
  const q = [ax - x0, x1 - ax, az - z0, z1 - az]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  return t0 < t1 ? [t0, t1] : null
}

const ASPHALT = '#47484b'
const PAVING = '#b3a596'
const CURB = '#8f8a82'

function jitter(base: string, x: number, z: number, amt = 0.06) {
  const c = new THREE.Color(base)
  const j = (hash2(Math.floor(x), Math.floor(z)) - 0.5) * amt
  c.offsetHSL(0, 0, j)
  return c
}

export function buildChunk(city: CityData, chunk: ChunkContent): BuiltChunk {
  const cc = cacheFor(city)
  const S = city.chunkSize
  const x0 = chunk.cx * S,
    z0 = chunk.cz * S,
    x1 = x0 + S,
    z1 = z0 + S
  const inChunk = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1

  const ground = new GeoBuilder()
  const water = new GeoBuilder()
  const props = new GeoBuilder()
  const glow = new GeoBuilder()
  const signs = new GeoBuilder()
  const pools = new GeoBuilder()
  const fol = { leaves: new GeoBuilder(), fronds: new GeoBuilder(), tropical: !!city.tropical }
  const facades = FACADE_ORDER.map(() => new GeoBuilder())
  const colliders: ColliderSpec[] = []
  const decals: Decal[] = []

  /* ------------------------------------- areas ------------------------------------- */
  for (const ai of chunk.areas) addArea(city.areas[ai], ground, water, props, x0, z0, x1, z1, inChunk)

  /* ------------------------------------- roads ------------------------------------- */
  const markQuad = (ax: number, az: number, bx: number, bz: number, w: number, y: number, color: string) => {
    const dx = bx - ax,
      dz = bz - az
    const l = Math.hypot(dx, dz) || 1
    const nx = (dz / l) * (w / 2),
      nz = (-dx / l) * (w / 2)
    ground.groundQuad([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], y, color, 0.5)
  }
  const roadList = city.roads.length > 400 ? [...chunk.roadIds].map((id) => city.roads[id]) : city.roads
  for (const road of roadList) {
    if (road.kind === 'straight') {
      // round joints between the straight pieces of a curved OSM road
      if (road.group !== undefined && inChunk(road.ax, road.az)) disc(ground, road.ax, road.az, road.width / 2, ROAD_Y - 0.002, ASPHALT)
      const iv = clipSeg(road.ax, road.az, road.bx, road.bz, x0, z0, x1, z1)
      if (!iv) continue
      const dir = roadDir(road)
      const nx = dir.z,
        nz = -dir.x
      const hw = road.width / 2
      const s0 = iv[0] * dir.len,
        s1 = iv[1] * dir.len
      const P = (s: number, off: number): [number, number] => [road.ax + dir.x * s + nx * off, road.az + dir.z * s + nz * off]
      ground.groundQuad([P(s0, -hw), P(s1, -hw), P(s1, hw), P(s0, hw)], ROAD_Y, ASPHALT)
      // markings: sample free intervals (not inside a crossing road)
      const marked = road.cls === undefined || MARKED.has(road.cls)
      const lines: { off: number; dashed: boolean; w: number; color: string }[] = marked
        ? [
            { off: hw - 0.45, dashed: false, w: 0.15, color: '#d8d6cf' },
            { off: -hw + 0.45, dashed: false, w: 0.15, color: '#d8d6cf' },
          ]
        : []
      if (marked && !road.divider && (road.lanes >= 1 || (road.oneway && road.width >= 8))) lines.push({ off: 0, dashed: true, w: 0.15, color: '#e8e4d6' })
      if (road.lanes >= 2) {
        lines.push({ off: hw / 2 + 0.3, dashed: true, w: 0.13, color: '#e8e4d6' })
        lines.push({ off: -hw / 2 - 0.3, dashed: true, w: 0.13, color: '#e8e4d6' })
      }
      const step = 1
      for (const L of lines) {
        let start = -1
        for (let s = Math.floor(s0); s <= s1 + step; s += step) {
          const ss = Math.min(s, s1)
          const [px, pz] = P(ss, L.off)
          const free = ss < s1 && !cc.idx.at(px, pz, 1.2, road) && (!L.dashed || Math.floor(ss / 3) % 2 === 0)
          if (free && start < 0) start = Math.max(ss, s0)
          if ((!free || ss >= s1) && start >= 0) {
            if (ss - start > 0.3) {
              const [ax, az] = P(start, L.off)
              const [bx, bz] = P(ss, L.off)
              markQuad(ax, az, bx, bz, L.w, ROAD_Y + 0.006, L.color)
            }
            start = -1
          }
          if (ss >= s1) break
        }
      }
      // central median with the classic black-and-yellow kerb paint
      if (road.divider) {
        for (let s = Math.floor(s0 / 2) * 2; s < s1; s += 2) {
          if (s < s0) continue
          const [px, pz] = P(s + 1, 0)
          if (cc.idx.at(px, pz, 2.5, road)) continue
          const yaw = Math.atan2(dir.x, dir.z)
          props.prim('box', px, 0.13, pz, 0.7, 0.26, 2.0, Math.floor(s / 2) % 2 ? '#e9c32a' : '#202020', yaw)
          if (Math.floor(s / 2) % 6 === 0) props.prim('box', px, 0.5, pz, 0.5, 0.5, 0.5, '#4f7a32', yaw)
        }
      }
    } else {
      const c = road
      if (c.cx + c.r1 < x0 || c.cx - c.r1 > x1 || c.cz + c.r1 < z0 || c.cz - c.r1 > z1) continue
      const n = Math.ceil((2 * Math.PI * c.r1) / 3)
      const rm = (c.r0 + c.r1) / 2
      const lanes = Math.max(2, Math.round((c.r1 - c.r0) / 3.5))
      const P = (r: number, a: number): [number, number] => [c.cx + Math.sin(a) * r, c.cz - Math.cos(a) * r]
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2,
          a1 = ((i + 1) / n) * Math.PI * 2
        const am = (a0 + a1) / 2
        const [mx, mz] = P(rm, am)
        if (!inChunk(mx, mz)) continue
        ground.groundQuad([P(c.r0, a0), P(c.r1, a0), P(c.r1, a1), P(c.r0, a1)], ROAD_Y, ASPHALT)
        for (let k = 1; k < lanes; k++) {
          if (i % 2) break
          const r = c.r0 + ((c.r1 - c.r0) * k) / lanes
          const [px, pz] = P(r, am)
          if (cc.idx.at(px, pz, 1.2, road)) continue
          const [ax, az] = P(r, a0)
          const [bx, bz] = P(r, a1)
          markQuad(ax, az, bx, bz, 0.13, ROAD_Y + 0.006, '#e8e4d6')
        }
        for (const r of [c.r0 + 0.45, c.r1 - 0.45]) {
          const [px, pz] = P(r, am)
          if (cc.idx.at(px, pz, 1.2, road)) continue
          const [ax, az] = P(r, a0)
          const [bx, bz] = P(r, a1)
          markQuad(ax, az, bx, bz, 0.15, ROAD_Y + 0.006, '#d8d6cf')
        }
      }
    }
  }

  /* ------------------------------- zebra crossings & signals ------------------------------- */
  for (const zb of cc.zebraHash.query(x0, z0, x1 - 0.001, z1 - 0.001)) {
    if (!inChunk(zb.x, zb.z)) continue
    const fx = Math.sin(zb.rot),
      fz = Math.cos(zb.rot)
    const half = zb.len / 2
    for (let s = -half + 0.4; s < half - 0.3; s += 1.0) {
      const cx = zb.x + fx * s,
        cz = zb.z + fz * s
      // stripe: 0.5 along walking dir, 3.0 across
      const px = -fz * 1.5,
        pz = fx * 1.5
      const ax = fx * 0.25,
        az = fz * 0.25
      ground.groundQuad(
        [[cx - ax - px, cz - az - pz], [cx + ax - px, cz + az - pz], [cx + ax + px, cz + az + pz], [cx - ax + px, cz - az + pz]],
        ROAD_Y + 0.01,
        '#ecebe4',
        0.5,
      )
    }
  }
  for (const s of cc.signalHash.query(x0, z0, x1 - 0.001, z1 - 0.001)) {
    if (!inChunk(s.x, s.z)) continue
    for (const pole of signalPoles(s)) {
      props.prim('cyl8', pole.x, 2.1, pole.z, 0.16, 4.2, 0.16, '#2b2b2b')
      props.prim('box', pole.x, 0.4, pole.z, 0.3, 0.8, 0.3, '#e9c32a', s.axis)
      // housings facing both phases; lamps are drawn by the live SignalsLayer
      for (const h of pole.heads) props.prim('box', h.x, 3.6, h.z, 0.34, 1.05, 0.34, '#151515', s.axis)
      colliders.push({ x: pole.x, y: 2, z: pole.z, hw: 0.15, hh: 2, hd: 0.15, rot: 0 })
    }
  }

  /* -------------------------------------- pavements ------------------------------------- */
  for (const seg of cc.segHash.query(x0, z0, x1, z1)) {
    const iv = clipSeg(seg.ax, seg.az, seg.bx, seg.bz, x0, z0, x1, z1)
    if (!iv) continue
    const foot = seg.w < 3.5
    const ax = seg.ax + (seg.bx - seg.ax) * iv[0],
      az = seg.az + (seg.bz - seg.az) * iv[0]
    const bx = seg.ax + (seg.bx - seg.ax) * iv[1],
      bz = seg.az + (seg.bz - seg.az) * iv[1]
    const l = Math.hypot(bx - ax, bz - az)
    if (l < 0.01) continue
    const nx = ((bz - az) / l) * (seg.w / 2),
      nz = (-(bx - ax) / l) * (seg.w / 2)
    const y = foot ? 0.05 : SIDEWALK_Y
    const color = foot ? '#c8b393' : PAVING
    ground.groundQuad([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], y, jitter(color, ax, az, 0.05))
    if (!foot) {
      // kerb faces on both long sides
      ground.quad([bx + nx, 0, bz + nz], [ax + nx, 0, az + nz], [ax + nx, y, az + nz], [bx + nx, y, bz + nz], CURB)
      ground.quad([ax - nx, 0, az - nz], [bx - nx, 0, bz - nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], CURB)
    }
  }

  /* -------------------------------------- buildings ------------------------------------- */
  const fIdx = (s: string) => FACADE_ORDER.indexOf(s as never)
  for (const b of chunk.buildings) addBuilding(b, facades, props, signs, colliders, fIdx)
  for (const a of chunk.arcs) addArc(a, facades, props, signs, colliders, fIdx)
  for (const pb of chunk.polys) addPoly(pb, facades, props, glow, signs, colliders, decals, fIdx)
  for (const r of city.rails) addRail(r, ground, props, inChunk)

  /* ---------------------------------------- props --------------------------------------- */
  for (const p of chunk.props) {
    // parked vehicles are live, enterable entities (vehicles/ParkedVehicles.tsx)
    if (p.type === 'car_parked' || p.type === 'scooter_parked' || p.type === 'auto_parked') continue
    buildProp(p, props, glow, colliders, fol)
    if (p.type === 'lamp') {
      const fx = Math.sin(p.rot),
        fz = Math.cos(p.rot)
      const cx = p.x + fx * 2.2,
        cz = p.z + fz * 2.2
      const R = 6.5
      pools.quad([cx - R, 0.14, cz + R], [cx + R, 0.14, cz + R], [cx + R, 0.14, cz - R], [cx - R, 0.14, cz - R], '#ffffff')
    }
  }

  /* -------------------------------------- landmarks ------------------------------------- */
  for (const lb of city.landmarkBuilders)
    if (inChunk(lb.x, lb.z)) buildLandmark(lb.id, lb.x, lb.z, { b: props, g: glow, colliders, decals })

  return {
    key: chunk.key,
    ground: ground.vertexCount ? ground.build() : null,
    water: water.vertexCount ? water.build() : null,
    buildings: mergeGroups(facades),
    props: props.vertexCount ? props.build() : null,
    glow: glow.vertexCount ? glow.build() : null,
    signs: signs.vertexCount ? signs.build() : null,
    pools: pools.vertexCount ? pools.build() : null,
    leaves: fol.leaves.vertexCount ? fol.leaves.build() : null,
    fronds: fol.fronds.vertexCount ? fol.fronds.build() : null,
    colliders,
    decals,
  }
}

/* ------------------------------------- building helpers ------------------------------------ */

type V3 = [number, number, number]

function wall(
  b: GeoBuilder,
  P: [number, number],
  Q: [number, number],
  y0: number,
  y1: number,
  color: string,
  tile: { tileW: number; tileH: number },
  u0: number,
) {
  const len = Math.hypot(Q[0] - P[0], Q[1] - P[1])
  const v0 = y0 / tile.tileH,
    v1 = y1 / tile.tileH
  const u1 = u0 + len / tile.tileW
  b.quad([P[0], y0, P[1]] as V3, [Q[0], y0, Q[1]] as V3, [Q[0], y1, Q[1]] as V3, [P[0], y1, P[1]] as V3, color, [u0, v0, u1, v0, u1, v1, u0, v1])
  // baked ambient occlusion where walls meet the street
  if (y0 < 0.1) b.shadeLastQuadBottom(Math.max(0.55, 1 - 2.2 / Math.max(2.5, y1 - y0)))
}

/**
 * 3D façade detail lined up with the painted windows of the façade texture (4 bays × 4 floors per
 * tile): concrete sunshades (chajjas), balconies with railings, AC units, cornices, office mullions.
 * This is what turns flat textured boxes into buildings with depth and shadow.
 */
function facadeDetail(
  props: GeoBuilder,
  A: [number, number],
  B: [number, number],
  y0: number,
  y1: number,
  style: string,
  color: string,
  tile: { tileW: number; tileH: number },
  u0: number,
  cx: number,
  cz: number,
) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1])
  if (len < 2.5 || y1 - y0 < 2.5) return
  const dx = (B[0] - A[0]) / len,
    dz = (B[1] - A[1]) / len
  // outward normal (away from the building centre)
  let nx = dz,
    nz = -dx
  const mx = (A[0] + B[0]) / 2,
    mz = (A[1] + B[1]) / 2
  if ((mx - cx) * nx + (mz - cz) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  const rot = Math.atan2(dx, dz) // box local z along the wall
  const bayW = tile.tileW / 4,
    fh = tile.tileH / 4
  const shade = new THREE.Color(color).multiplyScalar(0.86).getStyle()
  const light = new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35).getStyle()
  /** box centred at distance t along the wall, height y, protruding `out` from the wall */
  const box = (t: number, y: number, out: number, along: number, h: number, depth: number, col: string) =>
    props.prim('box', A[0] + dx * t + nx * out, y, A[1] + dz * t + nz * out, depth, h, along, col, rot)
  const strip = (y: number, h: number, depth: number, col: string) => box(len / 2, y, depth / 2, len + depth * 0.6, h, depth, col)
  const firstFloor = Math.ceil((y0 + 0.01) / fh)
  const lastFloor = Math.floor((y1 - 0.2) / fh) - 1
  const floors = Math.min(lastFloor - firstFloor + 1, 14)
  const seedBase = Math.floor(A[0] * 7.1 + A[1] * 3.3)

  if (style === 'office') {
    // curtain wall: spandrel bands + vertical mullion fins
    for (let k = 0; k < floors; k++) strip((firstFloor + k) * fh + 0.2, 0.42, 0.14, '#c8ccd0')
    const start = (((-u0 * tile.tileW) % bayW) + bayW) % bayW
    for (let t = start; t < len; t += bayW) box(t, (y0 + y1) / 2, 0.16, 0.12, y1 - y0, 0.32, '#aeb4b9')
    strip(y1 - 0.25, 0.5, 0.35, '#b9bec2')
    return
  }
  if (style === 'colonial' || style === 'government') {
    strip(y1 - 0.3, 0.55, 0.55, light) // cornice
    strip(y1 - 0.75, 0.2, 0.3, shade)
    for (let k = 0; k < floors; k++) strip((firstFloor + k) * fh + 0.05, 0.22, 0.18, light) // floor bands
    if (y0 < 0.1) strip(0.45, 0.9, 0.22, shade) // plinth
  }
  if (style !== 'residential' && style !== 'colonial' && style !== 'government') return
  // per-window detail
  const winW = (style === 'residential' ? 0.64 : style === 'colonial' ? 0.44 : 0.4) * bayW
  const top = style === 'colonial' ? 0.84 : 0.78,
    bot = style === 'colonial' ? 0.16 : 0.28
  const start = (((0.5 * bayW - u0 * tile.tileW) % bayW) + bayW) % bayW
  for (let k = 0; k < floors; k++) {
    const base = (firstFloor + k) * fh
    if (style === 'residential') strip(base + fh * top + 0.12, 0.1, 0.55, shade) // continuous chajja
    for (let t = start, w = 0; t < len - winW / 2; t += bayW, w++) {
      if (t < winW / 2) continue
      const h = hash2(seedBase + w * 31, k * 17 + Math.floor(base))
      // window sill
      box(t, base + fh * bot - 0.05, 0.1, winW + 0.2, 0.09, 0.2, light)
      if (style !== 'residential') continue
      if (h < 0.22 && base > 2.5) {
        // balcony: slab, front railing, side railings
        const by = base + fh * bot - 0.12
        box(t, by, 0.6, winW + 0.7, 0.14, 1.2, shade)
        box(t, by + 0.5, 1.15, winW + 0.7, 0.85, 0.06, h < 0.08 ? '#3b3e42' : light)
        box(t - (winW + 0.7) / 2, by + 0.5, 0.6, 0.06, 0.85, 1.2, '#3b3e42')
        box(t + (winW + 0.7) / 2, by + 0.5, 0.6, 0.06, 0.85, 1.2, '#3b3e42')
      } else if (h > 0.86) {
        // window AC unit
        box(t + winW * 0.22, base + fh * bot - 0.38, 0.22, 0.75, 0.5, 0.42, '#e7e5df')
      }
    }
  }
}

const AWNING = ['#b8322a', '#1f6f8b', '#2f7d4a', '#d08a1c', '#6b4c9a', '#c0c3c6', '#7a2e2e']
/** sloping fabric/tin awning over a ground-floor shopfront (below the sign board) */
function awning(props: GeoBuilder, A: [number, number], B: [number, number], cx: number, cz: number, seed: number) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1])
  if (len < 3) return
  const dx = (B[0] - A[0]) / len,
    dz = (B[1] - A[1]) / len
  let nx = dz,
    nz = -dx
  if (((A[0] + B[0]) / 2 - cx) * nx + ((A[1] + B[1]) / 2 - cz) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  const col = AWNING[Math.abs(seed) % AWNING.length]
  const rot = Math.atan2(dx, dz)
  const w = len - 0.6
  // slab tilted down and away from the wall (rotX on the box's local axes)
  props.prim('box', (A[0] + B[0]) / 2 + nx * 0.7, 2.95, (A[1] + B[1]) / 2 + nz * 0.7, 1.45, 0.06, w, col, rot, 0, 0.28 * (nx * Math.cos(rot) - nz * Math.sin(rot) >= 0 ? -1 : 1))
  props.prim('box', (A[0] + B[0]) / 2 + nx * 1.4, 2.72, (A[1] + B[1]) / 2 + nz * 1.4, 0.04, 0.3, w, col, rot)
}

function signQuad(signs: GeoBuilder, P: [number, number], Q: [number, number], nx: number, nz: number, y0: number, y1: number, idx: number) {
  const col = idx % SIGN_COLS,
    row = Math.floor(idx / SIGN_COLS) % SIGN_ROWS
  const u0 = col / SIGN_COLS,
    u1 = (col + 1) / SIGN_COLS
  const v0 = 1 - (row + 1) / SIGN_ROWS,
    v1 = 1 - row / SIGN_ROWS
  const o = 0.07
  signs.quad(
    [P[0] + nx * o, y0, P[1] + nz * o],
    [Q[0] + nx * o, y0, Q[1] + nz * o],
    [Q[0] + nx * o, y1, Q[1] + nz * o],
    [P[0] + nx * o, y1, P[1] + nz * o],
    '#ffffff',
    [u0, v0, u1, v0, u1, v1, u0, v1],
  )
}

function addBuilding(
  b: Building,
  facades: GeoBuilder[],
  props: GeoBuilder,
  signs: GeoBuilder,
  colliders: ColliderSpec[],
  fIdx: (s: string) => number,
) {
  const c = Math.cos(b.rot),
    s = Math.sin(b.rot)
  const W = (lx: number, lz: number): [number, number] => [b.x + lx * c + lz * s, b.z - lx * s + lz * c]
  const hw = b.w / 2,
    hd = b.d / 2
  const style = facades[fIdx(b.style)]
  const tile = facadeTexture(b.style)
  const shopTile = facadeTexture('shop')
  const uOff = hash2(Math.floor(b.x), Math.floor(b.z)) * 4
  const faces: [[number, number], [number, number], boolean][] = [
    [W(-hw, hd), W(hw, hd), true],
    [W(hw, hd), W(hw, -hd), false],
    [W(hw, -hd), W(-hw, -hd), false],
    [W(-hw, -hd), W(-hw, hd), false],
  ]
  const shopH = 4.2
  for (const [P, Q, front] of faces) {
    if (front && b.shopFloor) {
      wall(facades[0], P, Q, 0, shopH, b.color, shopTile, uOff)
      wall(style, P, Q, shopH, b.h, b.color, tile, uOff)
      facadeDetail(props, P, Q, shopH, b.h, b.style, b.color, tile, uOff, b.x, b.z)
      awning(props, P, Q, b.x, b.z, Math.floor(b.x * 13 + b.z))
    } else {
      wall(style, P, Q, 0, b.h, b.color, tile, uOff)
      facadeDetail(props, P, Q, 0, b.h, b.style, b.color, tile, uOff, b.x, b.z)
    }
  }
  // roof + parapet + rooftop clutter
  facades[facades.length - 1].groundQuad([W(-hw, -hd), W(hw, -hd), W(hw, hd), W(-hw, hd)], b.h, b.roof)
  const par = new THREE.Color(b.color).multiplyScalar(0.88).getStyle()
  props.boxLocal(b.x, b.z, b.rot, 0, b.h + 0.45, hd - 0.12, b.w, 0.9, 0.25, par)
  props.boxLocal(b.x, b.z, b.rot, 0, b.h + 0.45, -hd + 0.12, b.w, 0.9, 0.25, par)
  props.boxLocal(b.x, b.z, b.rot, hw - 0.12, b.h + 0.45, 0, 0.25, 0.9, b.d, par)
  props.boxLocal(b.x, b.z, b.rot, -hw + 0.12, b.h + 0.45, 0, 0.25, 0.9, b.d, par)
  for (let i = 0; i < b.tanks; i++) {
    const lx = (hash2(i * 7 + Math.floor(b.x), Math.floor(b.z)) - 0.5) * (b.w - 3)
    const lz = (hash2(Math.floor(b.x), i * 13 + Math.floor(b.z)) - 0.5) * (b.d - 3)
    props.primLocal('cyl12', b.x, b.z, b.rot, lx, b.h + 1.3, lz, 1.3, 1.4, 1.3, '#1c1c1c')
    props.boxLocal(b.x, b.z, b.rot, lx, b.h + 0.3, lz, 1.4, 0.6, 1.4, '#7a7570')
  }
  if (b.style === 'office') props.boxLocal(b.x, b.z, b.rot, b.w * 0.15, b.h + 1.6, -b.d * 0.15, b.w * 0.35, 3.2, b.d * 0.35, '#9a9ea2')
  if (b.style === 'residential' && b.h < 14 && hash2(Math.floor(b.x * 3), Math.floor(b.z)) < 0.35) {
    // staircase "mumty" room on the roof
    props.boxLocal(b.x, b.z, b.rot, -b.w * 0.25, b.h + 1.4, -b.d * 0.2, 3, 2.8, 3.2, b.color)
  }
  // shop sign on the front
  if (b.sign >= 0 && b.shopFloor) {
    const sw = Math.min(b.w * 0.86, 7.5)
    signQuad(signs, W(-sw / 2, hd), W(sw / 2, hd), s, c, 3.15, 4.15, b.sign)
  } else if (b.sign >= 0 && b.style === 'office') {
    const sw = Math.min(b.w * 0.6, 12)
    signQuad(signs, W(-sw / 2, hd), W(sw / 2, hd), s, c, b.h - 2.4, b.h - 0.6, b.sign)
  }
  colliders.push({ x: b.x, y: b.h / 2, z: b.z, hw, hh: b.h / 2, hd, rot: b.rot })
}

function addArc(
  a: ArcBuilding,
  facades: GeoBuilder[],
  props: GeoBuilder,
  signs: GeoBuilder,
  colliders: ColliderSpec[],
  fIdx: (s: string) => number,
) {
  const colonial = facades[fIdx('colonial')]
  const shop = facades[0]
  const roof = facades[facades.length - 1]
  const tile = facadeTexture('colonial')
  const shopTile = facadeTexture('shop')
  const ang = (r: number, t: number) => {
    const k = (r - a.r0) / (a.r1 - a.r0)
    const s0 = a.aIn0 + (a.aOut0 - a.aIn0) * k
    const s1 = a.aIn1 + (a.aOut1 - a.aIn1) * k
    return s0 + (s1 - s0) * t
  }
  const pos = (r: number, an: number): [number, number] => [a.cx + Math.sin(an) * r, a.cz - Math.cos(an) * r]
  const arcLen = (a.aOut1 - a.aOut0) * a.r1
  const n = Math.max(2, Math.ceil(arcLen / 3))
  const FH = 4.4 // ground floor height
  const inner = a.colonnade.side === 'inner'
  const g0 = inner ? a.r0 + a.colonnade.depth : a.r0
  const g1 = inner ? a.r1 : a.r1 - a.colonnade.depth
  let uIn = 0,
    uOut = 0,
    uG0 = 0,
    uG1 = 0
  for (let i = 0; i < n; i++) {
    const t0 = i / n,
      t1 = (i + 1) / n
    // upper floors
    const o0 = pos(a.r1, ang(a.r1, t0)),
      o1 = pos(a.r1, ang(a.r1, t1))
    const i0 = pos(a.r0, ang(a.r0, t0)),
      i1 = pos(a.r0, ang(a.r0, t1))
    wall(colonial, o1, o0, FH, a.h, a.color, tile, uOut)
    uOut += Math.hypot(o1[0] - o0[0], o1[1] - o0[1]) / tile.tileW
    wall(colonial, i0, i1, FH, a.h, a.color, tile, uIn)
    uIn += Math.hypot(i1[0] - i0[0], i1[1] - i0[1]) / tile.tileW
    roof.groundQuad([i0, o0, o1, i1], a.h, '#a19c93')
    // colonnade ceiling (facing down) and fascia band
    const c0r = inner ? a.r0 : g1,
      c1r = inner ? g0 : a.r1
    const ca = pos(c0r, ang(c0r, t0)),
      cb = pos(c1r, ang(c1r, t0)),
      cc = pos(c1r, ang(c1r, t1)),
      cd = pos(c0r, ang(c0r, t1))
    roof.groundQuad([ca, cb, cc, cd], FH, '#d9d3c6', 0.125, true)
    // ground floor shopfronts
    const ga0 = pos(g0, ang(g0, t0)),
      ga1 = pos(g0, ang(g0, t1))
    const gb0 = pos(g1, ang(g1, t0)),
      gb1 = pos(g1, ang(g1, t1))
    wall(shop, ga0, ga1, 0, FH, '#f4f1ea', shopTile, uG0)
    uG0 += Math.hypot(ga1[0] - ga0[0], ga1[1] - ga0[1]) / shopTile.tileW
    wall(shop, gb1, gb0, 0, FH, '#f4f1ea', shopTile, uG1)
    uG1 += Math.hypot(gb1[0] - gb0[0], gb1[1] - gb0[1]) / shopTile.tileW
    // signs every other slice on both shop faces
    if (i % 2 === 0 && i < n - 1) {
      const sidx = Math.floor(hash2(i * 31 + Math.floor(a.aIn0 * 100), Math.floor(a.r0)) * SIGN_COLS * SIGN_ROWS)
      const tm = (t0 + t1) / 2
      const nIn = { x: -Math.sin(ang(g0, tm)), z: Math.cos(ang(g0, tm)) }
      signQuad(signs, ga0, ga1, nIn.x, nIn.z, 3.0, 3.85, sidx)
      signQuad(signs, gb1, gb0, -nIn.x, -nIn.z, 3.0, 3.85, (sidx + 7) % (SIGN_COLS * SIGN_ROWS))
    }
  }
  // end caps
  for (const t of [0, 1]) {
    const P = pos(a.r0, ang(a.r0, t)),
      Q = pos(a.r1, ang(a.r1, t))
    if (t === 0) wall(colonial, Q, P, FH, a.h, a.color, tile, 0)
    else wall(colonial, P, Q, FH, a.h, a.color, tile, 0)
    const gP = pos(g0, ang(g0, t)),
      gQ = pos(g1, ang(g1, t))
    if (t === 0) wall(colonial, gQ, gP, 0, FH, a.color, tile, 0)
    else wall(colonial, gP, gQ, 0, FH, a.color, tile, 0)
  }
  // parapet balustrade on the roof edges
  const pr = a.colonnade.pillarR
  const pillarCount = Math.floor(((ang(pr, 1) - ang(pr, 0)) * pr) / 3.6)
  for (let k = 0; k < pillarCount; k++) {
    const an = ang(pr, (k + 0.5) / pillarCount)
    const [px, pz] = pos(pr, an)
    props.prim('cyl12', px, FH / 2, pz, 0.62, FH, 0.62, '#f6f3ec')
    props.prim('box', px, 0.25, pz, 0.85, 0.5, 0.85, '#e3ddd0', -an)
    colliders.push({ x: px, y: FH / 2, z: pz, hw: 0.3, hh: FH / 2, hd: 0.3, rot: -an })
  }
  // colliders: ground floor block in ~9 m pieces + upper mass
  const pieces = Math.max(1, Math.ceil(n / 3))
  for (let k = 0; k < pieces; k++) {
    const tm = (k + 0.5) / pieces
    const rm = (g0 + g1) / 2
    const an = ang(rm, tm)
    const [cx, cz] = pos(rm, an)
    const span = (ang(g1, (k + 1) / pieces) - ang(g1, k / pieces)) * g1
    colliders.push({ x: cx, y: a.h / 2, z: cz, hw: span / 2 + 0.3, hh: a.h / 2, hd: (g1 - g0) / 2, rot: -an })
    const rU = (a.r0 + a.r1) / 2
    const [ux, uz] = pos(rU, ang(rU, tm))
    colliders.push({ x: ux, y: (FH + 0.3 + a.h) / 2, z: uz, hw: span / 2 + 0.3, hh: (a.h - FH - 0.3) / 2, hd: (a.r1 - a.r0) / 2, rot: -ang(rU, tm) })
  }
}

/** Merge several builders into one geometry with a material group per builder. */
function mergeGroups(builders: GeoBuilder[]): THREE.BufferGeometry | null {
  const total = builders.reduce((n, b) => n + b.vertexCount, 0)
  if (!total) return null
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [],
    uv: number[] = [],
    idx: number[] = []
  const g = new THREE.BufferGeometry()
  let start = 0
  builders.forEach((b, mi) => {
    const base = pos.length / 3
    for (let i = 0; i < b.pos.length; i++) pos.push(b.pos[i])
    for (let i = 0; i < b.nor.length; i++) nor.push(b.nor[i])
    for (let i = 0; i < b.col.length; i++) col.push(b.col[i])
    for (let i = 0; i < b.uv.length; i++) uv.push(b.uv[i])
    for (let i = 0; i < b.idx.length; i++) idx.push(b.idx[i] + base)
    if (b.idx.length) g.addGroup(start, b.idx.length, mi)
    start += b.idx.length
  })
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  return g
}

/** Cheap far-distance representation: plain coloured boxes. */
export function buildLod(city: CityData, chunk: ChunkContent): THREE.BufferGeometry | null {
  const b = new GeoBuilder()
  for (const bd of chunk.buildings) {
    const c = new THREE.Color(bd.color).multiplyScalar(0.82)
    b.prim('box', bd.x, bd.h / 2, bd.z, bd.w, bd.h, bd.d, c, bd.rot)
  }
  for (const a of chunk.arcs) {
    const n = 8
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      const rm = (a.r0 + a.r1) / 2
      const an = a.aIn0 + (a.aIn1 - a.aIn0) * t
      const span = ((a.aOut1 - a.aOut0) * a.r1) / n
      b.prim('box', a.cx + Math.sin(an) * rm, a.h / 2, a.cz - Math.cos(an) * rm, span, a.h, a.r1 - a.r0, '#d9d4c9', -an)
    }
  }
  for (const lb of city.landmarkBuilders) {
    const S = city.chunkSize
    if (Math.floor(lb.x / S) !== chunk.cx || Math.floor(lb.z / S) !== chunk.cz) continue
    if (lb.id === 'india_gate') {
      b.prim('box', lb.x, 21, lb.z, 9.5, 42, 30, '#d6b089')
    } else if (lb.id === 'station') b.prim('box', lb.x, 9, lb.z, 200, 18, 30, '#8e3b2e')
  }
  for (const p of chunk.props) if (p.type === 'tree') b.prim('cone8', p.x, 4.5, p.z, 4.5, 7, 4.5, '#4d7330')
  for (const pb of chunk.polys) {
    const ring: [number, number][] = []
    for (let i = 0; i < pb.pts.length; i += 2) ring.push([pb.pts[i], pb.pts[i + 1]])
    const c = new THREE.Color(pb.color).multiplyScalar(0.82)
    const tri = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
    b.flatTris(ring, tri, pb.h, c)
    for (let i = 0; i < ring.length; i++) {
      const P = ring[i], Q = ring[(i + 1) % ring.length]
      b.quad([Q[0], 0, Q[1]], [P[0], 0, P[1]], [P[0], pb.h, P[1]], [Q[0], pb.h, Q[1]], c)
    }
  }
  const S = city.chunkSize
  const X0 = chunk.cx * S, Z0 = chunk.cz * S
  for (const ai of chunk.areas) {
    const a = city.areas[ai]
    if (a.shape.type !== 'poly' || (a.kind !== 'grass' && a.kind !== 'water' && a.kind !== 'forest')) continue
    addPolyClipped(a.shape.pts, b, X0, Z0, X0 + S, Z0 + S, 0.015, a.kind === 'water' ? '#3f6f78' : '#557f36')
  }
  return b.vertexCount ? b.build() : null
}

export type { Road }

/* ===================================== Phase 2 helpers ===================================== */

const MARKED = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link'])

function disc(b: GeoBuilder, x: number, z: number, r: number, y: number, color: string) {
  const pts: [number, number][] = [[x, z]]
  const tris: number[][] = []
  const n = 10
  for (let i = 0; i < n; i++) pts.push([x + Math.cos((i / n) * Math.PI * 2) * r, z + Math.sin((i / n) * Math.PI * 2) * r])
  for (let i = 0; i < n; i++) tris.push([0, 1 + i, 1 + ((i + 1) % n)])
  b.flatTris(pts, tris, y, color)
}

/** Signal poles at the 4 corners of a (possibly rotated) junction, each with two heads. */
export function signalPoles(s: Signal) {
  const ca = Math.cos(s.axis), sa = Math.sin(s.axis)
  // local frame: +v along phase-0 axis (sin, cos), +u across (cos, -sin)
  const W = (u: number, v: number) => ({ x: s.x + u * ca + v * sa, z: s.z - u * sa + v * ca })
  const out: { x: number; z: number; heads: { x: number; z: number; axis: 0 | 1 }[] }[] = []
  for (const su of [-1, 1])
    for (const sv of [-1, 1]) {
      const u = su * (s.hw1 + 1.4), v = sv * (s.hw0 + 1.4)
      const p = W(u, v)
      out.push({ ...p, heads: [{ ...W(u, v + sv * 0.34), axis: 0 }, { ...W(u + su * 0.34, v), axis: 1 }] })
    }
  return out
}

const AREA_Y: Record<string, number> = { sand: 0.012, grass: 0.014, forest: 0.014, dirt: 0.01, plaza: 0.018, sandstone: 0.02, water: 0.045, parking: 0.016, rail: 0.011, campus: 0.008 }
const AREA_COL: Record<string, string> = {
  sand: '#dccb9f', grass: '#5b8a3a', forest: '#4d7a33', dirt: '#9a8166', plaza: '#b9b0a3', sandstone: '#c99f7a', water: '#000', parking: '#6d6c6a', rail: '#7d6e5f', campus: '#a99a83',
}

/** Sutherland–Hodgman clip of a polygon (x,z pairs) to a rectangle, then triangulate & emit. */
function addPolyClipped(pts: number[], b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color: string) {
  let poly: [number, number][] = []
  for (let i = 0; i < pts.length; i += 2) poly.push([pts[i], pts[i + 1]])
  const clip = (inside: (p: [number, number]) => boolean, inter: (a: [number, number], c: [number, number]) => [number, number]) => {
    const out: [number, number][] = []
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], prev = poly[(i - 1 + poly.length) % poly.length]
      const ci = inside(cur), pi = inside(prev)
      if (ci) {
        if (!pi) out.push(inter(prev, cur))
        out.push(cur)
      } else if (pi) out.push(inter(prev, cur))
    }
    poly = out
  }
  const ix = (X: number) => (a: [number, number], c: [number, number]): [number, number] => [X, a[1] + ((c[1] - a[1]) * (X - a[0])) / (c[0] - a[0])]
  const iz = (Z: number) => (a: [number, number], c: [number, number]): [number, number] => [a[0] + ((c[0] - a[0]) * (Z - a[1])) / (c[1] - a[1]), Z]
  clip((p) => p[0] >= x0, ix(x0))
  if (poly.length < 3) return
  clip((p) => p[0] <= x1, ix(x1))
  if (poly.length < 3) return
  clip((p) => p[1] >= z0, iz(z0))
  if (poly.length < 3) return
  clip((p) => p[1] <= z1, iz(z1))
  if (poly.length < 3) return
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), [])
  b.flatTris(poly, tris, y, color)
}

function addArea(
  a: Area,
  ground: GeoBuilder,
  water: GeoBuilder,
  props: GeoBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  inChunk: (x: number, z: number) => boolean,
) {
  const tgt = a.kind === 'water' ? water : ground
  const y = AREA_Y[a.kind] ?? 0.012
  const col = AREA_COL[a.kind] ?? '#888'
  const sh = a.shape
  if (sh.type === 'poly') {
    addPolyClipped(sh.pts, tgt, x0, z0, x1, z1, y, col)
    return
  }
  if (sh.type === 'rect') {
    const ax0 = Math.max(x0, sh.x - sh.w / 2), ax1 = Math.min(x1, sh.x + sh.w / 2)
    const az0 = Math.max(z0, sh.z - sh.d / 2), az1 = Math.min(z1, sh.z + sh.d / 2)
    if (ax0 >= ax1 || az0 >= az1) return
    tgt.groundQuad([[ax0, az0], [ax1, az0], [ax1, az1], [ax0, az1]], y, col)
    if (a.kind === 'water')
      for (const ez of [sh.z - sh.d / 2, sh.z + sh.d / 2]) if (ez >= z0 && ez < z1) props.boxBase((ax0 + ax1) / 2, 0, ez, ax1 - ax0, 0.25, 0.6, '#c2ae92')
    return
  }
  const c = sh
  if (c.cx + c.r < x0 || c.cx - c.r > x1 || c.cz + c.r < z0 || c.cz - c.r > z1) return
  const ringsN = Math.ceil(c.r / 4)
  for (let ri = 0; ri < ringsN; ri++) {
    const ra = (ri / ringsN) * c.r, rb = ((ri + 1) / ringsN) * c.r
    const n = Math.max(8, Math.ceil((2 * Math.PI * rb) / 4))
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
      const am = (a0 + a1) / 2, rm = (ra + rb) / 2
      if (!inChunk(c.cx + Math.sin(am) * rm, c.cz - Math.cos(am) * rm)) continue
      const P = (r: number, ang: number): [number, number] => [c.cx + Math.sin(ang) * r, c.cz - Math.cos(ang) * r]
      tgt.groundQuad([P(ra, a0), P(rb, a0), P(rb, a1), P(ra, a1)], y, col)
    }
  }
}

/** Railway track: ballast bed + two rails, per segment (assigned by segment midpoint). */
function addRail(r: number[], ground: GeoBuilder, props: GeoBuilder, inChunk: (x: number, z: number) => boolean) {
  for (let i = 2; i < r.length; i += 2) {
    const ax = r[i - 2], az = r[i - 1], bx = r[i], bz = r[i + 1]
    if (!inChunk((ax + bx) / 2, (az + bz) / 2)) continue
    const L = Math.hypot(bx - ax, bz - az)
    if (L < 0.1) continue
    const nx = (bz - az) / L, nz = -(bx - ax) / L
    const h = 1.6
    ground.groundQuad([[ax + nx * h, az + nz * h], [bx + nx * h, bz + nz * h], [bx - nx * h, bz - nz * h], [ax - nx * h, az - nz * h]], 0.035, '#6b6259')
    const yaw = Math.atan2(bx - ax, bz - az)
    for (const o of [-0.72, 0.72]) props.prim('box', (ax + bx) / 2 + nx * o, 0.1, (az + bz) / 2 + nz * o, 0.08, 0.12, L + 0.05, '#8c8f93', yaw)
  }
}

/** Extruded real footprint with facade textures, shopfronts, signs and roof features. */
function addPoly(
  pb: PolyBuilding,
  facades: GeoBuilder[],
  props: GeoBuilder,
  glow: GeoBuilder,
  signs: GeoBuilder,
  colliders: ColliderSpec[],
  decals: Decal[],
  fIdx: (s: string) => number,
) {
  const n = pb.pts.length / 2
  const ring: [number, number][] = []
  for (let i = 0; i < n; i++) ring.push([pb.pts[i * 2], pb.pts[i * 2 + 1]])
  if (pb.kind === 'canopy') return addCanopy(pb, ring, props, colliders)
  if (pb.kind === 'yantra' || pb.kind === 'monument') return addPlain(pb, ring, props, colliders)
  const style = facades[fIdx(pb.style)]
  const tile = facadeTexture(pb.style)
  const shopTile = facadeTexture('shop')
  const shopH = 4.2
  let u = hash2(Math.floor(pb.cx), Math.floor(pb.cz)) * 4
  let longest = -1, longestLen = 0
  for (let i = 0; i < n; i++) {
    const P = ring[i], Q = ring[(i + 1) % n]
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    // positive-area ring: Q→P gives the outward-facing wall
    if (pb.shop[i] && pb.h > shopH + 1) {
      wall(facades[0], Q, P, 0, shopH, pb.color, shopTile, u)
      wall(style, Q, P, shopH, pb.h, pb.color, tile, u)
      facadeDetail(props, Q, P, shopH, pb.h, pb.style, pb.color, tile, u, pb.cx, pb.cz)
      if (pb.style !== 'colonial') awning(props, Q, P, pb.cx, pb.cz, i * 7 + Math.floor(pb.cx))
      if (L > 5 && pb.sign >= 0) {
        const t0 = 0.5 - Math.min(3.5, L * 0.42) / L, t1 = 1 - t0
        const ox = (Q[1] - P[1]) / L, oz = -(Q[0] - P[0]) / L
        const A: [number, number] = [P[0] + (Q[0] - P[0]) * t1, P[1] + (Q[1] - P[1]) * t1]
        const B: [number, number] = [P[0] + (Q[0] - P[0]) * t0, P[1] + (Q[1] - P[1]) * t0]
        signQuad(signs, A, B, ox, oz, 3.15, 4.15, (pb.sign + i * 5) % (SIGN_COLS * SIGN_ROWS))
      }
    } else {
      wall(style, Q, P, 0, pb.h, pb.color, tile, u)
      if (pb.h < 80) facadeDetail(props, Q, P, 0, pb.h, pb.style, pb.color, tile, u, pb.cx, pb.cz)
    }
    u += L / tile.tileW
    if (L > longestLen) {
      longestLen = L
      longest = i
    }
    // collider: thin slab along the edge
    if (L > 0.3) colliders.push({ x: (P[0] + Q[0]) / 2, y: pb.h / 2, z: (P[1] + Q[1]) / 2, hw: L / 2 + 0.15, hh: pb.h / 2, hd: 0.35, rot: -Math.atan2(Q[1] - P[1], Q[0] - P[0]) })
  }
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
  facades[facades.length - 1].flatTris(ring, tris, pb.h, pb.roof)
  const top = pb.h
  const rr = Math.min(pb.r * 0.45, 14)
  switch (pb.kind) {
    case 'gurdwara': {
      // white kiosks and gilded domes
      props.prim('cyl12', pb.cx, top + 1.2, pb.cz, rr * 0.9, 2.4, rr * 0.9, '#f6f4ee')
      props.prim('sphere', pb.cx, top + 2.4 + rr * 0.35, pb.cz, rr * 0.95, rr * 1.0, rr * 0.95, '#d9a62b')
      props.prim('cone8', pb.cx, top + 2.4 + rr * 0.95, pb.cz, rr * 0.18, rr * 0.5, rr * 0.18, '#e8b83a')
      for (let i = 0; i < Math.min(n, 6); i++) {
        const [x, z] = ring[Math.floor((i * n) / Math.min(n, 6))]
        const kx = pb.cx + (x - pb.cx) * 0.85, kz = pb.cz + (z - pb.cz) * 0.85
        props.prim('box', kx, top + 1.2, kz, 1.6, 2.4, 1.6, '#f6f4ee')
        props.prim('sphere', kx, top + 2.7, kz, 1.6, 1.4, 1.6, '#d9a62b')
      }
      break
    }
    case 'temple': {
      const sh = Math.max(4, rr * 1.8)
      props.prim('cone8', pb.cx, top + sh / 2, pb.cz, rr * 1.2, sh, rr * 1.2, '#e9b46a')
      props.prim('cone8', pb.cx, top + sh * 0.35, pb.cz, rr * 1.5, sh * 0.7, rr * 1.5, '#f0d6a6')
      props.prim('sphere', pb.cx, top + sh + 0.2, pb.cz, 0.6, 0.6, 0.6, '#d9a62b')
      props.prim('box', pb.cx + 0.4, top + sh + 1.4, pb.cz, 0.05, 2.4, 0.05, '#555')
      glow.prim('box', pb.cx + 0.75, top + sh + 2.2, pb.cz, 0.7, 0.45, 0.02, '#ff7a1a')
      break
    }
    case 'mosque': {
      props.prim('sphere', pb.cx, top + rr * 0.3, pb.cz, rr * 1.2, rr * 1.0, rr * 1.2, '#f2efe6')
      props.prim('cone8', pb.cx, top + rr * 0.85, pb.cz, 0.3, 1.2, 0.3, '#c9a43a')
      if (longest >= 0) {
        const P = ring[longest], Q = ring[(longest + 1) % n]
        for (const [x, z] of [P, Q]) {
          const mx = pb.cx + (x - pb.cx) * 0.9, mz = pb.cz + (z - pb.cz) * 0.9
          props.prim('cyl8', mx, top + 5, mz, 1.1, 10, 1.1, '#efe8da')
          props.prim('cone8', mx, top + 10.8, mz, 1.3, 1.6, 1.3, '#e9e2d2')
        }
      }
      break
    }
    case 'church': {
      if (longest >= 0) {
        const P = ring[longest]
        const tx = pb.cx + (P[0] - pb.cx) * 0.7, tz = pb.cz + (P[1] - pb.cz) * 0.7
        props.prim('box', tx, top + 4, tz, 4, 8, 4, pb.color)
        props.prim('cone8', tx, top + 11, tz, 4.8, 6, 4.8, '#8a6f5a')
        props.prim('box', tx, top + 15, tz, 0.15, 2, 0.15, '#c9a43a')
        props.prim('box', tx, top + 15.3, tz, 0.9, 0.15, 0.15, '#c9a43a')
      }
      break
    }
    case 'generic':
    case 'residential':
      if (pb.style === 'residential' && pb.h < 22 && pb.r > 5 && hash2(Math.floor(pb.cx * 3), Math.floor(pb.cz)) < 0.55) {
        props.primLocal('cyl12', pb.cx, pb.cz, 0, 0, top + 1.3, 0, 1.3, 1.4, 1.3, '#1c1c1c')
        props.boxLocal(pb.cx, pb.cz, 0, 0, top + 0.3, 0, 1.4, 0.6, 1.4, '#7a7570')
      }
      break
  }
  if (pb.domed) {
    const R = Math.min(pb.r * 0.32, 16)
    props.prim('cyl12', pb.cx, top + R * 0.4, pb.cz, R * 1.7, R * 0.8, R * 1.7, pb.color)
    props.prim('sphere', pb.cx, top + R * 0.8, pb.cz, R * 1.8, R * 1.6, R * 1.8, '#ecebe6')
    props.prim('cone8', pb.cx, top + R * 1.7, pb.cz, R * 0.12, R * 0.4, R * 0.12, '#c9a43a')
  }
  // CP style: colonnade pillars along shopfront edges
  if (pb.district === 'cp' && pb.style === 'colonial') {
    for (let i = 0; i < n; i++) {
      if (!pb.shop[i]) continue
      const P = ring[i], Q = ring[(i + 1) % n]
      const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
      const ox = (Q[1] - P[1]) / L, oz = -(Q[0] - P[0]) / L
      for (let t = 1.8; t < L - 1; t += 3.6) {
        const x = P[0] + ((Q[0] - P[0]) * t) / L + ox * 1.6, z = P[1] + ((Q[1] - P[1]) * t) / L + oz * 1.6
        props.prim('cyl12', x, 2.2, z, 0.6, 4.4, 0.6, '#f6f3ec')
      }
      // overhanging cornice / verandah roof
      props.prim('box', (P[0] + Q[0]) / 2 + ox * 0.9, 4.55, (P[1] + Q[1]) / 2 + oz * 0.9, L, 0.3, 2.2, '#ebe6da', Math.atan2(Q[0] - P[0], Q[1] - P[1]) + Math.PI / 2)
    }
  }
  if (pb.name && pb.color === '#8e3b2e' && longest >= 0) {
    // station name board on the longest façade
    const P = ring[longest], Q = ring[(longest + 1) % n]
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    const ox = (Q[1] - P[1]) / L, oz = -(Q[0] - P[0]) / L
    decals.push({
      text: pb.name, x: (P[0] + Q[0]) / 2 + ox * 0.12, y: pb.h - 3, z: (P[1] + Q[1]) / 2 + oz * 0.12,
      w: Math.min(34, L * 0.6), h: 3, rot: Math.atan2(ox, oz), bg: '#f4d03f', fg: '#1d2a4d',
    })
  }
}

/** Open roof on pillars (platform shelters, petrol-pump canopies, bus depots). */
function addCanopy(pb: PolyBuilding, ring: [number, number][], props: GeoBuilder, colliders: ColliderSpec[]) {
  const n = ring.length
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
  props.flatTris(ring, tris, pb.h, '#b9bcc0')
  props.flatTris(ring, tris.map((t) => [t[0], t[2], t[1]]), pb.h - 0.35, '#8f9296')
  for (let i = 0; i < n; i++) {
    const P = ring[i], Q = ring[(i + 1) % n]
    props.quad([Q[0], pb.h - 0.35, Q[1]], [P[0], pb.h - 0.35, P[1]], [P[0], pb.h, P[1]], [Q[0], pb.h, Q[1]], '#a7aaae')
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    for (let t = 0; t < L; t += 14) {
      const x = P[0] + ((Q[0] - P[0]) * t) / L, z = P[1] + ((Q[1] - P[1]) * t) / L
      const ix = x + (pb.cx - x) * 0.04, iz = z + (pb.cz - z) * 0.04
      props.prim('box', ix, (pb.h - 0.35) / 2, iz, 0.35, pb.h - 0.35, 0.35, '#6f7377')
      colliders.push({ x: ix, y: pb.h / 2, z: iz, hw: 0.2, hh: pb.h / 2, hd: 0.2, rot: 0 })
    }
  }
}

/** Plain plastered/stone masses for monuments & Jantar Mantar instruments (no windows). */
function addPlain(pb: PolyBuilding, ring: [number, number][], props: GeoBuilder, colliders: ColliderSpec[]) {
  const n = ring.length
  if (/Samrat/i.test(pb.name)) {
    // the great sundial: a gnomon rising along the footprint's long axis
    let best = 0, ax = 0, az = 0
    for (let i = 0; i < n; i++) {
      const P = ring[i], Q = ring[(i + 1) % n]
      const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
      if (L > best) {
        best = L
        ax = (Q[0] - P[0]) / L
        az = (Q[1] - P[1]) / L
      }
    }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const [x, z] of ring) {
      const u = (x - pb.cx) * ax + (z - pb.cz) * az, v = -(x - pb.cx) * az + (z - pb.cz) * ax
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    const W = (u: number, v: number): [number, number] => [pb.cx + u * ax - v * az, pb.cz + u * az + v * ax]
    const H = pb.h
    const c = pb.color
    const a0 = W(u0, v0), a1 = W(u0, v1), b0 = W(u1, v0), b1 = W(u1, v1)
    // sloped hypotenuse (with steps texture via vertex colour), vertical back, two triangular sides
    props.quad([a0[0], 0, a0[1]], [a1[0], 0, a1[1]], [b1[0], H, b1[1]], [b0[0], H, b0[1]], '#d47a58')
    props.quad([b0[0], 0, b0[1]], [b0[0], H, b0[1]], [b1[0], H, b1[1]], [b1[0], 0, b1[1]], c)
    props.quad([a0[0], 0, a0[1]], [b0[0], 0, b0[1]], [b0[0], H, b0[1]], [a0[0], 0.001, a0[1]], c)
    props.quad([a1[0], 0, a1[1]], [a1[0], 0.001, a1[1]], [b1[0], H, b1[1]], [b1[0], 0, b1[1]], c)
    // quadrant wings either side
    for (const sv of [-1, 1]) {
      const vv = sv > 0 ? v1 + 6 : v0 - 6
      const m0 = W((u0 + u1) / 2 - 8, vv), m1 = W((u0 + u1) / 2 + 8, vv)
      props.prim('box', (m0[0] + m1[0]) / 2, H * 0.22, (m0[1] + m1[1]) / 2, 16, H * 0.44, 2.2, c, Math.atan2(ax, az) + Math.PI / 2)
    }
    colliders.push({ x: pb.cx, y: H / 2, z: pb.cz, hw: (u1 - u0) / 2, hh: H / 2, hd: (v1 - v0) / 2, rot: -Math.atan2(az, ax) })
    return
  }
  for (let i = 0; i < n; i++) {
    const P = ring[i], Q = ring[(i + 1) % n]
    props.quad([Q[0], 0, Q[1]], [P[0], 0, P[1]], [P[0], pb.h, P[1]], [Q[0], pb.h, Q[1]], pb.color)
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1])
    if (L > 0.3) colliders.push({ x: (P[0] + Q[0]) / 2, y: pb.h / 2, z: (P[1] + Q[1]) / 2, hw: L / 2 + 0.15, hh: pb.h / 2, hd: 0.35, rot: -Math.atan2(Q[1] - P[1], Q[0] - P[0]) })
  }
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
  props.flatTris(ring, tris, pb.h, new THREE.Color(pb.color).multiplyScalar(0.92).getStyle())
}
