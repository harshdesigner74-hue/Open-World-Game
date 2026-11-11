import { audio } from '../audio/audioEngine'
import { useGame } from '../state/store'

export * from './types'
import type { Progress } from './types'

export const ACHIEVEMENTS: Record<string, { title: string; desc: string; reward: number }> = {
  first_ride: { title: 'Pehli Sawari', desc: 'Drive or ride a vehicle for the first time', reward: 200 },
  chai_lover: { title: 'Chai Lover', desc: 'Drink 5 cups of cutting chai', reward: 150 },
  explorer: { title: 'Explorer', desc: 'Visit 5 landmarks', reward: 500 },
  globetrotter: { title: 'Bharat Darshan', desc: 'Visit 5 different cities', reward: 2000 },
  diya_hunter: { title: 'Diya Hunter', desc: 'Find every Golden Diya in a city', reward: 1500 },
  hard_worker: { title: 'Mehnati', desc: 'Complete 10 jobs', reward: 1000 },
  lakhpati: { title: 'Lakhpati', desc: 'Have ₹1,00,000 in cash and bank', reward: 0 },
  yaari: { title: 'Yaari Dosti', desc: 'Become close friends with someone', reward: 500 },
  first_date: { title: 'Pehli Date', desc: 'Go on your first date', reward: 300 },
  couple: { title: 'Officially Official', desc: 'Start a relationship', reward: 1000 },
  engaged: { title: 'Rishta Pakka', desc: 'Get engaged', reward: 2000 },
  married: { title: 'Shaadi Mubarak', desc: 'Get married', reward: 10000 },
  owner: { title: 'Gaadi Wala', desc: 'Buy your own vehicle', reward: 0 },
  stylish: { title: 'Fashionable', desc: 'Buy a new outfit style', reward: 100 },
}

export function unlock(id: string) {
  const g = useGame.getState()
  if (g.progress.achievements.includes(id)) return
  const a = ACHIEVEMENTS[id]
  if (!a) return
  useGame.setState({ progress: { ...g.progress, achievements: [...g.progress.achievements, id] }, bank: g.bank + a.reward })
  g.toast(`🏆 ${a.title} — ${a.desc}${a.reward ? ` (+₹${a.reward} to bank)` : ''}`, 'money')
  audio.cash()
}

export function bump(patch: (p: Progress) => Partial<Progress>) {
  const g = useGame.getState()
  const p = { ...g.progress, ...patch(g.progress) }
  useGame.setState({ progress: p })
  if (p.chai >= 5) unlock('chai_lover')
  if (p.rides >= 1) unlock('first_ride')
  if (p.landmarks.length >= 5) unlock('explorer')
  if (p.cities.length >= 5) unlock('globetrotter')
  if (p.jobsDone >= 10) unlock('hard_worker')
  if (p.vehicles.length >= 1) unlock('owner')
  if (p.ownedStyles.length >= 2) unlock('stylish')
}
