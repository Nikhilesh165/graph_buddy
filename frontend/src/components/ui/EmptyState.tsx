import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

type Props = {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

/** Centered "nothing here yet" placeholder -- used when a page's
 * prerequisite step (upload a source, bootstrap an ontology) hasn't
 * happened yet, so the page explains what to do instead of rendering
 * empty. */
export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </Card>
  )
}
