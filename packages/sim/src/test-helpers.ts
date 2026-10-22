import type { Loadout } from "@moba/protocol";

/** A dot with no points: the vanilla base stats. */
const NO_SPELLS = { abilities: { Q: null, W: null, E: null, R: null }, summoners: [null, null] as [null, null] };
export const VANILLA: Loadout = { preset: null, range: "ranged", points: {}, ...NO_SPELLS };
export const VANILLA_MELEE: Loadout = { preset: null, range: "melee", points: {}, ...NO_SPELLS };

import type { World } from "./world.js";
import { step } from "./world.js";
import { TICK_RATE } from "./tick.js";

/** Steps the world for `seconds`, or until `until` returns true. Returns the seconds that passed. */
export function run(world: World, seconds: number, until?: () => boolean): number {
  const ticks = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < ticks; i++) {
    if (until?.()) return i / TICK_RATE;
    step(world);
  }
  return ticks / TICK_RATE;
}

let seq = 0;
export const cmd = {
  attack: (target: string) => ({ type: "attack" as const, seq: ++seq, tick: 0, target }),
  move: (x: number, y: number) => ({ type: "move" as const, seq: ++seq, tick: 0, to: { x, y } }),
  stop: () => ({ type: "stop" as const, seq: ++seq, tick: 0 }),
};

import type { EffectDef } from "@moba/balance";
import type { CastSlot, Side } from "@moba/protocol";
import { applyEffects } from "./spells.js";
import type { Dot } from "./types.js";

/** A loadout with exactly these abilities and summoners, no points. */
export function kit(
  abilities: Partial<Record<"Q" | "W" | "E" | "R", string>>,
  summoners: [string | null, string | null] = [null, null],
  range: "melee" | "ranged" = "ranged",
): Loadout {
  return {
    preset: null,
    range,
    points: {},
    abilities: { Q: abilities.Q ?? null, W: abilities.W ?? null, E: abilities.E ?? null, R: abilities.R ?? null },
    summoners,
  };
}

export const cast = (slot: CastSlot, x: number, y: number) => ({ type: "cast" as const, seq: ++seq, tick: 0, slot, aim: { x, y } });

/** Applies effects to a dot as if from a spell cast by `side`, for rules that no preset ability exercises directly. */
export function inflict(world: World, target: Dot, effects: EffectDef[], from: { side: Side; at?: { x: number; y: number } }) {
  return applyEffects(
    world,
    { caster: "nobody", side: from.side, ability: "test", type: "magic", attack: 0, magicAttack: 0, castInside: [], spell: true, blockedOn: [] },
    target,
    effects,
    from.at ?? { x: target.pos.x - 1, y: target.pos.y },
  );
}

export const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
