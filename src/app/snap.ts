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
 * - 모서리에 수직(SketchUp "모서리에 수직", 자홍): 같은 자리에서, 커서가 지나간 모서리에 수직인 방향(perpendicularDirs — 시작점에서
 *   그 직선으로 내린 수직과 그리기 축을 수직 평면에 비친 방향, 커서가 면 위이고 모서리가 그 면 위(또는 면과 나란함)면 그 면 안의 수직,
 *   화면 각 6° 안)이면 시작점을 지나 그 방향 선 위로. 여럿 맞으면 화면에서 선에 가까운 쪽(같으면 축 → 나란히 → 수직).
 *   시작점에서 모서리에 내린 수직 발(점 추정)이 먼저다.
 * - 잠금(SketchUp 추론 잠금 — Shift·화살표, 손가락 기기는 측정 띠 단추): 방향 추론(축·나란함·수직)을 잠그면(lock) 시작점을 지나는
 *   그 선 위에만 찍는다. 시작점을 지나는 모서리에 붙은 점 추정(모서리 끝에서 그 모서리를 따라 가리킬 때)도 그 모서리 방향으로 잠근다
 *   (코어 0.12.0 순수 함수 edgeLineLock). 커서가 끝점·중간점·중심·교차점·수직 같은 점 위면 그 점을 선에 수직으로 내린 자리(다른 점의 높이를 옮겨 잰다),
 *   아니면 커서 광선에 가장 가까운 선 위 점(코어 0.10.0 순수 함수 lockedSnap).
 * - 다른 점에서 끌어온 축(SketchUp "점에서" 추론 — 점 위에 잠시 머물면 그 점에서 축 방향 점선): 부른 쪽이 기억한 점(tracks)이 있으면
 *   1. 끌어온 점 후보 가운데 점인 것(결과가 모서리 위·면 위·빈 곳일 때 — 두 선이 만나는 한 점이라 모서리 위보다 구체적이다).
 *      셋 사이는 화면에서 가까운 것이고 뒤 차례는 1화소 넘게 가까워야 이긴다(코어 0.17.0 chooseTrackPoint — 같은 점을 셈 오차로 바꿔 고르지 않게):
 *      a. 시작점 축 위에서 끌어온 점과 줄 맞춘 자리(끌어온 점을 그 축에 수직으로 내린 자리 — 그 축 방향이라 잠글 수 있다)
 *      b. 끌어온 두 점의 서로 다른 축이 3D로 만나는 점(trackOther — 높이가 달라 화면에서만 엇갈리는 축은 만나지 않는다)
 *      c. 끌어온 축이 커서 둘레 모서리·안내선과 3D로 만나는 점(그 선분 안쪽 — 끝점은 끝점 추정이 맡는다)
 *      b·c는 그 끌어온 축이 시작점도 지나면 시작점 축 위 점이라 그 축 방향(dir)을 싣고, c는 그 모서리 직선이 시작점을 지나면 그 모서리 방향으로 잠근다
 *   2. 축 고정·나란함·수직(결과가 면 위·빈 곳일 때 — 위와 같다)
 *   3. 끌어온 점을 지나는 축 위에서 커서 광선에 가장 가까운 점(시작점 전에도 — 시작점을 지나는 선이 아니라 잠그지 않는다)
 *   계산은 코어 순수 함수(opencad-viewer3d/track — 0.16.0 trackCrossSnap·trackAxisSnap, 0.17.0 trackPairSnap·trackEdgeSnap·chooseTrackPoint·trackAlongFirst)가 하고,
 *   축은 모형의 그리기 축이다. 잠근 동안에는 보지 않는다.
 * - 축이 모서리·면과 만나는 점(SketchUp 추론 합치기 — 축 위(On Axis)와 모서리 위(On Edge)·면 위(On Face), 부른 쪽이 axisMeets를 켰을 때):
 *   1의 a·b·c 뒤 차례로 함께 견준다(코어 0.18.0 — 같은 점을 두 길로 구하면 앞의 것이 남는다):
 *      d. 시작점 축이 커서 둘레 모서리·안내선과 3D로 만나는 점(axisEdgeSnap — 그 선분 안쪽, 시작점 축 방향이라 Shift로 잠근다)
 *      e. 시작점 축·끌어온 축이 커서 밑 면을 뚫는 점(axisFaceSnap — 커서가 그물 면 위일 때만. 그 점 화면 자리에서 부른 쪽 고르기(faceAt — 숨김·단면을 따른다)로
 *         다시 맞춰 맨 앞에 보이는 면이 그 자리일 때만 받는다. 곡면을 나눈 이웃 삼각형이 맞으면 그 평면으로 다시 구한다).
 *         시작점 축이면 그 축 방향이라 잠그고, 끌어온 축이면 trackFrom(그 축이 시작점도 지나면 방향도)
 *   모서리가 면의 테두리라 더 구체적이어서 d가 e보다 앞이다. 상자 모서리처럼 축과 수직인 모서리에서는 d가 곧 시작점에서 내린 수직 발이라 수직(점 추정)이 먼저다.
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
import { edgeLineLock as lineLock, lockedSnap, segmentIntersection } from 'opencad-viewer3d/inference';
import {
  axisEdgeSnap,
  axisFaceSnap,
  chooseTrackPoint,
  lockEdgeSnap,
  lockFaceSnap,
  sameTrackPoint,
  trackAlongFirst,
  trackAxisSnap,
  trackCrossSnap,
  trackEdgeSnap,
  trackPairSnap,
  type AxisFaceSnap,
  type TrackFaceHit,
  type TrackLine,
  type TrackSegment,
} from 'opencad-viewer3d/track';

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
  /** 방향 추론(축·나란함·모서리에 수직·시작점에서 내린 수직)이면 시작점에서 그 선의 단위 방향(세계) — 잠글 수 있다 */
  dir?: V3;
  /** 잠근 방향 위 점 */
  locked?: boolean;
  /** 잠근 선으로 옮겨 온 점(커서 밑 끝점 등)과 그 종류 */
  from?: V3;
  fromKind?: SnapKind;
  /** 안내점·안내선에 붙었으면 그 안내(SnapInput.guides·guideLines 안 차례 — 누르면 그 안내를 고른다) */
  guide?: GuideHit;
  /** 지나간 모서리(edge)에 수직인 방향 추론(커서를 따라가는 선 — 시작점에서 내린 수직 발과 다르다) */
  inferred?: boolean;
  /**
   * 다른 점에서 끌어온 축(kind 'axis'): 그 축을 끌어온 점(세계). dir이 있으면 시작점 축 위에서 이 점과 줄 맞춘 자리,
   * 없으면 이 점을 지나는 축 위 점(시작점에서 그 축 방향이 아니다). trackOther가 있으면 끌어온 축끼리의 교차,
   * edge가 있으면 끌어온 축과 그 모서리·안내선의 교차다(둘 다 그 끌어온 축이 시작점도 지나면 dir이 있다)
   */
  trackFrom?: V3;
  /** 끌어온 축끼리의 교차(kind 'axis'): 이 점에서 만나는 둘째 끌어온 축(끌어온 점과 그 축 — 첫째는 trackFrom·axis) */
  trackOther?: TrackGuide;
  /**
   * 축이 면을 뚫는 점(kind 'axis'): 그 면(그물 id·삼각형 번호·세계 단위 법선 — 눈 쪽). trackFrom이 없으면 시작점 축(dir이 있다),
   * 있으면 끌어온 축이다. kind 'axis'에 trackFrom 없이 edge가 있으면 시작점 축이 그 모서리·안내선과 만나는 점이다.
   * 잠근 선 위 점(locked)에 있으면 잠근 선이 그 면을 뚫는 점이다
   */
  face?: SnapFace;
  /**
   * 잠근 선이 모서리·안내선과 만나는 점(locked): 그 선분(세계 — 안내선은 그 점 둘레 토막). 잠근 선 위 점의 edge는 나란함·수직 잠금의 기준 모서리라 따로 둔다
   */
  lockEdge?: [V3, V3];
}

