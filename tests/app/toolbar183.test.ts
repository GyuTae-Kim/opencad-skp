// @vitest-environment jsdom
/**
 * 183차: 보기 도구 막대(app.ts — `role=toolbar` 「보기 도구」)의 키보드 꼴(WAI-ARIA APG Toolbar — 막대 안 칸 사이를 ←·→로, Home·End는 처음·끝.
 * WCAG 2.1.1·2.4.3·4.1.2 — role이 약속한 키). 182차 손셈: 넓은 화면 Tab 멈춤 24칸·휴대폰 폭 7칸인데 막대 안을 화살표로 옮기는 길이 없었다
 * (←·→·Home·End는 아무 일도 하지 않음 — 걷는 동안·줄자·각도기를 켠 동안만 앱 창 키가 걷기·방향 잠금으로 씀).
 * 고친 길(기본 동작 그대로 — 키를 더하기만): Tab 멈춤은 버튼마다 그대로 두고(로빙 tabindex 없음), 막대 안 버튼에서 ←·→는 앞·다음 버튼, Home·End는 처음·끝 버튼(끝에서 돎).
 * 꺼진 버튼·그려지지 않은 버튼(hidden·좁은 화면에서 숨는 넓은 화면 전용 등 — 그려진 칸이 없음)은 건너뛰고, 화살표를 스스로 쓰는 단면 위치 막대는 옮길 곳이 아니며 그 안의 키는 그 막대 것.
 * 앱 창 키(onKey — 창 캡처)가 먼저 쓴 화살표(걷기·방향 잠금 — 기본 동작을 막고 전파를 멈춤)는 그대로 그쪽 것.
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 앱 원문 차례 그대로 지은 막대 꼴에 실제 kbd.ts `toolbarKeys`를 앱과 같은 꼴(막대 keydown)로 걸고,
 * 그리기는 styles.css 규칙대로 그려진 칸(getClientRects)을 흉내 내며(measure 시험 32차 꼴), 앱 원문이 그렇게 거는지 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolbarKeys } from '../../src/app/kbd';

const APP = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');

const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

const btn = (name: string, cls = '', off = false): string => `<button class="tbtn ${cls}"${off ? ' disabled' : ''}>${name}</button>`;
const SEP = '<span class="tsep" aria-hidden="true"></span>';
const MODES = ['음영', '음영+모서리', '무늬 없음', '단색', '숨은 선', '와이어프레임', 'X-ray'];

/**
 * 앱 원문(app.ts 보기 도구 막대) 차례 그대로의 막대 꼴 — 문서가 열린 화면(refreshToolbar: 카메라 기록이 없으면 이전·다음 보기가, 단면이 꺼져 있으면 위치 막대·뒤집기·채우기가 꺼짐).
 * 앱처럼 막대 keydown에 toolbarKeys를 건다
 */
function toolbar(sec = false): { bar: HTMLElement; range: HTMLInputElement } {
  const box = document.body.appendChild(document.createElement('div'));
  box.innerHTML =
    '<div class="toolbar" role="toolbar" id="view-tools" aria-label="보기 도구">' +
    `<div class="tgroup">${btn('전체 보기')}${btn('표준 뷰')}${btn('이전 보기', 'icon-only wide-only', true)}${btn('다음 보기', 'icon-only wide-only', true)}</div>${SEP}` +
    `<div class="tgroup seg wide-only" role="group" aria-label="투영">${btn('원근')}${btn('평행')}</div>${SEP}` +
    `<div class="tgroup seg wide-only" role="group" aria-label="그리기 방식">${MODES.map((m) => btn(m)).join('')}</div>${SEP}` +
    `<div class="tgroup compact wide-only">${btn('격자')}${btn('뷰 큐브')}${btn('좌표축')}${btn('배경')}</div>${SEP}` +
    `<div class="tgroup">${btn('줄자')}${btn('각도기')}${btn('그림 저장', 'compact wide-only')}</div>${SEP}` +
    `<div class="tgroup sec-group${sec ? ' sec-on' : ''}" role="group" aria-label="단면 보기">${btn('단면', 'narrow-only')}` +
    `<div class="tgroup seg wide-only">${btn('단면 끔', 'sec-off icon-only')}${btn('X', 'sec-axis')}${btn('Y', 'sec-axis')}${btn('Z', 'sec-axis')}</div>` +
    `<input class="sec-range" type="range" min="0" max="1000" step="1" value="500" aria-label="단면 위치"${sec ? '' : ' disabled'}>` +
    `${btn('뒤집기', 'icon-only sec-flip', !sec)}${btn('채우기', 'icon-only sec-fill', !sec)}</div>` +
    `${btn('보기 설정')}<span class="spacer"></span><div class="tgroup">${btn('패널')}</div></div>`;
  const bar = box.firstElementChild as HTMLElement;
  bar.addEventListener('keydown', (e) => toolbarKeys(e, bar));
  return { bar, range: bar.querySelector('input')! };
}

