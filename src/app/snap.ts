/**
 * 측정 도구의 추정(스냅, 순수 함수): 커서 둘레에서 SketchUp처럼 붙을 점을 고른다.
 *
 * - 차례: 끝점(초록 원)·호의 중심(초록 원) → 중간점(청록 원) → 교차점(빨강 ×, 커서 둘레 두 모서리가 3D에서 만나는 점)
 *   → 수직(자홍, 시작점에서 모서리에 내린 발) → 모서리 위(빨강 사각형)
 *   → 그물 삼각형 꼭짓점(끝점) → 면에 수직(자홍, 시작점에서 커서 밑 면 평면에 내린 발) → 면 위(파랑 마름모).
 *   같은 차례면 커서에 가까운 것. 추정 반경은 화면 10화소(터치는 넓게).
 * - 호·원의 중심: 커서 밑(둘레 포함) 곡선 선분의 중심(부른 쪽이 curveCenter로 잰다)과, 앞서 지나간 곡선의 중심(centers —
 *   SketchUp처럼 호를 한 번 훑고 가운데로 가면 붙는다).
 * - 교차점(SketchUp "교차점" 추정): 커서·둘레에서 고른 선분 두 개가 3D에서 만나는 곳(두 선분 모두 안쪽 — 끝에서 만나는 꺾인 곳·T자는 끝점이 맡는다).
 *   다른 그룹의 모서리끼리, 보조선과 모서리처럼 SketchUp이 나누지 않은 교차를 잡는다. 화면에서만 엇갈리는 선분(깊이가 다름)은 잡지 않는다.
 *   계산은 코어 0.9.0 순수 함수 segmentIntersection(허용치는 그 자리 반 화소의 세계 길이)을 쓴다.
 * - 측정값 칸으로 둔 안내점은 끝점처럼, 안내선(끝이 없는 직선)은 모서리 위처럼 붙고 안내선이 모서리·다른 안내선과 만나는 곳은 교차점이다
 *   (SketchUp 안내선 추정).
 * - 수직: 시작점(from)이 있을 때만 — 모서리 직선에 내린 발이 선분 안이면, 면은 커서 밑 면의 평면에 내린 발(벽과 벽 사이 거리).
 * - 시작점(from)이 있고 결과가 면 위·빈 곳이면, 커서가 시작점에서 축 방향(화면 각 6° 안)으로 가면 그 축 위로 고정한다
 *   (빨강 X · 초록 Y · 파랑 Z).
 * - 나란함(SketchUp "모서리와 나란히", 자홍): 축과 같은 자리에서, 커서가 앞서 지나간 모서리(parallelRef)와 나란한 방향(화면 각 6° 안)이면
 *   시작점을 지나 그 모서리와 나란한 선 위로. 축과 함께 맞으면 화면에서 선에 가까운 쪽(같으면 축), 모서리가 축과 나란하면 축에 맡긴다.
 * - 잠금(SketchUp 추론 잠금 — Shift·화살표, 손가락 기기는 측정 띠 단추): 방향 추론(축·나란함·수직)을 잠그면(lock) 시작점을 지나는
 *   그 선 위에만 찍는다. 시작점을 지나는 모서리에 붙은 점 추정(모서리 끝에서 그 모서리를 따라 가리킬 때)도 그 모서리 방향으로 잠근다. 커서가 끝점·중간점·중심·교차점·수직 같은 점 위면 그 점을 선에 수직으로 내린 자리(다른 점의 높이를 옮겨 잰다),
 *   아니면 커서 광선에 가장 가까운 선 위 점(코어 0.10.0 순수 함수 lockedSnap).
 * - 아무것도 없으면 시작점(없으면 anchor)을 지나 화면과 나란한 평면 위의 빈 점(free).
 *
 * 고르기 결과(Pick3d)는 코어 viewer.pick이 준다. 숨긴 항목·묶음(isVisible false)·숨긴 구간·단면에서 잘린 쪽은
 * 코어가 이미 거르고, 음영 모드면 불투명 면 뒤의 선도 거른다. 코어는 선을 면보다 앞세우지만 허용 거리가 6화소라
 * 그보다 멀고 추정 반경 안인 선은 못 잡으므로, 커서 둘레 몇 점(probeOffsets)을 더 고른 결과(probes)를 함께 받는다.
 * 선분 끝점은 단면 잘린 쪽이면(kept) 버리고, 다른 형상 뒤에 가린 점은 부른 쪽 판정(visible)으로 버린다.
 */
import type { LineSet3d, Mesh3d, Pick3d } from 'opencad-viewer3d/types';
import { projectToScreen, screenRay, viewDepth, worldPerPixel, type ViewFrame } from 'opencad-viewer3d/camera';
import type { V3 } from 'opencad-viewer3d/math';
import { PICK_TOLERANCE_PX } from 'opencad-viewer3d/pointer';
import { lockedSnap, segmentIntersection } from 'opencad-viewer3d/inference';

