/**
 * 측정 도구(줄자·각도기): SketchUp처럼 추정(스냅, snap.ts)으로 점을 찍어 거리·각도를 잰다.
 * 코어의 두 점 측정(viewer.setMeasureMode)은 쓰지 않는다 — 이 도구가 대신한다.
 *
 * 앱에 잇는 차례:
 *   1. 뷰어·덧그림(Overlay.attach)을 만든 뒤 `new MeasureTool(viewer, overlay, { getScene, getUnits, onResult, onHint })`.
 *   2. 도구 단추: `tool.setMode('tape' | 'protractor' | null)`(같은 단추를 다시 누르면 null). 장면을 바꾸면 `tool.clear()`.
 *   3. `viewer.onPick`: `tool.active`이면 무시한다(이 도구가 그 누르기를 쓴다).
 *   4. 창 keydown·keyup(캡처 단계): `tool.handleKey(e)`가 true면 처리 끝. Esc keydown에서 false면(지울 것이 없음) 앱이 도구를 끈다.
 *   5. 앱을 닫을 때 `tool.dispose()`.
 *
 * 입력: 캔버스 포인터 이벤트를 엿본다(막지 않는다). 왼쪽 단추·탭을 코어의 끌기 시작 거리(tapSlopPx — 마우스·펜 4화소,
 * 터치 10화소) 안에서 떼면 점 찍기, 끌기·오른쪽·가운데 단추·두 손가락은 코어 궤도·이동·확대 그대로(그 거리 안의 손가락 떨림은
 * 코어도 돌리지 않고 누르기로 본다). 터치는 추정 반경을 넓힌다(커서 표식은 탭한 점에 남긴다).
 * 정밀 조준(터치): 한 손가락을 끌기 시작 거리 안에서 AIM_HOLD_MS 동안 누르고 있으면 손가락 위 AIM_OFFSET_PX에 십자선을 띄우고,
 *   끌면 궤도 대신 십자선이 따라가며 마우스처럼 추정·고무줄·툴팁을 보인다. 떼면 십자선 자리에 점을 찍는다.
 *   그동안의 움직임은 캔버스 부모의 캡처 단계에서 막아 코어가 돌리지 않게 한다(떼기는 코어에 넘겨 끌기 상태를 끝낸다).
 * 줄자: 두 점 → { kind: 'tape', a, b, distance, dx, dy, dz }(장면 단위).
 * 각도기: 중심 → 기준 방향 → 잴 방향 → { kind: 'protractor', center, a, b, angle(도, 0~180), normal }.
 *   평면은 중심을 찍을 때 커서 밑 면, 없으면 카메라를 가장 정면으로 보는 축 평면. Shift를 누르고 있으면 그 평면을 고정한다.
 * 결과 선·점·라벨은 카메라가 움직여도 남고, 다음 측정을 시작하거나 clear·setMode를 하면 지운다.
 * 그리기는 덧그림 층의 SVG 묶음(g.measure)과 DOM 라벨(div.measure-layer)로 하고, 숫자 글은 모형 단위(units.ts)로 쓴다.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { dragStartPx } from 'opencad-viewer3d/pointer';
import type { Scene3d } from 'opencad-viewer3d/types';
import { projectToScreen, screenRay, viewDepth, worldPerPixel, type ViewFrame } from 'opencad-viewer3d/camera';
import type { V3 } from 'opencad-viewer3d/math';
import { screenPoint, screenSegment, svgEl, type Overlay } from './overlay';
import { formatAngle, formatLength, mmPerSceneUnit, type UnitsDisplay } from './units';
import {
  AIM_SNAP_RADIUS_PX,
  AXIS_COLORS,
  AXIS_DIRS,
  CORE_PICK_TOLERANCE_PX,
  SNAP_COLORS,
  SNAP_RADIUS_PX,
  TOUCH_SNAP_RADIUS_PX,
  axisOf,
  chooseSnap,
  probeOffsets,
  rayPlane,
  type Axis,
  type Ray,
  type Snap,
} from './snap';

export type MeasureMode = 'tape' | 'protractor';

export interface TapeResult {
  kind: 'tape';
  a: V3;
  b: V3;
  distance: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ProtractorResult {
  kind: 'protractor';
  center: V3;
  /** 기준 방향 점(평면 위) */
  a: V3;
  /** 잰 방향 점(평면 위) */
  b: V3;
  /** 도, 0~180 */
  angle: number;
  /** 각도기 평면 법선(단위) */
  normal: V3;
}

export type MeasureToolResult = TapeResult | ProtractorResult;

export interface MeasureToolOptions {
  getScene: () => Pick<Scene3d, 'meshes' | 'lines' | 'units'> | null;
  getUnits: () => UnitsDisplay;
  /** 측정을 마치면 결과, 결과를 지우면 null */
  onResult: (r: MeasureToolResult | null) => void;
  /** 상태 줄 안내(도구를 끄면 null) */
  onHint?: (text: string | null) => void;
  /** 손가락이 주인 기기인지: 안내에서 키(Esc·Shift) 설명을 빼고 길게 누르기를 알린다 */
  touch?: () => boolean;
  /** 선분(묶음 id, 선분 번호)이 든 호·원의 중심(세계, 곡선이 아니면 null) — "중심" 추정 */
  curveCenter?: (id: string, seg: number) => V3 | null;
}

/** 기억해 두는 지나간 곡선 중심 수 */
export const RECENT_CENTERS = 4;

