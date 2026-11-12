"use client";

import React, { useState } from "react";
import { ShieldCheck, ShieldOff, OctagonX, Wind, Power, SprayCan, Activity, Lock, CloudFog } from "lucide-react";
import { Panel, Badge, ConfirmDialog } from "./ui";

const TIER_COLORS: Record<string, string> = {
  SAFE: "rgb(var(--c-ok))",
  GUARDED: "rgb(var(--c-info))",
  ELEVATED: "rgb(var(--c-warn))",
  HIGH: "rgb(var(--c-danger))",
};

const SEV_COLORS: Record<string, string> = {
  success: "rgb(var(--c-ok))",
  warning: "rgb(var(--c-warn))",
  info: "rgb(var(--c-mist-400))",
  critical: "rgb(var(--c-danger))",
};

const LEVERS = [
  { key: "mist_precharge", label: "Ignition-kernel quench", hint: "Pre-charged local inerting vetoes ignition attempts", icon: SprayCan },
  { key: "auto_inert_o2", label: "Oxidizer conditioning", hint: "Trims O₂ enrichment into the crew-safe band (≥19.5%)", icon: Wind },
  { key: "ignition_isolation", label: "Ignition-source isolation", hint: "De-energizes circuits when flammability risk climbs", icon: Power },
  { key: "dilution_guard", label: "Inert-gas dilution guard", hint: "Adds CO₂ dilution to auto-quenches (FLEX CO₂/He precedent)", icon: CloudFog },
] as const;

function RiskGauge({ score, tier, threshold, armed }: { score: number; tier: string; threshold: number; armed: boolean }) {
  const size = 148;
  const cx = size / 2, cy = size / 2 + 6;
  const r = size / 2 - 14;
  const start = Math.PI * 0.78, end = Math.PI * 2.22;
  const frac = Math.max(0, Math.min(1, score));
  const ang = start + frac * (end - start);
  const tAng = start + Math.max(0, Math.min(1, threshold)) * (end - start);
  const pt = (a: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arc = (a0: number, a1: number, rr: number) => {
    const [x0, y0] = pt(a0, rr);
    const [x1, y1] = pt(a1, rr);
    return `M${x0},${y0} A${rr},${rr} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const color = armed ? TIER_COLORS[tier] || "rgb(var(--c-neutral))" : "rgb(var(--c-neutral))";
  const [tx0, ty0] = pt(tAng, r - 9);
  const [tx1, ty1] = pt(tAng, r + 9);
  return (
    <svg width={size} height={size * 0.86} viewBox={`0 0 ${size} ${size * 0.94}`} className="shrink-0">
      <path d={arc(start, end, r)} fill="none" stroke="rgb(var(--c-void-600))" strokeWidth="8" strokeLinecap="round" />
      {frac > 0.004 && (
        <path d={arc(start, ang, r)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 7px ${color})`, transition: "all 0.5s cubic-bezier(0.22,1,0.36,1)" }} />
      )}
      <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="rgb(var(--c-mist-300))" strokeWidth="2" strokeLinecap="round" />
      <text x={cx} y={cy - 2} textAnchor="middle" className="metric-num" fontSize="26" fontWeight="700"
        style={{ fill: armed ? "rgb(var(--c-mist-100))" : "rgb(var(--c-mist-500))" }}>
        {score.toFixed(2)}
      </text>
      <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="1.5" style={{ fill: color }}>
        {armed ? tier : "DISARMED"}
      </text>
      <text x={cx} y={cy + 28} textAnchor="middle" fontSize="7.5" style={{ fill: "rgb(var(--c-mist-500))" }}>
        block ≥ {threshold.toFixed(2)}
      </text>
    </svg>
  );
}

