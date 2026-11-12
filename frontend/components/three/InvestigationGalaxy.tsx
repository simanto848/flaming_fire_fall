"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThreeScene } from "@/lib/useThree";
import { api } from "@/lib/api";
import { Crosshair, Trophy, Rocket, GitCompare, X, FlaskConical, Ruler, Radio } from "lucide-react";

const INV_COLORS: Record<string, number> = {
  "PSI-25": 0xf59e0b,   // BASS-II — amber
  FLEX: 0x22d3ee,       // droplet combustion — cyan
  Saffire: 0xe879f9,    // large-scale — magenta
  "PSI-62": 0x4ade80,   // FGM tomography — green
  SAME: 0x38bdf8,       // smoke & aerosol — sky
  DAFT: 0xa3e635,       // dust — lime
  "ACME-BRE": 0xfb7185, // burning rate emulator — rose
  "ACME-CFIG": 0x818cf8,// cool flames gases — indigo
  "ACME-EFIELD": 0xfacc15, // electric-field partial-g — yellow
  SPICE: 0x34d399,      // smoke point — emerald
  SLICE: 0x2dd4bf,      // liftoff — teal
  "FLEX-2": 0x67e8f9,   // droplets II — light cyan
  CFI: 0xc084fc,        // cool flame droplets — purple
};
const INV_LABELS: Record<string, string> = {
  "PSI-25": "BASS-II · solids", FLEX: "FLEX · droplets", Saffire: "Saffire · large-scale", "PSI-62": "FGM · tomography",
  SAME: "SAME · smoke/aerosol", DAFT: "DAFT · dust", "ACME-BRE": "BRE · burning rate",
  "ACME-CFIG": "CFI-G · cool flames", "ACME-EFIELD": "E-FIELD · partial-g", SPICE: "SPICE · smoke point",
  SLICE: "SLICE · liftoff", "FLEX-2": "FLEX-2 · droplets", CFI: "CFI · cool droplets",
};
const HARDWARE: { tag: string; label: string }[] = [
  { tag: "CIR", label: "CIR · ACME gaseous" },
  { tag: "CIR+MDCA", label: "CIR+MDCA · droplets" },
  { tag: "MSG+FlowDuct", label: "MSG+Flow Duct · solids/co-flow" },
  { tag: "MSG", label: "MSG · detection/dust" },
  { tag: "Cygnus", label: "Cygnus · Saffire" },
];
const O2_RANGE: [number, number] = [10, 100];
const FLOW_RANGE: [number, number] = [0, 30];
const P_RANGE: [number, number] = [4, 16];
const SX = 15, SY = 8, SZ = 10;

const nx = (o2: number) => ((o2 - O2_RANGE[0]) / (O2_RANGE[1] - O2_RANGE[0]) - 0.5) * SX;
const ny = (f: number) => ((f - FLOW_RANGE[0]) / (FLOW_RANGE[1] - FLOW_RANGE[0])) * SY;
const nz = (p: number) => ((p - P_RANGE[0]) / (P_RANGE[1] - P_RANGE[0]) - 0.5) * SZ;
const num = (v: any, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

const DIFF_FIELDS: { key: string; label: string; unit: string; numeric: boolean }[] = [
  { key: "pre_O2_pct", label: "O₂ concentration", unit: "%", numeric: true },
  { key: "fan_display_velocity_cms", label: "Airflow", unit: "cm/s", numeric: true },
  { key: "cabin_pressure_psi", label: "Cabin pressure", unit: "psi", numeric: true },
  { key: "thickness_mm", label: "Thickness / D₀", unit: "mm", numeric: true },
  { key: "sample_material", label: "Fuel sample", unit: "", numeric: false },
  { key: "geometry", label: "Sample geometry", unit: "", numeric: false },
];
const fmtVal = (r: any, f: { key: string; numeric: boolean }) =>
  f.numeric ? num(r?.[f.key], 0).toFixed(1) : String(r?.[f.key] ?? "—");

function axisLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 80;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 40px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(5, 0.78, 1);
  return s;
}

