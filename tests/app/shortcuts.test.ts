// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyAction } from '../../src/app/keys';
import { guideUndoKey, selectAllKey } from '../../src/app/measure';
import { SHORTCUTS, openShortcutsDialog } from '../../src/app/shortcuts';
import { translate } from '../../site/i18n.mjs';

const press = (el: Element, key: string, shiftKey = false): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
};

/** 포인터 사건(jsdom에는 PointerEvent가 없어 pointerType만 붙인다) */
const pointer = (el: Element, type: string, pointerType: string): void => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('키보드 바로 가기 안내', () => {
  it('? 키는 문서가 없어도 안내를 연다(입력 칸·수정 키와 함께면 아니다)', () => {
    expect(keyAction({ key: '?' })).toEqual({ kind: 'help' });
    expect(keyAction({ key: '?', hasDoc: true })).toEqual({ kind: 'help' });
    expect(keyAction({ key: '?', editable: true })).toBeNull();
    expect(keyAction({ key: '?', ctrl: true, hasDoc: true })).toBeNull();
  });

  it('안내에 적은 보기·파일 키는 앱이 실제로 받는다', () => {
    const viewKeys = SHORTCUTS.find((g) => g.title === '보기')!.items.flatMap((it) => it.keys);
    for (const k of viewKeys) expect(keyAction({ key: k, hasDoc: true }), k).not.toBeNull();
    expect(keyAction({ key: 'F7', hasDoc: true })).toEqual({ kind: 'grid' });
    expect(keyAction({ key: 'T', hasDoc: true })).toEqual({ kind: 'tape' });
    expect(keyAction({ key: 'o', ctrl: true })).toEqual({ kind: 'open' });
    expect(keyAction({ key: 'PageDown', hasDoc: true, hasPages: true })).toEqual({ kind: 'page', delta: 1 });
    // 모든 줄에 키와 하는 일이 있다
    for (const g of SHORTCUTS) for (const it of g.items) expect(it.keys.length && it.label.length).toBeTruthy();
  });

  it('안내 되돌리기·다시 하기 줄의 키는 측정 도구가 그대로 받는다', () => {
    const items = SHORTCUTS.flatMap((g) => g.items);
    const undo = items.find((it) => it.label.includes('되돌리기'))!;
    const redo = items.find((it) => it.label.includes('다시 하기'))!;
    // "Ctrl+Shift+Z" → 수정 키와 글자
    const key = (s: string): Parameters<typeof guideUndoKey>[0] => {
      const parts = s.split('+');
      const has = (m: string): boolean => parts.includes(m);
      return { key: parts.at(-1)!.toLowerCase(), code: '', ctrlKey: has('Ctrl'), metaKey: has('⌘'), altKey: false, shiftKey: has('Shift') };
    };
    expect(undo.keys).toEqual(['Ctrl+Z', '⌘+Z']);
    for (const k of undo.keys) expect(guideUndoKey(key(k)), k).toBe('undo');
    expect(redo.keys.length).toBe(3);
    for (const k of redo.keys) expect(guideUndoKey(key(k)), k).toBe('redo');
    // 창 키 규칙(keys.ts)은 이 키들을 뷰어로 보내지 않는다(측정 도구가 먼저 받는다)
    for (const k of [...undo.keys, ...redo.keys]) {
      const e = key(k);
      expect(keyAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, hasDoc: true }), k).toBeNull();
    }
  });

  it('안내 모두 고르기·모두 풀기 줄의 키는 측정 도구가 그 판(Windows·Linux는 Ctrl, Mac은 ⌘)에서 받는다(26차)', () => {
    const items = SHORTCUTS.flatMap((g) => g.items);
    const all = items.find((it) => it.label.includes('모두 고르기'))!;
    const none = items.find((it) => it.label.includes('모두 풀기'))!;
    const key = (s: string): Parameters<typeof selectAllKey>[0] => {
      const parts = s.split('+');
      const has = (m: string): boolean => parts.includes(m);
      return { key: parts.at(-1)!.toLowerCase(), code: '', ctrlKey: has('Ctrl'), metaKey: has('⌘'), altKey: false, shiftKey: has('Shift') };
    };
    const mac = (s: string): 'Alt' | 'Control' => (s.includes('⌘') ? 'Alt' : 'Control');
    expect(all.keys).toEqual(['Ctrl+A', '⌘+A']);
    for (const k of all.keys) expect(selectAllKey(key(k), mac(k)), k).toBe('all');
    expect(none.keys).toEqual(['Ctrl+T', '⌘+Shift+A']);
    for (const k of none.keys) expect(selectAllKey(key(k), mac(k)), k).toBe('none');
    // 창 키 규칙(keys.ts)은 이 키들을 뷰어로 보내지 않는다(Ctrl+T가 줄자 T가 되지 않는다)
    for (const k of [...all.keys, ...none.keys]) {
      const e = key(k);
      expect(keyAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, hasDoc: true }), k).toBeNull();
    }
  });

  it('대화 상자: 닫기 단추에 초점, Tab은 안에서만, Esc·바깥 누르기로 닫으면 연 곳에 초점', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    openShortcutsDialog(document.body, onClose);
    const box = document.querySelector('[role=dialog]')!;
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)!.textContent).toBe('키보드 바로 가기');
    const close = box.querySelector('button')!;
    expect(document.activeElement).toBe(close);
    expect(box.querySelectorAll('kbd').length).toBeGreaterThan(10);
    // Tab: 닫기 → 본문 → 닫기(상자 밖으로 나가지 않는다)
    press(close, 'Tab');
    expect(document.activeElement).toBe(box.querySelector('.sc-body'));
    press(document.activeElement!, 'Tab');
    expect(document.activeElement).toBe(close);
    press(close, 'Tab', true);
    expect(box.contains(document.activeElement)).toBe(true);
    // Esc
    press(close, 'Escape');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
    // 바깥(어두운 바탕) 누르기
    const again = vi.fn();
    const closeFn = openShortcutsDialog(document.body, again);
    document.querySelector('.sc-backdrop')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(again).toHaveBeenCalledTimes(1);
    closeFn();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('열린 동안 뒤 칸(문서 몸의 다른 칸)은 inert, 닫으면 연 곳에 초점을 돌려주기 전에 풀고 이미 inert였던 칸은 그대로 — aria-modal=true의 약속(165차 — 160차는 상자 밖 초점의 키만 막았다)', () => {
    // #app 꼴 뒤 칸(안에 연 버튼)과 이미 inert인 칸
    const app = document.body.appendChild(document.createElement('div'));
    const opener = app.appendChild(document.createElement('button'));
    const kept = document.body.appendChild(document.createElement('div'));
    kept.setAttribute('inert', '');
    opener.focus();
    // 연 버튼이 초점을 받을 때 inert 조상이 없어야 한다(inert 안은 초점을 받지 않는다 — jsdom은 inert 초점 규칙이 없어 focus 사건 때 본다)
    const inertAtFocus: (Element | null)[] = [];
    opener.addEventListener('focus', () => inertAtFocus.push(opener.closest('[inert]')));
    const onClose = vi.fn();
    const close = openShortcutsDialog(document.body, onClose);
    const backdrop = document.querySelector<HTMLElement>('.sc-backdrop')!;
    expect(app.hasAttribute('inert')).toBe(true);
    expect(kept.hasAttribute('inert')).toBe(true);
    expect(backdrop.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(backdrop.querySelector('.sc-box button'));
    press(document.activeElement!, 'Escape');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(kept.hasAttribute('inert')).toBe(true);
    expect(inertAtFocus).toEqual([null]);
    expect(document.activeElement).toBe(opener);
    expect(onClose).toHaveBeenCalledTimes(1);
    // 돌려준 닫기 함수를 또 불러도 한 번(이미 inert였던 칸을 풀지 않음)
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(kept.hasAttribute('inert')).toBe(true);
    // 닫기 버튼·바깥 누르기(마우스)로 닫아도 푼다
    openShortcutsDialog(document.body, vi.fn());
    expect(app.hasAttribute('inert')).toBe(true);
    document.querySelector<HTMLElement>('.sc-box button')!.click();
    expect(app.hasAttribute('inert')).toBe(false);
    openShortcutsDialog(document.body, vi.fn());
    expect(app.hasAttribute('inert')).toBe(true);
    pointer(document.querySelector('.sc-backdrop')!, 'pointerdown', 'mouse');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(kept.hasAttribute('inert')).toBe(true);
  });

  it('손가락·펜으로 바깥(어두운 바탕)을 누르면 뗀 뒤 그 탭의 click에서 닫는다 — 누를 때 바탕을 떼면 그 click이 밑의 단추·링크를 누른다(140차)', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    for (const type of ['touch', 'pen']) {
      opener.focus();
      const onClose = vi.fn();
      openShortcutsDialog(document.body, onClose);
      const backdrop = document.querySelector<HTMLElement>('.sc-backdrop')!;
      pointer(backdrop, 'pointerdown', type);
      // 누를 때는 그대로: 바탕이 문서에 남아 그 탭의 click을 받는다(밑의 요소로 가지 않음)
      expect(document.querySelector('[role=dialog]'), type).not.toBeNull();
      expect(backdrop.isConnected, type).toBe(true);
      expect(onClose, type).not.toHaveBeenCalled();
      backdrop.click();
      expect(document.querySelector('[role=dialog]'), type).toBeNull();
      expect(onClose, type).toHaveBeenCalledTimes(1);
      expect(document.activeElement, type).toBe(opener);
    }
    // 상자 안에서 누르고 바탕에서 뗀 것(click은 두 요소의 공통 조상인 바탕으로 감)은 닫지 않는다
    const onClose = vi.fn();
    openShortcutsDialog(document.body, onClose);
    const backdrop = document.querySelector<HTMLElement>('.sc-backdrop')!;
    const body = document.querySelector<HTMLElement>('.sc-body')!;
    pointer(body, 'pointerdown', 'touch');
    backdrop.click();
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    // 바탕에서 누른 손가락이 끌려 click이 바탕에 오지 않으면 닫지 않는다(상자 안 click도)
    pointer(backdrop, 'pointerdown', 'touch');
    body.click();
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    press(document.querySelector('.sc-box button')!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    // 마우스는 그대로 누를 때 닫는다(click은 뗀 바탕과 뗀 자리 요소의 공통 조상으로 가 밑의 단추를 누르지 않음)
    const mouse = vi.fn();
    openShortcutsDialog(document.body, mouse);
    pointer(document.querySelector('.sc-backdrop')!, 'pointerdown', 'mouse');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(mouse).toHaveBeenCalledTimes(1);
  });

  it('끝 줄의 3D 보기 조작: 마우스 글은 마우스 기기에서만, 손가락 기기(pointer: coarse)에는 같은 사전의 손가락 글 — 처음 화면과 같은 CSS 갈래(143차)', () => {
    openShortcutsDialog(document.body, vi.fn());
    const notes = [...document.querySelectorAll<HTMLElement>('.sc-note')];
    // jsdom은 CSS 미디어(pointer: coarse)를 풀지 않아 갈래 클래스로 본다(styles.css .fine-only·.coarse-only — 처음 화면 app.ts와 같은 꼴)
    for (const n of notes) if (/왼쪽 끌기|오른쪽 끌기|휠/.test(n.textContent!)) expect(n.classList.contains('fine-only'), n.textContent!).toBe(true);
    const fine = notes.filter((n) => n.classList.contains('fine-only'));
    const coarse = notes.filter((n) => n.classList.contains('coarse-only'));
    expect(fine.length).toBe(1);
    expect(coarse.length).toBe(1);
    // 손가락 글은 처음 화면 손가락 안내와 같은 낱말, 입력 칸 글은 두 갈래 모두(하드웨어 키보드를 단 태블릿)
    const touch = coarse[0]!.textContent!;
    expect(touch).toContain('한 손가락 끌기 돌리기 · 두 손가락 옮기기·확대');
    for (const n of [...fine, ...coarse]) expect(n.textContent).toMatch(/^입력 칸에 글을 넣는 동안에는 바로 가기가 듣지 않습니다\. 3D 보기: /);
    // 네 언어 모두 사전 글(한글이 남지 않음)이고 손가락 낱말을 쓰며 마우스 낱말(누르기·휠·왼쪽·오른쪽 버튼)은 없다
    const words: Record<string, [finger: RegExp, mouse: RegExp]> = {
      en: [/finger/i, /mouse|click|wheel|left|right/i],
      ja: [/本指/, /マウス|クリック|ホイール|左|右/],
      'zh-CN': [/单指|双指/, /鼠标|点击|单击|滚轮|左键|右键/],
      de: [/Finger/, /Maus|klick/i],
    };
    for (const [code, [finger, mouse]] of Object.entries(words)) {
      const t = translate(touch, code);
      expect(t, code).not.toMatch(/[가-힣]/);
      expect(t, code).toMatch(finger);
      expect(t, code).not.toMatch(mouse);
    }
  });
});
