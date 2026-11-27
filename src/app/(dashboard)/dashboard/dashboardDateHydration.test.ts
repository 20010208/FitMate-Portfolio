import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks only, for the same reason as publicBlogCache.test.ts:
// these are .tsx files containing JSX, which Node's built-in TypeScript
// stripping does not compile. The pure logic behind the fix (parsing a
// server-provided "YYYYMMDD" string into the same Date regardless of the
// runtime's timezone) has its own real-import unit test instead — see
// src/lib/dashboardDateId.test.ts (run under UTC/Asia/Tokyo/Asia/Kuala_Lumpur).

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const pageSource = readFileSync(path.join(dashboardDir, 'page.tsx'), 'utf8')
const clientSource = readFileSync(path.resolve(dashboardDir, '../../../components/dashboard/DashboardClient.tsx'), 'utf8')
const calendarSource = readFileSync(path.resolve(dashboardDir, '../../../components/dashboard/Calendar.tsx'), 'utf8')

// --- Codex-audit fix: SSR/client first-render date mismatch -----------------
// DashboardClient used useState(new Date()) and Calendar used a bare
// `new Date()` for its "today" highlight. Both run once during SSR (in
// whatever timezone the server process is in) and independently again on
// the client's first render (in the visitor's browser timezone) — near a
// midnight boundary these can land on different calendar days entirely,
// which is a real React hydration error #418, not just a cosmetic one.

test('dashboard/page.tsx computes today\'s dateId once and passes it to both the guest and authenticated DashboardClient branches', () => {
  const initialDateIdOccurrences = (pageSource.match(/initialDateId=\{todayDateId\}/g) ?? []).length
  assert.equal(initialDateIdOccurrences, 2)
})

test('dashboard/page.tsx still computes todayDateId before the guest early-return (not duplicated per branch)', () => {
  const guestReturnIdx = pageSource.indexOf('return <DashboardClient trainedDates={[]}')
  const todayDateIdDeclIdx = pageSource.indexOf('const todayDateId =')
  assert.ok(guestReturnIdx > -1 && todayDateIdDeclIdx > -1 && todayDateIdDeclIdx < guestReturnIdx)
})

test('dashboard/page.tsx does not add cookies()/headers() beyond what it already used (still force-dynamic via export const dynamic, not a new dynamic API)', () => {
  assert.equal(pageSource.includes('from \'next/headers\''), false)
  assert.match(pageSource, /export const dynamic = 'force-dynamic'/)
})

// --- Codex最終監査 修正1: 単一Date snapshotからinitialDateId/initialNowIsoの --
// 両方を導出する。new Date()を別々に2回呼ぶと、呼び出しの間にmsが進んで
// 「今日」と「現在時刻」が理論上ずれ得るため、必ず同じインスタンスから導出する。

test('dashboard/page.tsx calls new Date() exactly once per request, deriving both todayDateId and initialNowIso from that single instance', () => {
  const codeOnly = pageSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  const bareNewDateOccurrences = (codeOnly.match(/\bnew Date\(\)/g) ?? []).length
  assert.equal(bareNewDateOccurrences, 1)
  assert.match(pageSource, /const now = new Date\(\)/)
  assert.match(pageSource, /const initialNowIso = now\.toISOString\(\)/)
})

test('dashboard/page.tsx passes initialNowIso to both the guest and authenticated DashboardClient branches', () => {
  const initialNowIsoOccurrences = (pageSource.match(/initialNowIso=\{initialNowIso\}/g) ?? []).length
  assert.equal(initialNowIsoOccurrences, 2)
})

// --- Codex最終監査 修正1/3: 単一snapshot化 + client補正の削除 ---------------
// initialDateId/initialNowIsoは必須props(optionalではない)になり、
// DashboardClientはfallbackでnew Date()を呼ばない。todayDateIdはもはや
// useStateではなく、initialDateIdをそのまま指す定数(セッション中不変)。
// mount後にselectedDate/todayDateIdをclientローカル日付へ書き換えていた
// 旧effectは、月境界でサーバー取得データとの不整合を起こすため削除された
// (方針A: 初回表示期間をserver snapshotへ固定)。

