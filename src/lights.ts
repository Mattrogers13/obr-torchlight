// Light timers and shared room state. Pure functions only: every time-based
// calculation takes `now` (epoch ms, UTC) so it can be tested deterministically.

import { PLAYER_KEY_PREFIX, ROOM_KEY } from "./constants";

export type LightKind = "time" | "turns";

// Shadowdark light sources (core rules: torch and lantern p.34, Light spell
// p.64, distances p.84). rangeFt is the radius of light; minutes the burn time.
export type LightSource = "torch" | "lantern" | "light-spell";
export const SOURCES: Record<LightSource, { label: string; rangeFt: number; minutes: number; flame: boolean }> = {
  torch: { label: "Torch", rangeFt: 30, minutes: 60, flame: true },
  lantern: { label: "Lantern", rangeFt: 60, minutes: 60, flame: true },
  "light-spell": { label: "Light spell", rangeFt: 30, minutes: 60, flame: false },
};
export const SOURCE_IDS = Object.keys(SOURCES) as LightSource[];

// Why a light stopped on purpose (it keeps its remaining time, and Resume all
// leaves it alone): "swap" = a newer light replaced it (shown as Paused),
// "put-out" = the GM put it out (wind, water, a dispel).
export type SetAside = "swap" | "put-out" | null;

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
  // Bumped whenever a burned-out light is re-armed (reset, time added, turn
  // undone), so each burn-out of the same light is a distinct event.
  rearmed: number;
  source: LightSource;
  setAside: SetAside;
  // Token this light was lit on (right-click), if any. One burning light per token.
  tokenId: string | null;
}

// Every doc records who wrote it last (a random id per page load, or
// "menu-…" for the right-click menu) and that writer's sequence number. See
// takeEvent in useRoomState for how clients use it.
export interface Stamp {
  writer: string;
  seq: number;
}

export interface RoomState extends Stamp {
  lights: Light[];
  showToPlayers: boolean;
  // GM permission toggles for player-owned lights (see PlayerDoc).
  playersCanAdd: boolean;
  playersCanRemove: boolean;
  // Burn-outs of players' lights already announced (see burnKey). Kept in the
  // GM's own doc so the GM never has to write a player's doc just to mark
  // a burn-out, which could overwrite a light the player lit that instant.
  burnedOut: string[];
}

// A player's own lights. Each player writes only their own metadata key, so
// a player lighting a torch can't clobber a GM edit (or another player's)
// the way concurrent writes to the single shared key would.
export interface PlayerDoc extends Stamp {
  ownerName: string;
  lights: Light[];
}

export const LIMITS = {
  maxLights: 20,
  // A player's current light plus the one they last paused (rules p.84:
  // lighting a new source extinguishes the old and starts a fresh timer).
  maxPlayerLights: 2,
  maxNameLength: 40,
  maxBurnedOut: 100,
  minMinutes: 1,
  maxMinutes: 1440,
  minTurns: 1,
  maxTurns: 100,
};

export const DEFAULT_MINUTES = 60;
export const DEFAULT_TURNS = 10;

export const emptyRoomState = (): RoomState => ({
  writer: "",
  seq: 0,
  lights: [],
  showToPlayers: false,
  playersCanAdd: false,
  playersCanRemove: false,
  burnedOut: [],
});

export const emptyPlayerDoc = (): PlayerDoc => ({ writer: "", seq: 0, ownerName: "", lights: [] });

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export const cleanName = (name: string, fallback: string) => {
  const trimmed = name.trim().slice(0, LIMITS.maxNameLength);
  return trimmed || fallback;
};

