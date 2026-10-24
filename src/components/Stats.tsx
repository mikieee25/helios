'use client'
import { useStore } from '@/lib/store'
import { mb, eta, dur } from '@/lib/format'
import { Ic } from './Icon'

export default function Stats() {
  const t = useStore(s => s.tasks.find(x => x.gid === s.sel) ?? s.tasks[0])
  const dl = useStore(s => s.dl)
  const up = useStore(s => s.up)
  const got = t ? t.size * t.done : 0
  const cells: [string, string][] = [
    ['Seeds', t ? String(t.seeds) : '—'],
    ['Down / up ratio', t && got ? (t.upTotal / got).toFixed(1) : '0.0'],
    ['Downloaded', `${t ? Math.round(got / 1048576) : 0} MB`],
    ['Uploaded', `${t ? Math.round(t.upTotal / 1048576) : 0} MB`],
    ['Time elapsed', t ? dur(Math.floor((Date.now() - t.since) / 1000)) : '—'],
    ['Time left', t?.state === 'dl' ? eta((t.size - got) / t.speed) : '—'],
  ]
  return (
    <div>
      <div className="lbl" style={{ marginTop: 0 }}>Download / upload per sec</div>
      <div className="big">
        <div><Ic n="down" />{mb(dl)}<small>MB</small></div>
        <div><Ic n="up" />{mb(up)}<small>MB</small></div>
      </div>
      <div className="stats">{cells.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
    </div>
  )
}
