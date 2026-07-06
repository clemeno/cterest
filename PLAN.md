# cterest — Design Plan

Media registry: whitelisted Google-authenticated users upload files (drag-drop
or file picker); bytes + metadata are stored server-side. After sign-in the user
lands on their **own uploads** (paginated, newest first). Media are organised into
**folders** with per-folder visibility — private (owner only), protected (unlisted,
shareable to members by link), or public (readable by anyone, no login) — each row
offering preview, open, and download.

Status: **proof-of-concept in progress**. This document is the reference to build
against. Built so far: `apps/mock-api` (in-memory mock of the §7 contract) and
`apps/web` (Angular client). Not yet built: `apps/api` (the real ElysiaJS +
Drizzle + Better Auth + upload backend).

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| Repo | Monorepo, Bun workspaces |
| Layout | `apps/api`, `apps/web` |
| Runtime | Tiered: **Bun** (primary) → **Node 24+** → external-lib fallback |
| Backend | ElysiaJS 1.4.x; Node via `@elysiajs/node` adapter |
| DB (POC) | SQLite via Drizzle ORM → migrate to Postgres later (driver swap) |
| IDs | UUIDv7 via `cme-utils` (shared by API + client) |
| File storage | Bytes on disk (`uploads/`), metadata + path in DB |
| Dedup | Content-addressable: `blobs` (sha256) + `media`, refcount GC |
| Auth | **Better Auth**: Google ID-token sign-in → DB session + signed cookie cache (`SameSite=Lax`) |
| Whitelist | Env var, comma-separated allowed emails; sole account-creation gate via Better Auth `user.create.before` hook |
| Main view | After sign-in: user's **own uploads**, newest first, paginated (default 10/page; selector 10/20/50/100/200) |
| Folders | Playlist-style reference lists; media↔folder **many-to-many** (a link, never a byte copy); a folder references only its owner's media |
| Authz | **Folder-scoped**, all via a direct `slug` link (unlisted): private (owner only) / protected (any **whitelisted member** with the link) / public (**anyone incl. anonymous**, no login) — cross-user access is **read-only**. Writes/delete **owner-only**. Bare media id is owner-only; cross-user reads go through a folder |
| Raw serving | Same-origin, sandboxed: `CSP: sandbox` + `nosniff`; svg/text/html forced to attachment; inline preview raster-image allowlist only |
| Limits | Per-user + global storage quota, upload rate limit, concurrent-upload cap |
| Media types | image / video / audio / text / document (office: docx/xlsx/pptx; code: html/css/scss/js/ts/json/md) — client MIME pre-check + server magic-number validation; active subtypes (html/svg/js/ts) accepted but served **attachment-only**, never inline |
| Max upload | 1 GB, streamed to disk (never fully buffered in memory) |
| Frontend | Angular (latest) + Angular Material, Material 3 theme |

---

## 2. Runtime tiers

Bun is primary; Node 24+ is the fallback because production servers may not have
Bun. Only two spots are runtime-specific — everything else is one shared code path.

**Tier order:**
1. **Bun** — `bun:sqlite`, native serve, Web Crypto, `node:fs`.
2. **Node 24+** — `@elysiajs/node` adapter, `node:sqlite` (built-in), Web Crypto (global since Node 18), `node:fs`.
3. **Fallback** — external libs (`better-sqlite3`, etc.) if `node:sqlite` is unavailable.

**Seam 1 — server bootstrap:**
```ts
const isBun = typeof Bun !== 'undefined'
const app = new Elysia(isBun ? {} : { adapter: node() })
```

**Seam 2 — DB driver (Drizzle, same schema + queries on all tiers):**
- Bun → `drizzle-orm/bun-sqlite`
- Node 24+ → `drizzle-orm/node-sqlite`
- fallback → `drizzle-orm/better-sqlite3`

UUIDv7 needs no tiering: `cme-utils` uses only the Web Crypto global, which
exists in Bun, Node ≥ 18, and every browser — same import in the API and the
Angular client.

---

## 3. Tech stack + versions (mid-2026)

| Package | Version | Notes |
|---|---|---|
| `elysia` | 1.4.x | Bun-first, runs on Node via adapter |
| `@elysiajs/node` | latest | Node adapter (`adapter: node()`) |
| `@elysiajs/static` | 1.4.x | serve Angular build in prod |
| `@elysiajs/cors` | 1.4.x | dev only (same origin in prod) |
| `drizzle-orm` + `drizzle-kit` | latest | ORM + migrations |
| `better-auth` | latest | auth engine: Google verify + sessions + Drizzle adapter (web-standard handler, both runtimes) |
| `cme-utils` | ~5.6.4 | UUIDv7 generation (Web Crypto, runs everywhere) |
| `bun:sqlite` / `node:sqlite` | built in | zero native deps on Bun / Node 24+ |
| `better-sqlite3` | latest | only if Node < 22.5 |
| Angular + Angular Material | latest | M3 default; `ng add` + `m3-theme` schematic |

