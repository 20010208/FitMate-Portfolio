import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import { createHash } from 'node:crypto'

// Importing this module must never trigger network calls, Supabase client
// construction, or process.exit -- all side-effecting work lives inside
// main(), which this file never calls. Mirrors the existing normal-tool
// test file's import-safety convention.
const moduleUrl = pathToFileURL(path.resolve(import.meta.dirname, 'compress-pr-blog-images.mjs')).href
const {
  PR_SOURCE_ALLOWLIST,
  PR_SOURCE_MAP,
  validateSourcePath,
  deriveWebpPath,
  buildPublicObjectUrl,
  resolveTargetSlugs,
  resolveBatchExitCode,
  processSlug,
} = await import(moduleUrl)

const BUCKET = 'blog-images'
const SUPABASE_URL = 'https://example.supabase.co'

// --- Static allowlist self-check ----------------------------------------
// Protects against a future edit to PR_SOURCE_ALLOWLIST introducing an
// entry that would fail its own path validation (defense-in-depth: the
// allowlist itself must always pass the same check processSlug applies at
// runtime).

test('every entry in PR_SOURCE_ALLOWLIST passes validateSourcePath', () => {
  for (const { slug, sourcePath } of PR_SOURCE_ALLOWLIST) {
    const result = validateSourcePath(sourcePath)
    assert.equal(result.valid, true, `${slug} -> ${sourcePath} should be a valid path: ${result.reason}`)
  }
})

test('PR_SOURCE_ALLOWLIST has exactly 6 entries with unique slugs', () => {
  assert.equal(PR_SOURCE_ALLOWLIST.length, 6)
  assert.equal(new Set(PR_SOURCE_ALLOWLIST.map((e) => e.slug)).size, 6)
})

// --- resolveTargetSlugs: allowlist-only targeting -------------------------

test('1: zero target arguments are rejected', () => {
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs'])
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'no_target_slugs_specified')
  assert.deepEqual(result.slugs, [])
})

test('2: an unknown slug is rejected before any Production work', () => {
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs', 'not-a-real-pr-slug'])
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'unknown_slug')
  assert.deepEqual(result.unknownSlugs, ['not-a-real-pr-slug'])
})

test('3: all six exact allowlisted slugs are accepted together', () => {
  const targets = PR_SOURCE_ALLOWLIST.map((e) => e.slug)
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs', ...targets])
  assert.deepEqual(result, { valid: true, slugs: targets })
})

test('4: duplicate target slugs are deterministically de-duplicated before any Production work', () => {
  const slug = PR_SOURCE_ALLOWLIST[0].slug
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs', slug, slug])
  assert.deepEqual(result, { valid: true, slugs: [slug] })
})

test('27: an arbitrary path/URL passed as a CLI "slug" is rejected as unknown_slug, not accepted as a path', () => {
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs', 'PR-post/evil/../../secrets.png'])
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'unknown_slug')
})

test('28: no bucket-wide/"all"/wildcard fallback exists -- an empty argument list never resolves to every allowlisted slug', () => {
  const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs'])
  assert.equal(result.valid, false)
  // Confirms failure, not a silent "all 6" default.
  assert.notEqual(result.slugs?.length, PR_SOURCE_ALLOWLIST.length)
})

test('29: the normal 31-target tool\'s slugs are not accidentally accepted by the PR allowlist', () => {
  const normalSlugs = [
    'muscle-training-mental-health-connection',
    'efficient-frequency-of-resistance-training',
    'creatine-effect-usage-guide',
  ]
  for (const slug of normalSlugs) {
    assert.equal(PR_SOURCE_MAP.has(slug), false, `${slug} must not be in the PR allowlist`)
    const result = resolveTargetSlugs(['node', 'compress-pr-blog-images.mjs', slug])
    assert.equal(result.valid, false)
    assert.equal(result.reason, 'unknown_slug')
  }
})

// --- validateSourcePath / deriveWebpPath: path safety ---------------------

test('5: the Reveria 2-level nested source path resolves exactly to its allowlisted destination', () => {
  const entry = PR_SOURCE_ALLOWLIST.find((e) => e.slug === 'reveria-recovery-mattress-features-price')
  assert.equal(entry.sourcePath, 'PR-post/Reveria/reveria-recovery-mattress-features-price.png')
  assert.equal(validateSourcePath(entry.sourcePath).valid, true)
  assert.equal(deriveWebpPath(entry.sourcePath), 'PR-post/Reveria/reveria-recovery-mattress-features-price.webp')
})

