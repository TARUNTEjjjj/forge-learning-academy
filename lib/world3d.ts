/**
 * Pure TypeScript WebGL2 + Canvas2D 3D Archipelago Engine for Forge Learning Academy.
 *
 * Designed with zero external dependencies and full SSR/Node compatibility so
 * camera math, quaternion slerp, Bezier flight paths, closed-manifold prism
 * topology, and the Canvas2D fallback renderer are deterministically testable.
 */

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // [x, y, z, w]
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export interface PhaseSummary {
  id: string;
  title: string;
  hours: number;
  color?: string;
}

export interface IslandAnchor {
  x: number;
  z: number;
  elevation: number;
  seed: number;
  radius: number;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  zoom: number;
  target: Vec3;
}

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  rotationMat3: Mat3;
  viewMatrix: Float32Array;
  projMatrix: Float32Array;
  viewProjMatrix: Float32Array;
  invViewProjMatrix: Float32Array;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  ndcX: number;
  ndcY: number;
  ndcZ: number;
  depth: number;
  visible: boolean;
}

export interface ManifoldMesh {
  vertices: Vec3[];
  triangles: [number, number, number][];
  faceColors: Vec3[];
  faceEmissive: number[];
}

export interface TopologyReport {
  vertices: number;
  edges: number;
  faces: number;
  eulerCharacteristic: number;
  boundaryHalfEdges: number;
  nonManifoldEdges: number;
  signedVolume: number;
  isClosedManifold: boolean;
}

export interface FlightArc {
  fromIndex: number;
  toIndex: number;
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
}

export interface SceneRenderState {
  phases: readonly PhaseSummary[];
  selected: number;
  completedIds: readonly string[];
  camera: CameraState;
  time: number;
  motionActive: boolean;
}

export interface ArchipelagoRenderer {
  readonly mode: 'webgl2' | 'canvas2d';
  resize(width: number, height: number, dpr: number): void;
  render(state: SceneRenderState): ProjectedPoint[];
  pickIsland(localX: number, localY: number, state: SceneRenderState): number;
  dispose(): void;
}

export const ISLAND_ANCHORS: readonly IslandAnchor[] = [
  { x: -3.75, z: 2.35, elevation: 0.96, seed: 101, radius: 1.05 },
  { x: -1.15, z: 2.75, elevation: 1.08, seed: 203, radius: 1.08 },
  { x: 1.65, z: 2.25, elevation: 1.04, seed: 307, radius: 1.02 },
  { x: 3.70, z: 0.35, elevation: 1.18, seed: 409, radius: 1.12 },
  { x: 1.05, z: 0.05, elevation: 1.24, seed: 503, radius: 1.14 },
  { x: -1.95, z: -0.20, elevation: 1.32, seed: 607, radius: 1.16 },
  { x: -3.70, z: -2.10, elevation: 1.22, seed: 709, radius: 1.12 },
  { x: -0.95, z: -2.55, elevation: 1.28, seed: 809, radius: 1.14 },
  { x: 1.85, z: -2.25, elevation: 1.34, seed: 907, radius: 1.14 },
  { x: 3.80, z: -3.30, elevation: 1.50, seed: 1009, radius: 1.22 },
];

export const DEFAULT_CAMERA: CameraState = {
  yaw: 0.30,
  pitch: 0.66,
  zoom: 1.0,
  target: [0, 0.06, 0.28],
};

const MIN_PITCH = 0.28;
const MAX_PITCH = 1.12;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.45;
const EPS = 1e-9;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export function normalize3(v: Vec3): Vec3 {
  const len = length3(v);
  if (len <= EPS) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len <= EPS) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const n = normalize3(axis);
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return quatNormalize([n[0] * s, n[1] * s, n[2] * s, Math.cos(half)]);
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatFromEuler(yaw: number, pitch: number, roll = 0): Quat {
  const qy = quatFromAxisAngle([0, 1, 0], yaw);
  const qp = quatFromAxisAngle([1, 0, 0], -pitch);
  const qr = quatFromAxisAngle([0, 0, 1], roll);
  return quatNormalize(quatMultiply(quatMultiply(qy, qp), qr));
}

export function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  const u = clamp(t, 0, 1);
  const qa = quatNormalize(a);
  let qb = quatNormalize(b);
  let dot = quatDot(qa, qb);
  if (dot < 0) {
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return quatNormalize([
      lerp(qa[0], qb[0], u),
      lerp(qa[1], qb[1], u),
      lerp(qa[2], qb[2], u),
      lerp(qa[3], qb[3], u),
    ]);
  }
  const theta0 = Math.acos(clamp(dot, -1, 1));
  const theta = theta0 * u;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - dot * (sinTheta / sinTheta0);
  const s1 = sinTheta / sinTheta0;
  return quatNormalize([
    qa[0] * s0 + qb[0] * s1,
    qa[1] * s0 + qb[1] * s1,
    qa[2] * s0 + qb[2] * s1,
    qa[3] * s0 + qb[3] * s1,
  ]);
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = quatNormalize(q);
  const uv = cross3([qx, qy, qz], v);
  const uuv = cross3([qx, qy, qz], uv);
  return add3(v, add3(scale3(uv, 2 * qw), scale3(uuv, 2)));
}

/** Column-major SO(3) rotation matrix derived from unit quaternion q. */
export function quatToMat3(q: Quat): Mat3 {
  const [x, y, z, w] = quatNormalize(q);
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
  ];
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[row] * b[col * 3] +
        a[3 + row] * b[col * 3 + 1] +
        a[6 + row] * b[col * 3 + 2];
    }
  }
  return out as unknown as Mat3;
}

export function mat3Determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function mat4Perspective(fovYRad: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovYRad * 0.5);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / Math.max(0.2, aspect);
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4Invert(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  det = 1 / det;

  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * det;
  inv[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;
  inv[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}

export function clampCamera(camera: CameraState): CameraState {
  const yaw = Number.isFinite(camera.yaw)
    ? Math.atan2(Math.sin(camera.yaw), Math.cos(camera.yaw))
    : DEFAULT_CAMERA.yaw;
  const pitch = Number.isFinite(camera.pitch)
    ? clamp(camera.pitch, MIN_PITCH, MAX_PITCH)
    : DEFAULT_CAMERA.pitch;
  const zoom = Number.isFinite(camera.zoom)
    ? clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM)
    : DEFAULT_CAMERA.zoom;
  return {
    yaw,
    pitch,
    zoom,
    target: [
      Number.isFinite(camera.target[0]) ? camera.target[0] : 0,
      Number.isFinite(camera.target[1]) ? camera.target[1] : DEFAULT_CAMERA.target[1],
      Number.isFinite(camera.target[2]) ? camera.target[2] : DEFAULT_CAMERA.target[2],
    ],
  };
}

/**
 * Computes a gentle panoramic look-at framing target biased toward the selected
 * island while preserving overview legibility of all 10 worlds.
 */
export function focusTargetForPhase(selectedIndex: number): Vec3 {
  const anchor = ISLAND_ANCHORS[clamp(selectedIndex, 0, ISLAND_ANCHORS.length - 1)] ?? ISLAND_ANCHORS[0];
  return [anchor.x * 0.22, 0.06, anchor.z * 0.22 + 0.25];
}

export function shortestAngleDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

export function stepCameraFlyTo(
  current: CameraState,
  goal: CameraState,
  dtSeconds: number,
  reducedMotion: boolean,
): { camera: CameraState; settled: boolean } {
  const cur = clampCamera(current);
  const dst = clampCamera(goal);
  if (reducedMotion) {
    return { camera: dst, settled: true };
  }
  const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0, 0.1);
  const alpha = 1 - Math.exp(-7.5 * dt);
  const qCur = quatFromEuler(cur.yaw, cur.pitch, 0);
  const qDst = quatFromEuler(dst.yaw, dst.pitch, 0);
  const qNext = quatSlerp(qCur, qDst, alpha);
  const forward = quatRotateVec3(qNext, [0, 0, -1]);
  const nextYaw = Math.atan2(-forward[0], -forward[2]);
  const nextPitch = clamp(Math.asin(clamp(-forward[1], -1, 1)), MIN_PITCH, MAX_PITCH);
  const nextZoom = lerp(cur.zoom, dst.zoom, alpha);
  const nextTarget = lerp3(cur.target, dst.target, alpha);
  const delta =
    Math.abs(shortestAngleDelta(nextYaw, dst.yaw)) +
    Math.abs(nextPitch - dst.pitch) +
    Math.abs(nextZoom - dst.zoom) +
    length3(sub3(nextTarget, dst.target));
  if (delta < 1e-4) {
    return { camera: dst, settled: true };
  }
  return {
    camera: clampCamera({ yaw: nextYaw, pitch: nextPitch, zoom: nextZoom, target: nextTarget }),
    settled: false,
  };
}

