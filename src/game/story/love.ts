import { PEOPLE, personById, personSpot, presentAt, type PersonDef } from '../social/people'
import { runtime } from '../state/runtime'
import { useGame, type GameStore } from '../state/store'
import type { CityData } from '../world/types'
import { chaiSpot, type Chapter } from './story'

/**
 * Opening campaign: the relationship arc. From the first minute the game's goal is to meet
 * someone, become friends, date, commit, propose and marry. After the wedding the city-life
 * chapters (sights, jobs, wheels, trains) continue.
 * NOTE: `chaiSpot` is referenced lazily (inside lambdas) because story.ts imports this module.
 */
const ROMANCE = PEOPLE.filter((p) => p.romance)

/** the person the arc is about: your partner, else whoever you are closest to, else Ananya */
export function loveTarget(g: GameStore = useGame.getState()): PersonDef {
  const pr = g.progress
  if (pr.partner) return personById(pr.partner)
  let best: PersonDef | null = null
  let bs = 0
  for (const p of ROMANCE) {
    const r = pr.social?.[p.id]
    if (!r) continue
    const sc = r.r * 2 + r.f
    if (sc > bs) {
      bs = sc
      best = p
    }
  }
  return best ?? personById('ananya')
}
const rel = (g: GameStore, id: string) => g.progress.social?.[id]
const fmtH = (h: number) => `${((h + 11) % 12) + 1}${h < 12 || h === 24 ? 'am' : 'pm'}`
/** "(around 9am–8pm)" when they are not there right now */
const whenText = (p: PersonDef) => {
  const hour = Math.floor(runtime.time.minutes / 60)
  if (presentAt(p, hour) || useGame.getState().progress.partner === p.id) return ''
  return ` — usually around ${p.hours.map(([a, b]) => `${fmtH(a)}–${fmtH(b % 24)}`).join(', ')}`
}
const target = () => loveTarget()
const named = (f: (n: string, p: PersonDef) => string) => () => {
  const p = target()
  return f(p.name, p) + whenText(p)
}
const hintTarget = (c: CityData) => personSpot(c, target())
/** nearest love interest who is around right now (for the very first hello) */
const hintAnyone = (c: CityData) => {
  const hour = Math.floor(runtime.time.minutes / 60)
  const P = runtime.player.pos
  let best: { x: number; z: number } | null = null
  let bd = Infinity
  for (const p of ROMANCE) {
    if (!presentAt(p, hour)) continue
    const s = personSpot(c, p)
    const d = Math.hypot(s.x - P.x, s.z - P.z)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best ?? personSpot(c, personById('ananya'))
}
const word = (p: PersonDef) => (p.female ? 'girlfriend' : 'boyfriend')
const engagedOrMore = (g: GameStore) => g.progress.partnerStatus === 'engaged' || g.progress.partnerStatus === 'married'

export const LOVE_CHAPTERS: Chapter[] = [
  {
    title: 'Dil Ki Baat — Matters of the Heart',
    steps: [
      {
        kind: 'call',
        lines: [
          { who: 'phone', text: '📱 Incoming call — Maa' },
          { who: 'maa', text: 'Beta, you reached safely? Eating properly? Good, good.' },
          { who: 'maa', text: 'Now listen. Big city, good job prospects… but a life is not only work. Find someone nice. Somebody who makes you laugh.' },
          { who: 'you', text: 'Maa! I just got here!' },
          { who: 'maa', text: 'And I am not getting younger! Rohan is waiting at the chai stall — he knows everybody. Go!' },
        ],
      },
      {
        kind: 'talk',
        who: 'rohan',
        at: (c) => chaiSpot(c),
        objective: 'Meet your cousin Rohan at the chai stall',
        reward: 1000,
        lines: [
          { who: 'rohan', text: 'Arre, you made it! Let me guess — Maa already called about "finding someone nice"?' },
          { who: 'you', text: 'Before I even left the station.' },
          { who: 'rohan', text: 'Ha! Okay, lucky for you I know the most interesting people in this city.' },
          { who: 'rohan', text: 'Ananya the architect sketches near the old buildings. Zoya the journalist lives at the street-food stalls. Ishita the doctor walks in the park after her shift. Vikram the chef rules the market.' },
          { who: 'rohan', text: 'Rule one: listen. Talk about what THEY love — and never, ever show off your bank balance.' },
          { who: 'rohan', text: 'Here, ₹1,000 for chai and flowers. Press P any time for your phone. Now go say hi!' },
        ],
      },
      {
        kind: 'cond',
        objective: () => 'Say hi to someone special — Ananya, Zoya, Ishita or Vikram (walk up, press E)',
        check: (g) => ROMANCE.some((p) => (rel(g, p.id)?.f ?? 0) > 0),
        hint: hintAnyone,
      },
      {
        kind: 'cond',
        objective: named((n) => `Become friends with ${n} — chat about things they like (friendship 30)`),
        check: (g) => (rel(g, loveTarget(g).id)?.f ?? 0) >= 30,
        hint: hintTarget,
        reward: 500,
      },
      {
        kind: 'cond',
        objective: named((n) => `Make ${n} notice you — a topic or gift they love (romance 20)`),
        check: (g) => (rel(g, loveTarget(g).id)?.r ?? 0) >= 20,
        hint: hintTarget,
      },
    ],
  },
  {
    title: 'Pehli Date — The First Date',
    steps: [
      {
        kind: 'cond',
        objective: named((n) => `Ask ${n} out and go on a date (talk → ❤️ Together)`),
        check: (g) => (rel(g, loveTarget(g).id)?.dates ?? 0) >= 1,
        hint: hintTarget,
        reward: 1500,
      },
      {
        kind: 'talk',
        who: 'rohan',
        at: (c) => chaiSpot(c),
        objective: 'Tell Rohan how the date went',
        reward: 2000,
        lines: () => {
          const p = loveTarget()
          return [
            { who: 'rohan', text: `So?! How was it with ${p.name}? Tell me EVERYTHING.` },
            { who: 'you', text: 'It was… actually really nice.' },
            { who: 'rohan', text: 'Look at that smile. Okay — one date is luck, two dates is interest. Take them out again.' },
            { who: 'rohan', text: `And when it feels right, ask ${p.name} properly. ₹2,000 from me — make the next one special.` },
          ]
        },
      },
      {
        kind: 'cond',
        objective: named((n) => `Go on a second great date with ${n}`),
        check: (g) => (rel(g, loveTarget(g).id)?.dates ?? 0) >= 2,
        hint: hintTarget,
      },
      {
        kind: 'cond',
        objective: named((n, p) => `Ask ${n} to be your ${word(p)} (needs romance 60)`),
        check: (g) => !!g.progress.partner,
        hint: hintTarget,
        reward: 3000,
      },
      {
        kind: 'call',
        reward: 5000,
        lines: () => {
          const p = loveTarget()
          return [
            { who: 'phone', text: '📱 Incoming call — Maa' },
            { who: 'maa', text: `Rohan told me EVERYTHING. ${p.name}! What a lovely name.` },
            { who: 'maa', text: `When do I meet ${p.female ? 'her' : 'him'}? Never mind — I sent ₹5,000. Take ${p.female ? 'her' : 'him'} somewhere nice. Not a dhaba!` },
            { who: 'you', text: 'Maa, dhabas are romantic.' },
            { who: 'maa', text: 'Hmph. Your father said the same thing in 1994.' },
          ]
        },
      },
    ],
  },
  {
    title: 'Rishta Pakka — The Proposal',
    steps: [
      {
        kind: 'cond',
        objective: () => 'Save ₹25,000 cash for a ring — do jobs (J), withdraw from the bank at an ATM',
        check: (g) => g.cash >= 25000 || !!g.progress.ring || engagedOrMore(g),
      },
      {
        kind: 'cond',
        objective: named((n) => `Buy an engagement ring (talk to ${n} → ❤️ Together)`),
        check: (g) => !!g.progress.ring || engagedOrMore(g),
        hint: hintTarget,
      },
      {
        kind: 'cond',
        objective: named((n) => `Win ${n}'s heart completely (romance 85, 4 dates), then propose`),
        check: (g) => engagedOrMore(g),
        hint: hintTarget,
      },
      {
        kind: 'talk',
        who: 'rohan',
        at: (c) => chaiSpot(c),
        objective: 'Share the big news with Rohan',
        reward: 10000,
        lines: () => {
          const p = loveTarget()
          return [
            { who: 'rohan', text: `ENGAGED?! You and ${p.name}? Bhai, I am going to cry. I am already crying.` },
            { who: 'rohan', text: 'Okay okay. Weddings cost money. Here — ₹10,000, my shaadi fund contribution. Do not tell my wife.' },
            { who: 'rohan', text: `Court marriage or a big fat Indian wedding — decide with ${p.name}. I will handle the dhol either way.` },
          ]
        },
      },
    ],
  },
  {
    title: 'Shaadi Mubarak — The Wedding',
    steps: [
      {
        kind: 'cond',
        objective: named((n) => `Plan the wedding with ${n} — court marriage ₹15,000 or the big wedding ₹3,00,000`),
        check: (g) => g.progress.partnerStatus === 'married',
        hint: hintTarget,
      },
      {
        kind: 'call',
        reward: 5000,
        lines: () => {
          const p = loveTarget()
          return [
            { who: 'phone', text: '📱 Incoming call — Rohan' },
            { who: 'rohan', text: `My cousin and ${p.name} — MARRIED! Maa has called me eleven times already.` },
            { who: 'rohan', text: 'Now real life begins: a home, a job, wheels, maybe new cities. Come find me at the chai stall when you are ready.' },
            { who: 'rohan', text: 'Wedding gift: ₹5,000. Spend it on the honeymoon, not on cricket bats.' },
          ]
        },
      },
    ],
  },
]
