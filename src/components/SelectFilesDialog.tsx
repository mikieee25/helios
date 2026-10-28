"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "@/lib/store";
import {
  formatFileIndexes,
  selectionTotals,
  type TorrentFile,
} from "@/lib/torrent-files";
import { sz } from "@/lib/format";
import { animateDialogEntrance } from "@/lib/motion";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function SelectFilesDialog({
  gid: initialGid,
  cleanupGids = [],
  removeOnCancel = false,
  wasActive = false,
  onClose,
}: {
  gid: string;
  cleanupGids?: string[];
  removeOnCancel?: boolean;
  wasActive?: boolean;
  onClose(): void;
}) {
  const [gid, setGid] = useState(initialGid);
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);

  useLayoutEffect(
    () =>
      animateDialogEntrance(
        backdropRef.current,
        dialogRef.current,
        reduceMotion
      ),
    [reduceMotion]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      while (!cancelled) {
        try {
          let targetGid = gid;
          const followedBy = await useStore
            .getState()
            .torrentFollowedBy(gid)
            .catch(() => []);
          if (followedBy.length) {
            targetGid = followedBy[0];
            if (targetGid !== gid) setGid(targetGid);
          }
          const nextFiles = await useStore.getState().torrentFiles(targetGid);
          if (cancelled) return;
          if (nextFiles.length) {
            setFiles(nextFiles);
            setSelected(
              new Set(
                nextFiles
                  .filter((file) => file.selected)
                  .map((file) => file.index)
              )
            );
            setLoading(false);
            setError("");
            return;
          }
        } catch (cause) {
          if (cancelled) return;
          if (!removeOnCancel)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        if (!cancelled) await sleep(900);
      }
    };
    setLoading(true);
    void load();
    return () => {
      cancelled = true;
    };
  }, [gid, initialGid, removeOnCancel]);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? files.filter((file) => file.path.toLocaleLowerCase().includes(query))
      : files;
  }, [files, search]);
  const virtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 42,
    overscan: 8,
  });
  const totals = selectionTotals(
    files.map((file) => ({ ...file, selected: selected.has(file.index) }))
  );

  async function cancel() {
    setBusy(true);
    try {
      if (removeOnCancel)
        await useStore
          .getState()
          .cancelTorrentSelection([...cleanupGids, initialGid, gid]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  async function confirm() {
    const indexes = formatFileIndexes(
      files.filter((file) => selected.has(file.index))
    );
    if (!indexes) {
      setError("Select at least one file to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await useStore
        .getState()
        .selectTorrentFiles(gid, indexes, wasActive && gid === initialGid);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && void cancel()
      }
    >
      <section
        ref={dialogRef}
        className="add-dialog select-files-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="select-files-title"
      >
        <div className="modal-heading">
          <div>
            <span className="lbl">TORRENT CONTENT</span>
            <h2 id="select-files-title">Select files</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => void cancel()}
          >
            ×
          </button>
        </div>
        {loading ? (
          <div className="file-list-loading" role="status">
            <span className="engine-spinner" />
            Fetching file list...
          </div>
        ) : (
          <>
            <label className="file-search">
              Search files
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by file name"
              />
            </label>
            <div className="file-selection-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setSelected(new Set(files.map((file) => file.index)))
                }
              >
                Select all
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelected(new Set())}
              >
                Select none
              </button>
              <span>{sz(totals.size)} selected</span>
            </div>
            <div className="torrent-file-list" ref={scrollRef}>
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const file = visibleFiles[item.index];
                  return (
                    <label
                      key={file.index}
                      className="torrent-file-row"
                      style={{
                        transform: `translateY(${item.start}px)`,
                        height: item.size,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(file.index)}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(file.index);
                            else next.delete(file.index);
                            return next;
                          })
                        }
                      />
                      <span title={file.path}>{file.path}</span>
                      <small>{sz(file.length)}</small>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="modal-errors" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
          {!loading && (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !files.length}
              onClick={() => void confirm()}
            >
              {busy ? "Applying…" : "Download selected"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
