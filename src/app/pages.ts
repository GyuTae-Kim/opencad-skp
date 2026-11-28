/**
 * 장면(페이지)·저장 카메라·스타일 읽기와 코어를 쓰지 않는 장면 규칙(순수 함수, DOM 없음 — 코어를 값으로 가져오지 않는다).
 *
 * - 읽기: meta의 카메라·장면·스타일·그림자·그리기 축·단면 평면(모르는 꼴이어도 안전하게) — doc.ts가 문서를 만들 때 부른다.
 * - 장면 적용: 장면이 기억하는 것(use 깃발이 켜진 칸)만 바꾼다 — 카메라, 숨긴 태그(기억하면 모든 태그를 그 값으로),
 *   숨긴 개체(기억하면 숨긴 노드 전체를 그 목록으로), 활성 단면, 스타일. 기억하지 않은 것은 지금 상태 그대로 둔다.
 *   여기에는 그 가운데 코어를 쓰지 않는 규칙(활성 단면, 스타일의 그리기 방식·단면 채우기, 태그 폴더, 전환·지연 시간, 장면 차례·재생, 지금 장면, 걷기 선택)을 둔다.
 * - 227차: 카메라 갈래(SketchUp 카메라 → 코어 CameraState, 세로 화면 맞춤, 처음 카메라, 장면 적용 계획 pagePlan, 전환 카메라)는 장면 카메라 조각(scenecam.ts)으로 옮겼다 —
 *   코어 camera를 값으로 써서 첫 화면 조각에 코어 camera·math·bounds를 실었다. 보기 기록 필드 초기값이 쓰는 sameSceneFit과 SceneFit 형은 여기 둔다.
 * 규칙은 비공개 참조 뷰어의 카메라·장면 코드와 그쪽 형식 명세에서 옮겼다.
 */
import type { RenderMode } from 'opencad-viewer3d';
import type { Projection } from 'opencad-viewer3d/camera';
import type { Rgb, SkpAxesMeta, SkpCameraMeta, SkpFaceStyle, SkpPageMeta, SkpSectionPlaneMeta, SkpShadowMeta, SkpStyleMeta, Vec3 } from '../meta';

/** SketchUp 기본 틀의 세로 시야각(도) — 원근 카메라에 시야각이 없을 때 */
export const SKP_DEFAULT_FOV_DEG = 35;
/** 장면 전환 기본 시간(SketchUp 모형 정보 › 애니메이션 기본값) */
export const DEFAULT_TRANSITION_S = 2;
/** 이보다 긴 전환 시간(깨졌거나 이상한 값)은 여기서 자른다 */
export const MAX_TRANSITION_S = 60;
/** 장면 지연(슬라이드 쇼) 기본·최대 */
export const DEFAULT_DELAY_S = 1;
export const MAX_DELAY_S = 3600;
/** 태그 폴더 조상을 따라 올라갈 최대 단계 */
const FOLDER_DEPTH = 64;

// isNum·obj·sub(유한한 수·객체·벡터 빼기)는 장면 카메라 조각(scenecam.ts)도 같은 것을 쓴다
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [x, y, z] = v as unknown[];
  return isNum(x) && isNum(y) && isNum(z) ? [x, y, z] : null;
}

function rgb(v: unknown): Rgb | null {
  const c = vec3(v);
  return c ? [Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))] : null;
}

export const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];

// ───────────────────────── 카메라 ─────────────────────────

/** meta.camera·장면 카메라(모르는 꼴이어도 안전하게) → 카메라. 눈·목표가 없거나 같은 점이면 null */
export function readCamera(v: unknown): SkpCameraMeta | null {
  const o = obj(v);
  if (!o) return null;
  const eye = vec3(o.eye);
  const target = vec3(o.target);
  if (!eye || !target) return null;
  const d = Math.hypot(...sub(eye, target));
  if (!(d > 0) || !Number.isFinite(d)) return null;
  const up = vec3(o.up);
  const out: SkpCameraMeta = { eye, target, up: up && Math.hypot(...up) > 0 ? up : [0, 0, 1], perspective: o.perspective !== false };
  if (isNum(o.fovY) && o.fovY > 0 && o.fovY < 180) out.fovY = o.fovY;
  if (isNum(o.height) && o.height > 0) out.height = o.height;
  if (isNum(o.aspect) && o.aspect > 0) out.aspect = o.aspect;
  if (o.twoPoint === true) out.twoPoint = true;
  return out;
}

