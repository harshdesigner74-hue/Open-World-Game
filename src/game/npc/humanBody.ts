import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry as RoundedBox } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mulberry32, pick } from '../utils/math'
import type { NPCKind } from './dialogue'

/**
 * Instanced human bodies. Every body part is one InstancedMesh shared by all NPCs, so the whole
 * crowd costs ~20 draw calls. Parts hang from joints; a pose is a handful of joint angles.
 */
export const PART = {
  torso: 0,
  hips: 1,
  head: 2,
  hair: 3,
  uArmL: 4,
  uArmR: 5,
  fArmL: 6,
  fArmR: 7,
  thighL: 8,
  thighR: 9,
  shinL: 10,
  shinR: 11,
  footL: 12,
  footR: 13,
  skirt: 14,
  drape: 15,
  cap: 16,
  pack: 17,
  bun: 18,
  phone: 19,
  umbrella: 20,
  torsoF: 21,
} as const
export const PART_COUNT = 22

/** limb hanging down from its joint: tapered tube with rounded ends (joint spheres) */
function limb(r0: number, r1: number, len: number, seg = 14) {
  const tube = new THREE.CylinderGeometry(r0, r1, len, seg, 3).translate(0, -len / 2, 0)
  const top = new THREE.SphereGeometry(r0 * 1.02, seg, 8)
  const bot = new THREE.SphereGeometry(r1, seg, 8).translate(0, -len, 0)
  return mergeGeometries([tube, top, bot])!
}

/** body of revolution from a (radius, height) profile, flattened front-to-back */
function lathe(profile: [number, number][], depth: number) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  ).scale(1, 1, depth)
}

export function partGeometries(): THREE.BufferGeometry[] {
  // torso: waist (y=0) → shoulders/neck base (y≈0.6)
  const torso = lathe(
    [[0.152, 0], [0.158, 0.07], [0.156, 0.16], [0.17, 0.28], [0.19, 0.39], [0.198, 0.46], [0.184, 0.53], [0.135, 0.574], [0.065, 0.598], [0.001, 0.604]],
    0.62,
  )
  const torsoF = lathe(
    [[0.16, 0], [0.15, 0.07], [0.132, 0.17], [0.148, 0.29], [0.168, 0.37], [0.16, 0.44], [0.165, 0.5], [0.145, 0.548], [0.09, 0.582], [0.045, 0.596], [0.001, 0.6]],
    0.66,
  )
  const hips = new THREE.SphereGeometry(1, 22, 14).scale(0.162, 0.11, 0.112)
  // head + neck (the neck reuses a blank skin area of the face texture)
  const skull = new THREE.SphereGeometry(1, 28, 20).scale(0.083, 0.104, 0.094)
  const neck = new THREE.CylinderGeometry(0.041, 0.047, 0.13, 14, 1, true).translate(0, -0.135, -0.008)
  const nuv = neck.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < nuv.count; i++) nuv.setXY(i, 0.75, 0.3)
  const head = mergeGeometries([skull, neck])!
  const hair = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 1.62).scale(0.089, 0.112, 0.101).translate(0, 0.008, -0.008)
  const uArm = limb(0.052, 0.044, 0.29)
  const fArm = mergeGeometries([limb(0.042, 0.034, 0.27), new THREE.SphereGeometry(1, 12, 8).scale(0.036, 0.055, 0.022).translate(0, -0.33, 0.005)])!
  const thigh = limb(0.079, 0.058, 0.44, 16)
  const shin = limb(0.056, 0.042, 0.42, 14)
  // shoe: rounded toe, flat sole
  const foot = new THREE.SphereGeometry(1, 16, 10).scale(0.052, 0.05, 0.13)
  const fp = foot.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < fp.count; i++) if (fp.getY(i) < -0.018) fp.setY(i, -0.018)
  foot.computeVertexNormals()
  foot.translate(0, -0.03, 0.045)
  const skirt = new THREE.CylinderGeometry(0.17, 0.28, 0.95, 24, 2, true).translate(0, -0.95 / 2, 0)
  const drape = new THREE.BoxGeometry(0.1, 0.62, 0.02, 1, 4, 1).rotateZ(0.55).translate(0.02, 0.3, 0.12)
  const cap = mergeGeometries([
    new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.092, 0.07, 0.1).translate(0, 0.06, 0),
    new THREE.CylinderGeometry(0.075, 0.075, 0.008, 16).scale(1, 1, 0.9).translate(0, 0.065, 0.085),
  ])!
  const pack = new RoundedBox(0.3, 0.38, 0.16).translate(0, 0.3, -0.17)
  // long hair falling to the shoulders (women), replaces the old bun
  const bun = new THREE.SphereGeometry(1, 18, 12).scale(0.092, 0.16, 0.055).translate(0, -0.07, -0.062)
  const phone = new THREE.BoxGeometry(0.07, 0.13, 0.012).translate(0, -0.3, 0.05)
  const canopy = new THREE.ConeGeometry(0.62, 0.28, 16, 1, true).translate(0, 1.18, 0)
  const stick = new THREE.CylinderGeometry(0.012, 0.012, 0.95, 6).translate(0, 0.62, 0)
  const umbrella = mergeGeometries([canopy.toNonIndexed(), stick.toNonIndexed()])!
  return [torso, hips, head, hair, uArm, uArm, fArm, fArm, thigh, thigh, shin, shin, foot, foot, skirt, drape, cap, pack, bun, phone, umbrella, torsoF]
}

