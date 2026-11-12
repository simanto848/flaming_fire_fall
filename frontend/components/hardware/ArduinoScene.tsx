"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Props = { snapshot: any; selected: string; onSelect: (id: string) => void; heightClass?: string };
type ChannelStatus = "normal" | "warning" | "critical" | "missing" | "stale" | "disconnected" | "uncalibrated";
type SensorKey = "o2_pct" | "co_ppm" | "co2_ppm" | "temp_C" | "humidity_pct" | "smoke_mgm3" | "pressure_kpa" | "airflow_cms";
type SensorDefinition = { key: SensorKey; name: string; unit: string; pins: string[]; module: number };

const SENSORS: SensorDefinition[] = [
  { key: "o2_pct", name: "Oxygen", unit: "%", pins: ["A0"], module: 0 },
  { key: "co_ppm", name: "Carbon monoxide", unit: "ppm", pins: ["A1"], module: 1 },
  { key: "smoke_mgm3", name: "Smoke", unit: "mg/m³", pins: ["A2"], module: 2 },
  { key: "airflow_cms", name: "Airflow", unit: "cm/s", pins: ["A3"], module: 3 },
  { key: "temp_C", name: "Temperature", unit: "°C", pins: ["D2"], module: 4 },
  { key: "humidity_pct", name: "Humidity", unit: "%", pins: ["D2"], module: 4 },
  { key: "co2_ppm", name: "Carbon dioxide", unit: "ppm", pins: ["A4", "A5"], module: 5 },
  { key: "pressure_kpa", name: "Pressure", unit: "kPa", pins: ["A4", "A5"], module: 6 },
];
const MODULES = [
  { x: -5.5, z: -3.9, name: "O2 / A0", kind: "gas" },
  { x: -2.4, z: -5.2, name: "CO / A1", kind: "gas" },
  { x: 1, z: -5.3, name: "SMOKE / A2", kind: "gas" },
  { x: 4.7, z: -4.1, name: "FLOW / A3", kind: "flow" },
  { x: 5.6, z: 0.1, name: "TEMP + RH / D2", kind: "dht" },
  { x: 4.3, z: 4.3, name: "CO2 / I2C", kind: "co2" },
  { x: 0.2, z: 5.2, name: "PRESS / I2C", kind: "pressure" },
];
const COLORS: Record<ChannelStatus, string> = {
  normal: "#22d3ee", warning: "#fbbf24", critical: "#f87171",
  missing: "#64748b", stale: "#a78bfa", disconnected: "#475569", uncalibrated: "#fb923c",
};
const STATUS_ORDER: ChannelStatus[] = ["critical", "disconnected", "missing", "stale", "uncalibrated", "warning", "normal"];
const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** No value or traffic is fabricated. A live link must also have a recent receipt. */
function channel(snapshot: any, key: SensorKey, now: number) {
  const reading = snapshot?.sensors?.[key];
  const value: number | null = typeof reading?.value === "number" && Number.isFinite(reading.value) ? reading.value : null;
  let status: ChannelStatus = STATUS_ORDER.includes(reading?.status) ? reading.status : "missing";
  if (snapshot?.mode !== "simulation" && !snapshot?.hardware?.connected) status = "disconnected";
  else if (value === null && ["normal", "warning", "critical"].includes(status)) status = "missing";
  else if (snapshot?.mode !== "simulation" && ["normal", "warning", "critical"].includes(status)) {
    const raw = snapshot?.hardware?.last_received_at;
    const received = typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : typeof raw === "string" ? Date.parse(raw) : NaN;
    const hz = Number(snapshot?.hardware?.frequency_hz);
    const maxAge = Math.max(3000, Math.min(15000, 3000 / (Number.isFinite(hz) && hz > 0 ? hz : 1)));
    if (!Number.isFinite(received) || now - received > maxAge || received - now > 1000) status = "stale";
  }
  return { value, status, valid: value !== null && ["normal", "warning", "critical"].includes(status) };
}