// 227차: 읽은 카메라 → 코어 카메라(cameraFromSkp·굴림·2점 투시·시야각 바꾸기)와 새 문서 카메라는 장면 카메라 조각(scenecam.ts)에

/** 걷기 눈높이: SketchUp 기본 5′6″(1.676 m)를 장면 단위로(단위를 모르면 undefined — 코어가 범위로 정한다) */
export function eyeHeightFor(units: string): number | undefined {
  const mm = units === 'mm' ? 1 : units === 'inch' ? 25.4 : units === 'm' ? 1000 : 0;
  return mm ? 1676.4 / mm : undefined;
}

/**
 * 걷기 선택(코어 0.8.0 setNavigation('walk', opts)): SketchUp 걷기처럼 눈높이 5′6″·두 번 누르면 서기에, 바닥 따라가기(중력)와
 * 벽 앞 멈춤(부딪힘)은 켜고 끄는 값 그대로. 단위를 모르면 눈높이는 코어 기본
 */
export function walkOptionsFor(units: string, gravity: boolean, collide: boolean): { eyeHeight?: number; tapToStand: boolean; gravity: boolean; collide: boolean } {
  const eye = eyeHeightFor(units);
  return eye !== undefined ? { eyeHeight: eye, tapToStand: true, gravity, collide } : { tapToStand: true, gravity, collide };
}

/** 두 SketchUp 카메라가 같은 보기인지(눈·목표가 눈-목표 거리의 tolerance배 안, 투영·시야각·높이가 같음) */
export function sameSkpCamera(a: SkpCameraMeta | null | undefined, b: SkpCameraMeta | null | undefined, tolerance = 1e-4): boolean {
  const x = readCamera(a);
  const y = readCamera(b);
  if (!x || !y) return false;
  const span = Math.max(1e-9, Math.hypot(...sub(x.eye, x.target)));
  const near = (p: Vec3, q: Vec3): boolean => Math.hypot(...sub(p, q)) <= tolerance * span;
  if (!near(x.eye, y.eye) || !near(x.target, y.target) || x.perspective !== y.perspective) return false;
  if (x.perspective) return Math.abs((x.fovY ?? SKP_DEFAULT_FOV_DEG) - (y.fovY ?? SKP_DEFAULT_FOV_DEG)) <= 1e-6;
  if (x.height === undefined || y.height === undefined) return x.height === y.height;
  return Math.abs(x.height - y.height) <= tolerance * span;
}

// ───────────────────────── 세로 화면 맞춤 ─────────────────────────
// 227차: 맞춤 함수(fitSceneCamera·refitSceneCamera·unwidenSceneCamera·restoreSceneCamera·처음 카메라 initialView)는 장면 카메라 조각(scenecam.ts)에.
// 맞춘 상태의 형과, 보기 기록 필드 초기값이 쓰는 sameSceneFit(처음 화면에서 만든다)만 여기 둔다

/** 장면 카메라를 지금 화면에 맞춘 상태(화면을 돌리면 refitSceneCamera로 다시 맞춘다) */
export interface SceneFit {
  /** 장면이 만들어진 종횡비 */
  ref: number;
  /** 넓힌 배율(1 = 그대로) */
  scale: number;
  /** 장면의 원래 세로 시야각(라디안, 원근) */
  baseFovY: number;
  /** 맞춘 뒤의 투영·시야각 — 사용자가 바꾸면 더 따라가지 않는다 */
  projection: Projection;
  fovY: number;
}

/** 같은 장면 맞춤인지(배율·시야각만 다르면 같은 것 — 휴대폰을 돌려 다시 맞춘 것) */
export function sameSceneFit(a: SceneFit | null, b: SceneFit | null): boolean {
  if (!a || !b) return a === b;
  return a.projection === b.projection && Math.abs(a.baseFovY - b.baseFovY) < 1e-12 && Math.abs(a.ref - b.ref) < 1e-12;
}

