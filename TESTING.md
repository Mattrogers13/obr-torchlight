# Testing: Multiple Light Sources (PR #6)

Manual test pass in Owlbear Rodeo before merging [PR #6](https://github.com/Mattrogers13/obr-torchlight/pull/6).

Preview manifest (rebuilds on every push to the `multi-light-timers` branch):

```
https://multi-light-timers-torchlight.editbag.workers.dev/manifest.json
```

## Steps

1. Add the preview manifest above as an extension. If the production Torchlight is installed in that room, remove it for the test, since both show up as "Torchlight" in the toolbar.
2. Open the room as GM in one browser and as a player in another (a private window works).
3. Add a couple of lights: one real-time 1-minute light and one 3-turn light. Turn on "show to players" and check the player window lists them.
4. Switch the GM to another tab for a few minutes, then come back. The time should be exactly right, not behind.
5. Reload both windows. Everything should still be there.
6. Let the 1-minute light burn out with the GM panel open. Both windows should get one alert, not two.
7. Repeat with the GM panel closed. Either the alert arrives while it's closed, or it arrives when you reopen the panel. Note which: that's the Owlbear behavior we couldn't confirm from the docs.

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
| 7 | | Alert arrived: while closed / on reopen |
