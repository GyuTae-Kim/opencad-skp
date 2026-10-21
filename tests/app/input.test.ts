import { describe, expect, it } from 'vitest';
import { VIEW_KEYS } from 'opencad-viewer3d';
import { VIEW_KEY_OF, VIEW_MENU, isEditableTarget, isViewKey, keyAction } from '../../src/app/keys';
import { parseLaunch } from '../../src/app/launch';
import { THEME_KEY, readStoredTheme, resolveTheme, storeTheme } from '../../src/app/theme';

describe('키 → 할 일', () => {
  it('전체 보기·표준 뷰 키(넓힌 시야각을 먼저 되돌릴 키)', () => {
    for (const key of ['f', 'F', ...Object.keys(VIEW_KEYS)]) expect(isViewKey({ key })).toBe(true);
    for (const key of ['F7', 'Escape', 't', 'toString', 'constructor', '9']) expect(isViewKey({ key })).toBe(false);
    expect(isViewKey({ key: 'f', ctrl: true })).toBe(false);
    expect(isViewKey({ key: '1', alt: true })).toBe(false);
  });

  const base = { hasDoc: true };
  it('F·1~7은 뷰어 규칙(handleKey)으로, F7은 격자', () => {
    expect(keyAction({ ...base, key: 'f' })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: '5' })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: 'F7' })).toEqual({ kind: 'grid' });
  });

  it('Esc: 측정 점이 있으면 뷰어가 측정을, 없으면 앱이 고른 것을 지운다', () => {
    expect(keyAction({ ...base, key: 'Escape', measurePoints: 1 })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: 'Escape', measurePoints: 2 })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: 'Escape', measurePoints: 0 })).toEqual({ kind: 'clearSelection' });
    expect(keyAction({ ...base, key: 'Escape' })).toEqual({ kind: 'clearSelection' });
  });

  it('입력 칸·보조키·문서 없음(해석 중)은 건드리지 않는다', () => {
    expect(keyAction({ ...base, key: 'f', editable: true })).toBeNull();
    expect(keyAction({ ...base, key: '1', ctrl: true })).toBeNull();
    expect(keyAction({ ...base, key: '1', meta: true })).toBeNull();
    expect(keyAction({ ...base, key: 'F7', alt: true })).toBeNull();
    expect(keyAction({ key: 'f' })).toBeNull();
    expect(keyAction({ key: 'Escape', hasDoc: false, measurePoints: 2 })).toBeNull();
  });

  it('입력 칸 가리기(체크 상자·단추는 입력 칸이 아니다)', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}): EventTarget => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;
    expect(isEditableTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isEditableTarget(el('INPUT', { type: 'search' }))).toBe(true);
    expect(isEditableTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
    expect(isEditableTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('표준 뷰 메뉴의 키 안내는 뷰어의 VIEW_KEYS에서', () => {
    expect(VIEW_MENU.length).toBe(10);
    for (const [k, v] of Object.entries(VIEW_KEYS)) expect(VIEW_KEY_OF[v]).toBe(k);
    expect(VIEW_KEY_OF.top).toBe('5');
    expect(VIEW_KEY_OF.seIso).toBe('7');
    expect(VIEW_KEY_OF.nwIso).toBeUndefined();
  });
});

describe('주소 인자', () => {
  const base = 'https://gyutae-kim.github.io/opencad-skp/?x';
  it('?sample · 없음', () => {
    expect(parseLaunch('?sample', base)).toEqual({ kind: 'sample' });
    expect(parseLaunch('', base)).toEqual({ kind: 'none' });
    expect(parseLaunch('?theme=dark', base)).toEqual({ kind: 'none' });
  });

  it('?open=은 같은 출처만, 이름은 경로 끝(풀어 쓴 글)', () => {
    expect(parseLaunch('?open=samples/%EC%A7%91.skp', base)).toEqual({
      kind: 'url',
      url: 'https://gyutae-kim.github.io/opencad-skp/samples/%EC%A7%91.skp',
      name: '집.skp',
    });
    expect(parseLaunch('?open=/m.skp&sample', base)).toMatchObject({ kind: 'url', name: 'm.skp' });
    expect(parseLaunch('?open=https://evil.example/m.skp', base).kind).toBe('error');
    expect(parseLaunch('?open=//evil.example/m.skp', base).kind).toBe('error');
    expect(parseLaunch('?open=javascript:alert(1)', base).kind).toBe('error');
    expect(parseLaunch('?open=', base).kind).toBe('error');
  });
});

describe('테마', () => {
  it('기억한 선택이 이기고, 없으면 시스템 설정', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('blue', false)).toBe('light');
  });

  it('저장소를 못 써도 깨지지 않는다', () => {
    const map = new Map<string, string>();
    const ok = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    storeTheme('dark', ok);
    expect(map.get(THEME_KEY)).toBe('dark');
    expect(readStoredTheme(ok)).toBe('dark');
    storeTheme(null, ok);
    expect(readStoredTheme(ok)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('막힘');
      },
      setItem: () => {
        throw new Error('막힘');
      },
      removeItem: () => {
        throw new Error('막힘');
      },
    };
    expect(readStoredTheme(broken)).toBeNull();
    expect(() => storeTheme('light', broken)).not.toThrow();
    expect(readStoredTheme(null)).toBeNull();
  });
});
