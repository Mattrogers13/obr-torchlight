import { describe, it, expect } from "vitest";
import manifest from "../public/manifest.json";
import { manifestForBranch } from "./devManifest";

describe("manifestForBranch", () => {
  it("leaves main and local builds alone", () => {
    expect(manifestForBranch(manifest, "main")).toBe(manifest);
    expect(manifestForBranch(manifest, undefined)).toBe(manifest);
    expect(manifestForBranch(manifest, "")).toBe(manifest);
  });

  it("labels every other branch as Dev, within Owlbear's name limit", () => {
    const dev = manifestForBranch(manifest, "dev");
    expect(dev.name).toBe("Torchlight (Dev)");
    expect(dev.action.title).toBe("Torchlight (Dev)");
    expect(dev.name.length).toBeLessThanOrEqual(45);
    expect(dev.version).toBe(manifest.version);
    expect(manifest.name).toBe("Torchlight");
  });
});
