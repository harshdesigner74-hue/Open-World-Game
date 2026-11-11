import { GeoBuilder } from '../utils/geoBuilder'
import type { ColliderSpec } from './models'

/**
 * Hand-built landmark geometry (original, simplified interpretations — not scans or copies of
 * any third-party model). Each returns into the chunk's builders.
 */
export interface Decal {
  text: string
  x: number
  y: number
  z: number
  w: number
  h: number
  rot: number
  bg: string
  fg: string
}

export interface LandmarkOut {
  b: GeoBuilder
  g: GeoBuilder
  colliders: ColliderSpec[]
  decals: Decal[]
}

const SAND = '#d6b089'
const SAND_D = '#c79d75'
const RED = '#a85c43'

export function buildLandmark(id: string, x: number, z: number, out: LandmarkOut) {
  const { b, g, colliders, decals } = out
  switch (id) {
    case 'india_gate': {
      // arch passage runs east–west (along X); the monument is wide along Z
      b.boxBase(x, 0, z, 18, 0.5, 42, '#bfa98d')
      b.boxBase(x, 0.5, z, 14, 0.5, 38, '#c9b293')
      b.boxBase(x, 1, z, 11.5, 0.4, 34, SAND_D)
      for (const sz of [-1, 1]) {
        const pz = z + sz * 10.25
        b.boxBase(x, 1.4, pz, 10, 3, 10.5, RED)
        b.boxBase(x, 4.4, pz, 9.5, 18.6, 9.5, SAND)
        // recessed side arches on the outer faces
        b.boxBase(x, 6, z + sz * 15.05, 4.2, 9, 0.2, '#b68e68')
        // vertical pilaster strips
        for (const sx of [-1, 1]) b.boxBase(x + sx * 4.9, 4.4, pz, 0.35, 18.6, 9.6, SAND_D)
      }
      // main arch: semicircular soffit from springing y=17 (radius 5.5)
      const R = 5.5,
        spring = 17,
        top = 23
      const N = 14
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI,
          a1 = ((i + 1) / N) * Math.PI
        const z0 = Math.cos(a0) * R,
          z1 = Math.cos(a1) * R
        const y = spring + Math.sin((a0 + a1) / 2) * R
        b.boxBase(x, y, z + (z0 + z1) / 2, 9.5, top - y, Math.abs(z1 - z0) + 0.05, SAND)
      }
      b.boxBase(x, 4.4, z - R - 0.25, 9.5, spring - 4.4, 0.5, SAND)
      b.boxBase(x, 4.4, z + R + 0.25, 9.5, spring - 4.4, 0.5, SAND)
      // attic, cornices, stepped crown and shallow dome
      b.boxBase(x, top, z, 9.5, 8, 30, SAND)
      b.boxBase(x, top + 0.2, z, 10.2, 0.6, 31, SAND_D)
      b.boxBase(x, 30.6, z, 10.4, 0.7, 31.2, SAND_D)
      b.boxBase(x, 31.3, z, 9, 3, 26, SAND)
      b.boxBase(x, 34.3, z, 8.4, 0.5, 22, SAND_D)
      b.boxBase(x, 34.8, z, 7.6, 2.2, 16, SAND)
      b.boxBase(x, 37, z, 6.6, 1.8, 10.5, SAND)
      b.boxBase(x, 38.8, z, 5.6, 1.2, 6.5, SAND_D)
      b.prim('cyl12', x, 40.3, z, 5.4, 1.8, 5.4, SAND)
      b.prim('sphere', x, 41.2, z, 5.2, 1.6, 5.2, SAND_D)
      for (const sx of [-1, 1]) decals.push({ text: 'INDIA', x: x + sx * 4.8, y: 27.2, z, w: 9, h: 1.8, rot: sx > 0 ? Math.PI / 2 : -Math.PI / 2, bg: '#d6b089', fg: '#6d4a33' })
      for (const sz of [-1, 1]) colliders.push({ x, y: 11, z: z + sz * 10.25, hw: 5, hh: 11, hd: 5.25, rot: 0 })
      colliders.push({ x, y: 31, z, hw: 5, hh: 9, hd: 15, rot: 0 })
      // low chain-bollard ring
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2
        b.prim('cyl8', x + Math.sin(a) * 26, 0.45, z - Math.cos(a) * 26, 0.25, 0.9, 0.25, '#7d6a58')
      }
      break
    }
    case 'canopy': {
      b.boxBase(x, 0, z, 11, 0.6, 11, SAND_D)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.boxBase(x + sx * 3.6, 0.6, z + sz * 3.6, 1.1, 7.5, 1.1, SAND)
      b.boxBase(x, 8.1, z, 9.4, 1.0, 9.4, SAND_D)
      b.boxBase(x, 9.1, z, 8, 0.8, 8, SAND)
      b.prim('sphere', x, 10.2, z, 6.2, 5.4, 6.2, SAND)
      b.prim('cyl8', x, 13.4, z, 0.4, 1.6, 0.4, '#b08a5a')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) colliders.push({ x: x + sx * 3.6, y: 4, z: z + sz * 3.6, hw: 0.55, hh: 4, hd: 0.55, rot: 0 })
      break
    }
    case 'station': {
      const W = 200,
        D = 30
      const maroon = '#8e3b2e'
      const cream = '#efe3c8'
      b.boxBase(x, 0, z, W, 12, D, maroon)
      b.boxBase(x, 12, z, W + 1, 1.2, D + 1, cream)
      b.boxBase(x, 13.2, z, W - 6, 4.5, D - 4, maroon)
      // arcade along the front (+Z face)
      for (let i = 0; i < 28; i++) {
        const px = x - W / 2 + 4 + i * ((W - 8) / 27)
        b.boxBase(px, 0, z + D / 2 + 0.35, 1.2, 9, 0.7, cream)
        g.boxBase(px + 3.3, 1.2, z + D / 2 + 0.05, 4.6, 5.5, 0.05, '#ffe2a8')
      }
      b.boxBase(x, 9, z + D / 2 + 0.6, W, 1.2, 1.4, cream)
      // central entrance block + clock
      b.boxBase(x, 0, z + 4, 40, 22, D - 4, maroon)
      b.boxBase(x, 22, z + 4, 42, 1.4, D - 2, cream)
      b.prim('cyl12', x, 19, z + D / 2 + 2.05, 4, 4, 0.3, '#f7f2e4', 0, Math.PI / 2)
      decals.push({ text: 'NEW DELHI  नई दिल्ली', x, y: 14.5, z: z + D / 2 + 2.08, w: 34, h: 3.2, rot: 0, bg: '#f4d03f', fg: '#1d2a4d' })
      colliders.push({ x, y: 9, z, hw: W / 2, hh: 9, hd: D / 2 + 1, rot: 0 })
      // platforms with canopies and parked trains behind the building
      for (let p = 0; p < 4; p++) {
        const pz = z - D / 2 - 12 - p * 14
        b.boxBase(x, 0, pz, 230, 1.0, 6, '#b9b3a6')
        for (let i = 0; i < 18; i++) b.boxBase(x - 110 + i * 13, 1, pz, 0.35, 5, 0.35, '#6a6e72')
        b.boxBase(x, 6, pz, 232, 0.3, 9, '#8b9097')
        colliders.push({ x, y: 0.5, z: pz, hw: 115, hh: 0.5, hd: 3, rot: 0 })
        // tracks
        const tz = pz - 7
        b.boxBase(x, 0, tz, 240, 0.15, 3.6, '#5a524a')
        for (const r of [-0.75, 0.75]) b.boxBase(x, 0.15, tz + r, 240, 0.12, 0.12, '#8d8f92')
        if (p % 2 === 0) {
          for (let c = 0; c < 8; c++) {
            const cx = x - 92 + c * 23
            b.boxBase(cx, 0.6, tz, 22, 3.5, 3.1, c === 0 ? '#c0392b' : '#2f4f8f')
            b.boxBase(cx, 2.3, tz, 21.6, 0.9, 3.15, '#1e2a3c')
            b.boxBase(cx, 4.1, tz, 21.6, 0.3, 2.8, '#7f8a96')
          }
          colliders.push({ x: x - 12, y: 2.2, z: tz, hw: 92, hh: 2.2, hd: 1.6, rot: 0 })
        }
      }
      break
    }
    case 'charminar': {
      // Hyderabad, 1591: square arched structure with four ~56 m minarets
      const C = '#d9c9a6'
      const S = 20
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.boxBase(x + sx * 7.5, 0, z + sz * 7.5, 5, 13, 5, C)
        colliders.push({ x: x + sx * 7.5, y: 6.5, z: z + sz * 7.5, hw: 2.5, hh: 6.5, hd: 2.5, rot: 0 })
      }
      // arches: spandrels over each 10 m opening
      for (let i = 0; i < 10; i++) {
        const a0 = (i / 10) * Math.PI, a1 = ((i + 1) / 10) * Math.PI
        const u = (Math.cos(a0) + Math.cos(a1)) * 2.5, y = 9 + Math.sin((a0 + a1) / 2) * 5
        b.boxBase(x + u, y, z - 8.5, Math.abs(Math.cos(a1) - Math.cos(a0)) * 5 + 0.05, 14 - y, 3, C)
        b.boxBase(x + u, y, z + 8.5, Math.abs(Math.cos(a1) - Math.cos(a0)) * 5 + 0.05, 14 - y, 3, C)
        b.boxBase(x - 8.5, y, z + u, 3, 14 - y, Math.abs(Math.cos(a1) - Math.cos(a0)) * 5 + 0.05, C)
        b.boxBase(x + 8.5, y, z + u, 3, 14 - y, Math.abs(Math.cos(a1) - Math.cos(a0)) * 5 + 0.05, C)
      }
      b.boxBase(x, 14, z, S, 6, S, C)
      b.boxBase(x, 20, z, S + 1, 0.6, S + 1, '#cbb991')
      b.boxBase(x, 20.6, z, S - 4, 2.4, S - 4, C)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const mx = x + sx * 9.6, mz = z + sz * 9.6
        b.prim('cyl12', mx, 32, mz, 2.8, 36, 2.8, C)
        for (const yy of [24, 34, 44]) b.prim('cyl12', mx, yy, mz, 3.8, 0.7, 3.8, '#cbb991')
        b.prim('cyl12', mx, 51, mz, 2.2, 2, 2.2, C)
        b.prim('sphere', mx, 52.6, mz, 2.6, 2.4, 2.6, '#e6dcc4')
        b.prim('cone8', mx, 54.6, mz, 0.4, 1.8, 0.4, '#c9a43a')
      }
      break
    }
    case 'gateway': {
      // Mumbai, 1924: basalt arch with corner turrets on the waterfront
      const C = '#c8a76c'
      for (const sx of [-1, 1]) {
        b.boxBase(x + sx * 9, 0, z, 8, 26, 14, C)
        colliders.push({ x: x + sx * 9, y: 13, z, hw: 4, hh: 13, hd: 7, rot: 0 })
      }
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * Math.PI, a1 = ((i + 1) / 12) * Math.PI
        const u = (Math.cos(a0) + Math.cos(a1)) * 2.5, y = 13 + Math.sin((a0 + a1) / 2) * 5
        b.boxBase(x + u, y, z, Math.abs(Math.cos(a1) - Math.cos(a0)) * 5 + 0.05, 26 - y, 14, C)
      }
      b.boxBase(x, 26, z, 27, 1.2, 15, '#b8955a')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.prim('cyl12', x + sx * 11.5, 30, z + sz * 5.5, 3.2, 7, 3.2, C)
        b.prim('sphere', x + sx * 11.5, 33.6, z + sz * 5.5, 3.4, 2.6, 3.4, '#d6b77c')
      }
      b.prim('cyl12', x, 28.5, z, 9, 3.5, 9, C)
      b.prim('sphere', x, 30.4, z, 9, 4, 9, '#d6b77c')
      break
    }
    case 'hawa_mahal': {
      // Jaipur, 1799: five-storey pink sandstone screen of jharokhas facing the street
      const P = '#e58f72', W = '#f6e6dc'
      const tiers = [
        [50, 7], [44, 3.2], [36, 3.2], [26, 3.2], [16, 3.2],
      ]
      let y = 0
      tiers.forEach(([w, h], i) => {
        b.boxBase(x, y, z, 9 - i * 0.6, h, w, P)
        b.boxBase(x - (4.5 - i * 0.3), y + h - 0.35, z, 0.4, 0.35, w, W)
        // rows of little jharokha windows
        for (let k = -w / 2 + 1.2; k < w / 2 - 1; k += 1.6) {
          g.boxBase(x - (4.55 - i * 0.3), y + h * 0.35, z + k, 0.05, h * 0.4, 0.9, '#3a2418')
          b.prim('sphere', x - (4.4 - i * 0.3), y + h + 0.2, z + k, 1.1, 0.8, 1.1, P)
        }
        y += h
      })
      colliders.push({ x, y: 9, z, hw: 4.5, hh: 9, hd: 25, rot: 0 })
      break
    }
    case 'victoria_memorial': {
      // Kolkata, 1921: white marble with a great central dome
      const M = '#f2f0ea'
      b.boxBase(x, 0, z, 104, 2, 70, '#e3e0d8')
      b.boxBase(x, 2, z, 96, 18, 62, M)
      b.boxBase(x, 20, z, 98, 1, 64, '#ddd9cf')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.prim('cyl12', x + sx * 40, 24, z + sz * 25, 9, 8, 9, M)
        b.prim('sphere', x + sx * 40, 28, z + sz * 25, 9.5, 8, 9.5, M)
      }
      b.prim('cyl12', x, 27, z, 34, 14, 34, M)
      b.prim('sphere', x, 34, z, 34, 30, 34, M)
      b.prim('cyl8', x, 50, z, 3, 4, 3, M)
      b.prim('sphere', x, 53, z, 1.8, 3, 1.8, '#3a3a3a')
      colliders.push({ x, y: 10, z, hw: 48, hh: 10, hd: 31, rot: 0 })
      break
    }
    case 'lighthouse': {
      b.prim('cyl12', x, 1, z, 14, 2, 14, '#d8d2c6')
      b.prim('cyl12', x, 22, z, 7, 42, 7, '#efe9de')
      for (const yy of [10, 22, 34]) b.prim('cyl12', x, yy, z, 7.4, 2.4, 7.4, '#b8352b')
      b.prim('cyl12', x, 44, z, 9, 1, 9, '#555')
      g.prim('cyl12', x, 46, z, 4.5, 3.4, 4.5, '#fff2c0')
      b.prim('cone8', x, 49, z, 5.6, 2.8, 5.6, '#b8352b')
      colliders.push({ x, y: 22, z, hw: 3.6, hh: 22, hd: 3.6, rot: 0 })
      break
    }
    case 'vijay_chowk': {
      for (const sz of [-1, 1]) {
        b.prim('cyl12', x, 0.35, z + sz * 40, 14, 0.7, 14, '#c9b293')
        b.prim('cyl12', x, 0.5, z + sz * 40, 12.5, 0.5, 12.5, '#5c8f9a')
        b.prim('cyl12', x, 1.2, z + sz * 40, 2, 2.4, 2, '#c9b293')
        colliders.push({ x, y: 0.35, z: z + sz * 40, hw: 7, hh: 0.35, hd: 7, rot: 0 })
      }
      for (let i = -6; i <= 6; i++) b.prim('cyl8', x + 26, 0.5, z + i * 10, 0.5, 1.0, 0.5, RED)
      break
    }
  }
}