/** 이 도구가 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type MeasureViewer = Pick<Viewer3d, 'canvas' | 'pick' | 'getCamera' | 'onCameraChange' | 'getRenderMode' | 'section'>;
/** 이 도구가 쓰는 덧그림 기능 */
export type MeasureOverlay = Pick<Overlay, 'svg' | 'labels' | 'set' | 'frame' | 'invalidate'>;

/**
 * 누르기로 볼 최대 움직임(화소): 코어 끌기 시작 거리와 같다(마우스·펜 DRAG_START_PX 4, 터치 TOUCH_DRAG_START_PX 10).
 * 이보다 덜 움직였으면 코어도 돌리지 않으므로, 손가락이 몇 화소 떨려도 점을 찍고 정밀 조준 타이머도 이어 간다
 */
export const tapSlopPx = (pointerType: string): number => dragStartPx(pointerType);
/** 이만큼(ms) 움직이지 않고 누르고 있으면 정밀 조준 */
export const AIM_HOLD_MS = 350;
/** 정밀 조준 십자선을 손가락 위로 띄우는 거리(화소) — 손가락에 가리지 않게 */
export const AIM_OFFSET_PX = 64;
/** 둘레 고르기 시간 한도(ms): 마우스는 움직일 때마다, 터치는 탭할 때만 */
const PROBE_BUDGET_MS = 6;
const TOUCH_PROBE_BUDGET_MS = 24;
/** 가림 판정 고르기 최대 횟수(추정 한 번에) */
const VISIBLE_CHECKS = 4;
/** 각도기 원판 반지름·호 반지름(화소) */
const PROTRACTOR_PX = 44;
const ARC_PX = 26;
const PAINTER_KEY = 'measure';

// ───────────────────────── 순수 함수 ─────────────────────────

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const addScaled = (p: readonly number[], u: readonly number[], s: number): V3 => [p[0]! + u[0]! * s, p[1]! + u[1]! * s, p[2]! + u[2]! * s];
function unit(a: readonly number[]): V3 {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return l > 1e-300 ? [a[0]! / l, a[1]! / l, a[2]! / l] : [0, 0, 0];
}

/** 추정 반경(화소): 터치는 넓게, 정밀 조준('aim')은 그 사이 */
export function snapRadius(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_SNAP_RADIUS_PX : pointerType === 'aim' ? AIM_SNAP_RADIUS_PX : SNAP_RADIUS_PX;
}

/** 정밀 조준 십자선 자리: 손가락 바로 위(보기 위 가장자리에서 멈춘다) */
export function aimPoint(x: number, y: number): { x: number; y: number } {
  return { x, y: Math.max(0, y - AIM_OFFSET_PX) };
}

/** 줄자 결과(장면 단위) */
export function tapeResult(a: readonly number[], b: readonly number[]): TapeResult {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
  return { kind: 'tape', a: [a[0]!, a[1]!, a[2]!], b: [b[0]!, b[1]!, b[2]!], distance: Math.hypot(dx, dy, dz), dx, dy, dz };
}

/** 법선 n 평면에 비친 u와 v 사이 각(도, 0~180). 비친 길이가 0이면 0 */
export function planeAngle(u: readonly number[], v: readonly number[], n: readonly number[]): number {
  const nn = unit(n);
  const a = unit(addScaled(u, nn, -dot(u, nn)));
  const b = unit(addScaled(v, nn, -dot(v, nn)));
  if (!dot(a, a) || !dot(b, b)) return 0;
  // acos는 0·180° 둘레에서 정밀도를 잃어 atan2로 잰다
  return (Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) * 180) / Math.PI;
}

/** 각도기 결과 */
export function protractorResult(center: readonly number[], a: readonly number[], b: readonly number[], normal: readonly number[]): ProtractorResult {
  const c: V3 = [center[0]!, center[1]!, center[2]!];
  return { kind: 'protractor', center: c, a: [a[0]!, a[1]!, a[2]!], b: [b[0]!, b[1]!, b[2]!], angle: planeAngle(sub(a, c), sub(b, c), normal), normal: unit(normal) };
}

/**
 * 각도기 평면: 추정에 면 법선이 있으면 그 면, 없으면 카메라를 가장 정면으로 보는 축 평면(SketchUp 파랑·빨강·초록 각도기).
 * forward는 눈이 보는 방향.
 */
export function protractorPlane(snap: Pick<Snap, 'normal'> | null, forward: readonly number[]): { normal: V3; axis: Axis | null } {
  if (snap?.normal) {
    const n = unit(snap.normal);
    if (dot(n, n) > 0) return { normal: n, axis: axisOf(n) };
  }
  let best: Axis = 'z';
  for (const a of ['z', 'x', 'y'] as const) if (Math.abs(dot(AXIS_DIRS[a], forward)) > Math.abs(dot(AXIS_DIRS[best], forward)) + 1e-12) best = a;
  return { normal: [...AXIS_DIRS[best]], axis: best };
}

/** 점을 평면(지나는 점 c, 법선 n)에 내린 점 */
export function projectToPlane(p: readonly number[], c: readonly number[], n: readonly number[]): V3 {
  const nn = unit(n);
  return addScaled(p, nn, -dot(sub(p, c), nn));
}

/**
 * 각도기 둘째·셋째 점: 끝점·중간점·모서리·축 추정은 그 점을 평면에 내리고,
 * 면 위·빈 곳은 커서 광선과 평면의 교점(평면이 거의 옆으로 보이면 내린 점).
 */
export function protractorPoint(ray: Ray, snap: Pick<Snap, 'kind' | 'point'>, center: readonly number[], normal: readonly number[]): V3 {
  const n = unit(normal);
  if ((snap.kind === 'onFace' || snap.kind === 'free') && Math.abs(dot(n, ray.dir)) > 0.02) {
    const p = rayPlane(ray, center, n);
    if (p) return p;
  }
  return projectToPlane(snap.point, center, n);
}

