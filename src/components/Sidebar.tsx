'use client'
import { useEffect, useState } from 'react'
import { useStore, Filter } from '@/lib/store'
import { Ic } from './Icon'

const NAV: [Filter, string, string][] = [['all', 'home', 'Overview'], ['dl', 'down', 'Downloading'], ['seed', 'up', 'Seeding'], ['done', 'folder', 'Completed']]

export default function Sidebar() {
  const filter = useStore(s => s.filter)
  const notify = useStore(s => s.notify)
  const counts = useStore(s => `${s.tasks.filter(t => t.state !== 'done').length},${s.tasks.filter(t => t.state === 'dl').length},${s.tasks.filter(t => t.state === 'seed').length},${s.tasks.filter(t => t.state === 'done').length}`).split(',')
  const [dark, setDark] = useState(true)
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])

  return (
    <aside className="side">
      <div className="lbl">Overview</div>
      <nav className="nav">
        {NAV.map(([f, icon, label], i) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => useStore.getState().setFilter(f)}>
            <Ic n={icon} />{label}<span className="n">{counts[i]}</span>
          </button>
        ))}
      </nav>
      <div className="lbl">Explorer</div>
      <div className="ex">
        {[['doc', 'Documents'], ['music', 'Music'], ['video', 'Videos']].map(([icon, label]) => (
          <button key={label}><Ic n="chev" className="ch" /><Ic n={icon} />{label}</button>
        ))}
        <button style={{ paddingLeft: 36 }}><Ic n="dots" />More</button>
      </div>
      <div className="lbl">Settings</div>
      <div className="set">
        <div className="it"><Ic n="sliders" />Settings</div>
        <div className="it"><Ic n="bell" />Notifications
          <button className="sw" aria-label="Notifications" aria-pressed={notify} onClick={() => useStore.getState().setNotify(!notify)} /></div>
        <div className="it"><Ic n="moon" />Dark theme
          <button className="sw" aria-label="Dark theme" aria-pressed={dark} onClick={() => setDark(!dark)} /></div>
      </div>
    </aside>
  )
}
