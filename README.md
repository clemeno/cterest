# cterest

Collect and organise private/shared/public media.

See [PLAN.md](PLAN.md) for the full design.

## Layout

- `apps/web` — Angular 20 + Angular Material (M3) client.
- `apps/mock-api` — Elysia in-memory mock of the `/api/*` contract, for developing
  and testing the web client with no DB, Google auth, or file storage.
- `apps/api` — the real ElysiaJS backend (not yet built).

## Prerequisites

[Bun](https://bun.sh) ≥ 1.3 (also used as the package manager and the Angular
runtime — no separate Node install required).

## Install

```sh
bun install
```

## Run (web client + mock API)

```sh
bun run dev          # both: mock API on :3001 and ng serve on :4200
# or, in two terminals:
bun run mock         # Elysia mock API  → http://localhost:3001
bun run web          # Angular dev server → http://localhost:4200
```

Open http://localhost:4200. `ng serve` proxies `/api` to the mock (`proxy.conf.json`),
so it is one origin and the session cookie works. Sign in with a seeded demo
account (e.g. `demo@cterest.dev`) offered on the sign-in page.

## Build + test

```sh
cd apps/web && bunx ng build     # production build → apps/web/dist/browser
cd apps/mock-api && bun test     # mock helper unit tests
```
