import { describe, expect, it } from 'vitest';
import { computeFrame, dirToAngles, projectToScreen, type CameraState, type ViewFrame } from 'opencad-viewer3d/camera';
import { buildBvh } from 'opencad-viewer3d/bvh';
import { pickScene } from 'opencad-viewer3d/scenepick';
import type { LineSet3d, Mesh3d, Pick3d } from 'opencad-viewer3d/types';
import { PICK_TOLERANCE_PX, SNAP_PX, TOUCH_PICK_TOLERANCE_PX, pickTolerance } from 'opencad-viewer3d/pointer';
import {
  AIM_SNAP_RADIUS_PX,
  CORE_PICK_TOLERANCE_PX,
  SNAP_RADIUS_PX,
  TOUCH_SNAP_RADIUS_PX,
  axisLock,
  axisOf,
  chooseSnap,
  probeOffsets,
  rayClosestOnSegment,
  segmentOfPick,
  triangleOfPick,
  type SnapScene,
} from '../../src/app/snap';

const W = 200;
const FOV = (40 * Math.PI) / 180;
/** 위에서 본 평행 투영: 화면 1화소 = 세계 1, 화면 (100 + X, 100 − Y) */
const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };
const topFrame = computeFrame(TOP, W, W, { center: [0, 0, 0], radius: 1000 });

const lines = (id: string, segs: number[][], origin?: [number, number, number]): LineSet3d => ({ id, positions: Float32Array.from(segs.flat()), ...(origin ? { origin } : {}) });
const quad = (id: string, x0: number, y0: number, x1: number, y1: number, z: number): Mesh3d => ({
  id,
  positions: Float32Array.from([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]),
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  color: [0.8, 0.8, 0.8, 1],
});

function picker(scene: SnapScene, f: ViewFrame = topFrame): (x: number, y: number) => Pick3d | null {
  return (x, y) => pickScene(f, x, y, { meshes: scene.meshes, lines: scene.lines, points: [] }, { tol: CORE_PICK_TOLERANCE_PX, occlude: true, bvh: (kind, pos, idx) => (kind === 'triangle' ? buildBvh(kind, pos, idx) : null) })?.pick ?? null;
}

/** 앱 도구처럼 커서 + 둘레 고르기로 추정 */
function snapWith(scene: SnapScene, x: number, y: number, o: { from?: number[]; probes?: boolean; radius?: number; f?: ViewFrame } = {}) {
  const f = o.f ?? topFrame;
  const pick = picker(scene, f);
  const radius = o.radius ?? SNAP_RADIUS_PX;
  const probes = o.probes === false ? [] : probeOffsets(radius).map(([dx, dy]) => pick(x + dx, y + dy));
  return chooseSnap({ frame: f, x, y, pick: pick(x, y), probes, scene, radius, from: o.from ?? null, anchor: [0, 0, 0] });
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-6): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));
};

describe('시험 프레임', () => {
  it('위에서 본 평행 투영은 화면 1화소 = 세계 1', () => {
    close(projectToScreen(topFrame, [30, 20, 0])!.slice(0, 2), [130, 80], 1e-6);
  });
});

