import * as THREE from 'three'
import { mulberry32, pick, type RNG } from './math'

/**
 * All textures are generated procedurally at runtime on <canvas>.
 * This keeps the project free of third-party/licensed image assets and keeps the download tiny.
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

function toTex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, rng: RNG, base: number, amp: number, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * amp
    img.data[i] = Math.max(0, Math.min(255, img.data[i] * (1 - alpha) + (base + n) * alpha))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * (1 - alpha) + (base + n) * alpha))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * (1 - alpha) + (base + n) * alpha))
  }
  ctx.putImageData(img, 0, 0)
}

const cache = new Map<string, unknown>()
function cached<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key) as T
}

/** Grayscale detail texture used (world-space UVs) on roads, pavements and grass. */
export function detailTexture() {
  return cached('detail', () => {
    const { c, ctx } = canvas(512, 512)
    const rng = mulberry32(7)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 512, 512)
    noiseFill(ctx, 512, 512, rng, 225, 60)
    // blotches / stains
    for (let i = 0; i < 260; i++) {
      const x = rng() * 512,
        y = rng() * 512,
        r = 4 + rng() * 30
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const v = rng() < 0.5 ? 0 : 255
      g.addColorStop(0, `rgba(${v},${v},${v},${0.06 + rng() * 0.08})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    for (let i = 0; i < 40; i++) {
      ctx.lineWidth = 0.5 + rng()
      ctx.beginPath()
      let x = rng() * 512,
        y = rng() * 512
      ctx.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 30
        y += (rng() - 0.5) * 30
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    return toTex(c, true, false)
  })
}

export type FacadeStyle = 'residential' | 'office' | 'government' | 'colonial' | 'shop'

interface FacadeTex {
  map: THREE.Texture
  emissive: THREE.Texture
  /** metres covered by one texture repeat horizontally/vertically */
  tileW: number
  tileH: number
  /** tangent-space normal map derived from the facade (windows recessed) */
  normal: THREE.Texture
  /** G = roughness, B = metalness (glass is glossy & reflective, plaster is rough) */
  orm: THREE.Texture
}

/** Facade textures: 4×4 bays (or 4×1 for shopfronts). Walls are white so vertex colours tint them. */
export function facadeTexture(style: FacadeStyle): FacadeTex {
  return cached('facade-' + style, () => {
    const W = 512
    const H = style === 'shop' ? 160 : 512
    const { c, ctx } = canvas(W, H)
    const e = canvas(W, H)
    const rng = mulberry32(style.length * 977 + 13)
    ctx.fillStyle = '#f4f2ee'
    ctx.fillRect(0, 0, W, H)
    noiseFill(ctx, W, H, rng, 238, 22)
    e.ctx.fillStyle = '#000'
    e.ctx.fillRect(0, 0, W, H)
    const bays = 4
    const bw = W / bays

    if (style === 'shop') {
      const shopColors = ['#d64541', '#f0b429', '#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085']
      for (let i = 0; i < bays; i++) {
        const x0 = i * bw + 6
        const w = bw - 12
        // sign band (blank, coloured; real names are added as separate sign meshes)
        ctx.fillStyle = 'rgba(60,60,60,0.25)'
        ctx.fillRect(i * bw, 0, bw, 6)
        if (rng() < 0.38) {
          // rolling shutter
          ctx.fillStyle = '#8d9196'
          ctx.fillRect(x0, 34, w, H - 34)
          for (let y = 36; y < H; y += 5) {
            ctx.fillStyle = y % 10 === 0 ? '#6f7378' : '#a6aaaf'
            ctx.fillRect(x0, y, w, 2)
          }
        } else {
          // open shop with goods
          ctx.fillStyle = '#2b2118'
          ctx.fillRect(x0, 34, w, H - 34)
          ctx.fillStyle = '#ffe3a8'
          ctx.fillRect(x0 + 4, 38, w - 8, 14)
          for (let k = 0; k < 26; k++) {
            ctx.fillStyle = pick(rng, shopColors)
            ctx.fillRect(x0 + 4 + rng() * (w - 20), 56 + rng() * (H - 80), 6 + rng() * 14, 6 + rng() * 12)
          }
          e.ctx.fillStyle = '#ffd890'
          e.ctx.fillRect(x0, 34, w, H - 34)
        }
        ctx.fillStyle = pick(rng, shopColors)
        ctx.fillRect(i * bw + 2, 8, bw - 4, 24)
        e.ctx.fillStyle = 'rgba(255,240,200,0.55)'
        e.ctx.fillRect(i * bw + 2, 8, bw - 4, 24)
        // pillars
        ctx.fillStyle = 'rgba(0,0,0,0.12)'
        ctx.fillRect(i * bw, 0, 6, H)
      }
      const t = toTex(c)
      return { map: t, emissive: toTex(e.c), tileW: 4 * 4.5, tileH: 4.2, ...surfaceMaps(c, 'shop') }
    }

    const floors = 4
    const fh = H / floors
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const x = b * bw
        const y = f * fh
        const lit = rng() < 0.42
        const warm = rng() < 0.75
        if (style === 'office') {
          // curtain wall
          const g = ctx.createLinearGradient(x, y, x + bw, y + fh)
          g.addColorStop(0, '#6f8796')
          g.addColorStop(0.5, '#a8bccb')
          g.addColorStop(1, '#5d7383')
          ctx.fillStyle = g
          ctx.fillRect(x + 3, y + 3, bw - 6, fh - 16)
          ctx.fillStyle = '#d9dde0'
          ctx.fillRect(x, y + fh - 13, bw, 13)
          ctx.fillStyle = '#c9cdd0'
          ctx.fillRect(x + bw / 2 - 1, y, 2, fh - 13)
          if (lit) {
            e.ctx.fillStyle = warm ? '#f3e2b8' : '#d8e8ff'
            e.ctx.fillRect(x + 3, y + 3, bw - 6, fh - 16)
          }
          continue
        }
        const wx = style === 'government' ? x + bw * 0.3 : style === 'colonial' ? x + bw * 0.28 : x + bw * 0.18
        const ww = style === 'government' ? bw * 0.4 : style === 'colonial' ? bw * 0.44 : bw * 0.64
        const wy = y + fh * 0.22
        const wh = style === 'colonial' ? fh * 0.62 : fh * 0.5
        // recess shadow
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8)
        // glass
        const g = ctx.createLinearGradient(wx, wy, wx, wy + wh)
        g.addColorStop(0, '#3d4a55')
        g.addColorStop(1, '#1c242b')
        ctx.fillStyle = g
        ctx.fillRect(wx, wy, ww, wh)
        if (style === 'government' || style === 'colonial') {
          // arched top
          ctx.beginPath()
          ctx.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0)
          ctx.fill()
        }
        if (lit) {
          e.ctx.fillStyle = warm ? '#ffcf87' : '#cfe2ff'
          e.ctx.fillRect(wx, wy, ww, wh)
        }
        // frame + grille (very common on Indian residential windows)
        ctx.strokeStyle = style === 'colonial' ? '#4f6b4a' : '#5b5048'
        ctx.lineWidth = 3
        ctx.strokeRect(wx, wy, ww, wh)
        ctx.lineWidth = 1.5
        for (let k = 1; k < 4; k++) {
          ctx.beginPath()
          ctx.moveTo(wx + (ww * k) / 4, wy)
          ctx.lineTo(wx + (ww * k) / 4, wy + wh)
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.moveTo(wx, wy + wh / 2)
        ctx.lineTo(wx + ww, wy + wh / 2)
        ctx.stroke()
        if (style === 'colonial') {
          // green shutters
          ctx.fillStyle = '#5f7f57'
          ctx.fillRect(wx - ww * 0.32, wy, ww * 0.28, wh)
          ctx.fillRect(wx + ww * 1.04, wy, ww * 0.28, wh)
        }
        if (style === 'residential') {
          // chajja (sunshade) above window
          ctx.fillStyle = 'rgba(0,0,0,0.28)'
          ctx.fillRect(wx - 10, wy - 12, ww + 20, 7)
          // balcony slab & railing on some bays
          if (rng() < 0.35) {
            ctx.fillStyle = 'rgba(0,0,0,0.2)'
            ctx.fillRect(x + 4, y + fh * 0.8, bw - 8, 6)
            ctx.strokeStyle = '#4b4b4b'
            ctx.lineWidth = 2
            for (let k = 0; k < 10; k++) {
              ctx.beginPath()
              ctx.moveTo(x + 8 + k * ((bw - 16) / 9), y + fh * 0.62)
              ctx.lineTo(x + 8 + k * ((bw - 16) / 9), y + fh * 0.8)
              ctx.stroke()
            }
            ctx.beginPath()
            ctx.moveTo(x + 6, y + fh * 0.62)
            ctx.lineTo(x + bw - 6, y + fh * 0.62)
            ctx.stroke()
          }
          // split AC unit
          if (rng() < 0.25) {
            ctx.fillStyle = '#e2e2dc'
            ctx.fillRect(wx + ww + 4, wy + wh - 26, 30, 22)
            ctx.strokeStyle = '#999'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(wx + ww + 19, wy + wh - 15, 7, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        if (style === 'government') {
          ctx.fillStyle = 'rgba(120,50,30,0.25)'
          ctx.fillRect(x, y + fh - 10, bw, 10)
        }
      }
      // floor band
      ctx.fillStyle = 'rgba(0,0,0,0.07)'
      ctx.fillRect(0, f * fh + fh - 4, W, 4)
    }
    // weathering streaks (monsoon stains)
    if (style !== 'office')
      for (let i = 0; i < 70; i++) {
        const x = rng() * W
        const y = rng() * H
        const g = ctx.createLinearGradient(x, y, x, y + 60 + rng() * 100)
        g.addColorStop(0, 'rgba(60,50,40,0.12)')
        g.addColorStop(1, 'rgba(60,50,40,0)')
        ctx.fillStyle = g
        ctx.fillRect(x, y, 3 + rng() * 10, 160)
      }
    const bayW = style === 'office' ? 3.2 : style === 'government' ? 4.5 : 3.6
    const floorH = style === 'office' ? 3.6 : style === 'government' ? 4.2 : style === 'colonial' ? 4.0 : 3.1
    return { map: toTex(c), emissive: toTex(e.c), tileW: bays * bayW, tileH: floors * floorH, ...surfaceMaps(c, style) }
  })
}

/** Shop sign atlas: 4 columns × 16 rows of 256×64 boards. */
export const SIGN_COLS = 4
export const SIGN_ROWS = 16
export const SIGN_NAMES = [
  'Sharma Sweets', 'शर्मा स्वीट्स', 'Gupta Jewellers', 'Annapurna Bhojnalaya', 'Raj Book Depot', 'Malhotra Opticals',
  'Sardar Ji Paranthe', 'लक्ष्मी साड़ी', 'Kapoor Electronics', 'Mehta Mobile Point', 'Taj Tailors', 'Hari Om Dhaba',
  'Zaika Cafe', 'Bansal Medical Store', 'अग्रवाल किराना', 'Chawla Chicken Corner', 'Verma Hardware', 'Singh Photo Studio',
  'Khanna Shoe House', 'Delhi Chaat Bhandar', 'Bhatia Travels', 'Saini Dairy', 'Arora Stationers', 'राम लस्सी भंडार',
  'Jain Cloth House', 'Pandit Ji Chai', 'Rana Sports', 'Goyal Pharmacy', 'Bindal Watch Co.', 'Saxena Xerox',
  'Kohli Dry Cleaners', 'Nanda Bakery', 'Mittal Furnishings', 'Chopra Cafe & Bar', 'Ahuja Radio', 'Bedi Fabrics',
  'Garg Sweets', 'Thakur Pan Bhandar', 'Ojha Computers', 'शिव भोजनालय', 'Kashyap Gift Gallery', 'Dua Sarees',
  'Grover Auto Parts', 'Bhalla Book Store', 'Sethi Juice Corner', 'Tandon Tea House', 'Luthra Paints', 'Sood Optics',
  'Ravi Hair Salon', 'Kumar Tiffin Service', 'Nair Coffee House', 'Iyer Idli Corner', 'Bose Cabin', 'Das Mishti',
  'Patel Snacks', 'Reddy Biryani', 'Menon Ayurveda', 'जनता मेडिकल', 'Rawat Momos', 'Dhillon Dhaba',
  'Mishra Kirana', 'Joshi Silver', 'Yadav Dairy', 'Pillai Spices',
]
export function signAtlasTexture() {
  return cached('signs', () => {
    const cw = 256,
      ch = 64
    const { c, ctx } = canvas(cw * SIGN_COLS, ch * SIGN_ROWS)
    const rng = mulberry32(99)
    const palettes = [
      ['#c0392b', '#fff4d6'],
      ['#f1c40f', '#7b1e12'],
      ['#1f5fa8', '#ffffff'],
      ['#1e8449', '#fffbe6'],
      ['#ffffff', '#b0181f'],
      ['#2c2c2c', '#ffcf3f'],
      ['#e67e22', '#ffffff'],
      ['#6c2a8a', '#ffe8a3'],
      ['#fff1c9', '#1d3e80'],
    ]
    for (let i = 0; i < SIGN_COLS * SIGN_ROWS; i++) {
      const x = (i % SIGN_COLS) * cw
      const y = Math.floor(i / SIGN_COLS) * ch
      const [bg, fg] = pick(rng, palettes)
      ctx.fillStyle = bg
      ctx.fillRect(x, y, cw, ch)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 3
      ctx.strokeRect(x + 2, y + 2, cw - 4, ch - 4)
      const name = SIGN_NAMES[i % SIGN_NAMES.length]
      ctx.fillStyle = fg
      let size = 34
      ctx.font = `700 ${size}px "Rajdhani", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif`
      while (ctx.measureText(name).width > cw - 24 && size > 14) {
        size -= 2
        ctx.font = `700 ${size}px "Rajdhani", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif`
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(name, x + cw / 2, y + ch / 2 + 2)
      // phone-number strip, a staple of Indian shop boards
      ctx.font = `600 10px sans-serif`
      ctx.globalAlpha = 0.7
      ctx.fillText('☎ 98' + Math.floor(10000000 + rng() * 89999999), x + cw / 2, y + ch - 8)
      ctx.globalAlpha = 1
    }
    const t = toTex(c, false)
    return t
  })
}

/** Indian national flag (tricolour with 24-spoke Ashoka Chakra). */
export function flagTexture() {
  return cached('flag', () => {
    const { c, ctx } = canvas(300, 200)
    ctx.fillStyle = '#FF9933'
    ctx.fillRect(0, 0, 300, 67)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 67, 300, 66)
    ctx.fillStyle = '#138808'
    ctx.fillRect(0, 133, 300, 67)
    ctx.strokeStyle = '#000080'
    ctx.fillStyle = '#000080'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(150, 100, 28, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(150, 100, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1.2
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(150, 100)
      ctx.lineTo(150 + Math.cos(a) * 28, 100 + Math.sin(a) * 28)
      ctx.stroke()
    }
    return toTex(c, false)
  })
}

/** Generic text plate (station names, landmark inscriptions). */
export function textTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}) {
  return cached('text-' + text + JSON.stringify(opts), () => {
    const w = opts.w ?? 1024
    const h = opts.h ?? 160
    const { c, ctx } = canvas(w, h)
    ctx.fillStyle = opts.bg ?? '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = opts.fg ?? '#b3121f'
    ctx.font = opts.font ?? `700 ${Math.floor(h * 0.62)}px "Rajdhani", "Kohinoor Devanagari", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + h * 0.04)
    return toTex(c, false)
  })
}

