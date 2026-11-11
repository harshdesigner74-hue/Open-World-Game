import type { VehicleKind } from '../world/models'

/** Arcade handling data for drivable vehicles (metres, seconds, m/s). */
export interface DriveSpec {
  name: string
  maxSpeed: number
  accel: number
  brake: number
  reverse: number
  steer: number // max wheel angle (rad)
  wheelbase: number
  twoWheeler: boolean
  /** seat position relative to vehicle origin (x right, y up, z forward) */
  seat: [number, number, number]
  camDist: number
  camHeight: number
  /** litres-equivalent fuel use per km (0–100 tank) */
  fuelPerKm: number
  price: number
}

export const DRIVE: Partial<Record<VehicleKind, DriveSpec>> = {
  hatch: { name: 'Hatchback', maxSpeed: 32, accel: 5.5, brake: 11, reverse: 7, steer: 0.55, wheelbase: 2.4, twoWheeler: false, seat: [0.35, 0.35, 0.1], camDist: 6.5, camHeight: 2.3, fuelPerKm: 6, price: 60000 },
  sedan: { name: 'Sedan', maxSpeed: 38, accel: 6, brake: 12, reverse: 7, steer: 0.5, wheelbase: 2.7, twoWheeler: false, seat: [0.38, 0.35, 0.2], camDist: 7, camHeight: 2.3, fuelPerKm: 7, price: 120000 },
  suv: { name: 'SUV', maxSpeed: 36, accel: 6.5, brake: 12, reverse: 7, steer: 0.48, wheelbase: 2.8, twoWheeler: false, seat: [0.4, 0.55, 0.2], camDist: 7.5, camHeight: 2.6, fuelPerKm: 9, price: 200000 },
  taxi: { name: 'Taxi', maxSpeed: 33, accel: 5.5, brake: 11, reverse: 7, steer: 0.52, wheelbase: 2.6, twoWheeler: false, seat: [0.38, 0.35, 0.15], camDist: 7, camHeight: 2.3, fuelPerKm: 7, price: 90000 },
  auto: { name: 'Auto-rickshaw', maxSpeed: 17, accel: 3.6, brake: 8, reverse: 4, steer: 0.62, wheelbase: 1.7, twoWheeler: false, seat: [0, 0.55, 0.55], camDist: 5.5, camHeight: 2.4, fuelPerKm: 3, price: 35000 },
  scooter: { name: 'Scooter', maxSpeed: 22, accel: 4.5, brake: 9, reverse: 1.5, steer: 0.6, wheelbase: 1.3, twoWheeler: true, seat: [0, 0.3, -0.32], camDist: 4.6, camHeight: 1.9, fuelPerKm: 2, price: 15000 },
  bike: { name: 'Motorcycle', maxSpeed: 30, accel: 6.5, brake: 10, reverse: 1.5, steer: 0.58, wheelbase: 1.4, twoWheeler: true, seat: [0, 0.36, -0.3], camDist: 4.8, camHeight: 1.9, fuelPerKm: 2.5, price: 20000 },
}

export const drivable = (k: VehicleKind) => !!DRIVE[k]
