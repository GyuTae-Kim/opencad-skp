/**
 * 측정 도구(줄자·각도기): SketchUp처럼 추정(스냅, snap.ts)으로 점을 찍어 거리·각도를 잰다.
 * 코어의 두 점 측정(viewer.setMeasureMode)은 쓰지 않는다 — 이 도구가 대신한다.
 *
 * 이 모듈과 snap.ts는 첫 화면 JS 밖의 조각이다: 앱은 문서를 열 때 core.ts loadMeasure()로 받고, 그 전에 쓰는 글·키 규칙은 measurehints.ts에 둔다.
 *
 * 앱에 잇는 차례:
 *   1. 뷰어·덧그림(Overlay.attach)을 만든 뒤 `new MeasureTool(viewer, overlay, { getScene, getUnits, onResult, onHint })`.
 *   2. 도구 단추: `tool.setMode('tape' | 'protractor' | null)`(같은 단추를 다시 누르면 null). 장면을 바꾸면 `tool.clear()`.
 *   3. `viewer.onPick`: `tool.active`이면 무시한다(이 도구가 그 누르기를 쓴다).
 *   4. 창 keydown·keyup(캡처 단계): `tool.handleKey(e)`가 true면 처리 끝. Esc keydown에서 false면(지울 것이 없음) 앱이 도구를 끈다.
 *      그보다 먼저(도구를 끈 동안에도) `tool.undoKey(e)`가 true면 안내 되돌리기·다시 하기로 처리 끝.
 *   5. 측정값 칸을 만들었으면 `tool.mountUndo(칸)`(측정 띠의 되돌리기·다시 하기 단추), 보기 설정 메뉴에 `tool.guideMenuItems()`(안내 보이기·이 파일의 안내 모두 지우기),
 *      새 문서면 `tool.openFile(파일 내용 SHA-256)`(안내를 비우고 이 브라우저에 기억한 그 파일의 안내를 되살린다 — guidestore.ts).
 *   6. 앱을 닫을 때 `tool.dispose()`.
 *
 * 입력: 캔버스 포인터 이벤트를 엿본다(막지 않는다). 왼쪽 단추·탭을 코어의 끌기 시작 거리(tapSlopPx — 마우스·펜 4화소,
 * 터치 10화소) 안에서 떼면 점 찍기, 끌기·오른쪽·가운데 단추·두 손가락은 코어 궤도·이동·확대 그대로(그 거리 안의 손가락 떨림은
 * 코어도 돌리지 않고 누르기로 본다). 터치는 추정 반경을 넓힌다(커서 표식은 탭한 점에 남긴다).
 * 정밀 조준(터치): 한 손가락을 끌기 시작 거리 안에서 AIM_HOLD_MS 동안 누르고 있으면 손가락 위 AIM_OFFSET_PX에 십자선을 띄우고,
 *   끌면 궤도 대신 십자선이 따라가며 마우스처럼 추정·고무줄·툴팁을 보인다. 떼면 십자선 자리에 점을 찍는다.
 *   그동안의 움직임은 캔버스 부모의 캡처 단계에서 막아 코어가 돌리지 않게 한다(떼기는 코어에 넘겨 끌기 상태를 끝낸다).
 * 줄자: 두 점 → { kind: 'tape', a, b, distance, dx, dy, dz }(장면 단위).
 * 각도기: 중심 → 기준 방향 → 잴 방향 → { kind: 'protractor', center, a, b, angle(도, 0~180), normal }.
 *   평면은 중심을 찍을 때 커서 밑 면, 없으면 카메라를 가장 정면으로 보는 축 평면. Shift를 누르고 있으면 그 평면을 고정한다.
 * 결과 선·점·라벨은 카메라가 움직여도 남고, 다음 측정을 시작하거나 clear·setMode를 하면 지운다.
 * 측정값 칸(VCB, vcb.ts): 줄자에서 길이를 치면(applyLength) SketchUp 줄자처럼 시작점에서 그 길이만큼 간 자리에 안내점(✕)을 찍는다.
 *   방향은 시작점을 찍은 뒤면 시작점 → 커서 추정(축 고정 포함), 두 점을 다 잰 뒤면 그 결과의 시작점 → 끝점(손가락 기기는 커서가 없어 이쪽).
 *   시작점이 모서리 위(끝점·중간점이 아닌 곳 — 추정 '모서리에'·'안내선에')면 SketchUp 줄자처럼 안내점 대신 그 모서리와 나란한 안내선을
 *   커서(결과) 쪽으로 친 거리만큼 띄워 둔다(거리는 모서리에 수직으로 잰다). 결과는 시작점 → 안내점(안내선에 내린 발) 줄자 결과로 바꾼다.
 *   각도기에서 각도를 치면(applyAngle — 도, 경사 1:6) 중심을 지나 기준 방향에서 그 각도만큼 커서(잰 방향) 쪽으로 돈 안내선을 둔다(음수는 반대쪽).
 *   안내점·안내선은 모형에 넣지 않는 보기 전용 표시라 새 문서·clearGuides까지 남으며, 안내점은 끝점처럼, 안내선은 모서리 위처럼 붙는다.
 *   도구를 끈 뒤에도 안내는 그린다(SketchUp처럼 늘 보인다 — 고르기·지우기는 도구를 켠 동안). 안내 보이기(setGuidesShown, 이 브라우저에 기억)를 끄면
 *   그리지도 붙지도 고르지도 않고, 숨긴 채 안내를 두거나 되돌리면 다시 켠다.
 * 안내 되돌리기·다시 하기: 안내 두기(칸·누르기·두 번 누르기)와 지우기(하나·모두)마다 그 전 안내 배열을 쌓아(MAX_GUIDE_UNDO단계) undo·redo로 오간다.
 *   측정 결과·진행 중 점은 건드리지 않는다. 안내 배열은 고치지 않고 늘 새로 만들므로 배열을 통째로 기억한다.
 * 파일별 안내 기억: 안내가 바뀔 때마다(되돌리기 포함) 지금 안내를 파일 내용 지문 열쇠로 이 브라우저에 두고(guidestore.ts), 같은 파일을 다시 열면 되살린다.
 *   되돌리기 목록은 기억하지 않는다(되살린 안내가 처음 상태). 모두 지우면 그 파일의 기억도 지운다(되돌리면 다시 기억한다).
 * 결과 글(길이·각도)은 정밀 조준 십자선·손가락·툴팁·앱이 알려 준 측정 띠와 겹치면 코어 placeMeasureLabel 차례로 비켜 둔다(labelSpot).
 *   먼저 놓인 글상자(앱이 알려 준 모형 글·치수 라벨 — placedLabels, 앞서 놓은 결과 글)와 겹쳐도 코어 0.24.0 placeLabelAmong 차례로 비킨다(26차).
 * 안내 두기(SketchUp 줄자·각도기의 "+" — 이 뷰어는 재기만이 기본): 켜면(setGuideMode, 키보드는 Ctrl — Mac은 Option — 만 눌렀다 떼기)
 *   줄자 둘째 누르기가 안내를 둔다 — 모서리 위에서 시작했으면 그 모서리와 나란히 둘째 점을 지나는 안내선(결과는 모서리에 수직인 거리),
 *   끝점·꼭짓점 같은 점에서 시작했으면 둘째 점에 안내점. 각도기는 셋째 누르기가 중심을 지나 잰 방향으로 안내선을 둔다. 결과는 재기만과 같이 남긴다.
 * 안내 고르기·지우기: 안내점·안내선 위를 누르면(측정 점도 그대로 찍는다) 그 안내를 고르고(방금 둔 안내도 고른다), 다른 곳을 누르거나
 *   Esc·다시 재기면 푼다. Delete·Backspace(앱은 측정값 칸의 지우기 단추도)로 고른 안내 하나를 지운다 — 고른 누르기가 시작점도 찍었으면 그 점도 거둔다.
 *   줄자·각도기를 끈 동안(고르기 도구)에는 앱이 3D 누르기마다 pickGuide로 묻는다: 누른 자리 둘레(코어 고르기 허용 거리)의 안내를 형상보다 먼저 고르고,
 *   Delete·Backspace·고른 것 카드의 지우기 단추로 지우며 Esc·다른 곳 누르기로 푼다(SketchUp 공개 도움말 "Using guides" — 고르기 도구로 고른 안내를 지움).
 *   끈 동안은 여럿을 고른다(25차 — "Selecting Geometry"의 수정 키): Ctrl(Mac은 Option)+누르기는 더하기, Shift는 넣고 빼기, Shift+Ctrl(Shift+Option)은 빼기,
 *   수정 키를 누른 채 끌면 코어 궤도 대신 고르기 상자(오른쪽으로 끌면 상자 안에 다 든 것, 왼쪽은 걸친 것까지 — 끝없는 안내선은 왼쪽 상자만, guidesInBox).
 *   고른 안내는 함께 지우고(되돌리기 한 단계), 고른 것 카드의 숨기기 단추로 숨긴다(hideSelectedGuides — "Using guides"의 Edit › Hide). 숨긴 안내는 그리지도
 *   붙지도 고르지도 않고, 보기 설정의 "숨긴 안내 모두 보이기"(unhideGuides — Edit › Unhide)로 다시 보인다. 숨기기도 되돌리기·파일별 안내 기억에 든다.
 *   끈 동안 Ctrl+A(Mac ⌘A)는 보이는 안내를 모두 고르고(selectAllGuides — 26차 "Selecting Geometry"의 Edit › Select All, 숨긴 안내는 빼고),
 *   Ctrl+T(Mac Shift+⌘A)는 고른 안내·형상을 모두 푼다(selectNone — Edit › Deselect All). 입력 칸·할 것이 없을 때는 브라우저 몫이다(selectAllKey).
 * 모서리 두 번 누르기(SketchUp 줄자): 줄자로 모서리 위를 두 번 누르면(코어와 같은 두 번 누르기 문턱 — 손가락은 넓게) 그 모서리를 지나는 끝없는 안내선을 둔다
 *   (곡선이면 누른 조각 하나의 직선, 안내 두기를 켜지 않아도). 첫 누르기가 찍은 시작점은 거두고 그 전 결과를 되돌리며, 둔 안내선은 골라 둔다.
 * 추론 잠금(SketchUp "Locking inference"): 방향을 잡는 동안(줄자 끝점·각도기 기준 방향·잴 방향) Shift를 누르고 있으면 지금 커서 밑 방향 추론
 *   (빨강·녹색·파랑 축, 모서리와 나란히, 지나간 모서리에 수직, 시작점에서 내린 수직)을 잠그고 떼면 푼다. →·←·↑는 빨강·녹색·파랑 축, ↓는 모서리와 나란히·수직
 *   (지금 커서 밑 것, 없으면 앞서 지나간 모서리와 나란히)을 잠그고 같은 키를 다시 누르면 푼다. 손가락 기기는 앱의 잠금 단추(setInferenceLock).
 *   잠그면 그 선 위에만 찍고(다른 점을 가리키면 그 점을 선에 내린 자리 — 높이 옮겨 재기), 점을 찍거나 취소·지우기를 하면 풀린다.
 *   잠근 채 점이 아닌 형상을 가리키면 잠근 선이 그 모서리·안내선과 만나는 점("빨강 축에 · 모서리에 · 잠금" — 모서리 위 표식에 잠금 고리)과
 *   커서 밑 면을 뚫는 점("· 면에 · 잠금" — 면 위 표식)에 붙는다(기본 켬, setLockMeets — snap.ts, 코어 0.19.0 lockEdgeSnap·lockFaceSnap).
 *   끌어온 점이 있으면 잠근 선이 그 점의 축과 만나는 점("빨강 축에 · 끌어온 점의 녹색 축에 · 잠금" — 교차점 표식에 잠금 고리, 끌어온 점에서 그 축 색 점선)과
 *   축으로 잠근 선 위에서 그 점과 줄 맞춘 자리("빨강 축에 · 끌어온 점과 줄 맞춤 · 잠금" — 끌어온 점에서 글자 색 점선)에도 모서리보다 먼저 붙는다
 *   (같은 setLockMeets — 코어 0.21.0 lockTrackSnap. 잠그기 전 줄 맞춘 자리를 Shift로 잠가도 같은 점이다).
 *   각도기 중심을 찍기 전 →·←·↑는 각도기 평면을 그 축에 고정한다(빨강·녹색·파랑 각도기, 다시 누르면 풀기).
 * 다른 점에서 끌어온 축(SketchUp "점에서" 추론 — 기본 켬, setTrack): 마우스·펜 커서나 정밀 조준 십자선이 점 추정(끝점·중간점·중심·교차점·수직 발·안내점) 위에
 *   TRACK_DWELL_MS(0.5초) 동안 머물면(마우스·펜은 2화소, 조준은 손가락 떨림을 받아 AIM_DWELL_PX 안) 그 점을 최근 셋까지 기억한다(코어 0.16.0 MeasureTracker).
 *   그 뒤 모서리 위·면 위·빈 곳이면 시작점 축 위에서 그 점과 줄 맞춘 자리, 끌어온 두 점의 축이 만나는 점(코어 0.17.0), 끌어온 축이 모서리·안내선과
 *   만나는 점(0.17.0)에, 면 위·빈 곳이면 그 점을 지나는 축 위에도 붙는다(snap.ts — 축은 모형의 그리기 축).
 *   끌어온 점은 작은 +로, 붙은 축은 그 점에서 커서 자리까지 축 색 점선으로 그린다(축끼리의 교차는 두 점에서). 손가락 탭은 커서가 없어 머무르지 않는다(정밀 조준으로 머문다).
 *   방금 누른 점과 진행 중 측정의 시작점은 머물러도 기억하지 않는다. 측정을 마치거나(두 점째·셋째 점·칸 넣기) 지우기·Esc·도구 바꾸기·끄기면 잊는다.
 *   안내가 아니라서 되돌리기·파일별 안내 기억에 들지 않고 고르거나 지우지도 않는다. 끄면 상태가 없어 추정·그림이 예전과 같다.
 * 축이 모서리·면과 만나는 점(SketchUp 추론 합치기 — 기본 켬, setAxisMeets): 시작점 축이 모서리·안내선과 만나는 점("빨강 축에 · 모서리에" — 모서리 위 표식,
 *   축 색 고무줄, Shift로 그 축에 잠근다)과 시작점 축·끌어온 축이 커서 밑 면을 뚫는 점("빨강 축에 · 면에", "끌어온 점의 빨강 축에 · 면에" — 면 위 표식)에
 *   붙는다(snap.ts — 코어 0.18.0 axisEdgeSnap·axisFaceSnap). 면은 커서와 같은 고르기로 그 자리에서 다시 맞춰 본다. 끄면 추정·그림이 예전과 같다.
 * 그리기는 덧그림 층의 SVG 묶음(g.measure)과 DOM 라벨(div.measure-layer)로 하고, 숫자 글은 모형 단위(units.ts)로 쓴다.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { PICK_TOLERANCE_PX, TOUCH_PICK_TOLERANCE_PX, clickCount, dragStartPx, isTouch, type LastClick } from 'opencad-viewer3d/pointer';
import type { Scene3d } from 'opencad-viewer3d/types';
import { projectToScreen, screenRay, viewDepth, worldPerPixel, type ViewFrame } from 'opencad-viewer3d/camera';
import type { V3 } from 'opencad-viewer3d/math';
import {
  LABEL_POINT_R,
  hitsAvoid,
  placeLabelAmong,
  placeMeasureLabel,
  rectsOverlap,
  type LabelAvoidAreas,
  type LabelCircle,
  type MeasureLabelRect,
} from 'opencad-viewer3d/measurelabel';
import { MeasureTracker, TRACK_DWELL_MS } from 'opencad-viewer3d/track';
import { safeStorage } from './backdrop';
import { icon } from './dom';
import { digestHex, loadGuides, saveGuides, type GuideStorage } from './guidestore';
import { isEditableTarget } from './keys';
import { screenPoint, screenSegment, svgEl, type Overlay } from './overlay';
import { formatAngle, formatLength, mmPerSceneUnit, type UnitsDisplay } from './units';
import {
  AIM_SNAP_RADIUS_PX,
  AXIS_COLORS,
  AXIS_DIRS,
  CORE_PICK_TOLERANCE_PX,
  FACE_PERPENDICULAR_LABEL,
  SNAP_COLORS,
  SNAP_RADIUS_PX,
  TOUCH_SNAP_RADIUS_PX,
  axisInferenceLock,
  axisOf,
  chooseSnap,
  closestOnLine,
  lockOf,
  parallelInferenceLock,
  probeOffsets,
  rayPlane,
  type Axis,
  type AxisDirs,
  type GuideLine,
  type InferenceLock,
  type Ray,
  type Snap,
  type SnapKind,
} from './snap';
import type { GuideKey, MeasureMode } from './measurehints';

export type { GuideLine } from './snap';
// 첫 화면에 남는 작은 키 규칙(measurehints.ts — 앱은 이 조각을 받기 전에도 쓴다)
export { guideKeyFor, type GuideKey, type MeasureMode } from './measurehints';

/** 안내에 보이는 키 이름 */
export const GUIDE_KEY_NAMES: Readonly<Record<GuideKey, string>> = Object.freeze({ Control: 'Ctrl', Alt: 'Option' });

/**
 * 안내 두기 키 안내(키보드 기기, 점을 찍기 전): "Ctrl: 안내 두기"·"Ctrl: 안내 두기 끄기". 손가락 기기는 측정 띠 단추라 null.
 * 상태 줄·측정 띠는 measureHint 다음에 따로 둔다(번역이 "{0}: 안내 두기" 틀로 키 이름을 그대로 끼운다)
 */
export function guideKeyHint(mode: MeasureMode | null, points: number, guide: boolean, key: GuideKey = 'Control', touch = false): string | null {
  if (!mode || points || touch) return null;
  return `${GUIDE_KEY_NAMES[key]}: ${guide ? '안내 두기 끄기' : '안내 두기'}`;
}

/** 잠근 방향 이름(잠금 안내): 축 · 모서리와 나란히 · 모서리에 수직 · 면에 수직 */
export type LockName = Axis | 'parallel' | 'perpendicular' | 'facePerpendicular';

/** 잠근 방향 안내(상태 줄·측정 띠에서 measureHint 다음에 따로 보인다) */
export const LOCK_HINTS: Readonly<Record<LockName, string>> = Object.freeze({
  x: '빨강 축으로 잠금',
  y: '녹색 축으로 잠금',
  z: '파랑 축으로 잠금',
  parallel: '모서리와 나란히 잠금',
  perpendicular: '모서리에 수직으로 잠금',
  facePerpendicular: '면에 수직으로 잠금',
});

/** 화살표로 고정한 각도기 평면(그 축이 법선 — SketchUp의 빨강·녹색·파랑 각도기) */
export const PLANE_HINTS: Readonly<Record<Axis, string>> = Object.freeze({ x: '빨강 각도기로 고정', y: '녹색 각도기로 고정', z: '파랑 각도기로 고정' });

/** 잠글 방향 고르기(22차 한 손 잠금): 축 이름 · 모서리와 나란히 */
export type LockChoice = Axis | 'parallel';

/** 측정 띠의 잠글 방향 고르기 줄 이름(접근성) */
export const LOCK_MENU_LABEL = '잠글 방향 고르기';

/** 키보드 기기에서 방향을 잡는 동안 잠그는 법 */
export const LOCK_KEYS_HINT = 'Shift·화살표로 방향 잠금';

/** 잠근 방향 → 잠금 안내 이름 */
export function lockName(l: Pick<InferenceLock, 'kind' | 'axis' | 'label'> | null | undefined): LockName | null {
  if (!l) return null;
  if (l.kind === 'axis') return l.axis ?? null;
  if (l.kind === 'parallel') return 'parallel';
  return l.label === FACE_PERPENDICULAR_LABEL ? 'facePerpendicular' : 'perpendicular';
}

/** 방향을 잡는 중인지(줄자 끝점·각도기 기준 방향·잴 방향 — 시작점을 지나는 선을 잠글 수 있다) */
export function directingPoints(mode: MeasureMode | null, points: number): boolean {
  return (mode === 'tape' && points === 1) || (mode === 'protractor' && (points === 1 || points === 2));
}

/**
 * 잠금 안내: 방향을 잡는 중이면 잠근 방향, 잠그지 않았으면 키보드 기기에만 Shift·화살표 안내(손가락 기기는 측정 띠 잠금 단추).
 * 각도기 중심을 찍기 전에는 화살표로 고정한 평면. 상태 줄·측정 띠는 measureHint 다음에 따로 둔다(번역이 안내 글을 한 덩어리로 찾게)
 */
export function lockHint(mode: MeasureMode | null, points: number, lock: LockName | null, plane: Axis | null, touch = false): string | null {
  if (directingPoints(mode, points)) return lock ? LOCK_HINTS[lock] : touch ? null : LOCK_KEYS_HINT;
  if (mode === 'protractor' && points === 0 && plane) return PLANE_HINTS[plane];
  return null;
}

export interface TapeResult {
  kind: 'tape';
  a: V3;
  b: V3;
  distance: number;
  dx: number;
  dy: number;
  dz: number;
}

export interface ProtractorResult {
  kind: 'protractor';
  center: V3;
  /** 기준 방향 점(평면 위) */
  a: V3;
  /** 잰 방향 점(평면 위) */
  b: V3;
  /** 도, 0~180 */
  angle: number;
  /** 각도기 평면 법선(단위) */
  normal: V3;
}

export type MeasureToolResult = TapeResult | ProtractorResult;

export interface MeasureToolOptions {
  getScene: () => Pick<Scene3d, 'meshes' | 'lines' | 'units'> | null;
  getUnits: () => UnitsDisplay;
  /** 측정을 마치면 결과, 결과를 지우면 null */
  onResult: (r: MeasureToolResult | null) => void;
  /** 상태 줄 안내(도구를 끄면 null) */
  onHint?: (text: string | null) => void;
  /** 손가락이 주인 기기인지: 안내에서 키(Esc·Shift) 설명을 빼고 길게 누르기를 알린다 */
  touch?: () => boolean;
  /** 선분(묶음 id, 선분 번호)이 든 호·원의 중심(세계, 곡선이 아니면 null) — "중심" 추정 */
  curveCenter?: (id: string, seg: number) => V3 | null;
  /** 모형의 그리기 축(옮겼으면 — 축 고정·각도기 기본 평면이 그 축을 따른다, 없으면 세계 축) */
  getAxes?: () => AxisDirs | null;
  /**
   * 측정값 칸 표시: 줄자는 진행 중이면 시작점 → 커서 길이, 아니면 줄자 결과 거리(장면 단위). 각도기는 기준 방향을 찍은 뒤 커서 각도,
   * 아니면 각도기 결과 각도(도). 없으면 null. 값이나 종류가 바뀔 때만 부른다
   */
  onLive?: (value: number | null, kind: LiveKind) => void;
  /** 추론 잠금이나 화살표로 고정한 각도기 평면, 끌어온 점 수가 바뀌면(측정 띠 잠금 단추·잠금 안내를 맞춘다) */
  onLock?: () => void;
  /** 안내 두기를 켜고 끄는 키(눌렀다 떼기 — 기본 Control, Mac은 'Alt' = Option) */
  guideKey?: GuideKey;
  /** 안내 두기를 켜고 끄거나 안내점·안내선이 늘고 줄거나, 되돌리기 목록·안내 보이기가 바뀌면(측정 띠 단추·측정값 칸의 안내 수를 맞춘다) */
  onGuides?: () => void;
  /**
   * 줄자·각도기를 끈 동안 고르기 상자나 모두 고르기 키(26차 — Ctrl+A·⌘A)로 안내를 골랐을 때(앱은 고른 형상을 푼다 — 고른 것은 형상이나 안내 한쪽).
   * 누르기로 고른 것은 앱이 pickGuide의 값으로 안다
   */
  onGuidePick?: () => void;
  /**
   * 줄자·각도기를 끈 동안 모두 풀기 키(26차 — Ctrl+T, Mac은 Shift+⌘A)를 눌렀을 때: 앱은 고른 형상을 풀고, 푼 것이 있었으면 true
   * (고른 안내는 이 도구가 푼다. 둘 다 없으면 그 키를 받지 않아 브라우저 몫이다)
   */
  onSelectNone?: () => boolean;
  /**
   * 결과 글이 비킬 먼저 놓인 글상자(26차 — 앱 덧그림의 모형 글·치수 라벨 배치, 캔버스 왼쪽 위 기준 CSS 화소. crowded — 흐리게 둔 것 — 는 자리를 차지하지 않는다).
   * 덧그림 층이 이 도구보다 먼저 그리는 층의 것이어야 같은 그림 틀의 자리다
   */
  placedLabels?: () => readonly { box: { x: number; y: number; w: number; h: number }; crowded?: boolean }[];
  /** 안내 보이기와 파일별 안내(guidestore.ts)를 기억하는 곳(없으면 이 브라우저 localStorage, null이면 기억하지 않음) */
  storage?: GuideStorage | null;
  /** 결과 글(길이·각도)이 비켜 갈 앱 요소(3D 보기 위에 뜬 측정 띠·측정값 칸 — 보이지 않는 요소는 넘어간다) */
  labelAvoid?: () => readonly (Element | null | undefined)[];
  /** 다른 점에서 끌어온 축(점 위에 머물러 기억한 점의 축 — 기본 켬, setTrack으로 바꾼다) */
  track?: boolean;
  /** 시작점 축이 모서리와 만나는 점, 시작점 축·끌어온 축이 면을 뚫는 점에 붙기(기본 켬, setAxisMeets로 바꾼다) */
  axisMeets?: boolean;
  /** 잠근 동안 잠근 선이 끌어온 점의 축·모서리·안내선과 만나는 점, 면을 뚫는 점에 붙기(기본 켬, setLockMeets로 바꾼다) */
  lockMeets?: boolean;
}

