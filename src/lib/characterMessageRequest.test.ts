import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getOrCreateCharacterMessageRequest,
  isRequestInFlight,
  subscribeToInFlight,
  __resetInFlightRequestsForTests,
} from './characterMessageRequest.ts'

const CHARACTER_ID = 'leo' as const
const AI_CONTEXT = { weight: '70', goalWeight: '65' }

function mockFetchOnce(response: { ok: boolean; json?: unknown }) {
  let callCount = 0
  const calls: unknown[] = []
  // Typed as `typeof fetch` (not a narrowed `(_url: string, ...) => ...`) so it
  // honestly satisfies the real Fetch API's input contract (RequestInfo | URL),
  // matching what withMockedFetch below actually assigns to globalThis.fetch.
  // Returns a genuine `Response` instance (Node 24's Web-standard global)
  // rather than a partial object cast `as Response`, so `.ok`/`.json()`
  // behave exactly like a real fetch response instead of a hand-rolled
  // stand-in: `.ok` is derived from `status` the same way the real Fetch API
  // derives it (200-299 -> true), and `.json()` parses real JSON body text.
  const fetchMock: typeof fetch = async (_url, init) => {
    callCount++
    calls.push(init)
    return new Response(JSON.stringify(response.json ?? null), {
      status: response.ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetchMock, getCallCount: () => callCount, calls }
}

function withMockedFetch<T>(fetchMock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = fetchMock
  return fn().finally(() => {
    globalThis.fetch = original
  })
}

// --- Validation 5 (Phase 1D): request-count / dedup proof -------------------
// These are the properties Phase 1D explicitly requires strong evidence
// for, since this deduplication mechanism directly gates
// /api/character-message (and therefore OpenAI) call frequency.

test('CACHE_MISS: a single call to getOrCreateCharacterMessageRequest triggers exactly one real fetch', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock, getCallCount } = mockFetchOnce({ ok: true, json: { message: 'hi', expression: 'happy' } })
  await withMockedFetch(fetchMock, async () => {
    const result = await getOrCreateCharacterMessageRequest('key-A', CHARACTER_ID, AI_CONTEXT)
    assert.deepEqual(result, { message: 'hi', expression: 'happy' })
    assert.equal(getCallCount(), 1)
  })
})

test('TWO_COMPONENTS_SAME_KEY: two simultaneous callers with the same cacheKey share exactly one real fetch (dedup)', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock, getCallCount } = mockFetchOnce({ ok: true, json: { message: 'shared', expression: 'happy' } })
  await withMockedFetch(fetchMock, async () => {
    // Simulates PC + mobile CharacterSidebar mounting simultaneously with
    // the exact same cacheKey (as DashboardClient.tsx does).
    const p1 = getOrCreateCharacterMessageRequest('key-B', CHARACTER_ID, AI_CONTEXT)
    const p2 = getOrCreateCharacterMessageRequest('key-B', CHARACTER_ID, AI_CONTEXT)
    assert.equal(p1, p2, 'both callers must receive the exact same Promise reference (dedup, not just equal results)')
    const [r1, r2] = await Promise.all([p1, p2])
    assert.deepEqual(r1, { message: 'shared', expression: 'happy' })
    assert.deepEqual(r2, { message: 'shared', expression: 'happy' })
    assert.equal(getCallCount(), 1, 'exactly one real network request for two simultaneous same-key callers')
  })
})

test('STRICT_MODE_REPLAY: a second call for the same key while the first is still in flight does not trigger a second fetch (simulates dev Strict Mode double-invoke)', async () => {
  __resetInFlightRequestsForTests()
  let resolveFetch: (v: { ok: boolean; json: () => Promise<unknown> }) => void
  const pendingResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { resolveFetch = resolve })
  let callCount = 0
  const fetchMock = async () => {
    callCount++
    return pendingResponse as unknown as Response
  }

  await withMockedFetch(fetchMock, async () => {
    // First "mount" starts the request (still pending).
    const first = getOrCreateCharacterMessageRequest('key-C', CHARACTER_ID, AI_CONTEXT)
    assert.equal(isRequestInFlight('key-C'), true)

    // Strict Mode's dev-only cleanup-then-remount re-invokes the effect,
    // which calls getOrCreateCharacterMessageRequest again for the same key
    // before the first request has resolved.
    const second = getOrCreateCharacterMessageRequest('key-C', CHARACTER_ID, AI_CONTEXT)
    assert.equal(first, second, 'the replay must reuse the exact same in-flight Promise')
    assert.equal(callCount, 1, 'still only one real fetch after the simulated Strict Mode replay')

    resolveFetch!({ ok: true, json: async () => ({ message: 'ok', expression: 'happy' }) })
    await first
    assert.equal(callCount, 1, 'no additional fetch after resolution either')
  })
})

