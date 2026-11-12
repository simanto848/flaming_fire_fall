"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type SceneHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
};

/** Shared Three.js lifecycle: capped DPR, damped orbit controls, resize observer,
 *  one RAF loop, full disposal on unmount. The animate callback drives everything. */
export function useThreeScene(
  mountRef: React.RefObject<HTMLDivElement | null>,
  build: (h: SceneHandle) => (dt: number, t: number) => void,
  opts: { cameraPos?: [number, number, number]; target?: [number, number, number]; autoRotate?: boolean; minDist?: number; maxDist?: number } = {},
  deps: unknown[] = []
) {
  const handleRef = useRef<SceneHandle | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 600);
    camera.position.set(...(opts.cameraPos ?? [16, 11, 18]));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(...(opts.target ?? [0, 0, 0]));
    controls.minDistance = opts.minDist ?? 6;
    controls.maxDistance = opts.maxDist ?? 90;
    controls.autoRotate = opts.autoRotate ?? false;
    controls.autoRotateSpeed = 0.5;
    controls.maxPolarAngle = Math.PI * 0.92;

    const handle: SceneHandle = { scene, camera, renderer, controls };
    handleRef.current = handle;
    const animate = build(handle);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;
    let disposed = false;
    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      animate(dt, clock.elapsedTime);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.renderLists.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return handleRef;
}

/** Radial-gradient sprite texture used for glows, flames, mist and stars. */
export function glowTexture(inner: string, outer = "rgba(0,0,0,0)", size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, inner.replace(/[\d.]+\)$/, "0.45)"));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function starField(count = 900, radius = 220): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.6 + Math.random() * 0.4));
    pos.set([v.x, v.y, v.z], i * 3);
    const warm = Math.random();
    const b = 0.5 + Math.random() * 0.5;
    col.set([b, b * (0.85 + warm * 0.15), b * (0.8 + (1 - warm) * 0.2)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true, depthWrite: false });
  return new THREE.Points(geo, mat);
}

export const REGIME_HEX: Record<string, number> = {
  "Sustained Burn": 0xf59e0b,
  "Radiative Extinction": 0x22d3ee,
  Blowoff: 0xe879f9,
};