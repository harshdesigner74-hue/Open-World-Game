import { runtime } from '../state/runtime'

/**
 * Weather state machine. Blends smoothly between presets; in 'auto' mode it changes every few
 * in-game hours with probabilities that suit north India (mostly clear/hazy, foggy mornings,
 * occasional rain & storms).
 */
export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm'
export const WEATHER_LABEL: Record<WeatherType, string> = { clear: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog', storm: 'Thunderstorm' }
export const WEATHER_ICON: Record<WeatherType, string> = { clear: '☀️', cloudy: '☁️', rain: '🌧️', fog: '🌫️', storm: '⛈️' }

interface Preset {
  cloud: number
  rain: number
  fog: number
  wind: number
}
const PRESETS: Record<WeatherType, Preset> = {
  clear: { cloud: 0, rain: 0, fog: 0, wind: 0.2 },
  cloudy: { cloud: 0.75, rain: 0, fog: 0.15, wind: 0.4 },
  rain: { cloud: 0.9, rain: 0.7, fog: 0.3, wind: 0.5 },
  fog: { cloud: 0.5, rain: 0, fog: 1, wind: 0.05 },
  storm: { cloud: 1, rain: 1, fog: 0.4, wind: 1 },
}

export const weather = {
  type: 'clear' as WeatherType,
  cloud: 0,
  rain: 0,
  fog: 0,
  wind: 0.2,
  wet: 0, // road wetness, lags rain
  flash: 0, // lightning flash 0..1
  nextChangeMin: 6 * 60,
  nextBolt: 5,
}

export function setWeather(t: WeatherType) {
  weather.type = t
}

const PICK: [WeatherType, number][] = [
  ['clear', 0.42],
  ['cloudy', 0.22],
  ['rain', 0.16],
  ['fog', 0.1],
  ['storm', 0.1],
]

/** Advance weather. `mode` = 'auto' or a forced type. Returns true when a lightning bolt fires. */
export function tickWeather(dt: number, mode: string): boolean {
  const T = runtime.time
  if (mode !== 'auto') weather.type = mode as WeatherType
  else {
    const now = T.day * 1440 + T.minutes
    if (now > weather.nextChangeMin) {
      let r = Math.random()
      let pick: WeatherType = 'clear'
      for (const [w, p] of PICK) {
        if ((r -= p) <= 0) {
          pick = w
          break
        }
      }
      // fog is a winter-morning thing
      if (pick === 'fog' && (T.minutes > 11 * 60 && T.minutes < 22 * 60)) pick = 'cloudy'
      weather.type = pick
      weather.nextChangeMin = now + (180 + Math.random() * 420)
    }
  }
  const p = PRESETS[weather.type]
  const k = Math.min(1, dt * 0.25)
  weather.cloud += (p.cloud - weather.cloud) * k
  weather.rain += (p.rain - weather.rain) * k
  weather.fog += (p.fog - weather.fog) * k
  weather.wind += (p.wind - weather.wind) * k
  weather.wet += ((weather.rain > 0.15 ? 1 : 0) - weather.wet) * Math.min(1, dt * (weather.rain > 0.15 ? 0.15 : 0.02))
  weather.flash = Math.max(0, weather.flash - dt * 5)
  if (weather.type === 'storm' && weather.rain > 0.6) {
    weather.nextBolt -= dt
    if (weather.nextBolt <= 0) {
      weather.nextBolt = 4 + Math.random() * 12
      weather.flash = 1
      return true
    }
  }
  return false
}
