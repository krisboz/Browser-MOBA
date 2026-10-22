// The two bean-shaped arms. Purely visual: driven by the server's wind-up progress and release tick.

// Angles from the facing direction, in radians.
const REST = (100 * Math.PI) / 180; // beside the body, a little back
const RAISED = (140 * Math.PI) / 180; // pulled back at the end of a wind-up
const STRIKE = (30 * Math.PI) / 180; // snapped forward on release
const SNAP_TIME = 0.06;
const RECOVER_TIME = 0.22;

export interface ArmPose {
  /** Angle of each arm from the facing direction (mirrored for the other arm). */
  angle: number;
  /** 1 at rest; arms swell slightly as they rise, reading as "lifted" from above. */
  scale: number;
}

/**
 * `windUp` is the wind-up progress (0..1) or null; `sinceRelease` is seconds since the last release, or null.
 */
export function armPose(windUp: number | null, sinceRelease: number | null): ArmPose {
  if (windUp !== null) {
    const p = easeOut(windUp);
    return { angle: REST + (RAISED - REST) * p, scale: 1 + 0.35 * p };
  }
  if (sinceRelease !== null && sinceRelease >= 0 && sinceRelease < SNAP_TIME + RECOVER_TIME) {
    if (sinceRelease < SNAP_TIME) return { angle: STRIKE, scale: 1.2 };
    const k = easeOut((sinceRelease - SNAP_TIME) / RECOVER_TIME);
    return { angle: STRIKE + (REST - STRIKE) * k, scale: 1.2 - 0.2 * k };
  }
  return { angle: REST, scale: 1 };
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;
