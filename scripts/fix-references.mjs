/**
 * 全記事の参考文献URLを正しいものに修正する
 * 実行: node --env-file=.env.local scripts/fix-references.mjs
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = (process.env.SUPABASE_SECRET_KEY || '').trim()
if (!url || !key) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

// 旧URL → 新URLの置換マップ（href属性のURLとラベルをまとめて置換）
const REPLACEMENTS = [
  // 食事摂取基準: 404 → 正しいURL
  {
    from: 'href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/syokuji_kijyunn.html"',
    to:   'href="https://www.mhlw.go.jp/stf/newpage_08517.html"',
  },
  {
    from: '厚生労働省 - 日本人の食事摂取基準（2020年版）',
    to:   '厚生労働省 - 日本人の食事摂取基準（2020年版）策定検討会報告書',
  },
  // e-ヘルスネット: 廃止 → 厚生労働省 栄養・食育対策ページ
  {
    from: 'href="https://www.e-healthnet.mhlw.go.jp/"',
    to:   'href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/kenkou/eiyou/index.html"',
  },
  {
    from: 'e-ヘルスネット（厚生労働省） - 健康・栄養に関する情報',
    to:   '厚生労働省 - 栄養・食育対策',
  },
  // 国立健康・栄養研究所: nibiohn.go.jp → nibn.go.jp
  {
    from: 'href="https://www.nibiohn.go.jp/"',
    to:   'href="https://www.nibn.go.jp/"',
  },
  {
    from: '国立健康・栄養研究所 - 健康・栄養情報',
    to:   '国立研究開発法人 医薬基盤・健康・栄養研究所',
  },
]

const { data, error } = await sb
  .from('blogs')
  .select('id, slug, content')
  .eq('is_published', true)

if (error) { console.error(error); process.exit(1) }

let updated = 0
for (const post of data) {
  let content = post.content
  let changed = false

  for (const { from, to } of REPLACEMENTS) {
    if (content.includes(from)) {
      content = content.split(from).join(to)
      changed = true
    }
  }

  if (!changed) {
    console.log(`⏭  変更なし: ${post.slug}`)
    continue
  }

  const { error: upErr } = await sb.from('blogs').update({ content }).eq('id', post.id)
  if (upErr) {
    console.error(`✗ 失敗: ${post.slug}`, upErr)
  } else {
    console.log(`✓ 修正: ${post.slug}`)
    updated++
  }
}
console.log(`\n完了: ${updated}件修正`)