/** 축이 뚫는 면: 그물 id, 삼각형 번호(고르기 index와 같은 뜻), 세계 단위 법선(눈 쪽) */
export interface SnapFace {
  id: string;
  index: number;
  normal: V3;
}

/** 끌어온 축 하나: 끌어온 점(세계)과 그 점을 지나는 축 */
export interface TrackGuide {
  from: V3;
  axis: Axis;
}

/** 붙은 안내: 안내점(guides) 또는 안내선(guideLines)과 그 차례 */
export interface GuideHit {
  kind: 'point' | 'line';
  index: number;
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

/** 면에 수직 추정 글(모서리에 수직은 SNAP_LABELS.perpendicular — 잠금 안내 이름 lockName이 알아본다) */
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
/** 끌어온 점을 지나는 축 위 점의 추정 글(SketchUp "점에서") */
export const TRACK_AXIS_LABELS: Readonly<Record<Axis, string>> = Object.freeze({ x: '끌어온 점의 빨강 축에', y: '끌어온 점의 녹색 축에', z: '끌어온 점의 파랑 축에' });
/** 시작점 축 위에서 끌어온 점과 줄 맞춘 자리: 축 글(AXIS_LABELS) 뒤에 " · "로 붙는 글 */
export const TRACK_ALIGN_LABEL = '끌어온 점과 줄 맞춤';
/**
 * 끌어온 축끼리의 교차 추정 글(SketchUp 교차점 — 두 선이 만나는 점): 두 축 이름을 빨강 → 녹색 → 파랑 차례로(어느 점의 축인지는 점선 색이 보인다)
 */
export const TRACK_PAIR_LABELS: Readonly<Record<'xy' | 'xz' | 'yz', string>> = Object.freeze({
  xy: '끌어온 빨강 축과 녹색 축의 교차점',
  xz: '끌어온 빨강 축과 파랑 축의 교차점',
  yz: '끌어온 녹색 축과 파랑 축의 교차점',
});
/** 끌어온 축끼리의 교차 글(두 축은 차례 없이) */
export function trackPairLabel(a: Axis, b: Axis): string {
  return TRACK_PAIR_LABELS[(a < b ? `${a}${b}` : `${b}${a}`) as keyof typeof TRACK_PAIR_LABELS] ?? '';
}
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
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

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

/**
 * 모서리가 면 위(또는 면과 나란함)로 볼 한도: 모서리 방향과 면 법선이 이루는 코사인(= 모서리와 면 사이 각의 사인)이 이 안이면
 * (약 0.08° — 축과 나란함(alongAxis)과 같은 각)
 */
export const FACE_EDGE_SIN = Math.SQRT2 * 1e-3;

/**
 * 모서리에 수직인 방향 후보(SketchUp "모서리에 수직", 자홍): 시작점을 지나 기준 모서리에 수직인 방향은 평면 하나를 이루므로
 * 그 가운데 뜻 있는 방향만 고른다 — 시작점에서 모서리 직선으로 내린 수직(시작점이 그 직선 밖일 때)과, 그리기 축을 그 평면에 비친 방향
 * (예: 평면도에서 기운 벽에 수평으로 수직, 기운 서까래에 그 세로 평면 안에서 수직). 축과 나란한 방향(축 고정이 맡는다)과
 * 서로 같은 직선은 뺀다. 모서리 길이가 0이면 빈 목록.
 * faceNormal(커서 밑 면의 법선)을 주고 모서리가 그 면 위(또는 면과 나란함, FACE_EDGE_SIN 안)면 그 면 안에서 모서리에 수직인 방향도 마지막에 더한다
 * (예: 기운 지붕 면에서 처마 모서리를 지나간 뒤 지붕 비탈을 따라 오르는 방향 — 처마 끝에서 시작하면 내린 수직이 없고 축을 비친 방향은 수평·수직뿐이다)
 */
export function perpendicularDirs(from: readonly number[], edge: readonly [readonly number[], readonly number[]], axes: AxisDirs = AXIS_DIRS, faceNormal?: readonly number[] | null): V3[] {
  const d = sub(edge[1], edge[0]);
  const u = unitOf(d);
  if (!u) return [];
  const out: V3[] = [];
  const add = (v0: readonly number[]): void => {
    const v = unitOf(v0);
    if (!v || alongAxis(v, axes) || out.some((w) => Math.abs(dot(w, v)) >= 1 - 1e-6)) return;
    out.push(v);
  };
  // 시작점에서 모서리 직선으로 내린 수직(시작점이 그 직선 위면 — 모서리 끝에서 시작 — 방향이 없다)
  const w = sub(from, edge[0]);
  const t = dot(w, u);
  const r = along(w, u, -t);
  if (Math.hypot(r[0], r[1], r[2]) > 1e-6 * Math.max(Math.hypot(d[0], d[1], d[2]), Math.hypot(w[0], w[1], w[2]))) add(r);
  // 축을 수직 평면에 비친 방향
  for (const a of AXES) {
    const k = dot(axes[a], u);
    if (Math.abs(k) < 1 - 1e-6) add(along(axes[a], u, -k));
  }
  // 면 위면 그 면 안의 수직(앞의 방향과 같은 직선이면 앞의 것이 맡는다 — 바뀌는 것은 새 방향뿐)
  const n = faceNormal ? unitOf(faceNormal) : null;
  if (n && Math.abs(dot(n, u)) <= FACE_EDGE_SIN) add(cross(n, u));
  return out;
}

/** 나란함 잠금(↓): 기준 모서리와 나란한 방향. 모서리 길이가 0이면 null */
export function parallelInferenceLock(edge: readonly [readonly number[], readonly number[]]): InferenceLock | null {
  const dir = unitOf(sub(edge[1], edge[0]));
  return dir ? { kind: 'parallel', dir, edge: [[edge[0][0]!, edge[0][1]!, edge[0][2]!], [edge[1][0]!, edge[1][1]!, edge[1][2]!]], label: SNAP_LABELS.parallel } : null;
}

/**
 * 추정이 방향 추론(축·나란함·모서리에 수직·시작점에서 내린 수직)이면 잠글 선, 아니면 null(이미 잠근 추정도 그 선).
 * 시작점(from)을 주면 모서리에 붙은 점 추정도 그 모서리 직선이 시작점을 지날 때 잠근다(edgeLineLock)
 */
export function lockOf(s: Snap | null | undefined, from?: readonly number[] | null, axes: AxisDirs = AXIS_DIRS): InferenceLock | null {
  if (!s) return null;
  if (!s.dir || (s.kind !== 'axis' && s.kind !== 'parallel' && s.kind !== 'perpendicular')) return from ? edgeLineLock(s, from, axes) : null;
  const l: InferenceLock = { kind: s.kind, dir: [s.dir[0], s.dir[1], s.dir[2]], label: s.kind === 'axis' && s.axis ? AXIS_LABELS[s.axis] : s.label };
  if (s.axis) l.axis = s.axis;
  // 기준 모서리는 나란함·수직만(끌어온 축이 모서리와 만나는 점의 그 모서리는 기준이 아니다)
  if (s.edge && s.kind !== 'axis') l.edge = [s.edge[0], s.edge[1]];
  return l;
}

/** 모서리에 붙은 점 추정(그 모서리 직선 위의 점) */
const EDGE_POINT_KINDS: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'intersection', 'onEdge']);

