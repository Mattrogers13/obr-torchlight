import { describe, it, expect, vi, beforeEach } from "vitest";

const obr = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
  items: [] as Record<string, unknown>[],
  updated: [] as { id: string; metadata: Record<string, unknown> }[],
  added: [] as unknown[],
}));

// Chainable stand-in for the SDK's ImageBuilder.
const builder = (): unknown =>
  new Proxy({}, { get: (_t, prop) => (prop === "build" ? () => ({ built: true }) : () => builder()) });

vi.mock("@owlbear-rodeo/sdk", () => ({
  buildImage: vi.fn(() => builder()),
  default: {
    player: { getRole: vi.fn(async () => "GM") },
    scene: {
      isReady: vi.fn(async () => true),
      grid: { getDpi: vi.fn(async () => 150), getScale: vi.fn(async () => ({ parsed: { unit: "ft", multiplier: 5 } })) },
      items: {
        getItems: vi.fn(async (filter: (item: unknown) => boolean) => obr.items.filter(filter)),
        updateItems: vi.fn(async (ids: string[], update: (drafts: unknown[]) => void) => {
          const drafts = obr.items
            .filter((i) => ids.includes(i.id as string))
            .map((i) => ({ id: i.id as string, metadata: { ...(i.metadata as object) } }));
          update(drafts);
          obr.updated.push(...drafts);
        }),
        addItems: vi.fn(async (items: unknown[]) => {
          obr.added.push(...items);
        }),
        deleteItems: vi.fn(async () => {}),
      },
    },
    room: {
      getMetadata: vi.fn(async () => obr.metadata),
      getPermissions: vi.fn(async () => ["CHARACTER_UPDATE"]),
    },
  },
}));

import OBR from "@owlbear-rodeo/sdk";
import { ROOM_KEY, playerKey } from "./constants";
import { createLight } from "./lights";
import { DF_LIGHT_KEY, TOKEN_KEY, syncOnce } from "./tokenSync";

const token = (id: string, extra: Record<string, unknown> = {}) => ({
  id, layer: "CHARACTER", visible: true, createdUserId: "gm", metadata: {},
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, ...extra,
});

describe("syncOnce (mocked Owlbear)", () => {
  beforeEach(() => {
    obr.updated = [];
    obr.added = [];
    vi.clearAllMocks();
  });

  it("lights the GM's token, skips a forged light on a hidden token, in two rounds of calls", async () => {
    const now = Date.now();
    obr.metadata = {
      [ROOM_KEY]: { lights: [createLight("g", "T", "time", 60, now, { tokenId: "eric" })] },
      [playerKey("p1")]: { rev: 1, lights: [createLight("f", "F", "time", 60, now, { tokenId: "monster" })] },
    };
    obr.items = [
      token("eric", { metadata: { [DF_LIGHT_KEY]: { attenuationRadius: 90, sourceRadius: 25 } } }),
      token("monster", { visible: false }),
    ];

    await syncOnce();

    expect(obr.updated.map((d) => d.id)).toEqual(["eric"]);
    expect(obr.updated[0].metadata[DF_LIGHT_KEY]).toMatchObject({ attenuationRadius: 900, falloff: 0.2 });
    expect(obr.updated[0].metadata[TOKEN_KEY]).toEqual({
      saved: { attenuationRadius: 90, sourceRadius: 25 },
      source: "torch",
    });
    expect(obr.added).toHaveLength(1);
    // Items fetched once for tokens and badges together.
    expect(OBR.scene.items.getItems).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a player client", async () => {
    vi.mocked(OBR.player.getRole).mockResolvedValueOnce("PLAYER");
    obr.items = [token("eric")];
    await syncOnce();
    expect(OBR.scene.items.getItems).not.toHaveBeenCalled();
  });
});
