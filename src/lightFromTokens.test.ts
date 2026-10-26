import { describe, it, expect, vi, beforeEach } from "vitest";
import OBR from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "./constants";
import { lightFromTokens } from "./lightFromTokens";
import { createLight, lightName } from "./lights";

const room = vi.hoisted(() => ({ metadata: {} as Record<string, unknown> }));

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    room: {
      getMetadata: vi.fn(async () => room.metadata),
      setMetadata: vi.fn(async (update: Record<string, unknown>) => {
        room.metadata = { ...room.metadata, ...update };
      }),
    },
  },
}));

const T0 = Date.UTC(2026, 9, 15, 20, 0, 0);
const tok = (name: string) => ({ id: `tok-${name}`, name });
const gm = { gm: true, playerId: "gm1", playerName: "Matt" };
const kira = { gm: false, playerId: "p1", playerName: "Kira" };
const shared = () =>
  room.metadata[ROOM_KEY] as { writer: string; lights: { name: string; endsAt: number | null; setAside: string | null; tokenId: string }[] };
const mine = () =>
  room.metadata[playerKey("p1")] as { writer: string; ownerName: string; lights: { name: string; setAside: string | null }[] };

describe("lightFromTokens (token right-click)", () => {
  beforeEach(() => {
    room.metadata = {};
    vi.clearAllMocks();
  });

  it("names lights after the token and source", () => {
    expect(lightName("Kira")).toBe("Kira's torch");
    expect(lightName("Kira", "lantern")).toBe("Kira's lantern");
    expect(lightName("Kira", "light-spell")).toBe("Kira's Light spell");
    expect(lightName("  ")).toBe("Torch");
    expect(lightName("  ", "light-spell")).toBe("Light spell");
    expect(lightName("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("GM lights a burning 60-minute torch in the shared state", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 4, showToPlayers: true, lights: [] } };
    expect(await lightFromTokens(gm, [tok("Goblin")], T0)).toBe("Lit Goblin's torch (60 min).");
    expect(shared().writer).toMatch(/^menu-/);
    expect(shared().lights[0]).toMatchObject({ name: "Goblin's torch", endsAt: T0 + 3600_000 });
    expect(shared()).toMatchObject({ showToPlayers: true });
  });

  it("lights one per selected token", async () => {
    await lightFromTokens(gm, [tok("Kira"), tok("Bo")], T0);
    expect(shared().lights.map((l) => l.name)).toEqual(["Kira's torch", "Bo's torch"]);
  });

  it("player can't light anything unless the GM allows it", async () => {
    expect(await lightFromTokens(kira, [tok("Kira")], T0)).toMatch(/hasn't allowed players/);
    expect(OBR.room.setMetadata).not.toHaveBeenCalled();
  });

  it("player lights into their own doc only", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 2, playersCanAdd: true } };
    await lightFromTokens(kira, [tok("Kira")], T0);
    expect(mine()).toMatchObject({ ownerName: "Kira", lights: [{ name: "Kira's torch" }] });
    expect(room.metadata[ROOM_KEY]).toEqual({ rev: 2, playersCanAdd: true });
  });

  it("players light one at a time: the new light pauses the old", async () => {
    room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
    expect(await lightFromTokens(kira, [tok("Kira"), tok("Bo")], T0)).toBe("Lit Kira's torch (60 min).");
    expect(mine().lights).toHaveLength(1);
    expect(await lightFromTokens(kira, [tok("Bo")], T0 + 1000)).toBe(
      "Lit Bo's torch (60 min). Paused Kira's torch.",
    );
    expect(await lightFromTokens(kira, [tok("Ash")], T0 + 2000)).toBe(
      "Lit Ash's torch (60 min). Paused Bo's torch.",
    );
    expect(mine().lights.map((l) => l.name)).toEqual(["Bo's torch", "Ash's torch"]);
  });

  it("surfaces a failed save", async () => {
    vi.mocked(OBR.room.setMetadata).mockRejectedValueOnce(new Error("Metadata too large"));
    await expect(lightFromTokens(gm, [tok("Kira")], T0)).rejects.toThrow("Metadata too large");
  });

  it("GM relighting a token pauses its current light and starts a new one", async () => {
    await lightFromTokens(gm, [tok("Kira")], T0);
    expect(await lightFromTokens(gm, [tok("Kira")], T0 + 60_000)).toBe(
      "Lit Kira's torch (60 min). Paused Kira's torch.",
    );
    expect(shared().lights.map((l) => [l.tokenId, !!l.setAside, l.endsAt === null])).toEqual([
      ["tok-Kira", true, true],
      ["tok-Kira", false, false],
    ]);
    // A third light on the same token keeps just the two.
    await lightFromTokens(gm, [tok("Kira")], T0 + 120_000);
    expect(shared().lights).toHaveLength(2);
  });

  it("GM lighting one token leaves other tokens' lights burning", async () => {
    await lightFromTokens(gm, [tok("Kira"), tok("Bo")], T0);
    await lightFromTokens(gm, [tok("Kira")], T0 + 1000);
    const bo = shared().lights.filter((l) => l.tokenId === "tok-Bo");
    expect(bo).toHaveLength(1);
    expect(bo[0]).toMatchObject({ setAside: null });
  });

  it("GM lighting a token pauses a player's light burning on it", async () => {
    room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
    await lightFromTokens(kira, [tok("Kira")], T0);
    expect(await lightFromTokens(gm, [tok("Kira")], T0 + 1000)).toBe(
      "Lit Kira's torch (60 min). Paused Kira's torch.",
    );
    expect(mine().lights[0]).toMatchObject({ setAside: "swap" });
    expect(mine().writer).toMatch(/^menu-/);
  });

  it("lights a lantern or casts Light from the matching menu item", async () => {
    expect(await lightFromTokens(gm, [tok("Kira")], T0, "lantern")).toBe("Lit Kira's lantern (60 min).");
    expect(await lightFromTokens(gm, [tok("Bo")], T0, "light-spell")).toBe("Lit Bo's Light spell (60 min).");
    const sources = (room.metadata[ROOM_KEY] as { lights: { source: string }[] }).lights.map((l) => l.source);
    expect(sources).toEqual(["lantern", "light-spell"]);
  });

  it("a token skipped at the light limit keeps the player's light burning on it", async () => {
    const full = Array.from({ length: 19 }, (_, i) => ({
      ...createLight(`g${i}`, `G${i}`, "time", 60, T0), tokenId: null,
    }));
    room.metadata = { [ROOM_KEY]: { playersCanAdd: true, lights: full } };
    await lightFromTokens(kira, [tok("Kira")], T0);
    // Room for one more: Bo gets lit, Kira's token is skipped.
    const msg = await lightFromTokens(gm, [tok("Bo"), tok("Kira")], T0 + 1000);
    expect(msg).toContain("1 skipped");
    expect(mine().lights[0]).toMatchObject({ setAside: null });
  });

  it("stamps its writes as its own writer, not the copied panel's", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 3, writer: "panel123", seq: 9, playersCanAdd: true } };
    await lightFromTokens(gm, [tok("Kira")], T0);
    expect((room.metadata[ROOM_KEY] as { writer: string }).writer).toMatch(/^menu-/);
    await lightFromTokens(kira, [tok("Kira")], T0);
    expect((mine() as unknown as { writer: string }).writer).toMatch(/^menu-/);
  });
});