/**
 * 그물 정점 → 세계 점: 묶음 원점(origin)을 더한 뒤 배치 행렬(matrix, 4×4 열 우선)을 곱한다(코어 math의 modelMatrix·transformPoint와 같은 계산).
 * 코어 math 모듈의 값을 직접 가져오면 개발 서버가 그 경로를 따로 미리 묶다가 TypeScript를 읽지 못해 멈춰서, 여기서 다시 쓴다.
 */
function placePoint(matrix: ArrayLike<number> | undefined, origin: readonly number[] | undefined, p: V3): V3 {
  const x = p[0] + (origin?.[0] ?? 0);
  const y = p[1] + (origin?.[1] ?? 0);
  const z = p[2] + (origin?.[2] ?? 0);
  if (!matrix) return [x, y, z];
  const m = matrix;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const iw = w !== 0 ? 1 / w : 1;
  return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * iw, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * iw, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * iw];
}

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'onEdge' | 'onFace' | 'axis' | 'parallel' | 'free';
export type Axis = 'x' | 'y' | 'z';

/** 추정 결과(좌표는 세계 = 장면 단위) */
export interface Snap {
  kind: SnapKind;
  point: V3;
  /** 끝점·중간점·모서리 위: 그 선분(세계). 나란함: 기준 모서리 */
  edge?: [V3, V3];
  /** 교차점: 만나는 다른 선분(세계) */
  other?: [V3, V3];
  /** 커서 밑이 면이면 그 면의 세계 법선(눈 쪽) — 각도기 평면에 쓴다 */
  normal?: V3;
  /** 축 고정이면 그 축 */
  axis?: Axis;
  /** 툴팁 글(빈 곳은 '') */
  label: string;
  /** 붙은 선분 묶음·그물 id */
  id?: string;
  /** 단면 보기에서 잘린 면(채운 면) 위 */
  section?: boolean;
  /** 방향 추론(축·나란함·시작점에서 내린 수직)이면 시작점에서 그 선의 단위 방향(세계) — 잠글 수 있다 */
  dir?: V3;
  /** 잠근 방향 위 점 */
  locked?: boolean;
  /** 잠근 선으로 옮겨 온 점(커서 밑 끝점 등)과 그 종류 */
  from?: V3;
  fromKind?: SnapKind;
}

/** 방향 추론 잠금(시작점을 지나는 선): 종류·단위 방향과 축·기준 모서리, 그 선 위 점의 추정 글 */
export interface InferenceLock {
  kind: 'axis' | 'parallel' | 'perpendicular';
  dir: V3;
  axis?: Axis;
  edge?: [V3, V3];
  label: string;
}

/** 추정이 읽는 장면 자료 */
export interface SnapScene {
  meshes: readonly Mesh3d[];
  lines: readonly LineSet3d[];
}

/** 측정값 칸으로 찍은 안내점에 붙는 추정 글(끝점처럼 붙는다 — SketchUp "안내점") */
export const GUIDE_POINT_LABEL = '안내점';

/** 측정값 칸으로 둔 안내선에 붙는 추정 글(모서리 위처럼 붙는다 — SketchUp "안내선에") */
export const GUIDE_LINE_LABEL = '안내선에';

/** 안내선(끝이 없는 직선): 지나는 점과 단위 방향(세계) */
export interface GuideLine {
  point: V3;
  dir: V3;
}

/** 면에 수직 추정 글(모서리에 수직은 SNAP_LABELS.perpendicular) */
export const FACE_PERPENDICULAR_LABEL = '면에 수직';

/** 추정 반경(화면 화소) — 코어가 측정 점을 끝점에 붙잡는 거리(SNAP_PX)와 같다 */
export const SNAP_RADIUS_PX = 10;
/**
 * 터치 추정 반경(손가락이 가리므로 넓게). 코어의 터치 누르기 허용 거리(TOUCH_PICK_TOLERANCE_PX 14, 붙잡기 14)보다 넓어,
 * 코어가 터치로 고를 선·끝점은 이 도구도 모두 후보로 본다
 */
export const TOUCH_SNAP_RADIUS_PX = 22;
/** 정밀 조준(길게 눌러 십자선을 보며 옮기기) 추정 반경: 보면서 맞추므로 마우스보다 넓게(코어 터치 허용 거리와 같다) */
export const AIM_SNAP_RADIUS_PX = 14;
/**
 * 가운데·둘레 고르기에 쓰는 코어 허용 거리: 포인터 종류 없이 부른 viewer.pick(x, y)의 마우스 값(PICK_TOLERANCE_PX 6).
 * 터치에서도 가운데는 이 좁은 값으로 골라 손가락 밑 면(각도기 평면 법선)을 지키고, 둘레 고르기로 추정 반경 안의 선을 찾는다
 * (터치 허용 거리 14로 고르면 14화소 안의 모서리가 손가락 밑 면을 덮는다)
 */
export const CORE_PICK_TOLERANCE_PX = PICK_TOLERANCE_PX;
/** 축 고정 화면 각(도) */
export const AXIS_LOCK_DEG = 6;
/** 시작점에서 이만큼(화소) 떨어져야 축 고정을 본다(가까우면 각이 흔들린다) */
export const AXIS_LOCK_MIN_PX = 12;
/** 교차점을 볼 선분 수 상한(커서·둘레에서 고른 서로 다른 선분 — 짝은 이것의 제곱 반) */
export const MAX_INTERSECTION_SEGMENTS = 16;

