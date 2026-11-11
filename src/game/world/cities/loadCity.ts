import type { CityData } from '../types'
import { getCity } from './registry'

const cityCache = new Map<string, CityData>()

/** Loads (code-split) and generates a city once; later calls hit the cache. */
export async function loadCityData(id: string): Promise<CityData> {
  const hit = cityCache.get(id)
  if (hit) return hit
  const def = getCity(id)
  if (!def?.load) throw new Error(`${id} is not playable yet`)
  const c = await def.load()
  cityCache.set(id, c)
  return c
}
