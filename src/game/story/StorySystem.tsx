import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { audio } from '../audio/audioEngine'
import { runtime } from '../state/runtime'
import { saveGame } from '../state/save'
import { useGame } from '../state/store'
import { GeoBuilder } from '../utils/geoBuilder'
import { buildVendor } from '../world/models'
import type { CityData, Interactable } from '../world/types'
import { CHAPTERS, NPC_NAMES, STORY_VERSION, objectiveText, stepLines, storyStep, type Line, type StoryState } from './story'

const SPOT_ID = 950000

/** Bridge for the interaction handler and the dialogue panel. */
export const storyApi = {
  /** player pressed E on the story character */
  talk: () => {},
  /** dialogue for the current step finished */
  finish: () => {},
}

export function dialogueLines(): Line[] {
  const s = storyStep(useGame.getState().progress.story)
  return s ? stepLines(s) : []
}

function setStory(s: StoryState) {
  const g = useGame.getState()
  useGame.setState({ progress: { ...g.progress, story: s } })
}

function payReward(n?: number) {
  if (!n) return
  const g = useGame.getState()
  useGame.setState({ cash: g.cash + n })
  g.toast(`💰 +₹${n.toLocaleString('en-IN')}`, 'money')
  audio.cash()
}

/** Move to the next step (or chapter), snapshotting counters the new step needs. */
function advance() {
  const g = useGame.getState()
  const cur = g.progress.story
  if (!cur || cur.done) return
  let { chapter, step } = cur
  step++
  if (step >= CHAPTERS[chapter].steps.length) {
    chapter++
    step = 0
  }
  if (chapter >= CHAPTERS.length) {
    setStory({ chapter: CHAPTERS.length - 1, step: 0, done: true, v: STORY_VERSION })
    g.toast('📖 Story complete — "Naya Safar". The whole country is yours to explore.', 'money')
    audio.cash()
    saveGame()
    return
  }
  const next = CHAPTERS[chapter].steps[step]
  const base = next.kind === 'cond' && next.base ? next.base(g) : undefined
  setStory({ chapter, step, done: false, base, from: g.cityId, v: STORY_VERSION })
  if (step === 0) g.toast(`📖 Chapter ${chapter + 1}: ${CHAPTERS[chapter].title}`, 'info')
  audio.blip(740, 0.05, 0.2)
  saveGame()
}

