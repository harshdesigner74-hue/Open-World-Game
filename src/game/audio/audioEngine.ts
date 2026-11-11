/**
 * Fully procedural ambience with the Web Audio API — no audio files, nothing licensed.
 * Layers: traffic rumble, crowd murmur, birds (day), crickets (night), positional horns,
 * footsteps and UI blips. Levels are driven every frame by the simulation.
 */
class AudioEngine {
  ctx: AudioContext | null = null
  master!: GainNode
  private traffic!: GainNode
  private crowd!: GainNode
  private crickets!: GainNode
  private birdsLevel = 0
  private listener = { x: 0, z: 0, yaw: 0 }
  private nextBird = 0
  private nextChatter = 0
  private volume = 0.7
  private crowdLevel = 0

  start() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.volume
    const comp = ctx.createDynamicsCompressor()
    this.master.connect(comp).connect(ctx.destination)

    // traffic: brown noise through a low-pass, slow modulation
    this.traffic = ctx.createGain()
    this.traffic.gain.value = 0
    const tn = this.noise('brown')
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    tn.connect(lp).connect(this.traffic).connect(this.master)

    // crowd murmur: pink noise band-passed around speech formants, amplitude-modulated
    this.crowd = ctx.createGain()
    this.crowd.gain.value = 0
    const cn = this.noise('pink')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700
    bp.Q.value = 0.9
    const am = ctx.createGain()
    am.gain.value = 0.6
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 3.1
    const lfoG = ctx.createGain()
    lfoG.gain.value = 0.35
    lfo.connect(lfoG).connect(am.gain)
    lfo.start()
    cn.connect(bp).connect(am).connect(this.crowd).connect(this.master)

