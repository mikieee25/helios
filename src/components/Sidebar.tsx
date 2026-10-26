"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useStore, Filter } from "@/lib/store";
import { buildOverview } from "@/lib/overview";
import { Ic } from "./Icon";

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
  const seedingBadge = useRef<HTMLSpanElement>(null);
  const completedBadge = useRef<HTMLSpanElement>(null);
  const previousStatusCounts = useRef<{
    seeding: number;
    completed: number;
  } | null>(null);

  useEffect(() => {
    const previous = previousStatusCounts.current;
    previousStatusCounts.current = {
      seeding: seedingCount,
      completed: completedCount,
    };
    if (
      !previous ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
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
  }, [seedingCount, completedCount]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setDark(theme === "system" ? media.matches : theme === "dark");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <aside className="side">
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