/** Soft radial gradient used for street-light pools and blob shadows. */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return cached('radial' + inner + outer, () => {
    const { c, ctx } = canvas(128, 128)
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, inner)
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return toTex(c, false)
  })
}

/** Original chest emblem for the hero's hoodie (a stylised orange sun). */
export function emblemTexture() {
  return cached('emblem', () => {
    const { c, ctx } = canvas(128, 128)
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = '#f39a3c'
    ctx.strokeStyle = '#f39a3c'
    ctx.beginPath()
    ctx.arc(64, 52, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 5
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI
      ctx.beginPath()
      ctx.moveTo(64 + Math.cos(a) * 22, 52 + Math.sin(a) * 22)
      ctx.lineTo(64 + Math.cos(a) * 34, 52 + Math.sin(a) * 34)
      ctx.stroke()
    }
    ctx.font = '700 26px "Rajdhani", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('DESI', 64, 98)
    const t = toTex(c, false)
    return t
  })
}

/**
 * Derive PBR surface maps from a colour canvas:
 *  - normal map from luminance as height (dark = recessed: windows, shutter grooves)
 *  - ORM texture: G roughness, B metalness (dark glass → glossy & metallic, plaster → rough)
 */
export function surfaceMaps(src: HTMLCanvasElement, style: string, strength = 2.2) {
  const w = src.width,
    h = src.height
  const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = (sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114) / 255
  const n = canvas(w, h)
  const o = canvas(w, h)
  const nd = n.ctx.createImageData(w, h)
  const od = o.ctx.createImageData(w, h)
  const L = (x: number, y: number) => lum[((y + h) % h) * w + ((x + w) % w)]
  const glassy = style === 'office' ? 0.8 : 0.36
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      nd.data[i * 4] = ((-dx / len) * 0.5 + 0.5) * 255
      nd.data[i * 4 + 1] = ((dy / len) * 0.5 + 0.5) * 255
      nd.data[i * 4 + 2] = ((1 / len) * 0.5 + 0.5) * 255
      nd.data[i * 4 + 3] = 255
      const v = lum[i]
      const glass = v < glassy ? 1 : 0
      const rough = glass ? (style === 'office' ? 0.08 : 0.18) : style === 'shop' && v < 0.6 ? 0.5 : 0.82 + (v - 0.8) * 0.3
      od.data[i * 4] = 255
      od.data[i * 4 + 1] = Math.max(0, Math.min(1, rough)) * 255
      od.data[i * 4 + 2] = (glass ? (style === 'office' ? 0.85 : 0.55) : 0.02) * 255
      od.data[i * 4 + 3] = 255
    }
  n.ctx.putImageData(nd, 0, 0)
  o.ctx.putImageData(od, 0, 0)
  return { normal: toTex(n.c, true, false), orm: toTex(o.c, true, false) }
}

