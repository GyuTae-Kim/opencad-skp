/**
 * SketchUp 2021 이후 model.dat(TLV) → 중간 모형. 중간 모형(SkpModel …) 자료형은 2020 이하 해석기(src/mfcmodel.ts)도 같이 쓴다.
 * 꼬리표의 뜻은 공개 표본 바이트로 추론한 것과 2026-10 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의 형식 지식을 옮긴 것이다(docs/formats/skp.md).
 * 모르는 꼬리표는 건너뛴다.
 *
 * 쓰는 경로:
 *   01f4 뿌리 ─ 0200 설정(61a8/61a9/61aa: 이름 61ab, 값 묶음 61ac = 열쇠 61ad·값 38a4)
 *            ├ 01f7 재질 30d4/30d5/32c8(번호 05dc/05de, 이름 32cc)
 *            ├ 01f8 태그 3a98 ─ 3a99/3c8c(번호, 이름 3c8d, 숨김 3c8e, 색 3c8f, 장면 기본 숨김 3c90, 선 종류 3c91), 3a9a 활성 태그, 3a9b 태그 폴더
 *            ├ 01fa 카메라 34bc, 01fb 렌더링 733c, 0206 스타일 6978, 0207 장면 6d60, 0208 선 종류, 0209 모형 속성 36b1
 *            ├ 01fd 글꼴 4e20/4e21/5014, 01fe·01ff 문자·치수 기본값
 *            ├ 01f9 정의 1770/1771/157c(요소 1388, GUID 157d, 이름 157e, 설명 157f, 종류 1583, 동작 1b58)
 *            └ 01f6 모형 요소 1388
 *   요소 1388 ─ 07d0 바탕(번호 = 정의 번호, 05dd 속성 사전), 1389 정점 09c4(번호, 좌표 09c5 = f64×3)
 *            ├ 138a 모서리 0bb8(바탕 07d0, 시작 0bb9, 끝 0bba, 곡선 0bbb)
 *            ├ 138b 면 0dac(바탕, 평면 0dad = f64×4, 뒷면 재질 0daf, 고리 0dae/1194/1195/0fa0(모서리 0fa1, 뒤집힘 0fa2))
 *            ├ 138c 컴포넌트 1964, 138d 그룹 1d4c/1964, 1390 그림 1f40/1964(바탕, 이름 1965, 변환 1966 = f64×13, 정의 1967, GUID 1968)
 *            ├ 1396 곡선·1397 호, 1398 문자, 1399·139a 치수, 1391·1392 보조선·보조점, 1393 단면 + 1394 활성 단면
 *   바탕 07d0 ─ 05dc 머리(05de 번호, 05dd 속성 사전), 07d1 재질, 07d2 태그, 07d3 깃발(0x01 숨김, 0x08 soft, 0x10 smooth, 0x20 잠김)
 */

import type { SkpUnitsMeta } from './meta';
import { TlvReader, type TlvNode } from './tlv';
import { readCurves, readGuideLine, readGuidePoint, readLinearDim, readRadialDim, readSection, readText, resolveLink, type AnnotEnv, type DimLink, type PointLookups } from './vffannot';
import {
  animationFromOptions,
  ifcGuid,
  idOf,
  lengthUnitCode,
  readBase,
  readBaseAttrs,
  readHeaderAttrs,
  readOptions,
  unitsFromOptions,
  type Warn,
} from './vffcommon';
import { readAnnotationDefaults, readCamera, readFonts, readLayers, readLineStyles, readModelProperties, readPages, readRenderingValues, readStyles, type LayerSet, type StyleSet } from './vffroot';
import { TAG } from './vfftags';

export { TAG } from './vfftags';

/** 깃발 비트(관찰: 06 보통, 07 숨김, 1e 부드러운·매끈한 곡면 모서리) */
export const FLAG_HIDDEN = 0x01;
export const FLAG_SOFT_SMOOTH = 0x18;
/** 0x08 부드러움(soft), 0x10 매끈함(smooth — 정점 법선을 이어 둥글게 칠하는 모서리), 0x20 잠김(인스턴스·주석) */
export const FLAG_SOFT = 0x08;
export const FLAG_SMOOTH = 0x10;
export const FLAG_LOCKED = 0x20;

export type Vec3 = [number, number, number];
export type SkpArrow = 'none' | 'slash' | 'dot' | 'closed' | 'open';
export type SkpLeaderType = 'none' | 'view_based' | 'pushpin';

/** 속성 사전 값(형 있는 값 0x38A4) */
export type SkpAttr =
  | null
  | boolean
  | number
  | string
  | SkpAttr[]
  | { kind: 'color'; rgba: [number, number, number, number] }
  | { kind: 'time'; epoch: number }
  | { kind: 'length'; inch: number }
  | { kind: 'point' | 'vector'; xyz: Vec3 };
/** 사전 이름 → 열쇠 → 값 */
export type SkpAttrDicts = Record<string, Record<string, SkpAttr>>;

export interface SkpFace {
  /** 고리마다 정점 번호(SkpEntities.points 안). 첫 고리가 바깥, 나머지는 구멍(표본에서 확인) */
  loops: number[][];
  /** 평면 법선(앞면 쪽) */
  normal: [number, number, number];
  front?: number;
  back?: number;
  layer?: number;
  flags: number;
  /** 영구 번호(0x05DE) — 장면의 숨긴 목록이 가리킨다 */
  pid?: number;
  /** 고리마다, 꼭짓점 k에서 나가는 모서리(SkpEntities.edges 차례) — 매끈한 모서리 건너 법선 잇기용 */
  loopEdges?: number[][];
  attrs?: SkpAttrDicts;
}

export interface SkpEdge {
  a: number;
  b: number;
  flags: number;
  layer?: number;
  pid?: number;
  material?: number;
  /** SkpEntities.curves 차례 */
  curve?: number;
  attrs?: SkpAttrDicts;
}

