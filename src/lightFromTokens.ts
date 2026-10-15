import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { PLAYER_KEY_PREFIX, ROOM_KEY, playerKey } from "./components/util/constants";
import {
  LIMITS,
  Light,
  LightSource,
  SOURCES,
  cleanName,
  createLight,
  isActive,
  lightName,
  parsePlayerDoc,
  parseRoomState,
  replacePlayerLight,
  replaceTokenLight,
  setAsideLight,
} from "./lights";

export interface Lighter {
  gm: boolean;
  playerId: string;
  playerName: string;
}

export interface Token {
  id: string;
  name: string;
}

// Lights a real-time light source on tokens, written straight to room metadata
// (this runs from the background script, with no panel state to go through).
// Same rules as the panel: GMs write the shared state, players write only
// their own doc, one light at a time, and only when the GM allows it.
// Lighting a token pauses whatever was burning on it. Returns what to tell
// the user.
export const lightFromTokens = async (
  who: Lighter,
  tokens: Token[],
  now: number,
  source: LightSource = "torch",
): Promise<string> => {
  const minutes = SOURCES[source].minutes;
  const metadata = await OBR.room.getMetadata();
  const state = parseRoomState(metadata[ROOM_KEY]);
  const fresh = (token: Token) =>
    createLight(crypto.randomUUID(), lightName(token.name, source), "time", minutes, now, {
      tokenId: token.id,
      source,
    });
  const describe = (lit: Light[], paused: string[], extra = "") =>
    `Lit ${lit.map((l) => l.name).join(", ")} (${minutes} min).` +
    (paused.length > 0 ? ` Paused ${paused.join(", ")}.` : "") +
    extra;

  if (who.gm) {
    let lights = state.lights;
    const lit: Light[] = [];
    const paused: string[] = [];
    for (const token of tokens) {
      const light = fresh(token);
      const next = replaceTokenLight(lights, light, now);
      if (next.length > LIMITS.maxLights) continue;
      const current = lights.find((l) => l.tokenId === token.id && isActive(l, now));
      if (current) paused.push(current.name);
      lights = next;
      lit.push(light);
    }
    if (lit.length === 0) return `Limit of ${LIMITS.maxLights} lights reached.`;

    // A player may already have a light burning on one of these tokens.
    const tokenIds = new Set(tokens.map((t) => t.id));
    const update: Metadata = { [ROOM_KEY]: { ...state, lights, rev: state.rev + 1 } };
    for (const [key, value] of Object.entries(metadata)) {
      if (!key.startsWith(PLAYER_KEY_PREFIX)) continue;
      const doc = parsePlayerDoc(value);
      const hit = doc.lights.filter((l) => l.tokenId && tokenIds.has(l.tokenId) && isActive(l, now));
      if (hit.length === 0) continue;
      hit.forEach((l) => paused.push(l.name));
      update[key] = {
        ...doc,
        lights: doc.lights.map((l) => (hit.includes(l) ? setAsideLight(l, now) : l)),
        rev: doc.rev + 1,
      };
    }
    await OBR.room.setMetadata(update);
    const skipped = tokens.length - lit.length;
    return describe(lit, paused, skipped > 0 ? ` ${skipped} skipped: limit of ${LIMITS.maxLights} lights.` : "");
  }

  // Players carry one light at a time: the first selected token gets it and
  // their current light is paused (rules p.84).
  if (!state.playersCanAdd) return "Your GM hasn't allowed players to light their own.";
  if (tokens.length === 0) return "No token selected.";
  const key = playerKey(who.playerId);
  const doc = parsePlayerDoc(metadata[key]);
  const current = doc.lights.find((l) => isActive(l, now));
  const light = fresh(tokens[0]);
  await OBR.room.setMetadata({
    [key]: {
      ...doc,
      ownerName: cleanName(who.playerName, "Player"),
      lights: replacePlayerLight(doc.lights, light, now),
      rev: doc.rev + 1,
    },
  });
  return describe([light], current ? [current.name] : []);
};