test('DashboardClient declares initialDateId/initialNowIso as required (non-optional) props', () => {
  assert.match(clientSource, /initialDateId: string/)
  assert.match(clientSource, /initialNowIso: string/)
  assert.doesNotMatch(clientSource, /initialDateId\?:/)
  assert.doesNotMatch(clientSource, /initialNowIso\?:/)
})

test('DashboardClient seeds selectedDate from initialDateId via parseDateId, never falling back to new Date()', () => {
  assert.doesNotMatch(clientSource, /useState\(new Date\(\)\)/)
  assert.match(clientSource, /useState\(\(\) => parseDateId\(initialDateId\)\)/)
})

test('DashboardClient treats todayDateId as the immutable initialDateId snapshot, not a useState', () => {
  assert.match(clientSource, /const todayDateId = initialDateId/)
  assert.doesNotMatch(clientSource, /const \[todayDateId, setTodayDateId\]/)
})

test('DashboardClient derives a single referenceDate/initialNow snapshot via useMemo, parsing only the passed props (no fresh "now" fetched during render)', () => {
  assert.match(clientSource, /const referenceDate = useMemo\(\(\) => parseDateId\(todayDateId\), \[todayDateId\]\)/)
  assert.match(clientSource, /const initialNow = useMemo\(\(\) => new Date\(initialNowIso\), \[initialNowIso\]\)/)
})

test('DashboardClient imports makeDateId/parseDateId/parseDateOnly/calendarDayDifference from the shared, independently-tested pure module', () => {
  assert.match(clientSource, /import\s*\{\s*makeDateId,\s*parseDateId,\s*parseDateOnly,\s*calendarDayDifference\s*\}\s*from\s*'@\/lib\/dashboardDateId'/)
})

test('DashboardClient no longer auto-corrects selectedDate/todayDateId to the client-local date after mount (Policy A: pin initial display period to the server snapshot instead of Policy B\'s client-side re-fetch)', () => {
  assert.doesNotMatch(clientSource, /const clientNow = new Date\(\)/)
  assert.doesNotMatch(clientSource, /setSelectedDate\(clientNow\)/)
  assert.doesNotMatch(clientSource, /setTodayDateId\(/)
})

test('the only remaining bare new Date() in DashboardClient is inside the client-only post-mount training-calories effect (not reachable during SSR/initial hydration)', () => {
  const codeOnly = clientSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  const bareNewDateOccurrences = (codeOnly.match(/\bnew Date\(\)/g) ?? []).length
  assert.equal(bareNewDateOccurrences, 1)
  const trainingEffectBlock = clientSource.match(/\/\/ 選択日付のトレーニングカロリーを計算\s*\n\s*useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[selectedDate, isGuest, weightRecords\]\)/)?.[0] ?? ''
  assert.notEqual(trainingEffectBlock, '')
  assert.match(trainingEffectBlock, /new Date\(\)/)
})

