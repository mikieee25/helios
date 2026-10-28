import { gsap } from "gsap";

export function prefersReducedMotion(setting: boolean): boolean {
  return (
    setting ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

export function animateDialogEntrance(
  backdrop: HTMLElement | null,
  panel: HTMLElement | null,
  reducedMotionSetting: boolean
): () => void {
  if (!backdrop || !panel || prefersReducedMotion(reducedMotionSetting))
    return () => {};

  const timeline = gsap.timeline();
  timeline.fromTo(
    backdrop,
    { autoAlpha: 0 },
    {
      autoAlpha: 1,
      duration: 0.18,
      ease: "power1.out",
      clearProps: "opacity,visibility",
    }
  );
  timeline.fromTo(
    panel,
    { autoAlpha: 0, y: 10, scale: 0.97 },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.24,
      ease: "power3.out",
      clearProps: "opacity,visibility,transform",
    },
    "<"
  );
  return () => {
    timeline.kill();
  };
}

export function animateDialogExit(
  backdrop: HTMLElement | null,
  panel: HTMLElement | null,
  reducedMotionSetting: boolean,
  onComplete: () => void
): () => void {
  if (!backdrop || !panel || prefersReducedMotion(reducedMotionSetting)) {
    onComplete();
    return () => {};
  }

  const timeline = gsap.timeline({ onComplete });
  timeline.to(backdrop, {
    autoAlpha: 0,
    duration: 0.24,
    ease: "power1.in",
  });
  timeline.to(
    panel,
    {
      autoAlpha: 0,
      y: 8,
      scale: 0.985,
      duration: 0.24,
      ease: "power2.in",
    },
    0
  );
  return () => timeline.kill();
}
