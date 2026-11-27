import type { SupabaseClient } from '@supabase/supabase-js'

export const MEAL_PHOTO_BUCKET = 'meal-photos'

const PUBLIC_URL_PREFIX = `/storage/v1/object/public/${MEAL_PHOTO_BUCKET}/`
const DEFAULT_SIGNED_URL_EXPIRES_IN = 900 // 15 minutes

// Canonical object path is exactly `{userId}/{dateId}/{uuid}.jpg`, unchanged
// since the photo feature was introduced (verified against Git history).
// dateId is always `yyyyMMdd` (see makeDateId()/todayDateId() across the
// codebase). The filename is always a lowercase crypto.randomUUID() + ".jpg".
const DATE_ID_PATTERN = /^\d{8}$/
const UUID_JPG_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/

type NormalizeContext = {
  /** Current NEXT_PUBLIC_SUPABASE_URL (or its origin). Caller-supplied so this stays a pure function. */
  supabaseUrl: string
  /** auth.getUser() result for the current session. Never a client-supplied/trusted-as-is id. */
  userId: string
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

// Rejects anything a URL parser might silently rewrite (duplicate slashes,
// `.`/`..` segments) *before* any parsing happens, so a browser's dot-segment
// normalization can never hide a traversal attempt from this check.
function hasUnsafeRawPathShape(candidate: string): boolean {
  if (candidate.includes('//')) return true
  if (candidate.includes('/./') || candidate.includes('/../')) return true
  if (candidate.startsWith('./') || candidate.startsWith('../')) return true
  if (candidate.endsWith('/.') || candidate.endsWith('/..')) return true
  return false
}

// Strict allowlist: accepts only `{userId}/{dateId}/{uuid}.jpg` with no
// percent-encoding anywhere. No decoding is performed at any point — a raw
// `%` character is an automatic rejection, which also covers every form of
// single/double/malformed percent-encoding (`%2F`, `%252F`, `%2e`, `%25`,
// encoded NUL, etc.) without needing to enumerate them individually.
function normalizeObjectPathSegments(candidate: string, userId: string): string | null {
  if (candidate.length === 0) return null
  if (candidate.includes('%')) return null
  if (candidate.includes('?') || candidate.includes('#')) return null
  if (candidate.includes('\\')) return null
  if (hasControlCharacters(candidate)) return null
  if (candidate.startsWith('/') || candidate.endsWith('/')) return null
  if (hasUnsafeRawPathShape(candidate)) return null

  const segments = candidate.split('/')
  if (segments.length !== 3) return null

  const [userSegment, dateSegment, fileSegment] = segments
  if (userSegment === '.' || userSegment === '..') return null
  if (dateSegment === '.' || dateSegment === '..') return null
  if (fileSegment === '.' || fileSegment === '..') return null

  if (userSegment !== userId) return null
  if (!DATE_ID_PATTERN.test(dateSegment)) return null
  if (!UUID_JPG_PATTERN.test(fileSegment)) return null

  return `${userSegment}/${dateSegment}/${fileSegment}`
}

// Legacy `getPublicUrl()`-style URL. Deliberately avoids `new URL(trimmed)`
// for the untrusted value: WHATWG URL parsing can resolve `.`/`..` segments
// before this code ever sees `.pathname`, which would defeat the raw-shape
// checks above. Instead this does a plain, un-parsed prefix match against
// the known-good origin + prefix, then strips query/fragment textually.
function normalizeLegacyPublicUrl(trimmed: string, context: NormalizeContext): string | null {
  let expected: URL
  try {
    expected = new URL(context.supabaseUrl)
  } catch {
    return null
  }

  const originPrefix = `${expected.origin}${PUBLIC_URL_PREFIX}`
  if (!trimmed.startsWith(originPrefix)) return null

  const afterPrefix = trimmed.slice(originPrefix.length)
  const queryOrFragmentIndex = afterPrefix.search(/[?#]/)
  const pathPart = queryOrFragmentIndex === -1 ? afterPrefix : afterPrefix.slice(0, queryOrFragmentIndex)

  return normalizeObjectPathSegments(pathPart, context.userId)
}

/**
 * Normalizes a `meal_logs.items[].photo_url` value into a verified
 * `meal-photos` object path, or returns null if the value is empty,
 * malformed, or does not belong to the given user.
 *
 * Accepts two forms, both strictly allowlisted to the canonical
 * `{userId}/{dateId}/{uuid}.jpg` shape:
 * - Legacy: a full `getPublicUrl()`-style public URL for this Supabase
 *   project (`{origin}/storage/v1/object/public/meal-photos/{path}`).
 * - Current: a bare `meal-photos`-relative object path.
 *
 * Signed URLs (`/storage/v1/object/sign/...`), authenticated-endpoint URLs,
 * and any value containing a `%` are never accepted — this is a security
 * boundary, not a general-purpose URL parser.
 *
 * Pure function: does not read environment variables, does not throw.
 */
export function normalizeMealPhotoPath(
  value: string | null | undefined,
  context: NormalizeContext
): string | null {
  if (typeof value !== 'string') return null
  if (!context.userId) return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (hasControlCharacters(trimmed)) return null
  if (trimmed.includes('\\')) return null

  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeLegacyPublicUrl(trimmed, context)
  }

  // Any other absolute-URI scheme (blob:, data:, javascript:, ftp:, ...) is
  // never a valid persistent reference.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null

  return normalizeObjectPathSegments(trimmed, context.userId)
}

/**
 * Issues a short-lived signed URL for a verified `meal-photos` object path.
 * Callers must pass the result of `normalizeMealPhotoPath`, never a raw
 * DB value. The returned URL is for display only — never store it in the
 * database, localStorage, or a cookie.
 */
export async function getMealPhotoSignedUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  path: string,
  expiresIn: number = DEFAULT_SIGNED_URL_EXPIRES_IN
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(MEAL_PHOTO_BUCKET).createSignedUrl(path, expiresIn)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}
