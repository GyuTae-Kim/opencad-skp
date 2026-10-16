/**
 * 키 → 보기 명령(순수 함수). 캔버스에 초점이 있으면 뷰어가 F·1~7을 직접 받으므로 여기서는 넘기고,
 * 초점이 다른 곳(단추 등)이어도 입력 칸만 아니면 같은 키가 뷰어로 가게 한다. F7은 어디서나 격자.
 */
import type { ViewName } from 'opencad-viewer3d';

/** 뷰어와 같은 표준 뷰 키 */
export const VIEW_KEYS: Readonly<Record<string, ViewName>> = { '1': 'front', '2': 'back', '3': 'left', '4': 'right', '5': 'top', '6': 'bottom', '7': 'seIso' };

/** 표준 뷰 메뉴 차례 */
export const VIEW_MENU: readonly ViewName[] = ['top', 'front', 'right', 'left', 'back', 'bottom', 'seIso', 'swIso', 'neIso', 'nwIso'];

/** 표준 뷰 → 키 글자(메뉴 안내) */
export const VIEW_KEY_OF: Readonly<Partial<Record<ViewName, string>>> = Object.fromEntries(Object.entries(VIEW_KEYS).map(([k, v]) => [v, k]));

export type KeyAction = { kind: 'fit' } | { kind: 'view'; view: ViewName } | { kind: 'grid' } | { kind: 'escape' };

export interface KeyInput {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  /** 입력 칸·편집 가능한 곳에 초점 */
  editable?: boolean;
  /** 3D 캔버스에 초점 */
  onCanvas?: boolean;
  /** 열린 문서가 있는지 */
  hasDoc?: boolean;
}

/** 키 하나 → 할 일(없으면 null) */
export function keyAction(k: KeyInput): KeyAction | null {
  if (k.editable || !k.hasDoc) return null;
  if (k.ctrl || k.meta || k.alt) return null;
  if (k.key === 'F7') return { kind: 'grid' };
  if (k.key === 'Escape') return { kind: 'escape' };
  // 캔버스는 뷰어가 F·1~7을 직접 받는다
  if (k.onCanvas) return null;
  if (k.key === 'f' || k.key === 'F') return { kind: 'fit' };
  const view = VIEW_KEYS[k.key];
  if (view) return { kind: 'view', view };
  return null;
}

/** 이벤트 대상이 글을 넣는 곳인지 */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as HTMLElement).tagName !== 'string') return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return !!el.isContentEditable;
}
