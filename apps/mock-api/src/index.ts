// Elysia in-memory mock of the cterest /api/* contract (PLAN §7). Lets the web
// client be exercised end-to-end with no real DB, Google auth, or file storage.
// ponytail: auth here is an email + single mock password, NOT the real Better Auth
// Google flow — the web AuthService hides that behind one interface, so swapping in
// the real API later needs no component change.

import { cors } from '@elysiajs/cors'
import { TO_NUMBER, UUID_V4, UUID_V7 } from 'cme-utils'
import { Elysia } from 'elysia'
import type { Media, RateRule, Store, Visibility } from './store.js'
import {
  canRead,
  categoryOf,
  isPreviewable,
  newSlug,
  paginate,
  parseOffset,
  resolveMime,
  seed,
  slidingWindow,
  svgPlaceholder,
  validateLimit,
} from './store.js'

const COOKIE_NAME = 'cterest.mock'
const DEFAULT_PORT = 3001
const envPort = TO_NUMBER(process.env.PORT)
const PORT = (Number.isSafeInteger(envPort) && 0 < envPort && envPort <= 65_535) ? envPort : DEFAULT_PORT
const MAX_DIMENSION = 100_000
const SESSION_MAX_AGE = 86_400
const VISIBILITIES: Visibility[] = ['private', 'protected', 'public']

// Mock credential shared by every seeded account. Supplied via MOCK_PASSWORD (e.g.
// `MOCK_PASSWORD=secret bun start`), else a random one is generated and printed at
// startup for local dev. ponytail: plaintext compare — fine for an in-memory
// localhost mock; the real API stores hashed creds and does a timing-safe check.
const PASSWORD_FROM_ENV = process.env.MOCK_PASSWORD
const PASSWORD = PASSWORD_FROM_ENV ?? UUID_V4()

// Positive-integer env override for a rate-limit knob, else the compiled-in default.
function rateEnv (inArgs: { name: string; fallback: number }): number {
  const n = Number(process.env[inArgs.name])
  return Number.isInteger(n) && n > 0 ? n : inArgs.fallback
}

// Sliding-window rate limits (mock-only, in-memory). Defaults blunt password
// brute-force on sign-in and write floods on other mutations; each knob is overridable
// via env (the *_WINDOW values are seconds), same pattern as MOCK_PASSWORD / PORT.
const SIGN_IN_RULE: RateRule = { max: rateEnv({ name: 'RATE_LIMIT_SIGNIN_MAX', fallback: 5 }), windowMs: rateEnv({ name: 'RATE_LIMIT_SIGNIN_WINDOW', fallback: 60 }) * 1000 }
const MUTATION_RULE: RateRule = { max: rateEnv({ name: 'RATE_LIMIT_MUTATION_MAX', fallback: 60 }), windowMs: rateEnv({ name: 'RATE_LIMIT_MUTATION_WINDOW', fallback: 60 }) * 1000 }

// Text extensions we ship an on-disk sample for (see ../fixtures/<ext>.sample). Doubles
// as a path-traversal allowlist: only these join the fixtures dir, so the path built in
// textFixturePath is fully server-controlled even for attacker-chosen filenames. The
// .sample disk suffix keeps these files out of the lint/tsc globs — the media record's
// filename, not the disk name, drives the editor language.
const TEXT_EXTS = ['txt', 'md', 'html', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'json']

const db: Store = seed()

// Live rate-limit state: key -> recent hit timestamps (ms). Keys are scope:ip:who so a
// flood from one client/account can't spend another's budget. ponytail: grows unbounded
// (no eviction) — fine for a localhost mock; a real API keys these in Redis with TTLs.
const rateHits = new Map<string, number[]>()

// Record a hit against `key` under `rule` and report whether it's now over the limit.
function checkRate (inArgs: { key: string; rule: RateRule }): { limited: boolean; retryAfter: number } {
  const out = slidingWindow({ hits: rateHits.get(inArgs.key) ?? [], now: Date.now(), rule: inArgs.rule })
  rateHits.set(inArgs.key, out.hits)
  return { limited: out.limited, retryAfter: out.retryAfter }
}

// Newest-upload-first order, shared by the owner + folder listings.
// eslint-disable-next-line max-params -- Array.sort comparator signature is fixed by the API
const byNewest = (inA: Media, inB: Media): number => inB.uploadedAt.localeCompare(inA.uploadedAt)

// Resolve the signed-in email from the session cookie (null = anonymous).
// Cookie values are loosely typed (unknown) by Elysia, so narrow to a string.
function currentEmail (inCookie: Record<string, { value?: unknown }>): string | null {
  const sid = inCookie[COOKIE_NAME]?.value
  return typeof sid === 'string' ? db.sessions.get(sid) ?? null : null
}

