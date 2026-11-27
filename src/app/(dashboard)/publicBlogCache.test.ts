import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Static-source checks only, for the same reason as
// blog/notFoundBehavior.test.ts and noIndexMetadata.test.ts: these are .tsx
// files containing JSX, which Node's built-in TypeScript stripping does not
// compile. The pure logic this change introduces (src/lib/auth/
// resolveHeaderAuthState.ts) has its own real-import unit test instead —
// see resolveHeaderAuthState.test.ts.

const dashboardDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(dashboardDir, '..')
const blogDir = path.join(dashboardDir, 'blog')
const slugDir = path.join(blogDir, '[slug]')

const layoutSource = readFileSync(path.join(dashboardDir, 'layout.tsx'), 'utf8')
const appHeaderSource = readFileSync(path.resolve(appDir, '../components/layout/AppHeader.tsx'), 'utf8')
const blogListingSource = readFileSync(path.join(blogDir, 'page.tsx'), 'utf8')
const blogDetailSource = readFileSync(path.join(slugDir, 'page.tsx'), 'utf8')
const notFoundSource = readFileSync(path.join(slugDir, 'not-found.tsx'), 'utf8')

// --- route separation: no server-side auth dependency in the public tree --

test('the shared (dashboard) layout no longer calls cookies()/server Supabase/auth.getUser()', () => {
  assert.equal(layoutSource.includes('cookies('), false)
  assert.equal(layoutSource.includes('@/lib/supabase/server'), false)
  assert.equal(layoutSource.includes('getUser('), false)
  assert.equal(layoutSource.includes("from('profiles')"), false)
})

test('the shared (dashboard) layout is not async (no server data fetching left to force dynamic rendering)', () => {
  assert.doesNotMatch(layoutSource, /export default async function DashboardLayout/)
  assert.match(layoutSource, /export default function DashboardLayout/)
})

test('the shared (dashboard) layout still renders AppHeader with no auth props (AppHeader resolves its own state)', () => {
  assert.match(layoutSource, /import AppHeader from '@\/components\/layout\/AppHeader'/)
  assert.match(layoutSource, /<AppHeader \/>/)
})

test('/blog listing page has no server-side auth dependency', () => {
  for (const source of [blogListingSource]) {
    assert.equal(source.includes('cookies('), false)
    assert.equal(source.includes('@/lib/supabase/server'), false)
    assert.equal(source.includes('getUser('), false)
  }
})

test('/blog/[slug] page has no server-side auth dependency (guest CTA is now a client component)', () => {
  assert.equal(blogDetailSource.includes('cookies('), false)
  assert.equal(blogDetailSource.includes('@/lib/supabase/server'), false)
  assert.equal(blogDetailSource.includes('getUser('), false)
  assert.equal(blogDetailSource.includes("from('profiles')"), false)
  assert.match(blogDetailSource, /import BlogGuestCta from '\.\/BlogGuestCta'/)
})

test('/blog/[slug]/not-found.tsx has no server-side auth dependency', () => {
  assert.equal(notFoundSource.includes('cookies('), false)
  assert.equal(notFoundSource.includes('@/lib/supabase/server'), false)
  assert.equal(notFoundSource.includes('getUser('), false)
})

test('BlogGuestCta resolves guest state client-side (browser Supabase client, not server)', () => {
  const source = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  assert.match(source, /^'use client'/)
  assert.match(source, /import\s*\{\s*createClient\s*\}\s*from\s*'@\/lib\/supabase\/client'/)
  assert.equal(source.includes('@/lib/supabase/server'), false)
})

test('no new duplicate blog route was created (this change keeps /blog under the existing (dashboard) group)', () => {
  assert.equal(existsSync(path.join(appDir, '(public)')), false)
  assert.ok(existsSync(blogDir))
  assert.ok(existsSync(path.join(slugDir, 'page.tsx')))
})

// --- private dashboard routes: unchanged, still server-auth-gated ---------

const PRIVATE_ROUTES = ['dashboard/page.tsx', 'training/page.tsx', 'meal/page.tsx', 'weight/page.tsx', 'history/page.tsx']

