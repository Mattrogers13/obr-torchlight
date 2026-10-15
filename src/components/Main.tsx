import React, { useMemo } from "react";
import OBR from "@owlbear-rodeo/sdk";

import { useGmAlerts, useLightOutListener } from "../hooks/useGmAlerts";
import { useNow } from "../hooks/useNow";
import { useRoomState } from "../hooks/useRoomState";
import { isOut, isRunning } from "../lights";
import GmPanel from "./GmPanel";
import { LightEntry } from "./Lights";
import PlayerPanel from "./PlayerPanel";

export { LIGHT_OUT_CHANNEL } from "../alerts";
export { BURN_OUT_RETRY_MS } from "../hooks/useGmAlerts";

// Loads the room's lights, runs the alerts, and shows the GM or player view.
const Main: React.FC<{ player: boolean }> = ({ player }) => {
  const myId = OBR.player.id;
  const { state, playerDocs, loaded, update, updatePlayer, updateLights } = useRoomState({
    gm: !player,
    playerId: myId,
  });

  // Every light in the room with its owner (null = the GM's shared state).
  const entries: LightEntry[] = useMemo(
    () => [
      ...state.lights.map((light) => ({ light, ownerId: null, ownerName: "" })),
      ...Object.entries(playerDocs).flatMap(([ownerId, doc]) =>
        doc.lights.map((light) => ({ light, ownerId, ownerName: doc.ownerName })),
      ),
    ],
    [state.lights, playerDocs],
  );

  // Tick only while something is actually counting down (a burned-out light
  // still has an endsAt).
  const now = useNow(entries.some((e) => isRunning(e.light) && !isOut(e.light, Date.now())));
  useLightOutListener();
  const removedByMe = useGmAlerts({ gm: !player, loaded, entries, state, now, update });

  if (!loaded) return <div className="p-4 text-theme-secondary">Loading…</div>;

  return player ? (
    <PlayerPanel
      myId={myId}
      state={state}
      entries={entries}
      mine={playerDocs[myId]?.lights ?? []}
      now={now}
      updatePlayer={updatePlayer}
    />
  ) : (
    <GmPanel
      state={state}
      entries={entries}
      now={now}
      update={update}
      updateLights={updateLights}
      removedByMe={removedByMe}
    />
  );
};

export default Main;
