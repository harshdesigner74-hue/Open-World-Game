import { runtime } from './runtime'
import { useGame, type Outfit } from './store'
import type { Progress } from '../progress/types'

const KEY = 'iow-save-v2' // v2: real-scale OSM map (v1 positions are no longer valid)

export interface SaveData {
  version: 2
  cityId: string
  x: number
  z: number
  yaw: number
  timeMin: number
  day: number
  cash: number
  bank: number
  health: number
  outfit: Outfit
  progress?: Progress
  savedAt: string
}

export function saveGame(): boolean {
  const s = useGame.getState()
  const data: SaveData = {
    version: 2,
    cityId: s.cityId,
    x: runtime.player.pos.x,
    z: runtime.player.pos.z,
    yaw: runtime.player.yaw,
    timeMin: runtime.time.minutes,
    day: runtime.time.day,
    cash: s.cash,
    bank: s.bank,
    health: s.health,
    outfit: s.outfit,
    progress: s.progress,
    savedAt: new Date().toISOString(),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    useGame.setState({ hasSave: true })
    return true
  } catch {
    return false
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as SaveData
    return d.version === 2 ? d : null
  } catch {
    return null
  }
}
