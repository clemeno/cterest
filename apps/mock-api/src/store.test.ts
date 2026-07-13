// Runnable check for the non-trivial pure helpers. `bun test` (or node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRead, validateLimit, paginate, categoryOf, isPreviewable, resolveMime, slidingWindow } from './store.js'
import type { Folder } from './store.js'

const folder = (inVisibility: Folder['visibility']): Folder => ({
  id: 'f', slug: 's', ownerEmail: 'owner@x', name: 'n', visibility: inVisibility, createdAt: '',
})

await test('folder gate honours visibility', () => {
  assert.equal(canRead({ folder: folder('public'), email: null }), true) // anonymous ok
  assert.equal(canRead({ folder: folder('protected'), email: null }), false) // needs a member
  assert.equal(canRead({ folder: folder('protected'), email: 'member@x' }), true)
  assert.equal(canRead({ folder: folder('private'), email: 'member@x' }), false) // not owner
  assert.equal(canRead({ folder: folder('private'), email: 'owner@x' }), true)
  assert.equal(canRead({ folder: undefined, email: 'owner@x' }), false) // unknown = denied
})

await test('page size accepts only the allowed set', () => {
  assert.equal(validateLimit(undefined), 10) // default
  assert.equal(validateLimit('50'), 50)
  assert.equal(validateLimit('7'), null) // rejected -> 400
  assert.equal(validateLimit('abc'), null)
})

await test('paginate slices and reports untruncated total', () => {
  const vAll = Array.from(Array(23).keys())
  const vPage = paginate({ all: vAll, limit: 10, offset: 20 })
  assert.deepEqual(vPage.items, [20, 21, 22])
  assert.equal(vPage.total, 23)
})

await test('mime maps to category + preview allowlist', () => {
  assert.equal(categoryOf('image/png'), 'image')
  assert.equal(categoryOf('application/pdf'), null)
  assert.equal(isPreviewable('image/png'), true)
  assert.equal(isPreviewable('image/svg+xml'), false) // svg not inline-previewable
})

await test('resolveMime infers video/audio from extension when the browser sends none', () => {
  // Untyped uploads -> inferred from extension so they categorise correctly.
  assert.equal(categoryOf(resolveMime({ filename: 'clip.avi', type: '' })), 'video')
  assert.equal(categoryOf(resolveMime({ filename: 'clip.mkv', type: 'application/octet-stream' })), 'video')
  assert.equal(categoryOf(resolveMime({ filename: 'clip.webm', type: '' })), 'video')
  assert.equal(categoryOf(resolveMime({ filename: 'song.ogg', type: '' })), 'audio')
  assert.equal(categoryOf(resolveMime({ filename: 'song.flac', type: '' })), 'audio')
  assert.equal(categoryOf(resolveMime({ filename: 'song.wav', type: 'application/octet-stream' })), 'audio')
  // A known type is kept as-is.
  assert.equal(resolveMime({ filename: 'photo.png', type: 'image/png' }), 'image/png')
})

await test('resolveMime handles documents, code, and dotfiles', () => {
  assert.equal(categoryOf(resolveMime({ filename: 'report.docx', type: '' })), 'document')
  assert.equal(categoryOf(resolveMime({ filename: 'sheet.xlsx', type: '' })), 'document')
  assert.equal(categoryOf(resolveMime({ filename: 'deck.pptx', type: '' })), 'document')
  assert.equal(categoryOf(resolveMime({ filename: 'notes.md', type: '' })), 'text')
  assert.equal(categoryOf(resolveMime({ filename: 'data.json', type: '' })), 'text')
  // Extension wins over a misleading browser MIME (.ts is TypeScript here, not MPEG-TS).
  assert.equal(categoryOf(resolveMime({ filename: 'main.ts', type: 'video/mp2t' })), 'text')
  // Dotfiles (no extension) are plain text.
  assert.equal(categoryOf(resolveMime({ filename: '.gitignore', type: '' })), 'text')
  assert.equal(categoryOf(resolveMime({ filename: '.env', type: 'application/octet-stream' })), 'text')
})

await test('sliding window caps hits per trailing window', () => {
  const vRule = { max: 3, windowMs: 1000 }
  // Three hits inside the window are each recorded, none limited.
  let vHits: number[] = []
  for (const vNow of [0, 100, 200]) {
    const vOut = slidingWindow({ hits: vHits, now: vNow, rule: vRule })
    assert.equal(vOut.limited, false)
    vHits = vOut.hits
  }
  assert.equal(vHits.length, 3)
  // A 4th hit still inside the window is limited, is NOT recorded, and reports the
  // seconds until the oldest hit (t=0) ages out (expires at 1000ms, 700ms away -> 1s).
  const vBlocked = slidingWindow({ hits: vHits, now: 300, rule: vRule })
  assert.equal(vBlocked.limited, true)
  assert.equal(vBlocked.hits.length, 3)
  assert.equal(vBlocked.retryAfter, 1)
  // Once the window slides past the old hits they are pruned and requests flow again.
  const vAfter = slidingWindow({ hits: vHits, now: 1300, rule: vRule })
  assert.equal(vAfter.limited, false)
  assert.equal(vAfter.hits.length, 1)
})
