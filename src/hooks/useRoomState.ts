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

// How the panel stays in step with the room (details: docs/state-sync.md):
//
// 1. While one of our writes to a doc is in flight, room events for that doc
//    are ignored: ours lands after anything they carry and replaces it.
// 2. A late echo of our own older write is ignored.
// 3. When a write settles, saved or failed, read the room once and take it as
//    truth for every doc with nothing in flight. That reverts a failed write
//    and picks up anything rule 1 ignored.
//
// Nothing here trusts a seq read from the room beyond comparing it with what
// we sent. State is module-level so it survives the panel remounting (tab
// switches, scene changes); only one useRoomState is ever mounted.
const WRITER = crypto.randomUUID().slice(0, 8);
let lastSeq = 0;
const lastSent = new Map<string, number>(); // doc key -> seq of our latest write
const pending = new Map<string, number>(); // doc key -> writes of ours in flight

const inFlight = (key: string) => (pending.get(key) ?? 0) > 0;

const send = (key: string) => {
  lastSeq += 1;
  lastSent.set(key, lastSeq);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  return { writer: WRITER, seq: lastSeq };
};
const settle = (key: string) => {
  const n = (pending.get(key) ?? 1) - 1;
  if (n > 0) pending.set(key, n);
  else pending.delete(key);
};

// Rules 1 and 2, for one doc in a live event.
const takeEvent = (key: string, doc: Stamp) =>
  !inFlight(key) && !(doc.writer === WRITER && doc.seq < (lastSent.get(key) ?? 0));

// The mounted panel's re-read (rule 3). A save from a panel that has since
// unmounted (tab switch mid-write) re-reads into the one that's open now.
let mountedResync: (() => void) | null = null;

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
  // Last Torchlight slice applied (other extensions' writes are skipped), and
  // how many Torchlight events have been applied, so a room read that an
  // event overtook can be told apart.
  const lastSignature = useRef<string | null>(null);
  const applied = useRef(0);
  // Holding back the room's copy only makes sense if we hold one. Until this
  // mount has taken the shared state once (say it remounted mid-write), it
  // takes the room's; the panel isn't loaded until it has.
  const haveState = useRef(false);

  const apply = useCallback((metadata: Metadata, from: "event" | "snapshot") => {
    const signature = torchlightSignature(metadata);
    if (from === "event") {
      if (signature === lastSignature.current) return;
      applied.current += 1;
    }
    lastSignature.current = signature;
    // A snapshot is the room's truth; only in-flight docs keep our copy.
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
      docs[id] = !held || take(playerKey(id), doc) ? doc : held;
    }
    // A doc we just created may not be in the room yet; keep it until it is.
    for (const [id, held] of Object.entries(latestDocs.current)) {
      if (!(id in docs) && inFlight(playerKey(id))) docs[id] = held;
    }
    latestDocs.current = docs;
    setPlayerDocs(docs);
  }, []);

  // Rule 3: read the room and take it. A read that a Torchlight event
  // overtook is older than that event, so read again. Resolves true once a
  // read was applied.
  const mounted = useRef(true);
  const readOnce = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 5 && mounted.current; attempt++) {
      const asked = applied.current;
      const metadata = await OBR.room.getMetadata();
      if (!mounted.current) return false;
      if (applied.current === asked) {
        apply(metadata, "snapshot");
        return true;
      }
    }
    return false;
  }, [apply]);

  // One re-read loop at a time. Requests while it runs or waits just mark it
  // to read again once more; failures back off up to 30 s and the user is
  // told once. Until the first read lands the panel stays on "Loading…":
  // unlocking with an empty state would let the next edit wipe the room.
  const loop = useRef({ running: false, again: false, wait: 1000, told: false });
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const requestResync = useCallback(() => {
    const l = loop.current;
    if (l.running) {
      l.again = true;
      return;
    }
    l.running = true;
    l.again = false;
    readOnce()
      .then((done) => {
        if (done) {
          l.wait = 1000;
          l.told = false;
          if (haveState.current) setLoaded(true);
        }
        return done;
      })
      .catch((err) => {
        if (!l.told) notify(`Torchlight couldn't load room state: ${errorMessage(err)}`, "ERROR");
        l.told = true;
        l.wait = Math.min(l.wait * 2, 30_000);
        return false;
      })
      .then((done) => {
        l.running = false;
        if (!mounted.current) return;
        if (!done) {
          clearTimeout(retry.current);
          retry.current = setTimeout(requestResync, l.wait);
        } else if (l.again) {
          requestResync();
        }
      });
  }, [readOnce]);

  useEffect(() => {
    mounted.current = true;
    const mine = () => requestResync();
    mountedResync = mine;
    requestResync();
    const off = OBR.room.onMetadataChange((metadata) => apply(metadata, "event"));
    return () => {
      mounted.current = false;
      clearTimeout(retry.current);
      if (mountedResync === mine) mountedResync = null;
      off();
    };
  }, [apply, requestResync]);

  // Resolves true once the write landed, false if it failed (the user is
  // told). Either way it settles and the room is re-read (rule 3).
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
          Object.keys(update).forEach(settle);
          mountedResync?.();
          return saved;
        }),
    [],
  );

  // Changes that return the same object are no-ops and write nothing.
  const update = useCallback(
    (change: (current: RoomState) => RoomState): Promise<boolean> => {
      if (!gm) return Promise.resolve(false);
      const changed = change(latest.current);
      if (changed === latest.current) return Promise.resolve(true);
      const next = restamp(changed, send(ROOM_KEY));
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
      const next = restamp(changed, send(playerKey(id)));
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
          const next = restamp({ ...latest.current, lights }, send(ROOM_KEY));
          latest.current = next;
          write[ROOM_KEY] = next;
        } else {
          if (!gm && owner !== playerId) continue;
          const current = latestDocs.current[owner] ?? emptyPlayerDoc();
          const lights = change(current.lights);
          if (lights === current.lights) continue;
          const next = restamp({ ...current, lights }, send(playerKey(owner)));
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
