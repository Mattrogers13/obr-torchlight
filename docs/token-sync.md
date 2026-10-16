# Token sync

`src/tokenSync.ts` runs on the GM's client inside the background page (`src/background.ts`), so it works with no panel open.

## What it does

Every token with an active linked light (`tokenId`) gets:

- That source's Dynamic Fog light (`rodeo.owlbear.dynamic-fog/light`): range from `SOURCES` converted with the grid scale, full circle, PRIMARY, solid edge `falloff: 0.2`.
- A badge attachment (`public/img/badge-<source>.webp`). Badges whose image URL isn't current are replaced automatically, so changing the URL (or format) migrates existing tokens.

The token's previous light (e.g. the GM's 3 ft light so players can see their own token) is saved under `${ID}/token` and restored when the light stops: burns out, put out, or swapped. A Pause all leaves tokens lit. Saved lights are reduced to known Dynamic Fog fields (`parseDfLight`).

Needs Dynamic Fog in the room to actually cast light; without it only the badge shows.

## When it runs

On room changes, scene load, and a timer at the next burn-out.

## Structure

The decision is the pure `planSync` (tested in `tokenSync.test.ts` / `tokenSync.sync.test.ts`); the rest is SDK calls.

## Security

Player docs can be forged, so a player's light only reaches a token that is visible and that the room's permissions would let that player edit (`playerMayLight`: `CHARACTER_UPDATE`, plus `CHARACTER_OWNER_ONLY` → `createdUserId`). Otherwise a tampered doc could light a hidden monster through the GM's client.

## Badge images

Item images must be PNG/JPG/WebP, never SVG: Chrome can't decode SVG into Owlbear's canvas textures and draws a black square.

Badge sources are `art/badges/*.svg`. Regenerate with headless Chrome at 128×128 on a transparent background (ImageMagick drops stroked SVG paths), then `cwebp -lossless -exact`.
