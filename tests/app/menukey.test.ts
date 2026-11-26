// @vitest-environment jsdom
/**
 * 157차: 메뉴(role=menu — 공용 언어 고르기 메뉴 등) 안의 Esc·이동 키는 그 메뉴 것(`keys.ts` `menuKey`).
 * README 「다국어 UI」는 언어 메뉴를 "방향키로 이동하고 Escape나 바깥 클릭으로 닫을 수 있습니다"라고 하는데, 앱 창 키(app.ts onKey — 창 keydown 캡처)가
 * 먼저 받아 문서를 연 뒤 걷는 중이면 화살표를 걷기·Esc를 걷기 끝으로, 줄자·각도기를 켠 동안이면 화살표를 방향 잠금·Esc를 측정 지우기로 가져가
 * (전파를 막음) 메뉴가 움직이지도 닫히지도 않았다. 앱의 목록 판정(inList — `.menu` 등)에 공용 도구의 `.language-list`는 들지 않는다.
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 판정 함수 + 실제 공용 메뉴 + 앱 원문 차례로 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLanguageMenu } from 'opencad-site-kit/i18n/language-menu';
import { menuKey } from '../../src/app/keys';

const LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

describe('메뉴 안의 Esc·이동 키는 그 메뉴 것(157차)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  /** 실제 공용 언어 고르기 메뉴를 붙이고 단추를 눌러 연다(지금 언어 ko — 첫 항목에 초점) */
  function openLanguageMenu(): { trigger: HTMLButtonElement; menu: HTMLElement; items: HTMLButtonElement[] } {
    const control = createLanguageMenu(LANGS, 'ko', async () => undefined);
    dispose = control.dispose;
    document.body.append(control.element);
    const trigger = control.element.querySelector('button')!;
    trigger.click();
    const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    return { trigger, menu, items: [...menu.querySelectorAll<HTMLButtonElement>('button')] };
  }

  it('언어 메뉴 항목의 화살표·Home·End·PageUp·PageDown·Esc는 메뉴 것, 글자·Tab·Enter와 메뉴 밖은 앱 창 키 그대로', () => {
    const { trigger, menu, items } = openLanguageMenu();
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.hidden).toBe(false);
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'])
      expect(menuKey(items[0]!, key), key).toBe(true);
    // 글자 키(F·1~7 보기, W 걷기, T 줄자)·F7·Tab·Enter는 지금처럼 앱 것(Tab·Enter는 측정 도구·코어 가상 커서가 캔버스 대상일 때만 받는다)
    for (const key of ['f', '1', 'w', 't', 'F7', 'Tab', 'Enter', 'Shift'])
      expect(menuKey(items[0]!, key), key).toBe(false);
    // 메뉴 밖(언어 단추·3D 보기·문서): 「캔버스에 초점이 없어도 같은 키가 뷰어로」 그대로
    const canvas = document.body.appendChild(document.createElement('canvas'));
    expect(menuKey(trigger, 'ArrowDown')).toBe(false);
    expect(menuKey(canvas, 'ArrowDown')).toBe(false);
    expect(menuKey(document.body, 'Escape')).toBe(false);
    expect(menuKey(null, 'Escape')).toBe(false);
    // 앱 도구 막대 메뉴(.menu role=menu)도 같은 판정 — 그 Esc는 onKey가 앞에서 닫고, 이동 키는 이미 inList(keyAction null)라 동작 그대로
    const own = document.body.appendChild(document.createElement('div'));
    own.className = 'menu';
    own.setAttribute('role', 'menu');
    const item = own.appendChild(document.createElement('button'));
    item.setAttribute('role', 'menuitem');
    expect(menuKey(item, 'ArrowDown')).toBe(true);
    expect(menuKey(item, 'Escape')).toBe(true);
  });

  it('앱 창 키(캡처)가 menuKey에서 돌아서면 실제 언어 메뉴가 화살표·End로 옮기고 Esc로 닫는다 — 글자 키만 앱이 받는다', () => {
    const { trigger, menu, items } = openLanguageMenu();
    const taken: string[] = [];
    // app.ts onKey 꼴: 메뉴 키가 아니면 걷기·줄자 방향 잠금·측정 지우기처럼 받아 전파를 막는다
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
      press('ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      press('End');
      expect(document.activeElement).toBe(items[2]);
      press('ArrowDown');
      expect(document.activeElement).toBe(items[0]);
      press('w');
      expect(document.activeElement).toBe(items[0]);
      expect(taken).toEqual(['w']);
      press('Escape');
      expect(menu.hidden).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      expect(taken).toEqual(['w']);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });

  it('app.ts 창 키는 앱 메뉴·겹친 것 목록의 Esc 뒤, 측정 도구·걷기·장면·고른 것 지우기 앞에서 menuKey로 돌아선다', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\bmenuKey\b[^}]*\} from '\.\/keys';/);
    const start = src.indexOf('  private onKey(ev: KeyboardEvent): void {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const at = (s: string): number => {
      const i = body.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const guard = at('if (menuKey(ev.target, ev.key)) return;');
    expect(at("if (this.menu && ev.key === 'Escape')")).toBeLessThan(guard);
    expect(at('if (this.pickList?.escape(ev)) return;')).toBeLessThan(guard);
    for (const later of [
      'if (tool?.undoKey(ev))',
      'if (this.keyPick?.handleKey(ev))',
      "if (tool?.active && !isEditableTarget(ev.target) && ev.key === 'Escape'",
      'if (tool?.selectKey(ev))',
      'const act = keyAction({',
      'if (v.handleKey(ev))',
    ])
      expect(guard, later).toBeLessThan(at(later));
  });
});
