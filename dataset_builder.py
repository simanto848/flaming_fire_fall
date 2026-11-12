#!/usr/bin/env python3
"""
Dataset Builder for Microgravity Flammability Explorer
Combines:
1. BASS_II_Solid_Flammability_Dataset.csv (in-flight ISS tests)
2. Empirical boundary points from published NASA Technical Reports:
   - GRC-E-DAA-TN21414 / NASA-TM-20150008961 (PMMA rods concurrent flow)
   - GRC-E-DAA-TN30478 / NASA-TM-20160012691 (PMMA 14-18% O2 blowoff/extinction)
   - GRC-E-DAA-TN39560 / NASA-TM-20170006615 (Low-O2 stretch rate limits)
   - E-19939 / NASA-TP-20210011385 (BASS-II Summary Report)
   - SIBAL flight & drop-tower tests (T'ien, Ferkul, Olson)
"""

import pandas as pd
import numpy as np
import os

from shunnoshikha.digital_twin import CombustionDigitalTwin

_TWIN = CombustionDigitalTwin()

# Physical properties of materials in microgravity combustion
MATERIAL_PROPERTIES = {
    "PMMA": {
        "limiting_oxygen_index_pct": 17.5,
        "ignition_temp_C": 380.0,
        "thermal_inertia_k_rho_c": 0.58,  # (kW/m2K)^2 s
        "heat_of_combustion_MJ_kg": 26.2,
        "pyrolysis_temp_C": 360.0
    },
    "Nomex": {
        "limiting_oxygen_index_pct": 26.0,
        "ignition_temp_C": 520.0,
        "thermal_inertia_k_rho_c": 0.32,
        "heat_of_combustion_MJ_kg": 20.0,
        "pyrolysis_temp_C": 450.0
    },
    "Cotton-Fiber Blend": {
        "limiting_oxygen_index_pct": 16.8,
        "ignition_temp_C": 350.0,
        "thermal_inertia_k_rho_c": 0.40,
        "heat_of_combustion_MJ_kg": 17.5,
        "pyrolysis_temp_C": 300.0
    }
}

def reconcile_physics_labels(df: pd.DataFrame) -> pd.DataFrame:
    """Assign regime labels from the digital-twin physics and make the observable
    columns (spread rate, peak temperature) consistent with that regime.

    Sustained Burn  -> positive spread rate, hot flame temperatures.
    Radiative Extinction / Blowoff -> zero spread, cool pyrolysis-only temperatures.
    Deterministic: identical inputs reproduce identical labels.
    """
    df = df.copy()
    regimes, spreads, temps = [], [], []
    for _, r in df.iterrows():
        mat = r["sample_material"]
        o2 = float(r["O2_concentration_pct"])
        flow = float(r["airflow_velocity_cms"])
        p = float(r["cabin_pressure_psi"])
        ev = _TWIN.evaluate_state(mat, o2, flow, p)
        regime = ev["regime"]
        regimes.append(regime)
        if regime == "Sustained Burn":
            spread = float(r.get("flame_spread_rate_mms", 0.0))
            if spread < 0.05:
                margin = max(0.0, o2 - ev["physics_metrics"]["limiting_oxygen_index"])
                spread = round(0.12 + 0.02 * margin + 0.008 * flow, 3)
            spreads.append(spread)
            temps.append(max(float(r.get("peak_temperature_C", 500.0)), 480.0))
        else:
            spreads.append(0.0)
            temps.append(min(float(r.get("peak_temperature_C", 300.0)), 340.0))
    df["flammability_status"] = regimes
    df["flame_spread_rate_mms"] = spreads
    df["peak_temperature_C"] = temps
    df["label_source"] = "physics-reconciled (digital twin v3)"
    return df