export const SNAP_LABELS: Readonly<Record<SnapKind, string>> = Object.freeze({
  endpoint: '끝점',
  midpoint: '중간점',
  center: '중심',
  intersection: '교차점',
  perpendicular: '모서리에 수직',
  onEdge: '모서리에',
  onFace: '면에',
  axis: '',
  parallel: '모서리와 나란히',
  free: '',
});
export const AXIS_LABELS: Readonly<Record<Axis, string>> = Object.freeze({ x: '빨강 축에', y: '녹색 축에', z: '파랑 축에' });
/** 추정 표식 색(SketchUp: 끝점 초록, 중간점 청록, 교차점·모서리 빨강, 면 파랑, 수직·나란함 자홍) */
export const SNAP_COLORS: Readonly<Record<SnapKind, string>> = Object.freeze({
  endpoint: '#00a000',
  midpoint: '#00b4b4',
  center: '#00a000',
  intersection: '#dc0000',
  perpendicular: '#c800c8',
  onEdge: '#dc0000',
  onFace: '#1e46dc',
  axis: '#808080',
  parallel: '#c800c8',
  free: '#808080',
});
/** 잠그면 그 선 위로 옮겨 오는 점 추정(끝점·중간점·중심·교차점·수직) — 모서리 위·면 위·빈 곳은 커서 광선에 가까운 선 위 점 */
const POINT_KINDS: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'center', 'intersection', 'perpendicular']);
/** 축 색(빨강 X · 초록 Y · 파랑 Z) */
export const AXIS_COLORS: Readonly<Record<Axis, string>> = Object.freeze({ x: '#d42020', y: '#1a9e33', z: '#2050dc' });
export const AXIS_DIRS: Readonly<Record<Axis, V3>> = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
const AXES: readonly Axis[] = ['x', 'y', 'z'];

export type Ray = { origin: V3; dir: V3 };

// ───────────────────────── 장면 자료 읽기 ─────────────────────────

const itemIndex = new WeakMap<object, Map<string, Mesh3d | LineSet3d>>();

/** 장면에서 id로 그물·선분 묶음 찾기(장면마다 한 번 목록을 만든다) */
function itemOf(scene: SnapScene, kind: 'm' | 'l', id: string): Mesh3d | LineSet3d | undefined {
  let map = itemIndex.get(scene);
  if (!map) {
    map = new Map();
    for (const m of scene.meshes) map.set(`m:${m.id}`, m);
    for (const l of scene.lines) map.set(`l:${l.id}`, l);
    itemIndex.set(scene, map);
  }
  return map.get(`${kind}:${id}`);
}

/** 선 고르기 → 그 선분의 두 끝(세계). 선이 아니거나 못 찾으면 null */
export function segmentOfPick(scene: SnapScene, pick: Pick3d): [V3, V3] | null {
  if (pick.kind !== 'line') return null;
  const l = itemOf(scene, 'l', pick.id) as LineSet3d | undefined;
  if (!l) return null;
  const i = pick.raw ?? pick.index;
  const P = l.positions;
  const k = i * 6;
  if (!(i >= 0) || k + 6 > P.length) return null;
  const o = l.origin;
  const ox = o ? o[0] : 0, oy = o ? o[1] : 0, oz = o ? o[2] : 0;
  return [
    [P[k]! + ox, P[k + 1]! + oy, P[k + 2]! + oz],
    [P[k + 3]! + ox, P[k + 4]! + oy, P[k + 5]! + oz],
  ];
}

/**
 * 그물 고르기 → 맞은 삼각형의 세 꼭짓점(세계). 단면 채운 면이거나 못 찾으면 null.
 * 카메라를 마주 보는 그물(billboard)은 코어가 프레임마다 돌려 그리므로 저장된 꼭짓점이 화면 자리와 달라 null(면 위로만 붙는다)
 */
export function triangleOfPick(scene: SnapScene, pick: Pick3d): [V3, V3, V3] | null {
  if (pick.kind !== 'mesh' || pick.section) return null;
  const m = itemOf(scene, 'm', pick.id) as Mesh3d | undefined;
  if (!m || m.billboard) return null;
  const t = pick.raw ?? pick.index;
  const I = m.indices;
  const P = m.positions;
  const n = I ? I.length / 3 : P.length / 9;
  if (!(t >= 0) || t >= n) return null;
  const corner = (c: number): V3 | null => {
    const v = I ? I[t * 3 + c]! : t * 3 + c;
    if (v * 3 + 3 > P.length) return null;
    const p: V3 = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
    return placePoint(m.matrix, m.origin, p);
  };
  const a = corner(0), b = corner(1), c = corner(2);
  return a && b && c ? [a, b, c] : null;
}

// ───────────────────────── 기하 ─────────────────────────

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const along = (p: readonly number[], u: readonly number[], s: number): V3 => [p[0]! + u[0]! * s, p[1]! + u[1]! * s, p[2]! + u[2]! * s];

