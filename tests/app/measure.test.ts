// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3d } from 'opencad-viewer3d';
import { buildBvh } from 'opencad-viewer3d/bvh';
import { dirToAngles, projectToScreen, screenRay, type CameraState } from 'opencad-viewer3d/camera';
import { pickScene } from 'opencad-viewer3d/scenepick';
import type { LineSet3d, Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import {
  AIM_HOLD_MS,
  AIM_OFFSET_PX,
  MAX_GUIDE_LINES,
  MAX_GUIDE_POINTS,
  MeasureTool,
  aimPoint,
  angledGuideDir,
  clipToRect,
  guideLineScreen,
  haloFor,
  parallelOffset,
  pointAlong,
  type LiveKind,
  joinTip,
  LOCK_HINTS,
  LOCK_KEYS_HINT,
  lockHint,
  lockName,
  measureHint,
  planeAngle,
  protractorPlane,
  protractorPoint,
  protractorResult,
  snapRadius,
  tapeResult,
  tapSlopPx,
  tooltipPosition,
  type MeasureToolOptions,
  type MeasureToolResult,
  type MeasureViewer,
  GUIDE_KEY_NAMES,
  GUIDE_SELECTED_COLOR,
  collinear,
  edgeFoot,
  edgeOfTap,
  guideKeyFor,
  guideKeyHint,
  GUIDE_UNDO_LABEL,
  GUIDES_SHOWN_KEY,
  GUIDES_SHOWN_LABEL,
  MAX_GUIDE_UNDO,
  applyMessage,
  guideUndoKey,
  GUIDE_CLEAR_FILE_LABEL,
  GUIDE_REDO_LABEL,
  labelSpot,
  edgeBands,
  coverRects,
  LOCK_MENU_LABEL,
  AIM_DWELL_PX,
  dwellPoint,
  trackHint,
  guideHit,
  GUIDE_DELETE_KEY_HINT,
  GUIDE_DELETE_TEXT,
  GUIDE_KIND_NAMES,
} from '../../src/app/measure';
import { AXIS_COLORS, AXIS_LABELS, SNAP_COLORS, SNAP_LABELS, TRACK_ALIGN_LABEL, TRACK_AXIS_LABELS, TRACK_PAIR_LABELS } from '../../src/app/snap';
import { TRACK_DWELL_MS } from 'opencad-viewer3d/track';
import { GUIDE_STORE_KEY, readGuideFiles, saveGuides } from '../../src/app/guidestore';
import {
  AIM_COVER_GAP_PX,
  GUIDE_HIDE_LABEL,
  GUIDE_HIDE_TEXT,
  GUIDE_UNHIDE_LABEL,
  applyGuideSelect,
  guideCountText,
  guideDeleteLabel,
  guideSelectOp,
  guidesInBox,
  placedRects,
  selectAllKey,
} from '../../src/app/measure';
import type { V3 } from 'opencad-viewer3d/math';
import { Overlay, frameFor } from '../../src/app/overlay';
import { DRAG_START_PX, TOUCH_DRAG_START_PX } from 'opencad-viewer3d';
import { DEFAULT_UNITS, type UnitsDisplay } from '../../src/app/units';

/** 줄자를 켠 키보드 기기의 처음 안내 */
const TAPE_START_HINT = '줄자: 잴 시작점을 누르세요 · 모서리를 두 번 누르면 그 위에 안내선';

describe('줄자·각도기 계산', () => {
  it('줄자 결과는 장면 단위 거리와 dx·dy·dz', () => {
    expect(tapeResult([1, 2, 3], [4, 6, 15])).toEqual({ kind: 'tape', a: [1, 2, 3], b: [4, 6, 15], distance: 13, dx: 3, dy: 4, dz: 12 });
  });

  it('평면에 비친 두 방향 사이 각(0~180°), 법선 방향과 상관없다', () => {
    expect(planeAngle([1, 0, 0], [0, 1, 0], [0, 0, 1])).toBeCloseTo(90, 9);
    expect(planeAngle([1, 0, 0], [-1, 0, 0], [0, 0, 1])).toBeCloseTo(180, 9);
    expect(planeAngle([2, 0, 0], [1, 1e-9, 0], [0, 0, 1])).toBeCloseTo(0, 6);
    // 평면 밖 성분은 버린다
    expect(planeAngle([1, 0, 0], [1, 1, 5], [0, 0, 1])).toBeCloseTo(45, 9);
    expect(planeAngle([1, 0, 0], [1, 1, 5], [0, 0, -3])).toBeCloseTo(45, 9);
    expect(planeAngle([0, 0, 1], [1, 0, 0], [0, 0, 1])).toBe(0);
  });

  it('각도기 결과 꼴', () => {
    const r = protractorResult([1, 1, 0], [5, 1, 0], [1, 4, 0], [0, 0, 2]);
    expect(r).toMatchObject({ kind: 'protractor', center: [1, 1, 0], a: [5, 1, 0], b: [1, 4, 0], normal: [0, 0, 1] });
    expect(r.angle).toBeCloseTo(90, 9);
  });

  it('각도기 평면: 면 법선, 없으면 카메라를 가장 정면으로 보는 축 평면', () => {
    expect(protractorPlane({ normal: [0, 0, 2] }, [0, 1, 0])).toEqual({ normal: [0, 0, 1], axis: 'z' });
    const tilted = protractorPlane({ normal: [1, 1, 0] }, [0, 0, -1]);
    expect(tilted.axis).toBeNull();
    expect(tilted.normal[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(protractorPlane(null, [0.2, 0.9, -0.3])).toEqual({ normal: [0, 1, 0], axis: 'y' });
    expect(protractorPlane({}, [0, 0, -1])).toEqual({ normal: [0, 0, 1], axis: 'z' });
    expect(protractorPlane(null, [-0.95, 0.1, 0.2]).axis).toBe('x');
  });

  it('각도기 둘째·셋째 점: 추정 점은 평면에 내리고, 면 위·빈 곳은 커서 광선과 평면의 교점', () => {
    expect(protractorPoint({ origin: [0, 0, 9], dir: [0, 0, -1] }, { kind: 'endpoint', point: [5, 5, 7] }, [0, 0, 0], [0, 0, 1])).toEqual([5, 5, 0]);
    const ray = { origin: [0, 0, 10] as [number, number, number], dir: [0.6, 0, -0.8] as [number, number, number] };
    const p = protractorPoint(ray, { kind: 'onFace', point: [99, 99, 99] }, [0, 0, 0], [0, 0, 1]);
    expect(p[0]).toBeCloseTo(7.5, 12);
    expect(p[1]).toBeCloseTo(0, 12);
    expect(p[2]).toBeCloseTo(0, 12);
  });

  it('툴팁은 커서 오른쪽 아래, 보기 밖이면 반대편', () => {
    expect(tooltipPosition(50, 40, 80, 20, 400, 300)).toEqual({ left: 64, top: 58 });
    expect(tooltipPosition(380, 40, 80, 20, 400, 300)).toEqual({ left: 290, top: 58 });
    expect(tooltipPosition(50, 290, 80, 20, 400, 300)).toEqual({ left: 64, top: 260 });
    // 정밀 조준: 손가락이 아래에 있어 위에 두고, 위가 모자라면 아래
    expect(tooltipPosition(50, 60, 80, 20, 400, 300, true)).toEqual({ left: 64, top: 22 });
    expect(tooltipPosition(50, 30, 80, 20, 400, 300, true)).toEqual({ left: 64, top: 48 });
  });

  it('툴팁이 3D 보기 위에 뜬 것(장면 탭·뷰 큐브)을 덮으면 위아래 → 좌우 → 둘 다 뒤집은 첫 빈자리, 덮지 않으면 예전 자리(22차)', () => {
    // 덮지 않으면 피할 자리를 주어도 같은 자리
    const far = [{ x: 300, y: 200, width: 50, height: 50 }];
    for (const a of [[50, 40, false], [380, 40, false], [50, 290, false], [50, 60, true], [50, 30, true]] as const)
      expect(tooltipPosition(a[0], a[1], 80, 20, 400, 300, a[2], far)).toEqual(tooltipPosition(a[0], a[1], 80, 20, 400, 300, a[2]));
    // 정밀 조준 툴팁(십자선 위)이 장면 탭 밑이면 십자선 아래로
    const tabs = { x: 8, y: 8, width: 239, height: 44 };
    expect(tooltipPosition(100, 70, 80, 17, 375, 600, true)).toEqual({ left: 114, top: 35 });
    expect(tooltipPosition(100, 70, 80, 17, 375, 600, true, [tabs])).toEqual({ left: 114, top: 88 });
    // 오른쪽 위 뷰 큐브: 위아래를 바꿔도 걸리면 커서 왼쪽
    const cube = { x: 291, y: 8, width: 76, height: 76 };
    expect(tooltipPosition(260, 40, 60, 17, 375, 600, false, [cube])).toEqual({ left: 190, top: 58 });
    expect(tooltipPosition(260, 60, 60, 17, 375, 600, false, [cube, { x: 180, y: 0, width: 110, height: 100 }])).toEqual({ left: 274, top: 78 });
    // 모두 걸리면 처음 자리
    expect(tooltipPosition(100, 70, 80, 17, 375, 600, true, [{ x: 0, y: 0, width: 375, height: 600 }])).toEqual({ left: 114, top: 35 });
  });

  it('툴팁 글·안내·추정 반경', () => {
    expect(joinTip('끝점', '1200 mm')).toBe('끝점 · 1200 mm');
    expect(joinTip('', '5 mm')).toBe('5 mm');
    expect(joinTip('면에')).toBe('면에');
    // 키보드 기기 처음 안내는 모서리 두 번 누르기(그 위 안내선)도 알린다
    expect(measureHint('tape', 0, false)).toBe(TAPE_START_HINT);
    expect(measureHint('tape', 1, true)).toContain('끝점');
    expect(measureHint('protractor', 0, false)).toContain('Shift');
    expect(measureHint('protractor', 2, false)).toContain('잴 방향');
    expect(measureHint(null, 0, false)).toBeNull();
    // 손가락 기기: 키 설명 대신 길게 누르기
    for (const [mode, n, has] of [['tape', 0, false], ['tape', 1, false], ['tape', 0, true], ['protractor', 0, false], ['protractor', 1, false], ['protractor', 2, false], ['protractor', 0, true]] as const) {
      const t = measureHint(mode, n, has, true)!;
      expect(t).not.toMatch(/Esc|Shift/);
      expect(t.split(' · ')[0]).toBe(measureHint(mode, n, has)!.split(' · ')[0]);
    }
    expect(measureHint('tape', 0, false, true)).toContain('길게 누르면 정밀 조준');
    expect(snapRadius('touch')).toBeGreaterThan(snapRadius('aim'));
    expect(snapRadius('aim')).toBeGreaterThan(snapRadius('mouse'));
    expect(aimPoint(30, 100)).toEqual({ x: 30, y: 100 - AIM_OFFSET_PX });
    expect(aimPoint(30, 10)).toEqual({ x: 30, y: 0 });
  });

  it('정밀 조준 십자선은 3D 보기 위에 뜬 것(장면 탭·뷰 큐브·측정 띠) 밑으로 가지 않고 가장 가까운 변 바깥(보기 안)으로 비킨다(25차)', () => {
    const view = { width: 375, height: 600 };
    const tabs = { x: 8, y: 8, width: 239, height: 44 };
    const cube = { x: 291, y: 8, width: 76, height: 76 };
    const band = { x: 0, y: 520, width: 375, height: 80 };
    const all = [tabs, cube, band];
    const g = AIM_COVER_GAP_PX;
    // 덮개에서 먼 자리는 예전과 같다
    expect(aimPoint(100.3, 180.6, all, view)).toEqual(aimPoint(100.3, 180.6));
    expect(aimPoint(320.4, 300.2, all, view)).toEqual(aimPoint(320.4, 300.2));
    // 장면 탭 밑: 탭 아래 변 바깥(위 틈·왼쪽 화면 끝으로는 밀지 않는다) — 손가락을 더 올려도 그 자리
    expect(aimPoint(100.3, 100.6, all, view)).toEqual({ x: 100.3, y: 52 + g });
    expect(aimPoint(100.3, 30.2, all, view)).toEqual({ x: 100.3, y: 52 + g });
    // 탭 오른쪽 끝 가까이: 오른쪽 변 바깥이 더 가깝다
    expect(aimPoint(240.2, 90.4, all, view)).toEqual({ x: 247 + g, y: 90.4 - AIM_OFFSET_PX });
    // 뷰 큐브 밑: 왼쪽 변 바깥(오른쪽은 화면 끝)
    expect(aimPoint(330.6, 100.2, all, view)).toEqual({ x: 291 - g, y: 100.2 - AIM_OFFSET_PX });
    // 아래 띠 위: 띠 위 변 바깥
    expect(aimPoint(200.2, 590.4, all, view)).toEqual({ x: 200.2, y: 520 - g });
    // 틈 안(덮개에서 GAP 안)도 변 바깥까지
    expect(aimPoint(100.3, 52 + g - 3.1 + AIM_OFFSET_PX, all, view)).toEqual({ x: 100.3, y: 52 + g });
    // 맞붙은 덮개(사이 틈이 GAP 둘보다 좁음): 다른 덮개에 드는 변은 건너뛰어 어느 덮개 밑도 아닌 자리로
    const near = { x: 250, y: 8, width: 37, height: 30 };
    const free = (q: { x: number; y: number }): boolean => [near, cube].every((r) => !(q.x > r.x - g && q.x < r.x + r.width + g && q.y > r.y - g && q.y < r.y + r.height + g));
    for (const [fx, fy] of [[270.2, 80.1], [289.1, 75.3], [300.4, 120.2]] as const) {
      const p = aimPoint(fx, fy, [near, cube], view);
      expect(free(p), `${fx},${fy} → ${p.x},${p.y}`).toBe(true);
      expect(p.x >= g && p.y >= g && p.x <= view.width - g && p.y <= view.height - g).toBe(true);
    }
  });
});

// ───────────────────────── 도구(DOM) ─────────────────────────

const W = 200;
const FOV = (40 * Math.PI) / 180;
/** 위에서 본 평행 투영: 화면 1화소 = 세계 1, 화면 (100 + X, 100 − Y) */
const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };

const lines = (id: string, segs: number[][]): LineSet3d => ({ id, positions: Float32Array.from(segs.flat()) });
const quad = (id: string, x0: number, y0: number, x1: number, y1: number, z: number): Mesh3d => ({
  id,
  positions: Float32Array.from([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]),
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  color: [0.8, 0.8, 0.8, 1],
});

interface Rig {
  tool: MeasureTool;
  /** 가짜 뷰어(시험이 viewCubeRect 같은 것을 바꾼다) */
  viewer: MeasureViewer;
  overlay: Overlay;
  canvas: HTMLCanvasElement;
  results: (MeasureToolResult | null)[];
  hints: (string | null)[];
  lives: (number | null)[];
  liveKinds: LiveKind[];
  /** onLock마다 잠근 방향 이름(각도기 화살표 평면은 plane-축) */
  locks: (string | null)[];
  /** onGuides를 부른 수(안내 두기 켜고 끄기·안내가 늘고 줄 때) */
  guideCalls: () => number;
  /** 그물 면만 고르기(코어 0.20.0 pick의 meshesOnly)를 부른 수 */
  meshPicks: () => number;
  setCamera(c: CameraState): void;
  ptr(type: string, x: number, y: number, o?: { id?: number; button?: number; buttons?: number; pointerType?: string; shift?: boolean }): void;
  click(x: number, y: number, o?: { pointerType?: string; id?: number; shift?: boolean }): void;
  move(x: number, y: number, o?: { shift?: boolean }): void;
  key(key: string, type?: 'keydown' | 'keyup'): boolean;
  q(sel: string): Element | null;
  qa(sel: string): Element[];
  tip(): string | null;
}

let rigs: Rig[] = [];
afterEach(() => {
  for (const r of rigs) {
    r.tool.dispose();
    r.overlay.dispose();
  }
  rigs = [];
  document.body.replaceChildren();
});

function rig(scene: Pick<Scene3d, 'meshes' | 'lines' | 'units'>, cam: CameraState = TOP, units: UnitsDisplay = DEFAULT_UNITS, extra: Partial<MeasureToolOptions> = {}): Rig {
  let guideCalls = 0;
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => W });
  Object.defineProperty(canvas, 'clientHeight', { get: () => W });
  host.append(canvas);
  document.body.append(host);
  let camera = cam;
  const camCbs = new Set<(c: CameraState) => void>();
  const items = { meshes: scene.meshes, lines: scene.lines, points: [] };
  let meshPicks = 0;
  const viewer: MeasureViewer = {
    canvas,
    // 코어 pick처럼: meshesOnly면 그물 면만(선분·점은 고르지도 않고 면을 가리지도 않는다)
    pick: (x, y, o) => {
      const only = typeof o === 'object' && !!o.meshesOnly;
      if (only) meshPicks++;
      return pickScene(frameFor(camera, W, W), x, y, only ? { ...items, lines: [] } : items, { tol: 6, occlude: true, bvh: (kind, pos, idx) => (kind === 'triangle' ? buildBvh(kind, pos, idx) : null) })?.pick ?? null;
    },
    getCamera: () => camera,
    onCameraChange: (cb) => {
      camCbs.add(cb);
      return () => camCbs.delete(cb);
    },
    getRenderMode: () => 'shaded',
    section: null,
  };
  const overlay = new Overlay(host);
  overlay.attach(viewer as unknown as Viewer3d);
  const results: (MeasureToolResult | null)[] = [];
  const hints: (string | null)[] = [];
  const lives: (number | null)[] = [];
  const liveKinds: LiveKind[] = [];
  const locks: (string | null)[] = [];
  const tool: MeasureTool = new MeasureTool(viewer, overlay, {
    getScene: () => scene,
    getUnits: () => units,
    onResult: (r) => results.push(r),
    onHint: (h) => hints.push(h),
    onLive: (l, k) => {
      lives.push(l);
      liveKinds.push(k);
    },
    onLock: () => locks.push(lockName(tool.inferenceLock) ?? (tool.planeAxis ? `plane-${tool.planeAxis}` : null)),
    onGuides: () => void guideCalls++,
    ...extra,
  });
  const ptr: Rig['ptr'] = (type, x, y, o = {}) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: o.button ?? 0, buttons: o.buttons ?? 0, shiftKey: !!o.shift, bubbles: true });
    Object.defineProperty(e, 'pointerId', { value: o.id ?? 1 });
    Object.defineProperty(e, 'pointerType', { value: o.pointerType ?? 'mouse' });
    canvas.dispatchEvent(e);
  };
  const r: Rig = {
    tool,
    viewer,
    overlay,
    canvas,
    results,
    hints,
    lives,
    liveKinds,
    locks,
    guideCalls: () => guideCalls,
    meshPicks: () => meshPicks,
    setCamera(c) {
      camera = c;
      for (const cb of camCbs) cb(c);
    },
    ptr,
    click(x, y, o = {}) {
      ptr('pointerdown', x, y, { ...o, buttons: 1 });
      ptr('pointerup', x, y, o);
      overlay.paintNow();
    },
    move(x, y, o = {}) {
      ptr('pointermove', x, y, o);
      overlay.paintNow();
    },
    key(key, type = 'keydown') {
      return tool.handleKey(new KeyboardEvent(type, { key, cancelable: true }));
    },
    q: (sel) => host.querySelector(sel),
    qa: (sel) => [...host.querySelectorAll(sel)],
    tip() {
      const el = host.querySelector<HTMLElement>('.measure-tip');
      return el && el.style.display !== 'none' ? el.textContent : null;
    },
  };
  rigs.push(r);
  return r;
}

// 원점에서 +X로 100, +Y로 50 모서리
const EDGES = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0], [0, 0, 0, 0, 50, 0]])] });

describe('측정 도구: 줄자', () => {
  it('끝점 표식·툴팁, 두 번 누르면 결과(모형 단위 라벨은 카메라가 움직여도 남는다)', () => {
    const r = rig(EDGES());
    expect(r.tool.active).toBe(false);
    r.tool.setMode('tape');
    expect(r.tool.active).toBe(true);
    expect(r.canvas.style.cursor).toBe('crosshair');
    expect(r.hints.at(-1)).toBe(TAPE_START_HINT);

    r.move(102, 103);
    expect(r.q('.measure-snap-endpoint')?.getAttribute('fill')).toBe('#00a000');
    expect(r.tip()).toBe('끝점');

    r.click(102, 103);
    expect(r.tool.pointCount).toBe(1);
    expect(r.hints.at(-1)).toContain('끝점을 누르세요');

    r.move(153, 101);
    expect(r.q('.measure-snap-midpoint')).not.toBeNull();
    expect(r.tip()).toBe('중간점 · 50 mm');
    expect(r.q('line.measure-rubber')).not.toBeNull();

    r.click(198, 101);
    expect(r.tool.pointCount).toBe(0);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ kind: 'tape', a: [0, 0, 0], b: [100, 0, 0], distance: 100, dx: 100, dy: 0, dz: 0 });
    expect(r.q('.measure-label-length')?.textContent).toBe('100 mm');

    // 카메라를 옮겨도 결과는 남는다(자리는 따라간다)
    const before = (r.q('.measure-label-length') as HTMLElement).style.left;
    r.setCamera({ ...TOP, target: [20, 0, 0] });
    r.overlay.paintNow();
    const label = r.q('.measure-label-length') as HTMLElement;
    expect(label.textContent).toBe('100 mm');
    expect(label.style.left).not.toBe(before);

    // 다음 측정을 시작하면 결과를 지운다
    r.click(102, 103);
    expect(r.results.at(-1)).toBeNull();
    expect(r.q('.measure-label-length')).toBeNull();
  });

  it('인치 장면 + 건축 단위면 라벨도 모형 단위', () => {
    const units: UnitsDisplay = { ...DEFAULT_UNITS, lengthUnit: 'inch', lengthFormat: 'architectural', lengthPrecision: 3 };
    const r = rig({ ...EDGES(), units: 'inch' }, TOP, units);
    r.tool.setMode('tape');
    r.click(101, 101);
    r.click(199, 100);
    expect(r.q('.measure-label-length')?.textContent).toBe(`8' 4"`);
  });

  it('끌기·오른쪽 단추·빈 곳 누르기는 점을 찍지 않는다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.ptr('pointerdown', 102, 103, { buttons: 1 });
    r.ptr('pointermove', 112, 103, { buttons: 1 });
    r.ptr('pointerup', 112, 103);
    expect(r.tool.pointCount).toBe(0);
    r.click(102, 103, {});
    r.tool.clear();
    r.ptr('pointerdown', 102, 103, { button: 2, buttons: 2 });
    r.ptr('pointerup', 102, 103, { button: 2 });
    expect(r.tool.pointCount).toBe(0);
    r.click(30, 170);
    expect(r.tool.pointCount).toBe(0);
  });

  it('시작점에서 축 방향으로 가면 축 색 선과 축 추정', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]])] });
    r.tool.setMode('tape');
    r.click(101, 100);
    r.move(100, 40);
    const rubber = r.q('line.measure-rubber');
    expect(rubber?.getAttribute('data-axis')).toBe('y');
    expect(rubber?.getAttribute('stroke')).toBe('#1a9e33');
    expect(r.tip()).toBe('녹색 축에 · 60 mm');
    r.click(101, 40);
    const res = r.results.at(-1);
    expect(res?.kind).toBe('tape');
    if (res?.kind !== 'tape') return;
    expect(res.b[0]).toBeCloseTo(0, 9);
    expect(res.b[1]).toBeCloseTo(60, 9);
    expect(res.distance).toBeCloseTo(60, 9);
  });

  it('Esc: 진행 중 점 취소 → 결과 지우기 → false(앱이 도구를 끈다)', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    expect(r.key('Escape')).toBe(false);
    r.click(102, 103);
    r.click(198, 101);
    r.click(102, 103);
    expect(r.tool.pointCount).toBe(1);
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.pointCount).toBe(0);
    r.click(102, 103);
    r.click(198, 101);
    expect(r.tool.result).not.toBeNull();
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.result).toBeNull();
    expect(r.results.at(-1)).toBeNull();
    expect(r.key('Escape')).toBe(false);
  });

  it('도구를 끄면 덧그림·결과·안내를 지우고 커서를 되돌린다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(198, 101);
    r.tool.setMode(null);
    expect(r.tool.active).toBe(false);
    expect(r.results.at(-1)).toBeNull();
    expect(r.hints.at(-1)).toBeNull();
    expect(r.canvas.style.cursor).toBe('');
    expect(r.q('g.measure')).toBeNull();
    expect(r.q('.measure-layer')).toBeNull();
    // 꺼진 동안 누르기는 무시
    r.click(102, 103);
    expect(r.tool.pointCount).toBe(0);
  });
});

describe('측정 도구: 터치', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('탭은 넓은 반경으로 추정하고, 두 손가락은 점을 찍지 않는다', () => {
    // 둘레 고르기의 시간 예산(마우스 6 ms·터치 24 ms)이 느린 CI에서 먼저 끊기면 모서리 대신 빈 곳이 되므로 시계를 멈춘다
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const r = rig(EDGES());
    r.tool.setMode('tape');
    // 끝점에서 15화소: 마우스면 모서리 위, 터치면 끝점
    expect(r.tool.snapAt(112, 109, 'mouse')?.kind).toBe('onEdge');
    r.click(112, 109, { pointerType: 'touch' });
    expect(r.tool.pointCount).toBe(1);
    expect(r.q('.measure-snap-endpoint')).not.toBeNull();
    r.ptr('pointerdown', 150, 100, { id: 2, pointerType: 'touch', buttons: 1 });
    r.ptr('pointerdown', 160, 120, { id: 3, pointerType: 'touch', buttons: 1 });
    r.ptr('pointerup', 150, 100, { id: 2, pointerType: 'touch' });
    r.ptr('pointerup', 160, 120, { id: 3, pointerType: 'touch' });
    expect(r.tool.pointCount).toBe(1);
    r.click(195, 104, { pointerType: 'touch' });
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', distance: 100 });
  });
});

