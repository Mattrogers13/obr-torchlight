import OBR, { ContextMenuItem, Metadata } from "@owlbear-rodeo/sdk";

import { ID, ROOM_KEY } from "./components/util/constants";
import { parseRoomState } from "./lights";
import { startTokenSync } from "./tokenSync";
import { errorMessage } from "./utils";

// Runs whenever Torchlight is enabled in the room, panel open or not.
// Adds one "Torchlight" entry to the right-click menu of character tokens;
// it opens a small embedded submenu (menu.html / src/menu.ts) with the three
// light sources. On the GM's client it also keeps token lights in step with
// the timers (tokenSync.ts).

const MENU_ID = `${ID}/light-menu`;
// Height of the embedded submenu: 3 rows of 36px plus 8px padding (menu.html).
const MENU_HEIGHT = 116;

const MENU: ContextMenuItem = {
  id: MENU_ID,
  icons: [
    {
      icon: "/img/torch-menu.svg",
      label: "Torchlight",
      // Character tokens this player may edit (Owlbear's own notion of
      // "your token", so it respects the room's owner-only setting).
      filter: {
        every: [{ key: "layer", value: "CHARACTER" }],
        permissions: ["UPDATE"],
      },
    },
  ],
  // Served without .html (Cloudflare 307s menu.html to /menu).
  embed: { url: "/menu", height: MENU_HEIGHT },
};

OBR.onReady(async () => {
  let shown: boolean | null = null;

  const sync = async (metadata?: Metadata) => {
    const gm = (await OBR.player.getRole()) === "GM";
    // Players only get the menu while the GM allows player lights.
    const allowed =
      gm || parseRoomState((metadata ?? (await OBR.room.getMetadata()))[ROOM_KEY]).playersCanAdd;
    if (allowed === shown) return;
    shown = allowed;
    if (!allowed) {
      await OBR.contextMenu.remove(MENU_ID);
      return;
    }
    await OBR.contextMenu.create(MENU);
  };

  const safeSync = (metadata?: Metadata) =>
    sync(metadata).catch((err) => console.error(`Torchlight menu sync failed: ${errorMessage(err)}`));

  safeSync();
  OBR.room.onMetadataChange(safeSync);
  // GM only (checked inside): token lights and badges follow the timers.
  startTokenSync();
  OBR.player.onChange(() => safeSync());
});