// "Kira's torch", "Kira's lantern", "Kira's Light spell".
export const lightName = (tokenName: string, source: LightSource = "torch") => {
  const base = tokenName.trim();
  const noun = source === "light-spell" ? SOURCES[source].label : SOURCES[source].label.toLowerCase();
  return cleanName(base ? `${base}'s ${noun}` : "", SOURCES[source].label);
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
  { tokenId = null, source = "torch" }: { tokenId?: string | null; source?: LightSource } = {},
): Light => {
  if (kind === "time") {
    const durationSec =
      clampInt(amount, LIMITS.minMinutes, LIMITS.maxMinutes) * 60;
    return {
      id, name, kind, durationSec, remainingSec: durationSec,
      endsAt: now + durationSec * 1000,
      maxTurns: DEFAULT_TURNS, turnsUsed: 0, alerted: false, rearmed: 0, source, setAside: null, tokenId,
    };
  }
  return {
    id, name, kind,
    durationSec: 0, remainingSec: 0, endsAt: null,
    maxTurns: clampInt(amount, LIMITS.minTurns, LIMITS.maxTurns),
    turnsUsed: 0, alerted: false, rearmed: 0, source, setAside: null, tokenId,
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

// Burning or ready to burn: not out and not set aside.
export const isActive = (light: Light, now: number) => !light.setAside && !isOut(light, now);

export const pause = (light: Light, now: number): Light =>
  isRunning(light)
    ? { ...light, remainingSec: remainingSec(light, now), endsAt: null }
    : light;

export const resume = (light: Light, now: number): Light =>
  light.kind === "time" && !isRunning(light) && light.remainingSec > 0
    ? { ...light, endsAt: now + light.remainingSec * 1000, setAside: null }
    : light;

// Back to full and paused, ready to be relit.
export const reset = (light: Light): Light => ({
  ...light,
  remainingSec: light.durationSec,
  endsAt: null,
  turnsUsed: 0,
  alerted: false,
  rearmed: light.rearmed + 1,
  setAside: null,
});

export const setAsideLight = (light: Light, now: number, why: Exclude<SetAside, null> = "swap"): Light => ({
  ...pause(light, now),
  setAside: why,
});

// The light a new one replaces: the newest active one.
export const currentLight = (lights: Light[], now: number) => [...lights].reverse().find((l) => isActive(l, now));

// A player lights something new: their current light is paused and kept
// alongside the new one; anything older is dropped.
export const replacePlayerLight = (lights: Light[], fresh: Light, now: number): Light[] => {
  const current = currentLight(lights, now);
  const keep = current ? setAsideLight(current, now) : lights[lights.length - 1];
  return keep ? [keep, fresh] : [fresh];
};

// Same rule per token: lighting a token pauses its current light and keeps
// only that one alongside the new light. Lights on other tokens, or on none,
// are untouched.
export const replaceTokenLight = (lights: Light[], fresh: Light, now: number): Light[] => {
  if (!fresh.tokenId) return [...lights, fresh];
  const onToken = lights.filter((l) => l.tokenId === fresh.tokenId);
  const others = lights.filter((l) => l.tokenId !== fresh.tokenId);
  return [...others, ...replacePlayerLight(onToken, fresh, now)];
};

// GM correction: add or take away time. Keeps counting down or paused as
// it was; a burned-out light counts as paused, so adding time doesn't relight
// it. Adding past full stretches the duration (remainingSec is capped at it).
export const adjustTime = (light: Light, deltaSec: number, now: number): Light => {
  if (light.kind !== "time") return light;
  const wasOut = isOut(light, now);
  const left = clampInt(remainingSec(light, now) + deltaSec, 0, LIMITS.maxMinutes * 60);
  const rearm = wasOut && left > 0;
  return {
    ...light,
    durationSec: Math.max(light.durationSec, left),
    remainingSec: left,
    endsAt: isRunning(light) && !wasOut ? now + left * 1000 : null,
    // Adding time to a burned-out light re-arms the alert.
    alerted: left > 0 ? false : light.alerted,
    rearmed: rearm ? light.rearmed + 1 : light.rearmed,
  };
};

export const adjustTurns =(light: Light, delta: number): Light => {
  if (light.kind !== "turns") return light;
  const turnsUsed = clampInt(light.turnsUsed + delta, 0, light.maxTurns);
  if (turnsUsed === light.turnsUsed) return light;
  // Stepping back from burned out re-arms the alert.
  const rearm = light.turnsUsed >= light.maxTurns && turnsUsed < light.maxTurns;
  return {
    ...light,
    turnsUsed,
    alerted: turnsUsed < light.maxTurns ? false : light.alerted,
    rearmed: rearm ? light.rearmed + 1 : light.rearmed,
  };
};

// Identifies one particular burn-out of a light: its id plus how many times
// it has been re-armed. Pausing, swapping or editing a burned-out light
// doesn't change the key; re-arming it does, so its next burn-out alerts.
export const burnKey = (light: Light) => `${light.id}#${light.rearmed}`;

// Keep only keys for lights that still exist, newest last, capped.
export const pruneBurnedOut = (keys: string[], liveIds: Set<string>) =>
  [...new Set(keys)].filter((k) => liveIds.has(k.split("#")[0])).slice(-LIMITS.maxBurnedOut);

// Like lights.map, but returns the original array when nothing changed, so
// callers' "same object means no write" checks work.
export const mapLights = (lights: Light[], change: (light: Light) => Light): Light[] => {
  let changed = false;
  const next = lights.map((l) => {
    const n = change(l);
    if (n !== l) changed = true;
    return n;
  });
  return changed ? next : lights;
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

const parseCount = (v: unknown) => (finite(v) && v >= 0 ? Math.min(Math.floor(v), 1e6) : 0);

const parseSource = (v: unknown): LightSource =>
  typeof v === "string" && (SOURCE_IDS as string[]).includes(v) ? (v as LightSource) : "torch";

// `true` is how #21 stored a swap, before put-out existed.
const parseSetAside = (v: unknown): SetAside =>
  v === "swap" || v === "put-out" ? v : v === true ? "swap" : null;

const parseTokenId = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;

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
      rearmed: parseCount(raw.rearmed),
      source: parseSource(raw.source),
      setAside: parseSetAside(raw.setAside),
      tokenId: parseTokenId(raw.tokenId),
    };
  }

  if (!finite(raw.maxTurns) || !finite(raw.turnsUsed)) return null;
  const maxTurns = clampInt(raw.maxTurns, LIMITS.minTurns, LIMITS.maxTurns);
  return {
    id, name: cleanName(name, "Light"), kind,
    durationSec: 0, remainingSec: 0, endsAt: null,
    maxTurns, turnsUsed: clampInt(raw.turnsUsed, 0, maxTurns),
    alerted: raw.alerted === true,
    rearmed: parseCount(raw.rearmed),
    source: parseSource(raw.source),
    setAside: parseSetAside(raw.setAside),
    tokenId: parseTokenId(raw.tokenId),
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

const parseStamp = (raw: Record<string, unknown>, into: Stamp) => {
  if (typeof raw.writer === "string" && raw.writer.length <= 40) into.writer = raw.writer;
  if (finite(raw.seq) && raw.seq >= 0) into.seq = Math.floor(raw.seq);
};

// The only way a doc should be prepared for writing: put this writer's stamp
// on it. A copied doc that isn't restamped carries another client's stamp,
// and that client would discard the write as its own echo. (Docs once had a
// `rev` counter too; old ones still in rooms are ignored.)
export const restamp = <D extends Stamp>(doc: D, stamp: Stamp): D => {
  const { rev: _unused, ...rest } = doc as D & { rev?: unknown };
  return { ...(rest as D), writer: stamp.writer, seq: stamp.seq };
};

// Torchlight's slice of room metadata, to tell our changes from other
// extensions' (room metadata is shared by every extension in the room).
export const torchlightSignature = (metadata: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(metadata)
      .filter((key) => key === ROOM_KEY || key.startsWith(PLAYER_KEY_PREFIX))
      .sort()
      .map((key) => [key, metadata[key]]),
  );

// Just the "players can light their own" flag, for readers that need nothing
// else (the background page checks it on every room change).
export const parsePlayersCanAdd = (raw: unknown) => isObject(raw) && raw.playersCanAdd === true;

export const parseRoomState = (raw: unknown): RoomState => {
  const state = emptyRoomState();
  if (!isObject(raw)) return state;

  state.lights = parseLights(raw.lights, LIMITS.maxLights);
  parseStamp(raw, state);
  if (typeof raw.showToPlayers === "boolean") state.showToPlayers = raw.showToPlayers;
  state.playersCanAdd = parsePlayersCanAdd(raw);
  if (typeof raw.playersCanRemove === "boolean") state.playersCanRemove = raw.playersCanRemove;
  if (Array.isArray(raw.burnedOut)) {
    state.burnedOut = raw.burnedOut
      .filter((k): k is string => typeof k === "string" && k.length <= 120)
      .slice(-LIMITS.maxBurnedOut);
  }
  return state;
};

export const parsePlayerDoc = (raw: unknown): PlayerDoc => {
  const doc = emptyPlayerDoc();
  if (!isObject(raw)) return doc;
  parseStamp(raw, doc);
  doc.lights = parseLights(raw.lights, LIMITS.maxPlayerLights);
  if (typeof raw.ownerName === "string") doc.ownerName = cleanName(raw.ownerName, "");
  return doc;
};

// Every player doc in room metadata, by player id. Ids must be plausible
// (non-empty, at most 64 chars); anything else is ignored everywhere.
export const parsePlayerDocs = (metadata: Record<string, unknown>): Record<string, PlayerDoc> => {
  const docs: Record<string, PlayerDoc> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(PLAYER_KEY_PREFIX)) continue;
    const id = key.slice(PLAYER_KEY_PREFIX.length);
    if (id.length === 0 || id.length > 64) continue;
    docs[id] = parsePlayerDoc(value);
  }
  return docs;
};

