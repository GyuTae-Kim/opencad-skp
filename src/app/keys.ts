/**
 * 창 키 → 할 일(순수 함수). F·1~7·Esc(측정 지우기)는 뷰어 규칙(Viewer3d.handleKey)에 넘기고,
 * 앱은 입력 칸 걸러내기·F7 격자·Ctrl/⌘+O 열기·Esc 차례(취소 → 측정 지우기 → 측정 끄기 → 고른 것 지우기)를 맡는다.
 * 창 캡처 단계에서 받으므로 캔버스에 초점이 없어도(단추 등) 같은 키가 뷰어로 간다.
 */
import { VIEW_KEYS, type ViewName } from 'opencad-viewer3d';

/** 표준 뷰 메뉴 차례 */
export const VIEW_MENU: readonly ViewName[] = ['top', 'front', 'right', 'left', 'back', 'bottom', 'seIso', 'swIso', 'neIso', 'nwIso'];

/** 표준 뷰 → 키 글자(메뉴 안내, 뷰어의 VIEW_KEYS에서) */
export const VIEW_KEY_OF: Readonly<Partial<Record<ViewName, string>>> = Object.fromEntries(Object.entries(VIEW_KEYS).map(([k, v]) => [v, k]));

/**
 * grid = 격자 켜고 끄기, viewer = Viewer3d.handleKey에 넘기기, clearSelection = 고른 것 지우기,
 * measureOff = 측정 끄기(측정 점이 없을 때 Esc — 첫 Esc는 뷰어가 점을 지운다), cancelOpen = 여는 중인 파일 그만 열기, open = 열기 상자
 */
export type KeyAction =
  | { kind: 'grid' }
  | { kind: 'viewer' }
  | { kind: 'clearSelection' }
  | { kind: 'measureOff' }
  | { kind: 'cancelOpen' }
  | { kind: 'open' };

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
  /** 측정 모드인지(Viewer3d.measureMode) */
  measureMode?: boolean;
  /** 파일을 여는(해석하는) 중인지 */
  busy?: boolean;
}

/**
 * 키 하나 → 할 일(없으면 null).
 * Esc 차례(다른 두 OpenCAD 앱과 같게): 여는 중이면 취소 → 측정 점이 있으면 뷰어가 지움 → 측정 중이면 측정 끄기 → 고른 것 지우기.
 * 그래서 측정 중에는 Esc 두 번이면 측정이 꺼진다.
 */
export function keyAction(k: KeyInput): KeyAction | null {
  if (k.editable) return null;
  const mod = !!(k.ctrl || k.meta);
  if (mod && !k.alt && (k.key === 'o' || k.key === 'O')) return { kind: 'open' };
  if (k.key === 'Escape' && k.busy && !mod && !k.alt) return { kind: 'cancelOpen' };
  if (!k.hasDoc) return null;
  if (mod || k.alt) return null;
  if (k.key === 'F7') return { kind: 'grid' };
  if (k.key === 'Escape') {
    if ((k.measurePoints ?? 0) > 0) return { kind: 'viewer' };
    if (k.measureMode) return { kind: 'measureOff' };
    return { kind: 'clearSelection' };
  }
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
