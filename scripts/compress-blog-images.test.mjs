import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import { createHash } from 'node:crypto'

// Importing this module must never trigger network calls, Supabase client
// construction, or process.exit -- all side-effecting work lives inside
// main(), which this file never calls.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'compress-blog-images.mjs')).href
const { resolveTargetSlugs, buildPublicObjectUrl, resolveBatchExitCode, processSlug } = await import(moduleUrl)

// --- resolveTargetSlugs: this is the fix for the old script's "operate on
// the entire bucket unconditionally" behavior. Every test here confirms the
// new script only ever acts on an explicitly-provided slug list, never a
// default/fallback to "everything".

test('CLI args are used when present', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', 'abc', 'def'], {})
  assert.deepEqual(result, { valid: true, slugs: ['abc', 'def'] })
})

test('THUMBNAIL_TARGET_SLUGS env var is used when no CLI args are given', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs'], { THUMBNAIL_TARGET_SLUGS: 'abc,def' })
  assert.deepEqual(result, { valid: true, slugs: ['abc', 'def'] })
})

test('CLI args take priority over the env var when both are present', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', 'from-cli'], { THUMBNAIL_TARGET_SLUGS: 'from-env' })
  assert.deepEqual(result, { valid: true, slugs: ['from-cli'] })
})

test('whitespace around comma-separated env var entries is trimmed', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs'], { THUMBNAIL_TARGET_SLUGS: ' abc , def ,ghi' })
  assert.deepEqual(result, { valid: true, slugs: ['abc', 'def', 'ghi'] })
})

test('no CLI args and no env var -> invalid, never falls back to "process everything"', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs'], {})
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'no_target_slugs_specified')
  assert.deepEqual(result.slugs, [])
})

test('empty env var string -> invalid, same as unset', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs'], { THUMBNAIL_TARGET_SLUGS: '' })
  assert.equal(result.valid, false)
})

test('a slug containing uppercase or invalid characters is rejected (fail-closed, matches this repo\'s SLUG_PATTERN convention)', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', 'Valid-Looking-Slug'], {})
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'invalid_slug_format')
  assert.deepEqual(result.invalidSlugs, ['Valid-Looking-Slug'])
})

test('a path-traversal-like or malformed slug is rejected before it could ever be used to build a Storage path', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', '../secrets'], {})
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'invalid_slug_format')
})

test('duplicate slugs in the input are de-duplicated', () => {
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', 'abc', 'abc', 'def'], {})
  assert.deepEqual(result, { valid: true, slugs: ['abc', 'def'] })
})

test('this round\'s exact 6 target slugs are all individually accepted as valid', () => {
  const targets = [
    'aerobic-exercise-types-diet-benefits-2026',
    'fitness-and-hydration-impact',
    'fitness-and-hydration-timing-guide',
    'chunen-futori-muscle-training-menu',
    'alcohol-consumption-during-diet-guide',
    'maintaining-fitness-and-mental-balance',
  ]
  const result = resolveTargetSlugs(['node', 'compress-blog-images.mjs', ...targets], {})
  assert.deepEqual(result, { valid: true, slugs: targets })
})

// --- buildPublicObjectUrl ----------------------------------------------

test('buildPublicObjectUrl constructs the expected Supabase public Storage URL shape', () => {
  const url = buildPublicObjectUrl('https://example.supabase.co', 'blog-images', 'abc.webp')
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/blog-images/abc.webp')
})

test('buildPublicObjectUrl strips a trailing slash on the base URL so the path never doubles up', () => {
  const url = buildPublicObjectUrl('https://example.supabase.co/', 'blog-images', 'abc.webp')
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/blog-images/abc.webp')
})

// --- resolveBatchExitCode: Codex-reproduced bug fix ---------------------
// The old rule was `failed > 0 && succeeded === 0 ? 1 : 0`, which returned
// exit 0 for any partial-failure batch (e.g. 5 succeeded + 1 failed) --
// GitHub Actions would then treat a run that silently dropped an update as
// a success. The new rule fails the whole process if ANY target failed,
// regardless of how many succeeded (already-succeeded Storage/DB writes
// are never rolled back -- only the process exit code changes).

test('A: all 6 succeeded, 0 failed -> exit 0', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 6, failed: 0 }), 0)
})

test('B: 5 succeeded, 1 failed -> exit 1 (the exact case Codex reproduced -- must NOT be exit 0)', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 5, failed: 1 }), 1)
})

test('C: 1 succeeded, 5 failed -> exit 1', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 1, failed: 5 }), 1)
})

test('D: 0 succeeded, 6 failed -> exit 1', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 0, failed: 6 }), 1)
})

test('E: a single target that succeeds -> exit 0', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 1, failed: 0 }), 0)
})

