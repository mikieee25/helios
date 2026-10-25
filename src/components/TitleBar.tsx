"use client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "@/lib/store";
import { Ic } from "./Icon";

// Window controls only work inside Tauri; in a plain browser they do nothing.
const win = () => ("__TAURI_INTERNALS__" in window ? getCurrentWindow() : null);

export default function TitleBar({ onAdd }: { onAdd(): void }) {
  const online = useStore((s) => s.online);
  return (
    <div className="bar" data-tauri-drag-region>
      <div className="l" data-tauri-drag-region>
        <svg
          className="i brand-mark"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          style={{ color: "var(--cy)" }}
        >
          <path d="M12 7v5m0 0-4.6 4.6M12 12l4.6 4.6" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <circle cx="12" cy="5" r="2" />
          <circle className="brand-hub" cx="12" cy="12" r="1.4" />
        </svg>
        <b>HELIOS</b>
      </div>
      <div className="r">
        <div className="transfer-controls">
          <button
            type="button"
            className="add-download"
            aria-label="Add download"
            title="Add download"
            onClick={onAdd}
          >
            <Ic n="plus" />
          </button>
          <button
            type="button"
            className="transfer-action"
            aria-label="Pause all downloads"
            title="Pause all downloads"
            disabled={!online}
            onClick={() => void useStore.getState().pauseAll()}
          >
            <Ic n="pause" />
          </button>
          <button
            type="button"
            className="transfer-action"
            aria-label="Resume all downloads"
            title="Resume all downloads"
            disabled={!online}
            onClick={() => void useStore.getState().resumeAll()}
          >
            <Ic n="play" />
          </button>
        </div>
        <button aria-label="Minimize" onClick={() => win()?.minimize()}>
          <Ic n="min" />
        </button>
        <button aria-label="Maximize" onClick={() => win()?.toggleMaximize()}>
          <Ic n="max" />
        </button>
        <button aria-label="Close" onClick={() => win()?.close()}>
          <Ic n="x" />
        </button>
      </div>
    </div>
  );
}
