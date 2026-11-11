import * as THREE from 'three'
import type { CityData } from '../world/types'
import type { VehicleKind } from '../world/models'
import type { ParkedRegistry } from '../vehicles/parked'

/**
 * High-frequency mutable game state. Systems read/write these every frame WITHOUT
 * triggering React renders. The zustand store only holds what the UI needs.
 */
export interface VehicleState {
  x: number
  /** height (flyovers); undefined = ground */
  y?: number
  z: number
  yaw: number
  speed: number
  kind: string
  honkCooldown: number
}

export interface NPCPublic {
  x: number
  z: number
  yaw: number
  talking: number
}

export const runtime = {
  city: null as CityData | null,
  player: {
    pos: new THREE.Vector3(),
    yaw: 0,
    speed: 0,
    vy: 0,
    grounded: true,
    sitting: false,
    sitPose: null as null | { x: number; z: number; yaw: number },
    sprinting: false,
    stamina: 100,
    exhausted: false,
    /** set to request a teleport (metro, load game) */
    teleport: null as null | { x: number; z: number; yaw: number; y?: number },
  },
  cam: { yaw: 0, pitch: -0.16, dist: 4.4 },
  time: {
    minutes: 9 * 60,
    day: 1,
    elapsed: 0,
    daylight: 1, // 0 night .. 1 day
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3),
  },
  vehicles: [] as VehicleState[],
  /** the vehicle the player is driving (if any) */
  drive: {
    active: false,
    kind: 'hatch' as VehicleKind,
    color: '#ffffff',
    x: 0,
    /** height of the vehicle (above 0 on flyovers) */
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    speed: 0,
    steer: 0,
    lean: 0,
    throttle: 0,
    health: 100,
    fuel: 100,
    owned: false,
    ownedId: -1,
  },
  parked: null as ParkedRegistry | null,
  /** interior the player is inside (see interiors/InteriorSystem) */
  interior: null as unknown,
  interiorSpots: [] as import('../world/types').Interactable[],
  /** talkable story characters (outside) */
  storySpots: [] as import('../world/types').Interactable[],
  /** friends / love interests you can walk up to */
  socialSpots: [] as import('../world/types').Interactable[],
  /** waypoint currently driven by the story (not cleared on arrival) */
  storyWp: null as null | { x: number; z: number },
  trainBoardable: false,
  /** rapier body of the driven vehicle (camera rays ignore it) */
  driveBody: null as unknown,
  npcs: [] as NPCPublic[],
  /** NPC currently talking to the player: world position for the speech bubble */
  speech: null as null | { x: number; y: number; z: number; text: string; until: number },
  stats: { fps: 0, drawCalls: 0, triangles: 0, chunks: 0, lodChunks: 0, physChunks: 0, npcs: 0, vehicles: 0 },
  loadedChunks: new Set<string>(),
}

export function resetRuntime(city: CityData) {
  runtime.city = city
  runtime.player.pos.set(city.spawn.x, 0, city.spawn.z)
  runtime.player.yaw = city.spawn.yaw
  runtime.cam.yaw = city.spawn.yaw
  runtime.player.sitting = false
  runtime.player.sitPose = null
  runtime.vehicles = []
  runtime.npcs = []
  runtime.speech = null
  runtime.drive.active = false
  runtime.parked = null
  runtime.interior = null
  runtime.interiorSpots = []
}
