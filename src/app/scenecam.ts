/**
 * 장면 카메라 조각(227차 — 첫 화면 조각에서 뺐다): 코어 camera 모듈을 값으로 쓰는 앱 쪽을 모아 문서를 열 때 코어 입구와 함께 받는다
 * (core.ts loadViewerCore → sceneCamera. 뷰어는 코어를 받은 뒤에만 만들므로 뷰어가 있으면 늘 있다 — 부르는 곳은 모두 뷰어가 있을 때).
 *
 * - pages.ts에서 옮긴 카메라 갈래(순수 함수, DOM 없음 — 몸통은 그대로):
 *   - 카메라: SketchUp 카메라(눈·목표·위, 원근이면 세로 시야각, 평행이면 화면 전체 높이) → 코어 CameraState
 *     (Z 위 턴테이블). 위 벡터가 기운 카메라는 굴림(roll), 2점 투시 카메라는 앙각 0 + 렌즈 이동(shiftY)으로 나타낸다. 고정 종횡비는 세로 화면 맞춤에만 쓴다.
 *   - 처음 카메라: 파일을 열면 SketchUp처럼 모형 카메라(저장 당시 보기)로 보되, 그 카메라가 모형을 실제로 보여 줄 때만 쓴다
 *     (도구가 쓴 파일은 틀의 기본 카메라가 남아 모형이 화면 밖일 수 있다 — 그때는 앱이 전체 보기).
 *   - 세로 화면: 장면 카메라는 세로 시야각을 지키므로 휴대폰 세로 화면에서는 가로가 잘린다. 처음 카메라와 장면 전환은
 *     장면이 만든 가로 범위(파일의 고정 종횡비, 없으면 16:10)를 지키게 시야각(평행은 화면 높이)을 넓힌다(fitSceneCamera). 가로 화면은 그대로.
 *   - 장면 적용 계획(pagePlan)과 장면 전환 카메라. 읽기(readCamera)·활성 단면·스타일의 그리기 방식·전환 시간은 pages.ts의 것을 쓴다.
 * - 맞춰 보기(view.ts)와 3D 보기 덧그림 층(overlay.ts)도 같은 값으로 다시 내보낸다(둘 다 코어 camera를 값으로 쓰고 뷰어가 있을 때만 쓴다).
 * 226차까지는 이 셋이 첫 화면 그래프에 있어 코어 camera(코어 뷰어가 쓰는 궤도·이동·확대 함수까지 모듈 글 통째로)와 그것이 끌어오는 math·bounds가 첫 화면 조각에 실렸다.
 * 처음 화면에서 부르는 sameSceneFit(보기 기록 필드 초기값)과 doc.ts가 부르는 읽기 함수는 pages.ts에 남긴다.
 * 규칙은 비공개 참조 뷰어의 카메라·장면 코드와 그쪽 형식 명세에서 옮겼다.
 */
import type { Box3, RenderMode } from 'opencad-viewer3d';
import { DEFAULT_FOV, basisFromAngles, cameraBasis, cameraEye, dirToAngles, lerpCamera, type CameraState } from 'opencad-viewer3d/camera';
import type { SkpAxesMeta, SkpCameraMeta, SkpPageMeta, SkpStyleMeta, Vec3 } from '../meta';
import {
  SKP_DEFAULT_FOV_DEG,
  activeSections,
  isNum,
  obj,
  readCamera,
  renderModeForStyle,
  sub,
  transitionSeconds,
  type PageSection,
  type SceneFit,
  type TransitionOptions,
} from './pages';

export { cameraForBox, keepViewOnHeightChange } from './view';
export { Overlay } from './overlay';

export const MIN_FOV_DEG = 1;
export const MAX_FOV_DEG = 120;
/** 곧장 위·아래에서 이만큼(시선 z 성분) 가까운 보기는 수직을 살짝 넘었을 수 있다(약 8°) */
const OVER_TOP_Z = 0.99;

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

