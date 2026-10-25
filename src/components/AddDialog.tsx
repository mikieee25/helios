"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "@/lib/store";
import { readValue, writeValue } from "@/lib/persistence";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const isTorrent = (path: string) => /\.torrent$/i.test(path);
const validUri = (value: string) =>
  /^(https?|ftp):\/\/|^magnet:\?/i.test(value);

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default function AddDialog({
  open: isOpen,
  initialLinks,
  initialPath,
  onClose,
  onDropOpen,
  onSelectFiles,
}: {
  open: boolean;
  initialLinks?: string;
  initialPath?: string;
  onClose(): void;
  onDropOpen(links?: string, path?: string): void;
  onSelectFiles(gid: string, metadata: boolean, cleanupGids?: string[]): void;
}) {
  const settings = useStore((s) => s.settings);
  const dialogRef = useRef<HTMLFormElement>(null);
  const [links, setLinks] = useState("");
  const [directory, setDirectory] = useState("");
  const [paused, setPaused] = useState(false);
  const [chooseFiles, setChooseFiles] = useState(false);
  const [torrent, setTorrent] = useState("");
  const [torrentName, setTorrentName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLinks(initialLinks ?? "");
    setDirectory(settings.downloadDir);
    setPaused(false);
    void readValue("chooseFilesBeforeStarting", false).then(setChooseFiles);
    setTorrent("");
    setTorrentName("");
    setErrors([]);
  }, [isOpen, initialLinks, settings.downloadDir]);

  const loadNativeTorrent = useCallback(async (path: string) => {
    if (!isTorrent(path)) return false;
    try {
      setTorrent(await invoke<string>("read_torrent_file", { path }));
      setTorrentName(path.split(/[\\/]/).pop() ?? path);
      setLinks("");
      setErrors([]);
      return true;
    } catch (error) {
      setTorrent("");
      setTorrentName("");
      setErrors([error instanceof Error ? error.message : String(error)]);
      return true;
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !initialPath) return;
    void loadNativeTorrent(initialPath);
  }, [isOpen, initialPath, loadNativeTorrent]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLElement>("[autofocus]")?.focus()
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea, input:not(:disabled)"
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths.find(isTorrent);
        if (path) {
          onDropOpen(undefined, path);
        } else {
          const links = event.payload.paths.filter(validUri);
          if (links.length) onDropOpen(links.join("\n"));
        }
      })
      .then((stop) => {
        if (cancelled) void stop();
        else unlisten = stop;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadNativeTorrent, onDropOpen]);

  useEffect(() => {
    if (isTauri()) return;
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
        isTorrent(f.name)
      );
      if (file) {
        onDropOpen();
        void file.arrayBuffer().then((buffer) => {
          setTorrent(toBase64(new Uint8Array(buffer)));
          setTorrentName(file.name);
          setLinks("");
        });
        return;
      }
      const text =
        event.dataTransfer?.getData("text/uri-list") ||
        event.dataTransfer?.getData("text/plain") ||
        "";
      const droppedLinks = text
        .split(/\r?\n/)
        .filter((line) => validUri(line.trim()))
        .map((line) => line.trim());
      if (droppedLinks.length) {
        onDropOpen(droppedLinks.join("\n"));
        setTorrent("");
        setTorrentName("");
        setLinks(droppedLinks.join("\n"));
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onDropOpen]);

  if (!isOpen) return null;

  async function chooseTorrent() {
    if (!isTauri()) return;
    const path = await open({
      multiple: false,
      title: "Choose a torrent file",
      filters: [{ name: "Torrent files", extensions: ["torrent"] }],
    });
    if (typeof path === "string") await loadNativeTorrent(path);
  }

  async function chooseDirectory() {
    if (!isTauri()) return;
    const path = await open({
      directory: true,
      multiple: false,
      title: "Choose destination folder",
    });
    if (typeof path === "string") setDirectory(path);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    const options = {
      ...(directory.trim() ? { dir: directory.trim() } : {}),
      ...(paused ? { pause: "true" } : {}),
    };
    try {
      if (torrent) {
        const gid = await useStore
          .getState()
          .addTorrent(
            torrent,
            chooseFiles ? { ...options, pause: "true" } : options
          );
        onClose();
        if (chooseFiles) onSelectFiles(gid, false, [gid]);
        return;
      }
      const allLines = links
        .split(/\r?\n/)
        .map((uri, index) => ({ uri: uri.trim(), line: index + 1 }))
        .filter(({ uri }) => uri);
      if (!allLines.length) {
        setErrors([
          "Enter one or more download links, or choose a .torrent file.",
        ]);
        return;
      }
      const valid = allLines.filter(({ uri }) => validUri(uri));
      const errorsByLine = allLines
        .filter(({ uri }) => !validUri(uri))
        .map(({ line, uri }) => `Line ${line}: unsupported link: ${uri}`);
      if (chooseFiles) {
        const magnets = valid.filter(({ uri }) => /^magnet:\?/i.test(uri));
        const ordinary = valid.filter(({ uri }) => !/^magnet:\?/i.test(uri));
        const results = await useStore.getState().addUris(
          ordinary.map(({ uri }) => uri),
          options
        );
        results.forEach((error, index) => {
          if (error)
            errorsByLine.push(`Line ${ordinary[index].line}: ${error}`);
        });
        for (const { uri, line } of magnets) {
          try {
            const gid = await useStore.getState().addUri(uri, {
              ...(directory.trim() ? { dir: directory.trim() } : {}),
              "pause-metadata": "true",
            });
            onSelectFiles(gid, true, [gid]);
          } catch (error) {
            errorsByLine.push(
              `Line ${line}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        const results = await useStore.getState().addUris(
          valid.map(({ uri }) => uri),
          options
        );
        results.forEach((error, index) => {
          if (error) errorsByLine.push(`Line ${valid[index].line}: ${error}`);
        });
      }
      if (errorsByLine.length) setErrors(errorsByLine);
      else onClose();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        ref={dialogRef}
        className="add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        onSubmit={submit}
      >
        <div className="modal-heading">
          <div>
            <span className="lbl">New transfer</span>
            <h2 id="add-title">Add download</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <label className="modal-field">
          Links
          <textarea
            autoFocus
            value={links}
            onChange={(event) => {
              setLinks(event.target.value);
              setTorrent("");
              setTorrentName("");
            }}
            placeholder={"Paste one link per line\nHTTP, HTTPS, FTP, or magnet"}
            rows={5}
          />
        </label>
        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void chooseTorrent()}
          >
            Choose .torrent file
          </button>
          {torrentName && (
            <span className="modal-file" title={torrentName}>
              {torrentName}
            </span>
          )}
        </div>
        <label className="modal-field">
          Destination folder
          <span className="modal-folder">
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="Default download folder"
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => void chooseDirectory()}
            >
              Browse
            </button>
          </span>
        </label>
        <label className="modal-checkbox">
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
          />{" "}
          Start paused
        </label>
        <label className="modal-checkbox">
          <input
            type="checkbox"
            checked={chooseFiles}
            onChange={(event) => {
              setChooseFiles(event.target.checked);
              void writeValue(
                "chooseFilesBeforeStarting",
                event.target.checked
              );
            }}
          />{" "}
          Choose files before starting
        </label>
        {errors.length > 0 && (
          <div className="modal-errors" role="alert">
            {errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Adding…" : "Add download"}
          </button>
        </div>
      </form>
    </div>
  );
}
