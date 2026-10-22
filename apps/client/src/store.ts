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
  preset: string | null;
  presets: string[];
  mySide: 0 | 1 | null;
  score: [number, number];
  winner: 0 | 1 | null;
  /** Seconds until you respawn, while dead. */
  respawnIn: number | null;
  hasDummy: boolean;
  /** Your ability bar. */
  abilities: { slot: string; name: string; cooldown: number; max: number }[];
}

const params = new URLSearchParams(location.search);
export const urlPreset = params.get("preset") ?? undefined;

let state: HudState = {
  status: "connecting",
  error: null,
  balanceVersion: null,
  fps: 0,
  position: null,
  rtt: 0,
  correction: 0,
  addedPing: Number(params.get("ping")) || 0,
  preset: null,
  presets: [],
  mySide: null,
  score: [0, 0],
  winner: null,
  respawnIn: null,
  hasDummy: false,
  abilities: [],
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

/** Actions the HUD can ask of the game. The game fills these in when it starts. */
export const hudActions = {
  dummy: (_action: "reset" | "patrol") => {},
};

export const useHud = () => useSyncExternalStore(hudStore.subscribe, hudStore.get);
