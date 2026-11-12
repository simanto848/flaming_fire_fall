"use client";

import { useSensors } from "./sensors";
import { API_URL } from "./api";

/** Accent colors resolve to the light and calm theme variables. */
export const SEVERITY_COLORS: Record<string, string> = {
  Normal: "rgb(var(--c-ok))",
  Warning: "rgb(var(--c-warn))",
  Critical: "rgb(var(--c-warn2))",
  Extreme: "rgb(var(--c-danger))",
  Unknown: "rgb(var(--c-neutral))",
};
export const CREW_COLORS: Record<string, string> = {
  SAFE: "rgb(var(--c-ok))",
  CAUTION: "rgb(var(--c-warn))",
  DANGER: "rgb(var(--c-warn2))",
  CRITICAL: "rgb(var(--c-danger))",
  UNKNOWN: "rgb(var(--c-neutral))",
};
export const SPECIES_COLORS: Record<string, string> = {
  o2_pct: "rgb(var(--c-sp-o2))",
  co_ppm: "rgb(var(--c-sp-co))",
  co2_ppm: "rgb(var(--c-sp-co2))",
  temp_C: "rgb(var(--c-sp-temp))",
  humidity_pct: "rgb(var(--c-sp-humidity))",
  smoke_mgm3: "rgb(var(--c-sp-smoke))",
  pressure_kpa: "rgb(var(--c-sp-pressure))",
};

export function intensityColor(i: number): string {
  if (i < 0.02) return "rgb(var(--c-map-room))";
  if (i < 0.25) return "rgb(var(--c-warn))";
  if (i < 0.5) return "rgb(var(--c-warn2))";
  if (i < 0.75) return "rgb(var(--c-danger))";
  return "rgb(var(--c-nova-500))";
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    });
  } catch {
    throw new Error(`Backend unavailable. Start the safety service at ${API_URL}.`);
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail || msg);
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const fireApi = {
  layout: () => req<any>("/api/fire/layout"),
  scenarios: () => req<any>("/api/fire/scenarios"),
  state: () => req<any>("/api/fire/state"),
  config: (b: any) => req<any>("/api/fire/config", { method: "POST", body: JSON.stringify(b) }),
  start: () => req<any>("/api/fire/start", { method: "POST" }),
  pause: () => req<any>("/api/fire/pause", { method: "POST" }),
  stop: () => req<any>("/api/fire/stop", { method: "POST" }),
  reset: () => req<any>("/api/fire/reset", { method: "POST" }),
  speed: (speed: number) => req<any>("/api/fire/speed", { method: "POST", body: JSON.stringify({ speed }) }),
  recommendation: () => req<any>("/api/fire/suppression/recommendation"),
  suppress: (action: string, confirmed: boolean) =>
    req<any>("/api/fire/suppression", { method: "POST", body: JSON.stringify({ action, confirmed }) }),
  thresholds: () => req<any>("/api/fire/thresholds"),
  setThresholds: (t: any) => req<any>("/api/fire/thresholds", { method: "POST", body: JSON.stringify({ thresholds: t }) }),
  crew: () => req<any>("/api/fire/crew"),
  aiAssessment: () => req<any>("/api/fire/ai-assessment", { method: "POST" }),
  events: () => req<any>("/api/fire/events"),
  report: (format: "json" | "md") => req<any>(`/api/fire/report?format=${format}`),
  presentationSelect: (scenario: string, confirmed = false) =>
    req<any>("/api/presentation/select", { method: "POST", body: JSON.stringify({ scenario, confirmed }) }),
  presentationAction: (action: "start" | "pause" | "resume" | "reset") =>
    req<any>("/api/presentation/action", { method: "POST", body: JSON.stringify({ action }) }),
};

/** Centralized subscription: reads from SensorProvider (/ws/sensors) so there is a single source of truth. */
export function useFireSim() {
  const { snapshot, connected, refresh } = useSensors();
  return {
    state: snapshot?.fire_state || null,
    snapshot,
    connected,
    refresh: () => {
      void refresh();
    },
  };
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
