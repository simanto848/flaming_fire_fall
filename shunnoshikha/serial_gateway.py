#!/usr/bin/env python3
"""Read-only USB serial telemetry bridge; no serial commands or actuator control."""

import argparse
import http.client
import ipaddress
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_LINE_BYTES = 32 * 1024
READ_SIZE = 4096
PSI_TO_KPA = 6.894757293
BOARDS = ("Arduino Uno", "ESP32")
UNITS = {
    "o2_pct": "%",
    "co_ppm": "ppm",
    "co2_ppm": "ppm",
    "temp_C": "°C",
    "humidity_pct": "%",
    "smoke_mgm3": "mg/m³",
    "pressure_kpa": "kPa",
    "airflow_cms": "cm/s",
}
# ASCII spellings denote the same units; no dimension-changing conversions.
UNIT_ALIASES = {"C": "°C", "mg/m3": "mg/m³"}
STATUSES = {"normal", "warning", "critical", "missing", "disconnected", "uncalibrated"}
UNAVAILABLE = {"missing", "disconnected", "uncalibrated"}
LEGACY_CHANNELS = {
    "o2_concentration_pct": ("o2_pct", "%"),
    "airflow_velocity_cms": ("airflow_cms", "cm/s"),
    "cabin_pressure_psi": ("pressure_kpa", "psi"),
    "cabin_temp_C": ("temp_C", "°C"),
    "co_ppm": ("co_ppm", "ppm"),
    "smoke_obscuration_pct_m": ("smoke_mgm3", "%/m"),
}


class InvalidPacket(ValueError):
    """A frame cannot safely represent sensor measurements."""


class GatewayHTTPError(Exception):
    """A local request failed; deliberately contains no response or token text."""


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidPacket("Sensor values must be finite numbers or unavailable nulls.")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise InvalidPacket("Non-finite number rejected.")
    return value


def _json_float(text):
    return _number(float(text))


def _json_int(text):
    return _number(int(text))


def _reject_constant(_text):
    raise InvalidPacket("Non-finite JSON number rejected.")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidPacket("Duplicate JSON key rejected.")
        result[key] = value
    return result


def _sensor(value, key, input_unit=None):
    expected = UNITS[key]
    input_unit = input_unit or expected
    if isinstance(value, dict):
        if "value" not in value:
            raise InvalidPacket("Sensor objects require a value, which may be null.")
        reading = value["value"]
        status = value.get("status", "missing" if reading is None else "normal")
        unit = value.get("unit", input_unit)
        if not isinstance(status, str) or status not in STATUSES:
            raise InvalidPacket("Unknown sensor status.")
        if not isinstance(unit, str):
            raise InvalidPacket("Sensor unit must be a string.")
        if "raw_adc" in value:
            raw = value["raw_adc"]
            _number(raw)
            if not isinstance(raw, int) or raw < 0:
                raise InvalidPacket("raw_adc must be a nonnegative integer.")
    else:
        reading, status, unit = _number(value), "normal", input_unit
    if reading is not None:
        _number(reading)
    elif status not in UNAVAILABLE:
        raise InvalidPacket("Null values require an unavailable status.")
    unit = UNIT_ALIASES.get(unit, unit)
    if status in UNAVAILABLE:
        reading = None
    if input_unit == "%/m":
        # A legacy optical channel is never a mass measurement, even if mislabeled.
        reading, status = None, "missing"
    elif key == "pressure_kpa" and input_unit == "psi" and unit == "psi":
        if reading is not None:
            reading = _number(reading * PSI_TO_KPA)
    elif unit != expected:
        reading, status = None, "missing"
    return {"value": reading, "unit": expected, "status": status}


def normalize_packet(packet):
    """Normalize canonical envelopes/bare maps or the existing ESP32 telemetry map.

    Only present channels are emitted. Raw ADCs and device timestamps are never
    promoted to measurements, and missing channels receive no default readings.
    """
    if not isinstance(packet, dict):
        raise InvalidPacket("JSON frame must be an object.")
    if "sensors" in packet and "telemetry" in packet:
        raise InvalidPacket("Ambiguous sensor envelope.")
    legacy = "telemetry" in packet
    channels = packet.get("telemetry" if legacy else "sensors", packet)
    if not isinstance(channels, dict):
        raise InvalidPacket("Sensor channels must be an object.")
    result = {}
    for key in UNITS:
        if key in channels:
            result[key] = _sensor(channels[key], key)
    if legacy:
        for old_key, (key, unit) in LEGACY_CHANNELS.items():
            if old_key not in channels or old_key == key:
                continue
            if key in result:
                raise InvalidPacket("Duplicate canonical and legacy channel.")
            result[key] = _sensor(channels[old_key], key, unit)
    if not result:
        raise InvalidPacket("No supported sensor channels in frame.")
    return result


