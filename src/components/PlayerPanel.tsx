import React, { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

import { useActiveOnly } from "../hooks/useActiveOnly";
import {
  Light,
  LightKind,
  LightSource,
  PlayerDoc,
  RoomState,
  cleanName,
  createLight,
  isActive,
  lightName,
  replacePlayerLight,
} from "../lights";
import { ActiveFilter, AddLightForm, LightEntry, PlayerLightList } from "./Lights";
import PlayerView from "./PlayerView";

// A player's view: one list with their own lights first, then everyone
// else's when the GM shares them. They may add (one at a time) and remove
// their own, if the GM allows.
const PlayerPanel: React.FC<{
  myId: string;
  state: RoomState;
  entries: LightEntry[];
  mine: Light[];
  now: number;
  updatePlayer: (id: string, change: (d: PlayerDoc) => PlayerDoc) => Promise<boolean>;
}> = ({ myId, state, entries, mine, now, updatePlayer }) => {
  const [myName, setMyName] = useState("");
  const [activeOnly, toggleActiveOnly] = useActiveOnly();

  useEffect(() => {
    OBR.player.getName().then(setMyName).catch(() => {});
    return OBR.player.onChange((p) => setMyName(p.name));
  }, []);

  if (!state.showToPlayers && !state.playersCanAdd && mine.length === 0) return <PlayerView />;

  const ownName = (source: LightSource) => lightName(myName, source);
  // One light at a time: lighting a new one pauses the current one.
  const addOwnLight = (name: string, kind: LightKind, amount: number, source: LightSource) =>
    updatePlayer(myId, (d) => {
      if (!state.playersCanAdd) return d;
      const t = Date.now();
      const fresh = createLight(crypto.randomUUID(), cleanName(name, ownName(source)), kind, amount, t, { source });
      return { ...d, ownerName: cleanName(myName, "Player"), lights: replacePlayerLight(d.lights, fresh, t) };
    });
  const removeOwnLight = (light: Light) => {
    if (!state.playersCanRemove) return;
    updatePlayer(myId, (d) => ({ ...d, lights: d.lights.filter((l) => l.id !== light.id) }));
  };

  const burning = mine.find((l) => isActive(l, now));
  const others = entries.filter((e) => e.ownerId !== myId).map((e) => e.light);
  const shared = state.showToPlayers ? [...mine, ...others] : mine;
  const visible = activeOnly ? shared.filter((l) => isActive(l, now)) : shared;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4 text-theme">Torchlight</h1>
      <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
        <h2 className="text-lg font-semibold mb-3 text-theme">Light Sources</h2>
        {state.playersCanAdd && (
          <>
            <AddLightForm defaultName={ownName} disabled={false} onAdd={addOwnLight} />
            {burning && (
              <p className="-mt-2 mb-4 text-sm text-theme-secondary">Lighting a new one pauses {burning.name}.</p>
            )}
          </>
        )}
        {shared.length > 0 && <ActiveFilter checked={activeOnly} onToggle={toggleActiveOnly} />}
        <PlayerLightList
          lights={visible}
          now={now}
          onRemove={state.playersCanRemove ? removeOwnLight : undefined}
          removable={new Set(mine.map((l) => l.id))}
        />
      </div>
    </div>
  );
};

export default PlayerPanel;
