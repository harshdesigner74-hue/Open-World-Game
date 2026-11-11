import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier'
import type { Collider } from '@dimforge/rapier3d-compat'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { input } from '../input/input'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { clamp, damp, dampAngle } from '../utils/math'
import { animateRig, applyOutfit, applyStyle, buildCharacter, type Rig } from './characterModel'
import { buildFaceTexture } from './faceTexture'
import { DRIVE } from '../vehicles/specs'

const WALK = 1.7
const JOG = 3.6
const SPRINT = 7.0
const GRAVITY = 22
const JUMP_V = 7.2
const CAM_MODES = [
  { dist: 4.4, height: 1.62, side: 0.38 },
  { dist: 8.0, height: 2.0, side: 0.0 },
  { dist: 0, height: 1.68, side: 0 }, // first person
]

export function Player() {
  const body = useRef<RapierRigidBody>(null)
  const colliderRef = useRef<Collider>(null)
  const visual = useRef<THREE.Group>(null)
  const { world, rapier } = useRapier()
  const camera = useThree((s) => s.camera)
  const photoFace = useGame((s) => s.settings.photoFace)
  const outfit = useGame((s) => s.outfit)
  const [rig, setRig] = useState<Rig | null>(null)

  // build the character (async: needs the reference photo)
  useEffect(() => {
    let alive = true
    buildFaceTexture(photoFace).then(({ texture, skin }) => {
      if (!alive) return
      setRig(buildCharacter(texture, skin, useGame.getState().outfit))
    })
    return () => {
      alive = false
    }
  }, [photoFace])
  const style = useGame((s) => s.progress.style)
  useEffect(() => {
    if (rig) applyOutfit(rig, outfit)
  }, [rig, outfit])
  useEffect(() => {
    if (rig) applyStyle(rig, style)
  }, [rig, style])

  // created in an effect (not useMemo) so StrictMode's mount/unmount/remount can't leave a freed controller
  const controllerRef = useRef<ReturnType<typeof world.createCharacterController> | null>(null)
  useEffect(() => {
    const c = world.createCharacterController(0.04)
    c.enableAutostep(0.4, 0.25, true)
    c.enableSnapToGround(0.35)
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    c.setSlideEnabled(true)
    controllerRef.current = c
    return () => {
      controllerRef.current = null
      try {
        world.removeCharacterController(c)
      } catch {
        /* world disposed */
      }
    }
  }, [world])

  const st = useRef({
    vel: new THREE.Vector3(),
    camPos: new THREE.Vector3(),
    camDist: CAM_MODES[0].dist,
    idleLook: 0,
    lastLook: -10,
    camY: undefined as number | undefined,
    lastUi: 0,
    t: 0,
  })
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), look: new THREE.Vector3(), dir: new THREE.Vector3(), pivot: new THREE.Vector3() }), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const b = body.current
    const col = colliderRef.current
    const controller = controllerRef.current
    if (!b || !col || !controller) return
    const s = st.current
    s.t += dt
    const P = runtime.player
    const game = useGame.getState()
    const playing = game.panel === null && game.screen === 'playing'
    input.enabled = playing

    /* ---------- teleport requests (metro, load game) ---------- */
    if (P.teleport) {
      const ty = P.teleport.y ?? 0.05
      b.setTranslation({ x: P.teleport.x, y: ty, z: P.teleport.z }, true)
      P.pos.set(P.teleport.x, ty, P.teleport.z)
      P.yaw = P.teleport.yaw
      runtime.cam.yaw = P.teleport.yaw
      P.teleport = null
      P.sitting = false
      P.sitPose = null
      s.vel.set(0, 0, 0)
      useGame.setState({ sitting: false })
    }

    /* ---------- camera look ---------- */
    const look = input.takeLook()
    const sens = 0.0022 * game.settings.mouseSensitivity
    if (playing) {
      runtime.cam.yaw -= look.dx * sens
      runtime.cam.pitch = clamp(runtime.cam.pitch - look.dy * sens * (game.settings.invertY ? -1 : 1), -1.25, 0.6)
      const wheel = input.takeWheel()
      if (wheel && game.cameraMode === 0) runtime.cam.dist = clamp(runtime.cam.dist + wheel * 0.5, 1.4, 9)
    }
    if (input.consume('KeyC') && playing) useGame.setState({ cameraMode: ((game.cameraMode + 1) % 3) as 0 | 1 | 2 })

    const D = runtime.drive
    const spec = D.active ? DRIVE[D.kind] : undefined
    if (look.dx || look.dy) s.lastLook = s.t
    /* ---------- driving ---------- */
    if (D.active && spec) {
      // the on-foot capsule is parked far below the street while driving
      b.setNextKinematicTranslation({ x: D.x, y: -40, z: D.z })
      P.pos.set(D.x, D.y, D.z)
      P.yaw = D.yaw
      P.speed = 0
      P.vy = 0
      P.grounded = true
      s.vel.set(0, 0, 0)
    } else if (P.sitPose) {
      if (!P.sitting) {
        b.setNextKinematicTranslation({ x: P.sitPose.x, y: 0.02, z: P.sitPose.z })
        P.pos.set(P.sitPose.x, 0.02, P.sitPose.z)
        P.yaw = P.sitPose.yaw
        P.sitting = true
        useGame.setState({ sitting: true })
      }
      const wantsUp = playing && (input.moveX !== 0 || input.moveY !== 0 || input.consume('Space'))
      if (wantsUp) {
        const fx = Math.sin(P.yaw),
          fz = Math.cos(P.yaw)
        const nx = P.sitPose.x + fx * 0.7,
          nz = P.sitPose.z + fz * 0.7
        b.setTranslation({ x: nx, y: 0.05, z: nz }, true)
        P.pos.set(nx, 0.05, nz)
        P.sitPose = null
        P.sitting = false
        useGame.setState({ sitting: false })
      }
      s.vel.set(0, 0, 0)
      P.speed = 0
    } else {
      /* ---------- locomotion ---------- */
      const camYaw = runtime.cam.yaw
      const fx = Math.sin(camYaw),
        fz = Math.cos(camYaw)
      const rx = -Math.cos(camYaw),
        rz = Math.sin(camYaw)
      let mx = fx * input.moveY + rx * input.moveX
      let mz = fz * input.moveY + rz * input.moveX
      const ml = Math.hypot(mx, mz)
      if (ml > 1) {
        mx /= ml
        mz /= ml
      }
      // stamina
      const wantSprint = input.sprint && ml > 0.1 && !P.exhausted
      if (wantSprint) P.stamina = Math.max(0, P.stamina - 13 * dt)
      else P.stamina = Math.min(100, P.stamina + (ml > 0.1 ? 9 : 16) * dt)
      if (P.stamina <= 0) P.exhausted = true
      if (P.exhausted && P.stamina > 25) P.exhausted = false
      P.sprinting = wantSprint
      const maxSpeed = wantSprint ? SPRINT : input.walk ? WALK : JOG
      const accel = ml > 0.1 ? (P.grounded ? 10 : 2.5) : P.grounded ? 12 : 1
      s.vel.x = damp(s.vel.x, mx * maxSpeed, accel, dt)
      s.vel.z = damp(s.vel.z, mz * maxSpeed, accel, dt)

      // jump & gravity
      if (P.grounded && playing && input.consume('Space')) {
        P.vy = JUMP_V
        P.grounded = false
        audio.jump()
      }
      P.vy -= GRAVITY * dt
      const desired = { x: s.vel.x * dt, y: P.vy * dt, z: s.vel.z * dt }
      controller.computeColliderMovement(col, desired)
      const m = controller.computedMovement()
      const t = b.translation()
      const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z }
      // stay inside the city bounds
      const bd = runtime.interior ? null : runtime.city?.bounds
      if (bd) {
        next.x = clamp(next.x, bd.minX + 2, bd.maxX - 2)
        next.z = clamp(next.z, bd.minZ + 2, bd.maxZ - 2)
      }
      if (next.y < -20) {
        const sp = runtime.city!.spawn
        next.x = sp.x
        next.y = 1
        next.z = sp.z
        P.vy = 0
      }
      let floored = false
      if (next.y < 0) {
        next.y = 0
        floored = true
      }
      b.setNextKinematicTranslation(next)
      const grounded = controller.computedGrounded() || floored
      if (grounded && P.vy < 0) P.vy = -1
      P.grounded = grounded
      // real horizontal speed (after collisions)
      const hs = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4)
      P.speed = damp(P.speed, hs, 14, dt)
      if (Math.hypot(s.vel.x, s.vel.z) > 0.3) P.yaw = dampAngle(P.yaw, Math.atan2(s.vel.x, s.vel.z), 11, dt)
      P.pos.set(next.x, next.y, next.z)
    }

    /* ---------- visual + animation ---------- */
    if (visual.current) {
      if (D.active && spec) {
        const c = Math.cos(D.yaw),
          sn = Math.sin(D.yaw)
        const [lx, ly, lz] = spec.seat
        visual.current.position.set(D.x + lx * c + lz * sn, D.y + ly + 0.03 - Math.sin(D.pitch) * lz, D.z - lx * sn + lz * c)
        visual.current.rotation.set(D.pitch, D.yaw, D.lean, 'YXZ')
        visual.current.visible = spec.twoWheeler
      } else {
        visual.current.position.copy(P.pos)
        visual.current.rotation.set(0, P.yaw, 0, 'YXZ')
        visual.current.visible = true
      }
    }
    if (rig) {
      const step = animateRig(rig, { speed: P.speed, grounded: P.grounded, vy: P.vy, sitting: P.sitting, time: s.t, sprinting: P.sprinting, riding: D.active }, dt)
      if (step) audio.footstep(P.speed)
      rig.headVisual.visible = game.cameraMode !== 2 || D.active
    }

    /* ---------- camera ---------- */
    const mode = D.active && spec ? { dist: spec.camDist * (game.cameraMode === 1 ? 1.6 : 1), height: spec.camHeight, side: 0 } : CAM_MODES[game.cameraMode]
    if (D.active && s.t - s.lastLook > 1.4) {
      // chase camera swings in behind the vehicle (reversing keeps the view forward)
      runtime.cam.yaw = dampAngle(runtime.cam.yaw, D.yaw, 2.6 + Math.min(3, Math.abs(D.speed) * 0.12), dt)
      runtime.cam.pitch = damp(runtime.cam.pitch, -0.14, 2, dt)
    }
    const yaw = runtime.cam.yaw
    const pitch = runtime.cam.pitch
    // camera height follows the feet smoothly: kerb steps (6 cm) and autostep snaps no longer jolt the view
    s.camY = s.camY === undefined || Math.abs(s.camY - P.pos.y) > 2 ? P.pos.y : damp(s.camY, P.pos.y, D.active ? 10 : 7, dt)
    const pivot = tmp.pivot.set(P.pos.x, s.camY + mode.height, P.pos.z)
    if (game.cameraMode === 2 && !D.active) {
      pivot.x += Math.sin(P.yaw) * 0.12
      pivot.z += Math.cos(P.yaw) * 0.12
      camera.position.copy(pivot)
      if (!P.sitting && P.speed > 0.2) P.yaw = dampAngle(P.yaw, yaw, 10, dt)
    } else {
      // shoulder offset to the right of the camera direction
      const rxv = -Math.cos(yaw),
        rzv = Math.sin(yaw)
      pivot.x += rxv * mode.side
      pivot.z += rzv * mode.side
      const dir = tmp.dir.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize()
      let want = game.cameraMode === 0 && !D.active ? runtime.cam.dist : mode.dist
      const ray = new rapier.Ray(pivot, dir)
      const exclude = (D.active ? runtime.driveBody : b) as typeof b
      // only static geometry (buildings, walls, flyovers) pushes the camera in — passing traffic
      // and pedestrians used to make it snap back and forth on busy roads
      const hit = world.castRay(ray, want + 0.3, true, rapier.QueryFilterFlags.EXCLUDE_KINEMATIC | rapier.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, D.active ? undefined : col, exclude)
      if (hit) want = Math.max(0.6, hit.timeOfImpact - 0.3)
      s.camDist = want < s.camDist ? damp(s.camDist, want, 22, dt) : damp(s.camDist, want, 4, dt)
      camera.position.set(pivot.x + dir.x * s.camDist, Math.max(0.35, pivot.y + dir.y * s.camDist), pivot.z + dir.z * s.camDist)
    }
    tmp.look.set(
      camera.position.x + Math.sin(yaw) * Math.cos(pitch) * 10,
      camera.position.y + Math.sin(pitch) * 10,
      camera.position.z + Math.cos(yaw) * Math.cos(pitch) * 10,
    )
    camera.lookAt(tmp.look)
    audio.setListener(camera.position.x, camera.position.z, yaw)

    /* ---------- UI sync (throttled) ---------- */
    s.lastUi -= dt
    if (s.lastUi <= 0) {
      s.lastUi = 0.15
      const st2 = Math.round(P.stamina)
      if (st2 !== game.stamina) useGame.setState({ stamina: st2 })
    }
  })

  return (
    <>
      <RigidBody
        ref={body}
        type="kinematicPosition"
        colliders={false}
        position={[runtime.player.pos.x, 0.05, runtime.player.pos.z]}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider ref={colliderRef} args={[0.55, 0.3]} position={[0, 0.86, 0]} />
      </RigidBody>
      <group ref={visual}>{rig && <primitive object={rig.root} />}</group>
    </>
  )
}
