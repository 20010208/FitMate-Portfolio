import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MEAL_PHOTOS_BUCKET_ID,
  parseCliArgs,
  describeCliError,
  validateBucketSnapshot,
  describeSnapshotError,
  isSnapshotCompleteForApply,
  summarizeBucketSnapshot,
  isNoOpUpdate,
  buildUpdateBucketOptions,
  areAllowedMimeTypesEquivalent,
  compareBucketConfig,
  verifyBucketUpdate,
  describeOperationError,
} from './meal-photos-bucket-config.mjs'

// These tests exercise pure functions only. No Supabase client is created
// and no network call is made anywhere in this file.

const baseBucket = (overrides = {}) => ({
  id: MEAL_PHOTOS_BUCKET_ID,
  name: MEAL_PHOTOS_BUCKET_ID,
  owner: '',
  public: true,
  file_size_limit: 5242880,
  allowed_mime_types: ['image/jpeg', 'image/png'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const validSnapshot = (overrides = {}) => {
  const result = validateBucketSnapshot(baseBucket(overrides), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true, 'test setup expected a valid snapshot')
  return result
}

// --- CLI parsing: happy paths ---------------------------------------------

test('parseCliArgs: no arguments is inspect', () => {
  const result = parseCliArgs([])
  assert.deepEqual(result, { ok: true, options: { action: 'inspect' } })
})

test('parseCliArgs: --inspect is inspect', () => {
  const result = parseCliArgs(['--inspect'])
  assert.deepEqual(result, { ok: true, options: { action: 'inspect' } })
})

test('parseCliArgs: --target private without --apply is a dry-run', () => {
  const result = parseCliArgs(['--target', 'private'])
  assert.deepEqual(result, { ok: true, options: { action: 'dry-run', target: 'private' } })
})

test('parseCliArgs: --target public without --apply is a dry-run', () => {
  const result = parseCliArgs(['--target', 'public'])
  assert.deepEqual(result, { ok: true, options: { action: 'dry-run', target: 'public' } })
})

test('parseCliArgs: a full valid apply invocation succeeds', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm', 'meal-photos'])
  assert.deepEqual(result, { ok: true, options: { action: 'apply', target: 'private', confirm: 'meal-photos' } })
})

// --- CLI parsing: sanitization (no raw input reflected in codes/messages) --

test('parseCliArgs: unknown argument is rejected via a fixed code, not the raw value', () => {
  const result = parseCliArgs(['--force'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'UNKNOWN_ARGUMENT')
  assert.doesNotMatch(describeCliError(result.code), /--force/)
})

test('parseCliArgs: a secret-looking positional argument never reaches the error message', () => {
  const result = parseCliArgs(['sb_secret_should_never_appear_in_logs'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'UNKNOWN_ARGUMENT')
  assert.doesNotMatch(describeCliError(result.code), /sb_secret/)
})

test('parseCliArgs: invalid --target value is rejected via a fixed code', () => {
  const result = parseCliArgs(['--target', 'https://leaked-url.example.com'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_TARGET_VALUE')
  assert.doesNotMatch(describeCliError(result.code), /leaked-url/)
})

test('parseCliArgs: invalid --confirm value is rejected via a fixed code, not echoed', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm', 'wrong-bucket-name'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_CONFIRM_VALUE')
  assert.doesNotMatch(describeCliError(result.code), /wrong-bucket-name/)
})

test('describeCliError: every mapped code returns a non-empty fixed string', () => {
  const codes = [
    'UNKNOWN_ARGUMENT', 'INVALID_TARGET_VALUE', 'CONFLICTING_TARGET', 'DUPLICATE_TARGET',
    'DUPLICATE_APPLY', 'DUPLICATE_INSPECT', 'DUPLICATE_CONFIRM', 'MISSING_CONFIRM_VALUE',
    'INSPECT_CONFLICT', 'STRAY_CONFIRM', 'APPLY_REQUIRES_TARGET', 'APPLY_REQUIRES_CONFIRM',
    'INVALID_CONFIRM_VALUE',
  ]
  for (const code of codes) {
    assert.equal(typeof describeCliError(code), 'string')
    assert.ok(describeCliError(code).length > 0)
  }
})

// --- CLI parsing: structural validation -------------------------------------

// --confirm is only meaningful as part of a full apply request. Any stray
// --confirm (without --apply) must be rejected explicitly rather than
// silently downgraded to inspect/dry-run — this was Codex's remaining
// finding after the earlier rounds of fixes.

test('parseCliArgs: --confirm alone (no target, no apply) is rejected as a stray confirm', () => {
  const result = parseCliArgs(['--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STRAY_CONFIRM')
})

test('parseCliArgs: --target private --confirm (no --apply) is rejected as a stray confirm', () => {
  const result = parseCliArgs(['--target', 'private', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STRAY_CONFIRM')
})

test('parseCliArgs: --target public --confirm (no --apply) is rejected as a stray confirm', () => {
  const result = parseCliArgs(['--target', 'public', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STRAY_CONFIRM')
})

test('parseCliArgs: an invalid stray confirm value is still rejected via STRAY_CONFIRM (checked before value correctness)', () => {
  const result = parseCliArgs(['--target', 'private', '--confirm', 'not-meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STRAY_CONFIRM')
})

test('parseCliArgs: a secret-looking stray confirm value never reaches the error message', () => {
  const result = parseCliArgs(['--confirm', 'sb_secret_should_never_appear_in_logs'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'STRAY_CONFIRM')
  assert.doesNotMatch(describeCliError(result.code), /sb_secret/)
})

test('parseCliArgs: --inspect combined with --confirm is rejected (via INSPECT_CONFLICT, checked before STRAY_CONFIRM)', () => {
  const result = parseCliArgs(['--inspect', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INSPECT_CONFLICT')
})

test('parseCliArgs: --target private alone (no --confirm) is still a plain dry-run, unaffected by the stray-confirm rule', () => {
  const result = parseCliArgs(['--target', 'private'])
  assert.deepEqual(result, { ok: true, options: { action: 'dry-run', target: 'private' } })
})

test('parseCliArgs: --target public alone (no --confirm) is still a plain dry-run, unaffected by the stray-confirm rule', () => {
  const result = parseCliArgs(['--target', 'public'])
  assert.deepEqual(result, { ok: true, options: { action: 'dry-run', target: 'public' } })
})

test('parseCliArgs: a full valid Private apply (--target private --apply --confirm meal-photos) is still accepted', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm', 'meal-photos'])
  assert.deepEqual(result, { ok: true, options: { action: 'apply', target: 'private', confirm: 'meal-photos' } })
})

test('parseCliArgs: a full valid Public rollback apply (--target public --apply --confirm meal-photos) is still accepted', () => {
  const result = parseCliArgs(['--target', 'public', '--apply', '--confirm', 'meal-photos'])
  assert.deepEqual(result, { ok: true, options: { action: 'apply', target: 'public', confirm: 'meal-photos' } })
})

test('parseCliArgs: --inspect combined with --target is rejected', () => {
  const result = parseCliArgs(['--inspect', '--target', 'private'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INSPECT_CONFLICT')
})

test('parseCliArgs: --inspect combined with --apply is rejected', () => {
  const result = parseCliArgs(['--inspect', '--apply'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INSPECT_CONFLICT')
})

test('parseCliArgs: --apply without --target is rejected', () => {
  const result = parseCliArgs(['--apply', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'APPLY_REQUIRES_TARGET')
})

test('parseCliArgs: --apply with --target but no --confirm is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--apply'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'APPLY_REQUIRES_CONFIRM')
})

test('parseCliArgs: --target with no value is rejected', () => {
  const result = parseCliArgs(['--target'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_TARGET_VALUE')
})

test('parseCliArgs: --confirm with no value is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'MISSING_CONFIRM_VALUE')
})

test('parseCliArgs: "--target --apply" does not consume --apply as the target value', () => {
  const result = parseCliArgs(['--target', '--apply'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_TARGET_VALUE')
})

test('parseCliArgs: "--confirm --apply" does not consume --apply as the confirm value', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm', '--apply'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'MISSING_CONFIRM_VALUE')
})

test('parseCliArgs: duplicate --target (same value) is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--target', 'private'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'DUPLICATE_TARGET')
})

test('parseCliArgs: duplicate --target (conflicting values) is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--target', 'public'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONFLICTING_TARGET')
})

test('parseCliArgs: duplicate --confirm is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--confirm', 'meal-photos', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'DUPLICATE_CONFIRM')
})

test('parseCliArgs: duplicate --apply is rejected', () => {
  const result = parseCliArgs(['--target', 'private', '--apply', '--apply', '--confirm', 'meal-photos'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'DUPLICATE_APPLY')
})

test('parseCliArgs: duplicate --inspect is rejected', () => {
  const result = parseCliArgs(['--inspect', '--inspect'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'DUPLICATE_INSPECT')
})

test('parseCliArgs: a positional argument alongside known flags is rejected', () => {
  const result = parseCliArgs(['--inspect', 'extra-positional'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'UNKNOWN_ARGUMENT')
})

test('parseCliArgs: target value other than private/public is rejected', () => {
  const result = parseCliArgs(['--target', 'both'])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'INVALID_TARGET_VALUE')
})

// --- bucket snapshot validation ---------------------------------------------

test('validateBucketSnapshot: a well-formed bucket is valid', () => {
  const result = validateBucketSnapshot(baseBucket(), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true)
  assert.equal(result.fileSizeLimitState, 'value')
  assert.equal(result.allowedMimeTypesState, 'value')
})

test('validateBucketSnapshot: explicit null file_size_limit is a valid, meaningful state', () => {
  const result = validateBucketSnapshot(baseBucket({ file_size_limit: null }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true)
  assert.equal(result.fileSizeLimitState, 'null')
})

test('validateBucketSnapshot: explicit null allowed_mime_types is a valid, meaningful state', () => {
  const result = validateBucketSnapshot(baseBucket({ allowed_mime_types: null }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true)
  assert.equal(result.allowedMimeTypesState, 'null')
})

test('validateBucketSnapshot: missing (undefined) file_size_limit is a distinct "missing" state, still structurally valid', () => {
  const bucket = baseBucket()
  delete bucket.file_size_limit
  const result = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true)
  assert.equal(result.fileSizeLimitState, 'missing')
})

test('validateBucketSnapshot: missing (undefined) allowed_mime_types is a distinct "missing" state', () => {
  const bucket = baseBucket()
  delete bucket.allowed_mime_types
  const result = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, true)
  assert.equal(result.allowedMimeTypesState, 'missing')
})

test('validateBucketSnapshot: non-numeric file_size_limit is invalid (rejected, not coerced)', () => {
  const result = validateBucketSnapshot(baseBucket({ file_size_limit: '5242880' }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'FILE_SIZE_LIMIT_INVALID')
})

test('validateBucketSnapshot: non-array allowed_mime_types is invalid', () => {
  const result = validateBucketSnapshot(baseBucket({ allowed_mime_types: 'image/jpeg' }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'ALLOWED_MIME_TYPES_INVALID')
})

test('validateBucketSnapshot: allowed_mime_types containing a number is rejected', () => {
  const result = validateBucketSnapshot(baseBucket({ allowed_mime_types: ['image/jpeg', 1] }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'ALLOWED_MIME_TYPES_INVALID')
})

test('validateBucketSnapshot: allowed_mime_types containing an object is rejected', () => {
  const result = validateBucketSnapshot(baseBucket({ allowed_mime_types: ['image/jpeg', { type: 'image/png' }] }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'ALLOWED_MIME_TYPES_INVALID')
})

test('validateBucketSnapshot: non-boolean public is rejected', () => {
  const result = validateBucketSnapshot(baseBucket({ public: 'true' }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'PUBLIC_INVALID')
})

test('validateBucketSnapshot: bucket id mismatch is rejected', () => {
  const result = validateBucketSnapshot(baseBucket({ id: 'other-bucket' }), MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'ID_MISMATCH')
})

test('validateBucketSnapshot: null bucket is rejected', () => {
  const result = validateBucketSnapshot(null, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'NOT_AN_OBJECT')
})

test('validateBucketSnapshot: does not mutate the input bucket object', () => {
  const bucket = baseBucket()
  const before = JSON.parse(JSON.stringify(bucket))
  validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.deepEqual(bucket, before)
})

test('describeSnapshotError: every mapped reason returns a non-empty fixed string', () => {
  const reasons = ['NOT_AN_OBJECT', 'ID_MISMATCH', 'NAME_MISMATCH', 'PUBLIC_INVALID', 'FILE_SIZE_LIMIT_INVALID', 'ALLOWED_MIME_TYPES_INVALID']
  for (const reason of reasons) {
    assert.equal(typeof describeSnapshotError(reason), 'string')
    assert.ok(describeSnapshotError(reason).length > 0)
  }
})

// --- isSnapshotCompleteForApply --------------------------------------------

test('isSnapshotCompleteForApply: value/value snapshot is apply-ready', () => {
  assert.equal(isSnapshotCompleteForApply(validSnapshot()), true)
})

test('isSnapshotCompleteForApply: null/null snapshot is apply-ready (explicit "no limit" is a known state)', () => {
  assert.equal(isSnapshotCompleteForApply(validSnapshot({ file_size_limit: null, allowed_mime_types: null })), true)
})

test('isSnapshotCompleteForApply: missing file_size_limit is NOT apply-ready', () => {
  const bucket = baseBucket()
  delete bucket.file_size_limit
  const snapshot = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(isSnapshotCompleteForApply(snapshot), false)
})

test('isSnapshotCompleteForApply: missing allowed_mime_types is NOT apply-ready', () => {
  const bucket = baseBucket()
  delete bucket.allowed_mime_types
  const snapshot = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(isSnapshotCompleteForApply(snapshot), false)
})

test('isSnapshotCompleteForApply: missing field blocks apply-readiness even when public already equals the target (would-be no-op)', () => {
  const bucket = baseBucket({ public: false })
  delete bucket.file_size_limit
  const snapshot = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  assert.equal(isSnapshotCompleteForApply(snapshot), false)
  // even though this WOULD be a no-op on public alone:
  assert.equal(isNoOpUpdate(bucket, false), true)
})

// --- summarizeBucketSnapshot (sanitized logging) ----------------------------

test('summarizeBucketSnapshot: exposes only public/status categories, not real values', () => {
  const summary = summarizeBucketSnapshot(validSnapshot())
  assert.deepEqual(summary, {
    valid: true,
    public: true,
    fileSizeLimitStatus: 'value',
    allowedMimeTypesStatus: 'value',
    applyReady: true,
  })
})

test('summarizeBucketSnapshot: reports applyReady=false when a field is missing', () => {
  const bucket = baseBucket()
  delete bucket.allowed_mime_types
  const snapshot = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  const summary = summarizeBucketSnapshot(snapshot)
  assert.equal(summary.allowedMimeTypesStatus, 'missing')
  assert.equal(summary.applyReady, false)
})

// --- buildUpdateBucketOptions ------------------------------------------------

test('buildUpdateBucketOptions: true -> false changes only public', () => {
  const options = buildUpdateBucketOptions(baseBucket({ public: true }), false)
  assert.equal(options.public, false)
})

test('buildUpdateBucketOptions: false -> true changes only public', () => {
  const options = buildUpdateBucketOptions(baseBucket({ public: false }), true)
  assert.equal(options.public, true)
})

test('buildUpdateBucketOptions: preserves current file size limit verbatim', () => {
  const options = buildUpdateBucketOptions(baseBucket({ file_size_limit: 1234 }), false)
  assert.equal(options.fileSizeLimit, 1234)
})

test('buildUpdateBucketOptions: preserves current allowed MIME types verbatim', () => {
  const options = buildUpdateBucketOptions(baseBucket({ allowed_mime_types: ['image/jpeg'] }), false)
  assert.deepEqual(options.allowedMimeTypes, ['image/jpeg'])
})

test('buildUpdateBucketOptions: explicit null file size limit is kept as null, not converted', () => {
  const options = buildUpdateBucketOptions(baseBucket({ file_size_limit: null }), false)
  assert.equal(options.fileSizeLimit, null)
})

test('buildUpdateBucketOptions: explicit null allowed MIME types is kept as null, not converted', () => {
  const options = buildUpdateBucketOptions(baseBucket({ allowed_mime_types: null }), false)
  assert.equal(options.allowedMimeTypes, null)
})

test('buildUpdateBucketOptions: throws (does not silently convert to null) when file_size_limit is undefined', () => {
  const bucket = baseBucket()
  delete bucket.file_size_limit
  assert.throws(() => buildUpdateBucketOptions(bucket, false))
})

test('buildUpdateBucketOptions: throws when allowed_mime_types is undefined', () => {
  const bucket = baseBucket()
  delete bucket.allowed_mime_types
  assert.throws(() => buildUpdateBucketOptions(bucket, false))
})

test('buildUpdateBucketOptions: does not mutate the input bucket object', () => {
  const bucket = baseBucket({ allowed_mime_types: ['image/jpeg'] })
  const before = JSON.parse(JSON.stringify(bucket))
  buildUpdateBucketOptions(bucket, false)
  assert.deepEqual(bucket, before)
})

test('buildUpdateBucketOptions: does not mutate the input allowed_mime_types array', () => {
  const mimeTypes = ['image/jpeg', 'image/png']
  const bucket = baseBucket({ allowed_mime_types: mimeTypes })
  const options = buildUpdateBucketOptions(bucket, false)
  options.allowedMimeTypes.push('image/gif')
  assert.deepEqual(mimeTypes, ['image/jpeg', 'image/png'])
})

test('buildUpdateBucketOptions: returns exactly public/fileSizeLimit/allowedMimeTypes, no unknown metadata', () => {
  const options = buildUpdateBucketOptions(baseBucket(), false)
  assert.deepEqual(Object.keys(options).sort(), ['allowedMimeTypes', 'fileSizeLimit', 'public'])
})

// --- MIME comparison: order-independent multiset -----------------------------

test('areAllowedMimeTypesEquivalent: identical order is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg', 'image/png'], ['image/jpeg', 'image/png']), true)
})

test('areAllowedMimeTypesEquivalent: reversed order is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg', 'image/png'], ['image/png', 'image/jpeg']), true)
})

test('areAllowedMimeTypesEquivalent: 3+ element reordering is equivalent', () => {
  const a = ['image/jpeg', 'image/png', 'image/webp']
  const b = ['image/webp', 'image/jpeg', 'image/png']
  assert.equal(areAllowedMimeTypesEquivalent(a, b), true)
})

test('areAllowedMimeTypesEquivalent: same duplicate counts is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg', 'image/jpeg', 'image/png'], ['image/png', 'image/jpeg', 'image/jpeg']), true)
})

test('areAllowedMimeTypesEquivalent: different duplicate counts is NOT equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg', 'image/jpeg'], ['image/jpeg']), false)
})

test('areAllowedMimeTypesEquivalent: missing element is NOT equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg', 'image/png'], ['image/jpeg']), false)
})

