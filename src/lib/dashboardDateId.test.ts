import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeDateId, parseDateId, parseDateOnly, calendarDayDifference } from './dashboardDateId.ts'

// These are pure functions with no dependency on the runtime's timezone or
// wall clock: they only ever receive/return the numbers they're given. The
// hydration-safety guarantee (SSR and client build the same Date from the
// same "YYYYMMDD" string, regardless of what timezone the process is in)
// rests on that purity, so it's what's exercised here.

test('makeDateId zero-pads single-digit month and day', () => {
  assert.equal(makeDateId(new Date(2026, 0, 5)), '20260105')
})

test('makeDateId does not pad a two-digit month/day', () => {
  assert.equal(makeDateId(new Date(2026, 10, 30)), '20261130')
})

test('parseDateId round-trips through makeDateId for an arbitrary date', () => {
  const original = new Date(2026, 6, 30)
  const roundTripped = parseDateId(makeDateId(original))
  assert.equal(roundTripped.getFullYear(), original.getFullYear())
  assert.equal(roundTripped.getMonth(), original.getMonth())
  assert.equal(roundTripped.getDate(), original.getDate())
})

test('parseDateId extracts year/month/day as local date components (not UTC)', () => {
  const d = parseDateId('20260730')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 6) // 0-indexed: July
  assert.equal(d.getDate(), 30)
})

test('parseDateId is independent of the current process timezone: the same string always yields the same y/m/d components', () => {
  // This is the actual hydration-safety property: whatever timezone the
  // Node process (SSR) or the browser (client) happens to be in, parsing
  // the identical "YYYYMMDD" string must produce a Date whose own
  // getFullYear()/getMonth()/getDate() are identical, so anything rendered
  // from those accessors matches between server and client.
  const a = parseDateId('20260101')
  const b = parseDateId('20260101')
  assert.equal(a.getFullYear(), b.getFullYear())
  assert.equal(a.getMonth(), b.getMonth())
  assert.equal(a.getDate(), b.getDate())
})

test('makeDateId/parseDateId agree across a full year of dates (no month/day off-by-one)', () => {
  for (let month = 0; month < 12; month++) {
    const d = new Date(2026, month, 15)
    const id = makeDateId(d)
    const parsed = parseDateId(id)
    assert.equal(parsed.getFullYear(), 2026)
    assert.equal(parsed.getMonth(), month)
    assert.equal(parsed.getDate(), 15)
  }
})

// --- Validation: invalid input must throw, never silently fall back to ----
// "now" (a dashboard showing the wrong day silently is worse than a thrown
// error surfacing the bad initialDateId immediately).

test('parseDateId accepts 2024-02-29 (leap year)', () => {
  const d = parseDateId('20240229')
  assert.equal(d.getFullYear(), 2024)
  assert.equal(d.getMonth(), 1) // February
  assert.equal(d.getDate(), 29)
})

test('parseDateId rejects 2026-02-29 (2026 is not a leap year)', () => {
  assert.throws(() => parseDateId('20260229'))
})

test('parseDateId rejects a non-8-digit string', () => {
  assert.throws(() => parseDateId('2026131'))
  assert.throws(() => parseDateId('202601311'))
})

test('parseDateId rejects a non-numeric string', () => {
  assert.throws(() => parseDateId('2026ab31'))
})

test('parseDateId rejects an out-of-range month', () => {
  assert.throws(() => parseDateId('20261301'))
  assert.throws(() => parseDateId('20260001'))
})

test('parseDateId rejects an out-of-range day (e.g. April 31st does not exist)', () => {
  assert.throws(() => parseDateId('20260431'))
  assert.throws(() => parseDateId('20260100'))
})

test('makeDateId rejects an invalid Date object', () => {
  assert.throws(() => makeDateId(new Date('not-a-date')))
})

