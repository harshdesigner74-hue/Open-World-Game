import * as THREE from 'three'
import { GeoBuilder } from '../utils/geoBuilder'
import { mulberry32 } from '../utils/math'
import { emblemTexture } from '../utils/textures'
import type { Outfit } from '../state/store'

/**
 * The protagonist, modelled from the user's character sheet:
 *  - ~175 cm, average build, early twenties
 *  - voluminous wavy dark-brown hair with short tapered sides, light moustache & stubble
 *  - maroon-brown pullover hoodie (hood, drawstrings, kangaroo pocket, ribbed cuffs/hem)
 *    with a small orange chest emblem (original design — no third-party logos)
 *  - charcoal cargo trousers with thigh pockets
 *  - white low-top sneakers with dark side stripes
 *  - black smartwatch on the left wrist
 *
 * It is a jointed procedural rig (no skinning) animated by `animateRig` below.
 * See README → "Replacing the hero with a rigged model" for swapping in a GLB.
 */

export interface Rig {
  root: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  chest: THREE.Group
  neck: THREE.Group
  head: THREE.Group
  headVisual: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  ankleL: THREE.Group
  ankleR: THREE.Group
  mats: {
    skin: THREE.MeshStandardMaterial
    face: THREE.MeshStandardMaterial
    hoodie: THREE.MeshStandardMaterial
    hoodieDark: THREE.MeshStandardMaterial
    pants: THREE.MeshStandardMaterial
    pantsDark: THREE.MeshStandardMaterial
    shoes: THREE.MeshStandardMaterial
  }
  phase: number
  lastStepPhase: number
  /** clothing parts toggled by outfit style */
  parts: {
    hoodOnly: THREE.Object3D[]
    pocket: THREE.Object3D
    emblem: THREE.Object3D
    forearms: THREE.Mesh[]
    cuffs: THREE.Object3D[]
    kurta: THREE.Object3D
    collar: THREE.Object3D
    placket: THREE.Object3D
  }
}

const g = () => new THREE.Group()

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Tapered limb segment hanging down from its joint (top at y=0). */
function limb(r0: number, r1: number, len: number, mat: THREE.Material, sx = 1, sz = 1) {
  const geo = new THREE.CylinderGeometry(r0, r1, len, 14, 3)
  geo.translate(0, -len / 2, 0)
  geo.scale(sx, 1, sz)
  return mesh(geo, mat)
}

/** Sculpted head with planar UVs aligned to the face photo. */
function headGeometry() {
  const geo = new THREE.SphereGeometry(1, 48, 36)
  const p = geo.attributes.position
  const uv = geo.attributes.uv
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    let { x, y, z } = v
    const gx = x,
      gy = y,
      gz = z
    // narrower jaw and chin
    if (y < -0.15) {
      const k = Math.min(1, (-y - 0.15) / 0.85)
      x *= 1 - 0.24 * k
      if (z < 0) z *= 1 - 0.35 * k
    }
    // flatter face front, fuller cranium at back
    if (z > 0) z *= 0.94
    if (z < 0 && y > -0.1) z *= 1.06
    // nose
    const nose = Math.exp(-(gx * gx) / 0.012 - ((gy + 0.16) * (gy + 0.16)) / 0.035)
    if (gz > 0.5) z += 0.2 * nose
    // brow ridge
    const brow = Math.exp(-(gx * gx) / 0.25 - ((gy - 0.17) * (gy - 0.17)) / 0.008)
    if (gz > 0.5) z += 0.035 * brow
    // eye sockets
    for (const s of [-1, 1]) {
      const e = Math.exp(-((gx - s * 0.33) ** 2) / 0.012 - ((gy - 0.05) ** 2) / 0.008)
      if (gz > 0.5) z -= 0.04 * e
    }
    // chin forward
    if (gz > 0.4 && gy < -0.7) z += 0.05 * Math.min(1, (-gy - 0.7) / 0.2)
    p.setXYZ(i, x, y, z)
    // planar projection; back of head maps to the (skin-only) top edge of the texture
    if (gz > 0.12) uv.setXY(i, 0.5 + gx * 0.5, 0.5 + gy * 0.5)
    else uv.setXY(i, 0.5 + gx * 0.5, 0.995)
  }
  geo.scale(0.079, 0.106, 0.096)
  geo.computeVertexNormals()
  return geo
}

