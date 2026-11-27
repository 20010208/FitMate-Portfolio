import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// DashboardClient.tsx contains JSX, which Node's built-in TypeScript
// stripping does not compile, so it cannot be imported directly under
// `node --test` (same constraint documented in dashboardDateHydration.test.ts
// and CharacterSidebar.test.ts). calcAge() itself has no JSX and no type
// annotations inside its body, so its exact source is extracted and executed
// via `new Function(...)` here -- this exercises the real shipped
// implementation (not a re-typed duplicate of the logic), while staying
// within the repo's established "no JSX import" constraint.
//
// calcAge() now calls parseDateOnly() (from dashboardDateId.ts) instead of
// new Date(birthday) directly (Codex-audit fix: new Date('YYYY-MM-DD') is
// parsed as UTC, so a negative-UTC-offset environment could read it back as
// the previous day, changing the computed age between SSR and the client's
// first render). Adding a relative `./dashboardDateId.ts` import here would
// add a new standalone-typecheck TS5097 occurrence (this repo's
// moduleResolution:"bundler" tsconfig rejects the explicit .ts extension
// that node's test runner requires at runtime -- see dashboardDateId.test.ts
// for the one already-accepted occurrence of this structural trade-off), so
// parseDateOnly's real source is extracted the same way calcAge's is, and
// wired in via globalThis so the extracted calcAge body can call it exactly
// as it does in the real component.

const componentDir = path.dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(path.join(componentDir, 'DashboardClient.tsx'), 'utf8')
const dateIdLibSource = readFileSync(path.resolve(componentDir, '../../lib/dashboardDateId.ts'), 'utf8')

// --- Extract the real parseDateOnly() (+ its isValidYearMonthDay/DATE_ONLY_PATTERN dependencies) from dashboardDateId.ts ---
const depsStart = dateIdLibSource.indexOf('function isValidYearMonthDay')
const parseDateOnlyStart = dateIdLibSource.indexOf('export function parseDateOnly')
assert.ok(depsStart !== -1 && parseDateOnlyStart !== -1, 'parseDateOnly/isValidYearMonthDay source not found in dashboardDateId.ts')
const parseDateOnlyMatch = dateIdLibSource.slice(parseDateOnlyStart).match(/export function parseDateOnly\(value: string\): Date \{[\s\S]*?\n\}/)
assert.ok(parseDateOnlyMatch, 'parseDateOnly function body not found')

// `new Function` runs plain JavaScript, not TypeScript, so the extracted
// source's parameter/return type annotations (which node's built-in TS
// stripping normally removes when the real .ts file is loaded) must be
// stripped first. These are exact-string replacements against the known,
// authored signatures below (not a generic regex) so a change to unrelated
// body code elsewhere in the file can't silently corrupt the extraction.
const combinedDateIdSource = (dateIdLibSource.slice(depsStart, parseDateOnlyStart) + parseDateOnlyMatch![0])
  .replace(/^export /gm, '')
  .replace('function isValidYearMonthDay(year: number, month: number, day: number): boolean {', 'function isValidYearMonthDay(year, month, day) {')
  .replace('function isValidDateId(dateId: string): boolean {', 'function isValidDateId(dateId) {')
  .replace('function makeDateId(date: Date): string {', 'function makeDateId(date) {')
  .replace('function parseDateId(dateId: string): Date {', 'function parseDateId(dateId) {')
  .replace('function parseDateOnly(value: string): Date {', 'function parseDateOnly(value) {')
  + '\nreturn parseDateOnly'

assert.equal(/:\s*(number|string|Date|boolean)\b/.test(combinedDateIdSource), false, 'TypeScript type annotations were not fully stripped from the extracted source')

const parseDateOnly = new Function(combinedDateIdSource)() as (value: string) => Date

// Sanity-check the extraction actually captured the real, validating implementation.
assert.equal(parseDateOnly('2026-08-01').getMonth(), 7)
assert.throws(() => parseDateOnly('2026-02-29'))

// --- Extract the real calcAge() from DashboardClient.tsx, wiring in the real parseDateOnly via globalThis ---
const calcAgeMatch = clientSource.match(/function calcAge\(birthday: string, referenceDate: Date\): number \{([\s\S]*?)\n\}/)
assert.ok(calcAgeMatch, 'calcAge source not found in DashboardClient.tsx')
const calcAgeBody = calcAgeMatch![1]
assert.equal(calcAgeBody.includes('new Date(birthday)'), false, 'calcAge must not call new Date(birthday) directly (timezone-unsafe for a YYYY-MM-DD date-only string)')
assert.match(calcAgeBody, /parseDateOnly\(birthday\)/)

