import { useEffect, useRef } from 'react'
import type { Deck } from '../audio/Deck'

const PEAKS_PER_SECOND = 150
/** Seconds shown either side of the playhead in the zoomed view. */
const ZOOM_WINDOW = 4

const peakCache = new WeakMap<AudioBuffer, Float32Array>()

function getPeaks(buffer: AudioBuffer): Float32Array {
  const cached = peakCache.get(buffer)
  if (cached) return cached
  const count = Math.ceil(buffer.duration * PEAKS_PER_SECOND)
  const peaks = new Float32Array(count)
  const size = buffer.length / count
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * size)
    const end = Math.floor((i + 1) * size)
    let max = 0
    for (const data of channels) {
      for (let j = start; j < end; j += 4) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
    }
    peaks[i] = max
  }
  peakCache.set(buffer, peaks)
  return peaks
}

interface WaveformProps {
  deck: Deck
  /** Changes whenever a new track loads so the canvases redraw. */
  trackId: number
  color: string
  onSeek: (seconds: number) => void
}

/**
 * Two views: a zoomed, scrolling waveform with a beat grid (for lining up
 * beats by eye) and a full-track overview you can click to seek.
 */
export function Waveform({ deck, trackId, color, onSeek }: WaveformProps) {
  const zoomRef = useRef<HTMLCanvasElement>(null)
  const overviewRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let frame = 0
    const draw = () => {
      const zoom = zoomRef.current
      const overview = overviewRef.current
      if (zoom && overview) {
        // Canvas can't read CSS variables, so resolve `var(--x)` to a real color.
        const fill = color.startsWith('var(') ? css(color.slice(4, -1)) : color
        fitCanvas(zoom)
        fitCanvas(overview)
        drawZoom(zoom, deck, fill)
        drawOverview(overview, deck, fill)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [deck, trackId, color])

  const seekFromOverview = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!deck.buffer) return
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - rect.left) / rect.width) * deck.duration)
  }

  return (
    <div className="waveform">
      <canvas ref={zoomRef} className="wave-zoom" />
      <canvas ref={overviewRef} className="wave-overview" onPointerDown={seekFromOverview} />
    </div>
  )
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function drawZoom(canvas: HTMLCanvasElement, deck: Deck, color: string) {
  const g = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  g.clearRect(0, 0, w, h)
  if (!deck.buffer) return

  const peaks = getPeaks(deck.buffer)
  const pos = deck.position
  const pxPerSec = w / (ZOOM_WINDOW * 2)
  const t0 = pos - ZOOM_WINDOW

  // Loop region
  if (deck.loop) {
    g.fillStyle = css('--loop-fill')
    const x0 = (deck.loop.start - t0) * pxPerSec
    g.fillRect(x0, 0, (deck.loop.end - deck.loop.start) * pxPerSec, h)
  }

  // Beat grid, with every 4th beat (bar start) stronger.
  if (deck.bpm) {
    const beat = 60 / deck.bpm
    const first = Math.ceil((t0 - deck.beatOffset) / beat)
    const last = Math.floor((t0 + ZOOM_WINDOW * 2 - deck.beatOffset) / beat)
    const strong = css('--grid-strong')
    const weak = css('--grid')
    for (let i = first; i <= last; i++) {
      const x = (deck.beatOffset + i * beat - t0) * pxPerSec
      g.fillStyle = i % 4 === 0 ? strong : weak
      g.fillRect(Math.round(x), 0, i % 4 === 0 ? 2 : 1, h)
    }
  }

  g.fillStyle = color
  const mid = h / 2
  for (let x = 0; x < w; x += 2) {
    const t = t0 + x / pxPerSec
    if (t < 0 || t > deck.duration) continue
    const p = peaks[Math.floor(t * PEAKS_PER_SECOND)] ?? 0
    const bar = Math.max(1, p * mid * 0.95)
    g.fillRect(x, mid - bar, 1.5, bar * 2)
  }

  // Cue marker
  const cueX = (deck.cuePoint - t0) * pxPerSec
  if (cueX >= 0 && cueX <= w) {
    g.fillStyle = css('--cue')
    g.fillRect(cueX - 1, 0, 2, h)
  }

  // Playhead is fixed in the centre; the waveform scrolls past it.
  g.fillStyle = css('--playhead')
  g.fillRect(w / 2 - 1, 0, 2, h)
}

function drawOverview(canvas: HTMLCanvasElement, deck: Deck, color: string) {
  const g = canvas.getContext('2d')!
  const { width: w, height: h } = canvas
  g.clearRect(0, 0, w, h)
  if (!deck.buffer) return

  const peaks = getPeaks(deck.buffer)
  const perPx = peaks.length / w
  const played = (deck.position / deck.duration) * w
  const mid = h / 2
  for (let x = 0; x < w; x++) {
    let max = 0
    const start = Math.floor(x * perPx)
    const end = Math.max(start + 1, Math.floor((x + 1) * perPx))
    for (let i = start; i < end; i++) if (peaks[i] > max) max = peaks[i]
    g.fillStyle = x < played ? color : css('--wave-dim')
    const bar = Math.max(0.5, max * mid)
    g.fillRect(x, mid - bar, 1, bar * 2)
  }
  g.fillStyle = css('--cue')
  g.fillRect((deck.cuePoint / deck.duration) * w - 1, 0, 2, h)
  g.fillStyle = css('--playhead')
  g.fillRect(played - 1, 0, 2, h)
}
