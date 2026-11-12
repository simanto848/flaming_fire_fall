#!/usr/bin/env python3
"""
ShunnoShikha AI - FastAPI Backend & WebSocket Telemetry Server
REST + WebSocket endpoints for all 8 mission modules plus the LLM super-intelligence:
- Live NASA web RAG (PSI + NTRS, no paper downloads)
- 5-Agent chat with tool calling, vision, and voice
- 3-Regime Digital Twin, SHAP/uncertainty ML, flame computer vision
- HIL ESP32/UNO telemetry streaming, 4-tier early warning, hypothesis designer
"""

import os
import json
import time
import asyncio
import base64
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request, Body, HTTPException
from pathlib import Path
import ipaddress
import secrets
import logging
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from shunnoshikha.metadata_hub import PSIMetadataHub
from shunnoshikha.digital_twin import CombustionDigitalTwin, EXPLORATION_ATMOSPHERES
from shunnoshikha.shap_uncertainty_engine import SHAPUncertaintyEngine
from shunnoshikha.flame_vision import FlameVisionAnalyzer
from shunnoshikha.hypothesis_designer import AutonomousHypothesisDesigner
from shunnoshikha.hil_telemetry_simulator import HILSensorSimulator, HIL_SCENARIOS
from shunnoshikha.early_warning_system import EarlyWarningSystem, NASA_SAFETY_LIMITS
from shunnoshikha.multi_agent_system import ScientificMultiAgentSystem, AGENTS
from shunnoshikha.llm_brain import LLMBrain
from shunnoshikha.live_web_rag import LiveWebRAG
from shunnoshikha.fire_emergency import (
    FireSimulationEngine, FIRE_TYPES, COMPARTMENTS, ADJACENCY, build_ai_assessment,
)
from rag.rag_engine import MicrogravityRAGEngine
from shunnoshikha.sensor_service import SensorDataService, PRESETS, SENSOR_SPECS

