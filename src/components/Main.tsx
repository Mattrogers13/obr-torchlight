import React, { useEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

import PlayerView from "./PlayerView";
import { ID } from "./util/constants";
import { errorMessage, notify } from "../utils";
import { useRoomState } from "../hooks/useRoomState";
import { useNow } from "../hooks/useNow";
import {
  LIMITS,
  Light,
  LightKind,
  adjustTime,
  adjustTurns,
  cleanName,
  createLight,
  isOut,
  LightSource,
  isActive,
  isRunning,
  lightName,
  nextDefaultName,
  pause,
  replacePlayerLight,
  reset,
  resume,
  setAsideLight,
} from "../lights";
import {
  AddLightForm,
  EyeIcon,
  EyeSlashIcon,
  GmBulkActions,
  LightEntry,
  LightRow,
  PlayerLightList,
} from "./Lights";

export const LIGHT_OUT_CHANNEL = `${ID}/light-out`;

// Broadcasts can come from any client, so only accept a short list of strings.
const parseLightOut = (data: unknown): string[] =>
  Array.isArray(data)
    ? data.filter((n): n is string => typeof n === "string").slice(0, LIMITS.maxLights)
        .map((n) => n.slice(0, LIMITS.maxNameLength))
    : [];

type Entry = LightEntry;

const Main: React.FC<{ player: boolean }> = ({ player }) => {
  const myId = OBR.player.id;
  const [myName, setMyName] = useState("");
  const { state, playerDocs, loaded, update, updatePlayer } = useRoomState({
    gm: !player,
    playerId: myId,
  });
  const entries: Entry[] = [
    ...state.lights.map((light) => ({ light, ownerId: null, ownerName: "" })),
    ...Object.entries(playerDocs).flatMap(([ownerId, doc]) =>
      doc.lights.map((light) => ({ light, ownerId, ownerName: doc.ownerName })),
    ),
  ];
  const anyRunning = entries.some((e) => isRunning(e.light));
  const now = useNow(anyRunning);
  const alertsSent = useRef(new Set<string>());

  // GM only: tell the GM about everything players do (light, pause or
  // remove a light), by diffing the room's lights against the last render.
  // Lights already burning when the panel opens don't count, nor do the GM's
  // own removals, nor the old light dropped when a player lights a new one.
  const seen = useRef<Map<string, Entry> | null>(null);
  const removedByMe = useRef(new Set<string>());
  useEffect(() => {
    if (player || !loaded) return;
    const current = new Map(entries.map((e) => [e.light.id, e]));
    const previous = seen.current;
    seen.current = current;
    if (previous === null) return;
    const litBy = new Set<string>();
    for (const [id, e] of current) {
      if (e.ownerId === null) continue;
      const before = previous.get(id);
      if (!before) {
        litBy.add(e.ownerId);
        notify(`${e.ownerName || "A player"} lit ${e.light.name}`, "INFO");
      } else if (e.light.setAside === "swap" && before.light.setAside !== "swap") {
        notify(`${e.ownerName || "A player"} paused ${e.light.name}`, "INFO");
      }
    }
    for (const [id, e] of previous) {
      if (e.ownerId === null || current.has(id) || litBy.has(e.ownerId)) continue;
      if (removedByMe.current.delete(id)) continue;
      notify(`${e.ownerName || "A player"} removed ${e.light.name}`, "INFO");
    }
  }, [loaded, state.lights, playerDocs, player]);

  useEffect(() => {
    if (!player) return;
    OBR.player.getName().then(setMyName).catch(() => {});
    return OBR.player.onChange((p) => setMyName(p.name));
  }, [player]);

  // Everyone shows the burn-out notification; only a GM sends it.
  useEffect(
    () =>
      OBR.broadcast.onMessage(LIGHT_OUT_CHANNEL, (event) => {
        const names = parseLightOut(event.data);
        if (names.length > 0) {
          notify(`${names.join(", ")} went out!`, "WARNING");
        }
      }),
    [],
  );

  // Routes a change to whichever metadata key owns the lights.
  const changeLights = (ownerId: string | null, change: (lights: Light[]) => Light[]) =>
    ownerId === null
      ? update((s) => ({ ...s, lights: change(s.lights) }))
      : updatePlayer(ownerId, (d) => ({ ...d, lights: change(d.lights) }));

  // GM only: detect burn-out once per light, player lights included. The
  // `alerted` flag in room state stops repeats across reloads; the ref covers
  // the gap before the write lands. A light that burned out while no GM panel
  // was open alerts on next open.
  useEffect(() => {
    if (player || !loaded) return;
    for (const { light } of entries) {
      if (!light.alerted && !isOut(light, now)) alertsSent.current.delete(light.id);
    }
    const burnedOut = entries.filter(
      ({ light: l }) => !l.alerted && isOut(l, now) && !alertsSent.current.has(l.id),
    );
    if (burnedOut.length === 0) return;

    const ids = new Set(burnedOut.map((e) => e.light.id));
    ids.forEach((id) => alertsSent.current.add(id));
    const owners = new Set(burnedOut.map((e) => e.ownerId));
    owners.forEach((ownerId) =>
      changeLights(ownerId, (lights) =>
        lights.map((l) => (ids.has(l.id) ? { ...pause(l, Date.now()), alerted: true } : l)),
      ),
    );
    const names = burnedOut.map((e) => e.light.name);
    OBR.broadcast
      .sendMessage(LIGHT_OUT_CHANNEL, names, { destination: "ALL" })
      .catch((err) =>
        // The GM still needs the alert, and needs to know players missed it.
        notify(
          `${names.join(", ")} went out! (Couldn't alert players: ${errorMessage(err)})`,
          "WARNING",
        ),
      );
  }, [player, loaded, state.lights, playerDocs, now, update, updatePlayer]);

  const updateLight = (entry: Entry, change: (light: Light) => Light) =>
    changeLights(entry.ownerId, (lights) =>
      lights.map((l) => (l.id === entry.light.id ? change(l) : l)),
    );

  const removeLight = (entry: Entry) => {
    removedByMe.current.add(entry.light.id);
    changeLights(entry.ownerId, (lights) => lights.filter((l) => l.id !== entry.light.id));
  };

  const addLight = (name: string, kind: LightKind, amount: number, source: LightSource) =>
    update((s) =>
      s.lights.length >= LIMITS.maxLights
        ? s
        : {
            ...s,
            lights: [
              ...s.lights,
              createLight(
                crypto.randomUUID(),
                cleanName(name, nextDefaultName(s.lights)),
                kind,
                amount,
                Date.now(),
                { source },
              ),
            ],
          },
    );

  const toggleLight = (entry: Entry) => {
    const t = Date.now();
    updateLight(entry, (l) => (isRunning(l) ? pause(l, t) : resume(l, t)));
  };

  const setAllRunning = (running: boolean) => {
    const t = Date.now();
    const owners = new Set(entries.filter((e) => e.light.kind === "time").map((e) => e.ownerId));
    owners.forEach((ownerId) =>
      // Resume all never relights a paused light.
      changeLights(ownerId, (lights) =>
        lights.map((l) => (running ? (l.setAside ? l : resume(l, t)) : pause(l, t))),
      ),
    );
  };

  // GM: put out the checked lights (wind, water, a dispel). They keep their
  // time, show "Put out", and everyone gets the went-out alert.
  const putOut = (ids: Set<string>) => {
    const t = Date.now();
    const hit = entries.filter((e) => ids.has(e.light.id) && isActive(e.light, t));
    if (hit.length === 0) return;
    new Set(hit.map((e) => e.ownerId)).forEach((ownerId) =>
      changeLights(ownerId, (lights) =>
        lights.map((l) => (ids.has(l.id) && isActive(l, t) ? setAsideLight(l, t, "put-out") : l)),
      ),
    );
    const names = hit.map((e) => e.light.name);
    OBR.broadcast
      .sendMessage(LIGHT_OUT_CHANNEL, names, { destination: "ALL" })
      .catch((err) =>
        notify(`${names.join(", ")} went out! (Couldn't alert players: ${errorMessage(err)})`, "WARNING"),
      );
  };

  const removeAll = () => {
    entries.forEach((e) => removedByMe.current.add(e.light.id));
    new Set(entries.map((e) => e.ownerId)).forEach((ownerId) => changeLights(ownerId, () => []));
  };

  if (!loaded) {
    return <div className="p-4 text-theme-secondary">Loading…</div>;
  }

  if (player) {
    const mine = playerDocs[myId]?.lights ?? [];
    const others = entries.filter((e) => e.ownerId !== myId).map((e) => e.light);
    if (!state.showToPlayers && !state.playersCanAdd && mine.length === 0) {
      return <PlayerView />;
    }
    const ownName = (source: LightSource) => lightName(myName, source);
    // One light at a time: lighting a new one pauses the current one.
    const addOwnLight = (name: string, kind: LightKind, amount: number, source: LightSource) =>
      updatePlayer(myId, (d) => {
        if (!state.playersCanAdd) return d;
        const t = Date.now();
        const fresh = createLight(crypto.randomUUID(), cleanName(name, ownName(source)), kind, amount, t, {
          source,
        });
        return {
          ...d,
          ownerName: cleanName(myName, "Player"),
          lights: replacePlayerLight(d.lights, fresh, t),
        };
      });
    const burning = mine.find((l) => isActive(l, now));
    const removeOwnLight = (light: Light) =>
      state.playersCanRemove &&
      updatePlayer(myId, (d) => ({ ...d, lights: d.lights.filter((l) => l.id !== light.id) }));

    // One list: the player's own lights first, then everyone else's when the
    // GM shares them. Only their own can show a remove button.
    const visible = state.showToPlayers ? [...mine, ...others] : mine;

    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4 text-theme">Torchlight</h1>
        <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
          <h2 className="text-lg font-semibold mb-3 text-theme">Light Sources</h2>
          {state.playersCanAdd && (
            <>
              <AddLightForm defaultName={ownName} disabled={false} onAdd={addOwnLight} />
              {burning && (
                <p className="-mt-2 mb-4 text-sm text-theme-secondary">
                  Lighting a new one pauses {burning.name}.
                </p>
              )}
            </>
          )}
          <PlayerLightList
            lights={visible}
            now={now}
            onRemove={state.playersCanRemove ? removeOwnLight : undefined}
            removable={new Set(mine.map((l) => l.id))}
          />
        </div>
      </div>
    );
  }

  const timeLights = entries
    .map((e) => e.light)
    .filter((l) => l.kind === "time" && isActive(l, now));
  const canPauseAll = timeLights.some(isRunning);
  const canResumeAll = timeLights.some((l) => !isRunning(l));

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-2 text-theme">Torchlight</h1>
      <p className="mb-4 text-theme-secondary">
        Light source timers for the{" "}
        <a
          href="https://www.thearcanelibrary.com/pages/shadowdark"
          target="_blank"
          rel="noreferrer"
          className="text-theme-primary hover:underline"
        >
          Shadowdark RPG
        </a>
        .
      </p>

      <GmBulkActions
        entries={entries}
        now={now}
        canPauseAll={canPauseAll}
        canResumeAll={canResumeAll}
        onPauseAll={() => setAllRunning(false)}
        onResumeAll={() => setAllRunning(true)}
        onPutOut={putOut}
        onRemoveAll={removeAll}
      />

      <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-theme">Light Sources</h2>
          <button
            onClick={() => update((s) => ({ ...s, showToPlayers: !s.showToPlayers }))}
            className="px-3 py-2 bg-theme-primary text-white rounded transition-colors"
            title={state.showToPlayers ? "Hide from Players" : "Show to Players"}
          >
            {state.showToPlayers ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        </div>
        <div className="flex flex-col gap-1 mb-4 text-sm text-theme-secondary">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.playersCanAdd}
              onChange={() => update((s) => ({ ...s, playersCanAdd: !s.playersCanAdd }))}
            />
            Players can light their own (one at a time)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.playersCanRemove}
              onChange={() => update((s) => ({ ...s, playersCanRemove: !s.playersCanRemove }))}
            />
            Players can remove their own
          </label>
        </div>
        <AddLightForm
          defaultName={() => nextDefaultName(state.lights)}
          disabled={state.lights.length >= LIMITS.maxLights}
          onAdd={addLight}
        />
        {entries.length === 0 ? (
          <p className="text-theme-secondary">No lights burning.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <LightRow
                key={entry.light.id}
                light={entry.light}
                owner={entry.ownerId === null ? undefined : entry.ownerName || "Player"}
                now={now}
                onToggle={() => toggleLight(entry)}
                onReset={() => updateLight(entry, reset)}
                onTurn={(delta) => updateLight(entry, (l) => adjustTurns(l, delta))}
                onAdjustTime={(deltaMin) =>
                  updateLight(entry, (l) => adjustTime(l, deltaMin * 60, Date.now()))
                }
                onRemove={() => removeLight(entry)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Main;