Tests: `node:test` — runs on both Bun and Node, no framework dependency.

---

## 4. Authentication

**Better Auth** owns the auth engine: Google verification, session storage,
Drizzle-backed tables. Its handler is web-standard (`Request` → `Response`), so
it runs on Bun and Node unchanged, and mounts into Elysia at `/api/auth/*`.

Google Identity Services on the frontend yields a Google ID token (JWT). The
client hands it to Better Auth, which verifies it and issues a session cookie so
ordinary browser navigations (open-in-new-tab, download anchors) are
authenticated — a plain `Authorization: Bearer` header is NOT sent on top-level
navigations, which is why a cookie is required.

**Setup:**
```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  socialProviders: { google: { clientId, clientSecret } },
  // signup stays ENABLED so a first-time whitelisted user can be provisioned;
  // the before-hook below is the only account-creation gate. (disableSignUp is
  // deliberately NOT set — it would also block whitelisted first-timers → lockout.)
  session: { cookieCache: { enabled: true } },       // signed cookie, DB fallback
  advanced: { cookiePrefix: 'cterest', defaultCookieAttributes: { sameSite: 'lax', secure: true } },
  databaseHooks: {
    user: { create: { before: (u) => {                // sole account-creation gate
      if (!u.emailVerified) throw new Error('signup blocked')       // Google must have verified it
      if (!whitelist.includes(u.email)) throw new Error('signup blocked')
    } } },
  },
})
// Elysia: app.mount(auth.handler)
```

**Flow (all under `/api/auth/*`, handled by Better Auth):**
```
client: authClient.signIn.social({ provider: 'google', idToken: { token } })
        → Better Auth verifies ID token (signature, aud = GOOGLE_CLIENT_ID, iss, exp)
        → user.create.before hook: email_verified AND email ∈ whitelist, else throw (block)
        → DB session row + set httpOnly Secure SameSite=Lax session cookie
sign-out → Better Auth clears cookie + deletes session row
session  → Better Auth returns current user/session from cookie cache or DB
```

- **DB-backed sessions**, not stateless. Cookie cache = signed (HMAC-SHA256)
  compact session copy → skips a DB hit per request; falls back to the DB (and
  revalidates) when cache misses or expires.
- **Whitelist is the only gate on account creation.** Social sign-up stays
  enabled so a first-time whitelisted user can be provisioned; `user.create.before`
  throws unless the email is **both** Google-verified (`emailVerified`) and ∈
  whitelist, blocking every create path (there is no other way to make a user).
  The `emailVerified` check stops a federated/unverified Google account from
  asserting a whitelisted address it does not own. `disableSignUp` is intentionally
  unset — see the setup comment: it would also block whitelisted first-timers.
- **No membership oracle**: a blocked email gets a *generic* auth failure at the
  client; the "signup blocked" reason is logged server-side only.
- **CSRF**: `SameSite=Lax` lets top-level GET navigations (open-in-new-tab,
  download anchors) carry the cookie while blocking cross-site POST/DELETE;
  Better Auth's own CSRF check stays enabled for state-changing routes. `Strict`
  is avoided — it would break external links into `/raw`.
- Non-auth endpoints guard by resolving the session via Better Auth.
- **Session required** for own routes, all writes, and protected/private folder
  reads. **Public-folder reads are unauthenticated** — those routes resolve the
  session if a cookie is present but do not require one, so anonymous visitors
  can read public folders (§7, §11 anonymous surface).
- **Revocation supported**: delete the session row (kills the session before
  expiry; cookie cache TTL bounds the staleness window).
- Requires HTTPS in production (Secure cookie).

---

## 5. Data model

Content-addressable storage: identical bytes are stored once in `blobs`, and many
logical `media` rows reference a blob. Reference counting garbage-collects a blob
when its last referencing media row is deleted.

**`blobs`** — physical content, stored once
```
sha256       TEXT    PRIMARY KEY      -- content fingerprint + lookup key
size         INTEGER NOT NULL         -- indexed; sanity + composite key
storagePath  TEXT    NOT NULL         -- uploads/<sha[0:2]>/<sha> (derivable from sha)
refCount     INTEGER NOT NULL         -- GC when it reaches 0
createdAt    TEXT    NOT NULL
```