/** 직선 p + s·u 위에서 광선(직선으로 본다)에 가장 가까운 점의 s. 나란하면 null */
function lineRayParam(ray: Ray, p: readonly number[], u: readonly number[]): number | null {
  const d = ray.dir;
  const w = sub(p, ray.origin);
  const a = dot(u, u), b = dot(u, d), c = dot(d, d);
  const denom = a * c - b * b;
  if (!(Math.abs(denom) > 1e-12 * a * c)) return null;
  return (b * dot(d, w) - c * dot(u, w)) / denom;
}

/** 직선(p, u) 위에서 광선에 가장 가까운 점(나란하면 null) */
export function closestOnLine(ray: Ray, p: readonly number[], u: readonly number[]): V3 | null {
  const s = lineRayParam(ray, p, u);
  return s === null ? null : along(p, u, s);
}

/** 선분 a-b 위에서 광선에 가장 가까운 점 */
export function rayClosestOnSegment(ray: Ray, a: readonly number[], b: readonly number[]): V3 {
  const u = sub(b, a);
  const uu = dot(u, u);
  if (!(uu > 0)) return [a[0]!, a[1]!, a[2]!];
  const s = lineRayParam(ray, a, u) ?? dot(sub(ray.origin, a), u) / uu;
  return along(a, u, Math.min(1, Math.max(0, s)));
}

/** 광선과 평면(점 p0, 법선 n)의 교점. 나란하면 null */
export function rayPlane(ray: Ray, p0: readonly number[], n: readonly number[]): V3 | null {
  const k = dot(n, ray.dir);
  if (!(Math.abs(k) > 1e-12)) return null;
  return along(ray.origin, ray.dir, dot(n, sub(p0, ray.origin)) / k);
}

/** 빈 곳: anchor를 지나 화면과 나란한 평면 위 커서 점(anchor가 없으면 보기 깊이 가운데) */
export function freePoint(f: ViewFrame, ray: Ray, anchor: readonly number[] | null | undefined): V3 {
  const a = anchor ?? along(f.eye, f.basis.back, -(f.near + f.far) / 2);
  return rayPlane(ray, a, f.basis.back) ?? [a[0]!, a[1]!, a[2]!];
}

// ───────────────────────── 축 고정 ─────────────────────────

export interface AxisLock {
  axis: Axis;
  point: V3;
  /** 커서와 축 화면 선 사이 거리(화소) */
  perp: number;
}

/** 축 방향 모음(모형의 그리기 축을 옮겼으면 그 축, 아니면 AXIS_DIRS) */
export type AxisDirs = Readonly<Record<Axis, V3>>;

/** 방향 고정 선택: 화면 각 한도(도)·시작점에서 떨어질 거리(화소) */
export interface DirectionLockOptions {
  maxDeg?: number;
  minPx?: number;
}

/**
 * 시작점 from을 지나는 방향 u의 선: 커서가 그 방향(화면에 비친 선과 각 maxDeg 안)이면 그 선 위에서 커서 광선에 가장 가까운 점과
 * 커서와 화면 선 사이 거리(화소). 커서가 시작점에서 minPx보다 가깝거나, 선이 거의 눈 방향이거나, 점이 화면에 비치지 않으면 null.
 * 축 고정(axisLock)과 나란함이 함께 쓴다
 */
export function directionLock(f: ViewFrame, from: readonly number[], x: number, y: number, u: readonly number[], o: DirectionLockOptions = {}): { point: V3; perp: number } | null {
  const s0 = projectToScreen(f, from);
  if (!s0) return null;
  const cx = x - s0[0], cy = y - s0[1];
  const cl = Math.hypot(cx, cy);
  if (!(cl >= (o.minPx ?? AXIS_LOCK_MIN_PX))) return null;
  // 선 끝은 화면에서 50화소쯤 되는 길이로 잡는다(원근에서 눈 뒤로 넘어가지 않게)
  const len = worldPerPixel(f, Math.max(viewDepth(f, from), 0)) * 50 || 1;
  const s1 = projectToScreen(f, along(from, u, len));
  if (!s1) return null;
  const ax = s1[0] - s0[0], ay = s1[1] - s0[1];
  const al = Math.hypot(ax, ay);
  // 거의 눈 방향인 선은 화면 방향이 흔들려 고정하지 않는다
  if (!(al >= 1)) return null;
  const cos = Math.abs(ax * cx + ay * cy) / (al * cl);
  if (cos < Math.cos(((o.maxDeg ?? AXIS_LOCK_DEG) * Math.PI) / 180)) return null;
  const point = closestOnLine(screenRay(f, x, y), from, u);
  if (!point || !projectToScreen(f, point)) return null;
  return { point, perp: Math.sqrt(Math.max(0, 1 - cos * cos)) * cl };
}

/**
 * 시작점 from에서 커서가 축 방향(화면에 비친 축 선과 각 maxDeg 안)이면 그 축 위에서 커서 광선에 가장 가까운 점.
 * 여러 축이 맞으면 화면에서 축 선에 가장 가까운 것. 커서가 시작점에서 minPx보다 가까우면 null.
 */
