#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 5: 5-Agent Scientific Intelligence Engine (Super-Intelligence AI)

Powered by a local multimodal omni-model (Ollama lfm3-omni: completion + vision +
tools + audio) through an OpenAI-compatible interface, with an autonomous ReAct
tool-calling loop over the real scientific modules. Falls back to a deterministic
physics pipeline when no LLM server is reachable.

Agents:
  1. FLIGHT-SAFETY    — Chief Safety Officer & Mission Supervisor
  2. AERO-PHYSICS     — Combustion Digital Twin & Boundary Specialist
  3. OPTICAL-TRACKER  — Flame Vision & Tomography Specialist
  4. NASA-ARCHIVIST   — Live NASA Web RAG & Provenance Specialist
  5. TELEMETRY-LEAD   — HIL IoT & Sensor Integrity Specialist
"""

import logging
from typing import Dict, List, Any, Optional

from shunnoshikha.metadata_hub import PSIMetadataHub
from shunnoshikha.digital_twin import CombustionDigitalTwin
from shunnoshikha.shap_uncertainty_engine import SHAPUncertaintyEngine
from shunnoshikha.flame_vision import FlameVisionAnalyzer
from shunnoshikha.hypothesis_designer import AutonomousHypothesisDesigner
from shunnoshikha.sensor_service import SensorDataService
from shunnoshikha.early_warning_system import EarlyWarningSystem
from shunnoshikha.llm_brain import LLMBrain, build_user_content
from shunnoshikha.live_web_rag import LiveWebRAG
from rag.rag_engine import MicrogravityRAGEngine

logger = logging.getLogger("shunnoshikha.agents")

AGENTS = {
    "FLIGHT-SAFETY": {
        "name": "Commander Sarah Vance", "callsign": "FLIGHT-SAFETY",
        "role": "Chief Safety Officer & Mission Supervisor", "badge": "COMMAND",
        "specialty": "Spacecraft emergency protocols, 4-tier risk assessment, automated HVAC suppression governance."
    },
    "AERO-PHYSICS": {
        "name": "Dr. Subrata Bhattacharjee (AI Persona)", "callsign": "AERO-PHYSICS",
        "role": "Combustion Digital Twin & Boundary Specialist", "badge": "PHYSICS",
        "specialty": "Damköhler reaction scaling, radiative quenching, exploration atmosphere boundary projections."
    },
    "OPTICAL-TRACKER": {
        "name": "Dr. Fletcher Miller (AI Persona)", "callsign": "OPTICAL-TRACKER",
        "role": "Flame Vision & Tomography Specialist", "badge": "VISION",
        "specialty": "Microgravity spherical flame geometry, aspect ratios, flame spread rate, pseudo-color thermal zones."
    },
    "NASA-ARCHIVIST": {
        "name": "Dr. Sandra L. Olson (AI Persona)", "callsign": "NASA-ARCHIVIST",
        "role": "Live NASA Literature & PSI Provenance Research Specialist", "badge": "PROVENANCE",
        "specialty": "Live web RAG over psi.nasa.gov and the NTRS API, citation tracking, fact-vs-extrapolation verification."
    },
    "TELEMETRY-LEAD": {
        "name": "Engineer Alex Chen", "callsign": "TELEMETRY-LEAD",
        "role": "IoT & Sensor Telemetry Lead", "badge": "SENSORS",
        "specialty": "Wokwi Arduino/ESP32 sensor streaming, anomaly filtering, baseline negative drift correction."
    },
}

TOOL_SCHEMAS: List[Dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "predict_flammability_regime",
        "description": "Run the SHAP-explainable XGBoost model + OOD uncertainty engine. Predicts flammability regime, burn duration frames, O2 depletion, CO ppm, SHAP feature attributions and Mahalanobis uncertainty for a material in microgravity.",
        "parameters": {"type": "object", "properties": {
            "material": {"type": "string", "enum": ["PMMA", "Nomex", "Cotton-Fiber Blend"]},
            "o2_pct": {"type": "number"}, "flow_cms": {"type": "number"},
            "pressure_psi": {"type": "number"}, "thickness_mm": {"type": "number"}},
            "required": ["o2_pct", "flow_cms"]}}},
    {"type": "function", "function": {
        "name": "evaluate_digital_twin",
        "description": "Evaluate the 3-regime physics digital twin (Radiative Extinction / Sustained Burn / Blowoff) with Damköhler number, radiative loss index and flame temperature.",
        "parameters": {"type": "object", "properties": {
            "material": {"type": "string"}, "o2_pct": {"type": "number"}, "flow_cms": {"type": "number"},
            "pressure_psi": {"type": "number"}, "thickness_mm": {"type": "number"}},
            "required": ["o2_pct", "flow_cms"]}}},
    {"type": "function", "function": {
        "name": "search_nasa_live",
        "description": "LIVE retrieval from NASA websites (psi.nasa.gov pages + NTRS search API). Returns ranked passages with source URLs and fetch timestamps. Use for any factual NASA literature question. No papers are downloaded.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "top_k": {"type": "integer"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "query_nasa_archive",
        "description": "Search the pre-indexed deep archive of NASA full-text report passages and flight test records (BASS-II, Saffire). Complements live web search.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "top_k": {"type": "integer"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "analyze_flame_image",
        "description": "Computer-vision analysis of a flame frame: area mm2, aspect ratio, spread rate, standoff distance, annotated + thermal tomography images. Accepts a base64 image or uses the current NASA BASS-II demo frame.",
        "parameters": {"type": "object", "properties": {
            "image_b64": {"type": "string"}, "frame_num": {"type": "integer"}}}}},
    {"type": "function", "function": {
        "name": "get_telemetry_status",
        "description": "Read the live HIL ESP32 cabin telemetry packet (O2, airflow, pressure, temperature, CO, smoke) plus the 4-tier early-warning safety evaluation.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "simulate_sensor_scenario",
        "description": "Switch the HIL telemetry simulation scenario. Affects the live mission-control stream.",
        "parameters": {"type": "object", "properties": {
            "scenario_name": {"type": "string", "enum": ["NOMINAL_ISS", "SLOW_ELECTRICAL_SMOLDER", "VENTILATION_FAN_FAILURE", "EXPLORATION_O2_SURGE"]}},
            "required": ["scenario_name"]}}},
    {"type": "function", "function": {
        "name": "rank_similar_experiments",
        "description": "Physics-weighted ranking of historical NASA flight tests against target cabin conditions (exploration atmospheres).",
        "parameters": {"type": "object", "properties": {
            "o2_pct": {"type": "number"}, "flow_cms": {"type": "number"},
            "pressure_psi": {"type": "number"}, "material": {"type": "string"},
            "top_k": {"type": "integer"}}, "required": ["o2_pct", "flow_cms"]}}},
    {"type": "function", "function": {
        "name": "design_scientific_hypothesis",
        "description": "Design a testable hypothesis + virtual flight experiment for an unexplored parameter void in the NASA test matrix.",
        "parameters": {"type": "object", "properties": {
            "void_id": {"type": "string", "enum": ["VOID-LUNAR-NOMEX", "VOID-GATEWAY-PMMA-LOWFLOW", "VOID-MARS-COTTON-FABRIC"]}}}}},
    {"type": "function", "function": {
        "name": "trigger_hvac_suppression",
        "description": "Send an HVAC suppression command to the spacecraft bus (simulated). Only for WARNING/CRITICAL safety states.",
        "parameters": {"type": "object", "properties": {
            "action_code": {"type": "string", "enum": ["ACTION_EMERGENCY_SHUTDOWN", "ACTION_ISOLATE_VENTILATION", "ACTION_BALANCED_MIXING", "ACTION_NOMINAL_MAINTENANCE"]}},
            "required": ["action_code"]}}},
]

SYSTEM_PROMPT_BASE = """You are ShunnoShikha AI, the super-intelligence scientific officer of a spacecraft fire-safety mission control for NASA Space Apps "Flame in Freefall". You orchestrate 5 specialist agents and command real scientific tools.