/**
 * 파일을 열 때 "지금 장면"으로 표시할 차례: 활성 장면의 카메라가 모형 카메라와 같을 때만(SketchUp은 열면 모형 카메라로 보이고,
 * 저장 전에 보기를 돌렸으면 활성 장면과 다르다). 카메라를 기억하지 않는 활성 장면은 그대로 활성으로 본다.
 */
export function openingPage(meta: unknown): number | null {
  const m = obj(meta);
  const pages = readPages(meta);
  const active = readActivePage(meta, pages.length);
  if (active === null) return null;
  const page = pages[active]!;
  if (!page.camera) return active;
  return sameSkpCamera(page.camera, readCamera(m?.camera)) ? active : null;
}

// ───────────────────────── 장면 읽기 ─────────────────────────

const FACE_STYLES = new Set<SkpFaceStyle>(['wireframe', 'hiddenLine', 'shaded', 'textured', 'monochrome']);
const STYLE_FLAGS = [
  'xray',
  'edges',
  'profiles',
  'backEdges',
  'hiddenGeometry',
  'hiddenObjects',
  'axes',
  'texts',
  'dimensions',
  'guides',
  'sectionPlanes',
  'sectionCuts',
  'sectionFill',
  'colorByTag',
  'fog',
  'fogUseBackground',
] as const;
const STYLE_COLORS = ['background', 'front', 'back', 'edgeColor', 'fogColor'] as const;

/** 스타일(모르는 꼴이어도 안전하게). 알아본 칸만 남긴다 — 객체가 아니면 null */
export function readStyle(v: unknown): SkpStyleMeta | null {
  const o = obj(v);
  if (!o) return null;
  const out: SkpStyleMeta = {};
  if (typeof o.name === 'string') out.name = o.name;
  if (typeof o.faceStyle === 'string' && FACE_STYLES.has(o.faceStyle as SkpFaceStyle)) out.faceStyle = o.faceStyle as SkpFaceStyle;
  for (const k of STYLE_FLAGS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  for (const k of STYLE_COLORS) {
    const c = rgb(o[k]);
    if (c) out[k] = c;
  }
  for (const k of ['fogStart', 'fogEnd'] as const) if (isNum(o[k])) out[k] = o[k] as number;
  if (isNum(o.profileWidth) && o.profileWidth > 0) out.profileWidth = o.profileWidth;
  for (const k of ['sky', 'ground'] as const) {
    if (o[k] === null) out[k] = null;
    else {
      const c = rgb(o[k]);
      if (c) out[k] = c;
    }
  }
  return out;
}

/** 0 이상 유한한 초(그 밖은 undefined) */
const seconds = (v: unknown): number | undefined => (isNum(v) && v >= 0 ? v : undefined);

/**
 * 앱이 읽은 장면. 이름이 없는 장면(해석기는 빈 글)은 이름 칸에 앱 글 "장면 n"을 넣고 unnamed를 남긴다 — 화면은 그 이름만 화면 언어로 옮긴다
 * (149차: 장면 탭·정보 탭이 이름을 파일 글로 그려 네 언어 모두 한국어였다. 글로 가르면 파일이 "장면 3"이라 붙인 이름까지 옮겨져 표시로 가른다)
 */
export interface ScenePage extends SkpPageMeta {
  unnamed?: true;
}

/** 장면 하나(모르는 꼴이어도 안전하게). 이름이 없으면 "장면 n"과 unnamed */
export function readPage(v: unknown, index: number): ScenePage {
  const o = obj(v) ?? {};
  const page: ScenePage = typeof o.name === 'string' && o.name ? { name: o.name } : { name: `장면 ${index + 1}`, unnamed: true };
  if (typeof o.description === 'string' && o.description) page.description = o.description;
  const cam = readCamera(o.camera);
  if (cam) page.camera = cam;
  if (Array.isArray(o.hiddenTags)) page.hiddenTags = o.hiddenTags.filter((t): t is string => typeof t === 'string');
  // 차례 목록(0 이상 정수만)
  for (const k of ['hiddenNodes', 'hiddenFolders', 'sectionPlanes', 'hiddenAnnotations'] as const) {
    const a = o[k];
    if (Array.isArray(a)) page[k] = a.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0);
  }
  const style = readStyle(o.style);
  if (style) page.style = style;
  const transition = seconds(o.transition);
  if (transition !== undefined) page.transition = transition;
  const delay = seconds(o.delay);
  if (delay !== undefined) page.delay = delay;
  if (typeof o.thumbnail === 'string' && o.thumbnail) page.thumbnail = o.thumbnail;
  if (o.includeInAnimation === false) page.includeInAnimation = false;
  const shadow = readShadow(o.shadow);
  if (shadow) page.shadow = shadow;
  // 73차: 장면이 기억하는 그리기 축(null = 기본 축, 꼴이 다르면 기억하지 않는 장면처럼)
  const axes = readAxes(o.axes);
  if (axes !== undefined) page.axes = axes;
  return page;
}

