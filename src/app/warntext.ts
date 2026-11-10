/**
 * 해석기 경고·오류 글을 화면에 보일 때 파일 글을 가르는 꼴(53차 — DOM·번역 없음). 정보 탭 경고 칸(infotab.ts)과 해석 워커의 알림(worker/notice.ts)만 써서
 * 첫 화면 JS에 두지 않는다. 해석기가 내는 글(scene.warnings)은 그대로 두고, 화면 번역층이 사전 틀이 맞지 않아 글을 조각내 옮길 때 끝에 붙은 이름 조각
 * ("재질 파일을 읽지 못했습니다: materials/무늬 · 면 · 이/material.xml"의 "면")까지 바꾸던 것을 막는다.
 */
import type { SceneIssue, SceneIssueCode } from 'opencad-viewer3d';
import { fileText, type Mixed } from './filetext';
import { fmtCount } from './format';

/**
 * 3D 뷰어 코어가 장면을 받으며 빼거나 고쳐 그린 깨진 입력(코어 0.50.0 SceneIssue — 54차)의 정보 탭 경고 줄 글.
 * 코어 기본 글(sceneIssueText)은 항목 id·필드 이름을 넣는데 화면에서 쓸 데가 없어, 무엇을 했는지와 수만 적은 앱 글(사전 열쇠 — {0}은 수)을 쓴다
 */
export const CORE_ISSUE_TEXT: Readonly<Record<SceneIssueCode, string>> = {
  bounds: '3D 보기: 장면 범위가 깨져 형상에서 다시 셌습니다',
  placement: '3D 보기: 놓을 자리(원점·변환)가 깨진 형상 묶음을 그리지 않았습니다',
  billboard: '3D 보기: 카메라를 보는 형상 묶음의 기준점이 깨져 돌리지 않고 그렸습니다',
  positions: '3D 보기: 좌표가 깨진 정점 {0}개를 쓰는 도형을 그리지 않았습니다',
  indices: '3D 보기: 정점 번호가 깨진 삼각형 {0}개를 그리지 않았습니다',
  length: '3D 보기: 길이가 맞지 않는 형상 배열의 남는 값 {0}개를 쓰지 않았습니다',
  normals: '3D 보기: 법선 수가 맞지 않는 형상 묶음을 평면 음영으로 그렸습니다',
  colors: '3D 보기: 정점 색이 깨진 형상 묶음을 한 색으로 칠했습니다',
  uvs: '3D 보기: 무늬 좌표 수가 맞지 않는 형상 묶음을 무늬 없이 칠했습니다',
  color: '3D 보기: 색이 깨진 형상 묶음을 기본색으로 칠했습니다',
  material: '3D 보기: 재질 값이 깨진 형상 묶음에 기본값을 썼습니다',
  width: '3D 보기: 굵기가 깨진 선 묶음을 1화소 굵기로 그렸습니다',
  size: '3D 보기: 크기가 깨진 점 묶음을 4화소 크기로 그렸습니다',
  ids: '3D 보기: 고르기 번호가 {0}개 모자란 묶음은 뒤쪽을 배열 차례로 고릅니다',
  'duplicate-id': '3D 보기: 같은 이름의 형상 묶음이 또 있어 이름으로 찾는 기능은 하나만 봅니다',
};

/** 코어 입력 알림 하나 → 경고 줄 글(한국어 — 화면이 사전 틀로 옮긴다. 코어가 알림 종류를 늘리면 위 표가 typecheck에서 걸린다) */
export function coreIssueText(i: Pick<SceneIssue, 'code' | 'count'>): string {
  return CORE_ISSUE_TEXT[i.code].replace('{0}', fmtCount(i.count));
}

/** 해석기 경고·오류 글에서 꾸러미 항목 이름(재질·스타일 폴더 이름이 든 경로 — 파일 글)이 끝에 붙는 앞 글(src/index.ts·zip.ts·range.ts) */
const ITEM_HEAD = /(?:스타일 파일이 너무 커서 건너뛰었습니다|스타일 파일을 읽지 못했습니다|재질 파일을 읽지 못했습니다|ZIP 항목이 잘렸습니다|ZIP 지역 머리가 깨졌습니다|지원하지 않는 ZIP 압축 방식 \d+): /;

/**
 * 해석기 까닭 글(던진 오류의 글 — 그 자체가 사전 열쇠·틀 글)을 끝이나 괄호 안에 이어 붙이는 경고 머리(src/index.ts·mfcmodel.ts).
 * 사전 틀("SketchUp 파일을 읽지 못했습니다: {0}")의 {0}은 번역기가 그대로 끼우므로 까닭 글이 다른 언어 화면에서도 한국어로 남았다(59차)
 */
const REASON_HEAD =
  /^(?:SketchUp 파일을 읽지 못했습니다: |SketchUp 꾸러미\(ZIP\)가 깨졌습니다: |장면을 만들지 못했습니다: |형상을 읽다 멈췄습니다 — 그 앞까지만 그립니다: |형상 뒤의 장면·스타일을 읽지 못했습니다\(형상은 다 읽었습니다\): |model\.dat를 끝까지 풀지 못해 앞부분만 읽었습니다\(|장면 목록을 풀지 못했습니다\()/;
const HANGUL = /[가-힣]/;

/**
 * 해석기 경고·오류 글 → 섞은 글: 끝에 붙은 꾸러미 항목 이름은 파일 글로(예: "재질 파일을 읽지 못했습니다: materials/<재질 폴더>/material.xml").
 * 괄호 안 까닭 글(…읽었습니다(ZIP 항목이 잘렸습니다: model.dat))이면 닫는 괄호는 앱 글로 둔다.
 * 59차: 앞 글에 이어 붙은 해석기 까닭 글(REASON_HEAD 뒤)은 앱 글 조각(ui)으로 두어 따로 옮긴다 — 까닭 글 안의 틀({0}({1}바이트 자리) 등)까지 화면 언어로.
 * 까닭 글 끝의 꾸러미 항목 이름에 한글이 있으면(옮길 때 이름 조각까지 바뀔 수 있다) 예전처럼 이름을 파일 글로 가른다
 */
export function warningParts(text: string): Mixed {
  const r = REASON_HEAD.exec(text);
  if (r) {
    const head = r[0];
    const close = head.endsWith('(') && text.endsWith(')') ? ')' : '';
    const reason = text.slice(head.length, text.length - close.length);
    const item = ITEM_HEAD.exec(reason);
    if (reason && !(item && HANGUL.test(reason.slice(item.index + item[0].length)))) return close ? [head, { file: reason, ui: true }, close] : [head, { file: reason, ui: true }];
  }
  const m = ITEM_HEAD.exec(text);
  if (!m) return [text];
  const head = text.slice(0, m.index + m[0].length);
  let name = text.slice(head.length);
  let tail = '';
  if (name.endsWith(')') && head.split('(').length > head.split(')').length) {
    name = name.slice(0, -1);
    tail = ')';
  }
  if (!name) return [text];
  return tail ? [head, fileText(name), tail] : [head, fileText(name)];
}
