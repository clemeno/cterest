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

const kCookieName = 'cterest.mock'
const kDefaultPort = 3001
const vEnvPort = TO_NUMBER(process.env.PORT)
const kPort = (Number.isSafeInteger(vEnvPort) && 0 < vEnvPort && vEnvPort <= 65_535) ? vEnvPort : kDefaultPort
const kMaxDimension = 100_000
const kSessionMaxAge = 86_400
const kVisibilities: Visibility[] = ['private', 'protected', 'public']

// Mock credential shared by every seeded account. Supplied via MOCK_PASSWORD (e.g.
// `MOCK_PASSWORD=secret bun start`), else a random one is generated and printed at
// startup for local dev. ponytail: plaintext compare — fine for an in-memory
// localhost mock; the real API stores hashed creds and does a timing-safe check.
const kPasswordFromEnv = process.env.MOCK_PASSWORD
const kPassword = kPasswordFromEnv ?? UUID_V4()

// Positive-integer env override for a rate-limit knob, else the compiled-in default.
function rateEnv (inArgs: { name: string; fallback: number }): number {
  const vN = Number(process.env[inArgs.name])
  return Number.isInteger(vN) && vN > 0 ? vN : inArgs.fallback
}

// Sliding-window rate limits (mock-only, in-memory). Defaults blunt password
// brute-force on sign-in and write floods on other mutations; each knob is overridable
// via env (the *_WINDOW values are seconds), same pattern as MOCK_PASSWORD / PORT.
const kSignInRule: RateRule = { max: rateEnv({ name: 'RATE_LIMIT_SIGNIN_MAX', fallback: 5 }), windowMs: rateEnv({ name: 'RATE_LIMIT_SIGNIN_WINDOW', fallback: 60 }) * 1000 }
const kMutationRule: RateRule = { max: rateEnv({ name: 'RATE_LIMIT_MUTATION_MAX', fallback: 60 }), windowMs: rateEnv({ name: 'RATE_LIMIT_MUTATION_WINDOW', fallback: 60 }) * 1000 }

// Text extensions we ship an on-disk sample for (see ../fixtures/<ext>.sample). Doubles
// as a path-traversal allowlist: only these join the fixtures dir, so the path built in
// textFixturePath is fully server-controlled even for attacker-chosen filenames. The
// .sample disk suffix keeps these files out of the lint/tsc globs — the media record's
// filename, not the disk name, drives the editor language.
const kTextExts = ['txt', 'md', 'html', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'json']

const db: Store = seed()

// Live rate-limit state: key -> recent hit timestamps (ms). Keys are scope:ip:who so a
// flood from one client/account can't spend another's budget. ponytail: grows unbounded
// (no eviction) — fine for a localhost mock; a real API keys these in Redis with TTLs.
const rateHits = new Map<string, number[]>()

// Record a hit against `key` under `rule` and report whether it's now over the limit.
function checkRate (inArgs: { key: string; rule: RateRule }): { limited: boolean; retryAfter: number } {
  const vOut = slidingWindow({ hits: rateHits.get(inArgs.key) ?? [], now: Date.now(), rule: inArgs.rule })
  rateHits.set(inArgs.key, vOut.hits)
  return { limited: vOut.limited, retryAfter: vOut.retryAfter }
}

// Newest-upload-first order, shared by the owner + folder listings.
// eslint-disable-next-line max-params -- Array.sort comparator signature is fixed by the API
const byNewest = (inA: Media, inB: Media): number => inB.uploadedAt.localeCompare(inA.uploadedAt)

// Resolve the signed-in email from the session cookie (null = anonymous).
// Cookie values are loosely typed (unknown) by Elysia, so narrow to a string.
function currentEmail (inCookie: Record<string, { value?: unknown }>): string | null {
  const vSid = inCookie[kCookieName]?.value
  return typeof vSid === 'string' ? db.sessions.get(vSid) ?? null : null
}

// Public shape of a user sent to the client (nothing secret to hide here).
function publicUser (inEmail: string): { email: string; name: string } | null {
  const vUser = db.users.find(u => u.email === inEmail)
  return vUser !== undefined ? { email: vUser.email, name: vUser.name } : null
}

// Media referenced by a folder, newest upload first.
function folderMedia (inFolderId: string) {
  const vIds = new Set(db.links.filter(l => l.folderId === inFolderId).map(l => l.mediaId))
  return db.media
    .filter(m => vIds.has(m.id))
    .sort(byNewest)
}

// Absolute path to the on-disk sample backing a text media, or null when the media
// is not a text kind we ship a fixture for. The extension is checked against the
// kTextExts allowlist first, so the returned path can never escape the fixtures dir.
function textFixturePath (inMedia: Media): string | null {
  const vExt = inMedia.filename.split('.').pop()?.toLowerCase() ?? ''
  const vOk = inMedia.category === 'text' && kTextExts.includes(vExt)
  return vOk ? `${import.meta.dir}/../fixtures/${vExt}.sample` : null
}

