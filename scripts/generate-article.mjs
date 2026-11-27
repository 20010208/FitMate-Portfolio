/**
 * AI記事生成スクリプト（OpenAI gpt-4o）
 * 生成した記事を Supabase blogs テーブルに INSERT する
 *
 * 実行方法:
 *   node --env-file=.env.local scripts/generate-article.mjs
 *   node --env-file=.env.local scripts/generate-article.mjs "プロテイン飲むタイミング"
 *   AUTO_BLOG_KEYWORD="プロテイン飲むタイミング" node --env-file=.env.local scripts/generate-article.mjs
 *
 * 環境変数:
 *   OPENAI_API_KEY            OpenAI APIキー
 *   NEXT_PUBLIC_SUPABASE_URL  Supabase URL
 *   SUPABASE_SECRET_KEY       Supabase 管理キー
 *   AUTO_BLOG_KEYWORD         キーワード手動指定（省略時はAIが自律選定）。
 *                             GitHub Actions からは workflow_dispatch の
 *                             keyword入力をこの環境変数経由で渡す（shell
 *                             commandへの直接展開はしない）。
 *
 * セキュリティ上の設計:
 *   - workflow_dispatch入力はGitHub Actions側のenv:経由でのみ受け取り、
 *     run:のshell command文字列へ直接展開しない（shell injection対策）。
 *   - OpenAIが生成したHTMLは、DB保存前に必ずsanitize-htmlで許可タグ・
 *     許可属性・許可protocolのみへ絞り込む（stored XSS対策）。sanitize後も
 *     危険な残存パターンが無いかを追加検証し、失敗時はDBへ一切保存しない。
 *   - title/description/category/slug/reading_minutes/published_atも
 *     insert前に個別に検証し、正規化済みの値だけをinsert objectへ使う。
 *   - AI由来・外部入力由来の文字列はconsoleへ出す前にsanitizeLogValue()で
 *     1行・制御文字なし・上限長の安全な文字列へ正規化する（ログ出力自体を
 *     経由した改行・ANSI escape sequence注入対策）。DB保存値はこの正規化の
 *     影響を受けない（ログ専用の別コピー）。
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import sanitizeHtml from 'sanitize-html'
import { pathToFileURL } from 'node:url'

// ── keyword入力の検証 ────────────────────────────────────────────────────
const MAX_KEYWORD_LENGTH = 100
// 制御文字（null byte含む）を検出するための意図的な正規表現。C0(0x00-0x1F)・
// DEL(0x7F)に加え、C1制御文字域(0x80-0x9F、terminalのANSI escapeやログ・
// prompt構造を壊し得る領域)も含める。.test()専用（lastIndex状態を持たない
// ようglobalフラグは付けない）。manual keyword・title・description・
// category・slug事前検証・ログの共通防御として使用する。
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F-\x9F]/
// 上と同じ文字集合だが、.replace()で全出現を除去するためglobalフラグ付き。
const CONTROL_CHAR_PATTERN_GLOBAL = /[\x00-\x1F\x7F-\x9F]/g

/**
 * keywordをAUTO_BLOG_KEYWORD環境変数（GitHub Actions workflow_dispatchの
 * 入力はこの経路のみで受け取る）、次いでCLI引数（ローカル手動実行用の
 * 後方互換）から読み取り、検証する。この関数はネットワーク・ファイルI/O・
 * プロセス終了を一切行わない純粋関数。
 *
 * 検証順序（重要）: 制御文字・null byteの検査は、生の値(raw)に対して
 * trimより前に行う。trim後に検査すると、先頭・末尾だけの改行やtabが
 * trimで消えてしまい、本来拒否すべき入力が誤って受理されてしまうため。
 */
export function readManualKeyword(env = process.env, argv = process.argv) {
  const fromEnv = env.AUTO_BLOG_KEYWORD
  const fromArgv = argv[2]
  const hasEnvValue = typeof fromEnv === 'string' && fromEnv.length > 0
  const raw = hasEnvValue ? fromEnv : fromArgv

  if (raw === undefined || raw === null) {
    return { keyword: '', valid: true }
  }
  if (typeof raw !== 'string') {
    return { keyword: '', valid: false, reason: 'not_a_string' }
  }

  // 1) 生の値(raw)そのものに対して null byte / 制御文字を検査する。
  if (raw.includes(String.fromCharCode(0))) {
    return { keyword: '', valid: false, reason: 'null_byte' }
  }
  if (CONTROL_CHAR_PATTERN.test(raw)) {
    return { keyword: '', valid: false, reason: 'control_characters' }
  }

  // 2) 制御文字が無いことを確認できたうえでtrimする。
  const trimmed = raw.trim()
  // 3) trim後に空文字なら「未指定」と同じ扱い（通常cron処理＝AI自律選定）。
  if (trimmed.length === 0) {
    return { keyword: '', valid: true }
  }
  // 4) trim後の文字数を確認する。
  if (trimmed.length > MAX_KEYWORD_LENGTH) {
    return { keyword: '', valid: false, reason: 'too_long' }
  }

  return { keyword: trimmed, valid: true }
}

// ── ログ安全化 ────────────────────────────────────────────────────────────
// ANSI/terminal escape sequenceを除去する。制御バイトはすべて
// String.fromCharCode経由で組み立て、ソースファイル内へ生の制御バイトを
// 直接埋め込まない。段階的に「構造化されたsequence全体」を除去してから、
// 最後に残存する制御文字を一括除去する（belt-and-suspenders）。
const ESC = String.fromCharCode(0x1b) // 7-bit escape
const BEL = String.fromCharCode(0x07) // OSCのbell終端
const C1_CSI = String.fromCharCode(0x9b) // 8-bit CSI (Control Sequence Introducer)
const C1_OSC = String.fromCharCode(0x9d) // 8-bit OSC (Operating System Command)
const C1_ST = String.fromCharCode(0x9c) // 8-bit ST (String Terminator)

// 1) CSI: ESC [ params(0x30-0x3F)* intermediates(0x20-0x2F)* final(0x40-0x7E)
//    （色指定等の一般的なANSI CSI sequence。7-bit/8-bit両形式）
const CSI_7BIT_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g')
const CSI_8BIT_PATTERN = new RegExp(`${C1_CSI}[0-?]*[ -/]*[@-~]`, 'g')
// 2) OSC (BEL終端): ESC ] ... BEL / 8-bit OSC ... BEL
const OSC_BEL_7BIT_PATTERN = new RegExp(`${ESC}\\][^${BEL}${ESC}]*${BEL}`, 'g')
const OSC_BEL_8BIT_PATTERN = new RegExp(`${C1_OSC}[^${BEL}${ESC}${C1_ST}]*${BEL}`, 'g')
// 3) OSC (ST終端): ESC ] ... ESC \\ / 8-bit OSC ... (ESC \\ または 8-bit ST)
const OSC_ST_7BIT_PATTERN = new RegExp(`${ESC}\\][^${ESC}]*${ESC}\\\\`, 'g')
const OSC_ST_8BIT_ESC_PATTERN = new RegExp(`${C1_OSC}[^${ESC}${C1_ST}]*${ESC}\\\\`, 'g')
const OSC_ST_8BIT_C1_PATTERN = new RegExp(`${C1_OSC}[^${ESC}${C1_ST}]*${C1_ST}`, 'g')
// 4) 上記いずれにも一致しない残存ESC(文字集合選択等の他の2文字escapeや、
//    不完全・未終端のescapeへの保険): ESCと直後の1文字までを除去する。
const ESC_GENERIC_PATTERN = new RegExp(`${ESC}.?`, 'g')

