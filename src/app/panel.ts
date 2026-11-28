/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 태그·재질 / 구성(여러 단계 그룹·컴포넌트 나무) / 정보.
 * 아래 띠에는 고른 것과 측정 결과를 늘 보인다.
 *
 * 구성 나무: › 단추를 누르면 안쪽 그룹·컴포넌트를 펼친다. 펼친 단계는 3D에서 누를 때 고르는 단계도 정한다
 * (펼친 그룹 안을 누르면 그 안의 항목을 고른다 — "가장 안쪽" 방식이면 늘 가장 안쪽). 누르면 강조, 두 번 누르면 확대, 체크로 숨기기.
 * 노드가 아주 많아도 화면이 느려지지 않게 자식은 처음 CHILD_LIMIT개만 그리고 "더 보기"로 늘린다.
 *
 * 226차: 처음 탭(태그·재질 — 문서를 열면 곧바로 보임) 밖 탭 몸통(구성·선택·정보)은 정보 탭 조각(infotab.ts)에 두어 첫 화면 JS에서 뗐다(NC 210차 꼴).
 * 문서를 보인 패널이 그 조각을 미리 받고(show), 받기 전에 그 탭을 그리면 몸통을 비운 채 한 번만 받은 뒤 그 탭이면 다시 그린다(받지 못하면 console.error — 다음에 그릴 때 다시).
 */
import { onceImport } from './core';
import { h, icon } from './dom';
import { focusIfLost, focusSpot, listKeys, listRows, refocus } from './kbd';
import type { MeasureToolResult } from './measure';
import {
  MAX_SECTION_PLANES,
  folderHidden,
  measureAxes,
  measureLine,
  measureText,
  folderTags,
  materialCount,
  materialImage,
  panelTabs,
  selectionParts,
  selectedNode,
  unitLabel,
  type PanelTab,
  type Selection,
  type SkpDoc,
  type TagRow,
} from './doc';
import { fmtCount, fmtPt, rgbCss } from './format';
import { mmPerSceneUnit } from './units';
import { hiddenByNodes, type PickMode } from './tree';
import { fileText as F, mix, nameText } from './filetext';
import { mixNodes, mixText, uiName, uiText } from './i18n';

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
  /** 3D 보기(151차 — 키보드로 누른 아래 띠 버튼이 없어지면 초점을 둘 마지막 곳) */
  readonly view?: HTMLElement | null;
}

/** 목록이 아주 길 때 한 번에 그리는 줄 수(태그·재질 탭과 구성 탭 한 단계 목록 — infotab.ts) */
export const LIST_LIMIT = 2000;
/** 나무에서 한 노드의 자식을 처음에 그리는 수(더 보기로 늘린다 — 구성 탭 나무, infotab.ts) */
export const CHILD_LIMIT = 200;

/**
 * 정보 줄. file: 값이 파일 글(이름·설명 등 — 번역층에서 뺀다, 52차).
 * 이름 칸 dt·값 칸 dd를 줄 칸 div에 담고 부르는 곳이 dl로 묶는다(171차 — WCAG 1.3.1: span 둘일 때는 화면 읽기에 이름과 값이 짝 없는 두 글이었다.
 * 바로 가기 안내의 dl 꼴, HTML은 dl 안 dt·dd 묶음 div를 허용)
 */
export const row = (k: string, v: string, file?: boolean): HTMLElement =>
  h('div', { class: 'prop-row' }, h('dt', { class: 'k' }, k), h('dd', { class: 'v', title: v, translate: file ? 'no' : null }, v));
/** 앱이 지금 언어로 옮겨 넣은 속성(mixText — 파일 글을 끼운 글)을 번역층이 다시 옮기지 않게 */
export const keep = <E extends HTMLElement>(el: E, attrs = 'title'): E => (el.setAttribute('data-i18n-keep', attrs), el);
/**
 * 처음 탭 밖 탭 몸통 조각(infotab.ts — 52차 정보 탭, 226차부터 구성·선택 탭 몸통도, 그 안에서 속성 사전 칸 attrview.ts를 받는다). 받기 전 null
 */
let tabs: typeof import('./infotab') | null = null;
/**
 * 탭 몸통 조각 받기(한 번만 — 받는 동안·받은 뒤 같은 약속, 받지 못하면 비워 다음 부름에서 다시: core.ts onceImport).
 * 문서를 보인 패널이 미리 부르고, 시험은 패널을 그리기 전에 기다려 둔다(ci-guard 5)
 */
