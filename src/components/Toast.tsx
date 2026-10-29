"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { motionOn } from "@/lib/motion";
import { useToast, type Toast as ToastData } from "@/lib/toast";

export default function Toast() {
  const toast = useToast((s) => s.toast);
  const [shown, setShown] = useState<ToastData | undefined>(toast);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the last toast mounted just long enough to animate it out.
  useEffect(() => {
    if (toast) {
      setShown(toast);
      return;
    }
    const element = ref.current;
    if (!element || !motionOn()) {
      setShown(undefined);
      return;
    }
    const tween = gsap.to(element, {
      opacity: 0,
      y: 10,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => setShown(undefined),
    });
    return () => {
      tween.kill();
    };
  }, [toast]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown || !motionOn()) return;
    gsap.fromTo(
      element,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.24, ease: "power3.out", overwrite: true }
    );
  }, [shown?.id]);

  if (!shown) return null;
  return (
    <div className="toast-host">
      <div
        ref={ref}
        className="toast"
        role="status"
        aria-live="polite"
        onMouseEnter={() => useToast.getState().pause()}
        onMouseLeave={() => useToast.getState().resume()}
      >
        <span className="toast-msg">{shown.message}</span>
        {shown.actionLabel && (
          <button
            className="toast-action"
            onClick={() => void useToast.getState().runAction()}
          >
            {shown.actionLabel}
            <kbd>Ctrl Z</kbd>
          </button>
        )}
        <button
          className="toast-close"
          aria-label="Dismiss"
          onClick={() => useToast.getState().dismiss()}
        >
          ×
        </button>
      </div>
    </div>
  );
}
