/**
 * blog-images バケット内、指定slugのサムネイルPNGをWebPへ圧縮し、
 * 新規objectとしてアップロードしたうえで blogs.og_image を更新するスクリプト。
 *
 * 運用監査 修正（旧版の問題点）:
 *   旧版は blog-images バケット直下を無条件に list() し、見つかった全ての
 *   png/jpg/jpeg/webp を対象にしていた（PR記事用画像・infographic等、
 *   対象外ファイルも巻き込む）。さらに圧縮結果を同一pathへ
 *   upload(path, compressed, { upsert: true }) で上書きしており、元PNGを
 *   破壊しうる危険な処理だった。加えて出力形式は実際には
 *   png()/jpeg() の再encodeのみで、ファイル名が ".webp" になる出力を
 *   一切生成していなかった（このrepoの既存 "<slug>.webp" 命名規則とは
 *   無関係）。DB blogs.og_image の更新も行っていなかった。
 *
 * 新版の設計:
 *   - 処理対象は呼び出し側が明示するslugのみ（CLI引数、または
 *     THUMBNAIL_TARGET_SLUGS環境変数）。バケット全体のscan・
 *     「webpが無いpngを自動検出して全部処理する」ような自動対象拡大は
 *     行わない（対象外ファイルへの誤爆を避けるため、明示allowlist方式に
 *     限定する）。
 *   - 既存の "<slug>.png" は一切上書きしない。"<slug>.webp" を
 *     新規objectとしてのみ作成する。同名objectが既に存在する場合は
 *     アップロードせずskipする（upsertしない）。
 *   - アップロード前に、圧縮後webpが実際に十分小さいこと
 *     （元pngの70%未満）・有効なwebp画像であること（sharpで再decode
 *     できること）を確認する。満たさない場合はそのslugをskipする。
 *   - アップロード成功後・DB更新前に、Storage APIのdownload()で
 *     アップロード済みobjectを直接再取得し（公開CDN URL経由のGETは
 *     キャッシュ挙動が絡み検証としての信頼性が下がるため使わない）、
 *     実際に保存された内容がwebp形式・想定どおりの寸法・アップロードした
 *     bufferとbyte長およびSHA-256が完全一致することを確認してからでなければ
 *     DB更新へ進まない（Codex監査 修正）。
 *   - DB更新は対象slugのblogs行のみ、かつog_imageが更新直前の時点で
 *     まだ "<slug>.png" の公開URLを指しており、かつis_published=trueである
 *     場合のみ行う（既に別のURLへ変更されていた、または処理中に
 *     unpublishedへ変更されていた場合はskipし、上書きしない）。
 *
 * 実行方法（ローカル・手動）:
 *   node --env-file=.env.local scripts/compress-blog-images.mjs <slug1> <slug2> ...
 *
 * 実行方法（GitHub Actions workflow_dispatch）:
 *   THUMBNAIL_TARGET_SLUGS環境変数（カンマ区切り）経由でslugを渡す。
 *   workflow_dispatchのinput文字列をshell commandへ直接展開せず、
 *   env:経由でのみ渡す（auto-blog.ymlのAUTO_BLOG_KEYWORDと同じ規約）。
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase URL
 *   SUPABASE_SECRET_KEY       Supabase 管理キー
 *   THUMBNAIL_TARGET_SLUGS    (省略可) 対象slugのカンマ区切りリスト。
 *                             CLI引数が指定されていればそちらを優先する。
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const BUCKET = 'blog-images'
const MAX_WIDTH = 1200
const WEBP_QUALITY = 80
// 圧縮後サイズが元pngの何割未満であれば「十分圧縮できた」とみなすか。
// 満たさない場合はアップロードせずskipする（圧縮に失敗している/既に
// 軽量な画像に誤って実行した、等の異常を検知するための閾値）。
const MAX_COMPRESSED_RATIO = 0.7

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * CLI引数またはTHUMBNAIL_TARGET_SLUGS環境変数から対象slugリストを決定する
 * 純粋関数。CLI引数が1件以上あればそちらを優先する。
 * 引数なし・環境変数なしの場合はvalid:falseで返す（デフォルトで
 * 「バケット全体」等の広い対象へフォールバックすることは絶対にしない）。
 */
