import OBR, { ContextMenuItem } from "@owlbear-rodeo/sdk";

import { ID, ROOM_KEY } from "./constants";
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
  // What Owlbear currently has. Only updated after create/remove succeeds,
  // so a failed call is retried on the next change instead of sticking.
  let shown: boolean | null = null;

  const sync = async () => {
    const gm = (await OBR.player.getRole()) === "GM";
    // Players only get the menu while the GM allows player lights.
    const allowed = gm || parseRoomState((await OBR.room.getMetadata())[ROOM_KEY]).playersCanAdd;
    if (allowed === shown) return;
    if (allowed) await OBR.contextMenu.create(MENU);
    else await OBR.contextMenu.remove(MENU_ID);
    shown = allowed;
  };

  // One sync at a time; changes that arrive meanwhile collapse into one rerun
  // that reads fresh state, so out-of-order results can't win.
  let running = false;
  let pending = false;
  const requestSync = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await sync().catch((err) => {
          shown = null;
          console.error(`Torchlight menu sync failed: ${errorMessage(err)}`);
        });
      } while (pending);
    } finally {
      running = false;
    }
  };

  requestSync();
  // Only what can change the answer: the GM's "players can light their own"
  // flag, and this player's role. Other extensions' writes and selection
  // changes (player.onChange fires on every click) don't.
  let lastAllowFlag: boolean | null = null;
  OBR.room.onMetadataChange((metadata) => {
    const flag = parseRoomState(metadata[ROOM_KEY]).playersCanAdd;
    if (flag === lastAllowFlag) return;
    lastAllowFlag = flag;
    requestSync();
  });
  let lastRole: string | null = null;
  OBR.player.onChange((player) => {
    if (player.role === lastRole) return;
    lastRole = player.role;
    requestSync();
  });
  // GM only (checked inside): token lights and badges follow the timers.
  startTokenSync();
});