def decode_line(line):
    if len(line) > MAX_LINE_BYTES:
        raise InvalidPacket("Serial frame exceeds 32 KiB.")
    try:
        packet = json.loads(
            line.decode("utf-8"), parse_constant=_reject_constant,
            parse_float=_json_float, parse_int=_json_int,
            object_pairs_hook=_unique_object,
        )
        return normalize_packet(packet)
    except (ValueError, UnicodeError, RecursionError, OverflowError) as exc:
        raise InvalidPacket("Invalid serial JSON frame.") from exc


class LineFramer:
    """Bound memory, preserve partial reads, discard oversized frames up to LF.

    None signals one oversized frame; empty lines are ignored. The limit counts
    bytes before LF (including CR when a sender uses CRLF).
    """

    def __init__(self):
        self.buffer = bytearray()
        self.discarding = False

    def feed(self, chunk):
        start = 0
        while start < len(chunk):
            end = chunk.find(b"\n", start)
            stop = len(chunk) if end < 0 else end
            if not self.discarding:
                if len(self.buffer) + stop - start > MAX_LINE_BYTES:
                    self.buffer.clear()
                    self.discarding = True
                    yield None
                else:
                    self.buffer.extend(chunk[start:stop])
            if end < 0:
                break
            if not self.discarding:
                line = bytes(self.buffer)
                self.buffer.clear()
                if line.strip():
                    yield line
            self.discarding = False
            start = end + 1


