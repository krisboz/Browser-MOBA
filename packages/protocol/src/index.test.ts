import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./index.js";

describe("parseClientMessage", () => {
  it("accepts a move command", () => {
    const msg = parseClientMessage(JSON.stringify({ t: "cmd", cmd: { type: "move", seq: 3, tick: 40, to: { x: 10, y: 20 } } }));
    expect(msg).toEqual({ t: "cmd", cmd: { type: "move", seq: 3, tick: 40, to: { x: 10, y: 20 } } });
  });

  it("rejects garbage, unknown commands and non-finite numbers", () => {
    expect(parseClientMessage("not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "cmd", cmd: { type: "win" } }))).toBeNull();
    expect(parseClientMessage('{"t":"cmd","cmd":{"type":"move","seq":1,"tick":0,"to":{"x":1e999,"y":0}}}')).toBeNull();
  });
});
