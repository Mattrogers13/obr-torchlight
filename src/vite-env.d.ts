/// <reference types="vite/client" />
declare module 'remarkable-react';

interface ImportMetaEnv {
  // Set at build time on non-main branches (src/devManifest.ts); "" on live.
  readonly VITE_BUILD_LABEL?: string;
}