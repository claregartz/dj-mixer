import { Deck } from './Deck'

/**
 * Owns the shared AudioContext and the mixer: two decks feed a crossfader,
 * which feeds the master bus. The master bus goes to the speakers and to a
 * MediaStream so the mix can be recorded.
 */
export class Mixer {
  readonly ctx: AudioContext
  readonly decks: [Deck, Deck]
  private readonly master: GainNode
  private readonly xfadeA: GainNode
  private readonly xfadeB: GainNode
  private readonly recordDest: MediaStreamAudioDestinationNode
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.xfadeA = this.ctx.createGain()
    this.xfadeB = this.ctx.createGain()
    this.recordDest = this.ctx.createMediaStreamDestination()

    this.decks = [new Deck(this.ctx), new Deck(this.ctx)]
    this.decks[0].output.connect(this.xfadeA)
    this.decks[1].output.connect(this.xfadeB)
    this.xfadeA.connect(this.master)
    this.xfadeB.connect(this.master)
    this.master.connect(this.ctx.destination)
    this.master.connect(this.recordDest)

    this.setCrossfader(0.5)
  }

  /** Browsers start audio suspended until a user gesture. */
  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** 0 = full deck A, 1 = full deck B. Equal-power curve keeps volume steady mid-fade. */
  setCrossfader(x: number) {
    const t = this.ctx.currentTime
    this.xfadeA.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), t, 0.01)
    this.xfadeB.gain.setTargetAtTime(Math.sin((x * Math.PI) / 2), t, 0.01)
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  get isRecording() {
    return this.recorder?.state === 'recording'
  }

  startRecording() {
    this.chunks = []
    this.recorder = new MediaRecorder(this.recordDest.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  /** Stops recording and resolves with the recorded mix. */
  stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.recorder
      if (!rec) return resolve(new Blob())
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType }))
      rec.stop()
    })
  }
}
