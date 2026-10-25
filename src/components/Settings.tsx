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
  description,
  update,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
  update(value: number): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  return (
    <label className="setting-field">
      <span className="setting-label">
        <b>{label}</b>
        {description && <small>{description}</small>}
      </span>
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
  actionLabel = "Reset section",
  onAction,
  description,
}: {
  title: string;
  onReset?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  description?: string;
}) {
  return (
    <div className="settings-section-heading">
      <div>
        <h2 id={`${title.toLowerCase().replace(/\s+/g, "-")}-settings-title`}>{title}</h2>
        {description && <p className="settings-section-subtitle">{description}</p>}
      </div>
      {(onReset || onAction) && (
        <button type="button" onClick={onAction ?? onReset}>
          {onAction ? actionLabel : "Reset section"}
        </button>
      )}
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
  update(enabled: boolean): Promise<void>;
}) {
  const [bridge, setBridge] = useState<BridgeState>();
  const [clients, setClients] = useState<BridgeClient[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const previousClientIds = useRef<Set<string> | null>(null);

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

  useEffect(() => {
    if (!bridge?.pairingCode) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void invoke<BridgeClient[]>("bridge_list_clients")
        .then(async (nextClients) => {
          setClients(nextClients);
          if (
            previousClientIds.current &&
            nextClients.some((client) => !previousClientIds.current?.has(client.id))
          ) {
            previousClientIds.current = null;
            await invoke("bridge_cancel_pairing");
            setBridge((current) =>
              current ? { ...current, pairingCode: null, pairingExpiresAt: null, paired: true } : current
            );
            return;
          }
          if (bridge.pairingExpiresAt && Date.now() / 1000 >= bridge.pairingExpiresAt) {
            previousClientIds.current = null;
            await invoke("bridge_cancel_pairing");
            setBridge((current) =>
              current ? { ...current, pairingCode: null, pairingExpiresAt: null } : current
            );
          }
        })
        .catch(() => setError("Could not check for a paired browser."));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [bridge?.pairingCode, bridge?.pairingExpiresAt]);

  async function startPairing() {
    try {
      previousClientIds.current = new Set(clients.map((client) => client.id));
      setBridge(await invoke<BridgeState>("bridge_start_pairing"));
      setError("");
    } catch {
      setError("Could not start pairing. Check that the bridge is enabled.");
    }
  }

  async function cancelPairing() {
    try {
      await invoke("bridge_cancel_pairing");
      previousClientIds.current = null;
      setBridge((current) =>
        current ? { ...current, pairingCode: null, pairingExpiresAt: null } : current
      );
      setError("");
    } catch {
      setError("Could not cancel browser pairing.");
    }
  }

  async function setBridgeEnabled(value: boolean) {
    await update(value);
    await refresh();
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
    <section className="settings-section" aria-labelledby="browser-integration-settings-title">
      <SectionHeading
        title="Browser integration"
        description="Let a paired browser extension send downloads to Helios."
        actionLabel="Refresh"
        onAction={() => void refresh()}
      />
      <div className="settings-panel">
        <label className="setting-field setting-check">
          <span className="setting-label">
            <b>Allow paired browser extensions to add downloads</b>
            <small>{enabled && bridge
              ? `On · Listening on 127.0.0.1:${bridge.port}`
              : enabled
                ? "Starting browser integration…"
                : "Off · Browser extensions cannot connect."}</small>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => void setBridgeEnabled(event.target.checked)}
          />
        </label>
        {enabled && bridge && (
          <>
            <div className="setting-field">
              <span className="setting-label">
                <b>Pair a browser</b>
                <small>Get a one-time code to enter in the extension</small>
              </span>
              {bridge.pairingCode ? (
                <span className="browser-bridge-status">Pairing code active</span>
              ) : (
                <button type="button" className="settings-action-button" onClick={() => void startPairing()}>
                  Pair a browser
                </button>
              )}
            </div>
            {bridge.pairingCode && (
              <div className="browser-pairing-card">
                <div>
                  <span className="settings-section-note">Enter this code in your browser extension</span>
                  <code className="bridge-pairing-code">{bridge.pairingCode}</code>
                  <span className="browser-pairing-countdown" aria-live="polite">
                    Expires in {formatCountdown(bridge.pairingExpiresAt, now)}
                  </span>
                </div>
                <button type="button" className="secondary-button" onClick={() => void cancelPairing()}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
        {bridge && clients.map((client) => (
          <div className="setting-field" key={client.id}>
            <span className="setting-label">
              <b>{client.label}</b>
              <small>
                Paired {new Date(client.createdAt * 1000).toLocaleString()} · {client.lastUsed
                  ? `Last used ${new Date(client.lastUsed * 1000).toLocaleString()}`
                  : "Not used yet"}
              </small>
            </span>
            <button type="button" className="settings-text-button danger" onClick={() => void revoke(client.id)}>
              Revoke
            </button>
          </div>
        ))}
        {bridge && !clients.length && (
          <p className="settings-section-note">No browsers paired yet.</p>
        )}
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function formatCountdown(expiresAt: number | null, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt ?? 0) - now / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
          <h1>Preferences</h1>
        </div>
        <button onClick={() => useStore.getState().setView("tasks")}>
          Back
        </button>
      </div>
      <section className="settings-section" aria-labelledby="downloads-settings-title">
        <SectionHeading
          title="Downloads"
          description="Limits and where files are saved."
          onReset={() => void update({
            maxDownloadMB: DEFAULT_SETTINGS.maxDownloadMB,
            maxUploadMB: DEFAULT_SETTINGS.maxUploadMB,
            maxConcurrent: DEFAULT_SETTINGS.maxConcurrent,
            connectionsPerServer: DEFAULT_SETTINGS.connectionsPerServer,
            downloadDir: DEFAULT_SETTINGS.downloadDir,
          })}
        />
        <div className="settings-panel">
        <NumberSetting
          label="Maximum download speed"
          value={settings.maxDownloadMB}
          min={0}
          step={0.1}
          description="0 means unlimited"
          unit="MB/s"
          update={(value) => void update({ maxDownloadMB: value })}
        />
        <NumberSetting
          label="Maximum upload speed"
          value={settings.maxUploadMB}
          min={0}
          step={0.1}
          description="0 means unlimited"
          unit="MB/s"
          update={(value) => void update({ maxUploadMB: value })}
        />
        <NumberSetting
          label="Maximum concurrent downloads"
          value={settings.maxConcurrent}
          min={1}
          max={20}
          description="How many downloads can run at once"
          update={(value) => void update({ maxConcurrent: Math.round(value) })}
        />
        <NumberSetting
          label="Connections per server"
          value={settings.connectionsPerServer}
          min={1}
          max={16}
          description="Per download server"
          update={(value) =>
            void update({ connectionsPerServer: Math.round(value) })
          }
        />
        {inTauri && (
          <>
            <div className="setting-field folder-field">
              <span className="setting-label">
                <b>Download folder</b>
                <small>Where new downloads are saved</small>
              </span>
              <span className="folder-choice">
                <span className="folder-current" title={settings.downloadDir || "Default Downloads folder"}>
                  {settings.downloadDir || "Default Downloads folder"}
                </span>
                <span>
                  <button className="settings-text-button" onClick={() => void chooseFolder()}>
                    Choose folder
                  </button>
                  {settings.downloadDir && (
                    <button className="settings-text-button" onClick={() => void update({ downloadDir: "" })}>
                      Use default
                    </button>
                  )}
                </span>
              </span>
            </div>
          </>
        )}
        </div>
        <p className="settings-section-note">Speed limits and download folder apply to new downloads. Concurrent download limits apply immediately.</p>
      </section>
      <section className="settings-section" aria-labelledby="files-settings-title">
        <SectionHeading
          title="Files"
          description="Choose what happens when a file already exists."
          onReset={() => void update({ fileConflict: DEFAULT_SETTINGS.fileConflict })}
        />
        <div className="settings-panel">
          <label className="setting-field">
            <span className="setting-label">
              <b>When a file already exists</b>
            </span>
            <select
              value={settings.fileConflict}
              onChange={(event) =>
                void update({ fileConflict: event.target.value as typeof settings.fileConflict })
              }
            >
              <option value="rename">Rename</option>
              <option value="overwrite">Overwrite</option>
              <option value="error">Show error</option>
            </select>
          </label>
        </div>
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
      <section
        className="settings-section"
        aria-labelledby="network-settings-title"
      >
        <SectionHeading
          title="Network"
          description="Choose a proxy for new downloads."
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
        <div className="settings-panel">
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
        </div>
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
          description="Seeding stops when either limit is reached."
          onReset={() =>
            void update({
              seedRatio: DEFAULT_SETTINGS.seedRatio,
              seedTimeHours: DEFAULT_SETTINGS.seedTimeHours,
              neverSeed: DEFAULT_SETTINGS.neverSeed,
            })
          }
        />
        <div className="settings-panel settings-fields seeding-fields">
          <NumberSetting
            label="Stop at share ratio"
            value={settings.seedRatio}
            min={0}
            max={1000}
            step={0.1}
          description="0 disables the ratio limit"
            update={(value) => void update({ seedRatio: value })}
          />
          <label className="setting-field">
            <span className="setting-label">
              <b>Maximum seeding time</b>
              <small>Leave empty for no time limit</small>
            </span>
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
              <small>hours</small>
            </span>
          </label>
          <label className="setting-field setting-check">
            <span className="setting-label">
              <b>Never seed</b>
              <small>Stop as soon as a torrent completes</small>
            </span>
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
      {inTauri && (
        <BrowserBridgeSettings
          enabled={settings.bridgeEnabled}
          update={(bridgeEnabled) => update({ bridgeEnabled })}
        />
      )}
      {inTauri && (
        <section className="settings-section settings-app" aria-labelledby="app-settings-title">
          <SectionHeading
            title="App"
            onReset={() => void update({
              closeToTray: DEFAULT_SETTINGS.closeToTray,
              startWithWindows: DEFAULT_SETTINGS.startWithWindows,
            })}
          />
          <div className="settings-panel">
            <label className="setting-field setting-check">
              <span className="setting-label">
                <b>Close button hides to tray</b>
                <small>Keep downloads running in the background</small>
              </span>
              <input
                type="checkbox"
                checked={settings.closeToTray}
                onChange={(event) => void update({ closeToTray: event.target.checked })}
              />
            </label>
            <label className="setting-field setting-check">
              <span className="setting-label"><b>Start with Windows</b></span>
              <input
                type="checkbox"
                checked={settings.startWithWindows}
                onChange={(event) => void updateAutostart(event.target.checked)}
              />
            </label>
          </div>
        </section>
      )}
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
