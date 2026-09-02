import React, { useEffect, useRef } from 'react';
import type { EEGDataPoint } from '../../types';
import {
  getMandalaMetricTargets,
  getMandalaDegradation,
  hsvToCss,
  normalizeTotalPower,
  type MandalaMetricTargets,
} from './eegMandalaMetrics';

interface EegMandalaCanvasProps {
  eegData: EEGDataPoint | null;
  recentInZonePercent: number | null;
  isPaused?: boolean;
}

type Point = { x: number; y: number };
type MotifKind = 'lotus' | 'rounded' | 'leaf' | 'scallop' | 'paisley' | 'compound';

interface StrokeShape {
  points: Point[];
  closed?: boolean;
  fill?: number;
  width?: number;
  detail?: boolean;
  dash?: number[];
}

interface MotifSnapshot {
  kind: MotifKind;
  radius: number;
  angle: number;
  width: number;
  height: number;
  hue: number;
  saturation: number;
  value: number;
  curvature: number;
  strokeWidth: number;
  quality: number;
  seed: number;
}

const TAU = Math.PI * 2;
const VIEWPORT_FILL_DIAMETER = .76;
const MIN_FRAMING_RADIUS = 32;
const MAX_CAMERA_ZOOM = 5.5;
const CAMERA_PADDING_RATIO = 1.04;
const CAMERA_EASING_RATE = 2.2;
const BUFFER_REBASE_MIN_RATIO = .86;
const BUFFER_REBASE_MAX_RATIO = 1.3;
const MOTIF_ORDER: MotifKind[] = ['lotus', 'scallop', 'rounded', 'leaf', 'paisley', 'compound'];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

function getTargetCameraScale(width: number, height: number, artworkRadius: number) {
  const usableViewportRadius = Math.min(width, height) * VIEWPORT_FILL_DIAMETER / 2;
  const framingRadius = Math.max(MIN_FRAMING_RADIUS, artworkRadius * CAMERA_PADDING_RATIO);
  return clamp(usableViewportRadius / framingRadius, .0001, MAX_CAMERA_ZOOM);
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cubic(a: Point, b: Point, c: Point, d: Point, steps = 14): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const inv = 1 - t;
    return {
      x: inv ** 3 * a.x + 3 * inv ** 2 * t * b.x + 3 * inv * t ** 2 * c.x + t ** 3 * d.x,
      y: inv ** 3 * a.y + 3 * inv ** 2 * t * b.y + 3 * inv * t ** 2 * c.y + t ** 3 * d.y,
    };
  });
}

