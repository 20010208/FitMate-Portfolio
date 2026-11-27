/**
 * meal-photos bucket管理scriptの純粋関数群。
 * Supabase接続・ファイルI/O・console出力を一切行わない。
 * scripts/manage-meal-photos-bucket.mjsから呼び出される。
 *
 * すべてのエラー系関数は固定のcode／固定のsanitized文言だけを返す。
 * 呼び出し元から渡された生の値（unknown CLI引数、bucket応答の実値等）を
 * そのままメッセージへ埋め込む関数はこのモジュールに存在しない。
 */

export const MEAL_PHOTOS_BUCKET_ID = 'meal-photos'
export const REQUIRED_CONFIRM_VALUE = MEAL_PHOTOS_BUCKET_ID
export const VALID_TARGETS = ['private', 'public']

const KNOWN_FLAGS = new Set(['--inspect', '--target', '--apply', '--confirm'])

function isFlagLike(token) {
  return typeof token === 'string' && token.startsWith('--')
}

// --- CLI parsing -----------------------------------------------------------

/**
 * CLI引数を解析する。副作用なし（console／process.exitを呼ばない）。
 * エラー時はcodeだけを返し、ユーザーが渡した実際の値は一切含めない。
 * 実際の値をerrorへ含めていないため、describeCliError(code)は常に
 * 固定文言のみを返せる。
 *
 * 戻り値:
 *   { ok: true, options: { action: 'inspect' } }
 *   { ok: true, options: { action: 'dry-run', target: 'private'|'public' } }
 *   { ok: true, options: { action: 'apply', target: 'private'|'public', confirm: string } }
 *   { ok: false, code: string }
 */
export function parseCliArgs(argv) {
  const seen = { inspect: 0, target: 0, apply: 0, confirm: 0 }
  let target = null
  let confirm = null
  let apply = false
  let inspect = false

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (!KNOWN_FLAGS.has(arg)) {
      return { ok: false, code: 'UNKNOWN_ARGUMENT' }
    }

    if (arg === '--inspect') {
      seen.inspect += 1
      inspect = true
      i += 1
      continue
    }

    if (arg === '--apply') {
      seen.apply += 1
      apply = true
      i += 1
      continue
    }

    if (arg === '--target') {
      const value = argv[i + 1]
      if (value === undefined || isFlagLike(value) || !VALID_TARGETS.includes(value)) {
        return { ok: false, code: 'INVALID_TARGET_VALUE' }
      }
      seen.target += 1
      if (target !== null && target !== value) {
        return { ok: false, code: 'CONFLICTING_TARGET' }
      }
      target = value
      i += 2
      continue
    }

    if (arg === '--confirm') {
      const value = argv[i + 1]
      if (value === undefined || isFlagLike(value)) {
        return { ok: false, code: 'MISSING_CONFIRM_VALUE' }
      }
      seen.confirm += 1
      confirm = value
      i += 2
      continue
    }
  }

  if (seen.inspect > 1) return { ok: false, code: 'DUPLICATE_INSPECT' }
  if (seen.apply > 1) return { ok: false, code: 'DUPLICATE_APPLY' }
  if (seen.target > 1) return { ok: false, code: 'DUPLICATE_TARGET' }
  if (seen.confirm > 1) return { ok: false, code: 'DUPLICATE_CONFIRM' }

  if (inspect && (target !== null || apply || confirm !== null)) {
    return { ok: false, code: 'INSPECT_CONFLICT' }
  }

  // --confirm is only meaningful as part of a full apply request
  // (--target ... --apply --confirm meal-photos). Any occurrence of
  // --confirm without --apply (whether alone, with --target only, or any
  // other combination not already rejected above) must be rejected
  // explicitly rather than silently downgraded to inspect/dry-run.
  if (confirm !== null && !apply) {
    return { ok: false, code: 'STRAY_CONFIRM' }
  }

  if (!apply) {
    if (target === null) {
      return { ok: true, options: { action: 'inspect' } }
    }
    return { ok: true, options: { action: 'dry-run', target } }
  }

  // --apply was given: target and a correct --confirm are both mandatory.
  if (target === null) {
    return { ok: false, code: 'APPLY_REQUIRES_TARGET' }
  }
  if (confirm === null) {
    return { ok: false, code: 'APPLY_REQUIRES_CONFIRM' }
  }
  if (confirm !== REQUIRED_CONFIRM_VALUE) {
    return { ok: false, code: 'INVALID_CONFIRM_VALUE' }
  }

  return { ok: true, options: { action: 'apply', target, confirm } }
}

