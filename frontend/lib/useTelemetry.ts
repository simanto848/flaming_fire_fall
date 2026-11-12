"use client";

import { useMemo } from "react";
import { useSensors } from "./sensors";

export interface TelemetryFrame {
  revision: number;
  mode: "live" | "simulation";
  data_source: string;
  telemetry: {
    o2_concentration_pct: number | null;
    airflow_velocity_cms: number | null;
    cabin_pressure_psi: number | null;
    cabin_temp_C: number | null;
    co_ppm: number | null;
    co2_ppm: number | null;
    humidity_pct: number | null;
    smoke_mgm3: number | null;
    smoke_obscuration_pct_m: number | null;
  };
  sensor_health: Record<string, any>;
  scenario: string;
  scenario_name: string;
  device_id: string;
  timestamp: string;
  digital_twin: {
    regime: string;
    probabilities: Record<string, number>;
    flame_temp_C: number | null;
    damkohler_proxy: number | null;
  };
  safety: {
    safety_tier: string;
    status_color: string;
    severity_score: number | null;
    rule_violations: string[];
    hvac_suppression_action: string;
    action_code: string;
    crew_emergency_protocol: string;
  };
}

export function useTelemetry(historyLen = 60) {
  const { snapshot, connected } = useSensors();
  const frame = (snapshot?.telemetry_frame || null) as TelemetryFrame | null;
  const history = useMemo(
    () =>
      (snapshot?.history || []).slice(-historyLen).map((h: any) => ({
        ...frame,
        timestamp: h.timestamp,
        telemetry: {
          o2_concentration_pct: h.o2_pct ?? null,
          airflow_velocity_cms: h.airflow_cms ?? null,
          cabin_pressure_psi: h.pressure_kpa == null ? null : h.pressure_kpa / 6.894757293,
          cabin_temp_C: h.temp_C ?? null,
          co_ppm: h.co_ppm ?? null,
          co2_ppm: h.co2_ppm ?? null,
          humidity_pct: h.humidity_pct ?? null,
          smoke_mgm3: h.smoke_mgm3 ?? null,
          smoke_obscuration_pct_m: h.smoke_mgm3 ?? null,
        },
      })) as TelemetryFrame[],
    [snapshot?.history, frame, historyLen]
  );
  const series = (key: keyof TelemetryFrame["telemetry"]) =>
    history.map((h) => h.telemetry[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return { snapshot, frame, history, connected, series };
}
