import { audio } from '../audio/audioEngine'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'

/**
 * Crime & wanted level.
 *  - Knocking someone down with a vehicle is an incident: stop, get out and help (pay the
 *    hospital bill) — or drive off and it becomes a HIT AND RUN (2 stars).
 *  - Hitting a police officer, ramming a police car and witnessed vehicle theft also add stars.
 *  - While wanted, police cars hunt you. Stay out of their sight long enough to lose them;
 *    get caught (a police car or officer next to you while you're slow) and you're BUSTED.
 * Nothing is graphic: people are knocked over, then get up and walk away angry.
 */

export interface Incident {
  x: number
  z: number
  t: number
}

export const MAX_STARS = 5

export const crime = {
  level: 0,
  charges: [] as string[],
  /** game time the police last had eyes on the player */
  lastSeen: 0,
  /** where the police think the player is */
  lastKnown: { x: 0, z: 0 },
  seen: false,
  /** 0..1 — how close the police are to arresting the player */
  bust: 0,
  incidents: [] as Incident[],
  rammedCd: 0,
}

/** seconds out of sight needed to lose the police */
export const evadeTime = (level: number) => 10 + level * 6

export function resetCrime() {
  crime.level = 0
  crime.charges = []
  crime.incidents = []
  crime.bust = 0
  crime.seen = false
  publish()
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(MAX_STARS - n)

/** a crime the police know about: at least +1 star, never below `min` */
export function commitCrime(charge: string, min: number) {
  const before = crime.level
  crime.level = Math.min(MAX_STARS, Math.max(crime.level + 1, min))
  if (!crime.charges.includes(charge)) crime.charges.push(charge)
  crime.lastSeen = runtime.time.elapsed
  const P = runtime.player.pos
  crime.lastKnown = { x: P.x, z: P.z }
  useGame.getState().toast(`🚨 ${charge}! Wanted ${stars(crime.level)}`, 'warn')
  if (crime.level > before) audio.blip(520, 0.07, 0.25)
  publish()
}

/** the player's vehicle knocked someone over */
export function reportHit(x: number, z: number, police: boolean) {
  if (police) {
    commitCrime('Hit a police officer', 3)
    return
  }
  if (crime.level > 0) {
    // already on the run: no chance to make amends
    commitCrime('Hit and run', 2)
    return
  }
  crime.incidents.push({ x, z, t: runtime.time.elapsed })
  useGame.getState().toast('⚠️ You hit someone! Stop and get out to help — or it is a hit-and-run.', 'warn')
}

/** the player pulled a driver out of their vehicle */
export function reportTheft(witnessed: boolean) {
  if (witnessed) commitCrime('Vehicle theft', 1)
}

/** player's car hit a police car */
export function reportRam() {
  if (crime.rammedCd > runtime.time.elapsed) return
  crime.rammedCd = runtime.time.elapsed + 4
  commitCrime('Ramming a police vehicle', 2)
}

/** per-frame bookkeeping for open incidents and evading (called by the police system) */
export function updateCrime(dt: number, policeSees: boolean) {
  const t = runtime.time.elapsed
  const P = runtime.player.pos
  const D = runtime.drive
  const g = useGame.getState()
  // open incidents: help the victim or it's a hit-and-run
  for (let i = crime.incidents.length - 1; i >= 0; i--) {
    const inc = crime.incidents[i]
    const d = Math.hypot(P.x - inc.x, P.z - inc.z)
    if (!D.active && d < 15) {
      crime.incidents.splice(i, 1)
      const bill = 1500
      payFine(bill)
      g.toast(`🩹 You stayed and helped. Paid ₹${bill.toLocaleString('en-IN')} for the hospital bill — no charges.`, 'info')
    } else if (d > 45 || t - inc.t > 25) {
      crime.incidents.splice(i, 1)
      commitCrime('Hit and run', 2)
    }
  }
  if (crime.level === 0) {
    crime.seen = false
    crime.bust = 0
    return
  }
  crime.seen = policeSees
  if (policeSees) {
    crime.lastSeen = t
    crime.lastKnown = { x: P.x, z: P.z }
  } else if (t - crime.lastSeen > evadeTime(crime.level)) {
    crime.level = 0
    crime.charges = []
    crime.bust = 0
    g.toast('😮‍💨 You lost the police. Wanted level cleared.', 'info')
    audio.blip(880, 0.05, 0.2)
  }
  void dt
}

/** take money: cash first, then the bank */
export function payFine(amount: number) {
  const g = useGame.getState()
  const fromCash = Math.min(g.cash, amount)
  const fromBank = Math.min(g.bank, amount - fromCash)
  useGame.setState({ cash: g.cash - fromCash, bank: g.bank - fromBank })
  return fromCash + fromBank
}

/** UI snapshot (throttled by the caller) */
export function publish() {
  const t = runtime.time.elapsed
  const w = crime.level
    ? {
        level: crime.level,
        seen: crime.seen,
        evade: crime.seen ? 0 : Math.min(1, (t - crime.lastSeen) / evadeTime(crime.level)),
        bust: crime.bust,
        charges: crime.charges.slice(),
      }
    : null
  const cur = useGame.getState().wanted
  if (!w && !cur) return
  if (w && cur && w.level === cur.level && w.seen === cur.seen && Math.abs(w.evade - cur.evade) < 0.02 && Math.abs(w.bust - cur.bust) < 0.02 && w.charges.length === cur.charges.length) return
  useGame.setState({ wanted: w })
}
