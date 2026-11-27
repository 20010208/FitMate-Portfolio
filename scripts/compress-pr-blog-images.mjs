/**
 * blog-images バケット内、PR/アフィリエイト記事のサムネイルPNGをWebPへ圧縮し、
 * 新規objectとしてアップロードしたうえで blogs.og_image を更新するスクリプト。
 *
 * このスクリプトの位置づけ:
 *   通常記事31件用の compress-blog-images.mjs とは意図的に完全分離した、
 *   PR/アフィリエイト記事専用の独立スクリプトである。通常toolは
 *   "<slug>.png" というroot-level固定命名を前提に設計されているが、
 *   PR記事のサムネイルは "PR-post/<slug>.png" や
 *   "PR-post/Reveria/<slug>.png" のようなnested Storage pathを使用しており、
 *   通常toolのままでは処理できない（実PR reconで確認済み）。
 *   通常toolへ変更を加えると、既に完了した31件の安全実績に触れることになる
 *   ため、compress-blog-images.mjs は一切変更せず、本ファイルのみを新規追加する。
 *
 * 設計方針（PM承認: Option A + Option C）:
 *   - Option C: 通常記事用toolとは別ファイルとして完全に独立させる
 *     （コード重複は許容する。DRY化のための共有リファクタは行わない —
 *     安全性・隔離性をDRYより優先する）
 *   - Option A: 処理対象slug→exact source Storage pathは、
 *     このファイル内の静的allowlist（PR_SOURCE_ALLOWLIST）でのみ許可する。
 *     Production行の現在の og_image や、バケット内容の動的discoveryから
 *     source/destination pathを推測・導出することは一切行わない。
 *   - 二重確認方式: allowlistのexact source pathからexpected og_image URLを
 *     構築し、Production行の現在の og_image がその期待値と完全一致することを
 *     実行時に確認してからでなければ処理を進めない（DBの値がpathを
 *     決定することはない。DBはあくまで「想定どおりの状態か」の確認にのみ使う）。
 *
 * このファイルが処理できるslugは、PR_SOURCE_ALLOWLIST に列挙された
 * 正確に6件のみである。CLI引数・環境変数を問わず、それ以外のslugや、
 * 任意のpath/URLを引数として受け付ける経路は存在しない。
 *
 * 通常toolと同一の安全機構を維持する:
 *   - 既存の "<path>.png" は一切上書きしない。"<path>.webp" を
 *     新規objectとしてのみ作成する。同名objectが既に存在する場合は
 *     アップロードせずskipする（upsertしない）。
 *   - アップロード前に、圧縮後webpが実際に十分小さいこと
 *     （元pngの70%未満）・有効なwebp画像であること（sharpで再decode
 *     できること）を確認する。満たさない場合はそのslugをskipする。
 *   - アップロード成功後・DB更新前に、Storage APIのdownload()で
 *     アップロード済みobjectを直接再取得し、実際に保存された内容が
 *     webp形式・想定どおりの寸法・アップロードしたbufferとbyte長および
 *     SHA-256が完全一致することを確認してからでなければDB更新へ進まない。
 *   - DB更新は対象slugのblogs行のみ、かつog_imageが更新直前の時点で
 *     まだallowlistのexact source pathを指す公開URLであり、かつ
 *     is_published=trueである場合のみ行う（CAS）。UPDATE payloadに
 *     含まれるカラムは og_image のみ。記事本文・title・description・
 *     category・slug・published_at・is_published・created_at・
 *     アフィリエイトURL等は一切変更しない。
 *   - 元のsource object（PNG）は一切削除しない。削除/remove呼び出しの
 *     コードパスは存在しない。
 *
 * 実行方法（ローカル・手動。Production実行はこのタスクの対象外）:
 *   node --env-file=.env.local scripts/compress-pr-blog-images.mjs <slug1> <slug2> ...
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase URL
 *   SUPABASE_SECRET_KEY       Supabase 管理キー
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const BUCKET = 'blog-images'
const MAX_WIDTH = 1200
const WEBP_QUALITY = 80
const MAX_COMPRESSED_RATIO = 0.7

const PR_PREFIX = 'PR-post/'
const PATH_CHAR_PATTERN = /^[A-Za-z0-9/_.-]+$/

/**
 * PR記事の対象slugと、そのexact Storage source pathの静的allowlist。
 * PR/affiliate recon（Production read-only調査）で確認した現在の
 * Production og_imageと完全一致する経路のみを列挙している。
 *
 * 新しいPR記事を追加する場合は、事前にProduction側の実際のog_imageを
 * 確認したうえでこの配列へ手動で追記すること。バケット内容からの
 * 自動discoveryは意図的に行わない。
 */
