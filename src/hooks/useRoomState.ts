import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ID } from "../components/util/constants";
import {
  PlayerDoc,
  RoomState,
  emptyPlayerDoc,
  emptyRoomState,
  parsePlayerDoc,
  parseRoomState,
} from "../lights";
import { errorMessage, notify } from "../utils";

export const ROOM_KEY = `${ID}/state`;
export const PLAYER_KEY_PREFIX = `${ID}/player/`;
export const playerKey = (playerId: string) => PLAYER_KEY_PREFIX + playerId;

export type PlayerDocs = Record<string, PlayerDoc>;

// Who this client is. GMs may write the shared state and every player's doc;
// a player may write only their own doc.
export interface Writer {
  gm: boolean;
  playerId: string | null;
}

const playerDocsFrom = (metadata: Metadata): PlayerDocs => {
  const docs: PlayerDocs = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(PLAYER_KEY_PREFIX)) continue;
    const id = key.slice(PLAYER_KEY_PREFIX.length);
    if (id.length === 0 || id.length > 64) continue;
    docs[id] = parsePlayerDoc(value);
  }
  return docs;
};

// Shared state lives in room metadata so every client sees the same lights,
// late joiners get current state, and nothing is lost on reload.
export const useRoomState = ({ gm, playerId }: Writer) => {
  const [state, setState] = useState<RoomState>(emptyRoomState);
  const [playerDocs, setPlayerDocs] = useState<PlayerDocs>({});
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<RoomState>(state);
  const latestDocs = useRef<PlayerDocs>(playerDocs);

  // Change events can arrive after newer local writes (late echoes of our own
  // earlier writes), so ignore anything older than what we hold unless forced.
  // Each doc has its own rev.
  const apply = useCallback((metadata: Metadata, force = false) => {
    const next = parseRoomState(metadata[ROOM_KEY]);
    if (force || next.rev >= latest.current.rev) {
      latest.current = next;
      setState(next);
    }
    const incoming = playerDocsFrom(metadata);
    const docs: PlayerDocs = {};
    for (const [id, doc] of Object.entries(incoming)) {
      const held = latestDocs.current[id];
      docs[id] = !force && held && doc.rev < held.rev ? held : doc;
    }
    latestDocs.current = docs;
    setPlayerDocs(docs);
  }, []);

  const resync = useCallback(
    () =>
      OBR.room
        .getMetadata()
        .then((metadata) => apply(metadata, true))
        .catch((err) =>
          notify(`Torchlight couldn't load room state: ${errorMessage(err)}`, "ERROR"),
        ),
    [apply],
  );

  useEffect(() => {
    resync().finally(() => setLoaded(true));
    return OBR.room.onMetadataChange((metadata) => apply(metadata));
  }, [apply, resync]);

  const save = useCallback(
    (update: Metadata) =>
      OBR.room.setMetadata(update).catch((err) => {
        // Room metadata is capped at 16kB shared by all extensions, so a
        // write can fail. Say so and fall back to what the room holds.
        notify(`Torchlight couldn't save: ${errorMessage(err)}`, "ERROR");
        resync();
      }),
    [resync],
  );

  const update = useCallback(
    (change: (current: RoomState) => RoomState) => {
      if (!gm) return;
      const next = { ...change(latest.current), rev: latest.current.rev + 1 };
      latest.current = next;
      setState(next);
      save({ [ROOM_KEY]: next });
    },
    [gm, save],
  );

  const updatePlayer = useCallback(
    (id: string, change: (current: PlayerDoc) => PlayerDoc) => {
      if (!gm && id !== playerId) return;
      const current = latestDocs.current[id] ?? emptyPlayerDoc();
      const next = { ...change(current), rev: current.rev + 1 };
      latestDocs.current = { ...latestDocs.current, [id]: next };
      setPlayerDocs(latestDocs.current);
      save({ [playerKey(id)]: next });
    },
    [gm, playerId, save],
  );

  return { state, playerDocs, loaded, update, updatePlayer };
};
