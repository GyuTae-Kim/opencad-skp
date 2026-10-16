import { describe, expect, it } from 'vitest';
import { VIEW_KEY_OF, VIEW_MENU, isEditableTarget, keyAction } from '../../src/app/keys';
import { parseLaunch } from '../../src/app/launch';
import { THEME_KEY, readStoredTheme, resolveTheme, storeTheme } from '../../src/app/theme';

describe('키 → 보기 명령', () => {
  const base = { hasDoc: true };
  it('초점이 캔버스 밖이어도 F·1~7·Esc·F7이 뷰어로 간다', () => {
    expect(keyAction({ ...base, key: 'f' })).toEqual({ kind: 'fit' });
    expect(keyAction({ ...base, key: 'F' })).toEqual({ kind: 'fit' });
    expect(keyAction({ ...base, key: '1' })).toEqual({ kind: 'view', view: 'front' });
    expect(keyAction({ ...base, key: '5' })).toEqual({ kind: 'view', view: 'top' });
    expect(keyAction({ ...base, key: '7' })).toEqual({ kind: 'view', view: 'seIso' });
    expect(keyAction({ ...base, key: '8' })).toBeNull();
    expect(keyAction({ ...base, key: 'Escape' })).toEqual({ kind: 'escape' });
    expect(keyAction({ ...base, key: 'F7' })).toEqual({ kind: 'grid' });
  });

  it('캔버스에 초점이면 F·1~7은 뷰어가 직접 받고, Esc·F7만 앱이 받는다', () => {
    const c = { ...base, onCanvas: true };
    expect(keyAction({ ...c, key: 'f' })).toBeNull();
    expect(keyAction({ ...c, key: '3' })).toBeNull();
    expect(keyAction({ ...c, key: 'Escape' })).toEqual({ kind: 'escape' });
    expect(keyAction({ ...c, key: 'F7' })).toEqual({ kind: 'grid' });
  });

  it('입력 칸·보조키·문서 없음은 건드리지 않는다', () => {
    expect(keyAction({ ...base, key: 'f', editable: true })).toBeNull();
    expect(keyAction({ ...base, key: '1', ctrl: true })).toBeNull();
    expect(keyAction({ ...base, key: '1', meta: true })).toBeNull();
    expect(keyAction({ ...base, key: 'F7', alt: true })).toBeNull();
    expect(keyAction({ key: 'f' })).toBeNull();
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

  it('표준 뷰 메뉴의 키 안내', () => {
    expect(VIEW_MENU.length).toBe(10);
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
