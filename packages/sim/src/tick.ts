export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

// Frame times rarely sum to an exact multiple of DT in floating point (six 1/60 s frames are a hair
// under 0.1 s), so a tick that is due within this margin still runs.
const EPSILON = 1e-9;

/**
 * Turns real elapsed time into a whole number of fixed sim steps.
 * The sim never sees frame times, so its speed doesn't depend on refresh rate.
 */
export class FixedStepper {
  private accumulator = 0;

  /** Steps beyond this per advance() are dropped, so a stalled tab doesn't freeze catching up. */
  constructor(private readonly maxStepsPerAdvance = TICK_RATE) {}

  /** Adds `elapsed` seconds and runs `step` once per whole tick. Returns how far into the next tick we are (0..1). */
  advance(elapsed: number, step: () => void): number {
    this.accumulator += Math.max(0, elapsed);
    let steps = 0;
    while (this.accumulator >= DT - EPSILON) {
      this.accumulator -= DT;
      if (steps < this.maxStepsPerAdvance) step();
      steps++;
    }
    return Math.max(0, this.accumulator) / DT;
  }
}