describe('측정 도구: 각도기', () => {
  it('중심 → 기준 방향 → 잴 방향, 결과 각과 라벨', () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    expect(r.hints.at(-1)).toContain('중심점');
    r.move(101, 101);
    // 위에서 보면 면이 없어도 파랑(Z) 평면
    expect(r.q('.measure-protractor')?.getAttribute('data-axis')).toBe('z');
    r.click(101, 101);
    r.click(197, 102);
    expect(r.tool.pointCount).toBe(2);
    r.move(101, 52);
    expect(r.tip()).toBe('끝점 · 90.0°');
    expect(r.q('.measure-arc')).not.toBeNull();
    r.click(101, 52);
    const res = r.results.at(-1);
    expect(res?.kind).toBe('protractor');
    if (res?.kind !== 'protractor') return;
    expect(res.angle).toBeCloseTo(90, 6);
    expect(res.center).toEqual([0, 0, 0]);
    expect(res.normal).toEqual([0, 0, 1]);
    expect(r.q('.measure-label-angle')?.textContent).toBe('90.0°');
  });

  it('Shift를 누르고 있으면 커서 밑 면의 평면을 고정한다', () => {
    // 앞에서 조금 내려다본 원근: 바닥(Z 평면)이 보이고, 면이 없는 곳의 기본 평면은 Y(초록)
    const cam: CameraState = { target: [0, 50, 0], distance: 400, yaw: 0, pitch: 0.3, projection: 'perspective', fovY: FOV };
    const scene = { units: 'mm' as const, meshes: [quad('floor', -50, 0, 50, 100, 0)], lines: [lines('post', [[110, 0, 60, 110, 0, 90]])] };
    const r = rig(scene, cam);
    const f = frameFor(cam, W, W);
    const floor = projectToScreen(f, [0, 50, 0])!;
    const post = projectToScreen(f, [110, 0, 60])!;
    r.tool.setMode('protractor');
    r.move(floor[0], floor[1]);
    expect(r.q('.measure-protractor')?.getAttribute('data-axis')).toBe('z');
    r.move(post[0], post[1]);
    expect(r.q('.measure-protractor')?.getAttribute('data-axis')).toBe('y');
    r.move(floor[0], floor[1]);
    expect(r.key('Shift')).toBe(true);
    r.move(post[0], post[1], { shift: true });
    const disk = r.q('.measure-protractor');
    expect(disk?.getAttribute('data-axis')).toBe('z');
    expect(disk?.classList.contains('is-locked')).toBe(true);
    r.click(post[0], post[1], { shift: true });
    r.key('Shift', 'keyup');
    // 중심을 찍은 뒤에는 Shift를 떼도 평면이 그대로
    r.move(post[0] + 30, post[1]);
    expect(r.q('.measure-protractor')?.getAttribute('data-axis')).toBe('z');
  });
});

describe('측정 도구: 추론 잠금(Shift·화살표·단추)과 나란함', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const at = (deg: number, r: number): [number, number] => [100 + r * Math.cos((deg * Math.PI) / 180), 100 - r * Math.sin((deg * Math.PI) / 180)];
  const near = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

  it('Shift: 지금 축 추론을 잠그고, 잠근 동안 축 밖을 가리키거나 찍어도 그 축 위, 떼면 풀린다', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]])] });
    r.tool.setMode('tape');
    // 시작점 전에는 잠글 방향이 없다
    expect(r.key('Shift')).toBe(true);
    expect(r.tool.inferenceLock).toBeNull();
    r.key('Shift', 'keyup');
    r.click(101, 100);
    r.move(100, 40);
    expect(r.tip()).toBe('녹색 축에 · 60 mm');
    expect(r.key('Shift')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'shift' });
    expect(r.locks.at(-1)).toBe('y');
    // 축 밖(세계 60, 60)을 가리켜도 녹색 축 위 — 굵은 실선, 표식에 고리
    r.move(160, 40, { shift: true });
    const rubber = r.q('line.measure-rubber');
    expect(rubber?.getAttribute('data-locked')).toBe('axis');
    expect(rubber?.getAttribute('stroke')).toBe('#1a9e33');
    expect(rubber?.getAttribute('stroke-dasharray')).toBeNull();
    expect(r.q('.measure-lock-ring')).not.toBeNull();
    expect(r.tip()).toBe('녹색 축에 · 잠금 · 60 mm');
    // 떼면 풀린다
    r.key('Shift', 'keyup');
    expect(r.tool.inferenceLock).toBeNull();
    expect(r.locks.at(-1)).toBeNull();
    r.move(160, 40);
    expect(r.q('.measure-lock-ring')).toBeNull();
    // 이동의 shiftKey로도 뗀 것을 안다(keyup을 놓쳤을 때)
    r.move(100, 40);
    r.key('Shift');
    expect(r.tool.inferenceLock?.axis).toBe('y');
    r.move(160, 40);
    expect(r.tool.inferenceLock).toBeNull();
    // 다시 잠그고 축 밖을 찍으면 축 위 점, 찍으면 잠금이 풀린다
    r.move(100, 40);
    r.key('Shift', 'keyup');
    r.key('Shift');
    r.move(170, 30, { shift: true });
    r.click(170, 30, { shift: true });
    const res = r.results.at(-1);
    expect(res?.kind).toBe('tape');
    if (res?.kind !== 'tape') return;
    near(res.b, [0, 70, 0]);
    expect(res.distance).toBeCloseTo(70, 6);
    expect(r.tool.inferenceLock).toBeNull();
  });

  it('화살표: → 빨강 · ↑ 파랑(같은 키를 다시 누르면 풀기), 잠근 축 밖을 찍어도 축 위, 끝점을 가리키면 그 높이', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]]), lines('h', [[50, 50, 30, 60, 50, 30]])] });
    r.tool.setMode('tape');
    // 줄자 시작점 전에는 화살표를 받지 않는다(앱이 다른 데 쓴다)
    expect(r.key('ArrowUp')).toBe(false);
    r.click(101, 100);
    expect(r.key('ArrowRight')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'key' });
    expect(r.key('ArrowRight')).toBe(true);
    expect(r.tool.inferenceLock).toBeNull();
    expect(r.key('ArrowUp')).toBe(true);
    expect(r.key('ArrowRight')).toBe(true);
    expect(r.tool.inferenceLock?.axis).toBe('x');
    // 축 밖(세계 40, 40)을 찍어도 빨강 축 위
    r.click(140, 60);
    let res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [40, 0, 0]);
    expect(r.tool.inferenceLock).toBeNull();
    // 파랑 축을 잠그고 높이 30의 끝점을 가리키면 그 높이로(옮겨 온 점에서 가는 점선)
    r.click(101, 100);
    r.key('ArrowUp');
    r.move(150, 50);
    expect(r.tip()).toBe('파랑 축에 · 잠금 · 30 mm');
    expect(r.q('.measure-lock-from')).not.toBeNull();
    expect(r.q('.measure-lock-from-point')?.getAttribute('fill')).toBe('#00a000');
    r.click(150, 50);
    res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [0, 0, 30]);
    expect(res.dz).toBeCloseTo(30, 6);
  });

  it('지나간 모서리와 나란하면 자홍 나란함, ↓로 잠그고 다시 누르면 풀기(커서 밑이 아니어도 지나간 모서리로)', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]]), lines('d', [[-90, -60, 0, -60, -30, 0]])] });
    r.tool.setMode('tape');
    r.click(101, 100);
    // 45° 모서리를 지나간 뒤 시작점에서 그와 나란한 쪽으로
    r.move(25, 145);
    const [x, y] = at(47, 50);
    r.move(x, y);
    expect(r.q('.measure-snap-parallel')?.getAttribute('fill')).toBe('#c800c8');
    const rubber = r.q('line.measure-rubber.measure-parallel');
    expect(rubber?.getAttribute('stroke')).toBe('#c800c8');
    expect(r.q('.measure-parallel-ref')).not.toBeNull();
    // 커서가 나란한 선에서 2° 벗어나 선 위 가장 가까운 점까지는 50·cos 2° = 49.97 mm — 보인 값은 반올림이라 SketchUp처럼 "~"
    expect(r.tip()).toBe('모서리와 나란히 · ~ 50 mm');
    // 나란한 선 바로 위(45°)를 가리키면 정확히 50 mm
    const [ex, ey] = at(45, 50);
    r.move(ex, ey);
    expect(r.tip()).toBe('모서리와 나란히 · 50 mm');
    expect(r.key('ArrowDown')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'parallel', source: 'key' });
    expect(r.locks.at(-1)).toBe('parallel');
    r.move(170, 60);
    expect(r.q('line.measure-rubber')?.getAttribute('data-locked')).toBe('parallel');
    expect(r.key('ArrowDown')).toBe(true);
    expect(r.tool.inferenceLock).toBeNull();
    // 커서 밑이 축 추론이어도 ↓는 앞서 지나간 모서리와 나란히
    r.move(100, 160);
    expect(r.key('ArrowDown')).toBe(true);
    expect(r.tool.inferenceLock?.kind).toBe('parallel');
    r.click(170, 60);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [55, 55, 0]);
  });

  it('지나간 모서리에 수직이면 자홍 수직(기준 모서리 점선), ↓로 잠그면 "모서리에 수직"으로 잠금 — 찍은 점이 그 선 위', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]]), lines('d', [[-90, -60, 0, -60, -30, 0]])] });
    r.tool.setMode('tape');
    r.click(101, 100);
    // 45° 모서리(가운데)를 지나간 뒤 시작점에서 그에 수직인 쪽(−45°에서 2° 벗어남)으로
    r.move(25, 145);
    const [x, y] = at(-43, 50);
    r.move(x, y);
    expect(r.q('.measure-snap-perpendicular')).not.toBeNull();
    const rubber = r.q('line.measure-rubber.measure-perpendicular');
    expect(rubber?.getAttribute('stroke')).toBe('#c800c8');
    expect(r.q('.measure-parallel-ref')).not.toBeNull();
    expect(r.tip()).toBe('모서리에 수직 · ~ 50 mm');
    expect(r.key('ArrowDown')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'perpendicular', source: 'key' });
    expect(r.locks.at(-1)).toBe('perpendicular');
    // 잠근 채 다른 곳을 찍어도 그 선 위(세계 (70, 40)을 선에 내린 자리)
    r.move(170, 60);
    expect(r.q('line.measure-rubber')?.getAttribute('data-locked')).toBe('perpendicular');
    expect(r.q('.measure-parallel-ref')).not.toBeNull();
    r.click(170, 60);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [15, -15, 0]);
    expect(r.tool.inferenceLock).toBeNull();
  });

  it('지붕 면 위: 처마를 지나간 뒤 그 면 안에서 처마에 수직(비탈을 따라)이면 자홍 수직, ↓로 그 방향 잠금', () => {
    // 처마(X 방향)에서 30°로 오르는 지붕 면을 등각(평행 투영)으로 본다 — 처마 위 시작점에서는 내린 수직이 없고 축을 비친 방향은 축뿐
    const sn = Math.sin(Math.PI / 6), cs = Math.cos(Math.PI / 6), h = 60 * Math.tan(Math.PI / 6);
    const roof: Mesh3d = { id: 'roof', positions: Float32Array.from([0, 0, 0, 100, 0, 0, 100, 60, h, 0, 60, h]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]), color: [0.8, 0.8, 0.8, 1] };
    const a = dirToAngles([1, -1, 1]);
    const iso: CameraState = { target: [40, 20, 10], distance: 300, yaw: a.yaw, pitch: a.pitch, projection: 'orthographic', fovY: FOV };
    const f = frameFor(iso, W, W);
    // 둘레 고르기 시간 예산이 느린 CI에서 먼저 끊기지 않게 시계를 멈춘다(이 describe의 afterEach가 되돌린다)
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const r = rig({ units: 'mm', meshes: [roof], lines: [lines('eave', [[0, 0, 0, 100, 0, 0]])] }, iso);
    r.tool.setMode('tape');
    const s0 = projectToScreen(f, [20, 0, 0])!;
    r.move(s0[0], s0[1]);
    expect(r.tip()).toBe('모서리에');
    r.click(s0[0], s0[1]);
    expect(r.tool.pointCount).toBe(1);
    const s1 = projectToScreen(f, [20, cs * 40, sn * 40])!;
    r.move(s1[0] + 0.5, s1[1] + 0.5);
    expect(r.q('.measure-snap-perpendicular')).not.toBeNull();
    expect(r.q('line.measure-rubber.measure-perpendicular')?.getAttribute('stroke')).toBe('#c800c8');
    expect(r.q('.measure-parallel-ref')).not.toBeNull();
    expect(r.tip()).toMatch(/^모서리에 수직 · /);
    expect(r.key('ArrowDown')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'perpendicular', source: 'key' });
    expect(r.locks.at(-1)).toBe('perpendicular');
    // 잠근 채 지붕 다른 곳을 찍어도 그 선 위(시작점에서 비탈 방향)
    const s2 = projectToScreen(f, [50, 30, h / 2])!;
    r.click(s2[0], s2[1]);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    expect(Math.abs(res.dx)).toBeLessThan(1e-6);
    expect(Math.abs(res.dy * sn - res.dz * cs)).toBeLessThan(1e-4);
    expect(res.distance).toBeGreaterThan(1);
  });

  it('잠금 단추(손가락 기기): 방향을 잡는 동안만, 본 방향이 없으면 false, 축을 주면 그 축 — 탭한 점이 잠근 선 위로', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]])] });
    r.tool.setMode('tape');
    expect(r.tool.directing).toBe(false);
    expect(r.tool.setInferenceLock(true)).toBe(false);
    const tap = (x: number, y: number): void => {
      r.ptr('pointerdown', x, y, { pointerType: 'touch', buttons: 1 });
      r.ptr('pointerup', x, y, { pointerType: 'touch' });
      r.overlay.paintNow();
    };
    tap(101, 100);
    expect(r.tool.directing).toBe(true);
    // 손가락은 커서가 없어 아직 본 방향 추론이 없다
    expect(r.tool.setInferenceLock(true)).toBe(false);
    expect(r.tool.inferenceLock).toBeNull();
    expect(r.tool.setInferenceLock('x')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'button' });
    tap(140, 60);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [40, 0, 0]);
    expect(r.tool.inferenceLock).toBeNull();
    // 커서가 보기를 떠난 뒤 누른 단추는 방향을 잡는 동안 마지막으로 본 방향 추론
    r.click(101, 100);
    r.move(100, 40);
    r.ptr('pointerleave', 0, 0);
    r.overlay.paintNow();
    expect(r.tool.setInferenceLock(true)).toBe(true);
    expect(r.tool.inferenceLock?.axis).toBe('y');
    expect(r.tool.setInferenceLock(false)).toBe(false);
    expect(r.tool.inferenceLock).toBeNull();
    // Esc로 점을 취소하면 잠금도 풀린다
    r.tool.setInferenceLock('z');
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.inferenceLock).toBeNull();
    expect(r.locks.at(-1)).toBeNull();
  });

  it('모서리 끝에서 그 모서리를 따라 가리키면(점 추정) Shift·단추가 그 모서리 방향을 잠근다 — 축과 나란하면 그 축', () => {
    // 원점에서 +Y로 60(녹색 축과 나란), 원점에서 기운 40·30, 원점을 지나지 않는 모서리
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 0, 60, 0]]), lines('d', [[0, 0, 0, 40, 30, 0]]), lines('h', [[50, -50, 0, 80, -50, 0]])] });
    r.tool.setMode('tape');
    r.click(100, 100);
    // 모서리 위라 축 추론이 아니지만 Shift가 녹색 축을 잠근다
    r.move(101, 55);
    expect(r.tip()).toBe('모서리에 · 45 mm');
    expect(r.key('Shift')).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'shift' });
    r.move(160, 20, { shift: true });
    expect(r.tip()).toBe('녹색 축에 · 잠금 · 80 mm');
    r.key('Shift', 'keyup');
    expect(r.tool.inferenceLock).toBeNull();
    // 기운 모서리의 중간점: 그 모서리와 나란히 잠그고, 선 밖을 찍어도 그 선 위
    r.move(120, 85);
    expect(r.tip()).toBe('중간점 · 25 mm');
    r.key('Shift');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'parallel', source: 'shift' });
    expect(r.locks.at(-1)).toBe('parallel');
    r.click(180, 20, { shift: true });
    let res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    // (80, 80)을 (0.8, 0.6) 선에 내린 자리: 112 → (89.6, 67.2)
    near(res.b, [89.6, 67.2, 0]);
    r.key('Shift', 'keyup');
    // 시작점 자리(모서리가 만나는 꼭짓점)·시작점을 지나지 않는 모서리는 잠그지 않는다
    r.click(100, 100);
    r.move(100, 100);
    r.key('Shift');
    expect(r.tool.inferenceLock).toBeNull();
    r.key('Shift', 'keyup');
    r.move(165, 150);
    expect(r.tip()).toMatch(/^중간점/);
    r.key('Shift');
    expect(r.tool.inferenceLock).toBeNull();
    r.key('Shift', 'keyup');
    // 손가락 기기 단추: 커서 밑 모서리 방향, 커서가 떠난 뒤에는 마지막으로 본 그 방향
    r.move(101, 55);
    expect(r.tool.setInferenceLock(true)).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'button' });
    r.tool.setInferenceLock(false);
    r.move(120, 85);
    r.ptr('pointerleave', 0, 0);
    r.overlay.paintNow();
    expect(r.tool.setInferenceLock(true)).toBe(true);
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'parallel', source: 'button' });
    r.click(180, 20);
    res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.b, [89.6, 67.2, 0]);
  });

  it('각도기: 중심 전 →·←·↑는 각도기 평면을 그 축에 고정(다시 누르면 풀기, Esc가 먼저 푼다), 중심을 찍으면 그 평면', () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    expect(r.key('ArrowRight')).toBe(true);
    expect(r.tool.planeAxis).toBe('x');
    expect(r.locks.at(-1)).toBe('plane-x');
    r.move(102, 103);
    const disk = r.q('.measure-protractor');
    expect(disk?.getAttribute('data-axis')).toBe('x');
    expect(disk?.classList.contains('is-locked')).toBe(true);
    expect(r.key('ArrowRight')).toBe(true);
    expect(r.tool.planeAxis).toBeNull();
    r.key('ArrowLeft');
    expect(r.tool.planeAxis).toBe('y');
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.planeAxis).toBeNull();
    expect(r.tool.mode).toBe('protractor');
    r.key('ArrowRight');
    r.click(102, 103);
    expect(r.tool.planeAxis).toBeNull();
    r.move(150, 60);
    expect(r.q('.measure-protractor')?.getAttribute('data-axis')).toBe('x');
  });

  it('잠금 안내 글: 방향을 잡는 동안 잠근 방향, 키보드 기기는 Shift·화살표, 각도기 중심 전 화살표 평면', () => {
    expect(lockHint('tape', 1, null, null)).toBe(LOCK_KEYS_HINT);
    expect(lockHint('tape', 1, null, null, true)).toBeNull();
    expect(lockHint('tape', 1, 'x', null, true)).toBe('빨강 축으로 잠금');
    expect(lockHint('tape', 0, 'x', null)).toBeNull();
    expect(lockHint('protractor', 2, 'parallel', null)).toBe(LOCK_HINTS.parallel);
    expect(lockHint('protractor', 0, null, 'z')).toBe('파랑 각도기로 고정');
    expect(lockHint('protractor', 0, null, null)).toBeNull();
    expect(lockHint(null, 1, 'x', null)).toBeNull();
    expect(lockName({ kind: 'perpendicular', label: '면에 수직' })).toBe('facePerpendicular');
    expect(lockName({ kind: 'perpendicular', label: '모서리에 수직' })).toBe('perpendicular');
    expect(lockName({ kind: 'axis', axis: 'z', label: '파랑 축에' })).toBe('z');
    expect(lockName(null)).toBeNull();
  });
});

describe('측정 도구: 정밀 조준(터치 길게 누르기)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const touch = { pointerType: 'touch' };
  const down = (r: Rig, x: number, y: number, id = 1): void => r.ptr('pointerdown', x, y, { ...touch, id, buttons: 1 });

  it('손가락 위 십자선으로 추정을 보며 옮기고, 떼면 십자선 자리에 찍는다(그동안 궤도는 막는다)', () => {
    vi.useFakeTimers();
    const r = rig(EDGES());
    r.tool.setMode('tape');
    // 원점 끝점(화면 100,100)의 64화소 아래를 길게 누른다
    down(r, 101, 100 + AIM_OFFSET_PX + 1);
    expect(r.tool.aiming).toBe(false);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(r.tool.aiming).toBe(true);
    r.overlay.paintNow();
    expect(r.q('.measure-aim')).not.toBeNull();
    expect(r.tip()).toBe('끝점');

    // 끌면 십자선이 따라가고, 캔버스(코어 궤도)에는 움직임이 닿지 않는다
    let reached = 0;
    r.canvas.addEventListener('pointermove', () => reached++);
    r.ptr('pointermove', 151, 100 + AIM_OFFSET_PX + 2, { ...touch, buttons: 1 });
    r.overlay.paintNow();
    expect(reached).toBe(0);
    expect(r.q('.measure-snap-midpoint')).not.toBeNull();
    expect(r.tip()).toBe('중간점');
    r.ptr('pointerup', 151, 100 + AIM_OFFSET_PX + 2, touch);
    r.overlay.paintNow();
    expect(r.tool.aiming).toBe(false);
    expect(r.tool.pointCount).toBe(1);
    expect(r.q('.measure-aim')).toBeNull();

    // 둘째 점도 조준으로: 고무줄과 거리 툴팁을 보인다
    down(r, 199, 100 + AIM_OFFSET_PX);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    r.overlay.paintNow();
    expect(r.q('line.measure-rubber')).not.toBeNull();
    expect(r.tip()).toBe('끝점 · 50 mm');
    r.ptr('pointerup', 199, 100 + AIM_OFFSET_PX, touch);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: [50, 0, 0], b: [100, 0, 0], distance: 50 });
  });

  it('십자선이 장면 탭(앱이 알려 준 3D 보기 위의 것) 밑으로 가면 탭 아래로 비키고, 떼면 비킨 십자선 자리에 찍는다(25차)', () => {
    vi.useFakeTimers();
    // 보기 위 왼쪽 위 장면 탭(캔버스 0,0 기준 8~128 × 8~52)
    const tabs = document.createElement('div');
    tabs.getBoundingClientRect = () => ({ left: 8, top: 8, width: 120, height: 44, right: 128, bottom: 52, x: 8, y: 8, toJSON: () => ({}) }) as DOMRect;
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { labelAvoid: () => [tabs] });
    const center = (): [number, number] => {
      const c = r.q('.measure-aim circle');
      return [Number(c?.getAttribute('cx')), Number(c?.getAttribute('cy'))];
    };
    r.tool.setMode('tape');
    // 탭에서 먼 자리: 예전처럼 손가락 64화소 위
    down(r, 160.3, 170.4);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    r.overlay.paintNow();
    expect(center()).toEqual([160.3, 170.4 - AIM_OFFSET_PX]);
    // 손가락을 탭 밑으로(십자선이 탭에 들 자리): 탭 아래 변 바깥에 머물고, 그 자리의 추정(Y 모서리 끝점 — 화면 (100, 50))을 보인다
    r.ptr('pointermove', 100.4, 90.6, { ...touch, buttons: 1 });
    r.overlay.paintNow();
    expect(center()).toEqual([100.4, 52 + AIM_COVER_GAP_PX]);
    r.ptr('pointermove', 100.4, 70.6, { ...touch, buttons: 1 });
    r.overlay.paintNow();
    expect(center()).toEqual([100.4, 52 + AIM_COVER_GAP_PX]);
    expect(r.tip()).toBe(SNAP_LABELS.endpoint);
    // 떼면 비킨 십자선 자리의 추정에 찍는다
    r.ptr('pointerup', 100.4, 70.6, touch);
    expect(r.tool.pointCount).toBe(1);
    r.overlay.paintNow();
    const dot = r.q('circle.measure-point');
    expect([Number(dot?.getAttribute('cx')), Number(dot?.getAttribute('cy'))].map((v) => Math.round(v * 10) / 10)).toEqual([100, 50]);
  });

  it('누르자마자 끌면 조준하지 않고(궤도), 둘째 손가락이 닿으면 조준을 그만둔다', () => {
    vi.useFakeTimers();
    const r = rig(EDGES());
    r.tool.setMode('tape');
    down(r, 101, 165);
    r.ptr('pointermove', 120, 165, { ...touch, buttons: 1 });
    vi.advanceTimersByTime(AIM_HOLD_MS * 2);
    expect(r.tool.aiming).toBe(false);
    r.ptr('pointerup', 120, 165, touch);
    expect(r.tool.pointCount).toBe(0);

    down(r, 101, 165);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(r.tool.aiming).toBe(true);
    down(r, 160, 120, 2);
    expect(r.tool.aiming).toBe(false);
    r.ptr('pointerup', 160, 120, { ...touch, id: 2 });
    r.ptr('pointerup', 101, 165, touch);
    r.overlay.paintNow();
    expect(r.tool.pointCount).toBe(0);
    expect(r.q('.measure-aim')).toBeNull();
  });

  it('누르기 문턱은 코어 끌기 시작 거리와 같다(터치 10화소, 마우스 4화소)', () => {
    expect(tapSlopPx('touch')).toBe(TOUCH_DRAG_START_PX);
    expect(TOUCH_DRAG_START_PX).toBe(10);
    expect(tapSlopPx('mouse')).toBe(DRAG_START_PX);
    expect(tapSlopPx('pen')).toBe(DRAG_START_PX);
  });

  it('손가락이 6·9화소 떨려도 점을 찍고(코어도 돌리지 않는다), 10화소 넘게 끌면 궤도라 찍지 않는다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    // 원점 끝점(화면 100,100) 옆을 6화소 떨며 탭
    down(r, 101, 101);
    r.ptr('pointermove', 107, 101, { ...touch, buttons: 1 });
    r.ptr('pointerup', 107, 101, touch);
    expect(r.tool.pointCount).toBe(1);
    // +X 끝점(화면 200,100) 옆을 9화소 떨며 탭: 줄자가 끝난다(두 점 모두 끝점에 붙는다)
    down(r, 199, 101);
    r.ptr('pointermove', 190, 101, { ...touch, buttons: 1 });
    r.ptr('pointerup', 190, 101, touch);
    expect(r.tool.pointCount).toBe(0);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: [0, 0, 0], b: [100, 0, 0], distance: 100 });
    down(r, 101, 101);
    r.ptr('pointermove', 113, 101, { ...touch, buttons: 1 });
    r.ptr('pointerup', 113, 101, touch);
    expect(r.tool.pointCount).toBe(0);
    expect(r.results.filter(Boolean)).toHaveLength(1);
  });

  it('마우스는 그대로 4화소부터 끌기', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.ptr('pointerdown', 101, 101, { buttons: 1 });
    r.ptr('pointermove', 106, 101, { buttons: 1 });
    r.ptr('pointerup', 106, 101);
    expect(r.tool.pointCount).toBe(0);
    r.ptr('pointerdown', 101, 101, { buttons: 1 });
    r.ptr('pointermove', 104, 101, { buttons: 1 });
    r.ptr('pointerup', 104, 101);
    expect(r.tool.pointCount).toBe(1);
  });

  it('길게 누르는 동안 6~8화소 떨려도 정밀 조준을 시작하고, 십자선은 지금 손가락 위에 뜬다', () => {
    vi.useFakeTimers();
    const r = rig(EDGES());
    r.tool.setMode('tape');
    down(r, 101, 100 + AIM_OFFSET_PX);
    r.ptr('pointermove', 107, 100 + AIM_OFFSET_PX + 3, { ...touch, buttons: 1 });
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(r.tool.aiming).toBe(true);
    r.overlay.paintNow();
    const aim = r.q('.measure-aim');
    expect(aim).not.toBeNull();
    r.ptr('pointerup', 107, 100 + AIM_OFFSET_PX + 3, touch);
    expect(r.tool.pointCount).toBe(1);
  });

  it('빈 곳에서 떼면 찍지 않고 십자선 자리 표시를 지운다', () => {
    vi.useFakeTimers();
    const r = rig(EDGES());
    r.tool.setMode('tape');
    down(r, 30, 170);
    vi.advanceTimersByTime(AIM_HOLD_MS);
    r.ptr('pointerup', 30, 170, touch);
    r.overlay.paintNow();
    expect(r.tool.pointCount).toBe(0);
    expect(r.tip()).toBeNull();
  });
});

