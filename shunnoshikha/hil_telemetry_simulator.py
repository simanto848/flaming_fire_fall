#!/usr/bin/env python3
"""
ShunnoShikha AI - Module 7: Hardware-in-the-Loop (HIL) UNO/ESP32 Sensor Simulator
Emulates real-time IoT cabin telemetry:
- O2 concentration (%)
- Forced ventilation duct airflow velocity (cm/s)
- Cabin ambient pressure (psi)
- Cabin temperature (°C)
- Toxic Carbon Monoxide (CO ppm)
- Smoke obscuration (%/m)

Supports:
- Pre-configured emergency scenarios (Nominal, Smolder, Fan Failure, O2 Surge)
- Arduino UNO / ESP32 C++ firmware generator for Wokwi simulation
- Real-time time-series telemetry generator for WebSocket streaming
"""

import time
import json
import random
import numpy as np
from typing import Dict, List, Any, Generator

HIL_SCENARIOS = {
    "NOMINAL_ISS": {
        "name": "Nominal ISS Flight Atmosphere",
        "description": "Standard sea-level equivalent cabin environment. Forced ventilation active, zero combustion.",
        "base_o2": 21.0,
        "base_flow": 7.5,
        "base_pressure": 14.7,
        "base_temp": 22.4,
        "base_co": 0.4,
        "base_smoke": 0.01,
        "noise_scale": 0.05
    },
    "SLOW_ELECTRICAL_SMOLDER": {
        "name": "Slow Cable Insulation Smolder (Early Fire)",
        "description": "Hidden wire insulation pyrolyzes in stagnant avionics rack. CO ramps rapidly while temperature creeps up.",
        "base_o2": 19.8,
        "base_flow": 3.2,
        "base_pressure": 14.65,
        "base_temp": 34.8,
        "base_co": 38.5,
        "base_smoke": 0.85,
        "noise_scale": 0.12
    },
    "VENTILATION_FAN_FAILURE": {
        "name": "HVAC Ventilation Fan Failure (Quenching Trap)",
        "description": "Cabin duct fan stalls. Convective flow drops to zero, entering microgravity radiative quenching trap.",
        "base_o2": 20.9,
        "base_flow": 0.35,
        "base_pressure": 14.7,
        "base_temp": 23.0,
        "base_co": 1.2,
        "base_smoke": 0.02,
        "noise_scale": 0.04
    },
    "EXPLORATION_O2_SURGE": {
        "name": "Artemis Lunar Habitat Pre-Breathe Surge",
        "description": "High-oxygen / low-pressure exploration atmosphere. Flammability envelope expands dramatically.",
        "base_o2": 34.0,
        "base_flow": 5.8,
        "base_pressure": 8.2,
        "base_temp": 21.8,
        "base_co": 0.2,
        "base_smoke": 0.01,
        "noise_scale": 0.06
    }
}

