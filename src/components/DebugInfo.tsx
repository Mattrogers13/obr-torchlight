import React, { useEffect, useState } from "react";
import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { PLAYER_KEY_PREFIX, ROOM_KEY } from "../constants";
import { parsePlayerDoc, parseRoomState } from "../lights";

// Dev builds only (About tab): what this client is and what the room holds,
// so ownership and sync problems can be diagnosed from a screenshot.

interface Snapshot {
  me: { id: string; role: string; name: string };
  party: Map<string, string>; // other players: id -> name
  metadata: Metadata;
}

const short = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

const DebugInfo: React.FC = () => {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [role, name, players, metadata] = await Promise.all([
        OBR.player.getRole(),
        OBR.player.getName(),
        OBR.party.getPlayers(),
        OBR.room.getMetadata(),
      ]);
      if (alive) {
        setSnap({
          me: { id: OBR.player.id, role, name },
          party: new Map(players.map((p) => [p.id, p.name])),
          metadata,
        });
      }
    };
    load().catch(() => {});
    const offRoom = OBR.room.onMetadataChange(() => load().catch(() => {}));
    const offParty = OBR.party.onChange(() => load().catch(() => {}));
    return () => {
      alive = false;
      offRoom();
      offParty();
    };
  }, []);

  if (!snap) return null;
  const state = parseRoomState(snap.metadata[ROOM_KEY]);
  const docs = Object.entries(snap.metadata).filter(([k]) => k.startsWith(PLAYER_KEY_PREFIX));

  return (
    <div className="mt-4 p-3 rounded border border-theme text-xs font-mono text-theme-secondary text-left break-all">
      <div className="font-bold text-theme mb-1">Debug (dev builds only)</div>
      <div>
        me: {snap.me.name} · {snap.me.role} · {snap.me.id}
      </div>
      <div>
        shared: rev {state.rev} · {state.lights.length} lights · canAdd {String(state.playersCanAdd)} ·
        canRemove {String(state.playersCanRemove)} · shown {String(state.showToPlayers)}
      </div>
      <div className="mt-1">player docs ({docs.length}):</div>
      {docs.map(([key, value]) => {
        const id = key.slice(PLAYER_KEY_PREFIX.length);
        const doc = parsePlayerDoc(value);
        const who = id === snap.me.id ? "ME" : snap.party.has(id) ? `in room: ${snap.party.get(id)}` : "NOT IN ROOM";
        return (
          <div key={key}>
            · {short(id)} [{who}] "{doc.ownerName}" rev {doc.rev}:{" "}
            {doc.lights.map((l) => `${l.name}${l.setAside ? ` (${l.setAside})` : ""}`).join(", ") || "none"}
          </div>
        );
      })}
      <div className="mt-1">
        room keys: {Object.keys(snap.metadata).length} · ~{JSON.stringify(snap.metadata).length} bytes of 16kB
      </div>
    </div>
  );
};

export default DebugInfo;
