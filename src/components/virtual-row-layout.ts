import { gsap } from "gsap";

export function layoutVirtualRow(wrapper: HTMLElement, y: number, previousY?: number) {
  if (previousY === undefined) gsap.set(wrapper, { y });
  else gsap.fromTo(wrapper, { y: previousY }, { y, duration: 0.5, ease: "power3.out", overwrite: "auto" });
  if (!gsap.isTweening(wrapper)) gsap.set(wrapper, { clearProps: "opacity" });
}
