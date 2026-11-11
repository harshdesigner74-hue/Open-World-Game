import * as THREE from 'three'

/**
 * Builds the hero's face texture from the user's reference sheet
 * (public/assets/character/reference-sheet.png, "Close-Up Face" panel).
 *
 * The photo is projected onto the FRONT of a sculpted 3D head (planar projection), feathered
 * into a skin tone sampled from the same photo. Everything outside the face oval is plain skin,
 * so the back/sides of the head never show photo content.
 *
 * Texture space ↔ head space: u = 0.5 + x/2, v = 0.5 + y/2 where (x, y) are the normalised head
 * coordinates (unit sphere before scaling). Calibration (source pixels in the 1536×1024 sheet):
 *   eye line y≈167, chin y≈280, face centre x≈1410, cheek half-width ≈77 px.
 */
export const FACE_SOURCE = {
  url: `${import.meta.env.BASE_URL}assets/character/reference-sheet.png`,
  // source rectangle covering normalised head coords x∈[-1,1], y∈[-1,1]
  sx: 1319.4,
  sy: 47.7,
  sw: 181.2,
  sh: 251.2,
  // cheek sample for skin tone (source px)
  skinSample: { x: 1452, y: 205, r: 7 },
}

export interface FaceResult {
  texture: THREE.CanvasTexture
  skin: THREE.Color
}

const SIZE = 512

function painted(skin: string): HTMLCanvasElement {
  // procedural fallback face (used when photo face is disabled or the image fails to load)
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d')!
  g.fillStyle = skin
  g.fillRect(0, 0, SIZE, SIZE)
  const X = (x: number) => (0.5 + x / 2) * SIZE
  const Y = (y: number) => (0.5 - y / 2) * SIZE
  // brows
  g.fillStyle = '#1c130e'
  for (const s of [-1, 1]) {
    g.beginPath()
    g.ellipse(X(s * 0.33), Y(0.2), 38, 9, s * -0.12, 0, Math.PI * 2)
    g.fill()
  }
  // eyes
  for (const s of [-1, 1]) {
    g.fillStyle = '#f3efe8'
    g.beginPath()
    g.ellipse(X(s * 0.33), Y(0.05), 26, 12, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#2a1a10'
    g.beginPath()
    g.arc(X(s * 0.33), Y(0.05), 10, 0, Math.PI * 2)
    g.fill()
  }
  // nose shadow, mustache, smile, stubble
  g.fillStyle = 'rgba(80,40,20,0.25)'
  g.beginPath()
  g.ellipse(X(0), Y(-0.2), 22, 14, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(25,15,10,0.85)'
  g.beginPath()
  g.ellipse(X(0), Y(-0.33), 60, 10, 0, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#f2ece4'
  g.beginPath()
  g.ellipse(X(0), Y(-0.43), 44, 10, 0, 0, Math.PI)
  g.fill()
  g.fillStyle = 'rgba(30,20,15,0.25)'
  g.beginPath()
  g.ellipse(X(0), Y(-0.62), 100, 70, 0, 0, Math.PI)
  g.fill()
  return c
}

function compose(img: HTMLImageElement | null, skin: THREE.Color): HTMLCanvasElement {
  const skinCss = '#' + skin.getHexString()
  if (!img) return painted(skinCss)
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d')!
  g.fillStyle = skinCss
  g.fillRect(0, 0, SIZE, SIZE)
  // photo layer, masked by a feathered oval around the face
  const photo = document.createElement('canvas')
  photo.width = photo.height = SIZE
  const p = photo.getContext('2d')!
  const S = FACE_SOURCE
  p.drawImage(img, S.sx, S.sy, S.sw, S.sh, 0, 0, SIZE, SIZE)
  p.globalCompositeOperation = 'destination-in'
  const cx = SIZE * 0.5,
    cy = SIZE * (0.5 + 0.24 / 2) // oval centre at y = -0.24 (canvas y grows downward)
  const rx = SIZE * 0.4,
    ry = SIZE * 0.32
  p.save()
  p.translate(cx, cy)
  p.scale(1, ry / rx)
  const grad = p.createRadialGradient(0, 0, rx * 0.7, 0, 0, rx)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  p.fillStyle = grad
  p.beginPath()
  p.arc(0, 0, rx, 0, Math.PI * 2)
  p.fill()
  p.restore()
  g.drawImage(photo, 0, 0)
  return c
}

function sampleSkin(img: HTMLImageElement): THREE.Color {
  const c = document.createElement('canvas')
  const { x, y, r } = FACE_SOURCE.skinSample
  c.width = c.height = r * 2
  const g = c.getContext('2d')!
  g.drawImage(img, x - r, y - r, r * 2, r * 2, 0, 0, r * 2, r * 2)
  const d = g.getImageData(0, 0, r * 2, r * 2).data
  let R = 0,
    G = 0,
    B = 0
  for (let i = 0; i < d.length; i += 4) {
    R += d[i]
    G += d[i + 1]
    B += d[i + 2]
  }
  const n = d.length / 4
  return new THREE.Color().setRGB(R / n / 255, G / n / 255, B / n / 255, THREE.SRGBColorSpace)
}

let imgPromise: Promise<HTMLImageElement | null> | null = null
export function loadReferenceImage() {
  if (!imgPromise)
    imgPromise = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = FACE_SOURCE.url
    })
  return imgPromise
}

export async function buildFaceTexture(usePhoto: boolean): Promise<FaceResult> {
  const img = await loadReferenceImage()
  const skin = img ? sampleSkin(img) : new THREE.Color('#a8714c')
  const canvas = compose(usePhoto ? img : null, skin)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, skin }
}
