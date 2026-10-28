// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashNote } from '../../src/app/flash';

describe('측정 띠 알림', () => {
  afterEach(() => vi.useRealTimers());

  it('잠깐 보이고 사라지며, 새 알림은 앞 알림의 시간을 바꾼다', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.hidden = true;
    const n = new FlashNote(el);
    n.show('복사했습니다');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('복사했습니다');
    vi.advanceTimersByTime(1000);
    n.show('잠글 방향이 없습니다', 3200, 'no-lock');
    vi.advanceTimersByTime(1000);
    // 앞 알림의 1.6초가 지났어도 새 알림은 그대로
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('잠글 방향이 없습니다');
    vi.advanceTimersByTime(2300);
    expect(el.hidden).toBe(true);
  });

  it('종류를 붙인 알림만 그 종류로 거둔다(잠근 뒤 잠글 방향이 없다는 알림이 남지 않게)', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const n = new FlashNote(el);
    n.show('잠글 방향이 없습니다', 3200, 'no-lock');
    n.drop('other');
    expect(el.hidden).toBe(false);
    n.drop('no-lock');
    expect(el.hidden).toBe(true);
    // 거둔 뒤 남은 시간에 다시 띄운 알림을 앞 타이머가 지우지 않는다
    n.show('복사했습니다');
    vi.advanceTimersByTime(1500);
    expect(el.hidden).toBe(false);
    // 종류 없는 알림(복사)은 잠금으로 거두지 않는다
    n.drop('no-lock');
    expect(el.hidden).toBe(false);
    vi.advanceTimersByTime(200);
    expect(el.hidden).toBe(true);
  });
});
