import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ID, ROOM_KEY } from "./components/util/constants";
import { parseRoomState } from "./lights";
import { lightFromTokens } from "./lightFromTokens";
import { errorMessage, notify } from "./utils";

// Runs whenever Torchlight is enabled in the room, panel open or not.
// Adds "Light torch" to the right-click menu of character tokens.

const MENU_ID = `${ID}/light-torch`;

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
    await OBR.contextMenu.create({
      id: MENU_ID,
      icons: [
        {
          icon: "/img/torch-menu.svg",
          label: "Light torch",
          // Character tokens this player may edit (Owlbear's own notion of
          // "your token", so it respects the room's owner-only setting).
          filter: {
            every: [{ key: "layer", value: "CHARACTER" }],
            permissions: ["UPDATE"],
          },
        },
      ],
      onClick: async (context) => {
        try {
          const role = await OBR.player.getRole();
          const message = await lightFromTokens(
            { gm: role === "GM", playerId: OBR.player.id, playerName: await OBR.player.getName() },
            context.items.map((item) => item.name),
            Date.now(),
          );
          notify(message, "INFO");
        } catch (err) {
          notify(`Torchlight couldn't light the torch: ${errorMessage(err)}`, "ERROR");
        }
      },
    });
  };

  const safeSync = (metadata?: Metadata) =>
    sync(metadata).catch((err) => console.error(`Torchlight menu sync failed: ${errorMessage(err)}`));

  safeSync();
  OBR.room.onMetadataChange(safeSync);
  OBR.player.onChange(() => safeSync());
});
