import { useRef, useState } from 'react'
import type { Deck } from '../audio/Deck'
import { useTick } from '../useTick'
import { Waveform } from './Waveform'

export const PITCH_RANGE = 16 // ± percent

interface DeckPanelProps {
  deck: Deck
  label: string
  color: string
  trackId: number
  status: string | null
  pitch: number
  onPitch: (pct: number) => void
  onFile: (file: File) => void
  onSync: () => void
  /** Called after any transport action so the parent re-renders. */
  onChange: () => void
}

const LOOP_SIZES = [1, 2, 4, 8]

export function DeckPanel({ deck, label, color, trackId, status, pitch, onPitch, onFile, onSync, onChange }: DeckPanelProps) {
  useTick(10)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const loaded = deck.buffer !== null
  const loopBeats = deck.loop && deck.bpm ? Math.round(((deck.loop.end - deck.loop.start) * deck.bpm) / 60) : null

  const act = (fn: () => void) => () => {
    fn()
    onChange()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <section
      className={`deck${dragOver ? ' drag-over' : ''}`}
      style={{ '--deck-color': color } as React.CSSProperties}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="deck-header">
        <span className="deck-label">{label}</span>
        <div className="deck-title">
          <strong title={deck.title}>{status ?? (deck.title || 'No track loaded')}</strong>
          <span className="deck-meta">
            {loaded ? `${fmtTime(deck.position)} / -${fmtTime(deck.duration - deck.position)}` : 'Drop an audio file here'}
          </span>
        </div>
        <div className="deck-bpm">
          <span className="bpm-value">{deck.effectiveBpm ? deck.effectiveBpm.toFixed(1) : '--.-'}</span>
          <span className="bpm-unit">BPM</span>
        </div>
      </header>

      {loaded ? (
        <Waveform deck={deck} trackId={trackId} color={color} onSeek={(t) => act(() => deck.seek(t))()} />
      ) : (
        <button className="drop-zone" onClick={() => fileInput.current?.click()}>
          <span>
            Drag a song here or <u>browse</u>
          </span>
          <small>MP3, WAV, FLAC, M4A, OGG. Files stay on your computer.</small>
        </button>
      )}

      <div className="deck-controls">
        <div className="transport">
          <button className="btn play" disabled={!loaded} onClick={act(() => deck.togglePlay())} aria-label={deck.isPlaying ? 'Pause' : 'Play'}>
            {deck.isPlaying ? '❚❚' : '▶'}
          </button>
          <button className="btn" disabled={!loaded} onClick={act(() => deck.jumpToCue())} title="Jump to cue point">
            CUE
          </button>
          <button className="btn" disabled={!loaded} onClick={act(() => deck.setCue())} title="Set cue point at playhead">
            SET
          </button>
          <button className="btn sync" disabled={!deck.bpm} onClick={onSync} title="Match the other deck's tempo and beat">
            SYNC
          </button>
          <button className="btn ghost" onClick={() => fileInput.current?.click()} title="Load a song">
            LOAD
          </button>
        </div>

        <div className="loops" role="group" aria-label="Beat loop">
          <span className="loops-label">LOOP</span>
          {LOOP_SIZES.map((n) => (
            <button
              key={n}
              className={`btn small${loopBeats === n ? ' active' : ''}`}
              disabled={!deck.bpm}
              onClick={act(() => (loopBeats === n ? deck.clearLoop() : deck.setBeatLoop(n)))}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="pitch">
          <span>TEMPO {pitch >= 0 ? '+' : ''}{pitch.toFixed(1)}%</span>
          <input
            type="range"
            min={-PITCH_RANGE}
            max={PITCH_RANGE}
            step={0.1}
            value={pitch}
            disabled={!loaded}
            onChange={(e) => onPitch(Number(e.target.value))}
            onDoubleClick={() => onPitch(0)}
          />
        </label>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </section>
  )
}

function fmtTime(s: number) {
  const t = Math.max(0, s)
  const m = Math.floor(t / 60)
  const sec = Math.floor(t % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