class HILSensorSimulator:
    """Hardware-in-the-Loop virtual IoT sensor hub for spacecraft telemetry."""
    
    def __init__(self, device_id: str = "ESP32-HABITAT-NODE-01"):
        self.device_id = device_id
        self.current_scenario = "NOMINAL_ISS"
        self.tick_counter = 0

    def set_scenario(self, scenario_key: str):
        """Switches active simulated cabin event."""
        if scenario_key in HIL_SCENARIOS:
            self.current_scenario = scenario_key
            self.tick_counter = 0

    def generate_telemetry_packet(self) -> Dict[str, Any]:
        """Generates a single real-time sensor reading packet with sensor noise."""
        cfg = HIL_SCENARIOS[self.current_scenario]
        noise = cfg["noise_scale"]
        self.tick_counter += 1
        
        # Add dynamic trends for smolder
        drift_co = 0.0
        drift_o2 = 0.0
        if self.current_scenario == "SLOW_ELECTRICAL_SMOLDER":
            drift_co = min(60.0, self.tick_counter * 0.8)
            drift_o2 = -min(2.5, self.tick_counter * 0.04)

        o2 = round(float(cfg["base_o2"] + drift_o2 + np.random.normal(0, noise * 0.8)), 2)
        flow = round(float(max(0.05, cfg["base_flow"] + np.random.normal(0, noise * 0.5))), 2)
        pressure = round(float(cfg["base_pressure"] + np.random.normal(0, noise * 0.08)), 2)
        temp = round(float(cfg["base_temp"] + (drift_co * 0.2) + np.random.normal(0, noise * 0.6)), 1)
        co = round(float(max(0.0, cfg["base_co"] + drift_co + np.random.normal(0, noise * 1.5))), 1)
        smoke = round(float(max(0.0, cfg["base_smoke"] + (drift_co * 0.02) + np.random.normal(0, noise * 0.05))), 3)

        return {
            "device_id": self.device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "scenario": self.current_scenario,
            "scenario_name": cfg["name"],
            "telemetry": {
                "o2_concentration_pct": o2,
                "airflow_velocity_cms": flow,
                "cabin_pressure_psi": pressure,
                "cabin_temp_C": temp,
                "co_ppm": co,
                "smoke_obscuration_pct_m": smoke
            },
            "sensor_health": {
                "o2_sensor_status": "ONLINE (Electrochemical O2)",
                "flow_sensor_status": "ONLINE (Hot-Wire Anemometer)",
                "pressure_sensor_status": "ONLINE (BME280 Barometer)",
                "co_sensor_status": "ONLINE (NDIR CO Infrared Sensor)",
                "signal_rssi_dbm": -58
            }
        }

    def generate_arduino_cpp_firmware(self) -> str:
        """Returns standard Arduino C++ code for Wokwi ESP32 / Arduino UNO simulation."""
        return """/*
 * ShunnoShikha AI - Virtual Spacecraft Telemetry Node (Wokwi / Hardware-in-the-Loop)
 * Target: ESP32 / Arduino UNO with BME280, NDIR CO, and Hot-Wire Flow Sensors
 * Streams JSON telemetry over Serial / MQTT to ShunnoShikha Mission Control
 */

#include <Arduino.h>

const char* DEVICE_ID = "ESP32-HABITAT-NODE-01";
const int PIN_O2_ANALOG = 34;    // Analog pin for O2 sensor
const int PIN_FLOW_ANALOG = 35;  // Hot-wire anemometer
const int PIN_CO_ANALOG = 32;    // NDIR Carbon Monoxide
const int PIN_ALARM_LED = 2;     // Onboard alarm LED

void setup() {
  Serial.begin(115200);
  pinMode(PIN_ALARM_LED, OUTPUT);
  delay(1000);
  Serial.println("{\\"status\\":\\"ONLINE\\",\\"device\\":\\"ESP32-HABITAT-NODE-01\\"}");
}

void loop() {
  // Read analog voltages and scale to engineering units
  float raw_o2 = analogRead(PIN_O2_ANALOG);
  float raw_flow = analogRead(PIN_FLOW_ANALOG);
  float raw_co = analogRead(PIN_CO_ANALOG);

  float o2_pct = (raw_o2 / 4095.0) * 35.0;        // 0 to 35% O2
  float flow_cms = (raw_flow / 4095.0) * 25.0;     // 0 to 25 cm/s
  float co_ppm = (raw_co / 4095.0) * 200.0;        // 0 to 200 ppm CO
  float cabin_pressure_psi = 14.7;                 // Nominal ISS sea-level
  float cabin_temp_C = 22.5;

  // Format JSON payload
  Serial.print("{\\"device_id\\":\\"");
  Serial.print(DEVICE_ID);
  Serial.print("\\",\\"telemetry\\":{");
  Serial.print("\\"o2_concentration_pct\\":");
  Serial.print(o2_pct, 2);
  Serial.print(",\\"airflow_velocity_cms\\":");
  Serial.print(flow_cms, 2);
  Serial.print(",\\"cabin_pressure_psi\\":");
  Serial.print(cabin_pressure_psi, 2);
  Serial.print(",\\"cabin_temp_C\\":");
  Serial.print(cabin_temp_C, 1);
  Serial.print(",\\"co_ppm\\":");
  Serial.print(co_ppm, 1);
  Serial.println("}}");

  // Local rule-based safety trip
  if (co_ppm > 25.0 || o2_pct > 24.1) {
    digitalWrite(PIN_ALARM_LED, HIGH);
  } else {
    digitalWrite(PIN_ALARM_LED, LOW);
  }

  delay(1000); // 1 Hz telemetry cycle
}
"""

