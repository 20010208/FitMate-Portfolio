import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSameFormContext,
  isStalePhotoOperation,
  isBlankPhotoReference,
  type MealFormContext,
} from './mealPhotoFormContext.ts'

const ctx = (category: string | null, editingItemId: string | null): MealFormContext => ({
  category,
  editingItemId,
})

// --- isSameFormContext -------------------------------------------------

test('isSameFormContext: same category and editingItemId is same', () => {
  assert.equal(isSameFormContext(ctx('Breakfast', null), ctx('Breakfast', null)), true)
  assert.equal(isSameFormContext(ctx('Breakfast', 'item-1'), ctx('Breakfast', 'item-1')), true)
})

test('isSameFormContext: different category is not same', () => {
  assert.equal(isSameFormContext(ctx('Breakfast', null), ctx('Lunch', null)), false)
})

test('isSameFormContext: different editingItemId is not same', () => {
  assert.equal(isSameFormContext(ctx('Breakfast', 'item-1'), ctx('Breakfast', 'item-2')), false)
  assert.equal(isSameFormContext(ctx('Breakfast', 'item-1'), ctx('Breakfast', null)), false)
})

// --- isStalePhotoOperation ----------------------------------------------

test('isStalePhotoOperation: identical generation and context is current (not stale)', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
  })
  assert.equal(result, false)
})

test('isStalePhotoOperation: identical generation, context, and operation id is current', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', 'item-1'),
    currentContext: ctx('Breakfast', 'item-1'),
    capturedOperationId: 3,
    currentOperationId: 3,
  })
  assert.equal(result, false)
})

test('isStalePhotoOperation: generation mismatch is stale', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 6,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
  })
  assert.equal(result, true)
})

test('isStalePhotoOperation: category change (e.g. switching tabs) is stale', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Lunch', null),
  })
  assert.equal(result, true)
})

test('isStalePhotoOperation: editingItemId change (switching edit target) is stale', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', 'item-1'),
    currentContext: ctx('Breakfast', 'item-2'),
  })
  assert.equal(result, true)
})

test('isStalePhotoOperation: operation id mismatch is stale even if generation/context match', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
    capturedOperationId: 1,
    currentOperationId: 2,
  })
  assert.equal(result, true)
})

test('isStalePhotoOperation: a newer upload op is not clobbered by an older op finishing (op id check)', () => {
  // op1 started first (id=1), op2 started later (id=2, now current).
  // op1 finishing must see itself as stale so it cannot reset loading for op2.
  const op1Stale = isStalePhotoOperation({
    capturedGeneration: 1,
    currentGeneration: 1,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
    capturedOperationId: 1,
    currentOperationId: 2,
  })
  assert.equal(op1Stale, true)
  // op2 finishing sees itself as current and may safely clear loading.
  const op2Stale = isStalePhotoOperation({
    capturedGeneration: 1,
    currentGeneration: 1,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
    capturedOperationId: 2,
    currentOperationId: 2,
  })
  assert.equal(op2Stale, false)
})

test('isStalePhotoOperation: operation id omitted on both sides skips that check', () => {
  const result = isStalePhotoOperation({
    capturedGeneration: 5,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Breakfast', null),
  })
  assert.equal(result, false)
})

test('isStalePhotoOperation: AI result from category A cannot apply after switching to category B', () => {
  // Captured while analyzing under Breakfast; user has since switched to Lunch.
  const result = isStalePhotoOperation({
    capturedGeneration: 2,
    currentGeneration: 3,
    capturedContext: ctx('Breakfast', null),
    currentContext: ctx('Lunch', null),
  })
  assert.equal(result, true)
})

test('isStalePhotoOperation: retry started before closing the form cannot resolve after close', () => {
  // Form open while editing item-1; user closes the form (editingItemId -> null, generation bumps).
  const result = isStalePhotoOperation({
    capturedGeneration: 4,
    currentGeneration: 5,
    capturedContext: ctx('Breakfast', 'item-1'),
    currentContext: ctx('Breakfast', null),
  })
  assert.equal(result, true)
})

// --- isBlankPhotoReference ------------------------------------------------

test('isBlankPhotoReference: null is blank (no photo)', () => {
  assert.equal(isBlankPhotoReference(null), true)
})

test('isBlankPhotoReference: undefined is blank (no photo)', () => {
  assert.equal(isBlankPhotoReference(undefined), true)
})

test('isBlankPhotoReference: empty string is blank (no photo)', () => {
  assert.equal(isBlankPhotoReference(''), true)
})

test('isBlankPhotoReference: whitespace-only string is blank (no photo)', () => {
  assert.equal(isBlankPhotoReference('   '), true)
  assert.equal(isBlankPhotoReference('\t\n'), true)
})

test('isBlankPhotoReference: a real object path is not blank', () => {
  assert.equal(isBlankPhotoReference('user-1/20260723/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg'), false)
})

test('isBlankPhotoReference: a real legacy URL is not blank', () => {
  assert.equal(isBlankPhotoReference('https://example.supabase.co/storage/v1/object/public/meal-photos/x.jpg'), false)
})
