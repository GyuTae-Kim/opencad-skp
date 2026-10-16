/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 태그·재질 / 구성(여러 단계 그룹·컴포넌트 나무) / 정보.
 * 아래 띠에는 고른 것과 측정 결과를 늘 보인다.
 *
 * 구성 나무: › 단추를 누르면 안쪽 그룹·컴포넌트를 펼친다. 펼친 단계는 3D에서 누를 때 고르는 단계도 정한다
 * (펼친 그룹 안을 누르면 그 안의 항목을 고른다 — "가장 안쪽" 방식이면 늘 가장 안쪽). 누르면 강조, 두 번 누르면 확대, 체크로 숨기기.
 * 노드가 아주 많아도 화면이 느려지지 않게 자식은 처음 CHILD_LIMIT개만 그리고 "더 보기"로 늘린다.
 */
import { h, icon } from './dom';
import {
  KIND_LABEL,
  boundsSize,
  componentImage,
  definitionCounts,
  docLabel,
  materialImage,
  panelTabs,
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
} from './doc';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs, rgbCss } from './format';
import { NODE_HIDDEN, NODE_MORE, childrenOf, hiddenByNodes, isSplit, nodeDefinition, nodeName, nodeTag, treeDefinitionCounts, type PickMode, type TreeView } from './tree';

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
  select(sel: Selection | null): void;
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

