"use client";

import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function SettingsSection({ title, reset, saved, badge, children, collapsible = false, defaultCollapsed = false }: { title: string; reset?: () => void; saved?: boolean; badge?: string; children: ReactNode; collapsible?: boolean; defaultCollapsed?: boolean }) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const contentId = `${id}-content`;
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  return <section className="pref-section" aria-labelledby={id}>
    <header className="pref-section-head"><div className="pref-section-title"><h2 id={id}>{title}{badge && <span className="pref-badge">{badge}</span>}</h2>{collapsible && <button type="button" className="pref-section-disclosure" aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)} />}</div>{(!collapsible || expanded) && <span className="pref-section-actions">{saved && <span className="pref-saved" aria-live="polite">Saved</span>}{reset && <Button variant="ghost" onClick={reset}>Reset</Button>}</span>}</header>
    {collapsible ? <div className={`pref-section-collapse${expanded ? " is-open" : ""}`}><div id={contentId} className="pref-section-collapse-inner" aria-hidden={!expanded} inert={!expanded}><div className="pref-panel">{children}</div></div></div> : <div className="pref-panel">{children}</div>}
  </section>;
}

export function SettingRow({ label, description, error, disabled, control, children, onLabelClick }: { label: string; description?: ReactNode; error?: string; disabled?: boolean; control?: ReactNode; children?: ReactNode; onLabelClick?: () => void }) {
  return <div className={`pref-row${disabled ? " is-disabled" : ""}`}>
    <div className="pref-label">{onLabelClick ? <button type="button" className="pref-label-trigger" aria-label={`${label}, activate five times to open developer console`} onClick={onLabelClick}>{label}</button> : <span>{label}</span>}{description && <small>{description}</small>}{error && <small className="pref-error" role="alert">{error}</small>}</div>
    <div className="pref-control"><div className="pref-control-content">{control ?? children}</div></div>
  </div>;
}

export function Toggle({ checked, onChange, label, disabled, ...props }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type">) {
  return <button {...props} type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`pref-toggle${props.className ? ` ${props.className}` : ""}`} onClick={() => onChange(!checked)} />;
}

export const NumberField = forwardRef<HTMLInputElement, { unit?: string; value: string | number; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">>(function NumberField({ unit, value, onChange, ...props }, ref) {
  const unitClass = unit ? ` has-unit unit-${unit.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return <span className={`pref-field${unitClass}`}><input {...props} ref={ref} type="number" value={value} onChange={(event) => onChange(event.target.value)} />{unit && <small>{unit}</small>}</span>;
});

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <span className="pref-field pref-text-field"><input {...props} /></span>;
}

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selected = options.findIndex(([key]) => key === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(0, selected));
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });
  const close = () => setOpen(false);

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = () => {
      const rect = root.current!.getBoundingClientRect();
      const maxHeight = Math.min(240, options.length * 36 + 10);
      const roomBelow = window.innerHeight - rect.bottom;
      const above = roomBelow < maxHeight && rect.top > roomBelow;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
      setPosition({
        top: above ? Math.max(8, rect.top - maxHeight) : Math.min(rect.bottom, window.innerHeight - maxHeight - 8),
        left,
        width: rect.width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) setActive(Math.max(0, selected));
  }, [open, selected]);

  const choose = (index: number) => {
    onChange(options[index][0]);
    close();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (event.key === "Home") setActive(0);
      else if (event.key === "End") setActive(options.length - 1);
      else setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) { event.preventDefault(); choose(active); }
  };

  return <span ref={root} className="pref-field pref-select-field">
    <button type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown}>
      {options[selected]?.[1] ?? ""}
    </button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={menu} id={id} className="pref-select-menu" role="listbox" aria-label={label} style={position}>
        {options.map(([key, text], index) => <div key={key} id={`${id}-${index}`} role="option" aria-selected={value === key} className={active === index ? "active" : ""} onMouseMove={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>{text}</div>)}
      </div>,
      document.body
    )}
  </span>;
}

export function Button({ variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "accent" | "ghost" | "danger-ghost" | "danger-outline" }) {
  return <button {...props} className={`pref-button ${variant}${props.className ? ` ${props.className}` : ""}`} />;
}
