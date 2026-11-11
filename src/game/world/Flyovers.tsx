import { useRapier } from '@react-three/rapier'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { GeoBuilder } from '../utils/geoBuilder'
import { materials } from './materials'
import type { CityData, Flyover } from './types'

/**
 * Elevated roads from OpenStreetMap (bridge=* / layer>=1 ways plus their approach ramps).
 * The importer gives every polyline point a deck height; here we build the deck, parapets,
 * piers (or solid embankment walls on the low parts of ramps), deck lamps, and matching
 * static Rapier colliders so the player, driven vehicles and AI traffic can use them.
 */
const ASPHALT = '#45464a'
const CONCRETE = '#a29d92'
const PARAPET = '#bdb7aa'
const PIER = '#9b968b'
const DECK_T = 1.1 // deck thickness
const EMBANK_BELOW = 2.6 // below this height the sides are solid retaining walls
const PARAPET_H = 0.95
const TILE = 300

type V3 = [number, number, number]

function face(b: GeoBuilder, p: [V3, V3, V3, V3], color: string, want: V3, uv?: [number, number, number, number, number, number, number, number]) {
  const [a, c1, c2, d] = p
  const e1 = [c1[0] - a[0], c1[1] - a[1], c1[2] - a[2]]
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const dot = n[0] * want[0] + n[1] * want[1] + n[2] * want[2]
  if (dot >= 0) b.quad(a, c1, c2, d, color, uv)
  else b.quad(d, c2, c1, a, color, uv ? [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]] : undefined)
}

export interface FlyCollider {
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
  yaw: number
  pitch: number
}

