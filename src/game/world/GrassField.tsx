import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { hash2 } from '../utils/math'
import { pointInPoly } from './osmCity'
import type { CityData } from './types'

/**
 * Instanced grass blades on real lawns/parks (OSM grass & forest areas), never on roads or
 * footpaths. Only a ring around the player is populated (rebuilt as you move), blades sway
 * in the wind on the GPU and shrink away at the edge of the ring so there is no popping.
 */
const CELL = 2 // mask resolution (m)
const RADIUS = 32
const PER_CELL = 6
const MAX = Math.ceil(Math.PI * RADIUS * RADIUS / (CELL * CELL)) * PER_CELL

function buildMask(city: CityData) {
  const B = city.bounds
  const nx = Math.ceil((B.maxX - B.minX) / CELL),
    nz = Math.ceil((B.maxZ - B.minZ) / CELL)
  const m = new Uint8Array(nx * nz)
  for (const a of city.areas) {
    if ((a.kind !== 'grass' && a.kind !== 'forest' && a.kind !== 'campus') || a.shape.type !== 'poly') continue
    const s = a.shape
    const i0 = Math.max(0, Math.floor((s.minX - B.minX) / CELL)),
      i1 = Math.min(nx - 1, Math.floor((s.maxX - B.minX) / CELL))
    const j0 = Math.max(0, Math.floor((s.minZ - B.minZ) / CELL)),
      j1 = Math.min(nz - 1, Math.floor((s.maxZ - B.minZ) / CELL))
    const v = a.kind === 'campus' ? 1 : 2 // campus lawns are sparser
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = B.minX + (i + 0.5) * CELL,
          z = B.minZ + (j + 0.5) * CELL
        if (pointInPoly(x, z, s.pts)) m[j * nx + i] = Math.max(m[j * nx + i], v)
      }
  }
  // clear roads, footpaths and building footprints
  const clearSeg = (ax: number, az: number, bx: number, bz: number, hw: number) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - B.minX) / CELL)),
      i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + hw - B.minX) / CELL))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - hw - B.minZ) / CELL)),
      j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz) + hw - B.minZ) / CELL))
    const vx = bx - ax,
      vz = bz - az,
      l2 = vx * vx + vz * vz || 1
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i
        if (!m[k]) continue
        const x = B.minX + (i + 0.5) * CELL,
          z = B.minZ + (j + 0.5) * CELL
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2))
        if (Math.hypot(x - ax - vx * t, z - az - vz * t) < hw) m[k] = 0
      }
  }
  for (const r of city.roads) if (r.kind === 'straight') clearSeg(r.ax, r.az, r.bx, r.bz, r.width / 2 + 1.2)
  for (const s of city.sidewalkSegs) clearSeg(s.ax, s.az, s.bx, s.bz, s.w / 2 + 0.6)
  for (const f of city.flyovers ?? []) for (let i = 0; i + 3 < f.pts.length; i += 2) clearSeg(f.pts[i], f.pts[i + 1], f.pts[i + 2], f.pts[i + 3], f.w / 2 + 1.5)
  for (const p of city.polys) {
    const pts = p.pts
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length
      clearSeg(pts[i], pts[i + 1], pts[j], pts[j + 1], 1.2)
    }
  }
  return { m, nx, nz }
}

function bladeGeometry() {
  const pos: number[] = [],
    col: number[] = [],
    uv: number[] = [],
    idx: number[] = []
  const base = new THREE.Color('#2f4a1c'),
    tip = new THREE.Color('#9dbb55')
  const c = new THREE.Color()
  for (let b = 0; b < 9; b++) {
    const a = (b / 9) * Math.PI * 2 + b * 0.7
    const r = 0.04 + (b % 3) * 0.06
    const ox = Math.cos(a) * r,
      oz = Math.sin(a) * r
    const h = 0.2 + ((b * 37) % 7) * 0.03
    const w = 0.018
    const lean = 0.08 + (b % 2) * 0.06
    const dx = Math.cos(a + 1.3),
      dz = Math.sin(a + 1.3)
    const v0 = pos.length / 3
    const SEG = 3
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG
      const ww = w * (1 - t * 0.92)
      const bend = lean * t * t
      for (const side of [-1, 1]) {
        pos.push(ox + dx * ww * side + Math.cos(a) * bend, h * t, oz + dz * ww * side + Math.sin(a) * bend)
        c.copy(base).lerp(tip, t)
        col.push(c.r, c.g, c.b)
        uv.push(side > 0 ? 1 : 0, t)
      }
    }
    for (let s = 0; s < SEG; s++) {
      const k = v0 + s * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  // blades are lit like the ground below them (soft, upward normals)
  const n = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3)
  return g
}