test('F: a single target that fails -> exit 1', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 0, failed: 1 }), 1)
})

// --- processSlug: Codex round-3 follow-up ------------------------------
// Adds remote-object re-verification (upload -> remote download -> validate
// -> only then DB update) and an is_published=true CAS predicate on the
// final UPDATE. All Supabase I/O (table select/update, storage
// list/download/upload) is mocked below; sharp itself runs for real
// (in-memory, no network) so the actual compression/re-decode control flow
// this function depends on is genuinely exercised, not just asserted by
// string matching.

const BUCKET = 'blog-images'
const SUPABASE_URL = 'https://example.supabase.co'
const SLUG = 'test-slug'
const PNG_FILENAME = `${SLUG}.png`
const WEBP_FILENAME = `${SLUG}.webp`
const EXPECTED_OG_IMAGE = buildPublicObjectUrl(SUPABASE_URL, BUCKET, PNG_FILENAME)
const ROW_ID = 'row-id-123'

// A real, synthetic gradient PNG (not a fixture file on disk) - large and
// gradient-textured enough that WebP compression reliably lands well under
// the tool's own 70%-of-original threshold, so the happy-path test doesn't
// depend on a checked-in binary asset.
async function makeSyntheticPngBuffer() {
  const width = 1600
  const height = 1200
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      raw[i] = Math.floor((x / width) * 255)
      raw[i + 1] = Math.floor((y / height) * 255)
      raw[i + 2] = 128
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

function blobLike(buffer) {
  return { arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }
}

// Codex round-4 follow-up: builds a remote-fixture WebP that is a valid
// WebP, decodes to the exact same width/height as `originalWebp`, and has
// the exact same byte length -- but differs in content (and therefore SHA-
// 256) from it. This isolates the hash-comparison branch specifically: the
// format/dimensions/byte-length checks all pass, so only the SHA-256
// comparison itself can catch this fixture.
//
// Construction: starting from the last byte and scanning backward through
// the second half of the buffer (a fixed, deterministic order -- no
// randomness), flip every bit of one byte at a time (XOR 0xff, guaranteed
// to change that byte's value) and re-decode the mutated buffer with sharp.
// The search stops at the first offset whose mutated buffer still decodes
// as a valid 'webp' at the original width/height (byte length is
// unconditionally unchanged by a same-position single-byte edit). Bytes
// deep in a lossy WebP's entropy-coded payload are generally tolerant of a
// single-bit/byte perturbation without breaking decodability, since
// width/height are read directly from the container header, independent of
// how the pixel payload actually decodes.
async function makeSameLengthDifferentContentWebp(originalWebp) {
  const originalMeta = await sharp(originalWebp).metadata()
  for (let offset = originalWebp.length - 1; offset >= Math.floor(originalWebp.length / 2); offset--) {
    const candidate = Buffer.from(originalWebp)
    candidate[offset] = candidate[offset] ^ 0xff
    let candidateMeta
    try {
      candidateMeta = await sharp(candidate).metadata()
    } catch {
      continue
    }
    if (
      candidateMeta.format === 'webp' &&
      candidateMeta.width === originalMeta.width &&
      candidateMeta.height === originalMeta.height &&
      candidate.length === originalWebp.length
    ) {
      return candidate
    }
  }
  throw new Error('could not find a single-byte mutation producing a same-dimension, same-length, valid WebP')
}

// Builds a fake Supabase client covering exactly the chains processSlug()
// uses. `callOrder` (shared across all fake methods) lets tests assert
// cross-boundary ordering (e.g. "DB update happens after remote verify"),
// which per-mock call arrays alone can't express.
function createFakeSupabase({
  row = { id: ROW_ID, slug: SLUG, og_image: EXPECTED_OG_IMAGE, is_published: true },
  rowSelectError = null,
  listResult = { data: [], error: null },
  downloadOverrides = {},
  uploadError = null,
  updateResult = { data: [{ id: ROW_ID, slug: SLUG, og_image: 'ignored' }], error: null },
  callOrder = [],
} = {}) {
  const calls = { list: [], download: [], upload: [], updateEq: [] }

  return {
    _calls: calls,
    _callOrder: callOrder,
    from(table) {
      if (table !== 'blogs') throw new Error(`unexpected table: ${table}`)
      return {
        select() {
          return {
            eq: async () => {
              callOrder.push('select')
              if (rowSelectError) return { data: null, error: rowSelectError }
              return { data: row ? [row] : [], error: null }
            },
          }
        },
        update(patch) {
          calls.updateEq.push({ patch, eqs: [] })
          const record = calls.updateEq[calls.updateEq.length - 1]
          const builder = {
            eq(col, val) {
              record.eqs.push([col, val])
              return builder
            },
            select: async () => {
              callOrder.push('db_update')
              return updateResult
            },
          }
          return builder
        },
      }
    },
    storage: {
      from(bucket) {
        if (bucket !== BUCKET) throw new Error(`unexpected bucket: ${bucket}`)
        return {
          list: async (prefix, opts) => {
            calls.list.push({ prefix, opts })
            callOrder.push('list')
            return listResult
          },
          download: async (filename) => {
            calls.download.push(filename)
            callOrder.push(`download:${filename}`)
            if (downloadOverrides[filename]) return downloadOverrides[filename]
            throw new Error(`no mock configured for download(${filename})`)
          },
          upload: async (filename, buffer, opts) => {
            calls.upload.push({ filename, byteLength: buffer.byteLength, opts })
            callOrder.push('upload')
            return { error: uploadError }
          },
        }
      },
    },
  }
}

// --- A: happy path -------------------------------------------------------

test('processSlug A: happy path - remote-verified upload, then DB update, in that order', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const callOrder = []
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      // The remote-verification download must see exactly the bytes that
      // were uploaded (same buffer) - not a distinct fixture - so this test
      // proves the round-trip is real, not merely "any webp passes".
      [WEBP_FILENAME]: { data: blobLike(compressedWebp), error: null },
    },
    callOrder,
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, true)
  assert.equal(result.webpFilename, WEBP_FILENAME)
  assert.equal(supabase._calls.upload.length, 1)
  assert.equal(supabase._calls.upload[0].opts.upsert, false)
  assert.equal(supabase._calls.updateEq.length, 1)

  const uploadIndex = callOrder.indexOf('upload')
  const remoteVerifyIndex = callOrder.indexOf(`download:${WEBP_FILENAME}`)
  const dbUpdateIndex = callOrder.indexOf('db_update')
  assert.ok(uploadIndex >= 0 && remoteVerifyIndex >= 0 && dbUpdateIndex >= 0)
  assert.ok(uploadIndex < remoteVerifyIndex, 'remote verification must happen after upload')
  assert.ok(remoteVerifyIndex < dbUpdateIndex, 'DB update must happen after remote verification, not before')
})

