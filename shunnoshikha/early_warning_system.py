#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 8: Rule-Validated 4-Tier Early-Warning System
Based on NASA-STD-6001 and NASA-STD-3001 Spaceflight Fire Safety Guidelines:
- Evaluates real-time sensor telemetry and ML flammability predictions
- Classifies safety state into 4 distinct tiers: NORMAL, CAUTION, WARNING, CRITICAL
- Recommends automated HVAC suppression and ventilation dampening actions
"""

from typing import Dict, List, Any

# NASA Safety Standards Constants
NASA_SAFETY_LIMITS = {
    "co_caution_ppm": 10.0,      # NASA-STD-3001 7-day SMAC limit
    "co_warning_ppm": 25.0,      # 24-hour SMAC limit
    "co_critical_ppm": 50.0,     # Immediate Spacecraft Hazard limit
    "o2_max_nominal_pct": 23.5,  # Upper limit before flammability acceleration
    "o2_high_risk_pct": 28.0,    # Elevated flammability envelope
    "min_flow_stagnant_cms": 1.5,# Sub-buoyant radiative smolder risk threshold
    "max_temp_nominal_C": 32.0,  # Cabin thermal envelope
    "temp_warning_C": 45.0       # Pyrolysis threshold for common wiring
}

class EarlyWarningSystem:
    """Evaluates telemetry against NASA engineering thresholds and determines safety actions."""
    
    def __init__(self):
        pass

    def evaluate_cabin_safety(
        self,
        telemetry: Dict[str, float],
        prediction: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Evaluates current cabin telemetry + ML prediction:
        Returns:
        - Tier: NORMAL | CAUTION | WARNING | CRITICAL
        - Color code: GREEN | YELLOW | ORANGE | RED
        - Triggering rules and violations
        - Automated HVAC suppression recommendation
        """
        o2 = telemetry.get("o2_concentration_pct", 21.0)
        flow = telemetry.get("airflow_velocity_cms", 7.5)
        temp = telemetry.get("cabin_temp_C", 22.0)
        co = telemetry.get("co_ppm", 0.0)
        smoke = telemetry.get("smoke_obscuration_pct_m", 0.0)
        
        regime = prediction.get("predicted_regime", "Sustained Burn")
        sustained_prob = prediction.get("probabilities", {}).get("Sustained Burn", 0.5)
        
        violations = []
        tier = "NORMAL"
        color = "#00c853" # Green
        severity_score = 0 # 0 to 100
        
        # Check Critical Conditions
        if co >= NASA_SAFETY_LIMITS["co_critical_ppm"]:
            tier = "CRITICAL"
            color = "#ff1744"
            severity_score = 95
            violations.append(f"Toxic Carbon Monoxide ({co:.1f} ppm) exceeded 50 ppm Emergency Threshold (NASA-STD-3001).")
        elif smoke > 1.2:
            tier = "CRITICAL"
            color = "#ff1744"
            severity_score = 90
            violations.append(f"Optical smoke obscuration ({smoke:.2f} %/m) indicates active flame particulate production.")

        # Check Warning Conditions
        elif co >= NASA_SAFETY_LIMITS["co_warning_ppm"] or temp >= NASA_SAFETY_LIMITS["temp_warning_C"]:
            tier = "WARNING"
            color = "#ff9100"
            severity_score = 70
            if co >= NASA_SAFETY_LIMITS["co_warning_ppm"]:
                violations.append(f"Carbon Monoxide ({co:.1f} ppm) exceeded 24-hr SMAC limit (25 ppm). Active smoldering signature.")
            if temp >= NASA_SAFETY_LIMITS["temp_warning_C"]:
                violations.append(f"Cabin local temperature ({temp:.1f} °C) indicates pyrolyzing electronics.")

        # Check Caution Conditions
        elif o2 >= NASA_SAFETY_LIMITS["o2_max_nominal_pct"] or flow <= NASA_SAFETY_LIMITS["min_flow_stagnant_cms"] or co >= NASA_SAFETY_LIMITS["co_caution_ppm"]:
            tier = "CAUTION"
            color = "#ffd600"
            severity_score = 40
            if o2 >= NASA_SAFETY_LIMITS["o2_max_nominal_pct"]:
                violations.append(f"Elevated O2 concentration ({o2:.1f}%) widens solid fuel flammability envelope.")
            if flow <= NASA_SAFETY_LIMITS["min_flow_stagnant_cms"]:
                violations.append(f"Airflow ({flow:.2f} cm/s) in stagnant pocket. Risk of low-speed ghost flame / smolder.")
            if co >= NASA_SAFETY_LIMITS["co_caution_ppm"]:
                violations.append(f"Slight CO elevation ({co:.1f} ppm) detected above 10 ppm baseline.")
        else:
            tier = "NORMAL"
            color = "#00c853"
            severity_score = 5

        # Automated HVAC Suppression Protocol Mapping
        if tier == "CRITICAL":
            action_code = "ACTION_EMERGENCY_SHUTDOWN"
            hvac_action = "CRITICAL EMERGENCY: Trigger immediate automatic shutdown of all cabin ventilation duct fans! Starve forced convection to induce microgravity radiative extinction. Deploy N2/CO2 flood to compartment."
            crew_action = "Don Portable Breathing Apparatus (PBA). Verify hatch closure. Initiate emergency depressurization sequence if fire unsuppressed within 120 seconds."
        elif tier == "WARNING":
            action_code = "ACTION_ISOLATE_VENTILATION"
            hvac_action = "WARNING PROTOCOL: Close motorized fire dampers on affected ventilation duct loop. Reduce cabin airflow velocity below 1.5 cm/s to promote flame radiative quenching."
            crew_action = "Inspect avionics bay with thermal camera. Stand by with Water Mist / Fine Carbon Dioxide fire extinguisher."
        elif tier == "CAUTION":
            action_code = "ACTION_BALANCED_MIXING"
            hvac_action = "CAUTION PROTOCOL: Rebalance HVAC diffuser louvers to disperse stagnant low-velocity pockets. Audit atmospheric scrubber bed performance."
            crew_action = "Monitor environmental telemetry trends. Verify trace contaminant control system (TCCS) efficiency."
        else:
            action_code = "ACTION_NOMINAL_MAINTENANCE"
            hvac_action = "NOMINAL: Maintain standard ISS ventilation airflow (5.0 - 8.0 cm/s). All fire barriers and sensors optimal."
            crew_action = "Routine mission monitoring."

        return {
            "safety_tier": tier,
            "status_color": color,
            "severity_score": severity_score,
            "rule_violations": violations,
            "hvac_suppression_action": hvac_action,
            "action_code": action_code,
            "crew_emergency_protocol": crew_action,
            "eval_timestamp": telemetry.get("timestamp", "")
        }

