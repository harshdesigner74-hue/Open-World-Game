import type { FacadeStyle } from '../utils/textures'

/**
 * Coordinate convention (metres): +X = east, -Z = north, +Y = up.
 * All city content is plain data; rendering, physics and AI consume it.
 * A future OpenStreetMap importer only has to produce `roads`, `areas` and landmarks;
 * the generator places buildings, pavements, props and the pedestrian network.
 */

export type District = 'cp' | 'market' | 'residential' | 'office' | 'government' | 'vista' | 'station' | 'park' | 'lutyens'

export interface StraightRoad {
  kind: 'straight'
  id: number
  name: string
  ax: number
  az: number
  bx: number
  bz: number
  width: number
  /** lanes per direction; 0 = one-way multi-lane */
  lanes: number
  divider?: boolean
  /** segments of the same polyline share a group (OSM edge) */
  group?: number
  cls?: string
  oneway?: boolean
}
export interface RingRoad {
  kind: 'ring'
  id: number
  name: string
  cx: number
  cz: number
  r0: number
  r1: number
}
export type Road = StraightRoad | RingRoad

export interface Building {
  x: number
  z: number
  w: number
  d: number
  h: number
  rot: number
  style: FacadeStyle
  color: string
  roof: string
  shopFloor: boolean
  tanks: number
  sign: number // sign atlas index or -1
  district: District
}

/** Annular-sector building (Connaught Place style colonnaded blocks). */
export interface ArcBuilding {
  cx: number
  cz: number
  r0: number
  r1: number
  /** start/end bearing (radians) at inner and outer radius (ends are cut parallel to the radial roads) */
  aIn0: number
  aIn1: number
  aOut0: number
  aOut1: number
  h: number
  colonnade: { side: 'inner' | 'outer'; depth: number; pillarR: number }
  name: string
  color: string
}

export type AreaShape =
  | { type: 'circle'; cx: number; cz: number; r: number }
  | { type: 'rect'; x: number; z: number; w: number; d: number; rot?: number }
  | { type: 'poly'; pts: number[]; minX: number; minZ: number; maxX: number; maxZ: number }
export type AreaKind = 'grass' | 'water' | 'plaza' | 'sandstone' | 'dirt' | 'parking' | 'rail' | 'campus' | 'forest' | 'sand'
export interface Area {
  kind: AreaKind
  shape: AreaShape
  name?: string
}

/** Real building footprint (OpenStreetMap) or polygonal landmark, extruded. */
export type PolyKind = 'generic' | 'residential' | 'commercial' | 'office' | 'public' | 'temple' | 'mosque' | 'gurdwara' | 'church' | 'monument' | 'yantra' | 'canopy' | 'station'
export interface PolyBuilding {
  pts: number[] // x,z pairs, CCW
  h: number
  style: FacadeStyle
  color: string
  roof: string
  kind: PolyKind
  name: string
  /** per edge: ground floor is a shopfront facing a street */
  shop: boolean[]
  sign: number
  cx: number
  cz: number
  r: number
  district: District
  source: 'osm' | 'procedural'
  domed?: boolean
}

export type PropType =
  | 'tree'
  | 'lamp'
  | 'bench'
  | 'tea_stall'
  | 'food_stall'
  | 'fruit_cart'
  | 'pan_shop'
  | 'atm'
  | 'bus_stop'
  | 'auto_parked'
  | 'car_parked'
  | 'scooter_parked'
  | 'dog'
  | 'bin'
  | 'metro_entrance'
  | 'flagpole'
  | 'signal_pole'
  | 'cow'
  | 'bollard'
  | 'fountain'
  | 'petrol_pump'
  | 'police_booth'
  | 'shrine'
  | 'coach'
  | 'rickshaw'

export interface Prop {
  type: PropType
  x: number
  z: number
  rot: number
  v: number // variant seed 0..1
}

