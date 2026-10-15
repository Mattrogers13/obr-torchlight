# Testing: Multiple Light Sources (PR #6)

Manual test pass in Owlbear Rodeo before merging [PR #6](https://github.com/Mattrogers13/obr-torchlight/pull/6).

Dev manifest (shows up as "Torchlight (Dev)"; install once, rebuilds on every push to `dev`):

```
https://dev-torchlight.editbag.workers.dev/manifest.json
```

## Steps

1. Enable "Torchlight (Dev)" in a test room (add the dev manifest above once, if you haven't).
2. Open the room as GM in one browser and as a player in another (a private window works).
3. Add a couple of lights: one real-time 1-minute light and one 3-turn light. Turn on "show to players" and check the player window lists them.
4. Switch the GM to another tab for a few minutes, then come back. The time should be exactly right, not behind.
5. Reload both windows. Everything should still be there.
6. Let the 1-minute light burn out with the GM panel open. Both windows should get one alert, not two.
7. On a running light, hit +10m and −5m. The GM and player readouts should both jump. Then use −10m on a light with under 10 minutes left: it should go out and alert once. Hit +1m on it: it comes back paused and Resume works.
8. Repeat step 6 with the GM panel closed. Either the alert arrives while it's closed, or it arrives when you reopen the panel. Note which: that's the Owlbear behavior we couldn't confirm from the docs.

## Known quirk

Preview URLs return 404 for deep links like `/about` (Cloudflare preview beta doesn't apply the SPA fallback). Owlbear loads `/` and switches tabs in-app, so this only shows up if you reload the panel while on the About tab. Production is unaffected.

## Results

| Step | Pass / fail | Notes |
|------|-------------|-------|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | Alert arrived: while closed / on reopen |
