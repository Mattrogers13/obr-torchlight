import React, { MutableRefObject, useEffect, useState } from "react";

import { broadcastLightOut, broadcastTimePasses } from "../alerts";
import { useActiveOnly } from "../hooks/useActiveOnly";
import {
  LIMITS,
  Light,
  LightKind,
  LightSource,
  RoomState,
  adjustTime,
  adjustTurns,
  cleanName,
  createLight,
  isActive,
  isRunning,
  mapLights,
  nextDefaultName,
  passTime,
  pause,
  putOutLights,
  reset,
  resume,
} from "../lights";
import {
  ActiveFilter,
  AddLightForm,
  EyeIcon,
  EyeSlashIcon,
  GmBulkActions,
  LightEntry,
  LightRow,
} from "./Lights";

// "Light when unlit" in feet. Saved on blur or Enter (not per keystroke, so
// clearing the field to retype doesn't write); out-of-range values are
// clamped, junk goes back to the saved value.
const UnlitInput: React.FC<{ value: number; onSave: (ft: number) => void }> = ({ value, onSave }) => {
  const [draft, setDraft] = useState(String(value));
  // Follow changes from other clients.
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    const ft = Math.min(LIMITS.maxUnlitFt, Math.max(0, Math.round(n)));
    setDraft(String(ft));
    if (ft !== value) onSave(ft);
  };
  return (
    <label className="flex items-center gap-2" title="What a token that had no light gets when its light stops (0 = none)">
      Light when unlit:
      <input
        type="number"
        min={0}
        max={LIMITS.maxUnlitFt}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-16 px-2 py-1 border border-theme rounded bg-theme-card text-theme"
      />
      ft
    </label>
  );
};

// The GM's view: bulk actions, player permissions, the add form, and every
// light in the room with full controls.
const GmPanel: React.FC<{
  state: RoomState;
  entries: LightEntry[];
  now: number;
  update: (change: (s: RoomState) => RoomState) => Promise<boolean>;
  updateLights: (changes: Map<string | null, (lights: Light[]) => Light[]>) => Promise<boolean>;
  removedByMe: MutableRefObject<Set<string>>;
  restoredAfterFailure: MutableRefObject<Set<string>>;
}> = ({ state, entries, now, update, updateLights, removedByMe, restoredAfterFailure }) => {
  const [activeOnly, toggleActiveOnly] = useActiveOnly();

  // Applies the same change to every listed owner's lights in one write.
  const changeLights = (owners: Iterable<string | null>, change: (lights: Light[]) => Light[]) =>
    updateLights(new Map([...new Set(owners)].map((owner) => [owner, change])));

  const updateLight = (entry: LightEntry, change: (light: Light) => Light) =>
    changeLights([entry.ownerId], (lights) => mapLights(lights, (l) => (l.id === entry.light.id ? change(l) : l)));

  // Only players' lights are diffed for "removed" alerts, so only those need
  // remembering, and only until the write lands or fails.
  const removeLights = (removed: LightEntry[], change: (lights: Light[]) => Light[]) => {
    const ids = removed.filter((e) => e.ownerId !== null).map((e) => e.light.id);
    ids.forEach((id) => removedByMe.current.add(id));
    changeLights(
      removed.map((e) => e.ownerId),
      change,
    ).then((saved) => {
      // The resync brings these back; that isn't the player lighting them.
      if (!saved) ids.forEach((id) => restoredAfterFailure.current.add(id));
    });
  };

  const addLight = (name: string, kind: LightKind, amount: number, source: LightSource) =>
    update((s) =>
      s.lights.length >= LIMITS.maxLights
        ? s
        : {
            ...s,
            lights: [
              ...s.lights,
              createLight(crypto.randomUUID(), cleanName(name, nextDefaultName(s.lights)), kind, amount, Date.now(), {
                source,
              }),
            ],
          },
    );

  const toggleLight = (entry: LightEntry) => {
    const t = Date.now();
    updateLight(entry, (l) => (isRunning(l) ? pause(l, t) : resume(l, t)));
  };

  const setAllRunning = (running: boolean) => {
    const t = Date.now();
    changeLights(
      entries.filter((e) => e.light.kind === "time").map((e) => e.ownerId),
      // Resume all never relights a paused or put-out light.
      (lights) => mapLights(lights, (l) => (running ? (l.setAside ? l : resume(l, t)) : pause(l, t))),
    );
  };

  // Put out the checked lights (wind, water, a dispel). They keep their
  // time, show "Put out", and everyone gets the went-out alert once saved.
  const putOut = (ids: Set<string>) => {
    const t = Date.now();
    const hit = entries.filter((e) => ids.has(e.light.id) && isActive(e.light, t));
    if (hit.length === 0) return;
    // Only lights this write actually puts out (someone may have beaten us).
    const putOutNow: string[] = [];
    changeLights(
      hit.map((e) => e.ownerId),
      (lights) => {
        const out = putOutLights(lights, (l) => ids.has(l.id), t);
        putOutNow.push(...out.names);
        return out.lights;
      },
    ).then((saved) => {
      // Only tell the room once the lights really are out.
      if (saved) broadcastLightOut(putOutNow);
    });
  };

  // Time skips ahead for every lit real-time light, players' included.
  const passMinutes = (minutes: number) => {
    const t = Date.now();
    changeLights(
      entries.filter((e) => e.light.kind === "time" && isActive(e.light, t)).map((e) => e.ownerId),
      (lights) => passTime(lights, minutes * 60, t),
    ).then((saved) => {
      if (saved) broadcastTimePasses(minutes);
    });
  };

  const timeLights = entries.map((e) => e.light).filter((l) => l.kind === "time" && isActive(l, now));
  const listed = activeOnly ? entries.filter((e) => isActive(e.light, now)) : entries;

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
        canPauseAll={timeLights.some(isRunning)}
        canResumeAll={timeLights.some((l) => !isRunning(l))}
        onSetAllRunning={setAllRunning}
        onPutOut={putOut}
        onRemoveAll={() => removeLights(entries, () => [])}
        canPassTime={timeLights.length > 0}
        onPassTime={passMinutes}
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
          <UnlitInput value={state.unlitFt} onSave={(unlitFt) => update((s) => ({ ...s, unlitFt }))} />
        </div>
        <AddLightForm
          defaultName={() => nextDefaultName(state.lights)}
          disabled={state.lights.length >= LIMITS.maxLights}
          onAdd={addLight}
        />
        {entries.length > 0 && <ActiveFilter checked={activeOnly} onToggle={toggleActiveOnly} />}
        {listed.length === 0 ? (
          <p className="text-theme-secondary">No lights burning.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {listed.map((entry) => (
              <LightRow
                key={entry.light.id}
                light={entry.light}
                owner={entry.ownerId === null ? undefined : entry.ownerName || "Player"}
                now={now}
                onToggle={() => toggleLight(entry)}
                onReset={() => updateLight(entry, reset)}
                onTurn={(delta) => updateLight(entry, (l) => adjustTurns(l, delta))}
                onAdjustTime={(deltaMin) => updateLight(entry, (l) => adjustTime(l, deltaMin * 60, Date.now()))}
                onRemove={() =>
                  removeLights([entry], (lights) => lights.filter((l) => l.id !== entry.light.id))
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default GmPanel;
