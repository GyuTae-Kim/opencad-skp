// @vitest-environment jsdom
/**
 * 178차: 한 글자 단축키(WCAG 2.1.4 문자 키 단축키 — 수정 키 없이 글자·숫자·기호 키 하나로 되는 바로 가기는 끌 수 있거나, 바꿀 수 있거나,
 * 그 기능의 칸에 초점이 있을 때만 동작해야 한다: 음성 입력이 친 글자가 명령으로 가지 않게).
 * 앱 창 키(app.ts onKey — 창 keydown 캡처)는 「캔버스에 초점이 없어도(입력 칸 제외) 위 키가 3D 보기로 갑니다」(README 키 표)라
 * F 전체 보기·1~7 표준 뷰·T 줄자·? 안내·걷기 W·A·S·D·Q·E·측정값 칸 숫자가 문서 몸·도구 막대·패널에 초점이 있어도 동작했고, 끌 길·바꿀 길이 없었다.
 * 코어는 캔버스에 초점이 있을 때만 키를 받는다(Viewer3d keyboard 기본). 늘 3D 보기에서만 받게 바꾸면 도구 막대 버튼을 누른 뒤의 F·걷기 버튼 뒤 W 등이 듣지 않는 회귀라,
 * 앱 설정 메뉴에 켜고 끄는 항목 「3D 보기 밖에서도 한 글자 단축키(F·1~7·T·? 등)」(기억, 기본 켬 = 177차까지와 같음, 못 읽으면 켬)를 두었다 —
 * 끄면 3D 보기 밖 대상의 글자 키는 앱이 받지 않는다(브라우저 몫). 세 앱이 같은 꼴(리드 결정).
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 판정 함수 + 기억 + 창 캡처 리스너 꼴 + 앱 원문 + 네 사전 차례로 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogs, translate } from '../../site/i18n.mjs';
import { CHAR_KEYS_KEY, charKeyOutside, loadCharKeysAnywhere, storeCharKeysAnywhere } from '../../src/app/keys';

const LABEL = '3D 보기 밖에서도 한 글자 단축키(F·1~7·T·? 등)';
const LANGS = ['en', 'de', 'ja', 'zh-CN'] as const;

/** 앱 꼴 화면: 3D 보기 감싸개(.view-host) 안 코어 감싸개(.v3d)·캔버스(tabindex 0), 그 밖 도구 막대 버튼·패널 나무 줄·카메라 띠 막대 */
function screen(): { view: HTMLElement; wrap: HTMLElement; canvas: HTMLCanvasElement; button: HTMLButtonElement; row: HTMLElement; range: HTMLInputElement } {
  const view = document.body.appendChild(document.createElement('div'));
  view.className = 'view-host';
  const wrap = view.appendChild(document.createElement('div'));
  wrap.className = 'v3d';
  const canvas = wrap.appendChild(document.createElement('canvas'));
  canvas.tabIndex = 0;
  const bar = document.body.appendChild(document.createElement('div'));
  bar.className = 'toolbar';
  const button = bar.appendChild(document.createElement('button'));
  const panel = document.body.appendChild(document.createElement('div'));
  panel.className = 'panel';
  const tree = panel.appendChild(document.createElement('div'));
  tree.setAttribute('role', 'tree');
  const row = tree.appendChild(document.createElement('div'));
  row.setAttribute('role', 'treeitem');
  row.tabIndex = 0;
  const range = document.body.appendChild(document.createElement('input'));
  range.type = 'range';
  return { view, wrap, canvas, button, row, range };
}

/** 판정에 넘기는 키 사건 꼴 */
function ev(key: string, target: EventTarget | null, mod: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...mod, target };
}

