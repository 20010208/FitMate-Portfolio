// Behavioral regression tests for src/lib/ai/request.ts's readJsonBody().
// Real import (via vitest.ai-security.config.ts's server-only alias), no
// mocking needed: this module has no external I/O of its own.
import { describe, it, expect } from 'vitest'
import { readJsonBody, hasJsonContentType } from './request'

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

// Builds a Request whose body streams a given number of bytes without ever
// setting Content-Length (or with an explicit, possibly-lying, one), so the
// actual-byte-count enforcement path (not the Content-Length fast path) is
// exercised. No large fixture files: bytes are generated in memory.
function streamedRequest(byteLength: number, opts: { contentLength?: number | 'omit' } = {}): Request {
  const chunk = new Uint8Array(Math.min(byteLength, 256)).fill(65) // 'A'
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= byteLength) {
        controller.close()
        return
      }
      const n = Math.min(chunk.length, byteLength - sent)
      controller.enqueue(chunk.subarray(0, n))
      sent += n
    },
  })

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.contentLength !== 'omit') {
    headers['content-length'] = String(opts.contentLength ?? byteLength)
  }

  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers,
    // @ts-expect-error - Node's Request accepts a ReadableStream body with duplex.
    duplex: 'half',
    body: stream,
  })
}

describe('hasJsonContentType', () => {
  it('accepts exact application/json', () => {
    expect(hasJsonContentType(jsonRequest('{}'))).toBe(true)
  })

  it('accepts application/json with a charset parameter', () => {
    const req = jsonRequest('{}', { 'content-type': 'application/json; charset=utf-8' })
    expect(hasJsonContentType(req)).toBe(true)
  })

  it('rejects a non-JSON content type', () => {
    const req = jsonRequest('{}', { 'content-type': 'text/plain' })
    expect(hasJsonContentType(req)).toBe(false)
  })
})

describe('readJsonBody: correct application/json within cap', () => {
  it('parses a small valid JSON body', async () => {
    const result = await readJsonBody(jsonRequest('{"a":1}'), 1024)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual({ a: 1 })
  })
})

describe('readJsonBody: wrong content type', () => {
  it('rejects with UNSUPPORTED_MEDIA_TYPE before reading the body', async () => {
    const req = jsonRequest('{"a":1}', { 'content-type': 'text/plain' })
    const result = await readJsonBody(req, 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })
})

describe('readJsonBody: malformed JSON', () => {
  it('rejects with INVALID_JSON', async () => {
    const result = await readJsonBody(jsonRequest('{not json'), 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_JSON')
  })
})

describe('readJsonBody: empty body', () => {
  it('rejects an empty body as INVALID_JSON', async () => {
    const result = await readJsonBody(jsonRequest(''), 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_JSON')
  })
})

describe('readJsonBody: Content-Length above cap (fast-path rejection)', () => {
  it('rejects before reading the stream when declared Content-Length exceeds maxBytes', async () => {
    const req = streamedRequest(100, { contentLength: 100_000 })
    const result = await readJsonBody(req, 50)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('readJsonBody: actual streamed bytes above cap, independent of Content-Length', () => {
  it('rejects when Content-Length is missing but actual bytes exceed maxBytes', async () => {
    const req = streamedRequest(1000, { contentLength: 'omit' })
    const result = await readJsonBody(req, 100)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('rejects when Content-Length understates the actual byte count', async () => {
    // Declares far less than what is actually streamed - the fast-path check
    // must not be the only enforcement, or this would slip through as "ok".
    const req = streamedRequest(1000, { contentLength: 10 })
    const result = await readJsonBody(req, 100)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('readJsonBody: boundary around the exact limit', () => {
  it('accepts a body of exactly maxBytes (valid JSON padded to size)', async () => {
    const maxBytes = 64
    const padding = 'x'.repeat(maxBytes - '{"a":""}'.length)
    const body = `{"a":"${padding}"}`
    expect(new TextEncoder().encode(body).length).toBe(maxBytes)
    const result = await readJsonBody(jsonRequest(body), maxBytes)
    expect(result.ok).toBe(true)
  })

  it('rejects a body of exactly maxBytes + 1', async () => {
    const maxBytes = 64
    const padding = 'x'.repeat(maxBytes - '{"a":""}'.length + 1)
    const body = `{"a":"${padding}"}`
    expect(new TextEncoder().encode(body).length).toBe(maxBytes + 1)
    const result = await readJsonBody(jsonRequest(body), maxBytes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PAYLOAD_TOO_LARGE')
  })
})

describe('readJsonBody: array/primitive top-level JSON', () => {
  it('parses a top-level JSON array as-is (per-route validators, not this helper, reject shape)', async () => {
    const result = await readJsonBody(jsonRequest('[1,2,3]'), 1024)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([1, 2, 3])
  })

  it('parses a top-level JSON primitive as-is (per-route validators, not this helper, reject shape)', async () => {
    const result = await readJsonBody(jsonRequest('42'), 1024)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe(42)
  })
})
