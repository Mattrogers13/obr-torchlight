# Release Notes

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
