#!/usr/bin/env node
/**
 * OpenStreetMap → game data importer.
 *
 *   node scripts/osm-import.mjs delhi            # uses data/osm/delhi-raw.json (cached)
 *   node scripts/osm-import.mjs delhi --fetch    # (re)downloads from the Overpass API first
 *
 * Output: public/data/<city>.json — compact, projected to local metres (+X east, -Z north),
 * real 1:1 scale. Data © OpenStreetMap contributors, available under the ODbL 1.0.
 *
 * Privacy/IP policy applied here:
 *  - Real names are kept only for roads, transit, landmarks, places of worship, parks & markets.
 *  - Names of shops, restaurants, hotels etc. are dropped (they become generic in-game).
 *  - Anything carrying a `brand` tag is treated as generic (no trademarks in the game).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CITIES } from './cities.mjs'

const cityId = process.argv[2] || 'delhi'
const cfg = CITIES[cityId]
if (!cfg) throw new Error('Unknown city ' + cityId)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawPath = path.join(root, 'data/osm', `${cityId}-raw.json`)

if (process.argv.includes('--fetch')) {
  const B = cfg.bbox.join(',')
  const q = `[out:json][timeout:170];(way["highway"](${B});way["building"](${B});relation["building"](${B});way["leisure"~"^(park|garden|playground|pitch|stadium)$"](${B});relation["leisure"~"^(park|garden)$"](${B});way["landuse"~"^(grass|recreation_ground|village_green|forest|meadow|railway)$"](${B});way["natural"="water"](${B});relation["natural"="water"](${B});way["water"](${B});node["highway"~"^(traffic_signals|bus_stop|crossing)$"](${B});node["amenity"](${B});node["shop"](${B});node["tourism"](${B});node["historic"](${B});way["amenity"~"^(place_of_worship|parking|fuel|hospital|school|college|university|marketplace)$"](${B});way["tourism"](${B});way["historic"](${B});way["railway"~"^(rail|platform)$"](${B});node["railway"~"^(station|subway_entrance)$"](${B});way["man_made"](${B});way["natural"="coastline"](${B});way["natural"="bay"](${B});way["natural"~"^(beach|sand)$"](${B});relation["natural"="bay"](${B});way["landuse"~"^(commercial|retail|residential|industrial)$"](${B});node["place"~"^(suburb|neighbourhood|quarter|locality)$"](${B}););out body geom;`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'india-open-world-importer/0.2' },
    body: 'data=' + encodeURIComponent(q),
  })
  if (!res.ok) throw new Error('Overpass error ' + res.status + ' ' + (await res.text()).slice(0, 200))
  fs.mkdirSync(path.dirname(rawPath), { recursive: true })
  fs.writeFileSync(rawPath, await res.text())
  console.log('fetched', rawPath)
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
const [lat0, lon0] = cfg.origin
const MX = 111320 * Math.cos((lat0 * Math.PI) / 180)
const MZ = 110574
const r1 = (v) => Math.round(v * 10) / 10
/** prefer English names where mappers provided them */
const nm = (t) => (t['name:en'] || t.name || '').replace(/\s+-\s+[^\x00-\x7F].*$/, '').trim()
const proj = (lat, lon) => [r1((lon - lon0) * MX), r1(-(lat - lat0) * MZ)]
const [S, W, N, E] = cfg.bbox
const [minX, maxZ] = proj(S, W)
const [maxX, minZ] = proj(N, E)
const bounds = { minX, maxX, minZ, maxZ }
const inside = ([x, z], m = 0) => x >= minX - m && x <= maxX + m && z >= minZ - m && z <= maxZ + m