export const PR_SOURCE_ALLOWLIST = [
  {
    slug: 'reveria-recovery-mattress-features-price',
    sourcePath: 'PR-post/Reveria/reveria-recovery-mattress-features-price.png',
  },
  {
    slug: 'tria-4x-features-how-to-use-price',
    sourcePath: 'PR-post/tria-4x-features-how-to-use-price.png',
  },
  {
    slug: 'currentbody-led-multi-light-mask-features-how-to-use-price',
    sourcePath: 'PR-post/currentbody-led-multi-light-mask-features-how-to-use-price.png',
  },
  {
    slug: 'ziip-halo-features-how-to-use-price',
    sourcePath: 'PR-post/ziip-halo-features-how-to-use-price.png',
  },
  {
    slug: 'compact-bakery-diet-sweets-homemade',
    sourcePath: 'PR-post/compact-bakery-diet-sweets-homemade.png',
  },
  {
    slug: 'home-iced-coffee-training-diet-benefits',
    sourcePath: 'PR-post/home-iced-coffee-training-diet-benefits.png',
  },
]

export const PR_SOURCE_MAP = new Map(PR_SOURCE_ALLOWLIST.map((e) => [e.slug, e.sourcePath]))

/**
 * allowlist由来のsource pathであっても盲目的に信用しない防御的検証。
 * Storage操作（download/list/upload）へ渡す前に必ずこれを通す。
 *
 * 許可する形:
 *   - "PR-post/" で始まる
 *   - ".png" で終わる
 *   - "..", "\\", "//", 先頭/末尾の "/" を含まない
 *   - 空のpath segmentを含まない
 *   - 英数字・"/"・"_"・"."・"-" 以外の文字を含まない
 */
export function validateSourcePath(sourcePath) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    return { valid: false, reason: 'empty_path' }
  }
  if (!sourcePath.startsWith(PR_PREFIX)) {
    return { valid: false, reason: 'must_start_with_pr_post_prefix' }
  }
  if (!sourcePath.endsWith('.png')) {
    return { valid: false, reason: 'must_end_with_png' }
  }
  if (sourcePath.includes('..')) {
    return { valid: false, reason: 'path_traversal_rejected' }
  }
  if (sourcePath.includes('\\')) {
    return { valid: false, reason: 'backslash_rejected' }
  }
  if (sourcePath.startsWith('/') || sourcePath.endsWith('/')) {
    return { valid: false, reason: 'invalid_leading_or_trailing_slash' }
  }
  if (sourcePath.split('/').some((segment) => segment.length === 0)) {
    return { valid: false, reason: 'empty_path_segment' }
  }
  if (!PATH_CHAR_PATTERN.test(sourcePath)) {
    return { valid: false, reason: 'invalid_characters' }
  }
  return { valid: true }
}

/**
 * 検証済みのsource pathから、同一ディレクトリ・同一basenameを保ったまま
 * 拡張子のみ ".png" → ".webp" に置換したdestination pathを導出する純粋関数。
 * source pathがvalidateSourcePath()を通らない場合は null を返す
 * （呼び出し側は必ずnullチェックし、CLI引数等からdestinationを自由に
 * 組み立てられる経路は存在しない）。
 */
export function deriveWebpPath(sourcePath) {
  const check = validateSourcePath(sourcePath)
  if (!check.valid) return null
  return `${sourcePath.slice(0, -'.png'.length)}.webp`
}