**Path is derivable from the sha** — a pure function, no DB read:
```ts
const blobPath = (sha) => `${UPLOAD_DIR}/${sha.slice(0, 2)}/${sha}`
// sha "a3f9…e21" → apps/api/uploads/a3/a3f9…e21
```
The `sha[0:2]` shard dir is not needed to *find* the file (the full sha is
unique); it only spreads blobs across 256 evenly-filled buckets (`00`–`ff`) so
no single directory holds millions of entries. Deeper sharding
(`<sha[0:2]>/<sha[2:4]>/`) if 256 is outgrown.

Consequences of content-derived paths:
- **Self-verifying**: the filename *is* the fingerprint — re-hash bytes, compare
  to the name to detect corruption/tampering.
- **Dedup without a path lookup**: hash upload → compute path → exists = duplicate.
  The `blobs` row confirms and holds `refCount`; the location is never stored to be found.
- **Rebuildable index**: lose the DB and you can walk `uploads/` — each filename
  states its own sha. Storage self-describes.

**`media`** — logical entries, many → one blob
```
id            TEXT    PRIMARY KEY      -- uuidv7
blobSha256    TEXT    NOT NULL         -- FK → blobs.sha256
filename      TEXT    NOT NULL
mime          TEXT    NOT NULL         -- validated server-side
category      TEXT    NOT NULL         -- image | video | audio | text | document
width         INTEGER                  -- images (client-read)
height        INTEGER                  -- images (client-read)
durationMs    INTEGER                  -- audio/video (client-read)
uploaderEmail TEXT    NOT NULL
uploadedAt    TEXT    NOT NULL         -- indexed for list ordering
```

UUIDv7 primary keys are time-ordered → good index locality and natural
sort-by-creation (used for newest-first ordering of the main view, §7).

**`folders`** — playlist-style reference lists (no byte copy)
```
id           TEXT PRIMARY KEY      -- uuidv7 (internal id; owner-only routes)
slug         TEXT NOT NULL UNIQUE  -- 128-bit random base64url; the shareable/capability URL segment
ownerEmail   TEXT NOT NULL         -- FK → user.email
name         TEXT NOT NULL
visibility   TEXT NOT NULL         -- private | protected | public
createdAt    TEXT NOT NULL
```
The external URL uses `slug`, **not** `id`: uuidv7 is time-sortable and
enumerable, unfit for a shareable link — `slug` is unguessable random. Public and
protected folders are both reached by their **direct `slug` link** (unlisted, not
enumerable); the only difference is the auth gate — **public** allows **anyone
incl. anonymous** (read-only), **protected** requires an **authenticated
whitelisted member** (read-only). Private is owner-only.

**`mediaFolder`** — the many-to-many links (a media referenced in N folders)
```
folderId  TEXT NOT NULL  -- FK → folders.id
mediaId   TEXT NOT NULL  -- FK → media.id
addedAt   TEXT NOT NULL
PRIMARY KEY (folderId, mediaId)   -- a media appears at most once per folder
```
A folder references **only its owner's media** (`folders.ownerEmail ==
media.uploaderEmail`, enforced on link). Referencing/dereferencing is a link
insert/delete — the blob and the `media` row are untouched, so the same file
lives in many folders with zero duplication. Deleting a `media` row cascades its
`mediaFolder` links (and decrements the blob, §6.6); deleting a `folder` removes
only that folder's links (the media persist, still owned + still in other folders).

**`uploadBucket`** — per-user upload token bucket (§11), app-owned (kept off the
Better Auth `user` table, whose schema is regenerated)
```
userEmail    TEXT  PRIMARY KEY      -- matches media.uploaderEmail
tokens       REAL  NOT NULL         -- fractional; lazily refilled
lastRefillAt TEXT  NOT NULL         -- ISO; basis for refill math
```
Lazy refill — no timer/job. On each upload attempt, inside a transaction:
`tokens = min(CAPACITY, tokens + elapsed/REFILL_WINDOW * CAPACITY)`; if `< 1` →
`429`; else spend 1 and store `lastRefillAt = now`. Idle ≥ window auto-clamps to
full. The transaction (or a conditional `UPDATE … WHERE tokens >= 1`) prevents
two concurrent uploads double-spending the same token.

**Auth tables** (`user`, `session`, `account`, `verification`) are owned by
Better Auth — not hand-written. Generate the Drizzle schema with
`better-auth generate`, then migrate with `drizzle-kit`. `media.uploaderEmail`
references the whitelisted `user.email`.

Postgres migration later: swap the Drizzle driver; schema is portable (Better
Auth's included). BLOBs are never in the DB (only paths), so the DB stays small.

---

## 6. Upload flow (streaming + dedup + validation)

Uploads are 1 GB max, so they must stream to disk and never be fully buffered.
Elysia's built-in multipart parser both buffers via `.arrayBuffer()` and has a
documented memory leak (issue #1744), so large uploads bypass multipart entirely:
one file per request, file bytes as the **raw request body**, metadata in the
query string. Multiple files = multiple requests.

```
POST /api/media?filename=<name>&type=<mime>      (cookie-authed)
  Content-Type: <mime>,  body: raw file bytes (Web ReadableStream)
