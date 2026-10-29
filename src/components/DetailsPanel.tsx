"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore, type Task, type TaskDetails } from "@/lib/store";
import { useView } from "@/lib/view-state";
import { motionOn } from "@/lib/motion";
import { dur, eta } from "@/lib/format";

const UNITS = ["B", "KB", "MB", "GB", "TB"];
export function fmtBytes(n: number): string {
  if (!isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${UNITS[i]}`;
}
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
const statusOf = (t: Task) =>
  t.state === "dl" ? "Downloading"
  : t.state === "seed" ? "Seeding"
  : t.state === "done" ? "Completed"
  : t.state === "err" ? "Failed"
  : t.queued ? "Queued" : "Paused";

export default function DetailsPanel() {
  const open = useView((s) => s.detailsOpen);
  const task = useStore((s) => s.tasks.find((t) => t.gid === (s.sel ?? s.tasks[0]?.gid)));
  const gid = task?.gid;
  const [mounted, setMounted] = useState(open);
  const [details, setDetails] = useState<TaskDetails>();
  const [copied, setCopied] = useState<string>();
  const [note, setNote] = useState("");
  const ref = useRef<HTMLElement>(null);
  const close = () => useView.getState().setDetailsOpen(false);

  // Slide in on open, slide out before unmounting. Reduced motion is instant.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const element = ref.current;
    if (!element || !motionOn()) {
      setMounted(false);
      return;
    }
    const tween = gsap.to(element, {
      x: 24,
      opacity: 0,
      duration: 0.18,
      ease: "power2.in",
      onComplete: () => setMounted(false),
    });
    return () => {
      tween.kill();
    };
  }, [open]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !mounted || !element || !motionOn()) return;
    gsap.fromTo(
      element,
      { x: 28, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.26, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" }
    );
  }, [open, mounted]);

  // Leaving the tasks view (Settings) closes the panel.
  useEffect(() => () => useView.getState().setDetailsOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (document.querySelector(".modal-backdrop")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // aria2-only extras (source URLs, torrent info). Live numbers come from the store.
  useEffect(() => {
    setDetails(undefined);
    setNote("");
    if (!open || !gid) return;
    let cancelled = false;
    useStore
      .getState()
      .taskDetails(gid)
      .then((value) => !cancelled && setDetails(value))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, gid]);

  if (!mounted) return null;

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? undefined : current)), 1400);
    } catch {
      setNote("Could not copy to the clipboard.");
    }
  };
  const got = task ? task.size * task.done : 0;
  const percent = task ? Math.min(100, task.done * 100) : 0;
  const showFiles = task && (task.torrent || task.files.length > 1);
  const files = task?.files.slice(0, 100) ?? [];
  const sourceUri = details?.uris[0];

  return (
    <aside ref={ref} className="details-panel" aria-label="Download details">
      <header className="dp-head">
        <div>
          <span className="lbl">Details</span>
          <h2 title={task?.name}>{task?.name ?? "No download selected"}</h2>
        </div>
        <button className="modal-close" aria-label="Close details" onClick={close}>
          ×
        </button>
      </header>
      {!task ? (
        <div className="dp-empty">Select a download to see its details.</div>
      ) : (
        <div className="dp-body">
          <div className={`dp-status ${task.state}`}>
            <span className="dp-pill">{statusOf(task)}</span>
            <span>
              {percent.toFixed(percent >= 100 ? 0 : 1)}% · {fmtBytes(got)} of {fmtBytes(task.size)}
            </span>
          </div>
          <div className={`dp-bar ${task.state}`} aria-hidden="true">
            <i style={{ width: `${percent}%` }} />
          </div>

          {task.state === "err" && (
            <div className="dp-error" role="alert">
              {task.errorMessage || "Download failed"}
              {task.errorCode && <small>Error {task.errorCode}</small>}
            </div>
          )}

          <dl className="dp-grid">
            <div><dt>Download speed</dt><dd>{fmtBytes(task.speed)}/s</dd></div>
            <div><dt>Time left</dt><dd>{task.state === "dl" ? eta((task.size - got) / task.speed) : "—"}</dd></div>
            <div><dt>Seeds</dt><dd>{task.seeds}</dd></div>
            <div><dt>Connections</dt><dd>{details?.connections ?? task.peers}</dd></div>
            <div><dt>Uploaded</dt><dd>{fmtBytes(task.upTotal)}</dd></div>
            <div><dt>Ratio</dt><dd>{got ? (task.upTotal / got).toFixed(2) : "0.00"}</dd></div>
            <div><dt>Elapsed</dt><dd>{dur(Math.max(0, Math.floor((Date.now() - task.since) / 1000)))}</dd></div>
            <div><dt>Category</dt><dd className="cap">{task.category}</dd></div>
          </dl>

          <section className="dp-sec">
            <h3>Location</h3>
            <code className="dp-code" title={task.dir}>{task.dir || "—"}</code>
            <div className="dp-actions">
              <button
                className="secondary-button"
                disabled={!task.files[0]?.path}
                onClick={() =>
                  void revealItemInDir(task.files[0].path).catch(() =>
                    setNote("Could not open the folder.")
                  )
                }
              >
                Show in folder
              </button>
              <button
                className="secondary-button"
                disabled={!task.dir}
                onClick={() => void copy("dir", task.dir)}
              >
                {copied === "dir" ? "Copied" : "Copy path"}
              </button>
            </div>
          </section>

          {sourceUri && (
            <section className="dp-sec">
              <h3>Source</h3>
              {details!.uris.slice(0, 3).map((uri) => (
                <code key={uri} className="dp-code" title={uri}>{uri}</code>
              ))}
              <div className="dp-actions">
                <button className="secondary-button" onClick={() => void copy("uri", sourceUri)}>
                  {copied === "uri" ? "Copied" : "Copy link"}
                </button>
              </div>
            </section>
          )}

          {details?.infoHash && (
            <section className="dp-sec">
              <h3>Torrent</h3>
              <code className="dp-code" title={details.infoHash}>{details.infoHash}</code>
              <dl className="dp-grid">
                {details.numPieces ? (
                  <div><dt>Pieces</dt><dd>{details.numPieces.toLocaleString()}</dd></div>
                ) : null}
                {details.pieceLength ? (
                  <div><dt>Piece size</dt><dd>{fmtBytes(details.pieceLength)}</dd></div>
                ) : null}
              </dl>
              {details.trackers.length > 0 && (
                <>
                  <h3 className="dp-sub">Trackers ({details.trackers.length})</h3>
                  {details.trackers.slice(0, 6).map((tracker) => (
                    <code key={tracker} className="dp-code" title={tracker}>{tracker}</code>
                  ))}
                </>
              )}
            </section>
          )}

          {showFiles && (
            <section className="dp-sec">
              <h3>Files ({task.files.length})</h3>
              <ul className="dp-files">
                {files.map((file) => (
                  <li key={file.index} className={file.selected ? "" : "skipped"}>
                    <span title={file.path}>{baseName(file.path)}</span>
                    <small>
                      {file.selected
                        ? `${fmtBytes(file.length)} · ${file.length ? Math.round((file.completedLength / file.length) * 100) : 0}%`
                        : "skipped"}
                    </small>
                  </li>
                ))}
              </ul>
              {task.files.length > files.length && (
                <small className="dp-more">and {task.files.length - files.length} more</small>
              )}
            </section>
          )}
          {note && <div className="dp-note" role="status">{note}</div>}
        </div>
      )}
    </aside>
  );
}