/* ------------------------------------------------------------------ roads */
const CLASS = {
  trunk: { w: 20, car: true },
  trunk_link: { w: 8, car: true },
  primary: { w: 16, car: true },
  primary_link: { w: 7, car: true },
  secondary: { w: 14, car: true },
  secondary_link: { w: 7, car: true },
  tertiary: { w: 11, car: true },
  tertiary_link: { w: 6.5, car: true },
  unclassified: { w: 8, car: true },
  residential: { w: 8, car: true },
  living_street: { w: 6, car: false },
  service: { w: 5, car: false },
  pedestrian: { w: 6, car: false },
}
const nodeUse = new Map()
const roadWays = []
/** flyovers / bridges (bridge=* or layer>=1): kept with a per-point height profile */
const elevWays = []
const footWays = []
let skippedBridges = 0
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.tags?.highway || !e.geometry) continue
  const t = e.tags
  const c = CLASS[t.highway]
  if (!c) continue
  if (t.area === 'yes') continue // handled as plaza areas below
  if (t.tunnel && t.tunnel !== 'no') continue
  const elevated = (t.bridge && t.bridge !== 'no') || Number(t.layer) >= 1
  if (elevated && t.highway === 'pedestrian') {
    skippedBridges++
    continue
  }
  if (t.highway === 'service' && /^(parking_aisle|drive-through)$/.test(t.service || '')) continue
  const pts = e.geometry.map((g) => proj(g.lat, g.lon))
  if (!pts.some((p) => inside(p, 50))) continue
  if (t.highway === 'pedestrian') {
    footWays.push({ name: nm(t), pts })
    continue
  }
  const oneway = t.oneway === 'yes' || t.junction === 'roundabout' || t.junction === 'circular'
  const lanes = Number.parseInt(t.lanes || '', 10)
  let w = c.w
  if (lanes > 0) w = Math.max(5.5, lanes * 3.3 + (oneway ? 1 : 1.5))
  if (oneway && !lanes) w = Math.max(5.5, c.w * 0.62)
  // small bridges over drains/nallahs on lanes stay at grade (only arterials or long spans are raised)
  let span = 0
  for (let i = 1; i < pts.length; i++) span += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  const raised = elevated && (/^(trunk|primary|secondary|tertiary)/.test(t.highway) || span > 120)
  ;(raised ? elevWays : roadWays).push({
    id: e.id, nodes: e.nodes, pts, name: nm(t), cls: t.highway, w: r1(w), oneway,
    car: c.car && t.access !== 'no' && t.motor_vehicle !== 'no', roundabout: t.junction === 'roundabout',
    layer: Math.max(1, Number.parseInt(t.layer || '1', 10) || 1),
  })
  e.nodes.forEach((n, i) => nodeUse.set(n, (nodeUse.get(n) || 0) + (i === 0 || i === e.nodes.length - 1 ? 2 : 1)))
}
// Flyover approach ramps: OSM tags only the raised deck as bridge=*; the ramps are ordinary
// ways that continue straight on from the deck ends. Pull those continuations (≤ 2 ways,
// ≤ 260 m) into the elevated set so the deck can climb out of the ground along them.
{
  const byNode = new Map()
  for (const w of roadWays) for (let i = 0; i < w.nodes.length; i++) {
    const n = w.nodes[i]
    if (!byNode.has(n)) byNode.set(n, [])
    byNode.get(n).push(w)
  }
  const wlen = (w) => { let l = 0; for (let i = 1; i < w.pts.length; i++) l += Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]); return l }
  /** unit direction leaving node index i of way w (towards the rest of the way) */
  const away = (w, i) => {
    const j = i === 0 ? 1 : i - 1
    const dx = w.pts[j][0] - w.pts[i][0], dz = w.pts[j][1] - w.pts[i][1], l = Math.hypot(dx, dz) || 1
    return [dx / l, dz / l]
  }
  const moved = new Set()
  let frontier = elevWays.map((w) => ({ w, depth: 0, used: 0, layer: w.layer }))
  while (frontier.length) {
    const next = []
    for (const f of frontier) {
      const w = f.w
      for (const end of [0, w.nodes.length - 1]) {
        const n = w.nodes[end]
        const [ox, oz] = away(w, end) // pointing back into w; continuation leaves the opposite way
        for (const g of byNode.get(n) || []) {
          if (moved.has(g) || !g.car || g.roundabout) continue
          const gi = g.nodes[0] === n ? 0 : g.nodes.at(-1) === n ? g.nodes.length - 1 : -1
          if (gi < 0) continue
          const [gx, gz] = away(g, gi)
          if (gx * ox + gz * oz > -0.82) continue // must continue roughly straight on
          const L = wlen(g)
          if (f.used + L > 260 || L > 260) continue
          moved.add(g)
          g.layer = f.layer
          g.ramp = true
          if (f.depth < 1) next.push({ w: g, depth: f.depth + 1, used: f.used + L, layer: f.layer })
        }
      }
    }
    frontier = next
  }
  for (let i = roadWays.length - 1; i >= 0; i--) if (moved.has(roadWays[i])) elevWays.push(...roadWays.splice(i, 1))
  console.log('flyover ramps pulled from ground ways:', moved.size)
}
// split ways into edges between junction nodes
const nodeIndex = new Map()
const gNodes = []
const nid = (osmId, p) => {
  let i = nodeIndex.get(osmId)
  if (i === undefined) {
    i = gNodes.length
    nodeIndex.set(osmId, i)
    gNodes.push(p)
  }
  return i
}
const edges = []
for (const w of roadWays) {
  let start = 0
  for (let i = 1; i < w.nodes.length; i++) {
    if ((nodeUse.get(w.nodes[i]) || 0) >= 2 || i === w.nodes.length - 1) {
      const pts = w.pts.slice(start, i + 1)
      // drop near-duplicate points
      const clean = [pts[0]]
      for (const p of pts.slice(1)) if (Math.hypot(p[0] - clean.at(-1)[0], p[1] - clean.at(-1)[1]) > 0.5) clean.push(p)
      if (clean.length >= 2)
        edges.push({
          a: nid(w.nodes[start], w.pts[start]), b: nid(w.nodes[i], w.pts[i]), pts: clean.flat(), name: w.name, cls: w.cls, w: w.w,
          oneway: w.oneway, car: w.car, ra: w.roundabout ? 1 : 0,
        })
      start = i
    }
  }
}

