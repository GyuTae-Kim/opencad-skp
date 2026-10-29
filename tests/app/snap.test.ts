import { describe, expect, it } from 'vitest';
import { computeFrame, dirToAngles, projectToScreen, type CameraState, type ViewFrame } from 'opencad-viewer3d/camera';
import { buildBvh } from 'opencad-viewer3d/bvh';
import { pickScene } from 'opencad-viewer3d/scenepick';
import type { LineSet3d, Mesh3d, Pick3d } from 'opencad-viewer3d/types';
import { PICK_TOLERANCE_PX, SNAP_PX, TOUCH_PICK_TOLERANCE_PX, pickTolerance } from 'opencad-viewer3d/pointer';
import {
  AIM_SNAP_RADIUS_PX,
  AXIS_DIRS,
  CORE_PICK_TOLERANCE_PX,
  FACE_EDGE_SIN,
  SNAP_RADIUS_PX,
  TOUCH_SNAP_RADIUS_PX,
  TRACK_ALIGN_LABEL,
  TRACK_AXIS_LABELS,
  AXIS_LABELS,
  alongAxis,
  axisInferenceLock,
  axisLock,
  axisOf,
  chooseSnap,
  directionLock,
  edgeLineLock,
  footOnLine,
  footOnPlane,
  lockOf,
  parallelInferenceLock,
  perpendicularDirs,
  probeOffsets,
  rayClosestOnSegment,
  segmentOfPick,
  triangleOfPick,
  type AxisDirs,
  type InferenceLock,
  type Snap,
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

  it('시작점을 주면 시작점을 지나는 모서리에 붙은 점 추정도 그 모서리 방향으로 잠근다(축과 나란하면 그 축)', () => {
    // e1: 원점에서 +Y, e2: 같은 직선 위 떨어진 선분, k: e1을 가로지름(원점을 지나지 않음), d: 원점에서 기운 모서리, h: 원점을 지나지 않음
    const scene: SnapScene = {
      meshes: [],
      lines: [lines('e', [[0, 0, 0, 0, 80, 0], [0, 90, 0, 0, 99, 0], [-20, 20, 0, 60, 20, 0], [0, 0, 0, -40, -30, 0], [50, -50, 0, 80, -50, 0]])],
    };
    const from = [0, 0, 0];
    const on = snapWith(scene, 101, 50, { from });
    expect(on.kind).toBe('onEdge');
    close(on.point, [0, 50, 0]);
    // 시작점을 주지 않으면 예전처럼 잠글 방향이 아니다
    expect(lockOf(on)).toBeNull();
    expect(lockOf(on, from)).toMatchObject({ kind: 'axis', axis: 'y', dir: [0, 1, 0], label: '녹색 축에' });
    // 같은 직선 위 떨어진 선분의 끝점
    const far = snapWith(scene, 100, 10, { from });
    expect(far.kind).toBe('endpoint');
    close(far.point, [0, 90, 0]);
    expect(lockOf(far, from)?.axis).toBe('y');
    // 교차점: 고른 선분이 원점을 지나지 않아도 만나는 다른 선분이 지나면
    const x = snapWith(scene, 100, 80, { from });
    expect(x.kind).toBe('intersection');
    expect(lockOf(x, from)?.axis).toBe('y');
    // 기운 모서리의 중간점 → 그 모서리와 나란히
    const mid = snapWith(scene, 80, 115, { from });
    expect(mid.kind).toBe('midpoint');
    const par = lockOf(mid, from)!;
    expect(par).toMatchObject({ kind: 'parallel', label: '모서리와 나란히' });
    close(par.dir, [-0.8, -0.6, 0]);
    expect(par.edge).toEqual([[0, 0, 0], [-40, -30, 0]]);
    // 모형의 그리기 축이 그 모서리와 나란하면 그 축, 세계 Y 모서리는 나란함
    const axes = { x: [0.8, 0.6, 0] as V3, y: [-0.6, 0.8, 0] as V3, z: [0, 0, 1] as V3 };
    expect(lockOf(mid, from, axes)).toMatchObject({ kind: 'axis', axis: 'x', dir: [0.8, 0.6, 0] });
    expect(lockOf(on, from, axes)?.kind).toBe('parallel');
    // 원점을 지나지 않는 모서리, 시작점 자리(모서리가 만나는 꼭짓점)는 잠그지 않는다
    const off = snapWith(scene, 165, 150, { from });
    expect(off.kind).toBe('midpoint');
    expect(lockOf(off, from)).toBeNull();
    const at0 = snapWith(scene, 100, 100, { from });
    expect(at0.kind).toBe('endpoint');
    expect(lockOf(at0, from)).toBeNull();
  });
});

