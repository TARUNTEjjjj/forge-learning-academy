import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import * as React from "./react-stand-in.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const dataUrl = js => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
const transpile = source =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

const world3dUrl = dataUrl(transpile(read("../lib/world3d.ts")));
const world3d = await import(world3dUrl);

async function loadWorldMapComponent() {
  const source = read("../app/components/WorldMap.tsx");
  const icons = /import \{([^}]+)\} from ["']lucide-react["']/.exec(source)[1]
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);
  let js = transpile(source);
  const standIn = new URL("./react-stand-in.mjs", import.meta.url).href;
  const replacements = {
    "react/jsx-runtime": standIn,
    react: standIn,
    "lucide-react": dataUrl(icons.map(name => `export const ${name} = () => null;`).join("\n")),
    "../../lib/world3d": world3dUrl,
  };
  for (const [specifier, url] of Object.entries(replacements)) {
    js = js
      .replaceAll(`from "${specifier}"`, `from ${JSON.stringify(url)}`)
      .replaceAll(`from '${specifier}'`, `from ${JSON.stringify(url)}`);
  }
  return (await import(dataUrl(js))).default;
}

const curriculum = JSON.parse(read("../public/curriculum.json"));
const phases = curriculum.phases.map(p => ({ id: p.id, title: p.title, hours: p.hours, color: p.color }));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertMat3SpecialOrthogonal(R, tol = 1e-11, label = "R") {
  const RtR = world3d.mat3Multiply(world3d.mat3Transpose(R), R);
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 9; i++) {
    assert.ok(Math.abs(RtR[i] - identity[i]) <= tol, `${label}: R^T R[${i}]=${RtR[i]} expected ${identity[i]}`);
  }
  const det = world3d.mat3Determinant(R);
  assert.ok(Math.abs(det - 1) <= tol, `${label}: det(R)=${det} expected 1`);
}

function createMockCanvas2DContext() {
  const ops = { fillRects: 0, fills: 0, strokes: 0, arcs: 0, paths: 0 };
  const gradient = () => ({ addColorStop() {} });
  return {
    ops,
    save() {},
    restore() {},
    scale() {},
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    fillRect() { ops.fillRects++; },
    beginPath() { ops.paths++; },
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    arc() { ops.arcs++; },
    ellipse() { ops.arcs++; },
    setLineDash() {},
    fill() { ops.fills++; },
    stroke() { ops.strokes++; },
    set fillStyle(_) {},
    set strokeStyle(_) {},
    set lineWidth(_) {},
  };
}

test("property: camera rotation matrices satisfy R^T R = I and det(R) = +1 across random Euler & orbit sweeps", () => {
  const rng = mulberry32(20261126);
  for (let i = 0; i < 250; i++) {
    const yaw = (rng() * 2 - 1) * Math.PI;
    const pitch = 0.28 + rng() * (1.12 - 0.28);
    const roll = (rng() * 2 - 1) * Math.PI;
    const q = world3d.quatFromEuler(yaw, pitch, roll);
    const qNorm = Math.hypot(q[0], q[1], q[2], q[3]);
    assert.ok(Math.abs(qNorm - 1) <= 1e-12, `quaternion norm ${qNorm}`);

    const Rquat = world3d.quatToMat3(q);
    assertMat3SpecialOrthogonal(Rquat, 1e-11, `quatToMat3 #${i}`);

    const pose = world3d.orbitCameraPose(
      {
        yaw,
        pitch,
        zoom: 0.7 + rng() * 0.75,
        target: [(rng() - 0.5) * 3, rng() * 0.6, (rng() - 0.5) * 3],
      },
      0.7 + rng() * 1.8,
    );
    assertMat3SpecialOrthogonal(pose.rotationMat3, 1e-11, `orbitCameraPose #${i}`);

    // Verify viewProjMatrix * invViewProjMatrix approximates I_4 (Float32 precision)
    const prod = world3d.mat4Multiply(pose.viewProjMatrix, pose.invViewProjMatrix);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const expected = r === c ? 1 : 0;
        assert.ok(
          Math.abs(prod[c * 4 + r] - expected) <= 1e-4,
          `M * M^-1 [${r},${c}]=${prod[c * 4 + r]} expected ${expected}`,
        );
      }
    }
  }
});

