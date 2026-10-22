import { z } from "zod";

// All durations are in seconds, all distances in world units, all speeds in units per second.

const nonNeg = z.number().finite().nonnegative();
const pos = z.number().finite().positive();
const share = z.number().finite().min(0).max(1);

export const STAT_KEYS = ["health", "attack", "attackSpeed", "magicAttack", "armor", "magicResist"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const SLOTS = ["Q", "W", "E", "R"] as const;
export type Slot = (typeof SLOTS)[number];

const statLine = z.object({ base: nonNeg, perPoint: nonNeg }).strict();

const statBonus = z
  .object({
    health: nonNeg,
    attack: nonNeg,
    attackSpeed: nonNeg,
    magicAttack: nonNeg,
    armor: nonNeg,
    magicResist: nonNeg,
    moveSpeedPct: nonNeg,
  })
  .partial()
  .strict();

// ---- Effects: what a block does to each dot it reaches.

const damageEffect = z
  .object({
    kind: z.literal("damage"),
    base: nonNeg,
    /** Share of the caster's attack (physical) or magic attack (magic) added on top. */
    ratio: nonNeg,
    /** Extra damage at low health: x (1 + this x missing share of the target's health). */
    missingHealthBonus: nonNeg.optional(),
  })
  .strict();

const effect = z.discriminatedUnion("kind", [
  damageEffect,
  z.object({ kind: z.literal("root"), duration: nonNeg }).strict(),
  z.object({ kind: z.literal("stun"), duration: nonNeg }).strict(),
  z.object({ kind: z.literal("slow"), amount: share, duration: nonNeg }).strict(),
  z.object({ kind: z.literal("knockback"), distance: nonNeg, speed: pos }).strict(),
  z
    .object({
      kind: z.literal("applyMark"),
      /** Autos from the same source after the marking one; the last of them detonates it. */
      hitsToDetonate: z.number().int().positive(),
      duration: nonNeg,
      onDetonate: z.array(damageEffect),
    })
    .strict(),
]);

// ---- Blocks: the coded building pieces every ability and summoner is made of.

const areaBlock = z
  .object({
    kind: z.literal("area"),
    /** instant: hits once now; delayed: hits once after `delay`; lasting: stays for `duration`. */
    timing: z.enum(["instant", "delayed", "lasting"]),
    delay: nonNeg,
    duration: nonNeg,
    /** How far from the caster it may be placed. 0 centres it on the caster. */
    castRange: nonNeg,
    radius: pos,
    /** Applied once to each enemy it reaches. */
    onHit: z.array(effect),
    /** Lasting areas: applied every tick to enemies inside. */
    whileInside: z.array(effect),
  })
  .strict();

const block = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("projectile"),
      hits: z.enum(["first", "pierce"]),
      /** Piercing: damage share lost on every target after the first. */
      falloffAfterFirst: share,
      /** Flies back to the caster after reaching its range, hitting again on the way. */
      returns: z.boolean(),
      speed: pos,
      range: pos,
      width: nonNeg,
      onHit: z.array(effect),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hook"),
      speed: pos,
      range: pos,
      width: nonNeg,
      /** How fast the hook and its victim come back. Must beat every walking speed. */
      retractSpeed: pos,
      onHit: z.array(effect),
    })
    .strict(),
  areaBlock,
  z
    .object({
      kind: z.literal("empoweredAuto"),
      /** Seconds the next auto stays empowered. */
      duration: nonNeg,
      resetAttackTimer: z.boolean(),
      onHit: z.array(effect),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      /** dash and leap travel and can be hit on the way; blink is instant. */
      style: z.enum(["dash", "leap", "blink"]),
      distance: pos,
      speed: pos,
      crossesWalls: z.boolean(),
      onLand: z.array(areaBlock),
    })
    .strict(),
  z
    .object({
      kind: z.literal("zone"),
      radius: pos,
      expandTime: nonNeg,
      duration: nonNeg,
      pushesEnemiesOut: z.boolean(),
      blocksSpellsFromOutside: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("channel"),
      /** The caster can't walk, dash, leap or blink while channelling. */
      duration: pos,
      shots: z.number().int().positive(),
      /** Seconds between shots; each recast of the slot fires the next one at the cursor. */
      shotInterval: nonNeg,
      shot: areaBlock,
    })
    .strict(),
  z
    .object({
      kind: z.literal("placed"),
      castRange: nonNeg,
      radius: pos,
      lifetime: pos,
      onEnter: z.array(effect),
    })
    .strict(),
  z.object({ kind: z.literal("buff"), duration: nonNeg, fades: z.boolean(), stats: statBonus }).strict(),
  z
    .object({ kind: z.literal("shield"), blocks: z.enum(["nextSpell", "damage"]), amount: nonNeg, duration: nonNeg })
    .strict(),
  z.object({ kind: z.literal("heal"), amount: nonNeg }).strict(),
  z.object({ kind: z.literal("cleanse") }).strict(),
  z.object({ kind: z.literal("invisible"), duration: nonNeg }).strict(),
]);

