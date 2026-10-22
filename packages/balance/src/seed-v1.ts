import type { BalanceData } from "./schema.js";

// Version 1: the approved v0 placeholder numbers from docs/design-notes.md.
// Values marked "placeholder" are not decided yet; see "Decisions needed" in docs/v0-build-plan.md.
// Block fields are a first sketch; M3 gives each block kind a strict schema.

const damage = (base: number, ratio = 0.6) => ({ kind: "damage", base, ratio });

export const seedV1: BalanceData = {
  dot: {
    stats: {
      health: { base: 1000, perPoint: 50 },
      attack: { base: 100, perPoint: 5 },
      attackSpeed: { base: 1.0, perPoint: 0.05 },
      magicAttack: { base: 0, perPoint: 10 },
      armor: { base: 0, perPoint: 10 },
      magicResist: { base: 0, perPoint: 10 },
    },
    pointBudget: 25,
    pointCapPerStat: 10,
    radius: 30,
    moveSpeed: 300,
    moveSpeedCap: 450,
    range: { melee: 150, ranged: 450 },
    autoWindUpShare: 0.3,
    rangedAutoSpeed: 1200, // placeholder
    respawn: 6,
  },
  damage: { resistConstant: 100 },
  match: { killsToWin: 5 },
  levels: {
    xpPerLevel: 100,
    maxLevel: 10,
    cooldownCutPerLevel: 0.04,
    ultimateUnlockLevel: 3,
    xp: { minion: 10, kill: 100, tower: 100 },
  },
  gold: { start: 0, perSecond: 1, lastHit: 15, kill: 150, tower: 200, comebackPerDeathBehind: 0.2 },
  items: [
    { id: "boots", name: "Boots", cost: 250, stats: { moveSpeedPct: 0.15 } },
    { id: "blade", name: "Blade", cost: 400, stats: { attack: 25 } },
    { id: "quickhand", name: "Quickhand", cost: 400, stats: { attackSpeed: 0.25 } },
    { id: "focus", name: "Focus", cost: 400, stats: { magicAttack: 50 } },
    { id: "plate", name: "Plate", cost: 400, stats: { armor: 50 } },
    { id: "ward", name: "Ward", cost: 400, stats: { magicResist: 50 } },
    { id: "heart", name: "Heart", cost: 400, stats: { health: 300 } },
  ],
  minions: {
    waveInterval: 20,
    firstWaveAt: 5, // placeholder
    // attackSpeed, range, moveSpeed and radius are placeholders ("short range", "long range", "slower than dots")
    melee: { count: 2, health: 300, damage: 25, attackSpeed: 1, range: 100, moveSpeed: 240, radius: 20 },
    ranged: { count: 2, health: 200, damage: 35, attackSpeed: 1, range: 400, moveSpeed: 240, radius: 20 },
  },
  towers: {
    health: 2500,
    damage: 150,
    attackSpeed: 1,
    range: 500,
    radius: 50, // placeholder
    rampPerConsecutiveHit: 0.25,
    shotSpeed: 1200, // placeholder
  },
  map: {
    id: "lane",
    length: 3000,
    width: 600,
    baseDepth: 300, // placeholder
    towerDistanceFromBase: 700,
    // placeholder shapes: one patch on each side of the lane at the midpoint
    brush: [
      { x: 1400, y: 0, w: 200, h: 160 },
      { x: 1400, y: 440, w: 200, h: 160 },
    ],
  },
  abilities: [
    // Q
    {
      id: "bolt", name: "Bolt", slot: "Q", type: "magic", cost: 0, cooldown: 5, windUp: 0.25,
      blocks: [{ kind: "projectile", hits: "first", speed: 1400, range: 900, width: 30, onHit: [damage(120)] }],
    },
    {
      id: "heavy-strike", name: "Heavy Strike", slot: "Q", type: "physical", cost: 0, cooldown: 5, windUp: 0,
      blocks: [{ kind: "empoweredAuto", duration: 4, resetAttackTimer: true, onHit: [damage(120)] }],
    },
    {
      id: "piercer", name: "Piercer", slot: "Q", type: "physical", cost: 0, cooldown: 5, windUp: 0.25,
      blocks: [{ kind: "projectile", hits: "pierce", falloffAfterFirst: 0.5, speed: 1000, range: 1000, width: 40, onHit: [damage(120)] }],
    },
    {
      id: "burst", name: "Burst", slot: "Q", type: "magic", cost: 0, cooldown: 5, windUp: 0.25,
      blocks: [{ kind: "area", timing: "delayed", delay: 0.8, castRange: 800, radius: 120, onHit: [damage(120)] }],
    },
    {
      id: "boomerang", name: "Boomerang", slot: "Q", type: "magic", cost: 0, cooldown: 5, windUp: 0.25,
      blocks: [{ kind: "projectile", hits: "pierce", returns: true, speed: 1100, range: 800, width: 40, onHit: [damage(80)] }],
    },
    {
      id: "mark", name: "Mark", slot: "Q", type: "physical", cost: 0, cooldown: 5, windUp: 0,
      blocks: [
        { kind: "empoweredAuto", duration: 4, resetAttackTimer: false, onHit: [{ kind: "applyMark", mark: "mark" }] },
        { kind: "markStacks", mark: "mark", hitsToDetonate: 3, duration: 4, onDetonate: [damage(120)] },
      ],
    },
    // W
    {
      id: "chill-field", name: "Chill Field", slot: "W", type: "magic", cost: 0, cooldown: 12, windUp: 0.25,
      blocks: [{ kind: "area", timing: "lasting", duration: 3, castRange: 700, radius: 200, onEnter: [damage(100)], whileInside: [{ kind: "slow", amount: 0.3 }] }],
    },
    {
      id: "frenzy", name: "Frenzy", slot: "W", type: "none", cost: 0, cooldown: 12, windUp: 0,
      blocks: [{ kind: "buff", duration: 4, stats: { attackSpeed: 0.5 } }],
    },
    {
      id: "spell-shield", name: "Spell Shield", slot: "W", type: "none", cost: 0, cooldown: 14, windUp: 0,
      blocks: [{ kind: "shield", blocks: "nextSpell", duration: 1.5 }],
    },
    {
      id: "vanish", name: "Vanish", slot: "W", type: "none", cost: 0, cooldown: 30, windUp: 0,
      blocks: [{ kind: "invisible", duration: 2 }],
    },
    {
      id: "trap", name: "Trap", slot: "W", type: "none", cost: 0, cooldown: 12, windUp: 0.25,
      blocks: [{ kind: "placed", castRange: 400, radius: 40, lifetime: 30, onEnter: [{ kind: "root", duration: 1.25 }] }],
    },
    // E
    {
      id: "dash", name: "Dash", slot: "E", type: "none", cost: 0, cooldown: 10, windUp: 0,
      blocks: [{ kind: "move", style: "dash", distance: 300, speed: 1200, crossesWalls: false }],
    },
    {
      id: "snare-shot", name: "Snare Shot", slot: "E", type: "magic", cost: 0, cooldown: 12, windUp: 0.25,
      blocks: [{ kind: "projectile", hits: "first", speed: 1300, range: 900, width: 30, onHit: [damage(100), { kind: "root", duration: 1.5 }] }],
    },
    {
      id: "reel", name: "Reel", slot: "E", type: "physical", cost: 0, cooldown: 12, windUp: 0.25,
      blocks: [{ kind: "projectile", hits: "first", speed: 1300, range: 800, width: 35, anchorsThrower: true, retractSpeed: 1600, onHit: [damage(100), { kind: "pull" }] }],
    },
    {
      id: "shove", name: "Shove", slot: "E", type: "physical", cost: 0, cooldown: 12, windUp: 0.15,
      blocks: [{ kind: "area", timing: "instant", castRange: 0, radius: 160, onHit: [damage(60), { kind: "knockback", distance: 300, speed: 1500 }] }],
    },
    {
      id: "leap", name: "Leap", slot: "E", type: "physical", cost: 0, cooldown: 12, windUp: 0.15,
      blocks: [{ kind: "move", style: "leap", distance: 450, speed: 900, crossesWalls: false, onLand: [{ kind: "area", timing: "instant", castRange: 0, radius: 120, onHit: [damage(100)] }] }],
    },
    // R
    {
      id: "dome", name: "Dome", slot: "R", type: "none", cost: 0, cooldown: 50, windUp: 0.25,
      blocks: [{ kind: "zone", radius: 350, expandTime: 0.5, duration: 4, pushesEnemiesOut: true, blocksSpellsFromOutside: true }],
    },
    {
      id: "artillery", name: "Artillery", slot: "R", type: "magic", cost: 0, cooldown: 50, windUp: 0.25,
      blocks: [{ kind: "channel", selfRoot: true, duration: 3, shots: 5, shot: { kind: "area", timing: "delayed", delay: 0.6, castRange: 1600, radius: 150, onHit: [damage(80, 0.2)] } }],
    },
    {
      id: "finisher", name: "Finisher", slot: "R", type: "physical", cost: 0, cooldown: 50, windUp: 0.35,
      blocks: [{ kind: "area", timing: "instant", castRange: 150, radius: 100, onHit: [{ kind: "damage", base: 320, ratio: 0.6, missingHealthBonus: 1 }] }],
    },
    {
      id: "overdrive", name: "Overdrive", slot: "R", type: "none", cost: 0, cooldown: 50, windUp: 0,
      blocks: [{ kind: "buff", duration: 5, stats: { attackSpeed: 1, moveSpeedPct: 0.3 } }],
    },
  ],
  // All summoner numbers are placeholders.
  summoners: [
    { id: "flash", name: "Flash", cost: 0, cooldown: 120, windUp: 0, blocks: [{ kind: "move", style: "blink", distance: 400, crossesWalls: true }] },
    { id: "heal", name: "Heal", cost: 0, cooldown: 120, windUp: 0, blocks: [{ kind: "heal", amount: 250 }] },
    { id: "barrier", name: "Barrier", cost: 0, cooldown: 120, windUp: 0, blocks: [{ kind: "shield", blocks: "damage", amount: 300, duration: 2 }] },
    { id: "cleanse", name: "Cleanse", cost: 0, cooldown: 120, windUp: 0, blocks: [{ kind: "cleanse" }] },
    { id: "sprint", name: "Sprint", cost: 0, cooldown: 120, windUp: 0, blocks: [{ kind: "buff", duration: 3, fades: true, stats: { moveSpeedPct: 0.6 } }] },
  ],
  presets: [
    {
      id: "poke", name: "Poke", range: "ranged",
      points: { magicAttack: 10, health: 5, magicResist: 5, attackSpeed: 5 },
      abilities: { Q: "bolt", W: "chill-field", E: "dash", R: "artillery" },
      summoners: ["flash", "barrier"],
    },
    {
      id: "diver", name: "Diver", range: "melee",
      points: { attack: 10, attackSpeed: 5, health: 5, armor: 5 },
      abilities: { Q: "heavy-strike", W: "frenzy", E: "leap", R: "finisher" },
      summoners: ["flash", "cleanse"],
    },
    {
      id: "tank", name: "Tank", range: "melee",
      points: { health: 10, armor: 8, magicResist: 7 },
      abilities: { Q: "mark", W: "spell-shield", E: "reel", R: "dome" },
      summoners: ["flash", "heal"],
    },
    {
      id: "marksman", name: "Marksman", range: "ranged",
      points: { attack: 8, attackSpeed: 8, health: 5, armor: 4 },
      abilities: { Q: "piercer", W: "trap", E: "snare-shot", R: "overdrive" },
      summoners: ["flash", "sprint"],
    },
  ],
};