// Sandbox headers + a body for any /raw response (§7). Text media stream their real
// fixture bytes (so the editor has something to highlight/edit); everything else gets
// an inline SVG placeholder. The real API would stream the stored file for all kinds.
async function rawResponse (inArgs: { media: Media; download: boolean }): Promise<Response> {
  const vMedia = inArgs.media
  const vName = encodeURIComponent(vMedia.filename)
  const vTextPath = textFixturePath(vMedia)
  const vTextFile = vTextPath !== null ? Bun.file(vTextPath) : null
  let vBody: string
  let vContentType: string
  let vInline: boolean
  if (vTextFile !== null && await vTextFile.exists()) {
    vBody = await vTextFile.text()
    vContentType = `${vMedia.mime}; charset=utf-8`
    vInline = !inArgs.download
  } else {
    vBody = svgPlaceholder(vMedia)
    vContentType = 'image/svg+xml'
    vInline = !inArgs.download && vMedia.previewable
  }
  const vDisposition = vInline ? 'inline' : 'attachment'
  return new Response(vBody, {
    headers: {
      'Content-Type': vContentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `${vDisposition}; filename*=UTF-8''${vName}`,
    },
  })
}

const app = new Elysia()
  .use(cors({ origin: true, credentials: true }))
// Generic error envelope — never leak internals (§11).
  .onError(({ code, set }) => {
    let vResult: { error: string }
    if (code === 'NOT_FOUND') {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      set.status = typeof set.status === 'number' && set.status !== 200 ? set.status : 500
      vResult = { error: 'request failed' }
    }
    return vResult
  })

// Rate-limit writes before they run. Sign-in is capped hardest to blunt password
// brute-force and is keyed on the submitted email too, so guesses against one account
// can't exhaust another's budget; other mutations key on the session email. Reads are
// unlimited. On the localhost mock every client is 127.0.0.1, so per-IP keying acts
// global until a proxy fronts it with X-Forwarded-For.
  .onBeforeHandle(({ request, path, body, cookie, set, server }) => {
    const vMethod = request.method
    const vIsSignIn = vMethod === 'POST' && path === '/api/auth/mock-sign-in'
    const vIsMutation = vMethod === 'POST' || vMethod === 'PUT' || vMethod === 'PATCH' || vMethod === 'DELETE'
    let vResult: { error: string } | undefined
    if (vIsSignIn || vIsMutation) {
      const vFwd = request.headers.get('x-forwarded-for')
      const vIp = vFwd?.split(',')[0]?.trim() ?? server?.requestIP(request)?.address ?? 'local'
      const vWho = vIsSignIn ? ((body as { email?: string })?.email ?? '-') : (currentEmail(cookie) ?? '-')
      const vScope = vIsSignIn ? 'signin' : 'mut'
      const vRule = vIsSignIn ? kSignInRule : kMutationRule
      const vGate = checkRate({ key: `${vScope}:${vIp}:${vWho}`, rule: vRule })
      if (vGate.limited) {
        set.status = 429
        set.headers['Retry-After'] = String(vGate.retryAfter)
        vResult = { error: 'rate limited' } // envelope matches onError (§11)
      }
    }
    return vResult
  })

// ---- Auth (mock-simplified) --------------------------------------------
  .get('/api/auth/session', ({ cookie }) => {
    const vEmail = currentEmail(cookie)
    return { user: vEmail !== null ? publicUser(vEmail) : null }
  })
  .post('/api/auth/mock-sign-in', ({ body, cookie, set }) => {
    const vEmail = (body as { email?: string })?.email
    const vPassword = (body as { password?: string })?.password
    const vUser = vEmail !== undefined ? db.users.find(u => u.email === vEmail) : undefined
    let vResult: unknown
    if (vUser === undefined || vPassword !== kPassword) {
      set.status = 403
      vResult = { error: 'sign-in failed' } // generic: no email-vs-password oracle
    } else {
      // Session token uses random v4 (unpredictable) — not a sortable entity id, so not UUID_V7.
      const vSid = UUID_V4()
      db.sessions.set(vSid, vUser.email)
      cookie[kCookieName]?.set({ value: vSid, httpOnly: true, sameSite: 'lax', path: '/', maxAge: kSessionMaxAge })
      vResult = { user: publicUser(vUser.email) }
    }
    return vResult
  })
  .post('/api/auth/sign-out', ({ cookie }) => {
    const vSid = cookie[kCookieName]?.value as string | undefined
    if (vSid !== undefined) { db.sessions.delete(vSid) }
    cookie[kCookieName]?.remove()
    return { ok: true }
  })

