// In-memory store + pure helpers for the mock API. No I/O, no server here so the
// helpers stay unit-testable (see store.test.ts). index.ts wires these into Elysia.

import { UUID_V7 } from 'cme-utils'

export type Visibility = 'private' | 'protected' | 'public'
export type Category = 'image' | 'video' | 'audio' | 'text' | 'document'

export interface User {
  email: string
  name: string
}

export interface Media {
  id: string
  filename: string
  mime: string
  category: Category
  width: number | null
  height: number | null
  durationMs: number | null
  previewable: boolean
  size: number
  uploaderEmail: string
  uploadedAt: string // ISO
}

export interface Folder {
  id: string
  slug: string
  ownerEmail: string
  name: string
  visibility: Visibility
  createdAt: string // ISO
}

export interface Link {
  folderId: string
  mediaId: string
  addedAt: string // ISO
}

// Whole mock database, mutated in place by the route handlers.
export interface Store {
  users: User[]
  sessions: Map<string, string> // sessionId -> email
  media: Media[]
  folders: Folder[]
  links: Link[]
}

// One-object arguments (max-params: helpers take a single options object).
export interface PageArgs<T> {
  all: T[]
  limit: number
  offset: number
}

export interface ReadAccess {
  folder: Folder | undefined
  email: string | null
}

// Page size selector offered by the UI; the API rejects anything else (§7).
export const PAGE_SIZES = [10, 20, 50, 100, 200] as const

// Default page size when the query omits it.
export const DEFAULT_LIMIT = 10

// MIME prefix -> category, in check order (first match wins).
const CATEGORY_PREFIXES: [string, Category][] = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['text/', 'text'],
]

// Raster subtypes that may render inline; everything else is download-only (§6).
const PREVIEWABLE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

// Fallback MIME by file extension for uploads the browser leaves untyped, or
// mistypes (code/office files). A known extension is authoritative (see resolveMime).
const EXTENSION_MIME: Record<string, string> = {
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  json: 'application/json',
}

// Non-prefixed MIME types that still map to a category (office docs, JSON).
const MIME_CATEGORY: Record<string, Category> = {
  'application/json': 'text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
}

// Map a MIME type to one of the supported categories (null = unsupported).
export function categoryOf (inMime: string): Category | null {
  const override = MIME_CATEGORY[inMime]
  const match = CATEGORY_PREFIXES.find(([inPrefix]) => inMime.startsWith(inPrefix))
  return override ?? (match !== undefined ? match[1] : null)
}

// True when a MIME type is on the inline-preview raster allowlist.
export function isPreviewable (inMime: string): boolean {
  return PREVIEWABLE_MIME.has(inMime)
}

// File extension (lowercased), or '' for dotfiles / names without an extension.
function extOf (inFilename: string): string {
  const dot = inFilename.lastIndexOf('.')
  return dot > 0 ? inFilename.slice(dot + 1).toLowerCase() : ''
}

// Best MIME for an upload. Browser MIME is unreliable for code/office/av files, so a
// known extension is authoritative; dotfiles (.gitignore, .env) are treated as plain
// text; otherwise trust the browser type. The real API would sniff magic bytes.
export function resolveMime (inArgs: { filename: string; type: string }): string {
  const ext = extOf(inArgs.filename)
  const dotfile = ext === '' && inArgs.filename.startsWith('.')
  const fromExt = dotfile ? 'text/plain' : EXTENSION_MIME[ext]
  return fromExt ?? inArgs.type
}

// Validate a requested page size: undefined -> default, invalid -> null (=> 400).
export function validateLimit (inRaw: string | undefined): number | null {
  let result: number | null = DEFAULT_LIMIT
  if (inRaw !== undefined) {
    const num = Number(inRaw)
    result = (PAGE_SIZES as readonly number[]).includes(num) ? num : null
  }
  return result
}

// Clamp an offset query to a non-negative integer.
export function parseOffset (inRaw: string | undefined): number {
  const num = Number(inRaw)
  return Number.isInteger(num) && num > 0 ? num : 0
}

// Slice a list into one page and report the untruncated total (§11 H3).
export function paginate<T> (inArgs: PageArgs<T>) {
  return {
    items: inArgs.all.slice(inArgs.offset, inArgs.offset + inArgs.limit),
    total: inArgs.all.length,
    limit: inArgs.limit,
    offset: inArgs.offset,
  }
}

// A rate-limit rule: at most `max` hits per trailing `windowMs` window.
export interface RateRule {
  max: number
  windowMs: number
}

// Sliding-window rate-limit decision, kept pure so it stays unit-testable (the caller
// owns storage — a Map in the mock, Redis in a real API). Given a key's prior hit
// timestamps (ms), the current time, and the rule: prunes hits older than the window,
// then either records this hit (under the limit) or reports `limited` with `retryAfter`
// seconds until the oldest still-counted hit ages out. Never mutates the input array.
export function slidingWindow (inArgs: { hits: number[]; now: number; rule: RateRule }): { hits: number[]; limited: boolean; retryAfter: number } {
  const rule = inArgs.rule
  const cutoff = inArgs.now - rule.windowMs
  const recent = inArgs.hits.filter(inT => inT > cutoff)
  let result: { hits: number[]; limited: boolean; retryAfter: number }
  if (recent.length >= rule.max) {
    const oldest = recent[0]! // filter preserves order, so element 0 expires soonest
    result = { hits: recent, limited: true, retryAfter: Math.max(1, Math.ceil((oldest + rule.windowMs - inArgs.now) / 1000)) }
  } else {
    result = { hits: [...recent, inArgs.now], limited: false, retryAfter: 0 }
  }
  return result
}

