// Light timers and shared room state. Pure functions only: every time-based
// calculation takes `now` (epoch ms, UTC) so it can be tested deterministically.

export type LightKind = "time" | "turns";

export interface Light {
  id: string;
  name: string;
  kind: LightKind;
  // kind === "time": countdown in seconds. Running when endsAt is set.
  durationSec: number;
  remainingSec: number; // authoritative only while paused
  endsAt: number | null; // epoch ms (UTC) when the light burns out; null = paused
  // kind === "turns"
  maxTurns: number;
  turnsUsed: number;
  // true once the burn-out alert has been sent, so it fires exactly once
  alerted: boolean;
}

export interface RoomState {
  // Bumped on every write so clients can ignore stale echoes of older writes.
  rev: number;
  lights: Light[];
  showToPlayers: boolean;
  // GM permission toggles for player-owned lights (see PlayerDoc).
  playersCanAdd: boolean;
  playersCanRemove: boolean;
}

// A player's own lights. Each player writes only their own metadata key, so
// a player lighting a torch can't clobber a GM edit (or another player's)
// the way concurrent writes to the single shared key would.
export interface PlayerDoc {
  rev: number;
  ownerName: string;
  lights: Light[];
}

export const LIMITS = {
  maxLights: 20,
  maxPlayerLights: 3,
  maxNameLength: 40,
  minMinutes: 1,
  maxMinutes: 1440,
  minTurns: 1,
  maxTurns: 100,
};

export const DEFAULT_MINUTES = 60;
export const DEFAULT_TURNS = 10;

export const emptyRoomState = (): RoomState => ({
  rev: 0,
  lights: [],
  showToPlayers: false,
  playersCanAdd: false,
  playersCanRemove: false,
});

export const emptyPlayerDoc = (): PlayerDoc => ({ rev: 0, ownerName: "", lights: [] });

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export const cleanName = (name: string, fallback: string) => {
  const trimmed = name.trim().slice(0, LIMITS.maxNameLength);
  return trimmed || fallback;
};

export const nextDefaultName = (lights: Light[]) => {
  const taken = new Set(lights.map((l) => l.name));
  let n = lights.length + 1;
  while (taken.has(`Light ${n}`)) n++;
  return `Light ${n}`;
};

// New lights start burning: lighting a torch in the fiction starts its clock.
export const createLight = (
  id: string,
  name: string,
  kind: LightKind,
  amount: number,
  now: number,
): Light => {
  if (kind === "time") {
    const durationSec =
      clampInt(amount, LIMITS.minMinutes, LIMITS.maxMinutes) * 60;
    return {
      id, name, kind, durationSec, remainingSec: durationSec,
      endsAt: now + durationSec * 1000,
      maxTurns: DEFAULT_TURNS, turnsUsed: 0, alerted: false,
    };
  }
  return {
    id, name, kind,
    durationSec: 0, remainingSec: 0, endsAt: null,
    maxTurns: clampInt(amount, LIMITS.minTurns, LIMITS.maxTurns),
    turnsUsed: 0, alerted: false,
  };
};

export const isRunning = (light: Light) =>
  light.kind === "time" && light.endsAt !== null;

export const remainingSec = (light: Light, now: number) => {
  if (light.kind !== "time") return 0;
  if (light.endsAt === null) return light.remainingSec;
  // Capped at the duration so a bad endsAt (or clock skew) can't overstate it.
  return Math.min(light.durationSec, Math.max(0, Math.ceil((light.endsAt - now) / 1000)));
};

export const isOut = (light: Light, now: number) =>
  light.kind === "time"
    ? remainingSec(light, now) === 0
    : light.turnsUsed >= light.maxTurns;

export const pause = (light: Light, now: number): Light =>
  isRunning(light)
    ? { ...light, remainingSec: remainingSec(light, now), endsAt: null }
    : light;

export const resume = (light: Light, now: number): Light =>
  light.kind === "time" && !isRunning(light) && light.remainingSec > 0
    ? { ...light, endsAt: now + light.remainingSec * 1000 }
    : light;

// Back to full and paused, ready to be relit.
export const reset = (light: Light): Light => ({
  ...light,
  remainingSec: light.durationSec,
  endsAt: null,
  turnsUsed: 0,
  alerted: false,
});

