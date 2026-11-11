import { useEffect, useRef, useState } from 'react'
import { input, virtualKey } from '../game/input/input'
import { useGame } from '../game/state/store'

const R = 56 // joystick radius in px

/**
 * On-screen controls for phones/tablets: left thumb joystick (walk / steer & throttle),
 * drag anywhere on the right half to look, and action buttons that act like key presses.
 */
export function TouchControls() {
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null)
  const stickId = useRef<number | null>(null)
  const lookId = useRef<{ id: number; x: number; y: number } | null>(null)
  const prompt = useGame((s) => s.prompt)
  const driving = useGame((s) => !!s.vehicleHud)

  // map joystick to driving keys too (vehicles read W/A/S/D directly)
  const setDriveKeys = (x: number, y: number) => {
    const want: Record<string, boolean> = { KeyW: y > 0.3, KeyS: y < -0.3, KeyA: x < -0.35, KeyD: x > 0.35 }
    for (const [k, v] of Object.entries(want)) {
      if (v && !input.keys.has(k)) input.down(k)
      else if (!v && input.keys.has(k)) input.up(k)
    }
  }

  useEffect(() => {
    const zone = document.querySelector('.touch-zone') as HTMLDivElement | null
    if (!zone) return
    const start = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.45 && stickId.current === null) {
          stickId.current = t.identifier
          setStick({ ox: t.clientX, oy: t.clientY, x: 0, y: 0 })
        } else if (lookId.current === null) lookId.current = { id: t.identifier, x: t.clientX, y: t.clientY }
      }
      e.preventDefault()
    }
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId.current) {
          setStick((s) => {
            if (!s) return s
            let dx = t.clientX - s.ox,
              dy = t.clientY - s.oy
            const l = Math.hypot(dx, dy)
            if (l > R) {
              dx *= R / l
              dy *= R / l
            }
            input.analog.active = true
            input.analog.x = dx / R
            input.analog.y = -dy / R
            setDriveKeys(dx / R, -dy / R)
            return { ...s, x: dx, y: dy }
          })
        } else if (lookId.current && t.identifier === lookId.current.id) {
          input.lookDX += (t.clientX - lookId.current.x) * 2.2
          input.lookDY += (t.clientY - lookId.current.y) * 2.2
          lookId.current.x = t.clientX
          lookId.current.y = t.clientY
        }
      }
      e.preventDefault()
    }
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stickId.current) {
          stickId.current = null
          setStick(null)
          input.analog.active = false
          input.analog.x = input.analog.y = 0
          setDriveKeys(0, 0)
        } else if (lookId.current && t.identifier === lookId.current.id) lookId.current = null
      }
    }
    zone.addEventListener('touchstart', start, { passive: false })
    zone.addEventListener('touchmove', move, { passive: false })
    zone.addEventListener('touchend', end)
    zone.addEventListener('touchcancel', end)
    return () => {
      zone.removeEventListener('touchstart', start)
      zone.removeEventListener('touchmove', move)
      zone.removeEventListener('touchend', end)
      zone.removeEventListener('touchcancel', end)
      input.analog.active = false
      setDriveKeys(0, 0)
    }
  }, [])

  const btn = (label: string, code: string, cls = '') => (
    <button
      className={`tbtn ${cls}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        virtualKey(code, true)
      }}
      onPointerUp={() => virtualKey(code, false)}
      onPointerCancel={() => virtualKey(code, false)}
      onPointerLeave={() => virtualKey(code, false)}
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="touch-zone" />
      {stick && (
        <div className="tstick" style={{ left: stick.ox - R, top: stick.oy - R, width: R * 2, height: R * 2 }}>
          <div className="tknob" style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} />
        </div>
      )}
      <div className="tbtns">
        {prompt && btn('E', 'KeyE', 'tbtn-e')}
        {btn(driving ? 'EXIT' : 'CAR', 'KeyF')}
        {btn(driving ? 'BRAKE' : 'JUMP', 'Space', 'tbtn-big')}
        {driving && btn('HORN', 'KeyH')}
        {!driving && btn('RUN', 'ShiftLeft')}
      </div>
      <div className="ttop">
        {btn('☰', 'Escape')}
        {btn('MAP', 'KeyM')}
        {btn('JOBS', 'KeyJ')}
        {btn('📱', 'KeyP')}
        {btn('CAM', 'KeyC')}
      </div>
    </>
  )
}

