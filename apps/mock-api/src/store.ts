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
export const kPageSizes = [10, 20, 50, 100, 200] as const

// Default page size when the query omits it.
export const kDefaultLimit = 10

// MIME prefix -> category, in check order (first match wins).
const kCategoryPrefixes: [string, Category][] = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['audio/', 'audio'],
  ['text/', 'text'],
]

// Raster subtypes that may render inline; everything else is download-only (§6).
const kPreviewableMime = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

// Fallback MIME by file extension for uploads the browser leaves untyped, or
// mistypes (code/office files). A known extension is authoritative (see resolveMime).
const kExtensionMime: Record<string, string> = {
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
const kMimeCategory: Record<string, Category> = {
  'application/json': 'text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
}

// Map a MIME type to one of the supported categories (null = unsupported).
export function categoryOf (inMime: string): Category | null {
  const vOverride = kMimeCategory[inMime]
  const vMatch = kCategoryPrefixes.find(([inPrefix]) => inMime.startsWith(inPrefix))
  return vOverride ?? (vMatch !== undefined ? vMatch[1] : null)
}

// True when a MIME type is on the inline-preview raster allowlist.
export function isPreviewable (inMime: string): boolean {
  return kPreviewableMime.has(inMime)
}

// File extension (lowercased), or '' for dotfiles / names without an extension.
function extOf (inFilename: string): string {
  const vDot = inFilename.lastIndexOf('.')
  return vDot > 0 ? inFilename.slice(vDot + 1).toLowerCase() : ''
}

// Best MIME for an upload. Browser MIME is unreliable for code/office/av files, so a
// known extension is authoritative; dotfiles (.gitignore, .env) are treated as plain
// text; otherwise trust the browser type. The real API would sniff magic bytes.
export function resolveMime (inArgs: { filename: string; type: string }): string {
  const vExt = extOf(inArgs.filename)
  const vDotfile = vExt === '' && inArgs.filename.startsWith('.')
  const vFromExt = vDotfile ? 'text/plain' : kExtensionMime[vExt]
  return vFromExt ?? inArgs.type
}

// Validate a requested page size: undefined -> default, invalid -> null (=> 400).
export function validateLimit (inRaw: string | undefined): number | null {
  let vResult: number | null = kDefaultLimit
  if (inRaw !== undefined) {
    const vNum = Number(inRaw)
    vResult = (kPageSizes as readonly number[]).includes(vNum) ? vNum : null
  }
  return vResult
}

// Clamp an offset query to a non-negative integer.
export function parseOffset (inRaw: string | undefined): number {
  const vNum = Number(inRaw)
  return Number.isInteger(vNum) && vNum > 0 ? vNum : 0
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

// Folder access gate (§7). Returns whether the viewer (email, null = anonymous)
// may read the folder. Unknown folder is treated as private -> denied.
export function canRead (inArgs: ReadAccess): boolean {
  const vFolder = inArgs.folder
  let vResult = false
  if (vFolder === undefined) {
    vResult = false
  } else if (vFolder.visibility === 'public') {
    vResult = true
  } else if (vFolder.visibility === 'protected') {
    vResult = inArgs.email !== null
  } else {
    vResult = inArgs.email === vFolder.ownerEmail // private
  }
  return vResult
}

// 16 random bytes -> base64url: the unguessable, non-enumerable folder slug (§5).
export function newSlug (): string {
  const vBytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...vBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// A colored SVG placeholder standing in for real bytes so <img> previews render
// during UI testing (the real API streams the stored file). Mock-only stand-in.
export function svgPlaceholder (inMedia: Media): string {
  const vHues: Record<Category, number> = { image: 265, video: 210, audio: 145, text: 35, document: 5 }
  const vHue = vHues[inMedia.category]
  const vLabel = inMedia.category.toUpperCase()
  const vName = inMedia.filename.replace(/[<&>]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
<rect width="320" height="200" fill="hsl(${vHue} 55% 45%)"/>
<text x="160" y="96" fill="#fff" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle">${vLabel}</text>
<text x="160" y="132" fill="#ffffffcc" font-family="sans-serif" font-size="14" text-anchor="middle">${vName}</text>
</svg>`
}

// Build the seed database: the single real owner (clemeno@gmail.com) with enough
// media to page, and one folder per visibility.
export function seed (): Store {
  const vOwner = 'clemeno@gmail.com'
  const vNow = Date.now()
  const iso = (inMsAgo: number): string => new Date(vNow - inMsAgo).toISOString()

  const vKinds: { mime: string; ext: string; cat: Category }[] = [
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
  const vMedia: Media[] = Array.from(Array(30).keys()).map(vI => {
    const vKind = vKinds[vI % vKinds.length]! // modulo keeps index in range
    const vIsImg = vKind.cat === 'image'
    const vIsAv = vKind.cat === 'video' || vKind.cat === 'audio'
    return {
      id: UUID_V7(),
      filename: `sample-${String(vI + 1).padStart(2, '0')}.${vKind.ext}`,
      mime: vKind.mime,
      category: vKind.cat,
      width: vIsImg ? 640 : null,
      height: vIsImg ? 400 : null,
      durationMs: vIsAv ? 42_000 : null,
      previewable: isPreviewable(vKind.mime),
      size: 10_000 + vI * 1234,
      uploaderEmail: vOwner,
      uploadedAt: iso(vI * 3_600_000), // 1h apart, newest = index 0
    }
  })

  const vFolders: Folder[] = [
    { id: UUID_V7(), slug: newSlug(), ownerEmail: vOwner, name: 'Private stash', visibility: 'private', createdAt: iso(0) },
    { id: UUID_V7(), slug: newSlug(), ownerEmail: vOwner, name: 'Shared with members', visibility: 'protected', createdAt: iso(1000) },
    { id: UUID_V7(), slug: newSlug(), ownerEmail: vOwner, name: 'Public gallery', visibility: 'public', createdAt: iso(2000) },
  ]

  // Link the first few media into each folder (playlist-style references, §5).
  const vLinks: Link[] = vFolders.flatMap(inFolder =>
    Array.from(Array(6).keys()).map(vI => ({ folderId: inFolder.id, mediaId: vMedia[vI]!.id, addedAt: iso(vI * 1000) })) // 6 <= 30 media
  )

  return {
    users: [
      { email: vOwner, name: 'CLEm' },
    ],
    sessions: new Map(),
    media: vMedia,
    folders: vFolders,
    links: vLinks,
  }
}