function hairGeometry(seed = 11) {
  const r = mulberry32(seed)
  const b = new GeoBuilder()
  const cols = ['#24180f', '#2e1f14', '#3a281a', '#1d140d', '#46301f']
  // close-cropped cap (tapered sides & back)
  const cap = new THREE.SphereGeometry(1, 36, 24, 0, Math.PI * 2, 0, 2.05)
  const cp = cap.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < cp.count; i++) {
    v.fromBufferAttribute(cp, i)
    let k = 1.035
    // hide the cap over the forehead/face & ears (pushed inside the head)
    if (v.z > 0.35 && v.y < 0.36) k = 0.8
    if (Math.abs(v.x) > 0.75 && v.y < 0.12 && v.z > -0.3) k = 0.85
    v.multiplyScalar(k)
    cp.setXYZ(i, v.x * 0.079, v.y * 0.106, v.z * 0.096)
  }
  cap.computeVertexNormals()
  b.addGeometry(cap, new THREE.Matrix4(), '#1f150e')
  // volume on top: clusters of wavy curls swept up and slightly to the wearer's left
  const ico = new THREE.IcosahedronGeometry(1, 1)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const add = (x: number, y: number, z: number, s: number, c: string) => {
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3))
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s * (1 + r() * 0.4), s * 0.8, s))
    b.addGeometry(ico, m, c)
  }
  for (let i = 0; i < 230; i++) {
    // sample points on upper head
    const th = r() * 1.05 // polar angle from top
    const ph = r() * Math.PI * 2
    let x = Math.sin(th) * Math.cos(ph)
    const y = Math.cos(th)
    let z = Math.sin(th) * Math.sin(ph)
    if (z < -0.6 && y < 0.6) continue // keep the back shorter
    const quiff = y > 0.5 && z > 0.05 ? 0.07 * (y - 0.5) * 2 + 0.03 : 0 // swept-up volume at the front-top
    const lift = 1.02 + (0.05 + r() * 0.08) * (0.4 + 0.6 * Math.max(0, y)) + (z > 0.2 ? 0.05 : 0) + quiff
    x += 0.06 // sweep
    z += 0.05
    add(x * 0.079 * lift, y * 0.106 * lift + 0.006, z * 0.096 * lift, 0.014 + r() * 0.011, cols[Math.floor(r() * cols.length)])
  }
  // fringe: a few locks falling onto the forehead (wearer's right side)
  for (let i = 0; i < 10; i++) {
    const x = -0.045 + r() * 0.07 - (i < 4 ? 0.02 : 0)
    const y = 0.052 + r() * 0.03 - (i < 4 ? 0.012 : 0)
    add(x, y, 0.092 + r() * 0.008, 0.012 + r() * 0.007, cols[Math.floor(r() * cols.length)])
  }
  return b.build()
}

function sneakerGeometry(side: 1 | -1, base: string) {
  const b = new GeoBuilder()
  // sole
  b.prim('box', 0, 0.018, 0.035, 0.1, 0.036, 0.275, '#efebe2')
  // upper (rounded)
  b.prim('sphere', 0, 0.062, 0.05, 0.095, 0.085, 0.27, base)
  b.prim('box', 0, 0.055, -0.03, 0.094, 0.07, 0.14, base)
  // collar & tongue
  b.prim('box', 0, 0.1, -0.055, 0.085, 0.03, 0.08, '#dcd8cf')
  b.prim('box', 0, 0.095, 0.045, 0.05, 0.03, 0.09, '#e4e1da', 0, -0.35)
  // two diagonal side stripes (original design) + heel tab
  for (const sx of [-1, 1])
    for (let k = 0; k < 2; k++) b.prim('box', sx * 0.048, 0.06, 0.02 - k * 0.032, 0.006, 0.065, 0.014, '#1b1b1b', 0, 0, 0.0)
  b.prim('box', 0, 0.07, -0.1, 0.05, 0.05, 0.012, '#1b1b1b')
  // laces
  for (let k = 0; k < 4; k++) b.prim('box', 0, 0.104 - k * 0.006, 0.06 - k * 0.025, 0.045, 0.006, 0.008, '#cfcac0')
  void side
  return b.build()
}