app = FastAPI(
    title="ShunnoShikha AI API | Spacecraft Microgravity Fire Safety Digital Twin",
    description="Scientific Intelligence, Multi-Agent Systems, Digital Twin, and HIL Telemetry for NASA Space Apps Challenge",
    version="3.0.0",
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ---- Shared singleton engines (agent + REST + WS all share the same HIL state) ----
metadata_hub = PSIMetadataHub()
digital_twin = CombustionDigitalTwin()
shap_engine = SHAPUncertaintyEngine()
flame_vision = FlameVisionAnalyzer()
hypothesis_designer = AutonomousHypothesisDesigner(metadata_hub)
fire_engine = FireSimulationEngine()
sensor_service = SensorDataService(fire_engine, digital_twin)
hil_simulator = sensor_service
early_warning = EarlyWarningSystem()
archive_rag = MicrogravityRAGEngine()
live_rag = LiveWebRAG()
brain = LLMBrain()
multi_agent = ScientificMultiAgentSystem(
    metadata_hub=metadata_hub, digital_twin=digital_twin, ml_engine=shap_engine,
    vision_analyzer=flame_vision, hypothesis_designer=hypothesis_designer,
    hil_simulator=hil_simulator, early_warning=early_warning,
    rag_engine=archive_rag, live_rag=live_rag, brain=brain,
)


# ================= REQUEST SCHEMAS =================
class PredictionRequest(BaseModel):
    material: str = "PMMA"
    o2_pct: float = 21.0
    flow_cms: float = 7.5
    pressure_psi: float = 14.7
    thickness_mm: float = 2.5
    gravity_g: float = 0.0

class RankingRequest(BaseModel):
    o2_pct: float = 34.0
    flow_cms: float = 5.0
    pressure_psi: float = 8.2
    material: str = "Nomex"
    top_k: int = 5

class ScenarioRequest(BaseModel):
    scenario_key: str

class AgentChatRequest(BaseModel):
    message: str = ""
    image_b64: Optional[str] = None
    voice_transcript: Optional[str] = None
    agent_callsign: Optional[str] = None
    audio_b64: Optional[str] = None
    audio_format: str = "wav"

class HVACActionRequest(BaseModel):
    action_code: str = "ACTION_EMERGENCY_SHUTDOWN"

class RagRequest(BaseModel):
    query: str
    top_k: int = 6

class TrajectoryRequest(BaseModel):
    material: str = "PMMA"
    start: dict = {"o2_pct": 21.0, "flow_cms": 7.5, "pressure_psi": 14.7}
    end: dict = {"o2_pct": 17.0, "flow_cms": 7.5, "pressure_psi": 14.7}
    steps: int = 12

class HypothesisRequest(BaseModel):
    void_id: str = "VOID-LUNAR-NOMEX"

class VisionDescribeRequest(BaseModel):
    image_b64: str
    prompt: str = "Analyze this flame image for microgravity combustion characteristics."

# ================= HEALTH & AI STATUS =================
@app.get("/api/health")
def get_health():
    return {
        "status": "OPERATIONAL",
        "system_name": "ShunnoShikha AI",
        "challenge": "NASA Space Apps: Flame in Freefall",
        "team": "Team HASH",
        "modules_active": [
            "Module 1: Cross-Investigation Metadata Hub & Physics Ranker",
            "Module 2: 3-Regime Combustion Digital Twin",
            "Module 3: SHAP-Explainable ML & Uncertainty Engine",
            "Module 4: Computer Vision Flame & Tomography Analyzer",
            "Module 5: 5-Agent Scientific Intelligence Engine",
            "Module 6: Autonomous Hypothesis & Virtual Experiment Designer",
            "Module 7: Hardware-in-the-Loop (HIL) UNO/ESP32 Simulator",
            "Module 8: Rule-Validated 4-Tier Early-Warning System",
        ],
        "indexed_archive_passages": len(archive_rag.doc_index),
        "indexed_flight_tests": len(metadata_hub.df_unified),
    }

@app.get("/api/ai/status")
def ai_status():
    return brain.status()

@app.get("/api/agents")
def list_agents():
    return {"agents": list(AGENTS.values())}

# ================= MODULE 1: METADATA HUB =================
@app.get("/api/metadata/summary")
def get_metadata_summary():
    return metadata_hub.get_summary_stats()

@app.get("/api/metadata/records")
def get_metadata_records(investigation: Optional[str] = None, limit: int = 1000):
    df = metadata_hub.df_unified
    if investigation:
        df = df[df["investigation_id"] == investigation]
    return {"records": json.loads(df.head(limit).to_json(orient="records")), "total": len(df)}

@app.get("/api/metadata/catalog")
def get_metadata_catalog():
    return {
        "investigations": metadata_hub.get_investigation_catalog(),
        "scope_guardrails": metadata_hub.get_scope_guardrails(),
    }

@app.get("/api/metadata/anomalies")
def get_metadata_anomalies():
    return {"anomalies": metadata_hub.anomaly_log}

@app.post("/api/metadata/rank")
def rank_experiments(req: RankingRequest):
    return {"ranked_experiments": metadata_hub.rank_similar_experiments(
        req.o2_pct, req.flow_cms, req.pressure_psi, req.material, req.top_k)}

@app.get("/api/psi/investigations")
def psi_investigations():
    path = "data/psi_metadata/psi_investigation_map.json"
    mapping = json.load(open(path)) if os.path.exists(path) else {}
    combustion = {a: t for a, t in mapping.items() if any(
        k in t.lower() for k in ["burn", "flame", "fire", "combust", "cool flame"])}
    return {
        "verified_live": combustion,
        "portal": "https://psi.nasa.gov/physci/repo/search?q=&data_source=psi&data_type=investigation",
        "api": "https://psi.nasa.gov/geode-py/ws/repo/search",
    }

# ================= MODULE 2: DIGITAL TWIN =================
@app.post("/api/digital-twin/evaluate")
def evaluate_digital_twin(req: PredictionRequest):
    return digital_twin.evaluate_state(req.material, req.o2_pct, req.flow_cms, req.pressure_psi, req.thickness_mm, gravity_g=req.gravity_g)

@app.get("/api/digital-twin/boundary-surface")
def get_boundary_surface(material: str = "PMMA", pressure_psi: float = 14.7, n_points: int = 25, gravity_g: float = 0.0):
    return digital_twin.generate_boundary_surface(material, pressure_psi, n_points, gravity_g=gravity_g)

@app.get("/api/digital-twin/exploration-atmospheres")
def get_exploration_atmospheres():
    return EXPLORATION_ATMOSPHERES

@app.post("/api/digital-twin/trajectory")
def simulate_trajectory(req: TrajectoryRequest):
    return {"trajectory": digital_twin.simulate_trajectory(req.material, req.start, req.end, req.steps)}

# ================= MODULE 3: SHAP ML =================
@app.post("/api/ml/predict-shap")
def predict_with_shap(req: PredictionRequest):
    return shap_engine.predict_with_explanation(req.material, req.o2_pct, req.flow_cms, req.pressure_psi, req.thickness_mm)

@app.get("/api/ml/metrics")
def ml_metrics():
    return shap_engine.get_metrics()

# ================= MODULE 4: VISION =================
@app.get("/api/vision/sample-frame")
def get_sample_flame_frame(frame_num: int = 1):
    n = min(5, max(1, frame_num))
    res = flame_vision.analyze_frame(f"data/flame_frames/bass2_flame_f{n}.png")
    return {
        "frame_num": n,
        "name": f"bass2_flame_f{n}.png",
        "image_b64": res["original_image_b64"],
    }

@app.post("/api/vision/analyze")
def analyze_flame_frame(frame_num: int = 1):
    n = min(5, max(1, frame_num))
    return flame_vision.analyze_frame(f"data/flame_frames/bass2_flame_f{n}.png")

@app.post("/api/vision/analyze-upload")
async def analyze_uploaded_flame(file: UploadFile = File(...)):
    data = await file.read()
    return flame_vision.analyze_frame(data)

@app.post("/api/vision/describe")
def describe_flame_llm(req: VisionDescribeRequest):
    if not brain.is_available():
        return {"description": "LLM vision offline. Use the CV analyzer for geometry metrics.", "available": False}
    return {"description": brain.describe_image(req.image_b64, req.prompt), "available": True}

# ================= MODULE 5: AGENTS + LIVE RAG =================
@app.post("/api/agent/chat")
def agent_chat(req: AgentChatRequest):
    return multi_agent.process_query(
        user_message=req.message, image_attachment=req.image_b64,
        voice_transcript=req.voice_transcript, forced_agent=req.agent_callsign,
        audio_b64=req.audio_b64, audio_format=req.audio_format,
    )

@app.post("/api/rag/live-search")
def rag_live_search(req: RagRequest):
    return live_rag.retrieve(req.query, top_k=req.top_k)

@app.post("/api/rag/ask")
def rag_ask(req: RagRequest):
    return multi_agent.rag_ask(req.query, top_k=req.top_k)

@app.get("/api/rag/status")
def rag_status():
    return live_rag.status()

@app.post("/api/rag/archive-search")
def rag_archive_search(req: RagRequest):
    return {"results": archive_rag.retrieve(req.query, top_k=req.top_k)}

# ================= VOICE =================
@app.post("/api/voice/transcribe")
async def transcribe_voice(file: UploadFile = File(...)):
    data = await file.read()
    if not brain.is_available():
        return {"transcript": "", "available": False, "hint": "Start Ollama (lfm3-omni) or use browser speech recognition."}
    audio_b64 = base64.b64encode(data).decode()
    fmt = "wav" if (file.filename or "").lower().endswith(".wav") else "mp3"
    transcript = brain.transcribe_audio(audio_b64, fmt)
    return {"transcript": transcript, "available": True}

# ================= MODULE 6: HYPOTHESES =================
@app.get("/api/hypothesis/list")
def list_hypotheses():
    return {"hypotheses": hypothesis_designer.list_all_hypotheses()}

@app.get("/api/hypothesis/voids")
def list_voids():
    return {"voids": hypothesis_designer.identify_parameter_voids()}

@app.post("/api/hypothesis/design")
def design_hypothesis(req: HypothesisRequest):
    return hypothesis_designer.design_virtual_experiment(req.void_id)

from shunnoshikha.sensor_api import make_sensor_router

app.include_router(make_sensor_router(sensor_service, brain))

if os.path.isdir("shunnoshikha/static"):
    app.mount("/static", StaticFiles(directory="shunnoshikha/static"), name="static")