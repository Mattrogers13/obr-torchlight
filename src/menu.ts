import OBR from "@owlbear-rodeo/sdk";

import { LightSource } from "./lights";
import { lightFromTokens } from "./lightFromTokens";
import { errorMessage, notify } from "./utils";

// The token right-click submenu (embedded by background.ts): one button per
// light source. Plain DOM, no React, so it opens instantly.

const OPTIONS: { source: LightSource; label: string; icon: string }[] = [
  { source: "torch", label: "Light torch", icon: "/img/torch-menu.svg" },
  { source: "lantern", label: "Light lantern", icon: "/img/lantern-menu.svg" },
  { source: "light-spell", label: "Cast Light", icon: "/img/spell-menu.svg" },
];

const light = async (source: LightSource) => {
  const ids = (await OBR.player.getSelection()) ?? [];
  const items = await OBR.scene.items.getItems(ids);
  const tokens = items
    .filter((item) => item.layer === "CHARACTER")
    .map((item) => ({ id: item.id, name: item.name }));
  if (tokens.length === 0) return "Select a character token first.";
  const role = await OBR.player.getRole();
  return lightFromTokens(
    { gm: role === "GM", playerId: OBR.player.id, playerName: await OBR.player.getName() },
    tokens,
    Date.now(),
    source,
  );
};

OBR.onReady(async () => {
  const root = document.getElementById("menu")!;
  const theme = await OBR.theme.getTheme().catch(() => null);
  if (theme) {
    document.documentElement.style.setProperty("--text", theme.text.primary);
    document.documentElement.style.setProperty(
      "--hover",
      theme.mode === "DARK" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)",
    );
  }

  const buttons = OPTIONS.map(({ source, label, icon }) => {
    const button = document.createElement("button");
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    // The menu icons are white; darken them on a light theme.
    if (theme?.mode === "LIGHT") img.style.filter = "invert(1)";
    button.append(img, label);
    button.addEventListener("click", async () => {
      buttons.forEach((b) => (b.disabled = true));
      try {
        notify(await light(source), "INFO");
      } catch (err) {
        notify(`Torchlight couldn't light it: ${errorMessage(err)}`, "ERROR");
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    });
    root.append(button);
    return button;
  });
});