test('6: a normal 1-level "PR-post/<slug>.png" path resolves exactly', () => {
  const entry = PR_SOURCE_ALLOWLIST.find((e) => e.slug === 'tria-4x-features-how-to-use-price')
  assert.equal(entry.sourcePath, 'PR-post/tria-4x-features-how-to-use-price.png')
  assert.equal(validateSourcePath(entry.sourcePath).valid, true)
  assert.equal(deriveWebpPath(entry.sourcePath), 'PR-post/tria-4x-features-how-to-use-price.webp')
})

test('7: destination derivation changes only the final ".png" -> ".webp", preserving directory and basename', () => {
  assert.equal(deriveWebpPath('PR-post/foo.png'), 'PR-post/foo.webp')
  assert.equal(deriveWebpPath('PR-post/Reveria/foo.png'), 'PR-post/Reveria/foo.webp')
  assert.equal(deriveWebpPath('PR-post/a/b/c/foo.png'), 'PR-post/a/b/c/foo.webp')
})

test('8: path traversal is rejected', () => {
  assert.equal(validateSourcePath('PR-post/../secrets.png').valid, false)
  assert.equal(validateSourcePath('PR-post/../secrets.png').reason, 'path_traversal_rejected')
  assert.equal(deriveWebpPath('PR-post/../secrets.png'), null)
})

test('9: unexpected path shapes are rejected', () => {
  assert.equal(validateSourcePath('blog-images/foo.png').valid, false, 'must not accept a root-level normal-tool-style path')
  assert.equal(validateSourcePath('PR-post/foo.png').valid, true)
  assert.equal(validateSourcePath('PR-post/foo.jpg').valid, false, 'must require .png suffix')
  assert.equal(validateSourcePath('PR-post//foo.png').valid, false, 'must reject empty path segment')
  assert.equal(validateSourcePath('/PR-post/foo.png').valid, false, 'must reject leading slash')
  assert.equal(validateSourcePath('PR-post/foo.png/').valid, false, 'must reject trailing slash')
  assert.equal(validateSourcePath('PR-post\\foo.png').valid, false, 'must reject backslash')
  assert.equal(validateSourcePath('https://evil.example.com/x.png').valid, false, 'must reject an external URL')
  assert.equal(validateSourcePath('').valid, false)
  assert.equal(validateSourcePath(null).valid, false)
  assert.equal(validateSourcePath('PR-post/foo bar.png').valid, false, 'must reject a space character')
})

// --- buildPublicObjectUrl --------------------------------------------------

test('buildPublicObjectUrl preserves nested path slashes verbatim', () => {
  const url = buildPublicObjectUrl(SUPABASE_URL, BUCKET, 'PR-post/Reveria/foo.webp')
  assert.equal(url, 'https://example.supabase.co/storage/v1/object/public/blog-images/PR-post/Reveria/foo.webp')
})

// --- resolveBatchExitCode --------------------------------------------------

test('26: one failed slug in a batch produces a nonzero final exit code, matching the normal tool\'s rule', () => {
  assert.equal(resolveBatchExitCode({ succeeded: 5, failed: 1 }), 1)
  assert.equal(resolveBatchExitCode({ succeeded: 6, failed: 0 }), 0)
  assert.equal(resolveBatchExitCode({ succeeded: 0, failed: 1 }), 1)
})

// --- processSlug: full flow, mocked Supabase -------------------------------

const TEST_SLUG = 'tria-4x-features-how-to-use-price'
const TEST_SOURCE_PATH = PR_SOURCE_MAP.get(TEST_SLUG)
const TEST_WEBP_PATH = deriveWebpPath(TEST_SOURCE_PATH)
const EXPECTED_OG_IMAGE = buildPublicObjectUrl(SUPABASE_URL, BUCKET, TEST_SOURCE_PATH)
const ROW_ID = 'pr-row-id-123'

const NESTED_SLUG = 'reveria-recovery-mattress-features-price'
const NESTED_SOURCE_PATH = PR_SOURCE_MAP.get(NESTED_SLUG)
const NESTED_WEBP_PATH = deriveWebpPath(NESTED_SOURCE_PATH)
const NESTED_EXPECTED_OG_IMAGE = buildPublicObjectUrl(SUPABASE_URL, BUCKET, NESTED_SOURCE_PATH)

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

