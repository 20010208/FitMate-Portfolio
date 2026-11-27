// 文部科学省「日本食品標準成分表2020年版（八訂）」を food_items テーブルに自炊データとして投入
// 出典: https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html
const XLSX = require('xlsx')
const https = require('https')
const fs = require('fs')

const SUPABASE_URL = 'https://ctgysnujraekjtuqocgc.supabase.co'
// Supabase管理接続にはSecret Keyのみを使用する。値はsource controlへ保存しない。
const SUPABASE_ADMIN_KEY = (process.env.SUPABASE_SECRET_KEY || '').trim()
if (!SUPABASE_ADMIN_KEY) {
  console.error('SUPABASE_SECRET_KEY is required.')
  process.exit(1)
}

// Supabase管理接続はapikeyヘッダーのみを使用する
function supabaseAuthHeaders(key) {
  return { apikey: key }
}

const TMP = 'C:/Users/chiji/AppData/Local/Temp/mext-foods.xlsx'
const XLSX_URL = 'https://www.mext.go.jp/content/20201225-mxt_kagsei-mext_01110_012.xlsx'

const GROUP_MAP = {
  '01': '穀類',
  '02': 'いも・でん粉類',
  '03': '砂糖・甘味料',
  '04': '豆類',
  '05': '種実類',
  '06': '野菜類',
  '07': '果実類',
  '08': 'きのこ類',
  '09': '藻類',
  '10': '魚介類',
  '11': '肉類',
  '12': '卵類',
  '13': '乳類',
  '14': '油脂類',
  '15': '菓子類',
  '16': '嗜好飲料類',
  '17': '調味料・香辛料',
  '18': '調理済み食品',
}

// 全グループを含む（絞り込まない）
const ALLOWED_GROUPS = new Set(Object.keys(GROUP_MAP))

function dl(url, dest, cb) {
  const file = fs.createWriteStream(dest)
  https.get(url, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close()
      fs.unlinkSync(dest)
      return dl(res.headers.location, dest, cb)
    }
    res.pipe(file)
    file.on('finish', () => { file.close(); cb() })
  }).on('error', err => { console.error('Download error:', err); process.exit(1) })
}

function toNum(v) {
  if (v === null || v === undefined || v === '' || v === 'Tr' || v === '−' || v === '-') return ''
  const s = String(v).replace(/[()（）\s]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? '' : String(n)
}

async function supabaseInsert(rows) {
  const BATCH = 200
  let total = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const body = JSON.stringify(batch)
    await new Promise((resolve, reject) => {
      const url = new URL(`${SUPABASE_URL}/rest/v1/food_items`)
      const opts = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...supabaseAuthHeaders(SUPABASE_ADMIN_KEY),
          'Prefer': 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      }
      const req = https.request(opts, res => {
        let data = ''
        res.on('data', d => data += d)
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            total += batch.length
            console.log(`  Inserted batch ${Math.floor(i/BATCH)+1}: ${total} rows total`)
            resolve()
          } else {
            console.error('Insert error', res.statusCode, data)
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }
  return total
}

async function deleteExisting() {
  console.log('既存の自炊データを削除中...')
  const url = new URL(`${SUPABASE_URL}/rest/v1/food_items?brand=eq.自炊`)
  await new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'DELETE',
      headers: {
        ...supabaseAuthHeaders(SUPABASE_ADMIN_KEY),
        'Prefer': 'return=minimal',
      },
    }
    const req = https.request(opts, res => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('既存データ削除完了')
          resolve()
        } else {
          console.error('Delete error', res.statusCode, data)
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function parse() {
  const wb = XLSX.readFile(TMP)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  console.log(`総行数: ${rows.length}`)

  const items = []
  let skipped = 0

  for (let i = 12; i < rows.length; i++) {
    const row = rows[i]
    // 食品群番号が空の行はスキップ
    if (!row[0] || row[0] === '') { skipped++; continue }

    const groupId = String(row[0]).padStart(2, '0')
    if (!ALLOWED_GROUPS.has(groupId)) { skipped++; continue }

    const name = String(row[3] || '').trim()
    if (!name) { skipped++; continue }

    const calorie = toNum(row[6])
    const protein = toNum(row[9])
    const fat = toNum(row[12])
    const carbohydrate = toNum(row[20])

    // カロリーが取れない行は除外（ — や空のもの）
    if (calorie === '') { skipped++; continue }

    items.push({
      name,
      brand: '自炊',
      category: GROUP_MAP[groupId] || '',
      amount: '100',
      calorie,
      protein,
      fat,
      carbohydrate,
    })
  }

  console.log(`変換完了: ${items.length}件 (スキップ: ${skipped}件)`)

  // グループ別集計
  const byGroup = {}
  for (const item of items) {
    byGroup[item.category] = (byGroup[item.category] || 0) + 1
  }
  console.log('カテゴリ別:', JSON.stringify(byGroup, null, 2))

  return items
}

async function main() {
  if (!fs.existsSync(TMP)) {
    console.log('Excelファイルをダウンロード中...')
    await new Promise(resolve => dl(XLSX_URL, TMP, resolve))
    console.log('ダウンロード完了')
  } else {
    console.log('既存ファイルを使用:', TMP)
  }

  const items = parse()

  await deleteExisting()

  console.log(`${items.length}件をSupabaseに投入中...`)
  const inserted = await supabaseInsert(items)
  console.log(`\n完了: ${inserted}件を food_items に投入しました (brand=自炊)`)
}

main().catch(err => { console.error(err); process.exit(1) })
