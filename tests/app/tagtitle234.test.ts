// @vitest-environment jsdom
/**
 * 234차: 태그 탭 줄의 풀이(title)에서 모르는 수 조각을 뺀다 — 233차 상태 막대(app.ts refreshStatus — 모르는 수 조각을 빼고 둘 다 모르면 조각째)·
 * 정보 탭 줄(infotab.ts — 모르는 수 줄을 뺌)과 같은 꼴. 해석기가 태그 셈(tagStats)을 적지 않은 장면은 doc.ts tagRows가 장면 묶음 태그를 면·모서리 null로 두어
 * (이 시험 모형 rowDoc이 그 길) 전에는 풀이가 「이름: 면 — · 모서리 —」였다(번역하면 「Face — · Edge —」 — 한글은 남지 않지만 모르는 수 조각이 남음).
 * 둘 다 알면 사전 틀 「{0}: 면 {1} · 모서리 {2}」 그대로, 하나라도 모르면 이름만(한쪽만 아는 꼴은 해석기가 만들지 않는다 — 새 원문 열쇠 없이; 아는 면 수는 같은 줄 수 칩이 보인다).
 * 다섯 언어에서 「—」 0, 네 언어에서 한글 0(태그 이름은 라틴 글자라 풀이 전체를 센다).
 * 탭 몸통 조각은 beforeAll에서 미리 받는다(패널 show가 기다리지 않고 받는다 — 공용 규칙 5번).
 */
import { afterEach, beforeAll, expect, it } from 'vitest';
import type { TagRow } from '../../src/app/doc';
import { installLocalization } from '../../src/app/i18n';
import { Panel, loadPanelTabs, type PanelHost } from '../../src/app/panel';
import { catalogs } from '../../site/i18n.mjs';
import { rowDoc } from './rowdoc';

const noop = (): void => {};
const host: PanelHost = {
  setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
  setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
  hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [],
  copyMeasure: noop, clearMeasureLog: noop,
  select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
};
const KEY = '{0}: 면 {1} · 모서리 {2}';
const row = (name: string, faces: number | null, edges: number | null): TagRow => ({
  name, default: false, faces, edges, hasGeometry: true, visible: true, color: null, folder: -1, lineStyle: null,
});

let dispose: (() => void) | undefined;
beforeAll(async () => {
  await loadPanelTabs();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

it('태그 줄 풀이: 둘 다 알면 사전 틀 그대로, 모르는 수는 조각째 빼 이름만 — 다섯 언어에서 「—」 0, 네 언어에서 한글 0', async () => {
  for (const code of ['ko', 'en', 'ja', 'zh-CN', 'de'] as const) {
    dispose?.();
    document.body.innerHTML = '';
    history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
    dispose = await installLocalization(document.body);
    const d = rowDoc();
    // rowDoc의 태그 행은 doc.ts tagRows의 장면 묶음 길(tagStats 없음 — 면·모서리 null)
    const unknown = d.tags.filter((t) => t.faces === null && t.edges === null).map((t) => t.name);
    expect(unknown.length, code).toBeGreaterThan(0);
    d.tags.push(row('Walls', 1234, 56), row('Half', 7, null), row('Edges', null, 9));
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(d);
    const title = (name: string): string => panel.el.querySelector<HTMLElement>(`[data-tagrow="${name}"]`)!.title;
    const tpl = code === 'ko' ? KEY : catalogs[code]![KEY]!;
    expect.soft(title('Walls'), code).toBe(tpl.replace('{0}', 'Walls').replace('{1}', '1,234').replace('{2}', '56'));
    for (const name of [...unknown, 'Half', 'Edges']) expect.soft(title(name), `${code}: ${name}`).toBe(name);
    const titles = [...panel.el.querySelectorAll<HTMLElement>('[data-tagrow]')].map((el) => el.title);
    expect.soft(titles.filter((t) => t.includes('—')), code).toEqual([]);
    if (code !== 'ko') expect.soft(titles.filter((t) => /[가-힣]/.test(t)), code).toEqual([]);
  }
});
