import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import OBR from "@owlbear-rodeo/sdk";
import DebugInfo from "./DebugInfo";
import ThemeSelector from "./ThemeSelector";
import { ThemeId } from "../themes";

const About: React.FC<{
  version: string;
  currentTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  // The homepage embeds About, where a link to itself would be pointless.
  showHomepageLink?: boolean;
}> = ({ version, currentTheme, onThemeChange, showHomepageLink = true }) => {
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
          <FontAwesomeIcon icon={faGithub} /> Mattrogers13/obr-torchlight
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
        <em className="text-theme-secondary text-sm">Version: {version}</em>
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
