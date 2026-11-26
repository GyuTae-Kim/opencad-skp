// @vitest-environment jsdom
/**
 * 158차: 앱 창 키(app.ts onKey — 창 keydown 캡처)가 스스로 키를 쓰는 위젯의 키를 먼저 가져가는지 감사(157차 언어 메뉴 꼴).
 * 막대(input range)·창 가르개(role=separator)·장면 탭·패널 탭(role=tablist)·나무(role=tree)·메뉴(role=menu)의 APG 키는 이미 거른다(inList·157차 menuKey).
 * 그림 저장 창(role=dialog — exporter.ts)의 Esc만 거르지 않아, 줄자·각도기를 켠 동안이면 Esc가 창을 닫지 않고 잰 결과를 지웠고(다음 Esc는 도구 끄기),
 * 걷는 중이면 걷기 끝, 고른 안내가 있으면 안내 풀기로 가 전파를 막았다(아무 상태가 없어도 창을 닫으며 고른 것을 지움).
 * 158차: keys.ts menuKey가 대화 상자(role=dialog) 안의 Esc도 그 창 것으로 본다(APG dialog: Esc = 닫기). 앱 클래스는 시험에서 만들지 않으므로(153차 꼴)
 * 판정 함수 + 실제 그림 저장 창 + 창 캡처 리스너로 본다(가드 차례는 157차 tests/app/menukey.test.ts 원문 시험).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '../../src/app/exporter';
import { inList, isEditableTarget, keyAction, menuKey } from '../../src/app/keys';

/** 실제 그림 저장 창을 연 단추(opener)에서 연다 — 첫 초점은 「PNG 저장」 버튼 */
function openExport(): { x: ExportDialog; el: HTMLElement; opener: HTMLButtonElement } {
  const parent = document.body.appendChild(document.createElement('div'));
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 640 });
  Object.defineProperty(canvas, 'clientHeight', { value: 480 });
  const ctx = { viewer: { canvas }, overlay: null, labels: null, base: 'light', restoreTheme: vi.fn() };
  const x = new ExportDialog({ docName: () => '집.skp', context: () => ctx as never, notify: vi.fn(), track: vi.fn() }, parent);
  const opener = document.body.appendChild(document.createElement('button'));
  opener.focus();
  x.open();
  return { x, el: parent.querySelector<HTMLElement>('.export-dialog')!, opener };
}

/**
 * 앱 창 키가 이 키를 가져가는지(onKey의 menuKey 가드와 keyAction 차례 — 걷는 중·줄자를 켠 채·장면 있는 문서).
 * keypick·측정 도구 Esc·고른 안내 Esc(onKey 7~9단계)는 입력 칸만 거르고 Esc를 가리지 않으므로 Esc는 menuKey만 막는다
 */
const appTakes = (t: Element, key: string): boolean =>
  !menuKey(t, key) &&
  keyAction({ key, hasDoc: true, hasPages: true, walking: true, measureMode: true, editable: isEditableTarget(t), inList: inList(t) }) !== null;

