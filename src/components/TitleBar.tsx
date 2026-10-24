'use client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Ic } from './Icon'

// Window controls only work inside Tauri; in a plain browser they do nothing.
const win = () => ('__TAURI_INTERNALS__' in window ? getCurrentWindow() : null)

export default function TitleBar() {
  return (
    <div className="bar" data-tauri-drag-region>
      <div className="l" data-tauri-drag-region>
        <svg className="i" viewBox="0 0 24 24" style={{ color: 'var(--cy)' }}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v6M8 18h8" /></svg>
        <b>HELIOS</b>
      </div>
      <div className="r">
        <button aria-label="Minimize" onClick={() => win()?.minimize()}><Ic n="min" /></button>
        <button aria-label="Maximize" onClick={() => win()?.toggleMaximize()}><Ic n="max" /></button>
        <button aria-label="Close" onClick={() => win()?.close()}><Ic n="x" /></button>
      </div>
    </div>
  )
}
