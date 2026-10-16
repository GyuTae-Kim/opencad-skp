/**
 * 오른쪽 패널(폭 760px 미만이면 아래 시트): 태그·재질 / 구성(윗단계 그룹·컴포넌트) / 정보.
 * 아래 띠에는 고른 것과 측정 결과를 늘 보인다.
 */
import { h, icon } from './dom';
import {
  KIND_LABEL,
  boundsSize,
  definitionCounts,
  docLabel,
  panelTabs,
  releaseName,
  selectionText,
  unitLabel,
  unitSummary,
  type PanelTab,
  type Selection,
  type SkpDoc,
} from './doc';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs, rgbCss } from './format';

/** 패널이 부르는 앱 기능 */
export interface PanelHost {
  setTagVisible(name: string, on: boolean): void;
  setAllTagsVisible(on: boolean): void;
  setOutlineVisible(index: number, on: boolean): void;
  select(sel: Selection | null): void;
  zoomToSelection(): void;
  closePanel(): void;
  readonly measuring: boolean;
}

/** 목록이 아주 길 때 한 번에 그리는 줄 수 */
const LIST_LIMIT = 2000;

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
    this.doc = d;
    if (d && !panelTabs(d).some(([k]) => k === d.panelTab)) d.panelTab = 'tags';
    this.render();
  }

  /** 고르기·측정이 바뀌었을 때(목록 강조와 아래 띠만) */
  refreshSelection(reveal = false): void {
    const d = this.doc;
    if (!d) return;
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-sel]')) el.classList.toggle('sel', el.dataset.sel === selKey(d.selection));
    if (reveal) this.body.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    this.renderFoot();
  }

  /** 보이기 상태(태그·항목)가 바뀌었을 때 */
  refreshVisibility(): void {
    const d = this.doc;
    if (!d) return;
    for (const cb of this.body.querySelectorAll<HTMLInputElement>('input[data-tag]')) cb.checked = !d.hiddenTags.has(cb.dataset.tag!);
    for (const cb of this.body.querySelectorAll<HTMLInputElement>('input[data-outline]')) cb.checked = !d.hiddenOutline.has(Number(cb.dataset.outline));
  }

  private render(): void {
    const d = this.doc;
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
  }

  // ───────────────────────── 태그·재질 ─────────────────────────

  private renderTags(d: SkpDoc): void {
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
      const b = h(
        'button',
        { class: 'prow pick', type: 'button', 'data-sel': selKey(sel), title: `${m.name} — 누르면 이 재질의 면을 강조합니다` },
        h('span', { class: 'swatch', style: `background:${rgbCss(m.color)};opacity:${Math.max(0.3, m.color[3])}` }),
        h('span', { class: 'name' }, m.name),
        m.textured ? h('span', { class: 'chip', title: '무늬(텍스처) 재질 — 무늬의 평균색으로 보입니다' }, '무늬') : null,
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
    for (const r of d.outline.slice(0, LIST_LIMIT)) {
      const sel: Selection = { kind: 'outline', index: r.index };
      const cb = h('input', { type: 'checkbox', 'data-outline': String(r.index), 'aria-label': `${r.name} 보이기` });
      cb.checked = !d.hiddenOutline.has(r.index);
      cb.addEventListener('change', () => this.host.setOutlineVisible(r.index, cb.checked));
      cb.addEventListener('click', (e) => e.stopPropagation());
      const sub = [r.definition && r.definition !== r.name ? r.definition : null, r.kind !== 'loose' ? r.tag : null].filter(Boolean).join(' · ');
      const item = h(
        'div',
        { class: 'prow pick', role: 'button', tabindex: '0', 'data-sel': selKey(sel), title: '누르면 강조, 두 번 누르면 확대' },
        cb,
        h('span', { class: `kind k-${r.kind}` }, KIND_LABEL[r.kind]),
        h('span', { class: 'name' }, r.name, sub ? h('small', {}, ` ${sub}`) : null),
        h('span', { class: 'count' }, `면 ${fmtCount(r.faces)}`),
      );
      const choose = (): void => this.host.select(selKey(d.selection) === selKey(sel) ? null : sel);
      item.addEventListener('click', choose);
      item.addEventListener('dblclick', () => {
        this.host.select(sel);
        this.host.zoomToSelection();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      });
      list.append(item);
    }
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
    const defs = definitionCounts(d.outline).filter((x) => x.kind === 'component');
    if (defs.length) {
      const tbody = h('tbody');
      for (const x of defs.slice(0, 500)) tbody.append(h('tr', {}, h('td', {}, x.name), h('td', { class: 'num' }, fmtCount(x.count))));
      this.body.append(section('컴포넌트 정의별 개수', h('table', { class: 'ptable' }, h('thead', {}, h('tr', {}, h('th', {}, '정의'), h('th', { class: 'num' }, '개수'))), tbody)));
    }
  }

  // ───────────────────────── 정보 ─────────────────────────

  private renderInfo(d: SkpDoc): void {
    const s = d.scene;
    const info = d.info;
    const u = unitLabel(s.units);
    this.body.append(
      section(
        '파일',
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
          h('li', {}, 'F: 전체 보기 · 1~7: 앞·뒤·왼쪽·오른쪽·위·아래·등각 · F7: 격자'),
          h('li', {}, '누르기: 고르기 · Esc: 고르기·측정 지우기'),
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
    }
    if (d.measure) {
      const m = d.measure;
      lines.push(h('div', {}, h('b', {}, '거리 '), `${fmtNum(m.distance, 2)} ${u}`, h('span', { class: 'dim' }, ` · dx ${fmtNum(m.dx, 2)} · dy ${fmtNum(m.dy, 2)} · dz ${fmtNum(m.dz, 2)}`)));
    } else if (this.host.measuring) lines.push(h('div', { class: 'dim' }, '측정: 두 점을 누르세요(꼭짓점·끝점 가까우면 그 점에 붙습니다). Esc = 지우기'));
    f.hidden = !lines.length;
    f.append(...lines);
  }
}

/** 고른 것 비교 열쇠 */
export function selKey(sel: Selection | null): string {
  if (!sel) return '';
  return sel.kind === 'outline' ? `o:${sel.index}` : sel.kind === 'material' ? `m:${sel.name}` : `i:${sel.id}`;
}
