import * as THREE from 'three'
import { GeoBuilder } from '../utils/geoBuilder'
import { mulberry32, pick } from '../utils/math'
import type { Prop } from './types'

/** Collider spec in world space: box centre (x,y,z), half extents, yaw. */
export interface ColliderSpec {
  x: number
  y: number
  z: number
  hw: number
  hh: number
  hd: number
  rot: number
}

const col = (out: ColliderSpec[], x: number, z: number, rot: number, lx: number, lz: number, w: number, h: number, d: number, y0 = 0) => {
  const c = Math.cos(rot),
    s = Math.sin(rot)
  out.push({ x: x + lx * c + lz * s, y: y0 + h / 2, z: z - lx * s + lz * c, hw: w / 2, hh: h / 2, hd: d / 2, rot })
}

/* ===================================== VEHICLE MODELS ======================================= */

export type VehicleKind = 'hatch' | 'sedan' | 'suv' | 'taxi' | 'auto' | 'bus' | 'scooter' | 'bike' | 'truck'
export const VEHICLE_DIMS: Record<VehicleKind, { w: number; l: number; h: number }> = {
  hatch: { w: 1.65, l: 3.8, h: 1.5 },
  sedan: { w: 1.75, l: 4.4, h: 1.45 },
  suv: { w: 1.85, l: 4.6, h: 1.8 },
  taxi: { w: 1.75, l: 4.3, h: 1.5 },
  auto: { w: 1.35, l: 2.7, h: 1.75 },
  bus: { w: 2.55, l: 11.5, h: 3.1 },
  scooter: { w: 0.7, l: 1.8, h: 1.15 },
  bike: { w: 0.75, l: 2.0, h: 1.1 },
  truck: { w: 2.4, l: 7.5, h: 3.2 },
}
export const CAR_COLORS = ['#f2f2f0', '#f2f2f0', '#c7c9cc', '#9da1a6', '#2b2d31', '#b3261e', '#1f4e8c', '#6d4c3d', '#e3dccb', '#3a5f3a']

/**
 * Build a vehicle into body (lit) + glow (lamps) builders. Local frame: +Z forward, origin on ground centre.
 * `ox/oz/rot` place it in the world (0 for a template mesh).
 */
