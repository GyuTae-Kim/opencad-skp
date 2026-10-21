/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 태그·재질 / 구성(여러 단계 그룹·컴포넌트 나무) / 정보.
 * 아래 띠에는 고른 것과 측정 결과를 늘 보인다.
 *
 * 구성 나무: › 단추를 누르면 안쪽 그룹·컴포넌트를 펼친다. 펼친 단계는 3D에서 누를 때 고르는 단계도 정한다
 * (펼친 그룹 안을 누르면 그 안의 항목을 고른다 — "가장 안쪽" 방식이면 늘 가장 안쪽). 누르면 강조, 두 번 누르면 확대, 체크로 숨기기.
 * 노드가 아주 많아도 화면이 느려지지 않게 자식은 처음 CHILD_LIMIT개만 그리고 "더 보기"로 늘린다.
 */
import { h, icon } from './dom';
import type { MeasureToolResult } from './measure';
import {
  KIND_LABEL,
  boundsSize,
  componentImage,
  definitionCounts,
  docLabel,
  folderHidden,
  measureAxes,
  measureLine,
  measureText,
  folderTags,
  materialImage,
  panelTabs,
  partOfPick,
  selectionDefinition,
  selectionEntity,
  releaseName,
  selectionText,
  selectedNode,
  nodeSelection,
  unitLabel,
  unitSummary,
  type OutlineRow,
  type PanelTab,
  type Selection,
  type SkpDoc,
  type TagRow,
} from './doc';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs, rgbCss } from './format';
import { entityInfo } from './entity';
import { mmPerSceneUnit, unitsLabel } from './units';
import { NODE_HIDDEN, NODE_MORE, childrenOf, hiddenByNodes, isSplit, nodeDefinition, nodeName, nodePath, nodeTag, treeDefinitionCounts, type PickMode, type TreeView } from './tree';
import { normalizeQuery, parentPath, searchOutline, searchTree } from './search';

/** 패널이 부르는 앱 기능 */
export interface PanelHost {
  setTagVisible(name: string, on: boolean): void;
  setAllTagsVisible(on: boolean): void;
  setOutlineVisible(index: number, on: boolean): void;
  setNodeVisible(node: number, on: boolean): void;
  setExpanded(node: number, on: boolean): void;
  collapseAll(): void;
  setPickMode(mode: PickMode): void;
  setShowSoft(on: boolean): void;
  setShowHidden(on: boolean): void;
  setFolderVisible(folder: number, on: boolean): void;
  setAnnotationVisible(kind: 'texts' | 'dimensions' | 'guides' | 'sectionPlanes', on: boolean): void;
  /** 파일 단면(meta.sectionPlanes 차례) 적용, null = 끔 */
  setFileSection(index: number | null): void;
  /** 장면(meta.pages 차례) 적용 */
  applyPage(index: number): void;
  hideSelection(): void;
  isolateSelection(): void;
  unhideAll(): void;
  readonly isolated: boolean;
  /** 측정 도구 안내 글(없으면 null) */
  readonly measureHint: string | null;
  /** 최근 측정(새것이 앞) */
  readonly measureLogList: readonly MeasureToolResult[];
  copyMeasure(which: number | 'all' | 'current'): void;
  clearMeasureLog(): void;
  select(sel: Selection | null): void;
  /** 마지막으로 3D에서 누른 자리의 면·모서리 하나를 고른다(그룹을 고른 뒤 누른 면의 넓이를 볼 때) */
  selectPickedPart(): void;
  zoomToSelection(): void;
  closePanel(): void;
  readonly measuring: boolean;
}

/** 목록이 아주 길 때 한 번에 그리는 줄 수 */
const LIST_LIMIT = 2000;
/** 나무에서 한 노드의 자식을 처음에 그리는 수(더 보기로 늘린다) */
export const CHILD_LIMIT = 200;
/** 나무 전체에서 그리는 줄 수 한도 */
const TREE_ROW_LIMIT = 4000;

const row = (k: string, v: string): HTMLElement => h('div', { class: 'prop-row' }, h('span', { class: 'k' }, k), h('span', { class: 'v', title: v }, v));
const section = (title: string, ...children: (Node | null)[]): HTMLElement =>
  h('section', { class: 'psec' }, h('h3', {}, title), ...children);

/** 찾은 수 글 */
function foundText(total: number, shown: number): string {
  if (!total) return '찾은 항목이 없습니다.';
  return total > shown ? `찾은 항목 ${fmtCount(total)}개 중 처음 ${fmtCount(shown)}개` : `찾은 항목 ${fmtCount(total)}개`;
}

export class Panel {
  readonly el: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private doc: SkpDoc | null = null;
  /** 최근 측정 목록을 펼쳐 두었는지(다시 그려도 지킨다) */
  private logOpen = false;

  constructor(private readonly host: PanelHost) {
    this.tabsEl = h('div', { class: 'ptabs', role: 'tablist', 'aria-label': '패널 탭' });
    const close = h('button', { class: 'icon-btn', type: 'button', title: '패널 닫기', 'aria-label': '패널 닫기', html: icon('close') });
    close.addEventListener('click', () => this.host.closePanel());
    this.body = h('div', { class: 'pbody', role: 'tabpanel' });
    this.foot = h('div', { class: 'pfoot', hidden: true, 'aria-live': 'polite' });
    this.el = h('aside', { class: 'panel', 'aria-label': '모형 패널', hidden: true }, h('div', { class: 'phead' }, this.tabsEl, close), this.body, this.foot);
  }

  show(d: SkpDoc | null): void {
    const same = d === this.doc;
    this.doc = d;
    if (d && !panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = 'tags';
    this.render(same);
  }

  /** 지금 탭을 다시 그린다(펼치기·더 보기 등). 스크롤 자리는 지킨다 */
  rerender(): void {
    this.render(true);
  }

  /** 고르기·측정이 바뀌었을 때(목록 강조와 아래 띠만) */
  refreshSelection(reveal = false): void {
    const d = this.doc;
    if (!d) return;
    if (d.panelTab === 'entity') {
      this.body.innerHTML = '';
      this.renderEntity(d);
    }
    const key = selKey(d.selection);
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-sel]')) {
      const on = el.dataset.sel === key;
      el.classList.toggle('sel', on);
      if (el.getAttribute('role') === 'treeitem') el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (reveal) this.body.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    this.renderFoot();
  }

