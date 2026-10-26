import { useEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

import { LIGHT_OUT_CHANNEL, broadcastLightOut, parseLightOut } from "../alerts";
import { LightEntry } from "../components/Lights";
import { RoomState, burnKey, isOut, mapLights, pause, pruneBurnedOut } from "../lights";
import { notify } from "../utils";

// How long to wait before re-recording a burn-out whose save failed.
export const BURN_OUT_RETRY_MS = 10_000;

// Everyone shows the went-out notification; only a GM sends it.
export const useLightOutListener = () =>
  useEffect(
    () =>
      OBR.broadcast.onMessage(LIGHT_OUT_CHANNEL, (event) => {
        const names = parseLightOut(event.data);
        if (names.length > 0) notify(`${names.join(", ")} went out!`, "WARNING");
      }),
    [],
  );

// GM-only alerting. Returns refs the GM's own removals fill: `removedByMe`
// so they don't read as "<player> removed ...", and `restoredAfterFailure`
// so a light a failed removal puts back doesn't read as "<player> lit ...".
export const useGmAlerts = ({
  gm,
  loaded,
  entries,
  state,
  now,
  update,
}: {
  gm: boolean;
  loaded: boolean;
  entries: LightEntry[];
  state: RoomState;
  now: number;
  update: (change: (s: RoomState) => RoomState) => Promise<boolean>;
}) => {
  const removedByMe = useRef(new Set<string>());
  // Player lights a failed GM removal put back (via resync): not newly lit.
  const restoredAfterFailure = useRef(new Set<string>());

  // Tell the GM about everything players do (light, pause or remove a
  // light), by diffing the room's lights against the last render. Lights
  // already burning when the panel opens don't count, nor do the GM's own
  // removals, nor the old light dropped when a player lights a new one.
  const seen = useRef<Map<string, LightEntry> | null>(null);
  useEffect(() => {
    if (!gm || !loaded) return;
    const current = new Map(entries.map((e) => [e.light.id, e]));
    const previous = seen.current;
    seen.current = current;
    if (previous === null) return;
    // Owners who lit something new in this change.
    const litBy = new Set<string>();
    for (const [id, e] of current) {
      if (e.ownerId !== null && !previous.has(id)) {
        if (restoredAfterFailure.current.delete(id)) {
          removedByMe.current.delete(id);
          continue;
        }
        litBy.add(e.ownerId);
        notify(`${e.ownerName || "A player"} lit ${e.light.name}`, "INFO");
      }
    }
    // A player's light set aside counts as "they paused it" only when they
    // also lit a new one. The GM lighting their token sets it aside too,
    // and that's the GM's doing, not the player's.
    for (const [id, e] of current) {
      const before = previous.get(id);
      if (e.ownerId === null || !before || !litBy.has(e.ownerId)) continue;
      if (e.light.setAside === "swap" && before.light.setAside !== "swap") {
        notify(`${e.ownerName || "A player"} paused ${e.light.name}`, "INFO");
      }
    }
    for (const [id, e] of previous) {
      if (e.ownerId === null || current.has(id) || litBy.has(e.ownerId)) continue;
      if (removedByMe.current.delete(id)) continue;
      notify(`${e.ownerName || "A player"} removed ${e.light.name}`, "INFO");
    }
  }, [gm, loaded, entries]);

  // Detect each burn-out once, player lights included, and announce it. The
  // GM's own lights are marked `alerted`; players' lights are recorded as
  // burnKeys in the shared state's `burnedOut`, so the GM never writes a
  // player's doc for this. A light that burned out while no GM panel was
  // open alerts on next open.
  // Records in flight or recently tried: id -> earliest time to try again
  // (Infinity while the write is in flight).
  const recording = useRef(new Map<string, number>());
  // Burn-outs already broadcast this session (a retried record mustn't re-alert).
  const broadcast = useRef(new Set<string>());
  // Wakes this check for a retry; nothing else may be ticking then.
  const [retryTick, setRetryTick] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  useEffect(() => {
    if (!gm || !loaded) return;
    const recorded = new Set(state.burnedOut);
    const announced = (e: LightEntry) =>
      e.light.alerted || (e.ownerId !== null && recorded.has(burnKey(e.light)));
    for (const e of entries) {
      if (!isOut(e.light, now)) {
        recording.current.delete(e.light.id);
        broadcast.current.delete(e.light.id);
      } else if (announced(e) && recording.current.get(e.light.id) === Infinity) {
        // Our record landed; if someone overwrites it, it's redone next time.
        recording.current.delete(e.light.id);
      }
    }
    const burnedOut = entries.filter(
      (e) => !announced(e) && isOut(e.light, now) && (recording.current.get(e.light.id) ?? 0) <= Date.now(),
    );
    if (burnedOut.length === 0) return;

    const ids = new Set(burnedOut.map((e) => e.light.id));
    ids.forEach((id) => recording.current.set(id, Infinity));
    const gmIds = new Set(burnedOut.filter((e) => e.ownerId === null).map((e) => e.light.id));
    const keys = burnedOut.filter((e) => e.ownerId !== null).map((e) => burnKey(e.light));
    const liveIds = new Set(entries.map((e) => e.light.id));
    update((s) => {
      const lights = mapLights(s.lights, (l) => (gmIds.has(l.id) ? { ...pause(l, Date.now()), alerted: true } : l));
      const burned = keys.length > 0 ? pruneBurnedOut([...s.burnedOut, ...keys], liveIds) : s.burnedOut;
      return lights === s.lights && burned === s.burnedOut ? s : { ...s, lights, burnedOut: burned };
    }).then((saved) => {
      // Saved: the in-flight mark stays until the record shows up in the room
      // (cleared above), so an overwritten record is redone on the next change.
      if (saved) return;
      // Failed: retry after a pause, never in a tight loop.
      ids.forEach((id) => recording.current.set(id, Date.now() + BURN_OUT_RETRY_MS));
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setRetryTick((t) => t + 1), BURN_OUT_RETRY_MS);
    });

    const fresh = burnedOut.filter((e) => !broadcast.current.has(e.light.id));
    fresh.forEach((e) => broadcast.current.add(e.light.id));
    broadcastLightOut(fresh.map((e) => e.light.name));
  }, [gm, loaded, entries, state.burnedOut, now, update, retryTick]);

  return { removedByMe, restoredAfterFailure };
};
