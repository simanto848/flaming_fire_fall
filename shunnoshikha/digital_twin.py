#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 2: 3-Regime Combustion Digital Twin
Physics-grounded microgravity digital twin modeling the non-linear U-shaped flammability boundary:
- Radiative Quenching Extinction (Low flow & low oxygen)
- Thermal/Kinetic Sustained Burn (Flammable flight envelope)
- Convective Blowoff Extinction (High flow, Da < 1)

Includes:
- Target exploration atmosphere projections (Lunar EVA, Mars Habitat, Exploration Gateway, ISS baseline)
- 2D and 3D flammability boundary manifold computation
- Dynamic trajectory tracking across flammability regimes
"""

import numpy as np
from typing import Dict, List, Any, Tuple

EXPLORATION_ATMOSPHERES = {
    "ISS_Standard": {
        "name": "ISS Standard Sea-Level Baseline",
        "pressure_psi": 14.7,
        "pressure_kpa": 101.3,
        "o2_pct": 21.0,
        "description": "Earth ambient equivalent atmosphere used inside ISS Destiny, Harmony, and Columbus modules."
    },
    "Exploration_Gateway": {
        "name": "NASA Exploration Habitat (Gateway)",
        "pressure_psi": 10.2,
        "pressure_kpa": 70.3,
        "o2_pct": 32.0,
        "description": "Reduces EVA pre-breathe time to under 60 minutes while preserving sea-level equivalent O2 partial pressure."
    },
    "Lunar_EVA": {
        "name": "Lunar Surface Habitat (EVA Atmosphere)",
        "pressure_psi": 8.2,
        "pressure_kpa": 56.5,
        "o2_pct": 34.0,
        "description": "Enables direct, zero-prebreathe extravehicular activity for Artemis surface crews."
    },
    "Mars_Habitat": {
        "name": "Martian Surface Habitat Atmosphere",
        "pressure_psi": 9.5,
        "pressure_kpa": 65.5,
        "o2_pct": 28.0,
        "description": "Optimized trade-off between structural cabin mass, leak rates, and astronaut metabolic health."
    }
}

# Fix 3: intermediate gravity levels strictly bounded between 0 g (ISS flight
# evidence) and 1 g (ground baselines). Lunar 0.16 g and Mars 0.38 g are
# interpolated, never extrapolated beyond the endpoints.
PARTIAL_GRAVITY_LEVELS = {
    "microgravity": {"g": 0.0, "label": "0 g (ISS microgravity)"},
    "lunar": {"g": 0.16, "label": "0.16 g (Lunar surface)"},
    "mars": {"g": 0.38, "label": "0.38 g (Martian surface)"},
    "earth": {"g": 1.0, "label": "1 g (Earth ground baseline)"},
}

PARTIAL_GRAVITY_REFERENCE = {
    "existing_psi_proxy": (
        "ACME E-FIELD Flames (ISS Combustion Integrated Rack): electric body forces on "
        "flame ions mimic partial-gravity buoyancy, providing existing PSI flight evidence "
        "between the 0 g and 1 g endpoints."
    ),
    "precursor_for": [
        "LUCI (Lunar-g Combustion Investigation) - 0.16 g",
        "FM2 (Flammability of Materials on the Moon) - 0.16 g",
    ],
    "method": (
        "Buoyancy surrogate: effective draft u_eff = u_forced + 10*g cm/s; limiting oxygen "
        "index interpolated between microgravity and Earth values. Generated partial-gravity "
        "virtual experiments are flagged as precursors for LUCI / FM2, not flight data."
    ),
}


def gravity_label(g: float) -> str:
    if g <= 0.0:
        return "0 g (ISS microgravity)"
    if g >= 1.0:
        return "1 g (Earth ground baseline)"
    if abs(g - 0.16) < 0.02:
        return "0.16 g (Lunar surface)"
    if abs(g - 0.38) < 0.02:
        return "0.38 g (Martian surface)"
    return f"{g:.2f} g (partial gravity)"


MATERIAL_PHYSICS = {
    "PMMA": {
        "loi_earth": 17.5,
        "loi_microg": 18.2,
        "t_pyrolysis_C": 380.0,
        "t_flame_ref_K": 1620.0,
        "heat_combustion_MJ_kg": 26.2,
        "activation_energy_kJ_mol": 130.0,
        "soot_yield": 0.02
    },
    "Nomex": {
        "loi_earth": 26.0,
        "loi_microg": 27.5,
        "t_pyrolysis_C": 520.0,
        "t_flame_ref_K": 1850.0,
        "heat_combustion_MJ_kg": 20.0,
        "activation_energy_kJ_mol": 175.0,
        "soot_yield": 0.05
    },
    "Cotton-Fiber Blend": {
        "loi_earth": 16.8,
        "loi_microg": 17.2,
        "t_pyrolysis_C": 350.0,
        "t_flame_ref_K": 1540.0,
        "heat_combustion_MJ_kg": 17.5,
        "activation_energy_kJ_mol": 115.0,
        "soot_yield": 0.015
    }
}

class CombustionDigitalTwin:
    """Microgravity Combustion Physics Engine & Boundary Simulator."""
    
    def __init__(self):
        pass

    def evaluate_state(
        self,
        material: str,
        o2_pct: float,
        flow_cms: float,
        pressure_psi: float = 14.7,
        thickness_mm: float = 2.5,
        gravity_g: float = 0.0
    ) -> Dict[str, Any]:
        """
        Evaluates the physical state at gravity level g (0 = microgravity default):
        - Calculates Damköhler number Da = tau_flow / tau_chem
        - Calculates Radiative Loss Index Q_rad = q_rad / q_chem
        - Determines the exact regime: Sustained Burn, Radiative Extinction, Blowoff
        Partial gravity (0 < g < 1) is a bounded buoyancy surrogate between the
        0 g flight endpoint and the 1 g ground endpoint (see PARTIAL_GRAVITY_REFERENCE).
        """
        g = float(min(1.0, max(0.0, gravity_g)))
        mat = MATERIAL_PHYSICS.get(material, MATERIAL_PHYSICS["PMMA"])
        loc = mat["loi_microg"] + (mat["loi_earth"] - mat["loi_microg"]) * g

        # Buoyant draft reintroduced proportionally to g (0 at 0 g, ~10 cm/s at 1 g).
        buoyant_draft = 10.0 * g
        u_eff = flow_cms + buoyant_draft

        # 1. Damköhler reaction proxy (Da = tau_residence / tau_reaction)
        # tau_residence ~ L_flame / u_eff. tau_reaction ~ exp(E_a / RT) / (Y_O2 * P^1.8)
        pressure_ratio = pressure_psi / 14.7
        chemical_rate_factor = (o2_pct / 21.0) * (pressure_ratio ** 1.8)
        flow_damping = 1.0 + (u_eff / 7.0) ** 1.6
        damkohler_proxy = float(chemical_rate_factor / flow_damping)

        # 2. Radiative Loss Index (Q_rad = Radiant heat emission / Chemical heat release)
        # Without buoyancy, radiation to cold surroundings dominates at low forced velocities
        safe_flow = max(0.15, u_eff)
        safe_o2 = max(0.10, o2_pct / 21.0)
        radiative_loss_index = float(1.0 / (safe_flow * safe_o2 * (pressure_ratio ** 0.5)))
        
        # 3. Flame Temperature Estimation (Arrhenius kinetics)
        t_adiabatic_K = 300.0 + (mat["t_flame_ref_K"] - 300.0) * (o2_pct / 21.0) ** 0.8 * (pressure_ratio ** 0.2)
        # Heat loss correction
        rad_loss_K = min(600.0, radiative_loss_index * 120.0)
        t_estimated_flame_K = float(max(300.0, t_adiabatic_K - rad_loss_K))
        
        # 4. Critical Boundary Regime Decision
        # Low flow + low O2 -> Radiative Quenching
        # High flow -> Convective Blowoff (Da < 0.20)
        # Otherwise -> Sustained Burn
        o2_margin = o2_pct - loc
        
        if o2_pct < loc or radiative_loss_index > 1.25 or (u_eff < 1.8 and o2_pct < loc + 2.0):
            regime = "Radiative Extinction"
            p_ext = 0.88 + 0.10 * (1.0 / (1.0 + np.exp(o2_margin)))
            p_sust = 1.0 - p_ext
            p_blow = 0.02
        elif u_eff > 17.5 or damkohler_proxy < 0.22:
            regime = "Blowoff"
            p_blow = 0.85 + 0.12 * (u_eff - 17.5) / 10.0
            p_blow = min(0.96, p_blow)
            p_sust = (1.0 - p_blow) * 0.7
            p_ext = (1.0 - p_blow) * 0.3
        else:
            regime = "Sustained Burn"
            p_sust = 0.82 + 0.15 * min(1.0, o2_margin / 10.0)
            p_ext = (1.0 - p_sust) * 0.65
            p_blow = (1.0 - p_sust) * 0.35

        # Normalize probabilities
        total_p = p_sust + p_ext + p_blow
        probabilities = {
            "Sustained Burn": round(float(p_sust / total_p), 4),
            "Radiative Extinction": round(float(p_ext / total_p), 4),
            "Blowoff": round(float(p_blow / total_p), 4)
        }
        
        gravity_context: Dict[str, Any] = {
            "gravity_g": g,
            "label": gravity_label(g),
            "bounded_between": ["0 g (ISS flight evidence)", "1 g (ground baseline)"],
        }
        if 0.0 < g < 1.0:
            gravity_context.update(PARTIAL_GRAVITY_REFERENCE)
            gravity_context["virtual_experiment_flag"] = (
                "Generated partial-gravity virtual experiment - OOD extrapolation, "
                "precursor for LUCI / FM2, not flight data."
            )

        return {
            "material": material,
            "inputs": {
                "o2_concentration_pct": o2_pct,
                "airflow_velocity_cms": flow_cms,
                "cabin_pressure_psi": pressure_psi,
                "sample_thickness_mm": thickness_mm,
                "gravity_g": g
            },
            "regime": regime,
            "probabilities": probabilities,
            "gravity_context": gravity_context,
            "physics_metrics": {
                "limiting_oxygen_index": round(loc, 2),
                "o2_margin": round(o2_margin, 2),
                "damkohler_proxy": round(damkohler_proxy, 3),
                "radiative_loss_index": round(radiative_loss_index, 3),
                "buoyant_draft_cms": round(buoyant_draft, 2),
                "effective_flow_cms": round(u_eff, 2),
                "estimated_flame_temp_K": round(t_estimated_flame_K, 1),
                "estimated_flame_temp_C": round(t_estimated_flame_K - 273.15, 1)
            }
        }

    def generate_boundary_surface(
        self,
        material: str,
        pressure_psi: float = 14.7,
        n_points: int = 25,
        gravity_g: float = 0.0
    ) -> Dict[str, Any]:
        """Generates 2D phase boundary contour array for interactive plotting."""
        flow_range = np.linspace(0.5, 24.0, n_points)
        o2_range = np.linspace(13.0, 35.0, n_points)

        # Grid: 0 = Radiative Extinction, 1 = Sustained Burn, 2 = Blowoff
        Z = np.zeros((len(o2_range), len(flow_range)))

        for i, o2 in enumerate(o2_range):
            for j, u in enumerate(flow_range):
                res = self.evaluate_state(material, o2, u, pressure_psi, gravity_g=gravity_g)
                r = res["regime"]
                Z[i, j] = 1 if r == "Sustained Burn" else (0 if r == "Radiative Extinction" else 2)

        return {
            "flow_values": flow_range.tolist(),
            "o2_values": o2_range.tolist(),
            "boundary_grid": Z.tolist(),
            "material": material,
            "cabin_pressure_psi": pressure_psi,
            "gravity_g": float(min(1.0, max(0.0, gravity_g))),
            "gravity_label": gravity_label(float(min(1.0, max(0.0, gravity_g))))
        }

    def simulate_trajectory(
        self,
        material: str,
        start_state: Dict[str, float],
        end_state: Dict[str, float],
        steps: int = 10,
        gravity_g: float = 0.0
    ) -> List[Dict[str, Any]]:
        """Simulates a continuous trajectory through cabin environmental parameter space."""
        trajectory = []
        for alpha in np.linspace(0.0, 1.0, steps):
            curr_o2 = start_state["o2_pct"] + alpha * (end_state["o2_pct"] - start_state["o2_pct"])
            curr_u = start_state["flow_cms"] + alpha * (end_state["flow_cms"] - start_state["flow_cms"])
            curr_p = start_state.get("pressure_psi", 14.7) + alpha * (end_state.get("pressure_psi", 14.7) - start_state.get("pressure_psi", 14.7))
            
            step_eval = self.evaluate_state(material, curr_o2, curr_u, curr_p, gravity_g=gravity_g)
            trajectory.append({
                "step": int(alpha * 100),
                "o2_pct": round(curr_o2, 2),
                "flow_cms": round(curr_u, 2),
                "pressure_psi": round(curr_p, 2),
                "regime": step_eval["regime"],
                "probabilities": step_eval["probabilities"],
                "flame_temp_K": step_eval["physics_metrics"]["estimated_flame_temp_K"]
            })
        return trajectory

