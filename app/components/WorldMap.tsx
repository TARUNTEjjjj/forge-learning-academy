'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, MoveUpRight, Pause, Play, Plus, RotateCcw } from 'lucide-react';
import {
  DEFAULT_CAMERA,
  ISLAND_ANCHORS,
  clamp,
  clampCamera,
  createArchipelagoRenderer,
  focusTargetForPhase,
  orbitCameraPose,
  projectIslandLabels,
  resolveMotionTime,
  stepCameraFlyTo,
  type ArchipelagoRenderer,
  type CameraState,
  type PhaseSummary,
} from '../../lib/world3d';

type Phase = PhaseSummary;

export default function WorldMap({
  phases,
  selected,
  onSelect,
  completed = [],
}: {
  phases: Phase[];
  selected: number;
  onSelect: (i: number) => void;
  completed?: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLSpanElement>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rendererRef = useRef<ArchipelagoRenderer | null>(null);

  const [zoomUi, setZoomUi] = useState(DEFAULT_CAMERA.zoom);
  const [userPaused, setUserPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rendererMode, setRendererMode] = useState<'webgl2' | 'canvas2d'>('webgl2');

  const motionPaused = userPaused || reducedMotion;
  const count = Math.min(phases.length || ISLAND_ANCHORS.length, ISLAND_ANCHORS.length);

  // Initial deterministic label coordinates for SSR / first paint
  const initialLabels = useMemo(() => {
    const cam: CameraState = { ...DEFAULT_CAMERA, target: focusTargetForPhase(selected) };
    const pose = orbitCameraPose(cam, 800 / 370);
    return projectIslandLabels(count, pose, 800, 370);
  }, [count]);

  const currentCamRef = useRef<CameraState>({ ...DEFAULT_CAMERA, target: focusTargetForPhase(selected) });
  const goalCamRef = useRef<CameraState>({ ...DEFAULT_CAMERA, target: focusTargetForPhase(selected) });
  const motionTimeRef = useRef(0);
  const lastFrameMsRef = useRef(0);
  const frameIdRef = useRef(0);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const stateRef = useRef({ phases, selected, completed, motionPaused });
  stateRef.current = { phases, selected, completed, motionPaused };

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  // Update camera fly-to target whenever selected phase changes
  useEffect(() => {
    const nextTarget = focusTargetForPhase(selected);
    goalCamRef.current = clampCamera({ ...goalCamRef.current, target: nextTarget });
    if (reducedMotion) {
      currentCamRef.current = goalCamRef.current;
    }
    scheduleDrawRef.current();
  }, [selected, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const renderer = createArchipelagoRenderer(canvas);
    rendererRef.current = renderer;
    setRendererMode(renderer.mode);

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth || 800);
      const h = Math.max(1, wrap.clientHeight || 370);
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      renderer.resize(w, h, dpr);
    };
    resize();

    const syncDomOverlays = (
      labels: ReturnType<ArchipelagoRenderer['render']>,
      cam: CameraState,
    ) => {
      for (let i = 0; i < labels.length; i++) {
        const el = labelRefs.current[i];
        const pt = labels[i];
        if (!el || !pt) continue;
        el.style.left = `${pt.x.toFixed(1)}px`;
        el.style.top = `${pt.y.toFixed(1)}px`;
      }
      if (compassRef.current) {
        const deg = ((-cam.yaw * 180) / Math.PI).toFixed(1);
        compassRef.current.style.transform = `rotate(${deg}deg)`;
      }
    };

    const tick = (nowMs: number) => {
      frameIdRef.current = 0;
      const latest = stateRef.current;
      const dt = lastFrameMsRef.current ? clamp((nowMs - lastFrameMsRef.current) / 1000, 0, 0.05) : 1 / 60;
      lastFrameMsRef.current = nowMs;

      if (!latest.motionPaused) {
        motionTimeRef.current += dt;
      }

      const fly = stepCameraFlyTo(
        currentCamRef.current,
        goalCamRef.current,
        dt,
        reducedMotion || Boolean(dragRef.current),
      );
      currentCamRef.current = fly.camera;

      const t = resolveMotionTime(motionTimeRef.current, latest.motionPaused, false, motionTimeRef.current);
      const labels = renderer.render({
        phases: latest.phases,
        selected: latest.selected,
        completedIds: latest.completed,
        camera: currentCamRef.current,
        time: t,
        motionActive: !latest.motionPaused,
      });
      syncDomOverlays(labels, currentCamRef.current);

      if (!latest.motionPaused || !fly.settled) {
        frameIdRef.current = requestAnimationFrame(tick);
      } else {
        lastFrameMsRef.current = 0;
      }
    };

    const schedule = () => {
      if (typeof requestAnimationFrame !== 'function') return;
      if (!frameIdRef.current) {
        frameIdRef.current = requestAnimationFrame(tick);
      }
    };
    scheduleDrawRef.current = schedule;

    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          resize();
          schedule();
        })
      : null;
    ro?.observe(wrap);
    schedule();

    return () => {
      scheduleDrawRef.current = () => {};
      ro?.disconnect();
      if (frameIdRef.current && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameIdRef.current);
      }
      frameIdRef.current = 0;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [reducedMotion]);

  // Re-kick animation loop when pause/selection/completed/phases change
  useEffect(() => {
    scheduleDrawRef.current();
  }, [motionPaused, selected, completed.join(','), phases]);

  const applyZoom = (delta: number) => {
    const nextZoom = clamp(Number((goalCamRef.current.zoom + delta).toFixed(2)), 0.7, 1.45);
    goalCamRef.current = clampCamera({ ...goalCamRef.current, zoom: nextZoom });
    if (motionPaused) currentCamRef.current = clampCamera({ ...currentCamRef.current, zoom: nextZoom });
    setZoomUi(nextZoom);
    scheduleDrawRef.current();
  };

  const resetView = () => {
    const target = focusTargetForPhase(selected);
    const resetCam = clampCamera({ ...DEFAULT_CAMERA, target });
    goalCamRef.current = resetCam;
    if (motionPaused) currentCamRef.current = resetCam;
    setZoomUi(DEFAULT_CAMERA.zoom);
    scheduleDrawRef.current();
  };

  const toggleMotion = () => {
    if (reducedMotion) return;
    setUserPaused(p => !p);
  };

  const completedSet = new Set(completed);

  return (
    <div className="world-wrap" ref={wrapRef} data-renderer={rendererMode} data-motion-paused={String(motionPaused)}>
      <div className="map-atmosphere" />
      <span className="map-coordinate">
        THE FORGE ARCHIPELAGO
        <br />
        10 worlds. One continuous journey.
      </span>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Interactive three-dimensional curriculum islands. Drag to rotate, use arrow keys to orbit, or use buttons to zoom."
        onPointerDown={e => {
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            startYaw: goalCamRef.current.yaw,
            startPitch: goalCamRef.current.pitch,
            moved: false,
          };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={e => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (Math.hypot(dx, dy) > 4) d.moved = true;
          const next = clampCamera({
            ...goalCamRef.current,
            yaw: d.startYaw - dx * 0.0055,
            pitch: d.startPitch + dy * 0.0045,
          });
          goalCamRef.current = next;
          currentCamRef.current = next;
          scheduleDrawRef.current();
        }}
        onPointerUp={e => {
          const d = dragRef.current;
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          if (d && !d.moved && rendererRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            const picked = rendererRef.current.pickIsland(
              e.clientX - rect.left,
              e.clientY - rect.top,
              {
                phases,
                selected,
                completedIds: completed,
                camera: currentCamRef.current,
                time: motionTimeRef.current,
                motionActive: !motionPaused,
              },
            );
            if (picked >= 0 && picked < phases.length) onSelect(picked);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={e => {
          let handled = true;
          if (e.key === 'ArrowLeft') {
            goalCamRef.current = clampCamera({ ...goalCamRef.current, yaw: goalCamRef.current.yaw - 0.14 });
          } else if (e.key === 'ArrowRight') {
            goalCamRef.current = clampCamera({ ...goalCamRef.current, yaw: goalCamRef.current.yaw + 0.14 });
          } else if (e.key === 'ArrowUp') {
            goalCamRef.current = clampCamera({ ...goalCamRef.current, pitch: goalCamRef.current.pitch + 0.08 });
          } else if (e.key === 'ArrowDown') {
            goalCamRef.current = clampCamera({ ...goalCamRef.current, pitch: goalCamRef.current.pitch - 0.08 });
          } else if (e.key === '+' || e.key === '=') {
            applyZoom(0.1);
            return;
          } else if (e.key === '-' || e.key === '_') {
            applyZoom(-0.1);
            return;
          } else if (e.key === '0' || e.key.toLowerCase() === 'r') {
            resetView();
            return;
          } else if (e.key === ' ' || e.key.toLowerCase() === 'p') {
            toggleMotion();
          } else {
            handled = false;
          }
          if (handled) {
            e.preventDefault();
            if (motionPaused) currentCamRef.current = goalCamRef.current;
            scheduleDrawRef.current();
          }
        }}
      />
      {phases.slice(0, count).map((phase, i) => {
        const isCurrent = i === selected;
        const isDone = completedSet.has(phase.id);
        const pos = initialLabels[i] ?? { x: 400, y: 185 };
        return (
          <button
            key={phase.id || i}
            ref={el => {
              labelRefs.current[i] = el;
            }}
            className={'island-label ' + (isCurrent ? 'current' : '') + (isDone ? ' completed' : '')}
            style={{ left: pos.x, top: pos.y }}
            onClick={() => onSelect(i)}
            aria-label={`Explore phase ${i + 1}: ${phase?.title}`}
            aria-pressed={isCurrent}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            {isDone && !isCurrent && <Check size={10} className="island-done-mark" aria-hidden="true" />}
            {isCurrent && <b>{phase?.title}</b>}
          </button>
        );
      })}
      <div className="map-controls">
        <span>DRAG TO ORBIT · {Math.round(zoomUi * 100)}%</span>
        <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => applyZoom(0.1)}>
          <Plus size={15} />
        </button>
        <button aria-label="Zoom out" title="Zoom out (-)" onClick={() => applyZoom(-0.1)}>
          <Minus size={15} />
        </button>
        <button aria-label="Reset map" title="Reset camera (R)" onClick={resetView}>
          <RotateCcw size={14} />
        </button>
        <button
          aria-label={motionPaused ? 'Resume 3D motion' : 'Pause 3D motion'}
          aria-pressed={motionPaused}
          title={
            reducedMotion
              ? '3D motion paused (prefers-reduced-motion active)'
              : userPaused
                ? 'Resume 3D motion (P)'
                : 'Pause 3D motion (P)'
          }
          onClick={toggleMotion}
          disabled={reducedMotion}
        >
          {motionPaused ? <Play size={13} /> : <Pause size={13} />}
        </button>
      </div>
      <span className="compass" aria-hidden="true">
        N{' '}
        <span ref={compassRef} className="compass-needle">
          <MoveUpRight size={24} />
        </span>
      </span>
    </div>
  );
}
