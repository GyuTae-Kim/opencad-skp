// @vitest-environment jsdom
/**
 * 보이는 고름 상태를 화면 읽기 상태로도(186차 — WCAG 4.1.2 이름·역할·값). 패널 목록 줄은 고르면 `.sel`(왼쪽 막대)이 붙는데,
 * 나무 줄(treeitem)만 aria-selected를 받고 재질 줄(버튼)·컴포넌트 정의 표 줄(표 줄 안 버튼)은 클래스만 바뀌어 화면 읽기에 고른 줄이 드러나지 않았다.
 * 두 줄은 누르면 고르고 다시 누르면 푸는 토글이라 버튼의 aria-pressed로(같은 패널의 단면 줄·3D 누르기 방식 버튼과 같은 꼴),
 * 표 줄(tr — 표는 grid가 아니라 aria-selected가 뜻이 없음)에는 붙이지 않는다. 고름이 바뀌는 모든 길(누르기·다시 누르기·다른 줄·풀기·다시 그리기)에서 함께 바뀌는지 본다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MaterialRow, Selection } from '../../src/app/doc';
import { Panel, type PanelHost } from '../../src/app/panel';
import { rowDoc } from './rowdoc';

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