/**
 * ANSI/terminal escape sequenceを構造ごと除去する純粋関数。CSI・OSC
 * (BEL終端／ST終端、7-bit/8-bit双方)を優先的に完全除去し、それでも残る
 * ESCは直後の1文字までを保険的に除去する。この時点で除去しきれない
 * 個別のC0/C1制御文字(BEL単体・孤立した8-bit C1等)は、呼び出し側の
 * sanitizeLogValue()が続けて行う一般的な制御文字除去で最終的に除去される。
 */
function stripAnsiSequences(text) {
  return text
    .replace(CSI_7BIT_PATTERN, '')
    .replace(CSI_8BIT_PATTERN, '')
    .replace(OSC_BEL_7BIT_PATTERN, '')
    .replace(OSC_BEL_8BIT_PATTERN, '')
    .replace(OSC_ST_7BIT_PATTERN, '')
    .replace(OSC_ST_8BIT_ESC_PATTERN, '')
    .replace(OSC_ST_8BIT_C1_PATTERN, '')
    .replace(ESC_GENERIC_PATTERN, '')
}

const DEFAULT_LOG_MAX_LENGTH = 200
const TRUNCATION_MARKER = '…'

/**
 * AI由来・外部入力由来の文字列をconsoleへ渡す前に、安全な1行文字列へ
 * 正規化する純粋関数。ANSI/terminal escape sequenceを除去し、改行・
 * carriage return・tabを空白へ変換し、残る制御文字（C0・DEL・C1）も除去、
 * 連続空白を圧縮し、指定した最大長でtruncateする。truncate時は省略記号
 * (ellipsis)を含めた戻り値全体の長さが必ずmaxLength以下になるようにする
 * （maxLengthが0・1・2のような極端に小さい値でも安全に動作する）。
 * 戻り値はログ表示専用であり、DB保存値には一切使用しない。
 */
export function sanitizeLogValue(value, maxLength = DEFAULT_LOG_MAX_LENGTH) {
  let text
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = String(value)
    } catch {
      return '[unloggable]'
    }
  }

  const safe = stripAnsiSequences(text)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(CONTROL_CHAR_PATTERN_GLOBAL, '')
    .replace(/\s+/g, ' ')
    .trim()

  const effectiveMax = Math.max(0, Math.floor(Number.isFinite(maxLength) ? maxLength : DEFAULT_LOG_MAX_LENGTH))

  if (safe.length <= effectiveMax) {
    return safe
  }
  if (effectiveMax === 0) {
    return ''
  }
  // ellipsis(1文字)を含めた合計がeffectiveMaxを超えないよう、本文部分は
  // effectiveMax - 1文字までに縮める。
  return `${safe.slice(0, effectiveMax - 1)}${TRUNCATION_MARKER}`
}

// OpenAIエラー診断用のmessage最大長。sanitizeLogValueの既定(200)より長めに
// 取り、"You exceeded your current quota, ..." のような課金/クォータ系の
// 説明文が途中で切れないようにする。
const OPENAI_ERROR_MESSAGE_MAX_LENGTH = 300

/**
 * OpenAI SDKのエラーを、単一行の診断文字列へ整形する純粋関数。
 *
 * 出力するのは選択したprimitiveフィールドのみ:
 *   status / code / type / (name) / message
 *
 * `message` は OpenAI APIのエラーレスポンス本文（"You exceeded your current
 * quota, ..." 等）に由来し得るため、他フィールドも含め全ての文字列を
 * sanitizeLogValue で1行化・truncate してから出力する。sanitizeLogValue は
 * ANSI/制御文字除去・改行正規化・長さ制限を行うのみで、APIキー等の
 * 秘密パターン検出・マスクは行わない。
 *
 * 出力しないもの: APIキー / Authorization・その他ヘッダー / リクエスト本文 /
 * レスポンスの生オブジェクト / スタックトレース / SDKエラーオブジェクト全体 /
 * プロンプト / 生成記事本文。
 *
 * 制御フローには影響しない（呼び出し側は従来どおり return 1 する）。
 * 敵対的なgetter/Proxy由来のthrowでも診断経路を止めないよう、全体を
 * try/catch で包み、失敗時は無害な固定文字列を返す。
 */
export function formatOpenAiError(err) {
  try {
    const parts = []
    const status = err?.status
    if (status !== undefined && status !== null && status !== '') {
      parts.push(`status=${sanitizeLogValue(status, 20)}`)
    }
    const code = err?.code
    if (code !== undefined && code !== null && code !== '') {
      parts.push(`code=${sanitizeLogValue(code, 60)}`)
    }
    const type = err?.type
    if (type !== undefined && type !== null && type !== '') {
      parts.push(`type=${sanitizeLogValue(type, 60)}`)
    }
    // status等が全く取れない非APIError(ネットワーク例外等)向けの最小手掛かり。
    if (parts.length === 0 && err?.name) {
      parts.push(`name=${sanitizeLogValue(err.name, 60)}`)
    }
    if (err?.message) {
      parts.push(`message=${sanitizeLogValue(err.message, OPENAI_ERROR_MESSAGE_MAX_LENGTH)}`)
    }
    return parts.length > 0 ? parts.join(' ') : 'UnknownError'
  } catch {
    return 'UnloggableError'
  }
}

// ── HTML sanitize（stored XSS対策）───────────────────────────────────────
// 現在のプロンプト仕様・既存41記事の実content調査に基づく必要最小限の
// allowlist。img/table/figure等、実際に生成・利用されていないtagは含めない。
const ALLOWED_TAGS = ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'a', 'div']
const ALLOWED_ATTRIBUTES = {
  a: ['href', 'target', 'rel'],
  div: ['class'],
}
// divのclassは参考文献セクション（globals.cssの.blog-referencesで実際に
// スタイリングされている）専用。それ以外のclass値は許可しない。
const ALLOWED_CLASSES = { div: ['blog-references'] }
const ALLOWED_SCHEMES = ['http', 'https']

// a要素のhref事前チェック用。http(s)://の絶対URL、または「//」で始まらない
// (protocol-relativeではない)単一スラッシュの相対URLのみを「安全」とみなす。
// これは最終防御ではなく、危険なhrefを持つa要素をunwrap(タグだけ除去し
// テキストは残す)対象として判定するための事前チェック。実際のscheme
// 許可判定はallowedSchemes/allowProtocolRelativeがsanitize-html本体の
// 処理として別途行う（二重防御）。
const SAFE_HREF_PATTERN = /^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i
const ALLOWED_TARGET_VALUES = new Set(['_blank'])

