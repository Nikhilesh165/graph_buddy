// Shared by the graph view, Chat, and RetrievalInspector -- kept in its own
// module so component files export only components (oxlint's
// react/only-export-components: mixing component + constant exports in one
// file defeats Fast Refresh).

export const CONFIDENCE_STEP = 0.05

export function formatConfidence(value: number | null | undefined): string {
  return value === null || value === undefined ? 'unscored' : value.toFixed(2)
}