    // crickets: high sine pulses
    this.crickets = ctx.createGain()
    this.crickets.gain.value = 0
    const osc = ctx.createOscillator()
    osc.frequency.value = 4300
    const pulse = ctx.createGain()
    pulse.gain.value = 0
    const plfo = ctx.createOscillator()
    plfo.type = 'square'
    plfo.frequency.value = 14
    const plfoG = ctx.createGain()
    plfoG.gain.value = 0.5
    plfo.connect(plfoG).connect(pulse.gain)
    const slow = ctx.createOscillator()
    slow.frequency.value = 0.6
    const slowG = ctx.createGain()
    slowG.gain.value = 0.5
    slow.connect(slowG).connect(pulse.gain)
    osc.connect(pulse).connect(this.crickets).connect(this.master)
    osc.start()
    plfo.start()
    slow.start()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1)
  }
  suspend() {
    void this.ctx?.suspend()
  }
  resume() {
    void this.ctx?.resume()
  }

  private noise(kind: 'brown' | 'pink') {
    const ctx = this.ctx!
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    let b0 = 0,
      b1 = 0,
      b2 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else {
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11
      }
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.start()
    return src
  }

  setListener(x: number, z: number, yaw: number) {
    this.listener.x = x
    this.listener.z = z
    this.listener.yaw = yaw
  }

  /** Called ~10×/s by the ambience driver. */
  update(params: { trafficNear: number; crowdNear: number; daylight: number; dt: number }) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    this.traffic.gain.setTargetAtTime(Math.min(0.55, 0.04 + params.trafficNear * 0.05), t, 0.5)
    this.crowdLevel = Math.min(0.35, params.crowdNear * 0.012)
    this.crowd.gain.setTargetAtTime(this.crowdLevel * (0.4 + 0.6 * params.daylight), t, 0.6)
    this.crickets.gain.setTargetAtTime((1 - params.daylight) * 0.018, t, 1.5)
    this.birdsLevel = params.daylight
    if (t > this.nextBird && this.birdsLevel > 0.3) {
      this.nextBird = t + 1.5 + Math.random() * 5
      this.bird()
    }
    if (t > this.nextChatter && params.crowdNear > 6) {
      this.nextChatter = t + 0.8 + Math.random() * 2.5
      this.chatterBlip()
    }
  }

  private pan(x: number, z: number) {
    const dx = x - this.listener.x,
      dz = z - this.listener.z
    const d = Math.hypot(dx, dz)
    // camera right vector for yaw: (-cos, sin)
    const right = (dx * -Math.cos(this.listener.yaw) + dz * Math.sin(this.listener.yaw)) / Math.max(1, d)
    return { pan: Math.max(-1, Math.min(1, right)), att: 1 / (1 + d * 0.06) }
  }

  horn(x: number, z: number, kind: string) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const { pan, att } = this.pan(x, z)
    if (att < 0.12) return
    const t = ctx.currentTime
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    const g = ctx.createGain()
    const big = kind === 'bus' || kind === 'truck'
    const small = kind === 'auto' || kind === 'scooter' || kind === 'bike'
    const f = big ? 220 : small ? 520 : 390
    const dur = 0.18 + Math.random() * 0.35
    const repeats = Math.random() < 0.4 ? 2 : 1
    for (let r = 0; r < repeats; r++) {
      const st = t + r * (dur + 0.08)
      for (const mul of [1, 1.26]) {
        const o = ctx.createOscillator()
        o.type = 'square'
        o.frequency.value = f * mul
        o.connect(g)
        o.start(st)
        o.stop(st + dur)
      }
      g.gain.setValueAtTime(0, st)
      g.gain.linearRampToValueAtTime(0.06 * att, st + 0.02)
      g.gain.setValueAtTime(0.06 * att, st + dur - 0.03)
      g.gain.linearRampToValueAtTime(0, st + dur)
    }
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2400
    g.connect(lp).connect(p).connect(this.master)
  }

  private bird() {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const g = ctx.createGain()
    const p = ctx.createStereoPanner()
    p.pan.value = Math.random() * 2 - 1
    g.connect(p).connect(this.master)
    const notes = 2 + Math.floor(Math.random() * 4)
    const base = 2200 + Math.random() * 1800
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator()
      const st = t + i * 0.13
      o.frequency.setValueAtTime(base, st)
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), st + 0.08)
      const eg = ctx.createGain()
      eg.gain.setValueAtTime(0, st)
      eg.gain.linearRampToValueAtTime(0.012 * this.birdsLevel, st + 0.01)
      eg.gain.linearRampToValueAtTime(0, st + 0.1)
      o.connect(eg).connect(g)
      o.start(st)
      o.stop(st + 0.12)
    }
  }

  /** short vowel-ish burst suggesting nearby conversation */
  private chatterBlip() {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    const f0 = 110 + Math.random() * 120
    o.frequency.setValueAtTime(f0, t)
    o.frequency.linearRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), t + 0.25)
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 600 + Math.random() * 900
    f.Q.value = 4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.02 * this.crowdLevel * 4, t + 0.04)
    g.gain.linearRampToValueAtTime(0, t + 0.28)
    const p = ctx.createStereoPanner()
    p.pan.value = Math.random() * 1.6 - 0.8
    o.connect(f).connect(g).connect(p).connect(this.master)
    o.start(t)
    o.stop(t + 0.3)
  }

  footstep(speed: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    const len = 0.06
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900 + speed * 120
    const g = ctx.createGain()
    g.gain.value = 0.05 + Math.min(0.08, speed * 0.012)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
  }

  private eng: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filt: BiquadFilterNode; base: number } | null = null
  engineStart(kind: string) {
    const ctx = this.ctx
    if (!ctx || this.eng) return
    const base = kind === 'scooter' ? 95 : kind === 'bike' ? 70 : kind === 'auto' ? 55 : kind === 'suv' ? 42 : 48
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const osc2 = ctx.createOscillator()
    osc2.type = 'square'
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.frequency.value = 500
    const gain = ctx.createGain()
    gain.gain.value = 0.0
    osc.connect(filt)
    osc2.connect(filt)
    filt.connect(gain).connect(this.master)
    osc.frequency.value = base
    osc2.frequency.value = base * 0.5
    osc.start()
    osc2.start()
    this.eng = { osc, osc2, gain, filt, base }
  }
  engine(rev: number, throttle: number) {
    const e = this.eng
    const ctx = this.ctx
    if (!e || !ctx) return
    const t = ctx.currentTime
    const f = e.base * (1 + rev * 2.4 + throttle * 0.25)
    e.osc.frequency.setTargetAtTime(f, t, 0.08)
    e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08)
    e.filt.frequency.setTargetAtTime(380 + rev * 1400 + throttle * 300, t, 0.1)
    e.gain.gain.setTargetAtTime(0.035 + throttle * 0.025 + rev * 0.02, t, 0.1)
  }
  engineStop() {
    const e = this.eng
    if (!e) return
    try {
      e.osc.stop()
      e.osc2.stop()
    } catch {
      /* already stopped */
    }
    this.eng = null
  }
  crash(impact: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    const len = 0.35
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 900
    const g = ctx.createGain()
    g.gain.value = Math.min(0.35, 0.05 + impact * 0.02)
    src.connect(f).connect(g).connect(this.master)
    src.start(t)
  }

  private rainNode: { gain: GainNode } | null = null
  rain(level: number) {
    const ctx = this.ctx
    if (!ctx) return
    if (!this.rainNode && level > 0.02) {
      const src = this.noise('pink')
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(hp).connect(gain).connect(this.master)
      this.rainNode = { gain }
    }
    if (this.rainNode) this.rainNode.gain.gain.setTargetAtTime(level * 0.22, ctx.currentTime, 0.8)
  }
  thunder(delay: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime + delay
    const len = 3.5
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      const env = Math.min(1, i / (ctx.sampleRate * 0.05)) * Math.pow(1 - i / d.length, 1.6) * (1 + 0.6 * Math.sin(i / 2200))
      d[i] = last * 9 * env
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 260
    const g = ctx.createGain()
    g.gain.value = 0.55
    src.connect(lp).connect(g).connect(this.master)
    src.start(t)
  }
  /** temple bell: inharmonic partials with long decay */
  bell(x: number, z: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const { pan, att } = this.pan(x, z)
    if (att < 0.15) return
    const t = ctx.currentTime
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(this.master)
    for (const [mul, amp, dec] of [[1, 0.05, 2.5], [2.76, 0.025, 1.6], [5.4, 0.015, 0.9], [8.9, 0.008, 0.5]] as const) {
      const o = ctx.createOscillator()
      o.frequency.value = 520 * mul
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(amp * att, t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec)
      o.connect(g).connect(p)
      o.start(t)
      o.stop(t + dec)
    }
  }

  jump() {
    this.blip(180, 0.03, 0.08)
  }

  blip(freq = 660, vol = 0.05, dur = 0.09) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur)
  }

  cash() {
    this.blip(1320, 0.04, 0.08)
    setTimeout(() => this.blip(1760, 0.04, 0.12), 70)
  }
}

export const audio = new AudioEngine()