for (const relPath of PRIVATE_ROUTES) {
  test(`${relPath} still performs its own server-side auth.getUser() (private route behavior unchanged)`, () => {
    const source = readFileSync(path.join(dashboardDir, relPath), 'utf8')
    assert.match(source, /getUser\(/)
    assert.match(source, /@\/lib\/supabase\/server/)
  })
}

// --- cache safety: public data helper still published-only, no service role

test('the blog data helper still filters to published posts only and uses the public key (no service role)', () => {
  const blogLibSource = readFileSync(path.resolve(dashboardDir, '../../lib/blog.ts'), 'utf8')
  assert.match(blogLibSource, /\.eq\('is_published', true\)/g)
  assert.equal(blogLibSource.includes('service_role'), false)
  assert.equal(blogLibSource.includes('SERVICE_ROLE'), false)
  assert.match(blogLibSource, /getSupabasePublicKey/)
})

test('/blog listing keeps its existing revalidate=3600 cache policy', () => {
  assert.match(blogListingSource, /export const revalidate = 3600/)
})

test('dynamicParams=false is not introduced anywhere in the app', () => {
  // Mirrors the check already enforced for the Soft-404 fix; re-verified
  // here because this change also touches blog/[slug]/page.tsx.
  assert.equal(blogDetailSource.includes('dynamicParams'), false)
})

// --- header non-regression -------------------------------------------------

test('AppHeader keeps the main navigation items (unchanged from before this change)', () => {
  for (const href of ['/dashboard', '/training', '/meal', '/weight', '/history', '/blog', '/profile']) {
    assert.match(appHeaderSource, new RegExp(`href:\\s*'${href.replace('/', '\\/')}'`))
  }
})

test('AppHeader keeps the login/signup links for guests', () => {
  assert.match(appHeaderSource, /href="\/login"/)
  assert.match(appHeaderSource, /href="\/signup"/)
})

test('AppHeader keeps the theme selector and logo', () => {
  assert.match(appHeaderSource, /<ThemeSelector \/>/)
  assert.match(appHeaderSource, /src="\/logo\.png"/)
})

test('AppHeader defaults to an unresolved (null) state on first render (matches what a public page server-renders, avoids a hydration mismatch)', () => {
  assert.match(appHeaderSource, /useState<HeaderAuthState \| null>\(null\)/)
})

test('AppHeader renders a neutral placeholder while auth state is unresolved, instead of flashing the guest Login/Sign Up UI', () => {
  const nullBranch = appHeaderSource.match(/authState === null \? \(([\s\S]*?)\) : authState\.isGuest \? \(/)?.[1] ?? ''
  assert.notEqual(nullBranch, '')
  assert.equal(nullBranch.includes("t('login')"), false)
  assert.equal(nullBranch.includes("t('signUp')"), false)
  assert.match(nullBranch, /aria-hidden="true"/)
})

// --- Codex REQUEST CHANGES fix: blog.ts distinguishes a DB/network failure
// from a genuine "no rows" result (HIGH) -------------------------------------

test('getAllPosts()/getPostBySlug() no longer discard the Supabase error (the old `const { data } = await ...` pattern is gone)', () => {
  const blogLibSource = readFileSync(path.resolve(dashboardDir, '../../lib/blog.ts'), 'utf8')
  assert.equal(/const\s*\{\s*data\s*\}\s*=\s*await\s+supabase/.test(blogLibSource), false)
})

test('blog.ts routes both queries through the shared result-parsing helpers, which throw (rather than fall back to empty/undefined) on a Supabase error', () => {
  const blogLibSource = readFileSync(path.resolve(dashboardDir, '../../lib/blog.ts'), 'utf8')
  assert.match(blogLibSource, /parseAllPostsResult\(result\)/)
  assert.match(blogLibSource, /parsePostBySlugResult\(result\)/)
  assert.match(blogLibSource, /from '\.\/blogResultParser'/)
})

// --- Codex REQUEST CHANGES fix: AppHeader date-query reactivity (MEDIUM) ----

test('AppHeader no longer uses the non-reactive useSyncExternalStore/subscribeNoop pattern for the date param', () => {
  // useSyncExternalStore may still be mentioned in an explanatory comment
  // (describing why the old approach was replaced), so this checks for
  // actual usage (a hook call / import), not a bare substring match.
  assert.equal(/useSyncExternalStore\(/.test(appHeaderSource), false)
  assert.equal(/\{\s*[^}]*useSyncExternalStore[^}]*\}\s*from\s*'react'/.test(appHeaderSource), false)
  assert.equal(/function subscribeNoop/.test(appHeaderSource), false)
  assert.equal(appHeaderSource.includes('getServerDateParamSnapshot'), false)
})

test('AppHeader reads the date param through useSearchParams(), isolated in its own Suspense boundary', () => {
  assert.match(appHeaderSource, /import\s*\{[^}]*useSearchParams[^}]*\}\s*from\s*'next\/navigation'/)
  assert.match(appHeaderSource, /<Suspense fallback=\{null\}>\s*<DateParamWatcher/)
})