export const loadPanelTabs: () => Promise<typeof import('./infotab')> = onceImport(() => import('./infotab').then((m) => (tabs = m)));

/** 탭 몸통(infotab.ts)이 쓰는 패널 몫(226차 — 옮기기 전 패널 메서드가 쓰던 this의 것) */
export interface TabPanel {
  readonly host: PanelHost;
  /** 탭 몸통을 붙이는 칸(role=tabpanel) */
  readonly body: HTMLElement;
  /** 지금 탭을 다시 그린다(스크롤 자리는 지킨다) */
  rerender(): void;
  /** 목록 강조와 아래 띠만 맞춘다 */
  refreshSelection(): void;
  /** 보이기 체크·흐림만 맞춘다 */
  refreshVisibility(): void;
}
/** 안내 글 · 줄 끝 꼬리표(칩) · 줄 끝 수 */
export const hint = (text: string): HTMLElement => h('p', { class: 'hint' }, text);
export const chip = (text: string, title?: string): HTMLElement => h('span', { class: 'chip', title }, text);
export const countEl = (text: string): HTMLElement => h('span', { class: 'count' }, text);

export const section = (title: string, ...children: (Node | null)[]): HTMLElement =>
  h('section', { class: 'psec' }, h('h3', {}, title), ...children);

/** 아래 띠 버튼의 반대 동작 열쇠(151차 — 누름으로 그 버튼이 없어지면 초점을 둘 첫 곳, 150차 차례: 숨기기 ↔ 모두 보이기) */
const FOOT_BACK: Record<string, string> = { 'button|hide': 'button|show', 'button|show': 'button|hide' };

export class Panel {
  readonly el: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private doc: SkpDoc | null = null;
  /** 최근 측정 목록을 펼쳐 두었는지(다시 그려도 지킨다) */
  private logOpen = false;
  /** 아래 띠 칸 → 열쇠(그린 바로 뒤 적음 — 151차) */
  private readonly footKeys = new WeakMap<Element, string>();
  /** 탭 몸통 조각을 받는 중인지(받는 중 깃발 — 거듭 그려도 받기·받은 뒤 다시 그리기는 한 번, 226차) */
  private tabsWait = false;
  /** 탭 몸통(infotab.ts)에 넘기는 패널 몫 */
  private readonly tabView: TabPanel;

  constructor(private readonly host: PanelHost) {
    this.tabsEl = h('div', { class: 'ptabs', role: 'tablist', 'aria-label': '패널 탭' });
    // APG Tabs(손으로 고르기): ←→·Home·End는 초점만, Enter·Space가 고른다. 고른 탭만 Tab 차례
    this.tabsEl.addEventListener('keydown', (e) => listKeys(e, [...this.tabsEl.querySelectorAll<HTMLElement>('[role=tab]')], 'ArrowLeft', 'ArrowRight'));
    const close = h('button', { class: 'icon-btn', title: '패널 닫기', 'aria-label': '패널 닫기', html: icon('close') });
    close.addEventListener('click', () => this.host.closePanel());
    this.body = h('div', { class: 'pbody', role: 'tabpanel', id: 'pbody' });
    this.foot = h('div', { class: 'pfoot', hidden: true, 'aria-live': 'polite' });
    this.el = h('aside', { class: 'panel', id: 'side-panel', 'aria-label': '모형 패널', hidden: true }, h('div', { class: 'phead' }, this.tabsEl, close), this.body, this.foot);
    this.tabView = {
      host,
      body: this.body,
      rerender: () => this.rerender(),
      refreshSelection: () => this.refreshSelection(),
      refreshVisibility: () => this.refreshVisibility(),
    };
  }

