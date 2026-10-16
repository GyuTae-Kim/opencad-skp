/**
 * 밝은·어두운 테마: 기본은 시스템 설정(prefers-color-scheme)을 따르고, 사용자가 고르면 localStorage에 기억한다.
 * 저장소를 못 쓰는 환경(사생활 보호 창 등)에서도 깨지지 않게 모두 try/catch로 감싼다.
 */

export type ThemeName = 'light' | 'dark';

export const THEME_KEY = 'opencad-skp.theme';

/** 저장한 선택과 시스템 설정 → 쓸 테마 */
export function resolveTheme(stored: string | null | undefined, systemDark: boolean): ThemeName {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemDark ? 'dark' : 'light';
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 기억한 테마(없거나 못 읽으면 null) */
export function readStoredTheme(s: StorageLike | null = storage()): ThemeName | null {
  try {
    const v = s?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** 테마 기억(null이면 지워서 시스템 설정을 따른다) */
export function storeTheme(theme: ThemeName | null, s: StorageLike | null = storage()): void {
  try {
    if (theme) s?.setItem(THEME_KEY, theme);
    else s?.removeItem(THEME_KEY);
  } catch {
    /* 저장소를 못 쓰면 이번 창에서만 바꾼다 */
  }
}

/** 테마 고르기: 시스템 설정 따르기 · 밝게 · 어둡게 */
export type ThemeChoice = 'system' | ThemeName;

export const THEME_CHOICES: readonly { choice: ThemeChoice; label: string; icon: string }[] = [
  { choice: 'system', label: '시스템 설정 따르기', icon: 'system' },
  { choice: 'light', label: '밝은 테마', icon: 'sun' },
  { choice: 'dark', label: '어두운 테마', icon: 'moon' },
];

/** 기억한 선택 → 고르기 메뉴의 현재 항목 */
export function themeChoiceOf(stored: ThemeName | null): ThemeChoice {
  return stored ?? 'system';
}

/** 고르기 → 기억할 값(시스템이면 지운다)과 쓸 테마 */
export function applyThemeChoice(choice: ThemeChoice, systemDark: boolean): { stored: ThemeName | null; theme: ThemeName } {
  const stored = choice === 'system' ? null : choice;
  return { stored, theme: resolveTheme(stored, systemDark) };
}

/** 시스템이 어두운 테마인지 */
export function systemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}
