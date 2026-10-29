"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import appPackage from "../../package.json";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, getAria2Version, getRecentDiagnosticErrors, numberFieldState, useStore, validateProxy, type Settings as SettingsType } from "@/lib/store";
import { Button, NumberField, SelectField, SettingRow, SettingsSection, TextField, Toggle } from "@/components/settings/ui";
import { redactDiagnostics } from "@/lib/diagnostics";
import { installUpdate } from "@/lib/updater";
import { animateDialogEntrance } from "@/lib/motion";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import DeveloperConsole from "@/components/DeveloperConsole";

type BridgeState = { enabled: boolean; port: number; paired: boolean; pairingCode: string | null; pairingExpiresAt: number | null };
type BridgeClient = { id: string; label: string; createdAt: number; lastUsed: number | null };
type Section = "Downloads" | "Files" | "Network" | "Seeding" | "Notifications" | "Browser integration" | "Behavior" | "Appearance" | "Keyboard shortcuts" | "App" | "Advanced";

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <SelectField label={label} value={value} onChange={onChange} options={options} />;
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
        } else if (bridge.pairingExpiresAt && Date.now() / 1000 >= bridge.pairingExpiresAt) {
          clientIds.current = undefined; await invoke("bridge_cancel_pairing");
          setBridge((current) => current ? { ...current, pairingCode: null, pairingExpiresAt: null } : current);
        }
      }).catch(() => setError("Could not check paired browsers."));
    }, 3000);
    return () => window.clearInterval(id);
  }, [bridge?.pairingCode, bridge?.pairingExpiresAt]);
  const startPairing = async () => { try { clientIds.current = new Set(clients.map(({ id }) => id)); setBridge(await invoke<BridgeState>("bridge_start_pairing")); setError(""); } catch { setError("Could not start pairing."); } };
  const cancelPairing = async () => { try { await invoke("bridge_cancel_pairing"); clientIds.current = undefined; setBridge((current) => current ? { ...current, pairingCode: null, pairingExpiresAt: null } : current); } catch { setError("Could not cancel pairing."); } };
  const remaining = Math.max(0, Math.ceil((bridge?.pairingExpiresAt ?? 0) - now / 1000));
  return <SettingsSection title="Browser integration" saved={saved}>
    <SettingRow label="Allow browser extensions" description={<span className="pref-listening">{enabled && bridge ? <><i />Listening on 127.0.0.1:{bridge.port}</> : "Off"}</span>} control={<Toggle label="Allow browser extensions" checked={enabled} onChange={(value) => save({ bridgeEnabled: value })} />} />
    <SettingRow label="Paired browsers" control={<Button variant="accent" onClick={() => void startPairing()} disabled={!enabled || !!bridge?.pairingCode}>Pair a browser</Button>} />
    {bridge?.pairingCode && <div className="pref-pairing-row"><code>{bridge.pairingCode}</code><span>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span><Button variant="ghost" onClick={() => void cancelPairing()}>Cancel</Button></div>}
    {clients.map((client) => <SettingRow key={client.id} label={client.label} description={client.lastUsed ? `Last used ${new Date(client.lastUsed * 1000).toLocaleString()}` : "Never used"} control={<Button variant="danger-ghost" onClick={() => void invoke("bridge_revoke_client", { id: client.id }).then(refresh).catch(() => setError("Could not revoke browser."))}>Revoke</Button>} />)}
    {!clients.length && <SettingRow label="No paired browsers" />}
    <SettingRow label="Last hand-off" control={<span className="pref-metric">{timings.length ? `${timings[timings.length - 1]} ms` : "—"}</span>} />
    {error && <div className="pref-panel-error" role="alert">{error}</div>}
  </SettingsSection>;
}

