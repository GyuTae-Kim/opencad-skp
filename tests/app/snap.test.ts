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
  alongAxis,
  axisInferenceLock,
  axisLock,
  axisOf,
  chooseSnap,
  directionLock,
  footOnLine,
  footOnPlane,
  lockOf,
  parallelInferenceLock,
  probeOffsets,
  rayClosestOnSegment,
  segmentOfPick,
  triangleOfPick,
  type InferenceLock,
  type SnapScene,
} from '../../src/app/snap';
import type { V3 } from 'opencad-viewer3d/math';

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
function snapWith(
  scene: SnapScene,
  x: number,
  y: number,
  o: { from?: number[]; probes?: boolean; radius?: number; f?: ViewFrame; parallelRef?: [V3, V3] | null; lock?: InferenceLock | null } = {},
) {
  const f = o.f ?? topFrame;
  const pick = picker(scene, f);
  const radius = o.radius ?? SNAP_RADIUS_PX;
  const probes = o.probes === false ? [] : probeOffsets(radius).map(([dx, dy]) => pick(x + dx, y + dy));
  return chooseSnap({ frame: f, x, y, pick: pick(x, y), probes, scene, radius, from: o.from ?? null, anchor: [0, 0, 0], parallelRef: o.parallelRef ?? null, lock: o.lock ?? null });
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

  it('카메라를 보는 그물(billboard)은 저장된 꼭짓점에 붙지 않고 면 위, 그물 윤곽선 고르기(edge)는 모서리 위', () => {
    const m: Mesh3d = { id: 'b', positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), color: [1, 1, 1, 1], billboard: { origin: [0, 0, 0], axis: 'z' } };
    const sc = { meshes: [m], lines: [] };
    expect(triangleOfPick(sc, { kind: 'mesh', id: 'b', index: 0, raw: 0, point: [0.2, 0.2, 0] })).toBeNull();
    const s = chooseSnap({ frame: topFrame, x: 100, y: 100, pick: { kind: 'mesh', id: 'b', index: 0, raw: 0, point: [0, 0, 0], normal: [0, 0, 1] }, scene: sc });
    expect(s.kind).toBe('onFace');
    const e = chooseSnap({ frame: topFrame, x: 100, y: 100, pick: { kind: 'edge', id: 'b', index: 0, raw: 0, point: [0, 0, 0] }, scene: sc });
    expect(e).toMatchObject({ kind: 'onEdge', point: [0, 0, 0] });
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

describe('추정: 수직·중심', () => {
  it('시작점에서 모서리에 내린 발(선분 안)이 반경 안이면 수직, 시작점이 없으면 모서리 위', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('e', [[-50, 40, 0, 50, 40, 0]])] };
    const s = snapWith(scene, 112, 62, { from: [10, 0, 0] });
    expect(s.kind).toBe('perpendicular');
    expect(s.label).toBe('모서리에 수직');
    close(s.point, [10, 40, 0]);
    expect(snapWith(scene, 112, 62).kind).toBe('onEdge');
    // 발이 선분 밖이면 수직이 아니다
    expect(footOnLine([80, 0, 0], [-50, 40, 0], [50, 40, 0])!.t).toBeGreaterThan(1);
    expect(snapWith(scene, 147, 62, { from: [80, 0, 0] }).kind).not.toBe('perpendicular');
  });

  it('시작점에서 커서 밑 면의 평면에 내린 발이 반경 안이면 면에 수직(맞은편 면까지의 거리)', () => {
    const scene: SnapScene = { meshes: [quad('f', -80, -80, 80, 80, 0)], lines: [] };
    const s = snapWith(scene, 133, 82, { from: [30, 20, 50] });
    expect(s.kind).toBe('perpendicular');
    expect(s.label).toBe('면에 수직');
    close(s.point, [30, 20, 0]);
    expect(s.normal).toBeDefined();
    // 발에서 멀면 면 위
    expect(snapWith(scene, 160, 40, { from: [30, 20, 50] }).kind).toBe('onFace');
    expect(snapWith(scene, 133, 82).kind).toBe('onFace');
    close(footOnPlane([1, 2, 3], [0, 0, 0], [0, 0, 2])!, [1, 2, 0]);
    expect(footOnPlane([1, 2, 3], [0, 0, 0], [0, 0, 0])).toBeNull();
  });

  it('호의 중심: 곡선 선분의 중심(부른 쪽 판정)과 앞서 지나간 중심에 붙는다', () => {
    const N = 12;
    const segs: number[][] = [];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N + 0.1;
      const b = (2 * Math.PI * (i + 1)) / N + 0.1;
      segs.push([30 * Math.cos(a), 30 * Math.sin(a), 0, 30 * Math.cos(b), 30 * Math.sin(b), 0]);
    }
    const scene: SnapScene = { meshes: [], lines: [lines('c', segs)] };
    const pick = picker(scene);
    const seen: string[] = [];
    // 원 위(끝점 사이)를 지날 때 중심을 잰다 — 커서에서 멀어 그때는 모서리 위
    const onArc = chooseSnap({ frame: topFrame, x: 130, y: 100, pick: pick(130, 100), scene, curveCenter: (p) => (seen.push(p.id), [0, 0, 0]) });
    expect(seen).toContain('c');
    expect(onArc.kind).not.toBe('center');
    // 가운데로 옮기면 기억한 중심에 붙는다
    const s = chooseSnap({ frame: topFrame, x: 101, y: 101, pick: pick(101, 101), scene, centers: [[0, 0, 0]] });
    expect(s.kind).toBe('center');
    expect(s.label).toBe('중심');
    close(s.point, [0, 0, 0]);
    // 반경 밖이면 붙지 않는다
    expect(chooseSnap({ frame: topFrame, x: 115, y: 100, pick: null, scene, centers: [[0, 0, 0]] }).kind).toBe('free');
  });
});

