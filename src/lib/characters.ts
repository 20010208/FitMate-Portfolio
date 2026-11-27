export type CharacterId = 'leo' | 'saya' | 'mina'
export type ExpressionId = 'normal' | 'happy' | 'angry' | 'sad' | 'fun'

export type CharacterDef = {
  id: CharacterId
  name: string
  role: string
  goalLabel: string
  goalDescription: string
  goalIcon: string
  accentColor: string
  bgColor: string
  defaultMessages: string[]
}

export function getCharacterImageUrl(id: CharacterId, expression: ExpressionId): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const folder = id.charAt(0).toUpperCase() + id.slice(1) // Leo, Saya, Mina
  return `${base}/storage/v1/object/public/character-images/${folder}/${id}_${expression}.png`
}

export function getRandomExpression(): ExpressionId {
  const list: ExpressionId[] = ['normal', 'happy', 'angry', 'sad', 'fun']
  return list[Math.floor(Math.random() * list.length)]
}

export function getExpressionFromContext({
  currentHour,
  todayEntryCount,
  daysSinceLastEntry,
}: {
  currentHour: number
  todayEntryCount: number
  daysSinceLastEntry: number
}): ExpressionId {
  // 7日以上記入なし → angry（最優先）
  if (daysSinceLastEntry >= 7) return 'angry'
  // 今日2つ以上記入 → fun（時間帯問わず）
  if (todayEntryCount >= 2) return 'fun'
  // 21〜24時
  if (currentHour >= 21) return todayEntryCount >= 1 ? 'happy' : 'sad'
  // 17〜21時
  if (currentHour >= 17) {
    // 同じ入力(currentHour/todayEntryCount/daysSinceLastEntry)なら常に同じ
    // 結果を返す必要があるため、乱数ではなく固定の候補(先頭の'normal')を使う。
    // DashboardClientの初回renderはこの関数をSSR/client双方で呼ぶため、
    // ここで乱数を使うとReact hydration error #418の原因になる。
    if (todayEntryCount === 1) return 'normal'
    return 'sad'
  }
  // 0〜17時
  return 'normal'
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  leo: {
    id: 'leo',
    name: 'レオ',
    role: '熱血トレーナー',
    goalLabel: '筋肥大',
    goalDescription: '筋肉をつけたい・筋トレを頑張りたい',
    goalIcon: '💪',
    accentColor: '#ef4444',
    bgColor: 'rgba(239,68,68,0.08)',
    defaultMessages: [
      'よし、今日も最高のトレーニングをしようぜ！',
      '限界？まだ1回いけるだろ！',
      '停滞してる時期こそ伸びる時だ。',
      'お前はやれる。信じてるぞ！',
      '今日のトレーニング、楽しみにしてたぞ！',
    ],
  },
  saya: {
    id: 'saya',
    name: 'サヤ',
    role: 'ボディメイク女子',
    goalLabel: 'ダイエット',
    goalDescription: '体を絞りたい・ボディメイクをしたい',
    goalIcon: '🔥',
    accentColor: '#a855f7',
    bgColor: 'rgba(168,85,247,0.08)',
    defaultMessages: [
      '一緒に頑張ろうね！継続は必ず自信になるよ♪',
      '昨日より0.2kg増えても大丈夫。週平均で見ようね。',
      '継続できてる時点で偉いよ！',
      '今日も一歩前進！積み重ねが大事だよ♪',
      '焦らなくて大丈夫。着実に変わってるよ！',
    ],
  },
  mina: {
    id: 'mina',
    name: 'ミナ',
    role: '栄養アドバイザー',
    goalLabel: '食事改善',
    goalDescription: 'PFCバランスを整えたい・健康的な食事をしたい',
    goalIcon: '🥗',
    accentColor: '#22c55e',
    bgColor: 'rgba(34,197,94,0.08)',
    defaultMessages: [
      '食事は体をつくる土台です。バランスを意識していきましょう！',
      '今日のPFCバランスをチェックしましたか？',
      'タンパク質を意識した食事で、理想の体に近づきます。',
      '食事の記録が続いていますね。素晴らしいです！',
      '体重より体組成を意識することが大切です。',
    ],
  },
}

export const CHARACTER_LIST = Object.values(CHARACTERS)