export interface SkpInstance {
  definition: number;
  /** 4×4 열 우선(SketchUp의 3×3은 행 우선 저장 — 붙인 컴포넌트의 z축이 면 법선과 맞는 쪽으로 확인) */
  matrix: Float64Array;
  material?: number;
  layer?: number;
  /** 0x01 숨김, 0x20 잠김 */
  flags: number;
  name?: string;
  /** 어느 목록에서 왔는지(0x138c 컴포넌트 · 0x138d/0x1d4c 그룹 · 0x1390/0x1f40 그림, 정의 종류가 그림이면 그림) — 화면 목록용 */
  kind?: 'group' | 'component' | 'image';
  pid?: number;
  /** IFC 22자 GUID(0x1968, 그림·빈 GUID는 없음) */
  guid?: string;
  attrs?: SkpAttrDicts;
}

/** 문자(0x1398 → 0x55f0). 좌표는 든 요소 묶음의 로컬 인치 */
export interface SkpText {
  pid?: number;
  layer?: number;
  /** 0x07d1 = 글 색 재질 */
  material?: number;
  flags: number;
  text: string;
  /** 붙는 점(붙은 점이면 풀어서). 화면 글(점 종류 0)이면 없음 */
  point?: Vec3;
  /** 지시선 종류(0x55fd, 코드가 범위 밖이면 없음) */
  leaderType?: SkpLeaderType;
  /** 지시선 글: 글 자리 = point + leader(인치) */
  leader?: Vec3;
  /** 지시선이 none(또는 모름)인 글: 화면 비율 0~1(왼쪽 위 원점) */
  screen?: [number, number];
  /** 글꼴 영구 번호(SkpModel.fonts) */
  font?: number;
  arrow?: SkpArrow;
}

/** 치수(선형 0x1399 → 0x5bcc, 반지름·지름 0x139a → 0x5dc0). 좌표는 로컬 인치, 붙은 점은 풀어서 */
export interface SkpDimension {
  pid?: number;
  layer?: number;
  material?: number;
  flags: number;
  kind: 'linear' | 'radial' | 'diameter';
  /** 보이는 글('' 또는 '<>'가 든 글이면 잰 값을 넣는다) */
  text: string;
  /** 선형: 두 끝점 */
  start?: Vec3;
  end?: Vec3;
  /** 선형: 잰 축(단위)과 치수선 띄움(인치 벡터, 끝점 + offset = 치수선 끝) — linear_layout 결과 */
  measureAxis?: Vec3;
  offset?: Vec3;
  /** 반지름·지름: 호 중심, 호 위 점, 글 쪽 붙는 점, 평면 법선 */
  center?: Vec3;
  arcPoint?: Vec3;
  attach?: Vec3;
  normal?: Vec3;
  alignedText?: boolean;
  arrow?: SkpArrow;
  textAlignment?: 'above' | 'center' | 'outside';
  font?: number;
}

/** 보조선(0x1391)·보조점(0x1392). 로컬 인치 */
export interface SkpGuide {
  pid?: number;
  layer?: number;
  flags: number;
  kind: 'line' | 'point';
  point: Vec3;
  /** 선: 방향(단위) */
  direction?: Vec3;
  /** 선: 끝이 있는 보조선이면 두 끝(없으면 끝없음). 점: 선으로 보이는 보조점의 기준점(start → point 점선) */
  start?: Vec3;
  end?: Vec3;
}

/** 단면 평면(0x1393 → 0x445c). plane = [a, b, c, d], a·x+b·y+c·z+d ≥ 0 쪽이 남는다(d는 인치) */
export interface SkpSectionPlane {
  pid?: number;
  layer?: number;
  flags: number;
  plane: [number, number, number, number];
  name: string;
  symbol: string;
  /** 그 요소 묶음의 활성 단면(0x1394)인지 */
  active: boolean;
}

/** 곡선·호·원(0x1396 / 0x1397) */
export interface SkpCurve {
  pid?: number;
  /** SkpEntities.edges 차례, 이은 차례 */
  edges: number[];
  kind: 'curve' | 'polygon' | 'arc' | 'circle';
  center?: Vec3;
  normal?: Vec3;
  /** 길이 = 반지름 */
  xaxis?: Vec3;
  radius?: number;
  /** 라디안 */
  startAngle?: number;
  endAngle?: number;
}

export interface SkpEntities {
  /** 정점 좌표 xyz…(인치) */
  points: Float64Array;
  faces: SkpFace[];
  edges: SkpEdge[];
  instances: SkpInstance[];
  curves?: SkpCurve[];
  texts?: SkpText[];
  dimensions?: SkpDimension[];
  guides?: SkpGuide[];
  sections?: SkpSectionPlane[];
  /** 묶음 머리(07d0 → 05dc → 05dd)의 속성 사전 — 정의 속성(뿌리 묶음이면 모형 속성) */
  attrs?: SkpAttrDicts;
}

/** 정의 동작(0x1b58) */
export interface SkpBehavior {
  alwaysFaceCamera: boolean;
  cutsOpening: boolean;
  shadowsFaceSun: boolean;
  /** 붙는 면(0x1b5b "면에 붙음"이 꺼져 있으면 'none', 범위 밖 코드는 수 그대로) */
  snapTo?: 'none' | 'any' | 'horizontal' | 'vertical' | 'sloped' | number;
  /** 늘이지 않음 마스크(0x1b5a, 비트 뜻은 모름) */
  noScaleMask?: number;
}

export interface SkpDefinition {
  id: number;
  name: string;
  entities: SkpEntities;
  /** 0x1583: 0(없음) 컴포넌트, 1 그룹, 2 그림 */
  kind?: 'component' | 'group' | 'image';
  guid?: string;
  description?: string;
  /** 그림 정의는 동작이 없다 */
  behavior?: SkpBehavior;
}

/** 글꼴(0x01fd 목록) */
export interface SkpFont {
  face: string;
  pointSize?: number;
  bold: boolean;
  italic: boolean;
  /** 세계 크기 글일 때만(인치) */
  worldSize?: number;
}

/** 문자·치수 모형 기본값(0x01fe 문자, 0x01ff 치수). 글꼴은 영구 번호(SkpModel.fonts), 색은 0~255 RGB */
export interface SkpAnnotationDefaults {
  /** 화면 글 글꼴(0x57e5) */
  textFont?: number;
  /** 지시선 글 글꼴(0x57e6) */
  leaderFont?: number;
  /** 화면 글 색(0x57ec) */
  textColor?: [number, number, number];
  /** 지시선 글 색(0x57ed) */
  leaderColor?: [number, number, number];
  leaderArrow?: SkpArrow;
  leaderType?: SkpLeaderType;
  dimFont?: number;
  dimColor?: [number, number, number];
  dimArrow?: SkpArrow;
  dimAlignedText?: boolean;
  dimTextAlignment?: 'above' | 'center' | 'outside';
}

