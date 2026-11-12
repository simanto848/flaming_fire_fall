"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThreeScene, glowTexture, REGIME_HEX } from "@/lib/useThree";
import { api } from "@/lib/api";

const MATERIALS = ["PMMA", "Nomex", "Cotton-Fiber Blend"];

export default function FlameChamber({ heightClass = "h-[360px]" }: { heightClass?: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [material, setMaterial] = useState("PMMA");
  const [o2, setO2] = useState(21.0);
  const [flow, setFlow] = useState(5.0);
  const [pressure, setPressure] = useState(14.7);
  const [evalr, setEvalr] = useState<any>(null);
  const stateRef = useRef({ o2, flow, evalr });
  const flameRef = useRef<THREE.Group | null>(null);
  const coreRef = useRef<THREE.Mesh | null>(null);
  const glowsRef = useRef<THREE.Sprite[]>([]);
  const sampleRef = useRef<THREE.Group | null>(null);
  const flowPtsRef = useRef<THREE.Points | null>(null);
  const animRef = useRef({ scale: 1, opacity: 1, stretch: 1, offset: 0 });

  useEffect(() => { stateRef.current = { o2, flow, evalr }; }, [o2, flow, evalr]);

  useEffect(() => {
    const t = setTimeout(() => {
      api.twinEvaluate({ material, o2_pct: o2, flow_cms: flow, pressure_psi: pressure })
        .then(setEvalr).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [material, o2, flow, pressure]);

  // Swap the fuel sample geometry when material changes.
  useEffect(() => {
    const g = sampleRef.current;
    if (!g) return;
    while (g.children.length) {
      const c = g.children[0] as THREE.Mesh;
      g.remove(c);
      c.geometry?.dispose();
      (c.material as THREE.Material)?.dispose?.();
    }
    const mat = new THREE.MeshStandardMaterial({
      color: material === "PMMA" ? 0xe8edf5 : material === "Nomex" ? 0xd4a017 : 0xf5f0e6,
      roughness: material === "PMMA" ? 0.15 : 0.8,
      metalness: 0.05,
      transparent: material === "PMMA",
      opacity: material === "PMMA" ? 0.85 : 1,
    });
    let mesh: THREE.Mesh;
    if (material === "PMMA") mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.2, 24), mat);
    else if (material === "Nomex") mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.9, 0.12), mat);
    else mesh = new THREE.Mesh(new THREE.SphereGeometry(0.65, 24, 24), mat);
    g.add(mesh);
  }, [material]);

  useThreeScene(mountRef, ({ scene }) => {
    scene.add(new THREE.AmbientLight(0x2a3a5c, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(6, 8, 8);
    scene.add(key);
    const flameLight = new THREE.PointLight(0xff9d3c, 2, 14, 1.6);
    flameLight.position.set(0, 0.4, 0);
    scene.add(flameLight);

    // Combustion chamber: glass cylinder + metal end caps.
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 5.4, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.06, metalness: 0.1, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    scene.add(glass);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x3a4a6b, metalness: 0.8, roughness: 0.3 });
    for (const y of [-2.7, 2.7]) {
      const cap = new THREE.Mesh(new THREE.TorusGeometry(3, 0.14, 12, 48), capMat);
      cap.rotation.x = Math.PI / 2;
      cap.position.y = y;
      scene.add(cap);
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 20), capMat);
      port.position.set(y > 0 ? 2.4 : -2.4, y * 0.92, 0);
      port.rotation.z = Math.PI / 2;
      scene.add(port);
    }
    // Sample mount rod.
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 10), capMat);
    rod.position.y = -1.9;
    scene.add(rod);

    const sample = new THREE.Group();
    scene.add(sample);
    sampleRef.current = sample;

    // Spherical microgravity flame: emissive core + layered additive glows.
    const flame = new THREE.Group();
    flame.position.y = 0.3;
    scene.add(flame);
    flameRef.current = flame;
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 3),
      new THREE.MeshBasicMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.add(core);
    coreRef.current = core;
    const glowTexBlue = glowTexture("rgba(147,197,253,1)");
    const glowTexWarm = glowTexture("rgba(255,180,84,1)");
    const glows: THREE.Sprite[] = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: i < 2 ? glowTexBlue : glowTexWarm, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.scale.setScalar(1.6 + i * 0.7);
      flame.add(s);
      glows.push(s);
    }
    glowsRef.current = glows;

    // Flow streamlines (forced ventilation, left → right).
    const N = 140;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 7;
      const r = Math.sqrt(Math.random()) * 2.6;
      const a = Math.random() * Math.PI * 2;
      pos[i * 3 + 1] = Math.cos(a) * r * 0.8;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const flowPts = new THREE.Points(fgeo, new THREE.PointsMaterial({
      color: 0x93c5fd, size: 0.07, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    scene.add(flowPts);
    flowPtsRef.current = flowPts;

    return (dt: number, t: number) => {
      const s = stateRef.current;
      const regime = s.evalr?.regime || "Sustained Burn";
      const pm = s.evalr?.physics_metrics || {};
      const a = animRef.current;

      // Target flame shape per regime.
      let tScale = 1, tOpacity = 1, tStretch = 1, tOffset = 0;
      if (regime === "Radiative Extinction") { tScale = 0.22; tOpacity = 0.3; }
      else if (regime === "Blowoff") { tScale = 0.75; tOpacity = 0.55; tStretch = 2.1; tOffset = 1.4; }
      else { tScale = 0.85 + Math.min(0.6, (s.o2 - 18) * 0.04); tOpacity = 1; }
      const k = Math.min(1, dt * 3);
      a.scale += (tScale - a.scale) * k;
      a.opacity += (tOpacity - a.opacity) * k;
      a.stretch += (tStretch - a.stretch) * k;
      a.offset += (tOffset - a.offset) * k;

      // Blue diffusion flame at low O2 → warm orange when enriched.
      const warm = Math.max(0, Math.min(1, (s.o2 - 17) / 12));
      const col = new THREE.Color(0x3b82f6).lerp(new THREE.Color(0xff8c2a), warm);
      const hot = new THREE.Color(0x9cc8ff).lerp(new THREE.Color(0xffe0b0), warm);
      if (coreRef.current) {
        const flick = 1 + 0.06 * Math.sin(t * 8) * Math.sin(t * 5.1);
        coreRef.current.scale.set(a.scale * flick * (1 + (a.stretch - 1) * 0.3), a.scale * flick, a.scale * flick);
        coreRef.current.position.x = a.offset;
        (coreRef.current.material as THREE.MeshBasicMaterial).color.copy(hot);
        (coreRef.current.material as THREE.MeshBasicMaterial).opacity = 0.95 * a.opacity;
        coreRef.current.rotation.y += dt * 0.4;
      }
      glowsRef.current.forEach((g, i) => {
        const flick = 0.85 + 0.15 * Math.sin(t * 7 + i * 2.1);
        g.scale.set(a.scale * (1.7 + i * 0.75) * flick * a.stretch, a.scale * (1.7 + i * 0.75) * flick, 1);
        g.position.x = a.offset * (1 + i * 0.12);
        (g.material as THREE.SpriteMaterial).opacity = a.opacity * (0.8 - i * 0.12) * flick;
        // Inner glows follow the regime color; outer two keep a warm fire halo.
        (g.material as THREE.SpriteMaterial).color.copy(i < 2 ? col : col.clone().lerp(new THREE.Color(0xff9a3c), 0.6));
      });
      flameLight.color.copy(col);
      flameLight.intensity = a.opacity * (regime === "Sustained Burn" ? 4 : 0.8) * (0.9 + 0.1 * Math.sin(t * 9));
      flameLight.position.x = a.offset;

      // Streamlines.
      if (flowPtsRef.current) {
        const attr = flowPtsRef.current.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const speed = 0.4 + s.flow * 0.16;
        for (let i = 0; i < arr.length / 3; i++) {
          arr[i * 3] += speed * dt;
          if (arr[i * 3] > 3.6) arr[i * 3] = -3.6;
        }
        attr.needsUpdate = true;
        (flowPtsRef.current.material as THREE.PointsMaterial).opacity = Math.min(0.65, 0.1 + s.flow * 0.025);
      }
    };
  }, { cameraPos: [7.5, 3.2, 8.5], target: [0, 0.2, 0], minDist: 5, maxDist: 24 }, []);

  const regime = evalr?.regime || "—";
  const pm = evalr?.physics_metrics || {};
  const regimeColor = `#${(REGIME_HEX[regime] ?? 0x8b99b5).toString(16).padStart(6, "0")}`;

  return (
    <div className="space-y-2.5">
      <div className={`relative overflow-hidden rounded-xl border border-line bg-void-950 ${heightClass}`}>
        <div ref={mountRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-void-900/85 px-2.5 py-1.5 text-[10px] backdrop-blur">
          <span className="text-mist-500">0-g DIFFUSION FLAME · </span>
          <span className="font-bold text-mist-200">{material}</span>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-line bg-void-900/90 px-2.5 py-2 text-right backdrop-blur">
          <div className="text-[11px] font-bold" style={{ color: regimeColor }}>{regime}</div>
          <div className="mt-0.5 font-mono text-[8px] text-mist-400">
            Da {pm.damkohler_proxy ?? "—"} · Qrad {pm.radiative_loss_index ?? "—"}<br />
            T_flame {pm.estimated_flame_temp_C ?? "—"}°C
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-3 rounded bg-void-900/80 px-2 py-1 text-[8px] text-mist-500">
          No buoyancy → spherical flame fed by diffusion; forced flow stretches it toward blowoff.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-line bg-void-900/60 p-3 lg:grid-cols-4">
        <label className="block">
          <span className="label !mb-1 !text-[9px]">Fuel sample</span>
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="input !py-1.5 text-xs">
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Oxygen</span><span className="font-mono text-ion-300">{o2.toFixed(1)}%</span></span>
          <input type="range" min={13} max={100} step={0.1} value={o2} onChange={(e) => setO2(parseFloat(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Airflow</span><span className="font-mono text-ember-400">{flow.toFixed(1)} cm/s</span></span>
          <input type="range" min={0.2} max={26} step={0.1} value={flow} onChange={(e) => setFlow(parseFloat(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          <span className="label !mb-1 flex justify-between !text-[9px]"><span>Pressure</span><span className="font-mono text-pulse-400">{pressure.toFixed(1)} psi</span></span>
          <input type="range" min={4.3} max={15} step={0.1} value={pressure} onChange={(e) => setPressure(parseFloat(e.target.value))} className="w-full" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wider text-mist-500">PSI presets</span>
        <button type="button" onClick={() => { setO2(21); setFlow(5); setPressure(14.7); }}
          className="rounded-md border border-line bg-void-900/70 px-2 py-1 text-[9px] font-semibold text-mist-300 transition hover:border-ion-400/60 hover:text-ion-300">
          ISS 21% @ 14.7 psi
        </button>
        <button type="button" onClick={() => { setO2(85); setFlow(1); setPressure(14.7); }}
          title="ACME CFI-G spherical cool-flame burner operated up to 85% O2 (inside-out flames)"
          className="rounded-md border border-line bg-void-900/70 px-2 py-1 text-[9px] font-semibold text-mist-300 transition hover:border-ion-400/60 hover:text-ion-300">
          CFI-G 85% O2
        </button>
        <button type="button" onClick={() => { setO2(100); setFlow(0.5); setPressure(4.3); }}
          title="Spacesuit atmosphere: 100% O2 at 4.3 psi — extreme flammability envelope"
          className="rounded-md border border-line bg-void-900/70 px-2 py-1 text-[9px] font-semibold text-mist-300 transition hover:border-ember-400/60 hover:text-ember-300">
          Suit 100% @ 4.3 psi
        </button>
      </div>
    </div>
  );
}