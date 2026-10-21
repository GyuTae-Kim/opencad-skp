/**
 * 장면(페이지)·저장 카메라·스타일을 뷰어 코어(opencad-viewer3d)의 보기 상태로 바꾸기(순수 함수, DOM 없음).
 *
 * - 카메라: SketchUp 카메라(눈·목표·위, 원근이면 세로 시야각, 평행이면 화면 전체 높이) → 코어 CameraState
 *   (Z 위 턴테이블, 굴림 없음). 굴림·2점 투시·고정 종횡비는 코어가 나타낼 수 없어 버린다.
 * - 장면 적용: 장면이 기억하는 것(use 깃발이 켜진 칸)만 바꾼다 — 카메라, 숨긴 태그(기억하면 모든 태그를 그 값으로),
 *   숨긴 개체(기억하면 숨긴 노드 전체를 그 목록으로), 활성 단면, 스타일. 기억하지 않은 것은 지금 상태 그대로 둔다.
 * - 처음 카메라: 파일을 열면 SketchUp처럼 모형 카메라(저장 당시 보기)로 보되, 그 카메라가 모형을 실제로 보여 줄 때만 쓴다
 *   (도구가 쓴 파일은 틀의 기본 카메라가 남아 모형이 화면 밖일 수 있다 — 그때는 앱이 전체 보기).
 * - 세로 화면: 장면 카메라는 세로 시야각을 지키므로 휴대폰 세로 화면에서는 가로가 잘린다. 처음 카메라와 장면 전환은
 *   장면이 만든 가로 범위(파일의 고정 종횡비, 없으면 16:10)를 지키게 시야각(평행은 화면 높이)을 넓힌다(fitSceneCamera). 가로 화면은 그대로.
 * 규칙은 PRISME 서비스 SKP 뷰어(skp_viewer_camera.js·skp_viewer_scene.js)와 형식 명세(spec-root §2.5·§3)에서 옮겼다.
 */
import type { Box3, RenderMode } from 'opencad-viewer3d';
import { DEFAULT_FOV, basisFromAngles, cameraBasis, cameraEye, dirToAngles, lerpCamera, type CameraState, type Projection } from 'opencad-viewer3d/camera';
import type { Rgb, SkpCameraMeta, SkpFaceStyle, SkpPageMeta, SkpSectionPlaneMeta, SkpStyleMeta, Vec3 } from '../meta';

/** SketchUp 기본 틀의 세로 시야각(도) — 원근 카메라에 시야각이 없을 때 */
export const SKP_DEFAULT_FOV_DEG = 35;
export const MIN_FOV_DEG = 1;
export const MAX_FOV_DEG = 120;
/** 장면 전환 기본 시간(SketchUp 모형 정보 › 애니메이션 기본값) */
export const DEFAULT_TRANSITION_S = 2;
/** 이보다 긴 전환 시간(깨졌거나 이상한 값)은 여기서 자른다 */
export const MAX_TRANSITION_S = 60;
/** 장면 지연(슬라이드 쇼) 기본·최대 */
export const DEFAULT_DELAY_S = 1;
export const MAX_DELAY_S = 3600;
/** 곧장 위·아래에서 이만큼(시선 z 성분) 가까운 보기는 수직을 살짝 넘었을 수 있다(약 8°) */
const OVER_TOP_Z = 0.99;
/** 태그 폴더 조상을 따라 올라갈 최대 단계 */
const FOLDER_DEPTH = 64;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [x, y, z] = v as unknown[];
  return isNum(x) && isNum(y) && isNum(z) ? [x, y, z] : null;
}

function rgb(v: unknown): Rgb | null {
  const c = vec3(v);
  return c ? [Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))] : null;
}

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

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

/**
 * 곧장 위(눈이 위, backZ ≥ 0)·아래를 볼 때 화면 위가 위 벡터 쪽이 되는 yaw.
 * 코어 basisFromAngles를 거꾸로 푼 식: pitch = +90°이면 화면 위 = (−sin yaw, cos yaw, 0), −90°이면 (sin yaw, −cos yaw, 0).
 * 위 벡터의 수평 성분이 없으면 null.
 */
