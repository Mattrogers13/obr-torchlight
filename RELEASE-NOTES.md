# Release Notes

## Version 2026-10-18

### New

- **Put out light** on the token right-click menu (Torchlight → Put out light). The GM puts out every light burning on the selected tokens, players' included; a player puts out only their own. Everyone gets the "went out" alert.
- **Light when unlit** (GM panel, default 3 ft): when a token's light stops and the token had no Dynamic Fog light before Torchlight lit it, it gets this small light instead of none, so players can see their own token but not much else. A token that had its own light still gets that back. Set to None to turn it off.
- **Time passes** (GM panel): 1m, 5m, 10m, 30m or 1 hr comes off every lit real-time light at once, players' included and lights frozen by Pause all. Anything that runs out burns out and alerts as usual. Put-out, swapped and turn-counted lights aren't touched.
- **Turn out all the lights** replaces "Put out…": All puts out everything burning, Non-magical everything but Light spells. The checklist is still there for partial cases (DEX saves).

## Version 2026-10-15.8

Reliability release from repeated code reviews.

### Fixes

- Syncing between the GM panel, players' panels and the right-click menu: a write is labeled with who sent it, so one client's change can't be mistaken for an old copy of another's and dropped. While a client's own save is in flight it ignores room changes, then re-reads the room once the save settles.
- A failed save (e.g. the room's 16 kB storage is full) is undone on screen instead of staying there looking saved.
- A panel whose first room read fails stays on "Loading…" and retries, instead of starting empty, where the next edit could have overwritten every light in the room. Same when switching tabs mid-save.
- "Went out!" alerts fire at burn-out even if recording the burn-out can't be saved; still once per burn-out.
- The right-click menu and token lights retry after Owlbear hiccups, with back-off; a role lookup that keeps failing now says so.
- Token sync can't be spun by a tampered timer, and skips other extensions' room changes.

### Changes

- Each storage slot still carries the old `rev` number so panels on earlier builds keep accepting new writes; it will be removed after 2026-11-15.


## Version 2026-10-15.7

### Features

- Lighting a token (right-click) sets its Dynamic Fog light from the source: torch 30 ft, lantern 60 ft, Light spell 30 ft; full circle, primary, solid edge. The range follows the scene's grid scale.
- A small badge on the token shows the source while it burns
- When the light burns out, is put out, or is swapped for a new one, the token's previous light (such as a 3 ft light so a player can see their own token) is restored and the badge removed. Pause all for a table break leaves tokens lit.
- Runs from the GM's background page, so tokens go dark on time even with no Torchlight panel open. Needs Dynamic Fog in the room; without it only the badge shows.

## Version 2026-10-15.6

### Changes

- "Active lights only" checkbox above the list (GM and players) hides paused, put-out and burned-out lights. Remembered per browser.
- Pause all / Resume all is one button: it pauses while anything is running, otherwise resumes

## Version 2026-10-15.5

### Changes

- Token right-click menu: the three light entries are now one "Torchlight" entry that opens a small submenu (Light torch / Light lantern / Cast Light)
- Players' panel shows a single "Light Sources" list instead of separate "Your Lights" and "Light Sources" cards: their own lights first, then everyone else's when the GM shares them. Only their own can show a remove button.

## Version 2026-10-15.4

### Features

- Light sources from the core rules: Torch (near, 30 ft), Lantern (double near, 60 ft), Light spell (near, 30 ft), each an hour of real time. Pick one in the add form; each row shows its source. Ranges are stored for the upcoming token-light link.
- Right-click menu now has Light torch, Light lantern and Cast Light
- GM "Put out…" opens a checklist of everything burning. Torches and lanterns are pre-checked (wind and water put out flames on a failed DC 15 DEX, rules p.110); Light spells aren't. Put-out lights keep their time, show "Put out", and Resume all leaves them alone. Everyone gets the went-out alert.
- GM "Remove all" clears every light, players' included, after a confirm

## Version 2026-10-15.3

### Changes

- Players carry one light at a time, per the core rules (p.84, "extinguish all old light sources, start a new timer"). Lighting a new one, from the panel or a token's right-click, pauses the current light. Their list keeps two: the current light and the one last paused. This replaces the 3-per-player cap.
- Same per token: right-clicking a token that already has a light burning (the GM's or a player's) pauses that light and starts the new one
- Paused lights keep their remaining time and show "Paused". They don't trigger a burn-out alert, and Resume all skips them. The GM can still relight one with its play button.
- GM gets a notification when a player's light is paused this way

## Version 2026-10-15.2

### Features

- Right-click a character token and choose "Light torch" to start a 60-minute real-time torch named after the token ("Kira's torch"). Works with several tokens selected.
- Players get the same menu item on tokens they can edit, only while "Players can light their own" is on; their 3-light cap applies.

### Changes

- New background page (`background_url`) that runs while Torchlight is enabled, panel open or not

## Version 2026-10-15.1

### Features

- GM notification when a player lights or removes a torch

### Changes

- Pause all / Resume all moved to the top of the GM panel

## Version 2026-10-15

### Features

- Players can light their own torches (up to 3 each) when the GM turns on "Players can light their own"
- Separate GM toggle "Players can remove their own"; players can never remove the GM's or other players' lights
- GM sees and manages player lights (pause, adjust, remove) with the owner's name shown, and burn-out alerts cover them

## Version 2026-10-14

### Changes

- Removed the crawling turns counter and random encounter roller; Torchlight now focuses on light sources

## Version 2026-10-12

First Torchlight release (customized from Shadow Crawler).

### Features

- Multiple named light sources, each real-time (custom minutes) or turn-based (custom turn count)
- New lights start burning; Pause all / Resume all for breaks
- Add or take away 1, 5 or 10 minutes on any real-time light (adding past full extends it)
- Burn-out notification to everyone in the room, sent once per light

### Changes

- Timers compute from a stored end time, so throttled background tabs no longer slow them down
- State (lights, crawl turns, last encounter roll) moved from the GM's localStorage into Owlbear room metadata: shared, survives reloads, visible to late joiners
- Room metadata is validated on read
- Players no longer briefly see the GM view while their role loads
- Removed Google Analytics

---

## Version 2026-06-16

### Bug Fixes

- Fix changelog displaying every time a new session starts by persisting the dismissal state correctly.

---

## Version 2026-02-27

### Analytics

- Removed Vercel Analytics and Speed Insights dependencies
- Added Google Analytics event tracking for user actions (timer controls, encounter rolls, mode changes)

---

## Version 2026-02-04

### Major Tech Stack Modernization

**Complete migration from Bootstrap to Tailwind CSS** resulting in significant performance improvements.

#### Performance Improvements

- **Bundle Size Reduction**: 35% smaller total bundle
  - CSS: 311.67 KB → 10.69 KB (96.6% reduction)
  - JavaScript: 478.69 KB → 408.50 KB (14.7% reduction)
  - Total (gzipped): 192.85 KB → 126.04 KB (34.6% reduction)
- **Module Optimization**: 20% fewer modules transformed (1493 → 1189)
- **Dependencies**: Reduced from 32 to 26 packages

#### Technical Changes

- Replaced Bootstrap 5 + react-bootstrap with Tailwind CSS v4
- Replaced analytics wrapper packages with direct gtag.js integration
- Converted Bootstrap Icons to inline SVG icons
- Maintained all existing functionality with improved performance
- Enhanced dark mode support with better color contrast
- Cleaner, more maintainable component code

#### Visual Improvements

- Improved text readability in both light and dark modes
- Better color contrast throughout the UI
- Consistent styling with Owlbear Rodeo theme
- Smoother hover states and transitions
- Responsive dropdown menu for navigation

---
