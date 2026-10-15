import { useState } from "react";

// Per-viewer "show active lights only" filter, remembered in this browser.
// localStorage can be unavailable (private windows, blocked storage), so
// every access is guarded and the filter just starts off.
const KEY = "torchlight-active-only";

const read = () => {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
};

export const useActiveOnly = () => {
  const [activeOnly, setActiveOnly] = useState(read);
  const toggle = () =>
    setActiveOnly((prev) => {
      try {
        localStorage.setItem(KEY, String(!prev));
      } catch {
        // Not remembered; still works for this session.
      }
      return !prev;
    });
  return [activeOnly, toggle] as const;
};