/**
 * 정밀 조준 십자선이 머무는 것으로 볼 거리(화소): 손가락은 가만히 대고 있어도 몇 화소 떨리므로 마우스·펜(코어 TRACK_DWELL_PX 2)보다 넓게
 * (휴대폰에서 1 mm쯤 — 조준 추정 반경 14화소의 반이 안 되어 다른 점으로 넘어가지는 않는다)
 */
export const AIM_DWELL_PX = 6;

/** 머물러 기억할 점 추정(시작점을 지나는 방향 추론인 모서리에 수직 추론은 빼고, 잠근 선 위 점도 뺀다) */
const DWELL_KINDS: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'center', 'intersection', 'perpendicular']);

/** 머물러 기억할 점인지(점 추정이고 방향 추론·잠근 선 위 점이 아니다) */
export function dwellPoint(s: Pick<Snap, 'kind' | 'inferred' | 'locked'> | null | undefined): boolean {
  return !!s && DWELL_KINDS.has(s.kind) && !s.inferred && !s.locked;
}

/** 끌어온 점 수 안내(상태 줄·측정 띠에서 잠금 안내 다음 — 없으면 null) */
export function trackHint(n: number): string | null {
  return n > 0 ? `끌어온 점 ${n}개` : null;
}

/** 잠근 곳: Shift(떼면 풀린다)·화살표 키·앱 단추 */
export type LockSource = 'shift' | 'key' | 'button';

/** 지금 잠근 방향 추론 */
export type MeasureLock = InferenceLock & { source: LockSource };

/** 툴팁에서 잠근 추정 이름 뒤에 붙는 글 */
export const LOCKED_LABEL = '잠금';

/** 화살표 → 축(SketchUp: 오른쪽 빨강, 왼쪽 녹색, 위 파랑 — ↓는 나란히·수직) */
const ARROW_AXES: Readonly<Record<string, Axis>> = Object.freeze({ ArrowRight: 'x', ArrowLeft: 'y', ArrowUp: 'z' });

/** 지나간 모서리로 기억하는 추정(나란함 기준) */
const REF_KINDS: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'onEdge', 'perpendicular']);

/** 고른 안내: 안내점(배열) 또는 안내선(객체) 그대로 */
type GuideRef = V3 | GuideLine;

/** 바로 앞 줄자 누르기(두 번 누르기 안내선): 붙은 모서리와, 그 누르기가 시작점을 찍었으면 그 점 배열과 그 전 결과(두 번 누르기면 되돌린다) */
interface TapMemo {
  edge: [V3, V3];
  pts: V3[] | null;
  result: MeasureToolResult | null;
  resultEdge: [V3, V3] | null;
}

/** 모서리 두 번 누르기로 볼 추정: 모서리 위·중간점·시작점에서 그 모서리에 내린 발(한 모서리에만 붙은 점) */
const TAP_EDGE_KINDS: ReadonlySet<SnapKind> = new Set(['onEdge', 'midpoint', 'perpendicular']);

/** 고른 안내 색(SketchUp에서 고른 것처럼 파랑) */
export const GUIDE_SELECTED_COLOR = '#1f6feb';

/** 툴팁의 추정 이름: 잠갔으면 "빨강 축에 · 잠금" */
export function snapTipLabel(s: Pick<Snap, 'label' | 'locked'>): string {
  return s.locked ? joinTip(s.label, LOCKED_LABEL) : s.label;
}

/** 측정값 칸 값의 종류(줄자 길이 · 각도기 각도) */
export type LiveKind = 'length' | 'angle';

/** 측정값 칸으로 길이를 넣은 결과: ok, 줄자가 아님(mode), 시작점·결과가 없음(start), 방향을 모름(direction), 길이 0(zero) */
export type LengthApply = 'ok' | 'mode' | 'start' | 'direction' | 'zero';

/** 측정값 칸으로 각도를 넣은 결과: ok, 각도기가 아님(mode), 중심·기준 방향·결과가 없음(start), 돌릴 쪽을 모름(direction), 0°(zero) */
export type AngleApply = LengthApply;

/** 측정값 칸에 넣지 못한 까닭 글(넣었거나 도구가 다르면 null) — 칸 위 말풍선 */
export function applyMessage(r: LengthApply, angle: boolean): string | null {
  if (r === 'zero') return angle ? '0이 아닌 각도를 치세요' : '0이 아닌 길이를 치세요';
  if (r === 'direction') return angle ? '커서를 돌릴 쪽으로 옮긴 뒤 치세요' : '커서를 잴 방향으로 옮긴 뒤 치세요';
  if (r === 'start') return angle ? '먼저 중심점과 기준 방향을 누르세요' : '먼저 시작점을 누르세요';
  return null;
}

/** 안내점을 기억하는 수(넘으면 오래된 것부터 버린다) */
export const MAX_GUIDE_POINTS = 50;

/** 안내선을 기억하는 수(넘으면 오래된 것부터 버린다) */
export const MAX_GUIDE_LINES = 50;

/** 기억해 두는 지나간 곡선 중심 수 */
export const RECENT_CENTERS = 4;

/** 안내 되돌리기 단계 수(넘으면 오래된 것부터 버린다) */
export const MAX_GUIDE_UNDO = 100;

/** 안내 보이기 설정을 이 브라우저에 기억하는 열쇠('0' = 숨김) */
export const GUIDES_SHOWN_KEY = 'opencad-skp.guides';

/** 보기 설정 메뉴의 안내 보이기 항목 글 */
export const GUIDES_SHOWN_LABEL = '안내점·안내선 보이기';

/** 측정 띠의 안내 되돌리기 단추 글 */
export const GUIDE_UNDO_LABEL = '방금 바꾼 안내 되돌리기';

/** 측정 띠의 안내 다시 하기 단추 글 */
export const GUIDE_REDO_LABEL = '되돌린 안내 다시 하기';

/** 보기 설정 메뉴의 이 파일 안내 모두 지우기 항목 글(측정값 칸의 ✕처럼 되돌릴 수 있다) */
export const GUIDE_CLEAR_FILE_LABEL = '이 파일의 안내 모두 지우기';

/** 고른 안내의 이름(고르기 도구로 고른 안내 — 상태 줄·고른 것 카드) */
export const GUIDE_KIND_NAMES: Readonly<Record<'point' | 'line', string>> = Object.freeze({ point: '안내점', line: '안내선' });

/** 고르기 도구로 고른 안내를 지우는 키 안내(키보드 기기의 상태 줄 — 손가락 기기는 고른 것 카드의 지우기 단추) */
export const GUIDE_DELETE_KEY_HINT = 'Delete·Backspace로 지우기';

/** 고른 것 카드의 고른 안내 지우기 단추 글 */
export const GUIDE_DELETE_TEXT = '지우기';

/** 고른 것 카드의 고른 안내 숨기기 단추 글과 이름(25차 — SketchUp 공개 도움말 "Using guides": 고른 안내를 Edit › Hide로 숨긴다) */
export const GUIDE_HIDE_TEXT = '숨기기';
export const GUIDE_HIDE_LABEL = '고른 안내 숨기기';

/** 보기 설정 메뉴의 숨긴 안내 모두 보이기 항목 글(Edit › Unhide의 모두 보이기처럼 — 숨긴 안내가 있을 때만 메뉴에 든다) */
export const GUIDE_UNHIDE_LABEL = '숨긴 안내 모두 보이기';

/**
 * 고른 안내의 이름(상태 줄·고른 것 카드): 하나면 안내점·안내선, 여럿이면 "안내점 2개"·"안내선 3개"·"안내점 2개·안내선 1개". 없으면 null
 */
export function guideCountText(points: number, lines: number): string | null {
  if (points + lines <= 0) return null;
  if (points + lines === 1) return GUIDE_KIND_NAMES[points ? 'point' : 'line'];
  if (!lines) return `안내점 ${points}개`;
  if (!points) return `안내선 ${lines}개`;
  return `안내점 ${points}개·안내선 ${lines}개`;
}

/** 고른 안내 지우기 단추 이름(측정값 칸·고른 것 카드): 안내점 하나·안내선 하나, 여럿이면 그 수 */
export function guideDeleteLabel(points: number, lines: number): string {
  if (points + lines > 1) return `고른 안내 ${points + lines}개 지우기`;
  return points ? '고른 안내점 지우기' : '고른 안내선 지우기';
}

/**
 * 고르기 방식(25차 — SketchUp 공개 도움말 "Selecting Geometry"의 고르기 도구 수정 키): replace = 수정 키 없음(새로 고른다),
 * add = Ctrl(Mac은 Option — 고른 것에 더하기), toggle = Shift(고르지 않은 것은 넣고 고른 것은 빼기), subtract = Shift+Ctrl(Mac은 Shift+Option — 빼기)
 */
export type GuideSelectOp = 'replace' | 'add' | 'toggle' | 'subtract';

/** 고르기 수정 키(누르기·끌기의 PointerEvent, 코어 PickEvent) */
export interface GuideSelectMods {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * 수정 키 → 고르기 방식. key는 안내 두기 키와 같은 판의 더하기 키다(Windows·Linux 'Control', Mac 'Alt' = Option — 도움말이 두 판에
 * 더하기 키로 든 것과 같다. Mac의 Ctrl+누르기는 브라우저가 오른쪽 단추로 보므로 쓰지 않는다)
 */
export function guideSelectOp(m: GuideSelectMods | null | undefined, key: GuideKey = 'Control'): GuideSelectOp {
  const add = !!m && (key === 'Alt' ? !!m.altKey : !!m.ctrlKey);
  if (m?.shiftKey) return add ? 'subtract' : 'toggle';
  return add ? 'add' : 'replace';
}

/** 고른 것(sel)에 refs를 고르기 방식대로 넣고 뺀 새 목록(고른 차례를 지키고 같은 것은 한 번) */
export function applyGuideSelect<T>(sel: readonly T[], refs: readonly T[], op: GuideSelectOp): T[] {
  if (op === 'replace') return [...new Set(refs)];
  const out = new Set(sel);
  for (const r of new Set(refs)) {
    if (op === 'add') out.add(r);
    else if (op === 'subtract' || out.has(r)) out.delete(r);
    else out.add(r);
  }
  return [...out];
}

/**
 * 고르기 상자(화면 (x0, y0)에서 (x1, y1)까지 끈 네모)에 드는 안내 번호(25차 — SketchUp 공개 도움말 "Selecting Geometry": 오른쪽으로 끌면
 * 상자 안에 다 든 것만, 왼쪽으로 끌면 상자 안에 다 들거나 걸친 것까지). 안내점은 표식 가운데가 상자 안(테두리 포함)이면 든다.
 * 안내선은 끝없는 직선이라 상자 안에 다 들 수 없어, 왼쪽으로 끌었을 때 그리는 화면 선분이 상자를 지나면 든다. 번호는 pts·lns의 차례
 */
export function guidesInBox(
  f: ViewFrame,
  pts: readonly (readonly number[])[],
  lns: readonly GuideLine[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { points: number[]; lines: number[] } {
  const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  const points: number[] = [];
  const lines: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const s = screenPoint(f, pts[i]!);
    if (s && s[0] >= l && s[0] <= r && s[1] >= t && s[1] <= b) points.push(i);
  }
  if (x1 < x0)
    for (let i = 0; i < lns.length; i++) {
      const s = guideLineScreen(f, lns[i]!);
      if (s && clipToRect(s, l, t, r, b)) lines.push(i);
    }
  return { points, lines };
}

/** 배열에서 모음에 든 것을 뺀 것(빠진 것이 없으면 그 배열 그대로 — 안내 배열이 같은 객체인지로 바뀜을 본다) */
function without<T>(a: T[], gone: ReadonlySet<unknown>): T[] {
  const r = a.filter((x) => !gone.has(x));
  return r.length === a.length ? a : r;
}

/** 코어에 그 포인터의 끌기를 거둔 것으로 알린다(고르기 상자를 뗀 자리를 코어가 누르기로 보고 고르지 않게 — 떼기보다 먼저 보낸다) */
function cancelPointer(target: EventTarget, e: PointerEvent): void {
  const init = { bubbles: true, pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY };
  let c: Event;
  if (typeof PointerEvent === 'function') c = new PointerEvent('pointercancel', init);
  else {
    // PointerEvent가 없는 환경(시험의 jsdom)
    c = new MouseEvent('pointercancel', init);
    Object.defineProperty(c, 'pointerId', { value: e.pointerId });
    Object.defineProperty(c, 'pointerType', { value: e.pointerType });
  }
  target.dispatchEvent(c);
}

/**
 * 고르기 도구(줄자·각도기를 끈 동안)의 누르기가 고르는 안내(23차 — SketchUp 공개 도움말 "Using guides": 고르기 도구로 안내를 골라 지운다).
 * 화면 자리 (x, y)에서 tol 화소 안의 안내점(표식 가운데)·안내선(그리는 화면 선분)을 찾는다. 안내점이 있으면 가장 가까운 안내점(점 표식이 선 위에 그려지고
 * 일부러 겨눈 것이라), 없으면 가장 가까운 안내선, 둘 다 없으면 null. 같은 거리면 먼저 둔 것
 */
export function guideHit(
  f: ViewFrame,
  pts: readonly (readonly number[])[],
  lns: readonly GuideLine[],
  x: number,
  y: number,
  tol: number,
): { kind: 'point' | 'line'; index: number } | null {
  let point = -1;
  let bd = tol;
  for (let i = 0; i < pts.length; i++) {
    const s = screenPoint(f, pts[i]!, tol);
    const d = s ? Math.hypot(s[0] - x, s[1] - y) : Infinity;
    if (d < bd || (d === bd && point < 0)) {
      point = i;
      bd = d;
    }
  }
  if (point >= 0) return { kind: 'point', index: point };
  let line = -1;
  bd = tol;
  for (let i = 0; i < lns.length; i++) {
    const s = guideLineScreen(f, lns[i]!);
    const d = s ? segDist(x, y, s[0], s[1], s[2], s[3]) : Infinity;
    if (d < bd || (d === bd && line < 0)) {
      line = i;
      bd = d;
    }
  }
  return line >= 0 ? { kind: 'line', index: line } : null;
}

/** 점 (x, y)에서 화면 선분 (ax, ay)–(bx, by)까지의 거리 */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}

/** 되돌리기 아이콘(반시계로 도는 화살표 — 다시 재기의 ← 아이콘과 다르게) */
const UNDO_PATHS = '<path d="M3.5 7.5v5.5H9"/><path d="M20.5 17a8.5 8.5 0 0 0-14.5-6L3.5 13"/>';
/** 다시 하기 아이콘(되돌리기를 좌우로 뒤집은 것) */
const REDO_PATHS = '<path d="M20.5 7.5v5.5H15"/><path d="M3.5 17a8.5 8.5 0 0 1 14.5-6l2.5 2"/>';

/** 정밀 조준 십자선(반지름 16에 팔 6과 흰 테)이 차지하는 반지름 — 결과 글이 비켜 간다 */
const RETICLE_AVOID_R = 24;

/** 되돌리기 목록 한 칸: 그때의 안내점·안내선 배열과 숨긴 안내(배열·모음은 고치지 않고 늘 새로 만들므로 통째로 기억한다) */
interface GuideSnapshot {
  pts: V3[];
  lns: GuideLine[];
  hid: ReadonlySet<GuideRef>;
}

/** 숨긴 안내가 없을 때의 빈 모음 */
const NO_GUIDES: ReadonlySet<GuideRef> = new Set();

/** 고르기 상자(줄자·각도기를 끈 동안 고르기 수정 키를 누른 채 끌기): 포인터, 누른 자리와 지금 자리(캔버스 좌표), 고르기 방식, 끌기 시작 거리를 넘었는지 */
interface GuideBox {
  id: number;
  type: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  op: GuideSelectOp;
  on: boolean;
}

/**
 * 모두 고르기·모두 풀기 키(26차 — SketchUp 공개 도움말 "Selecting Geometry": Edit › Select All은 Microsoft Windows Ctrl+A·macOS Command+A,
 * Edit › Deselect All은 Microsoft Windows Ctrl+T·macOS Shift+Command+A). key는 안내 두기 키라 그 판(Mac이면 'Alt')을 가른다 —
 * Mac은 ⌘(Ctrl은 아니다), 그 밖은 Ctrl(⌘·Windows 키는 아니다). Alt·Option이 함께면 아니다.
 * 글자는 key로 보고, 라틴 글자가 아니면(한글 자판 등) 물리 키(code)로 본다. 아니면 null
 */
export function selectAllKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, key: GuideKey = 'Control'): 'all' | 'none' | null {
  const mac = key === 'Alt';
  if (e.altKey || !(mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return null;
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyA' ? 'a' : e.code === 'KeyT' ? 't' : '';
  if (k === 'a') return e.shiftKey ? (mac ? 'none' : null) : 'all';
  return k === 't' && !mac && !e.shiftKey ? 'none' : null;
}

/**
 * 안내 되돌리기·다시 하기 키(keydown): Ctrl·⌘+Z는 되돌리기, Ctrl·⌘+Shift+Z와 Ctrl+Y는 다시 하기(Alt·Option이 함께면 아니다).
 * 글자는 key로 보고, 라틴 글자가 아니면(한글 자판 등) 물리 키(code)로 본다
 */
export function guideUndoKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  // ⌘Y는 Mac 브라우저의 방문 기록이라 Ctrl+Y만
  return k === 'y' && e.ctrlKey && !e.shiftKey ? 'redo' : null;
}

/** 보기 설정 메뉴 항목 꼴(앱 메뉴가 그대로 쓴다) */
export interface GuideMenuItem {
  label: string;
  icon?: string;
  checked?: boolean;
  toggle?: true;
  disabled?: boolean;
  run: () => void;
}

/** 이 도구가 쓰는 뷰어 기능(시험에서 가짜로 바꿀 수 있게) */
export type MeasureViewer = Pick<Viewer3d, 'canvas' | 'pick' | 'getCamera' | 'onCameraChange' | 'getRenderMode' | 'section'> &
  Partial<Pick<Viewer3d, 'sections' | 'viewCubeRect' | 'navigation'>>;
/** 이 도구가 쓰는 덧그림 기능 */
export type MeasureOverlay = Pick<Overlay, 'svg' | 'labels' | 'set' | 'frame' | 'invalidate'>;

/**
 * 누르기로 볼 최대 움직임(화소): 코어 끌기 시작 거리와 같다(마우스·펜 DRAG_START_PX 4, 터치 TOUCH_DRAG_START_PX 10).
 * 이보다 덜 움직였으면 코어도 돌리지 않으므로, 손가락이 몇 화소 떨려도 점을 찍고 정밀 조준 타이머도 이어 간다
 */
export const tapSlopPx = (pointerType: string): number => dragStartPx(pointerType);
/** 이만큼(ms) 움직이지 않고 누르고 있으면 정밀 조준 */
export const AIM_HOLD_MS = 350;
/** 정밀 조준 십자선을 손가락 위로 띄우는 거리(화소) — 손가락에 가리지 않게 */
export const AIM_OFFSET_PX = 64;
/** 둘레 고르기 시간 한도(ms): 마우스는 움직일 때마다, 터치는 탭할 때만 */
const PROBE_BUDGET_MS = 6;
const TOUCH_PROBE_BUDGET_MS = 24;
/** 가림 판정 고르기 최대 횟수(추정 한 번에) */
const VISIBLE_CHECKS = 4;
/** 축·잠근 선이 면을 뚫는 점을 다시 맞춰 보는 고르기: 그물 면만(코어 0.20.0 — 선분·점·윤곽선은 고르지도 않고 면을 가리지도 않는다) */
const FACE_PICK = { meshesOnly: true } as const;
/** 각도기 원판 반지름·호 반지름(화소) */
const PROTRACTOR_PX = 44;
const ARC_PX = 26;
const PAINTER_KEY = 'measure';

// ───────────────────────── 순수 함수 ─────────────────────────

const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const addScaled = (p: readonly number[], u: readonly number[], s: number): V3 => [p[0]! + u[0]! * s, p[1]! + u[1]! * s, p[2]! + u[2]! * s];
function unit(a: readonly number[]): V3 {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!);
  return l > 1e-300 ? [a[0]! / l, a[1]! / l, a[2]! / l] : [0, 0, 0];
}

/** 추정 반경(화소): 터치는 넓게, 정밀 조준('aim')은 그 사이 */
export function snapRadius(pointerType: string): number {
  return pointerType === 'touch' ? TOUCH_SNAP_RADIUS_PX : pointerType === 'aim' ? AIM_SNAP_RADIUS_PX : SNAP_RADIUS_PX;
}

/** 정밀 조준 십자선이 3D 보기 위에 뜬 것에서 떨어지는 거리(화소) — 십자선 가운데 빈 자리(6)와 둘레가 보이게 */
export const AIM_COVER_GAP_PX = 8;

/**
 * 정밀 조준 십자선 자리: 손가락 바로 위(보기 위 가장자리에서 멈춘다). covers(3D 보기 위에 뜬 장면 탭·뷰 큐브·측정 띠 등 — 캔버스 좌표,
 * 결과 글·툴팁이 비키는 22차 coverAreas와 같은 것)가 있으면 그 밑에 숨지 않게(25차) 그 덮개에 AIM_COVER_GAP_PX 안으로 들어간 자리를
 * 가장 가까운 변 바깥으로 민다 — 덮개 밑은 보이지 않아 겨눌 수 없으므로 보기 위 가장자리처럼 벽으로 본다(손가락을 더 올려도 십자선은 덮개 아래 변에 머문다).
 * 민 자리가 보기(view — 없으면 위·왼쪽만) 가장자리에서 GAP 안이면 그 변은 쓰지 않고(장면 탭 위 좁은 틈·화면 끝으로 밀지 않게), 다른 덮개에 드는 변보다
 * 들지 않는 변을 먼저 쓴다(맞붙은 덮개 사이를 오가지 않게). 덮개마다 한 번
 */
export function aimPoint(
  x: number,
  y: number,
  covers: readonly MeasureLabelRect[] = [],
  view?: { width: number; height: number },
): { x: number; y: number } {
  const p = { x, y: Math.max(0, y - AIM_OFFSET_PX) };
  const g = AIM_COVER_GAP_PX;
  const w = view?.width ?? Infinity, h = view?.height ?? Infinity;
  const near = (q: { x: number; y: number }, r: MeasureLabelRect, e: number): boolean =>
    q.x > r.x - g - e && q.x < r.x + r.width + g + e && q.y > r.y - g - e && q.y < r.y + r.height + g + e;
  const done = new Set<MeasureLabelRect>();
  for (;;) {
    // 덮개(와 GAP)에 든 자리 — 경계 위도 든 것으로
    const c = covers.find((r) => !done.has(r) && near(p, r, 1e-9));
    if (!c) break;
    done.add(c);
    let best: { x: number; y: number; d: number; free: boolean } | null = null;
    for (const q of [
      { x: p.x, y: c.y + c.height + g },
      { x: c.x + c.width + g, y: p.y },
      { x: c.x - g, y: p.y },
      { x: p.x, y: c.y - g },
    ]) {
      if (q.x < g || q.y < g || q.x > w - g || q.y > h - g) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      const free = !covers.some((r) => r !== c && near(q, r, 0));
      if (!best || (free && !best.free) || (free === best.free && d < best.d)) best = { ...q, d, free };
    }
    if (best) {
      p.x = best.x;
      p.y = best.y;
    }
  }
  return p;
}