export function orbitCameraPose(camera: CameraState, aspect: number): CameraPose {
  const cam = clampCamera(camera);
  const safeAspect = Math.max(0.25, Number.isFinite(aspect) ? aspect : 1.6);
  // Narrow mobile viewports pull back slightly so all 10 islands stay inside frame.
  const narrowBoost = safeAspect < 1.35 ? 1 + (1.35 - safeAspect) * 0.35 : 1;
  const radius = (14.4 * narrowBoost) / cam.zoom;
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const sinY = Math.sin(cam.yaw);
  const cosY = Math.cos(cam.yaw);
  const eye: Vec3 = [
    cam.target[0] + radius * cosP * sinY,
    cam.target[1] + radius * sinP,
    cam.target[2] + radius * cosP * cosY,
  ];
  const forward = normalize3(sub3(cam.target, eye));
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = cross3(right, forward);
  // Column-major SO(3) camera orientation basis [right, up, -forward].
  const rotationMat3: Mat3 = [
    right[0], right[1], right[2],
    up[0], up[1], up[2],
    -forward[0], -forward[1], -forward[2],
  ];
  const viewMatrix = new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot3(right, eye), -dot3(up, eye), dot3(forward, eye), 1,
  ]);
  const projMatrix = mat4Perspective(0.68, safeAspect, 0.5, 95);
  const viewProjMatrix = mat4Multiply(projMatrix, viewMatrix);
  const invViewProjMatrix = mat4Invert(viewProjMatrix);
  return {
    eye,
    target: cam.target,
    forward,
    right,
    up,
    rotationMat3,
    viewMatrix,
    projMatrix,
    viewProjMatrix,
    invViewProjMatrix,
  };
}

export function projectPoint(
  worldPos: Vec3,
  viewProjMatrix: Float32Array,
  width: number,
  height: number,
): ProjectedPoint {
  const [x, y, z] = worldPos;
  const cx = viewProjMatrix[0] * x + viewProjMatrix[4] * y + viewProjMatrix[8] * z + viewProjMatrix[12];
  const cy = viewProjMatrix[1] * x + viewProjMatrix[5] * y + viewProjMatrix[9] * z + viewProjMatrix[13];
  const cz = viewProjMatrix[2] * x + viewProjMatrix[6] * y + viewProjMatrix[10] * z + viewProjMatrix[14];
  const cw = viewProjMatrix[3] * x + viewProjMatrix[7] * y + viewProjMatrix[11] * z + viewProjMatrix[15];
  if (!Number.isFinite(cw) || Math.abs(cw) < 1e-6) {
    return { x: 0, y: 0, ndcX: 0, ndcY: 0, ndcZ: 2, depth: 0, visible: false };
  }
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  const sx = (ndcX * 0.5 + 0.5) * width;
  const sy = (0.5 - ndcY * 0.5) * height;
  const visible = cw > 0 && ndcZ >= -1 && ndcZ <= 1;
  return { x: sx, y: sy, ndcX, ndcY, ndcZ, depth: cw, visible };
}

export function resolveMotionTime(
  rawTimeSeconds: number,
  paused: boolean,
  reducedMotion: boolean,
  frozenTime = 0,
): number {
  if (paused || reducedMotion) return Number.isFinite(frozenTime) ? frozenTime : 0;
  return Number.isFinite(rawTimeSeconds) && rawTimeSeconds >= 0 ? rawTimeSeconds : 0;
}

