import OBR from "@owlbear-rodeo/sdk";

import { broadcastLightOut } from "./alerts";
import { LightSource } from "./lights";
import { Lighter, Token, lightFromTokens, putOutOnTokens } from "./lightFromTokens";
import { errorMessage, notify } from "./utils";

// The token right-click submenu (embedded by background.ts): one button per
// light source, plus Put out light. Plain DOM, no React, so it opens
// instantly. Keep MENU_HEIGHT in background.ts in step with the row count.

type Action = LightSource | "put-out";

const OPTIONS: { action: Action; label: string; icon: string }[] = [
  { action: "torch", label: "Light torch", icon: "/img/torch-menu.svg" },
  { action: "lantern", label: "Light lantern", icon: "/img/lantern-menu.svg" },
  { action: "light-spell", label: "Cast Light", icon: "/img/spell-menu.svg" },
  { action: "put-out", label: "Put out light", icon: "/img/put-out-menu.svg" },
];

const run = async (action: Action) => {
  const ids = (await OBR.player.getSelection()) ?? [];
  const items = await OBR.scene.items.getItems(ids);
  const tokens: Token[] = items
    .filter((item) => item.layer === "CHARACTER")
    .map((item) => ({ id: item.id, name: item.name }));
  if (tokens.length === 0) return "Select a character token first.";
  const role = await OBR.player.getRole();
  const who: Lighter = { gm: role === "GM", playerId: OBR.player.id, playerName: await OBR.player.getName() };
  if (action !== "put-out") return lightFromTokens(who, tokens, Date.now(), action);

  const names = await putOutOnTokens(who, tokens.map((t) => t.id), Date.now());
  if (names.length === 0) return who.gm ? "No light burning on that token." : "None of your lights are burning there.";
  broadcastLightOut(names);
  return `Put out ${names.join(", ")}.`;
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

  const buttons = OPTIONS.map(({ action, label, icon }) => {
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
        notify(await run(action), "INFO");
      } catch (err) {
        notify(`Torchlight couldn't ${action === "put-out" ? "put it out" : "light it"}: ${errorMessage(err)}`, "ERROR");
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    });
    root.append(button);
    return button;
  });
});
