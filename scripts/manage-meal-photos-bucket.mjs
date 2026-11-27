/**
 * meal-photos bucket Public/Private切替 一回限りの管理script。
 *
 * 目的:
 *   Supabase Storage APIのgetBucket/updateBucketだけを使い、meal-photos bucketの
 *   public設定"だけ"を安全に変更する。storage.bucketsをSQLで直接更新しない。
 *
 * デフォルトはinspect（読み取り専用）。--target private/public を指定しても
 * --apply を付けない限り更新は一切行われない（dry-run）。実際に更新するには
 * --target・--apply・--confirm meal-photos のすべてが必要。file size limit・
 * allowed MIME typesのどちらかを取得できない（getBucket応答にfieldが存在しない）
 * 場合、applyはfail-closedで中止される（未確認の設定を推測でnull等に置き換えない）。
 *
 * 実行方法:
 *   node --env-file=.env.local scripts/manage-meal-photos-bucket.mjs
 *   node --env-file=.env.local scripts/manage-meal-photos-bucket.mjs --inspect
 *   node --env-file=.env.local scripts/manage-meal-photos-bucket.mjs --target private --apply --confirm meal-photos
 *   node --env-file=.env.local scripts/manage-meal-photos-bucket.mjs --target public --apply --confirm meal-photos
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase URL
 *   SUPABASE_SECRET_KEY       Supabase 管理キー（CLI引数では受け取らない）
 *
 * このscriptは次を一切行わない: Storage object一覧取得・upload・download・
 * delete、DB query、Storage policy変更、SQL実行、migration適用、
 * Vercel／GitHub操作。
 *
 * ログには固定のsanitized文言だけを出力する。URL実値・secret・SDK response全文・
 * error object／message／stack・ユーザーが渡した不明なCLI引数の実値は、
 * いかなる経路でも出力しない。
 */

import { createClient } from '@supabase/supabase-js'
import { pathToFileURL } from 'node:url'
import {
  MEAL_PHOTOS_BUCKET_ID,
  parseCliArgs,
  describeCliError,
  validateBucketSnapshot,
  describeSnapshotError,
  summarizeBucketSnapshot,
  isNoOpUpdate,
  buildUpdateBucketOptions,
  verifyBucketUpdate,
  describeOperationError,
} from './lib/meal-photos-bucket-config.mjs'

function describeFieldStatus(status) {
  if (status === 'missing') return '確認できません'
  if (status === 'null') return '未設定（制限なし）'
  if (status === 'value') return '設定済み'
  return '不明'
}

function logSummary(label, summary) {
  console.log(`${label}:`)
  console.log(`  public: ${summary.public}`)
  console.log(`  file size limit: ${describeFieldStatus(summary.fileSizeLimitStatus)}`)
  console.log(`  allowed MIME types: ${describeFieldStatus(summary.allowedMimeTypesStatus)}`)
}

/** http(s)以外・parse不能なURLを拒否する。戻り値・引数のURL実値はログへ出さない。 */
function isValidSupabaseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * getBucket + snapshot検証をまとめて行う。
 * 戻り値: { ok: true, bucket, validated } | { ok: false, code, reason? }
 */
async function fetchAndValidateBucket(supabase) {
  let bucket
  try {
    const { data, error } = await supabase.storage.getBucket(MEAL_PHOTOS_BUCKET_ID)
    if (error || !data) {
      return { ok: false, code: 'BUCKET_FETCH_FAILED' }
    }
    bucket = data
  } catch {
    return { ok: false, code: 'BUCKET_FETCH_FAILED' }
  }

  const validated = validateBucketSnapshot(bucket, MEAL_PHOTOS_BUCKET_ID)
  if (!validated.valid) {
    return { ok: false, code: 'SNAPSHOT_INVALID', reason: validated.reason }
  }

  return { ok: true, bucket, validated }
}

function reportFetchFailure(fetched) {
  if (fetched.code === 'SNAPSHOT_INVALID') {
    console.error(`❌ ${describeSnapshotError(fetched.reason)}`)
  } else {
    console.error(`❌ ${describeOperationError(fetched.code)}`)
  }
}