export function hexToRgb01(hex: string | undefined, fallback: Vec3 = [0.66, 0.61, 1]): Vec3 {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const clean = hex.slice(1);
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

export const mixRgb = (a: Vec3, b: Vec3, t: number): Vec3 => lerp3(a, b, clamp(t, 0, 1));

function hashUnit(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates a closed 2-manifold N-sided prism (or tapered frustum) with
 * strictly outward-oriented triangles (Euler characteristic V - E + F = 2).
 */
export function createClosedPrismManifold(opts: {
  cx: number;
  cz: number;
  yBottom: number;
  yTop: number;
  rx: number;
  rz: number;
  sides?: number;
  topScale?: number;
  rotation?: number;
  twist?: number;
  colorTop: Vec3;
  colorSide: Vec3;
  emissiveTop?: number;
  emissiveSide?: number;
}): ManifoldMesh {
  const sides = Math.max(3, Math.floor(opts.sides ?? 6));
  const topScale = opts.topScale ?? 1;
  const rot = opts.rotation ?? 0;
  const twist = opts.twist ?? 0;
  const emissiveTop = opts.emissiveTop ?? 0;
  const emissiveSide = opts.emissiveSide ?? 0;
  const vertices: Vec3[] = [];
  for (let k = 0; k < sides; k++) {
    const a = rot + (2 * Math.PI * k) / sides;
    vertices.push([opts.cx + Math.cos(a) * opts.rx, opts.yBottom, opts.cz + Math.sin(a) * opts.rz]);
  }
  for (let k = 0; k < sides; k++) {
    const a = rot + twist + (2 * Math.PI * k) / sides;
    vertices.push([
      opts.cx + Math.cos(a) * opts.rx * topScale,
      opts.yTop,
      opts.cz + Math.sin(a) * opts.rz * topScale,
    ]);
  }
  const triangles: [number, number, number][] = [];
  const faceColors: Vec3[] = [];
  const faceEmissive: number[] = [];
  const bottomTint = mixRgb(opts.colorSide, [0.04, 0.06, 0.12], 0.55);

  for (let k = 1; k < sides - 1; k++) {
    triangles.push([0, k, k + 1]);
    faceColors.push(bottomTint);
    faceEmissive.push(0);
  }
  for (let k = 1; k < sides - 1; k++) {
    triangles.push([sides, sides + k + 1, sides + k]);
    faceColors.push(opts.colorTop);
    faceEmissive.push(emissiveTop);
  }
  for (let k = 0; k < sides; k++) {
    const kn = (k + 1) % sides;
    const b0 = k, b1 = kn, t0 = sides + k, t1 = sides + kn;
    triangles.push([b0, t0, t1], [b0, t1, b1]);
    const shade = 0.88 + 0.12 * Math.cos((2 * Math.PI * k) / sides - 0.6);
    const sideColor: Vec3 = [
      opts.colorSide[0] * shade,
      opts.colorSide[1] * shade,
      opts.colorSide[2] * shade,
    ];
    faceColors.push(sideColor, sideColor);
    faceEmissive.push(emissiveSide, emissiveSide);
  }
  return { vertices, triangles, faceColors, faceEmissive };
}

/**
 * Generates a closed octahedral beacon crystal (V=6, E=12, F=8, V-E+F=2).
 */
export function createClosedOctahedronManifold(opts: {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  color: Vec3;
  emissive?: number;
}): ManifoldMesh {
  const { cx, cy, cz, rx, ry, rz, color } = opts;
  const emissive = opts.emissive ?? 0.85;
  const vertices: Vec3[] = [
    [cx + rx, cy, cz],      // 0: +X
    [cx, cy, cz + rz],      // 1: +Z
    [cx - rx, cy, cz],      // 2: -X
    [cx, cy, cz - rz],      // 3: -Z
    [cx, cy + ry, cz],      // 4: +Y apex
    [cx, cy - ry * 0.65, cz], // 5: -Y keel
  ];
  const triangles: [number, number, number][] = [
    [4, 1, 0], [4, 2, 1], [4, 3, 2], [4, 0, 3],
    [5, 0, 1], [5, 1, 2], [5, 2, 3], [5, 3, 0],
  ];
  const faceColors = triangles.map((_, idx) =>
    idx < 4 ? mixRgb(color, [1, 0.98, 0.96], 0.18) : mixRgb(color, [0.1, 0.12, 0.2], 0.3),
  );
  const faceEmissive = triangles.map(() => emissive);
  return { vertices, triangles, faceColors, faceEmissive };
}

/**
 * Generates a closed genus-1 torus orbital ring (V-E+F = 0).
 */
export function createClosedTorusRingManifold(opts: {
  cx: number;
  cy: number;
  cz: number;
  majorR: number;
  minorR: number;
  majorSegs?: number;
  minorSegs?: number;
  tiltX?: number;
  tiltZ?: number;
  color: Vec3;
  emissive?: number;
}): ManifoldMesh {
  const majorSegs = Math.max(8, opts.majorSegs ?? 24);
  const minorSegs = Math.max(4, opts.minorSegs ?? 6);
  const tilt = quatFromEuler(0, opts.tiltX ?? 0.25, opts.tiltZ ?? -0.18);
  const vertices: Vec3[] = [];
  for (let i = 0; i < majorSegs; i++) {
    const u = (2 * Math.PI * i) / majorSegs;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < minorSegs; j++) {
      const v = (2 * Math.PI * j) / minorSegs;
      const r = opts.majorR + opts.minorR * Math.cos(v);
      const local: Vec3 = [r * cu, opts.minorR * Math.sin(v), r * su];
      const rotated = quatRotateVec3(tilt, local);
      vertices.push([opts.cx + rotated[0], opts.cy + rotated[1], opts.cz + rotated[2]]);
    }
  }
  const triangles: [number, number, number][] = [];
  const faceColors: Vec3[] = [];
  const faceEmissive: number[] = [];
  const emissive = opts.emissive ?? 0.72;
  for (let i = 0; i < majorSegs; i++) {
    const inext = (i + 1) % majorSegs;
    for (let j = 0; j < minorSegs; j++) {
      const jnext = (j + 1) % minorSegs;
      const a = i * minorSegs + j;
      const b = inext * minorSegs + j;
      const c = inext * minorSegs + jnext;
      const d = i * minorSegs + jnext;
      triangles.push([a, c, b], [a, d, c]);
      faceColors.push(opts.color, opts.color);
      faceEmissive.push(emissive, emissive);
    }
  }
  return { vertices, triangles, faceColors, faceEmissive };
}

/** Verifies topological invariants (Euler characteristic, boundary half-edges, signed volume). */
export function verifyClosedManifold(mesh: ManifoldMesh): TopologyReport {
  const halfEdges = new Set<string>();
  const undirected = new Set<string>();
  let nonManifoldEdges = 0;
  let signedVolume6 = 0;

  for (const [a, b, c] of mesh.triangles) {
    const va = mesh.vertices[a], vb = mesh.vertices[b], vc = mesh.vertices[c];
    signedVolume6 += dot3(va, cross3(vb, vc));
    const pairs: [number, number][] = [[a, b], [b, c], [c, a]];
    for (const [u, v] of pairs) {
      const key = `${u}->${v}`;
      if (halfEdges.has(key)) nonManifoldEdges++;
      halfEdges.add(key);
      const lo = Math.min(u, v), hi = Math.max(u, v);
      undirected.add(`${lo}:${hi}`);
    }
  }
  let boundaryHalfEdges = 0;
  for (const key of halfEdges) {
    const [u, v] = key.split('->');
    if (!halfEdges.has(`${v}->${u}`)) boundaryHalfEdges++;
  }
  const vertices = mesh.vertices.length;
  const edges = undirected.size;
  const faces = mesh.triangles.length;
  return {
    vertices,
    edges,
    faces,
    eulerCharacteristic: vertices - edges + faces,
    boundaryHalfEdges,
    nonManifoldEdges,
    signedVolume: signedVolume6 / 6,
    isClosedManifold: boundaryHalfEdges === 0 && nonManifoldEdges === 0 && signedVolume6 > 0,
  };
}

export function evaluateCubicBezier3D(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = clamp(t, 0, 1);
  const omt = 1 - u;
  const omt2 = omt * omt;
  const u2 = u * u;
  const w0 = omt2 * omt;
  const w1 = 3 * omt2 * u;
  const w2 = 3 * omt * u2;
  const w3 = u2 * u;
  return [
    w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
    w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
    w0 * p0[2] + w1 * p1[2] + w2 * p2[2] + w3 * p3[2],
  ];
}

export function evaluateCubicBezierTangent3D(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = clamp(t, 0, 1);
  const omt = 1 - u;
  const d0 = sub3(p1, p0);
  const d1 = sub3(p2, p1);
  const d2 = sub3(p3, p2);
  return add3(
    scale3(d0, 3 * omt * omt),
    add3(scale3(d1, 6 * omt * u), scale3(d2, 3 * u * u)),
  );
}

export function buildFlightArcs(phasesCount: number): FlightArc[] {
  const count = Math.min(phasesCount, ISLAND_ANCHORS.length);
  const arcs: FlightArc[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = ISLAND_ANCHORS[i];
    const b = ISLAND_ANCHORS[i + 1];
    const distXZ = Math.hypot(b.x - a.x, b.z - a.z);
    const y0 = a.elevation * 0.72;
    const y1 = b.elevation * 0.72;
    const peak = Math.max(y0, y1) + 0.58 + 0.085 * distXZ;
    arcs.push({
      fromIndex: i,
      toIndex: i + 1,
      p0: [a.x, y0, a.z],
      p1: [lerp(a.x, b.x, 0.30), peak, lerp(a.z, b.z, 0.30)],
      p2: [lerp(a.x, b.x, 0.70), peak, lerp(a.z, b.z, 0.70)],
      p3: [b.x, y1, b.z],
    });
  }
  return arcs;
}

export function buildIslandTerraceManifolds(
  index: number,
  phase: PhaseSummary | undefined,
  isSelected: boolean,
  isCompleted: boolean,
  isUnlocked: boolean,
): {
  terraces: ManifoldMesh[];
  beacon: ManifoldMesh;
  orbitalRing: ManifoldMesh | null;
} {
  const anchor = ISLAND_ANCHORS[index] ?? ISLAND_ANCHORS[0];
  const phaseTint = hexToRgb01(phase?.color, [0.66, 0.61, 1.0]);
  const coral: Vec3 = [1.0, 0.39, 0.47];
  const emerald: Vec3 = [0.36, 0.90, 0.74];
  const azure: Vec3 = [0.54, 0.66, 0.92];
  const basalt: Vec3 = [0.14, 0.18, 0.30];

  const primaryTop = isSelected
    ? coral
    : isCompleted
      ? emerald
      : isUnlocked
        ? mixRgb(azure, phaseTint, 0.38)
        : mixRgb([0.42, 0.47, 0.72], phaseTint, 0.45);
  const primarySide = isSelected
    ? mixRgb(basalt, [0.52, 0.16, 0.25], 0.45)
    : isCompleted
      ? mixRgb(basalt, [0.12, 0.42, 0.39], 0.48)
      : mixRgb(basalt, phaseTint, 0.2);

  const terraces: ManifoldMesh[] = [];
  // Coastal shelf reef base
  terraces.push(
    createClosedPrismManifold({
      cx: anchor.x,
      cz: anchor.z,
      yBottom: -0.34,
      yTop: 0.10,
      rx: anchor.radius * 0.98,
      rz: anchor.radius * 0.92,
      sides: 8,
      topScale: 0.84,
      rotation: (index * 0.41) % Math.PI,
      colorTop: mixRgb([0.18, 0.26, 0.39], primaryTop, 0.22),
      colorSide: [0.09, 0.14, 0.24],
    }),
  );

  // 6 procedural surrounding basalt/crystal elevation columns
  const colCount = 6;
  for (let k = 0; k < colCount; k++) {
    const h0 = hashUnit(anchor.seed + k * 13.7);
    const h1 = hashUnit(anchor.seed + k * 29.3 + 5);
    const angle = (2 * Math.PI * k) / colCount + hashUnit(anchor.seed + k) * 0.38;
    const dist = anchor.radius * (0.44 + h0 * 0.22);
    const colH = 0.26 + (anchor.elevation - 0.5) * (0.42 + h1 * 0.46);
    const colR = 0.24 + h0 * 0.12;
    const accentMix = k % 2 === 0 ? 0.62 : 0.35;
    terraces.push(
      createClosedPrismManifold({
        cx: anchor.x + Math.cos(angle) * dist,
        cz: anchor.z + Math.sin(angle) * dist,
        yBottom: -0.22,
        yTop: colH,
        rx: colR,
        rz: colR * 0.94,
        sides: 6,
        topScale: 0.86,
        rotation: angle * 0.5,
        colorTop: mixRgb(primaryTop, phaseTint, accentMix * 0.4),
        colorSide: primarySide,
        emissiveTop: isSelected ? 0.16 : isCompleted ? 0.1 : 0.03,
      }),
    );
  }

  // Central terraced citadel summit
  terraces.push(
    createClosedPrismManifold({
      cx: anchor.x,
      cz: anchor.z,
      yBottom: -0.20,
      yTop: anchor.elevation,
      rx: anchor.radius * 0.42,
      rz: anchor.radius * 0.40,
      sides: 6,
      topScale: 0.78,
      rotation: index * 0.31,
      colorTop: mixRgb(primaryTop, [0.98, 0.96, 0.92], isSelected ? 0.24 : 0.12),
      colorSide: mixRgb(primarySide, primaryTop, 0.24),
      emissiveTop: isSelected ? 0.26 : isCompleted ? 0.16 : 0.06,
      emissiveSide: isSelected ? 0.08 : 0.02,
    }),
  );

  // Floating crystalline beacon spire above summit
  const beaconColor = isSelected ? [1.0, 0.52, 0.58] as Vec3 : isCompleted ? [0.46, 0.96, 0.80] as Vec3 : mixRgb([0.66, 0.61, 1.0], phaseTint, 0.5);
  const beacon = createClosedOctahedronManifold({
    cx: anchor.x,
    cy: anchor.elevation + 0.44,
    cz: anchor.z,
    rx: isSelected ? 0.17 : 0.13,
    ry: isSelected ? 0.36 : 0.26,
    rz: isSelected ? 0.17 : 0.13,
    color: beaconColor,
    emissive: isSelected ? 0.92 : isCompleted ? 0.75 : 0.42,
  });

  const orbitalRing =
    isSelected || isCompleted
      ? createClosedTorusRingManifold({
          cx: anchor.x,
          cy: anchor.elevation + 0.38,
          cz: anchor.z,
          majorR: isSelected ? 0.54 : 0.43,
          minorR: isSelected ? 0.032 : 0.024,
          majorSegs: 24,
          minorSegs: 6,
          tiltX: isSelected ? 0.34 : 0.22,
          tiltZ: index % 2 === 0 ? -0.24 : 0.24,
          color: isSelected ? [1.0, 0.64, 0.70] : [0.54, 0.94, 0.82],
          emissive: isSelected ? 0.88 : 0.68,
        })
      : null;

  return { terraces, beacon, orbitalRing };
}

export interface FlatMeshBuffer {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  emissive: Float32Array;
  vertexCount: number;
}

export function expandManifoldsToFlatBuffer(meshes: readonly ManifoldMesh[]): FlatMeshBuffer {
  let totalTris = 0;
  for (const m of meshes) totalTris += m.triangles.length;
  const vertexCount = totalTris * 3;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const emissive = new Float32Array(vertexCount);

  let vOffset = 0;
  let eOffset = 0;
  for (const m of meshes) {
    for (let t = 0; t < m.triangles.length; t++) {
      const [ia, ib, ic] = m.triangles[t];
      const a = m.vertices[ia], b = m.vertices[ib], c = m.vertices[ic];
      const n = normalize3(cross3(sub3(b, a), sub3(c, a)));
      const col = m.faceColors[t] ?? [0.7, 0.7, 0.8];
      const em = m.faceEmissive[t] ?? 0;
      for (const p of [a, b, c]) {
        positions[vOffset] = p[0];
        positions[vOffset + 1] = p[1];
        positions[vOffset + 2] = p[2];
        normals[vOffset] = n[0];
        normals[vOffset + 1] = n[1];
        normals[vOffset + 2] = n[2];
        colors[vOffset] = col[0];
        colors[vOffset + 1] = col[1];
        colors[vOffset + 2] = col[2];
        vOffset += 3;
        emissive[eOffset++] = em;
      }
    }
  }
  return { positions, normals, colors, emissive, vertexCount };
}

interface ArcGeometryBuffer {
  positions: Float32Array;
  uvArc: Float32Array; // [t, arcStatus (0=upcoming, 0.5=active, 1=completed)]
  colors: Float32Array;
  vertexCount: number;
}

function buildFlightArcsBuffer(
  arcs: readonly FlightArc[],
  selected: number,
  completedIds: readonly string[],
  phases: readonly PhaseSummary[],
): ArcGeometryBuffer {
  const segs = 22;
  const sides = 4;
  const quadsPerArc = segs * sides;
  const vertexCount = arcs.length * quadsPerArc * 6;
  const positions = new Float32Array(vertexCount * 3);
  const uvArc = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  let vp = 0;
  let vu = 0;

  for (const arc of arcs) {
    const fromDone = completedIds.includes(phases[arc.fromIndex]?.id ?? '');
    const toDone = completedIds.includes(phases[arc.toIndex]?.id ?? '');
    const isCompletedLeg = fromDone && toDone;
    const isActiveLeg = arc.fromIndex === selected || arc.toIndex === selected || arc.toIndex <= selected;
    const status = isCompletedLeg ? 1.0 : isActiveLeg ? 0.55 : 0.0;
    const col: Vec3 = isCompletedLeg
      ? [0.44, 0.92, 0.78]
      : isActiveLeg
        ? [1.0, 0.47, 0.56]
        : [0.46, 0.53, 0.76];
    const radius = isActiveLeg || isCompletedLeg ? 0.036 : 0.024;

    const ringPts: Vec3[][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const p = evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, t);
      const tan = normalize3(evaluateCubicBezierTangent3D(arc.p0, arc.p1, arc.p2, arc.p3, t));
      const side = normalize3(cross3(tan, [0, 1, 0]));
      const binorm = cross3(side, tan);
      const ring: Vec3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (2 * Math.PI * k) / sides + Math.PI / 4;
        ring.push(add3(p, add3(scale3(side, Math.cos(a) * radius), scale3(binorm, Math.sin(a) * radius))));
      }
      ringPts.push(ring);
    }

    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      for (let k = 0; k < sides; k++) {
        const kn = (k + 1) % sides;
        const a = ringPts[s][k];
        const b = ringPts[s + 1][k];
        const c = ringPts[s + 1][kn];
        const d = ringPts[s][kn];
        const verts: [Vec3, number][] = [
          [a, t0], [b, t1], [c, t1],
          [a, t0], [c, t1], [d, t0],
        ];
        for (const [pt, tVal] of verts) {
          positions[vp] = pt[0];
          positions[vp + 1] = pt[1];
          positions[vp + 2] = pt[2];
          colors[vp] = col[0];
          colors[vp + 1] = col[1];
          colors[vp + 2] = col[2];
          vp += 3;
          uvArc[vu] = tVal;
          uvArc[vu + 1] = status;
          vu += 2;
        }
      }
    }
  }
  return { positions, uvArc, colors, vertexCount };
}

