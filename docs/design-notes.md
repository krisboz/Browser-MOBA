# Browser MOBA: design notes

Snapshot of the live design doc as of 22 Oct 2026 (live version: https://claude.ai/artifact/8DDCztdhgXTZFyksNHJCRN). Use this as the source of truth when planning and building v0.

## The pitch

A browser MOBA you can finish in 5 to 10 minutes, with no download and no account needed. Every player is a dot, not a champion.

It is aimed at older League players who miss the genre but not the 40-minute games. The model is Krunker: click a link and you are playing.

Success means a small game that earns some money from ads and cosmetics, kick-started by one or two streamers. It does not need to be a generational hit.

Guiding rule: never overload the player with information. The depth is there for those who go looking for it.

## Decided so far

### Look

- Everyone is a dot. No champion models, no walk cycles.
- Maybe fake champion portraits later, but in the game they stay dots.
- Each dot has two small bean-shaped arms. They rise on the wind-up and snap forward on release, which shows when an attack is coming and which way the dot faces.
- Two animations only: one for autos, one for spells. Spells are told apart by their effects and colour.
- The wind-up can be cancelled before release, so players can learn to animation cancel. Its length scales with attack speed.

### Movement and combat

- Movement is snappy: the dot goes straight to the cursor, with none of the slowness of Dota. The old demo's movement is right apart from its speed.
- Auto pathing around walls.
- Auto attacks happen on click.
- Q, W, E, R for abilities, plus two summoner slots.
- Each letter has its own pool of alternative spells, so nobody can equip four ultimates.
- Every ability is either physical or magic. Physical abilities scale with attack, magic abilities with magic attack. Items raise one or the other.
- Abilities are an original list with their own names, inspired by mechanics from Dota and League. Names are working names and need a proper pass so they don't read as derivative.

### Map and economy

- Minions follow standard MOBA rules: they fight other minions, and switch to you if you attack an enemy player.
- Brushes to hide in.
- Gold comes from minions, kills and towers, and is spent on items during the match.
- The first 1v1 map is a single lane with minions: base, tower, tower, base. Four or five maps are planned in total.
- Towers shoot enemies. They target minions first and switch to an enemy player who attacks a player, the same rule minions follow. Destroying one gives gold.
- A match is the laning phase of a normal MOBA: beginners can simply fight, experienced players farm and trade.
- Each base has a shop. Spells and summoners are chosen between games, not during one.
- The loadout used is recorded with every match.

### Abilities and summoners (draft)

| Slot | Ability | Type | What it does |
| --- | --- | --- | --- |
| Q | Bolt | Magic | Fast straight shot that hits the first enemy |
| Q | Heavy Strike | Physical | Next auto hits harder and resets the attack timer |
| Q | Piercer | Physical | Slower line shot that passes through everything, weaker after the first target |
| Q | Burst | Magic | Small circle at the cursor that explodes after a short delay |
| Q | Boomerang | Magic | Flies out and comes back, so it can hit twice |
| Q | Mark | Physical | Next auto marks the target, three more hits detonate it |
| W | Chill Field | Magic | Ground area that slows enemies standing in it |
| W | Frenzy | None | Attack speed boost for a few seconds |
| W | Spell Shield | None | Short window that blocks the next enemy ability |
| W | Vanish | None | Short invisibility on a long cooldown |
| W | Trap | None | Placed on the ground, roots whoever steps on it |
| E | Dash | None | Short dash toward the cursor, hittable the whole way |
| E | Snare Shot | Magic | Skillshot that roots the first enemy hit |
| E | Reel | Physical | Hook that pulls the first enemy hit to you |
| E | Shove | Physical | Knocks enemies away, very small range |
| E | Leap | Physical | Jump to a spot with damage on landing, hittable in the air |
| R | Dome | None | Expanding circle that pushes enemies out and blocks the spells they cast from outside it |
| R | Artillery | Magic | Root yourself and fire several long-range shots |
| R | Finisher | Physical | Strike that deals more the lower the target's health |
| R | Overdrive | None | Several seconds of big attack speed and movement speed |

- Each letter has a job: Q is the main damage tool, W is defence and utility, E is mobility and crowd control, R is the ultimate.
- Summoners fill two slots, chosen from Flash, Heal, Barrier, Cleanse and Sprint (a burst of movement speed that fades out).
- No point-and-click debuffs. Abilities are aimed or self-cast.

### Interaction rules

No pair of abilities gets a special rule. Each effect does one thing and ignores everything else, so surprising combinations come from the pieces.

- Ranged autos home in on their target with no physics. Melee autos have no projectile; the hit lands at release.
- An auto always lands once released, even if the attacker dies or moves, or the target turns invisible. Cancelling before release means nothing fires.
- Skillshot spells fly in a straight line at a fixed speed and hit the first thing in their path. Aimed spells can miss; autos cannot.
- Being pushed or pulled does not stop you acting.
- A stun stops everything.
- A root stops walking, Dash, Leap and Flash. Attacks and other abilities still work.
- The newest forced movement wins and cancels any movement in progress.
- A pull drags the target to wherever the thrower is now.
- A thrown hook is independent of its thrower. It keeps flying even if the thrower is dragged away.
- A hook retracts faster than anyone can walk.
- The thrower is anchored until the hook is back: no walking, but Flash is allowed and drags the victim to the new spot. An anchored dot can still be pushed or pulled.
- Assumed: Dash and Leap are blocked while anchored.
- Dome: enemy spells cast from outside are blocked and autos are not. A spell cast from inside still lands, even if its caster has since been pushed out. (Each spell remembers whether its caster was inside the dome when cast.)

Example: A hooks an enemy, then B hooks A. A is dragged toward B, and A's victim follows, so the last hooker pulls both.

### Levels and comeback

- Experience comes from minions, towers and kills.
- Levelling up reduces cooldowns. It may also scale damage, to be decided with the numbers.
- A kill pays more when you are behind: kill gold times (1 + 0.2 for each death you have beyond your kills). At 0 kills and 2 deaths that is 1.4 times. The 0.2 is a placeholder.

### Balance targets

- A plain auto fight between two basic dots lasts about 10 seconds.
- A full round of spells takes off more than half of a basic dot's health.
- The first item arrives around dot level 2 or 3.
- A finished build is one pair of boots plus three other items.
- The maximum dot level is 10.

### Your dot

- Preset dots to pick from, plus a custom dot.
- Every dot starts from the same vanilla base stats and gets a fixed budget of points on top. Presets and custom dots use the same base and the same budget.
- At most 10 points in any one stat. Each point raises a stat by a fixed step.
- Six stats take points: health, attack, attack speed (shown as attacks per second), magic attack, armor, magic resist.
- Movement speed takes no points. It rises through items, up to a cap. Attack range takes no points either: melee and ranged dots each have a fixed range.
- No mana. Cooldowns are the only limit on abilities.
- No crit.
- The points set a dot's starting stats. Items bought during the match add to them.
- Some point spreads will be much stronger than others. That is accepted, and finding them is part of the fun.
- The custom dot is never sold. It unlocks at account level 10 and comes with one free slot. Before that, players use presets. If either player in a match is below level 10, both play presets. Extra saved slots are paid.

### Modes

| Mode | How you get in | Win condition |
| --- | --- | --- |
| 1v1 | Open matchmaking, the launch mode | First to 5 kills |
| 1v1 vs bot | Instant, no waiting | First to 5 kills |
| 2v2, 3v3 | Open matchmaking, later | Kills, maybe a Nexus later |
| Custom room, up to 5v5 | Invite link | Kills, maybe a Nexus later |
| Big free-for-all or team deathmatch | Open matchmaking, maybe | Kills |

### Accounts and money

- Fully playable with no account.
- An account saves progress and has a level, raised by experience from games played. So far it saves loadout, experience and level.
- Ads are 1 to 3 banners on the post-match screen only. No pop-ups, nothing you have to close, nothing during a match.
- Paying to remove ads is undecided, leaning no.
- Paid cosmetics: dot skins, attack and spell effects, kill effects, death animations, the click marker, emotes.
- A cosmetic must never make a spell or an attack wind-up harder to see.
- Never for sale: stat points, spells, or anything else that affects a match. Extra saved loadout slots are fine.
- Game portals such as Poki and CrazyGames are a possible source of players and ad revenue, in exchange for a cut.

### Stat tracking

- Built in from the first version, even where nothing uses the data yet.
- Recorded per match: result, kills, deaths, assists, damage dealt and taken, gold, the dot and its stat build, spells chosen, each item bought and when, timestamps of kills, mode, match length.
- Saved once, at the end of the match, so nothing extra travels over the network during play.
- The server writes the record, not the player's browser, so results cannot be faked.
- Every record carries the game version, so win rates stay meaningful after balance changes.
- Builds stored as a flexible structure, so new stats or spells just appear in new records.
- Guests get an anonymous id that lasts for the session only. Signing up during that session links its matches to the new account. Nothing about a guest is kept between sessions.
- Every player has a hidden rating from day one. Quick match uses it to pair opponents of similar skill, and it is never shown. If nobody close in skill is queued, the range widens until someone is found. The queue screen offers a bot match to play while waiting.

### Owner dashboard

- A private dashboard for patching: change the numbers, press apply.
- Its main job is a quick buff or nerf when the stats show something is broken. Adding dots and summoners from it is welcome. Building new skills in it is not required.
- Every apply creates a new game version, the same version stat tracking records.
- A change applies to new matches only, never to one in progress, and can be rolled back.
- All balance values live in data (database), not in code. Server and client read the same definitions.
- Every skill is defined as the same kind of object, built from coded blocks: projectile, area, dash, empowered auto, heal, stun, slow, root, pull, knockback, shield, buff, and more as needed. A skill with a new interaction is added in code as a new block.
- Every spell carries a cost field, set to zero for now (see Later).

## Versions

### v0, the private prototype

- Not public. Its only purpose is to see the game running, play it, and fine-tune it.
- A target dummy instead of a bot. It is an ordinary dot with no player, so every ability, minion and tower treats it like a real opponent. It shows the damage of each hit, can have its health reset, and has a switch to walk back and forth for testing skillshots.
- Two players join a match by sharing a link.
- Built on the full project structure from the start, so match tracking and everything later versions need has a place from day one.
- Order: get it playable against the target dummy first, then add matches over a shared link.

#### Technical choices

- Client: React with TypeScript. The game loop, game state and canvas drawing live in plain TS modules outside React; React only wraps the HUD, menus, shop and settings.
- Server: Node with WebSockets, authoritative, running the same game rules as the client.
- Database: Postgres, holding match records and balance values.
- Server address is a setting, not hard-coded, so regions can be added later. Start with one region (Frankfurt).
- Game speed must not depend on monitor refresh rate (fixed tick / delta time).

#### v0 placeholder numbers (approved for the first test)

Base dot and points (from the balance spreadsheet):

| Stat | Base | Each point adds | At 10 points |
| --- | --- | --- | --- |
| Health | 1000 | 50 | 1500 |
| Attack | 100 | 5 | 150 |
| Attack speed | 1.0 per second | 0.05 | 1.5 per second |
| Magic attack | 0 | 10 | 100 |
| Armor | 0 | 10 | 100 |
| Magic resist | 0 | 10 | 100 |

- Point budget: 25 of a possible 60.
- Damage taken = damage x 100 / (100 + armor or magic resist), so 100 resist halves that damage type.

Spells:

- Q: around 120 damage, cooldown around 5 seconds.
- Damaging W or E: around 100 damage, cooldown around 12 seconds.
- R: around 320 damage, cooldown around 50 seconds.
- Physical spells add a share of attack, magic spells a share of magic attack.

Levels:

- 100 experience per level, maximum level 10.
- Minion 10 experience, kill or tower 100.
- Each level cuts cooldowns by 4 percent.
- R unlocks at level 3.

Gold:

- 15 gold per last hit, 1 gold per second for everyone, 150 per kill, 200 per tower.

Presets:

| Preset | Range | Points | Q / W / E / R | Summoners |
| --- | --- | --- | --- | --- |
| Poke | Ranged | 10 magic attack, 5 health, 5 magic resist, 5 attack speed | Bolt / Chill Field / Dash / Artillery | Flash, Barrier |
| Diver | Melee | 10 attack, 5 attack speed, 5 health, 5 armor | Heavy Strike / Frenzy / Leap / Finisher | Flash, Cleanse |
| Tank | Melee | 10 health, 8 armor, 7 magic resist | Mark / Spell Shield / Reel / Dome | Flash, Heal |
| Marksman | Ranged | 8 attack, 8 attack speed, 5 health, 4 armor | Piercer / Trap / Snare Shot / Overdrive | Flash, Sprint |

Items:

| Item | Cost | Gives |
| --- | --- | --- |
| Boots | 250 | +15% movement speed |
| Blade | 400 | +25 attack |
| Quickhand | 400 | +0.25 attacks per second |
| Focus | 400 | +50 magic attack |
| Plate | 400 | +50 armor |
| Ward | 400 | +50 magic resist |
| Heart | 400 | +300 health |

- Minions: a wave of 4 every 20 seconds, two melee (300 health, 25 damage, short range) and two ranged (200 health, 35 damage, long range). Slower than dots. 15 gold each.
- Towers: one per side, 2500 health, 150 damage per shot, one shot per second, range 500. Shots home in like autos. Each consecutive hit on the same dot does 25% more. 200 gold.
- Map: a lane about 3000 units long and 600 wide, a base and shop at each end, each tower about 700 units in front of its base, two patches of brush halfway down.
- Range: ranged dots 450, melee dots 150.
- Movement speed: 300 units a second, capped at 450.
- Respawn: a flat 6 seconds. First to 5 kills wins.
- Four ultimates for now.

### v0.1, the first online version

- Purpose: put the game online early and find out whether it is worth building further, before anything past level 10 is designed or built.
- 1v1 quick match on a single map, plus a match against a bot.
- Preset dots only.
- A pick screen after a match is found: about 20 seconds, blind pick, both choices revealed together. Last choice preselected; both ready starts the match.
- Accounts can be created from day one.
- At account level 10, a banner on the homepage says level 10+ content is coming soon. The hidden rating keeps rising past 10.
- Running underneath from day one: stat tracking, the hidden rating, the owner dashboard, and everything levels will need.
- The questionnaire and the measures of whether the game is worth building further come later.

### v0.5

- Account levels go live, worked out from each account's match history.
- The level 10 unlocks follow, starting with the custom dot.

## Later

- Swapping spells during a match, at the base shop, through a small inconspicuous button. Possibly unlocked at account level 10, and available in a match only if both players have unlocked it. A spell swapped in should not arrive off cooldown.
- A ranked queue for accounts at level 10 and above, with a simple Elo rating to start. Quick match stays open to everyone, possibly with its own leaderboard.
- A cost for spells drawn from the same budget as stat points, with stronger spells and being ranged costing more.
- Open matchmaking for 2v2 and 3v3, and a Nexus as a win condition in team modes.
- A big free-for-all or team deathmatch map.
- Fake champion portraits for the dots.
- Server regions beyond the first.
- General rule: anything a level unlocks that affects a match only switches on when everyone in the match has it.

## Open questions

- Which ultimates fill the last one or two R spots? Candidates: Rewind, Whirl, Shockwave.
- Do Dash and Leap cross walls? Leaning no, which keeps Flash the only way through.
- Do kills by the player who is ahead pay less? Also whether experience uses the same comeback multiplier.
- Health regeneration, and whether standing in your base heals you (decides how strong poke is).
- Should being ranged cost something, such as lower base health?
- Do account levels show in v0.1?
- What counts as worth building further? Decide the bar before launch, measured by behaviour (next-day and next-week return, matches per visit, rematches).
- Rewarded ads, yes or no?
- What are the dot cosmetics?
- Final ability names.

## Tensions to watch

- Free builds against balance: some combinations will be broken. Presets first, custom dots later, keeps this manageable.
- MOBA depth against 5 to 10 minutes: resolved in principle, a match is the laning phase. Economy numbers must be tuned to that window.
- Many modes against a small player base: every open queue splits the people online. Start with 1v1 only.
- More regions against a small player base: each region splits the queue.
