import { StrictMode, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { serverUrl } from "./config.js";
import { Game } from "./game/game.js";
import { hudActions, hudStore, useHud } from "./store.js";

const PING_OPTIONS = [0, 80, 150, 250];
const SIDE_NAMES = ["Blue", "Red"];

function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const game = new Game(ref.current!, serverUrl);
    return () => game.destroy();
  }, []);
  return <canvas ref={ref} />;
}

function Button({ active = false, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        font: "inherit",
        marginRight: 4,
        cursor: "pointer",
        background: active ? "#9fe870" : "#263238",
        color: active ? "#0e1116" : "#cfd8dc",
        border: "1px solid #455a64",
        borderRadius: 3,
      }}
    >
      {children}
    </button>
  );
}

/** Reloads with a different preset, keeping the other URL settings. */
function switchPreset(id: string) {
  const url = new URL(location.href);
  url.searchParams.set("preset", id);
  location.href = url.toString();
}

const row: CSSProperties = { marginTop: 6, pointerEvents: "auto" };

function Hud() {
  const hud = useHud();
  return (
    <>
      <div style={{ position: "fixed", top: 8, left: 8, color: "#cfd8dc", font: "12px ui-monospace, monospace", pointerEvents: "none" }}>
        <div>{hud.status}{hud.error ? `: ${hud.error}` : ""}</div>
        <div>balance v{hud.balanceVersion ?? "?"} · {hud.fps} fps · ping {hud.rtt} ms</div>
        {hud.position && <div data-testid="position">x {hud.position.x} y {hud.position.y}</div>}
        <div>correction {hud.correction}</div>
        <div style={row}>
          lag switch{" "}
          {PING_OPTIONS.map((ms) => (
            <Button key={ms} active={hud.addedPing === ms} onClick={() => hudStore.set({ addedPing: ms })}>
              +{ms} ms
            </Button>
          ))}
        </div>
        <div style={row}>
          preset{" "}
          {hud.presets.map((id) => (
            <Button key={id} active={hud.preset === id} onClick={() => switchPreset(id)}>
              {id}
            </Button>
          ))}
        </div>
        {hud.hasDummy && (
          <div style={row}>
            dummy <Button onClick={() => hudActions.dummy("reset")}>reset health</Button>
            <Button onClick={() => hudActions.dummy("patrol")}>patrol on/off</Button>
          </div>
        )}
        <div style={{ marginTop: 6 }}>right click: walk or attack · S: stop (cancels a wind-up)</div>
      </div>

      <div style={{ position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", font: "bold 22px ui-monospace, monospace", pointerEvents: "none" }}>
        <span style={{ color: "#4ea8ff" }}>{hud.score[0]}</span>
        <span style={{ color: "#cfd8dc" }}> : </span>
        <span style={{ color: "#ff5d5d" }}>{hud.score[1]}</span>
      </div>

      {(hud.winner !== null || hud.respawnIn !== null) && (
        <div
          style={{
            position: "fixed",
            top: "38%",
            width: "100%",
            textAlign: "center",
            font: "bold 32px ui-monospace, monospace",
            color: "#fff",
            textShadow: "0 2px 6px #000",
            pointerEvents: "none",
          }}
        >
          {hud.winner !== null
            ? `${SIDE_NAMES[hud.winner]} wins${hud.mySide === hud.winner ? " (you)" : ""} · next match in a moment`
            : `respawn in ${hud.respawnIn}`}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameCanvas />
    <Hud />
  </StrictMode>,
);
