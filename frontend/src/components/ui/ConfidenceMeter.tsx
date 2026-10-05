import { formatConfidence } from '../../lib/confidence'
import { cn } from '../../lib/cn'

type Props = {
  value: number | null
  className?: string
  /** Hide the numeric readout (the meter still has an accessible label). */
  compact?: boolean
}

/** Tiny horizontal meter for a fact's confidence -- the same number the
 * graph encodes as link opacity, shown here as a readable bar + value.
 * Unscored facts render as an empty dashed track rather than a 0 bar, so
 * "nobody scored this" never reads as "scored as false". */
export function ConfidenceMeter({ value, className, compact }: Props) {
  const label = `Confidence ${formatConfidence(value)}`
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={label} aria-label={label} role="img">
      <span
        className={cn(
          'relative h-1 w-8 overflow-hidden rounded-full',
          value === null ? 'border border-dashed border-border-strong' : 'bg-border',
        )}
      >
        {value !== null && (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-accent-foreground"
            style={{ width: `${Math.max(4, Math.min(100, value * 100))}%`, opacity: 0.45 + value * 0.55 }}
          />
        )}
      </span>
      {!compact && (
        <span className="font-mono text-[11px] tabular-nums text-faint-foreground">{formatConfidence(value)}</span>
      )}
    </span>
  )
}
