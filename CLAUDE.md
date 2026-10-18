# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Torchlight (a customized copy of Shadow Crawler by Alvaro Cavalcanti, MIT) is an Owlbear Rodeo extension for running the Crawling phase of the Shadowdark RPG. It's a React-based popover plugin that tracks torch and light source timers (real-time or turns) during dungeon crawling sessions.

Standalone repo (github.com/Mattrogers13/obr-torchlight), not a fork. Never pull from or PR to upstream `alvarocavalcanti/shadowcrawler`. Keep `LICENSE` and the credit lines (README, About, homepage, manifest). Keep the "Coded with AI (Claude Code)" line in README, About and homepage.

`sources/` (gitignored, local only) holds reference material: the Shadowdark core rules PDF (`sources/PDF/`, copyrighted, never commit it) and upstream Shadow Crawler build logs. Light source rules are on pp. 34, 64 and 84.

## Development Commands

```bash
# Install dependencies
npm install

# Start dev server (runs on localhost with CORS enabled)
npm run dev

# Type check TypeScript files (no build output)
npx tsc --noEmit

# Run tests (vitest + jsdom)
npm test

# Validate Cloudflare config / serve dist/ like production
npx wrangler deploy --dry-run
npx wrangler dev --port 8799

# Build for production (compiles TypeScript and builds with Vite)
npm run build

# Preview production build
npm run preview
```

There is no ESLint configured — "linting" for this project means running `tsc --noEmit`.

Node 24 required (`.node-version`, fnm auto-switches on cd). Node 25+ breaks vitest: Node's global `localStorage` shadows jsdom's. Non-interactive shells: `eval "$(fnm env --shell zsh)" && fnm use` first.

Tests mock the OBR SDK in memory (`Main.test.tsx`: room metadata, broadcast, notification). SDK calls return promises, so mocks must too.

Mock modes: `room.deferWrites` + `flushWrite()` apply, emit and resolve each write in room order (use for sync races); `deferEchoes` only delays echoes. Never `act(() => fnReturningPromise())`: use a block body, or every later test renders empty.

Per-test mock behavior: `vi.spyOn(obj, "fn").mockImplementation(...)`, never assign over a mock. `clearAllMocks` (our `beforeEach`) keeps implementations; `resetAllMocks` restores each `vi.fn`'s own; `restoreAllMocks` does NOT undo a spyOn over a `vi.fn`. Passes alone, fails in the full run = a leaked mock.

A regression test must fail on the old code: `cp file /tmp/x.bak && git show <ref>:file > file`, run it, then `cp` back. Never `git checkout -- file` for this (wipes uncommitted edits).

## Architecture

### Dual-Mode Application

The app has two distinct entry modes controlled by URL parameters:

- **Plugin Mode**: When `?obrref` is present in URL, renders the full plugin wrapped in `<PluginGate>` that waits for Owlbear Rodeo SDK to be ready
- **Homepage Mode**: Without `?obrref`, renders a static homepage for marketing/info purposes

Entry point: `src/main.tsx`

A second page, `background.html` → `src/background.ts` (manifest `background_url: "/background"`; Cloudflare 307s `.html` URLs to the extensionless path), runs while Torchlight is enabled in the room, panel open or not. It registers one "Torchlight" token right-click entry whose embedded submenu is a third page, `menu.html` → `src/menu.ts` (embed url `/menu`, plain DOM, no React): Light torch / Light lantern / Cast Light / Put out light (height `MENU_HEIGHT` in background.ts tracks the row count). Both write through `src/lightFromTokens.ts` (same permission rules as the panel). Keep it free of React imports; metadata keys live in `src/constants.ts` for that reason.

On the GM's client the background page also runs `src/tokenSync.ts`: tokens with an active linked light get that source's Dynamic Fog light plus a badge, and get their previous light back when it stops. Details (light shape, badge regeneration, `planSync`, when it runs): `docs/token-sync.md`. Rules not to break:

