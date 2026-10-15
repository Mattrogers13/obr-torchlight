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

## Architecture

### Dual-Mode Application

The app has two distinct entry modes controlled by URL parameters:

- **Plugin Mode**: When `?obrref` is present in URL, renders the full plugin wrapped in `<PluginGate>` that waits for Owlbear Rodeo SDK to be ready
- **Homepage Mode**: Without `?obrref`, renders a static homepage for marketing/info purposes

Entry point: `src/main.tsx`

A second page, `background.html` → `src/background.ts` (manifest `background_url: "/background"`; Cloudflare 307s `.html` URLs to the extensionless path), runs while Torchlight is enabled in the room, panel open or not. It registers one "Torchlight" token right-click entry whose embedded submenu is a third page, `menu.html` → `src/menu.ts` (embed url `/menu`, plain DOM, no React): Light torch / Light lantern / Cast Light. Both write through `src/lightFromTokens.ts` (same permission rules as the panel). Keep it free of React imports; metadata keys live in `util/constants.ts` for that reason.

The plugin ID `"io.github.mattrogers13.torchlight"` is exported as `ID` from `src/components/util/constants.ts` and prefixes the room metadata key and broadcast channel.

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

- **Main.tsx**: Core GM/player interface. Reads/writes room state via `useRoomState`, sends burn-out alerts (GM only)
- **Lights.tsx**: Add-light form, GM light rows, and the read-only player light list
- **SPA.tsx**: Sets up router, detects player role, syncs OBR theme to `dark` CSS class
- **Navbar.tsx**: Tab navigation (Main / About), renders the `WhatsNew` modal, shows dev mode banner
- **About.tsx**: Hosts `ThemeSelector`, repo link, credit line, and version display
- **ThemeSelector.tsx**: UI for switching between the 4 color palettes defined in `src/themes.ts`
- **WhatsNew.tsx**: Modal that shows release highlights when the version in `manifest.json` is newer than what's stored in localStorage
- **PluginGate.tsx**: Waits for OBR SDK to be ready before rendering children
- **OBRLoading.tsx**: Loading state shown while OBR initialises
- **SceneNotReady.tsx**: Shown when OBR scene is not yet ready
- **PlayerView.tsx**: Placeholder view shown to players when GM has not enabled "show to players"
- **Homepage.tsx**: Standalone landing page (non-plugin mode)

### State Management

Timer logic is pure functions in `src/lights.ts` (every time calc takes `now`, epoch ms UTC). Real-time lights store `endsAt` while running and `remainingSec` while paused; remaining time is always computed from the clock, never by counting ticks, so throttled background tabs can't drift. `useNow` only re-renders the display once a second while a light is running.

`src/hooks/useRoomState.ts` syncs two kinds of room metadata docs:

- `${ID}/state` (`RoomState`: GM `lights`, `showToPlayers`, `playersCanAdd`, `playersCanRemove`). Only GMs write it.
- `${ID}/player/<playerId>` (`PlayerDoc`: `ownerName`, at most 2 `lights`: the current one and the one last paused). Each player writes only their own; GMs can write any. Separate keys so a player's write can't clobber a GM edit (each key is last-write-wins).

Rules:

- Room metadata is writable by any client and any extension, so everything read goes through `parseRoomState` / `parsePlayerDoc` (drops malformed lights, clamps numbers). Keep it that way.
- Player permissions are enforced client-side only (there's no server). A tampering client could write any key; acceptable for a game table, but don't build anything on the assumption it can't.
- Every write bumps that doc's `rev`; incoming docs with a lower `rev` are ignored (late echoes of our own earlier writes). `resync()` forces past it after a failed save.
- Room metadata is capped at 16kB total across all extensions. Limits in `LIMITS` (20 GM lights, 2 per player, 40-char names) keep us small; failed writes show an error and resync.
- Burn-out alerts fire once per light, player lights included: the GM client detects them and sets `alerted` in the owning doc. A light that burned out while no GM panel was open alerts when a GM next opens it.
- Players carry one light at a time (rules p.84, "extinguish all old light sources"): `replacePlayerLight` sets the current light aside (`setAside: "swap"`: paused, keeps its time, shown as "Paused") and drops anything older. Set aside isn't out: no burn-out alert, and Resume all skips it. The UI says "pause"; the code says "set aside" to keep it distinct from an ordinary GM pause.
- Same rule per token (`replaceTokenLight`, `Light.tokenId`): a right-click on a token sets aside whatever is burning on it, the GM's or a player's.
- `Light.source` is `torch` / `lantern` / `light-spell`; `SOURCES` in `lights.ts` holds label, range (30 / 60 / 30 ft) and minutes from the core rules. Old lights without a source read as torches.
- GM "Put out…" sets checked lights aside with `setAside: "put-out"` (shown "Put out", keeps its time, Resume all skips it) and sends the `light-out` broadcast. Flames are pre-checked, Light spells not (rules p.110). "Remove all" clears the shared state and every player doc.
- Known limitation: two writers editing the same doc at the same instant is last-write-wins.
- GM notifications for player activity (lit / removed) come from the GM client diffing light ids against the previous render, not from a broadcast. Lights present at first load and the GM's own removals don't alert.

localStorage keys (per browser, not shared):

- `torchlight-theme` — user's selected color palette (useTheme.ts)
- `torchlight-last-seen-version` — last version seen, drives WhatsNew modal (Navbar.tsx)

### Deployment

Cloudflare Workers static assets via Workers Builds. Push to `main` deploys https://torchlight.editbag.workers.dev; PR branches get `<branch>-torchlight.editbag.workers.dev` previews (URL posted as a PR comment).

Two installs in Owlbear, each added once:

- Live: `https://torchlight.editbag.workers.dev/manifest.json` (named "Torchlight")
- Dev: `https://dev-torchlight.editbag.workers.dev/manifest.json` (the long-lived `dev` branch). Non-main builds rename the manifest to "Torchlight (Dev)" via `WORKERS_CI_BRANCH` (`src/devManifest.ts`, wired in `vite.config.js`).

- `public/_headers` sets `Access-Control-Allow-Origin: *`. Required: OBR fetches the manifest cross-origin, and Workers send no CORS header by default.
- `wrangler.jsonc` needs `"previews": {}` or `wrangler preview` (PR builds) fails. Previews don't apply the SPA fallback (deep links 404); production does.
- Cloudflare build logs aren't reachable from here (the GitHub check has no log). Ask the user to download it from the dashboard.
- `allowScripts` in package.json denies esbuild/workerd/fsevents install scripts; builds work without them.

### Workflow

- Branch + PR per change; squash-merge after CI and Workers Builds both pass. Features that need in-Owlbear testing stay open until the manual pass (`TESTING.md`).
- To review in Owlbear, rebuild `dev` from main plus the open PR branches and force-push it: `git checkout -B dev origin/main && git merge --no-edit <branches...> && git push -f origin dev`. `dev` is disposable; never PR from it or merge it into main.
- Versions are dates (`YYYY-MM-DD` in package.json and manifest.json; a second release the same day is `YYYY-MM-DD.1`, then `.2`) and drive the WhatsNew modal (shows on any change, not just newer). Add matching entries to `src/releaseNotes.ts` and `RELEASE-NOTES.md`.

### Theming

Two independent layers:

1. **OBR color mode** (`light` / `dark`): controlled by Owlbear Rodeo. Applied by toggling the `dark` class on `<html>`, enabling Tailwind's `dark:` variants.
2. **Color palette**: 4 user-selectable themes defined in `src/themes.ts` (`dark-fantasy`, `modern-saas`, `gaming-vibrant`, `earthy-dungeon`). The active theme is applied as CSS custom properties (`--color-bg`, `--color-primary`, etc.) on `:root` by `src/hooks/useTheme.ts`. Components use these via Tailwind's `bg-[var(--color-bg)]` syntax or direct `style` props.

### Icons

Both inline SVG and FontAwesome icons (`@fortawesome/react-fontawesome`) are used across components.

### Analytics

None. The upstream Google Analytics tag was removed; don't add tracking without asking.