describe('추정: 선분', () => {
  // 원점에서 +X로 100, +Y로 50
  const scene: SnapScene = { meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0], [0, 0, 0, 0, 50, 0]])] };

  it('끝점이 반경 안이면 끝점(선분도 함께)', () => {
    const s = snapWith(scene, 103, 102);
    expect(s.kind).toBe('endpoint');
    expect(s.label).toBe('끝점');
    close(s.point, [0, 0, 0]);
    expect(s.edge).toBeDefined();
    expect(s.id).toBe('e');
  });

  it('중간점은 끝점이 멀 때', () => {
    const s = snapWith(scene, 153, 102);
    expect(s.kind).toBe('midpoint');
    expect(s.label).toBe('중간점');
    close(s.point, [50, 0, 0]);
    close(s.edge![1], [100, 0, 0]);
  });

  it('끝점·중간점이 멀면 모서리 위(코어가 고른 점)', () => {
    const s = snapWith(scene, 130, 103);
    expect(s.kind).toBe('onEdge');
    expect(s.label).toBe('모서리에');
    close(s.point, [30, 0, 0], 1e-4);
  });

  it('코어 허용 거리(6화소)보다 멀고 추정 반경 안의 선은 둘레 고르기로 찾는다', () => {
    const sc: SnapScene = { meshes: [quad('floor', -90, -90, 90, 90, -1)], lines: [lines('e', [[-80, 8, 0, 60, 8, 0]])] };
    expect(snapWith(sc, 100, 100, { probes: false }).kind).toBe('onFace');
    const s = snapWith(sc, 100, 100);
    expect(s.kind).toBe('onEdge');
    close(s.point, [0, 8, 0], 1e-4);
    // 커서 밑 면의 법선은 그대로 남는다(각도기 평면용)
    close(s.normal!, [0, 0, 1]);
  });

  it('터치 반경(넓게)이면 더 먼 끝점에도 붙는다', () => {
    // 끝점 (0,0,0)에서 화면 15화소
    expect(snapWith(scene, 112, 109).kind).toBe('onEdge');
    const s = snapWith(scene, 112, 109, { radius: TOUCH_SNAP_RADIUS_PX });
    expect(s.kind).toBe('endpoint');
    close(s.point, [0, 0, 0]);
  });

  it('묶음 origin을 더한 세계 좌표를 돌려준다', () => {
    const sc: SnapScene = { meshes: [], lines: [lines('far', [[0, 0, 0, 10, 0, 0], [1, 2, 3, 4, 5, 6]], [1e6, 2e6, 0])] };
    const p: Pick3d = { kind: 'line', id: 'far', index: 1, raw: 1, point: [1e6 + 2, 2e6 + 3, 4] };
    expect(segmentOfPick(sc, p)).toEqual([
      [1e6 + 1, 2e6 + 2, 3],
      [1e6 + 4, 2e6 + 5, 6],
    ]);
    expect(segmentOfPick(sc, { ...p, raw: 5 })).toBeNull();
    expect(segmentOfPick(sc, { ...p, id: 'none' })).toBeNull();
  });

  it('단면에서 잘린 쪽 끝점은 버리고, 가린 점(visible false)은 다음 후보로', () => {
    const pick = picker(scene);
    const base = { frame: topFrame, x: 198, y: 101, pick: pick(198, 101), scene };
    expect(chooseSnap(base).kind).toBe('endpoint');
    const cut = chooseSnap({ ...base, kept: (p) => p[0] <= 99 });
    expect(cut.kind).toBe('onEdge');
    const hidden = chooseSnap({ ...base, visible: (p) => p[0] < 99 });
    expect(hidden.kind).toBe('onEdge');
  });
});