/**
 * 툴팁 자리: 커서 오른쪽 아래, 보기 밖으로 나가면 왼쪽·위로 뒤집는다.
 * above(정밀 조준)면 커서 오른쪽 위 — 아래에는 손가락이 있다. 위가 모자라면 아래로.
 */
export function tooltipPosition(x: number, y: number, w: number, h: number, width: number, height: number, above = false): { left: number; top: number } {
  let left = x + 14;
  let top = above ? y - 18 - h : y + 18;
  if (left + w > width - 2) left = x - 10 - w;
  if (above ? top < 2 : top + h > height - 2) top = above ? y + 18 : y - 10 - h;
  left = Math.max(2, Math.min(left, width - w - 2));
  top = Math.max(2, Math.min(top, height - h - 2));
  return { left: Math.round(left), top: Math.round(top) };
}

/** 툴팁 글: "끝점 · 1200 mm" */
export function joinTip(label: string, value?: string | null): string {
  return [label, value].filter((s) => !!s).join(' · ');
}

/** 상태 줄 안내. touch면 키 설명 대신 길게 누르기(정밀 조준)를 알린다 */
export function measureHint(mode: MeasureMode | null, points: number, hasResult: boolean, touch = false): string | null {
  if (mode === 'tape') {
    if (points === 1) return touch ? '줄자: 끝점을 누르세요' : '줄자: 끝점을 누르세요 · Esc 취소';
    if (hasResult) return touch ? '줄자: 다시 누르면 새로 잽니다' : '줄자: 다시 누르면 새로 잽니다 · Esc 지우기';
    return touch ? '줄자: 잴 시작점을 누르세요 · 길게 누르면 정밀 조준' : '줄자: 잴 시작점을 누르세요';
  }
  if (mode === 'protractor') {
    if (points === 1) return touch ? '각도기: 기준 방향의 점을 누르세요' : '각도기: 기준 방향의 점을 누르세요 · Esc 취소';
    if (points === 2) return touch ? '각도기: 잴 방향의 점을 누르세요' : '각도기: 잴 방향의 점을 누르세요 · Esc 취소';
    if (hasResult) return touch ? '각도기: 다시 누르면 새로 잽니다' : '각도기: 다시 누르면 새로 잽니다 · Esc 지우기';
    return touch ? '각도기: 중심점을 누르세요 · 길게 누르면 정밀 조준' : '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정';
  }
  return null;
}

/** 평면 안 단위 기저(u, v): 원판·호 그리기용 */
function planeBasis(n: readonly number[]): [V3, V3] {
  const nn = unit(n);
  const u = unit(Math.abs(nn[2]) < 0.9 ? cross(nn, [0, 0, 1]) : cross(nn, [1, 0, 0]));
  return [u, cross(nn, u)];
}

// ───────────────────────── 도구 ─────────────────────────

interface Press {
  x: number;
  y: number;
  /** 마지막 자리(떨린 만큼 — 정밀 조준 십자선을 지금 손가락 위에 띄운다) */
  lx: number;
  ly: number;
  button: number;
  type: string;
  moved: boolean;
}

interface Cursor {
  x: number;
  y: number;
  type: string;
}

export class MeasureTool {
  private modeValue: MeasureMode | null = null;
  /** 찍은 점(줄자: 시작점, 각도기: 중심·기준 방향) */
  private pts: V3[] = [];
  /** 각도기 평면(중심을 찍으면 정한다) */
  private normal: V3 | null = null;
  /** Shift로 고정한 각도기 평면 */
  private planeLock: V3 | null = null;
  /** 커서 밑 각도기 평면(Shift 고정에 쓴다) */
  private hoverPlane: V3 | null = null;
  private resultValue: MeasureToolResult | null = null;
  private cursor: Cursor | null = null;
  private hover: Snap | null = null;
  /** 지금 커서로 찍힐 점(각도기 둘째·셋째 점은 평면 위) */
  private hoverPoint: V3 | null = null;
  private hoverDirty = false;
  private dragging = false;
  private presses = new Map<number, Press>();
  private cancelTap = false;
  /** 정밀 조준 중인 손가락(포인터 id)과 길게 누르기 타이머 */
  private aimId: number | null = null;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHint: string | null = null;
  /** 앞서 커서가 지나간 호·원의 중심(새것이 앞) */
  private centers: V3[] = [];
  private readonly g: SVGGElement;
  private readonly layer: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly off: (() => void)[] = [];
  private disposed = false;