test("property: quaternion slerp preserves unit norm, endpoints, and shortest-path antipodal continuity", () => {
  const rng = mulberry32(918273);
  for (let i = 0; i < 120; i++) {
    const qa = world3d.quatFromEuler((rng() - 0.5) * 6, 0.3 + rng() * 0.7, (rng() - 0.5) * 2);
    const qb = world3d.quatFromEuler((rng() - 0.5) * 6, 0.3 + rng() * 0.7, (rng() - 0.5) * 2);
    const negQb = [-qb[0], -qb[1], -qb[2], -qb[3]];

    const s0 = world3d.quatSlerp(qa, qb, 0);
    const s1 = world3d.quatSlerp(qa, qb, 1);
    assert.ok(Math.abs(Math.abs(world3d.quatDot(s0, qa)) - 1) <= 1e-12);
    assert.ok(Math.abs(Math.abs(world3d.quatDot(s1, qb)) - 1) <= 1e-12);

    for (const t of [0.15, 0.35, 0.5, 0.75, 0.9]) {
      const m1 = world3d.quatSlerp(qa, qb, t);
      const m2 = world3d.quatSlerp(qa, negQb, t);
      assert.ok(Math.abs(Math.hypot(m1[0], m1[1], m1[2], m1[3]) - 1) <= 1e-12);
      // Shortest path to +qb and -qb produces identical orientation
      assert.ok(Math.abs(Math.abs(world3d.quatDot(m1, m2)) - 1) <= 1e-11);
    }
  }
});

test("property: perspective frustum and 2D label projections remain valid across yaw, pitch, zoom, and viewport sweeps", () => {
  const viewports = [
    [1200, 410],
    [800, 370],
    [340, 330],
  ];
  const yaws = [-Math.PI, -2.1, -1.0, -0.3, 0, 0.34, 1.1, 2.2, Math.PI];
  const pitches = [0.28, 0.45, 0.58, 0.82, 1.12];
  const zooms = [0.7, 0.85, 1.0, 1.2, 1.45];

  for (const [width, height] of viewports) {
    for (const yaw of yaws) {
      for (const pitch of pitches) {
        for (const zoom of zooms) {
          const cam = { yaw, pitch, zoom, target: world3d.DEFAULT_CAMERA.target };
          const pose = world3d.orbitCameraPose(cam, width / height);
          for (let i = 0; i < world3d.ISLAND_ANCHORS.length; i++) {
            const a = world3d.ISLAND_ANCHORS[i];
            const pt = world3d.projectPoint([a.x, a.elevation * 0.5, a.z], pose.viewProjMatrix, width, height);
            assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.ndcZ));
            assert.ok(pt.visible, `island ${i} outside frustum at yaw=${yaw}, pitch=${pitch}, zoom=${zoom}`);
            assert.ok(pt.depth > 0.5, `island ${i} behind near plane: depth=${pt.depth}`);
            assert.ok(pt.ndcZ > -1 && pt.ndcZ < 1, `island ${i} ndcZ=${pt.ndcZ}`);
          }
          const labels = world3d.projectIslandLabels(10, pose, width, height);
          assert.equal(labels.length, 10);
          for (const lbl of labels) {
            assert.ok(lbl.x >= 28 && lbl.x <= width - 28, `label x=${lbl.x} out of [28, ${width - 28}]`);
            assert.ok(lbl.y >= 20 && lbl.y <= height - 34, `label y=${lbl.y} out of [20, ${height - 34}]`);
          }
        }
      }
    }
    // Verify at default zoom across all focus targets labels stay well-separated
    for (let sel = 0; sel < 10; sel++) {
      const pose = world3d.orbitCameraPose({ ...world3d.DEFAULT_CAMERA, target: world3d.focusTargetForPhase(sel) }, width / height);
      const labels = world3d.projectIslandLabels(10, pose, width, height);
      let minDist = Infinity;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          minDist = Math.min(minDist, Math.hypot(labels[i].x - labels[j].x, labels[i].y - labels[j].y));
        }
      }
      assert.ok(minDist > 12, `viewport ${width}x${height} sel=${sel} min label spacing ${minDist}`);
    }
  }
});

