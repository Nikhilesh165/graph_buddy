import { cn } from '../../lib/cn'

type Props = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  /** Visually hide the label (it's still the accessible name). */
  hideLabel?: boolean
  className?: string
}

/** Obsidian-style toggle: a label on the left, a pill switch on the right,
 * the whole row clickable. */
export function Switch({ checked, onCheckedChange, label, hideLabel, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group flex w-full items-center justify-between gap-3 rounded-sm py-1 text-left text-[13px] text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-out-expo',
            checked && 'translate-x-3.5',
          )}
        />
      </span>
    </button>
  )
}
