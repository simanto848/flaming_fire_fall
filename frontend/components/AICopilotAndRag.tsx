"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Globe,
  Send,
  Sparkles,
  Search,
  ExternalLink,
  Wrench,
  Database,
  ImagePlus,
  X,
  Maximize2,
  ZoomIn,
  Eye,
  Activity,
  Flame,
  MessageSquare,
  Plus,
  History,
  Trash2,
  Clock,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSensors } from "@/lib/sensors";
import { Panel, Badge, Markdown, Loading } from "./ui";

type VisualArtifacts = {
  original_image_b64?: string;
  comparison_image_b64?: string;
  annotated_flame_b64?: string;
  thermal_tomography_b64?: string;
  finding_status?: string;
  finding_summary?: string;
  detection_confidence?: number;
  detected_regions?: { x: number; y: number; width: number; height: number; area_px?: number }[];
  cv_metrics?: Record<string, any>;
};

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  imageName?: string;
  visualArtifacts?: VisualArtifacts;
  agent?: string;
  mode?: string;
  tools?: { tool: string; arguments: any }[];
  isStreaming?: boolean;
};

const LOADER_STEPS = [
  "Analyzing microgravity telemetry & sensors",
  "Evaluating combustion physics digital twin",
  "Reviewing NASA research & safety protocol",
  "Synthesizing flight safety assessment",
];

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  agent?: string;
  messages: ChatMsg[];
};

type RagHistoryItem = {
  id: string;
  query: string;
  mode: "live" | "archive";
  timestamp: number;
  resultData?: any;
};

const SESSIONS_STORAGE_KEY = "shunnoshikha_chat_sessions_v2";
const ACTIVE_SESSION_STORAGE_KEY = "shunnoshikha_active_session_id_v2";
const RAG_HISTORY_STORAGE_KEY = "shunnoshikha_rag_history_v2";

const createDefaultSession = (): ChatSession => ({
  id: "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
  title: "New Session",
  createdAt: Date.now(),
  agent: "",
  messages: [],
});

const QUICK_PROMPTS = [
  "Analyze the current cabin telemetry and fire safety status.",
  "What does NASA BASS-II research say about radiative extinction in low flow?",
  "Why is water blocked on energized electrical fires in microgravity?",
];

const RAG_PRESETS = [
  "BASS-II PMMA radiative extinction",
  "Saffire large scale spacecraft fire",
  "Lunar habitat 34% O2 flammability",
];

