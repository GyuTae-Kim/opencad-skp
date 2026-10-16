// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { Viewer3d } from 'opencad-viewer3d';
import { buildBvh } from 'opencad-viewer3d/bvh';
import { projectToScreen, type CameraState } from 'opencad-viewer3d/camera';
import { pickScene } from 'opencad-viewer3d/scenepick';
import type { LineSet3d, Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import {
  MeasureTool,
  joinTip,
  measureHint,
  planeAngle,
  protractorPlane,
  protractorPoint,
  protractorResult,
  snapRadius,
  tapeResult,
  tooltipPosition,
  type MeasureToolResult,
  type MeasureViewer,
} from '../../src/app/measure';
import { Overlay, frameFor } from '../../src/app/overlay';
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
    expect(snapRadius('touch')).toBeGreaterThan(snapRadius('mouse'));
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

function rig(scene: Pick<Scene3d, 'meshes' | 'lines' | 'units'>, cam: CameraState = TOP, units: UnitsDisplay = DEFAULT_UNITS): Rig {
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
  const tool = new MeasureTool(viewer, overlay, { getScene: () => scene, getUnits: () => units, onResult: (r) => results.push(r), onHint: (h) => hints.push(h) });
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
  it('탭은 넓은 반경으로 추정하고, 두 손가락은 점을 찍지 않는다', () => {
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