export class Panel {
  readonly el: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private doc: SkpDoc | null = null;

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
    else this.renderInfo(d);
    this.refreshSelection();
    this.refreshVisibility();
    if (keepScroll) this.body.scrollTop = top;
  }

  // ───────────────────────── 태그·재질 ─────────────────────────

  private renderTags(d: SkpDoc): void {
    const x = d.extras;
    if (x) {
      const toggle = (label: string, count: string, on: boolean, disabled: boolean, set: (v: boolean) => void, title: string): HTMLElement => {
        const cb = h('input', { type: 'checkbox', 'aria-label': label });
        cb.checked = on;
        cb.disabled = disabled;
        cb.addEventListener('change', () => set(cb.checked));
        return h('label', { class: `prow${disabled ? ' off' : ''}`, title }, cb, h('span', { class: 'name' }, label), h('span', { class: 'count' }, count));
      };
      this.body.append(
        section(
          '보기',
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
        ),
      );
    }

    const tags = d.tags;
    const allOn = h('button', { class: 'mini-btn', type: 'button' }, '모두 보기');
    const allOff = h('button', { class: 'mini-btn', type: 'button' }, '모두 숨기기');
    allOn.addEventListener('click', () => this.host.setAllTagsVisible(true));
    allOff.addEventListener('click', () => this.host.setAllTagsVisible(false));
    const list = h('div', { class: 'plist' });
    for (const t of tags) {
      const cb = h('input', { type: 'checkbox', 'data-tag': t.name, 'aria-label': `태그 ${t.name} 보이기` });
      cb.checked = !d.hiddenTags.has(t.name);
      cb.disabled = !t.hasGeometry;
      cb.addEventListener('change', () => this.host.setTagVisible(t.name, cb.checked));
      const count = t.faces !== null ? `면 ${fmtCount(t.faces)}` : '';
      list.append(
        h(
          'label',
          { class: `prow${t.hasGeometry ? '' : ' off'}`, title: t.hasGeometry ? `${t.name}: 면 ${fmtCount(t.faces)} · 모서리 ${fmtCount(t.edges)}` : `${t.name}: 그릴 것이 없는 태그` },
          cb,
          h('span', { class: 'name' }, t.name),
          t.default ? h('span', { class: 'chip' }, '기본') : null,
          h('span', { class: 'count' }, t.hasGeometry ? count : '비어 있음'),
        ),
      );
    }
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
        h('span', { class: 'name' }, m.name),
        m.textured
          ? h('span', { class: 'chip', title: tex ? '무늬(텍스처) 재질 — 3D에서는 아직 무늬를 입히지 못해 평균색으로 보입니다' : '무늬(텍스처) 재질 — 무늬의 평균색으로 보입니다' }, '무늬')
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
    for (const r of d.outline.slice(0, LIST_LIMIT)) list.append(this.outlineRow(d, r));
    const groups = d.outline.filter((r) => r.kind === 'group').length;
    const comps = d.outline.filter((r) => r.kind === 'component').length;
    this.body.append(
      section(
        `모형 바로 아래 ${fmtCount(d.outline.length)}개`,
        h('p', { class: 'hint' }, `그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}. 누르면 강조하고, 두 번 누르면 그쪽으로 확대합니다.`),
        list,
        d.outline.length > LIST_LIMIT ? h('p', { class: 'hint' }, `처음 ${LIST_LIMIT}개만 보입니다.`) : null,
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
      h('span', { class: 'name' }, r.name, sub ? h('small', {}, ` ${sub}`) : null),
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

  private renderTree(d: SkpDoc, t: TreeView): void {
    // 3D 고르기 방식
    const modeBtn = (mode: PickMode, label: string, title: string): HTMLButtonElement => {
      const b = h('button', { class: `seg-btn${d.pickMode === mode ? ' on' : ''}`, type: 'button', title, 'aria-pressed': d.pickMode === mode ? 'true' : 'false' }, label);
      b.addEventListener('click', () => this.host.setPickMode(mode));
      return b;
    };
    const collapse = h('button', { class: 'mini-btn', type: 'button', title: '펼친 노드를 모두 접습니다(3D 고르기도 윗단계로)' }, '모두 접기');
    collapse.addEventListener('click', () => this.host.collapseAll());
    collapse.disabled = !d.expanded.size;
    const bar = h(
      'div',
      { class: 'pbar tree-bar' },
      h('span', { class: 'bar-label' }, '3D 누르기'),
      h(
        'div',
        { class: 'seg-mini', role: 'group', 'aria-label': '3D에서 누를 때 고르는 단계' },
        modeBtn('open', '펼친 단계', '모형 바로 아래부터, 펼친 그룹 안이면 그 안의 항목을 고릅니다. 3D에서 두 번 누르면 한 단계 들어갑니다'),
        modeBtn('deepest', '가장 안쪽', '누른 곳을 품은 가장 안쪽 그룹·컴포넌트를 바로 고릅니다(Alt+누르기도 같음)'),
      ),
      h('span', { class: 'spacer' }),
      collapse,
    );

    const list = h('div', { class: 'plist tree', role: 'tree', 'aria-label': '그룹·컴포넌트 나무' });
    const loose = d.outline.find((r) => r.kind === 'loose');
    if (loose) list.append(this.outlineRow(d, loose));
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
    addChildren(-1);

    const groups = countKind(t, 0);
    const comps = t.count - groups;
    const notes: string[] = [`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}(모든 단계, ${t.listedDepth}단계까지).`];
    notes.push('› 단추로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.');
    if (t.unlisted) notes.push(`노드가 많아 ${t.listedDepth + 1}단계부터는 목록에 넣지 않았습니다(그 안을 누르면 ${t.listedDepth}단계 항목을 고릅니다).`);
    if (d.outlineSkipped) notes.push(`모형 바로 아래 항목이 ${fmtCount(d.outlineSkipped)}개로 많아 그물을 나누지 않고, 숨기기·강조는 그물 안 구간으로 합니다.`);
    else if (t.splitDepth < t.listedDepth)
      notes.push(`그리기가 느려지지 않게 ${t.splitDepth}단계까지만 따로 그물을 나누고, 더 깊은 항목은 그물 안 구간으로 숨기고 강조합니다.`);
    if (t.runsDropped) notes.push('항목이 너무 많아 3D에서 깊은 단계를 눌러 고르지는 못합니다.');
    this.body.append(
      section(
        `그룹·컴포넌트 ${fmtCount(t.count)}개`,
        bar,
        h('p', { class: 'hint' }, notes.join(' ')),
        list,
        cut ? h('p', { class: 'hint' }, `처음 ${fmtCount(TREE_ROW_LIMIT)}줄만 보입니다. 펼친 노드를 접어 보세요.`) : null,
      ),
    );
    this.renderDefinitions(d, treeDefinitionCounts(t), '컴포넌트 정의별 개수(모든 단계)');
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
    const kind = t.kind[n] === 0 ? 'group' : 'component';
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
      tbody.append(
        h(
          'tr',
          {},
          h('td', {}, h('span', { class: 'def-cell' }, img ? h('img', { class: 'thumb', src: img, alt: '', loading: 'lazy', decoding: 'async', title: `${x.name} 미리보기` }) : null, x.name)),
          h('td', { class: 'num' }, fmtCount(x.count)),
        ),
      );
    }
    this.body.append(section(title, h('table', { class: 'ptable' }, h('thead', {}, h('tr', {}, h('th', {}, '정의'), h('th', { class: 'num' }, '개수'))), tbody)));
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
        row('단위', unitSummary(info, s.units)),
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
    if (scenes.length) {
      const grid = h('div', { class: 'scene-grid' });
      for (const sc of scenes.slice(0, 100))
        grid.append(h('figure', { class: 'scene-card', title: sc.name }, h('img', { src: sc.url, alt: '', loading: 'lazy', decoding: 'async' }), h('figcaption', {}, sc.name)));
      this.body.append(
        section(
          `장면 ${scenes.length}개`,
          h('p', { class: 'hint' }, '파일 안의 장면 미리보기 그림입니다. 장면의 카메라 값을 아직 읽지 못해 장면 전환은 아직 안 됩니다.'),
          grid,
        ),
      );
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
    if (d.measure) {
      const m = d.measure;
      lines.push(h('div', {}, h('b', {}, '거리 '), `${fmtNum(m.distance, 2)} ${u}`, h('span', { class: 'dim' }, ` · dx ${fmtNum(m.dx, 2)} · dy ${fmtNum(m.dy, 2)} · dz ${fmtNum(m.dz, 2)}`)));
    } else if (this.host.measuring) lines.push(h('div', { class: 'dim' }, '측정: 두 점을 누르세요(꼭짓점·끝점 가까우면 그 점에 붙습니다). Esc = 지우기, 한 번 더 = 측정 끄기'));
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
    default:
      return `i:${sel.id}`;
  }
}
