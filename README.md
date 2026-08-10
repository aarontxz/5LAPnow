# 5LAPnow

A multiplayer poker platform. `apps/web` (Next.js) talks to `apps/server` (NestJS) over REST and Socket.IO for live table state. Poker rules live in a standalone engine package (`packages/game-engine`), with separate engines for the Clang (`packages/clang-engine`) and Card Flip (`packages/card-flip-engine`) game modes.

## Prerequisites

- Node.js >= 20
- pnpm 10.14.0 (`corepack enable` will pick up the version pinned in `package.json`)
- A running Postgres instance

## 1. Install dependencies

```bash
pnpm install
```

This is a pnpm workspace (`apps/*`, `packages/*`) orchestrated by Turborepo.

## 2. Configure environment variables

`apps/server` reads from `apps/server/.env`. Copy the example and adjust as needed:

```bash
cp apps/server/.env.example apps/server/.env
```

```
DATABASE_URL="postgresql://localhost:5432/5lapnow?schema=public"
WEB_ORIGIN="http://localhost:3000"
PORT=4001
```

Point `DATABASE_URL` at a real Postgres database (create one first, e.g. `createdb 5lapnow`).

`apps/web` doesn't need a `.env` for local dev — it defaults to `http://localhost:4001` for the API/socket connection. To point it elsewhere, set:

```
NEXT_PUBLIC_API_URL="http://localhost:4001"
```

## 3. Build the shared packages

The apps resolve workspace packages (`@5lapnow/game-engine`, `@5lapnow/clang-engine`, `@5lapnow/card-flip-engine`, `@5lapnow/cards`, `@5lapnow/shared-types`) via their built `dist/` output, not live TS source. Build them once before running the apps:

```bash
pnpm build
```

(`pnpm dev`, below, also starts a watch-build for every package in parallel, so this is mainly relevant for one-off `pnpm --filter` typecheck/test runs.)

## 4. Set up the database

Run from the repo root or scope with `--filter @5lapnow/server`:

```bash
pnpm --filter @5lapnow/server prisma:generate   # generate the Prisma client
pnpm --filter @5lapnow/server prisma:migrate     # apply migrations (prisma migrate dev)
pnpm --filter @5lapnow/server seed               # seed the builtin GameDefinitions (NLH, bomb pots, Clang, Card Flip, etc.)
```

`prisma:migrate` will prompt for a migration name if you're creating a new one; against an already-migrated schema it just applies pending migrations.

## 5. Run the app

```bash
pnpm dev
```

This starts `apps/web`, `apps/server`, and the watch-builds for every package in parallel via Turborepo. By default:

- Web: http://localhost:3000
- Server: http://localhost:4001

To run just one workspace, scope it: `pnpm --filter @5lapnow/web dev` or `pnpm --filter @5lapnow/server dev`.

## Other commands

```bash
pnpm build          # turbo run build — build every workspace
pnpm test           # turbo run test — run all test suites
pnpm lint           # turbo run lint
```

**Tests** (`packages/game-engine`, `packages/clang-engine`, `packages/card-flip-engine`, `packages/cards`, `apps/server` — vitest; `apps/web` has none):

```bash
pnpm --filter @5lapnow/game-engine test                              # full suite for one package
cd packages/game-engine && npx vitest run src/shared/engine.test.ts  # single file
cd packages/game-engine && npx vitest run -t "name"                  # by test name
```

**Typecheck**: every workspace has `pnpm --filter <name> typecheck` (`tsc --noEmit`). Workspace names: `@5lapnow/web`, `@5lapnow/server`, `@5lapnow/game-engine`, `@5lapnow/clang-engine`, `@5lapnow/card-flip-engine`, `@5lapnow/cards`, `@5lapnow/shared-types`.

## Making schema changes

After editing `apps/server/prisma/schema.prisma`:

```bash
pnpm --filter @5lapnow/server prisma:migrate   # creates + applies a new migration, regenerates the client
```

If you only changed something that affects generated types (rare — usually `migrate` covers it):

```bash
pnpm --filter @5lapnow/server prisma:generate
```

## Common gotchas

- **Stale `dist/`**: if `apps/server` or `apps/web` typecheck/build against outdated behavior after editing `packages/game-engine`, `packages/clang-engine`, `packages/card-flip-engine`, `packages/cards`, or `packages/shared-types`, rebuild that package (`pnpm --filter <pkg> build`) or make sure its `dev` watcher is running.
- **Empty lobby / no game modes**: means the seed step (`pnpm --filter @5lapnow/server seed`) hasn't been run against your database.
- **Server can't connect to Postgres**: check `DATABASE_URL` in `apps/server/.env` and that the database exists (`createdb 5lapnow`) and Postgres is running.