// ───────────────────────── 카메라 ─────────────────────────

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
 * - 굴림(위 벡터가 시선 둘레로 돈 것)은 roll로(0.05° 아래는 버린다), 2점 투시(twoPoint)는 twoPointCamera로. 고정 종횡비는 버린다.
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
  const roll = rollFromUp(yaw, pitch, c.up);
  const withRoll = (cam: CameraState): CameraState => (roll ? { ...cam, roll } : cam);
  if (c.perspective) {
    const deg = Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, c.fovY ?? SKP_DEFAULT_FOV_DEG));
    const cam: CameraState = { target, distance, yaw, pitch, projection: 'perspective', fovY: (deg * Math.PI) / 180 };
    // 2점 투시: 세로선을 곧게(앙각 0 + 렌즈 이동) — 굴림은 쓰지 않는다
    if (c.twoPoint) return twoPointCamera(cam) ?? withRoll(cam);
    return withRoll(cam);
  }
  const fovY = validFov(viewerFovY);
  const tan = Math.tan(fovY / 2);
  const height = c.height ?? 2 * distance * tan;
  return withRoll({ target, distance: height / 2 / tan, yaw, pitch, projection: 'orthographic', fovY });
}

/** 이보다 작은 굴림(라디안 — 0.05°)은 없는 것으로 본다(저장된 위 벡터의 작은 오차) */
const ROLL_EPS = (0.05 * Math.PI) / 180;

/**
 * SketchUp 위 벡터 → 코어 굴림(라디안). 코어는 굴림 r이면 화면 위 = cos r·up₀ − sin r·right₀(up₀·right₀는 yaw·pitch의 굴림 없는 틀)이라
 * 위 벡터를 시선에 수직으로 만든 u에서 r = atan2(−u·right₀, u·up₀)(−90°~90°). 위 벡터가 시선과 나란하거나 아래로 기울었거나 굴림이 아주 작으면 0
 */
export function rollFromUp(yaw: number, pitch: number, up: readonly number[]): number {
  const b = basisFromAngles(yaw, pitch);
  const k = dot(up, b.back);
  const u: Vec3 = [up[0]! - b.back[0] * k, up[1]! - b.back[1] * k, up[2]! - b.back[2] * k];
  // 위 벡터가 화면 아래쪽을 가리키는(90° 넘게 기운) 카메라는 깨진 값으로 보고 굴리지 않는다(그림이 뒤집히지 않게)
  if (!(Math.hypot(...u) > 1e-9) || !(dot(u, b.up) > 0)) return 0;
  const r = Math.atan2(-dot(u, b.right), dot(u, b.up));
  return Math.abs(r) < ROLL_EPS ? 0 : r;
}

/** 2점 투시로 볼 수 없을 만큼 위·아래를 보는 앙각(도) */
export const TWO_POINT_MAX_PITCH_DEG = 80;

/**
 * 2점 투시(SketchUp 카메라 › 2점 투시): 눈 자리·방향(yaw)·시야각은 그대로 두고 앙각을 0으로(세로선이 곧다), 원래 대상점이 화면의 같은 높이에
 * 오게 렌즈를 위아래로 옮긴다(코어 shiftY = −그 점의 정규 장치 y). 굴림은 없앤다. 원근만 — 평행이거나 곧장 위·아래(80° 넘게)를 보면 null
 */
export function twoPointCamera(c: CameraState): CameraState | null {
  if (c.projection !== 'perspective' || !(Math.abs(c.pitch) <= (TWO_POINT_MAX_PITCH_DEG * Math.PI) / 180)) return null;
  const eye = cameraEye(c);
  const b = basisFromAngles(c.yaw, 0);
  const d = Math.max(c.distance, 1e-9);
  const target: Vec3 = [eye[0] - b.back[0] * d, eye[1] - b.back[1] * d, eye[2] - b.back[2] * d];
  // 원래 대상점의 새 틀 안 높이(정규 장치 y)
  const v = sub(c.target, eye);
  const z = -dot(v, b.back);
  const tan = Math.tan(validFov(c.fovY) / 2);
  const y = z > 1e-12 ? dot(v, b.up) / (z * tan) : 0;
  const { roll: _r, shiftX: _x, shiftY: _y, ...base } = c;
  void _r, _x, _y;
  const out: CameraState = { ...base, target, distance: d, pitch: 0 };
  return Math.abs(y) > 1e-12 ? { ...out, shiftY: -y } : out;
}

/**
 * 새 문서를 열 때의 카메라: 앞 문서의 굴림·렌즈 이동(2점 투시)은 없애고 시야각은 fovY로(세로 화면 맞춤을 뺀 원래 값).
 * 바꿀 것이 없으면 null(카메라를 다시 넣지 않는다)
 */
