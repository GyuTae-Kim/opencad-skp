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
      { keys: ['Shift'], label: '줄자 끝점·각도기 방향을 잡는 동안: 누르고 있으면 지금 방향(축·모서리와 나란히·수직) 잠금' },
      { keys: ['→', '←', '↑'], label: '줄자 끝점·각도기 방향을 잡는 동안: 빨강·녹색·파랑 축으로 잠금(다시 누르면 풀기), 각도기 중심 전에는 그 축 평면에 고정' },
      { keys: ['↓'], label: '줄자 끝점·각도기 방향을 잡는 동안: 모서리와 나란히·수직으로 잠금(다시 누르면 풀기)' },
      // 59차: 줄자·각도기 키보드 점 찍기(keypick.ts handleKey — 화살표 잠금과 겹치지 않게 가상 커서는 Enter로만 켠다)
      { keys: ['Enter'], label: '줄자·각도기를 켠 동안 3D 보기에 초점이 있을 때: 가상 커서 켜기, 켠 동안은 커서 자리에 점 찍기' },
      { keys: ['←', '→', '↑', '↓'], label: '줄자·각도기의 가상 커서를 켠 동안: 커서 옮기기(Shift와 함께면 크게 — 그동안 방향 잠금은 Shift)' },
      // 125차: 줄자·각도기 가상 커서의 겹친 스냅 후보 돌리기(measure.ts keyCycle — 124차 마우스 Tab과 같은 규칙)
      { keys: ['Tab', 'Shift+Tab'], label: '줄자·각도기의 가상 커서를 켠 동안: 커서 자리에 겹친 스냅 후보가 둘 이상이면 다음·앞 후보(Enter는 그 후보를 찍고, Esc는 돌리기만 풀기 — 그 밖에는 초점 이동)' },
      { keys: ['Esc'], label: '줄자·각도기의 가상 커서를 켠 동안: 찍은 점·결과를 먼저 지우고, 없으면 커서 끄기' },
      // 124차: 줄자·각도기 마우스 스냅의 겹친 후보 돌리기(measure.ts cycleKey — 코어 0.116.0 tabCycle과 같은 규칙)
      { keys: ['Tab', 'Shift+Tab'], label: '줄자·각도기 마우스 스냅: 커서 자리에 겹친 스냅 후보가 둘 이상이면 다음·앞 후보(누르면 그 후보를 찍고, Esc는 돌리기만 풀기 — 그 밖에는 초점 이동)' },
      { keys: ['Ctrl', 'Option'], label: '줄자·각도기: 안내 두기 켜고 끄기(그 키만 눌렀다 떼기, Mac은 Option) — 줄자 둘째·각도기 셋째 누르기로 안내점·안내선' },
      { keys: ['Delete', 'Backspace'], label: '눌러서 고른 안내점·안내선 지우기(여럿이면 함께, 줄자·각도기를 끈 동안에도)' },
      {
        keys: ['Ctrl', 'Option', 'Shift'],
        label: '줄자·각도기를 끈 동안 안내를 누르거나 끌기: Ctrl(Mac은 Option)은 더하기, Shift는 넣고 빼기, Shift+Ctrl(Shift+Option)은 빼기 — 끌면 고르기 상자(오른쪽으로 끌면 다 든 것, 왼쪽은 걸친 것까지)',
      },
      { keys: ['Ctrl+A', '⌘+A'], label: '줄자·각도기를 끈 동안: 보이는 안내점·안내선 모두 고르기(숨긴 안내는 빼고)' },
      { keys: ['Ctrl+T', '⌘+Shift+A'], label: '줄자·각도기를 끈 동안: 고른 것 모두 풀기(브라우저가 그 키를 먼저 쓰면 Esc)' },
      { keys: ['Ctrl+Z', '⌘+Z'], label: '안내점·안내선을 두거나 지운 것 되돌리기(100단계)' },
      { keys: ['Ctrl+Y', 'Ctrl+Shift+Z', '⌘+Shift+Z'], label: '되돌린 안내 다시 하기' },
      { keys: ['Esc'], label: '여는 중이면 취소 → 측정 점 지우기 → 측정 끄기 → 고른 것 지우기' },
      { keys: ['?'], label: '이 안내 열기' },
    ],
  },
  {
    // 56차: 3D 보기 키보드 고르기(코어 가상 커서·겹친 것 고르기 돌리기 — keypick.ts). 줄자·각도기를 켜면 화살표는 방향 잠금이다
    title: '3D 보기 키보드 고르기',
    items: [
      { keys: ['←', '→', '↑', '↓'], label: '3D 보기에 초점이 있을 때(줄자·각도기를 끈 동안): 가상 커서 켜기·옮기기(Shift와 함께면 크게)' },
      { keys: ['Tab', 'Shift+Tab'], label: '가상 커서를 켠 동안: 커서 자리에 겹친 면·모서리를 앞에서부터 차례로(앞 면 뒤의 것까지)' },
      { keys: ['Enter'], label: '가상 커서를 켠 동안: 지금 차례의 것 고르기(둘째부터는 펼친 단계와 상관없이 그것을 낸 가장 안쪽 그룹·컴포넌트)' },
      { keys: ['Esc'], label: '가상 커서 끄기(그 뒤 Tab은 초점 이동, 한 번 더 누르면 고른 것 지우기)' },
      // 57차: 겹친 것 고르기 목록(picklist.ts — 마우스 오른쪽 단추·손가락 길게 누르기로도 연다). 58차: 가상 커서 없이도 열고 초점 줄을 미리 강조
      {
        keys: ['Shift+F10'],
        label:
          '3D 보기에 초점이 있을 때(줄자·각도기를 끈 동안): 겹친 면·모서리 목록 열기(가상 커서 자리, 커서가 꺼져 있으면 마우스 자리나 3D 보기 가운데 — 초점이 간 줄은 3D에 미리 강조). 마우스는 오른쪽 버튼을 끌지 않고 떼기, 손가락·펜은 길게 누르기',
      },
    ],
  },
  {
    // 44차: 탭 줄·메뉴·나무·가르개의 키(APG 탭·메뉴·나무·창 가르개 패턴 — kbd.ts)
    title: '목록·메뉴·패널',
    items: [
      { keys: ['←', '→'], label: '장면 탭·패널 탭 사이 옮기기(Enter·Space로 고르기)' },
      { keys: ['↑', '↓', 'Home', 'End'], label: '메뉴 항목·그룹·컴포넌트 나무 줄 사이 옮기기(Tab은 메뉴를 닫고 다음으로)' },
      { keys: ['→', '←'], label: '그룹·컴포넌트 나무: 펼치기 → 첫 아이로, 접기 → 부모로' },
      { keys: ['Enter', 'Home', 'End'], label: '패널 크기 가르개: 다음 크기 단계 · 가장 작게 · 가장 크게(화살표는 조금씩, 마우스·손가락은 한 번 누르기)' },
    ],
  },
  {
    title: '걷기(1인칭)',
    items: [
      { keys: ['W', 'S', '↑', '↓'], label: '앞 · 뒤로' },
      { keys: ['A', 'D'], label: '옆으로' },
      { keys: ['←', '→'], label: '돌기' },
      // 142차: 코어 걷기는 E·PageUp이 위, Q·PageDown이 아래(앞 · 뒤로 줄처럼 키와 글을 차례로 짝짓는다 — 141차까지 Q, E라 Q가 위로 읽혔다).
      // 걷는 중 PageUp·PageDown은 장면 넘기기 대신 위·아래(keys.ts)
      { keys: ['E', 'Q', 'PageUp', 'PageDown'], label: '위 · 아래로(중력을 끈 때)' },
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
  // 키보드로 굴리려고 초점을 받는 본문은 이름 있는 영역으로(44차 — 화면 읽기에 이름 없는 묶음이었다)
  const body = h('div', { class: 'sc-body', role: 'region', 'aria-labelledby': titleId });
  for (const g of SHORTCUTS) {
    const dl = h('dl', { class: 'sc-list' });
    for (const it of g.items) dl.append(h('dt', {}, keyChips(it.keys)), h('dd', {}, it.label));
    body.append(h('section', { class: 'sc-group' }, h('h3', {}, g.title), dl));
  }
  // 끝 줄의 3D 보기 조작은 그 기기의 글로(143차 — 손가락 기기에도 왼쪽·오른쪽 끌기·휠 글이라 쓸 수 없는 안내였다): 처음 화면 안내(app.ts)와 같은
  // CSS 갈래(styles.css .fine-only·.coarse-only — pointer: coarse)와 같은 손가락 낱말. 입력 칸 글은 두 갈래 모두(하드웨어 키보드를 단 태블릿)
  body.append(
    h('p', { class: 'sc-note fine-only' }, '입력 칸에 글을 넣는 동안에는 바로 가기가 듣지 않습니다. 3D 보기: 왼쪽 끌기 돌리기 · 오른쪽 끌기 옮기기 · 휠 확대.'),
    h('p', { class: 'sc-note coarse-only' }, '입력 칸에 글을 넣는 동안에는 바로 가기가 듣지 않습니다. 3D 보기: 한 손가락 끌기 돌리기 · 두 손가락 옮기기·확대.'),
  );
  const box = h('div', { class: 'sc-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, h('div', { class: 'sc-head' }, h('h2', { id: titleId }, '키보드 바로 가기'), closeBtn), body);
  const backdrop = h('div', { class: 'sc-backdrop' }, box);
  // 165차: 열린 동안 parent의 다른 칸(앱 화면·공용 띠)은 inert — aria-modal=true의 약속(WAI-ARIA aria-modal: 모달 밖은 쓸 수 없음, HTML showModal 꼴).
  // 160차는 상자 밖 초점의 키만 막아, 주소 막대에서 Tab으로 들어오면 초점이 뒤 버튼·3D 보기로 가 Tab이 뒤 문서를 돌고 화면 읽기도 뒤를 읽었다.
  // 이미 inert인 칸은 건드리지 않는다
  const back = [...parent.children].filter((el) => !el.hasAttribute('inert'));
  for (const el of back) el.setAttribute('inert', '');
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    // 연 곳에 초점을 돌려주기 전에 푼다(inert 안은 초점을 받지 않는다)
    for (const el of back) el.removeAttribute('inert');
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    onClose();
  };
  closeBtn.addEventListener('click', close);
  // 바깥(어두운 바탕) 누르기: 마우스는 누를 때 닫는다. 손가락·펜은 그 탭의 click에서 닫는다(140차) — 브라우저는 손가락 탭을 뗀 뒤
  // 그 자리 요소에 click을 내므로, 누를 때 바탕을 떼면 그 click이 밑의 제목 막대·도구 막대 단추·링크, 장면 탭을 누른다.
  // 바탕에서 시작한 누르기만 닫는다(상자 안에서 누르고 바탕에서 뗀 click은 두 요소의 공통 조상인 바탕으로 온다)
  let tap = false;
  backdrop.addEventListener('pointerdown', (e) => {
    tap = e.target === backdrop && (e.pointerType === 'touch' || e.pointerType === 'pen');
    if (e.target === backdrop && !tap) close();
  });
  backdrop.addEventListener('click', (e) => {
    if (tap && e.target === backdrop) close();
    tap = false;
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