function join(...segments: Point[][]): Point[] {
  return segments.flatMap((segment, index) => index === 0 ? segment : segment.slice(1));
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, steps = 28): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = index / steps * TAU;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function spiralPoints(cx: number, cy: number, radius: number, clockwise: number): Point[] {
  return Array.from({ length: 34 }, (_, index) => {
    const t = index / 33;
    const angle = clockwise * t * TAU * 1.7;
    const r = radius * (1 - t) * 0.9 + 1;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
}

function buildMotif(snapshot: MotifSnapshot): StrokeShape[] {
  const w = snapshot.width;
  const h = snapshot.height;
  const bow = lerp(0.25, 0.62, snapshot.curvature);
  const pointed = (scale = 1, y = 2): Point[] => join(
    cubic({ x: 0, y }, { x: w * bow * scale, y: -h * 0.18 * scale }, { x: w * 0.36 * scale, y: -h * 0.7 * scale }, { x: 0, y: -h * scale }),
    cubic({ x: 0, y: -h * scale }, { x: -w * 0.36 * scale, y: -h * 0.7 * scale }, { x: -w * bow * scale, y: -h * 0.18 * scale }, { x: 0, y }),
  );
  const rounded = (scale = 1, y = 2): Point[] => join(
    cubic({ x: 0, y }, { x: w * 0.72 * scale, y: -h * 0.18 * scale }, { x: w * 0.62 * scale, y: -h * 0.78 * scale }, { x: 0, y: -h * scale }),
    cubic({ x: 0, y: -h * scale }, { x: -w * 0.62 * scale, y: -h * 0.78 * scale }, { x: -w * 0.72 * scale, y: -h * 0.18 * scale }, { x: 0, y }),
  );
  const vein = (x = 0, y = 0, scale = 1): Point[] => cubic(
    { x, y }, { x: w * 0.12, y: -h * 0.25 }, { x: -w * 0.1, y: -h * 0.6 * scale }, { x, y: -h * 0.86 * scale }, 18,
  );
  const bridge = (depth = .16, scale = 1): Point[] => cubic(
    { x: -w * .48 * scale, y: 2 },
    { x: -w * .32 * scale, y: -h * depth },
    { x: w * .32 * scale, y: -h * depth },
    { x: w * .48 * scale, y: 2 },
    20,
  );
  const smallPetal = (cx: number, baseY: number, halfWidth: number, petalHeight: number): Point[] => join(
    cubic(
      { x: cx, y: baseY },
      { x: cx + halfWidth, y: baseY - petalHeight * .28 },
      { x: cx + halfWidth * .58, y: baseY - petalHeight * .78 },
      { x: cx, y: baseY - petalHeight },
      10,
    ),
    cubic(
      { x: cx, y: baseY - petalHeight },
      { x: cx - halfWidth * .58, y: baseY - petalHeight * .78 },
      { x: cx - halfWidth, y: baseY - petalHeight * .28 },
      { x: cx, y: baseY },
      10,
    ),
  );

  switch (snapshot.kind) {
    case 'lotus':
      return [
        { points: pointed(), closed: true, fill: 0.24, width: 1.15 },
        { points: pointed(0.78, 0), closed: true, fill: 0.11, detail: true },
        { points: pointed(0.53, -1), closed: true, fill: 0.07, detail: true },
        { points: vein(), width: 0.72, detail: true },
        { points: cubic({ x: -w * .55, y: -h * .18 }, { x: -w * .25, y: -h * .48 }, { x: -w * .12, y: -h * .62 }, { x: 0, y: -h * .76 }), detail: true },
        { points: cubic({ x: w * .55, y: -h * .18 }, { x: w * .25, y: -h * .48 }, { x: w * .12, y: -h * .62 }, { x: 0, y: -h * .76 }), detail: true },
        { points: smallPetal(-w * .28, -h * .05, w * .13, h * .34), closed: true, fill: .06, detail: true },
        { points: smallPetal(w * .28, -h * .05, w * .13, h * .34), closed: true, fill: .06, detail: true },
        { points: bridge(.18), width: 1.05 },
        { points: bridge(.1, .76), detail: true },
      ];
    case 'rounded':
      return [
        { points: rounded(), closed: true, fill: 0.24, width: 1.1 },
        { points: rounded(0.76), closed: true, fill: 0.11, detail: true },
        { points: rounded(0.52), closed: true, fill: 0.07, detail: true },
        { points: vein(0, 2, .82), detail: true },
        { points: ellipsePoints(0, -h * .42, w * .19, h * .13), detail: true, fill: .1 },
        { points: smallPetal(-w * .29, -h * .08, w * .12, h * .28), closed: true, fill: .06, detail: true },
        { points: smallPetal(w * .29, -h * .08, w * .12, h * .28), closed: true, fill: .06, detail: true },
        { points: bridge(.2), width: 1.05 },
        { points: bridge(.11, .72), detail: true },
      ];
    case 'leaf':
      return [
        { points: join(
          cubic({ x: -w * .15, y: 2 }, { x: w * .72, y: -h * .22 }, { x: w * .48, y: -h * .72 }, { x: 0, y: -h }),
          cubic({ x: 0, y: -h }, { x: -w * .28, y: -h * .65 }, { x: -w * .52, y: -h * .2 }, { x: -w * .15, y: 2 }),
        ), closed: true, fill: .24 },
        { points: smallPetal(-w * .05, -h * .05, w * .3, h * .7), closed: true, fill: .08, detail: true },
        { points: vein(-w * .12, 0, .98), detail: true },
        { points: cubic({ x: -w * .08, y: -h * .28 }, { x: w * .16, y: -h * .34 }, { x: w * .3, y: -h * .43 }, { x: w * .38, y: -h * .55 }), detail: true },
        { points: cubic({ x: -w * .08, y: -h * .48 }, { x: -w * .25, y: -h * .52 }, { x: -w * .28, y: -h * .62 }, { x: -w * .2, y: -h * .72 }), detail: true },
        { points: spiralPoints(w * .24, -h * .28, w * .13, 1), detail: true },
        { points: bridge(.18), width: 1.05 },
        { points: bridge(.09, .74), detail: true },
      ];
    case 'scallop':
      return [
        { points: cubic({ x: -w * .5, y: 0 }, { x: -w * .42, y: -h * 1.05 * bow }, { x: w * .42, y: -h * 1.05 * bow }, { x: w * .5, y: 0 }, 24), width: 1.2 },
        { points: cubic({ x: -w * .43, y: 0 }, { x: -w * .3, y: -h * .68 * bow }, { x: w * .3, y: -h * .68 * bow }, { x: w * .43, y: 0 }, 20), detail: true },
        { points: ellipsePoints(0, -h * .3, w * .12, w * .12), fill: .12, detail: true },
        { points: smallPetal(0, -h * .03, w * .2, h * .52), closed: true, fill: .08, detail: true },
        { points: smallPetal(-w * .25, 0, w * .11, h * .28), closed: true, detail: true },
        { points: smallPetal(w * .25, 0, w * .11, h * .28), closed: true, detail: true },
        { points: bridge(.2), width: 1.05 },
        { points: cubic({ x: -w * .5, y: 2 }, { x: -w * .25, y: h * .12 }, { x: w * .25, y: h * .12 }, { x: w * .5, y: 2 }), detail: true },
      ];
    case 'paisley':
      return [
        { points: join(
          cubic({ x: -w * .42, y: 0 }, { x: w * .65, y: -h * .02 }, { x: w * .66, y: -h * .64 }, { x: 0, y: -h }),
          cubic({ x: 0, y: -h }, { x: -w * .2, y: -h * .55 }, { x: -w * .78, y: -h * .45 }, { x: -w * .42, y: 0 }),
        ), closed: true, fill: .24 },
        { points: join(
          cubic({ x: -w * .24, y: -h * .08 }, { x: w * .42, y: -h * .12 }, { x: w * .43, y: -h * .55 }, { x: 0, y: -h * .78 }),
          cubic({ x: 0, y: -h * .78 }, { x: -w * .08, y: -h * .5 }, { x: -w * .48, y: -h * .38 }, { x: -w * .24, y: -h * .08 }),
        ), closed: true, fill: .08, detail: true },
        { points: spiralPoints(w * .03, -h * .44, w * .28, 1), detail: true },
        { points: spiralPoints(-w * .18, -h * .24, w * .12, -1), detail: true },
        { points: cubic({ x: -w * .32, y: -h * .1 }, { x: w * .12, y: -h * .16 }, { x: w * .38, y: -h * .42 }, { x: w * .22, y: -h * .68 }), detail: true },
        { points: smallPetal(w * .32, -h * .04, w * .11, h * .3), closed: true, detail: true },
        { points: bridge(.18), width: 1.05 },
        { points: bridge(.1, .72), detail: true },
      ];
    case 'compound':
      return [
        { points: pointed(), closed: true, fill: .24, width: 1.2 },
        { points: rounded(.82), closed: true, fill: .11, detail: true },
        { points: vein(0, 2, .96), detail: true },
        { points: pointed(.56, -2), closed: true, fill: .07, detail: true },
        { points: smallPetal(-w * .26, -h * .06, w * .15, h * .46), closed: true, fill: .06, detail: true },
        { points: smallPetal(w * .26, -h * .06, w * .15, h * .46), closed: true, fill: .06, detail: true },
        { points: spiralPoints(-w * .31, -h * .28, w * .18, -1), detail: true },
        { points: spiralPoints(w * .31, -h * .28, w * .18, 1), detail: true },
        { points: bridge(.2), width: 1.1 },
        { points: bridge(.11, .74), detail: true },
      ];
  }
}

function drawPartialPath(ctx: CanvasRenderingContext2D, points: Point[], progress: number, closed = false) {
  if (points.length < 2 || progress <= 0) return;
  const segmentCount = closed ? points.length : points.length - 1;
  const exact = clamp(progress, 0, 1) * segmentCount;
  const complete = Math.min(segmentCount, Math.floor(exact));
  const fraction = exact - complete;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index <= complete && index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  if (complete < segmentCount && fraction > 0) {
    const from = points[complete % points.length];
    const to = points[(complete + 1) % points.length];
    ctx.lineTo(lerp(from.x, to.x, fraction), lerp(from.y, to.y, fraction));
  }
  if (closed && progress >= 1) ctx.closePath();
}

function drawMotif(ctx: CanvasRenderingContext2D, snapshot: MotifSnapshot, progress: number) {
  const random = seeded(snapshot.seed);
  const disorder = getMandalaDegradation(snapshot.quality);
  const angleError = (random() - .5) * .28 * disorder;
  const radialError = (random() - .5) * 32 * disorder;
  const xScale = 1 + (random() - .5) * .48 * disorder;
  const yScale = 1 + (random() - .5) * .4 * disorder;
  const skew = (random() - .5) * .28 * disorder;
  const shapes = buildMotif(snapshot);
  const outline = hsvToCss(snapshot.hue, snapshot.saturation, snapshot.value, .94);
  const detailOutline = hsvToCss(snapshot.hue, snapshot.saturation * .92, snapshot.value, .76);
  const fill = hsvToCss(snapshot.hue, snapshot.saturation * .82, Math.min(1, snapshot.value + .04), 1);

  ctx.save();
  ctx.rotate(snapshot.angle + angleError);
  ctx.translate(0, -snapshot.radius - radialError);
  ctx.transform(xScale, skew, -skew * .35, yScale, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const visibleShapes = shapes.filter((shape, index) => {
    if (!shape.detail) return true;
    const detailChance = .04 + snapshot.quality * .96;
    return random() < detailChance || index === 1 && snapshot.quality > .48;
  });
  visibleShapes.forEach((shape, index) => {
    const localProgress = clamp(progress * visibleShapes.length - index, 0, 1);
    if (localProgress <= 0) return;
    const gap = shape.detail ? disorder * random() * .28 : disorder * random() * .14;
    const pathProgress = localProgress >= 1 ? 1 - gap : localProgress * (1 - gap);
    drawPartialPath(ctx, shape.points, pathProgress, shape.closed);
    if (shape.closed && localProgress >= 1 && shape.fill) {
      ctx.globalAlpha = shape.fill * (.45 + snapshot.quality * .55);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      drawPartialPath(ctx, shape.points, pathProgress, shape.closed);
    }
    ctx.setLineDash(shape.dash ?? []);
    ctx.strokeStyle = shape.detail ? detailOutline : outline;
    const hierarchyWidth = shape.width ?? (shape.detail ? .7 : 1);
    ctx.lineWidth = snapshot.strokeWidth * hierarchyWidth * (1 + (random() - .5) * .8 * disorder);
    ctx.stroke();
  });
  ctx.restore();
}

function ringSpec(index: number, radius: number) {
  const kind = MOTIF_ORDER[index % MOTIF_ORDER.length];
  const tier = Math.floor(index / MOTIF_ORDER.length);
  const styleIndex = index % MOTIF_ORDER.length;
  const baseRepeats = [8, 12, 10, 12, 10, 10][styleIndex];
  // Divider and leaf layers stay especially fine-grained; the major petal
  // families use fewer, larger sectors so their silhouettes remain legible.
  const targetArcLength = [28, 16, 29, 21, 27, 30][styleIndex];
  const circumferenceRepeats = Math.round(TAU * Math.max(radius, 18) / targetArcLength / 2) * 2;
  const repeats = Math.min(72, Math.max(baseRepeats, circumferenceRepeats));
  const height = [34, 22, 40, 36, 42, 48][styleIndex] + Math.min(16, tier * 1.2);
  return { kind, repeats, height };
}

export const EegMandalaCanvas: React.FC<EegMandalaCanvasProps> = ({
  eegData,
  recentInZonePercent,
  isPaused = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pausedRef = useRef(isPaused);
  const targetsRef = useRef<MandalaMetricTargets>(getMandalaMetricTargets(eegData, recentInZonePercent));

  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => {
    targetsRef.current = getMandalaMetricTargets(eegData, recentInZonePercent);
  }, [eegData, recentInZonePercent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const completedCanvas = document.createElement('canvas');
    let completedCtx = completedCanvas.getContext('2d');
    if (!completedCtx) return;
    const completed: MotifSnapshot[] = [];
    let animationId = 0;
    let lastTime = performance.now();
    let ringIndex = 0;
    let motifIndex = 0;
    let motifProgress = 0;
    let currentRadius = 10;
    let completedArtworkRadius = 0;
    let active: MotifSnapshot | null = null;
    let cameraScale = 1;
    let bufferScale = 1;
    let hasInitialCamera = false;
    let baselinePower = 0;
    let smoothed = { ...targetsRef.current };
    const motifSeconds = 5.625;

    const setupCanvas = (target: HTMLCanvasElement, width: number, height: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      target.width = Math.max(1, Math.round(width * dpr));
      target.height = Math.max(1, Math.round(height * dpr));
      return dpr;
    };

    const stampToBuffer = (snapshot: MotifSnapshot) => {
      const width = canvas.getBoundingClientRect().width;
      const dpr = completedCanvas.width / Math.max(1, width);
      completedCtx?.save();
      completedCtx?.setTransform(dpr * bufferScale, 0, 0, dpr * bufferScale, completedCanvas.width / 2, completedCanvas.height / 2);
      if (completedCtx) drawMotif(completedCtx, snapshot, 1);
      completedCtx?.restore();
    };

    const replayCompleted = () => completed.forEach(stampToBuffer);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      setupCanvas(canvas, rect.width, rect.height);
      setupCanvas(completedCanvas, rect.width, rect.height);
      completedCtx = completedCanvas.getContext('2d');
      if (!hasInitialCamera && completed.length === 0) {
        cameraScale = getTargetCameraScale(rect.width, rect.height, 0);
        hasInitialCamera = true;
      }
      bufferScale = cameraScale;
      replayCompleted();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const rebaseBuffer = (nextScale: number) => {
      const old = document.createElement('canvas');
      old.width = completedCanvas.width;
      old.height = completedCanvas.height;
      old.getContext('2d')?.drawImage(completedCanvas, 0, 0);
      completedCtx?.clearRect(0, 0, completedCanvas.width, completedCanvas.height);
      const ratio = nextScale / bufferScale;
      const destW = old.width * ratio;
      const destH = old.height * ratio;
      completedCtx?.drawImage(old, (old.width - destW) / 2, (old.height - destH) / 2, destW, destH);
      bufferScale = nextScale;
    };

    const makeActive = () => {
      const spec = ringSpec(ringIndex, currentRadius);
      const total = smoothed.totalPower;
      if (total > 0) baselinePower = baselinePower === 0 ? total : lerp(baselinePower, total, .012);
      const powerNorm = normalizeTotalPower(total, baselinePower || total);
      const angularOffset = ringIndex % 2 ? Math.PI / spec.repeats : 0;
      active = {
        kind: spec.kind,
        radius: currentRadius,
        angle: motifIndex / spec.repeats * TAU + angularOffset,
        // Broad, interlocking motifs avoid the appearance of isolated radial
        // marks and produce the dense layered character of a drawn mandala.
        width: Math.min(90, Math.max(17, TAU * Math.max(currentRadius, 16) / spec.repeats * 1.12)),
        height: spec.height,
        hue: smoothed.hue,
        saturation: smoothed.saturation,
        value: smoothed.value,
        curvature: smoothed.thetaCurvature,
        strokeWidth: lerp(.525, 1.6, powerNorm),
        // The source is already a rolling metric. Keep fidelity exact:
        // degradation = 1 - normalized recent in-zone.
        quality: targetsRef.current.quality,
        seed: (ringIndex + 1) * 100003 + motifIndex * 7919,
      };
    };

    const advance = () => {
      if (active) {
        completed.push(active);
        stampToBuffer(active);
        completedArtworkRadius = Math.max(completedArtworkRadius, active.radius + active.height);
      }
      const spec = ringSpec(ringIndex, currentRadius);
      motifIndex += 1;
      motifProgress = 0;
      active = null;
      if (motifIndex >= spec.repeats) {
        currentRadius += spec.height * .48 + 4;
        ringIndex += 1;
        motifIndex = 0;
      }
    };

    const render = (time: number) => {
      const dt = Math.min(.08, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const target = targetsRef.current;
      const smoothing = 1 - Math.exp(-dt * 2.4);
      smoothed = {
        ...target,
        focus: lerp(smoothed.focus, target.focus, smoothing),
        relaxation: lerp(smoothed.relaxation, target.relaxation, smoothing),
        coherence: lerp(smoothed.coherence, target.coherence, smoothing),
        thetaCurvature: lerp(smoothed.thetaCurvature, target.thetaCurvature, smoothing),
        totalPower: lerp(smoothed.totalPower, target.totalPower, smoothing),
        hue: smoothed.hue + ((((target.hue - smoothed.hue) % 360) + 540) % 360 - 180) * smoothing,
        saturation: lerp(smoothed.saturation, target.saturation, smoothing),
        value: lerp(smoothed.value, target.value, smoothing),
        quality: target.quality,
      };

      if (!pausedRef.current) {
        if (!active) makeActive();
        motifProgress += dt / motifSeconds;
        if (motifProgress >= 1) advance();
      }

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const dpr = canvas.width / Math.max(1, width);
      // Track what is actually visible, rather than reserving space for a
      // not-yet-drawn ring. The main silhouette is the first motif path, so
      // its radial reach develops early while the nested details follow.
      const activeReveal = active ? clamp(motifProgress * 6, 0, 1) : 0;
      const activeArtworkRadius = active ? active.radius + active.height * activeReveal : 0;
      const artworkRadius = Math.max(completedArtworkRadius, activeArtworkRadius);
      const targetScale = getTargetCameraScale(width, height, artworkRadius);
      cameraScale = lerp(cameraScale, targetScale, 1 - Math.exp(-dt * CAMERA_EASING_RATE));
      const bufferScaleRatio = cameraScale / bufferScale;
      if (bufferScaleRatio < BUFFER_REBASE_MIN_RATIO || bufferScaleRatio > BUFFER_REBASE_MAX_RATIO) {
        rebaseBuffer(cameraScale);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const backdrop = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * .68);
      backdrop.addColorStop(0, '#e8dcc7');
      backdrop.addColorStop(.65, '#d4b895');
      backdrop.addColorStop(1, '#8b9d83');
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = .98;
      const bufferRatio = cameraScale / bufferScale;
      const drawWidth = width * bufferRatio;
      const drawHeight = height * bufferRatio;
      ctx.drawImage(completedCanvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      ctx.restore();

      if (active) {
        ctx.save();
        ctx.setTransform(dpr * cameraScale, 0, 0, dpr * cameraScale, canvas.width / 2, canvas.height / 2);
        drawMotif(ctx, active, clamp(motifProgress, 0, 1));
        ctx.restore();
      }

      if (pausedRef.current) {
        ctx.save();
        ctx.fillStyle = 'rgba(96, 108, 56, .16)';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      completed.length = 0;
    };
  }, []);

  return (
    <div className="eeg-mandala-experience">
      <canvas ref={canvasRef} aria-label="A procedural EEG-driven mandala growing outward" />
      <div className="eeg-mandala-vignette" aria-hidden="true" />
    </div>
  );
};