/** 부모 고르개(클래스·role) 아래 자식 하나를 만든다 */
function widget(tag: string, attrs: Record<string, string>, parent?: { cls?: string; role?: string }): HTMLElement {
  let host: HTMLElement = document.body;
  if (parent) {
    host = document.body.appendChild(document.createElement('div'));
    if (parent.cls) host.className = parent.cls;
    if (parent.role) host.setAttribute('role', parent.role);
  }
  const el = host.appendChild(document.createElement(tag));
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('스스로 키를 쓰는 위젯의 키는 앱 창 키가 가져가지 않는다(158차 감사)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('막대·가르개·장면 탭·패널 탭·나무·메뉴·그림 저장 창의 APG 키는 위젯 것, 위젯이 쓰지 않는 키와 창 밖은 앱 것 그대로', () => {
    const { el, opener } = openExport();
    expect(el.getAttribute('role')).toBe('dialog');
    const primary = document.activeElement as HTMLElement;
    expect(el.contains(primary)).toBe(true);
    const radio = el.querySelector<HTMLInputElement>('input[type=radio]')!;
    const check = el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const own: [string, Element, string[]][] = [
      // slider: 화살표·Home·End·PageUp·PageDown(단면 위치·시야각 막대 — range는 isEditableTarget 밖이지만 inList의 input)
      ['단면 위치 막대', widget('input', { type: 'range', class: 'sec-range' }), [...arrows, 'Home', 'End', 'PageUp', 'PageDown']],
      ['시야각 막대', widget('input', { type: 'range', class: 'fov-range' }), [...arrows, 'Home', 'End', 'PageUp', 'PageDown']],
      // separator: 화살표·Home·End(넓은 화면 ←→, 좁은 화면 시트 ↑↓ — Enter·Space는 코어가 캔버스 밖 키로 받지 않는다)
      ['창 가르개', widget('div', { class: 'resizer', role: 'separator', tabindex: '0' }), [...arrows, 'Home', 'End']],
      // tablist: ←→·Home·End
      ['장면 탭', widget('button', { role: 'tab' }, { cls: 'scene-tabs' }), ['ArrowLeft', 'ArrowRight', 'Home', 'End']],
      ['패널 탭', widget('button', { role: 'tab' }, { cls: 'panel' }), ['ArrowLeft', 'ArrowRight', 'Home', 'End']],
      // tree: 화살표·Home·End
      ['나무 줄', widget('div', { role: 'treeitem', tabindex: '0' }, { role: 'tree' }), [...arrows, 'Home', 'End']],
      // menu: 화살표·Home·End·Esc(157차)
      ['도구 막대 메뉴', widget('button', { role: 'menuitem' }, { cls: 'menu', role: 'menu' }), ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape']],
      // dialog: Esc(닫기 — 158차), 크기 radio는 화살표도
      ['그림 저장 창 버튼', primary, ['Escape']],
      ['그림 저장 창 크기', radio, [...arrows, 'Escape']],
      ['그림 저장 창 체크', check, ['Escape']],
    ];
    for (const [name, t, keys] of own) for (const key of keys) expect(appTakes(t, key), `${name} ${key}`).toBe(false);
    // 위젯이 쓰지 않는 키는 「캔버스에 초점이 없어도 같은 키가 뷰어로」 그대로(걷기 W·화살표, F 전체 보기, 1 보기, F7 격자, T 줄자)
    for (const key of ['w', 'f', '1', 'F7', 't', 'ArrowDown']) expect(appTakes(primary, key), `창 버튼 ${key}`).toBe(true);
    expect(appTakes(own[0]![1], 'f')).toBe(true);
    // 창 밖(창을 연 버튼·문서)의 Esc는 앱 것(측정 지우기·걷기 끝 등) — 대화 상자 판정은 창 안만
    expect(menuKey(opener, 'Escape')).toBe(false);
    expect(appTakes(opener, 'Escape')).toBe(true);
    expect(appTakes(document.body, 'Escape')).toBe(true);
    expect(menuKey(null, 'Escape')).toBe(false);
    // 창 안이라도 Esc 밖의 키는 대화 상자 판정에 들지 않는다(메뉴만 이동 키)
    for (const key of ['Tab', 'Enter', ' ', 'ArrowDown', 'Home', 'PageDown']) expect(menuKey(primary, key), key).toBe(false);
  });

  it('앱 창 키(캡처)가 menuKey에서 돌아서면 Esc가 그림 저장 창을 닫고 연 버튼으로 초점 — 창 밖 Esc와 글자 키는 앱이 받는다', () => {
    const { x, opener } = openExport();
    const taken: string[] = [];
    // app.ts onKey 꼴: 가드가 아니면 줄자의 측정 지우기·걷기 끝처럼 받아 전파를 막는다
    const onKey = (ev: KeyboardEvent): void => {
      if (menuKey(ev.target, ev.key)) return;
      taken.push(ev.key);
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const press = (key: string): void => {
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    try {
      press('w');
      expect(x.isOpen).toBe(true);
      expect(taken).toEqual(['w']);
      press('Escape');
      expect(x.isOpen).toBe(false);
      expect(document.activeElement).toBe(opener);
      expect(taken).toEqual(['w']);
      // 돌아온 버튼에서 누른 Esc는 지금처럼 앱 것
      press('Escape');
      expect(taken).toEqual(['w', 'Escape']);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });
});
