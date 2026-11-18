import { mulberry32 } from '../utils/math'

/**
 * In-car radio. Four original stations, composed live with the Web Audio API (no recordings,
 * nothing licensed): every phrase is generated from a seeded random walk over the station's
 * scale, so the music keeps changing but stays in key and on the beat.
 *
 *  - Radio Masala 98.3  — filmi pop: dholak + four-on-the-floor, synth shehnai lead, pads
 *  - Raag FM 101.1      — classical: tanpura drone, sitar in raag Yaman with meend, teentaal tabla
 *  - Bhangra Junction 104.8 — dhol chaal, tumbi riffs, bass
 *  - Lo-Fi Chai 91.9    — lazy swung beat, electric-piano 7ths, bansuri, vinyl crackle
 */

type Rng = () => number
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Synth kit: every voice schedules itself at an absolute AudioContext time. */
class Kit {
  private noiseBuf: AudioBuffer
  private plucks = new Map<string, AudioBuffer>()
  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
    private send: AudioNode,
  ) {
    const n = ctx.sampleRate
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }

  private env(t: number, peak: number, a: number, dec: number, wet = 0) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec)
    g.connect(this.out)
    if (wet > 0) {
      const s = this.ctx.createGain()
      s.gain.value = wet
      g.connect(s).connect(this.send)
    }
    return g
  }
  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode) {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    o.connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    return o
  }
  private noise(t: number, dur: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource()
    s.buffer = this.noiseBuf
    s.connect(dest)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.02)
    return s
  }
  private filter(type: BiquadFilterType, f: number, q: number, dest: AudioNode) {
    const b = this.ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    b.connect(dest)
    return b
  }

  /* ---------------- drums ---------------- */
  kick(t: number, v = 1) {
    const g = this.env(t, 0.9 * v, 0.002, 0.32)
    const o = this.osc('sine', 150, t, 0.4, g)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12)
  }
  snare(t: number, v = 1) {
    this.noise(t, 0.2, this.filter('bandpass', 1900, 0.8, this.env(t, 0.45 * v, 0.001, 0.16, 0.25)))
    this.osc('triangle', 210, t, 0.1, this.env(t, 0.25 * v, 0.001, 0.08))
  }
  clap(t: number, v = 1) {
    for (let k = 0; k < 3; k++) this.noise(t + k * 0.011, 0.12, this.filter('bandpass', 1300, 1.2, this.env(t + k * 0.011, 0.32 * v, 0.001, k === 2 ? 0.14 : 0.02, 0.3)))
  }
  hat(t: number, v = 1, open = false) {
    this.noise(t, open ? 0.3 : 0.06, this.filter('highpass', 7500, 0.7, this.env(t, 0.16 * v, 0.001, open ? 0.25 : 0.04)))
  }
  shaker(t: number, v = 1) {
    this.noise(t, 0.08, this.filter('bandpass', 5200, 1.5, this.env(t, 0.1 * v, 0.012, 0.05)))
  }
  /** tabla: dayan strokes are tuned to Sa; the bayan glides up (the "ge" sound) */
  tabla(t: number, bol: string, sa: number, v = 1) {
    const dayan = (ring: number, peak: number) => {
      const g = this.env(t, peak * v, 0.002, ring, 0.15)
      this.osc('sine', sa, t, ring, g)
      const h = this.env(t, peak * 0.35 * v, 0.001, ring * 0.45)
      this.osc('sine', sa * 2.01, t, ring, h)
      this.osc('sine', sa * 2.98, t, ring * 0.5, this.env(t, peak * 0.18 * v, 0.001, ring * 0.3))
      this.noise(t, 0.02, this.filter('highpass', 3000, 0.5, this.env(t, 0.12 * v, 0.0005, 0.015)))
    }
    const bayan = (peak: number) => {
      const g = this.env(t, peak * v, 0.004, 0.45)
      const o = this.osc('sine', 78, t, 0.5, g)
      o.frequency.linearRampToValueAtTime(118, t + 0.18)
    }
    if (bol === 'dha') { bayan(0.55); dayan(0.28, 0.32) }
    else if (bol === 'dhin') { bayan(0.5); dayan(0.6, 0.28) }
    else if (bol === 'tin') dayan(0.6, 0.28)
    else if (bol === 'na' || bol === 'ta') dayan(0.22, 0.33)
    else if (bol === 'ge') bayan(0.55)
    else if (bol === 'ke') this.noise(t, 0.05, this.filter('lowpass', 700, 0.7, this.env(t, 0.35 * v, 0.001, 0.04)))
  }
  /** dhol: dagga (bass head) and tilli (stick on the treble head) */
  dhol(t: number, head: 'dagga' | 'tilli', v = 1) {
    if (head === 'dagga') {
      const g = this.env(t, 0.85 * v, 0.002, 0.35, 0.12)
      const o = this.osc('sine', 120, t, 0.4, g)
      o.frequency.exponentialRampToValueAtTime(62, t + 0.15)
      this.noise(t, 0.06, this.filter('lowpass', 900, 0.7, this.env(t, 0.3 * v, 0.001, 0.05)))
    } else {
      this.noise(t, 0.06, this.filter('bandpass', 2800, 2.5, this.env(t, 0.42 * v, 0.0008, 0.05, 0.2)))
      this.osc('sine', 520, t, 0.08, this.env(t, 0.18 * v, 0.001, 0.06))
    }
  }

  /* ---------------- tonal voices ---------------- */
  /** Karplus–Strong string, pre-rendered and cached per pitch; `jawari` adds the sitar buzz */
  private pluckBuf(freq: number, kind: 'sitar' | 'tumbi' | 'tanpura') {
    const key = kind + Math.round(freq * 4)
    let b = this.plucks.get(key)
    if (b) return b
    const sr = this.ctx.sampleRate
    const dur = kind === 'tanpura' ? 3.2 : kind === 'sitar' ? 2.2 : 0.9
    const n = Math.floor(sr * dur)
    const N = Math.max(2, Math.round(sr / freq))
    b = this.ctx.createBuffer(1, n, sr)
    const d = b.getChannelData(0)
    const ring = new Float32Array(N)
    let lp = 0
    for (let i = 0; i < N; i++) {
      lp = lp * (kind === 'tanpura' ? 0.6 : 0.2) + (Math.random() * 2 - 1)
      ring[i] = lp
    }
    const decay = kind === 'tanpura' ? 0.9993 : kind === 'sitar' ? 0.998 : 0.994
    const jawari = kind === 'tumbi' ? 0.15 : 0.45
    let idx = 0
    let peak = 1e-6
    for (let i = 0; i < n; i++) {
      const a = ring[idx]
      const nb = ring[(idx + 1) % N]
      ring[idx] = (a + nb) * 0.5 * decay
      idx = (idx + 1) % N
      const s = a * (1 - jawari) + Math.tanh(a * 5) * jawari * 0.35
      d[i] = s
      peak = Math.max(peak, Math.abs(s))
    }
    for (let i = 0; i < n; i++) d[i] /= peak
    this.plucks.set(key, b)
    return b
  }
  pluck(t: number, midi: number, v: number, kind: 'sitar' | 'tumbi' | 'tanpura', glideTo?: number, glideAt = 0.25) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.pluckBuf(mtof(midi), kind)
    if (glideTo !== undefined) {
      // meend: bend the string into the next note
      src.playbackRate.setValueAtTime(1, t + glideAt)
      src.playbackRate.linearRampToValueAtTime(Math.pow(2, (glideTo - midi) / 12), t + glideAt + 0.22)
    }
    const len = src.buffer.duration
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(v, t)
    g.gain.setValueAtTime(v, t + len - 0.1)
    g.gain.linearRampToValueAtTime(0, t + len)
    g.connect(this.out)
    const s = this.ctx.createGain()
    s.gain.value = kind === 'tumbi' ? 0.15 : 0.35
    g.connect(s).connect(this.send)
    src.connect(g)
    src.start(t)
  }
  /** reedy lead (synth shehnai) or breathy bansuri */
  lead(t: number, midi: number, dur: number, v: number, kind: 'shehnai' | 'bansuri', from?: number) {
    const f = mtof(midi)
    const g = this.ctx.createGain()
    const a = kind === 'bansuri' ? 0.06 : 0.025
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(v, t + a)
    g.gain.setValueAtTime(v * 0.85, t + Math.max(a, dur - 0.06))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + (kind === 'bansuri' ? 0.25 : 0.12))
    g.connect(this.out)
    const s = this.ctx.createGain()
    s.gain.value = 0.4
    g.connect(s).connect(this.send)
    const vib = this.ctx.createOscillator()
    vib.frequency.value = kind === 'bansuri' ? 4.6 : 5.6
    const vg = this.ctx.createGain()
    vg.gain.setValueAtTime(0, t)
    vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, dur))
    vib.connect(vg)
    vib.start(t)
    vib.stop(t + dur + 0.3)
    const voices: OscillatorNode[] = []
    if (kind === 'shehnai') {
      const bp = this.filter('bandpass', 1400, 0.9, g)
      const lp = this.filter('lowpass', 3200, 0.5, bp)
      for (const det of [-6, 6]) {
        const o = this.osc('sawtooth', f, t, dur + 0.15, lp)
        o.detune.value = det
        voices.push(o)
      }
    } else {
      voices.push(this.osc('sine', f, t, dur + 0.3, g))
      const tri = this.ctx.createGain()
      tri.gain.value = 0.25
      tri.connect(g)
      voices.push(this.osc('triangle', f * 2, t, dur + 0.3, tri))
      // breath
      this.noise(t, dur, this.filter('bandpass', f * 2, 3, this.env(t, v * 0.25, 0.05, dur)))
    }
    for (const o of voices) {
      vg.connect(o.frequency)
      if (from !== undefined) {
        o.frequency.setValueAtTime(mtof(from), t)
        o.frequency.exponentialRampToValueAtTime(f, t + 0.09)
      }
    }
  }
  bass(t: number, midi: number, dur: number, v = 1) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.5 * v, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    g.connect(this.out)
    const lp = this.filter('lowpass', 420, 1.2, g)
    this.osc('triangle', mtof(midi), t, dur, lp)
    this.osc('sine', mtof(midi - 12), t, dur, lp)
  }
  pad(t: number, midis: number[], dur: number, v = 1) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.07 * v, t + 0.4)
    g.gain.setValueAtTime(0.07 * v, t + dur - 0.3)
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2)
    g.connect(this.out)
    const s = this.ctx.createGain()
    s.gain.value = 0.6
    g.connect(s).connect(this.send)
    const lp = this.filter('lowpass', 1100, 0.4, g)
    for (const m of midis) for (const det of [-9, 9]) {
      const o = this.osc('sawtooth', mtof(m), t, dur + 0.3, lp)
      o.detune.value = det
    }
  }
  /** electric piano: sine + decaying bell partial */
  keys(t: number, midis: number[], dur: number, v = 1) {
    for (const m of midis) {
      const f = mtof(m)
      this.osc('sine', f, t, dur + 0.4, this.env(t, 0.09 * v, 0.004, dur + 0.3, 0.35))
      this.osc('sine', f * 4.01, t, 0.4, this.env(t, 0.02 * v, 0.002, 0.25))
      this.osc('triangle', f * 2, t, 0.8, this.env(t, 0.025 * v, 0.003, 0.6))
    }
  }
  crackle(t: number, len: number) {
    const n = 2 + Math.floor(Math.random() * 4)
    for (let k = 0; k < n; k++) {
      const tt = t + Math.random() * len
      this.noise(tt, 0.004, this.filter('highpass', 2500, 0.5, this.env(tt, 0.04 + Math.random() * 0.05, 0.0002, 0.003)))
    }
  }
}

