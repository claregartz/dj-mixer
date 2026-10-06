import { useEffect, useState } from 'react'

/** Re-render the calling component `fps` times a second (for clocks and meters). */
export function useTick(fps: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000 / fps)
    return () => clearInterval(id)
  }, [fps])
}