describe('추정: 모서리 끝 방향 잠금을 코어 edgeLineLock(0.12.0)으로', () => {
  /** 15차 전 앱 판정 그대로(코어로 옮기기 전) — 옮긴 뒤 값이 같은지 견준다 */
  function before(s: Snap, from: readonly number[], axes: AxisDirs = AXIS_DIRS): InferenceLock | null {
    const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
    const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    if (s.locked || !['endpoint', 'midpoint', 'intersection', 'onEdge'].includes(s.kind)) return null;
    for (const e of [s.edge, s.other]) {
      if (!e) continue;
      const d = sub(e[1], e[0]);
      const l = Math.hypot(...d);
      if (!(l > 0)) continue;
      const u: V3 = [d[0] / l, d[1] / l, d[2] / l];
      const w = sub(from, e[0]);
      const t = dot(w, u);
      const scale = Math.max(l, Math.hypot(...w));
      if (Math.hypot(w[0] - u[0] * t, w[1] - u[1] * t, w[2] - u[2] * t) > 1e-6 * scale) continue;
      if (!(Math.hypot(...sub(s.point, from)) > 1e-9 * scale)) return null;
      const axis = (['x', 'y', 'z'] as const).find((a) => Math.abs(dot(u, axes[a])) >= 1 - 1e-6);
      return axis ? axisInferenceLock(axis, axes) : parallelInferenceLock(e);
    }
    return null;
  }

  /** 늘 같은 수열(시험이 흔들리지 않게) */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('여러 모서리·시작점·커서 점·그리기 축에서 15차 전 판정과 같다(축·나란함·잠그지 않음 모두 나온다)', () => {
    const r = rng(15);
    const f32 = (p: readonly number[]): V3 => [Math.fround(p[0]!), Math.fround(p[1]!), Math.fround(p[2]!)];
    const turned: AxisDirs = { x: [0.8, 0.6, 0], y: [-0.6, 0.8, 0], z: [0, 0, 1] };
    const counts = { axis: 0, parallel: 0, none: 0 };
    for (let i = 0; i < 4000; i++) {
      const big = r() < 0.3 ? 1e5 : 1;
      const from: V3 = [(r() - 0.5) * 200 * big, (r() - 0.5) * 200 * big, (r() - 0.5) * 50 * big];
      // 방향: 세계 축, 옮긴 그리기 축, 아무 방향
      const pick = r();
      const raw: V3 = pick < 0.25 ? [0, 0, 1] : pick < 0.45 ? [0.8, 0.6, 0] : pick < 0.55 ? [-0.6, 0.8, 0] : [r() - 0.5, r() - 0.5, r() - 0.5];
      const len = (1 + r() * 300) * big;
      const t0 = (r() - 0.5) * 4;
      // 시작점이 직선 위, 조금 떨어짐(허용치 안·밖), 멀리 떨어짐
      const off = [0, 0, 1e-9, 1e-7, 1e-5, 1e-2, 1][Math.floor(r() * 7)]! * len;
      const side = unitOf3([raw[1], -raw[0], r() - 0.5]);
      const e0: V3 = [from[0] - raw[0] * t0 * len + side[0] * off, from[1] - raw[1] * t0 * len + side[1] * off, from[2] - raw[2] * t0 * len + side[2] * off];
      const e1: V3 = [e0[0] + raw[0] * len, e0[1] + raw[1] * len, e0[2] + raw[2] * len];
      const edge: [V3, V3] = r() < 0.3 ? [f32(e0), f32(e1)] : [e0, e1];
      const kind = (['endpoint', 'midpoint', 'intersection', 'onEdge', 'onFace', 'perpendicular'] as const)[Math.floor(r() * 6)]!;
      const k = r() * 1.6 - 0.3;
      // 커서 점: 모서리 위, 시작점 그대로(꼭짓점)
      const point: V3 = r() < 0.1 ? [...from] : [edge[0][0] + (edge[1][0] - edge[0][0]) * k, edge[0][1] + (edge[1][1] - edge[0][1]) * k, edge[0][2] + (edge[1][2] - edge[0][2]) * k];
      const s: Snap = { kind, point, label: '', edge: r() < 0.15 ? [[point[0] + 1, point[1] + 2, point[2] + 3], [point[0] + 4, point[1] - 1, point[2]]] : edge };
      if (kind === 'intersection') s.other = edge;
      if (r() < 0.05) s.locked = true;
      const axes = r() < 0.5 ? AXIS_DIRS : turned;
      const want = before(s, from, axes);
      expect(edgeLineLock(s, from, axes)).toEqual(want);
      counts[want ? (want.kind as 'axis' | 'parallel') : 'none']++;
    }
    expect(counts.axis).toBeGreaterThan(200);
    expect(counts.parallel).toBeGreaterThan(200);
    expect(counts.none).toBeGreaterThan(500);
  });

  it('다른 점은 커서 점이 시작점에서 상대 1e-9~1e-6 사이일 때뿐 — 코어처럼 같은 꼭짓점으로 보고 잠그지 않는다', () => {
    const s: Snap = { kind: 'onEdge', point: [0, 5e-6, 0], label: '', edge: [[0, 0, 0], [0, 100, 0]] };
    expect(before(s, [0, 0, 0])?.axis).toBe('y');
    expect(edgeLineLock(s, [0, 0, 0])).toBeNull();
    s.point = [0, 1e-3, 0];
    expect(edgeLineLock(s, [0, 0, 0])).toEqual(before(s, [0, 0, 0]));
  });
});

