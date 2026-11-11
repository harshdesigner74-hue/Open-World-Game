import { GeoBuilder } from '../utils/geoBuilder'
import { mulberry32, pick } from '../utils/math'
import { buildVendor, type ColliderSpec } from '../world/models'
import type { Interactable } from '../world/types'

/**
 * Procedural interiors. Each is built around a local origin (0,0) with the entrance on the +Z
 * wall, then placed in a private "interior space" outside the city when the player enters.
 */
export type InteriorKind = 'dhaba' | 'store' | 'clothes' | 'flat' | 'metro'

export interface InteriorOut {
  b: GeoBuilder // lit surfaces (vertex coloured)
  g: GeoBuilder // emissive (lights, screens, signs)
  colliders: ColliderSpec[]
  spots: Omit<Interactable, 'id'>[]
  texts: { text: string; x: number; y: number; z: number; w: number; h: number; rot: number; bg: string; fg: string }[]
  lights: { x: number; y: number; z: number; color: string; intensity: number }[]
  /** where the player appears, facing into the room */
  spawn: { x: number; z: number; yaw: number }
  size: { w: number; d: number; h: number }
  /** metro: train track line along X at this z */
  trackZ?: number
}

function shell(o: InteriorOut, w: number, d: number, h: number, floor: [string, string], wall: string, ceiling = '#e9e5dc') {
  const { b, g, colliders } = o
  // checkered floor tiles
  const T = 1
  for (let x = -w / 2; x < w / 2; x += T)
    for (let z = -d / 2; z < d / 2; z += T) {
      const c = (Math.floor(x + 100) + Math.floor(z + 100)) % 2 ? floor[0] : floor[1]
      b.groundQuad([[x, z], [x + T, z], [x + T, z + T], [x, z + T]], 0.02, c, 0.5)
    }
  // walls (inward-facing boxes), ceiling slab, skirting
  const t = 0.3
  b.boxBase(0, 0, -d / 2 - t / 2, w + 2 * t, h, t, wall)
  b.boxBase(-w / 2 - t / 2, 0, 0, t, h, d, wall)
  b.boxBase(w / 2 + t / 2, 0, 0, t, h, d, wall)
  // front wall with a door gap in the middle
  const gap = 2.2
  b.boxBase(-(w / 4 + gap / 4), 0, d / 2 + t / 2, w / 2 - gap / 2, h, t, wall)
  b.boxBase(w / 4 + gap / 4, 0, d / 2 + t / 2, w / 2 - gap / 2, h, t, wall)
  b.boxBase(0, 2.6, d / 2 + t / 2, gap, h - 2.6, t, wall)
  b.boxBase(0, 0, d / 2 + t * 0.9, gap, 2.6, 0.05, '#2b2b2b') // closed door leaf (exit)
  b.boxBase(0, h, 0, w + 2 * t, 0.2, d + 2 * t, ceiling)
  for (const [x, z, ww, dd] of [[0, -d / 2 + 0.03, w, 0.06], [-w / 2 + 0.03, 0, 0.06, d], [w / 2 - 0.03, 0, 0.06, d]] as const)
    b.boxBase(x, 0, z, ww, 0.12, dd, '#5a4a3a')
  colliders.push(
    { x: 0, y: h / 2, z: -d / 2 - t / 2, hw: w / 2 + t, hh: h / 2, hd: t / 2, rot: 0 },
    { x: -w / 2 - t / 2, y: h / 2, z: 0, hw: t / 2, hh: h / 2, hd: d / 2, rot: 0 },
    { x: w / 2 + t / 2, y: h / 2, z: 0, hw: t / 2, hh: h / 2, hd: d / 2, rot: 0 },
    { x: 0, y: h / 2, z: d / 2 + t / 2, hw: w / 2, hh: h / 2, hd: t / 2, rot: 0 },
    { x: 0, y: -0.5, z: 0, hw: w / 2 + 1, hh: 0.5, hd: d / 2 + 1, rot: 0 },
  )
  // ceiling light panels
  for (let x = -w / 2 + 2; x < w / 2 - 1; x += 3.5) for (let z = -d / 2 + 2; z < d / 2 - 1; z += 3.5) g.boxBase(x, h - 0.06, z, 1.2, 0.05, 0.4, '#fff4dc')
  g.boxBase(0, 2.75, d / 2 - 0.02, 0.8, 0.22, 0.03, '#3cff6a') // EXIT sign
  o.spots.push({ type: 'interior_exit', x: 0, z: d / 2 - 0.9, rot: Math.PI, radius: 1.6, label: 'Exit to the street' })
  o.spawn = { x: 0, z: d / 2 - 1.6, yaw: Math.PI }
  o.size = { w, d, h }
}