test('the date watcher is isolated to its own component rather than wrapping all of NavItems, so the rest of the nav still ships in static HTML', () => {
  const suspenseBlock = appHeaderSource.match(/<Suspense fallback=\{null\}>[\s\S]*?<\/Suspense>/)?.[0] ?? ''
  assert.match(suspenseBlock, /DateParamWatcher/)
  assert.equal(suspenseBlock.includes('NAV_ITEMS.map'), false)
})

test('AppHeader still omits the date query param on pages that do not need it, and never reads/forwards any query param besides `date`', () => {
  assert.match(appHeaderSource, /NO_DATE_PAGES/)
  assert.match(appHeaderSource, /dateParam && !NO_DATE_PAGES\.has\(base\)/)
  assert.equal((appHeaderSource.match(/searchParams\.get\(/g) ?? []).length, 1)
  assert.match(appHeaderSource, /searchParams\.get\('date'\)/)
})

// --- Codex REQUEST CHANGES fix: auth async race protection (MEDIUM) --------

test('AppHeader and BlogGuestCta both use the shared generation guard to reject stale async auth results', () => {
  const blogGuestCtaSource = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  assert.match(appHeaderSource, /import\s*\{\s*createGenerationGuard\s*\}\s*from\s*'@\/lib\/auth\/generationGuard'/)
  assert.match(blogGuestCtaSource, /import\s*\{\s*createGenerationGuard\s*\}\s*from\s*'@\/lib\/auth\/generationGuard'/)
})

test('neither AppHeader nor BlogGuestCta calls getUser() a second time inside onAuthStateChange (uses the callback session instead)', () => {
  const blogGuestCtaSource = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  for (const source of [appHeaderSource, blogGuestCtaSource]) {
    const getUserCallCount = (source.match(/\.auth\.getUser\(/g) ?? []).length
    assert.equal(getUserCallCount, 1)
  }
})

test('AppHeader and BlogGuestCta still guard against post-unmount state updates and unsubscribe their auth listener on cleanup', () => {
  const blogGuestCtaSource = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  for (const source of [appHeaderSource, blogGuestCtaSource]) {
    assert.match(source, /let cancelled = false/)
    assert.match(source, /cancelled = true/)
    assert.match(source, /subscription\.unsubscribe\(\)/)
  }
})

// --- Codex re-audit fix: BlogGuestCta's guest-first flash (this round) -----

test('BlogGuestCta defaults to null (unresolved), not true (guest), on first render', () => {
  const source = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  assert.match(source, /useState<boolean \| null>\(null\)/)
})

test('BlogGuestCta only renders its children once guest is definitively true (not on null/unresolved, not on false/authenticated)', () => {
  const source = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  assert.match(source, /if \(isGuest !== true\) return null/)
})

test('BlogGuestCta safely resolves to guest if getUser() itself rejects, instead of leaving isGuest null forever', () => {
  const source = readFileSync(path.join(slugDir, 'BlogGuestCta.tsx'), 'utf8')
  const getUserBlock = source.match(/supabase\.auth\.getUser\(\)\.then\([\s\S]*?\}\)\.catch\([\s\S]*?\}\)/)?.[0] ?? ''
  assert.notEqual(getUserBlock, '')
  const catchBody = getUserBlock.match(/\.catch\(\(\) => \{([\s\S]*?)\}\)$/)?.[1] ?? ''
  assert.match(catchBody, /guard\.isCurrent\(initialGeneration\)/)
  assert.match(catchBody, /setIsGuest\(true\)/)
})

