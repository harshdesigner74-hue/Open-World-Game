import type { GameStore } from '../state/store'
import type { CityData } from '../world/types'
import { LOVE_CHAPTERS } from './love'

/**
 * Story campaign "Naya Safar" (a new journey): an original three-chapter arc that runs in
 * whichever city the player is in. Locations are resolved from the live city data
 * (nearest chai stall, a landmark, the dealer, the railway counter...), so it works in
 * every OSM city without hand-placed content.
 */

export type Pt = { x: number; z: number }
export interface Line {
  who: string
  text: string
}
export type Who = 'rohan' | 'meera' | 'phone' | 'maa'

export interface StoryState {
  chapter: number
  step: number
  done: boolean
  /** counter snapshot taken when the step started (jobs done, cities...) */
  base?: number
  /** city the step started in */
  from?: string
  /** campaign layout version (2 = relationship arc first) */
  v?: number
}
export const STORY_VERSION = 2

export type Step =
  | { kind: 'talk'; who: Who; at: (c: CityData) => Pt; objective: string; lines: Line[] | (() => Line[]); reward?: number }
  | { kind: 'reach'; at: (c: CityData) => Pt; radius: number; objective: (c: CityData) => string; reward?: number }
  | {
      kind: 'cond'
      objective: string | ((c: CityData) => string)
      reward?: number
      /** snapshot when the step starts */
      base?: (g: GameStore) => number
      check: (g: GameStore, s: StoryState) => boolean
      hint?: (c: CityData) => Pt | null
    }
  | { kind: 'call'; lines: Line[] | (() => Line[]); reward?: number }

export interface Chapter {
  title: string
  steps: Step[]
}

export const NPC_NAMES: Record<Who, string> = { rohan: 'Rohan (cousin)', meera: 'Meera (mechanic)', phone: 'Phone call', maa: 'Maa' }

// ---------- location resolvers (deterministic per city) ----------
const cache = new Map<string, Pt>()
const memo = (key: string, c: CityData, f: () => Pt) => {
  const k = c.id + ':' + key
  let v = cache.get(k)
  if (!v) {
    v = f()
    cache.set(k, v)
  }
  return v
}
const inside = (c: CityData, x: number, z: number, m = 40) => x > c.bounds.minX + m && x < c.bounds.maxX - m && z > c.bounds.minZ + m && z < c.bounds.maxZ - m
const nearestOf = (c: CityData, type: string, from: Pt) => {
  let best: Pt | null = null
  let bd = Infinity
  for (const i of c.interactables) {
    if (i.type !== type || !inside(c, i.x, i.z, 20)) continue
    const d = Math.hypot(i.x - from.x, i.z - from.z)
    if (d < bd) {
      bd = d
      best = { x: i.x, z: i.z }
    }
  }
  return best
}
/** a road node in a distance band from spawn (first one in a stable order) */
const roadNode = (c: CityData, rMin: number, rMax: number): Pt => {
  const g = c.graph
  const S = c.spawn
  let best: Pt | null = null
  let bd = Infinity
  for (let i = 0; i < g.x.length; i++) {
    const d = Math.hypot(g.x[i] - S.x, g.z[i] - S.z)
    if (d < rMin || d > rMax || g.adj[i].length < 2 || !inside(c, g.x[i], g.z[i])) continue
    // prefer the node nearest the middle of the band
    const score = Math.abs(d - (rMin + rMax) / 2)
    if (score < bd) {
      bd = score
      best = { x: g.x[i], z: g.z[i] }
    }
  }
  return best ?? { x: S.x + 30, z: S.z }
}

/** Rohan waits next to the chai stall closest to the spawn point. */
export const chaiSpot = (c: CityData) =>
  memo('chai', c, () => {
    const t = nearestOf(c, 'tea', c.spawn) ?? roadNode(c, 20, 80)
    return { x: t.x + 1.6, z: t.z + 1.2 }
  })
export const landmarkSpot = (c: CityData) =>
  memo('lm', c, () => {
    const S = c.spawn
    const lm = c.landmarks
      .filter((l) => inside(c, l.x, l.z) && Math.hypot(l.x - S.x, l.z - S.z) > 80)
      .sort((a, b) => (a.category === 'monument' ? 0 : 1) - (b.category === 'monument' ? 0 : 1) || Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z))[0]
    return lm ? { x: lm.x, z: lm.z } : roadNode(c, 200, 400)
  })
export const landmarkName = (c: CityData) => {
  const p = landmarkSpot(c)
  return c.landmarks.find((l) => l.x === p.x && l.z === p.z)?.name ?? c.areaName(p.x, p.z)
}
export const garageSpot = (c: CityData) => memo('garage', c, () => roadNode(c, 380, 700))
export const dealerSpot = (c: CityData) => nearestOf(c, 'dealer', c.spawn)
export const stationSpot = (c: CityData) => memo('station', c, () => nearestOf(c, 'train', c.spawn) ?? roadNode(c, 100, 300))

