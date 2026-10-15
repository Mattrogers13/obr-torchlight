// Build-time only (used by vite.config.js). Cloudflare Workers Builds sets
// WORKERS_CI_BRANCH; any branch other than main is a dev build, and gets a
// different name so it can't be mistaken for the live extension in Owlbear.

export const PRODUCTION_BRANCH = "main";
export const DEV_SUFFIX = " (Dev)";

interface Manifest {
  name: string;
  action: { title: string };
}

const isDevBranch = (branch: string | undefined) => !!branch && branch !== PRODUCTION_BRANCH;

// Shown next to the version on the About tab; "" on live and local builds.
export const buildLabel = (branch: string | undefined, sha: string | undefined) =>
  isDevBranch(branch) ? ["DEV", branch, sha?.slice(0, 7)].filter(Boolean).join(" · ") : "";

export const manifestForBranch = <M extends Manifest>(manifest: M, branch: string | undefined): M =>
  !isDevBranch(branch)
    ? manifest
    : {
        ...manifest,
        name: manifest.name + DEV_SUFFIX,
        action: { ...manifest.action, title: manifest.action.title + DEV_SUFFIX },
      };
