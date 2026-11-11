import type { CityData } from '../types'

/**
 * Modular city registry. Adding a city = adding an entry here with a `load()` that returns CityData.
 * Loading is async + code-split so each city's generator is only downloaded when chosen.
 */
export interface CityDefinition {
  id: string
  name: string
  state: string
  tagline: string
  highlights: string[]
  accent: string
  /** development phase in which the city became playable */
  phase: number
  /** map origin (lat, lon) — used for travel distances */
  ll: [number, number]
  area: string
  load?: () => Promise<CityData>
}

export const CITIES: CityDefinition[] = [
  {
    id: 'delhi',
    name: 'New Delhi',
    state: 'Delhi (NCT)',
    tagline: 'Real streets from OpenStreetMap — CP, Paharganj, India Gate',
    highlights: ['Connaught Place & Central Park', 'Janpath & Jantar Mantar', 'Gurudwara Bangla Sahib', 'Kartavya Path & India Gate', 'Agrasen ki Baoli', 'New Delhi Station & Paharganj', "Lutyens' Delhi rotaries", 'Mandi House & Barakhamba'],
    accent: '#ff9933',
    phase: 1,
    ll: [28.63281, 77.21971],
    area: 'Connaught Place, Paharganj, India Gate · 3.3 × 4.6 km',
    load: async () => (await import('./delhi')).loadDelhi(),
  },
  { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra', tagline: 'Marine Drive & the island city', highlights: ['Marine Drive', 'Gateway of India', 'CSMT', 'Colaba Causeway'], accent: '#2fb6d6', phase: 5, ll: [18.9265, 72.8320], area: 'Colaba, Fort & CSMT · 2.9 × 4.3 km', load: async () => (await import('./generic')).loadOsmCity('mumbai') },
  { id: 'bangalore', name: 'Bengaluru', state: 'Karnataka', tagline: 'Garden city, tech city', highlights: ['MG Road', 'Cubbon Park', 'Vidhana Soudha', 'Koramangala cafés'], accent: '#56c271', phase: 5, ll: [12.9752, 77.6010], area: 'MG Road, Cubbon Park, Vidhana Soudha · 3.5 × 2.9 km', load: async () => (await import('./generic')).loadOsmCity('bangalore') },
  { id: 'gwalior', name: 'Gwalior', state: 'Madhya Pradesh', tagline: 'Fort city of central India', highlights: ['Gwalior Fort', 'Jai Vilas Palace', 'Maharaj Bada', 'Sarafa Bazaar'], accent: '#d9a441', phase: 5, ll: [26.2000, 78.1500], area: 'Lashkar & Maharaj Bada · 3.2 × 3.0 km', load: async () => (await import('./generic')).loadOsmCity('gwalior') },
  { id: 'jaipur', name: 'Jaipur', state: 'Rajasthan', tagline: 'The Pink City', highlights: ['Hawa Mahal', 'Johari Bazaar', 'City Palace', 'MI Road'], accent: '#e88aa3', phase: 5, ll: [26.9220, 75.8262], area: 'Walled Pink City · 2.6 × 2.8 km', load: async () => (await import('./generic')).loadOsmCity('jaipur') },
  { id: 'hyderabad', name: 'Hyderabad', state: 'Telangana', tagline: 'Charminar & HITEC City', highlights: ['Charminar', 'Laad Bazaar', 'Hussain Sagar', 'HITEC City'], accent: '#c792ea', phase: 5, ll: [17.3616, 78.4747], area: 'Charminar & the Old City · 2.8 × 2.7 km', load: async () => (await import('./generic')).loadOsmCity('hyderabad') },
  { id: 'kolkata', name: 'Kolkata', state: 'West Bengal', tagline: 'Trams, Howrah & College Street', highlights: ['Howrah Bridge', 'Victoria Memorial', 'Park Street', 'College Street'], accent: '#f2c94c', phase: 5, ll: [22.5520, 88.3505], area: 'Park Street, Maidan, Victoria Memorial · 2.8 × 3.0 km', load: async () => (await import('./generic')).loadOsmCity('kolkata') },
  { id: 'chennai', name: 'Chennai', state: 'Tamil Nadu', tagline: 'Marina Beach & Mylapore', highlights: ['Marina Beach', 'Kapaleeshwarar Temple', 'T. Nagar', 'Central Station'], accent: '#f2994a', phase: 5, ll: [13.0500, 80.2780], area: 'Marina Beach, Chepauk, Mylapore · 3.0 × 4.2 km', load: async () => (await import('./generic')).loadOsmCity('chennai') },
  { id: 'pune', name: 'Pune', state: 'Maharashtra', tagline: 'Peths, forts & FC Road', highlights: ['Shaniwar Wada', 'FC Road', 'Koregaon Park', 'Laxmi Road'], accent: '#6fcf97', phase: 5, ll: [18.5180, 73.8556], area: 'Shaniwar Wada & the peths · 2.7 × 2.8 km', load: async () => (await import('./generic')).loadOsmCity('pune') },
  { id: 'chandigarh', name: 'Chandigarh', state: 'Punjab & Haryana', tagline: 'The planned sector city', highlights: ['Sector 17 Plaza', 'Rock Garden', 'Sukhna Lake', 'Capitol Complex'], accent: '#9ad0f5', phase: 5, ll: [30.7415, 76.7820], area: 'Sector 17 to the Capitol Complex · 3.8 × 3.3 km', load: async () => (await import('./generic')).loadOsmCity('chandigarh') },
]

export const getCity = (id: string) => CITIES.find((c) => c.id === id)