;(globalThis as unknown as { parseDateOnly: typeof parseDateOnly }).parseDateOnly = parseDateOnly
const calcAge = new Function('birthday', 'referenceDate', calcAgeBody) as (birthday: string, referenceDate: Date) => number

test('calcAge computes age using the explicit referenceDate, not the real current time', () => {
  const referenceDate = new Date(2026, 5, 15) // 2026-06-15
  assert.equal(calcAge('2000-06-15', referenceDate), 26) // birthday exactly on referenceDate
  assert.equal(calcAge('2000-06-16', referenceDate), 25) // birthday not yet reached this year
  assert.equal(calcAge('2000-06-14', referenceDate), 26) // birthday already passed this year
})

test('calcAge gives the same result no matter when in real wall-clock time it is called (pure function of its arguments)', () => {
  const referenceDate = new Date(2026, 0, 1)
  const first = calcAge('1990-01-01', referenceDate)
  // Busy-wait briefly so real time actually advances between calls.
  const until = Date.now() + 5
  while (Date.now() < until) { /* spin */ }
  const second = calcAge('1990-01-01', referenceDate)
  assert.equal(first, second)
  assert.equal(first, 36)
})

test('calcAge handles a reference date whose year differs from the birthday\'s year (crossing multiple years)', () => {
  const referenceDate = new Date(2026, 5, 15) // 2026-06-15, same month/day as the birthday below
  assert.equal(calcAge('1995-06-15', referenceDate), 31)
})

test('calcAge never returns a negative age', () => {
  const referenceDate = new Date(2026, 0, 1)
  assert.equal(calcAge('2030-01-01', referenceDate), 0)
})

// --- Codex最終監査 修正: birthdayのdate-only文字列解析がtimezoneに依存しない ---
// new Date('YYYY-MM-DD')は無し(UTC解釈による前日ズレのリスク)。parseDateOnly
// は年月日を数値分解してローカルコンストラクタへ渡すため、プロセスの
// timezone設定に関係なく同じ年月日として扱われる。このWindows開発機では、
// Git Bash経由でTZ環境変数を切り替えても期待どおり反映されない場合がある
// 一方、PowerShell経由ではUTC/America/Los_Angeles/Asia/Tokyo/Asia/Kuala_Lumpur
// のいずれもNodeへ正しく反映されることを実測で確認済み(実際に
// Intl.DateTimeFormat().resolvedOptions().timeZoneで確認したうえで、
// parseDateOnly/calendarDayDifferenceを使う同種のテスト
// (dashboardDateId.test.ts / characters.test.ts)をこれら4timezoneで
// 実行しすべてpassしている)。calcAge自身のtimezone非依存性は、この
// ファイルでは「timezone依存のDate文字列解析(new Date('YYYY-MM-DD')や
// Date.parse)を一切使っていないこと」を静的に確認し、加えて「同じ年月日
// 入力から常に同じ結果を返す」という純粋関数としての性質を検証すること
// (下記テスト)で確認している。すなわちtimezone非依存性は、純粋関数の
// 設計と、複数timezoneでの実行結果(前述の姉妹テストファイル側)の両方で
// 確認されている。

test('calcAge does not use any timezone-dependent date-only string parsing (new Date(birthday), Date.parse, or new Date("YYYY-MM-DD"))', () => {
  assert.equal(calcAgeBody.includes('new Date(birthday)'), false)
  assert.equal(calcAgeBody.includes('Date.parse'), false)
})

test('calcAge: birthday 2000-08-02, referenceDate 2026-08-01 -> 25 (birthday not yet reached)', () => {
  assert.equal(calcAge('2000-08-02', new Date(2026, 7, 1)), 25)
})

test('calcAge: birthday 2000-08-02, referenceDate 2026-08-02 -> 26 (birthday exactly today)', () => {
  assert.equal(calcAge('2000-08-02', new Date(2026, 7, 2)), 26)
})

test('calcAge: birthday 2000-01-01, referenceDate 2026-01-01 -> 26', () => {
  assert.equal(calcAge('2000-01-01', new Date(2026, 0, 1)), 26)
})

test('calcAge: a birthday in the future relative to referenceDate is always 0', () => {
  assert.equal(calcAge('2099-01-01', new Date(2026, 0, 1)), 0)
})

test('calcAge gives identical results for the same birthday/referenceDate pair when parseDateOnly is re-invoked independently each time (this file exercises the pure-function-purity angle; real multi-timezone execution of the same parseDateOnly/calendarDayDifference logic is covered in dashboardDateId.test.ts / characters.test.ts -- see the comment block above)', () => {
  const results = new Set(Array.from({ length: 20 }, () => calcAge('2000-08-02', new Date(2026, 7, 1))))
  assert.equal(results.size, 1)
  assert.equal([...results][0], 25)
})
