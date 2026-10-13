import { useCallback, useEffect, useRef, useState } from "react";
import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ID } from "../components/util/constants";
import { RoomState, emptyRoomState, parseRoomState } from "../lights";
import { errorMessage, notify } from "../utils";

export const ROOM_KEY = `${ID}/state`;

// Shared state lives in room metadata so every client sees the same lights,
// late joiners get current state, and nothing is lost on reload.
// Only writers (GMs) may update; players get a read-only view.
export const useRoomState = (canWrite: boolean) => {
  const [state, setState] = useState<RoomState>(emptyRoomState);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<RoomState>(state);

  // Change events can arrive after newer local writes (late echoes of our own
  // earlier writes), so ignore anything older than what we hold unless forced.
  const apply = useCallback((metadata: Metadata, force = false) => {
    const next = parseRoomState(metadata[ROOM_KEY]);
    if (!force && next.rev < latest.current.rev) return;
    latest.current = next;
    setState(next);
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

  const update = useCallback(
    (change: (current: RoomState) => RoomState) => {
      if (!canWrite) return;
      const next = { ...change(latest.current), rev: latest.current.rev + 1 };
      latest.current = next;
      setState(next);
      OBR.room.setMetadata({ [ROOM_KEY]: next }).catch((err) => {
        // Room metadata is capped at 16kB shared by all extensions, so a
        // write can fail. Tell the GM and fall back to what the room holds.
        notify(`Torchlight couldn't save: ${errorMessage(err)}`, "ERROR");
        resync();
      });
    },
    [canWrite, resync],
  );

  return { state, loaded, update };
};