export default function Settings() {
  const settings = useStore((state) => state.settings);
  const ariaVersion = useStore((state) => state.ariaVersion);
  const update = useStore((state) => state.updateSettings);
  const updateAutostart = useStore((state) => state.updateAutostart);
  const notifications = useStore((state) => state.notify);
  const setNotifications = useStore((state) => state.setNotify);
  const [savedSection, setSavedSection] = useState<Section>();
  const [proxy, setProxy] = useState({ proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, proxyUser: settings.proxyUser, proxyPassword: settings.proxyPassword, noProxy: settings.noProxy });
  const [proxyError, setProxyError] = useState("");
  const [resetAll, setResetAll] = useState(false);
  const [developerConsole, setDeveloperConsole] = useState(false);
  const closeDeveloperConsole = useCallback(() => setDeveloperConsole(false), []);
  const aboutClicks = useRef({ count: 0, last: 0 });
  const resetBackdropRef = useRef<HTMLDivElement>(null);
  const resetDialogRef = useRef<HTMLElement>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [appVersion, setAppVersion] = useState(appPackage.version);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number>();
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  useLayoutEffect(() => {
    if (!resetAll) return;
    return animateDialogEntrance(
      resetBackdropRef.current,
      resetDialogRef.current,
      settings.reduceMotion
    );
  }, [resetAll, settings.reduceMotion]);
  const updateSupported = inTauri && process.env.NODE_ENV === "production";
  const clickAbout = () => {
    const now = Date.now();
    const clicks = aboutClicks.current;
    clicks.count = now - clicks.last > 1800 ? 1 : clicks.count + 1;
    clicks.last = now;
    if (clicks.count >= 5) { clicks.count = 0; setDeveloperConsole(true); }
  };
  const save = async (section: Section, patch: Partial<SettingsType>) => {
    await update(patch);
    const key = Object.keys(patch)[0];
    const issue = useStore.getState().settingsError;
    if (issue) { setRowErrors((errors) => ({ ...errors, [key]: issue })); return; }
    setRowErrors((errors) => { const next = { ...errors }; delete next[key]; return next; });
    setSavedSection(section); window.setTimeout(() => setSavedSection((value) => value === section ? undefined : value), 1500);
  };
  useEffect(() => setProxy({ proxyMode: settings.proxyMode, proxyUrl: settings.proxyUrl, proxyUser: settings.proxyUser, proxyPassword: settings.proxyPassword, noProxy: settings.noProxy }), [settings.proxyMode, settings.proxyUrl, settings.proxyUser, settings.proxyPassword, settings.noProxy]);
  useEffect(() => { if (inTauri) void getVersion().then(setAppVersion).catch(() => {}); }, [inTauri]);
  useEffect(() => {
    const theme = settings.theme;
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme; };
    apply(); const query = matchMedia("(prefers-color-scheme: dark)"); query.addEventListener("change", apply); return () => query.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const root = document.querySelector<HTMLElement>(".settings-view");
    if (!root) return;
    const frame = requestAnimationFrame(() => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>(".pref-row")).flatMap((row) => {
        const control = row.querySelector<HTMLElement>(":scope > .pref-control");
        return control ? [{ row, control, child: control.firstElementChild as HTMLElement | null }] : [];
      });
      if (!rows.length) return;
      const reference = rows[0].control.getBoundingClientRect();
      const referenceChild = rows[0].child?.getBoundingClientRect();
      rows.forEach(({ row, control, child }) => {
        const rect = control.getBoundingClientRect();
        const childRect = child?.getBoundingClientRect();
        if (Math.abs(rect.width - reference.width) > 0.5 || Math.abs(rect.right - reference.right) > 0.5 || (childRect && referenceChild && (Math.abs(childRect.width - referenceChild.width) > 0.5 || Math.abs(childRect.right - referenceChild.right) > 0.5))) {
          const label = row.querySelector<HTMLElement>(":scope > .pref-label")?.innerText.trim().replace(/\s+/g, " ") || "Unnamed row";
          console.warn(`[Settings layout] ${label}: control column or child is misaligned.`);
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const chooseFolder = async () => { const selected = await open({ directory: true, multiple: false, title: "Choose download folder" }); if (typeof selected === "string") save("Downloads", { downloadDir: selected }); };
  const proxyPatch = (patch: Partial<typeof proxy>) => {
    const next = { ...proxy, ...patch }; setProxy(next);
    const invalid = next.proxyMode === "manual" ? validateProxy(next.proxyUrl) : undefined;
    setProxyError(invalid ?? ""); if (!invalid) save("Network", next);
  };
  const reset = (section: Section, keys: (keyof SettingsType)[]) => save(section, Object.fromEntries(keys.map((key) => [key, key === "reduceMotion" ? matchMedia("(prefers-reduced-motion: reduce)").matches : DEFAULT_SETTINGS[key]])) as Partial<SettingsType>);
  const resetApp = async () => { await updateAutostart(false); const issue = useStore.getState().settingsError; if (issue) { setRowErrors((errors) => ({ ...errors, startWithWindows: issue })); return; } await reset("App", ["startWithWindows", "startMinimized", "closeToTray"]); };
  const setAutostartPreference = async (enabled: boolean) => {
    await updateAutostart(enabled);
    const issue = useStore.getState().settingsError;
    if (issue) { setRowErrors((errors) => ({ ...errors, startWithWindows: issue })); return; }
    await save("App", { startWithWindows: enabled });
  };
  const num = (section: Section, label: string, key: "maxDownloadMB" | "maxUploadMB" | "maxConcurrent" | "connectionsPerServer" | "seedRatio" | "seedTimeHours" | "connectTimeoutSeconds", placeholder: string, unit?: string, disabled = false) => { const field = numberFieldState(settings[key], placeholder); const max = ({ maxConcurrent: 20, connectionsPerServer: 16, seedRatio: 1000, seedTimeHours: 8760, connectTimeoutSeconds: 60 } as Partial<Record<typeof key, number>>)[key]; return <SettingRow label={label} error={rowErrors[key]} control={<NumberField aria-label={label} min={key === "connectTimeoutSeconds" ? "1" : "0"} max={max} step={key === "seedRatio" || key === "seedTimeHours" || key === "maxDownloadMB" || key === "maxUploadMB" ? "0.1" : "1"} value={field.value} placeholder={field.placeholder} unit={unit} disabled={disabled} onChange={(raw) => void save(section, { [key]: raw === "" && key === "seedTimeHours" ? "" : Math.max(0, Number(raw)) } as Partial<SettingsType>)} />} />; };
  const sectionSaved = (section: Section) => savedSection === section;
  const checkForUpdates = async () => {
    if (!updateSupported) { setUpdateStatus("Update checks are available in installed builds."); return; }
    setUpdateBusy(true); setUpdateStatus("Checking for updates…"); setAvailableUpdate(null); setUpdateProgress(undefined);
    try {
      const found = await check();
      setAvailableUpdate(found);
      setUpdateStatus(found ? `Version ${found.version} is available.` : "Helios is up to date.");
      if (!found) setTimeout(() => setUpdateStatus(""), 5000);
    } catch { setUpdateStatus("Could not check for updates. Try again later."); }
    finally { setUpdateBusy(false); }
  };
  const installAvailableUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateBusy(true); setUpdateStatus("Downloading update…");
    try {
      await installUpdate(availableUpdate, (event: DownloadEvent) => {
        if (event.event === "Started" && event.data.contentLength) setUpdateProgress(0);
        if (event.event === "Progress") setUpdateProgress((current) => (current ?? 0) + event.data.chunkLength);
        if (event.event === "Finished") setUpdateStatus("Installing update…");
      });
    } catch { setUpdateStatus("Update failed to install. Helios is still running; try again later."); setUpdateBusy(false); }
  };
  const defaultDownloads = { maxDownloadMB: DEFAULT_SETTINGS.maxDownloadMB, maxUploadMB: DEFAULT_SETTINGS.maxUploadMB, maxConcurrent: DEFAULT_SETTINGS.maxConcurrent, connectionsPerServer: DEFAULT_SETTINGS.connectionsPerServer, downloadDir: DEFAULT_SETTINGS.downloadDir };
  const copyDiagnostics = async () => {
    try {
      const currentAppVersion = inTauri ? await getVersion() : appVersion;
      setAppVersion(currentAppVersion);
      const [ariaVersion, bridge, timings, osVersion] = inTauri ? await Promise.all([
        getAria2Version(), invoke<BridgeState>("bridge_get_state").catch(() => undefined), invoke<number[]>("bridge_get_timings").catch(() => [] as number[]), invoke<string>("get_os_version").catch(() => navigator.userAgent),
      ]) : ["unavailable", undefined, [] as number[], navigator.userAgent];
      const { proxyUrl: _proxyUrl, proxyUser: _proxyUser, proxyPassword: _proxyPassword, ...safeSettings } = settings;
      const report = redactDiagnostics(JSON.stringify({ helios: currentAppVersion, aria2: ariaVersion, os: osVersion, bridgePort: bridge?.port ?? null, handoffTimingsMs: timings, settings: safeSettings, recentErrors: getRecentDiagnosticErrors() }, null, 2));
      await navigator.clipboard.writeText(report);
      setSavedSection("Advanced"); window.setTimeout(() => setSavedSection((value) => value === "Advanced" ? undefined : value), 1500);
    } catch { setRowErrors((current) => ({ ...current, diagnostics: "Could not copy diagnostics." })); }
  };
  useEffect(() => { if (inTauri) void getVersion().then(setAppVersion).catch(() => {}); }, [inTauri]);

  return <section className="settings-view">
    <header className="pref-page-head"><div><div className="lbl">Settings</div><h1>Preferences</h1></div><Button variant="secondary" onClick={() => useStore.getState().setView("tasks")}>Back</Button></header>
    <SettingsSection title="Downloads" saved={sectionSaved("Downloads")} reset={() => reset("Downloads", Object.keys(defaultDownloads) as (keyof SettingsType)[])}>
      {num("Downloads", "Download speed limit", "maxDownloadMB", "Unlimited", "MB/s")}{num("Downloads", "Upload speed limit", "maxUploadMB", "Unlimited", "MB/s")}{num("Downloads", "Simultaneous downloads", "maxConcurrent", "5")}{num("Downloads", "Connections per server", "connectionsPerServer", "16")}
      {inTauri && <SettingRow label="Download folder" error={rowErrors.downloadDir} control={<div className="pref-folder"><span title={settings.downloadDir || "Default Downloads folder"}>{settings.downloadDir || "Default"}</span>{settings.downloadDir && <Button variant="ghost" onClick={() => void save("Downloads", { downloadDir: "" })}>Default</Button>}<Button variant="accent" onClick={() => void chooseFolder()}>Choose</Button></div>} />}
    </SettingsSection>
    <SettingsSection title="Files" saved={sectionSaved("Files")} reset={() => reset("Files", ["fileConflict"])}>
      <SettingRow label="If a file exists" error={rowErrors.fileConflict} description={settings.fileConflict === "overwrite" ? <span className="pref-error">Replaces the old file</span> : undefined} control={<Choice label="If a file exists" value={settings.fileConflict} onChange={(value) => void save("Files", { fileConflict: value as SettingsType["fileConflict"] })} options={[["rename", "Rename"], ["overwrite", "Overwrite"], ["error", "Show error"]]} />} />
    </SettingsSection>
    <SettingsSection title="Network" saved={sectionSaved("Network")} reset={() => { setProxy({ proxyMode: DEFAULT_SETTINGS.proxyMode, proxyUrl: "", proxyUser: "", proxyPassword: "", noProxy: "" }); setProxyError(""); reset("Network", ["proxyMode", "proxyUrl", "proxyUser", "proxyPassword", "noProxy"]); }}>
      <SettingRow label="Proxy" error={rowErrors.proxyMode} control={<Choice label="Proxy" value={proxy.proxyMode} onChange={(value) => proxyPatch({ proxyMode: value as typeof proxy.proxyMode })} options={[["none", "None"], ["manual", "Manual"]]} />} />
      {proxy.proxyMode === "manual" && <div className="pref-subrows">
        <SettingRow label="Address" error={proxyError || rowErrors.proxyUrl} control={<TextField aria-label="Proxy address" value={proxy.proxyUrl} placeholder="host:3128" onChange={(event) => proxyPatch({ proxyUrl: event.target.value })} />} />
        <SettingRow label="Username" error={rowErrors.proxyUser} control={<TextField aria-label="Proxy username" value={proxy.proxyUser} onChange={(event) => proxyPatch({ proxyUser: event.target.value })} />} />
        <SettingRow label="Password" error={rowErrors.proxyPassword} control={<TextField aria-label="Proxy password" type="password" value={proxy.proxyPassword} onChange={(event) => proxyPatch({ proxyPassword: event.target.value })} />} />
        <SettingRow label="Bypass list" error={rowErrors.noProxy} control={<TextField aria-label="Bypass list" value={proxy.noProxy} onChange={(event) => proxyPatch({ noProxy: event.target.value })} />} />
      </div>}
    </SettingsSection>
    <SettingsSection title="Seeding" saved={sectionSaved("Seeding")} reset={() => reset("Seeding", ["seedRatio", "seedTimeHours", "neverSeed"])}>
      {num("Seeding", "Stop at ratio", "seedRatio", "No limit", undefined, settings.neverSeed)}{num("Seeding", "Stop after", "seedTimeHours", "No limit", "hours", settings.neverSeed)}
      <SettingRow label="Never seed" error={rowErrors.neverSeed} control={<Toggle label="Never seed" checked={settings.neverSeed} onChange={(value) => void save("Seeding", { neverSeed: value })} />} />
      {settings.seedRatio === 0 && settings.seedTimeHours === "" && !settings.neverSeed && <div className="pref-row"><div className="pref-label"><small className="pref-error">Seeds forever</small></div></div>}
    </SettingsSection>
    <SettingsSection title="Notifications" saved={sectionSaved("Notifications")} reset={() => reset("Notifications", ["notifyFinished", "notifyFailed", "notifyBrowserAdds"])}>
      {([["notifyFinished", "Download finished"], ["notifyFailed", "Download failed"], ["notifyBrowserAdds", "Browser adds a download"]] as const).map(([key, label]) => <SettingRow key={key} label={label} disabled={!notifications} control={<Toggle label={label} checked={settings[key]} disabled={!notifications} onChange={(value) => save("Notifications", { [key]: value })} />} />)}
    </SettingsSection>
    {inTauri && <BrowserIntegration enabled={settings.bridgeEnabled} save={(patch) => save("Browser integration", patch)} saved={sectionSaved("Browser integration")} />}
    <SettingsSection title="Behavior" saved={sectionSaved("Behavior")} reset={() => reset("Behavior", ["confirmBeforeRemoving", "deleteFilesWhenRemoving", "chooseFilesBeforeStarting"])}>
      <SettingRow label="Confirm before removing" error={rowErrors.confirmBeforeRemoving} control={<Toggle label="Confirm before removing" checked={settings.confirmBeforeRemoving} onChange={(value) => void save("Behavior", { confirmBeforeRemoving: value })} />} />
      <SettingRow label="Delete files when removing" error={rowErrors.deleteFilesWhenRemoving} control={<Toggle label="Delete files when removing" checked={settings.deleteFilesWhenRemoving} onChange={(value) => void save("Behavior", { deleteFilesWhenRemoving: value })} />} />
      <SettingRow label="Choose torrent files before starting" error={rowErrors.chooseFilesBeforeStarting} control={<Toggle label="Choose torrent files before starting" checked={settings.chooseFilesBeforeStarting} onChange={(value) => void save("Behavior", { chooseFilesBeforeStarting: value })} />} />
    </SettingsSection>
    <SettingsSection title="Appearance" saved={sectionSaved("Appearance")} reset={() => reset("Appearance", ["theme", "compactList", "reduceMotion"])}>
      <SettingRow label="Theme" error={rowErrors.theme} control={<Choice label="Theme" value={settings.theme} onChange={(value) => void save("Appearance", { theme: value as SettingsType["theme"] })} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} />} />
      <SettingRow label="Compact list" error={rowErrors.compactList} control={<Toggle label="Compact list" checked={settings.compactList} onChange={(value) => void save("Appearance", { compactList: value })} />} />
      <SettingRow label="Reduce motion" error={rowErrors.reduceMotion} control={<Toggle label="Reduce motion" checked={settings.reduceMotion} onChange={(value) => void save("Appearance", { reduceMotion: value })} />} />
    </SettingsSection>
    <SettingsSection title="Keyboard shortcuts" saved={sectionSaved("Keyboard shortcuts")} reset={() => reset("Keyboard shortcuts", ["keyBindings"])}>
      <KeyboardShortcuts bindings={settings.keyBindings} onChange={(keyBindings) => save("Keyboard shortcuts", { keyBindings })} error={rowErrors.keyBindings} />
    </SettingsSection>
    {inTauri && <SettingsSection title="App" saved={sectionSaved("App")} reset={() => void resetApp()}>
      <SettingRow label="Start with Windows" error={rowErrors.startWithWindows} control={<Toggle label="Start with Windows" checked={settings.startWithWindows} onChange={(value) => void setAutostartPreference(value)} />} />
      {settings.startWithWindows && <div className="pref-subrows"><SettingRow label="Start minimized to tray" control={<Toggle label="Start minimized to tray" checked={settings.startMinimized} onChange={(value) => save("App", { startMinimized: value })} />} /></div>}
      <SettingRow label="Close button hides to tray" error={rowErrors.closeToTray} control={<Toggle label="Close button hides to tray" checked={settings.closeToTray} onChange={(value) => void save("App", { closeToTray: value })} />} />
    </SettingsSection>}
    <SettingsSection title="Advanced" saved={sectionSaved("Advanced")} collapsible defaultCollapsed reset={() => reset("Advanced", ["diskAllocation", "connectTimeoutSeconds", "customUserAgent"])}>
      <SettingRow label="Disk allocation" error={rowErrors.diskAllocation} control={<Choice label="Disk allocation" value={settings.diskAllocation} onChange={(value) => void save("Advanced", { diskAllocation: value as SettingsType["diskAllocation"] })} options={[["none", "Off"], ["prealloc", "Reserve space"], ["falloc", "Fast reserve"]]} />} />
      {num("Advanced", "Connection timeout", "connectTimeoutSeconds", "10", "s")}
      <SettingRow label="Custom user agent" error={rowErrors.customUserAgent} control={<TextField aria-label="Custom user agent" value={settings.customUserAgent} placeholder="Default" onChange={(event) => void save("Advanced", { customUserAgent: event.target.value })} />} />
      <SettingRow label="Open data folder" error={rowErrors.openDataFolder} control={<Button variant="secondary" className="pref-action-button" onClick={() => void invoke("open_data_folder").catch(() => setRowErrors((current) => ({ ...current, openDataFolder: "Could not open the data folder." })))}>Open</Button>} />
      <SettingRow label="Copy diagnostics" error={rowErrors.diagnostics} control={<Button variant="secondary" className="pref-action-button" onClick={() => void copyDiagnostics()}>Copy</Button>} />
      <SettingRow label="Reset all settings" control={<Button variant="danger-outline" className="pref-action-button" onClick={() => setResetAll(true)}>Reset</Button>} />
    </SettingsSection>
    <SettingsSection title="About">
      <SettingRow label="Helios" onLabelClick={inTauri ? clickAbout : undefined} description={`Version ${appVersion}`} control={<Button variant="ghost" disabled={!inTauri} onClick={() => void invoke("open_licenses").catch(() => setRowErrors((current) => ({ ...current, licenses: "Could not open license notices." })))}>Licenses</Button>} />
      <SettingRow label="aria2-next" description={`Version ${ariaVersion || "—"}`} />
      <SettingRow label="Check for updates" description={updateStatus || (updateSupported ? "Helios checks for updates automatically when it starts." : "Available in installed builds.")} error={rowErrors.updates} control={availableUpdate ? <Button variant="accent" disabled={updateBusy} onClick={() => void installAvailableUpdate()}>{updateBusy ? "Installing…" : `Install ${availableUpdate.version}`}</Button> : <Button variant="secondary" disabled={!updateSupported || updateBusy} onClick={() => void checkForUpdates()}>{updateBusy ? "Checking…" : "Check now"}</Button>} />
      {updateProgress !== undefined && <div className="pref-row"><div className="pref-label"><small>{updateProgress.toLocaleString()} bytes downloaded</small></div></div>}
      {rowErrors.licenses && <div className="pref-panel-error" role="alert">{rowErrors.licenses}</div>}
    </SettingsSection>
    {resetAll && <div ref={resetBackdropRef} className="pref-confirm"><section ref={resetDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="reset-all-title"><p id="reset-all-title">Reset all preferences?</p><div><Button variant="secondary" onClick={() => setResetAll(false)}>Cancel</Button><Button variant="danger-ghost" onClick={() => { setResetAll(false); setNotifications(false); void (async () => { if (inTauri) await updateAutostart(false); await update({ ...DEFAULT_SETTINGS, reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }); })(); }}>Reset all settings</Button></div></section></div>}
    {developerConsole && <DeveloperConsole onClose={closeDeveloperConsole} />}
    <span className="sr-only" aria-live="polite">{savedSection ? `${savedSection} saved` : ""}</span>
  </section>;
}
