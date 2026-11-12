"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  SlidersHorizontal, Save, ScrollText, Download, FileJson,
  Terminal, Copy, Check, Cable,
} from "lucide-react";
import { useSensors } from "@/lib/sensors";
import { api } from "@/lib/api";
import { fireApi, downloadText } from "@/lib/fire";
import { Panel, Badge } from "./ui";

const SEV_COLOR: Record<string, string> = { info: "rgb(var(--c-info))", warning: "rgb(var(--c-warn))", critical: "rgb(var(--c-danger))" };

const SOURCE_LABELS: Record<string, string> = {
  LIVE_HARDWARE: "Live hardware",
  SIMULATION: "Simulated",
};

export default function ReportsAndHardware() {
  const { snapshot, refresh } = useSensors();
  const fireState = snapshot?.fire_state || {};
  const th = fireState?.thresholds || {};
  const events: any[] = fireState?.events || [];
  const source = fireState?.data_source || snapshot?.data_source || "SIMULATION";

  const [sel, setSel] = useState("o2_pct");
  const [draft, setDraft] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busyReport, setBusyReport] = useState("");
  const [board, setBoard] = useState<"uno" | "esp32">("uno");
  const [firmware, setFirmware] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!draft && th.o2_pct) setDraft(JSON.parse(JSON.stringify(th.o2_pct)));
  }, [th, draft]);

  useEffect(() => {
    api.firmware(board).then((d) => setFirmware(d.cpp_code)).catch(() => {});
  }, [board]);

  const openEditor = (key: string) => {
    setSel(key);
    if (th[key]) setDraft(JSON.parse(JSON.stringify(th[key])));
    setSaved(false);
    setErr("");
  };

  const setBand = (band: string, idx: number, v: number) =>
    setDraft((d: any) => ({ ...d, [band]: d[band].map((x: number, i: number) => (i === idx ? v : x)) }));

  const saveThresholds = () => {
    setErr("");
    fireApi
      .setThresholds({ [sel]: draft })
      .then(() => {
        setSaved(true);
        void refresh();
      })
      .catch((e) => setErr(e.message));
  };

  const download = async (fmt: "md" | "json") => {
    setBusyReport(fmt);
    try {
      const rep = await fireApi.report(fmt);
      if (fmt === "md") downloadText(rep.filename || "spacecraft_incident.md", rep.markdown, "text/markdown");
      else downloadText("spacecraft_incident.json", JSON.stringify(rep, null, 2), "application/json");
    } catch {
    } finally {
      setBusyReport("");
    }
  };

  const copyFirmware = async () => {
    await navigator.clipboard.writeText(firmware);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const types = useMemo(() => Array.from(new Set(events.map((e) => e.type))), [events]);
  const filtered = events.filter((e) => !typeFilter || e.type === typeFilter);

  return (
    <div className="space-y-4">
      {/* Configurable Thresholds */}
      <Panel title="Safety thresholds" icon={<SlidersHorizontal className="h-4 w-4" />}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <span className="label">Reading</span>
            <select value={sel} onChange={(e) => openEditor(e.target.value)} className="input">
              {Object.entries(th).map(([k, t]: [string, any]) => (
                <option key={k} value={k}>
                  {t.label} ({t.unit})
                </option>
              ))}
            </select>
          </div>
          {draft &&
            (
              [
                ["normal", "Safe range"],
                ["warn", "Caution range"],
                ["crit", "Danger range"],
              ] as [string, string][]
            ).map(([band, label]) => (
              <div key={band}>
                <span className="label">{label} · low / high</span>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    value={draft[band][0]}
                    onChange={(e) => setBand(band, 0, parseFloat(e.target.value))}
                    className="input !w-24 !py-1.5 text-xs"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={draft[band][1]}
                    onChange={(e) => setBand(band, 1, parseFloat(e.target.value))}
                    className="input !w-24 !py-1.5 text-xs"
                  />
                </div>
              </div>
            ))}
          <button type="button" onClick={saveThresholds} className="btn btn-primary">
            <Save className="h-4 w-4" /> Save
          </button>
          {saved && <Badge color="rgb(var(--c-ok))">Saved</Badge>}
        </div>
        {err && <div className="mt-2 text-xs text-flame-400">{err}</div>}
      </Panel>

      {/* Event Timeline & Incident Reports */}
      <Panel
        title="Event log & incident report"
        icon={<ScrollText className="h-4 w-4" />}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={source === "LIVE_HARDWARE" ? "rgb(var(--c-info))" : "rgb(var(--c-warn))"}>
              {SOURCE_LABELS[source] || source}
            </Badge>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-line bg-void-900 px-2 py-1 text-[10px] text-mist-300"
            >
              <option value="">All events</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void download("md")} disabled={!!busyReport} className="btn btn-primary !py-1 text-[11px]">
              <Download className="h-3.5 w-3.5" /> Download .md
            </button>
            <button type="button" onClick={() => void download("json")} disabled={!!busyReport} className="btn btn-ion !py-1 text-[11px]">
              <FileJson className="h-3.5 w-3.5" /> Download .json
            </button>
          </div>
        }
      >
        <div className="max-h-[300px] overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-void-800 text-mist-400">
              <tr>
                <th className="px-2.5 py-2 font-semibold">Time (s)</th>
                <th className="px-2.5 py-2 font-semibold">Event</th>
                <th className="px-2.5 py-2 font-semibold">Level</th>
                <th className="px-2.5 py-2 font-semibold">What happened</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-mist-500">
                    All quiet — nothing logged yet.
                  </td>
                </tr>
              ) : (
                filtered
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <tr key={i} className="border-t border-line/60 hover:bg-void-700/40">
                      <td className="metric-num px-2.5 py-1.5 text-mist-500">{e.t}</td>
                      <td className="metric-num px-2.5 py-1.5 text-ion-300">{e.type}</td>
                      <td className="px-2.5 py-1.5">
                        <Badge color={SEV_COLOR[e.severity] || "rgb(var(--c-neutral))"}>{e.severity}</Badge>
                      </td>
                      <td className="px-2.5 py-1.5 text-mist-300">{e.message}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Hardware Gateway & Reference Sketch */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Panel title="Connect your Arduino board" icon={<Cable className="h-4 w-4" />}>
          <ol className="space-y-2 text-xs leading-relaxed text-mist-300">
            <li>1. Upload the starter sketch to your Arduino Uno (read-only serial, 115200 baud).</li>
            <li>2. List the available ports: <code className="text-ion-300">python3 -m shunnoshikha.serial_gateway --list</code></li>
            <li>3. Start the gateway: <code className="text-ion-300">python3 -m shunnoshikha.serial_gateway --port &lt;PORT&gt; --board &quot;Arduino Uno&quot;</code></li>
            <li>4. Switch the header toggle up top to <strong>Live hardware</strong>.</li>
          </ol>
        </Panel>

        <Panel
          title={`Starter firmware · ${board === "uno" ? "Arduino Uno" : "ESP32"}`}
          icon={<Terminal className="h-4 w-4" />}
          right={
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setBoard("uno")} className={`chip ${board === "uno" ? "!border-ion-400/60 !text-ion-300" : ""}`}>
                Uno
              </button>
              <button type="button" onClick={() => setBoard("esp32")} className={`chip ${board === "esp32" ? "!border-ion-400/60 !text-ion-300" : ""}`}>
                ESP32
              </button>
              <button type="button" onClick={() => void copyFirmware()} className="btn !px-2 !py-1 text-[11px]">
                {copied ? <Check className="h-3.5 w-3.5 text-pulse-400" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          }
        >
          <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-void-950 p-3 font-mono text-[11px] text-mist-300">
            {firmware || "Loading the sketch…"}
          </pre>
        </Panel>
      </div>
    </div>
  );
}