export function buildVehicle(kind: VehicleKind, color: string, b: GeoBuilder, g: GeoBuilder, ox = 0, oz = 0, rot = 0, lightsOn = false) {
  const box = (lx: number, ly: number, lz: number, w: number, h: number, d: number, c: string) => b.boxLocal(ox, oz, rot, lx, ly, lz, w, h, d, c)
  const glow = (lx: number, ly: number, lz: number, w: number, h: number, d: number, c: string) => g.boxLocal(ox, oz, rot, lx, ly, lz, w, h, d, c)
  const wheel = (lx: number, lz: number, r: number, wdt: number) =>
    b.primLocal('cyl12', ox, oz, rot, lx, r, lz, r * 2, wdt, r * 2, '#1b1b1b', 0, Math.PI / 2)
  const glass = '#1f2933'
  /** tyre + alloy rim + hub, facing outward */
  const carWheel = (lx: number, lz: number, r: number, wdt: number, side: number) => {
    b.primLocal('cyl16', ox, oz, rot, lx, r, lz, r * 2, wdt, r * 2, '#151515', 0, Math.PI / 2)
    b.primLocal('cyl16', ox, oz, rot, lx + side * (wdt / 2 + 0.005), r, lz, r * 1.3, 0.02, r * 1.3, '#b9bcc0', 0, Math.PI / 2)
    b.primLocal('cyl12', ox, oz, rot, lx + side * (wdt / 2 + 0.015), r, lz, r * 0.4, 0.02, r * 0.4, '#6d7176', 0, Math.PI / 2)
  }
  const D = VEHICLE_DIMS[kind]
  switch (kind) {
    case 'hatch':
    case 'sedan':
    case 'suv':
    case 'taxi': {
      const suv = kind === 'suv'
      const lowH = suv ? 0.78 : 0.56
      const cabinH = suv ? 0.72 : 0.58
      const cabinL = kind === 'sedan' ? D.l * 0.5 : kind === 'hatch' ? D.l * 0.58 : D.l * 0.62
      const cabinZ = kind === 'hatch' ? -0.22 : suv ? -0.28 : -0.08
      const body = kind === 'taxi' ? '#1d1f1c' : color
      const y0 = suv ? 0.42 : 0.34
      const rb = (lx: number, ly: number, lz: number, w: number, h: number, d: number, c: string) => b.primLocal('rbox', ox, oz, rot, lx, ly, lz, w, h, d, c)
      // body shell (rounded), lower sills & wheel-arch shading
      rb(0, y0 + lowH / 2, 0, D.w, lowH, D.l, body)
      box(0, y0 + 0.06, 0, D.w + 0.02, 0.12, D.l * 0.62, '#1c1c1c')
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(sx * (D.w / 2 - 0.02), y0 + 0.16, sz * (D.l / 2 - 0.75), 0.06, 0.38, 0.86, '#141414')
      // greenhouse: body-coloured pillars + tinted glass, raked windscreens
      b.primLocal('cabin', ox, oz, rot, 0, y0 + lowH + cabinH / 2 - 0.02, cabinZ, D.w * 0.9, cabinH, cabinL, body)
      b.primLocal('cabin', ox, oz, rot, 0, y0 + lowH + cabinH * 0.47, cabinZ, D.w * 0.915, cabinH * 0.74, cabinL * 0.96, glass)
      box(0, y0 + lowH + cabinH * 0.47, cabinZ, D.w * 0.93, cabinH * 0.7, 0.07, body) // B-pillar
      // bonnet line, door seams, handles, mirrors
      box(0, y0 + lowH + 0.004, cabinZ + cabinL / 2 + (D.l / 2 - cabinZ - cabinL / 2) / 2, D.w * 0.7, 0.01, 0.02, '#0e0e0e')
      for (const sx of [-1, 1]) {
        box(sx * (D.w / 2 + 0.003), y0 + lowH * 0.55, cabinZ, 0.01, lowH * 0.7, 0.02, '#111')
        box(sx * (D.w / 2 + 0.01), y0 + lowH * 0.72, cabinZ + 0.25, 0.02, 0.04, 0.14, '#cfcfcf')
        box(sx * (D.w / 2 + 0.01), y0 + lowH * 0.72, cabinZ - cabinL * 0.4, 0.02, 0.04, 0.14, '#cfcfcf')
        box(sx * (D.w / 2 + 0.08), y0 + lowH + 0.1, cabinZ + cabinL / 2 - 0.05, 0.12, 0.1, 0.16, body)
      }
      if (suv) for (const sx of [-1, 1]) box(sx * D.w * 0.36, y0 + lowH + cabinH + 0.02, cabinZ, 0.05, 0.05, cabinL * 0.9, '#2a2a2a')
      if (kind === 'taxi') {
        // Delhi-style black & yellow: yellow roof, yellow band, roof sign
        box(0, y0 + lowH + cabinH - 0.01, cabinZ, D.w * 0.74, 0.06, cabinL * 0.62, '#f2c230')
        box(0, y0 + lowH * 0.62, 0, D.w + 0.015, 0.12, D.l * 0.96, '#f2c230')
        glow(0, y0 + lowH + cabinH + 0.1, cabinZ, 0.5, 0.14, 0.18, '#ffe9a0')
      }
      // grille, bumpers, plates
      box(0, y0 + lowH * 0.55, D.l / 2 + 0.005, D.w * 0.48, lowH * 0.32, 0.03, '#141414')
      rb(0, y0 + 0.12, D.l / 2 - 0.02, D.w * 1.0, 0.24, 0.16, '#262626')
      rb(0, y0 + 0.14, -D.l / 2 + 0.02, D.w * 1.0, 0.26, 0.16, '#262626')
      box(0, y0 + 0.2, D.l / 2 + 0.07, 0.5, 0.12, 0.02, '#f4f4f4')
      box(0, y0 + 0.24, -D.l / 2 - 0.07, 0.5, 0.12, 0.02, kind === 'taxi' ? '#f2c230' : '#f4f4f4')
      // light clusters (glow material blooms at night)
      const hl = lightsOn ? '#fff6d8' : '#d8d8d0'
      for (const sx of [-1, 1]) {
        glow(sx * D.w * 0.36, y0 + lowH * 0.66, D.l / 2 + 0.005, 0.34, 0.12, 0.04, hl)
        glow(sx * D.w * 0.36, y0 + lowH * 0.48, D.l / 2 + 0.005, 0.3, 0.03, 0.04, '#e8f2ff') // DRL strip
        glow(sx * D.w * 0.38, y0 + lowH * 0.68, -D.l / 2 - 0.005, 0.3, 0.13, 0.04, '#c0201a')
        glow(sx * D.w * 0.38, y0 + lowH * 0.52, -D.l / 2 - 0.005, 0.12, 0.06, 0.04, '#ff8a1a')
      }
      const wr = suv ? 0.36 : 0.31
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) carWheel(sx * (D.w / 2 - 0.12), sz * (D.l / 2 - 0.75), wr, 0.22, sx)
      break
    }
    case 'auto': {
      // CNG auto-rickshaw: green body, yellow canopy
      const green = '#2f7d3b'
      const yellow = '#f0c419'
      box(0, 0.55, 0.15, D.w, 0.5, D.l * 0.75, green)
      box(0, 0.55, D.l / 2 - 0.25, 0.7, 0.75, 0.4, green)
      box(0, 1.0, D.l / 2 - 0.3, 0.9, 0.5, 0.06, glass)
      box(0, 1.62, -0.05, D.w * 1.02, 0.12, D.l * 0.82, yellow)
      box(0, 1.15, -D.l / 2 + 0.55, D.w, 0.95, 0.08, yellow)
      for (const sx of [-1, 1]) box(sx * (D.w / 2 - 0.03), 1.15, 0.6, 0.06, 0.95, 0.06, '#222')
      box(0, 0.75, -0.6, D.w * 0.9, 0.35, 0.6, '#3a2a20') // seat
      wheel(0, D.l / 2 - 0.25, 0.22, 0.14)
      wheel(D.w / 2 - 0.1, -D.l / 2 + 0.45, 0.22, 0.14)
      wheel(-D.w / 2 + 0.1, -D.l / 2 + 0.45, 0.22, 0.14)
      glow(0, 0.85, D.l / 2 - 0.04, 0.18, 0.18, 0.04, lightsOn ? '#fff6d8' : '#ddd')
      glow(0.45, 0.6, -D.l / 2 + 0.38, 0.12, 0.12, 0.04, '#c0201a')
      glow(-0.45, 0.6, -D.l / 2 + 0.38, 0.12, 0.12, 0.04, '#c0201a')
      break
    }
    case 'bus': {
      const c = color
      box(0, 0.35 + 1.35, 0, D.w, 2.7, D.l, c)
      box(0, 2.05, 0, D.w + 0.02, 0.85, D.l * 0.96, glass)
      box(0, 0.75, 0, D.w + 0.01, 0.25, D.l, '#e4e1d6')
      box(0, 1.6, D.l / 2 + 0.01, D.w * 0.9, 1.3, 0.04, glass)
      box(0, 3.1, 0, D.w * 0.7, 0.18, D.l * 0.4, '#bdbdbd')
      glow(0, 2.8, D.l / 2 + 0.03, D.w * 0.6, 0.25, 0.04, '#ffb43a') // route board
      glow(D.w * 0.36, 0.7, D.l / 2 + 0.02, 0.3, 0.16, 0.04, lightsOn ? '#fff6d8' : '#ddd')
      glow(-D.w * 0.36, 0.7, D.l / 2 + 0.02, 0.3, 0.16, 0.04, lightsOn ? '#fff6d8' : '#ddd')
      glow(D.w * 0.4, 0.8, -D.l / 2 - 0.02, 0.25, 0.25, 0.04, '#c0201a')
      glow(-D.w * 0.4, 0.8, -D.l / 2 - 0.02, 0.25, 0.25, 0.04, '#c0201a')
      for (const sx of [-1, 1]) for (const z of [D.l / 2 - 2.2, -D.l / 2 + 2.6]) wheel(sx * (D.w / 2 - 0.25), z, 0.5, 0.35)
      break
    }
    case 'truck': {
      box(0, 1.35, D.l / 2 - 1.1, D.w, 1.9, 2.0, color)
      box(0, 1.85, D.l / 2 - 0.08, D.w * 0.85, 0.75, 0.05, glass)
      box(0, 1.5, -1.0, D.w, 2.2, D.l - 2.4, '#d98b2b')
      box(0, 2.66, -1.0, D.w + 0.02, 0.1, D.l - 2.4, '#b8303a')
      glow(D.w * 0.35, 0.7, D.l / 2 + 0.02, 0.3, 0.18, 0.04, lightsOn ? '#fff6d8' : '#ddd')
      glow(-D.w * 0.35, 0.7, D.l / 2 + 0.02, 0.3, 0.18, 0.04, lightsOn ? '#fff6d8' : '#ddd')
      for (const sx of [-1, 1]) for (const z of [D.l / 2 - 1.2, -D.l / 2 + 1.2, -D.l / 2 + 2.3]) wheel(sx * (D.w / 2 - 0.25), z, 0.5, 0.35)
      break
    }
    case 'scooter':
    case 'bike': {
      const c = color
      wheel(0, D.l / 2 - 0.3, 0.27, 0.1)
      wheel(0, -D.l / 2 + 0.3, 0.27, 0.1)
      if (kind === 'scooter') {
        box(0, 0.5, -0.25, 0.42, 0.42, 0.9, c)
        box(0, 0.78, -0.3, 0.32, 0.12, 0.7, '#1c1c1c')
        box(0, 0.75, 0.55, 0.36, 0.7, 0.18, c)
      } else {
        box(0, 0.62, 0.1, 0.3, 0.3, 0.7, c)
        box(0, 0.85, -0.3, 0.26, 0.1, 0.6, '#1c1c1c')
        box(0, 0.45, 0, 0.22, 0.22, 0.6, '#555')
      }
      box(0, 1.02, D.l / 2 - 0.42, 0.7, 0.04, 0.04, '#222')
      glow(0, 0.95, D.l / 2 - 0.32, 0.14, 0.12, 0.05, lightsOn ? '#fff6d8' : '#ddd')
      glow(0, 0.75, -D.l / 2 + 0.2, 0.1, 0.06, 0.04, '#c0201a')
      break
    }
  }
}