test("flight arcs verify Bezier endpoint identity, chain C0 continuity, zenith arc, and tangent derivatives", () => {
  const arcs = world3d.buildFlightArcs(phases.length);
  assert.equal(arcs.length, 9);
  for (let i = 0; i < arcs.length; i++) {
    const arc = arcs[i];
    const start = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, 0);
    const end = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, 1);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(start[k] - arc.p0[k]) <= 1e-12);
      assert.ok(Math.abs(end[k] - arc.p3[k]) <= 1e-12);
    }
    if (i < arcs.length - 1) {
      const nextStart = world3d.evaluateCubicBezier3D(arcs[i + 1].p0, arcs[i + 1].p1, arcs[i + 1].p2, arcs[i + 1].p3, 0);
      assert.ok(world3d.length3(world3d.sub3(end, nextStart)) <= 1e-12, `chain break between arc ${i} and ${i + 1}`);
    }
    const mid = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, 0.5);
    assert.ok(mid[1] > Math.max(start[1], end[1]), `arc ${i} must crest above endpoints`);

    // Compare analytical tangent against central finite differences & check Lipschitz step bound
    const h = 1e-5;
    let prev = start;
    for (let step = 1; step <= 20; step++) {
      const t = step / 20;
      const pt = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, t);
      assert.ok(world3d.length3(world3d.sub3(pt, prev)) < 1.0, "bounded segment step");
      prev = pt;
      if (t > h && t < 1 - h) {
        const fPlus = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, t + h);
        const fMinus = world3d.evaluateCubicBezier3D(arc.p0, arc.p1, arc.p2, arc.p3, t - h);
        const fd = world3d.scale3(world3d.sub3(fPlus, fMinus), 1 / (2 * h));
        const analytic = world3d.evaluateCubicBezierTangent3D(arc.p0, arc.p1, arc.p2, arc.p3, t);
        assert.ok(world3d.length3(world3d.sub3(fd, analytic)) <= 1e-6);
      }
    }
  }
});

test("Euler characteristic (V - E + F) and closed manifold vertex invariants hold on prisms, beacons, and torus rings", () => {
  const rng = mulberry32(441199);
  for (const sides of [3, 4, 5, 6, 8, 12]) {
    for (let trial = 0; trial < 5; trial++) {
      const prism = world3d.createClosedPrismManifold({
        cx: (rng() - 0.5) * 4,
        cz: (rng() - 0.5) * 4,
        yBottom: -0.4,
        yTop: 0.3 + rng() * 1.4,
        rx: 0.2 + rng() * 0.8,
        rz: 0.2 + rng() * 0.8,
        sides,
        topScale: 0.6 + rng() * 0.4,
        rotation: rng() * Math.PI,
        twist: (rng() - 0.5) * 0.4,
        colorTop: [0.8, 0.5, 0.6],
        colorSide: [0.2, 0.3, 0.5],
      });
      const topo = world3d.verifyClosedManifold(prism);
      assert.equal(topo.isClosedManifold, true, `sides=${sides} closed manifold`);
      assert.equal(topo.boundaryHalfEdges, 0);
      assert.equal(topo.nonManifoldEdges, 0);
      assert.equal(topo.eulerCharacteristic, 2, `sides=${sides} Euler characteristic V-E+F must equal 2`);
      assert.ok(topo.signedVolume > 0, `positive signed volume for outward winding`);
    }
  }

  for (let i = 0; i < phases.length; i++) {
    const built = world3d.buildIslandTerraceManifolds(i, phases[i], i === 3, i < 3, i < 3);
    for (const mesh of [...built.terraces, built.beacon]) {
      const topo = world3d.verifyClosedManifold(mesh);
      assert.equal(topo.isClosedManifold, true);
      assert.equal(topo.boundaryHalfEdges, 0);
      assert.equal(topo.nonManifoldEdges, 0);
      assert.equal(topo.eulerCharacteristic, 2);
      assert.ok(topo.signedVolume > 0);
    }
    if (built.orbitalRing) {
      const ringTopo = world3d.verifyClosedManifold(built.orbitalRing);
      assert.equal(ringTopo.isClosedManifold, true);
      assert.equal(ringTopo.boundaryHalfEdges, 0);
      assert.equal(ringTopo.nonManifoldEdges, 0);
      // Genus-1 torus satisfies V - E + F = 2 - 2g = 0
      assert.equal(ringTopo.eulerCharacteristic, 0);
      assert.ok(ringTopo.signedVolume > 0);
    }

    const flat = world3d.expandManifoldsToFlatBuffer([...built.terraces, built.beacon]);
    assert.equal(flat.vertexCount, [...built.terraces, built.beacon].reduce((s, m) => s + m.triangles.length * 3, 0));
    for (let v = 0; v < flat.vertexCount; v++) {
      const nx = flat.normals[v * 3], ny = flat.normals[v * 3 + 1], nz = flat.normals[v * 3 + 2];
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) <= 1e-5, "expanded flat normal is unit length");
    }
  }
});

