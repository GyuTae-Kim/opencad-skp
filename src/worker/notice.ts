/**
 * 일부만 읽은 파일의 알림 글(41차 — 해석 워커가 결과와 함께 보낸다, ParseResult.notice). 40차까지는 화면(app.ts noticeDamage)이 만들었다.
 * 파일을 연 뒤에만 쓰는 글이라 첫 화면 JS에 두지 않고 워커 조각에 둔다. 잘렸거나 깨진 파일·한도에 걸린 모형의 글은 예전과 같고,
 * 글로 한 번 저장되며 깨진 옛 판 파일을 고쳐 읽었으면(mfcmend.ts — 40차) "일부만 보입니다" 대신 고쳐 읽었다고 알린다
 * (고쳐 읽고도 잘리거나 멈추거나 건너뛴 곳이 남았으면 예전처럼 일부만 보인다고).
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { ParseNotice } from '../app/protocol';

/** 고쳐 읽은 파일의 경고 머리(src/mfcmodel.ts finishPass가 적는 글 — 시험이 실제로 고쳐 읽은 장면으로 본다) */
export const MENDED_HEAD = '글로 한 번 저장되며 깨진 파일을 고쳐 읽었습니다';

/** 장면의 손상·한도 표시(meta.damaged·meta.limited)와 경고 → 알림(없으면 null). name은 화면이 보이는 파일 이름 */
export function damageNotice(scene: Pick<Scene3d, 'warnings' | 'meta'>, name: string): ParseNotice | null {
  const warns = scene.warnings ?? [];
  const meta = scene.meta ?? {};
  if (meta.damaged === true) {
    const why = warns.find((w) => /잘렸|깨져|깨진/.test(w)) ?? warns[0] ?? '';
    if (why.startsWith(MENDED_HEAD) && !warns.some((w) => w !== why && /잘렸|깨져|깨진|멈췄|읽지 못했|건너뛰었/.test(w))) return { title: `"${name}" 파일을 고쳐 읽었습니다`, text: why };
    return { title: `"${name}" 파일의 일부만 보입니다`, text: `파일이 잘렸거나 깨진 곳이 있어 읽을 수 있는 부분만 그렸습니다. ${why}` };
  }
  if (meta.limited === true) return { title: '모형이 너무 커서 일부만 그렸습니다', text: warns.find((w) => /한도/.test(w)) ?? '' };
  return null;
}