export function buildCharacter(face: THREE.Texture, skinColor: THREE.Color, outfit: Outfit): Rig {
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.62 }),
    face: new THREE.MeshStandardMaterial({ map: face, roughness: 0.6 }),
    hoodie: new THREE.MeshStandardMaterial({ color: outfit.hoodie, roughness: 0.92 }),
    hoodieDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(outfit.hoodie).multiplyScalar(0.72), roughness: 0.95 }),
    pants: new THREE.MeshStandardMaterial({ color: outfit.pants, roughness: 0.9 }),
    pantsDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(outfit.pants).multiplyScalar(0.85), roughness: 0.92 }),
    shoes: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
  }
  const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.4, metalness: 0.3 })
  const hairMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 })

  const root = g()
  const hips = g()
  hips.position.y = 0.96
  root.add(hips)

  // pelvis (trousers)
  const pelvisGeo = new THREE.SphereGeometry(1, 20, 14)
  pelvisGeo.scale(0.165, 0.11, 0.115)
  hips.add(mesh(pelvisGeo, mats.pants, 0, -0.03, 0))

  const spine = g()
  spine.position.y = 0.06
  hips.add(spine)
  const chest = g()
  chest.position.y = 0.2
  spine.add(chest)

  // torso (hoodie) as an elliptical lathe
  const prof = [
    [0.0, -0.36], [0.158, -0.36], [0.162, -0.3], [0.168, -0.2], [0.172, -0.08], [0.182, 0.05],
    [0.186, 0.14], [0.176, 0.22], [0.13, 0.27], [0.07, 0.29], [0.0, 0.295],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const torsoGeo = new THREE.LatheGeometry(prof, 28)
  torsoGeo.scale(1.1, 1, 0.7)
  chest.add(mesh(torsoGeo, mats.hoodie))
  // ribbed hem
  const hem = new THREE.CylinderGeometry(0.163, 0.16, 0.05, 28, 1, true)
  hem.scale(1.1, 1, 0.7)
  chest.add(mesh(hem, mats.hoodieDark, 0, -0.335, 0))
  // kangaroo pocket
  const pocket = new THREE.BoxGeometry(0.27, 0.13, 0.02)
  const pocketMesh = mesh(pocket, mats.hoodieDark, 0, -0.2, 0.112)
  chest.add(pocketMesh)
  const hoodOnly: THREE.Object3D[] = []
  // hood bunched behind the neck + collar
  const hoodGeo = new THREE.SphereGeometry(1, 20, 14)
  hoodGeo.scale(0.12, 0.075, 0.06)
  const hoodMesh = mesh(hoodGeo, mats.hoodie, 0, 0.245, -0.09)
  chest.add(hoodMesh)
  hoodOnly.push(hoodMesh)
  const collar = new THREE.TorusGeometry(0.068, 0.024, 10, 24)
  collar.rotateX(Math.PI / 2)
  const collarMesh = mesh(collar, mats.hoodie, 0, 0.275, 0.005)
  chest.add(collarMesh)
  // drawstrings
  for (const sx of [-0.032, 0.032]) {
    const s = new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 6)
    const d1 = mesh(s, mats.hoodieDark, sx, 0.17, 0.127)
    const d2 = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.025, 6), black, sx, 0.075, 0.13)
    chest.add(d1, d2)
    hoodOnly.push(d1, d2)
  }
  // chest emblem (wearer's left)
  const emb = new THREE.Mesh(
    new THREE.PlaneGeometry(0.085, 0.085),
    new THREE.MeshStandardMaterial({ map: emblemTexture(), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 }),
  )
  emb.position.set(0.075, 0.1, 0.1305)
  emb.rotation.y = 0.32
  chest.add(emb)

  // kurta: long tunic panel to the knees + placket (hidden unless style = kurta / shirt)
  const kurtaGeo = new THREE.CylinderGeometry(0.17, 0.215, 0.5, 20, 1, true)
  kurtaGeo.scale(1.12, 1, 0.78)
  const kurta = mesh(kurtaGeo, mats.hoodie, 0, -0.58, 0)
  kurta.visible = false
  ;(kurta.material as THREE.Material).side = THREE.DoubleSide
  chest.add(kurta)
  const placket = mesh(new THREE.BoxGeometry(0.035, 0.22, 0.01), mats.hoodieDark, 0, 0.13, 0.128)
  placket.visible = false
  chest.add(placket)

  // neck & head
  const neck = g()
  neck.position.y = 0.27
  chest.add(neck)
  neck.add(mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.12, 14), mats.skin, 0, 0.04, 0))
  const head = g()
  head.position.y = 0.105
  neck.add(head)
  const headVisual = g()
  head.add(headVisual)
  const headMesh = mesh(headGeometry(), mats.face, 0, 0.055, 0.008)
  headVisual.add(headMesh)
  const hair = mesh(hairGeometry(), hairMat, 0, 0.055, 0.008)
  headVisual.add(hair)
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 10, 8)
    ear.scale(0.012, 0.026, 0.018)
    headVisual.add(mesh(ear, mats.skin, s * 0.078, 0.05, -0.004))
  }

  // arms
  const forearms: THREE.Mesh[] = []
  const cuffs: THREE.Object3D[] = []
  const makeArm = (side: 1 | -1) => {
    const shoulder = g()
    shoulder.position.set(side * 0.195, 0.2, -0.01)
    chest.add(shoulder)
    // deltoid
    const delt = new THREE.SphereGeometry(0.06, 14, 10)
    shoulder.add(mesh(delt, mats.hoodie, 0, -0.01, 0))
    shoulder.add(limb(0.062, 0.054, 0.29, mats.hoodie, 1, 0.95))
    const elbow = g()
    elbow.position.y = -0.29
    shoulder.add(elbow)
    elbow.add(mesh(new THREE.SphereGeometry(0.054, 12, 8), mats.hoodie))
    const fore = limb(0.053, 0.046, 0.23, mats.hoodie, 1, 0.92)
    elbow.add(fore)
    forearms.push(fore)
    // ribbed cuff
    const cuff = limb(0.044, 0.043, 0.045, mats.hoodieDark)
    cuff.position.y = -0.225
    elbow.add(cuff)
    cuffs.push(cuff)
    // hand
    const hand = g()
    hand.position.y = -0.27
    elbow.add(hand)
    const wrist = new THREE.CylinderGeometry(0.03, 0.033, 0.04, 10)
    hand.add(mesh(wrist, mats.skin, 0, 0.01, 0))
    const palm = new THREE.SphereGeometry(1, 12, 10)
    palm.scale(0.042, 0.075, 0.024)
    hand.add(mesh(palm, mats.skin, 0, -0.055, 0.005))
    const thumb = new THREE.CapsuleGeometry(0.012, 0.035, 4, 6)
    const th = mesh(thumb, mats.skin, side * -0.03, -0.04, 0.025)
    th.rotation.z = side * 0.5
    hand.add(th)
    if (side === 1) {
      // smartwatch on the LEFT wrist
      const band = new THREE.CylinderGeometry(0.035, 0.035, 0.022, 14, 1, true)
      const bandMesh = mesh(band, black, 0, 0.022, 0)
      bandMesh.material = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6, side: THREE.DoubleSide })
      hand.add(bandMesh)
      hand.add(mesh(new THREE.BoxGeometry(0.012, 0.036, 0.032), black, side * 0.036, 0.022, 0))
    }
    return { shoulder, elbow }
  }
  const L = makeArm(1)
  const R = makeArm(-1)

  // legs
  const makeLeg = (side: 1 | -1) => {
    const hip = g()
    hip.position.set(side * 0.092, -0.04, 0)
    hips.add(hip)
    hip.add(limb(0.084, 0.064, 0.45, mats.pants, 1, 1.02))
    // cargo pocket with flap on the outer thigh
    hip.add(mesh(new THREE.BoxGeometry(0.016, 0.14, 0.11), mats.pantsDark, side * 0.071, -0.27, 0.0))
    hip.add(mesh(new THREE.BoxGeometry(0.02, 0.03, 0.115), mats.pants, side * 0.072, -0.195, 0.0))
    const knee = g()
    knee.position.y = -0.44
    hip.add(knee)
    knee.add(mesh(new THREE.SphereGeometry(0.064, 12, 8), mats.pants))
    knee.add(limb(0.062, 0.057, 0.43, mats.pants))
    const ankle = g()
    ankle.position.y = -0.43
    knee.add(ankle)
    const shoe = mesh(sneakerGeometry(side, '#f1efe9'), mats.shoes, 0, -0.05, 0.0)
    ankle.add(shoe)
    return { hip, knee, ankle }
  }
  const LL = makeLeg(1)
  const RL = makeLeg(-1)

  return {
    root, hips, spine, chest, neck, head, headVisual,
    shoulderL: L.shoulder, shoulderR: R.shoulder, elbowL: L.elbow, elbowR: R.elbow,
    hipL: LL.hip, hipR: RL.hip, kneeL: LL.knee, kneeR: RL.knee, ankleL: LL.ankle, ankleR: RL.ankle,
    mats, phase: 0, lastStepPhase: 0,
    parts: { hoodOnly, pocket: pocketMesh, emblem: emb, forearms, cuffs, kurta, collar: collarMesh, placket },
  }
}