// ---- Owner media routes (session required) -----------------------------
  .get('/api/media', ({ cookie, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vLimit = validateLimit(query.limit)
    let vResult: unknown
    if (vEmail === null) {
      set.status = 401
      vResult = { error: 'unauthenticated' }
    } else if (vLimit === null) {
      set.status = 400
      vResult = { error: 'invalid limit' }
    } else {
      const vOwn = db.media
        .filter(m => m.uploaderEmail === vEmail)
        .sort(byNewest)
      vResult = paginate({ all: vOwn, limit: vLimit, offset: parseOffset(query.offset) })
    }
    return vResult
  })
  .post('/api/media', ({ cookie, query, request, set }) => {
    const vEmail = currentEmail(cookie)
    const vFilename = (query.filename ?? '').trim()
    const vMime = resolveMime({ filename: vFilename, type: query.type ?? '' })
    const vCategory = categoryOf(vMime)
    const vClamp = (inRaw: string | undefined): number | null => {
      const vN = Number(inRaw)
      return Number.isInteger(vN) && vN > 0 && vN < kMaxDimension ? vN : null
    }
    let vResult: unknown
    if (vEmail === null) {
      set.status = 401
      vResult = { error: 'unauthenticated' }
    } else if (vFilename === '' || vCategory === null) {
      set.status = 400
      vResult = { error: 'bad filename or type' }
    } else {
      const vLen = Number(request.headers.get('content-length'))
      const vMedia = {
        id: UUID_V7(),
        filename: vFilename,
        mime: vMime,
        category: vCategory,
        width: vClamp(query.width),
        height: vClamp(query.height),
        durationMs: vClamp(query.durationMs),
        previewable: isPreviewable(vMime),
        size: Number.isNaN(vLen) ? 0 : vLen,
        uploaderEmail: vEmail,
        uploadedAt: new Date().toISOString(),
      }
      db.media.push(vMedia)
      // Optional one-shot link into the caller's own folder (§6 step 4).
      const vFolder = query.folderId !== undefined ? db.folders.find(f => f.id === query.folderId) : undefined
      if (vFolder !== undefined && vFolder.ownerEmail === vEmail) {
        db.links.push({ folderId: vFolder.id, mediaId: vMedia.id, addedAt: new Date().toISOString() })
      }
      set.status = 201
      vResult = vMedia
    }
    return vResult
  })
  .get('/api/media/:id/raw', async ({ cookie, params, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vMedia = db.media.find(m => m.id === params.id)
    let vResult: unknown
    if (vMedia === undefined || vMedia.uploaderEmail !== vEmail) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      vResult = await rawResponse({ media: vMedia, download: query.download !== undefined })
    }
    return vResult
  })
  // Save edited text back to its fixture (owner-only). Mock-only: this MUTATES the
  // on-disk sample under ../fixtures. Non-text media / non-owners get a flat 404.
  .put('/api/media/:id/raw', async ({ cookie, params, request, set }) => {
    const vEmail = currentEmail(cookie)
    const vMedia = db.media.find(m => m.id === params.id)
    const vPath = vMedia !== undefined ? textFixturePath(vMedia) : null
    let vResult: unknown
    if (vMedia === undefined || vMedia.uploaderEmail !== vEmail || vPath === null) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      const vText = await request.text()
      await Bun.write(vPath, vText)
      vMedia.size = new TextEncoder().encode(vText).length
      vResult = { ok: true, size: vMedia.size }
    }
    return vResult
  })
  .delete('/api/media/:id', ({ cookie, params, set }) => {
    const vEmail = currentEmail(cookie)
    const vIdx = db.media.findIndex(m => m.id === params.id && m.uploaderEmail === vEmail)
    let vResult: unknown
    if (vIdx === -1) {
      set.status = 404
      vResult = { error: 'not found' } // owner-only, no oracle
    } else {
      db.media.splice(vIdx, 1)
      db.links = db.links.filter(l => l.mediaId !== params.id)
      vResult = { ok: true }
    }
    return vResult
  })

