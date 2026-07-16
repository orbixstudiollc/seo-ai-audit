"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a number up/down to `target` over `durationMs` using rAF, easing on
 * a cubic curve. Compositor cost is nil (it only drives text content), and it
 * respects `prefers-reduced-motion` by snapping straight to the target.
 * The initial render shows `target` with no animation — only subsequent
 * changes animate, so a re-score visibly moves the numeral.
 */
export function useAnimatedNumber(target: number, durationMs = 520): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const from = fromRef.current;
    if (reduce || from === target) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return display;
}
