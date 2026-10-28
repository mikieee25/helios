"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useStore, Filter } from "@/lib/store";
import { buildOverview } from "@/lib/overview";
import { Ic } from "./Icon";
import { prefersReducedMotion } from "@/lib/motion";

const NAV: [Filter, string, string][] = [
  ["all", "home", "Overview"],
  ["dl", "down", "Downloading"],
  ["seed", "up", "Seeding"],
  ["done", "folder", "Completed"],
];
export default function Sidebar() {
  const filter = useStore((s) => s.filter);
  const history = useStore((s) => s.history);
  const tasks = useStore((s) => s.tasks);
  const category = useStore((s) => s.category);
  const notify = useStore((s) => s.notify);
  const view = useStore((s) => s.view);
  const ready = useStore((s) => s.ready);
  const theme = useStore((s) => s.settings.theme);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const updateSettings = useStore((s) => s.updateSettings);
  const setFilter = useStore((s) => s.setFilter);
  const counts = [
    buildOverview(tasks, history, category).length,
    tasks.filter((t) => t.state === "dl").length,
    tasks.filter((t) => t.state === "seed").length,
    history.length,
  ];
  const seedingCount = counts[2];
  const completedCount = counts[3];
  const [dark, setDark] = useState(true);
  const sideRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLSpanElement>(null);
  const previousActiveRef = useRef<Element | null>(null);
  const seedingBadge = useRef<HTMLSpanElement>(null);
  const completedBadge = useRef<HTMLSpanElement>(null);
  const previousStatusCounts = useRef<{
    seeding: number;
    completed: number;
  } | null>(null);

  useLayoutEffect(() => {
    const side = sideRef.current;
    const indicator = activeTabRef.current;
    const active = side?.querySelector(".nav button.on, .set > button.on");
    if (!side || !indicator || !active) return;

    const move = (animate: boolean) => {
      const sideRect = side.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const position = {
        x: activeRect.left - sideRect.left,
        y: activeRect.top - sideRect.top,
        width: activeRect.width,
        height: activeRect.height,
        autoAlpha: 1,
      };
      const previous = previousActiveRef.current;
      if (!previous || !animate || prefersReducedMotion(reduceMotion)) {
        gsap.set(indicator, position);
      } else {
        gsap.to(indicator, {
          ...position,
          duration: 0.32,
          ease: "power3.out",
          overwrite: true,
        });
      }
      previousActiveRef.current = active;
    };

    move(true);
    return () => {
      gsap.killTweensOf(indicator);
    };
  }, [filter, view, reduceMotion]);

  useLayoutEffect(() => {
    const side = sideRef.current;
    const indicator = activeTabRef.current;
    if (!side || !indicator) return;

    const syncPosition = () => {
      const active = side.querySelector(".nav button.on, .set > button.on");
      if (!active) return;
      const sideRect = side.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      gsap.killTweensOf(indicator);
      gsap.set(indicator, {
        x: activeRect.left - sideRect.left,
        y: activeRect.top - sideRect.top,
        width: activeRect.width,
        height: activeRect.height,
        autoAlpha: 1,
      });
      previousActiveRef.current = active;
    };
    const observer = new ResizeObserver(syncPosition);
    observer.observe(side);
    window.addEventListener("resize", syncPosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncPosition);
    };
  }, []);

  useEffect(() => {
    const previous = previousStatusCounts.current;
    previousStatusCounts.current = {
      seeding: seedingCount,
      completed: completedCount,
    };
    if (
      !previous ||
      prefersReducedMotion(reduceMotion)
    ) {
      return;
    }

    const changedBadges: HTMLSpanElement[] = [];
    if (previous.seeding !== seedingCount && seedingBadge.current) {
      changedBadges.push(seedingBadge.current);
    }
    if (previous.completed !== completedCount && completedBadge.current) {
      changedBadges.push(completedBadge.current);
    }
    if (!changedBadges.length) return;

    const tween = gsap.to(changedBadges, {
      scale: 1.12,
      duration: 0.12,
      repeat: 1,
      yoyo: true,
      ease: "power2.out",
      overwrite: true,
    });

    return () => {
      tween.revert();
    };
  }, [seedingCount, completedCount, reduceMotion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const isDark = theme === "system" ? media.matches : theme === "dark";
      setDark(isDark);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <aside ref={sideRef} className="side">
      <span ref={activeTabRef} className="side-active-tab" aria-hidden="true" />
      <div className="lbl">Overview</div>
      <nav className="nav">
        {NAV.map(([f, icon, label], i) => (
          <button
            key={f}
            className={filter === f && view === "tasks" ? "on" : ""}
            onClick={() => {
              useStore.getState().setView("tasks");
              setFilter(f);
            }}
          >
            <Ic n={icon} />
            {label}
            <span
              ref={
                f === "seed"
                  ? seedingBadge
                  : f === "done"
                    ? completedBadge
                    : undefined
              }
              className={`n${
                f === "seed"
                  ? " status-seeding"
                  : f === "done"
                    ? " status-completed"
                    : ""
              }`}
            >
              {ready ? counts[i] : "—"}
            </span>
          </button>
        ))}
      </nav>
      <div className="set">
        <div className="lbl">Settings</div>
        <button
          className={`it ${view === "settings" ? "on" : ""}`}
          onClick={() =>
            useStore
              .getState()
              .setView(view === "settings" ? "tasks" : "settings")
          }
        >
          <Ic n="sliders" />
          Settings
        </button>
        <div className="it">
          <Ic n="bell" />
          Notifications
          <button
            className="sw"
            aria-label="Notifications"
            aria-pressed={notify}
            onClick={() => useStore.getState().setNotify(!notify)}
          />
        </div>
        <div className="it">
          <Ic n="moon" />
          Dark theme
          <button
            className="sw"
            aria-label="Dark theme"
            aria-pressed={dark}
            onClick={() => void updateSettings({ theme: dark ? "light" : "dark" })}
          />
        </div>
      </div>
    </aside>
  );
}