/** Shared face texture (white = skin; multiplied by each instance's skin colour). */
let _face: THREE.CanvasTexture | null = null
export function faceTexture() {
  if (_face) return _face
  const W = 512, H = 256
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  const cx = 128 // front of the head (u = 0.25)
  const ell = (x: number, y: number, rx: number, ry: number, col: string, a = 1) => {
    g.globalAlpha = a
    g.fillStyle = col
    g.beginPath()
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
  // soft cheek/eye-socket shading
  for (const s of [-1, 1]) ell(cx + s * 26, 112, 18, 11, '#c9a48e', 0.35)
  // eyes: iris + lash line
  for (const s of [-1, 1]) {
    ell(cx + s * 25, 113, 9, 5.5, '#f4efe9')
    ell(cx + s * 25, 113, 4.6, 4.6, '#2b1a12')
    g.strokeStyle = '#1a110c'
    g.lineWidth = 2.2
    g.beginPath()
    g.ellipse(cx + s * 25, 114, 10, 6, 0, Math.PI * 1.05, Math.PI * 1.95)
    g.stroke()
    // eyebrow
    g.lineWidth = 3.4
    g.beginPath()
    g.moveTo(cx + s * 13, 99)
    g.quadraticCurveTo(cx + s * 25, 94, cx + s * 37, 100)
    g.stroke()
  }
  // nose
  ell(cx, 136, 6, 8, '#b98f78', 0.45)
  ell(cx - 4, 141, 2.4, 1.6, '#6b4636', 0.6)
  ell(cx + 4, 141, 2.4, 1.6, '#6b4636', 0.6)
  // lips
  ell(cx, 158, 12, 3.6, '#9a5a52', 0.85)
  ell(cx, 161, 9, 3, '#a8665d', 0.7)
  // ears hint
  for (const s of [-1, 1]) ell(cx + s * 128, 122, 7, 14, '#d9b8a3', 0.5)
  _face = new THREE.CanvasTexture(cv)
  _face.colorSpace = THREE.SRGBColorSpace
  _face.anisotropy = 4
  return _face
}

export interface Appearance {
  colors: THREE.Color[] // per part
  visible: boolean[] // per part
  height: number
  female: boolean
  elderly: boolean
  skirtLen: number // 1 = saree to ankle, 0.55 = kurta
}

const SKIN = ['#5e3b27', '#6f4430', '#7d4f36', '#8d5a3b', '#a8714c', '#b9835b', '#c69373']
const HAIR = ['#141110', '#1a1410', '#20160f', '#2b1d14']
const SHIRT = ['#f2f2ee', '#cfe0f0', '#f3d6dc', '#d9d9d4', '#b9c9b0', '#e8e0c8', '#a7b9d6', '#ffffff']
const TEE = ['#c0392b', '#2e86de', '#27ae60', '#f39c12', '#8e44ad', '#1f2a36', '#e84393', '#16a085', '#7f8c8d', '#f1c40f']
const TROUSER = ['#1f2329', '#2c3440', '#3b3f45', '#5a5048', '#6b6152', '#24324a']
const JEANS = ['#2f4a6d', '#3a5a80', '#22344d', '#4a6283']
const SAREE = ['#c0172f', '#d63384', '#f08c00', '#0b7a75', '#6f42c1', '#e8b100', '#1864ab', '#2b8a3e', '#ff6b6b']
const KURTA = ['#f1e3c6', '#ffffff', '#ffd8a8', '#c3fae8', '#ffc9c9', '#d0bfff', '#a5d8ff']
const SHOES = ['#1a1a1a', '#3b2a1e', '#e9e5dc', '#5a3d2b']

export function makeAppearance(kind: NPCKind, seed: number): Appearance {
  const r = mulberry32(seed)
  const c = (s: string) => new THREE.Color(s)
  const colors: THREE.Color[] = Array.from({ length: PART_COUNT }, () => c('#888'))
  const visible = Array.from({ length: PART_COUNT }, (_, i) => i <= PART.footR)
  let female = r() < 0.42
  let elderly = kind === 'elderly'
  if (kind === 'police' || kind === 'guard' || kind === 'delivery') female = r() < 0.08
  const skin = c(kind === 'tourist' && r() < 0.5 ? pick(r, ['#e9c6aa', '#f1d3bd', '#d9a882']) : pick(r, SKIN))
  const hair = c(elderly ? pick(r, ['#bdbab4', '#d6d3cd', '#8f8b85']) : pick(r, HAIR))
  let top = c(pick(r, TEE)),
    bottom = c(pick(r, JEANS)),
    shoes = c(pick(r, SHOES))
  let longSleeve = r() < 0.35
  let skirtLen = 0
  let skirtColor = top
  switch (kind) {
    case 'office':
      top = c(pick(r, SHIRT))
      bottom = c(pick(r, TROUSER))
      longSleeve = r() < 0.7
      break
    case 'student':
      visible[PART.pack] = r() < 0.75
      colors[PART.pack] = c(pick(r, TEE))
      break
    case 'elderly':
      top = c(pick(r, ['#f4f1ea', '#e9e2d0', '#d8d2c2']))
      bottom = c(pick(r, ['#f4f1ea', '#e9e2d0', '#7a7266']))
      longSleeve = true
      if (!female) skirtLen = 0.55
      skirtColor = top
      break
    case 'delivery':
      top = c(pick(r, ['#d63a2f', '#e8771e', '#e7c11c']))
      visible[PART.pack] = true
      colors[PART.pack] = top.clone().multiplyScalar(0.8)
      visible[PART.cap] = r() < 0.4
      colors[PART.cap] = top
      break
    case 'tourist':
      top = c(pick(r, ['#ffffff', '#f6e7c1', '#9ad0f5', '#c5e1a5']))
      bottom = c(pick(r, ['#c8b28e', '#e8e2d0', '#3a5a80']))
      visible[PART.pack] = r() < 0.6
      colors[PART.pack] = c('#4a5a3a')
      visible[PART.cap] = r() < 0.4
      colors[PART.cap] = c('#e8e0c8')
      break
    case 'police':
      top = c('#f2f2ee')
      bottom = c('#1f2c4c')
      visible[PART.cap] = true
      colors[PART.cap] = c('#f8f8f8')
      shoes = c('#111')
      break
    case 'guard':
      top = c(pick(r, ['#5d6b7a', '#2f3e57']))
      bottom = top.clone().multiplyScalar(0.8)
      visible[PART.cap] = true
      colors[PART.cap] = top.clone().multiplyScalar(0.7)
      shoes = c('#111')
      longSleeve = true
      break
    case 'vendor':
      top = c(pick(r, ['#f4f1ea', '#c9b48a', '#8a5a3b', '#d9d2c0', '#5b7a99']))
      bottom = c(pick(r, ['#6b6152', '#3b3f45', '#e9e2d0']))
      break
    default:
      break
  }
  if (female && kind !== 'police' && kind !== 'guard' && kind !== 'delivery') {
    const roll = r()
    if (roll < 0.38 || (elderly && roll < 0.7)) {
      // saree
      skirtLen = 1
      skirtColor = c(pick(r, SAREE))
      top = skirtColor.clone().offsetHSL(0.05, 0, -0.1)
      visible[PART.drape] = true
      colors[PART.drape] = skirtColor
    } else if (roll < 0.75) {
      // salwar kameez + dupatta
      skirtLen = 0.55
      top = c(pick(r, KURTA.concat(SAREE)))
      skirtColor = top
      bottom = c(pick(r, KURTA))
      visible[PART.drape] = r() < 0.7
      colors[PART.drape] = c(pick(r, SAREE))
    }
    visible[PART.bun] = true
    colors[PART.bun] = hair
  }
  if (skirtLen > 0) {
    visible[PART.skirt] = true
    colors[PART.skirt] = skirtColor
  }
  colors[PART.torso] = top
  colors[PART.torsoF] = top
  visible[PART.torso] = !female
  visible[PART.torsoF] = female
  colors[PART.hips] = skirtLen > 0 ? skirtColor : bottom
  colors[PART.head] = skin
  colors[PART.hair] = hair
  colors[PART.uArmL] = colors[PART.uArmR] = top
  colors[PART.fArmL] = colors[PART.fArmR] = longSleeve ? top : skin
  colors[PART.thighL] = colors[PART.thighR] = bottom
  colors[PART.shinL] = colors[PART.shinR] = bottom
  colors[PART.footL] = colors[PART.footR] = shoes
  colors[PART.phone] = c('#151515')
  colors[PART.umbrella] = c(pick(r, ['#1b1b1b', '#1f3f7a', '#7a1f2a', '#2f6b3a', '#d9a62b', '#5a2a6b']))
  const height = elderly ? 0.93 + r() * 0.05 : female ? 0.91 + r() * 0.07 : 0.96 + r() * 0.09
  return { colors, visible, height, female, elderly, skirtLen }
}

export interface Pose {
  thighL: number
  thighR: number
  kneeL: number
  kneeR: number
  armL: number
  armR: number
  armZL: number
  armZR: number
  elbowL: number
  elbowR: number
  lean: number
  twist: number
  headYaw: number
  headPitch: number
  hipsY: number
  phone: boolean
  umbrella: boolean
}

export const newPose = (): Pose => ({
  thighL: 0, thighR: 0, kneeL: 0, kneeR: 0, armL: 0, armR: 0, armZL: 0.06, armZR: -0.06, elbowL: -0.1, elbowR: -0.1,
  lean: 0, twist: 0, headYaw: 0, headPitch: 0, hipsY: 0.93, phone: false, umbrella: false,
})

const mRoot = new THREE.Matrix4()
const mHips = new THREE.Matrix4()
const mTorso = new THREE.Matrix4()
const mA = new THREE.Matrix4()
const mB = new THREE.Matrix4()
const mL = new THREE.Matrix4()
const e = new THREE.Euler()
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const sv = new THREE.Vector3()

function local(rx: number, ry: number, rz: number, x: number, y: number, z: number) {
  e.set(rx, ry, rz, 'YXZ')
  return mL.makeRotationFromEuler(e).setPosition(x, y, z)
}

/** Writes all part matrices for one NPC into the instanced meshes. */
export function writeBody(meshes: THREE.InstancedMesh[], i: number, x: number, y: number, z: number, yaw: number, ap: Appearance, p: Pose) {
  mRoot.makeRotationY(yaw)
  sv.set(ap.height, ap.height, ap.height)
  mRoot.scale(sv)
  mRoot.setPosition(x, y, z)
  mHips.multiplyMatrices(mRoot, local(0, 0, 0, 0, p.hipsY, 0))
  meshes[PART.hips].setMatrixAt(i, mHips)
  const stoop = ap.elderly ? 0.22 : 0
  mTorso.multiplyMatrices(mHips, local(p.lean + stoop, p.twist, 0, 0, 0.04, 0))
  meshes[PART.torso].setMatrixAt(i, ap.female ? ZERO : mTorso)
  meshes[PART.torsoF].setMatrixAt(i, ap.female ? mTorso : ZERO)
  // head
  mA.multiplyMatrices(mTorso, local(p.headPitch - stoop * 0.6, p.headYaw, 0, 0, 0.7, 0.01))
  meshes[PART.head].setMatrixAt(i, mA)
  meshes[PART.hair].setMatrixAt(i, mA)
  meshes[PART.cap].setMatrixAt(i, ap.visible[PART.cap] ? mA : ZERO)
  meshes[PART.bun].setMatrixAt(i, ap.visible[PART.bun] ? mA : ZERO)
  meshes[PART.drape].setMatrixAt(i, ap.visible[PART.drape] ? mTorso : ZERO)
  meshes[PART.pack].setMatrixAt(i, ap.visible[PART.pack] ? mTorso : ZERO)
  meshes[PART.umbrella].setMatrixAt(i, p.umbrella ? mB.multiplyMatrices(mTorso, local(0, 0, 0, -0.16, 0.12, 0.08)) : ZERO)
  // arms
  for (const side of [1, -1]) {
    const sh = side === 1 ? p.armL : p.armR
    const shz = side === 1 ? p.armZL : p.armZR
    const el = side === 1 ? p.elbowL : p.elbowR
    mA.multiplyMatrices(mTorso, local(sh, 0, shz, side * 0.2, 0.5, -0.005))
    meshes[side === 1 ? PART.uArmL : PART.uArmR].setMatrixAt(i, mA)
    mB.multiplyMatrices(mA, local(el, 0, 0, 0, -0.3, 0))
    meshes[side === 1 ? PART.fArmL : PART.fArmR].setMatrixAt(i, mB)
    if (side === -1) meshes[PART.phone].setMatrixAt(i, p.phone ? mB : ZERO)
  }
  // legs
  for (const side of [1, -1]) {
    const th = side === 1 ? p.thighL : p.thighR
    const kn = side === 1 ? p.kneeL : p.kneeR
    mA.multiplyMatrices(mHips, local(th, 0, 0, side * 0.088, -0.03, 0))
    meshes[side === 1 ? PART.thighL : PART.thighR].setMatrixAt(i, mA)
    mB.multiplyMatrices(mA, local(kn, 0, 0, 0, -0.44, 0))
    meshes[side === 1 ? PART.shinL : PART.shinR].setMatrixAt(i, mB)
    mA.multiplyMatrices(mB, local(-kn * 0.3, 0, 0, 0, -0.44, 0))
    meshes[side === 1 ? PART.footL : PART.footR].setMatrixAt(i, mA)
  }
  if (ap.visible[PART.skirt]) {
    mA.multiplyMatrices(mHips, local(0, 0, 0, 0, 0.08, 0))
    mA.scale(sv.set(1, ap.skirtLen, 1))
    meshes[PART.skirt].setMatrixAt(i, mA)
  } else meshes[PART.skirt].setMatrixAt(i, ZERO)
}

export function hideBody(meshes: THREE.InstancedMesh[], i: number) {
  for (const m of meshes) m.setMatrixAt(i, ZERO)
}