```

0. **Pre-checks (before reading the body)**: validate the query with an Elysia
   TypeBox schema (`filename`: non-empty, length-capped, control-chars stripped;
   `type`: ∈ allowed-MIME enum) → `400` on failure. Reject `413` if a
   `Content-Length` header exceeds `MAX_UPLOAD_BYTES`; reject `429` if the uploader
   is over their token bucket, concurrent-upload cap, or storage quota (§11). Cheap
   gates first.
1. **Client**: detect MIME → reject non-whitelisted types immediately (fast UX) → stream file as raw body.
2. **Server**: sniff the first ~4 KB → magic-number type detection → reject early (415) if the real category is not image/video/audio/text/document or mismatches the declared type — before writing 1 GB. Office/code files without a reliable magic number fall back to an extension→MIME map (a known extension is authoritative).
   - `text/*` has no magic number → validate as UTF-8-decodable with no NUL/binary control bytes. Active subtypes (`text/html`, `text/xml`, `image/svg+xml`, JS/TS, anything script-executable) are **accepted but served attachment-only, never inline** (§7) — the `/raw` sandbox + non-raster `attachment` disposition neutralises them. Store the sniffed subtype, not the client's claim.
   - Record a `previewable` flag = subtype ∈ raster allowlist (`png|jpeg|gif|webp|avif`); everything else is download-only.
3. Ensure `UPLOAD_DIR` exists (mkdir-recursive if absent — first upload creates it), then stream the rest → a **randomly-named temp file** (`<UPLOAD_DIR>/tmp/<random>`), feeding bytes through a streaming sha256 (`node:crypto`, both runtimes), with backpressure. Enforce the 1 GB cap (abort on exceed). A `try/finally` **always deletes the temp file** on any error, abort, or cap-exceed; a startup sweep removes stale temps left by crashes.
4. On completion (`size` + `sha256` known), in a **single DB transaction** (dedup + refcount must be atomic — else concurrent same-bytes uploads or a racing delete double-store, orphan, or GC a live blob):
   - **hit** → `refCount++`; delete the temp file (duplicate bytes).
   - **miss** → move temp → `<UPLOAD_DIR>/<sha[0:2]>/<sha>` (mkdir shard dir if absent), insert blob with `refCount = 1`.
   - insert the `media` row (uuidv7, `uploaderEmail` = session email) referencing the blob. Client-supplied `width`/`height`/`durationMs` are **clamped to sane ranges** (untrusted display metadata), non-conforming → dropped to null.
   - if `?folderId` was supplied **and** that folder is the caller's own, insert a `mediaFolder` link in the **same transaction** (else ignore — a folder references only its owner's media, §5).
5. Commit → return metadata.
6. **Delete media** (owner-only, §7): in a transaction, delete the row and `refCount--`; if it hits 0, mark for GC and delete the blob **file only after the transaction commits** (never inside, so a concurrent `refCount++` that commits first keeps the file). Re-check `refCount` is still 0 before unlinking.
7. **Orphan-blob sweep** (startup + periodic): a crash between the §6.6 commit and
   the `unlink` leaves a file with no row (or a `refCount = 0` row). Sweep removes
   blob files with no referencing row and rows stuck at `refCount = 0`,
   complementing the temp-file sweep (§6.3). Idempotent and safe to re-run.

Because every upload is hashed inline during the mandatory stream, the hash is
"free" — no separate read pass, and the size-prefilter optimization is unnecessary
for performance (size is still stored for sanity and the composite index).

Deferred: byte-compare on hash match (collision defense). sha256 collision is
astronomically unlikely.

Tradeoff accepted: bypassing multipart drops this endpoint from Elysia's auto
OpenAPI/Swagger. We do stronger validation ourselves and document the endpoint
manually.

---

## 7. Media endpoints

Auth routes (`/api/auth/*`) are handled entirely by Better Auth via
`app.mount(auth.handler)` — not listed individually here. Every `:id`/`:mediaId`
path param is schema-validated as a uuidv7, and `:slug` as the random folder-token
charset (Elysia TypeBox) → `400` on malformed input, before any DB lookup.

Access is always evaluated **server-side**; the client never asserts what it may
read. Two families:

**Owner routes** — cookie session required, scoped to the caller's own data.
`GET /api/media` is the main view: it returns **only the caller's own uploads**,
never anyone else's, so the bare media id is never an oracle for other users.
```
POST   /api/media[?folderId=…]   raw-body streaming upload → validate → store;
                                 optional folderId also links it (owner's folder)
GET    /api/media?limit=&offset= list caller's OWN uploads, newest first, paginated
                                 (limit ∈ {10,20,50,100,200} default 10, else 400)
GET    /api/media/:id/raw        OWNER-ONLY raw bytes (your own file)
DELETE /api/media/:id            OWNER-ONLY 403 unless media.uploaderEmail ===
                                 session email; remove row + cascade links + GC (§6.6)

POST   /api/folders              create { name, visibility } → server-assigned slug
GET    /api/folders              list caller's own folders (+ visibility, slug)
PATCH  /api/folders/:id          OWNER-ONLY rename / change visibility
DELETE /api/folders/:id          OWNER-ONLY delete folder (unlinks media, keeps them)
POST   /api/folders/:id/media    OWNER-ONLY link a media (must be caller's own)
DELETE /api/folders/:id/media/:mediaId  OWNER-ONLY unlink (dereference)
```

**Folder-scoped read routes** — the only cross-user read path; the folder gate
(below) decides, session **optional**. Addressed by `slug` (the capability), not
the internal id.
```
GET  /api/f/:slug                     folder meta (gate applies)
GET  /api/f/:slug/media?limit=&offset= media referenced in the folder, paginated
GET  /api/f/:slug/media/:mediaId/raw   stream bytes (gate applies; sandboxed below)
```
**Folder gate** (per request, on the folder's `visibility`):
- `public` → allow **anyone**, incl. anonymous (no session). Read-only.
- `protected` → allow any **authenticated whitelisted member** — the unguessable
  `slug` is how they reached it; the folder is unlisted. Read-only.
- `private` → allow **owner only** (else 404, not 403 — do not confirm existence).

A cross-user reader can only ever reach a media **through a folder they may read**;
there is no route that streams another user's media by bare id. Protected content
therefore stays behind its slug (a member enumerating media ids hits owner-only
`/api/media/:id/raw` and gets nothing that is not theirs).

Serving `/raw` (both `GET /api/media/:id/raw` and `GET /api/f/:slug/media/:mediaId/raw`):
media → blob.storagePath → Elysia `file()` (streaming + range requests). Every
`/raw` response is **sandboxed** to neutralise stored-XSS from user bytes served
on the app origin (see §11 C1):

- `X-Content-Type-Options: nosniff` — browser must honour our declared type.
- `Content-Security-Policy: sandbox; default-src 'none'` — any HTML/SVG opened
  top-level or framed runs in an opaque origin with no script/network.
- `Content-Type` = the **server-sniffed** subtype (never the client's claim).
- `Content-Disposition`: `inline` only when `previewable` (raster allowlist) and
  no `?download`; otherwise `attachment`. The filename is **sanitised** — strip
  CR/LF/control chars and emit RFC 5987 `filename*=UTF-8''<pct-encoded>` (no raw
  interpolation → no header injection or download-name spoofing).

---

## 8. Frontend (Angular + Material M3)

- Google Identity Services sign-in button → Better Auth client `signIn.social({ provider: 'google', idToken })`.
- Upload form: drag-drop zone + file picker (`<input type="file" multiple>`, optional `webkitdirectory` for folder pick). Client-side MIME pre-check. Reads image dimensions / media duration client-side for metadata.
- **Main page** (post-login landing, guarded route): the caller's **own uploads**,
  a Material table newest-first, `mat-paginator` with `pageSize = 10` and
  `pageSizeOptions = [10, 20, 50, 100, 200]` bound to the `GET /api/media?limit=&offset=`
  params. All stored fields (filename, etc.) render via Angular's default
  interpolation — **never** `[innerHTML]` or `bypassSecurityTrust*` (would
  reintroduce XSS from stored metadata).
  - Preview only for `previewable` rows (raster allowlist from §6): hover → lazy `<img loading="lazy" src="/api/media/:id/raw">`. SVG and everything else get a type icon, no inline render.
  - Every row: "open" (`<a target="_blank" rel="noopener" href=".../raw">`) and "download" (`<a href=".../raw?download" download>`). Cookie auth means the anchors just work; the `/raw` sandbox headers (§7) contain anything opened in a new tab.
- **Folders page** (guarded): manage the caller's folders — create, rename, set
  visibility (private / protected / public), and **reference / dereference** own
  media (add/remove links, playlist-style; the file is never copied). For
  protected/public folders, surface a "copy share link" using the folder `slug`
  (`/f/:slug`). A folder's media list reuses the same paginated table + preview.
- **Public folder view** (`/f/:slug`, **unguarded** Angular route): renders a
  read-only folder for anonymous or member visitors via the folder-scoped read
  API (§7). Protected slugs additionally require a signed-in member (the API gate
  enforces it; the UI prompts sign-in on `401`).
- Build: `ng build` → static `apps/web/dist/browser/`, served in prod by the API via `@elysiajs/static` (single origin → no CORS). The API consumes only this **built artifact**, never the Angular source (see §9).

Note on "local disk search": a browser cannot scan the filesystem. "Search local
disk" means the OS file-open dialog / drag-drop of user-selected files.

Deferred: thumbnails / previews for video/audio/text/document (type icon for now).

---

## 9. Repo layout

```
cterest/
├── apps/
│   ├── api/          ElysiaJS + Drizzle + auth + upload (also serves web's build) — not yet built
│   │   └── uploads/  blob storage (gitignored; created on first upload)
│   ├── mock-api/     Elysia in-memory mock of /api/* — lets the web client be
│   │                 developed/tested with no DB, Google auth, or file storage
│   └── web/          Angular + Material M3 → static build
│       └── dist/browser/   ng build output (gitignored); API's static root in prod
├── PLAN.md
└── package.json      Bun workspaces root
```

**Local development (web client vs. mock API).** The web client is built and
tested independently of the real `api` against `mock-api`, an Elysia server that
holds the whole dataset in memory and reproduces the §7 contract (auth session,
own-uploads pagination, folder CRUD + link/unlink, slug-scoped public reads with
the visibility gate). Two processes: `bun run mock` (Elysia on `:3001`, seeded)
and `bun run web` (`ng serve` on `:4200`), or `bun run dev` for both. Angular's
`proxy.conf.json` forwards `/api` → `:3001` so the browser sees one origin and the
session cookie flows. Mock deviations from the real API are flagged with
`ponytail:`/comment: sign-in is a whitelist pick (not the Better Auth Google
flow), uploads fabricate a media row (bytes discarded), and `/raw` returns an SVG
placeholder served inline so previews render. The real `api` implements the same
routes, so the client's services/components move over unchanged.

**`api` and `web` stay separate sibling workspaces — not nested, not renamed:**
- The API serving Angular in prod is **artifact consumption, not source nesting**.
  It points `@elysiajs/static` at `apps/web/dist/browser/` (the *build output*),
  never at `apps/web/` source. Coupling is one-directional and runtime-only:
  `ng build` produces the folder, the API reads it.
- Kept apart so each app owns its dep tree (Angular's CLI/compiler devDeps never
  reach the API), its build/test/lint, and its own tsconfig — `api` needs
  `types: ["bun"]`, `web` needs the DOM lib, and a shared tsconfig can't be both.
- `api` is **not** renamed: its job is API + auth + upload + DB; hosting static
  files is incidental and does not change what the workspace is.

Prod packaging: copy `apps/web/dist/browser/` alongside the API (e.g. into the
container image) so the single Elysia process serves both JSON endpoints and the
SPA from one origin.

---

## 10. Environment / config

| Var | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client id (ID-token audience check) |
| `GOOGLE_CLIENT_SECRET` | Google social provider config (Better Auth) |
| `WHITELIST_EMAILS` | comma-separated allowed emails |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (cookie cache HMAC) |
| `BETTER_AUTH_URL` | Better Auth base URL (cookie/redirect origin) |
| `UPLOAD_DIR` | blob storage path (default `apps/api/uploads`; created on first upload) |
| `MAX_UPLOAD_BYTES` | per-file cap (1 GB) |
| `STORAGE_QUOTA_PER_USER` | max total bytes one uploader may hold |
| `STORAGE_QUOTA_TOTAL` | max total bytes across all users (disk guard) |
| `MAX_CONCURRENT_UPLOADS` | in-flight uploads per user |
| `UPLOAD_BUCKET_CAPACITY` | token-bucket size = max upload burst per user (default 25) |
| `UPLOAD_BUCKET_REFILL_WINDOW` | time to refill the bucket to full (default 5h) |
| `PUBLIC_READ_RATE_LIMIT` | per-IP request cap for unauthenticated public-folder reads (§11 H4) |
| `PORT` | API port |

Requires HTTPS in production (Secure cookie + Google auth + HSTS, see §11).

---

## 11. Security

Threat model: a small **whitelisted** group, but assume any one account can be
compromised or act maliciously — so quotas, authz, and content sandboxing still
matter. Each control below names where it is enforced.

**Content / stored-XSS (C1)** — user bytes are served from the app origin, so
every `/raw` response is sandboxed (§7): `nosniff`, `CSP: sandbox; default-src
'none'`, server-sniffed `Content-Type`, and `attachment` for anything not on the
raster preview allowlist (svg/html/text never render inline). Preview is
allowlist-only (§6, §8). Chosen over a separate media origin for POC simplicity;
upgrade path = move `/raw` to a cookieless subdomain if stronger isolation is needed.

**Auth & accounts**
- Whitelist is the sole account-creation gate; `disableSignUp` deliberately unset (§4, H1).
- Account creation additionally requires `emailVerified` — a federated/unverified Google account cannot assert a whitelisted address it does not own (§4).
- Blocked emails get a generic failure; reason logged server-side only (no oracle).
- Google ID token verified fully (signature, `aud`=`GOOGLE_CLIENT_ID`, `iss`, `exp`) by Better Auth (§4).
- Sessions DB-backed + revocable; cookie `httpOnly; Secure; SameSite=Lax`.

**Authorization (H2)** — **folder-scoped**, evaluated server-side every request
(§7); the client never asserts what it may read.
- Main view + bare `/api/media/:id/raw` are **owner-only** — a user sees and
  streams only their own uploads by id; no bare-id oracle for other users' media.
- All **writes** (upload, delete, folder create/rename/visibility, link/unlink)
  are **owner-only**; a folder may reference only its owner's media.
- **Cross-user reads go only through a folder** (`/api/f/:slug/…`) and pass the
  gate: public → anyone incl. anonymous; protected → any whitelisted member with
  the slug; private → owner only. Private/unknown → `404` (no existence oracle).
- **IDOR defence**: because protected content is reachable *only* via its slug and
  never via bare media id, a member cannot enumerate media ids to reach another
  user's protected/private content.

**Anonymous read surface (new, H4)** — public folders + their media/`raw` are
served **without a session**, a deliberate new attack surface:
- Enforced entirely server-side: only media reachable via a `public` folder is
  exposed to anonymous callers; the gate is never client-trusted.
- **IP rate-limit** the unauthenticated read routes (`/api/f/:slug/*`) — the
  per-user upload token bucket (§5) does not apply to anonymous readers.
- `/raw` sandbox headers (`nosniff`, `CSP: sandbox`, server-sniffed type,
  attachment for non-raster) apply here too — *more* important with no auth.
- **Capability entropy**: the folder `slug` is a 128-bit random token, **not** the
  uuidv7 id (uuidv7 is time-sortable → enumerable). Public and protected are both
  reached by direct `slug` link and are **unlisted** (not enumerable); the only
  difference is the auth gate — anonymous allowed (public) vs member-required
  (protected).
- No user context on these routes → no per-user data leaks; responses expose only
  the public folder's media metadata + bytes.

**Abuse / DoS (H3)** — layered, all env-configured (§10) and checked before the
body is read (§6 step 0):
- **Bytes (disk guard)**: per-file cap + per-user + global storage quota.
- **Count (spam guard)**: per-user upload **token bucket** — capacity
  `UPLOAD_BUCKET_CAPACITY` (default 25), refills to full over
  `UPLOAD_BUCKET_REFILL_WINDOW` (default 5h). Each upload spends 1 token; empty →
  `429`. No fixed-window boundary burst; idle ≥ the window auto-refills to full.
  State lives in the app-owned `uploadBucket` table (§5): 2 fields (`tokens`,
  `lastRefillAt`), lazily refilled and atomically spent in a transaction —
  survives restart, single-node for POC (move to Redis if scaled out, §12).
  Byte quota and token count are independent — a big file is cheap in tokens but
  dear in bytes, a tiny file the reverse.
- **Concurrency**: in-flight uploads per user capped at `MAX_CONCURRENT_UPLOADS`
  via an in-memory per-process counter (`Map<email, count>`), incremented at
  request start and **`finally`-decremented** so aborts/errors free the slot. Not
  persisted — a crash resets it (acceptable; in-flight requests die with the
  process). Multi-process would need the shared store (§12).
- **Pagination is mandatory** on every list route (`/api/media`, `/api/f/:slug/media`):
  server-enforced `limit ∈ {10,20,50,100,200}` (default 10) + offset/cursor, so no
  response can return an unbounded row set (§7, §8).

**Integrity** — refcount dedup + GC run in DB transactions; blob files unlinked
only post-commit with a re-checked `refCount = 0` (§6, M2). Temp files randomly
named, `finally`-deleted, swept on startup (§6, M3). An **orphan-blob sweep**
(startup + periodic) reclaims files with no referencing row and rows stuck at
`refCount = 0` after a crash between commit and unlink (§6.7).

**Headers (app + API responses, global Elysia hook)** — in production:
`Strict-Transport-Security` (HSTS), a baseline `Content-Security-Policy` for the
SPA, `X-Frame-Options: DENY` (`frame-ancestors 'none'`), `X-Content-Type-Options:
nosniff`. HTTPS required (§10).

**CSRF** — `SameSite=Lax` blocks cross-site POST/DELETE while allowing top-level
GET links to `/raw`; Better Auth CSRF check enabled for state-changing routes (§4).

**Injection / validation** — Drizzle parameterises all SQL. All boundary input is
schema-validated with Elysia TypeBox: upload query (`filename` length/charset,
`type` enum) and every `:id` as a uuidv7 → `400` on failure, before DB access (§6,
§7). `filename` sanitised before use in `Content-Disposition` (§7, M1); client
`width`/`height`/`durationMs` clamped (§6). Server magic-number check overrides the
client MIME claim (§6). Angular auto-escapes rendered metadata; no `innerHTML` (§8, L1).

**Errors** — a global Elysia error handler returns a **generic** message + status
to the client and logs the detail server-side; stack traces / internal messages
are never sent in responses (extends the no-oracle rule to all errors).

**Secrets & supply chain** — all secrets (`BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_SECRET`, …) come from env, never source (§10); presence validated at
startup. Dependency audit (`bun audit` / `npm audit`) runs in CI. **Accepted risk
(decision):** lockfiles (`package-lock.json`, `bun.lock`) are currently
`.gitignore`d → installs float within `~` ranges and are not reproducible/auditable.
Hardening recommends committing the lockfile; left as-is by choice for the POC.

**Out of scope / accepted risk** — a whitelisted user is trusted for *content*:
they may upload lawful-but-useless files within their quota, and may expose their
own media to other members or the open internet by putting it in a protected/public
folder (their choice). Access itself is folder-scoped (H2), not a free-for-all.
Malicious *content* moderation and virus scanning are not in the POC.

---

## 12. Deferred (with upgrade paths)

- **Postgres**: swap Drizzle driver; schema portable; only paths in DB.
- **Distributed rate limiting**: `uploadBucket` lives in SQLite — fine for the POC and even multi-process on one host (WAL + `busy_timeout`). Only a **multi-host** deployment needs a shared store (Redis atomic `INCR`/Lua, or the Postgres row once migrated).
- **Pagination**: core now (`LIMIT/OFFSET` for `mat-paginator`, §7/§8). Deferred =
  **keyset on uuidv7** if deep offsets get slow, and a total-count strategy.
- **Nested / hierarchical folders**, folder-level storage quotas, and sharing a
  folder to a *specific* member list (current model is anonymous / any-member /
  owner). Per-media ACL is now subsumed by folder visibility.
- **Thumbnails**: generate on upload or on demand if full-res previews lag.
- **Dedup collision defense**: byte-compare on sha256 match.
- **Multi-file streaming multipart**: current design uploads one file per request.
- **SVG preview** (currently attachment-only, §7): SVG is executable XML, so a
  preview is not a header tweak. Challenges before enabling it:
  - **Script surface**: SVG can carry `<script>`, inline event handlers
    (`onload=`), `javascript:` in `xlink:href`, `<foreignObject>` (arbitrary
    HTML), and CSS `@import` — all live if the file is opened top-level or
    embedded as inline `<svg>`/`<object>`/`<iframe>`.
  - **`<img>` is the safe-ish path**: browsers disable scripting and block most
    external subresource loads for SVG loaded via `<img src>`. A preview *could*
    ride on the existing `<img>` tag — but the "open in new tab" button navigates
    top-level, where script runs, so the `/raw` sandbox CSP (§11 C1) stays
    mandatory regardless.
  - **Sanitize approach**: strip script/handlers/`foreignObject`/external refs
    with DOMPurify (SVG profile) before inline embedding. Caveat: SVG/mXSS
    sanitizer bypasses recur historically — pin + update, don't trust blindly.
  - **Server-rasterize approach** (SVG → PNG thumbnail, e.g. resvg/sharp)
    sidesteps browser execution but moves risk server-side: XML entity expansion
    (billion-laughs) DoS, SSRF/local-file reads via external `<image href>`/`<use>`,
    and CPU/memory blowup from huge canvas or `filter` chains. Needs a hardened
    renderer with entity expansion off, network/file access denied, and size caps.
  - Decision when picked: `<img>`-only preview (cheapest, no script) vs sanitize
    vs rasterize — pick per how SVG will be embedded, not just displayed.
