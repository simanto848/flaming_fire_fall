"use client";

import React from "react";
import { intensityColor } from "@/lib/fire";

const FALLBACK_LAYOUT = {
  compartments: [
    { id: "NODE1", name: "Node 1 · Unity", x: 30, y: 24, w: 14, h: 14 },
    { id: "NODE2", name: "Node 2 · Harmony", x: 46, y: 24, w: 14, h: 14 },
    { id: "NODE3", name: "Node 3 · Tranquility", x: 30, y: 40, w: 14, h: 14 },
    { id: "USLAB", name: "US Lab · Destiny", x: 46, y: 8, w: 20, h: 14 },
    { id: "COL", name: "Columbus · ESA", x: 62, y: 24, w: 16, h: 14 },
    { id: "JEM", name: "Kibo · JAXA", x: 46, y: 40, w: 20, h: 14 },
    { id: "QUEST", name: "Quest Airlock", x: 14, y: 24, w: 14, h: 14 },
    { id: "CUPOLA", name: "Cupola · Obs", x: 30, y: 8, w: 12, h: 12 },
  ],
  adjacency: {
    NODE1: ["QUEST", "NODE2", "NODE3", "CUPOLA"],
    NODE2: ["NODE1", "USLAB", "COL"],
    NODE3: ["NODE1", "JEM"],
    USLAB: ["NODE2", "CUPOLA"],
    COL: ["NODE2", "JEM"],
    JEM: ["NODE3", "COL"],
    QUEST: ["NODE1"],
    CUPOLA: ["NODE1", "USLAB"],
  },
};

