import type { CityData } from '../world/types'

/**
 * Original cast for friendships and romance. Every character is an adult with likes/dislikes;
 * conversation topics, gifts and date venues carry tags, and the reaction comes from how those
 * tags match the person. Locations are resolved from the live city, so everyone can be met in
 * any of the ten cities.
 */
export type Tag =
  | 'art' | 'food' | 'cricket' | 'music' | 'books' | 'movies' | 'adventure' | 'work' | 'family'
  | 'humour' | 'kindness' | 'honesty' | 'showoff' | 'cheesy' | 'luxury' | 'flowers' | 'sweets'
  | 'walks' | 'fitness' | 'tech' | 'chai' | 'driving' | 'late'

export interface PersonDef {
  id: string
  name: string
  age: number
  female: boolean
  role: string
  romance: boolean
  bio: string
  likes: Tag[]
  dislikes: Tag[]
  /** hours of the day they hang out at their spot */
  hours: [number, number][]
  look: { skin: string; hair: string; top: string; bottom: string; shoes: string; skirt?: string; skirtLen?: number; drape?: string; cap?: string }
  spot: 'landmark' | 'market' | 'park' | 'chai' | 'food' | 'garage'
  /** friendship challenge offered once you are friends */
  challenge?: 'race' | 'delivery' | 'chairun' | 'testdrive'
}

export const PEOPLE: PersonDef[] = [
  {
    id: 'ananya', name: 'Ananya', age: 26, female: true, role: 'Architect', romance: true,
    bio: 'Sketches old buildings on weekends and drinks far too much chai.',
    likes: ['art', 'chai', 'honesty', 'books', 'walks'], dislikes: ['showoff', 'cheesy', 'driving'],
    hours: [[9, 20]], spot: 'landmark',
    look: { skin: '#b9835b', hair: '#1a1410', top: '#f3d6dc', bottom: '#2f4a6d', shoes: '#e9e5dc', skirt: '#f3d6dc', skirtLen: 0.55, drape: '#d63384' },
  },
  {
    id: 'zoya', name: 'Zoya', age: 25, female: true, role: 'Journalist', romance: true,
    bio: 'Chases stories across the city on a scooter. Knows every street-food stall by name.',
    likes: ['food', 'adventure', 'humour', 'movies', 'driving'], dislikes: ['late', 'cheesy', 'luxury'],
    hours: [[11, 23]], spot: 'food',
    look: { skin: '#a8714c', hair: '#141110', top: '#1f2a36', bottom: '#3a5a80', shoes: '#1a1a1a' },
  },
  {
    id: 'ishita', name: 'Ishita', age: 27, female: true, role: 'Doctor', romance: true,
    bio: 'Works night shifts at the city hospital, unwinds with music and evening walks.',
    likes: ['kindness', 'music', 'flowers', 'walks', 'family'], dislikes: ['showoff', 'driving', 'sweets'],
    hours: [[7, 11], [17, 22]], spot: 'park',
    look: { skin: '#c69373', hair: '#20160f', top: '#ffffff', bottom: '#5a5048', shoes: '#3b2a1e', skirt: '#0b7a75', skirtLen: 1, drape: '#0b7a75' },
  },
  {
    id: 'vikram', name: 'Vikram', age: 28, female: false, role: 'Chef', romance: true,
    bio: 'Runs a tiny kitchen that is always full. Talks about food like it is poetry.',
    likes: ['food', 'music', 'cricket', 'humour', 'honesty'], dislikes: ['showoff', 'late', 'tech'],
    hours: [[12, 23]], spot: 'market',
    look: { skin: '#8d5a3b', hair: '#141110', top: '#f2f2ee', bottom: '#1f2329', shoes: '#1a1a1a' },
  },
  {
    id: 'rohan', name: 'Rohan', age: 27, female: false, role: 'Your cousin', romance: false,
    bio: 'Knows everyone, owes everyone, somehow always has a plan.',
    likes: ['chai', 'cricket', 'humour', 'family'], dislikes: ['late', 'showoff'],
    hours: [[0, 24]], spot: 'chai', challenge: 'chairun',
    look: { skin: '#a8714c', hair: '#1a1410', top: '#c0392b', bottom: '#2f4a6d', shoes: '#e9e5dc' },
  },
  {
    id: 'meera', name: 'Meera', age: 29, female: true, role: 'Mechanic', romance: false,
    bio: 'Can hear what is wrong with an engine from across the street.',
    likes: ['driving', 'tech', 'honesty', 'chai'], dislikes: ['cheesy', 'showoff'],
    hours: [[0, 24]], spot: 'garage', challenge: 'testdrive',
    look: { skin: '#8d5a3b', hair: '#141110', top: '#2f4f6b', bottom: '#2f4f6b', shoes: '#1a1a1a', cap: '#c0392b' },
  },
  {
    id: 'arjun', name: 'Arjun', age: 26, female: false, role: 'College friend', romance: false,
    bio: 'Gym in the morning, gully cricket in the evening, never stops talking about either.',
    likes: ['cricket', 'fitness', 'adventure', 'humour'], dislikes: ['books', 'late'],
    hours: [[6, 10], [16, 21]], spot: 'park', challenge: 'race',
    look: { skin: '#7d4f36', hair: '#1a1410', top: '#27ae60', bottom: '#1f2329', shoes: '#e9e5dc' },
  },
  {
    id: 'kabir', name: 'Kabir', age: 25, female: false, role: 'DJ', romance: false,
    bio: 'Plays weddings by night, makes beats on his phone by day.',
    likes: ['music', 'movies', 'tech', 'humour'], dislikes: ['honesty', 'walks'],
    hours: [[0, 2], [14, 24]], spot: 'market', challenge: 'delivery',
    look: { skin: '#b9835b', hair: '#2b1d14', top: '#8e44ad', bottom: '#22344d', shoes: '#1a1a1a', cap: '#111111' },
  },
]
export const personById = (id: string) => PEOPLE.find((p) => p.id === id)!

