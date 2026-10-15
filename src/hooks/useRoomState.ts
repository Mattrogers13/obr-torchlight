import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "../constants";
import {
  Light,
  PlayerDoc,
  RoomState,
  emptyPlayerDoc,
  emptyRoomState,
  parsePlayerDocs,
  parseRoomState,
  torchlightSignature,
} from "../lights";
import { errorMessage, notify } from "../utils";

export type PlayerDocs = Record<string, PlayerDoc>;

// Who this client is. GMs may write the shared state and every player's doc;
// a player may write only their own doc.
export interface Writer {
  gm: boolean;
  playerId: string | null;
}

// Shared state lives in room metadata so every client sees the same lights,
// late joiners get current state, and nothing is lost on reload.
export const useRoomState = ({ gm, playerId }: Writer) => {
  const [state, setState] = useState<RoomState>(emptyRoomState);
  const [playerDocs, setPlayerDocs] = useState<PlayerDocs>({});
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<RoomState>(state);
  const latestDocs = useRef<PlayerDocs>(playerDocs);

  // Who we are as a writer, and the seq of our latest write to each doc.
  const writerId = useRef(crypto.randomUUID().slice(0, 8));
  const seq = useRef(0);
  const ourLatest = useRef(new Map<string, number>());
  const stamp = (key: string) => {
    seq.current += 1;
    ourLatest.current.set(key, seq.current);
    return { writer: writerId.current, seq: seq.current };
  };
  // A late echo of our own older write to this doc. Anything written by
  // someone else (another GM, the right-click menu, a player) is current
  // room state, whatever its rev, so it's never treated as stale.
  const isOwnStaleEcho = (key: string, doc: { writer: string; seq: number }) =>
    doc.writer === writerId.current && doc.seq < (ourLatest.current.get(key) ?? 0);

  // Room metadata is shared with every extension; skip changes that didn't
  // touch Torchlight's keys.
  const lastSignature = useRef<string | null>(null);

  const apply = useCallback((metadata: Metadata, force = false) => {
    const signature = torchlightSignature(metadata);
    if (!force && signature === lastSignature.current) return;
    lastSignature.current = signature;

    const next = parseRoomState(metadata[ROOM_KEY]);
    if (force || !isOwnStaleEcho(ROOM_KEY, next)) {
      latest.current = next;
      setState(next);
    }
    const incoming = parsePlayerDocs(metadata);
    const docs: PlayerDocs = {};
    for (const [id, doc] of Object.entries(incoming)) {
      const held = latestDocs.current[id];
      docs[id] = !force && held && isOwnStaleEcho(playerKey(id), doc) ? held : doc;
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

  // Resolves true once the write landed, false if it failed (in which case
  // the user is told and local state falls back to what the room holds).
  const save = useCallback(
    (update: Metadata): Promise<boolean> =>
      OBR.room.setMetadata(update).then(
        () => true,
        (err) => {
          // Room metadata is capped at 16kB shared by all extensions, so a
          // write can fail. Say so and fall back to what the room holds.
          notify(`Torchlight couldn't save: ${errorMessage(err)}`, "ERROR");
          resync();
          return false;
        },
      ),
    [resync],
  );

  // Changes that return the same object are no-ops and write nothing.
  const update = useCallback(
    (change: (current: RoomState) => RoomState): Promise<boolean> => {
      if (!gm) return Promise.resolve(false);
      const changed = change(latest.current);
      if (changed === latest.current) return Promise.resolve(true);
      const next = { ...changed, rev: latest.current.rev + 1, ...stamp(ROOM_KEY) };
      latest.current = next;
      setState(next);
      return save({ [ROOM_KEY]: next });
    },
    [gm, save],
  );

  const updatePlayer = useCallback(
    (id: string, change: (current: PlayerDoc) => PlayerDoc): Promise<boolean> => {
      if (!gm && id !== playerId) return Promise.resolve(false);
      const current = latestDocs.current[id] ?? emptyPlayerDoc();
      const changed = change(current);
      if (changed === current) return Promise.resolve(true);
      const next = { ...changed, rev: current.rev + 1, ...stamp(playerKey(id)) };
      latestDocs.current = { ...latestDocs.current, [id]: next };
      setPlayerDocs(latestDocs.current);
      return save({ [playerKey(id)]: next });
    },
    [gm, playerId, save],
  );

  // Change lights in several docs (the shared state and any player docs) in
  // ONE metadata write, so a GM action across players lands all-or-nothing.
  // Keys: null = shared state, otherwise a player id. Docs whose lights come
  // back unchanged aren't written.
  const updateLights = useCallback(
    (changes: Map<string | null, (lights: Light[]) => Light[]>): Promise<boolean> => {
      const write: Metadata = {};
      for (const [owner, change] of changes) {
        if (owner === null) {
          if (!gm) continue;
          const lights = change(latest.current.lights);
          if (lights === latest.current.lights) continue;
          const next = { ...latest.current, lights, rev: latest.current.rev + 1, ...stamp(ROOM_KEY) };
          latest.current = next;
          write[ROOM_KEY] = next;
        } else {
          if (!gm && owner !== playerId) continue;
          const current = latestDocs.current[owner] ?? emptyPlayerDoc();
          const lights = change(current.lights);
          if (lights === current.lights) continue;
          const next = { ...current, lights, rev: current.rev + 1, ...stamp(playerKey(owner)) };
          latestDocs.current = { ...latestDocs.current, [owner]: next };
          write[playerKey(owner)] = next;
        }
      }
      if (Object.keys(write).length === 0) return Promise.resolve(true);
      if (ROOM_KEY in write) setState(latest.current);
      setPlayerDocs(latestDocs.current);
      return save(write);
    },
    [gm, playerId, save],
  );

  return { state, playerDocs, loaded, update, updatePlayer, updateLights };
};