export default function ArduinoScene({ snapshot, selected, onSelect, heightClass = "h-[520px] min-h-[440px] sm:h-[560px]" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<Partial<Record<SensorKey, HTMLButtonElement | null>>>({});
  const latest = useRef({ snapshot, selected, onSelect });
  latest.current = { snapshot, selected, onSelect };
  const actions = useRef<{ reset: () => void; zoom: (factor: number) => void } | null>(null);
  const autoOrbitRef = useRef(false);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [availability, setAvailability] = useState<"loading" | "ready" | "lost" | "failed">("loading");
  const [inspection, setInspection] = useState("Select a sensor, wire, pin, or board component to inspect.");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let raf = 0;
    let disposed = false;
    let contextLost = false;
    let width = 1;
    let height = 1;
    let previousTime = 0;
    let lastStatusTick = 0;
    let lastLabelTime = 0;
    let pointerStart: { x: number; y: number; id: number; moved: boolean } | null = null;
    const activePointers = new Set<number>();
    const cleanupListeners: (() => void)[] = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const pickables: THREE.Object3D[] = [];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#05070f");
    scene.fog = new THREE.FogExp2("#05070f", 0.016);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const projected = new THREE.Vector3();
    const scratch = new THREE.Vector3();
    const color = new THREE.Color();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const trackGeometry = <T extends THREE.BufferGeometry,>(geometry: T): T => { geometries.add(geometry); return geometry; };
    const trackMaterial = <T extends THREE.Material,>(material: T): T => { materials.add(material); return material; };
    const standard = (value: string, metalness = 0, roughness = 0.65) => trackMaterial(new THREE.MeshStandardMaterial({ color: value, metalness, roughness }));
    const boxGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const cylinderGeometry = trackGeometry(new THREE.CylinderGeometry(1, 1, 1, 24));
    const sphereGeometry = trackGeometry(new THREE.SphereGeometry(1, 10, 8));
    const planeGeometry = trackGeometry(new THREE.PlaneGeometry(1, 1));
    const black = standard("#10151b", 0.15);
    const socketBlack = standard("#010306");
    const metal = standard("#a7b8c4", 0.85, 0.28);
    const gold = standard("#c6a253", 0.75, 0.34);
    const white = standard("#bed3d5", 0.15);
    const teal = standard("#087c79", 0.25, 0.5);
    const darkTeal = standard("#075453", 0.2);
    const blue = standard("#147e9f", 0.2);
    const red = standard("#53272d");
    type PickInfo = { keys?: SensorKey[]; text: string };
    const tag = (object: THREE.Object3D, info: PickInfo) => { object.userData.inspection = info; pickables.push(object); };
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z);
      object.castShadow = true;
      object.receiveShadow = true;
      parent.add(object);
      return object;
    };
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, parent: THREE.Object3D = scene) => {
      const object = mesh(boxGeometry, material, x, y, z, parent);
      object.scale.set(sx, sy, sz);
      return object;
    };
    const cylinder = (x: number, y: number, z: number, radius: number, h: number, material: THREE.Material, parent: THREE.Object3D = scene) => {
      const object = mesh(cylinderGeometry, material, x, y, z, parent);
      object.scale.set(radius, h, radius);
      return object;
    };
    // All silkscreen is drawn locally; no network textures, fonts, or model assets.
    const silk = (text: string, x: number, y: number, z: number, sx: number, sz: number, parent: THREE.Object3D = scene, ink = "#d4f3e9", background?: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 160); }
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = text.split("\n");
      ctx.font = `bold ${lines.length > 1 ? 40 : 58}px monospace`;
      lines.forEach((line, i) => ctx.fillText(line, 256, (i + 0.5) * 160 / lines.length, 490));
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() ?? 1);
      textures.add(texture);
      const material = trackMaterial(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
      const object = mesh(planeGeometry, material, x, y, z, parent);
      object.rotation.x = -Math.PI / 2;
      object.scale.set(sx, sz, 1);
      object.castShadow = false;
      return object;
    };
    const dispose = () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      cleanupListeners.forEach((remove) => remove());
      controls?.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      scene.clear();
      if (renderer) {
        renderer.renderLists.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      actions.current = null;
    };

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      const gl = renderer;
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      gl.outputColorSpace = THREE.SRGBColorSpace;
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = 1.25;
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px;";
      gl.domElement.tabIndex = 0;
      gl.domElement.setAttribute("aria-label", "Interactive 3D Arduino reference. Arrow keys rotate; Shift and arrows pan; plus and minus zoom; Home resets. Tab to sensor reading buttons to select.");
      host.prepend(gl.domElement);
      controls = new OrbitControls(camera, gl.domElement);
      const orbit = controls;
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.08;
      orbit.minDistance = 7;
      orbit.maxDistance = 48;
      orbit.minPolarAngle = 0.14;
      orbit.maxPolarAngle = Math.PI / 2 - 0.06;
      orbit.enablePan = true;
      orbit.screenSpacePanning = true;
      orbit.autoRotateSpeed = 0.35;
      orbit.touches.ONE = THREE.TOUCH.ROTATE;
      orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
      const resetCamera = () => {
        // reset() also clears accumulated pan/rotation damping.
        orbit.reset();
        orbit.target.set(0, 0.2, 0);
        const distance = Math.max(23, 19 / Math.max(camera.aspect, 0.45));
        camera.position.set(0.33, 1, 1.04).normalize().multiplyScalar(distance).add(orbit.target);
        orbit.update();
        orbit.saveState();
      };
      const zoom = (factor: number) => {
        scratch.copy(camera.position).sub(orbit.target);
        scratch.setLength(THREE.MathUtils.clamp(scratch.length() * factor, orbit.minDistance, orbit.maxDistance));
        camera.position.copy(orbit.target).add(scratch);
        orbit.update();
      };
      actions.current = { reset: resetCamera, zoom };
      const resize = () => {
        width = Math.max(1, host.clientWidth);
        height = Math.max(1, host.clientHeight);
        const oldAspect = camera.aspect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        gl.setSize(width, height, false);
        if (Math.abs(oldAspect - camera.aspect) > 0.8) resetCamera();
      };
      observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      resetCamera();

      const hemi = new THREE.HemisphereLight("#c7eaff", "#12252c", 2.5);
      scene.add(hemi);
      const keyLight = new THREE.DirectionalLight("#e4f6ff", 4.5);
      keyLight.position.set(-5, 12, 7);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -10;
      keyLight.shadow.camera.right = 10;
      keyLight.shadow.camera.top = 10;
      keyLight.shadow.camera.bottom = -10;
      keyLight.shadow.normalBias = 0.035;
      scene.add(keyLight);
      const rim = new THREE.DirectionalLight("#22d3ee", 2);
      rim.position.set(5, 5, -8);
      scene.add(rim);
      const warm = new THREE.PointLight("#f59e0b", 18, 20, 2);
      warm.position.set(-6, 4, 2);
      scene.add(warm);
      const floorMaterial = trackMaterial(new THREE.MeshStandardMaterial({ color: "#080d17", metalness: 0.1, roughness: 0.95 }));
      const floor = mesh(trackGeometry(new THREE.PlaneGeometry(90, 90)), floorMaterial, 0, -0.21, 0);
      floor.rotation.x = -Math.PI / 2;
      floor.castShadow = false;
      const grid = new THREE.GridHelper(44, 44, "#163440", "#101e2c");
      grid.position.y = -0.2;
      scene.add(grid);
      geometries.add(grid.geometry);
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => materials.add(material));

      // Extruded PCB with genuine cut-through mounting holes.
      const pcb = new THREE.Shape();
      pcb.moveTo(-3.45, -2.65);
      pcb.lineTo(2.9, -2.65);
      pcb.lineTo(3.45, -2.1);
      pcb.lineTo(3.45, 2.1);
      pcb.lineTo(2.9, 2.65);
      pcb.lineTo(-3.45, 2.65);
      pcb.closePath();
      const mounts = [[-3.02, -1.9], [2.96, -1.84], [-3.02, 1.94], [2.96, 1.94]];
      mounts.forEach(([x, z]) => {
        const hole = new THREE.Path();
        hole.absarc(x, -z, 0.16, 0, Math.PI * 2, false);
        pcb.holes.push(hole);
      });
      const board = mesh(trackGeometry(new THREE.ExtrudeGeometry(pcb, { depth: 0.18, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.015, bevelSegments: 1, steps: 1 })), teal, 0, 0.24, 0);
      board.rotation.x = -Math.PI / 2;
      tag(board, { text: "Uno reference PCB · illustrative pin map only. Not real calibrated hardware. No actuation commands are sent." });
      const mountRing = trackGeometry(new THREE.RingGeometry(0.16, 0.26, 24));
      mounts.forEach(([x, z]) => {
        const ring = mesh(mountRing, gold, x, 0.445, z);
        ring.rotation.x = -Math.PI / 2;
        const standoff = mesh(trackGeometry(new THREE.TorusGeometry(0.21, 0.06, 8, 16)), metal, x, 0.1, z);
        standoff.rotation.x = Math.PI / 2;
      });
      silk("UNO", 0.25, 0.448, -0.7, 1.5, 0.63);
      silk("ARDUINO / REFERENCE", 0, 0.449, -1.32, 2.65, 0.3);
      silk("NOT CALIBRATED", 0.1, 0.449, 1.64, 2.2, 0.25);
      silk("DIGITAL (PWM ~)", 0.7, 0.449, -1.88, 2.9, 0.19);
      silk("POWER", -1.5, 0.449, 1.89, 1.35, 0.19);
      silk("ANALOG IN", 1.86, 0.449, 1.87, 1.85, 0.19);
      // Thin copper/solder-mask traces beneath the components.
      for (let i = 0; i < 9; i++) {
        const points = [new THREE.Vector3(-1.8 + i * 0.34, 0.444, -2), new THREE.Vector3(-1.8 + i * 0.34, 0.444, -1.6), new THREE.Vector3(-1.45 + i * 0.34, 0.444, -1.25)];
        const line = new THREE.Line(trackGeometry(new THREE.BufferGeometry().setFromPoints(points)), trackMaterial(new THREE.LineBasicMaterial({ color: "#249a87", transparent: true, opacity: 0.55 })));
        scene.add(line);
      }
      const chip = new THREE.Group();
      scene.add(chip);
      box(0.1, 0.74, 0.68, 3.6, 0.43, 0.72, black, chip);
      for (let i = 0; i < 14; i++) {
        for (const side of [-1, 1]) {
          box(-1.55 + i * 0.255, 0.64, 0.68 + side * 0.46, 0.1, 0.12, 0.28, metal, chip);
          box(-1.55 + i * 0.255, 0.52, 0.68 + side * 0.56, 0.1, 0.24, 0.075, metal, chip);
          cylinder(-1.55 + i * 0.255, 0.449, 0.68 + side * 0.56, 0.09, 0.015, gold);
        }
      }
      silk("ATMEGA328P", 0.1, 0.962, 0.68, 2.6, 0.36, chip, "#a8adb4");
      cylinder(-1.44, 0.962, 0.68, 0.085, 0.012, socketBlack, chip);
      tag(chip, { text: "ATmega328P · 28-pin DIP microcontroller, 16 MHz reference. Read-only visual model; not a live firmware connection." });
      const oscillator = box(-1.85, 0.63, -0.25, 0.77, 0.35, 0.34, metal);
      silk("16.000", -1.85, 0.815, -0.25, 0.68, 0.23);
      tag(oscillator, { text: "16 MHz quartz oscillator · reference clock for the ATmega328P." });
      const usb = new THREE.Group();
      usb.position.set(-3.1, 0.88, -0.82);
      scene.add(usb);
      box(0, 0, 0, 1.38, 0.71, 1.14, socketBlack, usb);
      box(0, 0.4, 0, 1.5, 0.1, 1.35, metal, usb);
      box(0, -0.38, 0, 1.5, 0.1, 1.35, metal, usb);
      box(0, 0, -0.62, 1.5, 0.7, 0.1, metal, usb);
      box(0, 0, 0.62, 1.5, 0.7, 0.1, metal, usb);
      box(-0.76, -0.04, 0, 0.035, 0.26, 0.58, white, usb);
      for (const z of [-0.18, 0.18]) box(-0.785, 0.08, z, 0.04, 0.055, 0.1, gold, usb);
      silk("USB", 0.03, 0.46, 0, 0.8, 0.4, usb, "#34414e");
      tag(usb, { text: "USB Type-B metal housing · host serial/power reference. Connection state comes from telemetry, not this 3D model." });
      const jack = new THREE.Group();
      scene.add(jack);
      box(-3.12, 0.83, 1.05, 1.22, 0.8, 0.92, black, jack);
      const jackMouth = cylinder(-3.75, 0.84, 1.05, 0.34, 0.12, socketBlack, jack);
      jackMouth.rotation.z = Math.PI / 2;
      const jackPin = cylinder(-3.83, 0.84, 1.05, 0.07, 0.16, gold, jack);
      jackPin.rotation.z = Math.PI / 2;
      tag(jack, { text: "Barrel power jack · illustrative external DC input. No power or actuator control is available here." });
      const regulator = new THREE.Group();
      scene.add(regulator);
      box(-2.15, 0.57, 1.14, 0.55, 0.12, 0.67, metal, regulator);
      box(-2.15, 0.68, 1.25, 0.49, 0.18, 0.45, black, regulator);
      for (let i = 0; i < 3; i++) box(-2.32 + i * 0.17, 0.48, 1.63, 0.07, 0.04, 0.28, metal, regulator);
      tag(regulator, { text: "5 V voltage regulator · reference power conditioning. Model is not an electrical simulation." });
      for (const [x, z] of [[-2.15, 0.3], [-2.68, 0.34]]) {
        cylinder(x, 0.72, z, 0.2, 0.55, black);
        cylinder(x, 1, z, 0.185, 0.028, metal);
        box(x, 1.02, z, 0.25, 0.012, 0.025, socketBlack);
        box(x, 1.02, z, 0.025, 0.012, 0.25, socketBlack);
      }
      const usbChip = box(-1.45, 0.55, -1.12, 0.48, 0.2, 0.48, black);
      tag(usbChip, { text: "USB-to-serial interface · reference ATmega16U2 package." });
      for (let i = 0; i < 7; i++) {
        box(0.35 + i * 0.29, 0.485, -1.57, 0.15, 0.06, 0.09, i % 2 ? metal : black);
      }

      // Two real rows of female sockets. Pin coordinates are shared with wire endpoints.
      const pins: Record<string, THREE.Vector3> = {};
      const addPin = (name: string, x: number, z: number) => {
        const group = new THREE.Group();
        scene.add(group);
        // Four walls leave a recessed opening rather than a solid painted top.
        box(x - 0.133, 0.7, z, 0.074, 0.54, 0.34, black, group);
        box(x + 0.133, 0.7, z, 0.074, 0.54, 0.34, black, group);
        box(x, 0.7, z - 0.133, 0.195, 0.54, 0.074, black, group);
        box(x, 0.7, z + 0.133, 0.195, 0.54, 0.074, black, group);
        box(x, 0.68, z, 0.16, 0.05, 0.16, gold, group);
        box(x, 0.71, z, 0.105, 0.012, 0.105, socketBlack, group);
        pins[name] = new THREE.Vector3(x, 0.97, z);
        silk(name.replace("D", ""), x, 0.448, z + (z < 0 ? 0.33 : -0.3), 0.27, 0.18);
        const matching = SENSORS.filter((sensor) => sensor.pins.includes(name)).map((sensor) => sensor.key);
        tag(group, { keys: matching, text: `${name}${name === "A4" ? " / SDA" : name === "A5" ? " / SCL" : ""} · ${matching.length ? matching.join(", ") : "reference header socket"}${name === "D2" ? " · shared temperature / humidity sensor" : ""}` });
      };
      for (let i = 0; i < 14; i++) addPin(`D${i}`, 2.75 - i * 0.34 - (i >= 8 ? 0.12 : 0), -2.32);
      addPin("GND_D", -2.25, -2.32);
      addPin("AREF", -2.59, -2.32);
      for (let i = 0; i < 6; i++) addPin(`A${i}`, 0.97 + i * 0.34, 2.32);
      ["IOREF", "RST", "3V3", "5V", "GND", "GND2", "VIN"].forEach((name, i) => addPin(name, -2.25 + i * 0.34, 2.32));
      const ledMaterial = () => trackMaterial(new THREE.MeshStandardMaterial({ color: "#243847", emissive: "#22d3ee", emissiveIntensity: 0.1, roughness: 0.3 }));
      const powerLed = ledMaterial();
      const rxLed = ledMaterial();
      const txLed = ledMaterial();
      [["ON", 2.62, -1.35, powerLed], ["RX", -0.78, -0.56, rxLed], ["TX", -0.78, -0.24, txLed]].forEach(([name, x, z, material]) => {
        box(x as number, 0.5, z as number, 0.17, 0.12, 0.1, material as THREE.Material);
        silk(name as string, (x as number) + 0.27, 0.448, z as number, 0.3, 0.18);
      });

      type Wire = { keys: SensorKey[]; curve: THREE.CatmullRomCurve3; material: THREE.MeshStandardMaterial; particles: THREE.Mesh[]; output?: boolean };
      const wires: Wire[] = [];
      const particleGeometry = trackGeometry(new THREE.SphereGeometry(0.065, 8, 6));
      const makeWire = (keys: SensorKey[], start: THREE.Vector3, end: THREE.Vector3, lane: number, info: string, output = false, supply?: "power" | "ground") => {
        const lift = 1.1 + (lane % 4) * 0.22;
        const curve = new THREE.CatmullRomCurve3([
          start.clone(), start.clone().add(new THREE.Vector3(0, 0.55, 0)),
          new THREE.Vector3(start.x * 0.7 + end.x * 0.3, lift, start.z * 0.7 + end.z * 0.3),
          new THREE.Vector3(start.x * 0.23 + end.x * 0.77, lift + 0.15, start.z * 0.23 + end.z * 0.77),
          end.clone().add(new THREE.Vector3(0, 0.4, 0)), end.clone(),
        ], false, "centripetal");
        const material = standard(supply === "power" ? "#63323b" : supply === "ground" ? "#334155" : "#22d3ee", 0.25, 0.4);
        const cable = mesh(trackGeometry(new THREE.TubeGeometry(curve, 40, supply ? 0.016 : 0.027, 6, false)), material, 0, 0, 0);
        cable.castShadow = false;
        tag(cable, { keys, text: info });
        // Invisible, wider pick target makes thin jumpers usable on touch screens.
        const hitMaterial = trackMaterial(new THREE.MeshBasicMaterial({ visible: false }));
        const hit = mesh(trackGeometry(new THREE.TubeGeometry(curve, 24, 0.11, 5, false)), hitMaterial, 0, 0, 0);
        hit.castShadow = false;
        tag(hit, { keys, text: info });
        if (supply) return;
        const particleMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: "#b8f7ff" }));
        const particles = Array.from({ length: 3 }, () => {
          const particle = mesh(particleGeometry, particleMaterial, 0, 0, 0);
          particle.castShadow = false;
          particle.visible = false;
          return particle;
        });
        wires.push({ keys, curve, material, particles, output });
      };
      const sensorVisuals: { keys: SensorKey[]; led: THREE.MeshStandardMaterial; ring: THREE.Mesh; anchor: THREE.Vector3 }[] = [];
      const anchors = new Map<SensorKey, THREE.Vector3>();
      const haloGeometry = trackGeometry(new THREE.RingGeometry(0.89, 0.94, 48));
      MODULES.forEach((definition, moduleIndex) => {
        const group = new THREE.Group();
        group.position.set(definition.x, 0, definition.z);
        scene.add(group);
        const channels = SENSORS.filter((sensor) => sensor.module === moduleIndex);
        const keys = channels.map((sensor) => sensor.key);
        box(0, 0.16, 0, 1.65, 0.15, 1.35, darkTeal, group);
        for (const x of [-0.68, 0.68]) {
          cylinder(x, 0.05, 0.48, 0.1, 0.2, metal, group);
          cylinder(x, 0.245, 0.48, 0.1, 0.025, gold, group);
        }
        if (definition.kind === "gas") {
          cylinder(0, 0.52, -0.12, 0.44, 0.58, metal, group);
          cylinder(0, 0.819, -0.12, 0.38, 0.025, black, group);
          const grille = mesh(trackGeometry(new THREE.TorusGeometry(0.405, 0.035, 8, 28)), metal, 0, 0.84, -0.12, group);
          grille.rotation.x = Math.PI / 2;
          for (let n = -3; n <= 3; n++) {
            const length = Math.sqrt(Math.max(0, 0.35 ** 2 - (n * 0.09) ** 2)) * 2;
            box(0, 0.844, -0.12 + n * 0.09, length, 0.012, 0.025, metal, group);
            box(n * 0.09, 0.845, -0.12, 0.02, 0.012, length, metal, group);
          }
          box(-0.6, 0.35, -0.35, 0.24, 0.23, 0.25, blue, group);
        } else if (definition.kind === "dht") {
          box(0, 0.52, -0.07, 0.82, 0.58, 0.92, blue, group);
          for (let n = 0; n < 6; n++) box(0, 0.815, -0.4 + n * 0.13, 0.62, 0.012, 0.055, socketBlack, group);
        } else if (definition.kind === "co2") {
          box(0, 0.52, -0.1, 1.12, 0.56, 0.75, metal, group);
          box(0.36, 0.82, -0.1, 0.26, 0.035, 0.55, gold, group);
          for (let n = 0; n < 4; n++) box(-0.42 + n * 0.16, 0.81, -0.1, 0.07, 0.015, 0.52, black, group);
        } else if (definition.kind === "flow") {
          const tube = cylinder(0, 0.55, -0.05, 0.34, 1.12, metal, group);
          tube.rotation.z = Math.PI / 2;
          for (const x of [-0.58, 0.58]) {
            const mouth = cylinder(x, 0.55, -0.05, 0.26, 0.025, socketBlack, group);
            mouth.rotation.z = Math.PI / 2;
          }
          box(0, 0.82, -0.05, 0.4, 0.15, 0.34, black, group);
        } else {
          box(-0.08, 0.4, -0.1, 0.65, 0.31, 0.55, black, group);
          cylinder(0.08, 0.64, -0.1, 0.14, 0.26, metal, group);
          cylinder(0.08, 0.779, -0.1, 0.07, 0.016, socketBlack, group);
        }
        silk(definition.name, 0, 0.246, 0.48, 1.2, 0.22, group);
        const led = ledMaterial();
        const lamp = mesh(sphereGeometry, led, 0.65, 0.3, 0.15, group);
        lamp.scale.setScalar(0.08);
        const ringMaterial = trackMaterial(new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
        const ring = mesh(haloGeometry, ringMaterial, definition.x, -0.18, definition.z);
        ring.rotation.x = -Math.PI / 2;
        ring.castShadow = false;
        const anchor = new THREE.Vector3(definition.x, 1.15, definition.z);
        sensorVisuals.push({ keys, led, ring, anchor });
        keys.forEach((key) => anchors.set(key, anchor));
        tag(group, { keys, text: `${definition.name} · illustrative sensor module, not a calibrated model.${moduleIndex === 4 ? " Temperature and humidity share one D2 connection." : moduleIndex >= 5 ? " I2C: A4 = SDA, A5 = SCL; shared bus." : ""}` });
        const signalPins = channels[0].pins;
        signalPins.forEach((pin, index) => {
          const start = new THREE.Vector3(definition.x + index * 0.15, 0.27, definition.z + 0.6);
          box(start.x, start.y + 0.1, start.z, 0.11, 0.2, 0.12, black);
          makeWire(keys, start, pins[pin], moduleIndex + index, `${definition.name} → ${pin}${pin === "A4" ? " / SDA" : pin === "A5" ? " / SCL" : ""} · reference signal path`);
        });
        makeWire(keys, new THREE.Vector3(definition.x - 0.25, 0.25, definition.z + 0.6), pins["5V"], moduleIndex, `${definition.name} · reference 5 V supply, verify actual module voltage requirements.`, false, "power");
        makeWire(keys, new THREE.Vector3(definition.x - 0.4, 0.25, definition.z + 0.6), pins.GND, moduleIndex, `${definition.name} · reference common ground.`, false, "ground");
      });

      const outputLeds: THREE.MeshStandardMaterial[] = [];
      [[-5.55, 2.1, "RELAY", "D7"], [-4.8, 4.5, "VALVE", "D8"]].forEach(([xValue, zValue, name, pin], index) => {
        const x = xValue as number;
        const z = zValue as number;
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        scene.add(group);
        box(0, 0.19, 0, 1.8, 0.3, 1.3, black, group);
        if (!index) {
          box(0, 0.62, -0.08, 1.15, 0.58, 0.7, blue, group);
          for (const offset of [-0.45, 0, 0.45]) cylinder(offset, 0.37, 0.42, 0.1, 0.07, gold, group);
        } else {
          const body = cylinder(0, 0.61, -0.08, 0.3, 1.3, metal, group);
          body.rotation.z = Math.PI / 2;
          box(0, 0.85, -0.08, 0.53, 0.4, 0.55, red, group);
        }
        silk(`${name}\nSIM ONLY / LIVE LOCKED`, 0, 1.075, 0.2, 1.8, 0.58, group, "#fbbf24", "#111827");
        const led = ledMaterial();
        outputLeds.push(led);
        box(0.72, 0.39, 0.38, 0.14, 0.1, 0.12, led, group);
        tag(group, { text: `${name}: SIM ONLY / LIVE LOCKED. ${pin} is an illustrative output route, not an assigned hardware control. Live output stays offline. No commands are transmitted.` });
        makeWire([], new THREE.Vector3(x + 0.7, 0.39, z - 0.3), pins[pin as string], index, `${name} · SIM ONLY / LIVE LOCKED · illustrative ${pin} path, never a live actuator.`, true);
      });

      const pick = (event: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObjects(pickables, true);
        for (const hit of intersections) {
          let object: THREE.Object3D | null = hit.object;
          while (object && !object.userData.inspection) object = object.parent;
          const info = object?.userData.inspection as PickInfo | undefined;
          if (!info) continue;
          setInspection(info.text);
          if (info.keys?.length) {
            const key = info.keys.includes(latest.current.selected as SensorKey) ? latest.current.selected : info.keys[0];
            latest.current.onSelect(key);
          }
          break;
        }
      };
      const pointerDown = (event: PointerEvent) => {
        activePointers.add(event.pointerId);
        if (activePointers.size > 1) { if (pointerStart) pointerStart.moved = true; return; }
        if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
      };
      const pointerMove = (event: PointerEvent) => {
        if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart.moved = true;
      };
      const pointerUp = (event: PointerEvent) => {
        activePointers.delete(event.pointerId);
        if (event.pointerId === pointerStart?.id && !pointerStart.moved && !contextLost) pick(event);
        if (!activePointers.size) pointerStart = null;
      };
      const pointerCancel = (event: PointerEvent) => { activePointers.delete(event.pointerId); pointerStart = null; };
      const keyDown = (event: KeyboardEvent) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "=", "-", "_", "Home"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Home") { resetCamera(); return; }
        if (["+", "=", "-", "_"].includes(event.key)) { zoom(["+", "="].includes(event.key) ? 0.87 : 1.15); return; }
        autoOrbitRef.current = false;
        setAutoOrbit(false);
        if (event.shiftKey) {
          const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          const vertical = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
          const movement = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(horizontal * 0.45);
          movement.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1), vertical * 0.45);
          camera.position.add(movement);
          orbit.target.add(movement);
        } else {
          const spherical = new THREE.Spherical().setFromVector3(scratch.copy(camera.position).sub(orbit.target));
          if (event.key === "ArrowLeft") spherical.theta += 0.12;
          if (event.key === "ArrowRight") spherical.theta -= 0.12;
          if (event.key === "ArrowUp") spherical.phi -= 0.1;
          if (event.key === "ArrowDown") spherical.phi += 0.1;
          spherical.phi = THREE.MathUtils.clamp(spherical.phi, orbit.minPolarAngle, orbit.maxPolarAngle);
          camera.position.copy(orbit.target).add(scratch.setFromSpherical(spherical));
        }
        orbit.update();
      };
      const stopAutoOrbit = () => { autoOrbitRef.current = false; setAutoOrbit(false); };
      orbit.addEventListener("start", stopAutoOrbit);
      cleanupListeners.push(() => orbit.removeEventListener("start", stopAutoOrbit));
      gl.domElement.addEventListener("pointerdown", pointerDown);
      gl.domElement.addEventListener("pointermove", pointerMove);
      gl.domElement.addEventListener("pointerup", pointerUp);
      gl.domElement.addEventListener("pointercancel", pointerCancel);
      gl.domElement.addEventListener("keydown", keyDown);
      cleanupListeners.push(() => {
        gl.domElement.removeEventListener("pointerdown", pointerDown);
        gl.domElement.removeEventListener("pointermove", pointerMove);
        gl.domElement.removeEventListener("pointerup", pointerUp);
        gl.domElement.removeEventListener("pointercancel", pointerCancel);
        gl.domElement.removeEventListener("keydown", keyDown);
      });
      const lost = (event: Event) => {
        event.preventDefault();
        contextLost = true;
        cancelAnimationFrame(raf);
        activePointers.clear();
        pointerStart = null;
        setAvailability("lost");
      };
      const restored = () => {
        if (disposed) return;
        contextLost = false;
        textures.forEach((texture) => { texture.needsUpdate = true; });
        materials.forEach((material) => { material.needsUpdate = true; });
        resize();
        previousTime = 0;
        setAvailability("ready");
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      };
      gl.domElement.addEventListener("webglcontextlost", lost);
      gl.domElement.addEventListener("webglcontextrestored", restored);
      cleanupListeners.push(() => {
        gl.domElement.removeEventListener("webglcontextlost", lost);
        gl.domElement.removeEventListener("webglcontextrestored", restored);
      });
      const positionLabels = () => {
        const occupied: { x: number; y: number; w: number; h: number }[] = [];
        const ordered = [...SENSORS].sort((a, b) => Number(b.key === latest.current.selected) - Number(a.key === latest.current.selected));
        ordered.forEach((sensor) => {
          const element = labelsRef.current[sensor.key];
          const anchor = anchors.get(sensor.key);
          if (!element || !anchor) return;
          projected.copy(anchor).project(camera);
          const labelWidth = element.offsetWidth || 116;
          const labelHeight = element.offsetHeight || 56;
          const screenX = (projected.x * 0.5 + 0.5) * width;
          const screenY = (-projected.y * 0.5 + 0.5) * height;
          const baseX = screenX - labelWidth / 2;
          const baseY = screenY - labelHeight - 10;
          const gap = labelHeight + 5;
          const offsets = sensor.key === "humidity_pct" ? [[0, gap], [0, 0], [labelWidth + 5, 0], [-labelWidth - 5, 0]] : [[0, 0], [0, gap], [0, -gap], [labelWidth + 5, 0], [-labelWidth - 5, 0]];
          let best = { x: 0, y: 0, score: Infinity };
          const candidates = [...offsets];
          // Edge lanes keep all eight keyboard-focusable labels usable on small screens.
          for (let row = 0; row < 7; row++) {
            candidates.push([6 - baseX, 6 + row * gap - baseY], [width - labelWidth - 6 - baseX, 6 + row * gap - baseY]);
          }
          candidates.forEach(([dx, dy], index) => {
            const x = THREE.MathUtils.clamp(baseX + dx, 6, Math.max(6, width - labelWidth - 6));
            const y = THREE.MathUtils.clamp(baseY + dy, 6, Math.max(6, height - labelHeight - 6));
            let overlap = 0;
            occupied.forEach((other) => {
              overlap += Math.max(0, Math.min(x + labelWidth + 3, other.x + other.w + 3) - Math.max(x, other.x)) * Math.max(0, Math.min(y + labelHeight + 3, other.y + other.h + 3) - Math.max(y, other.y));
            });
            const score = overlap * 100 + Math.hypot(x - baseX, y - baseY) + index * 0.01;
            if (score < best.score) best = { x, y, score };
          });
          occupied.push({ x: best.x, y: best.y, w: labelWidth, h: labelHeight });
          element.style.transform = `translate3d(${best.x.toFixed(1)}px,${best.y.toFixed(1)}px,0)`;
          // Off-screen/behind-camera anchors are docked, not represented as onscreen readings.
          const offscreen = projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
          element.style.borderStyle = offscreen ? "dashed" : "solid";
          element.dataset.docked = offscreen ? "true" : "false";
        });
      };
      const frame = (time: number) => {
        if (disposed || contextLost) return;
        raf = requestAnimationFrame(frame);
        if (document.hidden) { previousTime = 0; return; }
        const delta = previousTime ? Math.min(0.05, (time - previousTime) / 1000) : 0;
        previousTime = time;
        const current = latest.current;
        const currentTime = Date.now();
        if (currentTime - lastStatusTick > 1000) { lastStatusTick = currentTime; setNow(currentTime); }
        orbit.autoRotate = autoOrbitRef.current;
        orbit.update(delta);
        const states = new Map(SENSORS.map((sensor) => [sensor.key, channel(current.snapshot, sensor.key, currentTime)]));
        const simulation = current.snapshot?.mode === "simulation";
        const connected = simulation || Boolean(current.snapshot?.hardware?.connected);
        const fresh = Array.from(states.values()).some((state) => state.valid);
        const traffic = fresh && !reducedMotion.matches;
        powerLed.color.set(connected ? "#22d3ee" : "#25313c");
        powerLed.emissive.set(connected ? "#22d3ee" : "#000000");
        powerLed.emissiveIntensity = connected ? 1.4 : 0;
        rxLed.emissiveIntensity = traffic ? (Math.sin(time * 0.019) > 0 ? 2.2 : 0.1) : 0;
        // TX never implies live outgoing control; it is animation only in simulation.
        txLed.emissiveIntensity = simulation && traffic ? (Math.sin(time * 0.013) > 0.6 ? 1.8 : 0.1) : 0;
        const suppressionActive = simulation && current.snapshot?.fire_state?.suppression?.active === true;
        outputLeds.forEach((led) => {
          led.color.set(simulation ? "#fbbf24" : "#374151");
          led.emissive.set(simulation ? "#f59e0b" : "#000000");
          led.emissiveIntensity = suppressionActive ? 1.6 : 0;
        });
        sensorVisuals.forEach((visual) => {
          const stateList = visual.keys.map((key) => states.get(key)!);
          const state = [...stateList].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))[0];
          const isSelected = visual.keys.includes(current.selected as SensorKey);
          visual.led.color.set(COLORS[state.status]);
          visual.led.emissive.set(COLORS[state.status]);
          visual.led.emissiveIntensity = state.valid ? 0.8 : 0.05;
          const material = visual.ring.material as THREE.MeshBasicMaterial;
          material.color.set(isSelected ? "#fbbf24" : COLORS[state.status]);
          material.opacity = isSelected ? 0.9 : 0.25;
        });
        wires.forEach((wire, index) => {
          const stateList = wire.keys.map((key) => states.get(key)!);
          const state = [...stateList].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))[0];
          const status: ChannelStatus = wire.output ? (suppressionActive ? "warning" : "disconnected") : state.status;
          const chosen = wire.keys.includes(current.selected as SensorKey);
          const base = COLORS[status];
          const animate = !reducedMotion.matches && (status === "normal" || status === "warning" || status === "critical");
          color.set(base);
          wire.material.color.copy(color);
          wire.material.emissive.copy(color);
          wire.material.emissiveIntensity = (chosen ? 0.55 : 0.14) + (animate ? (Math.sin(time * (status === "critical" ? 0.008 : 0.003) + index) + 1) * 0.18 : 0);
          // Outputs never emit reading particles; a shared bus animates only for fresh valid channels.
          const hasReading = !wire.output && stateList.some((item) => item.valid);
          wire.particles.forEach((particle, particleIndex) => {
            particle.visible = hasReading && !reducedMotion.matches;
            if (particle.visible) wire.curve.getPointAt((time * 0.00013 + particleIndex / 3 + index * 0.07) % 1, particle.position);
          });
        });
        gl.render(scene, camera);
        if (time - lastLabelTime >= 32) { lastLabelTime = time; positionLabels(); }
      };
      setAvailability("ready");
      setNow(Date.now());
      raf = requestAnimationFrame(frame);
    } catch {
      dispose();
      setAvailability("failed");
    }
    return dispose;
  }, []);

  const simulation = snapshot?.mode === "simulation";
  const suppression = snapshot?.fire_state?.suppression;
  const unavailable = availability === "failed" || availability === "lost";
  const controlClass = "rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] text-slate-300 transition-colors hover:border-cyan-500 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";
  const selectedDefinition = SENSORS.find((sensor) => sensor.key === selected);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#05070f] text-slate-200" aria-label="Arduino Uno interactive hardware reference">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">UNO / Hardware reference</h3>
          <p className="mt-1 text-[10px] text-slate-400">3D reference · not calibrated hardware · read-only</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="3D camera controls">
          <button type="button" className={controlClass} disabled={availability !== "ready"} onClick={() => { autoOrbitRef.current = false; setAutoOrbit(false); actions.current?.reset(); }}>Reset view</button>
          <button type="button" className={controlClass} disabled={availability !== "ready"} aria-label="Zoom in" onClick={() => actions.current?.zoom(0.85)}>+</button>
          <button type="button" className={controlClass} disabled={availability !== "ready"} aria-label="Zoom out" onClick={() => actions.current?.zoom(1.18)}>−</button>
          <button type="button" className={controlClass} disabled={availability !== "ready"} aria-pressed={autoOrbit} onClick={() => { autoOrbitRef.current = !autoOrbit; setAutoOrbit(!autoOrbit); }}>Orbit {autoOrbit ? "on" : "off"}</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800/60 px-4 py-2 font-mono text-[10px] text-slate-400">
        <span className={simulation ? "text-amber-300" : snapshot?.hardware?.connected ? "text-cyan-300" : "text-rose-400"}>{simulation ? "SYNTHETIC / SIMULATED FEED" : snapshot?.hardware?.connected ? "LIVE HARDWARE / CONNECTED" : `LIVE HARDWARE / ${String(snapshot?.hardware?.status || "disconnected").toUpperCase()}`}</span>
        <span>{snapshot?.hardware?.board || "Arduino Uno reference"}</span>
        <span>{typeof snapshot?.hardware?.frequency_hz === "number" ? formatter.format(snapshot.hardware.frequency_hz) : "—"} Hz</span>
        <span>{Array.isArray(snapshot?.hardware?.communication_errors) ? snapshot.hardware.communication_errors.length : 0} comm errors</span>
        <span>TX / actuation disabled</span>
      </div>
      <div ref={hostRef} className={`relative isolate w-full ${heightClass}`}>
        {availability === "loading" && <div role="status" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-xs text-slate-400">Initializing 3D hardware reference…</div>}
        {unavailable && (
          <div role="status" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#05070f] px-8 text-center">
            <p className="font-mono text-sm text-amber-300">3D unavailable</p>
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">{availability === "lost" ? "The WebGL context was lost. Waiting for the browser to restore it; telemetry remains available below." : "This browser could not initialize WebGL. Enable hardware acceleration or use a WebGL-capable browser. Telemetry remains available below."}</p>
            <p className="text-[10px] text-slate-500">No substitute scene is shown.</p>
          </div>
        )}
        <div className={`pointer-events-none absolute inset-0 z-10 overflow-hidden ${availability !== "ready" ? "invisible" : ""}`} aria-label="Projected sensor readings">
          {SENSORS.map((sensor) => {
            const reading = snapshot?.sensors?.[sensor.key];
            const state = channel(snapshot, sensor.key, now || Date.now());
            const active = selected === sensor.key;
            const title = `${reading?.label || sensor.name}: ${state.value === null ? "—" : formatter.format(state.value)} ${reading?.unit || sensor.unit}; ${state.status}; reference ${sensor.pins.join(" / ")}${sensor.module === 4 ? "; shared temperature/humidity module" : ""}`;
            return (
              <button
                key={sensor.key}
                ref={(element) => { labelsRef.current[sensor.key] = element; }}
                type="button"
                aria-label={title}
                aria-pressed={active}
                title={title}
                onClick={() => { onSelect(sensor.key); setInspection(`${sensor.name} · reference ${sensor.pins.join(" / ")}${sensor.module === 4 ? " · temperature and humidity share D2" : sensor.module >= 5 ? " · A4 SDA / A5 SCL shared I2C bus" : ""}`); }}
                className={`pointer-events-auto absolute left-0 top-0 w-[108px] rounded-md border bg-[#080e1b]/95 px-2 py-1.5 text-left shadow-lg backdrop-blur-sm focus-visible:z-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:w-[118px] ${active ? "z-20 ring-1 ring-amber-300/50" : "z-10"}`}
                style={{ borderColor: active ? "#fbbf24" : COLORS[state.status] + "88" }}
              >
                <span className="flex items-center justify-between gap-1 text-[9px] uppercase tracking-wide text-slate-300"><span className="truncate">{sensor.name}</span><span className="shrink-0 text-[8px] text-slate-500">{sensor.pins.length > 1 ? "I2C" : sensor.pins[0]}</span></span>
                <span className="mt-0.5 block truncate font-mono text-xs font-semibold text-slate-100">{state.value === null ? "—" : formatter.format(state.value)} <span className="text-[9px] font-normal text-slate-400">{reading?.unit || sensor.unit}</span></span>
                <span className="mt-0.5 flex items-center gap-1 text-[8px] uppercase tracking-wider" style={{ color: COLORS[state.status] }}><span className="h-1 w-1 rounded-full bg-current" />{state.status}{active ? " / selected" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
      {unavailable && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-800 p-3 sm:grid-cols-4" aria-label="Sensor telemetry without 3D">
          {SENSORS.map((sensor) => {
            const state = channel(snapshot, sensor.key, now || Date.now());
            return <button key={sensor.key} type="button" className={`${controlClass} text-left`} aria-pressed={selected === sensor.key} onClick={() => onSelect(sensor.key)}><span className="block">{sensor.name} · {sensor.pins.join("/")}</span><span style={{ color: COLORS[state.status] }}>{state.value === null ? "—" : formatter.format(state.value)} {snapshot?.sensors?.[sensor.key]?.unit || sensor.unit} · {state.status}</span></button>;
          })}
        </div>
      )}
      <div className="space-y-2 border-t border-slate-800 px-4 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] uppercase tracking-wider text-slate-400" aria-label="Connection status legend">
          {(["normal", "warning", "critical", "stale", "disconnected", "missing", "uncalibrated"] as ChannelStatus[]).map((status) => <span key={status} className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLORS[status] }} />{status === "normal" ? "Active" : status}</span>)}
        </div>
        <p className="text-[10px] leading-relaxed text-slate-400">Drag to rotate · wheel / pinch to zoom · right-drag / two fingers to pan. Keyboard: focus scene, arrows rotate, Shift + arrows pan, + / − zoom, Home reset. Tab to readings; Enter / Space selects. Dashed labels are docked off-screen sensors.</p>
        <p className="min-h-[28px] text-[11px] leading-relaxed text-cyan-100/80" role="status" aria-live="polite">{selectedDefinition && <span className="text-amber-300">{selectedDefinition.name} selected. </span>}{inspection}</p>
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] leading-relaxed text-amber-200/90">
          <strong className="font-mono">OUTPUTS: SIM ONLY / LIVE LOCKED</strong>
          <span> · {simulation ? suppression?.active ? "Simulated suppression active" : "Simulated outputs idle" : "Offline — live actuation prohibited"}{simulation && suppression?.method ? ` · ${String(suppression.method)}` : ""}{simulation && suppression?.isolated ? " · isolation simulated" : ""}. No hardware commands are sent.</span>
          <span className="mt-1 block text-slate-400">Pin reference: O2 A0 · CO A1 · smoke A2 · airflow A3 · temp/RH D2 · CO2 + pressure A4/SDA, A5/SCL. Illustrative modules and supply wiring; verify real voltage, interface, and calibration requirements. Moving particles indicate fresh valid readings only.</span>
        </div>
      </div>
    </section>
  );
}