export function axisLock(f: ViewFrame, from: readonly number[], x: number, y: number, o: DirectionLockOptions & { axes?: AxisDirs | null } = {}): AxisLock | null {
  let best: AxisLock | null = null;
  for (const axis of AXES) {
    const l = directionLock(f, from, x, y, (o.axes ?? AXIS_DIRS)[axis], o);
    if (l && (!best || l.perp < best.perp)) best = { axis, ...l };
  }
  return best;
}

/** 방향 u가 축 가운데 하나와 나란한지(사잇각 약 0.08° 안 — 그 선은 축 고정이 맡는다) */
export function alongAxis(u: readonly number[], axes: AxisDirs = AXIS_DIRS): boolean {
  const l = Math.hypot(u[0]!, u[1]!, u[2]!);
  return l > 0 && AXES.some((a) => Math.abs(dot(u, axes[a])) / l >= 1 - 1e-6);
}

/** 단위 벡터(길이가 0이거나 수가 아니면 null) */
function unitOf(u: readonly number[]): V3 | null {
  const l = Math.hypot(u[0]!, u[1]!, u[2]!);
  return l > 0 && Number.isFinite(l) ? [u[0]! / l, u[1]! / l, u[2]! / l] : null;
}

/** 축 잠금(화살표 키 → ←·↑, 측정 띠 단추): 모형의 그리기 축이면 그 축 방향 */
export function axisInferenceLock(axis: Axis, axes: AxisDirs = AXIS_DIRS): InferenceLock {
  const d = axes[axis];
  return { kind: 'axis', axis, dir: [d[0], d[1], d[2]], label: AXIS_LABELS[axis] };
}

/** 나란함 잠금(↓): 기준 모서리와 나란한 방향. 모서리 길이가 0이면 null */
export function parallelInferenceLock(edge: readonly [readonly number[], readonly number[]]): InferenceLock | null {
  const dir = unitOf(sub(edge[1], edge[0]));
  return dir ? { kind: 'parallel', dir, edge: [[edge[0][0]!, edge[0][1]!, edge[0][2]!], [edge[1][0]!, edge[1][1]!, edge[1][2]!]], label: SNAP_LABELS.parallel } : null;
}

/**
 * 추정이 방향 추론(축·나란함·시작점에서 내린 수직)이면 잠글 선, 아니면 null(이미 잠근 추정도 그 선).
 * 시작점(from)을 주면 모서리에 붙은 점 추정도 그 모서리 직선이 시작점을 지날 때 잠근다(edgeLineLock)
 */
export function lockOf(s: Snap | null | undefined, from?: readonly number[] | null, axes: AxisDirs = AXIS_DIRS): InferenceLock | null {
  if (!s) return null;
  if (!s.dir || (s.kind !== 'axis' && s.kind !== 'parallel' && s.kind !== 'perpendicular')) return from ? edgeLineLock(s, from, axes) : null;
  const l: InferenceLock = { kind: s.kind, dir: [s.dir[0], s.dir[1], s.dir[2]], label: s.kind === 'axis' && s.axis ? AXIS_LABELS[s.axis] : s.label };
  if (s.axis) l.axis = s.axis;
  if (s.edge) l.edge = [s.edge[0], s.edge[1]];
  return l;
}

/** 모서리에 붙은 점 추정(그 모서리 직선 위의 점) */
const EDGE_POINT_KINDS: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'intersection', 'onEdge']);

/**
 * 모서리에 붙은 점 추정(끝점·중간점·교차점·모서리 위)의 모서리 직선이 시작점을 지나면 그 방향 잠금, 아니면 null.
 * 축과 나란한 모서리면 그 축(alongAxis와 같은 허용치), 아니면 그 모서리와 나란히.
 * 모서리 끝에서 시작해 그 모서리를 따라 가리키면 점 추정(모서리 위)이 축 추정보다 먼저라 잠글 방향 추론이 없었다 — SketchUp은
 * 모서리 추정을 잠그면 그 직선 위에 두므로, 시작점을 지나는 모서리면 이 방향 잠금과 같다. 커서 점이 시작점 자리면(모서리가 여럿
 * 만나는 꼭짓점) 어느 모서리인지 모르니 잠그지 않는다
 */
export function edgeLineLock(s: Snap, from: readonly number[], axes: AxisDirs = AXIS_DIRS): InferenceLock | null {
  if (s.locked || !EDGE_POINT_KINDS.has(s.kind)) return null;
  for (const e of [s.edge, s.other]) {
    if (!e) continue;
    const d = sub(e[1], e[0]);
    const u = unitOf(d);
    if (!u) continue;
    const w = sub(from, e[0]);
    const t = dot(w, u);
    // 시작점에서 모서리 직선까지 거리(모서리 길이·시작점 거리에 견준 허용치 — 같은 직선 위 다른 선분도 된다)
    const scale = Math.max(Math.hypot(d[0], d[1], d[2]), Math.hypot(w[0], w[1], w[2]));
    if (Math.hypot(w[0] - u[0] * t, w[1] - u[1] * t, w[2] - u[2] * t) > 1e-6 * scale) continue;
    const p = sub(s.point, from);
    if (!(Math.hypot(p[0], p[1], p[2]) > 1e-9 * scale)) return null;
    const axis = AXES.find((a) => Math.abs(dot(u, axes[a])) >= 1 - 1e-6);
    return axis ? axisInferenceLock(axis, axes) : parallelInferenceLock(e);
  }
  return null;
}

