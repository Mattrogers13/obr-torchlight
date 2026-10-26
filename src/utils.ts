import OBR from "@owlbear-rodeo/sdk";

import { readLocal } from "./storage";

export const isDevMode = (): boolean => readLocal("dev-mode") === "true";

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// OBR notifications are async and can fail; there's nowhere left to report
// that except the console, but it must never become an unhandled rejection.
export const notify = (
  message: string,
  variant: "DEFAULT" | "ERROR" | "INFO" | "SUCCESS" | "WARNING" = "DEFAULT",
) => {
  OBR.notification.show(message, variant).catch((err) =>
    console.error(`Torchlight notification failed: ${errorMessage(err)}`, message),
  );
};

// player.onChange fires on every selection change; call back (with the new
// role) only when the role actually changes. Starts from the current role, so
// the first token click doesn't count as a change.
export const onRoleChange = (callback: (role: "GM" | "PLAYER") => void) => {
  let role: string | undefined;
  OBR.player
    .getRole()
    .then((r) => {
      if (role === undefined) role = r;
    })
    .catch(() => {});
  return OBR.player.onChange((player) => {
    if (player.role === role) return;
    role = player.role;
    callback(player.role);
  });
};

