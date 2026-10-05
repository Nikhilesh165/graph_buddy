import { createElement } from 'react'
import type { LucideProps } from 'lucide-react'
import { fileIcon } from '../../lib/fileIcon'

/** The icon for a source file, by extension. */
export function FileIcon({ filename, ...props }: LucideProps & { filename: string }) {
  return createElement(fileIcon(filename), { strokeWidth: 1.75, ...props })
}
