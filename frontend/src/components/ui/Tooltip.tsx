import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Side = 'top' | 'right' | 'bottom' | 'left'

const SIDE_CLASSES: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
}

type Props = {
  label: ReactNode
  side?: Side
  children: ReactNode
  className?: string
}

/** CSS-only hover/focus tooltip. Visual only (`aria-hidden`) -- the wrapped
 * control must carry its own `aria-label`. Appears after a short delay on
 * hover so sweeping the pointer across a toolbar doesn't strobe labels, and
 * immediately on keyboard focus. Don't use inside `overflow: hidden`
 * containers -- it would be clipped. */
export function Tooltip({ label, side = 'top', children, className }: Props) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-float',
          'opacity-0 transition-opacity duration-100',
          'group-hover/tooltip:opacity-100 group-hover/tooltip:delay-400 group-has-[:focus-visible]/tooltip:opacity-100',
          SIDE_CLASSES[side],
        )}
      >
        {label}
      </span>
    </span>
  )
}
