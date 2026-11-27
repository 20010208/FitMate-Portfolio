/**
 * Serializes a JSON-LD value for embedding inside a
 * `<script type="application/ld+json">` via dangerouslySetInnerHTML.
 *
 * JSON.stringify alone is not enough: a string value containing
 * `</script>` (e.g. inside an article title) would prematurely close the
 * script tag and let the rest be parsed as HTML. Escaping `<` to its
 * unicode escape neutralizes that without invalidating the JSON (unicode
 * escapes inside a JSON string are valid JSON and decode back to the
 * original character) and without double-encoding anything, since it runs
 * once on the already-stringified output.
 */
export function toSafeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