const CLI_ERROR_MESSAGES = {
  UNKNOWN_ARGUMENT: 'Unknown command-line argument.',
  INVALID_TARGET_VALUE: '--target requires a value of "private" or "public".',
  CONFLICTING_TARGET: 'Conflicting --target values were specified.',
  DUPLICATE_TARGET: 'Duplicate --target flag.',
  DUPLICATE_APPLY: 'Duplicate --apply flag.',
  DUPLICATE_INSPECT: 'Duplicate --inspect flag.',
  DUPLICATE_CONFIRM: 'Duplicate --confirm flag.',
  MISSING_CONFIRM_VALUE: `--confirm requires a value ("${REQUIRED_CONFIRM_VALUE}").`,
  INSPECT_CONFLICT: '--inspect cannot be combined with --target/--apply/--confirm.',
  STRAY_CONFIRM: '--confirm is only valid together with --target and --apply.',
  APPLY_REQUIRES_TARGET: '--apply requires --target private|public.',
  APPLY_REQUIRES_CONFIRM: `--apply requires --confirm "${REQUIRED_CONFIRM_VALUE}".`,
  INVALID_CONFIRM_VALUE: `--confirm value must be exactly "${REQUIRED_CONFIRM_VALUE}".`,
}

/** codeを固定のsanitized文言へ変換する。ユーザー入力値は一切含まれない。 */
export function describeCliError(code) {
  return CLI_ERROR_MESSAGES[code] ?? 'Invalid command-line arguments.'
}

// --- bucket snapshot validation ---------------------------------------------

function classifyFileSizeLimit(value) {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (typeof value === 'number' && Number.isFinite(value)) return 'value'
  return 'invalid'
}

function classifyAllowedMimeTypes(value) {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return 'value'
  return 'invalid'
}

/**
 * getBucket()相当の戻り値を検証し、file size limit／allowed MIME typesが
 * 「欠落(missing／undefined)」「明示null（制限なしという有意味な設定）」
 * 「正常値」のいずれであるかを区別して返す。型不正・bucket不一致は常にinvalid。
 * inputはmutationしない（読み取りのみ）。
 */
export function validateBucketSnapshot(bucket, expectedId) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    return { valid: false, reason: 'NOT_AN_OBJECT' }
  }
  if (typeof bucket.id !== 'string' || bucket.id !== expectedId) {
    return { valid: false, reason: 'ID_MISMATCH' }
  }
  // name はSDK契約上必須とは限らないため、存在する場合のみ一致を要求する。
  if (bucket.name !== undefined && bucket.name !== expectedId) {
    return { valid: false, reason: 'NAME_MISMATCH' }
  }
  if (typeof bucket.public !== 'boolean') {
    return { valid: false, reason: 'PUBLIC_INVALID' }
  }

  const fileSizeLimitState = classifyFileSizeLimit(bucket.file_size_limit)
  if (fileSizeLimitState === 'invalid') {
    return { valid: false, reason: 'FILE_SIZE_LIMIT_INVALID' }
  }

  const allowedMimeTypesState = classifyAllowedMimeTypes(bucket.allowed_mime_types)
  if (allowedMimeTypesState === 'invalid') {
    return { valid: false, reason: 'ALLOWED_MIME_TYPES_INVALID' }
  }

  return {
    valid: true,
    id: bucket.id,
    public: bucket.public,
    fileSizeLimitState,
    allowedMimeTypesState,
  }
}

const SNAPSHOT_ERROR_MESSAGES = {
  NOT_AN_OBJECT: 'Bucket response is not a valid object.',
  ID_MISMATCH: 'Bucket id does not match the expected bucket.',
  NAME_MISMATCH: 'Bucket name does not match the expected bucket.',
  PUBLIC_INVALID: 'Bucket "public" field is not a boolean.',
  FILE_SIZE_LIMIT_INVALID: 'Bucket file size limit field has an unexpected type.',
  ALLOWED_MIME_TYPES_INVALID: 'Bucket allowed MIME types field has an unexpected type.',
}

/** reasonを固定のsanitized文言へ変換する。bucket応答の実値は一切含まれない。 */
export function describeSnapshotError(reason) {
  return SNAPSHOT_ERROR_MESSAGES[reason] ?? 'Bucket snapshot could not be validated.'
}

/**
 * apply（実更新）を行ってよいだけの完全性を備えているか。
 * file_size_limit／allowed_mime_typesのいずれかが「欠落(missing)」の場合は、
 * public値が既に目的の状態（no-op）であっても常にfalseを返す
 * （no-op判定より前にfail-closedで弾くため）。
 */
export function isSnapshotCompleteForApply(validated) {
  return validated.valid === true
    && validated.fileSizeLimitState !== 'missing'
    && validated.allowedMimeTypesState !== 'missing'
}

/**
 * ログへ出してよい範囲だけを取り出したsanitized summary。
 * URL・secret・実際のfile size limit数値・allowed MIME typesの内容は含めない。
 * fileSizeLimitStatus／allowedMimeTypesStatusは 'missing'|'null'|'value' のいずれか。
 */
export function summarizeBucketSnapshot(validated) {
  if (!validated.valid) {
    return { valid: false }
  }
  return {
    valid: true,
    public: validated.public,
    fileSizeLimitStatus: validated.fileSizeLimitState,
    allowedMimeTypesStatus: validated.allowedMimeTypesState,
    applyReady: isSnapshotCompleteForApply(validated),
  }
}

// --- no-op / update options --------------------------------------------------

