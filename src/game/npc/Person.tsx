import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { runtime } from '../state/runtime'
import { PART, PART_COUNT, faceTexture, newPose, partGeometries, writeBody, type Appearance } from './humanBody'

/**
 * A single named character (friends, love interests, story cast) drawn with the same smooth
 * body as the crowd, but as its own small set of meshes so it can stand anywhere and act:
 * idle breathing, weight shifts, turning to face the player, and talking gestures.
 */
export interface Look {
  female: boolean
  skin: string
  hair: string
  top: string
  bottom: string
  shoes: string
  skirt?: string
  skirtLen?: number
  drape?: string
  cap?: string
  height?: number
}

export function lookAppearance(l: Look): Appearance {
  const c = (s: string) => new THREE.Color(s)
  const colors = Array.from({ length: PART_COUNT }, () => c('#888'))
  const visible = Array.from({ length: PART_COUNT }, (_, i) => i <= PART.footR)
  colors[PART.torso] = colors[PART.torsoF] = c(l.top)
  visible[PART.torso] = !l.female
  visible[PART.torsoF] = l.female
  colors[PART.head] = c(l.skin)
  colors[PART.hair] = c(l.hair)
  colors[PART.uArmL] = colors[PART.uArmR] = c(l.top)
  colors[PART.fArmL] = colors[PART.fArmR] = c(l.skin)
  colors[PART.thighL] = colors[PART.thighR] = colors[PART.shinL] = colors[PART.shinR] = c(l.bottom)
  colors[PART.footL] = colors[PART.footR] = c(l.shoes)
  colors[PART.hips] = c(l.skirt && l.skirtLen ? l.skirt : l.bottom)
  if (l.skirt && l.skirtLen) {
    visible[PART.skirt] = true
    colors[PART.skirt] = c(l.skirt)
  }
  if (l.drape) {
    visible[PART.drape] = true
    colors[PART.drape] = c(l.drape)
  }
  if (l.cap) {
    visible[PART.cap] = true
    colors[PART.cap] = c(l.cap)
  }
  if (l.female) {
    visible[PART.bun] = true
    colors[PART.bun] = c(l.hair)
  }
  return { colors, visible, height: l.height ?? (l.female ? 0.95 : 1.0), female: l.female, elderly: false, skirtLen: l.skirtLen ?? 0 }
}

let _geos: THREE.BufferGeometry[] | null = null
let _mats: { body: THREE.MeshStandardMaterial; head: THREE.MeshStandardMaterial } | null = null
const shared = () => {
  _geos ??= partGeometries()
  _mats ??= { body: new THREE.MeshStandardMaterial({ roughness: 0.75 }), head: new THREE.MeshStandardMaterial({ roughness: 0.6, map: faceTexture() }) }
  return { geos: _geos, mats: _mats }
}

export interface PersonHandle {
  x: number
  z: number
  yaw: number
  visible: boolean
  talking: boolean
  /** face the player when within this distance */
  watch: number
}

export function Person({ look, handle }: { look: Look; handle: React.MutableRefObject<PersonHandle> }) {
  const { geos, mats } = shared()
  const ap = useMemo(() => lookAppearance(look), [look])
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  const pose = useMemo(() => newPose(), [])
  const st = useRef({ t: Math.random() * 10, yaw: handle.current.yaw })

  useEffect(() => {
    meshes.current.forEach((m, i) => {
      if (!m) return
      m.setColorAt(0, ap.colors[i])
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    })
  }, [ap])

  useFrame((_, dt) => {
    const h = handle.current
    const list = meshes.current as THREE.InstancedMesh[]
    if (list.some((m) => !m)) return
    const vis = h.visible && !runtime.interior
    for (const m of list) m.visible = vis
    if (!vis) return
    st.current.t += dt
    const t = st.current.t
    const P = runtime.player.pos
    const d = Math.hypot(P.x - h.x, P.z - h.z)
    const want = d < h.watch ? Math.atan2(P.x - h.x, P.z - h.z) : h.yaw
    let dy = want - st.current.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    st.current.yaw += dy * Math.min(1, dt * 3)
    // idle: breathing, a slow weight shift, small arm sway; gestures while talking
    pose.lean = Math.sin(t * 1.6) * 0.012
    pose.twist = Math.sin(t * 0.35) * 0.05
    pose.hipsY = 0.93 + Math.sin(t * 1.6) * 0.004
    pose.thighL = Math.sin(t * 0.35) * 0.04
    pose.thighR = -pose.thighL
    pose.headYaw = Math.sin(t * 0.5) * 0.12
    pose.headPitch = Math.sin(t * 0.7) * 0.04
    const talk = h.talking ? 1 : 0
    pose.armL = 0.05 + talk * (0.55 + Math.sin(t * 3.1) * 0.25)
    pose.elbowL = -0.15 - talk * (0.9 + Math.sin(t * 2.3) * 0.3)
    pose.armR = 0.04 + talk * (0.2 + Math.sin(t * 2.6 + 1) * 0.2)
    pose.elbowR = -0.12 - talk * 0.5
    pose.armZL = 0.08
    pose.armZR = -0.08
    writeBody(list, 0, h.x, 0.04, h.z, st.current.yaw, ap, pose)
    for (const m of list) m.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      {geos.map((g, i) => (
        <instancedMesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m
          }}
          args={[g, i === PART.head ? mats.head : mats.body, 1]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </>
  )
}