/* ---------------- composition helpers ---------------- */
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MIXO = [0, 2, 4, 5, 7, 9, 10]
const YAMAN = [0, 2, 4, 6, 7, 9, 11]
const PENTA = [0, 2, 4, 7, 9]
/** scale degree (may be negative / beyond an octave) → midi */
const deg = (root: number, scale: number[], d: number) => root + Math.floor(d / scale.length) * 12 + scale[((d % scale.length) + scale.length) % scale.length]
const chord = (root: number, scale: number[], d: number, sev = false) => [d, d + 2, d + 4, ...(sev ? [d + 6] : [])].map((x) => deg(root, scale, x))

interface Note {
  step: number
  d: number
  len: number
}
/** a phrase: rhythm from a density mask, pitch by random walk that lands on chord tones on strong beats */
function phrase(r: Rng, steps: number, density: number, lo: number, hi: number, chordAt: (step: number) => number, grid = 1): Note[] {
  const out: Note[] = []
  let d = Math.round((lo + hi) / 2)
  for (let s = 0; s < steps; s += grid) {
    const strong = s % 4 === 0
    if (r() > density * (strong ? 1.4 : s % 2 === 0 ? 0.9 : 0.5)) continue
    const c = chordAt(s)
    if (strong && r() < 0.6) {
      // nearest chord tone
      const tones = [c, c + 2, c + 4, c - 3, c + 7, c - 7]
      d = tones.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b), tones[0])
    } else d += Math.floor(r() * 5) - 2
    d = Math.max(lo, Math.min(hi, d))
    out.push({ step: s, d, len: grid })
  }
  for (let i = 0; i < out.length; i++) out[i].len = (i + 1 < out.length ? out[i + 1].step : steps) - out[i].step
  return out
}