/** 카메라(0x34bc). 위치는 모형 인치 */
export interface SkpCamera {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  perspective: boolean;
  /** 세로 시야각(도), 원근만 */
  fov?: number;
  /** 평행 투영 화면 전체 높이(인치), 평행만 */
  height?: number;
  aspect?: number;
  twoPoint: boolean;
}

/** 태그(0x3c8c), 목록 차례 그대로(0 = 기본 태그) */
export interface SkpTag {
  id: number;
  name: string;
  /** 0x3c8e 숨김이 아니면 참(폴더 보임과는 따로) */
  visible: boolean;
  /** 태그 색 재질 이름(0x3c8f → 0x32cc, = materials/<이름>/material.xml 폴더) */
  colorMaterial?: string;
  /** 0x3c90 = 1: 새 장면에서 기본 숨김 */
  sceneHidden: boolean;
  /** 선 종류 이름(실선이면 없음) */
  lineStyle?: string;
  /** SkpModel.tagFolders 차례 */
  folder?: number;
  /** 태그 속성 사전(05dc → 05dd) */
  attrs?: SkpAttrDicts;
}

/** 태그 폴더(0x3e80), 뿌리 폴더는 빼고 앞 순회 차례 */
export interface SkpTagFolder {
  name: string;
  visible: boolean;
  /** 부모 폴더 차례(-1 = 뿌리 바로 아래) */
  parent: number;
}

/** 렌더링 설정 원본(0x733c 자식 꼬리표 → 내용) — 스타일 XML과 합쳐 styles.ts가 푼다 */
export interface SkpRenderingRaw {
  values: Map<number, Uint8Array>;
  /** 모자란 값을 찾을 스타일(0x0206 목록)의 이름 — styles/<이름>/style.xml. 모형은 작업 사본 → 없으면 활성 스타일, 장면은 장면 스타일 */
  styleName?: string;
  /** 모형 렌더링: 보이는 스타일 이름(활성 스타일). 2021+ 장면은 없음(styleName과 같다), 2020 이하는 장면도 스타일 이름(styleName은 스타일 사본 열쇠) */
  activeName?: string;
}

/** 장면(0x7148) */
export interface SkpPage {
  pid?: number;
  name: string;
  description: string;
  /** use 깃발(0x7149): 0x001 카메라, 0x002 스타일, 0x004 그림자, 0x020 숨긴 태그, 0x040 단면, 0x080 숨긴 형상, 0x100 숨긴 개체 */
  flags: number;
  camera?: SkpCamera;
  /** 숨긴 요소 영구 번호(0x714b, 저장 당시 전체 상태, 겹침 없이) */
  hiddenIds: number[];
  /** 이 장면에서 숨긴 태그(SkpModel.tags 차례) — 0x7150 목록 XOR 기본 숨김(0x3c90) */
  hiddenTags: number[];
  /** 활성 단면 영구 번호(0x7151) */
  sectionIds: number[];
  rendering?: SkpRenderingRaw;
  /** 전환·지연 시간(초). 장면 값이 음수·없음이면 모형 기본(SkpModel.animation)을 넣는다 */
  transition?: number;
  delay?: number;
  /** 장면 재생에 넣기(0x7152, 없으면 참) */
  includeInAnimation?: boolean;
  /** 장면 미리보기 그림의 ZIP 경로(0x7158 → 0x2134) */
  thumbnail?: string;
}

/** Model Info > Animation(설정 절의 PageOptions·SlideshowOptions) */
export interface SkpAnimation {
  showTransition?: boolean;
  /** 장면 전환 시간(초) */
  transitionTime?: number;
  /** 장면 지연 시간(초, SlideTime) */
  sceneDelay?: number;
  loop?: boolean;
}

export interface SkpModel {
  materials: Map<number, string>;
  layers: Map<number, string>;
  /** 기본 태그(Layer0·Untagged) 번호 = 태그 목록 첫째 */
  defaultLayer?: number;
  definitions: Map<number, SkpDefinition>;
  root: SkpEntities;
  /** 표시 길이 단위(UnitsOptions/LengthUnit: 0 인치, 1 피트, 2 mm, 3 cm, 4 m, 5 야드) */
  lengthUnit?: number;
  counts: { vertices: number; edges: number; faces: number; instances: number };
  warnings: string[];
  /** 잘렸거나 꼬리표 길이가 깨진 곳을 만나 일부만 읽었는지 */
  damaged?: boolean;
  // ── 뿌리 절(모두 선택: 없거나 읽지 못하면 비운다) ──
  /** 단위 표시 설정(UnitsOptions 전체) */
  units?: SkpUnitsMeta;
  /** 저장 당시 카메라(0x01fa) */
  camera?: SkpCamera;
  /** 장면 목록(0x0207)과 활성 장면 차례 */
  pages?: SkpPage[];
  activePage?: number;
  /** 장면 전환·지연 모형 기본값 */
  animation?: SkpAnimation;
  /** 태그 목록 차례 그대로(layers Map은 그대로 둔다)와 태그 폴더 */
  tags?: SkpTag[];
  tagFolders?: SkpTagFolder[];
  /** 활성(지금 그리는) 태그 번호(0x3a9a) — 기본 태그와 다를 수 있다 */
  activeLayer?: number;
  /** 모형 렌더링 설정(0x01fb) */
  rendering?: SkpRenderingRaw;
  /** 모형 이름·설명(0x0209 모형 속성) */
  name?: string;
  description?: string;
  /** 모형 속성 사전(0x0209) */
  properties?: SkpAttrDicts;
  fonts?: Map<number, SkpFont>;
  annotationDefaults?: SkpAnnotationDefaults;
}

/** 모형 전체를 읽은 뒤 풀 붙은 치수 점 */
interface PendingPoint {
  link: DimLink;
  set: (p: Vec3) => void;
}

/** 모형 전체를 읽은 뒤 찾을 반지름 치수의 호 */
interface PendingArc {
  edge: number;
  dim: SkpDimension;
  make: (arc: SkpCurve) => boolean;
  list: SkpDimension[];
}

