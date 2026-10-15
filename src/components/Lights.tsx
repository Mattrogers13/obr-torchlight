import React, { useState } from "react";

import {
  DEFAULT_MINUTES,
  DEFAULT_TURNS,
  LIMITS,
  Light,
  LightKind,
  LightSource,
  SOURCES,
  SOURCE_IDS,
  formatClock,
  isActive,
  isOut,
  isRunning,
  remainingSec,
} from "../lights";

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="inline">
    <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
  </svg>
);

const PauseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="inline">
    <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5"/>
  </svg>
);

const ResetIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="inline">
    <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
  </svg>
);

export const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="inline">
    <path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/>
    <path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/>
  </svg>
);

export const EyeSlashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="inline">
    <path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7 7 0 0 0-2.79.588l.77.771A6 6 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755q-.247.248-.517.486z"/>
    <path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829zm-2.943 1.299.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829"/>
    <path d="M3.35 5.47q-.27.24-.518.487A13 13 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7 7 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709zm10.296 8.884-12-12 .708-.708 12 12z"/>
  </svg>
);

// Every light in the room, whoever owns it. ownerId null = the GM's shared state.
export interface LightEntry {
  light: Light;
  ownerId: string | null;
  ownerName: string;
}

const buttonPrimary = "px-3 py-2 bg-theme-primary text-white rounded transition-colors";
const buttonSecondary = "px-3 py-2 bg-theme-secondary text-white rounded transition-colors";
const inputClass = "px-3 py-2 border border-theme rounded bg-theme-card text-theme";

// Minutes the GM can add (+) or take away (-) on a real-time light.
const TIME_STEPS = [-10, -5, -1, 1, 5, 10];

// Shown next to a light's name when it isn't burning.
const StatusTag: React.FC<{ light: Light; now: number }> = ({ light, now }) =>
  isOut(light, now) ? (
    <span className="ml-2 text-sm text-theme-danger">Out</span>
  ) : light.setAside === "put-out" ? (
    <span className="ml-2 text-sm text-theme-danger">Put out</span>
  ) : light.setAside ? (
    <span className="ml-2 text-sm text-theme-secondary">Paused</span>
  ) : null;

const SourceTag: React.FC<{ light: Light }> = ({ light }) => (
  <span className="ml-2 text-xs font-normal text-theme-secondary">{SOURCES[light.source].label}</span>
);

const LightReadout: React.FC<{ light: Light; now: number }> = ({ light, now }) => {
  const out = isOut(light, now);
  return (
    <span className={`text-xl font-mono ${out ? "text-theme-danger font-bold" : "text-theme"}`}>
      {light.kind === "time"
        ? formatClock(remainingSec(light, now))
        : `${light.turnsUsed} / ${light.maxTurns}`}
    </span>
  );
};

