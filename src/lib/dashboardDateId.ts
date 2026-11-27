// "YYYYMMDD" 形式の日付idと Date の相互変換。DashboardClient/Calendar が
// SSRとclient初回renderで同じ日付を描画するために使う（render中に独自の
// new Date()を呼ぶとサーバーとブラウザのタイムゾーン差でhydration mismatchの
// 原因になるため、常にこの決定的な変換経由で日付を扱う）。

// year/month(1-12)/day(1-31)の組が実在する日付か(閏年含む)を検証する共通ロジック。
// "YYYYMMDD"("dateId")と"YYYY-MM-DD"(date-only文字列)の両方の検証で使う。
function isValidYearMonthDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1) return false
  const lastDayOfMonth = new Date(year, month, 0).getDate()
  return day <= lastDayOfMonth
}

// "YYYYMMDD" の桁数・月範囲・実在する日付(閏年含む)かを検証する。
// 不正な値はnew Date()等へ黙ってfallbackせず、呼び出し元で気づけるようthrowする。
function isValidDateId(dateId: string): boolean {
  if (!/^\d{8}$/.test(dateId)) return false
  const year = parseInt(dateId.slice(0, 4), 10)
  const month = parseInt(dateId.slice(4, 6), 10)
  const day = parseInt(dateId.slice(6, 8), 10)
  return isValidYearMonthDay(year, month, day)
}

export function makeDateId(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('makeDateId: invalid Date')
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

export function parseDateId(dateId: string): Date {
  if (!isValidDateId(dateId)) {
    throw new Error(`parseDateId: invalid dateId "${dateId}"`)
  }
  const year = parseInt(dateId.slice(0, 4), 10)
  const month = parseInt(dateId.slice(4, 6), 10)
  const day = parseInt(dateId.slice(6, 8), 10)
  return new Date(year, month - 1, day)
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// "YYYY-MM-DD" 形式の日付文字列(birthday/target_date等)を「年月日だけを持つ
// ローカル日付」として解析する。new Date('YYYY-MM-DD')はUTC日付として解釈される
// ため、負のUTC offset環境では前日として扱われ、SSR/client間でhydration
// mismatchの原因になる。年月日を数値分解してローカルコンストラクタ
// (new Date(year, month - 1, day))へ渡すことで、timezoneに関係なく常に同じ
// 年月日成分を返す。不正な値はparseDateId同様、現在日時へ黙ってfallbackせず
// throwする。
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    throw new Error(`parseDateOnly: invalid date-only string "${value}"`)
  }
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  if (!isValidYearMonthDay(year, month, day)) {
    throw new Error(`parseDateOnly: invalid date-only string "${value}"`)
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`parseDateOnly: round-trip mismatch for "${value}"`)
  }
  return date
}

// from/toの「暦日としての差」を返す(from→toが未来なら正、過去なら負)。
// ローカルmidnight同士のgetTime()差を86,400,000で割る方式は、DST(サマータイム)
// の開始・終了をまたぐtimezoneでは1日が23時間または25時間になるため、
// カレンダー上の日数と食い違う(例: America/Los_AngelesでDST終了をまたぐと
// 実際は2日差なのに3日と計算されうる)。ここではfrom/toそれぞれの年月日
// 成分だけをDate.UTC()で連続した日番号に正規化してから差分を取ることで、
// timezone・DSTに関係なく常に正しい暦日差になる。Date.UTCは検証済みの
// year/month/day成分を日番号へ変換するためだけに使い、date-only文字列の
// UTC解析(new Date('YYYY-MM-DD')等)は行わない。
export function calendarDayDifference(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((toUtc - fromUtc) / 86400000)
}