function yawFromUp(backZ: number, up: readonly number[]): number | null {
  if (Math.hypot(up[0]!, up[1]!) < 1e-9) return null;
  return backZ >= 0 ? Math.atan2(-up[0]!, up[1]!) : Math.atan2(up[0]!, -up[1]!);
}

const validFov = (f: number | undefined): number => (isNum(f) && f > 0 && f < Math.PI ? f : DEFAULT_FOV);

/**
 * SketchUp 카메라 → 코어 카메라(같은 장면 좌표). 눈·목표가 이상하면 null.
 * - 원근: 세로 시야각(fovY, 도)을 그대로 쓴다(없으면 35°, 1°~120°로 묶음).
 * - 평행: 화면 전체 높이(height)가 같게 거리를 맞춘다(코어 반높이 = distance·tan(fovY/2), fovY는 뷰어 시야각).
 *   높이가 없으면 대상점 깊이의 원근 화면 높이와 같게 한다.
 * - 방향: 시선이 수평 성분을 가지면 yaw·pitch를 시선에서, 곧장 위·아래면 yaw를 위 벡터에서 얻는다.
 *   수직을 살짝 넘은 카메라(시선 z > 0.99, 위 벡터가 수평 보기의 위와 반대쪽)는 SketchUp에서 그림이 뒤집혀 보이지 않으므로
 *   곧장 위·아래 보기로 바로잡고 yaw를 위 벡터에서 얻는다(코어 pitch는 ±90°를 넘을 수 없다).
 * - 굴림(위 벡터가 시선 둘레로 돈 것)·2점 투시·고정 종횡비는 버린다.
 */
export function cameraFromSkp(cam: SkpCameraMeta, viewerFovY: number = DEFAULT_FOV): CameraState | null {
  const c = readCamera(cam);
  if (!c) return null;
  const back = sub(c.eye, c.target);
  const distance = Math.hypot(...back);
  const n: Vec3 = [back[0] / distance, back[1] / distance, back[2] / distance];
  const upYaw = yawFromUp(n[2], c.up);
  let { yaw, pitch } = dirToAngles(n, upYaw ?? 0);
  if (Math.abs(n[2]) > OVER_TOP_Z && Math.hypot(n[0], n[1]) >= 1e-9 && upYaw !== null && dot(basisFromAngles(yaw, pitch).up, c.up) < 0) {
    yaw = upYaw;
    pitch = n[2] >= 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const target: Vec3 = [c.target[0], c.target[1], c.target[2]];
  if (c.perspective) {
    const deg = Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, c.fovY ?? SKP_DEFAULT_FOV_DEG));
    return { target, distance, yaw, pitch, projection: 'perspective', fovY: (deg * Math.PI) / 180 };
  }
  const fovY = validFov(viewerFovY);
  const tan = Math.tan(fovY / 2);
  const height = c.height ?? 2 * distance * tan;
  return { target, distance: height / 2 / tan, yaw, pitch, projection: 'orthographic', fovY };
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

/**
 * 장면 카메라가 맞춰진 화면 종횡비(가로/세로) — 파일에 고정 종횡비가 없을 때. SketchUp 데스크톱 그리기 창(16:10)
 */
export const SCENE_REF_ASPECT = 16 / 10;
/** 이 종횡비 이하(뚜렷한 세로 화면)는 장면이 만든 가로 범위를 모두 보인다. 정사각(1)과 이 값 사이는 점점 넓힌다 */
export const PORTRAIT_FULL_ASPECT = 0.8;
/** 세로 화면에서 넓힌 세로 시야각의 한도(도) — 더 넓으면 위·아래 가장자리가 너무 늘어난다 */
export const PORTRAIT_MAX_FOV_DEG = 90;

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

const validAspect = (a: number | undefined): a is number => isNum(a) && a > 0;

