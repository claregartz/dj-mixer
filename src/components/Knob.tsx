import { useRef } from 'react'

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  /** Double-click resets to this value. */
  defaultValue: number
  onChange: (v: number) => void
  color?: string
  format?: (v: number) => string
  /** Put `defaultValue` at 12 o'clock even when it isn't mid-range (e.g. EQ 0 dB). */
  centered?: boolean
}

const SWEEP = 270 // degrees of rotation from min to max

/** Rotary knob: drag up/down to turn, double-click to reset. */
export function Knob({ label, value, min, max, defaultValue, onChange, color = 'var(--accent)', format, centered }: KnobProps) {
  const drag = useRef<{ y: number; norm: number } | null>(null)

  // Map value <-> 0..1 knob position, piecewise around the default when centered.
  const toNorm = (v: number) => {
    if (!centered) return (v - min) / (max - min)
    return v <= defaultValue ? ((v - min) / (defaultValue - min)) * 0.5 : 0.5 + ((v - defaultValue) / (max - defaultValue)) * 0.5
  }
  const fromNorm = (n: number) => {
    const c = clamp(n, 0, 1)
    if (!centered) return min + c * (max - min)
    return c <= 0.5 ? min + (c / 0.5) * (defaultValue - min) : defaultValue + ((c - 0.5) / 0.5) * (max - defaultValue)
  }
  const angle = -SWEEP / 2 + toNorm(value) * SWEEP

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, norm: toNorm(value) }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    onChange(fromNorm(drag.current.norm + (drag.current.y - e.clientY) / 150))
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(fromNorm(toNorm(value) + 0.025))
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(fromNorm(toNorm(value) - 0.025))
  }

  // Arc from the knob's zero point (default) to its current value.
  const r = 20
  const arcFrom = -SWEEP / 2 + toNorm(defaultValue) * SWEEP
  const [a0, a1] = arcFrom < angle ? [arcFrom, angle] : [angle, arcFrom]

  return (
    <div className="knob">
      <svg
        width="52"
        height="52"
        viewBox="-26 -26 52 52"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={onKeyDown}
      >
        <path d={arc(r, -SWEEP / 2, SWEEP / 2)} className="knob-track" />
        {a1 - a0 > 0.5 && <path d={arc(r, a0, a1)} stroke={color} className="knob-value" />}
        <circle r="14" className="knob-body" />
        <line x1="0" y1="-5" x2="0" y2="-13" className="knob-pointer" transform={`rotate(${angle})`} />
      </svg>
      <span className="knob-label">{format ? format(value) : label}</span>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function arc(r: number, fromDeg: number, toDeg: number) {
  const p = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`
  }
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${p(fromDeg)} A ${r} ${r} 0 ${large} 1 ${p(toDeg)}`
}
