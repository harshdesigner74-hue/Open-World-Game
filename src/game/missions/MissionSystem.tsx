import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { bump, unlock } from '../progress/progress'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { GeoBuilder } from '../utils/geoBuilder'
import { buildVendor } from '../world/models'
import { materials } from '../world/materials'
import { DRIVE } from '../vehicles/specs'
import { challengeDone } from '../social/social'
import type { CityData } from '../world/types'

/** Runs the active job, landmark discovery and wealth/city achievements. */
export function MissionSystem({ city }: { city: CityData }) {
  const passenger = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => {
    const b = new GeoBuilder()
    buildVendor(b, 0, 0, 0, 0.42)
    return b.build()
  }, [])
  const st = useRef({ acc: 0 })

  useEffect(() => {
    // record city visit
    bump((p) => (p.cities.includes(city.id) ? {} : { cities: [...p.cities, city.id] }))
  }, [city])

  useFrame((_, dt) => {
    st.current.acc += dt
    const g = useGame.getState()
    const job = g.job
    // passenger figure waiting at a fare pickup
    if (passenger.current) {
      const show = job?.kind === 'fare' && job.stage === 0
      passenger.current.visible = !!show
      if (show) passenger.current.position.set(job!.targets[0].x, 0.09, job!.targets[0].z)
    }
    if (st.current.acc < 0.15) return
    st.current.acc = 0
    if (g.panel !== null) return
    const P = runtime.player.pos
    const D = runtime.drive
    // landmark discovery
    for (const l of city.landmarks) {
      if (Math.abs(l.x - P.x) > 45 || Math.abs(l.z - P.z) > 45) continue
      const key = city.id + ':' + l.name
      if (Math.hypot(l.x - P.x, l.z - P.z) < 40 && !g.progress.landmarks.includes(key)) {
        bump((p) => ({ landmarks: [...p.landmarks, key] }))
        g.toast(`📍 Discovered: ${l.name}`, 'info')
      }
    }
    if (g.cash + g.bank >= 100000) unlock('lakhpati')
    if (!job) return
    const t = job.targets[job.stage]
    // keep the waypoint on the current objective
    if (!g.waypoint || Math.hypot(g.waypoint.x - t.x, g.waypoint.z - t.z) > 1) useGame.setState({ waypoint: { x: t.x, z: t.z } })
    if (job.deadline && runtime.time.elapsed > job.deadline) {
      useGame.setState({ job: null, waypoint: null })
      g.toast(`⌛ Job failed: ${job.title}`, 'warn')
      return
    }
    const d = Math.hypot(t.x - P.x, t.z - P.z)
    const carOk = D.active && !DRIVE[D.kind]?.twoWheeler
    let arrived = d < (D.active ? 9 : 4.5)
    if (job.kind === 'fare' || (job.kind === 'challenge' && job.needsVehicle)) {
      if (!carOk) return
      arrived = arrived && Math.abs(D.speed) < 2.5
    }
    if (!arrived) return
    audio.blip(880, 0.05, 0.12)
    if (job.stage + 1 < job.targets.length) {
      const next = job.stage + 1
      useGame.setState({ job: { ...job, stage: next }, waypoint: { x: job.targets[next].x, z: job.targets[next].z } })
      g.toast(job.kind === 'fare' && job.stage === 0 ? '🧍 Passenger on board — “Bhaiya, jaldi chalna!”' : job.kind === 'delivery' && job.stage === 0 ? '📦 Parcel collected' : `✔ ${t.label}`, 'info')
    } else {
      const late = job.deadline ? job.deadline - runtime.time.elapsed : 0
      const tip = job.kind === 'fare' && late > 45 ? Math.round(job.reward * 0.2) : 0
      useGame.setState({ job: null, waypoint: null, cash: g.cash + job.reward + tip })
      bump((p) => ({ jobsDone: p.jobsDone + 1, earned: p.earned + job.reward + tip }))
      g.toast(`💰 ${job.kind === 'challenge' ? 'Challenge won' : 'Job done'}: +₹${job.reward}${tip ? ` (+₹${tip} tip)` : ''}`, 'money')
      if (job.friend) challengeDone(job.friend)
      audio.cash()
    }
  })

  return <mesh ref={passenger} geometry={geo} material={materials().props} visible={false} castShadow />
}
