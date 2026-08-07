# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multiplayer poker platform. `apps/web` (Next.js) talks to `apps/server` (NestJS) over REST (lobby/table CRUD) and Socket.IO (live table state). Poker rules themselves live in a standalone, DB-agnostic engine package (`packages/game-engine`) so that adding a new poker variant is a data-only change, not new game logic.

## Commands

This is a pnpm workspace orchestrated by Turborepo (`pnpm-workspace.yaml`: `apps/*`, `packages/*`).

```bash
pnpm dev            # turbo run dev — starts web, server, and watch-builds every package in parallel
pnpm build          # turbo run build
pnpm test           # turbo run test
pnpm lint           # turbo run lint
```

Scope any command to one workspace with `pnpm --filter <name> <script>`, e.g. `pnpm --filter @5lapnow/server dev`. Workspace names: `@5lapnow/web`, `@5lapnow/server`, `@5lapnow/game-engine`, `@5lapnow/cards`, `@5lapnow/shared-types`.

**Tests** (`packages/game-engine`, `packages/cards`, `apps/server` — vitest; `apps/web` has none):
```bash
pnpm --filter @5lapnow/game-engine test              # full suite
cd packages/game-engine && npx vitest run src/shared/engine.test.ts   # single file
cd packages/game-engine && npx vitest run -t "name"                   # by test name
```

**Typecheck**: every workspace has `pnpm --filter <name> typecheck` (`tsc --noEmit`).

**Database** (`apps/server`, Postgres via Prisma):
```bash
pnpm --filter @5lapnow/server prisma:migrate   # prisma migrate dev
pnpm --filter @5lapnow/server prisma:generate  # prisma generate
pnpm --filter @5lapnow/server seed             # seeds builtin GameDefinitions (see below)
```

**Workspace packages resolve via their built `dist/`** (`main`/`types` in each `package.json`), not live TS source — after editing `packages/game-engine`, `packages/cards`, or `packages/shared-types`, rebuild that package (`pnpm --filter <pkg> build`, or run its `dev` watcher) before typechecking/running `apps/server` or `apps/web`, or you'll be checking against stale output.

## Architecture

### The engine is one interpreter, games are data

`packages/game-engine/src/shared/` holds the single `DeclarativeEngine` plus its supporting modules (`table.ts` seats/stacks, `handState.ts`, `bettingRound.ts` legal actions & chip math, `pots.ts` side-pot/showdown settlement, `gameDefinition.ts` the zod schema/contract). There is no per-variant code path — `DeclarativeEngine` walks a `GameDefinition`'s ordered `streets[]` (each: hole/community cards to deal + whether a betting round follows), driven entirely by that data.

Every poker variant is a file under `packages/game-engine/src/games/` (`NLH.ts`, `DoubleBoardBombPot.ts`, `TripleBoardBombPot.ts`) that just constructs and validates a `GameDefinition` object via `parseGameDefinition(...)`. Adding a new variant means adding a new file here — never touching the engine.

