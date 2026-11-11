import { SpatialHash, mulberry32, pick } from '../utils/math'
import { CAR_COLORS, type VehicleKind } from '../world/models'
import type { CityData } from '../world/types'

/**
 * Registry of parked (enterable) vehicles. Derived from the city's parked-vehicle props, plus any
 * vehicle the player leaves behind or has delivered. Rendered/collided near the player only.
 */
export interface Parked {
  id: number
  kind: VehicleKind
  color: string
  x: number
  z: number
  rot: number
  taken: boolean
  owned: boolean
  health: number
  fuel: number
  ownedId?: number
}

export interface ParkedRegistry {
  list: Parked[]
  hash: SpatialHash<Parked>
  version: number
  add: (p: Omit<Parked, 'id' | 'taken'>) => Parked
  near: (x: number, z: number, r: number) => Parked[]
  nearest: (x: number, z: number, r: number) => Parked | null
}

/** Same deterministic kind/colour choice as the old static prop builder. */
export function parkedLook(type: string, v: number): { kind: VehicleKind; color: string } {
  const r = mulberry32(Math.floor(v * 1e9))
  if (type === 'auto_parked') return { kind: 'auto', color: '#2f7d3b' }
  if (type === 'scooter_parked') {
    // advance like buildProp did (one pick for colour)
    return { kind: v < 0.6 ? 'scooter' : 'bike', color: pick(r, ['#c0392b', '#1f1f1f', '#2e86de', '#ecf0f1', '#7f8c8d']) }
  }
  const kind = pick(r, ['hatch', 'hatch', 'sedan', 'suv'] as const)
  return { kind, color: pick(r, CAR_COLORS) }
}

export function buildParkedRegistry(city: CityData, owned: { id: number; kind: VehicleKind; color: string; city: string; x: number; z: number; rot: number; health: number; fuel: number }[] = []): ParkedRegistry {
  const hash = new SpatialHash<Parked>(30)
  const list: Parked[] = []
  const reg: ParkedRegistry = {
    list,
    hash,
    version: 0,
    add: (p) => {
      const e: Parked = { ...p, id: list.length, taken: false }
      list.push(e)
      hash.insertPoint(e, e.x, e.z)
      reg.version++
      return e
    },
    near: (x, z, r) => [...hash.query(x - r, z - r, x + r, z + r)].filter((p) => !p.taken && Math.hypot(p.x - x, p.z - z) < r),
    nearest: (x, z, r) => {
      let best: Parked | null = null,
        bd = r
      for (const p of hash.query(x - r, z - r, x + r, z + r)) {
        if (p.taken) continue
        const d = Math.hypot(p.x - x, p.z - z)
        if (d < bd) {
          bd = d
          best = p
        }
      }
      return best
    },
  }
  for (const p of city.props) {
    if (p.type !== 'car_parked' && p.type !== 'scooter_parked' && p.type !== 'auto_parked') continue
    const look = parkedLook(p.type, p.v)
    reg.add({ kind: look.kind, color: look.color, x: p.x, z: p.z, rot: p.rot, owned: false, health: 100, fuel: 40 + (p.v * 1000) % 60 })
  }
  for (const o of owned) if (o.city === city.id) reg.add({ kind: o.kind, color: o.color, x: o.x, z: o.z, rot: o.rot, owned: true, health: o.health, fuel: o.fuel, ownedId: o.id })
  return reg
}
