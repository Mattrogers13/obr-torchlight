import { describe, it, expect } from "vitest";
import {
  LIMITS,
  adjustTime,
  adjustTurns,
  cleanName,
  createLight,
  formatClock,
  isOut,
  isRunning,
  nextDefaultName,
  parsePlayerDoc,
  parseRoomState,
  pause,
  replacePlayerLight,
  snuff,
  remainingSec,
  reset,
  resume,
} from "./lights";

const T0 = Date.UTC(2026, 9, 12, 20, 0, 0);

describe("real-time lights", () => {
  it("starts burning with the full duration", () => {
    const light = createLight("a", "Torch", "time", 60, T0);
    expect(isRunning(light)).toBe(true);
    expect(remainingSec(light, T0)).toBe(3600);
    expect(remainingSec(light, T0 + 90_000)).toBe(3510);
  });

  it("computes remaining time from the clock, not ticks", () => {
    const light = createLight("a", "Torch", "time", 60, T0);
    // A throttled tab that wakes up 59 minutes later still sees the right value.
    expect(remainingSec(light, T0 + 59 * 60_000)).toBe(60);
  });

  it("clamps duration to the allowed range", () => {
    expect(createLight("a", "x", "time", 0, T0).durationSec).toBe(LIMITS.minMinutes * 60);
    expect(createLight("a", "x", "time", 99999, T0).durationSec).toBe(LIMITS.maxMinutes * 60);
  });

  it("pauses and resumes without losing time", () => {
    const lit = createLight("a", "Torch", "time", 60, T0);
    const paused = pause(lit, T0 + 600_000);
    expect(isRunning(paused)).toBe(false);
    // Time passing while paused doesn't burn the torch.
    expect(remainingSec(paused, T0 + 10_000_000)).toBe(3000);
    const resumed = resume(paused, T0 + 10_000_000);
    expect(remainingSec(resumed, T0 + 10_000_000 + 1000)).toBe(2999);
  });

  it("burns out at zero and never goes negative", () => {
    const light = createLight("a", "Torch", "time", 1, T0);
    expect(isOut(light, T0 + 59_000)).toBe(false);
    expect(isOut(light, T0 + 60_000)).toBe(true);
    expect(remainingSec(light, T0 + 999_999_999)).toBe(0);
  });

  it("never shows more time than the light's duration", () => {
    const light = { ...createLight("a", "Torch", "time", 60, T0), endsAt: T0 + 1e12 };
    expect(remainingSec(light, T0)).toBe(3600);
  });

  it("won't resume a light with no time left", () => {
    const out = pause(createLight("a", "Torch", "time", 1, T0), T0 + 120_000);
    expect(resume(out, T0 + 130_000).endsAt).toBeNull();
  });

  it("reset returns to full, paused, and re-arms the alert", () => {
    const out = { ...pause(createLight("a", "Torch", "time", 1, T0), T0 + 120_000), alerted: true };
    const fresh = reset(out);
    expect(isRunning(fresh)).toBe(false);
    expect(remainingSec(fresh, T0)).toBe(60);
    expect(fresh.alerted).toBe(false);
  });

  it("adds and removes time while running or paused", () => {
    const lit = createLight("a", "Torch", "time", 60, T0);
    const t = T0 + 600_000; // 50:00 left
    const less = adjustTime(lit, -5 * 60, t);
    expect(isRunning(less)).toBe(true);
    expect(remainingSec(less, t)).toBe(45 * 60);
    expect(remainingSec(less, t + 1000)).toBe(45 * 60 - 1);

    const paused = adjustTime(pause(lit, t), 60, t);
    expect(isRunning(paused)).toBe(false);
    expect(remainingSec(paused, t + 10_000_000)).toBe(51 * 60);
  });

  it("adding past full stretches the duration", () => {
    const lit = createLight("a", "Torch", "time", 60, T0);
    const more = adjustTime(lit, 10 * 60, T0);
    expect(more.durationSec).toBe(70 * 60);
    expect(remainingSec(more, T0)).toBe(70 * 60);
    expect(adjustTime(lit, 1e9, T0).durationSec).toBe(LIMITS.maxMinutes * 60);
  });

  it("taking away more than is left burns it out without going negative", () => {
    const lit = createLight("a", "Torch", "time", 5, T0);
    const out = adjustTime(lit, -10 * 60, T0);
    expect(remainingSec(out, T0)).toBe(0);
    expect(isOut(out, T0)).toBe(true);
  });

  it("adding time to a burned-out light re-arms the alert", () => {
    const out = { ...pause(createLight("a", "Torch", "time", 1, T0), T0 + 120_000), alerted: true };
    const relit = adjustTime(out, 60, T0 + 130_000);
    expect(isOut(relit, T0 + 130_000)).toBe(false);
    expect(relit.alerted).toBe(false);
    expect(adjustTime(out, -60, T0).alerted).toBe(true);
  });

  it("leaves turn lights alone", () => {
    const turns = createLight("a", "Torch", "turns", 6, T0);
    expect(adjustTime(turns, 600, T0)).toBe(turns);
  });
});