/* ------------------------------------------------------------ flyovers */
// Height profile: nodes shared with a ground road are at grade (anchors); elsewhere the deck
// rises with the along-road distance from the nearest anchor (smoothstep ramp ~110 m) up to
// the clearance for its OSM layer. Unanchored decks (e.g. running off the map) stay at full height.
const SLOPE = 0.07
const deckH = (layer) => (layer >= 2 ? 13 : 7.5)
const groundNodes = new Set()
for (const w of roadWays) for (const n of w.nodes) groundNodes.add(n)
const eAdj = new Map()
const hMax = new Map()
for (const w of elevWays) {
  for (let i = 0; i < w.nodes.length; i++) {
    const n = w.nodes[i]
    hMax.set(n, Math.max(hMax.get(n) || 0, deckH(w.layer)))
    if (!eAdj.has(n)) eAdj.set(n, [])
    if (i > 0) {
      const d = Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1])
      eAdj.get(n).push([w.nodes[i - 1], d])
      eAdj.get(w.nodes[i - 1]).push([n, d])
    }
  }
}
const dist = new Map()
{
  // multi-source Dijkstra (graphs are tiny; a sorted array queue is fine)
  const q = []
  for (const n of eAdj.keys()) if (groundNodes.has(n)) { dist.set(n, 0); q.push([0, n]) }
  while (q.length) {
    q.sort((a, b) => b[0] - a[0])
    const [d, n] = q.pop()
    if (d > dist.get(n)) continue
    for (const [m, l] of eAdj.get(n)) {
      const nd = d + l
      if (nd < (dist.get(m) ?? Infinity)) { dist.set(m, nd); q.push([nd, m]) }
    }
  }
}
const nodeH = (n) => {
  const H = hMax.get(n) || 7.5
  const d = dist.get(n)
  if (d === undefined) return H
  const t = Math.min(1, (d * SLOPE) / H)
  return r1(H * t * t * (3 - 2 * t))
}
const elev = []
let elevLen = 0
for (const w of elevWays) {
  if (!w.pts.some((p) => inside(p, 50))) continue
  let start = 0
  for (let i = 1; i < w.nodes.length; i++) {
    if ((nodeUse.get(w.nodes[i]) || 0) >= 2 || i === w.nodes.length - 1) {
      const pts = [w.pts[start]], hs = [nodeH(w.nodes[start])]
      for (let k = start + 1; k <= i; k++) {
        if (Math.hypot(w.pts[k][0] - pts.at(-1)[0], w.pts[k][1] - pts.at(-1)[1]) <= 0.5 && k < i) continue
        pts.push(w.pts[k]); hs.push(nodeH(w.nodes[k]))
      }
      // densify long segments so the ramp profile is smooth (≤ 12 m between samples)
      const P = [pts[0]], Hs = [hs[0]]
      for (let k = 1; k < pts.length; k++) {
        const L = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
        const n = Math.ceil(L / 12)
        for (let j = 1; j <= n; j++) {
          const f = j / n
          P.push([r1(pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f), r1(pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f)])
          Hs.push(r1(hs[k - 1] + (hs[k] - hs[k - 1]) * f))
        }
        elevLen += L
      }
      if (P.length >= 2)
        elev.push({
          a: nid(w.nodes[start], w.pts[start]), b: nid(w.nodes[i], w.pts[i]), pts: P.flat(), h: Hs, name: w.name, cls: w.cls, w: w.w,
          oneway: w.oneway, car: w.car, ra: 0,
        })
      start = i
    }
  }
}
console.log(`flyovers: ${elevWays.length} ways → ${elev.length} edges, ${(elevLen / 1000).toFixed(1)} km`)

