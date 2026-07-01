"use client";

/**
 * Garment3DTryOn
 * ------------------------------------------------------------------
 * Real-time 3D virtual try-on built on a rigged, skinned garment mesh.
 *
 * Pipeline:
 *   1. MediaPipe Pose detects the body from the webcam (image + 3D world
 *      landmarks).
 *   2. A humanoid skeleton (THREE.Skeleton: pelvis -> chest -> shoulders,
 *      plus a swinging hem bone) is driven every frame from those landmarks.
 *   3. A volumetric garment (closed elliptical torso tube + cap sleeves) is
 *      a true THREE.SkinnedMesh bound to that skeleton, so it deforms via
 *      linear-blend skinning -- it is NOT a flat 2D overlay.
 *   4. Body orientation (yaw/turn) is recovered from the depth channel of the
 *      world landmarks, so the garment rotates and keeps correct perspective.
 *   5. The design is composited onto an opaque fabric base so the shirt is
 *      always visible and reads as printed cloth.
 *
 * This module is fully additive; it does not modify any existing component.
 */

import React, { useEffect, useRef, useState } from "react";
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import * as THREE from "three";

interface Garment3DTryOnProps {
  /** Design image (data URL or path) baked from the Studio workspace. */
  selectedImageSrc?: string | null;
}

/* ------------------------------------------------------------------ *
 * One Euro Filter — smooths noisy landmark signals while staying
 * responsive to fast motion (reduces jitter without adding lag).
 * ------------------------------------------------------------------ */
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.4, beta = 0.03, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }
  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value: number, timestampMs: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = value;
      this.tPrev = timestampMs;
      return value;
    }
    let dt = (timestampMs - this.tPrev) / 1000;
    if (dt <= 0 || !isFinite(dt)) dt = 1 / 30;
    this.tPrev = timestampMs;
    const dx = (value - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * value + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }
}

class Vec3Smoother {
  fx = new OneEuroFilter();
  fy = new OneEuroFilter();
  fz = new OneEuroFilter();
  apply(out: THREE.Vector3, t: number) {
    out.set(this.fx.filter(out.x, t), this.fy.filter(out.y, t), this.fz.filter(out.z, t));
    return out;
  }
}

/* MediaPipe Pose landmark indices. */
const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftHip: 23,
  rightHip: 24,
} as const;

/* Bone indices inside the skeleton. */
const BONE = { pelvis: 0, chest: 1, lSh: 2, rSh: 3, hem: 4 } as const;

/* Rest-pose joints (T-pose, units where shoulder span == 1.0). */
const REST = {
  pelvis: new THREE.Vector3(0, 0, 0),
  chest: new THREE.Vector3(0, 1.1, 0),
  lSh: new THREE.Vector3(0.5, 1.1, 0),
  rSh: new THREE.Vector3(-0.5, 1.1, 0),
  hem: new THREE.Vector3(0, -0.55, 0),
};

/* Garment tessellation. */
const TORSO_RINGS = 16; // vertical subdivisions
const TORSO_SEGS = 18; // around the body
const SLEEVE_RINGS = 5;
const SLEEVE_SEGS = 9;

/** Vertical profile of the torso (rest space). v: 0 = collar, 1 = hem. */
function torsoProfile(v: number) {
  // y from collar (above chest) down past the hips to the hem.
  const y = 1.32 - v * 1.92; // 1.32 .. -0.60
  // Half-width anchors across the body (X axis).
  const wAnchors = [
    [0.0, 0.3],
    [0.1, 0.52],
    [0.45, 0.4],
    [0.78, 0.37],
    [1.0, 0.42],
  ];
  let halfW = 0.4;
  for (let i = 0; i < wAnchors.length - 1; i++) {
    const [a, wa] = wAnchors[i];
    const [b, wb] = wAnchors[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      halfW = wa + (wb - wa) * t;
      break;
    }
  }
  const halfD = halfW * 0.6; // front/back depth
  return { y, halfW, halfD };
}

