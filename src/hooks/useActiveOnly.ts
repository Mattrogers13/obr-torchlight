import { useState } from "react";

import { readLocal, writeLocal } from "../storage";

// Per-viewer "show active lights only" filter, remembered in this browser.
const KEY = "torchlight-active-only";

export const useActiveOnly = () => {
  const [activeOnly, setActiveOnly] = useState(() => readLocal(KEY) === "true");
  const toggle = () =>
    setActiveOnly((prev) => {
      writeLocal(KEY, String(!prev));
      return !prev;
    });
  return [activeOnly, toggle] as const;
};
