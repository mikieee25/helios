"use client";
import { useStore } from "@/lib/store";
import { eta, dur } from "@/lib/format";
import { Ic } from "./Icon";
import AnimatedNumber from "./AnimatedNumber";

export default function Stats() {
  const t = useStore((s) => s.tasks.find((x) => x.gid === s.sel) ?? s.tasks[0]);
  const dl = useStore((s) => s.dl);
  const up = useStore((s) => s.up);
  const got = t ? t.size * t.done : 0;
  const cells: [string, React.ReactNode][] = [
    ["Seeds", t ? String(t.seeds) : "—"],
    ["Down / up ratio", t && got ? (t.upTotal / got).toFixed(1) : "0.0"],
    ["Downloaded", <><AnimatedNumber value={t ? got / 1048576 : 0} /> MB</>],
    ["Uploaded", <><AnimatedNumber value={t ? t.upTotal / 1048576 : 0} /> MB</>],
    ["Time elapsed", t ? dur(Math.floor((Date.now() - t.since) / 1000)) : "—"],
    ["Time left", t?.state === "dl" ? eta((t.size - got) / t.speed) : "—"],
  ];
  return (
    <div>
      <div className="lbl" style={{ marginTop: 0 }}>
        Download / upload per sec
      </div>
      <div className="big">
        <div>
          <Ic n="down" />
          <AnimatedNumber value={dl / 1048576} decimals={1} />
          <small>MB</small>
        </div>
        <div>
          <Ic n="up" />
          <AnimatedNumber value={up / 1048576} decimals={1} />
          <small>MB</small>
        </div>
      </div>
      <div className="stats">
        {cells.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
