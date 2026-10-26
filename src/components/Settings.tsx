"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, useStore, validateProxy, type Settings as SettingsType } from "@/lib/store";
import { Button, NumberField, SelectField, SettingRow, SettingsSection, TextField, Toggle } from "@/components/settings/ui";

type BridgeState = { enabled: boolean; port: number; paired: boolean; pairingCode: string | null; pairingExpiresAt: number | null };
type BridgeClient = { id: string; label: string; createdAt: number; lastUsed: number | null };
type Section = "Downloads" | "Files" | "Network" | "Seeding" | "Notifications" | "Browser integration" | "Behavior" | "Appearance" | "App" | "Advanced";

function Choice({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <SelectField value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField>;
}

function BrowserIntegration({ enabled, save, saved }: { enabled: boolean; save: (patch: Partial<SettingsType>) => void; saved: boolean }) {
  const [bridge, setBridge] = useState<BridgeState>();
  const [clients, setClients] = useState<BridgeClient[]>([]);
  const [timings, setTimings] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const clientIds = useRef<Set<string> | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      const [status, paired] = await Promise.all([invoke<BridgeState>("bridge_get_state"), invoke<BridgeClient[]>("bridge_list_clients")]);
      setBridge(status); setClients(paired); setError("");
    } catch { setError("Could not load browser integration."); }
  }, []);
  useEffect(() => { void refresh(); const id = window.setInterval(() => { void refresh(); void invoke<number[]>("bridge_get_timings").then(setTimings).catch(() => {}); }, 3000); return () => window.clearInterval(id); }, [refresh]);
  useEffect(() => {
    if (!bridge?.pairingCode) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      void invoke<BridgeClient[]>("bridge_list_clients").then(async (next) => {
        setClients(next);
        if (clientIds.current && next.some((client) => !clientIds.current?.has(client.id))) {
          clientIds.current = undefined; await invoke("bridge_cancel_pairing");
          setBridge((current) => current ? { ...current, pairingCode: null, pairingExpiresAt: null, paired: true } : current);
        }
      }).catch(() => setError("Could not check paired browsers."));
    }, 3000);
    return () => window.clearInterval(id);
  }, [bridge?.pairingCode]);
  const startPairing = async () => { try { clientIds.current = new Set(clients.map(({ id }) => id)); setBridge(await invoke<BridgeState>("bridge_start_pairing")); setError(""); } catch { setError("Could not start pairing."); } };
  const cancelPairing = async () => { try { await invoke("bridge_cancel_pairing"); clientIds.current = undefined; setBridge((current) => current ? { ...current, pairingCode: null, pairingExpiresAt: null } : current); } catch { setError("Could not cancel pairing."); } };
  const remaining = Math.max(0, Math.ceil((bridge?.pairingExpiresAt ?? 0) - now / 1000));
  return <SettingsSection title="Browser integration" saved={saved}>
    <SettingRow label="Allow browser extensions" description={<span className="pref-listening">{enabled && bridge ? <><i />Listening on 127.0.0.1:{bridge.port}</> : "Off"}</span>} control={<Toggle label="Allow browser extensions" checked={enabled} onChange={(value) => save({ bridgeEnabled: value })} />} />
    <SettingRow label="Paired browsers" control={<Button variant="accent" onClick={() => void startPairing()} disabled={!enabled || !!bridge?.pairingCode}>Pair a browser</Button>} />
    {bridge?.pairingCode && <div className="pref-pairing-row"><code>{bridge.pairingCode}</code><span>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span><Button variant="ghost" onClick={() => void cancelPairing()}>Cancel</Button></div>}
    {clients.map((client) => <SettingRow key={client.id} label={client.label} description={client.lastUsed ? `Last used ${new Date(client.lastUsed * 1000).toLocaleString()}` : "Never used"} control={<Button variant="danger-ghost" onClick={() => void invoke("bridge_revoke_client", { id: client.id }).then(refresh).catch(() => setError("Could not revoke browser."))}>Revoke</Button>} />)}
    {!clients.length && <SettingRow label="No paired browsers" />}
    <SettingRow label="Last hand-off" description={timings.length ? `${timings[timings.length - 1]} ms` : "—"} />
    {error && <div className="pref-panel-error" role="alert">{error}</div>}
  </SettingsSection>;
}