/** Build render geometry (bucketed into tiles for culling) and collider specs for all flyovers. */
export function buildFlyovers(list: Flyover[]) {
  const tiles = new Map<string, { deck: GeoBuilder; struct: GeoBuilder; glow: GeoBuilder }>()
  const colliders: FlyCollider[] = []
  const tileFor = (x: number, z: number) => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`
    let t = tiles.get(k)
    if (!t) tiles.set(k, (t = { deck: new GeoBuilder(), struct: new GeoBuilder(), glow: new GeoBuilder() }))
    return t
  }

  for (const f of list) {
    const n = f.pts.length / 2
    if (n < 2) continue
    const hw = f.w / 2 + 0.7 // shoulders
    // per-point left normal (mitred)
    const L: [number, number][] = []
    for (let i = 0; i < n; i++) {
      const pi = Math.max(0, i - 1),
        ni = Math.min(n - 1, i + 1)
      let dx = f.pts[ni * 2] - f.pts[pi * 2],
        dz = f.pts[ni * 2 + 1] - f.pts[pi * 2 + 1]
      const l = Math.hypot(dx, dz) || 1
      dx /= l
      dz /= l
      L.push([dz, -dx])
    }
    const top = (i: number) => Math.max(0.07, f.h[i]) + 0.05
    const bottom = (i: number) => (f.h[i] < EMBANK_BELOW ? 0 : f.h[i] - DECK_T)
    let total = 0
    for (let i = 0; i + 1 < n; i++) total += Math.hypot(f.pts[i * 2 + 2] - f.pts[i * 2], f.pts[i * 2 + 3] - f.pts[i * 2 + 1])
    const OPEN = 32
    const parapetAt = (s0: number, s1: number) => !((f.openA && s0 < OPEN) || (f.openB && s1 > total - OPEN))
    let acc = 0
    let nextPier = 10
    let nextLamp = 18
    for (let i = 0; i + 1 < n; i++) {
      const ax = f.pts[i * 2],
        az = f.pts[i * 2 + 1],
        bx = f.pts[i * 2 + 2],
        bz = f.pts[i * 2 + 3]
      const seg = Math.hypot(bx - ax, bz - az)
      if (seg < 0.05) continue
      const T = tileFor((ax + bx) / 2, (az + bz) / 2)
      const ya = top(i),
        yb = top(i + 1)
      const [lax, laz] = L[i],
        [lbx, lbz] = L[i + 1]
      const Al: V3 = [ax + lax * hw, ya, az + laz * hw],
        Ar: V3 = [ax - lax * hw, ya, az - laz * hw]
      const Bl: V3 = [bx + lbx * hw, yb, bz + lbz * hw],
        Br: V3 = [bx - lbx * hw, yb, bz - lbz * hw]
      // deck surface (world-space UVs for the asphalt detail texture)
      const u = (p: V3) => [p[0] * 0.125, p[2] * 0.125] as const
      face(T.deck, [Al, Bl, Br, Ar], ASPHALT, [0, 1, 0], [...u(Al), ...u(Bl), ...u(Br), ...u(Ar)] as never)
      // lane markings: dashed white lane lines (one-way) or a yellow centre line
      {
        const mark = (off: number, color: string, dashed: boolean) => {
          const s0 = acc,
            s1 = acc + seg
          const pieces: [number, number][] = []
          if (!dashed) pieces.push([0, 1])
          else
            for (let s = Math.ceil(s0 / 9) * 9; s < s1; s += 9) {
              const p0 = (s - s0) / seg,
                p1 = Math.min(1, (s + 4 - s0) / seg)
              pieces.push([p0, p1])
            }
          for (const [p0, p1] of pieces) {
            const pt = (p: number, side: number): V3 => {
              const x = ax + (bx - ax) * p,
                z = az + (bz - az) * p
              const y = ya + (yb - ya) * p + 0.02
              const nx = lax + (lbx - lax) * p,
                nz = laz + (lbz - laz) * p
              return [x + nx * (off + side * 0.07), y, z + nz * (off + side * 0.07)]
            }
            face(T.deck, [pt(p0, 1), pt(p1, 1), pt(p1, -1), pt(p0, -1)], color, [0, 1, 0])
          }
        }
        if (f.oneway) {
          const lanes = Math.max(1, Math.round(f.w / 3.4))
          for (let k = 1; k < lanes; k++) mark(-f.w / 2 + (f.w * k) / lanes, '#d9d6cc', true)
        } else mark(0, '#d8a531', false)
        mark(f.w / 2 + 0.25, '#d9d6cc', false)
        mark(-f.w / 2 - 0.25, '#d9d6cc', false)
      }
      // sides: deck edge (or retaining wall) + parapet (outer face, top, inner face)
      for (const side of [1, -1]) {
        const A = side > 0 ? Al : Ar,
          B = side > 0 ? Bl : Br
        const nx = (side > 0 ? lax + lbx : -lax - lbx) / 2,
          nz = (side > 0 ? laz + lbz : -laz - lbz) / 2
        const out: V3 = [nx, 0, nz]
        const inn: V3 = [-nx, 0, -nz]
        const ba = bottom(i),
          bb = bottom(i + 1)
        const par = parapetAt(acc, acc + seg)
        const pa = A[1] + (par ? PARAPET_H : 0),
          pb = B[1] + (par ? PARAPET_H : 0)
        // outer wall from parapet top to deck underside / ground
        face(T.struct, [[A[0], ba, A[2]], [B[0], bb, B[2]], [B[0], pb, B[2]], [A[0], pa, A[2]]], CONCRETE, out)
        T.struct.shadeLastQuadBottom(ba < 0.1 ? 0.6 : 0.85)
        if (!par) continue
        // parapet (0.3 m thick)
        const ix = -nx * 0.3,
          iz = -nz * 0.3
        face(T.struct, [[A[0], pa, A[2]], [B[0], pb, B[2]], [B[0] + ix, pb, B[2] + iz], [A[0] + ix, pa, A[2] + iz]], PARAPET, [0, 1, 0])
        face(T.struct, [[A[0] + ix, A[1], A[2] + iz], [B[0] + ix, B[1], B[2] + iz], [B[0] + ix, pb, B[2] + iz], [A[0] + ix, pa, A[2] + iz]], PARAPET, inn)
      }
      // underside of the deck where it is raised
      if (bottom(i) > 0 && bottom(i + 1) > 0) {
        const da = bottom(i),
          db = bottom(i + 1)
        face(T.struct, [[Al[0], da, Al[2]], [Bl[0], db, Bl[2]], [Br[0], db, Br[2]], [Ar[0], da, Ar[2]]], '#7d7970', [0, -1, 0])
      }
      // piers every ~24 m under raised deck
      while (nextPier < acc + seg) {
        const p = (nextPier - acc) / seg
        const h = f.h[i] + (f.h[i + 1] - f.h[i]) * p
        if (h > EMBANK_BELOW + 0.6) {
          const x = ax + (bx - ax) * p,
            z = az + (bz - az) * p
          const yaw = Math.atan2(bx - ax, bz - az)
          const colH = h - DECK_T - 0.7
          T.struct.prim('cyl16', x, colH / 2, z, 1.5, colH, 1.5, PIER, yaw)
          // pier cap / crossbeam
          T.struct.prim('box', x, h - DECK_T - 0.35, z, hw * 1.5, 0.7, 1.7, CONCRETE, yaw)
          colliders.push({ x, y: colH / 2, z, hx: 0.75, hy: colH / 2, hz: 0.75, yaw, pitch: 0 })
        }
        nextPier += 24
      }
      // lamp posts on the parapet (alternate sides)
      while (nextLamp < acc + seg) {
        const p = (nextLamp - acc) / seg
        const h = f.h[i] + (f.h[i + 1] - f.h[i]) * p
        if (h > 1.5) {
          const side = Math.round(nextLamp / 36) % 2 ? 1 : -1
          const nx = (lax + (lbx - lax) * p) * side,
            nz = (laz + (lbz - laz) * p) * side
          const x = ax + (bx - ax) * p + nx * (hw - 0.15),
            z = az + (bz - az) * p + nz * (hw - 0.15)
          const y0 = h + 0.05 + PARAPET_H
          T.struct.prim('cyl8', x, y0 + 3.5, z, 0.16, 7, 0.16, '#5c5e60')
          T.struct.prim('box', x - nx * 0.9, y0 + 7, z - nz * 0.9, 0.25, 0.12, 0.25, '#5c5e60', Math.atan2(nx, nz))
          T.glow.prim('box', x - nx * 1.6, y0 + 6.92, z - nz * 1.6, 0.55, 0.08, 0.3, '#ffd9a0', Math.atan2(nx, nz))
        }
        nextLamp += 36
      }
      // colliders: deck slab + both parapets, following the segment's slope
      {
        const mx = (ax + bx) / 2,
          mz = (az + bz) / 2
        const yaw = Math.atan2(bx - ax, bz - az)
        const pitch = -Math.atan2(yb - ya, seg)
        const len = Math.hypot(seg, yb - ya)
        const ym = (ya + yb) / 2
        colliders.push({ x: mx, y: ym - 0.5, z: mz, hx: hw, hy: 0.5, hz: len / 2 + 0.06, yaw, pitch })
        if (ym > 0.9 && parapetAt(acc, acc + seg)) {
          const nx = (lax + lbx) / 2,
            nz = (laz + lbz) / 2
          for (const s of [1, -1])
            colliders.push({ x: mx + nx * s * (hw - 0.15), y: ym + 0.55, z: mz + nz * s * (hw - 0.15), hx: 0.15, hy: 0.6, hz: len / 2 + 0.06, yaw, pitch })
        }
      }
      acc += seg
    }
  }
  return { tiles: [...tiles.values()], colliders }
}

export function Flyovers({ city }: { city: CityData }) {
  const { world, rapier } = useRapier()
  const m = materials()
  const built = useMemo(() => {
    const r = buildFlyovers(city.flyovers ?? [])
    return { colliders: r.colliders, meshes: r.tiles.map((t) => ({ deck: t.deck.build(), struct: t.struct.build(), glow: t.glow.build() })) }
  }, [city])

  useEffect(() => {
    if (!built.colliders.length) return
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed())
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (const c of built.colliders) {
      q.setFromEuler(e.set(c.pitch, c.yaw, 0, 'YXZ'))
      world.createCollider(rapier.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), body)
    }
    return () => {
      try {
        if (world.getRigidBody(body.handle)) world.removeRigidBody(body)
      } catch {
        /* world disposed */
      }
    }
  }, [world, rapier, built])

  useEffect(
    () => () => {
      for (const g of built.meshes) {
        g.deck.dispose()
        g.struct.dispose()
        g.glow.dispose()
      }
    },
    [built],
  )

  return (
    <group>
      {built.meshes.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.deck} material={m.ground} receiveShadow />
          <mesh geometry={g.struct} material={m.props} castShadow receiveShadow />
          <mesh geometry={g.glow} material={m.glow} />
        </group>
      ))}
    </group>
  )
}
