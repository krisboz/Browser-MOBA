import { StrictMode, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { serverUrl } from "./config.js";
import { Game } from "./game/game.js";
import { hudActions, hudStore, useHud, type HudState } from "./store.js";

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

function AbilityBar({ abilities, lockedUntil }: { abilities: HudState["abilities"]; lockedUntil: number }) {
  return (
    <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, pointerEvents: "none" }}>
      {abilities.map((a, i) => {
        const ready = a.cooldown <= 0 && !a.locked;
        return (
          <div
            key={a.slot}
            style={{
              width: 76,
              height: 58,
              marginLeft: i === 4 ? 14 : 0,
              position: "relative",
              overflow: "hidden",
              background: "#1e272e",
              border: `2px solid ${ready ? "#9fe870" : "#455a64"}`,
              borderRadius: 6,
              color: "#eceff1",
              font: "11px ui-monospace, monospace",
              textAlign: "center",
            }}
          >
            {/* The dark overlay shrinks as the cooldown runs out. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: `${a.locked ? 100 : ready ? 0 : Math.min(100, (100 * a.cooldown) / a.max)}%`,
                background: "rgba(0,0,0,0.55)",
              }}
            />
            <div style={{ position: "relative", fontWeight: "bold", fontSize: 16, marginTop: 4 }}>
              {a.locked ? a.slot : ready ? a.slot : Math.ceil(a.cooldown)}
            </div>
            <div style={{ position: "relative", marginTop: 4 }}>{a.locked ? `level ${lockedUntil}` : a.name}</div>
          </div>
        );
      })}
    </div>
  );
}

const panel: CSSProperties = {
  background: "rgba(20,27,32,0.9)",
  border: "1px solid #455a64",
  borderRadius: 6,
  color: "#eceff1",
  font: "12px ui-monospace, monospace",
  padding: 8,
};

/** Gold, level and experience, and what you own, just left of the ability bar. */
function Economy({ hud }: { hud: HudState }) {
  const maxed = hud.level >= hud.maxLevel;
  const names = new Map(hud.shop.map((i) => [i.id, i.name]));
  return (
    <div style={{ ...panel, position: "fixed", bottom: 16, left: 16, width: 220, pointerEvents: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: "bold" }}>
        <span style={{ color: "#ffd54f" }} data-testid="gold">
          {hud.gold} g
        </span>
        <span data-testid="level">level {hud.level}</span>
      </div>
      <div style={{ marginTop: 6, height: 6, background: "#263238", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${maxed ? 100 : (100 * hud.xp) / hud.xpPerLevel}%`, height: "100%", background: "#9fe870" }} />
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        {Array.from({ length: hud.itemSlots }, (_, i) => (
          <div
            key={i}
            title={hud.items[i] ? names.get(hud.items[i]!) : "empty"}
            style={{ flex: 1, height: 28, border: "1px solid #455a64", borderRadius: 3, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", background: hud.items[i] ? "#37474f" : "transparent" }}
          >
            {hud.items[i] ? names.get(hud.items[i]!)?.slice(0, 5) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The shop: open while you stand in your base or wait to respawn. P toggles it anywhere, to look. */
function Shop({ hud, open }: { hud: HudState; open: boolean }) {
  if (!open && !hud.canShop) return null;
  const full = hud.items.length >= hud.itemSlots;
  return (
    <div style={{ ...panel, position: "fixed", bottom: 110, left: 16, width: 220, pointerEvents: "auto" }}>
      <div style={{ fontWeight: "bold", marginBottom: 6 }}>
        shop {hud.canShop ? "" : "(go back to base to buy)"}
      </div>
      {hud.shop.map((item) => {
        const can = hud.canShop && !full && hud.gold >= item.cost;
        return (
          <button
            key={item.id}
            disabled={!can}
            onClick={() => hudActions.buy(item.id)}
            data-testid={`buy-${item.id}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              marginBottom: 3,
              font: "inherit",
              cursor: can ? "pointer" : "default",
              background: can ? "#2e7d32" : "#263238",
              color: can ? "#fff" : "#78909c",
              border: "1px solid #455a64",
              borderRadius: 3,
              padding: "3px 6px",
            }}
          >
            <span>
              {item.name} <span style={{ opacity: 0.75 }}>{item.gives}</span>
            </span>
            <span style={{ color: can ? "#ffd54f" : undefined }}>{item.cost}</span>
          </button>
        );
      })}
    </div>
  );
}

function Hud() {
  const hud = useHud();
  const [shopOpen, setShopOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p" && !e.repeat) setShopOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
        <div style={{ marginTop: 6 }}>right click: walk or attack · Q W E R, D F: cast at the cursor · S: stop (cancels a wind-up) · P: shop</div>
      </div>

      <AbilityBar abilities={hud.abilities} lockedUntil={hud.ultimateLevel} />
      <Economy hud={hud} />
      <Shop hud={hud} open={shopOpen} />

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
