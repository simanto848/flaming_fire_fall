"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThreeScene, REGIME_HEX } from "@/lib/useThree";
import { api } from "@/lib/api";
import { RotateCcw } from "lucide-react";

const MATERIALS = ["PMMA", "Nomex", "Cotton-Fiber Blend"];
const REGIMES = ["Radiative Extinction", "Sustained Burn", "Blowoff"];
const HEIGHTS = [0.06, 1.75, 0.6];
const FLOW_MIN = 0.5, FLOW_MAX = 24, O2_MIN = 13, O2_MAX = 35;
const W = 16, D = 12;

function textSprite(text: string, color = "#dbe3f0", size = 44): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.font = `600 ${size}px ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(5.4, 1.0, 1);
  return s;
}

const fx = (flow: number) => ((flow - FLOW_MIN) / (FLOW_MAX - FLOW_MIN) - 0.5) * W;
const fz = (o2: number) => ((o2 - O2_MIN) / (O2_MAX - O2_MIN) - 0.5) * D;

export default function BoundaryScene({ heightClass = "h-[360px]" }: { heightClass?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [material, setMaterial] = useState("PMMA");
  const [pressure, setPressure] = useState(14.7);
  const [o2, setO2] = useState(21.0);
  const [flow, setFlow] = useState(7.5);
  const [grid, setGrid] = useState<any>(null);
  const [evalr, setEvalr] = useState<any>(null);
  const [atmo, setAtmo] = useState<any>(null);
  const stateRef = useRef({ o2, flow, evalr });
  const surfaceRef = useRef<THREE.Mesh | null>(null);
  const wireRef = useRef<THREE.LineSegments | null>(null);
  const probeRef = useRef<THREE.Group | null>(null);
  const beaconGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => { stateRef.current = { o2, flow, evalr }; }, [o2, flow, evalr]);

  useEffect(() => {
    let live = true;
    api.boundarySurface(material, pressure, 30).then((g) => live && setGrid(g)).catch(() => {});
    return () => { live = false; };
  }, [material, pressure]);

  useEffect(() => {
    api.atmospheres().then(setAtmo).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.twinEvaluate({ material, o2_pct: o2, flow_cms: flow, pressure_psi: pressure })
        .then(setEvalr).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [material, o2, flow, pressure]);

  const handleRef = useThreeScene(mountRef, ({ scene }) => {
    scene.add(new THREE.AmbientLight(0x33415e, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(8, 14, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x22d3ee, 0.5);
    fill.position.set(-10, 4, -8);
    scene.add(fill);

    const gridHelper = new THREE.GridHelper(20, 20, 0x1c2a4a, 0x131d36);
    gridHelper.position.y = -0.02;
    scene.add(gridHelper);

    // Axis labels.
    const xl = textSprite("AIRFLOW  cm/s →", "#8b99b5", 40);
    xl.position.set(0, 0.05, D / 2 + 1.4);
    scene.add(xl);
    const zl = textSprite("O₂ % →", "#67e8f9", 40);
    zl.position.set(-W / 2 - 1.8, 0.05, 0);
    scene.add(zl);
    const yl = textSprite("FLAMMABILITY", "#f59e0b", 36);
    yl.position.set(W / 2 + 1.6, 2.2, -D / 2);
    yl.scale.set(4.6, 0.86, 1);
    scene.add(yl);

    // Probe marker.
    const probe = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    stem.position.y = -0.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1;
    probe.add(ball, stem, ring);
    scene.add(probe);
    probeRef.current = probe;

    const beacons = new THREE.Group();
    scene.add(beacons);
    beaconGroupRef.current = beacons;

    return (_dt: number, t: number) => {
      const s = stateRef.current;
      if (probeRef.current) {
        const regime = s.evalr?.regime || "Sustained Burn";
        const h = HEIGHTS[REGIMES.indexOf(regime)] ?? 1;
        probeRef.current.position.set(fx(s.flow), h + 0.55 + Math.sin(t * 2.4) * 0.06, fz(s.o2));
        const col = REGIME_HEX[regime] ?? 0xffffff;
        (ball.material as THREE.MeshStandardMaterial).emissive.setHex(col);
        (ring.material as THREE.MeshBasicMaterial).color.setHex(col);
        ring.scale.setScalar(1 + 0.15 * Math.sin(t * 3));
      }
    };
  }, { cameraPos: [13, 10, 15], target: [0, 0.6, 0], minDist: 8, maxDist: 45 }, []);

  // Rebuild the regime surface whenever the grid changes.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !grid) return;
    const { scene } = h;
    if (surfaceRef.current) { scene.remove(surfaceRef.current); surfaceRef.current.geometry.dispose(); (surfaceRef.current.material as THREE.Material).dispose(); }
    if (wireRef.current) { scene.remove(wireRef.current); wireRef.current.geometry.dispose(); (wireRef.current.material as THREE.Material).dispose(); }

    const Z: number[][] = grid.boundary_grid;
    const nO2 = Z.length, nFlow = Z[0].length;
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const heightAt = (i: number, j: number) => {
      const v = Z[i][j];
      let sum = HEIGHTS[v], count = 1, boundary = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && ni < nO2 && nj >= 0 && nj < nFlow) {
          sum += HEIGHTS[Z[ni][nj]]; count++;
          if (Z[ni][nj] !== v) boundary = true;
        }
      }
      return boundary ? (sum / count) * 0.82 : HEIGHTS[v];
    };
    const cTmp = new THREE.Color();
    for (let i = 0; i < nO2; i++) {
      for (let j = 0; j < nFlow; j++) {
        const o2v = grid.o2_values[i], fv = grid.flow_values[j];
        positions.push(fx(fv), heightAt(i, j), fz(o2v));
        cTmp.setHex(REGIME_HEX[REGIMES[Z[i][j]]]);
        colors.push(cTmp.r, cTmp.g, cTmp.b);
      }
    }
    for (let i = 0; i < nO2 - 1; i++) {
      for (let j = 0; j < nFlow - 1; j++) {
        const a = i * nFlow + j, b = a + 1, c = a + nFlow, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.15, roughness: 0.5, transparent: true, opacity: 0.92,
      emissive: 0xffffff, emissiveIntensity: 0.06, side: THREE.DoubleSide,
    }));
    scene.add(surface);
    surfaceRef.current = surface;
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 }));
    scene.add(wire);
    wireRef.current = wire;
  }, [grid, handleRef]);

  // Exploration-atmosphere beacons.
  useEffect(() => {
    const h = handleRef.current;
    const g = beaconGroupRef.current;
    if (!h || !g || !atmo) return;
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
      ((c as THREE.Mesh).material as THREE.Material)?.dispose?.();
    }
    const entries: [string, any, number][] = [
      ["ISS", atmo.ISS_Standard, 0x22d3ee],
      ["GATEWAY", atmo.Exploration_Gateway, 0xf59e0b],
      ["LUNAR", atmo.Lunar_EVA, 0xe879f9],
      ["MARS", atmo.Mars_Habitat, 0x4ade80],
    ];
    for (const [name, a, color] of entries) {
      if (!a) continue;
      const x = fx(5), z = fz(a.o2_pct);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }));
      pin.position.set(x, 1.3, z);
      g.add(pin);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12),
        new THREE.MeshBasicMaterial({ color }));
      tip.position.set(x, 2.6, z);
      g.add(tip);
      const label = textSprite(`${name} ${a.o2_pct}%`, `#${color.toString(16).padStart(6, "0")}`, 40);
      label.position.set(x, 3.1, z);
      label.scale.set(3.4, 0.64, 1);
      g.add(label);
    }
  }, [atmo, handleRef]);

  const regime = evalr?.regime || "—";
  const probs = evalr?.probabilities || {};
  const pm = evalr?.physics_metrics || {};

  return (
    <div className="space-y-2.5">
      <div className={`relative overflow-hidden rounded-xl border border-line bg-void-950 ${heightClass}`}>
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-void-900/85 px-2.5 py-1.5 text-[10px] backdrop-blur">
          <span className="text-mist-500">3-REGIME BOUNDARY · </span>
          <span className="font-bold text-mist-200">{material}</span>
          <span className="ml-1 font-mono text-mist-400">{pressure.toFixed(1)} psi</span>
        </div>
        {evalr && (
          <div className="pointer-events-none absolute right-3 top-3 w-44 rounded-lg border border-line bg-void-900/90 p-2.5 backdrop-blur">
            <div className="mb-1.5 text-[11px] font-bold" style={{ color: `#${(REGIME_HEX[regime] ?? 0xffffff).toString(16).padStart(6, "0")}` }}>
              {regime}
            </div>
            {REGIMES.map((r) => (
              <div key={r} className="mb-1">
                <div className="flex justify-between text-[8px] text-mist-500">
                  <span>{r}</span><span className="font-mono">{((probs[r] ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded bg-void-700">
                  <div className="h-full rounded transition-all duration-300" style={{ width: `${(probs[r] ?? 0) * 100}%`, background: `#${REGIME_HEX[r].toString(16).padStart(6, "0")}` }} />
                </div>
              </div>
            ))}
            <div className="mt-1.5 grid grid-cols-2 gap-x-2 border-t border-line pt-1.5 font-mono text-[8px] text-mist-400">
              <span>Da {pm.damkohler_proxy ?? "—"}</span>
              <span>Qrad {pm.radiative_loss_index ?? "—"}</span>
              <span className="col-span-2">T_flame {pm.estimated_flame_temp_C ?? "—"}°C</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-3 flex gap-2 text-[8px] text-mist-400">
          {REGIMES.map((r) => (
            <span key={r} className="flex items-center gap-1 rounded bg-void-900/80 px-1.5 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: `#${REGIME_HEX[r].toString(16).padStart(6, "0")}` }} />{r}
            </span>
          ))}
        </div>
      </div>

      {/* Always-visible live controls */}
      <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-line bg-void-900/60 p-3 lg:grid-cols-4">
        <label className="block">
          <span className="label !mb-1 !text-[9px]">Material</span>
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="input !py-1.5 text-xs">
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Cabin pressure</span><span className="font-mono text-ion-300">{pressure.toFixed(1)} psi</span></span>
          <input type="range" min={8} max={15} step={0.1} value={pressure} onChange={(e) => setPressure(parseFloat(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Oxygen</span><span className="font-mono text-ion-300">{o2.toFixed(1)}%</span></span>
          <input type="range" min={O2_MIN} max={O2_MAX} step={0.1} value={o2} onChange={(e) => setO2(parseFloat(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Airflow</span><span className="font-mono text-ember-400">{flow.toFixed(1)} cm/s</span></span>
          <input type="range" min={0.3} max={26} step={0.1} value={flow} onChange={(e) => setFlow(parseFloat(e.target.value))} className="w-full" />
        </label>
        <div className="col-span-2 flex items-center gap-2 lg:col-span-4">
          {[["ISS", 21, 14.7], ["Gateway", 32, 10.2], ["Lunar EVA", 34, 8.2], ["Mars", 28, 9.5]].map(([n, oo, pp]) => (
            <button key={n as string} type="button" onClick={() => { setO2(oo as number); setPressure(pp as number); }}
              className="chip !px-2 !py-1 text-[9px] hover:!border-ion-400/60 hover:!text-ion-300">
              {n}
            </button>
          ))}
          <button type="button" onClick={() => { setO2(21); setFlow(7.5); setPressure(14.7); setMaterial("PMMA"); }}
            className="chip ml-auto !px-2 !py-1 text-[9px] hover:!border-ember-400/60 hover:!text-ember-300">
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}