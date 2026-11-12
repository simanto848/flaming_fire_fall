# 🔥 ShunnoShikha AI — Spacecraft Microgravity Fire-Safety Mission Control

> **NASA Space Apps Challenge · Flame in Freefall** — Team HASH
> *Search. Simulate. Track. Reason. Verify. Monitor. Alert.*

An integrated scientific-intelligence and digital-twin ecosystem for spacecraft fire safety,
grounded in NASA's **Physical Science Informatics (PSI)** repository (BASS / BASS-II, FGM
Tomography, Saffire, FLEX) and powered by a **local multimodal super-intelligence** with
autonomous tool calling, vision, and voice understanding.

---

## ✨ What's inside

| # | Module | What it does |
|---|--------|--------------|
| 1 | **Cross-Investigation Metadata Hub** | Harmonizes 200 flight tests (BASS-II 50, Saffire 50, FGM 3, **97 real FLEX droplet records**), filters sensor anomalies, physics-weighted similarity ranking against exploration atmospheres. |
| 2 | **3-Regime Combustion Digital Twin** | Interactive U-shaped flammability boundary: Radiative Extinction ↔ Sustained Burn ↔ Blowoff. Damköhler & radiative-loss physics, Lunar/Mars/Gateway projections. |
| 3 | **SHAP-Explainable ML + Uncertainty** | XGBoost regime classifier, TreeSHAP feature attribution, Mahalanobis out-of-distribution uncertainty for untested habitats. |
| 4 | **Computer-Vision Flame Analyzer** | Frame-by-frame oval-flame segmentation: area, aspect ratio, spread rate, standoff, pseudo-color thermal tomography. Upload your own frames. |
| 5 | **5-Agent Scientific Super-Intelligence** | LLM-driven ReAct tool-calling loop over all modules. Vision + voice + text. Five specialist personas. |
| 6 | **Autonomous Hypothesis Designer** | Detects parameter voids and designs testable virtual flight experiments. |
| 7 | **Hardware-in-the-Loop (HIL) Simulator** | Virtual ESP32/UNO cabin telemetry @1 Hz over WebSocket, 4 emergency scenarios, Wokwi-ready Arduino firmware. |
| 8 | **4-Tier Early-Warning System** | NASA-STD-3001/6001 thresholds → Normal/Caution/Warning/Critical + automated HVAC suppression. |
| 9 | **Fire Emergency Module** | Fire detection & monitoring, deterministic compartment fire-spread simulation (5 fire types, 1–10x), fire-type-specific suppression control with water gating + confirmation dialogs, configurable atmospheric thresholds, crew-survival analysis, AI emergency intelligence (structured JSON), and downloadable incident reports. Interactive animated spacecraft floor plan. |
| 10 | **Autonomous Fire Prevention** | A pre-ignition guard, **armed by default**, that makes fire *unable to start*: ignition-kernel quench (vetoes ignition attempts), oxidizer conditioning (trims O₂ enrichment into the crew-safe band, never below 19.5%), and ignition-source isolation (de-energizes circuits at elevated risk). Live risk gauge, aggressiveness slider, three independent levers, intervention log, and confirmed stand-down / re-arm. Re-arming mid-incident instantly quenches any flame. |
| ★ | **Live NASA Web RAG** | Retrieval **directly from NASA's live websites** — PSI repository API + NTRS search API + NASA Glenn pages. **No papers downloaded.** Every passage cites its source URL + fetch time. |

---

## 🧠 The Super-Intelligence AI

