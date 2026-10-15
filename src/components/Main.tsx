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
  isRunning,
  nextDefaultName,
  pause,
  reset,
  resume,
} from "../lights";
import { AddLightForm, EyeIcon, EyeSlashIcon, LightRow, PlayerLightList } from "./Lights";

export const LIGHT_OUT_CHANNEL = `${ID}/light-out`;

// Broadcasts can come from any client, so only accept a short list of strings.
const parseLightOut = (data: unknown): string[] =>
  Array.isArray(data)
    ? data.filter((n): n is string => typeof n === "string").slice(0, LIMITS.maxLights)
        .map((n) => n.slice(0, LIMITS.maxNameLength))
    : [];

// Every light in the room, whoever owns it. ownerId null = the GM's shared state.
interface Entry {
  light: Light;
  ownerId: string | null;
  ownerName: string;
}

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

  const removeLight = (entry: Entry) =>
    changeLights(entry.ownerId, (lights) => lights.filter((l) => l.id !== entry.light.id));

  const addLight = (name: string, kind: LightKind, amount: number) =>
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
      changeLights(ownerId, (lights) => lights.map((l) => (running ? resume(l, t) : pause(l, t)))),
    );
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
    const ownName = myName ? `${myName}'s torch` : "Torch";
    const addOwnLight = (name: string, kind: LightKind, amount: number) =>
      updatePlayer(myId, (d) =>
        !state.playersCanAdd || d.lights.length >= LIMITS.maxPlayerLights
          ? d
          : {
              ...d,
              ownerName: cleanName(myName, "Player"),
              lights: [
                ...d.lights,
                createLight(
                  crypto.randomUUID(),
                  cleanName(name, d.lights.length === 0 ? ownName : `${ownName} ${d.lights.length + 1}`),
                  kind,
                  amount,
                  Date.now(),
                ),
              ],
            },
      );
    const removeOwnLight = (light: Light) =>
      state.playersCanRemove &&
      updatePlayer(myId, (d) => ({ ...d, lights: d.lights.filter((l) => l.id !== light.id) }));

    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4 text-theme">Torchlight</h1>
        {(state.playersCanAdd || mine.length > 0) && (
          <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
            <h2 className="text-lg font-semibold mb-3 text-theme">Your Lights</h2>
            {state.playersCanAdd && (
              <AddLightForm
                defaultName={mine.length === 0 ? ownName : `${ownName} ${mine.length + 1}`}
                disabled={mine.length >= LIMITS.maxPlayerLights}
                limit={LIMITS.maxPlayerLights}
                onAdd={addOwnLight}
              />
            )}
            <PlayerLightList
              lights={mine}
              now={now}
              onRemove={state.playersCanRemove ? removeOwnLight : undefined}
            />
          </div>
        )}
        {state.showToPlayers && (
          <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
            <h2 className="text-lg font-semibold mb-3 text-theme">Light Sources</h2>
            <PlayerLightList lights={others} now={now} />
          </div>
        )}
      </div>
    );
  }

  const timeLights = entries
    .map((e) => e.light)
    .filter((l) => l.kind === "time" && !isOut(l, now));
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
            Players can light their own (up to {LIMITS.maxPlayerLights} each)
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
          defaultName={nextDefaultName(state.lights)}
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
        {timeLights.length > 0 && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setAllRunning(false)}
              disabled={!canPauseAll}
              className={`px-3 py-2 bg-theme-secondary text-white rounded ${canPauseAll ? "" : "opacity-50 cursor-not-allowed"}`}
            >
              Pause all
            </button>
            <button
              onClick={() => setAllRunning(true)}
              disabled={!canResumeAll}
              className={`px-3 py-2 bg-theme-secondary text-white rounded ${canResumeAll ? "" : "opacity-50 cursor-not-allowed"}`}
            >
              Resume all
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

export default Main;
