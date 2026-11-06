/**
 * 키보드로 쓰기(44차 — WAI-ARIA APG의 탭·메뉴·나무 패턴과 WCAG 2.4.3 초점 차례):
 * 목록 안 이동 키(화살표·Home·End), 하나만 Tab 차례에 두기(로빙 tabindex), 다시 그린 뒤 초점 되찾기, 사라진 초점 옮기기.
 * 앱 화면(도구 막대 메뉴·패널 탭·장면 탭·구성 나무)이 함께 쓴다.
 */

/** 이동 키 → 다음 차례(그 키가 아니면 null). wrap이면 끝에서 처음으로, 아니면 끝에 멈춘다. i가 -1이면 다음은 처음, 앞은 끝 */
export function moveIndex(key: string, i: number, n: number, prev: string, next: string, wrap = true): number | null {
  if (n < 1) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key === next) return i < 0 ? 0 : i < n - 1 ? i + 1 : wrap ? 0 : i;
  if (key === prev) return i < 0 ? n - 1 : i > 0 ? i - 1 : wrap ? n - 1 : i;
  return null;
}

/** 하나만 Tab 차례(tabindex 0), 나머지는 -1. withBox면 줄 안 보이기 체크도 같이(나무 줄 — 지금 줄의 체크만 Tab으로 닿는다) */
export function rove(items: readonly HTMLElement[], on: HTMLElement | null | undefined, withBox = false): void {
  for (const el of items) {
    el.tabIndex = el === on ? 0 : -1;
    if (withBox) {
      const cb = el.querySelector<HTMLInputElement>(':scope > input[type=checkbox]');
      if (cb) cb.tabIndex = el === on ? 0 : -1;
    }
  }
}

/**
 * 목록 안 이동(초점만 옮긴다 — 고르기는 Enter·Space): 꺼진 항목은 건너뛴다. roving 1 = 옮긴 항목만 Tab 차례, 2 = 줄 안 체크까지, 0 = 그대로(메뉴).
 * 다룬 키면 true
 */
export function listKeys(e: KeyboardEvent, all: readonly HTMLElement[], prev: string, next: string, wrap = true, roving: 0 | 1 | 2 = 1): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return false;
  const items = all.filter((el) => !(el as HTMLButtonElement).disabled);
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return false;
  const j = moveIndex(e.key, i, items.length, prev, next, wrap);
  if (j === null) return false;
  e.preventDefault();
  if (roving) rove(items, items[j], roving > 1);
  items[j]!.focus();
  return true;
}

/**
 * 나무(role=tree) 키: ↑↓·Home·End는 보이는 줄 사이, →는 펼친 줄의 첫 아이로, ←는 접힌 줄·잎에서 부모로
 * (닫힌 줄 펼치기·펼친 줄 접기는 줄이 먼저 받는다). 다룬 키면 true
 */
export function treeKeys(e: KeyboardEvent, tree: HTMLElement): boolean {
  if (listKeys(e, [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')], 'ArrowUp', 'ArrowDown', false, 2)) return true;
  if (e.defaultPrevented || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return false;
  const items = [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const cur = document.activeElement as HTMLElement;
  const i = items.indexOf(cur);
  if (i < 0) return false;
  const level = (el: HTMLElement | undefined): number => Number(el?.getAttribute('aria-level') || 1);
  const lv = level(cur);
  let j = -1;
  if (e.key === 'ArrowRight' && cur.getAttribute('aria-expanded') === 'true' && level(items[i + 1]) > lv) j = i + 1;
  if (e.key === 'ArrowLeft' && cur.getAttribute('aria-expanded') !== 'true') for (let k = i - 1; k >= 0 && j < 0; k--) if (level(items[k]) < lv) j = k;
  if (j < 0) return false;
  e.preventDefault();
  rove(items, items[j], true);
  items[j]!.focus();
  return true;
}

/** 초점 자리 열쇠(다시 그려도 같은 것을 찾게): 자료 열쇠 속성이 있으면 그것, 없으면 같은 태그·첫 이름표 안 차례 */
const SPOT_KEYS = ['id', 'data-node', 'data-tag', 'data-folder', 'data-outline', 'data-sel', 'data-page'];
export type FocusSpot = { attr: string; value: string } | { css: string; index: number };

/** root 안에 초점이 있으면 그 자리(없으면 null) */
export function focusSpot(root: HTMLElement): FocusSpot | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === root || !root.contains(a)) return null;
  for (const attr of SPOT_KEYS) {
    const value = a.getAttribute(attr);
    if (value) return { attr, value };
  }
  // 첫 이름표만(눌림·고름 같은 상태 이름표는 다시 그리면 바뀐다)
  const css = a.localName + (a.classList[0] ? '.' + a.classList[0] : '');
  return { css, index: [...root.querySelectorAll(css)].indexOf(a) };
}

/** 다시 그린 뒤 초점이 사라졌으면(body·끊긴 요소) 같은 자리로 되돌린다 */
export function refocus(root: HTMLElement, spot: FocusSpot | null): void {
  if (!spot || !lost()) return;
  const el =
    'attr' in spot
      ? [...root.querySelectorAll<HTMLElement>(`[${spot.attr}]`)].find((x) => x.getAttribute(spot.attr) === spot.value)
      : root.querySelectorAll<HTMLElement>(spot.css)[spot.index];
  el?.focus({ preventScroll: true });
}

/** 초점이 사라졌는지: 아무 데도 없거나(body), 문서에서 빠졌거나, 숨긴 곳(inside 안이면 그것도 — 곧 숨길 곳) */
export function lost(inside?: Element | null): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !a || a === document.body || !a.isConnected || !!a.closest('[hidden]') || !!inside?.contains(a);
}

/** 초점이 사라졌으면(또는 곧 숨길 inside 안이면) el로 옮긴다(키보드 사용자가 제자리를 잃지 않게 — 스크롤은 그대로) */
export function focusIfLost(el: HTMLElement | null | undefined, inside?: Element | null): void {
  if (el?.isConnected && !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled && lost(inside)) el.focus({ preventScroll: true });
}
