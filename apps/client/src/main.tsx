import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { serverUrl } from "./config.js";
import { Game } from "./game/game.js";
import { useHud } from "./store.js";

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
      <div>balance v{hud.balanceVersion ?? "?"} · {hud.fps} fps</div>
      {hud.position && <div>x {hud.position.x} y {hud.position.y}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameCanvas />
    <Hud />
  </StrictMode>,
);
