import { useEffect, useRef, useState } from 'react'
import { audio } from '../game/audio/audioEngine'
import { input, isTouchDevice } from '../game/input/input'
import { TouchControls } from './TouchControls'
import { DialoguePanel, StoryHUD } from './Story'
import { CinemaOverlay, DatePanel, PhonePanel, SocialPanel } from './Social'
import { runtime } from '../game/state/runtime'
import { useGame, type Panel } from '../game/state/store'
import { RoadIndex } from '../game/world/roads'
import { WEATHER_ICON, WEATHER_LABEL, weather } from '../game/env/weather'
import { MapScreen } from './MapScreen'
import { AtmPanel, CharacterMenu, InfoPanel, MetroPanel, PauseMenu, SettingsPanel, TrainPanel } from './Menus'
import { Minimap } from './Minimap'
import { DealerPanel, JobsPanel, ObjectiveHUD, VehiclesPanel, WardrobePanel } from './Career'
import { saveGame } from '../game/state/save'

function canvasEl() {
  return document.querySelector('canvas[data-engine]') as HTMLCanvasElement | null
    ?? (document.querySelector('.game-canvas canvas') as HTMLCanvasElement | null)
}

export function lockPointer() {
  const c = canvasEl()
  try {
    const p = c?.requestPointerLock() as unknown as Promise<void> | undefined
    p?.catch?.(() => {})
  } catch {
    /* ignore — user can click */
  }
}

