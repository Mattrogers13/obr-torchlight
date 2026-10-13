import { useEffect, useState } from "react";

// Re-render on a fixed interval while `active`. Only drives the display:
// remaining time is always computed from the clock, so throttled timers in
// background tabs can't make a light drift.
export const useNow = (active: boolean, intervalMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return now;
};
