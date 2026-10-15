# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Torchlight (a customized copy of Shadow Crawler by Alvaro Cavalcanti, MIT) is an Owlbear Rodeo extension for running the Crawling phase of the Shadowdark RPG. It's a React-based popover plugin that tracks torch and light source timers (real-time or turns) during dungeon crawling sessions.

Standalone repo (github.com/Mattrogers13/obr-torchlight), not a fork. Never pull from or PR to upstream `alvarocavalcanti/shadowcrawler`. Keep `LICENSE` and the credit lines (README, About, homepage, manifest). Keep the "Coded with AI (Claude Code)" line in README, About and homepage.

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

`src/hooks/useRoomState.ts` syncs `RoomState` (`lights`, `showToPlayers`) through OBR room metadata:

- Room metadata is writable by any client and any extension, so everything read goes through `parseRoomState` (drops malformed lights, clamps numbers). Keep it that way.
- Only GMs write (`canWrite`); players get a read-only view.
- Every write bumps `rev`; incoming state with a lower `rev` is ignored (late echoes of our own earlier writes). `resync()` forces past it after a failed save.
- Room metadata is capped at 16kB total across all extensions. Limits in `LIMITS` (20 lights, 40-char names) keep us small; failed writes show an error and resync.
- Burn-out alerts fire once per light: the `alerted` flag persists in room state. A light that burned out while no GM panel was open alerts when a GM next opens it.
- Known limitation: two GMs editing at the same instant is last-write-wins (the whole state is one metadata key).

localStorage keys (per browser, not shared):

- `torchlight-theme` — user's selected color palette (useTheme.ts)
- `torchlight-last-seen-version` — last version seen, drives WhatsNew modal (Navbar.tsx)

### Deployment

Cloudflare Workers static assets via Workers Builds. Push to `main` deploys https://torchlight.editbag.workers.dev; PR branches get `<branch>-torchlight.editbag.workers.dev` previews (URL posted as a PR comment).

- `public/_headers` sets `Access-Control-Allow-Origin: *`. Required: OBR fetches the manifest cross-origin, and Workers send no CORS header by default.
- `wrangler.jsonc` needs `"previews": {}` or `wrangler preview` (PR builds) fails. Previews don't apply the SPA fallback (deep links 404); production does.
- Cloudflare build logs aren't reachable from here (the GitHub check has no log). Ask the user to download it from the dashboard.
- `allowScripts` in package.json denies esbuild/workerd/fsevents install scripts; builds work without them.

### Workflow

- Branch + PR per change; squash-merge after CI and Workers Builds both pass. Features that need in-Owlbear testing stay open until the manual pass (`TESTING.md`).
- Versions are dates (`YYYY-MM-DD` in package.json and manifest.json) and drive the WhatsNew modal. Add matching entries to `src/releaseNotes.ts` and `RELEASE-NOTES.md`.

### Theming

Two independent layers:

1. **OBR color mode** (`light` / `dark`): controlled by Owlbear Rodeo. Applied by toggling the `dark` class on `<html>`, enabling Tailwind's `dark:` variants.
2. **Color palette**: 4 user-selectable themes defined in `src/themes.ts` (`dark-fantasy`, `modern-saas`, `gaming-vibrant`, `earthy-dungeon`). The active theme is applied as CSS custom properties (`--color-bg`, `--color-primary`, etc.) on `:root` by `src/hooks/useTheme.ts`. Components use these via Tailwind's `bg-[var(--color-bg)]` syntax or direct `style` props.

### Icons

Both inline SVG and FontAwesome icons (`@fortawesome/react-fontawesome`) are used across components.

### Analytics

None. The upstream Google Analytics tag was removed; don't add tracking without asking.