- Raster images are WebP (badges lossless, `mime: "image/webp"`). Item images must never be SVG (Chrome draws a black square in Owlbear's canvas). Exception: the manifest icon stays `logo.png` until Owlbear WebP support is confirmed.
- Player docs can be forged: a player's light only reaches a token that is visible and that player could edit (`playerMayLight`), or a tampered doc could light a hidden monster through the GM's client.

The plugin ID `"io.github.mattrogers13.torchlight"` is exported as `ID` from `src/constants.ts` (with the room metadata keys; `components/util/constants.ts` holds only route paths) and prefixes the room metadata key and broadcast channel.

### Owlbear Rodeo Integration

The app uses `@owlbear-rodeo/sdk` for integration with Owlbear Rodeo:

- **Scene Ready Check**: App waits for OBR scene to be ready before rendering main UI (`src/components/App.tsx`)
- **Player Roles**: Detects if user is GM or PLAYER and passes a `player` boolean prop to `Main.tsx`, which renders different views accordingly
- **Theme Sync**: OBR's light/dark theme is applied by toggling the `dark` class on `<html>` in `SPA.tsx`
- **Roles**: `SPA.tsx` renders nothing until `OBR.player.getRole()` resolves, so a player never briefly runs GM logic

Shared state lives in OBR room metadata under `${ID}/state` (see State Management). One broadcast channel:

- `${ID}/light-out`: array of light names that just burned out; sent by a GM client with `destination: "ALL"`, every client shows the notification

Manifest limits: `name` ≤ 45, `description` ≤ 128 chars (enforced by `src/manifest.test.ts`).

docs.owlbear.rodeo is behind a Cloudflare bot check (WebFetch/curl fail). SDK source is readable via `gh api repos/owlbear-rodeo/sdk/contents/...`.

### Routing

Uses `react-router-dom` v6. Routes are defined in `SPA.tsx` with `Navbar.tsx` as the layout wrapper (renders tabs + `<Outlet />`):

- `/` — `Main.tsx` (GM/player game interface)
- `/about` — `About.tsx` (theme selector, homepage link, repo link, credits, version)

Route paths are defined in `src/components/util/constants.ts`.

### Component Structure

- **Main.tsx**: Wiring only: loads room state (`useRoomState`), builds the combined light list, runs the alert hooks, renders `GmPanel` or `PlayerPanel`
- **GmPanel.tsx**: GM view and all GM actions (bulk actions, permissions, add, per-light controls)
- **PlayerPanel.tsx**: Player view: one list (own lights first), add one at a time, remove own if allowed
- **hooks/useGmAlerts.ts**: GM-only alerting (player lit/paused/removed notifications, burn-out detection/record/broadcast) and `useLightOutListener` (everyone)
- **alerts.ts**: the `light-out` broadcast channel, its parser, and `broadcastLightOut`
- **Lights.tsx**: Add-light form, GM light rows, bulk actions, Active-only filter, and the player light list
- **SPA.tsx**: Sets up router, detects player role, syncs OBR theme to `dark` CSS class
- **Navbar.tsx**: Tab navigation (Main / About), renders the `WhatsNew` modal, shows dev mode banner
- **About.tsx**: Hosts `ThemeSelector`, repo link, credit line, and version display (`VERSION` from `src/version.ts`, read from manifest.json at build time; nothing fetches the manifest at runtime). On labeled (dev/preview) builds also renders `DebugInfo.tsx`
- **ThemeSelector.tsx**: UI for switching between the 4 color palettes defined in `src/themes.ts`
- **WhatsNew.tsx**: Modal that shows release highlights when the build's version differs from the one stored in localStorage
- **PlayerView.tsx**: Placeholder view shown to players when GM has not enabled "show to players"
- **Homepage.tsx**: Standalone landing page (non-plugin mode)

### State Management

Timer logic is pure functions in `src/lights.ts` (every time calc takes `now`, epoch ms UTC). Real-time lights store `endsAt` while running and `remainingSec` while paused; remaining time is always computed from the clock, never by counting ticks, so throttled background tabs can't drift. `useNow` only re-renders the display once a second while a light is running.

`src/hooks/useRoomState.ts` syncs two room metadata docs: `${ID}/state` (GM-written shared state) and `${ID}/player/<playerId>` (each player's own, at most 2 lights). Full rules (sync, burn-outs, light states, GM actions): `docs/state-sync.md`. Invariants not to break:

- Everything read from room metadata goes through `parseRoomState` / `parsePlayerDocs`: any client or extension can write it.
- Permissions are client-side only; a tampering client can write any key.
- Staleness is by `writer`/`seq` stamps. Prepare every write with `restamp` (a copied doc that keeps another client's stamp is discarded as that client's echo).
- `rev` is still written for panels on builds up to 2026-10-15.7; remove it after 2026-11-15.
- Never unlock the panel before the first room read lands (an empty state written back wipes the room).
- Multi-player GM actions are one `updateLights` write. Edit with `mapLights`, not `.map`.
- The GM never writes a player's doc just to mark a burn-out (`burnedOut` lives in shared state).
- Room metadata is capped at 16 kB across all extensions.
- For sync bugs, simplify the mechanism rather than add special cases (that cascaded across review rounds), and prefer a real Owlbear test over another review round.

localStorage keys (per browser, not shared). Always go through `src/storage.ts` (`readLocal` / `writeLocal`): localStorage throws in Owlbear's iframe under strict privacy settings, and an unguarded read during render blanks the panel.

- `torchlight-theme` — user's selected color palette (useTheme.ts)
- `torchlight-last-seen-version` — last version seen, drives WhatsNew modal (Navbar.tsx)
- `torchlight-active-only` — "Active lights only" list filter (useActiveOnly.ts)
- `dev-mode` — `"true"` shows the dev banner (`isDevMode` in utils.ts, Navbar.tsx)

### Deployment

Cloudflare Workers static assets via Workers Builds. Push to `main` deploys https://torchlight.editbag.workers.dev; PR branches get `<branch>-torchlight.editbag.workers.dev` previews (URL posted as a PR comment).

Two installs in Owlbear, each added once:

- Live: `https://torchlight.editbag.workers.dev/manifest.json` (named "Torchlight")
- Dev: `https://dev-torchlight.editbag.workers.dev/manifest.json` (the long-lived `dev` branch). Non-main builds rename the manifest to "Torchlight (Dev)" via `WORKERS_CI_BRANCH` (`src/devManifest.ts`, wired in `vite.config.js`).
- Dev builds show `DEV · dev · <sha>` under the version on About. Confirm a deploy with `curl` on `/assets/main-*.js` for that string, and give Matt the sha to check.

- `public/_headers` sets `Access-Control-Allow-Origin: *`. Required: OBR fetches the manifest cross-origin, and Workers send no CORS header by default.
- `wrangler.jsonc` needs `"previews": {}` or `wrangler preview` (PR builds) fails. Previews don't apply the SPA fallback (deep links 404); production does.
- Cloudflare build logs aren't reachable from here (the GitHub check has no log). Ask the user to download it from the dashboard.
- `allowScripts` in package.json denies esbuild/workerd/fsevents install scripts; builds work without them.

### Workflow

- Branch + PR per change; squash-merge after CI and Workers Builds both pass. Features that need in-Owlbear testing stay open until the manual pass (`TESTING.md`).
- To review in Owlbear, rebuild `dev` from main plus the open PR branches and force-push it: `git checkout -B dev origin/main && git merge --no-edit <branches...> && git push -f origin dev`. `dev` is disposable; never PR from it or merge it into main.
- Stacked PRs: `gh pr edit N --base main` before deleting the branch it's based on (deleting a base auto-closes PRs on it). Run multi-step git loops under `bash`, not zsh (no word-splitting of `$var`).
- Versions are dates (`YYYY-MM-DD` in package.json and manifest.json; a second release the same day is `YYYY-MM-DD.1`, then `.2`) and drive the WhatsNew modal (shows on any change, not just newer). Add matching entries to `src/releaseNotes.ts` and `RELEASE-NOTES.md`.

### Theming

Two independent layers:

1. **OBR color mode** (`light` / `dark`): controlled by Owlbear Rodeo. Applied by toggling the `dark` class on `<html>`, enabling Tailwind's `dark:` variants.
2. **Color palette**: 4 user-selectable themes defined in `src/themes.ts` (`dark-fantasy`, `modern-saas`, `gaming-vibrant`, `earthy-dungeon`). The active theme is applied as CSS custom properties (`--color-bg`, `--color-primary`, etc.) on `:root` by `src/hooks/useTheme.ts`. Components use these via Tailwind's `bg-[var(--color-bg)]` syntax or direct `style` props.

### Icons

Inline SVG only (no icon library). Right-click menu and token badge icons live in `public/img/`. The toolbar action icon reuses the white `torch-menu.svg`. The logo source is `art/icon/logo.svg`: copy it to `public/img/logo.svg` (favicon) and render `public/img/logo.png` (manifest icon) at 256×256 with headless Chrome, as for badges. No upstream Shadow Crawler artwork remains; don't reintroduce it.

### Analytics

None. The upstream Google Analytics tag was removed; don't add tracking without asking.