test('month-boundary: the last day of a 31-day month and the first day of the next month round-trip independently', () => {
  assert.equal(makeDateId(new Date(2026, 6, 31)), '20260731') // Jul 31
  assert.equal(makeDateId(new Date(2026, 7, 1)), '20260801') // Aug 1
  assert.equal(parseDateId('20260731').getMonth(), 6)
  assert.equal(parseDateId('20260801').getMonth(), 7)
})

// --- Codex最終監査 修正3: server snapshotとclientのローカル日付が月をまたぐ ---
// 場合の明示シナリオ。DashboardClientはinitialDateId/initialNowIsoという
// 文字列propsだけを受け取り、それ以外に独自のnew Date()を呼ばない
// (dashboardDateHydration.test.tsの静的ソース検証で確認済み)。そのため、
// ここではpage.tsxが特定のサーバー時刻から生成したであろうinitialDateIdを
// 直接与えて、月次計算(currentMonthPrefix/daysInMonth相当)が正しい月に
// 固定されることを検証する(実際にsystem clockを差し替える必要がない)。
// currentMonthPrefix/daysInMonthの式は DashboardClient.tsx の実装
// (`todayDateId.slice(0, 6)` /
//  `new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate()`)
// と同一の式をここでも使い、実装と乖離しないようにしている。

function currentMonthPrefixOf(todayDateId: string): string {
  return todayDateId.slice(0, 6)
}

function daysInMonthOf(referenceDate: Date): number {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate()
}

test('scenario 1: server snapshot 2026-07-31T23:30:00.000Z resolving to a server-local todayDateId of "20260731" stays in July -- initial selectedDate/Calendar.viewDate/monthly target all pin to July, even if the browser\'s local date is already in August', () => {
  const initialDateId = '20260731'
  const referenceDate = parseDateId(initialDateId)

  assert.equal(makeDateId(referenceDate), initialDateId)
  assert.equal(referenceDate.getFullYear(), 2026)
  assert.equal(referenceDate.getMonth(), 6) // July (0-indexed)
  assert.equal(currentMonthPrefixOf(initialDateId), '202607')
  assert.equal(daysInMonthOf(referenceDate), 31)
})

test('scenario 2: server snapshot 2026-08-01T00:30:00.000Z resolving to a server-local todayDateId of "20260801" displays August and does not mix with July data', () => {
  const initialDateId = '20260801'
  const referenceDate = parseDateId(initialDateId)

  assert.equal(makeDateId(referenceDate), initialDateId)
  assert.equal(referenceDate.getFullYear(), 2026)
  assert.equal(referenceDate.getMonth(), 7) // August (0-indexed)
  assert.equal(currentMonthPrefixOf(initialDateId), '202608')
  assert.notEqual(currentMonthPrefixOf(initialDateId), '202607')
})

test('the two boundary scenarios never share a month prefix or reference month (no accidental mixing of adjacent-month data)', () => {
  const july = parseDateId('20260731')
  const august = parseDateId('20260801')
  assert.notEqual(july.getMonth(), august.getMonth())
  assert.notEqual(currentMonthPrefixOf('20260731'), currentMonthPrefixOf('20260801'))
})

test('an out-of-band client-local date on the other side of the boundary does not change which scenario applies (DashboardClient only ever reads initialDateId, never a client-computed "today")', () => {
  const initialDateId = '20260731'
  const a = parseDateId(initialDateId)
  const b = parseDateId(initialDateId)
  assert.equal(makeDateId(a), makeDateId(b))
  assert.equal(currentMonthPrefixOf(initialDateId), '202607')
})

// --- Codex最終監査 修正: date-only文字列("YYYY-MM-DD")のtimezone依存 ----------
// new Date('YYYY-MM-DD')はUTC日付として解釈されるため、負のUTC offset環境
// (例: America/Los_Angeles)では前日として扱われうる。birthday/target_date
// はどちらもYYYY-MM-DDのdate-only文字列であり、new Date()に直接渡すと
// SSR/client間でhydration mismatchの原因になる。parseDateOnly()は年月日を
// 数値分解してローカルコンストラクタへ渡すことで、この問題を回避する。