export function StorySystem({ city }: { city: CityData }) {
  const figures = useMemo(() => {
    const mk = (v: number) => {
      const b = new GeoBuilder()
      buildVendor(b, 0, 0, 0, v)
      return b.build()
    }
    return { rohan: mk(0.31), meera: mk(0.77) }
  }, [])
  const npc = useRef<THREE.Mesh>(null)
  const marker = useRef<THREE.Mesh>(null)
  const beam = useRef<THREE.Mesh>(null)
  const st = useRef({ acc: 0, wp: null as null | { x: number; z: number }, callAt: 0 })
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffc23a', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }), [])
  const markerMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffb12a', toneMapped: false }), [])

  // start (or resume) the story; the first step's counters are taken now
  useEffect(() => {
    const g = useGame.getState()
    // first call a few seconds after the city appears
    st.current.callAt = runtime.time.elapsed + 4
    // new game — or a save from before the relationship arc became the opening campaign
    if (!g.progress.story || g.progress.story.v !== STORY_VERSION) {
      setStory({ chapter: 0, step: 0, done: false, from: g.cityId, v: STORY_VERSION })
      setTimeout(() => useGame.getState().toast(`📖 Story — Chapter 1: ${CHAPTERS[0].title}`, 'info'), 2500)
    }
    storyApi.talk = () => {
      const s = storyStep(useGame.getState().progress.story)
      if (s?.kind === 'talk') useGame.getState().openPanel('dialogue')
    }
    storyApi.finish = () => {
      const g = useGame.getState()
      const s = storyStep(g.progress.story)
      if (!s || (s.kind !== 'talk' && s.kind !== 'call')) return
      if (s.reward) {
        useGame.setState({ cash: g.cash + s.reward })
        g.toast(`💰 +₹${s.reward.toLocaleString('en-IN')}`, 'money')
        audio.cash()
      }
      advance()
    }
    return () => {
      runtime.storySpots = []
    }
  }, [])

  useFrame((_, dt) => {
    const t = runtime.time.elapsed
    if (marker.current) {
      marker.current.position.y = 2.45 + Math.sin(t * 3) * 0.12
      marker.current.rotation.y += dt * 2
    }
    st.current.acc += dt
    if (st.current.acc < 0.2) return
    st.current.acc = 0
    const g = useGame.getState()
    const story = g.progress.story
    const step = storyStep(story)
    const P = runtime.player.pos
    let target: { x: number; z: number } | null = null
    let npcAt: { x: number; z: number; who: 'rohan' | 'meera' } | null = null
    let beamAt: { x: number; z: number; r: number } | null = null

    if (step && story) {
      if (step.kind === 'talk') {
        const p = step.at(city)
        target = p
        if (step.who === 'rohan' || step.who === 'meera') npcAt = { ...p, who: step.who }
      } else if (step.kind === 'reach') {
        const p = step.at(city)
        target = p
        beamAt = { ...p, r: Math.min(step.radius, 14) }
        if (g.panel === null && !runtime.interior && Math.hypot(p.x - P.x, p.z - P.z) < step.radius) {
          g.toast(`✔ ${step.objective(city)}`, 'info')
          payReward(step.reward)
          advance()
        }
      } else if (step.kind === 'cond') {
        target = step.hint?.(city) ?? null
        if ((g.panel === null || g.panel === 'social') && step.check(g, story)) {
          g.toast(`✔ ${objectiveText(step, city).split(' — ')[0]}`, 'info')
          payReward(step.reward)
          advance()
        }
      } else if (step.kind === 'call') {
        if (g.panel === null && !runtime.drive.active && t > st.current.callAt) {
          st.current.callAt = t + 6
          audio.blip(990, 0.06, 0.25)
          g.openPanel('dialogue')
        }
      }
    }

    // talkable story character
    runtime.storySpots = npcAt
      ? [{ id: SPOT_ID, type: 'story', x: npcAt.x, z: npcAt.z, rot: 0, radius: 2.6, label: `Talk to ${NPC_NAMES[npcAt.who]}` } as Interactable]
      : []
    if (npc.current) {
      npc.current.visible = !!npcAt && !runtime.interior
      if (npcAt) {
        npc.current.geometry = figures[npcAt.who]
        npc.current.position.set(npcAt.x, 0.06, npcAt.z)
        // face the player when close
        npc.current.rotation.y = Math.atan2(P.x - npcAt.x, P.z - npcAt.z)
      }
    }
    if (marker.current) {
      marker.current.visible = !!npcAt && !runtime.interior
      if (npcAt) marker.current.position.set(npcAt.x, marker.current.position.y, npcAt.z)
    }
    if (beam.current) {
      beam.current.visible = !!beamAt && !runtime.interior
      if (beamAt) {
        beam.current.position.set(beamAt.x, 20, beamAt.z)
        beam.current.scale.set(beamAt.r, 1, beamAt.r)
      }
    }

    // story waypoint — only when no job is running and the player hasn't set their own marker
    if (!g.job) {
      const wp = g.waypoint
      const ours = !wp || (st.current.wp && Math.hypot(wp.x - st.current.wp.x, wp.z - st.current.wp.z) < 1)
      if (ours) {
        if (target && (!wp || Math.hypot(wp.x - target.x, wp.z - target.z) > 1)) useGame.setState({ waypoint: { x: target.x, z: target.z } })
        else if (!target && wp) useGame.setState({ waypoint: null })
        st.current.wp = target
        runtime.storyWp = target
      }
    }
  })

  return (
    <>
      <mesh ref={marker} material={markerMat} visible={false} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.22, 0.42, 4]} />
      </mesh>
      <mesh ref={beam} material={beamMat} visible={false}>
        <cylinderGeometry args={[1, 1, 40, 24, 1, true]} />
      </mesh>
    </>
  )
}
