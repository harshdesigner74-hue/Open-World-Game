import { runtime } from '../state/runtime'
import type { ActiveJob } from '../state/store'

/** Job offers generated from the live city around the player. */
export function generateJobs(): ActiveJob[] {
  const city = runtime.city
  if (!city) return []
  const P = runtime.player.pos
  const g = city.graph
  const nodeAt = (cx: number, cz: number, rMin: number, rMax: number) => {
    for (let k = 0; k < 400; k++) {
      const i = Math.floor(Math.random() * g.x.length)
      const d = Math.hypot(g.x[i] - cx, g.z[i] - cz)
      const b = city.bounds
      const inside = g.x[i] > b.minX + 30 && g.x[i] < b.maxX - 30 && g.z[i] > b.minZ + 30 && g.z[i] < b.maxZ - 30
      if (inside && d >= rMin && d <= rMax && g.adj[i].length > 1) return { x: g.x[i], z: g.z[i] }
    }
    return null
  }
  const round10 = (n: number) => Math.round(n / 10) * 10
  const out: ActiveJob[] = []
  // 1) delivery (on foot or any vehicle)
  const stalls = city.interactables.filter((i) => (i.type === 'tea' || i.type === 'food' || i.type === 'fruit') && Math.hypot(i.x - P.x, i.z - P.z) < 300)
  const from = stalls.length ? stalls[Math.floor(Math.random() * stalls.length)] : nodeAt(P.x, P.z, 40, 250)
  if (from) {
    const to = nodeAt(from.x, from.z, 350, 1100)
    if (to) {
      const d = Math.hypot(to.x - from.x, to.z - from.z)
      out.push({
        kind: 'delivery', title: `Tiffin delivery to ${city.areaName(to.x, to.z)}`, stage: 0,
        targets: [{ x: from.x, z: from.z, label: 'Collect the parcel' }, { x: to.x, z: to.z, label: 'Deliver the parcel' }],
        reward: round10(150 + d * 0.45), deadline: d / 2.6 + Math.hypot(from.x - P.x, from.z - P.z) / 2.6 + 90, needsVehicle: false,
      })
    }
  }
  // 2) passenger fare (needs a car, taxi or auto)
  const pick = nodeAt(P.x, P.z, 80, 400)
  if (pick) {
    const to = nodeAt(pick.x, pick.z, 600, 1600)
    if (to) {
      const d = Math.hypot(to.x - pick.x, to.z - pick.z)
      out.push({
        kind: 'fare', title: `Passenger fare to ${city.areaName(to.x, to.z)}`, stage: 0,
        targets: [{ x: pick.x, z: pick.z, label: 'Pick up the passenger' }, { x: to.x, z: to.z, label: 'Drop the passenger' }],
        reward: round10(90 + d * 0.6), deadline: (d + Math.hypot(pick.x - P.x, pick.z - P.z)) / 6 + 90, needsVehicle: true,
      })
    }
  }
  // 3) sightseeing tour of three landmarks
  const lms = city.landmarks
    .filter((l) => Math.hypot(l.x - P.x, l.z - P.z) < 1600 && l.category === 'monument')
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
  if (lms.length >= 2)
    out.push({
      kind: 'tour', title: `Sightseeing: ${lms.map((l) => l.name).join(' → ')}`, stage: 0,
      targets: lms.map((l) => ({ x: l.x, z: l.z, label: `Visit ${l.name}` })), reward: 250 + lms.length * 150, deadline: 0, needsVehicle: false,
    })
  return out
}