/**
 * 모서리에 붙은 점 추정(끝점·중간점·교차점·모서리 위)의 모서리 직선이 시작점을 지나면 그 방향 잠금, 아니면 null.
 * 축과 나란한 모서리면 그 축(alongAxis와 같은 허용치), 아니면 그 모서리와 나란히.
 * 모서리 끝에서 시작해 그 모서리를 따라 가리키면 점 추정(모서리 위)이 축 추정보다 먼저라 잠글 방향 추론이 없었다 — SketchUp은
 * 모서리 추정을 잠그면 그 직선 위에 두므로, 시작점을 지나는 모서리면 이 방향 잠금과 같다. 커서 점이 시작점 자리면(모서리가 여럿
 * 만나는 꼭짓점) 어느 모서리인지 모르니 잠그지 않는다.
 * 판정(직선이 시작점을 지나는지, 커서 점이 시작점 자리인지)은 이 앱에서 코어 0.12.0으로 옮긴 순수 함수 edgeLineLock에 모서리마다 맡긴다.
 * 허용치는 모서리 길이·시작점 거리에 견준 상대 1e-6(같은 직선 위 다른 선분도 된다 — 코어 뷰어는 화면 반 화소)이고, 커서 점은 그 모서리 위
 * 추정이라 직선까지 거리를 보지 않는다. 코어는 세계 축만 알아 축은 여기서 모형의 그리기 축으로 고른다
 */
