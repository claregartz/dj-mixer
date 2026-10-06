import { guess } from 'web-audio-beat-detector'

export type EqBand = 'low' | 'mid' | 'high'

const EQ_KILL_DB = -40

/**
 * One turntable. Signal chain:
 *   source -> low shelf -> mid peak -> high shelf -> low-pass -> high-pass -> volume -> output
 *
 * AudioBufferSourceNodes are single-use, so play/seek create a fresh one and we
 * track the playhead ourselves from the context clock.
 */
export class Deck {
  readonly output: GainNode
  buffer: AudioBuffer | null = null
  title = ''
  /** Detected tempo at playback rate 1. */
  bpm: number | null = null
  /** Time of the first detected beat, in seconds. */
  beatOffset = 0
  cuePoint = 0
  loop: { start: number; end: number } | null = null

  private readonly ctx: AudioContext
  private readonly eq: Record<EqBand, BiquadFilterNode>
  private readonly lowpass: BiquadFilterNode
  private readonly highpass: BiquadFilterNode
  private source: AudioBufferSourceNode | null = null
  private rate = 1
  /** Track position at the moment `startedAt` was recorded. */
  private anchorPos = 0
  private startedAt = 0

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = 250
    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = 1000
    mid.Q.value = 0.8
    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = 4000
    this.eq = { low, mid, high }

    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.value = 20000
    this.highpass = ctx.createBiquadFilter()
    this.highpass.type = 'highpass'
    this.highpass.frequency.value = 10

    this.output = ctx.createGain()
    low.connect(mid).connect(high).connect(this.lowpass).connect(this.highpass).connect(this.output)
  }

  get isPlaying() {
    return this.source !== null
  }

  get duration() {
    return this.buffer?.duration ?? 0
  }

  get playbackRate() {
    return this.rate
  }

  /** Tempo the listener hears right now. */
  get effectiveBpm() {
    return this.bpm ? this.bpm * this.rate : null
  }

  get position(): number {
    if (!this.source) return this.anchorPos
    let pos = this.anchorPos + (this.ctx.currentTime - this.startedAt) * this.rate
    if (this.loop && pos > this.loop.end) {
      const len = this.loop.end - this.loop.start
      pos = this.loop.start + ((pos - this.loop.start) % len)
    }
    return Math.min(pos, this.duration)
  }

  async load(file: Blob, title: string) {
    const data = await file.arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.loadBuffer(buffer, title)
    try {
      const result = await guess(buffer)
      this.bpm = result.bpm
      this.beatOffset = result.offset
    } catch {
      // Ambient tracks or very short clips may have no detectable beat.
      this.bpm = null
      this.beatOffset = 0
    }
  }

  loadBuffer(buffer: AudioBuffer, title: string, bpm: number | null = null) {
    this.stop()
    this.buffer = buffer
    this.title = title
    this.bpm = bpm
    this.beatOffset = 0
    this.cuePoint = 0
    this.loop = null
    this.anchorPos = 0
  }

  play() {
    if (!this.buffer || this.source) return
    if (this.anchorPos >= this.duration) this.anchorPos = 0
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.playbackRate.value = this.rate
    if (this.loop) {
      src.loop = true
      src.loopStart = this.loop.start
      src.loopEnd = this.loop.end
    }
    src.connect(this.eq.low)
    src.onended = () => {
      // Only treat it as finished if this is still the active source (not a seek/stop).
      if (this.source === src) {
        this.source = null
        this.anchorPos = this.duration
      }
    }
    src.start(0, this.anchorPos)
    this.source = src
    this.startedAt = this.ctx.currentTime
  }

  pause() {
    if (!this.source) return
    this.anchorPos = this.position
    this.killSource()
  }

  stop() {
    this.killSource()
    this.anchorPos = 0
  }

  togglePlay() {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  seek(seconds: number) {
    const wasPlaying = this.isPlaying
    this.killSource()
    this.anchorPos = Math.max(0, Math.min(seconds, this.duration))
    if (wasPlaying) this.play()
  }

  setCue() {
    this.cuePoint = this.position
  }

  /** Jump back to the cue point and keep the current play state. */
  jumpToCue() {
    this.seek(this.cuePoint)
  }

  setPlaybackRate(rate: number) {
    // Re-anchor so the playhead math stays correct across the rate change.
    this.anchorPos = this.position
    this.startedAt = this.ctx.currentTime
    this.rate = rate
    this.source?.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.01)
  }

  /** Loop `beats` beats starting from the nearest beat at or before the playhead. */
  setBeatLoop(beats: number) {
    if (!this.bpm) return
    const beatLen = 60 / this.bpm
    const pos = this.position
    const start = this.beatOffset + Math.floor((pos - this.beatOffset) / beatLen) * beatLen
    this.loop = { start: Math.max(0, start), end: Math.min(this.duration, start + beats * beatLen) }
    this.applyLoopToSource(pos)
  }

  clearLoop() {
    const pos = this.position
    this.loop = null
    this.applyLoopToSource(pos)
  }

  /**
   * Match the other deck's tempo, then nudge our playhead so beats land together.
   * Phase is measured as fraction of a beat since the last downbeat.
   */
  syncTo(master: Deck) {
    if (!this.bpm || !master.effectiveBpm) return
    this.setPlaybackRate(master.effectiveBpm / this.bpm)
    if (!master.isPlaying || !master.bpm) return

    const masterBeat = 60 / master.bpm
    const masterPhase = mod((master.position - master.beatOffset) / masterBeat, 1)
    const beat = 60 / this.bpm
    const ourPhase = mod((this.position - this.beatOffset) / beat, 1)
    let diff = masterPhase - ourPhase
    if (diff > 0.5) diff -= 1
    if (diff < -0.5) diff += 1
    this.seek(this.position + diff * beat)
  }

  /** dB gain for an EQ band; the bottom of the range is a full "kill". */
  setEq(band: EqBand, db: number) {
    const value = db <= -24 ? EQ_KILL_DB : db
    this.eq[band].gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  /**
   * One knob, two filters: below 0 sweeps a low-pass down, above 0 sweeps a
   * high-pass up, and the middle is flat.
   */
  setFilter(amount: number) {
    const t = this.ctx.currentTime
    const lp = amount < 0 ? 20000 * Math.pow(0.005, -amount) : 20000
    const hp = amount > 0 ? 10 * Math.pow(800, amount) : 10
    this.lowpass.frequency.setTargetAtTime(lp, t, 0.02)
    this.highpass.frequency.setTargetAtTime(hp, t, 0.02)
    const q = Math.abs(amount) > 0.05 ? 4 : 0.7
    this.lowpass.Q.setTargetAtTime(q, t, 0.02)
    this.highpass.Q.setTargetAtTime(q, t, 0.02)
  }

  setVolume(v: number) {
    this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  private applyLoopToSource(pos: number) {
    if (!this.source) {
      this.anchorPos = pos
      return
    }
    // Restart the source so loop bounds take effect from the right spot.
    this.seek(pos)
  }

  private killSource() {
    const src = this.source
    if (!src) return
    this.source = null
    src.onended = null
    src.stop()
    src.disconnect()
  }
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m
}
