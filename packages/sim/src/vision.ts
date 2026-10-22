import type { Side } from "@moba/protocol";
import { inRect } from "./geometry.js";
import type { Dot, World } from "./world.js";

/** Index of the brush patch a dot stands in, or -1. A dot is in brush when its centre is. */
export function brushOf(world: World, dot: Dot): number {
  return world.geometry.brush.findIndex((b) => inRect(dot.pos, b));
}

/** A dot in brush is hidden from the other side unless one of their dots stands in the same patch. */
export function isVisibleTo(world: World, dot: Dot, viewer: Side): boolean {
  if (dot.side === viewer) return true;
  const patch = brushOf(world, dot);
  if (patch < 0) return true;
  for (const other of world.dots.values()) {
    if (other.side === viewer && brushOf(world, other) === patch) return true;
  }
  return false;
}
