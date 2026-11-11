import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Person, type PersonHandle } from '../npc/Person'
import { runtime } from '../state/runtime'
import { useGame } from '../state/store'
import { chaiSpot, garageSpot } from '../story/story'
import type { CityData, Interactable } from '../world/types'
import { PEOPLE, personSpot, presentAt, type PersonDef } from './people'
import { dailyTick, getRel, statusWith } from './social'

const SPOT_BASE = 960000

/** invitation from the phone: the person comes to meet you for a couple of game hours */
export const socialRuntime = {
  invite: null as null | { id: string; x: number; z: number; until: number },
}

function spotFor(city: CityData, p: PersonDef) {
  if (p.id === 'rohan') return chaiSpot(city)
  if (p.id === 'meera') {
    const g = garageSpot(city)
    return { x: g.x + 2.5, z: g.z + 2.5 }
  }
  return personSpot(city, p)
}

export function SocialSystem({ city }: { city: CityData }) {
  const handles = useRef(PEOPLE.map(() => ({ current: { x: 0, z: 0, yaw: 0, visible: false, talking: false, watch: 9 } as PersonHandle })))
  const looks = useMemo(() => PEOPLE.map((p) => ({ ...p.look, female: p.female })), [])
  const st = useRef({ acc: 0, day: runtime.time.day })

  useEffect(() => {
    st.current.day = runtime.time.day
    return () => {
      runtime.socialSpots = []
    }
  }, [city])

  useFrame((_, dt) => {
    st.current.acc += dt
    if (st.current.acc < 0.25) return
    st.current.acc = 0
    const T = runtime.time
    if (T.day !== st.current.day) {
      st.current.day = T.day
      dailyTick(T.day)
    }
    const hour = Math.floor(T.minutes / 60)
    const inv = socialRuntime.invite
    if (inv && T.day * 1440 + T.minutes > inv.until) socialRuntime.invite = null
    const panel = useGame.getState().panel
    const talkingTo = (useGame.getState().panelData?.person as string | undefined) ?? null
    const spots: Interactable[] = []
    PEOPLE.forEach((p, i) => {
      const h = handles.current[i].current
      let at: { x: number; z: number } | null = null
      if (socialRuntime.invite?.id === p.id) at = socialRuntime.invite
      // your spouse lives with you: they are at their usual spot too (and come when called)
      // your partner keeps longer hours for you; your spouse is always around
      else if (presentAt(p, hour) || statusWith(p.id) === 'married' || (statusWith(p.id) && hour >= 8 && hour < 23)) at = spotFor(city, p)
      h.visible = !!at
      h.talking = (panel === 'social' || panel === 'date') && talkingTo === p.id
      if (!at) return
      h.x = at.x
      h.z = at.z
      const rel = getRel(p.id)
      const heart = statusWith(p.id) ? ' ❤️' : rel.f >= 70 ? ' ⭐' : ''
      spots.push({ id: SPOT_BASE + i, type: 'social', x: at.x, z: at.z, rot: 0, radius: 2.4, label: `${rel.f < 15 ? 'Say hi to' : 'Talk to'} ${p.name} (${p.role})${heart}`, data: { person: p.id } })
    })
    runtime.socialSpots = spots
  })

  return (
    <>
      {PEOPLE.map((p, i) => (
        <Person key={p.id} look={looks[i]} handle={handles.current[i]} />
      ))}
    </>
  )
}