/**
 * 시작점 a에서 toward 쪽으로 length만큼 간 점(length가 음수면 반대쪽). 방향 길이가 a 크기에 비해 0이면 null
 */
export function pointAlong(a: readonly number[], toward: readonly number[], length: number): V3 | null {
  const d = sub(toward, a);
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 1e-9 * Math.max(1, Math.hypot(a[0]!, a[1]!, a[2]!))) || !Number.isFinite(length)) return null;
  return addScaled(a, d, length / l);
}

/**
 * 모서리와 나란한 안내선 자리(SketchUp 줄자를 모서리 위에서 시작): 시작점 a에서 모서리 방향에 수직인 toward 쪽으로 length만큼 간 점
 * (length가 음수면 반대쪽). toward가 모서리 직선 위(수직 성분이 a 크기에 비해 0)이거나 모서리 길이가 0이면 null
 */
export function parallelOffset(a: readonly number[], edge: readonly [readonly number[], readonly number[]], toward: readonly number[], length: number): V3 | null {
  const u = unit(sub(edge[1], edge[0]));
  if (!dot(u, u) || !Number.isFinite(length)) return null;
  const d = sub(toward, a);
  const w = addScaled(d, u, -dot(d, u));
  const l = Math.hypot(w[0], w[1], w[2]);
  if (!(l > 1e-9 * Math.max(1, Math.hypot(a[0]!, a[1]!, a[2]!)))) return null;
  return addScaled(a, w, length / l);
}

/**
 * 누르기로 두는 나란한 안내선의 발(안내 두기, SketchUp 줄자를 모서리 위에서 시작): 시작점 a에서 점 p 쪽으로 모서리에 수직으로 간 점
 * (= a에서 p를 지나 모서리와 나란한 직선에 내린 발 — 결과는 모서리와 안내선 사이 거리). p가 모서리 직선 위거나 모서리 길이가 0이면 null
 */
export function edgeFoot(a: readonly number[], edge: readonly [readonly number[], readonly number[]], p: readonly number[]): V3 | null {
  const u = unit(sub(edge[1], edge[0]));
  if (!dot(u, u)) return null;
  const d = sub(p, a);
  const w = addScaled(d, u, -dot(d, u));
  const scale = Math.max(1, Math.hypot(a[0]!, a[1]!, a[2]!), Math.hypot(d[0], d[1], d[2]));
  if (!(Math.hypot(w[0], w[1], w[2]) > 1e-9 * scale)) return null;
  return addScaled(a, w, 1);
}

/**
 * 두 번 누르기로 안내선을 둘 모서리(SketchUp 줄자: 모서리를 두 번 누르면 그 모서리 위에 끝없는 안내선): 모서리 위·중간점·시작점에서 내린 수직 발처럼
 * 한 모서리에 붙은 점 추정이면 그 선분(곡선이면 누른 조각 하나, 안내선이면 그 안내선 위 선분). 끝점·교차점(모서리가 여럿)·면·축·방향 추론·잠근 선,
 * 길이 0인 선분이면 null
 */
export function edgeOfTap(s: Pick<Snap, 'kind' | 'edge' | 'inferred' | 'locked'> | null | undefined): [V3, V3] | null {
  if (!s?.edge || !TAP_EDGE_KINDS.has(s.kind) || s.inferred || s.locked) return null;
  const [a, b] = s.edge;
  const d = sub(b, a);
  if (!(Math.hypot(d[0], d[1], d[2]) > 1e-9 * Math.max(1, Math.hypot(a[0], a[1], a[2])))) return null;
  return [[a[0], a[1], a[2]], [b[0], b[1], b[2]]];
}

/** 두 선분이 한 직선 위인지(방향이 거의 같고 둘째 선분의 두 끝이 첫째 직선 위 — 한 모서리를 나눈 선분·같은 안내선 위 선분도 된다) */
export function collinear(e: readonly [readonly number[], readonly number[]], f: readonly [readonly number[], readonly number[]]): boolean {
  const u = unit(sub(e[1], e[0]));
  const v = unit(sub(f[1], f[0]));
  if (!dot(u, u) || !dot(v, v) || Math.abs(dot(u, v)) < 1 - 1e-6) return false;
  const scale = Math.max(1, ...[e[0], e[1], f[0], f[1]].map((p) => Math.hypot(p[0]!, p[1]!, p[2]!)), Math.hypot(...sub(e[1], e[0])));
  return [f[0], f[1]].every((p) => {
    const w = sub(p, e[0]);
    return Math.hypot(...addScaled(w, u, -dot(w, u))) <= 1e-6 * scale;
  });
}

/**
 * 각도기 안내선 방향(단위): 중심 c에서 본 기준 방향(base)을 평면(법선 n) 안에서 deg도 돌린 방향.
 * 도는 쪽은 toward(커서·잰 방향 점)가 있는 쪽이고 deg가 음수면 반대쪽이다. toward가 없거나 기준 직선 위면 법선 n 둘레 시계 반대쪽.
 * 기준 방향이 평면에 비쳐 길이가 0이면 null
 */
export function angledGuideDir(c: readonly number[], base: readonly number[], toward: readonly number[] | null, n: readonly number[], deg: number): V3 | null {
  const nn = unit(n);
  const b = sub(base, c);
  const u = unit(addScaled(b, nn, -dot(b, nn)));
  if (!dot(u, u) || !dot(nn, nn) || !Number.isFinite(deg)) return null;
  const v = cross(nn, u);
  let side = 1;
  if (toward) {
    const t = sub(toward, c);
    const s = dot(t, v);
    if (Math.abs(s) > 1e-9 * Math.max(1e-300, Math.hypot(t[0], t[1], t[2]))) side = Math.sign(s);
  }
  const r = (deg * Math.PI) / 180;
  return unit(addScaled(addScaled([0, 0, 0], u, Math.cos(r)), v, side * Math.sin(r)));
}

/**
 * 안내선(끝이 없는 직선)을 그릴 화면 선분: 화면 가운데 시선에 가장 가까운 선 위 점에서 양쪽으로 멀리 뻗고, 원근이면 눈 앞에서 자른 뒤
 * 보기 사각형(margin 화소 밖까지)으로 자른다. 시선과 거의 나란해 점으로 보이거나 화면에 들지 않으면 null
 */
export function guideLineScreen(f: ViewFrame, line: GuideLine, margin = 4): [number, number, number, number] | null {
  const u = unit(line.dir);
  if (!dot(u, u)) return null;
  const fwd = forwardOf(f);
  const sin = Math.hypot(...cross(u, fwd));
  if (!(sin > 1e-6)) return null;
  const c = closestOnLine({ origin: f.eye, dir: fwd }, line.point, u) ?? [line.point[0], line.point[1], line.point[2]];
  const toEye = Math.hypot(...sub(c, f.eye));
  let seg: [number, number, number, number] | null;
  if (f.projection === 'perspective') {
    // 아주 멀리(눈까지 거리의 만 배) 뻗으면 그 끝은 소실점에 거의 닿는다. 눈 뒤로 넘어간 쪽은 눈 앞 가까운 곳에서 자른다
    const half = Math.max(toEye, 1e-9) * 1e4;
    seg = screenSegment(f, addScaled(c, u, -half), addScaled(c, u, half), Math.max(1e-6, toEye * 1e-3));
  } else {
    const half = ((f.width + f.height) * f.pixelConst) / sin;
    seg = screenSegment(f, addScaled(c, u, -half), addScaled(c, u, half));
  }
  return seg ? clipToRect(seg, -margin, -margin, f.width + margin, f.height + margin) : null;
}

/** 선 색(CSS rgb 글)과 반대 밝기의 테두리 색: 밝은 선이면 검정, 어둡거나 모르면 흰색 */
export function haloFor(color: string): string {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color);
  if (!m) return '#ffffff';
  return 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]) > 140 ? '#000000' : '#ffffff';
}

/** 화면 선분을 사각형으로 자른다(Liang–Barsky). 사각형에 들지 않으면 null */
export function clipToRect(s: readonly [number, number, number, number], x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  const [ax, ay, bx, by] = s;
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** 줄자 결과(장면 단위) */
export function tapeResult(a: readonly number[], b: readonly number[]): TapeResult {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
  return { kind: 'tape', a: [a[0]!, a[1]!, a[2]!], b: [b[0]!, b[1]!, b[2]!], distance: Math.hypot(dx, dy, dz), dx, dy, dz };
}

/** 법선 n 평면에 비친 u와 v 사이 각(도, 0~180). 비친 길이가 0이면 0 */
export function planeAngle(u: readonly number[], v: readonly number[], n: readonly number[]): number {
  const nn = unit(n);
  const a = unit(addScaled(u, nn, -dot(u, nn)));
  const b = unit(addScaled(v, nn, -dot(v, nn)));
  if (!dot(a, a) || !dot(b, b)) return 0;
  // acos는 0·180° 둘레에서 정밀도를 잃어 atan2로 잰다
  return (Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) * 180) / Math.PI;
}

/** 각도기 결과 */
export function protractorResult(center: readonly number[], a: readonly number[], b: readonly number[], normal: readonly number[]): ProtractorResult {
  const c: V3 = [center[0]!, center[1]!, center[2]!];
  return { kind: 'protractor', center: c, a: [a[0]!, a[1]!, a[2]!], b: [b[0]!, b[1]!, b[2]!], angle: planeAngle(sub(a, c), sub(b, c), normal), normal: unit(normal) };
}

/**
 * 각도기 평면: 추정에 면 법선이 있으면 그 면, 없으면 카메라를 가장 정면으로 보는 축 평면(SketchUp 파랑·빨강·초록 각도기).
 * forward는 눈이 보는 방향.
 */
export function protractorPlane(snap: Pick<Snap, 'normal'> | null, forward: readonly number[], axes: AxisDirs = AXIS_DIRS): { normal: V3; axis: Axis | null } {
  if (snap?.normal) {
    const n = unit(snap.normal);
    if (dot(n, n) > 0) return { normal: n, axis: axisOf(n, axes) };
  }
  let best: Axis = 'z';
  for (const a of ['z', 'x', 'y'] as const) if (Math.abs(dot(axes[a], forward)) > Math.abs(dot(axes[best], forward)) + 1e-12) best = a;
  return { normal: [...axes[best]], axis: best };
}

/** 점을 평면(지나는 점 c, 법선 n)에 내린 점 */
export function projectToPlane(p: readonly number[], c: readonly number[], n: readonly number[]): V3 {
  const nn = unit(n);
  return addScaled(p, nn, -dot(sub(p, c), nn));
}

/**
 * 각도기 둘째·셋째 점: 끝점·중간점·모서리·축 추정은 그 점을 평면에 내리고,
 * 면 위·빈 곳은 커서 광선과 평면의 교점(평면이 거의 옆으로 보이면 내린 점).
 */
export function protractorPoint(ray: Ray, snap: Pick<Snap, 'kind' | 'point'>, center: readonly number[], normal: readonly number[]): V3 {
  const n = unit(normal);
  if ((snap.kind === 'onFace' || snap.kind === 'free') && Math.abs(dot(n, ray.dir)) > 0.02) {
    const p = rayPlane(ray, center, n);
    if (p) return p;
  }
  return projectToPlane(snap.point, center, n);
}

/**
 * 툴팁 자리: 커서 오른쪽 아래, 보기 밖으로 나가면 왼쪽·위로 뒤집는다.
 * above(정밀 조준)면 커서 오른쪽 위 — 아래에는 손가락이 있다. 위가 모자라면 아래로.
 * avoid(22차 — 3D 보기 위에 뜬 뷰 큐브·장면 탭·측정 띠, coverRects)를 덮으면 위아래 → 좌우 → 둘 다 뒤집은 자리 가운데 비는 첫 자리(모두 걸리면 처음 자리).
 * 덮지 않으면 예전과 같은 자리다
 */
export function tooltipPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  width: number,
  height: number,
  above = false,
  avoid: readonly MeasureLabelRect[] = [],
): { left: number; top: number } {
  const spot = (flipX: boolean, flipY: boolean): { left: number; top: number } => {
    let left = flipX ? x - 10 - w : x + 14;
    const up = above !== flipY;
    let top = up ? y - 18 - h : y + 18;
    if (flipX ? left < 2 : left + w > width - 2) left = flipX ? x + 14 : x - 10 - w;
    if (up ? top < 2 : top + h > height - 2) top = up ? y + 18 : y - 10 - h;
    left = Math.max(2, Math.min(left, width - w - 2));
    top = Math.max(2, Math.min(top, height - h - 2));
    return { left: Math.round(left), top: Math.round(top) };
  };
  const first = spot(false, false);
  if (!avoid.length || !(w > 0 && h > 0)) return first;
  for (const [fx, fy] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const s = fx || fy ? spot(fx, fy) : first;
    if (!hitsAvoid({ x: s.left, y: s.top, width: w, height: h }, { rects: avoid })) return s;
  }
  return first;
}

/** 캔버스 가장자리 바깥 띠의 두께(화소) */
const EDGE_BAND_PX = 4096;

/**
 * 보기(너비 width·높이 height) 바깥 네 띠(22차): 결과 글이 여기에 걸치면 보기 밖으로 잘린다(휴대폰은 위 도구 띠·아래 상태 줄·화면 끝).
 * 보기에 걸친 결과 글만 이 띠를 비킨다(settleLabels — 코어 차례의 자리는 보기 안으로 당겨진다)
 */
export function edgeBands(width: number, height: number): MeasureLabelRect[] {
  const B = EDGE_BAND_PX;
  return [
    { x: -B, y: -B, width: B, height: height + 2 * B },
    { x: width, y: -B, width: B, height: height + 2 * B },
    { x: 0, y: -B, width, height: B },
    { x: 0, y: height, width, height: B },
  ];
}

/**
 * 3D 보기 위에 떠 있는 요소 자리(화면 좌표 getBoundingClientRect)를 캔버스 왼쪽 위 기준 사각형으로(22차 — NC 23차 coverRects처럼).
 * 크기가 0인 것(숨긴 요소 — display: none)은 뺀다. 값은 맞추지 않는다(측정 띠·측정값 칸은 21차까지와 같은 자리를 비킨다)
 */
export function coverRects(
  canvas: { left: number; top: number },
  boxes: readonly ({ left: number; top: number; width: number; height: number } | null | undefined)[],
): MeasureLabelRect[] {
  const out: MeasureLabelRect[] = [];
  for (const b of boxes) if (b && b.width > 0 && b.height > 0) out.push({ x: b.left - canvas.left, y: b.top - canvas.top, width: b.width, height: b.height });
  return out;
}

/**
 * 모형 글·치수 라벨 배치(annotations.ts layoutAnnotations의 box — 글자 수로 어림한 상자, 캔버스 기준) → 결과 글이 비킬 먼저 놓인 글상자(26차).
 * 흐리게 둔 라벨(crowded — 자리를 차지하지 않는다)과 크기가 0인 것은 뺀다. 차례는 라벨을 놓은 차례 그대로
 */
export function placedRects(list: readonly { box: { x: number; y: number; w: number; h: number }; crowded?: boolean }[]): MeasureLabelRect[] {
  const out: MeasureLabelRect[] = [];
  for (const p of list) if (!p.crowded && p.box.w > 0 && p.box.h > 0) out.push({ x: p.box.x, y: p.box.y, width: p.box.w, height: p.box.h });
  return out;
}

/**
 * 결과 글(줄자 길이·각도기 각도) 자리: 기본은 기준점(x, y) 가운데. 그 자리가 피할 자리(정밀 조준 십자선·손가락, 툴팁, 측정 띠)와 겹치면
 * 코어 0.13.0 순수 함수 placeMeasureLabel의 차례(기준점 오른쪽 위 → 왼쪽 위 → 오른쪽 아래 → 왼쪽 아래 → 화면 선분 seg를 따라 → 피할 자리 위·아래)로
 * 겹치지 않는 첫 자리의 왼쪽 위 좌표(soft — 측정 점 표식 — 까지 비키는 자리를 먼저). 겹치지 않거나, 옮겨도 겹치거나, 크기를 모르면 null(기본 자리 그대로).
 * 코어 거리 글상자를 비키는 setMeasureLabelAvoid와 같은 규칙이다(이 도구는 코어 측정을 쓰지 않아 그 글상자가 없다).
 * placed(26차 — 먼저 놓인 글상자: 모형의 글·치수 라벨, 앞서 놓은 결과 글)가 있으면 코어 0.24.0 placeLabelAmong으로 그것도 비킨다:
 * 위 자리가 먼저 놓인 글상자와 겹치지 않으면 그 자리 그대로이고(그래서 placed가 비었거나 겹치지 않으면 예전과 같다), 겹치면 먼저 놓인 것까지 비키는 자리.
 * 피할 자리와는 겹치지 않던 가운데 자리가 먼저 놓인 글상자와만 겹치는데 비킬 곳이 없으면 가운데 그대로(null)
 */
export function labelSpot(
  x: number,
  y: number,
  width: number,
  height: number,
  view: { width: number; height: number },
  avoid: LabelAvoidAreas,
  seg?: readonly [readonly number[], readonly number[]] | null,
  soft?: readonly LabelCircle[],
  placed: readonly MeasureLabelRect[] = [],
): { x: number; y: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const c = { x: x - width / 2, y: y - height / 2, width, height };
  const hit = hitsAvoid(c, avoid);
  if (!hit && !placed.some((p) => rectsOverlap(c, p))) return null;
  const a = soft?.length ? { ...avoid, soft } : avoid;
  const r = placed.length ? placeLabelAmong([x, y], { width, height }, view, a, placed, seg) : placeMeasureLabel([x, y], { width, height }, view, a, seg);
  if (hitsAvoid(r, avoid) || (!hit && placed.some((p) => rectsOverlap(r, p)))) return null;
  return { x: r.x, y: r.y };
}

/** 툴팁 글: "끝점 · 1200 mm" */
export function joinTip(label: string, value?: string | null): string {
  return [label, value].filter((s) => !!s).join(' · ');
}

/**
 * 상태 줄 안내. touch면 키 설명 대신 길게 누르기(정밀 조준)를 알린다.
 * edgeStart: 줄자 시작점이 모서리 위(끝점·중간점이 아닌 곳)라 길이를 치면 안내점 대신 나란한 안내선을 둔다.
 * guide: 안내 두기를 켰다(누르기로 안내점·안내선을 둔다)
 */
export function measureHint(mode: MeasureMode | null, points: number, hasResult: boolean, touch = false, edgeStart = false, guide = false): string | null {
  if (mode === 'tape') {
    if (points === 1) {
      if (guide) {
        const at = edgeStart ? '줄자: 모서리와 나란한 안내선을 둘 곳을 누르세요' : '줄자: 안내점을 둘 곳을 누르세요';
        return touch ? at : `${at} · 길이를 치면 그 거리에 · Esc 취소`;
      }
      if (touch) return '줄자: 끝점을 누르세요';
      return edgeStart ? '줄자: 끝점을 누르세요 · 길이를 치면 모서리와 나란한 안내선 · Esc 취소' : '줄자: 끝점을 누르세요 · 길이를 치면 안내점 · Esc 취소';
    }
    if (hasResult) return touch ? '줄자: 다시 누르면 새로 잽니다' : '줄자: 다시 누르면 새로 잽니다 · Esc 지우기';
    if (guide) return touch ? '줄자: 안내를 둘 시작점을 누르세요 · 길게 누르면 정밀 조준' : '줄자: 안내를 둘 시작점을 누르세요 · 모서리 위면 나란한 안내선, 점이면 안내점';
    // 모서리 두 번 누르기(그 모서리 위 안내선)는 상태 줄에 자리가 있는 키보드 기기 처음 안내에만(측정 띠는 짧게 — 손가락 기기는 정밀 조준 안내)
    return touch ? '줄자: 잴 시작점을 누르세요 · 길게 누르면 정밀 조준' : '줄자: 잴 시작점을 누르세요 · 모서리를 두 번 누르면 그 위에 안내선';
  }
  if (mode === 'protractor') {
    if (points === 1) return touch ? '각도기: 기준 방향의 점을 누르세요' : '각도기: 기준 방향의 점을 누르세요 · Esc 취소';
    if (points === 2 && guide) return touch ? '각도기: 안내선을 둘 방향의 점을 누르세요' : '각도기: 안내선을 둘 방향의 점을 누르세요 · 각도를 치면 그 각도에 · Esc 취소';
    if (points === 2) return touch ? '각도기: 잴 방향의 점을 누르세요' : '각도기: 잴 방향의 점을 누르세요 · 각도를 치면 안내선 · Esc 취소';
    if (hasResult) return touch ? '각도기: 다시 누르면 새로 잽니다' : '각도기: 다시 누르면 새로 잽니다 · Esc 지우기';
    return touch ? '각도기: 중심점을 누르세요 · 길게 누르면 정밀 조준' : '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정';
  }
  return null;
}

/** 평면 안 단위 기저(u, v): 원판·호 그리기용 */
function planeBasis(n: readonly number[]): [V3, V3] {
  const nn = unit(n);
  const u = unit(Math.abs(nn[2]) < 0.9 ? cross(nn, [0, 0, 1]) : cross(nn, [1, 0, 0]));
  return [u, cross(nn, u)];
}

// ───────────────────────── 도구 ─────────────────────────

interface Press {
  x: number;
  y: number;
  /** 마지막 자리(떨린 만큼 — 정밀 조준 십자선을 지금 손가락 위에 띄운다) */
  lx: number;
  ly: number;
  button: number;
  type: string;
  moved: boolean;
}

interface Cursor {
  x: number;
  y: number;
  type: string;
  /** 정밀 조준 중 손가락 자리(십자선은 그 위 — 덮개를 비키면 손가락과의 거리가 달라진다) */
  fx?: number;
  fy?: number;
}