// Public shape of a user sent to the client (nothing secret to hide here).
function publicUser (inEmail: string): { email: string; name: string } | null {
  const user = db.users.find(u => u.email === inEmail)
  return user !== undefined ? { email: user.email, name: user.name } : null
}

// Media referenced by a folder, newest upload first.
function folderMedia (inFolderId: string) {
  const ids = new Set(db.links.filter(l => l.folderId === inFolderId).map(l => l.mediaId))
  return db.media
    .filter(m => ids.has(m.id))
    .sort(byNewest)
}

// Absolute path to the on-disk sample backing a text media, or null when the media
// is not a text kind we ship a fixture for. The extension is checked against the
// TEXT_EXTS allowlist first, so the returned path can never escape the fixtures dir.
function textFixturePath (inMedia: Media): string | null {
  const ext = inMedia.filename.split('.').pop()?.toLowerCase() ?? ''
  const ok = inMedia.category === 'text' && TEXT_EXTS.includes(ext)
  return ok ? `${import.meta.dir}/../fixtures/${ext}.sample` : null
}

// Sandbox headers + a body for any /raw response (§7). Text media stream their real
// fixture bytes (so the editor has something to highlight/edit); everything else gets
// an inline SVG placeholder. The real API would stream the stored file for all kinds.
async function rawResponse (inArgs: { media: Media; download: boolean }): Promise<Response> {
  const media = inArgs.media
  const name = encodeURIComponent(media.filename)
  const textPath = textFixturePath(media)
  const textFile = textPath !== null ? Bun.file(textPath) : null
  let body: string
  let contentType: string
  let inline: boolean
  if (textFile !== null && await textFile.exists()) {
    body = await textFile.text()
    contentType = `${media.mime}; charset=utf-8`
    inline = !inArgs.download
  } else {
    body = svgPlaceholder(media)
    contentType = 'image/svg+xml'
    inline = !inArgs.download && media.previewable
  }
  const disposition = inline ? 'inline' : 'attachment'
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `${disposition}; filename*=UTF-8''${name}`,
    },
  })
}

const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
// Generic error envelope — never leak internals (§11).
  .onError(({ code, set }) => {
    let result: { error: string }
    if (code === 'NOT_FOUND') {
      set.status = 404
      result = { error: 'not found' }
    } else {
      set.status = typeof set.status === 'number' && set.status !== 200 ? set.status : 500
      result = { error: 'request failed' }
    }
    return result
  })

// Rate-limit writes before they run. Sign-in is capped hardest to blunt password
// brute-force and is keyed on the submitted email too, so guesses against one account
// can't exhaust another's budget; other mutations key on the session email. Reads are
// unlimited. On the localhost mock every client is 127.0.0.1, so per-IP keying acts
// global until a proxy fronts it with X-Forwarded-For.
  .onBeforeHandle(({ request, path, body, cookie, set, server }) => {
    const method = request.method
    const isSignIn = method === 'POST' && path === '/api/auth/mock-sign-in'
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
    let result: { error: string } | undefined
    if (isSignIn || isMutation) {
      const fwd = request.headers.get('x-forwarded-for')
      const ip = fwd?.split(',')[0]?.trim() ?? server?.requestIP(request)?.address ?? 'local'
      const who = isSignIn ? ((body as { email?: string })?.email ?? '-') : (currentEmail(cookie) ?? '-')
      const scope = isSignIn ? 'signin' : 'mut'
      const rule = isSignIn ? SIGN_IN_RULE : MUTATION_RULE
      const gate = checkRate({ key: `${scope}:${ip}:${who}`, rule: rule })
      if (gate.limited) {
        set.status = 429
        set.headers['Retry-After'] = String(gate.retryAfter)
        result = { error: 'rate limited' } // envelope matches onError (§11)
      }
    }
    return result
  })

// ---- Auth (mock-simplified) --------------------------------------------
  .get('/api/auth/session', ({ cookie }) => {
    const email = currentEmail(cookie)
    return { user: email !== null ? publicUser(email) : null }
  })
  .post('/api/auth/mock-sign-in', ({ body, cookie, set }) => {
    const email = (body as { email?: string })?.email
    const password = (body as { password?: string })?.password
    const user = email !== undefined ? db.users.find(u => u.email === email) : undefined
    let result: unknown
    if (user === undefined || password !== PASSWORD) {
      set.status = 403
      result = { error: 'sign-in failed' } // generic: no email-vs-password oracle
    } else {
      // Session token uses random v4 (unpredictable) — not a sortable entity id, so not UUID_V7.
      const sid = UUID_V4()
      db.sessions.set(sid, user.email)
      cookie[COOKIE_NAME]?.set({ value: sid, httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE })
      result = { user: publicUser(user.email) }
    }
    return result
  })
  .post('/api/auth/sign-out', ({ cookie }) => {
    const sid = cookie[COOKIE_NAME]?.value as string | undefined
    if (sid !== undefined) { db.sessions.delete(sid) }
    cookie[COOKIE_NAME]?.remove()
    return { ok: true }
  })

