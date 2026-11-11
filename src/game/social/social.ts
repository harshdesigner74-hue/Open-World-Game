import { audio } from '../audio/audioEngine'
import { bump, unlock } from '../progress/progress'
import type { Rel } from '../progress/types'
import { runtime } from '../state/runtime'
import { saveGame } from '../state/save'
import { useGame, type ActiveJob } from '../state/store'
import { GIFTS, REACT_POINTS, personById, reactTo, replyLine, type Gift, type Reaction, type Tag, type Topic, type Venue } from './people'

/** Relationship rules: meters, cooldowns, stages, time skips. All state lives in progress.social. */
export const newRel = (): Rel => ({ f: 0, r: 0, dates: 0, lastTalk: -1e9, lastGiftDay: -1, lastSeenDay: -1, challengeDay: -1, nightDay: -1 })
export const getRel = (id: string): Rel => useGame.getState().progress.social?.[id] ?? newRel()
export function setRel(id: string, patch: Partial<Rel>) {
  bump((p) => {
    const cur = p.social?.[id] ?? newRel()
    const next = { ...cur, ...patch }
    next.f = Math.max(0, Math.min(100, next.f))
    next.r = Math.max(0, Math.min(100, next.r))
    return { social: { ...(p.social ?? {}), [id]: next } }
  })
  const r = getRel(id)
  if (r.f >= 70) unlock('yaari')
}
export const nowMin = () => runtime.time.day * 1440 + runtime.time.minutes
export const today = () => runtime.time.day

export const friendLabel = (f: number) => (f < 15 ? 'Stranger' : f < 40 ? 'Acquaintance' : f < 70 ? 'Friend' : 'Close friend')
export const romanceLabel = (r: number) => (r < 20 ? '—' : r < 45 ? 'Interested' : r < 70 ? 'Smitten' : 'In love')
export const partnerWord = (female: boolean) => (female ? 'girlfriend' : 'boyfriend')

export function statusWith(id: string) {
  const p = useGame.getState().progress
  return p.partner === id ? p.partnerStatus : undefined
}

/** advance the clock (hours), handling the day rollover */
export function passTime(hours: number) {
  const T = runtime.time
  T.minutes += hours * 60
  while (T.minutes >= 1440) {
    T.minutes -= 1440
    T.day++
  }
  useGame.setState({ timeMin: T.minutes, day: T.day })
}

/* ------------------------------------------------------------------ actions */
export function talk(id: string, topic: Topic): { reaction: Reaction; line: string } | { error: string } {
  const p = personById(id)
  const rel = getRel(id)
  if (nowMin() - rel.lastTalk < 45) return { error: `${p.name} needs a little break from chatting. Try again in a bit.` }
  const reaction = reactTo(p, topic.tags)
  const pts = REACT_POINTS[reaction]
  const romanceGain = p.romance && rel.f >= 25 && !(statusWith(id) === undefined && useGame.getState().progress.partner && useGame.getState().progress.partner !== id)
  setRel(id, { f: rel.f + pts * (rel.f < 70 ? 0.8 : 0.5), r: romanceGain ? rel.r + pts * 0.7 : rel.r, lastTalk: nowMin(), lastSeenDay: today() })
  audio.blip(reaction === 'dislike' ? 220 : 620, 0.04, 0.12)
  return { reaction, line: replyLine(reaction, topic.id.length + today()) }
}

export function giveGift(id: string, gift: Gift): { reaction: Reaction; line: string } | { error: string } {
  const p = personById(id)
  const rel = getRel(id)
  const g = useGame.getState()
  if (rel.lastGiftDay === today()) return { error: `You already gave ${p.name} something today.` }
  if (!g.spend(gift.price)) return { error: `Not enough cash (₹${gift.price.toLocaleString('en-IN')}). Visit an ATM.` }
  audio.cash()
  const reaction = reactTo(p, gift.tags)
  const pts = REACT_POINTS[reaction] * 1.4 + Math.min(6, gift.price / 1500)
  setRel(id, { f: rel.f + pts * 0.6, r: p.romance ? rel.r + pts * 0.8 : rel.r, lastGiftDay: today(), lastSeenDay: today() })
  const lines: Record<Reaction, string> = {
    love: 'Oh my god, how did you know?! I love it.',
    like: 'Aww, that is so thoughtful. Thank you!',
    meh: 'Oh. Thanks… that is nice of you.',
    dislike: 'Umm. You really did not have to. Really.',
  }
  return { reaction, line: lines[reaction] }
}

