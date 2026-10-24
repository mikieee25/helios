import { create } from 'zustand'
import { Aria2 } from './aria2'

export type UiState = 'dl' | 'seed' | 'pa' | 'done' | 'err'
export type Filter = 'all' | 'dl' | 'seed' | 'done'
export type Task = {
  gid: string; name: string; size: number; done: number; speed: number
  upSpeed: number; upTotal: number; seeds: number; peers: number
  state: UiState; queued: boolean; since: number
}

export const N = 48
export const ARIA2_URL = process.env.NEXT_PUBLIC_ARIA2_URL ?? 'ws://127.0.0.1:6800/jsonrpc'
const SECRET = process.env.NEXT_PUBLIC_ARIA2_SECRET ?? 'helios-dev'
const KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'uploadLength', 'numSeeders', 'connections', 'seeder', 'bittorrent', 'files']

/** Time of the last poll. Read by the chart's animation loop, so it lives outside React state. */
export const clock = { t: 0 }

interface S {
  online: boolean; tasks: Task[]; filter: Filter; sel?: string; series: 'dl' | 'ul'; notify: boolean
  dl: number; up: number; dlHist: number[]; upHist: number[]
  start(): void; setFilter(f: Filter): void; select(g: string): void; setSeries(s: 'dl' | 'ul'): void
  setNotify(v: boolean): void; toggle(t: Task): void; add(uri: string): void
}

let api: Aria2 | undefined
let busy = false
const seen = new Map<string, number>()
const same = (a: Task, b: Task) => (Object.keys(a) as (keyof Task)[]).every(k => a[k] === b[k])

function toTask(r: any): Task {
  const size = +r.totalLength
  const st: string = r.status
  const state: UiState = st === 'complete' ? 'done' : st === 'error' ? 'err' : st === 'active' ? (r.seeder === 'true' ? 'seed' : 'dl') : 'pa'
  const name = r.bittorrent?.info?.name ?? r.files?.[0]?.path?.split(/[\\/]/).pop() ?? r.gid
  if (state === 'dl' && !seen.has(r.gid)) seen.set(r.gid, Date.now())
  return {
    gid: r.gid, name: name || r.gid, size, done: size ? +r.completedLength / size : 0,
    speed: +r.downloadSpeed, upSpeed: +r.uploadSpeed, upTotal: +r.uploadLength,
    seeds: +r.numSeeders || 0, peers: +r.connections || 0,
    state, queued: st === 'waiting', since: seen.get(r.gid) ?? Date.now(),
  }
}

export const useStore = create<S>((set, get) => {
  // One multicall per second: active + waiting + stopped tasks and global stats.
  async function refresh() {
    if (!api || busy) return
    busy = true
    try {
      const c = (m: string, ...p: any[]) => ({ methodName: `aria2.${m}`, params: [`token:${SECRET}`, ...p] })
      const r = await api.call('system.multicall', [c('tellActive', KEYS), c('tellWaiting', 0, 100, KEYS), c('tellStopped', 0, 100, KEYS), c('getGlobalStat')])
      const old = new Map(get().tasks.map(t => [t.gid, t]))
      // Reuse unchanged task objects so memoized rows skip re-rendering.
      const tasks = [...r[0][0], ...r[1][0], ...r[2][0]].map(toTask).map(t => { const o = old.get(t.gid); return o && same(o, t) ? o : t })
      const g = r[3][0]
      const { dlHist, upHist } = get()
      clock.t = performance.now()
      set({ tasks, dl: +g.downloadSpeed, up: +g.uploadSpeed, dlHist: [...dlHist.slice(1), +g.downloadSpeed / 1048576], upHist: [...upHist.slice(1), +g.uploadSpeed / 1048576] })
    } catch { /* offline or mid-reconnect */ } finally { busy = false }
  }

  return {
    online: false, tasks: [], filter: 'all', series: 'dl', notify: false, dl: 0, up: 0,
    dlHist: Array(N + 1).fill(0), upHist: Array(N + 1).fill(0),
    start() {
      if (api) return
      clock.t = performance.now()
      api = new Aria2(ARIA2_URL, SECRET, (m, gid) => {
        if (m === 'onDownloadComplete' && get().notify && typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification(get().tasks.find(t => t.gid === gid)?.name ?? 'Download complete')
        refresh()
      }, online => { set({ online }); if (online) refresh() })
      setInterval(refresh, 1000)
    },
    setFilter: filter => set({ filter }),
    select: sel => set({ sel }),
    setSeries: series => set({ series }),
    setNotify(notify) {
      set({ notify })
      if (notify && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
    },
    toggle(t) {
      const m = t.state === 'dl' || t.state === 'seed' || t.queued ? 'pause' : t.state === 'pa' ? 'unpause' : null
      if (m) api?.call(m, t.gid).then(refresh).catch(() => {})
    },
    add(uri) { api?.call('addUri', [uri]).then(refresh).catch(() => {}) },
  }
})
