/**
 * 창 키 → 할 일(순수 함수). F·1~7·Esc(측정 지우기)는 뷰어 규칙(Viewer3d.handleKey)에 넘기고,
 * 앱은 입력 칸 걸러내기·F7 격자·측정이 없을 때의 Esc(고른 것 지우기)만 맡는다.
 * 창 캡처 단계에서 받으므로 캔버스에 초점이 없어도(단추 등) 같은 키가 뷰어로 간다.
 */
import { VIEW_KEYS, type ViewName } from 'opencad-viewer3d';

/** 표준 뷰 메뉴 차례 */
export const VIEW_MENU: readonly ViewName[] = ['top', 'front', 'right', 'left', 'back', 'bottom', 'seIso', 'swIso', 'neIso', 'nwIso'];

/** 표준 뷰 → 키 글자(메뉴 안내, 뷰어의 VIEW_KEYS에서) */
export const VIEW_KEY_OF: Readonly<Partial<Record<ViewName, string>>> = Object.fromEntries(Object.entries(VIEW_KEYS).map(([k, v]) => [v, k]));

/** grid = 격자 켜고 끄기, viewer = Viewer3d.handleKey에 넘기기, clearSelection = 고른 것 지우기 */
export type KeyAction = { kind: 'grid' } | { kind: 'viewer' } | { kind: 'clearSelection' };

export interface KeyInput {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  /** 입력 칸·편집 가능한 곳에 초점 */
  editable?: boolean;
  /** 열린 문서가 있는지(해석 중이면 false) */
  hasDoc?: boolean;
  /** 지금 찍힌 측정 점 수(Viewer3d.measurePointCount) */
  measurePoints?: number;
}

/** 키 하나 → 할 일(없으면 null) */
export function keyAction(k: KeyInput): KeyAction | null {
  if (k.editable || !k.hasDoc) return null;
  if (k.ctrl || k.meta || k.alt) return null;
  if (k.key === 'F7') return { kind: 'grid' };
  // Esc: 측정 점이 있으면 뷰어가 측정을 지우고, 없으면 앱이 고른 것을 지운다
  if (k.key === 'Escape') return (k.measurePoints ?? 0) > 0 ? { kind: 'viewer' } : { kind: 'clearSelection' };
  return { kind: 'viewer' };
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
