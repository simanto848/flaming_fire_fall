"use client";

import React, { useEffect, useState } from "react";
import {
  Play, Pause, Square, RotateCcw, ShieldCheck, Zap, BatteryWarning,
  AlertOctagon, CheckCircle2, Flame, ShieldAlert, Droplets, SprayCan,
  Power, Wind, OctagonX, BellRing, Lock, HeartPulse, BrainCircuit,
  RefreshCw, Sliders, Radio, Cable, Waves, Code2, CloudFog, Atom, Leaf,
} from "lucide-react";
import { useSensors } from "@/lib/sensors";
import { api } from "@/lib/api";
import { fireApi, CREW_COLORS, SEVERITY_COLORS, SPECIES_COLORS } from "@/lib/fire";
import { Panel, Badge, Bar, ConfirmDialog, Sparkline, Markdown } from "./ui";
import ArduinoScene from "./hardware/ArduinoScene";
import StationScene from "./three/StationScene";
import BoundaryScene from "./three/BoundaryScene";
import FlameChamber from "./three/FlameChamber";
import InvestigationGalaxy from "./three/InvestigationGalaxy";
import PreventionPanel from "./PreventionPanel";

const SCENARIOS = [
  { id: "normal", num: "1", title: "Normal operations", icon: ShieldCheck, color: "rgb(var(--c-ok))" },
  { id: "electrical", num: "2", title: "Electrical fire", icon: Zap, color: "rgb(var(--c-warn2))" },
  { id: "battery", num: "3", title: "Battery fire", icon: BatteryWarning, color: "rgb(var(--c-danger))" },
  { id: "critical", num: "4", title: "Critical cabin", icon: AlertOctagon, color: "rgb(var(--c-nova-400))" },
  { id: "suppression", num: "5", title: "Suppression demo", icon: CheckCircle2, color: "rgb(var(--c-info))" },
];

const SPEEDS = [1, 2, 5, 10];

const SENSOR_SPECS = [
  { key: "o2_pct", label: "Oxygen", short: "O₂", pin: "A0", unit: "%", min: 10, max: 40, step: 0.1 },
  { key: "co_ppm", label: "Carbon Monoxide", short: "CO", pin: "A1", unit: "ppm", min: 0, max: 300, step: 0.5 },
  { key: "co2_ppm", label: "Carbon Dioxide", short: "CO₂", pin: "A4/A5", unit: "ppm", min: 300, max: 25000, step: 50 },
  { key: "temp_C", label: "Temperature", short: "Temp", pin: "D2", unit: "°C", min: 0, max: 120, step: 0.5 },
  { key: "humidity_pct", label: "Humidity", short: "RH", pin: "D2", unit: "%", min: 5, max: 95, step: 1 },
  { key: "smoke_mgm3", label: "Smoke", short: "Smoke", pin: "A2", unit: "mg/m³", min: 0, max: 10, step: 0.05 },
  { key: "pressure_kpa", label: "Pressure", short: "Press", pin: "A4/A5", unit: "kPa", min: 40, max: 120, step: 0.2 },
  { key: "airflow_cms", label: "Airflow", short: "Flow", pin: "A3", unit: "cm/s", min: 0, max: 30, step: 0.25 },
];

const SUPPRESSION_ACTIONS = [
  { id: "activate_suppression", label: "Run suppression", icon: ShieldAlert, color: "rgb(var(--c-warn2))", confirm: true },
  { id: "activate_water", label: "Spray water", icon: Droplets, color: "rgb(var(--c-volt-400))", confirm: true, water: true },
  { id: "activate_suppressant", label: "Gas suppressant", icon: SprayCan, color: "rgb(var(--c-nova-400))", confirm: true },
  { id: "emergency_isolation", label: "Isolate compartments", icon: Power, color: "rgb(var(--c-warn))", confirm: true },
  { id: "isolate_oxygen", label: "Cut oxygen supply", icon: Wind, color: "rgb(var(--c-info))", confirm: true },
  { id: "dilute_co2", label: "CO₂ dilution", icon: CloudFog, color: "rgb(var(--c-info))", confirm: true, dilution: true },
  { id: "dilute_he", label: "He dilution", icon: Atom, color: "rgb(var(--c-volt-400))", confirm: true, dilution: true },
  { id: "stop_suppression", label: "Stop suppression", icon: OctagonX, color: "rgb(var(--c-neutral))", confirm: false },
  { id: "emergency_alert", label: "Sound alarm", icon: BellRing, color: "rgb(var(--c-danger))", confirm: true },
];

const SENSOR_STATUS_COLOR: Record<string, string> = {
  normal: "rgb(var(--c-st-normal))",
  warning: "rgb(var(--c-st-warning))",
  critical: "rgb(var(--c-st-critical))",
  missing: "rgb(var(--c-st-missing))",
  stale: "rgb(var(--c-st-stale))",
  disconnected: "rgb(var(--c-st-disconnected))",
  uncalibrated: "rgb(var(--c-st-uncalibrated))",
};