/**
 * 장면이 만든 가로 범위를 지키려고 세로 범위를 넓힐 배율(1 이상).
 * 장면 카메라는 SketchUp처럼 세로 시야각을 지키므로, 세로로 긴 휴대폰 화면에서는 가로가 잘린다(앞마당 장면에서 지붕·옆벽이 잘림).
 * - 가로·정사각 화면(종횡비 ≥ 1)은 1 — 데스크톱·휴대폰 가로는 지금과 똑같다.
 * - 종횡비 ≤ 0.8은 장면 종횡비(ref)의 가로 범위를 모두 보이게 ref/종횡비.
 * - 그 사이는 기준 종횡비를 1 → ref로 점점 옮겨, 정사각을 지날 때 보기가 튀지 않게 한다.
 */
export function sceneCoverageScale(viewAspect: number, refAspect?: number): number {
  if (!validAspect(viewAspect) || viewAspect >= 1) return 1;
  const ref = validAspect(refAspect) ? refAspect : SCENE_REF_ASPECT;
  const w = Math.min(1, (1 - viewAspect) / (1 - PORTRAIT_FULL_ASPECT));
  return Math.max(1, (1 + (ref - 1) * w) / viewAspect);
}

/** 세로 시야각을 배율만큼 넓힌다(tan 기준, 90°에서 멈춤 — 원래 더 넓으면 그대로) */
export function widenFov(fovY: number, scale: number): number {
  const f = validFov(fovY);
  if (!(scale > 1)) return f;
  const max = (PORTRAIT_MAX_FOV_DEG * Math.PI) / 180;
  if (f >= max) return f;
  return Math.min(max, 2 * Math.atan(Math.tan(f / 2) * scale));
}

/**
 * 장면 카메라를 화면 종횡비에 맞춘다: 세로 화면이면
 * - 원근은 눈 자리·방향을 그대로 두고 시야각만 넓힌다(장면 그림이 가운데에 그대로 있고 위·아래가 더 보인다 —
 *   눈을 뒤로 빼면 실내 장면에서 벽을 지나가므로 쓰지 않는다)
 * - 평행은 화면 높이를 배율만큼 키운다.
 * 가로 화면이면 그대로(scale 1).
 */
export function fitSceneCamera(c: CameraState, viewAspect: number, refAspect?: number): { camera: CameraState; fit: SceneFit } {
  const ref = validAspect(refAspect) ? refAspect : SCENE_REF_ASPECT;
  const scale = sceneCoverageScale(viewAspect, ref);
  const camera: CameraState =
    c.projection === 'perspective' ? { ...c, target: [...c.target], fovY: widenFov(c.fovY, scale) } : { ...c, target: [...c.target], distance: c.distance * scale };
  return { camera, fit: { ref, scale, baseFovY: c.fovY, projection: c.projection, fovY: camera.fovY } };
}

/**
 * 화면 종횡비가 바뀌었을 때(휴대폰을 돌림) 장면 맞춤을 다시 한다. 사용자가 보기를 돌리거나 옮긴 것은 그대로 두고,
 * 원근은 시야각을, 평행은 화면 높이를 새 배율로 바꾼다. 맞춘 뒤 투영·시야각이 바뀌었으면(사용자가 바꿈) null — 더 따라가지 않는다.
 */
export function refitSceneCamera(c: CameraState, fit: SceneFit, viewAspect: number): { camera: CameraState; fit: SceneFit } | null {
  if (c.projection !== fit.projection || Math.abs(c.fovY - fit.fovY) > 1e-9) return null;
  const scale = sceneCoverageScale(viewAspect, fit.ref);
  if (Math.abs(scale - fit.scale) < 1e-9) return { camera: c, fit };
  if (c.projection === 'perspective') {
    const fovY = widenFov(fit.baseFovY, scale);
    return { camera: { ...c, target: [...c.target], fovY }, fit: { ...fit, scale, fovY } };
  }
  return { camera: { ...c, target: [...c.target], distance: (c.distance * scale) / fit.scale }, fit: { ...fit, scale } };
}

/** 범위가 비었는지(min > max) */
function emptyBox(b: Box3 | null | undefined): boolean {
  return !b || !(b.min[0] <= b.max[0] && b.min[1] <= b.max[1] && b.min[2] <= b.max[2]);
}

