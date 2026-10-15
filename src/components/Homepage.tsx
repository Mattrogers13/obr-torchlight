import React, { useEffect, useState } from "react";

import About from "./About";

const Homepage: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isHomepage = urlParams.has("homepage");

  const [version, setVersion] = useState("unknown");
  useEffect(() => {
    fetch("/manifest.json")
      .then((b) => b.json())
      .then((j) => j.version)
      .then(setVersion);
  }, []);

  useEffect(() => {
    if (!isHomepage) {
      window.location.href = "/?homepage";
    }
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <img
          src="/img/hero.png"
          alt="Torchlight"
          className="mb-4 w-full max-w-full"
        />
        <h1 className="text-3xl font-bold mb-4 text-theme">Torchlight</h1>
        <div className="mb-4 text-theme-secondary">
          <em>
            An{" "}
            <a href="https://owlbear.rodeo" target="_blank" className="text-theme-primary hover:underline">
              Owlbear Rodeo
            </a>{" "}
            extension with tools for running the crawling phase of the
            Shadowdark RPG.
            <br />
            By Matthew Rogers. Based on{" "}
            <a href="https://github.com/alvarocavalcanti/shadowcrawler" target="_blank" className="text-theme-primary hover:underline">
              Shadow Crawler
            </a>{" "}
            by Alvaro Cavalcanti (MIT License). Coded with AI (Claude Code).
          </em>
        </div>
        <h2 className="text-2xl font-semibold mb-3 text-theme">Overview</h2>
        <div className="mb-4 text-theme-secondary">
          Track every torch, lantern and light spell in the party, each with
          its own name and timer. Timers run in real time or count turns, stay
          accurate in background tabs, and sync to everyone in the room.
        </div>
        <h2 className="text-2xl font-semibold mb-3 text-theme">Installation</h2>
        <div className="mb-4 text-theme-secondary">
          You can follow the instructions on{" "}
          <a href="https://extensions.owlbear.rodeo/guide" className="text-theme-primary hover:underline">Owlbear Rodeo</a>{" "}
          to install the extension, and use the following URL:
          <pre className="mt-3 p-3 rounded border border-theme bg-theme-card text-theme overflow-x-auto">
            <code className="select-all">{`${window.location.origin}/manifest.json`}</code>
          </pre>
        </div>
        <h2 className="text-2xl font-semibold mb-3 text-theme">Features</h2>
        <h3 className="text-xl font-semibold mb-2 text-theme">Light Sources</h3>
        <p className="mb-2 text-theme-secondary">
          Add as many lights as you need (up to 20). Each one is either real
          time, with a custom number of minutes, or turn-based, with a custom
          number of turns. New lights start burning right away.
        </p>
        <img
          src="/img/gm-view.png"
          alt="GM view: two real-time lights with pause, reset and time adjust buttons"
          className="mb-2 w-full max-w-sm mx-auto rounded border border-theme"
        />
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Adjusting Time</h3>
        <p className="mb-2 text-theme-secondary">
          Pause or resume any light, or pause them all for a break. Add or take
          away 1, 5 or 10 minutes on a real-time light; adding past full
          extends it.
        </p>
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Right-click a Token</h3>
        <p className="mb-2 text-theme-secondary">
          Right-click a character token and choose <strong>Light torch</strong>,{" "}
          <strong>Light lantern</strong> or <strong>Cast Light</strong> to start
          a 60-minute light named after it. Lighting a token that already has a
          light pauses the old one. Players get the same options on tokens they
          can edit, when the GM allows player lights.
        </p>
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Torches, Lanterns and Light</h3>
        <p className="mb-2 text-theme-secondary">
          Each light is a torch (30 ft), lantern (60 ft) or Light spell (30 ft),
          all burning for an hour of real time, per the core rules. When wind or
          water hits the party, the GM's <strong>Put out…</strong> lists what's
          burning with torches and lanterns pre-checked; uncheck whoever made
          their save. <strong>Remove all</strong> clears the board.
        </p>
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Burn-out Alerts</h3>
        <p className="mb-2 text-theme-secondary">
          When a light goes out, everyone in the room gets a notification,
          once per light.
        </p>
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Player View</h3>
        <p className="mb-2 text-theme-secondary">
          The GM can show or hide the light list for players with the eye
          button. Players see a read-only list of every light and its time.
        </p>
        <img
          src="/img/player-view.png"
          alt="Player view: read-only list of lights and their remaining time"
          className="mb-2 w-full max-w-sm mx-auto rounded border border-theme"
        />
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Player Lights</h3>
        <p className="mb-2 text-theme-secondary">
          The GM can let players light their own torches, one at a time:
          lighting a new one pauses the old one, as in the rules. The GM can
          separately let them remove their own. Players can never remove the
          GM's lights or anyone else's. The GM sees every player light, with
          its owner's name, can pause, adjust or remove it, and gets a
          notification whenever a player lights, pauses or removes one.
        </p>
        <h3 className="text-xl font-semibold mb-2 mt-4 text-theme">Data Storage</h3>
        <p className="mb-2 text-theme-secondary">
          Lights are stored in the Owlbear Rodeo room, so they survive reloads
          and late joiners see the same timers.
        </p>
        <h2 className="text-2xl font-semibold mb-3 mt-4 text-theme">Feedback</h2>
        <p className="mb-4 text-theme-secondary">
          Open an issue on{" "}
          <a href="https://github.com/Mattrogers13/obr-torchlight/issues" target="_blank" className="text-theme-primary hover:underline">
            GitHub
          </a>
          .
        </p>
        <h2 className="text-2xl font-semibold mb-3 text-theme">Help Topics</h2>
        <About version={version} currentTheme="dark-fantasy" onThemeChange={() => {}} showHomepageLink={false} />
      </div>
    </div>
  );
};

export default Homepage;
