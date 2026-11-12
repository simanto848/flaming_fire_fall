"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

export async function sensorRequest(path: string, payload?: unknown) {
  let res: Response;
  try {
    res = await fetch(
      API_URL + path,
      payload === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
    );
  } catch {
    throw new Error(`Backend unavailable. Start the safety service at ${API_URL}.`);
  }
  const body = await res.json();
  if (!res.ok) {
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body));
  }
  return body;
}

type SensorContextValue = {
  snapshot: any;
  connected: boolean;
  error: string;
  refresh: () => Promise<void>;
  command: (path: string, body?: unknown) => Promise<any>;
  setMode: (mode: "simulation" | "live") => Promise<any>;
  patchSensors: (sensors: Record<string, number>) => Promise<any>;
};

const Context = createContext<SensorContextValue | null>(null);

export function SensorProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const lastMessage = useRef(Date.now());

  const accept = useCallback((s: any) => {
    if (!s || !s.sensors || !s.fire_state) return;
    lastMessage.current = Date.now();
    setSnapshot((prev: any) => (!prev || s.revision >= prev.revision || s.mode !== prev.mode ? s : prev));
    setError("");
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await sensorRequest("/api/sensors/state"));
    } catch (e: any) {
      setError(e?.message || "Unable to reach sensor backend");
    }
  }, [accept]);

  const command = useCallback(
    async (path: string, body: unknown = {}) => {
      const result = await sensorRequest(path, body);
      if (result && result.sensors && result.fire_state) {
        accept(result);
      } else {
        await refresh();
      }
      return result;
    },
    [accept, refresh]
  );

  const setMode = useCallback(
    (mode: "simulation" | "live") => command("/api/sensors/mode", { mode }),
    [command]
  );

  const patchSensors = useCallback(
    (sensors: Record<string, number>) => command("/api/sensors/simulation", { sensors }),
    [command]
  );

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let polling = false;

    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket(API_URL.replace(/^http/, "ws") + "/ws/sensors");
      } catch {
        if (alive) {
          setConnected(false);
          retry = setTimeout(connect, 2500);
        }
        return;
      }
      ws.onopen = () => {
        if (alive) setConnected(true);
      };
      ws.onmessage = (event) => {
        if (!alive) return;
        try {
          accept(JSON.parse(event.data));
        } catch {
          setError("Invalid sensor stream packet");
        }
      };
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        if (!alive) return;
        setConnected(false);
        retry = setTimeout(connect, 2500);
      };
    };

    const boot = setTimeout(connect, 0);
    void refresh();

    const fallback = setInterval(async () => {
      if (Date.now() - lastMessage.current > 5000) {
        setSnapshot((s: any) =>
          s?.mode === "live"
            ? {
                ...s,
                hardware: { ...s.hardware, connected: false, status: "stale" },
                sensors: Object.fromEntries(
                  Object.entries(s.sensors).map(([k, r]: [string, any]) => [k, { ...r, value: null, status: "stale" }])
                ),
                telemetry_frame: null,
                fire_state: {
                  ...s.fire_state,
                  atmosphere: Object.fromEntries(Object.keys(s.fire_state.atmosphere).map((k) => [k, null])),
                  crew: {
                    ...s.crew,
                    status: "UNKNOWN",
                    habitability: "UNKNOWN",
                    explanation: "Backend stream unavailable; readings withheld.",
                  },
                },
              }
            : s
        );
      }
      if (ws?.readyState !== WebSocket.OPEN && !polling) {
        polling = true;
        try {
          await refresh();
        } catch {
          // error state already handled inside refresh
        } finally {
          polling = false;
        }
      }
    }, 1500);

    return () => {
      alive = false;
      clearTimeout(boot);
      clearTimeout(retry);
      clearInterval(fallback);
      ws?.close();
    };
  }, [accept, refresh]);

  return (
    <Context.Provider value={{ snapshot, connected, error, refresh, command, setMode, patchSensors }}>
      {children}
    </Context.Provider>
  );
}

export function useSensors() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("SensorProvider is required");
  return ctx;
}
