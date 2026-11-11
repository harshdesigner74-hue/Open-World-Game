// Small, dependency-free math helpers shared by every game system.

export type RNG = () => number

/** Deterministic PRNG so a city is generated identically every run. */
export function mulberry32(seed: number): RNG {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = (rng: RNG, a: number, b: number) => a + (b - a) * rng()
export const randInt = (rng: RNG, a: number, b: number) => Math.floor(rand(rng, a, b + 1))
export const pick = <T>(rng: RNG, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt))

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt))

/** Compass bearing (degrees, 0 = north = -Z, clockwise) to a unit XZ direction. */
export function bearingDir(deg: number) {
  const r = (deg * Math.PI) / 180
  return { x: Math.sin(r), z: -Math.cos(r) }
}

/** Yaw (rotation about +Y) that makes a model whose forward is +Z face direction (dx, dz). */
export const yawFromDir = (dx: number, dz: number) => Math.atan2(dx, dz)

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax
  const vz = bz - az
  const len2 = vx * vx + vz * vz
  let t = len2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0
  t = clamp(t, 0, 1)
  const cx = ax + vx * t
  const cz = az + vz * t
  return { d: Math.hypot(px - cx, pz - cz), t }
}

export function hash2(x: number, z: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Generic uniform-grid spatial hash for 2D (XZ) queries. */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>()
  constructor(private size: number) {}
  private key(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096)
  }
  insertBox(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    const s = this.size
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++)
      for (let cz = Math.floor(minZ / s); cz <= Math.floor(maxZ / s); cz++) {
        const k = this.key(cx, cz)
        let c = this.cells.get(k)
        if (!c) this.cells.set(k, (c = []))
        c.push(item)
      }
  }
  insertPoint(item: T, x: number, z: number) {
    this.insertBox(item, x, z, x, z)
  }
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Set<T> = new Set()) {
    const s = this.size
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++)
      for (let cz = Math.floor(minZ / s); cz <= Math.floor(maxZ / s); cz++) {
        const c = this.cells.get(this.key(cx, cz))
        if (c) for (const it of c) out.add(it)
      }
    return out
  }
  clear() {
    this.cells.clear()
  }
}

/** Oriented rectangle overlap (separating axis theorem) in XZ. */
export interface OBB {
  x: number
  z: number
  w: number // extent along local X
  d: number // extent along local Z
  rot: number // yaw
}
export function obbCorners(b: OBB) {
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  const hw = b.w / 2
  const hd = b.d / 2
  // local x axis after yaw rot: (cos, -sin); local z axis: (sin, cos)
  const pts: [number, number][] = []
  for (const [lx, lz] of [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ])
    pts.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c])
  return pts
}
export function obbOverlap(a: OBB, b: OBB, margin = 0) {
  const A = obbCorners({ ...a, w: a.w + margin, d: a.d + margin })
  const B = obbCorners({ ...b, w: b.w + margin, d: b.d + margin })
  const axes: [number, number][] = [
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
  ]
  for (const [ax, az] of axes) {
    let aMin = Infinity,
      aMax = -Infinity,
      bMin = Infinity,
      bMax = -Infinity
    for (const [x, z] of A) {
      const p = x * ax + z * az
      aMin = Math.min(aMin, p)
      aMax = Math.max(aMax, p)
    }
    for (const [x, z] of B) {
      const p = x * ax + z * az
      bMin = Math.min(bMin, p)
      bMax = Math.max(bMax, p)
    }
    if (aMax < bMin || bMax < aMin) return false
  }
  return true
}