  /** 보이기 상태(태그·항목·노드)가 바뀌었을 때 */
  refreshVisibility(): void {
    const d = this.doc;
    if (!d) return;
    for (const cb of this.body.querySelectorAll<HTMLInputElement>('input[data-tag]')) cb.checked = !d.hiddenTags.has(cb.dataset.tag!);
    for (const cb of this.body.querySelectorAll<HTMLInputElement>('input[data-folder]')) cb.checked = !d.hiddenFolders.has(Number(cb.dataset.folder));
    // 숨긴 폴더 안의 태그·폴더는 흐리게
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-tagrow]')) {
      const t = d.tags.find((x) => x.name === el.dataset.tagrow);
      el.classList.toggle('dimmed', !!t && t.folder >= 0 && folderHidden(d, t.folder));
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-folderrow]')) {
      const p = d.tagFolders[Number(el.dataset.folderrow)]?.parent ?? -1;
      el.classList.toggle('dimmed', p >= 0 && folderHidden(d, p));
    }
    this.renderFoot();
    for (const cb of this.body.querySelectorAll<HTMLInputElement>('input[data-outline]')) cb.checked = !d.hiddenOutline.has(Number(cb.dataset.outline));
    const t = d.tree;
    if (t)
      for (const el of this.body.querySelectorAll<HTMLElement>('[data-node]')) {
        const n = Number(el.dataset.node);
        const cb = el.querySelector<HTMLInputElement>('input[type=checkbox]');
        if (cb) cb.checked = !d.hiddenNodes.has(n);
        // 조상이 숨으면 흐리게
        el.classList.toggle('dimmed', t.parent[n]! >= 0 && hiddenByNodes(t, d.hiddenNodes, t.parent[n]!));
      }
  }

  private render(keepScroll = false): void {
    const d = this.doc;
    const top = keepScroll ? this.body.scrollTop : 0;
    this.tabsEl.innerHTML = '';
    this.body.innerHTML = '';
    if (!d) {
      this.renderFoot();
      return;
    }
    for (const [k, label] of panelTabs(d)) {
      const on = k === d.panelTab;
      const b = h('button', { class: `ptab${on ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false' }, label);
      b.addEventListener('click', () => {
        if (d.panelTab === k) return;
        d.panelTab = k as PanelTab;
        this.render();
      });
      this.tabsEl.append(b);
    }
    if (d.panelTab === 'tags') this.renderTags(d);
    else if (d.panelTab === 'outline') this.renderOutline(d);
    else if (d.panelTab === 'entity') this.renderEntity(d);
    else this.renderInfo(d);
    this.refreshSelection();
    this.refreshVisibility();
    if (keepScroll) this.body.scrollTop = top;
  }

  // ───────────────────────── 태그·재질 ─────────────────────────

  private renderTags(d: SkpDoc): void {
    const x = d.extras;
    const toggle = (label: string, count: string, on: boolean, disabled: boolean, set: (v: boolean) => void, title: string): HTMLElement => {
      const cb = h('input', { type: 'checkbox', 'aria-label': label });
      cb.checked = on;
      cb.disabled = disabled;
      cb.addEventListener('change', () => set(cb.checked));
      return h('label', { class: `prow${disabled ? ' off' : ''}`, title }, cb, h('span', { class: 'name' }, label), h('span', { class: 'count' }, count));
    };
    const view: HTMLElement[] = [];
    if (x)
      view.push(
        toggle(
          '부드러운 모서리 보기',
          x.softSegments ? `선분 ${fmtCount(x.softSegments)}` : '없음',
          d.showSoft,
          !x.soft.size,
          (v) => this.host.setShowSoft(v),
          '곡면을 이루는 부드러운·매끈한 모서리를 옅은 선으로 보입니다(SketchUp 화면에서는 숨는 선)',
        ),
        toggle(
          '숨긴 형상 보기',
          x.hiddenFaces || x.hiddenSegments ? `면 ${fmtCount(x.hiddenFaces)} · 선분 ${fmtCount(x.hiddenSegments)}` : '없음',
          d.showHidden,
          !x.hidden.size,
          (v) => this.host.setShowHidden(v),
          '모형에서 숨긴 면·모서리·그룹·컴포넌트를 반투명 면과 점선으로 보입니다',
        ),
      );
    // 주석: 파일에 있는 것만 켜고 끄기를 보인다
    const items = d.annotationItems;
    const texts = d.texts.length;
    const dims = d.dimensions.length;
    if (texts || items?.leaders.length)
      view.push(toggle('글 보기', `${fmtCount(texts)}개`, d.showTexts, false, (v) => this.host.setAnnotationVisible('texts', v), '모형의 글(문자)과 지시선을 보입니다'));
    if (dims || items?.dimensions.length)
      view.push(toggle('치수 보기', `${fmtCount(dims)}개`, d.showDimensions, false, (v) => this.host.setAnnotationVisible('dimensions', v), '모형의 치수선과 치수 글을 보입니다'));
    if (items?.guides.length)
      view.push(toggle('보조선 보기', `묶음 ${fmtCount(items.guides.length)}`, d.showGuides, false, (v) => this.host.setAnnotationVisible('guides', v), '보조선(안내선)·보조점을 점선으로 보입니다'));
    if (d.sectionPlanes.length || items?.sectionPlanes.length)
      view.push(
        toggle('단면 기호 보기', `${fmtCount(d.sectionPlanes.length)}개`, d.showSectionPlanes, false, (v) => this.host.setAnnotationVisible('sectionPlanes', v), '파일에 놓인 단면 평면의 기호(사각형)를 보입니다'),
      );
    if (view.length) this.body.append(section('보기', ...view));

    // 파일 단면: 누르면 그 평면으로 자른다(코어 단면은 평면 하나 — 그룹 안 단면도 모형 전체를 자른다)
    if (d.sectionPlanes.length) {
      const list = h('div', { class: 'plist' });
      d.sectionPlanes.slice(0, LIST_LIMIT).forEach((sp, i) => {
        const on = d.fileSection === i;
        const b = h(
          'button',
          { class: `prow pick${on ? ' sel' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', title: on ? '누르면 단면을 끕니다' : '누르면 이 단면으로 모형을 자릅니다' },
          h('span', { class: 'swatch sec', 'aria-hidden': 'true' }),
          h('span', { class: 'name' }, sp.name || `단면 ${i + 1}`),
          sp.active ? h('span', { class: 'chip', title: '파일에서 활성인 단면' }, '활성') : null,
          sp.node >= 0 ? h('span', { class: 'chip', title: '그룹·컴포넌트 안의 단면 — 이 뷰어는 모형 전체를 자릅니다' }, '그룹 안') : null,
          sp.tag ? h('span', { class: 'count' }, sp.tag) : null,
        );
        b.addEventListener('click', () => this.host.setFileSection(on ? null : i));
        list.append(b);
      });
      this.body.append(section(`단면 평면 ${d.sectionPlanes.length}개`, list));
    }

    // 태그: 폴더 없는 태그 → 폴더(앞 순회 차례)와 그 안 태그
    const tags = d.tags;
    const allOn = h('button', { class: 'mini-btn', type: 'button' }, '모두 보기');
    const allOff = h('button', { class: 'mini-btn', type: 'button' }, '모두 숨기기');
    allOn.addEventListener('click', () => this.host.setAllTagsVisible(true));
    allOff.addEventListener('click', () => this.host.setAllTagsVisible(false));
    const list = h('div', { class: 'plist' });
    const tagRow = (t: TagRow, depth: number): HTMLElement => {
      const cb = h('input', { type: 'checkbox', 'data-tag': t.name, 'aria-label': `태그 ${t.name} 보이기` });
      cb.checked = !d.hiddenTags.has(t.name);
      cb.disabled = !t.hasGeometry;
      cb.addEventListener('change', () => this.host.setTagVisible(t.name, cb.checked));
      const count = t.faces !== null ? `면 ${fmtCount(t.faces)}` : '';
      return h(
        'label',
        {
          class: `prow${t.hasGeometry ? '' : ' off'}`,
          'data-tagrow': t.name,
          style: depth ? `padding-left:${8 + depth * 14}px` : undefined,
          title: t.hasGeometry ? `${t.name}: 면 ${fmtCount(t.faces)} · 모서리 ${fmtCount(t.edges)}` : `${t.name}: 그릴 것이 없는 태그`,
        },
        cb,
        t.color ? h('span', { class: 'swatch tag', style: `background:${rgbCss(t.color)}`, title: '태그 색' }) : null,
        h('span', { class: 'name', translate: 'no' }, t.name),
        t.default ? h('span', { class: 'chip' }, '기본') : null,
        t.lineStyle ? h('span', { class: 'chip', title: `선 종류: ${t.lineStyle} — 이 태그의 모서리를 점선으로 그립니다` }, '점선') : null,
        !t.visible ? h('span', { class: 'chip', title: '파일에서 숨긴 태그' }, '숨김') : null,
        h('span', { class: 'count' }, t.hasGeometry ? count : '비어 있음'),
      );
    };
    for (const t of tags) if (t.folder < 0 || t.folder >= d.tagFolders.length) list.append(tagRow(t, 0));
    const depthOf = (f: number): number => {
      let k = 0;
      for (let p = d.tagFolders[f]?.parent ?? -1; p >= 0 && k < 64; p = d.tagFolders[p]?.parent ?? -1) k++;
      return k;
    };
    d.tagFolders.forEach((f, i) => {
      const depth = depthOf(i);
      const cb = h('input', { type: 'checkbox', 'data-folder': String(i), 'aria-label': `태그 폴더 ${f.name} 보이기` });
      cb.checked = !d.hiddenFolders.has(i);
      cb.addEventListener('change', () => this.host.setFolderVisible(i, cb.checked));
      list.append(
        h(
          'label',
          { class: 'prow folder', 'data-folderrow': String(i), style: depth ? `padding-left:${8 + depth * 14}px` : undefined, title: `태그 폴더 ${f.name} — 숨기면 안의 태그가 모두 숨습니다` },
          cb,
          h('span', { class: 'fold-ico', html: icon('folder', 14) }),
          h('span', { class: 'name', translate: 'no' }, f.name || '(이름 없는 폴더)'),
          h('span', { class: 'count' }, `태그 ${fmtCount(folderTags(d, i).length)}`),
        ),
      );
      for (const t of tags) if (t.folder === i) list.append(tagRow(t, depth + 1));
    });
    this.body.append(
      section(`태그 ${tags.length}개`, tags.length ? h('div', { class: 'pbar' }, allOn, allOff) : null, tags.length ? list : h('p', { class: 'hint' }, '태그가 없습니다.')),
    );

    const mats = d.materials;
    const mlist = h('div', { class: 'plist' });
    for (const m of mats.slice(0, LIST_LIMIT)) {
      const sel: Selection = { kind: 'material', name: m.name };
      const tex = materialImage(d, m);
      const swatch = tex
        ? h('img', { class: 'swatch tex', src: tex, alt: '', loading: 'lazy', decoding: 'async', title: `무늬 그림: ${d.images?.materials.get(m.folder!)?.name ?? ''}` })
        : h('span', { class: 'swatch', style: `background:${rgbCss(m.color)};opacity:${Math.max(0.3, m.color[3])}` });
      const b = h(
        'button',
        { class: 'prow pick', type: 'button', 'data-sel': selKey(sel), title: `${m.name} — 누르면 이 재질의 면을 강조합니다` },
        swatch,
        h('span', { class: 'name', translate: 'no' }, m.name),
        m.textured
          ? h(
              'span',
              {
                class: 'chip',
                title: m.texture
                  ? '무늬(텍스처) 재질 — 3D에 무늬 그림을 입혔습니다'
                  : '무늬(텍스처) 재질 — 무늬 그림을 쓸 수 없어(없거나 한도를 넘음) 3D에서는 무늬의 평균색으로 보입니다',
              },
              m.texture ? '무늬' : '무늬 · 평균색',
            )
          : null,
        m.color[3] < 0.999 ? h('span', { class: 'chip', title: '반투명 재질' }, '투명') : null,
        h('span', { class: 'count' }, m.faces !== null ? `면 ${fmtCount(m.faces)}` : ''),
      );
      b.addEventListener('click', () => this.host.select(selKey(d.selection) === selKey(sel) ? null : sel));
      mlist.append(b);
    }
    this.body.append(
      section(
        `재질 ${mats.length}개`,
        mats.length ? mlist : h('p', { class: 'hint' }, '재질이 없습니다.'),
        mats.length > LIST_LIMIT ? h('p', { class: 'hint' }, `처음 ${LIST_LIMIT}개만 보입니다.`) : null,
      ),
    );
  }

  // ───────────────────────── 구성 ─────────────────────────

  private renderOutline(d: SkpDoc): void {
    if (d.tree) {
      this.renderTree(d, d.tree);
      return;
    }
    if (d.outlineSkipped) {
      this.body.append(
        section(
          '그룹·컴포넌트',
          h('p', { class: 'hint' }, `모형 바로 아래 그룹·컴포넌트가 ${fmtCount(d.outlineSkipped)}개로 많아, 화면이 느려지지 않게 하나씩 고르기를 껐습니다. 태그와 재질로 나눠 보세요.`),
        ),
      );
      return;
    }
    const list = h('div', { class: 'plist' });
    const found = h('p', { class: 'hint search-note', hidden: true, 'aria-live': 'polite' });
    const cut = h('p', { class: 'hint', hidden: true }, `처음 ${LIST_LIMIT}개만 보입니다.`);
    const fill = (): void => {
      list.innerHTML = '';
      const q = normalizeQuery(d.outlineQuery);
      const res = q ? searchOutline(d.outline, d.outlineQuery) : null;
      const rows = res ? res.rows : d.outline.slice(0, LIST_LIMIT);
      for (const r of rows) list.append(this.outlineRow(d, r));
      found.hidden = !res;
      if (res) found.textContent = foundText(res.total, res.rows.length);
      cut.hidden = !!res || d.outline.length <= LIST_LIMIT;
      this.refreshSelection();
      this.refreshVisibility();
    };
    fill();
    const groups = d.outline.filter((r) => r.kind === 'group').length;
    const comps = d.outline.filter((r) => r.kind === 'component').length;
    this.body.append(
      section(
        `모형 바로 아래 ${fmtCount(d.outline.length)}개`,
        this.pickBar(d),
        this.searchBox(d, fill),
        h('p', { class: 'hint' }, `그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}. 누르면 강조하고, 두 번 누르면 그쪽으로 확대합니다.`),
        found,
        list,
        cut,
      ),
    );
    this.renderDefinitions(d, definitionCounts(d.outline).filter((x) => x.kind === 'component'), '컴포넌트 정의별 개수');
  }

  /** 윗단계 목록 한 줄(나무가 없을 때, 나무에서는 바로 놓인 형상 줄) */
  private outlineRow(d: SkpDoc, r: OutlineRow): HTMLElement {
    const sel: Selection = { kind: 'outline', index: r.index };
    const cb = h('input', { type: 'checkbox', 'data-outline': String(r.index), 'aria-label': `${r.name} 보이기` });
    cb.checked = !d.hiddenOutline.has(r.index);
    cb.addEventListener('change', () => this.host.setOutlineVisible(r.index, cb.checked));
    cb.addEventListener('click', (e) => e.stopPropagation());
    const sub = [r.definition && r.definition !== r.name ? r.definition : null, r.kind !== 'loose' ? r.tag : null].filter(Boolean).join(' · ');
    const item = h(
      'div',
      { class: 'prow pick', role: 'button', tabindex: '0', 'data-sel': selKey(sel), title: '누르면 강조, 두 번 누르면 확대' },
      d.tree ? h('span', { class: 'twisty-space' }) : null,
      cb,
      h('span', { class: `kind k-${r.kind}` }, KIND_LABEL[r.kind]),
      h('span', { class: 'name', translate: 'no' }, r.name, sub ? h('small', {}, ` ${sub}`) : null),
      h('span', { class: 'count' }, `면 ${fmtCount(r.faces)}`),
    );
    this.bindPick(item, d, sel);
    return item;
  }

  /** 누르기(강조)·두 번 누르기(확대)·Enter */
  private bindPick(item: HTMLElement, d: SkpDoc, sel: Selection, extraKeys?: (e: KeyboardEvent) => boolean): void {
    const choose = (): void => this.host.select(selKey(d.selection) === selKey(sel) ? null : sel);
    item.addEventListener('click', choose);
    item.addEventListener('dblclick', () => {
      this.host.select(sel);
      this.host.zoomToSelection();
    });
    item.addEventListener('keydown', (e) => {
      if (extraKeys?.(e)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
  }

  /** 3D 누르기 방식 막대(나무가 있으면 펼친 단계·가장 안쪽·면·모서리, 없으면 그룹·면·모서리). collapse: 모두 접기 단추도 */
  private pickBar(d: SkpDoc, collapse = false): HTMLElement {
    const modeBtn = (mode: PickMode, label: string, title: string): HTMLButtonElement => {
      const b = h('button', { class: `seg-btn${d.pickMode === mode ? ' on' : ''}`, type: 'button', title, 'aria-pressed': d.pickMode === mode ? 'true' : 'false' }, label);
      b.addEventListener('click', () => this.host.setPickMode(mode));
      return b;
    };
    const face = modeBtn('face', '면·모서리', '누른 면 하나(넓이)나 모서리 하나(길이, 곡선이면 곡선 전체)를 고릅니다');
    const modes = d.tree
      ? [
          modeBtn('open', '펼친 단계', '모형 바로 아래부터, 펼친 그룹 안이면 그 안의 항목을 고릅니다. 3D에서 두 번 누르면 한 단계 들어갑니다'),
          modeBtn('deepest', '가장 안쪽', '누른 곳을 품은 가장 안쪽 그룹·컴포넌트를 바로 고릅니다(Alt+누르기도 같음)'),
          face,
        ]
      : [modeBtn('open', '그룹·컴포넌트', '누른 곳의 그룹·컴포넌트(밖이면 모형에 바로 놓인 형상)를 고릅니다'), face];
    const bar = h(
      'div',
      { class: 'pbar tree-bar' },
      h('span', { class: 'bar-label' }, '3D 누르기'),
      h('div', { class: 'seg-mini', role: 'group', 'aria-label': '3D에서 누를 때 고르는 것' }, ...modes),
    );
    if (collapse) {
      const btn = h('button', { class: 'mini-btn', type: 'button', title: '펼친 노드를 모두 접습니다(3D 고르기도 윗단계로)' }, '모두 접기');
      btn.addEventListener('click', () => this.host.collapseAll());
      btn.disabled = !d.expanded.size;
      bar.append(h('span', { class: 'spacer' }), btn);
    }
    return bar;
  }

  private renderTree(d: SkpDoc, t: TreeView): void {
    const bar = this.pickBar(d, true);

    const list = h('div', { class: 'plist tree', role: 'tree', 'aria-label': '그룹·컴포넌트 나무' });
    const found = h('p', { class: 'hint search-note', hidden: true, 'aria-live': 'polite' });
    const cutNote = h('p', { class: 'hint', hidden: true }, `처음 ${fmtCount(TREE_ROW_LIMIT)}줄만 보입니다. 펼친 노드를 접어 보세요.`);
    let rows = 0;
    let cut = false;
    const addChildren = (parent: number): void => {
      const kids = childrenOf(t, parent);
      const limit = d.childLimit.get(parent) ?? CHILD_LIMIT;
      for (let k = 0; k < kids.length; k++) {
        if (rows >= TREE_ROW_LIMIT) {
          cut = true;
          return;
        }
        if (k >= limit) {
          const more = h('button', { class: 'mini-btn more-btn', type: 'button', style: `margin-left:${indent(t.depth[kids[k]!]!) + 22}px` }, `… ${fmtCount(kids.length - k)}개 더 보기`);
          more.addEventListener('click', () => {
            d.childLimit.set(parent, limit + CHILD_LIMIT * 5);
            this.rerender();
          });
          list.append(more);
          return;
        }
        const n = kids[k]!;
        list.append(this.nodeRow(d, t, n));
        rows++;
        if (d.expanded.has(n)) addChildren(n);
      }
    };
    // 찾는 글이 있으면 맞는 노드만 한 줄씩(경로와 함께), 없으면 나무
    const fill = (): void => {
      list.innerHTML = '';
      rows = 0;
      cut = false;
      if (normalizeQuery(d.outlineQuery)) {
        const res = searchTree(t, d.outlineQuery);
        list.setAttribute('role', 'list');
        for (const n of res.nodes) list.append(this.searchRow(d, t, n));
        found.hidden = false;
        found.textContent = foundText(res.total, res.nodes.length);
        cutNote.hidden = true;
      } else {
        list.setAttribute('role', 'tree');
        found.hidden = true;
        const loose = d.outline.find((r) => r.kind === 'loose');
        if (loose) list.append(this.outlineRow(d, loose));
        addChildren(-1);
        cutNote.hidden = !cut;
      }
      this.refreshSelection();
      this.refreshVisibility();
    };
    fill();

    const groups = countKind(t, 0);
    const images = countKind(t, 2);
    const comps = t.count - groups - images;
    const notes: string[] = [`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}${images ? ` · 그림 ${fmtCount(images)}` : ''}(모든 단계, ${t.listedDepth}단계까지).`];
    notes.push('› 단추로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.');
    if (t.unlisted) notes.push(`노드가 많아 ${t.listedDepth + 1}단계부터는 목록에 넣지 않았습니다(그 안을 누르면 ${t.listedDepth}단계 항목을 고릅니다).`);
    if (d.outlineSkipped) notes.push(`모형 바로 아래 항목이 ${fmtCount(d.outlineSkipped)}개로 많아 그물을 나누지 않고, 숨기기·강조는 그물 안 구간으로 합니다.`);
    else if (t.splitDepth < t.listedDepth)
      notes.push(`그리기가 느려지지 않게 ${t.splitDepth}단계까지만 따로 그물을 나누고, 더 깊은 항목은 그물 안 구간으로 숨기고 강조합니다.`);
    if (t.runsDropped) notes.push('항목이 너무 많아 3D에서 깊은 단계를 눌러 고르지는 못합니다.');
    this.body.append(section(`그룹·컴포넌트 ${fmtCount(t.count)}개`, bar, this.searchBox(d, fill), h('p', { class: 'hint' }, notes.join(' ')), found, list, cutNote));
    this.renderDefinitions(d, treeDefinitionCounts(t), '컴포넌트 정의별 개수(모든 단계)');
  }

  /** 구성 찾기 칸: 이름·정의·태그로 거른다(글자를 칠 때마다 목록만 다시 그린다, Esc로 지운다) */
  private searchBox(d: SkpDoc, refill: () => void): HTMLElement {
    const input = h('input', {
      class: 'search-input',
      type: 'search',
      placeholder: '이름·정의·태그로 찾기',
      'aria-label': '그룹·컴포넌트 찾기(이름·정의·태그)',
      value: d.outlineQuery,
      autocomplete: 'off',
      spellcheck: 'false',
    });
    let timer = 0;
    input.addEventListener('input', () => {
      d.outlineQuery = input.value;
      clearTimeout(timer);
      timer = window.setTimeout(refill, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !input.value) return;
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      d.outlineQuery = '';
      refill();
    });
    return h('div', { class: 'search-box', role: 'search' }, input);
  }

  /** 찾은 노드 한 줄: 종류·이름(정의·태그)·위치 경로·면 수 — 누르면 고르고 조상을 펼친다, 두 번 누르면 확대 */
  private searchRow(d: SkpDoc, t: TreeView, n: number): HTMLElement {
    const sel = nodeSelection(d, n);
    const name = nodeName(t, n);
    const def = nodeDefinition(t, n);
    const tag = nodeTag(t, n);
    const path = parentPath(t, n);
    const kind = t.kind[n] === 0 ? 'group' : t.kind[n] === 2 ? 'image' : 'component';
    const sub = [def && def !== name ? def : null, tag].filter(Boolean).join(' · ');
    const cb = h('input', { type: 'checkbox', 'aria-label': `${name} 보이기`, title: '보이기·숨기기' });
    cb.checked = !d.hiddenNodes.has(n);
    cb.disabled = !(isSplit(t, n) || !t.runsDropped);
    cb.addEventListener('change', () => this.host.setNodeVisible(n, cb.checked));
    cb.addEventListener('click', (e) => e.stopPropagation());
    const item = h(
      'div',
      { class: 'prow pick trow search-row', role: 'listitem', tabindex: '0', 'data-sel': selKey(sel), 'data-node': String(n), title: `${name}${path ? ` — ${path}` : ''}` },
      cb,
      h('span', { class: `kind k-${kind}` }, KIND_LABEL[kind]),
      h('span', { class: 'name' }, name, sub ? h('small', {}, ` ${sub}`) : null, path ? h('small', { class: 'path' }, path) : null),
      h('span', { class: 'count' }, `면 ${fmtCount(t.faces[n]!)}`),
    );
    // 찾은 항목을 고르면 나무에서도 보이게(찾기를 지웠을 때) 조상을 펼친다
    item.addEventListener('click', () => {
      for (const a of nodePath(t, n).slice(0, -1)) d.expanded.add(a);
    });
    this.bindPick(item, d, sel);
    return item;
  }

  private nodeRow(d: SkpDoc, t: TreeView, n: number): HTMLElement {
    const sel = nodeSelection(d, n);
    const depth = t.depth[n]!;
    const hasKids = t.childCount[n]! > 0;
    const open = d.expanded.has(n);
    const name = nodeName(t, n);
    const def = nodeDefinition(t, n);
    const tag = nodeTag(t, n);
    const split = isSplit(t, n);
    const hiddenInModel = (t.flags[n]! & NODE_HIDDEN) !== 0;
    const more = (t.flags[n]! & NODE_MORE) !== 0;
    const twisty = hasKids
      ? h('button', { class: `twisty${open ? ' open' : ''}`, type: 'button', tabindex: '-1', 'aria-label': open ? `${name} 접기` : `${name} 펼치기`, html: icon('twisty', 14) })
      : h('span', { class: 'twisty-space', title: more ? '안쪽이 더 있지만 노드가 많아 목록에 넣지 않았습니다' : '' }, more ? '…' : '');
    if (hasKids)
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.setExpanded(n, !open);
      });
    const canHide = split || !t.runsDropped;
    const cb = h('input', {
      type: 'checkbox',
      'aria-label': `${name} 보이기`,
      title: canHide ? '보이기·숨기기' : '항목이 너무 많아 이 단계는 따로 숨길 수 없습니다 — 위 단계를 숨기세요',
    });
    cb.checked = !d.hiddenNodes.has(n);
    cb.disabled = !canHide;
    cb.addEventListener('change', () => this.host.setNodeVisible(n, cb.checked));
    cb.addEventListener('click', (e) => e.stopPropagation());
    const kind = t.kind[n] === 0 ? 'group' : t.kind[n] === 2 ? 'image' : 'component';
    const sub = [def && def !== name ? def : null, tag].filter(Boolean).join(' · ');
    const item = h(
      'div',
      {
        class: `prow pick trow${hiddenInModel ? ' model-hidden' : ''}${t.faces[n] || t.edges[n] ? '' : ' empty'}`,
        role: 'treeitem',
        tabindex: '0',
        'aria-level': String(depth),
        'aria-expanded': hasKids ? (open ? 'true' : 'false') : null,
        'data-sel': selKey(sel),
        'data-node': String(n),
        style: `padding-left:${indent(depth)}px`,
        title: `${name}${sub ? ` (${sub})` : ''} — 누르면 강조, 두 번 누르면 확대${hasKids ? ', › 펼치기' : ''}`,
      },
      twisty,
      cb,
      h('span', { class: `kind k-${kind}` }, KIND_LABEL[kind]),
      h('span', { class: 'name' }, name, sub ? h('small', {}, ` ${sub}`) : null),
      hiddenInModel ? h('span', { class: 'chip', title: '모형에서 숨긴 항목 — "숨긴 형상 보기"를 켜면 보입니다' }, '숨김') : null,
      h('span', { class: 'count' }, `면 ${fmtCount(t.faces[n]!)}`),
    );
    this.bindPick(item, d, sel, (e) => {
      if (e.key === 'ArrowRight' && hasKids && !open) {
        e.preventDefault();
        this.host.setExpanded(n, true);
        return true;
      }
      if (e.key === 'ArrowLeft' && open) {
        e.preventDefault();
        this.host.setExpanded(n, false);
        return true;
      }
      return false;
    });
    return item;
  }

  /** 컴포넌트 정의별 개수 표(미리보기 그림이 있으면 옆에) */
  private renderDefinitions(d: SkpDoc, defs: { name: string; count: number }[], title: string): void {
    if (!defs.length) return;
    const tbody = h('tbody');
    for (const x of defs.slice(0, 500)) {
      const img = componentImage(d, x.name);
      // 누르면 이 정의의 인스턴스를 모두 고른다(SketchUp 컴포넌트 창의 "인스턴스 고르기"), 두 번 누르면 그것들에 맞춰 본다
      const sel: Selection = { kind: 'definition', name: x.name };
      const tr = h(
        'tr',
        { class: 'pick', tabindex: '0', 'data-sel': selKey(sel), title: `누르면 "${x.name}" 인스턴스 ${fmtCount(x.count)}개를 모두 고릅니다 · 두 번 누르면 맞춰 보기` },
        h('td', {}, h('span', { class: 'def-cell' }, img ? h('img', { class: 'thumb', src: img, alt: '', loading: 'lazy', decoding: 'async', title: `${x.name} 미리보기` }) : null, x.name)),
        h('td', { class: 'num' }, fmtCount(x.count)),
      );
      this.bindPick(tr, d, sel);
      tbody.append(tr);
    }
    this.body.append(
      section(
        title,
        h('p', { class: 'hint' }, '줄을 누르면 그 정의의 인스턴스를 모두 고르고, 두 번 누르면 그것들에 맞춰 봅니다.'),
        h('table', { class: 'ptable' }, h('thead', {}, h('tr', {}, h('th', {}, '정의'), h('th', { class: 'num' }, '개수'))), tbody),
      ),
    );
  }

  // ───────────────────────── 선택(엔티티 정보) ─────────────────────────

  /** 고른 것의 정보(SketchUp의 엔티티 정보처럼): 이름·정의·태그·재질·크기·넓이·GUID·설명·속성 사전. 고른 것이 없으면 모형 */
  private renderEntity(d: SkpDoc): void {
    const e = entityInfo(selectionEntity(d), d.units, mmPerSceneUnit(d.scene.units));
    const rows = e.rows.map((r) => {
      const el = row(r.label, r.value);
      if (r.title) el.querySelector('.v')?.setAttribute('title', r.title);
      return el;
    });
    // 그룹을 고른 뒤 누른 면·모서리 하나만 다시 고르기(SketchUp에서 그룹에 들어가 면을 누르는 것처럼)
    const part = partOfPick(d);
    let pickPart: HTMLElement | null = null;
    if (part) {
      pickPart = h('button', { class: 'mini-btn', type: 'button', title: '3D에서 누른 면 하나(넓이)나 모서리 하나(길이)만 고릅니다' }, part === 'face' ? '누른 면만 고르기' : '누른 모서리만 고르기');
      pickPart.addEventListener('click', () => this.host.selectPickedPart());
    }
    // 고른 컴포넌트와 같은 정의의 인스턴스 모두(SketchUp "인스턴스 고르기")
    const def = selectionDefinition(d, d.selection);
    let allOfDef: HTMLElement | null = null;
    if (def) {
      allOfDef = h('button', { class: 'mini-btn', type: 'button', title: `"${def.name}" 정의의 인스턴스 ${fmtCount(def.count)}개를 모두 고릅니다` }, `같은 정의 모두 고르기(${fmtCount(def.count)}개)`);
      allOfDef.addEventListener('click', () => this.host.select({ kind: 'definition', name: def.name }));
    }
    this.body.append(
      section(
        e.title,
        this.pickBar(d),
        ...rows,
        pickPart || allOfDef ? h('div', { class: 'pbar' }, pickPart, allOfDef) : null,
        !d.selection ? h('p', { class: 'hint' }, '3D나 구성 목록에서 그룹·컴포넌트·재질을 고르면 그 정보를 보입니다. "면·모서리"로 누르면 면 하나의 넓이·모서리 하나의 길이를 봅니다.') : null,
      ),
    );
    if (e.dicts.length) {
      const blocks = e.dicts.map((dict) =>
        h(
          'details',
          { class: 'attr-dict', open: e.dicts.length <= 3 ? true : undefined },
          h('summary', {}, dict.name, h('span', { class: 'chip' }, dict.source === 'definition' ? '정의' : '이 항목'), h('span', { class: 'count' }, `${fmtCount(dict.entries.length)}개`)),
          ...dict.entries.map(([k, v]) => row(k, v)),
          dict.more ? h('p', { class: 'hint' }, `열쇠 ${fmtCount(dict.more)}개는 더 있어 줄였습니다.`) : null,
        ),
      );
      this.body.append(section('속성 사전', ...blocks, e.moreDicts ? h('p', { class: 'hint' }, `사전 ${fmtCount(e.moreDicts)}개는 줄였습니다.`) : null));
    }
  }

  // ───────────────────────── 정보 ─────────────────────────

  private renderInfo(d: SkpDoc): void {
    const s = d.scene;
    const info = d.info;
    const u = unitLabel(s.units);
    const thumb = d.images?.model;
    this.body.append(
      section(
        '파일',
        thumb ? h('img', { class: 'model-thumb', src: thumb.url, alt: `${d.name} 모형 미리보기(파일 안 그림)`, decoding: 'async' }) : null,
        row('이름', d.name),
        row('형식', docLabel(info)),
        row('SketchUp 판', info.version ? `${info.version} (${releaseName(info.version)})` : '모름'),
        d.modelName ? row('모형 이름', d.modelName) : null,
        d.modelDescription ? row('설명', d.modelDescription) : null,
        row('단위', unitSummary(info, s.units)),
        row('단위 형식', unitsLabel(d.units)),
        row('크기', formatBytes(d.size)),
        row('읽은 시간', formatMs(d.ms)),
      ),
    );
    const rows: HTMLElement[] = [];
    const add = (k: string, v: number | null): void => {
      if (v !== null) rows.push(row(k, fmtCount(v)));
    };
    add('면', info.faces);
    add('모서리', info.edges);
    add('컴포넌트 정의', info.definitions);
    add('인스턴스', info.instances);
    add('재질', info.materials);
    add('태그', info.tags);
    add('삼각형(펼친 뒤)', info.triangles);
    add('선분(펼친 뒤)', info.segments);
    const size = boundsSize(s);
    if (size) rows.push(row('범위 크기', `${fmtNum(size[0], 1)} × ${fmtNum(size[1], 1)} × ${fmtNum(size[2], 1)} ${u}`));
    if (s.bounds) rows.push(row('최소', fmtPt(s.bounds.min, 1)), row('최대', fmtPt(s.bounds.max, 1)));
    this.body.append(section('모형 통계', ...rows));
    const scenes = d.images?.scenes ?? [];
    if (d.pages.length) {
      // 장면(페이지): 누르면 그 장면의 카메라·숨긴 태그·숨긴 개체·단면·스타일을 적용한다
      const thumbs = new Map(scenes.map((sc) => [sc.path, sc.url] as const));
      const grid = h('div', { class: 'scene-grid' });
      d.pages.slice(0, 200).forEach((pg, i) => {
        const url = (pg.thumbnail && thumbs.get(pg.thumbnail)) || scenes.find((sc) => sc.name === pg.name)?.url || null;
        const on = d.page === i;
        const card = h(
          'button',
          { class: `scene-card pick${on ? ' sel' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', title: [pg.name, pg.description].filter(Boolean).join('\n') },
          url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'scene-blank', html: icon('scene', 28) }),
          h('span', { class: 'scene-cap' }, pg.name || `장면 ${i + 1}`, d.activePage === i ? h('span', { class: 'chip', title: '파일을 저장할 때 고른 장면' }, '활성') : null),
        );
        card.addEventListener('click', () => this.host.applyPage(i));
        grid.append(card);
      });
      this.body.append(section(`장면 ${d.pages.length}개`, h('p', { class: 'hint' }, '누르면 그 장면으로 바꿉니다(카메라·숨긴 태그·숨긴 개체·단면·스타일 중 장면이 기억하는 것). PageUp·PageDown으로도 넘깁니다.'), grid));
    } else if (scenes.length) {
      const grid = h('div', { class: 'scene-grid' });
      for (const sc of scenes.slice(0, 100))
        grid.append(h('figure', { class: 'scene-card', title: sc.name }, h('img', { src: sc.url, alt: '', loading: 'lazy', decoding: 'async' }), h('figcaption', { translate: 'no' }, sc.name)));
      this.body.append(section(`장면 그림 ${scenes.length}개`, h('p', { class: 'hint' }, '파일 안의 장면 미리보기 그림입니다(장면 목록을 읽지 못한 파일).'), grid));
    }
    const warns = s.warnings ?? [];
    this.body.append(
      section(
        warns.length ? `경고 ${warns.length}개` : '경고',
        warns.length
          ? h('ul', { class: 'warns' }, ...warns.slice(0, 300).map((w) => h('li', {}, w)))
          : h('p', { class: 'hint' }, '해석기가 남긴 경고가 없습니다.'),
      ),
    );
    this.body.append(
      section(
        '조작',
        h(
          'ul',
          { class: 'help' },
          h('li', {}, '왼쪽 끌기: 돌리기 · 오른쪽(가운데) 끌기: 옮기기 · 휠: 확대·축소'),
          h('li', {}, 'F: 전체 보기 · 1~7: 앞·뒤·왼쪽·오른쪽·위·아래·등각 · F7: 격자 · Ctrl/⌘+O: 열기'),
          h('li', {}, '누르기: 고르기(펼친 단계) · Alt+누르기: 가장 안쪽 · 두 번 누르기: 한 단계 들어가기'),
          h('li', {}, 'Esc: 측정 점 지우기 → 한 번 더 누르면 측정 끄기 · 측정 중이 아니면 고른 것 지우기'),
          h('li', {}, '패널 가장자리를 끌면 폭(좁은 화면은 높이)이 바뀝니다. 두 번 누르면 처음 크기로'),
          h('li', {}, '휴대폰: 한 손가락 돌리기 · 두 손가락 옮기기·확대'),
        ),
      ),
    );
  }

  // ───────────────────────── 아래 띠 ─────────────────────────

  private renderFoot(): void {
    const d = this.doc;
    const f = this.foot;
    f.innerHTML = '';
    if (!d) {
      f.hidden = true;
      return;
    }
    const lines: HTMLElement[] = [];
    const u = unitLabel(d.scene.units);
    const text = selectionText(d, d.selection, d.pick);
    if (text) {
      lines.push(h('div', {}, h('b', {}, '고른 것 '), text));
      if (d.pick) lines.push(h('div', { class: 'dim' }, `점 ${fmtPt(d.pick.point, 1)}${u ? ` ${u}` : ''}`));
      const n = selectedNode(d, d.selection);
      if (d.tree && n !== null && n >= 0 && d.tree.childCount[n]! > 0 && !d.expanded.has(n) && d.pickMode === 'open')
        lines.push(h('div', { class: 'dim' }, '안쪽 항목을 고르려면 3D에서 두 번 누르거나 목록에서 › 단추로 펼치세요.'));
    }
    // 고른 그룹·컴포넌트: 숨기기·분리해서 보기, 숨긴 것이 있으면 모두 보이기
    const canHide = d.selection?.kind === 'outline' || d.selection?.kind === 'node';
    const anyHidden = d.hiddenNodes.size > 0 || d.hiddenOutline.size > 0;
    if (canHide || anyHidden) {
      const act = (label: string, ico: string, title: string, run: () => void, on = false): HTMLButtonElement => {
        const b = h('button', { class: `mini-btn${on ? ' on' : ''}`, type: 'button', title, 'aria-pressed': on ? 'true' : undefined, html: `${icon(ico, 14)}<span>${label}</span>` });
        b.addEventListener('click', run);
        return b;
      };
      lines.push(
        h(
          'div',
          { class: 'pbar foot-acts' },
          canHide ? act('숨기기', 'hide', '고른 것을 보기에서 숨깁니다(파일은 그대로)', () => this.host.hideSelection()) : null,
          canHide || this.host.isolated
            ? act(this.host.isolated ? '분리 풀기' : '분리해서 보기', 'isolate', '고른 것만 보입니다 — 다시 누르면 모두 보입니다', () => this.host.isolateSelection(), this.host.isolated)
            : null,
          anyHidden ? act('모두 보이기', 'show', '숨긴 그룹·컴포넌트를 모두 다시 보입니다(태그는 그대로)', () => this.host.unhideAll()) : null,
        ),
      );
    }
    if (d.measure) {
      const m = d.measure;
      const mm = mmPerSceneUnit(d.scene.units);
      const axes = measureAxes(m, d.units, mm);
      lines.push(h('div', {}, h('b', {}, `${measureText(m, d.units, mm)} `), axes ? h('span', { class: 'dim' }, axes) : null));
    } else if (this.host.measuring) lines.push(h('div', { class: 'dim' }, this.host.measureHint ?? '측정: 점을 누르세요 · Esc = 지우기, 한 번 더 = 끄기'));
    // 최근 측정(새것부터): 줄마다 복사, 모두 복사·기록 지우기
    const log = this.host.measureLogList;
    if (log.length) {
      const mm = mmPerSceneUnit(d.scene.units);
      const rows = log.map((m, i) => {
        const b = h('button', { class: 'mini-btn ml-copy-btn', type: 'button', title: '이 결과 글 복사', 'aria-label': '이 결과 글 복사', html: icon('copy', 13) });
        b.addEventListener('click', () => this.host.copyMeasure(i));
        return h('div', { class: 'ml-line' }, h('span', { 'data-i18n-skip': '' }, measureLine(m, d.units, mm)), b);
      });
      const all = h('button', { class: 'mini-btn', type: 'button' }, '모두 복사');
      all.addEventListener('click', () => this.host.copyMeasure('all'));
      const clear = h('button', { class: 'mini-btn', type: 'button' }, '기록 지우기');
      clear.addEventListener('click', () => this.host.clearMeasureLog());
      lines.push(h('details', { class: 'measure-history', open: this.logOpen ? true : undefined }, h('summary', {}, `최근 측정 ${fmtCount(log.length)}개`), ...rows, h('div', { class: 'pbar' }, all, clear)));
      const det = lines[lines.length - 1] as HTMLDetailsElement;
      det.addEventListener('toggle', () => (this.logOpen = det.open));
    }
    f.hidden = !lines.length;
    f.append(...lines);
  }
}

function indent(depth: number): number {
  return 4 + (depth - 1) * 14;
}

function countKind(t: TreeView, kind: number): number {
  let n = 0;
  for (let i = 0; i < t.count; i++) if (t.kind[i] === kind) n++;
  return n;
}

/** 고른 것 비교 열쇠 */
export function selKey(sel: Selection | null): string {
  if (!sel) return '';
  switch (sel.kind) {
    case 'outline':
      return `o:${sel.index}`;
    case 'node':
      return `n:${sel.index}`;
    case 'material':
      return `m:${sel.name}`;
    case 'face':
      return `f:${sel.item}:${sel.start}`;
    case 'edge':
      return `e:${sel.item}:${sel.seg}`;
    case 'definition':
      return `d:${sel.name}`;
    default:
      return `i:${sel.id}`;
  }
}