export function freshDocCamera(c: CameraState, fovY: number): CameraState | null {
  const { roll, shiftX, shiftY, ...base } = c;
  if (!roll && !shiftX && !shiftY && fovY === c.fovY) return null;
  return { ...base, target: [...c.target], fovY };
}

/** 2점 투시 카메라인지(앙각 0, 렌즈를 위아래로만 옮김) */
export function isTwoPoint(c: CameraState): boolean {
  return c.projection === 'perspective' && Math.abs(c.pitch) < 1e-9 && !c.roll && !c.shiftX;
}

/**
 * 시야각만 바꾸기: 렌즈 이동은 정규 장치 좌표라 시야각이 바뀌면 같은 점이 같은 자리에 남게 tan(시야/2) 비로 다시 맞춘다(2점 투시 프레임 지키기)
 */
export function withFov(c: CameraState, fovY: number): CameraState {
  const f = validFov(fovY);
  const k = Math.tan(validFov(c.fovY) / 2) / Math.tan(f / 2);
  const out: CameraState = { ...c, target: [...c.target], fovY: f };
  if (c.shiftX) out.shiftX = c.shiftX * k;
  if (c.shiftY) out.shiftY = c.shiftY * k;
  return out;
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
    c.projection === 'perspective' ? withFov(c, widenFov(c.fovY, scale)) : { ...c, target: [...c.target], distance: c.distance * scale };
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
    return { camera: withFov(c, fovY), fit: { ...fit, scale, fovY } };
  }
  return { camera: { ...c, target: [...c.target], distance: (c.distance * scale) / fit.scale }, fit: { ...fit, scale } };
}

/**
 * 전체 보기·표준 뷰·맞춰 보기 전에(그리고 장면 맞춤을 더 따라가지 않게 될 때): 세로 화면 맞춤으로 넓힌 시야각을 장면의 원래 시야각으로
 * 되돌린다(넓은 시야각으로 전체 보기를 하면 가장자리가 늘어난다). 거리를 tan(시야/2) 비만큼 바꿔 대상점 깊이의 화면 크기는 그대로 둔다 —
 * 원근은 이어지는 맞춰 보기가 튀지 않고, 평행(넓힌 뒤 평행 투영으로 바꾼 경우)은 화면이 그대로다. 투영과 상관없이 시야각만 본다:
 * 평행으로 바꿔도 시야각은 남아, 다시 원근으로 돌아오면 넓은 시야각이 되살아나기 때문이다. 맞춤이 없거나 넓히지 않았으면 그대로.
 */
export function unwidenSceneCamera(c: CameraState, fit: SceneFit | null): CameraState {
  if (!fit) return c;
  const base = validFov(fit.baseFovY);
  if (!(c.fovY > base + 1e-9)) return c;
  return { ...withFov(c, base), distance: (c.distance * Math.tan(c.fovY / 2)) / Math.tan(base / 2) };
}

/**
 * 이전·다음 보기로 되돌릴 카메라: 장면 맞춤 상태로 적어 둔 칸(tag)은 지금 화면 방향에 다시 맞춘다
 * (휴대폰을 돌린 뒤 이전 보기를 해도 돌리기 전 방향의 넓은 시야각이 돌아오지 않게). 맞춤 없이 적은 칸은 그대로.
 */
export function restoreSceneCamera(c: CameraState, tag: SceneFit | null, viewAspect: number): { camera: CameraState; fit: SceneFit | null } {
  const r = tag ? refitSceneCamera(c, tag, viewAspect) : null;
  // 맞춤 그대로 되돌릴 수 없는 칸(그 사이 평행 투영으로 바꿈 등)은 넓힌 시야각만 원래대로
  return r ?? { camera: unwidenSceneCamera(c, tag), fit: null };
}

/**
 * 지금 시야각에서 세로 화면 맞춤을 뺀 것: 맞춘 뒤 시야각이 그대로면(투영은 바꿨어도) 장면의 원래 시야각, 아니면 지금 시야각.
 * 새 문서·장면 변환이 넓힌 시야각을 물려받지 않게 쓴다.
 */