  constructor(
    private readonly viewer: MeasureViewer,
    private readonly overlay: MeasureOverlay,
    private readonly opts: MeasureToolOptions,
  ) {
    this.g = svgEl('g', { class: 'measure' });
    this.layer = document.createElement('div');
    this.layer.className = 'measure-layer';
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.tip = document.createElement('div');
    this.tip.className = 'measure-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;display:none;';
    const cv = viewer.canvas;
    const on = <E extends Event>(el: EventTarget, type: string, fn: (e: E) => void): void => {
      el.addEventListener(type, fn as EventListener);
      this.off.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on<PointerEvent>(cv, 'pointerdown', (e) => this.onDown(e));
    on<PointerEvent>(cv, 'pointermove', (e) => this.onMove(e));
    on<PointerEvent>(cv, 'pointerup', (e) => this.onUp(e, false));
    on<PointerEvent>(cv, 'pointercancel', (e) => this.onUp(e, true));
    on<PointerEvent>(cv, 'pointerleave', () => this.onLeave());
    // 정밀 조준: 캔버스보다 먼저(부모 캡처 단계) 받아, 조준 중인 손가락의 움직임이 코어 궤도로 가지 않게 막는다
    const trap = cv.parentElement ?? cv;
    this.off.push(capture(trap, 'pointermove', (e) => this.onAimMove(e)));
    this.off.push(capture(trap, 'pointerup', (e) => this.onAimUp(e, false)));
    this.off.push(capture(trap, 'pointercancel', (e) => this.onAimUp(e, true)));
    this.off.push(
      viewer.onCameraChange(() => {
        if (!this.modeValue) return;
        // 휠 확대 등으로 보기가 바뀌면 같은 커서 자리에서 다시 추정한다(끄는 중에는 숨긴다)
        if (this.cursor && this.cursor.type !== 'touch') this.hoverDirty = true;
        this.overlay.invalidate();
      }),
    );
  }

  /** 도구가 켜져 있는지: 켜진 동안 캔버스 누르기는 이 도구가 쓴다(앱은 코어 onPick을 무시한다) */
  get active(): boolean {
    return this.modeValue !== null;
  }

  get mode(): MeasureMode | null {
    return this.modeValue;
  }

  /** 정밀 조준 중인지(길게 눌러 십자선을 옮기는 중) */
  get aiming(): boolean {
    return this.aimId !== null;
  }

  /** 진행 중 측정에 찍은 점 수(줄자 0~1, 각도기 0~2) */
  get pointCount(): number {
    return this.pts.length;
  }

  /** 마지막 측정 결과 */
  get result(): MeasureToolResult | null {
    return this.resultValue;
  }

  /** 도구 켜기·바꾸기·끄기(null). 진행 중 점과 결과는 지운다 */
  setMode(mode: MeasureMode | null): void {
    if (this.disposed) return;
    const same = mode === this.modeValue;
    if (!same) this.reset();
    this.modeValue = mode;
    this.viewer.canvas.style.cursor = mode ? 'crosshair' : '';
    if (mode) {
      if (!this.g.isConnected) this.overlay.svg.append(this.g);
      if (!this.layer.isConnected) this.overlay.labels.append(this.layer);
      this.overlay.set(PAINTER_KEY, (f) => this.paint(f));
    } else {
      this.overlay.set(PAINTER_KEY, null);
      this.g.replaceChildren();
      this.layer.replaceChildren();
      this.g.remove();
      this.layer.remove();
    }
    this.refreshHint();
  }

  /** 진행 중 점과 결과 지우기(도구는 켜 둔다) */
  clear(): void {
    this.pts = [];
    this.normal = null;
    this.centers = [];
    this.dropResult();
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
  }

  /**
   * 키(keydown·keyup 모두 넘긴다). 처리했으면 true.
   * Esc: 진행 중 점 취소 → 결과 지우기 → (지울 것이 없으면) false — 앱이 도구를 끈다.
   * Shift(각도기, 중심을 찍기 전): 누르고 있는 동안 커서 밑 평면 고정.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.modeValue) return false;
    if (e.key === 'Escape') {
      if (e.type === 'keyup' || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (this.pts.length) {
        this.pts = [];
        this.normal = null;
        this.hoverDirty = true;
      } else if (this.resultValue) {
        this.dropResult();
      } else return false;
      e.preventDefault();
      this.refreshHint();
      this.overlay.invalidate();
      return true;
    }
    if (e.key === 'Shift' && this.modeValue === 'protractor') {
      this.setPlaneLock(e.type !== 'keyup');
      return true;
    }
    return false;
  }

  /**
   * 화면 점에서 추정 고르기(코어 고르기 + 둘레 고르기 + 가림 판정). 줄자·각도기의 시작점이 있으면 축 고정을 본다.
   * 프레임이 없으면(보기 크기 0) null.
   */
  snapAt(x: number, y: number, pointerType = 'mouse', frame: ViewFrame | null = this.overlay.frame()): Snap | null {
    const f = frame;
    if (!f) return null;
    const v = this.viewer;
    const scene = this.opts.getScene();
    const radius = snapRadius(pointerType);
    const t0 = now();
    const pick = v.pick(x, y);
    const budget = pointerType === 'touch' ? TOUCH_PROBE_BUDGET_MS : PROBE_BUDGET_MS;
    const probes: (ReturnType<MeasureViewer['pick']>)[] = [];
    for (const [dx, dy] of probeOffsets(radius, CORE_PICK_TOLERANCE_PX)) {
      if (now() - t0 > budget) break;
      probes.push(v.pick(x + dx, y + dy));
    }
    const sec = v.section;
    const kept = sec ? (p: V3): boolean => dot(sec.normal, p) <= sec.offset + 1e-9 * (Math.abs(sec.offset) + 1) : null;
    const mode = v.getRenderMode();
    let checks = 0;
    // 음영 모드에서만 가림을 본다: 후보 점의 화면 자리에서 다시 골라 그보다 앞의 면이 맞으면 가린 것
    const visible =
      mode === 'shaded' || mode === 'shadedEdges'
        ? (p: V3): boolean => {
            if (++checks > VISIBLE_CHECKS) return false;
            const s = projectToScreen(f, p);
            if (!s) return false;
            const k = v.pick(s[0], s[1]);
            if (!k || k.kind !== 'mesh') return true;
            const dp = viewDepth(f, p);
            return viewDepth(f, k.point) >= dp - Math.max(1e-6 * Math.abs(dp), worldPerPixel(f, dp) * 1.5);
          }
        : null;
    // 곡선 중심: 커서 둘레 곡선 선분의 중심을 재고 기억한다(가운데로 옮기면 붙게)
    const cc = this.opts.curveCenter;
    const curveCenter = cc
      ? (p: Parameters<NonNullable<Parameters<typeof chooseSnap>[0]['curveCenter']>>[0]): V3 | null => {
          const c = cc(p.id, p.raw ?? p.index);
          if (c) this.rememberCenter(c);
          return c;
        }
      : null;
    return chooseSnap({
      frame: f,
      x,
      y,
      pick,
      probes,
      scene,
      radius,
      from: this.pts[0] ?? null,
      anchor: v.getCamera().target,
      kept,
      visible,
      curveCenter,
      centers: this.centers,
    });
  }

  /** 지나간 곡선 중심 기억(같은 점은 앞으로 옮기고, RECENT_CENTERS개까지) */
  private rememberCenter(c: V3): void {
    const same = (a: V3): boolean => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) < 1e-9 * (1 + Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]));
    this.centers = [c, ...this.centers.filter((x) => !same(x))].slice(0, RECENT_CENTERS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.setMode(null);
    this.disposed = true;
    for (const f of this.off.splice(0)) f();
    this.presses.clear();
  }

  // ───────────────────────── 입력 ─────────────────────────

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.viewer.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    if (!this.modeValue) return;
    const p = this.local(e);
    const type = e.pointerType || 'mouse';
    // 둘째 손가락·다른 단추가 함께 눌리면 누르기가 아니다(코어가 확대·이동한다)
    if (this.presses.size) {
      this.cancelAim();
      this.cancelTap = true;
    }
    this.presses.set(e.pointerId, { x: p.x, y: p.y, lx: p.x, ly: p.y, button: e.button, type, moved: false });
    // 한 손가락을 그대로 누르고 있으면 정밀 조준
    if (type === 'touch' && this.presses.size === 1) {
      const id = e.pointerId;
      this.aimTimer = setTimeout(() => this.startAim(id), AIM_HOLD_MS);
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.modeValue) return;
    const p = this.local(e);
    const pr = this.presses.get(e.pointerId);
    if (pr) {
      pr.lx = p.x;
      pr.ly = p.y;
      if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) >= tapSlopPx(pr.type)) {
        pr.moved = true;
        this.stopAimTimer();
        // 궤도·이동 중에는 커서 표식을 숨긴다
        this.dragging = true;
        this.hover = null;
        this.hoverPoint = null;
        this.overlay.invalidate();
      }
      return;
    }
    const type = e.pointerType || 'mouse';
    if (type === 'touch' || e.buttons) return;
    this.cursor = { x: p.x, y: p.y, type };
    if (this.modeValue === 'protractor') this.setPlaneLock(!!e.shiftKey);
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    const pr = this.presses.get(e.pointerId);
    this.presses.delete(e.pointerId);
    this.stopAimTimer();
    if (!pr || !this.modeValue) return;
    const tap = !cancel && !pr.moved && !this.cancelTap && (pr.type === 'touch' || pr.button === 0);
    if (!this.presses.size) {
      this.cancelTap = false;
      if (this.dragging) {
        this.dragging = false;
        this.hoverDirty = true;
      }
    }
    if (tap) {
      const p = this.local(e);
      this.place(p.x, p.y, pr.type, e.shiftKey);
    } else this.overlay.invalidate();
  }

  private onLeave(): void {
    if (!this.modeValue || this.presses.size) return;
    if (this.cursor?.type === 'touch') return;
    this.cursor = null;
    this.hover = null;
    this.hoverPoint = null;
    this.overlay.invalidate();
  }

  // ───────────────────────── 정밀 조준(터치 길게 누르기) ─────────────────────────

  private stopAimTimer(): void {
    if (this.aimTimer === null) return;
    clearTimeout(this.aimTimer);
    this.aimTimer = null;
  }

  private startAim(id: number): void {
    this.aimTimer = null;
    const pr = this.presses.get(id);
    if (!this.modeValue || !pr || pr.moved || this.cancelTap || this.presses.size !== 1) return;
    this.aimId = id;
    this.dragging = false;
    this.cursor = { ...aimPoint(pr.lx, pr.ly), type: 'aim' };
    this.hoverDirty = true;
    // 짧은 떨림으로 조준이 시작됐음을 알린다(지원하는 기기만)
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 진동을 막은 브라우저 */
    }
    this.overlay.invalidate();
  }

  /** 조준 중인 손가락 움직임: 코어로 보내지 않고 십자선을 옮긴다 */
  private onAimMove(e: PointerEvent): void {
    if (this.aimId === null || e.pointerId !== this.aimId) return;
    e.stopPropagation();
    const p = this.local(e);
    this.cursor = { ...aimPoint(p.x, p.y), type: 'aim' };
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  /** 조준 중인 손가락을 떼면 십자선 자리에 점을 찍는다(떼기 이벤트는 코어에 넘겨 끌기 상태를 끝내게 한다) */
  private onAimUp(e: PointerEvent, cancel: boolean): void {
    if (this.aimId === null || e.pointerId !== this.aimId) return;
    const c = this.cursor;
    this.aimId = null;
    this.presses.delete(e.pointerId);
    if (!this.presses.size) this.cancelTap = false;
    if (!cancel && c && this.modeValue) this.place(c.x, c.y, 'aim');
    // 찍지 못했으면(빈 곳·취소) 십자선 자리의 추정 표시를 지운다
    if (this.cursor?.type === 'aim') {
      this.cursor = null;
      this.hover = null;
      this.hoverPoint = null;
    }
    this.overlay.invalidate();
  }

  /** 둘째 손가락이 닿으면 조준을 그만둔다(점은 찍지 않고, 두 손가락 확대·이동은 코어가 한다) */
  private cancelAim(): void {
    this.stopAimTimer();
    if (this.aimId === null) return;
    this.aimId = null;
    this.cursor = null;
    this.hover = null;
    this.hoverPoint = null;
    this.overlay.invalidate();
  }

  /** Shift 고정 켜기·끄기(중심을 찍은 뒤에는 평면이 이미 정해져 상관없다) */
  private setPlaneLock(on: boolean): void {
    if (on) {
      if (!this.planeLock && this.hoverPlane) {
        this.planeLock = this.hoverPlane;
        this.overlay.invalidate();
      }
    } else if (this.planeLock) {
      this.planeLock = null;
      this.hoverDirty = true;
      this.overlay.invalidate();
    }
  }

  /** 점 찍기(누르기·탭) */
  private place(x: number, y: number, type: string, shift = false): void {
    const f = this.overlay.frame();
    if (!f) return;
    const snap = this.snapAt(x, y, type, f);
    if (!snap) return;
    const ray = screenRay(f, x, y);
    if (this.modeValue === 'tape') {
      // 빈 곳(형상·축 추정이 없음)은 찍지 않는다
      if (snap.kind === 'free') return;
      if (!this.pts.length) {
        this.dropResult();
        this.pts = [snap.point];
      } else {
        const a = this.pts[0]!;
        if (samePoint(a, snap.point)) return;
        this.pts = [];
        this.setResult(tapeResult(a, snap.point));
      }
    } else if (this.modeValue === 'protractor') {
      if (!this.pts.length) {
        if (snap.kind === 'free') return;
        if (shift && !this.planeLock) this.planeLock = protractorPlane(snap, forwardOf(f)).normal;
        this.dropResult();
        this.normal = this.planeLock ?? protractorPlane(snap, forwardOf(f)).normal;
        this.pts = [snap.point];
      } else {
        const c = this.pts[0]!;
        const n = this.normal ?? protractorPlane(null, forwardOf(f)).normal;
        const p = protractorPoint(ray, snap, c, n);
        if (samePoint(c, p)) return;
        if (this.pts.length === 1) this.pts.push(p);
        else {
          const a = this.pts[1]!;
          this.pts = [];
          this.normal = null;
          this.setResult(protractorResult(c, a, p, n));
        }
      }
    }
    // 터치(정밀 조준 포함)는 커서가 없으니 찍은 자리의 추정을 표식으로 남긴다
    if (type === 'touch' || type === 'aim') {
      this.cursor = { x, y, type: 'touch' };
      this.hover = snap;
      this.hoverPoint = null;
      this.hoverDirty = false;
    } else {
      this.cursor = { x, y, type };
      this.hoverDirty = true;
    }
    this.refreshHint();
    this.overlay.invalidate();
  }

  private setResult(r: MeasureToolResult): void {
    this.resultValue = r;
    this.opts.onResult(r);
  }

  private dropResult(): void {
    if (!this.resultValue) return;
    this.resultValue = null;
    this.opts.onResult(null);
  }

  private reset(): void {
    this.pts = [];
    this.normal = null;
    this.centers = [];
    this.planeLock = null;
    this.hoverPlane = null;
    this.hover = null;
    this.hoverPoint = null;
    this.cursor = null;
    this.dragging = false;
    this.presses.clear();
    this.cancelTap = false;
    this.stopAimTimer();
    this.aimId = null;
    this.dropResult();
  }

  private refreshHint(): void {
    const h = measureHint(this.modeValue, this.pts.length, !!this.resultValue, this.opts.touch?.() ?? false);
    if (h === this.lastHint) return;
    this.lastHint = h;
    this.opts.onHint?.(h);
  }

  // ───────────────────────── 그리기 ─────────────────────────

  /** 커서 자리에서 추정을 다시 한다(그리기 틀마다 많아야 한 번) */
  private updateHover(f: ViewFrame): void {
    const c = this.cursor;
    if (!c || this.dragging || c.type === 'touch') {
      if (!c || c.type !== 'touch') {
        this.hover = null;
        this.hoverPoint = null;
      }
      return;
    }
    const snap = this.snapAt(c.x, c.y, c.type, f);
    this.hover = snap;
    this.hoverPoint = null;
    if (!snap) return;
    if (this.modeValue === 'protractor') {
      if (!this.pts.length) this.hoverPlane = protractorPlane(snap, forwardOf(f)).normal;
      else this.hoverPoint = protractorPoint(screenRay(f, c.x, c.y), snap, this.pts[0]!, this.normal ?? AXIS_DIRS.z);
    }
  }

  private paint(f: ViewFrame): void {
    if (!this.modeValue) return;
    if (this.hoverDirty) {
      this.hoverDirty = false;
      this.updateHover(f);
    }
    // 다른 덧그림이 층을 비웠으면 다시 붙인다
    if (this.g.parentNode !== this.overlay.svg) this.overlay.svg.append(this.g);
    if (this.layer.parentNode !== this.overlay.labels) this.overlay.labels.append(this.layer);
    this.g.replaceChildren();
    this.layer.replaceChildren();
    const scene = this.opts.getScene();
    const units = this.opts.getUnits();
    const k = mmPerSceneUnit(scene?.units);
    const len = (d: number): string => formatLength(d * k, units);
    const ang = (deg: number): string => formatAngle(deg, units);

    const r = this.resultValue;
    if (r?.kind === 'tape') this.drawTape(f, r, len(r.distance));
    else if (r?.kind === 'protractor') this.drawAngle(f, r.center, r.a, r.b, r.normal, ang(r.angle), true);

    const snap = this.dragging ? null : this.hover;
    let tip: string | null = snap ? snap.label : null;
    if (this.modeValue === 'tape') {
      const a = this.pts[0];
      if (a) {
        this.dot(f, a);
        if (snap && this.cursor?.type !== 'touch') {
          this.rubber(f, a, snap.point, snap.axis);
          tip = joinTip(snap.label, len(Math.hypot(...sub(snap.point, a))));
        }
      }
    } else {
      const [c, base] = this.pts;
      const n = this.normal;
      if (!c) {
        if (snap && snap.kind !== 'free') this.disk(f, snap.point, this.planeLock ?? this.hoverPlane ?? protractorPlane(snap, forwardOf(f)).normal, !!this.planeLock);
      } else if (n) {
        this.disk(f, c, n, false);
        this.dot(f, c);
        const cur = this.dragging || this.cursor?.type === 'touch' ? null : this.hoverPoint;
        if (!base) {
          if (cur) this.rubber(f, c, cur, snap?.axis);
        } else {
          this.segment(f, c, base, 'measure-ray');
          this.dot(f, base);
          if (cur) {
            const deg = planeAngle(sub(base, c), sub(cur, c), n);
            this.drawAngle(f, c, base, cur, n, null, false);
            this.rubber(f, c, cur, snap?.axis);
            tip = joinTip(snap?.label ?? '', ang(deg));
          }
        }
      }
    }
    if (snap && snap.kind !== 'free') this.marker(f, snap);
    if (this.aimId !== null && this.cursor) this.reticle(this.cursor.x, this.cursor.y);
    this.tooltip(f, tip);
  }

  /** 정밀 조준 십자선(가운데는 비워 추정 표식이 보이게, 흰 테두리로 어느 바탕에서도 보이게) */
  private reticle(x: number, y: number): void {
    const r = 16;
    const gap = 6;
    const d = `M${x - r - 6} ${y}H${x - gap}M${x + gap} ${y}H${x + r + 6}M${x} ${y - r - 6}V${y - gap}M${x} ${y + gap}V${y + r + 6}`;
    const g = svgEl('g', { class: 'measure-aim' });
    g.append(
      svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.85 }),
      svgEl('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.85 }),
      svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
      svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    );
    this.g.append(g);
  }

  private tooltip(f: ViewFrame, text: string | null): void {
    const c = this.cursor;
    const el = this.tip;
    if (!c || !text || this.dragging) {
      el.style.display = 'none';
      return;
    }
    el.textContent = text;
    el.style.display = 'block';
    this.layer.append(el);
    const pos = tooltipPosition(c.x, c.y, el.offsetWidth || 0, el.offsetHeight || 0, f.width, f.height, c.type === 'aim');
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  private label(x: number, y: number, text: string, cls: string): void {
    const el = document.createElement('div');
    el.className = `measure-label ${cls}`;
    el.textContent = text;
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;`;
    this.layer.append(el);
  }

  private segment(f: ViewFrame, a: readonly number[], b: readonly number[], cls: string, attrs: Record<string, string | number> = {}): void {
    const s = screenSegment(f, a, b);
    if (!s) return;
    this.g.append(svgEl('line', { class: cls, x1: s[0], y1: s[1], x2: s[2], y2: s[3], stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', ...attrs }));
  }

  /** 진행 중 선(시작점 → 커서). 축 고정이면 그 축 색 */
  private rubber(f: ViewFrame, a: readonly number[], b: readonly number[], axis: Axis | undefined): void {
    const attrs: Record<string, string | number> = { 'stroke-dasharray': '6 4' };
    if (axis) {
      attrs.stroke = AXIS_COLORS[axis];
      attrs['stroke-width'] = 2;
      attrs['data-axis'] = axis;
    }
    this.segment(f, a, b, axis ? `measure-rubber measure-axis-${axis}` : 'measure-rubber', attrs);
  }

  private dot(f: ViewFrame, p: readonly number[]): void {
    const s = screenPoint(f, p, 40);
    if (!s) return;
    this.g.append(svgEl('circle', { class: 'measure-point', cx: s[0], cy: s[1], r: 3.5, fill: 'currentColor', stroke: '#ffffff', 'stroke-width': 1 }));
  }

  /** 추정 표식: 끝점 초록 원, 중간점 청록 원, 중심 초록 원과 십자, 수직 자홍 직각 표, 모서리 위 빨강 사각형, 면 위 파랑 마름모, 축 위 축 색 작은 사각형 */
  private marker(f: ViewFrame, snap: Snap): void {
    const s = screenPoint(f, snap.point, 20);
    if (!s) return;
    const [x, y] = s;
    const color = snap.kind === 'axis' && snap.axis ? AXIS_COLORS[snap.axis] : SNAP_COLORS[snap.kind];
    const base = { class: `measure-snap measure-snap-${snap.kind}`, 'data-kind': snap.kind, fill: color, stroke: '#ffffff', 'stroke-width': 1.25 };
    let el: SVGElement;
    if (snap.kind === 'endpoint' || snap.kind === 'midpoint') el = svgEl('circle', { ...base, cx: x, cy: y, r: 5 });
    else if (snap.kind === 'center') {
      el = svgEl('g', { class: base.class, 'data-kind': snap.kind });
      el.append(svgEl('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: '#ffffff', 'stroke-width': 3 }), svgEl('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: color, 'stroke-width': 1.75 }));
      el.append(svgEl('path', { d: `M${x - 3.5},${y}h7M${x},${y - 3.5}v7`, stroke: color, 'stroke-width': 1.5 }));
    } else if (snap.kind === 'perpendicular') {
      // 직각 표(ㄴ 모양)
      el = svgEl('path', { class: base.class, 'data-kind': snap.kind, d: `M${x - 6},${y - 6}v12h12`, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    } else if (snap.kind === 'onFace') el = svgEl('polygon', { ...base, points: `${x},${y - 6.5} ${x + 6.5},${y} ${x},${y + 6.5} ${x - 6.5},${y}` });
    else {
      const h = snap.kind === 'onEdge' ? 4.5 : 3.5;
      el = svgEl('rect', { ...base, x: x - h, y: y - h, width: 2 * h, height: 2 * h });
    }
    this.g.append(el);
  }

  /** 각도기 원판(평면 위 원과 15° 눈금). 축 평면이면 그 축 색 */
  private disk(f: ViewFrame, center: readonly number[], normal: readonly number[], locked: boolean): void {
    const depth = viewDepth(f, center);
    if (f.projection === 'perspective' && !(depth > 0)) return;
    const R = worldPerPixel(f, depth) * PROTRACTOR_PX;
    const [u, v] = planeBasis(normal);
    const axis = axisOf(normal);
    const color = axis ? AXIS_COLORS[axis] : 'currentColor';
    const at = (t: number, r: number): [number, number] | null => {
      const p = addScaled(addScaled(center, u, Math.cos(t) * r), v, Math.sin(t) * r);
      return screenPoint(f, p);
    };
    const pts: string[] = [];
    for (let i = 0; i < 48; i++) {
      const s = at((i / 48) * 2 * Math.PI, R);
      if (!s) return;
      pts.push(`${s[0].toFixed(1)},${s[1].toFixed(1)}`);
    }
    const g = svgEl('g', { class: locked ? 'measure-protractor is-locked' : 'measure-protractor', 'data-axis': axis ?? '' });
    g.append(svgEl('polygon', { points: pts.join(' '), fill: color, 'fill-opacity': 0.08, stroke: color, 'stroke-width': locked ? 2 : 1.25 }));
    let ticks = '';
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * 2 * Math.PI;
      const a = at(t, R * (i % 6 === 0 ? 0.72 : 0.86));
      const b = at(t, R);
      if (a && b) ticks += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    if (ticks) g.append(svgEl('path', { d: ticks, fill: 'none', stroke: color, 'stroke-width': 1 }));
    this.g.append(g);
  }

  /** 각(중심 → a, 중심 → b 두 선과 그 사이 호), text가 있으면 호 가운데 바깥에 라벨 */
  private drawAngle(f: ViewFrame, c: readonly number[], a: readonly number[], b: readonly number[], n: readonly number[], text: string | null, result: boolean): void {
    if (result) {
      this.segment(f, c, a, 'measure-ray measure-result-line', { 'stroke-width': 2 });
      this.segment(f, c, b, 'measure-ray measure-result-line', { 'stroke-width': 2 });
      this.dot(f, c);
      this.dot(f, a);
      this.dot(f, b);
    }
    const depth = viewDepth(f, c);
    if (f.projection === 'perspective' && !(depth > 0)) return;
    const nn = unit(n);
    const ua = unit(addScaled(sub(a, c), nn, -dot(sub(a, c), nn)));
    const ub = unit(addScaled(sub(b, c), nn, -dot(sub(b, c), nn)));
    if (!dot(ua, ua) || !dot(ub, ub)) return;
    const theta = (planeAngle(ua, ub, nn) * Math.PI) / 180;
    // 호의 둘째 기저: ua에 수직이고 ub 쪽(반대 방향이면 법선 기준으로)
    let w = addScaled(ub, ua, -dot(ub, ua));
    w = dot(w, w) > 1e-12 ? unit(w) : unit(cross(nn, ua));
    const R = worldPerPixel(f, depth) * ARC_PX;
    const steps = Math.max(2, Math.ceil(theta / (Math.PI / 36)));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (theta * i) / steps;
      const s = screenPoint(f, addScaled(addScaled(c, ua, Math.cos(t) * R), w, Math.sin(t) * R));
      if (!s) return;
      d += `${i ? 'L' : 'M'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }
    this.g.append(svgEl('path', { class: 'measure-arc', d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
    if (text) {
      const t = theta / 2;
      const s = screenPoint(f, addScaled(addScaled(c, ua, Math.cos(t) * R * 1.9), w, Math.sin(t) * R * 1.9));
      if (s) this.label(s[0], s[1], text, 'measure-label-angle');
    }
  }

  private drawTape(f: ViewFrame, r: TapeResult, text: string): void {
    this.segment(f, r.a, r.b, 'measure-result-line', { 'stroke-width': 2 });
    this.dot(f, r.a);
    this.dot(f, r.b);
    const s = screenSegment(f, r.a, r.b);
    if (s) this.label((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, text, 'measure-label-length');
  }
}

/** 캡처 단계 듣기(끄는 함수를 돌려준다) */
function capture(el: EventTarget, type: string, fn: (e: PointerEvent) => void): () => void {
  const h = fn as EventListener;
  el.addEventListener(type, h, true);
  return () => el.removeEventListener(type, h, true);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 눈이 보는 방향 */
function forwardOf(f: ViewFrame): V3 {
  const b = f.basis.back;
  return [-b[0], -b[1], -b[2]];
}

function samePoint(a: readonly number[], b: readonly number[]): boolean {
  const d = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  return d <= 1e-9 * Math.max(1, Math.hypot(a[0]!, a[1]!, a[2]!));
}