test('areAllowedMimeTypesEquivalent: added element is NOT equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg'], ['image/jpeg', 'image/png']), false)
})

test('areAllowedMimeTypesEquivalent: null and null is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(null, null), true)
})

test('areAllowedMimeTypesEquivalent: null and empty array is NOT equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(null, []), false)
})

test('areAllowedMimeTypesEquivalent: empty array and empty array is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent([], []), true)
})

test('areAllowedMimeTypesEquivalent: undefined and null are distinct (not equivalent)', () => {
  assert.equal(areAllowedMimeTypesEquivalent(undefined, null), false)
})

test('areAllowedMimeTypesEquivalent: undefined and undefined is equivalent', () => {
  assert.equal(areAllowedMimeTypesEquivalent(undefined, undefined), true)
})

test('areAllowedMimeTypesEquivalent: case differences are NOT equivalent (no normalization)', () => {
  assert.equal(areAllowedMimeTypesEquivalent(['image/jpeg'], ['IMAGE/JPEG']), false)
})

test('areAllowedMimeTypesEquivalent: does not mutate either input array', () => {
  const a = ['image/png', 'image/jpeg']
  const b = ['image/jpeg', 'image/png']
  const aBefore = [...a]
  const bBefore = [...b]
  areAllowedMimeTypesEquivalent(a, b)
  assert.deepEqual(a, aBefore)
  assert.deepEqual(b, bBefore)
})