// ---- Owner media routes (session required) -----------------------------
  .get('/api/media', ({ cookie, query, set }) => {
    const email = currentEmail(cookie)
    const limit = validateLimit(query.limit)
    let result: unknown
    if (email === null) {
      set.status = 401
      result = { error: 'unauthenticated' }
    } else if (limit === null) {
      set.status = 400
      result = { error: 'invalid limit' }
    } else {
      const own = db.media
        .filter(m => m.uploaderEmail === email)
        .sort(byNewest)
      result = paginate({ all: own, limit: limit, offset: parseOffset(query.offset) })
    }
    return result
  })
  .post('/api/media', ({ cookie, query, request, set }) => {
    const email = currentEmail(cookie)
    const filename = (query.filename ?? '').trim()
    const mime = resolveMime({ filename: filename, type: query.type ?? '' })
    const category = categoryOf(mime)
    const clamp = (inRaw: string | undefined): number | null => {
      const n = Number(inRaw)
      return Number.isInteger(n) && n > 0 && n < MAX_DIMENSION ? n : null
    }
    let result: unknown
    if (email === null) {
      set.status = 401
      result = { error: 'unauthenticated' }
    } else if (filename === '' || category === null) {
      set.status = 400
      result = { error: 'bad filename or type' }
    } else {
      const len = Number(request.headers.get('content-length'))
      const media = {
        id: UUID_V7(),
        filename: filename,
        mime: mime,
        category: category,
        width: clamp(query.width),
        height: clamp(query.height),
        durationMs: clamp(query.durationMs),
        previewable: isPreviewable(mime),
        size: Number.isNaN(len) ? 0 : len,
        uploaderEmail: email,
        uploadedAt: new Date().toISOString(),
      }
      db.media.push(media)
      // Optional one-shot link into the caller's own folder (§6 step 4).
      const folder = query.folderId !== undefined ? db.folders.find(f => f.id === query.folderId) : undefined
      if (folder !== undefined && folder.ownerEmail === email) {
        db.links.push({ folderId: folder.id, mediaId: media.id, addedAt: new Date().toISOString() })
      }
      set.status = 201
      result = media
    }
    return result
  })
  .get('/api/media/:id/raw', async ({ cookie, params, query, set }) => {
    const email = currentEmail(cookie)
    const media = db.media.find(m => m.id === params.id)
    let result: unknown
    if (media === undefined || media.uploaderEmail !== email) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      result = await rawResponse({ media: media, download: query.download !== undefined })
    }
    return result
  })
  // Save edited text back to its fixture (owner-only). Mock-only: this MUTATES the
  // on-disk sample under ../fixtures. Non-text media / non-owners get a flat 404.
  .put('/api/media/:id/raw', async ({ cookie, params, request, set }) => {
    const email = currentEmail(cookie)
    const media = db.media.find(m => m.id === params.id)
    const path = media !== undefined ? textFixturePath(media) : null
    let result: unknown
    if (media === undefined || media.uploaderEmail !== email || path === null) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      const text = await request.text()
      await Bun.write(path, text)
      media.size = new TextEncoder().encode(text).length
      result = { ok: true, size: media.size }
    }
    return result
  })
  .delete('/api/media/:id', ({ cookie, params, set }) => {
    const email = currentEmail(cookie)
    const idx = db.media.findIndex(m => m.id === params.id && m.uploaderEmail === email)
    let result: unknown
    if (idx === -1) {
      set.status = 404
      result = { error: 'not found' } // owner-only, no oracle
    } else {
      db.media.splice(idx, 1)
      db.links = db.links.filter(l => l.mediaId !== params.id)
      result = { ok: true }
    }
    return result
  })