/** 이 앱이 수정 키 없이 받는 글자·숫자·기호 키(바로 가기 안내·README 키 표 — Shift 글자 ?·대문자, 한글 입력기 글자 ㅈ = 물리 W) */
const CHARS = ['f', 'F', '1', '5', '7', 't', 'T', '?', 'w', 'W', 'a', 's', 'd', 'q', 'e', 'ㅈ', '0', '9', '.', ',', '-'];
/** 이름 있는 키(2.1.4 대상 아님 — Space 포함): 지금처럼 앱 창 키 차례 */
const NAMED = ['F7', 'F1', 'F10', 'F12', 'Escape', 'Enter', 'Tab', ' ', 'ArrowUp', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End', 'Delete', 'Backspace', 'Shift', 'Control', 'Alt', 'Meta'];

describe('3D 보기 밖에서도 한 글자 단축키 — 끌 수 있음(178차 — WCAG 2.1.4)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('수정 키 없는 글자·숫자·기호 키 하나(입력기 Process 포함)가 3D 보기(캔버스·감싸개) 밖 대상인지 가른다 — 이름 있는 키·조합 키는 아님', () => {
    expect(typeof charKeyOutside).toBe('function');
    const { view, wrap, canvas, button, row, range } = screen();
    for (const key of CHARS) {
      for (const t of [document.body, button, row, range]) expect(charKeyOutside(ev(key, t), view), `${key} 밖 ${t.localName}`).toBe(true);
      for (const t of [canvas, wrap, view]) expect(charKeyOutside(ev(key, t), view), `${key} 안 ${t.className || t.localName}`).toBe(false);
    }
    for (const key of NAMED) expect(charKeyOutside(ev(key, document.body), view), key).toBe(false);
    // Ctrl·⌘·Alt 조합(열기 O·안내 되돌리기 Z·안내 모두 고르기 A·모두 풀기 T)은 명령 키라 그대로 앱 차례
    for (const key of ['o', 'z', 'a', 't', 'f', '1'])
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(charKeyOutside(ev(key, button, mod), view), `${key} ${Object.keys(mod)[0]}`).toBe(false);
    // 윈도 한글 입력기 등은 글자 키 keydown을 Process로 낸다(코어 걷기는 물리 키로 받는다)
    expect(charKeyOutside(ev('Process', button), view)).toBe(true);
    expect(charKeyOutside(ev('Process', canvas), view)).toBe(false);
    // 노드가 아닌 대상(창)·대상 없음·3D 보기를 모름은 밖(던지지 않는다)
    expect(charKeyOutside(ev('f', window), view)).toBe(true);
    expect(charKeyOutside(ev('f', null), view)).toBe(true);
    expect(charKeyOutside(ev('f', canvas), null)).toBe(true);
  });

  it('설정은 기억하고, 없거나 못 읽으면 켬(177차까지와 같은 동작)', () => {
    expect(CHAR_KEYS_KEY).toBe('opencad-skp.charKeysAnywhere');
    const store = (init: Record<string, string> = {}) => {
      const m = new Map(Object.entries(init));
      return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    };
    expect(loadCharKeysAnywhere(null)).toBe(true);
    expect(loadCharKeysAnywhere(store())).toBe(true);
    expect(loadCharKeysAnywhere(store({ [CHAR_KEYS_KEY]: '1' }))).toBe(true);
    expect(loadCharKeysAnywhere(store({ [CHAR_KEYS_KEY]: '0' }))).toBe(false);
    expect(
      loadCharKeysAnywhere({
        getItem: () => {
          throw new Error('막힘');
        },
      }),
    ).toBe(true);
    const s = store();
    storeCharKeysAnywhere(s, false);
    expect(s.m.get(CHAR_KEYS_KEY)).toBe('0');
    expect(loadCharKeysAnywhere(s)).toBe(false);
    storeCharKeysAnywhere(s, true);
    expect(s.m.get(CHAR_KEYS_KEY)).toBe('1');
    expect(loadCharKeysAnywhere(s)).toBe(true);
    expect(() =>
      storeCharKeysAnywhere(
        {
          setItem: () => {
            throw new Error('가득');
          },
        },
        false,
      ),
    ).not.toThrow();
    expect(() => storeCharKeysAnywhere(null, false)).not.toThrow();
  });

  it('창 캡처 리스너(onKey 꼴)는 켬(기본)이면 177차처럼 다 받고, 끄면 3D 보기 밖 글자 키를 받지 않으며(기본 동작도 그대로) 3D 보기 안·이름 있는 키·조합 키는 받는다', () => {
    expect(typeof charKeyOutside).toBe('function');
    const { view, canvas, button } = screen();
    let anywhere = true;
    const taken: string[] = [];
    const heard: string[] = [];
    // 코어 캔버스 keydown 꼴(앱이 받아 전파를 막으면 오지 않는다)
    canvas.addEventListener('keydown', (e) => heard.push(e.key));
    const onKey = (e: KeyboardEvent): void => {
      if (!anywhere && charKeyOutside(e, view)) return;
      taken.push(`${(e.target as HTMLElement).localName} ${e.key}`);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    const run = (): boolean[] => [
      press(document.body, 'f'),
      press(button, '1'),
      press(button, '?', { shiftKey: true }),
      press(button, 'w'),
      press(button, 'T', { shiftKey: true }),
      press(canvas, 'f'),
      press(document.body, 'F7'),
      press(button, 'o', { ctrlKey: true }),
      press(document.body, 'Escape'),
    ];
    try {
      // 켬(기본): 177차까지처럼 어디서나 앱 것
      expect(run().every((x) => !x)).toBe(true);
      expect(taken).toEqual(['body f', 'button 1', 'button ?', 'button w', 'button T', 'canvas f', 'body F7', 'button o', 'body Escape']);
      expect(heard).toEqual([]);
      // 끔: 밖 글자 키 다섯은 앱이 받지 않아 기본 동작도 막지 않는다(dispatchEvent true)
      anywhere = false;
      taken.length = 0;
      expect(run()).toEqual([true, true, true, true, true, false, false, false, false]);
      expect(taken).toEqual(['canvas f', 'body F7', 'button o', 'body Escape']);
      expect(heard).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });

  it('app.ts: 앱 설정 메뉴 항목(키보드 바로 가기 뒤)·기억·onKey 가드(menuKey 뒤, 안내 되돌리기·측정값 칸 숫자·측정 도구·keyAction·뷰어 키 앞)', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    for (const name of ['charKeyOutside', 'loadCharKeysAnywhere', 'storeCharKeysAnywhere']) expect(src, name).toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./keys';`));
    expect(src).toContain('  private charKeysAnywhere = loadCharKeysAnywhere(safeStorage());');
    // 설정 함수: 값과 기억을 함께
    const set = src.indexOf('  setCharKeysAnywhere(on: boolean): void {');
    expect(set).toBeGreaterThan(-1);
    const setBody = src.slice(set, src.indexOf('\n  }\n', set));
    expect(setBody).toContain('this.charKeysAnywhere = on;');
    expect(setBody).toContain('storeCharKeysAnywhere(safeStorage(), on);');
    // 앱 설정 메뉴(테마 메뉴): 키보드 바로 가기 바로 뒤 켜고 끄는 항목(menuitemcheckbox)
    const menu = src.indexOf('  private toggleThemeMenu(): void {');
    expect(menu).toBeGreaterThan(-1);
    const menuBody = src.slice(menu, src.indexOf('\n  }\n', menu));
    const help = menuBody.indexOf("{ label: '키보드 바로 가기', icon: 'keyboard', kbd: '?', sep: true, run: () => this.openShortcuts() },");
    const item = menuBody.indexOf(`{ label: '${LABEL}', checked: this.charKeysAnywhere, toggle: true, run: () => this.setCharKeysAnywhere(!this.charKeysAnywhere) },`);
    expect(help).toBeGreaterThan(-1);
    expect(item).toBeGreaterThan(help);
    // onKey: 모달·메뉴 가드 뒤, 앱이 글자 키를 쓰는 모든 길 앞
    const start = src.indexOf('  private onKey(ev: KeyboardEvent): void {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const at = (s: string): number => {
      const i = body.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const guard = at('if (!this.charKeysAnywhere && charKeyOutside(ev, this.els.viewHost)) return;');
    for (const before of ['if (this.shortcutsClose) {', "if (this.menu && ev.key === 'Escape')", 'if (this.pickList?.escape(ev)) return;', 'if (menuKey(ev.target, ev.key, ev.ctrlKey || ev.metaKey || ev.altKey)) return;'])
      expect(at(before), before).toBeLessThan(guard);
    for (const later of [
      'if (tool?.undoKey(ev))',
      'if (typing && !isEditableTarget(ev.target) && vcbStartKey(ev)',
      'if (this.keyPick?.handleKey(ev))',
      'if (tool?.selectKey(ev))',
      'const act = keyAction({',
      'if (v.handleKey(ev))',
    ])
      expect(guard, later).toBeLessThan(at(later));
  });

  it('네 언어 사전: 같은 사전의 「3D 보기」·「키보드 바로 가기」 낱말로 옮기고 한국어가 남지 않으며 다른 열쇠와 값이 겹치지 않는다', () => {
    const basis: Record<(typeof LANGS)[number], string> = { en: 'shortcuts', de: 'Tastenkürzel', ja: 'ショートカット', 'zh-CN': '快捷键' };
    const flat = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
    for (const code of LANGS) {
      const value = catalogs[code]![LABEL];
      expect(value, code).toBeTruthy();
      expect(value!, code).not.toMatch(/[가-힣]/);
      // 띄어쓰기는 가리지 않는다(230차까지 중국어 사전에 3D视图·3D 视图 두 꼴 — 231차부터 3D 视图 한 꼴, i18n.test 50차 규칙 표 231차 줄)
      expect(flat(value!), `${code} 3D 보기`).toContain(flat(catalogs[code]!['3D 보기']!));
      expect(catalogs[code]!['키보드 바로 가기']!.toLowerCase(), `${code} 근거`).toContain(basis[code].toLowerCase());
      expect(value!.toLowerCase(), `${code} 단축키`).toContain(basis[code].toLowerCase());
      // 키 글자는 그대로
      for (const k of ['F', '7', 'T', '?']) expect(value!, `${code} ${k}`).toContain(k);
      expect(
        Object.entries(catalogs[code]!)
          .filter(([, v]) => v === value)
          .map(([k]) => k),
        code,
      ).toEqual([LABEL]);
    }
    expect(LANGS.map((code) => translate(LABEL, code))).toEqual([
      'Single-character shortcuts outside the 3D view (F, 1–7, T, ?, etc.)',
      'Einzelzeichen-Tastenkürzel auch außerhalb der 3D-Ansicht (F, 1–7, T, ? usw.)',
      '3Dビューの外でも1文字ショートカット（F・1〜7・T・? など）',
      '在 3D 视图外也使用单字符快捷键（F、1~7、T、? 等）',
    ]);
  });
});
