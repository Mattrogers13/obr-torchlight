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
  // Burn-outs recently recorded or tried: id -> earliest time to try again.
  const recording = useRef(new Map<string, number>());
  // Burn-outs already broadcast this session (a retried record mustn't re-alert).
  const broadcast = useRef(new Set<string>());
  // Recorded or being recorded, not yet announced; a re-armed light drops out.
  const pendingAnnounce = useRef(new Set<string>());
  // Wakes this check for a retry; nothing else may be ticking then.
  const [retryTick, setRetryTick] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  useEffect(() => {
    if (!gm || !loaded) return;
    const recorded = new Set(state.burnedOut);
    const announced = (e: LightEntry) =>
      e.light.alerted || (e.ownerId !== null && recorded.has(burnKey(e.light)));
    // Forget lights that are gone (removed while burned out).
    const liveIds = new Set(entries.map((e) => e.light.id));
    for (const set of [broadcast.current, pendingAnnounce.current]) {
      set.forEach((id) => liveIds.has(id) || set.delete(id));
    }
    recording.current.forEach((_t, id) => liveIds.has(id) || recording.current.delete(id));
    for (const e of entries) {
      if (!isOut(e.light, now)) {
        recording.current.delete(e.light.id);
        broadcast.current.delete(e.light.id);
        pendingAnnounce.current.delete(e.light.id);
      }
    }
    const burnedOut = entries.filter(
      (e) => !announced(e) && isOut(e.light, now) && (recording.current.get(e.light.id) ?? 0) <= Date.now(),
    );
    if (burnedOut.length === 0) return;

    // Don't record these again until BURN_OUT_RETRY_MS from now, whatever
    // happens: a failed record is retried then, and so is one another writer
    // overwrote. Set before writing, so no ordering of the save's callbacks
    // can turn this into a tight loop.
    const retryAt = Date.now() + BURN_OUT_RETRY_MS;
    const ids = new Set(burnedOut.map((e) => e.light.id));
    ids.forEach((id) => recording.current.set(id, retryAt));
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => setRetryTick((t) => t + 1), BURN_OUT_RETRY_MS);
    const gmIds = new Set(burnedOut.filter((e) => e.ownerId === null).map((e) => e.light.id));
    const keys = burnedOut.filter((e) => e.ownerId !== null).map((e) => burnKey(e.light));
    // Ids this write actually records. Another GM may have recorded some
    // already; then this write is a no-op for them and they mustn't be
    // announced twice.
    const recordedNow = new Set<string>();
    burnedOut.forEach((e) => pendingAnnounce.current.add(e.light.id));
    update((s) => {
      const lights = mapLights(s.lights, (l) => {
        if (!gmIds.has(l.id) || l.alerted) return l;
        recordedNow.add(l.id);
        return { ...pause(l, Date.now()), alerted: true };
      });
      const had = new Set(s.burnedOut);
      const added = burnedOut.filter((e) => e.ownerId !== null && !had.has(burnKey(e.light)));
      added.forEach((e) => recordedNow.add(e.light.id));
      const burned = added.length > 0 ? pruneBurnedOut([...s.burnedOut, ...keys], liveIds) : s.burnedOut;
      return lights === s.lights && burned === s.burnedOut ? s : { ...s, lights, burnedOut: burned };
    }).then((saved) => {
      if (saved) {
        // Tell the room once the burn-out is recorded (like Put out): only what
        // this write recorded, only once, and not if it was re-armed meanwhile.
        const fresh = burnedOut.filter(
          (e) =>
            recordedNow.has(e.light.id) &&
            pendingAnnounce.current.has(e.light.id) &&
            !broadcast.current.has(e.light.id),
        );
        fresh.forEach((e) => broadcast.current.add(e.light.id));
        broadcastLightOut(fresh.map((e) => e.light.name));
      }
      // Failed: retried at retryAt (set above).
    });
  }, [gm, loaded, entries, state.burnedOut, now, update, retryTick]);

  return { removedByMe, restoredAfterFailure };
};