test('calcAge is a pure function taking an explicit referenceDate parameter instead of calling new Date() internally', () => {
  assert.match(clientSource, /function calcAge\(birthday: string, referenceDate: Date\): number/)
  const calcAgeBody = clientSource.match(/function calcAge\(birthday: string, referenceDate: Date\): number \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.notEqual(calcAgeBody, '')
  assert.doesNotMatch(calcAgeBody, /new Date\(\)/)
  assert.match(clientSource, /calcAge\(profile\.birthday, referenceDate\)/)
})

// --- Codex最終監査 修正: date-only文字列("YYYY-MM-DD")のtimezone依存 ----------
// calcAge()内のbirthday解析(new Date(birthday))とtarget_date表示用の解析
// (new Date(profile.target_date))は、どちらもYYYY-MM-DDのdate-only文字列を
// new Date()へ直接渡していた。new Date('YYYY-MM-DD')はUTC日付として解釈
// されるため、負のUTC offset環境では前日として扱われ、SSR/client間で年齢や
// 目標日表示がずれhydration mismatchの原因になりうる。parseDateOnly()
// (src/lib/dashboardDateId.ts)へ置き換えることで、年月日を数値分解し
// ローカルコンストラクタで解決するため、timezoneに関係なく同じ結果になる。

test('calcAge parses birthday via parseDateOnly(), not new Date(birthday) (timezone-unsafe for a YYYY-MM-DD date-only string)', () => {
  const calcAgeBody = clientSource.match(/function calcAge\(birthday: string, referenceDate: Date\): number \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.equal(calcAgeBody.includes('new Date(birthday)'), false)
  assert.match(calcAgeBody, /const birth = parseDateOnly\(birthday\)/)
})

test('target_date display parses via parseDateOnly(), not new Date(profile.target_date) directly', () => {
  assert.equal(clientSource.includes('new Date(profile!.target_date!)'), false)
  assert.equal(clientSource.includes('new Date(profile.target_date)'), false)
  assert.match(clientSource, /parseDateOnly\(profile!\.target_date!\)\.toLocaleDateString\(dateLocale, \{ month: 'long', day: 'numeric' \}\)/)
})

test('no timezone-dependent date-only string parsing (new Date(birthday), new Date(profile.target_date), or Date.parse on either) remains anywhere in DashboardClient', () => {
  // Strip comment-only lines first so an explanatory comment that happens to
  // mention "new Date(birthday)" in prose doesn't produce a false positive.
  const codeOnly = clientSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.equal(codeOnly.includes('new Date(birthday)'), false)
  assert.equal(codeOnly.includes('new Date(profile.target_date)'), false)
  assert.equal(codeOnly.includes('new Date(profile!.target_date!)'), false)
  assert.equal(codeOnly.includes('Date.parse(birthday)'), false)
  assert.equal(codeOnly.includes('Date.parse(profile.target_date)'), false)
})

// --- Codex監査 修正: daysLeftのDST依存 ---------------------------------------
// 旧実装 new Date(target_date + 'T00:00:00').getTime() - referenceDate.getTime()
// は、ローカルmidnight同士の経過ミリ秒(elapsed milliseconds)へ依存していた。
// DSTの開始・終了をまたぐtimezoneでは、その間の1日が23時間または25時間に
// なるため、86,400,000での除算が暦日数と食い違う。SSR(通常UTC)とclient
// (DST採用timezoneのブラウザ)がDST境界をまたぐ期間についてこの計算を行うと、
// timezone差によりdaysLeftの値そのものが分岐しうるため、初回DOM(あとN日
// 表示等)がSSR/client間で食い違うhydration mismatchを起こし得た。現在は
// calendarDayDifference()(from/toの年月日成分だけをDate.UTC()で連続した
// UTC日番号へ正規化してから差分を取る)へ置き換えており、timezone・DSTの
// いずれにも依存しない。

test('daysLeft no longer uses the DST-unsafe local-midnight getTime() difference (target_date + \'T00:00:00\')', () => {
  const codeOnly = clientSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.equal(codeOnly.includes("target_date + 'T00:00:00'"), false)
  assert.equal(codeOnly.includes("new Date(profile.target_date + 'T00:00:00')"), false)
})

test('rawDaysLeft is computed via calendarDayDifference(referenceDate, parseDateOnly(profile.target_date)), a DST/timezone-independent calendar-day difference', () => {
  assert.match(clientSource, /const rawDaysLeft = profile\?\.target_date\s*\n\s*\? calendarDayDifference\(referenceDate, parseDateOnly\(profile\.target_date\)\)\s*\n\s*: null/)
})

test('daysLeft/showGoalAchievedModal downstream logic (Math.max(0, rawDaysLeft), rawDaysLeft < 0) is unchanged', () => {
  assert.match(clientSource, /const daysLeft = rawDaysLeft !== null \? Math\.max\(0, rawDaysLeft\) : null/)
  assert.match(clientSource, /const showGoalAchievedModal = !isGuest && !goalModalDismissed && rawDaysLeft !== null && rawDaysLeft < 0/)
})

test('initialNowIso is still parsed via plain new Date() (an ISO datetime string, not a date-only string, so no timezone-unsafe UTC-date-string parsing applies)', () => {
  assert.match(clientSource, /const initialNow = useMemo\(\(\) => new Date\(initialNowIso\), \[initialNowIso\]\)/)
})

test('month-dependent calculations (currentMonthPrefix, daysInMonth) derive from the snapshot (todayDateId/referenceDate), not a fresh new Date()', () => {
  assert.match(clientSource, /const currentMonthPrefix = todayDateId\.slice\(0, 6\)/)
  assert.match(clientSource, /new Date\(referenceDate\.getFullYear\(\), referenceDate\.getMonth\(\) \+ 1, 0\)\.getDate\(\)/)
})

test('characterExpression derives currentHour from initialNow via UTC accessors (not local getHours(), which would differ between the server\'s timezone and the browser\'s)', () => {
  assert.match(clientSource, /currentHour: initialNow\.getUTCHours\(\)/)
})

// --- Codex監査 修正: daysSinceLastEntryのDST依存(push blocker) ---------------
// 旧実装 referenceDate.getTime() - latestDate.getTime() を86,400,000(または
// 86_400_000)で割ってMath.floorする方式は、DST開始をまたぐtimezoneで7暦日が
// 167時間になり、Math.floorで6日と誤算出されうる(Codex再現例: latest
// 2026-03-02, reference 2026-03-09でUTC=7日, America/Los_Angeles=6日)。
// getExpressionFromContext()はdaysSinceLastEntry >= 7でangryを返すため、
// この誤差がSSR/client間でキャラクター画像の食い違い(hydration mismatch)に
// 直結していた。calendarDayDifference()(年月日成分だけを使う)へ置き換える
// ことで解消した。

test('daysSinceLastEntry no longer uses the DST-unsafe local-midnight getTime() difference divided by 86400000', () => {
  const codeOnly = clientSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.equal(codeOnly.includes('referenceDate.getTime() - latestDate.getTime()'), false)
  assert.equal(codeOnly.includes('/ 86400000'), false)
  assert.equal(codeOnly.includes('/ 86_400_000'), false)
  assert.equal(/Math\.floor\([^)]*getTime[^)]*\)/.test(codeOnly), false)
})