/** 단위 벡터(시험 자료용) */
function unitOf3(u: readonly number[]): V3 {
  const l = Math.hypot(u[0]!, u[1]!, u[2]!);
  return [u[0]! / l, u[1]! / l, u[2]! / l];
}

describe('추정: 모서리에 수직(SketchUp 자홍 추론)', () => {
  const empty: SnapScene = { meshes: [], lines: [] };
  const at = (deg: number, r: number): [number, number] => [100 + r * Math.cos((deg * Math.PI) / 180), 100 - r * Math.sin((deg * Math.PI) / 180)];
  /** 앞서 지나간 45° 모서리(시작점과 떨어져 있다) */
  const diag: [V3, V3] = [[-90, -60, 0], [-60, -30, 0]];
  const s2 = Math.SQRT1_2;

  it('수직 방향 후보: 시작점에서 모서리 직선으로 내린 수직과 축을 수직 평면에 비친 방향(축과 나란한 것·같은 직선은 뺀다)', () => {
    // 평면도의 기운 벽: 수평으로 수직인 방향 하나(내린 수직과 같은 직선)
    const d = perpendicularDirs([0, 0, 0], diag);
    expect(d).toHaveLength(1);
    expect(Math.abs(d[0]![0] * s2 - d[0]![1] * s2)).toBeCloseTo(1, 9);
    // X축 모서리: 축을 비친 방향은 축이라 빼고, 높이가 다른 시작점에서 내린 수직만
    const x = perpendicularDirs([0, 30, 20], [[0, 0, 0], [10, 0, 0]]);
    expect(x).toHaveLength(1);
    close(x[0]!.map(Math.abs), [0, 30 / Math.hypot(30, 20), 20 / Math.hypot(30, 20)], 1e-9);
    expect(perpendicularDirs([5, 0, 0], [[0, 0, 0], [10, 0, 0]])).toEqual([]);
    // 기운 서까래(XZ 평면) 끝에서: 그 세로 평면 안의 수직 하나
    const r = perpendicularDirs([40, 0, 30], [[0, 0, 0], [40, 0, 30]]);
    expect(r).toHaveLength(1);
    close(r[0]!.map(Math.abs), [0.6, 0, 0.8], 1e-9);
    expect(perpendicularDirs([0, 0, 0], [[1, 1, 1], [1, 1, 1]])).toEqual([]);
  });

  it('시작점에서 지나간 모서리에 수직인 방향(화면 각 6° 안)이면 그 선 위 점(자홍, 기준 모서리와 방향 — 잠글 수 있다)', () => {
    const [x, y] = at(-43, 50);
    const s = snapWith(empty, x, y, { from: [0, 0, 0], parallelRef: diag });
    expect(s).toMatchObject({ kind: 'perpendicular', label: '모서리에 수직', inferred: true, edge: diag });
    expect(Math.abs(s.dir![0] * s2 - s.dir![1] * s2)).toBeCloseTo(1, 9);
    // 그 방향 선 위(커서 광선에 가장 가까운 점)
    expect(Math.abs(s.point[0] + s.point[1])).toBeLessThan(1e-9);
    expect(s.point[0]).toBeCloseTo(50 * Math.cos((2 * Math.PI) / 180) * s2, 6);
    expect(lockOf(s)).toMatchObject({ kind: 'perpendicular', label: '모서리에 수직', edge: diag });
    // 반대쪽(135°)도 같은 직선, 각이 크면 아니다
    const [bx, by] = at(136, 50);
    expect(snapWith(empty, bx, by, { from: [0, 0, 0], parallelRef: diag }).kind).toBe('perpendicular');
    const [fx, fy] = at(-25, 50);
    expect(snapWith(empty, fx, fy, { from: [0, 0, 0], parallelRef: diag }).kind).toBe('free');
    // 기준 모서리가 없으면 아니다
    expect(snapWith(empty, x, y, { from: [0, 0, 0] }).kind).toBe('free');
  });

  it('축·나란함과 함께 맞으면 화면에서 선에 가까운 쪽(같으면 축), 점 추정이 먼저', () => {
    // X축에서 4° 기운 모서리: 수직은 94° — 녹색 축(90°)과 4° 차이
    const r4 = (4 * Math.PI) / 180;
    const tilted: [V3, V3] = [[-50, -50, 0], [-50 + 40 * Math.cos(r4), -50 + 40 * Math.sin(r4), 0]];
    const [ax, ay] = at(91.5, 50);
    expect(snapWith(empty, ax, ay, { from: [0, 0, 0], parallelRef: tilted })).toMatchObject({ kind: 'axis', axis: 'y' });
    const [px, py] = at(93.5, 50);
    expect(snapWith(empty, px, py, { from: [0, 0, 0], parallelRef: tilted })).toMatchObject({ kind: 'perpendicular', inferred: true });
    // 끝점이 수직 선 근처에 있으면 끝점
    const [ex, ey] = at(-44, 50);
    const scene: SnapScene = { meshes: [], lines: [lines('p', [[ex - 100 + 2, 100 - ey, 0, 60, 90, 0]])] };
    expect(snapWith(scene, ex, ey, { from: [0, 0, 0], parallelRef: diag }).kind).toBe('endpoint');
  });
});

