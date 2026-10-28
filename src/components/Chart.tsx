"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { useStore, clock, N } from "@/lib/store";
import { prefersReducedMotion } from "@/lib/motion";

const W = 560,
  H = 286,
  HEAD = W - 6.25,
  step = W / (N - 1);

// Catmull-Rom to cubic Bezier; control x is clamped so a short head segment cannot kink.
function curve(p: number[][]) {
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i],
      b = p[i],
      c = p[i + 1],
      e = p[i + 2] ?? c;
    const x1 = Math.min(c[0], b[0] + (c[0] - a[0]) / 6),
      x2 = Math.max(b[0], c[0] - (e[0] - b[0]) / 6);
    d += ` C${x1.toFixed(1)},${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${x2.toFixed(1)},${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)}`;
  }
  return d;
}

export function SeriesToggle() {
  const series = useStore((s) => s.series);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const toggleRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const previousSeries = useRef<typeof series | null>(null);

  useLayoutEffect(() => {
    const toggle = toggleRef.current;
    const indicator = indicatorRef.current;
    const active = toggle?.querySelector("button.on");
    if (!toggle || !indicator || !active) return;

    const move = (animate: boolean) => {
      const toggleRect = toggle.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const position = {
        x: activeRect.left - toggleRect.left,
        y: activeRect.top - toggleRect.top,
        width: activeRect.width,
        height: activeRect.height,
        autoAlpha: 1,
      };
      if (
        previousSeries.current === null ||
        !animate ||
        prefersReducedMotion(reduceMotion)
      ) {
        gsap.set(indicator, position);
      } else {
        gsap.to(indicator, {
          ...position,
          duration: 0.24,
          ease: "power3.out",
          overwrite: true,
        });
      }
    };

    move(previousSeries.current !== null && previousSeries.current !== series);
    previousSeries.current = series;
    return () => {
      gsap.killTweensOf(indicator);
    };
  }, [series, reduceMotion]);

  useLayoutEffect(() => {
    const toggle = toggleRef.current;
    const indicator = indicatorRef.current;
    if (!toggle || !indicator) return;

    const syncPosition = () => {
      const active = toggle.querySelector("button.on");
      if (!active) return;
      const toggleRect = toggle.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      gsap.killTweensOf(indicator);
      gsap.set(indicator, {
        x: activeRect.left - toggleRect.left,
        y: activeRect.top - toggleRect.top,
        width: activeRect.width,
        height: activeRect.height,
        autoAlpha: 1,
      });
      previousSeries.current = useStore.getState().series;
    };
    const observer = new ResizeObserver(syncPosition);
    observer.observe(toggle);
    window.addEventListener("resize", syncPosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncPosition);
    };
  }, []);

  return (
    <div ref={toggleRef} className="seg">
      <span ref={indicatorRef} className="seg-active" aria-hidden="true" />
      <button
        className={series === "dl" ? "on" : ""}
        onClick={() => useStore.getState().setSeries("dl")}
      >
        <i style={{ background: "var(--cy)" }} />
        Download
      </button>
      <button
        className={series === "ul" ? "on" : ""}
        onClick={() => useStore.getState().setSeries("ul")}
      >
        <i style={{ background: "var(--upload)" }} />
        Upload
      </button>
    </div>
  );
}

export default function Chart() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current!;
    const c =
      "stop-color:color-mix(in srgb,var(--upload) var(--mix),var(--cy))";
    svg.style.setProperty("--mix", "0%");
    svg.innerHTML = `<defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="${c};stop-opacity:.38"/><stop offset="1" style="${c};stop-opacity:0"/></linearGradient><linearGradient id="gs" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0"><stop offset="0" style="${c}"/><stop offset=".7" style="${c}"/><stop offset="1" stop-color="var(--chart-line)"/></linearGradient><radialGradient id="gg"><stop offset="0" style="${c};stop-opacity:.45"/><stop offset="1" style="${c};stop-opacity:0"/></radialGradient></defs><circle id="c-g" r="70" fill="url(#gg)"/><path id="p-f" fill="url(#gf)"/><path id="p-s" fill="none" stroke="url(#gs)" stroke-width="2"/><circle id="c-d" r="5.5" fill="var(--chart-line)" stroke="var(--chart-marker-stroke)" stroke-opacity=".6" stroke-width="1.5"/>`;
    const q = (id: string) => svg.querySelector(`#${id}`)!;
    const [glow, fill, line, dot] = [q("c-g"), q("p-f"), q("p-s"), q("c-d")];
    let mix = 0,
      ymax = 14,
      raf = 0;
    const motionPreference =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    // The line scrolls left continuously; its head eases toward each new sample.
    const frame = (now: number) => {
      const { dlHist, upHist, series, settings } = useStore.getState();
      const reduced = settings.reduceMotion || !!motionPreference?.matches;
      const tgt = series === "ul" ? 1 : 0;
      const f = reduced ? 1 : Math.min(1, (now - clock.t) / 1000);
      mix += (tgt - mix) * 0.14;
      if (Math.abs(tgt - mix) < 0.002) mix = tgt;
      const v = dlHist.map((x, i) => x * (1 - mix) + upHist[i] * mix),
        M = v.length;
      ymax += (Math.max(0.25, ...v) * 1.12 - ymax) * 0.06;
      const y = (n: number) => H * 0.88 - (n / ymax) * H * 0.66;
      const p: number[][] = [];
      for (let i = 0; i < M - 1; i++)
        p.push([HEAD + (i - N + 1 - f) * step, y(v[i])]);
      if (f > 0.001) p.push([HEAD, y(v[M - 2] + (v[M - 1] - v[M - 2]) * f)]);
      const d = curve(p),
        e = p[p.length - 1];
      line.setAttribute("d", d);
      fill.setAttribute(
        "d",
        `${d} L${W},${e[1].toFixed(1)} L${W},${H} L${p[0][0].toFixed(1)},${H}Z`
      );
      for (const el of [dot, glow]) {
        el.setAttribute("cx", e[0].toFixed(1));
        el.setAttribute("cy", e[1].toFixed(1));
      }
      svg.style.setProperty("--mix", `${(mix * 100).toFixed(1)}%`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // The SVG stretches (preserveAspectRatio="none") to whatever box CSS gives
    // it. Counter-scale the live dot and glow so they stay round, and keep the
    // stroke at a constant pixel width.
    line.setAttribute("vector-effect", "non-scaling-stroke");
    const fit = () => {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const t = `scale(${(W / r.width).toFixed(4)}, ${(H / r.height).toFixed(4)})`;
      for (const el of [dot, glow] as SVGElement[]) {
        el.style.transformBox = "fill-box";
        el.style.transformOrigin = "center";
        el.style.transform = t;
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(svg);
    fit();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Transfer speed over the last minute"
      />
    </div>
  );
}
