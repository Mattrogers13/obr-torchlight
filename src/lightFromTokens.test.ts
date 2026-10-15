import { describe, it, expect, vi, beforeEach } from "vitest";
import OBR from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "./components/util/constants";
import { lightFromTokens, torchName } from "./lightFromTokens";

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
const gm = { gm: true, playerId: "gm1", playerName: "Matt" };
const kira = { gm: false, playerId: "p1", playerName: "Kira" };
const shared = () => room.metadata[ROOM_KEY] as { rev: number; lights: { name: string; endsAt: number }[] };
const mine = () => room.metadata[playerKey("p1")] as { rev: number; ownerName: string; lights: { name: string }[] };

describe("lightFromTokens (token right-click)", () => {
  beforeEach(() => {
    room.metadata = {};
    vi.clearAllMocks();
  });

  it("names torches after the token", () => {
    expect(torchName("Kira")).toBe("Kira's torch");
    expect(torchName("  ")).toBe("Torch");
    expect(torchName("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it("GM lights a burning 60-minute torch in the shared state", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 4, showToPlayers: true, lights: [] } };
    expect(await lightFromTokens(gm, ["Goblin"], T0)).toBe("Lit Goblin's torch (60 min).");
    expect(shared().rev).toBe(5);
    expect(shared().lights[0]).toMatchObject({ name: "Goblin's torch", endsAt: T0 + 3600_000 });
    expect(shared()).toMatchObject({ showToPlayers: true });
  });

  it("lights one per selected token", async () => {
    await lightFromTokens(gm, ["Kira", "Bo"], T0);
    expect(shared().lights.map((l) => l.name)).toEqual(["Kira's torch", "Bo's torch"]);
  });

  it("player can't light anything unless the GM allows it", async () => {
    expect(await lightFromTokens(kira, ["Kira"], T0)).toMatch(/hasn't allowed/);
    expect(OBR.room.setMetadata).not.toHaveBeenCalled();
  });

  it("player lights into their own doc only", async () => {
    room.metadata = { [ROOM_KEY]: { rev: 2, playersCanAdd: true } };
    await lightFromTokens(kira, ["Kira"], T0);
    expect(mine()).toMatchObject({ rev: 1, ownerName: "Kira", lights: [{ name: "Kira's torch" }] });
    expect(room.metadata[ROOM_KEY]).toEqual({ rev: 2, playersCanAdd: true });
  });

  it("players light one at a time: the new light snuffs the old", async () => {
    room.metadata = { [ROOM_KEY]: { playersCanAdd: true } };
    expect(await lightFromTokens(kira, ["Kira", "Bo"], T0)).toBe("Lit Kira's torch (60 min).");
    expect(mine().lights).toHaveLength(1);
    expect(await lightFromTokens(kira, ["Bo"], T0 + 1000)).toBe(
      "Lit Bo's torch (60 min). Snuffed Kira's torch.",
    );
    expect(await lightFromTokens(kira, ["Ash"], T0 + 2000)).toBe(
      "Lit Ash's torch (60 min). Snuffed Bo's torch.",
    );
    expect(mine().lights.map((l) => l.name)).toEqual(["Bo's torch", "Ash's torch"]);
  });

  it("surfaces a failed save", async () => {
    vi.mocked(OBR.room.setMetadata).mockRejectedValueOnce(new Error("Metadata too large"));
    await expect(lightFromTokens(gm, ["Kira"], T0)).rejects.toThrow("Metadata too large");
  });
});
