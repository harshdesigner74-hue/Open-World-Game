import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { mulberry32 } from '../utils/math'
import type { CityData } from '../world/types'
import { bump, unlock } from './progress'

export const DIYAS_PER_CITY = 8

/** Deterministic hidden spots: pavement nodes spread across the map. */
export function diyaSpots(city: CityData) {
  const r = mulberry32(city.id.split('').reduce((a, c) => a * 33 + c.charCodeAt(0), 5) >>> 0)
  const g = city.graph
  const out: { x: number; z: number }[] = []
  for (let tries = 0; out.length < DIYAS_PER_CITY && tries < 5000; tries++) {
    const i = Math.floor(r() * g.x.length)
    if (g.adj[i].length < 2) continue
    const b = city.bounds
    if (g.x[i] < b.minX + 30 || g.x[i] > b.maxX - 30 || g.z[i] < b.minZ + 30 || g.z[i] > b.maxZ - 30) continue
    if (out.some((o) => Math.hypot(o.x - g.x[i], o.z - g.z[i]) < 250)) continue
    out.push({ x: g.x[i], z: g.z[i] })
  }
  return out
}

/** Golden Diyas: glowing collectibles, worth ₹100 each, tracked per city. */
export function Collectibles({ city }: { city: CityData }) {
  const spots = useMemo(() => diyaSpots(city), [city])
  const refs = useRef<(THREE.Group | null)[]>([])
  const mats = useMemo(
    () => ({
      bowl: new THREE.MeshStandardMaterial({ color: '#d4a537', metalness: 0.8, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.4 }),
      flame: new THREE.MeshBasicMaterial({ color: '#ffcc55', toneMapped: false }),
    }),
    [],
  )
  useFrame(({ clock }) => {
    const found = useGame.getState().progress.diyas[city.id] ?? []
    const P = runtime.player.pos
    spots.forEach((s, i) => {
      const gr = refs.current[i]
      if (!gr) return
      const got = found.includes(i)
      gr.visible = !got && Math.abs(s.x - P.x) < 150 && Math.abs(s.z - P.z) < 150
      if (!gr.visible) return
      gr.rotation.y = clock.elapsedTime * 1.5
      gr.position.y = 1.25 + Math.sin(clock.elapsedTime * 2 + i) * 0.15
      if (Math.hypot(s.x - P.x, s.z - P.z) < 1.9) {
        const list = [...found, i]
        bump((p) => ({ diyas: { ...p.diyas, [city.id]: list } }))
        const g = useGame.getState()
        useGame.setState({ cash: g.cash + 100 })
        g.toast(`🪔 Golden Diya ${list.length}/${DIYAS_PER_CITY} found in ${city.name} (+₹100)`, 'money')
        audio.cash()
        if (list.length >= DIYAS_PER_CITY) unlock('diya_hunter')
      }
    })
  })
  return (
    <>
      {spots.map((s, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g }} position={[s.x, 0.6, s.z]} scale={1.9}>
          <mesh material={mats.bowl} castShadow>
            <sphereGeometry args={[0.28, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          </mesh>
          <mesh material={mats.flame} position={[0, 0.14, 0]} scale={[0.6, 1.4, 0.6]}>
            <sphereGeometry args={[0.1, 8, 6]} />
          </mesh>
        </group>
      ))}
    </>
  )
}
