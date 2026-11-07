/**
 * 일부만 읽은 파일의 알림 글(41차 — 해석 워커가 결과와 함께 보낸다, ParseResult.notice). 40차까지는 화면(app.ts noticeDamage)이 만들었다.
 * 파일을 연 뒤에만 쓰는 글이라 첫 화면 JS에 두지 않고 워커 조각에 둔다. 잘렸거나 깨진 파일·한도에 걸린 모형의 글은 예전과 같고,
 * 글로 한 번 저장되며 깨진 옛 판 파일을 고쳐 읽었으면(mfcmend.ts — 40차) "일부만 보입니다" 대신 고쳐 읽었다고 알린다
 * (고쳐 읽고도 잘리거나 멈추거나 건너뛴 곳이 남았으면 예전처럼 일부만 보인다고).
 * 53차: 파일 이름과 경고 끝의 꾸러미 항목 이름은 파일 글 자리로 둔다(filetext.ts — 사전 틀이 맞지 않아 글을 조각내 옮겨도 이름은 그대로).
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import { fileText, mix } from '../app/filetext';
import type { EmptyNotice, ParseNotice } from '../app/protocol';
import { warningParts } from '../app/warntext';

/** 고쳐 읽은 파일의 경고 머리(src/mfcmodel.ts finishPass가 적는 글 — 시험이 실제로 고쳐 읽은 장면으로 본다) */
export const MENDED_HEAD = '글로 한 번 저장되며 깨진 파일을 고쳐 읽었습니다';

/** 장면의 손상·한도 표시(meta.damaged·meta.limited)와 경고 → 알림(없으면 null). name은 화면이 보이는 파일 이름 */
export function damageNotice(scene: Pick<Scene3d, 'warnings' | 'meta'>, name: string): ParseNotice | null {
  const warns = scene.warnings ?? [];
  const meta = scene.meta ?? {};
  if (meta.damaged === true) {
    const why = warns.find((w) => /잘렸|깨져|깨진/.test(w)) ?? warns[0] ?? '';
    if (why.startsWith(MENDED_HEAD) && !warns.some((w) => w !== why && /잘렸|깨져|깨진|멈췄|읽지 못했|건너뛰었/.test(w)))
      return { title: mix`"${fileText(name)}" 파일을 고쳐 읽었습니다`, text: warningParts(why) };
    return { title: mix`"${fileText(name)}" 파일의 일부만 보입니다`, text: ['파일이 잘렸거나 깨진 곳이 있어 읽을 수 있는 부분만 그렸습니다. ', ...warningParts(why)] };
  }
  if (meta.limited === true) return { title: ['모형이 너무 커서 일부만 그렸습니다'], text: warningParts(warns.find((w) => /한도/.test(w)) ?? '') };
  return null;
}

/**
 * 그릴 것이 없는 장면의 알림. 해석기가 까닭(경고)을 남겼거나 깨진 파일이면 "열지 못했습니다"와 첫 경고,
 * 깨지지 않은 SketchUp 파일인데 형상이 없으면 빈 모형이라고 알린다(SketchUp도 빈 화면으로 연다 —
 * 정의만 있고 놓인 것이 없으면 그 수를 함께). 53차: 52차까지 화면(app/protocol.ts)이 만들던 것을 위 알림처럼 워커로 옮기고(첫 화면 JS에서 뺀다),
 * 파일 이름·경고 끝의 꾸러미 항목 이름은 파일 글 자리로 둔다
 */
export function emptySceneNotice(s: Pick<Scene3d, 'warnings' | 'meta'>, name: string): EmptyNotice {
  const meta = (s.meta ?? {}) as { damaged?: boolean; version?: string; definitions?: number };
  const why = s.warnings?.[0];
  if (why || meta.damaged || !meta.version)
    return { kind: 'error', title: mix`"${fileText(name)}" 파일을 열지 못했습니다`, text: why ? warningParts(why) : ['그릴 면이나 모서리를 찾지 못했습니다.'] };
  const defs = meta.definitions ?? 0;
  return {
    kind: 'info',
    title: mix`"${fileText(name)}" 모형이 비어 있습니다`,
    text: [
      defs
        ? `SketchUp 파일은 맞지만 모형에 놓인 형상이 없습니다(컴포넌트 정의 ${defs.toLocaleString('en-US')}개는 있지만 하나도 놓이지 않았습니다).`
        : 'SketchUp 파일은 맞지만 그릴 면·모서리가 없습니다. SketchUp에서 형상을 넣고 저장했는지 확인해 주세요.',
    ],
  };
}
