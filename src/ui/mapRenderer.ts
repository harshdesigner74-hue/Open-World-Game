import { obbCorners } from '../game/utils/math'
import type { CityData } from '../game/world/types'

/** Bakes a top-down city map (1 px = 1/ppm m). Shared by minimap, world map and city preview. */
const cache = new WeakMap<CityData, Map<number, HTMLCanvasElement>>()

export function bakedMap(city: CityData, ppm = 1) {
  let m = cache.get(city)
  if (!m) cache.set(city, (m = new Map()))
  let c = m.get(ppm)
  if (c) return c
  const { minX, maxX, minZ, maxZ } = city.bounds
  c = document.createElement('canvas')
  c.width = Math.ceil((maxX - minX) * ppm)
  c.height = Math.ceil((maxZ - minZ) * ppm)
  const g = c.getContext('2d')!
  g.scale(ppm, ppm)
  g.translate(-minX, -minZ)
  g.fillStyle = '#1b1f24'
  g.fillRect(minX, minZ, maxX - minX, maxZ - minZ)
  const areaCol: Record<string, string> = {
    sand: '#5a5038', grass: '#24402a', forest: '#1f3a24', water: '#1d5266', plaza: '#33373d', sandstone: '#4a3e33', dirt: '#2d2a26', parking: '#2a2c30', rail: '#2e2a27', campus: '#25272b',
  }
  const poly = (pts: number[]) => {
    g.beginPath()
    g.moveTo(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1])
    g.closePath()
  }
  for (const a of city.areas) {
    g.fillStyle = areaCol[a.kind] ?? '#2a2a2a'
    const s = a.shape
    if (s.type === 'circle') {
      g.beginPath()
      g.arc(s.cx, s.cz, s.r, 0, Math.PI * 2)
      g.fill()
    } else if (s.type === 'poly') {
      poly(s.pts)
      g.fill()
    } else g.fillRect(s.x - s.w / 2, s.z - s.d / 2, s.w, s.d)
  }
  // rail lines
  g.strokeStyle = '#4b4540'
  g.lineWidth = 3
  for (const r of city.rails) {
    g.beginPath()
    g.moveTo(r[0], r[1])
    for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1])
    g.stroke()
  }
  // buildings: real footprints (OSM) darker, procedural infill lighter/translucent
  g.fillStyle = '#353b45'
  for (const p of city.polys) {
    poly(p.pts)
    g.fill()
  }
  g.fillStyle = 'rgba(70,76,86,0.55)'
  for (const b of city.buildings) {
    const pts = obbCorners(b)
    g.beginPath()
    g.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1])
    g.closePath()
    g.fill()
  }
  g.fillStyle = '#4a4f57'
  for (const a of city.arcs) {
    g.beginPath()
    const N = 24
    for (let i = 0; i <= N; i++) {
      const an = a.aOut0 + ((a.aOut1 - a.aOut0) * i) / N
      g.lineTo(a.cx + Math.sin(an) * a.r1, a.cz - Math.cos(an) * a.r1)
    }
    for (let i = N; i >= 0; i--) {
      const an = a.aIn0 + ((a.aIn1 - a.aIn0) * i) / N
      g.lineTo(a.cx + Math.sin(an) * a.r0, a.cz - Math.cos(an) * a.r0)
    }
    g.closePath()
    g.fill()
  }
  // roads as continuous polylines (OSM edges) — casing first, then fill
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const edges = city.net?.edges ?? []
  for (const pass of [0, 1]) {
    for (const e of edges) {
      const major = e.w >= 11
      g.strokeStyle = pass === 0 ? '#121417' : e.cls === 'service' ? '#4c5159' : major ? '#8a8f98' : '#6a7079'
      g.lineWidth = e.w + (pass === 0 ? 2.5 : 0)
      g.beginPath()
      g.moveTo(e.pts[0], e.pts[1])
      for (let i = 2; i < e.pts.length; i += 2) g.lineTo(e.pts[i], e.pts[i + 1])
      g.stroke()
    }
    if (!edges.length)
      for (const r of city.roads) {
        g.strokeStyle = pass === 0 ? '#14171b' : '#7a808a'
        if (r.kind === 'straight') {
          g.lineWidth = r.width + (pass === 0 ? 3 : 0)
          g.beginPath()
          g.moveTo(r.ax, r.az)
          g.lineTo(r.bx, r.bz)
          g.stroke()
        } else {
          g.lineWidth = r.r1 - r.r0 + (pass === 0 ? 3 : 0)
          g.beginPath()
          g.arc(r.cx, r.cz, (r.r0 + r.r1) / 2, 0, Math.PI * 2)
          g.stroke()
        }
      }
  }
  m.set(ppm, c)
  return c
}

export const LANDMARK_ICON: Record<string, string> = {
  monument: '🏛', transport: '🚉', market: '🛍', park: '🌳', government: '🏢', area: '🏙',
}
