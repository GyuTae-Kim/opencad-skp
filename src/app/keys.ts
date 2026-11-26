/**
 * 창 키 → 할 일(순수 함수). F·1~7·Esc(측정 지우기)는 뷰어 규칙(Viewer3d.handleKey)에 넘기고,
 * 앱은 입력 칸 걸러내기·F7 격자·Ctrl/⌘+O 열기·Esc 차례(취소 → 측정 지우기 → 측정 끄기 → 고른 것 지우기)를 맡는다.
 * 창 캡처 단계에서 받으므로 캔버스에 초점이 없어도(단추 등) 같은 키가 뷰어로 간다.
 */
// 숫자 키 → 표준 뷰 표는 코어의 작은 viewkeys 모듈에서(0.10.0 camera, 코어 0.54.0부터 viewkeys — 코어 입구는 문서를 열 때 나눠 받으므로(core.ts)
// 첫 화면 메뉴 글도 이 모듈로 만든다). 표준 뷰 → 키 글자(메뉴 안내)는 코어 viewKeyOf(60차 — 앱 표 VIEW_KEY_OF를 뺐다: 코어 입구가 내보내는 함수라 첫 화면 조각에 이미 든다)
import { VIEW_KEYS, type ViewName } from 'opencad-viewer3d/viewkeys';

/** 표준 뷰 메뉴 차례 */
export const VIEW_MENU: readonly ViewName[] = ['top', 'front', 'right', 'left', 'back', 'bottom', 'seIso', 'swIso', 'neIso', 'nwIso'];

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
  /** 3D 보기 가상 커서(키보드 고르기 — 56차)가 켜져 있는지: Esc는 고른 것을 지우기 전에 커서를 끈다 */
  keyCursor?: boolean;
}

/** 목록·슬라이더가 스스로 쓰는 이동 키 */
const LIST_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * 키 하나 → 할 일(없으면 null).
 * Esc 차례(다른 두 OpenCAD 앱과 같게): 여는 중이면 취소 → 측정 점이 있으면 뷰어가 지움 → 측정 중이면 측정 끄기 → 고른 것 지우기.
 * 걷는 중이면 고른 것 대신 걷기 끝, 가상 커서(56차)가 켜져 있으면 고른 것 대신 뷰어가 커서를 끈다(키보드로 고른 것을 남긴 채 나간다).
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
    if (k.keyCursor) return { kind: 'viewer' };
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

/** 키 대상이 화살표·PageUp·PageDown을 스스로 쓰는 곳(패널 목록·메뉴·장면 탭·패널 크기 손잡이·슬라이더 등 입력)인지(app.ts 창 키 — keypick.ts LIST_TARGETS와 같은 고르개) */
export function inList(t: EventTarget | null): boolean {
  const el = t as Element | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('.panel, .menu, .scene-tabs, .resizer, .measure-log, input, select, [role="tree"], [role="listbox"]');
}

/**
 * 157차: 키 대상이 메뉴(role=menu — 공용 언어 고르기 메뉴 등) 안이고 그 메뉴가 스스로 쓰는 키(Esc·화살표·Home·End·PageUp·PageDown)인지.
 * 그러면 앱 창 키(app.ts onKey — 캡처)는 손대지 않는다: 언어 메뉴는 앱 목록 판정(inList)에 들지 않아, 걷는 중이면 화살표가 걷기·Esc가 걷기 끝,
 * 줄자·각도기를 켠 동안이면 화살표가 방향 잠금·Esc가 측정 지우기로 먼저 가 메뉴가 움직이지도 닫히지도 않았다. Tab·Enter는 그대로 앱 차례.
 * 158차: 대화 상자(role=dialog — 그림 저장 창) 안의 Esc(APG: 닫기)도 그 창 것 — inList는 Esc를 거르지 않아 줄자·각도기를 켠 동안 Esc가 창을 닫지 않고
 * 잰 결과를 지웠다(걷기 끝·고른 안내 풀기도 같음). 창 안의 이동 키는 메뉴가 아니므로 그대로(크기 radio는 이미 inList)
 * 164차: 메뉴 안의 글자·숫자·기호 키(인쇄되는 글자 하나 — Space·Shift 글자 포함)도 mod(Ctrl·⌘·Alt)가 없으면 그 메뉴 것(APG Menu: 글자는 그 글자로 시작하는 항목으로 —
 * 선택 사항이라 이 앱은 넣지 않음, 메뉴 밖 단축키로 보내지 않음). 앱 창 키가 F 전체 보기·1~7 표준 뷰·T 줄자·걷기 W·? 안내·측정값 칸 숫자로 가져가
 * 메뉴가 열린 채 뒤 3D 보기·도구가 바뀌었다(겹친 것 목록은 T에 떼어져 초점이 문서로). 조합 키(안내 되돌리기·열기·안내 고르기)는 메뉴가 쓰지 않는 명령 키라 앱 것
 * — 메뉴 것으로 돌리면 브라우저 기본 동작(Ctrl+O 파일 열기·Ctrl+A 글 모두 고르기)이 된다
 */
export function menuKey(t: EventTarget | null, key: string, mod = false): boolean {
  const el = t as Element | null;
  return (
    !!el &&
    typeof el.closest === 'function' &&
    (key === 'Escape' ? !!el.closest('[role="menu"],[role="dialog"]') : (LIST_KEYS.has(key) || (key.length === 1 && !mod)) && !!el.closest('[role="menu"]'))
  );
}

/**
 * 160차: 키 대상이 모달 대화 상자(aria-modal="true" — 바로 가기 안내) 안인지. 모달이 열린 동안 앱 창 키(app.ts onKey)는 상자 안의 키를 상자 몫으로 두고
 * (Esc 닫기·Tab 가두기·본문 굴리기), 상자 밖의 키는 뒤 3D 보기·위젯으로 보내지 않는다 — 상자가 뒤 문서를 inert로 만들지 않아(showModal 아님) 주소 막대에서 Tab으로
 * 들어오면 초점이 뒤 버튼·3D 보기 캔버스에 갈 수 있다. 그림 저장 창은 aria-modal=false(모달 아님 — 3D 보기를 그대로 쓰며 저장)라 들지 않는다
 */
export function inModal(t: EventTarget | null): boolean {
  const el = t as Element | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('[aria-modal="true"]');
}
