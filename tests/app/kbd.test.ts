// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeOutside, disclose, focusIfLost, focusSpot, keepBarFocus, keepRowFocus, leaveDisabled, listKeys, listRows, lost, menuTab, moveIndex, refocus, rove, setRange, treeKeys } from '../../src/app/kbd';
import { PANEL_WIDTH_STEPS, SHEET_STEPS, clampSheetFraction, nextSize } from '../../src/app/layout';
import type { MeasureToolResult } from '../../src/app/measure';
import { Panel, type PanelHost } from '../../src/app/panel';
import { infoSections } from '../../src/app/infotab';
import { entityInfo } from '../../src/app/entity';
import { selectionEntity } from '../../src/app/doc';
import { mmPerSceneUnit } from '../../src/app/units';
import { rowDoc } from './rowdoc';

const key = (target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

const html = (s: string): HTMLElement => {
  const box = document.createElement('div');
  box.innerHTML = s;
  document.body.append(box);
  return box;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('목록 안 이동 키(44차 — APG 탭·메뉴·나무)', () => {
  it('다음·앞·Home·End, 끝에서 돌기와 멈추기, 초점이 없을 때', () => {
    expect(moveIndex('ArrowRight', 0, 3, 'ArrowLeft', 'ArrowRight')).toBe(1);
    expect(moveIndex('ArrowRight', 2, 3, 'ArrowLeft', 'ArrowRight')).toBe(0);
    expect(moveIndex('ArrowLeft', 0, 3, 'ArrowLeft', 'ArrowRight')).toBe(2);
    expect(moveIndex('ArrowDown', 2, 3, 'ArrowUp', 'ArrowDown', false)).toBe(2);
    expect(moveIndex('ArrowUp', 0, 3, 'ArrowUp', 'ArrowDown', false)).toBe(0);
    expect(moveIndex('Home', 2, 3, 'ArrowUp', 'ArrowDown')).toBe(0);
    expect(moveIndex('End', 0, 3, 'ArrowUp', 'ArrowDown')).toBe(2);
    expect(moveIndex('ArrowDown', -1, 3, 'ArrowUp', 'ArrowDown')).toBe(0);
    expect(moveIndex('ArrowUp', -1, 3, 'ArrowUp', 'ArrowDown')).toBe(2);
    expect(moveIndex('Enter', 1, 3, 'ArrowUp', 'ArrowDown')).toBeNull();
    expect(moveIndex('ArrowDown', 0, 0, 'ArrowUp', 'ArrowDown')).toBeNull();
  });

  it('탭 줄: ←→가 초점만 옮기고 옮긴 탭만 Tab 차례(로빙 tabindex), 꺼진 탭은 건너뛴다', () => {
    const box = html('<div role="tablist"><button role="tab" tabindex="0">가</button><button role="tab" tabindex="-1" disabled>나</button><button role="tab" tabindex="-1">다</button></div>');
    const tabs = [...box.querySelectorAll<HTMLElement>('[role=tab]')];
    const list = box.firstElementChild as HTMLElement;
    list.addEventListener('keydown', (e) => listKeys(e, tabs, 'ArrowLeft', 'ArrowRight'));
    tabs[0]!.focus();
    const e = key(tabs[0]!, 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    key(tabs[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[0]);
    // 수정 키·다른 키는 그대로
    expect(key(tabs[0]!, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
    expect(key(tabs[0]!, 'Enter').defaultPrevented).toBe(false);
  });

  it('메뉴(roving 0): 항목 tabindex는 그대로 두고 화살표·Home·End로 돈다', () => {
    const box = html('<div role="menu"><button role="menuitem" tabindex="-1">1</button><button role="menuitem" tabindex="-1">2</button><button role="menuitem" tabindex="-1">3</button></div>');
    const items = [...box.querySelectorAll<HTMLElement>('button')];
    items[0]!.focus();
    listKeys(key(items[0]!, 'ArrowUp'), items, 'ArrowUp', 'ArrowDown', true, 0);
    expect(document.activeElement).toBe(items[2]);
    listKeys(key(items[2]!, 'Home'), items, 'ArrowUp', 'ArrowDown', true, 0);
    expect(document.activeElement).toBe(items[0]);
    expect(items.every((b) => b.tabIndex === -1)).toBe(true);
  });

  it('나무: ↑↓는 끝에서 멈추고, →는 펼친 줄의 첫 아이로, ←는 접힌 줄·잎에서 부모로. 지금 줄과 그 체크만 Tab 차례', () => {
    const box = html(
      '<div role="tree">' +
        '<div role="treeitem" aria-level="1" aria-expanded="true" tabindex="0"><input type="checkbox">집</div>' +
        '<div role="treeitem" aria-level="2" aria-expanded="false" tabindex="0"><input type="checkbox">벽</div>' +
        '<div role="treeitem" aria-level="2" tabindex="0"><input type="checkbox">문</div>' +
        '<div role="treeitem" aria-level="1" tabindex="0"><input type="checkbox">나무</div>' +
        '</div>',
    );
    const tree = box.firstElementChild as HTMLElement;
    tree.addEventListener('keydown', (e) => treeKeys(e, tree));
    const items = [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')];
    rove(items, items[0], true);
    expect(items.map((i) => i.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(items.map((i) => i.querySelector('input')!.tabIndex)).toEqual([0, -1, -1, -1]);
    items[0]!.focus();
    key(items[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(items[1]);
    // 접힌 줄의 →는 줄이 펼친다(여기서는 아무도 받지 않아 그대로)
    key(items[1]!, 'ArrowRight');
    expect(document.activeElement).toBe(items[1]);
    key(items[1]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    key(items[2]!, 'ArrowLeft');
    expect(document.activeElement).toBe(items[0]);
    // 펼친 줄의 ←는 줄이 접는다(나무는 옮기지 않는다)
    expect(key(items[0]!, 'ArrowLeft').defaultPrevented).toBe(false);
    key(items[0]!, 'End');
    expect(document.activeElement).toBe(items[3]);
    expect(items.map((i) => i.querySelector('input')!.tabIndex)).toEqual([-1, -1, -1, 0]);
    // 줄이 먼저 받은 키(펼치기 등)는 나무가 다시 옮기지 않는다
    items[3]!.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    key(items[3]!, 'ArrowUp');
    expect(document.activeElement).toBe(items[3]);
    // 줄 안 체크에 초점이면 나무 키가 아니다
    items[3]!.querySelector('input')!.focus();
    expect(key(items[3]!.querySelector('input')!, 'ArrowUp').defaultPrevented).toBe(false);
  });
});

describe('다시 그린 뒤 초점 되찾기·사라진 초점 옮기기(44차 — WCAG 2.4.3)', () => {
  it('자료 열쇠 속성으로 같은 줄을, 없으면 같은 태그·첫 이름표 안 차례로 찾는다', () => {
    const root = html('<button class="ptab on" id="ptab-tags">태그</button><div data-node="7" tabindex="0">집</div><button class="mini-btn">모두 보기</button><button class="mini-btn">모두 숨기기</button>');
    (root.querySelector('[data-node]') as HTMLElement).focus();
    let spot = focusSpot(root);
    expect(spot).toEqual({ attr: 'data-node', value: '7' });
    root.innerHTML = '<div data-node="3" tabindex="0">벽</div><div data-node="7" tabindex="-1">집</div>';
    expect(lost()).toBe(true);
    refocus(root, spot);
    expect(document.activeElement).toBe(root.querySelector('[data-node="7"]'));

    root.innerHTML = '<button class="mini-btn">모두 보기</button><button class="mini-btn on">모두 숨기기</button>';
    (root.querySelectorAll('button')[1] as HTMLElement).focus();
    spot = focusSpot(root);
    expect(spot).toEqual({ css: 'button.mini-btn', index: 1 });
    root.innerHTML = '<button class="mini-btn">모두 보기</button><button class="mini-btn">모두 숨기기</button>';
    refocus(root, spot);
    expect(document.activeElement).toBe(root.querySelectorAll('button')[1]);

    // id(패널 탭)
    root.innerHTML = '<button id="ptab-outline">구성</button>';
    (root.firstElementChild as HTMLElement).focus();
    spot = focusSpot(root);
    root.innerHTML = '<button id="ptab-outline">구성</button>';
    refocus(root, spot);
    expect(document.activeElement?.id).toBe('ptab-outline');
  });

  it('초점이 밖에 있었거나 다른 곳으로 옮겨 갔으면 건드리지 않는다', () => {
    const outside = html('<button>밖</button>').firstElementChild as HTMLElement;
    const root = html('<button class="a">안</button>');
    outside.focus();
    expect(focusSpot(root)).toBeNull();
    (root.firstElementChild as HTMLElement).focus();
    const spot = focusSpot(root);
    root.innerHTML = '<button class="a">안</button>';
    outside.focus();
    refocus(root, spot);
    expect(document.activeElement).toBe(outside);
  });

  it('숨는 곳·지운 요소의 초점은 대신 갈 곳으로(그 곳이 숨었거나 꺼졌으면 그대로)', () => {
    const box = html('<div class="bar"><button class="close">닫기</button></div><button class="tool">줄자</button><button class="off" disabled>꺼짐</button>');
    const bar = box.querySelector<HTMLElement>('.bar')!;
    const tool = box.querySelector<HTMLElement>('.tool')!;
    box.querySelector<HTMLElement>('.close')!.focus();
    // 아직 숨기기 전: inside로 곧 숨을 곳을 알린다
    focusIfLost(tool, bar);
    expect(document.activeElement).toBe(tool);
    // 지운 요소
    const tmp = html('<button>지울 것</button>').firstElementChild as HTMLElement;
    tmp.focus();
    tmp.remove();
    focusIfLost(box.querySelector<HTMLElement>('.off'));
    expect(document.activeElement).not.toBe(box.querySelector('.off'));
    focusIfLost(tool);
    expect(document.activeElement).toBe(tool);
    // 숨긴 띠 안
    bar.hidden = true;
    expect(lost()).toBe(false);
    box.querySelector<HTMLElement>('.close')!.focus();
    expect(lost()).toBe(true);
    // 초점이 멀쩡하면 옮기지 않는다
    const other = html('<button>다른 것</button>').firstElementChild as HTMLElement;
    other.focus();
    focusIfLost(tool, bar);
    expect(document.activeElement).toBe(other);
  });
});

describe('누른 버튼이 막히면 초점 옮기기(148차 — 브라우저 focus fixup이 초점을 문서로 보내기 전에)', () => {
  it('초점을 쥔 버튼이 막혔을 때만 처음 쓸 수 있는 곳으로(반대쪽 버튼, 그것도 막혔으면 3D 보기) — 도구 막대 이전·다음 보기와 측정 띠 「다시 재기」', () => {
    const box = html('<button class="back">이전 보기</button><button class="fwd" disabled>다음 보기</button><canvas tabindex="0"></canvas><button class="other">다른 것</button>');
    const back = box.querySelector<HTMLButtonElement>('.back')!;
    const fwd = box.querySelector<HTMLButtonElement>('.fwd')!;
    const canvas = box.querySelector<HTMLElement>('canvas')!;
    const other = box.querySelector<HTMLButtonElement>('.other')!;
    // 이전 보기로 처음 칸에 닿음: 이전 막힘·다음 풀림 → 다음 보기로(jsdom은 focus fixup을 하지 않아 막힌 버튼에 초점이 남는다)
    back.focus();
    back.disabled = true;
    fwd.disabled = false;
    expect(document.activeElement).toBe(back);
    leaveDisabled(back, fwd, canvas);
    expect(document.activeElement).toBe(fwd);
    // 다음 보기로 끝 칸에 닿음 → 이전 보기로
    fwd.disabled = true;
    back.disabled = false;
    leaveDisabled(fwd, back, canvas);
    expect(document.activeElement).toBe(back);
    // 반대쪽도 막혔으면 다음 곳(3D 보기) — 「다시 재기」는 반대쪽 없이 3D 보기로
    back.disabled = true;
    leaveDisabled(back, fwd, canvas);
    expect(document.activeElement).toBe(canvas);
    // 막히지 않은 버튼, 초점이 다른 곳·문서(body)면 그대로(focusIfLost와 달리 문서에서 끌어오지 않는다 — 갱신 함수가 자주 불린다)
    other.focus();
    leaveDisabled(other, canvas);
    expect(document.activeElement).toBe(other);
    leaveDisabled(back, fwd, canvas);
    expect(document.activeElement).toBe(other);
    other.blur();
    expect(document.activeElement).toBe(document.body);
    leaveDisabled(back, fwd, canvas);
    expect(document.activeElement).toBe(document.body);
    // 앱 원문: 막는 줄 바로 뒤에서 — 이전·다음 보기는 서로(그다음 3D 보기), 「다시 재기」는 3D 보기
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(
      /e\.fwdBtn\.disabled = [^\n]+\n(?:\s*\/\/[^\n]*\n)*\s*const cv = this\.viewer\?\.canvas;\n\s*leaveDisabled\(e\.backBtn, e\.fwdBtn, cv\);\n\s*leaveDisabled\(e\.fwdBtn, e\.backBtn, cv\);/,
    );
    expect(app).toMatch(/e\.measureClear\.disabled = !tool\.clearable;\n(?:\s*\/\/[^\n]*\n)*\s*leaveDisabled\(e\.measureClear, this\.viewer\?\.canvas\);/);
  });
});

describe('누른 버튼이 숨으면 초점 옮기기(150차 — 148차 막힘에 숨김을 더함, 측정 조각 notifyGuides의 숨김 판정과 같게)', () => {
  it('초점을 쥔 버튼이 숨거나 숨은 곳 안이면 처음 쓸 수 있는 곳으로(숨은 곳은 건너뜀) — 측정값 칸 안내 수 ✕·휴지통, 측정 띠 「기록 지우기」', () => {
    const box = html('<div class="log"><button class="clear">기록 지우기</button></div><button class="undo">되돌리기</button><canvas tabindex="0"></canvas><button class="other">다른 것</button>');
    const log = box.querySelector<HTMLElement>('.log')!;
    const clear = box.querySelector<HTMLButtonElement>('.clear')!;
    const undo = box.querySelector<HTMLButtonElement>('.undo')!;
    const canvas = box.querySelector<HTMLElement>('canvas')!;
    const other = box.querySelector<HTMLButtonElement>('.other')!;
    // 버튼 스스로 숨음(안내 수 ✕·휴지통 꼴 — 꺼지지는 않음) → 처음 쓸 수 있는 곳(반대 동작 되돌리기). jsdom은 focus fixup을 하지 않아 숨은 버튼에 초점이 남는다
    clear.focus();
    clear.hidden = true;
    expect(document.activeElement).toBe(clear);
    leaveDisabled(clear, undo, canvas);
    expect(document.activeElement).toBe(undo);
    // 숨은 곳 안(목록째 숨는 「기록 지우기」 꼴), 옮길 곳 하나도 숨었으면 건너뛰고 3D 보기
    clear.hidden = false;
    clear.focus();
    log.hidden = true;
    undo.hidden = true;
    leaveDisabled(clear, undo, canvas);
    expect(document.activeElement).toBe(canvas);
    // 보이는 버튼이면 그대로, 초점이 다른 곳이면 숨어도 그대로
    log.hidden = false;
    clear.focus();
    leaveDisabled(clear, canvas);
    expect(document.activeElement).toBe(clear);
    other.focus();
    log.hidden = true;
    leaveDisabled(clear, canvas);
    expect(document.activeElement).toBe(other);
    // 앱 원문: 「기록 지우기」는 지운 바로 뒤 3D 보기로(148차 「다시 재기」와 같은 띠), 측정값 칸에는 3D 보기를 넘긴다
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/this\.clearMeasureLog\(\);\n(?:\s*\/\/[^\n]*\n)*\s*leaveDisabled\(clear, this\.viewer\?\.canvas\);/);
    expect(app).toMatch(/\n\s*view: \(\) => this\.viewer\?\.canvas,\n/);
  });
});

describe('줄 목록을 통째로 다시 그려도 초점을 가까운 줄로(188차 — 처음 화면 최근 문서 ✕·「모두 지우기」·없는 사본, STEP 142차 꼴, WCAG 2.4.3)', () => {
  // 앱 처음 화면 꼴: 「파일 열기」(처음 화면 첫 버튼) 뒤 최근 문서 카드(머리의 「모두 지우기」 + 줄마다 열기·✕ — recentRow)
  const start = (names: string[]): { home: HTMLElement; card: HTMLElement; list: HTMLElement; clear: HTMLElement; other: HTMLElement; draw: (names: string[]) => void } => {
    const box = html(
      '<button class="btn primary">파일 열기</button><button class="btn">예제 열기</button><section class="recent"><div class="recent-head"><button class="recent-clear">모두 지우기</button></div><ul class="recent-list"></ul></section>',
    );
    const card = box.querySelector<HTMLElement>('.recent')!;
    const list = box.querySelector<HTMLElement>('.recent-list')!;
    // refreshRecent 꼴: 줄을 모두 새로 만들고, 줄이 없으면 카드째 숨긴다
    const draw = (next: string[]): void => {
      list.innerHTML = next.map((n) => `<li class="recent-row"><button class="recent-open">${n}</button><button class="recent-del">✕</button></li>`).join('');
      card.hidden = !next.length;
    };
    draw(names);
    return { home: box.querySelector<HTMLElement>('.btn.primary')!, card, list, clear: box.querySelector<HTMLElement>('.recent-clear')!, other: box.querySelector<HTMLElement>('.btn:not(.primary)')!, draw };
  };

  it('초점이 카드 안이었으면 다시 그려 사라진 뒤 그 자리에 온 줄(끝 줄이었으면 앞 줄)의 열기 버튼, 줄이 없으면 처음 화면 「파일 열기」로 — 앱은 refreshRecent 한 자리에서', () => {
    const { home, card, list, clear, draw } = start(['가', '나', '다']);
    const redraw = (next: string[]): void => {
      const back = keepRowFocus(card, list, () => home);
      draw(next);
      back();
    };
    const opens = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('.recent-open')];
    const dels = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('.recent-del')];
    // 가운데 줄 ✕(그 줄이 빠짐) → 그 자리에 온 줄(다)의 열기
    dels()[1]!.focus();
    redraw(['가', '다']);
    expect(lost()).toBe(false);
    expect(document.activeElement).toBe(opens()[1]);
    expect(document.activeElement?.textContent).toBe('다');
    // 끝 줄 ✕ → 앞 줄(가)의 열기
    dels()[1]!.focus();
    redraw(['가']);
    expect(document.activeElement).toBe(opens()[0]);
    // 저장한 사본이 없어 지운 줄의 열기(누른 열기 버튼이 빠짐) — 줄이 하나도 없으면 카드째 숨고 「파일 열기」로
    opens()[0]!.focus();
    redraw([]);
    expect(card.hidden).toBe(true);
    expect(document.activeElement).toBe(home);
    // 「모두 지우기」(버튼은 남지만 숨은 카드 안) → 「파일 열기」
    draw(['가', '나']);
    clear.focus();
    redraw([]);
    expect(document.activeElement).toBe(home);
    // 같은 줄로 다시 그리기만 했으면(열기 실패 뒤 등) 같은 자리 줄의 열기
    draw(['가', '나']);
    opens()[1]!.focus();
    redraw(['가', '나']);
    expect(document.activeElement).toBe(opens()[1]);
    // 앱 원문: ✕·「모두 지우기」는 지운 뒤 refreshRecent, refreshRecent는 다시 그리기 앞에 부르고 그린 뒤 돌려준 함수를 부른다.
    // 갈 곳이 없으면 처음 화면 첫 버튼(「파일 열기」 — 알림 ✕·새 판 「나중에」와 같은 자리)
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toContain("del.addEventListener('click', () => void this.recent.remove(e.id).then(() => this.refreshRecent()));");
    expect(app).toContain("clear.addEventListener('click', () => void this.recent.clear().then(() => this.refreshRecent()));");
    expect(app).toMatch(
      /const back = keepRowFocus\(this\.recentCard, this\.recentList, \(\) => this\.els\.start\.querySelector\('button'\)\);\n\s*this\.recentList\.replaceChildren\(\.\.\.list\.map\(\(e\) => this\.recentRow\(e, now\)\)\);\n\s*this\.recentCard\.hidden = !list\.length;\n\s*back\(\);/,
    );
    expect(app.slice(app.indexOf('private buildStart(')).match(/h\('button'[^\n]*/)?.[0]).toContain('파일 열기');
  });

  it('초점이 카드 밖이었으면(다른 버튼·문서 — 누르기로 초점을 받지 않는 기기) 다시 그려도 옮기지 않고, 카드 안이었어도 그 사이 다른 곳으로 옮겼으면 그대로', () => {
    const { home, card, list, other, draw } = start(['가', '나']);
    // 다른 버튼
    other.focus();
    let back = keepRowFocus(card, list, () => home);
    draw(['나']);
    back();
    expect(document.activeElement).toBe(other);
    // 문서(body) — 손가락·Safari로 ✕를 눌러 초점이 없던 때, 줄이 다 빠져 카드가 숨어도
    other.blur();
    expect(document.activeElement).toBe(document.body);
    back = keepRowFocus(card, list, () => home);
    draw([]);
    back();
    expect(document.activeElement).toBe(document.body);
    // 카드 안(✕)이었지만 지우는 동안 다른 곳으로 옮김
    draw(['가', '나']);
    list.querySelector<HTMLElement>('.recent-del')!.focus();
    back = keepRowFocus(card, list, () => home);
    other.focus();
    draw(['나']);
    back();
    expect(document.activeElement).toBe(other);
  });
});

describe('측정 띠·고른 것 카드를 띠 안 버튼에서 친 Esc·T로 닫아도 ✕와 같은 곳으로(189차 — 숨기는 한 자리에 되살림, WCAG 2.4.3)', () => {
  // 앱 꼴: 도구 막대 줄자·각도기·패널 버튼, 3D 보기(코어 캔버스 tabIndex 0), 측정 띠(복사·다시 재기·✕), 고른 것 카드(면만·자세히·✕)
  const stage = () => {
    const box = html(
      '<button class="tape">줄자</button><button class="prot">각도기</button><button class="panel">패널</button><canvas tabindex="0"></canvas>' +
        '<div class="measure-bar" hidden><button class="copy">복사</button><button class="clear">다시 재기</button><button class="close">측정 끝내기</button></div>' +
        '<div class="sel-bar" hidden><button class="part">면만</button><button class="more">자세히</button><button class="close">선택 해제</button></div>',
    );
    const $ = (s: string): HTMLElement => box.querySelector<HTMLElement>(s)!;
    const bar = $('.measure-bar');
    const card = $('.sel-bar');
    const st = { mode: null as 'tape' | 'protractor' | null, selected: false };
    // refreshStatus 꼴: 측정 띠(도구를 켠 동안), 고른 것 카드(고른 것이 있고 측정 중이 아님 — refreshSelBar는 숨김 줄 앞뒤에서 도우미)
    const refresh = (): void => {
      bar.hidden = !st.mode;
      const back = keepBarFocus(card, $('canvas'));
      card.hidden = !(st.selected && !st.mode);
      back();
    };
    // setMeasureMode 꼴: 도구를 바꾸기 앞에 끄는 도구의 버튼(✕와 같은 셈)으로 부르고, 띠를 맞춘 뒤 돌려준 함수
    const setMode = (mode: 'tape' | 'protractor' | null): void => {
      const back = keepBarFocus(bar, st.mode === 'protractor' ? $('.prot') : $('.tape'));
      st.mode = mode;
      refresh();
      back();
    };
    // applySelection 꼴
    const select = (on: boolean): void => {
      st.selected = on;
      refresh();
    };
    // 창 keydown capture(onKey) 꼴: 측정 중 지울 것 없는 Esc → 끄기, 그 밖의 Esc → 고른 것 지우기(clearSelection), T → 줄자 켜고 끄기(toggleMeasure)
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        if (st.mode) setMode(null);
        else select(false);
      } else if (ev.key === 't' || ev.key === 'T') setMode(st.mode === 'tape' ? null : 'tape');
    };
    document.addEventListener('keydown', onKey, true);
    // ✕ 둘: 측정 띠는 setMeasureMode(null)만, 카드는 applySelection(null)만(되살림은 위 두 자리)
    bar.querySelector('.close')!.addEventListener('click', () => setMode(null));
    card.querySelector('.close')!.addEventListener('click', () => select(false));
    return { $, bar, card, setMode, select, done: () => document.removeEventListener('keydown', onKey, true) };
  };

  it('초점이 띠·카드 안이면 Esc·T로 닫아도 ✕와 같은 곳 — 측정 띠는 끈 도구의 버튼, 카드는 3D 보기. 앱은 setMeasureMode·refreshSelBar 한 자리에서', () => {
    const { $, bar, card, setMode, select, done } = stage();
    try {
      // 줄자 띠의 복사 버튼에서 Esc(지울 것 없음 — 측정 끄기) → 줄자 버튼(jsdom은 focus fixup을 하지 않아 고치기 전에는 숨은 띠 안에 남는다)
      setMode('tape');
      $('.measure-bar .copy').focus();
      key($('.measure-bar .copy'), 'Escape');
      expect(bar.hidden).toBe(true);
      expect(lost()).toBe(false);
      expect(document.activeElement).toBe($('.tape'));
      // 각도기 띠의 다시 재기에서 Esc → 각도기 버튼
      setMode('protractor');
      $('.measure-bar .clear').focus();
      key($('.measure-bar .clear'), 'Escape');
      expect(document.activeElement).toBe($('.prot'));
      // 줄자 띠에서 T(줄자 끄기) → 줄자 버튼
      setMode('tape');
      $('.measure-bar .copy').focus();
      key($('.measure-bar .copy'), 't');
      expect(bar.hidden).toBe(true);
      expect(document.activeElement).toBe($('.tape'));
      // 각도기 띠에서 T는 줄자로 바꿈 — 띠가 그대로라 초점도 그대로
      setMode('protractor');
      $('.measure-bar .copy').focus();
      key($('.measure-bar .copy'), 'T');
      expect(bar.hidden).toBe(false);
      expect(document.activeElement).toBe($('.measure-bar .copy'));
      // ✕(기준 — 지금 줄자)도 같은 자리를 지나 같은 곳
      $('.measure-bar .close').focus();
      $('.measure-bar .close').click();
      expect(document.activeElement).toBe($('.tape'));
      // 카드의 자세히에서 Esc(고른 것 지우기) → 3D 보기, 면만에서 T(측정 중이라 카드가 숨음) → 3D 보기, ✕ → 3D 보기
      select(true);
      expect(card.hidden).toBe(false);
      $('.sel-bar .more').focus();
      key($('.sel-bar .more'), 'Escape');
      expect(card.hidden).toBe(true);
      expect(document.activeElement).toBe($('canvas'));
      select(true);
      $('.sel-bar .part').focus();
      key($('.sel-bar .part'), 't');
      expect([card.hidden, bar.hidden]).toEqual([true, false]);
      expect(document.activeElement).toBe($('canvas'));
      setMode(null);
      expect(card.hidden).toBe(false);
      $('.sel-bar .close').focus();
      $('.sel-bar .close').click();
      expect(document.activeElement).toBe($('canvas'));
    } finally {
      done();
    }
    // 앱 원문: 도구를 끄는 곳은 setMeasureMode뿐(✕·Esc·T가 지남), 카드를 숨기는 곳은 refreshSelBar(✕·Esc가 applySelection → refreshStatus로 지남)
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const mode = app.slice(app.indexOf('  private setMeasureMode('), app.indexOf('  private measureArrived('));
    expect(mode).toMatch(
      /const back = keepBarFocus\(this\.els\.measureBar, this\.measureModeNow === 'protractor' \? this\.els\.protractorBtn : this\.els\.measureBtn\);\n\s*t\.setMode\(mode\);\n/,
    );
    expect(mode).toMatch(/this\.refreshStatus\(\);\n\s*back\(\);\n {2}\}\n/);
    expect(app).toContain("measureClose.addEventListener('click', () => this.setMeasureMode(null));");
    expect(app).toMatch(/ev\.key === 'Escape' && !this\.busy\) \{\n\s*ev\.preventDefault\(\);\n\s*ev\.stopPropagation\(\);\n\s*this\.setMeasureMode\(null\);\n/);
    expect(app).toMatch(/act\.kind === 'tape'\) \{\n\s*ev\.preventDefault\(\);\n\s*ev\.stopPropagation\(\);\n\s*this\.toggleMeasure\(\);\n/);
    expect(app).toMatch(/toggleMeasure\(on = [^\n]*\): void \{\n\s*this\.setMeasureMode\(on \? 'tape' : null\);\n/);
    expect(app).toMatch(/const back = keepBarFocus\(e\.selBar, this\.viewer\?\.canvas\);\n\s*e\.selBar\.hidden = !on;\n\s*back\(\);\n/);
    expect(app).toMatch(/selClose\.addEventListener\('click', \(\) => \{\n\s*this\.measureTool\?\.deselectGuide\(\);\n\s*this\.applySelection\(null, false\);\n\s*\}\);/);
    expect(app).toMatch(/act\.kind === 'clearSelection'\) \{\n(?:\s*\/\/[^\n]*\n)*\s*this\.applySelection\(null, false\);\n/);
    expect(app).toMatch(/this\.panel\.refreshSelection\(reveal\);\n\s*this\.refreshStatus\(\);\n\s*\}/);
    expect(app).toMatch(/this\.refreshMeasureBar\(\);\n\s*this\.refreshSelBar\(\);\n\s*\}/);
  });

  it('초점이 띠·카드 밖이면(3D 보기·패널 버튼·문서) Esc·T로 닫아도 옮기지 않고, 띠 안이었어도 닫는 사이 다른 곳으로 옮겼거나 띠가 그대로면 그대로', () => {
    const { $, bar, card, setMode, select, done } = stage();
    try {
      // 3D 보기에서 친 Esc·T(지금 그대로 — 3D 보기)
      setMode('tape');
      $('canvas').focus();
      key($('canvas'), 'Escape');
      expect(bar.hidden).toBe(true);
      expect(document.activeElement).toBe($('canvas'));
      setMode('protractor');
      key($('canvas'), 'Escape');
      expect(document.activeElement).toBe($('canvas'));
      setMode('tape');
      key($('canvas'), 't');
      expect(bar.hidden).toBe(true);
      expect(document.activeElement).toBe($('canvas'));
      // 패널 버튼에서 T
      setMode('tape');
      $('.panel').focus();
      key($('.panel'), 'T');
      expect(bar.hidden).toBe(true);
      expect(document.activeElement).toBe($('.panel'));
      // 문서(body — 누르기로 초점을 받지 않는 기기 등)는 끌어오지 않는다
      setMode('tape');
      $('.panel').blur();
      expect(document.activeElement).toBe(document.body);
      key(document.body, 'Escape');
      expect(bar.hidden).toBe(true);
      expect(document.activeElement).toBe(document.body);
      // 카드: 3D 보기·문서에서 친 Esc
      select(true);
      $('canvas').focus();
      key($('canvas'), 'Escape');
      expect(card.hidden).toBe(true);
      expect(document.activeElement).toBe($('canvas'));
      select(true);
      $('canvas').blur();
      key(document.body, 'Escape');
      expect(card.hidden).toBe(true);
      expect(document.activeElement).toBe(document.body);
      // 카드 안 초점이어도 카드가 그대로 보이는 다시 맞춤(같은 고른 것)이면 그대로
      select(true);
      $('.sel-bar .more').focus();
      select(true);
      expect(card.hidden).toBe(false);
      expect(document.activeElement).toBe($('.sel-bar .more'));
    } finally {
      done();
    }
    // 띠 안이었지만 숨기기 전에 다른 곳으로 옮겼으면 그대로
    const box = html('<div class="bar"><button class="in">안</button></div><button class="to">갈 곳</button><button class="other">다른 것</button>');
    const b = box.querySelector<HTMLElement>('.bar')!;
    box.querySelector<HTMLElement>('.in')!.focus();
    const back = keepBarFocus(b, box.querySelector<HTMLElement>('.to'));
    box.querySelector<HTMLElement>('.other')!.focus();
    b.hidden = true;
    back();
    expect(document.activeElement).toBe(box.querySelector('.other'));
  });
});

describe('고른 것 카드 「면만」을 눌러 그 버튼만 숨어도 초점을 같은 카드의 다음 버튼으로(190차 — 150차 leaveDisabled 꼴, 카드째 숨으면 189차 길, WCAG 2.4.3)', () => {
  // 앱 꼴: 3D 보기(코어 캔버스 tabIndex 0), 패널 버튼, 고른 것 카드(면만 — 모서리면 「모서리만」, 같은 버튼 · 자세히 · ✕)
  const stage = () => {
    const box = html(
      '<canvas tabindex="0"></canvas><button class="panel">패널</button>' +
        '<div class="sel-bar" hidden><button class="part" hidden>면만</button><button class="more">자세히</button><button class="close">선택 해제</button></div>',
    );
    const $ = (s: string): HTMLElement => box.querySelector<HTMLElement>(s)!;
    const card = $('.sel-bar');
    const part = box.querySelector<HTMLButtonElement>('.part')!;
    const st = { sel: null as 'group' | 'face' | null, measuring: false };
    // refreshSelBar 꼴: 카드째 숨김 줄 앞뒤 keepBarFocus(189차 — 숨었으면 끝), 「면만」은 그룹을 고르고 누른 자리가 있을 때만(partOfPick — 면을 고르면 null)
    const refresh = (): void => {
      const on = !!st.sel && !st.measuring;
      const back = keepBarFocus(card, $('canvas'));
      card.hidden = !on;
      back();
      if (!on) return;
      part.hidden = st.sel !== 'group';
      leaveDisabled(part, $('.more'), $('canvas'));
    };
    // applySelection 꼴, 「면만」 누르기는 selectPickedPart → applySelection(면)
    const select = (sel: 'group' | 'face' | null): void => {
      st.sel = sel;
      refresh();
    };
    part.addEventListener('click', () => select('face'));
    return { $, card, part, st, refresh, select };
  };
  const appSource = (): { app: string; bar: string } => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    return { app, bar: app.slice(app.indexOf('  private refreshSelBar('), app.indexOf('  private placeVcb(')) };
  };

  it('초점이 「면만」에 있을 때 눌러(Enter·Space도 click) 면을 골라 그 버튼만 숨으면 같은 카드의 「자세히」로, 카드째 숨으면 189차 길(3D 보기) — 앱은 refreshSelBar의 숨는 줄 바로 뒤에서', () => {
    const { $, card, part, st, refresh, select } = stage();
    select('group');
    expect([card.hidden, part.hidden]).toEqual([false, false]);
    // jsdom은 focus fixup을 하지 않아 고치기 전에는 숨은 버튼에 초점이 남는다(브라우저는 문서로)
    part.focus();
    part.click();
    expect([card.hidden, part.hidden]).toEqual([false, true]);
    expect(lost()).toBe(false);
    expect(document.activeElement).toBe($('.more'));
    // 「자세히」를 쓸 수 없으면 끝 대비로 3D 보기
    select('group');
    part.focus();
    ($('.more') as HTMLButtonElement).disabled = true;
    part.click();
    expect(document.activeElement).toBe($('canvas'));
    ($('.more') as HTMLButtonElement).disabled = false;
    // 「면만」에 초점을 둔 채 카드째 숨으면(측정을 켬 — T) 189차 길 그대로 3D 보기(「자세히」가 아님)
    select('group');
    part.focus();
    st.measuring = true;
    refresh();
    expect(card.hidden).toBe(true);
    expect(document.activeElement).toBe($('canvas'));
    // 앱 원문: 숨는 줄 바로 뒤에서 같은 카드의 「자세히」(els.selMore), 끝 대비 3D 보기. 카드째 숨으면 그 앞에서 끝(189차 keepBarFocus만)
    const { app, bar } = appSource();
    expect(bar).toMatch(/e\.selPart\.hidden = !part;\n(?:\s*\/\/[^\n]*\n)*\s*leaveDisabled\(e\.selPart, e\.selMore, this\.viewer\?\.canvas\);\n/);
    expect(bar.indexOf('if (!on || !d) return;')).toBeGreaterThan(bar.indexOf('back();'));
    expect(bar.indexOf('if (!on || !d) return;')).toBeLessThan(bar.indexOf('leaveDisabled(e.selPart'));
    expect(app).toContain("selPart.addEventListener('click', () => this.selectPickedPart());");
    expect(app).toMatch(/selectPickedPart\(\): void \{\n[^}]*this\.applySelection\(part, false\);\n\s*\}/);
    expect(app).toMatch(/const selMore = h\('button', \{ class: 'mb-btn sel-more'/);
    expect(app).toMatch(/\n\s*selPart,\n\s*selMore,\n/);
  });

  it('초점이 「면만」 밖이면(3D 보기·자세히·패널 버튼·문서) 그 버튼이 숨어도 옮기지 않고, 「면만」에 있어도 그대로 보이는 다시 맞춤이면 그대로', () => {
    const { $, card, part, refresh, select } = stage();
    // 3D 보기·패널 목록에서 면을 고름(3D 보기 초점)
    select('group');
    $('canvas').focus();
    select('face');
    expect([card.hidden, part.hidden]).toEqual([false, true]);
    expect(document.activeElement).toBe($('canvas'));
    // 「자세히」·패널 버튼
    select('group');
    $('.more').focus();
    select('face');
    expect(document.activeElement).toBe($('.more'));
    select('group');
    $('.panel').focus();
    select('face');
    expect(document.activeElement).toBe($('.panel'));
    // 문서(body — 손가락·Safari 누르기는 버튼에 초점을 주지 않음)는 끌어오지 않는다
    select('group');
    $('.panel').blur();
    expect(document.activeElement).toBe(document.body);
    part.click();
    expect(part.hidden).toBe(true);
    expect(document.activeElement).toBe(document.body);
    // 「면만」에 초점이 있어도 그대로 보이는 다시 맞춤(같은 고른 것)이면 그대로
    select('group');
    part.focus();
    refresh();
    expect(part.hidden).toBe(false);
    expect(document.activeElement).toBe(part);
    // 앱 원문: 카드를 다시 맞추는 동안 초점을 옮기는 곳은 189차 keepBarFocus와 이번 leaveDisabled 하나뿐(초점이 그 버튼에 있을 때만 옮긴다 — 148차 시험)
    const { bar } = appSource();
    expect(bar.match(/leaveDisabled\(/g)?.length).toBe(1);
    expect(bar.match(/keepBarFocus\(/g)?.length).toBe(1);
    expect(bar).not.toMatch(/focusIfLost\(|\.focus\(/);
  });
});

describe('측정 띠 최근 측정 기록을 통째로 다시 그려도 초점을 같은 차례 줄의 같은 버튼으로(192차 — 44차 focusSpot·refocus 꼴, 패널·장면 탭과 같게, WCAG 2.4.3)', () => {
  // 앱 꼴: 3D 보기(코어 캔버스 tabIndex 0), 측정 띠(최근 측정 기록 버튼 · 기록 목록 — 머리 · 줄마다 복사 버튼(listRows) · 「모두 복사」·「기록 지우기」)
  const stage = () => {
    const box = html('<canvas tabindex="0"></canvas><div class="measure-bar"><button class="mb-btn icon">최근 측정 기록</button><div class="measure-log" id="measure-log"></div></div>');
    const $ = (s: string): HTMLElement => box.querySelector<HTMLElement>(s)!;
    const el = $('.measure-log');
    const button = (cls: string, text: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = text;
      return b;
    };
    // renderMeasureLog 꼴: 머리·줄·버튼 줄을 모두 새 요소로 바꾼다(fix면 앞뒤에 focusSpot·refocus, mid는 그리는 사이 다른 길)
    const draw = (lines: string[], fix = true, mid?: () => void): void => {
      const head = document.createElement('div');
      head.className = 'ml-head';
      head.textContent = `최근 측정 ${lines.length}개`;
      const acts = document.createElement('div');
      acts.className = 'pbar ml-acts';
      acts.append(button('mini-btn', '모두 복사'), button('mini-btn', '기록 지우기'));
      const spot = fix ? focusSpot(el) : null;
      mid?.();
      el.replaceChildren(head, listRows(lines.map((t) => button('ml-row', t))), acts);
      refocus(el, spot);
    };
    const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('button.ml-row')];
    const mini = (t: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('button.mini-btn')].find((b) => b.textContent === t)!;
    return { $, el, draw, rows, mini };
  };
  const logSource = (): { app: string; log: string } => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    return { app, log: app.slice(app.indexOf('  private renderMeasureLog('), app.indexOf('  /** 목록에서 고르기(PanelHost) */')) };
  };

  it('초점이 기록 안이면 다른 길의 갱신(안내 글·점 취소 Esc·Shift 잠금·안내 두기 — refreshStatus)으로 다시 그려도 같은 차례 줄의 복사 버튼, 「모두 복사」·「기록 지우기」는 같은 버튼으로 — 앱은 renderMeasureLog 한 자리에서', () => {
    const { el, draw, rows, mini } = stage();
    draw(['거리 1', '거리 2', '거리 3']);
    // 고치기 전 꼴: 통째로 다시 그리면 떼어진 버튼과 함께 초점이 빠진다(브라우저는 문서로 — 다음 Tab이 문서 처음부터)
    rows()[1]!.focus();
    draw(['거리 1', '거리 2', '거리 3'], false);
    expect(lost()).toBe(true);
    // 같은 기록(안내 글·잠금만 바뀜) → 같은 차례 줄의 새 복사 버튼
    rows()[1]!.focus();
    draw(['거리 1', '거리 2', '거리 3']);
    expect(lost()).toBe(false);
    expect(document.activeElement).toBe(rows()[1]);
    expect(document.activeElement?.textContent).toBe('거리 2');
    // 새 결과가 앞에 듦 → 같은 차례(그 자리에 한 칸 밀린 줄 — 188차 keepRowFocus와 같은 「같은 차례」, 기록은 보이는 동안 줄지 않음)
    draw(['거리 0', '거리 1', '거리 2', '거리 3']);
    expect(document.activeElement).toBe(rows()[1]);
    expect(document.activeElement?.textContent).toBe('거리 1');
    // 끝 줄
    rows()[3]!.focus();
    draw(['거리 0', '거리 1', '거리 2', '거리 3']);
    expect(document.activeElement).toBe(rows()[3]);
    // 목록 밖 버튼 줄(156차 — 머리·버튼 줄은 목록 밖)도 같은 버튼으로(keepRowFocus면 첫 줄로 갔다)
    for (const t of ['모두 복사', '기록 지우기']) {
      mini(t).focus();
      draw(['거리 0', '거리 1']);
      expect(el.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(mini(t));
    }
    // 앱 원문: 통째로 바꾸는 줄 앞뒤에 focusSpot·refocus(새 가져오기 없음 — 이미 가져온 짝), 줄 버튼·버튼 줄의 첫 이름표가 차례 열쇠(열쇠 속성 없음), 띠 맞춤 끝에서 부른다
    const { app, log } = logSource();
    expect(log).toMatch(
      /const spot = focusSpot\(el\);\n\s*el\.replaceChildren\(h\('div', \{ class: 'ml-head' \}, [^\n]*\), listRows\(rows\), h\('div', \{ class: 'pbar ml-acts' \}, all, clear\)\);\n\s*refocus\(el, spot\);\n\s*\}\n/,
    );
    expect(log).toMatch(/const b = h\('button', \{ class: 'ml-row', title: [^\n]*\}, h\('span'/);
    expect(log.match(/h\('button', \{ class: 'mini-btn' \}/g)).toHaveLength(2);
    expect(log).not.toMatch(/(?:\bid|'id'|'data-[a-z-]+'): /);
    expect(app).toMatch(/import \{[^}]*\bfocusSpot\b[^}]*\brefocus\b[^}]*\} from '\.\/kbd';/);
    expect(app).toMatch(/if \(!this\.measureLog\.length\) disclose\(e\.measureLogBtn, e\.measureLog, false\);\n\s*this\.renderMeasureLog\(\);\n\s*\}\n/);
  });

  it('초점이 기록 밖이면(3D 보기·기록 버튼·문서) 다시 그려도 옮기지 않고, 안이었어도 그리는 사이 다른 곳으로 옮겼으면 그대로', () => {
    const { $, draw, rows } = stage();
    draw(['거리 1', '거리 2']);
    // 3D 보기(가상 커서·누르기로 새 결과)·기록 버튼(펼침 — toggleMeasureLog)
    for (const s of ['canvas', '.mb-btn']) {
      $(s).focus();
      draw(['거리 0', '거리 1', '거리 2']);
      expect(document.activeElement).toBe($(s));
    }
    // 문서(body — 손가락·Safari 누르기는 버튼에 초점을 주지 않음)는 끌어오지 않는다
    $('.mb-btn').blur();
    expect(document.activeElement).toBe(document.body);
    draw(['거리 1']);
    expect(document.activeElement).toBe(document.body);
    // 기록 안이었지만 그리는 사이 3D 보기로 옮겼으면 그대로
    draw(['거리 1', '거리 2']);
    rows()[1]!.focus();
    draw(['거리 0', '거리 1', '거리 2'], true, () => $('canvas').focus());
    expect(document.activeElement).toBe($('canvas'));
    // 앱 원문: 기록을 그리는 동안 초점을 옮기는 곳은 refocus 하나뿐(목록 안 초점만 적는 focusSpot — 44차 시험), 접혀 있으면 그리지 않아 그대로(150차 「기록 지우기」 길)
    const { log } = logSource();
    expect(log.match(/focusSpot\(/g)?.length).toBe(1);
    expect(log.match(/refocus\(/g)?.length).toBe(1);
    expect(log).not.toMatch(/focusIfLost\(|\.focus\(|keepRowFocus\(/);
    expect(log.indexOf('if (!d || el.hidden) return;')).toBeGreaterThan(-1);
    expect(log.indexOf('if (!d || el.hidden) return;')).toBeLessThan(log.indexOf('focusSpot(el)'));
  });
});

describe('패널 아래 띠를 통째로 다시 그려도 초점을 같은 열쇠 칸으로(151차 — NC 137차 꼴, 없어진 버튼은 150차 차례)', () => {
  it('같은 열쇠(태그|data-key ?? aria-label ?? 글 — 다시 그린 바로 뒤 원문)의 첫 칸, 없어졌으면 반대 동작(숨기기 ↔ 모두 보이기) → 3D 보기. 띠 밖 초점은 그대로', () => {
    const d = rowDoc();
    d.selection = { kind: 'node', index: 0 };
    const view = html('<canvas tabindex="0"></canvas>').firstElementChild as HTMLElement;
    let isolated = false;
    let log: MeasureToolResult[] = [{ kind: 'tape', a: [0, 0, 0], b: [1, 0, 0], distance: 1, dx: 1, dy: 0, dz: 0 }];
    const noop = (): void => {};
    // 앱(app.ts)의 숨기기·분리해서 보기·모두 보이기·기록 지우기와 같은 차례로 패널을 다시 그린다
    const unhide = (): void => {
      d.hiddenNodes.clear();
      isolated = false;
      panel.refreshVisibility();
    };
    const host: PanelHost = {
      setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
      setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
      hideSelection: () => {
        d.hiddenNodes.add(0);
        panel.refreshVisibility();
        d.selection = null;
        panel.refreshSelection();
      },
      isolateSelection: () => {
        if (isolated) return unhide();
        d.hiddenNodes.add(1);
        isolated = true;
        panel.refreshVisibility();
      },
      unhideAll: unhide,
      get isolated() {
        return isolated;
      },
      measureHint: null,
      get measureLogList() {
        return log;
      },
      copyMeasure: noop,
      clearMeasureLog: () => {
        log = [];
        panel.refreshSelection();
      },
      select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
      view,
    };
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    const foot = panel.el.querySelector<HTMLElement>('.pfoot')!;
    const btn = (t: string): HTMLButtonElement | undefined => [...foot.querySelectorAll('button')].find((b) => b.textContent === t);
    const press = (t: string): void => {
      const b = btn(t)!;
      b.focus();
      b.click();
    };
    // 분리해서 보기: 이름이 「분리 풀기」로 바뀌어도 data-key로 같은 버튼(고치기 전: 떼어진 버튼의 초점이 문서로 — jsdom도 지운 요소의 초점은 body로)
    press('분리해서 보기');
    expect(document.activeElement).toBe(btn('분리 풀기'));
    press('분리 풀기');
    expect(document.activeElement).toBe(btn('분리해서 보기'));
    // 숨기기: 고른 것이 풀려 버튼이 없어짐 → 반대 동작 「모두 보이기」
    press('숨기기');
    expect(btn('숨기기')).toBeUndefined();
    expect(document.activeElement).toBe(btn('모두 보이기'));
    // 고른 것 없이 모두 보이기: 버튼 줄째 없어짐 → 3D 보기
    press('모두 보이기');
    expect(foot.querySelector('.foot-acts')).toBeNull();
    expect(document.activeElement).toBe(view);
    // 띠 밖 초점(3D 보기)은 다시 그려도 그대로
    d.selection = { kind: 'node', index: 0 };
    d.hiddenNodes.add(1);
    panel.refreshSelection();
    expect(document.activeElement).toBe(view);
    // 고른 것이 있으면 모두 보이기 → 반대 동작 「숨기기」
    press('모두 보이기');
    expect(btn('모두 보이기')).toBeUndefined();
    expect(document.activeElement).toBe(btn('숨기기'));
    // 번역층이 글을 옮긴 뒤(다시 그린 바로 뒤 적어 둔 원문 열쇠) 다른 길로 다시 그려도 새 「모두 복사」로
    const all = btn('모두 복사')!;
    all.focus();
    all.textContent = 'Copy all';
    panel.refreshVisibility();
    expect(document.activeElement).not.toBe(all);
    expect(document.activeElement).toBe(btn('모두 복사'));
    // 기록 지우기: 기록째 없어지고 되살릴 반대 동작이 없음 → 3D 보기(150차 측정 띠 「기록 지우기」와 같은 곳 — 남은 숨기기 등은 기록과 무관)
    press('기록 지우기');
    expect(foot.querySelector('.measure-history')).toBeNull();
    expect(btn('숨기기')).toBeDefined();
    expect(document.activeElement).toBe(view);
    // 앱 원문: 패널에 3D 보기 캔버스를 넘긴다
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/\n\s*get view\(\)[^{\n]*\{\n\s*return this\.viewer\?\.canvas;\n/);
  });
});

describe('펼치고 접는 버튼의 펼침 상태(153차 — 측정 띠 "최근 측정 기록", APG Disclosure)', () => {
  it('목록 숨김과 버튼 aria-expanded를 함께 바꾸고, 앱은 그 목록의 펼침·접힘을 모두 이것으로(누름·기록 지우기·빈 기록), 목록 id 하나를 aria-controls로', () => {
    const box = html('<button class="mb-btn" aria-expanded="false" aria-controls="measure-log">기록</button><div class="measure-log" id="measure-log" hidden></div>');
    const b = box.querySelector<HTMLButtonElement>('button')!;
    const list = box.querySelector<HTMLElement>('.measure-log')!;
    // 누름(앱 toggleMeasureLog 꼴 — 지금 숨김이면 펼침): 펼침 → 접힘
    disclose(b, list, !!list.hidden);
    expect(list.hidden).toBe(false);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    disclose(b, list, !!list.hidden);
    expect(list.hidden).toBe(true);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    // 펼친 채 기록 지우기·빈 기록 → 접힘, 접힌 채 다시 줘도 접힘 그대로
    disclose(b, list, true);
    disclose(b, list, false);
    expect(list.hidden).toBe(true);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    disclose(b, list, false);
    expect(list.hidden).toBe(true);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    // 앱 원문: 처음 접힘·목록 id(문서에 하나)를 가리킴, 목록 숨김을 바꾸는 세 길(누름·기록 지우기·빈 기록 띠 맞춤)이 모두 disclose — 숨김에 바로 넣는 줄 없음
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/const measureLogBtn = h\('button', \{[^}\n]*'aria-expanded': 'false', 'aria-controls': 'measure-log',/);
    expect(app).toMatch(/const measureLogEl = h\('div', \{ class: 'measure-log', id: 'measure-log', hidden: true \}\);/);
    expect(app.match(/id: 'measure-log'/g)).toHaveLength(1);
    expect(app).toMatch(/private toggleMeasureLog\(\): void \{\n\s*const el = this\.els\.measureLog;\n\s*disclose\(this\.els\.measureLogBtn, el, !!el\.hidden\);\n/);
    expect(app).toMatch(/clearMeasureLog\(\): void \{\n\s*this\.measureLog = \[\];\n\s*disclose\(this\.els\.measureLogBtn, this\.els\.measureLog, false\);\n/);
    expect(app).toMatch(/if \(!this\.measureLog\.length\) disclose\(e\.measureLogBtn, e\.measureLog, false\);/);
    expect(app.match(/disclose\((?:this\.els|e)\.measureLogBtn, /g)).toHaveLength(3);
    expect(app).not.toMatch(/measureLog\.hidden =|el\.hidden = !el\.hidden/);
  });
});

describe('막대의 화면 읽기 값(155차 — NC 140·STEP 146차 꼴, WAI-ARIA aria-valuetext)', () => {
  it('막대 값과 aria-valuetext를 함께 두고, 앱은 단면 위치(0~1000 → 장면 범위 안 %)·시야각(옆 값 글 그대로)을 맞추는 자리에서 모두 이것으로 — 번역층이 옮기지 않아 낱말 없이', () => {
    const box = html(
      '<input type="range" class="sec-range" min="0" max="1000" step="1" value="500"><input type="range" class="fov-range" min="10" max="120" step="1" value="35"><span class="fov-value"></span>',
    );
    const [sec, fov] = [...box.querySelectorAll<HTMLInputElement>('input')] as [HTMLInputElement, HTMLInputElement];
    const fovValue = box.querySelector<HTMLElement>('.fov-value')!;
    setRange(sec, 625, '62.5%');
    expect(sec.value).toBe('625');
    expect(sec.getAttribute('aria-valuetext')).toBe('62.5%');
    // 앱 원문의 실제 조각을 실제 setRange·막대로 돌린다(앱 클래스를 시험에서 만들지 않음 — pwa 시험의 new Function 꼴)
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const part = (from: string, to: string): string => {
      const a = app.indexOf(from);
      expect(a).toBeGreaterThan(0);
      return app.slice(a, app.indexOf('\n', app.indexOf(to, a)));
    };
    const runSec = new Function('e', 'sec', 'setRange', part('const pos = sec ?', 'setRange(e.secRange,')) as (e: unknown, s: { t: number } | null, f: typeof setRange) => void;
    const runFov = new Function('e', 'v', 'setRange', part('const fov = Math.round(v.fov);', 'setRange(e.fovRange,')) as (e: unknown, v: { fov: number }, f: typeof setRange) => void;
    const secAt = (s: { t: number } | null): [string, string | null] => {
      runSec({ secRange: sec }, s, setRange);
      return [sec.value, sec.getAttribute('aria-valuetext')];
    };
    // 단면 위치: 처음(값 500·단면 없음), 끌기·키·축·뒤집기 뒤 코어 t, 끔(값 그대로), 범위 밖 t는 0~1로 묶음 — 0.1% 한 칸
    sec.value = '500';
    sec.removeAttribute('aria-valuetext');
    expect(secAt(null)).toEqual(['500', '50%']);
    expect(secAt({ t: 0.25 })).toEqual(['250', '25%']);
    expect(secAt({ t: 0.123 })).toEqual(['123', '12.3%']);
    expect(secAt(null)).toEqual(['123', '12.3%']);
    expect(secAt({ t: 0.5004 })).toEqual(['500', '50%']);
    expect(secAt({ t: 1.2 })).toEqual(['1000', '100%']);
    expect(secAt({ t: -0.1 })).toEqual(['0', '0%']);
    // 시야각: 옆에 보이는 값 글을 그대로
    runFov({ fovRange: fov, fovValue }, { fov: 34.6 }, setRange);
    expect([fov.value, fovValue.textContent, fov.getAttribute('aria-valuetext')]).toEqual(['35', '35°', '35°']);
    runFov({ fovRange: fov, fovValue }, { fov: 90 }, setRange);
    expect([fov.value, fovValue.textContent, fov.getAttribute('aria-valuetext')]).toEqual(['90', '90°', '90°']);
    // 원문: kbd에서 가져오고, 두 막대의 값을 맞추는 자리는 setRange 둘뿐(막대 value에 바로 넣는 줄 없음), 옆 값 글을 쓰는 줄은 하나
    expect(app).toMatch(/import \{[^}]*\bsetRange\b[^}]*\} from '\.\/kbd';/);
    expect(app.match(/setRange\(e\.(?:secRange|fovRange), /g)).toHaveLength(2);
    expect(app).not.toMatch(/(?:secRange|fovRange)\.value = /);
    expect(app.match(/fovValue\.textContent = /g)).toHaveLength(1);
    // 번역층은 aria-valuetext를 옮기지 않는다(그래서 값 글은 수·단위·기호만)
    expect(readFileSync(resolve(__dirname, '../../src/app/i18n.ts'), 'utf8')).not.toContain('aria-valuetext');
  });
});

describe('최근 측정 줄을 목록으로(156차 — 152차 감사 ④, WAI-ARIA list·listitem)', () => {
  it('줄을 하나씩 listitem 칸에 담아 list로 묶고(감싼 칸은 블록 div — 스타일시트 그대로), 측정 띠 기록 목록·패널 아래 띠 최근 측정이 모두 이것으로 — 머리·모두 복사·기록 지우기는 목록 밖', () => {
    // 도우미: 차례·수 그대로, 칸마다 그 줄 요소 하나(같은 요소 — 클래스·글·누름 길 그대로)
    const rows = ['a', 'b', 'c'].map((t) => {
      const b = document.createElement('button');
      b.className = 'ml-row';
      b.textContent = t;
      return b;
    });
    const list = listRows(rows);
    expect([list.tagName, list.getAttribute('role')]).toEqual(['DIV', 'list']);
    expect([...list.children].map((li) => [li.tagName, li.getAttribute('role'), li.childElementCount, li.firstElementChild])).toEqual(rows.map((r) => ['DIV', 'listitem', 1, r]));
    expect(listRows([]).childElementCount).toBe(0);
    // 패널 아래 띠(실제 패널·작은 모형 — 151차 시험 꼴): 최근 측정 두 줄
    const d = rowDoc();
    const log: MeasureToolResult[] = [
      { kind: 'tape', a: [0, 0, 0], b: [1, 0, 0], distance: 1, dx: 1, dy: 0, dz: 0 },
      { kind: 'tape', a: [0, 0, 0], b: [0, 2, 0], distance: 2, dx: 0, dy: 2, dz: 0 },
    ];
    const copied: (number | 'all' | 'current')[] = [];
    const noop = (): void => {};
    const host: PanelHost = {
      setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
      setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
      hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: log,
      copyMeasure: (w) => copied.push(w), clearMeasureLog: noop,
      select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
    };
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    const det = panel.el.querySelector<HTMLElement>('.pfoot .measure-history')!;
    expect([...det.children].map((c) => c.tagName + (c.getAttribute('role') ? `[${c.getAttribute('role')}]` : ''))).toEqual(['SUMMARY', 'DIV[list]', 'DIV']);
    const items = [...det.querySelector<HTMLElement>(':scope > [role="list"]')!.children];
    expect(items.map((li) => li.getAttribute('role'))).toEqual(['listitem', 'listitem']);
    // 줄 글과 그 줄의 복사 버튼이 한 칸(버튼 이름이 모두 같아도 그 줄이 문맥), 차례 그대로, 목록 안 버튼은 줄 복사뿐
    for (const li of items) expect([li.querySelectorAll('.ml-line').length, li.querySelectorAll('.ml-line > span').length, li.querySelectorAll('button.ml-copy-btn').length, li.querySelectorAll('button').length]).toEqual([1, 1, 1, 1]);
    items[1]!.querySelector('button')!.click();
    expect(copied).toEqual([1]);
    // 앱 원문: 측정 띠 기록 목록도 같은 도우미로(앱 클래스를 시험에서 만들지 않음), 두 모듈 모두 kbd에서 가져옴
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const pan = readFileSync(resolve(__dirname, '../../src/app/panel.ts'), 'utf8');
    for (const src of [app, pan]) expect(src).toMatch(/import \{[^}]*\blistRows\b[^}]*\} from '\.\/kbd';/);
    expect(app).toMatch(/el\.replaceChildren\(h\('div', \{ class: 'ml-head' \}, [^\n]*\), listRows\(rows\), h\('div', \{ class: 'pbar ml-acts' \}, all, clear\)\);/);
    expect(pan).toMatch(/h\('summary', \{\}, `최근 측정 \$\{fmtCount\(log\.length\)\}개`\), listRows\(rows\), h\('div', \{ class: 'pbar' \}, all, clear\)/);
    // 스타일시트 그대로: 두 목록의 자식 결합자는 요약(summary)뿐이라 감싼 블록 칸이 걸리는 규칙을 바꾸지 않고, role로 꾸미는 규칙도 없음
    const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');
    expect(css.match(/\.(?:measure-log|measure-history|ml-row|ml-line)\s*>\s*[^\s{,]+/g)).toEqual(['.measure-history > summary', '.measure-history > summary']);
    expect(css).not.toMatch(/\[role="?list/);
  });
});

describe('열린 메뉴·목록 밖으로 초점이 나가면 닫기(162차 — NC 152차 꼴, WAI-ARIA APG Menu Button)', () => {
  it('바깥 누르기와 밖으로 나간 초점에 닫고(메뉴·연 버튼 안은 그대로, 연 차례의 사건은 받지 않음, 초점은 옮기지 않음) — 앱 메뉴·겹친 것 목록이 이것으로, 열린 채 남아 측정값 칸의 Esc를 창 키가 가져가지 않게', async () => {
    const box = html(
      '<button class="tbtn">보기 설정</button><div class="menu" role="menu"><button class="menu-item" role="menuitem" tabindex="-1">가</button><button class="menu-item" role="menuitem" tabindex="-1">나</button></div><input class="vcb-input"><button class="other">다른</button>',
    );
    const btn = box.querySelector<HTMLButtonElement>('.tbtn')!;
    const menu = box.querySelector<HTMLElement>('.menu')!;
    const [a, b] = [...menu.querySelectorAll<HTMLButtonElement>('.menu-item')] as [HTMLButtonElement, HTMLButtonElement];
    const input = box.querySelector<HTMLInputElement>('input')!;
    const other = box.querySelector<HTMLButtonElement>('.other')!;
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r));
    const press = (el: Element): void => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    // 앱 openMenu 꼴: 듣기를 두고 첫 항목에 초점, 닫을 때(closeMenu) 거둔다
    let open = false;
    let closed = 0;
    let off: (() => void) | null = null;
    const shut = (): void => {
      open = false;
      off?.();
      off = null;
    };
    const openMenu = (): void => {
      open = true;
      off = closeOutside([menu, btn], () => {
        closed++;
        shut();
      });
      a.focus();
    };
    openMenu();
    // 연 차례(같은 작업)의 사건은 받지 않는다
    press(other);
    expect([open, closed]).toEqual([true, 0]);
    await tick();
    // 메뉴 안 항목·연 버튼으로 옮기는 초점과 누르기는 그대로
    b.focus();
    btn.focus();
    a.focus();
    press(b);
    press(btn);
    expect([open, closed]).toEqual([true, 0]);
    // Tab 밖의 길로 초점이 밖(측정값 칸)으로 나가면 닫는다 — 한 번(닫으며 거둠), 초점은 옮긴 자리 그대로
    input.focus();
    expect([open, closed]).toEqual([false, 1]);
    expect(document.activeElement).toBe(input);
    other.focus();
    press(other);
    expect(closed).toBe(1);
    // 바깥 누르기도 같은 듣기
    openMenu();
    await tick();
    press(other);
    expect([open, closed]).toEqual([false, 2]);
    // 듣기 전에 거두면 타이머도 거둔다(연 차례에 닫힌 메뉴가 다음 메뉴를 닫지 않게)
    let late = 0;
    closeOutside([menu, btn], () => late++)();
    await tick();
    input.focus();
    press(other);
    expect(late).toBe(0);
    // 창 키 꼴(app.ts onKey — 메뉴가 열려 있으면 대상이 어디든 Esc를 메뉴 닫기로 가져가 버튼으로 초점·전파 막음)과 측정값 칸 Esc(입력 그만두기)
    const log: string[] = [];
    const onKey = (ev: KeyboardEvent): void => {
      if (open && ev.key === 'Escape') {
        ev.stopPropagation();
        shut();
        btn.focus();
        log.push('메뉴 닫기');
      }
    };
    input.addEventListener('keydown', (e) => void (e.key === 'Escape' && log.push('입력 그만두기')));
    window.addEventListener('keydown', onKey, true);
    try {
      openMenu();
      await tick();
      // 측정 시작점 뒤 숫자 키: 창 키가 측정값 칸 입력을 시작해 칸으로 초점(vcb.begin) — 메뉴는 그때 닫혀 칸의 Esc가 칸에 닿는다
      input.focus();
      key(input, 'Escape');
      expect(log).toEqual(['입력 그만두기']);
      expect(document.activeElement).toBe(input);
      expect(closed).toBe(3);
    } finally {
      window.removeEventListener('keydown', onKey, true);
      shut();
    }
    // 원문: 앱 도구 막대 메뉴(표준 뷰·단면·보기 설정·앱 설정 — openMenu 하나)와 겹친 것 목록이 같은 도우미, 바깥 누르기만 따로 듣는 줄은 남지 않음
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const pick = readFileSync(resolve(__dirname, '../../src/app/picklist.ts'), 'utf8');
    for (const src of [app, pick]) {
      expect(src).toMatch(/import \{[^}]*\bcloseOutside\b[^}]*\} from '\.\/kbd';/);
      expect(src).not.toMatch(/addEventListener\('pointerdown', away/);
    }
    expect(app).toContain('this.menuOff = closeOutside([menu, btn], () => this.closeMenu());');
    expect(pick).toContain('const away = closeOutside([menu], () => this.close());');
    // ?로 바로 가기 안내를 열 때 겹친 것 목록도 앱 메뉴처럼 먼저 닫고 연 곳(3D 보기)으로 — 안내가 닫히면 그리로 초점을 돌려준다(목록 항목은 떼어져 돌아갈 곳이 없음)
    expect(app).toMatch(/openShortcuts\(\): void \{\n\s*if \(this\.shortcutsClose \|\| this\.shortcutsLoading\) return;\n\s*const b = this\.menuBtn;\n\s*this\.closeMenu\(\);\n\s*focusIfLost\(b\);\n\s*this\.pickList\?\.dismiss\(\);\n/);
  });
});

describe('메뉴 항목 Tab·Shift+Tab(163차 — WAI-ARIA APG Menu Button 예제, NC 151차 꼴)', () => {
  it('닫고 메뉴 버튼으로 — Shift+Tab은 기본 동작을 막아 버튼에 머물고(버튼 앞 칸으로 건너뛰지 않게), Tab은 기본 동작 그대로(버튼 다음 칸), 밖 초점 닫기(162차)와 두 번 닫히지 않음 — 앱 도구 막대 메뉴 넷이 이것으로', async () => {
    const box = html('<button class="prev">전체 보기</button><button class="tbtn" aria-expanded="false">표준 뷰</button><button class="next">이전 보기</button>');
    const [prev, btn, next] = [...box.querySelectorAll<HTMLButtonElement>('button')] as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r));
    // 앱 openMenu·closeMenu 꼴: 메뉴는 body 끝에 붙이고(버튼과 이어지지 않음), 항목 keydown은 menuTab이 아니면 listKeys, 닫으면 떼고 밖 초점 듣기를 거둔다
    let open: HTMLElement | null = null;
    let menuBtn: HTMLButtonElement | null = null;
    let off: (() => void) | null = null;
    let closed = 0;
    const closeMenu = (): void => {
      if (!open) return;
      open.remove();
      open = null;
      off?.();
      off = null;
      menuBtn?.setAttribute('aria-expanded', 'false');
      menuBtn = null;
      closed++;
    };
    const openMenu = async (): Promise<HTMLButtonElement[]> => {
      const m = document.createElement('div');
      m.className = 'menu';
      m.setAttribute('role', 'menu');
      m.innerHTML =
        '<button class="menu-item" role="menuitem" tabindex="-1">앞</button><button class="menu-item" role="menuitem" tabindex="-1" disabled>꺼짐</button><button class="menu-item" role="menuitem" tabindex="-1">뒤</button>';
      m.addEventListener('keydown', (e) => {
        if (!menuTab(e, menuBtn, closeMenu)) listKeys(e, [...m.querySelectorAll<HTMLElement>('.menu-item')], 'ArrowUp', 'ArrowDown', true, 0);
      });
      document.body.append(m);
      open = m;
      menuBtn = btn;
      btn.setAttribute('aria-expanded', 'true');
      const items = [...m.querySelectorAll<HTMLButtonElement>('.menu-item')];
      items[0]!.focus();
      off = closeOutside([m, btn], closeMenu);
      await tick();
      return items;
    };
    // 다른 키는 다루지 않는다(↓는 listKeys가 꺼진 항목을 건너뛰어 옮김, Enter는 항목 누르기 몫 — 막지 않고 닫지 않음)
    let items = await openMenu();
    key(items[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    expect(key(items[2]!, 'Enter').defaultPrevented).toBe(false);
    expect(closed).toBe(0);
    // Shift+Tab: 한 번 닫고 버튼에 초점, 기본 동작을 막아 버튼에 머묾(전에는 버튼에서 앞 칸 — 전체 보기로 건너뜀)
    const back = key(items[2]!, 'Tab', { shiftKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect([closed, btn.getAttribute('aria-expanded'), document.querySelector('.menu')]).toEqual([1, 'false', null]);
    expect(document.activeElement).toBe(btn);
    // 닫으며 밖 초점 듣기를 거둬 그 뒤 초점 이동에 다시 닫지 않음
    prev.focus();
    expect(closed).toBe(1);
    // Tab: 한 번 닫고 버튼에 초점, 기본 동작은 그대로 — 브라우저가 버튼에서 다음 칸(이전 보기)으로 옮김(jsdom은 기본 Tab 이동이 없어 버튼에 머묾)
    items = await openMenu();
    const fwd = key(items[0]!, 'Tab');
    expect(fwd.defaultPrevented).toBe(false);
    expect([closed, document.querySelector('.menu')]).toEqual([2, null]);
    expect(document.activeElement).toBe(btn);
    next.focus();
    expect(closed).toBe(2);
    // 버튼이 없으면 막지 않음(초점이 떼어진 항목에 남지 않게 — 브라우저 기본 이동에 맡김), Tab 밖의 키는 false
    let shut = 0;
    const lone = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    expect(menuTab(lone, null, () => shut++)).toBe(true);
    expect([lone.defaultPrevented, shut]).toEqual([false, 1]);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    expect(menuTab(esc, btn, () => shut++)).toBe(false);
    expect([esc.defaultPrevented, shut]).toEqual([false, 1]);
    // 원문: 도구 막대 메뉴 넷(openMenu 하나)이 menuTab으로 — 기본 동작을 늘 그대로 두던 Tab 줄은 남지 않음
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/import \{[^}]*\bmenuTab\b[^}]*\} from '\.\/kbd';/);
    expect(app).toContain("if (!menuTab(e, this.menuBtn, () => this.closeMenu())) listKeys(e, [...menu.querySelectorAll<HTMLElement>('.menu-item')], 'ArrowUp', 'ArrowDown', true, 0);");
    expect(app).not.toMatch(/if \(e\.key === 'Tab'\) \{\n\s*const b = this\.menuBtn;/);
  });
});

describe('패널 크기 단계(44차 — WCAG 2.5.7 끌기 대신 누르기)', () => {
  it('지금보다 큰 첫 단계로, 가장 크면 가장 작은 단계로', () => {
    const steps = [...PANEL_WIDTH_STEPS];
    expect(nextSize(330, steps, 1)).toBe(480);
    expect(nextSize(480, steps, 1)).toBe(240);
    expect(nextSize(300, steps, 1)).toBe(330);
    expect(nextSize(330.5, steps, 1)).toBe(480);
    expect(nextSize(700, steps, 1)).toBe(240);
    expect(nextSize(0.46, [...SHEET_STEPS], 0.01)).toBe(0.7);
    expect(nextSize(0.7, [...SHEET_STEPS], 0.01)).toBe(0.3);
    // 낮은 창에서 맞춘 단계가 겹치면 겹친 것을 빼고 돈다(가장 큰 단계에 멈추지 않게)
    const low = [...new Set(SHEET_STEPS.map((s) => clampSheetFraction(s, 200)))];
    expect(low.length).toBeLessThan(SHEET_STEPS.length);
    expect(nextSize(low[low.length - 1]!, low, 0.01)).toBe(low[0]);
  });
});

describe('키보드 초점 스타일(44차)', () => {
  const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');
  const part = css.slice(css.indexOf('키보드로 쓰기(44차)'));
  it('메뉴 항목 초점은 배경 말고 안쪽 테두리도(마우스 올림과 구별 — 대비 1.2:1이던 배경만)', () => {
    expect(part).toMatch(/\.menu-item:focus-visible \{\s*outline: 2px solid var\(--accent\);\s*outline-offset: -2px;/);
  });
  it('장면 탭 줄(tablist)은 재생 단추 옆에서 띠의 간격을 그대로 이어받는다', () => {
    expect(part).toMatch(/\.scene-list \{\s*display: flex;\s*flex: none;\s*gap: inherit;/);
  });
  it('손가락 기기 900px 아래는 제목 막대에 "OpenCAD"만, 375px 아래는 로고만(414·768px에서 앱 이름, 360px 일본어·중국어에서 "OpenCAD"가 잘렸다)', () => {
    expect(part).toMatch(/@media \(pointer: coarse\) and \(max-width: 899\.98px\) \{\s*\.brand-sub \{\s*display: none;/);
    expect(part).toMatch(/@media \(pointer: coarse\) and \(max-width: 374\.98px\) \{\s*\.brand-text \{\s*display: none;/);
    // 태블릿 768px 독일어·일본어: 링크 단추는 아이콘만
    expect(part).toMatch(/\.titlebar a\.tbtn \.lbl \{\s*display: none;/);
  });
  it('패널 탭은 모든 폭에서 모자라면 두 줄(넓은 화면 독일어 "Informationen"이 가로 스크롤 밖), 보기 켜기 줄 이름은 줄을 바꾼다', () => {
    expect(part).toMatch(/\n\.ptabs \{\s*flex-wrap: wrap;\s*overflow-x: visible;/);
    expect(part).toMatch(/\.prow\.opt \.name \{\s*white-space: normal;/);
  });
});

describe('이름·값 줄을 설명 목록으로(171차 — WCAG 1.3.1 정보와 관계, H40 dl·dt·dd, 바로 가기 안내와 같은 꼴)', () => {
  it('선택 탭·정보 탭의 줄마다 이름 칸 dt·값 칸 dd(줄 칸 div·클래스·글·차례 그대로)를 절마다 dl 하나로 묶고 dl 안은 줄 칸뿐 — 버튼 줄·안내 글은 dl 밖, UA 기본 여백만 지운다', () => {
    const d = rowDoc();
    d.selection = { kind: 'node', index: 0 };
    d.panelTab = 'entity';
    const noop = (): void => {};
    const host: PanelHost = {
      setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
      setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
      hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [],
      copyMeasure: noop, clearMeasureLog: noop,
      select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
    };
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    // 줄 꼴: 묶음 태그 · 줄 태그 · 이름 칸 · 값 칸(고치기 전: SECTION · DIV · SPAN.k · SPAN.v — 이름과 값이 짝 없는 두 글)
    const shape = (root: ParentNode): string[] =>
      [...root.querySelectorAll('.prop-row')].map((r) => [r.parentElement!.tagName, r.tagName, ...[...r.children].map((c) => `${c.tagName}.${c.className}`)].join(' '));
    // 절마다 dl은 줄이 있을 때 하나, 그 안은 줄 칸뿐(dl 바로 아래는 dt·dd 묶음 div만 — HTML dl 내용 모형)
    const lists = (secs: Element[]): void => {
      for (const s of secs) {
        const dls = [...s.querySelectorAll('dl')];
        expect(dls.length, s.querySelector('h3')?.textContent ?? '').toBe(s.querySelector('.prop-row') ? 1 : 0);
        for (const dl of dls) expect([...dl.children].map((c) => c.className)).toEqual([...dl.children].map(() => 'prop-row'));
      }
    };
    const body = panel.el.querySelector<HTMLElement>('.pbody')!;
    const ent = shape(body);
    expect(ent.length).toBeGreaterThan(1);
    expect(new Set(ent)).toEqual(new Set(['DL DIV DT.k DD.v']));
    lists([...body.querySelectorAll('section')]);
    // 글·차례 그대로(엔티티 정보 줄과 같음), 3D 누르기 막대는 dl 밖
    const e = entityInfo(selectionEntity(d), d.units, mmPerSceneUnit(d.scene.units));
    expect([...body.querySelectorAll('.prop-row')].map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent])).toEqual(e.rows.map((r) => [r.label, r.value]));
    expect(body.querySelector('dl .seg-mini, dl .hint, dl button')).toBeNull();
    // 정보 탭 조각(파일·모형 통계 — 절마다 dl 하나, 안내 글·목록은 밖)
    const secs = infoSections(d, noop);
    document.body.append(...secs);
    const info = secs.flatMap((s) => shape(s));
    expect(info.length).toBeGreaterThan(5);
    expect(new Set(info)).toEqual(new Set(['DL DIV DT.k DD.v']));
    lists(secs);
    for (const s of secs) expect(s.querySelector('dl .hint, dl ul, dl .scene-grid')).toBeNull();
    // 모양 그대로: UA 기본 여백(dl 위아래 1em·dd 왼쪽 40px)만 바로 가기 안내 dl의 여백 규칙으로 지우고, 속성 사전 줄 안쪽 여백은 dl을 거쳐도 걸리게
    const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');
    expect(css).toMatch(/\n\.sc-list dt,\n\.psec dl,\n\.psec dd \{\n {2}margin: 0;\n\}\n/);
    expect(css).toMatch(/\n\.attr-dict \.prop-row \{\n {2}padding-inline: 8px;\n\}\n/);
    expect(css).not.toMatch(/\.prop-row\s*[>+~]|[>+~]\s*\.prop-row/);
  });
});

describe('찾기 칸의 이름을 보이는 자리 글로(172차 — WCAG 2.5.3 말로 부르는 이름·4.1.2 이름)', () => {
  it('구성 탭 찾기 칸(나무·한 단계 목록이 모두 searchBox)의 접근 이름(aria-label)이 보이는 이름표인 자리 글과 같고, 무엇을 찾는지는 찾기 영역 이름으로 — 찾는 글을 친 뒤에도 그대로, 있던 두 글뿐', () => {
    const d = rowDoc();
    d.panelTab = 'outline';
    const noop = (): void => {};
    const host: PanelHost = {
      setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
      setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
      hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [],
      copyMeasure: noop, clearMeasureLog: noop,
      select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
    };
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    const field = (): HTMLInputElement => {
      const all = [...panel.el.querySelectorAll<HTMLInputElement>('.pbody input[type="search"]')];
      expect(all).toHaveLength(1);
      return all[0]!;
    };
    const check = (): void => {
      const input = field();
      // 보이는 이름표: 감싼 label·for가 없고 자리 글뿐(위 절 제목은 「그룹·컴포넌트 N개」)
      expect([input.className, input.labels!.length, input.placeholder]).toEqual(['search-input', 0, '이름·정의·태그로 찾기']);
      // 이름은 aria-label(자리 글에만 기대지 않음)이고 그 글이 보이는 자리 글 그대로(고치기 전: 「그룹·컴포넌트 찾기(이름·정의·태그)」 — 자리 글을 품지 않았다)
      expect([input.getAttribute('aria-label'), input.hasAttribute('aria-labelledby')]).toEqual([input.placeholder, false]);
      // 무엇을 찾는지(그룹·컴포넌트를 이름·정의·태그로)는 감싼 찾기 영역(role=search)의 이름으로 — 칸 이름이던 같은 글
      const box = input.parentElement!;
      expect([box.className, box.getAttribute('role'), box.getAttribute('aria-label')]).toEqual(['search-box', 'search', '그룹·컴포넌트 찾기(이름·정의·태그)']);
    };
    check();
    // 찾는 글을 친 뒤 다시 그려도(자리 글이 보이지 않아도) 이름 그대로
    d.outlineQuery = 'Near';
    panel.rerender();
    expect(field().value).toBe('Near');
    check();
    // 원문: 찾기 칸은 하나(나무·한 단계 목록 두 곳이 같은 searchBox), 두 글은 사전에 있던 글
    const pan = readFileSync(resolve(__dirname, '../../src/app/panel.ts'), 'utf8');
    expect(pan.match(/type: 'search'/g)).toHaveLength(1);
    expect(pan.match(/this\.searchBox\(d, fill\)/g)).toHaveLength(2);
    const en = JSON.parse(readFileSync(resolve(__dirname, '../../site/locales/en.json'), 'utf8')) as Record<string, string>;
    expect([en['이름·정의·태그로 찾기'], en['그룹·컴포넌트 찾기(이름·정의·태그)']]).toEqual(['Find by name·definition·tag', 'Find groups·components (name·definition·tag)']);
  });
});
