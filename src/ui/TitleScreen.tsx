import { useEffect, useState } from 'react'
import { useGame } from '../game/state/store'
import { Controls } from './Menus'
import { TitleScene } from './TitleScene'

const CITIES = ['New Delhi', 'Mumbai', 'Bengaluru', 'Jaipur', 'Kolkata', 'Chennai', 'Hyderabad', 'Pune', 'Gwalior', 'Chandigarh']

export function TitleScreen({ onNew, onContinue }: { onNew: () => void; onContinue: () => void }) {
  const hasSave = useGame((s) => s.hasSave)
  const [showControls, setShowControls] = useState(false)
  const [city, setCity] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCity((c) => (c + 1) % CITIES.length), 2600)
    return () => clearInterval(id)
  }, [])
  const items: { label: string; act: () => void }[] = [
    ...(hasSave ? [{ label: 'Continue', act: onContinue }] : []),
    { label: 'New Game', act: onNew },
    { label: 'Controls', act: () => setShowControls(true) },
  ]
  return (
    <div className="title-screen">
      <TitleScene />
      <div className="title-shade" />
      <div className="title-content">
        <div className="title-logo">
          <div className="logo-top">INDIA</div>
          <div className="logo-bar">
            <span>OPEN</span>
            <span>WORLD</span>
          </div>
          <div className="logo-sub">Chai. Traffic. Love. Ten real cities.</div>
        </div>
        <nav className="title-menu" aria-label="Main menu">
          {items.map((it, i) => (
            <button key={it.label} className={'title-item' + (i === 0 ? ' primary' : '')} onClick={it.act}>
              {it.label}
            </button>
          ))}
        </nav>
        <div className="title-city">
          <span className="dot" /> Now showing <b key={city}>{CITIES[city]}</b> · real streets from OpenStreetMap
        </div>
      </div>
      <div className="title-foot">Original game, characters and setting. Not affiliated with any other game. Map data © OpenStreetMap contributors.</div>
      {showControls && (
        <div className="panel-center" onClick={() => setShowControls(false)}>
          <div className="panel title-controls-panel" onClick={(e) => e.stopPropagation()}>
            <Controls />
            <button className="btn" onClick={() => setShowControls(false)}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