/**
 * Codex監査 修正: 以前はallowedTagsに含まれない架空のtag名
 * （'fitmate-unwrap-link'）へtransformTagsでrenameし、sanitize-htmlの
 * disallowedTagsMode('discard')に除去させることでunwrap（タグだけ除去し
 * テキストは残す）を実現していた。この方式は、除去対象のa要素の直後に
 * 別のa要素が続く場合（例:
 * `<a href="bad">bad</a><a href="good">good</a>`）、閉じタグの対応関係が
 * 崩れ、後続の正常なa要素の閉じタグが`</fitmate-unwrap-link>`に化けて
 * 出力を破壊するバグが実際に再現された（Codex監査で確認）。
 *
 * 正しい修正: sanitize-html公式サポートの`exclusiveFilter`が
 * `'excludeTag'`を返すことで、そのタグ自身の開始・閉じタグだけを
 * （position/lengthベースで安全に）除去し、子要素・テキストは維持する
 * 機能を提供している。架空tag名への変換は一切行わない。
 * `transformTags`は維持対象のa要素（安全なhrefを持つもの）の
 * target/rel正規化にのみ使う。
 */
export function sanitizeArticleHtml(rawHtml) {
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedClasses: ALLOWED_CLASSES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'a') return false
      const href = frame.attribs?.href || ''
      return SAFE_HREF_PATTERN.test(href) ? false : 'excludeTag'
    },
    transformTags: {
      a: (tagName, attribs) => {
        // ここに到達するa要素はexclusiveFilterで既にSAFE_HREF_PATTERN
        // 検証済み（不一致は除去済み）。target/relの正規化だけを行う。
        const nextAttribs = { href: attribs.href }
        const hasBlankTarget = ALLOWED_TARGET_VALUES.has(attribs.target)
        if (hasBlankTarget) {
          nextAttribs.target = '_blank'
          nextAttribs.rel = 'noopener noreferrer'
        }
        // target無し(または不許可のtarget値)の場合はtarget/relとも付与しない。

        return { tagName, attribs: nextAttribs }
      },
    },
  })
}

// ── 内部blog linkのwhitelist検証（AI promptだけに依存しない多層防御）───────
// sanitizeArticleHtml()で既にscheme検証済み（http(s)絶対URL、または"//"で
// 始まらない相対URLのみが生き残る）のHTMLに対して行う後段の処理。AIが
// promptの指示を無視して存在しないslugへリンクしたり、slugを取り違えた
// りしても、DBへ保存される前に必ずこの段階で無効化する。
const SITE_ORIGIN = 'https://www.fitmate.run'
const BLOG_ARTICLE_PATH_PREFIX = '/blog/'
// SLUG_PATTERNと同じ文字クラス（このファイル後方で定義される検証用slug
// 正規表現と意図的に同じ制約）。前方参照を避けるためここで個別に定義する。
const BLOG_ARTICLE_SLUG_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 与えられたhrefがFitMateブログ記事へのリンク「らしい形」かどうかを判定
 * する純粋関数。将来100〜1000記事規模になってもロジックは変わらない
 * （existingSlugsとの照合は呼び出し側の責務）。
 *
 * 戻り値:
 *   - { kind: 'not_applicable' }  … FitMate自身（siteOrigin）宛てで
 *     "/blog/<何か>" の形をしていない。外部ドメイン（参考文献URL、
 *     Preview/Vercel等の別hostnameを含む、あらゆる別origin）は、
 *     "/blog"らしいpathを持っていても常にこの区分になり、既存の
 *     sanitizeArticleHtml()の外部link処理（scheme検証・target/rel）に
 *     委ねる＝このwhitelistは検証対象外として一切手を加えない。
 *   - { kind: 'invalid', reason: 'malformed_path' }  … siteOrigin宛てで
 *     "/blog/"の形をしているが不正（例: "/blog/"だけ、nested path、
 *     許可文字集合外）。
 *   - { kind: 'candidate', slug }  … siteOrigin宛ての "/blog/<slug>" の
 *     形の候補。実在するかどうか（existingSlugsとの完全一致）は
 *     呼び出し側で判定する（prefix一致は候補としても不一致として扱う
 *     ＝完全一致のみ有効）。
 *
 * query/hashは意図的に無視する（このアプリはblog記事pageでquery paramを
 * 読まないため、識別に使うのはpathnameのslug部分のみ）。
 */
export function classifyInternalBlogLinkHref(href, siteOrigin = SITE_ORIGIN) {
  if (typeof href !== 'string' || href.length === 0) {
    return { kind: 'not_applicable' }
  }

  let parsed
  try {
    parsed = new URL(href, siteOrigin)
  } catch {
    return { kind: 'not_applicable' }
  }

  // originの比較を先に行う: FitMate自身宛てでない限り、pathが
  // "/blog/"らしい形をしていても一切関知しない（外部サイト・Preview/
  // Vercelいずれも、既存のsanitizeArticleHtml()の一般的な外部link処理に
  // 委ねる。「/blog」というpath segmentを使う外部サイトは珍しくないため、
  // その中身をこのwhitelistが判定する理由はない）。
  if (parsed.origin !== siteOrigin) {
    return { kind: 'not_applicable' }
  }

  if (!parsed.pathname.startsWith(BLOG_ARTICLE_PATH_PREFIX)) {
    return { kind: 'not_applicable' }
  }

  const slugCandidate = parsed.pathname.slice(BLOG_ARTICLE_PATH_PREFIX.length)
  if (!BLOG_ARTICLE_SLUG_SEGMENT_PATTERN.test(slugCandidate)) {
    return { kind: 'invalid', reason: 'malformed_path' }
  }

  return { kind: 'candidate', slug: slugCandidate }
}

/**
 * sanitize済みHTML中のFitMateブログ内部リンクだけを走査し、実在確認の
 * 結果を報告する（HTMLは一切変更しない、純粋な読み取り専用の集計）。
 * ログ出力・テストの両方で使う。
 */
export function validateInternalBlogLinks(html, existingSlugs, siteOrigin = SITE_ORIGIN) {
  const found = []
  sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedClasses: ALLOWED_CLASSES,
    allowedSchemes: ALLOWED_SCHEMES,
    exclusiveFilter: (frame) => {
      if (frame.tag === 'a') {
        const classification = classifyInternalBlogLinkHref(frame.attribs?.href, siteOrigin)
        if (classification.kind === 'candidate') {
          found.push({ slug: classification.slug, valid: existingSlugs.has(classification.slug) })
        } else if (classification.kind === 'invalid') {
          found.push({ slug: null, valid: false, reason: classification.reason })
        }
      }
      return false
    },
  })
  return found
}

