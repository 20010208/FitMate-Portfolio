import 'server-only'

export type BodyReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' }

export function hasJsonContentType(request: Request): boolean {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  return contentType === 'application/json' || contentType.startsWith('application/json;')
}

// Reads and JSON-parses a request body while enforcing maxBytes, without
// relying on request.json() (which does not bound how much it reads).
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyReadResult<unknown>> {
  if (!hasJsonContentType(request)) {
    return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }
  }

  const contentLengthHeader = request.headers.get('content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, code: 'PAYLOAD_TOO_LARGE' }
    }
  }

  const body = request.body
  if (!body) {
    return { ok: false, code: 'INVALID_JSON' }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, code: 'PAYLOAD_TOO_LARGE' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, code: 'INVALID_JSON' }
  }

  let text: string
  try {
    const combined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    text = new TextDecoder('utf-8', { fatal: true }).decode(combined)
  } catch {
    return { ok: false, code: 'INVALID_JSON' }
  }

  try {
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, code: 'INVALID_JSON' }
  }
}