// ---- Owner folder routes (session required) ----------------------------
  .get('/api/folders', ({ cookie, set }) => {
    const email = currentEmail(cookie)
    let result: unknown
    if (email === null) {
      set.status = 401
      result = { error: 'unauthenticated' }
    } else {
      result = db.folders
        .filter(f => f.ownerEmail === email)
        .map(f => ({ ...f, mediaCount: db.links.filter(l => l.folderId === f.id).length }))
    }
    return result
  })
  .post('/api/folders', ({ cookie, body, set }) => {
    const email = currentEmail(cookie)
    const name = (body as { name?: string })?.name?.trim()
    const vis = (body as { visibility?: Visibility })?.visibility
    let result: unknown
    if (email === null) {
      set.status = 401
      result = { error: 'unauthenticated' }
    } else if (name === undefined || name === '' || vis === undefined || !VISIBILITIES.includes(vis)) {
      set.status = 400
      result = { error: 'bad folder' }
    } else {
      const folder = { id: UUID_V7(), slug: newSlug(), ownerEmail: email, name: name, visibility: vis, createdAt: new Date().toISOString() }
      db.folders.push(folder)
      set.status = 201
      result = { ...folder, mediaCount: 0 }
    }
    return result
  })
  .patch('/api/folders/:id', ({ cookie, params, body, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.id === params.id && f.ownerEmail === email)
    let result: unknown
    if (folder === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      const name = (body as { name?: string })?.name?.trim()
      const vis = (body as { visibility?: Visibility })?.visibility
      if (name !== undefined && name !== '') { folder.name = name }
      if (vis !== undefined && VISIBILITIES.includes(vis)) { folder.visibility = vis }
      result = { ...folder, mediaCount: db.links.filter(l => l.folderId === folder.id).length }
    }
    return result
  })
  .delete('/api/folders/:id', ({ cookie, params, set }) => {
    const email = currentEmail(cookie)
    const idx = db.folders.findIndex(f => f.id === params.id && f.ownerEmail === email)
    let result: unknown
    if (idx === -1) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      db.folders.splice(idx, 1)
      db.links = db.links.filter(l => l.folderId !== params.id) // unlink, media persist (§5)
      result = { ok: true }
    }
    return result
  })
  .post('/api/folders/:id/media', ({ cookie, params, body, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.id === params.id && f.ownerEmail === email)
    const mediaId = (body as { mediaId?: string })?.mediaId
    const media = db.media.find(m => m.id === mediaId && m.uploaderEmail === email)
    let result: unknown
    if (folder === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else if (media === undefined) {
      set.status = 400
      result = { error: 'not your media' } // folder references only owner's media
    } else {
      if (!db.links.some(l => l.folderId === folder.id && l.mediaId === media.id)) {
        db.links.push({ folderId: folder.id, mediaId: media.id, addedAt: new Date().toISOString() })
      }
      result = { ok: true }
    }
    return result
  })
  .delete('/api/folders/:id/media/:mediaId', ({ cookie, params, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.id === params.id && f.ownerEmail === email)
    let result: unknown
    if (folder === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      db.links = db.links.filter(l => !(l.folderId === folder.id && l.mediaId === params.mediaId))
      result = { ok: true }
    }
    return result
  })

// ---- Folder-scoped reads (session optional; the gate decides, §7) ------
  .get('/api/f/:slug', ({ cookie, params, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.slug === params.slug)
    let result: unknown
    if (!canRead({ folder: folder, email: email }) || folder === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      result = {
        slug: folder.slug,
        name: folder.name,
        visibility: folder.visibility,
        mediaCount: db.links.filter(l => l.folderId === folder.id).length,
        isOwner: email === folder.ownerEmail,
      }
    }
    return result
  })
  .get('/api/f/:slug/media', ({ cookie, params, query, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.slug === params.slug)
    const limit = validateLimit(query.limit)
    let result: unknown
    if (!canRead({ folder: folder, email: email }) || folder === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else if (limit === null) {
      set.status = 400
      result = { error: 'invalid limit' }
    } else {
      result = paginate({ all: folderMedia(folder.id), limit: limit, offset: parseOffset(query.offset) })
    }
    return result
  })
  .get('/api/f/:slug/media/:mediaId/raw', async ({ cookie, params, query, set }) => {
    const email = currentEmail(cookie)
    const folder = db.folders.find(f => f.slug === params.slug)
    const allowed = canRead({ folder: folder, email: email })
    const media = allowed && folder !== undefined ? folderMedia(folder.id).find(m => m.id === params.mediaId) : undefined
    let result: unknown
    if (!allowed || media === undefined) {
      set.status = 404
      result = { error: 'not found' }
    } else {
      result = await rawResponse({ media: media, download: query.download !== undefined })
    }
    return result
  })

  .listen(PORT)

console.log(`mock-api on http://localhost:${PORT}  (${db.media.length} media, ${db.folders.length} folders seeded)`)
const ownerEmail = db.users[0]?.email ?? '(none)'
if (PASSWORD_FROM_ENV === undefined) {
  console.log(`auth: sign in as ${ownerEmail} — generated password: ${PASSWORD}`)
} else {
  console.log(`auth: sign in as ${ownerEmail} — password from MOCK_PASSWORD`)
}

export { app, db }
