import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Environment } from './env/Environment'
import { attachKeyboardMouse } from './input/input'
import { InteractionSystem } from './interaction/InteractionSystem'
import { NPCSystem } from './npc/NPCSystem'
import { Player } from './player/Player'
import { runtime } from './state/runtime'
import { QUALITY, useGame } from './state/store'
import { TrafficSystem } from './traffic/TrafficSystem'
import { ParkedVehicles } from './vehicles/ParkedVehicles'
import { PlayerVehicle } from './vehicles/PlayerVehicle'
import { MissionSystem } from './missions/MissionSystem'
import { StorySystem } from './story/StorySystem'
import { SocialSystem } from './social/SocialSystem'
import { Collectibles } from './progress/Collectibles'
import { InteriorSystem } from './interiors/InteriorSystem'
import { World } from './world/World'
import { Flyovers } from './world/Flyovers'
import { Terrain } from './world/Terrain'
import { GrassField } from './world/GrassField'
import { PostFX } from './env/PostFX'
import { Clouds, SkyReflections } from './env/SkyEnv'
import type { CityData } from './world/types'

/** The 3D game. Engine systems live here; all 2D UI lives outside the canvas (src/ui). */
export function GameCanvas({ city, onReady }: { city: CityData; onReady: () => void }) {
  const quality = useGame((s) => s.settings.quality)
  const paused = useGame((s) => s.panel !== null && s.panel !== 'info')
  const Q = QUALITY[quality]
  return (
    <div className="game-canvas">
      <Canvas
        shadows={Q.shadows > 0 ? 'percentage' : false}
        dpr={[1, Math.min(quality === 'medium' ? 1 : Q.dpr, window.devicePixelRatio || 1)]}
        // post-processing does its own SMAA; canvas MSAA only for the low preset
        gl={{ antialias: quality === 'low', powerPreference: 'high-performance', stencil: false, alpha: false }}
        camera={{ fov: 62, near: 0.1, far: 5200, position: [city.spawn.x, 3, city.spawn.z + 5] }}
        onCreated={({ gl, scene }) => {
          if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__iowScene = scene
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.domElement.setAttribute('data-engine', 'iow')
        }}
      >
        <InputBinder />
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} paused={paused}>
            <Environment />
            <SkyReflections />
            <Clouds />
            <World city={city} />
            <Flyovers city={city} />
            <Terrain city={city} />
            {quality !== 'low' && <GrassField city={city} />}
            <ParkedVehicles city={city} />
            <PlayerVehicle />
            <Player />
            <NPCSystem city={city} />
            <TrafficSystem city={city} />
            <InteractionSystem city={city} />
            <WaypointBeacon />
            <MissionSystem city={city} />
            <StorySystem city={city} />
            <SocialSystem city={city} />
            <Collectibles city={city} />
            <InteriorSystem city={city} />
            <ReadySignal onReady={onReady} />
          </Physics>
        </Suspense>
        <PerfProbe />
        <PostFX />
      </Canvas>
    </div>
  )
}

function InputBinder() {
  const gl = useThree((s) => s.gl)
  useEffect(() => attachKeyboardMouse(gl.domElement), [gl])
  return null
}

function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    frames.current++
    if (frames.current === 8) onReady()
  })
  return null
}

function PerfProbe() {
  const gl = useThree((s) => s.gl)
  const st = useRef({ frames: 0, t: 0 })
  useFrame((_, dt) => {
    st.current.frames++
    st.current.t += dt
    if (st.current.t >= 0.5) {
      runtime.stats.fps = Math.round(st.current.frames / st.current.t)
      st.current.frames = 0
      st.current.t = 0
    }
    runtime.stats.drawCalls = gl.info.render.calls
    runtime.stats.triangles = gl.info.render.triangles
  })
  return null
}

/** Tall light beam marking the map waypoint. */
function WaypointBeacon() {
  const wp = useGame((s) => s.waypoint)
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff4d8d', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  )
  useFrame(({ clock }) => {
    if (ref.current) mat.opacity = 0.25 + Math.sin(clock.elapsedTime * 3) * 0.1
  })
  if (!wp) return null
  return (
    <mesh ref={ref} position={[wp.x, 40, wp.z]} material={mat}>
      <cylinderGeometry args={[1.2, 1.2, 80, 16, 1, true]} />
    </mesh>
  )
}
