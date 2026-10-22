import type { Side } from "@moba/protocol";
import { inRect } from "./geometry.js";
import { isInvisible } from "./statuses.js";
import type { Dot, World } from "./types.js";

/** Index of the brush patch a dot stands in, or -1. A dot is in brush when its centre is. */
export function brushOf(world: World, dot: Dot): number {
  return world.geometry.brush.findIndex((b) => inRect(dot.pos, b));
}

/**
 * An invisible dot is hidden from the other side. A dot in brush is too, unless one of their dots stands in the same
 * patch or it just attacked or cast.
 */
export function isVisibleTo(world: World, dot: Dot, viewer: Side): boolean {
  if (dot.side === viewer) return true;
  if (isInvisible(dot)) return false;
  if (dot.revealedFor > 0) return true;
  const patch = brushOf(world, dot);
  if (patch < 0) return true;
  for (const other of world.dots.values()) {
    if (other.side === viewer && brushOf(world, other) === patch) return true;
  }
  return false;
}
