/**
 * Device-agnostic input layer. Gameplay code reads ACTIONS (moveX, moveY, look, jump…),
 * never raw keys, so a touch/gamepad source can be added later by writing into the same fields.
 */
type Source = 'keyboard' | 'touch' | 'gamepad'

class InputState {
  keys = new Set<string>()
  private edges = new Set<string>()
  lookDX = 0
  lookDY = 0
  wheel = 0
  /** false while a menu is open: gameplay ignores input */
  enabled = true
  source: Source = 'keyboard'
  /** analog overrides for future touch joystick */
  analog = { x: 0, y: 0, active: false }

  down(code: string) {
    if (!this.keys.has(code)) this.edges.add(code)
    this.keys.add(code)
  }
  up(code: string) {
    this.keys.delete(code)
  }
  /** Edge-triggered: true once per key press. */
  consume(code: string) {
    if (this.edges.has(code)) {
      this.edges.delete(code)
      return true
    }
    return false
  }
  clearEdges() {
    this.edges.clear()
  }
  reset() {
    this.keys.clear()
    this.edges.clear()
    this.lookDX = this.lookDY = this.wheel = 0
  }
  get moveX() {
    if (!this.enabled) return 0
    if (this.analog.active) return this.analog.x
    return (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
  }
  /** +1 = forward */
  get moveY() {
    if (!this.enabled) return 0
    if (this.analog.active) return this.analog.y
    return (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
  }
  get sprint() {
    if (!this.enabled) return false
    if (this.analog.active && Math.hypot(this.analog.x, this.analog.y) > 0.93) return true
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
  }
  get walk() {
    return this.enabled && (this.keys.has('AltLeft') || this.keys.has('ControlLeft'))
  }
  takeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY }
    this.lookDX = this.lookDY = 0
    return r
  }
  takeWheel() {
    const w = this.wheel
    this.wheel = 0
    return w
  }
}

export const input = new InputState()

/** True on phones/tablets (or with ?touch=1 for testing). */
export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (new URLSearchParams(location.search).has('touch') || (matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window))

/** Simulate a key tap/hold from on-screen buttons (goes through the same listeners as a keyboard). */
export function virtualKey(code: string, down: boolean) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
}

const GAME_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'ControlLeft'])

export function attachKeyboardMouse(target: HTMLElement) {
  const kd = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    if (GAME_KEYS.has(e.code)) e.preventDefault()
    input.down(e.code)
  }
  const ku = (e: KeyboardEvent) => input.up(e.code)
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement === target) {
      input.lookDX += e.movementX
      input.lookDY += e.movementY
    }
  }
  const wh = (e: WheelEvent) => {
    if (document.pointerLockElement === target) input.wheel += Math.sign(e.deltaY)
  }
  const blur = () => input.reset()
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
  window.addEventListener('mousemove', mm)
  window.addEventListener('wheel', wh, { passive: true })
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', kd)
    window.removeEventListener('keyup', ku)
    window.removeEventListener('mousemove', mm)
    window.removeEventListener('wheel', wh)
    window.removeEventListener('blur', blur)
  }
}