/** Normal map for ground surfaces (asphalt grain / paving), from the detail texture. */
export function detailNormal() {
  return cached('detail-normal', () => {
    const img = (detailTexture().image as HTMLCanvasElement)
    return surfaceMaps(img, 'ground', 3).normal
  })
}

/** Leaf-cluster texture with alpha for foliage cards. */
export function leafTexture() {
  return cached('leaves', () => {
    const { c, ctx } = canvas(256, 256)
    const rng = mulberry32(31)
    ctx.clearRect(0, 0, 256, 256)
    for (let i = 0; i < 520; i++) {
      const r = Math.sqrt(rng()) * 118
      const a = rng() * Math.PI * 2
      const x = 128 + Math.cos(a) * r,
        y = 128 + Math.sin(a) * r * 0.9
      const s = 6 + rng() * 9
      const shade = 0.55 + rng() * 0.45
      ctx.fillStyle = `rgb(${Math.round(70 * shade)},${Math.round(130 * shade)},${Math.round(50 * shade)})`
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(rng() * Math.PI)
      ctx.beginPath()
      ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const t = toTex(c, false)
    return t
  })
}

/** Palm frond texture (alpha). */
export function frondTexture() {
  return cached('frond', () => {
    const { c, ctx } = canvas(256, 64)
    ctx.clearRect(0, 0, 256, 64)
    ctx.strokeStyle = '#4d6b2a'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(0, 32)
    ctx.lineTo(256, 32)
    ctx.stroke()
    for (let x = 6; x < 250; x += 5) {
      const len = 28 * Math.sin((x / 256) * Math.PI) + 4
      ctx.strokeStyle = x % 10 ? '#5f8a34' : '#4f7a2a'
      ctx.lineWidth = 2.2
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(x, 32)
        ctx.lineTo(x + 10, 32 + s * len)
        ctx.stroke()
      }
    }
    return toTex(c, false)
  })
}