def validate_api_url(value):
    """Accept only an HTTP loopback origin, without credentials or URL extras."""
    error = ValueError("--api-url must be an http:// loopback origin with a valid port.")
    try:
        if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value):
            raise error
        parsed = urllib.parse.urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme != "http" or not host or parsed.username is not None
                or parsed.password is not None or parsed.path not in ("", "/")
                or "?" in value or "#" in value or "%" in parsed.netloc
                or parsed.netloc.endswith(":")):
            raise error
        port = parsed.port if parsed.port is not None else 80
        if not 1 <= port <= 65535:
            raise error
        if host == "localhost":
            host = "127.0.0.1"  # No DNS lookup, even for localhost.
        elif not ipaddress.ip_address(host).is_loopback:
            raise error
        host = f"[{host}]" if ":" in host else host
        return f"http://{host}:{port}"
    except (ValueError, TypeError):
        raise error from None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LocalAPIClient:
    """Synchronous, proxy-free, redirect-free HTTP; response bodies are ignored."""

    def __init__(self, api_url="http://127.0.0.1:8000", token=None, timeout=5.0):
        self.api_url = validate_api_url(api_url)
        if token and (not token.isascii() or any(ord(c) < 32 or ord(c) == 127 for c in token)):
            raise ValueError("SHUNNO_GATEWAY_TOKEN must contain printable ASCII only.")
        self._token = token
        self.timeout = timeout
        self._opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect(),
        )

    def post(self, path, payload):
        if path not in ("/api/sensors/ingest", "/api/sensors/gateway-error"):
            raise ValueError("Unsupported local API endpoint.")
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ShunnoShikha-Serial-Gateway/1.0",
        }
        if self._token:
            headers["X-Gateway-Token"] = self._token
        request = urllib.request.Request(
            self.api_url + path,
            data=json.dumps(payload, allow_nan=False).encode("utf-8"),
            headers=headers, method="POST",
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                if not 200 <= response.status < 300:
                    raise GatewayHTTPError("Local API returned an unsuccessful status.")
        except urllib.error.HTTPError as exc:
            exc.close()
            raise GatewayHTTPError("Local API request failed.") from None
        except (OSError, http.client.HTTPException, ValueError):
            raise GatewayHTTPError("Local API request failed.") from None


class Backoff:
    def __init__(self):
        self.reset()

    def reset(self):
        self.delay = 1.0

    def next_delay(self):
        delay = self.delay
        self.delay = min(30.0, self.delay * 2)
        return delay


def load_pyserial():
    """Import only for serial operation, so --help and parsing need no dependency."""
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        raise RuntimeError("USB serial support requires pyserial: pip install pyserial") from None
    if not hasattr(serial, "Serial") or not hasattr(list_ports, "comports"):
        raise RuntimeError("USB serial support requires pyserial: pip install pyserial")
    return serial, list_ports.comports


def _valid_device_id(value):
    if not value or len(value) > 128 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("--device-id must be 1–128 characters without control characters.")
    return value


class Gateway:
    """Single ordered stream. Failed posts consume a sequence and are not replayed.

    HTTP timeouts can occur after server acceptance; not retrying avoids duplicate
    ingestion. Sequence numbers start at 1 per gateway instance, not per port open.
    """

    def __init__(self, port, board, device_id, client, serial_module, enumerate_ports,
                 sleep=time.sleep, clock=time.monotonic, stderr=None):
        if board not in BOARDS:
            raise ValueError("Unsupported board.")
        self.port = port
        self.board = board
        self.device_id = _valid_device_id(device_id)
        self.client = client
        self.serial_module = serial_module
        self.enumerate_ports = enumerate_ports
        self.sleep = sleep
        self.clock = clock
        self.stderr = sys.stderr if stderr is None else stderr
        self.sequence = 0
        self._last_error = {}
        self._http_backoff = Backoff()

    def _error(self, message):
        # Fixed messages only: never echo serial data, URLs, tokens or exceptions.
        now = self.clock()
        if now - self._last_error.get(message, -math.inf) < 30.0:
            return
        self._last_error[message] = now
        print(message, file=self.stderr)
        try:
            self.client.post("/api/sensors/gateway-error", {
                "message": message, "board": self.board, "device_id": self.device_id,
            })
        except GatewayHTTPError:
            pass  # Reporting failure must never recursively report itself.

    def process_line(self, line):
        try:
            sensors = decode_line(line)
        except InvalidPacket:
            self._error("Invalid serial frame discarded (JSON, value, status or unit).")
            return
        self.sequence += 1
        payload = {
            "board": self.board, "device_id": self.device_id, "source": "serial",
            "sensors": sensors, "sequence": self.sequence,
        }
        try:
            self.client.post("/api/sensors/ingest", payload)
        except GatewayHTTPError:
            self._error("Local API ingest failed; frame not replayed; backing off.")
            self.sleep(self._http_backoff.next_delay())
        else:
            self._http_backoff.reset()

    def run(self, baud=115200):
        reconnect = Backoff()
        connection = None
        try:
            while True:
                try:
                    # Re-enumerate on EVERY open. Never open an unlisted path or
                    # fall back to another board when this selected port vanishes.
                    devices = {item.device for item in self.enumerate_ports()}
                    if self.port not in devices:
                        self._error("Selected serial port absent; waiting for the same port.")
                        self.sleep(reconnect.next_delay())
                        continue
                    connection = self.serial_module.Serial(
                        port=self.port, baudrate=baud, timeout=1.0,
                        xonxoff=False, rtscts=False, dsrdtr=False,
                    )
                    framer = LineFramer()  # Never join fragments across a disconnect.
                    while True:
                        chunk = connection.read(READ_SIZE)
                        if not chunk:  # A serial timeout, not necessarily a disconnect.
                            continue
                        reconnect.reset()
                        for line in framer.feed(chunk):
                            if line is None:
                                self._error("Serial frame exceeds 32 KiB; discarded through newline.")
                            else:
                                self.process_line(line)
                except (OSError, self.serial_module.SerialException):
                    self._error("Serial connection lost or unavailable; re-enumerating selected port.")
                finally:
                    if connection is not None:
                        try:
                            connection.close()
                        except (OSError, self.serial_module.SerialException):
                            pass
                        connection = None
                self.sleep(reconnect.next_delay())
        except KeyboardInterrupt:
            return 0


def build_parser():
    parser = argparse.ArgumentParser(
        description="Read-only USB serial JSON to a local HTTP API; no device commands.",
        epilog=(
            "Reference Uno mapping (screenshot unavailable): A0 oxygen, A1 CO, A2 smoke, "
            "A3 airflow; D2 temperature/humidity; I2C A4/A5 pressure and CO2. "
            "Select actual sensor models, safe voltage interfaces, datasheet drivers and "
            "calibration before engineering-unit measurements; raw ADC is not ppm. "
            "The reference sketch only emits uncalibrated ADC channels. Legacy pins "
            "34/35/32 are ESP32, not Uno. Pump/relay control is disabled; opening USB "
            "serial may reset a board. Optional SHUNNO_GATEWAY_TOKEN is sent only as "
            "X-Gateway-Token to the loopback API. Failed posts are not replayed."
        ),
    )
    parser.add_argument("--list", action="store_true", help="List actual enumerated serial ports and exit.")
    parser.add_argument("--port", help="Exact device from --list (required unless --list).")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate (default: 115200).")
    parser.add_argument("--board", choices=BOARDS, default="Arduino Uno")
    parser.add_argument("--device-id", default="serial-node-01", help="Stable ID for this gateway (default: serial-node-01).")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000", help="HTTP loopback origin only (default: http://127.0.0.1:8000).")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.list and not args.port:
        parser.error("--port is required; use --list to enumerate actual USB serial ports.")
    if args.baud <= 0:
        parser.error("--baud must be a positive integer.")
    try:
        client = LocalAPIClient(args.api_url, token=os.environ.get("SHUNNO_GATEWAY_TOKEN"))
        _valid_device_id(args.device_id)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        serial_module, enumerate_ports = load_pyserial()
        devices = list(enumerate_ports())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except OSError:
        print("Unable to enumerate serial ports; check USB serial permissions.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 0
    if args.list:
        for item in devices:
            print(f"{item.device}\t{item.description}")
        if not devices:
            print("No serial ports found. Connect the board and run --list again.")
        return 0
    if args.port not in {item.device for item in devices}:
        parser.error("Selected port is not enumerated; use --list. No device was opened.")
    gateway = Gateway(args.port, args.board, args.device_id, client, serial_module, enumerate_ports)
    return gateway.run(args.baud)


if __name__ == "__main__":
    raise SystemExit(main())
