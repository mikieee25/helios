"use client";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";

function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  update,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
  unit?: string;
  update(value: number): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  return (
    <label className="setting-field">
      <span>{label}</span>
      <span className="setting-input">
        <input
          ref={inputRef}
          type="text"
          inputMode={step < 1 ? "decimal" : "numeric"}
          value={draft}
          onBlur={() => setDraft(String(value))}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number(e.target.value);
            if (
              Number.isFinite(next) &&
              next >= min &&
              (max === undefined || next <= max)
            )
              update(next);
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const error = useStore((s) => s.settingsError);
  const update = useStore((s) => s.updateSettings);
  const updateAutostart = useStore((s) => s.updateAutostart);
  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  async function chooseFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose download folder",
    });
    if (typeof selected === "string") await update({ downloadDir: selected });
  }

  return (
    <section className="settings-view">
      <div className="settings-heading">
        <div>
          <div className="lbl">Settings</div>
          <h1>Download preferences</h1>
        </div>
        <button onClick={() => useStore.getState().setView("tasks")}>
          Back
        </button>
      </div>
      <div className="settings-fields">
        <NumberSetting
          label="Maximum download speed"
          value={settings.maxDownloadMB}
          min={0}
          step={0.1}
          unit="MB/s · 0 unlimited"
          update={(value) => void update({ maxDownloadMB: value })}
        />
        <NumberSetting
          label="Maximum upload speed"
          value={settings.maxUploadMB}
          min={0}
          step={0.1}
          unit="MB/s · 0 unlimited"
          update={(value) => void update({ maxUploadMB: value })}
        />
        <NumberSetting
          label="Maximum concurrent downloads"
          value={settings.maxConcurrent}
          min={1}
          update={(value) => void update({ maxConcurrent: Math.round(value) })}
        />
        <NumberSetting
          label="Connections per server"
          value={settings.connectionsPerServer}
          min={1}
          max={16}
          update={(value) =>
            void update({ connectionsPerServer: Math.round(value) })
          }
        />
        {inTauri && (
          <>
            <div className="setting-field folder-field">
              <span>Download folder</span>
              <span className="folder-choice">
                {settings.downloadDir || "Default Downloads folder"}
                <span>
                  <button onClick={() => void chooseFolder()}>
                    Choose folder
                  </button>
                  {settings.downloadDir && (
                    <button onClick={() => void update({ downloadDir: "" })}>
                      Use default
                    </button>
                  )}
                </span>
              </span>
            </div>
            <label className="setting-field setting-check">
              <span>Close button hides to tray</span>
              <input
                type="checkbox"
                checked={settings.closeToTray}
                onChange={(event) => void update({ closeToTray: event.target.checked })}
              />
            </label>
            <label className="setting-field setting-check">
              <span>Start with Windows</span>
              <input
                type="checkbox"
                checked={settings.startWithWindows}
                onChange={(event) => void updateAutostart(event.target.checked)}
              />
            </label>
          </>
        )}
      </div>
      {error && (
        <p className="settings-error" role="alert">
          Could not apply settings: {error}
        </p>
      )}
      <p className="settings-note">
        Changes apply to aria2 while it is connected. The download folder
        applies to new downloads.
      </p>
    </section>
  );
}