describe('추정: 면 위에서 그 면 안의 모서리에 수직', () => {
  // 처마(X 방향 모서리)에서 30°로 오르는 지붕 면: 눈 쪽 법선 (0, −sin30°, cos30°), 비탈을 오르는 방향 (0, cos30°, sin30°)
  const sn = Math.sin(Math.PI / 6), cs = Math.cos(Math.PI / 6);
  const eave: [V3, V3] = [[0, 0, 0], [100, 0, 0]];
  const roofN: V3 = [0, -sn, cs];
  const h = 60 * Math.tan(Math.PI / 6);
  const roof: Mesh3d = {
    id: 'roof',
    positions: Float32Array.from([0, 0, 0, 100, 0, 0, 100, 60, h, 0, 60, h]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    color: [0.8, 0.8, 0.8, 1],
  };
  // 등각(평행 투영)으로 비스듬히 본다: 위에서 보면 비탈 방향이 녹색 축과 같은 화면 방향이라 가리지 못한다
  const a = dirToAngles([1, -1, 1]);
  const iso = computeFrame({ target: [40, 20, 10], distance: 300, yaw: a.yaw, pitch: a.pitch, projection: 'orthographic', fovY: FOV }, W, W, { center: [40, 20, 10], radius: 300 });
  /** 시작점에서 비탈 방향으로 L만큼 간 점의 화면 자리(조금 비켜서) */
  const upSlope = (from: V3, L: number): [number, number] => {
    const s = projectToScreen(iso, [from[0], from[1] + cs * L, from[2] + sn * L])!;
    return [s[0] + 0.5, s[1] + 0.5];
  };

  it('수직 방향 후보: 면 법선을 주고 모서리가 그 면 위(또는 면과 나란함)면 그 면 안의 수직을 마지막에 더한다', () => {
    // 처마 위에서 시작: 내린 수직이 없고 축을 비친 방향은 축이라 빠져, 면이 없으면 후보가 없다
    expect(perpendicularDirs([10, 0, 0], eave)).toEqual([]);
    const d = perpendicularDirs([10, 0, 0], eave, AXIS_DIRS, roofN);
    expect(d).toHaveLength(1);
    close(d[0]!.map(Math.abs), [0, cs, sn], 1e-9);
    // 면과 나란한(면 밖) 모서리도 그 면 안의 수직
    expect(perpendicularDirs([10, 0, 9], [[0, 0, 9], [100, 0, 9]], AXIS_DIRS, roofN)).toHaveLength(1);
    // 모서리가 면에서 0.1° 기울면(한도 FACE_EDGE_SIN 약 0.08°) 면을 주지 않은 것과 같다
    const t = (0.1 * Math.PI) / 180;
    const tilted: [V3, V3] = [[0, 0, 0], [100 * Math.cos(t), 0, 100 * Math.sin(t)]];
    expect(Math.abs(Math.cos(Math.PI / 6) * Math.sin(t))).toBeGreaterThan(FACE_EDGE_SIN);
    expect(perpendicularDirs([10, 0, 0], tilted, AXIS_DIRS, roofN)).toEqual(perpendicularDirs([10, 0, 0], tilted));
    // 앞의 방향과 같은 직선이면 그대로(바닥 면 위의 기운 벽: 축을 비친 수평 수직과 같다)
    const diag: [V3, V3] = [[-90, -60, 0], [-60, -30, 0]];
    expect(perpendicularDirs([0, 0, 0], diag, AXIS_DIRS, [0, 0, 1])).toEqual(perpendicularDirs([0, 0, 0], diag));
    // 법선이 0이면 없는 것과 같다
    expect(perpendicularDirs([10, 0, 0], eave, AXIS_DIRS, [0, 0, 0])).toEqual([]);
  });

  it('처마 위에서 시작해 처마를 지나간 뒤 지붕 면 위에서 비탈을 따라가면 모서리에 수직(그 면 안) — 면이 아니면 그 방향은 없다', () => {
    const scene: SnapScene = { meshes: [roof], lines: [lines('eave', [[0, 0, 0, 100, 0, 0]])] };
    const from: V3 = [10, 0, 0];
    const [x, y] = upSlope(from, 40);
    const s = snapWith(scene, x, y, { f: iso, from, parallelRef: eave });
    expect(s).toMatchObject({ kind: 'perpendicular', label: '모서리에 수직', inferred: true, edge: eave });
    // 면 법선은 코어가 Float32 꼭짓점으로 잰다
    close(s.dir!.map(Math.abs), [0, cs, sn], 1e-6);
    // 그 선 위 점(시작점을 지나 비탈 방향)
    const w = [s.point[0] - from[0], s.point[1] - from[1], s.point[2] - from[2]];
    expect(Math.abs(w[0])).toBeLessThan(1e-6);
    expect(Math.abs(w[1] * sn - w[2] * cs)).toBeLessThan(1e-6);
    expect(Math.hypot(...w)).toBeCloseTo(40, 0);
    // 잠그면 "모서리에 수직"(↓·Shift·단추가 그 방향을 잠근다)
    expect(lockOf(s)).toMatchObject({ kind: 'perpendicular', label: '모서리에 수직', edge: eave });
    // 지나간 모서리가 없거나, 커서 밑이 면이 아니면(같은 자리의 빈 곳) 전처럼 면 위·빈 곳
    expect(snapWith(scene, x, y, { f: iso, from }).kind).toBe('onFace');
    expect(snapWith({ meshes: [], lines: scene.lines }, x, y, { f: iso, from, parallelRef: eave }).kind).toBe('free');
  });
});

describe('추정: 안내점·안내선(누르면 고를 안내)', () => {
  it('안내점은 끝점처럼, 안내선은 모서리 위처럼 붙고 그 안내의 차례를 함께 준다(모서리 끝점·교차점은 안내가 아니다)', () => {
    const scene: SnapScene = { meshes: [], lines: [lines('e', [[0, 0, 0, 100, 0, 0]])] };
    const base = { frame: topFrame, probes: [], scene, anchor: [0, 0, 0] as V3, guides: [[-50, 30, 0], [20, 40, 0]] as V3[], guideLines: [{ point: [0, -40, 0] as V3, dir: [1, 0, 0] as V3 }] };
    const pick = picker(scene);
    const p = chooseSnap({ ...base, x: 121, y: 61, pick: pick(121, 61) });
    expect(p).toMatchObject({ kind: 'endpoint', label: '안내점', guide: { kind: 'point', index: 1 } });
    const l = chooseSnap({ ...base, x: 30, y: 141, pick: pick(30, 141) });
    expect(l).toMatchObject({ kind: 'onEdge', label: '안내선에', guide: { kind: 'line', index: 0 } });
    const e = chooseSnap({ ...base, x: 101, y: 101, pick: pick(101, 101) });
    expect(e.kind).toBe('endpoint');
    expect(e.guide).toBeUndefined();
  });
});

describe('추정: 다른 점에서 끌어온 축(코어 0.16.0 trackCrossSnap·trackAxisSnap)', () => {
  // 넓은 면(z = 0) 위에 모서리 하나(끝점 P = (40, 30, 0), 화면 140, 70 — 위로 60)
  const P: V3 = [40, 30, 0];
  const scene: SnapScene = { meshes: [quad('f', -95, -95, 95, 95, 0)], lines: [lines('e', [[40, 30, 0, 40, 90, 0]])] };
  const pick = picker(scene);
  const at = (x: number, y: number, o: { from?: V3 | null; tracks?: V3[] | null; lock?: InferenceLock | null; axisDirs?: AxisDirs | null; radius?: number } = {}): Snap => {
    const radius = o.radius ?? SNAP_RADIUS_PX;
    const probes = probeOffsets(radius).map(([dx, dy]) => pick(x + dx, y + dy));
    return chooseSnap({ frame: topFrame, x, y, pick: pick(x, y), probes, scene, radius, from: o.from ?? null, anchor: [0, 0, 0], lock: o.lock ?? null, tracks: o.tracks ?? null, axisDirs: o.axisDirs ?? null });
  };

  it('시작점 전: 면 위 대신 끌어온 점을 지나는 축 위 점(방향이 없어 잠그지 않는다)', () => {
    expect(at(170.4, 72.7).kind).toBe('onFace');
    const s = at(170.4, 72.7, { tracks: [P] });
    expect(s).toMatchObject({ kind: 'axis', axis: 'x', label: TRACK_AXIS_LABELS.x, trackFrom: P });
    close(s.point, [70.4, 30, 0], 1e-6);
    expect(s.dir).toBeUndefined();
    expect(lockOf(s, null)).toBeNull();
    // 녹색 축(P에서 아래로 — 위는 모서리가 맡는다)
    const g = at(142.6, 120.3, { tracks: [P] });
    expect(g).toMatchObject({ kind: 'axis', axis: 'y', label: TRACK_AXIS_LABELS.y });
    close(g.point, [40, -20.3, 0], 1e-6);
    // 추정 반경 밖이면 그대로 면 위, 끌어온 점 둘레(점 추정이 맡는다)는 끝점
    expect(at(170.4, 84.2, { tracks: [P] }).kind).toBe('onFace');
    expect(at(141.3, 71.2, { tracks: [P] }).kind).toBe('endpoint');
  });

  it('시작점이 있으면 시작점 축 위에서 끌어온 점과 줄 맞춘 자리가 축 고정보다 먼저(잠글 수 있다)', () => {
    const A: V3 = [0, -40, 0];
    // 시작점 빨강 축 위 x = 40 둘레: 끌어온 점이 없으면 축 고정(커서 광선에 가까운 자리)
    const plain = at(140.6, 137.2, { from: A });
    expect(plain).toMatchObject({ kind: 'axis', axis: 'x', label: AXIS_LABELS.x });
    expect(plain.point[0]).toBeCloseTo(40.6, 6);
    expect(plain.trackFrom).toBeUndefined();
    const s = at(140.6, 137.2, { from: A, tracks: [P] });
    expect(s).toMatchObject({ kind: 'axis', axis: 'x', label: `${AXIS_LABELS.x} · ${TRACK_ALIGN_LABEL}`, trackFrom: P, dir: [1, 0, 0] });
    close(s.point, [40, -40, 0], 1e-9);
    expect(lockOf(s, A)).toMatchObject({ kind: 'axis', axis: 'x', label: AXIS_LABELS.x, dir: [1, 0, 0] });
    // 줄 맞춘 자리에서 멀면(추정 반경 밖) 축 고정
    const far = at(170.4, 138.1, { from: A, tracks: [P] });
    expect(far).toMatchObject({ kind: 'axis', axis: 'x', label: AXIS_LABELS.x });
    expect(far.trackFrom).toBeUndefined();
    // 축 고정이 맞지 않는 자리: 끌어온 점을 지나는 녹색 축(시작점에서 그 축 방향이 아니다)
    const t = at(142.3, 92.6, { from: A, tracks: [P] });
    expect(t).toMatchObject({ kind: 'axis', axis: 'y', label: TRACK_AXIS_LABELS.y, trackFrom: P });
    expect(t.dir).toBeUndefined();
    close(t.point, [40, 7.4, 0], 1e-6);
  });

  it('잠근 동안·점 추정·끌어온 점이 시작점이면 끌어온 축을 보지 않는다', () => {
    const A: V3 = [0, -40, 0];
    const lock = axisInferenceLock('y');
    const l = at(170.4, 72.7, { from: A, tracks: [P], lock });
    expect(l).toMatchObject({ kind: 'axis', axis: 'y', locked: true });
    expect(l.trackFrom).toBeUndefined();
    // 모서리 위(선 추정)가 먼저
    expect(at(140.8, 55.2, { tracks: [P] }).kind).toBe('onEdge');
    // 시작점과 같은 끌어온 점: 줄 맞춘 자리도 그 점의 축도 없다(시작점 축 고정이 맡는다)
    const same = at(170.4, 72.7, { from: P, tracks: [P] });
    expect(same).toMatchObject({ kind: 'axis', axis: 'x', label: AXIS_LABELS.x });
    expect(same.trackFrom).toBeUndefined();
  });

  it('모형의 그리기 축을 옮겼으면 그 축으로 끌어온다', () => {
    const c = Math.cos(Math.PI / 6), sn = Math.sin(Math.PI / 6);
    const axes: AxisDirs = { x: [c, sn, 0], y: [-sn, c, 0], z: [0, 0, 1] };
    // P에서 옮긴 빨강 축으로 40 간 자리 둘레(화면에서 2화소 비낌)
    const q: V3 = [P[0] + 40 * c, P[1] + 40 * sn, 0];
    const s = at(100 + q[0] + 1.3, 100 - q[1] + 1.1, { tracks: [P], axisDirs: axes });
    expect(s).toMatchObject({ kind: 'axis', axis: 'x', trackFrom: P });
    const w = [s.point[0] - P[0], s.point[1] - P[1]];
    expect(Math.abs(w[0] * sn - w[1] * c)).toBeLessThan(1e-6);
    // 세계 축이면 같은 자리는 끌어온 축 밖(면 위)
    expect(at(100 + q[0] + 1.3, 100 - q[1] + 1.1, { tracks: [P] }).kind).toBe('onFace');
  });

  it('끌어온 점이 없으면(빈 배열·null) 추정이 예전과 같다', () => {
    const A: V3 = [0, -40, 0];
    for (const from of [null, A])
      for (let x = 12.3; x < 200; x += 17.9)
        for (let y = 9.7; y < 200; y += 19.3) {
          const base = at(x, y, { from });
          expect(at(x, y, { from, tracks: [] }), `${x},${y}`).toEqual(base);
          expect(base.trackFrom).toBeUndefined();
        }
  });
});