// --- B: remote download failure -------------------------------------------

test('processSlug B: upload succeeds, remote re-download fails -> no DB update, no source delete, clear reason', async () => {
  const originalPng = await makeSyntheticPngBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: null, error: { message: 'simulated remote download failure' } },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_download_failed')
  assert.equal(supabase._calls.upload.length, 1, 'upload should still have been attempted')
  assert.equal(supabase._calls.updateEq.length, 0, 'DB update must never be attempted')
})

// --- C: remote invalid (non-decodable) bytes -------------------------------

test('processSlug C: remote download returns malformed/non-image bytes -> no DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(Buffer.from('not an image at all')), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_invalid')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- D: remote decodes but is not WebP -------------------------------------

test('processSlug D: remote bytes decode successfully but are not WebP format -> no DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  // A real, validly-decodable PNG returned where a WebP was expected.
  const wrongFormatBytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(wrongFormatBytes), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_format_mismatch')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- E: remote dimension mismatch -------------------------------------------

test('processSlug E: remote WebP dimensions differ from the locally-generated output -> no DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  // A validly-decodable WebP, but at different dimensions than what the
  // local compression step actually produced for this same source PNG.
  const wrongDimensionWebp = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(wrongDimensionWebp), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_dimension_mismatch')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- F: remote byte/hash mismatch (same dimensions, different content) -----

test('processSlug F: remote WebP has the same dimensions but different byte content (hash mismatch) -> no DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  // A different, validly-decodable WebP at the exact same dimensions as the
  // real local output, so only the byte-length/hash checks - not the
  // dimension check - can catch this. Proves the hash comparison is load-
  // bearing, not redundant with the dimension check.
  const meta = await sharp(compressedWebp).metadata()
  const substitutedWebp = await sharp({
    create: { width: meta.width, height: meta.height, channels: 3, background: { r: 200, g: 50, b: 5 } },
  }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(substitutedWebp), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.ok(
    result.reason === 'remote_webp_hash_mismatch' || result.reason === 'remote_webp_size_mismatch',
    `expected a content-mismatch reason, got "${result.reason}"`
  )
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- F(b): dedicated hash-only mismatch test (Codex round-4 follow-up) -----
// Test F above happens to also differ in byte length, so it can (and does)
// resolve via the earlier remote_webp_size_mismatch check without the SHA-
// 256 comparison ever running -- meaning that check alone gave no proof the
// hash comparison itself is load-bearing. This test isolates exactly that:
// a remote fixture that is format-identical, dimension-identical, and
// byte-length-identical to the real local output, differing only in
// content. Only the hash comparison can catch it.

test('processSlug F(b): remote WebP has identical format/dimensions/byte-length to the local output but different content -> remote_webp_hash_mismatch specifically', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const localWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  const remoteWebp = await makeSameLengthDifferentContentWebp(localWebp)

  // --- Critical precondition assertions: prove the fixture actually
  // reaches the hash layer, before ever looking at processSlug's result.
  const localMeta = await sharp(localWebp).metadata()
  const remoteMeta = await sharp(remoteWebp).metadata()
  assert.equal(remoteMeta.format, 'webp', 'fixture must be a valid, decodable WebP')
  assert.equal(remoteMeta.width, localMeta.width, 'fixture must have identical width to the local output')
  assert.equal(remoteMeta.height, localMeta.height, 'fixture must have identical height to the local output')
  assert.equal(remoteWebp.length, localWebp.length, 'fixture must have identical byte length to the local output')
  assert.equal(remoteWebp.equals(localWebp), false, 'fixture bytes must differ from the local output')
  const localHash = createHash('sha256').update(localWebp).digest('hex')
  const remoteHash = createHash('sha256').update(remoteWebp).digest('hex')
  assert.notEqual(remoteHash, localHash, 'fixture SHA-256 must differ from the local output')

  const callOrder = []
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(remoteWebp), error: null },
    },
    callOrder,
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_hash_mismatch', 'must be exactly this reason, not a fallback like remote_webp_size_mismatch')
  assert.equal(supabase._calls.upload.length, 1, 'upload must still have occurred')
  assert.ok(callOrder.includes(`download:${WEBP_FILENAME}`), 'remote destination download must still have occurred')
  assert.equal(supabase._calls.updateEq.length, 0, 'DB update must not occur')
})

// --- G: Storage list/existence check errors (fail closed) ------------------

test('processSlug G: destination existence check (list) errors -> fails closed, no upload, no DB update', async () => {
  const supabase = createFakeSupabase({
    listResult: { data: null, error: { message: 'simulated list failure' } },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'destination_check_failed')
  assert.equal(supabase._calls.upload.length, 0)
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- H: destination already exists ------------------------------------------

test('processSlug H: destination WebP already exists -> no overwrite, no upload, no DB update', async () => {
  const supabase = createFakeSupabase({
    listResult: { data: [{ name: WEBP_FILENAME }], error: null },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'webp_already_exists')
  assert.equal(supabase._calls.upload.length, 0)
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- I: is_published is part of the final UPDATE's own CAS predicate -------

test('processSlug I: the final UPDATE predicate includes is_published=true alongside id/slug/og_image', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(compressedWebp), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })
  assert.equal(result.ok, true)

  assert.equal(supabase._calls.updateEq.length, 1)
  const { patch, eqs } = supabase._calls.updateEq[0]
  assert.deepEqual(patch, { og_image: buildPublicObjectUrl(SUPABASE_URL, BUCKET, WEBP_FILENAME) })
  const eqMap = Object.fromEntries(eqs)
  assert.equal(eqMap.id, ROW_ID)
  assert.equal(eqMap.slug, SLUG)
  assert.equal(eqMap.og_image, EXPECTED_OG_IMAGE)
  assert.equal(eqMap.is_published, true, 'is_published=true must be part of the UPDATE predicate itself, not just the earlier read check')
})

test('processSlug I(b): a zero-row CAS result (e.g. article unpublished between read and update) fails safely, without republishing anything', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [PNG_FILENAME]: { data: blobLike(originalPng), error: null },
      [WEBP_FILENAME]: { data: blobLike(compressedWebp), error: null },
    },
    // Simulates the predicate matching zero rows (e.g. is_published flipped
    // to false after the initial read) - Supabase returns an empty array,
    // not an error, in this case.
    updateResult: { data: [], error: null },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'db_update_row_count_mismatch')
})

// --- J: source retention across every failure path --------------------------

test('processSlug J: no Storage delete/remove call ever occurs, across every failure path exercised above', async () => {
  // None of the fake Supabase clients built in this file expose a
  // storage.from(...).remove()/delete() method at all - so if processSlug
  // ever attempted to call one, every test above would already have thrown
  // a TypeError instead of returning a normal { ok: false, reason } result.
  // This test makes that guarantee explicit and named, rather than only
  // implicit in the other tests passing.
  const supabase = createFakeSupabase({
    listResult: { data: null, error: { message: 'simulated list failure' } },
  })
  assert.equal('remove' in supabase.storage.from(BUCKET), false)
  assert.equal('delete' in supabase.storage.from(BUCKET), false)

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: SLUG })
  assert.equal(result.ok, false)
})
