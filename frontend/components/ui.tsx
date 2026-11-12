"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Panel({ title, icon, right, children, className = "" }: {
  title?: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          {icon && <span className="text-ember-500">{icon}</span>}
          <span className="flex-1">{title}</span>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Sparkline({ data, color = "rgb(var(--c-info))", height = 40, fill = true }: {
  data: number[]; color?: string; height?: number; fill?: boolean;
}) {
  const w = 200;
  if (!data.length) return <div style={{ height }} className="skeleton rounded" />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = height - 4 - ((v - min) / span) * (height - 8);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const id = React.useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#sg-${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  );
}

export function Gauge({ value, min, max, label, unit, color = "rgb(var(--c-warn))", size = 132, danger }: {
  value: number | null | undefined; min: number; max: number; label: string; unit: string; color?: string; size?: number; danger?: boolean;
}) {
  const valid = typeof value === "number" && Number.isFinite(value);
  const frac = valid ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const r = size / 2 - 12;
  const cx = size / 2, cy = size / 2;
  const start = Math.PI * 0.75, end = Math.PI * 2.25;
  const ang = start + frac * (end - start);
  const arc = (a0: number, a1: number) => {
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
  };
  const c = !valid ? "rgb(var(--c-neutral))" : danger ? "rgb(var(--c-danger))" : color;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.82} viewBox={`0 0 ${size} ${size * 0.92}`}>
        <path d={arc(start, end)} fill="none" stroke="rgb(var(--c-void-600))" strokeWidth="9" strokeLinecap="round" />
        {valid && (
          <path d={arc(start, ang)} fill="none" stroke={c} strokeWidth="9" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${c})`, transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)", opacity: valid ? 1 : 0.9 }} />
        )}
        <text x={cx} y={cy + 2} textAnchor="middle" className="metric-num" style={{ fill: valid ? "rgb(var(--c-mist-100))" : "rgb(var(--c-mist-500))" }} fontSize={size * 0.2} fontWeight="600">
          {valid ? value.toFixed(Math.abs(value) < 10 ? 2 : 1) : "—"}
        </text>
        <text x={cx} y={cy + size * 0.17} textAnchor="middle" style={{ fill: "rgb(var(--c-mist-500))" }} fontSize={size * 0.085}>{valid ? unit : "no reading"}</text>
      </svg>
      <div className="-mt-1 text-[11px] font-semibold tracking-wide text-mist-400">{label}</div>
    </div>
  );
}

export function Stat({ label, value, unit, accent = "rgb(var(--c-mist-100))", sub }: {
  label: string; value: React.ReactNode; unit?: string; accent?: string; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-void-900/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-wide text-mist-500">{label}</div>
      <div className="metric-num mt-0.5 text-xl font-semibold" style={{ color: accent }}>
        {value}{unit && <span className="ml-1 text-xs font-normal text-mist-500">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-mist-500">{sub}</div>}
    </div>
  );
}

export function Badge({ children, color = "rgb(var(--c-info))", pulse = false }: { children: React.ReactNode; color?: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}>
      {pulse && <span className="h-1.5 w-1.5 rounded-full animate-pulse-dot" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function Slider({ label, value, min, max, step = 0.1, unit, onChange, color }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; color?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-mist-400">{label}</span>
        <span className="metric-num text-sm font-semibold" style={{ color: color || "rgb(var(--c-warn))" }}>
          {value.toFixed(step < 1 ? 1 : 0)}{unit && <span className="ml-0.5 text-[10px] text-mist-500">{unit}</span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}

export function Loading({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-mist-400 animate-in fade-in duration-200">
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute h-full w-full rounded-full border-[1.5px] border-ember-500/25" />
        <span className="absolute h-full w-full animate-spin rounded-full border-[1.5px] border-transparent border-t-ember-400" />
        <span className="h-1 w-1 rounded-full bg-ember-400 animate-pulse-dot" />
      </span>
      <span className="text-xs font-medium text-mist-300 tracking-wide">
        {label.endsWith("…") || label.endsWith("...") ? label : `${label}…`}
      </span>
    </div>
  );
}

export function Empty({ icon, title, sub }: { icon?: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-mist-600">{icon}</div>}
      <div className="text-sm font-medium text-mist-300">{title}</div>
      {sub && <div className="max-w-sm text-xs text-mist-500">{sub}</div>}
    </div>
  );
}

export function Bar({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = Math.max(0, Math.min(100, (Math.abs(value) / max) * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 truncate font-mono text-mist-400" title={label}>{label}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-void-900">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px color-mix(in srgb, ${color} 45%, transparent)` }}
        />
      </div>
      <span className="metric-num w-16 shrink-0 text-right" style={{ color }}>{value.toFixed(3)}{suffix}</span>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, warning, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; warning?: string; confirmLabel?: string;
  danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void-950/80 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="panel w-full max-w-md animate-fade-up !border-2 p-5"
        style={{ borderColor: `color-mix(in srgb, ${danger ? "rgb(var(--c-danger))" : "rgb(var(--c-warn))"} 45%, transparent)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-display text-base font-bold" style={{ color: danger ? "rgb(var(--c-danger))" : "rgb(var(--c-warn))" }}>{title}</div>
        <p className="mt-2 text-sm leading-relaxed text-mist-300">{message}</p>
        {warning && (
          <div className="mt-3 rounded-lg border border-flame-500/40 bg-flame-500/10 px-3 py-2 text-xs leading-relaxed text-flame-400">
            ⚠ {warning}
          </div>
        )}
        <div className="mt-3 rounded-md border border-line bg-void-900 px-3 py-1.5 text-[10px] tracking-wide text-mist-500">
          Simulation only — real hardware stays untouched
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn">Cancel</button>
          <button onClick={onConfirm} className={`btn ${danger ? "!border-flame-500/60 !bg-flame-600 !text-white hover:!bg-flame-500" : "btn-primary"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
