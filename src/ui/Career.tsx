import { useEffect, useMemo, useState } from 'react'
import { audio } from '../game/audio/audioEngine'
import { generateJobs } from '../game/missions/jobs'
import { DIYAS_PER_CITY } from '../game/progress/Collectibles'
import { ACHIEVEMENTS, bump, type Style } from '../game/progress/progress'
import { runtime } from '../game/state/runtime'
import { useGame, type ActiveJob } from '../game/state/store'
import { DRIVE } from '../game/vehicles/specs'
import { CITIES } from '../game/world/cities/registry'
import { CAR_COLORS, type VehicleKind } from '../game/world/models'

const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

/** Pay from cash first, then by bank transfer. */
function pay(amount: number): boolean {
  const g = useGame.getState()
  if (g.cash + g.bank < amount) {
    g.toast(`You need ${inr(amount)} (cash + bank).`, 'warn')
    return false
  }
  const fromCash = Math.min(g.cash, amount)
  useGame.setState({ cash: g.cash - fromCash, bank: g.bank - (amount - fromCash) })
  audio.cash()
  return true
}

/** Spot a few metres in front of the player for delivered vehicles. */
function spotAhead() {
  const P = runtime.player
  return { x: P.pos.x + Math.sin(P.yaw) * 3.2, z: P.pos.z + Math.cos(P.yaw) * 3.2, rot: P.yaw + Math.PI / 2 }
}