export default function Settings() {
  const settings = useStore((state) => state.settings);
  const error = useStore((state) => state.settingsError);
  const update = useStore((state) => state.updateSettings);
  const updateAutostart = useStore((state) => state.updateAutostart);
  const notifications = useStore((state) => state.notify);
  const setNotifications = useStore((state) => state.setNotify);
  const [savedSection, setSavedSection] = useState<Section>();
  const [proxy, setProxy] = useState({ proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, proxyUser: settings.proxyUser, proxyPassword: settings.proxyPassword, noProxy: settings.noProxy });
  const [proxyError, setProxyError] = useState("");
  const [resetAll, setResetAll] = useState(false);
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const save = (section: Section, patch: Partial<SettingsType>) => {
    void update(patch); setSavedSection(section); window.setTimeout(() => setSavedSection((value) => value === section ? undefined : value), 1500);
  };
  useEffect(() => setProxy({ proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, proxyUser: settings.proxyUser, proxyPassword: settings.proxyPassword, noProxy: settings.noProxy }), [settings.proxyMode, settings.proxyUrl, settings.proxyUser, settings.proxyPassword, settings.noProxy]);
  useEffect(() => {
    const theme = settings.theme;
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme; };
    apply(); const query = matchMedia("(prefers-color-scheme: dark)"); query.addEventListener("change", apply); return () => query.removeEventListener("change", apply);
  }, [settings.theme]);
  const chooseFolder = async () => { const selected = await open({ directory: true, multiple: false, title: "Choose download folder" }); if (typeof selected === "string") save("Downloads", { downloadDir: selected }); };
  const proxyPatch = (patch: Partial<typeof proxy>) => {
    const next = { ...proxy, ...patch }; setProxy(next);
    const invalid = next.proxyMode === "manual" ? validateProxy(next.proxyUrl) : undefined;
    setProxyError(invalid ?? ""); if (!invalid) save("Network", next);
  };
  const reset = (section: Section, keys: (keyof SettingsType)[]) => save(section, Object.fromEntries(keys.map((key) => [key, DEFAULT_SETTINGS[key]])) as Partial<SettingsType>);
  const num = (section: Section, label: string, key: "maxDownloadMB" | "maxUploadMB" | "maxConcurrent" | "connectionsPerServer" | "seedRatio" | "seedTimeHours" | "connectTimeoutSeconds", placeholder: string, unit?: string, disabled = false) => <SettingRow label={label} control={<NumberField aria-label={label} min="0" step={key === "seedRatio" || key === "seedTimeHours" || key === "maxDownloadMB" || key === "maxUploadMB" ? "0.1" : "1"} value={settings[key]} placeholder={settings[key] === 0 || settings[key] === "" ? placeholder : undefined} unit={unit} disabled={disabled} onChange={(raw) => save(section, { [key]: raw === "" && key === "seedTimeHours" ? "" : Math.max(0, Number(raw)) } as Partial<SettingsType>)} />} />;
  const sectionSaved = (section: Section) => savedSection === section;
  const defaultDownloads = { maxDownloadMB: DEFAULT_SETTINGS.maxDownloadMB, maxUploadMB: DEFAULT_SETTINGS.maxUploadMB, maxConcurrent: DEFAULT_SETTINGS.maxConcurrent, connectionsPerServer: DEFAULT_SETTINGS.connectionsPerServer, downloadDir: DEFAULT_SETTINGS.downloadDir };

  return <section className="settings-view">
    <header className="pref-page-head"><div><div className="lbl">Settings</div><h1>Preferences</h1></div><Button variant="secondary" onClick={() => useStore.getState().setView("tasks")}>Back</Button></header>
    <SettingsSection title="Downloads" saved={sectionSaved("Downloads")} reset={() => reset("Downloads", Object.keys(defaultDownloads) as (keyof SettingsType)[])}>
      {num("Downloads", "Download speed limit", "maxDownloadMB", "Unlimited", "MB/s")}{num("Downloads", "Upload speed limit", "maxUploadMB", "Unlimited", "MB/s")}{num("Downloads", "Simultaneous downloads", "maxConcurrent", "5")}{num("Downloads", "Connections per server", "connectionsPerServer", "16")}
      {inTauri && <SettingRow label="Download folder" control={<div className="pref-folder"><span title={settings.downloadDir || "Default Downloads folder"}>{settings.downloadDir || "Default"}</span>{settings.downloadDir && <Button variant="ghost" onClick={() => save("Downloads", { downloadDir: "" })}>Default</Button>}<Button variant="accent" onClick={() => void chooseFolder()}>Choose</Button></div>} />}
    </SettingsSection>
    <SettingsSection title="Files" badge="New downloads" saved={sectionSaved("Files")} reset={() => reset("Files", ["fileConflict"])}>
      <SettingRow label="If a file exists" description={settings.fileConflict === "overwrite" ? <span className="pref-error">Replaces the old file</span> : undefined} control={<Choice value={settings.fileConflict} onChange={(value) => save("Files", { fileConflict: value as SettingsType["fileConflict"] })} options={[["rename", "Rename"], ["overwrite", "Overwrite"], ["error", "Show error"]]} />} />
    </SettingsSection>
    <SettingsSection title="Network" badge="New downloads" saved={sectionSaved("Network")} reset={() => { setProxy({ proxyMode: DEFAULT_SETTINGS.proxyMode, proxyUrl: "", proxyUser: "", proxyPassword: "", noProxy: "" }); setProxyError(""); reset("Network", ["proxyMode", "proxyUrl", "proxyUser", "proxyPassword", "noProxy"]); }}>
      <SettingRow label="Proxy" control={<Choice value={proxy.proxyMode} onChange={(value) => proxyPatch({ proxyMode: value as typeof proxy.proxyMode })} options={[["none", "None"], ["manual", "Manual"]]} />} />
      {proxy.proxyMode === "manual" && <div className="pref-subrows">
        <SettingRow label="Address" error={proxyError} control={<TextField aria-label="Proxy address" value={proxy.proxyUrl} placeholder="host:3128" onChange={(event) => proxyPatch({ proxyUrl: event.target.value })} />} />
        <SettingRow label="Username" control={<TextField aria-label="Proxy username" value={proxy.proxyUser} onChange={(event) => proxyPatch({ proxyUser: event.target.value })} />} />
        <SettingRow label="Password" control={<TextField aria-label="Proxy password" type="password" value={proxy.proxyPassword} onChange={(event) => proxyPatch({ proxyPassword: event.target.value })} />} />
        <SettingRow label="Bypass list" control={<TextField aria-label="Bypass list" value={proxy.noProxy} onChange={(event) => proxyPatch({ noProxy: event.target.value })} />} />
      </div>}
    </SettingsSection>
    <SettingsSection title="Seeding" badge="New downloads" saved={sectionSaved("Seeding")} reset={() => reset("Seeding", ["seedRatio", "seedTimeHours", "neverSeed"])}>
      {num("Seeding", "Stop at ratio", "seedRatio", "No limit", undefined, settings.neverSeed)}{num("Seeding", "Stop after", "seedTimeHours", "No limit", "hours", settings.neverSeed)}
      <SettingRow label="Never seed" control={<Toggle label="Never seed" checked={settings.neverSeed} onChange={(value) => save("Seeding", { neverSeed: value })} />} />
      {settings.seedRatio === 0 && settings.seedTimeHours === "" && !settings.neverSeed && <div className="pref-row"><div className="pref-label"><small className="pref-error">Seeds forever</small></div></div>}
    </SettingsSection>
    <SettingsSection title="Notifications" saved={sectionSaved("Notifications")}>
      {([["notifyFinished", "Download finished"], ["notifyFailed", "Download failed"], ["notifyBrowserAdds", "Browser adds a download"]] as const).map(([key, label]) => <SettingRow key={key} label={label} disabled={!notifications} control={<Toggle label={label} checked={settings[key]} disabled={!notifications} onChange={(value) => save("Notifications", { [key]: value })} />} />)}
    </SettingsSection>
    {inTauri && <BrowserIntegration enabled={settings.bridgeEnabled} save={(patch) => save("Browser integration", patch)} saved={sectionSaved("Browser integration")} />}
    <SettingsSection title="Behavior" saved={sectionSaved("Behavior")} reset={() => reset("Behavior", ["confirmBeforeRemoving", "deleteFilesWhenRemoving", "chooseFilesBeforeStarting"])}>
      <SettingRow label="Confirm before removing" control={<Toggle label="Confirm before removing" checked={settings.confirmBeforeRemoving} onChange={(value) => save("Behavior", { confirmBeforeRemoving: value })} />} />
      <SettingRow label="Delete files when removing" control={<Toggle label="Delete files when removing" checked={settings.deleteFilesWhenRemoving} onChange={(value) => save("Behavior", { deleteFilesWhenRemoving: value })} />} />
      <SettingRow label="Choose torrent files before starting" control={<Toggle label="Choose torrent files before starting" checked={settings.chooseFilesBeforeStarting} onChange={(value) => { save("Behavior", { chooseFilesBeforeStarting: value }); }} />} />
    </SettingsSection>
    <SettingsSection title="Appearance" saved={sectionSaved("Appearance")} reset={() => reset("Appearance", ["theme", "compactList", "reduceMotion"])}>
      <SettingRow label="Theme" control={<Choice value={settings.theme} onChange={(value) => save("Appearance", { theme: value as SettingsType["theme"] })} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} />} />
      <SettingRow label="Compact list" control={<Toggle label="Compact list" checked={settings.compactList} onChange={(value) => save("Appearance", { compactList: value })} />} />
      <SettingRow label="Reduce motion" control={<Toggle label="Reduce motion" checked={settings.reduceMotion} onChange={(value) => save("Appearance", { reduceMotion: value })} />} />
    </SettingsSection>
    {inTauri && <SettingsSection title="App" saved={sectionSaved("App")} reset={() => reset("App", ["startWithWindows", "startMinimized", "closeToTray"])}>
      <SettingRow label="Start with Windows" control={<Toggle label="Start with Windows" checked={settings.startWithWindows} onChange={(value) => { void updateAutostart(value); save("App", { startWithWindows: value }); }} />} />
      {settings.startWithWindows && <div className="pref-subrows"><SettingRow label="Start minimized to tray" control={<Toggle label="Start minimized to tray" checked={settings.startMinimized} onChange={(value) => save("App", { startMinimized: value })} />} /></div>}
      <SettingRow label="Close button hides to tray" control={<Toggle label="Close button hides to tray" checked={settings.closeToTray} onChange={(value) => save("App", { closeToTray: value })} />} />
    </SettingsSection>}
    <details className="pref-advanced"><summary>Advanced</summary><SettingsSection title="Advanced" saved={sectionSaved("Advanced")} reset={() => reset("Advanced", ["fasterDnsFallback", "diskAllocation"])}>
      <SettingRow label="Faster DNS fallback" control={<Toggle label="Faster DNS fallback" checked={settings.fasterDnsFallback} onChange={(value) => save("Advanced", { fasterDnsFallback: value })} />} />
      <SettingRow label="Disk allocation" control={<Choice value={settings.diskAllocation} onChange={(value) => save("Advanced", { diskAllocation: value as SettingsType["diskAllocation"] })} options={[["none", "Off"], ["prealloc", "Reserve space"], ["falloc", "Fast reserve"]]} />} />
      {num("Advanced", "Connection timeout", "connectTimeoutSeconds", "10", "s")}
      <SettingRow label="Custom user agent" control={<TextField aria-label="Custom user agent" value={settings.customUserAgent} placeholder="Default" onChange={(event) => save("Advanced", { customUserAgent: event.target.value })} />} />
      <SettingRow label="Open data folder" control={<Button variant="ghost" disabled>Open</Button>} />
      <SettingRow label="Copy diagnostics" control={<Button variant="ghost" disabled>Copy</Button>} />
      <SettingRow label="Reset all settings" control={<Button variant="danger-ghost" onClick={() => setResetAll(true)}>Reset</Button>} />
    </SettingsSection></details>
    <div className="pref-about">Helios 0.1.2 · aria2 · <button type="button" disabled={!inTauri} onClick={() => void invoke("open_licenses")}>Licenses</button></div>
    {error && <p className="pref-global-error" role="alert">{error}</p>}
    {resetAll && <div className="pref-confirm" role="alertdialog" aria-modal="true"><p>Reset all preferences?</p><Button variant="secondary" onClick={() => setResetAll(false)}>Cancel</Button><Button variant="danger-ghost" onClick={() => { setResetAll(false); void update(DEFAULT_SETTINGS); }}>Reset all settings</Button></div>}
    <span className="sr-only" aria-live="polite">{savedSection ? `${savedSection} saved` : ""}</span>
  </section>;
}