export function hangOut(id: string, kind: 'chai' | 'match'): string {
  const p = personById(id)
  const rel = getRel(id)
  const cost = kind === 'chai' ? 40 : 250
  if (!useGame.getState().spend(cost)) return `Not enough cash (₹${cost}).`
  passTime(kind === 'chai' ? 1 : 3)
  const liked = kind === 'chai' ? p.likes.includes('chai') : p.likes.includes('cricket') || p.likes.includes('movies')
  setRel(id, { f: rel.f + (kind === 'chai' ? 7 : 12) + (liked ? 5 : 0), r: p.romance && rel.f > 30 ? rel.r + 3 : rel.r, lastSeenDay: today(), lastTalk: nowMin() })
  return kind === 'chai'
    ? `☕ You and ${p.name} share cutting chai and gossip for an hour.${liked ? ' They loved it.' : ''}`
    : `📺 You watch the match with ${p.name} at a dhaba — loud, chaotic, perfect.${liked ? ' Best evening in ages!' : ''}`
}

/** romance gates */
export function canDate(id: string) {
  const r = getRel(id)
  const p = personById(id)
  const prog = useGame.getState().progress
  if (!p.romance) return 'They are a friend — try hanging out instead.'
  if (prog.partner && prog.partner !== id) return `You are with ${personById(prog.partner).name}. Being faithful matters.`
  if (r.f < 30) return `Get to know ${p.name} better first (friendship 30+).`
  if (r.r < 20) return `${p.name} does not seem interested yet — talk, listen, find what they like.`
  return null
}

export function finishDate(id: string, venue: Venue, picks: Tag[][]) {
  const p = personById(id)
  const rel = getRel(id)
  let score = REACT_POINTS[reactTo(p, venue.tags)] * 1.2
  for (const t of picks) score += REACT_POINTS[reactTo(p, t)]
  passTime(venue.hours)
  const gain = Math.round(score * 0.8)
  setRel(id, { r: rel.r + gain, f: rel.f + Math.max(0, gain) * 0.4, dates: rel.dates + (gain > 0 ? 1 : 0), lastSeenDay: today(), lastTalk: nowMin() })
  unlock('first_date')
  saveGame()
  return {
    gain,
    verdict:
      gain >= 25 ? `✨ Magical. ${p.name} cannot stop smiling.` : gain >= 12 ? `😊 A really good date. ${p.name} wants to do it again.` : gain >= 0 ? `🙂 Nice, if a little awkward.` : `😬 That did not go well. ${p.name} left early.`,
  }
}

export function askToBePartner(id: string): string {
  const p = personById(id)
  const r = getRel(id)
  const prog = useGame.getState().progress
  if (prog.partner && prog.partner !== id) return `You are already with ${personById(prog.partner).name}.`
  if (r.r >= 60 && r.dates >= 2) {
    bump(() => ({ partner: id, partnerStatus: 'dating' }))
    unlock('couple')
    audio.cash()
    saveGame()
    return `❤️ ${p.name} says YES! You are now officially ${p.female ? 'her boyfriend' : 'his partner'}.`
  }
  setRel(id, { r: r.r - 4 })
  return `${p.name} smiles but says: "Let us take it slow — a few more dates first?" (needs 2 good dates and romance 60+)`
}

export function spendNight(id: string): string {
  const p = personById(id)
  const r = getRel(id)
  const prog = useGame.getState().progress
  if (prog.partner !== id) return `You need to be in a relationship with ${p.name} first.`
  if (!prog.properties?.length) return 'You need a place of your own first — buy a flat (look for "Flat for sale").'
  if (r.r < 70) return `${p.name} is not ready for that yet.`
  if (r.nightDay === today()) return `You already spent tonight together.`
  // fade-to-black: no explicit content, the scene cuts to the next morning
  const T = runtime.time
  if (T.minutes >= 7 * 60) T.day++
  T.minutes = 7 * 60 + 30
  useGame.setState({ timeMin: T.minutes, day: T.day, health: 100 })
  runtime.player.stamina = 100
  setRel(id, { r: r.r + 6, f: r.f + 3, nightDay: T.day, lastSeenDay: T.day })
  saveGame()
  return `🌙 You spend the night together at your flat. The next morning ${p.name} makes chai and steals your hoodie.`
}

