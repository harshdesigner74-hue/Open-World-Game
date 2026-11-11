import { useEffect, useMemo, useState } from 'react'
import { runtime } from '../game/state/runtime'
import { useGame } from '../game/state/store'
import { DATE_BEATS, GIFTS, PEOPLE, TOPICS, VENUES, personById, personSpot, type Reaction, type Tag, type Venue } from '../game/social/people'
import {
  RING_PRICE, WEDDINGS, askToBePartner, buyRing, canDate, finishDate, friendLabel, getRel, giveGift, hangOut, nowMin,
  partnerWord, propose, romanceLabel, spendNight, startChallenge, statusWith, talk, wed,
} from '../game/social/social'
import { socialRuntime } from '../game/social/SocialSystem'
import { chaiSpot, garageSpot } from '../game/story/story'

/** full-screen fade-to-black with a caption, then fade back in */
export function cinema(text: string) {
  useGame.setState({ cinema: text })
  setTimeout(() => {
    if (useGame.getState().cinema === text) useGame.setState({ cinema: null })
  }, 2600)
}
export function CinemaOverlay() {
  const text = useGame((s) => s.cinema)
  if (!text) return null
  return (
    <div className="cinema">
      <div className="cinema-text">{text}</div>
    </div>
  )
}

const EMOJI: Record<Reaction, string> = { love: '😍', like: '🙂', meh: '😐', dislike: '😒' }

function Meter({ label, value, color, sub }: { label: string; value: number; color: string; sub: string }) {
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{label}</span>
        <span className="muted small">{sub}</span>
      </div>
      <div className="meter-bar">
        <div style={{ width: `${Math.round(value)}%`, background: color }} />
      </div>
    </div>
  )
}

function Avatar({ id }: { id: string }) {
  const p = personById(id)
  return (
    <div className="avatar" style={{ background: `linear-gradient(135deg, ${p.look.top}, ${p.look.skin})` }}>
      {p.name[0]}
    </div>
  )
}

