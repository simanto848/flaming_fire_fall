"use client";

import React, { useState } from "react";
import { Flame, Radio, CircuitBoard, Layers, FileText, Bot, Sun, Leaf } from "lucide-react";
import { useTelemetry } from "@/lib/useTelemetry";
import { useSensors } from "@/lib/sensors";
import { TIER_COLORS } from "@/lib/api";
import { useTheme, type ThemeName } from "@/lib/theme";
import UnifiedTwinDashboard from "@/components/UnifiedTwinDashboard";
import AICopilotAndRag from "@/components/AICopilotAndRag";
import ReportsAndHardware from "@/components/ReportsAndHardware";

/** Tier codes → words a person would actually say. */
const TIER_LABELS: Record<string, string> = {
  NORMAL: "All clear",
  CAUTION: "Caution",
  WARNING: "Warning",
  CRITICAL: "Critical",
  UNKNOWN: "Checking…",
};

const THEME_OPTIONS: { id: ThemeName; icon: React.ElementType; label: string; hint: string }[] = [
  { id: "calm", icon: Leaf, label: "Calm", hint: "Calm evening — soft, muted, easy on the eyes" },
  { id: "light", icon: Sun, label: "White", hint: "Clean white — bright and crisp" },
];

type TabView = "twin" | "ai" | "reports";

const TAB_ALIASES: Record<string, TabView> = {
  twin: "twin",
  overview: "twin",
  live: "twin",
  ai: "ai",
  assistant: "ai",
  copilot: "ai",
  rag: "ai",
  reports: "reports",
  hardware: "reports",
};