const HUMAN_STATUS: Record<string, string> = {
  normal: "reading",
  warning: "check",
  critical: "alert",
  missing: "no data",
  stale: "stale",
  disconnected: "offline",
  uncalibrated: "needs calibration",
};

export default function UnifiedTwinDashboard() {
  const { snapshot, command, setMode, patchSensors, refresh } = useSensors();
  const [selectedSensor, setSelectedSensor] = useState("o2_pct");
  const [twinPanelTab, setTwinPanelTab] = useState<"controls" | "channels">("controls");
  const [layout, setLayout] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [pickMode, setPickMode] = useState(false);
  const [pendingSup, setPendingSup] = useState<any>(null);
  const [confirmPreset5, setConfirmPreset5] = useState(false);
  const [manualAI, setManualAI] = useState<any>(null);
  const [aiRaw, setAiRaw] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [quickAsk, setQuickAsk] = useState("");
  const [quickAns, setQuickAns] = useState<{ text: string; agent?: string } | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [err, setErr] = useState("");
  const [supMsg, setSupMsg] = useState("");

  useEffect(() => {
    fireApi.layout().then(setLayout).catch(() => {});
    fireApi.scenarios().then(setScenarios).catch(() => {});
  }, []);

  const isSim = snapshot?.mode !== "live";
  const fireState = snapshot?.fire_state || {};
  const cfg = fireState?.config || {};
  const crew = snapshot?.crew || {};
  const hw = snapshot?.hardware || {};
  const sensors = snapshot?.sensors || {};
  const pres = snapshot?.presentation || { scenario: "normal", status: "idle" };
  const atm = fireState?.atmosphere || {};
  const hist = snapshot?.history || [];

  useEffect(() => {
    setSupMsg("");
  }, [snapshot?.mode]);

  useEffect(() => {
    fireApi.recommendation().then(setRec).catch(() => {});
  }, [cfg.fire_type, cfg.water_approved, cfg.equipment_deenergized, fireState?.suppression?.o2_isolated, snapshot?.mode]);

  const runCmd = async (path: string, body?: unknown) => {
    setErr("");
    try {
      await command(path, body);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const choosePreset = async (id: string) => {
    if (id === "suppression") {
      setConfirmPreset5(true);
      return;
    }
    if (!isSim) await setMode("simulation");
    await runCmd("/api/presentation/select", { scenario: id, confirmed: false });
  };

  const confirmAndRunPreset5 = async () => {
    setConfirmPreset5(false);
    if (!isSim) await setMode("simulation");
    await runCmd("/api/presentation/select", { scenario: "suppression", confirmed: true });
  };

  const runSupAction = (a: any) => {
    setErr("");
    setSupMsg("");
    setPendingSup(null);
    fireApi
      .suppress(a.id, true)
      .then((res) => {
        const status = String(res?.execution_status || "SIMULATED_ONLY").toLowerCase().replace(/_/g, " ");
        setSupMsg(`${a.label} — ${status}`);
        void refresh();
      })
      .catch((e) => setErr(e.message));
  };

  const refreshAI = () => {
    setAiBusy(true);
    setErr("");
    fireApi
      .aiAssessment()
      .then((res) => {
        setManualAI(res);
        void refresh();
      })
      .catch((e) => setErr(e.message))
      .finally(() => setAiBusy(false));
  };

  const askInlineCopilot = async (qOverride?: string) => {
    const q = (qOverride ?? quickAsk).trim();
    if (!q || quickBusy) return;
    if (!qOverride) setQuickAsk("");
    setQuickBusy(true);
    setErr("");
    try {
      const res = await api.chat({ message: q });
      setQuickAns({ text: res.response_markdown || "", agent: res.active_agent?.callsign });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setQuickBusy(false);
    }
  };

  const fmt = (v: any, key: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    if (key === "co2_ppm") return v.toFixed(0);
    if (key === "smoke_mgm3") return v.toFixed(2);
    return v.toFixed(1);
  };

  const isRunning = fireState.status === "running" || pres.status === "running";
  const isPaused = !isRunning && fireState.status === "paused";
  const editable = isSim && fireState.status !== "running";
  const sev = fireState.severity || (isSim ? "Normal" : "Unknown");
  const sevColor = SEVERITY_COLORS[sev] || "rgb(var(--c-neutral))";
  const crewStatus = crew.status || (isSim ? "SAFE" : "UNKNOWN");
  const crewColor = CREW_COLORS[crewStatus] || "rgb(var(--c-neutral))";
  const waterAllowed = !!rec?.water_allowed;
  const ai =
    manualAI && manualAI.assessed_revision >= (snapshot?.ai_assessment?.assessed_revision ?? 0)
      ? manualAI
      : snapshot?.ai_assessment || manualAI;
  const commErrors: any[] = Array.isArray(hw.communication_errors) ? hw.communication_errors : [];
  const activeSensorInfo = sensors[selectedSensor];
  const selectedSpark = hist
    .map((h: any) => h[selectedSensor])
    .filter((v: any) => typeof v === "number" && Number.isFinite(v));

  return (
    <div className="space-y-3">
      {/* Row 1: Scenario and simulation controls */}
      <div className="panel flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENARIOS.map((sc) => {
            const Icon = sc.icon;
            const on = isSim && pres.scenario === sc.id;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => void choosePreset(sc.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                  on ? "text-mist-100 shadow-glow" : "border-line bg-void-900/70 text-mist-400 hover:border-line-bright hover:text-mist-200"
                }`}
                style={
                  on
                    ? {
                        borderColor: `color-mix(in srgb, ${sc.color} 55%, transparent)`,
                        background: `color-mix(in srgb, ${sc.color} 12%, transparent)`,
                        color: sc.color,
                      }
                    : undefined
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span>
                  {sc.num}. {sc.title}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!isRunning ? (
            <button
              type="button"
              disabled={!isSim}
              onClick={() => void runCmd("/api/presentation/action", { action: isPaused ? "resume" : "start" })}
              className="btn !border-pulse-500/50 !bg-pulse-500/15 !text-pulse-400 !px-2.5 !py-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" /> {isPaused ? "Resume" : "Start"}
            </button>
          ) : (
            <button
              type="button"
              disabled={!isSim}
              onClick={() => void runCmd("/api/presentation/action", { action: "pause" })}
              className="btn !border-ember-500/60 !text-ember-300 !px-2.5 !py-1.5 text-xs"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          )}
          {isSim && fireState.ignition_vetoed && (
            <button
              type="button"
              onClick={() => void runCmd("/api/presentation/action", { action: "start" })}
              className="btn !border-ok-500/50 !bg-ok-500/10 !text-ok-400 !px-2.5 !py-1.5 text-xs"
              title="Re-attempt ignition (the armed guard will veto it again unless stood down)"
            >
              <Flame className="h-3.5 w-3.5" /> Attempt ignition
            </button>
          )}
          <button
            type="button"
            disabled={!isSim}
            onClick={() => void runCmd("/api/fire/stop")}
            className="btn !px-2.5 !py-1.5 text-xs"
            title="Stop fire"
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
          <button
            type="button"
            disabled={!isSim}
            onClick={() => void runCmd("/api/presentation/action", { action: "reset" })}
            className="btn !px-2.5 !py-1.5 text-xs"
            title="Reset scenario"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <div className="flex items-center rounded-lg border border-line bg-void-950 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!isSim}
                onClick={() => void runCmd("/api/fire/speed", { speed: s })}
                className={`rounded px-2 py-1 font-mono text-[10px] font-bold transition-all disabled:opacity-40 ${
                  cfg.speed === s ? "bg-ion-500/20 text-ion-300" : "text-mist-500 hover:text-mist-200"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="rounded-lg border border-flame-500/50 bg-flame-500/10 px-3 py-2 text-xs text-flame-400">{err}</div>}

      {/* Row 2: Unified 3-Column Mission Control Grid */}
      <div className="grid gap-3 xl:grid-cols-12 items-start">
        {/* LEFT COLUMN (5/12): 3D Arduino Digital Twin + Sensor Sliders / Live Serial */}
        <div className="space-y-3 xl:col-span-5">
          <ArduinoScene
            snapshot={snapshot}
            selected={selectedSensor}
            onSelect={setSelectedSensor}
            heightClass="h-[390px] min-h-[340px]"
          />

          <Panel
            title={isSim ? "Sensors — sliders & pin map" : "Live sensor readings"}
            icon={isSim ? <Sliders className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
            right={
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setTwinPanelTab("controls")}
                  className={`chip !px-2 !py-0.5 text-[10px] ${twinPanelTab === "controls" ? "!border-ion-400/60 !text-ion-300" : ""}`}
                >
                  {isSim ? "Sliders" : "Gateway"}
                </button>
                <button
                  type="button"
                  onClick={() => setTwinPanelTab("channels")}
                  className={`chip !px-2 !py-0.5 text-[10px] ${twinPanelTab === "channels" ? "!border-ion-400/60 !text-ion-300" : ""}`}
                >
                  Pin map
                </button>
              </div>
            }
          >
            {twinPanelTab === "channels" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SENSOR_SPECS.map((sp) => {
                  const r = sensors[sp.key];
                  const st = r?.status || "missing";
                  const c = SENSOR_STATUS_COLOR[st] || "rgb(var(--c-neutral))";
                  return (
                    <button
                      key={sp.key}
                      type="button"
                      onClick={() => setSelectedSensor(sp.key)}
                      className={`rounded-lg border p-2 text-left transition-all ${
                        selectedSensor === sp.key ? "border-ember-400/70 bg-ember-500/10" : "border-line bg-void-900/70"
                      }`}
                    >
                      <div className="flex justify-between text-[9px] text-mist-400">
                        <span>{sp.short}</span>
                        <span className="font-mono">{sp.pin}</span>
                      </div>
                      <div className="metric-num mt-0.5 text-xs font-bold text-mist-100">
                        {fmt(r?.value, sp.key)} <span className="text-[9px] font-normal text-mist-500">{sp.unit}</span>
                      </div>
                      <div className="text-[8px]" style={{ color: c }}>
                        {HUMAN_STATUS[st] || st}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : isSim ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-md border border-line bg-void-900/70 px-2.5 py-1.5 text-[11px]">
                  <span>
                    Viewing <strong className="text-ember-300">{activeSensorInfo?.label || selectedSensor}</strong>{" "}
                    <span className="font-mono text-ion-400">· pin {activeSensorInfo?.pin}</span>
                  </span>
                  <Badge color="rgb(var(--c-warn))">Simulated readings</Badge>
                </div>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {SENSOR_SPECS.map((sp) => {
                    const val = typeof sensors[sp.key]?.value === "number" ? sensors[sp.key].value : sp.min;
                    return (
                      <div key={sp.key} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <button
                            type="button"
                            onClick={() => setSelectedSensor(sp.key)}
                            className={`font-semibold ${selectedSensor === sp.key ? "text-ember-300" : "text-mist-300"}`}
                          >
                            {sp.short} <span className="font-mono text-mist-500">({sp.pin})</span>
                          </button>
                          <span className="metric-num font-semibold text-mist-100">
                            {fmt(val, sp.key)} {sp.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={sp.min}
                          max={sp.max}
                          step={sp.step}
                          value={Math.min(sp.max, Math.max(sp.min, val))}
                          onChange={(e) => {
                            setSelectedSensor(sp.key);
                            void patchSensors({ [sp.key]: parseFloat(e.target.value) }).catch((er) => setErr(er.message));
                          }}
                          className="w-full"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-line bg-void-900/70 p-2">
                    <div className="text-[9px] text-mist-500">Link status</div>
                    <div className="font-mono font-bold" style={{ color: hw.connected ? "rgb(var(--c-info))" : "rgb(var(--c-danger))" }}>
                      {String(hw.status || "disconnected")} · {hw.frequency_hz ?? 0} Hz
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-void-900/70 p-2">
                    <div className="text-[9px] text-mist-500">Last packet · errors</div>
                    <div className="truncate font-mono text-[10px] text-mist-300">
                      {hw.last_received_at ? hw.last_received_at.split("T")[1]?.slice(0, 8) + "Z" : "never"} · {commErrors.length} {commErrors.length === 1 ? "error" : "errors"}
                    </div>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-md border border-line bg-void-950 p-2.5 font-mono text-[10px] text-ion-300">{`python3 -m shunnoshikha.serial_gateway --list
python3 -m shunnoshikha.serial_gateway --port <PORT> --board "Arduino Uno"`}</pre>
                <p className="text-[10px] text-mist-400">
                  Readings that are missing, stale, or uncalibrated show &quot;—&quot; — nothing is invented. Controls stay locked while live hardware is connected.
                </p>
              </div>
            )}
          </Panel>
        </div>

        {/* CENTER COLUMN (4/12): Fire Spread Map, Simulation Config & Suppression Control */}
        <div className="space-y-3 xl:col-span-4">
          <Panel
            title="Station fire twin · 3D"
            icon={<Flame className="h-4 w-4" />}
            right={
              <div className="flex items-center gap-1.5">
                <Badge color={sevColor} pulse={isRunning}>
                  {sev}
                </Badge>
                {fireState.sim_time != null && (
                  <span className="metric-num text-[10px] text-mist-400">t={fireState.sim_time}s</span>
                )}
              </div>
            }
          >
            <StationScene
              snapshot={snapshot}
              pickMode={pickMode && editable}
              onPick={(id) => {
                void runCmd("/api/fire/config", { ignition: id });
                setPickMode(false);
              }}
            />

            {isSim && fireState.ignition_vetoed && (
              <div className="mt-3 rounded-lg border border-ok-500/50 bg-ok-500/10 px-3 py-2.5">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide text-ok-400">
                  <ShieldCheck className="h-4 w-4 shrink-0 animate-pulse" />
                  IGNITION VETOED BY PRE-IGNITION GUARD
                </div>
                <p className="mt-1 text-[10px] leading-snug text-mist-400">
                  The clock keeps ticking at t={fireState.sim_time}s while the armed guard quenches ignition attempts —
                  fire cannot start. Stand down prevention below to allow ignition, then press Start again.
                </p>
              </div>
            )}

            {isSim ? (
              <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="label !mb-1 !text-[9px]">Fire type</span>
                    <select
                      value={cfg.fire_type || "electrical"}
                      disabled={!editable}
                      onChange={(e) => void runCmd("/api/fire/config", { fire_type: e.target.value })}
                      className="input !py-1.5 text-xs disabled:opacity-50"
                    >
                      {Object.entries(scenarios?.fire_types || {}).map(([k, v]: [string, any]) => (
                        <option key={k} value={k}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="label !mb-1 !text-[9px]">Start the fire in</span>
                    <div className="flex gap-1">
                      <select
                        value={cfg.ignition || "USLAB"}
                        disabled={!editable}
                        onChange={(e) => void runCmd("/api/fire/config", { ignition: e.target.value })}
                        className="input flex-1 !py-1.5 text-xs disabled:opacity-50"
                      >
                        {(layout?.compartments || []).map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => setPickMode((p) => !p)}
                        className={`btn !px-2 !py-1.5 ${pickMode ? "!border-ember-500/60 !text-ember-300" : ""}`}
                        title="Pick the compartment on the map"
                      >
                        <Flame className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 flex justify-between text-[10px]">
                      <span className="text-mist-400">Fire intensity</span>
                      <span className="font-mono text-ember-400">{(cfg.initial_intensity ?? 0.35).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={cfg.initial_intensity ?? 0.35}
                      onChange={(e) => void runCmd("/api/fire/config", { initial_intensity: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[10px]">
                      <span className="text-mist-400">Spread speed</span>
                      <span className="font-mono text-ion-400">{(cfg.spread_multiplier ?? 1).toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={cfg.spread_multiplier ?? 1}
                      onChange={(e) => void runCmd("/api/fire/config", { spread_multiplier: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-[11px] text-ember-300">
                <span>Live mode is on — the fire-spread simulation is paused.</span>
                <button type="button" onClick={() => void setMode("simulation")} className="btn btn-primary !px-2.5 !py-1 text-[10px]">
                  Switch to simulation
                </button>
              </div>
            )}
          </Panel>

          {/* Autonomous Prevention — armed by default, fire cannot start */}
          <PreventionPanel snapshot={snapshot} command={command} editable={isSim} />

          {/* Suppression Control */}
          <Panel
            title="Suppress the fire"
            icon={<ShieldAlert className="h-4 w-4" />}
            right={
              <Badge color={isSim ? (fireState?.suppression?.active ? "rgb(var(--c-info))" : "rgb(var(--c-warn))") : "rgb(var(--c-danger))"}>
                {isSim ? (fireState?.suppression?.active ? "Active (simulated)" : "Ready (simulated)") : "Locked (live)"}
              </Badge>
            }
          >
            {rec && (
              <div className="mb-2.5 space-y-2">
                <div className="rounded-lg border border-ember-500/40 bg-ember-500/10 px-3 py-2">
                  <div className="text-[9px] font-semibold tracking-wide text-ember-400">
                    {rec.fire_name} · {rec.fire_class}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold text-mist-100">{rec.recommended_method}</div>
                </div>
                <div
                  className="rounded-lg border px-2.5 py-1.5 text-[10px] leading-snug"
                  style={{
                    borderColor: `color-mix(in srgb, ${waterAllowed ? "rgb(var(--c-ok))" : "rgb(var(--c-danger))"} 40%, transparent)`,
                    background: `color-mix(in srgb, ${waterAllowed ? "rgb(var(--c-ok))" : "rgb(var(--c-danger))"} 8%, transparent)`,
                    color: waterAllowed ? "rgb(var(--c-ok))" : "rgb(var(--c-danger))",
                  }}
                >
                  {waterAllowed ? <CheckCircle2 className="mr-1 inline h-3 w-3" /> : <Lock className="mr-1 inline h-3 w-3" />}
                  {rec.water_note}
                </div>
                {isSim && rec.water_compatible && (
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-void-900/70 px-2.5 py-1.5 text-[10px]">
                    <label className="flex cursor-pointer items-center gap-1.5 text-mist-200">
                      <input
                        type="checkbox"
                        checked={!!cfg.equipment_deenergized}
                        onChange={(e) => void runCmd("/api/fire/config", { equipment_deenergized: e.target.checked })}
                        className="accent-ion-400"
                      />
                      Equipment powered down
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-mist-200">
                      <input
                        type="checkbox"
                        checked={!!cfg.water_approved}
                        onChange={(e) => void runCmd("/api/fire/config", { water_approved: e.target.checked })}
                        className="accent-ion-400"
                      />
                      Water use approved
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {SUPPRESSION_ACTIONS.map((a) => {
                const Icon = a.icon;
                const disabled = !isSim || (a.water && !waterAllowed);
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => (a.confirm ? setPendingSup(a) : runSupAction(a))}
                    className="flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[10px] font-semibold transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      borderColor: `color-mix(in srgb, ${a.color} 38%, transparent)`,
                      background: `color-mix(in srgb, ${a.color} 10%, transparent)`,
                      color: a.color,
                    }}
                  >
                    {disabled ? <Lock className="h-3.5 w-3.5 shrink-0" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{a.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-ion-500/30 bg-ion-500/8 px-3 py-2.5">
              <div>
                <div className="text-[11px] font-semibold text-mist-100">Automatic fire response</div>
                <p className="mt-0.5 text-[10px] leading-4 text-mist-400">
                  When detection confirms smoke, heat, or flame, choose a compatible simulated response from the fire type and safety checks.
                </p>
              </div>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[10px] font-semibold text-mist-200">
                <input
                  type="checkbox"
                  checked={!!cfg.automatic_suppression_enabled}
                  onChange={(e) => void runCmd("/api/fire/config", { automatic_suppression_enabled: e.target.checked })}
                  disabled={!isSim}
                  className="h-4 w-4 accent-ion-400"
                />
                {cfg.automatic_suppression_enabled ? "On" : "Off"}
              </label>
            </div>

            {supMsg && <div className="mt-2 rounded border border-pulse-500/40 bg-pulse-500/10 px-2.5 py-1 text-[10px] text-pulse-300">{supMsg}</div>}
            {fireState?.command_acknowledgement && (
              <div className="mt-2 truncate rounded border border-line bg-void-950 px-2.5 py-1 font-mono text-[9px] text-mist-400">
                ACK {fireState.command_acknowledgement.id} · {fireState.command_acknowledgement.action}
              </div>
            )}
          </Panel>
        </div>

        {/* RIGHT COLUMN (3/12): Atmosphere, Crew Survival & AI Intelligence */}
        <div className="space-y-3 xl:col-span-3">
          {/* Atmospheric Monitoring */}
          <Panel
            title="Cabin atmosphere"
            icon={<Waves className="h-4 w-4" />}
            right={<Badge color={isSim ? "rgb(var(--c-warn))" : "rgb(var(--c-info))"}>{isSim ? "Simulated" : "Live"}</Badge>}
          >
            <div className="grid grid-cols-2 gap-1.5">
              {SENSOR_SPECS.map((sp) => {
                const r = sensors[sp.key];
                const val = r?.value;
                const band = crew?.species_status?.[sp.key];
                const bandColor =
                  band === "CRITICAL"
                    ? "rgb(var(--c-danger))"
                    : band === "WARNING"
                    ? "rgb(var(--c-warn2))"
                    : band === "CAUTION"
                    ? "rgb(var(--c-warn))"
                    : typeof val === "number"
                    ? SPECIES_COLORS[sp.key] || "rgb(var(--c-info))"
                    : "rgb(var(--c-neutral))";
                return (
                  <button
                    key={sp.key}
                    type="button"
                    onClick={() => setSelectedSensor(sp.key)}
                    className={`rounded-lg border px-2.5 py-1.5 text-left transition-all ${
                      selectedSensor === sp.key ? "border-ember-400/70 bg-ember-500/10" : "border-line bg-void-900/70"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[9px] text-mist-400">
                      <span>{sp.short}</span>
                      <span style={{ color: bandColor }}>{band ? band.toLowerCase() : HUMAN_STATUS[r?.status || ""] || "—"}</span>
                    </div>
                    <div className="metric-num text-sm font-bold" style={{ color: bandColor }}>
                      {fmt(val, sp.key)} <span className="text-[9px] font-normal text-mist-500">{sp.unit}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedSpark.length > 1 && (
              <div className="mt-2.5 rounded-lg border border-line bg-void-900/60 p-2">
                <div className="mb-1 flex justify-between text-[9px] text-mist-400">
                  <span>{activeSensorInfo?.label || selectedSensor} — recent trend</span>
                  <span className="font-mono">{selectedSpark.length} samples</span>
                </div>
                <Sparkline data={selectedSpark} color={SPECIES_COLORS[selectedSensor] || "rgb(var(--c-info))"} height={34} />
              </div>
            )}
          </Panel>

          {/* Astronaut Survival Analysis */}
          <Panel
            title="Crew wellbeing"
            icon={<HeartPulse className="h-4 w-4" />}
            right={<Badge color={crewColor}>{crewStatus === "UNKNOWN" ? "Checking…" : crewStatus.toLowerCase()}</Badge>}
          >
            <div className="flex items-baseline justify-between rounded-lg border px-3 py-2" style={{ borderColor: `color-mix(in srgb, ${crewColor} 38%, transparent)`, background: `color-mix(in srgb, ${crewColor} 8%, transparent)` }}>
              <div>
                <div className="text-[9px] text-mist-400">Habitability · urgency</div>
                <div className="text-xs font-bold text-mist-100">
                  {crew.habitability || "Unknown"} · {crew.evacuation_urgency || "Verify"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-mist-400">Time to critical</div>
                <div className="metric-num text-lg font-bold" style={{ color: crewColor }}>
                  {crew.time_to_critical_s != null ? `${crew.time_to_critical_s}s` : "—"}
                </div>
              </div>
            </div>
            <div className="mt-2.5 space-y-1.5">
              <Bar label="Oxygen risk" value={crew?.risks?.oxygen ?? 0} max={1} color="rgb(var(--c-sp-o2))" />
              <Bar label="CO gas risk" value={crew?.risks?.toxic_gas ?? 0} max={1} color="rgb(var(--c-sp-co))" />
              <Bar label="CO₂ risk" value={crew?.risks?.co2 ?? 0} max={1} color="rgb(var(--c-sp-co2))" />
              <Bar label="Heat risk" value={crew?.risks?.heat ?? 0} max={1} color="rgb(var(--c-sp-temp))" />
              <Bar label="Smoke risk" value={crew?.risks?.smoke ?? 0} max={1} color="rgb(var(--c-sp-smoke))" />
            </div>
            <p className="mt-2 text-[10px] leading-snug text-mist-400">{crew.explanation}</p>
            <p className="mt-1 text-[9px] leading-snug text-flame-400/90">
              An environmental estimate — not a medical or personal survival prediction.
            </p>
          </Panel>

          {/* AI Emergency Intelligence */}
          <Panel
            title="AI situation briefing"
            icon={<BrainCircuit className="h-4 w-4" />}
            right={
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setAiRaw((v) => !v)} className="btn !px-1.5 !py-1 text-[10px]" title={aiRaw ? "Show the readable summary" : "Show raw data"}>
                  <Code2 className="h-3 w-3" />
                </button>
                <button type="button" onClick={refreshAI} disabled={aiBusy} className="btn btn-primary !px-2 !py-1 text-[10px]">
                  <RefreshCw className={`h-3 w-3 ${aiBusy ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>
            }
          >
            {ai ? (
              aiRaw ? (
                <pre className="max-h-56 overflow-auto rounded border border-line bg-void-950 p-2 font-mono text-[9px] text-ion-300">
                  {JSON.stringify(ai, null, 2)}
                </pre>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge color={ai.data_source === "LIVE_HARDWARE" ? "rgb(var(--c-info))" : "rgb(var(--c-warn))"}>
                      {ai.data_source === "LIVE_HARDWARE" ? "Live hardware" : "Simulated"}
                    </Badge>
                    <Badge color={ai.mode?.includes("LLM") ? "rgb(var(--c-ok))" : "rgb(var(--c-neutral))"}>
                      {ai.mode?.includes("LLM") ? "AI model" : "Built-in rules"}
                    </Badge>
                  </div>
                  <p className="leading-relaxed text-mist-200">{ai.situation_summary}</p>
                  <div className="rounded-md border border-line bg-void-900/70 p-2 text-[11px] text-mist-300">
                    <div className="mb-1 text-[9px] font-semibold tracking-wide text-ember-400">Suggested next steps</div>
                    <ul className="space-y-1">
                      {(ai.recommended_response || []).slice(0, 3).map((r: string, idx: number) => (
                        <li key={idx} className="flex gap-1.5">
                          <span className="text-ember-400">▸</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            ) : (
              <div className="py-3 text-xs text-mist-500">Putting together a briefing…</div>
            )}

            {/* Inline Quick Ask (AI Chat + NASA RAG right on the 50s screen) */}
            <div className="mt-3 border-t border-line pt-2.5 space-y-2">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => void askInlineCopilot("What is the current cabin telemetry risk?")}
                  className="chip !px-2 !py-0.5 text-[9px] hover:border-ember-400/60"
                >
                  How risky is the cabin now?
                </button>
                <button
                  type="button"
                  onClick={() => void askInlineCopilot("What does NASA BASS-II say about low-flow extinction?")}
                  className="chip !px-2 !py-0.5 text-[9px] hover:border-ion-400/60"
                >
                  What does NASA research say?
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void askInlineCopilot();
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={quickAsk}
                  onChange={(e) => setQuickAsk(e.target.value)}
                  placeholder="Ask the AI anything…"
                  className="input flex-1 !py-1 !px-2 text-[11px]"
                />
                <button type="submit" disabled={quickBusy || !quickAsk.trim()} className="btn btn-ion !px-2.5 !py-1 text-[10px]">
                  {quickBusy ? "…" : "Ask"}
                </button>
              </form>
              {quickAns && (
                <div className="max-h-36 overflow-y-auto rounded-lg border border-ion-500/30 bg-void-950 p-2 text-[11px]">
                  <div className="mb-1 text-[9px] font-bold text-ion-300">{quickAns.agent || "AI assistant"}</div>
                  <Markdown>{quickAns.text}</Markdown>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── 3D Combustion Science Lab ─────────────────────────────────────── */}
      <div className="panel px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ion-500/40 bg-ion-500/10 text-ion-300">
              <Waves className="h-4 w-4" />
            </span>
            <div>
              <div className="font-display text-sm font-bold text-mist-100">Microgravity combustion science · 3D</div>
              <div className="text-[10px] text-mist-500">Physics-grounded digital twin of NASA PSI flammability — drag to orbit, scroll to zoom</div>
            </div>
          </div>
          <Badge color="rgb(var(--c-info))">Live digital twin</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel
          title="Flammability boundary manifold"
          icon={<Waves className="h-4 w-4" />}
          right={<Badge color="rgb(var(--c-warn))">U-shaped envelope</Badge>}
        >
          <BoundaryScene />
        </Panel>
        <Panel
          title="Single-sample flame chamber"
          icon={<Flame className="h-4 w-4" />}
          right={<Badge color="rgb(var(--c-warn))">0 g diffusion flame</Badge>}
        >
          <FlameChamber />
        </Panel>
      </div>

      <Panel
        title="PSI investigation galaxy · rank & compare"
        icon={<Radio className="h-4 w-4" />}
        right={<Badge color="rgb(var(--c-info))">401 harmonized records · 13 studies</Badge>}
      >
        <InvestigationGalaxy />
      </Panel>

      <Panel
        title="Earth spin-offs · terrestrial impact"
        icon={<Leaf className="h-4 w-4" />}
        right={<Badge color="rgb(var(--c-ok))">From orbit to everyday life</Badge>}
      >
        <div className="grid gap-2.5 md:grid-cols-3">
          {[
            {
              study: "FLEX / FLEX-2 · CIR+MDCA",
              finding: "Microgravity droplet combustion revealed cool-flame chemistry and how fine droplets absorb heat and dilute fuel vapor (CO₂/He diluent studies).",
              spinoff: "Fine-water-mist extinguishers",
              detail: "Mist droplets mimic the heat-sink physics FLEX measured — suppressing flames with a fraction of the water, less damage than sprinklers.",
              color: "rgb(var(--c-info))",
            },
            {
              study: "SAME / SAME-R / DAFT · MSG",
              finding: "Smoke detectors tested in orbit had to tell real fire smoke from floating dust — the same detector hardware flew on to study lunar dust interference.",
              spinoff: "Dual-wavelength dust-immune smoke detectors",
              detail: "Two-wavelength scattering discrimination born for spacecraft now cuts nuisance alarms in homes, aircraft and dusty industrial sites.",
              color: "rgb(var(--c-ok))",
            },
            {
              study: "Saffire I–VI · Cygnus",
              finding: "Large-scale uncrewed spacecraft fires mapped how materials ignite, spread and self-extinguish in flow, informing flammability limits for cabin fabrics.",
              spinoff: "Thermal firefighter gear",
              detail: "Flame-resistant textile data and heat-flux models feed better turnout gear, fire blankets and protective fabrics for firefighters on Earth.",
              color: "rgb(var(--c-warn2))",
            },
          ].map((s) => (
            <div key={s.study} className="rounded-xl border border-line bg-void-900/60 p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: s.color }}>{s.study}</div>
              <p className="mt-1.5 text-[10px] leading-snug text-mist-400">{s.finding}</p>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-mist-100">
                <span className="text-mist-500">→</span> {s.spinoff}
              </div>
              <p className="mt-1 text-[9px] leading-snug text-mist-500">{s.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-snug text-mist-500">
          Spin-off links are illustrative summaries of NASA PSI technology-transfer narratives — not product endorsements.
        </p>
      </Panel>

      <ConfirmDialog
        open={!!pendingSup}
        danger
        title={pendingSup?.label || ""}
        confirmLabel="Run it (simulated)"
        message={`Run "${pendingSup?.label || "this action"}" as a simulation for ${rec?.fire_name || "the current situation"}? Nothing touches real hardware.`}
        warning={pendingSup?.water ? "Water compatibility and safety interlocks were checked."
          : pendingSup?.dilution ? "Dilution displaces breathable O₂ — crew must be on PBA. Based on FLEX / FLEX-2 CO₂/He diluent studies (illustrative)."
          : rec?.warnings?.[0]}
        onConfirm={() => runSupAction(pendingSup)}
        onCancel={() => setPendingSup(null)}
      />

      <ConfirmDialog
        open={confirmPreset5}
        title="Run the suppression demo?"
        confirmLabel="Start the demo (simulated)"
        message="Scenario 5 starts an electrical fire and automatically releases the simulated suppressant about 15 seconds in. Everything is simulated — start it?"
        onConfirm={() => void confirmAndRunPreset5()}
        onCancel={() => setConfirmPreset5(false)}
      />
    </div>
  );
}
