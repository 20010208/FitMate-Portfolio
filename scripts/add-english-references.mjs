/**
 * 既存記事の参考文献セクションに英語の一次情報源を追加する
 * 実行: node --env-file=.env.local scripts/add-english-references.mjs
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = (process.env.SUPABASE_SECRET_KEY || '').trim()
if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

// ─── 英語ソース定義 ─────────────────────────────────────────────────
const EN = {
  who:       '<li><a href="https://www.who.int/news-room/fact-sheets/detail/healthy-diet" target="_blank" rel="noopener noreferrer">World Health Organization (WHO) – Healthy diet</a></li>',
  nih:       '<li><a href="https://www.nih.gov/" target="_blank" rel="noopener noreferrer">National Institutes of Health (NIH) – Health Information</a></li>',
  nihOds:    '<li><a href="https://ods.od.nih.gov/" target="_blank" rel="noopener noreferrer">NIH Office of Dietary Supplements – Supplement & Nutrition Research</a></li>',
  usda:      '<li><a href="https://fdc.nal.usda.gov/" target="_blank" rel="noopener noreferrer">USDA FoodData Central – Food Composition Database</a></li>',
  nutritionGov: '<li><a href="https://www.nutrition.gov/" target="_blank" rel="noopener noreferrer">Nutrition.gov (USDA) – Nutrition Information</a></li>',
  cdc:       '<li><a href="https://www.cdc.gov/nutrition/" target="_blank" rel="noopener noreferrer">Centers for Disease Control and Prevention (CDC) – Nutrition</a></li>',
  efsa:      '<li><a href="https://www.efsa.europa.eu/" target="_blank" rel="noopener noreferrer">European Food Safety Authority (EFSA) – Science, Safe Food, Sustainability</a></li>',
  nhs:       '<li><a href="https://www.nhs.uk/live-well/eat-well/" target="_blank" rel="noopener noreferrer">NHS (UK National Health Service) – Eat well</a></li>',
  acsm:      '<li><a href="https://www.acsm.org/" target="_blank" rel="noopener noreferrer">American College of Sports Medicine (ACSM)</a></li>',
  pubmed:    '<li><a href="https://pubmed.ncbi.nlm.nih.gov/" target="_blank" rel="noopener noreferrer">PubMed – National Library of Medicine Research Database</a></li>',
}

// ─── 記事ごとの追加ソース ────────────────────────────────────────────
const ADDITIONS = {
  // PFC・カロリー計算
  'pfc-balance-keisan-houhou':           [EN.who, EN.usda],
  // 高タンパク食品
  'conbini-high-protein-shokuhin':       [EN.usda, EN.nihOds],
  // 筋トレ前後のタイミング
  'conbini-muscle-training-timing':      [EN.acsm, EN.usda],
  // 低カロリーダイエット
  'conbini-diet-low-calorie':            [EN.who, EN.nhs],
  // クレアチン（サプリ）
  'creatine-effect-usage-guide':         [EN.nihOds, EN.acsm, EN.pubmed],
  // HIIT・トレーニング栄養
  'hiit-nutrition-timing-guide':         [EN.acsm, EN.pubmed],
  // コンビニスイーツ（ダイエット）
  'conbini-sweets-diet-guide':           [EN.who, EN.nhs],
  // 外食ダイエット
  'diet-friendly-dining-out-guide':      [EN.who, EN.nhs],
  // コンビニスイーツ（別記事）
  'convenience-store-sweets-diet-guide': [EN.who, EN.cdc],
  // 筋トレ初心者食事
  'beginner-workout-diet-menu':          [EN.acsm, EN.nihOds],
  // 筋トレ初心者栄養
  'beginner-workout-nutrition-guide':    [EN.acsm, EN.nihOds],
  // 女性筋トレ・食事
  'women-strength-training-nutrition-guide': [EN.who, EN.acsm],
  // サプリメント
  'supplement-choice-guide':             [EN.nihOds, EN.acsm, EN.pubmed],
  // 外食ダイエット（別記事）
  'diet-outside-dining-guide':           [EN.who, EN.nhs],
  // バルクアップ食事
  'bulk-up-meal-plan-one-day':           [EN.acsm, EN.usda],
}

// ─── 取得・更新 ──────────────────────────────────────────────────────
const { data, error } = await sb
  .from('blogs')
  .select('id, slug, content')
  .eq('is_published', true)

if (error) { console.error(error); process.exit(1) }

let updated = 0
for (const post of data) {
  const additions = ADDITIONS[post.slug]
  if (!additions) {
    console.log(`⚠  定義なし: ${post.slug}`)
    continue
  }

  if (!post.content.includes('blog-references')) {
    console.log(`⚠  参考文献セクションなし: ${post.slug}`)
    continue
  }

  // 既に英語ソースが含まれていればスキップ
  if (post.content.includes('who.int') || post.content.includes('nih.gov') || post.content.includes('acsm.org')) {
    console.log(`⏭  スキップ（英語ソース追加済み）: ${post.slug}`)
    continue
  }

  // </ul></div> の直前に新しい <li> を挿入
  const marker = '</ul></div>'
  if (!post.content.includes(marker)) {
    console.log(`⚠  マーカーが見つからない: ${post.slug}`)
    continue
  }

  const newItems = additions.join('')
  const newContent = post.content.replace(marker, `${newItems}${marker}`)

  const { error: upErr } = await sb.from('blogs').update({ content: newContent }).eq('id', post.id)
  if (upErr) {
    console.error(`✗ 失敗: ${post.slug}`, upErr)
  } else {
    console.log(`✓ 更新 (+${additions.length}件): ${post.slug}`)
    updated++
  }
}

console.log(`\n完了: ${updated}/${data.length}件更新`)