const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** meta.axes·장면 axes: null이면 null(장면이 기억한 기본 축), 꼴이 다르면 undefined */
export function readAxes(v: unknown): SkpAxesMeta | null | undefined {
  const o = obj(v);
  return v === null ? null : o && isVec3(o.origin) && isVec3(o.x) && isVec3(o.y) && isVec3(o.z) ? { origin: o.origin, x: o.x, y: o.y, z: o.z } : undefined;
}

/** 그림자 설정(모르는 꼴이어도 안전하게 — 수·참거짓·북쪽 벡터만 남긴다). 객체가 아니면 null */
export function readShadow(v: unknown): SkpShadowMeta | null {
  const o = obj(v);
  if (!o) return null;
  const out: SkpShadowMeta = {};
  for (const k of ['time', 'latitude', 'longitude', 'tz', 'light', 'dark'] as const) if (isNum(o[k])) out[k] = o[k] as number;
  for (const k of ['city', 'country'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of ['display', 'onFaces', 'onGround', 'useSun'] as const) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  const n = vec3(o.north);
  if (n) out.north = n;
  return out;
}

/** meta.pages → 장면 목록. 차례는 파일 그대로 지킨다(activePage·장면 단면 차례가 이 차례를 가리킨다) */
export function readPages(meta: unknown): ScenePage[] {
  const list = obj(meta)?.pages;
  return Array.isArray(list) ? list.map((p, i) => readPage(p, i)) : [];
}

/** meta.activePage(장면 수 안의 정수만) */
export function readActivePage(meta: unknown, count: number): number | null {
  const a = obj(meta)?.activePage;
  return Number.isInteger(a) && (a as number) >= 0 && (a as number) < count ? (a as number) : null;
}

/** 단면 평면 하나(모르는 꼴이면 null) */
export function readSectionPlane(v: unknown): SkpSectionPlaneMeta | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.plane) || o.plane.length < 4) return null;
  const pl = o.plane.slice(0, 4);
  if (!pl.every(isNum)) return null;
  const plane = pl as [number, number, number, number];
  if (!(Math.hypot(plane[0], plane[1], plane[2]) > 0)) return null;
  return {
    name: typeof o.name === 'string' ? o.name : '',
    plane,
    active: o.active === true,
    tag: typeof o.tag === 'string' ? o.tag : '',
    hidden: o.hidden === true,
    node: Number.isInteger(o.node) ? (o.node as number) : -1,
    size: isNum(o.size) && o.size > 0 ? o.size : 0,
  };
}

// ───────────────────────── 단면 ─────────────────────────

/** 코어 setSection 꼴로 바꾼 파일 단면 */
export interface PageSection {
  /** meta.sectionPlanes 차례 */
  index: number;
  plane: SkpSectionPlaneMeta;
  /** 잘라 내는 쪽 법선(코어: normal·p > offset 쪽을 잘라 낸다) */
  normal: Vec3;
  offset: number;
}