/** Skin weights for a torso vertex at height v (max 4 influences). */
function torsoWeights(v: number) {
  const idx = [BONE.pelvis, BONE.chest, BONE.hem, 0];
  const w = [0, 0, 0, 0];
  if (v <= 0.5) {
    const t = THREE.MathUtils.clamp((v - 0.05) / 0.5, 0, 1);
    w[1] = 1 - t; // chest
    w[0] = t; // pelvis
  } else {
    const t = THREE.MathUtils.clamp((v - 0.55) / 0.45, 0, 1);
    w[0] = 1 - t; // pelvis
    w[2] = t; // hem
  }
  const s = w[0] + w[1] + w[2] + w[3] || 1;
  return { idx, w: [w[0] / s, w[1] / s, w[2] / s, w[3] / s] };
}

/** Build the full skinned garment geometry (torso tube + two cap sleeves). */
function buildGarmentGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  // ---- Torso tube -------------------------------------------------------
  for (let i = 0; i < TORSO_RINGS; i++) {
    const v = i / (TORSO_RINGS - 1);
    const { y, halfW, halfD } = torsoProfile(v);
    const { idx, w } = torsoWeights(v);
    for (let j = 0; j <= TORSO_SEGS; j++) {
      const u = j / TORSO_SEGS;
      const ang = u * Math.PI * 2;
      const x = halfW * Math.cos(ang);
      const z = halfD * Math.sin(ang);
      positions.push(x, y, z);
      // Front centre (ang = 90deg, +z) maps to texture centre (0.5).
      uvs.push((u + 0.25) % 1, 1 - v);
      skinIndices.push(idx[0], idx[1], idx[2], idx[3]);
      skinWeights.push(w[0], w[1], w[2], w[3]);
    }
  }
  const ringStride = TORSO_SEGS + 1;
  for (let i = 0; i < TORSO_RINGS - 1; i++) {
    for (let j = 0; j < TORSO_SEGS; j++) {
      const a = i * ringStride + j;
      const b = a + 1;
      const c = a + ringStride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // ---- Cap sleeves ------------------------------------------------------
  const addSleeve = (boneIdx: number, base: THREE.Vector3, sign: number) => {
    const startVert = positions.length / 3;
    const axis = new THREE.Vector3(sign, -0.12, 0).normalize();
    const perpA = new THREE.Vector3(0, 0, 1); // front
    const perpB = new THREE.Vector3().crossVectors(axis, perpA).normalize();
    const length = 0.42;
    for (let i = 0; i < SLEEVE_RINGS; i++) {
      const t = i / (SLEEVE_RINGS - 1);
      const radius = 0.17 * (1 - 0.45 * t);
      const center = base.clone().addScaledVector(axis, length * t);
      for (let j = 0; j <= SLEEVE_SEGS; j++) {
        const ang = (j / SLEEVE_SEGS) * Math.PI * 2;
        const p = center
          .clone()
          .addScaledVector(perpB, Math.cos(ang) * radius)
          .addScaledVector(perpA, Math.sin(ang) * radius);
        positions.push(p.x, p.y, p.z);
        uvs.push(0.04, 0.96); // sample fabric-base corner of the texture
        skinIndices.push(boneIdx, 0, 0, 0);
        skinWeights.push(1, 0, 0, 0);
      }
    }
    const stride = SLEEVE_SEGS + 1;
    for (let i = 0; i < SLEEVE_RINGS - 1; i++) {
      for (let j = 0; j < SLEEVE_SEGS; j++) {
        const a = startVert + i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  };
  addSleeve(BONE.lSh, REST.lSh.clone(), 1);
  addSleeve(BONE.rSh, REST.rSh.clone(), -1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Build the skeleton with bones placed at the rest-pose joints. */
function buildSkeleton() {
  const pelvis = new THREE.Bone();
  pelvis.position.copy(REST.pelvis);
  const chest = new THREE.Bone();
  chest.position.copy(REST.chest.clone().sub(REST.pelvis));
  const lSh = new THREE.Bone();
  lSh.position.copy(REST.lSh.clone().sub(REST.chest));
  const rSh = new THREE.Bone();
  rSh.position.copy(REST.rSh.clone().sub(REST.chest));
  const hem = new THREE.Bone();
  hem.position.copy(REST.hem.clone().sub(REST.pelvis));

  pelvis.add(chest);
  pelvis.add(hem);
  chest.add(lSh);
  chest.add(rSh);

  const bones = [pelvis, chest, lSh, rSh, hem];
  const skeleton = new THREE.Skeleton(bones);
  return { skeleton, rootBone: pelvis, bones };
}

export default function Garment3DTryOn({ selectedImageSrc }: Garment3DTryOnProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshRef = useRef<THREE.SkinnedMesh | null>(null);
  const bonesRef = useRef<THREE.Bone[]>([]);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Smoothed landmark world positions.
  const sm = useRef({
    lsh: new Vec3Smoother(),
    rsh: new Vec3Smoother(),
    lhip: new Vec3Smoother(),
    rhip: new Vec3Smoother(),
    lel: new Vec3Smoother(),
    rel: new Vec3Smoother(),
  });
  const hemDirRef = useRef(new THREE.Vector3(0, -1, 0)); // lagged hem direction
  const presenceRef = useRef(0);

  // Tunables.
  const fitRef = useRef(1.12); // garment span vs shoulder span
  const lengthRef = useRef(1.0);
  const offsetRef = useRef(0.0);

  const [isReady, setIsReady] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState("Loading 3D try-on engine...");
  const [hud, setHud] = useState({ fit: 1.12, length: 1.0, offset: 0.0 });

  const VIDEO_W = 640;
  const VIDEO_H = 480;
  const FOV = 45;
  const camDist = 1 / Math.tan((FOV * Math.PI) / 180 / 2);
  const visibleH = 2;
  const visibleW = visibleH * (VIDEO_W / VIDEO_H);

  /* ---- Compose the design onto an opaque fabric base (no transparent gaps). */
  useEffect(() => {
    let cancelled = false;
    const build = async () => {
      const SZ = 512;
      const canvas = document.createElement("canvas");
      canvas.width = SZ;
      canvas.height = SZ;
      const ctx = canvas.getContext("2d")!;

      const applyTexture = () => {
        if (cancelled) return;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        textureRef.current?.dispose();
        textureRef.current = tex;
        const mat = meshRef.current?.material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          mat.map = tex;
          mat.needsUpdate = true;
        }
      };

      const src = selectedImageSrc || "/design1.png";
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Sample the dominant opaque colour for the fabric base.
        const s = document.createElement("canvas");
        s.width = 64;
        s.height = 64;
        const sc = s.getContext("2d")!;
        sc.drawImage(img, 0, 0, 64, 64);
        let r = 0, g = 0, b = 0, n = 0;
        try {
          const d = sc.getImageData(0, 0, 64, 64).data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 40) {
              r += d[i];
              g += d[i + 1];
              b += d[i + 2];
              n++;
            }
          }
        } catch {
          /* tainted canvas — fall back to default */
        }
        const base = n > 0 ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : "#cfd3da";
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, SZ, SZ);
        // Draw the design centred so the printed graphic sits on the chest.
        const scale = Math.min((SZ * 0.78) / img.width, (SZ * 0.78) / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (SZ - dw) / 2, (SZ - dh) / 2, dw, dh);
        applyTexture();
      };
      img.onerror = () => {
        ctx.fillStyle = "#cfd3da";
        ctx.fillRect(0, 0, SZ, SZ);
        applyTexture();
      };
      img.src = src;
    };
    build();
    return () => {
      cancelled = true;
    };
  }, [selectedImageSrc]);

  /* ---- One-time setup: Three.js scene + skinned garment + MediaPipe. */
  useEffect(() => {
    let active = true;
    setIsReady(false);

    async function setup() {
      try {
        const canvas = glCanvasRef.current!;
        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(VIDEO_W, VIDEO_H, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        rendererRef.current = renderer;

        const scene = new THREE.Scene();
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(FOV, VIDEO_W / VIDEO_H, 0.1, 100);
        camera.position.set(0, 0, camDist);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const key = new THREE.DirectionalLight(0xffffff, 0.75);
        key.position.set(0.4, 0.7, 1.4);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xc7d6ff, 0.3);
        rim.position.set(-0.7, 0.3, -1.0);
        scene.add(rim);

        // Skinned garment.
        const geometry = buildGarmentGeometry();
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: textureRef.current || null,
          transparent: true,
          opacity: 0,
          roughness: 0.9,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.SkinnedMesh(geometry, material);
        mesh.frustumCulled = false;
        const { skeleton, rootBone, bones } = buildSkeleton();
        mesh.add(rootBone);
        mesh.bind(skeleton);
        scene.add(mesh);
        meshRef.current = mesh;
        bonesRef.current = bones;

        setStatusText("Loading body tracking models...");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: false,
        });
        if (!active) {
          landmarker.close();
          return;
        }
        poseLandmarkerRef.current = landmarker;
        setIsReady(true);
        setStatusText("Ready! Click to start the 3D try-on.");
      } catch (err) {
        console.error("[Garment3DTryOn] setup failed", err);
        setStatusText("Failed to initialize 3D try-on engine.");
      }
    }

    setup();
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
      meshRef.current?.geometry.dispose();
      (meshRef.current?.material as THREE.Material | undefined)?.dispose?.();
      textureRef.current?.dispose();
      rendererRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Keyboard fine-tuning. */
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "+" || e.key === "=") fitRef.current += 0.04;
      else if (k === "-") fitRef.current = Math.max(0.7, fitRef.current - 0.04);
      else if (k === "u") offsetRef.current -= 0.02;
      else if (k === "j") offsetRef.current += 0.02;
      else if (k === "[") lengthRef.current = Math.max(0.5, lengthRef.current - 0.05);
      else if (k === "]") lengthRef.current += 0.05;
      else if (k === "r") {
        fitRef.current = 1.12;
        lengthRef.current = 1.0;
        offsetRef.current = 0.0;
      } else if (k === "s") saveScreenshot();
      else return;
      setHud({ fit: fitRef.current, length: lengthRef.current, offset: offsetRef.current });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive]);

  /* Map a normalized MediaPipe landmark into Three.js world space (mirrored). */
  const toWorld = (nx: number, ny: number, depth: number) =>
    new THREE.Vector3(-(nx - 0.5) * visibleW, -(ny - 0.5) * visibleH, depth);

  /* ---- Pose the skeleton from the current landmarks. */
  const poseSkeleton = (
    lsh: THREE.Vector3,
    rsh: THREE.Vector3,
    lhip: THREE.Vector3,
    rhip: THREE.Vector3,
    lel: THREE.Vector3,
    rel: THREE.Vector3
  ) => {
    const bones = bonesRef.current;
    if (bones.length < 5) return;

    const hipCenter = lhip.clone().add(rhip).multiplyScalar(0.5);
    const chestCenter = lsh.clone().add(rsh).multiplyScalar(0.5);

    // Body basis (encodes lean + yaw from landmark depth).
    const up = chestCenter.clone().sub(hipCenter);
    if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
    up.normalize();
    const across = lsh.clone().sub(rsh);
    const front = new THREE.Vector3().crossVectors(across, up).normalize();
    const right = new THREE.Vector3().crossVectors(up, front).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, up, front);
    const qBasis = new THREE.Quaternion().setFromRotationMatrix(basis);

    // Uniform scale: tracked shoulder span maps the unit rest skeleton.
    // (Uniform avoids shear when child-bone local matrices are decomposed.)
    const span = lsh.distanceTo(rsh);
    const fit = Math.max(0.05, span) * fitRef.current;
    const scaleV = new THREE.Vector3(fit, fit, fit);

    const offUp = up.clone().multiplyScalar(offsetRef.current);

    // Desired WORLD matrices (parents first).
    const pelvisW = new THREE.Matrix4().compose(
      hipCenter.clone().add(offUp),
      qBasis,
      scaleV
    );
    const chestW = new THREE.Matrix4().compose(
      chestCenter.clone().add(offUp),
      qBasis,
      scaleV
    );

    // Shoulder bones orient their cap sleeves along the upper-arm direction.
    const armL = lel.clone().sub(lsh);
    if (armL.lengthSq() < 1e-6) armL.copy(right);
    armL.normalize();
    const armR = rel.clone().sub(rsh);
    if (armR.lengthSq() < 1e-6) armR.copy(right.clone().negate());
    armR.normalize();
    const qL = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), armL);
    const qR = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), armR);
    const lShW = new THREE.Matrix4().compose(lsh.clone(), qL, scaleV);
    const rShW = new THREE.Matrix4().compose(rsh.clone(), qR, scaleV);

    // Hem bone: hangs toward world-down with a lagged swing (fabric feel).
    const bodyDown = up.clone().negate();
    const targetHemDir = bodyDown.lerp(new THREE.Vector3(0, -1, 0), 0.45).normalize();
    hemDirRef.current.lerp(targetHemDir, 0.18).normalize();
    const hemLen = 0.55 * fit * lengthRef.current;
    const hemPos = hipCenter.clone().add(offUp).addScaledVector(hemDirRef.current, hemLen);
    const hemW = new THREE.Matrix4().compose(hemPos, qBasis, scaleV);

    // Convert world -> local matrices, then decompose onto each bone's
    // position/quaternion/scale (matrixAutoUpdate bakes them for skinning).
    const pelvisInv = pelvisW.clone().invert();
    const chestInv = chestW.clone().invert();
    const setLocal = (bone: THREE.Bone, local: THREE.Matrix4) =>
      local.decompose(bone.position, bone.quaternion, bone.scale);

    setLocal(bones[BONE.pelvis], pelvisW.clone());
    setLocal(bones[BONE.chest], pelvisInv.clone().multiply(chestW));
    setLocal(bones[BONE.lSh], chestInv.clone().multiply(lShW));
    setLocal(bones[BONE.rSh], chestInv.clone().multiply(rShW));
    setLocal(bones[BONE.hem], pelvisInv.clone().multiply(hemW));
  };

  /* ---- Main render/track loop. */
  useEffect(() => {
    if (!isActive) return;
    let lastVideoTime = -1;

    const loop = () => {
      const video = videoRef.current;
      const landmarker = poseLandmarkerRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const mesh = meshRef.current;

      if (video && landmarker && renderer && scene && camera && mesh) {
        if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
          lastVideoTime = video.currentTime;
          const tMs = performance.now();
          const res = landmarker.detectForVideo(video, tMs);
          const lm = res.landmarks?.[0];
          const w = res.worldLandmarks?.[0];

          if (lm) {
            const depth = (i: number) => (w ? -w[i].z * 0.7 : 0);
            const S = sm.current;
            const lsh = S.lsh.apply(toWorld(lm[LM.leftShoulder].x, lm[LM.leftShoulder].y, depth(LM.leftShoulder)), tMs);
            const rsh = S.rsh.apply(toWorld(lm[LM.rightShoulder].x, lm[LM.rightShoulder].y, depth(LM.rightShoulder)), tMs);
            const lhip = S.lhip.apply(toWorld(lm[LM.leftHip].x, lm[LM.leftHip].y, depth(LM.leftHip)), tMs);
            const rhip = S.rhip.apply(toWorld(lm[LM.rightHip].x, lm[LM.rightHip].y, depth(LM.rightHip)), tMs);
            const lel = S.lel.apply(toWorld(lm[LM.leftElbow].x, lm[LM.leftElbow].y, depth(LM.leftElbow)), tMs);
            const rel = S.rel.apply(toWorld(lm[LM.rightElbow].x, lm[LM.rightElbow].y, depth(LM.rightElbow)), tMs);

            poseSkeleton(lsh, rsh, lhip, rhip, lel, rel);

            const vis =
              ((lm[LM.leftShoulder].visibility ?? 1) + (lm[LM.rightShoulder].visibility ?? 1)) / 2;
            presenceRef.current += ((vis > 0.5 ? 1 : 0) - presenceRef.current) * 0.2;
          } else {
            presenceRef.current += (0 - presenceRef.current) * 0.15;
          }
          (mesh.material as THREE.MeshStandardMaterial).opacity = presenceRef.current;
        }
        renderer.render(scene, camera);
      }
      if (isActive) rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const startTryOn = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_W, height: VIDEO_H } });
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
      setIsActive(true);
    } catch (err) {
      console.error(err);
      alert("Webcam connection failed.");
    }
  };

  const saveScreenshot = () => {
    const video = videoRef.current;
    const gl = glCanvasRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!video || !gl || !renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    const out = document.createElement("canvas");
    out.width = VIDEO_W;
    out.height = VIDEO_H;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.translate(VIDEO_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, VIDEO_W, VIDEO_H);
    ctx.drawImage(gl, 0, 0, VIDEO_W, VIDEO_H);
    const link = document.createElement("a");
    link.download = `garment3d_${Date.now()}.png`;
    link.href = out.toDataURL("image/png");
    link.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "15px" }}>
      {!isActive && (
        <button
          onClick={startTryOn}
          disabled={!isReady}
          style={{
            background: isReady ? "#8b5cf6" : "#555",
            color: "white",
            padding: "10px 20px",
            border: "none",
            borderRadius: "5px",
            cursor: isReady ? "pointer" : "not-allowed",
            fontSize: "16px",
          }}
        >
          {isReady ? "Start 3D Garment Try-On" : "Preparing 3D engine..."}
        </button>
      )}

      <div
        style={{
          position: "relative",
          width: `${VIDEO_W}px`,
          height: `${VIDEO_H}px`,
          background: "#000",
          borderRadius: "8px",
          overflow: "hidden",
          display: isActive ? "block" : "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            background: "rgba(0,0,0,0.75)",
            padding: "8px 12px",
            borderRadius: "4px",
            color: "white",
            fontFamily: "monospace",
            fontSize: "13px",
            zIndex: 10,
            textAlign: "left",
            pointerEvents: "none",
            lineHeight: "1.4",
          }}
        >
          <strong>3D Skinned Garment</strong>
          <br />
          Fit: {hud.fit.toFixed(2)} | Length: {hud.length.toFixed(2)} | Offset: {hud.offset.toFixed(2)}
          <br />
          <span style={{ color: "#aaa", fontSize: "11px" }}>
            +/-: Fit | [ ]: Length | U/J: Up/Down | R: Reset | S: Screenshot
          </span>
        </div>

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            width: `${VIDEO_W}px`,
            height: `${VIDEO_H}px`,
            transform: "scaleX(-1)",
          }}
        />
        <canvas
          ref={glCanvasRef}
          width={VIDEO_W}
          height={VIDEO_H}
          style={{
            position: "absolute",
            width: `${VIDEO_W}px`,
            height: `${VIDEO_H}px`,
          }}
        />
      </div>

      {!isActive && <p style={{ fontSize: "14px", color: "#888" }}>{statusText}</p>}
    </div>
  );
}