/**
 * 実在しない（またはmalformed/別origin）内部blog linkだけをunwrapする
 * （タグを除去しanchor textは維持＝本文は削除しない）。実在するcandidate
 * は正規の相対形 "/blog/<slug>" へ正規化する（絶対URL・query・hashが
 * 付いていても破棄し、同じ記事への一貫した表記にする）。
 * /blog/記事以外のリンク（外部参考文献・/blog自体・/signup等）や、
 * target/rel等の既存属性はsanitizeArticleHtml()の結果をそのまま維持する。
 *
 * Codex監査 修正: sanitizeArticleHtml()と同じ理由で、除去対象のa要素を
 * 架空tag名へtransformする方式は使わない。`exclusiveFilter`が
 * `'excludeTag'`を返すことでタグのみを安全に除去し、隣接する別のa要素の
 * 閉じタグを破損させない。`transformTags`は維持するcandidate（実在slug）
 * のhref正規化にのみ使う。
 */
export function unwrapInvalidInternalBlogLinks(html, existingSlugs, siteOrigin = SITE_ORIGIN) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedClasses: ALLOWED_CLASSES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'a') return false
      const classification = classifyInternalBlogLinkHref(frame.attribs?.href, siteOrigin)
      if (classification.kind === 'invalid') return 'excludeTag'
      if (classification.kind === 'candidate' && !existingSlugs.has(classification.slug)) return 'excludeTag'
      return false
    },
    transformTags: {
      a: (tagName, attribs) => {
        const classification = classifyInternalBlogLinkHref(attribs.href, siteOrigin)
        if (classification.kind === 'candidate' && existingSlugs.has(classification.slug)) {
          return { tagName, attribs: { ...attribs, href: `${BLOG_ARTICLE_PATH_PREFIX}${classification.slug}` } }
        }
        // not_applicable（外部リンク・/blog自体等）や、既にexclusiveFilterで
        // 除去される不正candidateはここでは何もしない（後者は出力に残らない）。
        return { tagName, attribs }
      },
    },
  })
}

const DEFAULT_MAX_INTERNAL_LINK_CANDIDATES = 150

/**
 * 記事生成promptへ渡す内部リンク候補一覧を「title | /blog/slug」の
 * コンパクトな1行形式で構築する純粋関数。existingPostsは呼び出し側で
 * published_at降順に取得済みのものをそのまま渡す想定（最新順に上位
 * maxCandidates件だけを使うことで、47記事の現状はもちろん、将来
 * 100〜1000記事規模になってもprompt tokenが無制限に増え続けない
 * ようにする）。maxCandidatesを超える古い記事は候補から外れるだけで、
 * existingSlugsによる実在検証（whitelist）自体はこの一覧の件数に
 * 依存しない＝古い記事へのリンクが生成されても実在すれば有効なまま）。
 */
export function buildInternalLinkCandidateList(existingPosts, maxCandidates = DEFAULT_MAX_INTERNAL_LINK_CANDIDATES) {
  return existingPosts
    .slice(0, maxCandidates)
    .map((p) => `${p.title} | ${BLOG_ARTICLE_PATH_PREFIX}${p.slug}`)
    .join('\n')
}

// sanitize-html自体を信頼しつつも、設定ミス・ライブラリの想定外挙動への
// 保険として、sanitize後の文字列に危険な残存パターンが無いかを追加確認する。
const DANGEROUS_RESIDUE_PATTERNS = [
  /<script[\s>]/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<svg[\s>]/i,
  /<style[\s>]/i,
  /<form[\s>]/i,
  /\son\w+\s*=/i,
  /javascript:/i,
  /vbscript:/i,
  /data:/i,
]

function containsDangerousResidue(html) {
  return DANGEROUS_RESIDUE_PATTERNS.some((pattern) => pattern.test(html))
}

const MIN_SANITIZED_HTML_LENGTH = 800
const MIN_PLAIN_TEXT_LENGTH = 400

// Unicode category Cf (Format) — ゼロ幅文字(U+200B ZERO WIDTH SPACE、
// U+200C ZWNJ、U+200D ZWJ、U+2060 WORD JOINER、U+FEFF ZERO WIDTH NO-BREAK
// SPACE等)を含む「表示上は不可視だがテキスト長には算入されうる」文字集合。
// 品質判定用の文字数カウント・見出し非空判定でのみ除去し、DBへ保存される
// sanitize済みHTML自体は書き換えない。
const UNICODE_FORMAT_CHAR_PATTERN = /\p{Cf}/gu

function stripFormatChars(text) {
  return text.replace(UNICODE_FORMAT_CHAR_PATTERN, '')
}

/**
 * HTML文字列から「実質的な可視テキスト」だけを抽出する純粋関数。処理順序:
 *   1) HTML entity decode（sanitize-htmlの内部HTMLパーサを再利用。
 *      &nbsp;・&#160;・&#xA0;等を正しく実文字へdecodeする。自作正規表現
 *      でのentity処理は行わない）
 *   2) タグ除去（同じくsanitize-html経由）
 *   3) Unicode format文字(Cf、ゼロ幅文字等)の除去
 *   4) Unicode空白（NBSP・全角スペース等、JSの\sが一致する範囲）の正規化
 *   5) 連続空白の圧縮
 *   6) trim
 * この関数の戻り値は品質判定（文字数・非空判定）にのみ使用し、DBへ保存
 * されるsanitize済みHTML自体には一切影響しない。
 */
function extractPlainText(html) {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }) // 1) entity decode + 2) tag除去
  const noFormatChars = stripFormatChars(stripped) // 3) Unicode format文字除去
  return noFormatChars.replace(/\s+/g, ' ').trim() // 4) 空白正規化 + 5) 圧縮 + 6) trim
}

/**
 * sanitize済みHTML中に、実質的なテキストを持つh2見出しが少なくとも1件
 * 存在するかを判定する。sanitize-htmlのexclusiveFilterを使い、各h2要素
 * ごとにdecode済みテキスト(frame.text)を取得する（正規表現によるHTML解析
 * ではなく、sanitize-htmlと同じHTMLパーサ経由）。空・空白のみ・<br>のみ・
 * &nbsp;のみ・ゼロ幅文字（U+200B等のUnicode format文字）のみのh2は
 * 「実質的なテキストなし」として扱う。
 */
function hasNonEmptyHeading(html) {
  let found = false
  sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedClasses: ALLOWED_CLASSES,
    allowedSchemes: ALLOWED_SCHEMES,
    exclusiveFilter: (frame) => {
      if (frame.tag === 'h2' && stripFormatChars(frame.text).replace(/\s+/g, ' ').trim().length > 0) {
        found = true
      }
      return false
    },
  })
  return found
}

/**
 * sanitize後のHTMLがDB保存に値するかを検証する純粋関数。
 * いずれかの検証に失敗した場合、呼び出し側はDB insertを行わず失敗終了する。
 */
