import type { Signal } from '../world/types'

/**
 * Fixed-time signal plan (seconds):
 *  0–14  N/S green  · 14–17 N/S amber · 17–18.5 all red
 *  18.5–32.5 E/W green · 32.5–35.5 E/W amber · 35.5–37 all red
 * Neighbouring junctions are offset by half a cycle (group) to create rolling waves.
 */
export const CYCLE = 37
export type Light = 'g' | 'y' | 'r'

export function signalLight(s: Signal, axis: 0 | 1, t: number): Light {
  const c = (((t + s.group * 18.5 + s.id * 0.7) % CYCLE) + CYCLE) % CYCLE
  if (axis === 0) return c < 14 ? 'g' : c < 17 ? 'y' : 'r'
  return c >= 18.5 && c < 32.5 ? 'g' : c >= 32.5 && c < 35.5 ? 'y' : 'r'
}

/** Pedestrians may cross a road of `axis` when that road's traffic is held at red (not the clearance phase). */
export function pedestrianMayCross(s: Signal, roadAxis: 0 | 1, t: number) {
  const c = (((t + s.group * 18.5 + s.id * 0.7) % CYCLE) + CYCLE) % CYCLE
  // road axis 0 (N/S traffic) is red during E/W phase
  return roadAxis === 0 ? c >= 18.5 && c < 31 : c < 12.5
}

/** Which phase a travel direction (dx, dz) belongs to at this junction. */
export function axisOf(s: Signal, dx: number, dz: number): 0 | 1 {
  let d = Math.abs(Math.atan2(dx, dz) - s.axis) % Math.PI
  if (d > Math.PI / 2) d = Math.PI - d
  return d < Math.PI / 4 ? 0 : 1
}
