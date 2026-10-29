"use client";
import { useLayoutEffect, useRef } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { gsap } from "gsap";
import { motionOn } from "@/lib/motion";

/**
 * The shared dialog backdrop. On mount the backdrop fades in and the dialog
 * settles up from slightly below and slightly smaller. Entrance only: closing
 * stays instant so dialogs never feel like they are in the way.
 */
export default function ModalBackdrop({
  onMouseDown,
  children,
}: {
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const backdrop = ref.current;
    if (!backdrop || !motionOn()) return;
    const card = backdrop.firstElementChild as HTMLElement | null;
    const timeline = gsap.timeline();
    timeline.fromTo(
      backdrop,
      { opacity: 0 },
      { opacity: 1, duration: 0.16, ease: "power1.out", clearProps: "opacity" },
      0
    );
    if (card)
      timeline.fromTo(
        card,
        { opacity: 0, y: 10, scale: 0.97 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.22,
          ease: "power3.out",
          clearProps: "opacity,transform",
        },
        0
      );
    return () => {
      timeline.kill();
      gsap.set([backdrop, card].filter(Boolean), { clearProps: "opacity,transform" });
    };
  }, []);
  return (
    <div ref={ref} className="modal-backdrop" onMouseDown={onMouseDown}>
      {children}
    </div>
  );
}
