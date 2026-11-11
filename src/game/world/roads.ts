import { SpatialHash, distToSegment } from '../utils/math'
import type { Road, StraightRoad, RingRoad } from './types'

export const SIDEWALK_W = 4
export const SIDEWALK_Y = 0.09
export const ROAD_Y = 0.03

export function roadBBox(r: Road, m = 0): [number, number, number, number] {
  if (r.kind === 'straight') {
    const h = r.width / 2 + m
    return [Math.min(r.ax, r.bx) - h, Math.min(r.az, r.bz) - h, Math.max(r.ax, r.bx) + h, Math.max(r.az, r.bz) + h]
  }
  return [r.cx - r.r1 - m, r.cz - r.r1 - m, r.cx + r.r1 + m, r.cz + r.r1 + m]
}

export function insideRoad(r: Road, x: number, z: number, margin: number) {
  if (r.kind === 'straight') return distToSegment(x, z, r.ax, r.az, r.bx, r.bz).d < r.width / 2 + margin
  const d = Math.hypot(x - r.cx, z - r.cz)
  return d > r.r0 - margin && d < r.r1 + margin
}

export function roadDir(r: StraightRoad) {
  const l = Math.hypot(r.bx - r.ax, r.bz - r.az)
  return { x: (r.bx - r.ax) / l, z: (r.bz - r.az) / l, len: l }
}

/** Spatial index over the road network: "am I on a road?" queries in O(1). */
export class RoadIndex {
  private hash = new SpatialHash<Road>(40)
  private tmp = new Set<Road>()
  constructor(public roads: Road[]) {
    for (const r of roads) {
      if (r.kind === 'ring') {
        // insert only the annulus cells, not the whole disc interior
        const steps = Math.ceil((2 * Math.PI * r.r1) / 20)
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          const x = r.cx + Math.sin(a) * (r.r0 + r.r1) * 0.5
          const z = r.cz - Math.cos(a) * (r.r0 + r.r1) * 0.5
          const h = (r.r1 - r.r0) / 2 + 30
          this.hash.insertBox(r, x - h, z - h, x + h, z + h)
        }
      } else {
        const [a, b, c, d] = roadBBox(r, 25)
        // walk along the segment so long diagonal roads don't fill their whole bbox
        const dir = roadDir(r)
        const steps = Math.ceil(dir.len / 20)
        for (let i = 0; i <= steps; i++) {
          const x = r.ax + (r.bx - r.ax) * (i / steps)
          const z = r.az + (r.bz - r.az) * (i / steps)
          const h = r.width / 2 + 25
          this.hash.insertBox(r, Math.max(a, x - h), Math.max(b, z - h), Math.min(c, x + h), Math.min(d, z + h))
        }
      }
    }
  }
  near(x: number, z: number, out = this.tmp) {
    out.clear()
    return this.hash.query(x, z, x, z, out)
  }
  /** Returns the first road containing (x,z) within margin, or null. */
  at(x: number, z: number, margin = 0, ignore?: Road): Road | null {
    const g = ignore && ignore.kind === 'straight' ? ignore.group : undefined
    for (const r of this.near(x, z)) {
      if (r === ignore) continue
      if (g !== undefined && r.kind === 'straight' && r.group === g) continue
      if (insideRoad(r, x, z, margin)) return r
    }
    return null
  }
  /** All roads a segment crosses (sampled). */
  crossed(ax: number, az: number, bx: number, bz: number, margin = -0.5) {
    const set = new Set<Road>()
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(2, Math.ceil(len / 0.8))
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n
      const z = az + ((bz - az) * i) / n
      for (const r of this.near(x, z)) if (insideRoad(r, x, z, margin)) set.add(r)
    }
    return set
  }
}

export function ringPoint(r: RingRoad | { cx: number; cz: number }, radius: number, bearingRad: number) {
  return { x: r.cx + Math.sin(bearingRad) * radius, z: r.cz - Math.cos(bearingRad) * radius }
}

/** Offset a polyline to its left (driving-on-the-left lanes) by `off` metres. */
export function offsetPolyline(pts: { x: number; z: number }[], off: number, closed: boolean) {
  const n = pts.length
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < n; i++) {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const cur = pts[i]
    // left normal of direction (dx,dz) with -Z north: left = (dz, -dx)
    const d1x = cur.x - prev.x,
      d1z = cur.z - prev.z
    const d2x = next.x - cur.x,
      d2z = next.z - cur.z
    const l1 = Math.hypot(d1x, d1z) || 1
    const l2 = Math.hypot(d2x, d2z) || 1
    const n1x = d1z / l1,
      n1z = -d1x / l1
    const n2x = d2z / l2,
      n2z = -d2x / l2
    let mx = (i === 0 && !closed ? n2x : i === n - 1 && !closed ? n1x : n1x + n2x)
    let mz = (i === 0 && !closed ? n2z : i === n - 1 && !closed ? n1z : n1z + n2z)
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    const refx = l1 > 0.001 && (closed || i > 0) ? n1x : n2x
    const refz = l1 > 0.001 && (closed || i > 0) ? n1z : n2z
    const cos = Math.max(0.35, mx * refx + mz * refz)
    out.push({ x: cur.x + (mx * off) / cos, z: cur.z + (mz * off) / cos })
  }
  return out
}
