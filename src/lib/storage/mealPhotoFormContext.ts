// Pure, framework-free helpers for detecting stale async photo operations in
// MealClient.tsx. No React, no Supabase — safe to unit test directly.

export type MealFormContext = {
  /** Active meal category, or null if none selected. */
  category: string | null
  /** MealItem id currently being edited, or null for a new-item form. */
  editingItemId: string | null
}

export function isSameFormContext(a: MealFormContext, b: MealFormContext): boolean {
  return a.category === b.category && a.editingItemId === b.editingItemId
}

export type StalenessCheck = {
  capturedGeneration: number
  currentGeneration: number
  capturedContext: MealFormContext
  currentContext: MealFormContext
  /** Only compared when both captured and current operation ids are provided. */
  capturedOperationId?: number
  currentOperationId?: number
}

/**
 * True if an in-flight async operation (photo upload, signed URL fetch,
 * retry, delete) should discard its result: the photo generation moved on,
 * the active category/editing item changed, or (when tracked) a newer
 * operation of the same kind has since started.
 */
export function isStalePhotoOperation(check: StalenessCheck): boolean {
  if (check.capturedGeneration !== check.currentGeneration) return true
  if (!isSameFormContext(check.capturedContext, check.currentContext)) return true
  if (check.capturedOperationId !== undefined && check.currentOperationId !== undefined) {
    if (check.capturedOperationId !== check.currentOperationId) return true
  }
  return false
}

/**
 * True for null/undefined/empty/whitespace-only values — i.e. "definitely no
 * photo", which must resolve immediately regardless of whether a user id is
 * available yet. Only a non-blank value is a candidate for normalization
 * (and therefore for the "waiting for user id" pending state).
 */
export function isBlankPhotoReference(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true
  return value.trim().length === 0
}