export function edgeLineLock(s: Snap, from: readonly number[], axes: AxisDirs = AXIS_DIRS): InferenceLock | null {
  // 끌어온 축이 모서리와 만나는 점(그 모서리 위 점 — 시작점 축 위가 아니어서 방향이 없을 때)도 모서리에 붙은 점 추정이다
  if (s.locked || !(EDGE_POINT_KINDS.has(s.kind) || (s.kind === 'axis' && s.trackFrom && !s.dir))) return null;
  for (const e of [s.edge, s.other]) {
    if (!e || !lineLock(from, s.point, [e], 1e-6 * Math.max(Math.hypot(...sub(e[1], e[0])), Math.hypot(...sub(from, e[0]))), Infinity)) continue;
    const u = unitOf(sub(e[1], e[0]))!;
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
  /** 다른 점에서 끌어온 점(세계, 새것이 앞 — 없거나 비었으면 끌어온 축을 보지 않아 예전과 같다) */
  tracks?: readonly (readonly number[])[] | null;
  /**
   * 시작점 축이 모서리·안내선과 만나는 점, 시작점 축·끌어온 축이 면을 뚫는 점을 볼지(기본 끔 — 끄면 예전과 같다. 측정 도구는 켠다).
   * 면을 뚫는 점은 faceAt이 있어야 본다
   */
  axisMeets?: boolean;
  /**
   * 화면 점에서 고르기(축이 면을 뚫는 점을 그 자리에서 다시 맞춰 본다 — 커서 고르기 pick과 같은 고르기: 숨긴 항목·단면에서 잘린 쪽을 거른다).
   * 부르는 횟수는 한 번 추정에 FACE_HIT_CHECKS까지다
   */
  faceAt?: ((x: number, y: number) => Pick3d | null) | null;
  /**
   * 잠근 동안 잠근 선이 커서 둘레 모서리·안내선과 만나는 점, 커서 밑 면을 뚫는 점에 붙을지(기본 끔 — 끄면 예전과 같다. 측정 도구는 켠다).
   * 커서 밑 점 추정(끝점 등 — 잠근 선에 내린 자리)이 먼저고, 면을 뚫는 점은 faceAt이 있어야 본다
   */
  lockMeets?: boolean;
}

/** 축이 면을 뚫는 점을 다시 맞춰 보는 고르기 수 한도(한 번 추정에 — 축 직선 최대 12개 × 다시 구하기 AXIS_FACE_STEPS번이지만 커서 둘레 점만 맞춰 본다) */
export const FACE_HIT_CHECKS = 12;

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
  /** 안내점·안내선 후보면 그 안내 */
  guide?: GuideHit;
}