export function GameUI() {
  const panel = useGame((s) => s.panel)
  const panelData = useGame((s) => s.panelData)
  const pointerLocked = useGame((s) => s.pointerLocked)
  const showPerf = useGame((s) => s.settings.showPerf)
  const lastPauseAt = useRef(0)
  const [touch] = useState(isTouchDevice)

  // pointer lock & menu keys
  useEffect(() => {
    const onLock = () => {
      const locked = !!document.pointerLockElement
      useGame.setState({ pointerLocked: locked })
      const g = useGame.getState()
      if (!locked && g.panel === null && g.screen === 'playing') {
        lastPauseAt.current = performance.now()
        g.openPanel('pause')
      }
    }
    const setPanel = (p: Panel) => {
      const g = useGame.getState()
      if (p) {
        g.openPanel(p)
        document.exitPointerLock?.()
      } else {
        g.closePanel()
        lockPointer()
      }
      audio.blip(p ? 520 : 400, 0.03, 0.06)
    }
    const onKey = (e: KeyboardEvent) => {
      const g = useGame.getState()
      if (g.screen !== 'playing') return
      if (e.code === 'Escape') {
        if (performance.now() - lastPauseAt.current < 400) return
        if (g.panel === null) setPanel('pause')
        else if (g.panel === 'pause') setPanel(null)
        else if (g.panel === 'settings' || g.panel === 'character' || g.panel === 'map') g.openPanel('pause')
        else setPanel(null)
      } else if (e.code === 'KeyM') {
        e.preventDefault()
        setPanel(g.panel === 'map' ? null : g.panel === null ? 'map' : g.panel)
      } else if (e.code === 'KeyP') {
        setPanel(g.panel === 'phone' ? null : g.panel === null ? 'phone' : g.panel)
      } else if (e.code === 'KeyJ') {
        setPanel(g.panel === 'jobs' ? null : g.panel === null ? 'jobs' : g.panel)
      } else if (e.code === 'Tab') {
        e.preventDefault()
        setPanel(g.panel === 'character' ? null : g.panel === null ? 'character' : g.panel)
      }
    }
    document.addEventListener('pointerlockchange', onLock)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerlockchange', onLock)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // autosave every 3 minutes of play
  useEffect(() => {
    const id = setInterval(() => {
      const g = useGame.getState()
      if (g.screen === 'playing' && g.panel === null && !runtime.drive.active && saveGame()) g.toast('💾 Autosaved', 'info')
    }, 180000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    input.enabled = panel === null
    if (panel !== null) {
      input.reset()
      // any panel (incl. ones opened from the world: ATM, metro, plaques) needs a free mouse
      if (document.pointerLockElement) document.exitPointerLock?.()
    }
  }, [panel])

  const close = () => {
    useGame.getState().closePanel()
    lockPointer()
  }
  const backToPause = () => useGame.getState().openPanel('pause')

  return (
    <div className="ui-root">
      <div className="vignette" />
      {panel === null && <HUD />}
      {panel === null && touch && <TouchControls />}
      {panel === null && !pointerLocked && !touch && (
        <button className="lock-hint" onClick={lockPointer}>
          Click to control the camera
        </button>
      )}
      <Toasts />
      {panel === 'pause' && <PauseMenu onResume={close} />}
      {panel === 'map' && <MapScreen onClose={close} />}
      {panel === 'character' && <CharacterMenu onClose={close} />}
      {panel === 'settings' && <SettingsPanel onClose={backToPause} />}
      {panel === 'atm' && <AtmPanel onClose={close} />}
      {panel === 'metro' && <MetroPanel from={(panelData?.from as string) ?? ''} onClose={close} />}
      {panel === 'info' && <InfoPanel data={panelData ?? {}} onClose={close} />}
      {panel === 'train' && <TrainPanel onClose={close} />}
      {panel === 'jobs' && <JobsPanel onClose={close} />}
      {panel === 'wardrobe' && <WardrobePanel onClose={close} />}
      {panel === 'dealer' && <DealerPanel onClose={close} />}
      {panel === 'vehicles' && <VehiclesPanel onClose={close} />}
      {panel === null && <ObjectiveHUD />}
      {panel === null && <StoryHUD />}
      {panel === 'dialogue' && <DialoguePanel onClose={close} />}
      {panel === 'social' && <SocialPanel person={String(panelData?.person ?? 'rohan')} onClose={close} />}
      {panel === 'date' && <DatePanel person={String(panelData?.person ?? '')} onClose={close} />}
      {panel === 'phone' && <PhonePanel onClose={close} />}
      <CinemaOverlay />
      {showPerf && <PerfOverlay />}
    </div>
  )
}

function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24
  const m = Math.floor(min % 60)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, '0')} ${ap}`
}

function HUD() {
  const { health, stamina, cash, timeMin, day, prompt, promptKey, waypoint, sitting, vehicleHud } = useGame()
  const [loc, setLoc] = useState({ area: '', road: '', wpDist: 0, weather: weather.type })
  useEffect(() => {
    const city = runtime.city!
    const idx = new RoadIndex(city.roads)
    const id = setInterval(() => {
      const p = runtime.player.pos
      const inside = runtime.interior as { name: string } | null
      let area = inside ? inside.name : city.areaName(p.x, p.z)
      let best = 70
      for (const l of inside ? [] : city.landmarks) {
        const d = Math.hypot(l.x - p.x, l.z - p.z)
        if (d < best) {
          best = d
          area = l.name
        }
      }
      const r = idx.at(p.x, p.z, 7)
      const wp = useGame.getState().waypoint
      const wpDist = wp ? Math.hypot(wp.x - p.x, wp.z - p.z) : 0
      const sw = runtime.storyWp
      const managed = !!useGame.getState().job || (sw && wp && Math.hypot(sw.x - wp.x, sw.z - wp.z) < 1)
      if (wp && wpDist < 8 && !managed) {
        useGame.setState({ waypoint: null })
        useGame.getState().toast('📍 You have reached your destination', 'info')
      }
      setLoc({ area, road: r?.name ?? '', wpDist, weather: weather.type })
    }, 400)
    return () => clearInterval(id)
  }, [])
  const night = timeMin < 6 * 60 || timeMin > 18 * 60 + 40
  return (
    <>
      <div className="hud-tr">
        <div className="hud-time">
          <span className="hud-icon" title={WEATHER_LABEL[loc.weather]}>{loc.weather === 'clear' ? (night ? '🌙' : '☀️') : WEATHER_ICON[loc.weather]}</span>
          {fmtTime(timeMin)}
          <span className="hud-day">Day {day}</span>
        </div>
        <div className="hud-cash">₹{cash.toLocaleString('en-IN')}</div>
        <div className="hud-bars">
          <div className="hbar">
            <div className="hbar-fill health" style={{ width: `${health}%` }} />
          </div>
          <div className="hbar">
            <div className="hbar-fill stamina" style={{ width: `${stamina}%`, opacity: stamina < 99 ? 1 : 0.55 }} />
          </div>
        </div>
      </div>
      <div className="hud-bl">
        <Minimap />
        <div className="hud-loc">
          <div className="hud-city">{runtime.city?.name.toUpperCase()}</div>
          <div className="hud-area">{loc.area}</div>
          {loc.road && <div className="hud-road">{loc.road}</div>}
          {waypoint && <div className="hud-wp">📍 {Math.round(loc.wpDist)} m to waypoint</div>}
        </div>
      </div>
      {vehicleHud && (
        <div className="speedo">
          <div className="speedo-num">{vehicleHud.speed}</div>
          <div className="speedo-unit">km/h · {vehicleHud.name}</div>
          <div className="speedo-bars">
            <span>🔧</span>
            <div className="hbar"><div className="hbar-fill health" style={{ width: `${vehicleHud.health}%`, background: vehicleHud.health < 30 ? '#e74c3c' : undefined }} /></div>
            <span>⛽</span>
            <div className="hbar"><div className="hbar-fill fuel" style={{ width: `${vehicleHud.fuel}%` }} /></div>
          </div>
        </div>
      )}
      {prompt && (
        <div className="prompt">
          <kbd>{promptKey}</kbd> {prompt.toUpperCase()}
          {sitting && <span className="muted"> · or move</span>}
        </div>
      )}
    </>
  )
}

function Toasts() {
  const toasts = useGame((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

function PerfOverlay() {
  const [s, setS] = useState({ ...runtime.stats })
  useEffect(() => {
    const id = setInterval(() => setS({ ...runtime.stats }), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="perf">
      <div>{s.fps} FPS</div>
      <div>draw calls {s.drawCalls}</div>
      <div>triangles {(s.triangles / 1000).toFixed(0)}k</div>
      <div>chunks {s.chunks} detail · {s.lodChunks} LOD · {s.physChunks} physics</div>
      <div>NPCs {s.npcs} · vehicles {s.vehicles}</div>
    </div>
  )
}