/** 상자가 화면에 충분히 보인다고 볼 화소(보이는 부분의 가로·세로 가운데 큰 쪽) */
export function minVisiblePx(width: number, height: number): number {
  return Math.max(24, 0.03 * Math.min(width, height));
}

/**
 * 카메라가 상자(장면 범위)를 width × height 화면에 충분히 보여 주는지.
 * 상자 꼭짓점 여덟을 화면(정규 좌표 −1~1)에 투영한 범위가 화면과 겹치는 부분이 minVisiblePx 이상이면 참.
 * 원근에서 눈 뒤 꼭짓점은 건너뛰고, 모두 눈 뒤면 거짓. 범위가 없으면 참(판정할 것이 없다).
 */
export function cameraShowsBox(c: CameraState, box: Box3 | null | undefined, width: number, height: number): boolean {
  if (emptyBox(box)) return true;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const aspect = w / h;
  const b = cameraBasis(c);
  const eye = cameraEye(c);
  const tan = Math.tan(validFov(c.fovY) / 2);
  const hh = c.distance * tan;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? box!.max[0] : box!.min[0], i & 2 ? box!.max[1] : box!.min[1], i & 4 ? box!.max[2] : box!.min[2]];
    const d = sub(p, eye);
    const z = -dot(d, b.back);
    let x: number;
    let y: number;
    if (c.projection === 'perspective') {
      if (z <= 1e-9) continue;
      x = dot(d, b.right) / (z * tan * aspect);
      y = dot(d, b.up) / (z * tan);
    } else {
      if (!(hh > 0)) return false;
      x = dot(d, b.right) / (hh * aspect);
      y = dot(d, b.up) / hh;
    }
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (x0 === Infinity) return false;
  if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return false;
  const px = ((Math.min(x1, 1) - Math.max(x0, -1)) * w) / 2;
  const py = ((Math.min(y1, 1) - Math.max(y0, -1)) * h) / 2;
  return Math.max(px, py) >= minVisiblePx(w, h);
}

/**
 * 파일을 열 때 쓸 카메라와 화면 맞춤: 모형 카메라(meta.camera)를 화면 종횡비에 맞춘 것(fitSceneCamera)이 범위를 화면에
 * 충분히 보여 주면 그것, 아니면 null(앱이 전체 보기). width·height는 3D 보기 크기(CSS 화소), box는 장면 범위(scene.bounds).
 */
export function initialView(
  meta: unknown,
  box: Box3 | null | undefined,
  width: number,
  height: number,
  viewerFovY: number = DEFAULT_FOV,
): { camera: CameraState; fit: SceneFit } | null {
  const cam = readCamera(obj(meta)?.camera);
  if (!cam) return null;
  const c = cameraFromSkp(cam, viewerFovY);
  if (!c) return null;
  const v = fitSceneCamera(c, width / Math.max(1, height), cam.aspect);
  return cameraShowsBox(v.camera, box, width, height) ? v : null;
}

/** 파일을 열 때 쓸 카메라(initialView의 카메라) */
export function initialCamera(meta: unknown, box: Box3 | null | undefined, width: number, height: number, viewerFovY: number = DEFAULT_FOV): CameraState | null {
  return initialView(meta, box, width, height, viewerFovY)?.camera ?? null;
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
] as const;
const STYLE_COLORS = ['background', 'front', 'back', 'edgeColor'] as const;

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

/** 장면 하나(모르는 꼴이어도 안전하게). 이름이 없으면 "장면 n" */
export function readPage(v: unknown, index: number): SkpPageMeta {
  const o = obj(v) ?? {};
  const page: SkpPageMeta = { name: typeof o.name === 'string' && o.name ? o.name : `장면 ${index + 1}` };
  if (typeof o.description === 'string' && o.description) page.description = o.description;
  const cam = readCamera(o.camera);
  if (cam) page.camera = cam;
  if (Array.isArray(o.hiddenTags)) page.hiddenTags = o.hiddenTags.filter((t): t is string => typeof t === 'string');
  if (Array.isArray(o.hiddenNodes)) page.hiddenNodes = o.hiddenNodes.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0);
  if (Array.isArray(o.sectionPlanes)) page.sectionPlanes = o.sectionPlanes.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0);
  const style = readStyle(o.style);
  if (style) page.style = style;
  const transition = seconds(o.transition);
  if (transition !== undefined) page.transition = transition;
  const delay = seconds(o.delay);
  if (delay !== undefined) page.delay = delay;
  if (typeof o.thumbnail === 'string' && o.thumbnail) page.thumbnail = o.thumbnail;
  return page;
}

