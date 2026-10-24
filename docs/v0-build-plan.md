# Browser MOBA: v0 build plan

As of 22 Oct 2026. Live version with diagrams: https://claude.ai/artifact/3jh8ozRgVNBGqEQtNHesRA

## Scope

v0 is done when two people can open a shared link and play a full first-to-5 match on the lane map with the four presets, and every number in that match comes from a versioned balance record in Postgres. Before that, the same match must be playable solo against the target dummy. Everything is built on the final project structure: authoritative Node server, shared rules module, match records written by the server.

**In v0**

- The lane map: about 3000 × 600 units, base and shop at each end, one tower per side about 700 units out, two brush patches at the midpoint.
- Dot stats from the v0 numbers: base stats, 25-point budget, 10-point cap, damage taken = damage × 100 / (100 + resist).
- Arm animation with wind-up and release, cancellable before release; one animation for autos, one for spells.
- The four presets and everything they use: 16 abilities (all four of Q, W, E, R per preset) and all 5 summoners.
- Minion waves, towers, experience and levels (max 10, R at 3), gold, the 7 items, buying at base.
- Target dummy: an ordinary dot with no controller, floating damage numbers, health reset, a walk-back-and-forth switch.
- Match records saved once at match end, stamped with the game version.
- A minimal owner dashboard: edit balance values, apply as a new version, roll back.

**Not in v0**

- Accounts, guest sign-up linking, account levels, hidden rating (the tables get a place, nothing uses them).
- Matchmaking, the pick screen, the bot, other modes and maps.
- Custom dots (a dev-only point editor is fine for testing), cosmetics, ads.
- The four pool abilities no preset uses: Burst, Boomerang, Vanish, Shove. They come for free once the block system exists, but nothing in v0 waits on them.
- Mobile and touch input, regions beyond Frankfurt.

## What carries over from the old demo

The demo's feel carries over, its code mostly does not. It is one file of global state where every timer counts frames, so it runs faster on a 144 Hz monitor than on a 60 Hz one; that alone rules out reusing the loop. Port the ideas below into the new modules and rewrite the rest.

| Demo part | v0 decision | Why |
| --- | --- | --- |
| Click-to-move, straight to cursor | Keep the feel, raise speed | Notes say it is right apart from speed: 2.8 units per frame is about 170 units/s at 60 Hz; v0 is 300 units/s, capped at 450. |
| Camera lerp (8% per frame) | Keep, make it time-based | Same smoothing, expressed per second so it does not change with refresh rate. |
| worldToScreen / screenToWorld | Keep | Goes into the renderer unchanged. |
| Click marker, drawn crosshair cursor | Keep | Cheap, already reads well. |
| Flash with step-back landing | Keep the landing search | Walking back along the blink line to a clear spot is the right rule; it moves into the Flash block on the server. |
| Particles, draw order, cooldown overlay | Keep as client-only effects | Purely visual, never in the shared rules. |
| Frame-counted cooldowns, `gameTime++` | Rewrite | The demo computes `dt` and never uses it. v0 uses a fixed tick and stores durations in seconds. |
| Autos fire automatically in range | Rewrite | v0 autos happen on click, with a wind-up that can be cancelled. |
| Autos as physics projectiles that hit walls | Rewrite | Ranged autos home with no physics and always land once released; melee autos land at release. |
| Wall sliding with 8-point circle test | Replace with pathing | Notes ask for auto pathing around walls; sliding stays only as the last step of movement. |
| Tile map 28 × 18 | Replace | The lane map is new data: lane bounds, bases, tower spots, brush polygons. |
| Enemy AI (roam / chase) | Drop | v0 has a target dummy, not a bot. |
| Settings sliders writing into `cfg` | Replace with the dashboard | Values move to versioned balance data; the dashboard writes a new version instead of mutating live state. |
| HUD rewritten through `getElementById` each frame | Rewrite in React | React owns HUD, shop and menus; it reads a snapshot, never the loop. |

One demo bug not to copy: the attack-range ring is scaled by screen width over map width, but the camera draws the world at 1:1, so the ring is the wrong size.

## Architecture

The rules live once, in a shared TypeScript package that both the server and the client import. The server runs the real match; the client renders snapshots and predicts only its own movement.

How the parts connect:

- Client (browser) sends commands to the server and receives snapshots at 20 per second.
- Server (Node + ws, Frankfurt) runs one authoritative room per match link, steps the sim at 30 ticks/s, pins one balance version, reads that version from Postgres and writes the match record once at match end.
- `packages/sim` (rules, statuses, skill blocks, pathing, map data) is imported by both client and server.
- Owner dashboard edits balance values and writes new versions to Postgres.