interface Ctx {
  r: TlvReader;
  warn: Map<string, number>;
  counts: SkpModel['counts'];
  /** 진행 알림(읽은 바이트 위치 기준 0~1) */
  tick: (pos: number) => void;
  /** 깨지거나 잘린 곳을 만났는지 */
  damaged: boolean;
  fonts: Map<number, SkpFont>;
  /** 읽은 요소 묶음 노드(붙은 점의 정점을 다시 찾을 때) */
  entityNodes: TlvNode[];
  pendingPoints: PendingPoint[];
  pendingArcs: PendingArc[];
}

/** 목록 틀(꼬리표 길이)이 깨진 정의 — 정의를 통째로 건너뛰게 한다 */
class BrokenList extends Error {}

/** 목록 안 항목을 이만큼 읽을 때마다 진행을 알린다 */
const TICK_EVERY = 4096;

function note(ctx: Ctx, msg: string): void {
  ctx.warn.set(msg, (ctx.warn.get(msg) ?? 0) + 1);
}

/** 목적격 조사(받침이 있으면 '을', 없으면 '를') */
function eul(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? '을' : '를');
}

/** 주격 조사(받침이 있으면 '이', 없으면 '가') */
function iga(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c < 11172 && c % 28 !== 0 ? '이' : '가');
}

/** 13개 f64(3×3 행 우선, 이동 3, 나눔수 1) → 4×4 열 우선 */
export function matrixFrom13(m: ArrayLike<number>): Float64Array {
  const c = new Float64Array(16);
  c[0] = m[0]!;
  c[1] = m[3]!;
  c[2] = m[6]!;
  c[4] = m[1]!;
  c[5] = m[4]!;
  c[6] = m[7]!;
  c[8] = m[2]!;
  c[9] = m[5]!;
  c[10] = m[8]!;
  c[12] = m[9]!;
  c[13] = m[10]!;
  c[14] = m[11]!;
  const w = m[12]!;
  c[15] = Number.isFinite(w) && w !== 0 ? w : 1;
  return c;
}

/** 잘렸어도 앞부분을 살리는 목록 꼬리표(값 꼬리표는 잘린 내용을 쓰면 안 된다) */
const LIST_TAGS = new Set<number>([
  TAG.VERTICES,
  TAG.EDGES,
  TAG.FACES,
  TAG.COMPONENTS,
  TAG.GROUPS,
  TAG.IMAGES,
  TAG.GUIDE_LINES,
  TAG.GUIDE_POINTS,
  TAG.SECTION_PLANES,
  TAG.CURVES,
  TAG.ARC_CURVES,
  TAG.TEXTS,
  TAG.LINEAR_DIMS,
  TAG.RADIAL_DIMS,
]);

/**
 * 요소 묶음(1388) 읽기.
 * tolerant: 목록 틀(길이)이 깨지면 그 앞까지만 읽고 경고한다(모형 요소, 파일 끝에서 잘린 정의).
 * 아니면 목록 틀이 깨진 정의는 BrokenList로 통째로 건너뛴다(쓰레기를 그리지 않게). 항목 하나의 속이 깨진 것은 그 항목만 건너뛴다.
 */