function ImageSafetyReviewCard({
  artifacts,
  onInspect,
}: {
  artifacts: VisualArtifacts;
  onInspect: (src: string, title: string, caption: string, artifacts?: VisualArtifacts) => void;
}) {
  const [viewMode, setViewMode] = useState<"marked" | "thermal">("marked");

  const hasThermal = Boolean(artifacts.thermal_tomography_b64);
  const reviewSrc =
    viewMode === "thermal" && artifacts.thermal_tomography_b64
      ? artifacts.thermal_tomography_b64
      : artifacts.comparison_image_b64 || artifacts.annotated_flame_b64 || artifacts.original_image_b64 || "";

  const reviewTitle =
    viewMode === "thermal"
      ? "Review image — thermal heat detection"
      : artifacts.finding_status === "FIRE_SIGNATURE_DETECTED"
      ? "Review image — detected regions marked in green"
      : "Review image — no visible fire signature marked";

  const reviewCaption =
    viewMode === "thermal"
      ? "Review image — thermal heat detection effect (tomography)"
      : "Review image — detected regions marked in green";

  const confidencePct = Math.round((artifacts.detection_confidence ?? 0.56) * 100);
  const metrics = artifacts.cv_metrics;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d131f] p-4 text-left shadow-2xl transition-all">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-mist-400">
          IMAGE SAFETY REVIEW
        </div>
        <div className="rounded-full border border-orange-500/40 bg-orange-950/40 px-3 py-0.5 text-xs font-semibold text-orange-300">
          {confidencePct}% confidence
        </div>
      </div>

      {/* Side-by-Side Image Comparison */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Left: Original Image */}
        <div className="group flex flex-col">
          <div
            onClick={() =>
              artifacts.original_image_b64 &&
              onInspect(
                artifacts.original_image_b64,
                "Original image",
                "Raw frame input before computer vision extraction.",
                artifacts
              )
            }
            className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black/60 transition-all hover:border-ember-400/60"
            title="Click to zoom and inspect original image"
          >
            {artifacts.original_image_b64 && (
              <img
                src={artifacts.original_image_b64}
                alt="Original image"
                className="h-full w-full object-contain"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg">
                <ZoomIn className="h-3.5 w-3.5 text-ember-300" /> Click to zoom
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs text-mist-400">Original image</div>
        </div>

        {/* Right: Review Image (Green Contours or Thermal Heat Map) */}
        <div className="group flex flex-col">
          <div
            onClick={() => onInspect(reviewSrc, reviewTitle, reviewCaption, artifacts)}
            className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black/60 transition-all hover:border-ember-400/60"
            title="Click to zoom and inspect review image"
          >
            {reviewSrc && (
              <img
                src={reviewSrc}
                alt={reviewTitle}
                className="h-full w-full object-contain"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg">
                <ZoomIn className="h-3.5 w-3.5 text-ember-300" /> Click to zoom
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-xs text-mist-400">
            <span>{reviewCaption}</span>
            {hasThermal && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMode("marked");
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                    viewMode === "marked"
                      ? "border border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                      : "border border-line bg-void-950 text-mist-400 hover:text-mist-200"
                  }`}
                  title="Show detected regions with green bounding boxes"
                >
                  Regions (Green)
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMode("thermal");
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-all ${
                    viewMode === "thermal"
                      ? "border border-amber-500/50 bg-amber-500/20 text-amber-300"
                      : "border border-line bg-void-950 text-mist-400 hover:text-mist-200"
                  }`}
                  title="Show pseudo-color thermal tomography heat detection map"
                >
                  Thermal Heat Map
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description below */}
      {artifacts.finding_summary && (
        <p className="mt-3 text-xs leading-relaxed text-mist-300">
          {artifacts.finding_summary}
        </p>
      )}

      {/* Kinematics & Metrics Bar */}
      {metrics && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-void-950/70 p-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-mist-500">Flame Area</div>
            <div className="font-mono text-xs font-bold text-amber-400">
              {metrics.flame_area_mm2 != null ? `${metrics.flame_area_mm2} mm²` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-void-950/70 p-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-mist-500">Aspect Ratio</div>
            <div className="font-mono text-xs font-bold text-ion-300">
              {metrics.aspect_ratio != null ? `${metrics.aspect_ratio}` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-void-950/70 p-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-mist-500">Spread Rate</div>
            <div className="font-mono text-xs font-bold text-emerald-400">
              {metrics.flame_spread_rate_mms != null ? `${metrics.flame_spread_rate_mms} mm/s` : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-void-950/70 p-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-mist-500">Standoff Dist</div>
            <div className="font-mono text-xs font-bold text-mist-200">
              {metrics.standoff_distance_mm != null ? `${metrics.standoff_distance_mm} mm` : "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AICopilotAndRag() {
  const { snapshot } = useSensors();
  const [aiInfo, setAiInfo] = useState<any>(null);
  const [agent, setAgent] = useState<string>("");
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Chat Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [showSessionsList, setShowSessionsList] = useState<boolean>(false);
  const [loadedFromStorage, setLoadedFromStorage] = useState(false);

  const [imageAttachment, setImageAttachment] = useState<{ dataUrl: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [modalImage, setModalImage] = useState<{
    src: string;
    title: string;
    caption: string;
    artifacts?: VisualArtifacts;
  } | null>(null);

  // RAG State & History
  const [ragQuery, setRagQuery] = useState("");
  const [ragMode, setRagMode] = useState<"live" | "archive">("live");
  const [ragBusy, setRagBusy] = useState(false);
  const [ragResult, setRagResult] = useState<any>(null);
  const [archiveResults, setArchiveResults] = useState<any[]>([]);
  const [ragHistory, setRagHistory] = useState<RagHistoryItem[]>([]);
  const [showRagHistory, setShowRagHistory] = useState(false);
  const [err, setErr] = useState("");

  const [loaderStep, setLoaderStep] = useState(0);
  const streamTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!chatBusy) {
      setLoaderStep(0);
      return;
    }
    const t = setInterval(() => {
      setLoaderStep((prev) => (prev + 1) % LOADER_STEPS.length);
    }, 1500);
    return () => clearInterval(t);
  }, [chatBusy]);

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, []);

  // Load Sessions and RAG History from LocalStorage
  useEffect(() => {
    api.aiStatus().then(setAiInfo).catch(() => {});

    try {
      const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
      const storedActiveId = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (stored) {
        const parsed: ChatSession[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          const active = parsed.find((s) => s.id === storedActiveId) || parsed[0];
          setActiveSessionId(active.id);
          if (active.agent) setAgent(active.agent);
          setLoadedFromStorage(true);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to read chat sessions", e);
    }

    const initSess = createDefaultSession();
    setSessions([initSess]);
    setActiveSessionId(initSess.id);
    setLoadedFromStorage(true);

    try {
      const storedRag = localStorage.getItem(RAG_HISTORY_STORAGE_KEY);
      if (storedRag) {
        const parsedRag = JSON.parse(storedRag);
        if (Array.isArray(parsedRag)) setRagHistory(parsedRag);
      }
    } catch {}
  }, []);

  // Save Sessions to LocalStorage
  useEffect(() => {
    if (!loadedFromStorage || sessions.length === 0) return;
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
    } catch (e) {
      console.warn("Failed to save chat sessions", e);
    }
  }, [sessions, activeSessionId, loadedFromStorage]);

  // Save RAG History to LocalStorage
  useEffect(() => {
    if (!loadedFromStorage) return;
    try {
      localStorage.setItem(RAG_HISTORY_STORAGE_KEY, JSON.stringify(ragHistory));
    } catch {}
  }, [ragHistory, loadedFromStorage]);

  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  const messages = currentSession?.messages || [];

  const updateCurrentSessionMessages = (
    updater: (prev: ChatMsg[]) => ChatMsg[],
    firstMessageText?: string
  ) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const newMsgs = updater(s.messages);
        let title = s.title;
        if ((s.title === "New Session" || !s.title) && firstMessageText) {
          title =
            firstMessageText.length > 36
              ? firstMessageText.slice(0, 33) + "…"
              : firstMessageText;
        }
        return {
          ...s,
          title,
          agent: agent || s.agent,
          messages: newMsgs,
        };
      })
    );
  };

  const handleNewSession = () => {
    const newSess = createDefaultSession();
    setSessions((prev) => [newSess, ...prev]);
    setActiveSessionId(newSess.id);
    setImageAttachment(null);
    setInput("");
    setShowSessionsList(false);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    const target = sessions.find((s) => s.id === id);
    if (target?.agent) setAgent(target.agent);
    setShowSessionsList(false);
  };

  const handleDeleteSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const fresh = createDefaultSession();
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleClearAllSessions = () => {
    if (window.confirm("Clear all AI Copilot chat sessions?")) {
      const fresh = createDefaultSession();
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
      setShowSessionsList(false);
    }
  };

  const saveRagHistoryItem = (query: string, mode: "live" | "archive", resultData: any) => {
    setRagHistory((prev) => {
      const filtered = prev.filter(
        (item) => item.query.toLowerCase() !== query.toLowerCase() || item.mode !== mode
      );
      const newItem: RagHistoryItem = {
        id: "rag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
        query,
        mode,
        timestamp: Date.now(),
        resultData,
      };
      return [newItem, ...filtered].slice(0, 15);
    });
  };

  const loadRagHistoryItem = (item: RagHistoryItem) => {
    setRagQuery(item.query);
    setRagMode(item.mode);
    if (item.mode === "live") {
      setRagResult(item.resultData);
    } else {
      setArchiveResults(item.resultData?.results || item.resultData || []);
    }
  };

  const handleClearRagHistory = () => {
    setRagHistory([]);
  };

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErr("Images must be 10 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageAttachment({ dataUrl: reader.result, name: file.name });
        setErr("");
      }
    };
    reader.onerror = () => setErr("Could not read that image. Please try another file.");
    reader.readAsDataURL(file);
  };

  const loadSampleFlame = async () => {
    try {
      setErr("");
      const res = await api.sampleFrame(1);
      if (res?.image_b64) {
        setImageAttachment({
          dataUrl: res.image_b64,
          name: res.name || "bass2_flame_f1.png",
        });
        if (!input.trim()) {
          setInput("Analyze microgravity flame geometry, flame front standoff, and thermal heat signature.");
        }
      }
    } catch (e: any) {
      setErr("Could not load sample frame: " + e.message);
    }
  };

  const sendChat = async (promptText?: string) => {
    const q = (promptText ?? input).trim();
    if ((!q && !imageAttachment) || chatBusy) return;
    const imageForRequest = imageAttachment;
    const messageText = q || "Please analyze this flame image and explain the key safety findings.";
    if (!promptText) setInput("");
    setErr("");

    updateCurrentSessionMessages(
      (m) => [...m, { role: "user", text: messageText, imageName: imageForRequest?.name }],
      messageText
    );
    setImageAttachment(null);
    setChatBusy(true);
    try {
      const res = await api.chat({
        message: messageText,
        image_b64: imageForRequest?.dataUrl,
        agent_callsign: agent || undefined,
      });

      const fullText = res.response_markdown || "No response generated.";
      const words = fullText.split(" ");
      const initialWordCount = Math.min(6, words.length);
      const initialText = words.slice(0, initialWordCount).join(" ");
      const shouldStream = words.length > 6;

      updateCurrentSessionMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: shouldStream ? initialText : fullText,
          agent: res.active_agent?.callsign,
          mode: res.intelligence_mode,
          tools: res.tool_calls_executed || [],
          visualArtifacts: res.visual_artifacts,
          isStreaming: shouldStream,
        },
      ]);
      setChatBusy(false);

      if (shouldStream) {
        if (streamTimerRef.current) clearInterval(streamTimerRef.current);
        let currentIdx = initialWordCount;
        const chunkSize = Math.max(3, Math.floor(words.length / 32));
        streamTimerRef.current = setInterval(() => {
          currentIdx += chunkSize;
          if (currentIdx >= words.length) {
            if (streamTimerRef.current) clearInterval(streamTimerRef.current);
            updateCurrentSessionMessages((m) => {
              const last = m[m.length - 1];
              if (!last || last.role !== "assistant") return m;
              return [...m.slice(0, -1), { ...last, text: fullText, isStreaming: false }];
            });
          } else {
            const streamedSlice = words.slice(0, currentIdx).join(" ");
            updateCurrentSessionMessages((m) => {
              const last = m[m.length - 1];
              if (!last || last.role !== "assistant") return m;
              return [...m.slice(0, -1), { ...last, text: streamedSlice, isStreaming: true }];
            });
          }
        }, 28);
      }
    } catch (e: any) {
      setErr(e.message);
      setChatBusy(false);
    }
  };

  const runRag = async (qOverride?: string) => {
    const q = (qOverride ?? ragQuery).trim();
    if (!q || ragBusy) return;
    setRagQuery(q);
    setErr("");
    setRagBusy(true);
    try {
      if (ragMode === "live") {
        const res = await api.ragAsk({ query: q, top_k: 5 });
        setRagResult(res);
        saveRagHistoryItem(q, "live", res);
      } else {
        const res = await api.ragArchive({ query: q, top_k: 5 });
        setArchiveResults(res.results || []);
        saveRagHistoryItem(q, "archive", res);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRagBusy(false);
    }
  };

  const isSim = snapshot?.mode !== "live";

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded-lg border border-flame-500/50 bg-flame-500/10 px-3 py-2 text-xs text-flame-400">
          {err}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12 items-start">
        {/* LEFT (7/12): 5-Agent AI Copilot */}
        <Panel
          title="AI copilot — answers from the live twin & NASA sources"
          icon={<Bot className="h-4 w-4" />}
          className="lg:col-span-7"
          right={
            <div className="flex items-center gap-1.5">
              <Badge color={isSim ? "rgb(var(--c-warn))" : "rgb(var(--c-info))"}>
                {isSim ? "Simulated state" : "Live hardware state"}
              </Badge>
              <Badge color={aiInfo?.available ? "rgb(var(--c-ok))" : "rgb(var(--c-neutral))"}>
                {aiInfo?.available ? `Model · ${aiInfo.model}` : "Built-in rules"}
              </Badge>
            </div>
          }
        >
          {/* Top Session Bar (Session-wise chat organization) */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-void-950/70 px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-3.5 w-3.5 text-ember-400 shrink-0" />
              <span className="font-semibold text-mist-200 truncate max-w-[180px] sm:max-w-[280px]">
                {currentSession?.title || "New Session"}
              </span>
              <span className="rounded-full bg-void-900 border border-line px-2 py-0.5 text-[10px] text-mist-400">
                {messages.length} {messages.length === 1 ? "message" : "messages"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowSessionsList(!showSessionsList)}
                className={`chip !py-1 text-[11px] flex items-center gap-1 ${
                  showSessionsList ? "!border-ember-400 !text-ember-300 !bg-ember-500/15" : ""
                }`}
                title="View and switch past chat sessions"
              >
                <History className="h-3 w-3 text-ember-400" />
                <span>Sessions ({sessions.length})</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showSessionsList ? "rotate-180" : ""}`} />
              </button>
              <button
                type="button"
                onClick={handleNewSession}
                className="chip !border-ember-500/50 !bg-ember-500/15 !py-1 text-[11px] text-ember-300 hover:border-ember-400 flex items-center gap-1"
                title="Start a fresh chat session without clutter"
              >
                <Plus className="h-3 w-3" />
                <span>New Session</span>
              </button>
            </div>
          </div>

          {/* Session Switcher Popover */}
          {showSessionsList && (
            <div className="mb-3 rounded-xl border border-line bg-[#0d131f] p-3 shadow-2xl animate-in fade-in">
              <div className="mb-2 flex items-center justify-between text-xs border-b border-white/10 pb-2">
                <span className="font-bold text-mist-200">Chat Sessions ({sessions.length})</span>
                <div className="flex items-center gap-3">
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={handleClearAllSessions}
                      className="text-[10px] text-mist-500 hover:text-flame-400 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSessionsList(false)}
                    className="text-mist-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {sessions.map((sess) => (
                  <div
                    key={sess.id}
                    onClick={() => handleSelectSession(sess.id)}
                    className={`group flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer transition-all ${
                      sess.id === activeSessionId
                        ? "border-ember-400/60 bg-ember-500/20 text-ember-200 shadow-sm"
                        : "border-line bg-void-950/60 text-mist-400 hover:border-line hover:text-mist-200"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{sess.title}</div>
                      <div className="text-[10px] text-mist-500">
                        {new Date(sess.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {sess.messages.length} {sess.messages.length === 1 ? "message" : "messages"}
                      </div>
                    </div>
                    {sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(sess.id, e)}
                        className="p-1 text-mist-500 hover:text-flame-400 opacity-60 group-hover:opacity-100 transition-opacity"
                        title="Delete this session"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Agent Selector */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {[
              { id: "", label: "Auto-pick" },
              { id: "OPTICAL-TRACKER", label: "Optical / Vision" },
              { id: "FLIGHT-SAFETY", label: "Flight safety" },
              { id: "TELEMETRY-LEAD", label: "Telemetry" },
              { id: "NASA-ARCHIVIST", label: "NASA research" },
              { id: "AERO-PHYSICS", label: "Physics" },
            ].map((a) => (
              <button
                key={a.id || "auto"}
                type="button"
                onClick={() => setAgent(a.id)}
                className={`chip !py-1 text-[10px] ${agent === a.id ? "!border-ember-400/70 !bg-ember-500/15 !text-ember-300" : ""}`}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Conversation Thread */}
          <div className="mb-3 h-[420px] space-y-3 overflow-y-auto rounded-xl border border-line bg-void-950/80 p-3.5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Bot className="h-9 w-9 text-ember-400" />
                <div>
                  <div className="text-sm font-semibold text-mist-200">Ask about the cabin, the fire, or NASA research</div>
                  <p className="mt-1 max-w-md text-xs text-mist-500">
                    Answers are grounded in the live sensor twin, the combustion physics model, and NASA's PSI &amp; NTRS catalogs.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void sendChat(p)}
                      className="chip hover:border-ember-400/60 hover:text-ember-200 text-left text-[11px]"
                    >
                      <Sparkles className="h-3 w-3 shrink-0 text-ember-400" />
                      <span>{p}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void loadSampleFlame()}
                    className="chip !border-ember-500/40 !bg-ember-500/10 text-left text-[11px] text-ember-300 hover:border-ember-400"
                  >
                    <Flame className="h-3 w-3 shrink-0 text-ember-400" />
                    <span>Attach Sample BASS-II Flame</span>
                  </button>
                </div>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 ${
                    m.role === "user"
                      ? "ml-10 border-ion-500/30 bg-ion-500/10 text-mist-100"
                      : "mr-4 border-line bg-void-900/90"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="font-bold tracking-wide text-mist-400">
                      {m.role === "user" ? "You" : m.agent || "ShunnoShikha AI"}
                    </span>
                    {m.mode && (
                      <Badge color={m.mode.includes("LLM") ? "rgb(var(--c-ok))" : "rgb(var(--c-warn))"}>
                        {m.mode.includes("LLM") ? "AI model" : "Built-in rules"}
                      </Badge>
                    )}
                    {m.tools?.map((t, ti) => (
                      <span key={ti} className="inline-flex items-center gap-1 rounded border border-line bg-void-950 px-1.5 py-0.5 font-mono text-[9px] text-ion-300">
                        <Wrench className="h-2.5 w-2.5" /> {t.tool}
                      </span>
                    ))}
                  </div>

                  {m.role === "user" ? (
                    <div className="space-y-1.5">
                      <p className="text-xs">{m.text}</p>
                      {m.imageName && (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-ion-500/30 bg-ion-500/10 px-2 py-1 text-[10px] text-ion-300">
                          <ImagePlus className="h-3 w-3" /> Image attached · {m.imageName}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Markdown>{m.text}</Markdown>
                        {m.isStreaming && (
                          <span className="inline-block h-3.5 w-1.5 ml-1 rounded-sm bg-ember-400 animate-pulse align-middle" />
                        )}
                      </div>

                      {/* Image Safety Review Card */}
                      {m.visualArtifacts?.original_image_b64 && (
                        <ImageSafetyReviewCard
                          artifacts={m.visualArtifacts}
                          onInspect={(src, title, caption, arts) =>
                            setModalImage({ src, title, caption, artifacts: arts })
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            {chatBusy && <Loading label={LOADER_STEPS[loaderStep]} />}
          </div>

          {/* Staged Image Attachment Preview */}
          {imageAttachment && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-ion-500/35 bg-ion-500/10 p-2">
              <img
                src={imageAttachment.dataUrl}
                alt="Selected flame image preview"
                className="h-14 w-14 rounded-lg border border-line object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-mist-200">{imageAttachment.name}</div>
                <div className="text-[10px] text-mist-500">Ready for Computer Vision &amp; AI Safety Review</div>
              </div>
              <button
                type="button"
                onClick={() => setImageAttachment(null)}
                className="btn !h-7 !w-7 !p-0 text-mist-400 hover:text-white"
                aria-label="Remove selected image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Input & Action Bar */}
          <div className="space-y-1.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendChat();
              }}
              className="flex gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  chooseImage(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ion !px-3 text-xs"
                aria-label="Upload an image"
                title="Upload local image for safety analysis"
              >
                <ImagePlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Image</span>
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the sensors, the fire, or NASA research…"
                className="input flex-1 text-xs"
              />
              <button
                type="submit"
                disabled={chatBusy || (!input.trim() && !imageAttachment)}
                className="btn btn-primary !px-4 text-xs"
              >
                <Send className="h-3.5 w-3.5" /> Ask
              </button>
            </form>

            {/* Quick Helper for 50-second presentation */}
            <div className="flex items-center justify-between text-[10px] text-mist-500">
              <span className="flex items-center gap-1">
                <span>Fast demo:</span>
                <button
                  type="button"
                  onClick={() => void loadSampleFlame()}
                  className="font-medium text-ember-400 hover:text-ember-300 underline underline-offset-2"
                >
                  ⚡ Attach BASS-II Microgravity Flame
                </button>
              </span>
              <span>Upload or click to inspect high-res</span>
            </div>
          </div>
        </Panel>

        {/* RIGHT (5/12): Live NASA Web & Archive RAG */}
        <Panel
          title="NASA research search"
          icon={<Globe className="h-4 w-4" />}
          className="lg:col-span-5"
          right={
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setRagMode("live")}
                className={`chip !px-2 !py-0.5 text-[10px] ${ragMode === "live" ? "!border-ion-400/60 !text-ion-300" : ""}`}
              >
                <Globe className="h-3 w-3" /> Live web
              </button>
              <button
                type="button"
                onClick={() => setRagMode("archive")}
                className={`chip !px-2 !py-0.5 text-[10px] ${ragMode === "archive" ? "!border-ion-400/60 !text-ion-300" : ""}`}
              >
                <Database className="h-3 w-3" /> Paper archive
              </button>
            </div>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runRag();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={ragQuery}
              onChange={(e) => setRagQuery(e.target.value)}
              placeholder={ragMode === "live" ? "Search NASA's live PSI & NTRS catalogs…" : "Search the offline NASA paper archive…"}
              className="input flex-1 text-xs"
            />
            <button type="submit" disabled={ragBusy || !ragQuery.trim()} className="btn btn-ion !px-3 text-xs">
              <Search className="h-3.5 w-3.5" />
            </button>
          </form>

          {/* RAG Presets & Search History Toggle */}
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-mist-500">
              <span>Quick Topics:</span>
              {ragHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowRagHistory(!showRagHistory)}
                  className="inline-flex items-center gap-1 font-medium text-ion-300 hover:text-ion-200"
                >
                  <Clock className="h-3 w-3" />
                  <span>{showRagHistory ? "Hide past queries" : `History (${ragHistory.length})`}</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {RAG_PRESETS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void runRag(q)}
                  className="chip !px-2 !py-0.5 text-[10px] hover:border-ion-400/60 hover:text-ion-300"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* RAG Query History Drawer */}
            {showRagHistory && ragHistory.length > 0 && (
              <div className="rounded-xl border border-line bg-void-950/90 p-2.5 animate-in fade-in space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-mist-300 flex items-center gap-1">
                    <History className="h-3 w-3 text-ion-400" /> Recent Searches
                  </span>
                  <button
                    type="button"
                    onClick={handleClearRagHistory}
                    className="text-[10px] text-mist-500 hover:text-flame-400"
                  >
                    Clear history
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {ragHistory.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => loadRagHistoryItem(item)}
                      className="chip !px-2 !py-0.5 text-[10px] hover:border-ion-400/60 hover:text-ion-300 flex items-center gap-1"
                      title={`Saved from ${new Date(item.timestamp).toLocaleTimeString()}`}
                    >
                      <span className="text-[9px] uppercase font-mono text-ion-400">[{item.mode}]</span>
                      <span className="truncate max-w-[140px]">{item.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 h-[395px] space-y-3 overflow-y-auto pr-1">
            {ragBusy && <Loading label={ragMode === "live" ? "Fetching from NASA's live catalogs" : "Searching the NASA archive"} />}

            {!ragBusy && ragMode === "live" && ragResult && (
              <>
                <div className="rounded-xl border border-ion-500/30 bg-ion-500/5 p-3">
                  <div className="mb-1.5 text-[10px] font-bold tracking-wide text-ion-300">
                    Answer with NASA sources
                  </div>
                  <Markdown>{ragResult.answer_markdown || ""}</Markdown>
                </div>
                <div className="space-y-2">
                  {(ragResult.retrieval?.passages || []).map((p: any, i: number) => (
                    <div key={i} className="rounded-lg border border-line bg-void-900/70 p-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ember-300">{p.title}</span>
                        {p.url && (
                          <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0 text-ion-400 hover:text-ion-300">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-3 text-[11px] text-mist-400">{p.text}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!ragBusy && ragMode === "archive" && archiveResults.length > 0 && (
              <div className="space-y-2">
                {archiveResults.map((r: any, i: number) => (
                  <div key={i} className="rounded-lg border border-line bg-void-900/70 p-2.5 text-xs">
                    <div className="flex items-center justify-between text-[10px] text-ember-300">
                      <span className="font-semibold truncate">{r.title || r.report_id}</span>
                      {r.page_num != null && <span className="font-mono text-mist-500">p.{r.page_num}</span>}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-mist-300">{r.text}</p>
                  </div>
                ))}
              </div>
            )}

            {!ragBusy && ((ragMode === "live" && !ragResult) || (ragMode === "archive" && archiveResults.length === 0)) && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-mist-500">
                <Globe className="h-8 w-8 text-ion-400/70" />
                <p>Pick a topic below or type a question — passages come straight from NASA with their source links.</p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Lightbox / Zoom Modal */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-in fade-in"
          onClick={() => setModalImage(null)}
        >
          <div
            className="relative max-h-[92vh] max-w-4xl w-full rounded-2xl border border-white/15 bg-[#0e1422] p-5 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div>
                <h3 className="text-sm font-bold text-mist-100">{modalImage.title}</h3>
                <p className="text-xs text-mist-400">{modalImage.caption}</p>
              </div>
              <div className="flex items-center gap-2">
                {modalImage.artifacts && (
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-void-950 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setModalImage({
                          ...modalImage,
                          src: modalImage.artifacts?.original_image_b64 || modalImage.src,
                          title: "Original image",
                          caption: "Raw microgravity flame frame before CV extraction.",
                        })
                      }
                      className="chip !py-0.5 text-[10px]"
                    >
                      Original
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setModalImage({
                          ...modalImage,
                          src:
                            modalImage.artifacts?.annotated_flame_b64 ||
                            modalImage.artifacts?.comparison_image_b64 ||
                            modalImage.src,
                          title: "Review image — detected regions marked in green",
                          caption: "Green outlines mark segmented flame envelope and centroid crosshair.",
                        })
                      }
                      className="chip !py-0.5 text-[10px]"
                    >
                      Contours (Green)
                    </button>
                    {modalImage.artifacts.thermal_tomography_b64 && (
                      <button
                        type="button"
                        onClick={() =>
                          setModalImage({
                            ...modalImage,
                            src: modalImage.artifacts?.thermal_tomography_b64 || modalImage.src,
                            title: "Review image — thermal heat detection",
                            caption: "Pseudo-color inferno/jet thermal heat map distribution.",
                          })
                        }
                        className="chip !py-0.5 text-[10px]"
                      >
                        Thermal Heat Map
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setModalImage(null)}
                  className="rounded-lg p-1 text-mist-400 hover:bg-white/10 hover:text-white"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Image View */}
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/90 p-2">
              <img
                src={modalImage.src}
                alt={modalImage.title}
                className="max-h-[62vh] w-auto max-w-full rounded object-contain shadow-inner"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
