import { File, FileSpreadsheet, FileText, FileType, type LucideIcon } from 'lucide-react'

/** Icon for an uploaded source, by extension. */
export function fileIcon(filename: string): LucideIcon {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'csv') return FileSpreadsheet
  if (ext === 'pdf') return FileType
  if (ext === 'md' || ext === 'txt' || ext === 'docx') return FileText
  return File
}
