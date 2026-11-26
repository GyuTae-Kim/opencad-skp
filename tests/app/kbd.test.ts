// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { focusIfLost, focusSpot, leaveDisabled, listKeys, lost, moveIndex, refocus, rove, treeKeys } from '../../src/app/kbd';
import { PANEL_WIDTH_STEPS, SHEET_STEPS, clampSheetFraction, nextSize } from '../../src/app/layout';
import type { MeasureToolResult } from '../../src/app/measure';
import { Panel, type PanelHost } from '../../src/app/panel';
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
