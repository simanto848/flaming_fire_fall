import copy
import math
import threading
import time
from collections import deque
from datetime import datetime, timezone

from shunnoshikha.fire_emergency import (
    FireSimulationEngine, FIRE_TYPES, COMPARTMENTS, ADJACENCY, _band_status,
    SIMULATION_DISCLAIMER, ENVIRONMENTAL_TTC_LABEL, ENVIRONMENTAL_TTC_ASSUMPTIONS,
    build_ai_assessment,
)
from shunnoshikha.fire_prevention import FirePreventionSystem
from shunnoshikha.digital_twin import CombustionDigitalTwin

SENSOR_SPECS = {
    "o2_pct": {"label": "Oxygen", "unit": "%", "pin": "A0", "min": 0, "max": 100},
    "co_ppm": {"label": "Carbon monoxide", "unit": "ppm", "pin": "A1", "min": 0, "max": 10000},
    "co2_ppm": {"label": "Carbon dioxide", "unit": "ppm", "pin": "A4/A5 (I2C)", "min": 0, "max": 1000000},
    "temp_C": {"label": "Temperature", "unit": "°C", "pin": "D2", "min": -40, "max": 300},
    "humidity_pct": {"label": "Humidity", "unit": "%", "pin": "D2", "min": 0, "max": 100},
    "smoke_mgm3": {"label": "Particulate mass", "unit": "mg/m³", "pin": "A2", "min": 0, "max": 1000},
    "pressure_kpa": {"label": "Cabin pressure", "unit": "kPa", "pin": "A4/A5 (I2C)", "min": 0.1, "max": 200},
    "airflow_cms": {"label": "Ventilation", "unit": "cm/s", "pin": "A3", "min": 0, "max": 100},
}
UNIT_ALIASES = {"C": "°C", "mg/m3": "mg/m³"}
PRESETS = {
    "normal": {"name": "Normal spacecraft", "description": "No ignition; all simulated sensors nominal."},
    "electrical": {"name": "Electrical fire", "description": "Avionics compartment ignition; observe smoke transport and toxic gases."},
    "battery": {"name": "Battery thermal event", "description": "Illustrative lithium-ion thermal event; no water authorization."},
    "critical": {"name": "Critical cabin conditions", "description": "Low oxygen with high CO, CO2, heat and smoke; no asserted fire classification."},
    "suppression": {"name": "Successful simulated suppression", "description": "Electrical ignition; scripted illustrative suppressant starts at t=15 s after confirmation."},
}
STALE_AFTER_SECONDS = 5.0


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def finite_number(value, spec):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Sensor value must be a finite number")
    if not spec["min"] <= value <= spec["max"]:
        raise ValueError(f"{spec['label']} must be between {spec['min']} and {spec['max']} {spec['unit']}")
    return float(value)


def environment_assessment(values, thresholds):
    bands = {k: _band_status(values[k], th) if values.get(k) is not None else "UNKNOWN" for k, th in thresholds.items()}
    level = max(({"OK": 0, "CAUTION": 1, "WARNING": 2, "CRITICAL": 3, "UNKNOWN": 0}[s] for s in bands.values()), default=0)
    incomplete = "UNKNOWN" in bands.values()
    status = ["SAFE", "CAUTION", "DANGER", "CRITICAL"][level]
    if incomplete and level < 2:
        status = "UNKNOWN"
    risks = {}
    for key, risk in [("o2_pct", "oxygen"), ("co_ppm", "toxic_gas"), ("co2_ppm", "co2"), ("temp_C", "heat"), ("smoke_mgm3", "smoke"), ("humidity_pct", "humidity"), ("pressure_kpa", "pressure")]:
        v = values.get(key)
        if v is None:
            risks[risk] = None
            continue
        th = thresholds[key]
        if v < th["normal"][0]:
            ratio = (th["normal"][0] - v) / max(0.001, th["normal"][0] - th["crit"][0])
        else:
            ratio = (v - th["normal"][1]) / max(0.001, th["crit"][1] - th["normal"][1])
        risks[risk] = round(min(1, max(0, ratio)), 3)
    reasons = [f"{thresholds[k]['label']}: {values[k]:.2f} {thresholds[k]['unit']} ({v})" for k, v in bands.items() if v not in ("OK", "UNKNOWN")]
    if incomplete:
        reasons.append("Missing, uncalibrated or stale channels prevent a complete habitability assessment.")
    return {
        "status": status, "species_status": bands, "risks": risks,
        "risk_basis": "Configured environmental threshold bands on available channels, not medical probabilities.",
        "habitability": "UNKNOWN" if incomplete else ("HABITABLE" if level <= 1 else "DEGRADED" if level == 2 else "NOT HABITABLE"),
        "evacuation_urgency": {"SAFE": "ROUTINE", "CAUTION": "MONITOR", "DANGER": "REVIEW EMERGENCY PROCEDURE", "CRITICAL": "URGENT CREW / GROUND REVIEW", "UNKNOWN": "VERIFY SENSOR COVERAGE"}[status],
        "explanation": "; ".join(reasons) or "Measured channels meet the configured reference bands; this is not a certified safety determination.",
        "time_to_critical_s": None, "time_to_critical_label": ENVIRONMENTAL_TTC_LABEL,
        "time_to_critical_assumptions": ["Unavailable in live hardware mode: trend extrapolation requires continuous calibrated channels."],
        "survival_range": None,
        "disclaimer": "Environmental threshold assessment only. No human survival time is inferred.",
    }