test("WebGL2 fallback automatically drops to shaded Canvas2D and picks islands accurately", () => {
  const ctx2d = createMockCanvas2DContext();
  const makeMockCanvas = getCtxImpl => ({
    clientWidth: 800,
    clientHeight: 370,
    width: 800,
    height: 370,
    addEventListener() {},
    removeEventListener() {},
    getContext: getCtxImpl,
  });

  // Case 1: getContext('webgl2') returns null
  const r1 = world3d.createArchipelagoRenderer(
    makeMockCanvas(type => (type === "2d" ? ctx2d : null)),
  );
  assert.equal(r1.mode, "canvas2d");

  // Case 2: getContext('webgl2') throws
  const r2 = world3d.createArchipelagoRenderer(
    makeMockCanvas(type => {
      if (type === "webgl2") throw new Error("WebGL disabled");
      return type === "2d" ? ctx2d : null;
    }),
  );
  assert.equal(r2.mode, "canvas2d");

  // Case 3: broken webgl2 stub fails shader compilation and falls back cleanly
  const r3 = world3d.createArchipelagoRenderer(
    makeMockCanvas(type => (type === "webgl2" ? { createShader: () => null } : ctx2d)),
  );
  assert.equal(r3.mode, "canvas2d");

  const sceneState = {
    phases,
    selected: 4,
    completedIds: [phases[0].id, phases[1].id],
    camera: { ...world3d.DEFAULT_CAMERA, target: world3d.focusTargetForPhase(4) },
    time: 2.5,
    motionActive: true,
  };
  r1.resize(800, 370, 2);
  const labels = r1.render(sceneState);
  assert.equal(labels.length, 10);
  assert.ok(ctx2d.ops.fills > 200, "Canvas2D fallback renders faceted terrain triangles");
  assert.ok(ctx2d.ops.strokes > 10, "Canvas2D fallback renders ocean ripples and constellation arcs");

  // Verify hit-testing picks each projected island center
  const pose = world3d.orbitCameraPose(sceneState.camera, 800 / 370);
  for (let i = 0; i < phases.length; i++) {
    const a = world3d.ISLAND_ANCHORS[i];
    const p = world3d.projectPoint([a.x, a.elevation * 0.5, a.z], pose.viewProjMatrix, 800, 370);
    assert.equal(r1.pickIsland(p.x, p.y, sceneState), i, `pickIsland hits phase ${i}`);
  }
  r1.dispose();
  r2.dispose();
  r3.dispose();
});

