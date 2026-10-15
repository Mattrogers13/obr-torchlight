import OBR, { Metadata } from "@owlbear-rodeo/sdk";

import { ROOM_KEY, playerKey } from "./constants";
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
  parsePlayerDocs,
  parseRoomState,
  replacePlayerLight,
  replaceTokenLight,
  setAsideLight,
} from "./lights";

// This writer's own stamp. Copying a doc keeps the previous writer's stamp,
// which would make that client discard this write as a stale echo of its own.
const menuStamp = () => ({ writer: `menu-${crypto.randomUUID().slice(0, 8)}`, seq: 1 });

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

    // A player may already have a light burning on one of the tokens we
    // actually lit (not ones skipped at the limit, which keep their light).
    const tokenIds = new Set(lit.map((l) => l.tokenId!));
    const update: Metadata = { [ROOM_KEY]: { ...state, lights, rev: state.rev + 1, ...menuStamp() } };
    for (const [ownerId, doc] of Object.entries(parsePlayerDocs(metadata))) {
      const hit = doc.lights.filter((l) => l.tokenId && tokenIds.has(l.tokenId) && isActive(l, now));
      if (hit.length === 0) continue;
      hit.forEach((l) => paused.push(l.name));
      update[playerKey(ownerId)] = {
        ...doc,
        lights: doc.lights.map((l) => (hit.includes(l) ? setAsideLight(l, now) : l)),
        rev: doc.rev + 1,
        ...menuStamp(),
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
  // The same light replacePlayerLight will set aside (the newest active one).
  const current = [...doc.lights].reverse().find((l) => isActive(l, now));
  const light = fresh(tokens[0]);
  await OBR.room.setMetadata({
    [key]: {
      ...doc,
      ownerName: cleanName(who.playerName, "Player"),
      lights: replacePlayerLight(doc.lights, light, now),
      rev: doc.rev + 1,
      ...menuStamp(),
    },
  });
  return describe([light], current ? [current.name] : []);
};