export default function PreventionPanel({ snapshot, command, editable }: {
  snapshot: any;
  command: (path: string, body?: unknown) => Promise<any>;
  editable: boolean;
}) {
  const [confirmDisarm, setConfirmDisarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const p = snapshot?.prevention;
  if (!p) return null;

  const risk = p.risk || {};
  const tier = risk.tier || "SAFE";
  const tierColor = TIER_COLORS[tier] || "rgb(var(--c-neutral))";
  const armed = !!p.armed;

  const cfg = async (patch: Record<string, unknown>) => {
    setErr("");
    setBusy(true);
    try {
      await command("/api/prevention/config", patch);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Autonomous fire prevention"
      icon={<ShieldCheck className="h-4 w-4" />}
      right={
        <Badge color={armed ? "rgb(var(--c-ok))" : "rgb(var(--c-danger))"} pulse={armed}>
          {armed ? "ARMED — fire cannot start" : "STOOD DOWN"}
        </Badge>
      }
    >
      <div className="flex items-center gap-3">
        <RiskGauge score={risk.score ?? 0} tier={tier} threshold={risk.block_threshold ?? 0.24} armed={armed} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Ignitions blocked", value: p.stats?.ignitions_blocked ?? 0, color: "rgb(var(--c-ok))" },
              { label: "Interventions", value: p.stats?.interventions ?? 0, color: "rgb(var(--c-info))" },
              { label: "Auto quenches", value: p.stats?.quench_count ?? 0, color: "rgb(var(--c-warn2))" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line bg-void-900/70 px-2 py-1.5 text-center">
                <div className="metric-num text-base font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[8px] leading-tight text-mist-500">{s.label}</div>
              </div>
            ))}
          </div>
          {p.last_block && (
            <div className="rounded-lg border border-pulse-500/40 bg-pulse-500/10 px-2.5 py-1.5 text-[10px] leading-snug text-pulse-300">
              <OctagonX className="mr-1 inline h-3 w-3" />
              Ignition in <b>{p.last_block.compartment}</b> quenched at t={p.last_block.t}s (risk {p.last_block.risk?.toFixed(2)}). Fire could not start.
            </div>
          )}
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => (armed ? setConfirmDisarm(true) : void cfg({ armed: true }))}
            className="btn w-full !py-2 text-[11px] font-bold disabled:opacity-50"
            style={{
              borderColor: `color-mix(in srgb, ${armed ? "rgb(var(--c-danger))" : "rgb(var(--c-ok))"} 50%, transparent)`,
              background: `color-mix(in srgb, ${armed ? "rgb(var(--c-danger))" : "rgb(var(--c-ok))"} 12%, transparent)`,
              color: armed ? "rgb(var(--c-danger))" : "rgb(var(--c-ok))",
            }}
          >
            {armed ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {armed ? "Stand down prevention…" : "Re-arm prevention"}
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-2.5">
        <div className="mb-1 flex justify-between text-[10px]">
          <span className="text-mist-400">Intervention aggressiveness</span>
          <span className="font-mono" style={{ color: tierColor }}>{Math.round((p.aggressiveness ?? 0.7) * 100)}%</span>
        </div>
        <input
          type="range" min={0} max={1} step={0.05}
          value={p.aggressiveness ?? 0.7}
          disabled={!editable || busy}
          onChange={(e) => void cfg({ aggressiveness: parseFloat(e.target.value) })}
          className="w-full"
        />
        <div className="mt-2 space-y-1.5">
          {LEVERS.map((lv) => {
            const Icon = lv.icon;
            const on = !!p[lv.key];
            return (
              <label key={lv.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${on ? "border-pulse-500/35 bg-pulse-500/8" : "border-line bg-void-900/60 opacity-70"}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: on ? "rgb(var(--c-ok))" : "rgb(var(--c-neutral))" }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold text-mist-200">{lv.label}</span>
                  <span className="block truncate text-[9px] text-mist-500">{lv.hint}</span>
                </span>
                <input
                  type="checkbox" checked={on} disabled={!editable || busy}
                  onChange={(e) => void cfg({ [lv.key]: e.target.checked })}
                  className="h-3.5 w-3.5 shrink-0 accent-pulse-400"
                />
              </label>
            );
          })}
        </div>
      </div>

      {(risk.drivers?.length > 0 || risk.materials) && (
        <div className="mt-2.5 rounded-lg border border-line bg-void-900/60 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold tracking-wide text-mist-400">
            <Activity className="h-3 w-3" style={{ color: tierColor }} /> Risk drivers · protected materials
          </div>
          <div className="flex flex-wrap gap-1">
            {(risk.drivers || []).map((d: string) => (
              <span key={d} className="rounded border border-line bg-void-950 px-1.5 py-0.5 text-[9px] text-mist-300">{d}</span>
            ))}
            {Object.entries(risk.materials || {}).map(([mat, m]: [string, any]) => (
              <span key={mat} className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  color: m.regime === "Sustained Burn" ? "rgb(var(--c-warn))" : "rgb(var(--c-info))",
                  border: `1px solid color-mix(in srgb, ${m.regime === "Sustained Burn" ? "rgb(var(--c-warn))" : "rgb(var(--c-info))"} 35%, transparent)`,
                }}>
                {mat}: {m.regime} ({(m.p_sustained * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {p.log?.length > 0 && (
        <div className="mt-2.5 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-line bg-void-950 p-2">
          {p.log.map((e: any, i: number) => (
            <div key={`${e.wall}-${i}`} className="flex gap-1.5 text-[9px] leading-snug">
              <span className="shrink-0 font-mono text-mist-600">{e.wall?.split("T")[1]?.replace("Z", "")}</span>
              <span style={{ color: SEV_COLORS[e.severity] || "rgb(var(--c-mist-400))" }}>{e.detail}</span>
            </div>
          ))}
        </div>
      )}

      {err && <div className="mt-2 rounded border border-flame-500/40 bg-flame-500/10 px-2.5 py-1 text-[10px] text-flame-400">{err}</div>}
      <p className="mt-2 flex items-start gap-1 text-[9px] leading-snug text-mist-500">
        <Lock className="mt-0.5 h-2.5 w-2.5 shrink-0" />
        {p.disclaimer || "Educational simulation only — no hardware is commanded."}
      </p>

      <ConfirmDialog
        open={confirmDisarm}
        danger
        title="Stand down autonomous prevention?"
        confirmLabel="Stand down (simulation)"
        message="While stood down, ignition attempts will NOT be quenched and fires can start and spread. This is an explicit operator action and is logged."
        warning="Re-arm at any time — an armed system immediately quenches any existing flame."
        onConfirm={() => { setConfirmDisarm(false); void cfg({ armed: false, confirmed: true }); }}
        onCancel={() => setConfirmDisarm(false)}
      />
    </Panel>
  );
}