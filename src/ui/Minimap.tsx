import { useEffect, useRef } from 'react'
import { runtime } from '../game/state/runtime'
import { useGame } from '../game/state/store'
import { bakedMap } from './mapRenderer'

const SIZE = 210
const PPM = 1.0 // map pixels per metre at the minimap's scale

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 33) return
      last = now
      const c = ref.current
      const city = runtime.city
      if (!c || !city) return
      const g = c.getContext('2d')!
      const map = bakedMap(city, 1)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== SIZE * dpr) {
        c.width = c.height = SIZE * dpr
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, SIZE, SIZE)
      g.save()
      g.beginPath()
      g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2)
      g.clip()
      g.fillStyle = '#15181c'
      g.fillRect(0, 0, SIZE, SIZE)
      const P = runtime.player.pos
      const yaw = runtime.cam.yaw
      // rotate so the camera's forward direction points up
      const theta = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw))
      g.translate(SIZE / 2, SIZE / 2)
      g.rotate(theta)
      g.scale(PPM, PPM)
      g.translate(-P.x, -P.z)
      g.drawImage(map, city.bounds.minX, city.bounds.minZ)
      // nearby vehicles
      g.fillStyle = 'rgba(255,255,255,0.55)'
      for (const v of runtime.vehicles) if (Math.abs(v.x - P.x) < 160 && Math.abs(v.z - P.z) < 160) g.fillRect(v.x - 1.5, v.z - 1.5, 3, 3)
      // landmarks
      for (const l of city.landmarks) {
        if (Math.abs(l.x - P.x) > 200 || Math.abs(l.z - P.z) > 200) continue
        g.save()
        g.translate(l.x, l.z)
        g.rotate(-theta)
        g.fillStyle = '#ffcf6b'
        g.beginPath()
        g.arc(0, 0, 4, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
      const wp = useGame.getState().waypoint
      g.restore()
      // waypoint (clamped to rim)
      if (wp) {
        const dx = wp.x - P.x,
          dz = wp.z - P.z
        const rx = (dx * Math.cos(theta) - dz * Math.sin(theta)) * PPM
        const rz = (dx * Math.sin(theta) + dz * Math.cos(theta)) * PPM
        const d = Math.hypot(rx, rz)
        const lim = SIZE / 2 - 12
        const k = d > lim ? lim / d : 1
        g.fillStyle = '#ff4d8d'
        g.beginPath()
        g.arc(SIZE / 2 + rx * k, SIZE / 2 + rz * k, 6, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = '#fff'
        g.lineWidth = 2
        g.stroke()
      }
      // player arrow
      const rel = runtime.player.yaw - yaw
      g.save()
      g.translate(SIZE / 2, SIZE / 2)
      g.rotate(-rel)
      g.fillStyle = '#ff9933'
      g.strokeStyle = '#1b1b1b'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(0, -9)
      g.lineTo(6.5, 7)
      g.lineTo(0, 3.5)
      g.lineTo(-6.5, 7)
      g.closePath()
      g.fill()
      g.stroke()
      g.restore()
      // north marker on the rim
      const nAng = theta - Math.PI / 2
      const nx = SIZE / 2 + Math.cos(nAng) * (SIZE / 2 - 12)
      const ny = SIZE / 2 + Math.sin(nAng) * (SIZE / 2 - 12)
      g.fillStyle = '#e8e8e8'
      g.font = '700 13px Rajdhani, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('N', nx, ny)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="minimap">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} />
    </div>
  )
}