/** バケット内objectの公開URLを構築する純粋関数。通常toolと同一の構築規則。 */
export function buildPublicObjectUrl(supabaseUrl, bucket, path) {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * CLI引数から対象slugリストを決定する純粋関数。
 * PR_SOURCE_ALLOWLISTに存在するslugのみを許可する（allowlist方式）。
 * 引数なし・未知slug・バケット全体/ワイルドカード指定は、いずれも
 * 無効として拒否し、Production側への読み書きへ一切進まない。
 */
export function resolveTargetSlugs(argv = process.argv) {
  const cliSlugs = argv.slice(2).map((s) => s.trim()).filter(Boolean)
  if (cliSlugs.length === 0) {
    return { valid: false, reason: 'no_target_slugs_specified', slugs: [] }
  }

  const unique = [...new Set(cliSlugs)]

  const unknown = unique.filter((s) => !PR_SOURCE_MAP.has(s))
  if (unknown.length > 0) {
    return { valid: false, reason: 'unknown_slug', unknownSlugs: unknown, slugs: [] }
  }

  return { valid: true, slugs: unique }
}

export async function processSlug({ supabase, supabaseUrl, slug }) {
  const sourcePath = PR_SOURCE_MAP.get(slug)
  if (!sourcePath) {
    console.error(`❌ [${slug}] allowlistに存在しないslugのためskip`)
    return { slug, ok: false, reason: 'unknown_slug' }
  }

  // allowlist由来であっても、Storageへ触れる前に必ず再検証する（防御的多層防御）。
  const pathCheck = validateSourcePath(sourcePath)
  if (!pathCheck.valid) {
    console.error(`❌ [${slug}] allowlistのsource pathが検証に失敗: ${pathCheck.reason}`)
    return { slug, ok: false, reason: `invalid_allowlist_path:${pathCheck.reason}` }
  }
  const webpPath = deriveWebpPath(sourcePath)
  if (!webpPath) {
    console.error(`❌ [${slug}] destination pathの導出に失敗`)
    return { slug, ok: false, reason: 'destination_path_derivation_failed' }
  }

  const expectedCurrentOgImage = buildPublicObjectUrl(supabaseUrl, BUCKET, sourcePath)

  // ── DB行の存在・状態確認（Production og_imageがallowlistの想定値と
  //    完全一致する場合のみ処理を進める。二重確認方式のうち「確認」側）──
  const { data: rows, error: rowErr } = await supabase
    .from('blogs')
    .select('id, slug, og_image, is_published')
    .eq('slug', slug)
  if (rowErr) {
    console.error(`❌ [${slug}] blogs行の取得に失敗: ${rowErr.message}`)
    return { slug, ok: false, reason: 'db_select_failed' }
  }
  if (rows.length !== 1) {
    console.error(`❌ [${slug}] blogs行が見つからない、または複数件(${rows.length}件)`)
    return { slug, ok: false, reason: 'row_not_found_or_ambiguous' }
  }
  const row = rows[0]
  if (!row.is_published) {
    console.warn(`⚠️  [${slug}] is_published=falseのためskip`)
    return { slug, ok: false, reason: 'not_published' }
  }
  if (row.og_image !== expectedCurrentOgImage) {
    console.warn(`⚠️  [${slug}] og_imageがallowlistの想定と異なるためskip: ${row.og_image}`)
    return { slug, ok: false, reason: 'og_image_unexpected' }
  }

  // ── 既存.webpが既にあるなら上書きせずskip ──────────────────────────
  // nested pathに対応するため、list()は該当ディレクトリを対象に実行する
  // （root ''ではなくwebpPathの親ディレクトリを渡す）。listのerrorは
  // fail-closed（即座にそのslugを失敗させ、uploadへ進まない）とする。
  const lastSlashIdx = webpPath.lastIndexOf('/')
  const destDir = lastSlashIdx === -1 ? '' : webpPath.slice(0, lastSlashIdx)
  const destBasename = lastSlashIdx === -1 ? webpPath : webpPath.slice(lastSlashIdx + 1)
  const { data: existingWebp, error: listErr } = await supabase.storage.from(BUCKET).list(destDir, {
    search: destBasename,
  })
  if (listErr) {
    console.error(`❌ [${slug}] ${webpPath}の存在確認(list)に失敗: ${listErr.message}`)
    return { slug, ok: false, reason: 'destination_check_failed' }
  }
  if (existingWebp?.some((f) => f.name === destBasename)) {
    console.warn(`⚠️  [${slug}] ${webpPath} は既に存在するためskip（上書きしない）`)
    return { slug, ok: false, reason: 'webp_already_exists' }
  }

  // ── 元PNGのダウンロード ──────────────────────────────────────────────
  const { data: pngBlob, error: dlErr } = await supabase.storage.from(BUCKET).download(sourcePath)
  if (dlErr) {
    console.error(`❌ [${slug}] ${sourcePath} のダウンロードに失敗: ${dlErr.message}`)
    return { slug, ok: false, reason: 'download_failed' }
  }
  const original = Buffer.from(await pngBlob.arrayBuffer())
  const originalSize = original.byteLength

  // ── WebP圧縮（通常toolと同一設定）───────────────────────────────────
  let compressed
  try {
    compressed = await sharp(original)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()
  } catch (err) {
    console.error(`❌ [${slug}] webp変換に失敗: ${err.message}`)
    return { slug, ok: false, reason: 'compression_failed' }
  }
  const compressedSize = compressed.byteLength

  // ── アップロード前の安全確認 ─────────────────────────────────────────
  if (compressedSize >= originalSize * MAX_COMPRESSED_RATIO) {
    console.error(`❌ [${slug}] 圧縮効果が不十分（${originalSize}B → ${compressedSize}B）のためskip`)
    return { slug, ok: false, reason: 'insufficient_compression' }
  }
  let metadata
  try {
    metadata = await sharp(compressed).metadata()
  } catch (err) {
    console.error(`❌ [${slug}] 生成したwebpの再検証に失敗: ${err.message}`)
    return { slug, ok: false, reason: 'output_verification_failed' }
  }
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
    console.error(`❌ [${slug}] 生成物が有効なwebp画像ではない`)
    return { slug, ok: false, reason: 'invalid_output_image' }
  }

  // ── 新規objectとしてアップロード（upsertしない）───────────────────────
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(webpPath, compressed, {
    contentType: 'image/webp',
    upsert: false,
  })
  if (upErr) {
    console.error(`❌ [${slug}] ${webpPath} のアップロードに失敗: ${upErr.message}`)
    return { slug, ok: false, reason: 'upload_failed' }
  }

  // ── アップロード後のremote object再検証（DB更新より必ず前）──────────────
  const { data: remoteBlob, error: remoteDlErr } = await supabase.storage.from(BUCKET).download(webpPath)
  if (remoteDlErr) {
    console.error(`❌ [${slug}] アップロード直後のremote object再取得に失敗: ${remoteDlErr.message}`)
    return { slug, ok: false, reason: 'remote_download_failed' }
  }
  const remoteBuffer = Buffer.from(await remoteBlob.arrayBuffer())
  if (remoteBuffer.byteLength === 0) {
    console.error(`❌ [${slug}] remote objectが空`)
    return { slug, ok: false, reason: 'remote_webp_invalid' }
  }
  let remoteMetadata
  try {
    remoteMetadata = await sharp(remoteBuffer).metadata()
  } catch (err) {
    console.error(`❌ [${slug}] remote objectのdecodeに失敗: ${err.message}`)
    return { slug, ok: false, reason: 'remote_webp_invalid' }
  }
  if (remoteMetadata.format !== 'webp' || !remoteMetadata.width || !remoteMetadata.height) {
    console.error(`❌ [${slug}] remote objectが有効なwebp画像ではない`)
    return { slug, ok: false, reason: 'remote_webp_format_mismatch' }
  }
  if (remoteMetadata.width !== metadata.width || remoteMetadata.height !== metadata.height) {
    console.error(`❌ [${slug}] remote objectの寸法(${remoteMetadata.width}x${remoteMetadata.height})がlocal生成物(${metadata.width}x${metadata.height})と不一致`)
    return { slug, ok: false, reason: 'remote_webp_dimension_mismatch' }
  }
  if (remoteBuffer.byteLength !== compressed.byteLength) {
    console.error(`❌ [${slug}] remote objectのbyte長(${remoteBuffer.byteLength})がuploadしたbuffer(${compressed.byteLength})と不一致`)
    return { slug, ok: false, reason: 'remote_webp_size_mismatch' }
  }
  const localHash = createHash('sha256').update(compressed).digest('hex')
  const remoteHash = createHash('sha256').update(remoteBuffer).digest('hex')
  if (localHash !== remoteHash) {
    console.error(`❌ [${slug}] remote objectのSHA-256がuploadしたbufferと不一致`)
    return { slug, ok: false, reason: 'remote_webp_hash_mismatch' }
  }

  const newOgImage = buildPublicObjectUrl(supabaseUrl, BUCKET, webpPath)

  // ── DB更新（remote検証に成功した場合のみ。id+slug+og_image+is_published限定、
  //    UPDATE payloadは og_image のみ）────────────────────────────────
  const { data: updated, error: updateErr } = await supabase
    .from('blogs')
    .update({ og_image: newOgImage })
    .eq('id', row.id)
    .eq('slug', slug)
    .eq('og_image', expectedCurrentOgImage)
    .eq('is_published', true)
    .select('id, slug, og_image')

  if (updateErr) {
    console.error(`❌ [${slug}] og_image更新に失敗（webpは${webpPath}としてアップロード済み）: ${updateErr.message}`)
    return { slug, ok: false, reason: 'db_update_failed' }
  }
  if (updated.length !== 1) {
    console.error(`❌ [${slug}] og_image更新のaffected rowsが1件ではない(${updated.length}件)`)
    return { slug, ok: false, reason: 'db_update_row_count_mismatch' }
  }

  console.log(`✅ [${slug}] ${originalSize}B → ${compressedSize}B (${Math.round((1 - compressedSize / originalSize) * 100)}%削減) → ${webpPath} → og_image更新完了`)
  return { slug, ok: true, originalSize, compressedSize, sourcePath, webpPath, newOgImage }
}