// Folder access gate (§7). Returns whether the viewer (email, null = anonymous)
// may read the folder. Unknown folder is treated as private -> denied.
export function canRead (inArgs: ReadAccess): boolean {
  const folder = inArgs.folder
  let result = false
  if (folder === undefined) {
    result = false
  } else if (folder.visibility === 'public') {
    result = true
  } else if (folder.visibility === 'protected') {
    result = inArgs.email !== null
  } else {
    result = inArgs.email === folder.ownerEmail // private
  }
  return result
}

// 16 random bytes -> base64url: the unguessable, non-enumerable folder slug (§5).
export function newSlug (): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// A colored SVG placeholder standing in for real bytes so <img> previews render
// during UI testing (the real API streams the stored file). Mock-only stand-in.
export function svgPlaceholder (inMedia: Media): string {
  const hues: Record<Category, number> = { image: 265, video: 210, audio: 145, text: 35, document: 5 }
  const hue = hues[inMedia.category]
  const label = inMedia.category.toUpperCase()
  const name = inMedia.filename.replace(/[<&>]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<rect width="320" height="200" fill="hsl(${hue} 55% 45%)"/>
<text x="160" y="96" fill="#fff" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle">${label}</text>
<text x="160" y="132" fill="#ffffffcc" font-family="sans-serif" font-size="14" text-anchor="middle">${name}</text>
</svg>`
}

// Build the seed database: the single real owner (clemeno@gmail.com) with enough
// media to page, and one folder per visibility.
export function seed (): Store {
  const owner = 'clemeno@gmail.com'
  const now = Date.now()
  const iso = (inMsAgo: number): string => new Date(now - inMsAgo).toISOString()

  const kinds: { mime: string; ext: string; cat: Category }[] = [
    { mime: 'image/png', ext: 'png', cat: 'image' },
    { mime: 'image/jpeg', ext: 'jpg', cat: 'image' },
    { mime: 'image/webp', ext: 'webp', cat: 'image' },
    { mime: 'video/mp4', ext: 'mp4', cat: 'video' },
    { mime: 'video/x-msvideo', ext: 'avi', cat: 'video' },
    { mime: 'video/x-matroska', ext: 'mkv', cat: 'video' },
    { mime: 'video/webm', ext: 'webm', cat: 'video' },
    { mime: 'audio/mpeg', ext: 'mp3', cat: 'audio' },
    { mime: 'audio/ogg', ext: 'ogg', cat: 'audio' },
    { mime: 'audio/flac', ext: 'flac', cat: 'audio' },
    { mime: 'audio/wav', ext: 'wav', cat: 'audio' },
    { mime: 'text/plain', ext: 'txt', cat: 'text' },
    { mime: 'text/markdown', ext: 'md', cat: 'text' },
    { mime: 'text/html', ext: 'html', cat: 'text' },
    { mime: 'text/css', ext: 'css', cat: 'text' },
    { mime: 'text/x-scss', ext: 'scss', cat: 'text' },
    { mime: 'text/javascript', ext: 'js', cat: 'text' },
    { mime: 'text/javascript', ext: 'mjs', cat: 'text' },
    { mime: 'text/javascript', ext: 'cjs', cat: 'text' },
    { mime: 'text/typescript', ext: 'ts', cat: 'text' },
    { mime: 'application/json', ext: 'json', cat: 'text' },
    { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', cat: 'document' },
    { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', cat: 'document' },
    { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', cat: 'document' },
  ]

  // 30 media (>= one per kind) so default 10/page yields 3 pages; newest first.
  const media: Media[] = Array.from(Array(30).keys()).map(i => {
    const kind = kinds[i % kinds.length]! // modulo keeps index in range
    const isImg = kind.cat === 'image'
    const isAv = kind.cat === 'video' || kind.cat === 'audio'
    return {
      id: UUID_V7(),
      filename: `sample-${String(i + 1).padStart(2, '0')}.${kind.ext}`,
      mime: kind.mime,
      category: kind.cat,
      width: isImg ? 640 : null,
      height: isImg ? 400 : null,
      durationMs: isAv ? 42_000 : null,
      previewable: isPreviewable(kind.mime),
      size: 10_000 + i * 1234,
      uploaderEmail: owner,
      uploadedAt: iso(i * 3_600_000), // 1h apart, newest = index 0
    }
  })

  const folders: Folder[] = [
    { id: UUID_V7(), slug: newSlug(), ownerEmail: owner, name: 'Private stash', visibility: 'private', createdAt: iso(0) },
    { id: UUID_V7(), slug: newSlug(), ownerEmail: owner, name: 'Shared with members', visibility: 'protected', createdAt: iso(1000) },
    { id: UUID_V7(), slug: newSlug(), ownerEmail: owner, name: 'Public gallery', visibility: 'public', createdAt: iso(2000) },
  ]

  // Link the first few media into each folder (playlist-style references, §5).
  const links: Link[] = folders.flatMap(inFolder =>
    Array.from(Array(6).keys()).map(i => ({ folderId: inFolder.id, mediaId: media[i]!.id, addedAt: iso(i * 1000) })) // 6 <= 30 media
  )

  return {
    users: [
      { email: owner, name: 'CLEm' },
    ],
    sessions: new Map(),
    media: media,
    folders: folders,
    links: links,
  }
}
