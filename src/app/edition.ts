/**
 * SketchUp 판 번호·제품 이름과 아직 읽지 못하는 옛 판 판정(순수 함수 — 62차에 doc.ts에서 옮겼다, doc.ts가 다시 내보낸다).
 * 해석 워커가 옛 판 알림(worker/notice.ts unsupportedNotice — 첫 화면 JS에서 뺀 글)을 만들 때 doc.ts 전체를 워커에 싣지 않으려고 따로 둔다.
 */
import type { Scene3d } from 'opencad-viewer3d/types';

/** 판 문자열의 주 번호("26.1.194" → 26) */
export function majorOf(version: string | null | undefined): number | null {
  const m = /^(\d+)\./.exec(version ?? '');
  return m ? Number(m[1]) : null;
}

/** 판 → 제품 이름("26.1.194" → "SketchUp 2026", "8.0.1" → "SketchUp 8") */
export function releaseName(version: string | null | undefined): string {
  const major = majorOf(version);
  if (major === null) return 'SketchUp';
  return major >= 13 ? `SketchUp 20${String(major).padStart(2, '0')}` : `SketchUp ${major}`;
}

/**
 * 아직 읽지 못하는 아주 옛 판(SketchUp 3보다 옛 판)이면 판 문자열, 아니면 null.
 * 해석기가 거절한 파일(meta.unsupported)이거나 판 번호가 3보다 낮으면 그렇다. 3·4·5·6·7·8·2013~2020은 읽는다.
 */
export function unsupportedVersion(scene: Scene3d): string | null {
  const m: Record<string, unknown> = scene.meta && typeof scene.meta === 'object' ? scene.meta : {};
  const version = typeof m.version === 'string' ? m.version : null;
  const major = majorOf(version);
  if (m.unsupported === true || (major !== null && major < 3)) return version ?? '알 수 없음';
  return null;
}
