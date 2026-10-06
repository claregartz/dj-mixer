import { useEffect, useReducer, useRef, useState } from 'react'
import { Mixer } from './audio/engine'
import { DEMOS, renderDemo } from './audio/demoTracks'
import { DeckPanel } from './components/DeckPanel'
import { Knob } from './components/Knob'
import './App.css'

interface Channel {
  high: number
  mid: number
  low: number
  filter: number
  volume: number
  pitch: number
}

const DEFAULT_CHANNEL: Channel = { high: 0, mid: 0, low: 0, filter: 0, volume: 0.9, pitch: 0 }
const EQ_MIN = -24
const DECK_COLORS = ['var(--deck-a)', 'var(--deck-b)']
const DECK_LABELS = ['A', 'B']

// Module-level so React StrictMode's double render doesn't create two AudioContexts.
let mixerInstance: Mixer | null = null
function getMixer() {
  mixerInstance ??= new Mixer()
  return mixerInstance
}

export default function App() {
  const mixer = getMixer()
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [channels, setChannels] = useState<[Channel, Channel]>([DEFAULT_CHANNEL, DEFAULT_CHANNEL])
  const [crossfader, setCrossfader] = useState(0)
  const [master, setMaster] = useState(0.9)
  const [trackIds, setTrackIds] = useState([0, 0])
  const [status, setStatus] = useState<[string | null, string | null]>([null, null])
  const [autoBars, setAutoBars] = useState(8)
  const [autoProgress, setAutoProgress] = useState<number | null>(null)
  const autoCancel = useRef<(() => void) | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordStart, setRecordStart] = useState(0)
  const [mixUrl, setMixUrl] = useState<string | null>(null)

  const updateChannel = (i: number, patch: Partial<Channel>) =>
    setChannels((prev) => {
      const next = [...prev] as [Channel, Channel]
      next[i] = { ...next[i], ...patch }
      return next
    })

  // Push UI state into the audio graph.
  useEffect(() => {
    channels.forEach((c, i) => {
      const deck = mixer.decks[i]
      deck.setEq('high', c.high)
      deck.setEq('mid', c.mid)
      deck.setEq('low', c.low)
      deck.setFilter(c.filter)
      deck.setVolume(c.volume)
      if (Math.abs(deck.playbackRate - (1 + c.pitch / 100)) > 1e-6) deck.setPlaybackRate(1 + c.pitch / 100)
    })
  }, [channels, mixer])
  useEffect(() => mixer.setCrossfader(crossfader), [crossfader, mixer])
  useEffect(() => mixer.setMasterVolume(master), [master, mixer])

  // Audio can only start after a user gesture.
  useEffect(() => {
    const resume = () => mixer.resume()
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
    return () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
    }
  }, [mixer])

  const setDeckStatus = (i: number, s: string | null) =>
    setStatus((prev) => {
      const next = [...prev] as [string | null, string | null]
      next[i] = s
      return next
    })

  const trackLoaded = (i: number) => {
    setTrackIds((ids) => ids.map((id, j) => (j === i ? id + 1 : id)))
    updateChannel(i, { pitch: 0 })
  }

  const loadFile = async (i: number, file: File) => {
    setDeckStatus(i, 'Analyzing…')
    try {
      await mixer.decks[i].load(file, file.name.replace(/\.[^.]+$/, ''))
      setDeckStatus(i, null)
      trackLoaded(i)
    } catch {
      setDeckStatus(i, "Couldn't read that file")
      setTimeout(() => setDeckStatus(i, null), 3000)
    }
  }

  const loadDemos = async () => {
    mixer.resume()
    await Promise.all(
      DEMOS.map(async (spec, i) => {
        setDeckStatus(i, 'Generating demo…')
        const buffer = await renderDemo(spec)
        mixer.decks[i].loadBuffer(buffer, spec.title, spec.bpm)
        setDeckStatus(i, null)
        trackLoaded(i)
      }),
    )
  }

  const sync = (i: number) => {
    const deck = mixer.decks[i]
    deck.syncTo(mixer.decks[1 - i])
    updateChannel(i, { pitch: (deck.playbackRate - 1) * 100 })
    rerender()
  }

  const moveCrossfader = (x: number) => {
    autoCancel.current?.()
    setCrossfader(x)
  }

  /**
   * A classic DJ blend: sync the incoming track, start it with its bass cut,
   * ride the crossfader over N bars, and swap basslines halfway through so
   * the two kick drums never clash.
   */
  const autoMix = () => {
    autoCancel.current?.()
    const from = crossfader < 0.5 ? 0 : 1
    const to = 1 - from
    const outDeck = mixer.decks[from]
    const inDeck = mixer.decks[to]
    if (!inDeck.buffer) return

    if (inDeck.bpm && outDeck.effectiveBpm && outDeck.isPlaying) inDeck.syncTo(outDeck)
    const inPitch = (inDeck.playbackRate - 1) * 100
    const inLow = channels[to].low
    const outLow = channels[from].low
    updateChannel(to, { low: EQ_MIN, pitch: inPitch })
    inDeck.play()

    const bpm = outDeck.effectiveBpm ?? inDeck.effectiveBpm ?? 120
    const duration = ((autoBars * 4 * 60) / bpm) * 1000
    const startX = crossfader
    const endX = to
    const t0 = performance.now()
    let swapped = false
    let frame = 0

    const finish = (completed: boolean) => {
      cancelAnimationFrame(frame)
      autoCancel.current = null
      setAutoProgress(null)
      if (completed) {
        outDeck.pause()
        updateChannel(from, { low: outLow })
      }
      rerender()
    }
    autoCancel.current = () => finish(false)

    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / duration)
      setCrossfader(startX + (endX - startX) * p)
      setAutoProgress(p)
      if (!swapped && p >= 0.5) {
        swapped = true
        updateChannel(to, { low: inLow })
        updateChannel(from, { low: EQ_MIN })
      }
      if (p >= 1) finish(true)
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    rerender()
  }

  const toggleRecording = async () => {
    mixer.resume()
    if (recording) {
      const blob = await mixer.stopRecording()
      setRecording(false)
      if (mixUrl) URL.revokeObjectURL(mixUrl)
      setMixUrl(URL.createObjectURL(blob))
    } else {
      mixer.startRecording()
      setRecording(true)
      setRecordStart(performance.now())
      if (mixUrl) URL.revokeObjectURL(mixUrl)
      setMixUrl(null)
    }
  }

  const anyLoaded = mixer.decks.some((d) => d.buffer)
  const autoTarget = crossfader < 0.5 ? 'B' : 'A'

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo-dot" aria-hidden /> Two Deck Mixer
        </h1>
        <div className="topbar-actions">
          {!anyLoaded && <span className="hint">New here? Load the demos and press Auto Mix</span>}
          <button className="btn ghost" onClick={loadDemos}>
            Load demo tracks
          </button>
        </div>
      </header>

      <main className="console">
        {mixer.decks.map((deck, i) => (
          <DeckPanel
            key={i}
            deck={deck}
            label={DECK_LABELS[i]}
            color={DECK_COLORS[i]}
            trackId={trackIds[i]}
            status={status[i]}
            pitch={channels[i].pitch}
            onPitch={(pitch) => updateChannel(i, { pitch })}
            onFile={(f) => loadFile(i, f)}
            onSync={() => sync(i)}
            onChange={rerender}
          />
        ))}

        <section className="mixer" aria-label="Mixer">
          <div className="strips">
            {channels.map((c, i) => (
              <ChannelStrip
                key={i}
                label={DECK_LABELS[i]}
                color={DECK_COLORS[i]}
                channel={c}
                onChange={(patch) => updateChannel(i, patch)}
              />
            ))}
          </div>

          <div className="crossfader">
            <span>A</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={crossfader}
              onChange={(e) => moveCrossfader(Number(e.target.value))}
              onDoubleClick={() => moveCrossfader(0.5)}
              aria-label="Crossfader"
            />
            <span>B</span>
          </div>

          <div className="mixer-actions">
            <div className="automix">
              <button className="btn accent" onClick={autoMix} disabled={!mixer.decks[crossfader < 0.5 ? 1 : 0].buffer}>
                {autoProgress !== null ? `Mixing… ${Math.round(autoProgress * 100)}%` : `Auto Mix → ${autoTarget}`}
              </button>
              <select value={autoBars} onChange={(e) => setAutoBars(Number(e.target.value))} aria-label="Transition length">
                {[4, 8, 16, 32].map((b) => (
                  <option key={b} value={b}>
                    {b} bars
                  </option>
                ))}
              </select>
            </div>

            <div className="record">
              <button className={`btn rec${recording ? ' on' : ''}`} onClick={toggleRecording}>
                <span className="rec-dot" aria-hidden /> {recording ? <RecordTimer since={recordStart} /> : 'Record mix'}
              </button>
              {mixUrl && (
                <a className="btn ghost" href={mixUrl} download="my-mix.webm">
                  Download
                </a>
              )}
            </div>

            <Knob label="Master" value={master} min={0} max={1} defaultValue={0.9} onChange={setMaster} format={(v) => `MASTER ${Math.round(v * 100)}`} />
          </div>
        </section>
      </main>

      <footer className="footer">
        Your songs are decoded in your browser and never uploaded. Double-click any control to reset it.
      </footer>
    </div>
  )
}

