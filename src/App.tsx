import { useCallback, useEffect, useRef, useState } from 'react'
import { audio } from './game/audio/audioEngine'
import { GameCanvas } from './game/GameCanvas'
import { resetRuntime, runtime } from './game/state/runtime'
import { readSave, saveGame } from './game/state/save'
import { newProgress } from './game/progress/types'
import { QUALITY, useGame } from './game/state/store'
import { chunksWithin, ensureDetail, setCity } from './game/world/chunkCache'
import { loadCityData } from './game/world/cities/loadCity'
import type { CityData } from './game/world/types'
import { CitySelect } from './ui/CitySelect'
import { GameUI, lockPointer } from './ui/GameUI'
import { TitleScreen } from './ui/TitleScreen'

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

export default function App() {
  const screen = useGame((s) => s.screen)
  const [city, setCityState] = useState<CityData | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState({ msg: '', pct: 0 })
  const loadingRef = useRef(false)

  const start = useCallback(async (cityId: string, fromSave: boolean, travelHours = 0) => {
    if (loadingRef.current) return
    loadingRef.current = true
    audio.start()
    useGame.setState({ screen: 'loading', panel: null, cityId })
    setReady(false)
    setCityState(null)
    try {
      setProgress({ msg: 'Building real streets from OpenStreetMap data…', pct: 5 })
      await frame()
      const c = await loadCityData(cityId)
      setProgress({ msg: `Placing ${c.buildings.length.toLocaleString()} buildings, ${c.props.length.toLocaleString()} props…`, pct: 35 })
      await frame()
      resetRuntime(c)
      const save = fromSave ? readSave() : null
      if (travelHours > 0) {
        // arriving by train: keep money/outfit/health, advance the clock, start at the station counter
        const prevMin = useGame.getState().timeMin
        const total = prevMin + travelHours * 60
        runtime.time.minutes = total % 1440
        runtime.time.day = useGame.getState().day + Math.floor(total / 1440)
        useGame.setState({ timeMin: Math.floor(runtime.time.minutes), day: runtime.time.day, waypoint: null })
        const counter = c.interactables.find((i) => i.type === 'train')
        if (counter) {
          runtime.player.pos.set(counter.x, 0.05, counter.z)
          runtime.player.yaw = counter.rot + Math.PI
          runtime.cam.yaw = counter.rot + Math.PI
        }
      } else if (save && save.cityId === cityId) {
        runtime.player.pos.set(save.x, 0.05, save.z)
        runtime.player.yaw = save.yaw
        runtime.cam.yaw = save.yaw
        runtime.time.minutes = save.timeMin
        runtime.time.day = save.day
        useGame.setState({ cash: save.cash, bank: save.bank, health: save.health, outfit: save.outfit, timeMin: save.timeMin, day: save.day, progress: { ...newProgress(), ...save.progress }, job: null })
      } else {
        runtime.time.minutes = 9 * 60
        runtime.time.day = 1
        useGame.setState({ cash: 500, bank: 25000, health: 100, stamina: 100, waypoint: null, timeMin: 540, day: 1, progress: newProgress(), job: null })
      }
      // pre-build the streets around the spawn so the first frame isn't empty
      setCity(c)
      const q = QUALITY[useGame.getState().settings.quality]
      const keys = chunksWithin(c, runtime.player.pos.x, runtime.player.pos.z, Math.min(q.detailRadius, 260))
      for (let i = 0; i < keys.length; i++) {
        ensureDetail(c, keys[i].key)
        if (i % 3 === 0) {
          setProgress({ msg: `Streaming streets… ${i + 1}/${keys.length}`, pct: 40 + (50 * i) / keys.length })
          await frame()
        }
      }
      setProgress({ msg: 'Waking up the city…', pct: 95 })
      setCityState(c)
      useGame.setState({ screen: 'playing', job: travelHours > 0 ? null : useGame.getState().job })
      if (travelHours > 0) setTimeout(() => saveGame(), 4000)
    } catch (e) {
      useGame.getState().toast(String(e), 'warn')
      useGame.setState({ screen: 'citySelect' })
    } finally {
      loadingRef.current = false
    }
  }, [])

  const travel = useGame((s) => s.travelRequest)
  useEffect(() => {
    if (!travel) return
    useGame.setState({ travelRequest: null })
    void start(travel.cityId, false, travel.hours)
  }, [travel, start])

  useEffect(() => {
    if (screen === 'title' || screen === 'citySelect') {
      setCityState(null)
      setReady(false)
    }
  }, [screen])

  const showLoading = screen === 'loading' || (screen === 'playing' && !ready)

  return (
    <div className="app">
      {screen === 'title' && <TitleScreen onNew={() => useGame.setState({ screen: 'citySelect' })} onContinue={() => start(readSave()?.cityId ?? 'delhi', true)} />}
      {screen === 'citySelect' && <CitySelect onExplore={(id) => start(id, false)} onBack={() => useGame.setState({ screen: 'title' })} />}
      {city && screen === 'playing' && (
        <GameCanvas
          city={city}
          onReady={() => {
            setReady(true)
            lockPointer()
          }}
        />
      )}
      {city && screen === 'playing' && ready && <GameUI />}
      {showLoading && (
        <div className="loading">
          <div className="loading-inner">
            <div className="eyebrow">Loading</div>
            <h1 className="title-small">
              INDIA<span>: OPEN WORLD</span>
            </h1>
            <div className="loading-bar">
              <div style={{ width: `${screen === 'playing' ? 98 : progress.pct}%` }} />
            </div>
            <div className="muted">{screen === 'playing' ? 'Starting physics & lighting…' : progress.msg}</div>
            <div className="loading-tip">Tip: press E near a chai stall — cutting chai restores your stamina.</div>
          </div>
        </div>
      )}
    </div>
  )
}