// --- compareBucketConfig / verifyBucketUpdate --------------------------------

test('verifyBucketUpdate: a public-only change is a successful verification', () => {
  const before = baseBucket({ public: true })
  const after = baseBucket({ public: false })
  const result = verifyBucketUpdate({ before, after, expectedPublic: false })
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
})

test('verifyBucketUpdate: MIME reordering alone still verifies successfully', () => {
  const before = baseBucket({ public: true, allowed_mime_types: ['image/jpeg', 'image/png'] })
  const after = baseBucket({ public: false, allowed_mime_types: ['image/png', 'image/jpeg'] })
  const result = verifyBucketUpdate({ before, after, expectedPublic: false })
  assert.equal(result.ok, true)
})

test('verifyBucketUpdate: detects an unexpected file_size_limit change', () => {
  const before = baseBucket({ public: true, file_size_limit: 1000 })
  const after = baseBucket({ public: false, file_size_limit: 2000 })
  const result = verifyBucketUpdate({ before, after, expectedPublic: false })
  assert.equal(result.ok, false)
  assert.ok(result.problems.includes('file_size_limit'))
})

test('verifyBucketUpdate: detects an unexpected allowed_mime_types content change', () => {
  const before = baseBucket({ public: true, allowed_mime_types: ['image/jpeg'] })
  const after = baseBucket({ public: false, allowed_mime_types: ['image/jpeg', 'image/png'] })
  const result = verifyBucketUpdate({ before, after, expectedPublic: false })
  assert.equal(result.ok, false)
  assert.ok(result.problems.includes('allowed_mime_types'))
})

