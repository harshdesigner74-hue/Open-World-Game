import { buildOsmCity, type OsmJson } from '../osmCity'
import type { CityData, District } from '../types'

/**
 * NEW DELHI — real 1:1 street network from OpenStreetMap (© OpenStreetMap contributors, ODbL),
 * Connaught Place → Janpath → Kartavya Path & India Gate → New Delhi Railway Station & Paharganj.
 *
 * Neighbourhood zones below are hand-drawn approximations (lat/lon rectangles) used for building
 * style, crowd density and HUD names — they are not official boundaries.
 */
export async function loadDelhi(): Promise<CityData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/delhi.json`)
  if (!res.ok) throw new Error('Missing /data/delhi.json — run `node scripts/osm-import.mjs delhi`')
  const data = (await res.json()) as OsmJson
  const [lat0, lon0] = data.meta.origin
  const MX = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const MZ = 110574
  const ll = (lat: number, lon: number) => ({ x: (lon - lon0) * MX, z: -(lat - lat0) * MZ })
  const toLL = (x: number, z: number) => ({ lat: lat0 - z / MZ, lon: lon0 + x / MX })
  const IG = ll(28.61293, 77.22949)

  type Zone = { d: District; name: string; s: number; w: number; n: number; e: number }
  const zones: Zone[] = [
    { d: 'vista', name: 'Central Vista · Kartavya Path', s: 28.6085, w: 77.203, n: 28.6168, e: 77.236 },
    { d: 'station', name: 'New Delhi Railway Station', s: 28.6385, w: 77.2152, n: 28.6455, e: 77.2255 },
    { d: 'market', name: 'Paharganj', s: 28.6355, w: 77.202, n: 28.648, e: 77.2165 },
    { d: 'market', name: 'Janpath', s: 28.6232, w: 77.2148, n: 28.6298, e: 77.2228 },
    { d: 'government', name: 'Sansad Marg', s: 28.6168, w: 77.205, n: 28.6262, e: 77.2148 },
    { d: 'office', name: 'Mandi House', s: 28.6218, w: 77.2285, n: 28.6345, e: 77.236 },
    { d: 'office', name: 'Barakhamba Road', s: 28.6218, w: 77.2215, n: 28.6385, e: 77.2285 },
    { d: 'lutyens', name: "Lutyens' Delhi", s: 28.606, w: 77.202, n: 28.6262, e: 77.236 },
    { d: 'residential', name: 'Gole Market', s: 28.6262, w: 77.202, n: 28.6355, e: 77.2125 },
    { d: 'residential', name: 'Minto Road', s: 28.6355, w: 77.2165, n: 28.648, e: 77.236 },
  ]
  const zoneAt = (x: number, z: number) => {
    const { lat, lon } = toLL(x, z)
    for (const zn of zones) if (lat >= zn.s && lat <= zn.n && lon >= zn.w && lon <= zn.e) return zn
    return null
  }
  const CP_R = 340
  const districtAt = (x: number, z: number): District => {
    if (Math.hypot(x, z) < CP_R) return 'cp'
    return zoneAt(x, z)?.d ?? 'residential'
  }
  const areaName = (x: number, z: number) => {
    if (Math.hypot(x, z) < CP_R) return 'Connaught Place'
    if (Math.hypot(x - IG.x, z - IG.z) < 260) return 'India Gate'
    return zoneAt(x, z)?.name ?? 'New Delhi'
  }
  const center = (s: number, w: number, n: number, e: number) => ll((s + n) / 2, (w + e) / 2)
  const districtLabels = [
    { text: 'CONNAUGHT PLACE', x: 0, z: -40 },
    ...zones.filter((z) => z.name !== 'Janpath').map((zn) => ({ text: zn.name.toUpperCase(), ...center(zn.s, zn.w, zn.n, zn.e) })),
  ]

  return buildOsmCity(data, {
    seed: 20251110,
    districtAt,
    areaName,
    districtLabels,
    spawn: { x: 0, z: 26, yaw: Math.PI },
    flag: { x: 0, z: 0 },
    customLandmarks: [{ id: 'india_gate', match: /^India Gate$/, radius: 40 }],
    mainStation: { poi: 'New Delhi', sign: 'NEW DELHI  नई दिल्ली' },
    plaques: [
      {
        match: /^India Gate$/,
        title: 'India Gate',
        text: 'The All India War Memorial, designed by Sir Edwin Lutyens and completed in 1931, honours soldiers of the British Indian Army who died in the First World War. It is about 42 m tall. (In-game model is a simplified approximation.)',
      },
      {
        match: /Samrat Yantra/,
        title: 'Jantar Mantar',
        text: 'An astronomical observatory built by Maharaja Jai Singh II of Jaipur in the 1720s. The giant Samrat Yantra is a sundial; the other instruments tracked the sun, moon and planets.',
      },
      {
        match: /Agrasen ki Baoli/,
        title: 'Agrasen ki Baoli',
        text: 'A historic stepwell with over a hundred steps descending to the water level. Its origins are uncertain; the present stone structure is generally dated to the 14th century.',
      },
      {
        match: /Bangla Sahib/,
        title: 'Gurudwara Bangla Sahib',
        text: 'A major Sikh gurudwara associated with the eighth Sikh Guru, Guru Har Krishan. Known for its golden dome, sarovar (holy pond) and community kitchen (langar) open to all.',
      },
      {
        match: /Hanuman Mandir/,
        title: 'Hanuman Mandir',
        text: 'A much-visited Hanuman temple near Connaught Place, on Baba Kharak Singh Marg.',
      },
    ],
    credits: [
      `Map data © OpenStreetMap contributors, ODbL 1.0 (snapshot ${data.meta.osmTimestamp?.slice(0, 10) ?? ''}). Real 1:1 street network & footprints.`,
      'Buildings without OSM footprints, shop signs, NPCs and traffic are procedural/fictional. Flyovers are not modelled yet.',
    ],
  })
}
