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

// Blocks get one strict schema per kind in M3. Until then a block is any object with a kind.
const block = z.object({ kind: z.string().min(1) }).passthrough();

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
        towerDistanceFromBase: pos,
        brush: z.array(rect),
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
    if (b.map.towerDistanceFromBase * 2 >= b.map.length) fail(["map", "towerDistanceFromBase"], "towers overlap");

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

export type ParseResult = { ok: true; data: BalanceData } | { ok: false; issues: string[] };

export function parseBalance(input: unknown): ParseResult {
  const result = balanceSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
