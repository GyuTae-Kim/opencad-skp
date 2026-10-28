/**
 * 측정 도구의 작은 글·키 규칙(첫 화면 JS에 남는다): 도구 이름, 안내 두기 키(Ctrl·Option), 잠금 안내.
 * 앱 화면(app.ts)은 측정 도구 조각(measure.ts·snap.ts — 문서를 열 때 나눠 받는다, core.ts loadMeasure)을 받기 전에도
 * 이것으로 키를 고르고 상태를 적는다. measure.ts가 그대로 다시 내보낸다.
 */
import type { Axis, InferenceLock } from './snap';

export type MeasureMode = 'tape' | 'protractor';

/** 안내 두기를 켜고 끄는 키(KeyboardEvent.key): Windows·Linux는 Control, Mac은 Alt(Option) — SketchUp 줄자·각도기와 같다 */
export type GuideKey = 'Control' | 'Alt';

/** 안내에 보이는 키 이름 */
export const GUIDE_KEY_NAMES: Readonly<Record<GuideKey, string>> = Object.freeze({ Control: 'Ctrl', Alt: 'Option' });

/** 플랫폼 글(navigator.userAgentData.platform·navigator.platform)로 안내 두기 키를 고른다: Apple 기기는 Option */
export function guideKeyFor(platform: string | null | undefined): GuideKey {
  return /mac|iphone|ipad|ipod/i.test(platform ?? '') ? 'Alt' : 'Control';
}

/**
 * 안내 두기 키 안내(키보드 기기, 점을 찍기 전): "Ctrl: 안내 두기"·"Ctrl: 안내 두기 끄기". 손가락 기기는 측정 띠 단추라 null.
 * 상태 줄·측정 띠는 measureHint 다음에 따로 둔다(번역이 "{0}: 안내 두기" 틀로 키 이름을 그대로 끼운다)
 */
export function guideKeyHint(mode: MeasureMode | null, points: number, guide: boolean, key: GuideKey = 'Control', touch = false): string | null {
  if (!mode || points || touch) return null;
  return `${GUIDE_KEY_NAMES[key]}: ${guide ? '안내 두기 끄기' : '안내 두기'}`;
}

/** 면에 수직 추정 글(모서리에 수직은 SNAP_LABELS.perpendicular) — snap.ts가 추정에 붙이고 lockName이 알아본다 */
export const FACE_PERPENDICULAR_LABEL = '면에 수직';

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
