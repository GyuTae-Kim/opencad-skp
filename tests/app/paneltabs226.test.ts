// @vitest-environment jsdom
/**
 * 226차: 패널의 처음 탭(태그·재질) 밖 탭 몸통(구성·선택·정보)을 첫 화면 조각에서 떼어 정보 탭 조각(infotab.ts — 52차)으로 옮겼다(NC 210차 꼴, 첫 화면 가름은 core-split.test).
 * 문서를 보인 패널(show)이 그 조각을 미리 받고, 받기 전에 그 탭을 그리면 몸통을 비운 채 「받는 중」 깃발로 한 번만 받은 뒤 그 탭이면 다시 그린다(받은 뒤에는 곧바로 — 옮기기 전과 같은 그림).
 * 받지 못하면 console.error를 남기고 다음에 그릴 때 다시 받는다(core.ts onceImport).
 * 이 파일은 패널 모듈을 처음 부르는 시험이라 조각을 받지 않은 패널로 시작한다(다른 시험 파일은 beforeAll에서 loadPanelTabs로 미리 받는다 — ci-guard 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panel, loadPanelTabs, type PanelHost } from '../../src/app/panel';
import { rowDoc } from './rowdoc';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const noop = (): void => {};
const host: PanelHost = {
  setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
  setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
  hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [],
  copyMeasure: noop, clearMeasureLog: noop,
  select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
};

/** 패널을 붙여 문서를 보인다(앱 setDoc처럼 처음 탭은 태그·재질) */
function mount(P: typeof Panel = Panel): { d: ReturnType<typeof rowDoc>; panel: Panel; body: () => HTMLElement } {
  const d = rowDoc();
  const panel = new P(host);
  document.body.append(panel.el);
  panel.el.hidden = false;
  panel.show(d);
  return { d, panel, body: () => panel.el.querySelector<HTMLElement>('.pbody')! };
}

describe('패널 탭 몸통 조각 받기(226차)', () => {
  it('받기 전: 태그 탭은 곧바로 그리고, 구성 탭은 몸통을 비운 채 한 번만 받아(거듭 그려도) 받은 뒤 다시 그린다 — 받은 패널이 곧바로 그린 것과 같은 그림', async () => {
    const { d, panel, body } = mount();
    // 태그 탭은 첫 화면 조각(곧바로), show가 탭 몸통 조각을 미리 받기 시작한다(받는 동안·받은 뒤 같은 약속)
    expect(body().querySelectorAll('section.psec').length).toBeGreaterThan(0);
    const pending = loadPanelTabs();
    expect(loadPanelTabs()).toBe(pending);
    // 받는 동안 구성 탭: 탭 줄은 그 탭을 고른 채, 몸통은 비움(거듭 그려도 받기는 그 약속 하나)
    d.panelTab = 'outline';
    panel.rerender();
    panel.rerender();
    expect(panel.el.querySelector('#ptab-outline')!.getAttribute('aria-selected')).toBe('true');
    expect(body().childElementCount).toBe(0);
    expect(loadPanelTabs()).toBe(pending);
    await pending;
    // 받은 뒤 그 탭을 다시 그림(나무·찾기 칸·정의 표)
    await vi.waitFor(() => expect(body().querySelector('[role=tree]')).not.toBeNull());
    const waited = body().innerHTML;
    // 받은 패널은 곧바로 그린다(옮기기 전과 같은 꼴 — 같은 문서·같은 탭이면 같은 그림)
    const b = mount();
    b.d.panelTab = 'outline';
    b.panel.rerender();
    expect(b.body().innerHTML).toBe(waited);
    expect(b.body().querySelectorAll('.search-input')).toHaveLength(1);
    // 선택·정보 탭도 곧바로
    b.d.panelTab = 'entity';
    b.panel.rerender();
    expect(b.body().querySelectorAll('.prop-row').length).toBeGreaterThan(0);
    b.d.panelTab = 'info';
    b.panel.rerender();
    expect(b.body().querySelectorAll('section.psec').length).toBeGreaterThan(0);
  });

  it('받지 못하면 console.error를 남기고(몸통은 빈 채) 다음에 그릴 때 다시 받는다', async () => {
    vi.resetModules();
    vi.doMock('../../src/app/infotab', () => {
      throw new Error('Failed to fetch dynamically imported module: http://x/assets/infotab-x.js');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('../../src/app/panel');
    const { d, panel, body } = mount(fresh.Panel);
    await expect(fresh.loadPanelTabs()).rejects.toThrow();
    await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(1));
    d.panelTab = 'outline';
    panel.rerender();
    expect(body().childElementCount).toBe(0);
    // 다음 그리기가 다시 받는다(받지 못한 약속은 비워 둠) — 이번에도 받지 못해 한 번 더 알림
    await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(2));
    vi.doUnmock('../../src/app/infotab');
  });
});
