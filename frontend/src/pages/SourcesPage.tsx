import { useCallback, useRef } from 'react'
import { Upload } from 'lucide-react'
import { DocumentPage } from '../components/layout/DocumentPage'
import { PageHeader } from '../components/layout/PageHeader'
import { SourcesPanel } from '../components/SourcesPanel'
import { Button } from '../components/ui/Button'

export function SourcesPage() {
  const openPicker = useRef<() => void>(() => {})
  const registerUploadTrigger = useCallback((open: () => void) => {
    openPicker.current = open
  }, [])

  return (
    <DocumentPage>
      <PageHeader
        title="Sources"
        description="Upload documents, then propose an ontology from them and extract their entities and facts into the graph."
        actions={
          <Button onClick={() => openPicker.current()}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        }
      />
      <SourcesPanel registerUploadTrigger={registerUploadTrigger} />
    </DocumentPage>
  )
}