export default function InvestigationGalaxy({ heightClass = "h-[420px]" }: { heightClass?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [filters, setFilters] = useState<Record<string, boolean>>({});
  const [hwFilters, setHwFilters] = useState<Record<string, boolean>>({});
  const [o2, setO2] = useState(34);
  const [flow, setFlow] = useState(5);
  const [pressure, setPressure] = useState(8.2);
  const [material, setMaterial] = useState("Nomex");
  const [ranked, setRanked] = useState<any[]>([]);
  const [ranking, setRanking] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; rec: any } | null>(null);
  const [selection, setSelection] = useState<any[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [scope, setScope] = useState<any>(null);
  const [showScope, setShowScope] = useState(false);

  const dataRef = useRef({ records, filters, hwFilters, ranked, target: { o2, flow, pressure } });
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const visibleRef = useRef<any[]>([]);
  const targetRef = useRef<THREE.Group | null>(null);
  const linesRef = useRef<THREE.Group | null>(null);
  const ringsRef = useRef<THREE.Group | null>(null);
  const pickFnRef = useRef<(rec: any) => void>(() => {});

  useEffect(() => { dataRef.current = { records, filters, hwFilters, ranked, target: { o2, flow, pressure } }; }, [records, filters, hwFilters, ranked, o2, flow, pressure]);

  useEffect(() => {
    api.metadataRecords().then((r) => setRecords(r.records || [])).catch(() => {});
    api.metadataCatalog().then((c) => setScope(c.scope_guardrails?.[0] || null)).catch(() => {});
  }, []);

  pickFnRef.current = (rec: any) => {
    setHint(null);
    setSelection((sel) => {
      if (sel.length === 1 && sel[0].investigation_id !== rec.investigation_id) {
        setHint(`Comparison diffs runs of one investigation — selection reset to ${rec.investigation_id}. Pick a second ${rec.investigation_id} run.`);
        return [rec];
      }
      if (sel.some((s) => s.test_id === rec.test_id)) return sel.filter((s) => s.test_id !== rec.test_id);
      if (sel.length >= 2) return [rec];
      return [...sel, rec];
    });
  };

  const doRank = async () => {
    setRanking(true);
    try {
      const r = await api.rank({ o2_pct: o2, flow_cms: flow, pressure_psi: pressure, material, top_k: 6 });
      setRanked(r.ranked_experiments || []);
    } catch { /* backend offline */ }
    setRanking(false);
  };

  const handleRef = useThreeScene(mountRef, ({ scene, camera, renderer }) => {
    scene.add(new THREE.AmbientLight(0x33415e, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(10, 14, 8);
    scene.add(key);

    // Bounding frame + axis labels.
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(SX, SY, SZ)),
      new THREE.LineBasicMaterial({ color: 0x1c2a4a, transparent: true, opacity: 0.6 })
    );
    frame.position.y = SY / 2;
    scene.add(frame);
    const xl = axisLabel("OXYGEN % →", "#67e8f9"); xl.position.set(0, -0.8, SZ / 2 + 1); scene.add(xl);
    const yl = axisLabel("AIRFLOW cm/s →", "#f59e0b"); yl.position.set(-SX / 2 - 1.6, SY / 2, SZ / 2 + 1); yl.scale.set(4.4, 0.7, 1); scene.add(yl);
    const zl = axisLabel("PRESSURE psi →", "#4ade80"); zl.position.set(SX / 2 + 1.4, -0.8, 0); scene.add(zl);
    const grid = new THREE.GridHelper(SX, 10, 0x16223d, 0x101a30);
    grid.position.y = 0.01;
    scene.add(grid);

    // Target atmosphere probe.
    const target = new THREE.Group();
    const octa = new THREE.Mesh(new THREE.OctahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    target.add(octa, core);
    scene.add(target);
    targetRef.current = target;

    const lines = new THREE.Group();
    scene.add(lines);
    linesRef.current = lines;
    const rings = new THREE.Group();
    scene.add(rings);
    ringsRef.current = rings;

    // Hover picking + click-to-compare.
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const el = renderer.domElement;
    const cast = (e: PointerEvent | MouseEvent) => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit && hit.instanceId != null) return visibleRef.current[hit.instanceId];
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const rec = cast(e);
      if (rec) {
        el.style.cursor = "pointer";
        const r = el.getBoundingClientRect();
        setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top, rec });
      } else {
        el.style.cursor = "grab";
        setTooltip(null);
      }
    };
    const onClick = (e: MouseEvent) => {
      const rec = cast(e);
      if (rec) pickFnRef.current(rec);
    };
    const onLeave = () => setTooltip(null);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);

    return (_dt: number, t: number) => {
      const d = dataRef.current;
      if (targetRef.current) {
        targetRef.current.position.set(nx(d.target.o2), ny(d.target.flow), nz(d.target.pressure));
        targetRef.current.rotation.y += _dt * 0.8;
        targetRef.current.rotation.x += _dt * 0.3;
        const s = 1 + 0.12 * Math.sin(t * 3);
        targetRef.current.scale.setScalar(s);
      }
      // Pulse ranked highlights.
      if (ringsRef.current) {
        ringsRef.current.children.forEach((r, i) => {
          r.scale.setScalar(1 + 0.2 * Math.sin(t * 3 + i));
          (r as THREE.Mesh).rotation.z += _dt * 0.6;
        });
      }
    };
  }, { cameraPos: [16, 11, 17], target: [0, 4, 0], autoRotate: true, minDist: 10, maxDist: 55 }, []);

  // Build / rebuild the instanced experiment cloud.
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    const { scene } = h;
    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
      meshRef.current = null;
    }
    const visible = records.filter((r) => filters[r.investigation_id] !== false && hwFilters[r.hardware_tag] !== false);
    visibleRef.current = visible;
    if (!visible.length) return;
    const geo = new THREE.SphereGeometry(1, 10, 10);
    const mat = new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.45 });
    const mesh = new THREE.InstancedMesh(geo, mat, visible.length);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const rankIds = new Set(ranked.map((r) => r.test_id));
    const selIds = new Set(selection.map((r) => r.test_id));
    visible.forEach((r, i) => {
      const x = nx(num(r.pre_O2_pct, 21));
      const y = ny(num(r.fan_display_velocity_cms, 0.5));
      const z = nz(num(r.cabin_pressure_psi, 14.7));
      const size = (selIds.has(r.test_id) ? 0.3 : rankIds.has(r.test_id) ? 0.24 : 0.1) + Math.min(0.16, num(r.flame_spread_rate_mms, 0) * 0.1);
      m4.makeScale(size, size, size);
      m4.setPosition(x, y, z);
      mesh.setMatrixAt(i, m4);
      col.setHex(selIds.has(r.test_id) ? 0x4ade80 : rankIds.has(r.test_id) ? 0xffffff : (INV_COLORS[r.investigation_id] ?? 0x8b99b5));
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshRef.current = mesh;

    // Ranking connector lines + rings.
    const lines = linesRef.current, rings = ringsRef.current;
    if (lines && rings) {
      while (lines.children.length) { const c = lines.children[0] as THREE.Line; lines.remove(c); c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      while (rings.children.length) { const c = rings.children[0] as THREE.Mesh; rings.remove(c); c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
      const tp = new THREE.Vector3(nx(o2), ny(flow), nz(pressure));
      ranked.forEach((r) => {
        const p = new THREE.Vector3(nx(num(r.pre_O2_pct, 21)), ny(num(r.fan_display_velocity_cms, 0.5)), nz(num(r.cabin_pressure_psi, 14.7)));
        const lg = new THREE.BufferGeometry().setFromPoints([tp, p]);
        lines.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 32),
          new THREE.MeshBasicMaterial({ color: INV_COLORS[r.investigation_id] ?? 0xffffff, transparent: true, opacity: 0.9 }));
        ring.position.copy(p);
        rings.add(ring);
      });
    }
  }, [records, filters, hwFilters, ranked, selection, o2, flow, pressure, handleRef]);

  const counts = records.reduce((acc: Record<string, number>, r) => { acc[r.investigation_id] = (acc[r.investigation_id] || 0) + 1; return acc; }, {});

  const [a, b] = selection.length === 2 ? selection : [null, null];
  const constants = a && b ? DIFF_FIELDS.filter((f) => fmtVal(a, f) === fmtVal(b, f)) : [];
  const manipulated = a && b ? DIFF_FIELDS.filter((f) => fmtVal(a, f) !== fmtVal(b, f)) : [];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <div className={`relative overflow-hidden rounded-xl border border-line bg-void-950 ${heightClass}`}>
          <div ref={mountRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-void-900/85 px-2.5 py-1.5 text-[10px] backdrop-blur">
            <span className="font-bold text-mist-200">{records.length} HARMONIZED TESTS</span>
            <span className="ml-1.5 text-mist-500">· PSI repository · 3D parameter space</span>
          </div>
          {/* Investigation filter chips */}
          <div className="absolute right-3 top-3 flex max-h-[70%] flex-col gap-1 overflow-y-auto pr-0.5">
            {Object.keys(INV_COLORS).map((inv) => (
              <button key={inv} type="button"
                onClick={() => setFilters((f) => ({ ...f, [inv]: !f[inv] }))}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-semibold backdrop-blur transition-all ${
                  filters[inv] !== false ? "border-line-bright bg-void-900/85 text-mist-200" : "border-line bg-void-950/70 text-mist-600 opacity-60"
                }`}>
                <span className="h-2 w-2 rounded-full" style={{ background: hex(INV_COLORS[inv]), boxShadow: filters[inv] !== false ? `0 0 6px ${hex(INV_COLORS[inv])}` : "none" }} />
                {INV_LABELS[inv]} · {counts[inv] || 0}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-void-900/80 px-2 py-1 text-[8px] text-mist-500">
            x: O₂ % · y: airflow cm/s · z: pressure psi · size ∝ spread rate · hover for details · click two runs of one investigation to compare
          </div>
          {/* Rocket combustion out-of-scope guardrail */}
          <div className="absolute bottom-2 right-3">
            {showScope && scope && (
              <div className="absolute bottom-8 right-0 z-20 w-64 rounded-lg border border-flame-500/50 bg-void-900/95 p-2.5 text-[9px] leading-relaxed text-mist-300 shadow-panel backdrop-blur">
                <div className="mb-1 font-bold text-flame-400">{scope.badge}: {scope.topic}</div>
                {scope.reason}
              </div>
            )}
            <button type="button" onClick={() => setShowScope((s) => !s)}
              title={scope ? `${scope.badge}: ${scope.reason}` : "Rocket propulsion out of scope"}
              className="flex items-center gap-1 rounded-lg border border-flame-500/50 bg-flame-500/10 px-2 py-1 text-[8px] font-bold text-flame-400 backdrop-blur hover:bg-flame-500/20">
              <Rocket className="h-3 w-3" /> ROCKET PROPULSION · OUT OF SCOPE
            </button>
          </div>
          {tooltip?.rec && (
            <div className="pointer-events-none absolute z-10 w-56 rounded-lg border border-line-bright bg-void-900/95 p-2.5 text-[10px] shadow-panel backdrop-blur"
              style={{ left: Math.min(tooltip.x + 14, (mountRef.current?.clientWidth || 400) - 236), top: Math.max(8, tooltip.y - 110) }}>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold text-mist-100">{tooltip.rec.test_id}</span>
                <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: `${hex(INV_COLORS[tooltip.rec.investigation_id] ?? 0x8b99b5)}22`, color: hex(INV_COLORS[tooltip.rec.investigation_id] ?? 0x8b99b5) }}>
                  {tooltip.rec.investigation_id}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-mist-400">
                <span>Material</span><span className="text-right text-mist-200">{tooltip.rec.sample_material}</span>
                <span>O₂</span><span className="text-right text-ion-300">{num(tooltip.rec.pre_O2_pct, 21).toFixed(1)}%</span>
                <span>Flow</span><span className="text-right text-ember-400">{num(tooltip.rec.fan_display_velocity_cms, 0).toFixed(1)} cm/s</span>
                <span>Pressure</span><span className="text-right text-pulse-400">{num(tooltip.rec.cabin_pressure_psi, 14.7).toFixed(1)} psi</span>
                <span>Spread</span><span className="text-right text-mist-200">{num(tooltip.rec.flame_spread_rate_mms, 0).toFixed(2)} mm/s</span>
                <span>Outcome</span><span className="text-right text-mist-200">{tooltip.rec.flammability_status}</span>
                <span>Hardware</span><span className="text-right text-pulse-300">{tooltip.rec.hardware_tag ?? "—"}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[8px] text-mist-500">
                <span>{tooltip.rec.record_class === "curated_summary" ? "curated summary of NASA results" : tooltip.rec.record_class === "live_fetched_table" ? "live-fetched NASA table" : "compiled flight table"}</span>
                <span className="text-ok-400">click to compare</span>
              </div>
            </div>
          )}
        </div>
        {hint && <div className="mt-2 rounded-lg border border-ember-500/40 bg-ember-500/10 px-2.5 py-1.5 text-[9px] text-ember-300">{hint}</div>}
      </div>

      {/* Ranking console */}
      <div className="space-y-2.5">
        <div className="rounded-xl border border-line bg-void-900/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-mist-200">
            <Crosshair className="h-3.5 w-3.5 text-ion-400" /> Target exploration atmosphere
          </div>
          <div className="space-y-2">
            {([["Oxygen", o2, setO2, 10, 100, "%", "text-ion-300"],
               ["Airflow", flow, setFlow, 0, 30, "cm/s", "text-ember-400"],
               ["Pressure", pressure, setPressure, 4.3, 15, "psi", "text-pulse-400"]] as const).map(([label, val, set, min, max, unit, cls]) => (
              <label key={label} className="block">
                <span className="mb-0.5 flex justify-between text-[9px] text-mist-400">
                  <span>{label}</span><span className={`font-mono ${cls}`}>{(val as number).toFixed(1)} {unit}</span>
                </span>
                <input type="range" min={min} max={max} step={0.1} value={val as number}
                  onChange={(e) => (set as (v: number) => void)(parseFloat(e.target.value))} className="w-full" />
              </label>
            ))}
            <label className="block">
              <span className="label !mb-0.5 !text-[9px]">Priority material</span>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} className="input !py-1.5 text-xs">
                {["PMMA", "Nomex", "Cotton-Fiber Blend"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              {[["ISS", 21, 7.5, 14.7], ["Gateway", 32, 5, 10.2], ["Lunar", 34, 5, 8.2], ["Mars", 28, 5, 9.5], ["Suit", 100, 0.5, 4.3], ["CFI-G", 85, 1, 14.7]].map(([n, oo, ff, pp]) => (
                <button key={n as string} type="button" onClick={() => { setO2(oo as number); setFlow(ff as number); setPressure(pp as number); }}
                  className="chip !px-2 !py-0.5 text-[9px] hover:!border-ion-400/60 hover:!text-ion-300">{n}</button>
              ))}
            </div>
            <button type="button" onClick={() => void doRank()} disabled={ranking}
              className="btn btn-primary w-full !py-2 text-xs disabled:opacity-50">
              <Trophy className="h-3.5 w-3.5" /> {ranking ? "Ranking…" : "Rank most relevant tests"}
            </button>
          </div>
        </div>

        {/* Hardware-centric facility filter (Fix 2) */}
        <div className="rounded-xl border border-line bg-void-900/60 p-3">
          <div className="mb-1.5 text-[10px] font-bold tracking-wide text-mist-400">HARDWARE FACILITY FILTER</div>
          <div className="flex flex-wrap gap-1">
            {HARDWARE.map((hw) => (
              <button key={hw.tag} type="button"
                onClick={() => setHwFilters((f) => ({ ...f, [hw.tag]: !f[hw.tag] }))}
                className={`chip !px-2 !py-0.5 text-[9px] ${hwFilters[hw.tag] !== false ? "!border-pulse-400/60 !text-pulse-300" : "opacity-50"}`}>
                {hw.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-void-900/60 p-3">
          <div className="mb-2 text-[10px] font-bold tracking-wide text-mist-400">PHYSICS-WEIGHTED MATCHES</div>
          {ranked.length === 0 ? (
            <p className="text-[10px] leading-relaxed text-mist-500">
              Set a target atmosphere and rank. Tests are scored by similarity in O₂, airflow, pressure and material — the closest flight evidence for untested habitats.
            </p>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {ranked.map((r, i) => (
                <button key={r.test_id} type="button" onClick={() => pickFnRef.current(r)} className="w-full rounded-lg border border-line bg-void-950/70 p-2 text-left hover:border-line-bright">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-bold text-mist-100">#{i + 1} {r.test_id}</span>
                    <span className="font-mono font-bold text-ion-300">{r.similarity_pct?.toFixed(1)}%</span>
                  </div>
                  <div className="mt-0.5 text-[8px] text-mist-500">{r.investigation_id} · {r.hardware_tag} · {r.sample_material} · {num(r.pre_O2_pct, 21).toFixed(0)}% O₂ · {num(r.fan_display_velocity_cms, 0).toFixed(0)} cm/s</div>
                  <div className="mt-1 h-1 overflow-hidden rounded bg-void-700">
                    <div className="h-full rounded bg-gradient-to-r from-ion-500 to-pulse-400" style={{ width: `${r.similarity_pct ?? 0}%` }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Intra-investigation comparison drawer (Fix 2) */}
      {a && b && (
        <div className="rounded-xl border border-ok-500/40 bg-void-900/70 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-bold text-mist-100">
              <GitCompare className="h-4 w-4 text-ok-400" />
              Variable diff · {a.investigation_id}
              <span className="rounded bg-void-700 px-1.5 py-0.5 font-mono text-[9px] text-ok-300">{a.test_id}</span>
              <span className="text-mist-500">vs</span>
              <span className="rounded bg-void-700 px-1.5 py-0.5 font-mono text-[9px] text-ok-300">{b.test_id}</span>
            </div>
            <button type="button" onClick={() => setSelection([])} className="btn !px-2 !py-1 text-[9px]"><X className="h-3 w-3" /> Clear</button>
          </div>
          <div className="mb-2 text-[9px] text-mist-500">{a.apparatus} · {a.investigation_name}</div>
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-ok-500/30 bg-ok-500/5 p-2.5">
              <div className="mb-1.5 text-[9px] font-bold tracking-wide text-ok-400">CONSTANT ATTRIBUTES</div>
              <div className="space-y-1 text-[9px] text-mist-300">
                {constants.map((f) => (
                  <div key={f.key} className="flex justify-between gap-2"><span className="text-mist-500">{f.label}</span><span className="font-mono text-ok-300">{fmtVal(a, f)}{f.unit && ` ${f.unit}`}</span></div>
                ))}
                {(a.constant_attributes || []).map((c: string) => (
                  <div key={c} className="text-mist-400">• {c}</div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-ember-500/30 bg-ember-500/5 p-2.5">
              <div className="mb-1.5 text-[9px] font-bold tracking-wide text-ember-400">MANIPULATED VARIABLES</div>
              <div className="space-y-1 text-[9px]">
                {manipulated.length === 0 && <div className="text-mist-500">No differing parameters — identical run conditions.</div>}
                {manipulated.map((f) => (
                  <div key={f.key} className="flex justify-between gap-2">
                    <span className="text-mist-500">{f.label}</span>
                    <span className="font-mono text-ember-300">{fmtVal(a, f)} → {fmtVal(b, f)}{f.unit && ` ${f.unit}`}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-void-950/60 p-2.5">
              <div className="mb-1.5 flex items-center gap-1 text-[9px] font-bold tracking-wide text-ion-300"><Ruler className="h-3 w-3" /> FUEL SAMPLE GEOMETRY</div>
              <div className="space-y-1 text-[9px] text-mist-400">
                <div>{a.geometry_detail}</div>
                <div className="font-mono text-mist-300">{a.test_id}: {a.geometry} · {num(a.thickness_mm, 0).toFixed(2)} mm × {num(a.width_mm, 0).toFixed(1)} mm</div>
                <div className="font-mono text-mist-300">{b.test_id}: {b.geometry} · {num(b.thickness_mm, 0).toFixed(2)} mm × {num(b.width_mm, 0).toFixed(1)} mm</div>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-void-950/60 p-2.5">
              <div className="mb-1.5 flex items-center gap-1 text-[9px] font-bold tracking-wide text-pulse-300"><Radio className="h-3 w-3" /> SENSORS / MEASUREMENTS</div>
              <div className="space-y-0.5 text-[9px] text-mist-400">
                {(a.sensors || []).map((s: string) => <div key={s}>• {s}</div>)}
              </div>
            </div>
          </div>
          {a.gravity_proxy && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-ember-400/30 bg-ember-500/5 px-2.5 py-1.5 text-[9px] text-ember-300">
              <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" /> {a.gravity_proxy}
            </div>
          )}
        </div>
      )}
      {selection.length === 1 && (
        <div className="rounded-lg border border-line bg-void-900/60 px-2.5 py-1.5 text-[9px] text-mist-400">
          <span className="font-bold text-ok-300">{selection[0].test_id}</span> selected — click a second run from <span className="font-bold">{selection[0].investigation_id}</span> to open the constant-vs-manipulated variable diff.
        </div>
      )}
    </div>
  );
}