/** 커서 둘레 선분(교차점·끌어온 축과의 교차를 본다): 세계 선분, 묶음 id, 그 자리 반 화소의 세계 길이, 안내선이면 guide */
interface NearSeg {
  seg: [V3, V3];
  id: string;
  tol: number;
  guide?: boolean;
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
  const near: NearSeg[] = [];
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
  for (const [index, gl] of (o.guideLines ?? []).entries()) {
    const q = closestOnLine(ray, gl.point, gl.dir);
    if (!q) continue;
    const wpp = worldPerPixel(f, Math.max(viewDepth(f, q), 0));
    const half = wpp * R * 4;
    if (!(half > 0)) continue;
    const seg: [V3, V3] = [along(q, gl.dir, -half), along(q, gl.dir, half)];
    push({ kind: 'onEdge', point: q, rank: 2, edge: seg, id: '', trusted: true, label: GUIDE_LINE_LABEL, guide: { kind: 'line', index } });
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
  for (const [index, g] of (o.guides ?? []).entries()) push({ kind: 'endpoint', point: [g[0], g[1], g[2]], rank: 0, id: '', trusted: true, label: GUIDE_POINT_LABEL, guide: { kind: 'point', index } });
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
    if (c.guide) snap.guide = { ...c.guide };
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
  const tracks = o.tracks?.length ? o.tracks : null;
  if (o.from && o.lock) {
    // 잠금: 시작점을 지나는 잠근 선 위에만. 점 추정이면 그 점을 선에 수직으로 내린 자리, 아니면(lockMeets) 잠근 선이 모서리·안내선과 만나는 점·
    // 커서 밑 면을 뚫는 점, 그것도 없으면 커서 광선에 가장 가까운 자리
    const q = snap && POINT_KINDS.has(snap.kind) ? snap : null;
    const m = !q && o.lockMeets ? lockMeetSnap(o, f, o.from, o.lock, near, R) : null;
    const l = m ? null : lockedSnap(f, o.from, o.lock.dir, o.x, o.y, q ? q.point : null);
    let s: Snap | null = m;
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
  } else {
    const open = !snap || snap.kind === 'onFace';
    // 끌어온 점 후보와 축이 모서리·면과 만나는 점 가운데 점인 것: 두 선(선과 면)이 만나는 한 점이라 모서리 위·축 고정보다 먼저
    // (이 둘레에서는 선을 따라 움직여도 이 자리에 붙는다)
    const meets = !!o.axisMeets && (!!o.from || !!tracks);
    const t = (tracks || meets) && (open || snap!.kind === 'onEdge') ? trackPointSnap(o, f, tracks, near, axes, R, meets) : null;
    if (t) snap = t;
    else if (o.from && open) snap = directionSnap(o, f, o.from, snap, pick, axes);
    // 끌어온 점을 지나는 축(시작점 전에도): 시작점을 지나는 선이 아니라 방향(dir)이 없고 잠그지 않는다
    const ta = tracks && (!snap || snap.kind === 'onFace') ? trackAxisSnap(f, tracks, o.x, o.y, R, o.from ?? null, axes) : null;
    if (ta) snap = { kind: 'axis', point: ta.p, axis: ta.axis, label: TRACK_AXIS_LABELS[ta.axis], trackFrom: ta.from };
  }
  // 시작점에서 내린 수직(모서리·면)도 방향 추론이다(시작점 → 발 쪽으로 잠근다)
  if (snap && snap.kind === 'perpendicular' && o.from && !snap.locked && !snap.inferred) {
    const d = unitOf(sub(snap.point, o.from));
    if (d) snap.dir = d;
  }
  if (!snap) snap = { kind: 'free', point: freePoint(f, ray, o.from ?? o.anchor), label: SNAP_LABELS.free };
  if (pick && pick.kind === 'mesh' && pick.normal && !snap.normal) snap.normal = [...pick.normal];
  return snap;
}

/**
 * 축 고정·나란함·모서리에 수직: 면 위·빈 곳보다 앞선다(점·선 추정·면에 수직보다는 뒤). 맞는 것이 없으면 snap 그대로.
 * 여럿 맞으면 화면에서 선에 가까운 쪽(같으면 축 → 나란히 → 수직)
 */
function directionSnap(o: SnapInput, f: ViewFrame, from: readonly number[], snap: Snap | null, pick: Pick3d | null, axes: AxisDirs): Snap | null {
  const ax = o.axes !== false ? axisLock(f, from, o.x, o.y, { axes }) : null;
  const ref = o.parallelRef;
  const e = ref ? unitOf(sub(ref[1], ref[0])) : null;
  const par = ref && e && !alongAxis(e, axes) ? directionLock(f, from, o.x, o.y, e) : null;
  let per: { point: V3; perp: number; dir: V3 } | null = null;
  // 커서가 면 위(단면에 잘린 면은 아님)면 그 면 안에서 모서리에 수직인 방향도 본다
  const face = snap?.kind === 'onFace' && !snap.section && pick?.kind === 'mesh' ? (pick.normal ?? null) : null;
  if (ref)
    for (const d of perpendicularDirs(from, ref, axes, face)) {
      const l = directionLock(f, from, o.x, o.y, d);
      if (l && (!per || l.perp < per.perp)) per = { ...l, dir: d };
    }
  const best = Math.min(ax?.perp ?? Infinity, par?.perp ?? Infinity, per?.perp ?? Infinity);
  if (ax && ax.perp <= best) return { kind: 'axis', point: ax.point, axis: ax.axis, label: AXIS_LABELS[ax.axis], dir: [...axes[ax.axis]] };
  if (par && ref && e && par.perp <= best) return { kind: 'parallel', point: par.point, label: SNAP_LABELS.parallel, dir: e, edge: [ref[0], ref[1]] };
  if (per && ref) return { kind: 'perpendicular', point: per.point, label: SNAP_LABELS.perpendicular, dir: per.dir, edge: [ref[0], ref[1]], inferred: true };
  return snap;
}

/** 축이 면을 뚫는 점이 보는 면 맞음: 고르기가 맞힌 점·단위 법선, 평면 위 점(맞은 삼각형의 첫 꼭짓점), 그물 id·삼각형 번호와 그 삼각형(세계) */
type FaceHit = TrackFaceHit & { id: string; index: number; tri: [V3, V3, V3] | null };

/**
 * 그물 면 고르기 → 축이 면을 뚫는 점이 보는 면 맞음. 단면 채운 면·법선이 없는 것·그물이 아니면 null.
 * 평면은 광선이 맞은 점이 아니라 삼각형 꼭짓점으로 정한다(코어 0.18.0과 같다 — 축과 수직인 면이면 교차의 그 좌표가 꼭짓점 좌표 그대로)
 */
function faceHitOf(scene: SnapScene | null, pick: Pick3d | null | undefined): FaceHit | null {
  if (!pick || pick.kind !== 'mesh' || pick.section || !pick.normal) return null;
  const n = pick.normal;
  const l = Math.hypot(n[0], n[1], n[2]);
  if (!(l > 0)) return null;
  const tri = scene ? triangleOfPick(scene, pick) : null;
  const h: FaceHit = { point: pick.point, normal: [n[0] / l, n[1] / l, n[2] / l], id: pick.id, index: pick.index, tri };
  if (tri) h.origin = tri[0];
  return h;
}

/** 점 p가 삼각형 안(변 위 포함 — 무게중심 좌표가 모두 −eps 이상)인지. 넓이가 0이면 false */
function inTriangle(p: readonly number[], t: readonly [V3, V3, V3], eps = 1e-9): boolean {
  const u = sub(t[1], t[0]), v = sub(t[2], t[0]), w = sub(p, t[0]);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), wu = dot(w, u), wv = dot(w, v);
  const den = uu * vv - uv * uv;
  if (!(den > 0)) return false;
  const b = (vv * wu - uv * wv) / den, c = (uu * wv - uv * wu) / den;
  return b >= -eps && c >= -eps && b + c <= 1 + eps;
}

