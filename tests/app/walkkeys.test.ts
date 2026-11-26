/**
 * 바로 가기 안내의 걷기 위·아래 줄(142차): 안내에 적은 키가 적은 차례대로 코어 걷기를 움직이는지 가짜 WebGL2 위 실제 코어 뷰어로 본다.
 * 안내는 「앞 · 뒤로」(W, S, ↑, ↓) 줄처럼 키와 글을 차례로 짝짓는다 — 짝수 차례가 위, 홀수 차례가 아래.
 * 코어 걷기(0.7.0 setNavigation('walk'))는 E·PageUp이 위, Q·PageDown이 아래다. 141차까지 안내는 Q, E 차례로 "위 · 아래로"라 Q를 위로 읽혔고
 * (네 언어 사전도 같은 차례), 걷는 중 위·아래가 되는 PageUp·PageDown(keys.ts — 장면 넘기기 대신 코어로)은 걷기 묶음에 없었다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { keyAction } from '../../src/app/keys';
import { SHORTCUTS } from '../../src/app/shortcuts';
import { type FakeElement, installDom } from '../fakegl/fakedom';
import { rowDoc } from './rowdoc';

let dom: ReturnType<typeof installDom>;
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  dom.restore();
});

/** 걷기(중력·부딪힘 끔 — 코어 기본)에서 키 하나를 누른 채 한 그림 → 대상점 높이(z)가 바뀐 양 */
function walkRise(label: string): number {
  const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: true, viewCube: false, grid: false });
  try {
    v.setScene(rowDoc().scene);
    v.setNavigation('walk');
    v.renderNow();
    const z0 = v.getCamera().target[2];
    // 안내의 글자 키는 대문자(E·Q), 코어는 key를 소문자로 본다(code가 없을 때)
    (v.canvas as unknown as FakeElement).fire('keydown', { key: label.length === 1 ? label.toLowerCase() : label, defaultPrevented: false });
    v.renderNow();
    return v.getCamera().target[2] - z0;
  } finally {
    v.dispose();
  }
}

describe('바로 가기 안내 — 걷기 위·아래 키(142차)', () => {
  it('「위 · 아래로」 줄의 키는 적은 차례대로 코어 걷기가 오르내린다(E·PageUp 위, Q·PageDown 아래) — 걷는 중 PageUp·PageDown은 코어로', () => {
    const walk = SHORTCUTS.find((g) => g.title === '걷기(1인칭)')!;
    const row = walk.items.find((it) => it.label.startsWith('위 · 아래로'))!;
    // 짝수 차례는 위, 홀수 차례는 아래(「앞 · 뒤로」 줄과 같은 짝짓기)
    row.keys.forEach((k, i) => expect(Math.sign(walkRise(k)), k).toBe(i % 2 === 0 ? 1 : -1));
    expect(row.keys).toEqual(['E', 'Q', 'PageUp', 'PageDown']);
    // 걷는 중 PageUp·PageDown은 장면 넘기기 대신 코어 걷기로(장면이 있는 문서에서도)
    for (const k of ['PageUp', 'PageDown']) expect(keyAction({ key: k, hasDoc: true, hasPages: true, walking: true }), k).toEqual({ kind: 'viewer' });
  });
});