interface Station {
  name: string
  tag: string
  bpm: number
  swing: number
  /** schedule everything that falls on 16th-step `i` (absolute counter) */
  step(i: number, t: number, sd: number, k: Kit): void
}

function masala(seed: number): Station {
  const r = mulberry32(seed)
  const root = 62 // D
  const progs = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 4]]
  let prog = progs[0]
  let A: Note[] = [], B: Note[] = []
  const gen = () => {
    prog = progs[Math.floor(r() * progs.length)]
    A = phrase(r, 32, 0.55, 5, 12, (s) => prog[Math.floor(s / 16) % 4])
    B = phrase(r, 32, 0.5, 4, 13, (s) => prog[2 + (Math.floor(s / 16) % 2)])
  }
  return {
    name: 'Radio Masala 98.3', tag: 'Non-stop filmi hits', bpm: 102, swing: 0,
    step(i, t, sd, k) {
      const bar = Math.floor(i / 16), s = i % 16, sec = bar % 16
      if (i % 256 === 0) gen()
      const c = prog[bar % 4]
      const intro = sec < 2
      // drums
      if (!intro) {
        if (s % 4 === 0) k.kick(t, 0.9)
        if (s === 4 || s === 12) k.clap(t)
        if (s % 2 === 0) k.hat(t, s % 4 === 2 ? 1 : 0.5, s === 14 && bar % 2 === 1)
      }
      // dholak fills: na / ge chatter
      const dh = ['ge', '', 'na', 'na', 'ge', '', 'na', '', 'ge', 'ge', 'na', '', 'ge', '', 'na', 'na']
      if (dh[s] && r() < 0.85) k.tabla(t, dh[s], mtof(root + 12), 0.55)
      // bass
      if (!intro && (s === 0 || s === 3 || s === 8 || s === 11 || (s === 14 && r() < 0.5))) k.bass(t, deg(root - 24, MAJOR, c), sd * 2.6)
      // pad per bar
      if (s === 0) k.pad(t, chord(root - 12, MAJOR, c), sd * 16, intro ? 1.3 : 0.8)
      // lead: A A B A over 8 bars, rests in the intro
      if (!intro) {
        const which = Math.floor((sec % 8) / 2) === 2 ? B : A
        const local = i % 32
        for (const n of which) if (n.step === local) k.lead(t, deg(root, MAJOR, n.d), sd * Math.min(n.len, 6) * 0.95, 0.11, 'shehnai')
      }
    },
  }
}

