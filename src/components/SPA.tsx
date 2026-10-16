import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import OBR, { Player } from "@owlbear-rodeo/sdk";
import About from "./About";
import Main from "./Main";
import Navbar from "./Navbar";
import { paths } from "./util/constants";
import { useTheme } from "../hooks/useTheme";
import { ColorMode } from "../themes";
import { errorMessage, notify } from "../utils";

export default function SPA() {
  // Unknown until OBR reports it, so a player never briefly runs the GM view.
  const [role, setRole] = React.useState<"GM" | "PLAYER" | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('dark');
  const { themeId, changeTheme } = useTheme(colorMode);

  const setTheme = (theme: string): void => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      setColorMode('dark');
    } else {
      root.classList.remove('dark');
      setColorMode('light');
    }
  };

  // App only renders us once Owlbear is ready, and remounts us on every
  // scene change, so every listener must be removed on unmount.
  useEffect(() => {
    let alive = true;
    // A theme from theme.onChange is newer than this lookup's answer.
    let gotTheme = false;
    OBR.theme
      .getTheme()
      .then((theme) => alive && !gotTheme && setTheme(theme.mode.toLowerCase()))
      .catch((err) => console.warn(`Torchlight couldn't get the Owlbear theme: ${errorMessage(err)}`));
    // Without a role nothing renders, so a failed lookup retries (backing off
    // to 30 s), but only while we're still mounted.
    let gotRole = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = 2000;
    let failures = 0;
    const loadRole = () =>
      OBR.player
        .getRole()
        // A role from player.onChange is newer than this lookup's answer.
        .then((r) => alive && !gotRole && setRole(r))
        .catch((err) => {
          // player.onChange may have delivered the role meanwhile.
          if (!alive || gotRole) return;
          console.warn(`Torchlight couldn't get the player role, retrying: ${errorMessage(err)}`);
          // A blank panel needs an explanation once it's clearly not a blip.
          if (++failures === 3) notify(`Torchlight can't reach Owlbear yet: ${errorMessage(err)}`, "ERROR");
          retry = setTimeout(loadRole, wait);
          wait = Math.min(wait * 2, 30_000);
        });
    loadRole();
    const offTheme = OBR.theme.onChange((theme) => {
      gotTheme = true;
      setTheme(theme.mode.toLowerCase());
    });
    const offPlayer = OBR.player.onChange((player: Player) => {
      gotRole = true;
      setRole(player.role);
    });
    return () => {
      alive = false;
      clearTimeout(retry);
      offTheme();
      offPlayer();
    };
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={role ? <Main player={role === "PLAYER"} /> : null} />
        <Route path={paths.about} element={<About currentTheme={themeId} onThemeChange={changeTheme} />} />
        <Route path="*" element={<NoMatch />} />
      </Route>
    </Routes>
  );
}

function Layout() {
  return <Navbar />;
}

function NoMatch() {
  return (
    <div className="p-3">
      <h2>Nothing to see here!</h2>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </div>
  );
}