export function validateSanitizedArticleHtml(html) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    return { ok: false, reason: 'empty_after_sanitize' }
  }
  if (html.length < MIN_SANITIZED_HTML_LENGTH) {
    return { ok: false, reason: 'too_short' }
  }
  if (!hasNonEmptyHeading(html)) {
    return { ok: false, reason: 'missing_required_heading' }
  }
  const plainText = extractPlainText(html)
  if (plainText.length < MIN_PLAIN_TEXT_LENGTH) {
    return { ok: false, reason: 'insufficient_plain_text' }
  }
  if (containsDangerousResidue(html)) {
    return { ok: false, reason: 'dangerous_residue_detected' }
  }
  return { ok: true }
}

// ── 記事fieldの検証（title/description/category/slug/reading_minutes/published_at）
const TITLE_MIN_LENGTH = 10
const TITLE_MAX_LENGTH = 120
const DESCRIPTION_MIN_LENGTH = 30
const DESCRIPTION_MAX_LENGTH = 300
// 実際に生成・利用中の正規カテゴリ(プロンプト内allowlistおよびProduction
// 公開記事の実データで確認済み)。近似変換はせず、これ以外はfail-closed。
const ALLOWED_CATEGORIES = ['食事管理', '筋トレ', 'ダイエット', '栄養', 'ライフスタイル']
const SLUG_MIN_LENGTH = 3
const SLUG_MAX_LENGTH = 100
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const READING_MINUTES_MIN = 1
const READING_MINUTES_MAX = 60
const PUBLISHED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HTML_TAG_LIKE_PATTERN = /<[a-zA-Z!/]/

function hasControlCharacters(value) {
  return value.includes(String.fromCharCode(0)) || CONTROL_CHAR_PATTERN.test(value)
}

/**
 * title: string・trim後非空・10〜120文字・制御文字禁止・HTML tag禁止。
 * 検証を通過した場合、trim済みの正規化値を返す。
 */
export function validateTitle(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  if (hasControlCharacters(value)) return { ok: false, reason: 'control_characters' }
  if (HTML_TAG_LIKE_PATTERN.test(value)) return { ok: false, reason: 'html_tag' }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length < TITLE_MIN_LENGTH || trimmed.length > TITLE_MAX_LENGTH) return { ok: false, reason: 'length' }
  return { ok: true, value: trimmed }
}

/** description: title同様の制約で30〜300文字。 */
export function validateDescription(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  if (hasControlCharacters(value)) return { ok: false, reason: 'control_characters' }
  if (HTML_TAG_LIKE_PATTERN.test(value)) return { ok: false, reason: 'html_tag' }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'empty' }
  if (trimmed.length < DESCRIPTION_MIN_LENGTH || trimmed.length > DESCRIPTION_MAX_LENGTH) return { ok: false, reason: 'length' }
  return { ok: true, value: trimmed }
}

/** category: 正規カテゴリのallowlistとの完全一致のみ許可。近似変換はしない。 */
export function validateCategory(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  // allowlistとの完全一致チェックだけでもC0/C1制御文字を含む値は自動的に
  // 拒否されるが、共通のcontrol character判定を明示的に通すことで、
  // 他のfield検証との一貫した防御方針を維持する。
  if (hasControlCharacters(value)) return { ok: false, reason: 'control_characters' }
  if (!ALLOWED_CATEGORIES.includes(value)) return { ok: false, reason: 'not_in_allowlist' }
  return { ok: true, value }
}

/**
 * slug: 小文字英数字とハイフンのみ、先頭・末尾ハイフン禁止、連続ハイフン
 * 禁止、3〜100文字。正規表現が上記すべてを一度に強制する
 * （path separator・dot segment・制御文字・URL encode前提の特殊文字も
 * この文字クラスの外側になるため自動的に拒否される）。
 */
export function validateSlug(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  // SLUG_PATTERN（ASCII小文字英数字とハイフンのみ）だけでもC0/C1制御文字を
  // 含む値は自動的に拒否されるが、共通のcontrol character判定を明示的に
  // 通すことで、他のfield検証との一貫した防御方針を維持する。
  if (hasControlCharacters(value)) return { ok: false, reason: 'control_characters' }
  if (value.length < SLUG_MIN_LENGTH || value.length > SLUG_MAX_LENGTH) return { ok: false, reason: 'length' }
  if (!SLUG_PATTERN.test(value)) return { ok: false, reason: 'invalid_format' }
  return { ok: true, value }
}

/** reading_minutes: 有限の整数、1〜60。NaN／Infinity／小数を拒否。 */
export function validateReadingMinutes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'not_finite' }
  if (!Number.isInteger(value)) return { ok: false, reason: 'not_integer' }
  if (value < READING_MINUTES_MIN || value > READING_MINUTES_MAX) return { ok: false, reason: 'out_of_range' }
  return { ok: true, value }
}

/**
 * published_at: YYYY-MM-DD形式かつ実在する日付であることを厳密に確認する。
 * `new Date('YYYY-MM-DDT00:00:00Z')`のようなDateへの直接パースは、
 * 2026-02-29や2026-04-31のような存在しない日付を「翌月へ自動繰り上げ」
 * して受理してしまう（DateのUTC正規化に依存しない）ため使用しない。
 *
 * 検証方式:
 *   1) 正規表現でYYYY-MM-DD形式を確認
 *   2) year/month/dayを数値へ分解
 *   3) Date.UTC(year, month - 1, day)でDateを生成
 *   4) 生成したDateのUTC year/month/dayを入力値とround-trip比較
 *   5) 一致しなければ（Dateが自動繰り上げ/繰り下げした場合）拒否
 * これによりうるう年（4年ルール・100年ルール・400年ルール）・月ごとの
 * 実際の日数・0月/13月・0日/負数相当の不正値をすべて正しく拒否する。
 */
export function validatePublishedAt(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not_a_string' }
  if (!PUBLISHED_AT_PATTERN.test(value)) return { ok: false, reason: 'invalid_format' }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))

  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false, reason: 'invalid_date' }
  }

  return { ok: true, value }
}

// ── 読了時間の推定（文字数ベース）────────────────────────────────────────────
export function estimateReadingMinutes(htmlContent) {
  const text = htmlContent.replace(/<[^>]+>/g, '')
  const chars = text.length
  return Math.max(3, Math.round(chars / 500))
}

function logTokenUsage(stage, usage) {
  if (!usage) return
  console.log(`   [${stage}] token使用量: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`)
}

/**
 * 既存published記事のSupabase select結果（{ data, error }）をfail-closedで
 * 解釈する純粋関数。呼び出し側（main）はこれを介することで、実際の
 * Supabaseクライアントを呼ばずに「SELECT成功（0件含む）」と
 * 「SELECT失敗」の分岐を実行テストできる。
 *   - error あり → { ok: false, reason }（呼び出し側はOpenAI呼び出し・
 *     INSERTへ進まず終了すること）。
 *   - error なし → { ok: true, posts }（data=[]・error=nullの「0件」は
 *     正常な結果として区別し、これ自体はエラー扱いしない＝初回記事生成を
 *     妨げない）。
 */
