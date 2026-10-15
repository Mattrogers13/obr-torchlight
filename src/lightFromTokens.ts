import OBR from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "./components/util/constants";
import {
  DEFAULT_MINUTES,
  LIMITS,
  Light,
  cleanName,
  createLight,
  isActive,
  parsePlayerDoc,
  parseRoomState,
  replacePlayerLight,
} from "./lights";

export const torchName = (tokenName: string) => {
  const base = tokenName.trim();
  return cleanName(base ? `${base}'s torch` : "", "Torch");
};

export interface Lighter {
  gm: boolean;
  playerId: string;
  playerName: string;
}

// Lights a real-time torch for each token, written straight to room metadata
// (this runs from the background script, with no panel state to go through).
// Same rules as the panel: GMs write the shared state, players write only
// their own doc, one light at a time, and only when the GM allows it.
// Returns what to tell the user.
export const lightFromTokens = async (
  who: Lighter,
  tokenNames: string[],
  now: number,
): Promise<string> => {
  const metadata = await OBR.room.getMetadata();
  const state = parseRoomState(metadata[ROOM_KEY]);

  // GM: one torch per selected token, up to the GM light limit.
  const add = (existing: Light[], max: number) => {
    const room = Math.max(0, max - existing.length);
    const lit = tokenNames
      .slice(0, room)
      .map((name) => createLight(crypto.randomUUID(), torchName(name), "time", DEFAULT_MINUTES, now));
    return { lights: [...existing, ...lit], lit, skipped: tokenNames.length - lit.length };
  };

  if (who.gm) {
    const result = add(state.lights, LIMITS.maxLights);
    if (result.lit.length === 0) return `Limit of ${LIMITS.maxLights} lights reached.`;
    await OBR.room.setMetadata({
      [ROOM_KEY]: { ...state, lights: result.lights, rev: state.rev + 1 },
    });
    const names = result.lit.map((l) => l.name).join(", ");
    return result.skipped > 0
      ? `Lit ${names} (${DEFAULT_MINUTES} min). ${result.skipped} skipped: limit of ${LIMITS.maxLights} lights.`
      : `Lit ${names} (${DEFAULT_MINUTES} min).`;
  }

  // Players carry one light at a time: the first selected token gets it and
  // their current light is snuffed (rules p.84).
  if (!state.playersCanAdd) return "Your GM hasn't allowed players to light torches.";
  const key = playerKey(who.playerId);
  const doc = parsePlayerDoc(metadata[key]);
  const current = doc.lights.find((l) => isActive(l, now));
  const fresh = createLight(crypto.randomUUID(), torchName(tokenNames[0] ?? ""), "time", DEFAULT_MINUTES, now);
  await OBR.room.setMetadata({
    [key]: {
      ...doc,
      ownerName: cleanName(who.playerName, "Player"),
      lights: replacePlayerLight(doc.lights, fresh, now),
      rev: doc.rev + 1,
    },
  });
  return current
    ? `Lit ${fresh.name} (${DEFAULT_MINUTES} min). Snuffed ${current.name}.`
    : `Lit ${fresh.name} (${DEFAULT_MINUTES} min).`;
};
