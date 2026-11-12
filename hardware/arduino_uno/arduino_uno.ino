#include <Arduino.h>

// Reference Uno mapping only: screenshot unavailable; legacy pins 34/35/32 are ESP32, not Uno.
const uint8_t PIN_OXYGEN = A0;
const uint8_t PIN_CO = A1;
const uint8_t PIN_SMOKE = A2;
const uint8_t PIN_AIRFLOW = A3;
// D2: temperature/humidity reserved; needs a chosen sensor and its datasheet driver.
// I2C A4 (SDA)/A5 (SCL): pressure and CO2 reserved; needs chosen sensors, addresses and drivers.
// Verify supply levels, safe Uno ADC input voltages, common ground and signal conditioning first.
// No calibration yet: %, ppm, mg/m3 and cm/s below are target labels, NOT measured values.
// Floating ADC inputs do not prove a sensor is present; only raw ADC samples are reported.
// Outputs disabled: no pumps, relays, alarms, GPIO writes, I2C transactions or command handling.

void printRawSensor(const __FlashStringHelper* key,
                    const __FlashStringHelper* targetUnit, uint8_t pin) {
  const int raw = analogRead(pin);
  Serial.print('"');
  Serial.print(key);
  Serial.print(F("\":{\"value\":null,\"unit\":\""));
  Serial.print(targetUnit);
  Serial.print(F("\",\"status\":\"uncalibrated\",\"raw_adc\":"));
  Serial.print(raw);
  Serial.print('}');
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  // Sensor-specific calibration is required; optical smoke %/m cannot become mass mg/m3.
  Serial.print(F("{\"sensors\":{"));
  printRawSensor(F("o2_pct"), F("%"), PIN_OXYGEN);
  Serial.print(',');
  printRawSensor(F("co_ppm"), F("ppm"), PIN_CO);
  Serial.print(',');
  printRawSensor(F("smoke_mgm3"), F("mg/m3"), PIN_SMOKE);
  Serial.print(',');
  printRawSensor(F("airflow_cms"), F("cm/s"), PIN_AIRFLOW);
  Serial.println(F("}}"));
  // D2 and I2C channels are omitted: no sensor model/driver/measurement has been provided.
  delay(1000);
}