function raag(seed: number): Station {
  const r = mulberry32(seed)
  const sa = 61 // C#
  const theka = ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha', 'dha', 'tin', 'tin', 'ta', 'ta', 'dhin', 'dhin', 'dha']
  let line: Note[] = []
  const gen = () => {
    // alaap-like: long notes that wander around Sa, Ga, Pa, Ni
    line = phrase(r, 64, 0.32, -2, 9, (s) => [0, 2, 4, -1][Math.floor(s / 16) % 4], 2)
  }
  return {
    name: 'Raag FM 101.1', tag: 'Raag Yaman · evening classical', bpm: 84, swing: 0,
    step(i, t, sd, k) {
      if (i % 128 === 0) gen()
      // tanpura cycle: Pa  Sa'  Sa'  Sa  (one pluck per beat)
      if (i % 4 === 0) {
        const cyc = [sa - 5, sa, sa, sa - 12][(i / 4) % 4]
        k.pluck(t, cyc - 12, 0.09, 'tanpura')
      }
      // tabla enters after the alaap, one bol per 8th note
      if (i >= 64 && i % 2 === 0) {
        const bol = theka[(i / 2) % 16]
        k.tabla(t, bol, mtof(sa + 12), (i / 2) % 16 === 0 ? 0.9 : 0.6)
      }
      const local = i % 64
      for (let j = 0; j < line.length; j++) {
        const n = line[j]
        if (n.step !== local) continue
        const nx = line[j + 1]
        const m = deg(sa, YAMAN, n.d)
        const glide = nx && Math.abs(nx.d - n.d) <= 2 && r() < 0.35 ? deg(sa, YAMAN, nx.d) : undefined
        k.pluck(t, m, 0.22, 'sitar', glide, sd * Math.max(1, n.len - 1.5))
        // chikari: drone strings after the main stroke
        if (r() < 0.3) k.pluck(t + sd, sa + 12, 0.05, 'tumbi')
      }
    },
  }
}