describe('측정값 칸(VCB): 길이를 쳐서 안내점 찍기', () => {
  it('시작점에서 방향 쪽으로 길이만큼 간 점(음수면 반대쪽, 방향이 없으면 null)', () => {
    expect(pointAlong([1, 1, 0], [11, 1, 0], 4)).toEqual([5, 1, 0]);
    expect(pointAlong([1, 1, 0], [1, 11, 0], -2)).toEqual([1, -1, 0]);
    expect(pointAlong([1, 1, 0], [1, 1, 0], 4)).toBeNull();
    expect(pointAlong([0, 0, 0], [1, 0, 0], Number.NaN)).toBeNull();
  });

  it('시작점을 찍고 커서를 잴 방향에 둔 채 길이를 넣으면 그 길이에 안내점, 결과는 시작점 → 안내점', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    expect(r.tool.applyLength(30)).toBe('start');
    r.click(102, 103);
    // 커서가 아직 시작점 위(방향 없음)
    r.move(101, 101);
    expect(r.tool.applyLength(30)).toBe('direction');
    // 모서리 위 (60, 0) 쪽 — 진행 중 길이(측정값 칸)는 시작점 → 커서
    r.move(160, 101);
    expect(r.lives.at(-1)).toBeCloseTo(60, 6);
    expect(r.tool.applyLength(0)).toBe('zero');
    expect(r.tool.applyLength(30)).toBe('ok');
    expect(r.tool.pointCount).toBe(0);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: [0, 0, 0], distance: 30 });
    const b = (r.results.at(-1) as { b: number[] }).b;
    expect(b[0]).toBeCloseTo(30, 9);
    expect(b[1]).toBeCloseTo(0, 9);
    expect(r.tool.guides).toHaveLength(1);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(1);
    expect(r.q('.measure-label-length')?.textContent).toBe('30 mm');
    // 결과가 있으면 측정값 칸은 그 거리
    expect(r.lives.at(-1)).toBeCloseTo(30, 6);
    // 안내점은 끝점처럼 붙는다(글 '안내점')
    r.move(131, 102);
    expect(r.tip()).toBe('안내점');
  });

  it('두 점을 다 잰 뒤(손가락 기기)는 그 결과의 방향으로, 음수면 반대쪽', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103, { pointerType: 'touch' });
    r.click(198, 101, { pointerType: 'touch' });
    expect(r.results.at(-1)).toMatchObject({ distance: 100 });
    expect(r.tool.applyLength(-25)).toBe('ok');
    const last = r.results.at(-1) as { a: number[]; b: number[]; distance: number };
    expect(last.a).toEqual([0, 0, 0]);
    expect(last.b[0]).toBeCloseTo(-25, 9);
    expect(last.distance).toBeCloseTo(25, 9);
    // 안내점은 새로 재도 남고, clearGuides·각도기에서는 넣지 않는다
    r.click(102, 103, { pointerType: 'touch' });
    expect(r.tool.guides).toHaveLength(1);
    r.tool.clearGuides();
    expect(r.tool.guides).toHaveLength(0);
    r.tool.setMode('protractor');
    expect(r.tool.applyLength(10)).toBe('mode');
  });

  it(`안내점은 ${MAX_GUIDE_POINTS}개까지(오래된 것부터 버린다)`, () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(198, 101);
    for (let i = 1; i <= MAX_GUIDE_POINTS + 3; i++) expect(r.tool.applyLength(i)).toBe('ok');
    expect(r.tool.guides).toHaveLength(MAX_GUIDE_POINTS);
    expect(r.tool.guides[0]![0]).toBeCloseTo(4, 9);
  });
});

describe('측정값 칸: 안내선(모서리와 나란히 · 각도기 각도)', () => {
  it('나란한 안내선 자리: 모서리에 수직인 커서 쪽으로 친 거리(음수면 반대쪽), 커서가 모서리 직선 위면 null', () => {
    const edge: [number[], number[]] = [[0, 0, 0], [10, 0, 0]];
    expect(parallelOffset([2, 0, 0], edge, [7, 4, 0], 3)).toEqual([2, 3, 0]);
    expect(parallelOffset([2, 0, 0], edge, [7, 4, 0], -3)).toEqual([2, -3, 0]);
    // 3D: 수직 성분만 본다(모서리 방향 성분은 버린다)
    const p = parallelOffset([2, 0, 0], edge, [9, 3, 4], 10)!;
    expect(p[0]).toBeCloseTo(2, 12);
    expect(p[1]).toBeCloseTo(6, 12);
    expect(p[2]).toBeCloseTo(8, 12);
    expect(parallelOffset([2, 0, 0], edge, [8, 0, 0], 3)).toBeNull();
    expect(parallelOffset([2, 0, 0], [[1, 1, 1], [1, 1, 1]], [2, 5, 0], 3)).toBeNull();
  });

  it('각도기 안내선 방향: 기준 방향을 평면 안에서 커서 쪽으로 돌리고, 음수는 반대쪽, 커서가 없으면 법선 둘레 시계 반대', () => {
    const near = (a: number[] | null, b: number[]): void => {
      expect(a).not.toBeNull();
      for (let i = 0; i < 3; i++) expect(a![i]).toBeCloseTo(b[i]!, 12);
    };
    const n = [0, 0, 1];
    near(angledGuideDir([0, 0, 0], [10, 0, 0], [0, 5, 0], n, 90), [0, 1, 0]);
    near(angledGuideDir([0, 0, 0], [10, 0, 0], [0, -5, 0], n, 90), [0, -1, 0]);
    near(angledGuideDir([0, 0, 0], [10, 0, 0], [0, 5, 0], n, -90), [0, -1, 0]);
    near(angledGuideDir([0, 0, 0], [10, 0, 0], null, n, 30), [Math.cos(Math.PI / 6), 0.5, 0]);
    // 기준 방향이 평면 밖으로 기울어 있어도 평면에 비친 방향에서 돈다
    near(angledGuideDir([1, 1, 0], [11, 1, 7], [1, 9, 3], n, 45), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    expect(angledGuideDir([0, 0, 0], [0, 0, 5], [0, 5, 0], n, 30)).toBeNull();
  });

  it('화면 선분 자르기와 안내선 화면 선분(평행 투영은 화면 끝까지, 시선과 나란하면 그리지 않는다)', () => {
    expect(clipToRect([-10, 50, 210, 50], 0, 0, 200, 200)).toEqual([0, 50, 200, 50]);
    clipToRect([50, -10, 50, 300], 0, 0, 200, 200)!.forEach((v, i) => expect(v).toBeCloseTo([50, 0, 50, 200][i]!, 9));
    expect(clipToRect([-10, -10, -5, 300], 0, 0, 200, 200)).toBeNull();
    // 안내선 테두리: 밝은 선(어두운 테마 글자 색)은 검정, 어두운 선·모르는 색은 흰색
    expect(haloFor('rgb(232, 235, 240)')).toBe('#000000');
    expect(haloFor('rgb(29, 37, 48)')).toBe('#ffffff');
    expect(haloFor('')).toBe('#ffffff');
    const f = frameFor(TOP, W, W);
    const s = guideLineScreen(f, { point: [30, 25, 0], dir: [1, 0, 0] }, 4)!;
    expect(Math.min(s[0], s[2])).toBeCloseTo(-4, 6);
    expect(Math.max(s[0], s[2])).toBeCloseTo(W + 4, 6);
    expect(s[1]).toBeCloseTo(75, 6);
    expect(s[3]).toBeCloseTo(75, 6);
    expect(guideLineScreen(f, { point: [0, 0, 0], dir: [0, 0, 1] })).toBeNull();
    expect(guideLineScreen(f, { point: [0, 500, 0], dir: [1, 0, 0] })).toBeNull();
    // 원근: 눈 뒤로 넘어가는 선도 눈 앞쪽만 보기 안에서 그린다
    const cam: CameraState = { target: [0, 0, 0], distance: 300, yaw: 0, pitch: 0.4, projection: 'perspective', fovY: FOV };
    const fp = frameFor(cam, W, W);
    for (const dir of [[1, 0, 0], [0, 1, 0], [0.6, 0.8, 0]] as [number, number, number][]) {
      const q = guideLineScreen(fp, { point: [0, 0, 0], dir }, 4);
      expect(q, String(dir)).not.toBeNull();
      for (const v of q!) expect(v).toBeGreaterThanOrEqual(-4 - 1e-6);
      for (const v of q!) expect(v).toBeLessThanOrEqual(W + 4 + 1e-6);
    }
  });

  // 원점에서 +X로 100 모서리와 X = −60의 세로 모서리(−80 ~ 80)
  const TWO = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0], [-60, -80, 0, -60, 80, 0]])] });

  it('줄자를 모서리 위(끝점·중간점이 아닌 곳)에서 시작해 길이를 치면 안내점 대신 그 모서리와 나란한 안내선', () => {
    const r = rig(TWO());
    r.tool.setMode('tape');
    r.click(130, 101);
    expect(r.tool.edgeStart).toBe(true);
    expect(r.hints.at(-1)).toContain('모서리와 나란한 안내선');
    // 커서를 위(+Y)로: 축 고정(녹색), 진행 중 길이는 그대로 시작점 → 커서
    r.move(130, 60);
    expect(r.liveKinds.at(-1)).toBe('length');
    expect(r.tool.applyLength(30)).toBe('ok');
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(1);
    const gl = r.tool.guideLines[0]!;
    expect(gl.dir).toEqual([1, 0, 0]);
    expect(gl.point[1]).toBeCloseTo(30, 6);
    const res = r.results.at(-1) as { a: number[]; b: number[]; distance: number };
    expect(res.distance).toBeCloseTo(30, 6);
    expect(res.b[0]).toBeCloseTo(res.a[0]!, 6);
    r.overlay.paintNow();
    const line = r.q('.measure-guide-line line:last-child')!;
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(70, 1);
    expect(Number(line.getAttribute('y2'))).toBeCloseTo(70, 1);
    expect(Math.abs(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')))).toBeGreaterThan(W);
    // 안내선은 모서리 위처럼 붙고, 다른 모서리와 만나는 곳은 교차점
    r.move(170, 71);
    expect(r.tip()).toBe('안내선에');
    r.move(41, 71);
    expect(r.tip()).toBe('교차점');
    // 안내선 위에서 시작해도 나란한 안내선
    r.click(170, 71);
    expect(r.tool.edgeStart).toBe(true);
    r.move(170, 40);
    expect(r.tool.applyLength(20)).toBe('ok');
    expect(r.tool.guideLines).toHaveLength(2);
    expect(r.tool.guideLines[1]!.point[1]).toBeCloseTo(50, 6);
    // 끝점에서 시작하면 전처럼 안내점
    r.click(102, 101);
    expect(r.tool.edgeStart).toBe(false);
    r.move(102, 20);
    expect(r.tool.applyLength(10)).toBe('ok');
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.guideLines).toHaveLength(2);
    r.tool.clearGuides();
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(0);
  });

  it('손가락 기기: 모서리 위에서 시작한 결과 뒤에 친 길이는 결과 쪽으로 나란한 안내선(음수면 반대쪽)', () => {
    const r = rig(TWO());
    r.tool.setMode('tape');
    r.click(125, 101, { pointerType: 'touch' });
    r.click(40, 60, { pointerType: 'touch' });
    expect(r.results.at(-1)?.kind).toBe('tape');
    expect(r.tool.edgeStart).toBe(true);
    expect(r.tool.applyLength(-10)).toBe('ok');
    const gl = r.tool.guideLines.at(-1)!;
    expect(gl.dir).toEqual([1, 0, 0]);
    expect(gl.point[1]).toBeCloseTo(-10, 6);
  });

  it('각도기: 기준 방향 뒤 각도를 치면 중심을 지나 커서 쪽으로 돈 안내선(음수는 반대쪽), 결과 뒤에는 결과 쪽으로', () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    expect(r.tool.applyAngle(30)).toBe('start');
    r.click(101, 101);
    expect(r.tool.applyAngle(30)).toBe('start');
    r.click(197, 102);
    expect(r.hints.at(-1)).toContain('각도를 치면 안내선');
    r.move(101, 52);
    // 측정값 칸은 지금 각도
    expect(r.liveKinds.at(-1)).toBe('angle');
    expect(r.lives.at(-1)).toBeCloseTo(90, 6);
    expect(r.tool.applyAngle(0)).toBe('zero');
    expect(r.tool.applyAngle(30)).toBe('ok');
    expect(r.tool.pointCount).toBe(0);
    let gl = r.tool.guideLines.at(-1)!;
    expect(gl.point).toEqual([0, 0, 0]);
    expect(gl.dir[0]).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(gl.dir[1]).toBeCloseTo(0.5, 9);
    const res = r.results.at(-1);
    expect(res?.kind).toBe('protractor');
    if (res?.kind !== 'protractor') return;
    expect(res.angle).toBeCloseTo(30, 9);
    r.overlay.paintNow();
    expect(r.lives.at(-1)).toBeCloseTo(30, 6);
    expect(r.qa('.measure-guide-line')).toHaveLength(1);
    expect(r.q('.measure-label-angle')?.textContent).toBe('30.0°');
    // 다 잰 뒤(손가락 기기)는 결과의 잰 방향 쪽으로
    expect(r.tool.applyAngle(45)).toBe('ok');
    gl = r.tool.guideLines.at(-1)!;
    expect(gl.dir[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(gl.dir[1]).toBeCloseTo(Math.SQRT1_2, 9);
    // 음수는 반대쪽
    r.click(101, 101);
    r.click(197, 102);
    r.move(101, 52);
    expect(r.tool.applyAngle(-30)).toBe('ok');
    gl = r.tool.guideLines.at(-1)!;
    expect(gl.dir[1]).toBeCloseTo(-0.5, 9);
    expect(r.tool.guideLines).toHaveLength(3);
    // 커서가 없으면(손가락) 돌릴 쪽을 모른다
    r.click(101, 101, { pointerType: 'touch' });
    r.click(197, 102, { pointerType: 'touch' });
    expect(r.tool.applyAngle(30)).toBe('direction');
    r.tool.setMode('tape');
    expect(r.tool.applyAngle(30)).toBe('mode');
  });

  it(`안내선은 ${MAX_GUIDE_LINES}개까지(오래된 것부터 버린다)`, () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    r.click(101, 101);
    r.click(197, 102);
    r.move(101, 52);
    expect(r.tool.applyAngle(1)).toBe('ok');
    for (let i = 2; i <= MAX_GUIDE_LINES + 3; i++) expect(r.tool.applyAngle(i)).toBe('ok');
    expect(r.tool.guideLines).toHaveLength(MAX_GUIDE_LINES);
  });
});

describe('측정 도구: 안내 두기(누르기로 안내점·안내선 — SketchUp 줄자·각도기의 +)', () => {
  // 모서리(EDGES)와 그 밑 바닥 면(z = 0, 보기 전체)
  const FLOOR = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({ ...EDGES(), meshes: [quad('f', -100, -100, 100, 100, 0)] });
  const near = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

  it('안내 두기 키: Windows·Linux는 Ctrl, Mac은 Option — 안내 글은 키보드 기기에서 점을 찍기 전만', () => {
    expect(guideKeyFor('Win32')).toBe('Control');
    expect(guideKeyFor('Linux x86_64')).toBe('Control');
    expect(guideKeyFor('MacIntel')).toBe('Alt');
    expect(guideKeyFor('macOS')).toBe('Alt');
    expect(guideKeyFor('iPad')).toBe('Alt');
    expect(guideKeyFor(undefined)).toBe('Control');
    expect(GUIDE_KEY_NAMES.Alt).toBe('Option');
    expect(guideKeyHint('tape', 0, false)).toBe('Ctrl: 안내 두기');
    expect(guideKeyHint('protractor', 0, true, 'Alt')).toBe('Option: 안내 두기 끄기');
    expect(guideKeyHint('tape', 1, false)).toBeNull();
    expect(guideKeyHint('tape', 0, false, 'Control', true)).toBeNull();
    expect(guideKeyHint(null, 0, false)).toBeNull();
    // 켜면 안내 글이 안내점·안내선을 말한다(손가락 기기는 키 설명 없이)
    expect(measureHint('tape', 0, false, false, false, true)).toContain('안내를 둘 시작점');
    expect(measureHint('tape', 1, false, false, false, true)).toContain('안내점을 둘 곳');
    expect(measureHint('tape', 1, false, false, true, true)).toContain('나란한 안내선을 둘 곳');
    expect(measureHint('protractor', 2, false, false, false, true)).toContain('안내선을 둘 방향');
    for (const [mode, n, edge] of [['tape', 0, false], ['tape', 1, false], ['tape', 1, true], ['protractor', 2, false]] as const)
      expect(measureHint(mode, n, false, true, edge, true)).not.toMatch(/Esc|Shift|Ctrl/);
    expect(measureHint('tape', 0, false, true, false, true)).toContain('길게 누르면 정밀 조준');
    // 결과가 있을 때·각도기 중심·기준 방향은 그대로
    expect(measureHint('tape', 0, true, false, false, true)).toBe(measureHint('tape', 0, true));
    expect(measureHint('protractor', 1, false, false, false, true)).toBe(measureHint('protractor', 1, false));
  });

  it('안내 두기 키만 눌렀다 떼면 켜고 끈다 — 그사이 다른 키·누르기가 있으면 그대로, 도구를 바꿔도 남는다', () => {
    const r = rig(EDGES());
    expect(r.key('Control')).toBe(false);
    expect(r.key('Control', 'keyup')).toBe(false);
    r.tool.setMode('tape');
    expect(r.tool.guideMode).toBe(false);
    expect(r.key('Control')).toBe(false);
    expect(r.key('Control', 'keyup')).toBe(true);
    expect(r.tool.guideMode).toBe(true);
    expect(r.guideCalls()).toBe(1);
    expect(r.hints.at(-1)).toContain('안내를 둘 시작점');
    // Ctrl+O처럼 다른 키와 함께면 바꾸지 않는다
    r.key('Control');
    r.key('o');
    expect(r.key('Control', 'keyup')).toBe(false);
    expect(r.tool.guideMode).toBe(true);
    // 누른 채 누르기(Ctrl+누르기)도 아니다
    r.key('Control');
    r.click(30, 170);
    expect(r.key('Control', 'keyup')).toBe(false);
    expect(r.tool.guideMode).toBe(true);
    // Option(Alt)은 이 기기의 키가 아니다
    r.key('Alt');
    expect(r.key('Alt', 'keyup')).toBe(false);
    // 도구를 바꾸거나 껐다 켜도 남는다
    r.tool.setMode('protractor');
    expect(r.tool.guideMode).toBe(true);
    r.tool.setMode(null);
    r.tool.setMode('tape');
    expect(r.tool.guideMode).toBe(true);
    r.key('Control');
    r.key('Control', 'keyup');
    expect(r.tool.guideMode).toBe(false);
    expect(r.hints.at(-1)).toBe(TAPE_START_HINT);
    // Mac: Option
    const m = rig(EDGES(), TOP, DEFAULT_UNITS, { guideKey: 'Alt' });
    m.tool.setMode('tape');
    m.key('Control');
    expect(m.key('Control', 'keyup')).toBe(false);
    m.key('Alt');
    expect(m.key('Alt', 'keyup')).toBe(true);
    expect(m.tool.guideMode).toBe(true);
  });

  it('재기만(기본)은 누르기로 안내를 두지 않는다', () => {
    const r = rig(FLOOR());
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(160, 60);
    r.click(130, 101);
    r.click(160, 60);
    expect(r.results.at(-1)?.kind).toBe('tape');
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(0);
    r.overlay.paintNow();
    expect(r.q('.measure-guide-plus')).toBeNull();
  });

  it('줄자를 점(끝점)에서 시작하면 둘째 누르기 자리에 안내점(같은 자리에 다시 누르면 늘지 않는다)', () => {
    const r = rig(FLOOR());
    r.tool.setMode('tape');
    r.tool.setGuideMode(true);
    r.move(102, 103);
    expect(r.q('.measure-guide-plus')).not.toBeNull();
    r.click(102, 103);
    expect(r.hints.at(-1)).toContain('안내점을 둘 곳');
    r.click(160, 60);
    expect(r.tool.guides).toHaveLength(1);
    near(r.tool.guides[0]!, [60, 40, 0]);
    expect(r.tool.guideLines).toHaveLength(0);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    expect(res.distance).toBeCloseTo(Math.hypot(60, 40), 6);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(1);
    // 그 안내점에서 다시 재면 같은 자리라 늘지 않는다
    r.click(102, 103);
    r.move(160, 60);
    expect(r.tip()).toContain('안내점');
    r.click(160, 60);
    expect(r.tool.guides).toHaveLength(1);
  });

  it('줄자를 모서리 위에서 시작하면 둘째 점을 지나 그 모서리와 나란한 안내선, 결과는 모서리에 수직인 거리', () => {
    const r = rig(FLOOR());
    r.tool.setMode('tape');
    r.tool.setGuideMode(true);
    r.click(130, 101);
    expect(r.tool.edgeStart).toBe(true);
    expect(r.hints.at(-1)).toContain('나란한 안내선을 둘 곳');
    // 면 위 (60, 40): 미리 보기 안내선과 모서리에 수직인 길이 40
    r.move(160, 60);
    expect(r.q('.measure-guide-line.is-preview')).not.toBeNull();
    expect(r.lives.at(-1)).toBeCloseTo(40, 6);
    expect(r.tip()).toBe('면에 · 40 mm');
    const before = r.guideCalls();
    r.click(160, 60);
    expect(r.guideCalls()).toBe(before + 1);
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(1);
    const gl = r.tool.guideLines[0]!;
    near(gl.dir, [1, 0, 0]);
    expect(gl.point[1]).toBeCloseTo(40, 6);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    near(res.a, [30, 0, 0]);
    near(res.b, [30, 40, 0]);
    expect(res.distance).toBeCloseTo(40, 6);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide-line:not(.is-preview)')).toHaveLength(1);
    // 둘째 점이 모서리 직선 위면 안내선 없이 재기만
    r.click(130, 101);
    r.click(170, 101);
    expect(r.tool.guideLines).toHaveLength(1);
    expect((r.results.at(-1) as { distance: number }).distance).toBeCloseTo(40, 6);
    // 발 자리 계산: 모서리 직선 위의 점은 null
    expect(edgeFoot([0, 0, 0], [[0, 0, 0], [10, 0, 0]], [5, 0, 0])).toBeNull();
    expect(edgeFoot([2, 0, 0], [[0, 0, 0], [10, 0, 0]], [7, 3, 4])).toEqual([2, 3, 4]);
  });

  it('각도기 셋째 누르기는 중심을 지나 잰 방향으로 안내선', () => {
    const r = rig(FLOOR());
    r.tool.setMode('protractor');
    r.tool.setGuideMode(true);
    r.click(101, 101);
    r.click(197, 102);
    expect(r.hints.at(-1)).toContain('안내선을 둘 방향');
    r.move(160, 60);
    expect(r.q('.measure-guide-line.is-preview')).not.toBeNull();
    r.click(160, 60);
    expect(r.tool.guideLines).toHaveLength(1);
    const gl = r.tool.guideLines[0]!;
    near(gl.point, [0, 0, 0]);
    near(gl.dir, [0.6 / Math.hypot(0.6, 0.4), 0.4 / Math.hypot(0.6, 0.4), 0]);
    const res = r.results.at(-1);
    if (res?.kind !== 'protractor') throw new Error('protractor');
    expect(res.angle).toBeCloseTo((Math.atan2(40, 60) * 180) / Math.PI, 6);
  });
});