export function resolveTargetSlugs(argv = process.argv, env = process.env) {
  const cliSlugs = argv.slice(2).map((s) => s.trim()).filter(Boolean)
  const source = cliSlugs.length > 0
    ? cliSlugs
    : (env.THUMBNAIL_TARGET_SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean)

  if (source.length === 0) {
    return { valid: false, reason: 'no_target_slugs_specified', slugs: [] }
  }

  const invalid = source.filter((s) => !SLUG_PATTERN.test(s))
  if (invalid.length > 0) {
    return { valid: false, reason: 'invalid_slug_format', invalidSlugs: invalid, slugs: [] }
  }

  const unique = [...new Set(source)]
  return { valid: true, slugs: unique }
}

/** バケット内objectの公開URLを構築する純粋関数。 */
export function buildPublicObjectUrl(supabaseUrl, bucket, filename) {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${filename}`
}

export async function processSlug({ supabase, supabaseUrl, slug }) {
  const pngFilename = `${slug}.png`
  const webpFilename = `${slug}.webp`
  const expectedCurrentOgImage = buildPublicObjectUrl(supabaseUrl, BUCKET, pngFilename)

  // ── DB行の存在・状態確認（published行のみを対象とする）──────────────
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
    console.warn(`⚠️  [${slug}] og_imageが想定と異なる（既に更新済み、または別画像）ためskip: ${row.og_image}`)
    return { slug, ok: false, reason: 'og_image_unexpected' }
  }

  // ── 既存.webpが既にあるなら上書きせずskip ──────────────────────────
  // Codex監査 修正: list()のerrorを確認せずdataだけを見ていたため、
  // list()自体が失敗した場合（data=null/undefined）でも
  // `existingWebp?.some(...)`はfalsyとなり「存在しない」と誤判定して
  // そのままuploadへ進んでしまう欠陥があった。listのerrorはfail-closed
  // （即座にそのslugを失敗させ、uploadへ進まない）とする。
  const { data: existingWebp, error: listErr } = await supabase.storage.from(BUCKET).list('', {
    search: webpFilename,
  })
  if (listErr) {
    console.error(`❌ [${slug}] ${webpFilename}の存在確認(list)に失敗: ${listErr.message}`)
    return { slug, ok: false, reason: 'destination_check_failed' }
  }
  if (existingWebp?.some((f) => f.name === webpFilename)) {
    console.warn(`⚠️  [${slug}] ${webpFilename} は既に存在するためskip（上書きしない）`)
    return { slug, ok: false, reason: 'webp_already_exists' }
  }

  // ── 元PNGのダウンロード ──────────────────────────────────────────────
  const { data: pngBlob, error: dlErr } = await supabase.storage.from(BUCKET).download(pngFilename)
  if (dlErr) {
    console.error(`❌ [${slug}] ${pngFilename} のダウンロードに失敗: ${dlErr.message}`)
    return { slug, ok: false, reason: 'download_failed' }
  }
  const original = Buffer.from(await pngBlob.arrayBuffer())
  const originalSize = original.byteLength

  // ── WebP圧縮 ──────────────────────────────────────────────────────
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
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(webpFilename, compressed, {
    contentType: 'image/webp',
    upsert: false,
  })
  if (upErr) {
    console.error(`❌ [${slug}] ${webpFilename} のアップロードに失敗: ${upErr.message}`)
    return { slug, ok: false, reason: 'upload_failed' }
  }

  // ── アップロード後のremote object再検証（DB更新より必ず前）──────────────
  // Codex監査 修正: 以前はupload()の成功レスポンスのみを信頼して直接
  // DB og_imageを更新していた。upload成功後・DB更新前にStorage APIの
  // download()（公開CDN経由のGETではなく、認証済みStorage clientによる
  // 直接読み取り。CDNキャッシュ経由だと検証の信頼性が下がるため意図的に
  // 避ける）でアップロード済みobjectを取得し直し、実際に保存された内容が
  // 想定どおりであることを確認してからでなければDB更新へ進まない。
  // 検証に失敗した場合、DB og_imageは更新しない・アップロード済みwebpも
  // 削除しない（孤立したwebpが残る可能性はあるが、検証されていない
  // objectをDBが指す状態より安全）。
  const { data: remoteBlob, error: remoteDlErr } = await supabase.storage.from(BUCKET).download(webpFilename)
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
  // byte長の一致だけでは内容の破損・差し替えは検出できないため、内容の
  // 完全一致をSHA-256で確認する（Node組み込みcryptoのみ使用。新規依存
  // 追加なし）。Supabase StorageのStorage API download()は公開serving層の
  // 画像変換・再エンコード等を経由しない直接オブジェクト読み取りであり、
  // アップロードしたbytesがそのまま返る想定のため、厳密な一致比較が
  // 有効かつ信頼できる。
  const localHash = createHash('sha256').update(compressed).digest('hex')
  const remoteHash = createHash('sha256').update(remoteBuffer).digest('hex')
  if (localHash !== remoteHash) {
    console.error(`❌ [${slug}] remote objectのSHA-256がuploadしたbufferと不一致`)
    return { slug, ok: false, reason: 'remote_webp_hash_mismatch' }
  }

  const newOgImage = buildPublicObjectUrl(supabaseUrl, BUCKET, webpFilename)

  // ── DB更新（remote検証に成功した場合のみ。id+slug+og_image+is_published限定）──
  // Codex監査 修正: is_published=trueは処理開始時にのみ確認しており、
  // 実際のUPDATE文のWHERE句には含まれていなかった。読み取り後・更新前に
  // 記事がunpublishedへ変更された場合でも更新が成立しうる状態だったため、
  // 他の既存条件（id/slug/og_image）と同様にis_published=trueも
  // UPDATE自体のCAS条件へ追加する。この条件により対象行が0件になった
  // 場合は安全に失敗として扱い、自動的な再公開等は一切行わない。
  const { data: updated, error: updateErr } = await supabase
    .from('blogs')
    .update({ og_image: newOgImage })
    .eq('id', row.id)
    .eq('slug', slug)
    .eq('og_image', expectedCurrentOgImage)
    .eq('is_published', true)
    .select('id, slug, og_image')

  if (updateErr) {
    console.error(`❌ [${slug}] og_image更新に失敗（webpは${webpFilename}としてアップロード済み）: ${updateErr.message}`)
    return { slug, ok: false, reason: 'db_update_failed' }
  }
  if (updated.length !== 1) {
    console.error(`❌ [${slug}] og_image更新のaffected rowsが1件ではない(${updated.length}件)`)
    return { slug, ok: false, reason: 'db_update_row_count_mismatch' }
  }

  console.log(`✅ [${slug}] ${originalSize}B → ${compressedSize}B (${Math.round((1 - compressedSize / originalSize) * 100)}%削減) → ${webpFilename} → og_image更新完了`)
  return { slug, ok: true, originalSize, compressedSize, webpFilename, newOgImage }
}

/**
 * Codex監査 修正: 以前は `failed > 0 && succeeded === 0 ? 1 : 0` で、
 * 一部のslugだけ失敗した場合（例: 5成功+1失敗）でもexit 0を返していた。
 * GitHub Actions上ではこれが「成功」として扱われ、部分失敗が
 * silentに握りつぶされてしまう。1件でも失敗があればbatch全体を
 * 非ゼロで終了させる（成功したslugをrollbackする必要はない —
 * 既に成功したStorage/DB変更はそのまま維持し、ログで成功/失敗件数を
 * 明示したうえでprocess exit codeだけをfailureにする）。
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
    console.error('   使い方: node scripts/compress-blog-images.mjs <slug1> <slug2> ...')
    console.error('   または THUMBNAIL_TARGET_SLUGS="slug1,slug2" を環境変数で指定してください。')
    return 1
  }

  console.log(`📦 対象slug: ${targetResult.slugs.length}件`)
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
