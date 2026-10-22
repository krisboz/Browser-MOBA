// The two bean-shaped arms. Purely visual: driven by the server's wind-up progress and release ticks.
// One animation for autos (arms pull back, then strike), one for spells (arms come forward, then thrust).

const deg = (d: number) => (d * Math.PI) / 180;
const REST = deg(100); // beside the body, a little back
const AUTO_RAISED = deg(140); // pulled back at the end of an auto wind-up
const AUTO_STRIKE = deg(30); // snapped forward on release
const SPELL_RAISED = deg(55); // brought up in front during a spell wind-up
const SPELL_THRUST = deg(12); // both arms thrust straight ahead on release
const SNAP_TIME = 0.06;
const RECOVER_TIME = 0.22;

export interface ArmPose {
  /** Angle of each arm from the facing direction (mirrored for the other arm). */
  angle: number;
  /** 1 at rest; arms swell slightly as they rise, reading as "lifted" from above. */
  scale: number;
}

export interface ArmState {
  /** Auto wind-up progress 0..1, or null. */
  windUp: number | null;
  /** Spell wind-up progress 0..1, or null. */
  cast: number | null;
  /** Seconds since the last auto release / spell release, or null if never. */
  sinceRelease: number | null;
  sinceCast: number | null;
}

export function armPose(s: ArmState): ArmPose {
  if (s.cast !== null) {
    const p = easeOut(s.cast);
    return { angle: REST + (SPELL_RAISED - REST) * p, scale: 1 + 0.4 * p };
  }
  if (s.windUp !== null) {
    const p = easeOut(s.windUp);
    return { angle: REST + (AUTO_RAISED - REST) * p, scale: 1 + 0.35 * p };
  }
  // Whichever release was more recent decides the follow-through.
  const spellFirst = s.sinceCast !== null && (s.sinceRelease === null || s.sinceCast < s.sinceRelease);
  const since = spellFirst ? s.sinceCast : s.sinceRelease;
  const strike = spellFirst ? SPELL_THRUST : AUTO_STRIKE;
  if (since !== null && since >= 0 && since < SNAP_TIME + RECOVER_TIME) {
    if (since < SNAP_TIME) return { angle: strike, scale: 1.25 };
    const k = easeOut((since - SNAP_TIME) / RECOVER_TIME);
    return { angle: strike + (REST - strike) * k, scale: 1.25 - 0.25 * k };
  }
  return { angle: REST, scale: 1 };
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;
