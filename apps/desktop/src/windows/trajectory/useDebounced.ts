import { useEffect, useRef, useState } from "react";

/**
 * `value`, updated `ms` after it stops changing (live previews without a
 * request per keystroke). Values are compared as JSON, so a new object with
 * the same contents doesn't restart the timer.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const key = JSON.stringify(value) ?? "undefined";
  const latest = useRef(value);
  latest.current = value;
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(latest.current), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return v;
}