export function JobsPanel({ onClose }: { onClose: () => void }) {
  const job = useGame((s) => s.job)
  const offers = useMemo(() => generateJobs(), [])
  const take = (j: ActiveJob) => {
    const start = runtime.time.elapsed
    useGame.setState({ job: { ...j, deadline: j.deadline ? start + j.deadline : 0 }, waypoint: { x: j.targets[0].x, z: j.targets[0].z } })
    useGame.getState().toast(`📋 Job accepted: ${j.title}`, 'info')
    onClose()
  }
  return (
    <div className="panel-center">
      <div className="career">
        <div className="eyebrow">Jobs board</div>
        <h2>Kaam dhandha</h2>
        {job ? (
          <div className="job-card active">
            <div className="job-title">{job.title}</div>
            <div className="muted">Current step: {job.targets[job.stage].label} · Reward {inr(job.reward)}</div>
            <button className="btn ghost" onClick={() => useGame.setState({ job: null, waypoint: null })}>
              Abandon job
            </button>
          </div>
        ) : (
          <>
            {offers.length === 0 && <div className="muted">No jobs around here right now — try a busier street.</div>}
            {offers.map((j, i) => (
              <div key={i} className="job-card">
                <div className="job-kind">{j.kind === 'delivery' ? '📦 Delivery' : j.kind === 'fare' ? '🚕 Passenger fare' : '🗺️ Sightseeing tour'}</div>
                <div className="job-title">{j.title}</div>
                <div className="muted">
                  {j.targets.length} stops · {j.deadline ? `time limit ${Math.round(j.deadline / 60)} min` : 'no time limit'}
                  {j.needsVehicle ? ' · needs a car, taxi or auto' : ''}
                </div>
                <div className="job-foot">
                  <span className="job-reward">{inr(j.reward)}</span>
                  <button className="btn" onClick={() => take(j)}>
                    Accept
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
        <div className="row-end">
          <button className="btn ghost" onClick={onClose}>
            Close [J]
          </button>
        </div>
      </div>
    </div>
  )
}

const STYLES: { id: Style; name: string; price: number; desc: string }[] = [
  { id: 'hoodie', name: 'Pullover hoodie', price: 0, desc: 'Your reference look' },
  { id: 'tshirt', name: 'Graphic T-shirt', price: 600, desc: 'Short sleeves for Indian summers' },
  { id: 'shirt', name: 'Button-down shirt', price: 900, desc: 'Smart casual' },
  { id: 'kurta', name: 'Kurta', price: 1400, desc: 'Knee-length, festive-ready' },
]

export function WardrobePanel({ onClose }: { onClose: () => void }) {
  const progress = useGame((s) => s.progress)
  const choose = (s: (typeof STYLES)[number]) => {
    if (!progress.ownedStyles.includes(s.id)) {
      if (!pay(s.price)) return
      bump((p) => ({ ownedStyles: [...p.ownedStyles, s.id], style: s.id }))
      useGame.getState().toast(`👕 Bought: ${s.name}`, 'money')
    } else bump(() => ({ style: s.id }))
  }
  return (
    <div className="panel-center">
      <div className="career">
        <div className="eyebrow">Clothes shop</div>
        <h2>New look</h2>
        <div className="muted small">Colours can be changed any time in the Character menu (Tab).</div>
        {STYLES.map((s) => {
          const owned = progress.ownedStyles.includes(s.id)
          return (
            <div key={s.id} className={'job-card' + (progress.style === s.id ? ' active' : '')}>
              <div className="job-title">{s.name}</div>
              <div className="muted">{s.desc}</div>
              <div className="job-foot">
                <span className="job-reward">{owned ? 'Owned' : inr(s.price)}</span>
                <button className="btn" disabled={progress.style === s.id} onClick={() => choose(s)}>
                  {progress.style === s.id ? 'Wearing' : owned ? 'Wear' : 'Buy & wear'}
                </button>
              </div>
            </div>
          )
        })}
        <div className="row-end">
          <button className="btn ghost" onClick={onClose}>
            Leave shop
          </button>
        </div>
      </div>
    </div>
  )
}

export function DealerPanel({ onClose }: { onClose: () => void }) {
  const [color, setColor] = useState(CAR_COLORS[5])
  const buy = (kind: VehicleKind) => {
    const spec = DRIVE[kind]!
    if (!pay(spec.price)) return
    const g = useGame.getState()
    const id = Date.now() % 1e9
    const at = spotAhead()
    const col = kind === 'auto' ? '#2f7d3b' : color
    bump((p) => ({ vehicles: [...p.vehicles, { id, kind, color: col, city: g.cityId, x: at.x, z: at.z, rot: at.rot, health: 100, fuel: 100 }] }))
    runtime.parked?.add({ kind, color: col, x: at.x, z: at.z, rot: at.rot, owned: true, health: 100, fuel: 100, ownedId: id })
    g.toast(`🔑 Your new ${spec.name} is parked right outside. Press F near it to drive.`, 'money')
    onClose()
  }
  return (
    <div className="panel-center">
      <div className="career wide">
        <div className="eyebrow">Vehicle showroom</div>
        <h2>Apni gaadi</h2>
        <div className="swatch-row">
          <span>Colour</span>
          {[...new Set(CAR_COLORS)].map((c) => (
            <button key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="dealer-grid">
          {(Object.keys(DRIVE) as VehicleKind[]).map((k) => {
            const s = DRIVE[k]!
            return (
              <div key={k} className="job-card">
                <div className="job-title">{s.name}</div>
                <div className="muted small">
                  Top speed {Math.round(s.maxSpeed * 3.6)} km/h · {s.twoWheeler ? 'two-wheeler' : 'four/three-wheeler'}
                </div>
                <div className="job-foot">
                  <span className="job-reward">{inr(s.price)}</span>
                  <button className="btn" onClick={() => buy(k)}>
                    Buy
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="muted small">Paid from cash first, then by bank transfer. Prices are game-balanced, not real.</div>
        <div className="row-end">
          <button className="btn ghost" onClick={onClose}>
            Leave showroom
          </button>
        </div>
      </div>
    </div>
  )
}

export function VehiclesPanel({ onClose }: { onClose: () => void }) {
  const vehicles = useGame((s) => s.progress.vehicles)
  const cityId = useGame((s) => s.cityId)
  const deliver = (id: number) => {
    const v = vehicles.find((o) => o.id === id)!
    if (runtime.drive.active && runtime.drive.ownedId === id) return useGame.getState().toast('You are driving it!', 'info')
    if (!pay(v.city === cityId ? 200 : 1500)) return
    // remove it from wherever it is parked in this city
    for (const p of runtime.parked?.list ?? []) if (p.ownedId === id) p.taken = true
    const at = spotAhead()
    bump((p) => ({ vehicles: p.vehicles.map((o) => (o.id === id ? { ...o, city: cityId, x: at.x, z: at.z, rot: at.rot } : o)) }))
    runtime.parked?.add({ kind: v.kind, color: v.color, x: at.x, z: at.z, rot: at.rot, owned: true, health: v.health, fuel: v.fuel, ownedId: id })
    useGame.getState().toast(`🚚 Your ${DRIVE[v.kind]!.name} has been delivered.`, 'info')
    onClose()
  }
  return (
    <div className="panel-center">
      <div className="career">
        <div className="eyebrow">Garage</div>
        <h2>My vehicles</h2>
        {!vehicles.length && <div className="muted">You don’t own any vehicles yet — visit a vehicle showroom.</div>}
        {vehicles.map((v) => {
          const here = v.city === cityId
          const d = here ? Math.round(Math.hypot(v.x - runtime.player.pos.x, v.z - runtime.player.pos.z)) : 0
          return (
            <div key={v.id} className="job-card">
              <div className="job-title">
                <span className="dot" style={{ background: v.color }} /> {DRIVE[v.kind]!.name}
              </div>
              <div className="muted small">
                {here ? `Parked ${d} m away` : `Parked in ${CITIES.find((c) => c.id === v.city)?.name}`} · condition {Math.round(v.health)}% · fuel {Math.round(v.fuel)}%
              </div>
              <div className="job-foot">
                <span className="job-reward">{here ? inr(200) : inr(1500)}</span>
                <button className="btn" onClick={() => deliver(v.id)}>
                  Deliver to me
                </button>
              </div>
            </div>
          )
        })}
        <div className="row-end">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** Objective tracker under the toasts. */
export function ObjectiveHUD() {
  const job = useGame((s) => s.job)
  const [left, setLeft] = useState(0)
  const [dist, setDist] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      const j = useGame.getState().job
      if (!j) return
      setLeft(j.deadline ? Math.max(0, j.deadline - runtime.time.elapsed) : 0)
      const t = j.targets[j.stage]
      setDist(Math.round(Math.hypot(t.x - runtime.player.pos.x, t.z - runtime.player.pos.z)))
    }, 300)
    return () => clearInterval(id)
  }, [])
  if (!job) return null
  const t = job.targets[job.stage]
  const needCar = (job.kind === 'fare' || (job.kind === 'challenge' && job.needsVehicle)) && !(runtime.drive.active && !DRIVE[runtime.drive.kind]?.twoWheeler)
  return (
    <div className="objective">
      <div className="eyebrow">{job.kind === 'challenge' ? 'Friend challenge' : 'Job'} · {inr(job.reward)}</div>
      <div className="obj-title">{job.title}</div>
      <div className="obj-step">
        {job.stage + 1}/{job.targets.length} · {t.label} · {dist} m
      </div>
      {job.deadline > 0 && (
        <div className={'obj-time' + (left < 30 ? ' warn' : '')}>
          ⏱ {Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}
        </div>
      )}
      {needCar && <div className="obj-warn">Get a car, taxi or auto-rickshaw for this fare (F near a vehicle).</div>}
    </div>
  )
}

/** Career stats + achievements for the Character menu. */
export function ProgressSection() {
  const p = useGame((s) => s.progress)
  const cityId = useGame((s) => s.cityId)
  const city = runtime.city
  const totalLm = city?.landmarks.length ?? 0
  const foundLm = p.landmarks.filter((l) => l.startsWith(cityId + ':')).length
  return (
    <div className="progress">
      <div className="eyebrow" style={{ marginTop: 18 }}>
        Progress
      </div>
      <div className="prog-grid">
        <div><b>{p.jobsDone}</b> jobs · {inr(p.earned)} earned</div>
        <div><b>{(p.diyas[cityId] ?? []).length}/{DIYAS_PER_CITY}</b> Golden Diyas here</div>
        <div><b>{foundLm}/{totalLm}</b> landmarks here</div>
        <div><b>{p.cities.length}/{CITIES.length}</b> cities visited</div>
        <div><b>{p.vehicles.length}</b> vehicles owned</div>
        <div><b>{p.chai}</b> chai</div>
      </div>
      <div className="eyebrow" style={{ marginTop: 14 }}>
        Achievements {p.achievements.length}/{Object.keys(ACHIEVEMENTS).length}
      </div>
      <div className="ach-list">
        {Object.entries(ACHIEVEMENTS).map(([id, a]) => (
          <div key={id} className={'ach' + (p.achievements.includes(id) ? ' on' : '')} title={a.desc}>
            {p.achievements.includes(id) ? '🏆' : '🔒'} {a.title}
          </div>
        ))}
      </div>
    </div>
  )
}