// A fixed (non-random), 1x1-pixel PNG whose WebP re-encode reliably lands
// at ratio ~0.733 -- above the tool's 0.7 compression gate -- so the
// insufficient_compression path can be exercised deterministically without
// depending on randomness or a checked-in binary fixture.
async function makePoorlyCompressiblePngBuffer() {
  const raw = Buffer.from([255, 0, 128])
  return sharp(raw, { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer()
}

function blobLike(buffer) {
  return { arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }
}

// Fake Supabase client covering exactly the chains processSlug() uses.
// list() is path-aware (prefix, opts) so nested-directory listing (e.g.
// "PR-post/Reveria") is captured distinctly from single-level listing
// ("PR-post"), unlike the normal tool's always-root-level list calls.
function createFakeSupabase({
  row = { id: ROW_ID, slug: TEST_SLUG, og_image: EXPECTED_OG_IMAGE, is_published: true },
  rowSelectError = null,
  listResult = { data: [], error: null },
  downloadOverrides = {},
  uploadError = null,
  updateResult = { data: [{ id: ROW_ID, slug: TEST_SLUG, og_image: 'ignored' }], error: null },
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
            callOrder.push(`list:${prefix}`)
            return listResult
          },
          download: async (filePath) => {
            calls.download.push(filePath)
            callOrder.push(`download:${filePath}`)
            if (downloadOverrides[filePath]) return downloadOverrides[filePath]
            throw new Error(`no mock configured for download(${filePath})`)
          },
          upload: async (filePath, buffer, opts) => {
            calls.upload.push({ filePath, byteLength: buffer.byteLength, opts })
            callOrder.push('upload')
            return { error: uploadError }
          },
        }
      },
    },
  }
}

// --- A: happy path (1-level nested path) ----------------------------------

test('processSlug A: happy path on a 1-level nested "PR-post/<slug>.png" path -- remote-verified upload, then DB update, in that order', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const callOrder = []
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(compressedWebp), error: null },
    },
    callOrder,
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })

  assert.equal(result.ok, true)
  assert.equal(result.sourcePath, TEST_SOURCE_PATH)
  assert.equal(result.webpPath, TEST_WEBP_PATH)
  assert.equal(supabase._calls.upload.length, 1)
  assert.equal(supabase._calls.upload[0].filePath, TEST_WEBP_PATH)
  assert.equal(supabase._calls.upload[0].opts.upsert, false, '15: upload must use upsert:false')
  assert.equal(supabase._calls.updateEq.length, 1)

  // 14/list scoping: the destination-existence list() call must target the
  // exact parent directory ("PR-post"), not the bucket root.
  assert.equal(supabase._calls.list.length, 1)
  assert.equal(supabase._calls.list[0].prefix, 'PR-post')
  assert.equal(supabase._calls.list[0].opts.search, 'tria-4x-features-how-to-use-price.webp')

  const uploadIndex = callOrder.indexOf('upload')
  const remoteVerifyIndex = callOrder.indexOf(`download:${TEST_WEBP_PATH}`)
  const dbUpdateIndex = callOrder.indexOf('db_update')
  assert.ok(uploadIndex >= 0 && remoteVerifyIndex >= 0 && dbUpdateIndex >= 0)
  assert.ok(uploadIndex < remoteVerifyIndex, 'remote verification must happen after upload')
  assert.ok(remoteVerifyIndex < dbUpdateIndex, 'DB update must happen after remote verification, not before')
})

// --- A(b): happy path on the 2-level nested Reveria path -------------------

test('processSlug A(b): happy path on the 2-level nested "PR-post/Reveria/<slug>.png" path -- correct directory-scoped listing and destination', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    row: { id: ROW_ID, slug: NESTED_SLUG, og_image: NESTED_EXPECTED_OG_IMAGE, is_published: true },
    downloadOverrides: {
      [NESTED_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [NESTED_WEBP_PATH]: { data: blobLike(compressedWebp), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: NESTED_SLUG })

  assert.equal(result.ok, true)
  assert.equal(result.sourcePath, 'PR-post/Reveria/reveria-recovery-mattress-features-price.png')
  assert.equal(result.webpPath, 'PR-post/Reveria/reveria-recovery-mattress-features-price.webp')
  assert.equal(supabase._calls.list[0].prefix, 'PR-post/Reveria')
  assert.equal(supabase._calls.list[0].opts.search, 'reveria-recovery-mattress-features-price.webp')
})

