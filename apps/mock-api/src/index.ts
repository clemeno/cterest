// Elysia in-memory mock of the cterest /api/* contract (PLAN §7). Lets the web
// client be exercised end-to-end with no real DB, Google auth, or file storage.
// ponytail: auth here is a simple whitelist pick, NOT the real Better Auth flow —
// the web AuthService hides that behind one interface, so swapping in the real
// API later needs no component change.

import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { UUID_V4, UUID_V7 } from 'cme-utils'
import {
  seed,
  canRead,
  categoryOf,
  isPreviewable,
  resolveMime,
  validateLimit,
  parseOffset,
  paginate,
  newSlug,
  svgPlaceholder,
} from './store.ts'
import type { Media, Store, Visibility } from './store.ts'

const kCookieName = 'cterest.mock'
const kDefaultPort = 3001
const vEnvPort = Number(process.env.PORT)
const kPort = Number.isInteger(vEnvPort) && vEnvPort > 0 ? vEnvPort : kDefaultPort
const kMaxDimension = 100_000
const kSessionMaxAge = 86_400
const kVisibilities: Visibility[] = ['private', 'protected', 'public']

const db: Store = seed()

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

// Sandbox headers + a placeholder body for any /raw response (§7). Mock serves an
// SVG inline so previews render; the real API forces SVG to attachment.
function rawResponse (inArgs: { media: ReturnType<typeof folderMedia>[number]; download: boolean }): Response {
  const vMedia = inArgs.media
  const vDisposition = inArgs.download || !vMedia.previewable ? 'attachment' : 'inline'
  const vName = encodeURIComponent(vMedia.filename)
  return new Response(svgPlaceholder(vMedia), {
    headers: {
      'Content-Type': 'image/svg+xml',
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

// ---- Auth (mock-simplified) --------------------------------------------
  .get('/api/auth/session', ({ cookie }) => {
    const vEmail = currentEmail(cookie)
    return { user: vEmail !== null ? publicUser(vEmail) : null }
  })
  .get('/api/auth/demo-users', () => db.users) // mock-only: seed emails for the sign-in page
  .post('/api/auth/mock-sign-in', ({ body, cookie, set }) => {
    const vEmail = (body as { email?: string })?.email
    const vUser = vEmail !== undefined ? db.users.find(u => u.email === vEmail) : undefined
    let vResult: unknown
    if (vUser === undefined) {
      set.status = 403
      vResult = { error: 'sign-in failed' } // generic, no oracle
    } else {
      // Session token uses random v4 (unpredictable) — not a sortable entity id, so not UUID_V7.
      const vSid = UUID_V4()
      db.sessions.set(vSid, vUser.email)
      cookie[kCookieName].set({ value: vSid, httpOnly: true, sameSite: 'lax', path: '/', maxAge: kSessionMaxAge })
      vResult = { user: publicUser(vUser.email) }
    }
    return vResult
  })
  .post('/api/auth/sign-out', ({ cookie }) => {
    const vSid = cookie[kCookieName]?.value as string | undefined
    if (vSid !== undefined) { db.sessions.delete(vSid) }
    cookie[kCookieName].remove()
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
  .get('/api/media/:id/raw', ({ cookie, params, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vMedia = db.media.find(m => m.id === params.id)
    let vResult: unknown
    if (vMedia === undefined || vMedia.uploaderEmail !== vEmail) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      vResult = rawResponse({ media: vMedia, download: query.download !== undefined })
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
  .get('/api/f/:slug/media/:mediaId/raw', ({ cookie, params, query, set }) => {
    const vEmail = currentEmail(cookie)
    const vFolder = db.folders.find(f => f.slug === params.slug)
    const vAllowed = canRead({ folder: vFolder, email: vEmail })
    const vMedia = vAllowed && vFolder !== undefined ? folderMedia(vFolder.id).find(m => m.id === params.mediaId) : undefined
    let vResult: unknown
    if (!vAllowed || vMedia === undefined) {
      set.status = 404
      vResult = { error: 'not found' }
    } else {
      vResult = rawResponse({ media: vMedia, download: query.download !== undefined })
    }
    return vResult
  })

  .listen(kPort)

console.log(`mock-api on http://localhost:${kPort}  (${db.media.length} media, ${db.folders.length} folders seeded)`)

export { app, db }