/**
 * 通常toolと同一ルール: 1件でも失敗があればbatch全体を非ゼロで終了させる
 * （成功したslugのStorage/DB変更をrollbackする必要はない）。
 */
export function resolveBatchExitCode({ failed }) {
  return failed > 0 ? 1 : 0
}

export async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_ADMIN_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()

  if (!SUPABASE_URL || !SUPABASE_ADMIN_KEY) {
    console.error('❌ 必要な環境変数が不足しています: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY')
    return 1
  }

  const targetResult = resolveTargetSlugs()
  if (!targetResult.valid) {
    console.error(`❌ 対象slugが指定されていない、または不正です（reason: ${targetResult.reason}）`)
    if (targetResult.unknownSlugs) {
      console.error(`   未許可のslug: ${targetResult.unknownSlugs.join(', ')}`)
    }
    console.error('   使い方: node scripts/compress-pr-blog-images.mjs <slug1> <slug2> ...')
    console.error(`   許可されるslugは以下の${PR_SOURCE_ALLOWLIST.length}件のみです: ${PR_SOURCE_ALLOWLIST.map((e) => e.slug).join(', ')}`)
    return 1
  }

  console.log(`📦 対象slug（PR/affiliate）: ${targetResult.slugs.length}件`)
  console.log(`   ${targetResult.slugs.join(', ')}`)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY)

  const results = []
  for (const slug of targetResult.slugs) {
    results.push(await processSlug({ supabase, supabaseUrl: SUPABASE_URL, slug }))
  }

  const succeeded = results.filter((r) => r.ok).length
  const failed = results.length - succeeded
  console.log('')
  console.log(`🎉 完了: 成功 ${succeeded}件 / skip・失敗 ${failed}件`)
  if (failed > 0) {
    console.error(`❌ ${failed}件が失敗またはskipされました。成功した${succeeded}件はそのまま反映済みです。`)
  }

  return resolveBatchExitCode({ succeeded, failed })
}

const isMainModule = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      console.error('❌ 予期しないエラー:', err?.message ?? String(err))
      process.exitCode = 1
    })
}
