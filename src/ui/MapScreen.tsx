import { useEffect, useRef, useState } from 'react'
import { runtime } from '../game/state/runtime'
import { useGame } from '../game/state/store'
import { LANDMARK_ICON, bakedMap } from './mapRenderer'

/** Full-screen world map: zoom (wheel), pan (drag), click to set a waypoint, right-click to clear. */
export function MapScreen({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const city = runtime.city!
  const [view, setView] = useState(() => ({ x: runtime.player.pos.x, z: runtime.player.pos.z, zoom: 1.2 }))
  const drag = useRef<{ sx: number; sy: number; vx: number; vz: number; moved: boolean } | null>(null)
  const waypoint = useGame((s) => s.waypoint)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = c.clientWidth,
      H = c.clientHeight
    c.width = W * dpr
    c.height = H * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#101317'
    g.fillRect(0, 0, W, H)
    const big = (city.bounds.maxX - city.bounds.minX) * (city.bounds.maxZ - city.bounds.minZ) > 4e6
    const ppm = big ? 1 : 2
    const map = bakedMap(city, ppm)
    g.save()
    g.translate(W / 2, H / 2)
    g.scale(view.zoom, view.zoom)
    g.translate(-view.x, -view.z)
    g.imageSmoothingEnabled = true
    g.drawImage(map, city.bounds.minX, city.bounds.minZ, map.width / ppm, map.height / ppm)
    g.restore()
    const toScreen = (x: number, z: number) => [W / 2 + (x - view.x) * view.zoom, H / 2 + (z - view.z) * view.zoom]
    // labels
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (const l of city.labels) {
      if (l.kind === 'road' && view.zoom < 0.9) continue
      if (l.kind === 'district' && view.zoom > 3) continue
      const [sx, sy] = toScreen(l.x, l.z)
      if (sx < -100 || sy < -50 || sx > W + 100 || sy > H + 50) continue
      g.save()
      g.translate(sx, sy)
      if (l.angle !== undefined && l.kind === 'road') {
        let a = l.angle
        if (a > Math.PI / 2) a -= Math.PI
        if (a < -Math.PI / 2) a += Math.PI
        g.rotate(a)
      }
      g.font = l.kind === 'district' ? `700 ${Math.round(13 + view.zoom * 3)}px Teko, sans-serif` : `600 ${Math.round(9 + view.zoom * 2)}px Rajdhani, sans-serif`
      g.fillStyle = l.kind === 'district' ? 'rgba(255,255,255,0.28)' : 'rgba(230,230,230,0.85)'
      g.fillText(l.kind === 'district' ? l.text : l.text, 0, 0)
      g.restore()
    }
    // landmarks
    for (const lm of city.landmarks) {
      const [sx, sy] = toScreen(lm.x, lm.z)
      g.fillStyle = lm.accuracy === 'fictional' ? '#7fd1b9' : '#ffcf6b'
      g.beginPath()
      g.arc(sx, sy, 11, 0, Math.PI * 2)
      g.fill()
      g.font = '13px sans-serif'
      g.fillText(LANDMARK_ICON[lm.category] ?? '★', sx, sy + 1)
      if (view.zoom > 0.6) {
        g.font = '700 14px Rajdhani, sans-serif'
        g.fillStyle = '#fff'
        g.strokeStyle = 'rgba(0,0,0,0.8)'
        g.lineWidth = 3
        g.strokeText(lm.name, sx, sy - 20)
        g.fillText(lm.name, sx, sy - 20)
      }
    }
    // metro stations
    for (const it of city.interactables)
      if (it.type === 'metro') {
        const [sx, sy] = toScreen(it.x, it.z)
        g.fillStyle = '#e53935'
        g.fillRect(sx - 7, sy - 7, 14, 14)
        g.fillStyle = '#fff'
        g.font = '700 11px Rajdhani, sans-serif'
        g.fillText('M', sx, sy + 1)
      }
    // waypoint
    if (waypoint) {
      const [sx, sy] = toScreen(waypoint.x, waypoint.z)
      g.fillStyle = '#ff4d8d'
      g.strokeStyle = '#fff'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(sx, sy)
      g.lineTo(sx - 9, sy - 18)
      g.arc(sx, sy - 20, 9, Math.PI, 0)
      g.closePath()
      g.fill()
      g.stroke()
    }
    // player
    const [px, py] = toScreen(runtime.player.pos.x, runtime.player.pos.z)
    g.save()
    g.translate(px, py)
    g.rotate(-runtime.player.yaw + Math.PI)
    g.fillStyle = '#ff9933'
    g.strokeStyle = '#111'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, -12)
    g.lineTo(9, 10)
    g.lineTo(0, 5)
    g.lineTo(-9, 10)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
  }, [view, waypoint, city])

  const toWorld = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: view.x + (e.clientX - r.left - r.width / 2) / view.zoom, z: view.z + (e.clientY - r.top - r.height / 2) / view.zoom }
  }

  return (
    <div className="panel-full map-screen">
      <canvas
        ref={ref}
        className="map-canvas"
        onWheel={(e) => {
          const w = toWorld(e)
          const zoom = Math.min(6, Math.max(0.25, view.zoom * (e.deltaY > 0 ? 0.87 : 1.15)))
          const r = ref.current!.getBoundingClientRect()
          const ox = e.clientX - r.left - r.width / 2,
            oy = e.clientY - r.top - r.height / 2
          setView({ zoom, x: w.x - ox / zoom, z: w.z - oy / zoom })
        }}
        onMouseDown={(e) => {
          drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vz: view.z, moved: false }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (d) {
            if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true
            setView((v) => ({ ...v, x: d.vx - (e.clientX - d.sx) / v.zoom, z: d.vz - (e.clientY - d.sy) / v.zoom }))
          } else {
            const w = toWorld(e)
            const lm = city.landmarks.find((l) => Math.hypot(l.x - w.x, l.z - w.z) < 14 / view.zoom)
            setHover(lm ? `${lm.name} — ${lm.description} (${lm.accuracy === 'fictional' ? 'fictional' : lm.accuracy === 'osm' ? 'real place, OpenStreetMap position' : 'real place, approximate position'})` : null)
          }
        }}
        onMouseUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved && e.button === 0) {
            const w = toWorld(e)
            useGame.setState({ waypoint: w })
            useGame.getState().toast('Waypoint set', 'info')
          }
        }}
        onMouseLeave={() => (drag.current = null)}
        onContextMenu={(e) => {
          e.preventDefault()
          useGame.setState({ waypoint: null })
        }}
      />
      <div className="map-header">
        <div>
          <div className="eyebrow">World map</div>
          <h2>{city.name}</h2>
        </div>
        <div className="map-actions">
          <button className="btn ghost" onClick={() => setView((v) => ({ ...v, x: runtime.player.pos.x, z: runtime.player.pos.z }))}>
            Center on me
          </button>
          <button className="btn ghost" onClick={() => useGame.setState({ waypoint: null })} disabled={!waypoint}>
            Clear waypoint
          </button>
          <button className="btn" onClick={onClose}>
            Close [M]
          </button>
        </div>
      </div>
      <div className="map-legend">
        <span><i style={{ background: '#ff9933' }} /> You</span>
        <span><i style={{ background: '#ffcf6b' }} /> Real landmark (OSM)</span>
        <span><i style={{ background: '#7fd1b9' }} /> Fictional place</span>
        <span><i style={{ background: '#e53935' }} /> Metro</span>
        <span><i style={{ background: '#ff4d8d' }} /> Waypoint</span>
        <span className="muted">Scroll: zoom · Drag: pan · Click: set waypoint · Right-click: clear</span>
      </div>
      {hover && <div className="map-hover">{hover}</div>}
      <div className="map-credit">Map data {city.attribution}. Real streets at 1:1 scale; light grey blocks are procedural infill. No Google Maps data is used. Surrounding hills: AWS Terrain Tiles (SRTM).</div>
    </div>
  )
}