test('daysSinceLastEntry is computed via calendarDayDifference(latestDate, referenceDate), a DST/timezone-independent calendar-day difference', () => {
  assert.match(clientSource, /daysSinceLastEntry = calendarDayDifference\(latestDate, referenceDate\)/)
})

test('daysSinceLastEntry still derives latestDate via parseDateId(latestStr), and referenceDate remains the existing server-snapshot-derived value (no new "now" fetched)', () => {
  assert.match(clientSource, /const latestDate = parseDateId\(latestStr\)/)
  assert.doesNotMatch(clientSource, /Date\.now\(\)/)
})

test('DashboardClient passes todayDateId down to Calendar', () => {
  assert.match(clientSource, /<Calendar[^>]*todayDateId=\{todayDateId\}/)
})

test('Calendar no longer calls new Date() to determine "today" (receives todayDateId as a prop instead)', () => {
  // Strip comment-only lines first so explanatory comments that happen to
  // mention "new Date()" in prose don't produce a false positive here.
  const codeOnly = calendarSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.equal(codeOnly.includes('new Date()'), false)
  assert.match(calendarSource, /todayDateId: string/)
  assert.match(calendarSource, /const isToday = \(day: number\) => makeDateId\(year, month, day\) === todayDateId/)
})

test('Calendar prev/next month navigation and date selection are unchanged (still derive from viewDate/selectedDate, not todayDateId)', () => {
  assert.match(calendarSource, /onClick=\{\(\) => setViewDate\(new Date\(year, month - 2, 1\)\)\}/)
  assert.match(calendarSource, /onClick=\{\(\) => setViewDate\(new Date\(year, month, 1\)\)\}/)
  assert.match(calendarSource, /onClick=\{\(\) => onDateSelect\(new Date\(year, month - 1, day\)\)\}/)
})