/** meta.pages → 장면 목록. 차례는 파일 그대로 지킨다(activePage·장면 단면 차례가 이 차례를 가리킨다) */
export function readPages(meta: unknown): SkpPageMeta[] {
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
 * 활성 단면 차례들 → 코어에 쓸 평면 하나. 코어 단면은 장면 전체를 자르므로 모형 단면(node −1)만 쓴다
 * (노드 단면은 그 그룹·컴포넌트 안쪽만 잘라야 해서 나타낼 수 없다). 여럿이면 처음 것, 없으면 null.
 */
export function pickSection(indices: readonly number[], planes: readonly unknown[]): PageSection | null {
  for (const index of indices) {
    const plane = readSectionPlane(planes[index]);
    if (!plane || plane.node !== -1) continue;
    const v = sectionToViewer(plane.plane);
    if (v) return { index, plane, ...v };
  }
  return null;
}

/**
 * 파일을 열 때의 단면: 모형 단면 가운데 활성(active)인 것. 모형 스타일이 단면 자르기를 끈 경우(sectionCuts false)는 null.
 */
export function initialSection(meta: unknown): PageSection | null {
  const m = obj(meta);
  const list = Array.isArray(m?.sectionPlanes) ? (m!.sectionPlanes as unknown[]) : [];
  if (readStyle(m?.style)?.sectionCuts === false) return null;
  const active: number[] = [];
  list.forEach((p, i) => {
    if (readSectionPlane(p)?.active) active.push(i);
  });
  return pickSection(active, list);
}

// ───────────────────────── 스타일 ─────────────────────────

/**
 * 스타일 → 코어 그리기 방식. 모르면 null(지금 방식 그대로).
 * - 와이어프레임 → 'wireframe'(면이 없으니 X-ray보다 먼저)
 * - X-ray → 'xray'
 * - 은선(hiddenLine)·음영·무늬 음영·단색 → 모서리 보이기(edges)가 꺼졌으면 'shaded', 아니면 'shadedEdges'
 *   (코어에 은선·단색·무늬 끄기가 없어 음영으로 가깝게 그린다)
 * - 면 스타일이 없고 모서리 보이기만 있으면 그것만 따른다.
 */
export function renderModeForStyle(style: SkpStyleMeta | null | undefined): RenderMode | null {
  if (!style) return null;
  if (style.faceStyle === 'wireframe') return 'wireframe';
  if (style.xray === true) return 'xray';
  if (style.faceStyle) return style.edges === false ? 'shaded' : 'shadedEdges';
  if (typeof style.edges === 'boolean') return style.edges ? 'shadedEdges' : 'shaded';
  return null;
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

export interface PageContext {
  /** meta.sectionPlanes(차례 그대로 — 장면의 활성 단면 차례가 가리킨다) */
  sectionPlanes?: readonly unknown[];
  /** 조상 폴더가 숨겨 숨는 태그(folderHiddenTags) — 장면이 숨긴 태그에 더한다(장면별 폴더 보임은 파일에서 읽지 않는다) */
  folderHidden?: ReadonlySet<string>;
  /** 뷰어 시야각(평행 카메라 변환용, 라디안) */
  viewerFovY?: number;
  /** 3D 보기 종횡비(가로/세로) — 세로 화면이면 장면이 만든 가로 범위를 지키게 맞춘다(fitSceneCamera). 없으면 맞추지 않음 */
  viewAspect?: number;
  transition?: TransitionOptions;
}

/** 장면 하나를 적용할 때 바꿀 것(null·false = 지금 상태 그대로) */
export interface PagePlan {
  name: string;
  /** 바꿀 카메라(장면이 카메라를 기억하지 않거나 이상하면 null) — viewAspect가 있으면 화면에 맞춘 것 */
  camera: CameraState | null;
  /** 화면 맞춤(viewAspect가 없거나 카메라가 없으면 null) */
  fit: SceneFit | null;
  /** 카메라 전환 시간(초, 0 = 바로) */
  seconds: number;
  /** 숨길 태그 이름 전체(목록에 없는 태그는 보인다). null = 그대로 */
  hiddenTags: Set<string> | null;
  /** 숨길 나무 노드 전체(목록에 없는 노드는 보인다). null = 그대로 */
  hiddenNodes: Set<number> | null;
  /** 단면을 바꾸는지(장면이 단면을 기억하거나, 기억한 스타일이 단면 자르기를 껐으면 참) */
  setsSection: boolean;
  /** setsSection일 때 쓸 단면(null = 끈다) */
  section: PageSection | null;
  /** 장면 스타일(기억하지 않으면 null) — 글·치수·안내선·단면 기호 보이기, 배경 색 등은 앱이 이 값으로 */
  style: SkpStyleMeta | null;
  /** 스타일의 코어 그리기 방식(모르면 null) */
  renderMode: RenderMode | null;
}

/**
 * 장면 적용 계획: 장면이 기억하는 것만 바꾼다(SketchUp 장면 고르기와 같게).
 * - 카메라 → 코어 카메라 + 전환 시간
 * - 숨긴 태그 → 모든 태그를 그 값으로(+ 숨긴 폴더 아래 태그)
 * - 숨긴 개체 → 숨긴 노드를 그 목록으로(목록은 저장 당시 전체 상태다)
 * - 활성 단면 → 모형 단면 하나(pickSection) 또는 끄기. 장면 스타일이 단면 자르기를 껐으면 끈다.
 * - 스타일 → 그리기 방식
 */
export function pagePlan(page: SkpPageMeta, ctx: PageContext = {}): PagePlan {
  const raw = page.camera ? cameraFromSkp(page.camera, ctx.viewerFovY) : null;
  const fitted = raw && ctx.viewAspect !== undefined ? fitSceneCamera(raw, ctx.viewAspect, page.camera?.aspect) : null;
  const camera = fitted?.camera ?? raw;
  let hiddenTags: Set<string> | null = null;
  if (page.hiddenTags) {
    hiddenTags = new Set(page.hiddenTags);
    for (const t of ctx.folderHidden ?? []) hiddenTags.add(t);
  }
  const style = page.style ?? null;
  const cutsOff = style?.sectionCuts === false;
  const setsSection = !!page.sectionPlanes || cutsOff;
  const section = page.sectionPlanes && !cutsOff ? pickSection(page.sectionPlanes, ctx.sectionPlanes ?? []) : null;
  return {
    name: page.name,
    camera,
    fit: fitted?.fit ?? null,
    seconds: camera ? transitionSeconds(page, ctx.transition) : 0,
    hiddenTags,
    hiddenNodes: page.hiddenNodes ? new Set(page.hiddenNodes) : null,
    setsSection,
    section,
    style,
    renderMode: renderModeForStyle(style),
  };
}

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

/** 부드럽게 시작하고 멈추는 진행(0~1) */
export const easeInOut = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 전환 진행(0~1): 시작 시각·지금(ms)·전환 시간(초). 시간이 0이면 1 */
export function transitionProgress(startMs: number, nowMs: number, seconds: number): number {
  if (!(seconds > 0)) return 1;
  return Math.min(1, Math.max(0, (nowMs - startMs) / (seconds * 1000)));
}

/** 전환 중 카메라(진행 t, 0~1 — 부드럽게 바꾼 뒤 코어 lerpCamera로 섞는다) */
export function transitionCamera(from: CameraState, to: CameraState, t: number): CameraState {
  return t >= 1 ? { ...to, target: [...to.target] as Vec3 } : lerpCamera(from, to, easeInOut(t));
}
