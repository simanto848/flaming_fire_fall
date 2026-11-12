import asyncio
import contextlib
import ipaddress
import logging
import os
from pathlib import Path
import secrets

from fastapi import APIRouter, Body, HTTPException, Request, WebSocket, WebSocketDisconnect
from shunnoshikha.fire_emergency import COMPARTMENTS, ADJACENCY, FIRE_TYPES
from shunnoshikha.sensor_service import PRESETS, SENSOR_SPECS
from shunnoshikha.hil_telemetry_simulator import HIL_SCENARIOS

ROOT = Path(__file__).resolve().parent.parent


def make_sensor_router(service, brain=None):
    router = APIRouter()
    tasks = []

    def envelope():
        with service.lock:
            s = service.snapshot()
            s["telemetry_frame"] = service.telemetry_frame()
            return s

    def call(fn, *args):
        try:
            return fn(*args)
        except (ValueError, TypeError) as exc:
            raise HTTPException(400, str(exc)) from exc

    def gateway_only(request):
        host = request.client.host if request.client else ""
        try:
            local = ipaddress.ip_address(host).is_loopback
        except ValueError:
            local = False
        if not local or request.headers.get("origin"):
            raise HTTPException(403, "Only the local non-browser USB gateway may submit hardware readings")
        token = os.environ.get("SHUNNO_GATEWAY_TOKEN", "")
        auth = request.headers.get("Authorization", "")
        bearer = auth[7:] if auth.startswith("Bearer ") else ""
        supplied = request.headers.get("X-Gateway-Token") or bearer
        if token and not secrets.compare_digest(token, supplied):
            raise HTTPException(401, "Invalid gateway token")

    async def tick_loop():
        while True:
            try:
                service.advance(0.5)
            except Exception:
                logging.getLogger(__name__).exception("Sensor simulation tick failed; continuing the simulation loop")
            await asyncio.sleep(0.5)

    async def assessment_loop():
        while True:
            if service.assessment_due():
                try:
                    await asyncio.to_thread(service.assess, brain)
                except Exception:
                    logging.getLogger(__name__).exception("Emergency assessment failed")
            await asyncio.sleep(2)

    @router.on_event("startup")
    async def start_tasks():
        tasks.extend([asyncio.create_task(tick_loop()), asyncio.create_task(assessment_loop())])

    @router.on_event("shutdown")
    async def stop_tasks():
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    @router.get("/api/sensors/state")
    def state():
        return envelope()

    @router.get("/api/sensors/schema")
    def schema():
        return {"sensors": SENSOR_SPECS, "presets": PRESETS, "reference_mapping": True, "hardware_actuation_enabled": False,
                "gateway_command": "python3 -m shunnoshikha.serial_gateway --list",
                "notes": "Reference Uno pins. Actual calibrated sensor drivers and screenshot-specific wiring are not supplied. USB serial is receive-only."}

    @router.post("/api/sensors/mode")
    def mode(payload: dict = Body(...)):
        call(service.set_mode, payload.get("mode"))
        return envelope()

    @router.post("/api/sensors/simulation")
    def simulation(payload: dict = Body(...)):
        call(service.patch_environment, payload.get("sensors", payload))
        return envelope()

    @router.post("/api/sensors/ingest")
    async def ingest(request: Request, payload: dict = Body(...)):
        gateway_only(request)
        return call(service.ingest, payload)

    @router.post("/api/sensors/gateway-error")
    def gateway_error(request: Request, payload: dict = Body(...)):
        gateway_only(request)
        service.gateway_error(payload.get("message", "Gateway connection error"))
        return {"recorded": True, "hardware_transmitted": False}

    @router.get("/api/telemetry/packet")
    def packet():
        f = service.telemetry_frame()
        return {"telemetry_packet": f, "safety_evaluation": f["safety"]}

    @router.get("/api/telemetry/scenarios")
    def scenarios():
        return {"scenarios": HIL_SCENARIOS, "active": service.current_scenario}

    @router.post("/api/telemetry/set-scenario")
    def scenario(payload: dict = Body(...)):
        call(service.set_scenario, payload.get("scenario_key"))
        return {"status": "SUCCESS", "active_scenario": service.current_scenario}

    @router.get("/api/telemetry/arduino-firmware")
    def firmware(board: str = "uno"):
        if board == "uno":
            path = ROOT / "hardware/arduino_uno/arduino_uno.ino"
            return {"cpp_code": path.read_text(), "board": "Arduino Uno", "reference_only": True}
        if board == "esp32":
            from shunnoshikha.hil_telemetry_simulator import HILSensorSimulator
            return {"cpp_code": HILSensorSimulator().generate_arduino_cpp_firmware(), "board": "ESP32", "reference_only": True}
        raise HTTPException(400, "Choose uno or esp32")

    @router.get("/api/early-warning/limits")
    def limits():
        with service.lock:
            th = service.engine.thresholds
            legacy_limits = {
                "co_caution_ppm": th["co_ppm"]["normal"][1],
                "co_warning_ppm": th["co_ppm"]["warn"][1],
                "co_critical_ppm": th["co_ppm"]["crit"][1],
                "o2_max_nominal_pct": th["o2_pct"]["normal"][1],
                "o2_high_risk_pct": th["o2_pct"]["warn"][1],
                "min_flow_stagnant_cms": 1.5,
                "max_temp_nominal_C": th["temp_C"]["normal"][1],
                "temp_warning_C": th["temp_C"]["warn"][1],
            }
            return {
                "limits": legacy_limits,
                "thresholds": th,
                "standard": "Configurable illustrative reference bands, not universal safety limits",
            }

    @router.post("/api/early-warning/hvac-suppress")
    def old_hvac(payload: dict = Body(...)):
        actions = {"ACTION_EMERGENCY_SHUTDOWN": "emergency_isolation", "ACTION_ISOLATE_VENTILATION": "emergency_isolation", "ACTION_BALANCED_MIXING": "emergency_alert", "ACTION_NOMINAL_MAINTENANCE": "emergency_alert"}
        code = payload.get("action_code")
        if code not in actions:
            raise HTTPException(400, "Unknown HVAC action")
        res = call(service.suppress, actions[code], payload.get("confirmed"))
        return {
            **res,
            "action_executed": code,
            "confirmation": f"{code} applied in simulation mode ({res['command_id']}); no physical HVAC or actuator commanded.",
        }

    @router.get("/api/prevention/state")
    def prevention_state():
        with service.lock:
            return service.prevention.state()

    @router.post("/api/prevention/config")
    def prevention_config(payload: dict = Body(...)):
        with service.lock:
            service._require_simulation()
            if payload.get("armed") is False and payload.get("confirmed") is not True:
                raise HTTPException(400, "Standing down autonomous prevention requires confirmed=true.")
            return service.prevention.configure(payload)

    @router.post("/api/prevention/assess")
    def prevention_assess():
        with service.lock:
            service.prevention.assess()
            return service.prevention.state()

    @router.get("/api/prevention/log")
    def prevention_log():
        with service.lock:
            return {"log": list(service.prevention.log)}

    @router.get("/api/fire/layout")
    def layout():
        return {"compartments": COMPARTMENTS, "adjacency": ADJACENCY}

    @router.get("/api/fire/scenarios")
    def fire_scenarios():
        return {"fire_types": FIRE_TYPES}

    @router.get("/api/fire/state")
    def fire_state():
        return service.snapshot()["fire_state"]

    @router.post("/api/fire/config")
    def config(payload: dict = Body(...)):
        call(service.configure, payload)
        return fire_state()

    @router.post("/api/fire/start")
    def start():
        call(service.fire_action, "start")
        return fire_state()

    @router.post("/api/fire/pause")
    def pause():
        call(service.fire_action, "pause")
        return fire_state()

    @router.post("/api/fire/reset")
    def reset():
        call(service.fire_action, "reset")
        return fire_state()

    @router.post("/api/fire/stop")
    def stop():
        call(service.fire_action, "stop")
        return fire_state()

    @router.post("/api/fire/speed")
    def speed(payload: dict = Body(...)):
        call(service.configure, {"speed": payload.get("speed")})
        return fire_state()

    @router.get("/api/fire/suppression/recommendation")
    def recommendation():
        with service.lock:
            if service.mode == "live":
                return {"fire_name": "Unknown fire classification", "fire_class": "unverified", "recommended_method": "Validated spacecraft procedure required; live actuation locked", "reasoning": "Ambient sensors alone do not determine fire type or authorize an agent", "warnings": ["No real command will be transmitted"], "water_compatible": False, "water_allowed": False, "water_note": "Water authorization unavailable", "mode": "LIVE_HARDWARE", "auto_activation": False}
            result = service.engine.suppression_recommendation()
            result["mode"] = "SIMULATION"
            return result

    @router.post("/api/fire/suppression")
    def suppress(payload: dict = Body(...)):
        return call(service.suppress, payload.get("action"), payload.get("confirmed"))

    @router.get("/api/fire/thresholds")
    def thresholds():
        return {"thresholds": service.snapshot()["fire_state"]["thresholds"]}

    @router.post("/api/fire/thresholds")
    def set_thresholds(payload: dict = Body(...)):
        return call(service.set_thresholds, payload.get("thresholds", payload))

    @router.get("/api/fire/crew")
    def crew():
        return service.snapshot()["crew"]

    @router.post("/api/fire/ai-assessment")
    def assess():
        return service.assess(brain)

    @router.get("/api/fire/events")
    def events():
        return {"events": service.snapshot()["fire_state"]["events"]}

    @router.get("/api/fire/report")
    def report(format: str = "json"):
        if format not in ("md", "json"):
            raise HTTPException(400, "Choose md or json")
        return service.report()

    @router.post("/api/presentation/select")
    def select_presentation(payload: dict = Body(...)):
        call(service.select_preset, payload.get("scenario"), payload.get("confirmed", False))
        return envelope()

    @router.post("/api/presentation/action")
    def presentation_action(payload: dict = Body(...)):
        call(service.presentation_action, payload.get("action"))
        return envelope()

    async def stream(ws, reader):
        await ws.accept()
        try:
            while True:
                await ws.send_json(reader())
                await asyncio.sleep(0.5)
        except WebSocketDisconnect:
            return

    @router.websocket("/ws/sensors")
    async def sensors_ws(ws: WebSocket):
        await stream(ws, envelope)

    @router.websocket("/ws/telemetry")
    async def telemetry_ws(ws: WebSocket):
        await stream(ws, service.telemetry_frame)

    @router.websocket("/ws/fire")
    async def fire_ws(ws: WebSocket):
        await stream(ws, fire_state)

    return router