/** Switch clothing style: hoodie (reference look), t-shirt, kurta or shirt. */
export function applyStyle(rig: Rig, style: 'hoodie' | 'tshirt' | 'kurta' | 'shirt') {
  const P = rig.parts
  const hoodie = style === 'hoodie'
  for (const o of P.hoodOnly) o.visible = hoodie
  P.pocket.visible = hoodie
  P.emblem.visible = hoodie || style === 'tshirt'
  P.kurta.visible = style === 'kurta'
  P.placket.visible = style === 'kurta' || style === 'shirt'
  P.collar.visible = style !== 'tshirt'
  for (const f of P.forearms) f.material = style === 'tshirt' ? rig.mats.skin : rig.mats.hoodie
  for (const c of P.cuffs) c.visible = style !== 'tshirt'
}

export function applyOutfit(rig: Rig, outfit: Outfit) {
  rig.mats.hoodie.color.set(outfit.hoodie)
  rig.mats.hoodieDark.color.set(outfit.hoodie).multiplyScalar(0.72)
  rig.mats.pants.color.set(outfit.pants)
  rig.mats.pantsDark.color.set(outfit.pants).multiplyScalar(0.85)
}

/* ======================================== ANIMATION ======================================== */

export interface AnimInput {
  speed: number
  grounded: boolean
  vy: number
  sitting: boolean
  time: number
  sprinting: boolean
  riding?: boolean
}