export default function SpacecraftMap({
  layout,
  state,
  pickMode = false,
  onPick,
}: {
  layout: any;
  state: any;
  pickMode?: boolean;
  onPick?: (id: string) => void;
}) {
  const activeLayout = layout?.compartments?.length ? layout : FALLBACK_LAYOUT;
  const comps: any[] = activeLayout.compartments;
  const adj: Record<string, string[]> = activeLayout.adjacency;
  const cs = state?.compartments || {};
  const center = (c: any) => [c.x + c.w / 2, c.y + c.h / 2];
  const byId = Object.fromEntries(comps.map((c) => [c.id, c]));
  const burning: string[] = state?.fire?.burning || [];
  const spreadTo = state?.fire?.spread_direction;
  const isLive = state?.data_source === "LIVE_HARDWARE";

  return (
    <div>
      <svg viewBox="0 0 100 62" className="w-full select-none" style={{ minHeight: 220 }}>
        <defs>
          <filter id="fire-glow">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="smoke-grad">
            <stop offset="0%" style={{ stopColor: "rgb(var(--c-map-smoke))", stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: "rgb(var(--c-map-smoke))", stopOpacity: 0 }} />
          </radialGradient>
          <marker id="arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" style={{ fill: "rgb(var(--c-danger))" }} />
          </marker>
        </defs>
        {/* hull outline */}
        <rect
          x="11" y="5" width="70" height="52" rx="6"
          style={{ fill: "rgb(var(--c-map-hull))", stroke: "rgb(var(--c-map-hull-line))" }}
          strokeWidth="0.6"
        />
        {/* corridors */}
        {comps.map((c) =>
          (adj[c.id] || []).map((n) => {
            const o = byId[n];
            if (!o || n < c.id) return null;
            const [x1, y1] = center(c);
            const [x2, y2] = center(o);
            return (
              <line
                key={`${c.id}-${n}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                style={{ stroke: state?.suppression?.isolated ? "rgb(var(--c-warn))" : "rgb(var(--c-map-room-line))" }}
                strokeWidth="1.4"
                strokeDasharray={state?.suppression?.isolated ? "0.7 1.2" : "1.5 1"}
              />
            );
          })
        )}
        {/* spread arrow */}
        {burning[0] &&
          spreadTo &&
          byId[burning[0]] &&
          byId[spreadTo] &&
          (() => {
            const [x1, y1] = center(byId[burning[0]]);
            const [x2, y2] = center(byId[spreadTo]);
            return (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                style={{ stroke: "rgb(var(--c-danger))" }}
                strokeWidth="0.8"
                strokeDasharray="2 1"
                className="animate-pulse-dot"
                markerEnd="url(#arrow)"
              />
            );
          })()}
        {/* compartments */}
        {comps.map((c) => {
          const st = cs[c.id] || {};
          const inten = st.intensity || 0;
          const onFire = !!st.on_fire;
          const affected = !!st.affected;
          const fill = onFire ? intensityColor(inten) : affected ? "rgb(var(--c-map-affected))" : "rgb(var(--c-map-room))";
          const isIgn = !isLive && state?.config?.ignition === c.id;
          const tempLabel = typeof st.temp_C === "number" ? `${st.temp_C.toFixed(0)}°` : "";
          return (
            <g key={c.id} onClick={() => pickMode && onPick?.(c.id)} style={{ cursor: pickMode ? "pointer" : "default" }}>
              <rect
                x={c.x}
                y={c.y}
                width={c.w}
                height={c.h}
                rx="2"
                style={{
                  fill,
                  fillOpacity: onFire ? 0.85 : affected ? 0.6 : 0.95,
                  stroke: isIgn ? "rgb(var(--c-ember-300))" : onFire ? intensityColor(inten) : "rgb(var(--c-map-room-line))",
                  transition: "fill 0.6s, stroke 0.6s",
                  filter: onFire ? "url(#fire-glow)" : undefined,
                }}
                strokeWidth={isIgn ? 0.9 : 0.5}
              />
              {(st.smoke || 0) > 0.05 && !onFire && (
                <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="2" fill="url(#smoke-grad)" opacity={Math.min(0.8, st.smoke)} />
              )}
              {onFire && (
                <g className="animate-pulse-dot" filter="url(#fire-glow)">
                  <path
                    d={`M${c.x + c.w / 2},${c.y + 2.5} c1.6,2 2.6,3 2.6,4.6 a2.6,2.6 0 0,1 -5.2,0 c0,-1.6 1,-2.6 2.6,-4.6 Z`}
                    fill="#fff7ed"
                    opacity="0.95"
                  />
                  <path
                    d={`M${c.x + c.w / 2},${c.y + 4} c0.9,1.2 1.5,1.9 1.5,2.9 a1.5,1.5 0 0,1 -3,0 c0,-1 0.6,-1.7 1.5,-2.9 Z`}
                    fill="#fbbf24"
                  />
                </g>
              )}
              <text
                x={c.x + c.w / 2}
                y={c.y + c.h - 2}
                textAnchor="middle"
                fontSize="2.5"
                style={{ fill: onFire ? "rgb(var(--c-map-hull))" : "rgb(var(--c-map-text))" }}
                fontWeight="700"
                className="metric-num"
              >
                {c.id}
              </text>
              {tempLabel && (
                <text
                  x={c.x + c.w - 1.2}
                  y={c.y + 3.2}
                  textAnchor="end"
                  fontSize="2.1"
                  style={{ fill: onFire ? "rgb(var(--c-map-hull))" : "rgb(var(--c-map-text-dim))" }}
                  className="metric-num"
                >
                  {tempLabel}
                </text>
              )}
              {isIgn && <circle cx={c.x + 2} cy={c.y + 2} r="1" style={{ fill: "rgb(var(--c-ember-300))" }} />}
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-mist-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(var(--c-map-room))", border: "1px solid rgb(var(--c-map-room-line))" }} /> All clear
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "rgb(var(--c-map-affected))" }} /> Smoke nearby
        </span>
        {[0.15, 0.4, 0.6, 0.9].map((i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: intensityColor(i) }} />{" "}
            {i < 0.25 ? "Low" : i < 0.5 ? "Medium" : i < 0.75 ? "High" : "Extreme"}
          </span>
        ))}
        {pickMode && <span className="ml-auto text-ember-400">Click a compartment to start the fire there</span>}
      </div>

      {/* Per-compartment readout grid */}
      {!isLive && comps.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {comps.map((c) => {
            const st = cs[c.id] || {};
            return (
              <div
                key={c.id}
                className={`rounded-md border px-2 py-1 text-[10px] ${
                  st.on_fire
                    ? "border-flame-500/60 bg-flame-500/10"
                    : st.affected
                    ? "border-ember-500/40 bg-ember-500/5"
                    : "border-line bg-void-900/60"
                }`}
              >
                <div className="flex items-center justify-between font-mono font-semibold text-mist-200">
                  <span>{c.id}</span>
                  <span style={{ color: st.on_fire ? "rgb(var(--c-danger))" : st.affected ? "rgb(var(--c-warn))" : "rgb(var(--c-neutral))" }}>
                    {st.on_fire ? `🔥 ${(st.intensity * 100).toFixed(0)}%` : st.affected ? "smoke" : "clear"}
                  </span>
                </div>
                <div className="metric-num flex justify-between gap-1 text-[9px] text-mist-500">
                  <span>{typeof st.temp_C === "number" ? `${st.temp_C.toFixed(0)}°C` : "—"}</span>
                  <span>smoke {typeof st.smoke === "number" ? `${(st.smoke * 100).toFixed(0)}%` : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
