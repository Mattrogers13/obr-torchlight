import React, { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";

import OBR, { Player } from "@owlbear-rodeo/sdk";
import About from "./About";
import Main from "./Main";
import Navbar from "./Navbar";
import { paths } from "./util/constants";
import { useTheme } from "../hooks/useTheme";
import { ColorMode } from "../themes";

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
    OBR.theme
      .getTheme()
      .then((theme) => setTheme(theme.mode.toLowerCase()))
      .catch(() => {}); // keep the default theme
    // Without a role nothing renders, so a failed lookup retries, but only
    // while we're still mounted.
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const loadRole = () =>
      OBR.player
        .getRole()
        .then((r) => alive && setRole(r))
        .catch(() => {
          if (alive) retry = setTimeout(loadRole, 2000);
        });
    loadRole();
    const offTheme = OBR.theme.onChange((theme) => setTheme(theme.mode.toLowerCase()));
    const offPlayer = OBR.player.onChange((player: Player) => setRole(player.role));
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
