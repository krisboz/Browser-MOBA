import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { serverUrl } from "./config.js";
import { Game } from "./game/game.js";
import { hudStore, useHud } from "./store.js";

const PING_OPTIONS = [0, 80, 150, 250];

function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const game = new Game(ref.current!, serverUrl);
    return () => game.destroy();
  }, []);
  return <canvas ref={ref} />;
}

function Hud() {
  const hud = useHud();
  return (
    <div style={{ position: "fixed", top: 8, left: 8, color: "#cfd8dc", font: "12px ui-monospace, monospace", pointerEvents: "none" }}>
      <div>{hud.status}{hud.error ? `: ${hud.error}` : ""}</div>
      <div>balance v{hud.balanceVersion ?? "?"} · {hud.fps} fps · ping {hud.rtt} ms</div>
      {hud.position && <div data-testid="position">x {hud.position.x} y {hud.position.y}</div>}
      <div>correction {hud.correction}</div>
      <div style={{ marginTop: 6, pointerEvents: "auto" }}>
        lag switch{" "}
        {PING_OPTIONS.map((ms) => (
          <button
            key={ms}
            onClick={() => hudStore.set({ addedPing: ms })}
            style={{
              font: "inherit",
              marginRight: 4,
              cursor: "pointer",
              background: hud.addedPing === ms ? "#9fe870" : "#263238",
              color: hud.addedPing === ms ? "#0e1116" : "#cfd8dc",
              border: "1px solid #455a64",
              borderRadius: 3,
            }}
          >
            +{ms} ms
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameCanvas />
    <Hud />
  </StrictMode>,
);
