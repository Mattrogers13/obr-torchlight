import React from "react";

// Shown to players while the GM keeps the lights hidden. Inline SVG, so no
// third-party requests (the upstream version hotlinked Giphy).
const PlayerView: React.FC = () => (
  <div className="p-4">
    <div className="bg-theme-card rounded-lg border border-theme overflow-hidden mb-4">
      <div className="flex justify-center py-8">
        <svg
          className="torch-flicker w-24 h-24 text-theme-primary"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2c.5 3-1.5 4.5-3 6.5C7.5 10.5 7 12 7 13.5a5 5 0 0 0 10 0c0-2-1-3.5-2-4.5.2 1.5-.4 2.6-1.3 3 .3-2.5-.4-6.5-1.7-10z" />
          <rect x="10.5" y="19" width="3" height="4" rx="0.5" opacity="0.6" />
        </svg>
      </div>
      <div className="p-4">
        <h2 className="text-xl font-semibold mb-2 text-theme">Lights Hidden</h2>
        <p className="text-theme-secondary">
          Your GM hasn't shared the light sources. They'll show up here when they do.
        </p>
      </div>
    </div>
  </div>
);

export default PlayerView;