describe('추정: 교차점(코어 0.9.0 segmentIntersection)', () => {
  // 위에서 본 평행 투영: 화면 (100 + X, 100 − Y)
  it('두 선분이 3D에서 안쪽끼리 만나면 교차점(빨강 ×), 끝점·중간점보다는 뒤·수직·모서리 위보다는 앞', () => {
    // 다른 그룹의 모서리처럼 따로 묶인 두 선분이 (10, 10, 0)에서 엇갈린다
    const scene: SnapScene = { meshes: [], lines: [lines('a', [[-40, 10, 0, 100, 10, 0]]), lines('b', [[10, -30, 0, 10, 110, 0]])] };
    const s = snapWith(scene, 113, 87);
    expect(s.kind).toBe('intersection');
    expect(s.label).toBe('교차점');
    close(s.point, [10, 10, 0]);
    expect(s.edge).toBeDefined();
    expect(s.other).toBeDefined();
    // 시작점이 있어도(수직 발 후보가 있어도) 교차점이 앞선다
    expect(snapWith(scene, 113, 87, { from: [-20, -20, 0] }).kind).toBe('intersection');
    // 반경 밖이면 모서리 위
    expect(snapWith(scene, 150, 90).kind).toBe('onEdge');
  });

  it('화면에서만 엇갈리는(깊이가 다른) 선분은 교차점이 아니다', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('a', [[-40, 10, 0, 100, 10, 0]]), lines('b', [[10, -30, 25, 10, 110, 25]])] };
    expect(snapWith(scene, 113, 87).kind).not.toBe('intersection');
  });

  it('끝에서 만나는 꺾인 곳은 끝점이 맡는다', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('a', [[0, 0, 0, 60, 0, 0]]), lines('b', [[0, 0, 0, 0, 60, 0]])] };
    expect(snapWith(scene, 102, 98).kind).toBe('endpoint');
  });

  it('보조선(점선 선분 묶음)과 모서리의 교차도 잡는다 — 묶음 origin을 더한 세계 좌표', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('edge', [[-50, -20, 0, 110, -20, 0]]), lines('guide', [[0, -60, 0, 0, 40, 0]], [5, 0, 0])] };
    const s = snapWith(scene, 106, 121);
    expect(s.kind).toBe('intersection');
    close(s.point, [5, -20, 0]);
  });
});

