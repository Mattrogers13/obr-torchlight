import { describe, it, expect, vi } from "vitest";

vi.mock("@owlbear-rodeo/sdk", () => ({ default: {}, buildImage: vi.fn() }));

import { createLight, setAsideLight, pause } from "./lights";
import { desiredSources, dfLight, planSync, rangePx } from "./tokenSync";

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

  it("lights tokens with an active linked light, including one paused for a break", () => {
    const want = desiredSources([on("a"), pause(on("b", "lantern"), T0 + 1000)], T0 + 2000);
    expect([...want]).toEqual([["a", "torch"], ["b", "lantern"]]);
  });

  it("skips lights that are swapped out, put out, burned out, or not on a token", () => {
    const lights = [
      setAsideLight(on("a"), T0, "swap"),
      setAsideLight(on("b"), T0, "put-out"),
      on("c"),
      createLight("free", "L", "time", 60, T0),
    ];
    expect([...desiredSources(lights, T0 + 61 * 60_000)]).toEqual([]);
    expect([...desiredSources(lights, T0)]).toEqual([["c", "torch"]]);
  });

  it("prefers the longer range when two lights share a token", () => {
    expect(desiredSources([on("a", "torch"), on("a", "lantern")], T0).get("a")).toBe("lantern");
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
      [{ id: "badge", attachedTo: "a", source: "torch" }],
      px,
    );
    expect(plan.restore).toEqual([{ tokenId: "a", saved: threeFoot }]);
    expect(plan.deleteBadges).toEqual(["badge"]);
  });

  it("does nothing when the token already matches", () => {
    const plan = planSync(
      new Map([["a", "torch"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch" }],
      px,
    );
    expect(plan).toEqual({ apply: [], restore: [], addBadges: [], deleteBadges: [] });
  });

  it("switching torch to lantern keeps the original saved light and swaps the badge", () => {
    const plan = planSync(
      new Map([["a", "lantern"]]),
      [{ id: "a", dfLight: dfLight(900), marker: { saved: threeFoot, source: "torch" } }],
      [{ id: "badge", attachedTo: "a", source: "torch" }],
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
      [{ id: "badge", attachedTo: "a", source: "torch" }],
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
        { id: "b1", attachedTo: "a", source: "torch" },
        { id: "b2", attachedTo: "a", source: "torch" },
        { id: "b3", attachedTo: "gone", source: "torch" },
        { id: "b4", attachedTo: undefined, source: undefined },
      ],
      px,
    );
    expect(plan.deleteBadges).toEqual(["b2", "b3", "b4"]);
    expect(plan.addBadges).toEqual([]);
  });

  it("ignores lights whose token isn't in this scene", () => {
    const plan = planSync(new Map([["elsewhere", "torch"]]), [], [], px);
    expect(plan).toEqual({ apply: [], restore: [], addBadges: [], deleteBadges: [] });
  });
});
