import OBR from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "./components/util/constants";
import {
  DEFAULT_MINUTES,
  LIMITS,
  Light,
  cleanName,
  createLight,
  parsePlayerDoc,
  parseRoomState,
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
// their own doc and only when the GM allows it. Returns what to tell the user.
export const lightFromTokens = async (
  who: Lighter,
  tokenNames: string[],
  now: number,
): Promise<string> => {
  const metadata = await OBR.room.getMetadata();
  const state = parseRoomState(metadata[ROOM_KEY]);

  const add = (existing: Light[], max: number) => {
    const room = Math.max(0, max - existing.length);
    const lit = tokenNames
      .slice(0, room)
      .map((name) => createLight(crypto.randomUUID(), torchName(name), "time", DEFAULT_MINUTES, now));
    return { lights: [...existing, ...lit], lit, skipped: tokenNames.length - lit.length };
  };

  let result: ReturnType<typeof add>;
  if (who.gm) {
    result = add(state.lights, LIMITS.maxLights);
    if (result.lit.length > 0) {
      await OBR.room.setMetadata({
        [ROOM_KEY]: { ...state, lights: result.lights, rev: state.rev + 1 },
      });
    }
  } else {
    if (!state.playersCanAdd) return "Your GM hasn't allowed players to light torches.";
    const key = playerKey(who.playerId);
    const doc = parsePlayerDoc(metadata[key]);
    result = add(doc.lights, LIMITS.maxPlayerLights);
    if (result.lit.length > 0) {
      await OBR.room.setMetadata({
        [key]: {
          ...doc,
          ownerName: cleanName(who.playerName, "Player"),
          lights: result.lights,
          rev: doc.rev + 1,
        },
      });
    }
  }

  const limit = who.gm ? LIMITS.maxLights : LIMITS.maxPlayerLights;
  if (result.lit.length === 0) return `Limit of ${limit} lights reached.`;
  const names = result.lit.map((l) => l.name).join(", ");
  return result.skipped > 0
    ? `Lit ${names} (${DEFAULT_MINUTES} min). ${result.skipped} skipped: limit of ${limit} lights.`
    : `Lit ${names} (${DEFAULT_MINUTES} min).`;
};
