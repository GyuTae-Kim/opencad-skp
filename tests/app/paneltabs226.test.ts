// @vitest-environment jsdom
/**
 * 226차: 패널의 처음 탭(태그·재질) 밖 탭 몸통(구성·선택·정보)을 첫 화면 조각에서 떼어 정보 탭 조각(infotab.ts — 52차)으로 옮겼다(NC 210차 꼴, 첫 화면 가름은 core-split.test).
 * 문서를 보인 패널(show)이 그 조각을 미리 받고, 받기 전에 그 탭을 그리면 몸통을 비운 채 「받는 중」 깃발로 한 번만 받은 뒤 그 탭이면 다시 그린다(받은 뒤에는 곧바로 — 옮기기 전과 같은 그림).
 * 받지 못하면 console.error를 남기고 다음에 그릴 때 다시 받는다(core.ts onceImport).
 * 228차: 받지 못하면 몸통이 빈 칸으로 남던 것을 몸통 안 알림 글(role=alert — 「{0}을(를) 불러오지 못했습니다.」)과 「다시 시도」로 바꿨다(WCAG 3.3.1·4.1.3, NC 211·212차 꼴).
 * 받는 중 깃발은 내리고, 실패 뒤 거듭 그리기는 다시 받지 않으며(알림이 되풀이되지 않게) 다시 시도가 초점을 지금 탭 버튼에 두고 다시 받는다. 선택 탭의 속성 사전 칸(attrview)도 같은 꼴.
 * 이 파일은 패널 모듈을 처음 부르는 시험이라 조각을 받지 않은 패널로 시작한다(다른 시험 파일은 beforeAll에서 loadPanelTabs로 미리 받는다 — ci-guard 5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panel, loadPanelTabs, type PanelHost } from '../../src/app/panel';
import { rowDoc } from './rowdoc';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  // 228차: 받기 실패 가짜는 it마다 풀어 둔다(앞 it가 끝에 닿지 못해도 다음 it가 가짜를 받지 않게)
  vi.doUnmock('../../src/app/infotab');
  vi.doUnmock('../../src/app/attrview');
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

  it('228차: 받지 못하면 받는 중 깃발을 내리고 몸통에 알림 글(role=alert)과 다시 시도 — 거듭 그려도 다시 받지 않고, 다시 시도가 지금 탭 버튼에 초점을 두고 다시 받아 그 탭을 그린다', async () => {
    vi.resetModules();
    vi.doMock('../../src/app/infotab', () => {
      throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/infotab-x.js');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('../../src/app/panel');
    const { d, panel, body } = mount(fresh.Panel);
    const again = (): HTMLButtonElement => [...body().querySelectorAll('button')].find((b) => b.textContent === '다시 시도')!;
    // 문서를 보인 패널의 미리 받기가 받지 못함(console.error 한 번 — 까닭 글은 콘솔에만). 태그 탭은 첫 화면 조각이라 그대로
    await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(1));
    expect(body().querySelector('[role=alert]')).toBeNull();
    // 구성 탭: 곧바로 알림 글과 다시 시도(빈 칸이 아님). 거듭 그려도 다시 받지 않는다(알림이 되풀이되지 않게 — console.error 그대로 한 번)
    d.panelTab = 'outline';
    panel.rerender();
    panel.rerender();
    const alerts = body().querySelectorAll('[role=alert]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe('구성을(를) 불러오지 못했습니다.');
    expect(body().textContent).not.toMatch(/Failed to fetch|dynamically/);
    expect(again()).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(err).toHaveBeenCalledTimes(1);
    // 다시 시도: 이번에도 받지 못함 — 초점은 지금 탭 버튼(눌린 버튼은 다시 그리며 없어진다), 알림 글은 하나(새로 넣음)
    again().focus();
    again().click();
    expect(document.activeElement).toBe(panel.el.querySelector('#ptab-outline'));
    await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(body().querySelectorAll('[role=alert]')).toHaveLength(1));
    expect(document.activeElement).toBe(panel.el.querySelector('#ptab-outline'));
    // 받을 수 있게 되면 다시 시도가 받아 그 탭을 그린다(받는 중 깃발이 실패 뒤에도 막지 않는다)
    vi.doUnmock('../../src/app/infotab');
    again().click();
    await vi.waitFor(() => expect(body().querySelector('[role=tree]')).not.toBeNull());
    expect(body().querySelector('[role=alert]')).toBeNull();
    expect(document.activeElement).toBe(panel.el.querySelector('#ptab-outline'));
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('228차: 선택 탭의 속성 사전 칸 조각을 받지 못하면 칸 자리에 알림 글과 다시 시도(전에는 말없이 칸을 뺐다) — 다시 시도가 다시 받아 칸을 그린다', async () => {
    vi.resetModules();
    vi.doMock('../../src/app/attrview', () => {
      throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/attrview-x.js');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('../../src/app/panel');
    await fresh.loadPanelTabs();
    const { d, panel, body } = mount(fresh.Panel);
    // 모형 속성 사전 하나(고른 것이 없으면 선택 탭이 모형 정보와 그 사전을 보인다)
    d.attributes = [{ Render: { mode: 'fast' } }] as unknown as typeof d.attributes;
    d.modelAttrs = 0;
    d.panelTab = 'entity';
    panel.rerender();
    await vi.waitFor(() => expect(body().querySelector('[role=alert]')).not.toBeNull());
    expect(body().querySelector('[role=alert]')!.textContent).toBe('속성 사전을(를) 불러오지 못했습니다.');
    expect(err).toHaveBeenCalledTimes(1);
    // 모형 정보 줄은 그대로(칸 하나만 알림 글)
    expect(body().querySelectorAll('.prop-row').length).toBeGreaterThan(0);
    // 거듭 그려도 다시 받지 않고 곧바로 알림 글(받는 중 깃발이 남지 않음 — 다시 시도로 다시 받는다)
    panel.rerender();
    expect(body().querySelectorAll('[role=alert]')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(err).toHaveBeenCalledTimes(1);
    vi.doUnmock('../../src/app/attrview');
    const again = [...body().querySelectorAll('button')].find((b) => b.textContent === '다시 시도')!;
    again.focus();
    again.click();
    expect(document.activeElement).toBe(panel.el.querySelector('#ptab-entity'));
    await vi.waitFor(() => expect(body().querySelector('.attr-dict')).not.toBeNull());
    expect(body().querySelector('[role=alert]')).toBeNull();
  });
});