export default function Home() {
  const [view, setView] = useState<TabView>("twin");

  // Synchronize active tab from URL query param (?tab=...) or localStorage on mount
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paramTab = params.get("tab")?.toLowerCase();
    const hashTab = window.location.hash.replace(/^#/, "").toLowerCase();
    const storedTab = localStorage.getItem("shunnoshikha_active_tab")?.toLowerCase();

    const resolved =
      (paramTab && TAB_ALIASES[paramTab]) ||
      (hashTab && TAB_ALIASES[hashTab]) ||
      (storedTab && TAB_ALIASES[storedTab]);

    if (resolved) {
      setView(resolved);
      if (paramTab !== resolved) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", resolved);
        window.history.replaceState(null, "", url.toString());
      }
    }

    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const t = p.get("tab")?.toLowerCase();
      if (t && TAB_ALIASES[t]) {
        setView(TAB_ALIASES[t]);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const changeTab = (newTab: TabView) => {
    setView(newTab);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("shunnoshikha_active_tab", newTab);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", newTab);
        window.history.replaceState(null, "", url.toString());
      } catch {
        // ignore
      }
    }
  };

  const { snapshot, setMode, error: sensorError } = useSensors();
  const { frame, connected } = useTelemetry(60);
  const { theme, setTheme } = useTheme();

  const isSim = snapshot?.mode !== "live";
  const hw = snapshot?.hardware || {};
  const fireState = snapshot?.fire_state || {};
  const tier = frame?.safety?.safety_tier || (isSim ? "NORMAL" : "UNKNOWN");
  const tierColor = TIER_COLORS[tier] || "rgb(var(--c-neutral))";
  const commErrorCount = Array.isArray(hw.communication_errors) ? hw.communication_errors.length : 0;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Compact Mission Control Top Bar */}
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-2.5 border-b border-line bg-void-900/90 px-4 py-2.5 backdrop-blur-xl lg:px-6">
        <div className="flex items-center gap-2.5 mr-2">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-ember-600 to-flame-600 shadow-glow">
            <Flame className="h-5 w-5 text-void-950" />
          </div>
          <div>
            <div className="font-display text-sm font-extrabold tracking-wide text-mist-100">
              SHUNNO<span className="text-ember-400">SHIKHA</span>
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-mist-500">
              Fire safety mission control
            </div>
          </div>
        </div>

        {/* 3 Simple Views */}
        <div className="flex items-center gap-1 rounded-lg border border-line bg-void-950 p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => changeTab("twin")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
              view === "twin" ? "bg-ember-500/20 text-ember-300 border border-ember-500/40" : "text-mist-400 hover:text-mist-200"
            }`}
          >
            <Layers className="h-3.5 w-3.5" /> Live overview
          </button>
          <button
            type="button"
            onClick={() => changeTab("ai")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
              view === "ai" ? "bg-nova-500/20 text-nova-400 border border-nova-500/40" : "text-mist-400 hover:text-mist-200"
            }`}
          >
            <Bot className="h-3.5 w-3.5" /> Mission assistant
          </button>
          <button
            type="button"
            onClick={() => changeTab("reports")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all ${
              view === "reports" ? "bg-ion-500/20 text-ion-300 border border-ion-500/40" : "text-mist-400 hover:text-mist-200"
            }`}
          >
            <FileText className="h-3.5 w-3.5" /> Reports &amp; hardware
          </button>
        </div>

        {/* Status & Mode Indicators */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-line bg-void-950 p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => void setMode("simulation")}
              className={`rounded-full px-2.5 py-1 transition-all ${
                isSim ? "bg-ember-500/20 text-ember-300" : "text-mist-500 hover:text-mist-300"
              }`}
            >
              Simulation
            </button>
            <button
              type="button"
              onClick={() => void setMode("live")}
              className={`rounded-full px-2.5 py-1 transition-all ${
                !isSim ? "bg-ion-500/20 text-ion-300" : "text-mist-500 hover:text-mist-300"
              }`}
            >
              Live hardware
            </button>
          </div>

          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
              isSim
                ? "border-ember-500/40 bg-ember-500/10 text-ember-300"
                : hw.connected
                ? "border-ion-500/40 bg-ion-500/10 text-ion-300"
                : "border-flame-500/40 bg-flame-500/10 text-flame-400"
            }`}
          >
            <CircuitBoard className="h-3 w-3" />
            <span className="hidden sm:inline">
              {isSim
                ? "Arduino · simulated"
                : hw.connected
                ? `Arduino live · ${hw.frequency_hz ?? 0} Hz`
                : `Arduino · ${String(hw.status || "offline")}`}
            </span>
          </span>

          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] font-semibold text-mist-300 md:flex">
            <Radio className={`h-3 w-3 ${connected ? "text-pulse-400" : "text-flame-500"}`} />
            {connected
              ? commErrorCount > 0
                ? `Telemetry link · ${commErrorCount} ${commErrorCount === 1 ? "error" : "errors"}`
                : "Telemetry link healthy"
              : "No telemetry link"}
          </span>

          <span
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
            style={{
              borderColor: `color-mix(in srgb, ${tierColor} 40%, transparent)`,
              color: tierColor,
              background: `color-mix(in srgb, ${tierColor} 10%, transparent)`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full animate-pulse-dot" style={{ background: tierColor }} />
            {TIER_LABELS[tier] || tier}
            {(fireState.detected || fireState.possible_fire) && <span className="text-flame-400">· fire detected</span>}
          </span>

          {/* Theme switcher */}
          <div
            className="flex items-center gap-0.5 rounded-full border border-line bg-void-950 p-0.5"
            role="group"
            aria-label="Choose a colour theme"
          >
            {THEME_OPTIONS.map((t) => {
              const Icon = t.icon;
              const on = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  aria-label={t.label}
                  aria-pressed={on}
                  onClick={() => setTheme(t.id)}
                  className={`group flex h-7 items-center justify-center gap-1.5 rounded-full px-2 transition-all ${
                    on
                        ? "bg-ember-500/15 text-ember-300 shadow-glow"
                      : "text-mist-500 hover:text-mist-200"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                    <span className="hidden text-[10px] font-semibold sm:inline">{t.label}</span>
                  </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1680px] flex-1 p-3 lg:p-4">
        {sensorError && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-flame-500/40 bg-flame-500/10 px-3 py-2 text-xs text-flame-400">
            <span>{sensorError}</span>
            <button type="button" className="btn !px-2.5 !py-1 text-[10px]" onClick={() => window.location.reload()}>
              Retry connection
            </button>
          </div>
        )}
        <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-line bg-void-900/65 px-4 py-4 shadow-panel backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-ember-400">Flight safety workspace</p>
            <h1 className="font-display text-lg font-semibold tracking-tight text-mist-100 sm:text-xl">
              {view === "twin" ? "Understand the cabin at a glance" : view === "ai" ? "Ask, investigate, and learn" : "Prepare the mission with confidence"}
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-mist-400">
              {view === "twin"
                ? "A calm view of the spacecraft environment, crew safety, and fire response."
                : view === "ai"
                ? "Get grounded answers from the live twin, NASA research, and the onboard safety models."
                : "Review incident records, connect hardware, and keep the next response ready."}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border border-line bg-void-950/60 px-3 py-2 sm:self-center">
            <span className="h-2 w-2 rounded-full bg-pulse-400 shadow-[0_0_10px_rgb(var(--c-pulse-400)/0.55)]" />
            <div>
              <div className="text-[10px] font-semibold text-mist-200">{TIER_LABELS[tier] || "Checking status"}</div>
              <div className="text-[10px] text-mist-500">{isSim ? "Simulation mode" : "Live hardware"}</div>
            </div>
          </div>
        </section>
        {view === "twin" && <UnifiedTwinDashboard />}
        {view === "ai" && <AICopilotAndRag />}
        {view === "reports" && <ReportsAndHardware />}
      </main>
    </div>
  );
}