The sim runs on the server from the first milestone, even against the dummy on localhost. That keeps one code path: "playable against the dummy" and "playable over a link" differ only in a second human joining the room and real latency. A dev switch adds artificial latency (for example 80 ms) so the feel is tested against lag long before deployment.

Key choices:

- **Fixed tick.** The sim steps at 30 ticks per second. All balance durations are stored in seconds, and timers count down in seconds by the fixed step (1/30 s), so nothing is rounded to whole ticks. Rendering runs at monitor rate and interpolates between snapshots.
- **Commands in, snapshots out.** The client sends commands (move to point, attack target, cast slot at aim point, cancel, buy item). The server sends 20 snapshots per second. Nothing about the match is decided in the browser.
- **Prediction only where it matters.** Own movement is predicted and reconciled, because snappy movement is the core feel. Wind-ups, casts and hits wait for the server.
- **One balance version per match.** The server pins the active version when the room starts and sends it to both clients, so both run the same definitions.
- **Pathing.** A navigation grid over the lane (cell size around one dot radius) with A* and path smoothing; the move command stores the path, not just the target.
- **React stays outside the loop.** The game loop, state and canvas drawing are plain TS modules. React reads the latest snapshot through a small store for HUD, shop, menus and settings.

Repo layout (one pnpm workspace):

```
packages/
  sim/        rules: entities, tick, statuses, skill blocks, pathing, map data
  protocol/   command and snapshot types, versioned
  balance/    balance schema, validation, v0 seed (version 1)
apps/
  server/     Node + ws: rooms, tick loop, match recorder, balance loader
  client/     Vite + React: renderer, input, net, prediction, HUD, shop
  dashboard/  owner dashboard: edit, apply, roll back balance versions
db/
  migrations/ Postgres schema
```

## Milestones

Seven milestones, in order: M0 → M1 → M2 → M3 → M4 → gate → M6, with M5 alongside. The gate after M4 is the one the notes set: a full match against the dummy before any work on two players over a link. M5 can run alongside M4 once balance data is stable.

### M0: Foundations

Workspace, strict TypeScript, Vite + React client, Node ws server, Postgres in docker-compose with migrations, CI running typecheck and tests. Balance schema with the v0 numbers seeded as version 1. Server address read from config.

- [x] A dot moves at 300 units/s and covers the same distance in 10 s on a 60 Hz and a 144 Hz monitor.
- [x] The server loads version 1 from Postgres and refuses to start on an invalid record.

### M1: Movement and map

Lane map data, nav grid, A* with smoothing, click-to-move, camera, click marker, cursor. Brush as a vision rule in the sim: a dot inside brush is left out of the other side's snapshot. Latency switch. Own-movement prediction and reconciliation, so snappy movement is tested against lag from the start.