// ───────────────────────── 둘레 고르기 ─────────────────────────

/**
 * 커서 둘레에서 더 고를 점(화면 어긋남). 코어 고르기 허용 거리(tol)보다 먼 추정 반경 안의 선을 찾으려고
 * 반지름 radius − tol/2인 둘레에 tol 간격쯤으로 둔다(최대 max개). 반경이 허용 거리 안이면 빈 목록.
 */
export function probeOffsets(radius: number, tol = CORE_PICK_TOLERANCE_PX, max = 12): [number, number][] {
  if (!(radius > tol) || !(tol > 0)) return [];
  const rho = radius - tol / 2;
  const n = Math.min(max, Math.max(4, Math.ceil((2 * Math.PI * rho) / tol)));
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * 2 * Math.PI;
    out.push([rho * Math.cos(t), rho * Math.sin(t)]);
  }
  return out;
}

// ───────────────────────── 추정 고르기 ─────────────────────────

export interface SnapInput {
  frame: ViewFrame;
  /** 커서(캔버스 기준 CSS 화소) */
  x: number;
  y: number;
  /** 커서에서 코어 고르기 결과 */
  pick: Pick3d | null;
  /** 커서 둘레에서 더 고른 결과(선만 본다) */
  probes?: readonly (Pick3d | null)[];
  scene: SnapScene | null;
  /** 추정 반경(화소, 기본 10) */
  radius?: number;
  /** 시작점(축 고정·빈 점 평면) */
  from?: readonly number[] | null;
  /** 시작점이 없을 때 빈 점 평면이 지나는 점(보통 카메라 대상점) */
  anchor?: readonly number[] | null;
  /** 단면에서 남는 쪽인지(없으면 모두 남음) */
  kept?: ((p: V3) => boolean) | null;
  /** 점이 가리지 않고 보이는지(없으면 모두 보임). 고를 후보마다 부르므로 부른 쪽이 비용 한도를 둔다 */
  visible?: ((p: V3) => boolean) | null;
  /** 축 고정을 볼지(기본 true) */
  axes?: boolean;
  /** 선 고르기 → 그 선분이 든 호·원의 중심(세계, 곡선이 아니거나 한 원 위가 아니면 null) */
  curveCenter?: ((pick: Pick3d) => V3 | null) | null;
  /** 앞서 지나간 곡선의 중심(세계) — 커서가 그 가까이 오면 붙는다 */
  centers?: readonly V3[];
  /** 축 고정에 쓸 축(모형의 그리기 축, 없으면 세계 축) */
  axisDirs?: AxisDirs | null;
  /** 측정값 칸으로 찍은 안내점(세계) — 끝점처럼 붙는다 */
  guides?: readonly V3[];
  /** 측정값 칸으로 둔 안내선(세계) — 모서리 위처럼 붙고, 모서리·다른 안내선과 만나는 곳은 교차점 */
  guideLines?: readonly GuideLine[];
  /** 커서가 앞서 지나간 모서리(나란함의 기준, 세계) */
  parallelRef?: readonly [V3, V3] | null;
  /** 잠근 방향 추론(시작점이 있을 때만 쓴다) */
  lock?: InferenceLock | null;
}

interface Cand {
  kind: 'endpoint' | 'midpoint' | 'center' | 'intersection' | 'perpendicular' | 'onEdge';
  point: V3;
  rank: number;
  dist: number;
  edge?: [V3, V3];
  other?: [V3, V3];
  id: string;
  /** 코어가 이미 보이는 것으로 고른 점(가림 판정 생략) */
  trusted: boolean;
  /** 종류 글 대신 쓸 글(안내점) */
  label?: string;
}

/** 점 p에서 직선(a, b)에 내린 발과 그 매개변수(a = 0, b = 1). 선분 길이가 0이면 null */
export function footOnLine(p: readonly number[], a: readonly number[], b: readonly number[]): { point: V3; t: number } | null {
  const u = sub(b, a);
  const uu = dot(u, u);
  if (!(uu > 0)) return null;
  const t = dot(sub(p, a), u) / uu;
  return { point: along(a, u, t), t };
}

/** 점 p에서 평면(지나는 점 q, 법선 n)에 내린 발. 법선이 0이면 null */
export function footOnPlane(p: readonly number[], q: readonly number[], n: readonly number[]): V3 | null {
  const nn = dot(n, n);
  if (!(nn > 0)) return null;
  return along(p, n, -dot(sub(p, q), n) / nn);
}