test("reduced-motion and pause determinism freeze motion time and converge fly-to camera cleanly", () => {
  assert.equal(world3d.resolveMotionTime(12.34, false, false, 4.2), 12.34);
  assert.equal(world3d.resolveMotionTime(12.34, true, false, 4.2), 4.2);
  assert.equal(world3d.resolveMotionTime(12.34, false, true, 4.2), 4.2);
  assert.equal(world3d.resolveMotionTime(-5, false, false, 0), 0);
  assert.equal(world3d.resolveMotionTime(Number.NaN, false, false, 1.5), 0);

  const startCam = { ...world3d.DEFAULT_CAMERA, yaw: -0.6, pitch: 0.4, zoom: 0.85 };
  const goalCam = { ...world3d.DEFAULT_CAMERA, yaw: 0.85, pitch: 0.82, zoom: 1.25, target: world3d.focusTargetForPhase(7) };

  // Reduced motion snaps deterministically in one step
  const snapped = world3d.stepCameraFlyTo(startCam, goalCam, 0.016, true);
  assert.equal(snapped.settled, true);
  assert.ok(Math.abs(snapped.camera.yaw - goalCam.yaw) <= 1e-9);
  assert.ok(Math.abs(snapped.camera.pitch - goalCam.pitch) <= 1e-9);
  assert.ok(Math.abs(snapped.camera.zoom - goalCam.zoom) <= 1e-9);

  // Smooth fly-to converges monotonically without overshoot
  let cur = startCam;
  let prevGap = Infinity;
  let converged = false;
  for (let step = 0; step < 180; step++) {
    const next = world3d.stepCameraFlyTo(cur, goalCam, 1 / 60, false);
    const gap =
      Math.abs(world3d.shortestAngleDelta(next.camera.yaw, goalCam.yaw)) +
      Math.abs(next.camera.pitch - goalCam.pitch) +
      Math.abs(next.camera.zoom - goalCam.zoom);
    assert.ok(gap <= prevGap + 1e-9, `monotonic convergence step ${step}: ${gap} > ${prevGap}`);
    prevGap = gap;
    cur = next.camera;
    if (next.settled) {
      converged = true;
      break;
    }
  }
  assert.equal(converged, true, "camera fly-to settles within 3 seconds at 60fps");
});

test("WorldMap component renders 10 accessible islands, zoom/reset/pause controls, and respects prefers-reduced-motion", async () => {
  const WorldMap = await loadWorldMapComponent();
  const savedWindow = globalThis.window;
  let reduced = false;
  globalThis.window = Object.assign(new EventTarget(), {
    devicePixelRatio: 1,
    matchMedia: () => ({
      get matches() { return reduced; },
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  try {
    const selectedEvents = [];
    React.render(React.jsx(WorldMap, {
      phases,
      selected: 2,
      completed: [phases[0].id],
      onSelect: idx => selectedEvents.push(idx),
    }));

    const islandButtons = React.findAll(n => n.type === "button" && React.hasClass(n, "island-label"));
    assert.equal(islandButtons.length, 10);
    assert.equal(islandButtons[2].props["aria-pressed"], true);
    assert.ok(React.hasClass(islandButtons[2], "current"));
    assert.ok(React.hasClass(islandButtons[0], "completed"));

    islandButtons[6].props.onClick();
    assert.deepEqual(selectedEvents, [6]);

    const zoomIn = React.findAll(n => n.type === "button" && n.props["aria-label"] === "Zoom in")[0];
    const zoomOut = React.findAll(n => n.type === "button" && n.props["aria-label"] === "Zoom out")[0];
    const reset = React.findAll(n => n.type === "button" && n.props["aria-label"] === "Reset map")[0];
    const pauseBtn = () => React.findAll(n => n.type === "button" && /3D motion/.test(n.props["aria-label"] ?? ""))[0];

    assert.ok(zoomIn && zoomOut && reset);
    assert.equal(pauseBtn().props["aria-pressed"], false);
    assert.equal(pauseBtn().props["aria-label"], "Pause 3D motion");
    pauseBtn().props.onClick();
    React.flush();
    assert.equal(pauseBtn().props["aria-pressed"], true);
    assert.equal(pauseBtn().props["aria-label"], "Resume 3D motion");
    pauseBtn().props.onClick();
    React.flush();
    assert.equal(pauseBtn().props["aria-pressed"], false);

    // Re-render with prefers-reduced-motion: reduce active
    reduced = true;
    React.render(React.jsx(WorldMap, {
      phases,
      selected: 0,
      completed: [],
      onSelect: () => {},
    }));
    assert.equal(pauseBtn().props["aria-pressed"], true);
    assert.equal(pauseBtn().props.disabled, true);
  } finally {
    React.unmount();
    globalThis.window = savedWindow;
  }
});
