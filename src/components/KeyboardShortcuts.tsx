"use client";

import { useEffect, useState } from "react";
import {
  getShortcutBinding,
  KEYBOARD_SHORTCUTS,
  shortcutFromEvent,
  shortcutLabel,
  type ShortcutBindings,
  type ShortcutId,
} from "@/lib/shortcuts";
import { Button, SettingRow } from "@/components/settings/ui";

export default function KeyboardShortcuts({
  bindings,
  onChange,
  error,
}: {
  bindings: ShortcutBindings;
  onChange: (bindings: ShortcutBindings) => Promise<void>;
  error?: string;
}) {
  const [recording, setRecording] = useState<ShortcutId>();
  const [captureError, setCaptureError] = useState("");

  useEffect(() => {
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const binding = shortcutFromEvent(event);
      if (!binding) {
        setCaptureError("That key cannot be used as a shortcut.");
        return;
      }
      const conflict = KEYBOARD_SHORTCUTS.find(
        (shortcut) =>
          shortcut.id !== recording &&
          getShortcutBinding(shortcut.id, bindings) === binding
      );
      if (conflict) {
        setCaptureError(`Already assigned to ${conflict.label}.`);
        return;
      }
      const next = { ...bindings, [recording]: binding };
      setCaptureError("");
      setRecording(undefined);
      void onChange(next);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [bindings, onChange, recording]);

  return <>
    {KEYBOARD_SHORTCUTS.map((shortcut) => {
      const binding = getShortcutBinding(shortcut.id, bindings);
      const isRecording = recording === shortcut.id;
      return <SettingRow
        key={shortcut.id}
        label={shortcut.label}
        description={isRecording ? "Press a key combination, or click to cancel." : undefined}
        error={isRecording ? captureError : undefined}
        control={<Button
          variant={isRecording ? "accent" : "secondary"}
          aria-label={`${isRecording ? "Stop recording" : "Rebind"} ${shortcut.label}; current shortcut ${shortcutLabel(binding)}`}
          aria-pressed={isRecording}
          onClick={() => {
            setCaptureError("");
            setRecording(isRecording ? undefined : shortcut.id);
          }}
        >{isRecording ? "Press a shortcut…" : shortcutLabel(binding)}</Button>}
      />;
    })}
    {error && <div className="pref-panel-error" role="alert">{error}</div>}
  </>;
}
