import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { runtime } from './game/state/runtime'
import { useGame } from './game/state/store'
import { diyaSpots } from './game/progress/Collectibles'
import './styles.css'
import { driveApi } from './game/vehicles/PlayerVehicle'
import { setWeather, weather } from './game/env/weather'
import { trafficApi } from './game/traffic/TrafficSystem'
import { RadioPlayer, STATION_COUNT, radio } from './game/audio/radio'
import { audio } from './game/audio/audioEngine'
import { crime } from './game/crime/crime'
import { policeApi } from './game/crime/PoliceSystem'

// Dev-only hook for automated playtesting (stripped from production builds)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__iow = { runtime, useGame, diyaSpots, driveApi, weather, setWeather, trafficApi, radio, RadioPlayer, STATION_COUNT, audio, crime, policeApi }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
