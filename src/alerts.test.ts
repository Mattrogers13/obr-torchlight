import { describe, it, expect, vi, beforeEach } from "vitest";
import OBR from "@owlbear-rodeo/sdk";

import { LIGHT_OUT_CHANNEL, TIME_PASSES_CHANNEL, listenForAlerts, parseTimePasses, timePassesMessage } from "./alerts";

vi.mock("@owlbear-rodeo/sdk", () => ({
  default: {
    broadcast: { onMessage: vi.fn(() => () => {}), sendMessage: vi.fn(async () => {}) },
    notification: { show: vi.fn(async () => "id") },
  },
}));

describe("alerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("words Time passes", () => {
    expect(timePassesMessage(1)).toBe("1 minute passes.");
    expect(timePassesMessage(10)).toBe("10 minutes pass.");
    expect(timePassesMessage(60)).toBe("1 hour passes.");
    expect(timePassesMessage(120)).toBe("2 hours pass.");
  });

  it("only accepts a sane minute count from a broadcast", () => {
    expect(parseTimePasses(30)).toBe(30);
    for (const bad of [0, -5, 1.5, 99999, "30", null, [30]]) expect(parseTimePasses(bad)).toBeNull();
  });

  it("shows one notification per broadcast", () => {
    listenForAlerts();
    const handler = (channel: string) =>
      vi.mocked(OBR.broadcast.onMessage).mock.calls.find(([c]) => c === channel)![1] as (e: { data: unknown }) => void;
    handler(LIGHT_OUT_CHANNEL)({ data: ["Kira's torch"] });
    handler(TIME_PASSES_CHANNEL)({ data: 10 });
    handler(TIME_PASSES_CHANNEL)({ data: "junk" });
    expect(vi.mocked(OBR.notification.show).mock.calls).toEqual([
      ["Kira's torch went out!", "WARNING"],
      ["10 minutes pass.", "INFO"],
    ]);
  });
});
