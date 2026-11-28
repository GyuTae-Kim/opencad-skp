// @vitest-environment jsdom
/**
 * 보이는 고름 상태를 화면 읽기 상태로도(186차 — WCAG 4.1.2 이름·역할·값). 패널 목록 줄은 고르면 `.sel`(왼쪽 막대)이 붙는데,
 * 나무 줄(treeitem)만 aria-selected를 받고 재질 줄(버튼)·컴포넌트 정의 표 줄(표 줄 안 버튼)은 클래스만 바뀌어 화면 읽기에 고른 줄이 드러나지 않았다.
 * 두 줄은 누르면 고르고 다시 누르면 푸는 토글이라 버튼의 aria-pressed로(같은 패널의 단면 줄·3D 누르기 방식 버튼과 같은 꼴),
 * 표 줄(tr — 표는 grid가 아니라 aria-selected가 뜻이 없음)에는 붙이지 않는다. 고름이 바뀌는 모든 길(누르기·다시 누르기·다른 줄·풀기·다시 그리기)에서 함께 바뀌는지 본다.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MaterialRow, Selection } from '../../src/app/doc';
import { Panel, loadPanelTabs, type PanelHost } from '../../src/app/panel';
import { rowDoc } from './rowdoc';

// 226차: 구성 탭 몸통(정의 표)은 탭 몸통 조각(infotab.ts)이라 패널을 그리기 전에 받아 둔다(받은 뒤 그리기는 옮기기 전과 같다, ci-guard 5)
beforeAll(async () => {
  await loadPanelTabs();
});
afterEach(() => {
  document.body.innerHTML = '';
});

const MAT: MaterialRow = { name: '원목', folder: null, color: [0.8, 0.6, 0.4, 1], textured: false, texture: null, faces: 6, backFaces: 0, area: null, meshIds: [] };

function setup(tab: 'tags' | 'outline'): { d: ReturnType<typeof rowDoc>; panel: Panel; select: (sel: Selection | null) => void } {
  const d = rowDoc();
  // 시험 모형은 그룹뿐이라 나무 노드를 컴포넌트로 바꿔 정의 표를 만든다(Row·Far·Near 한 줄씩), 재질 줄은 하나
  d.tree!.kind.fill(1);
  d.materials = [MAT, { ...MAT, name: '유리' }];
  const noop = (): void => {};
  const select = (sel: Selection | null): void => {
    d.selection = sel;
    panel.refreshSelection();
  };
  const host: PanelHost = {
    setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
    setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
    hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [], copyMeasure: noop, clearMeasureLog: noop,
    select, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
  };
  const panel = new Panel(host);
  document.body.append(panel.el);
  panel.el.hidden = false;
  d.panelTab = tab;
  panel.show(d);
  return { d, panel, select };
}

const pressed = (els: Element[]): (string | null)[] => els.map((b) => b.getAttribute('aria-pressed'));

describe('패널 목록 줄의 고름 상태(186차 — WCAG 4.1.2, 단면 줄 aria-pressed 꼴)', () => {
  it('컴포넌트 정의 표: 줄 안 버튼이 고름을 aria-pressed로 — 누르기·다시 누르기·다른 줄·나무 줄 고름·풀기·다시 그리기. 표 줄에는 붙이지 않고 나무 줄은 aria-selected 그대로', () => {
    const { d, panel, select } = setup('outline');
    const rows = (): HTMLTableRowElement[] => [...panel.el.querySelectorAll<HTMLTableRowElement>('table.ptable tbody tr.pick')];
    const cells = (): HTMLButtonElement[] => rows().map((tr) => tr.querySelector<HTMLButtonElement>('button.def-cell')!);
    expect(rows().length).toBe(3);
    // 처음 그린 표: 아무것도 고르지 않음
    expect(pressed(cells())).toEqual(['false', 'false', 'false']);
    // 줄 안 버튼 누르기 → 그 정의를 고름(줄에 .sel, 버튼은 눌림)
    cells()[1]!.click();
    expect(d.selection?.kind).toBe('definition');
    expect(rows().map((tr) => tr.classList.contains('sel'))).toEqual([false, true, false]);
    expect(pressed(cells())).toEqual(['false', 'true', 'false']);
    // 다른 줄 → 앞 줄은 풀림
    cells()[2]!.click();
    expect(pressed(cells())).toEqual(['false', 'false', 'true']);
    // 같은 줄을 다시 누르면 풀림(토글)
    cells()[2]!.click();
    expect(d.selection).toBeNull();
    expect(pressed(cells())).toEqual(['false', 'false', 'false']);
    // 나무 줄을 고르면 표 버튼은 모두 눌리지 않음, 나무 줄은 aria-selected(눌림 속성은 없음)
    cells()[0]!.click();
    const item = panel.el.querySelector<HTMLElement>('[role=treeitem]')!;
    item.click();
    expect(item.getAttribute('aria-selected')).toBe('true');
    expect(pressed(cells())).toEqual(['false', 'false', 'false']);
    expect(panel.el.querySelectorAll('[role=treeitem][aria-pressed], [role=treeitem] [aria-pressed]').length).toBe(0);
    // 다시 그려도(언어 바꿈·펼치기 등) 고른 정의는 눌림으로 그려진다
    select({ kind: 'definition', name: cells()[0]!.textContent! });
    panel.rerender();
    expect(pressed(cells())).toEqual(['true', 'false', 'false']);
    // 풀기(Esc·3D 빈 곳 — applySelection(null))
    select(null);
    expect(pressed(cells())).toEqual(['false', 'false', 'false']);
    // 표 줄(tr)은 표 안 줄이라 상태를 받지 않는다
    for (const tr of rows()) {
      expect(tr.hasAttribute('aria-selected')).toBe(false);
      expect(tr.hasAttribute('aria-pressed')).toBe(false);
    }
  });

  it('재질 줄(버튼): 고름을 aria-pressed로 — 누르기·다른 줄·다시 누르기·다른 데서 고름·다시 그리기', () => {
    const { panel, select } = setup('tags');
    const mats = (): HTMLButtonElement[] => [...panel.el.querySelectorAll<HTMLButtonElement>('button.prow.pick[data-sel]')];
    expect(mats().length).toBe(2);
    expect(pressed(mats())).toEqual(['false', 'false']);
    mats()[0]!.click();
    expect(mats()[0]!.classList.contains('sel')).toBe(true);
    expect(pressed(mats())).toEqual(['true', 'false']);
    mats()[1]!.click();
    expect(pressed(mats())).toEqual(['false', 'true']);
    mats()[1]!.click();
    expect(pressed(mats())).toEqual(['false', 'false']);
    // 3D·다른 탭에서 고른 것(재질이 아님) → 모두 눌리지 않음, 다시 그려도 고른 재질은 눌림
    select({ kind: 'material', name: '유리' });
    panel.rerender();
    expect(pressed(mats())).toEqual(['false', 'true']);
    select({ kind: 'node', index: 0 });
    expect(pressed(mats())).toEqual(['false', 'false']);
  });
});

/**
 * 211차(210차 꼴 — WCAG 2.4.6·3.3.2): 패널 아래 띠 「분리해서 보기」 버튼 풀이(title — 이름은 보이는 글이라 풀이는 화면 읽기 설명)가
 * 누르기 전(할 일 — 누르면 고른 것만 보임)과 눌린 뒤(「분리 풀기」·눌림 — 지금 상태: 고른 것만 보임)에 같은 원문
 * 「고른 것만 보입니다 — 다시 누르면 모두 보입니다」를 써서, 원문 그대로가 열쇠인 번역층이 지금 상태 꼴 한 번역(영어 You only see what you selected …·
 * 일본어 …表示しています·독일어 Sie sehen nur …)으로만 옮겨 누르기 전 버튼 풀이가 「이미 고른 것만 보고 있음」으로 읽혔다.
 * 누르기 전만 할 일 원문 「고른 것만 보기 — …」로 나누고, 눌린 뒤는 옛 원문(지금 상태) 그대로 — 이름·data-key·눌림·누르는 길은 그대로.
 */
