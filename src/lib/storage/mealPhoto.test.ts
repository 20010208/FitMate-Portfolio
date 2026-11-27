import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMealPhotoPath } from './mealPhoto.ts'

const SUPABASE_URL = 'https://example-project.supabase.co'
const USER_ID = 'a1b2c3d4-1111-2222-3333-444455556666'
const OTHER_USER_ID = 'b2c3d4e5-9999-8888-7777-666655554444'
const DATE_ID = '20260724'
const FILE = 'c3d4e5f6-a1b2-4c3d-9e8f-1a2b3c4d5e6f.jpg'
const OBJECT_PATH = `${USER_ID}/${DATE_ID}/${FILE}`
const PUBLIC_URL = `${SUPABASE_URL}/storage/v1/object/public/meal-photos/${OBJECT_PATH}`
const CONTROL_CHAR = String.fromCharCode(1)

const context = { supabaseUrl: SUPABASE_URL, userId: USER_ID }

function accepts(label: string, value: string, expected: string) {
  test(`accepts: ${label}`, () => {
    assert.equal(normalizeMealPhotoPath(value, context), expected)
  })
}

function rejects(label: string, value: string | null | undefined) {
  test(`rejects: ${label}`, () => {
    assert.equal(normalizeMealPhotoPath(value, context), null)
  })
}

// --- normal cases ---
accepts('current project legacy public URL', PUBLIC_URL, OBJECT_PATH)
accepts('legacy public URL with query string', `${PUBLIC_URL}?download=1`, OBJECT_PATH)
accepts('legacy public URL with fragment', `${PUBLIC_URL}#preview`, OBJECT_PATH)
accepts('legacy public URL with query and fragment', `${PUBLIC_URL}?download=1#preview`, OBJECT_PATH)
accepts('correct object path', OBJECT_PATH, OBJECT_PATH)

// --- rejection cases ---
rejects('null', null)
rejects('undefined', undefined)
rejects('empty string', '')
rejects('whitespace only', '   ')
rejects('external origin', `https://evil.example.com/storage/v1/object/public/meal-photos/${OBJECT_PATH}`)
rejects('another Supabase project', `https://other-project.supabase.co/storage/v1/object/public/meal-photos/${OBJECT_PATH}`)
rejects('another bucket', `${SUPABASE_URL}/storage/v1/object/public/other-bucket/${OBJECT_PATH}`)
rejects('another user (URL form)', `${SUPABASE_URL}/storage/v1/object/public/meal-photos/${OTHER_USER_ID}/${DATE_ID}/${FILE}`)
rejects('another user (path form)', `${OTHER_USER_ID}/${DATE_ID}/${FILE}`)
rejects('leading slash', `/${OBJECT_PATH}`)
rejects('protocol-relative URL', `//example-project.supabase.co/storage/v1/object/public/meal-photos/${OBJECT_PATH}`)
rejects('bucket name embedded in path', `meal-photos/${OBJECT_PATH}`)
rejects('duplicate slash', `${USER_ID}//${DATE_ID}/${FILE}`)
rejects('trailing slash', `${OBJECT_PATH}/`)
rejects('segment count 2', `${USER_ID}/${FILE}`)
rejects('segment count 4', `${USER_ID}/${DATE_ID}/extra/${FILE}`)
rejects('invalid dateId (too short)', `${USER_ID}/2026724/${FILE}`)
rejects('invalid dateId (non-numeric)', `${USER_ID}/2026-07-24/${FILE}`)
rejects('non-UUID filename', `${USER_ID}/${DATE_ID}/photo.jpg`)
rejects('png extension', `${USER_ID}/${DATE_ID}/c3d4e5f6-a1b2-4c3d-9e8f-1a2b3c4d5e6f.png`)
rejects('uppercase UUID', `${USER_ID}/${DATE_ID}/C3D4E5F6-A1B2-4C3D-9E8F-1A2B3C4D5E6F.jpg`)
rejects('dot segment .', `${USER_ID}/./${FILE}`)
rejects('dot segment ..', `${USER_ID}/../${FILE}`)
rejects('backslash', `${USER_ID}\\${DATE_ID}\\${FILE}`)
rejects('control character', `${USER_ID}/${DATE_ID}/${CONTROL_CHAR}${FILE}`)
rejects('encoded slash %2F', `${USER_ID}%2F${DATE_ID}%2F${FILE}`)
rejects('encoded slash %252F (double)', `${USER_ID}%252F${DATE_ID}%252F${FILE}`)
rejects('encoded dot-dot %2e%2e', `${USER_ID}/%2e%2e/${FILE}`)
rejects('double-encoded dot-dot %252e%252e', `${USER_ID}/%252e%252e/${FILE}`)
rejects('lone percent %25', `${USER_ID}/${DATE_ID}/%25${FILE}`)
rejects('malformed percent encoding', `${USER_ID}/${DATE_ID}/%zz${FILE}`)
rejects('encoded NUL', `${USER_ID}/${DATE_ID}/%00${FILE}`)
rejects('encoded question mark', `${USER_ID}/${DATE_ID}/%3f${FILE}`)
rejects('encoded hash', `${USER_ID}/${DATE_ID}/%23${FILE}`)
rejects('signed URL endpoint', `${SUPABASE_URL}/storage/v1/object/sign/meal-photos/${OBJECT_PATH}?token=abc.def.ghi`)
rejects('authenticated endpoint', `${SUPABASE_URL}/storage/v1/object/authenticated/meal-photos/${OBJECT_PATH}`)
rejects('blob URL', `blob:${SUPABASE_URL}/11111111-2222-3333-4444-555555555555`)
rejects('data URL', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')
rejects('javascript URL', 'javascript:alert(1)')
rejects('raw object path with query string', `${OBJECT_PATH}?download=1`)
rejects('raw object path with fragment', `${OBJECT_PATH}#preview`)

// --- context guards ---
test('rejects: empty userId in context', () => {
  assert.equal(normalizeMealPhotoPath(OBJECT_PATH, { supabaseUrl: SUPABASE_URL, userId: '' }), null)
})

test('rejects: invalid supabaseUrl in context (legacy URL form only)', () => {
  assert.equal(normalizeMealPhotoPath(PUBLIC_URL, { supabaseUrl: 'not-a-url', userId: USER_ID }), null)
})