/* -------------------------------------------------------------- polygons */
const area2 = (pts) => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}
function cleanPoly(geom) {
  let pts = geom.map((g) => proj(g.lat, g.lon))
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop()
  const out = []
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) > 0.4) out.push(p)
  // remove collinear points
  const res = []
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross) > 0.05) res.push(b)
  }
  if (res.length < 3) return null
  return res
}
const outerRings = (rel) => {
  // join outer member ways into rings
  const segs = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.slice())
  const rings = []
  while (segs.length) {
    let ring = segs.shift()
    let grown = true
    while (grown && !(ring[0].lat === ring.at(-1).lat && ring[0].lon === ring.at(-1).lon)) {
      grown = false
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i]
        const end = ring.at(-1)
        if (s[0].lat === end.lat && s[0].lon === end.lon) ring = ring.concat(s.slice(1))
        else if (s.at(-1).lat === end.lat && s.at(-1).lon === end.lon) ring = ring.concat(s.slice(0, -1).reverse())
        else continue
        segs.splice(i, 1)
        grown = true
        break
      }
    }
    rings.push(ring)
  }
  return rings
}
const geomsOf = (e) => (e.type === 'way' ? (e.geometry ? [e.geometry] : []) : e.type === 'relation' ? outerRings(e) : [])

const buildings = []
const areas = []
const religionKind = { hindu: 'temple', muslim: 'mosque', sikh: 'gurdwara', christian: 'church', jain: 'temple', buddhist: 'temple', jewish: 'church' }
for (const e of raw.elements) {
  const t = e.tags
  if (!t || e.type === 'node') continue
  for (const g of geomsOf(e)) {
    const pts = cleanPoly(g)
    if (!pts) continue
    if (!pts.some((p) => inside(p))) continue
    const A = area2(pts)
    if (A < 0) pts.reverse() // CCW in (x, z) screen sense → consistent winding
    const absA = Math.abs(A)
    if (t.building || t['building:part']) {
      if (absA < 10) continue
      // underground structures (metro stations, subways) are not drawn above ground
      if (Number(t.layer) < 0 || t.location === 'underground' || (t['building:levels'] === '0' && t['building:levels:underground'])) continue
      let kind = 'generic'
      if (t.building === 'roof') kind = 'canopy'
      else if (/Railway Station/i.test(t.name || '') || t.building === 'train_station') kind = 'station'
      else if (t.amenity === 'place_of_worship') kind = religionKind[t.religion] || 'temple'
      else if (/^(temple|mosque|church|cathedral|chapel|gurdwara)$/.test(t.building)) kind = t.building === 'cathedral' || t.building === 'chapel' ? 'church' : t.building
      else if (t.historic || t.tourism === 'attraction') kind = 'monument'
      else if (/^(apartments|residential|house|detached|terrace)$/.test(t.building)) kind = 'residential'
      else if (/^(commercial|retail|office|hotel|kiosk)$/.test(t.building)) kind = t.building === 'office' ? 'office' : 'commercial'
      else if (/^(school|college|university|hospital|public|government|civic|train_station|transportation)$/.test(t.building)) kind = 'public'
      const h = Number.parseFloat(t.height) || (t['building:levels'] ? Number.parseFloat(t['building:levels']) * 3.3 + 1 : 0)
      const keepName = kind !== 'generic' && kind !== 'residential' && kind !== 'commercial' && kind !== 'office' && kind !== 'canopy' && !t.brand
      const colour = /^#?[0-9a-f]{6}$/i.test(t['building:colour'] || '') ? '#' + t['building:colour'].replace('#', '') : (t['building:colour'] || '')
      buildings.push({ pts: pts.flat(), h: r1(h), k: kind, n: keepName ? nm(t) : '', id: e.id, osmTag: t.historic || t.tourism || '', c: colour })
      continue
    }
    let kind = null
    if (/^(park|garden|playground|pitch|stadium)$/.test(t.leisure || '') || /^(grass|recreation_ground|village_green|meadow)$/.test(t.landuse || '')) kind = 'grass'
    else if (t.landuse === 'forest') kind = 'forest'
    else if (t.natural === 'water' || t.water || t.natural === 'bay') kind = 'water'
    else if (t.amenity === 'parking') kind = 'parking'
    else if (t.landuse === 'railway') kind = 'rail'
    else if (t.amenity === 'marketplace' || (t.highway === 'pedestrian' && t.area === 'yes')) kind = 'plaza'
    else if (t.natural === 'beach' || t.natural === 'sand') kind = 'sand'
    else if (/^(school|college|university|hospital)$/.test(t.amenity || '')) kind = 'campus'
    if (!kind) continue
    if (absA < 20) continue
    areas.push({ k: kind, pts: pts.flat(), n: kind === 'grass' || kind === 'water' || kind === 'plaza' || kind === 'sand' ? nm(t) : '' })
  }
}

