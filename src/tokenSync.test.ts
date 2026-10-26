import { describe, it, expect, vi } from "vitest";

vi.mock("@owlbear-rodeo/sdk", () => ({ default: {}, buildImage: vi.fn() }));

import { createLight, setAsideLight, pause } from "./lights";
import { SYNC_RETRY_MS, desiredSources, dfLight, nextSyncDelay, parseDfLight, planSync, playerMayLight, rangePx } from "./tokenSync";

const T0 = Date.UTC(2026, 9, 15, 20, 0, 0);
const DPI = 150;
const px = (source: string) => ({ torch: 900, lantern: 1800, "light-spell": 900 })[source]!;
const threeFoot = { attenuationRadius: 90, sourceRadius: 25, falloff: 0.2, innerAngle: 360, outerAngle: 360 };

describe("rangePx", () => {
  it("converts feet to scene pixels on a 5 ft grid", () => {
    expect(rangePx(30, DPI, "ft", 5)).toBe(900);
    expect(rangePx(60, DPI, "ft", 5)).toBe(1800);
  });

  it("follows the grid scale, and treats non-feet grids as 5 ft cells", () => {
    expect(rangePx(30, DPI, "ft", 10)).toBe(450);
    expect(rangePx(30, DPI, "m", 1.5)).toBe(900);
    expect(rangePx(30, DPI, "ft", 0)).toBe(900);
  });
});

describe("desiredSources", () => {
  const on = (tokenId: string, source: "torch" | "lantern" | "light-spell" = "torch") =>
    createLight(`${tokenId}-${source}`, "L", "time", 60, T0, { tokenId, source });
  const gm = (...lights: ReturnType<typeof on>[]) => lights.map((light) => ({ light, ownerId: null }));

  it("lights tokens with an active linked light, including one paused for a break", () => {
    const want = desiredSources(gm(on("a"), pause(on("b", "lantern"), T0 + 1000)), T0 + 2000);
    expect([...want]).toEqual([["a", "torch"], ["b", "lantern"]]);
  });

  it("skips lights that are swapped out, put out, burned out, or not on a token", () => {
    const lights = gm(
      setAsideLight(on("a"), T0, "swap"),
      setAsideLight(on("b"), T0, "put-out"),
      on("c"),
      createLight("free", "L", "time", 60, T0),
    );
    expect([...desiredSources(lights, T0 + 61 * 60_000)]).toEqual([]);
    expect([...desiredSources(lights, T0)]).toEqual([["c", "torch"]]);
  });

  it("prefers the longer range when two lights share a token", () => {
    expect(desiredSources(gm(on("a", "torch"), on("a", "lantern")), T0).get("a")).toBe("lantern");
  });
});

describe("player lights can't be forged onto other tokens", () => {
  const perms = ["CHARACTER_UPDATE"];
  const mine = { visible: true, createdUserId: "p1" };

  it("allows a visible token the player could edit", () => {
    expect(playerMayLight(mine, "p1", perms)).toBe(true);
    expect(playerMayLight({ ...mine, createdUserId: "gm" }, "p1", perms)).toBe(true);
  });

  it("never lights a hidden token (it would reveal it through the fog)", () => {
    expect(playerMayLight({ ...mine, visible: false }, "p1", perms)).toBe(false);
  });

  it("follows the room's owner-only setting and character permissions", () => {
    const ownerOnly = ["CHARACTER_UPDATE", "CHARACTER_OWNER_ONLY"];
    expect(playerMayLight(mine, "p1", ownerOnly)).toBe(true);
    expect(playerMayLight({ ...mine, createdUserId: "gm" }, "p1", ownerOnly)).toBe(false);
    expect(playerMayLight(mine, "p1", [])).toBe(false);
    expect(playerMayLight(undefined, "p1", perms)).toBe(false);
  });

  it("desiredSources drops a forged player light but keeps the GM's", () => {
    const light = createLight("x", "L", "time", 60, T0, { tokenId: "monster" });
    const owned = [{ light, ownerId: "p1" }];
    const deny = () => false;
    expect(desiredSources(owned, T0, (_t, owner) => owner === null || deny()).size).toBe(0);
    expect(desiredSources([{ light, ownerId: null }], T0, (_t, owner) => owner === null || deny()).size).toBe(1);
  });
});

describe("parseDfLight (token metadata is editable by others)", () => {
  it("keeps only known Dynamic Fog fields", () => {
    expect(parseDfLight({ attenuationRadius: 90, falloff: 0.2, lightType: "PRIMARY", evil: "x".repeat(9999) })).toEqual({
      attenuationRadius: 90, falloff: 0.2, lightType: "PRIMARY",
    });
  });

  it("rejects junk", () => {
    for (const v of [null, undefined, 3, "x", [], {}, { attenuationRadius: "90" }, { falloff: Infinity }]) {
      expect(parseDfLight(v)).toBeNull();
    }
  });
});

