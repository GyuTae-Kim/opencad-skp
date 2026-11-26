// @vitest-environment jsdom
/**
 * 157차: 메뉴(role=menu — 공용 언어 고르기 메뉴 등) 안의 Esc·이동 키는 그 메뉴 것(`keys.ts` `menuKey`).
 * README 「다국어 UI」는 언어 메뉴를 "방향키로 이동하고 Escape나 바깥 클릭으로 닫을 수 있습니다"라고 하는데, 앱 창 키(app.ts onKey — 창 keydown 캡처)가
 * 먼저 받아 문서를 연 뒤 걷는 중이면 화살표를 걷기·Esc를 걷기 끝으로, 줄자·각도기를 켠 동안이면 화살표를 방향 잠금·Esc를 측정 지우기로 가져가
 * (전파를 막음) 메뉴가 움직이지도 닫히지도 않았다. 앱의 목록 판정(inList — `.menu` 등)에 공용 도구의 `.language-list`는 들지 않는다.
 * 164차: 메뉴 안의 글자·숫자·기호 키(인쇄되는 글자 하나 — Ctrl·⌘·Alt 없이)도 그 메뉴 것(WAI-ARIA APG Menu: 글자는 그 글자로 시작하는 항목으로 — 선택 사항,
 * 메뉴 밖 단축키로 보내지 않음). 앱 창 키가 F 전체 보기·1~7 표준 뷰·T 줄자·걷기 W·? 안내·측정값 칸 숫자로 가져가 메뉴가 열린 채 뒤 3D 보기·도구가 바뀌었다
 * (겹친 것 목록은 T에 떼어져 초점이 문서로). Ctrl·⌘ 조합(안내 되돌리기·열기·안내 고르기)은 메뉴가 쓰지 않는 명령 키라 앱 것 그대로.
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 판정 함수 + 실제 공용 메뉴 + 앱 메뉴 꼴 + 앱 원문 차례로 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLanguageMenu } from 'opencad-site-kit/i18n/language-menu';
import { listKeys, menuTab } from '../../src/app/kbd';
import { inList, isEditableTarget, keyAction, menuKey } from '../../src/app/keys';
import { vcbStartKey } from '../../src/app/vcb';

const LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

/** 이 요소에 keydown을 보낸다(Ctrl·⌘ 등 함께) */
function press(key: string, init: KeyboardEventInit = {}): void {
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

describe('메뉴 안의 Esc·이동 키(157차)와 글자·숫자 키(164차)는 그 메뉴 것', () => {
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

  it('언어 메뉴 항목의 화살표·Home·End·PageUp·PageDown·Esc·글자·숫자 키는 메뉴 것, 조합 키·F7·Tab·Enter와 메뉴 밖은 앱 창 키 그대로', () => {
    const { trigger, menu, items } = openLanguageMenu();
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.hidden).toBe(false);
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'])
      expect(menuKey(items[0]!, key), key).toBe(true);
    // 164차: 인쇄되는 글자 하나(F·1~7 보기, W 걷기, T 줄자, ? 안내, 측정값 칸 숫자·기호, Space, Shift 글자, 한글 입력기 글자)는 메뉴 것
    for (const key of ['f', 'F', '1', '7', 'w', 't', 'T', 'h', '?', '5', '.', ',', '-', ' ', 'ㅈ']) expect(menuKey(items[0]!, key), key).toBe(true);
    // Ctrl·⌘·Alt 조합(안내 되돌리기 Z·Y, 열기 O, 안내 모두 고르기 A, Ctrl+T)은 메뉴가 쓰지 않는 명령 키라 앱 것
    for (const key of ['z', 'Z', 'y', 'o', 'a', 't']) expect(menuKey(items[0]!, key, true), `조합 ${key}`).toBe(false);
    // 인쇄되는 글자가 아닌 키(F7 격자, Delete·Backspace 고른 안내 지우기, Shift 잠금)·Tab·Enter는 지금처럼 앱 창 키 차례(Tab·Enter는 측정 도구·코어가 캔버스 대상일 때만 받는다)
    for (const key of ['F7', 'Tab', 'Enter', 'Shift', 'Delete', 'Backspace']) expect(menuKey(items[0]!, key), key).toBe(false);
    // 메뉴 밖(언어 단추·3D 보기·문서): 「캔버스에 초점이 없어도 같은 키가 뷰어로」 그대로
    const canvas = document.body.appendChild(document.createElement('canvas'));
    expect(menuKey(trigger, 'ArrowDown')).toBe(false);
    expect(menuKey(trigger, 'f')).toBe(false);
    expect(menuKey(canvas, 'ArrowDown')).toBe(false);
    expect(menuKey(canvas, 'w')).toBe(false);
    expect(menuKey(document.body, 'Escape')).toBe(false);
    expect(menuKey(document.body, '1')).toBe(false);
    expect(menuKey(null, 'Escape')).toBe(false);
    expect(menuKey(null, 'f')).toBe(false);
    // 앱 도구 막대 메뉴(.menu role=menu)도 같은 판정 — 그 Esc는 onKey가 앞에서 닫고, 이동 키는 이미 inList(keyAction null)라 동작 그대로
    const own = document.body.appendChild(document.createElement('div'));
    own.className = 'menu';
    own.setAttribute('role', 'menu');
    const item = own.appendChild(document.createElement('button'));
    item.setAttribute('role', 'menuitem');
    expect(menuKey(item, 'ArrowDown')).toBe(true);
    expect(menuKey(item, 'Escape')).toBe(true);
    expect(menuKey(item, '1')).toBe(true);
    expect(menuKey(item, 'o', true)).toBe(false);
  });

  it('앱 창 키(캡처)가 menuKey에서 돌아서면 실제 언어 메뉴가 화살표·End로 옮기고 Esc로 닫는다 — 글자 키도 메뉴 것, 조합 키만 앱이 받는다', () => {
    const { trigger, menu, items } = openLanguageMenu();
    const taken: string[] = [];
    // app.ts onKey 꼴: 메뉴 키가 아니면 걷기·줄자 방향 잠금·측정 지우기·안내 되돌리기처럼 받아 전파를 막는다
    const onKey = (ev: KeyboardEvent): void => {
      if (menuKey(ev.target, ev.key, ev.ctrlKey || ev.metaKey || ev.altKey)) return;
      taken.push(ev.key);
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    try {
      press('ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      press('End');
      expect(document.activeElement).toBe(items[2]);
      press('ArrowDown');
      expect(document.activeElement).toBe(items[0]);
      // 164차: 걷기 W·보기 1은 앱이 받지 않는다(언어 메뉴는 글자 찾기가 없어 초점 그대로, 메뉴는 열린 채)
      press('w');
      press('1');
      expect(document.activeElement).toBe(items[0]);
      expect(menu.hidden).toBe(false);
      expect(taken).toEqual([]);
      // Ctrl+Z(안내 되돌리기)는 앱 것
      press('z', { ctrlKey: true });
      expect(taken).toEqual(['z']);
      press('Escape');
      expect(menu.hidden).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      expect(taken).toEqual(['z']);
      // 메뉴 밖(돌아온 언어 단추)의 글자 키는 지금처럼 앱 것
      press('w');
      expect(taken).toEqual(['z', 'w']);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });

  it('app.ts 창 키는 앱 메뉴·겹친 것 목록의 Esc 뒤, 안내 되돌리기·측정값 칸 숫자·측정 도구·걷기·장면·고른 것 지우기 앞에서 menuKey로 돌아선다(164차 — 조합 키를 넘김)', () => {
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
    expect(body).not.toContain('if (menuKey(ev.target, ev.key)) return;');
    const guard = at('if (menuKey(ev.target, ev.key, ev.ctrlKey || ev.metaKey || ev.altKey)) return;');
    expect(at("if (this.menu && ev.key === 'Escape')")).toBeLessThan(guard);
    expect(at('if (this.pickList?.escape(ev)) return;')).toBeLessThan(guard);
    for (const later of [
      'if (tool?.undoKey(ev))',
      'if (typing && !isEditableTarget(ev.target) && vcbStartKey(ev)',
      'if (this.keyPick?.handleKey(ev))',
      "if (tool?.active && !isEditableTarget(ev.target) && ev.key === 'Escape'",
      'if (tool?.selectKey(ev))',
      'const act = keyAction({',
      'if (v.handleKey(ev))',
    ])
      expect(guard, later).toBeLessThan(at(later));
  });

  it('앱 도구 막대 메뉴·겹친 것 목록 항목의 F·1·T·W·?·측정값 칸 숫자는 앱 단축키가 되지 않고 메뉴·초점 그대로, 조합 키·F7과 메뉴 밖 글자 키는 앱 것(164차)', () => {
    // app.ts openMenu 꼴(.menu role=menu, 항목 menuitem tabindex -1, keydown = menuTab → listKeys)과 picklist.ts 꼴(.menu.pick-list role=menu)
    const menuOf = (cls: string): HTMLButtonElement[] => {
      const m = document.body.appendChild(document.createElement('div'));
      m.className = cls;
      m.setAttribute('role', 'menu');
      const items = ['정면', '뒤', '왼쪽'].map((label) => {
        const b = m.appendChild(document.createElement('button'));
        b.className = 'menu-item';
        b.setAttribute('role', 'menuitem');
        b.tabIndex = -1;
        b.textContent = label;
        return b;
      });
      m.addEventListener('keydown', (e) => {
        if (!menuTab(e, null, () => {})) listKeys(e, items, 'ArrowUp', 'ArrowDown', true, 0);
      });
      return items;
    };
    const toolbar = document.body.appendChild(document.createElement('button'));
    toolbar.className = 'tbtn';
    const taken: string[] = [];
    // 줄자 시작점을 찍어 측정값 칸에 칠 수 있는 동안(app.ts tool.typing)
    let typing = true;
    // app.ts onKey 꼴(걷는 중·장면 있는 문서): menuKey → 측정값 칸 숫자 → keyAction(받으면 전파를 막음)
    const onKey = (ev: KeyboardEvent): void => {
      if (menuKey(ev.target, ev.key, ev.ctrlKey || ev.metaKey || ev.altKey)) return;
      if (typing && !isEditableTarget(ev.target) && vcbStartKey(ev)) {
        taken.push(`vcb ${ev.key}`);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const act = keyAction({
        key: ev.key,
        ctrl: ev.ctrlKey,
        meta: ev.metaKey,
        alt: ev.altKey,
        editable: isEditableTarget(ev.target),
        hasDoc: true,
        hasPages: true,
        walking: true,
        inList: inList(ev.target),
      });
      if (!act) return;
      taken.push(`${act.kind} ${ev.key}`);
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    try {
      for (const items of [menuOf('menu'), menuOf('menu pick-list')]) {
        taken.length = 0;
        items[0]!.focus();
        for (const key of ['f', 'F', '1', '7', 't', 'w', '?', '5', '.', '-', 'h']) press(key);
        expect(taken).toEqual([]);
        expect(document.activeElement).toBe(items[0]);
        expect(items[0]!.isConnected).toBe(true);
        // 메뉴 자기 키는 그대로 메뉴가 받는다
        press('ArrowDown');
        expect(document.activeElement).toBe(items[1]);
        // Ctrl+O(열기 상자 — 메뉴 것으로 두면 브라우저 파일 열기가 된다)·F7(격자)은 앱 것
        press('o', { ctrlKey: true });
        press('F7');
        expect(taken).toEqual(['open o', 'grid F7']);
        expect(document.activeElement).toBe(items[1]);
      }
      // 메뉴 밖(도구 막대 버튼)의 글자·숫자 키는 지금처럼 앱 단축키(「캔버스에 초점이 없어도 같은 키가 뷰어로」), 측정값 칸에 칠 수 있는 동안 숫자는 칸으로
      taken.length = 0;
      toolbar.focus();
      press('5');
      typing = false;
      for (const key of ['f', '1', 't', 'w', '?']) press(key);
      expect(taken).toEqual(['vcb 5', 'viewer f', 'viewer 1', 'tape t', 'viewer w', 'help ?']);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });
});
