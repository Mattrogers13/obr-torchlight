import OBR from "@owlbear-rodeo/sdk";

export const getItemText = (item: any) => {
  return item.text.richText[0].children[0].text ? item.text.richText[0].children[0].text : item.text.plainText;
};

export const isDevMode = (): boolean => {
  return localStorage.getItem("dev-mode") === "true";
};

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