/**
 * 축이 면을 뚫는 점을 그 화면 자리에서 다시 맞춰 볼 고르기(axisFaceSnap의 hitAt): 맨 앞에 보이는 그물 면.
 * 코어 고르기는 허용 거리(6화소) 안의 선을 면보다 앞세우므로, 그 자리에서 선이 맞으면 면 위에 그린 선(면의 테두리 모서리·면 위 선)인지 본다 —
 * 그 선의 맞은 점이 앞서 맞춰 본 면(처음은 커서 밑 면 — 축 직선 하나마다 새 hitter)의 평면 위(그 깊이 1.5화소 안)이고 그 화면 자리 광선이
 * 그 삼각형 안을 지나면 그 면이 맞은 것으로 본다(코어 0.18.0이 면 위에 그린 선분·점은 면을 가리지 않게 그물만 다시 고르는 것과 같은 뜻).
 * 단면에서 잘린 쪽이면 맞지 않는다. 고르기는 한 번 추정에 FACE_HIT_CHECKS번까지(budget을 함께 센다) 하고 그 뒤는 null
 */
function faceHitter(o: SnapInput, f: ViewFrame, under: FaceHit, budget: { n: number }): (sx: number, sy: number) => FaceHit | null {
  const at = o.faceAt!;
  let last = under;
  return (sx, sy) => {
    if (++budget.n > FACE_HIT_CHECKS) return null;
    const k = at(sx, sy);
    const h = faceHitOf(o.scene, k);
    if (h) return (last = h);
    if (!k || k.kind === 'mesh' || !last.tri) return null;
    const ray = screenRay(f, sx, sy);
    const q = rayPlane(ray, last.origin ?? last.point, last.normal);
    if (!q || !inTriangle(q, last.tri) || (o.kept && !o.kept(q))) return null;
    const dq = viewDepth(f, q);
    const off = Math.abs(dot(sub(k.point, q), last.normal));
    if (!(off <= worldPerPixel(f, Math.max(dq, 0)) * 1.5 + 1e-9 * (1 + Math.max(...q.map(Math.abs))))) return null;
    return { ...last, point: q };
  };
}

/** 축·잠근 선과 만나는 점을 볼 커서 둘레 선분(코어 TrackSegment 꼴): 모서리는 단면에 잘린 쪽(keep)·가린 점(vis)을 빼고, 안내선은 덧그림이라 보지 않는다(교차점과 같다) */
type MeetSeg = TrackSegment & { near: NearSeg };