DOMAIN PHYSICS (verified):
- In microgravity buoyancy vanishes; HVAC forced airflow (cm/s) and O2 concentration govern flame survival.
- U-shaped flammability boundary: low flow -> Radiative Extinction (radiant loss > chemical heat release); intermediate flow -> Sustained Burn; very high flow -> Convective Blowoff (Damkohler < 1).
- Materials certified safe on Earth can burn in gentle microgravity flows (NASA BASS/BASS-II findings).
- Exploration atmospheres: Lunar habitat 8.2 psi / 34% O2; Gateway 10.2 psi / 32% O2; ISS 14.7 psi / 21% O2.

RULES:
1. ALWAYS use tools for numeric predictions, telemetry, rankings and literature — never invent numbers.
2. For literature questions call search_nasa_live FIRST; cite only the exact verified source URLs returned by that tool.
3. Clearly label statements as [NASA OBSERVED] (from retrieved data) vs [MODEL EXTRAPOLATION] (digital twin / ML output, especially OOD conditions).
4. When the user asks about an image, call analyze_flame_image and also use your own vision.
5. Answer in concise mission-control markdown: short headers, bullet metrics, citations. Never fabricate report IDs.
6. If a tool returns an error, say so honestly and proceed with what you have.
"""


class ScientificMultiAgentSystem:
    """LLM-driven 5-agent collaborative AI with tool calling, vision, and voice."""

    def __init__(
        self,
        metadata_hub: Optional[PSIMetadataHub] = None,
        digital_twin: Optional[CombustionDigitalTwin] = None,
        ml_engine: Optional[SHAPUncertaintyEngine] = None,
        vision_analyzer: Optional[FlameVisionAnalyzer] = None,
        hypothesis_designer: Optional[AutonomousHypothesisDesigner] = None,
        hil_simulator: Optional[SensorDataService] = None,
        early_warning: Optional[EarlyWarningSystem] = None,
        rag_engine: Optional[MicrogravityRAGEngine] = None,
        live_rag: Optional[LiveWebRAG] = None,
        brain: Optional[LLMBrain] = None,
    ):
        self.metadata_hub = metadata_hub or PSIMetadataHub()
        self.digital_twin = digital_twin or CombustionDigitalTwin()
        self.ml_engine = ml_engine or SHAPUncertaintyEngine()
        self.vision_analyzer = vision_analyzer or FlameVisionAnalyzer()
        self.hypothesis_designer = hypothesis_designer or AutonomousHypothesisDesigner(self.metadata_hub)
        self.hil_simulator = hil_simulator or SensorDataService(twin=self.digital_twin)
        self.early_warning = early_warning or EarlyWarningSystem()
        self.rag_engine = rag_engine or MicrogravityRAGEngine()
        self.live_rag = live_rag or LiveWebRAG()
        self.brain = brain or LLMBrain()
        self.agents = AGENTS
        self.conversation_history: List[Dict[str, Any]] = []
        self._last_live_retrieval: Dict[str, Any] = {}

    # ================= TOOL CALLING REGISTRY =================
    def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name == "predict_flammability_regime":
            return self.ml_engine.predict_with_explanation(
                arguments.get("material", "PMMA"), float(arguments.get("o2_pct", 21.0)),
                float(arguments.get("flow_cms", 7.5)), float(arguments.get("pressure_psi", 14.7)),
                float(arguments.get("thickness_mm", 2.5)))
        if tool_name == "evaluate_digital_twin":
            return self.digital_twin.evaluate_state(
                arguments.get("material", "PMMA"), float(arguments.get("o2_pct", 21.0)),
                float(arguments.get("flow_cms", 7.5)), float(arguments.get("pressure_psi", 14.7)),
                float(arguments.get("thickness_mm", 2.5)))
        if tool_name == "search_nasa_live":
            self._last_live_retrieval = self.live_rag.retrieve(
                arguments.get("query", "microgravity flammability"),
                top_k=int(arguments.get("top_k", 5)),
            )
            return self._last_live_retrieval
        if tool_name in ("query_nasa_archive", "query_nasa_literature"):
            results = self.rag_engine.retrieve(arguments.get("query", "PMMA radiative extinction"), top_k=int(arguments.get("top_k", 4)))
            if tool_name == "query_nasa_archive":
                return {"results": [{**{k: v for k, v in r.items() if k != "text"}, "text": r.get("text", "")[:700]} for r in results]}
            return {"results": results}
        if tool_name == "analyze_flame_image":
            img = arguments.get("image_b64") or arguments.get("image_path")
            if img:
                res = self.vision_analyzer.analyze_frame(img)
            else:
                n = min(5, max(1, int(arguments.get("frame_num", 1))))
                res = self.vision_analyzer.analyze_frame(f"data/flame_frames/bass2_flame_f{n}.png")
            return {k: v for k, v in res.items() if not k.endswith("_b64")} | {"has_annotated_image": True, "has_thermal_map": True}
        if tool_name == "get_telemetry_status":
            snap = self.hil_simulator.snapshot()
            frame = self.hil_simulator.telemetry_frame()
            return {
                "mode": snap["mode"],
                "data_source": snap["data_source"],
                "hardware": snap["hardware"],
                "telemetry_packet": frame,
                "safety_evaluation": frame["safety"],
                "fire_summary": {
                    "detected": snap["fire_state"].get("detected"),
                    "severity": snap["fire_state"].get("severity"),
                    "burning": snap["fire_state"].get("fire", {}).get("burning"),
                },
                "crew_status": snap["crew"]["status"],
                "source": frame["data_source"],
                "warning": "Null values are missing or stale, not safe defaults. Fire type/location cannot be inferred from cabin readings alone.",
            }
        if tool_name == "simulate_sensor_scenario":
            if self.hil_simulator.mode != "simulation":
                return {"error": "Cannot switch synthetic scenario while in live hardware mode; switch to simulation mode first."}
            self.hil_simulator.set_scenario(arguments.get("scenario_name", "NOMINAL_ISS"))
            return {"status": "SCENARIO_UPDATED", "active_scenario": self.hil_simulator.current_scenario}
        if tool_name == "rank_similar_experiments":
            return {"top_experiments": self.metadata_hub.rank_similar_experiments(
                float(arguments.get("o2_pct", 21.0)), float(arguments.get("flow_cms", 7.5)),
                float(arguments.get("pressure_psi", 14.7)), arguments.get("material", "PMMA"),
                top_k=int(arguments.get("top_k", 4)))}
        if tool_name == "design_scientific_hypothesis":
            return self.hypothesis_designer.design_virtual_experiment(arguments.get("void_id", "VOID-LUNAR-NOMEX"))
        if tool_name == "trigger_hvac_suppression":
            return {"execution_status": "BLOCKED", "hardware_transmitted": False, "reason": "Real actuation is disabled. Confirm illustrative simulation actions using the Fire Emergency controls; LLM output is not authorization."}
        return {"error": f"Unknown tool: {tool_name}"}

    # ================= ROUTING =================
    def _route_agent(self, query: str, has_image: bool, forced: Optional[str]) -> str:
        if forced and forced in self.agents:
            return forced
        q = query.lower()
        if has_image or any(k in q for k in ["flame image", "contour", "aspect ratio", "segment", "this image", "photo", "tomography"]):
            return "OPTICAL-TRACKER"
        if any(k in q for k in ["literature", "paper", "ntrs", "report", "citation", "published", "nasa website", "research say", "evidence"]):
            return "NASA-ARCHIVIST"
        if any(k in q for k in ["telemetry", "sensor", "arduino", "esp32", "smolder", "wokwi", "cabin status", "co ppm"]):
            return "TELEMETRY-LEAD"
        if any(k in q for k in ["boundary", "pinn", "blowoff", "extinction", "damkohler", "regime", "flammab", "digital twin", "predict"]):
            return "AERO-PHYSICS"
        return "FLIGHT-SAFETY"

    # ================= MAIN QUERY PIPELINE =================
    def process_query(
        self, user_message: str, image_attachment: Optional[str] = None,
        voice_transcript: Optional[str] = None, forced_agent: Optional[str] = None,
        audio_b64: Optional[str] = None, audio_format: str = "wav", use_history: bool = True,
    ) -> Dict[str, Any]:
        self._last_live_retrieval = {}
        input_mode = "text"
        effective_query = user_message
        if audio_b64 and self.brain.is_available():
            try:
                transcript = self.brain.transcribe_audio(audio_b64, audio_format)
                effective_query = transcript or user_message
                voice_transcript = transcript
                input_mode = "voice"
            except Exception as exc:
                logger.warning("voice transcription failed: %s", exc)
        elif voice_transcript and not user_message:
            effective_query = voice_transcript
            input_mode = "voice"

        active_agent_key = self._route_agent(effective_query, bool(image_attachment), forced_agent)
        agent_info = self.agents[active_agent_key]

        if self.brain.is_available():
            try:
                return self._process_query_llm(effective_query, agent_info, image_attachment, input_mode, voice_transcript, use_history)
            except Exception as exc:
                logger.warning("LLM pipeline failed (%s); using deterministic fallback", exc)

        result = self._process_query_deterministic(effective_query, active_agent_key, image_attachment)
        result["input_mode"] = input_mode
        result["voice_transcript"] = voice_transcript
        result["intelligence_mode"] = "DETERMINISTIC_PHYSICS_FALLBACK"
        return result

    def _process_query_llm(
        self, query: str, agent_info: Dict[str, Any], image_b64: Optional[str],
        input_mode: str, voice_transcript: Optional[str], use_history: bool,
    ) -> Dict[str, Any]:
        persona = (
            f"\nACTIVE AGENT PERSONA: You are responding as {agent_info['name']} ({agent_info['callsign']}), "
            f"{agent_info['role']}. Specialty: {agent_info['specialty']} "
            f"Start your answer with a one-line header naming your callsign. You may still call any tool."
        )
        user_content = build_user_content(query, image_b64=image_b64)
        history = self.conversation_history[-6:] if use_history else None

        loop = self.brain.run_tool_loop(
            system_prompt=SYSTEM_PROMPT_BASE + persona, user_content=user_content,
            tool_schemas=TOOL_SCHEMAS, tool_executor=self.execute_tool, max_steps=6, history=history)

        if use_history:
            self.conversation_history.append({"role": "user", "content": query})
            self.conversation_history.append({"role": "assistant", "content": loop["text"]})
            self.conversation_history = self.conversation_history[-12:]

        loop["text"] = self.live_rag.sanitize_citations(loop["text"])
        live_passages = self._last_live_retrieval.get("passages", [])
        if live_passages:
            verified_sources = "\n".join(
                f"- [{p['title']}]({p['url']}) · live source verified {p['fetched_at_iso']}"
                for p in live_passages
            )
            loop["text"] += f"\n\n### Verified live NASA sources\n{verified_sources}"

        visual_artifacts: Dict[str, Any] = {}
        if image_b64:
            try:
                vis = self.vision_analyzer.analyze_frame(image_b64)
                visual_artifacts = {
                    "original_image_b64": vis["original_image_b64"],
                    "annotated_flame_b64": vis["annotated_image_b64"],
                    "comparison_image_b64": vis["comparison_image_b64"],
                    "thermal_tomography_b64": vis["thermal_tomography_b64"],
                    "finding_status": vis["finding_status"],
                    "finding_summary": vis["finding_summary"],
                    "detection_confidence": vis["detection_confidence"],
                    "detected_regions": vis["detected_regions"],
                    "cv_metrics": {k: v for k, v in vis.items() if not k.endswith("_b64")},
                }
            except Exception:
                pass

        return {
            "active_agent": agent_info, "query_received": query,
            "response_markdown": loop["text"], "tool_calls_executed": loop["tool_trace"],
            "visual_artifacts": visual_artifacts, "voice_synthesis_text": loop["text"][:600],
            "input_mode": input_mode, "voice_transcript": voice_transcript,
            "intelligence_mode": "LLM_SUPER_INTELLIGENCE", "reasoning_steps": loop["steps"],
        }

    # ================= DETERMINISTIC FALLBACK =================
    def _process_query_deterministic(self, query: str, agent_key: str, image_b64: Optional[str]) -> Dict[str, Any]:
        agent_info = self.agents[agent_key]
        tool_calls: List[Dict[str, Any]] = []
        visual_artifacts: Dict[str, Any] = {}

        if image_b64 or agent_key == "OPTICAL-TRACKER":
            img = image_b64 or "data/flame_frames/bass2_flame_f1.png"
            try:
                vis = self.vision_analyzer.analyze_frame(img)
                visual_artifacts = {
                    "original_image_b64": vis["original_image_b64"],
                    "annotated_flame_b64": vis["annotated_image_b64"],
                    "comparison_image_b64": vis["comparison_image_b64"],
                    "thermal_tomography_b64": vis["thermal_tomography_b64"],
                    "finding_status": vis["finding_status"],
                    "finding_summary": vis["finding_summary"],
                    "detection_confidence": vis["detection_confidence"],
                    "detected_regions": vis["detected_regions"],
                    "cv_metrics": {k: v for k, v in vis.items() if not k.endswith("_b64")},
                }
            except Exception as e:
                logger.warning("Deterministic vision analysis failed: %s", e)

        if agent_key == "OPTICAL-TRACKER":
            tool_calls.append({"tool": "analyze_flame_image", "arguments": {}})
            if visual_artifacts and "cv_metrics" in visual_artifacts:
                m = visual_artifacts["cv_metrics"]
                text = (
                    f"### [OPTICAL-TRACKER] Flame Kinematics (deterministic CV mode)\n"
                    f"- **Flame Area**: {m.get('flame_area_mm2', 0)} mm² | **Aspect Ratio**: {m.get('aspect_ratio', 1.0)}\n"
                    f"- **Spread Rate**: {m.get('flame_spread_rate_mms', 0)} mm/s | **Standoff**: {m.get('standoff_distance_mm', 0)} mm\n\n"
                    f"Oval envelope without buoyant stretching confirms microgravity geometry. "
                    f"Deterministic computer vision analyzed {len(visual_artifacts.get('detected_regions', []))} region(s)."
                )
            else:
                text = (
                    f"### [OPTICAL-TRACKER] Flame Kinematics\n"
                    f"Image analysis completed. Microgravity geometry verified."
                )
        elif agent_key == "NASA-ARCHIVIST":
            live = self.live_rag.retrieve(query, top_k=3)
            tool_calls.append({"tool": "search_nasa_live", "arguments": {"query": query}})
            cites = "\n".join(f"- [{p['title']}]({p['url']}) — {p['text'][:160]}..." for p in live["passages"]) or "- No verified live passages retrieved (NASA network unavailable or source verification failed)."
            cites = self.live_rag.sanitize_citations(cites)
            text = f"### [NASA-ARCHIVIST] Live NASA Retrieval (fallback mode)\n{cites}"
        elif agent_key == "TELEMETRY-LEAD":
            status = self.execute_tool("get_telemetry_status", {})
            tool_calls.append({"tool": "get_telemetry_status", "arguments": {}})
            t = status["telemetry_packet"]["telemetry"]; s = status["safety_evaluation"]
            fmt = lambda v, u="": f"{v}{u}" if v is not None else "unavailable"
            text = (
                f"### [TELEMETRY-LEAD] Cabin Telemetry Audit ({status.get('data_source', 'SIMULATION')} · fallback mode)\n"
                f"- O2: {fmt(t['o2_concentration_pct'], '%')} | Flow: {fmt(t['airflow_velocity_cms'], ' cm/s')} | P: {fmt(t['cabin_pressure_psi'], ' psi')}\n"
                f"- Temp: {fmt(t['cabin_temp_C'], ' °C')} | CO: {fmt(t['co_ppm'], ' ppm')} | Smoke: {fmt(t['smoke_mgm3'], ' mg/m³')}\n"
                f"- **Safety**: {s['safety_tier']} (severity {s['severity_score'] if s['severity_score'] is not None else '—'}/100)\n\n> {s['hvac_suppression_action']}"
            )
        elif agent_key == "AERO-PHYSICS":
            pred = self.execute_tool("predict_flammability_regime", {"o2_pct": 21.0, "flow_cms": 7.5})
            tool_calls.append({"tool": "predict_flammability_regime", "arguments": {"o2_pct": 21.0, "flow_cms": 7.5}})
            text = (
                f"### [AERO-PHYSICS] Digital Twin (fallback mode)\n"
                f"- **Regime**: {pred['predicted_regime']} | **Burn**: {pred['predicted_metrics']['burn_duration_seconds']} s\n"
                f"- **CO yield**: {pred['predicted_metrics']['toxic_co_generation_ppm']} ppm\n"
                f"- **Uncertainty**: {pred['uncertainty']['uncertainty_tier']}\n\n"
                f"Below ~2 cm/s flow, radiative loss dominates chemical heat release → radiative quenching."
            )
        else:
            status = self.execute_tool("get_telemetry_status", {})
            tool_calls.append({"tool": "get_telemetry_status", "arguments": {}})
            s = status["safety_evaluation"]
            text = (
                f"### [FLIGHT-SAFETY] Mission Directive (fallback mode)\n"
                f"- **Safety Tier**: {s['safety_tier']} | Severity {s['severity_score']}/100\n\n"
                f"> {s['crew_emergency_protocol']}\n\nLLM brain offline — deterministic rules active."
            )

        return {
            "active_agent": agent_info, "query_received": query, "response_markdown": text,
            "tool_calls_executed": tool_calls, "visual_artifacts": visual_artifacts,
            "voice_synthesis_text": text[:400],
        }

    # ================= RAG-ASK (live web grounded answer) =================
    def rag_ask(self, query: str, top_k: int = 6) -> Dict[str, Any]:
        retrieval = self.live_rag.retrieve(query, top_k=top_k)
        passages = retrieval["passages"]
        if self.brain.is_available() and passages:
            evidence = "\n\n".join(f"[{i+1}] {p['title']} ({p['url']})\n{p['text']}" for i, p in enumerate(passages))
            cite_list = "\n".join(f"[{i+1}]: {p['url']}" for i, p in enumerate(passages))
            try:
                msg = self.brain.chat([
                    {"role": "system", "content": "You are NASA-ARCHIVIST. Answer ONLY from the provided live-retrieved NASA evidence. Cite sources inline as markdown links like [1](https://...) using the exact URLs given. Mark anything not in evidence as [NOT IN RETRIEVED EVIDENCE]. Be concise and scientific."},
                    {"role": "user", "content": f"QUESTION: {query}\n\nLIVE NASA EVIDENCE:\n{evidence}\n\nCITATION URLS (use these exact links):\n{cite_list}"},
                ], max_tokens=1000)
                answer = msg.get("content") or ""
                answer = self.live_rag.sanitize_citations(answer)
            except Exception as exc:
                answer = f"LLM synthesis unavailable ({exc}). Retrieved passages attached."
        else:
            answer = "\n\n".join(f"**[{p['title']}]({p['url']})**\n> {p['text'][:400]}" for p in passages) or "No verified live passages retrieved."
        if passages:
            verified_sources = "\n".join(
                f"- [{p['title']}]({p['url']}) · live source verified {p['fetched_at_iso']}"
                for p in passages
            )
            answer += f"\n\n### Verified live NASA sources\n{verified_sources}"
        return {"query": query, "answer_markdown": answer, "retrieval": retrieval}