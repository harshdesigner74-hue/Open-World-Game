import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { detailTexture } from '../utils/textures'
import type { CityData } from './types'

/**
 * Real-elevation backdrop around the playable map (hills, ridges, coastline), built from
 * public/data/<city>-terrain.json (scripts/terrain-import.mjs, AWS Terrain Tiles / SRTM).
 *
 * The playable area itself stays flat (every street, building, vehicle and pedestrian system
 * works at y = 0); the terrain fades in from ~250 m outside the map edge, so the real hills —
 * Gwalior Fort's rock, Jaipur's Nahargarh ridge, Mumbai's Malabar Hill and sea — frame the city.
 * It is visual only (no physics: the map edge is walled).
 */
interface TerrainFile {
  x0: number
  z0: number
  step: number
  nx: number
  nz: number
  base: number
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  h: string
  attribution: string
}

const C = (h: string) => new THREE.Color(h)
const URBAN = C('#8f8a7c')
const PLAIN = C('#7d8656')
const FOREST = C('#56683c')
const ROCK = C('#8c7b63')
const SEA = C('#3e6d78')

export function buildTerrain(t: TerrainFile) {
  const raw = Uint8Array.from(atob(t.h), (c) => c.charCodeAt(0))
  const H = new Int16Array(raw.buffer)
  const { nx, nz, step, x0, z0, bounds: B } = t
  const pos = new Float32Array(nx * nz * 3)
  const col = new Float32Array(nx * nz * 3)
  const uv = new Float32Array(nx * nz * 2)
  const rel = (i: number, j: number) => H[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] / 10
  const c = new THREE.Color()
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = x0 + i * step,
        z = z0 + j * step
      const out = Math.max(B.minX - x, x - B.maxX, B.minZ - z, z - B.maxZ, 0)
      const blend = THREE.MathUtils.smoothstep(out, 250, 1100)
      const r = rel(i, j)
      const abs = r + t.base
      const sea = abs < 0.6
      const y = sea ? -0.6 : Math.max(0, r) * blend - 0.3
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[k * 3 + 2] = z
      uv[k * 2] = x / 24
      uv[k * 2 + 1] = z / 24
      // colour by slope + height above the city
      const sx = (rel(i + 1, j) - rel(i - 1, j)) / (2 * step),
        sz = (rel(i, j + 1) - rel(i, j - 1)) / (2 * step)
      const slope = Math.hypot(sx, sz)
      const n = Math.sin(x * 0.013 + z * 0.007) * 0.5 + Math.sin(x * 0.031 - z * 0.023) * 0.5
      if (sea) c.copy(SEA)
      else {
        c.copy(URBAN).lerp(PLAIN, THREE.MathUtils.clamp((r - 6) / 30 + n * 0.25, 0, 1))
        c.lerp(FOREST, THREE.MathUtils.clamp(slope * 5 - 0.2 + n * 0.15, 0, 0.8))
        c.lerp(ROCK, THREE.MathUtils.clamp(slope * 3 - 0.9, 0, 0.75))
      }
      col[k * 3] = c.r
      col[k * 3 + 1] = c.g
      col[k * 3 + 2] = c.b
    }
  const idx: number[] = []
  for (let j = 0; j + 1 < nz; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i,
        b = a + 1,
        d = a + nx,
        e = d + 1
      // skip cells fully hidden under the flat playable ground
      if (pos[a * 3 + 1] < -0.2 && pos[b * 3 + 1] < -0.2 && pos[d * 3 + 1] < -0.2 && pos[e * 3 + 1] < -0.2) {
        const cx = pos[a * 3] + step / 2,
          cz = pos[a * 3 + 2] + step / 2
        if (cx > B.minX - 1150 && cx < B.maxX + 1150 && cz > B.minZ - 1150 && cz < B.maxZ + 1150) continue
      }
      idx.push(a, d, b, b, d, e)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export function Terrain({ city }: { city: CityData }) {
  const [data, setData] = useState<TerrainFile | null>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}data/${city.id}-terrain.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setData(j))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [city.id])
  // see the hills: push the far plane out while the backdrop exists
  useEffect(() => {
    if (!data) return
    const prev = camera.far
    camera.far = 9000
    camera.updateProjectionMatrix()
    return () => {
      camera.far = prev
      camera.updateProjectionMatrix()
    }
  }, [data, camera])
  const geo = useMemo(() => (data ? buildTerrain(data) : null), [data])
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detailTexture(), envMapIntensity: 0.4 })
    // long-range aerial haze instead of the city's short fog, so distant ridges stay readable
    m.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
           float hz = smoothstep(fogNear * 1.5, fogFar * 8.0, vFogDepth);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hz * 0.92);
         #endif`,
      )
    }
    return m
  }, [])
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo) return null
  return <mesh geometry={geo} material={mat} receiveShadow={false} />
}