export const RING_PRICE = 25000
export function buyRing(): string {
  const g = useGame.getState()
  if (g.progress.ring) return 'You already have the ring.'
  if (!g.spend(RING_PRICE)) return `An engagement ring costs ₹${RING_PRICE.toLocaleString('en-IN')} (cash). Visit an ATM.`
  bump(() => ({ ring: true }))
  audio.cash()
  return '💍 You bought a beautiful engagement ring. Now find the right moment…'
}

export function propose(id: string): string {
  const p = personById(id)
  const r = getRel(id)
  const prog = useGame.getState().progress
  if (prog.partner !== id) return `You should be dating ${p.name} first.`
  if (!prog.ring) return 'You need a ring first.'
  if (r.r >= 85 && r.dates >= 4) {
    bump(() => ({ partnerStatus: 'engaged', ring: false }))
    unlock('engaged')
    saveGame()
    return `💍 On one knee… ${p.name} is crying and laughing at the same time — YES! You are engaged!`
  }
  setRel(id, { r: r.r - 8 })
  return `${p.name} gently closes the box: "Not yet… ask me again when we are both sure." (romance 85+, 4 dates)`
}

export const WEDDINGS = [
  { id: 'court', label: '🏛️ Simple court marriage + family lunch', price: 15000 },
  { id: 'big', label: '🎉 Big Indian wedding — baraat, sangeet, the works', price: 300000 },
]
export function wed(id: string, kind: (typeof WEDDINGS)[number]): string {
  const p = personById(id)
  const prog = useGame.getState().progress
  if (prog.partner !== id || prog.partnerStatus !== 'engaged') return 'You need to be engaged first.'
  const g = useGame.getState()
  if (g.cash + g.bank < kind.price) return `That wedding costs ₹${kind.price.toLocaleString('en-IN')} (cash + bank).`
  // take from cash first, then bank
  const fromCash = Math.min(g.cash, kind.price)
  useGame.setState({ cash: g.cash - fromCash, bank: g.bank - (kind.price - fromCash) })
  bump(() => ({ partnerStatus: 'married' }))
  unlock('married')
  passTime(kind.id === 'big' ? 10 : 4)
  const r = getRel(id)
  setRel(id, { r: Math.min(100, r.r + 10) })
  saveGame()
  return kind.id === 'big'
    ? `🎉 Dhol, fireworks, three days of dancing — you and ${p.name} are married! Rohan cried the most.`
    : `💐 A small, happy ceremony and a long family lunch. You and ${p.name} are married!`
}

/** daily upkeep: relationships fade if neglected, partners text you */
export function dailyTick(day: number) {
  const prog = useGame.getState().progress
  const social = prog.social ?? {}
  const inbox = [...(prog.inbox ?? [])]
  for (const [id, rel] of Object.entries(social)) {
    const p = personById(id)
    if (!p) continue
    const missed = day - Math.max(rel.lastSeenDay, 0)
    if (missed < 2) continue
    const isPartner = prog.partner === id
    setRel(id, { f: rel.f - 1, r: rel.r - (isPartner ? (prog.partnerStatus === 'married' ? 1 : 3) : 1) })
    if (isPartner && missed >= 2) {
      const msgs = [`Hey, did you forget about me? 🥺`, `Free tonight? I miss you.`, `Saw something today that reminded me of you ❤️`, `Call me when you are done saving the city 😏`]
      inbox.push({ from: id, text: msgs[day % msgs.length], day })
      useGame.getState().toast(`📱 ${p.name}: ${msgs[day % msgs.length]}`, 'info')
    }
  }
  // breakup if a dating relationship withers away
  if (prog.partner && prog.partnerStatus === 'dating' && getRel(prog.partner).r < 25) {
    const p = personById(prog.partner)
    inbox.push({ from: prog.partner, text: 'I think we want different things. Take care. 💔', day })
    useGame.getState().toast(`💔 ${p.name} broke up with you. Relationships need time and attention.`, 'warn')
    bump(() => ({ partner: undefined, partnerStatus: undefined }))
  }
  bump(() => ({ inbox: inbox.slice(-25) }))
}

