# Testing: Put out light, unlit light, Time passes, Turn out all

Manual test pass in Owlbear Rodeo before merging the light-controls PR. Needs Dynamic Fog enabled in the room.

Dev manifest (shows up as "Torchlight (Dev)"; install once, rebuilds on every push to `dev`):

```
https://dev-torchlight.editbag.workers.dev/manifest.json
```

## Steps

1. Enable "Torchlight (Dev)" and Dynamic Fog in a test room. Open it as GM in one browser and as a player in another (a private window works). Turn on "Players can light their own".
2. Right-click a PC token with no light of its own → Torchlight. The submenu should show four rows (Light torch, Light lantern, Cast Light, Put out light) with nothing cut off.
3. Light a torch on it, then right-click → Put out light. The 30 ft light and the badge go away, the token is left with a small 3 ft light, and both windows get "went out".
4. On a token where you set a light by hand first (say 10 ft), light a torch and put it out. It should get its 10 ft light back, not the 3 ft one.
5. Set "Light when unlit" to None, light and put out a torch on a fresh token: no light left on it. Set it back to 3 ft.
6. As the player, light your own token, then use Put out light on it. Then try Put out light on a token lit by the GM that you can edit: you should get "None of your lights are burning there."
7. Light a torch and a Light spell on two tokens. Turn out all the lights → Non-magical: only the torch goes out. Light it again, then Turn out all → All: both go out.
8. Light two torches (one GM, one player). Hit Time passes → 10m: both drop by 10 minutes in both windows. Pause all, hit 30m, Resume all: the 30 minutes came off while paused. Then hit 1 hr: both burn out, alert once each, and the tokens drop to 3 ft.

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
| 8 | | |
