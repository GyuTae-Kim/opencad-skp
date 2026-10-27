/**
 * 키보드 바로 가기 안내(? 키·앱 설정 메뉴): 키 목록(순수 자료)과 그것을 보이는 작은 대화 상자.
 * 대화 상자는 열리면 닫기 단추에 초점을 두고, Tab은 상자 안에서만 돌고, Esc·닫기·바깥 누르기로 닫으면 연 곳에 초점을 돌려준다.
 */
import { h, icon } from './dom';

/** 바로 가기 한 줄: 키(여럿이면 "또는"), 하는 일 */
export interface Shortcut {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/** 앱이 실제로 받는 키(keys.ts keyAction·코어 handleKey·걷기·측정 도구)와 같게 둔다 — 시험이 맞춰 본다 */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: '보기',
    items: [
      { keys: ['F'], label: '전체 보기' },
      { keys: ['1', '2', '3', '4', '5', '6', '7'], label: '앞 · 뒤 · 왼쪽 · 오른쪽 · 위 · 아래 · 남동 등각' },
      { keys: ['F7'], label: '바닥 격자 켜고 끄기' },
      { keys: ['PageUp', 'PageDown'], label: '이전 · 다음 장면' },
    ],
  },
  {
    title: '파일·도구',
    items: [
      { keys: ['Ctrl+O', '⌘+O'], label: '파일 열기' },
      { keys: ['T'], label: '줄자 켜고 끄기' },
      { keys: ['0~9', 'Enter'], label: '줄자 시작점을 찍은 뒤: 측정값 칸에 길이 넣기(그 길이에 안내점, 모서리 위에서 시작하면 나란한 안내선)' },
      { keys: ['0~9', 'Enter'], label: '각도기 기준 방향을 찍은 뒤: 측정값 칸에 각도 넣기(그 각도로 안내선)' },
      { keys: ['Shift'], label: '각도기: 지금 평면에 고정' },
      { keys: ['Esc'], label: '여는 중이면 취소 → 측정 점 지우기 → 측정 끄기 → 고른 것 지우기' },
      { keys: ['?'], label: '이 안내 열기' },
    ],
  },
  {
    title: '걷기(1인칭)',
    items: [
      { keys: ['W', 'S', '↑', '↓'], label: '앞 · 뒤로' },
      { keys: ['A', 'D'], label: '옆으로' },
      { keys: ['←', '→'], label: '돌기' },
      { keys: ['Q', 'E'], label: '위 · 아래로(중력을 끈 때)' },
      { keys: ['Shift'], label: '빠르게' },
      { keys: ['Esc'], label: '걷기 끝내기' },
    ],
  },
];

/** 키 하나를 글로(화면에 kbd로) */
function keyChips(keys: readonly string[]): HTMLElement {
  const wrap = h('span', { class: 'sc-keys' });
  keys.forEach((k, i) => {
    if (i) wrap.append(' ');
    wrap.append(h('kbd', { translate: 'no' }, k));
  });
  return wrap;
}

/**
 * 바로 가기 대화 상자. parent에 붙이고 닫기 함수를 돌려준다(이미 열려 있으면 바깥에서 닫고 다시 연다).
 * onClose는 닫힐 때 한 번(Esc·닫기 단추·바깥 누르기)
 */
export function openShortcutsDialog(parent: HTMLElement, onClose: () => void): () => void {
  const opener = document.activeElement as HTMLElement | null;
  const titleId = 'sc-title';
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', title: '닫기', 'aria-label': '닫기', html: icon('close') });
  const body = h('div', { class: 'sc-body' });
  for (const g of SHORTCUTS) {
    const dl = h('dl', { class: 'sc-list' });
    for (const it of g.items) dl.append(h('dt', {}, keyChips(it.keys)), h('dd', {}, it.label));
    body.append(h('section', { class: 'sc-group' }, h('h3', {}, g.title), dl));
  }
  body.append(h('p', { class: 'sc-note' }, '입력 칸에 글을 넣는 동안에는 바로 가기가 듣지 않습니다. 3D 보기: 왼쪽 끌기 돌리기 · 오른쪽 끌기 옮기기 · 휠 확대.'));
  const box = h('div', { class: 'sc-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, h('div', { class: 'sc-head' }, h('h2', { id: titleId }, '키보드 바로 가기'), closeBtn), body);
  const backdrop = h('div', { class: 'sc-backdrop' }, box);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    onClose();
  };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // 상자 안에서만 도는 Tab(닫기 단추와 굴릴 수 있는 본문)
    if (e.key === 'Tab') {
      const list: HTMLElement[] = [closeBtn, body];
      const i = list.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]!.focus();
    }
  });
  // 본문은 키보드로도 굴릴 수 있게(작은 화면)
  body.tabIndex = 0;
  parent.append(backdrop);
  closeBtn.focus();
  return close;
}
