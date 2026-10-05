import { useId, type CSSProperties } from 'react'
import { cn } from '../../lib/cn'

type Props = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /** Formats the readout next to the label; omit to hide the readout. */
  format?: (value: number) => string
  className?: string
}

/** Labeled range slider, as used throughout Obsidian's graph settings.
 * Track fill comes from index.css's global range styling via `--fill`. */
export function Slider({ label, value, min, max, step, onChange, format, className }: Props) {
  const id = useId()
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('flex flex-col gap-1 py-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] text-muted-foreground">
          {label}
        </label>
        {format && <span className="font-mono text-[11px] tabular-nums text-faint-foreground">{format(value)}</span>}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        className="w-full"
      />
    </div>
  )
}