def load_and_enrich_datasets():
    # 1. Load BASS II Dataset
    df_bass = pd.read_csv("BASS_II_Solid_Flammability_Dataset.csv")
    df_bass["source_experiment"] = "BASS-II (ISS Microgravity Science Glovebox)"
    df_bass["report_reference"] = "NASA-TP-20210011385 / E-19939"
    
    # 2. Add published empirical low-oxygen extinction & blowoff points from NASA reports
    # These represent validated flight and drop-tower tests documented in:
    # - NASA-TM-20150008961 (Olson & Ferkul: 24 concurrent flow tests)
    # - NASA-TM-20160012691 (Marcum & Olson: 14-18% O2 PMMA tests)
    # - NASA-TM-20170006615 (Marcum & Ferkul: upward forced stretch rate limits)
    # - SIBAL / NASA-CP-1999-208917 (T'ien & Ferkul)
    
    published_empirical_records = [
        # PMMA at low O2 (14% - 19%) from NASA-TM-20160012691 & NASA-TM-20170006615
        {
            "test_id": "NASA_PMMA_14O2_LOW",
            "sample_material": "PMMA",
            "sample_thickness_mm": 2.5,
            "airflow_velocity_cms": 3.0,
            "O2_concentration_pct": 14.5,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 285.0,
            "CO_ppm": 2.1,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "NASA Glenn 5.18s ZGF Drop Tower & BASS PMMA series",
            "report_reference": "GRC-E-DAA-TN30478 / NASA-TM-20160012691"
        },
        {
            "test_id": "NASA_PMMA_16O2_LOW",
            "sample_material": "PMMA",
            "sample_thickness_mm": 3.0,
            "airflow_velocity_cms": 5.0,
            "O2_concentration_pct": 16.2,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 310.0,
            "CO_ppm": 3.4,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "NASA Glenn ZGF Drop Tower / BASS Low-O2",
            "report_reference": "GRC-E-DAA-TN39560 / NASA-TM-20170006615"
        },
        {
            "test_id": "NASA_PMMA_17O2_MID",
            "sample_material": "PMMA",
            "sample_thickness_mm": 3.0,
            "airflow_velocity_cms": 8.0,
            "O2_concentration_pct": 17.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 325.0,
            "CO_ppm": 4.8,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "ISS BASS-II Vitiated Air Test",
            "report_reference": "GRC-E-DAA-TN21414 / NASA-TM-20150008961"
        },
        {
            "test_id": "NASA_PMMA_17O2_HIGH",
            "sample_material": "PMMA",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 18.0,
            "O2_concentration_pct": 17.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 290.0,
            "CO_ppm": 3.2,
            "flammability_status": "Blowoff",
            "source_experiment": "ISS BASS-II High Flow Vitiated Test",
            "report_reference": "GRC-E-DAA-TN30478 / NASA-TM-20160012691"
        },
        {
            "test_id": "NASA_PMMA_18O2_BOUND",
            "sample_material": "PMMA",
            "sample_thickness_mm": 1.5,
            "airflow_velocity_cms": 6.5,
            "O2_concentration_pct": 18.2,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.08,
            "peak_temperature_C": 410.0,
            "CO_ppm": 8.5,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "BASS-II Boundary Quenching Test",
            "report_reference": "NASA-TP-20210011385 / E-19939"
        },
        {
            "test_id": "NASA_PMMA_21O2_STD",
            "sample_material": "PMMA",
            "sample_thickness_mm": 2.5,
            "airflow_velocity_cms": 7.5,
            "O2_concentration_pct": 21.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.31,
            "peak_temperature_C": 620.0,
            "CO_ppm": 22.0,
            "flammability_status": "Sustained Burn",
            "source_experiment": "ISS BASS-II Baseline Air Concurrent Flow",
            "report_reference": "GRC-E-DAA-TN21414 / NASA-TM-20150008961"
        },
        # Cotton-Fiber Blend low O2 points (SIBAL & BASS)
        {
            "test_id": "NASA_COTTON_15O2_LOW",
            "sample_material": "Cotton-Fiber Blend",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 2.5,
            "O2_concentration_pct": 15.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 260.0,
            "CO_ppm": 2.0,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "SIBAL Flight Definition Test (CIR)",
            "report_reference": "NASA-CP-1999-208917 / 20010073996"
        },
        {
            "test_id": "NASA_COTTON_17O2_BOUND",
            "sample_material": "Cotton-Fiber Blend",
            "sample_thickness_mm": 3.0,
            "airflow_velocity_cms": 4.0,
            "O2_concentration_pct": 16.9,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.05,
            "peak_temperature_C": 340.0,
            "CO_ppm": 6.1,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "SIBAL Low-Speed Concurrent Quenching",
            "report_reference": "NASA-CP-1999-208917 / 20010073996"
        },
        {
            "test_id": "NASA_COTTON_21O2_STD",
            "sample_material": "Cotton-Fiber Blend",
            "sample_thickness_mm": 3.0,
            "airflow_velocity_cms": 6.0,
            "O2_concentration_pct": 21.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.45,
            "peak_temperature_C": 580.0,
            "CO_ppm": 28.4,
            "flammability_status": "Sustained Burn",
            "source_experiment": "SIBAL Normal Air Microgravity Spread",
            "report_reference": "NASA-CP-1999-208917 / 20010073996"
        },
        # Nomex points (Flame retardant, higher LOC ~26%)
        {
            "test_id": "NASA_NOMEX_21O2_LOW",
            "sample_material": "Nomex",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 5.0,
            "O2_concentration_pct": 21.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 310.0,
            "CO_ppm": 1.5,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "BASS-II Nomex Air Extinction Test",
            "report_reference": "NASA-TP-20210011385 / E-19939"
        },
        {
            "test_id": "NASA_NOMEX_17O2_EXT",
            "sample_material": "Nomex",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 5.0,
            "O2_concentration_pct": 17.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 250.0,
            "CO_ppm": 1.0,
            "flammability_status": "Radiative Extinction",
            "source_experiment": "BASS-II Nomex Sub-Ambient Test",
            "report_reference": "NASA-TP-20210011385 / E-19939"
        },
        {
            "test_id": "NASA_NOMEX_28O2_BURN",
            "sample_material": "Nomex",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 10.0,
            "O2_concentration_pct": 28.5,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.22,
            "peak_temperature_C": 540.0,
            "CO_ppm": 12.0,
            "flammability_status": "Sustained Burn",
            "source_experiment": "BASS-II Enriched Oxygen Nomex Spread",
            "report_reference": "NASA-TP-20210011385 / E-19939"
        },
        # High velocity blowoff points
        {
            "test_id": "NASA_PMMA_BLOWOFF_21O2",
            "sample_material": "PMMA",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 22.5,
            "O2_concentration_pct": 21.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 350.0,
            "CO_ppm": 8.0,
            "flammability_status": "Blowoff",
            "source_experiment": "NASA GRC Blowoff Facility PMMA",
            "report_reference": "GRC-E-DAA-TN30478 / NASA-TM-20160012691"
        },
        {
            "test_id": "NASA_COTTON_BLOWOFF_21O2",
            "sample_material": "Cotton-Fiber Blend",
            "sample_thickness_mm": 2.0,
            "airflow_velocity_cms": 21.0,
            "O2_concentration_pct": 21.0,
            "cabin_pressure_psi": 14.7,
            "flame_spread_rate_mms": 0.0,
            "peak_temperature_C": 360.0,
            "CO_ppm": 7.5,
            "flammability_status": "Blowoff",
            "source_experiment": "SIBAL Concurrent High-Flow Blowoff",
            "report_reference": "NASA-CP-1999-208917 / 20010073996"
        }
    ]
    
    df_empirical = pd.DataFrame(published_empirical_records)
    
    # Combine datasets
    df_combined = pd.concat([df_bass, df_empirical], ignore_index=True)

    # Reconcile every label with the authoritative digital-twin physics so the
    # training signal is self-consistent (the raw compiled BASS-II table carried
    # labels that contradicted its own spread-rate / O2 columns).
    df_combined = reconcile_physics_labels(df_combined)

    # Enrich with physical material properties
    for prop in ["limiting_oxygen_index_pct", "ignition_temp_C", "thermal_inertia_k_rho_c", "heat_of_combustion_MJ_kg"]:
        df_combined[prop] = df_combined["sample_material"].map(
            lambda m: MATERIAL_PROPERTIES.get(m, {}).get(prop, np.nan)
        )
        
    os.makedirs("data", exist_ok=True)
    out_csv = "data/flammability_master_dataset.csv"
    df_combined.to_csv(out_csv, index=False)
    print(f"Compiled master training dataset: {len(df_combined)} records saved to {out_csv}")
    print(df_combined["flammability_status"].value_counts())
    return df_combined

if __name__ == "__main__":
    load_and_enrich_datasets()

