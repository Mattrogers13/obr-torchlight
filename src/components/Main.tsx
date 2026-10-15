import React, { useMemo, useRef } from "react";
import OBR from "@owlbear-rodeo/sdk";

import { useGmAlerts, useLightOutListener } from "../hooks/useGmAlerts";
import { useNow } from "../hooks/useNow";
import { useRoomState } from "../hooks/useRoomState";
import { isOut, isRunning } from "../lights";
import GmPanel from "./GmPanel";
import { LightEntry } from "./Lights";
import PlayerPanel from "./PlayerPanel";

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

  // Tick while something is counting down as of the last tick. Judging by
  // the last tick (not the wall clock) keeps the ticker running until a tick
  // lands past endsAt, so the burn-out check always sees the light go out.
  const lastTick = useRef(Date.now());
  const now = useNow(entries.some((e) => isRunning(e.light) && !isOut(e.light, lastTick.current)));
  lastTick.current = now;
  useLightOutListener();
  const { removedByMe, restoredAfterFailure } = useGmAlerts({ gm: !player, loaded, entries, state, now, update });

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
      restoredAfterFailure={restoredAfterFailure}
    />
  );
};

export default Main;