async function runMain(argv) {
  const parsed = parseCliArgs(argv)
  if (!parsed.ok) {
    console.error(`❌ ${describeCliError(parsed.code)}`)
    return 1
  }
  const { options } = parsed

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const rawKey = process.env.SUPABASE_SECRET_KEY
  const supabaseUrl = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  const supabaseKey = typeof rawKey === 'string' ? rawKey.trim() : ''

  if (!supabaseUrl || !supabaseKey) {
    console.error(`❌ ${describeOperationError('ENV_MISSING')}`)
    return 1
  }

  if (!isValidSupabaseUrl(supabaseUrl)) {
    console.error(`❌ ${describeOperationError('ENV_URL_INVALID')}`)
    return 1
  }

  let supabase
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  } catch {
    console.error(`❌ ${describeOperationError('CLIENT_INIT_FAILED')}`)
    return 1
  }

  const fetched = await fetchAndValidateBucket(supabase)
  if (!fetched.ok) {
    reportFetchFailure(fetched)
    return 1
  }
  const { bucket, validated } = fetched
  const summary = summarizeBucketSnapshot(validated)

  if (options.action === 'inspect') {
    console.log(`[inspect] ${MEAL_PHOTOS_BUCKET_ID}（読み取り専用、更新なし）`)
    logSummary('現在の設定', summary)
    if (!summary.applyReady) {
      console.log('一部の設定を確認できません。applyが可能とは断定しません。')
    }
    return 0
  }

  const targetPublic = options.target === 'public'

  if (options.action === 'dry-run') {
    console.log(`[dry-run] target=${options.target}（更新なし。実行するには --apply --confirm ${MEAL_PHOTOS_BUCKET_ID} が必要）`)
    logSummary('現在の設定', summary)
    console.log(`更新予定のpublic値: ${targetPublic}`)
    if (!summary.applyReady) {
      console.log('一部の設定を確認できないため、現時点ではapplyできません（追加確認が必要）。')
    } else if (isNoOpUpdate(bucket, targetPublic)) {
      console.log('現在の設定は既に目的の状態です（更新すればno-op）')
    }
    return 0
  }

  // options.action === 'apply'
  if (!summary.applyReady) {
    console.error(`❌ ${describeOperationError('BUCKET_NOT_APPLY_READY')}`)
    return 1
  }

  if (isNoOpUpdate(bucket, targetPublic)) {
    console.log(`[apply] 現在の設定は既にpublic=${targetPublic}です。更新は行いません（no-op）。`)
    return 0
  }

  console.log(`[apply] ${MEAL_PHOTOS_BUCKET_ID} のpublicを ${bucket.public} → ${targetPublic} へ更新します`)

  let updateOptions
  try {
    updateOptions = buildUpdateBucketOptions(bucket, targetPublic)
  } catch {
    // applyReadyゲートを通過していれば到達しないはずだが、防御的にfail-closed。
    console.error(`❌ ${describeOperationError('BUCKET_NOT_APPLY_READY')}`)
    return 1
  }

  let updateOk = false
  try {
    const { error: updateError } = await supabase.storage.updateBucket(MEAL_PHOTOS_BUCKET_ID, updateOptions)
    updateOk = !updateError
  } catch {
    updateOk = false
  }
  if (!updateOk) {
    console.error(`❌ ${describeOperationError('UPDATE_FAILED')}`)
    return 1
  }

  const afterFetched = await fetchAndValidateBucket(supabase)
  if (!afterFetched.ok) {
    console.error(`❌ ${describeOperationError('POST_UPDATE_FETCH_FAILED')}`)
    return 1
  }

  const verification = verifyBucketUpdate({ before: bucket, after: afterFetched.bucket, expectedPublic: targetPublic })
  if (!verification.ok) {
    console.error(`❌ ${describeOperationError('POST_UPDATE_VERIFICATION_FAILED')}`)
    return 1
  }

  console.log(`✅ ${MEAL_PHOTOS_BUCKET_ID} を public=${targetPublic} へ更新しました`)
  logSummary('更新後の設定', summarizeBucketSnapshot(afterFetched.validated))
  return 0
}

/**
 * main()自体は絶対にrejectしない。想定外の例外はここで確実に捕捉し、
 * 固定のsanitized文言だけを表示してnon-zeroを返す（error object・message・
 * stack・SDK response・URL・headerはいずれも表示しない）。
 */
export async function main(argv) {
  try {
    return await runMain(argv)
  } catch {
    console.error(`❌ ${describeOperationError('UNEXPECTED_FAILURE')}`)
    return 1
  }
}

const isMainModule = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  // main()は上記の通り内部で全例外を捕捉し値を返すのみで設計されているが、
  // CLI直接実行時の安全網として、念のためtop-levelでも.catch()する。
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch(() => {
      console.error(`❌ ${describeOperationError('UNEXPECTED_FAILURE')}`)
      process.exitCode = 1
    })
}