/* ------------------------------------------------------------------ rails */
const rails = []
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.geometry || !e.tags) continue
  const t = e.tags
  if (t.railway === 'rail' && !(t.tunnel && t.tunnel !== 'no') && !(t.bridge && t.bridge !== 'no') && t.service !== 'siding') {
    const pts = e.geometry.map((g) => proj(g.lat, g.lon))
    if (pts.some((p) => inside(p))) rails.push(pts.flat())
  }
}

/* ------------------------------------------------------------------- POIs */
const pois = []
const centroid = (e) => {
  if (e.lat !== undefined) return proj(e.lat, e.lon)
  if (e.bounds) return proj((e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2)
  return null
}
const FOOD = /^(restaurant|cafe|fast_food|ice_cream|food_court|bar|pub)$/
for (const e of raw.elements) {
  const t = e.tags
  if (!t) continue
  const p = centroid(e)
  if (!p || !inside(p)) continue
  const add = (k, extra = {}) => pois.push({ k, x: p[0], z: p[1], ...extra })
  if (e.type === 'node') {
    if (t.highway === 'traffic_signals') add('signal')
    else if (t.highway === 'crossing') add('crossing')
    else if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes')) add('bus_stop', { n: nm(t) })
    if (t.railway === 'subway_entrance') add('metro_gate', { n: nm(t).replace(/\s*Metro.*$/i, '').replace(/\s*Gate.*$/i, '').trim(), ref: t.ref || '' })
    if (t.railway === 'station') add('station', { n: nm(t), sub: t.station === 'subway' || t.subway === 'yes' ? 1 : 0 })
    if (t.amenity === 'atm' || (t.amenity === 'bank' && t.atm === 'yes')) add('atm')
    if (t.amenity === 'bench' || t.leisure === 'picnic_table') add('bench')
    if (t.amenity === 'fountain') add('fountain')
    if (t.amenity === 'drinking_water') add('water_tap')
    if (t.amenity === 'waste_basket') add('bin')
    if (t.amenity === 'toilets') add('toilets')
    if (FOOD.test(t.amenity || '')) add('food', { sub: t.amenity, brand: t.brand ? 1 : 0 })
    if (t.shop) add('shop', { sub: t.shop, brand: t.brand ? 1 : 0 })
    if (/^(hotel|guest_house|hostel)$/.test(t.tourism || '')) add('hotel')
    if (t.amenity === 'fuel') add('fuel')
    if (t.amenity === 'police') add('police')
  }
  if (t.amenity === 'place_of_worship') add('worship', { n: nm(t), sub: religionKind[t.religion] || 'temple' })
  if ((t.historic && t.historic !== 'yes') || /^(attraction|museum|monument|memorial|artwork|gallery|viewpoint)$/.test(t.tourism || '')) {
    if (t.name && !t.brand && t.tourism !== 'artwork') add('landmark', { n: nm(t), sub: t.historic || t.tourism })
  }
  if ((t.leisure === 'park' || t.leisure === 'garden') && t.name) add('park', { n: nm(t) })
}

/* ------------------------------------------------- land-use zones & places */
const zones = []
const ZONE = { commercial: 'market', retail: 'market', residential: 'residential', industrial: 'office' }
for (const e of raw.elements) {
  const t = e.tags
  if (!t || !t.landuse || !ZONE[t.landuse] || e.type === 'node') continue
  for (const g of geomsOf(e)) {
    const pts = cleanPoly(g)
    if (!pts || Math.abs(area2(pts)) < 2000) continue
    zones.push({ d: ZONE[t.landuse], pts: pts.flat() })
  }
}
const places = []
for (const e of raw.elements) {
  if (e.type !== 'node' || !e.tags?.place || !e.tags.name) continue
  const p = proj(e.lat, e.lon)
  if (inside(p, 300)) places.push({ n: e.tags['name:en'] || e.tags.name, x: p[0], z: p[1], k: e.tags.place })
}

/* --------------------------------------------- sea (from OSM coastline) */
// OSM convention: land is on the LEFT of a coastline way, water on the RIGHT.
const coast = []
for (const e of raw.elements) if (e.type === 'way' && e.tags?.natural === 'coastline' && e.geometry) coast.push(e.geometry.map((g) => proj(g.lat, g.lon)))
if (coast.length) {
  const CELL = 12
  const segs = []
  for (const c of coast) for (let i = 1; i < c.length; i++) segs.push([c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]])
  const H = new Map()
  const HC = 200
  const key = (x, z) => Math.floor(x / HC) + ',' + Math.floor(z / HC)
  for (const s of segs) {
    const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]), z0 = Math.min(s[1], s[3]), z1 = Math.max(s[1], s[3])
    for (let cx = Math.floor(x0 / HC); cx <= Math.floor(x1 / HC); cx++)
      for (let cz = Math.floor(z0 / HC); cz <= Math.floor(z1 / HC); cz++) {
        const k = cx + ',' + cz
        if (!H.has(k)) H.set(k, [])
        H.get(k).push(s)
      }
  }
  const nearestSide = (x, z) => {
    for (let r = 0; r < 25; r++) {
      let best = null, bd = Infinity
      const c0 = Math.floor(x / HC), c1 = Math.floor(z / HC)
      for (let cx = c0 - r; cx <= c0 + r; cx++)
        for (let cz = c1 - r; cz <= c1 + r; cz++) {
          if (Math.max(Math.abs(cx - c0), Math.abs(cz - c1)) !== r) continue
          for (const s of H.get(cx + ',' + cz) || []) {
            const vx = s[2] - s[0], vz = s[3] - s[1]
            const l2 = vx * vx + vz * vz || 1
            const t = Math.max(0, Math.min(1, ((x - s[0]) * vx + (z - s[1]) * vz) / l2))
            const d = Math.hypot(x - (s[0] + vx * t), z - (s[1] + vz * t))
            if (d < bd) { bd = d; best = s }
          }
        }
      if (best && bd < (r + 1) * HC) {
        // in (x right, z down) screen coordinates "right of travel" has positive cross
        const cr = (best[2] - best[0]) * (z - best[1]) - (best[3] - best[1]) * (x - best[0])
        return cr > 0 ? 'sea' : 'land'
      }
    }
    return 'land'
  }
  let seaCells = 0
  for (let z = minZ; z < maxZ; z += CELL) {
    let run = -1
    for (let x = minX; x <= maxX + CELL; x += CELL) {
      const sea = x <= maxX && nearestSide(x + CELL / 2, z + CELL / 2) === 'sea'
      if (sea && run < 0) run = x
      if (!sea && run >= 0) {
        areas.push({ k: 'water', pts: [run, z, x, z, x, z + CELL, run, z + CELL].map(r1), n: 'Sea' })
        seaCells += (x - run) / CELL
        run = -1
      }
    }
  }
  console.log('sea cells', seaCells)
}

