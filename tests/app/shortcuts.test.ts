// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyAction } from '../../src/app/keys';
import { SHORTCUTS, openShortcutsDialog } from '../../src/app/shortcuts';

const press = (el: Element, key: string, shiftKey = false): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
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
});