/**
 * 그리기(styles.css): [hidden]은 늘 숨김(75줄), 넓은 화면은 `.toolbar .narrow-only` 숨김(1643줄), 휴대폰 폭(760px 미만 — 2073줄)은 `.toolbar .wide-only` 숨김·
 * 단면이 꺼진 동안 위치 막대·뒤집기 숨김·채우기 늘 숨김. 그려진 칸이 없으면 getClientRects가 빈 목록(브라우저와 같음)
 */
function paint(phone: boolean): void {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const hide =
      !!this.closest('[hidden]') ||
      !!this.closest(
        phone
          ? '.toolbar .wide-only, .sec-group .sec-fill, .sec-group:not(.sec-on) .sec-range, .sec-group:not(.sec-on) .sec-flip'
          : '.toolbar .narrow-only',
      );
    return (hide ? [] : [{ width: 36, height: 32 }]) as unknown as DOMRectList;
  });
}

const nameOf = (el: Element | null): string => el?.getAttribute('aria-label') ?? el?.textContent ?? '';
const byName = (bar: HTMLElement, name: string): HTMLElement => [...bar.querySelectorAll<HTMLElement>('button, input')].find((el) => nameOf(el) === name)!;
/** Tab 멈춤(꺼지지 않고 그려진 칸 — 막대에 tabindex가 없어 DOM 차례) */
const stops = (bar: HTMLElement): string[] =>
  [...bar.querySelectorAll<HTMLElement>('button, input')].filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0).map(nameOf);
