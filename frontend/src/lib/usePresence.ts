import { useEffect, useState } from 'react'

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** Keeps an overlay mounted for `exitMs` after `open` goes false so it can
 * play an exit animation instead of vanishing mid-frame. `closing` is true
 * during that window -- switch the element to its exit animation class. */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  // Adjusting state during render (not in an effect) is React's recommended
  // way to sync state to a prop change -- no extra commit with a stale frame.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : exitMs)
    return () => window.clearTimeout(timer)
  }, [open, mounted, exitMs])

  return { mounted: open || mounted, closing: !open && mounted }
}