export function SocialPanel({ person, onClose }: { person: string; onClose: () => void }) {
  const p = personById(person)
  useGame((s) => s.progress.social?.[person]) // re-render on changes
  const prog = useGame((s) => s.progress)
  const rel = getRel(person)
  const status = statusWith(person)
  const [msg, setMsg] = useState<{ text: string; emoji?: string } | null>({ text: greeting(person) })
  const [tab, setTab] = useState<'talk' | 'gift' | 'more'>('talk')
  const topics = useMemo(() => {
    const seed = Math.floor(nowMin() / 45) + person.length
    const pool = [...TOPICS].sort((a, b) => ((a.id.charCodeAt(0) * 31 + seed * 17) % 97) - ((b.id.charCodeAt(0) * 31 + seed * 17) % 97))
    return pool.slice(0, 4)
    // re-roll after each conversation
  }, [person, rel.lastTalk]) // eslint-disable-line react-hooks/exhaustive-deps
  const say = (r: { reaction: Reaction; line: string } | { error: string }) =>
    setMsg('error' in r ? { text: r.error } : { text: r.line, emoji: EMOJI[r.reaction] })
  const sayText = (t: string) => setMsg({ text: t })
  const at = () => (person === 'rohan' ? chaiSpot(runtime.city!) : person === 'meera' ? garageSpot(runtime.city!) : personSpot(runtime.city!, p))
  const known = rel.f >= 40 ? p.likes : []
  const knownBad = rel.f >= 60 ? p.dislikes : []

  return (
    <div className="panel-center">
      <div className="panel social">
        <div className="social-head">
          <Avatar id={person} />
          <div style={{ flex: 1 }}>
            <div className="social-name">
              {p.name}, {p.age} {status && <span className="pill love">{status === 'dating' ? `Your ${partnerWord(p.female)}` : status === 'engaged' ? 'Engaged 💍' : 'Married ❤️'}</span>}
            </div>
            <div className="muted">{p.role} · {p.bio}</div>
          </div>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        <Meter label="Friendship" value={rel.f} color="#4fb3ff" sub={friendLabel(rel.f)} />
        {p.romance && <Meter label="Romance" value={rel.r} color="#ff5c8a" sub={`${romanceLabel(rel.r)}${rel.dates ? ` · ${rel.dates} date${rel.dates > 1 ? 's' : ''}` : ''}`} />}
        {(known.length > 0 || knownBad.length > 0) && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {known.length > 0 && <>💚 Loves: {known.join(', ')} </>}
            {knownBad.length > 0 && <> · 💢 Hates: {knownBad.join(', ')}</>}
          </div>
        )}
        {msg && (
          <div className="bubble">
            {msg.emoji && <span className="bubble-emoji">{msg.emoji}</span>}
            <b>{p.name}:</b> {msg.text}
          </div>
        )}
        <div className="tabs">
          {(['talk', 'gift', 'more'] as const).map((t) => (
            <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
              {t === 'talk' ? '💬 Talk' : t === 'gift' ? '🎁 Gift' : p.romance ? '❤️ Together' : '🤝 Hang out'}
            </button>
          ))}
        </div>
        {tab === 'talk' && (
          <div className="choices">
            {topics.map((t) => (
              <button key={t.id} className="choice" onClick={() => say(talk(person, t))}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {tab === 'gift' && (
          <div className="choices grid2">
            {GIFTS.map((g) => (
              <button key={g.id} className="choice" onClick={() => say(giveGift(person, g))}>
                {g.label} <span className="muted">₹{g.price.toLocaleString('en-IN')}</span>
              </button>
            ))}
          </div>
        )}
        {tab === 'more' && (
          <div className="choices">
            <button className="choice" onClick={() => sayText(hangOut(person, 'chai'))}>☕ Cutting chai together <span className="muted">₹40 · 1 h</span></button>
            <button className="choice" onClick={() => sayText(hangOut(person, 'match'))}>📺 Watch the cricket at a dhaba <span className="muted">₹250 · 3 h</span></button>
            {p.challenge && (
              <button
                className="choice"
                onClick={() => {
                  const r = startChallenge(person, at())
                  sayText(r)
                  if (r.startsWith('🏁')) setTimeout(onClose, 900)
                }}
              >
                🏁 Friend challenge: {p.challenge === 'race' ? 'beat my time' : p.challenge === 'delivery' ? 'rush delivery' : p.challenge === 'chairun' ? 'the chai run' : 'test drive'}
              </button>
            )}
            {p.romance && (
              <>
                <button
                  className="choice love"
                  onClick={() => {
                    const why = canDate(person)
                    if (why) return sayText(why)
                    useGame.getState().openPanel('date', { person })
                  }}
                >
                  🌹 Ask {p.name} out on a date
                </button>
                {!status && (
                  <button className="choice love" onClick={() => sayText(askToBePartner(person))}>
                    💞 Ask {p.name} to be your {partnerWord(p.female)}
                  </button>
                )}
                {status && (
                  <button
                    className="choice love"
                    onClick={() => {
                      const r = spendNight(person)
                      sayText(r)
                      if (r.startsWith('🌙')) {
                        onClose()
                        cinema(`🌙 The night belongs to the two of you…`)
                      }
                    }}
                  >
                    🌙 Invite {p.name} to spend the night at your flat
                  </button>
                )}
                {status === 'dating' && !prog.ring && (
                  <button className="choice love" onClick={() => sayText(buyRing())}>
                    💍 Buy an engagement ring <span className="muted">₹{RING_PRICE.toLocaleString('en-IN')}</span>
                  </button>
                )}
                {status === 'dating' && prog.ring && (
                  <button className="choice love" onClick={() => sayText(propose(person))}>
                    💍 Get down on one knee and propose
                  </button>
                )}
                {status === 'engaged' &&
                  WEDDINGS.map((w) => (
                    <button
                      key={w.id}
                      className="choice love"
                      onClick={() => {
                        const r = wed(person, w)
                        sayText(r)
                        if (r.includes('married')) cinema(w.id === 'big' ? '🎉 Shaadi Mubarak! 🎉' : '💐 Just married 💐')
                      }}
                    >
                      {w.label} <span className="muted">₹{w.price.toLocaleString('en-IN')}</span>
                    </button>
                  ))}
              </>
            )}
          </div>
        )}
        <div className="muted small" style={{ marginTop: 10 }}>
          Talking has a short cool-down; one gift per day. Relationships fade if you disappear for days.
        </div>
      </div>
    </div>
  )
}

function greeting(id: string) {
  const p = personById(id)
  const r = getRel(id)
  const s = statusWith(id)
  if (s === 'married') return 'Hey you. Home for dinner tonight? ❤️'
  if (s) return `There you are! I was just thinking about you.`
  if (r.f < 15) return `Hi… do I know you? I'm ${p.name}.`
  if (r.f < 40) return `Oh hey! Good to see you again.`
  if (r.f < 70) return `Yaar, where have you been? Sit, sit.`
  return `My favourite person in this city! What's the plan?`
}

/* ------------------------------------------------------------------ dates */
function venueSpot(v: Venue) {
  const city = runtime.city!
  const P = runtime.player.pos
  const near = <T extends { x: number; z: number }>(list: T[]) => {
    let b: T | null = null,
      bd = Infinity
    for (const it of list) {
      const d = Math.hypot(it.x - P.x, it.z - P.z)
      if (d < bd) {
        bd = d
        b = it
      }
    }
    return b
  }
  const B = city.bounds
  const ok = (x: number, z: number) => x > B.minX + 30 && x < B.maxX - 30 && z > B.minZ + 30 && z < B.maxZ - 30
  const pick =
    v.where === 'food'
      ? near(city.interactables.filter((i) => (i.type === 'food' || i.type === 'tea') && ok(i.x, i.z)))
      : v.where === 'market'
        ? near(city.landmarks.filter((l) => l.category === 'market' && ok(l.x, l.z)))
        : near(city.landmarks.filter((l) => (l.category === 'monument' || l.category === 'park') && ok(l.x, l.z)))
  return pick ? { x: pick.x + 3, z: pick.z + 3 } : { x: P.x, z: P.z }
}

export function DatePanel({ person, onClose }: { person: string; onClose: () => void }) {
  const p = personById(person)
  const [venue, setVenue] = useState<Venue | null>(null)
  const [beat, setBeat] = useState(0)
  const [picks, setPicks] = useState<Tag[][]>([])
  const [result, setResult] = useState<{ gain: number; verdict: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const choose = (v: Venue) => {
    const g = useGame.getState()
    if (v.needsVehicle && !g.progress.vehicles.length) return setErr('You need your own vehicle for a long drive.')
    if (v.price && !g.spend(v.price)) return setErr(`Not enough cash (₹${v.price.toLocaleString('en-IN')}).`)
    // meet at the venue: both of you are moved there for the date
    const at = venueSpot(v)
    // they stand just off-axis in front of you, so the over-the-shoulder camera sees their face
    const yaw = Math.PI / 2
    runtime.player.teleport = { x: at.x, z: at.z, yaw }
    socialRuntime.invite = { id: person, x: at.x + Math.sin(yaw + 0.5) * 2.1, z: at.z + Math.cos(yaw + 0.5) * 2.1, until: nowMin() + v.hours * 60 + 60 }
    runtime.cam.pitch = 0.04
    cinema(`${v.label.split(' ')[0]} Date with ${p.name}`)
    setVenue(v)
  }
  const pick = (tags: Tag[]) => {
    const next = [...picks, tags]
    setPicks(next)
    if (beat + 1 < DATE_BEATS.length) setBeat(beat + 1)
    else setResult(finishDate(person, venue!, next))
  }

  return (
    <div className="dlg date">
      <div className="dlg-bar top" />
      <div className="dlg-bar bottom">
        <div className="dlg-who">{venue ? `${venue.label} with ${p.name}` : `Plan a date with ${p.name}`}</div>
        {!venue && (
          <>
            <div className="choices grid2">
              {VENUES.map((v) => (
                <button key={v.id} className="choice" onClick={() => choose(v)}>
                  {v.label} <span className="muted">{v.price ? `₹${v.price.toLocaleString('en-IN')}` : 'free'} · {v.hours} h</span>
                </button>
              ))}
            </div>
            {err && <div className="obj-warn">{err}</div>}
            <button className="btn ghost" onClick={onClose}>Not now</button>
          </>
        )}
        {venue && !result && (
          <>
            <div className="dlg-text">{DATE_BEATS[beat].prompt}</div>
            <div className="choices">
              {DATE_BEATS[beat].choices.map((c, i) => (
                <button key={i} className="choice" onClick={() => pick(c.tags)}>
                  {c.text}
                </button>
              ))}
            </div>
            <div className="dlg-hint">Moment {beat + 1}/{DATE_BEATS.length}</div>
          </>
        )}
        {result && (
          <>
            <div className="dlg-text">{result.verdict}</div>
            <div className="muted">Romance {result.gain >= 0 ? '+' : ''}{result.gain}</div>
            <button className="btn" onClick={onClose}>Continue</button>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ phone */
export function PhonePanel({ onClose }: { onClose: () => void }) {
  const prog = useGame((s) => s.progress)
  const [tab, setTab] = useState<'contacts' | 'messages'>('contacts')
  const [note, setNote] = useState<string | null>(null)
  const known = PEOPLE.filter((p) => (prog.social?.[p.id]?.f ?? 0) > 0 || p.id === 'rohan')
  useEffect(() => setNote(null), [tab])
  const invite = (id: string) => {
    const p = personById(id)
    const r = getRel(id)
    if (r.f < 40 && prog.partner !== id) return setNote(`${p.name} doesn't know you well enough to drop everything (friendship 40+).`)
    const P = runtime.player.pos
    socialRuntime.invite = { id, x: P.x + 1.6, z: P.z + 1.2, until: nowMin() + 120 }
    setNote(`📞 ${p.name}: "On my way!" — they're here for the next two hours.`)
  }
  const locate = (id: string) => {
    const p = personById(id)
    const at = id === 'rohan' ? chaiSpot(runtime.city!) : id === 'meera' ? garageSpot(runtime.city!) : personSpot(runtime.city!, p)
    useGame.setState({ waypoint: { x: at.x, z: at.z } })
    setNote(`📍 Waypoint set to where ${p.name} usually hangs out.`)
  }
  return (
    <div className="panel-center">
      <div className="panel phone">
        <div className="phone-notch" />
        <div className="tabs">
          <button className={'tab' + (tab === 'contacts' ? ' on' : '')} onClick={() => setTab('contacts')}>👥 Contacts</button>
          <button className={'tab' + (tab === 'messages' ? ' on' : '')} onClick={() => setTab('messages')}>💬 Messages {prog.inbox?.length ? `(${prog.inbox.length})` : ''}</button>
        </div>
        {tab === 'contacts' && (
          <div className="contacts">
            {known.length === 0 && <div className="muted">No contacts yet — walk up to people and say hi.</div>}
            {known.map((p) => {
              const r = prog.social?.[p.id]
              const s = prog.partner === p.id ? prog.partnerStatus : undefined
              return (
                <div key={p.id} className="contact">
                  <Avatar id={p.id} />
                  <div style={{ flex: 1 }}>
                    <div>
                      <b>{p.name}</b> <span className="muted small">{p.role}</span> {s && <span className="pill love">{s}</span>}
                    </div>
                    <div className="small muted">
                      {friendLabel(r?.f ?? 0)}
                      {p.romance && r && r.r > 0 ? ` · ${romanceLabel(r.r)}` : ''}
                    </div>
                  </div>
                  <button className="btn ghost small" onClick={() => invite(p.id)}>Call</button>
                  <button className="btn ghost small" onClick={() => locate(p.id)}>📍</button>
                </div>
              )
            })}
            <div className="muted small">Not met yet: {PEOPLE.filter((p) => !known.includes(p)).map((p) => `${p.name} (${p.role})`).join(', ') || 'nobody — you know everyone!'}</div>
          </div>
        )}
        {tab === 'messages' && (
          <div className="contacts">
            {!prog.inbox?.length && <div className="muted">No messages.</div>}
            {[...(prog.inbox ?? [])].reverse().map((m, i) => (
              <div key={i} className="msg">
                <b>{personById(m.from)?.name ?? m.from}</b> <span className="muted small">day {m.day}</span>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
        )}
        {note && <div className="bubble">{note}</div>}
        <button className="btn" onClick={onClose}>Close phone</button>
      </div>
    </div>
  )
}