describe('측정 도구: 안내 하나씩 고르고 지우기', () => {
  const del = (r: Rig, key = 'Delete'): { handled: boolean; prevented: boolean } => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true });
    const handled = r.tool.handleKey(e);
    return { handled, prevented: e.defaultPrevented };
  };

  it('안내점을 누르면 고르고 Delete로 지운다 — 그 누르기로 찍은 시작점도 거둔다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    r.move(160, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    // 방금 둔 안내는 골라 둔다(잘못 두었으면 바로 지우게)
    expect(r.tool.selectedGuide).toBe('point');
    r.overlay.paintNow();
    expect(r.q('.measure-guide.is-selected path:last-child')?.getAttribute('stroke')).toBe(GUIDE_SELECTED_COLOR);
    // Esc는 결과와 함께 고른 것도 푼다(Esc 차례는 늘지 않는다)
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.key('Escape')).toBe(false);
    // 안내점을 눌러 고르기(시작점도 그 자리)
    r.click(130, 101);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.selectedGuide).toBe('point');
    const calls = r.guideCalls();
    expect(del(r)).toEqual({ handled: true, prevented: true });
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.guideCalls()).toBe(calls + 1);
    expect(r.hints.at(-1)).toBe(TAPE_START_HINT);
    // 고른 것이 없으면 Delete를 받지 않는다(앱·브라우저 몫)
    expect(del(r)).toEqual({ handled: false, prevented: false });
  });

  it('안내선을 둘째 점으로 눌러 고르고 Backspace로 지우면 결과는 남는다, 다른 곳·빈 곳을 누르거나 다시 재기면 푼다', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0], [-60, -80, 0, -60, 80, 0]])] });
    r.tool.setMode('tape');
    r.click(130, 101);
    r.move(130, 60);
    expect(r.tool.applyLength(30)).toBe('ok');
    expect(r.tool.selectedGuide).toBe('line');
    r.overlay.paintNow();
    const sel = r.q('.measure-guide-line.is-selected line:last-child');
    expect(sel?.getAttribute('stroke')).toBe(GUIDE_SELECTED_COLOR);
    // 안내가 아닌 끝점을 누르면 푼다
    r.click(102, 101);
    expect(r.tool.selectedGuide).toBeNull();
    // 둘째 점으로 안내선 위를 누르면 고른다(결과는 그대로)
    r.click(170, 71);
    expect(r.tool.result?.kind).toBe('tape');
    expect(r.tool.selectedGuide).toBe('line');
    expect(del(r, 'Backspace').handled).toBe(true);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.result?.kind).toBe('tape');
    // 빈 곳 누르기·다시 재기(clear)도 푼다
    r.click(102, 101);
    r.move(102, 40);
    expect(r.tool.applyLength(10)).toBe('ok');
    expect(r.tool.selectedGuide).toBe('point');
    r.click(60, 170);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.selectedGuide).toBeNull();
    r.click(102, 101);
    r.move(102, 50);
    expect(r.tool.applyLength(20)).toBe('ok');
    expect(r.tool.selectedGuide).toBe('point');
    r.tool.clear();
    expect(r.tool.selectedGuide).toBeNull();
    // 모두 지우기도(안내점 (0, 20)을 눌러 고른 뒤)
    r.click(100, 80);
    expect(r.tool.selectedGuide).toBe('point');
    r.tool.clearGuides();
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.deleteSelectedGuide()).toBe(false);
  });

  it('안내 두기로 둔 안내는 골라 두고, 지워도 다른 안내는 남는다(각도기 셋째 누르기의 안내선)', () => {
    const r = rig({ ...EDGES(), meshes: [quad('f', -100, -100, 100, 100, 0)] });
    r.tool.setMode('protractor');
    r.tool.setGuideMode(true);
    r.click(101, 101);
    r.click(197, 102);
    r.click(160, 60);
    r.click(101, 101);
    r.click(197, 102);
    r.click(130, 40);
    expect(r.tool.guideLines).toHaveLength(2);
    expect(r.tool.selectedGuide).toBe('line');
    const keep = r.tool.guideLines[0]!;
    expect(r.tool.deleteSelectedGuide()).toBe(true);
    expect(r.tool.guideLines).toEqual([keep]);
    // 도구를 바꾸면 고른 것은 풀리고 안내는 남는다
    r.click(101, 101);
    r.click(197, 102);
    r.click(130, 40);
    expect(r.tool.selectedGuide).toBe('line');
    r.tool.setMode('tape');
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.guideLines).toHaveLength(2);
  });
});

describe('고르기 도구로 안내 고르고 지우기(줄자·각도기를 끈 동안 — SketchUp "Using guides")', () => {
  // 위에서 본 평행 투영: 세계 (X, Y) → 화면 (100 + X, 100 − Y). 누르는 자리는 허용 거리 경계에서 떨어진 곳만 가리킨다
  const F = (): ReturnType<typeof frameFor> => frameFor(TOP, W, W);
  const press = (r: Rig, key: string, target?: EventTarget): { handled: boolean; prevented: boolean } => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true });
    if (target) Object.defineProperty(e, 'target', { value: target });
    const handled = r.tool.selectKey(e);
    return { handled, prevented: e.defaultPrevented };
  };
  /** 줄자로 (30, 0)에 안내점, (70, 30)을 지나 X축과 나란한 안내선(모서리 위에서 시작)을 두고 도구를 끈다 */
  const withGuides = (): Rig => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0], [-60, -80, 0, -60, 80, 0]])] });
    r.tool.setMode('tape');
    r.click(102, 101);
    r.move(160, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    r.tool.clear();
    r.click(170, 101);
    r.move(170, 60);
    expect(r.tool.applyLength(30)).toBe('ok');
    r.tool.setMode(null);
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.selectedGuide).toBeNull();
    return r;
  };

  it('guideHit: 허용 거리 안의 가장 가까운 안내점, 없으면 안내선, 둘 다 없으면 null', () => {
    const pts: V3[] = [
      [30, 0, 0],
      [60, 0, 0],
    ];
    const lns = [{ point: [0, 30, 0] as V3, dir: [1, 0, 0] as V3 }];
    // 안내점 (130, 100)·(160, 100), 안내선 y = 70
    expect(guideHit(F(), pts, lns, 133.2, 102.1, 6)).toEqual({ kind: 'point', index: 0 });
    expect(guideHit(F(), pts, lns, 157.3, 98.6, 6)).toEqual({ kind: 'point', index: 1 });
    expect(guideHit(F(), pts, lns, 40.4, 73.3, 6)).toEqual({ kind: 'line', index: 0 });
    // 안내점이 안내선과 함께 닿으면 안내점(점 표식이 선 위에 그려진다)
    expect(guideHit(F(), [[30, 27, 0]], lns, 130.2, 71.1, 6)).toEqual({ kind: 'point', index: 0 });
    expect(guideHit(F(), pts, lns, 140.3, 88.7, 6)).toBeNull();
    // 손가락 허용 거리(14)면 닿는다
    expect(guideHit(F(), pts, lns, 140.3, 98.7, 14)).toEqual({ kind: 'point', index: 0 });
    expect(guideHit(F(), [], lns, 40.4, 81.6, 14)).toEqual({ kind: 'line', index: 0 });
    expect(guideHit(F(), [], lns, 40.4, 81.6, 6)).toBeNull();
  });

  it('도구를 끈 동안 안내점을 누르면 고르고 Delete로 지운다(되돌리기 목록에 쌓임), 빈 곳이면 풀고 null', () => {
    const r = withGuides();
    const calls = r.guideCalls();
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBe('point');
    expect(r.tool.selectedGuide).toBe('point');
    expect(r.guideCalls()).toBe(calls + 1);
    // 도구를 끈 동안에도 고른 안내점은 파랑으로 그린다
    r.overlay.paintNow();
    expect(r.q('.measure-guide.is-selected path:last-child')?.getAttribute('stroke')).toBe(GUIDE_SELECTED_COLOR);
    expect(r.tool.guidePickText(false)).toBe(`${GUIDE_KIND_NAMES.point} · ${GUIDE_DELETE_KEY_HINT}`);
    expect(r.tool.guidePickText(true)).toBe('안내점');
    expect(press(r, 'Delete')).toEqual({ handled: true, prevented: true });
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.guidePickText(false)).toBeNull();
    // 되돌리면 안내점이 돌아온다
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toHaveLength(1);
    // 빈 곳: 고르지 않고 고른 것을 푼다(앱은 그때 형상을 고른다)
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBe('point');
    expect(r.tool.pickGuide(40.6, 150.3, 'mouse')).toBeNull();
    expect(r.tool.selectedGuide).toBeNull();
    // 고른 것이 없으면 키를 받지 않는다
    expect(press(r, 'Delete')).toEqual({ handled: false, prevented: false });
  });

  it('안내선은 선 둘레를 누르면 고르고 Backspace로 지운다 — 손가락은 허용 거리가 넓다, Esc는 풀기만', () => {
    const r = withGuides();
    // 안내선은 y = 70(세계 Y 30)
    expect(r.tool.pickGuide(40.4, 81.6, 'mouse')).toBeNull();
    expect(r.tool.pickGuide(40.4, 81.6, 'touch')).toBe('line');
    expect(r.tool.guidePickText(true)).toBe(GUIDE_KIND_NAMES.line);
    r.overlay.paintNow();
    expect(r.q('.measure-guide-line.is-selected line:last-child')?.getAttribute('stroke')).toBe(GUIDE_SELECTED_COLOR);
    // Esc: 풀기만(안내는 그대로)
    expect(press(r, 'Escape')).toEqual({ handled: true, prevented: true });
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.pickGuide(70.3, 71.8, 'pen')).toBe('line');
    // 다른 키·수정 키·입력 칸의 키는 받지 않는다
    expect(press(r, 'a').handled).toBe(false);
    expect(press(r, 'Backspace', document.createElement('input')).handled).toBe(false);
    expect(r.tool.selectKey(new KeyboardEvent('keydown', { key: 'Delete', ctrlKey: true, cancelable: true }))).toBe(false);
    expect(press(r, 'Backspace')).toEqual({ handled: true, prevented: true });
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.guides).toHaveLength(1);
  });

  it('줄자·각도기를 켠 동안·안내를 숨긴 동안은 고르지 않는다, 형상을 고르면(deselectGuide) 푼다', () => {
    const r = withGuides();
    r.tool.setMode('tape');
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBeNull();
    expect(r.tool.selectedGuide).toBeNull();
    // 켠 동안의 고르기·Delete는 예전 그대로(측정 도구의 키)
    r.click(130.4, 100.6);
    expect(r.tool.selectedGuide).toBe('point');
    expect(r.tool.selectKey(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }))).toBe(false);
    expect(r.tool.guidePickText(false)).toBeNull();
    r.tool.setMode(null);
    r.tool.setGuidesShown(false);
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBeNull();
    r.tool.setGuidesShown(true);
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBe('point');
    const calls = r.guideCalls();
    r.tool.deselectGuide();
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.guideCalls()).toBe(calls + 1);
    r.tool.deselectGuide();
    expect(r.guideCalls()).toBe(calls + 1);
  });

  it('고른 것 카드의 지우기 단추: 선택 해제 ✕ 앞에 붙고, 이름은 고른 안내 종류, 누르면 고른 안내를 지운다', () => {
    const r = withGuides();
    const acts = document.createElement('div');
    const more = document.createElement('button');
    const close = document.createElement('button');
    acts.append(more, close);
    r.tool.mountGuideDelete(acts);
    const b = acts.querySelector<HTMLButtonElement>('.sel-del')!;
    // 25차: 숨기기 단추가 지우기 앞에 함께 붙는다
    const hide = acts.querySelector<HTMLButtonElement>('.sel-hide')!;
    expect([...acts.children]).toEqual([more, hide, b, close]);
    expect(b.textContent).toBe(GUIDE_DELETE_TEXT);
    expect(r.tool.pickGuide(40.4, 72.2, 'mouse')).toBe('line');
    expect(b.getAttribute('aria-label')).toBe('고른 안내선 지우기');
    expect(r.tool.pickGuide(132.6, 101.9, 'mouse')).toBe('point');
    expect(b.getAttribute('aria-label')).toBe('고른 안내점 지우기');
    expect(b.title).toBe('고른 안내점 지우기 (Delete)');
    b.click();
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.selectedGuide).toBeNull();
    // 다시 붙여도 단추는 하나(차례도 그대로)
    r.tool.mountGuideDelete(acts);
    expect(acts.querySelectorAll('.sel-del')).toHaveLength(1);
    expect([...acts.children]).toEqual([more, hide, b, close]);
  });
});

describe('측정 도구: 모서리 두 번 누르기(그 모서리 위 안내선 — SketchUp 줄자)', () => {
  // 두 번 누르기는 시간(코어 DOUBLE_CLICK_MS 450 ms)에 기대므로 시계를 손으로 옮긴다(느린 CI에서도 흔들리지 않게 — 둘레 고르기 시간 예산도 멈춘다)
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  /** 앞 누르기와 두 번 누르기가 되지 않게 시계를 1초 옮긴다 */
  const later = (): void => void (clock += 1000);
  /** 같은 시각에 (x, y)와 (x + dx, y + dy)를 누른다 */
  const dbl = (r: Rig, x: number, y: number, o: { pointerType?: string; dx?: number; dy?: number } = {}): void => {
    later();
    r.click(x, y, { pointerType: o.pointerType });
    r.click(x + (o.dx ?? 1), y + (o.dy ?? 0), { pointerType: o.pointerType });
  };
  const near = (a: readonly number[], b: readonly number[], d = 6): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, d));

  it('두 번 누르기로 볼 모서리(모서리 위·중간점·내린 수직 발)와 같은 직선', () => {
    const e: [V3, V3] = [[0, 0, 0], [10, 0, 0]];
    expect(edgeOfTap({ kind: 'onEdge', edge: e })).toEqual(e);
    expect(edgeOfTap({ kind: 'midpoint', edge: e })).toEqual(e);
    expect(edgeOfTap({ kind: 'perpendicular', edge: e })).toEqual(e);
    // 방향 추론·잠근 선·모서리가 여럿인 점(끝점·교차점)·면·축은 아니다
    expect(edgeOfTap({ kind: 'perpendicular', edge: e, inferred: true })).toBeNull();
    expect(edgeOfTap({ kind: 'onEdge', edge: e, locked: true })).toBeNull();
    for (const kind of ['endpoint', 'intersection', 'center', 'onFace', 'axis', 'parallel', 'free'] as const) expect(edgeOfTap({ kind, edge: e })).toBeNull();
    expect(edgeOfTap({ kind: 'onEdge' })).toBeNull();
    expect(edgeOfTap({ kind: 'onEdge', edge: [[1, 2, 3], [1, 2, 3]] })).toBeNull();
    expect(edgeOfTap(null)).toBeNull();
    // 같은 직선: 거꾸로·같은 직선의 다른 선분(나눈 모서리, 안내선 위 선분). 나란한 다른 직선·다른 방향은 아니다
    expect(collinear(e, [[10, 0, 0], [0, 0, 0]])).toBe(true);
    expect(collinear(e, [[20, 0, 0], [35, 0, 0]])).toBe(true);
    expect(collinear(e, [[0, 1e-3, 0], [10, 1e-3, 0]])).toBe(false);
    expect(collinear(e, [[0, 0, 0], [10, 1, 0]])).toBe(false);
    expect(collinear(e, [[3, 0, 0], [3, 0, 0]])).toBe(false);
  });

  it('마우스: 모서리 위를 두 번 누르면 그 모서리를 지나는 안내선을 골라 두고, 첫 누르기의 시작점은 거두고 지운 결과는 되돌린다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(198, 101);
    const kept = r.tool.result;
    expect(kept).toMatchObject({ kind: 'tape', distance: 100 });
    // X 모서리의 70 자리(끝점·중간점은 반경 밖): 첫 누르기는 여느 때처럼 시작점(결과는 지움)
    later();
    r.click(170, 101);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.result).toBeNull();
    const calls = r.guideCalls();
    r.click(171, 102);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(1);
    const gl = r.tool.guideLines[0]!;
    expect(Math.abs(gl.dir[0])).toBeCloseTo(1, 12);
    near(gl.point, [0, 0, 0]);
    expect(r.tool.selectedGuide).toBe('line');
    expect(r.guideCalls()).toBeGreaterThan(calls);
    expect(r.tool.result).toBe(kept);
    expect(r.results.at(-1)).toBe(kept);
    expect(r.hints.at(-1)).toContain('다시 누르면 새로 잽니다');
    r.overlay.paintNow();
    const sel = r.q('.measure-guide-line.is-selected line:last-child');
    expect(sel?.getAttribute('stroke')).toBe(GUIDE_SELECTED_COLOR);
    expect(Number(sel?.getAttribute('y1'))).toBeCloseTo(100, 1);
    // 같은 모서리를 다시 두 번 누르면 같은 직선이라 늘지 않고 그것을 고른다
    dbl(r, 130, 101);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.selectedGuide).toBe('line');
    expect(r.tool.pointCount).toBe(0);
    // 곧이은 세 번째 누르기는 다시 한 번 누르기(시작점)
    r.click(131, 101);
    expect(r.tool.pointCount).toBe(1);
    // 고른 안내선은 하나씩 지우기로 지운다
    expect(r.key('Escape')).toBe(true);
    r.click(150, 70);
    dbl(r, 101, 70, { dy: 1 });
    expect(r.tool.guideLines).toHaveLength(2);
    expect(Math.abs(r.tool.guideLines[1]!.dir[1])).toBeCloseTo(1, 12);
    expect(r.tool.deleteSelectedGuide()).toBe(true);
    expect(r.tool.guideLines).toHaveLength(1);
  });

  it('시작점을 찍은 뒤 모서리를 두 번 누르면 첫 누르기로 마친 측정은 남기고 안내선만 더한다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    dbl(r, 170, 101);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.selectedGuide).toBe('line');
    expect(r.results).toHaveLength(1);
    expect(r.tool.result).toBe(r.results[0]);
    expect((r.results[0] as { distance: number }).distance).toBeCloseTo(70, 0);
  });

  it('안내 두기를 켜도 모서리 두 번 누르기는 그 모서리 위 안내선 하나(재기만 결과·안내점 없이)', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.tool.setGuideMode(true);
    dbl(r, 170, 101);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(Math.abs(r.tool.guideLines[0]!.dir[0])).toBeCloseTo(1, 12);
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.pointCount).toBe(0);
    expect(r.results).toHaveLength(0);
    expect(r.hints.at(-1)).toContain('안내를 둘 시작점');
  });

  it('다른 직선의 모서리·느린 둘째 누르기·끝점·빈 곳은 두 번 누르기 안내선이 아니다(그대로 잰다)', () => {
    // 화면 4화소 떨어진 나란한 두 모서리
    const r = rig({ units: 'mm', meshes: [], lines: [lines('a', [[-50, 0, 0, 50, 0, 0]]), lines('b', [[-50, 4, 0, 50, 4, 0]])] });
    r.tool.setMode('tape');
    later();
    r.click(130, 101);
    expect(r.tool.pointCount).toBe(1);
    r.click(130, 96);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(0);
    expect((r.results.at(-1) as { distance: number }).distance).toBeCloseTo(4, 6);
    // 0.5초 뒤 둘째 누르기: 시작점과 같은 자리라 그대로
    later();
    r.click(130, 101);
    clock += 500;
    r.click(131, 101);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(1);
    expect(r.key('Escape')).toBe(true);
    // 끝점(모서리가 여럿일 수 있다)은 아니다
    dbl(r, 149, 101);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(1);
    expect(r.key('Escape')).toBe(true);
    // 7화소 떨어지면(마우스 두 번 누르기 거리 6화소 밖) 두 번 누르기가 아니다(둘째 누르기는 시작점에 내린 수직 발 — 같은 자리라 그대로)
    dbl(r, 120, 101, { dx: 7 });
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(1);
    expect(r.key('Escape')).toBe(true);
    // 둘째 누르기가 빈 곳(모서리에서 13화소, 축 방향도 아님)이면 찍지 않는다
    dbl(r, 130, 109, { dx: 4, dy: 4 });
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(1);
  });

  it('손가락: 두 번 탭(24화소 안)도 같고, 둘째 탭이 그 모서리의 끝점에 붙어도 첫 탭의 모서리 위 안내선', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    later();
    r.click(170, 101, { pointerType: 'touch' });
    expect(r.tool.pointCount).toBe(1);
    // 15화소 떨어진 둘째 탭: 손가락 반경에 끝점 (100, 0)이 든다
    r.click(184, 106, { pointerType: 'touch' });
    expect(r.q('.measure-snap-endpoint')).not.toBeNull();
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(Math.abs(r.tool.guideLines[0]!.dir[0])).toBeCloseTo(1, 12);
    expect(r.tool.selectedGuide).toBe('line');
    expect(r.results).toHaveLength(0);
  });

  it('곡선(호 조각)은 누른 조각 하나의 직선', () => {
    const arc = [0, 30, 60, 90].map((d) => [80 * Math.cos((d * Math.PI) / 180), 80 * Math.sin((d * Math.PI) / 180), 0]);
    const r = rig({ units: 'mm', meshes: [], lines: [lines('arc', [[...arc[0]!, ...arc[1]!], [...arc[1]!, ...arc[2]!], [...arc[2]!, ...arc[3]!]])] });
    r.tool.setMode('tape');
    // 첫 조각의 가운데(중간점)
    const m = [(arc[0]![0]! + arc[1]![0]!) / 2, (arc[0]![1]! + arc[1]![1]!) / 2];
    dbl(r, 100 + m[0]!, 100 - m[1]!);
    expect(r.tool.guideLines).toHaveLength(1);
    const gl = r.tool.guideLines[0]!;
    const u = [arc[1]![0]! - arc[0]![0]!, arc[1]![1]! - arc[0]![1]!, 0];
    const l = Math.hypot(...u);
    expect(Math.abs((gl.dir[0] * u[0]! + gl.dir[1] * u[1]!) / l)).toBeCloseTo(1, 6);
    // 지나는 점은 그 조각 직선 위(끝없는 안내선)
    const w = [gl.point[0] - arc[0]![0]!, gl.point[1] - arc[0]![1]!];
    expect(Math.abs(w[0]! * u[1]! - w[1]! * u[0]!) / l).toBeLessThan(1e-4);
  });

  it(`모서리 두 번 누르기도 안내선 ${MAX_GUIDE_LINES}개 한도를 지킨다(오래된 것부터 버리고 새것을 고른다)`, () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    r.click(101, 101);
    r.click(197, 102);
    r.move(101, 52);
    for (let i = 1; i <= MAX_GUIDE_LINES; i++) expect(r.tool.applyAngle(i)).toBe('ok');
    expect(r.tool.guideLines).toHaveLength(MAX_GUIDE_LINES);
    const oldest = r.tool.guideLines[0]!;
    r.tool.setMode('tape');
    // Y 모서리의 38 자리(끝점 50·중간점 25는 반경 밖)
    dbl(r, 101, 62, { dx: 0, dy: 1 });
    expect(r.tool.guideLines).toHaveLength(MAX_GUIDE_LINES);
    expect(r.tool.guideLines).not.toContain(oldest);
    expect(Math.abs(r.tool.guideLines.at(-1)!.dir[1])).toBeCloseTo(1, 12);
    expect(r.tool.selectedGuide).toBe('line');
  });

  it('각도기는 두 번 누르기로 안내선을 두지 않는다', () => {
    const r = rig(EDGES());
    r.tool.setMode('protractor');
    dbl(r, 170, 101);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.pointCount).toBe(1);
  });
});