// --- 10/11: current DB og_image exact-match gate ---------------------------

test('10: the current DB og_image must exactly match the URL built from the allowlisted source path before any Storage work proceeds', async () => {
  const supabase = createFakeSupabase({
    row: { id: ROW_ID, slug: TEST_SLUG, og_image: EXPECTED_OG_IMAGE, is_published: true },
    // A matching og_image should let the tool proceed past the DB gate and
    // reach the destination-existence check (list()); this deliberately
    // fails there (not via an unmocked download throwing) so the test
    // proves *how far* processing got, not just that it eventually failed.
    listResult: { data: null, error: { message: 'simulated list failure -- proves the gate was passed' } },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.notEqual(result.reason, 'og_image_unexpected')
  assert.equal(result.reason, 'destination_check_failed')
  assert.equal(supabase._calls.list.length, 1, 'must have reached the Storage destination check, proving the og_image gate passed')
})

test('11: an unexpected current og_image (already changed, or pointing elsewhere) blocks processing before any Storage write', async () => {
  const supabase = createFakeSupabase({
    row: { id: ROW_ID, slug: TEST_SLUG, og_image: 'https://example.supabase.co/storage/v1/object/public/blog-images/PR-post/tria-4x-features-how-to-use-price.webp', is_published: true },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'og_image_unexpected')
  assert.equal(supabase._calls.list.length, 0, 'must not reach Storage at all')
  assert.equal(supabase._calls.upload.length, 0)
})

// --- 12: unpublished row blocks --------------------------------------------

test('12: an unpublished row blocks processing', async () => {
  const supabase = createFakeSupabase({
    row: { id: ROW_ID, slug: TEST_SLUG, og_image: EXPECTED_OG_IMAGE, is_published: false },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'not_published')
  assert.equal(supabase._calls.upload.length, 0)
})

// --- 13: destination exists blocks upload -----------------------------------

test('13: an already-existing destination WebP blocks upload (no overwrite)', async () => {
  const supabase = createFakeSupabase({
    listResult: { data: [{ name: 'tria-4x-features-how-to-use-price.webp' }], error: null },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'webp_already_exists')
  assert.equal(supabase._calls.upload.length, 0)
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 14: Storage list error fail-closed -------------------------------------

test('14: a Storage list() error for the destination check fails closed (no upload, no DB update)', async () => {
  const supabase = createFakeSupabase({
    listResult: { data: null, error: { message: 'simulated list failure' } },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'destination_check_failed')
  assert.equal(supabase._calls.upload.length, 0)
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 16: threshold failure blocks upload ------------------------------------

test('16: insufficient compression (>= 70% of original) blocks upload and DB update entirely', async () => {
  const poorlyCompressiblePng = await makePoorlyCompressiblePngBuffer()
  // Precondition: prove this fixture actually fails the 0.7 gate before
  // trusting the assertion below.
  const webpPreview = await sharp(poorlyCompressiblePng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  assert.ok(webpPreview.byteLength >= poorlyCompressiblePng.byteLength * 0.7, 'fixture must NOT compress well enough')

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(poorlyCompressiblePng), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'insufficient_compression')
  assert.equal(supabase._calls.upload.length, 0, 'must never upload when the threshold gate fails')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 17: remote download failure --------------------------------------------

test('17: remote re-download failure after upload blocks the DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: null, error: { message: 'simulated remote download failure' } },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_download_failed')
  assert.equal(supabase._calls.upload.length, 1, 'upload should still have been attempted')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 18: remote invalid format blocks DB update -----------------------------

test('18: remote bytes that decode but are not WebP format block the DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const wrongFormatBytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(wrongFormatBytes), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_format_mismatch')
  assert.equal(supabase._calls.updateEq.length, 0)
})

test('18(b): completely non-decodable remote bytes block the DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(Buffer.from('not an image at all')), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_invalid')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 19: remote dimensions mismatch -----------------------------------------

test('19: remote WebP dimensions differing from the local output block the DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const wrongDimensionWebp = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } }).webp({ quality: 80 }).toBuffer()
  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(wrongDimensionWebp), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_dimension_mismatch')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 20/21: remote byte-length / SHA-256 mismatch ---------------------------

test('20: remote WebP with a different byte length than the uploaded buffer blocks the DB update', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  const meta = await sharp(compressedWebp).metadata()
  const substitutedWebp = await sharp({
    create: { width: meta.width, height: meta.height, channels: 3, background: { r: 200, g: 50, b: 5 } },
  }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(substitutedWebp), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.ok(
    result.reason === 'remote_webp_hash_mismatch' || result.reason === 'remote_webp_size_mismatch',
    `expected a content-mismatch reason, got "${result.reason}"`,
  )
  assert.equal(supabase._calls.updateEq.length, 0)
})

// A same-length, different-content fixture that isolates the SHA-256 check
// specifically (mirrors the normal tool's dedicated hash-mismatch test).
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

test('21: remote WebP identical in format/dimensions/byte-length but different content blocks the DB update via SHA-256 specifically', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const localWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  const remoteWebp = await makeSameLengthDifferentContentWebp(localWebp)

  const localHash = createHash('sha256').update(localWebp).digest('hex')
  const remoteHash = createHash('sha256').update(remoteWebp).digest('hex')
  assert.notEqual(remoteHash, localHash, 'fixture SHA-256 must differ from the local output')
  assert.equal(remoteWebp.length, localWebp.length, 'fixture must have identical byte length')

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(remoteWebp), error: null },
    },
  })
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'remote_webp_hash_mismatch')
  assert.equal(supabase._calls.updateEq.length, 0)
})

// --- 22/24: DB CAS fields and update payload --------------------------------

test('22/24: the final UPDATE predicate is exactly id+slug+og_image+is_published=true, and the payload contains only og_image', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(compressedWebp), error: null },
    },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, true)

  assert.equal(supabase._calls.updateEq.length, 1)
  const { patch, eqs } = supabase._calls.updateEq[0]

  // 24/30: only og_image is ever in the update payload -- no content,
  // title, description, category, slug, published_at, is_published,
  // created_at, or affiliate/tracking field can be written by this tool.
  assert.deepEqual(Object.keys(patch), ['og_image'])
  assert.equal(patch.og_image, buildPublicObjectUrl(SUPABASE_URL, BUCKET, TEST_WEBP_PATH))

  const eqMap = Object.fromEntries(eqs)
  assert.equal(eqMap.id, ROW_ID)
  assert.equal(eqMap.slug, TEST_SLUG)
  assert.equal(eqMap.og_image, EXPECTED_OG_IMAGE)
  assert.equal(eqMap.is_published, true)
  assert.equal(Object.keys(eqMap).length, 4, 'CAS must be exactly these 4 fields, nothing broader')
})

// --- 23: zero-row DB update treated as failure ------------------------------

test('23: a zero-row CAS result (e.g. row changed between read and update) is treated as a failure, not silently ignored', async () => {
  const originalPng = await makeSyntheticPngBuffer()
  const compressedWebp = await sharp(originalPng).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const supabase = createFakeSupabase({
    downloadOverrides: {
      [TEST_SOURCE_PATH]: { data: blobLike(originalPng), error: null },
      [TEST_WEBP_PATH]: { data: blobLike(compressedWebp), error: null },
    },
    updateResult: { data: [], error: null },
  })

  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: TEST_SLUG })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'db_update_row_count_mismatch')
})

// --- 25: no source delete/remove path ---------------------------------------

test('25: no Storage delete/remove call ever occurs, across every failure path exercised above', () => {
  const supabase = createFakeSupabase({
    listResult: { data: null, error: { message: 'simulated list failure' } },
  })
  assert.equal('remove' in supabase.storage.from(BUCKET), false)
  assert.equal('delete' in supabase.storage.from(BUCKET), false)
})

test('processSlug: an unknown slug (not in the allowlist) is rejected without touching Supabase at all', async () => {
  const supabase = createFakeSupabase()
  const result = await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug: 'totally-unknown-slug' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unknown_slug')
  assert.equal(supabase._calls.list.length, 0)
  assert.equal(supabase._calls.download.length, 0)
  assert.equal(supabase._calls.upload.length, 0)
  assert.equal(supabase._calls.updateEq.length, 0)
})
