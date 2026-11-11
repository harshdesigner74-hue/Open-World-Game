import { useState } from 'react'
import { audio } from '../game/audio/audioEngine'
import { runtime } from '../game/state/runtime'
import { saveGame } from '../game/state/save'
import { DEFAULT_OUTFIT, useGame, type Quality } from '../game/state/store'
import { WEATHER_LABEL } from '../game/env/weather'
import { CITIES } from '../game/world/cities/registry'
import { ProgressSection } from './Career'
import { interiorApi } from '../game/interiors/InteriorSystem'

export function PauseMenu({ onResume }: { onResume: () => void }) {
  const open = useGame((s) => s.openPanel)
  const toast = useGame((s) => s.toast)
  const city = runtime.city
  return (
    <div className="panel-full pause">
      <div className="pause-left">
        <div className="eyebrow">Paused</div>
        <h1 className="pause-title">
          INDIA<span>: OPEN WORLD</span>
        </h1>
        <div className="pause-city">{city?.name} · Day {useGame.getState().day}</div>
        <nav className="menu-list">
          <button onClick={onResume}>Resume</button>
          <button onClick={() => open('map')}>World Map</button>
          <button onClick={() => open('character')}>Character</button>
          <button onClick={() => open('jobs')}>Jobs</button>
          <button onClick={() => open('vehicles')}>My Vehicles</button>
          <button onClick={() => open('train')}>Travel to another city</button>
          <button onClick={() => open('settings')}>Settings</button>
          <button
            onClick={() => {
              const ok = saveGame()
              toast(ok ? 'Game saved' : 'Could not save (storage unavailable)', ok ? 'info' : 'warn')
            }}
          >
            Save Game
          </button>
          <button
            onClick={() => {
              document.exitPointerLock?.()
              useGame.setState({ screen: 'title', panel: null })
            }}
          >
            Exit to Title
          </button>
        </nav>
      </div>
      <div className="pause-right">
        <Controls />
      </div>
    </div>
  )
}