export function baseFovOf(c: CameraState, fit: SceneFit | null): number {
  return fit && Math.abs(c.fovY - fit.fovY) < 1e-9 ? fit.baseFovY : c.fovY;
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

// ───────────────────────── 장면 적용 계획 ─────────────────────────

export interface PageContext {
  /** meta.sectionPlanes(차례 그대로 — 장면의 활성 단면 차례가 가리킨다) */
  sectionPlanes?: readonly unknown[];
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
  /** 숨길 태그 이름 전체(목록에 없는 태그는 보인다 — 숨긴 폴더 안 태그는 앱이 폴더로 숨긴다). null = 그대로 */
  hiddenTags: Set<string> | null;
  /**
   * 숨길 태그 폴더 전체(meta.tagFolders 차례 — 안쪽 폴더·태그도 숨고, 목록에 없는 폴더는 보인다).
   * null = 그대로(숨긴 태그를 기억하지 않는 장면이거나 장면의 폴더 목록을 모름)
   */
  hiddenFolders: Set<number> | null;
  /** 숨길 나무 노드 전체(목록에 없는 노드는 보인다). null = 그대로 */
  hiddenNodes: Set<number> | null;
  /** 단면을 바꾸는지(장면이 단면을 기억하거나, 기억한 스타일이 단면 자르기를 껐으면 참) */
  setsSection: boolean;
  /** setsSection일 때 쓸 모형 단면(null = 없음) — sections의 모형 단면 */
  section: PageSection | null;
  /** setsSection일 때 쓸 단면 모두(모형 단면 먼저, 그룹 안 단면은 그 노드만 자른다 — activeSections). 비면 끈다 */
  sections: PageSection[];
  /** 장면 스타일(기억하지 않으면 null) — 글·치수·안내선·단면 기호 보이기, 배경 색 등은 앱이 이 값으로 */
  style: SkpStyleMeta | null;
  /** 스타일의 코어 그리기 방식(모르면 null) */
  renderMode: RenderMode | null;
  /** 바꿀 그리기 축(73차 — null = 기본 축, undefined = 그대로: 장면이 그리기 축을 기억하지 않음) */
  axes: SkpAxesMeta | null | undefined;
}

/**
 * 장면 적용 계획: 장면이 기억하는 것만 바꾼다(SketchUp 장면 고르기와 같게).
 * - 카메라 → 코어 카메라 + 전환 시간
 * - 숨긴 태그 → 모든 태그를 그 값으로, 장면이 폴더 목록을 가지면 모든 태그 폴더도 그 값으로(공개 C API SUSceneAddLayerFolder — 넣은 폴더는 숨김, 뺀 폴더는 보임)
 * - 숨긴 개체 → 숨긴 노드를 그 목록으로(목록은 저장 당시 전체 상태다)
 * - 활성 단면 → 모형 단면 하나(pickSection) 또는 끄기. 장면 스타일이 단면 자르기를 껐으면 끈다.
 * - 스타일 → 그리기 방식
 * - 그리기 축(73차, 장면 속성 "Axes Location" — 공개 Ruby API Page#axes·use_axes?) → 그 장면의 축. 기억하지 않는 장면은 지금 축을 그대로 둔다
 *   (다른 속성과 같은 규칙 — 장면은 저장한 속성만 되돌린다)
 */
export function pagePlan(page: SkpPageMeta, ctx: PageContext = {}): PagePlan {
  const raw = page.camera ? cameraFromSkp(page.camera, ctx.viewerFovY) : null;
  const fitted = raw && ctx.viewAspect !== undefined ? fitSceneCamera(raw, ctx.viewAspect, page.camera?.aspect) : null;
  const camera = fitted?.camera ?? raw;
  const style = page.style ?? null;
  const cutsOff = style?.sectionCuts === false;
  const setsSection = !!page.sectionPlanes || cutsOff;
  const sections = page.sectionPlanes && !cutsOff ? activeSections(page.sectionPlanes, ctx.sectionPlanes ?? []) : [];
  const section = sections.find((s) => s.plane.node === -1) ?? null;
  return {
    name: page.name,
    camera,
    fit: fitted?.fit ?? null,
    seconds: camera ? transitionSeconds(page, ctx.transition) : 0,
    hiddenTags: page.hiddenTags ? new Set(page.hiddenTags) : null,
    hiddenFolders: page.hiddenTags && page.hiddenFolders ? new Set(page.hiddenFolders) : null,
    hiddenNodes: page.hiddenNodes ? new Set(page.hiddenNodes) : null,
    setsSection,
    section,
    sections,
    style,
    renderMode: renderModeForStyle(style),
    axes: page.axes,
  };
}

// ───────────────────────── 장면 전환 ─────────────────────────

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