test('AppHeader keeps guest/authenticated determination based on the resolved user, not on whether the profile fetch itself succeeded', () => {
  assert.match(appHeaderSource, /resolveHeaderAuthState\(user, profile\?\.nickname\)/)
})

test('AppHeader clears a stale nickname immediately on a user switch, via resolveInitialOrNextUserState, before awaiting the new profile fetch', () => {
  // resolveInitialOrNextUserState() wraps nextDisplayedUserState() (see
  // resolveHeaderAuthState.test.ts for the underlying decision logic); this
  // only checks that AppHeader still wires the immediate result in before
  // the profile fetch, not the decision logic itself.
  assert.match(appHeaderSource, /import\s*\{[^}]*resolveInitialOrNextUserState[^}]*\}\s*from\s*'@\/lib\/auth\/resolveHeaderAuthState'/)
  assert.match(appHeaderSource, /resolveInitialOrNextUserState\(hasResolvedInitial, displayedUserId, user\)/)
  // the immediate setState must happen before the `await supabase.from('profiles')...` line
  const applyUserBody = appHeaderSource.match(/const applyUser = async[\s\S]*?\n {4}\}/)?.[0] ?? ''
  const immediateIdx = applyUserBody.indexOf('setState(immediate.immediateState)')
  const awaitIdx = applyUserBody.indexOf("await supabase")
  assert.ok(immediateIdx > -1 && awaitIdx > -1 && immediateIdx < awaitIdx)
})

// --- Codex re-audit fix: AppHeader's initial auth resolution (this round) --

test('AppHeader treats whichever of {getUser(), the first onAuthStateChange event} arrives first as the initial resolution, via a hasResolvedInitial flag (not a hardcoded isInitial argument)', () => {
  assert.match(appHeaderSource, /let hasResolvedInitial = false/)
  assert.match(appHeaderSource, /hasResolvedInitial = true/)
  // applyUser must no longer take a 3rd "isInitial" boolean parameter -- the
  // flag lives in the effect's closure and is read by resolveInitialOrNextUserState.
  assert.doesNotMatch(appHeaderSource, /applyUser = async \([^)]*isInitial[^)]*\)/)
})

test('AppHeader safely resolves to guest if getUser() itself rejects, instead of leaving the placeholder unresolved forever', () => {
  const getUserBlock = appHeaderSource.match(/supabase\.auth\.getUser\(\)\.then\([\s\S]*?\}\)\.catch\([\s\S]*?\}\)/)?.[0] ?? ''
  assert.notEqual(getUserBlock, '')
  assert.match(getUserBlock, /\.catch\(/)
  // the catch handler must still respect cancellation/generation, and must
  // resolve as guest (applyUser with a null user), not silently swallow the
  // rejection and leave state stuck at null.
  const catchBody = getUserBlock.match(/\.catch\(\(\) => \{([\s\S]*?)\}\)$/)?.[1] ?? ''
  assert.match(catchBody, /guard\.isCurrent\(initialGeneration\)/)
  assert.match(catchBody, /applyUser\(null, initialGeneration\)/)
})

// NOTE (test-coverage limitation): the above are static-source checks only,
// consistent with the rest of this file — this repo has no component-render
// test setup (no jsdom/testing-library), so the actual runtime behavior of
// AppHeader/BlogGuestCta (real async/timer-based race resolution, real
// useSearchParams() reactivity across a router navigation) is not exercised
// by an automated test. What *is* covered by real, executable unit tests
// (generationGuard.test.ts and resolveHeaderAuthState.test.ts's
// nextDisplayedUserState cases) is the underlying decision logic itself —
// generation comparisons and the user-switch/immediate-clear transitions —
// exercised synchronously in the same sequence a real race would produce,
// not with actual async delays or timers.
