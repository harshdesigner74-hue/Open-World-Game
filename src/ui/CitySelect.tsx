import { useEffect, useRef, useState } from 'react'
import { loadCityData } from '../game/world/cities/loadCity'
import { CITIES } from '../game/world/cities/registry'
import type { CityData } from '../game/world/types'
import { bakedMap } from './mapRenderer'

export function CitySelect({ onExplore, onBack }: { onExplore: (id: string) => void; onBack: () => void }) {
  const [sel, setSel] = useState('delhi')
  const def = CITIES.find((c) => c.id === sel)!
  const playable = !!def.load
  return (
    <div className="city-select">
      <div className="cs-left">
        <div className="eyebrow">Choose your city</div>
        <h2 className="cs-title">Where to?</h2>
        <div className="cs-list">
          {CITIES.map((c) => (
            <button key={c.id} className={'cs-item' + (sel === c.id ? ' on' : '') + (c.load ? '' : ' locked')} onClick={() => setSel(c.id)} style={{ ['--accent' as string]: c.accent }}>
              <span className="cs-name">{c.name}</span>
              <span className="cs-state">{c.state}</span>
              <span className="cs-tag">{c.load ? 'Playable' : 'Coming soon'}</span>
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
      </div>
      <div className="cs-right" style={{ ['--accent' as string]: def.accent }}>
        <div className="cs-preview">{playable ? <Preview id={def.id} /> : <div className="cs-locked">🔒<div>Arrives in Phase {def.phase}</div></div>}</div>
        <div className="cs-info">
          <div className="eyebrow">{def.state}</div>
          <h1>{def.name}</h1>
          <div className="cs-tagline">{def.tagline}</div>
          <div className="muted">{def.area}</div>
          <div className="eyebrow" style={{ marginTop: 14 }}>
            {playable ? 'Explore' : 'Planned locations'}
          </div>
          <ul className="cs-high">
            {def.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          {playable && (
            <div className="muted small">
              Real streets & footprints from OpenStreetMap at 1:1 scale. Shop names, NPCs and gap-filling buildings are fictional.
            </div>
          )}
          <button className="btn big" disabled={!playable} onClick={() => onExplore(def.id)}>
            {playable ? 'Explore city' : 'Locked'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Preview({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [city, setCity] = useState<CityData | null>(null)
  useEffect(() => {
    let alive = true
    loadCityData(id).then((c) => alive && setCity(c))
    return () => {
      alive = false
    }
  }, [id])
  useEffect(() => {
    if (!city || !ref.current) return
    const c = ref.current
    const map = bakedMap(city, 1)
    const W = c.clientWidth,
      H = c.clientHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = W * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    const s = Math.min(W / map.width, H / map.height) * 1.0
    g.drawImage(map, (W - map.width * s) / 2, (H - map.height * s) / 2, map.width * s, map.height * s)
    g.font = '700 13px Rajdhani, sans-serif'
    g.textAlign = 'center'
    for (const l of city.landmarks) {
      if (l.accuracy === 'fictional') continue
      const x = (W - map.width * s) / 2 + (l.x - city.bounds.minX) * s
      const y = (H - map.height * s) / 2 + (l.z - city.bounds.minZ) * s
      g.fillStyle = '#ffcf6b'
      g.beginPath()
      g.arc(x, y, 4, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#fff'
      g.fillText(l.name, x, y - 9)
    }
  }, [city])
  return city ? <canvas ref={ref} className="cs-canvas" /> : <div className="cs-locked">Generating map…</div>
}