function meetSegments(o: SnapInput, near: readonly NearSeg[]): { segs: MeetSeg[]; vis: ((p: V3, s: MeetSeg) => boolean) | null } {
  const kept = o.kept;
  const visible = o.visible;
  const segs = near.map((n): MeetSeg => {
    const s: MeetSeg = { a: n.seg[0], b: n.seg[1], wpp: 2 * n.tol, near: n };
    if (kept && !n.guide) s.keep = (p) => kept([p[0]!, p[1]!, p[2]!]);
    return s;
  });
  return { segs, vis: visible ? (p, s) => !!s.near.guide || visible(p) : null };
}

/**
 * 잠근 선이 만나는 점(코어 0.19.0 차례 — 커서 밑 점 추정이 없을 때): 시작점을 지나는 잠근 선(축·나란함·수직·모서리 방향)이 커서 둘레 모서리·안내선과
 * 3D로 만나는 점(lockEdgeSnap — 그 선분 안쪽), 커서 밑 그물 면을 뚫는 점(lockFaceSnap — 그 점 화면 자리에서 다시 맞춰 맨 앞 면일 때만, axisFaceSnap과 같은 faceHitter).
 * 둘 사이는 화면에서 가까운 것이고 면은 1화소 넘게 가까워야 이긴다(chooseTrackPoint — 모서리가 면의 테두리라 더 구체적이다). 없으면 null.
 * 글은 잠금 글 뒤에 " · 모서리에"(안내선이면 "· 안내선에")·" · 면에", 방향·축·기준 모서리는 잠금 그대로다
 */
function lockMeetSnap(o: SnapInput, f: ViewFrame, from: readonly number[], lock: InferenceLock, near: readonly NearSeg[], R: number): Snap | null {
  const { segs, vis } = meetSegments(o, near);
  const edge = segs.length ? lockEdgeSnap(f, from, lock.dir, segs, o.x, o.y, R, vis) : null;
  const under = o.faceAt ? faceHitOf(o.scene, o.pick) : null;
  const face = under ? lockFaceSnap<FaceHit>(f, from, lock.dir, o.x, o.y, R, under, faceHitter(o, f, under, { n: 0 })) : null;
  const t = chooseTrackPoint<{ distPx: number }>([edge, face]);
  if (!t) return null;
  const s: Snap = { kind: lock.kind, point: t === edge ? edge.p : face!.p, label: '', dir: [lock.dir[0], lock.dir[1], lock.dir[2]], locked: true };
  if (lock.axis) s.axis = lock.axis;
  if (lock.edge) s.edge = [lock.edge[0], lock.edge[1]];
  if (t === edge) {
    const n = edge.seg.near;
    s.label = `${lock.label} · ${n.guide ? GUIDE_LINE_LABEL : SNAP_LABELS.onEdge}`;
    s.lockEdge = [n.seg[0], n.seg[1]];
    s.id = n.id;
  } else {
    const h = face!.hit;
    s.label = `${lock.label} · ${SNAP_LABELS.onFace}`;
    s.id = h.id;
    s.normal = [...h.normal] as V3;
    s.face = { id: h.id, index: h.index, normal: [...h.normal] as V3 };
  }
  return s;
}

/**
 * 끌어온 점 후보와 축이 모서리·면과 만나는 점 가운데 점인 것(코어 0.17.0·0.18.0 차례): 시작점 축 위 줄 맞춘 자리(0.16.0 trackCrossSnap),
 * 끌어온 축끼리의 교차(trackPairSnap), 끌어온 축과 커서 둘레 모서리·안내선의 교차(trackEdgeSnap), meets면 시작점 축과 모서리·안내선의 교차(axisEdgeSnap),
 * 시작점 축·끌어온 축이 커서 밑 면을 뚫는 점(axisFaceSnap). 다섯 사이는 화면에서 가까운 것이고 뒤 차례는 1화소 넘게 가까워야 이긴다(chooseTrackPoint).
 * 모서리는 단면에 잘린 쪽과 가린 점을 빼고, 안내선은 덧그림이라 가림을 보지 않는다(교차점과 같다). 없으면 null
 */
