import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "../constants";
import {
  Light,
  PlayerDoc,
  RoomState,
  Stamp,
  emptyPlayerDoc,
  emptyRoomState,
  parsePlayerDocs,
  parseRoomState,
  restamp,
  torchlightSignature,
} from "../lights";
import { errorMessage, notify } from "../utils";

export type PlayerDocs = Record<string, PlayerDoc>;

// This client as a writer. Module-level, so it lasts for the page load and
// survives the panel remounting (tab switches, scene changes).
const WRITER = crypto.randomUUID().slice(0, 8);
let lastSeq = 0;
const ourLatest = new Map<string, number>(); // doc key -> seq of our latest write
const ourSettled = new Map<string, number>(); // doc key -> highest seq of ours that landed or failed

const nextStamp = (key: string): Stamp => {
  lastSeq += 1;
  ourLatest.set(key, lastSeq);
  return { writer: WRITER, seq: lastSeq };
};
const settle = (key: string, seq: number) => ourSettled.set(key, Math.max(ourSettled.get(key) ?? 0, seq));
// One of our writes to this doc hasn't landed (or failed) yet.
const inFlight = (key: string) => (ourSettled.get(key) ?? 0) < (ourLatest.get(key) ?? 0);

// Two rules keep the panel in step with the room (details: docs/state-sync.md):
//
// 1. Live change events: ignore late echoes of our own older writes, and
//    hold off another writer's doc while one of ours to it is in flight (ours
//    lands after it and replaces it).
// 2. After each of our writes settles, saved or failed, read the room and
//    take that snapshot as truth for every doc we have nothing in flight on.
//    That reverts a failed write and picks up anything rule 1 held off.
const takeEvent = (key: string, doc: Stamp) => {
  if (doc.writer === WRITER) {
    settle(key, doc.seq);
    return doc.seq >= (ourLatest.get(key) ?? 0);
  }
  return !inFlight(key);
};

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
  // Last Torchlight slice applied, and how many Torchlight changes we've seen
  // (other extensions' writes count for neither).
  const lastSignature = useRef<string | null>(null);
  const changes = useRef(0);
  // Holding off a doc only makes sense if we hold one. Until this mount has
  // taken the shared state once, it takes whatever the room has (player docs
  // get the same via `!held` below).
  const haveState = useRef(false);

  const apply = useCallback((metadata: Metadata, from: "event" | "snapshot") => {
    const signature = torchlightSignature(metadata);
    if (from === "event") {
      if (signature === lastSignature.current) return;
      changes.current += 1;
    }
    lastSignature.current = signature;
    const take = (key: string, doc: Stamp) => (from === "snapshot" ? !inFlight(key) : takeEvent(key, doc));

    const next = parseRoomState(metadata[ROOM_KEY]);
    if (take(ROOM_KEY, next) || !haveState.current) {
      haveState.current = true;
      latest.current = next;
      setState(next);
    }
    const incoming = parsePlayerDocs(metadata);
    const docs: PlayerDocs = {};
    for (const [id, doc] of Object.entries(incoming)) {
      const held = latestDocs.current[id];
      // take() runs first: on events it records our echoes even with nothing held.
      docs[id] = take(playerKey(id), doc) || !held ? doc : held;
    }
    // A doc we just created may not be in the room yet; keep it until it is.
    for (const [id, held] of Object.entries(latestDocs.current)) {
      if (!(id in docs) && inFlight(playerKey(id))) docs[id] = held;
    }
    latestDocs.current = docs;
    setPlayerDocs(docs);
  }, []);

  // Read the room and take it as truth (rule 2). A snapshot is only good if
  // no Torchlight change arrived while it was in flight (that change is
  // newer); otherwise read again, so the panel always converges.
  const resync = useCallback(async () => {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const asked = changes.current;
        const metadata = await OBR.room.getMetadata();
        if (changes.current === asked) return apply(metadata, "snapshot");
      }
    } catch (err) {
      notify(`Torchlight couldn't load room state: ${errorMessage(err)}`, "ERROR");
    }
  }, [apply]);

  useEffect(() => {
    resync().finally(() => setLoaded(true));
    return OBR.room.onMetadataChange((metadata) => apply(metadata, "event"));
  }, [apply, resync]);

  // Resolves true once the write landed, false if it failed (the user is told).
  // Either way the write is settled and the room is re-read (rule 2).
  const save = useCallback(
    (update: Metadata): Promise<boolean> =>
      OBR.room
        .setMetadata(update)
        .then(
          () => true,
          (err) => {
            // Room metadata is capped at 16kB shared by all extensions.
            notify(`Torchlight couldn't save: ${errorMessage(err)}`, "ERROR");
            return false;
          },
        )
        .then((saved) => {
          for (const [key, doc] of Object.entries(update)) settle(key, (doc as Stamp).seq);
          resync();
          return saved;
        }),
    [resync],
  );

  // Changes that return the same object are no-ops and write nothing.
  const update = useCallback(
    (change: (current: RoomState) => RoomState): Promise<boolean> => {
      if (!gm) return Promise.resolve(false);
      const changed = change(latest.current);
      if (changed === latest.current) return Promise.resolve(true);
      const next = restamp({ ...changed, rev: latest.current.rev }, nextStamp(ROOM_KEY));
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
      const next = restamp({ ...changed, rev: current.rev }, nextStamp(playerKey(id)));
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
          const next = restamp({ ...latest.current, lights }, nextStamp(ROOM_KEY));
          latest.current = next;
          write[ROOM_KEY] = next;
        } else {
          if (!gm && owner !== playerId) continue;
          const current = latestDocs.current[owner] ?? emptyPlayerDoc();
          const lights = change(current.lights);
          if (lights === current.lights) continue;
          const next = restamp({ ...current, lights }, nextStamp(playerKey(owner)));
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