export const GIFT_LIST = GIFTS

/* ------------------------------------------------------------------ friendship challenges */
export function startChallenge(id: string, at: { x: number; z: number }): string {
  const p = personById(id)
  const rel = getRel(id)
  const g = useGame.getState()
  const city = runtime.city
  if (!city || !p.challenge) return `${p.name} has no challenge for you.`
  if (rel.f < 40) return `Become friends with ${p.name} first (friendship 40+).`
  if (rel.challengeDay === today()) return `${p.name}: "One challenge a day, champ. Come back tomorrow!"`
  if (g.job) return 'Finish (or cancel) your current job first.'
  const P = runtime.player.pos
  const G = city.graph
  const B = city.bounds
  const node = (cx: number, cz: number, rMin: number, rMax: number) => {
    for (let k = 0; k < 600; k++) {
      const i = Math.floor(Math.random() * G.x.length)
      const d = Math.hypot(G.x[i] - cx, G.z[i] - cz)
      if (d >= rMin && d <= rMax && G.adj[i].length > 1 && G.x[i] > B.minX + 40 && G.x[i] < B.maxX - 40 && G.z[i] > B.minZ + 40 && G.z[i] < B.maxZ - 40) return { x: G.x[i], z: G.z[i] }
    }
    return null
  }
  let job: ActiveJob | null = null
  const t = runtime.time.elapsed
  switch (p.challenge) {
    case 'race': {
      const to = node(P.x, P.z, 350, 650)
      if (to) job = { kind: 'challenge', friend: id, title: `Arjun's race: reach the finish before the clock`, stage: 0, targets: [{ ...to, label: 'Reach the finish line' }], reward: 600, deadline: t + Math.hypot(to.x - P.x, to.z - P.z) / 6 + 30, needsVehicle: false }
      break
    }
    case 'delivery': {
      const a = node(P.x, P.z, 150, 350)
      const b = a && node(a.x, a.z, 350, 700)
      if (a && b) job = { kind: 'challenge', friend: id, title: `Kabir's gig: rush his speaker to the venue`, stage: 0, targets: [{ ...a, label: 'Pick up the speaker' }, { ...b, label: 'Deliver it before the gig starts' }], reward: 900, deadline: t + (Math.hypot(a.x - P.x, a.z - P.z) + Math.hypot(b.x - a.x, b.z - a.z)) / 5 + 45, needsVehicle: false }
      break
    }
    case 'chairun': {
      let best: { x: number; z: number } | null = null
      let bd = Infinity
      for (const it of city.interactables) {
        if (it.type !== 'tea') continue
        const d = Math.hypot(it.x - at.x, it.z - at.z)
        if (d > 60 && d < bd) {
          bd = d
          best = { x: it.x, z: it.z }
        }
      }
      if (best) job = { kind: 'challenge', friend: id, title: `Rohan's chai run (from his favourite stall)`, stage: 0, targets: [{ ...best, label: 'Collect two cutting chais' }, { ...at, label: 'Bring them back hot' }], reward: 300, deadline: t + (bd * 2) / 4.5 + 40, needsVehicle: false }
      break
    }
    case 'testdrive': {
      const a = node(at.x, at.z, 400, 700)
      if (a) job = { kind: 'challenge', friend: id, title: `Meera's test drive: take a car out and bring it back`, stage: 0, targets: [{ ...a, label: 'Drive to the checkpoint' }, { ...at, label: "Return to Meera's garage" }], reward: 1200, deadline: 0, needsVehicle: true }
      break
    }
  }
  if (!job) return 'Could not set that up here — try somewhere else in the city.'
  setRel(id, { challengeDay: today(), lastSeenDay: today() })
  useGame.setState({ job, waypoint: { x: job.targets[0].x, z: job.targets[0].z } })
  return `🏁 Challenge on! ${job.title}`
}

/** called by the mission system when a challenge job completes */
export function challengeDone(id: string) {
  const r = getRel(id)
  setRel(id, { f: r.f + 18 })
  useGame.getState().toast(`🤝 ${personById(id).name} is impressed! Friendship +18`, 'money')
}
