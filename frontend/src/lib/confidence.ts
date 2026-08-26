// Shared by GraphCanvas, Chat, and RetrievalInspector -- kept out of
// GraphCanvas.tsx itself so that file exports only the component (oxlint's
// react/only-export-components: mixing component + constant exports in one
// file defeats Fast Refresh).

export const CONFIDENCE_STEP = 0.05

export function formatConfidence(value: number | null): string {
  return value === null ? 'unscored' : value.toFixed(2)
}