export function Controls() {
  const rows: [string, string][] = [
    ['W A S D', 'Move'],
    ['Mouse', 'Look around'],
    ['Shift', 'Sprint (uses stamina)'],
    ['Ctrl / Alt', 'Walk slowly'],
    ['Space', 'Jump'],
    ['E', 'Interact / talk / sit'],
    ['C', 'Change camera'],
    ['Scroll', 'Camera distance'],
    ['M', 'World map'],
    ['Tab', 'Character'],
    ['J', 'Jobs board'],
    ['Esc', 'Pause'],
    ['F', 'Enter / exit vehicle'],
    ['W S / A D', 'Drive: throttle, brake-reverse / steer'],
    ['Space · H', 'Handbrake · Horn'],
  ]
  return (
    <div className="controls">
      <div className="eyebrow">Controls</div>
      {rows.map(([k, v]) => (
        <div key={k} className="ctl-row">
          <kbd>{k}</kbd>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}

const HOODIES = ['#5c2a22', '#1f2a36', '#2f4f3a', '#6b6b6b', '#c9a227', '#8b1e3f', '#e8e4da', '#24324a']
const PANTS = ['#2b2b2d', '#3a4a64', '#5a5048', '#6b6152', '#1d1d1d', '#7b7f83']

export function CharacterMenu({ onClose }: { onClose: () => void }) {
  const { outfit, cash, bank, health, stamina, set } = useGame()
  return (
    <div className="panel-full char">
      <div className="char-card">
        <div className="eyebrow">Character</div>
        <h2>Custom Player</h2>
        <div className="muted">Age 20–26 · ~175 cm · Average build · Casual modern</div>
        <div className="stats">
          <Stat label="Health" value={health} color="#4cd17a" />
          <Stat label="Stamina" value={stamina} color="#5ab0ff" />
        </div>
        <div className="money-row">
          <div>
            <div className="eyebrow">Cash</div>
            <div className="big">₹{cash.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div className="eyebrow">Bank</div>
            <div className="big">₹{bank.toLocaleString('en-IN')}</div>
          </div>
        </div>
        <div className="eyebrow" style={{ marginTop: 18 }}>
          Outfit
        </div>
        <div className="swatch-row">
          <span>Hoodie</span>
          {HOODIES.map((c) => (
            <button key={c} className={'swatch' + (outfit.hoodie === c ? ' on' : '')} style={{ background: c }} onClick={() => set({ outfit: { ...outfit, hoodie: c } })} />
          ))}
        </div>
        <div className="swatch-row">
          <span>Trousers</span>
          {PANTS.map((c) => (
            <button key={c} className={'swatch' + (outfit.pants === c ? ' on' : '')} style={{ background: c }} onClick={() => set({ outfit: { ...outfit, pants: c } })} />
          ))}
        </div>
        <button className="btn ghost" onClick={() => set({ outfit: DEFAULT_OUTFIT })}>
          Reset to reference outfit
        </button>
        <ProgressSection />
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            Close [Tab]
          </button>
        </div>
      </div>
      <div className="char-ref">
        <div className="eyebrow">Reference sheet</div>
        <img src={`${import.meta.env.BASE_URL}assets/character/reference-sheet.png`} alt="Character reference sheet" />
        <p className="muted">
          The in-game hero is a procedural 3D model built from this sheet; the face is your photo projected onto a sculpted 3D head. A fully
          rigged, scanned model can replace it — see README.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="bar">
        <div style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useGame((st) => st.settings)
  const setS = useGame((st) => st.setSettings)
  return (
    <div className="panel-full settings">
      <div className="settings-card">
        <div className="eyebrow">Settings</div>
        <h2>Game settings</h2>
        <label className="field">
          <span>Graphics quality</span>
          <div className="seg">
            {(['low', 'medium', 'high'] as Quality[]).map((q) => (
              <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => setS({ quality: q })}>
                {q}
              </button>
            ))}
          </div>
        </label>
        <div className="muted small">Quality controls shadows, draw distance, pedestrian & traffic density and resolution.</div>
        <label className="field">
          <span>Mouse sensitivity · {s.mouseSensitivity.toFixed(1)}</span>
          <input type="range" min={0.3} max={2.5} step={0.1} value={s.mouseSensitivity} onChange={(e) => setS({ mouseSensitivity: +e.target.value })} />
        </label>
        <label className="field check">
          <input type="checkbox" checked={s.invertY} onChange={(e) => setS({ invertY: e.target.checked })} />
          <span>Invert mouse Y</span>
        </label>
        <label className="field">
          <span>Volume · {Math.round(s.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.volume}
            onChange={(e) => {
              setS({ volume: +e.target.value })
              audio.setVolume(+e.target.value)
            }}
          />
        </label>
        <label className="field">
          <span>Time speed · {s.timeScale}× (game minutes per real second)</span>
          <input type="range" min={0} max={20} step={1} value={s.timeScale} onChange={(e) => setS({ timeScale: +e.target.value })} />
        </label>
        <div className="field">
          <span>Time of day</span>
          <div className="seg">
            {[
              ['Morning', 8 * 60],
              ['Noon', 12 * 60 + 30],
              ['Sunset', 17 * 60 + 50],
              ['Night', 21 * 60],
            ].map(([l, m]) => (
              <button key={l} onClick={() => (runtime.time.minutes = m as number)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Weather</span>
          <div className="seg">
            {(['auto', 'clear', 'cloudy', 'rain', 'fog', 'storm'] as const).map((w) => (
              <button key={w} className={s.weatherMode === w ? 'on' : ''} onClick={() => setS({ weatherMode: w })}>
                {w === 'auto' ? 'Auto' : WEATHER_LABEL[w]}
              </button>
            ))}
          </div>
        </div>
        <label className="field check">
          <input type="checkbox" checked={s.postfx} onChange={(e) => setS({ postfx: e.target.checked })} />
          <span>Cinematic post-processing (bloom, colour grade, vignette, SMAA)</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={s.photoFace} onChange={(e) => setS({ photoFace: e.target.checked })} />
          <span>Use reference photo for the hero’s face (off = painted face)</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={s.showPerf} onChange={(e) => setS({ showPerf: e.target.checked })} />
          <span>Show performance overlay</span>
        </label>
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export function AtmPanel({ onClose }: { onClose: () => void }) {
  const { cash, bank, set, toast } = useGame()
  const withdraw = (n: number) => {
    if (bank < n) return toast('Insufficient balance', 'warn')
    set({ bank: bank - n, cash: cash + n })
    audio.cash()
  }
  const deposit = () => {
    if (!cash) return
    set({ bank: bank + cash, cash: 0 })
    audio.cash()
  }
  return (
    <div className="panel-center">
      <div className="atm">
        <div className="atm-bank">DESI BANK · ATM</div>
        <div className="atm-screen">
          <div className="muted">Available balance</div>
          <div className="big">₹{bank.toLocaleString('en-IN')}</div>
          <div className="muted">Cash in hand: ₹{cash.toLocaleString('en-IN')}</div>
          <div className="atm-grid">
            {[500, 1000, 2000, 5000].map((n) => (
              <button key={n} className="btn ghost" onClick={() => withdraw(n)}>
                Withdraw ₹{n}
              </button>
            ))}
            <button className="btn ghost" onClick={deposit}>
              Deposit all cash
            </button>
            <button className="btn" onClick={onClose}>
              Take card & exit
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MetroPanel({ from, onClose }: { from: string; onClose: () => void }) {
  const city = runtime.city!
  const stations = city.interactables.filter((i) => i.type === 'metro')
  const names = [...new Set(stations.map((s) => s.data?.station as string))]
  const [busy, setBusy] = useState(false)
  const go = (name: string) => {
    const g = useGame.getState()
    if (!g.spend(30)) return g.toast('Metro token costs ₹30 — not enough cash', 'warn')
    const st = stations.find((s) => s.data?.station === name)!
    setBusy(true)
    audio.cash()
    setTimeout(() => {
      const fx = Math.sin(st.rot),
        fz = Math.cos(st.rot)
      interiorApi.clear()
      runtime.player.teleport = { x: st.x + fx * 1.5, z: st.z + fz * 1.5, yaw: st.rot }
      runtime.time.minutes += 12
      g.toast(`Arrived at ${name} (12 min ride)`, 'info')
      onClose()
    }, 900)
  }
  return (
    <div className="panel-center">
      <div className="metro">
        <div className="metro-head">
          <span className="metro-m">M</span> Metro — {from}
        </div>
        {busy ? (
          <div className="metro-ride">Train arriving… ⟶</div>
        ) : (
          <>
            <div className="muted">Choose destination · token ₹30</div>
            <div className="metro-list">
              {names
                .filter((n) => n !== from)
                .map((n) => (
                  <button key={n} className="btn ghost" onClick={() => go(n)}>
                    {n}
                  </button>
                ))}
            </div>
            <div className="muted small">Fast travel between stations in this city. Underground stations & trains are planned for a later phase.</div>
            <div className="row-end">
              <button className="btn" onClick={onClose}>
                Leave station
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function InfoPanel({ data, onClose }: { data: Record<string, unknown>; onClose: () => void }) {
  return (
    <div className="panel-center">
      <div className="info-card">
        <div className="eyebrow">Plaque</div>
        <h2>{data.title as string}</h2>
        <p>{data.text as string}</p>
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** Book a train to another city (fare & journey time from real great-circle distance). */
export function TrainPanel({ onClose }: { onClose: () => void }) {
  const cur = CITIES.find((c) => c.id === useGame.getState().cityId)!
  const km = (a: [number, number], b: [number, number]) => {
    const R = 6371,
      dLat = ((b[0] - a[0]) * Math.PI) / 180,
      dLon = ((b[1] - a[1]) * Math.PI) / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h)) * 1.25 // rail route ≈ 1.25 × straight line
  }
  const go = (id: string, fare: number, hours: number) => {
    const g = useGame.getState()
    if (!g.spend(fare)) return g.toast(`Ticket costs ₹${fare} — withdraw cash at an ATM first.`, 'warn')
    audio.cash()
    document.exitPointerLock?.()
    useGame.setState({ panel: null, travelRequest: { cityId: id, hours } })
  }
  return (
    <div className="panel-center">
      <div className="metro train">
        <div className="metro-head">🚆 Book a train from {cur.name}</div>
        <div className="muted small">Fares & journey times are rough, game-balanced estimates from real distances.</div>
        <div className="train-list">
          {CITIES.filter((c) => c.id !== cur.id && c.load).map((c) => {
            const d = Math.round(km(cur.ll, c.ll))
            const fare = Math.max(250, Math.round((d * 0.9) / 10) * 10)
            const hours = Math.round((d / 58 + 0.5) * 2) / 2
            return (
              <button key={c.id} className="train-row" onClick={() => go(c.id, fare, hours)} style={{ ['--accent' as string]: c.accent }}>
                <span className="cs-name">{c.name}</span>
                <span className="muted">{d.toLocaleString('en-IN')} km · {hours} h</span>
                <span className="train-fare">₹{fare.toLocaleString('en-IN')}</span>
              </button>
            )
          })}
        </div>
        <div className="row-end">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
