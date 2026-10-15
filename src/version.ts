import manifest from "../public/manifest.json";

// Read at build time, so nothing needs to fetch manifest.json at runtime.
export const VERSION = manifest.version;
