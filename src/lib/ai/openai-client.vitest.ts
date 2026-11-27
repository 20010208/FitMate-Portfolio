// Behavioral regression tests for src/lib/ai/openai-client.ts.
// Real import (via the server-only alias) and a real `new OpenAI(...)`
// construction (the 'openai' package's constructor performs no network I/O
// by itself - it only configures an HTTP client for later use). No request
// is ever sent: only the constructed instance's own config properties are
// inspected. process.env.OPENAI_API_KEY is set to a dummy, obviously-fake
// value purely so module initialization succeeds.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

describe('getOpenAIClient: safety configuration', () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterAll(() => {
    process.env.OPENAI_API_KEY = ORIGINAL_KEY
  })

  it('constructs a client with maxRetries=0 (no retry-multiplication risk)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-dummy-not-a-real-key'
    const { getOpenAIClient } = await import('./openai-client')
    const client = getOpenAIClient()
    expect(client.maxRetries).toBe(0)
  })

  it('constructs a client with a 30 second timeout', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-dummy-not-a-real-key'
    const { getOpenAIClient } = await import('./openai-client')
    const client = getOpenAIClient()
    expect(client.timeout).toBe(30_000)
  })

  it('trims surrounding whitespace from the configured API key before use', async () => {
    process.env.OPENAI_API_KEY = '  sk-test-dummy-with-whitespace  '
    const { getOpenAIClient } = await import('./openai-client')
    const client = getOpenAIClient()
    expect(client.apiKey).toBe('sk-test-dummy-with-whitespace')
  })

  it('throws (fails closed) rather than constructing a keyless client when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { getOpenAIClient } = await import('./openai-client')
    expect(() => getOpenAIClient()).toThrow(/OpenAI API key is missing/)
  })

  it('throws when OPENAI_API_KEY is present but whitespace-only', async () => {
    process.env.OPENAI_API_KEY = '   '
    const { getOpenAIClient } = await import('./openai-client')
    expect(() => getOpenAIClient()).toThrow(/OpenAI API key is missing/)
  })

  // Codex LOW follow-up: the prior version of this test set a valid-looking
  // key, so getOpenAIClient() never actually threw and the catch block
  // (the only place with a real assertion) never ran - the test always
  // passed regardless of whether any leak protection existed. There is no
  // other forceable throw path in getOpenAIClient(): its only `throw` is the
  // missing/whitespace-only-key branch, which is reachable deterministically
  // (see the two tests above) and whose message is a fixed string literal
  // that can only be reached when the trimmed key is empty - so there is
  // nothing left in that branch capable of embedding a real key value. This
  // test honestly verifies exactly that structural guarantee: the thrown
  // message is byte-for-byte identical across several different raw env
  // values that all end up empty after trimming, proving the message never
  // incorporates anything from the input (rather than merely happening not
  // to contain one specific test string).
  it('the missing-key error message is a fixed literal that never varies with (or embeds) the underlying env value, across several empty-after-trim inputs', async () => {
    const emptyAfterTrimValues = [undefined, '', '   ', '\t\n', '\r\n\t  ']
    const messages: string[] = []

    for (const rawValue of emptyAfterTrimValues) {
      vi.resetModules()
      if (rawValue === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = rawValue
      }
      const { getOpenAIClient } = await import('./openai-client')
      try {
        getOpenAIClient()
        expect.unreachable('getOpenAIClient() was expected to throw for an empty-after-trim key')
      } catch (err) {
        messages.push(String(err))
      }
    }

    expect(messages).toHaveLength(emptyAfterTrimValues.length)
    for (const message of messages) {
      expect(message).toContain('OpenAI API key is missing. Set OPENAI_API_KEY.')
    }
    // Every message is identical regardless of which raw value produced it -
    // demonstrating none of the raw input ever reaches the thrown message.
    expect(new Set(messages).size).toBe(1)
  })

  it('returns the same cached client instance on repeated calls within one module load (singleton)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-dummy-not-a-real-key'
    const { getOpenAIClient } = await import('./openai-client')
    const first = getOpenAIClient()
    const second = getOpenAIClient()
    expect(second).toBe(first)
  })
})
