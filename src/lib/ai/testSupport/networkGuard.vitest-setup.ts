// Vitest setupFile for the AI security regression suite only (registered by
// vitest.ai-security.config.ts). Replaces global fetch with a stub that
// throws immediately, so any test that accidentally exercises a real network
// path (instead of a mocked module boundary) fails loudly and fast rather
// than attempting a real request to OpenAI/Supabase/Production.
//
// This must not break Request/Response construction: the Request/Response
// classes themselves perform no network I/O, so route-handler tests that
// build `new Request(...)` and pass it to an exported POST() are unaffected.
type FetchType = typeof globalThis.fetch

globalThis.fetch = (...args: Parameters<FetchType>): ReturnType<FetchType> => {
  throw new Error(
    `Unexpected real network call via global fetch in the AI security test suite: ${String(args[0])}. ` +
      'All external boundaries (OpenAI, Supabase) must be mocked at the module level instead.'
  )
}
