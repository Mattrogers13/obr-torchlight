# Release Notes

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
