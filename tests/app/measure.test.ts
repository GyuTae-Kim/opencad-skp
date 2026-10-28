// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3d } from 'opencad-viewer3d';
import { buildBvh } from 'opencad-viewer3d/bvh';
import { projectToScreen, type CameraState } from 'opencad-viewer3d/camera';
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
  edgeFoot,
  guideKeyFor,
  guideKeyHint,
} from '../../src/app/measure';
import { Overlay, frameFor } from '../../src/app/overlay';
import { DRAG_START_PX, TOUCH_DRAG_START_PX } from 'opencad-viewer3d';
import { DEFAULT_UNITS, type UnitsDisplay } from '../../src/app/units';

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

  it('툴팁 글·안내·추정 반경', () => {
    expect(joinTip('끝점', '1200 mm')).toBe('끝점 · 1200 mm');
    expect(joinTip('', '5 mm')).toBe('5 mm');
    expect(joinTip('면에')).toBe('면에');
    expect(measureHint('tape', 0, false)).toBe('줄자: 잴 시작점을 누르세요');
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
  const viewer: MeasureViewer = {
    canvas,
    pick: (x, y) =>
      pickScene(frameFor(camera, W, W), x, y, items, { tol: 6, occlude: true, bvh: (kind, pos, idx) => (kind === 'triangle' ? buildBvh(kind, pos, idx) : null) })?.pick ?? null,
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
    overlay,
    canvas,
    results,
    hints,
    lives,
    liveKinds,
    locks,
    guideCalls: () => guideCalls,
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
    expect(r.hints.at(-1)).toBe('줄자: 잴 시작점을 누르세요');

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
    expect(r.hints.at(-1)).toBe('줄자: 잴 시작점을 누르세요');
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
    expect(r.hints.at(-1)).toBe('줄자: 잴 시작점을 누르세요');
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