function readEntities(ctx: Ctx, n: TlvNode, tolerant: boolean): SkpEntities {
  const r = ctx.r;
  const warn: Warn = (m) => note(ctx, m);
  ctx.entityNodes.push(n);
  const parts: TlvNode[] = [];
  const whole = r.eachSafe(
    n.start,
    n.end,
    (tag, start, end, clipped) => {
      if (clipped && !LIST_TAGS.has(tag)) return;
      parts.push({ tag, start, end });
    },
    tolerant,
  );
  const broken = (what: string): void => {
    if (!tolerant) throw new BrokenList(what);
    ctx.damaged = true;
    note(ctx, `${iga(what)} 깨져 뒷부분을 읽지 못했습니다`);
  };
  if (!whole) broken('요소 묶음');
  const part = (tag: number): TlvNode | undefined => parts.find((c) => c.tag === tag);
  const partsOf = (...tags: number[]): TlvNode[] => parts.filter((c) => tags.includes(c.tag));
  /** 목록 돌기: 항목 속이 깨지면 그 항목만 건너뛰고, 목록 틀이 깨지면 broken */
  const list = (node: TlvNode | undefined, what: string, itemWhat: string, fn: (tag: number, start: number, end: number) => void): void => {
    if (!node) return;
    let k = 0;
    const ok = r.eachSafe(node.start, node.end, (tag, start, end, clipped) => {
      if (clipped) return;
      if (++k % TICK_EVERY === 0) ctx.tick(start);
      try {
        fn(tag, start, end);
      } catch {
        ctx.damaged = true;
        note(ctx, `깨진 ${eul(itemWhat)} 건너뛰었습니다`);
      }
    });
    if (!ok) broken(what);
  };

  // 정점
  const vIndex = new Map<number, number>();
  const pts: number[] = [];
  list(part(TAG.VERTICES), '정점 목록', '정점', (tag, start, end) => {
    if (tag !== TAG.VERTEX) return;
    const node = { tag, start, end };
    const id = idOf(r, node);
    const p = r.first(node, TAG.POINT);
    if (id === undefined || !p || p.end - p.start < 24) {
      note(ctx, '좌표가 없는 정점을 건너뛰었습니다');
      return;
    }
    vIndex.set(id, pts.length / 3);
    pts.push(r.f64(p, 0), r.f64(p, 1), r.f64(p, 2));
  });
  ctx.counts.vertices += pts.length / 3;

  // 모서리(곡선 번호는 곡선을 읽은 뒤 곡선 차례로 바꾼다)
  const eIndex = new Map<number, number>();
  const edges: SkpEdge[] = [];
  const edgeCurve = new Map<number, number>();
  list(part(TAG.EDGES), '모서리 목록', '모서리', (tag, start, end) => {
    if (tag !== TAG.EDGE) return;
    const node = { tag, start, end };
    const b = readBase(r, node);
    const a = vIndex.get(r.uint(r.first(node, TAG.EDGE_START)) ?? -1);
    const z = vIndex.get(r.uint(r.first(node, TAG.EDGE_END)) ?? -1);
    if (a === undefined || z === undefined) {
      note(ctx, '정점을 찾지 못한 모서리를 건너뛰었습니다');
      return;
    }
    const e: SkpEdge = { a, b: z, flags: b.flags };
    if (b.layer !== undefined) e.layer = b.layer;
    if (b.material !== undefined) e.material = b.material;
    if (b.id !== undefined) {
      e.pid = b.id;
      if (!eIndex.has(b.id)) eIndex.set(b.id, edges.length);
    }
    const curve = r.uint(r.first(node, TAG.EDGE_CURVE));
    if (curve !== undefined) edgeCurve.set(edges.length, curve);
    const attrs = readHeaderAttrs(r, b.header, warn);
    if (attrs) e.attrs = attrs;
    edges.push(e);
  });
  ctx.counts.edges += edges.length;

  // 면
  const faces: SkpFace[] = [];
  list(part(TAG.FACES), '면 목록', '면', (tag, start, end) => {
    if (tag !== TAG.FACE) return;
    const node = { tag, start, end };
    const b = readBase(r, node);
    const plane = r.f64s(r.first(node, TAG.FACE_PLANE));
    const loopsN = r.first(node, TAG.FACE_LOOPS);
    if (!plane || plane.length < 3 || !loopsN) {
      note(ctx, '평면·고리가 없는 면을 건너뛰었습니다');
      return;
    }
    const loops: number[][] = [];
    const loopEdges: number[][] = [];
    const missing = { n: 0 };
    r.each(loopsN.start, loopsN.end, (lt, ls, le) => {
      if (lt !== TAG.LOOP) return;
      const uses = r.first({ tag: lt, start: ls, end: le }, TAG.LOOP_USES);
      if (!uses) return;
      const loop: number[] = [];
      const via: number[] = [];
      r.each(uses.start, uses.end, (ut, us, ue) => {
        if (ut !== TAG.EDGE_USE) return;
        const u = { tag: ut, start: us, end: ue };
        const ei = eIndex.get(r.uint(r.first(u, TAG.USE_EDGE)) ?? -1);
        if (ei === undefined) {
          missing.n++;
          return;
        }
        const e = edges[ei]!;
        // 뒤집힘이면 모서리 끝 정점에서 시작한다(모든 표본에서 고리가 이어지는 것으로 확인)
        loop.push(r.u8(r.first(u, TAG.USE_REVERSED)) ? e.b : e.a);
        via.push(ei);
      });
      if (loop.length >= 3) {
        loops.push(loop);
        loopEdges.push(via);
      }
    });
    if (missing.n > 0) note(ctx, '모서리를 찾지 못한 면 고리가 있습니다');
    if (loops.length === 0) return;
    const f: SkpFace = { loops, normal: [plane[0]!, plane[1]!, plane[2]!], flags: b.flags, loopEdges };
    if (b.material !== undefined) f.front = b.material;
    const back = r.uint(r.first(node, TAG.FACE_BACK));
    if (back !== undefined) f.back = back;
    if (b.layer !== undefined) f.layer = b.layer;
    if (b.id !== undefined) f.pid = b.id;
    const attrs = readHeaderAttrs(r, b.header, warn);
    if (attrs) f.attrs = attrs;
    faces.push(f);
  });
  ctx.counts.faces += faces.length;

  const out: SkpEntities = { points: Float64Array.from(pts), faces, edges, instances: [] };

  // 곡선·호
  const curveLists = partsOf(TAG.CURVES, TAG.ARC_CURVES);
  if (curveLists.length || edgeCurve.size) {
    let k = 0;
    const curves = readCurves(r, curveLists, edges, eIndex, edgeCurve, warn, (s) => {
      if (++k % TICK_EVERY === 0) ctx.tick(s);
    });
    if (curves.length) out.curves = curves;
  }

  // 컴포넌트·그룹·그림 인스턴스
  const instances = out.instances;
  const readInstance = (node: TlvNode, kind: NonNullable<SkpInstance['kind']>): void => {
    const b = readBase(r, node);
    const def = r.uint(r.first(node, TAG.INSTANCE_DEF));
    const xf = r.f64s(r.first(node, TAG.INSTANCE_XFORM));
    if (def === undefined || !xf || xf.length < 12) {
      note(ctx, '정의·변환이 없는 인스턴스를 건너뛰었습니다');
      return;
    }
    if (xf.length < 13) xf.push(1);
    const inst: SkpInstance = { definition: def, matrix: matrixFrom13(xf), flags: b.flags, kind };
    if (b.material !== undefined) inst.material = b.material;
    if (b.layer !== undefined) inst.layer = b.layer;
    if (b.id !== undefined) inst.pid = b.id;
    const name = r.str(r.first(node, TAG.INSTANCE_NAME));
    if (name) inst.name = name;
    const g = r.first(node, TAG.INSTANCE_GUID);
    const guid = g && kind !== 'image' ? ifcGuid(r.b.subarray(g.start, g.end)) : undefined;
    if (guid) inst.guid = guid;
    const attrs = readHeaderAttrs(r, b.header, warn);
    if (attrs) inst.attrs = attrs;
    instances.push(inst);
  };
  for (const listN of partsOf(TAG.COMPONENTS, TAG.GROUPS, TAG.IMAGES)) {
    const kind = listN.tag === TAG.GROUPS ? 'group' : listN.tag === TAG.IMAGES ? 'image' : 'component';
    const wrapper = listN.tag === TAG.GROUPS ? TAG.GROUP : listN.tag === TAG.IMAGES ? TAG.IMAGE : -1;
    list(listN, '인스턴스 목록', '인스턴스', (tag, start, end) => {
      if (tag === TAG.INSTANCE) readInstance({ tag, start, end }, kind);
      else if (tag === wrapper) {
        const inner = r.first({ tag, start, end }, TAG.INSTANCE);
        if (inner) readInstance(inner, kind);
      }
    });
  }
  ctx.counts.instances += instances.length;

  // 문자·치수·보조선·단면
  const texts: SkpText[] = [];
  const dims: SkpDimension[] = [];
  const guides: SkpGuide[] = [];
  const sections: SkpSectionPlane[] = [];
  const point = (i: number): Vec3 => [pts[3 * i]!, pts[3 * i + 1]!, pts[3 * i + 2]!];
  const local: PointLookups = {
    vertex: (pid) => {
      const i = vIndex.get(pid);
      return i === undefined ? undefined : point(i);
    },
    edgeMiddle: (pid) => {
      const i = eIndex.get(pid);
      if (i === undefined) return undefined;
      const a = point(edges[i]!.a);
      const z = point(edges[i]!.b);
      return [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2];
    },
    instance: () => undefined,
  };
  const env: AnnotEnv = {
    r,
    warn,
    fonts: ctx.fonts,
    local,
    localArc: (edgePid) => {
      const i = eIndex.get(edgePid);
      const c = i === undefined ? undefined : edges[i]!.curve;
      const arc = c === undefined ? undefined : out.curves?.[c];
      return arc?.center ? arc : undefined;
    },
    defer: (link, set) => ctx.pendingPoints.push({ link, set }),
    deferArc: (edge, dim, make) => ctx.pendingArcs.push({ edge, dim, make, list: dims }),
  };
  list(part(TAG.TEXTS), '문자 목록', '문자', (tag, start, end) => {
    if (tag === TAG.TEXT) texts.push(readText(env, { tag, start, end }));
  });
  list(part(TAG.LINEAR_DIMS), '치수 목록', '치수', (tag, start, end) => {
    if (tag === TAG.LINEAR_DIM) dims.push(readLinearDim(env, { tag, start, end }));
  });
  list(part(TAG.RADIAL_DIMS), '치수 목록', '치수', (tag, start, end) => {
    if (tag !== TAG.RADIAL_DIM) return;
    const d = readRadialDim(env, { tag, start, end });
    if (d) dims.push(d);
    else note(ctx, '잰 호를 찾지 못한 반지름·지름 치수를 건너뛰었습니다');
  });
  list(part(TAG.GUIDE_LINES), '보조선 목록', '보조선', (tag, start, end) => {
    if (tag !== TAG.GUIDE_LINE) return;
    const g = readGuideLine(env, { tag, start, end });
    if (g) guides.push(g);
    else note(ctx, '자료가 깨진 보조선을 건너뛰었습니다');
  });
  list(part(TAG.GUIDE_POINTS), '보조점 목록', '보조점', (tag, start, end) => {
    if (tag === TAG.GUIDE_POINT) guides.push(readGuidePoint(env, { tag, start, end }));
  });
  const activeSection = r.uint(part(TAG.ACTIVE_SECTION));
  list(part(TAG.SECTION_PLANES), '단면 목록', '단면', (tag, start, end) => {
    if (tag === TAG.SECTION) sections.push(readSection(env, { tag, start, end }, activeSection));
  });
  if (texts.length) out.texts = texts;
  if (dims.length) out.dimensions = dims;
  if (guides.length) out.guides = guides;
  if (sections.length) out.sections = sections;

  // 묶음 머리 속성(정의 속성, 뿌리면 모형 속성)
  try {
    const attrs = readBaseAttrs(r, r.firstSafe(n, TAG.BASE), warn);
    if (attrs) out.attrs = attrs;
  } catch {
    note(ctx, '깨진 속성 사전을 건너뛰었습니다');
  }
  return out;
}

