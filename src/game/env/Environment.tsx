import { Stars } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { runtime } from '../state/runtime'
import { QUALITY, useGame } from '../state/store'
import { smoothstep } from '../utils/math'
import { updateMaterialsForTime } from '../world/materials'
import { Rain } from './Rain'
import { tickWeather, weather } from './weather'

const C = (s: string) => new THREE.Color(s)
const FOG_DAY = C('#c9d1d6')
const FOG_GOLD = C('#e2b48d')
const FOG_NIGHT = C('#0b1222')
const C_NIGHT_SKY = C('#121c36')
const FOG_GREY = C('#949ba1')
const FLASH = C('#dfe6ff')
const SUN_DAY = C('#fff3df')
const SUN_GOLD = C('#ffab62')
const MOON = C('#8ea4ff')
const HEMI_SKY_DAY = C('#bcd3f2')
const HEMI_SKY_NIGHT = C('#4a5368')

/** Sun position for a given time of day (simplified for Delhi: sun passes to the south). */
export function sunState(minutes: number) {
  const h = minutes / 60
  const a = ((h - 6) / 12.5) * Math.PI // 0 = sunrise, π = sunset
  const elev = Math.sin(a) * 0.86
  const dir = new THREE.Vector3(Math.cos(a), elev, 0.42 * Math.max(0.15, Math.sin(a)) + 0.18).normalize()
  const night = 1 - smoothstep(-0.1, 0.14, elev)
  const golden = (1 - smoothstep(0.06, 0.4, elev)) * (1 - night)
  return { dir, elev, night, golden }
}