/**
 * SketchUp 단면 평면 [a, b, c, d](a·x + b·y + c·z + d ≥ 0 쪽이 남는다) → 코어 setSection 꼴.
 * 코어는 normal·p > offset 쪽을 잘라 내므로 normal = −(a, b, c), offset = d (−(a,b,c)·p > d ⇔ a·p + d < 0 이 잘린다).
 * 법선이 0이거나 값이 이상하면 null.
 */
export function sectionToViewer(plane: readonly number[]): { normal: Vec3; offset: number } | null {
  if (plane.length < 4 || !plane.slice(0, 4).every(isNum)) return null;
  const [a, b, c, d] = plane as [number, number, number, number];
  if (!(Math.hypot(a, b, c) > 0)) return null;
  return { normal: [-a || 0, -b || 0, -c || 0], offset: d };
}

/**
 * 활성 단면 차례들 → 모형 단면(node −1) 가운데 처음 것(없으면 null). 여러 단면은 activeSections
 */
export function pickSection(indices: readonly number[], planes: readonly unknown[]): PageSection | null {
  return activeSections(indices, planes).find((s) => s.plane.node === -1) ?? null;
}

/**
 * 활성 단면 차례들 → 코어 setSections에 넘길 평면들: 모형 단면(node −1, 모형 전체를 자른다)이 먼저, 그다음 그룹·컴포넌트 안 단면(그 노드 안쪽만 —
 * 앱이 노드의 항목을 items로 준다)을 파일 차례대로. SketchUp은 묶음(노드)마다 활성 단면이 하나라 같은 노드는 처음 것만. 읽지 못한 평면은 뺀다
 */
export function activeSections(indices: readonly number[], planes: readonly unknown[]): PageSection[] {
  const out: PageSection[] = [];
  const nodes = new Set<number>();
  for (const index of indices) {
    const plane = readSectionPlane(planes[index]);
    if (!plane || nodes.has(plane.node)) continue;
    const v = sectionToViewer(plane.plane);
    if (!v) continue;
    nodes.add(plane.node);
    out.push({ index, plane, ...v });
  }
  return out.sort((a, b) => Number(a.plane.node !== -1) - Number(b.plane.node !== -1));
}

/**
 * 파일을 열 때의 단면: 활성(active)인 단면 모두(activeSections). 모형 스타일이 단면 자르기를 끈 경우(sectionCuts false)는 없음.
 */
export function initialSections(meta: unknown): PageSection[] {
  const m = obj(meta);
  const list = Array.isArray(m?.sectionPlanes) ? (m!.sectionPlanes as unknown[]) : [];
  if (readStyle(m?.style)?.sectionCuts === false) return [];
  const active: number[] = [];
  list.forEach((p, i) => {
    if (readSectionPlane(p)?.active) active.push(i);
  });
  return activeSections(active, list);
}

/** 파일을 열 때의 모형 단면 하나(initialSections 가운데 모형 단면) */
export function initialSection(meta: unknown): PageSection | null {
  return initialSections(meta).find((s) => s.plane.node === -1) ?? null;
}

// ───────────────────────── 스타일 ─────────────────────────

/**
 * 스타일 → 코어 그리기 방식. 모르면 null(지금 방식 그대로).
 * - 와이어프레임(RenderMode 0) → 'wireframe'(면이 없으니 X-ray보다 먼저)
 * - X-ray → 'xray'
 * - 은선(RenderMode 1) → 'hiddenLine'(면을 배경 색으로 채워 뒤 모서리를 가린다), 단색(5) → 'monochrome',
 *   무늬를 끈 음영(Texture 꺼짐) → 'noTexture'
 * - 무늬 음영 → 모서리 보이기(edges)가 꺼졌으면 'shaded', 아니면 'shadedEdges'
 * - 면 스타일이 없고 모서리 보이기만 있으면 그것만 따른다.
 */
