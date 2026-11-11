import type * as THREE from 'three'
import { buildChunk, buildLod, type BuiltChunk } from './chunkBuilder'
import type { CityData } from './types'

/**
 * Streaming cache: detailed chunks are built on demand (time-sliced, nearest first) and
 * disposed when the player moves far away. LOD chunks are tiny and kept longer.
 */
const detail = new Map<string, BuiltChunk>()
const lod = new Map<string, THREE.BufferGeometry | null>()
let currentCity: CityData | null = null

function disposeBuilt(b: BuiltChunk) {
  for (const g of [b.ground, b.water, b.buildings, b.props, b.glow, b.signs, b.pools, b.leaves, b.fronds]) g?.dispose()
}

export function setCity(city: CityData) {
  if (currentCity === city) return
  for (const b of detail.values()) disposeBuilt(b)
  for (const g of lod.values()) g?.dispose()
  detail.clear()
  lod.clear()
  currentCity = city
}

export function getDetail(key: string) {
  return detail.get(key)
}
export function ensureDetail(city: CityData, key: string): BuiltChunk | null {
  let b = detail.get(key)
  if (b) return b
  const c = city.chunks.get(key)
  if (!c) return null
  b = buildChunk(city, c)
  detail.set(key, b)
  return b
}
export function ensureLod(city: CityData, key: string) {
  if (lod.has(key)) return lod.get(key) ?? null
  const c = city.chunks.get(key)
  const g = c ? buildLod(city, c) : null
  lod.set(key, g)
  return g
}
export function hasDetail(key: string) {
  return detail.has(key)
}
export function evictDetail(keep: Set<string>) {
  for (const [k, b] of detail) {
    if (!keep.has(k)) {
      disposeBuilt(b)
      detail.delete(k)
    }
  }
}

/** Chunk keys within radius of a point, sorted nearest first. */
export function chunksWithin(city: CityData, x: number, z: number, radius: number) {
  const S = city.chunkSize
  const out: { key: string; d: number }[] = []
  const c0x = Math.floor((x - radius) / S),
    c1x = Math.floor((x + radius) / S)
  const c0z = Math.floor((z - radius) / S),
    c1z = Math.floor((z + radius) / S)
  for (let cx = c0x; cx <= c1x; cx++)
    for (let cz = c0z; cz <= c1z; cz++) {
      const key = `${cx},${cz}`
      if (!city.chunks.has(key)) continue
      // distance from point to chunk rectangle
      const dx = Math.max(cx * S - x, 0, x - (cx + 1) * S)
      const dz = Math.max(cz * S - z, 0, z - (cz + 1) * S)
      const d = Math.hypot(dx, dz)
      if (d <= radius) out.push({ key, d })
    }
  out.sort((a, b) => a.d - b.d)
  return out
}