// GM correction: add or take away time. Keeps running or paused as it was.
// Adding past full stretches the duration (remainingSec is capped at it).
export const adjustTime = (light: Light, deltaSec: number, now: number): Light => {
  if (light.kind !== "time") return light;
  const left = clampInt(remainingSec(light, now) + deltaSec, 0, LIMITS.maxMinutes * 60);
  return {
    ...light,
    durationSec: Math.max(light.durationSec, left),
    remainingSec: left,
    endsAt: isRunning(light) ? now + left * 1000 : null,
    // Adding time to a burned-out light re-arms the alert.
    alerted: left > 0 ? false : light.alerted,
  };
};

export const adjustTurns =(light: Light, delta: number): Light => {
  if (light.kind !== "turns") return light;
  const turnsUsed = clampInt(light.turnsUsed + delta, 0, light.maxTurns);
  // Stepping back from burned out re-arms the alert.
  return { ...light, turnsUsed, alerted: turnsUsed < light.maxTurns ? false : light.alerted };
};

export const formatClock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
};

// --- Validation -----------------------------------------------------------
// Room metadata is writable by every client and every extension in the room,
// so nothing read from it is trusted. Malformed lights are dropped; numbers
// are clamped into range.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const parseLight = (raw: unknown): Light | null => {
  if (!isObject(raw)) return null;
  const { id, name, kind } = raw;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  if (typeof name !== "string") return null;
  if (kind !== "time" && kind !== "turns") return null;

  if (kind === "time") {
    if (!finite(raw.durationSec) || !finite(raw.remainingSec)) return null;
    if (raw.endsAt !== null && !finite(raw.endsAt)) return null;
    const durationSec = clampInt(
      raw.durationSec, LIMITS.minMinutes * 60, LIMITS.maxMinutes * 60,
    );
    return {
      id, name: cleanName(name, "Light"), kind, durationSec,
      remainingSec: clampInt(raw.remainingSec, 0, durationSec),
      endsAt: raw.endsAt === null ? null : raw.endsAt,
      maxTurns: DEFAULT_TURNS, turnsUsed: 0,
      alerted: raw.alerted === true,
    };
  }

  if (!finite(raw.maxTurns) || !finite(raw.turnsUsed)) return null;
  const maxTurns = clampInt(raw.maxTurns, LIMITS.minTurns, LIMITS.maxTurns);
  return {
    id, name: cleanName(name, "Light"), kind,
    durationSec: 0, remainingSec: 0, endsAt: null,
    maxTurns, turnsUsed: clampInt(raw.turnsUsed, 0, maxTurns),
    alerted: raw.alerted === true,
  };
};

const parseLights = (raw: unknown, max: number): Light[] => {
  const lights: Light[] = [];
  if (!Array.isArray(raw)) return lights;
  const seen = new Set<string>();
  for (const item of raw) {
    const light = parseLight(item);
    if (light && !seen.has(light.id)) {
      seen.add(light.id);
      lights.push(light);
    }
    if (lights.length >= max) break;
  }
  return lights;
};

const parseRev = (raw: Record<string, unknown>) =>
  finite(raw.rev) && raw.rev >= 0 ? Math.floor(raw.rev) : 0;

export const parseRoomState = (raw: unknown): RoomState => {
  const state = emptyRoomState();
  if (!isObject(raw)) return state;

  state.lights = parseLights(raw.lights, LIMITS.maxLights);
  state.rev = parseRev(raw);
  if (typeof raw.showToPlayers === "boolean") state.showToPlayers = raw.showToPlayers;
  if (typeof raw.playersCanAdd === "boolean") state.playersCanAdd = raw.playersCanAdd;
  if (typeof raw.playersCanRemove === "boolean") state.playersCanRemove = raw.playersCanRemove;
  return state;
};

export const parsePlayerDoc = (raw: unknown): PlayerDoc => {
  const doc = emptyPlayerDoc();
  if (!isObject(raw)) return doc;
  doc.rev = parseRev(raw);
  doc.lights = parseLights(raw.lights, LIMITS.maxPlayerLights);
  if (typeof raw.ownerName === "string") doc.ownerName = cleanName(raw.ownerName, "");
  return doc;
};
