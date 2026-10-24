# Browser MOBA

A browser MOBA you can finish in 5 to 10 minutes: every player is a dot, a match is the laning phase of a normal MOBA, first to 5 kills wins. We are building v0, a private prototype.

## Read first

- `docs/design-notes.md`: what the game is and everything decided so far. The source of truth for design.
- `docs/v0-build-plan.md`: scope, architecture, milestones M0 to M6 with done-criteria, data model, open decisions.

Work one milestone at a time, in the plan's order. A milestone is done only when every checkbox under it passes. Tick the boxes in `docs/v0-build-plan.md` as they pass.

## Ground rules

- **Rules live in one place.** All game rules live in `packages/sim`, shared by server and client. Never duplicate a rule in the client or the server.
- **The server is authoritative.** The client sends commands and renders snapshots. It predicts only its own movement. Nothing about a match is decided in the browser.
- **Fixed tick.** The sim steps at 30 ticks per second. Never count frames. Durations are stored in seconds and timers count down by the fixed step, never rounded to whole ticks. Game speed must not depend on monitor refresh rate.
- **Balance is data, never code.** Every number for stats, abilities, summoners, items, minions, towers, gold, levels and the map comes from the active balance version in Postgres. If you need a number that isn't decided, add it to the balance data with a placeholder value and list it under "Decisions needed" in the plan.
- **Abilities are built from blocks.** Every ability and summoner is data built from coded blocks (projectile, area, dash, pull, root, shield and so on). A new interaction means a new block, never a special case inside one ability. No pair of abilities gets a special rule.
- **Test the interaction rules.** Every rule in "Interaction rules" in the design notes gets a scenario test in `packages/sim`, written before the abilities that rely on it.
- **React stays outside the game loop.** The game loop, state and canvas drawing are plain TS modules. React only wraps the HUD, shop, menus and settings, and reads snapshots through a small store.
- **Matches pin a balance version.** A running match never changes balance. The server writes one match record at match end, stamped with the version.
- **Config, not constants.** The server address and ports come from config.

## Working style

- Before building something the docs don't cover, check the plan's "Decisions needed" table. If the question isn't there, use a sensible placeholder, add a row, and mention it in your summary.
- Don't change `docs/design-notes.md` without asking. Propose changes instead.
- Keep `pnpm typecheck` and `pnpm test` passing on every commit.
- After each milestone, summarize what was built, what was assumed, and how to try it.

## Commands

Needs Node 22+ and pnpm 10. Copy `.env.example` to `.env` first; it holds the server address, ports and database URL.

- `pnpm install`: install everything.
- `pnpm db:up`: start Postgres in Docker (or point `DATABASE_URL` at any Postgres 16).
- `pnpm db:migrate`: apply `db/migrations`.
- `pnpm db:seed`: insert the v0 numbers as balance version 1, if no version exists yet. `pnpm db:seed --force` replaces all versions (dev only, refused once matches exist); use it when the balance schema changes.
- `pnpm dashboard`: the owner dashboard on http://localhost:5180 (API on :8081). Edit balance values, apply as a new version with a note, roll back. Running game servers switch to a new version at their next match.
- `pnpm db:publish-seed "<note>"`: publish the seed's current numbers (`packages/balance/src/seed-v1.ts`) as a new active balance version, for numbers changed in code rather than in the dashboard.
- `pnpm dev`: server on :8080 and client on http://localhost:5173 (`dev:server` / `dev:client` run one). Add `?ping=80` to the URL, or use the HUD buttons, for the lag switch.
- `pnpm typecheck`: strict TypeScript across every package.
- `pnpm test`: all tests. The Postgres tests run only when `DATABASE_URL` is set; each makes and drops its own database.
