import * as THREE from 'three'
import { detailNormal, detailTexture, facadeTexture, frondTexture, leafTexture, radialTexture, signAtlasTexture, type FacadeStyle } from '../utils/textures'

/** Shared materials (created once, reused by every chunk). Night-dependent values updated per frame. */
export const FACADE_ORDER: (FacadeStyle | 'roof')[] = ['shop', 'residential', 'office', 'government', 'colonial', 'roof']

let _mats: ReturnType<typeof create> | null = null

function create() {
  const detail = detailTexture()
  const facades = FACADE_ORDER.map((style) => {
    if (style === 'roof')
      return new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 })
    const f = facadeTexture(style)
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: f.map,
      emissiveMap: f.emissive,
      emissive: new THREE.Color(style === 'office' ? '#dfe9ff' : '#ffd59a'),
      emissiveIntensity: 0,
      normalMap: f.normal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: f.orm,
      metalnessMap: f.orm,
      roughness: 1,
      metalness: 1,
      envMapIntensity: style === 'office' ? 1.4 : 1,
    })
  })
  const signAtlas = signAtlasTexture()
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, normalMap: detailNormal(), normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 0.5 })
  upgradeGround(ground)
  return {
    ground,
    water: new THREE.MeshStandardMaterial({ color: '#2f6f7c', roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.94, normalMap: waterNormal(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.6 }),
    vehicle: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.24, envMapIntensity: 1.25 }),
    foliage: new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 }),
    frond: new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.7 }),
    facades,
    props: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    signs: new THREE.MeshStandardMaterial({ map: signAtlas, emissiveMap: signAtlas, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.7 }),
    pools: new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,214,150,0.85)', 'rgba(255,190,110,0)'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    lod: new THREE.MeshLambertMaterial({ vertexColors: true }),
    lodNight: new THREE.Color('#ffffff'),
  }
}

export function materials() {
  if (!_mats) _mats = create()
  return _mats
}

/** night: 0 (day) .. 1 (full night). */
export function updateMaterialsForTime(night: number, rain = 0) {
  const m = materials()
  for (let i = 0; i < m.facades.length - 1; i++) m.facades[i].emissiveIntensity = night * (i === 0 ? 1.1 : 0.9)
  m.signs.emissiveIntensity = night * 0.55
  m.pools.opacity = night * 0.9
  // glow objects (lamps, headlights) are dim in daylight, bright at night
  const g = 0.55 + night * 1.6
  m.glow.color.setRGB(g, g, g)
  m.water.roughness = 0.04 + rain * 0.1
  // gently moving water
  const wn = m.water.normalMap!
  wn.offset.x = (performance.now() * 0.000012) % 1
  wn.offset.y = (performance.now() * 0.000008) % 1
  // wet streets: darker, glossier
  m.ground.color.setScalar(1 - rain * 0.32)
  m.ground.roughness = 0.96 - rain * 0.62
  m.ground.metalness = rain * 0.18
}

let _waterNormal: THREE.Texture | null = null
function waterNormal() {
  if (!_waterNormal) {
    const t = detailNormal().clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(3, 3)
    t.needsUpdate = true
    _waterNormal = t
  }
  return _waterNormal
}

/**
 * Photo-scanned ground (ambientCG, CC0): asphalt on roads, paving on footpaths, grass in parks.
 * The surface type comes from the vertex colour the city builder already assigns, and each
 * texture is normalised by its average colour so it adds real detail without changing the
 * designed palette. Until the JPGs arrive the old procedural detail is used.
 */
function upgradeGround(m: THREE.MeshStandardMaterial) {
  const base = import.meta.env.BASE_URL + 'assets/textures/'
  const loader = new THREE.TextureLoader()
  const u = {
    tA: { value: null as THREE.Texture | null },
    tP: { value: null as THREE.Texture | null },
    tG: { value: null as THREE.Texture | null },
    nA: { value: null as THREE.Texture | null },
    nP: { value: null as THREE.Texture | null },
    nG: { value: null as THREE.Texture | null },
    mA: { value: new THREE.Vector3(1, 1, 1) },
    mP: { value: new THREE.Vector3(1, 1, 1) },
    mG: { value: new THREE.Vector3(1, 1, 1) },
    uReady: { value: 0 },
  }
  const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const mean = (img: HTMLImageElement | ImageBitmap) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 32
    const g = cv.getContext('2d')!
    g.drawImage(img as CanvasImageSource, 0, 0, 32, 32)
    const d = g.getImageData(0, 0, 32, 32).data
    const v = new THREE.Vector3()
    for (let i = 0; i < d.length; i += 4) v.add(new THREE.Vector3(toLin(d[i] / 255), toLin(d[i + 1] / 255), toLin(d[i + 2] / 255)))
    return v.multiplyScalar(1 / (d.length / 4)).max(new THREE.Vector3(0.02, 0.02, 0.02))
  }
  let pending = 6
  const done = () => {
    if (--pending === 0) {
      u.uReady.value = 1
      m.normalScale.set(0.75, 0.75)
    }
  }
  const load = (name: string, color: boolean, slot: 'tA' | 'tP' | 'tG' | 'nA' | 'nP' | 'nG', meanSlot?: 'mA' | 'mP' | 'mG') => {
    loader.load(
      base + name,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.anisotropy = 8
        if (color) t.colorSpace = THREE.SRGBColorSpace
        if (meanSlot) u[meanSlot].value.copy(mean(t.image as HTMLImageElement))
        u[slot].value = t
        done()
      },
      undefined,
      () => {
        /* missing texture: keep the procedural detail */
      },
    )
  }
  load('asphalt_color.jpg', true, 'tA', 'mA')
  load('paving_color.jpg', true, 'tP', 'mP')
  load('grass_color.jpg', true, 'tG', 'mG')
  load('asphalt_normal.jpg', false, 'nA')
  load('paving_normal.jpg', false, 'nP')
  load('grass_normal.jpg', false, 'nG')
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        `uniform sampler2D tA, tP, tG, nA, nP, nG; uniform vec3 mA, mP, mG; uniform float uReady;
         void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `float gLum = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));
         float gGreen = vColor.g - max(vColor.r, vColor.b);
         float wG = smoothstep(0.012, 0.06, gGreen);
         float wP = (1.0 - wG) * smoothstep(0.3, 0.42, gLum);
         float wA = max(0.0, 1.0 - wG - wP);
         vec2 gUv = vMapUv;
         #ifdef USE_MAP
           vec3 det = texture2D(map, vMapUv).rgb;
           vec3 photo = texture2D(tA, gUv * 1.7).rgb / mA * wA + texture2D(tP, gUv * 2.2).rgb / mP * wP + texture2D(tG, gUv * 3.0).rgb / mG * wG;
           diffuseColor.rgb *= mix(det, clamp(photo, 0.0, 2.2), uReady);
         #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz,
           texture2D(nA, gUv * 1.7).xyz * wA + texture2D(nP, gUv * 2.2).xyz * wP + texture2D(nG, gUv * 3.0).xyz * wG, uReady) * 2.0 - 1.0;`,
        ),
      )
  }
  m.customProgramCacheKey = () => 'ground-photo-v1'
}
