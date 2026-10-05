import { cn } from '../../lib/cn'

/** Shimmering placeholder block for content that is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-sm', className)} />
}