export function renderModeForStyle(style: SkpStyleMeta | null | undefined): RenderMode | null {
  if (!style) return null;
  if (style.faceStyle === 'wireframe') return 'wireframe';
  if (style.xray === true) return 'xray';
  if (style.faceStyle === 'hiddenLine') return 'hiddenLine';
  if (style.faceStyle === 'monochrome') return 'monochrome';
  if (style.faceStyle === 'shaded') return 'noTexture';
  if (style.faceStyle) return style.edges === false ? 'shaded' : 'shadedEdges';
  if (typeof style.edges === 'boolean') return style.edges ? 'shadedEdges' : 'shaded';
  return null;
}

/** 음영 계열 그리기 방식(면이 불투명하게 앞을 가린다 — 라벨 가림·채우기) */
export const SHADED_MODES: ReadonlySet<RenderMode> = new Set(['shaded', 'shadedEdges', 'hiddenLine', 'monochrome', 'noTexture']);

/**
 * 단면에서 잘린 면을 채울지(스타일 "단면 채우기"). 스타일이 값을 가지면 그것, 없으면 SketchUp 2018(채우기가 생긴 판) 이상이면 채운다.
 * 판을 모르면 채운다(앱의 X·Y·Z 단면도 같은 값을 쓴다)
 */
export function sectionFillOf(style: Pick<SkpStyleMeta, 'sectionFill'> | null | undefined, major: number | null | undefined): boolean {
  if (typeof style?.sectionFill === 'boolean') return style.sectionFill;
  return !(isNum(major) && major < 18);
}

// ───────────────────────── 태그 ─────────────────────────

interface TagStatLike {
  name: string;
  visible: boolean;
  folder: number;
}

function readTagStats(tagStats: unknown): TagStatLike[] {
  if (!Array.isArray(tagStats)) return [];
  const out: TagStatLike[] = [];
  for (const t of tagStats) {
    const o = obj(t);
    if (!o || typeof o.name !== 'string') continue;
    out.push({ name: o.name, visible: o.visible !== false, folder: Number.isInteger(o.folder) ? (o.folder as number) : -1 });
  }
  return out;
}

/** 폴더 차례 → 그 폴더나 조상 폴더가 숨겨졌는지(64단계까지, 고리는 거기서 멈춘다) */
function folderHiddenFn(folders: unknown): (i: number) => boolean {
  const list = Array.isArray(folders) ? folders.map(obj) : [];
  const memo = new Map<number, boolean>();
  return (start: number): boolean => {
    if (memo.has(start)) return memo.get(start)!;
    let hidden = false;
    let i = start;
    for (let k = 0; k < FOLDER_DEPTH && Number.isInteger(i) && i >= 0 && i < list.length; k++) {
      const f = list[i];
      if (!f) break;
      if (f.visible === false) {
        hidden = true;
        break;
      }
      i = Number.isInteger(f.parent) ? (f.parent as number) : -1;
    }
    memo.set(start, hidden);
    return hidden;
  };
}

/** 조상 폴더가 숨겨 숨는 태그 이름(태그 자신의 보임과 상관없이) */
export function folderHiddenTags(tagStats: unknown, folders: unknown): Set<string> {
  const hiddenFolder = folderHiddenFn(folders);
  const out = new Set<string>();
  for (const t of readTagStats(tagStats)) if (t.folder >= 0 && hiddenFolder(t.folder)) out.add(t.name);
  return out;
}

/**
 * 처음 숨길 태그 이름: 태그 실제 보임 = 태그 visible && 모든 조상 폴더 visible.
 * tagStats는 meta.tagStats(visible·folder 칸), folders는 meta.tagFolders.
 */
export function effectiveTagHidden(tagStats: unknown, folders: unknown): Set<string> {
  const out = folderHiddenTags(tagStats, folders);
  for (const t of readTagStats(tagStats)) if (!t.visible) out.add(t.name);
  return out;
}

// ───────────────────────── 장면 적용 계획 ─────────────────────────

export interface TransitionOptions {
  /** 'file' = 파일을 따름(기본), 'on' = 늘 부드럽게, 'off' = 늘 바로 */
  mode?: 'file' | 'on' | 'off';
  /** 장면에 시간이 없을 때(모형 기본 전환 시간, 없으면 2초) */
  fallback?: number;
  /** 모형의 "장면 전환 사용"(꺼졌으면 'file'에서 바로 바꾼다) */
  showTransition?: boolean;
}