interface ChannelStripProps {
  label: string
  color: string
  channel: Channel
  onChange: (patch: Partial<Channel>) => void
}

function ChannelStrip({ label, color, channel, onChange }: ChannelStripProps) {
  const db = (name: string) => (v: number) => (v <= EQ_MIN ? `${name} KILL` : `${name} ${v > 0 ? '+' : ''}${v.toFixed(0)}`)
  return (
    <div className="strip" style={{ '--deck-color': color } as React.CSSProperties}>
      <span className="strip-label">{label}</span>
      <Knob label="High" value={channel.high} min={EQ_MIN} max={6} defaultValue={0} centered color={color} onChange={(high) => onChange({ high })} format={db('HI')} />
      <Knob label="Mid" value={channel.mid} min={EQ_MIN} max={6} defaultValue={0} centered color={color} onChange={(mid) => onChange({ mid })} format={db('MID')} />
      <Knob label="Low" value={channel.low} min={EQ_MIN} max={6} defaultValue={0} centered color={color} onChange={(low) => onChange({ low })} format={db('LOW')} />
      <Knob
        label="Filter"
        value={channel.filter}
        min={-1}
        max={1}
        defaultValue={0}
        color={color}
        onChange={(filter) => onChange({ filter: Math.abs(filter) < 0.04 ? 0 : filter })}
        format={(v) => (v === 0 ? 'FILTER' : v < 0 ? 'LOW-PASS' : 'HIGH-PASS')}
      />
      <input
        className="fader"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={channel.volume}
        onChange={(e) => onChange({ volume: Number(e.target.value) })}
        aria-label={`Deck ${label} volume`}
      />
    </div>
  )
}

function RecordTimer({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [])
  const s = Math.floor((now - since) / 1000)
  return (
    <>
      REC {Math.floor(s / 60)}:{(s % 60).toString().padStart(2, '0')}
    </>
  )
}