/** Template geometries for traffic (shared across all instances of a kind+colour). */
const templateCache = new Map<string, { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }>()
export function vehicleTemplate(kind: VehicleKind, color: string) {
  const k = kind + color
  let t = templateCache.get(k)
  if (!t) {
    const b = new GeoBuilder()
    const g = new GeoBuilder()
    buildVehicle(kind, color, b, g, 0, 0, 0, true)
    t = { body: b.build(), glow: g.build() }
    templateCache.set(k, t)
  }
  return t
}

/* ======================================= HUMAN RIDERS ======================================= */

function seatedRider(b: GeoBuilder, ox: number, oz: number, rot: number, lz: number, y: number, shirt: string, skin: string) {
  b.boxLocal(ox, oz, rot, 0, y + 0.32, lz, 0.38, 0.55, 0.24, shirt)
  b.primLocal('sphere', ox, oz, rot, 0, y + 0.72, lz, 0.2, 0.24, 0.22, skin)
  b.boxLocal(ox, oz, rot, 0.11, y + 0.05, lz + 0.25, 0.14, 0.14, 0.5, '#2c3440')
  b.boxLocal(ox, oz, rot, -0.11, y + 0.05, lz + 0.25, 0.14, 0.14, 0.5, '#2c3440')
}

/* ========================================== PROPS =========================================== */