/** 정의 동작 0x1b58 */
const SNAP_TO = ['any', 'horizontal', 'vertical', 'sloped'] as const;

function readBehavior(r: TlvReader, n: TlvNode): SkpBehavior {
  const num = (tag: number): number => r.uint(r.first(n, tag)) ?? 0;
  const snap = num(TAG.BEHAVIOR_SNAP_TO);
  const glued = num(TAG.BEHAVIOR_GLUED) !== 0;
  return {
    alwaysFaceCamera: num(TAG.BEHAVIOR_FACE_CAMERA) !== 0,
    cutsOpening: num(TAG.BEHAVIOR_CUTS_OPENING) !== 0,
    shadowsFaceSun: num(TAG.BEHAVIOR_SHADOWS_FACE_SUN) !== 0,
    snapTo: glued ? (SNAP_TO[snap] ?? snap) : 'none',
    noScaleMask: num(TAG.BEHAVIOR_NO_SCALE),
  };
}

/** 정의 칸(종류·GUID·설명·동작). 깨진 칸은 그 칸만 버린다 */
function readDefinitionFields(r: TlvReader, n: TlvNode, def: SkpDefinition): void {
  const safe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* 이 칸만 버린다 */
    }
  };
  safe(() => {
    const k = r.uint(r.firstSafe(n, TAG.DEF_KIND)) ?? 0;
    def.kind = k === 1 ? 'group' : k === 2 ? 'image' : 'component';
  });
  safe(() => {
    const g = r.firstSafe(n, TAG.DEF_GUID);
    const guid = g && ifcGuid(r.b.subarray(g.start, g.end));
    if (guid) def.guid = guid;
  });
  safe(() => {
    const d = r.str(r.firstSafe(n, TAG.DEF_DESCRIPTION));
    if (d) def.description = d;
  });
  safe(() => {
    const b = def.kind !== 'image' ? r.firstSafe(n, TAG.BEHAVIOR) : undefined;
    if (b) def.behavior = readBehavior(r, b);
  });
}

/**
 * 모형 전체를 읽은 뒤: 그림 정의를 가리키는 인스턴스를 그림으로, 다른 묶음·인스턴스 안에 붙은 치수 점과 반지름 치수의 호를 푼다.
 * 필요한 번호만 모아 한 번 더 돈다(정점마다 Map을 만들지 않는다).
 */