- [x] A dot walks base to base around every obstacle with one click.
- [ ] Movement still feels snappy with 80 ms of added latency. (Measured in Chromium at +80 ms: the dot moves on the first frame after the click, as with no lag, and prediction needed no corrections even at +250 ms. Waiting on the owner's playtest.)

### M2: Autos and the dummy

Stats from base + points, the damage formula, death and 6 s respawn, first to 5. Arm animation: wind-up length scales with attack speed, cancel before release, ranged autos home, melee autos land at release. Target dummy with damage numbers, health reset and patrol.

- [x] Two vanilla dots trade autos for about 10 s to a kill (1000 health, 100 attack, 1 attack/s).
- [x] A cancelled wind-up fires nothing; a released auto lands even if the attacker dies or moves.

### M3: Spells and summoners

Statuses and forced movement first, then the skill blocks, then the 16 abilities and 5 summoners as data. Scenario tests for every interaction rule in the notes, written before the abilities that need them.

- [x] Every preset can cast its full kit against the dummy.
- [x] Scenario tests pass: double hook drags both, Flash while anchored drags the victim, root blocks Dash/Leap/Flash only, newest forced movement wins, Dome blocks spells cast from outside and keeps those cast inside.
- [x] A full round of spells from Poke or Diver takes more than half of a vanilla dot's health. Tank and Marksman are tuned in M5.

### M4: Lane and match

Minion waves (2 melee, 2 ranged every 20 s) with standard targeting and the aggro switch. Towers with the same switch, homing shots and the 25% ramp. Experience, levels, 4% cooldown cut per level, R at level 3. Gold from last hits, the 1/s trickle, kills with the comeback multiplier, towers. Shop at base with the 7 items. Match record written by the server at match end.

- [ ] A full match against the dummy runs to 5 kills.
- [ ] The first item lands around level 2 or 3 in a normal farming game.
- [ ] Each match leaves one record in Postgres with the game version.

**Gate: a full match against the dummy.**

### M5: Tuning loop

The owner dashboard: edit any balance value, apply as a new version with a note, roll back. Applies to new matches only.

- [ ] Changing Bolt's damage and pressing apply changes the next match, not the current one, and the record shows the new version.

### M6: Two players over a link

Room ids in the URL, second human joins, snapshot interpolation for everything else, disconnect handling. Deploy one server in Frankfurt.

- [ ] Two people on different home networks finish a match from a shared link.
- [ ] Both clients agree on every hit and kill; the record lists both players with their preset and stats.

## Data model

Every ability, summoner, item, preset and number lives in one balance record per version; code only knows the blocks they are built from. A match pins one version, and its record carries that version.

### Skill blocks

The block set is closed to what the 16 preset abilities and 5 summoners need. A new interaction means a new block in code; everything else is data.

| Block | Used by |
| --- | --- |
| Skillshot projectile (first hit or piercing, falloff after first) | Bolt, Piercer, Snare Shot, Reel |
| Ground area (instant, lasting, or delayed) | Chill Field, Artillery shots |
| Empowered next auto (bonus, timer reset, apply mark) | Heavy Strike, Mark |
| Mark stacks with detonation | Mark |
| Dash / leap / blink (hittable or instant, wall rule) | Dash, Leap, Flash |
| Pull with anchor; knockback | Reel; Dome |
| Root, slow, stun | Snare Shot, Trap, Chill Field |
| Shield (damage or next spell) | Barrier, Spell Shield |
| Heal; cleanse | Heal; Cleanse |
| Timed stat buff | Frenzy, Overdrive, Sprint (fading) |
| Placed entity (trigger on enter) | Trap |
| Self-root channel | Artillery |
| Missing-health damage scaling | Finisher |
| Zone that blocks spells from outside | Dome |

Shape of one ability, as it would sit in the balance record. Damage and cooldown follow the v0 notes; the other values are illustrative until the first tuning pass.

```ts
{
  id: "bolt", slot: "Q", type: "magic", cost: 0,
  cooldown: 5, windUp: 0.25,
  blocks: [{
    kind: "projectile", hits: "first", speed: 1400, range: 900, width: 30,
    onHit: [{ kind: "damage", base: 120, ratio: 0.6 }]   // ratio x magic attack
  }]
}
```

### Postgres tables

| Table | Holds |
| --- | --- |
| `balance_versions` | id, created_at, note, parent_id, `data` jsonb (the whole balance record), is_active |
| `matches` | id, balance_version_id, mode, map, started_at, length_s, winner_side |
| `match_players` | match_id, side, player_ref (guest session or account), preset, stat_build jsonb, spells jsonb, summoners jsonb, result, kills, deaths, assists, damage_dealt, damage_taken, gold, items jsonb (item + time), kill_times jsonb |
| `players` | id, created_at, hidden_rating (unused in v0, there so v0.1 needs no migration of history) |

Builds, spells and items are jsonb so new stats or spells appear in new records without migrations. Every spell carries `cost: 0` from the start, as the notes ask.

## Decisions needed

Each open question has a proposed default, so no milestone waits on an answer; the default is a placeholder in balance data, not a design decision.

| Question | Needed by | Proposed default |
| --- | --- | --- |
| Wind-up length at 1.0 attacks/s, and for spells | M2 | Auto wind-up 30% of the attack interval; spells a flat 0.25 s |
| Dot radius, and whether dots and minions block each other | M1 | Radius 30; no body blocking in v0 |
| Health regeneration and base healing | M2 | No passive regen; standing in your own base heals 20% of max health per second. Decides how strong poke is, so test both |
| Brush: does attacking from brush reveal you? | M2 | Yes, for 1 s after any auto or cast |
| Share of attack / magic attack added to spells | M3 | One ratio per spell in data, start at 0.6 |
| Ranges, projectile speeds, CC durations, slow %, shield sizes | M3 | First pass derived from the balance targets, tuned in M5 |
| Summoner numbers (Flash distance, cooldowns, heal and barrier sizes) | M3 | First pass in data, tuned in M5 |
| Do Dash and Leap cross walls? | M3 | No (notes lean this way); Flash stays the only way through |
| Does levelling scale damage? | M4 | No in v0; cooldown cut only |
| Comeback multiplier on experience, and less gold for the leader | M4 | No; kill gold multiplier only, as in the notes |
| Last-hit gold when a tower or minion gets the kill | M4 | Nobody gets it |
| How experience is earned from minions | M4 | Last hit only, like gold: missed minions give nothing, so the level 2 to 3 first item needs near-perfect farming |
| Starting gold | M4 | 0 |
| Attack range: measured how? | M2 | From the attacker's centre to the target's edge |
| Dome edge cases (continuous push against a hook across its edge) | M3 | No special handling; let the blocks interact, jank accepted |
| Rolling back a balance version | M5 | Creates a new version copied from the old one, so every match points at the exact data it ran |
| Disconnect: grace period, then forfeit? | M6 | Hold the dot in place for 30 s, then forfeit |
| Which mouse button moves and attacks | M2 | Right click on the ground moves, right click on an enemy attacks (League style); S stops. Left click does the same: spells don't need it, see quick cast |
| Attack move (A) | M3 | A attacks the enemy under the cursor; over empty ground, the visible enemy closest to the cursor (not to your dot). Nothing happens if no enemy is in sight |
| How spells are aimed and cast | M3 | Quick cast: Q W E R for abilities, D F for summoners, going off toward the cursor when the key is pressed. A wind-up first (cancelled by a move, stop or stun: nothing fires, no cooldown). Casting cancels an auto wind-up (refunded) but keeps the attack order |
| R before levels exist | M3 | Castable from the start; M4 adds the level 3 unlock |
| Do skillshots stop at walls? | M3 | No: like autos, they fly over walls. Dashes, leaps and knockbacks stop at walls; Flash and pulls go through |
| Root or stun during a dash or leap | M3 | Stops it where the dot is; a stopped leap does no landing damage |
| Dome: when does it push, and what is "inside"? | M3 | It pushes enemies to its edge for its whole 4 s, not just while expanding. A dot is inside when its body overlaps the dome. The push is a forced movement, so it ends a pull in progress (jank accepted) |
| Artillery controls | M3 | R starts a 4 s self-rooted channel and fires the first shot at the cursor; each R press fires the next, at least 0.5 s apart, up to 5. S ends it early |
| Spell Shield against areas and hooks | M3 | It blocks the whole cast on that dot: a lasting area never gets through later, a blocked hook comes back empty |
| Flash details | M3 | Goes to the cursor if it is closer than 400. Ends your own dash or leap, but not a pull or a push. Can't be cast while rooted or stunned; can while anchored |
| Vanish and Trap visibility | M3 | Vanish ends when you attack or cast. Traps are hidden from the other side and go off once |
| Mark details | M3 | Lasts 5 s; the three autos after the marking one detonate it for 120 + 0.6 attack |
| Clicking an enemy: one auto, or keep attacking? | M2 | Keep attacking until another command, League style; a dot never picks a target by itself. The order lapses if the target dies or goes out of sight |
| Does cancelling a wind-up cost the attack? | M2 | No: the attack timer is refunded, so you can attack again at once |
| Where the target dummy stands, and what it is | M2 | A vanilla ranged dot at x 1650, y 300 (past the middle, clear of brush), patrolling 200 either side across the lane; respawns on its spot. Present while only one person is in the room |
| Choosing a preset in v0 | M2 | `?preset=` in the URL or the HUD buttons, until v0.1's pick screen; `vanilla` and `vanilla-melee` for testing |
| After a win | M2 | The next match starts in the same room 5 s later, and a room that empties starts fresh; M4 adds the match record |
| Ranged auto speed and tower shot speed | M2 | 1200 units/s for both |
| Minion attack speed, ranges, movement speed and size; when the first wave spawns | M4 | 1 attack/s; melee range 100, ranged 400; 240 units/s; radius 20; first wave at 5 s |
| Where towers stand | M1 | 700 units from each end of the lane, so with range 500 a 600-unit stretch in the middle is out of both towers' reach |
| Walls in the lane | M1 | A gate at each base mouth and one outcrop each side of the middle, point-symmetric; placeholders to test pathing |
| Changing the balance schema once matches exist | M5 | A data migration adds a new version converted from the active one; `db:seed --force` only works before the first match |
| Base depth, brush shapes, tower size | M1 | Bases 300 deep; two 200 × 160 brush patches at the midpoint, one against each edge; tower radius 50 |
| Sim tick and snapshot rate | M0 | 30 ticks/s, 20 snapshots/s; revisit after M6 playtests |

## Risks

The biggest risk is M3: the interaction rules are where a prototype quietly turns into special cases.

- **Interaction rules turn into special cases.** Build statuses and forced movement as one system before any ability, and write the scenario tests from the notes first. A failing scenario is fixed in a block, never in an ability.
- **Snappy movement dies under latency.** Predict own movement and test with the latency switch from M1, and run one test from Munich to a Frankfurt server before M6 starts.
- **Scope.** 16 abilities, 5 summoners, minions, towers and a shop is a lot for a prototype. If M3 runs long, finish Poke and Diver first: between them they cover projectile, area, dash, leap, empowered auto, buff, self-root channel and execute, which is most of the block set.
- **Over-building the data layer.** Keep the block set to what the presets need and the dashboard to a validated JSON editor; a nicer editor waits for v0.1.
- **Readability.** Arms, homing autos and spell effects all compete on a small dot. Review a recorded match at normal speed after M3, before effects multiply.
