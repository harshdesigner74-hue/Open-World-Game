import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { audio } from '../audio/audioEngine'
import { input } from '../input/input'
import { npcApi } from '../npc/NPCSystem'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import type { CityData, Interactable } from '../world/types'
import { DRIVE } from '../vehicles/specs'
import { bump } from '../progress/progress'
import { interiorApi } from '../interiors/InteriorSystem'
import type { InteriorKind } from '../interiors/interiors'
import { saveGame } from '../state/save'
import { storyApi } from '../story/StorySystem'

/**
 * Reusable interaction layer: anything in `city.interactables` (or a nearby NPC) shows a
 * "PRESS E" prompt. New activities = new `type` + a handler below.
 */
export type Handler = (it: Interactable) => void

const heal = (n: number) => useGame.setState((s) => ({ health: Math.min(100, s.health + n) }))

function buy(price: number, ok: () => void) {
  const g = useGame.getState()
  if (g.spend(price)) {
    audio.cash()
    ok()
  } else g.toast(`Not enough cash (₹${price} needed). Find an ATM.`, 'warn')
}

export const HANDLERS: Record<Interactable['type'], Handler> = {
  tea: () =>
    buy(15, () => {
      runtime.player.stamina = 100
      runtime.player.exhausted = false
      heal(5)
      useGame.getState().toast('☕ Garam cutting chai! Stamina fully restored.', 'money')
      bump((p) => ({ chai: p.chai + 1 }))
    }),
  food: () =>
    buy(40, () => {
      heal(30)
      useGame.getState().toast('🥟 Samosa with chutney. +30 health.', 'money')
    }),
  fruit: () =>
    buy(30, () => {
      heal(15)
      useGame.getState().toast('🍌 Fresh fruit. +15 health.', 'money')
    }),
  pan: () =>
    buy(20, () => {
      useGame.getState().toast('🌿 Meetha paan — sweet, cool and very Delhi.', 'money')
    }),
  atm: () => useGame.getState().openPanel('atm'),
  metro: (it) => interiorApi.enter('metro', String(it.data?.station ?? 'Metro'), { x: it.x, z: it.z, yaw: it.rot }, String(it.data?.station ?? '')),
  door: (it) => interiorApi.enter(it.data?.kind as InteriorKind, String(it.data?.name ?? ''), { x: it.x, z: it.z, yaw: it.rot }),
  interior_exit: () => interiorApi.exit(),
  story: () => storyApi.talk(),
  social: (it) => useGame.getState().openPanel('social', { person: it.data?.person as string }),
  eat: () =>
    buy(120, () => {
      useGame.setState({ health: 100 })
      runtime.player.stamina = 100
      useGame.getState().toast('🍛 Dal, sabzi, roti, chawal — a full thali! Health & stamina restored.', 'money')
    }),
  counter: () =>
    buy(30, () => {
      heal(10)
      runtime.player.stamina = Math.min(100, runtime.player.stamina + 40)
      useGame.getState().toast('🥤 Snacks & a cold water bottle. +40 stamina', 'money')
    }),
  bed: () => {
    const T = runtime.time
    if (T.minutes >= 7 * 60) T.day++
    T.minutes = 7 * 60
    runtime.player.stamina = 100
    useGame.setState({ health: 100, timeMin: 7 * 60, day: T.day })
    const ok = saveGame()
    useGame.getState().toast(`😴 You slept until 7:00 AM.${ok ? ' Game saved.' : ''}`, 'info')
  },
  ticket: () => {
    const a = runtime.interior as { station?: string } | null
    useGame.getState().openPanel('metro', { from: a?.station ?? '' })
  },
  board: () => {
    const g = useGame.getState()
    if (!runtime.trainBoardable) return g.toast('Wait for the train to arrive at the platform.', 'info')
    const a = runtime.interior as { station?: string } | null
    g.openPanel('metro', { from: a?.station ?? '' })
  },
  property: (it) => {
    const g = useGame.getState()
    const key = String(it.data?.key)
    const owned = (g.progress.properties ?? []).includes(key)
    if (owned) return interiorApi.enter('flat', 'Your flat', { x: it.x, z: it.z, yaw: it.rot })
    const price = Number(it.data?.price ?? 150000)
    if (g.cash + g.bank < price) return g.toast(`This flat costs ₹${price.toLocaleString('en-IN')} (cash + bank).`, 'warn')
    const fromCash = Math.min(g.cash, price)
    useGame.setState({ cash: g.cash - fromCash, bank: g.bank - (price - fromCash) })
    bump((p) => ({ properties: [...(p.properties ?? []), key] }))
    audio.cash()
    g.toast('🏠 Flat purchased! Sleep there to skip time and save. Press E to enter.', 'money')
  },
  info: (it) => useGame.getState().openPanel('info', it.data ?? null),
  bench: (it) => {
    const px = (it.data?.propX as number) ?? it.x
    const pz = (it.data?.propZ as number) ?? it.z
    const rx = -Math.cos(it.rot),
      rz = Math.sin(it.rot)
    const fx = Math.sin(it.rot),
      fz = Math.cos(it.rot)
    const isBusStop = it.label.includes('bus')
    const side = isBusStop ? -0.6 : -0.45
    const back = isBusStop ? -0.55 : -0.02
    runtime.player.sitPose = { x: px + rx * side + fx * back, z: pz + rz * side + fz * back, yaw: it.rot }
  },
  bus_stop: () => {},
  fuel: () => {
    const D = runtime.drive
    const g = useGame.getState()
    if (!D.active) return g.toast('Drive a vehicle here to refuel or repair it.', 'info')
    const fuelCost = Math.ceil((100 - D.fuel) * 6)
    const repairCost = Math.ceil((100 - D.health) * 25)
    const total = fuelCost + repairCost
    if (total <= 0) return g.toast('Tank full, vehicle in good shape.', 'info')
    if (!g.spend(total)) return g.toast(`Needs ₹${total} (fuel ₹${fuelCost} + repair ₹${repairCost}). Not enough cash.`, 'warn')
    D.fuel = 100
    D.health = 100
    audio.cash()
    g.toast(`⛽ Refuelled${repairCost ? ' & repaired' : ''} for ₹${total}`, 'money')
  },
  train: () => useGame.getState().openPanel('train'),
  shop_clothes: () => useGame.getState().openPanel('wardrobe'),
  dealer: () => useGame.getState().openPanel('dealer'),
}