export function buildInterior(kind: InteriorKind, seed: number, name: string): InteriorOut {
  const r = mulberry32(seed)
  const o: InteriorOut = {
    b: new GeoBuilder(), g: new GeoBuilder(), colliders: [], spots: [], texts: [], lights: [],
    spawn: { x: 0, z: 0, yaw: 0 }, size: { w: 0, d: 0, h: 0 },
  }
  const { b, g, colliders, spots } = o
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, solid = true) => {
    b.boxBase(x, y, z, w, h, d, c)
    if (solid) colliders.push({ x, y: y + h / 2, z, hw: w / 2, hh: h / 2, hd: d / 2, rot: 0 })
  }
  switch (kind) {
    case 'dhaba': {
      shell(o, 12, 10, 3.6, ['#8a5a3a', '#7a4f33'], pick(r, ['#e8c27a', '#d9a066', '#c9d6a0']))
      // counter + tandoor + cook
      box(0, 0, -3.6, 6, 1.0, 0.9, '#6b3d1f')
      b.boxBase(0, 1.0, -3.6, 6.1, 0.06, 1.0, '#c9b28a')
      b.prim('cyl12', 2.2, 0.55, -4.4, 1.0, 1.1, 1.0, '#a8653d')
      g.prim('cyl12', 2.2, 1.11, -4.4, 0.5, 0.02, 0.5, '#ff6a1a')
      buildVendor(b, -1, -4.4, 0, 0.3)
      for (let i = 0; i < 5; i++) b.prim('cyl12', -2.6 + i * 0.6, 1.12, -3.5, 0.25, 0.12, 0.25, '#c0c0c0')
      // tables & benches (sit-able)
      for (const [tx, tz] of [[-3.5, -0.5], [0, -0.5], [3.5, -0.5], [-3.5, 2.6], [3.5, 2.6]]) {
        box(tx, 0, tz, 1.6, 0.75, 0.9, '#7a5230')
        for (const s of [-1, 1]) {
          box(tx, 0, tz + s * 0.85, 1.6, 0.45, 0.4, '#5a3d22', false)
          spots.push({ type: 'bench', x: tx, z: tz + s * 0.85 + s * 0.6, rot: s > 0 ? Math.PI : 0, radius: 1.1, label: 'Sit at the table', data: { propX: tx + 0.45, propZ: tz + s * 0.85 } })
        }
      }
      spots.push({ type: 'eat', x: 0, z: -2.6, rot: Math.PI, radius: 1.8, label: 'Order a thali (₹120) — full health & stamina' })
      o.texts.push({ text: name || 'Shree Dhaba', x: 0, y: 2.7, z: -4.95, w: 5, h: 0.8, rot: 0, bg: '#b8331f', fg: '#ffe9a8' })
      o.texts.push({ text: 'THALI ₹120 · CHAI ₹15 · LASSI ₹40', x: -3.2, y: 2.0, z: -4.95, w: 3.4, h: 0.5, rot: 0, bg: '#1f1a14', fg: '#f6e3b0' })
      o.lights.push({ x: 0, y: 3.1, z: -1, color: '#ffd7a0', intensity: 22 }, { x: 0, y: 3.1, z: 3, color: '#ffd7a0', intensity: 16 })
      break
    }
    case 'store':
    case 'clothes': {
      const clothes = kind === 'clothes'
      shell(o, 10, 9, 3.4, clothes ? ['#d9d2c5', '#cfc7b8'] : ['#bfc4c8', '#b0b6bb'], clothes ? '#f1e6ea' : '#eef0e6')
      // shelves along the side walls with products / hanging clothes
      for (const sx of [-1, 1]) {
        box(sx * 4.55, 0, -0.5, 0.7, 2.4, 6.5, '#8a6a4a')
        for (let k = 0; k < 40; k++) {
          const y = 0.4 + (k % 4) * 0.55,
            z = -3.5 + Math.floor(k / 4) * 0.65
          if (clothes) b.boxBase(sx * 4.1, y + 0.05, z, 0.08, 0.5, 0.45, pick(r, ['#c0392b', '#2e86de', '#f1c40f', '#8e44ad', '#16a085', '#e67e22', '#ecf0f1', '#2c3e50']))
          else b.boxBase(sx * 4.18, y, z, 0.25, 0.3 + r() * 0.15, 0.35, pick(r, ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#ecf0f1']))
        }
      }
      // central display table + mannequins / snack racks
      box(0, 0, -0.8, 2.6, 0.8, 1.2, '#a07850')
      if (clothes) for (const x of [-0.8, 0.8]) buildVendor(b, x, -0.8, Math.PI, 0.7 + x)
      // counter & shopkeeper
      box(-2.5, 0, -3.4, 2.4, 1.0, 0.8, '#4a3a2c')
      buildVendor(b, -2.5, -4.1, 0, 0.55)
      g.boxBase(-2.0, 1.0, -3.4, 0.35, 0.3, 0.25, '#7fd3ff') // billing screen
      spots.push(
        clothes
          ? { type: 'shop_clothes', x: -2.5, z: -2.5, rot: Math.PI, radius: 1.6, label: 'Talk to the shopkeeper — outfits' }
          : { type: 'counter', x: -2.5, z: -2.5, rot: Math.PI, radius: 1.6, label: 'Buy snacks & water (₹30) — +40 stamina, +10 health' },
      )
      o.texts.push({ text: name || (clothes ? 'Fashion Point' : 'Kirana General Store'), x: 0, y: 2.8, z: -4.45, w: 4.4, h: 0.6, rot: 0, bg: clothes ? '#6c2a8a' : '#1e8449', fg: '#ffffff' })
      o.lights.push({ x: 0, y: 3.0, z: -1, color: '#fff3e2', intensity: 20 })
      break
    }
    case 'flat': {
      shell(o, 9, 8, 3.1, ['#c9b79c', '#bfae94'], '#efe6d6')
      box(-2.7, 0, -2.6, 2.0, 0.5, 2.3, '#6b4a3a') // bed
      b.boxBase(-2.7, 0.5, -2.6, 1.9, 0.18, 2.2, '#e8e2f4')
      b.boxBase(-2.7, 0.68, -3.45, 1.6, 0.15, 0.45, '#ffffff')
      box(2.6, 0, -3.3, 2.6, 0.9, 0.6, '#d9d2c0') // kitchen counter
      b.prim('cyl12', 2.0, 1.0, -3.3, 0.35, 0.18, 0.35, '#888')
      box(2.8, 0, 0.6, 2.2, 0.45, 0.9, '#2f4f6f') // sofa
      b.boxBase(2.8, 0.45, 1.0, 2.2, 0.5, 0.2, '#2f4f6f')
      box(-3.9, 0, 1.2, 0.6, 2.1, 1.6, '#7a5a3a') // wardrobe
      g.boxBase(2.8, 0.9, -1.6, 1.4, 0.8, 0.06, '#5aa7ff') // TV
      b.boxBase(2.8, 0, -1.6, 1.6, 0.6, 0.4, '#3a3a3a')
      spots.push(
        { type: 'bed', x: -2.7, z: -1.0, rot: Math.PI, radius: 1.5, label: 'Sleep until morning (saves the game)' },
        { type: 'shop_clothes', x: -3.2, z: 1.2, rot: -Math.PI / 2, radius: 1.3, label: 'Wardrobe — change outfit' },
        { type: 'bench', x: 2.8, z: 0.0, rot: Math.PI, radius: 1.2, label: 'Sit on the sofa', data: { propX: 2.8 + 0.45, propZ: 0.65 } },
      )
      o.lights.push({ x: 0, y: 2.8, z: -0.5, color: '#ffe6c4', intensity: 18 })
      break
    }
    case 'metro': {
      // underground platform hall: concourse (z>0), platform edge with screen doors, track bed (z<-1)
      const W = 44,
        D = 16,
        H = 6
      shell(o, W, D, H, ['#d9d6cf', '#cfccc4'], '#e3e0d8', '#c9c6be')
      // track bed (darker strip, rails) along X
      const tz = -5.2
      b.groundQuad([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -2.6], [-W / 2, -2.6]], 0.03, '#3a3a3a')
      for (const o2 of [-0.72, 0.72]) b.boxBase(0, 0.03, tz + o2, W, 0.12, 0.08, '#9a9a9a')
      // yellow edge line and platform screen doors (glass panels with gaps aligned to train doors)
      b.groundQuad([[-W / 2, -2.6], [W / 2, -2.6], [W / 2, -2.2], [-W / 2, -2.2]], 0.04, '#f2c230')
      for (let x = -W / 2 + 1; x < W / 2 - 1; x += 4) {
        b.boxBase(x + 1.0, 0, -2.45, 2.0, 2.2, 0.06, '#9ec9d6')
        g.boxBase(x + 1.0, 2.25, -2.45, 2.0, 0.1, 0.07, '#ff4d4d')
      }
      colliders.push({ x: 0, y: 1.2, z: -2.45, hw: W / 2, hh: 1.2, hd: 0.1, rot: 0 })
      // pillars, benches, ticket machine, signage
      for (let x = -W / 2 + 6; x < W / 2 - 4; x += 10) box(x, 0, 1.5, 0.8, H, 0.8, '#bdb8ae')
      for (const x of [-14, 0, 14]) {
        box(x + 3, 0, 4.5, 2.4, 0.45, 0.5, '#8d939a', false)
        spots.push({ type: 'bench', x: x + 3, z: 5.4, rot: Math.PI, radius: 1.1, label: 'Sit on the bench', data: { propX: x + 3 + 0.45, propZ: 4.5 } })
      }
      box(-8, 0, 6.6, 1.0, 1.8, 0.6, '#c62828')
      g.boxBase(-8, 1.1, 6.28, 0.6, 0.45, 0.03, '#a8e3ff')
      spots.push({ type: 'ticket', x: -8, z: 5.6, rot: Math.PI, radius: 1.4, label: 'Ticket machine — pick a destination' })
      spots.push({ type: 'board', x: 0, z: -1.6, rot: 0, radius: 9, label: 'Board the train (when it arrives)' })
      for (const x of [-12, 12]) o.texts.push({ text: name, x, y: 3.6, z: -2.35, w: 7, h: 1, rot: Math.PI, bg: '#ffffff', fg: '#c62828' })
      o.texts.push({ text: `${name} · Metro`, x: 0, y: 4.2, z: D / 2 - 0.2, w: 9, h: 1.1, rot: Math.PI, bg: '#c62828', fg: '#ffffff' })
      for (let x = -18; x <= 18; x += 12) o.lights.push({ x, y: H - 0.5, z: 0, color: '#eef6ff', intensity: 40 })
      o.trackZ = tz
      o.spawn = { x: 0, z: D / 2 - 1.6, yaw: Math.PI }
      break
    }
  }
  return o
}

/** Train for the metro hall (local frame, moves along X). */
export function buildMetroTrain() {
  const b = new GeoBuilder()
  const g = new GeoBuilder()
  for (let c = 0; c < 4; c++) {
    const x = (c - 1.5) * 21
    b.prim('rbox', x, 1.95, 0, 20.4, 3.3, 3.0, '#d7dade')
    b.boxBase(x, 0.3, 0, 20, 0.5, 2.6, '#3a3d42')
    b.boxBase(x, 1.0, 1.51, 20.2, 0.18, 0.02, '#c62828')
    b.boxBase(x, 1.0, -1.51, 20.2, 0.18, 0.02, '#c62828')
    for (let k = -8; k <= 8; k += 4) {
      b.boxBase(x + k, 1.95, 1.505, 2.6, 0.9, 0.02, '#20303c')
      b.boxBase(x + k + 2, 1.35, 1.505, 1.3, 2.0, 0.025, '#9aa0a6') // door
    }
    g.boxBase(x, 3.4, 0, 19, 0.04, 2.0, '#f4f8ff')
  }
  return { body: b.build(), glow: g.build() }
}