const GREENS = ['#4c7a2e', '#5a8a33', '#3f6b28', '#678f3a', '#557f2f']
const TARPS = ['#2a6fb0', '#c8452b', '#e0a028', '#2f8a4c', '#7a3fa0']
const SKINS = ['#8d5a3b', '#a8714c', '#6f4430', '#b9835b', '#7d4f36']

export interface FoliageOut {
  leaves: GeoBuilder
  fronds: GeoBuilder
  tropical: boolean
}

export function buildProp(p: Prop, b: GeoBuilder, g: GeoBuilder, colliders: ColliderSpec[], fol?: FoliageOut) {
  const { x, z, rot } = p
  const r = mulberry32(Math.floor(p.v * 1e9))
  const L = (lx: number, ly: number, lz: number, w: number, h: number, d: number, c: string, rr = 0) => b.boxLocal(x, z, rot, lx, ly, lz, w, h, d, c, rr)
  switch (p.type) {
    case 'tree': {
      if (fol?.tropical && p.v > 0.45) {
        // coconut palm: leaning segmented trunk + drooping frond cards
        const H = 7 + r() * 4
        const lean = (r() - 0.5) * 0.5,
          dir = r() * Math.PI * 2
        let px = x,
          pz = z
        for (let k = 0; k < 6; k++) {
          const t = k / 6
          const off = lean * t * t * H
          px = x + Math.cos(dir) * off
          pz = z + Math.sin(dir) * off
          b.prim('cyl8', px, (k + 0.5) * (H / 6), pz, 0.34 - t * 0.08, H / 6 + 0.05, 0.34 - t * 0.08, k % 2 ? '#8a7356' : '#7b6549')
        }
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + r()
          const L = 3.6 + r() * 1.2
          fol.fronds.primUV('card', px + Math.cos(a) * L * 0.42, H - 0.2, pz + Math.sin(a) * L * 0.42, L, 1.25, 1, pick(r, ['#ffffff', '#e8f0d8', '#d9e6c0']), -a, -Math.PI / 2 + 0.55, 0)
        }
        b.prim('sphere', px, H - 0.1, pz, 0.7, 0.6, 0.7, '#5a4a32')
        col(colliders, px, pz, 0, 0, 0, 0.5, 3, 0.5)
        break
      }
      const ashoka = p.v < 0.22
      const th = 2.4 + r() * 1.6
      b.prim('cyl8', x, th / 2, z, 0.34, th, 0.34, '#5d4636')
      const tint = pick(r, ['#ffffff', '#e9f5d8', '#dcebc4', '#f2f7e6', '#cfe0b5'])
      if (ashoka) {
        // Polyalthia (mast tree): tall, narrow, drooping — lines many Delhi avenues
        const h = 7.5 + r() * 3.5
        b.prim('cone8', x, th + h / 2 - 1.5, z, 2.2, h, 2.2, '#2f5a22', r() * 6)
        if (fol) for (let k = 0; k < 5; k++) fol.leaves.primUV('card', x, th + h * (0.2 + k * 0.15) - 1, z, 2.6 - k * 0.35, 3.2, 1, '#9fc48a', r() * 6, 0, 0)
      } else {
        const s = 2.3 + r() * 1.7
        const cy = th + s * 0.55
        // dark inner volume so the canopy never looks hollow
        b.prim('ico', x, cy, z, s * 0.72, s * 0.58, s * 0.72, '#3d6a2a', r() * 6)
        if (fol) {
          // layered leaf cards around an ellipsoid
          for (let k = 0; k < 14; k++) {
            const a = r() * Math.PI * 2,
              e = (r() - 0.35) * 1.2
            const cx = x + Math.cos(a) * s * 0.42,
              cz = z + Math.sin(a) * s * 0.42
            fol.leaves.primUV('card', cx, cy + e * s * 0.35, cz, s * 1.15, s * 0.95, 1, tint, a + Math.PI / 2 + (r() - 0.5), (r() - 0.5) * 0.9, 0)
          }
          fol.leaves.primUV('card', x, cy + s * 0.42, z, s * 1.2, s * 1.2, 1, tint, r() * 6, -Math.PI / 2, 0)
        } else {
          b.prim('ico0', x, th + s * 0.45, z, s * 1.35, s, s * 1.35, pick(r, GREENS), r() * 6)
        }
      }
      // whitewashed trunk base (very Indian)
      b.prim('cyl8', x, 0.5, z, 0.37, 1.0, 0.37, '#e8e4da')
      col(colliders, x, z, 0, 0, 0, 0.45, 3, 0.45)
      break
    }
    case 'lamp': {
      L(0, 3.9, 0, 0.16, 7.8, 0.16, '#5a5d60')
      L(0, 7.75, 0.8, 0.1, 0.1, 1.7, '#5a5d60')
      g.boxLocal(x, z, rot, 0, 7.62, 1.55, 0.35, 0.14, 0.6, '#fff1cf')
      L(0, 0.4, 0, 0.32, 0.8, 0.32, '#3f4144')
      col(colliders, x, z, rot, 0, 0, 0.3, 4, 0.3)
      break
    }
    case 'bench': {
      const c = p.v < 0.5 ? '#3d6b45' : '#9a958c'
      L(0, 0.45, 0, 1.8, 0.08, 0.48, c)
      L(0, 0.75, -0.22, 1.8, 0.5, 0.07, c)
      for (const sx of [-0.75, 0.75]) L(sx, 0.22, 0, 0.08, 0.45, 0.44, '#3a3a3a')
      col(colliders, x, z, rot, 0, -0.05, 1.8, 0.5, 0.5)
      break
    }
    case 'tea_stall': {
      const tarp = pick(r, TARPS)
      L(0, 0.5, 0, 1.9, 1.0, 0.9, '#8b5a2b')
      L(0, 1.02, 0, 2.0, 0.06, 1.0, '#6e4520')
      for (const sx of [-0.95, 0.95]) for (const sz of [-0.45, 0.45]) L(sx, 1.25, sz, 0.05, 2.5, 0.05, '#4a4a4a')
      L(0, 2.5, 0.2, 2.4, 0.06, 1.8, tarp, 0)
      // stove + big kettle + glasses
      b.primLocal('cyl8', x, z, rot, -0.5, 1.15, 0, 0.35, 0.22, 0.35, '#2b2b2b')
      b.primLocal('cyl12', x, z, rot, -0.5, 1.42, 0, 0.32, 0.36, 0.32, '#c7c3b8')
      for (let i = 0; i < 6; i++) b.primLocal('cyl8', x, z, rot, 0.1 + i * 0.12, 1.11, 0.2, 0.07, 0.11, 0.07, '#e9dfb8')
      g.boxLocal(x, z, rot, -0.5, 1.07, 0.05, 0.25, 0.04, 0.25, '#ff7a2a')
      // plastic stools / bench for customers
      L(0, 0.22, 1.25, 1.6, 0.06, 0.35, '#2a5ea8')
      for (const sx of [-0.7, 0.7]) L(sx, 0.11, 1.25, 0.06, 0.22, 0.3, '#2a5ea8')
      col(colliders, x, z, rot, 0, 0, 1.95, 1.1, 0.95)
      break
    }
    case 'food_stall': {
      const c = pick(r, ['#b0302a', '#c4571e', '#2b6aa8'])
      L(0, 0.75, 0, 1.6, 0.6, 0.85, c)
      L(0, 1.3, 0, 1.3, 0.5, 0.65, '#cfe3e8') // glass display
      for (let i = 0; i < 9; i++) b.primLocal('cone8', x, z, rot, -0.45 + (i % 3) * 0.3, 1.15, -0.15 + Math.floor(i / 3) * 0.15, 0.16, 0.13, 0.16, '#d6a24a')
      for (const sx of [-0.65, 0.65]) b.primLocal('cyl12', x, z, rot, sx, 0.3, -0.42, 0.6, 0.08, 0.6, '#333', 0, Math.PI / 2)
      L(0.7, 1.6, 0, 0.05, 3.2, 0.05, '#555')
      b.primLocal('cone8', x, z, rot, 0.7, 3.1, 0, 3.0, 0.7, 3.0, pick(r, ['#e74c3c', '#f1c40f', '#3498db']))
      g.boxLocal(x, z, rot, 0, 1.58, 0, 1.2, 0.04, 0.5, '#fff1c0')
      col(colliders, x, z, rot, 0, 0, 1.65, 1.6, 0.9)
      break
    }
    case 'fruit_cart': {
      L(0, 0.75, 0, 1.9, 0.12, 1.0, '#7a5230')
      for (const sx of [-0.8, 0.8]) b.primLocal('cyl12', x, z, rot, sx, 0.35, 0, 0.7, 0.08, 0.7, '#5b4026', 0, Math.PI / 2)
      const fruits = ['#e8c547', '#d33b2c', '#f08a24', '#7cb342', '#9c27b0', '#e8c547']
      for (let i = 0; i < 40; i++)
        b.primLocal('ico0', x, z, rot, -0.85 + r() * 1.7, 0.86 + r() * 0.25, -0.42 + r() * 0.84, 0.16, 0.16, 0.16, pick(r, fruits))
      col(colliders, x, z, rot, 0, 0, 1.9, 1.1, 1.0)
      break
    }
    case 'pan_shop': {
      L(0, 1.1, 0, 1.4, 2.2, 1.3, '#2f7a4a')
      L(0, 1.1, 0.66, 1.1, 0.9, 0.02, '#2a1b12')
      L(0, 2.3, 0.2, 1.7, 0.08, 1.8, '#c0392b')
      for (let i = 0; i < 14; i++) L(-0.5 + (i % 7) * 0.16, 1.75 - Math.floor(i / 7) * 0.22, 0.7, 0.12, 0.18, 0.02, pick(r, ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#9b59b6']))
      g.boxLocal(x, z, rot, 0, 1.6, 0.6, 0.6, 0.05, 0.05, '#fff6da')
      col(colliders, x, z, rot, 0, 0, 1.4, 2.2, 1.3)
      break
    }
    case 'atm': {
      L(0, 1.0, -0.1, 0.85, 2.0, 0.5, '#2d5aa0')
      L(0, 1.9, 0.16, 0.85, 0.25, 0.04, '#f2f2f2')
      g.boxLocal(x, z, rot, 0, 1.35, 0.16, 0.42, 0.3, 0.02, '#8fd3ff')
      L(0, 1.0, 0.18, 0.5, 0.08, 0.15, '#333')
      col(colliders, x, z, rot, 0, -0.1, 0.85, 2.0, 0.5)
      break
    }
    case 'bus_stop': {
      L(0, 2.6, 0, 4.2, 0.1, 1.9, '#c0392b')
      L(0, 1.4, -0.85, 4.2, 2.2, 0.06, '#d9e2e6')
      for (const sx of [-2, 2]) L(sx, 1.3, -0.8, 0.1, 2.6, 0.1, '#7b7f83')
      L(0, 0.45, -0.55, 3.2, 0.08, 0.45, '#9aa0a6')
      g.boxLocal(x, z, rot, 1.2, 2.3, -0.82, 1.3, 0.35, 0.05, '#ffe9a8')
      col(colliders, x, z, rot, 0, -0.85, 4.2, 2.6, 0.2)
      break
    }
    case 'auto_parked':
      buildVehicle('auto', '#2f7d3b', b, g, x, z, rot)
      col(colliders, x, z, rot, 0, 0, 1.35, 1.7, 2.7)
      break
    case 'car_parked': {
      const kind = pick(r, ['hatch', 'hatch', 'sedan', 'suv'] as const)
      buildVehicle(kind, pick(r, CAR_COLORS), b, g, x, z, rot)
      const D = VEHICLE_DIMS[kind]
      col(colliders, x, z, rot, 0, 0, D.w, D.h, D.l)
      break
    }
    case 'scooter_parked': {
      buildVehicle(p.v < 0.6 ? 'scooter' : 'bike', pick(r, ['#c0392b', '#1f1f1f', '#2e86de', '#ecf0f1', '#7f8c8d']), b, g, x, z, rot)
      col(colliders, x, z, rot, 0, 0, 0.6, 1.0, 1.7)
      break
    }
    case 'dog': {
      const c = pick(r, ['#b07a45', '#8a5a33', '#d9b382', '#3a2c22'])
      const lying = p.v < 0.6
      if (lying) {
        L(0, 0.18, 0, 0.32, 0.3, 0.75, c)
        L(0, 0.22, 0.45, 0.22, 0.2, 0.26, c)
        L(0.08, 0.34, 0.42, 0.05, 0.1, 0.05, c)
        L(-0.08, 0.34, 0.42, 0.05, 0.1, 0.05, c)
      } else {
        L(0, 0.35, -0.1, 0.3, 0.3, 0.55, c)
        L(0, 0.6, 0.18, 0.24, 0.45, 0.25, c)
        L(0, 0.86, 0.27, 0.22, 0.2, 0.3, c)
        for (const sx of [-0.1, 0.1]) L(sx, 0.18, 0.25, 0.07, 0.36, 0.07, c)
      }
      break
    }
    case 'cow': {
      L(0, 0.45, 0, 0.75, 0.75, 1.7, '#ece8de')
      L(0, 0.75, 1.0, 0.4, 0.45, 0.55, '#ece8de')
      L(0.18, 1.05, 1.0, 0.05, 0.25, 0.05, '#7b6a55', 0)
      L(-0.18, 1.05, 1.0, 0.05, 0.25, 0.05, '#7b6a55', 0)
      L(0, 0.95, 0.15, 0.3, 0.3, 0.4, '#e2dccf') // hump
      col(colliders, x, z, rot, 0, 0.2, 0.9, 1.0, 2.2)
      break
    }
    case 'metro_entrance': {
      L(0, 1.6, -1.2, 4.6, 3.2, 0.25, '#d6d2c8')
      for (const sx of [-2.2, 2.2]) L(sx, 1.6, 0.2, 0.25, 3.2, 3.0, '#d6d2c8')
      L(0, 3.25, 0.2, 5.0, 0.18, 3.6, '#7c8288')
      L(0, 0.05, 0.4, 4.2, 0.1, 2.6, '#55595e')
      g.boxLocal(x, z, rot, 0, 3.7, 1.9, 2.4, 0.6, 0.12, '#e53935')
      col(colliders, x, z, rot, 0, -1.2, 4.6, 3.2, 0.3)
      col(colliders, x, z, rot, -2.2, 0.2, 0.3, 3.2, 3.0)
      col(colliders, x, z, rot, 2.2, 0.2, 0.3, 3.2, 3.0)
      break
    }
    case 'flagpole': {
      b.prim('cyl12', x, 0.6, z, 4.5, 1.2, 4.5, '#cfc9bc')
      b.prim('cyl12', x, 23, z, 0.5, 46, 0.5, '#d9dde0')
      b.prim('sphere', x, 46.2, z, 0.7, 0.7, 0.7, '#e0c060')
      col(colliders, x, z, 0, 0, 0, 4.2, 1.2, 4.2)
      break
    }
    case 'fountain': {
      b.prim('cyl12', x, 0.3, z, 7, 0.6, 7, '#cdb79a')
      b.prim('cyl12', x, 0.5, z, 6.2, 0.2, 6.2, '#5d97a6')
      b.prim('cyl12', x, 1.2, z, 0.8, 2.4, 0.8, '#cdb79a')
      b.prim('cone8', x, 2.9, z, 0.6, 1.4, 0.6, '#d6eef5')
      col(colliders, x, z, 0, 0, 0, 7, 0.6, 7)
      break
    }
    case 'petrol_pump': {
      for (const sx of [-4.5, 4.5]) for (const sz of [-2.5, 2.5]) L(sx, 2.6, sz, 0.4, 5.2, 0.4, '#d8d8d8')
      L(0, 5.4, 0, 12, 0.6, 7.5, '#f4f4f0')
      L(0, 5.1, 0, 12.1, 0.15, 7.6, '#2e8b57')
      g.boxLocal(x, z, rot, 0, 5.05, 0, 10, 0.04, 6, '#f6f6ee')
      for (const sx of [-2.5, 2.5]) {
        L(sx, 0.1, 0, 1.2, 0.2, 3.5, '#bdbdbd')
        L(sx, 0.95, 0, 0.7, 1.6, 0.5, '#2e8b57')
        g.boxLocal(x, z, rot, sx, 1.3, 0.26, 0.4, 0.3, 0.02, '#cfefff')
      }
      L(6.8, 3, 3.8, 0.25, 6, 0.25, '#888')
      L(6.8, 6.3, 3.8, 1.6, 1.4, 0.2, '#2e8b57')
      for (const sx of [-4.5, 4.5]) for (const sz of [-2.5, 2.5]) col(colliders, x, z, rot, sx, sz, 0.4, 5, 0.4)
      for (const sx of [-2.5, 2.5]) col(colliders, x, z, rot, sx, 0, 0.8, 1.7, 0.6)
      break
    }
    case 'police_booth': {
      L(0, 1.3, 0, 2.0, 2.6, 2.0, '#f2f2ee')
      L(0, 1.6, 1.01, 1.4, 0.9, 0.02, '#2a3540')
      L(0, 2.0, 0, 2.06, 0.25, 2.06, '#1f4e8c')
      L(0, 2.72, 0, 2.3, 0.15, 2.3, '#e0e0e0')
      g.boxLocal(x, z, rot, -0.25, 2.9, 0, 0.3, 0.2, 0.3, '#ff3030')
      g.boxLocal(x, z, rot, 0.25, 2.9, 0, 0.3, 0.2, 0.3, '#3060ff')
      col(colliders, x, z, rot, 0, 0, 2.0, 2.6, 2.0)
      break
    }
    case 'shrine': {
      L(0, 0.3, 0, 1.6, 0.6, 1.6, '#e8dcc6')
      L(0, 1.2, 0, 1.1, 1.2, 1.1, '#f3e3c3')
      b.primLocal('cone8', x, z, rot, 0, 2.4, 0, 1.2, 1.4, 1.2, '#e8862a')
      b.primLocal('sphere', x, z, rot, 0, 3.2, 0, 0.25, 0.25, 0.25, '#d9a62b')
      L(0, 1.0, 0.56, 0.5, 0.7, 0.02, '#3a1f12')
      g.boxLocal(x, z, rot, 0.3, 3.6, 0, 0.45, 0.3, 0.02, '#ff7a1a')
      L(0.1, 3.3, 0, 0.03, 1.2, 0.03, '#555')
      col(colliders, x, z, rot, 0, 0, 1.6, 2, 1.6)
      break
    }
    case 'coach': {
      const loco = p.v < 0.05
      L(0, 2.2, 0, 3.1, 3.4, 22.2, loco ? '#b8352b' : '#2f4f8f')
      L(0, 2.6, 0, 3.15, 0.85, 21.4, loco ? '#f2c230' : '#1e2a3c')
      L(0, 4.0, 0, 2.8, 0.3, 21.8, '#7f8a96')
      L(0, 0.45, 0, 2.4, 0.5, 20, '#2b2b2b')
      col(colliders, x, z, rot, 0, 0, 3.1, 4, 22.2, 0.3)
      break
    }
    default:
      break
  }
}

/** Stationary vendor/customer figure (very simple, merged into the chunk). */
export function buildVendor(b: GeoBuilder, x: number, z: number, rot: number, v: number) {
  const r = mulberry32(Math.floor(v * 1e9) + 3)
  const skin = pick(r, SKINS)
  const shirt = pick(r, ['#f1f1f1', '#d6c7a1', '#9c3b2e', '#3b5f8a', '#e9d27a'])
  b.boxLocal(x, z, rot, 0, 0.45, 0, 0.32, 0.9, 0.22, pick(r, ['#2c3440', '#d8d2c2', '#5a4632']))
  b.boxLocal(x, z, rot, 0, 1.2, 0, 0.42, 0.62, 0.25, shirt)
  b.primLocal('sphere', x, z, rot, 0, 1.68, 0, 0.21, 0.26, 0.23, skin)
  b.primLocal('sphere', x, z, rot, 0, 1.78, -0.02, 0.22, 0.14, 0.23, '#1d1712')
}

export { seatedRider }