class SensorDataService:
    def __init__(self, engine=None, twin=None, clock=time.monotonic):
        self.engine = engine or FireSimulationEngine()
        self.twin = twin or CombustionDigitalTwin()
        self.prevention = FirePreventionSystem(self.engine, self.twin)
        self.engine.prevention = self.prevention
        self.clock = clock
        self.lock = threading.RLock()
        self.mode = "simulation"
        self.revision = 0
        self.timestamp = utc_now()
        self.elapsed = 0.0
        self.preset = "normal"
        self.presentation = {"scenario": "normal", "status": "idle", "scripted_suppression_confirmed": False}
        self.history = deque(maxlen=240)
        self.previous = {}
        self.last_readings = {}
        self.last_received = None
        self.last_received_at = None
        self.hardware_board = "Arduino Uno"
        self.device_id = None
        self.sequence = -1
        self.packet_times = deque(maxlen=20)
        self.errors = deque(maxlen=50)
        self.hardware_events = deque(maxlen=500)
        self._last_hardware_status = "disconnected"
        self._last_live_crew = "UNKNOWN"
        self.assessment = build_ai_assessment(self.engine.state(), brain=None)
        self.assessment.update(data_source="SIMULATION", assessed_revision=0, assessed_at=self.timestamp)
        self._assessment_signature = None
        self._assessment_requested_at = -1e9
        self._assessment_busy = False
        self._assessment_lock = threading.Lock()
        self._record()

    def _require_simulation(self):
        if self.mode != "simulation":
            raise ValueError("Simulation controls are disabled in live mode; real hardware actuation is locked.")

    def _bump(self):
        self.revision += 1
        self.timestamp = utc_now()

    def _values(self):
        if self.mode == "simulation":
            return {**self.engine.atmosphere, "airflow_cms": self.engine.config["ventilation_cms"]}
        connected = self.last_received is not None and self.clock() - self.last_received <= STALE_AFTER_SECONDS
        return {key: (self.last_readings.get(key, {}).get("value") if connected and self.last_readings.get(key, {}).get("status") not in ("missing", "disconnected", "uncalibrated", "stale") else None) for key in SENSOR_SPECS}

    def _record(self):
        values = self._values()
        self.history.append({"revision": self.revision, "t": round(self.elapsed, 3), "timestamp": self.timestamp, "mode": self.mode, **values,
                             "intensity": sum(c["intensity"] for c in self.engine.compartments.values()) if self.mode == "simulation" else None,
                             "burning": sum(c["on_fire"] for c in self.engine.compartments.values()) if self.mode == "simulation" else None})

    def advance(self, dt=0.5):
        with self.lock:
            self.elapsed += dt
            if self.mode == "simulation":
                self.previous = self._values()
                self.engine.advance(dt)
                self.prevention.tick(dt * self.engine.config["speed"])
                if self.presentation["status"] == "running" and self.presentation["scenario"] == "suppression" and self.engine.sim_time >= 15 and not self.engine.suppression["active"] and self.presentation["scripted_suppression_confirmed"]:
                    self.engine.activate_suppression("activate_suppressant", confirmed=True)
                    self.presentation["scripted_suppression_confirmed"] = False
                self._bump()
                if self.engine.status != "paused":
                    self._record()
            else:
                status = self.hardware_status()["status"]
                if status != self._last_hardware_status:
                    self._last_hardware_status = status
                    self._hardware_log("connection", f"Gateway {status}")
                    self._bump()
                    self._record()

    def set_mode(self, mode):
        if mode not in ("simulation", "live"):
            raise ValueError("Mode must be simulation or live")
        with self.lock:
            if mode != self.mode:
                self.engine.pause()
                self.presentation["status"] = "paused"
                self.mode = mode
                self.history.clear()
                self.previous = {}
                self.assessment = None
                self._assessment_signature = None
                self._assessment_requested_at = -1e9
                if mode == "live":
                    self.last_readings = {}
                    self.last_received = None
                    self.last_received_at = None
                    self.packet_times.clear()
                    self.sequence = -1
                    self.hardware_events.clear()
                    self._last_live_crew = "UNKNOWN"
                self._bump()
                self._record()
                baseline_state = self.snapshot()["fire_state"]
                self.assessment = build_ai_assessment(baseline_state, brain=None)
                self.assessment.update(data_source=baseline_state["data_source"], assessed_revision=self.revision, assessed_at=self.timestamp)
            return self.snapshot()

    def patch_environment(self, patch):
        if not isinstance(patch, dict) or not patch:
            raise ValueError("Provide sensor values")
        unknown = set(patch) - set(SENSOR_SPECS)
        if unknown:
            raise ValueError(f"Unknown sensor keys: {', '.join(sorted(unknown))}")
        validated = {k: finite_number(v, SENSOR_SPECS[k]) for k, v in patch.items()}
        with self.lock:
            self._require_simulation()
            self.previous = self._values()
            for k, v in validated.items():
                if k == "airflow_cms":
                    self.engine.config["ventilation_cms"] = v
                else:
                    self.engine.atmosphere[k] = v
            if "o2_pct" in validated:
                self.engine.config["o2_pct"] = validated["o2_pct"]
            self.engine._log("sensor_override", "Synthetic environmental override: " + json_safe(validated), "info")
            self.engine._check_thresholds()
            self._bump()
            self._record()
            return self.snapshot()

    def configure(self, patch):
        allowed = {"ignition", "fire_type", "initial_intensity", "o2_pct", "ventilation_cms", "speed", "spread_multiplier", "water_approved", "equipment_deenergized", "automatic_suppression_enabled"}
        if not isinstance(patch, dict) or set(patch) - allowed:
            raise ValueError("Unknown fire configuration field")
        if "ignition" in patch and patch["ignition"] not in ADJACENCY:
            raise ValueError("Unknown ignition compartment")
        if "fire_type" in patch and patch["fire_type"] not in FIRE_TYPES:
            raise ValueError("Unknown fire type")
        bounds = {"initial_intensity": (0.05, 1), "o2_pct": (0, 100), "ventilation_cms": (0, 100), "spread_multiplier": (0, 3)}
        for k, (lo, hi) in bounds.items():
            if k in patch:
                finite_number(patch[k], {"label": k, "unit": "", "min": lo, "max": hi})
        if "speed" in patch and (isinstance(patch["speed"], bool) or patch["speed"] not in (1, 2, 5, 10)):
            raise ValueError("Speed must be 1, 2, 5 or 10")
        for k in ("water_approved", "equipment_deenergized", "automatic_suppression_enabled"):
            if k in patch and type(patch[k]) is not bool:
                raise ValueError("Procedure acknowledgements must be boolean")
        with self.lock:
            self._require_simulation()
            if self.engine.status == "running" and ({"fire_type", "ignition"} & set(patch)):
                raise ValueError("Pause before changing ignition or fire type")
            if "speed" in patch:
                self.engine.set_speed(patch["speed"])
            self.engine.config.update({key: value for key, value in patch.items() if key != "speed"})
            if "o2_pct" in patch:
                self.engine.atmosphere["o2_pct"] = patch["o2_pct"]
            if "initial_intensity" in patch:
                for c in self.engine.compartments.values():
                    if c["on_fire"]:
                        c["intensity"] = patch["initial_intensity"]
            self.engine._log("configuration", "Simulation configuration updated", "info")
            self._bump()
            self._record()
            return self.snapshot()

    def fire_action(self, action):
        with self.lock:
            self._require_simulation()
            if action not in ("start", "pause", "reset", "stop"):
                raise ValueError("Unknown fire action")
            if action == "reset":
                self.engine.reset()
                self.preset = "normal"
                self.history.clear()
                self.previous = {}
                self._assessment_signature = None
                self._assessment_requested_at = -1e9
                self.assessment = build_ai_assessment(self.engine.state(), brain=None)
                self.assessment.update(data_source="SIMULATION", assessed_revision=self.revision + 1, assessed_at=utc_now())
                self.presentation.update(scenario="normal", status="idle", scripted_suppression_confirmed=False)
            else:
                getattr(self.engine, action)()
            self._bump()
            self._record()
            return self.snapshot()

    def suppress(self, action, confirmed):
        with self.lock:
            if self.mode == "live":
                self._hardware_log("command_blocked", f"{action}: hardware actuation disabled; no validated controller or interlocks")
                self._bump()
                raise ValueError("LIVE ACTUATION LOCKED: no command transmitted; no validated controller/interlocks configured")
            if confirmed is not True:
                raise ValueError("Explicit confirmation is required")
            self.engine.activate_suppression(action, confirmed=True)
            self._bump()
            return {"acknowledged": True, "command_id": f"sim-{self.revision}", "execution_status": "SIMULATED_ONLY", "action": action, "hardware_transmitted": False}

    def select_preset(self, key, confirmed=False):
        if key not in PRESETS:
            raise ValueError("Unknown presentation scenario")
        if key == "suppression" and confirmed is not True:
            raise ValueError("Confirm the scripted simulated suppressant activation before starting this demo")
        with self.lock:
            self._require_simulation()
            self.engine.reset({
                "fire_type": "lithium_battery" if key == "battery" else "electrical",
                "initial_intensity": 0.5,
                "speed": self.engine.config["speed"],
                "automatic_suppression_enabled": self.engine.config["automatic_suppression_enabled"],
            })
            self.history.clear()
            self.previous = {}
            self._assessment_signature = None
            self._assessment_requested_at = -1e9
            self.preset = key
            is_auto_running = key in ("electrical", "battery", "critical", "normal")
            self.presentation = {
                "scenario": key,
                "status": "running" if is_auto_running else "idle",
                "scripted_suppression_confirmed": key == "suppression" and confirmed is True,
            }
            if key == "critical":
                self.engine.config["hold_critical"] = True
                self.engine.atmosphere.update(o2_pct=15.5, co_ppm=110.0, co2_ppm=14000.0, temp_C=48.5, smoke_mgm3=3.2)
                for cid in ("USLAB", "NODE2", "NODE1"):
                    if cid in self.engine.compartments:
                        self.engine.compartments[cid].update(
                            affected=True,
                            smoke=0.85 if cid == "USLAB" else (0.55 if cid == "NODE2" else 0.35),
                            temp_C=48.5 if cid == "USLAB" else (38.0 if cid == "NODE2" else 28.0),
                        )
                self.engine.status = "running"
                self.engine._check_thresholds()
            elif key == "normal":
                self.engine.config["hold_critical"] = False
                self.engine.status = "running"
                self.engine._log("simulation_start", "Normal environment baseline simulation active.", "info")
            elif key in ("electrical", "battery"):
                self.engine.config["hold_critical"] = False
                self.engine.start()
            elif key == "suppression" and confirmed:
                self.engine.config["hold_critical"] = False
                if self.prevention.armed:
                    self.prevention.stand_down("Operator-confirmed scripted suppression demo requires a live ignition.")
                self.engine.start()
            self.engine._log("presentation_scenario", PRESETS[key]["name"] + " (synthetic)", "info")
            self._bump()
            self._record()
            baseline = self.snapshot()["fire_state"]
            self.assessment = build_ai_assessment(baseline, brain=None)
            self.assessment.update(data_source=baseline["data_source"], assessed_revision=self.revision, assessed_at=self.timestamp)
            return self.snapshot()

    def presentation_action(self, action):
        with self.lock:
            self._require_simulation()
            if action in ("start", "resume"):
                if self.preset in ("electrical", "battery", "suppression"):
                    if self.engine.status != "extinguished":
                        self.engine.start()
                elif self.preset in ("normal", "critical") and self.engine.status in ("idle", "paused"):
                    self.engine.status = "running"
                    self.engine._log("simulation_start", f"{PRESETS.get(self.preset, {}).get('name', 'Scenario')} simulation started.", "info")
                self.presentation["status"] = "running"
            elif action == "pause":
                self.engine.pause()
                self.presentation["status"] = "paused"
            elif action == "reset":
                return self.fire_action("reset")
            else:
                raise ValueError("Unknown presentation action")
            self._bump()
            return self.snapshot()

    def set_scenario(self, key):
        mapping = {"NOMINAL_ISS": "normal", "SLOW_ELECTRICAL_SMOLDER": "electrical", "VENTILATION_FAN_FAILURE": "normal", "EXPLORATION_O2_SURGE": "normal"}
        if key not in mapping:
            raise ValueError("Unknown HIL scenario")
        with self.lock:
            self.select_preset(mapping[key])
            self.preset = key
            if key == "SLOW_ELECTRICAL_SMOLDER":
                self.engine.start()
            elif key == "VENTILATION_FAN_FAILURE":
                self.engine.config["ventilation_cms"] = 0.35
            elif key == "EXPLORATION_O2_SURGE":
                self.engine.atmosphere.update(o2_pct=34, pressure_kpa=8.2 * 6.894757293)
                self.engine.config.update(o2_pct=34, ventilation_cms=5.8)
            self._bump()
            self._record()
            return self.snapshot()

    @property
    def current_scenario(self):
        return self.preset

    def hardware_status(self):
        age = self.clock() - self.last_received if self.last_received is not None else None
        connected = age is not None and age <= STALE_AFTER_SECONDS
        frequency = 0.0
        if connected and len(self.packet_times) > 1:
            frequency = (len(self.packet_times) - 1) / max(0.001, self.packet_times[-1] - self.packet_times[0])
        return {"connected": connected, "board": self.hardware_board, "device_id": self.device_id,
                "status": "connected" if connected else "stale" if age is not None else "disconnected",
                "last_received_at": self.last_received_at, "age_seconds": round(age, 2) if age is not None else None,
                "frequency_hz": round(frequency, 2), "communication_errors": list(self.errors),
                "actuation_enabled": False, "pin_mapping": "reference Uno layout; not verified against a supplied circuit screenshot"}

    def _hardware_log(self, event, message):
        self.hardware_events.append({"t": round(self.elapsed, 2), "wall": utc_now(), "type": event, "message": message, "severity": "warning", "data_source": "LIVE_HARDWARE"})

    def gateway_error(self, message):
        with self.lock:
            self.errors.append({"timestamp": utc_now(), "message": str(message)[:300]})
            self._hardware_log("communication_error", str(message)[:300])
            self._bump()

    def ingest(self, packet):
        if not isinstance(packet, dict) or packet.get("source") != "serial":
            raise ValueError("Only explicit serial gateway packets accepted")
        board, device = packet.get("board"), packet.get("device_id")
        if board not in ("Arduino Uno", "ESP32") or not isinstance(device, str) or not 1 <= len(device) <= 100:
            raise ValueError("Valid board and device_id required")
        seq = packet.get("sequence")
        if type(seq) is not int or seq < 0:
            raise ValueError("Non-negative integer sequence required")
        sensors = packet.get("sensors")
        if not isinstance(sensors, dict) or not sensors or set(sensors) - set(SENSOR_SPECS):
            raise ValueError("Provide known canonical sensor channels")
        validated = {}
        for key, reading in sensors.items():
            spec = SENSOR_SPECS[key]
            unit = UNIT_ALIASES.get(reading.get("unit"), reading.get("unit")) if isinstance(reading, dict) else None
            if not isinstance(reading, dict) or unit != spec["unit"]:
                raise ValueError(f"{key} requires canonical unit {spec['unit']}")
            status = reading.get("status", "normal")
            if status not in ("normal", "warning", "critical", "missing", "stale", "disconnected", "uncalibrated"):
                raise ValueError("Unknown sensor quality status")
            value = reading.get("value")
            validated[key] = {"value": finite_number(value, spec) if value is not None else None, "status": status if value is not None or status != "normal" else "missing"}
        with self.lock:
            if self.device_id == device and self.last_received is not None and self.clock() - self.last_received < STALE_AFTER_SECONDS and seq <= self.sequence:
                raise ValueError("Duplicate or out-of-order gateway packet")
            self.previous = self._values()
            self.last_readings = validated
            self.last_received = self.clock()
            self.last_received_at = utc_now()
            self.hardware_board, self.device_id, self.sequence = board, device, seq
            self.packet_times.append(self.last_received)
            if self.mode == "live":
                crew = environment_assessment(self._values(), self.engine.thresholds)
                if crew["status"] != self._last_live_crew:
                    self._hardware_log("crew_status_change", crew["explanation"])
                    self._last_live_crew = crew["status"]
                self._bump()
                self._record()
            return {"accepted": True, "sequence": seq, "active_mode": self.mode, "hardware_transmitted": False}

    def set_thresholds(self, patch):
        if not isinstance(patch, dict) or not patch or set(patch) - set(self.engine.thresholds):
            raise ValueError("Unknown threshold species")
        with self.lock:
            candidate = copy.deepcopy(self.engine.thresholds)
            for key, bands in patch.items():
                if not isinstance(bands, dict):
                    raise ValueError("Threshold bands must be objects")
                for b in ("normal", "warn", "crit"):
                    if b in bands:
                        vals = bands[b]
                        if not isinstance(vals, list) or len(vals) != 2 or any(type(v) not in (float, int) or not math.isfinite(v) for v in vals) or vals[0] > vals[1]:
                            raise ValueError("Each band needs two finite increasing numbers")
                        candidate[key][b] = vals
                th = candidate[key]
                if not th["crit"][0] <= th["warn"][0] <= th["normal"][0] <= th["normal"][1] <= th["warn"][1] <= th["crit"][1]:
                    raise ValueError("Bands must nest: normal inside warning inside critical")
            self.engine.thresholds = candidate
            self._bump()
            return {"thresholds": copy.deepcopy(candidate)}

    def _live_fire_state(self, values):
        crew = environment_assessment(values, self.engine.thresholds)
        flagged = any(crew["species_status"].get(k) in ("WARNING", "CRITICAL") for k in ("temp_C", "co_ppm", "smoke_mgm3"))
        return {
            "status": "live", "sim_time": None, "speed": 1, "config": copy.deepcopy(self.engine.config),
            "fire_type": {"name": "Unknown — sensor signatures do not identify fire type", "class": "unclassified", "suppressant": "Consult a validated spacecraft-specific procedure; actuation locked", "warnings": []},
            "severity": "Unknown", "detected": None, "possible_fire": flagged,
            "ignition_time": None, "detection_time": None, "extinguish_time": None,
            "fire": {"location": "UNKNOWN", "burning": [], "affected": [], "total_intensity": None, "growth_rate": None, "spread_direction": None, "propagation_speed_mms": None, "duration_s": None, "affected_area_m2": None},
            "compartments": {c["id"]: {"intensity": None, "on_fire": False, "affected": False, "smoke": None, "temp_C": None} for c in COMPARTMENTS},
            "atmosphere": {k: values[k] for k in self.engine.thresholds},
            "suppression": {"active": False, "method": "LIVE ACTUATION LOCKED", "isolated": False, "o2_isolated": False, "effectiveness": 0},
            "crew": crew, "thresholds": copy.deepcopy(self.engine.thresholds), "time_to_critical_s": None,
            "events": list(self.hardware_events), "history": list(self.history), "data_source": "LIVE_HARDWARE",
            "disclaimer": "Actual gateway values only; missing/stale channels withheld. Fire type, location, spread and survival cannot be inferred from these sensors alone. Live actuation disabled.",
        }

    def snapshot(self):
        with self.lock:
            values = self._values()
            hw = self.hardware_status()
            if self.mode == "simulation":
                fire = copy.deepcopy(self.engine.state())
                crew = fire["crew"]
            else:
                fire = self._live_fire_state(values)
                crew = fire["crew"]
            fire["atmosphere"] = {k: values[k] for k in self.engine.thresholds}
            fire["history"] = [{**h, "intensity": h.get("intensity"), "burning": h.get("burning")} for h in self.history]
            sensors = {}
            for k, spec in SENSOR_SPECS.items():
                band = crew["species_status"].get(k, "OK")
                quality = {"OK": "normal", "CAUTION": "warning", "WARNING": "warning", "CRITICAL": "critical", "UNKNOWN": "missing"}[band]
                if self.mode == "live":
                    if not hw["connected"]:
                        quality = hw["status"]
                    elif self.last_readings.get(k, {}).get("status") in ("missing", "uncalibrated", "disconnected", "stale"):
                        quality = self.last_readings[k]["status"]
                    elif values.get(k) is None:
                        quality = "missing"
                sensors[k] = {**spec, "value": values[k], "previous_value": self.previous.get(k), "status": quality, "source": self.mode, "timestamp": self.timestamp if self.mode == "simulation" else self.last_received_at}
            fire["data_source"] = "SIMULATION" if self.mode == "simulation" else "LIVE_HARDWARE"
            fire["revision"] = self.revision
            fire["mode"] = self.mode
            return {"revision": self.revision, "timestamp": self.timestamp, "mode": self.mode,
                    "data_source": fire["data_source"], "hardware": hw, "sensors": sensors,
                    "fire_state": fire, "crew": crew, "history": list(self.history), "presentation": copy.deepcopy(self.presentation),
                    "ai_assessment": copy.deepcopy(self.assessment), "actuation_enabled": False,
                    "prevention": self.prevention.state()}

    def telemetry_frame(self):
        with self.lock:
            s = self.snapshot()
            v = {k: r["value"] for k, r in s["sensors"].items()}
            twin = {"regime": "Unavailable", "probabilities": {}, "flame_temp_C": None, "damkohler_proxy": None}
            if self.twin and all(v[k] is not None for k in ("o2_pct", "airflow_cms", "pressure_kpa")):
                pred = self.twin.evaluate_state("PMMA", v["o2_pct"], v["airflow_cms"], v["pressure_kpa"] / 6.894757293)
                twin = {"regime": pred["regime"], "probabilities": pred["probabilities"], "flame_temp_C": pred["physics_metrics"]["estimated_flame_temp_C"], "damkohler_proxy": pred["physics_metrics"]["damkohler_proxy"]}
            tier = {"SAFE": "NORMAL", "CAUTION": "CAUTION", "DANGER": "WARNING", "CRITICAL": "CRITICAL", "UNKNOWN": "UNKNOWN"}[s["crew"]["status"]]
            colors = {"NORMAL": "#22c55e", "CAUTION": "#fbbf24", "WARNING": "#f97316", "CRITICAL": "#ef4444", "UNKNOWN": "#8b99b5"}
            return {"revision": self.revision, "timestamp": self.timestamp, "mode": self.mode, "data_source": s["data_source"],
                    "telemetry": {"o2_concentration_pct": v["o2_pct"], "airflow_velocity_cms": v["airflow_cms"], "cabin_pressure_psi": v["pressure_kpa"] / 6.894757293 if v["pressure_kpa"] is not None else None, "cabin_temp_C": v["temp_C"], "co_ppm": v["co_ppm"], "co2_ppm": v["co2_ppm"], "humidity_pct": v["humidity_pct"], "smoke_mgm3": v["smoke_mgm3"], "smoke_obscuration_pct_m": None},
                    "sensor_health": {k: r["status"] for k, r in s["sensors"].items()},
                    "scenario": self.preset, "scenario_name": "Synthetic: " + self.preset if self.mode == "simulation" else "Live serial telemetry",
                    "device_id": "SIM-UNO-01" if self.mode == "simulation" else self.device_id or "NO HARDWARE", "digital_twin": twin,
                    "safety": {"safety_tier": tier, "status_color": colors[tier], "severity_score": {"NORMAL": 0, "CAUTION": 30, "WARNING": 70, "CRITICAL": 100, "UNKNOWN": None}[tier],
                               "rule_violations": [s["crew"]["explanation"]] if tier != "NORMAL" else [], "hvac_suppression_action": "Illustrative controls only; real HVAC/suppression commands locked pending approved procedures and validated interlocks.", "action_code": "LOCKED", "crew_emergency_protocol": s["crew"]["evacuation_urgency"]}}

    def generate_telemetry_packet(self):
        frame = self.telemetry_frame()
        return {k: v for k, v in frame.items() if k not in ("digital_twin", "safety")}

    def assessment_due(self):
        with self.lock:
            signature = (self.mode, self.snapshot()["crew"]["status"], self.engine.status if self.mode == "simulation" else self.hardware_status()["status"], self.engine.config["fire_type"], tuple(round((v or 0) / scale) for v, scale in [(self._values()["co_ppm"], 15), (self._values()["o2_pct"], 1), (self._values()["temp_C"], 5)]))
            return not self._assessment_busy and signature != self._assessment_signature and self.clock() - self._assessment_requested_at >= 20

    def assess(self, brain=None):
        with self._assessment_lock:
            with self.lock:
                self._assessment_busy = True
                self._assessment_requested_at = self.clock()
                state = self.snapshot()["fire_state"]
                mode, rev = self.mode, self.revision
            try:
                assessment = build_ai_assessment(state, brain)
                with self.lock:
                    if self.mode == mode:
                        assessment.update(data_source=state["data_source"], assessed_revision=rev, assessed_at=utc_now())
                        self.assessment = assessment
                        self._assessment_signature = (self.mode, self.snapshot()["crew"]["status"], self.engine.status if self.mode == "simulation" else self.hardware_status()["status"], self.engine.config["fire_type"], tuple(round((v or 0) / scale) for v, scale in [(self._values()["co_ppm"], 15), (self._values()["o2_pct"], 1), (self._values()["temp_C"], 5)]))
                    return copy.deepcopy(self.assessment)
            finally:
                with self.lock:
                    self._assessment_busy = False

    def report(self):
        with self.lock:
            state = self.snapshot()
            if self.mode == "simulation":
                rep = self.engine.build_report(self.assessment)
                return {
                    "markdown": rep["markdown"],
                    "json": {**rep["json"], "snapshot": state},
                    "filename": "spacecraft_incident.md",
                }
            hw = state["hardware"]
            text = [
                "# Spacecraft Live Hardware Environmental Report",
                f"Source: {state['data_source']} | Board: {hw['board']} ({hw['device_id'] or 'unassigned'}) | Revision {state['revision']} | {state['timestamp']}",
                "> Live gateway values only; missing/uncalibrated/stale channels are withheld and never fabricated. Real suppression actuation is locked.",
                "## 1. Incident Overview",
                f"- Hardware status: {hw['status']} | Frequency: {hw['frequency_hz']} Hz | Last packet: {hw['last_received_at'] or 'never'}",
                "## 2. Fire Classification",
                "- Type: Unknown — ambient sensors alone do not identify fire type or location.",
                "## 3. Environmental Readings",
            ]
            for k, r in state["sensors"].items():
                val = "unavailable" if r["value"] is None else r["value"]
                text.append(f"- {r['label']} ({r['pin']}): {val} {r['unit']} ({r['status']})")
            text += [
                "## 4. Crew Survival Assessment (Environmental Risk)",
                f"- Status: {state['crew']['status']} | Habitability: {state['crew']['habitability']} | Urgency: {state['crew']['evacuation_urgency']}",
                f"- {state['crew']['explanation']}",
                "## 5. Suppression Actions",
                "- LIVE ACTUATION LOCKED (no validated controller or safety interlocks).",
                "## 6. AI Recommendations",
                json_safe(state["ai_assessment"] or {"status": "not generated"}),
                "## 7. Full Event Log",
            ]
            text += [f"- {e['t']}s [{e['type']}] {e['message']}" for e in state["fire_state"]["events"]] or ["- No hardware events recorded."]
            return {"markdown": "\n\n".join(text), "json": state, "filename": "spacecraft_live_incident.md"}


def json_safe(value):
    import json
    return json.dumps(value, ensure_ascii=False, allow_nan=False)