/** 안내 보이기를 기억하는 가짜 저장소(시험끼리 섞이지 않게) */
const memStore = (): Pick<Storage, 'getItem' | 'setItem'> & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('측정 도구: 안내 되돌리기·다시 하기(Ctrl·⌘+Z)', () => {
  // 두 번 누르기는 시간에 기대므로 시계를 손으로 옮긴다(앞 describe와 같게)
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  /** 3D 보기(또는 target)에서 keydown 하나 → undoKey가 받았는지와 기본 동작을 막았는지 */
  const press = (r: Rig, init: KeyboardEventInit, target: EventTarget = r.canvas): { handled: boolean; prevented: boolean } => {
    const e = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
    let handled = false;
    target.addEventListener('keydown', (ev) => void (handled = r.tool.undoKey(ev as KeyboardEvent)), { once: true });
    target.dispatchEvent(e);
    return { handled, prevented: e.defaultPrevented };
  };

  it('되돌리기·다시 하기 키(한글 자판은 물리 키)와 측정값 칸 알림 글', () => {
    const k = (key: string, o: { code?: string; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}): ReturnType<typeof guideUndoKey> =>
      guideUndoKey({ key, code: o.code ?? '', ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift });
    expect(k('z', { ctrl: true })).toBe('undo');
    expect(k('z', { meta: true })).toBe('undo');
    expect(k('Z', { ctrl: true, shift: true })).toBe('redo');
    expect(k('z', { meta: true, shift: true })).toBe('redo');
    expect(k('y', { ctrl: true })).toBe('redo');
    // ⌘Y는 Mac 브라우저 몫, Alt·Option과 함께·수정 키 없이·다른 글자는 아니다
    expect(k('y', { meta: true })).toBeNull();
    expect(k('Y', { ctrl: true, shift: true })).toBeNull();
    expect(k('z', { ctrl: true, alt: true })).toBeNull();
    expect(k('z')).toBeNull();
    expect(k('x', { ctrl: true })).toBeNull();
    expect(k('ㅋ', { ctrl: true, code: 'KeyZ' })).toBe('undo');
    expect(k('ㅋ', { meta: true, shift: true, code: 'KeyZ' })).toBe('redo');
    expect(k('ㅛ', { ctrl: true, code: 'KeyY' })).toBe('redo');
    // 측정값 칸 알림(넣기는 측정 도구 조각에서)
    expect(applyMessage('ok', false)).toBeNull();
    expect(applyMessage('mode', true)).toBeNull();
    expect(applyMessage('zero', true)).toBe('0이 아닌 각도를 치세요');
    expect(applyMessage('zero', false)).toBe('0이 아닌 길이를 치세요');
    expect(applyMessage('start', false)).toBe('먼저 시작점을 누르세요');
    expect(applyMessage('direction', true)).toBe('커서를 돌릴 쪽으로 옮긴 뒤 치세요');
  });

  it('칸으로·안내 두기로 둔 안내, 하나 지우기, 모두 지우기를 하나씩 되돌리고 다시 한다 — 측정 결과·진행 중 점은 그대로', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    expect(r.tool.canUndo).toBe(false);
    expect(r.tool.undo()).toBe(false);
    // 1) 칸으로 안내점 (30, 0)
    r.click(102, 103);
    r.move(160, 101);
    expect(r.tool.applyValue(30, false)).toBeNull();
    const p1 = r.tool.guides[0]!;
    expect(r.tool.canUndo).toBe(true);
    // 2) 안내 두기로 끝점 (0, 50)에 안내점
    r.tool.setGuideMode(true);
    clock += 1000;
    r.click(102, 103);
    clock += 1000;
    r.click(101, 51);
    expect(r.tool.guides).toHaveLength(2);
    const p2 = r.tool.guides[1]!;
    // 3) 안내점 (30, 0)을 눌러 골라 하나 지우기(그 누르기의 시작점도 거둔다)
    clock += 1000;
    r.click(130, 101);
    expect(r.tool.selectedGuide).toBe('point');
    expect(r.tool.deleteSelectedGuide()).toBe(true);
    expect(r.tool.guides).toEqual([p2]);
    // 4) 모두 지우기
    r.tool.clearGuides();
    expect(r.tool.guides).toHaveLength(0);
    const result = r.tool.result;
    const calls = r.guideCalls();
    // 되돌리기: 모두 지우기 → 하나 지우기 → 안내 두기 → 칸
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toEqual([p2]);
    expect(r.guideCalls()).toBe(calls + 1);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toEqual([p1, p2]);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(2);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toEqual([p1]);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.canUndo).toBe(false);
    expect(r.tool.undo()).toBe(false);
    expect(r.tool.result).toBe(result);
    // 다시 하기
    expect(r.tool.canRedo).toBe(true);
    expect(r.tool.redo()).toBe(true);
    expect(r.tool.redo()).toBe(true);
    expect(r.tool.guides).toEqual([p1, p2]);
    // 진행 중 측정은 되돌리기와 상관없다
    clock += 1000;
    r.click(198, 101);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.guides).toEqual([p1]);
    // 새로 바꾸면 다시 하기 목록은 비운다
    r.tool.clearGuides();
    expect(r.tool.canRedo).toBe(false);
    expect(r.tool.redo()).toBe(false);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toEqual([p1]);
  });

  it('모서리 두 번 누르기 안내선·각도기 칸 안내선도 되돌리고, 되돌린 안내가 고른 것이면 푼다', () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    clock += 1000;
    r.click(170, 101);
    r.click(171, 102);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.selectedGuide).toBe('line');
    r.tool.setMode('protractor');
    for (const [x, y] of [[101, 101], [197, 102], [101, 51]] as const) {
      clock += 1000;
      r.click(x, y);
    }
    expect(r.tool.result?.kind).toBe('protractor');
    expect(r.tool.applyValue(45, true)).toBeNull();
    expect(r.tool.guideLines).toHaveLength(2);
    expect(r.tool.selectedGuide).toBe('line');
    const angleResult = r.tool.result;
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guideLines).toHaveLength(1);
    // 고른 안내선(방금 둔 것)이 없어졌으니 고른 것이 없다 — 휴지통 단추가 사라진다
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.result).toBe(angleResult);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.redo()).toBe(true);
    expect(Math.abs(r.tool.guideLines[0]!.dir[0])).toBeCloseTo(1, 12);
  });

  it('키: 3D 보기에서는 Ctrl·⌘+Z가 되돌리고 Ctrl+Y·Shift+Z가 다시 한다(도구를 끈 동안에도), 입력 칸·되돌릴 것이 없으면 받지 않는다', () => {
    const r = rig(EDGES());
    expect(press(r, { key: 'z', ctrlKey: true })).toEqual({ handled: false, prevented: false });
    r.tool.setMode('tape');
    r.click(102, 103);
    clock += 1000;
    r.click(198, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    // 측정값 칸·찾기 칸 같은 입력 칸은 브라우저 몫(글 되돌리기)
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(r, { key: 'z', ctrlKey: true }, input)).toEqual({ handled: false, prevented: false });
    expect(r.tool.guides).toHaveLength(1);
    // Ctrl을 누른 채 Z: 되돌리고, 뒤따르는 Ctrl 떼기는 안내 두기 전환이 아니다
    expect(r.key('Control')).toBe(false);
    expect(press(r, { key: 'z', ctrlKey: true })).toEqual({ handled: true, prevented: true });
    expect(r.tool.guides).toHaveLength(0);
    expect(r.key('Control', 'keyup')).toBe(false);
    expect(r.tool.guideMode).toBe(false);
    // 도구를 끈 동안에도(안내는 늘 보인다)
    r.tool.setMode(null);
    expect(press(r, { key: 'Z', metaKey: true, shiftKey: true })).toEqual({ handled: true, prevented: true });
    expect(r.tool.guides).toHaveLength(1);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(1);
    expect(press(r, { key: 'z', metaKey: true }).handled).toBe(true);
    expect(r.tool.guides).toHaveLength(0);
    r.overlay.paintNow();
    expect(r.q('g.measure')).toBeNull();
    expect(press(r, { key: 'y', ctrlKey: true }).handled).toBe(true);
    expect(r.tool.guides).toHaveLength(1);
    // 다시 할 것이 없으면 받지 않는다(브라우저 몫)
    expect(press(r, { key: 'y', ctrlKey: true })).toEqual({ handled: false, prevented: false });
    // keyup은 받지 않는다
    expect(r.tool.undoKey(new KeyboardEvent('keyup', { key: 'z', ctrlKey: true }))).toBe(false);
    expect(r.tool.guides).toHaveLength(1);
  });

  it(`${MAX_GUIDE_UNDO}단계까지 기억하고(오래된 것부터 버림), 새 문서(clearGuides(true))면 목록을 비운다`, () => {
    const r = rig(EDGES());
    r.tool.setMode('tape');
    r.click(102, 103);
    clock += 1000;
    r.click(198, 101);
    for (let i = 1; i <= MAX_GUIDE_UNDO + 5; i++) expect(r.tool.applyLength(i)).toBe('ok');
    expect(r.tool.guides).toHaveLength(MAX_GUIDE_POINTS);
    let n = 0;
    while (r.tool.undo()) n++;
    expect(n).toBe(MAX_GUIDE_UNDO);
    // 가장 오래된 다섯 단계는 버렸다: 그 다섯 안내점(1~5)이 남는다
    expect(r.tool.guides.map((g) => Math.round(g[0]))).toEqual([1, 2, 3, 4, 5]);
    while (r.tool.redo()) n--;
    expect(n).toBe(0);
    expect(r.tool.guides).toHaveLength(MAX_GUIDE_POINTS);
    expect(Math.round(r.tool.guides.at(-1)![0])).toBe(MAX_GUIDE_UNDO + 5);
    // 새 문서: 안내와 함께 목록도(되돌려 다른 모형에 옛 안내가 나오지 않게)
    r.tool.undo();
    const calls = r.guideCalls();
    r.tool.clearGuides(true);
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.canUndo).toBe(false);
    expect(r.tool.canRedo).toBe(false);
    expect(r.guideCalls()).toBe(calls + 1);
    // 안내가 없어도 목록이 있었으면 알린다(되돌리기 단추를 숨기게)
    expect(r.tool.applyLength(3)).toBe('ok');
    r.tool.undo();
    expect(r.tool.guides).toHaveLength(0);
    const calls2 = r.guideCalls();
    r.tool.clearGuides(true);
    expect(r.tool.canRedo).toBe(false);
    expect(r.guideCalls()).toBe(calls2 + 1);
    r.tool.clearGuides(true);
    expect(r.guideCalls()).toBe(calls2 + 1);
  });

  it('측정 띠의 되돌리기 단추: 고른 안내 지우기 단추 앞에 붙고, 되돌릴 것이 있을 때만 보이며 누르면 하나 되돌린다', () => {
    const r = rig(EDGES());
    const host = document.createElement('form');
    const del = document.createElement('button');
    del.className = 'vcb-del';
    host.append(document.createElement('input'), del);
    document.body.append(host);
    r.tool.mountUndo(host);
    const b = host.querySelector<HTMLButtonElement>('.vcb-undo')!;
    // 바로 뒤는 다시 하기 단추(15차), 그 뒤가 지우기 단추
    expect(b.nextElementSibling?.nextElementSibling).toBe(del);
    expect(b.type).toBe('button');
    expect(b.hidden).toBe(true);
    expect(b.getAttribute('aria-label')).toBe(GUIDE_UNDO_LABEL);
    expect(b.title).toBe(GUIDE_UNDO_LABEL);
    expect(b.querySelectorAll('svg path')).toHaveLength(2);
    r.tool.setMode('tape');
    r.click(102, 103);
    clock += 1000;
    r.click(198, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    expect(b.hidden).toBe(false);
    b.click();
    expect(r.tool.guides).toHaveLength(0);
    expect(b.hidden).toBe(true);
    // 다시 붙여도 하나
    r.tool.mountUndo(host);
    expect(host.querySelectorAll('.vcb-undo')).toHaveLength(1);
    r.tool.dispose();
    expect(host.querySelector('.vcb-undo')).toBeNull();
  });
});

describe('측정 도구: 안내를 늘 보이기(보기 설정 "안내점·안내선 보이기")', () => {
  it('도구를 끈 뒤에도 안내점·안내선을 그린다(결과·표식·고른 것은 지운다) — 카메라를 옮기면 따라가고 누르기는 받지 않는다', () => {
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: memStore() });
    r.tool.setMode('tape');
    // 모서리 위 (70, 0)에서 시작해 칸으로 나란한 안내선(y = 20), 끝점 (0, 0)에서 칸으로 안내점 (30, 0)
    r.click(170, 101);
    r.move(170, 60);
    expect(r.tool.applyLength(20)).toBe('ok');
    r.click(102, 103);
    r.move(160, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    r.move(150, 150);
    r.tool.setMode(null);
    expect(r.q('g.measure')).not.toBeNull();
    expect(r.qa('.measure-guide')).toHaveLength(1);
    expect(r.qa('.measure-guide-line')).toHaveLength(1);
    expect(r.q('.measure-label-length')).toBeNull();
    expect(r.q('.is-selected')).toBeNull();
    expect(r.q('.measure-tip')).toBeNull();
    expect(r.q('[class*="measure-snap"]')).toBeNull();
    const d = r.q('.measure-guide path')!.getAttribute('d');
    r.setCamera({ ...TOP, target: [20, 0, 0] });
    r.overlay.paintNow();
    expect(r.q('.measure-guide path')!.getAttribute('d')).not.toBe(d);
    // 끈 동안 누르기는 고르지도 찍지도 않는다
    r.click(110, 101);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.pointCount).toBe(0);
    // 다시 켜면 그대로 붙는다
    r.setCamera(TOP);
    r.tool.setMode('tape');
    r.move(131, 102);
    expect(r.tip()).toBe('안내점');
    // 도구를 버리면 안내 그림도 뗀다
    r.tool.setMode(null);
    r.tool.dispose();
    expect(r.q('g.measure')).toBeNull();
  });

  it('안내 보이기를 끄면 그리지도 붙지도 고르지도 않고 이 브라우저에 기억한다 — 안내를 두거나 되돌리면 다시 켠다', () => {
    const store = memStore();
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store });
    expect(r.tool.guidesShown).toBe(true);
    const item = r.tool.showGuidesItem();
    expect(item).toMatchObject({ label: GUIDES_SHOWN_LABEL, checked: true, toggle: true });
    r.tool.setMode('tape');
    r.click(102, 103);
    r.move(160, 101);
    expect(r.tool.applyLength(30)).toBe('ok');
    expect(r.tool.selectedGuide).toBe('point');
    const calls = r.guideCalls();
    item.run();
    expect(r.tool.guidesShown).toBe(false);
    expect(store.m.get(GUIDES_SHOWN_KEY)).toBe('0');
    expect(r.guideCalls()).toBeGreaterThan(calls);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.showGuidesItem().checked).toBe(false);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(0);
    // 숨긴 안내점에는 붙지 않고(그 밑 모서리에), 눌러도 고르지 않는다
    r.move(131, 102);
    expect(r.tip()).toBe('모서리에');
    r.click(131, 102);
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.edgeStart).toBe(true);
    // 끄면 도구를 꺼도 그리지 않는다
    r.tool.setMode(null);
    expect(r.q('g.measure')).toBeNull();
    // 기억: 이 저장소를 쓰는 새 도구도 숨김
    expect(rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store }).tool.guidesShown).toBe(false);
    // 안내를 두면 다시 켠다(둔 안내가 보이게)
    r.tool.setMode('tape');
    r.click(131, 102);
    r.move(131, 60);
    expect(r.tool.applyLength(10)).toBe('ok');
    expect(r.tool.guidesShown).toBe(true);
    expect(store.m.get(GUIDES_SHOWN_KEY)).toBe('1');
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(1);
    expect(r.qa('.measure-guide-line')).toHaveLength(1);
    // 숨긴 채 되돌려도 다시 켠다(무엇이 바뀌었는지 보이게)
    r.tool.setGuidesShown(false);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guidesShown).toBe(true);
    expect(r.tool.guideLines).toHaveLength(0);
    // 저장소를 못 쓰면(비공개 창 등) 보이기로 시작하고 이번만 바꾼다
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    const b = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: broken });
    expect(b.tool.guidesShown).toBe(true);
    b.tool.setGuidesShown(false);
    expect(b.tool.guidesShown).toBe(false);
  });
});

/** 안내 둘(15차 시험): 모서리 위 (70, 0)에서 시작해 칸으로 나란한 안내선(y = 20), 끝점 (0, 0)에서 칸으로 안내점 (30, 0). tick은 앞 누르기와 두 번 누르기가 되지 않게 시계를 옮긴다 */
const placeTwo = (r: Rig, tick: () => void): void => {
  r.tool.setMode('tape');
  tick();
  r.click(170, 101);
  r.move(170, 60);
  expect(r.tool.applyLength(20)).toBe('ok');
  tick();
  r.click(102, 103);
  r.move(160, 101);
  expect(r.tool.applyLength(30)).toBe('ok');
};

describe('측정 도구: 휴대폰 측정 띠의 다시 하기 단추', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const later = (): void => void (clock += 1000);

  it('측정 띠의 다시 하기 단추: 되돌리기 단추 바로 뒤(지우기 단추 앞), 다시 할 것이 있을 때만 보이고 누르면 하나 다시 한다', () => {
    const r = rig(EDGES());
    const host = document.createElement('form');
    const del = document.createElement('button');
    del.className = 'vcb-del';
    host.append(document.createElement('input'), del);
    document.body.append(host);
    r.tool.mountUndo(host);
    const undo = host.querySelector<HTMLButtonElement>('.vcb-undo')!;
    const redo = host.querySelector<HTMLButtonElement>('.vcb-redo')!;
    expect(undo.nextElementSibling).toBe(redo);
    expect(redo.nextElementSibling).toBe(del);
    expect(redo.type).toBe('button');
    expect(redo.getAttribute('aria-label')).toBe(GUIDE_REDO_LABEL);
    expect(redo.title).toBe(GUIDE_REDO_LABEL);
    expect(redo.querySelectorAll('svg path')).toHaveLength(2);
    expect(redo.hidden).toBe(true);
    placeTwo(r, later);
    expect(redo.hidden).toBe(true);
    undo.click();
    expect(r.tool.guides).toHaveLength(0);
    expect(redo.hidden).toBe(false);
    undo.click();
    expect(r.tool.guideLines).toHaveLength(0);
    expect(undo.hidden).toBe(true);
    redo.click();
    expect(r.tool.guideLines).toHaveLength(1);
    expect(undo.hidden).toBe(false);
    expect(redo.hidden).toBe(false);
    redo.click();
    expect(r.tool.guides).toHaveLength(1);
    expect(redo.hidden).toBe(true);
    // 새 안내를 두면 다시 할 것이 없어진다
    undo.click();
    expect(redo.hidden).toBe(false);
    clock += 1000;
    r.click(102, 103);
    r.move(102, 60);
    expect(r.tool.applyLength(10)).toBe('ok');
    expect(redo.hidden).toBe(true);
    // 다시 붙여도 하나씩, 버리면 뗀다
    r.tool.mountUndo(host);
    expect(host.querySelectorAll('.vcb-redo')).toHaveLength(1);
    r.tool.dispose();
    expect(host.querySelector('.vcb-redo')).toBeNull();
  });
});

describe('측정 도구: 둔 안내를 파일별로 기억(파일 내용 지문)', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const later = (): void => void (clock += 1000);
  const flush = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
  const print = (b: number): ArrayBuffer => new Uint8Array(32).fill(b).buffer;
  const KEY_A = 'ab'.repeat(32);
  const KEY_B = '01'.repeat(32);

  it('안내가 바뀔 때마다 파일 지문으로 기억하고, 같은 파일을 다시 열면(새로 고침 포함) 되살린다 — 되돌리기 목록은 비운 채', async () => {
    const store = memStore();
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store });
    r.tool.openFile(print(0xab));
    await flush();
    placeTwo(r, later);
    const pts = r.tool.guides.map((p) => [...p]);
    const lns = r.tool.guideLines.map((l) => ({ point: [...l.point], dir: [...l.dir] }));
    const saved = readGuideFiles(store);
    expect(Object.keys(saved)).toEqual([KEY_A]);
    expect(saved[KEY_A]!.p).toEqual(pts);
    expect(saved[KEY_A]!.l).toEqual([[...lns[0]!.point, ...lns[0]!.dir]]);
    // 저장 글에는 지문과 수만 있다(파일 이름·경로 없음)
    expect(store.m.get(GUIDE_STORE_KEY)).toMatch(/^\{"v":1,"files":\{"[0-9a-f]{64}":\{"t":[0-9]+,"p":\[[-0-9.,e[\]]*\],"l":\[[-0-9.,e[\]]*\]\}\}\}$/);
    // 다른 파일: 비우고, 기억이 없으니 빈 채
    r.tool.openFile(Promise.resolve(print(0x01)));
    expect(r.tool.guides).toHaveLength(0);
    await flush();
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.canUndo).toBe(false);
    expect(Object.keys(readGuideFiles(store))).toEqual([KEY_A]);
    // 같은 파일로 돌아오면 되살린다(되돌리기 목록 없이)
    r.tool.openFile(print(0xab));
    await flush();
    expect(r.tool.guides.map((p) => [...p])).toEqual(pts);
    expect(r.tool.guideLines.map((l) => ({ point: [...l.point], dir: [...l.dir] }))).toEqual(lns);
    expect(r.tool.canUndo).toBe(false);
    expect(r.tool.canRedo).toBe(false);
    // 새로 고친 것처럼 새 도구(같은 저장소): 도구를 끈 채로 그리고, 켜면 붙는다
    const r2 = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store });
    r2.tool.openFile(print(0xab));
    await flush();
    expect(r2.tool.guides.map((p) => [...p])).toEqual(pts);
    r2.overlay.paintNow();
    expect(r2.qa('.measure-guide')).toHaveLength(1);
    expect(r2.qa('.measure-guide-line')).toHaveLength(1);
    r2.tool.setMode('tape');
    r2.move(131, 102);
    expect(r2.tip()).toBe('안내점');
    // 되돌리기도 기억에 들어간다
    r.tool.setMode('tape');
    clock += 1000;
    r.click(102, 103);
    r.move(102, 60);
    expect(r.tool.applyLength(10)).toBe('ok');
    expect(readGuideFiles(store)[KEY_A]!.p).toHaveLength(2);
    r.tool.undo();
    expect(readGuideFiles(store)[KEY_A]!.p).toHaveLength(1);
    // 바뀌지 않으면 다시 쓰지 않는다(안내 두기 켜고 끄기 등)
    const text = store.m.get(GUIDE_STORE_KEY);
    r.tool.setGuideMode(true);
    r.tool.setGuideMode(false);
    expect(store.m.get(GUIDE_STORE_KEY)).toBe(text);
  });

  it('보기 설정 "이 파일의 안내 모두 지우기": 안내가 없으면 끔, 지우면 그 파일의 기억도 지우고 되돌리면 다시 기억한다(도구를 끈 동안에도)', async () => {
    const store = memStore();
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store });
    r.tool.openFile(print(0xab));
    await flush();
    let items = r.tool.guideMenuItems();
    expect(items.map((i) => i.label)).toEqual([GUIDES_SHOWN_LABEL, GUIDE_CLEAR_FILE_LABEL]);
    expect(items[0]).toMatchObject({ checked: true, toggle: true });
    expect(items[1]!.disabled).toBe(true);
    placeTwo(r, later);
    r.tool.setMode(null);
    items = r.tool.guideMenuItems();
    expect(items[1]!.disabled).toBe(false);
    items[1]!.run();
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(readGuideFiles(store)).toEqual({});
    expect(r.tool.guideMenuItems()[1]!.disabled).toBe(true);
    // 되돌리면 다시 기억한다
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toHaveLength(1);
    expect(readGuideFiles(store)[KEY_A]!.l).toHaveLength(1);
  });

  it('늦게 온 앞 문서의 지문은 버리고, 지문이 없으면 기억하지 않으며, 지문 전에 둔 안내는 그것을 기억한다', async () => {
    const store = memStore();
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store });
    let lateA: (b: ArrayBuffer) => void = () => undefined;
    r.tool.openFile(new Promise<ArrayBuffer>((res) => (lateA = res)));
    r.tool.openFile(print(0x01));
    await flush();
    placeTwo(r, later);
    lateA(print(0xab));
    await flush();
    expect(Object.keys(readGuideFiles(store))).toEqual([KEY_B]);
    expect(r.tool.guides).toHaveLength(1);
    // 지문을 못 구했으면(null·거부) 기억하지 않는다
    r.tool.openFile(null);
    placeTwo(r, later);
    r.tool.openFile(Promise.reject(new Error('no subtle')));
    await flush();
    placeTwo(r, later);
    expect(Object.keys(readGuideFiles(store))).toEqual([KEY_B]);
    // 지문 전에 둔 안내: 기억한 것(B의 둘) 대신 그것을 기억한다
    let lateB: (b: ArrayBuffer) => void = () => undefined;
    r.tool.openFile(new Promise<ArrayBuffer>((res) => (lateB = res)));
    r.tool.setMode('tape');
    clock += 1000;
    r.click(102, 103);
    r.move(102, 60);
    expect(r.tool.applyLength(10)).toBe('ok');
    lateB(print(0x01));
    await flush();
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(readGuideFiles(store)[KEY_B]).toMatchObject({ p: [[0, 10, 0]], l: [] });
  });

  it('저장소가 막혀도(사생활 보호 창) 안내 두기·되돌리기·다시 하기는 그대로 된다', async () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: blocked });
    r.tool.openFile(print(0xab));
    await flush();
    placeTwo(r, later);
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.redo()).toBe(true);
    r.tool.openFile(print(0xab));
    await flush();
    expect(r.tool.guides).toHaveLength(0);
  });
});

