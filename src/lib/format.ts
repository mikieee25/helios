export const sz = (b: number) => { const m = b / 1048576; return m >= 1000 ? `${+(m / 1024).toFixed(2)}GB` : `${Math.round(m)}MB` }
export const mb = (b: number) => (b / 1048576).toFixed(1)
export const eta = (s: number) => !isFinite(s) ? '—' : s < 60 ? `${Math.max(1, Math.round(s))} sec` : s < 3600 ? `${Math.round(s / 60)}min` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min`
export const dur = (s: number) => s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} sec`