export class MeasureTool {
  private modeValue: MeasureMode | null = null;
  /** 찍은 점(줄자: 시작점, 각도기: 중심·기준 방향) */
  private pts: V3[] = [];
  /** 각도기 평면(중심을 찍으면 정한다) */
  private normal: V3 | null = null;
  /** Shift로 고정한 각도기 평면 */
  private planeLock: V3 | null = null;
  /** 커서 밑 각도기 평면(Shift 고정에 쓴다) */
  private hoverPlane: V3 | null = null;
  private resultValue: MeasureToolResult | null = null;
  private cursor: Cursor | null = null;
  private hover: Snap | null = null;
  /** 지금 커서로 찍힐 점(각도기 둘째·셋째 점은 평면 위) */
  private hoverPoint: V3 | null = null;
  private hoverDirty = false;
  private dragging = false;
  private presses = new Map<number, Press>();
  private cancelTap = false;
  /** 정밀 조준 중인 손가락(포인터 id)과 길게 누르기 타이머 */
  private aimId: number | null = null;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHint: string | null = null;
  /** 앞서 커서가 지나간 호·원의 중심(새것이 앞) */
  private centers: V3[] = [];
  /** 측정값 칸으로 찍은 안내점(오래된 것이 앞) */
  private guidePts: V3[] = [];
  /** 측정값 칸으로 둔 안내선(오래된 것이 앞) */
  private guideLns: GuideLine[] = [];
  /** 줄자 시작점이 모서리 위(끝점·중간점이 아닌 곳)면 그 모서리(나란한 안내선 방향) */
  private startEdge: [V3, V3] | null = null;
  /** 지금 줄자 결과가 모서리 위에서 시작했으면 그 모서리(다 잰 뒤 친 길이도 나란한 안내선으로) */
  private resultEdge: [V3, V3] | null = null;
  /** 마지막으로 알린 측정값 칸 값과 종류(undefined = 아직 알리지 않음) */
  private lastLive: number | null | undefined = undefined;
  private lastLiveKind: LiveKind | null = null;
  /** 잠근 방향 추론(Shift는 떼면, 화살표·단추는 다시 누르면 풀린다 — 점을 찍거나 취소하면 모두 풀린다) */
  private lockValue: MeasureLock | null = null;
  /** Shift가 눌려 있는지(키와 포인터 이동의 shiftKey로 본다) */
  private shiftDown = false;
  /** 커서가 앞서 지나간 모서리(나란함·↓ 잠금의 기준) */
  private parallelRef: [V3, V3] | null = null;
  /** 방향을 잡는 동안 마지막으로 본 방향 추론(커서가 보기를 떠난 뒤 누른 잠금 단추) */
  private lastLockable: InferenceLock | null = null;
  /** 화살표로 고정한 각도기 평면의 축(중심을 찍기 전) */
  private planeAxisValue: Axis | null = null;
  /** 마지막으로 알린 잠금·평면·끌어온 점 수(onLock) */
  private lockNote: [MeasureLock | null, Axis | null, number] = [null, null, 0];
  /** 다른 점에서 끌어온 축을 쓰는지와 끌어온 점·머무르기 상태(코어 MeasureTracker — 시간은 dwellTimer가 잰다) */
  private trackOn: boolean;
  /** 축이 모서리·면과 만나는 점에 붙는지 */
  private meetsOn: boolean;
  /** 잠근 선이 모서리·면과 만나는 점에 붙는지 */
  private lockMeetsOn: boolean;
  private readonly tracker = new MeasureTracker();
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;
  /** 정밀 조준이 머물기 시작한 자리(떨림을 받는 기준) */
  private aimDwellAt: { x: number; y: number } | null = null;
  /** 방금 누른 점(커서가 그 점을 떠날 때까지 머물러도 기억하지 않는다) */
  private pressedPoint: V3 | null = null;
  /** 안내 두기(누르기로 안내점·안내선) — 도구를 바꾸거나 새 문서를 열어도 남는다 */
  private guideOn = false;
  /** 안내 두기 키만 눌렀는지(누른 뒤 다른 키·누르기·휠이 없으면 뗄 때 바꾼다) */
  private modTap = false;
  /**
   * 고른 안내(안내점·안내선 객체 그대로, 고른 차례 — 누르기로 고르고 Delete·지우기 단추로 지운다). 줄자·각도기를 켠 동안은 하나,
   * 끈 동안(고르기 도구)은 Ctrl·Shift 누르기와 고르기 상자로 여럿(25차). 지우거나 숨긴 것이 남아 있을 수 있어 쓸 때는 liveSel()
   */
  private selGuides: GuideRef[] = [];
  /** 숨긴 안내(25차 Edit › Hide — 그리지도 붙지도 고르지도 않는다. 되돌리기·파일별 안내 기억에 든다, 안내 배열에 있는 것만) */
  private hidGuides: ReadonlySet<GuideRef> = NO_GUIDES;
  /** 보이는 안내(숨긴 것을 뺀 배열 — 그 안내 배열·숨긴 모음일 때 한 번 만든다) */
  private visCache: { pts: V3[]; lns: GuideLine[]; hid: ReadonlySet<GuideRef>; vp: V3[]; vl: GuideLine[] } | null = null;
  /** 고르기 상자(줄자·각도기를 끈 동안 고르기 수정 키를 누른 채 끄는 중) */
  private box: GuideBox | null = null;
  /** 고른 누르기가 진행 중 측정의 시작점(각도기 중심)도 찍었는지 — 지우면 그 점도 거둔다 */
  private selPlacedStart = false;
  /** 바로 앞 누르기(두 번 누르기 판정 — 코어 clickCount와 같은 시간·거리 문턱, 손가락은 넓게) */
  private lastClick: LastClick = { t: -Infinity, x: 0, y: 0, n: 0 };
  /** 바로 앞 줄자 누르기가 모서리에 붙었으면 그 모서리와 되돌릴 것(두 번 누르기 안내선) */
  private lastTap: TapMemo | null = null;
  /** 안내 되돌리기·다시 하기 목록(새것이 뒤 — 안내를 두고 지울 때마다 그 전 상태를 쌓는다, 새 문서면 비운다) */
  private undoList: GuideSnapshot[] = [];
  private redoList: GuideSnapshot[] = [];
  /** 안내 보이기(보기 설정 — 끄면 안내를 그리지 않고, 붙지도 고르지도 않는다) */
  private shownValue: boolean;
  private readonly storage: GuideStorage | null;
  /** 측정 띠(측정값 칸 줄)의 되돌리기·다시 하기 단추(mountUndo로 붙인다) */
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  /** 측정 띠의 잠글 방향 고르기 줄(mountLockMenu로 붙인다 — 22차 한 손 잠금) */
  private lockMenu: HTMLDivElement | null = null;
  /** 고른 것 카드의 고른 안내 지우기·숨기기 단추(mountGuideDelete로 붙인다 — 23차 고르기 도구로 고른 안내, 숨기기는 25차) */
  private guideDelBtn: HTMLButtonElement | null = null;
  private guideHideBtn: HTMLButtonElement | null = null;
  /** 안내를 기억하는 파일 열쇠(내용 지문 16진 — 지문을 받기 전·기억하지 않으면 null)와 openFile 차례(늦게 온 지문은 버린다) */
  private fileKey: string | null = null;
  private fileTicket = 0;
  /** 마지막으로 기억한 안내 배열(배열을 늘 새로 만들므로 바뀌었을 때만 쓴다) */
  private savedPts: V3[] | null = null;
  private savedLns: GuideLine[] | null = null;
  private savedHid: ReadonlySet<GuideRef> | null = null;
  /** 이번 그리기의 결과 글(툴팁을 둔 뒤 피할 자리와 겹치면 옮긴다): 요소, 기준점, 화면 선분, 비킬 점 표식 */
  private labelQueue: { el: HTMLDivElement; x: number; y: number; seg: [number[], number[]] | null; soft: LabelCircle[] }[] = [];
  private readonly painter = (f: ViewFrame): void => this.paint(f);
  private readonly g: SVGGElement;
  private readonly layer: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly off: (() => void)[] = [];
  private disposed = false;

  constructor(
    private readonly viewer: MeasureViewer,
    private readonly overlay: MeasureOverlay,
    private readonly opts: MeasureToolOptions,
  ) {
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.trackOn = opts.track !== false;
    this.meetsOn = opts.axisMeets !== false;
    this.lockMeetsOn = opts.lockMeets !== false;
    let shown = true;
    try {
      shown = this.storage?.getItem(GUIDES_SHOWN_KEY) !== '0';
    } catch {
      /* 못 읽으면 보인다 */
    }
    this.shownValue = shown;
    this.g = svgEl('g', { class: 'measure' });
    this.layer = document.createElement('div');
    this.layer.className = 'measure-layer';
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.tip = document.createElement('div');
    this.tip.className = 'measure-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;display:none;';
    const cv = viewer.canvas;
    const on = <E extends Event>(el: EventTarget, type: string, fn: (e: E) => void): void => {
      el.addEventListener(type, fn as EventListener);
      this.off.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on<PointerEvent>(cv, 'pointerdown', (e) => this.onDown(e));
    on<PointerEvent>(cv, 'pointermove', (e) => this.onMove(e));
    on<PointerEvent>(cv, 'pointerup', (e) => this.onUp(e, false));
    on<PointerEvent>(cv, 'pointercancel', (e) => this.onUp(e, true));
    on<PointerEvent>(cv, 'pointerleave', () => this.onLeave());
    // 정밀 조준: 캔버스보다 먼저(부모 캡처 단계) 받아, 조준 중인 손가락의 움직임이 코어 궤도로 가지 않게 막는다
    const trap = cv.parentElement ?? cv;
    this.off.push(capture(trap, 'pointermove', (e) => this.onAimMove(e)));
    this.off.push(capture(trap, 'pointerup', (e) => this.onAimUp(e, false)));
    this.off.push(capture(trap, 'pointercancel', (e) => this.onAimUp(e, true)));
    // 고르기 상자(줄자·각도기를 끈 동안 수정 키를 누른 채 끌기): 조준처럼 캔버스보다 먼저 받아 코어 궤도로 가지 않게 막는다
    this.off.push(capture(trap, 'pointermove', (e) => this.onBoxMove(e)));
    this.off.push(capture(trap, 'pointerup', (e) => this.onBoxUp(e, false)));
    this.off.push(capture(trap, 'pointercancel', (e) => this.onBoxUp(e, true)));
    // Ctrl·Option을 누른 채 휠(확대)을 돌렸으면 안내 두기 키 누르기가 아니다
    const wheel = (): void => {
      this.modTap = false;
    };
    cv.addEventListener('wheel', wheel, { passive: true });
    this.off.push(() => cv.removeEventListener('wheel', wheel));
    // 창이 초점을 잃으면 Shift를 뗀 것으로 본다(떼기 keyup을 놓치지 않게)
    if (typeof window !== 'undefined')
      on(window, 'blur', () => {
        this.modTap = false;
        this.setShift(false);
        this.setPlaneLock(false);
      });
    this.off.push(
      viewer.onCameraChange(() => {
        if (!this.modeValue) return;
        // 휠 확대 등으로 보기가 바뀌면 같은 커서 자리에서 다시 추정한다(끄는 중에는 숨긴다)
        if (this.cursor && this.cursor.type !== 'touch') this.hoverDirty = true;
        this.overlay.invalidate();
      }),
    );
  }

  /** 도구가 켜져 있는지: 켜진 동안 캔버스 누르기는 이 도구가 쓴다(앱은 코어 onPick을 무시한다) */
  get active(): boolean {
    return this.modeValue !== null;
  }

  get mode(): MeasureMode | null {
    return this.modeValue;
  }

  /** 정밀 조준 중인지(길게 눌러 십자선을 옮기는 중) */
  get aiming(): boolean {
    return this.aimId !== null;
  }

  /** 진행 중 측정에 찍은 점 수(줄자 0~1, 각도기 0~2) */
  get pointCount(): number {
    return this.pts.length;
  }

  /**
   * 다시 재기(clear)로 지울 것이 있는지: 진행 중 점·결과·끌어온 점. 앱의 측정 띠 다시 재기 단추가 이것으로 켜고 끈다
   * (휴대폰은 Esc가 없어 끌어온 점만 남았을 때도 이 단추로 지운다 — 단추 상태를 이 조각이 정해 첫 화면 JS를 늘리지 않는다)
   */
  get clearable(): boolean {
    return this.pts.length > 0 || !!this.resultValue || this.tracker.size > 0;
  }

  /** 마지막 측정 결과 */
  get result(): MeasureToolResult | null {
    return this.resultValue;
  }

  /** 측정값 칸·안내 두기로 찍은 안내점 */
  get guides(): readonly V3[] {
    return this.guidePts;
  }

  /** 측정값 칸·안내 두기로 둔 안내선 */
  get guideLines(): readonly GuideLine[] {
    return this.guideLns;
  }

  /** 방향을 잡는 중인지(줄자 끝점·각도기 기준 방향·잴 방향 — 잠글 수 있다) */
  get directing(): boolean {
    return directingPoints(this.modeValue, this.pts.length);
  }

  /** 지금 잠근 방향 추론(없으면 null) */
  get inferenceLock(): Readonly<MeasureLock> | null {
    return this.lockValue;
  }

  /** 지금 잠근 방향 이름(축·나란히·수직·면에 수직, 없으면 null) */
  get lockName(): LockName | null {
    return lockName(this.lockValue);
  }

  /**
   * 잠금·안내 두기 키 안내(상태 줄·측정 띠에서 안내 글 다음 따로): 잠근 방향, 키보드 기기는 Shift·화살표, 각도기 화살표 평면,
   * 점을 찍기 전 키보드 기기는 안내 두기 키(Ctrl·Option). 도구를 끈 동안은 null. touch = 손가락이 주인 기기
   */
  lockHintText(touch: boolean): string | null {
    const m = this.modeValue;
    const n = this.pts.length;
    const hint = lockHint(m, n, lockName(this.lockValue), this.planeAxisValue, touch) ?? guideKeyHint(m, n, this.guideOn, this.opts.guideKey ?? 'Control', touch);
    // 끌어온 점이 있으면 그 수를 뒤에 따로(번역은 " · "로 나눠 조각마다 찾는다)
    const t = m ? trackHint(this.tracker.size) : null;
    return hint && t ? `${hint} · ${t}` : (hint ?? t);
  }

  /** 다른 점에서 끌어온 축을 쓰는지(기본 켬) */
  get track(): boolean {
    return this.trackOn;
  }

  /** 끌어온 축 켜고 끄기. 끄면 끌어온 점과 머무르기를 버린다(상태가 없어 추정·그림이 예전과 같다) */
  setTrack(on: boolean): void {
    if (this.disposed || on === this.trackOn) return;
    this.trackOn = on;
    if (!on) this.forgetTracks();
  }

  /** 시작점 축이 모서리와 만나는 점, 시작점 축·끌어온 축이 면을 뚫는 점에 붙는지(기본 켬) */
  get axisMeets(): boolean {
    return this.meetsOn;
  }

  /** 축이 모서리·면과 만나는 점 켜고 끄기(끄면 추정·그림이 예전과 같다) */
  setAxisMeets(on: boolean): void {
    if (this.disposed || on === this.meetsOn) return;
    this.meetsOn = on;
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  /** 잠근 동안 잠근 선이 모서리·안내선과 만나는 점, 면을 뚫는 점에 붙는지(기본 켬) */
  get lockMeets(): boolean {
    return this.lockMeetsOn;
  }

  /** 잠근 선이 모서리·면과 만나는 점 켜고 끄기(끄면 잠근 동안 추정·그림이 예전과 같다) */
  setLockMeets(on: boolean): void {
    if (this.disposed || on === this.lockMeetsOn) return;
    this.lockMeetsOn = on;
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  /** 기억한 끌어온 점(새것이 앞, 복사본) */
  get trackPoints(): V3[] {
    return this.tracker.points;
  }

  /** 화살표로 고정한 각도기 평면의 축(중심을 찍기 전, 없으면 null) */
  get planeAxis(): Axis | null {
    return this.planeAxisValue;
  }

  /**
   * 앱 단추로 잠그기(손가락 기기 — Shift가 없다). true = 지금 커서·조준 밑 방향 추론(없으면 방향을 잡는 동안 마지막으로 본 것),
   * 축 이름 = 그 축, false = 풀기. 방향을 잡는 중에만 잠그고, 잠갔으면 true
   */
  setInferenceLock(on: boolean | Axis): boolean {
    if (on === false) {
      this.setLock(null);
      return false;
    }
    if (!this.directing) return false;
    const l = on === true ? (this.lockable(this.freshHover()) ?? this.lastLockable) : axisInferenceLock(on, this.axes);
    if (!l) return false;
    this.setLock({ ...l, source: 'button' });
    return true;
  }

  /**
   * 고를 수 있는 잠글 방향(방향을 잡는 동안만, 아니면 빈 목록): 빨강·녹색·파랑 축, 앞서 지나간 모서리가 있으면 그 모서리와 나란히(↓와 같은 기준).
   * 22차 한 손 잠금 — SketchUp for iPad 줄자의 도구 모드(Lock X·Y·Z·Lock Parallel)처럼 둘째 손가락 없이 고른다(lockTo·toggleLockMenu)
   */
  get lockChoices(): LockChoice[] {
    if (!this.directing) return [];
    return this.parallelRef ? ['x', 'y', 'z', 'parallel'] : ['x', 'y', 'z'];
  }

  /** 고른 방향으로 잠근다(단추 잠금 — 다시 누르거나 점을 찍고 취소하면 풀린다). 방향을 잡는 중이 아니거나 그 방향이 없으면 false */
  lockTo(choice: LockChoice): boolean {
    if (!this.directing) return false;
    const l = choice === 'parallel' ? (this.parallelRef ? parallelInferenceLock(this.parallelRef) : null) : axisInferenceLock(choice, this.axes);
    if (!l) return false;
    this.setLock({ ...l, source: 'button' });
    return true;
  }

  /**
   * 측정 띠에 잠글 방향 고르기 줄을 붙인다(앱이 띠를 만든 뒤 한 번 — mountUndo처럼). 줄은 띠 위에 뜨고(.mb-lockmenu),
   * 단추마다 잠금 안내 글(LOCK_HINTS — "빨강 축으로 잠금")과 축 색 견본. 손가락·펜은 누르는 순간에 받는다(정밀 조준 중 둘째 손가락도 되게)
   */
  mountLockMenu(host: HTMLElement): void {
    if (this.lockMenu) {
      host.append(this.lockMenu);
      return;
    }
    const m = document.createElement('div');
    m.className = 'mb-lockmenu';
    m.setAttribute('role', 'group');
    m.setAttribute('aria-label', LOCK_MENU_LABEL);
    m.hidden = true;
    let pressedAt = -Infinity;
    const pick = (b: Element | null): void => {
      const c = b?.getAttribute('data-lock') as LockChoice | null | undefined;
      if (!c) return;
      this.lockTo(c);
      this.toggleLockMenu(false);
    };
    m.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const b = (e.target as Element | null)?.closest?.('[data-lock]') ?? null;
      if (!b) return;
      e.preventDefault();
      pressedAt = now();
      pick(b);
    });
    m.addEventListener('click', (e) => {
      if (now() - pressedAt < 1000) return;
      pick((e.target as Element | null)?.closest?.('[data-lock]') ?? null);
    });
    this.lockMenu = m;
    host.append(m);
  }

  /** 잠글 방향 고르기 줄이 열렸는지 */
  get lockMenuOpen(): boolean {
    return !!this.lockMenu && !this.lockMenu.hidden;
  }

  /**
   * 잠글 방향 고르기 줄 열기·닫기(on이 없으면 바꾸기). 방향을 잡는 중이 아니면(고를 방향이 없으면) 닫는다. 열었으면 true.
   * 고르거나, 점을 찍거나 취소·지우기·도구 바꾸기로 방향을 잡지 않게 되거나, 다른 길로 잠그면 닫힌다(refreshHint)
   */
  toggleLockMenu(on?: boolean): boolean {
    const m = this.lockMenu;
    if (!m) return false;
    const choices = this.lockChoices;
    const open = (on ?? m.hidden) && choices.length > 0 && !this.lockValue;
    if (open) {
      m.replaceChildren(
        ...choices.map((c) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'mb-btn mb-lockpick';
          b.setAttribute('data-lock', c);
          const sw = document.createElement('span');
          sw.className = 'mb-lockswatch';
          sw.style.background = c === 'parallel' ? SNAP_COLORS.parallel : AXIS_COLORS[c];
          b.append(sw, LOCK_HINTS[c]);
          return b;
        }),
      );
    }
    if (m.hidden === !open) return open;
    m.hidden = !open;
    // 결과 글·툴팁이 줄을 비키게 다시 그린다
    this.overlay.invalidate();
    return open;
  }

  /** 줄자 시작점이 모서리 위라 친 길이가 나란한 안내선이 되는지 */
  get edgeStart(): boolean {
    return this.modeValue === 'tape' && (this.pts.length ? !!this.startEdge : !!this.resultEdge);
  }

  /** 안내 두기를 켰는지(줄자 둘째·각도기 셋째 누르기가 안내점·안내선을 둔다) */
  get guideMode(): boolean {
    return this.guideOn;
  }

  /** 안내 두기 켜고 끄기(SketchUp 줄자·각도기의 Ctrl·Option 전환 — 손가락 기기는 측정 띠 단추) */
  setGuideMode(on: boolean): void {
    if (this.disposed || on === this.guideOn) return;
    this.guideOn = on;
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
    this.notifyGuides();
  }

  /**
   * 안내점·안내선 모두 지우기(측정값 칸의 ✕ — 되돌릴 수 있다). forget이면 되돌리기·다시 하기 목록도 비운다(새 문서를 열 때 —
   * 안내는 그 모형의 자리라 다른 모형으로 되돌리지 않는다)
   */
  clearGuides(forget = false): void {
    const had = this.undoList.length + this.redoList.length > 0;
    if (forget) {
      this.undoList = [];
      this.redoList = [];
    }
    if (!this.guidePts.length && !this.guideLns.length) {
      if (forget && had) this.notifyGuides();
      return;
    }
    this.setGuides([], [], !forget, NO_GUIDES);
    this.selGuides = [];
    this.selPlacedStart = false;
    this.hoverDirty = true;
    this.overlay.invalidate();
    this.notifyGuides();
  }

  /**
   * 새 문서의 안내(앱이 문서를 열 때마다): 안내와 되돌리기 목록을 비우고(clearGuides(true)), 파일 내용 지문(SHA-256 바이트 — 약속이면 받는 대로)으로
   * 이 브라우저에 기억한 그 파일의 안내를 되살린다(되돌리기 목록은 비운 채 — 되살린 안내가 처음 상태). 그 뒤로는 안내가 바뀔 때마다 그 열쇠로 기억한다
   * (guidestore.ts — 파일 이름·경로는 두지 않는다). 지문이 null이면(지문을 구하지 못한 브라우저) 기억하지 않는다.
   * 지문을 받기 전에 안내를 두었으면(드물다) 기억한 것 대신 그 안내를 기억한다. 늦게 온 앞 문서의 지문은 버린다
   */
  openFile(print: ArrayBuffer | null | PromiseLike<ArrayBuffer | null>): void {
    const ticket = ++this.fileTicket;
    this.fileKey = null;
    this.clearGuides(true);
    this.savedPts = this.guidePts;
    this.savedLns = this.guideLns;
    this.savedHid = this.hidGuides;
    void Promise.resolve(print).then(
      (b) => {
        if (ticket === this.fileTicket && b && !this.disposed) this.adoptFile(digestHex(b));
      },
      () => undefined,
    );
  }

  /** 지문을 받았을 때: 기억한 안내를 되살리고(그 파일을 쓴 때도 새로), 그 열쇠로 기억하기 시작한다 */
  private adoptFile(key: string): void {
    this.fileKey = key;
    if (!this.guidePts.length && !this.guideLns.length && !this.undoList.length) {
      const g = loadGuides(this.storage, key, MAX_GUIDE_POINTS, MAX_GUIDE_LINES);
      if (!g) return;
      this.guidePts = g.pts;
      this.guideLns = g.lns;
      // 숨겨 둔 안내도 숨긴 채 되살린다(25차)
      this.hidGuides = g.hid.length ? new Set(g.hid) : NO_GUIDES;
      this.hoverDirty = true;
      this.overlay.invalidate();
    }
    this.persist(true);
    this.notifyGuides();
  }

  /** 안내가 바뀌었으면(force면 늘) 이 파일 열쇠로 기억한다(막히면 이번 세션만) */
  private persist(force = false): void {
    if (!this.fileKey || (!force && this.savedPts === this.guidePts && this.savedLns === this.guideLns && this.savedHid === this.hidGuides)) return;
    this.savedPts = this.guidePts;
    this.savedLns = this.guideLns;
    this.savedHid = this.hidGuides;
    saveGuides(this.storage, this.fileKey, this.guidePts, this.guideLns, Date.now(), this.hidGuides);
  }

  /** 되돌릴 안내 변경이 있는지 */
  get canUndo(): boolean {
    return this.undoList.length > 0;
  }

  /** 다시 할 안내 변경이 있는지 */
  get canRedo(): boolean {
    return this.redoList.length > 0;
  }

  /** 안내 되돌리기(두기·지우기 하나 — 측정 결과·진행 중 점은 그대로). 되돌렸으면 true */
  undo(): boolean {
    return this.step(this.undoList, this.redoList);
  }

  /** 되돌린 안내 변경 다시 하기. 했으면 true */
  redo(): boolean {
    return this.step(this.redoList, this.undoList);
  }