/** 장면 전환 시간(초, 0 = 바로). 장면 값 → 모형 기본 → 2초, 60초에서 자른다 */
export function transitionSeconds(page: Pick<SkpPageMeta, 'transition'> | null | undefined, o: TransitionOptions = {}): number {
  const mode = o.mode ?? 'file';
  if (mode === 'off') return 0;
  const valid = (v: unknown): number | null => (isNum(v) && v >= 0 ? Math.min(v, MAX_TRANSITION_S) : null);
  const s = valid(page?.transition) ?? valid(o.fallback) ?? DEFAULT_TRANSITION_S;
  if (mode === 'on') return s > 0 ? s : DEFAULT_TRANSITION_S;
  return o.showTransition === false ? 0 : s;
}

/** 장면 지연 시간(초, 슬라이드 쇼). 장면 값 → fallback → 1초, 3600초에서 자른다 */
export function delaySeconds(page: Pick<SkpPageMeta, 'delay'> | null | undefined, fallback: number = DEFAULT_DELAY_S): number {
  const valid = (v: unknown): number | null => (isNum(v) && v >= 0 ? Math.min(v, MAX_DELAY_S) : null);
  return valid(page?.delay) ?? valid(fallback) ?? DEFAULT_DELAY_S;
}

// 227차: 장면 적용 계획(pagePlan — 장면 카메라를 코어 카메라로 바꾼다)은 장면 카메라 조각(scenecam.ts)에

// ───────────────────────── 장면 차례·전환 ─────────────────────────

/**
 * 이전(−1)·다음(+1) 장면 차례. 지금이 없으면 다음 = 처음, 이전 = 마지막. wrap이면 끝에서 돈다(아니면 끝에서 null).
 */
export function stepPage(count: number, current: number | null, dir: 1 | -1, wrap = true): number | null {
  if (!(count > 0)) return null;
  if (current === null || !Number.isInteger(current) || current < 0 || current >= count) return dir > 0 ? 0 : count - 1;
  const next = current + dir;
  if (next >= 0 && next < count) return next;
  return wrap ? (next + count) % count : null;
}

// ───────────────────────── 장면 재생(슬라이드 쇼) ─────────────────────────

/** 재생할 장면 차례: "장면 재생에 넣기"를 끈 장면은 뺀다(모두 껐으면 모든 장면) */
export function slideshowOrder(pages: readonly Pick<SkpPageMeta, 'includeInAnimation'>[]): number[] {
  const order = pages.map((_, i) => i).filter((i) => pages[i]!.includeInAnimation !== false);
  return order.length ? order : pages.map((_, i) => i);
}

/**
 * 다음 재생 장면: 지금 장면 다음(지금 장면이 재생 목록에 없으면 처음). 끝에서 loop면 처음으로, 아니면 null(멈춤).
 * started: 이번 재생에서 이미 넘긴 장면 수(처음 부를 때 0) — 되풀이하지 않는 재생은 목록을 한 바퀴 돌면 멈춘다
 */
export function nextSlide(order: readonly number[], current: number | null, loop: boolean, started = 0): number | null {
  if (!order.length) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return order[0]!;
  if (at + 1 < order.length) return order[at + 1]!;
  return loop || started === 0 ? order[0]! : null;
}

/** 장면 하나를 보이는 시간(ms): 전환 시간(카메라 옮기기, 앱은 4초에서 자른다) + 지연 시간(없으면 1초) */
export function slideDurationMs(page: Pick<SkpPageMeta, 'delay'>, transitionS: number): number {
  const t = Number.isFinite(transitionS) && transitionS > 0 ? Math.min(transitionS, 4) : 0;
  return Math.round((t + delaySeconds(page)) * 1000);
}

// 227차: 장면 전환 진행·카메라(easeInOut·transitionProgress·transitionCamera — 코어 lerpCamera)는 장면 카메라 조각(scenecam.ts)에