test('verifyBucketUpdate: detects the field disappearing (becoming undefined) after update', () => {
  const before = baseBucket({ public: true, file_size_limit: 1000 })
  const after = baseBucket({ public: false })
  delete after.file_size_limit
  const result = verifyBucketUpdate({ before, after, expectedPublic: false })
  assert.equal(result.ok, false)
  assert.ok(result.problems.includes('file_size_limit'))
})

test('verifyBucketUpdate: detects id/name mismatch', () => {
  const before = baseBucket()
  const after = baseBucket({ id: 'not-meal-photos', name: 'not-meal-photos' })
  const result = verifyBucketUpdate({ before, after, expectedPublic: before.public })
  assert.equal(result.ok, false)
  assert.ok(result.problems.includes('id'))
  assert.ok(result.problems.includes('name'))
})

test('compareBucketConfig: differing timestamps alone are ignored', () => {
  const before = baseBucket({ created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' })
  const after = baseBucket({ created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-07-24T00:00:00.000Z' })
  assert.deepEqual(compareBucketConfig(before, after), [])
})

test('verifyBucketUpdate: current state already matching target is consistent with a no-op', () => {
  const bucket = baseBucket({ public: false })
  assert.equal(isNoOpUpdate(bucket, false), true)
  const result = verifyBucketUpdate({ before: bucket, after: bucket, expectedPublic: false })
  assert.equal(result.ok, true)
})

// --- operation-level error messages -----------------------------------------

test('describeOperationError: every mapped code returns a non-empty fixed string', () => {
  const codes = [
    'ENV_MISSING', 'ENV_URL_INVALID', 'CLIENT_INIT_FAILED', 'BUCKET_FETCH_FAILED',
    'BUCKET_NOT_APPLY_READY', 'UPDATE_FAILED', 'POST_UPDATE_FETCH_FAILED',
    'POST_UPDATE_VERIFICATION_FAILED', 'UNEXPECTED_FAILURE',
  ]
  for (const code of codes) {
    assert.equal(typeof describeOperationError(code), 'string')
    assert.ok(describeOperationError(code).length > 0)
  }
})

test('describeOperationError: unknown code falls back to the generic fixed message', () => {
  assert.equal(describeOperationError('SOMETHING_NEW'), describeOperationError('UNEXPECTED_FAILURE'))
})
