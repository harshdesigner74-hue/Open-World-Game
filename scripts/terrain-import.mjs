#!/usr/bin/env node
/**
 * Real-elevation terrain backdrop importer.
 *
 *   node scripts/terrain-import.mjs delhi        # one city
 *   node scripts/terrain-import.mjs all          # every city
 *
 * Source: AWS Open Data "Terrain Tiles" (terrarium PNG encoding, public, no key):
 *   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
 * which are built from SRTM, GMTED2010, NED and ETOPO1 (public-domain / open sources).
 * Raw tiles are cached in data/terrain/. Output: public/data/<city>-terrain.json — a height grid
 * in the game's local metres (same projection as the OSM importer), heights relative to the
 * median ground level inside the playable map.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { CITIES } from './cities.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const Z = 12 // ~34 m/pixel at these latitudes
const MARGIN = 5200 // metres of backdrop around the playable bbox
const STEP = 60 // output grid spacing (m)

/** Minimal PNG decoder for 8-bit RGB/RGBA non-interlaced images (all terrarium tiles). */
function decodePng(buf) {
  let p = 8
  let w = 0, h = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG')
      ct = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0
  if (!bpp) throw new Error('unsupported colour type ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(w * h * bpp)
  const stride = w * bpp
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = out.subarray(y * stride, (y + 1) * stride)
    const up = y ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = up ? up[i] : 0
      const c = up && i >= bpp ? up[i - bpp] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      row[i] = v & 255
    }
  }
  return { w, h, bpp, px: out }
}

const tileCache = new Map()
async function tile(x, y) {
  const k = `${x}/${y}`
  if (tileCache.has(k)) return tileCache.get(k)
  const file = path.join(root, 'data/terrain', `${Z}-${x}-${y}.png`)
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`
    const res = await fetch(url, { headers: { 'User-Agent': 'india-open-world-terrain/0.1' } })
    if (!res.ok) throw new Error(`tile ${url} → ${res.status}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  const t = decodePng(fs.readFileSync(file))
  tileCache.set(k, t)
  return t
}

/** elevation (m) at lat/lon, bilinear inside the z12 tile pyramid */
async function elevation(lat, lon) {
  const n = 2 ** Z
  const fx = ((lon + 180) / 360) * n * 256
  const s = Math.sin((lat * Math.PI) / 180)
  const fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256
  const px = Math.floor(fx - 0.5), py = Math.floor(fy - 0.5)
  const tx = fx - 0.5 - px, ty = fy - 0.5 - py
  const at = async (X, Y) => {
    const t = await tile(Math.floor(X / 256), Math.floor(Y / 256))
    const i = ((Y & 255) * 256 + (X & 255)) * t.bpp
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768
  }
  const a = await at(px, py), b = await at(px + 1, py), c = await at(px, py + 1), d = await at(px + 1, py + 1)
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

async function run(cityId) {
  const cfg = CITIES[cityId]
  if (!cfg) throw new Error('Unknown city ' + cityId)
  const [lat0, lon0] = cfg.origin
  const MX = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const MZ = 110574
  const proj = (lat, lon) => [(lon - lon0) * MX, -(lat - lat0) * MZ]
  const unproj = (x, z) => [lat0 - z / MZ, lon0 + x / MX]
  const [S, W, N, E] = cfg.bbox
  const [minX, maxZ] = proj(S, W)
  const [maxX, minZ] = proj(N, E)
  const x0 = Math.floor((minX - MARGIN) / STEP) * STEP
  const z0 = Math.floor((minZ - MARGIN) / STEP) * STEP
  const nx = Math.ceil((maxX + MARGIN - x0) / STEP) + 1
  const nz = Math.ceil((maxZ + MARGIN - z0) / STEP) + 1
  const H = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [lat, lon] = unproj(x0 + i * STEP, z0 + j * STEP)
      H[j * nx + i] = await elevation(lat, lon)
    }
  // SRTM is a surface model: towers and tall blocks show up as sharp single-cell spikes.
  // Real hills are broad, so knock down anything far above its 8 neighbours, then smooth lightly.
  for (let pass = 0; pass < 3; pass++) {
    const src = H.slice()
    for (let j = 1; j < nz - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        let sum = 0, mx = -1e9
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue
            const v = src[(j + dj) * nx + i + di]
            sum += v
            mx = Math.max(mx, v)
          }
        const k = j * nx + i
        if (src[k] > mx + 12) H[k] = sum / 8
      }
  }
  {
    const src = H.slice()
    for (let j = 1; j < nz - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        let s = 0, w = 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1
            s += src[(j + dj) * nx + i + di] * k
            w += k
          }
        H[j * nx + i] = s / w
      }
  }
  // reference level = median elevation inside the playable map
  const inside = []
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) inside.push(H[j * nx + i])
    }
  inside.sort((a, b) => a - b)
  const base = inside[Math.floor(inside.length / 2)]
  const rel = new Int16Array(nx * nz)
  let maxRel = -1e9, minRel = 1e9
  for (let k = 0; k < H.length; k++) {
    const v = Math.round((H[k] - base) * 10) // decimetres
    rel[k] = Math.max(-32000, Math.min(32000, v))
    maxRel = Math.max(maxRel, v / 10)
    minRel = Math.min(minRel, v / 10)
  }
  const out = {
    city: cityId,
    x0, z0, step: STEP, nx, nz,
    base: Math.round(base * 10) / 10,
    bounds: { minX, maxX, minZ, maxZ },
    h: Buffer.from(rel.buffer).toString('base64'),
    attribution: 'Terrain: AWS Terrain Tiles (SRTM, GMTED2010, NED, ETOPO1)',
  }
  const file = path.join(root, 'public/data', `${cityId}-terrain.json`)
  fs.writeFileSync(file, JSON.stringify(out))
  console.log(`${cityId}: ${nx}×${nz} grid, base ${out.base} m, relief ${minRel.toFixed(0)}…+${maxRel.toFixed(0)} m, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}

const arg = process.argv[2] || 'delhi'
for (const id of arg === 'all' ? Object.keys(CITIES) : [arg]) await run(id)
