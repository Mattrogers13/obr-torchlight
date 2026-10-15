import { describe, it, expect } from "vitest";
import manifest from "../public/manifest.json";

// Owlbear Rodeo rejects the install if these are exceeded:
// https://docs.owlbear.rodeo/extensions/reference/manifest
describe("manifest.json", () => {
  it("fits Owlbear Rodeo's field limits", () => {
    expect(manifest.name.length).toBeLessThanOrEqual(45);
    expect(manifest.description.length).toBeLessThanOrEqual(128);
  });

  it("has the fields Owlbear Rodeo needs to load the extension", () => {
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.version).toBeTruthy();
    expect(manifest.action.popover).toBe("/");
    // The token right-click menu lives in the background page.
    // Cloudflare serves pages without .html (background.html 307s to /background).
    expect(manifest.background_url).toBe("/background");
  });
});
