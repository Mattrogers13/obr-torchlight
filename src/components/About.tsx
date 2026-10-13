import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGithub } from "@fortawesome/free-brands-svg-icons";
import ThemeSelector from "./ThemeSelector";
import { ThemeId } from "../themes";

const About: React.FC<{ version: string; currentTheme: ThemeId; onThemeChange: (theme: ThemeId) => void }> = ({ version, currentTheme, onThemeChange }) => {
  return (
    <div className="p-4">
      <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
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
      <div className="mt-3 text-center">
        <em className="text-theme-secondary text-sm">Version: {version}</em>
      </div>
    </div>
  );
};

export default About;
