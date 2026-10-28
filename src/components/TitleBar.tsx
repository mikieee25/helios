"use client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { gsap } from "gsap";
import { useStore } from "@/lib/store";
import { prefersReducedMotion } from "@/lib/motion";
import { Ic } from "./Icon";

// Window controls only work inside Tauri; in a plain browser they do nothing.
const win = () => ("__TAURI_INTERNALS__" in window ? getCurrentWindow() : null);
const hoverAnimations = new WeakMap<HTMLButtonElement, gsap.core.Timeline>();

function animateButtonHover(
  button: HTMLButtonElement,
  color: string,
  hovered: boolean,
  reduceMotion: boolean
) {
  const shine = button.querySelector<HTMLElement>(".button-shine");
  if (!shine) return;

  hoverAnimations.get(button)?.kill();
  if (prefersReducedMotion(reduceMotion)) {
    gsap.set(button, { clearProps: "boxShadow" });
    gsap.set(shine, { clearProps: "opacity,transform" });
    return;
  }

  const timeline = gsap.timeline({
    onComplete: () => hoverAnimations.delete(button),
  });
  hoverAnimations.set(button, timeline);

  if (hovered) {
    timeline
      .fromTo(
        shine,
        { xPercent: -180, opacity: 0 },
        {
          xPercent: 180,
          opacity: 0.85,
          duration: 0.38,
          ease: "power2.out",
        }
      )
      .to(
        shine,
        {
          opacity: 0,
          duration: 0.18,
          ease: "power1.out",
          clearProps: "opacity,transform",
        },
        "-=0.1"
      )
      .to(
        button,
        {
          boxShadow: `0 0 14px 2px rgba(${color}, 0.58)`,
          duration: 0.2,
          ease: "sine.out",
        },
        0
      );
    return;
  }

  timeline
    .to(
      button,
      {
        boxShadow: `0 0 0 0 rgba(${color}, 0)`,
        duration: 0.8,
        ease: "sine.inOut",
        clearProps: "boxShadow",
      },
      0
    )
    .to(
      shine,
      {
        xPercent: 220,
        opacity: 0,
        duration: 0.52,
        ease: "sine.inOut",
        clearProps: "opacity,transform",
      },
      0
    );
}

export default function TitleBar({ onAdd }: { onAdd(): void }) {
  const online = useStore((s) => s.online);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  return (
    <div className="bar" data-tauri-drag-region>
      <div className="l" data-tauri-drag-region>
        <svg
          className="i brand-mark"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          style={{ color: "var(--cy)" }}
        >
          <path d="M12 7v5m0 0-4.6 4.6M12 12l4.6 4.6" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle className="brand-hub" cx="12" cy="12" r="1.4" />
        </svg>
        <b>HELIOS</b>
      </div>
      <div className="r">
        <div className="transfer-controls">
          <button
            type="button"
            className="add-download shine-cyan"
            aria-label="Add download"
            title="Add download"
            onPointerEnter={(event) =>
              animateButtonHover(
                event.currentTarget,
                "73, 195, 232",
                true,
                reduceMotion
              )
            }
            onPointerLeave={(event) =>
              animateButtonHover(
                event.currentTarget,
                "73, 195, 232",
                false,
                reduceMotion
              )
            }
            onClick={onAdd}
          >
            <span className="button-shine" aria-hidden="true" />
            <Ic n="plus" />
          </button>
          <button
            type="button"
            className="transfer-action shine-muted"
            aria-label="Pause all downloads"
            title="Pause all downloads"
            disabled={!online}
            onPointerEnter={(event) =>
              animateButtonHover(
                event.currentTarget,
                "145, 148, 164",
                true,
                reduceMotion
              )
            }
            onPointerLeave={(event) =>
              animateButtonHover(
                event.currentTarget,
                "145, 148, 164",
                false,
                reduceMotion
              )
            }
            onClick={() => void useStore.getState().pauseAll()}
          >
            <span className="button-shine" aria-hidden="true" />
            <Ic n="pause" />
          </button>
          <button
            type="button"
            className="transfer-action shine-violet"
            aria-label="Resume all downloads"
            title="Resume all downloads"
            disabled={!online}
            onPointerEnter={(event) =>
              animateButtonHover(
                event.currentTarget,
                "171, 112, 255",
                true,
                reduceMotion
              )
            }
            onPointerLeave={(event) =>
              animateButtonHover(
                event.currentTarget,
                "171, 112, 255",
                false,
                reduceMotion
              )
            }
            onClick={() => void useStore.getState().resumeAll()}
          >
            <span className="button-shine" aria-hidden="true" />
            <Ic n="play" />
          </button>
        </div>
        <button aria-label="Minimize" onClick={() => win()?.minimize()}>
          <Ic n="min" />
        </button>
        <button aria-label="Maximize" onClick={() => win()?.toggleMaximize()}>
          <Ic n="max" />
        </button>
        <button aria-label="Close" onClick={() => win()?.close()}>
          <Ic n="x" />
        </button>
      </div>
    </div>
  );
}