/**
 * Enhanced shaded Canvas2D fallback renderer used automatically whenever WebGL2
 * cannot be initialized (SSR, Node tests, or software-limited environments).
 */
export function drawCanvas2DFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: SceneRenderState,
): ProjectedPoint[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const pose = orbitCameraPose(state.camera, w / h);
  const time = resolveMotionTime(state.time, !state.motionActive, false, 0);

  // Night sky gradient with Fresnel horizon glow
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070b18');
  sky.addColorStop(0.54, '#101831');
  sky.addColorStop(1, '#1a1f3d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const nebula = ctx.createRadialGradient(w * 0.72, h * 0.22, 0, w * 0.72, h * 0.22, w * 0.68);
  nebula.addColorStop(0, 'rgba(169, 155, 255, 0.16)');
  nebula.addColorStop(0.55, 'rgba(255, 100, 120, 0.06)');
  nebula.addColorStop(1, 'rgba(11, 16, 32, 0)');
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);

  // Starfield responding softly to camera yaw
  const yawShift = state.camera.yaw * 75;
  for (let i = 0; i < 42; i++) {
    const sx = (((i * 137 + 31 + yawShift) % w) + w) % w;
    const sy = ((i * i * 67 + 19) % 991) / 991 * (h * 0.58);
    const twinkle = 0.2 + 0.22 * Math.sin(time * 1.4 + i * 1.7);
    ctx.fillStyle = i % 5 === 0 ? `rgba(245, 243, 235, ${twinkle + 0.16})` : `rgba(169, 179, 204, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(sx, sy, i % 5 === 0 ? 1.15 : 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ocean surface bands & specular wave ripples across projected horizon
  const horizonProj = projectPoint([0, 0, -24], pose.viewProjMatrix, w, h);
  const oceanTop = clamp(horizonProj.visible ? horizonProj.y : h * 0.26, h * 0.12, h * 0.45);
  const oceanGrad = ctx.createLinearGradient(0, oceanTop, 0, h);
  oceanGrad.addColorStop(0, 'rgba(19, 31, 61, 0.72)');
  oceanGrad.addColorStop(0.45, 'rgba(11, 19, 39, 0.90)');
  oceanGrad.addColorStop(1, 'rgba(7, 12, 24, 0.98)');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, oceanTop, w, h - oceanTop);

  ctx.lineWidth = 1;
  for (let r = 0; r < 8; r++) {
    const ry = oceanTop + ((r + 0.6) / 8) * (h - oceanTop);
    const drift = Math.sin(time * 0.9 + r * 1.1) * 14;
    ctx.strokeStyle = r % 2 === 0 ? 'rgba(140, 168, 224, 0.10)' : 'rgba(255, 130, 152, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, ry);
    ctx.bezierCurveTo(w * 0.33, ry + drift * 0.35, w * 0.66, ry - drift * 0.35, w, ry);
    ctx.stroke();
  }

  const count = Math.min(state.phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);
  // Shoreline bioluminescent halos
  for (let i = 0; i < count; i++) {
    const anchor = ISLAND_ANCHORS[i];
    const p = projectPoint([anchor.x, -0.05, anchor.z], pose.viewProjMatrix, w, h);
    if (!p.visible) continue;
    const isSel = i === state.selected;
    const isDone = state.completedIds.includes(state.phases[i]?.id ?? '');
    const pulse = isSel ? 1 + 0.08 * Math.sin(time * 2.8) : 1;
    const rx = clamp((38 * state.camera.zoom * pulse * 13) / Math.max(4, p.depth), 14, 95);
    const glow = ctx.createRadialGradient(p.x, p.y, rx * 0.15, p.x, p.y, rx * 1.45);
    glow.addColorStop(0, isSel ? 'rgba(255, 100, 120, 0.34)' : isDone ? 'rgba(94, 224, 184, 0.24)' : 'rgba(120, 145, 225, 0.16)');
    glow.addColorStop(1, 'rgba(11, 16, 32, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx * 1.45, rx * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Build & painter-sort 3D terrain/beacon/ring facets
  const lightDir = normalize3([0.55, 0.82, 0.38]);
  interface ProjectedFace {
    pts: [number, number][];
    depth: number;
    fill: string;
    edgeAlpha: number;
  }
  const facesToDraw: ProjectedFace[] = [];

  for (let i = 0; i < count; i++) {
    const phase = state.phases[i];
    const isSel = i === state.selected;
    const isDone = state.completedIds.includes(phase?.id ?? '');
    const isUnlocked = i < state.selected;
    const { terraces, beacon, orbitalRing } = buildIslandTerraceManifolds(i, phase, isSel, isDone, isUnlocked);
    const bob = (isSel ? 0.08 : 0.04) * Math.sin(time * 2.2 + i * 0.9);
    const beaconMoved: ManifoldMesh = {
      ...beacon,
      vertices: beacon.vertices.map(v => [v[0], v[1] + bob, v[2]] as Vec3),
    };
    const allMeshes: ManifoldMesh[] = [...terraces, beaconMoved];
    if (orbitalRing) {
      const anchor = ISLAND_ANCHORS[i];
      const spin = quatFromAxisAngle([0, 1, 0], time * (isSel ? 0.9 : 0.45) + i * 0.7);
      const center: Vec3 = [anchor.x, anchor.elevation + 0.38 + bob * 0.6, anchor.z];
      allMeshes.push({
        ...orbitalRing,
        vertices: orbitalRing.vertices.map(v => add3(center, quatRotateVec3(spin, sub3(v, [anchor.x, anchor.elevation + 0.38, anchor.z])))),
      });
    }
    for (const mesh of allMeshes) {
      for (let t = 0; t < mesh.triangles.length; t++) {
        const [ia, ib, ic] = mesh.triangles[t];
        const va = mesh.vertices[ia], vb = mesh.vertices[ib], vc = mesh.vertices[ic];
        const n = normalize3(cross3(sub3(vb, va), sub3(vc, va)));
        const centroid = scale3(add3(va, add3(vb, vc)), 1 / 3);
        const viewDir = normalize3(sub3(pose.eye, centroid));
        if (dot3(n, viewDir) <= -0.05) continue;
        const pa = projectPoint(va, pose.viewProjMatrix, w, h);
        const pb = projectPoint(vb, pose.viewProjMatrix, w, h);
        const pc = projectPoint(vc, pose.viewProjMatrix, w, h);
        if (!pa.visible || !pb.visible || !pc.visible) continue;
        const ndl = Math.max(0, dot3(n, lightDir));
        const em = mesh.faceEmissive[t] ?? 0;
        const lit = 0.38 + 0.62 * ndl + em * 0.45;
        const base = mesh.faceColors[t] ?? [0.6, 0.65, 0.8];
        const r = Math.round(clamp(base[0] * lit, 0, 1) * 255);
        const g = Math.round(clamp(base[1] * lit, 0, 1) * 255);
        const b = Math.round(clamp(base[2] * lit, 0, 1) * 255);
        facesToDraw.push({
          pts: [[pa.x, pa.y], [pb.x, pb.y], [pc.x, pc.y]],
          depth: (pa.depth + pb.depth + pc.depth) / 3,
          fill: `rgb(${r},${g},${b})`,
          edgeAlpha: n[1] > 0.6 ? 0.24 : 0.08,
        });
      }
    }
  }

  facesToDraw.sort((a, b) => b.depth - a.depth);
  for (const f of facesToDraw) {
    ctx.beginPath();
    ctx.moveTo(f.pts[0][0], f.pts[0][1]);
    ctx.lineTo(f.pts[1][0], f.pts[1][1]);
    ctx.lineTo(f.pts[2][0], f.pts[2][1]);
    ctx.closePath();
    ctx.fillStyle = f.fill;
    ctx.fill();
    if (f.edgeAlpha > 0.1) {
      ctx.strokeStyle = `rgba(245, 243, 235, ${f.edgeAlpha})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }

  // 3D Constellation Flight Arcs
  const arcs = buildFlightArcs(count);
  for (const arc of arcs) {
    const fromDone = state.completedIds.includes(state.phases[arc.fromIndex]?.id ?? '');
    const toDone = state.completedIds.includes(state.phases[arc.toIndex]?.id ?? '');
    const active = arc.fromIndex === state.selected || arc.toIndex === state.selected || arc.toIndex <= state.selected;
    ctx.beginPath();
    let started = false;
    for (let s = 0; s <= 18; s++) {
      const pt = evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, s / 18);
      const pr = projectPoint(pt, pose.viewProjMatrix, w, h);
      if (!pr.visible) continue;
      if (!started) { ctx.moveTo(pr.x, pr.y); started = true; }
      else ctx.lineTo(pr.x, pr.y);
    }
    ctx.strokeStyle = fromDone && toDone
      ? 'rgba(94, 224, 184, 0.78)'
      : active
        ? 'rgba(255, 114, 134, 0.72)'
        : 'rgba(130, 146, 198, 0.45)';
    ctx.lineWidth = active || (fromDone && toDone) ? 2.1 : 1.3;
    ctx.setLineDash(fromDone && toDone ? [] : [4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (active || (fromDone && toDone)) {
      const pulseT = (time * 0.42 + arc.fromIndex * 0.17) % 1;
      const pulsePt = evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, pulseT);
      const pr = projectPoint(pulsePt, pose.viewProjMatrix, w, h);
      if (pr.visible) {
        ctx.fillStyle = fromDone && toDone ? '#91f7da' : '#ffb0bc';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 2.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return projectIslandLabels(count, pose, w, h);
}

export function projectIslandLabels(
  count: number,
  pose: CameraPose,
  width: number,
  height: number,
): ProjectedPoint[] {
  const out: ProjectedPoint[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = ISLAND_ANCHORS[i] ?? ISLAND_ANCHORS[0];
    const p = projectPoint([anchor.x, -0.10, anchor.z], pose.viewProjMatrix, width, height);
    out.push({
      ...p,
      x: clamp(p.x, 28, Math.max(28, width - 28)),
      y: clamp(p.y + 4, 20, Math.max(20, height - 46)),
    });
  }
  return out;
}

// =============================================================================
// GLSL 300 ES Shaders (Zero External Dependencies)
// =============================================================================

const SKY_VERT = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
void main() {
  vNdc = POS[gl_VertexID];
  gl_Position = vec4(vNdc, 0.9999, 1.0);
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uEye;
uniform float uTime;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec4 farW = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(farW.xyz / farW.w - uEye);
  float elev = clamp(dir.y, -0.2, 1.0);
  vec3 zenith = vec3(0.032, 0.051, 0.118);
  vec3 midSky = vec3(0.068, 0.098, 0.205);
  vec3 horizon = vec3(0.145, 0.140, 0.285);
  vec3 col = mix(horizon, midSky, smoothstep(-0.04, 0.24, elev));
  col = mix(col, zenith, smoothstep(0.18, 0.72, elev));

  // Atmospheric Fresnel rim glow near horizon
  float rim = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 4.0);
  float azimuthGlow = 0.5 + 0.5 * sin(atan(dir.z, dir.x) * 2.0 + 0.6);
  col += vec3(0.28, 0.12, 0.25) * rim * (0.35 + 0.65 * azimuthGlow);

  // Analytical spherical starfield above horizon
  if (dir.y > -0.02) {
    vec2 skyUv = vec2(atan(dir.z, dir.x) * 14.0, asin(clamp(dir.y, -1.0, 1.0)) * 22.0);
    vec2 cell = floor(skyUv);
    vec2 gv = fract(skyUv) - 0.5;
    float rnd = hash21(cell);
    if (rnd > 0.78) {
      vec2 starOff = vec2(hash21(cell + 11.3) - 0.5, hash21(cell + 27.9) - 0.5) * 0.6;
      float d = length(gv - starOff);
      float twinkle = 0.65 + 0.35 * sin(uTime * 1.8 + rnd * 40.0);
      float mask = smoothstep(0.08, 0.008, d) * smoothstep(-0.01, 0.16, dir.y);
      vec3 starCol = rnd > 0.93 ? vec3(1.0, 0.85, 0.88) : vec3(0.84, 0.88, 1.0);
      col += starCol * mask * twinkle * 0.95;
    }
  }
  fragColor = vec4(col, 1.0);
}`;

const OCEAN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aXZ;
uniform mat4 uViewProj;
out vec3 vWorld;
void main() {
  vWorld = vec3(aXZ.x, 0.0, aXZ.y);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}`;

const OCEAN_FRAG = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uEye;
uniform float uTime;
uniform vec3 uSelectedPos;
uniform vec4 uIslands[10]; // x, z, radius, state (0=locked, 1=done, 2=selected)
out vec4 fragColor;

float waveHeight(vec2 p, float t) {
  float w = 0.0;
  w += sin(dot(p, vec2(1.4, 0.9)) + t * 1.35) * 0.032;
  w += sin(dot(p, vec2(-1.1, 1.7)) - t * 1.10) * 0.024;
  w += sin(dot(p, vec2(2.6, -1.8)) + t * 1.95) * 0.012;
  w += sin(dot(p, vec2(-2.9, -2.2)) + t * 2.40) * 0.008;
  return w;
}

void main() {
  vec2 p = vWorld.xz;
  float eps = 0.08;
  float h0 = waveHeight(p, uTime);
  float hx = waveHeight(p + vec2(eps, 0.0), uTime);
  float hz = waveHeight(p + vec2(0.0, eps), uTime);
  vec3 n = normalize(vec3(h0 - hx, eps * 0.85, h0 - hz));
  vec3 v = normalize(uEye - vWorld);

  // Fresnel water reflectance + sky reflection
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 4.5);
  vec3 deepWater = vec3(0.028, 0.052, 0.115);
  vec3 shallowWater = vec3(0.055, 0.105, 0.195);
  vec3 skyReflect = vec3(0.18, 0.24, 0.44);

  // Moonlight specular ripples
  vec3 lightDir = normalize(vec3(0.45, 0.72, -0.52));
  vec3 halfVec = normalize(lightDir + v);
  float spec = pow(max(dot(n, halfVec), 0.0), 72.0) * 0.72;

  // Selected beacon water reflection
  vec3 selVec = normalize(vec3(uSelectedPos.x, 1.6, uSelectedPos.z) - vWorld);
  vec3 selHalf = normalize(selVec + v);
  float selDist = length(p - uSelectedPos.xz);
  float selSpec = pow(max(dot(n, selHalf), 0.0), 36.0) * exp(-selDist * 0.24) * 0.55;

  vec3 col = mix(deepWater, shallowWater, 0.35 + 0.35 * sin(h0 * 18.0));
  col = mix(col, skyReflect, fresnel * 0.78);
  col += vec3(0.84, 0.86, 1.0) * spec + vec3(1.0, 0.45, 0.55) * selSpec;

  // Bioluminescent & sea-foam shoreline ripples around each island
  for (int i = 0; i < 10; i++) {
    vec4 isl = uIslands[i];
    if (isl.z <= 0.01) continue;
    float d = length(p - isl.xy) - isl.z * 0.88;
    float ringWave = sin(d * 10.0 - uTime * 2.2) * 0.5 + 0.5;
    float shore = smoothstep(0.62, 0.0, abs(d)) * smoothstep(-0.3, 0.35, d);
    vec3 ringCol = isl.w > 1.5
      ? vec3(1.0, 0.42, 0.52)
      : isl.w > 0.5
        ? vec3(0.36, 0.90, 0.74)
        : vec3(0.46, 0.58, 0.86);
    col += ringCol * shore * (0.28 + 0.22 * ringWave);
  }

  // Distance fog fade into horizon
  float dist = length(uEye.xz - p);
  float fog = smoothstep(14.0, 38.0, dist);
  col = mix(col, vec3(0.11, 0.125, 0.245), fog);
  fragColor = vec4(col, 1.0);
}`;

const MESH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in float aEmissive;

uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vColor;
out float vEmissive;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  vEmissive = aEmissive;
  gl_Position = uViewProj * world;
}`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vColor;
in float vEmissive;

uniform vec3 uEye;
uniform float uTime;
uniform vec3 uSelectedPos;
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorldPos);
  vec3 keyLight = normalize(vec3(0.58, 0.82, 0.36));
  vec3 fillLight = normalize(vec3(-0.62, 0.45, -0.58));

  float diffKey = max(dot(n, keyLight), 0.0);
  float diffFill = max(dot(n, fillLight), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 3.2);

  vec3 ambient = mix(vec3(0.10, 0.13, 0.22), vec3(0.24, 0.28, 0.44), hemi);
  vec3 lighting = ambient + vec3(1.02, 0.96, 0.92) * diffKey * 0.78 + vec3(0.45, 0.52, 0.85) * diffFill * 0.32;

  float pulse = 0.88 + 0.12 * sin(uTime * 2.6 + vWorldPos.x);
  vec3 lit = vColor * lighting + vColor * vEmissive * (0.68 * pulse);
  lit += mix(vec3(0.52, 0.62, 0.98), vec3(1.0, 0.52, 0.62), vEmissive) * fresnel * 0.32;

  // Warm crimson bounce light onto terrain near selected island
  float dSel = length(vWorldPos - uSelectedPos);
  lit += vec3(1.0, 0.38, 0.48) * exp(-dSel * 1.15) * 0.16;

  float fog = smoothstep(18.0, 44.0, length(uEye - vWorldPos));
  lit = mix(lit, vec3(0.11, 0.125, 0.245), fog * 0.65);
  fragColor = vec4(lit, 1.0);
}`;

const ARC_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUvArc;
layout(location = 2) in vec3 aColor;

uniform mat4 uViewProj;
out vec2 vUvArc;
out vec3 vColor;
void main() {
  vUvArc = aUvArc;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const ARC_FRAG = `#version 300 es