test('DIFFERENT_KEY: a different cacheKey does not reuse another key\'s in-flight request, and triggers its own fetch', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock, getCallCount } = mockFetchOnce({ ok: true, json: { message: 'x', expression: 'happy' } })
  await withMockedFetch(fetchMock, async () => {
    const pOld = getOrCreateCharacterMessageRequest('key-old', CHARACTER_ID, AI_CONTEXT)
    const pNew = getOrCreateCharacterMessageRequest('key-new', CHARACTER_ID, AI_CONTEXT)
    assert.notEqual(pOld, pNew, 'different cacheKeys must never share the same in-flight Promise')
    await Promise.all([pOld, pNew])
    assert.equal(getCallCount(), 2, 'two distinct keys correctly trigger two distinct real requests')
  })
})

test('REQUEST_MAP_CLEANUP: after a request settles (success), isRequestInFlight for that key returns to false', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock } = mockFetchOnce({ ok: true, json: { message: 'done', expression: 'happy' } })
  await withMockedFetch(fetchMock, async () => {
    const p = getOrCreateCharacterMessageRequest('key-D', CHARACTER_ID, AI_CONTEXT)
    assert.equal(isRequestInFlight('key-D'), true)
    await p
    assert.equal(isRequestInFlight('key-D'), false, 'the in-flight entry must be removed once the request settles')
  })
})

test('REQUEST_MAP_CLEANUP: after a request settles (network failure), isRequestInFlight for that key still returns to false and does not retry automatically', async () => {
  __resetInFlightRequestsForTests()
  const fetchMock = async () => { throw new Error('network down') }
  await withMockedFetch(fetchMock, async () => {
    const p = getOrCreateCharacterMessageRequest('key-E', CHARACTER_ID, AI_CONTEXT)
    assert.equal(isRequestInFlight('key-E'), true)
    await assert.rejects(p)
    assert.equal(isRequestInFlight('key-E'), false)
  })
})

test('non-ok HTTP response resolves to null (not an error) and does not remain marked in-flight', async () => {
  __resetInFlightRequestsForTests()
  const fetchMock = async () => ({ ok: false, json: async () => ({}) }) as Response
  await withMockedFetch(fetchMock, async () => {
    const result = await getOrCreateCharacterMessageRequest('key-F', CHARACTER_ID, AI_CONTEXT)
    assert.equal(result, null)
    assert.equal(isRequestInFlight('key-F'), false)
  })
})

// --- subscribeToInFlight: notifies on in-flight state transitions ----------

test('subscribeToInFlight: listener is called when a request starts and again when it settles', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock } = mockFetchOnce({ ok: true, json: { message: 'notify-me', expression: 'happy' } })
  let notifyCount = 0
  const unsubscribe = subscribeToInFlight(() => { notifyCount++ })
  await withMockedFetch(fetchMock, async () => {
    const p = getOrCreateCharacterMessageRequest('key-G', CHARACTER_ID, AI_CONTEXT)
    assert.equal(notifyCount, 1, 'listener notified synchronously when the request starts (Map.set)')
    await p
    assert.equal(notifyCount, 2, 'listener notified again once the request settles (Map.delete)')
  })
  unsubscribe()
})

test('subscribeToInFlight: unsubscribed listener receives no further notifications', async () => {
  __resetInFlightRequestsForTests()
  const { fetchMock } = mockFetchOnce({ ok: true, json: { message: 'x', expression: 'happy' } })
  let notifyCount = 0
  const unsubscribe = subscribeToInFlight(() => { notifyCount++ })
  unsubscribe()
  await withMockedFetch(fetchMock, async () => {
    await getOrCreateCharacterMessageRequest('key-H', CHARACTER_ID, AI_CONTEXT)
  })
  assert.equal(notifyCount, 0)
})