// ---- Owner folder routes (session required) ----------------------------
  .get('/api/folders', ({ cookie, set }) => {
    const vEmail = currentEmail(cookie)
    let vResult: unknown
    if (vEmail === null) {
      set.status = 401
      vResult = { error: 'unauthenticated' }
    } else {
      vResult = db.folders
        .filter(f => f.ownerEmail === vEmail)
        .map(f => ({ ...f, mediaCount: db.links.filter(l => l.folderId === f.id).length }))
    }
    return vResult
  })
  .post('/api/folders', ({ cookie, body, set }) => {
    const vEmail = currentEmail(cookie)
    const vName = (body as { name?: string })?.name?.trim()
    const vVis = (body as { visibility?: Visibility })?.visibility
    let vResult: unknown
    if (vEmail === null) {
      set.status = 401
      vResult = { error: 'unauthenticated' }
    } else if (vName === undefined || vName === '' || vVis === undefined || !kVisibilities.includes(vVis)) {
      set.status = 400
      vResult = { error: 'bad folder' }
    } else {
      const vFolder = { id: UUID_V7(), slug: newSlug(), ownerEmail: vEmail, name: vName, visibility: vVis, createdAt: new Date().toISOString() }
      db.folders.push(vFolder)
      set.status = 201
      vResult = { ...vFolder, mediaCount: 0 }
    }
    return vResult
  })
  .patch('/api/folders/:id', ({ cookie, params, body, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.id === params.id && f.ownerEmail === vEmail)
    let vResult: unknown
    if (vFolder === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      const vName = (body as { name?: string })?.name?.trim()
      const vVis = (body as { visibility?: Visibility })?.visibility
      if (vName !== undefined && vName !== '') { vFolder.name = vName }
      if (vVis !== undefined && kVisibilities.includes(vVis)) { vFolder.visibility = vVis }
      vResult = { ...vFolder, mediaCount: db.links.filter(l => l.folderId === vFolder.id).length }
    }
    return vResult
  })
  .delete('/api/folders/:id', ({ cookie, params, set }) => {
    const vEmail = currentEmail(cookie)
    const vIdx = db.folders.findIndex(f => f.id === params.id && f.ownerEmail === vEmail)
    let vResult: unknown
    if (vIdx === -1) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      db.folders.splice(vIdx, 1)
      db.links = db.links.filter(l => l.folderId !== params.id) // unlink, media persist (§5)
      vResult = { ok: true }
    }
    return vResult
  })
  .post('/api/folders/:id/media', ({ cookie, params, body, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.id === params.id && f.ownerEmail === vEmail)
    const vMediaId = (body as { mediaId?: string })?.mediaId
    const vMedia = db.media.find(m => m.id === vMediaId && m.uploaderEmail === vEmail)
    let vResult: unknown
    if (vFolder === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else if (vMedia === undefined) {
      set.status = 400
      vResult = { error: 'not your media' } // folder references only owner's media
    } else {
      if (!db.links.some(l => l.folderId === vFolder.id && l.mediaId === vMedia.id)) {
        db.links.push({ folderId: vFolder.id, mediaId: vMedia.id, addedAt: new Date().toISOString() })
      }
      vResult = { ok: true }
    }
    return vResult
  })
  .delete('/api/folders/:id/media/:mediaId', ({ cookie, params, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.id === params.id && f.ownerEmail === vEmail)
    let vResult: unknown
    if (vFolder === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      db.links = db.links.filter(l => !(l.folderId === vFolder.id && l.mediaId === params.mediaId))
      vResult = { ok: true }
    }
    return vResult
  })

// ---- Folder-scoped reads (session optional; the gate decides, §7) ------
  .get('/api/f/:slug', ({ cookie, params, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.slug === params.slug)
    let vResult: unknown
    if (!canRead({ folder: vFolder, email: vEmail }) || vFolder === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      vResult = {
        slug: vFolder.slug,
        name: vFolder.name,
        visibility: vFolder.visibility,
        mediaCount: db.links.filter(l => l.folderId === vFolder.id).length,
        isOwner: vEmail === vFolder.ownerEmail,
      }
    }
    return vResult
  })
  .get('/api/f/:slug/media', ({ cookie, params, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.slug === params.slug)
    const vLimit = validateLimit(query.limit)
    let vResult: unknown
    if (!canRead({ folder: vFolder, email: vEmail }) || vFolder === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else if (vLimit === null) {
      set.status = 400
      vResult = { error: 'invalid limit' }
    } else {
      vResult = paginate({ all: folderMedia(vFolder.id), limit: vLimit, offset: parseOffset(query.offset) })
    }
    return vResult
  })
  .get('/api/f/:slug/media/:mediaId/raw', async ({ cookie, params, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.slug === params.slug)
    const vAllowed = canRead({ folder: vFolder, email: vEmail })
    const vMedia = vAllowed && vFolder !== undefined ? folderMedia(vFolder.id).find(m => m.id === params.mediaId) : undefined
    let vResult: unknown
    if (!vAllowed || vMedia === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      vResult = await rawResponse({ media: vMedia, download: query.download !== undefined })
    }
    return vResult
  })

  .listen(kPort)

console.log(`mock-api on http://localhost:${kPort}  (${db.media.length} media, ${db.folders.length} folders seeded)`)
const vOwnerEmail = db.users[0]?.email ?? '(none)'
if (kPasswordFromEnv === undefined) {
  console.log(`auth: sign in as ${vOwnerEmail} — generated password: ${kPassword}`)
} else {
  console.log(`auth: sign in as ${vOwnerEmail} — password from MOCK_PASSWORD`)
}

export { app, db }
