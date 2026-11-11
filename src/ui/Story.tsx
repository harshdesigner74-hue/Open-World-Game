import { useEffect, useState } from 'react'
import { input } from '../game/input/input'
import { runtime } from '../game/state/runtime'
import { useGame } from '../game/state/store'
import { CHAPTERS, NPC_NAMES, objectiveText, storyStep, type Who } from '../game/story/story'
import { dialogueLines, storyApi } from '../game/story/StorySystem'

const speaker = (who: string) => (who === 'you' ? 'You' : NPC_NAMES[who as Who] ?? who)

/** Cinematic letterbox dialogue for story scenes. Click / E / Space advances. */
export function DialoguePanel({ onClose }: { onClose: () => void }) {
  const [lines] = useState(dialogueLines)
  const [i, setI] = useState(0)
  const next = () => {
    if (i + 1 < lines.length) setI(i + 1)
    else {
      onClose()
      input.clearEdges()
      storyApi.finish()
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  useEffect(() => {
    if (!lines.length) onClose()
  }, [lines, onClose])
  const l = lines[i]
  if (!l) return null
  return (
    <div className="dlg" onClick={next}>
      <div className="dlg-bar top" />
      <div className="dlg-bar bottom">
        <div className={'dlg-who' + (l.who === 'you' ? ' you' : '')}>{speaker(l.who)}</div>
        <div className="dlg-text">{l.text}</div>
        <div className="dlg-hint">
          {i + 1}/{lines.length} · click, E or Space to continue
        </div>
      </div>
    </div>
  )
}

/** Story objective card (sits under the job card when both are active). */
export function StoryHUD() {
  const story = useGame((s) => s.progress.story)
  const job = useGame((s) => s.job)
  const [dist, setDist] = useState<number | null>(null)
  const step = storyStep(story)
  useEffect(() => {
    const id = setInterval(() => {
      const w = useGame.getState().waypoint
      setDist(w && !useGame.getState().job ? Math.round(Math.hypot(w.x - runtime.player.pos.x, w.z - runtime.player.pos.z)) : null)
    }, 400)
    return () => clearInterval(id)
  }, [])
  if (!story || !step) return null
  const city = runtime.city!
  const obj = objectiveText(step, city)
  return (
    <div className={'objective story' + (job ? ' below' : '')}>
      <div className="eyebrow">
        Story · Chapter {story.chapter + 1} — {CHAPTERS[story.chapter].title}
      </div>
      <div className="obj-step">
        {obj}
        {dist !== null && (step.kind !== 'cond' || step.hint) ? ` · ${dist} m` : ''}
      </div>
    </div>
  )
}