describe("turn lights", () => {
  it("burns turns and goes out at the max", () => {
    let light = createLight("b", "Lantern", "turns", 3, T0);
    expect(isRunning(light)).toBe(false);
    light = adjustTurns(adjustTurns(light, 1), 1);
    expect(isOut(light, T0)).toBe(false);
    light = adjustTurns(light, 1);
    expect(isOut(light, T0)).toBe(true);
  });

  it("clamps turns between 0 and the max", () => {
    const light = createLight("b", "Lantern", "turns", 3, T0);
    expect(adjustTurns(light, -5).turnsUsed).toBe(0);
    expect(adjustTurns(light, 50).turnsUsed).toBe(3);
  });

  it("stepping back from burned out re-arms the alert", () => {
    const out = { ...adjustTurns(createLight("b", "L", "turns", 2, T0), 2), alerted: true };
    expect(adjustTurns(out, -1).alerted).toBe(false);
  });

  it("clamps turn count to the allowed range", () => {
    expect(createLight("b", "x", "turns", 0, T0).maxTurns).toBe(LIMITS.minTurns);
    expect(createLight("b", "x", "turns", 5000, T0).maxTurns).toBe(LIMITS.maxTurns);
  });
});

describe("names and formatting", () => {
  it("falls back to a default name and trims long ones", () => {
    expect(cleanName("   ", "Light 1")).toBe("Light 1");
    expect(cleanName("x".repeat(100), "L")).toHaveLength(LIMITS.maxNameLength);
  });

  it("picks the next unused default name", () => {
    const a = createLight("a", "Light 2", "time", 60, T0);
    expect(nextDefaultName([a])).toBe("Light 3");
    expect(nextDefaultName([])).toBe("Light 1");
  });

  it("formats clocks with and without hours", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(5)).toBe("0:05");
  });
});

describe("parseRoomState (untrusted metadata)", () => {
  const valid = createLight("ok", "Torch", "time", 60, T0);

  it("returns empty state for missing or non-object data", () => {
    for (const raw of [undefined, null, 42, "x", [], true]) {
      expect(parseRoomState(raw)).toEqual({
        rev: 0, lights: [], showToPlayers: false, playersCanAdd: false, playersCanRemove: false,
      });
    }
  });

  it("round-trips valid state", () => {
    const state = { rev: 7, lights: [valid], showToPlayers: true, playersCanAdd: true, playersCanRemove: false };
    expect(parseRoomState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("drops malformed lights and keeps the good ones", () => {
    const bad = [
      null,
      "torch",
      { ...valid, id: "" },
      { ...valid, id: "x".repeat(65) },
      { ...valid, name: 7 },
      { ...valid, kind: "lava" },
      { ...valid, durationSec: "3600" },
      { ...valid, remainingSec: NaN },
      { ...valid, endsAt: "soon" },
      { ...valid, endsAt: Infinity },
      { id: "t", name: "T", kind: "turns", maxTurns: null, turnsUsed: 0 },
    ];
    const state = parseRoomState({ lights: [...bad, valid] });
    expect(state.lights.map((l) => l.id)).toEqual(["ok"]);
  });

  it("clamps out-of-range numbers", () => {
    const state = parseRoomState({
      lights: [
        { ...valid, durationSec: 60, remainingSec: 99999 },
        { id: "t", name: "T", kind: "turns", maxTurns: 10, turnsUsed: 50, alerted: false },
      ],
    });
    expect(state.lights[0].remainingSec).toBe(60);
    expect(state.lights[1].turnsUsed).toBe(10);
  });

  it("drops leftover fields from older versions", () => {
    const state = parseRoomState({ lights: [], crawlTurns: 4, encounterRoll: 1 });
    expect(state).not.toHaveProperty("crawlTurns");
    expect(state).not.toHaveProperty("encounterRoll");
  });

  it("drops duplicate ids and caps the light count", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...valid, id: `l${i}` }));
    expect(parseRoomState({ lights: many }).lights).toHaveLength(LIMITS.maxLights);
    expect(parseRoomState({ lights: [valid, valid] }).lights).toHaveLength(1);
  });

  it("truncates oversized names", () => {
    const state = parseRoomState({ lights: [{ ...valid, name: "x".repeat(500) }] });
    expect(state.lights[0].name).toHaveLength(LIMITS.maxNameLength);
  });
});