describe('추정: 모서리와 나란히(SketchUp 자홍 추론)', () => {
  const empty: SnapScene = { meshes: [], lines: [] };
  // 위에서 본 평행 투영: 화면 (100 + X, 100 − Y)
  const at = (deg: number, r: number): [number, number] => [100 + r * Math.cos((deg * Math.PI) / 180), 100 - r * Math.sin((deg * Math.PI) / 180)];
  /** 앞서 지나간 45° 모서리(시작점과 떨어져 있다) */
  const diag: [V3, V3] = [[-90, -60, 0], [-60, -30, 0]];

  it('시작점에서 지나간 모서리와 나란한 방향(화면 각 6° 안)이면 그 방향 선 위 점, 기준 모서리와 방향도 함께', () => {
    const [x, y] = at(47, 50);
    const s = snapWith(empty, x, y, { from: [0, 0, 0], parallelRef: diag });
    expect(s.kind).toBe('parallel');
    expect(s.label).toBe('모서리와 나란히');
    const t = (50 * Math.cos((2 * Math.PI) / 180)) / Math.SQRT2;
    close(s.point, [t, t, 0], 1e-6);
    close(s.dir!, [Math.SQRT1_2, Math.SQRT1_2, 0], 1e-9);
    expect(s.edge).toEqual(diag);
    // 기준 모서리가 없거나, 시작점이 없거나, 각이 크면 아니다
    expect(snapWith(empty, x, y, { from: [0, 0, 0] }).kind).toBe('free');
    expect(snapWith(empty, x, y, { parallelRef: diag }).kind).toBe('free');
    const [fx, fy] = at(60, 50);
    expect(snapWith(empty, fx, fy, { from: [0, 0, 0], parallelRef: diag }).kind).toBe('free');
  });

  it('축과 나란한 모서리는 축에 맡기고, 둘 다 맞으면 화면에서 선에 가까운 쪽(같으면 축)', () => {
    const [x, y] = at(47, 50);
    expect(snapWith(empty, x, y, { from: [0, 0, 0], parallelRef: [[-50, -50, 0], [50, -50, 0]] }).kind).toBe('free');
    expect(alongAxis([0, 3, 0])).toBe(true);
    expect(alongAxis([1, 1, 0])).toBe(false);
    // X축에서 4° 기운 모서리: 1°는 축이 가깝고, 3.5°는 나란함이 가깝다
    const r4 = (4 * Math.PI) / 180;
    const tilted: [V3, V3] = [[-50, -50, 0], [-50 + 40 * Math.cos(r4), -50 + 40 * Math.sin(r4), 0]];
    const [ax, ay] = at(1, 50);
    expect(snapWith(empty, ax, ay, { from: [0, 0, 0], parallelRef: tilted })).toMatchObject({ kind: 'axis', axis: 'x' });
    const [px, py] = at(3.5, 50);
    expect(snapWith(empty, px, py, { from: [0, 0, 0], parallelRef: tilted }).kind).toBe('parallel');
    // 화면 거리: 축은 50·sin 3.5°, 나란함은 50·sin 0.5°
    expect(directionLock(topFrame, [0, 0, 0], px, py, [1, 0, 0])!.perp).toBeCloseTo(50 * Math.sin((3.5 * Math.PI) / 180), 6);
    expect(directionLock(topFrame, [0, 0, 0], px, py, [Math.cos(r4), Math.sin(r4), 0])!.perp).toBeCloseTo(50 * Math.sin((0.5 * Math.PI) / 180), 6);
  });

  it('점 추정(끝점)이 나란함보다 앞선다', () => {
    const [x, y] = at(47, 50);
    const scene: SnapScene = { meshes: [], lines: [lines('p', [[34, 37, 0, 34, 90, 0]])] };
    const s = snapWith(scene, x, y, { from: [0, 0, 0], parallelRef: diag });
    expect(s.kind).toBe('endpoint');
    close(s.point, [34, 37, 0]);
  });
});