/** 지금 초점에서 같은 키를 n번 — 옮겨 간 칸 이름들 */
const press = (k: string, n: number): string[] => {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) {
    expect(key(document.activeElement!, k).defaultPrevented).toBe(true);
    seen.push(nameOf(document.activeElement));
  }
  return seen;
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('보기 도구 막대의 ←·→·Home·End(183차 — WAI-ARIA APG Toolbar, Tab 차례 그대로)', () => {
  it('넓은 화면(문서가 열린 화면 — 카메라 기록·단면 없음): Tab 멈춤 24칸 그대로, 버튼에서 →·←는 다음·앞 보이는 버튼(꺼진 이전·다음 보기·위치 막대·뒤집기·채우기와 넓은 화면에서 숨는 단면 메뉴 버튼은 건너뜀), Home·End는 처음·끝, 끝에서 돎', () => {
    expect(typeof toolbarKeys).toBe('function');
    paint(false);
    const { bar } = toolbar();
    const WIDE = ['전체 보기', '표준 뷰', '원근', '평행', ...MODES, '격자', '뷰 큐브', '좌표축', '배경', '줄자', '각도기', '그림 저장', '단면 끔', 'X', 'Y', 'Z', '보기 설정', '패널'];
    expect(WIDE).toHaveLength(24);
    expect(stops(bar)).toEqual(WIDE);
    byName(bar, '전체 보기').focus();
    expect(press('ArrowRight', 24)).toEqual([...WIDE.slice(1), '전체 보기']);
    expect(press('ArrowLeft', 2)).toEqual(['패널', '보기 설정']);
    expect(press('Home', 1)).toEqual(['전체 보기']);
    expect(press('End', 1)).toEqual(['패널']);
    byName(bar, 'Z').focus();
    expect(press('ArrowRight', 1)).toEqual(['보기 설정']);
    byName(bar, '원근').focus();
    expect(press('ArrowLeft', 1)).toEqual(['표준 뷰']);
    // Tab 차례는 그대로: 막대 안에 tabindex를 두지 않는다(옮긴 뒤에도 Tab 멈춤 24칸 — 로빙 tabindex 아님)
    expect(bar.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(stops(bar)).toEqual(WIDE);
  });

  it('휴대폰 폭: Tab 멈춤 7칸(단면을 켜면 위치 막대·뒤집기를 더해 9칸) 그대로, 화살표는 넓은 화면 전용 버튼(이전·다음 보기·투영·그리기 방식·격자 묶음·그림 저장·단면 축)과 휴대폰에서 숨는 채우기를 건너뛴다', () => {
    expect(typeof toolbarKeys).toBe('function');
    paint(true);
    const { bar } = toolbar();
    const PHONE = ['전체 보기', '표준 뷰', '줄자', '각도기', '단면', '보기 설정', '패널'];
    expect(stops(bar)).toEqual(PHONE);
    byName(bar, '전체 보기').focus();
    expect(press('ArrowRight', 7)).toEqual([...PHONE.slice(1), '전체 보기']);
    expect(press('ArrowLeft', 1)).toEqual(['패널']);
    expect(press('Home', 1)).toEqual(['전체 보기']);
    expect(press('End', 1)).toEqual(['패널']);
    document.body.innerHTML = '';
    const on = toolbar(true);
    expect(stops(on.bar)).toEqual(['전체 보기', '표준 뷰', '줄자', '각도기', '단면', '단면 위치', '뒤집기', '보기 설정', '패널']);
    byName(on.bar, '단면').focus();
    expect(press('ArrowRight', 2)).toEqual(['뒤집기', '보기 설정']);
    expect(press('ArrowLeft', 2)).toEqual(['뒤집기', '단면']);
    expect(on.bar.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('단면 위치 막대 안의 ←·→·Home·End는 그 막대 것(막지 않고 초점 그대로 — 브라우저가 값을 바꿈), ↑·↓·조합 키·Enter도 그대로, 앱 창 키가 먼저 쓴 화살표(걷기·줄자·각도기 방향 잠금)도 그대로', () => {
    expect(typeof toolbarKeys).toBe('function');
    paint(false);
    const { bar, range } = toolbar(true);
    range.focus();
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(key(range, k).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(range);
    }
    const fit = byName(bar, '전체 보기');
    fit.focus();
    const others: [string, KeyboardEventInit][] = [
      ['ArrowDown', {}],
      ['ArrowUp', {}],
      ['ArrowRight', { altKey: true }],
      ['ArrowRight', { ctrlKey: true }],
      ['ArrowRight', { metaKey: true }],
      ['Enter', {}],
    ];
    for (const [k, init] of others) {
      expect(key(fit, k, init).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(fit);
    }
    // 앱 창 키(onKey — 창 keydown 캡처)가 쓴 화살표: 기본 동작을 막고 전파를 멈춘다(걷기 v.handleKey·방향 잠금 keypick.handleKey) — 막대는 받지 않는다
    const app = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', app, true);
    key(fit, 'ArrowRight');
    expect(document.activeElement).toBe(fit);
    window.removeEventListener('keydown', app, true);
    // 기본 동작만 막은 사건도 그대로
    const prevent = (e: KeyboardEvent): void => e.preventDefault();
    window.addEventListener('keydown', prevent, true);
    key(fit, 'ArrowRight');
    expect(document.activeElement).toBe(fit);
    window.removeEventListener('keydown', prevent, true);
    // 막대 밖 초점(3D 보기 캔버스 등)은 막대 길 밖
    const canvas = document.body.appendChild(document.createElement('canvas'));
    canvas.tabIndex = 0;
    canvas.focus();
    expect(key(canvas, 'ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(canvas);
  });

  it('앱 원문: 보기 도구 막대 keydown에 kbd.ts toolbarKeys를 걸고, 막대 안에 tabindex·로빙을 두지 않는다(Tab 차례 그대로 — 로빙 tabindex는 다음 후보)', () => {
    expect(APP).toMatch(/import \{[^}]*\btoolbarKeys\b[^}]*\} from '\.\/kbd';/);
    expect(APP).toContain("toolbar.addEventListener('keydown', (e) => toolbarKeys(e, toolbar));");
    const block = APP.slice(APP.indexOf("{ class: 'toolbar', role: 'toolbar'"), APP.indexOf('// 가운데'));
    expect(block).toContain("toolbar.addEventListener('keydown'");
    expect(block).not.toMatch(/tabindex|tabIndex|rove\(/);
  });
});