describe('측정 도구: 결과 글이 십자선·툴팁·측정 띠를 비켜 그리기(코어 placeMeasureLabel)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('labelSpot: 겹치지 않으면 null(가운데 그대로), 겹치면 코어 차례의 첫 빈자리, 옮길 곳이 없거나 크기를 모르면 null', () => {
    const view = { width: 400, height: 300 };
    expect(labelSpot(200, 100, 60, 18, view, { rects: [], circles: [] })).toBeNull();
    const bar = { x: 0, y: 260, width: 400, height: 40 };
    expect(labelSpot(200, 100, 60, 18, view, { rects: [bar] })).toBeNull();
    // 측정 띠가 가운데 자리를 덮으면: 네 귀·선분을 따라도 걸려 띠 바로 위(기본 가로 자리)
    const s = labelSpot(200, 270, 60, 18, view, { rects: [bar] }, [[100, 270], [300, 270]])!;
    expect(s).toEqual({ x: 210, y: 260 - 18 - 8 });
    // 정밀 조준 십자선(원): 기준점 오른쪽 위 귀가 비면 그 자리
    const aim = labelSpot(200, 150, 60, 18, view, { circles: [{ x: 195, y: 160, r: 24 }] })!;
    expect(aim.y + 18).toBeLessThanOrEqual(150);
    // 점 표식(soft)도 될 수 있으면 비킨다
    // 오른쪽 위가 걸리고 왼쪽 위가 점 표식(soft)을 가리면 오른쪽 아래
    expect(labelSpot(200, 150, 60, 18, view, { circles: [{ x: 230, y: 133, r: 12 }] }, null, [{ x: 160, y: 133, r: 6 }])).toEqual({ x: 210, y: 158 });
    expect(labelSpot(200, 150, 60, 18, view, { circles: [{ x: 230, y: 133, r: 12 }] })).toEqual({ x: 130, y: 124 });
    // 화면 전체를 덮으면 옮기지 않는다, 크기 0도
    expect(labelSpot(200, 150, 60, 18, view, { rects: [{ x: 0, y: 0, width: 400, height: 300 }] })).toBeNull();
    expect(labelSpot(200, 270, 0, 18, view, { rects: [bar] })).toBeNull();
  });

  it('줄자 결과 글이 앱이 알려 준 측정 띠와 겹치면 비켜 두고, 겹치지 않으면 가운데 그대로(그림이 예전과 같다)', () => {
    // jsdom은 배치를 하지 않아 결과 글 크기만 정해 준다
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 60 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 18 : 0;
    });
    const band = document.createElement('div');
    let top = 160;
    band.getBoundingClientRect = () => ({ left: 0, top, width: W, height: 40, right: W, bottom: top + 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const hidden = document.createElement('div');
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { labelAvoid: () => [band, hidden, null] });
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(198, 101);
    r.move(30, 20);
    const label = r.q('.measure-label-length') as HTMLElement;
    expect(label.style.transform).toBe('translate(-50%,-50%)');
    expect(label.classList.contains('is-moved')).toBe(false);
    expect([label.style.left, label.style.top]).toEqual(['150px', '100px']);
    // 띠가 결과 글 자리를 덮으면(휴대폰 가로 등) 띠 위로
    top = 95;
    r.move(31, 20);
    const moved = r.q('.measure-label-length') as HTMLElement;
    expect(moved.classList.contains('is-moved')).toBe(true);
    expect(moved.style.transform).toBe('none');
    expect(parseFloat(moved.style.top) + 18).toBeLessThanOrEqual(95);
  });

  it('보기 바깥 띠·떠 있는 것의 캔버스 기준 자리(22차): edgeBands는 보기 밖 네 띠, coverRects는 숨긴 것(크기 0)을 뺀다', () => {
    const bands = edgeBands(375, 693);
    expect(bands).toHaveLength(4);
    // 보기 안 글은 띠와 겹치지 않고, 가장자리를 넘은 글은 겹친다
    const view = { x: 0, y: 0, width: 375, height: 693 };
    for (const b of bands) expect(b.x + b.width <= view.x || b.y + b.height <= view.y || b.x >= view.width || b.y >= view.height).toBe(true);
    expect(labelSpot(370, 300, 60, 18, { width: 375, height: 693 }, { rects: bands })).toEqual({ x: 375 - 60 - 4, y: 300 - 18 - 8 });
    expect(labelSpot(180, 300, 60, 18, { width: 375, height: 693 }, { rects: bands })).toBeNull();
    expect(coverRects({ left: 0, top: 92 }, [{ left: 291, top: 100, width: 76, height: 76 }, { left: 8, top: 0, width: 0, height: 0 }, null])).toEqual([{ x: 291, y: 8, width: 76, height: 76 }]);
  });

  it('결과 글이 보기 밖으로 잘리면(기준점은 보기 안) 안으로, 기준점이 보기 밖이면 그대로 — 보이는 뷰 큐브도 비킨다(22차)', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 60 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 18 : 0;
    });
    const r = rig(EDGES(), TOP);
    r.tool.setMode('tape');
    r.click(102, 103);
    r.click(198, 101);
    r.move(30, 20);
    const label = (): HTMLElement => r.q('.measure-label-length') as HTMLElement;
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual(['150px', '100px', false]);
    // 결과 가운데(세계 x 50)가 화면 190 — 글(폭 60)이 오른쪽 끝을 넘어 잘리므로 보기 안 기본 귀(오른쪽 위를 안으로 당긴 자리)
    r.setCamera({ ...TOP, target: [-40, 0, 0] });
    r.overlay.paintNow();
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual([`${W - 60 - 4}px`, `${100 - 18 - 8}px`, true]);
    // 결과 가운데가 보기 밖이라도 글이 보기에 걸치면(화면 215 — 글 185~245) 안으로
    r.setCamera({ ...TOP, target: [-65, 0, 0] });
    r.overlay.paintNow();
    expect([label().style.left, label().classList.contains('is-moved')]).toEqual([`${W - 60 - 4}px`, true]);
    // 글이 모두 보기 밖(화면 350)이면 옮기지 않는다(선도 보기 밖 — 가장자리에 붙여 두지 않는다)
    r.setCamera({ ...TOP, target: [-200, 0, 0] });
    r.overlay.paintNow();
    expect([label().style.left, label().classList.contains('is-moved')]).toEqual(['350px', false]);
    // 뷰 큐브가 결과 글 자리를 덮으면 비킨다 — 자리는 코어가 알려 준다(0.23.0 viewCubeRect — 캔버스 기준, 감췄으면 null).
    // 코어 내부 요소(canvas.v3d-cube)는 더 찾지 않는다: 그 요소가 있어도 viewCubeRect가 null이면 비키지 않는다
    const cube = document.createElement('canvas');
    cube.className = 'v3d-cube';
    cube.getBoundingClientRect = () => ({ left: 120, top: 80, width: 60, height: 40, right: 180, bottom: 120, x: 120, y: 80, toJSON: () => ({}) }) as DOMRect;
    r.canvas.parentElement!.append(cube);
    r.setCamera(TOP);
    r.overlay.paintNow();
    expect(label().classList.contains('is-moved')).toBe(false);
    const fake = r.viewer as { viewCubeRect?: { x: number; y: number; width: number; height: number } | null };
    fake.viewCubeRect = null;
    r.move(31, 20);
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual(['150px', '100px', false]);
    fake.viewCubeRect = { x: 120, y: 80, width: 60, height: 40 };
    r.move(30, 20);
    const l = label();
    expect(l.classList.contains('is-moved')).toBe(true);
    const [x, y] = [parseFloat(l.style.left), parseFloat(l.style.top)];
    expect(x + 60 <= 120 || x >= 180 || y + 18 <= 80 || y >= 120).toBe(true);
    expect(x >= 0 && y >= 0 && x + 60 <= W && y + 18 <= W).toBe(true);
    fake.viewCubeRect = null;
    r.move(31, 20);
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual(['150px', '100px', false]);
  });
});

describe('측정 도구: 잠글 방향 고르기(한 손 잠금 — 22차, SketchUp for iPad 줄자의 Lock X·Y·Z·Lock Parallel 도구 모드처럼)', () => {
  const press = (el: Element | null, pointerType: string): void => {
    const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    el!.dispatchEvent(e);
  };

  it('방향을 잡는 동안만 열리고, 고르면 그 방향으로 잠근 뒤 닫힌다 — 마우스·키보드는 click, 손가락은 누르는 순간', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 10, 0, 0]]), lines('h', [[50, -50, 0, 80, -50, 0]])] });
    const band = document.createElement('div');
    document.body.append(band);
    r.tool.mountLockMenu(band);
    const menu = band.querySelector('.mb-lockmenu') as HTMLElement;
    expect(menu.hidden).toBe(true);
    expect(menu.getAttribute('role')).toBe('group');
    expect(menu.getAttribute('aria-label')).toBe(LOCK_MENU_LABEL);
    r.tool.setMode('tape');
    // 점을 찍기 전에는 고를 방향이 없다
    expect(r.tool.lockChoices).toEqual([]);
    expect(r.tool.toggleLockMenu(true)).toBe(false);
    expect(r.tool.lockTo('x')).toBe(false);
    const tap = (x: number, y: number): void => {
      r.ptr('pointerdown', x, y, { pointerType: 'touch', buttons: 1 });
      r.ptr('pointerup', x, y, { pointerType: 'touch' });
      r.overlay.paintNow();
    };
    // 마우스: 모서리 끝을 시작점으로 찍으면 그 모서리(↓와 같은 기준 — 앞서 지나간 모서리)와 나란히도 고를 수 있다
    r.click(101, 100);
    expect(r.tool.lockChoices).toEqual(['x', 'y', 'z', 'parallel']);
    r.move(165, 150);
    expect(r.tool.toggleLockMenu()).toBe(true);
    expect(r.tool.lockMenuOpen).toBe(true);
    expect([...menu.querySelectorAll('[data-lock]')].map((b) => b.textContent)).toEqual([LOCK_HINTS.x, LOCK_HINTS.y, LOCK_HINTS.z, LOCK_HINTS.parallel]);
    expect((menu.querySelector('[data-lock="y"] .mb-lockswatch') as HTMLElement).style.background).not.toBe('');
    // 같은 것을 다시 바꾸면 닫힌다
    expect(r.tool.toggleLockMenu()).toBe(false);
    expect(menu.hidden).toBe(true);
    r.tool.toggleLockMenu(true);
    // 마우스는 누르기(pointerdown)를 넘기고 click으로 고른다
    press(menu.querySelector('[data-lock="parallel"]'), 'mouse');
    expect(r.tool.inferenceLock).toBeNull();
    (menu.querySelector('[data-lock="parallel"]') as HTMLElement).click();
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'parallel', source: 'button' });
    expect(r.tool.lockMenuOpen).toBe(false);
    expect(r.locks.at(-1)).toBe('parallel');
    // 잠근 동안은 열지 않는다
    expect(r.tool.toggleLockMenu(true)).toBe(false);
    r.tool.setInferenceLock(false);
    r.tool.clear();
    // 손가락(한 손): 시작점을 탭하면 아직 본 방향이 없어 단추 잠금은 못 하지만, 고르기 줄에서 빨강 축을 고르면 잠근다
    tap(101, 100);
    expect(r.tool.setInferenceLock(true)).toBe(false);
    expect(r.tool.toggleLockMenu(true)).toBe(true);
    press(menu.querySelector('[data-lock="x"]'), 'touch');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'button' });
    expect(r.tool.lockMenuOpen).toBe(false);
    // 뒤따르는 click(같은 누르기)은 넘긴다 — 풀리거나 다시 잠그지 않는다
    (menu.querySelector('[data-lock="x"]') as HTMLElement | null)?.click();
    expect(r.tool.inferenceLock?.axis).toBe('x');
    // 같은 엄지로 다른 곳을 탭하면 잠근 선 위(시작점에서 빨강 축)
    tap(140, 60);
    const res = r.results.at(-1);
    if (res?.kind !== 'tape') throw new Error('tape');
    res.b.forEach((v, i) => expect(v).toBeCloseTo([40, 0, 0][i]!, 6));
    expect(r.tool.inferenceLock).toBeNull();
    // 열어 둔 채 점을 찍거나 다시 재기·도구를 끄면 닫힌다
    tap(101, 100);
    r.tool.toggleLockMenu(true);
    tap(165, 150);
    expect(r.results.at(-1)?.kind).toBe('tape');
    expect(r.tool.lockMenuOpen).toBe(false);
    tap(101, 100);
    r.tool.toggleLockMenu(true);
    r.tool.clear();
    expect(r.tool.lockMenuOpen).toBe(false);
    tap(101, 100);
    r.tool.toggleLockMenu(true);
    r.tool.setMode(null);
    expect(r.tool.lockMenuOpen).toBe(false);
    // 도구를 버리면 줄도 뗀다
    r.tool.dispose();
    expect(menu.isConnected).toBe(false);
  });
});

describe('측정 도구: 다른 점에서 끌어온 축(점 위에 머물기 — SketchUp "점에서")', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    // 둘레 고르기 시간 한도가 기계 부하로 갈리지 않게 시계를 멈춘다
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // 넓은 면 위: 끝점 P(40, 30, 0 — 화면 140, 70)에서 위로 60인 모서리, 시작점으로 쓸 끝점 A(0, −40, 0 — 화면 100, 140)에서 −X로 30인 모서리
  const P: V3 = [40, 30, 0];
  const A: V3 = [0, -40, 0];
  const SCENE = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
    units: 'mm',
    meshes: [quad('f', -95, -95, 95, 95, 0)],
    lines: [lines('e', [[40, 30, 0, 40, 90, 0], [0, -40, 0, -30, -40, 0]])],
  });
  const touch = { pointerType: 'touch' };

  it('작은 함수: 점 추정만 머물고(방향 추론·잠근 점은 아님), 끌어온 점 수 안내', () => {
    expect(dwellPoint({ kind: 'endpoint' })).toBe(true);
    expect(dwellPoint({ kind: 'perpendicular' })).toBe(true);
    expect(dwellPoint({ kind: 'perpendicular', inferred: true })).toBe(false);
    expect(dwellPoint({ kind: 'endpoint', locked: true })).toBe(false);
    for (const kind of ['onEdge', 'onFace', 'axis', 'parallel', 'free'] as const) expect(dwellPoint({ kind })).toBe(false);
    expect(dwellPoint(null)).toBe(false);
    expect(trackHint(0)).toBeNull();
    expect(trackHint(2)).toBe('끌어온 점 2개');
    expect(AIM_DWELL_PX).toBeLessThan(snapRadius('aim') / 2);
  });

  it('줄자: 끝점 위에 0.5초 머물면 끌어오고, 그 점의 축과 시작점 축 위 줄 맞춘 자리에 붙어 잰다(마치면 잊는다)', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.move(141.2, 70.6);
    expect(r.tip()).toBe('끝점');
    vi.advanceTimersByTime(TRACK_DWELL_MS - 1);
    expect(r.tool.trackPoints).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(r.tool.trackPoints).toEqual([P]);
    r.overlay.paintNow();
    expect(r.qa('.measure-track')).toHaveLength(1);
    // 상태 줄·측정 띠: 잠금(안내 두기 키) 안내 뒤에 끌어온 점 수(onLock으로 알린다)
    expect(r.tool.lockHintText(false)).toBe('Ctrl: 안내 두기 · 끌어온 점 1개');
    expect(r.tool.lockHintText(true)).toBe('끌어온 점 1개');
    const notes = r.locks.length;
    expect(notes).toBeGreaterThan(0);

    // 끌어온 점의 빨강 축: 축 색 점선과 큰 +
    r.move(170.4, 72.7);
    expect(r.tip()).toBe(TRACK_AXIS_LABELS.x);
    expect(r.q('line.measure-track-line')?.getAttribute('stroke')).toBe(AXIS_COLORS.x);
    expect(r.q('.measure-track.is-from')).not.toBeNull();
    expect(r.q('.measure-snap-axis')?.getAttribute('fill')).toBe(AXIS_COLORS.x);

    // 시작점(끝점 A)을 찍어도 끌어온 점은 남는다
    r.click(100.6, 140.4);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.trackPoints).toEqual([P]);
    // 시작점 빨강 축 위에서 P와 줄 맞춘 자리(40, −40): 고무줄은 빨강, P에서 내려오는 점선은 녹색
    r.move(140.6, 137.2);
    expect(r.tip()).toBe(`빨강 축에 · ${TRACK_ALIGN_LABEL} · 40 mm`);
    expect(r.q('line.measure-rubber')?.getAttribute('data-axis')).toBe('x');
    expect(r.q('line.measure-track-line')?.getAttribute('stroke')).toBe(AXIS_COLORS.y);
    // 끌어온 점의 녹색 축 위(시작점에서 축 방향이 아님): 고무줄은 보통 선, 점선은 녹색
    r.move(142.3, 92.6);
    expect(r.tip()?.startsWith(`${TRACK_AXIS_LABELS.y} · `)).toBe(true);
    const rubber = r.q('line.measure-rubber')!;
    expect(rubber.getAttribute('data-axis')).toBeNull();
    expect(rubber.getAttribute('stroke')).toBe('currentColor');
    expect(r.q('line.measure-track-line')?.getAttribute('stroke')).toBe(AXIS_COLORS.y);
    // 끌어온 점의 축은 시작점을 지나지 않아 Shift로 잠그지 않는다
    r.key('Shift');
    expect(r.tool.inferenceLock).toBeNull();
    r.key('Shift', 'keyup');

    r.click(140.6, 137.2);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: A, b: [40, -40, 0], distance: 40 });
    expect(r.tool.trackPoints).toEqual([]);
    expect(r.qa('.measure-track')).toHaveLength(0);
    expect(r.tool.lockHintText(false)).not.toContain('끌어온 점');
    // 안내가 아니다: 안내·되돌리기 목록이 그대로
    expect(r.tool.guides).toHaveLength(0);
    expect(r.tool.guideLines).toHaveLength(0);
    expect(r.tool.canUndo).toBe(false);
  });

  it('줄 맞춘 자리는 Shift로 그 축에 잠근다(시작점 축)', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    r.click(100.6, 140.4);
    r.move(140.6, 137.2);
    r.key('Shift');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'x', source: 'shift' });
    // 잠근 동안은 끌어온 축을 보지 않는다(잠근 선 위 점)
    r.move(142.3, 92.6, { shift: true });
    expect(r.tip()?.startsWith('빨강 축에 · 잠금')).toBe(true);
  });

  it('마우스는 2화소 안에서 머물러야 하고, 방금 누른 점·시작점·손가락 탭은 끌어오지 않는다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS - 100);
    // 같은 끝점이라도 2화소 넘게 움직이면 처음부터
    r.move(144.1, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS - 100);
    expect(r.tool.trackPoints).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(r.tool.trackPoints).toEqual([P]);
    r.key('Escape');
    expect(r.tool.trackPoints).toEqual([]);

    // 누른 점(시작점): 머물러도, 떠났다 돌아와도 기억하지 않는다
    r.click(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
    expect(r.tool.trackPoints).toEqual([]);
    r.move(170.4, 120.3);
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
    expect(r.tool.trackPoints).toEqual([]);
    // 줄자를 마친 끝점(방금 누른 점)도 커서가 떠날 때까지는 기억하지 않고, 떠났다 돌아오면 기억한다
    r.click(100.6, 140.4);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: P, b: A });
    vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
    expect(r.tool.trackPoints).toEqual([]);
    r.move(120.3, 120.7);
    r.move(100.6, 140.4);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toEqual([A]);
    r.tool.clear();
    expect(r.tool.trackPoints).toEqual([]);

    // 손가락 탭: 커서가 없어 머무르지 않는다
    r.click(141.2, 70.6, touch);
    r.click(170.4, 120.3, touch);
    vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
    expect(r.tool.trackPoints).toEqual([]);
    // 캔버스를 떠나면 머무르기를 버린다
    r.tool.clear();
    r.move(141.2, 70.6);
    r.ptr('pointerleave', 141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
    expect(r.tool.trackPoints).toEqual([]);
  });

  it('정밀 조준 십자선은 손가락이 조금 떨려도(AIM_DWELL_PX 안) 머문 것으로 보고 끌어온다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.ptr('pointerdown', 141, 70 + AIM_OFFSET_PX + 0.5, { ...touch, buttons: 1 });
    vi.advanceTimersByTime(AIM_HOLD_MS);
    expect(r.tool.aiming).toBe(true);
    r.overlay.paintNow();
    expect(r.tip()).toBe('끝점');
    for (const [dx, t] of [[3, 150], [-2, 150], [1.5, 150]] as const) {
      r.ptr('pointermove', 141 + dx, 70 + AIM_OFFSET_PX + 1, { ...touch, buttons: 1 });
      r.overlay.paintNow();
      vi.advanceTimersByTime(t);
    }
    expect(r.tool.trackPoints).toEqual([]);
    vi.advanceTimersByTime(TRACK_DWELL_MS - 450);
    expect(r.tool.trackPoints).toEqual([P]);
    // 십자선을 끌어온 빨강 축으로 옮겨 떼면 그 자리를 시작점으로
    r.ptr('pointermove', 170.4, 72.7 + AIM_OFFSET_PX, { ...touch, buttons: 1 });
    r.overlay.paintNow();
    expect(r.tip()).toBe(TRACK_AXIS_LABELS.x);
    r.ptr('pointerup', 170.4, 72.7 + AIM_OFFSET_PX, touch);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.trackPoints).toEqual([P]);
    // 탭으로도 끌어온 축에 붙는다(손가락 추정 반경)
    r.click(140.5, 150.3, touch);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape' });
    const b = (r.results.at(-1) as { b: V3 }).b;
    expect(b[0]).toBeCloseTo(40, 9);
    expect(b[1]).toBeCloseTo(-50.3, 1);
  });

  it('각도기: 잴 방향을 끌어온 점의 축 위로 잡는다', () => {
    const r = rig(SCENE());
    r.tool.setMode('protractor');
    r.click(100.6, 140.4);
    r.click(70.4, 140.3);
    expect(r.tool.pointCount).toBe(2);
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toEqual([P]);
    r.move(142.3, 92.6);
    expect(r.tip()?.startsWith(`${TRACK_AXIS_LABELS.y} · `)).toBe(true);
    r.click(142.3, 92.6);
    const res = r.results.at(-1) as MeasureToolResult & { angle: number; b: V3 };
    expect(res.kind).toBe('protractor');
    expect(res.b[0]).toBeCloseTo(40, 9);
    expect(res.angle).toBeCloseTo(180 - (Math.atan2(res.b[1] + 40, 40) * 180) / Math.PI, 9);
    expect(r.tool.trackPoints).toEqual([]);
  });

  it('도구를 바꾸거나 끄면 잊고, 끄면(setTrack(false)) 머물러도 상태가 없어 추정·그림이 끌어오기 전과 같다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toHaveLength(1);
    r.tool.setMode('protractor');
    expect(r.tool.trackPoints).toEqual([]);
    r.move(141.2, 70.6);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toHaveLength(1);
    r.tool.setTrack(false);
    expect(r.tool.track).toBe(false);
    expect(r.tool.trackPoints).toEqual([]);

    // 같은 움직임: 끈 채 머문 것 · 끈 채 머물지 않은 것 · 켠 채 머물지 않은 것의 추정·결과·그림이 모두 같다
    const run = (o: Partial<MeasureToolOptions>, wait: boolean): string[] => {
      const q = rig(SCENE(), TOP, DEFAULT_UNITS, o);
      q.tool.setMode('tape');
      const out: string[] = [];
      const shot = (): void => void out.push(`${q.tip()}|${q.q('g.measure')?.innerHTML}|${JSON.stringify(q.results.at(-1) ?? null)}|${q.tool.lockHintText(false)}`);
      for (const [x, y, click] of [[141.2, 70.6, false], [170.4, 72.7, false], [100.6, 140.4, true], [141.2, 70.6, false], [140.6, 137.2, false], [142.3, 92.6, false], [140.6, 137.2, true]] as const) {
        if (click) q.click(x, y);
        else q.move(x, y);
        if (wait) vi.advanceTimersByTime(TRACK_DWELL_MS * 2);
        q.overlay.paintNow();
        shot();
      }
      return out;
    };
    const offWait = run({ track: false }, true);
    expect(run({ track: false }, false)).toEqual(offWait);
    expect(run({}, false)).toEqual(offWait);
    // 켠 채 머물면 달라진다(시험이 끌어온 축을 실제로 거친다)
    expect(run({}, true)).not.toEqual(offWait);
  });
});

describe('측정 도구: 끌어온 축끼리의 교차·끌어온 축과 모서리의 교차(코어 0.17.0)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // 넓은 면 위: 끝점 P(40, 30 — 화면 140, 70)에서 위로 60인 모서리, 끝점 A(0, −40 — 화면 100, 140)에서 −X로 30인 모서리,
  // 가로 모서리 g(y = 60, x −60~20 — 화면 y = 40)
  const P: V3 = [40, 30, 0];
  const A: V3 = [0, -40, 0];
  const SCENE = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
    units: 'mm',
    meshes: [quad('f', -95, -95, 95, 95, 0)],
    lines: [lines('e', [[40, 30, 0, 40, 90, 0], [0, -40, 0, -30, -40, 0], [-60, 60, 0, 20, 60, 0]])],
  });
  const dwellOn = (r: Rig, x: number, y: number): void => {
    r.move(x, y);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
  };

  it('두 점을 끌어오면 그 축이 만나는 점: 두 점에서 축 색 점선, 교차점 표식(빨강 ×)과 글, 누르면 그 점에서 잰다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    dwellOn(r, 141.2, 70.6);
    dwellOn(r, 100.6, 140.4);
    expect(r.tool.trackPoints).toEqual([A, P]);
    // A의 녹색 축(x = 0)과 P의 빨강 축(y = 30)이 (0, 30) — 화면 (100, 70)에서 만난다
    r.move(101.3, 71.2);
    expect(r.tip()).toBe(TRACK_PAIR_LABELS.xy);
    const strokes = r.qa('line.measure-track-line').map((l) => l.getAttribute('stroke'));
    expect(strokes).toEqual([AXIS_COLORS.y, AXIS_COLORS.x]);
    expect(r.qa('.measure-track.is-from')).toHaveLength(2);
    const mark = r.q('[data-track="pair"]')!;
    expect(mark.getAttribute('data-kind')).toBe('axis');
    expect(mark.querySelector('path:last-child')?.getAttribute('stroke')).toBe(SNAP_COLORS.intersection);
    // 시작점을 그 점에 찍는다(끌어온 점은 남는다)
    r.click(101.3, 71.2);
    expect(r.tool.pointCount).toBe(1);
    expect(r.tool.trackPoints).toHaveLength(2);
    r.click(141.2, 70.6);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: [0, 30, 0], b: P, distance: 40 });
    expect(r.tool.trackPoints).toEqual([]);
  });

  it('끌어온 축이 모서리와 만나는 점: 모서리 위 표식(빨강 사각형)과 축 색 점선, 그 점에서 잰다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    // 끌어오기 전에는 모서리 위
    r.move(101.2, 41.3);
    expect(r.tip()).toBe(SNAP_LABELS.onEdge);
    dwellOn(r, 100.6, 140.4);
    expect(r.tool.trackPoints).toEqual([A]);
    // A의 녹색 축(x = 0)이 g와 (0, 60) — 화면 (100, 40)에서 만난다
    r.move(101.2, 41.3);
    expect(r.tip()).toBe(`${TRACK_AXIS_LABELS.y} · ${SNAP_LABELS.onEdge}`);
    expect(r.q('line.measure-track-line')?.getAttribute('stroke')).toBe(AXIS_COLORS.y);
    const mark = r.q('[data-track="edge"]')!;
    expect(mark.tagName.toLowerCase()).toBe('rect');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onEdge);
    r.click(101.2, 41.3);
    r.click(141.2, 70.6);
    expect(r.results.at(-1)).toMatchObject({ kind: 'tape', a: [0, 60, 0], b: P, distance: 50 });
  });

  it('다시 재기로 지울 것(clearable): 진행 중 점·결과·끌어온 점 — 끌어온 점만 남아도 켜진다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    expect(r.tool.clearable).toBe(false);
    const locks = r.locks.length;
    dwellOn(r, 141.2, 70.6);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.result).toBeNull();
    expect(r.tool.clearable).toBe(true);
    // 끌어온 점 수가 바뀌면 알린다(앱이 측정 띠 단추를 다시 맞춘다)
    expect(r.locks.length).toBeGreaterThan(locks);
    const n = r.locks.length;
    r.tool.clear();
    expect(r.tool.trackPoints).toEqual([]);
    expect(r.tool.clearable).toBe(false);
    expect(r.locks.length).toBeGreaterThan(n);
    // 진행 중 점·결과
    r.click(141.2, 70.6);
    expect(r.tool.clearable).toBe(true);
    r.click(100.6, 140.4);
    expect(r.tool.pointCount).toBe(0);
    expect(r.tool.clearable).toBe(true);
    r.tool.clear();
    expect(r.tool.clearable).toBe(false);
    // 끄면 끌어온 점이 없어 머물러도 켜지지 않는다
    r.tool.setTrack(false);
    dwellOn(r, 141.2, 70.6);
    expect(r.tool.clearable).toBe(false);
  });
});

