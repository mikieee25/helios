"use client";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, useStore, validateProxy } from "@/lib/store";

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

function SectionHeading({
  title,
  onReset,
}: {
  title: string;
  onReset(): void;
}) {
  return (
    <div className="settings-section-heading">
      <h2 id={`${title.toLowerCase()}-settings-title`}>{title}</h2>
      <button type="button" onClick={onReset}>
        Reset section
      </button>
    </div>
  );
}

type BridgeState = {
  enabled: boolean;
  port: number;
  paired: boolean;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
};

type BridgeClient = {
  id: string;
  label: string;
  createdAt: number;
  lastUsed: number | null;
};

function BrowserBridgeSettings({
  enabled,
  update,
}: {
  enabled: boolean;
  update(enabled: boolean): void;
}) {
  const [bridge, setBridge] = useState<BridgeState>();
  const [clients, setClients] = useState<BridgeClient[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [state, pairedClients] = await Promise.all([
        invoke<BridgeState>("bridge_get_state"),
        invoke<BridgeClient[]>("bridge_list_clients"),
      ]);
      setBridge(state);
      setClients(pairedClients);
      setError("");
    } catch {
      setError("Could not load browser bridge status.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startPairing() {
    try {
      setBridge(await invoke<BridgeState>("bridge_start_pairing"));
      setError("");
    } catch {
      setError("Could not start pairing. Check that the bridge is enabled.");
    }
  }

  async function revoke(id: string) {
    try {
      await invoke("bridge_revoke_client", { id });
      await refresh();
    } catch {
      setError("Could not revoke this browser.");
    }
  }

  return (
    <section className="settings-section" aria-labelledby="bridge-settings-title">
      <div className="settings-section-heading">
        <h2 id="bridge-settings-title">Browser bridge</h2>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <label className="setting-field setting-check">
        <span>Allow paired browser extensions to add downloads</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => update(event.target.checked)}
        />
      </label>
      <p className="settings-section-note">
        Listens on this computer only. Pairing codes expire after two minutes.
      </p>
      {enabled && bridge && (
        <>
          <p className="settings-section-note">
            Local address: 127.0.0.1:{bridge.port}
          </p>
          <div className="settings-section-fields">
            <div className="setting-field">
              <span>{bridge.pairingCode ? "Pairing code" : "Pair a browser"}</span>
              {bridge.pairingCode ? (
                <code className="bridge-pairing-code">
                  {bridge.pairingCode}
                </code>
              ) : (
                <button type="button" onClick={() => void startPairing()}>
                  Generate pairing code
                </button>
              )}
            </div>
          </div>
          <div className="settings-section-fields bridge-client-list">
            {clients.map((client) => (
              <div className="setting-field" key={client.id}>
                <span>
                  {client.label}
                  <small>
                    {client.lastUsed
                      ? `Last used ${new Date(client.lastUsed * 1000).toLocaleString()}`
                      : "Not used yet"}
                  </small>
                </span>
                <button type="button" onClick={() => void revoke(client.id)}>
                  Revoke
                </button>
              </div>
            ))}
            {!clients.length && (
              <p className="settings-section-note">No browsers paired.</p>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const error = useStore((s) => s.settingsError);
  const update = useStore((s) => s.updateSettings);
  const updateAutostart = useStore((s) => s.updateAutostart);
  const [proxy, setProxy] = useState(() => ({
    proxyMode: settings.proxyMode,
    proxyUrl: settings.proxyUrl,
    proxyUser: settings.proxyUser,
    proxyPassword: settings.proxyPassword,
    noProxy: settings.noProxy,
  }));
  const [proxyError, setProxyError] = useState("");
  const inTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    setProxy({
      proxyMode: settings.proxyMode,
      proxyUrl: settings.proxyUrl,
      proxyUser: settings.proxyUser,
      proxyPassword: settings.proxyPassword,
      noProxy: settings.noProxy,
    });
  }, [
    settings.proxyMode,
    settings.proxyUrl,
    settings.proxyUser,
    settings.proxyPassword,
    settings.noProxy,
  ]);

  function changeProxy(patch: Partial<typeof proxy>) {
    const next = { ...proxy, ...patch };
    setProxy(next);
    const validation =
      next.proxyMode === "manual" ? validateProxy(next.proxyUrl) : undefined;
    setProxyError(validation ?? "");
    if (!validation) void update(next);
  }

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
                onChange={(event) =>
                  void update({ closeToTray: event.target.checked })
                }
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
      {inTauri && (
        <BrowserBridgeSettings
          enabled={settings.bridgeEnabled}
          update={(bridgeEnabled) => void update({ bridgeEnabled })}
        />
      )}
      <section
        className="settings-section"
        aria-labelledby="network-settings-title"
      >
        <SectionHeading
          title="Network"
          onReset={() => {
            const reset = {
              proxyMode: DEFAULT_SETTINGS.proxyMode,
              proxyUrl: DEFAULT_SETTINGS.proxyUrl,
              proxyUser: DEFAULT_SETTINGS.proxyUser,
              proxyPassword: DEFAULT_SETTINGS.proxyPassword,
              noProxy: DEFAULT_SETTINGS.noProxy,
            };
            setProxy(reset);
            setProxyError("");
            void update(reset);
          }}
        />
        <label className="setting-field">
          <span>Proxy</span>
          <select
            value={proxy.proxyMode}
            onChange={(event) =>
              changeProxy({
                proxyMode: event.target.value as typeof proxy.proxyMode,
              })
            }
          >
            <option value="none">None</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {proxy.proxyMode === "manual" && (
          <div className="settings-section-fields">
            <label className="setting-field">
              <span>Proxy address</span>
              <input
                type="text"
                autoComplete="url"
                value={proxy.proxyUrl}
                placeholder="http://host:3128"
                onChange={(event) =>
                  changeProxy({ proxyUrl: event.target.value })
                }
              />
            </label>
            <label className="setting-field">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                value={proxy.proxyUser}
                onChange={(event) =>
                  changeProxy({ proxyUser: event.target.value })
                }
              />
            </label>
            <label className="setting-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={proxy.proxyPassword}
                onChange={(event) =>
                  changeProxy({ proxyPassword: event.target.value })
                }
              />
            </label>
            <label className="setting-field">
              <span>Bypass hosts</span>
              <input
                type="text"
                value={proxy.noProxy}
                placeholder="localhost, 127.0.0.1"
                onChange={(event) =>
                  changeProxy({ noProxy: event.target.value })
                }
              />
            </label>
          </div>
        )}
        {proxyError && (
          <p className="settings-error inline-settings-error" role="alert">
            {proxyError}
          </p>
        )}
        <p className="settings-section-note">
          Applies to new downloads only. The password is stored in the app's
          local settings file.
        </p>
      </section>
      <section
        className="settings-section"
        aria-labelledby="seeding-settings-title"
      >
        <SectionHeading
          title="Seeding"
          onReset={() =>
            void update({
              seedRatio: DEFAULT_SETTINGS.seedRatio,
              seedTimeHours: DEFAULT_SETTINGS.seedTimeHours,
              neverSeed: DEFAULT_SETTINGS.neverSeed,
            })
          }
        />
        <div className="settings-fields seeding-fields">
          <NumberSetting
            label="Stop at share ratio"
            value={settings.seedRatio}
            min={0}
            max={1000}
            step={0.1}
            unit="0 disables ratio limit"
            update={(value) => void update({ seedRatio: value })}
          />
          <label className="setting-field">
            <span>Maximum seeding time</span>
            <span className="setting-input">
              <input
                type="number"
                min="0"
                step="0.1"
                value={settings.seedTimeHours}
                disabled={settings.neverSeed}
                onChange={(event) =>
                  void update({
                    seedTimeHours:
                      event.target.value === ""
                        ? ""
                        : Math.max(0, Number(event.target.value)),
                  })
                }
              />
              <small>hours · empty is unlimited</small>
            </span>
          </label>
          <label className="setting-field setting-check">
            <span>Never seed</span>
            <input
              type="checkbox"
              checked={settings.neverSeed}
              onChange={(event) =>
                void update({ neverSeed: event.target.checked })
              }
            />
          </label>
        </div>
        {settings.neverSeed ? (
          <p className="settings-section-note">
            Torrents stop seeding immediately after completion.
          </p>
        ) : (
          <p
            className={`settings-section-note${settings.seedRatio === 0 && settings.seedTimeHours === "" ? " settings-warning" : ""}`}
          >
            {settings.seedRatio === 0 && settings.seedTimeHours === ""
              ? "Torrents will seed forever."
              : "aria2 stops seeding when either limit is reached."}
          </p>
        )}
        <p className="settings-section-note">Applies to new downloads only.</p>
      </section>
      <section
        className="settings-section"
        aria-labelledby="files-settings-title"
      >
        <SectionHeading
          title="Files"
          onReset={() =>
            void update({ fileConflict: DEFAULT_SETTINGS.fileConflict })
          }
        />
        <label className="setting-field">
          <span>When a file already exists</span>
          <select
            value={settings.fileConflict}
            onChange={(event) =>
              void update({
                fileConflict: event.target
                  .value as typeof settings.fileConflict,
              })
            }
          >
            <option value="rename">Rename</option>
            <option value="overwrite">Overwrite</option>
            <option value="error">Show error</option>
          </select>
        </label>
        <p className="settings-section-note">
          {settings.fileConflict === "rename"
            ? "Keep the existing file and save the new download under a renamed file."
            : settings.fileConflict === "overwrite"
              ? "Replace the existing file with the new download."
              : "Keep the existing file and stop with an error if the name conflicts."}
        </p>
        {settings.fileConflict === "overwrite" && (
          <p className="settings-section-note settings-warning">
            Existing files can be permanently replaced.
          </p>
        )}
        <p className="settings-section-note">Applies to new downloads only.</p>
      </section>
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
