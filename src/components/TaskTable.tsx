'use client'
import { memo } from 'react'
import { useStore, Task, Filter, ARIA2_URL } from '@/lib/store'
import { sz, eta } from '@/lib/format'
import { Ic } from './Icon'

const show = (t: Task, f: Filter) => f === 'all' ? t.state !== 'done' : f === t.state
const ICON = { dl: 'down', seed: 'up', done: 'check', pa: 'pause', err: 'x' }

const Row = memo(function Row({ t, sel }: { t: Task; sel: boolean }) {
  const time = t.state === 'dl' ? eta((t.size * (1 - t.done)) / t.speed) : t.state === 'seed' ? 'Seeding' : t.state === 'done' ? 'Completed' : t.state === 'err' ? 'Error' : t.queued ? 'Queued' : 'Paused'
  return (
    <div className={`row ${t.state}${sel ? ' sel' : ''}`} onClick={() => useStore.getState().select(t.gid)}>
      <div className="nm">
        <button className="st" aria-label="Pause or resume" onClick={e => { e.stopPropagation(); useStore.getState().toggle(t) }}><Ic n={ICON[t.state]} /></button>
        <span title={t.name}>{t.name}</span>
      </div>
      <div><div className="trk"><i style={{ width: `${(t.done * 100).toFixed(1)}%` }} /></div></div>
      <div>{sz(t.size)}</div><div>{time}</div><div>{t.seeds}</div><div>{t.peers}</div>
    </div>
  )
})

export default function TaskTable() {
  const tasks = useStore(s => s.tasks)
  const filter = useStore(s => s.filter)
  const online = useStore(s => s.online)
  const sel = useStore(s => s.sel ?? s.tasks[0]?.gid)
  const rows = tasks.filter(t => show(t, filter))
  return (
    <div className="tbl"><div className="grid">
      <div className="row head"><span>NAME</span><span>PROGRESS</span><span>SIZE</span><span>TIME LEFT</span><span>SEEDS</span><span>PEERS</span></div>
      {rows.map(t => <Row key={t.gid} t={t} sel={t.gid === sel} />)}
      {!rows.length && <div className="empty">{online ? 'Nothing here yet. Paste a link anywhere to start a download.' : `Waiting for aria2 at ${ARIA2_URL}`}</div>}
    </div></div>
  )
}