export function InteractionSystem({ city }: { city: CityData }) {
  const st = useRef({ current: null as Interactable | null, npc: -1, label: '' })
  useFrame(() => {
    const g = useGame.getState()
    const P = runtime.player
    let label: string | null = null
    let key = 'E'
    st.current.current = null
    st.current.npc = -1
    const D = runtime.drive
    if (g.panel === null && g.screen === 'playing' && D.active) {
      const pump = city.interactables.find((it) => it.type === 'fuel' && Math.hypot(it.x - D.x, it.z - D.z) < it.radius)
      if (pump && Math.abs(D.speed) < 2) {
        st.current.current = pump
        label = pump.label
      } else {
        label = Math.abs(D.speed) < 4 ? 'Exit vehicle' : null
        key = 'F'
      }
    } else if (g.panel === null && g.screen === 'playing') {
      if (P.sitting) label = 'Stand up'
      else {
        let best: Interactable | null = null
        let bd = Infinity
        for (const list of runtime.interior ? [runtime.interiorSpots] : [runtime.storySpots, runtime.socialSpots, city.interactables]) for (const it of list) {
          if (it.type === 'board' && !runtime.trainBoardable) continue
          const dx = it.x - P.pos.x,
            dz = it.z - P.pos.z
          if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue
          const d = Math.hypot(dx, dz)
          if (d < it.radius && d < bd) {
            bd = d
            best = it
          }
        }
        if (best) {
          st.current.current = best
          label = best.label
        } else if (!runtime.interior) {
          const pv = runtime.parked?.nearest(P.pos.x, P.pos.z, 3.4)
          const id = npcApi.nearest(P.pos.x, P.pos.z, 2.0)
          if (pv && DRIVE[pv.kind]) {
            label = `Enter ${DRIVE[pv.kind]!.name.toLowerCase()}${pv.owned ? ' (yours)' : ''}`
            key = 'F'
          } else if (id >= 0) {
            st.current.npc = id
            label = 'Talk'
          }
        }
      }
    }
    if ((label ?? '') + key !== st.current.label) {
      st.current.label = (label ?? '') + key
      useGame.setState({ prompt: label, promptKey: key })
    }
    if (g.panel === null && input.consume('KeyE')) {
      if (D.active) {
        if (st.current.current) HANDLERS[st.current.current.type](st.current.current)
      } else if (P.sitting) {
        // stand up in front of the seat
        const fx = Math.sin(P.yaw),
          fz = Math.cos(P.yaw)
        if (P.sitPose) P.teleport = { x: P.sitPose.x + fx * 0.7, z: P.sitPose.z + fz * 0.7, yaw: P.yaw }
      } else if (st.current.current) {
        HANDLERS[st.current.current.type](st.current.current)
      } else if (st.current.npc >= 0) {
        npcApi.talk(st.current.npc)
      }
    }
  })
  return <SpeechBubble />
}

/** Single floating speech bubble for whoever is talking. */
function SpeechBubble() {
  const [text, setText] = useState<string | null>(null)
  const pos = useRef<[number, number, number]>([0, 0, 0])
  const groupRef = useRef<import('three').Group>(null)
  useFrame(() => {
    const s = runtime.speech
    const active = s && s.until > runtime.time.elapsed
    if (active && groupRef.current) {
      groupRef.current.position.set(s!.x, s!.y, s!.z)
      pos.current = [s!.x, s!.y, s!.z]
    }
    const want = active ? s!.text : null
    if (want !== text) setText(want)
  })
  return (
    <group ref={groupRef}>
      {text && (
        <Html center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="speech">
            {text.split('\n').map((l, i) => (
              <div key={i} className={i ? 'speech-en' : 'speech-hi'}>
                {l}
              </div>
            ))}
          </div>
        </Html>
      )}
    </group>
  )
}
