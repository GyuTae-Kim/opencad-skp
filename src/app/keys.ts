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
 * measureOff = 측정 끄기(측정 점이 없을 때 Esc — 첫 Esc는 뷰어가 점을 지운다), cancelOpen = 여는 중인 파일 그만 열기, open = 열기 상자,
 * page = 이전·다음 장면(PageUp·PageDown), tape = 줄자 켜고 끄기(T), walkOff = 걷기 끝내기(걷는 중 지울 것이 없는 Esc),
 * help = 키보드 바로 가기 안내(?, 문서가 없어도)
 */
export type KeyAction =
  | { kind: 'grid' }
  | { kind: 'viewer' }
  | { kind: 'clearSelection' }
  | { kind: 'measureOff' }
  | { kind: 'cancelOpen' }
  | { kind: 'open' }
  | { kind: 'page'; delta: 1 | -1 }
  | { kind: 'tape' }
  | { kind: 'walkOff' }
  | { kind: 'help' };

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
  /** 장면(페이지)이 있는지 — PageUp·PageDown으로 넘긴다 */
  hasPages?: boolean;
  /** 걷는 중인지(코어 걷기 — W·A·S·D·화살표·Q·E·PageUp·PageDown이 움직임) */
  walking?: boolean;
  /** 초점이 화살표·PageUp·PageDown을 스스로 쓰는 곳(패널 목록·메뉴·장면 탭·슬라이더)에 있는지 */
  inList?: boolean;
}

/** 목록·슬라이더가 스스로 쓰는 이동 키 */
const LIST_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

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
  // ? = 바로 가기 안내(Shift+/ — 걷기 키와 겹치지 않는다)
  if (k.key === '?' && !mod && !k.alt) return { kind: 'help' };
  if (!k.hasDoc) return null;
  if (mod || k.alt) return null;
  // 패널 목록·메뉴·슬라이더에 초점이 있으면 이동 키는 그쪽 것(걷기·장면 넘기기로 보내지 않는다)
  if (k.inList && LIST_KEYS.has(k.key)) return null;
  if (k.key === 'F7') return { kind: 'grid' };
  // 걷는 중 PageUp·PageDown은 위·아래로(장면 넘기기 대신)
  if (k.walking && (k.key === 'PageDown' || k.key === 'PageUp')) return { kind: 'viewer' };
  if (k.hasPages && (k.key === 'PageDown' || k.key === 'PageUp')) return { kind: 'page', delta: k.key === 'PageDown' ? 1 : -1 };
  // SketchUp 기본 키: T = 줄자
  if (k.key === 't' || k.key === 'T') return { kind: 'tape' };
  if (k.key === 'Escape') {
    if ((k.measurePoints ?? 0) > 0) return { kind: 'viewer' };
    if (k.measureMode) return { kind: 'measureOff' };
    if (k.walking) return { kind: 'walkOff' };
    return { kind: 'clearSelection' };
  }
  return { kind: 'viewer' };
}

/** 뷰어의 전체 보기(F)·표준 뷰(1~7) 키인지(수정 키 없이) — 앱이 그 전에 넓힌 시야각을 되돌린다 */
export function isViewKey(k: Pick<KeyInput, 'key' | 'ctrl' | 'meta' | 'alt'>): boolean {
  if (k.ctrl || k.meta || k.alt) return false;
  return k.key === 'f' || k.key === 'F' || Object.prototype.hasOwnProperty.call(VIEW_KEYS, k.key);
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
