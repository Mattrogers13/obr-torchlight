import React, { useEffect, useRef, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

import PlayerView from "./PlayerView";
import { ID } from "./util/constants";
import { useRoomState } from "../hooks/useRoomState";
import { useNow } from "../hooks/useNow";
import {
  LIMITS,
  Light,
  LightKind,
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

const Main: React.FC<{ player: boolean }> = ({ player }) => {
  const { state, loaded, update } = useRoomState(!player);
  const anyRunning = state.lights.some(isRunning);
  const now = useNow(anyRunning);
  const [rolling, setRolling] = useState(false);
  const alertsSent = useRef(new Set<string>());

  // Everyone shows the burn-out notification; only a GM sends it.
  useEffect(
    () =>
      OBR.broadcast.onMessage(LIGHT_OUT_CHANNEL, (event) => {
        const names = parseLightOut(event.data);
        if (names.length > 0) {
          OBR.notification.show(`${names.join(", ")} went out!`, "WARNING");
        }
      }),
    [],
  );

  // GM only: detect burn-out once per light. The `alerted` flag in room state
  // stops repeats across reloads; the ref covers the gap before the write lands.
  // A light that burned out while no GM panel was open alerts on next open.
  useEffect(() => {
    if (player || !loaded) return;
    for (const light of state.lights) {
      if (!light.alerted && !isOut(light, now)) alertsSent.current.delete(light.id);
    }
    const burnedOut = state.lights.filter(
      (l) => !l.alerted && isOut(l, now) && !alertsSent.current.has(l.id),
    );
    if (burnedOut.length === 0) return;

    const ids = new Set(burnedOut.map((l) => l.id));
    ids.forEach((id) => alertsSent.current.add(id));
    update((s) => ({
      ...s,
      lights: s.lights.map((l) =>
        ids.has(l.id) ? { ...pause(l, Date.now()), alerted: true } : l,
      ),
    }));
    OBR.broadcast.sendMessage(LIGHT_OUT_CHANNEL, burnedOut.map((l) => l.name), {
      destination: "ALL",
    });
  }, [player, loaded, state.lights, now, update]);

  const updateLight = (id: string, change: (light: Light) => Light) =>
    update((s) => ({ ...s, lights: s.lights.map((l) => (l.id === id ? change(l) : l)) }));

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

  const toggleLight = (light: Light) => {
    const t = Date.now();
    updateLight(light.id, (l) => (isRunning(l) ? pause(l, t) : resume(l, t)));
  };

  const setAllRunning = (running: boolean) => {
    const t = Date.now();
    update((s) => ({
      ...s,
      lights: s.lights.map((l) => (running ? resume(l, t) : pause(l, t))),
    }));
  };

  const changeCrawlTurns = (delta: number) =>
    update((s) => ({
      ...s,
      crawlTurns: Math.min(LIMITS.maxCrawlTurns, Math.max(0, s.crawlTurns + delta)),
    }));

  const rollRandomEncounter = async () => {
    const roll = Math.floor(Math.random() * 6) + 1;
    setRolling(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setRolling(false);
    update((s) => ({ ...s, encounterRoll: roll, encounterTurn: s.crawlTurns }));
  };

  if (!loaded) {
    return <div className="p-4 text-theme-secondary">Loading…</div>;
  }

  if (player) {
    return state.showToPlayers ? (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4 text-theme">Torchlight</h1>
        <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
          <h2 className="text-lg font-semibold mb-3 text-theme">Light Sources</h2>
          <PlayerLightList lights={state.lights} now={now} />
        </div>
      </div>
    ) : (
      <PlayerView />
    );
  }

  const timeLights = state.lights.filter((l) => l.kind === "time" && !isOut(l, now));
  const canPauseAll = timeLights.some(isRunning);
  const canResumeAll = timeLights.some((l) => !isRunning(l));

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-2 text-theme">Torchlight</h1>
      <p className="mb-4 text-theme-secondary">
        A toolset for running the Crawling Phase of the{" "}
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

      <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
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
        <AddLightForm
          defaultName={nextDefaultName(state.lights)}
          disabled={state.lights.length >= LIMITS.maxLights}
          onAdd={addLight}
        />
        {state.lights.length === 0 ? (
          <p className="text-theme-secondary">No lights burning.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.lights.map((light) => (
              <LightRow
                key={light.id}
                light={light}
                now={now}
                onToggle={() => toggleLight(light)}
                onReset={() => updateLight(light.id, reset)}
                onTurn={(delta) => updateLight(light.id, (l) => adjustTurns(l, delta))}
                onRemove={() =>
                  update((s) => ({ ...s, lights: s.lights.filter((l) => l.id !== light.id) }))
                }
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

      <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4">
        <h2 className="text-lg font-semibold mb-3 text-theme">Crawling Turns Counter</h2>
        <div className="flex gap-2">
          <button
            onClick={() => changeCrawlTurns(-1)}
            className="px-4 py-2 bg-theme-primary text-white rounded transition-colors"
          >
            -
          </button>
          <button className="px-4 py-2 bg-theme-secondary text-white rounded cursor-default">
            {state.crawlTurns.toString().padStart(2, "0")}
          </button>
          <button
            onClick={() => changeCrawlTurns(1)}
            className="px-4 py-2 bg-theme-primary text-white rounded transition-colors"
          >
            +
          </button>
        </div>
      </div>

      <div className="bg-theme-card rounded-lg border border-theme p-4 mt-4 mb-4">
        <h2 className="text-lg font-semibold mb-3 text-theme">Random Encounter Check</h2>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => rollRandomEncounter()}
            disabled={rolling}
            className="px-4 py-2 bg-theme-primary text-white rounded transition-colors"
          >
            Roll 1d6
          </button>
          <button
            className={`px-4 py-2 rounded cursor-default ${
              !rolling && state.encounterRoll === 1
                ? "bg-theme-danger text-white"
                : "bg-theme-secondary text-white"
            }`}
            disabled
          >
            {rolling || state.encounterRoll === null ? "-" : state.encounterRoll}
          </button>
        </div>
        <p className="mt-2 text-theme-secondary">
          Last check's <strong>Turn</strong>: {state.encounterTurn}
        </p>
      </div>
    </div>
  );
};

export default Main;