function bhangra(seed: number): Station {
  const r = mulberry32(seed)
  const root = 67 // G
  let riff: Note[] = []
  const gen = () => {
    riff = phrase(r, 16, 0.75, 4, 11, (s) => (s < 8 ? 0 : 4))
  }
  // chaal: the bouncing 6/8-feel bhangra groove laid over a 4/4 bar
  const dagga = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0]
  const tilli = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]
  return {
    name: 'Bhangra Junction 104.8', tag: 'Dhol on full volume', bpm: 98, swing: 0.08,
    step(i, t, sd, k) {
      const bar = Math.floor(i / 16), s = i % 16
      if (i % 128 === 0) gen()
      if (dagga[s]) k.dhol(t, 'dagga', s === 0 ? 1 : 0.8)
      if (tilli[s]) k.dhol(t, 'tilli', 0.8)
      if (s % 4 === 0 && bar % 8 !== 7) k.kick(t, 0.6)
      if (s === 4 || s === 12) k.clap(t, 0.7)
      if (s % 2 === 1) k.shaker(t)
      const c = bar % 4 === 3 ? 6 : 0 // I … bVII
      if (s === 0 || s === 6 || s === 10) k.bass(t, deg(root - 24, MIXO, c), sd * 3)
      // tumbi riff (higher on the answer bars)
      if (bar % 8 >= 2) {
        const up = bar % 4 >= 2 ? 7 : 0
        for (const n of riff) if (n.step === s) k.pluck(t, deg(root, MIXO, n.d + up), 0.2, 'tumbi')
      }
      // "Hoi!" shout stand-in: a short shehnai stab at the top of each 8 bars
      if (bar % 8 === 0 && s === 0 && i > 0) k.lead(t, deg(root, MIXO, 7), sd * 3, 0.1, 'shehnai', deg(root, MIXO, 4))
    },
  }
}

function lofi(seed: number): Station {
  const r = mulberry32(seed)
  const root = 65 // F
  const prog = [1, 4, 0, 5] // ii7 V7 Imaj7 vi7
  let mel: Note[] = []
  const gen = () => {
    mel = phrase(r, 64, 0.28, 0, 8, (s) => prog[Math.floor(s / 16) % 4] % 5, 2)
  }
  return {
    name: 'Lo-Fi Chai 91.9', tag: 'Beats to drive in traffic to', bpm: 76, swing: 0.18,
    step(i, t, sd, k) {
      const bar = Math.floor(i / 16), s = i % 16
      if (i % 128 === 0) gen()
      if (s === 0) k.crackle(t, sd * 16)
      if (s === 0 || s === 7 || (s === 10 && r() < 0.6)) k.kick(t, 0.7)
      if (s === 4 || s === 12) k.snare(t, 0.55)
      if (s % 2 === 0) k.hat(t, 0.35 + (s % 4 === 2 ? 0.2 : 0))
      const c = prog[bar % 4]
      if (s === 0) k.keys(t, chord(root - 12, MAJOR, c, true), sd * 7)
      if (s === 8 && r() < 0.5) k.keys(t, chord(root - 12, MAJOR, c, true).slice(1), sd * 6, 0.7)
      if (s === 0 || s === 10) k.bass(t, deg(root - 24, MAJOR, c), sd * 5, 0.8)
      if (bar % 8 >= 4) {
        const local = i % 64
        for (const n of mel) if (n.step === local) k.lead(t, deg(root, PENTA, n.d), sd * Math.min(n.len, 6), 0.08, 'bansuri')
      }
    },
  }
}

const FACTORIES = [masala, raag, bhangra, lofi]
export const STATION_COUNT = FACTORIES.length

