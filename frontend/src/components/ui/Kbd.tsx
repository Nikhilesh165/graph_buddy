import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

/** Keyboard-shortcut chip. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-background-alt px-1 font-sans text-[11px] font-medium leading-none text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}
