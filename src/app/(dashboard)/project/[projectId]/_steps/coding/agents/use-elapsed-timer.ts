"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export function useElapsedTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      if (startRef.current === null) {
        startRef.current = Date.now() - elapsed * 1000;
      }
      rafRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 1000);
    } else {
      if (rafRef.current) clearInterval(rafRef.current);
    }
    return () => {
      if (rafRef.current) clearInterval(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const reset = useCallback(() => {
    startRef.current = null;
    setElapsed(0);
  }, []);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;

  const formatted = [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":");

  return { elapsed, formatted, reset };
}
