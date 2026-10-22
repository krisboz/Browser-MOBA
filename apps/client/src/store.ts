import { useSyncExternalStore } from "react";

/** The only bridge between the game loop and React: the loop writes, the HUD reads. */
export interface HudState {
  status: "connecting" | "connected" | "disconnected";
  error: string | null;
  balanceVersion: number | null;
  fps: number;
  position: { x: number; y: number } | null;
}

let state: HudState = { status: "connecting", error: null, balanceVersion: null, fps: 0, position: null };
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