export type InteractionType =
  | 'tea'
  | 'food'
  | 'fruit'
  | 'pan'
  | 'atm'
  | 'bench'
  | 'metro'
  | 'info'
  | 'bus_stop'
  | 'fuel'
  | 'train'
  | 'shop_clothes'
  | 'dealer'
  | 'door'
  | 'interior_exit'
  | 'eat'
  | 'counter'
  | 'bed'
  | 'ticket'
  | 'board'
  | 'property'
  | 'story'
  | 'social'

export interface Interactable {
  id: number
  type: InteractionType
  x: number
  z: number
  y?: number
  rot: number
  radius: number
  label: string
  data?: Record<string, unknown>
}

export interface Landmark {
  id: string
  name: string
  x: number
  z: number
  category: 'monument' | 'transport' | 'market' | 'park' | 'government' | 'area'
  description: string
  /** honest flag: whether position is approximately real or invented for gameplay */
  accuracy: 'approximate-real' | 'fictional' | 'osm'
}

export interface Signal {
  id: number
  x: number
  z: number
  group: number // 0/1 phase offset group
  /** yaw of the phase-0 travel axis (0 = along Z / north-south) */
  axis: number
  /** half-extents of the junction along / across the axis (pole placement) */
  hw0: number
  hw1: number
}

/** Drivable road graph (OSM ways split at junctions). */
export interface NetEdge {
  id: number
  a: number
  b: number
  pts: number[]
  cum: number[]
  len: number
  w: number
  oneway: boolean
  car: boolean
  cls: string
  name: string
  roundabout: boolean
  /** per-point deck height (flyovers / ramps only) */
  h?: number[]
}
/** Elevated road (flyover deck or approach ramp): polyline with a height per point. */
export interface Flyover {
  pts: number[]
  h: number[]
  w: number
  name: string
  oneway: boolean
  /** an end that meets other roads (branch/merge): parapets stop short there */
  openA?: boolean
  openB?: boolean
}
export interface RoadNet {
  nx: Float32Array
  nz: Float32Array
  edges: NetEdge[]
  /** per node: incident edge ids */
  inc: number[][]
  /** per node: signal id or -1 */
  nodeSignal: Int32Array
}

export interface WalkGraph {
  x: Float32Array
  z: Float32Array
  y: Float32Array
  adj: number[][]
  /** edge metadata keyed `${min}_${max}` */
  edges: Map<string, { cross?: number; signal?: number; axis?: 0 | 1 }>
  density: Float32Array // pedestrian density weight per node
}

export interface LabelSpot {
  text: string
  x: number
  z: number
  size: number
  kind: 'road' | 'district' | 'landmark'
  angle?: number
}

export interface ChunkContent {
  key: string
  cx: number
  cz: number
  buildings: Building[]
  arcs: ArcBuilding[]
  props: Prop[]
  polys: PolyBuilding[]
  areas: number[]
  roadIds: Set<number>
}

export interface CityData {
  id: string
  name: string
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  roads: Road[]
  buildings: Building[]
  arcs: ArcBuilding[]
  areas: Area[]
  props: Prop[]
  landmarks: Landmark[]
  interactables: Interactable[]
  labels: LabelSpot[]
  graph: WalkGraph
  signals: Signal[]
  net: RoadNet
  flyovers: Flyover[]
  polys: PolyBuilding[]
  rails: number[][]
  /** human-readable neighbourhood name */
  areaName: (x: number, z: number) => string
  attribution: string
  spawn: { x: number; z: number; yaw: number }
  districtAt: (x: number, z: number) => District
  chunkSize: number
  chunks: Map<string, ChunkContent>
  /** Custom per-city landmark geometry hook (India Gate etc.) */
  landmarkBuilders: LandmarkBuilder[]
  sidewalkSegs: SidewalkSeg[]
  zebras: { x: number; z: number; rot: number; len: number }[]
  credits: string[]
  /** coastal/tropical city: coconut palms among the trees */
  tropical?: boolean
  /** big national flag (e.g. Central Park, CP) */
  flag?: { x: number; z: number }
}

export interface SidewalkSeg {
  ax: number
  az: number
  bx: number
  bz: number
  w: number
}

export interface LandmarkBuilder {
  id: string
  x: number
  z: number
  radius: number
  rot?: number
}
