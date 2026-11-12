export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws/telemetry";

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
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<any>("/api/health"),
  aiStatus: () => req<any>("/api/ai/status"),
  agents: () => req<any>("/api/agents"),
  // metadata
  metadataSummary: () => req<any>("/api/metadata/summary"),
  metadataRecords: (investigation?: string) =>
    req<any>("/api/metadata/records" + (investigation ? `?investigation=${investigation}` : "")),
  metadataAnomalies: () => req<any>("/api/metadata/anomalies"),
  metadataCatalog: () => req<any>("/api/metadata/catalog"),
  rank: (body: any) => req<any>("/api/metadata/rank", { method: "POST", body: JSON.stringify(body) }),
  psiInvestigations: () => req<any>("/api/psi/investigations"),
  // digital twin
  twinEvaluate: (body: any) => req<any>("/api/digital-twin/evaluate", { method: "POST", body: JSON.stringify(body) }),
  boundarySurface: (material: string, pressure: number, n = 28) =>
    req<any>(`/api/digital-twin/boundary-surface?material=${encodeURIComponent(material)}&pressure_psi=${pressure}&n_points=${n}`),
  atmospheres: () => req<any>("/api/digital-twin/exploration-atmospheres"),
  trajectory: (body: any) => req<any>("/api/digital-twin/trajectory", { method: "POST", body: JSON.stringify(body) }),
  // ml
  predictShap: (body: any) => req<any>("/api/ml/predict-shap", { method: "POST", body: JSON.stringify(body) }),
  // vision
  sampleFrame: (n = 1) => req<any>(`/api/vision/sample-frame?frame_num=${n}`),
  visionFrame: (n: number) => req<any>(`/api/vision/analyze?frame_num=${n}`, { method: "POST" }),
  visionDescribe: (body: any) => req<any>("/api/vision/describe", { method: "POST", body: JSON.stringify(body) }),
  // agents + rag
  chat: (body: any) => req<any>("/api/agent/chat", { method: "POST", body: JSON.stringify(body) }),
  ragLive: (body: any) => req<any>("/api/rag/live-search", { method: "POST", body: JSON.stringify(body) }),
  ragAsk: (body: any) => req<any>("/api/rag/ask", { method: "POST", body: JSON.stringify(body) }),
  ragStatus: () => req<any>("/api/rag/status"),
  ragArchive: (body: any) => req<any>("/api/rag/archive-search", { method: "POST", body: JSON.stringify(body) }),
  // hypotheses
  hypotheses: () => req<any>("/api/hypothesis/list"),
  voids: () => req<any>("/api/hypothesis/voids"),
  designHypothesis: (void_id: string) =>
    req<any>("/api/hypothesis/design", { method: "POST", body: JSON.stringify({ void_id }) }),
  // telemetry
  scenarios: () => req<any>("/api/telemetry/scenarios"),
  setScenario: (scenario_key: string) =>
    req<any>("/api/telemetry/set-scenario", { method: "POST", body: JSON.stringify({ scenario_key }) }),
  telemetryPacket: () => req<any>("/api/telemetry/packet"),
  firmware: (board: "uno" | "esp32" = "uno") => req<any>(`/api/telemetry/arduino-firmware?board=${board}`),
  // early warning
  safetyLimits: () => req<any>("/api/early-warning/limits"),
  hvacSuppress: (action_code: string, confirmed = false) =>
    req<any>("/api/early-warning/hvac-suppress", { method: "POST", body: JSON.stringify({ action_code, confirmed }) }),
  // centralized sensors & presentation
  sensorSchema: () => req<any>("/api/sensors/schema"),
};

export async function uploadFile<T>(path: string, file: File | Blob, filename = "upload.wav"): Promise<T> {
  const form = new FormData();
  form.append("file", file, filename);
  const res = await fetch(API_URL + path, { method: "POST", body: form });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function fileToB64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export const REGIME_COLORS: Record<string, string> = {
  "Sustained Burn": "#f59e0b",
  "Radiative Extinction": "#22d3ee",
  Blowoff: "#e879f9",
};

export const TIER_COLORS: Record<string, string> = {
  NORMAL: "rgb(var(--c-ok))",
  CAUTION: "rgb(var(--c-warn))",
  WARNING: "rgb(var(--c-warn2))",
  CRITICAL: "rgb(var(--c-danger))",
  UNKNOWN: "rgb(var(--c-neutral))",
};