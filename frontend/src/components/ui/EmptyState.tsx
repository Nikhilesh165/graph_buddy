import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

type Props = {
  icon: LucideIcon
  title: string
  description: ReactNode
  action?: ReactNode
  className?: string
}

/** Centered "nothing here yet" placeholder -- used when a page's
 * prerequisite step (upload a source, bootstrap an ontology) hasn't
 * happened yet, so the page explains what to do instead of rendering
 * empty. */
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <div className={cn('flex animate-rise-in flex-col items-center px-6 py-16 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background-alt text-faint-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground text-balance">{description}</p>
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  )
}
