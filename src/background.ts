import OBR, { ContextMenuItem, Metadata } from "@owlbear-rodeo/sdk";

import { ID, ROOM_KEY } from "./components/util/constants";
import { LightSource, parseRoomState } from "./lights";
import { lightFromTokens } from "./lightFromTokens";
import { errorMessage, notify } from "./utils";

// Runs whenever Torchlight is enabled in the room, panel open or not.
// Adds Light torch / Light lantern / Cast Light to the right-click menu of
// character tokens.

const MENUS: { id: string; label: string; icon: string; source: LightSource }[] = [
  { id: `${ID}/light-torch`, label: "Light torch", icon: "/img/torch-menu.svg", source: "torch" },
  { id: `${ID}/light-lantern`, label: "Light lantern", icon: "/img/lantern-menu.svg", source: "lantern" },
  { id: `${ID}/cast-light`, label: "Cast Light", icon: "/img/spell-menu.svg", source: "light-spell" },
];

const menuItem = (menu: (typeof MENUS)[number]): ContextMenuItem => ({
  id: menu.id,
  icons: [
    {
      icon: menu.icon,
      label: menu.label,
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
        context.items.map((item) => ({ id: item.id, name: item.name })),
        Date.now(),
        menu.source,
      );
      notify(message, "INFO");
    } catch (err) {
      notify(`Torchlight couldn't light it: ${errorMessage(err)}`, "ERROR");
    }
  },
});

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
      await Promise.all(MENUS.map((menu) => OBR.contextMenu.remove(menu.id)));
      return;
    }
    await Promise.all(MENUS.map((menu) => OBR.contextMenu.create(menuItem(menu))));
  };

  const safeSync = (metadata?: Metadata) =>
    sync(metadata).catch((err) => console.error(`Torchlight menu sync failed: ${errorMessage(err)}`));

  safeSync();
  OBR.room.onMetadataChange(safeSync);
  OBR.player.onChange(() => safeSync());
});