  /**
   * 되돌리기·다시 하기 키(Ctrl·⌘+Z, Ctrl·⌘+Shift+Z, Ctrl+Y — keydown). 도구를 끈 동안에도 받는다(안내는 늘 보이므로).
   * 입력 칸(측정값 칸·찾기 칸 등)의 키는 받지 않아 브라우저 기본 동작(글 되돌리기)이 된다. 되돌릴 것이 없으면 받지 않는다. 받았으면 true
   */
  undoKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown' || this.disposed || isEditableTarget(e.target)) return false;
    const k = guideUndoKey(e);
    if (!k) return false;
    // Ctrl을 눌러 Z를 쳤으니 Ctrl 떼기는 안내 두기 전환이 아니다
    this.modTap = false;
    if (!(k === 'undo' ? this.undo() : this.redo())) return false;
    e.preventDefault();
    return true;
  }

  /** from 목록의 마지막 상태로 돌아가고 지금 상태는 to 목록에 쌓는다 */
  private step(from: GuideSnapshot[], to: GuideSnapshot[]): boolean {
    const s = from.pop();
    if (!s || this.disposed) return false;
    to.push({ pts: this.guidePts, lns: this.guideLns, hid: this.hidGuides });
    this.guidePts = s.pts;
    this.guideLns = s.lns;
    this.hidGuides = s.hid;
    // 안내 보이기를 끈 채 되돌리면 다시 보인다(무엇이 바뀌었는지 보이게)
    this.reveal();
    // 되돌려 없어지거나 숨은 안내는 고른 것에서 뺀다
    const live = this.liveSel();
    if (live.length !== this.selGuides.length) {
      this.selGuides = live;
      if (!live.length) this.selPlacedStart = false;
    }
    this.hoverDirty = true;
    this.overlay.invalidate();
    this.notifyGuides();
    return true;
  }

  /**
   * 안내점·안내선 배열과 숨긴 안내 바꾸기(record면 그 전 상태를 되돌리기 목록에 쌓고 다시 하기 목록은 비운다).
   * 숨긴 안내는 새 배열에 남은 것만 둔다(지우거나 오래되어 버린 것은 뺀다)
   */
  private setGuides(pts: V3[], lns: GuideLine[], record = true, hid: ReadonlySet<GuideRef> = this.hidGuides): void {
    if (hid.size) {
      const kept = [...hid].filter((g) => (Array.isArray(g) ? pts.includes(g) : lns.includes(g as GuideLine)));
      if (kept.length !== hid.size) hid = kept.length ? new Set(kept) : NO_GUIDES;
    }
    if (pts === this.guidePts && lns === this.guideLns && hid === this.hidGuides) return;
    if (record) {
      this.undoList.push({ pts: this.guidePts, lns: this.guideLns, hid: this.hidGuides });
      if (this.undoList.length > MAX_GUIDE_UNDO) this.undoList.shift();
      this.redoList = [];
    }
    this.guidePts = pts;
    this.guideLns = lns;
    this.hidGuides = hid;
  }

  /** 보이는 안내 배열(숨긴 안내를 뺀 것 — 숨긴 것이 없으면 안내 배열 그대로). 추정·고르기·그리기가 같은 배열을 쓴다(추정의 안내 번호가 이 배열의 차례) */
  private visible(): { vp: V3[]; vl: GuideLine[] } {
    const h = this.hidGuides;
    if (!h.size) return { vp: this.guidePts, vl: this.guideLns };
    const c = this.visCache;
    if (c && c.pts === this.guidePts && c.lns === this.guideLns && c.hid === h) return c;
    const next = { pts: this.guidePts, lns: this.guideLns, hid: h, vp: this.guidePts.filter((g) => !h.has(g)), vl: this.guideLns.filter((g) => !h.has(g)) };
    this.visCache = next;
    return next;
  }

  /** 숨긴 안내 수(25차 — Edit › Hide로 숨긴 것) */
  get hiddenGuideCount(): number {
    return this.hidGuides.size;
  }

  /**
   * 고른 안내 숨기기(25차 — SketchUp 공개 도움말 "Using guides": 고르기 도구로 고른 안내를 Edit › Hide로 숨긴다. 고른 것 카드의 숨기기 단추).
   * 숨긴 안내는 그리지도 붙지도 고르지도 않고("Softening, Smoothing, and Hiding Geometry": 숨긴 형상은 고를 수 없다), 고른 것은 푼다.
   * 되돌리기 목록에 쌓이고 파일별 안내 기억에 든다. 줄자·각도기를 켠 동안은 하지 않는다. 숨겼으면 true
   */
  hideSelectedGuides(): boolean {
    if (this.disposed || this.modeValue) return false;
    const s = this.liveSel();
    if (!s.length) return false;
    this.selGuides = [];
    this.selPlacedStart = false;
    this.setGuides(this.guidePts, this.guideLns, true, new Set([...this.hidGuides, ...s]));
    this.hoverDirty = true;
    this.overlay.invalidate();
    this.notifyGuides();
    return true;
  }

  /**
   * 숨긴 안내 모두 보이기(25차 — "Using guides": 숨긴 안내는 Edit › Unhide로 다시 보인다. 보기 설정 메뉴 항목). 되돌리기 목록에 쌓이고,
   * 안내 보이기를 꺼 두었으면 켠다. 숨긴 안내가 없으면 false
   */
  unhideGuides(): boolean {
    if (this.disposed || !this.hidGuides.size) return false;
    this.reveal();
    this.setGuides(this.guidePts, this.guideLns, true, NO_GUIDES);
    this.hoverDirty = true;
    this.overlay.invalidate();
    this.notifyGuides();
    return true;
  }

  /** 안내 보이기(보기 설정 — 기본 켬, 이 브라우저에 기억) */
  get guidesShown(): boolean {
    return this.shownValue;
  }

  /** 안내 보이기 켜고 끄기: 끄면 안내를 그리지 않고 추정·고르기에서도 뺀다(고른 안내는 푼다). 안내를 두거나 되돌리면 다시 켠다 */
  setGuidesShown(on: boolean): void {
    if (this.disposed || on === this.shownValue) return;
    this.shownValue = on;
    try {
      this.storage?.setItem(GUIDES_SHOWN_KEY, on ? '1' : '0');
    } catch {
      /* 비공개 창 등 — 이번만 */
    }
    if (!on) {
      this.selGuides = [];
      this.selPlacedStart = false;
    }
    this.hoverDirty = true;
    this.overlay.invalidate();
    this.notifyGuides();
  }

  /** 보기 설정 메뉴의 "안내점·안내선 보이기" 항목(앱 메뉴 꼴) */
  showGuidesItem(): GuideMenuItem {
    return { label: GUIDES_SHOWN_LABEL, checked: this.shownValue, toggle: true, run: () => this.setGuidesShown(!this.shownValue) };
  }

  /**
   * 보기 설정 메뉴의 안내 항목: "안내점·안내선 보이기", 숨긴 안내가 있으면 "숨긴 안내 모두 보이기"(25차 — unhideGuides),
   * "이 파일의 안내 모두 지우기"(안내가 없으면 끔 — 측정값 칸의 ✕와 같이 되돌릴 수 있고, 숨긴 안내도 지우며 이 파일의 기억도 지운다. 도구를 끈 동안에도 된다)
   */
  guideMenuItems(): GuideMenuItem[] {
    const unhide: GuideMenuItem[] = this.hidGuides.size ? [{ label: GUIDE_UNHIDE_LABEL, icon: 'show', run: () => this.unhideGuides() }] : [];
    return [
      this.showGuidesItem(),
      ...unhide,
      { label: GUIDE_CLEAR_FILE_LABEL, icon: 'trash', disabled: !this.guidePts.length && !this.guideLns.length, run: () => this.clearGuides() },
    ];
  }

  /**
   * 측정값 칸(host)에 안내 되돌리기·다시 하기 단추를 붙인다(고른 안내 지우기 단추 앞). 측정 띠 안에서만 보이고(CSS — 키보드는 Ctrl·⌘+Z, Ctrl+Y),
   * 되돌릴 것·다시 할 것이 있을 때만 나온다
   */
  mountUndo(host: HTMLElement): void {
    const make = (cls: string, label: string, paths: string, run: () => boolean): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `vcb-btn ${cls}`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon('', 16).replace('</svg>', `${paths}</svg>`);
      b.addEventListener('click', () => run());
      return b;
    };
    this.undoBtn ??= make('vcb-undo', GUIDE_UNDO_LABEL, UNDO_PATHS, () => this.undo());
    this.redoBtn ??= make('vcb-redo', GUIDE_REDO_LABEL, REDO_PATHS, () => this.redo());
    const at = host.querySelector('.vcb-del');
    host.insertBefore(this.undoBtn, at);
    host.insertBefore(this.redoBtn, at);
    this.undoBtn.hidden = !this.canUndo;
    this.redoBtn.hidden = !this.canRedo;
  }

  /** 숨긴 안내를 다시 보인다(안내를 두거나 되돌렸을 때) */
  private reveal(): void {
    if (!this.shownValue) this.setGuidesShown(true);
  }

  /**
   * 안내가 바뀐 뒤: 이 파일 열쇠로 기억하고, 덧그림을 붙이거나 떼고(도구를 끈 동안에도 안내가 보이면 그린다), 되돌리기·다시 하기 단추를 맞추고 앱에 알린다
   */
  private notifyGuides(): void {
    this.persist();
    this.syncPainter();
    if (this.undoBtn) this.undoBtn.hidden = !this.canUndo;
    if (this.redoBtn) this.redoBtn.hidden = !this.canRedo;
    this.syncGuideDelete();
    this.opts.onGuides?.();
  }

  /** 덧그림 붙이기·떼기: 도구를 켰거나, 끈 동안에도 보이는 안내가 있으면 그린다 */
  private syncPainter(): void {
    const v = this.visible();
    const on = !this.disposed && (!!this.modeValue || (this.shownValue && v.vp.length + v.vl.length > 0));
    if (on) {
      if (!this.g.isConnected) this.overlay.svg.append(this.g);
      if (!this.layer.isConnected) this.overlay.labels.append(this.layer);
      this.overlay.set(PAINTER_KEY, this.painter);
    } else {
      this.overlay.set(PAINTER_KEY, null);
      this.g.replaceChildren();
      this.layer.replaceChildren();
      this.g.remove();
      this.layer.remove();
    }
  }

  /** 지금 고른 안내(안내 배열에 있고 숨기지 않은 것만, 고른 차례) */
  private liveSel(): GuideRef[] {
    if (!this.selGuides.length) return [];
    const v = this.visible();
    return this.selGuides.filter((s) => (Array.isArray(s) ? v.vp.includes(s) : v.vl.includes(s as GuideLine)));
  }

  /** 고른 안내 수: 안내점·안내선(25차 — 줄자·각도기를 끈 동안 여럿 고르기) */
  private selCounts(): { points: number; lines: number } {
    let points = 0;
    for (const s of this.liveSel()) if (Array.isArray(s)) points++;
    return { points, lines: this.liveSel().length - points };
  }

  /**
   * 고른 안내가 하나일 때 그 종류(안내점·안내선 — 없거나 여럿이면 null, 여럿은 selectedGuideCount). 안내를 누르면 고르고(방금 둔 안내도),
   * 다른 곳을 누르거나 Esc·다시 재기면 푼다. 줄자·각도기를 켠 동안은 늘 하나다
   */
  get selectedGuide(): 'point' | 'line' | null {
    const s = this.liveSel();
    return s.length === 1 ? (Array.isArray(s[0]) ? 'point' : 'line') : null;
  }

  /** 고른 안내 수(줄자·각도기를 끈 동안 Ctrl·Shift 누르기·고르기 상자로 여럿 — 25차) */
  get selectedGuideCount(): number {
    return this.liveSel().length;
  }

  /**
   * 고른 안내 지우기(Delete·Backspace, 측정값 칸·고른 것 카드의 지우기 단추 — 여럿이면 함께, 되돌리기 한 단계). 고른 누르기가 진행 중 측정의
   * 시작점(각도기 중심)도 찍었으면 그 점도 거둔다(지우려고 누른 것이므로). 지웠으면 true
   */
  deleteSelectedGuide(): boolean {
    const s = this.liveSel();
    const cancel = this.selPlacedStart && this.pts.length === 1;
    this.selGuides = [];
    this.selPlacedStart = false;
    if (!s.length) return false;
    const gone = new Set(s);
    this.setGuides(without(this.guidePts, gone), without(this.guideLns, gone));
    if (cancel) {
      this.pts = [];
      this.startEdge = null;
      this.normal = null;
      this.dropLock();
    }
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
    this.notifyGuides();
    return true;
  }

  /**
   * 고르기 도구(줄자·각도기를 끈 동안)의 누르기(23차 — SketchUp 공개 도움말 "Using guides": 고르기 도구로 안내를 골라 Delete로 지운다).
   * 누른 자리(화면 clientX·clientY) 둘레 코어 고르기 허용 거리(마우스·펜 6화소, 손가락 14화소) 안의 보이는 안내를 고르고 그 종류를 준다.
   * mods(누르기의 수정 키 — 25차 "Selecting Geometry")가 있으면 고른 것에 더하기(Ctrl, Mac은 Option)·넣고 빼기(Shift)·빼기(Shift+Ctrl·Shift+Option).
   * 안내가 없으면 null(앱은 그때 형상을 고른다) — 수정 키 없이 누른 빈 곳이면 고른 안내를 풀고, 수정 키를 누른 채면 그대로 둔다.
   * 줄자·각도기를 켠 동안·안내를 숨긴 동안은 고르지 않는다(null)
   */
  pickGuide(clientX: number, clientY: number, pointerType: string, mods?: GuideSelectMods | null): 'point' | 'line' | null {
    if (this.disposed || this.modeValue) return null;
    const f = this.shownValue ? this.overlay.frame() : null;
    const p = this.local({ clientX, clientY });
    const v = this.visible();
    const hit = f ? guideHit(f, v.vp, v.vl, p.x, p.y, isTouch(pointerType) ? TOUCH_PICK_TOLERANCE_PX : PICK_TOLERANCE_PX) : null;
    const ref = hit ? ((hit.kind === 'point' ? v.vp[hit.index] : v.vl[hit.index]) ?? null) : null;
    const op = guideSelectOp(mods, this.opts.guideKey);
    if (!ref) {
      if (op === 'replace') this.select(null);
      return null;
    }
    this.pickGuides([ref], op);
    return hit!.kind;
  }

  /** 고른 안내를 고르기 방식대로 바꾼다(바뀌면 알린다 — 고르기 도구의 누르기·상자) */
  private pickGuides(refs: GuideRef[], op: GuideSelectOp): void {
    const next = applyGuideSelect(this.liveSel(), refs, op);
    this.selPlacedStart = false;
    const cur = this.selGuides;
    if (next.length === cur.length && next.every((g, i) => g === cur[i])) return;
    this.selGuides = next;
    this.overlay.invalidate();
    this.notifyGuides();
  }

  /** 고른 안내를 푼다(앱이 형상을 고를 때 — 고른 것은 형상이나 안내 한쪽) */
  deselectGuide(): void {
    if (this.selGuides.length) this.select(null);
  }

  /**
   * 보이는 안내 모두 고르기(26차 — SketchUp 공개 도움말 "Selecting Geometry": Edit › Select All은 모형의 모든 것을 고른다. 이 뷰어는 형상을 여럿 고르지 않아 안내만).
   * 숨긴 안내는 고르지 않는다("Softening, Smoothing, and Hiding Geometry": 숨긴 형상은 고를 수 없다). 안내점 → 안내선 차례로 고르고 앱에 알려(onGuidePick) 고른 형상을 풀게 한다.
   * 줄자·각도기를 켠 동안·안내 보이기를 끈 동안·보이는 안내가 없으면 하지 않는다(false)
   */
  selectAllGuides(): boolean {
    if (this.disposed || this.modeValue || !this.shownValue) return false;
    const v = this.visible();
    if (!v.vp.length && !v.vl.length) return false;
    this.pickGuides([...v.vp, ...v.vl], 'replace');
    this.opts.onGuidePick?.();
    return true;
  }

  /**
   * 모두 풀기(26차 — "Selecting Geometry": Edit › Deselect All은 아무것도 고르지 않은 상태로): 고른 안내를 풀고 앱에 고른 형상도 풀게 한다(onSelectNone).
   * 줄자·각도기를 켠 동안은 하지 않는다. 푼 것이 있으면 true
   */
  selectNone(): boolean {
    if (this.disposed || this.modeValue) return false;
    const had = this.liveSel().length > 0;
    if (had) this.select(null);
    const geo = this.opts.onSelectNone?.() ?? false;
    return had || geo;
  }

  /**
   * 고르기 도구로 고른 안내의 키(줄자·각도기를 끈 동안, 입력 칸 밖 keydown): Delete·Backspace = 고른 안내 지우기(여럿이면 함께 — 되돌리기 목록에 쌓임), Esc = 풀기.
   * 26차: Ctrl+A(Mac ⌘A) = 보이는 안내 모두 고르기, Ctrl+T(Mac Shift+⌘A) = 모두 풀기(selectAllKey). 할 것이 없으면(보이는 안내가 없음·고른 것이 없음) 받지 않아
   * 브라우저 기본 동작(글 모두 고르기 등)이 된다. 입력 칸의 키도 받지 않는다.
   * 고른 안내가 없거나 다른 키면 받지 않는다. 받았으면 true
   */
  selectKey(e: KeyboardEvent): boolean {
    if (this.disposed || this.modeValue || e.type !== 'keydown' || isEditableTarget(e.target)) return false;
    const all = selectAllKey(e, this.opts.guideKey);
    if (all) {
      if (!(all === 'all' ? this.selectAllGuides() : this.selectNone())) return false;
      e.preventDefault();
      return true;
    }
    if (!this.liveSel().length || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelectedGuide();
    else if (e.key === 'Escape') this.select(null);
    else return false;
    e.preventDefault();
    return true;
  }

  /** 고르기 도구로 고른 안내의 글(상태 줄·고른 것 카드): 안내점·안내선(여럿이면 그 수), 키보드 기기는 지우는 키도. 고른 안내가 없거나 도구를 켰으면 null */
  guidePickText(touch: boolean): string | null {
    if (this.modeValue) return null;
    const c = this.selCounts();
    const t = guideCountText(c.points, c.lines);
    if (!t) return null;
    return touch ? t : `${t} · ${GUIDE_DELETE_KEY_HINT}`;
  }

  /**
   * 고른 것 카드(host — 앱 카드의 단추 줄, 맨 끝은 선택 해제 ✕)에 고른 안내 숨기기·지우기 단추를 붙인다(✕ 앞). 카드가 고른 안내를 보일 때만 보이고(CSS .sel-bar.is-guide),
   * 숨기기는 고른 안내를 숨기고(25차 Edit › Hide — 좁은 휴대폰은 아이콘만), 지우기는 고른 안내를 지운다(여럿이면 함께 — 키보드는 Delete·Backspace)
   */
  mountGuideDelete(host: HTMLElement): void {
    let h = this.guideHideBtn;
    if (!h) {
      h = document.createElement('button');
      h.type = 'button';
      h.className = 'mb-btn sel-hide';
      h.title = GUIDE_HIDE_LABEL;
      h.setAttribute('aria-label', GUIDE_HIDE_LABEL);
      h.innerHTML = `${icon('hide', 16)}<span>${GUIDE_HIDE_TEXT}</span>`;
      h.addEventListener('click', () => this.hideSelectedGuides());
      this.guideHideBtn = h;
    }
    let b = this.guideDelBtn;
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mb-btn sel-del';
      b.innerHTML = `${icon('trash', 16)}<span>${GUIDE_DELETE_TEXT}</span>`;
      b.addEventListener('click', () => this.deleteSelectedGuide());
      this.guideDelBtn = b;
    }
    const close = host.lastElementChild;
    host.insertBefore(h, close === h || close === b ? null : close);
    host.insertBefore(b, h.nextSibling);
    this.syncGuideDelete();
  }

  /** 카드의 지우기 단추 이름을 고른 안내 종류·수에 맞춘다(측정값 칸의 지우기 단추와 같은 글) */
  private syncGuideDelete(): void {
    const b = this.guideDelBtn;
    if (!b) return;
    const c = this.selCounts();
    const t = guideDeleteLabel(c.points, c.lines);
    b.title = `${t} (Delete)`;
    b.setAttribute('aria-label', t);
  }

  /** 안내 하나 고르기·풀기(null — 줄자·각도기의 누르기). placedStart: 이 누르기가 진행 중 측정의 시작점도 찍었다. changed면 고른 것이 같아도 알린다(안내가 늘었을 때) */
  private select(ref: GuideRef | null, placedStart = false, changed = false): void {
    const cur = this.selGuides;
    if (ref ? cur.length !== 1 || cur[0] !== ref : cur.length > 0) {
      this.selGuides = ref ? [ref] : [];
      changed = true;
    }
    this.selPlacedStart = !!ref && placedStart;
    if (!changed) return;
    this.overlay.invalidate();
    this.notifyGuides();
  }

  /** 추정이 붙은 안내(안내점·안내선 객체 — 없으면 null, 숨긴 안내는 붙지 않는다). 추정의 안내 번호는 보이는 안내 배열의 차례다 */
  private guideAt(snap: Snap): GuideRef | null {
    const g = snap.guide;
    if (!g || !this.shownValue) return null;
    const v = this.visible();
    return (g.kind === 'point' ? v.vp[g.index] : v.vl[g.index]) ?? null;
  }

  /** 안내점 두기(같은 자리에 이미 있으면 그것 — 숨겨 두었으면 다시 보인다) — 오래된 것부터 MAX_GUIDE_POINTS개까지. 안내 보이기를 껐으면 켠다 */
  private addGuidePoint(p: V3): V3 {
    this.reveal();
    const same = this.guidePts.find((g) => samePoint(g, p));
    if (same) {
      this.unhideOne(same);
      return same;
    }
    const g: V3 = [p[0], p[1], p[2]];
    this.setGuides([...this.guidePts, g].slice(-MAX_GUIDE_POINTS), this.guideLns);
    return g;
  }

  /** 안내선 두기(같은 직선이 이미 있으면 그것 — 숨겨 두었으면 다시 보인다) — 오래된 것부터 MAX_GUIDE_LINES개까지. 안내 보이기를 껐으면 켠다 */
  private addGuideLine(point: V3, dir: V3): GuideLine {
    this.reveal();
    const u = unit(dir);
    const same = this.guideLns.find((g) => sameLine(g, point, u));
    if (same) {
      this.unhideOne(same);
      return same;
    }
    const gl: GuideLine = { point: [point[0], point[1], point[2]], dir: u };
    this.setGuides(this.guidePts, [...this.guideLns, gl].slice(-MAX_GUIDE_LINES));
    return gl;
  }

  /** 같은 자리에 다시 둔 숨긴 안내를 보인다(되돌리기 목록에 쌓인다 — 두는 쪽이 알린다) */
  private unhideOne(g: GuideRef): void {
    if (!this.hidGuides.has(g)) return;
    const h = new Set(this.hidGuides);
    h.delete(g);
    this.setGuides(this.guidePts, this.guideLns, true, h.size ? h : NO_GUIDES);
  }

  /**
   * 안내 두기 줄자의 끝: 모서리 위에서 시작했으면 시작점에서 모서리에 수직으로 p 쪽 직선까지 간 발(p가 모서리 직선 위면 null — 안내선을 두지 않는다),
   * 아니면 p
   */
  private guideEnd(a: V3, p: V3): V3 | null {
    return this.startEdge ? edgeFoot(a, this.startEdge, p) : p;
  }

  /** 진행 중 측정의 커서 추정(그리기를 기다리지 않고 지금 커서 자리에서). 손가락·끌기 중이면 null */
  private cursorSnap(): Snap | null {
    this.freshHover();
    return this.cursor && this.cursor.type !== 'touch' && !this.dragging ? this.hover : null;
  }

  /** 지금 표식의 추정(그리기를 기다리지 않고 — 손가락 기기는 탭한 자리 것) */
  private freshHover(): Snap | null {
    const f = this.overlay.frame();
    if (this.hoverDirty && f) {
      this.hoverDirty = false;
      this.updateHover(f);
    }
    return this.hover;
  }

  /**
   * 측정값 칸에 친 길이(장면 단위, 음수면 반대쪽): 줄자 시작점에서 그 길이만큼 간 자리에 안내점을 찍고 결과를 시작점 → 안내점으로 바꾼다.
   * 시작점을 찍은 뒤면 방향은 시작점 → 커서 추정 점, 두 점을 다 잰 뒤(커서 없는 손가락 기기)면 그 결과의 시작점 → 끝점이다.
   * 시작점이 모서리 위(끝점·중간점이 아닌 곳)면 안내점 대신 그 모서리와 나란한 안내선을 그 방향 쪽으로 모서리에 수직인 거리만큼 띄워 둔다
   */
  applyLength(length: number): LengthApply {
    if (this.modeValue !== 'tape') return 'mode';
    if (!(Math.abs(length) > 0) || !Number.isFinite(length)) return 'zero';
    let a: V3;
    let toward: V3 | null;
    let edge: [V3, V3] | null;
    if (this.pts.length) {
      a = this.pts[0]!;
      toward = this.cursorSnap()?.point ?? null;
      edge = this.startEdge;
    } else if (this.resultValue?.kind === 'tape') {
      a = this.resultValue.a;
      toward = this.resultValue.b;
      edge = this.resultEdge;
    } else return 'start';
    const end = !toward ? null : edge ? parallelOffset(a, edge, toward, length) : pointAlong(a, toward, length);
    if (!end) return 'direction';
    this.pts = [];
    this.startEdge = null;
    this.dropLock();
    this.forgetTracks(false);
    const made = edge ? this.addGuideLine(end, sub(edge[1], edge[0])) : this.addGuidePoint(end);
    this.setResult(tapeResult(a, end), edge);
    this.hoverDirty = true;
    this.refreshHint();
    // 방금 둔 안내를 골라 두어 잘못 두었으면 바로 지울 수 있게
    this.select(made, false, true);
    return 'ok';
  }

  /**
   * 측정값 칸에 친 각도(도, 음수면 반대쪽): 각도기 중심을 지나 기준 방향에서 그 각도만큼 돈 안내선을 두고(SketchUp 각도기 안내선),
   * 결과를 기준 방향 → 안내선 각도기 결과로 바꾼다. 도는 쪽은 기준 방향을 찍은 뒤면 커서 쪽, 다 잰 뒤(손가락 기기)면 그 결과의 잰 방향 쪽이다
   */
  applyAngle(deg: number): AngleApply {
    if (this.modeValue !== 'protractor') return 'mode';
    if (!Number.isFinite(deg) || !(Math.abs(deg) > 1e-9)) return 'zero';
    let c: V3;
    let base: V3;
    let n: V3;
    let toward: V3 | null;
    if (this.pts.length === 2 && this.normal) {
      [c, base] = this.pts as [V3, V3];
      n = this.normal;
      toward = this.cursorSnap() ? this.hoverPoint : null;
      if (!toward) return 'direction';
    } else if (!this.pts.length && this.resultValue?.kind === 'protractor') {
      ({ center: c, a: base, b: toward, normal: n } = this.resultValue);
    } else return 'start';
    const dir = angledGuideDir(c, base, toward, n, deg);
    if (!dir) return 'direction';
    const end = addScaled(c, dir, Math.hypot(...sub(base, c)));
    this.pts = [];
    this.normal = null;
    this.dropLock();
    this.forgetTracks(false);
    const made = this.addGuideLine(c, dir);
    this.setResult(protractorResult(c, base, end, n));
    this.hoverDirty = true;
    this.refreshHint();
    this.select(made, false, true);
    return 'ok';
  }

  /**
   * 측정값 칸에 친 값 넣기(앱의 칸 넣기): 각도기 각도(도) 또는 줄자 길이(mm — mmPerUnit으로 장면 단위로 바꾼다).
   * 넣었으면 null, 못 넣었으면 알릴 글(applyMessage)
   */
  applyValue(value: number, angle: boolean, mmPerUnit = 1): string | null {
    return applyMessage(angle ? this.applyAngle(value) : this.applyLength(value / mmPerUnit), angle);
  }

  /** 도구 켜기·바꾸기·끄기(null). 진행 중 점과 결과는 지운다 */
  setMode(mode: MeasureMode | null): void {
    if (this.disposed) return;
    const same = mode === this.modeValue;
    if (!same) this.reset();
    this.modeValue = mode;
    this.viewer.canvas.style.cursor = mode ? 'crosshair' : '';
    // 끄면 결과·표식은 바로 지우고, 보이는 안내가 있으면 그것만 다시 그린다(안내는 도구를 끈 뒤에도 보인다)
    this.syncPainter();
    if (!mode) {
      const f = this.g.isConnected ? this.overlay.frame() : null;
      if (f) this.paint(f);
      this.notifyLive(null);
    }
    this.refreshHint();
  }

  /** 진행 중 점과 결과 지우기(도구는 켜 둔다 — 고른 안내도 푼다) */
  clear(): void {
    this.pts = [];
    this.startEdge = null;
    this.normal = null;
    this.centers = [];
    this.dropLock();
    this.forgetTracks(false);
    this.parallelRef = null;
    this.planeAxisValue = null;
    this.lastTap = null;
    this.dropResult();
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
    this.select(null);
  }

  /**
   * 키(keydown·keyup 모두 넘긴다). 처리했으면 true.
   * Esc: 진행 중 점 취소(끌어온 점도 잊는다) → 끌어온 점 잊기 → 화살표로 고정한 각도기 평면 풀기 → 결과 지우기 → (지울 것이 없으면) false — 앱이 도구를 끈다.
   * Shift: 누르고 있는 동안 방향을 잡는 중이면 지금 방향 추론 잠금, 각도기 중심을 찍기 전이면 커서 밑 평면 고정.
   * →·←·↑·↓(keydown): 축·나란히 잠금 켜고 끄기, 각도기 중심을 찍기 전에는 →·←·↑로 각도기 평면 고정(앱은 목록·입력 칸의 화살표를 넘기지 않는다).
   * 안내 두기 키(Ctrl, Mac은 Option): 그 키만 눌렀다 떼면(keyup) 안내 두기 켜고 끄기 — 그사이 다른 키·누르기·휠이 있으면 바꾸지 않는다(Ctrl+O 등).
   */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.modeValue) return false;
    const gk = this.opts.guideKey ?? 'Control';
    if (e.key === gk) {
      if (e.type === 'keydown') {
        if (!e.repeat) this.modTap = true;
        return false;
      }
      if (e.type !== 'keyup' || !this.modTap) return false;
      this.modTap = false;
      // Windows의 Alt 떼기가 브라우저 메뉴로 가지 않게
      e.preventDefault();
      this.setGuideMode(!this.guideOn);
      return true;
    }
    if (e.type === 'keydown') this.modTap = false;
    // Delete·Backspace: 고른 안내 하나 지우기(SketchUp에서 안내를 고르고 Delete)
    if ((e.key === 'Delete' || e.key === 'Backspace') && e.type === 'keydown' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!this.deleteSelectedGuide()) return false;
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape') {
      if (e.type === 'keyup' || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (this.pts.length) {
        this.pts = [];
        this.startEdge = null;
        this.normal = null;
        this.dropLock();
        this.forgetTracks(false);
        this.hoverDirty = true;
      } else if (this.tracker.size) {
        this.forgetTracks(false);
        this.hoverDirty = true;
      } else if (this.planeAxisValue) {
        this.planeAxisValue = null;
        this.hoverDirty = true;
      } else if (this.resultValue) {
        this.dropResult();
      } else return false;
      e.preventDefault();
      this.refreshHint();
      this.overlay.invalidate();
      // 고른 안내도 함께 푼다(Esc 차례는 늘리지 않는다)
      this.select(null);
      return true;
    }
    if (e.key === 'Shift') {
      const down = e.type !== 'keyup';
      if (this.modeValue === 'protractor') this.setPlaneLock(down);
      this.setShift(down);
      return true;
    }
    if (e.type === 'keydown' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.startsWith('Arrow') && this.arrowLock(e.key)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  /** 화살표 잠금(SketchUp): 처리했으면 true */
  private arrowLock(key: string): boolean {
    const axis = Object.prototype.hasOwnProperty.call(ARROW_AXES, key) ? ARROW_AXES[key]! : null;
    if (key !== 'ArrowDown' && !axis) return false;
    if (this.directing) {
      const cur = this.lockValue;
      if (axis) {
        if (cur?.kind === 'axis' && cur.axis === axis) this.setLock(null);
        else this.setLock({ ...axisInferenceLock(axis, this.axes), source: 'key' });
        return true;
      }
      // ↓: 모서리와 나란히·수직(자홍) 잠금 켜고 끄기 — 지금 커서 밑 나란함·수직, 없으면 앞서 지나간 모서리와 나란히
      if (cur && cur.kind !== 'axis') {
        this.setLock(null);
        return true;
      }
      const h = this.lockable(this.freshHover());
      const l = h && h.kind !== 'axis' ? h : this.parallelRef ? parallelInferenceLock(this.parallelRef) : null;
      if (!l) return false;
      this.setLock({ ...l, source: 'key' });
      return true;
    }
    // 각도기 중심을 찍기 전: 각도기 평면을 그 축에 고정(같은 키를 다시 누르면 풀기)
    if (this.modeValue === 'protractor' && !this.pts.length && axis) {
      this.planeAxisValue = this.planeAxisValue === axis ? null : axis;
      this.hoverDirty = true;
      this.refreshHint();
      this.overlay.invalidate();
      return true;
    }
    return false;
  }

  /** 잠금 두기·풀기(null) */
  private setLock(l: MeasureLock | null): void {
    if (!l && !this.lockValue) return;
    this.lockValue = l;
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
  }

  /** 점을 찍거나 취소하면 잠금과 본 방향 추론을 버린다(알림은 뒤따르는 refreshHint가) */
  private dropLock(): void {
    this.lockValue = null;
    this.lastLockable = null;
  }

  /**
   * Shift 눌림(키와 포인터 이동의 shiftKey): 누르는 순간 방향을 잡는 중이면 지금 표식의 방향 추론을 잠그고, 떼면 Shift로 잠근 것을 푼다.
   * 방향 추론이 없을 때 누르면 아무것도 잠그지 않는다(SketchUp처럼 추론이 보일 때 누른다)
   */
  private setShift(down: boolean): void {
    if (down === this.shiftDown) return;
    this.shiftDown = down;
    if (down) {
      if (this.lockValue || !this.directing) return;
      const l = this.lockable(this.freshHover());
      if (l) this.setLock({ ...l, source: 'shift' });
    } else if (this.lockValue?.source === 'shift') this.setLock(null);
  }

  /**
   * 화면 점에서 추정 고르기(코어 고르기 + 둘레 고르기 + 가림 판정). 줄자·각도기의 시작점이 있으면 축 고정을 본다.
   * 프레임이 없으면(보기 크기 0) null.
   */
  snapAt(x: number, y: number, pointerType = 'mouse', frame: ViewFrame | null = this.overlay.frame()): Snap | null {
    const f = frame;
    if (!f) return null;
    const v = this.viewer;
    const scene = this.opts.getScene();
    const radius = snapRadius(pointerType);
    const t0 = now();
    const pick = v.pick(x, y);
    const budget = pointerType === 'touch' ? TOUCH_PROBE_BUDGET_MS : PROBE_BUDGET_MS;
    const probes: (ReturnType<MeasureViewer['pick']>)[] = [];
    for (const [dx, dy] of probeOffsets(radius, CORE_PICK_TOLERANCE_PX)) {
      if (now() - t0 > budget) break;
      probes.push(v.pick(x + dx, y + dy));
    }
    // 단면에 잘린 쪽 후보는 버린다: 장면 전체를 자르는 평면들(그룹 안 단면은 그 그룹 항목만 자르므로 후보 점으로는 가리지 않는다)
    const cuts = (v.sections ?? (v.section ? [v.section] : [])).filter((s) => !('items' in s && s.items));
    const kept = cuts.length ? (p: V3): boolean => cuts.every((sec) => dot(sec.normal, p) <= sec.offset + 1e-9 * (Math.abs(sec.offset) + 1)) : null;
    const mode = v.getRenderMode();
    let checks = 0;
    // 음영 계열 모드에서만 가림을 본다: 후보 점의 화면 자리에서 다시 골라 그보다 앞의 면이 맞으면 가린 것
    const visible =
      mode === 'shaded' || mode === 'shadedEdges' || mode === 'hiddenLine' || mode === 'monochrome' || mode === 'noTexture'
        ? (p: V3): boolean => {
            if (++checks > VISIBLE_CHECKS) return false;
            const s = projectToScreen(f, p);
            if (!s) return false;
            const k = v.pick(s[0], s[1]);
            if (!k || k.kind !== 'mesh') return true;
            const dp = viewDepth(f, p);
            return viewDepth(f, k.point) >= dp - Math.max(1e-6 * Math.abs(dp), worldPerPixel(f, dp) * 1.5);
          }
        : null;
    // 곡선 중심: 커서 둘레 곡선 선분의 중심을 재고 기억한다(가운데로 옮기면 붙게)
    const cc = this.opts.curveCenter;
    const curveCenter = cc
      ? (p: Parameters<NonNullable<Parameters<typeof chooseSnap>[0]['curveCenter']>>[0]): V3 | null => {
          const c = cc(p.id, p.raw ?? p.index);
          if (c) this.rememberCenter(c);
          return c;
        }
      : null;
    return chooseSnap({
      frame: f,
      x,
      y,
      pick,
      probes,
      scene,
      radius,
      from: this.pts[0] ?? null,
      anchor: v.getCamera().target,
      kept,
      visible,
      curveCenter,
      centers: this.centers,
      axisDirs: this.opts.getAxes?.() ?? null,
      // 안내 보이기를 끈 동안과 숨긴 안내(25차 Edit › Hide)에는 붙지 않는다 — 안내 번호는 보이는 안내 배열의 차례(guideAt)
      guides: this.shownValue ? this.visible().vp : [],
      guideLines: this.shownValue ? this.visible().vl : [],
      parallelRef: this.parallelRef,
      lock: this.pts.length ? this.lockValue : null,
      tracks: this.trackOn ? this.tracker.view : null,
      // 축·잠근 선이 면을 뚫는 점은 그 자리에서 그물 면만 다시 맞춰 본다(코어 0.20.0 meshesOnly — 면 위 선분·점은 면을 가리지 않고,
      // 숨긴 항목·단면에서 잘린 쪽은 커서 고르기처럼 코어가 거른다)
      axisMeets: this.meetsOn,
      lockMeets: this.lockMeetsOn,
      faceAt: this.meetsOn || this.lockMeetsOn ? (sx: number, sy: number) => v.pick(sx, sy, FACE_PICK) : null,
    });
  }

  /**
   * 머무르기(커서 추정마다): 마우스·펜 커서나 정밀 조준 십자선이 점 추정 위에 머물기 시작하면 TRACK_DWELL_MS 뒤 그 점을 기억한다.
   * 다른 점·점이 아닌 추정·손가락·벗어남이면 머무르기를 버린다(코어 MeasureTracker.hover). 방금 누른 점과 시작점은 기억하지 않는다
   */
  private dwell(snap: Snap | null, c: Cursor): void {
    if (!this.trackOn) return;
    let p: V3 | null = (c.type === 'mouse' || c.type === 'pen' || c.type === 'aim') && dwellPoint(snap) ? snap!.point : null;
    if (p && this.pressedPoint && samePoint(p, this.pressedPoint)) p = null;
    else this.pressedPoint = null;
    if (p && this.pts[0] && samePoint(p, this.pts[0])) p = null;
    // 정밀 조준: 머물기 시작한 자리에서 AIM_DWELL_PX 안이면 그 자리로 본다(손가락 떨림)
    let { x, y } = c;
    const at = this.aimDwellAt;
    if (c.type === 'aim' && at && Math.hypot(x - at.x, y - at.y) <= AIM_DWELL_PX) ({ x, y } = at);
    const step = this.tracker.hover(p, x, y);
    if (step === 'keep') return;
    this.stopDwell();
    this.aimDwellAt = step === 'start' && c.type === 'aim' ? { x, y } : null;
    if (step === 'start')
      this.dwellTimer = setTimeout(() => {
        this.dwellTimer = null;
        this.aimDwellAt = null;
        if (this.disposed || !this.tracker.commit()) return;
        this.hoverDirty = true;
        this.refreshHint();
        this.overlay.invalidate();
      }, TRACK_DWELL_MS);
  }

  /** 머무르기 타이머만 멈춘다 */
  private stopDwell(): void {
    if (this.dwellTimer === null) return;
    clearTimeout(this.dwellTimer);
    this.dwellTimer = null;
  }

  /** 머무르기를 버린다(누르기·끌기·캔버스를 떠남) */
  private cancelDwell(): void {
    this.stopDwell();
    this.aimDwellAt = null;
    this.tracker.cancel();
  }

  /** 끌어온 점과 머무르기를 잊는다. notify면 다시 추정하고 알린다(부른 쪽이 곧 알리면 false) */
  private forgetTracks(notify = true): void {
    this.cancelDwell();
    if (!this.tracker.clear() || !notify) return;
    this.hoverDirty = true;
    this.refreshHint();
    this.overlay.invalidate();
  }

  /** 지나간 모서리(나란함 기준)와, 방향을 잡는 동안 본 방향 추론을 기억한다 */
  private learn(snap: Snap): void {
    if (snap.locked) return;
    // 모서리에 수직 추론의 edge는 이미 기준 모서리다. 끌어온 축·시작점 축이 모서리와 만나는 점(축 위 점 가운데 edge가 있는 것)도 그 모서리를 지나간 것이다
    if (snap.edge && (REF_KINDS.has(snap.kind) || snap.kind === 'axis') && !snap.inferred) this.parallelRef = [snap.edge[0], snap.edge[1]];
    if (this.directing) this.lastLockable = this.lockable(snap) ?? this.lastLockable;
  }

  /** 추정에서 잠글 방향: 방향 추론, 또는 시작점을 지나는 모서리에 붙은 점 추정(그 모서리 방향) */
  private lockable(snap: Snap | null): InferenceLock | null {
    return lockOf(snap, this.pts[0] ?? null, this.axes);
  }

  /** 축 고정·각도기 평면의 축(모형의 그리기 축 또는 세계 축) */
  private get axes(): AxisDirs {
    return this.opts.getAxes?.() ?? AXIS_DIRS;
  }

  /** 지나간 곡선 중심 기억(같은 점은 앞으로 옮기고, RECENT_CENTERS개까지) */
  private rememberCenter(c: V3): void {
    const same = (a: V3): boolean => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) < 1e-9 * (1 + Math.abs(c[0]) + Math.abs(c[1]) + Math.abs(c[2]));
    this.centers = [c, ...this.centers.filter((x) => !same(x))].slice(0, RECENT_CENTERS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.setMode(null);
    this.disposed = true;
    // 도구를 끈 뒤에도 그리던 안내와 되돌리기·다시 하기 단추도 뗀다
    this.syncPainter();
    this.undoBtn?.remove();
    this.redoBtn?.remove();
    this.lockMenu?.remove();
    for (const f of this.off.splice(0)) f();
    this.presses.clear();
  }

  // ───────────────────────── 입력 ─────────────────────────

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.viewer.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    if (!this.modeValue) return this.onBoxDown(e);
    // Ctrl·Option을 누른 채 누르면 안내 두기 키 누르기가 아니다
    this.modTap = false;
    // 누르기·끌기는 머무르기가 아니다
    this.cancelDwell();
    const p = this.local(e);
    const type = e.pointerType || 'mouse';
    // 둘째 손가락·다른 단추가 함께 눌리면 누르기가 아니다(코어가 확대·이동한다)
    if (this.presses.size) {
      this.cancelAim();
      this.cancelTap = true;
    }
    this.presses.set(e.pointerId, { x: p.x, y: p.y, lx: p.x, ly: p.y, button: e.button, type, moved: false });
    // 한 손가락을 그대로 누르고 있으면 정밀 조준
    if (type === 'touch' && this.presses.size === 1) {
      const id = e.pointerId;
      this.aimTimer = setTimeout(() => this.startAim(id), AIM_HOLD_MS);
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.modeValue) return;
    const p = this.local(e);
    const pr = this.presses.get(e.pointerId);
    if (pr) {
      pr.lx = p.x;
      pr.ly = p.y;
      if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) >= tapSlopPx(pr.type)) {
        pr.moved = true;
        this.stopAimTimer();
        // 궤도·이동 중에는 커서 표식을 숨긴다
        this.dragging = true;
        this.hover = null;
        this.hoverPoint = null;
        this.overlay.invalidate();
      }
      return;
    }
    const type = e.pointerType || 'mouse';
    if (type === 'touch' || e.buttons) return;
    // Shift 잠금은 옮기기 전 자리에서 보인 추론으로(키를 못 받은 사이 눌렀거나 뗐어도 이동의 shiftKey로 맞춘다)
    this.setShift(!!e.shiftKey);
    this.cursor = { x: p.x, y: p.y, type };
    if (this.modeValue === 'protractor') this.setPlaneLock(!!e.shiftKey);
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    const pr = this.presses.get(e.pointerId);
    this.presses.delete(e.pointerId);
    this.stopAimTimer();
    if (!pr || !this.modeValue) return;
    const tap = !cancel && !pr.moved && !this.cancelTap && (pr.type === 'touch' || pr.button === 0);
    if (!this.presses.size) {
      this.cancelTap = false;
      if (this.dragging) {
        this.dragging = false;
        this.hoverDirty = true;
      }
    }
    if (tap) {
      const p = this.local(e);
      // 두 번 누르기: 코어와 같은 문턱(시간 DOUBLE_CLICK_MS, 거리 마우스 6·손가락 24화소 — 세 번째는 다시 한 번)
      const t = now();
      const n = clickCount(this.lastClick, t, p.x, p.y, pr.type);
      this.lastClick = { t, x: p.x, y: p.y, n };
      this.place(p.x, p.y, pr.type, e.shiftKey, n);
    } else this.overlay.invalidate();
  }

  private onLeave(): void {
    if (!this.modeValue || this.presses.size) return;
    if (this.cursor?.type === 'touch') return;
    this.cancelDwell();
    this.cursor = null;
    this.hover = null;
    this.hoverPoint = null;
    this.overlay.invalidate();
  }

  // ───────────────────────── 정밀 조준(터치 길게 누르기) ─────────────────────────

  private stopAimTimer(): void {
    if (this.aimTimer === null) return;
    clearTimeout(this.aimTimer);
    this.aimTimer = null;
  }

  private startAim(id: number): void {
    this.aimTimer = null;
    const pr = this.presses.get(id);
    if (!this.modeValue || !pr || pr.moved || this.cancelTap || this.presses.size !== 1) return;
    this.aimId = id;
    this.dragging = false;
    this.cursor = this.aimCursor(pr.lx, pr.ly);
    this.hoverDirty = true;
    // 짧은 떨림으로 조준이 시작됐음을 알린다(지원하는 기기만)
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 진동을 막은 브라우저 */
    }
    this.overlay.invalidate();
  }

  /** 조준 중인 손가락 움직임: 코어로 보내지 않고 십자선을 옮긴다 */
  private onAimMove(e: PointerEvent): void {
    if (this.aimId === null || e.pointerId !== this.aimId) return;
    e.stopPropagation();
    const p = this.local(e);
    this.cursor = this.aimCursor(p.x, p.y);
    this.hoverDirty = true;
    this.overlay.invalidate();
  }

  /** 손가락 자리(캔버스 좌표)의 정밀 조준 커서: 손가락 위 십자선, 3D 보기 위에 뜬 장면 탭·뷰 큐브·띠 밑이면 비킨다(aimPoint — 25차) */
  private aimCursor(x: number, y: number): Cursor {
    const f = this.overlay.frame();
    return { ...aimPoint(x, y, this.coverAreas(), f ? { width: f.width, height: f.height } : undefined), type: 'aim', fx: x, fy: y };
  }

  /** 조준 중인 손가락을 떼면 십자선 자리에 점을 찍는다(떼기 이벤트는 코어에 넘겨 끌기 상태를 끝내게 한다) */
  private onAimUp(e: PointerEvent, cancel: boolean): void {
    if (this.aimId === null || e.pointerId !== this.aimId) return;
    const c = this.cursor;
    this.aimId = null;
    this.presses.delete(e.pointerId);
    if (!this.presses.size) this.cancelTap = false;
    // 길게 눌러 찍은 점은 두 번 누르기의 한쪽이 아니다
    this.lastClick = { t: now(), x: c?.x ?? 0, y: c?.y ?? 0, n: 0 };
    if (!cancel && c && this.modeValue) this.place(c.x, c.y, 'aim');
    // 찍지 못했으면(빈 곳·취소) 십자선 자리의 추정 표시를 지운다
    if (this.cursor?.type === 'aim') {
      this.cursor = null;
      this.hover = null;
      this.hoverPoint = null;
    }
    this.overlay.invalidate();
  }

  /**
   * 고르기 상자 시작(25차 — 줄자·각도기를 끈 동안의 캔버스 누르기): 마우스·펜 왼쪽 단추를 고르기 수정 키(Ctrl·Shift·Shift+Ctrl — Mac은 Option)와 함께 누르고,
   * 보이는 안내가 있으면 상자를 준비한다. SketchUp 고르기 도구는 맨 끌기도 상자지만 이 뷰어는 맨 왼쪽 끌기가 궤도라(SketchUp의 고르기·궤도 도구를 한 도구로 씀)
   * 수정 키를 누른 끌기만 상자로 한다. 걷는 중·손가락은 상자를 그리지 않는다(그대로 코어 몫)
   */
  private onBoxDown(e: PointerEvent): void {
    this.box = null;
    const type = e.pointerType || 'mouse';
    if (this.disposed || this.modeValue || e.button !== 0 || isTouch(type) || !this.shownValue || this.viewer.navigation === 'walk') return;
    const op = guideSelectOp(e, this.opts.guideKey);
    const v = this.visible();
    if (op === 'replace' || !(v.vp.length + v.vl.length)) return;
    const p = this.local(e);
    this.box = { id: e.pointerId, type, x0: p.x, y0: p.y, x1: p.x, y1: p.y, op, on: false };
  }

  /** 고르기 상자 끌기: 코어 궤도로 보내지 않고(누르기 몫은 끌기 시작 거리 안이면 코어가 그대로 고르기로 알린다), 끌기 시작 거리를 넘으면 상자를 그린다 */
  private onBoxMove(e: PointerEvent): void {
    const b = this.box;
    if (!b || e.pointerId !== b.id) return;
    e.stopPropagation();
    const p = this.local(e);
    b.x1 = p.x;
    b.y1 = p.y;
    if (!b.on && Math.hypot(p.x - b.x0, p.y - b.y0) >= dragStartPx(b.type)) b.on = true;
    if (b.on) this.overlay.invalidate();
  }

  /**
   * 고르기 상자 떼기: 끈 상자면 그 안의 안내를 고르기 방식대로 넣고 빼며(guidesInBox — 오른쪽으로 끌면 다 든 것, 왼쪽은 걸친 것까지),
   * 코어에는 끌기를 거둔 것으로 알린다(뗀 자리를 누르기로 보고 형상을 고르지 않게). 끌지 않았으면 누르기라 코어·앱이 pickGuide로 고른다
   */
  private onBoxUp(e: PointerEvent, cancel: boolean): void {
    const b = this.box;
    if (!b || e.pointerId !== b.id) return;
    this.box = null;
    if (!b.on) return;
    this.overlay.invalidate();
    if (cancel) return;
    const p = this.local(e);
    const f = this.overlay.frame();
    if (f) {
      const v = this.visible();
      const hit = guidesInBox(f, v.vp, v.vl, b.x0, b.y0, p.x, p.y);
      this.pickGuides([...hit.points.map((i) => v.vp[i]!), ...hit.lines.map((i) => v.vl[i]!)], b.op);
      if (this.liveSel().length) this.opts.onGuidePick?.();
    }
    cancelPointer(this.viewer.canvas, e);
  }

  /** 둘째 손가락이 닿으면 조준을 그만둔다(점은 찍지 않고, 두 손가락 확대·이동은 코어가 한다) */
  private cancelAim(): void {
    this.stopAimTimer();
    if (this.aimId === null) return;
    this.aimId = null;
    this.cursor = null;
    this.hover = null;
    this.hoverPoint = null;
    this.overlay.invalidate();
  }

  /** Shift 고정 켜기·끄기(중심을 찍은 뒤에는 평면이 이미 정해져 상관없다) */
  private setPlaneLock(on: boolean): void {
    if (on) {
      if (!this.planeLock && this.hoverPlane) {
        this.planeLock = this.hoverPlane;
        this.overlay.invalidate();
      }
    } else if (this.planeLock) {
      this.planeLock = null;
      this.hoverDirty = true;
      this.overlay.invalidate();
    }
  }

  /** 각도기 중심을 찍을 때의 평면: 화살표로 고정한 축 평면, 없으면 추정 밑 면·카메라를 가장 정면으로 보는 축 평면 */
  private centerPlane(snap: Pick<Snap, 'normal'> | null, f: ViewFrame): V3 {
    const a = this.planeAxisValue;
    if (a) {
      const n = this.axes[a];
      return [n[0], n[1], n[2]];
    }
    return protractorPlane(snap, forwardOf(f), this.axes).normal;
  }

  /** 점 찍기(누르기·탭). clicks = 2면 두 번 누르기의 둘째(줄자로 모서리를 두 번 누르면 그 모서리 위 안내선) */
  private place(x: number, y: number, type: string, shift = false, clicks = 1): void {
    // 바로 앞 누르기의 모서리(두 번 누르기 안내선) — 이 누르기가 무엇을 하든 다음 누르기에는 이 누르기 것만 남긴다
    const memo = this.lastTap;
    this.lastTap = null;
    const f = this.overlay.frame();
    if (!f) return;
    const snap = this.snapAt(x, y, type, f);
    if (!snap) return;
    this.learn(snap);
    // 방금 누른 점은 커서가 떠날 때까지 머물러도 끌어오지 않는다
    this.pressedPoint = snap.point;
    if (this.modeValue === 'tape') {
      const edge = edgeOfTap(snap);
      // 모서리 두 번 누르기: 첫 누르기가 모서리에 붙었고 둘째가 빈 곳·다른 직선의 모서리가 아니면 그 모서리 위 안내선
      if (clicks === 2 && memo && snap.kind !== 'free' && (!edge || collinear(memo.edge, edge))) return this.edgeGuide(memo, x, y, type, snap);
      if (edge) this.lastTap = { edge, pts: null, result: null, resultEdge: null };
    }
    const ray = screenRay(f, x, y);
    // 고르기: 안내점·안내선 위를 누르면 그 안내(방금 둔 안내가 있으면 그것), 다른 곳이면 푼다 — Delete·지우기 단추로 지운다
    let sel: GuideRef | null = this.guideAt(snap);
    let selStart = false;
    let added = false;
    if (this.modeValue === 'tape') {
      // 빈 곳(형상·축 추정이 없음)은 찍지 않는다
      if (snap.kind === 'free') return this.select(null);
      if (!this.pts.length) {
        const prev = this.resultValue;
        const prevEdge = this.resultEdge;
        this.dropResult();
        this.pts = [snap.point];
        // 모서리 위(끝점·중간점이 아닌 곳, 안내선 위 포함)에서 시작하면 친 길이는 그 모서리와 나란한 안내선이 된다(SketchUp 줄자)
        this.startEdge = snap.kind === 'onEdge' && snap.edge ? snap.edge : null;
        selStart = true;
        // 두 번 누르기의 첫 누르기면 이 시작점을 거두고 지운 결과를 되돌린다
        if (this.lastTap) Object.assign(this.lastTap, { pts: this.pts, result: prev, resultEdge: prevEdge });
      } else {
        const a = this.pts[0]!;
        if (samePoint(a, snap.point)) return;
        const edge = this.startEdge;
        let end = snap.point;
        // 안내 두기: 모서리 위에서 시작했으면 둘째 점을 지나 그 모서리와 나란한 안내선(결과는 모서리에 수직인 거리 — 둘째 점이
        // 모서리 직선 위면 안내선 없이 재기만), 점에서 시작했으면 둘째 점에 안내점
        if (this.guideOn) {
          const foot = this.guideEnd(a, snap.point);
          if (edge && foot) {
            end = foot;
            sel = this.addGuideLine(foot, sub(edge[1], edge[0]));
            added = true;
          } else if (!edge) {
            sel = this.addGuidePoint(snap.point);
            added = true;
          }
        }
        this.pts = [];
        this.startEdge = null;
        // 측정을 마치면 끌어온 점을 잊는다(첫 점에서는 남긴다 — 줄 맞춘 자리에 쓴다)
        this.forgetTracks(false);
        this.setResult(tapeResult(a, end), edge);
      }
    } else if (this.modeValue === 'protractor') {
      if (!this.pts.length) {
        if (snap.kind === 'free') return this.select(null);
        const plane = this.centerPlane(snap, f);
        if (shift && !this.planeLock) this.planeLock = plane;
        this.dropResult();
        this.normal = this.planeLock ?? plane;
        this.pts = [snap.point];
        // 화살표로 고정한 평면은 이 측정에 쓴다
        this.planeAxisValue = null;
        selStart = true;
      } else {
        const c = this.pts[0]!;
        const n = this.normal ?? protractorPlane(null, forwardOf(f), this.axes).normal;
        const p = protractorPoint(ray, snap, c, n);
        if (samePoint(c, p)) return;
        if (this.pts.length === 1) this.pts.push(p);
        else {
          const a = this.pts[1]!;
          this.pts = [];
          this.normal = null;
          this.forgetTracks(false);
          // 안내 두기: 중심을 지나 잰 방향으로 안내선(SketchUp 각도기 셋째 누르기)
          if (this.guideOn) {
            sel = this.addGuideLine(c, sub(p, c));
            added = true;
          }
          this.setResult(protractorResult(c, a, p, n));
        }
      }
    }
    this.select(sel, selStart, added);
    // 점을 찍으면 잠금을 푼다(다음 방향은 새 추론으로 — Shift는 다시 눌러 잠근다)
    this.dropLock();
    this.placed(x, y, type, snap);
  }

  /**
   * 모서리 두 번 누르기(SketchUp 줄자): 첫 누르기가 붙은 모서리를 지나는 끝없는 안내선을 두고 골라 둔다(같은 직선의 안내선이 있으면 그것을 고른다,
   * 안내선은 MAX_GUIDE_LINES개까지). 첫 누르기가 시작점을 찍었으면(그 뒤 바뀌지 않았으면) 그 점을 거두고 그 누르기가 지운 결과를 되돌린다.
   * 첫 누르기가 진행 중 측정을 마쳤으면 그 결과는 그대로 둔다
   */
  private edgeGuide(memo: TapMemo, x: number, y: number, type: string, snap: Snap): void {
    if (memo.pts && memo.pts === this.pts) {
      this.pts = [];
      this.startEdge = null;
      if (memo.result) this.setResult(memo.result, memo.resultEdge);
    }
    this.dropLock();
    const [a, b] = memo.edge;
    this.select(this.addGuideLine(a, sub(b, a)), false, true);
    this.placed(x, y, type, snap);
  }

  /** 누른 뒤 표식·안내: 터치(정밀 조준 포함)는 커서가 없으니 누른 자리의 추정을 표식으로 남긴다 */
  private placed(x: number, y: number, type: string, snap: Snap): void {
    if (type === 'touch' || type === 'aim') {
      this.cursor = { x, y, type: 'touch' };
      this.hover = snap;
      this.hoverPoint = null;
      this.hoverDirty = false;
    } else {
      this.cursor = { x, y, type };
      this.hoverDirty = true;
    }
    this.refreshHint();
    this.overlay.invalidate();
  }

  /** 결과 두기. edge: 줄자 결과가 모서리 위에서 시작했으면 그 모서리(다 잰 뒤 친 길이도 나란한 안내선으로) */
  private setResult(r: MeasureToolResult, edge: [V3, V3] | null = null): void {
    this.resultValue = r;
    this.resultEdge = r.kind === 'tape' ? edge : null;
    this.opts.onResult(r);
  }

  private dropResult(): void {
    if (!this.resultValue) return;
    this.resultValue = null;
    this.resultEdge = null;
    this.opts.onResult(null);
  }

  private reset(): void {
    this.pts = [];
    this.startEdge = null;
    this.normal = null;
    this.centers = [];
    this.planeLock = null;
    this.hoverPlane = null;
    this.hover = null;
    this.hoverPoint = null;
    this.cursor = null;
    this.dragging = false;
    this.presses.clear();
    this.cancelTap = false;
    this.stopAimTimer();
    this.aimId = null;
    this.dropLock();
    this.forgetTracks(false);
    this.pressedPoint = null;
    this.parallelRef = null;
    this.planeAxisValue = null;
    this.selGuides = [];
    this.box = null;
    this.selPlacedStart = false;
    this.lastClick = { t: -Infinity, x: 0, y: 0, n: 0 };
    this.lastTap = null;
    this.dropResult();
  }

  /** 안내 글(바뀌면 onHint)과 잠금·화살표 평면(바뀌면 onLock) 알리기 */
  private refreshHint(): void {
    const h = measureHint(this.modeValue, this.pts.length, !!this.resultValue, this.opts.touch?.() ?? false, this.edgeStart, this.guideOn);
    if (h !== this.lastHint) {
      this.lastHint = h;
      this.opts.onHint?.(h);
    }
    // 방향을 잡지 않게 되거나(점을 찍음·취소·도구 바꾸기) 잠갔으면 잠글 방향 고르기 줄을 닫는다
    if (this.lockMenu && !this.lockMenu.hidden && (!this.directing || this.lockValue)) this.toggleLockMenu(false);
    const [lock, plane, tracks] = this.lockNote;
    const n = this.tracker.size;
    if (lock !== this.lockValue || plane !== this.planeAxisValue || tracks !== n) {
      this.lockNote = [this.lockValue, this.planeAxisValue, n];
      this.opts.onLock?.();
    }
  }

  // ───────────────────────── 그리기 ─────────────────────────

  /** 커서 자리에서 추정을 다시 한다(그리기 틀마다 많아야 한 번) */
  private updateHover(f: ViewFrame): void {
    const c = this.cursor;
    if (!c || this.dragging || c.type === 'touch') {
      if (!c || c.type !== 'touch') {
        this.hover = null;
        this.hoverPoint = null;
      }
      return;
    }
    const snap = this.snapAt(c.x, c.y, c.type, f);
    this.hover = snap;
    this.hoverPoint = null;
    this.dwell(snap, c);
    if (!snap) return;
    this.learn(snap);
    if (this.modeValue === 'protractor') {
      if (!this.pts.length) this.hoverPlane = this.centerPlane(snap, f);
      else this.hoverPoint = protractorPoint(screenRay(f, c.x, c.y), snap, this.pts[0]!, this.normal ?? this.axes.z);
    }
  }

  private paint(f: ViewFrame): void {
    const mode = this.modeValue;
    if (mode && this.hoverDirty) {
      this.hoverDirty = false;
      this.updateHover(f);
    }
    // 다른 덧그림이 층을 비웠으면 다시 붙인다
    if (this.g.parentNode !== this.overlay.svg) this.overlay.svg.append(this.g);
    if (this.layer.parentNode !== this.overlay.labels) this.overlay.labels.append(this.layer);
    this.g.replaceChildren();
    this.layer.replaceChildren();
    this.labelQueue = [];
    const shown = this.shownValue;
    // 숨긴 안내(25차)는 그리지 않는다. 고른 안내는 파랑
    const vis = this.visible();
    const sel = this.selGuides;

    // 안내선은 맨 아래(결과 선·표식이 그 위에 보이게). 테두리는 선 색(글자 색)과 반대 밝기 — 어두운 테마의 흰 점선이 흰 테두리에 묻히지 않게
    if (shown && vis.vl.length) {
      const halo = haloFor(typeof getComputedStyle === 'function' ? getComputedStyle(this.g).color : '');
      for (const gl of vis.vl) this.guideLineMark(f, gl, halo, sel.includes(gl) ? 'is-selected' : '');
    }
    // 도구를 끈 동안: 안내만(SketchUp처럼 늘 보인다 — 고르기 도구로 고른 안내는 파랑)과 고르기 상자
    if (!mode) {
      if (shown) for (const g of vis.vp) this.guideMark(f, g, sel.includes(g));
      this.boxMark();
      return;
    }
    const scene = this.opts.getScene();
    const units = this.opts.getUnits();
    const k = mmPerSceneUnit(scene?.units);
    const len = (d: number): string => formatLength(d * k, units);
    const ang = (deg: number): string => formatAngle(deg, units);
    const r = this.resultValue;
    if (r?.kind === 'tape') this.drawTape(f, r, len(r.distance));
    else if (r?.kind === 'protractor') this.drawAngle(f, r.center, r.a, r.b, r.normal, ang(r.angle), true);

    const snap = this.dragging ? null : this.hover;
    let tip: string | null = snap ? snapTipLabel(snap) : null;
    // 나란함의 기준 모서리(자홍 점선)·잠근 선으로 옮겨 온 점(가는 점선) — 커서가 있을 때
    const live = snap && this.cursor?.type !== 'touch' ? snap : null;
    // 기준 모서리: 나란히, 지나간 모서리에 수직(추론·잠금)
    if ((live?.kind === 'parallel' || (live?.kind === 'perpendicular' && (live.inferred || live.locked))) && live.edge)
      this.segment(f, live.edge[0], live.edge[1], 'measure-parallel-ref', { stroke: SNAP_COLORS.parallel, 'stroke-width': 2.5, 'stroke-dasharray': '2 4' });
    if (live?.from) this.lockFrom(f, live);
    // 끌어온 점(+)과 붙은 끌어온 축(그 점에서 커서 자리까지 축 색 점선)
    if (this.tracker.size) this.trackMarks(f, live);
    if (this.modeValue === 'tape') {
      const a = this.pts[0];
      if (a) {
        this.dot(f, a);
        if (live) {
          // 안내 두기로 모서리 위에서 시작했으면: 커서를 지나 모서리와 나란한 안내선 미리 보기와, 그 선까지 모서리에 수직인 길이
          const edge = this.guideOn ? this.startEdge : null;
          const foot = edge ? edgeFoot(a, edge, live.point) : null;
          if (edge && foot) {
            this.guideLineMark(f, { point: foot, dir: unit(sub(edge[1], edge[0])) }, haloFor(typeof getComputedStyle === 'function' ? getComputedStyle(this.g).color : ''), 'is-preview');
            this.rubber(f, a, foot, live);
          } else this.rubber(f, a, live.point, live);
          tip = joinTip(snapTipLabel(live), len(Math.hypot(...sub(foot ?? live.point, a))));
        }
      }
    } else {
      const [c, base] = this.pts;
      const n = this.normal;
      if (!c) {
        if (snap && snap.kind !== 'free') this.disk(f, snap.point, this.planeLock ?? this.hoverPlane ?? this.centerPlane(snap, f), !!this.planeLock || !!this.planeAxisValue);
      } else if (n) {
        this.disk(f, c, n, false);
        this.dot(f, c);
        const cur = this.dragging || this.cursor?.type === 'touch' ? null : this.hoverPoint;
        if (!base) {
          if (cur) this.rubber(f, c, cur, snap);
        } else {
          this.segment(f, c, base, 'measure-ray');
          this.dot(f, base);
          if (cur) {
            const deg = planeAngle(sub(base, c), sub(cur, c), n);
            // 안내 두기: 중심을 지나 커서 쪽으로 둘 안내선 미리 보기
            if (this.guideOn && !samePoint(c, cur))
              this.guideLineMark(f, { point: c, dir: unit(sub(cur, c)) }, haloFor(typeof getComputedStyle === 'function' ? getComputedStyle(this.g).color : ''), 'is-preview');
            this.drawAngle(f, c, base, cur, n, null, false);
            this.rubber(f, c, cur, snap);
            tip = joinTip(snap ? snapTipLabel(snap) : '', ang(deg));
          }
        }
      }
    }
    if (shown) for (const g of vis.vp) this.guideMark(f, g, sel.includes(g));
    if (snap && snap.kind !== 'free') this.marker(f, snap);
    if (this.aimId !== null && this.cursor) this.reticle(this.cursor.x, this.cursor.y);
    // 안내 두기: 커서 오른쪽 위에 + (SketchUp 줄자·각도기 커서의 +)
    if (this.guideOn && this.cursor && this.cursor.type !== 'touch' && !this.dragging) this.guidePlus(this.cursor.x, this.cursor.y);
    // 3D 보기 위에 뜬 것의 자리는 툴팁이나 결과 글이 있을 때만 한 번 잰다
    let cover: MeasureLabelRect[] | null = null;
    const covers = (): MeasureLabelRect[] => (cover ??= this.coverAreas());
    this.tooltip(f, tip, covers);
    this.settleLabels(f, covers);
    this.notifyLive(snap);
  }

  /**
   * 3D 보기 위에 떠서 결과 글·툴팁이 비킬 것(캔버스 기준): 앱이 알려 준 요소(측정 띠·측정값 칸·장면 탭 등 — labelAvoid),
   * 코어 뷰 큐브(보일 때만 — 덧그림이 그 위라 결과 글이 큐브를 덮는다), 잠글 방향 고르기 줄(열렸을 때). 이 차례로 둔다(비킬 자리 차례가 같게).
   * 뷰 큐브 자리는 코어가 알려 준다(0.23.0 viewCubeRect — 캔버스 왼쪽 위 기준, 감췄으면 null). 앱은 큐브를 CSS로 옮기지 않는다
   */
  private coverAreas(): MeasureLabelRect[] {
    const els: (Element | null | undefined)[] = [...(this.opts.labelAvoid?.() ?? [])];
    const v = this.viewer;
    const cube = v.viewCubeRect ?? null;
    const menu = this.lockMenu && !this.lockMenu.hidden ? this.lockMenu : null;
    if (!cube && !menu && !els.some((e) => !!e)) return [];
    const box = v.canvas.getBoundingClientRect();
    const out = coverRects(box, els.map((e) => e?.getBoundingClientRect()));
    if (cube && cube.width > 0 && cube.height > 0) out.push({ x: cube.x, y: cube.y, width: cube.width, height: cube.height });
    if (menu) out.push(...coverRects(box, [menu.getBoundingClientRect()]));
    return out;
  }

  /**
   * 결과 글이 정밀 조준 십자선·손가락, 커서 옆 툴팁, 3D 보기 위에 뜬 것(coverAreas — 측정 띠·측정값 칸·장면 탭·뷰 큐브)과 겹치거나
   * 보기에 걸친 글이 보기 밖으로 잘리면(edgeBands — 휴대폰은 위 도구 띠·아래 상태 줄·화면 끝) 비켜 둔다(labelSpot — 코어 placeMeasureLabel 차례).
   * 겹치지 않으면 가운데 자리 그대로라 그림이 예전과 같다. 글이 모두 보기 밖이면(결과 가운데가 멀리 밖) 가장자리에 붙여 두지 않는다.
   * 26차: 보기 안의 결과 글은 먼저 놓인 글상자(모형 글·치수 라벨 — placedLabels, 앞서 놓은 결과 글)와 겹쳐도 코어 0.24.0 placeLabelAmong 차례로 비킨다
   * (모형 라벨을 먼저 놓고 결과 글을 뒤에 놓는다 — 코어가 덧그림 글상자 뒤에 측정 거리 글상자를 놓는 것과 같다)
   */
  private settleLabels(f: ViewFrame, covers: () => MeasureLabelRect[]): void {
    if (!this.labelQueue.length) return;
    const rects: MeasureLabelRect[] = [];
    const circles: LabelCircle[] = [];
    const c = this.cursor;
    if (this.aimId !== null && c) {
      circles.push({ x: c.x, y: c.y, r: RETICLE_AVOID_R });
      rects.push({ x: (c.fx ?? c.x) - 22, y: (c.fy ?? c.y + AIM_OFFSET_PX) - 22, width: 44, height: 44 });
    }
    const t = this.tip;
    if (t.style.display !== 'none' && t.parentNode === this.layer && t.offsetWidth > 0 && t.offsetHeight > 0)
      rects.push({ x: parseFloat(t.style.left) || 0, y: parseFloat(t.style.top) || 0, width: t.offsetWidth, height: t.offsetHeight });
    rects.push(...covers());
    const edged = [...rects, ...edgeBands(f.width, f.height)];
    const placed = placedRects(this.opts.placedLabels?.() ?? []);
    for (const q of this.labelQueue) {
      const w = q.el.offsetWidth, h = q.el.offsetHeight;
      const inView = q.x + w / 2 > 0 && q.y + h / 2 > 0 && q.x - w / 2 < f.width && q.y - h / 2 < f.height;
      if (!inView && !rects.length && !circles.length) continue;
      const at = labelSpot(q.x, q.y, w, h, f, { rects: inView ? edged : rects, circles }, q.seg, q.soft, inView ? placed : []);
      if (inView && w > 0 && h > 0) placed.push({ x: at ? at.x : q.x - w / 2, y: at ? at.y : q.y - h / 2, width: w, height: h });
      if (!at) continue;
      q.el.style.left = `${Math.round(at.x)}px`;
      q.el.style.top = `${Math.round(at.y)}px`;
      q.el.style.transform = 'none';
      q.el.classList.add('is-moved');
    }
  }

  /**
   * 측정값 칸 값 알리기: 줄자는 진행 중이면 시작점 → 커서 길이, 아니면 줄자 결과 거리.
   * 각도기는 기준 방향을 찍은 뒤면 기준 방향 → 커서 각도, 아니면 각도기 결과 각도
   */
  private notifyLive(snap: Snap | null): void {
    let live: number | null = null;
    const kind: LiveKind = this.modeValue === 'protractor' ? 'angle' : 'length';
    const cursor = !!snap && this.cursor?.type !== 'touch';
    if (this.modeValue === 'tape') {
      const a = this.pts[0];
      // 안내 두기로 모서리 위에서 시작했으면 둘 안내선까지 모서리에 수직인 길이
      if (a && cursor) live = Math.hypot(...sub((this.guideOn && this.startEdge ? edgeFoot(a, this.startEdge, snap!.point) : null) ?? snap!.point, a));
      else if (this.resultValue?.kind === 'tape') live = this.resultValue.distance;
    } else if (this.modeValue === 'protractor') {
      const [c, base] = this.pts;
      if (c && base && this.normal && cursor && this.hoverPoint) live = planeAngle(sub(base, c), sub(this.hoverPoint, c), this.normal);
      else if (this.resultValue?.kind === 'protractor') live = this.resultValue.angle;
    }
    if (live === this.lastLive && kind === this.lastLiveKind) return;
    this.lastLive = live;
    this.lastLiveKind = kind;
    this.opts.onLive?.(live, kind);
  }

  /**
   * 안내선 표식: 화면 끝까지 뻗은 점선(흰 테두리 — SketchUp 안내선). 'is-preview'는 안내 두기로 둘 자리(옅게),
   * 'is-selected'는 고른 안내(파랑, 굵게)
   */
  private guideLineMark(f: ViewFrame, gl: GuideLine, halo: string, state: '' | 'is-preview' | 'is-selected' = ''): void {
    const s = guideLineScreen(f, gl);
    if (!s) return;
    const at = { x1: s[0].toFixed(1), y1: s[1].toFixed(1), x2: s[2].toFixed(1), y2: s[3].toFixed(1) };
    const g = svgEl('g', { class: state ? `measure-guide-line ${state}` : 'measure-guide-line' });
    if (state === 'is-preview') g.setAttribute('opacity', '0.6');
    const sel = state === 'is-selected';
    g.append(
      svgEl('line', { ...at, stroke: sel ? '#ffffff' : halo, 'stroke-width': sel ? 4.5 : 3, 'stroke-opacity': sel ? 0.8 : 0.55 }),
      svgEl('line', { ...at, stroke: sel ? GUIDE_SELECTED_COLOR : 'currentColor', 'stroke-width': sel ? 2 : 1.25, 'stroke-dasharray': '8 5' }),
    );
    this.g.append(g);
  }

  /** 안내 두기 표시: 커서 오른쪽 위의 작은 +(흰 테두리) */
  private guidePlus(x: number, y: number): void {
    const cx = x + 11, cy = y - 11;
    const d = `M${cx - 4},${cy}h8M${cx},${cy - 4}v8`;
    const g = svgEl('g', { class: 'measure-guide-plus' });
    g.append(svgEl('path', { d, stroke: '#ffffff', 'stroke-width': 4, 'stroke-linecap': 'round' }), svgEl('path', { d, stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round' }));
    this.g.append(g);
  }

  /** 안내점 표식: 흰 테두리를 두른 작은 ×(SketchUp 안내점). 고른 안내점은 조금 크게 파랑 */
  private guideMark(f: ViewFrame, p: readonly number[], selected = false): void {
    const s = screenPoint(f, p, 20);
    if (!s) return;
    const [x, y] = s;
    const r = selected ? 5.5 : 4;
    const d = `M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`;
    const g = svgEl('g', { class: selected ? 'measure-guide is-selected' : 'measure-guide' });
    g.append(
      svgEl('path', { d, stroke: '#ffffff', 'stroke-width': selected ? 4.5 : 3.5, 'stroke-linecap': 'round' }),
      svgEl('path', { d, stroke: selected ? GUIDE_SELECTED_COLOR : 'currentColor', 'stroke-width': selected ? 2.25 : 1.5, 'stroke-linecap': 'round' }),
    );
    this.g.append(g);
  }

  /**
   * 고르기 상자(끄는 중일 때만): 고른 안내 색 테두리와 옅은 채움. 왼쪽으로 끈 상자(걸친 것까지 고름)는 점선, 오른쪽은 실선으로 다르게 보인다
   * (이 뷰어의 표시 — 공개 도움말은 상자 모양을 밝히지 않는다)
   */
  private boxMark(): void {
    const b = this.box;
    if (!b?.on) return;
    const crossing = b.x1 < b.x0;
    this.g.append(
      svgEl('rect', {
        class: crossing ? 'measure-box is-crossing' : 'measure-box',
        x: Math.min(b.x0, b.x1),
        y: Math.min(b.y0, b.y1),
        width: Math.abs(b.x1 - b.x0),
        height: Math.abs(b.y1 - b.y0),
        fill: GUIDE_SELECTED_COLOR,
        'fill-opacity': 0.08,
        stroke: GUIDE_SELECTED_COLOR,
        'stroke-width': 1,
        ...(crossing ? { 'stroke-dasharray': '5 3' } : {}),
      }),
    );
  }

  /** 정밀 조준 십자선(가운데는 비워 추정 표식이 보이게, 흰 테두리로 어느 바탕에서도 보이게) */
  private reticle(x: number, y: number): void {
    const r = 16;
    const gap = 6;
    const d = `M${x - r - 6} ${y}H${x - gap}M${x + gap} ${y}H${x + r + 6}M${x} ${y - r - 6}V${y - gap}M${x} ${y + gap}V${y + r + 6}`;
    const g = svgEl('g', { class: 'measure-aim' });
    g.append(
      svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.85 }),
      svgEl('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.85 }),
      svgEl('circle', { cx: x, cy: y, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
      svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    );
    this.g.append(g);
  }

  private tooltip(f: ViewFrame, text: string | null, covers: () => readonly MeasureLabelRect[]): void {
    const c = this.cursor;
    const el = this.tip;
    if (!c || !text || this.dragging) {
      el.style.display = 'none';
      return;
    }
    el.textContent = text;
    el.style.display = 'block';
    this.layer.append(el);
    const pos = tooltipPosition(c.x, c.y, el.offsetWidth || 0, el.offsetHeight || 0, f.width, f.height, c.type === 'aim', covers());
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  /** 결과 글(기준점 가운데). seg = 줄자 화면 선분, soft = 될 수 있으면 가리지 않을 점 표식(비켜 둘 때 — settleLabels) */
  private label(x: number, y: number, text: string, cls: string, seg: [number[], number[]] | null = null, soft: LabelCircle[] = []): void {
    const el = document.createElement('div');
    el.className = `measure-label ${cls}`;
    el.textContent = text;
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;`;
    this.layer.append(el);
    this.labelQueue.push({ el, x, y, seg, soft });
  }

  private segment(f: ViewFrame, a: readonly number[], b: readonly number[], cls: string, attrs: Record<string, string | number> = {}): void {
    const s = screenSegment(f, a, b);
    if (!s) return;
    this.g.append(svgEl('line', { class: cls, x1: s[0], y1: s[1], x2: s[2], y2: s[3], stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', ...attrs }));
  }

  /**
   * 진행 중 선(시작점 → 커서). 축 고정이면 그 축 색, 나란함은 자홍(SketchUp 관례).
   * 잠갔으면 굵은 실선(축 색, 나란함·수직은 자홍 — SketchUp 추론 잠금처럼)
   */
  private rubber(f: ViewFrame, a: readonly number[], b: readonly number[], snap0: Snap | null | undefined): void {
    // 끌어온 점을 지나는 축 위 점은 시작점에서 그 축 방향이 아니라 보통 선(축 색은 끌어온 점선이 맡는다)
    const snap = snap0?.trackFrom && !snap0.dir ? null : snap0;
    const attrs: Record<string, string | number> = { 'stroke-dasharray': '6 4' };
    const axis = snap?.axis;
    const color = lockColor(snap);
    let cls = 'measure-rubber';
    if (color && (axis || snap!.kind === 'parallel' || snap!.inferred || snap!.locked)) {
      attrs.stroke = color;
      attrs['stroke-width'] = 2;
    }
    if (axis) {
      attrs['data-axis'] = axis;
      cls += ` measure-axis-${axis}`;
    }
    if (snap?.kind === 'parallel') cls += ' measure-parallel';
    if (snap?.inferred) cls += ' measure-perpendicular';
    if (snap?.locked) {
      delete attrs['stroke-dasharray'];
      attrs['stroke-width'] = 3;
      attrs['data-locked'] = snap.kind;
      cls += ' measure-locked';
    }
    this.segment(f, a, b, cls, attrs);
  }

  /**
   * 끌어온 점 표식(작은 +, 흰 테두리)과, 지금 추정이 끌어온 축이면 그 점에서 추정 점까지 점선(SketchUp "점에서" — 끌어온 점을 지나는 축이면 그 축 색,
   * 시작점 축 위 줄 맞춘 자리면 두 점을 잇는 선이 축과 나란할 때만 그 축 색, 아니면 글자 색). 그 축을 끌어온 점의 +는 크게 그 색으로.
   * 끌어온 축끼리의 교차면 둘째 끌어온 점에서도 그 축 색 점선을 긋고 그 점의 +도 크게 그 색으로.
   * 잠근 선이 끌어온 축과 만나는 점(lockTrack)이면 그 끌어온 점에서 그 축 색 점선(축으로 잠근 선 위 줄 맞춘 자리뿐이면 글자 색 — 코어 0.21.0 그리기와 같다)
   */
  private trackMarks(f: ViewFrame, live: Snap | null): void {
    const lt = live?.locked ? live.lockTrack : undefined;
    const from = lt ? lt.from : live?.kind === 'axis' ? live.trackFrom : undefined;
    const other = from && !lt ? live!.trackOther : undefined;
    let color = 'currentColor';
    if (from && live) {
      const axis = lt ? (lt.axis ?? null) : live.dir ? axisOf(sub(live.point, from), this.axes) : (live.axis ?? null);
      if (axis) color = AXIS_COLORS[axis];
      this.segment(f, from, live.point, 'measure-track-line', { stroke: color, 'stroke-width': 1.75, 'stroke-dasharray': '2 3', 'data-axis': axis ?? '' });
      if (other) this.segment(f, other.from, live.point, 'measure-track-line', { stroke: AXIS_COLORS[other.axis], 'stroke-width': 1.75, 'stroke-dasharray': '2 3', 'data-axis': other.axis });
    }
    for (const p of this.tracker.view) {
      const s = screenPoint(f, p, 20);
      if (!s) continue;
      const on1 = !!from && samePoint(p, from);
      const on2 = !on1 && !!other && samePoint(p, other.from);
      const on = on1 || on2;
      const r = on ? 6 : 4.5;
      const d = `M${s[0] - r},${s[1]}h${2 * r}M${s[0]},${s[1] - r}v${2 * r}`;
      const g = svgEl('g', { class: on ? 'measure-track is-from' : 'measure-track' });
      g.append(
        svgEl('path', { d, stroke: '#ffffff', 'stroke-width': on ? 4.5 : 3.5, 'stroke-linecap': 'round' }),
        svgEl('path', { d, stroke: on1 ? color : on2 ? AXIS_COLORS[other!.axis] : 'currentColor', 'stroke-width': on ? 2.25 : 1.5, 'stroke-linecap': 'round' }),
      );
      this.g.append(g);
    }
  }

  /** 잠근 선으로 옮겨 온 점: 커서 밑 점에서 잠근 선 위 점까지 가는 점선과 그 점의 작은 원 */
  private lockFrom(f: ViewFrame, s: Snap): void {
    const color = lockColor(s) ?? 'currentColor';
    this.segment(f, s.from!, s.point, 'measure-lock-from', { stroke: color, 'stroke-width': 1.25, 'stroke-dasharray': '2 3' });
    const p = screenPoint(f, s.from!, 20);
    if (p) this.g.append(svgEl('circle', { class: 'measure-lock-from-point', cx: p[0], cy: p[1], r: 3.5, fill: SNAP_COLORS[s.fromKind ?? 'endpoint'], stroke: '#ffffff', 'stroke-width': 1 }));
  }

  private dot(f: ViewFrame, p: readonly number[]): void {
    const s = screenPoint(f, p, 40);
    if (!s) return;
    this.g.append(svgEl('circle', { class: 'measure-point', cx: s[0], cy: s[1], r: 3.5, fill: 'currentColor', stroke: '#ffffff', 'stroke-width': 1 }));
  }

  /**
   * 추정 표식: 끝점 초록 원, 중간점 청록 원, 중심 초록 원과 십자, 교차점 빨강 ×, 수직 자홍 직각 표, 모서리 위 빨강 사각형, 면 위 파랑 마름모, 축 위 축 색 작은 사각형.
   * 축이 다른 선·면과 만나는 점은 글에 맞춰 끌어온 축끼리의 교차면 교차점(빨강 ×), 모서리·안내선과 만나면 모서리 위(빨강 사각형), 면을 뚫으면 면 위(파랑 마름모) —
   * 어느 축인지는 고무줄(시작점 축)·점선(끌어온 축) 색이 보인다. data-meet은 그 종류, 끌어온 축이면 data-track도 같은 값.
   * 잠근 선이 모서리·안내선과 만나는 점·면을 뚫는 점도 같은 표식(data-meet)에 잠금 고리를 두른다. 잠근 선이 끌어온 점의 축과 만나는 점은
   * 두 선이 만나는 점이라 교차점(빨강 × — data-meet·data-track 'track')이고, 축으로 잠근 선 위 줄 맞춘 자리뿐이면 잠근 선 위 표식 그대로다
   */
  private marker(f: ViewFrame, snap: Snap): void {
    const s = screenPoint(f, snap.point, 20);
    if (!s) return;
    const [x, y] = s;
    // 잠근 선 위 점은 잠근 선이 모서리·안내선과 만나는 점(lockEdge)·면을 뚫는 점(face)·끌어온 축과 만나는 점(lockTrack.axis)만 — 그 밖의 edge는 나란함·수직 잠금의 기준 모서리다
    const meet = snap.locked
      ? snap.lockEdge ? 'edge' : snap.face ? 'face' : snap.lockTrack?.axis ? 'track' : null
      : snap.kind === 'axis' ? (snap.trackFrom && snap.trackOther ? 'pair' : snap.edge ? 'edge' : snap.face ? 'face' : null) : null;
    const track = snap.trackFrom || snap.lockTrack ? meet : null;
    const kind: SnapKind = meet === 'pair' || meet === 'track' ? 'intersection' : meet === 'edge' ? 'onEdge' : meet === 'face' ? 'onFace' : snap.kind;
    const color = kind === 'axis' && snap.axis ? AXIS_COLORS[snap.axis] : SNAP_COLORS[kind];
    const base: Record<string, string | number> = { class: `measure-snap measure-snap-${snap.kind}`, 'data-kind': snap.kind, fill: color, stroke: '#ffffff', 'stroke-width': 1.25 };
    if (meet) base['data-meet'] = meet;
    if (track) base['data-track'] = track;
    let el: SVGElement;
    if (kind === 'endpoint' || kind === 'midpoint') el = svgEl('circle', { ...base, cx: x, cy: y, r: 5 });
    else if (kind === 'center') {
      el = svgEl('g', { class: base.class, 'data-kind': snap.kind });
      el.append(svgEl('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: '#ffffff', 'stroke-width': 3 }), svgEl('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: color, 'stroke-width': 1.75 }));
      el.append(svgEl('path', { d: `M${x - 3.5},${y}h7M${x},${y - 3.5}v7`, stroke: color, 'stroke-width': 1.5 }));
    } else if (kind === 'intersection') {
      // 교차점: 흰 테두리를 두른 빨강 ×(SketchUp 교차점 표식)
      const d = `M${x - 5},${y - 5}L${x + 5},${y + 5}M${x + 5},${y - 5}L${x - 5},${y + 5}`;
      el = svgEl('g', { class: base.class, 'data-kind': snap.kind, ...(meet ? { 'data-meet': meet } : {}), ...(track ? { 'data-track': track } : {}) });
      el.append(svgEl('path', { d, stroke: '#ffffff', 'stroke-width': 4.5, 'stroke-linecap': 'round' }), svgEl('path', { d, stroke: color, 'stroke-width': 2.25, 'stroke-linecap': 'round' }));
    } else if (kind === 'perpendicular') {
      // 직각 표(ㄴ 모양)
      el = svgEl('path', { class: base.class, 'data-kind': snap.kind, d: `M${x - 6},${y - 6}v12h12`, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    } else if (kind === 'onFace') el = svgEl('polygon', { ...base, points: `${x},${y - 6.5} ${x + 6.5},${y} ${x},${y + 6.5} ${x - 6.5},${y}` });
    else {
      const h = kind === 'onEdge' ? 4.5 : 3.5;
      el = svgEl('rect', { ...base, x: x - h, y: y - h, width: 2 * h, height: 2 * h });
    }
    this.g.append(el);
    // 잠근 추정: 표식에 고리(흰 테두리를 두른 잠근 선 색)
    if (snap.locked) {
      const ring = svgEl('g', { class: 'measure-lock-ring' });
      ring.append(
        svgEl('circle', { cx: x, cy: y, r: 9.5, fill: 'none', stroke: '#ffffff', 'stroke-width': 3.5, 'stroke-opacity': 0.85 }),
        svgEl('circle', { cx: x, cy: y, r: 9.5, fill: 'none', stroke: lockColor(snap) ?? color, 'stroke-width': 1.75 }),
      );
      this.g.append(ring);
    }
  }

  /** 각도기 원판(평면 위 원과 15° 눈금). 축 평면이면 그 축 색 */
  private disk(f: ViewFrame, center: readonly number[], normal: readonly number[], locked: boolean): void {
    const depth = viewDepth(f, center);
    if (f.projection === 'perspective' && !(depth > 0)) return;
    const R = worldPerPixel(f, depth) * PROTRACTOR_PX;
    const [u, v] = planeBasis(normal);
    const axis = axisOf(normal, this.axes);
    const color = axis ? AXIS_COLORS[axis] : 'currentColor';
    const at = (t: number, r: number): [number, number] | null => {
      const p = addScaled(addScaled(center, u, Math.cos(t) * r), v, Math.sin(t) * r);
      return screenPoint(f, p);
    };
    const pts: string[] = [];
    for (let i = 0; i < 48; i++) {
      const s = at((i / 48) * 2 * Math.PI, R);
      if (!s) return;
      pts.push(`${s[0].toFixed(1)},${s[1].toFixed(1)}`);
    }
    const g = svgEl('g', { class: locked ? 'measure-protractor is-locked' : 'measure-protractor', 'data-axis': axis ?? '' });
    g.append(svgEl('polygon', { points: pts.join(' '), fill: color, 'fill-opacity': 0.08, stroke: color, 'stroke-width': locked ? 2 : 1.25 }));
    let ticks = '';
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * 2 * Math.PI;
      const a = at(t, R * (i % 6 === 0 ? 0.72 : 0.86));
      const b = at(t, R);
      if (a && b) ticks += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    }
    if (ticks) g.append(svgEl('path', { d: ticks, fill: 'none', stroke: color, 'stroke-width': 1 }));
    this.g.append(g);
  }

  /** 각(중심 → a, 중심 → b 두 선과 그 사이 호), text가 있으면 호 가운데 바깥에 라벨 */
  private drawAngle(f: ViewFrame, c: readonly number[], a: readonly number[], b: readonly number[], n: readonly number[], text: string | null, result: boolean): void {
    if (result) {
      this.segment(f, c, a, 'measure-ray measure-result-line', { 'stroke-width': 2 });
      this.segment(f, c, b, 'measure-ray measure-result-line', { 'stroke-width': 2 });
      this.dot(f, c);
      this.dot(f, a);
      this.dot(f, b);
    }
    const depth = viewDepth(f, c);
    if (f.projection === 'perspective' && !(depth > 0)) return;
    const nn = unit(n);
    const ua = unit(addScaled(sub(a, c), nn, -dot(sub(a, c), nn)));
    const ub = unit(addScaled(sub(b, c), nn, -dot(sub(b, c), nn)));
    if (!dot(ua, ua) || !dot(ub, ub)) return;
    const theta = (planeAngle(ua, ub, nn) * Math.PI) / 180;
    // 호의 둘째 기저: ua에 수직이고 ub 쪽(반대 방향이면 법선 기준으로)
    let w = addScaled(ub, ua, -dot(ub, ua));
    w = dot(w, w) > 1e-12 ? unit(w) : unit(cross(nn, ua));
    const R = worldPerPixel(f, depth) * ARC_PX;
    const steps = Math.max(2, Math.ceil(theta / (Math.PI / 36)));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (theta * i) / steps;
      const s = screenPoint(f, addScaled(addScaled(c, ua, Math.cos(t) * R), w, Math.sin(t) * R));
      if (!s) return;
      d += `${i ? 'L' : 'M'}${s[0].toFixed(1)} ${s[1].toFixed(1)}`;
    }
    this.g.append(svgEl('path', { class: 'measure-arc', d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
    if (text) {
      const t = theta / 2;
      const s = screenPoint(f, addScaled(addScaled(c, ua, Math.cos(t) * R * 1.9), w, Math.sin(t) * R * 1.9));
      const sc = screenPoint(f, c);
      if (s) this.label(s[0], s[1], text, 'measure-label-angle', null, sc ? [{ x: sc[0], y: sc[1], r: LABEL_POINT_R }] : []);
    }
  }

  private drawTape(f: ViewFrame, r: TapeResult, text: string): void {
    this.segment(f, r.a, r.b, 'measure-result-line', { 'stroke-width': 2 });
    this.dot(f, r.a);
    this.dot(f, r.b);
    const s = screenSegment(f, r.a, r.b);
    if (s)
      this.label((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, text, 'measure-label-length', [[s[0], s[1]], [s[2], s[3]]], [
        { x: s[0], y: s[1], r: LABEL_POINT_R },
        { x: s[2], y: s[3], r: LABEL_POINT_R },
      ]);
  }
}

/** 캡처 단계 듣기(끄는 함수를 돌려준다) */
function capture(el: EventTarget, type: string, fn: (e: PointerEvent) => void): () => void {
  const h = fn as EventListener;
  el.addEventListener(type, h, true);
  return () => el.removeEventListener(type, h, true);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 방향 추론 선 색: 축은 그 축 색, 나란함·수직은 자홍. 방향 추론이 아니면 null */
function lockColor(s: Snap | null | undefined): string | null {
  if (!s) return null;
  if (s.axis) return AXIS_COLORS[s.axis];
  return s.kind === 'parallel' || s.kind === 'perpendicular' ? SNAP_COLORS[s.kind] : null;
}

/** 눈이 보는 방향 */
function forwardOf(f: ViewFrame): V3 {
  const b = f.basis.back;
  return [-b[0], -b[1], -b[2]];
}

function samePoint(a: readonly number[], b: readonly number[]): boolean {
  const d = Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  return d <= 1e-9 * Math.max(1, Math.hypot(a[0]!, a[1]!, a[2]!));
}

/** 안내선 gl과 점 p를 지나는 단위 방향 u의 직선이 같은 직선인지 */
function sameLine(gl: GuideLine, p: readonly number[], u: readonly number[]): boolean {
  if (Math.abs(dot(gl.dir, u)) < 1 - 1e-9) return false;
  const w = sub(p, gl.point);
  const r = addScaled(w, gl.dir, -dot(w, gl.dir));
  return Math.hypot(r[0], r[1], r[2]) <= 1e-9 * Math.max(1, Math.hypot(p[0]!, p[1]!, p[2]!), Math.hypot(gl.point[0], gl.point[1], gl.point[2]));
}
