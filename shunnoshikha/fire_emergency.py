#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 9: Spacecraft Fire Emergency Detection, Spread Simulation,
Suppression Control & Environmental Habitability Monitoring.

EDUCATIONAL / RESEARCH SIMULATION ONLY. This is NOT a validated spacecraft fire
prediction model and NOT a medical or operational survival predictor. All outputs
are explicitly synthetic unless a real sensor feed is connected. The compartment
model is deterministic: identical configuration + identical step sequence reproduce
identical results (no randomness).
"""

import math
import time
import json
from typing import Dict, List, Any, Optional

SIMULATION_DISCLAIMER = (
    "Educational research simulation. Compartment fire model is a simplified deterministic "
    "approximation, not a validated spacecraft fire prediction. Environmental time-to-threshold "
    "estimates depend on stated assumptions and are never medical or human survival predictions. "
    "All suppression approaches are illustrative, not spacecraft-approved procedures."
)

ENVIRONMENTAL_TTC_LABEL = "Environmental time to critical threshold (not human survival)"
ENVIRONMENTAL_TTC_ASSUMPTIONS = (
    "Linear extrapolation from the last two simulation history samples to configured environmental bands.",
    "Assumes recent trends continue; ignores future interventions and nonlinear changes.",
    "Available only while advancing, except zero indicates an already critical reading.",
    "Not a medical, survival, or operational safety estimate.",
)

# ---------------- Spacecraft layout (ISS-inspired, 2D floor plan) ----------------
# Coordinates are in a 100 x 62 plan space for SVG rendering.
COMPARTMENTS: List[Dict[str, Any]] = [
    {"id": "NODE1", "name": "Node 1 · Unity", "x": 30, "y": 24, "w": 14, "h": 14, "volume_m3": 40},
    {"id": "NODE2", "name": "Node 2 · Harmony", "x": 46, "y": 24, "w": 14, "h": 14, "volume_m3": 40},
    {"id": "NODE3", "name": "Node 3 · Tranquility", "x": 30, "y": 40, "w": 14, "h": 14, "volume_m3": 40},
    {"id": "USLAB", "name": "US Lab · Destiny", "x": 46, "y": 8, "w": 20, "h": 14, "volume_m3": 106},
    {"id": "COL", "name": "Columbus · ESA", "x": 62, "y": 24, "w": 16, "h": 14, "volume_m3": 70},
    {"id": "JEM", "name": "Kibo · JAXA", "x": 46, "y": 40, "w": 20, "h": 14, "volume_m3": 90},
    {"id": "QUEST", "name": "Quest Airlock", "x": 14, "y": 24, "w": 14, "h": 14, "volume_m3": 34},
    {"id": "CUPOLA", "name": "Cupola · Obs", "x": 30, "y": 8, "w": 12, "h": 12, "volume_m3": 12},
]
ADJACENCY: Dict[str, List[str]] = {
    "NODE1": ["QUEST", "NODE2", "NODE3", "CUPOLA"],
    "NODE2": ["NODE1", "USLAB", "COL"],
    "NODE3": ["NODE1", "JEM"],
    "USLAB": ["NODE2", "CUPOLA"],
    "COL": ["NODE2", "JEM"],
    "JEM": ["NODE3", "COL"],
    "QUEST": ["NODE1"],
    "CUPOLA": ["NODE1", "USLAB"],
}

# ---------------- Fire types / scenarios ----------------
FIRE_TYPES: Dict[str, Dict[str, Any]] = {
    "electrical": {
        "name": "Electrical Fire", "class": "Class C (energized)",
        "growth_rate": 0.10, "heat_release_MW": 0.6, "smoke_yield": 1.5, "co_yield": 1.6,
        "o2_consumption": 1.0, "spread_factor": 0.55,
        "water_compatible": False,
        "water_note": "Water is conductive. NEVER apply water to energized electrical equipment unless an approved spacecraft-specific procedure explicitly permits it.",
        "suppressant": "Illustrative non-conductive agent (CO2 / HFC-class); mission-specific approval required",
        "reasoning": "Energized electrical fire requires a non-conductive agent to avoid shock and equipment damage; de-energize the circuit first where safe.",
        "warnings": ["De-energize affected circuit before suppression if safely possible.", "Do not use water or foam on energized equipment.", "CO2 displacement hazard in confined cabin — crew on PBA."],
    },
    "lithium_battery": {
        "name": "Lithium-ion Battery Fire", "class": "Class D / thermal runaway",
        "growth_rate": 0.16, "heat_release_MW": 1.4, "smoke_yield": 2.0, "co_yield": 2.2,
        "o2_consumption": 1.3, "spread_factor": 0.75,
        "water_compatible": False,
        "water_note": "Thermal runaway can reignite. Water/cooling only under an approved spacecraft battery-fire procedure (e.g. contained cooling); otherwise use dedicated containment.",
        "suppressant": "Illustrative battery containment; mission-specific suppression/cooling approval required",
        "reasoning": "Li-ion thermal runaway is self-sustaining and reignites; containment and approved cooling procedure take priority over generic agents.",
        "warnings": ["Risk of thermal runaway propagation to adjacent cells.", "Toxic off-gassing (HF, CO) — crew on PBA.", " Reignition possible after apparent extinguishment; monitor temperature."],
    },
    "equipment_material": {
        "name": "Equipment / Material Fire", "class": "Class A (solid combustibles)",
        "growth_rate": 0.09, "heat_release_MW": 0.8, "smoke_yield": 1.2, "co_yield": 1.0,
        "o2_consumption": 1.0, "spread_factor": 0.6,
        "water_compatible": True,
        "water_note": "Water mist is acceptable for ordinary Class A solids when the material and spacecraft protocol permit; verify no energized equipment involved.",
        "suppressant": "Illustrative material-specific agent; Class A classification alone does not approve water",
        "reasoning": "Ordinary solid combustibles respond to cooling agents; water mist is compatible for Class A provided equipment is de-energized.",
        "warnings": ["Confirm no energized electronics in the burning assembly.", "Verify material compatibility with water before activation."],
    },
    "flammable_liquid": {
        "name": "Flammable Liquid Fire", "class": "Class B (flammable liquid)",
        "growth_rate": 0.14, "heat_release_MW": 1.2, "smoke_yield": 1.8, "co_yield": 1.4,
        "o2_consumption": 1.2, "spread_factor": 0.8,
        "water_compatible": False,
        "water_note": "Direct water streams can spread burning liquid. Use only approved water-mist/fog patterns if the spacecraft procedure permits; otherwise compatible gas agent.",
        "suppressant": "Illustrative compatible gas agent; mission-specific approval required; no water",
        "reasoning": "Liquid pool fires spread with direct water application; a compatible smothering agent avoids spreading the fuel.",
        "warnings": ["Do not apply direct water stream — spreads burning fuel.", "Contain spill; isolate fuel source.", "Vapor flashback hazard."],
    },
    "oxygen_enriched": {
        "name": "Oxygen-Enriched Environment Fire", "class": "Class A/B in elevated O2",
        "growth_rate": 0.20, "heat_release_MW": 1.6, "smoke_yield": 1.4, "co_yield": 1.2,
        "o2_consumption": 1.5, "spread_factor": 0.9,
        "water_compatible": True,
        "water_note": "Water mist may be used for cooling only AFTER the oxygen source is isolated and protocol permits; elevated O2 makes materials burn violently.",
        "suppressant": "Illustrative oxygen-source isolation and compatible agent; mission-specific approval required",
        "reasoning": "Elevated O2 dramatically widens flammability; removing the oxidizer source is the primary control, then cool/suppress per protocol.",
        "warnings": ["Isolate O2 supply first if safely possible.", "Materials normally non-flammable burn vigorously in elevated O2.", "Reduce cabin O2 to nominal before crew re-entry."],
    },
}

# ---------------- Configurable atmospheric thresholds ----------------
# Each species: normal / warn / crit are [low, high] inclusive-safe bands.
# Outside normal => CAUTION; outside warn => WARNING(DANGER); outside crit => CRITICAL.
DEFAULT_THRESHOLDS: Dict[str, Dict[str, Any]] = {
    "o2_pct":   {"label": "Oxygen", "unit": "%", "normal": [19.5, 23.5], "warn": [18.0, 25.0], "crit": [16.0, 28.0]},
    "co_ppm":   {"label": "Carbon Monoxide", "unit": "ppm", "normal": [0, 9], "warn": [0, 25], "crit": [0, 50]},
    "co2_ppm":  {"label": "Carbon Dioxide", "unit": "ppm", "normal": [0, 5000], "warn": [0, 7000], "crit": [0, 10000]},
    "temp_C":   {"label": "Cabin Temperature", "unit": "°C", "normal": [18, 26], "warn": [16, 32], "crit": [10, 45]},
    "humidity_pct": {"label": "Relative Humidity", "unit": "%", "normal": [30, 60], "warn": [20, 70], "crit": [10, 80]},
    "smoke_mgm3": {"label": "Smoke / Particulate", "unit": "mg/m³", "normal": [0, 0.1], "warn": [0, 0.5], "crit": [0, 2.0]},
    "pressure_kpa": {"label": "Cabin Pressure", "unit": "kPa", "normal": [97, 102], "warn": [95, 104], "crit": [90, 107]},
}

SEVERITY_ORDER = ["Normal", "Warning", "Critical", "Extreme"]
CREW_ORDER = ["SAFE", "CAUTION", "DANGER", "CRITICAL"]


def _band_status(value: float, th: Dict[str, Any]) -> str:
    # Critical-first also handles legacy, non-nested bands conservatively.
    # New threshold configurations are validated at the external service boundary.
    for band, status in (("crit", "CRITICAL"), ("warn", "WARNING"), ("normal", "CAUTION")):
        lo, hi = th[band]
        if not lo <= value <= hi:
            return status
    return "OK"


def _water_allowed(fire_type: str, config: Dict[str, Any], suppression: Dict[str, Any]) -> bool:
    return (
        fire_type in ("equipment_material", "oxygen_enriched")
        and config.get("water_approved") is True
        and config.get("equipment_deenergized") is True
        and (fire_type != "oxygen_enriched" or suppression.get("o2_isolated") is True)
    )


def _toward(value: float, target: float, amount: float) -> float:
    return min(target, value + amount) if value < target else max(target, value - amount)


class FireSimulationEngine:
    """Deterministic compartment fire, atmosphere, and environmental-risk simulation."""

    DT = 0.25  # fixed sim step (s) for reproducibility

    def __init__(self):
        self.thresholds = json.loads(json.dumps(DEFAULT_THRESHOLDS))
        self._command_seq = 0
        self.prevention = None  # optional FirePreventionSystem guard (Module 10)
        self.reset()

    # ---------------- lifecycle ----------------
    @staticmethod
    def _normalize_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
        config = {
            "ignition": cfg.get("ignition", "USLAB"),
            "fire_type": cfg.get("fire_type", "electrical"),
            "initial_intensity": float(cfg.get("initial_intensity", 0.35)),
            "o2_pct": float(cfg.get("o2_pct", 21.0)),
            "ventilation_cms": float(cfg.get("ventilation_cms", 7.5)),
            "spread_multiplier": float(cfg.get("spread_multiplier", 1.0)),
            "speed": int(cfg.get("speed", 1)),
            "water_approved": cfg.get("water_approved") is True,
            "equipment_deenergized": cfg.get("equipment_deenergized") is True,
            "automatic_suppression_enabled": cfg.get("automatic_suppression_enabled") is True,
        }
        if config["ignition"] not in ADJACENCY:
            config["ignition"] = "USLAB"
        if config["fire_type"] not in FIRE_TYPES:
            config["fire_type"] = "electrical"
        for key, low, high in (("initial_intensity", 0.05, 1.0), ("o2_pct", 12.0, 40.0),
                               ("ventilation_cms", 0.0, 30.0), ("spread_multiplier", 0.0, 3.0),
                               ("speed", 1, 10)):
            if not math.isfinite(config[key]):
                raise ValueError(f"{key} must be finite.")
            config[key] = min(high, max(low, config[key]))
        return config

    def reset(self, config: Optional[Dict[str, Any]] = None):
        self.config = self._normalize_config(config or {})

        self.status = "idle"
        self.sim_time = 0.0
        self.ignition_time: Optional[float] = None
        self.detection_time: Optional[float] = None
        self.extinguish_time: Optional[float] = None
        self.compartments = {
            c["id"]: {"intensity": 0.0, "temp_C": 22.0, "smoke": 0.0, "on_fire": False,
                      "affected": False, "spread_progress": 0.0, "ignited_at": None}
            for c in COMPARTMENTS
        }
        self.atmosphere = {
            "o2_pct": self.config["o2_pct"], "co_ppm": 0.5, "co2_ppm": 3000.0,
            "temp_C": 22.0, "humidity_pct": 45.0, "smoke_mgm3": 0.02, "pressure_kpa": 101.3,
        }
        self._baseline_atmosphere = self.atmosphere.copy()
        self.suppression = {"active": False, "method": None, "isolated": False, "o2_isolated": False,
                            "effectiveness": 0.0, "diluent": None}
        self.ignition_vetoed = False
        self.events: List[Dict[str, Any]] = []
        self.history: List[Dict[str, Any]] = []
        self.command_acknowledgements: List[Dict[str, Any]] = []
        self._last_crew = "SAFE"
        self._violations_logged: set = set()
        self._sample_accum = 0.0
        self._step_remainder = 0.0
        self._paused_status = "running"
        self._log("simulation_reset", "Simulation reset to initial conditions.", "info")
        return self.state()

    def configure(self, cfg: Dict[str, Any]):
        if self.status == "running":
            raise ValueError("Cannot reconfigure while running. Pause or reset first.")
        merged = self._normalize_config({**self.config, **cfg})
        if self.status == "idle":
            return self.reset(merged)
        # Configuration is not a new incident. Preserve time, atmosphere and logs.
        self.config = merged
        self._log("simulation_configured", "Simulation configuration updated without resetting incident.", "info")
        return self.state()

    def start(self):
        if self.status == "idle" or (self.status == "running" and self.ignition_time is None):
            if self.prevention is not None and self.prevention.on_ignition_attempt(self.config["ignition"]):
                # The clock keeps ticking while the pre-ignition guard holds the cabin:
                # prevention conditioning, atmosphere monitoring and the event log stay live.
                self.status = "running"
                self.ignition_vetoed = True
                self._log("ignition_prevented",
                          f"Autonomous prevention quenched the ignition attempt in {self.config['ignition']}. "
                          "Fire could not start; simulation clock continues under prevention guard.",
                          "info")
                return self.state()
            self.status = "running"
            self.ignition_vetoed = False
            self.ignition_time = self.sim_time
            c = self.compartments[self.config["ignition"]]
            c["on_fire"] = True; c["affected"] = True
            c["intensity"] = self.config["initial_intensity"]; c["ignited_at"] = self.sim_time
            ign = self.config["ignition"]
            fname = FIRE_TYPES[self.config["fire_type"]]["name"]
            self._log("ignition", f"Ignition in {ign} ({fname}).", "warning")
            self._log("simulation_start", f"Simulation started at {self.config['speed']}x.", "info")
        elif self.status == "paused":
            self.status = self._paused_status
            self._log("simulation_resume", "Simulation resumed (including atmosphere recovery).", "info")
        # Extinguished incidents already recover; stopped incidents require explicit reset.
        return self.state()

    def pause(self):
        if self._is_advancing():
            self._paused_status = self.status
            self.status = "paused"
            self._log("simulation_pause", "Simulation paused.", "info")
        return self.state()

    def stop(self):
        """Stop this incident without pretending its polluted atmosphere is clean."""
        if self.status != "stopped":
            for c in self.compartments.values():
                c.update(on_fire=False, intensity=0.0, spread_progress=0.0)
            self.suppression.update(active=False, method=None, effectiveness=0.0, diluent=None)
            self.status = "stopped"
            self._log("simulation_stopped", "Simulation stopped; flames zeroed, atmosphere retained.", "info")
        return self.state()

    def _is_advancing(self) -> bool:
        return self.status in ("running", "extinguished")

    def set_speed(self, speed: int):
        self.config["speed"] = min(10, max(1, int(speed)))
        return self.state()

    # ---------------- suppression ----------------
    def suppression_recommendation(self, fire_type: Optional[str] = None) -> Dict[str, Any]:
        key = fire_type or self.config["fire_type"]
        ft = FIRE_TYPES.get(key)
        allowed = _water_allowed(key, self.config, self.suppression)
        return {
            "fire_type": key,
            "fire_name": ft["name"] if ft else "Unknown fire type",
            "fire_class": ft["class"] if ft else "Unknown",
            "recommended_method": ft["suppressant"] if ft else "No agent selected for unknown fire type.",
            "reasoning": ft["reasoning"] if ft else "Identify the material using mission-specific procedures.",
            "warnings": ["Illustrative simulation only; no spacecraft approval is implied."] + (ft["warnings"] if ft else []),
            "water_compatible": ft["water_compatible"] if ft else False,
            "water_allowed": allowed,
            "water_approved": self.config["water_approved"],
            "equipment_deenergized": self.config["equipment_deenergized"],
            "water_note": (ft["water_note"] if ft else "Water disabled for unknown fire type.")
                          + " Simulation requires explicit water approval and de-energized equipment; oxygen-enriched scenarios also require oxygen isolation.",
            "dilution_options": [
                {"action": "dilute_co2", "diluent": "CO2",
                 "note": "FLEX / FLEX-2 studied CO2 dilution of droplet flames in the CIR+MDCA. CO2 displaces O2 and raises cabin CO2 — crew must be on PBA; illustrative only."},
                {"action": "dilute_he", "diluent": "He",
                 "note": "FLEX studied helium dilution as an inert diluent. He lowers O2 partial pressure without adding CO2, but risks hypoxia and voice/thermal effects — illustrative only."},
            ],
            "dilution_provenance": "NASA PSI FLEX / FLEX-2 (CIR + MDCA): CO2 and He diluent effects on microgravity droplet combustion.",
            "illustrative": True, "spacecraft_approved": False,
            "mode": "SIMULATION", "auto_activation": self.config["automatic_suppression_enabled"],
        }

    def automatic_suppression_action(self) -> str:
        """Select the safest simulated suppression action permitted by the configuration."""
        key = self.config["fire_type"]
        if key == "equipment_material" and _water_allowed(key, self.config, self.suppression):
            return "activate_water"
        return "activate_suppression"

    def _acknowledge_command(self, action: str, state: str, reason: str):
        self._command_seq += 1
        ack = {"id": f"sim-command-{self._command_seq:06d}", "mode": "SIMULATION",
               "state": state, "action": action, "reason": reason, "t": round(self.sim_time, 2)}
        self.command_acknowledgements.append(ack)
        self.suppression["last_command"] = ack.copy()
        self._log("command_rejected" if state == "rejected" else "command_acknowledgement",
                  reason, "warning" if state == "rejected" else "info")
        self.events[-1]["command"] = ack.copy()

    def activate_suppression(self, action: str, confirmed: bool = False) -> Dict[str, Any]:
        ft = FIRE_TYPES[self.config["fire_type"]]
        error = None
        if confirmed is not True:
            error = "Confirmation must be the boolean True before simulated emergency activation."
        elif action == "activate_water" and not _water_allowed(self.config["fire_type"], self.config, self.suppression):
            error = (f"Water is NOT approved for this {ft['name']} simulation configuration. "
                     "Requires compatible material, water_approved=True, equipment_deenergized=True, "
                     "and oxygen isolation for oxygen-enriched fires. No water for electrical, lithium-ion or liquid fires.")
        elif action not in ("activate_water", "activate_suppressant", "activate_suppression", "emergency_isolation",
                            "isolate_oxygen", "dilute_co2", "dilute_he", "stop_suppression", "emergency_alert"):
            error = f"Unknown suppression action: {action}"
        if error:
            self._acknowledge_command(action, "rejected", error)
            raise ValueError(error)

        if action == "activate_water":
            self.suppression.update(active=True, method="Illustrative water mist (simulation only)", effectiveness=0.10)
            self._log("suppression_activation", "Simulated water mist activated; no spacecraft approval implied.", "warning")
        elif action in ("activate_suppressant", "activate_suppression"):
            self.suppression.update(active=True, method=ft["suppressant"],
                                    effectiveness=0.16 if action == "activate_suppressant" else 0.14)
            self._log("suppression_activation", f"Simulated suppression activated: {ft['suppressant']}.", "warning")
        elif action == "emergency_isolation":
            self.suppression.update(isolated=True)
            self._log("emergency_isolation", "Simulated intercompartment fire and smoke transfer isolated.", "warning")
        elif action == "isolate_oxygen":
            self.suppression.update(o2_isolated=True)
            self._log("oxygen_isolation", "Simulated oxygen source isolated; this does not replenish oxygen.", "warning")
        elif action == "dilute_co2":
            self.suppression.update(active=True, diluent="CO2", effectiveness=0.12,
                                    method="Illustrative CO2 dilution (FLEX CO2/He diluent study)")
            self._log("suppression_activation",
                      "Simulated CO2 dilution activated (FLEX/FLEX-2 precedent). O2 displaced, cabin CO2 rises — crew on PBA; no spacecraft approval implied.",
                      "warning")
        elif action == "dilute_he":
            self.suppression.update(active=True, diluent="He", effectiveness=0.10,
                                    method="Illustrative helium dilution (FLEX CO2/He diluent study)")
            self._log("suppression_activation",
                      "Simulated helium dilution activated (FLEX precedent). O2 partial pressure falls — hypoxia risk, crew on PBA; no spacecraft approval implied.",
                      "warning")
        elif action == "stop_suppression":
            self.suppression.update(active=False, method=None, effectiveness=0.0, diluent=None)
            self._log("suppression_stop", "Simulated suppression stopped.", "info")
        elif action == "emergency_alert":
            self._log("emergency_alert", "SIMULATED emergency alert; no real broadcast sent.", "critical")
        if self.suppression["active"]:
            for c in self.compartments.values():
                c["spread_progress"] = 0.0
        self._acknowledge_command(action, "accepted", "Simulated command applied; no hardware commanded.")
        return self.state()

    # ---------------- deterministic step ----------------
    def step(self, dt: float):
        if not math.isfinite(dt) or dt < 0:
            raise ValueError("Step duration must be finite and non-negative.")
        if not self._is_advancing() or dt == 0:
            return
        ft = FIRE_TYPES[self.config["fire_type"]]
        self.sim_time += dt
        t = self.sim_time
        vent_factor = 0.5 + self.config["ventilation_cms"] / 20.0
        isolated = self.suppression["isolated"]
        active = self.suppression["active"]
        if isolated:
            vent_factor *= 0.35
        o2_factor = max(0.0, (self.atmosphere["o2_pct"] - 14.0) / 7.0)
        if self.suppression["o2_isolated"]:
            o2_factor *= 0.5

        # Every source and destination reads the same immutable previous step.
        # Sorted traversal also makes floating-point accumulation order reproducible.
        prev = {cid: c.copy() for cid, c in self.compartments.items()}
        ids = sorted(prev)
        next_compartments = {cid: prev[cid].copy() for cid in ids}
        burning_before = sum(c["on_fire"] for c in prev.values())
        transfer_factor = self.config["spread_multiplier"] * vent_factor
        smoke_delta = {cid: 0.0 for cid in ids}
        if not isolated:
            # Conservative edge diffusion; limit the coefficient for large direct steps.
            max_degree = max(len(neighbors) for neighbors in ADJACENCY.values())
            smoke_rate = min(0.08 * transfer_factor * dt, 1.0 / max_degree)
            for cid in ids:
                for nb in sorted(ADJACENCY[cid]):
                    if cid < nb:
                        transfer = (prev[cid]["smoke"] - prev[nb]["smoke"]) * smoke_rate
                        smoke_delta[cid] -= transfer
                        smoke_delta[nb] += transfer

        for cid in ids:
            old, c = prev[cid], next_compartments[cid]
            if old["on_fire"]:
                intensity = old["intensity"]
                growth = ft["growth_rate"] * intensity * (1.0 - intensity) * o2_factor * vent_factor
                decay = self.suppression["effectiveness"] * intensity if active else 0.0
                c["intensity"] = max(0.0, min(1.0, intensity + (growth - decay) * dt))
                if c["intensity"] < 0.02 and active:
                    c.update(on_fire=False, intensity=0.0, spread_progress=0.0)
                    self._log("compartment_extinguished", f"Fire extinguished in {cid}.", "info")
                if c["on_fire"]:
                    c["temp_C"] = 22.0 + c["intensity"] * ft["heat_release_MW"] * 320.0
                else:
                    c["temp_C"] = _toward(old["temp_C"], 22.0, 1.5 * dt)
            else:
                c["intensity"] = 0.0
                c["temp_C"] = _toward(old["temp_C"], 22.0, 1.5 * dt)

            # Transport is independent of ignition, including smoke-only compartments.
            smoke = max(0.0, old["smoke"] + smoke_delta[cid])
            if old["on_fire"]:
                smoke += c["intensity"] * ft["smoke_yield"] * 0.05 * dt
            else:
                smoke *= max(0.0, 1.0 - 0.01 * dt)
            c["smoke"] = min(1.0, smoke)
            if c["smoke"] > 0:
                c["affected"] = True

            if active:
                c["spread_progress"] = 0.0
            elif not isolated and not old["on_fire"] and self.status == "running":
                sources = [nb for nb in sorted(ADJACENCY[cid])
                           if prev[nb]["on_fire"] and prev[nb]["intensity"] > 0.35]
                incoming = math.fsum(prev[nb]["intensity"] for nb in sources)
                c["spread_progress"] = old["spread_progress"] + incoming * ft["spread_factor"] * transfer_factor * 0.12 * dt
                if incoming > 0 and transfer_factor > 0 and c["spread_progress"] >= 1.0:
                    c.update(on_fire=True, affected=True, intensity=max(0.15, self.config["initial_intensity"] * 0.5),
                             ignited_at=t, spread_progress=0.0)
                    self._log("fire_spread", f"Fire spread {sources[0]} → {cid}.", "critical")
        self.compartments = next_compartments
        total_intensity = math.fsum(self.compartments[cid]["intensity"] for cid in ids)

        # Atmosphere coupling. Oxygen isolation can only remove oxygen, never create it.
        a = self.atmosphere
        if total_intensity > 0:
            heat = total_intensity * ft["heat_release_MW"]
            a["temp_C"] = min(90.0, a["temp_C"] + heat * 0.35 * dt)
            a["o2_pct"] = max(0.0, a["o2_pct"] - total_intensity * ft["o2_consumption"] * 0.020 * dt)
            a["co_ppm"] = min(400.0, a["co_ppm"] + total_intensity * ft["co_yield"] * 1.6 * dt)
            a["co2_ppm"] = min(30000.0, a["co2_ppm"] + total_intensity * 60.0 * dt)
            a["smoke_mgm3"] = min(12.0, a["smoke_mgm3"] + total_intensity * ft["smoke_yield"] * 0.06 * dt)
            a["humidity_pct"] = min(100.0, a["humidity_pct"] + total_intensity * 0.05 * dt)
            a["pressure_kpa"] = min(107.0, a["pressure_kpa"] + heat * 0.010 * dt)
        else:
            self._recover_atmosphere(dt)
        if self.suppression["o2_isolated"]:
            target = min(a["o2_pct"], 16.0)
            a["o2_pct"] = _toward(a["o2_pct"], target, 0.02 * dt)
        diluent = self.suppression.get("diluent")
        if diluent == "CO2":
            a["o2_pct"] = max(14.0, a["o2_pct"] - 0.05 * dt)
            a["co2_ppm"] = min(30000.0, a["co2_ppm"] + 250.0 * dt)
        elif diluent == "He":
            a["o2_pct"] = max(14.0, a["o2_pct"] - 0.05 * dt)

        # detection event
        if self.status == "running" and self.detection_time is None and (a["smoke_mgm3"] > 0.15 or a["temp_C"] > 30 or total_intensity > 0.3):
            self.detection_time = t
            self._log("fire_detected", f"Fire detected at t={t:.1f}s (smoke/heat signature).", "critical")
            if self.config["automatic_suppression_enabled"] and not self.suppression["active"]:
                if self.config["fire_type"] == "oxygen_enriched" and not self.suppression["o2_isolated"]:
                    self.activate_suppression("isolate_oxygen", confirmed=True)
                action = self.automatic_suppression_action()
                self.activate_suppression(action, confirmed=True)
                self._log("automatic_suppression", f"Automatic response selected: {action}.", "warning")

        # Module 10: armed prevention quenches any flame immediately, without waiting for detection.
        if self.prevention is not None and self.prevention.armed and self.status == "running":
            if any(c["on_fire"] for c in self.compartments.values()):
                self.prevention.emergency_quench()

        # threshold violations + crew transitions
        self._check_thresholds()
        crew = self.crew_analysis()["status"]
        if crew != self._last_crew:
            self._log("crew_status_change", f"Crew environmental-risk status {self._last_crew} → {crew}.", "critical" if crew in ("DANGER", "CRITICAL") else "warning")
            self._last_crew = crew

        # extinguished?
        burning_now = sum(1 for c in self.compartments.values() if c["on_fire"])
        if burning_before > 0 and burning_now == 0 and self.status == "running":
            self.status = "extinguished"
            if self.extinguish_time is None:
                self.extinguish_time = t
            self._log("fire_extinguished", f"All compartments extinguished at t={t:.1f}s.", "info")
            self._log("atmosphere_recovery", "Flames extinguished; polluted atmosphere continues recovering.", "info")

        # history sampling (~1 sim-second)
        self._sample_accum += dt
        if self._sample_accum >= 1.0:
            self._sample_accum %= 1.0
            self.history.append({
                "t": round(t, 2), "intensity": round(total_intensity, 3),
                **{key: round(value, 6) for key, value in a.items()}, "burning": burning_now,
            })
            if len(self.history) > 600:
                self.history = self.history[-600:]

    def _recover_atmosphere(self, dt: float):
        if self.config.get("hold_critical"):
            if self.suppression["active"]:
                rates = {"o2_pct": 0.08, "co_ppm": 2.0, "co2_ppm": 120.0, "temp_C": 0.6,
                         "humidity_pct": 0.1, "smoke_mgm3": 0.1, "pressure_kpa": 0.02}
                for key, rate in rates.items():
                    target = self._baseline_atmosphere[key]
                    self.atmosphere[key] = _toward(self.atmosphere[key], target, rate * dt)
            return
        rates = {"o2_pct": 0.02, "co_ppm": 0.4, "co2_ppm": 20.0, "temp_C": 0.15,
                 "humidity_pct": 0.05, "smoke_mgm3": 0.02, "pressure_kpa": 0.01}
        for key, rate in rates.items():
            target = self._baseline_atmosphere[key]
            if key == "o2_pct" and (self.suppression["o2_isolated"] or self.suppression.get("diluent")):
                target = min(target, self.atmosphere[key])
            self.atmosphere[key] = _toward(self.atmosphere[key], target, rate * dt)

    def advance(self, real_seconds: float):
        """Retain fractional sim time across calls, including pauses and recovery."""
        if not math.isfinite(real_seconds) or real_seconds < 0:
            raise ValueError("Advance duration must be finite and non-negative.")
        if not self._is_advancing():
            return
        sim_seconds = self._step_remainder + real_seconds * self.config["speed"]
        steps = math.floor((sim_seconds + 1e-12) / self.DT)
        self._step_remainder = max(0.0, sim_seconds - steps * self.DT)
        for _ in range(steps):
            self.step(self.DT)

    # ---------------- analysis ----------------
    def _check_thresholds(self):
        for key, th in self.thresholds.items():
            st = _band_status(self.atmosphere[key], th)
            if st in ("WARNING", "CRITICAL"):
                vkey = (key, st)
                if vkey not in self._violations_logged:
                    self._violations_logged.add(vkey)
                    self._log("threshold_violation", f"{th['label']} = {self.atmosphere[key]:.2f}{th['unit']} crossed {st} band.", "critical" if st == "CRITICAL" else "warning")

    def fire_severity(self) -> str:
        total = sum(c["intensity"] for c in self.compartments.values())
        burning = sum(1 for c in self.compartments.values() if c["on_fire"])
        has_critical_env = any(_band_status(v, self.thresholds[k]) == "CRITICAL" for k, v in self.atmosphere.items() if k in self.thresholds)
        has_warning_env = any(_band_status(v, self.thresholds[k]) == "WARNING" for k, v in self.atmosphere.items() if k in self.thresholds)

        if total > 2.0 or burning >= 4:
            return "Extreme"
        if total > 1.0 or burning >= 2 or has_critical_env:
            return "Critical"
        if total > 0.02 or burning > 0 or has_warning_env:
            return "Warning"
        return "Normal"

    def time_to_critical(self) -> Optional[float]:
        """Environmental threshold extrapolation, never a human survival estimate."""
        for key, th in self.thresholds.items():
            if _band_status(self.atmosphere[key], th) == "CRITICAL":
                return 0.0
        if not self._is_advancing() or len(self.history) < 2:
            return None
        h0, h1 = self.history[-2], self.history[-1]
        dt = h1["t"] - h0["t"]
        if dt <= 0:
            return None
        candidates = []
        for key, th in self.thresholds.items():
            # Legacy history may lack humidity or pressure.
            if key not in h0 or key not in h1:
                continue
            rate = (h1[key] - h0[key]) / dt
            current = self.atmosphere[key]
            crit_lo, crit_hi = th["crit"]
            if rate > 1e-9:
                candidates.append((crit_hi - current) / rate)
            elif rate < -1e-9:
                candidates.append((current - crit_lo) / -rate)
        return round(max(0.0, min(candidates)), 1) if candidates else None

    def crew_analysis(self) -> Dict[str, Any]:
        species_status = {k: _band_status(v, self.thresholds[k]) for k, v in self.atmosphere.items()}
        band_to_crew = {"OK": "SAFE", "CAUTION": "CAUTION", "WARNING": "DANGER", "CRITICAL": "CRITICAL"}
        worst = "SAFE"
        for st in species_status.values():
            cw = band_to_crew[st]
            if CREW_ORDER.index(cw) > CREW_ORDER.index(worst):
                worst = cw
        sev = self.fire_severity()
        if sev == "Extreme":
            worst = "CRITICAL"
        elif sev == "Critical" and CREW_ORDER.index(worst) < CREW_ORDER.index("DANGER"):
            worst = "DANGER"

        a = self.atmosphere
        # Ordinal environmental-band indicators, not physiological probabilities.
        risk_by_band = {"OK": 0.0, "CAUTION": 0.25, "WARNING": 0.65, "CRITICAL": 1.0}
        risk_species = {"oxygen": "o2_pct", "toxic_gas": "co_ppm", "co2": "co2_ppm",
                        "heat": "temp_C", "smoke": "smoke_mgm3",
                        "humidity": "humidity_pct", "pressure": "pressure_kpa"}
        risks = {risk: risk_by_band[species_status[key]] for risk, key in risk_species.items()}
        urgency = "ROUTINE"
        if worst == "CAUTION":
            urgency = "MONITOR"
        elif worst == "DANGER":
            urgency = "PREPARE EVACUATION"
        elif worst == "CRITICAL":
            urgency = "EVACUATE / DON PBA NOW"

        ttc = self.time_to_critical()
        factors = [f"{self.thresholds[key]['label']} {a[key]:.2f}{self.thresholds[key]['unit']} ({status})"
                   for key, status in species_status.items() if status != "OK"]
        explanation = ("; ".join(factors) + ". Environmental bands are not human survival limits.") if factors else (
            "Monitored atmosphere is within configured nominal bands; active fire hazards are assessed separately. "
            "This is not a guarantee of crew safety."
        )
        return {
            "status": worst, "species_status": species_status, "risks": risks,
            "risk_basis": "Ordinal configured environmental bands, not medical risk probabilities.",
            "evacuation_urgency": urgency, "time_to_critical_s": ttc,
            "time_to_critical_label": ENVIRONMENTAL_TTC_LABEL,
            "time_to_critical_assumptions": list(ENVIRONMENTAL_TTC_ASSUMPTIONS),
            "survival_range": None, "explanation": explanation,
            "habitability": "HABITABLE" if worst in ("SAFE", "CAUTION") else "DEGRADED" if worst == "DANGER" else "NOT HABITABLE",
            "disclaimer": SIMULATION_DISCLAIMER,
        }

    # ---------------- events / report ----------------
    def _log(self, etype: str, message: str, severity: str):
        self.events.append({"t": round(self.sim_time, 2), "wall": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "type": etype, "message": message, "severity": severity})

    def state(self) -> Dict[str, Any]:
        total = sum(c["intensity"] for c in self.compartments.values())
        burning = [cid for cid, c in self.compartments.items() if c["on_fire"]]
        affected = [cid for cid, c in self.compartments.items() if c["affected"]]
        growth = 0.0
        if len(self.history) >= 2:
            h0, h1 = self.history[-2], self.history[-1]
            dt = h1["t"] - h0["t"]
            growth = (h1["intensity"] - h0["intensity"]) / dt if dt > 0 else 0.0
        spread_dir = None
        if burning:
            src = burning[0]
            nbrs = [n for n in ADJACENCY[src] if self.compartments[n]["affected"]]
            spread_dir = nbrs[0] if nbrs else None
        return {
            "status": self.status, "sim_time": round(self.sim_time, 2), "speed": self.config["speed"],
            "config": self.config, "fire_type": FIRE_TYPES[self.config["fire_type"]],
            "severity": self.fire_severity(), "detected": self.detection_time is not None,
            "ignition_vetoed": self.ignition_vetoed and self.ignition_time is None,
            "ignition_time": self.ignition_time, "detection_time": self.detection_time,
            "extinguish_time": self.extinguish_time,
            "recovery_active": self.status == "extinguished",
            "fire": {"location": self.config["ignition"], "burning": burning, "affected": affected,
                     "total_intensity": round(total, 3), "growth_rate": round(growth, 4),
                     "spread_direction": spread_dir, "propagation_speed_mms": round(max(0.0, growth) * 12.0, 3),
                     "duration_s": round(self.sim_time, 1), "affected_area_m2": round(len(affected) * 6.0, 1)},
            "compartments": self.compartments, "atmosphere": {k: round(v, 3) for k, v in self.atmosphere.items()},
            "suppression": self.suppression, "crew": self.crew_analysis(),
            "time_to_critical_s": self.time_to_critical(),
            "time_to_critical_label": ENVIRONMENTAL_TTC_LABEL,
            "time_to_critical_assumptions": list(ENVIRONMENTAL_TTC_ASSUMPTIONS),
            "command_acknowledgement": self.command_acknowledgements[-1] if self.command_acknowledgements else None,
            "command_acknowledgements": self.command_acknowledgements[-200:],
            "events": self.events[-200:], "history": self.history[-120:],
            "thresholds": self.thresholds, "data_source": "SIMULATION", "disclaimer": SIMULATION_DISCLAIMER,
        }

    def build_report(self, ai_assessment: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        s = self.state()
        rec = self.suppression_recommendation()
        md = []
        md.append("# Spacecraft Fire Emergency Incident Report")
        md.append(f"\n> {SIMULATION_DISCLAIMER}\n")
        md.append("## 1. Incident Overview")
        md.append(f"- Status: {s['status']} | Sim time: {s['sim_time']}s | Speed: {s['speed']}x")
        md.append(f"- Data source: {s['data_source']}")
        md.append(f"- Ignition: t={s['ignition_time']}s in {s['fire']['location']}")
        md.append(f"- Detection: t={s['detection_time']}s" if s['detection_time'] is not None else "- Detection: not detected")
        md.append(f"- Extinguished: t={s['extinguish_time']}s" if s['extinguish_time'] is not None else "- Extinguished: pending")
        md.append("\n## 2. Fire Classification")
        md.append(f"- Type: {s['fire_type']['name']} ({s['fire_type']['class']})")
        md.append(f"- Severity: {s['severity']} | Intensity: {s['fire']['total_intensity']} | Affected area: {s['fire']['affected_area_m2']} m²")
        md.append("\n## 3. Fire Spread Timeline")
        for e in self.events:
            if e["type"] in ("ignition", "fire_detected", "fire_spread", "compartment_extinguished", "fire_extinguished"):
                md.append(f"- t={e['t']}s [{e['severity']}] {e['message']}")
        md.append("\n## 4. Environmental Changes")
        for k, v in s["atmosphere"].items():
            th = self.thresholds[k]
            md.append(f"- {th['label']}: {v}{th['unit']} (normal {th['normal'][0]}–{th['normal'][1]})")
        md.append("\n## 5. Suppression Actions")
        acts = [e for e in self.events if e["type"] in ("suppression_activation", "emergency_isolation", "oxygen_isolation", "suppression_stop", "emergency_alert")]
        md += [f"- t={e['t']}s {e['message']}" for e in acts] or ["- None activated"]
        md.append(f"- Recommended: {rec['recommended_method']}")
        md.append("\n## 6. Crew Survival Assessment (Environmental Risk)")
        c = s["crew"]
        md.append(f"- Status: {c['status']} | Habitability: {c['habitability']} | Urgency: {c['evacuation_urgency']}")
        md.append(f"- {c['explanation']}")
        ttc = c["time_to_critical_s"]
        md.append(f"- {c['time_to_critical_label']}: {str(ttc) + 's' if ttc is not None else 'unavailable'}")
        md += [f"- Assumption: {assumption}" for assumption in c["time_to_critical_assumptions"]]
        md.append("- No human survival estimate is provided.")
        md.append("\n## 7. AI Recommendations")
        if ai_assessment:
            md.append(f"- Summary: {ai_assessment.get('situation_summary','')}")
            for r in ai_assessment.get("recommended_response", []):
                md.append(f"- {r}")
        else:
            md.append("- AI assessment not generated for this report.")
        md.append("\n## 8. Full Event Log")
        md += [f"- t={e['t']}s [{e['type']}/{e['severity']}] {e['message']}" for e in self.events]
        return {"markdown": "\n".join(md), "json": {"state": s, "recommendation": rec, "ai": ai_assessment, "events": self.events}}


def build_ai_assessment(state: Dict[str, Any], brain=None) -> Dict[str, Any]:
    """Structured emergency intelligence. Never invents readings; uses only provided state."""
    source = state.get("data_source", "SIMULATION")
    is_live = source == "LIVE_HARDWARE"
    fire = state.get("fire", {})
    fire_type = state.get("fire_type", {})
    crew = state.get("crew", {})
    atm = state.get("atmosphere", {})
    missing_channels = [k for k, v in atm.items() if v is None]

    if is_live:
        summary = (
            f"Live hardware telemetry audit: crew threshold status {crew.get('status', 'UNKNOWN')}; "
            f"possible fire indicator {'ACTIVE' if state.get('possible_fire') else 'NOT TRIGGERED'}. "
            + (f"Missing/uncalibrated channels: {', '.join(missing_channels)}." if missing_channels else "All monitored channels active.")
        )
        recommended = [
            "Verify physical sensor calibration and channel connectivity before acting on partial telemetry.",
            "Consult validated spacecraft fire procedures; live hardware actuation remains locked.",
        ]
        if state.get("possible_fire"):
            recommended.insert(0, "Investigate elevated temperature, CO, or smoke signature with crew/ground telemetry review.")
        spread = "Fire type, ignition compartment, and compartment spread cannot be inferred from cabin ambient sensors alone."
        rationale = "Derived strictly from live hardware gateway telemetry and configured environmental thresholds; missing channels are withheld, not estimated."
    else:
        summary = (
            f"{fire_type.get('name', 'Unknown')} in {fire.get('location', 'UNKNOWN')}; "
            f"severity {state.get('severity', 'Normal')}; "
            f"{len(fire.get('burning', []))} compartment(s) burning; crew {crew.get('status', 'SAFE')}."
        )
        recommended = [
            fire_type.get("suppressant", "Consult validated procedure."),
            "Don PBA if smoke/CO elevated.",
            "Isolate ventilation to affected compartment if spread risk.",
        ]
        spread = f"Fire may propagate to adjacent compartments via ventilation; currently toward {fire.get('spread_direction') or 'none yet'}."
        rationale = "Derived from simulated fire type, compartment adjacency, and atmospheric thresholds; not from real sensors."

    deterministic = {
        "data_source": source,
        "situation_summary": summary,
        "fire_severity": state.get("severity", "Unknown"),
        "environmental_risk": crew.get("explanation", "Threshold assessment unavailable."),
        "recommended_response": recommended,
        "crew_recommendations": [
            crew.get("evacuation_urgency", "VERIFY SENSOR COVERAGE"),
            "Monitor O2/CO/CO2 trends; distinguish environmental thresholds from human survival limits.",
        ],
        "spread_scenario": spread,
        "rationale": rationale,
        "mode": "DETERMINISTIC_FALLBACK",
    }
    if brain is None or not brain.is_available():
        return deterministic
    source_note = (
        "Data source is LIVE_HARDWARE (real gateway channels only; null values are missing/uncalibrated and MUST NOT be invented; fire type/location cannot be inferred from ambient sensors alone; live actuation is locked)."
        if is_live
        else "Data source is SIMULATION (synthetic deterministic compartment fire model; label everything SIMULATION)."
    )
    prompt = (
        f"You are a spacecraft fire-emergency intelligence officer. Using ONLY the JSON state below, {source_note} "
        "Return STRICT JSON with keys: situation_summary, fire_severity, environmental_risk, recommended_response (array), "
        "crew_recommendations (array), spread_scenario, rationale. Respect spacecraft suppression safety: "
        "no water on energized electrical or Li-ion unless approved, and never recommend unverified live actuation.\n\nSTATE:\n"
        + json.dumps({k: state.get(k) for k in ["data_source", "fire_type", "fire", "atmosphere", "crew", "severity", "suppression"]})[:4000]
    )
    try:
        msg = brain.chat([{"role": "user", "content": prompt}], max_tokens=900, temperature=0.2)
        text = (msg.get("content") or "").strip()
        start = text.find("{"); end = text.rfind("}")
        parsed = json.loads(text[start:end + 1])
        parsed["data_source"] = source
        parsed["mode"] = "LLM_EMERGENCY_INTELLIGENCE"
        for k, v in deterministic.items():
            parsed.setdefault(k, v)
        return parsed
    except Exception:
        return deterministic