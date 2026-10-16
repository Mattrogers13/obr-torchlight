import OBR, { ContextMenuItem } from "@owlbear-rodeo/sdk";

import { ID, ROOM_KEY } from "./constants";
import { parsePlayersCanAdd } from "./lights";
import { startTokenSync } from "./tokenSync";
import { errorMessage, onRoleChange } from "./utils";

// Runs whenever Torchlight is enabled in the room, panel open or not.
// Adds one "Torchlight" entry to the right-click menu of character tokens;
// it opens a small embedded submenu (menu.html / src/menu.ts) with the three
// light sources. On the GM's client it also keeps token lights in step with
// the timers (tokenSync.ts).

const MENU_ID = `${ID}/light-menu`;
// First retry after Owlbear fails to add or remove the menu (then doubling).
const MENU_RETRY_MS = 5000;
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
  // so a failed call is retried instead of sticking.
  let shown: boolean | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryWait = MENU_RETRY_MS;
  // The two inputs, kept current by the listeners below, so a sync needs no
  // reads of its own.
  let gm = false;
  let playersCanAdd = false;

  const sync = async () => {
    // Players only get the menu while the GM allows player lights.
    const allowed = gm || playersCanAdd;
    if (allowed === shown) return;
    if (allowed) await OBR.contextMenu.create(MENU);
    else await OBR.contextMenu.remove(MENU_ID);
    shown = allowed;
    clearTimeout(retryTimer); // a pending retry is no longer needed
    retryWait = MENU_RETRY_MS;
  };

  // One sync at a time; changes that arrive meanwhile collapse into one rerun.
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
          // The triggers below only fire on real changes, so retry on a timer,
          // backing off up to 5 min.
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => requestSync(), retryWait);
          retryWait = Math.min(retryWait * 2, 5 * 60_000);
        });
      } while (pending);
    } finally {
      running = false;
    }
  };

  // Only what can change the answer: this player's role, and the GM's
  // "players can light their own" flag (other extensions' writes and
  // selection changes don't).
  OBR.room.onMetadataChange((metadata) => {
    const flag = parsePlayersCanAdd(metadata[ROOM_KEY]);
    if (flag === playersCanAdd) return;
    playersCanAdd = flag;
    requestSync();
  });
  onRoleChange((role) => {
    gm = role === "GM";
    requestSync();
  });
  try {
    const [role, metadata] = await Promise.all([OBR.player.getRole(), OBR.room.getMetadata()]);
    gm = role === "GM";
    playersCanAdd = parsePlayersCanAdd(metadata[ROOM_KEY]);
  } catch (err) {
    console.error(`Torchlight menu setup failed: ${errorMessage(err)}`);
  }
  requestSync();
  // GM only (checked inside): token lights and badges follow the timers.
  startTokenSync();
});
