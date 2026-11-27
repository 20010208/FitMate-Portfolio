import { test } from 'node:test'
import assert from 'node:assert/strict'

// Static/structural safety check only. This test imports the management
// script as a plain ES module (never as the Node entrypoint), so its
// `isMainModule` guard must stay false and `main()` must never run.
// No Supabase client is constructed and no network call happens anywhere
// in this file — importing `@supabase/supabase-js` itself performs no I/O,
// only `createClient(...)` (called exclusively inside `main()`) would.
test('importing the management script does not execute main, touch process.exitCode, or log anything', async () => {
  const originalExitCode = process.exitCode
  const originalLog = console.log
  const originalError = console.error
  let logCalls = 0
  let errorCalls = 0
  console.log = () => { logCalls += 1 }
  console.error = () => { errorCalls += 1 }

  let mod
  try {
    // Cache-busting query so re-running this test file (or running it
    // alongside others that might import the same module) still exercises
    // a fresh module evaluation.
    mod = await import(`./manage-meal-photos-bucket.mjs?t=${Date.now()}`)
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  assert.equal(typeof mod.main, 'function')
  assert.equal(process.exitCode, originalExitCode)
  assert.equal(logCalls, 0)
  assert.equal(errorCalls, 0)
})

test('main() is a plain exported function, not auto-invoked, and importing does not require env vars', async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SECRET_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SECRET_KEY
  try {
    const mod = await import(`./manage-meal-photos-bucket.mjs?t=${Date.now()}-2`)
    assert.equal(typeof mod.main, 'function')
  } finally {
    if (originalUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey !== undefined) process.env.SUPABASE_SECRET_KEY = originalKey
  }
})