precision highp float;
in vec2 vUvArc;
in vec3 vColor;
uniform float uTime;
out vec4 fragColor;

void main() {
  float t = vUvArc.x;
  float status = vUvArc.y;
  float wave = fract(t - uTime * 0.48);
  float pulse = smoothstep(0.18, 0.0, abs(wave - 0.5));
  float dash = status < 0.25 ? step(0.45, fract(t * 14.0)) : 1.0;
  float intensity = status > 0.8 ? (0.85 + 0.55 * pulse) : status > 0.3 ? (0.68 + 0.65 * pulse) : 0.42 * dash;
  vec3 col = vColor * intensity + vec3(1.0, 0.92, 0.95) * pulse * step(0.3, status) * 0.45;
  fragColor = vec4(col, status < 0.25 ? 0.55 * dash : 0.92);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const prog = gl.createProgram();
  if (!prog) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

interface DynamicMeshUpload {
  vao: WebGLVertexArrayObject;
  vboPos: WebGLBuffer;
  vboNorm: WebGLBuffer;
  vboCol: WebGLBuffer;
  vboEm: WebGLBuffer;
  vertexCount: number;
  index: number;
  anchor: IslandAnchor;
  isSelected: boolean;
  hasRing: boolean;
  beaconEndVertex: number;
}

function uploadFlatBuffer(
  gl: WebGL2RenderingContext,
  buf: FlatMeshBuffer,
): { vao: WebGLVertexArrayObject; vboPos: WebGLBuffer; vboNorm: WebGLBuffer; vboCol: WebGLBuffer; vboEm: WebGLBuffer } | null {
  const vao = gl.createVertexArray();
  const vboPos = gl.createBuffer();
  const vboNorm = gl.createBuffer();
  const vboCol = gl.createBuffer();
  const vboEm = gl.createBuffer();
  if (!vao || !vboPos || !vboNorm || !vboCol || !vboEm) return null;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
  gl.bufferData(gl.ARRAY_BUFFER, buf.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm);
  gl.bufferData(gl.ARRAY_BUFFER, buf.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, vboCol);
  gl.bufferData(gl.ARRAY_BUFFER, buf.colors, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, vboEm);
  gl.bufferData(gl.ARRAY_BUFFER, buf.emissive, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vboPos, vboNorm, vboCol, vboEm };
}

function modelMatrixForLocalTransform(origin: Vec3, yShift: number, spinRad: number): Float32Array {
  const c = Math.cos(spinRad), s = Math.sin(spinRad);
  const [ox, oy, oz] = origin;
  // Rotate around local pivot origin, then apply vertical bobbing shift.
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    ox - c * ox - s * oz, yShift, oz + s * ox - c * oz, 1,
  ]);
}