/* ---------------------------------------------------------------- conversation */
export interface Topic {
  id: string
  label: string
  tags: Tag[]
}
export const TOPICS: Topic[] = [
  { id: 'art', label: 'Ask about the old buildings around here', tags: ['art', 'walks'] },
  { id: 'food', label: 'Argue about the best street food in the city', tags: ['food'] },
  { id: 'cricket', label: "Talk about last night's match", tags: ['cricket'] },
  { id: 'music', label: 'Share a song you have on repeat', tags: ['music'] },
  { id: 'books', label: 'Ask what they are reading', tags: ['books'] },
  { id: 'movies', label: 'Debate the best Bollywood movie ever', tags: ['movies'] },
  { id: 'adventure', label: 'Suggest a spontaneous trip to the hills', tags: ['adventure', 'driving'] },
  { id: 'work', label: 'Ask how their work is going — and actually listen', tags: ['work', 'kindness'] },
  { id: 'family', label: 'Talk about your family back home', tags: ['family', 'honesty'] },
  { id: 'joke', label: 'Crack a silly joke', tags: ['humour'] },
  { id: 'honest', label: 'Admit you are still figuring life out', tags: ['honesty'] },
  { id: 'brag', label: 'Mention your bank balance (casually)', tags: ['showoff', 'luxury'] },
  { id: 'cheesy', label: 'Try a filmy pickup line', tags: ['cheesy'] },
  { id: 'chai', label: 'Offer to get two cutting chais', tags: ['chai', 'kindness'] },
  { id: 'fitness', label: 'Challenge them to a morning run', tags: ['fitness'] },
  { id: 'tech', label: 'Show them a cool new phone app', tags: ['tech'] },
]

export type Reaction = 'love' | 'like' | 'meh' | 'dislike'
export function reactTo(p: PersonDef, tags: Tag[]): Reaction {
  if (tags.some((t) => p.dislikes.includes(t))) return 'dislike'
  const hits = tags.filter((t) => p.likes.includes(t)).length
  return hits >= 2 ? 'love' : hits === 1 ? 'like' : 'meh'
}
export const REACT_POINTS: Record<Reaction, number> = { love: 10, like: 6, meh: 1, dislike: -7 }

const LINES: Record<Reaction, string[]> = {
  love: ['Okay, now you are speaking my language!', 'I could talk about this all day. Seriously.', 'See, this is why I like hanging out with you.'],
  like: ['Ha, yes! Good one.', 'That is actually really sweet.', 'Tell me more.'],
  meh: ['Hmm, okay.', 'Interesting… I guess.', 'Sure, sure.'],
  dislike: ['Ugh. Really?', 'That is… not my thing at all.', 'Let us change the topic, please.'],
}
export const replyLine = (r: Reaction, seed: number) => LINES[r][Math.abs(seed) % LINES[r].length]

/* ---------------------------------------------------------------- gifts */
export interface Gift {
  id: string
  label: string
  price: number
  tags: Tag[]
}
export const GIFTS: Gift[] = [
  { id: 'flowers', label: '💐 Bouquet of roses', price: 250, tags: ['flowers', 'kindness'] },
  { id: 'chocolates', label: '🍫 Box of chocolates', price: 180, tags: ['sweets'] },
  { id: 'book', label: '📚 A novel you loved', price: 350, tags: ['books'] },
  { id: 'tickets', label: '🎟️ Concert tickets', price: 1200, tags: ['music'] },
  { id: 'bat', label: '🏏 Signed cricket bat', price: 2000, tags: ['cricket'] },
  { id: 'sketchbook', label: '🎨 Sketchbook & pens', price: 600, tags: ['art'] },
  { id: 'perfume', label: '🌸 Perfume', price: 1800, tags: ['luxury'] },
  { id: 'earrings', label: '💎 Gold earrings', price: 9000, tags: ['luxury', 'kindness'] },
]

