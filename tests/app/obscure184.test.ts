// @vitest-environment jsdom
/**
 * 184차: 초점이 가려지지 않음(WCAG 2.4.11 최소). 넓은 화면(측정 띠를 쓰지 않는 화면)의 측정값 칸(styles.css `.vcb` — 3D 보기 오른쪽 아래 10px, z-index 3)과
 * 카메라 띠(`.measure-bar.cam-bar` — 3D 보기 아래 가운데 10px, z-index 3, 바탕 94% 불투명)가 같은 높이에 겹친다. 넓은 화면은 띠가 열린 채 줄자·각도기를 켠다
 * (43차 띠 닫기는 측정 띠를 쓰는 화면만이고, 걷기를 Esc로 끝내도 띠는 열린 채).
 * 좁은 창을 한 번 지나면 칸이 측정 띠 바로 뒤로 옮겨져(app.ts placeVcb) 띠가 DOM 뒤라 위 — 3D 보기 폭이 띠 폭 + 102px 아래면 길이 칸(아래 15~45px)이
 * 띠(아래 10~104px) 밑에 통째로 들고, 숫자를 치면 앱이 그 칸에 초점을 둔다(vcb.begin). 처음 차례면 거꾸로 칸이 띠 둘째 줄 버튼(아래 17~55px)의 아래 40px를 덮는다.
 * 고친 길(조이스틱 꼴 — refreshCamBar가 띠 높이를 재어 조이스틱을 띠 위에 둔다): 띠가 열려 있고 칸이 보이며 측정 띠 밖이면 칸 아래를 띠 높이 + 16px로(띠 위 6px 틈),
 * 아니면 인라인 자리를 지워 styles.css 자리 그대로. 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 실제 Vcb의 메서드를 부르고, 앱 원문이 두 자리에서 부르는지 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Vcb } from '../../src/app/vcb';

const APP = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
const CSS = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => {
  document.body.replaceChildren();
});

/** 그 선택자 하나만 받는 규칙 가운데 파일에서 처음 것(앞 규칙이 끝난 바로 뒤 — 미디어 질의 첫 규칙은 빠짐)의 본문 */
const rule = (sel: string): string =>
  CSS.match(new RegExp(`\\}\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`))?.[1] ?? '';

/** 앱 원문의 메서드 본문 */
const body = (name: string): string => {
  const at = APP.indexOf(`private ${name}(): void {`);
  return at < 0 ? '' : APP.slice(at, APP.indexOf('\n  }\n', at));
};

/** 3D 보기 칸 꼴(앱 처음 차례 — 측정 띠 · 카메라 띠 · 측정값 칸). 카메라 띠 높이는 손셈 94.4px → offsetHeight 94(닫히면 0) */
function stage(): { vcb: Vcb; camBar: HTMLElement; measureBar: HTMLElement; st: HTMLElement } {
  const st = document.body.appendChild(document.createElement('div'));
  st.className = 'stage';
  const measureBar = st.appendChild(document.createElement('div'));
  measureBar.className = 'measure-bar';
  const camBar = st.appendChild(document.createElement('div'));
  camBar.className = 'measure-bar cam-bar';
  Object.defineProperty(camBar, 'offsetHeight', { configurable: true, get: () => (camBar.hidden ? 0 : 94) });
  const vcb = new Vcb({ onSubmit: () => null, onClearGuides: () => {} });
  st.append(vcb.el);
  return { vcb, camBar, measureBar, st };
}

describe('카메라 띠와 측정값 칸(184차 — WCAG 2.4.11)', () => {
  it('카메라 띠가 열린 동안 넓은 화면 측정값 칸은 띠 위(띠 높이 + 16px) — DOM 차례가 어느 쪽이어도', () => {
    // 전제(styles.css): 칸과 띠는 같은 아래 10px·같은 z-index 3이고, 카메라 띠는 넓은 화면에서도 보인다
    expect(rule('.vcb')).toMatch(/bottom:\s*10px/);
    expect(rule('.vcb')).toMatch(/z-index:\s*3/);
    expect(rule('.measure-bar')).toMatch(/bottom:\s*10px/);
    expect(rule('.measure-bar')).toMatch(/z-index:\s*3/);
    expect(rule('.cam-bar:not([hidden])')).toMatch(/display:\s*flex/);
    const { vcb, camBar, measureBar, st } = stage();
    vcb.show(true);
    // 처음 차례(칸이 띠 뒤)와 좁은 창을 지난 차례(placeVcb가 칸을 측정 띠 바로 뒤로 — 띠가 칸 뒤)
    for (const flipped of [false, true]) {
      if (flipped) st.insertBefore(vcb.el, measureBar.nextSibling);
      vcb.liftAbove(camBar);
      // 칸(40px)은 아래 110~150px, 띠는 10~104px — 6px 틈(최근 측정 목록·잠글 방향 줄의 띠 위 틈과 같음)
      expect(vcb.el.style.bottom).toBe('110px');
    }
  });

  it('띠가 닫히거나 칸이 숨으면 인라인 자리를 지워 styles.css 자리(아래 10px) 그대로', () => {
    const { vcb, camBar } = stage();
    vcb.show(true);
    vcb.liftAbove(camBar);
    expect(vcb.el.style.bottom).toBe('110px');
    camBar.hidden = true;
    vcb.liftAbove(camBar);
    expect(vcb.el.style.bottom).toBe('');
    camBar.hidden = false;
    vcb.show(false);
    vcb.liftAbove(camBar);
    expect(vcb.el.style.bottom).toBe('');
  });

  it('측정 띠를 쓰는 화면(칸이 측정 띠 안)은 띠 안 자리 그대로 — 넓은 화면에서 올린 뒤 좁아져도 지움', () => {
    const { vcb, camBar, measureBar } = stage();
    vcb.show(true);
    vcb.liftAbove(camBar);
    expect(vcb.el.style.bottom).toBe('110px');
    // placeVcb: 측정 띠를 쓰는 화면은 칸을 띠 안 둘째 줄로(styles.css `.measure-bar .vcb` — relative, bottom auto)
    measureBar.append(vcb.el);
    vcb.liftAbove(camBar);
    expect(vcb.el.style.bottom).toBe('');
  });

  it('앱 원문: 칸 자리를 맞추는 곳(placeVcb — 보이기 뒤)과 카메라 띠를 맞추는 곳(refreshCamBar — 조이스틱 옆)에서 부른다', () => {
    const place = body('placeVcb');
    expect(place).toMatch(/this\.vcb\.liftAbove\(this\.els\.camBar\)/);
    expect(place.indexOf('this.vcb.show(show)')).toBeGreaterThan(-1);
    expect(place.indexOf('liftAbove')).toBeGreaterThan(place.indexOf('this.vcb.show(show)'));
    const cam = body('refreshCamBar');
    expect(cam).toMatch(/this\.vcb\.liftAbove\(e\.camBar\)/);
    expect(cam).toMatch(/this\.stick\.el\.style\.bottom/);
  });
});
