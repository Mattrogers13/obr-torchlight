import OBR from "@owlbear-rodeo/sdk";

import { ID } from "./constants";
import { LIMITS } from "./lights";
import { errorMessage, notify } from "./utils";

// "<names> went out!" goes to everyone in the room. Sent by a GM client.
export const LIGHT_OUT_CHANNEL = `${ID}/light-out`;

// Broadcasts can come from any client, so only accept a short list of strings.
export const parseLightOut = (data: unknown): string[] =>
  Array.isArray(data)
    ? data
        .filter((n): n is string => typeof n === "string")
        .slice(0, LIMITS.maxLights)
        .map((n) => n.slice(0, LIMITS.maxNameLength))
    : [];

export const broadcastLightOut = (names: string[]) => {
  if (names.length === 0) return;
  OBR.broadcast
    .sendMessage(LIGHT_OUT_CHANNEL, names, { destination: "ALL" })
    .catch((err) =>
      // The GM still needs the alert, and needs to know players missed it.
      notify(`${names.join(", ")} went out! (Couldn't alert players: ${errorMessage(err)})`, "WARNING"),
    );
};
