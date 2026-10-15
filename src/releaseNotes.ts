export interface ReleaseHighlight {
  version: string;
  date: string;
  highlights: string[];
}

export const releaseHighlights: ReleaseHighlight[] = [
  {
    version: "2026-10-15",
    date: "October 15, 2026",
    highlights: [
      "🙋 Players can light their own torches (up to 3 each) when the GM allows it",
      "🗑️ A separate GM toggle lets players remove their own lights",
    ]
  },
  {
    version: "2026-10-14",
    date: "October 14, 2026",
    highlights: [
      "✂️ Removed the crawling turns counter and random encounter roller to keep Torchlight focused on light sources",
    ]
  },
  {
    version: "2026-10-12",
    date: "October 12, 2026",
    highlights: [
      "🔥 Multiple light sources: track every torch, lantern and spell with its own name and timer",
      "⏳ Real-time or turn-based per light, with custom minutes or turn counts",
      "🔄 Timers stay accurate in background tabs and sync to everyone in the room, including late joiners",
      "⏯️ Pause all / Resume all for breaks",
      "➕ Add or take away 1, 5 or 10 minutes on any real-time light",
    ]
  },
  {
    version: "2026-07-20",
    date: "July 20, 2026",
    highlights: [
      "⏱️ Added 'Custom Time' mode allowing GMs to set precise countdown lengths in minutes",
      "⚠️ Implemented an automated visual alert that pings all players simultaneously when the torch timer reaches exactly zero",
    ]
  },
  {
    version: "2026-06-16",
    date: "June 16, 2026",
    highlights: [
      "💾 Persisted What's New modal - Dismissing the changelog now correctly saves your preferences across sessions",
      "🔄 Smarter version checks - Changelog only appears again when a new update is released"
    ]
  },
  {
    version: "2026-02-04",
    date: "February 4, 2026",
    highlights: [
      "🎨 New customizable color themes - Choose from 4 beautiful palettes",
      "⚡ 96% smaller CSS bundle for faster loading",
      "🚀 20% fewer modules for improved performance",
      "🎯 Tab navigation replacing dropdown menu",
      "🌙 Better dark mode support with improved contrast"
    ]
  },
  {
    version: "2026-02-03",
    date: "February 3, 2026",
    highlights: [
      "☕ Ko-fi donation link added",
      "📦 Security fix for prismjs vulnerability",
      "📚 Enhanced project documentation"
    ]
  }
];

export const changelogUrl = "https://github.com/Mattrogers13/obr-torchlight";
