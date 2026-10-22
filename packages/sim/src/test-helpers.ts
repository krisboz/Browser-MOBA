import type { Loadout } from "@moba/protocol";

/** A dot with no points: the vanilla base stats. */
export const VANILLA: Loadout = { preset: null, range: "ranged", points: {} };
export const VANILLA_MELEE: Loadout = { preset: null, range: "melee", points: {} };

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