export function Environment() {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const quality = useGame((s) => s.settings.quality)
  const Q = QUALITY[quality]
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const stars = useRef<THREE.Points>(null)
  const fog = useMemo(() => new THREE.Fog('#c9d1d6', 60, Q.fogFar), [Q.fogFar])
  const tmp = useMemo(() => ({ c: new THREE.Color(), bg: new THREE.Color(), acc: 0, ui: 0, bell: 4 }), [])

  useEffect(() => {
    scene.fog = fog
    return () => {
      scene.fog = null
    }
  }, [scene, fog])

  useEffect(() => {
    const l = sun.current
    if (!l) return
    l.castShadow = Q.shadows > 0
    if (Q.shadows) {
      l.shadow.mapSize.set(Q.shadows, Q.shadows)
      l.shadow.map?.dispose()
      l.shadow.map = null as unknown as THREE.WebGLRenderTarget
    }
    const cam = l.shadow.camera
    cam.left = -75
    cam.right = 75
    cam.top = 75
    cam.bottom = -75
    cam.near = 1
    cam.far = 400
    cam.updateProjectionMatrix()
    l.shadow.bias = -0.0004
    l.shadow.normalBias = 0.05
    scene.add(l.target)
  }, [Q.shadows, scene])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const g = useGame.getState()
    const paused = g.panel !== null && g.panel !== 'info'
    const T = runtime.time
    if (!paused && g.screen === 'playing') {
      T.minutes += dt * g.settings.timeScale
      T.elapsed += dt
      if (T.minutes >= 1440) {
        T.minutes -= 1440
        T.day++
      }
    }
    const s = sunState(T.minutes)
    T.daylight = 1 - s.night
    if (!paused && g.screen === 'playing' && tickWeather(dt, g.settings.weatherMode)) audio.thunder(0.4 + Math.random() * 2.2)
    const W = weather
    const gloom = Math.max(W.cloud * 0.7, W.fog * 0.5)
    T.sunDir.copy(s.dir)
    const p = runtime.player.pos
    const l = sun.current
    if (l) {
      const lightDir = s.night > 0.5 ? new THREE.Vector3(-s.dir.x, Math.max(0.35, -s.dir.y), -s.dir.z + 0.2).normalize() : s.dir
      const sx = Math.round(p.x),
        sz = Math.round(p.z)
      l.position.set(sx + lightDir.x * 150, Math.max(20, lightDir.y * 150), sz + lightDir.z * 150)
      l.target.position.set(sx, 0, sz)
      l.target.updateMatrixWorld()
      tmp.c.copy(SUN_DAY).lerp(SUN_GOLD, s.golden).lerp(MOON, s.night)
      l.color.copy(tmp.c)
      l.intensity = ((1 - s.night) * (2.5 - s.golden * 0.9) + s.night * 0.55) * (1 - W.cloud * 0.72)
    }
    if (hemi.current) {
      hemi.current.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, s.night)
      // sky reflections (IBL) now supply most of the fill light, so the hemisphere is subtle
      hemi.current.intensity = 0.25 + (1 - s.night) * 0.3 * (1 - gloom * 0.3) + s.night * 1.1 + W.flash * 4
    }
    fog.color.copy(FOG_DAY).lerp(FOG_GOLD, s.golden * 0.8 * (1 - gloom)).lerp(FOG_GREY, gloom).lerp(FOG_NIGHT, s.night)
    if (W.flash > 0) fog.color.lerp(FLASH, W.flash * 0.6)
    fog.near = 60 * (1 - W.fog * 0.9)
    fog.far = Q.fogFar * (1 - s.night * 0.25) * (1 - W.fog * 0.9) * (1 - W.rain * 0.35)
    const inside = !!runtime.interior
    if (stars.current) {
      stars.current.visible = !inside && s.night > 0.4 && W.cloud < 0.5
      stars.current.position.copy(camera.position)
    }
    const overcast = W.cloud > 0.55 || W.fog > 0.6
    if (s.night >= 0.7 || overcast) {
      tmp.bg.copy(fog.color)
      if (s.night >= 0.7 && !overcast) tmp.bg.copy(FOG_NIGHT).lerp(C_NIGHT_SKY, 0.6)
      scene.background = tmp.bg
    } else scene.background = null
    if (inside) scene.background = tmp.bg.set('#1a1714')
    gl.toneMappingExposure = 0.92 + s.night * 0.75
    updateMaterialsForTime(s.night, W.wet)

    // ambience driver (10 Hz)
    tmp.acc += dt
    if (tmp.acc > 0.1) {
      let traffic = 0
      for (const v of runtime.vehicles) {
        const d = Math.hypot(v.x - p.x, v.z - p.z)
        if (d < 90) traffic += (v.speed > 0.5 ? 1 : 0.4) / (1 + d / 18)
      }
      let crowd = 0
      for (const n of runtime.npcs) if (Math.abs(n.x - p.x) < 30 && Math.abs(n.z - p.z) < 30) crowd++
      audio.update({ trafficNear: traffic, crowdNear: crowd, daylight: T.daylight * (1 - W.rain * 0.8), dt: tmp.acc })
      audio.rain(W.rain)
      // temple bells near Hindu temples & roadside shrines
      tmp.bell -= tmp.acc + 0.1
      if (tmp.bell <= 0 && runtime.city) {
        tmp.bell = 5 + Math.random() * 9
        for (const pb of runtime.city.polys)
          if (pb.kind === 'temple' && Math.abs(pb.cx - p.x) < 60 && Math.abs(pb.cz - p.z) < 60) {
            audio.bell(pb.cx, pb.cz)
            break
          }
      }
      tmp.acc = 0
    }
    tmp.ui -= dt
    if (tmp.ui <= 0) {
      tmp.ui = 0.5
      const m = Math.floor(T.minutes)
      if (m !== g.timeMin || T.day !== g.day) useGame.setState({ timeMin: m, day: T.day })
    }
  })

  return (
    <>
      <Rain />
      <Stars ref={stars as never} radius={1800} depth={200} count={2500} factor={30} saturation={0} fade speed={0.3} />
      <hemisphereLight ref={hemi} args={['#bcd3f2', '#7b6a55', 0.8]} />
      <directionalLight ref={sun} intensity={2.4} />
    </>
  )
}
