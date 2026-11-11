import type { VehicleKind } from '../world/models'

/** Persistent career/progress data (saved with the game). */
export type Style = 'hoodie' | 'tshirt' | 'kurta' | 'shirt'
export interface OwnedVehicle {
  id: number
  kind: VehicleKind
  color: string
  city: string
  x: number
  z: number
  rot: number
  health: number
  fuel: number
}
export interface Progress {
  style: Style
  ownedStyles: Style[]
  vehicles: OwnedVehicle[]
  jobsDone: number
  earned: number
  chai: number
  rides: number
  landmarks: string[] // "city:name"
  cities: string[]
  diyas: Record<string, number[]>
  achievements: string[]
  /** owned flats: "city:x,z" */
  properties?: string[]
  story?: { chapter: number; step: number; done: boolean; base?: number; from?: string; v?: number }
  /** friendships & romance, keyed by person id (game/social/people.ts) */
  social?: Record<string, Rel>
  /** id of the person you are dating / engaged / married to */
  partner?: string
  partnerStatus?: 'dating' | 'engaged' | 'married'
  ring?: boolean
  inbox?: { from: string; text: string; day: number }[]
}

export const newProgress = (): Progress => ({
  style: 'hoodie',
  ownedStyles: ['hoodie'],
  vehicles: [],
  jobsDone: 0,
  earned: 0,
  chai: 0,
  rides: 0,
  landmarks: [],
  cities: [],
  diyas: {},
  achievements: [],
})


export interface Rel {
  /** friendship 0..100 */
  f: number
  /** romance 0..100 (romance characters only) */
  r: number
  dates: number
  /** absolute game minute of the last conversation (day * 1440 + minutes) */
  lastTalk: number
  lastGiftDay: number
  lastSeenDay: number
  challengeDay: number
  nightDay: number
}