describe("planSync", () => {
  it("lights a token, saving the light it already had (the GM's 3 ft light)", () => {
    const plan = planSync(new Map([["a", "torch"]]), [{ id: "a", dfLight: threeFoot, marker: undefined }], [], px);
    expect(plan.apply).toEqual([{ tokenId: "a", source: "torch", saved: threeFoot }]);
    expect(plan.addBadges).toEqual([{ tokenId: "a", source: "torch" }]);
  });

  it("saves null when the token had no light", () => {
    const plan = planSync(new Map([["a", "torch"]]), [{ id: "a", dfLight: undefined, marker: undefined }], [], px);
    expect(plan.apply[0].saved).toBeNull();
  });

  it("restores the saved light and drops the badge when the light stops", () => {
    const plan = planSync(
      new Map(),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch", image: "" }],
      px,
    );
    expect(plan.restore).toEqual([{ tokenId: "a", saved: threeFoot }]);
    expect(plan.deleteBadges).toEqual(["badge"]);
  });

  it("does nothing when the token already matches", () => {
    const plan = planSync(
      new Map([["a", "torch"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch", image: "" }],
      px,
    );
    expect(plan).toEqual({ apply: [], restore: [], addBadges: [], deleteBadges: [] });
  });

  it("switching torch to lantern keeps the original saved light and swaps the badge", () => {
    const plan = planSync(
      new Map([["a", "lantern"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch", image: "" }],
      px,
    );
    expect(plan.apply).toEqual([{ tokenId: "a", source: "lantern", saved: threeFoot }]);
    expect(plan.deleteBadges).toEqual(["badge"]);
    expect(plan.addBadges).toEqual([{ tokenId: "a", source: "lantern" }]);
  });

  it("reapplies if someone changed the light while it burns", () => {
    const plan = planSync(
      new Map([["a", "torch"]]),
      [{ id: "a", dfLight: threeFoot, marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch", image: "" }],
      px,
    );
    expect(plan.apply).toEqual([{ tokenId: "a", source: "torch", saved: threeFoot }]);
    expect(plan.addBadges).toEqual([]);
  });

  it("cleans up duplicate and orphaned badges", () => {
    const plan = planSync(
      new Map([["a", "torch"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: null, source: "torch" } }],
      [
        { id: "b1", attachedTo: "a", source: "torch", image: "" },
        { id: "b2", attachedTo: "a", source: "torch", image: "" },
        { id: "b3", attachedTo: "gone", source: "torch", image: "" },
        { id: "b4", attachedTo: undefined, source: undefined, image: undefined },
      ],
      px,
    );
    expect(plan.deleteBadges).toEqual(["b2", "b3", "b4"]);
    expect(plan.addBadges).toEqual([]);
  });

  it("replaces a badge whose image is outdated (the old SVG badges)", () => {
    const imageFor = (source: string) => `https://x/img/badge-${source}.png`;
    const plan = planSync(
      new Map([["a", "torch"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: null, source: "torch" } }],
      [{ id: "old", attachedTo: "a", source: "torch", image: "https://x/img/badge-torch.svg" }],
      px,
      imageFor,
    );
    expect(plan.deleteBadges).toEqual(["old"]);
    expect(plan.addBadges).toEqual([{ tokenId: "a", source: "torch" }]);
  });

  it("ignores lights whose token isn't in this scene", () => {
    const plan = planSync(new Map([["elsewhere", "torch"]]), [], [], px);
    expect(plan).toEqual({ apply: [], restore: [], addBadges: [], deleteBadges: [] });
  });
});

describe("nextSyncDelay", () => {
  const linked = (endsAt: number | null) => ({ ...createLight("a", "T", "time", 60, T0, { tokenId: "tok" }), endsAt });

  it("wakes just after the next linked light runs out", () => {
    expect(nextSyncDelay([linked(T0 + 5000)], T0, false)).toBe(5250);
    expect(nextSyncDelay([linked(null)], T0, false)).toBeNull();
  });

  it("caps a forged far-future end time instead of overflowing setTimeout", () => {
    const delay = nextSyncDelay([linked(1e15)], T0, false)!;
    expect(delay).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(delay).toBeGreaterThan(60_000);
  });

  it("retries soon after a failure, even with nothing scheduled", () => {
    expect(nextSyncDelay([linked(T0 + 3_600_000)], T0, true)).toBe(SYNC_RETRY_MS);
    // The first pass failing (nothing known yet) must still retry.
    expect(nextSyncDelay([], T0, true)).toBe(SYNC_RETRY_MS);
  });
});

