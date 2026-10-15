import React from "react";
import OBR from "@owlbear-rodeo/sdk";
import DebugInfo from "./DebugInfo";
import ThemeSelector from "./ThemeSelector";
import { ThemeId } from "../themes";
import { VERSION } from "../version";

// The GitHub mark (inline, so no icon library is needed for one icon).
const GithubIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" className="inline align-[-2px]">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const About: React.FC<{
  currentTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  // The homepage embeds About, where a link to itself would be pointless.
  showHomepageLink?: boolean;
}> = ({ currentTheme, onThemeChange, showHomepageLink = true }) => {
  return (
    <div className="p-4">
      <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
      {showHomepageLink && (
        <div className="mt-3 text-center">
          {/* origin, so previews link to their own homepage */}
          <a
            href={`${window.location.origin}/?homepage`}
            target="_blank"
            rel="noreferrer"
            className="m-1 text-theme-primary hover:underline"
          >
            Features and install guide
          </a>
        </div>
      )}
      <div className="mt-3 text-center">
        <a
          href="https://github.com/Mattrogers13/obr-torchlight"
          target="_blank"
          className="m-1 text-theme-primary hover:underline"
        >
          <GithubIcon /> Mattrogers13/obr-torchlight
        </a>
      </div>
      <div className="mt-3 text-center text-sm text-theme-secondary">
        Based on{" "}
        <a
          href="https://github.com/alvarocavalcanti/shadowcrawler"
          target="_blank"
          className="text-theme-primary hover:underline"
        >
          Shadow Crawler
        </a>{" "}
        by Alvaro Cavalcanti (MIT License)
      </div>
      <div className="mt-1 text-center text-sm text-theme-secondary">
        Coded with AI (Claude Code)
      </div>
      <div className="mt-3 text-center">
        <em className="text-theme-secondary text-sm">Version: {VERSION}</em>
        {import.meta.env.VITE_BUILD_LABEL && (
          <div className="mt-1">
            <span className="inline-block px-2 py-0.5 rounded bg-theme-danger text-white text-xs font-bold">
              {import.meta.env.VITE_BUILD_LABEL}
            </span>
          </div>
        )}
        {/* Dev builds inside Owlbear only (the homepage also renders About). */}
        {import.meta.env.VITE_BUILD_LABEL && OBR.isAvailable && OBR.isReady && <DebugInfo />}
      </div>
    </div>
  );
};

export default About;