describe('추정: 방향 잠금(SketchUp 추론 잠금)', () => {
  const empty: SnapScene = { meshes: [], lines: [] };

  it('축을 잠그면 축 밖을 가리켜도(거리 제한 없이) 시작점을 지나는 그 축 위 점', () => {
    const lock = axisInferenceLock('x');
    expect(lock).toEqual({ kind: 'axis', axis: 'x', dir: [1, 0, 0], label: '빨강 축에' });
    const s = snapWith(empty, 140, 70, { from: [0, 0, 0], lock });
    expect(s).toMatchObject({ kind: 'axis', axis: 'x', locked: true, label: '빨강 축에' });
    close(s.point, [40, 0, 0]);
    expect(s.from).toBeUndefined();
    close(snapWith(empty, 140, 5, { from: [0, 0, 0], lock }).point, [40, 0, 0]);
    // 시작점이 없으면 잠금을 쓰지 않는다
    expect(snapWith(empty, 140, 70, { lock }).locked).toBeUndefined();
    // 모형의 그리기 축을 옮겼으면 그 축 방향
    const turned = { x: [0, 1, 0] as V3, y: [-1, 0, 0] as V3, z: [0, 0, 1] as V3 };
    expect(axisInferenceLock('x', turned).dir).toEqual([0, 1, 0]);
  });

  it('끝점을 가리키면 그 점을 잠근 선에 수직으로 내린 자리(파랑 축 잠금 = 그 점의 높이)', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('h', [[50, 50, 30, 60, 50, 30]])] };
    const s = snapWith(scene, 150, 50, { from: [0, 0, 0], lock: axisInferenceLock('z') });
    expect(s).toMatchObject({ kind: 'axis', axis: 'z', locked: true, fromKind: 'endpoint' });
    close(s.point, [0, 0, 30]);
    close(s.from!, [50, 50, 30]);
    // 위에서 본 보기에서 빈 곳은 파랑 축이 시선과 나란해 찍을 점이 없다
    expect(snapWith(empty, 150, 50, { from: [0, 0, 0], lock: axisInferenceLock('z') }).kind).toBe('free');
  });

  it('나란함 잠금은 기준 모서리 방향, 지금 추정에서 잠글 선 꺼내기(축·나란함·시작점에서 내린 수직)', () => {
    const ref: [V3, V3] = [[-90, -60, 0], [-60, -30, 0]];
    const lock = parallelInferenceLock(ref)!;
    expect(lock.kind).toBe('parallel');
    const s = snapWith(empty, 170, 60, { from: [0, 0, 0], lock });
    expect(s).toMatchObject({ kind: 'parallel', locked: true, label: '모서리와 나란히' });
    close(s.point, [55, 55, 0]);
    expect(s.edge).toEqual(ref);
    expect(parallelInferenceLock([[1, 1, 1], [1, 1, 1]])).toBeNull();

    // 지금 추정 → 잠글 선
    expect(lockOf(snapWith(empty, 160, 99, { from: [0, 0, 0] }))).toMatchObject({ kind: 'axis', axis: 'x', dir: [1, 0, 0], label: '빨강 축에' });
    const scene: SnapScene = { meshes: [], lines: [lines('e', [[-50, 40, 0, 50, 40, 0]])] };
    const perp = snapWith(scene, 112, 62, { from: [10, 0, 0] });
    expect(perp.kind).toBe('perpendicular');
    close(perp.dir!, [0, 1, 0]);
    expect(lockOf(perp)).toMatchObject({ kind: 'perpendicular', label: '모서리에 수직' });
    // 끝점·면 위·빈 곳은 잠글 방향이 아니다
    expect(lockOf(snapWith(scene, 151, 61))).toBeNull();
    expect(lockOf(null)).toBeNull();
    // 잠근 수직: 커서가 어디든 시작점 → 발 방향 선 위
    const locked = snapWith(empty, 130, 20, { from: [10, 0, 0], lock: lockOf(perp) });
    expect(locked).toMatchObject({ kind: 'perpendicular', locked: true, label: '모서리에 수직' });
    close(locked.point, [10, 80, 0]);
  });
});