export function GrassField({ city }: { city: CityData }) {
  const mask = useMemo(() => buildMask(city), [city])
  const geo = useMemo(() => bladeGeometry(), [])
  const uTime = useMemo(() => ({ value: 0 }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92 })
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = uTime
      s.vertexShader = s.vertexShader
        .replace('void main() {', 'uniform float uTime;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
           float sway = sin(uTime * 1.7 + ip.x * 0.21 + ip.y * 0.17) * 0.6 + sin(uTime * 3.1 + ip.x * 0.7) * 0.25;
           float k = uv.y * uv.y;
           transformed.x += sway * 0.09 * k;
           transformed.z += sway * 0.05 * k;`,
        )
    }
    m.customProgramCacheKey = () => 'grass-v1'
    return m
  }, [uTime])
  const ref = useRef<THREE.InstancedMesh>(null)
  const last = useRef({ x: 1e9, z: 1e9 })
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color(), e: new THREE.Euler() }), [])

  const rebuild = (px: number, pz: number) => {
    const mesh = ref.current
    if (!mesh) return
    const B = city.bounds
    let n = 0
    const ci0 = Math.floor((px - RADIUS - B.minX) / CELL),
      ci1 = Math.floor((px + RADIUS - B.minX) / CELL)
    const cj0 = Math.floor((pz - RADIUS - B.minZ) / CELL),
      cj1 = Math.floor((pz + RADIUS - B.minZ) / CELL)
    for (let j = Math.max(0, cj0); j <= Math.min(mask.nz - 1, cj1); j++)
      for (let i = Math.max(0, ci0); i <= Math.min(mask.nx - 1, ci1); i++) {
        const v = mask.m[j * mask.nx + i]
        if (!v) continue
        for (let k = 0; k < PER_CELL; k++) {
          if (v === 1 && k > 0) break
          const h1 = hash2(i * 3 + k, j * 7 - k),
            h2 = hash2(j * 5 + k * 11, i * 13 + k)
          const x = B.minX + (i + h1) * CELL,
            z = B.minZ + (j + h2) * CELL
          const d = Math.hypot(x - px, z - pz)
          if (d > RADIUS || n >= MAX) continue
          const fade = 1 - THREE.MathUtils.smoothstep(d, RADIUS * 0.72, RADIUS)
          const sc = (0.75 + h1 * 0.6) * Math.max(0.05, fade)
          tmp.q.setFromEuler(tmp.e.set(0, h2 * Math.PI * 2, 0))
          tmp.m.compose(tmp.p.set(x, 0.02, z), tmp.q, tmp.s.set(sc * 1.4, sc * (0.8 + h2 * 0.6), sc * 1.4))
          mesh.setMatrixAt(n, tmp.m)
          tmp.c.setHSL(0.2 + (h1 - 0.5) * 0.08, 0.3, 0.78 + h2 * 0.18)
          mesh.setColorAt(n, tmp.c)
          n++
        }
      }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  useEffect(() => {
    last.current = { x: 1e9, z: 1e9 }
  }, [city])

  useFrame((_, dt) => {
    uTime.value += dt
    const P = runtime.player.pos
    if (ref.current) ref.current.visible = !runtime.interior
    if (Math.hypot(P.x - last.current.x, P.z - last.current.z) > 5) {
      last.current = { x: P.x, z: P.z }
      rebuild(P.x, P.z)
    }
  })

  return <instancedMesh ref={ref} args={[geo, mat, MAX]} frustumCulled={false} receiveShadow />
}
