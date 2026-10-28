/**
 * 측정 도구의 작은 키 규칙(첫 화면 JS에 남는다): 도구 이름, 안내 두기 키(Ctrl·Option).
 * 앱 화면(app.ts)은 측정 도구 조각(measure.ts·snap.ts — 문서를 열 때 나눠 받는다, core.ts loadMeasure)을 받기 전에도
 * 이것으로 키를 고른다. measure.ts가 그대로 다시 내보낸다.
 * 잠금·안내 두기 키 안내 글(lockHint·guideKeyHint)과 잠근 방향 이름(lockName)은 도구를 켠 뒤에만 쓰므로 측정 도구 조각(measure.ts)에 둔다
 * (앱은 tool.lockHintText·tool.lockName으로 읽는다).
 */
export type MeasureMode = 'tape' | 'protractor';

/** 안내 두기를 켜고 끄는 키(KeyboardEvent.key): Windows·Linux는 Control, Mac은 Alt(Option) — SketchUp 줄자·각도기와 같다 */
export type GuideKey = 'Control' | 'Alt';

/** 플랫폼 글(navigator.userAgentData.platform·navigator.platform)로 안내 두기 키를 고른다: Apple 기기는 Option */
export function guideKeyFor(platform: string | null | undefined): GuideKey {
  return /mac|iphone|ipad|ipod/i.test(platform ?? '') ? 'Alt' : 'Control';
}