/** 커서 밑 추정 고르기 */
export function chooseSnap(o: SnapInput): Snap {
  const f = o.frame;
  const R = o.radius ?? SNAP_RADIUS_PX;
  const ray = screenRay(f, o.x, o.y);
  const pick = o.pick;
  const cands: Cand[] = [];
  const push = (c: Omit<Cand, 'dist'>): void => {
    if (o.kept && !c.trusted && !o.kept(c.point)) return;
    const s = projectToScreen(f, c.point);
    if (!s) return;
    const dist = Math.hypot(s[0] - o.x, s[1] - o.y);
    if (dist <= R) cands.push({ ...c, dist });
  };

  // 선분(SketchUp 모서리): 커서에서 고른 선 + 둘레에서 고른 선
  const seen = new Set<string>();
  const scene = o.scene;
  /** 교차점을 볼 선분(그 자리 반 화소의 세계 길이 tol과 함께) */
  const near: { seg: [V3, V3]; id: string; tol: number; guide?: boolean }[] = [];
  for (const p of [pick, ...(o.probes ?? [])]) {
    if (!p || p.kind !== 'line' || !scene) continue;
    const key = `${p.id}#${p.raw ?? p.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const seg = segmentOfPick(scene, p);
    if (!seg) continue;
    const [a, b] = seg;
    push({ kind: 'endpoint', point: a, rank: 0, edge: seg, id: p.id, trusted: false });
    push({ kind: 'endpoint', point: b, rank: 0, edge: seg, id: p.id, trusted: false });
    push({ kind: 'midpoint', point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rank: 1, edge: seg, id: p.id, trusted: false });
    // 시작점에서 이 모서리에 내린 발(선분 안일 때만)
    if (o.from) {
      const foot = footOnLine(o.from, a, b);
      if (foot && foot.t > 1e-9 && foot.t < 1 - 1e-9) push({ kind: 'perpendicular', point: foot.point, rank: 1.5, edge: seg, id: p.id, trusted: false });
    }
    // 이 선분이 호·원이면 그 중심
    const c = o.curveCenter?.(p) ?? null;
    if (c) push({ kind: 'center', point: c, rank: 0, id: p.id, trusted: false });
    const center = p === pick;
    const on = center ? ([...p.point] as V3) : rayClosestOnSegment(ray, a, b);
    push({ kind: 'onEdge', point: on, rank: 2, edge: seg, id: p.id, trusted: center });
    if (near.length < MAX_INTERSECTION_SEGMENTS) near.push({ seg, id: p.id, tol: 0.5 * worldPerPixel(f, Math.max(viewDepth(f, on), 0)) });
  }
  // 측정값 칸으로 둔 안내선: 커서 광선에 가장 가까운 선 위 점(모서리 위처럼 — 덧그림이라 형상에 가리지 않는다).
  // 끝이 없는 선이라 교차점 계산에는 그 점 둘레(추정 반경의 네 배) 선분으로 넣는다
  for (const gl of o.guideLines ?? []) {
    const q = closestOnLine(ray, gl.point, gl.dir);
    if (!q) continue;
    const wpp = worldPerPixel(f, Math.max(viewDepth(f, q), 0));
    const half = wpp * R * 4;
    if (!(half > 0)) continue;
    const seg: [V3, V3] = [along(q, gl.dir, -half), along(q, gl.dir, half)];
    push({ kind: 'onEdge', point: q, rank: 2, edge: seg, id: '', trusted: true, label: GUIDE_LINE_LABEL });
    if (near.length < MAX_INTERSECTION_SEGMENTS) near.push({ seg, id: '', tol: 0.5 * wpp, guide: true });
  }
  // 두 선분이 3D에서 만나는 점(둘 다 안쪽). 안내선끼리 만나는 점은 덧그림이라 가림을 보지 않는다
  for (let i = 0; i < near.length; i++)
    for (let j = i + 1; j < near.length; j++) {
      const s = near[i]!, t = near[j]!;
      const x = segmentIntersection(s.seg[0], s.seg[1], t.seg[0], t.seg[1], Math.max(s.tol, t.tol));
      if (x) push({ kind: 'intersection', point: x, rank: 1.25, edge: s.seg, other: t.seg, id: s.id || t.id, trusted: !!(s.guide && t.guide) });
    }
  // 앞서 지나간 곡선의 중심
  for (const c of o.centers ?? []) push({ kind: 'center', point: [c[0], c[1], c[2]], rank: 0, id: '', trusted: false });
  // 측정값 칸으로 찍은 안내점(덧그림이라 형상에 가리지 않는다)
  for (const g of o.guides ?? []) push({ kind: 'endpoint', point: [g[0], g[1], g[2]], rank: 0, id: '', trusted: true, label: GUIDE_POINT_LABEL });
  // 점 묶음(있으면 끝점처럼)
  if (pick && pick.kind === 'point') push({ kind: 'endpoint', point: [...pick.point], rank: 0, id: pick.id, trusted: true });
  // 그물 윤곽선(코어 윤곽선 고르기 — 카메라를 보는 그물의 모서리): 고른 점을 모서리 위로
  if (pick && pick.kind === 'edge') push({ kind: 'onEdge', point: [...pick.point], rank: 2, id: pick.id, trusted: true });
  // 커서 밑 면의 삼각형 꼭짓점(삼각형 변은 SketchUp 모서리가 아니라 중간점·모서리 위로 쓰지 않는다)
  if (pick && pick.kind === 'mesh' && scene) {
    const tri = triangleOfPick(scene, pick);
    if (tri) for (const c of tri) push({ kind: 'endpoint', point: c, rank: 3, id: pick.id, trusted: false });
  }
  cands.sort((p, q) => p.rank - q.rank || p.dist - q.dist);

  let snap: Snap | null = null;
  for (const c of cands) {
    if (!c.trusted && o.visible && !o.visible(c.point)) continue;
    snap = { kind: c.kind, point: c.point, label: c.label ?? SNAP_LABELS[c.kind], id: c.id };
    if (c.edge) snap.edge = c.edge;
    if (c.other) snap.other = c.other;
    break;
  }
  // 면에 수직: 시작점에서 커서 밑 면의 평면에 내린 발이 추정 반경 안이면(맞은편 벽까지의 거리)
  if (!snap && pick && pick.kind === 'mesh' && !pick.section && o.from && pick.normal) {
    const foot = footOnPlane(o.from, pick.point, pick.normal);
    const s = foot ? projectToScreen(f, foot) : null;
    if (foot && s && Math.hypot(s[0] - o.x, s[1] - o.y) <= R && Math.hypot(...sub(foot, o.from)) > 0 && (!o.visible || o.visible(foot)))
      snap = { kind: 'perpendicular', point: foot, label: FACE_PERPENDICULAR_LABEL, id: pick.id, normal: [...pick.normal] };
  }
  if (!snap && pick && pick.kind === 'mesh') {
    snap = { kind: 'onFace', point: [...pick.point], label: pick.section ? '단면에' : SNAP_LABELS.onFace, id: pick.id };
    if (pick.section) snap.section = true;
  }
  const axes = o.axisDirs ?? AXIS_DIRS;
  if (o.from && o.lock) {
    // 잠금: 시작점을 지나는 잠근 선 위에만. 점 추정이면 그 점을 선에 수직으로 내린 자리, 아니면 커서 광선에 가장 가까운 자리
    const q = snap && POINT_KINDS.has(snap.kind) ? snap : null;
    const l = lockedSnap(f, o.from, o.lock.dir, o.x, o.y, q ? q.point : null);
    let s: Snap | null = null;
    if (l) {
      s = { kind: o.lock.kind, point: l.p, label: o.lock.label, dir: [o.lock.dir[0], o.lock.dir[1], o.lock.dir[2]], locked: true };
      if (o.lock.axis) s.axis = o.lock.axis;
      if (o.lock.edge) s.edge = [o.lock.edge[0], o.lock.edge[1]];
      if (l.from && q) {
        s.from = l.from;
        s.fromKind = q.kind;
      }
    }
    snap = s;
  } else if (o.from && (!snap || snap.kind === 'onFace')) {
    // 축 고정·나란함: 면 위·빈 곳보다 앞선다(점·선 추정·면에 수직보다는 뒤). 둘 다 맞으면 화면에서 선에 가까운 쪽(같으면 축)
    const ax = o.axes !== false ? axisLock(f, o.from, o.x, o.y, { axes }) : null;
    const ref = o.parallelRef;
    const e = ref ? unitOf(sub(ref[1], ref[0])) : null;
    const par = ref && e && !alongAxis(e, axes) ? directionLock(f, o.from, o.x, o.y, e) : null;
    if (ax && (!par || ax.perp <= par.perp)) snap = { kind: 'axis', point: ax.point, axis: ax.axis, label: AXIS_LABELS[ax.axis], dir: [...axes[ax.axis]] };
    else if (par && ref && e) snap = { kind: 'parallel', point: par.point, label: SNAP_LABELS.parallel, dir: e, edge: [ref[0], ref[1]] };
  }
  // 시작점에서 내린 수직(모서리·면)도 방향 추론이다(시작점 → 발 쪽으로 잠근다)
  if (snap && snap.kind === 'perpendicular' && o.from && !snap.locked) {
    const d = unitOf(sub(snap.point, o.from));
    if (d) snap.dir = d;
  }
  if (!snap) snap = { kind: 'free', point: freePoint(f, ray, o.from ?? o.anchor), label: SNAP_LABELS.free };
  if (pick && pick.kind === 'mesh' && pick.normal && !snap.normal) snap.normal = [...pick.normal];
  return snap;
}

/** 축이 맞으면 그 축(단위 벡터가 축과 거의 같을 때). axes를 주면 그 축(모형의 그리기 축)과 견준다 */
export function axisOf(n: readonly number[], axes: AxisDirs = AXIS_DIRS): Axis | null {
  const l = Math.hypot(n[0]!, n[1]!, n[2]!);
  if (!(l > 0)) return null;
  for (const a of AXES) if (Math.abs(dot(n, axes[a])) / l > 0.9999) return a;
  return null;
}
