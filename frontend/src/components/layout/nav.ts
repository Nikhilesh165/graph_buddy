import { FolderOpen, LayoutDashboard, MessageSquare, Shapes, Waypoints, type LucideIcon } from 'lucide-react'

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; description: string }

/** Every top-level view, in ribbon order. The title bar, mobile drawer, and
 * command palette all read this list. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true, description: 'Your knowledge graph at a glance' },
  { to: '/sources', label: 'Sources', icon: FolderOpen, description: 'Upload documents and extract them' },
  { to: '/ontology', label: 'Ontology', icon: Shapes, description: 'Entity and relation types' },
  { to: '/graph', label: 'Graph view', icon: Waypoints, description: 'Explore entities and facts' },
  { to: '/chat', label: 'Chat', icon: MessageSquare, description: 'Ask questions over the graph' },
]

export function navItemFor(pathname: string): NavItem {
  return NAV_ITEMS.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ?? NAV_ITEMS[0]
}
