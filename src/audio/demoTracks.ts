/**
 * Procedurally generated house loops so the app has copyright-free demo
 * material. Rendered offline into an AudioBuffer, so they behave exactly like
 * a loaded file. Exact BPM is known, so beat detection is skipped.
 */

export interface DemoSpec {
  title: string
  bpm: number
  /** Bass note pattern as semitone offsets from `root`, one per offbeat 8th. */
  bassline: number[]
  /** Root frequency (Hz) of the bass. */
  root: number
  /** Chord stab, semitone offsets above root * 4. */
  chord: number[]
}

export const DEMOS: DemoSpec[] = [
  { title: 'Demo — Neon Pulse', bpm: 124, root: 55, bassline: [0, 0, 3, 0, 5, 0, 3, 7], chord: [0, 3, 7, 10] },
  { title: 'Demo — Night Drive', bpm: 128, root: 49, bassline: [0, 7, 0, 5, 0, 3, 0, 10], chord: [0, 4, 7, 11] },
]

const BARS = 48
const SAMPLE_RATE = 44100

export async function renderDemo(spec: DemoSpec): Promise<AudioBuffer> {
  const beat = 60 / spec.bpm
  const length = Math.ceil((BARS * 4 * beat + 1) * SAMPLE_RATE)
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  const out = ctx.createGain()
  out.gain.value = 0.8
  out.connect(ctx.destination)
  const noise = makeNoise(ctx)

  for (let bar = 0; bar < BARS; bar++) {
    // Song structure: intro (drums) -> bass -> breakdown (no kick) -> full drop.
    const intro = bar < 8
    const breakdown = bar >= 24 && bar < 32
    for (let b = 0; b < 4; b++) {
      const t = (bar * 4 + b) * beat
      if (!breakdown) kick(ctx, out, t)
      hat(ctx, out, noise, t + beat / 2, breakdown ? 0.08 : 0.15)
      if (!intro && (b === 1 || b === 3)) clap(ctx, out, noise, t)
      if (!intro) {
        const note = spec.bassline[(bar % 2) * 4 + b]
        bass(ctx, out, spec.root * semis(note), t + beat / 2, beat / 2)
      }
    }
    if (bar >= 16) {
      const stab = bar % 2 === 0 ? 0 : 1.5
      chord(ctx, out, spec.chord.map((n) => spec.root * 4 * semis(n)), bar * 4 * beat + stab * beat, breakdown ? beat * 4 : beat * 0.4)
    }
  }
  return ctx.startRendering()
}

function semis(n: number) {
  return Math.pow(2, n / 12)
}

function makeNoise(ctx: BaseAudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function env(ctx: BaseAudioContext, dest: AudioNode, t: number, peak: number, decay: number) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  g.connect(dest)
  return g
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  osc.connect(env(ctx, dest, t, 1, 0.4))
  osc.start(t)
  osc.stop(t + 0.45)
}

function hat(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, t: number, level: number) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 8000
  src.connect(hp).connect(env(ctx, dest, t, level, 0.06))
  src.start(t, Math.random() * 0.5, 0.1)
}

function clap(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, t: number) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1500
  bp.Q.value = 1.2
  src.connect(bp).connect(env(ctx, dest, t, 0.5, 0.18))
  src.start(t, Math.random() * 0.5, 0.25)
}

function bass(ctx: BaseAudioContext, dest: AudioNode, freq: number, t: number, len: number) {
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = freq
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(900, t)
  lp.frequency.exponentialRampToValueAtTime(150, t + len)
  lp.Q.value = 6
  osc.connect(lp).connect(env(ctx, dest, t, 0.35, len))
  osc.start(t)
  osc.stop(t + len + 0.05)
}

function chord(ctx: BaseAudioContext, dest: AudioNode, freqs: number[], t: number, len: number) {
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2500
  lp.connect(env(ctx, dest, t, 0.12, len))
  for (const f of freqs) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = f
    osc.detune.value = (Math.random() - 0.5) * 14
    osc.connect(lp)
    osc.start(t)
    osc.stop(t + len + 0.05)
  }
}
