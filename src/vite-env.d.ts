/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set at build time on non-main branches (src/devManifest.ts); "" on live.
  readonly VITE_BUILD_LABEL?: string;
}