/* ----------------------------------------------------------------- output */
const out = {
  meta: {
    id: cityId,
    name: cfg.name,
    origin: cfg.origin,
    bounds,
    osmTimestamp: raw.osm3s?.timestamp_osm_base,
    attribution: '© OpenStreetMap contributors (ODbL 1.0)',
    generatedAt: new Date().toISOString(),
    skippedBridges,
    flyoverEdges: elev.length,
  },
  nodes: gNodes.flat(),
  edges,
  elev,
  foot: footWays,
  buildings,
  areas,
  rails,
  pois,
  zones,
  places,
}
const outPath = path.join(root, 'public/data', `${cityId}.json`)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(out))
const kb = (fs.statSync(outPath).size / 1024).toFixed(0)
const pc = {}
for (const p of pois) pc[p.k] = (pc[p.k] || 0) + 1
console.log(`wrote ${outPath} (${kb} KB)`)
console.log(`bounds ${JSON.stringify(bounds)}  nodes ${gNodes.length} edges ${edges.length} (car ${edges.filter((e) => e.car).length}) foot ${footWays.length}`)
console.log(`buildings ${buildings.length} areas ${areas.length} rails ${rails.length} skippedBridges ${skippedBridges}`)
console.log('pois', JSON.stringify(pc))
console.log('worship', buildings.filter((b) => /temple|mosque|gurdwara|church/.test(b.k)).map((b) => b.k + ':' + b.n).join(', '))
console.log('monuments', buildings.filter((b) => b.k === 'monument').map((b) => b.n).join(', '))