const jobsSince = (g: GameStore, s: StoryState) => g.progress.jobsDone - (s.base ?? 0)

export const CHAPTERS: Chapter[] = [
  ...LOVE_CHAPTERS,
  {
    title: 'Naya Shehar — A New City',
    steps: [
      {
        kind: 'talk',
        who: 'rohan',
        at: chaiSpot,
        objective: 'Catch up with Rohan at the chai stall',
        lines: [
          { who: 'rohan', text: 'Look at you — a married man of this city! Shaadi ka hangover gone yet?' },
          { who: 'you', text: 'Almost. My wallet is still recovering.' },
          { who: 'rohan', text: 'Exactly. Married life runs on money and jugaad. Time to really build a life here — work, wheels, the works.' },
          { who: 'rohan', text: 'Start simple: go see the sights like a proper local and send me a selfie. Then we find you work.' },
        ],
      },
      { kind: 'reach', at: landmarkSpot, radius: 40, objective: (c) => `Take a selfie at ${landmarkName(c)}` },
      {
        kind: 'cond',
        objective: 'Earn your first wages — finish any job (press J for jobs)',
        base: (g) => g.progress.jobsDone,
        check: (g, s) => jobsSince(g, s) >= 1,
      },
      {
        kind: 'talk',
        who: 'rohan',
        at: chaiSpot,
        objective: 'Head back to Rohan at the chai stall',
        reward: 500,
        lines: [
          { who: 'rohan', text: 'Selfie received, first payment done. Maa says you look thin. I said that is just the city.' },
          { who: 'rohan', text: 'Here — ₹500 from me. Not a loan. Okay, a little bit a loan.' },
          { who: 'rohan', text: 'Next: you cannot do deliveries on foot forever. Get yourself some wheels.' },
        ],
      },
    ],
  },
  {
    title: 'Apni Gaadi — Wheels of Your Own',
    steps: [
      {
        kind: 'cond',
        objective: 'Buy your own vehicle at the dealer',
        check: (g) => g.progress.vehicles.length > 0,
        hint: dealerSpot,
      },
      {
        kind: 'talk',
        who: 'meera',
        at: garageSpot,
        objective: "Ride over to Meera's roadside garage",
        lines: [
          { who: 'meera', text: "So you are Rohan's cousin. He said you would come in looking confused. He was right." },
          { who: 'meera', text: 'Nice ride. I will keep it running — but my customers need parcels moved and people driven.' },
          { who: 'meera', text: 'Do two jobs for the neighbourhood and you will have a reputation. Then come back.' },
        ],
      },
      {
        kind: 'cond',
        objective: 'Build a reputation — finish 2 more jobs',
        base: (g) => g.progress.jobsDone,
        check: (g, s) => jobsSince(g, s) >= 2,
      },
      {
        kind: 'talk',
        who: 'meera',
        at: garageSpot,
        objective: "Return to Meera's garage",
        reward: 1500,
        lines: [
          { who: 'meera', text: 'Word travels fast. Three different aunties told me about the polite new delivery person.' },
          { who: 'meera', text: '₹1,500 — your cut of the referrals. And free oil change. Once.' },
          { who: 'meera', text: 'You know, my brother runs a workshop in another city. Big opportunities. Think about it.' },
        ],
      },
    ],
  },
  {
    title: 'Agla Station — Next Stop',
    steps: [
      { kind: 'cond', objective: 'Carry ₹5,000 cash for the journey (earn it, or withdraw at an ATM)', check: (g) => g.cash >= 5000 },
      { kind: 'reach', at: stationSpot, radius: 10, objective: () => 'Go to the railway booking counter' },
      {
        kind: 'cond',
        objective: 'Take a train to a different city',
        check: (g, s) => !!s.from && g.cityId !== s.from,
        hint: stationSpot,
      },
      {
        kind: 'call',
        reward: 2500,
        lines: [
          { who: 'phone', text: '📱 Incoming call — Rohan' },
          { who: 'rohan', text: 'Oye! Meera says you actually went. New city, new hustle. I am proud — do not tell anyone I said that.' },
          { who: 'rohan', text: "Maa sent ₹2,500 'for food'. It is in your account. Eat something that is not chai." },
          { who: 'you', text: 'No promises.' },
          { who: 'rohan', text: 'Story of your life. Go — the whole country is open. Call me when you are famous.' },
        ],
      },
    ],
  },
]

export function objectiveText(step: Step, c: CityData) {
  if (step.kind === 'talk') return step.objective
  if (step.kind === 'reach') return step.objective(c)
  if (step.kind === 'cond') return typeof step.objective === 'function' ? step.objective(c) : step.objective
  return 'Answer your phone'
}
export const stepLines = (step: Step) => (step.kind === 'talk' || step.kind === 'call' ? (typeof step.lines === 'function' ? step.lines() : step.lines) : [])

export const storyStep = (s: StoryState | undefined) => (s && !s.done ? CHAPTERS[s.chapter]?.steps[s.step] : undefined)