/** Plays one station at a time into `dest`. Works with a live or an offline AudioContext. */
export class RadioPlayer {
  private bus: GainNode
  private kit: Kit
  private st: Station | null = null
  private i = 0
  private nextT = 0
  private stationGain: GainNode | null = null
  constructor(
    readonly ctx: BaseAudioContext,
    dest: AudioNode,
  ) {
    this.bus = ctx.createGain()
    this.bus.gain.value = 0.55
    // "car speakers": gentle low/high roll-off
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 55
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 9000
    this.bus.connect(hp).connect(lp).connect(dest)
    // shared reverb send
    const rev = ctx.createConvolver()
    const len = Math.floor(ctx.sampleRate * 1.6)
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let n = 0; n < len; n++) d[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / len, 3)
    }
    rev.buffer = ir
    const wet = ctx.createGain()
    wet.gain.value = 0.35
    rev.connect(wet).connect(this.bus)
    this.revIn = rev
    this.kit = new Kit(ctx, this.bus, rev)
  }
  private revIn: ConvolverNode

  get station() {
    return this.st
  }
  /** start station `idx` at time `t` */
  tune(idx: number, t = this.ctx.currentTime) {
    if (this.stationGain) {
      const old = this.stationGain
      old.gain.setTargetAtTime(0, t, 0.05)
      setTimeout(() => old.disconnect(), 600)
    }
    const g = this.ctx.createGain()
    g.gain.value = 1
    g.connect(this.bus)
    this.stationGain = g
    this.kit = new Kit(this.ctx, g, this.revIn)
    this.st = FACTORIES[idx](((Math.random() * 1e9) | 0) + idx)
    // join "mid-song" like a real radio
    this.i = 16 * Math.floor(Math.random() * 8) * 2
    this.nextT = t + 0.08
  }
  stop() {
    if (this.stationGain) {
      const old = this.stationGain
      old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08)
      setTimeout(() => old.disconnect(), 800)
    }
    this.stationGain = null
    this.st = null
  }
  setLevel(v: number, t = this.ctx.currentTime) {
    this.bus.gain.setTargetAtTime(v, t, 0.15)
  }
  /** schedule all steps up to `until` (absolute context time) */
  pump(until: number) {
    const st = this.st
    if (!st) return
    const sd = 60 / st.bpm / 4
    // fell behind (tab hidden / suspended): skip ahead instead of bursting notes
    if (this.nextT < this.ctx.currentTime - 0.05) this.nextT = this.ctx.currentTime + 0.05
    while (this.nextT < until) {
      const sw = this.i % 2 === 1 ? st.swing * sd : 0
      st.step(this.i, this.nextT + sw, sd, this.kit)
      this.i++
      this.nextT += sd
    }
  }
}

/** Live radio bound to the game's AudioContext. */
class CarRadio {
  private player: RadioPlayer | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  /** last station the player listened to (−1 = off) */
  idx = Math.floor(Math.random() * STATION_COUNT)
  on = false
  private ducked = false

  attach(ctx: AudioContext, dest: AudioNode) {
    if (!this.player) this.player = new RadioPlayer(ctx, dest)
  }
  private run() {
    if (this.timer) return
    this.timer = setInterval(() => {
      const p = this.player
      if (!p) return
      const ctx = p.ctx
      if (ctx.state !== 'running') return
      p.pump(ctx.currentTime + 0.3)
    }, 60)
  }
  private halt() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  /** turn on (getting into a vehicle) — returns the station name, or null if switched off */
  start(): string | null {
    if (!this.player) return null
    this.on = true
    if (this.idx < 0) return null
    this.player.tune(this.idx)
    this.run()
    return this.player.station?.name ?? null
  }
  stopAll() {
    this.on = false
    this.player?.stop()
    this.halt()
  }
  /** cycle stations: 0 → 1 → … → off → 0 */
  next(): string | null {
    if (!this.player || !this.on) return null
    this.idx = this.idx + 1 >= STATION_COUNT ? -1 : this.idx + 1
    if (this.idx < 0) {
      this.player.stop()
      this.halt()
      return null
    }
    this.player.tune(this.idx)
    this.run()
    return this.player.station?.name ?? null
  }
  get stationName() {
    return this.player?.station?.name ?? null
  }
  get stationTag() {
    return this.player?.station?.tag ?? ''
  }
  /** quieter during dialogue / menus */
  duck(on: boolean) {
    if (on === this.ducked || !this.player) return
    this.ducked = on
    this.player.setLevel(on ? 0.12 : 0.55)
  }
}

export const radio = new CarRadio()
