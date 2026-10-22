# Browser MOBA

A browser MOBA you can finish in 5 to 10 minutes: every player is a dot, a match is the laning phase of a normal MOBA, first to 5 kills wins. We are building v0, a private prototype.

## Read first

- `docs/design-notes.md`: what the game is and everything decided so far. The source of truth for design.
- `docs/v0-build-plan.md`: scope, architecture, milestones M0 to M6 with done-criteria, data model, open decisions.

Work one milestone at a time, in the plan's order. A milestone is done only when every checkbox under it passes. Tick the boxes in `docs/v0-build-plan.md` as they pass.

## Ground rules

- **Rules live in one place.** All game rules live in `packages/sim`, shared by server and client. Never duplicate a rule in the client or the server.
- **The server is authoritative.** The client sends commands and renders snapshots. It predicts only its own movement. Nothing about a match is decided in the browser.
- **Fixed tick.** The sim steps at 30 ticks per second. Never count frames. Durations are stored in seconds and converted when a balance version loads. Game speed must not depend on monitor refresh rate.
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

To be filled in during M0 (install, start Postgres, dev, test, typecheck).