/** targetPublicが現在のbucket.publicと既に一致しているか（更新不要＝no-op）。 */
export function isNoOpUpdate(bucket, targetPublic) {
  return bucket.public === targetPublic
}

/**
 * getBucket()の生の結果（snake_case）から、updateBucket()へ渡すoptions
 * （camelCase）を構築する。file_size_limit／allowed_mime_typesが厳密に
 * undefined（欠落）の場合はnullへ変換せず、呼び出し側の契約違反として例外を
 * 投げる（呼び出し側は事前にvalidateBucketSnapshot()／
 * isSnapshotCompleteForApply()で完全性を確認してから呼ぶこと）。明示的なnullは
 * そのままnullとして送信し（「制限なし」という現在の実設定を維持）、正常値は
 * そのまま維持する。呼び出し元のbucketオブジェクトはmutationしない。
 */
export function buildUpdateBucketOptions(bucket, targetPublic) {
  if (bucket.file_size_limit === undefined || bucket.allowed_mime_types === undefined) {
    throw new Error(
      'buildUpdateBucketOptions requires a complete bucket snapshot ' +
      '(file_size_limit and allowed_mime_types must not be undefined). ' +
      'Validate with validateBucketSnapshot()/isSnapshotCompleteForApply() first.'
    )
  }

  const allowedMimeTypes = bucket.allowed_mime_types === null
    ? null
    : [...bucket.allowed_mime_types]

  return {
    public: targetPublic,
    fileSizeLimit: bucket.file_size_limit,
    allowedMimeTypes,
  }
}

// --- MIME type comparison (order-independent, multiset) ---------------------

function toMultiset(arr) {
  const counts = new Map()
  for (const v of arr) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

function multisetsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false
  }
  return true
}

/**
 * allowed_mime_typesの意味的な同一性を判定する。要素の並び順は無視し、
 * 重複数（multiset）は維持して比較する。undefined／null／配列は互いに厳密に
 * 区別し、大文字小文字・前後空白の正規化は一切行わない（値そのままの完全一致）。
 * 入力配列はmutationしない。
 */
export function areAllowedMimeTypesEquivalent(a, b) {
  if (a === undefined || b === undefined) return a === undefined && b === undefined
  if (a === null || b === null) return a === null && b === null
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  return multisetsEqual(toMultiset(a), toMultiset(b))
}

function isFileSizeLimitEquivalent(a, b) {
  if (a === undefined || b === undefined) return a === undefined && b === undefined
  return a === b
}

/**
 * 更新前(before)／更新後(after)のbucket設定を比較し、public以外に変化した
 * フィールド名を返す。created_at／updated_atは比較対象外。file_size_limitは
 * undefined／null／値を区別して比較し、allowed_mime_typesは順序非依存の
 * multiset比較（要素追加・削除・重複数変化・null⇄空配列の違いはすべて検出する）。
 */
export function compareBucketConfig(before, after) {
  const differences = []
  if (before.id !== after.id) differences.push('id')
  if (before.name !== after.name) differences.push('name')
  if (!isFileSizeLimitEquivalent(before.file_size_limit, after.file_size_limit)) {
    differences.push('file_size_limit')
  }
  if (!areAllowedMimeTypesEquivalent(before.allowed_mime_types, after.allowed_mime_types)) {
    differences.push('allowed_mime_types')
  }
  return differences
}

/**
 * update後の検証。publicがtargetと一致し、かつpublic以外のフィールドに
 * 意図しない変化がないことを確認する。problemsには変化した項目名（値そのものは
 * 含まない）だけを返す。
 */
export function verifyBucketUpdate({ before, after, expectedPublic }) {
  const problems = []
  if (after.public !== expectedPublic) {
    problems.push('public')
  }
  for (const field of compareBucketConfig(before, after)) {
    problems.push(field)
  }
  return { ok: problems.length === 0, problems }
}

// --- operation-level (non-CLI, non-snapshot) error messages -----------------

const OPERATION_ERROR_MESSAGES = {
  ENV_MISSING: 'Required environment variables are missing.',
  ENV_URL_INVALID: 'The configured Supabase URL is not a valid http(s) URL.',
  CLIENT_INIT_FAILED: 'Failed to initialize the Supabase client.',
  BUCKET_FETCH_FAILED: 'Failed to fetch the bucket configuration.',
  BUCKET_NOT_APPLY_READY: 'The bucket configuration is missing fields required for a safe update. Refusing to apply.',
  UPDATE_FAILED: 'Failed to update the bucket configuration.',
  POST_UPDATE_FETCH_FAILED: 'Failed to re-fetch the bucket configuration after update. Manual verification is required.',
  POST_UPDATE_VERIFICATION_FAILED: 'Post-update verification detected an unexpected change. No automatic rollback was performed. Manual review is required.',
  UNEXPECTED_FAILURE: 'Bucket management failed.',
}

/** codeを固定のsanitized文言へ変換する。secret・URL・response実値は含まれない。 */
export function describeOperationError(code) {
  return OPERATION_ERROR_MESSAGES[code] ?? OPERATION_ERROR_MESSAGES.UNEXPECTED_FAILURE
}