  show(d: SkpDoc | null): void {
    const same = d === this.doc;
    this.doc = d;
    if (d && !panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = 'tags';
    // 문서를 보이면 처음 탭 밖 탭 몸통 조각을 미리 받는다(그 탭을 고를 때 기다리지 않게 — 226차)
    if (d) this.needTabs();
    this.render(same);
  }

  /** 탭 몸통 조각을 한 번만 받는다(받는 중 깃발). 받은 뒤 지금 탭이 그 조각의 탭이면 다시 그리고, 받지 못하면 console.error(다음에 그릴 때 다시 받는다) */
  private needTabs(): void {
    if (tabs || this.tabsWait) return;
    this.tabsWait = true;
    loadPanelTabs().then(
      () => {
        this.tabsWait = false;
        if (this.doc && this.doc.panelTab !== 'tags') this.render(true);
      },
      (e: unknown) => {
        this.tabsWait = false;
        console.error(e);
      },
    );
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
      const spot = focusSpot(this.body);
      this.body.innerHTML = '';
      this.renderBody(d);
      refocus(this.body, spot);
    }
    const key = selKey(d.selection);
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-sel]')) {
      const on = el.dataset.sel === key;
      el.classList.toggle('sel', on);
      // 나무 줄은 고름(aria-selected), 재질 줄(버튼)·정의 표 줄(줄 안 버튼 — 표 줄의 aria-selected는 grid 안에서만 뜻이 있다)은
      // 누르면 고르고 다시 누르면 푸는 토글이라 눌림으로(186차 — 단면 줄 꼴, 전에는 클래스만 바뀌어 화면 읽기에 고른 줄이 없었다)
      if (el.getAttribute('role') === 'treeitem') el.setAttribute('aria-selected', on ? 'true' : 'false');
      else (el.localName === 'button' ? el : el.querySelector('button'))?.setAttribute('aria-pressed', on ? 'true' : 'false');
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
    // 다시 그려도 키보드 초점은 같은 자리로(탭·줄·체크 — 지우면 body로 사라졌다)
    const spot = focusSpot(this.el);
    this.tabsEl.innerHTML = '';
    this.body.innerHTML = '';
    if (!d) {
      this.renderFoot();
      return;
    }
    this.body.setAttribute('aria-labelledby', `ptab-${d.panelTab}`);
    for (const [k, label] of panelTabs(d)) {
      const on = k === d.panelTab;
      const b = h('button', { class: `ptab${on ? ' on' : ''}`, role: 'tab', id: `ptab-${k}`, 'aria-controls': 'pbody', tabindex: on ? '0' : '-1', 'aria-selected': on ? 'true' : 'false' }, label);
      b.addEventListener('click', () => {
        if (d.panelTab === k) return;
        d.panelTab = k as PanelTab;
        this.render();
      });
      this.tabsEl.append(b);
    }
    this.renderBody(d);
    this.refreshSelection();
    this.refreshVisibility();
    if (keepScroll) this.body.scrollTop = top;
    refocus(this.el, spot);
  }

  /** 지금 탭 몸통: 태그·재질은 여기서, 구성·선택·정보는 탭 몸통 조각이(받기 전이면 몸통을 비운 채 받는다 — 226차) */
  private renderBody(d: SkpDoc): void {
    if (d.panelTab === 'tags') this.renderTags(d);
    else if (!tabs) this.needTabs();
    else if (d.panelTab === 'outline') tabs.renderOutline(this.tabView, d);
    else if (d.panelTab === 'entity') tabs.renderEntity(this.tabView, d);
    else this.body.append(...tabs.infoSections(d, (i) => this.host.applyPage(i)));
  }

  // ───────────────────────── 태그·재질 ─────────────────────────

  private renderTags(d: SkpDoc): void {
    const x = d.extras;
    const toggle = (label: string, count: string, on: boolean, disabled: boolean, set: (v: boolean) => void, title: string): HTMLElement => {
      const cb = h('input', { type: 'checkbox', 'aria-label': label });
      cb.checked = on;
      cb.disabled = disabled;
      cb.addEventListener('change', () => set(cb.checked));
      // opt: 앱 글(모형 이름이 아님)이라 자르지 않고 줄을 바꾼다(44차 — 독일어 "Versteckte Funktionen anzeigen"이 말줄임으로 잘렸다)
      return h('label', { class: `prow opt${disabled ? ' off' : ''}`, title }, cb, h('span', { class: 'name' }, label), countEl(count));
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

    // 파일 단면: 누르면 켜고 끈다(여러 개 — 모형 단면은 모형 전체, 그룹·컴포넌트 안 단면은 그 그룹 안쪽만 자른다)
    if (d.sectionPlanes.length) {
      const list = h('div', { class: 'plist' });
      d.sectionPlanes.slice(0, LIST_LIMIT).forEach((sp, i) => {
        const on = d.fileSections.includes(sp.index);
        const b = h(
          'button',
          { class: `prow pick${on ? ' sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: on ? '누르면 이 단면을 끕니다' : '누르면 이 단면으로 자릅니다(같은 그룹의 다른 단면은 꺼짐)' },
          h('span', { class: 'swatch sec', 'aria-hidden': 'true' }),
          h('span', { class: 'name' }, sp.name || uiText(`단면 ${i + 1}`)),
          sp.active ? chip('활성', '파일에서 활성인 단면') : null,
          sp.node >= 0 ? chip('그룹 안', '그룹·컴포넌트 안의 단면 — 그 그룹 안쪽만 자릅니다') : null,
          // 태그 이름(파일 글)
          sp.tag ? h('span', { class: 'count', translate: 'no' }, sp.tag) : null,
        );
        b.addEventListener('click', () => this.host.setFileSection(sp.index));
        list.append(b);
      });
      const sk = d.sectionSkipped;
      const notes: string[] = [];
      if (sk.scope) notes.push(`그룹 안 단면 ${fmtCount(sk.scope)}개는 모형이 너무 커서 그 그룹만 자를 수 없어 적용하지 않았습니다.`);
      if (sk.limit) notes.push(`단면은 한 번에 ${MAX_FILE_SECTIONS}개까지라 ${fmtCount(sk.limit)}개는 적용하지 않았습니다.`);
      this.body.append(
        section(
          `단면 평면 ${d.sectionPlanes.length}개`,
          list,
          d.fileSections.length
            ? h(
                'div',
                { class: 'pbar' },
                (() => {
                  const off = h('button', { class: 'mini-btn' }, '파일 단면 모두 끄기');
                  off.addEventListener('click', () => this.host.setFileSection(null));
                  return off;
                })(),
              )
            : null,
          ...notes.map(hint),
        ),
      );
    }

    // 태그: 폴더 없는 태그 → 폴더(앞 순회 차례)와 그 안 태그
    const tags = d.tags;
    const allOn = h('button', { class: 'mini-btn' }, '모두 보기');
    const allOff = h('button', { class: 'mini-btn' }, '모두 숨기기');
    allOn.addEventListener('click', () => this.host.setAllTagsVisible(true));
    allOff.addEventListener('click', () => this.host.setAllTagsVisible(false));
    const list = h('div', { class: 'plist' });
    const tagRow = (t: TagRow, depth: number): HTMLElement => {
      const name = F(t.name);
      const cb = h('input', { type: 'checkbox', 'data-tag': t.name, 'aria-label': mixText(mix`태그 ${name} 보이기`), 'data-i18n-keep': 'aria-label' });
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
          title: mixText(t.hasGeometry ? mix`${name}: 면 ${fmtCount(t.faces)} · 모서리 ${fmtCount(t.edges)}` : mix`${name}: 그릴 것이 없는 태그`),
          'data-i18n-keep': 'title',
        },
        cb,
        t.color ? h('span', { class: 'swatch tag', style: `background:${rgbCss(t.color)}`, title: '태그 색' }) : null,
        h('span', { class: 'name', translate: 'no' }, t.name),
        t.default ? chip('기본') : null,
        t.lineStyle ? keep(chip('점선', mixText(mix`선 종류: ${F(t.lineStyle)} — 이 태그의 모서리를 점선으로 그립니다`))) : null,
        !t.visible ? chip('숨김', '파일에서 숨긴 태그') : null,
        countEl(t.hasGeometry ? count : '비어 있음'),
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
      // 180차: 이름 없는 폴더는 보이는 자리 글(앱 글 — 지금 언어)을 체크 이름·줄 풀이에도 둔다(빈 이름이면 「태그 폴더  보이기」라 보이는 글을 품지 않았다 — 2.5.3)
      const name = f.name ? F(f.name) : nameText('(이름 없는 폴더)');
      const cb = h('input', { type: 'checkbox', 'data-folder': String(i), 'aria-label': mixText(mix`태그 폴더 ${name} 보이기`), 'data-i18n-keep': 'aria-label' });
      cb.checked = !d.hiddenFolders.has(i);
      cb.addEventListener('change', () => this.host.setFolderVisible(i, cb.checked));
      list.append(
        h(
          'label',
          {
            class: 'prow folder',
            'data-folderrow': String(i),
            style: depth ? `padding-left:${8 + depth * 14}px` : undefined,
            title: mixText(mix`태그 폴더 ${name} — 숨기면 안의 태그가 모두 숨습니다`),
            'data-i18n-keep': 'title',
          },
          cb,
          h('span', { class: 'fold-ico', html: icon('folder', 14) }),
          h('span', { class: 'name', translate: 'no' }, f.name || uiText('(이름 없는 폴더)')),
          countEl(`태그 ${fmtCount(folderTags(d, i).length)}`),
        ),
      );
      for (const t of tags) if (t.folder === i) list.append(tagRow(t, depth + 1));
    });
    this.body.append(
      section(`태그 ${tags.length}개`, tags.length ? h('div', { class: 'pbar' }, allOn, allOff) : null, tags.length ? list : hint('태그가 없습니다.')),
    );

    const mats = d.materials;
    const mlist = h('div', { class: 'plist' });
    for (const m of mats.slice(0, LIST_LIMIT)) {
      const sel: Selection = { kind: 'material', name: m.name };
      const tex = materialImage(d, m);
      const swatch = tex
        ? h('img', {
            class: 'swatch tex',
            src: tex,
            alt: '',
            loading: 'lazy',
            decoding: 'async',
            title: mixText(mix`무늬 그림: ${F(d.images?.materials.get(m.folder!)?.name ?? '')}`),
            'data-i18n-keep': 'title',
          })
        : h('span', { class: 'swatch', style: `background:${rgbCss(m.color)};opacity:${Math.max(0.3, m.color[3])}` });
      const b = h(
        'button',
        { class: 'prow pick', 'data-sel': selKey(sel), title: mixText(mix`${nameText(m.name)} — 누르면 이 재질의 면을 강조합니다`), 'data-i18n-keep': 'title' },
        swatch,
        h('span', { class: 'name', translate: 'no' }, uiName(m.name)),
        m.textured
          ? m.texture
            ? chip('무늬', '무늬(텍스처) 재질 — 3D에 무늬 그림을 입혔습니다')
            : chip('무늬 · 평균색', '무늬(텍스처) 재질 — 무늬 그림을 쓸 수 없어(없거나 한도를 넘음) 3D에서는 무늬의 평균색으로 보입니다')
          : null,
        m.color[3] < 0.999 ? chip('투명', '반투명 재질') : null,
        m.attrs != null && chip('속성', '속성 사전'),
        countEl(materialCount(m)),
      );
      b.addEventListener('click', () => this.host.select(selKey(d.selection) === selKey(sel) ? null : sel));
      mlist.append(b);
    }
    this.body.append(
      section(
        `재질 ${mats.length}개`,
        mats.length ? mlist : hint('재질이 없습니다.'),
        mats.length > LIST_LIMIT ? hint(`처음 ${LIST_LIMIT}개만 보입니다.`) : null,
      ),
    );
  }

  // ───────────────────────── 아래 띠 ─────────────────────────

  private renderFoot(): void {
    const d = this.doc;
    const f = this.foot;
    // 통째로 다시 그려 떼어질 칸에 초점이 있으면 그 열쇠(지난 그리기 때 적어 둔 것 — 151차)
    const a = document.activeElement;
    const key = a && f.contains(a) ? this.footKeys.get(a) : undefined;
    f.innerHTML = '';
    if (!d) {
      f.hidden = true;
      return;
    }
    const lines: HTMLElement[] = [];
    const u = unitLabel(d.scene.units);
    const text = selectionParts(d, d.selection, d.pick);
    if (text.length) {
      // 이름·태그 같은 파일 글은 그대로, 앱 글만 지금 언어로(언어를 바꾸면 다시 그린다)
      lines.push(h('div', {}, h('b', {}, '고른 것 '), h('span', { 'data-i18n-skip': '' }, ...mixNodes(text))));
      if (d.pick) lines.push(h('div', { class: 'dim' }, `점 ${fmtPt(d.pick.point, 1)}${u ? ` ${u}` : ''}`));
      const n = selectedNode(d, d.selection);
      if (d.tree && n !== null && n >= 0 && d.tree.childCount[n]! > 0 && !d.expanded.has(n) && d.pickMode === 'open')
        lines.push(h('div', { class: 'dim' }, '안쪽 항목을 고르려면 3D에서 두 번 누르거나 목록에서 › 버튼으로 펼치세요.'));
    }
    // 고른 그룹·컴포넌트: 숨기기·분리해서 보기, 숨긴 것이 있으면 모두 보이기
    const canHide = d.selection?.kind === 'outline' || d.selection?.kind === 'node';
    const anyHidden = d.hiddenNodes.size > 0 || d.hiddenOutline.size > 0;
    if (canHide || anyHidden) {
      const act = (label: string, ico: string, title: string, run: () => void, on = false): HTMLButtonElement => {
        // data-key: 분리 버튼은 누르면 이름이 바뀐다(다시 그려도 같은 버튼으로 — 151차)
        const b = h('button', { class: `mini-btn${on ? ' on' : ''}`, 'data-key': ico, title, 'aria-pressed': on ? 'true' : undefined, html: `${icon(ico, 14)}<span>${label}</span>` });
        b.addEventListener('click', run);
        return b;
      };
      lines.push(
        h(
          'div',
          { class: 'pbar foot-acts' },
          canHide ? act('숨기기', 'hide', '고른 것을 보기에서 숨깁니다(파일은 그대로)', () => this.host.hideSelection()) : null,
          canHide || this.host.isolated
            ? act(
                this.host.isolated ? '분리 풀기' : '분리해서 보기',
                'isolate',
                // 풀이 원문은 누르기 전(할 일)과 눌린 뒤(지금 상태)로 나눈다(211차 — 한 원문이면 원문이 열쇠인 번역층이 지금 상태 꼴로만 옮겨
                // 누르기 전 풀이가 영어·일본어·독일어에서 「이미 고른 것만 보고 있음」으로 읽혔다, WCAG 2.4.6·3.3.2 — 210차 잠글 방향 줄 꼴)
                this.host.isolated ? '고른 것만 보입니다 — 다시 누르면 모두 보입니다' : '고른 것만 보기 — 다시 누르면 모두 보입니다',
                () => this.host.isolateSelection(),
                this.host.isolated,
              )
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
    // 최근 측정(새것부터): 줄마다 복사, 모두 복사·기록 지우기. 줄은 목록으로 묶는다(156차 — 줄 수·차례를 읽고 같은 이름의 줄 복사 버튼이 그 줄 글과 한 칸)
    const log = this.host.measureLogList;
    if (log.length) {
      const mm = mmPerSceneUnit(d.scene.units);
      const rows = log.map((m, i) => {
        // data-key: 줄 버튼은 이름이 모두 같아 다시 그리면 첫 줄로 갔다 — 열쇠에 줄 차례(202차, 192차 측정 띠 기록과 같은 차례 줄로)
        const b = h('button', { class: 'mini-btn ml-copy-btn', 'data-key': `ml-copy-${i}`, title: '이 결과 글 복사', 'aria-label': '이 결과 글 복사', html: icon('copy', 13) });
        b.addEventListener('click', () => this.host.copyMeasure(i));
        // "거리·각도"도 번역층이 옮긴다(값과 축 이름은 사전 틀이 그대로 끼운다 — 31차 전에는 다른 언어에서도 한국어로 남았다)
        return h('div', { class: 'ml-line' }, h('span', {}, measureLine(m, d.units, mm)), b);
      });
      const all = h('button', { class: 'mini-btn' }, '모두 복사');
      all.addEventListener('click', () => this.host.copyMeasure('all'));
      const clear = h('button', { class: 'mini-btn' }, '기록 지우기');
      clear.addEventListener('click', () => this.host.clearMeasureLog());
      lines.push(h('details', { class: 'measure-history', open: this.logOpen ? true : undefined }, h('summary', {}, `최근 측정 ${fmtCount(log.length)}개`), listRows(rows), h('div', { class: 'pbar' }, all, clear)));
      const det = lines[lines.length - 1] as HTMLDetailsElement;
      det.addEventListener('toggle', () => (this.logOpen = det.open));
    }
    f.hidden = !lines.length;
    f.append(...lines);
    // 칸마다 열쇠(태그|data-key ?? aria-label ?? 글 — 번역층이 옮기기 전 원문, NC 137차 꼴. 띠에는 입력 칸이 없어 label 글 갈래는 없음)를 적고,
    // 초점이 띠 안이었으면 같은 열쇠의 첫 칸 → 반대 동작 → 3D 보기 가운데 처음 쓸 수 있는 곳으로(150차 차례 — 151차).
    // 지우기만 하면 떼어진 버튼의 초점이 문서로 빠져(focus fixup) 다음 Tab이 문서 처음부터였다
    const first = new Map<string, HTMLElement>();
    for (const el of f.querySelectorAll<HTMLElement>('button,summary')) {
      const k = `${el.localName}|${el.dataset.key ?? el.getAttribute('aria-label') ?? el.textContent}`;
      this.footKeys.set(el, k);
      if (!first.has(k)) first.set(k, el);
    }
    if (key) for (const el of [first.get(key), first.get(FOOT_BACK[key] ?? ''), this.host.view]) focusIfLost(el);
  }
}

/** 한 번에 쓰는 파일 단면 수(코어 MAX_SECTION_PLANES — doc.ts의 같은 값) */
const MAX_FILE_SECTIONS = MAX_SECTION_PLANES;

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
