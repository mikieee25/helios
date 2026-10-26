"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

export function SettingsSection({ title, reset, saved, badge, children }: { title: string; reset?: () => void; saved?: boolean; badge?: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <section className="pref-section" aria-labelledby={id}>
    <header className="pref-section-head"><h2 id={id}>{title}{badge && <span className="pref-badge">{badge}</span>}</h2><span className="pref-section-actions">{saved && <span className="pref-saved" aria-live="polite">Saved</span>}{reset && <Button variant="ghost" onClick={reset}>Reset</Button>}</span></header>
    <div className="pref-panel">{children}</div>
  </section>;
}

export function SettingRow({ label, description, error, disabled, control, children }: { label: string; description?: ReactNode; error?: string; disabled?: boolean; control?: ReactNode; children?: ReactNode }) {
  return <div className={`pref-row${disabled ? " is-disabled" : ""}`}>
    <div className="pref-label"><span>{label}</span>{description && <small>{description}</small>}{error && <small className="pref-error" role="alert">{error}</small>}</div>
    <div className="pref-control">{control ?? children}</div>
  </div>;
}

export function Toggle({ checked, onChange, label, disabled, ...props }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type">) {
  return <button {...props} type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={`pref-toggle${props.className ? ` ${props.className}` : ""}`} onClick={() => onChange(!checked)} />;
}

export const NumberField = forwardRef<HTMLInputElement, { unit?: string; value: string | number; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">>(function NumberField({ unit, value, onChange, ...props }, ref) {
  return <span className="pref-field"><input {...props} ref={ref} type="number" value={value} onChange={(event) => onChange(event.target.value)} />{unit && <small>{unit}</small>}</span>;
});

export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <span className="pref-field pref-text-field"><input {...props} /></span>;
}

export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="pref-field pref-select-field"><select {...props} /></span>;
}

export function Button({ variant = "secondary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "accent" | "ghost" | "danger-ghost" }) {
  return <button {...props} className={`pref-button ${variant}${props.className ? ` ${props.className}` : ""}`} />;
}