Known schema fields that exist but aren't currently enforced by the engine: `bettingStructure` (no-limit/pot-limit/fixed-limit — legal-action math doesn't branch on it, everything plays as no-limit) and `exactHoleCardsUsed` (Omaha's "must use exactly N hole cards" — hand evaluation just picks the best 5 from hole+board combined).

`packages/cards` is the deck/card-rank primitives and hand evaluator (`handEvaluator.ts`), used by both `game-engine` and directly by nothing else.

### Live table state: in-memory, Postgres as backing store

`apps/server/src/tables/tables.service.ts` (`TablesService`) keeps one `RuntimeTable` per active table in an in-memory `Map` — this holds the live `TableState` (seats/stacks), the current `HandState` (deck, hole cards, betting round), pending seat requests, and per-table transient flags (`standRequests`, `pendingStackAdjustments`, `nextGameOverride`). All gameplay mutation happens on this in-memory structure; Postgres is written to at durable checkpoints (buy-in, cash-out, hand completion via `persistHandResult`), not on every action.

On boot, `TablesService.onModuleInit` rehydrates `RuntimeTable`s from Postgres (`Table`/`Seat` rows) so a server restart doesn't orphan existing tables — but a hand that was mid-play at restart time is unrecoverable (hole cards/deck/betting round are never persisted) and is simply dropped; players keep the stacks they had going into that hand.

`apps/server/src/tables/tables.gateway.ts` (`TablesGateway`) is the Socket.IO layer: one room per table (`table:<id>`), and every state-changing `TablesService` call ends by invoking a change listener that rebuilds and broadcasts a fresh `TableSnapshot` to everyone in the room (`table-snapshot.ts` builds this per-viewer — hole cards are only revealed to their owner, or to everyone once the hand is `complete`). Client identity (`socket.data.userId`) is resolved from the guest cookie in a Socket.IO connection **middleware** (`server.use(...)` in `afterInit`), not in `handleConnection` — `handleConnection` in NestJS is fire-and-forget and doesn't block message handlers from binding, which previously let a client's first message race ahead of the cookie→user DB lookup.

### Auth: cookie-based guest identity, name collected late

There's no registration — `POST /auth/guest-session` issues an httpOnly cookie (`5lapnow_uid`) tied to a `User` row that can be created with `displayName: null`. The lobby (`apps/web/app/page.tsx`, the app's root route — there is no separate landing page or `/lobby`) silently provisions this on first visit with no name required. A display name is only ever collected in the "request a seat" modal, and is enforced unique **per table** (case-insensitive, checked against currently seated + pending-request players at that table only — `TablesService.requestSeat`/`isNameTakenAtTable`), not globally. Submitting a seat request also updates the guest's global `User.displayName`.

### Game generation: manual "Wizard-of-Oz" queue, not an LLM

`POST /games/generate` just inserts a `GameGenerationRequest` row (`status: pending`, prompt text, `gameDefinitionId: null`) — nothing auto-generates anything. A `GameDefinition` is later hand-built (following the pattern in `prisma/seed.ts`) and linked via `gameDefinitionId`, flipping the request to `ready`, at which point it shows up in the requester's game list (`GamesService.list()`'s `createdById` filter).

### Other gameplay features worth knowing about

- **Multi-board bomb pots**: `HandState.boards: Card[][]` holds N parallel boards (`GameDefinition`-specified count); `board` is kept as `boards.flat()` for single-board consumers. Dealt in lockstep across all boards each street.
- **Rabbit hunting**: `TablesService.revealRabbit` (owner-only, post-hand) deals the streets that never ran into a side-channel `hand.rabbitBoard`/`rabbitBoards` — cosmetic only, doesn't touch the real `board`.
- **Next-game override**: the table owner can queue a different `GameDefinition` for the next hand only (`table:setNextGame` → `runtime.nextGameOverride`), auto-cleared once that hand starts.
- **Stand-up while a hand is live**: never removes a seat mid-hand (would corrupt pot math). Instead the seat is flagged (`standRequests`) to auto-check/fold on its turns for the rest of that hand; eviction happens once the hand reaches `complete` (`TablesService.advanceHand`/`settleStandRequests`).

### Frontend conventions

- **Every modal/dropdown must close on an outside click** (and stay open on clicks inside it), consistently app-wide — this matters most on mobile, where there's no hover/escape affordance. The shared `apps/web/components/table/Modal.tsx` gets this for free (backdrop `onClick={onClose}`, content `onClick={(e) => e.stopPropagation()}`). Custom non-`Modal` dropdowns (e.g. `GameSelect.tsx`, `NextGamePicker.tsx`) don't have a backdrop to hook, so they instead attach a `document`-level `pointerdown` listener while open that closes on any event whose target falls outside a `ref`'d root element — see either of those two files for the pattern to copy for new dropdowns.

### Shared contract

`packages/shared-types` is the single source of truth for REST DTOs, Socket.IO event payloads (`ClientToServerEvents`/`ServerToClientEvents`), and the `TableSnapshot`/`HandView` view models — both `apps/web` and `apps/server` import from it so the wire format can't drift between them.
