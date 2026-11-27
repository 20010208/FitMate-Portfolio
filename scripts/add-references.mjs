/**
 * 既存記事に参考文献セクションを追加する
 * 実行: node --env-file=.env.local scripts/add-references.mjs
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = (process.env.SUPABASE_SECRET_KEY || '').trim()
if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

// ─── 公式ソース定義 ────────────────────────────────────────────────
const SRC = {
  eatRules: '<li><a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyunn.html" target="_blank" rel="noopener noreferrer">厚生労働省 - 日本人の食事摂取基準（2020年版）</a></li>',
  eHealth:  '<li><a href="https://www.e-healthnet.mhlw.go.jp/" target="_blank" rel="noopener noreferrer">e-ヘルスネット（厚生労働省） - 健康・栄養に関する情報</a></li>',
  nibiohn:  '<li><a href="https://www.nibiohn.go.jp/" target="_blank" rel="noopener noreferrer">国立健康・栄養研究所 - 健康・栄養情報</a></li>',
  balance:  '<li><a href="https://www.maff.go.jp/j/balance_guide/" target="_blank" rel="noopener noreferrer">農林水産省 - 食事バランスガイド</a></li>',
}

function makeRefHtml(items) {
  return `<div class="blog-references"><h3>参考資料</h3><p>本記事の情報は以下の公式資料をもとに作成しています。</p><ul>${items.join('')}</ul></div>`
}

// ─── 記事ごとの参考文献設定 ──────────────────────────────────────
const REFS = {
  'pfc-balance-keisan-houhou':           makeRefHtml([SRC.eatRules, SRC.eHealth, SRC.balance]),
  'conbini-high-protein-shokuhin':       makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'conbini-muscle-training-timing':      makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'conbini-diet-low-calorie':            makeRefHtml([SRC.eHealth, SRC.balance]),
  'creatine-effect-usage-guide':         makeRefHtml([SRC.nibiohn, SRC.eHealth]),
  'hiit-nutrition-timing-guide':         makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'conbini-sweets-diet-guide':           makeRefHtml([SRC.eHealth, SRC.balance]),
  'diet-friendly-dining-out-guide':      makeRefHtml([SRC.eHealth, SRC.balance]),
  'convenience-store-sweets-diet-guide': makeRefHtml([SRC.eHealth, SRC.balance]),
  'beginner-workout-diet-menu':          makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'beginner-workout-nutrition-guide':    makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'women-strength-training-nutrition-guide': makeRefHtml([SRC.eatRules, SRC.eHealth]),
  'supplement-choice-guide':             makeRefHtml([SRC.nibiohn, SRC.eHealth]),
  'diet-outside-dining-guide':           makeRefHtml([SRC.eHealth, SRC.balance]),
  'bulk-up-meal-plan-one-day':           makeRefHtml([SRC.eatRules, SRC.eHealth]),
}

// ─── 全記事取得・更新 ─────────────────────────────────────────────
const { data, error } = await sb
  .from('blogs')
  .select('id, slug, content')
  .eq('is_published', true)

if (error) { console.error(error); process.exit(1) }

let updated = 0
for (const post of data) {
  if (post.content.includes('blog-references')) {
    console.log(`⏭  スキップ（既存）: ${post.slug}`)
    continue
  }
  const ref = REFS[post.slug]
  if (!ref) {
    console.log(`⚠  定義なし: ${post.slug}`)
    continue
  }
  const newContent = post.content + ref
  const { error: upErr } = await sb.from('blogs').update({ content: newContent }).eq('id', post.id)
  if (upErr) {
    console.error(`✗ 失敗: ${post.slug}`, upErr)
  } else {
    console.log(`✓ 更新: ${post.slug}`)
    updated++
  }
}
console.log(`\n完了: ${updated}/${data.length}件更新`)