describe("parsePlayerDoc (untrusted metadata)", () => {
  const valid = createLight("ok", "Torch", "time", 60, T0);

  it("returns an empty doc for junk", () => {
    for (const raw of [undefined, null, 42, "x", []]) {
      expect(parsePlayerDoc(raw)).toEqual({ rev: 0, ownerName: "", lights: [] });
    }
  });

  it("caps player lights and cleans the owner name", () => {
    const lights = ["a", "b", "c", "d", "e"].map((id) => ({ ...valid, id }));
    const doc = parsePlayerDoc({ rev: 2, ownerName: "  " + "x".repeat(99), lights });
    expect(doc.lights.map((l) => l.id)).toEqual(["a", "b"]);
    expect(doc.ownerName).toHaveLength(LIMITS.maxNameLength);
    expect(doc.rev).toBe(2);
  });

  it("ignores a non-string owner name", () => {
    expect(parsePlayerDoc({ ownerName: { evil: true } }).ownerName).toBe("");
  });
});

describe("one light per player (rules p.84)", () => {
  const torch = createLight("torch", "Kira's torch", "time", 60, T0);
  const lantern = createLight("lantern", "Kira's lantern", "time", 60, T0 + 600_000);

  it("snuffing pauses the light, keeps its time, and isn't a burn-out", () => {
    const out = snuff(torch, T0 + 600_000);
    expect(out.snuffed).toBe(true);
    expect(isRunning(out)).toBe(false);
    expect(remainingSec(out, T0 + 9e9)).toBe(3000);
    expect(isOut(out, T0 + 9e9)).toBe(false);
  });

  it("lighting a new one snuffs the current one and keeps just the two", () => {
    const lights = replacePlayerLight([torch], lantern, T0 + 600_000);
    expect(lights.map((l) => [l.id, l.snuffed])).toEqual([["torch", true], ["lantern", false]]);

    const spell = createLight("spell", "Light", "time", 60, T0 + 1_200_000);
    const next = replacePlayerLight(lights, spell, T0 + 1_200_000);
    expect(next.map((l) => [l.id, l.snuffed])).toEqual([["lantern", true], ["spell", false]]);
  });

  it("with nothing burning, keeps the most recent old light as is", () => {
    const burnedOut = pause(createLight("old", "Old", "time", 1, T0), T0 + 120_000);
    const lights = replacePlayerLight([burnedOut], lantern, T0 + 600_000);
    expect(lights.map((l) => [l.id, l.snuffed])).toEqual([["old", false], ["lantern", false]]);
    expect(replacePlayerLight([], lantern, T0)).toEqual([lantern]);
  });

  it("relighting or resetting clears snuffed", () => {
    const out = snuff(torch, T0 + 600_000);
    expect(resume(out, T0 + 700_000).snuffed).toBe(false);
    expect(reset(out).snuffed).toBe(false);
  });

  it("reads snuffed from metadata", () => {
    expect(parseRoomState({ lights: [{ ...torch, snuffed: true }] }).lights[0].snuffed).toBe(true);
    expect(parseRoomState({ lights: [{ ...torch, snuffed: "yes" }] }).lights[0].snuffed).toBe(false);
  });
});
