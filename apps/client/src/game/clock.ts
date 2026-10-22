import { DT } from "@moba/sim";

// Ticks of slack on top of the measured one-way trip, so commands still arrive before their tick when the ping wobbles.
const BUFFER_TICKS = 2;
const SAMPLES = 9;

/**
 * Estimates the server's tick from ping replies, and the tick the client should run on:
 * far enough ahead that a command tagged with it reaches the server before the server gets there.
 */
export class ClockSync {
  private rtts: number[] = [];
  private anchor: { tick: number; at: number } | null = null;

  get ready(): boolean {
    return this.anchor !== null;
  }

  /** Round trip in seconds: the median of recent samples, so one slow reply doesn't move it. */
  get rtt(): number {
    if (!this.rtts.length) return 0;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  onPong(serverTick: number, sentAt: number, now: number): void {
    this.rtts.push(now - sentAt);
    if (this.rtts.length > SAMPLES) this.rtts.shift();
    // The server stamped the reply about half a round trip ago.
    this.anchor = { tick: serverTick + this.rtt / 2 / DT, at: now };
  }

  /** The server's tick right now (fractional). */
  serverTick(now: number): number {
    if (!this.anchor) return 0;
    return this.anchor.tick + (now - this.anchor.at) / DT;
  }

  /** The tick the client should be on right now (fractional). */
  targetTick(now: number): number {
    return this.serverTick(now) + this.rtt / 2 / DT + BUFFER_TICKS;
  }
}
