"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useThreeScene, glowTexture, starField } from "@/lib/useThree";
import { ShieldCheck, ShieldOff, MousePointer2 } from "lucide-react";

type Props = {
  snapshot: any;
  pickMode?: boolean;
  onPick?: (id: string) => void;
  heightClass?: string;
};

type CompartmentFX = {
  id: string;
  group: THREE.Group;
  body: THREE.Mesh;
  baseEmissive: number;
  flames: THREE.Sprite[];
  fireLight: THREE.PointLight;
  smoke: THREE.Sprite[];
  mist: THREE.Points;
  mistSeed: Float32Array;
  center: THREE.Vector3;
  radius: number;
};

const LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  NODE1: { x: 30, y: 24, w: 14, h: 14 }, NODE2: { x: 46, y: 24, w: 14, h: 14 },
  NODE3: { x: 30, y: 40, w: 14, h: 14 }, USLAB: { x: 46, y: 8, w: 20, h: 14 },
  COL: { x: 62, y: 24, w: 16, h: 14 }, JEM: { x: 46, y: 40, w: 20, h: 14 },
  QUEST: { x: 14, y: 24, w: 14, h: 14 }, CUPOLA: { x: 30, y: 8, w: 12, h: 12 },
};
const ADJ: Record<string, string[]> = {
  NODE1: ["QUEST", "NODE2", "NODE3", "CUPOLA"], NODE2: ["NODE1", "USLAB", "COL"],
  NODE3: ["NODE1", "JEM"], USLAB: ["NODE2", "CUPOLA"], COL: ["NODE2", "JEM"],
  JEM: ["NODE3", "COL"], QUEST: ["NODE1"], CUPOLA: ["NODE1", "USLAB"],
};
const NAMES: Record<string, string> = {
  NODE1: "Node 1 · Unity", NODE2: "Node 2 · Harmony", NODE3: "Node 3 · Tranquility",
  USLAB: "US Lab · Destiny", COL: "Columbus · ESA", JEM: "Kibo · JAXA",
  QUEST: "Quest Airlock", CUPOLA: "Cupola · Obs",
};

function pos3(id: string): THREE.Vector3 {
  const l = LAYOUT[id];
  return new THREE.Vector3((l.x + l.w / 2 - 46) * 0.42, 0, (l.y + l.h / 2 - 28) * 0.42);
}

function solarTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#081c3d";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 1.4;
  for (let x = 0; x <= 256; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  for (let y = 0; y <= 128; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  const g = ctx.createLinearGradient(0, 0, 256, 128);
  g.addColorStop(0, "rgba(59,130,246,0.25)");
  g.addColorStop(0.5, "rgba(8,28,61,0)");
  g.addColorStop(1, "rgba(34,211,238,0.18)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function earthTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const ctx = c.getContext("2d")!;
  const ocean = ctx.createLinearGradient(0, 0, 0, 256);
  ocean.addColorStop(0, "#0a2e6e"); ocean.addColorStop(0.5, "#0d3f8f"); ocean.addColorStop(1, "#082452");
  ctx.fillStyle = ocean; ctx.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512, y = 40 + rnd() * 176, r = 12 + rnd() * 42;
    ctx.fillStyle = i % 3 ? "rgba(34,120,70,0.55)" : "rgba(150,120,70,0.4)";
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const rr = r * (0.6 + rnd() * 0.7);
      const px = x + Math.cos(a) * rr * 1.7, py = y + Math.sin(a) * rr * 0.8;
      a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 512, y = rnd() * 256;
    ctx.beginPath(); ctx.ellipse(x, y, 18 + rnd() * 40, 3 + rnd() * 6, rnd() * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(240,248,255,0.85)";
  ctx.fillRect(0, 0, 512, 14); ctx.fillRect(0, 242, 512, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function StationScene({ snapshot, pickMode, onPick, heightClass = "h-[420px]" }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<any>(snapshot);
  const pickRef = useRef({ pickMode, onPick });
  const fxRef = useRef<Map<string, CompartmentFX>>(new Map());
  const hoverRef = useRef<string | null>(null);
  const blockFlashRef = useRef<{ id: string; start: number } | null>(null);
  const lastBlockWallRef = useRef<string | null>(null);
  const shieldRef = useRef<THREE.Mesh | null>(null);
  const waveRef = useRef<THREE.Mesh | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; id: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { dataRef.current = snapshot; }, [snapshot]);
  useEffect(() => { pickRef.current = { pickMode, onPick }; }, [pickMode, onPick]);

  useThreeScene(mountRef, ({ scene, camera, renderer }) => {
    scene.fog = new THREE.FogExp2(0x05070f, 0.008);
    scene.add(starField(1100, 240));

    // Lighting: cold space ambient + warm sun key + cyan earthshine fill.
    scene.add(new THREE.AmbientLight(0x22304d, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
    sun.position.set(30, 24, 14);
    scene.add(sun);
    const earthshine = new THREE.DirectionalLight(0x3b82f6, 0.7);
    earthshine.position.set(-10, -20, -6);
    scene.add(earthshine);
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.5);
    rim.position.set(-24, 8, -18);
    scene.add(rim);

    // Earth below the station.
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(46, 48, 48),
      new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9, metalness: 0 })
    );
    earth.position.set(6, -62, -10);
    scene.add(earth);
    const atmo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture("rgba(96,165,250,0.55)"), transparent: true, opacity: 0.5, depthWrite: false,
    }));
    atmo.scale.set(112, 112, 1);
    atmo.position.copy(earth.position);
    scene.add(atmo);

    const station = new THREE.Group();
    scene.add(station);

    const hullMat = new THREE.MeshStandardMaterial({ color: 0xcdd6e4, metalness: 0.55, roughness: 0.38, emissive: 0x0a1424, emissiveIntensity: 0.4 });
    const foilMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.85, roughness: 0.3 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.2 });

    const flameTex = glowTexture("rgba(255,214,120,1)");
    const flameTexHot = glowTexture("rgba(255,120,40,1)");
    const smokeTex = glowTexture("rgba(148,163,184,0.9)");
    const mistTex = glowTexture("rgba(103,232,249,1)");

    const fxMap = fxRef.current;
    fxMap.clear();
    const pickables: THREE.Mesh[] = [];

    const buildModule = (id: string) => {
      const p = pos3(id);
      const group = new THREE.Group();
      group.position.copy(p);
      let body: THREE.Mesh;
      let radius = 1.6;
      if (id.startsWith("NODE")) {
        body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 28, 28), hullMat.clone());
        radius = 1.5;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.07, 10, 40), foilMat);
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      } else if (id === "CUPOLA") {
        body = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), hullMat.clone());
        body.rotation.x = Math.PI;
        body.position.y = 0.4;
        radius = 1.2;
        const win = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), windowMat);
        win.rotation.x = Math.PI / 2;
        win.position.y = -0.78;
        group.add(win);
      } else {
        const len = id === "USLAB" || id === "JEM" ? 5.2 : id === "COL" ? 4.2 : 3.2;
        const r = id === "USLAB" ? 1.6 : id === "QUEST" ? 1.15 : 1.45;
        body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 28), hullMat.clone());
        body.rotation.z = Math.PI / 2;
        radius = Math.max(r, len / 2.4);
        for (const off of [-len / 3, len / 3]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.06, 8, 36), foilMat);
          band.rotation.y = Math.PI / 2;
          band.position.x = off;
          group.add(band);
        }
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.1, 0.1), windowMat);
        strip.position.set(0, r * 0.72, r * 0.72);
        group.add(strip);
      }
      body.userData.cid = id;
      group.add(body);
      pickables.push(body);

      // Fire sprites (microgravity: spherical, no buoyant teardrop).
      const flames: THREE.Sprite[] = [];
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: i % 2 ? flameTex : flameTexHot, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        s.userData.seed = Math.random() * 10;
        s.userData.off = new THREE.Vector3((Math.random() - 0.5) * radius, (Math.random() - 0.5) * radius * 0.7, (Math.random() - 0.5) * radius);
        group.add(s);
        flames.push(s);
      }
      const fireLight = new THREE.PointLight(0xff7b2d, 0, 12, 1.8);
      group.add(fireLight);

      // Smoke drifts outward spherically in 0-g (no rising plume).
      const smoke: THREE.Sprite[] = [];
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
        s.userData.dir = new THREE.Vector3().randomDirection();
        s.userData.seed = Math.random() * 10;
        group.add(s);
        smoke.push(s);
      }

      // Suppression mist particles.
      const N = 70;
      const mistPos = new Float32Array(N * 3);
      const mistSeed = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.random() * radius * 1.4);
        mistPos.set([v.x, v.y, v.z], i * 3);
        mistSeed.set([Math.random() * 10, Math.random() * 10, Math.random() * 10], i * 3);
      }
      const mistGeo = new THREE.BufferGeometry();
      mistGeo.setAttribute("position", new THREE.BufferAttribute(mistPos, 3));
      const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({
        map: mistTex, color: 0x67e8f9, size: 0.34, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      group.add(mist);

      station.add(group);
      fxMap.set(id, { id, group, body, baseEmissive: 0.4, flames, fireLight, smoke, mist, mistSeed, center: p.clone(), radius });
    };

    Object.keys(LAYOUT).forEach(buildModule);

    // Pressurized corridors between adjacent modules.
    const seen = new Set<string>();
    for (const [a, neighbors] of Object.entries(ADJ)) {
      for (const b of neighbors) {
        const key = [a, b].sort().join("-");
        if (seen.has(key)) continue;
        seen.add(key);
        const pa = pos3(a), pb = pos3(b);
        const dir = pb.clone().sub(pa);
        const len = dir.length();
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 14), hullMat.clone());
        tube.position.copy(pa).add(pb).multiplyScalar(0.5);
        tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        station.add(tube);
      }
    }

    // Truss + solar arrays.
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 22), foilMat);
    truss.position.copy(pos3("NODE1")).add(new THREE.Vector3(-1.5, 0.9, 0));
    station.add(truss);
    const panelMat = new THREE.MeshStandardMaterial({ map: solarTexture(), metalness: 0.4, roughness: 0.5, emissive: 0x1d4ed8, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    for (const zOff of [-8.5, -4.5, 4.5, 8.5]) {
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 7.5), panelMat);
        panel.position.copy(truss.position).add(new THREE.Vector3(side * 2.1, 0, zOff));
        panel.rotation.x = -Math.PI / 2;
        panel.rotation.z = side * 0.06;
        station.add(panel);
      }
    }

    // Prevention shield: green scanning torus around the whole station.
    const shield = new THREE.Mesh(
      new THREE.TorusGeometry(13.5, 0.06, 8, 120),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.y = 0.2;
    scene.add(shield);
    shieldRef.current = shield;

    // Ignition-blocked shockwave.
    const wave = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true })
    );
    wave.visible = false;
    scene.add(wave);
    waveRef.current = wave;

    // Pointer interaction.
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const el = renderer.domElement;
    const toNDC = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onMove = (e: PointerEvent) => {
      toNDC(e);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      const id = hit ? (hit.object.userData.cid as string) : null;
      hoverRef.current = id;
      el.style.cursor = id ? (pickRef.current.pickMode ? "crosshair" : "pointer") : "grab";
      if (id) {
        const r = el.getBoundingClientRect();
        setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top, id });
      } else setTooltip(null);
    };
    const onClick = (e: PointerEvent) => {
      toNDC(e);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      if (hit && pickRef.current.pickMode && pickRef.current.onPick) {
        pickRef.current.onPick(hit.object.userData.cid as string);
      }
    };
    const onLeave = () => { hoverRef.current = null; setTooltip(null); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onClick);
    el.addEventListener("pointerleave", onLeave);

    setReady(true);

    return (dt: number, t: number) => {
      const snap = dataRef.current;
      const fire = snap?.fire_state || {};
      const comps = fire.compartments || {};
      const sup = fire.suppression || {};
      const prev = snap?.prevention || {};
      earth.rotation.y += dt * 0.008;

      // Shield state.
      if (shieldRef.current) {
        const m = shieldRef.current.material as THREE.MeshBasicMaterial;
        if (prev.armed) {
          shieldRef.current.visible = true;
          shieldRef.current.rotation.z += dt * 0.25;
          const risk = prev.risk?.score ?? 0;
          m.color.setHex(risk >= 0.7 ? 0xfbbf24 : 0x4ade80);
          m.opacity = 0.3 + 0.2 * Math.sin(t * 2.2) + risk * 0.15;
        } else {
          shieldRef.current.visible = false;
        }
      }

      // Detect a fresh ignition block -> green shockwave at that compartment.
      const lb = prev.last_block;
      if (lb?.wall && lb.wall !== lastBlockWallRef.current) {
        lastBlockWallRef.current = lb.wall;
        blockFlashRef.current = { id: lb.compartment, start: t };
      }
      if (waveRef.current) {
        const flash = blockFlashRef.current;
        if (flash && t - flash.start < 1.6) {
          const fx = fxMap.get(flash.id);
          if (fx) {
            const k = (t - flash.start) / 1.6;
            waveRef.current.visible = true;
            waveRef.current.position.copy(fx.center);
            waveRef.current.scale.setScalar(0.5 + k * fx.radius * 4);
            (waveRef.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
          }
        } else waveRef.current.visible = false;
      }

      fxMap.forEach((fx, id) => {
        const c = comps[id] || { intensity: 0, smoke: 0, on_fire: false };
        const intensity = c.intensity || 0;
        const hovered = hoverRef.current === id;
        const mat = fx.body.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = fx.baseEmissive + (hovered ? 0.9 : 0) + intensity * 1.4;
        mat.emissive.setHex(intensity > 0.02 ? 0xff5a1f : hovered ? 0x22d3ee : 0x0a1424);

        // Spherical flickering flame.
        for (const s of fx.flames) {
          const seed = s.userData.seed as number;
          const flick = 0.75 + 0.25 * Math.sin(t * 9 + seed) * Math.sin(t * 5.3 + seed * 2);
          const scale = intensity * fx.radius * (1.1 + 0.5 * flick);
          s.scale.setScalar(Math.max(0.001, scale));
          const off = s.userData.off as THREE.Vector3;
          s.position.set(off.x * (0.6 + intensity), off.y * (0.6 + intensity), off.z * (0.6 + intensity));
          (s.material as THREE.SpriteMaterial).opacity = Math.min(0.95, intensity * 1.6) * flick;
        }
        fx.fireLight.intensity = intensity * 14 * (0.8 + 0.2 * Math.sin(t * 11));

        // Smoke expands spherically (0-g), suppressed mist swirls.
        for (const s of fx.smoke) {
          const seed = s.userData.seed as number;
          const dir = s.userData.dir as THREE.Vector3;
          const drift = ((t * 0.22 + seed) % 2.4) / 2.4;
          const sm = c.smoke || 0;
          s.position.copy(dir).multiplyScalar(fx.radius * (0.5 + drift * 2.2));
          s.scale.setScalar(fx.radius * (0.7 + drift * 1.6));
          (s.material as THREE.SpriteMaterial).opacity = sm * 0.4 * (1 - drift);
        }
        const mistMat = fx.mist.material as THREE.PointsMaterial;
        const mistOn = sup.active ? 1 : 0;
        mistMat.opacity += (mistOn * 0.85 - mistMat.opacity) * Math.min(1, dt * 4);
        if (mistMat.opacity > 0.01) {
          const attr = fx.mist.geometry.getAttribute("position") as THREE.BufferAttribute;
          const arr = attr.array as Float32Array;
          for (let i = 0; i < arr.length / 3; i++) {
            const sx = fx.mistSeed[i * 3], sy = fx.mistSeed[i * 3 + 1];
            arr[i * 3] += Math.sin(t * 1.4 + sx) * dt * 0.5;
            arr[i * 3 + 1] += Math.cos(t * 1.1 + sy) * dt * 0.5;
            arr[i * 3 + 2] += Math.sin(t * 0.9 + sx + sy) * dt * 0.5;
            const v = new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
            if (v.length() > fx.radius * 1.7) v.setLength(fx.radius * 0.4);
            arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
          }
          attr.needsUpdate = true;
        }
      });
    };
  }, { cameraPos: [17, 12, 19], autoRotate: true, minDist: 8, maxDist: 70 }, []);

  const prev = snapshot?.prevention;
  const fire = snapshot?.fire_state || {};
  const comps = fire.compartments || {};
  const hoveredComp = tooltip ? comps[tooltip.id] : null;
  const burning = Object.values(comps).filter((c: any) => c?.on_fire).length;

  return (
    <div className={`relative overflow-hidden rounded-xl border border-line bg-void-950 ${heightClass}`}>
      <div ref={mountRef} className="absolute inset-0" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-xs text-mist-500">Initializing 3D station…</div>}

      {/* Top-left status */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
        <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold backdrop-blur ${
          prev?.armed ? "border-pulse-500/50 bg-pulse-500/10 text-pulse-400" : "border-flame-500/50 bg-flame-500/10 text-flame-400"
        }`}>
          {prev?.armed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
          PREVENTION {prev?.armed ? "ARMED" : "STOOD DOWN"}
        </div>
        <div className="rounded-lg border border-line bg-void-900/80 px-2.5 py-1.5 text-[10px] text-mist-300 backdrop-blur">
          <span className="font-mono font-bold" style={{ color: burning ? "rgb(var(--c-danger))" : "rgb(var(--c-ok))" }}>
            {burning ? `${burning} MODULE${burning > 1 ? "S" : ""} BURNING` : "NO FIRE"}
          </span>
          {fire.suppression?.active && <span className="ml-2 text-ion-300">· MIST ACTIVE</span>}
        </div>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[9px] text-mist-400">
        {[
          ["#fb923c", "Flame (0-g spherical)"],
          ["#94a3b8", "Smoke drift"],
          ["#67e8f9", "Suppression mist"],
          ["#4ade80", "Prevention shield"],
        ].map(([c, label]) => (
          <span key={label} className="flex items-center gap-1 rounded bg-void-900/80 px-1.5 py-0.5 backdrop-blur">
            <span className="h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
            {label}
          </span>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded bg-void-900/80 px-2 py-1 text-[9px] text-mist-500 backdrop-blur">
        <MousePointer2 className="h-3 w-3" /> drag orbit · wheel zoom{pickMode ? " · click module to ignite" : ""}
      </div>

      {pickMode && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <div className="mt-3 animate-pulse rounded-lg border border-ember-500/60 bg-ember-500/15 px-3 py-1.5 text-[11px] font-bold text-ember-300 backdrop-blur">
            Pick the ignition compartment
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-lg border border-line-bright bg-void-900/95 p-2.5 text-[10px] shadow-panel backdrop-blur"
          style={{ left: Math.min(tooltip.x + 14, (mountRef.current?.clientWidth || 300) - 190), top: Math.max(8, tooltip.y - 60) }}
        >
          <div className="mb-1 font-bold text-mist-100">{NAMES[tooltip.id] || tooltip.id}</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-mist-400">
            <span>Intensity</span><span className="text-right text-ember-400">{(hoveredComp?.intensity ?? 0).toFixed(2)}</span>
            <span>Temp</span><span className="text-right text-ion-300">{(hoveredComp?.temp_C ?? 22).toFixed(0)}°C</span>
            <span>Smoke</span><span className="text-right text-mist-300">{(hoveredComp?.smoke ?? 0).toFixed(2)}</span>
            <span>Status</span>
            <span className="text-right font-bold" style={{ color: hoveredComp?.on_fire ? "rgb(var(--c-danger))" : "rgb(var(--c-ok))" }}>
              {hoveredComp?.on_fire ? "FIRE" : "SAFE"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}