describe('측정 도구: 시작점 축·끌어온 축이 모서리·면과 만나는 점(코어 0.18.0)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  it('줄자: 시작점 녹색 축이 비낀 모서리와 만나는 점 — 모서리 위 표식, 축 색 고무줄, Shift로 그 축에 잠그고 그 점에서 잰다(끄면 예전처럼 모서리 위)', () => {
    // 넓은 면 위: 끝점 A(0, −40 — 화면 100, 140)에서 −X로 30인 모서리, 비낀 모서리 s(y = x + 60, x −80~60 — A의 녹색 축과 (0, 60) — 화면 (100, 40)에서 만난다)
    const scene = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
      units: 'mm',
      meshes: [quad('f', -95, -95, 95, 95, 0)],
      lines: [lines('e', [[0, -40, 0, -30, -40, 0], [-80, -20, 0, 60, 120, 0]])],
    });
    const r = rig(scene());
    expect(r.tool.axisMeets).toBe(true);
    r.tool.setMode('tape');
    r.click(100.6, 140.4);
    r.move(101.2, 41.5);
    expect(r.tip()).toBe(`${AXIS_LABELS.y} · ${SNAP_LABELS.onEdge} · 100 mm`);
    const mark = r.q('[data-meet="edge"]')!;
    expect(mark.tagName.toLowerCase()).toBe('rect');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onEdge);
    expect(mark.getAttribute('data-kind')).toBe('axis');
    expect(mark.getAttribute('data-track')).toBeNull();
    const rubber = r.q('line.measure-rubber')!;
    expect(rubber.getAttribute('stroke')).toBe(AXIS_COLORS.y);
    expect(rubber.getAttribute('data-axis')).toBe('y');
    expect(r.qa('line.measure-track-line')).toHaveLength(0);
    // Shift: 그 축(모서리 방향이 아니라)으로 잠근다
    r.key('Shift');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'shift' });
    r.move(140.3, 41.5, { shift: true });
    expect(r.tip()?.startsWith(`${AXIS_LABELS.y} · 잠금`)).toBe(true);
    r.key('Shift', 'keyup');
    r.click(101.2, 41.5);
    const res = r.results.at(-1);
    expect(res).toMatchObject({ kind: 'tape', a: [0, -40, 0] });
    if (res?.kind !== 'tape') return;
    expect(res.b[0]).toBe(0);
    expect(res.b[1]).toBeCloseTo(60, 9);
    expect(res.distance).toBeCloseTo(100, 9);
    // 끄면 같은 자리는 예전처럼 모서리 위
    r.tool.setAxisMeets(false);
    expect(r.tool.axisMeets).toBe(false);
    r.click(100.6, 140.4);
    r.move(101.2, 41.5);
    expect(r.tip()?.startsWith(`${SNAP_LABELS.onEdge} · `)).toBe(true);
    expect(r.q('[data-meet]')).toBeNull();
    // 선택으로 처음부터 끌 수도 있다
    const off = rig(scene(), TOP, DEFAULT_UNITS, { axisMeets: false });
    expect(off.tool.axisMeets).toBe(false);
  });

  // 앞 위에서 비스듬히 본 원근: 비탈 면 roof(z = 40 + y/2), 끝점 A(10, −10, −20)에서 +X로 20인 선 — A의 파랑 축이 roof를 M(10, −10, 35)에서 뚫는다
  const ang = dirToAngles([0.3, -1, 0.8]);
  const CAM: CameraState = { target: [0, 0, 20], distance: 320, yaw: ang.yaw, pitch: ang.pitch, projection: 'perspective', fovY: FOV };
  const A: V3 = [10, -10, -20];
  const M: V3 = [10, -10, 35];
  const ROOF = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
    units: 'mm',
    meshes: [{ id: 'roof', positions: Float32Array.from([-60, -40, 20, 60, -40, 20, 60, 40, 60, -60, 40, 60]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]), color: [0.8, 0.8, 0.8, 1] }],
    lines: [lines('a', [[10, -10, -20, 30, -10, -20]])],
  });
  const f = frameFor(CAM, W, W);
  const sa = projectToScreen(f, A)!;
  const sm = projectToScreen(f, M)!;

  it('줄자: 시작점 파랑 축이 비탈 면을 뚫는 점 — 면 위 표식, 축 색 고무줄, 그 점에서 잰다', () => {
    const r = rig(ROOF(), CAM);
    r.tool.setMode('tape');
    r.click(sa[0] + 0.4, sa[1] - 0.3);
    expect(r.tool.pointCount).toBe(1);
    r.move(sm[0] + 1.2, sm[1] + 0.9);
    expect(r.tip()).toBe(`${AXIS_LABELS.z} · ${SNAP_LABELS.onFace} · 55 mm`);
    const mark = r.q('[data-meet="face"]')!;
    expect(mark.tagName.toLowerCase()).toBe('polygon');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onFace);
    expect(r.q('line.measure-rubber')?.getAttribute('stroke')).toBe(AXIS_COLORS.z);
    r.key('Shift');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'z', source: 'shift' });
    r.key('Shift', 'keyup');
    r.click(sm[0] + 1.2, sm[1] + 0.9);
    const res = r.results.at(-1);
    expect(res).toMatchObject({ kind: 'tape', a: A });
    if (res?.kind !== 'tape') return;
    expect(res.b.slice(0, 2)).toEqual([10, -10]);
    expect(res.b[2]).toBeCloseTo(35, 9);
    expect(res.distance).toBeCloseTo(55, 9);
  });

  it('면 앞에 떠 있는 선이 뚫는 점 둘레(코어 고르기 허용 거리 안)를 지나도 면 위 표식 — 그 자리는 그물 면만 다시 맞춘다(코어 0.20.0 meshesOnly)', () => {
    // 화면에서 M을 지나는 빨강 축 방향(ux)과 그에 수직인 방향(nv): 커서는 M에서 nv 반대로 8화소, 선은 nv 쪽 3화소 자리를 비탈 면에서 눈 쪽으로 6 떠서 지난다
    const s1 = projectToScreen(f, [M[0] + 10, M[1], M[2]])!;
    const l = Math.hypot(s1[0] - sm[0], s1[1] - sm[1]);
    const ux = [(s1[0] - sm[0]) / l, (s1[1] - sm[1]) / l] as const;
    const nv = [-ux[1], ux[0]] as const;
    const ray = screenRay(f, sm[0] + nv[0] * 3, sm[1] + nv[1] * 3);
    const n = [0, -1 / Math.sqrt(5), 2 / Math.sqrt(5)];
    const p0 = M.map((v, i) => v + n[i]! * 6);
    const k = ((p0[0]! - ray.origin[0]) * n[0]! + (p0[1]! - ray.origin[1]) * n[1]! + (p0[2]! - ray.origin[2]) * n[2]!) / (ray.dir[0] * n[0]! + ray.dir[1] * n[1]! + ray.dir[2] * n[2]!);
    const q = ray.origin.map((v, i) => v + ray.dir[i]! * k);
    const scene = ROOF();
    scene.lines = [...scene.lines, lines('float', [[q[0]! - 50, q[1]!, q[2]!, q[0]! + 50, q[1]!, q[2]!]])];
    const r = rig(scene, CAM);
    // 커서 고르기(선이 먼저)라면 M 자리는 그 떠 있는 선이다
    const sq = projectToScreen(f, q)!;
    expect(Math.hypot(sq[0] - sm[0], sq[1] - sm[1])).toBeCloseTo(3, 6);
    r.tool.setMode('tape');
    r.click(sa[0] + 0.4, sa[1] - 0.3);
    const before = r.meshPicks();
    r.move(sm[0] - nv[0] * 8 + ux[0] * 0.37, sm[1] - nv[1] * 8 + ux[1] * 0.37);
    expect(r.tip()).toBe(`${AXIS_LABELS.z} · ${SNAP_LABELS.onFace} · 55 mm`);
    expect(r.q('[data-meet="face"]')).not.toBeNull();
    expect(r.meshPicks()).toBeGreaterThan(before);
  });

  it('끌어온 축이 면을 뚫는 점(시작점 전): 끌어온 점에서 축 색 점선과 면 위 표식', () => {
    const r = rig(ROOF(), CAM);
    r.tool.setMode('tape');
    r.move(sa[0] + 0.4, sa[1] - 0.3);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toEqual([A]);
    r.move(sm[0] + 1.2, sm[1] + 0.9);
    expect(r.tip()).toBe(`${TRACK_AXIS_LABELS.z} · ${SNAP_LABELS.onFace}`);
    expect(r.q('line.measure-track-line')?.getAttribute('stroke')).toBe(AXIS_COLORS.z);
    const mark = r.q('[data-meet="face"]')!;
    expect(mark.getAttribute('data-track')).toBe('face');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onFace);
    // 끄면 예전처럼 끌어온 축 위 점
    r.tool.setAxisMeets(false);
    r.move(sm[0] + 1.3, sm[1] + 0.9);
    expect(r.tip()).toBe(TRACK_AXIS_LABELS.z);
  });
});

describe('측정 도구: 잠근 선이 모서리·면과 만나는 점(코어 0.19.0)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // 넓은 면 위: 끝점 A(0, −40 — 화면 100, 140)에서 −X로 30인 모서리, 비낀 모서리 s(y = x + 60 — 잠근 녹색 축과 (0, 60) — 화면 (100, 40)에서 만난다)
  const SCENE = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
    units: 'mm',
    meshes: [quad('f', -95, -95, 95, 95, 0)],
    lines: [lines('e', [[0, -40, 0, -30, -40, 0], [-80, -20, 0, 60, 120, 0]])],
  });

  it('줄자: Shift로 녹색 축을 잠근 채 비낀 모서리를 가리키면 만나는 점 — 모서리 위 표식에 잠금 고리, 그 점에서 잰다(끄면 예전처럼 커서에 가까운 점)', () => {
    const r = rig(SCENE());
    expect(r.tool.lockMeets).toBe(true);
    r.tool.setMode('tape');
    r.click(100.6, 140.4);
    // 모서리에서 먼 녹색 축 위에서 잠근다
    r.move(100.4, 80.3);
    expect(r.tip()?.startsWith(`${AXIS_LABELS.y} · `)).toBe(true);
    r.key('Shift');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'shift' });
    r.move(101.2, 41.5, { shift: true });
    expect(r.tip()).toBe(`${AXIS_LABELS.y} · ${SNAP_LABELS.onEdge} · 잠금 · 100 mm`);
    const mark = r.q('[data-meet="edge"]')!;
    expect(mark.tagName.toLowerCase()).toBe('rect');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onEdge);
    expect(mark.getAttribute('data-kind')).toBe('axis');
    expect(r.q('.measure-lock-ring')).not.toBeNull();
    const rubber = r.q('line.measure-rubber')!;
    expect(rubber.getAttribute('data-locked')).toBe('axis');
    expect(rubber.getAttribute('stroke')).toBe(AXIS_COLORS.y);
    // 끄면 같은 자리는 예전처럼 잠근 선 위 커서에 가까운 점(만나는 점 표식 없음)
    r.tool.setLockMeets(false);
    expect(r.tool.lockMeets).toBe(false);
    r.move(101.3, 41.5, { shift: true });
    expect(r.tip()?.startsWith(`${AXIS_LABELS.y} · 잠금 · `)).toBe(true);
    expect(r.tip()).not.toBe(`${AXIS_LABELS.y} · 잠금 · 100 mm`);
    expect(r.q('[data-meet]')).toBeNull();
    expect(r.q('.measure-lock-ring')).not.toBeNull();
    r.tool.setLockMeets(true);
    r.move(101.2, 41.5, { shift: true });
    r.click(101.2, 41.5, { shift: true });
    const res = r.results.at(-1);
    expect(res).toMatchObject({ kind: 'tape', a: [0, -40, 0] });
    if (res?.kind !== 'tape') return;
    expect(res.b[0]).toBe(0);
    expect(res.b[1]).toBeCloseTo(60, 9);
    expect(res.distance).toBeCloseTo(100, 9);
    // 선택으로 처음부터 끌 수도 있다
    expect(rig(SCENE(), TOP, DEFAULT_UNITS, { lockMeets: false }).tool.lockMeets).toBe(false);
  });

  it('잠금 단추(손가락 기기)로 잠가도 같다', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.click(100.6, 140.4);
    expect(r.tool.setInferenceLock('y')).toBe(true);
    r.move(101.2, 41.5);
    expect(r.tip()).toBe(`${AXIS_LABELS.y} · ${SNAP_LABELS.onEdge} · 잠금 · 100 mm`);
    expect(r.tool.inferenceLock).toMatchObject({ axis: 'y', source: 'button' });
  });

  it('줄자: ↑로 파랑 축을 잠근 채 비탈 면을 가리키면 뚫는 점 — 면 위 표식에 잠금 고리', () => {
    const ang = dirToAngles([0.3, -1, 0.8]);
    const CAM: CameraState = { target: [0, 0, 20], distance: 320, yaw: ang.yaw, pitch: ang.pitch, projection: 'perspective', fovY: FOV };
    const scene = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
      units: 'mm',
      meshes: [{ id: 'roof', positions: Float32Array.from([-60, -40, 20, 60, -40, 20, 60, 40, 60, -60, 40, 60]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]), color: [0.8, 0.8, 0.8, 1] }],
      lines: [lines('a', [[10, -10, -20, 30, -10, -20]])],
    });
    const f = frameFor(CAM, W, W);
    const sa = projectToScreen(f, [10, -10, -20])!;
    const sm = projectToScreen(f, [10, -10, 35])!;
    const r = rig(scene(), CAM);
    r.tool.setMode('tape');
    r.click(sa[0] + 0.4, sa[1] - 0.3);
    expect(r.tool.pointCount).toBe(1);
    r.key('ArrowUp');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'z', source: 'key' });
    r.move(sm[0] + 1.2, sm[1] + 0.9);
    expect(r.tip()).toBe(`${AXIS_LABELS.z} · ${SNAP_LABELS.onFace} · 잠금 · 55 mm`);
    const mark = r.q('[data-meet="face"]')!;
    expect(mark.tagName.toLowerCase()).toBe('polygon');
    expect(mark.getAttribute('fill')).toBe(SNAP_COLORS.onFace);
    expect(r.q('.measure-lock-ring')).not.toBeNull();
    r.click(sm[0] + 1.2, sm[1] + 0.9);
    const res = r.results.at(-1);
    expect(res).toMatchObject({ kind: 'tape', a: [10, -10, -20] });
    if (res?.kind !== 'tape') return;
    expect(res.b.slice(0, 2)).toEqual([10, -10]);
    expect(res.b[2]).toBeCloseTo(35, 9);
  });
});

describe('측정 도구: 잠근 선이 끌어온 점의 축과 만나는 점(코어 0.21.0)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // 넓은 면 위: 끝점 A(0, −40 — 화면 100, 140)에서 −X로 30인 모서리, 끝점 P(30, 20 — 화면 130, 80)에서 위로 40인 모서리.
  // 잠근 녹색 축(x = 0)과 P의 빨강 축(y = 20)이 M(0, 20) — 화면 (100, 80)에서 만난다
  const SCENE = (): Pick<Scene3d, 'meshes' | 'lines' | 'units'> => ({
    units: 'mm',
    meshes: [quad('f', -95, -95, 95, 95, 0)],
    lines: [lines('e', [[0, -40, 0, -30, -40, 0], [30, 20, 0, 30, 60, 0]])],
  });

  it('줄자: P에 머물러 끌어온 뒤 녹색 축을 잠그고 M 둘레를 가리키면 교차점 표식에 잠금 고리, P에서 빨강 점선, 그 점에서 잰다(끄면 예전처럼)', () => {
    const r = rig(SCENE());
    r.tool.setMode('tape');
    r.click(100.6, 140.4);
    r.move(130.6, 80.4);
    vi.advanceTimersByTime(TRACK_DWELL_MS);
    expect(r.tool.trackPoints).toEqual([[30, 20, 0]]);
    r.key('ArrowLeft');
    expect(r.tool.inferenceLock).toMatchObject({ kind: 'axis', axis: 'y', source: 'key' });
    r.move(101.3, 80.8);
    expect(r.tip()).toBe(`${AXIS_LABELS.y} · ${TRACK_AXIS_LABELS.x} · 잠금 · 60 mm`);
    const mark = r.q('[data-meet="track"]')!;
    expect(mark.tagName.toLowerCase()).toBe('g');
    expect(mark.getAttribute('data-track')).toBe('track');
    expect(mark.getAttribute('data-kind')).toBe('axis');
    expect(mark.querySelectorAll('path')[1]!.getAttribute('stroke')).toBe(SNAP_COLORS.intersection);
    expect(r.q('.measure-lock-ring')).not.toBeNull();
    const tl = r.q('line.measure-track-line')!;
    expect(tl.getAttribute('stroke')).toBe(AXIS_COLORS.x);
    expect(tl.getAttribute('data-axis')).toBe('x');
    expect(Number(tl.getAttribute('x1'))).toBeCloseTo(130, 6);
    expect(Number(tl.getAttribute('y1'))).toBeCloseTo(80, 6);
    expect(r.q('.measure-track.is-from')).not.toBeNull();
    expect(r.q('line.measure-rubber')!.getAttribute('data-locked')).toBe('axis');
    // 끄면 같은 자리는 예전처럼 잠근 선 위 커서에 가까운 점(만나는 점 표식·끌어온 점선 없음)
    r.tool.setLockMeets(false);
    r.move(101.4, 80.8);
    expect(r.tip()?.startsWith(`${AXIS_LABELS.y} · 잠금 · `)).toBe(true);
    expect(r.q('[data-meet]')).toBeNull();
    expect(r.q('line.measure-track-line')).toBeNull();
    r.tool.setLockMeets(true);
    r.move(101.3, 80.8);
    r.click(101.3, 80.8);
    const res = r.results.at(-1);
    expect(res).toMatchObject({ kind: 'tape', a: [0, -40, 0], b: [0, 20, 0] });
    if (res?.kind !== 'tape') return;
    expect(res.distance).toBe(60);
  });
});

