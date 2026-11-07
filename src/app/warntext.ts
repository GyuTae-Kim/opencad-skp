/**
 * 해석기 경고·오류 글을 화면에 보일 때 파일 글을 가르는 꼴(53차 — DOM·번역 없음). 정보 탭 경고 칸(infotab.ts)과 해석 워커의 알림(worker/notice.ts)만 써서
 * 첫 화면 JS에 두지 않는다. 해석기가 내는 글(scene.warnings)은 그대로 두고, 화면 번역층이 사전 틀이 맞지 않아 글을 조각내 옮길 때 끝에 붙은 이름 조각
 * ("재질 파일을 읽지 못했습니다: materials/무늬 · 면 · 이/material.xml"의 "면")까지 바꾸던 것을 막는다.
 */
import { fileText, type Mixed } from './filetext';

/** 해석기 경고·오류 글에서 꾸러미 항목 이름(재질·스타일 폴더 이름이 든 경로 — 파일 글)이 끝에 붙는 앞 글(src/index.ts·zip.ts·range.ts) */
const ITEM_HEAD = /(?:스타일 파일이 너무 커서 건너뛰었습니다|스타일 파일을 읽지 못했습니다|재질 파일을 읽지 못했습니다|ZIP 항목이 잘렸습니다|ZIP 지역 머리가 깨졌습니다|지원하지 않는 ZIP 압축 방식 \d+): /;

/**
 * 해석기 경고·오류 글 → 섞은 글: 끝에 붙은 꾸러미 항목 이름은 파일 글로(예: "재질 파일을 읽지 못했습니다: materials/<재질 폴더>/material.xml").
 * 괄호 안 까닭 글(…읽었습니다(ZIP 항목이 잘렸습니다: model.dat))이면 닫는 괄호는 앱 글로 둔다
 */
export function warningParts(text: string): Mixed {
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