The agent runs on a **local omni-model** via [Ollama](https://ollama.com) (default `lfm3-omni:latest`),
which natively supports **completion + vision + tools + audio**. Verified capabilities:

- **Tool calling** — autonomously calls the digital twin, SHAP model, live RAG, flame vision, telemetry, ranker, hypothesis designer, and HVAC suppression, then reasons over the real results.
- **Vision** — understands uploaded flame images alongside the OpenCV kinematics pipeline.
- **Voice understanding** — transcribes and comprehends spoken queries (server-side omni audio, plus browser speech recognition in the UI).
- **Text generation & reasoning** — grounded, cited mission-control answers that label `[NASA OBSERVED]` vs `[MODEL EXTRAPOLATION]`.

No API key required. To use a cloud provider instead, set `SHUNNO_LLM_BASE_URL`, `SHUNNO_LLM_MODEL`,
`SHUNNO_LLM_API_KEY` (any OpenAI-compatible endpoint). If no LLM is reachable, the platform
**degrades gracefully** to a deterministic physics pipeline.

---

## 🚀 Quick start (deploy now)

### One command
```bash
./start.sh            # launches Ollama (if needed) + backend (:8000) + frontend (:3000)
# or production frontend:
./start.sh prod
```
Open **http://localhost:3000** → the **AI Command** tab is the chat console; **NASA Live RAG** is the retrieval console.

### Manually
```bash
# 1. Local LLM (optional but recommended)
ollama serve &
ollama pull lfm3-omni        # vision + tools + audio
# (fallback vision model) ollama pull qwen2.5vl:3b

# 2. Backend
./run_backend.sh             # FastAPI on :8000, docs at /docs

# 3. Frontend
./run_frontend.sh          # Next.js dev on :3000
./run_frontend.sh start    # production build + serve
```

### Requirements
- **Python 3.11+** with: `fastapi uvicorn httpx numpy pandas scikit-learn xgboost shap opencv-python joblib scipy beautifulsoup4 lxml`
- **Node.js 18+** (or Bun) for the frontend
- **Ollama** for the full super-intelligence (optional)

---

## 🗂️ Architecture

```
.
├── start.sh / run_backend.sh / run_frontend.sh   # launchers
├── shunnoshikha/
│   ├── backend_api.py            # FastAPI REST + WebSocket (all 8 modules + AI)
│   ├── llm_brain.py              # OpenAI-compatible multimodal client + ReAct tool loop
│   ├── live_web_rag.py           # LIVE NASA retrieval (PSI API + NTRS API + web pages)
│   ├── multi_agent_system.py     # 5-agent super-intelligence + tool registry
│   ├── metadata_hub.py           # Module 1: unified PSI matrix + ranker + anomaly filter
│   ├── digital_twin.py           # Module 2: 3-regime physics boundary
│   ├── shap_uncertainty_engine.py# Module 3: XGBoost + TreeSHAP + Mahalanobis OOD
│   ├── flame_vision.py           # Module 4: OpenCV flame kinematics + tomography
│   ├── hypothesis_designer.py    # Module 6: parameter-void experiment designer
│   ├── hil_telemetry_simulator.py# Module 7: ESP32/UNO telemetry + Arduino firmware
│   ├── early_warning_system.py   # Module 8: 4-tier safety + HVAC protocols
│   ├── fire_emergency.py         # Module 9: deterministic fire spread + suppression + crew survival
│   └── fire_prevention.py        # Module 10: autonomous pre-ignition guard (armed by default)
├── rag/rag_engine.py             # deep archive index (complements live web RAG)
├── data/psi_metadata/            # live-fetched NASA PSI investigation metadata
├── frontend/                     # Next.js mission-control WebApp
│   ├── app/                      # layout, global theme, page shell
│   ├── components/               # 10 module views + shared UI kit
│   │   ├── fire/                 # Module 9: FireConsole + 7 sections + SpacecraftMap
│   │   ├── three/                # 3D suite: StationScene, BoundaryScene, FlameChamber, InvestigationGalaxy
│   │   └── PreventionPanel.tsx   # Module 10: arm/disarm, risk gauge, levers, intervention log
│   └── lib/                      # API client + WebSocket telemetry hook + fire hook
├── test_fire_engine.py           # Module 9 unit tests (determinism, gating, crew, report)
└── *.csv                         # compiled NASA flight datasets (incl. real FLEX table)
```

### Live NASA data sources (verified)
- **PSI repository API** — `https://psi.nasa.gov/geode-py/ws/repo/search` (real investigation metadata: objectives, hypothesis, hardware, publications)
- **NTRS search API** — `https://ntrs.nasa.gov/api/citations/search` (live citations + abstracts + authors)
- **NASA Glenn** — `https://www1.grc.nasa.gov/space/iss-research/` and the MSG facility page
- Verified investigations: **PSI-26 = BASS**, **PSI-62 = FGM Tomography**, **PSI-142 = Cool-Flame/FLEX**, with PSI-25 (BASS-II) referenced as related.

---

## 🔌 API surface (selected)

`GET /api/health` · `GET /api/ai/status` · `POST /api/agent/chat` · `POST /api/rag/ask` ·
`POST /api/rag/live-search` · `POST /api/voice/transcribe` · `POST /api/vision/analyze-upload` ·
`POST /api/vision/describe` · `POST /api/digital-twin/evaluate` · `GET /api/digital-twin/boundary-surface` ·
`POST /api/ml/predict-shap` · `POST /api/metadata/rank` · `POST /api/hypothesis/design` ·
`POST /api/telemetry/set-scenario` · `GET /api/telemetry/arduino-firmware` ·
`POST /api/early-warning/hvac-suppress` · `WS /ws/telemetry`

**Module 9 (Fire Emergency):** `GET /api/fire/layout` · `GET /api/fire/scenarios` · `GET /api/fire/state` ·
`POST /api/fire/config|start|pause|reset|speed` · `GET /api/fire/suppression/recommendation` ·
`POST /api/fire/suppression` · `GET|POST /api/fire/thresholds` · `GET /api/fire/crew` ·
`POST /api/fire/ai-assessment` · `GET /api/fire/events` · `GET /api/fire/report?format=md|json` · `WS /ws/fire`

**Module 10 (Autonomous Prevention):** `GET /api/prevention/state` · `POST /api/prevention/config`
(stand-down requires `confirmed=true`) · `POST /api/prevention/assess` · `GET /api/prevention/log` ·
`GET /api/ml/metrics` (honest holdout metrics for the distilled classifiers)

> **Fire-module safety:** educational deterministic simulation only; all outputs labeled SYNTHETIC/SIMULATION.
> Water is never a universal suppressant and is blocked for energized-electrical / Li-ion / flammable-liquid fires
> unless an approved procedure permits. Every activation requires explicit confirmation and is logged.
> Crew survival windows are assumption-based educational estimates, not medical/operational predictions.

Full interactive docs: **http://localhost:8000/docs**

---

## 🎮 Mission-control UI

Dark aerospace theme with live WebSocket telemetry, animated gauges, sparklines, a steerable
flammability-boundary heatmap, SHAP bars, thermal tomography, and a full chat console with
agent routing, tool-call traces, image attachment, voice input, and spoken responses.
Responsive down to mobile with a slide-over navigation deck.

### 🛰️ Everything in 3D

The primary visualizations are real-time **Three.js** scenes (drag to orbit, wheel to zoom,
damped controls, capped pixel ratio, reused geometry/materials, dramatic lighting + fog + particles):

- **Station fire twin** — a full ISS-style station (modules, truss, solar arrays, Cupola, Earth limb)
  with per-compartment spherical 0-g flames, drifting smoke, suppression mist, and a green prevention
  shield. Click-to-pick ignition compartment; a shockwave rings the station when an ignition is quenched.
- **Flammability boundary manifold** — the U-shaped 3-regime surface (Radiative Extinction / Sustained
  Burn / Blowoff) with live probe, atmosphere beacons (ISS / Gateway / Lunar EVA / Mars), and material,
  pressure, O₂ and airflow controls.
- **Single-sample flame chamber** — a glass diffusion-flame chamber whose spherical flame stretches
  toward blowoff as forced flow rises; fuel, O₂, flow and pressure sliders drive the digital twin live.
- **PSI investigation galaxy** — all 200 flight tests placed in (O₂, airflow, pressure) space, colored by
  investigation and sized by flame-spread rate, with a target-atmosphere probe and physics-weighted ranking.

### 🛡️ "Fire cannot start" guarantee

While Module 10 is **armed**, any ignition attempt whose twin-derived risk exceeds the
aggressiveness-derived block threshold is vetoed and logged (`ignitions_blocked`), oxygen enrichment is
trimmed into the crew-safe band, and ignition sources are isolated. Standing down is an explicit,
confirmed operator action; re-arming immediately quenches any existing flame. Verified end-to-end:
armed → ignition blocked; stand down → fire spreads in 3D; re-arm → autonomous quench → extinguished.

> **Honesty note:** compiled CSV flight tables are calibrated to NASA reports; the FLEX droplet
> table and PSI investigation metadata are fetched from NASA's live repositories. ML/Digital-Twin
> outputs for untested exploration atmospheres are explicitly flagged as OOD extrapolations.
>
> **ML integrity:** training labels are reconciled against the physics digital twin (single source of
> truth), fixing earlier contradictory labels. The XGBoost regime classifier is distilled from the twin
> and reports stratified holdout accuracy/F1 via `GET /api/ml/metrics`; the Qwen-0.6B LoRA classifier is
> retrained on the same clean, class-balanced data with early stopping on validation F1. Reported numbers
> are measured on a held-out test split, never fabricated.