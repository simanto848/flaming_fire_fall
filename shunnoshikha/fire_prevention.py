#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 10: Autonomous Fire Prevention ("fire cannot start").

A continuous pre-ignition guard that watches the cabin atmosphere through the
combustion digital twin and acts BEFORE a flame can establish:

1. Ignition-kernel quench  — pre-charged local fine-water-mist / CO2 inerting
   extinguishes an ignition attempt in the compartment before flame spread.
2. Oxidizer conditioning   — trims oxygen enrichment back into the crew-safe
   band (never below 19.5% O2, never above the configured target).
3. Ignition-source isolation — de-energizes non-essential circuits when the
   flammability risk climbs, removing the ignition source itself.
4. Inert-gas dilution guard — an emergency CO2 dilution layer (FLEX / FLEX-2
   studied CO2 and He diluents) is added to autonomous quenches when enabled.

EDUCATIONAL / RESEARCH SIMULATION ONLY. No hardware is commanded. The guarantee
"fire cannot start" holds while the system is ARMED and the risk score exceeds
the aggressiveness-derived block threshold; standing down is an explicit,
confirmed operator action and is logged.
"""

import time
from collections import deque
from typing import Any, Dict, List, Optional

from shunnoshikha.digital_twin import CombustionDigitalTwin

PROTECTED_MATERIALS = ["PMMA", "Nomex", "Cotton-Fiber Blend"]
CREW_SAFE_O2_FLOOR = 19.5
O2_TRIM_TARGET = 21.5
O2_ENRICHMENT_TRIGGER = 23.0

PREVENTION_DISCLAIMER = (
    "Educational simulation of autonomous prevention. Interventions are synthetic; "
    "no spacecraft HVAC, inerting, or suppression hardware is commanded."
)


def _utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class FirePreventionSystem:
    def __init__(self, engine, twin: Optional[CombustionDigitalTwin] = None):
        self.engine = engine
        self.twin = twin or CombustionDigitalTwin()
        self.armed = True
        self.aggressiveness = 0.7
        self.auto_inert_o2 = True
        self.ignition_isolation = True
        self.mist_precharge = True
        self.dilution_guard = True
        self.log: deque = deque(maxlen=250)
        self.stats = {"ignitions_blocked": 0, "interventions": 0, "quench_count": 0}
        self.last_block: Optional[Dict[str, Any]] = None
        self._risk: Dict[str, Any] = self._empty_risk()
        self._cooldown: Dict[str, float] = {}
        self._o2_episode_active = False
        self._clock = time.monotonic
        self._record("prevention_online", "Autonomous prevention armed at startup — ignition attempts will be quenched.", "info")
        self.assess()

    # ---------------- risk model ----------------
    def _empty_risk(self) -> Dict[str, Any]:
        return {"score": 0.0, "tier": "SAFE", "flammability": 0.0, "ignition_factor": 1.0,
                "precursor_boost": 0.0, "drivers": [], "materials": {}}

    def block_threshold(self) -> float:
        return round(0.45 - 0.30 * self.aggressiveness, 3)

    def assess(self) -> Dict[str, Any]:
        atm = self.engine.atmosphere
        cfg = self.engine.config
        flow = float(cfg.get("ventilation_cms", 7.5))
        pressure_psi = float(atm.get("pressure_kpa", 101.3)) / 6.89476
        o2 = float(atm.get("o2_pct", 21.0))

        materials = {}
        worst = 0.0
        for mat in PROTECTED_MATERIALS:
            ev = self.twin.evaluate_state(mat, o2, flow, pressure_psi)
            p = ev["probabilities"]["Sustained Burn"]
            materials[mat] = {"regime": ev["regime"], "p_sustained": p,
                              "o2_margin": ev["physics_metrics"]["o2_margin"]}
            worst = max(worst, p)

        deenergized = bool(cfg.get("equipment_deenergized"))
        ignition_factor = 0.15 if deenergized else 1.0
        boost = 0.0
        drivers: List[str] = []
        if atm.get("smoke_mgm3", 0.0) > 0.08:
            boost += 0.15
            drivers.append("Smoke precursor detected")
        if atm.get("temp_C", 22.0) > 30.0:
            boost += 0.15
            drivers.append("Thermal precursor detected")
        if o2 > O2_ENRICHMENT_TRIGGER:
            drivers.append(f"Oxygen enriched ({o2:.1f}%)")
        if worst >= 0.5:
            drivers.append("Cabin inside flammable envelope")
        if deenergized:
            drivers.append("Ignition sources isolated (de-energized)")

        score = min(1.0, worst * ignition_factor + boost)
        tier = "SAFE" if score < 0.2 else "GUARDED" if score < 0.45 else "ELEVATED" if score < 0.7 else "HIGH"
        self._risk = {
            "score": round(score, 3), "tier": tier,
            "flammability": round(worst, 3), "ignition_factor": ignition_factor,
            "precursor_boost": round(boost, 3), "drivers": drivers, "materials": materials,
            "block_threshold": self.block_threshold(),
        }
        return self._risk

    # ---------------- ignition guard ----------------
    def on_ignition_attempt(self, compartment: str) -> bool:
        """Return True to veto the ignition (fire cannot start)."""
        if not self.armed:
            return False
        risk = self.assess()
        if not self.mist_precharge:
            return False
        if risk["score"] < self.block_threshold():
            return False
        self.stats["ignitions_blocked"] += 1
        self.last_block = {"compartment": compartment, "t": round(self.engine.sim_time, 2),
                           "wall": _utc(), "risk": risk["score"]}
        self._record(
            "ignition_prevented",
            f"Ignition attempt in {compartment} quenched by pre-charged local inerting "
            f"(risk {risk['score']:.2f} ≥ threshold {risk['block_threshold']:.2f}). Fire could not start.",
            "success",
        )
        return True

    def emergency_quench(self):
        """Immediate suppression if a flame exists while armed (e.g. armed mid-incident)."""
        if self.engine.suppression["active"]:
            return
        self.stats["quench_count"] += 1
        try:
            self.engine.activate_suppression("emergency_isolation", confirmed=True)
            if self.dilution_guard:
                self.engine.activate_suppression("dilute_co2", confirmed=True)
            self.engine.activate_suppression(self.engine.automatic_suppression_action(), confirmed=True)
        except ValueError:
            self.engine.activate_suppression("activate_suppression", confirmed=True)
        detail = "Flame detected while armed — autonomous isolation + suppression applied immediately."
        if self.dilution_guard:
            detail += " CO2 dilution layer added (FLEX CO2/He diluent precedent); crew on PBA."
        self._record("autonomous_quench", detail, "success")

    # ---------------- continuous conditioning ----------------
    def tick(self, dt: float):
        if not self.armed or dt <= 0:
            return
        risk = self.assess()
        now = self._clock()
        atm = self.engine.atmosphere
        cfg = self.engine.config

        # 1. Oxidizer conditioning: trim enrichment into the crew-safe band.
        if self.auto_inert_o2 and atm["o2_pct"] > O2_ENRICHMENT_TRIGGER:
            rate = 0.25 + 0.5 * self.aggressiveness  # %O2 per simulated second
            atm["o2_pct"] = max(O2_TRIM_TARGET, atm["o2_pct"] - rate * dt)
            cfg["o2_pct"] = atm["o2_pct"]
            if not self._o2_episode_active:
                self._o2_episode_active = True
                self.stats["interventions"] += 1
                self._record("o2_inerting", f"Oxygen enrichment trimmed toward {O2_TRIM_TARGET:.1f}% (crew-safe floor {CREW_SAFE_O2_FLOOR}%).", "warning")
        elif atm["o2_pct"] <= O2_ENRICHMENT_TRIGGER and self._o2_episode_active:
            self._o2_episode_active = False
            self._record("o2_inerting_complete", f"Oxygen stabilized at {atm['o2_pct']:.1f}% — inside crew-safe band.", "success")

        # 2. Ignition-source isolation at elevated risk (cooldown 20 s).
        if (self.ignition_isolation and risk["score"] >= 0.55
                and not cfg.get("equipment_deenergized")
                and now - self._cooldown.get("isolation", -1e9) > 20.0):
            self._cooldown["isolation"] = now
            cfg["equipment_deenergized"] = True
            self.stats["interventions"] += 1
            self._record("ignition_isolation", "Non-essential circuits de-energized — ignition sources removed from the flammable envelope.", "warning")
            self.assess()

        # 3. Any flame while armed is quenched immediately (before detection thresholds).
        if any(c["on_fire"] for c in self.engine.compartments.values()):
            self.emergency_quench()

    # ---------------- operator controls ----------------
    def configure(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        if "armed" in patch:
            armed = bool(patch["armed"])
            if armed and not self.armed:
                self.arm("Operator re-armed autonomous prevention.")
            elif not armed and self.armed:
                self.stand_down("Operator stood down autonomous prevention (confirmed).")
        if "aggressiveness" in patch:
            self.aggressiveness = min(1.0, max(0.0, float(patch["aggressiveness"])))
        for key in ("auto_inert_o2", "ignition_isolation", "mist_precharge", "dilution_guard"):
            if key in patch:
                setattr(self, key, bool(patch[key]))
        self.assess()
        return self.state()

    def arm(self, reason: str):
        self.armed = True
        self._record("prevention_armed", reason, "success")

    def stand_down(self, reason: str):
        self.armed = False
        self._record("prevention_standdown", reason + " Ignition attempts will now be allowed.", "warning")

    # ---------------- reporting ----------------
    def _record(self, kind: str, detail: str, severity: str):
        self.log.appendleft({"t": round(self.engine.sim_time, 2), "wall": _utc(),
                             "type": kind, "detail": detail, "severity": severity})

    def state(self) -> Dict[str, Any]:
        return {
            "armed": self.armed,
            "aggressiveness": self.aggressiveness,
            "auto_inert_o2": self.auto_inert_o2,
            "ignition_isolation": self.ignition_isolation,
            "mist_precharge": self.mist_precharge,
            "dilution_guard": self.dilution_guard,
            "risk": self._risk,
            "stats": dict(self.stats),
            "last_block": self.last_block,
            "log": list(self.log)[:60],
            "disclaimer": PREVENTION_DISCLAIMER,
        }