"use client";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { motionOn } from "@/lib/motion";

/**
 * Counts toward a new value instead of jumping. The span's text is written
 * directly (React renders it once), so React re-renders never fight the tween.
 */
export default function AnimatedNumber({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const initial = useRef(value.toFixed(decimals));
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const write = (n: number) => (element.textContent = n.toFixed(decimals));
    if (!motionOn() || shown.current === value) {
      shown.current = value;
      write(value);
      return;
    }
    const state = { n: shown.current };
    const tween = gsap.to(state, {
      n: value,
      duration: 0.5,
      ease: "power2.out",
      overwrite: true,
      onUpdate: () => {
        shown.current = state.n;
        write(state.n);
      },
      onComplete: () => {
        shown.current = value;
        write(value);
      },
    });
    return () => {
      tween.kill();
    };
  }, [value, decimals]);
  return (
    <span ref={ref} className="anum">
      {initial.current}
    </span>
  );
}