function finish(ctx: Ctx, all: SkpEntities[], definitions: Map<number, SkpDefinition>): void {
  for (const ents of all)
    for (const inst of ents.instances)
      if (definitions.get(inst.definition)?.kind === 'image') {
        inst.kind = 'image';
        delete inst.guid;
      }
  if (!ctx.pendingPoints.length && !ctx.pendingArcs.length) return;
  const wantV = new Set<number>();
  const wantE = new Set<number>();
  const wantI = new Set<number>();
  for (const p of ctx.pendingPoints) {
    (p.link.kind === 2 ? wantV : wantE).add(p.link.target);
    for (const id of p.link.path) wantI.add(id);
  }
  for (const a of ctx.pendingArcs) wantE.add(a.edge);
  const inst = new Map<number, Float64Array>();
  const edgeAt = new Map<number, { ents: SkpEntities; edge: SkpEdge }>();
  for (const ents of all) {
    if (wantI.size)
      for (const i of ents.instances) if (i.pid !== undefined && wantI.has(i.pid) && !inst.has(i.pid)) inst.set(i.pid, i.matrix);
    if (wantE.size)
      for (const e of ents.edges) if (e.pid !== undefined && wantE.has(e.pid) && !edgeAt.has(e.pid)) edgeAt.set(e.pid, { ents, edge: e });
  }
  const verts = new Map<number, Vec3>();
  if (wantV.size) {
    const r = ctx.r;
    for (const n of ctx.entityNodes) {
      if (verts.size === wantV.size) break;
      try {
        const vl = r.firstSafe(n, TAG.VERTICES, true);
        if (!vl) continue;
        r.eachSafe(vl.start, vl.end, (tag, start, end, clipped) => {
          if (tag !== TAG.VERTEX || clipped) return;
          const node = { tag, start, end };
          const id = idOf(r, node);
          if (id === undefined || !wantV.has(id) || verts.has(id)) return;
          const p = r.vec3(r.first(node, TAG.POINT));
          if (p) verts.set(id, p);
        });
      } catch {
        /* 깨진 묶음은 건너뛴다 */
      }
    }
  }
  const pt = (ents: SkpEntities, i: number): Vec3 => [ents.points[3 * i]!, ents.points[3 * i + 1]!, ents.points[3 * i + 2]!];
  const global: PointLookups = {
    vertex: (pid) => verts.get(pid),
    edgeMiddle: (pid) => {
      const f = edgeAt.get(pid);
      if (!f) return undefined;
      const a = pt(f.ents, f.edge.a);
      const z = pt(f.ents, f.edge.b);
      return [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2];
    },
    instance: (pid) => inst.get(pid),
  };
  let unresolved = 0;
  for (const p of ctx.pendingPoints) {
    const pos = resolveLink(p.link, global);
    if (pos) p.set(pos);
    else unresolved++;
  }
  if (unresolved) note(ctx, `붙은 치수 점 ${unresolved}개의 대상을 찾지 못해 저장된 위치를 씁니다`);
  for (const a of ctx.pendingArcs) {
    const f = edgeAt.get(a.edge);
    const c = f && f.edge.curve !== undefined ? f.ents.curves?.[f.edge.curve] : undefined;
    if (c && a.make(c)) continue;
    const i = a.list.indexOf(a.dim);
    if (i >= 0) a.list.splice(i, 1);
    note(ctx, '잰 호를 찾지 못한 반지름·지름 치수를 건너뛰었습니다');
  }
}

/**
 * model.dat 바이트 → 중간 모형. 뿌리가 맞지 않으면 Error.
 * 잘렸거나 꼬리표 길이가 깨진 곳이 있으면 그 앞까지 읽고 경고한다(모형이 damaged).
 * 뿌리 절(카메라·장면·태그·스타일 …)은 하나가 깨져도 그 절만 버리고 형상 읽기는 계속한다.
 * onProgress는 읽은 바이트 위치로 진행(0~1)을 알린다.
 */