/* ---------------------------------------------------------------- dates */
export interface Venue {
  id: string
  label: string
  price: number
  hours: number
  tags: Tag[]
  needsVehicle?: boolean
  where: 'landmark' | 'food' | 'market'
}
export const VENUES: Venue[] = [
  { id: 'streetfood', label: '🥘 Street-food crawl', price: 300, hours: 2, tags: ['food', 'adventure'], where: 'food' },
  { id: 'walk', label: '🌇 Sunset walk at a landmark', price: 0, hours: 2, tags: ['walks', 'art'], where: 'landmark' },
  { id: 'movie', label: '🎬 Movie night', price: 700, hours: 3, tags: ['movies'], where: 'market' },
  { id: 'dinner', label: '🕯️ Candle-light dinner', price: 3000, hours: 3, tags: ['luxury', 'food'], where: 'market' },
  { id: 'concert', label: '🎶 Live music gig', price: 1500, hours: 3, tags: ['music'], where: 'market' },
  { id: 'drive', label: '🚗 Late-night long drive', price: 0, hours: 2, tags: ['adventure', 'driving'], needsVehicle: true, where: 'landmark' },
]

/** three conversation beats during a date; each choice carries tags */
export const DATE_BEATS: { prompt: string; choices: { text: string; tags: Tag[] }[] }[] = [
  {
    prompt: 'You both sit down. There is a small, slightly awkward silence…',
    choices: [
      { text: 'Tell a funny story from your first week in the city', tags: ['humour'] },
      { text: 'Ask what made them smile today', tags: ['kindness'] },
      { text: 'Talk about the expensive watch you are planning to buy', tags: ['showoff'] },
    ],
  },
  {
    prompt: 'They ask: "So what do you actually want from life?"',
    choices: [
      { text: '"Honestly? I am still figuring it out — but I am enjoying the ride."', tags: ['honesty'] },
      { text: '"To see every corner of this country."', tags: ['adventure'] },
      { text: '"You. Obviously." (wink)', tags: ['cheesy'] },
    ],
  },
  {
    prompt: 'The evening is winding down. The city lights are coming on.',
    choices: [
      { text: 'Offer to walk them home', tags: ['kindness', 'walks'] },
      { text: 'Suggest one more round of chai', tags: ['chai', 'food'] },
      { text: 'Check the cricket score on your phone', tags: ['cricket'] },
    ],
  },
]

/* ---------------------------------------------------------------- where they hang out */
const cache = new Map<string, { x: number; z: number }>()
export function personSpot(city: CityData, p: PersonDef): { x: number; z: number } {
  const key = city.id + ':' + p.id
  const hit = cache.get(key)
  if (hit) return hit
  const S = city.spawn
  const B = city.bounds
  const inside = (x: number, z: number) => x > B.minX + 60 && x < B.maxX - 60 && z > B.minZ + 60 && z < B.maxZ - 60
  const seed = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0)
  const ring = (min: number, max: number) => (x: number, z: number) => {
    const d = Math.hypot(x - S.x, z - S.z)
    return d >= min && d <= max && inside(x, z)
  }
  const pickFrom = (list: { x: number; z: number }[]) => (list.length ? list[seed % list.length] : null)
  let at: { x: number; z: number } | null = null
  const near = ring(120, 900)
  switch (p.spot) {
    case 'landmark':
      at = pickFrom(city.landmarks.filter((l) => l.category === 'monument' || l.category === 'park').filter((l) => near(l.x, l.z)))
      if (at) at = { x: at.x + 6, z: at.z + 6 }
      break
    case 'park':
      at = pickFrom(city.landmarks.filter((l) => l.category === 'park').filter((l) => near(l.x, l.z)))
      if (at) at = { x: at.x + 4, z: at.z - 5 }
      break
    case 'market':
      at = pickFrom(city.landmarks.filter((l) => l.category === 'market').filter((l) => near(l.x, l.z)))
      if (at) at = { x: at.x - 5, z: at.z + 4 }
      break
    case 'food':
    case 'chai': {
      const t = p.spot === 'chai' ? ['tea'] : ['food', 'fruit']
      at = pickFrom(city.interactables.filter((i) => t.includes(i.type) && near(i.x, i.z)))
      if (at) at = { x: at.x + 2, z: at.z + 1.6 }
      break
    }
    case 'garage': {
      at = pickFrom(city.interactables.filter((i) => i.type === 'fuel' && near(i.x, i.z)))
      if (at) at = { x: at.x + 3, z: at.z + 3 }
      break
    }
  }
  if (!at) {
    // fallback: a road node in a ring around the spawn
    const g = city.graph
    for (let k = 0; k < g.x.length; k++) {
      const i = (k * 7919 + seed * 131) % g.x.length
      if (ring(200, 700)(g.x[i], g.z[i]) && g.adj[i].length > 1) {
        at = { x: g.x[i], z: g.z[i] }
        break
      }
    }
  }
  at ??= { x: S.x + 20, z: S.z + 20 }
  // people who share a park/market stand apart, each in their own corner
  const ang = (seed * 2.399) % (Math.PI * 2)
  at = { x: at.x + Math.cos(ang) * 9, z: at.z + Math.sin(ang) * 9 }
  cache.set(key, at)
  return at
}

export const presentAt = (p: PersonDef, hour: number) => p.hours.some(([a, b]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b))