export function resolveExistingPosts(result) {
  if (result.error) {
    return { ok: false, reason: result.error?.message ?? 'unknown_error' }
  }
  return { ok: true, posts: result.data ?? [] }
}

// ── メイン処理 ────────────────────────────────────────────────────────────
export async function main() {
  const OPENAI_KEY = process.env.OPENAI_API_KEY
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_ADMIN_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()

  if (!OPENAI_KEY || !SUPABASE_URL || !SUPABASE_ADMIN_KEY) {
    console.error('❌ 必要な環境変数が不足しています')
    console.error('   OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY')
    return 1
  }

  const manualKeywordResult = readManualKeyword()
  if (!manualKeywordResult.valid) {
    console.error(`❌ キーワード入力が不正です（reason: ${manualKeywordResult.reason}）`)
    return 1
  }

  // timeout/maxRetriesを明示指定し、SDK既定（timeout 10分・retry 2回）に
  // 依存しない。一時エラー時の自動再呼び出しも追加しない（二重課金対策）。
  const openai = new OpenAI({ apiKey: OPENAI_KEY, timeout: 120_000, maxRetries: 0 })
  const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY)

  // ── 既存記事の取得（被り防止・内部link whitelist用。published記事のみ）───
  // Codex監査 修正: is_published絞り込みが無いとdraft/unpublished記事まで
  // title重複チェック・内部link候補・whitelistに混入しうる（service key
  // はRLSを経由せず全件取得できるため）。またerrorを確認せず
  // `existingPosts ?? []`で握りつぶすと、SELECT失敗時に「既存記事0件」と
  // 誤認したまま候補一覧・whitelistが空でOpenAI呼び出し・INSERTへ進んで
  // しまう（重複防止・link whitelistが実質無効化された状態での公開）ため、
  // ここはfail-closedにする。0件そのもの（data=[]・error=null）は正常な
  // 初回記事生成のケースとして区別し、続行してよい（resolveExistingPosts
  // 参照）。
  console.log('📚 既存記事を取得中...')
  const existingPostsResult = resolveExistingPosts(
    await supabase
      .from('blogs')
      .select('slug, title')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
  )

  if (!existingPostsResult.ok) {
    console.error('❌ 既存記事の取得に失敗しました:', sanitizeLogValue(existingPostsResult.reason))
    return 1
  }

  const existingPosts = existingPostsResult.posts
  const existingSlugs = new Set(existingPosts.map(p => p.slug))
  const existingTitles = existingPosts.map(p => p.title)
  console.log(`   既存記事数: ${existingTitles.length}件`)

  // ── キーワード決定（手動指定→そのまま / なし→AIが自律選定）────────────────
  let keyword
  if (manualKeywordResult.keyword) {
    keyword = manualKeywordResult.keyword
    console.log(`🔑 キーワード（手動指定）: ${sanitizeLogValue(keyword)}`)
  } else {
    console.log('🧠 次のテーマをAIが選定中...')

    const existingListForPick = existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')

    let pickCompletion
    try {
      pickCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `あなたはFitMateというフィットネスアプリのブログ編集長です。
FitMateは「筋トレ・ダイエット・食事管理・栄養・フィットネス系ライフスタイル」に特化したアプリです。

以下のジャンルのみが投稿対象です：
- 筋トレ・ウェイトトレーニング（メニュー・フォーム・頻度など）
- ダイエット・減量・体脂肪
- 食事管理・PFCバランス・カロリー計算
- 栄養素・サプリメント・プロテイン
- フィットネスに関連するライフスタイル（睡眠・水分補給・ストレス管理など）

以下のジャンルは絶対に選ばないでください：
- 金融・投資・保険
- 旅行・観光
- ビューティー・スキンケア（フィットネス無関係のもの）
- 料理レシピ全般（フィットネス目的でないもの）
- テクノロジー・ガジェット
- その他フィットネスと無関係なトピック

次に書くべき記事のキーワードを1つ選んでください。
条件：
- 上記「投稿対象ジャンル」の範囲内であること
- 日本人の20〜40代が検索しそうなSEOキーワードであること
- 下記「公開済み記事リスト」と検索意図（誰が・何を知りたくて検索するか）が重複しないこと。
  単語や語尾（「効果」「方法」「完全ガイド」等）だけを変えたテーマは同一の重複とみなす。
  読者・対象・答える疑問が同じなら重複、明確に異なるsub-intentなら別記事として選んでよい。
  （重複とみなす例：「ダイエット中の外食ガイド」と「外食時のダイエット完全ガイド」／
  　区別できる例：「水分補給が運動パフォーマンスへ与える影響」と「運動前後の水分補給タイミング」）

必ずJSON形式で返答してください（コードブロック不要）:
{"keyword": "キーワードフレーズ（日本語）", "reason": "選んだ理由（1文）"}`,
          },
          {
            role: 'user',
            content: `公開済み記事リスト：\n${existingListForPick}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 300,
      })
    } catch (err) {
      console.error('❌ テーマ選定のOpenAI呼び出しに失敗:', formatOpenAiError(err))
      return 1
    }

    logTokenUsage('テーマ選定', pickCompletion.usage)

    let picked
    try {
      picked = JSON.parse(pickCompletion.choices[0]?.message?.content ?? '')
    } catch {
      console.error(`❌ テーマ選定のJSONパース失敗（response length: ${(pickCompletion.choices[0]?.message?.content ?? '').length}, stage: topic_pick）`)
      return 1
    }

    if (typeof picked.keyword !== 'string' || picked.keyword.trim().length === 0) {
      console.error('❌ テーマ選定の応答にkeywordが含まれていません')
      return 1
    }

    keyword = picked.keyword
    console.log(`🔑 AIが選定したキーワード: ${sanitizeLogValue(keyword)}`)
    console.log(`💡 選定理由: ${sanitizeLogValue(picked.reason)}`)
  }

  // ── OpenAI にリクエスト ─────────────────────────────────────────────────────
  console.log('🤖 OpenAI で記事を生成中...')

  const existingListText = existingTitles.length > 0
    ? `\n\n【重要：以下の記事はすでに公開済みです。これらと内容・テーマが重複しないようにしてください】\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : ''

  const internalLinkCandidateList = buildInternalLinkCandidateList(existingPosts)
  const internalLinkCandidatesText = internalLinkCandidateList.length > 0
    ? `\n\n【内部リンク候補一覧（この中に実在するものだけ使用可。関連性が高いものが無ければ内部リンクは0件でよい）】\n${internalLinkCandidateList}`
    : ''

  const systemPrompt = `あなたは日本語のフィットネス・健康系ブログ記事のプロライターです。
以下のルールで記事を生成してください:
- 読者ターゲット: 筋トレ・ダイエットに取り組む20〜40代の日本人
- 文体: 丁寧語（〜です・〜ます）
- 必ず科学的根拠や具体的な数値を盛り込む
- 見出しはh2・h3タグを使い、本文はpタグで記述する
- リストはulタグを使う
- 最後に「まとめ」セクションを置く
- 合計3,000〜4,500文字（HTML込み）程度

【タイトルのSEOルール】
- 数字を入れる（例：10選・ランキング・○g・○%）
- 年号を入れる（例：【2026年最新】）
- 疑問形にする（例：〜とは？いつ飲む？）
- ブランド名・固有名詞を入れる（例：ローソン・セブン・クレアチン）

【内部リンクのルール】
下記ユーザーメッセージの「内部リンク候補一覧」に実在する記事の中から、関連性が高いものだけを選び、
FitMateブログの内部リンクを0〜2件挿入すること。挿入する場合の文体例:
「詳しくはFitMateの<a href="/blog/実在するslug" style="color:var(--accent);font-weight:bold;text-decoration:underline;">（リンク先の内容を説明する自然な日本語のanchor text）</a>もご参照ください。」
- 内部リンクは0〜2件。関連性が高い場合のみ使い、無理に入れない（0件で問題ない）
- 候補一覧に実在するURLだけを使う。候補にないslugを新しく作らない
- 同じ記事へのリンクを複数回入れない
- 今書いているこの記事自身にはリンクしない
- anchor textは「こちら」「詳しくはこちら」のような弱い表現を避け、リンク先の内容を自然に説明する文言にする

【参考文献のルール】
まとめセクションの後に、必ず以下の形式の参考文献セクションをcontentの末尾に追加すること。
記事テーマに最も合う2〜3件を選ぶこと。使用できるURLは下記リストのみ（それ以外のURLは絶対に使用しない）:

＜栄養・食事管理・PFC系の記事に使用＞
- https://www.mhlw.go.jp/stf/newpage_08517.html → 厚生労働省「日本人の食事摂取基準（2020年版）策定検討会報告書」
- https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/index.html → 厚生労働省「栄養・食育対策」
- https://www.nibn.go.jp/ → 国立研究開発法人 医薬基盤・健康・栄養研究所
- https://fooddb.mext.go.jp/ → 文部科学省「食品成分データベース」
- https://www.maff.go.jp/j/balance_guide/ → 農林水産省「食事バランスガイド」
- https://www.maff.go.jp/j/syokuiku/ → 農林水産省「食育の推進」

＜ダイエット・コンビニ食品・食品表示系の記事に使用＞
- https://www.caa.go.jp/policies/policy/food_labeling/ → 消費者庁「食品表示」
- https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/kenkounippon21.html → 厚生労働省「健康日本21（第二次）」
- https://www.tyojyu.or.jp/net/ → 公益財団法人長寿科学振興財団「健康長寿ネット」

＜筋トレ・運動・スポーツ系の記事に使用＞
- https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/undou/index.html → 厚生労働省「身体活動・運動の推進」
- https://www.jpnsport.go.jp/ → 公益財団法人日本スポーツ振興センター
- https://www.japan-sports.or.jp/ → 公益財団法人日本スポーツ協会

＜栄養・食事・ダイエット全般（国際機関）＞
- https://www.who.int/news-room/fact-sheets/detail/healthy-diet → World Health Organization (WHO) "Healthy diet"
- https://www.nih.gov/ → National Institutes of Health (NIH) – 米国国立衛生研究所
- https://ods.od.nih.gov/ → NIH Office of Dietary Supplements – 栄養補助食品・サプリメント研究
- https://www.nutrition.gov/ → Nutrition.gov (USDA) – 米国農務省 栄養情報
- https://fdc.nal.usda.gov/ → USDA FoodData Central – 米国農務省 食品成分データベース
- https://www.cdc.gov/nutrition/ → Centers for Disease Control and Prevention (CDC) – 栄養・慢性疾患予防
- https://www.efsa.europa.eu/ → European Food Safety Authority (EFSA) – 欧州食品安全機関
- https://www.nhs.uk/live-well/eat-well/ → NHS (UK National Health Service) "Eat well" – 英国国民保健サービス

＜スポーツ栄養・トレーニング科学（国際機関）＞
- https://www.acsm.org/ → American College of Sports Medicine (ACSM) – 米国スポーツ医学会
- https://pubmed.ncbi.nlm.nih.gov/ → PubMed (National Library of Medicine) – 米国国立医学図書館 論文データベース

参考文献セクションのHTML形式（日本語・英語合わせて2〜4件を選ぶこと）:
<div class="blog-references"><h3>参考資料</h3><p>本記事の情報は以下の公式資料をもとに作成しています。</p><ul><li><a href="URL" target="_blank" rel="noopener noreferrer">ソース名 - 資料名</a></li></ul></div>

必ずJSON形式で返答してください（コードブロック不要、生のJSONのみ）:
{
  "slug": "英数字とハイフンのみのURL用スラグ（例: protein-timing-guide、20〜40文字）",
  "title": "記事タイトル（SEO最適化済み、70文字以内）",
  "description": "メタディスクリプション（120文字以内）",
  "category": "カテゴリ（食事管理|筋トレ|ダイエット|栄養|ライフスタイル のいずれか）",
  "content": "<h2>...</h2><p>...</p>...<div class=\\"blog-references\\">...</div>"
}`

  const userPrompt = `次のキーワードをテーマにした記事を書いてください: 「${keyword}」${existingListText}${internalLinkCandidatesText}`

  let completion
  try {
    completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 6000,
    })
  } catch (err) {
    console.error('❌ 記事生成のOpenAI呼び出しに失敗:', formatOpenAiError(err))
    return 1
  }

  logTokenUsage('記事生成', completion.usage)

  const raw = completion.choices[0]?.message?.content ?? ''
  let article
  try {
    article = JSON.parse(raw)
  } catch {
    console.error(`❌ 記事生成のJSONパース失敗（response length: ${raw.length}, stage: article_generation）`)
    return 1
  }

  if (!article.title || !article.content) {
    console.error('❌ 必須フィールドが不足:', { hasTitle: Boolean(article.title), hasContent: Boolean(article.content) })
    return 1
  }

  // ── title/description/categoryの検証（fail-closed。近似変換はしない）───────
  const titleResult = validateTitle(article.title)
  if (!titleResult.ok) {
    console.error(`❌ titleの検証に失敗しました（reason: ${titleResult.reason}）`)
    return 1
  }
  const descriptionResult = validateDescription(article.description ?? '')
  if (!descriptionResult.ok) {
    console.error(`❌ descriptionの検証に失敗しました（reason: ${descriptionResult.reason}）`)
    return 1
  }
  const categoryResult = validateCategory(article.category)
  if (!categoryResult.ok) {
    console.error(`❌ categoryの検証に失敗しました（reason: ${categoryResult.reason}, value: ${sanitizeLogValue(article.category, 50)}）`)
    return 1
  }

  // ── ファクトチェック ────────────────────────────────────────────────────────
  console.log('🔍 ファクトチェック中...')

  let factCheckCompletion
  try {
    factCheckCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `あなたはフィットネス・栄養学の専門家です。
以下の日本語ブログ記事のHTMLをファクトチェックし、誤った数値・誤解を招く表現・科学的に不正確な内容を修正してください。

修正ルール:
- 数値（カロリー・タンパク質量・推奨摂取量など）は最新のエビデンスに基づいて正確に
- 誇張・過大な効果の主張は穏やかな表現に修正
- 正しい内容はそのまま維持し、余計な変更はしない
- HTMLタグ・構造はそのまま維持する

必ずJSON形式で返答してください（コードブロック不要）:
{
  "content": "修正済みのHTML文字列",
  "changes": ["修正点1", "修正点2", ...]
}
変更がない場合は changes を空配列にしてください。`,
        },
        {
          role: 'user',
          content: article.content,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 6000,
    })
  } catch (err) {
    console.error('❌ ファクトチェックのOpenAI呼び出しに失敗:', formatOpenAiError(err))
    return 1
  }

  logTokenUsage('ファクトチェック', factCheckCompletion.usage)

  let factChecked
  try {
    factChecked = JSON.parse(factCheckCompletion.choices[0]?.message?.content ?? '')
  } catch {
    const responseLength = (factCheckCompletion.choices[0]?.message?.content ?? '').length
    console.warn(`⚠️  ファクトチェックのJSONパース失敗（response length: ${responseLength}）。元の記事をそのまま使用します。`)
    factChecked = { content: article.content, changes: [] }
  }

  if (Array.isArray(factChecked.changes) && factChecked.changes.length > 0) {
    console.log(`✏️  ファクトチェックで ${factChecked.changes.length} 件修正`)
  } else {
    console.log('✅ ファクトチェック問題なし')
  }

  const contentBeforeSanitize = typeof factChecked.content === 'string' && factChecked.content.length > 0
    ? factChecked.content
    : article.content
  const preSanitizeLength = contentBeforeSanitize.length

  // ── HTML sanitize（DB保存前に必須。生HTMLはDBへもログへも出さない）────────
  let sanitizedContent
  try {
    sanitizedContent = sanitizeArticleHtml(contentBeforeSanitize)
  } catch (err) {
    console.error('❌ sanitize処理で例外が発生しました:', sanitizeLogValue(err?.name ?? 'UnknownError'))
    return 1
  }

  // ── 内部blog linkのwhitelist検証（promptの指示だけに依存しない多層防御）───
  // 存在しない内部リンクを見つけてもrun全体は失敗させない。unwrapして
  // anchor textはそのまま残し、本文自体は削除しない。
  const invalidInternalLinkCount = validateInternalBlogLinks(sanitizedContent, existingSlugs)
    .filter((link) => !link.valid).length
  if (invalidInternalLinkCount > 0) {
    console.warn(`⚠️  存在しない内部blog linkを${invalidInternalLinkCount}件検出しました。リンクのみ除去し、本文（anchor text）は維持します。`)
  }
  try {
    sanitizedContent = unwrapInvalidInternalBlogLinks(sanitizedContent, existingSlugs)
  } catch (err) {
    console.error('❌ 内部link検証処理で例外が発生しました:', sanitizeLogValue(err?.name ?? 'UnknownError'))
    return 1
  }

  const validation = validateSanitizedArticleHtml(sanitizedContent)
  console.log(`🧼 sanitize: ${preSanitizeLength}文字 → ${sanitizedContent.length}文字`)
  if (!validation.ok) {
    console.error(`❌ sanitize後の検証に失敗しました（reason: ${validation.reason}）。DBへは保存しません。`)
    return 1
  }
  console.log('✅ sanitize検証OK（危険要素の残存なし）')

  // ── slugの決定・検証（fail-closed。AI値が不正な場合は近似変換せず終了）─────
  let slug
  if (article.slug !== undefined && article.slug !== null && article.slug !== '') {
    const slugResult = validateSlug(article.slug)
    if (!slugResult.ok) {
      console.error(`❌ slugの検証に失敗しました（reason: ${slugResult.reason}, value: ${sanitizeLogValue(article.slug, 100)}）`)
      return 1
    }
    slug = slugResult.value
  } else {
    slug = `article-${Date.now().toString(36)}`
  }

  // slug重複チェック
  if (existingSlugs.has(slug)) {
    console.warn(`⚠️  slug "${sanitizeLogValue(slug)}" は既存記事と重複しています。サフィックスを付加します。`)
    slug = `${slug}-${Date.now().toString(36)}`
  }

  // 重複回避のサフィックス付加後、最終値を再度検証する（長さ超過等を検知）。
  const finalSlugResult = validateSlug(slug)
  if (!finalSlugResult.ok) {
    console.error(`❌ 最終slugの検証に失敗しました（reason: ${finalSlugResult.reason}）`)
    return 1
  }
  slug = finalSlugResult.value

  const readingMinutes = estimateReadingMinutes(sanitizedContent)
  const readingMinutesResult = validateReadingMinutes(readingMinutes)
  if (!readingMinutesResult.ok) {
    console.error(`❌ reading_minutesの検証に失敗しました（reason: ${readingMinutesResult.reason}）`)
    return 1
  }

  const publishedAt = new Date().toISOString().slice(0, 10)
  const publishedAtResult = validatePublishedAt(publishedAt)
  if (!publishedAtResult.ok) {
    console.error(`❌ published_atの検証に失敗しました（reason: ${publishedAtResult.reason}）`)
    return 1
  }

  console.log(`📝 タイトル: ${sanitizeLogValue(titleResult.value)}`)
  console.log(`🔗 スラグ:   ${sanitizeLogValue(slug)}`)
  console.log(`📂 カテゴリ: ${sanitizeLogValue(categoryResult.value)}`)
  console.log(`⏱  読了時間: 約${readingMinutesResult.value}分`)
  console.log(`📅 投稿日:   ${publishedAtResult.value}`)

  // ── Supabase に INSERT（検証・正規化済みの値だけを使用）─────────────────────
  console.log('💾 Supabase に保存中...')

  const { data, error } = await supabase
    .from('blogs')
    .insert({
      slug,
      title: titleResult.value,
      description: descriptionResult.value,
      category: categoryResult.value,
      published_at: publishedAtResult.value,
      reading_minutes: readingMinutesResult.value,
      content: sanitizedContent,
      og_image: null,
      is_published: true,
    })
    .select('id, slug')
    .single()

  if (error) {
    console.error('❌ Supabase エラー:', sanitizeLogValue(error.message))
    return 1
  }

  console.log(`✅ 保存完了! id=${data.id}`)
  console.log(`🌐 URL: https://www.fitmate.run/blog/${sanitizeLogValue(data.slug)}`)
  return 0
}

const isMainModule = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      console.error('❌ 予期しないエラー:', sanitizeLogValue(err?.name ?? 'UnknownError'))
      process.exitCode = 1
    })
}
