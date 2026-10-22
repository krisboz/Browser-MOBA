import { useSyncExternalStore } from "react";

/** The only bridge between the game loop and React: the loop writes, the HUD reads (and sets the lag switch). */
export interface HudState {
  status: "connecting" | "connected" | "disconnected";
  error: string | null;
  balanceVersion: number | null;
  fps: number;
  position: { x: number; y: number } | null;
  /** Measured round trip in ms, including the lag switch. */
  rtt: number;
  /** Largest prediction correction in the last half second, in units. */
  correction: number;
  /** Dev lag switch: extra round-trip delay in ms. */
  addedPing: number;
}

const initialPing = Number(new URLSearchParams(location.search).get("ping")) || 0;

let state: HudState = {
  status: "connecting",
  error: null,
  balanceVersion: null,
  fps: 0,
  position: null,
  rtt: 0,
  correction: 0,
  addedPing: initialPing,
};
const listeners = new Set<() => void>();

export const hudStore = {
  get: () => state,
  set(patch: Partial<HudState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useHud = () => useSyncExternalStore(hudStore.subscribe, hudStore.get);