function trackPointSnap(o: SnapInput, f: ViewFrame, tracks: readonly (readonly number[])[] | null, near: readonly NearSeg[], axes: AxisDirs, R: number, meets: boolean): Snap | null {
  const first = o.from ?? null;
  const cross = tracks && first ? trackCrossSnap(f, first, tracks, o.x, o.y, R, axes) : null;
  const pair = tracks ? trackPairSnap(f, tracks, o.x, o.y, R, first, axes) : null;
  const { segs, vis } = meetSegments(o, near);
  const edge = tracks && segs.length ? trackEdgeSnap(f, tracks, segs, o.x, o.y, R, first, axes, vis) : null;
  const axe = meets && first && segs.length ? axisEdgeSnap(f, first, segs, o.x, o.y, R, axes, vis) : null;
  // 축이 면을 뚫는 점: 커서가 그물 면 위일 때만. 축 직선은 시작점 X·Y·Z, 끌어온 점(새것이 앞) X·Y·Z — 앞 직선과 같은 직선(같은 축이고
  // 그 점이 앞 점의 그 축 위 — 시작점과 같은 점 포함)은 뺀다(같은 점을 셈 오차로 바꿔 고르지 않게, 앞 것이 남는다).
  // 직선 하나씩 코어 함수에 넘겨(다시 맞춰 본 면을 직선마다 커서 밑 면에서 새로 따라가게) 가장 가까운 것(같으면 앞 직선)
  const under = meets && o.faceAt ? faceHitOf(o.scene, o.pick) : null;
  let face: AxisFaceSnap<FaceHit> | null = null;
  let faceLine = -1;
  if (under) {
    const lines: TrackLine[] = [];
    const add = (from: readonly number[]): void => {
      for (const axis of AXES) if (!lines.some((l) => l.axis === axis && (sameTrackPoint(l.from, from) || trackAlongFirst(f, l.from, from, axis, axes)))) lines.push({ from, axis });
    };
    if (first) add(first);
    for (const P of tracks ?? []) add(P);
    const budget = { n: 0 };
    for (let i = 0; i < lines.length; i++) {
      const r = axisFaceSnap<FaceHit>(f, [lines[i]!], o.x, o.y, R, under, faceHitter(o, f, under, budget), axes);
      if (r && (!face || r.distPx < face.distPx)) {
        face = r;
        faceLine = i;
      }
    }
  }
  const t = chooseTrackPoint<{ distPx: number }>([cross, pair, edge, axe, face]);
  if (!t) return null;
  if (t === cross) return { kind: 'axis', point: cross.p, axis: cross.axis, label: `${AXIS_LABELS[cross.axis]} · ${TRACK_ALIGN_LABEL}`, dir: cross.direction ?? [...axes[cross.axis]], trackFrom: cross.from };
  if (t === axe) {
    // 시작점 축이 모서리·안내선과 만나는 점: 그 축 방향이라 잠글 수 있다(lockOf — 모서리 방향이 아니라 그 축)
    const n = axe.seg.near;
    return { kind: 'axis', point: axe.p, axis: axe.axis, label: `${AXIS_LABELS[axe.axis]} · ${n.guide ? GUIDE_LINE_LABEL : SNAP_LABELS.onEdge}`, dir: axe.direction, edge: [n.seg[0], n.seg[1]], id: n.id };
  }
  if (face && t === face) {
    const fs = face as AxisFaceSnap<FaceHit>;
    const h = fs.hit;
    const s: Snap = { kind: 'axis', point: fs.p, axis: fs.axis, label: '', id: h.id, normal: [...h.normal] as V3, face: { id: h.id, index: h.index, normal: [...h.normal] as V3 } };
    if (first && faceLine < 3) {
      s.label = `${AXIS_LABELS[fs.axis]} · ${SNAP_LABELS.onFace}`;
      s.dir = fs.direction;
    } else {
      s.label = `${TRACK_AXIS_LABELS[fs.axis]} · ${SNAP_LABELS.onFace}`;
      s.trackFrom = fs.from;
      const dir = first ? trackAlongFirst(f, first, fs.from, fs.axis, axes) : null;
      if (dir) s.dir = dir;
    }
    return s;
  }
  const tt = t as NonNullable<typeof pair | typeof edge>;
  const s: Snap = { kind: 'axis', point: tt.p, axis: tt.axis, label: TRACK_AXIS_LABELS[tt.axis], trackFrom: tt.from };
  // 그 끌어온 축이 시작점도 지나면(끌어온 점이 시작점 축 위) 시작점 축 위 점이기도 하다 — 그 축 방향이라 잠글 수 있다
  const dir = first ? trackAlongFirst(f, first, tt.from, tt.axis, axes) : null;
  if (dir) s.dir = dir;
  if (t === pair && pair.other) {
    s.label = trackPairLabel(pair.axis, pair.other.axis);
    s.trackOther = { from: pair.other.from, axis: pair.other.axis };
  } else if (t === edge) {
    // 모서리 위 점(그 모서리 직선이 시작점을 지나면 lockOf가 그 모서리 방향으로 잠근다)
    const n = edge.seg.near;
    s.label = `${TRACK_AXIS_LABELS[tt.axis]} · ${n.guide ? GUIDE_LINE_LABEL : SNAP_LABELS.onEdge}`;
    s.edge = [n.seg[0], n.seg[1]];
    s.id = n.id;
  }
  return s;
}

/** 축이 맞으면 그 축(단위 벡터가 축과 거의 같을 때). axes를 주면 그 축(모형의 그리기 축)과 견준다 */
export function axisOf(n: readonly number[], axes: AxisDirs = AXIS_DIRS): Axis | null {
  const l = Math.hypot(n[0]!, n[1]!, n[2]!);
  if (!(l > 0)) return null;
  for (const a of AXES) if (Math.abs(dot(n, axes[a])) / l > 0.9999) return a;
  return null;
}