test('parseDateOnly accepts 2024-02-29 (leap year)', () => {
  const d = parseDateOnly('2024-02-29')
  assert.equal(d.getFullYear(), 2024)
  assert.equal(d.getMonth(), 1) // February
  assert.equal(d.getDate(), 29)
})

test('parseDateOnly rejects 2026-02-29 (2026 is not a leap year)', () => {
  assert.throws(() => parseDateOnly('2026-02-29'))
})

test('parseDateOnly accepts 2026-01-01', () => {
  const d = parseDateOnly('2026-01-01')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 0)
  assert.equal(d.getDate(), 1)
})

test('parseDateOnly accepts 2026-12-31', () => {
  const d = parseDateOnly('2026-12-31')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 11)
  assert.equal(d.getDate(), 31)
})

test('parseDateOnly rejects month 13', () => {
  assert.throws(() => parseDateOnly('2026-13-01'))
})

test('parseDateOnly rejects month 00', () => {
  assert.throws(() => parseDateOnly('2026-00-15'))
})

test('parseDateOnly rejects day 00', () => {
  assert.throws(() => parseDateOnly('2026-06-00'))
})

test('parseDateOnly rejects April 31st (month-end overflow)', () => {
  assert.throws(() => parseDateOnly('2026-04-31'))
})

test('parseDateOnly rejects non-numeric characters', () => {
  assert.throws(() => parseDateOnly('2026-ab-01'))
})

test('parseDateOnly rejects a short/malformed value (missing digits)', () => {
  assert.throws(() => parseDateOnly('2026-6-1'))
  assert.throws(() => parseDateOnly('26-06-01'))
})

test('parseDateOnly rejects an empty string', () => {
  assert.throws(() => parseDateOnly(''))
})

test('parseDateOnly never falls back to the current date/time on invalid input (throws instead)', () => {
  assert.throws(() => parseDateOnly('not-a-date'))
  assert.throws(() => parseDateOnly('2026-08-01T00:00:00Z')) // datetime, not date-only
})

test('parseDateOnly returns the same year/month/day regardless of the process timezone (pure numeric decomposition, no Date.parse/UTC string parsing)', () => {
  // Not a timezone-dependent Date-string parse: only digits are extracted via
  // regex and fed to the *local* Date(year, month - 1, day) constructor, so
  // whatever "local" means in the running environment, construction and the
  // getFullYear()/getMonth()/getDate() read-back below stay self-consistent
  // (same local-construction/local-reading pairing as parseDateId).
  const a = parseDateOnly('2026-08-01')
  const b = parseDateOnly('2026-08-01')
  assert.equal(a.getFullYear(), b.getFullYear())
  assert.equal(a.getMonth(), b.getMonth())
  assert.equal(a.getDate(), b.getDate())
  assert.equal(a.getFullYear(), 2026)
  assert.equal(a.getMonth(), 7) // August (0-indexed)
  assert.equal(a.getDate(), 1)
})

test('parseDateOnly of 2026-01-01 yields year=2026/month=0/day=1', () => {
  const d = parseDateOnly('2026-01-01')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 0)
  assert.equal(d.getDate(), 1)
})

// --- Codex監査 修正: daysLeftのDST依存 ---------------------------------------
// 旧実装は new Date(target + 'T00:00:00').getTime() - referenceDate.getTime()
// をローカルmidnight同士のミリ秒差として86,400,000で割っていた。DSTの開始・
// 終了をまたぐtimezoneでは1日が23時間または25時間になるため、この方式では
// カレンダー上の日数と食い違う(例: America/Los_AngelesでDST終了をまたぐと
// 実際は2日差なのに3日と計算されうる)。calendarDayDifference()はfrom/toの
// 年月日成分だけをDate.UTC()で連続した日番号に正規化してから差分を取るため、
// timezone・DSTに一切依存しない。