describe('고르기 도구로 안내 여럿 고르기·숨기기(25차 — SketchUp "Selecting Geometry"·"Using guides")', () => {
  // 위에서 본 평행 투영: 세계 (X, Y) → 화면 (100 + X, 100 − Y). 누르는 자리·상자 모서리는 표식·선·경계에서 떨어진 곳만 쓴다
  const F = (): ReturnType<typeof frameFor> => frameFor(TOP, W, W);
  const flush = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
  const KEY = 'cd'.repeat(32);
  const PRINT = (): ArrayBuffer => new Uint8Array(32).fill(0xcd).buffer;
  // 안내점 P0 (120, 80)·P1 (150, 80)·P2 (60, 130), 안내선 L0 화면 y = 60(가로)·L1 화면 x = 40(세로)
  const PTS: V3[] = [[20, 20, 0], [50, 20, 0], [-40, -30, 0]];
  const LNS = [
    { point: [0, 40, 0] as V3, dir: [1, 0, 0] as V3 },
    { point: [-60, 0, 0] as V3, dir: [0, 1, 0] as V3 },
  ];
  type Store = ReturnType<typeof memStore>;
  /** 이 브라우저에 기억해 둔 안내를 되살린 도구(줄자·각도기는 끈 채). picks = onGuidePick을 부른 수 */
  const setup = async (extra: Partial<MeasureToolOptions> = {}, store: Store = memStore()): Promise<{ r: Rig; store: Store; picks: () => number }> => {
    if (!store.m.size) saveGuides(store, KEY, PTS, LNS, 1);
    let picks = 0;
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, { storage: store, onGuidePick: () => void picks++, ...extra });
    r.tool.openFile(PRINT());
    await flush();
    expect(r.tool.guides).toHaveLength(3);
    expect(r.tool.guideLines).toHaveLength(2);
    return { r, store, picks: () => picks };
  };
  /** 수정 키를 누른 채 캔버스를 끈다(포인터 7): 캔버스까지 간 움직임·코어에 보낸 끌기 거두기 수와 마지막 움직임 뒤 그린 상자 */
  const drag = (r: Rig, path: [number, number][], mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}, pointerType = 'mouse') => {
    let moves = 0;
    let cancels = 0;
    const onMove = (): void => void moves++;
    const onCancel = (): void => void cancels++;
    r.canvas.addEventListener('pointermove', onMove);
    r.canvas.addEventListener('pointercancel', onCancel);
    const fire = (type: string, [x, y]: [number, number], buttons: number): void => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, ...mods });
      Object.defineProperty(e, 'pointerId', { value: 7 });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      r.canvas.dispatchEvent(e);
    };
    fire('pointerdown', path[0]!, 1);
    for (const p of path.slice(1)) fire('pointermove', p, 1);
    r.overlay.paintNow();
    const el = r.q('rect.measure-box');
    const box = el ? { cls: el.getAttribute('class'), dash: el.getAttribute('stroke-dasharray'), w: Number(el.getAttribute('width')) } : null;
    fire('pointerup', path.at(-1)!, 0);
    r.overlay.paintNow();
    r.canvas.removeEventListener('pointermove', onMove);
    r.canvas.removeEventListener('pointercancel', onCancel);
    return { moves, cancels, box, after: r.q('rect.measure-box') };
  };
  const counts = (r: Rig): [number, number] => {
    r.overlay.paintNow();
    return [r.qa('.measure-guide.is-selected').length, r.qa('.measure-guide-line.is-selected').length];
  };

  it('고르기 방식: 수정 키 없음 = 새로, Ctrl(Mac은 Option) = 더하기, Shift = 넣고 빼기, Shift+Ctrl(Shift+Option) = 빼기', () => {
    expect(guideSelectOp(null)).toBe('replace');
    expect(guideSelectOp({})).toBe('replace');
    expect(guideSelectOp({ ctrlKey: true })).toBe('add');
    expect(guideSelectOp({ shiftKey: true })).toBe('toggle');
    expect(guideSelectOp({ shiftKey: true, ctrlKey: true })).toBe('subtract');
    // Windows·Linux의 Alt는 수정 키가 아니다(앱은 Alt+누르기로 가장 안쪽 형상을 고른다)
    expect(guideSelectOp({ altKey: true })).toBe('replace');
    expect(guideSelectOp({ altKey: true, shiftKey: true })).toBe('toggle');
    // Mac: Option이 더하기, Ctrl+누르기는 브라우저의 오른쪽 단추라 쓰지 않는다
    expect(guideSelectOp({ altKey: true }, 'Alt')).toBe('add');
    expect(guideSelectOp({ altKey: true, shiftKey: true }, 'Alt')).toBe('subtract');
    expect(guideSelectOp({ ctrlKey: true }, 'Alt')).toBe('replace');
    const [a, b, c] = ['a', 'b', 'c'];
    expect(applyGuideSelect([a, b], [c, c], 'replace')).toEqual([c]);
    expect(applyGuideSelect([a, b], [b, c], 'add')).toEqual([a, b, c]);
    expect(applyGuideSelect([a, b], [b, c], 'toggle')).toEqual([a, c]);
    expect(applyGuideSelect([a, b], [b, c], 'subtract')).toEqual([a]);
    expect(applyGuideSelect([], [], 'toggle')).toEqual([]);
    expect(guideCountText(0, 0)).toBeNull();
    expect(guideCountText(1, 0)).toBe(GUIDE_KIND_NAMES.point);
    expect(guideCountText(0, 1)).toBe(GUIDE_KIND_NAMES.line);
    expect(guideCountText(3, 0)).toBe('안내점 3개');
    expect(guideCountText(0, 2)).toBe('안내선 2개');
    expect(guideCountText(1, 1)).toBe('안내점 1개·안내선 1개');
    expect([guideDeleteLabel(1, 0), guideDeleteLabel(0, 1), guideDeleteLabel(0, 0), guideDeleteLabel(2, 1)]).toEqual([
      '고른 안내점 지우기',
      '고른 안내선 지우기',
      '고른 안내선 지우기',
      '고른 안내 3개 지우기',
    ]);
  });

  it('고르기 상자: 오른쪽으로 끌면 상자 안에 다 든 안내점만, 왼쪽은 걸친 안내선까지(끝없는 안내선은 다 들 수 없다)', () => {
    const f = F();
    expect(guidesInBox(f, PTS, LNS, 110.3, 50.4, 160.6, 90.3)).toEqual({ points: [0, 1], lines: [] });
    expect(guidesInBox(f, PTS, LNS, 160.6, 90.3, 110.3, 50.4)).toEqual({ points: [0, 1], lines: [0] });
    // 위에서 아래로 끌어도 같다(가로 방향만 본다)
    expect(guidesInBox(f, PTS, LNS, 160.6, 50.4, 110.3, 90.3)).toEqual({ points: [0, 1], lines: [0] });
    expect(guidesInBox(f, PTS, LNS, 30.2, 120.4, 70.7, 140.1)).toEqual({ points: [2], lines: [] });
    expect(guidesInBox(f, PTS, LNS, 70.7, 140.1, 30.2, 120.4)).toEqual({ points: [2], lines: [1] });
    expect(guidesInBox(f, PTS, LNS, 190.4, 190.1, 160.3, 150.2)).toEqual({ points: [], lines: [] });
  });

  it('Ctrl·Shift·Shift+Ctrl 누르기로 여럿을 넣고 빼고, 수정 키 없이 빈 곳을 누르면 모두 푼다(수정 키를 누른 채면 그대로)', async () => {
    const { r } = await setup();
    const calls = r.guideCalls();
    expect(r.tool.pickGuide(121.3, 81.2, 'mouse')).toBe('point');
    expect(r.tool.pickGuide(151.2, 79.4, 'mouse', { ctrlKey: true })).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(2);
    // 여럿이면 종류 하나(selectedGuide)는 없다
    expect(r.tool.selectedGuide).toBeNull();
    expect(r.tool.pickGuide(80.6, 61.3, 'mouse', { shiftKey: true })).toBe('line');
    expect(r.tool.selectedGuideCount).toBe(3);
    expect(counts(r)).toEqual([2, 1]);
    expect(r.tool.guidePickText(false)).toBe(`안내점 2개·안내선 1개 · ${GUIDE_DELETE_KEY_HINT}`);
    expect(r.tool.guidePickText(true)).toBe('안내점 2개·안내선 1개');
    expect(r.guideCalls()).toBe(calls + 3);
    // Shift: 고른 것을 다시 누르면 뺀다. Shift+Ctrl: 뺀다(고르지 않은 것을 눌러도 넣지 않는다)
    expect(r.tool.pickGuide(119.2, 80.9, 'mouse', { shiftKey: true })).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(2);
    expect(r.tool.pickGuide(150.7, 81.1, 'mouse', { shiftKey: true, ctrlKey: true })).toBe('point');
    expect(r.tool.pickGuide(61.3, 129.4, 'mouse', { shiftKey: true, ctrlKey: true })).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(1);
    expect(r.tool.selectedGuide).toBe('line');
    // Ctrl을 누른 채 이미 고른 것을 누르면 그대로(알리지 않는다)
    const before = r.guideCalls();
    expect(r.tool.pickGuide(80.6, 61.3, 'mouse', { ctrlKey: true })).toBe('line');
    expect(r.guideCalls()).toBe(before);
    // 빈 곳: 수정 키를 누른 채면 그대로, 없으면 푼다
    expect(r.tool.pickGuide(30.3, 170.2, 'mouse', { ctrlKey: true })).toBeNull();
    expect(r.tool.selectedGuideCount).toBe(1);
    expect(r.tool.pickGuide(30.3, 170.2, 'mouse')).toBeNull();
    expect(r.tool.selectedGuideCount).toBe(0);
    // 수정 키 없이 누르면 고른 것 대신 그것 하나
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    r.tool.pickGuide(151.2, 79.4, 'mouse', { ctrlKey: true });
    expect(r.tool.pickGuide(61.3, 129.4, 'mouse')).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(1);
    expect(counts(r)).toEqual([1, 0]);
  });

  it('Mac(안내 두기 키 Option): Option+누르기가 더하기, Ctrl+누르기는 수정 키가 아니다', async () => {
    const { r } = await setup({ guideKey: 'Alt' });
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    expect(r.tool.pickGuide(151.2, 79.4, 'mouse', { altKey: true })).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(2);
    expect(r.tool.pickGuide(41.2, 150.3, 'mouse', { altKey: true, shiftKey: true })).toBe('line');
    expect(r.tool.selectedGuideCount).toBe(2);
    expect(r.tool.pickGuide(61.3, 129.4, 'mouse', { ctrlKey: true })).toBe('point');
    expect(r.tool.selectedGuideCount).toBe(1);
  });

  it('고른 안내를 Delete·카드의 지우기 단추로 함께 지우고, 되돌리기 한 번에 모두 돌아온다', async () => {
    const { r, store } = await setup();
    const acts = document.createElement('div');
    const close = document.createElement('button');
    acts.append(close);
    r.tool.mountGuideDelete(acts);
    const del = acts.querySelector<HTMLButtonElement>('.sel-del')!;
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    r.tool.pickGuide(151.2, 79.4, 'mouse', { ctrlKey: true });
    r.tool.pickGuide(41.2, 150.3, 'mouse', { ctrlKey: true });
    expect(del.getAttribute('aria-label')).toBe('고른 안내 3개 지우기');
    expect(del.title).toBe('고른 안내 3개 지우기 (Delete)');
    expect(r.tool.selectKey(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }))).toBe(true);
    expect(r.tool.guides.map((p) => [...p])).toEqual([[-40, -30, 0]]);
    expect(r.tool.guideLines).toEqual([LNS[0]]);
    expect(r.tool.selectedGuideCount).toBe(0);
    expect(readGuideFiles(store)[KEY]!.p).toHaveLength(1);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.guides).toHaveLength(3);
    expect(r.tool.guideLines).toHaveLength(2);
    expect(r.tool.canUndo).toBe(false);
    // 카드 단추도 여럿을 함께
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    r.tool.pickGuide(80.6, 61.3, 'mouse', { ctrlKey: true });
    del.click();
    expect(r.tool.guides).toHaveLength(2);
    expect(r.tool.guideLines).toHaveLength(1);
    expect(r.tool.canUndo).toBe(true);
  });

  it('수정 키를 누른 채 끌면 코어 궤도 대신 고르기 상자: 오른쪽은 다 든 것, 왼쪽은 걸친 것까지 고르기 방식대로 넣고 빼고, 코어에는 끌기를 거둔다', async () => {
    const { r, picks } = await setup();
    // 오른쪽으로(Ctrl — 더하기): 안내점 P0·P1, 안내선 L0은 걸쳤지만 다 들지 않아 빠진다
    const right = drag(r, [[110.3, 50.4], [130.2, 70.1], [160.6, 90.3]], { ctrlKey: true });
    expect(right.moves).toBe(0);
    expect(right.cancels).toBe(1);
    expect(right.box).toEqual({ cls: 'measure-box', dash: null, w: expect.closeTo(50.3, 6) });
    expect(right.after).toBeNull();
    expect(counts(r)).toEqual([2, 0]);
    expect(picks()).toBe(1);
    // 왼쪽으로(Shift — 넣고 빼기): P0·P1은 빠지고 걸친 L0은 들어온다
    const left = drag(r, [[160.6, 90.3], [140.2, 70.4], [110.3, 50.4]], { shiftKey: true });
    expect(left.box).toMatchObject({ cls: 'measure-box is-crossing', dash: '5 3' });
    expect(left.cancels).toBe(1);
    expect(counts(r)).toEqual([0, 1]);
    expect(r.tool.selectedGuide).toBe('line');
    expect(picks()).toBe(2);
    // Shift+Ctrl(빼기)로 다 빼면 고른 것이 없어 앱에 알리지 않는다
    drag(r, [[160.6, 90.3], [110.3, 50.4]], { shiftKey: true, ctrlKey: true });
    expect(r.tool.selectedGuideCount).toBe(0);
    expect(picks()).toBe(2);
  });

  it('고르기 상자를 그리지 않는 때: 수정 키 없는 끌기(궤도)·끌기 시작 거리 안·손가락·줄자를 켠 동안·안내를 숨긴 동안·걷는 중', async () => {
    const { r, picks } = await setup();
    const path: [number, number][] = [[110.3, 50.4], [160.6, 90.3]];
    const plain = drag(r, path);
    expect(plain.moves).toBe(1);
    expect(plain.cancels).toBe(0);
    expect(plain.box).toBeNull();
    // 끌기 시작 거리(마우스 4화소) 안: 코어가 누르기로 알리도록 두고(거두지 않음) 상자도 없다
    const tiny = drag(r, [[120.4, 80.6], [121.9, 81.3]], { ctrlKey: true });
    expect(tiny.cancels).toBe(0);
    expect(tiny.box).toBeNull();
    expect(drag(r, path, { ctrlKey: true }, 'touch')).toMatchObject({ moves: 1, cancels: 0, box: null });
    r.tool.setMode('tape');
    expect(drag(r, path, { ctrlKey: true })).toMatchObject({ moves: 1, cancels: 0, box: null });
    r.tool.setMode(null);
    r.tool.setGuidesShown(false);
    expect(drag(r, path, { ctrlKey: true })).toMatchObject({ moves: 1, cancels: 0, box: null });
    r.tool.setGuidesShown(true);
    (r.viewer as { navigation?: 'orbit' | 'walk' }).navigation = 'walk';
    expect(drag(r, path, { ctrlKey: true })).toMatchObject({ moves: 1, cancels: 0, box: null });
    (r.viewer as { navigation?: 'orbit' | 'walk' }).navigation = 'orbit';
    expect(drag(r, path, { ctrlKey: true }).cancels).toBe(1);
    expect(r.tool.selectedGuideCount).toBe(2);
    expect(picks()).toBe(1);
  });

  it('고른 안내 숨기기(Edit › Hide): 그리지도 고르지도 붙지도 않고, 되돌리기·파일별 기억에 들며 "숨긴 안내 모두 보이기"로 다시 보인다', async () => {
    const { r, store } = await setup();
    const acts = document.createElement('div');
    acts.append(document.createElement('button'));
    r.tool.mountGuideDelete(acts);
    const hide = acts.querySelector<HTMLButtonElement>('.sel-hide')!;
    expect(hide.getAttribute('aria-label')).toBe(GUIDE_HIDE_LABEL);
    expect(hide.textContent).toBe(GUIDE_HIDE_TEXT);
    expect(r.tool.hideSelectedGuides()).toBe(false);
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    r.tool.pickGuide(80.6, 61.3, 'mouse', { ctrlKey: true });
    hide.click();
    expect(r.tool.hiddenGuideCount).toBe(2);
    expect(r.tool.selectedGuideCount).toBe(0);
    // 안내 수는 숨긴 것까지(측정값 칸의 수·모두 지우기)
    expect(r.tool.guides).toHaveLength(3);
    r.overlay.paintNow();
    expect(r.qa('.measure-guide')).toHaveLength(2);
    expect(r.qa('.measure-guide-line')).toHaveLength(1);
    // 숨긴 것은 고르지 않는다(앱은 그 자리 형상을 고른다)
    expect(r.tool.pickGuide(121.3, 81.2, 'mouse')).toBeNull();
    expect(r.tool.pickGuide(151.2, 79.4, 'mouse')).toBe('point');
    // 파일별 기억: 숨긴 번호
    expect(readGuideFiles(store)[KEY]).toMatchObject({ hp: [0], hl: [0] });
    // 메뉴: 숨긴 안내가 있을 때만 "숨긴 안내 모두 보이기"
    expect(r.tool.guideMenuItems().map((i) => i.label)).toEqual([GUIDES_SHOWN_LABEL, GUIDE_UNHIDE_LABEL, GUIDE_CLEAR_FILE_LABEL]);
    // 줄자: 숨긴 안내점에는 붙지 않는다
    r.tool.setMode('tape');
    r.move(121.3, 81.2);
    expect(r.tip()).not.toBe('안내점');
    r.move(151.2, 79.4);
    expect(r.tip()).toBe('안내점');
    expect(r.tool.hideSelectedGuides()).toBe(false);
    r.tool.setMode(null);
    // 같은 파일을 다시 열면 숨긴 채
    const again = await setup({}, store);
    expect(again.r.tool.hiddenGuideCount).toBe(2);
    again.r.overlay.paintNow();
    expect(again.r.qa('.measure-guide')).toHaveLength(2);
    // 되돌리기·다시 하기
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.hiddenGuideCount).toBe(0);
    expect(r.tool.redo()).toBe(true);
    expect(r.tool.hiddenGuideCount).toBe(2);
    // 모두 보이기: 안내 보이기를 꺼 두었으면 켠다, 되돌릴 수 있다
    r.tool.setGuidesShown(false);
    r.tool.guideMenuItems()[1]!.run();
    expect(r.tool.hiddenGuideCount).toBe(0);
    expect(r.tool.guidesShown).toBe(true);
    expect(r.tool.guideMenuItems().map((i) => i.label)).toEqual([GUIDES_SHOWN_LABEL, GUIDE_CLEAR_FILE_LABEL]);
    expect(readGuideFiles(store)[KEY]!.hp).toBeUndefined();
    expect(r.tool.unhideGuides()).toBe(false);
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.hiddenGuideCount).toBe(2);
    // 모두 지우기는 숨긴 안내도 지운다
    r.tool.clearGuides();
    expect(r.tool.hiddenGuideCount).toBe(0);
    expect(r.tool.guides).toHaveLength(0);
  });

  it('숨긴 안내와 같은 자리에 줄자로 다시 두면 그 안내를 다시 보인다(겹쳐 두지 않음)', () => {
    const r = rig({ units: 'mm', meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0]])] });
    const place = (): void => {
      r.tool.setMode('tape');
      r.click(102, 101);
      r.move(160, 101);
      expect(r.tool.applyLength(30)).toBe('ok');
      r.tool.setMode(null);
    };
    place();
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.pickGuide(131.2, 101.3, 'mouse')).toBe('point');
    expect(r.tool.hideSelectedGuides()).toBe(true);
    expect(r.tool.hiddenGuideCount).toBe(1);
    place();
    expect(r.tool.guides).toHaveLength(1);
    expect(r.tool.hiddenGuideCount).toBe(0);
    // 되돌리면 다시 숨는다
    expect(r.tool.undo()).toBe(true);
    expect(r.tool.hiddenGuideCount).toBe(1);
  });
});

describe('결과 글이 먼저 놓인 글상자(모형 글·치수 라벨)를 비켜 그리기(26차 — 코어 0.24.0 placeLabelAmong)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const view = { width: 400, height: 300 };
  const overlaps = (a: { x: number; y: number }, w: number, h: number, b: { x: number; y: number; width: number; height: number }): boolean =>
    a.x < b.x + b.width && b.x < a.x + w && a.y < b.y + b.height && b.y < a.y + h;

  it('labelSpot: 먼저 놓인 글상자가 없거나 겹치지 않으면 예전과 같고, 겹치면 그것까지 비키며, 비킬 곳이 없으면 가운데 그대로', () => {
    const bar = { x: 0, y: 260, width: 400, height: 40 };
    const seg: [number[], number[]] = [[100, 270], [300, 270]];
    const far = [{ x: 330.5, y: 20.5, width: 50, height: 16 }];
    // 겹치지 않는 먼저 놓인 글상자는 자리를 바꾸지 않는다(22차 자리 그대로)
    expect(labelSpot(200, 100, 60, 18, view, { rects: [] }, null, [], far)).toBeNull();
    expect(labelSpot(200, 270, 60, 18, view, { rects: [bar] }, seg, [], far)).toEqual(labelSpot(200, 270, 60, 18, view, { rects: [bar] }, seg));
    // 가운데 자리(170~230, 91~109)가 치수 라벨과 겹치면 코어 차례의 첫 빈자리(기준점 오른쪽 위 귀)
    const dim = { x: 180.5, y: 95.5, width: 40, height: 14 };
    expect(labelSpot(200, 100, 60, 18, view, { rects: [] }, null, [], [dim])).toEqual({ x: 210, y: 74 });
    // 오른쪽 위 귀도 다른 라벨이 차지했으면 그다음(왼쪽 위 귀)
    const upper = { x: 205.5, y: 70.5, width: 70, height: 20 };
    expect(labelSpot(200, 100, 60, 18, view, { rects: [] }, null, [], [dim, upper])).toEqual({ x: 130, y: 74 });
    // 측정 띠를 비킨 22차 자리가 라벨과 겹치면 띠와 라벨을 모두 비킨 자리
    const old = labelSpot(200, 270, 60, 18, view, { rects: [bar] }, seg)!;
    const onOld = { x: old.x - 5.5, y: old.y + 2.5, width: 40, height: 12 };
    const moved = labelSpot(200, 270, 60, 18, view, { rects: [bar] }, seg, [], [onOld])!;
    expect(moved).not.toEqual(old);
    expect(overlaps(moved, 60, 18, bar) || overlaps(moved, 60, 18, onOld)).toBe(false);
    // 비킬 곳이 없을 때: 띠와만 겹치던 글은 22차 자리, 라벨과만 겹치던 글은 가운데 그대로
    const all = [{ x: -10, y: -10, width: 420, height: 320 }];
    expect(labelSpot(200, 270, 60, 18, view, { rects: [bar] }, seg, [], all)).toEqual(old);
    expect(labelSpot(200, 100, 60, 18, view, { rects: [] }, null, [], all)).toBeNull();
    expect(labelSpot(200, 100, 0, 18, view, { rects: [] }, null, [], [dim])).toBeNull();
  });

  it('placedRects: 모형 라벨 배치의 상자를 사각형으로(흐리게 둔 것·크기 0은 빼고 차례 그대로)', () => {
    expect(
      placedRects([
        { box: { x: 1, y: 2, w: 30, h: 12 } },
        { box: { x: 5, y: 6, w: 30, h: 12 }, crowded: true },
        { box: { x: 7, y: 8, w: 0, h: 12 } },
        { box: { x: 9, y: 10, w: 20, h: 11 }, crowded: false },
      ]),
    ).toEqual([
      { x: 1, y: 2, width: 30, height: 12 },
      { x: 9, y: 10, width: 20, height: 11 },
    ]);
    expect(placedRects([])).toEqual([]);
  });

  it('줄자 결과 글이 앱이 알려 준 모형 라벨과 겹치면 비켜 두고, 겹치지 않거나 흐린 라벨이면 가운데 그대로', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 60 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('measure-label') ? 18 : 0;
    });
    let list: { box: { x: number; y: number; w: number; h: number }; crowded?: boolean }[] = [{ box: { x: 20.5, y: 20.5, w: 40, h: 12 } }];
    let asked = 0;
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, {
      placedLabels: () => {
        asked++;
        return list;
      },
    });
    r.tool.setMode('tape');
    r.move(30, 20);
    // 결과 글이 없으면 묻지 않는다
    expect(asked).toBe(0);
    r.click(102, 103);
    r.click(198, 101);
    r.move(30, 20);
    const label = (): HTMLElement => r.q('.measure-label-length') as HTMLElement;
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual(['150px', '100px', false]);
    expect(asked).toBeGreaterThan(0);
    // 결과 글 가운데 자리(120~180, 91~109)를 치수 라벨이 차지하면 비킨다
    const dim = { x: 140.5, y: 96.5, width: 30, height: 12 };
    list = [{ box: { x: dim.x, y: dim.y, w: dim.width, h: dim.height } }];
    r.move(31, 20);
    const l = label();
    expect(l.classList.contains('is-moved')).toBe(true);
    expect(l.style.transform).toBe('none');
    const at = { x: parseFloat(l.style.left), y: parseFloat(l.style.top) };
    expect(overlaps(at, 60, 18, dim)).toBe(false);
    expect(at.x >= 0 && at.y >= 0 && at.x + 60 <= W && at.y + 18 <= W).toBe(true);
    // 흐리게 둔 라벨(자리를 차지하지 않음)은 비키지 않는다
    list = [{ box: { x: dim.x, y: dim.y, w: dim.width, h: dim.height }, crowded: true }];
    r.move(30, 20);
    expect([label().style.left, label().style.top, label().classList.contains('is-moved')]).toEqual(['150px', '100px', false]);
  });
});

describe('고르기 도구로 안내 모두 고르기·모두 풀기(26차 — SketchUp "Selecting Geometry"의 Select All·Deselect All)', () => {
  const flush = (): Promise<void> => new Promise((res) => setTimeout(res, 0));
  const KEY = 'ab'.repeat(32);
  const PRINT = (): ArrayBuffer => new Uint8Array(32).fill(0xab).buffer;
  // 안내점 P0 (120, 80)·P1 (150, 80)·P2 (60, 130), 안내선 L0 화면 y = 60(가로)·L1 화면 x = 40(세로)
  const PTS: V3[] = [[20, 20, 0], [50, 20, 0], [-40, -30, 0]];
  const LNS = [
    { point: [0, 40, 0] as V3, dir: [1, 0, 0] as V3 },
    { point: [-60, 0, 0] as V3, dir: [0, 1, 0] as V3 },
  ];
  /** 기억해 둔 안내를 되살린 도구(줄자·각도기는 끈 채). picks = onGuidePick 수, none = onSelectNone 수, geo = 고른 형상이 있는지(앱 흉내) */
  const setup = async (extra: Partial<MeasureToolOptions> = {}) => {
    const store = memStore();
    saveGuides(store, KEY, PTS, LNS, 1);
    const s = { picks: 0, none: 0, geo: false };
    const r = rig(EDGES(), TOP, DEFAULT_UNITS, {
      storage: store,
      onGuidePick: () => {
        s.picks++;
        s.geo = false;
      },
      onSelectNone: () => {
        s.none++;
        const had = s.geo;
        s.geo = false;
        return had;
      },
      ...extra,
    });
    r.tool.openFile(PRINT());
    await flush();
    expect(r.tool.guides).toHaveLength(3);
    return { r, s };
  };
  /** keydown 하나를 selectKey에 넘긴다: [받았는지, 기본 동작을 막았는지] */
  const press = (r: Rig, o: KeyboardEventInit, target?: HTMLElement): [boolean, boolean] => {
    const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...o });
    let got = false;
    if (target) {
      const h = (ev: Event): void => void (got = r.tool.selectKey(ev as KeyboardEvent));
      target.addEventListener('keydown', h);
      target.dispatchEvent(e);
      target.removeEventListener('keydown', h);
    } else got = r.tool.selectKey(e);
    return [got, e.defaultPrevented];
  };
  const counts = (r: Rig): [number, number] => {
    r.overlay.paintNow();
    return [r.qa('.measure-guide.is-selected').length, r.qa('.measure-guide-line.is-selected').length];
  };

  it('selectAllKey: Windows·Linux는 Ctrl+A·Ctrl+T, Mac은 ⌘A·Shift+⌘A(⌘T·Ctrl+A는 아니다), 한글 자판은 물리 키로', () => {
    const k = (o: Partial<Parameters<typeof selectAllKey>[0]> & { key: string }, g?: 'Control' | 'Alt'): ReturnType<typeof selectAllKey> =>
      selectAllKey({ code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o }, g);
    expect(k({ key: 'a', ctrlKey: true })).toBe('all');
    expect(k({ key: 'A', ctrlKey: true })).toBe('all');
    expect(k({ key: 't', ctrlKey: true })).toBe('none');
    expect(k({ key: 'A', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k({ key: 'T', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(k({ key: 'a', metaKey: true })).toBeNull();
    expect(k({ key: 'a', ctrlKey: true, metaKey: true })).toBeNull();
    expect(k({ key: 'a', ctrlKey: true, altKey: true })).toBeNull();
    expect(k({ key: 'a' })).toBeNull();
    expect(k({ key: 'z', ctrlKey: true })).toBeNull();
    expect(k({ key: 'ㅁ', code: 'KeyA', ctrlKey: true })).toBe('all');
    expect(k({ key: 'ㅅ', code: 'KeyT', ctrlKey: true })).toBe('none');
    // Mac(안내 두기 키 Option)
    expect(k({ key: 'a', metaKey: true }, 'Alt')).toBe('all');
    expect(k({ key: 'A', metaKey: true, shiftKey: true }, 'Alt')).toBe('none');
    expect(k({ key: 'ㅁ', code: 'KeyA', metaKey: true, shiftKey: true }, 'Alt')).toBe('none');
    expect(k({ key: 'a', ctrlKey: true }, 'Alt')).toBeNull();
    expect(k({ key: 't', metaKey: true }, 'Alt')).toBeNull();
    expect(k({ key: 't', ctrlKey: true }, 'Alt')).toBeNull();
    expect(k({ key: 'a', metaKey: true, altKey: true }, 'Alt')).toBeNull();
  });

  it('Ctrl+A는 보이는 안내를 모두 고르고 앱에 고른 형상을 풀게 알리며, Ctrl+T는 고른 안내·형상을 모두 푼다', async () => {
    const { r, s } = await setup();
    s.geo = true;
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(5);
    expect(counts(r)).toEqual([3, 2]);
    expect(s.picks).toBe(1);
    expect(s.geo).toBe(false);
    expect(r.tool.guidePickText(false)).toBe(`안내점 3개·안내선 2개 · ${GUIDE_DELETE_KEY_HINT}`);
    // 이미 모두 골랐어도 받는다(브라우저의 글 모두 고르기로 넘기지 않는다)
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(5);
    // 모두 고른 뒤 Delete는 함께 지우고, 되돌리기 한 번에 돌아온다
    expect(r.tool.selectKey(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }))).toBe(true);
    expect([r.tool.guides.length, r.tool.guideLines.length]).toEqual([0, 0]);
    expect(r.tool.undo()).toBe(true);
    expect([r.tool.guides.length, r.tool.guideLines.length]).toEqual([3, 2]);
    // Ctrl+T: 모두 푼다
    press(r, { key: 'a', ctrlKey: true });
    expect(press(r, { key: 't', ctrlKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(0);
    expect(counts(r)).toEqual([0, 0]);
    expect(s.none).toBe(1);
    // 고른 것이 없으면 받지 않는다(브라우저 몫), 고른 형상만 있으면 앱이 풀고 받는다
    expect(press(r, { key: 't', ctrlKey: true })).toEqual([false, false]);
    s.geo = true;
    expect(press(r, { key: 't', ctrlKey: true })).toEqual([true, true]);
    expect(s.geo).toBe(false);
    // 숨긴 안내는 고르지 않는다
    r.tool.pickGuide(121.3, 81.2, 'mouse');
    r.tool.pickGuide(80.6, 61.3, 'mouse', { ctrlKey: true });
    expect(r.tool.hideSelectedGuides()).toBe(true);
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(3);
    expect(counts(r)).toEqual([2, 1]);
  });

  it('받지 않는 때: 입력 칸·줄자를 켠 동안·안내를 숨긴 동안·보이는 안내가 없을 때(브라우저 기본 동작 그대로)', async () => {
    const { r, s } = await setup();
    const input = document.createElement('input');
    document.body.append(input);
    expect(press(r, { key: 'a', ctrlKey: true }, input)).toEqual([false, false]);
    const div = document.createElement('div');
    document.body.append(div);
    expect(press(r, { key: 'a', ctrlKey: true }, div)).toEqual([true, true]);
    press(r, { key: 't', ctrlKey: true });
    r.tool.setMode('tape');
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([false, false]);
    expect(r.tool.selectedGuideCount).toBe(0);
    r.tool.setMode(null);
    r.tool.setGuidesShown(false);
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([false, false]);
    r.tool.setGuidesShown(true);
    // 모두 숨기면 보이는 안내가 없다
    press(r, { key: 'a', ctrlKey: true });
    r.tool.hideSelectedGuides();
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([false, false]);
    expect(s.picks).toBe(2);
    // 키가 아닌 것(Ctrl+Z·Shift+Ctrl+A)은 이 함수가 받지 않는다
    expect(press(r, { key: 'A', ctrlKey: true, shiftKey: true })).toEqual([false, false]);
  });

  it('Mac(안내 두기 키 Option): ⌘A로 모두 고르고 Shift+⌘A로 모두 풀며, Ctrl+A·⌘T는 받지 않는다', async () => {
    const { r, s } = await setup({ guideKey: 'Alt' });
    expect(press(r, { key: 'a', ctrlKey: true })).toEqual([false, false]);
    expect(press(r, { key: 'a', metaKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(5);
    expect(press(r, { key: 't', metaKey: true })).toEqual([false, false]);
    expect(r.tool.selectedGuideCount).toBe(5);
    expect(press(r, { key: 'A', metaKey: true, shiftKey: true })).toEqual([true, true]);
    expect(r.tool.selectedGuideCount).toBe(0);
    expect([s.picks, s.none]).toEqual([1, 1]);
  });
});
