import OBR from "@owlbear-rodeo/sdk";

import { ID } from "./constants";
import { LIMITS } from "./lights";
import { errorMessage, notify } from "./utils";

// "<names> went out!" goes to everyone in the room. Sent by the GM panel and
// by the right-click menu.
export const LIGHT_OUT_CHANNEL = `${ID}/light-out`;
// "<n> minutes pass." after the GM's Time passes.
export const TIME_PASSES_CHANNEL = `${ID}/time-passes`;

// Broadcasts can come from any client, so only accept a short list of strings.
export const parseLightOut = (data: unknown): string[] =>
  Array.isArray(data)
    ? data
        .filter((n): n is string => typeof n === "string")
        .slice(0, LIMITS.maxLights)
        .map((n) => n.slice(0, LIMITS.maxNameLength))
    : [];

// Minutes from a Time passes broadcast, or null if it isn't a sane number.
export const parseTimePasses = (data: unknown): number | null =>
  typeof data === "number" && Number.isInteger(data) && data >= 1 && data <= LIMITS.maxMinutes ? data : null;

export const timePassesMessage = (minutes: number) =>
  minutes % 60 === 0
    ? `${minutes / 60} hour${minutes === 60 ? "" : "s"} pass${minutes === 60 ? "es" : ""}.`
    : `${minutes} minute${minutes === 1 ? "" : "s"} pass${minutes === 1 ? "es" : ""}.`;

export const broadcastTimePasses = (minutes: number) => {
  OBR.broadcast
    .sendMessage(TIME_PASSES_CHANNEL, minutes, { destination: "ALL" })
    .catch((err) => notify(`${timePassesMessage(minutes)} (Couldn't tell players: ${errorMessage(err)})`, "WARNING"));
};

// Shows both alerts on this client. Runs on the background page, which is
// up whenever Torchlight is enabled, so each client gets exactly one
// notification whether or not its panel is open.
export const listenForAlerts = () => {
  OBR.broadcast.onMessage(LIGHT_OUT_CHANNEL, (event) => {
    const names = parseLightOut(event.data);
    if (names.length > 0) notify(`${names.join(", ")} went out!`, "WARNING");
  });
  OBR.broadcast.onMessage(TIME_PASSES_CHANNEL, (event) => {
    const minutes = parseTimePasses(event.data);
    if (minutes !== null) notify(timePassesMessage(minutes), "INFO");
  });
};

export const broadcastLightOut = (names: string[]) => {
  if (names.length === 0) return;
  OBR.broadcast
    .sendMessage(LIGHT_OUT_CHANNEL, names, { destination: "ALL" })
    .catch((err) =>
      // The GM still needs the alert, and needs to know players missed it.
      notify(`${names.join(", ")} went out! (Couldn't alert players: ${errorMessage(err)})`, "WARNING"),
    );
};