const ability = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slot: z.enum(SLOTS),
    type: z.enum(["physical", "magic", "none"]),
    cost: nonNeg,
    cooldown: nonNeg,
    windUp: nonNeg,
    blocks: z.array(block).min(1),
  })
  .strict();

const summoner = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    cost: nonNeg,
    cooldown: nonNeg,
    windUp: nonNeg,
    blocks: z.array(block).min(1),
  })
  .strict();

const item = z
  .object({ id: z.string().min(1), name: z.string().min(1), cost: nonNeg, stats: statBonus })
  .strict();

const preset = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    range: z.enum(["melee", "ranged"]),
    points: z.record(z.enum(STAT_KEYS), z.number().int().nonnegative()),
    abilities: z.object({ Q: z.string(), W: z.string(), E: z.string(), R: z.string() }).strict(),
    summoners: z.tuple([z.string(), z.string()]),
  })
  .strict();

const minionKind = z
  .object({
    count: z.number().int().nonnegative(),
    health: pos,
    damage: nonNeg,
    attackSpeed: pos,
    range: pos,
    moveSpeed: pos,
    radius: pos,
  })
  .strict();

const rect = z.object({ x: z.number().finite(), y: z.number().finite(), w: pos, h: pos }).strict();

export const balanceSchema = z
  .object({
    dot: z
      .object({
        stats: z.object({
          health: statLine,
          attack: statLine,
          attackSpeed: statLine,
          magicAttack: statLine,
          armor: statLine,
          magicResist: statLine,
        }).strict(),
        pointBudget: z.number().int().nonnegative(),
        pointCapPerStat: z.number().int().nonnegative(),
        radius: pos,
        moveSpeed: pos,
        moveSpeedCap: pos,
        range: z.object({ melee: pos, ranged: pos }).strict(),
        autoWindUpShare: share,
        rangedAutoSpeed: pos,
        respawn: nonNeg,
        /** Health regained per second anywhere, as a flat amount. */
        regenPerSecond: nonNeg,
        /** Share of max health regained per second while standing in your own base. */
        baseHealPerSecond: share,
        /** Seconds a dot stays visible from brush after releasing an attack. */
        brushRevealAfterAttack: nonNeg,
      })
      .strict(),
    damage: z.object({ resistConstant: pos }).strict(),
    match: z.object({ killsToWin: z.number().int().positive() }).strict(),
    levels: z
      .object({
        xpPerLevel: pos,
        maxLevel: z.number().int().positive(),
        cooldownCutPerLevel: share,
        ultimateUnlockLevel: z.number().int().positive(),
        xp: z.object({ minion: nonNeg, kill: nonNeg, tower: nonNeg }).strict(),
      })
      .strict(),
    gold: z
      .object({
        start: nonNeg,
        perSecond: nonNeg,
        lastHit: nonNeg,
        kill: nonNeg,
        tower: nonNeg,
        comebackPerDeathBehind: nonNeg,
      })
      .strict(),
    items: z.array(item).min(1),
    minions: z
      .object({ waveInterval: pos, firstWaveAt: nonNeg, melee: minionKind, ranged: minionKind })
      .strict(),
    towers: z
      .object({
        health: pos,
        damage: nonNeg,
        attackSpeed: pos,
        range: pos,
        radius: pos,
        rampPerConsecutiveHit: nonNeg,
        shotSpeed: pos,
      })
      .strict(),
    map: z
      .object({
        id: z.string().min(1),
        length: pos,
        width: pos,
        baseDepth: pos,
        /** From each end of the lane to that side's tower. */
        towerDistanceFromEnd: pos,
        walls: z.array(rect),
        brush: z.array(rect),
      })
      .strict(),
    dummy: z
      .object({
        /** Where the target dummy stands and respawns. */
        x: nonNeg,
        y: nonNeg,
        /** When patrolling it walks this far either side of its spot, across the lane. */
        patrolHalfSpan: nonNeg,
      })
      .strict(),
    abilities: z.array(ability).min(1),
    summoners: z.array(summoner).min(1),
    presets: z.array(preset).min(1),
  })
  .strict()
  .superRefine((b, ctx) => {
    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    for (const [key, list] of [
      ["abilities", b.abilities],
      ["summoners", b.summoners],
      ["items", b.items],
      ["presets", b.presets],
    ] as const) {
      const seen = new Set<string>();
      list.forEach((entry, i) => {
        if (seen.has(entry.id)) fail([key, i, "id"], `duplicate id "${entry.id}"`);
        seen.add(entry.id);
      });
    }

    if (b.dot.moveSpeedCap < b.dot.moveSpeed) fail(["dot", "moveSpeedCap"], "cap is below base movement speed");
    if (b.levels.ultimateUnlockLevel > b.levels.maxLevel) fail(["levels", "ultimateUnlockLevel"], "above max level");
    if (b.dummy.x > b.map.length || b.dummy.y > b.map.width) fail(["dummy"], "outside the map");
    if (b.map.towerDistanceFromEnd * 2 >= b.map.length) fail(["map", "towerDistanceFromEnd"], "towers overlap");
    for (const key of ["walls", "brush"] as const) {
      b.map[key].forEach((r, i) => {
        if (r.x < 0 || r.y < 0 || r.x + r.w > b.map.length || r.y + r.h > b.map.width) fail(["map", key, i], "outside the map");
      });
    }

    // "A hook retracts faster than anyone can walk": checked here so no balance version can break it.
    [...b.abilities, ...b.summoners].forEach((a, i) => {
      for (const blk of a.blocks) {
        if (blk.kind === "hook" && blk.retractSpeed <= b.dot.moveSpeedCap) {
          fail([a.id, "blocks", i], `hook retracts at ${blk.retractSpeed}, not faster than the ${b.dot.moveSpeedCap} walking cap`);
        }
      }
    });

    const abilities = new Map(b.abilities.map((a) => [a.id, a]));
    const summoners = new Set(b.summoners.map((s) => s.id));
    b.presets.forEach((p, i) => {
      let total = 0;
      for (const [stat, n] of Object.entries(p.points)) {
        total += n;
        if (n > b.dot.pointCapPerStat) fail(["presets", i, "points", stat], `${n} points is over the cap of ${b.dot.pointCapPerStat}`);
      }
      if (total > b.dot.pointBudget) fail(["presets", i, "points"], `${total} points is over the budget of ${b.dot.pointBudget}`);
      for (const slot of SLOTS) {
        const a = abilities.get(p.abilities[slot]);
        if (!a) fail(["presets", i, "abilities", slot], `unknown ability "${p.abilities[slot]}"`);
        else if (a.slot !== slot) fail(["presets", i, "abilities", slot], `"${a.id}" is a ${a.slot} ability`);
      }
      p.summoners.forEach((s, j) => {
        if (!summoners.has(s)) fail(["presets", i, "summoners", j], `unknown summoner "${s}"`);
      });
      if (p.summoners[0] === p.summoners[1]) fail(["presets", i, "summoners"], "the same summoner twice");
    });
  });

export type BalanceData = z.infer<typeof balanceSchema>;
export type AbilityDef = BalanceData["abilities"][number];
export type SummonerDef = BalanceData["summoners"][number];
export type ItemDef = BalanceData["items"][number];
export type PresetDef = BalanceData["presets"][number];
export type BlockDef = z.infer<typeof block>;
export type AreaBlockDef = z.infer<typeof areaBlock>;
export type EffectDef = z.infer<typeof effect>;
export type DamageEffectDef = z.infer<typeof damageEffect>;

export type ParseResult = { ok: true; data: BalanceData } | { ok: false; issues: string[] };

export function parseBalance(input: unknown): ParseResult {
  const result = balanceSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