describe('패널 아래 띠 「분리해서 보기」 풀이는 누르기 전 할 일, 눌린 뒤 지금 상태(211차 — 210차 꼴, WCAG 2.4.6·3.3.2)', () => {
  it('누르기 전 풀이만 할 일 원문으로 — 눌린 뒤는 옛 원문(지금 상태), 이름(보이는 글)·data-key·눌림·같은 띠 다른 버튼 풀이는 그대로', () => {
    const d = rowDoc();
    d.selection = { kind: 'node', index: 0 };
    let isolated = false;
    const noop = (): void => {};
    const host: PanelHost = {
      setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
      setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
      hideSelection: noop,
      // 앱(app.ts isolateSelection)처럼 켜고 끈 뒤 패널 보이기를 다시 맞춘다(아래 띠를 다시 그림)
      isolateSelection: () => {
        isolated = !isolated;
        panel.refreshVisibility();
      },
      unhideAll: noop,
      get isolated() {
        return isolated;
      },
      measureHint: null, measureLogList: [], copyMeasure: noop, clearMeasureLog: noop,
      select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
    };
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    const iso = (): HTMLButtonElement => panel.el.querySelector<HTMLButtonElement>('.pfoot .foot-acts button[data-key="isolate"]')!;
    const TODO = '고른 것만 보기 — 다시 누르면 모두 보입니다';
    const NOW = '고른 것만 보입니다 — 다시 누르면 모두 보입니다';
    // 누르기 전: 할 일 풀이(이름은 보이는 글 「분리해서 보기」, 눌림 속성 없음 — 지금과 같음)
    expect(iso().textContent).toBe('분리해서 보기');
    expect(iso().hasAttribute('aria-pressed')).toBe(false);
    expect(iso().title).toBe(TODO);
    // 누름 → 「분리 풀기」·눌림, 풀이는 지금 상태(옛 원문)
    iso().click();
    expect(iso().textContent).toBe('분리 풀기');
    expect(iso().getAttribute('aria-pressed')).toBe('true');
    expect(iso().title).toBe(NOW);
    // 다시 누름 → 처음대로
    iso().click();
    expect(iso().textContent).toBe('분리해서 보기');
    expect(iso().hasAttribute('aria-pressed')).toBe(false);
    expect(iso().title).toBe(TODO);
    // 같은 띠 「숨기기」 풀이는 그대로
    expect(panel.el.querySelector<HTMLButtonElement>('.pfoot .foot-acts button[data-key="hide"]')!.title).toBe('고른 것을 보기에서 숨깁니다(파일은 그대로)');
  });
});