describe('추정: 면', () => {
  it('선이 없으면 삼각형 꼭짓점이 끝점, 멀면 면 위(법선 포함)', () => {
    const sc: SnapScene = { meshes: [quad('floor', -90, -90, 90, 90, -1)], lines: [] };
    const corner = snapWith(sc, 186, 16);
    expect(corner.kind).toBe('endpoint');
    close(corner.point, [90, 90, -1]);
    const face = snapWith(sc, 120, 110);
    expect(face.kind).toBe('onFace');
    expect(face.label).toBe('면에');
    close(face.point, [20, -10, -1], 1e-4);
    close(face.normal!, [0, 0, 1]);
  });

  it('가까이 SketchUp 모서리가 있으면 삼각형 꼭짓점보다 앞세운다', () => {
    // 삼각형 꼭짓점 (−4, −4)은 커서에서 5.7화소, 모서리(y = 8)는 8화소
    const tri: Mesh3d = { id: 't', positions: Float32Array.from([-4, -4, -1, 40, -4, -1, -4, 40, -1]), color: [1, 1, 1, 1] };
    const withEdge: SnapScene = { meshes: [tri], lines: [lines('e', [[-80, 8, 0, 60, 8, 0]])] };
    expect(snapWith(withEdge, 100, 100).kind).toBe('onEdge');
    const bare: SnapScene = { meshes: [tri], lines: [] };
    const s = snapWith(bare, 100, 100);
    expect(s.kind).toBe('endpoint');
    close(s.point, [-4, -4, -1]);
  });

  it('삼각형 꼭짓점은 모형 행렬·origin을 거친 세계 좌표', () => {
    const m: Mesh3d = {
      id: 'm',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      color: [1, 1, 1, 1],
      origin: [10, 0, 0],
      matrix: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1]),
    };
    const tri = triangleOfPick({ meshes: [m], lines: [] }, { kind: 'mesh', id: 'm', index: 0, raw: 0, point: [10, 0, 5] });
    expect(tri).toEqual([
      [10, 0, 5],
      [11, 0, 5],
      [10, 1, 5],
    ]);
    expect(triangleOfPick({ meshes: [m], lines: [] }, { kind: 'mesh', id: 'm', index: -1, raw: -1, point: [0, 0, 0], section: true })).toBeNull();
  });

  it('단면 채운 면은 면 위(단면에)', () => {
    const p: Pick3d = { kind: 'mesh', id: 'm', index: -1, raw: -1, point: [1, 2, 3], normal: [0, 0, 1], section: true };
    const s = chooseSnap({ frame: topFrame, x: 101, y: 98, pick: p, scene: { meshes: [], lines: [] } });
    expect(s).toMatchObject({ kind: 'onFace', label: '단면에', section: true, point: [1, 2, 3], normal: [0, 0, 1] });
  });
});

describe('추정: 축 고정·빈 곳', () => {
  const empty: SnapScene = { meshes: [], lines: [] };
  const at = (deg: number, r: number): [number, number] => [100 + r * Math.cos((deg * Math.PI) / 180), 100 - r * Math.sin((deg * Math.PI) / 180)];

  it('시작점에서 화면 각 6° 안이면 그 축 위 가장 가까운 점', () => {
    const [x, y] = at(3, 60);
    const s = snapWith(empty, x, y, { from: [0, 0, 0] });
    expect(s.kind).toBe('axis');
    expect(s.axis).toBe('x');
    expect(s.label).toBe('빨강 축에');
    close(s.point, [60 * Math.cos((3 * Math.PI) / 180), 0, 0], 1e-6);
    const [gx, gy] = at(95, 40);
    expect(snapWith(empty, gx, gy, { from: [0, 0, 0] })).toMatchObject({ kind: 'axis', axis: 'y', label: '녹색 축에' });
    // 반대 방향(−X)도 같은 축
    const [nx, ny] = at(182, 50);
    expect(snapWith(empty, nx, ny, { from: [0, 0, 0] }).axis).toBe('x');
  });

  it('각이 크거나 시작점에 너무 가까우면 빈 점(시작점을 지나 화면과 나란한 평면)', () => {
    const [x, y] = at(10, 60);
    const s = snapWith(empty, x, y, { from: [0, 0, 5] });
    expect(s.kind).toBe('free');
    expect(s.label).toBe('');
    close(s.point, [x - 100, 100 - y, 5], 1e-6);
    expect(axisLock(topFrame, [0, 0, 0], 108, 100)).toBeNull();
    expect(snapWith(empty, 100, 100).kind).toBe('free');
  });

  it('축 고정은 면 위보다 앞서고, 끝점보다는 뒤', () => {
    const floor: SnapScene = { meshes: [quad('floor', -90, -90, 90, 90, -1)], lines: [] };
    const [x, y] = at(2, 50);
    expect(snapWith(floor, x, y, { from: [0, 0, 0] }).kind).toBe('axis');
    const edge: SnapScene = { meshes: [], lines: [lines('e', [[0, 0, 0, 80, 0, 0]])] };
    const s = snapWith(edge, 179, 101, { from: [0, 0, 0] });
    expect(s.kind).toBe('endpoint');
    close(s.point, [80, 0, 0]);
  });

  it('원근 등각 보기에서도 파랑(Z) 축을 따라가면 Z 고정', () => {
    const a = dirToAngles([1, -1, 1]);
    const cam: CameraState = { target: [0, 0, 0], distance: 300, yaw: a.yaw, pitch: a.pitch, projection: 'perspective', fovY: FOV };
    const f = computeFrame(cam, W, W, { center: [0, 0, 0], radius: 300 });
    const s0 = projectToScreen(f, [0, 0, 0])!;
    const s1 = projectToScreen(f, [0, 0, 40])!;
    const k = 1.5;
    const x = s0[0] + (s1[0] - s0[0]) * k, y = s0[1] + (s1[1] - s0[1]) * k;
    const lock = axisLock(f, [0, 0, 0], x + 0.5, y);
    expect(lock?.axis).toBe('z');
    expect(Math.abs(lock!.point[0])).toBeLessThan(1e-6);
    expect(Math.abs(lock!.point[1])).toBeLessThan(1e-6);
    expect(lock!.point[2]).toBeGreaterThan(40);
  });
});

