import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-accent text-accent-foreground',
  secondary: 'bg-secondary text-muted-foreground',
  outline: 'border border-border-strong text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
}

type Props = HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }

/** Pill label -- Obsidian's tag shape (fully rounded, tinted fill). */
export function Badge({ className, variant = 'default', ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium leading-none',
        '[&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  )
}