const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt))
const sstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Procedural locomotion: idle ↔ walk ↔ jog ↔ sprint, jump, sit. Returns true on a footstep. */
export function animateRig(rig: Rig, a: AnimInput, dt: number): boolean {
  const v = a.speed
  const move = sstep(0.05, 0.7, v) * (a.grounded ? 1 : 0)
  const run = sstep(2.2, 5.5, v)
  const air = a.grounded ? 0 : 1
  const sit = a.sitting ? 1 : 0
  const stepsPerSec = Math.min(3.4, 1.15 + v * 0.36)
  rig.phase += dt * Math.PI * stepsPerSec * (move > 0.01 ? 1 : 0)
  const ph = rig.phase
  const s = Math.sin(ph)
  const L = 12

  const legAmp = 0.42 + 0.5 * run
  let tL = -s * legAmp * move
  let tR = s * legAmp * move
  let kL = (0.08 + Math.max(0, Math.sin(ph + 0.9)) * (0.75 + 0.9 * run)) * move
  let kR = (0.08 + Math.max(0, Math.sin(ph + 0.9 + Math.PI)) * (0.75 + 0.9 * run)) * move
  let aL = 0
  let aR = 0
  const armAmp = 0.35 + 0.45 * run
  let shL = s * armAmp * move
  let shR = -s * armAmp * move
  let elL = -(0.18 + 1.1 * run) * move - 0.08
  let elR = -(0.18 + 1.1 * run) * move - 0.08
  let shZL = 0.07 + 0.05 * run
  let shZR = -0.07 - 0.05 * run
  let hipsY = 0.96 + Math.cos(ph * 2) * (0.012 + 0.03 * run) * move - 0.03 * run * move
  let spineX = (0.04 + 0.16 * run) * move
  let spineY = s * (0.07 + 0.05 * run) * move
  let headX = -spineX * 0.6
  let headY = 0
  // idle breathing / glancing around
  const idle = (1 - move) * (1 - air) * (1 - sit)
  spineX += Math.sin(a.time * 1.6) * 0.012 * idle
  headY += Math.sin(a.time * 0.37) * 0.35 * idle * Math.max(0, Math.sin(a.time * 0.11))
  shL += Math.sin(a.time * 1.6) * 0.015 * idle
  shR += Math.sin(a.time * 1.6 + 0.4) * 0.015 * idle

  if (air) {
    const up = a.vy > 0 ? 1 : 0.6
    tL = -0.55 * up
    tR = 0.1
    kL = 0.95
    kR = 0.55
    shL = -0.45
    shR = 0.35
    shZL = 0.35
    shZR = -0.35
    elL = -0.6
    elR = -0.4
    spineX = 0.08
  }
  if (a.riding) {
    tL = tR = -1.15
    kL = kR = 1.25
    aL = aR = 0.25
    shL = shR = -1.05
    elL = elR = -0.35
    shZL = 0.18
    shZR = -0.18
    hipsY = 0.53
    spineX = 0.18
    spineY = 0
    headX = -0.12
  } else if (sit) {
    tL = tR = -1.5
    kL = kR = 1.5
    aL = aR = 0
    shL = shR = -0.42
    elL = elR = -0.55
    shZL = 0.12
    shZR = -0.12
    hipsY = 0.53
    spineX = -0.06
    spineY = 0
    headX = 0.05
  }
  rig.hipL.rotation.x = damp(rig.hipL.rotation.x, tL, L, dt)
  rig.hipR.rotation.x = damp(rig.hipR.rotation.x, tR, L, dt)
  rig.kneeL.rotation.x = damp(rig.kneeL.rotation.x, kL, L, dt)
  rig.kneeR.rotation.x = damp(rig.kneeR.rotation.x, kR, L, dt)
  rig.ankleL.rotation.x = damp(rig.ankleL.rotation.x, aL - kL * 0.25 * move, L, dt)
  rig.ankleR.rotation.x = damp(rig.ankleR.rotation.x, aR - kR * 0.25 * move, L, dt)
  rig.shoulderL.rotation.x = damp(rig.shoulderL.rotation.x, shL, L, dt)
  rig.shoulderR.rotation.x = damp(rig.shoulderR.rotation.x, shR, L, dt)
  rig.shoulderL.rotation.z = damp(rig.shoulderL.rotation.z, shZL, L, dt)
  rig.shoulderR.rotation.z = damp(rig.shoulderR.rotation.z, shZR, L, dt)
  rig.elbowL.rotation.x = damp(rig.elbowL.rotation.x, elL, L, dt)
  rig.elbowR.rotation.x = damp(rig.elbowR.rotation.x, elR, L, dt)
  rig.hips.position.y = damp(rig.hips.position.y, hipsY, 16, dt)
  rig.spine.rotation.x = damp(rig.spine.rotation.x, spineX, 8, dt)
  rig.spine.rotation.y = damp(rig.spine.rotation.y, spineY, L, dt)
  rig.head.rotation.x = damp(rig.head.rotation.x, headX, 6, dt)
  rig.head.rotation.y = damp(rig.head.rotation.y, headY, 3, dt)

  // footstep events at each half cycle
  const stepIdx = Math.floor(ph / Math.PI)
  const stepped = move > 0.3 && stepIdx !== rig.lastStepPhase
  rig.lastStepPhase = stepIdx
  return stepped
}