describe('추정 도움 함수', () => {
  it('추정 반경은 코어 허용 거리에 맞춘다: 마우스 = 코어 붙잡기, 터치·정밀 조준 ≥ 코어 터치 허용 거리', () => {
    expect(CORE_PICK_TOLERANCE_PX).toBe(PICK_TOLERANCE_PX);
    expect(SNAP_RADIUS_PX).toBe(SNAP_PX);
    const touch = pickTolerance('touch', PICK_TOLERANCE_PX, TOUCH_PICK_TOLERANCE_PX);
    expect(TOUCH_SNAP_RADIUS_PX).toBeGreaterThanOrEqual(Math.max(touch.tol, touch.snap));
    expect(AIM_SNAP_RADIUS_PX).toBeGreaterThanOrEqual(touch.tol);
  });

  it('터치 반경의 둘레 고르기는 코어 터치 허용 거리(14화소) 안의 선을 빠짐없이 찾는다', () => {
    // 가운데(허용 6)와 둘레(반지름 19 ± 6)로, 커서에서 0~14화소 떨어진 긴 선을 어느 방향이든 하나는 맞힌다
    const probes = probeOffsets(TOUCH_SNAP_RADIUS_PX, CORE_PICK_TOLERANCE_PX);
    for (let d = 0; d <= TOUCH_PICK_TOLERANCE_PX; d += 0.5)
      for (let a = 0; a < 180; a += 7.5) {
        const t = (a * Math.PI) / 180;
        // 방향 (cos t, sin t)로 지나고 커서에서 d만큼 떨어진 직선까지의 거리
        const dist = (x: number, y: number): number => Math.abs(-Math.sin(t) * x + Math.cos(t) * y - d);
        const hit = dist(0, 0) <= CORE_PICK_TOLERANCE_PX || probes.some(([x, y]) => dist(x, y) <= CORE_PICK_TOLERANCE_PX);
        expect(hit).toBe(true);
      }
  });

  it('둘레 고르기 점: 반경 − 허용/2 둘레에 허용 간격쯤, 최대 12개', () => {
    const p = probeOffsets(SNAP_RADIUS_PX, CORE_PICK_TOLERANCE_PX);
    expect(p.length).toBe(8);
    for (const [dx, dy] of p) expect(Math.hypot(dx, dy)).toBeCloseTo(7, 9);
    expect(probeOffsets(TOUCH_SNAP_RADIUS_PX).length).toBe(12);
    expect(probeOffsets(5, 6)).toEqual([]);
  });

  it('선분 위 광선에 가장 가까운 점은 선분 안으로 자른다', () => {
    const ray = { origin: [5, 3, 10] as [number, number, number], dir: [0, 0, -1] as [number, number, number] };
    close(rayClosestOnSegment(ray, [0, 0, 0], [10, 0, 0]), [5, 0, 0]);
    close(rayClosestOnSegment(ray, [6, 0, 0], [10, 0, 0]), [6, 0, 0]);
  });

  it('축 법선 알아보기', () => {
    expect(axisOf([0, 0, -3])).toBe('z');
    expect(axisOf([1, 0, 0])).toBe('x');
    expect(axisOf([1, 1, 0])).toBeNull();
    expect(axisOf([0, 0, 0])).toBeNull();
  });
});
