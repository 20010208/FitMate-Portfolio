// Test-only replacement for the 'server-only' import guard.
//
// 'server-only' is not an installable package in this project (confirmed: it
// has no entry in package.json or package-lock.json; the only copy on disk
// is Next.js's own internal vendored build artifact under
// node_modules/next/dist/compiled/server-only, which only resolves through
// Next's webpack/turbopack bundler, never through a plain module loader).
// vitest.ai-security.config.ts aliases the bare 'server-only' specifier to
// this file so that src/lib/ai/*.ts (each of which starts with
// `import 'server-only'`) can be imported for real in tests. This file is
// intentionally an empty module — 'server-only' has no runtime behavior of
// its own in a valid server context; it only exists to make client-bundling
// misuse fail at build time, which is not a concern here.
export {}
