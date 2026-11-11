import { buildOsmCity, type OsmCityConfig, type OsmJson } from '../osmCity'
import type { CityData } from '../types'

/** Per-city flavour on top of the generic OpenStreetMap builder. */
export type CityFlavour = Omit<OsmCityConfig, 'credits' | 'seed'> & { seed?: number }

export const FLAVOURS: Record<string, CityFlavour> = {
  mumbai: {
    centreRadius: 600,
    tropical: true,
    palette: {
      market: ['#efe6cf', '#e8d9b0', '#d9c6a0', '#c9b79a', '#e6c9a8', '#b8c4b0', '#f1e3c6'],
      residential: ['#efe6cf', '#e3d2b2', '#d6c3a0', '#c7d0c4', '#e8d8c0', '#f0e8da'],
      government: ['#c9b48a', '#bfa780', '#d6c4a0'],
    },
    customLandmarks: [{ id: 'gateway', match: /^Gateway of India$/, radius: 30 }],
    domed: /Chhatrapati Shivaji Maharaj Terminus|Municipal Corporation|Taj Mahal Palace/i,
    mainStation: { poi: 'Chhatrapati Shivaji Maharaj Terminus', sign: 'CSMT  छत्रपती शिवाजी महाराज टर्मिनस' },
    plaques: [
      { match: /^Gateway of India$/, title: 'Gateway of India', text: 'A basalt arch on the Apollo Bunder waterfront built to commemorate the 1911 visit of King George V and Queen Mary; completed in 1924.' },
      { match: /Chhatrapati Shivaji Maharaj Terminus/, title: 'Chhatrapati Shivaji Maharaj Terminus', text: 'A Victorian Gothic Revival railway terminus completed in 1888 and a UNESCO World Heritage Site since 2004.' },
    ],
  },
  bangalore: {
    centreRadius: 500,
    domed: /Vidhana Soudha/i,
    plaques: [{ match: /Vidhana Soudha/, title: 'Vidhana Soudha', text: 'Seat of the Karnataka state legislature, completed in 1956 in the Neo-Dravidian style.' }],
  },
  gwalior: {
    centreRadius: 700,
    palette: { market: ['#e9d9b5', '#e3c48e', '#d9b07a', '#f0e2c4', '#c9d3b0', '#e8c2a8'] },
    plaques: [{ match: /Moti Mahal|Scindia Museum/i, title: 'Lashkar, Gwalior', text: 'The old Scindia capital of Lashkar grew around Maharaj Bada market square. Gwalior Fort stands on a hill north of this area (not part of the playable map yet).' }],
  },
  jaipur: {
    centreRadius: 1200,
    palette: {
      market: ['#e8a08a', '#df8f78', '#eaa992', '#d98b73', '#e59c84'],
      residential: ['#e8a08a', '#df8f78', '#eaa992', '#e7b39f', '#d98b73'],
      colonial: ['#e8a08a', '#df8f78'],
    },
    customLandmarks: [{ id: 'hawa_mahal', match: /^Hawa Mahal$/, radius: 30 }],
    plaques: [
      { match: /^Hawa Mahal$/, title: 'Hawa Mahal', text: 'The “Palace of Winds”, built in 1799 by Maharaja Sawai Pratap Singh, with 953 small windows (jharokhas) that let royal women watch the street unseen.' },
      { match: /^City Palace$/, title: 'City Palace', text: 'The royal palace complex at the heart of the walled Pink City, founded by Maharaja Sawai Jai Singh II.' },
    ],
  },
  hyderabad: {
    centreRadius: 600,
    customLandmarks: [{ id: 'charminar', match: /^Charminar$/, radius: 22 }],
    plaques: [
      { match: /^Charminar$/, title: 'Charminar', text: 'Built in 1591 by Sultan Muhammad Quli Qutb Shah; its four minarets rise about 56 m.' },
      { match: /Mecca Masjid/, title: 'Mecca Masjid', text: 'One of the largest mosques in India; construction began in 1617.' },
    ],
  },
  kolkata: {
    centreRadius: 500,
    palette: { market: ['#d9a07a', '#c98a66', '#e2c29a', '#b85c4a', '#e8d4b0'], residential: ['#d9a07a', '#e2c29a', '#e8d4b0', '#c98a66', '#d0b8a0'] },
    customLandmarks: [{ id: 'victoria_memorial', match: /^Victoria Memorial$/, radius: 60 }],
    plaques: [{ match: /^Victoria Memorial$/, title: 'Victoria Memorial', text: 'A white Makrana marble memorial completed in 1921, now a museum, set in large gardens beside the Maidan.' }],
  },
  chennai: {
    centreRadius: 500,
    tropical: true,
    customLandmarks: [{ id: 'lighthouse', match: /Chennai Marina Lighthouse/, radius: 40 }],
    domed: /Chepauk Palace/i,
    plaques: [
      { match: /Chennai Marina Lighthouse/, title: 'Marina Beach & Lighthouse', text: 'Marina Beach is one of the longest urban beaches in the world; the lighthouse overlooks it.' },
      { match: /Chepauk Palace/, title: 'Chepauk Palace', text: 'Former residence of the Nawabs of Arcot, an early example of Indo-Saracenic architecture.' },
    ],
  },
  pune: {
    centreRadius: 600,
    plaques: [
      { match: /^Shaniwar Wada$/, title: 'Shaniwar Wada', text: 'A fortified palace completed in 1732 as the seat of the Peshwas of the Maratha Empire.' },
      { match: /Dagdusheth/, title: 'Dagdusheth Halwai Ganpati', text: 'A famous Ganesh temple in central Pune, especially crowded during Ganeshotsav.' },
    ],
  },
  chandigarh: {
    centreRadius: 400,
    palette: {
      market: ['#b9b4aa', '#a8a39a', '#c6c0b4', '#a5654a', '#b77457'],
      residential: ['#b9b4aa', '#c6c0b4', '#a5654a', '#b77457', '#d0cbc0'],
      office: ['#b9b4aa', '#a8a39a', '#c6c0b4'],
    },
    plaques: [
      { match: /Punjab and Haryana High Court/, title: 'Capitol Complex', text: 'Part of Le Corbusier’s Capitol Complex, inscribed as a UNESCO World Heritage Site in 2016.' },
      { match: /^Rock Garden$/, title: 'Rock Garden', text: 'A sculpture garden built from recycled materials by Nek Chand, begun secretly in the 1950s.' },
    ],
  },
}

export async function loadOsmCity(id: string): Promise<CityData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${id}.json`)
  if (!res.ok) throw new Error(`Missing /data/${id}.json — run \`node scripts/osm-import.mjs ${id} --fetch\``)
  const data = (await res.json()) as OsmJson
  const f = FLAVOURS[id] ?? { plaques: [] }
  return buildOsmCity(data, {
    seed: f.seed ?? id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0,
    ...f,
    credits: [
      `Map data © OpenStreetMap contributors, ODbL 1.0 (snapshot ${data.meta.osmTimestamp?.slice(0, 10) ?? ''}). Real 1:1 streets & footprints.`,
      'Neighbourhood zoning from OSM land use. Buildings without OSM footprints, shop signs, NPCs and traffic are procedural/fictional.',
    ],
  })
}
