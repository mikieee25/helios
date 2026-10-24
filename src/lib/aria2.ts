type Pending = { res: (v: any) => void; rej: (e: Error) => void };

/** Minimal aria2 JSON-RPC client over WebSocket with auto-reconnect and push notifications. */
export class Aria2 {
  private ws?: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private url: string,
    private secret: string,
    private onEvent: (method: string, gid: string) => void,
    private onState: (online: boolean) => void
  ) {
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const ws = new WebSocket(this.url);
    this.ws = ws;
    const isCurrent = () => this.ws === ws;
    ws.onopen = () => {
      const timeout = setTimeout(() => ws.close(), 3000);
      this.call<{ version?: string }>("getVersion")
        .then((result) => {
          clearTimeout(timeout);
          if (!isCurrent()) return;
          if (!result.version) return ws.close();
          this.onState(true);
        })
        .catch(() => {
          clearTimeout(timeout);
          if (isCurrent()) ws.close();
        });
    };
    ws.onclose = () => {
      if (!isCurrent()) return;
      this.onState(false);
      this.pending.forEach((p) => p.rej(new Error("connection closed")));
      this.pending.clear();
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      if (m.method) {
        this.onEvent(
          String(m.method).replace("aria2.", ""),
          m.params?.[0]?.gid
        );
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    };
  }

  /** `method` is an aria2 method name (e.g. "tellActive") or "system.multicall". */
  call<T = any>(method: string, ...params: any[]): Promise<T> {
    return new Promise((res, rej) => {
      if (this.ws?.readyState !== WebSocket.OPEN)
        return rej(new Error("offline"));
      const id = ++this.id;
      const multi = method === "system.multicall";
      this.pending.set(id, { res, rej });
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: multi ? method : `aria2.${method}`,
          params: multi ? params : [`token:${this.secret}`, ...params],
        })
      );
    });
  }

  stopReconnect() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  reconnect() {
    this.stopped = false;
    clearTimeout(this.timer);
    const previous = this.ws;
    if (previous) {
      previous.onopen = null;
      previous.onclose = null;
      previous.onmessage = null;
      previous.close();
    }
    this.pending.forEach((request) => request.rej(new Error("reconnecting")));
    this.pending.clear();
    this.connect();
  }

  close() {
    this.stopReconnect();
    this.ws?.close();
  }
}