export function readModelDat(bytes: Uint8Array, onProgress?: (fraction: number) => void): SkpModel {
  const r = new TlvReader(bytes);
  if (bytes.length < 6 || r.dv.getUint16(0, true) !== TAG.ROOT) throw new Error('model.dat 뿌리 꼬리표가 다릅니다');
  const rootLen = r.dv.getUint32(2, true);
  const root: TlvNode = { tag: TAG.ROOT, start: 6, end: Math.min(bytes.length, 6 + rootLen) };
  let last = 0;
  const tick = (pos: number): void => {
    const f = pos / Math.max(1, bytes.length);
    if (!onProgress || f <= last) return;
    last = f;
    try {
      onProgress(f);
    } catch {
      /* 알림 쪽 오류는 무시 */
    }
  };
  const ctx: Ctx = {
    r,
    warn: new Map(),
    counts: { vertices: 0, edges: 0, faces: 0, instances: 0 },
    tick,
    damaged: false,
    fonts: new Map(),
    entityNodes: [],
    pendingPoints: [],
    pendingArcs: [],
  };
  const warn: Warn = (m) => note(ctx, m);
  if (6 + rootLen > bytes.length) {
    ctx.damaged = true;
    note(ctx, 'model.dat가 잘렸습니다(파일 끝까지 받지 못했을 수 있습니다) — 읽을 수 있는 앞부분만 씁니다');
  }

  // 뿌리의 절(section)들: 깨진 곳 앞까지. 정의·모형 요소 묶음은 잘렸어도 앞부분을 살린다
  const sections = new Map<number, TlvNode & { clipped: boolean }>();
  const rootOk = r.eachSafe(
    root.start,
    root.end,
    (tag, start, end, clipped) => {
      if (clipped && tag !== TAG.DEFINITIONS && tag !== TAG.MODEL_ENTITIES) return;
      if (!sections.has(tag)) sections.set(tag, { tag, start, end, clipped });
    },
    true,
  );
  if (!rootOk && 6 + rootLen <= bytes.length) {
    ctx.damaged = true;
    note(ctx, 'model.dat 안의 꼬리표 길이가 깨져 뒷부분을 읽지 못했습니다');
  }

  /** 절 안을 경로대로 내려가기(깨진 것은 undefined) */
  const at = (sec: TlvNode | undefined, ...tags: number[]): TlvNode | undefined => {
    let cur = sec;
    for (const t of tags) {
      if (!cur) return undefined;
      cur = r.firstSafe(cur, t, true);
    }
    return cur;
  };
  /** 뿌리 절 하나 읽기: 실패해도 형상 읽기는 계속한다 */
  const section = <T>(tag: number, what: string, fn: (n: TlvNode) => T): T | undefined => {
    const n = sections.get(tag);
    if (!n || n.clipped) return undefined;
    try {
      return fn(n);
    } catch {
      note(ctx, `${eul(what)} 읽지 못했습니다`);
      return undefined;
    }
  };

  const materials = new Map<number, string>();
  const matItems = at(sections.get(TAG.MATERIALS), TAG.MAT_LIST, TAG.MAT_ITEMS);
  if (matItems)
    r.eachSafe(matItems.start, matItems.end, (tag, start, end, clipped) => {
      if (tag !== TAG.MAT || clipped) return;
      const n = { tag, start, end };
      try {
        const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
        if (id !== undefined) materials.set(id, r.str(r.first(n, TAG.MAT_NAME)) ?? `재질 ${id}`);
      } catch {
        note(ctx, '깨진 재질 항목을 건너뛰었습니다');
      }
    });

  const lineStyles = section(TAG.LINESTYLE_SECTION, '선 종류', (n) => readLineStyles(r, n)) ?? new Map<number, string>();
  const layerSet: LayerSet = section(TAG.LAYERS, '태그 목록', (n) => readLayers(r, n, lineStyles, warn)) ?? {
    layers: new Map(),
    tags: [],
    folders: [],
    index: new Map(),
    defaultHidden: new Set(),
  };
  const fonts = section(TAG.FONT_SECTION, '글꼴 목록', (n) => readFonts(r, n));
  if (fonts) ctx.fonts = fonts;
  const options = section(TAG.OPTIONS, '단위 설정', (n) => readOptions(r, n, warn));

  const definitions = new Map<number, SkpDefinition>();
  const defItems = at(sections.get(TAG.DEFINITIONS), TAG.DEF_LIST, TAG.DEF_ITEMS);
  if (defItems)
    r.eachSafe(
      defItems.start,
      defItems.end,
      (tag, start, end, clipped) => {
        if (tag !== TAG.DEFINITION) return;
        const n = { tag, start, end };
        ctx.tick(start);
        // 정의 하나가 깨져도 나머지는 읽는다. 파일 끝에서 잘린 정의는 앞부분만 살린다
        try {
          const ents = r.firstSafe(n, TAG.ENTITIES, clipped);
          if (!ents) return;
          const id = idOf(r, ents);
          if (id === undefined) {
            note(ctx, '번호가 없는 정의를 건너뛰었습니다');
            return;
          }
          let name: string | undefined;
          try {
            name = r.str(r.firstSafe(n, TAG.DEF_NAME));
          } catch {
            /* 이름 없이 */
          }
          const def: SkpDefinition = { id, name: name ?? `정의 ${id}`, entities: readEntities(ctx, ents, clipped) };
          readDefinitionFields(r, n, def);
          definitions.set(id, def);
          if (clipped) ctx.damaged = true;
        } catch {
          ctx.damaged = true;
          note(ctx, '깨진 컴포넌트 정의를 건너뛰었습니다');
        }
      },
      true,
    );

  const empty = (): SkpEntities => ({ points: new Float64Array(0), faces: [], edges: [], instances: [] });
  const modelEnts = at(sections.get(TAG.MODEL_ENTITIES), TAG.ENTITIES);
  let rootEnts = empty();
  if (!modelEnts) note(ctx, '모형 요소(01f6)를 찾지 못했습니다');
  else
    try {
      rootEnts = readEntities(ctx, modelEnts, true);
    } catch {
      ctx.damaged = true;
      note(ctx, '모형 요소(01f6)가 깨져 읽지 못했습니다');
    }
  try {
    finish(ctx, [rootEnts, ...[...definitions.values()].map((d) => d.entities)], definitions);
  } catch {
    note(ctx, '붙은 치수 점을 풀지 못했습니다');
  }

  // 뿌리 절(형상 뒤: 실패해도 형상은 그대로)
  const camera = section(TAG.CAMERA_SECTION, '카메라', (n) => {
    const c = r.firstSafe(n, TAG.CAMERA);
    return c ? readCamera(r, c, warn) : undefined;
  });
  const styles: StyleSet = section(TAG.STYLE_SECTION, '스타일 목록', (n) => readStyles(r, n)) ?? { names: new Map() };
  const rendering = section(TAG.RENDER_SECTION, '렌더링 설정', (n): SkpRenderingRaw | undefined => {
    const rec = r.firstSafe(n, TAG.RENDERING);
    if (!rec) return undefined;
    const raw: SkpRenderingRaw = { values: readRenderingValues(r, rec) };
    const look = styles.working ?? styles.active;
    if (look !== undefined) raw.styleName = look;
    if (styles.active !== undefined) raw.activeName = styles.active;
    return raw;
  });
  const animation = options ? animationFromOptions(options) : undefined;
  const pages = section(TAG.PAGE_SECTION, '장면 목록', (n) => readPages(r, n, layerSet, styles, animation, warn));
  let defaults: SkpAnnotationDefaults | undefined;
  try {
    const t = sections.get(TAG.TEXT_DEFAULTS_SECTION);
    const d = sections.get(TAG.DIM_DEFAULTS_SECTION);
    defaults = readAnnotationDefaults(r, t && !t.clipped ? t : undefined, d && !d.clipped ? d : undefined, ctx.fonts);
  } catch {
    note(ctx, '문자·치수 기본값을 읽지 못했습니다');
  }
  const props = section(TAG.PROPS_SECTION, '모형 속성', (n) => readModelProperties(r, n, warn));

  const warnings = [...ctx.warn].map(([m, k]) => (k > 1 ? `${m} (${k}개)` : m));
  const model: SkpModel = { materials, layers: layerSet.layers, definitions, root: rootEnts, counts: ctx.counts, warnings };
  if (layerSet.defaultLayer !== undefined) model.defaultLayer = layerSet.defaultLayer;
  if (layerSet.activeLayer !== undefined) model.activeLayer = layerSet.activeLayer;
  if (layerSet.tags.length) model.tags = layerSet.tags;
  if (layerSet.folders.length) model.tagFolders = layerSet.folders;
  if (options) {
    const lu = lengthUnitCode(options);
    if (lu !== undefined) model.lengthUnit = lu;
    const units = unitsFromOptions(options);
    if (units) model.units = units;
  }
  if (animation) model.animation = animation;
  if (camera) model.camera = camera;
  if (rendering) model.rendering = rendering;
  if (pages?.pages.length) {
    model.pages = pages.pages;
    if (pages.active !== undefined) model.activePage = pages.active;
  }
  if (fonts?.size) model.fonts = fonts;
  if (defaults) model.annotationDefaults = defaults;
  if (props?.properties) model.properties = props.properties;
  if (props?.name !== undefined) model.name = props.name;
  if (props?.description !== undefined) model.description = props.description;
  if (ctx.damaged) model.damaged = true;
  return model;
}