export const AddLightForm: React.FC<{
  defaultName: (source: LightSource) => string;
  disabled: boolean;
  onAdd: (name: string, kind: LightKind, amount: number, source: LightSource) => void;
}> = ({ defaultName, disabled, onAdd }) => {
  const [name, setName] = useState("");
  const [source, setSource] = useState<LightSource>("torch");
  const [kind, setKind] = useState<LightKind>("time");
  const [amount, setAmount] = useState(DEFAULT_MINUTES);

  const [min, max] =
    kind === "time" ? [LIMITS.minMinutes, LIMITS.maxMinutes] : [LIMITS.minTurns, LIMITS.maxTurns];
  const amountValid = Number.isInteger(amount) && amount >= min && amount <= max;

  const handleKindChange = (next: LightKind) => {
    setKind(next);
    setAmount(next === "time" ? SOURCES[source].minutes : DEFAULT_TURNS);
  };

  const handleSourceChange = (next: LightSource) => {
    setSource(next);
    if (kind === "time") setAmount(SOURCES[next].minutes);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !amountValid) return;
    onAdd(name, kind, amount, source);
    setName("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 mb-4">
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => handleSourceChange(e.target.value as LightSource)}
          aria-label="Light source"
          className={inputClass}
        >
          {SOURCE_IDS.map((id) => (
            <option key={id} value={id}>
              {SOURCES[id].label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          maxLength={LIMITS.maxNameLength}
          placeholder={defaultName(source)}
          onChange={(e) => setName(e.target.value)}
          aria-label="Light name"
          className={`flex-1 min-w-0 ${inputClass}`}
        />
      </div>
      <div className="flex gap-2 items-center">
        <select
          value={kind}
          onChange={(e) => handleKindChange(e.target.value as LightKind)}
          aria-label="Light type"
          className={inputClass}
        >
          <option value="time">Real time</option>
          <option value="turns">Turns</option>
        </select>
        <input
          type="number"
          min={min}
          max={max}
          value={Number.isNaN(amount) ? "" : amount}
          onChange={(e) => setAmount(e.target.valueAsNumber)}
          aria-label={kind === "time" ? "Minutes" : "Turns"}
          className={`w-20 ${inputClass}`}
        />
        <span className="text-theme-secondary">{kind === "time" ? "min" : "turns"}</span>
        <button
          type="submit"
          disabled={disabled || !amountValid}
          className={`${buttonPrimary} ml-auto ${disabled || !amountValid ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Light
        </button>
      </div>
      {disabled && (
        <p className="text-sm text-theme-secondary">Limit of {LIMITS.maxLights} lights reached.</p>
      )}
    </form>
  );
};

export const LightRow: React.FC<{
  light: Light;
  // Player name for a player-owned light; undefined for the GM's own.
  owner?: string;
  now: number;
  onToggle: () => void;
  onReset: () => void;
  onTurn: (delta: number) => void;
  onAdjustTime: (deltaMin: number) => void;
  onRemove: () => void;
}> = ({ light, owner, now, onToggle, onReset, onTurn, onAdjustTime, onRemove }) => {
  const out = isOut(light, now);
  return (
    <li className={`border border-theme rounded p-3 ${out || light.setAside ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-theme truncate" title={light.name}>
          {light.name}
          <SourceTag light={light} />
          {owner && <span className="ml-2 text-sm font-normal text-theme-secondary">({owner})</span>}
          <StatusTag light={light} now={now} />
        </span>
        <button onClick={onRemove} title="Remove" aria-label={`Remove ${light.name}`} className="text-theme-secondary hover:text-theme text-xl leading-none">
          ×
        </button>
      </div>
      <div className="flex items-center gap-2">
        <LightReadout light={light} now={now} />
        <div className="flex gap-2 ml-auto">
          {light.kind === "time" ? (
            <button
              onClick={onToggle}
              disabled={out}
              title={isRunning(light) ? "Pause" : "Resume"}
              className={`${buttonPrimary} ${out ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isRunning(light) ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <>
              <button onClick={() => onTurn(-1)} disabled={light.turnsUsed === 0} title="Undo turn" className={buttonPrimary}>-</button>
              <button onClick={() => onTurn(1)} disabled={out} title="Burn a turn" className={buttonPrimary}>+</button>
            </>
          )}
          <button onClick={onReset} title="Reset" className={buttonSecondary}>
            <ResetIcon />
          </button>
        </div>
      </div>
      {light.kind === "time" && (
        <div className="flex gap-1 mt-2">
          {TIME_STEPS.map((m) => (
            <button
              key={m}
              onClick={() => onAdjustTime(m)}
              title={`${m > 0 ? "Add" : "Remove"} ${Math.abs(m)} min`}
              aria-label={`${m > 0 ? "Add" : "Remove"} ${Math.abs(m)} minutes on ${light.name}`}
              className="flex-1 px-1 py-1 text-sm bg-theme-secondary text-white rounded transition-colors"
            >
              {m > 0 ? `+${m}` : `\u2212${-m}`}m
            </button>
          ))}
        </div>
      )}
    </li>
  );
};

export const PlayerLightList: React.FC<{
  lights: Light[];
  now: number;
  onRemove?: (light: Light) => void;
  // Ids that get a remove button (a player's own lights).
  removable?: Set<string>;
}> = ({ lights, now, onRemove, removable }) =>
  lights.length === 0 ? (
    <p className="text-theme-secondary">No lights burning.</p>
  ) : (
    <ul className="flex flex-col gap-2">
      {lights.map((light) => (
        <li key={light.id} className={`flex items-center gap-2 border border-theme rounded p-3 ${isOut(light, now) || light.setAside ? "opacity-60" : ""}`}>
          <span className="text-theme truncate" title={light.name}>
            {light.name}
            <SourceTag light={light} />
            <StatusTag light={light} now={now} />
          </span>
          <span className="ml-auto"><LightReadout light={light} now={now} /></span>
          {onRemove && (!removable || removable.has(light.id)) && (
            <button onClick={() => onRemove(light)} title="Remove" aria-label={`Remove ${light.name}`} className="text-theme-secondary hover:text-theme text-xl leading-none">
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );

// GM controls at the top of the panel. "Put out" opens a checklist of what's
// burning, with flames (torches, lanterns) pre-checked: wind and water put
// out flames on a failed DC 15 DEX check, a Light spell only to a Dud or a
// dispel (rules p.110). Remove all asks for a second click.
export const GmBulkActions: React.FC<{
  entries: LightEntry[];
  now: number;
  canPauseAll: boolean;
  canResumeAll: boolean;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onPutOut: (ids: Set<string>) => void;
  onRemoveAll: () => void;
}> = ({ entries, now, canPauseAll, canResumeAll, onPauseAll, onResumeAll, onPutOut, onRemoveAll }) => {
  const [mode, setMode] = useState<"put-out" | "remove" | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const burning = entries.filter((e) => isActive(e.light, now));
  if (entries.length === 0) return null;

  const small = "px-2 py-1 text-sm text-white rounded transition-colors";
  const enabled = (on: boolean) => (on ? "" : "opacity-50 cursor-not-allowed");

  const openPutOut = () => {
    setChecked(new Set(burning.filter((e) => SOURCES[e.light.source].flame).map((e) => e.light.id)));
    setMode("put-out");
  };
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        <button onClick={onPauseAll} disabled={!canPauseAll} className={`${small} bg-theme-secondary ${enabled(canPauseAll)}`}>
          Pause all
        </button>
        <button onClick={onResumeAll} disabled={!canResumeAll} className={`${small} bg-theme-secondary ${enabled(canResumeAll)}`}>
          Resume all
        </button>
        <button
          onClick={openPutOut}
          disabled={burning.length === 0}
          className={`${small} bg-theme-secondary ${enabled(burning.length > 0)}`}
        >
          Put out…
        </button>
        <button onClick={() => setMode("remove")} className={`${small} bg-theme-danger`}>
          Remove all
        </button>
      </div>

      {mode === "put-out" && (
        <div className="mt-2 p-3 rounded border border-theme bg-theme-card">
          <p className="text-sm text-theme-secondary mb-2">
            Torches and lanterns are checked: wind and water put out flames. Uncheck anyone who made
            their DEX save.
          </p>
          <ul className="flex flex-col gap-1 mb-3">
            {burning.map((e) => (
              <li key={e.light.id}>
                <label className="flex items-center gap-2 text-sm text-theme">
                  <input type="checkbox" checked={checked.has(e.light.id)} onChange={() => toggle(e.light.id)} />
                  {e.light.name}
                  <span className="text-xs text-theme-secondary">
                    {SOURCES[e.light.source].label}
                    {e.ownerId !== null && ` · ${e.ownerName || "Player"}`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onPutOut(checked);
                setMode(null);
              }}
              disabled={checked.size === 0}
              className={`${small} bg-theme-danger ${enabled(checked.size > 0)}`}
            >
              Put out {checked.size}
            </button>
            <button onClick={() => setMode(null)} className={`${small} bg-theme-secondary`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "remove" && (
        <div className="mt-2 p-3 rounded border border-theme bg-theme-card">
          <p className="text-sm text-theme mb-2">
            Remove all {entries.length} lights, players' included? This can't be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onRemoveAll();
                setMode(null);
              }}
              className={`${small} bg-theme-danger`}
            >
              Yes, remove all
            </button>
            <button onClick={() => setMode(null)} className={`${small} bg-theme-secondary`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
