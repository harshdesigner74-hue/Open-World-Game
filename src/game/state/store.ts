import { create } from 'zustand'
import { newProgress, type Progress } from '../progress/types'

export type Screen = 'title' | 'citySelect' | 'loading' | 'playing'
export type Panel = null | 'pause' | 'map' | 'character' | 'settings' | 'atm' | 'metro' | 'info' | 'train' | 'wardrobe' | 'dealer' | 'jobs' | 'vehicles' | 'dialogue' | 'social' | 'date' | 'phone'
export type Quality = 'low' | 'medium' | 'high'

export interface Settings {
  quality: Quality
  mouseSensitivity: number
  invertY: boolean
  volume: number
  photoFace: boolean
  showPerf: boolean
  timeScale: number // game minutes per real second
  weatherMode: 'auto' | 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm'
  postfx: boolean
}

export interface Outfit {
  hoodie: string
  pants: string
  shoes: string
}

export const DEFAULT_OUTFIT: Outfit = { hoodie: '#5c2a22', pants: '#2b2b2d', shoes: '#ecebe6' }

export const QUALITY = {
  low: { shadows: 0, detailRadius: 230, lodRadius: 650, physicsRadius: 120, npcs: 85, vehicles: 36, dpr: 1, fogFar: 560 },
  medium: { shadows: 1024, detailRadius: 330, lodRadius: 900, physicsRadius: 140, npcs: 160, vehicles: 60, dpr: 1.25, fogFar: 760 },
  high: { shadows: 2048, detailRadius: 430, lodRadius: 1200, physicsRadius: 160, npcs: 230, vehicles: 85, dpr: 2, fogFar: 980 },
} as const

export interface ActiveJob {
  kind: 'delivery' | 'fare' | 'tour' | 'challenge'
  /** friendship challenge: whose friendship grows on success */
  friend?: string
  title: string
  stage: number
  targets: { x: number; z: number; label: string }[]
  reward: number
  /** runtime.time.elapsed seconds; 0 = untimed */
  deadline: number
  needsVehicle: boolean
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'money' | 'warn' | 'speech'
}

export interface GameStore {
  screen: Screen
  cityId: string
  loadingMsg: string
  panel: Panel
  panelData: Record<string, unknown> | null
  pointerLocked: boolean
  health: number
  stamina: number
  cash: number
  bank: number
  timeMin: number
  day: number
  prompt: string | null
  toasts: Toast[]
  waypoint: { x: number; z: number } | null
  outfit: Outfit
  settings: Settings
  cameraMode: 0 | 1 | 2
  sitting: boolean
  hasSave: boolean
  promptKey: string
  travelRequest: { cityId: string; hours: number } | null
  /** full-screen fade-to-black caption (time skips, dates, intimate scenes) */
  cinema: string | null
  progress: Progress
  job: ActiveJob | null
  vehicleHud: { name: string; speed: number; health: number; fuel: number } | null
  setScreen: (s: Screen) => void
  openPanel: (p: Panel, data?: Record<string, unknown> | null) => void
  closePanel: () => void
  toast: (text: string, kind?: Toast['kind']) => void
  set: (patch: Partial<GameStore>) => void
  setSettings: (patch: Partial<Settings>) => void
  spend: (amount: number) => boolean
}

let toastId = 0
const savedSettings = (() => {
  try {
    return JSON.parse(localStorage.getItem('iow-settings') || 'null') as Partial<Settings> | null
  } catch {
    return null
  }
})()

export const useGame = create<GameStore>((set, get) => ({
  screen: 'title',
  cityId: 'delhi',
  loadingMsg: '',
  panel: null,
  panelData: null,
  pointerLocked: false,
  health: 100,
  stamina: 100,
  cash: 500,
  bank: 25000,
  timeMin: 9 * 60,
  day: 1,
  prompt: null,
  toasts: [],
  waypoint: null,
  outfit: DEFAULT_OUTFIT,
  settings: {
    quality: 'medium',
    mouseSensitivity: 1,
    invertY: false,
    volume: 0.7,
    photoFace: true,
    showPerf: false,
    timeScale: 1,
    weatherMode: 'auto',
    postfx: true,
    ...savedSettings,
  },
  cameraMode: 0,
  sitting: false,
  promptKey: 'E',
  travelRequest: null,
  cinema: null,
  progress: newProgress(),
  job: null,
  vehicleHud: null,
  hasSave: (() => {
    try {
      return !!localStorage.getItem('iow-save-v2')
    } catch {
      return false
    }
  })(),
  setScreen: (screen) => set({ screen }),
  openPanel: (panel, data = null) => set({ panel, panelData: data }),
  closePanel: () => set({ panel: null, panelData: null }),
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'speech' ? 3800 : 3200)
  },
  set: (patch) => set(patch),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    try {
      localStorage.setItem('iow-settings', JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
    set({ settings })
  },
  spend: (amount) => {
    const { cash } = get()
    if (cash < amount) return false
    set({ cash: cash - amount })
    return true
  },
}))