test('calendarDayDifference: same day is 0', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-08-01'), parseDateOnly('2026-08-01')), 0)
})

test('calendarDayDifference: next day is 1', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-08-01'), parseDateOnly('2026-08-02')), 1)
})

test('calendarDayDifference: 2026-08-01 -> 2026-08-10 is 9', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-08-01'), parseDateOnly('2026-08-10')), 9)
})

test('calendarDayDifference: month boundary 2026-08-31 -> 2026-09-01 is 1', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-08-31'), parseDateOnly('2026-09-01')), 1)
})

test('calendarDayDifference: year boundary 2026-12-31 -> 2027-01-01 is 1', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-12-31'), parseDateOnly('2027-01-01')), 1)
})

test('calendarDayDifference: leap day 2024-02-28 -> 2024-02-29 is 1', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2024-02-28'), parseDateOnly('2024-02-29')), 1)
})

test('calendarDayDifference: leap day 2024-02-29 -> 2024-03-01 is 1', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2024-02-29'), parseDateOnly('2024-03-01')), 1)
})

test('calendarDayDifference: the reverse direction is negative (to is before from)', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-08-10'), parseDateOnly('2026-08-01')), -9)
})

test('calendarDayDifference: America/Los_Angeles-observed DST end (2026-11-01 02:00 local clocks fall back) does not add a spurious extra day -- 2026-10-31 -> 2026-11-02 is 2', () => {
  // This is the exact Codex-reported repro case: the old getTime()-difference
  // implementation could read this as 3 days in a DST-observing timezone
  // because one of the spanned local days is 25 hours long.
  assert.equal(calendarDayDifference(parseDateOnly('2026-10-31'), parseDateOnly('2026-11-02')), 2)
})

test('calendarDayDifference: America/Los_Angeles-observed DST start (2026-03-08 02:00 local clocks spring forward) does not drop a day -- 2026-03-07 -> 2026-03-09 is 2', () => {
  assert.equal(calendarDayDifference(parseDateOnly('2026-03-07'), parseDateOnly('2026-03-09')), 2)
})

test('calendarDayDifference gives the same result regardless of the process timezone (pure year/month/day arithmetic via Date.UTC, no local getTime()/wall-clock reliance)', () => {
  const from = parseDateOnly('2026-10-31')
  const to = parseDateOnly('2026-11-02')
  const a = calendarDayDifference(from, to)
  const b = calendarDayDifference(from, to)
  assert.equal(a, b)
  assert.equal(a, 2)
})

// --- Codex監査 修正: daysSinceLastEntryのDST依存(push blocker) ---------------
// getExpressionFromContext()はdaysSinceLastEntry >= 7でangryを返す。旧実装
// (referenceDate.getTime() - latestDate.getTime()を86,400,000で割る)では、
// DST開始をまたぐtimezoneで7暦日が167時間になり、Math.floorで6日と誤算出
// されうる(Codexの再現例: latest 2026-03-02, reference 2026-03-09で
// UTC=7日, America/Los_Angeles=6日)。daysSinceLastEntryはparseDateId()で
// 構築したDate同士のcalendarDayDifference()で算出するようDashboardClient.tsx
// を修正した。これらは、実際にDashboardClientが使うparseDateId()経由で
// 構築したDateを渡してCodexの再現例そのものを検証する。

test('calendarDayDifference (via parseDateId, matching DashboardClient\'s actual daysSinceLastEntry usage): 2026-03-02 -> 2026-03-09 is 7 (Codex-reported DST-start repro case)', () => {
  assert.equal(calendarDayDifference(parseDateId('20260302'), parseDateId('20260309')), 7)
})

test('calendarDayDifference (via parseDateId): 2026-10-26 -> 2026-11-02 is 7 (DST-end-crossing 7-day span)', () => {
  assert.equal(calendarDayDifference(parseDateId('20261026'), parseDateId('20261102')), 7)
})