const IDENTITY_MAT4 = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function createWebGL2Renderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): ArchipelagoRenderer | null {
  const skyProg = linkProgram(gl, SKY_VERT, SKY_FRAG);
  const oceanProg = linkProgram(gl, OCEAN_VERT, OCEAN_FRAG);
  const meshProg = linkProgram(gl, MESH_VERT, MESH_FRAG);
  const arcProg = linkProgram(gl, ARC_VERT, ARC_FRAG);
  if (!skyProg || !oceanProg || !meshProg || !arcProg) {
    if (skyProg) gl.deleteProgram(skyProg);
    if (oceanProg) gl.deleteProgram(oceanProg);
    if (meshProg) gl.deleteProgram(meshProg);
    if (arcProg) gl.deleteProgram(arcProg);
    return null;
  }

  const skyVao = gl.createVertexArray();
  const oceanVao = gl.createVertexArray();
  const oceanVbo = gl.createBuffer();
  const arcVao = gl.createVertexArray();
  const arcVboPos = gl.createBuffer();
  const arcVboUv = gl.createBuffer();
  const arcVboCol = gl.createBuffer();
  if (!skyVao || !oceanVao || !oceanVbo || !arcVao || !arcVboPos || !arcVboUv || !arcVboCol) {
    return null;
  }

  const skyLoc = {
    invViewProj: gl.getUniformLocation(skyProg, 'uInvViewProj'),
    eye: gl.getUniformLocation(skyProg, 'uEye'),
    time: gl.getUniformLocation(skyProg, 'uTime'),
  };
  const oceanLoc = {
    viewProj: gl.getUniformLocation(oceanProg, 'uViewProj'),
    eye: gl.getUniformLocation(oceanProg, 'uEye'),
    time: gl.getUniformLocation(oceanProg, 'uTime'),
    selectedPos: gl.getUniformLocation(oceanProg, 'uSelectedPos'),
    islands: gl.getUniformLocation(oceanProg, 'uIslands'),
  };
  const meshLoc = {
    viewProj: gl.getUniformLocation(meshProg, 'uViewProj'),
    model: gl.getUniformLocation(meshProg, 'uModel'),
    eye: gl.getUniformLocation(meshProg, 'uEye'),
    time: gl.getUniformLocation(meshProg, 'uTime'),
    selectedPos: gl.getUniformLocation(meshProg, 'uSelectedPos'),
  };
  const arcLoc = {
    viewProj: gl.getUniformLocation(arcProg, 'uViewProj'),
    time: gl.getUniformLocation(arcProg, 'uTime'),
  };

  // Ocean quad spanning [-48, 48] XZ
  const oceanVerts = new Float32Array([
    -48, -48, 48, -48, 48, 48,
    -48, -48, 48, 48, -48, 48,
  ]);
  gl.bindVertexArray(oceanVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, oceanVbo);
  gl.bufferData(gl.ARRAY_BUFFER, oceanVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  let width = Math.max(1, canvas.clientWidth || 800);
  let height = Math.max(1, canvas.clientHeight || 370);
  let dpr = 1;
  let sceneKey = '';
  let staticTerrain: ReturnType<typeof uploadFlatBuffer> = null;
  let staticVertexCount = 0;
  let dynamicItems: DynamicMeshUpload[] = [];
  let arcVertexCount = 0;
  let islandUniforms = new Float32Array(40);
  let contextLost = false;

  const onLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
  };
  const onRestored = () => {
    contextLost = false;
    sceneKey = '';
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const freeGeometry = () => {
    if (staticTerrain) {
      gl.deleteVertexArray(staticTerrain.vao);
      gl.deleteBuffer(staticTerrain.vboPos);
      gl.deleteBuffer(staticTerrain.vboNorm);
      gl.deleteBuffer(staticTerrain.vboCol);
      gl.deleteBuffer(staticTerrain.vboEm);
      staticTerrain = null;
    }
    for (const d of dynamicItems) {
      gl.deleteVertexArray(d.vao);
      gl.deleteBuffer(d.vboPos);
      gl.deleteBuffer(d.vboNorm);
      gl.deleteBuffer(d.vboCol);
      gl.deleteBuffer(d.vboEm);
    }
    dynamicItems = [];
  };

  const syncSceneGeometry = (state: SceneRenderState) => {
    const count = Math.min(state.phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);
    const key = `${count}|${state.selected}|${state.completedIds.join(',')}|${state.phases.map(p => p.color || '').join(',')}`;
    if (key === sceneKey) return;
    sceneKey = key;
    freeGeometry();

    const staticMeshes: ManifoldMesh[] = [];
    islandUniforms = new Float32Array(40);

    for (let i = 0; i < count; i++) {
      const phase = state.phases[i];
      const anchor = ISLAND_ANCHORS[i];
      const isSel = i === state.selected;
      const isDone = state.completedIds.includes(phase?.id ?? '');
      const isUnlocked = i < state.selected;
      islandUniforms[i * 4] = anchor.x;
      islandUniforms[i * 4 + 1] = anchor.z;
      islandUniforms[i * 4 + 2] = anchor.radius;
      islandUniforms[i * 4 + 3] = isSel ? 2 : isDone ? 1 : 0;

      const { terraces, beacon, orbitalRing } = buildIslandTerraceManifolds(i, phase, isSel, isDone, isUnlocked);
      staticMeshes.push(...terraces);

      const dynList: ManifoldMesh[] = [beacon];
      const beaconEndVertex = beacon.triangles.length * 3;
      if (orbitalRing) dynList.push(orbitalRing);
      const dynBuf = expandManifoldsToFlatBuffer(dynList);
      const uploaded = uploadFlatBuffer(gl, dynBuf);
      if (uploaded) {
        dynamicItems.push({
          ...uploaded,
          vertexCount: dynBuf.vertexCount,
          index: i,
          anchor,
          isSelected: isSel,
          hasRing: Boolean(orbitalRing),
          beaconEndVertex,
        });
      }
    }

    const terrainBuf = expandManifoldsToFlatBuffer(staticMeshes);
    staticVertexCount = terrainBuf.vertexCount;
    staticTerrain = uploadFlatBuffer(gl, terrainBuf);

    const arcs = buildFlightArcs(count);
    const arcBuf = buildFlightArcsBuffer(arcs, state.selected, state.completedIds, state.phases);
    arcVertexCount = arcBuf.vertexCount;
    gl.bindVertexArray(arcVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, arcVboPos);
    gl.bufferData(gl.ARRAY_BUFFER, arcBuf.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, arcVboUv);
    gl.bufferData(gl.ARRAY_BUFFER, arcBuf.uvArc, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, arcVboCol);
    gl.bufferData(gl.ARRAY_BUFFER, arcBuf.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  };

  return {
    mode: 'webgl2',
    resize(w: number, h: number, nextDpr: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      dpr = clamp(nextDpr || 1, 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    render(state: SceneRenderState) {
      const count = Math.min(state.phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);
      const pose = orbitCameraPose(state.camera, width / height);
      if (contextLost || gl.isContextLost()) {
        return projectIslandLabels(count, pose, width, height);
      }
      syncSceneGeometry(state);
      const time = resolveMotionTime(state.time, !state.motionActive, false, 0);
      const selAnchor = ISLAND_ANCHORS[clamp(state.selected, 0, count - 1)] ?? ISLAND_ANCHORS[0];
      const selPos: Vec3 = [selAnchor.x, selAnchor.elevation + 0.38, selAnchor.z];

      gl.clearColor(0.04, 0.06, 0.13, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. Atmospheric sky dome + starfield
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(skyProg);
      gl.uniformMatrix4fv(skyLoc.invViewProj, false, pose.invViewProjMatrix);
      gl.uniform3f(skyLoc.eye, pose.eye[0], pose.eye[1], pose.eye[2]);
      gl.uniform1f(skyLoc.time, time);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. Animated GLSL ocean shader
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(oceanProg);
      gl.uniformMatrix4fv(oceanLoc.viewProj, false, pose.viewProjMatrix);
      gl.uniform3f(oceanLoc.eye, pose.eye[0], pose.eye[1], pose.eye[2]);
      gl.uniform1f(oceanLoc.time, time);
      gl.uniform3f(oceanLoc.selectedPos, selPos[0], selPos[1], selPos[2]);
      gl.uniform4fv(oceanLoc.islands, islandUniforms);
      gl.bindVertexArray(oceanVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // 3. Faceted basalt/emerald/coral islands & beacons
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(meshProg);
      gl.uniformMatrix4fv(meshLoc.viewProj, false, pose.viewProjMatrix);
      gl.uniform3f(meshLoc.eye, pose.eye[0], pose.eye[1], pose.eye[2]);
      gl.uniform1f(meshLoc.time, time);
      gl.uniform3f(meshLoc.selectedPos, selPos[0], selPos[1], selPos[2]);

      if (staticTerrain && staticVertexCount > 0) {
        gl.uniformMatrix4fv(meshLoc.model, false, IDENTITY_MAT4);
        gl.bindVertexArray(staticTerrain.vao);
        gl.drawArrays(gl.TRIANGLES, 0, staticVertexCount);
      }

      for (const item of dynamicItems) {
        const bob = (item.isSelected ? 0.08 : 0.04) * Math.sin(time * 2.2 + item.index * 0.9);
        const origin: Vec3 = [item.anchor.x, item.anchor.elevation + 0.4, item.anchor.z];
        gl.bindVertexArray(item.vao);
        gl.uniformMatrix4fv(
          meshLoc.model,
          false,
          modelMatrixForLocalTransform(origin, bob, time * (item.isSelected ? 1.1 : 0.55) + item.index * 0.6),
        );
        gl.drawArrays(gl.TRIANGLES, 0, item.beaconEndVertex);
        if (item.hasRing && item.vertexCount > item.beaconEndVertex) {
          gl.uniformMatrix4fv(
            meshLoc.model,
            false,
            modelMatrixForLocalTransform(origin, bob * 0.6, -time * (item.isSelected ? 0.85 : 0.42)),
          );
          gl.drawArrays(gl.TRIANGLES, item.beaconEndVertex, item.vertexCount - item.beaconEndVertex);
        }
      }

      // 4. 3D Constellation Flight Arcs
      if (arcVertexCount > 0) {
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(arcProg);
        gl.uniformMatrix4fv(arcLoc.viewProj, false, pose.viewProjMatrix);
        gl.uniform1f(arcLoc.time, time);
        gl.bindVertexArray(arcVao);
        gl.drawArrays(gl.TRIANGLES, 0, arcVertexCount);
        gl.disable(gl.BLEND);
      }

      gl.bindVertexArray(null);
      return projectIslandLabels(count, pose, width, height);
    },
    pickIsland(localX: number, localY: number, state: SceneRenderState) {
      return pickProjectedIsland(localX, localY, state, width, height);
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      freeGeometry();
      gl.deleteVertexArray(skyVao);
      gl.deleteVertexArray(oceanVao);
      gl.deleteBuffer(oceanVbo);
      gl.deleteVertexArray(arcVao);
      gl.deleteBuffer(arcVboPos);
      gl.deleteBuffer(arcVboUv);
      gl.deleteBuffer(arcVboCol);
      gl.deleteProgram(skyProg);
      gl.deleteProgram(oceanProg);
      gl.deleteProgram(meshProg);
      gl.deleteProgram(arcProg);
    },
  };
}

function pickProjectedIsland(
  localX: number,
  localY: number,
  state: SceneRenderState,
  width: number,
  height: number,
): number {
  const count = Math.min(state.phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);
  const pose = orbitCameraPose(state.camera, width / height);
  let best = -1;
  let bestDist = 44;
  for (let i = 0; i < count; i++) {
    const a = ISLAND_ANCHORS[i];
    const p = projectPoint([a.x, a.elevation * 0.5, a.z], pose.viewProjMatrix, width, height);
    if (!p.visible) continue;
    const d = Math.hypot(localX - p.x, localY - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function createCanvas2DRenderer(canvas: HTMLCanvasElement): ArchipelagoRenderer {
  let width = Math.max(1, canvas.clientWidth || 800);
  let height = Math.max(1, canvas.clientHeight || 370);
  let dpr = 1;
  return {
    mode: 'canvas2d',
    resize(w: number, h: number, nextDpr: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      dpr = clamp(nextDpr || 1, 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    },
    render(state: SceneRenderState) {
      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      const pose = orbitCameraPose(state.camera, width / height);
      const count = Math.min(state.phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);
      if (!ctx) return projectIslandLabels(count, pose, width, height);
      ctx.save();
      ctx.scale(dpr, dpr);
      const labels = drawCanvas2DFrame(ctx, width, height, state);
      ctx.restore();
      return labels;
    },
    pickIsland(localX: number, localY: number, state: SceneRenderState) {
      return pickProjectedIsland(localX, localY, state, width, height);
    },
    dispose() {},
  };
}

/**
 * Instantiates a hardware-accelerated WebGL2 3D Archipelago renderer with
 * automatic fallback to the enhanced shaded Canvas2D renderer whenever WebGL2
 * cannot be initialized.
 */
export function createArchipelagoRenderer(
  canvas: HTMLCanvasElement,
  options: { forceCanvas2D?: boolean } = {},
): ArchipelagoRenderer {
  if (!options.forceCanvas2D && typeof canvas.getContext === 'function') {
    try {
      const gl = canvas.getContext('webgl2', {
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      if (gl) {
        const webgl = createWebGL2Renderer(canvas, gl);
        if (webgl) return webgl;
      }
    } catch {
      // Fall through cleanly to the Canvas2D shaded 3D engine.
    }
  }
  return createCanvas2DRenderer(canvas);
}
