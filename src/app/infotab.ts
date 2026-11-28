/**
 * 패널의 처음 탭(태그·재질) 밖 탭 몸통 조각: 정보 탭(52차 — 파일·모형 통계·위치와 그림자·장면·경고·조작 칸)과 구성·선택 탭(226차).
 * 문서를 연 뒤 그 탭을 고를 때만 쓰는 글이라 첫 화면 JS에서 뗐다(47차 속성 사전 칸 attrview.ts처럼 — 52차는 파일 글을 번역층에서 빼느라 늘어난
 * 첫 화면 몫을 이것으로 갚았다). 226차: 구성 탭(나무·한 단계 목록·찾기·정의 표)과 선택 탭(엔티티 정보) 몸통도 panel.ts에서 옮겼다(NC 210차 꼴 —
 * 문서를 열면 처음 보이는 태그·재질 탭과 탭 줄·아래 띠는 패널에 남김). 문서를 보인 패널이 미리 받고, 받은 뒤에는 패널이 곧바로 그린다(panel.ts loadPanelTabs).
 */
import type { SkpAxesMeta } from '../meta';
import { h, icon } from './dom';
import { rove, treeKeys } from './kbd';
import {
  KIND_LABEL,
  componentImage,
  definitionCounts,
  docLabel,
  nodeSelection,
  partOfPick,
  releaseName,
  selectionDefinition,
  selectionEntity,
  unitLabel,
  unitSummary,
  type OutlineRow,
  type Selection,
  type SkpDoc,
} from './doc';
import { entityInfo } from './entity';
import { latLonText, shadowTimeText, tzText } from './placetext';
import { fileText as F, mix, nameText } from './filetext';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs } from './format';
import { mixNodes, mixText, uiName, uiText } from './i18n';
import { CHILD_LIMIT, LIST_LIMIT, chip, countEl, hint, keep, loadFail, row, section, selKey, type TabPanel } from './panel';
import { normalizeQuery, parentPath, searchOutline, searchTree } from './search';
import { sunForShadow } from './sun';
import { NODE_HIDDEN, NODE_MORE, childrenOf, isSplit, nodeDefinition, nodeName, nodePath, nodeTag, treeDefinitionCounts, type PickMode, type TreeView } from './tree';
import { mmPerSceneUnit, unitsLabel } from './units';
import { coreIssueText, warningParts } from './warntext';

/** 기본 그리기 축(세계 축) — 장면이 기본 축으로 되돌렸을 때 적는다 */
const WORLD_AXES: SkpAxesMeta = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** 정보 탭의 칸들. applyPage: 장면 카드를 누르면 그 장면으로 */
export function infoSections(d: SkpDoc, applyPage: (index: number) => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  const s = d.scene;
  const info = d.info;
  const u = unitLabel(s.units);
  const thumb = d.images?.model;
  out.push(
    section(
      '파일',
      thumb ? keep(h('img', { class: 'model-thumb', src: thumb.url, alt: mixText(mix`${F(d.name)} 모형 미리보기(파일 안 그림)`), decoding: 'async' }), 'alt') : null,
      // 이름·값 줄은 절마다 dl 하나로(171차 — panel.ts row)
      h(
        'dl',
        {},
        row('이름', d.name, true),
        row('형식', docLabel(info)),
        row('SketchUp 판', info.version ? `${info.version} (${releaseName(info.version)})` : '모름'),
        d.modelName ? row('모형 이름', d.modelName, true) : null,
        d.modelDescription ? row('설명', d.modelDescription, true) : null,
        d.classifications.length ? row('분류 체계', d.classifications.join(' · '), true) : null,
        row('단위', unitSummary(info, s.units)),
        row('단위 형식', unitsLabel(d.units)),
        row('크기', formatBytes(d.size)),
        row('읽은 시간', formatMs(d.ms)),
      ),
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
  // 범위 크기·최소·최대(73차에 첫 화면 조각 doc.ts의 boundsSize를 여기로 옮김 — 정보 탭만 쓴다)
  const b = s.bounds;
  if (b) {
    rows.push(row('범위 크기', `${fmtNum(b.max[0] - b.min[0], 1)} × ${fmtNum(b.max[1] - b.min[1], 1)} × ${fmtNum(b.max[2] - b.min[2], 1)} ${u}`));
    rows.push(row('최소', fmtPt(b.min, 1)), row('최대', fmtPt(b.max, 1)));
  }
  out.push(section('모형 통계', rows.length ? h('dl', {}, ...rows) : null));
  // 위치(Model Info > 위치)·그림자 설정·옮긴 그리기 축
  const loc = d.location;
  const sh = d.shadow;
  const place: HTMLElement[] = [];
  if (loc) {
    const name = [loc.city, loc.country].filter((x) => x && x !== 'N/A').join(', ');
    if (name) place.push(row('장소', name, true));
    if (loc.latitude !== undefined && loc.longitude !== undefined) place.push(row('위도·경도', latLonText(loc.latitude, loc.longitude)));
    place.push(row('지리 참조', loc.georeferenced ? '있음(지도 위치에 맞춤)' : '없음'));
    if (loc.northAngle !== undefined && loc.northAngle !== 0) place.push(row('북쪽 각', `${fmtNum(loc.northAngle, 2)}°`));
    if (loc.tz !== undefined) place.push(row('시간대', tzText(loc.tz)));
  }
  if (sh?.time !== undefined) {
    const t = shadowTimeText(sh.time);
    if (t) place.push(row('그림자 날짜·시각', t));
  }
  if (sh && (sh.light !== undefined || sh.dark !== undefined)) place.push(row('밝음·어둠', `${sh.light ?? '?'} · ${sh.dark ?? '?'}`));
  if (sh?.display !== undefined) place.push(row('그림자 보이기', sh.display ? '켬' : '끔'));
  const sun = sunForShadow(sh);
  if (sun) place.push(row('해 고도·방위', `${fmtNum(sun.elevation, 1)}° · ${fmtNum(sun.azimuth, 1)}°`));
  // 지금 그리기 축(73차 — 그리기 축을 기억하는 장면을 고르면 그 장면의 축. 장면이 기본 축으로 되돌렸으면 기본 축도 적는다)
  const axPage = d.axesPage !== null ? d.pages[d.axesPage] : undefined;
  const ax = d.drawAxes ?? (axPage ? WORLD_AXES : null);
  if (ax) {
    place.push(row('그리기 축 원점', `${fmtPt(ax.origin, 1)}${u ? ` ${u}` : ''}`));
    place.push(row('빨강·초록·파랑 축', [ax.x, ax.y, ax.z].map((a) => fmtPt(a, 3)).join(' · ')));
  }
  // 이름 없는 장면의 "장면 n"은 앱 글(149차 — 번역층이 옮긴다)
  if (axPage) place.push(row('그리기 축을 정한 장면', axPage.name, !axPage.unnamed));
  // 파일과 다른 축을 기억하는 장면이 있거나 장면이 축을 정했으면 장면 규칙을 알린다
  const key = (a: SkpAxesMeta | null | undefined): string => JSON.stringify(a ?? null);
  const sceneAxes = !!axPage || d.pages.some((p) => p.axes !== undefined && key(p.axes) !== key(d.axes));
  if (place.length || sceneAxes)
    out.push(
      section(
        '위치·그림자',
        place.length ? h('dl', {}, ...place) : null,
        sun ? hint('보기 설정의 "그림자"로 이 날짜·시각·위치의 해 그림자를 켜고 끕니다.') : null,
        d.drawAxes ? hint('줄자·각도기의 축 고정·기본 평면과 줄자 결과의 dx·dy·dz는 옮긴 그리기 축을 따릅니다.') : null,
        sceneAxes ? hint('그리기 축을 기억하는 장면을 고르면 그 장면의 축으로 바뀌고, 기억하지 않는 장면은 지금 축을 그대로 둡니다(파일을 다시 열면 파일의 축).') : null,
      ),
    );
  const scenes = d.images?.scenes ?? [];
  if (d.pages.length) {
    // 장면(페이지): 누르면 그 장면의 카메라·숨긴 태그·숨긴 개체·단면·스타일을 적용한다
    const thumbs = new Map(scenes.map((sc) => [sc.path, sc.url] as const));
    const grid = h('div', { class: 'scene-grid' });
    d.pages.slice(0, 200).forEach((pg, i) => {
      const url = (pg.thumbnail && thumbs.get(pg.thumbnail)) || scenes.find((sc) => sc.name === pg.name)?.url || null;
      const on = d.page === i;
      // 도움말은 장면 이름·설명(파일 글). 이름 칸(.scene-cap)은 번역층이 건너뛰므로 앱 글(이름 없는 장면의 "장면 n" — 149차부터 readPage 표시로 가름·활성)은 여기서 옮긴다
      const name = pg.unnamed ? uiText(pg.name) : pg.name;
      const card = h(
        'button',
        { class: `scene-card pick${on ? ' sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: [name, pg.description].filter(Boolean).join('\n'), 'data-i18n-keep': 'title' },
        url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'scene-blank', html: icon('scene', 28) }),
        h('span', { class: 'scene-cap' }, name, d.activePage === i ? chip(uiText('활성'), uiText('파일을 저장할 때 고른 장면')) : null),
      );
      card.addEventListener('click', () => applyPage(i));
      grid.append(card);
    });
    out.push(section(`장면 ${fmtCount(d.pages.length)}개`, hint('누르면 그 장면으로 바꿉니다(카메라·숨긴 태그·숨긴 개체·단면·스타일·그림자·그리기 축 중 장면이 기억하는 것). PageUp·PageDown으로도 넘깁니다.'), grid));
  } else if (scenes.length) {
    const grid = h('div', { class: 'scene-grid' });
    for (const sc of scenes.slice(0, 100))
      grid.append(h('figure', { class: 'scene-card', title: sc.name, translate: 'no' }, h('img', { src: sc.url, alt: '', loading: 'lazy', decoding: 'async' }), h('figcaption', {}, sc.name)));
    out.push(section(`장면 그림 ${fmtCount(scenes.length)}개`, hint('파일 안의 장면 미리보기 그림입니다(장면 목록을 읽지 못한 파일).'), grid));
  }
  const warns = s.warnings ?? [];
  // 54차: 3D 뷰어 코어가 장면을 받으며 빼거나 고쳐 그린 깨진 입력(코어 0.50.0 sceneIssues)을 해석기 경고 뒤로 잇는다
  const issues = d.coreIssues;
  const count = warns.length + issues.length;
  out.push(
    section(
      count ? `경고 ${fmtCount(count)}개` : '경고',
      // 53차: 경고 끝의 꾸러미 항목 이름(재질·스타일 폴더)은 파일 글로 — 앱 글만 옮겨 넣고 번역층은 건너뛴다(언어를 바꾸면 패널이 다시 그린다)
      count
        ? h(
            'ul',
            { class: 'warns' },
            ...warns.slice(0, 300).map((w) => h('li', { 'data-i18n-skip': '' }, ...mixNodes(warningParts(w)))),
            ...issues.slice(0, 100).map((i) => h('li', { 'data-i18n-skip': '' }, ...mixNodes([coreIssueText(i)]))),
          )
        : hint('해석기가 남긴 경고가 없습니다.'),
    ),
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
  return out;
}

// ───────────────────────── 구성(226차에 panel.ts에서 옮김) ─────────────────────────

/** 나무 전체에서 그리는 줄 수 한도 */
const TREE_ROW_LIMIT = 4000;

/** 나무 상자(APG Tree View — ↑↓·Home·End·→·←, 줄 하나만 Tab 차례·그 줄의 보이기 체크까지). 줄을 누르거나 초점이 오면 그 줄이 Tab 차례 */
const treeBox = (cls: string, label: string): HTMLElement => {
  const box = h('div', { class: cls, role: 'tree', 'aria-label': label });
  box.addEventListener('keydown', (e) => treeKeys(e, box));
  box.addEventListener('focusin', (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('[role=treeitem]');
    if (it) rove([...box.querySelectorAll<HTMLElement>('[role=treeitem]')], it, true);
  });
  // 줄 안 보이기 체크 둘레의 줄 바탕 누름은 체크로(237차 — 캡처라 줄의 고르기·찾은 줄 조상 펼치기보다 먼저). 초점도 체크로(체크를 바로 누른 꼴 — 같은 줄이라 Tab 차례 그대로)
  box.addEventListener(
    'click',
    (e) => {
      const cb = boxHit(e.target as HTMLElement, e);
      if (!cb) return;
      e.stopPropagation();
      cb.focus({ preventScroll: true });
      cb.click();
    },
    true,
  );
  return box;
};

/**
 * 줄 안 보이기 체크(마우스 화면 15×15)의 누르는 자리 24×24(WCAG 2.5.8, 237차 — 235차 펼치기와 같은 꼴: 보이는 꼴·마디 그대로 두고 줄 안쪽 틈만).
 * 체크는 입력 칸이라 투명 ::after 자리를 붙일 수 없고, 라벨로 감싸면 줄 안 체크 Tab 차례(rove의 `:scope > input`)·손가락 24px 규칙 선택자가 바뀌어 배치 상자로 센다.
 * 자리는 체크를 가운데 둔 24×24 — 앞이 펼치기 단추면 사이 틈의 가운데부터(앞 반은 펼치기의 투명 자리 — 235차) 뒤로 밀고, 뒤 칸(종류 칩)·줄 밖은 넘지 않는다.
 * 누른 곳이 줄 바탕일 때만(체크·펼치기·줄 안 다른 칸을 누른 것은 그대로), 체크가 꺼졌거나 이미 24 이상(손가락 화면 — 43차)이거나 배치가 없으면 null
 */
function boxHit(row: HTMLElement, e: MouseEvent): HTMLInputElement | null {
  if (!row.matches?.('.prow.pick[role=treeitem]')) return null;
  const cb = row.querySelector<HTMLInputElement>(':scope > input[type=checkbox]');
  if (!cb || cb.disabled) return null;
  const r = cb.getBoundingClientRect();
  if (!r.width || !r.height || (r.width >= 24 && r.height >= 24)) return null;
  const R = row.getBoundingClientRect();
  const prev = cb.previousElementSibling;
  const lo = prev?.localName === 'button' ? (prev.getBoundingClientRect().right + r.left) / 2 : R.left;
  const hi = cb.nextElementSibling?.getBoundingClientRect().left ?? R.right;
  const x0 = Math.max(lo, r.left - Math.max(0, 24 - r.width) / 2);
  const y0 = Math.max(R.top, r.top - Math.max(0, 24 - r.height) / 2);
  const x1 = Math.min(hi, x0 + Math.max(24, r.width));
  const y1 = Math.min(R.bottom, y0 + Math.max(24, r.height));
  return e.clientX >= x0 && e.clientX < x1 && e.clientY >= y0 && e.clientY < y1 ? cb : null;
}

/** 다 그린 나무: 고른 줄(없으면 첫 줄)만 Tab 차례 */
const roveTree = (box: HTMLElement): void => {
  const items = [...box.querySelectorAll<HTMLElement>('[role=treeitem]')];
  rove(items, items.find((el) => el.classList.contains('sel')) ?? items[0], true);
};

/** 찾은 수 글 */
function foundText(total: number, shown: number): string {
  if (!total) return '찾은 항목이 없습니다.';
  return total > shown ? `찾은 항목 ${fmtCount(total)}개 중 처음 ${fmtCount(shown)}개` : `찾은 항목 ${fmtCount(total)}개`;
}

/** 구성 탭 몸통(나무가 있으면 나무, 없으면 모형 바로 아래 한 단계 목록)과 컴포넌트 정의별 개수 표 */
export function renderOutline(p: TabPanel, d: SkpDoc): void {
  if (d.tree) {
    renderTree(p, d, d.tree);
    return;
  }
  if (d.outlineSkipped) {
    p.body.append(
      section(
        '그룹·컴포넌트',
        hint(`모형 바로 아래 그룹·컴포넌트가 ${fmtCount(d.outlineSkipped)}개로 많아, 화면이 느려지지 않게 하나씩 고르기를 껐습니다. 태그와 재질로 나눠 보세요.`),
      ),
    );
    return;
  }
  // 나무가 없는 파일도 한 단계 나무로(줄 안 보이기 체크가 단추 안에 들지 않게 — 44차)
  const list = treeBox('plist', '그룹·컴포넌트');
  const found = h('p', { class: 'hint search-note', hidden: true, 'aria-live': 'polite' });
  const cut = h('p', { class: 'hint', hidden: true }, `처음 ${fmtCount(LIST_LIMIT)}개만 보입니다.`);
  const fill = (): void => {
    list.innerHTML = '';
    const q = normalizeQuery(d.outlineQuery);
    const res = q ? searchOutline(d.outline, d.outlineQuery) : null;
    const rows = res ? res.rows : d.outline.slice(0, LIST_LIMIT);
    for (const r of rows) list.append(outlineRow(p, d, r));
    found.hidden = !res;
    if (res) found.textContent = foundText(res.total, res.rows.length);
    cut.hidden = !!res || d.outline.length <= LIST_LIMIT;
    p.refreshSelection();
    p.refreshVisibility();
    roveTree(list);
  };
  fill();
  const groups = d.outline.filter((r) => r.kind === 'group').length;
  const comps = d.outline.filter((r) => r.kind === 'component').length;
  p.body.append(
    section(
      `모형 바로 아래 ${fmtCount(d.outline.length)}개`,
      pickBar(p, d),
      searchBox(d, fill),
      hint(`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}. 누르면 강조하고, 두 번 누르면 그쪽으로 확대합니다.`),
      found,
      list,
      cut,
    ),
  );
  renderDefinitions(p, d, definitionCounts(d.outline).filter((x) => x.kind === 'component'), '컴포넌트 정의별 개수');
}

/** 윗단계 목록 한 줄(나무가 없을 때, 나무에서는 바로 놓인 형상 줄) */
function outlineRow(p: TabPanel, d: SkpDoc, r: OutlineRow): HTMLElement {
  const sel: Selection = { kind: 'outline', index: r.index };
  const cb = keep(h('input', { type: 'checkbox', 'data-outline': String(r.index), 'aria-label': mixText(mix`${nameText(r.name)} 보이기`) }), 'aria-label');
  cb.checked = !d.hiddenOutline.has(r.index);
  cb.addEventListener('change', () => p.host.setOutlineVisible(r.index, cb.checked));
  cb.addEventListener('click', (e) => e.stopPropagation());
  const sub = [r.definition && r.definition !== r.name ? r.definition : null, r.kind !== 'loose' ? r.tag : null].filter(Boolean).join(' · ');
  const item = h(
    'div',
    { class: 'prow pick', role: 'treeitem', 'aria-level': '1', tabindex: '0', 'data-sel': selKey(sel), title: '누르면 강조, 두 번 누르면 확대' },
    d.tree ? h('span', { class: 'twisty-space' }) : null,
    cb,
    h('span', { class: `kind k-${r.kind}` }, KIND_LABEL[r.kind]),
    h('span', { class: 'name', translate: 'no' }, uiName(r.name), sub ? h('small', {}, ` ${sub}`) : null),
    countEl(`면 ${fmtCount(r.faces)}`),
  );
  bindPick(p, item, d, sel);
  return item;
}

/** 누르기(강조)·두 번 누르기(확대)·Enter */
function bindPick(p: TabPanel, item: HTMLElement, d: SkpDoc, sel: Selection, extraKeys?: (e: KeyboardEvent) => boolean): void {
  const choose = (): void => p.host.select(selKey(d.selection) === selKey(sel) ? null : sel);
  item.addEventListener('click', choose);
  item.addEventListener('dblclick', () => {
    p.host.select(sel);
    p.host.zoomToSelection();
  });
  item.addEventListener('keydown', (e) => {
    // 줄 안 보이기 체크의 Space는 체크 몫(44차 — 줄이 가로채 고르기만 되고 체크는 그대로였다)
    if (e.target !== item || extraKeys?.(e)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose();
    }
  });
}

/** 3D 누르기 방식 막대(나무가 있으면 펼친 단계·가장 안쪽·면·모서리, 없으면 그룹·면·모서리). collapse: 모두 접기 단추도 */
function pickBar(p: TabPanel, d: SkpDoc, collapse = false): HTMLElement {
  const modeBtn = (mode: PickMode, label: string, title: string): HTMLButtonElement => {
    const b = h('button', { class: `seg-btn${d.pickMode === mode ? ' on' : ''}`, title, 'aria-pressed': d.pickMode === mode ? 'true' : 'false' }, label);
    b.addEventListener('click', () => p.host.setPickMode(mode));
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
    const btn = h('button', { class: 'mini-btn', title: '펼친 노드를 모두 접습니다(3D 고르기도 윗단계로)' }, '모두 접기');
    btn.addEventListener('click', () => p.host.collapseAll());
    btn.disabled = !d.expanded.size;
    bar.append(h('span', { class: 'spacer' }), btn);
  }
  return bar;
}

function renderTree(p: TabPanel, d: SkpDoc, t: TreeView): void {
  const bar = pickBar(p, d, true);

  const list = treeBox('plist tree', '그룹·컴포넌트 나무');
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
        // 나무 안 줄이라 treeitem(단추라 Enter·Space는 그대로 누르기)
        const more = h(
          'button',
          { class: 'mini-btn more-btn', role: 'treeitem', 'aria-level': String(t.depth[kids[k]!]!), 'data-more': String(parent), style: `margin-left:${indent(t.depth[kids[k]!]!) + 22}px` },
          `… ${fmtCount(kids.length - k)}개 더 보기`,
        );
        more.addEventListener('click', () => {
          // 키보드로 누른 이 버튼이 끝까지 펼쳐(또는 나무 줄 수 한도로) 다시 그려지지 않으면 새로 나온 첫 줄로(193차 — APG Tree View 로빙은 나무 상자 focusin, WCAG 2.4.3:
          // 패널 다시 그리기의 refocus는 버튼 차례 열쇠라 아래 다른 부모의 버튼·아래 띠 버튼·문서로 갔다). 초점이 이 버튼에 없었거나 같은 부모의 버튼이 남으면 그대로
          const had = document.activeElement === more;
          d.childLimit.set(parent, limit + CHILD_LIMIT * 5);
          p.rerender();
          if (had && !p.body.querySelector(`[data-more="${parent}"]`)) p.body.querySelector<HTMLElement>(`[data-node="${kids[limit]}"]`)?.focus({ preventScroll: true });
        });
        list.append(more);
        return;
      }
      const n = kids[k]!;
      list.append(nodeRow(p, d, t, n));
      rows++;
      if (d.expanded.has(n)) addChildren(n);
    }
  };
  // 찾는 글이 있으면 맞는 노드만 한 줄씩(경로와 함께), 없으면 나무
  const fill = (): void => {
    list.innerHTML = '';
    rows = 0;
    cut = false;
    // 찾은 노드도 한 단계 나무 줄(같은 키로 오르내린다)
    if (normalizeQuery(d.outlineQuery)) {
      const res = searchTree(t, d.outlineQuery);
      for (const n of res.nodes) list.append(searchRow(p, d, t, n));
      found.hidden = false;
      found.textContent = foundText(res.total, res.nodes.length);
      cutNote.hidden = true;
    } else {
      found.hidden = true;
      const loose = d.outline.find((r) => r.kind === 'loose');
      if (loose) list.append(outlineRow(p, d, loose));
      addChildren(-1);
      cutNote.hidden = !cut;
    }
    p.refreshSelection();
    p.refreshVisibility();
    roveTree(list);
  };
  fill();

  const groups = countKind(t, 0);
  const images = countKind(t, 2);
  const comps = t.count - groups - images;
  const notes: string[] = [`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}${images ? ` · 그림 ${fmtCount(images)}` : ''}(모든 단계, ${t.listedDepth}단계까지).`];
  notes.push('› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.');
  if (t.unlisted) notes.push(`노드가 많아 ${t.listedDepth + 1}단계부터는 목록에 넣지 않았습니다(그 안을 누르면 ${t.listedDepth}단계 항목을 고릅니다).`);
  if (d.outlineSkipped) notes.push(`모형 바로 아래 항목이 ${fmtCount(d.outlineSkipped)}개로 많아 메시를 나누지 않고, 숨기기·강조는 메시 안 구간으로 합니다.`);
  else if (t.splitDepth < t.listedDepth)
    notes.push(`그리기가 느려지지 않게 ${t.splitDepth}단계까지만 따로 메시를 나누고, 더 깊은 항목은 메시 안 구간으로 숨기고 강조합니다.`);
  if (t.runsDropped) notes.push('항목이 너무 많아 3D에서 깊은 단계를 눌러 고르지는 못합니다.');
  // 문장마다 줄을 바꿔 잇는다(번역층이 줄마다 옮긴다 — 빈칸으로 이으면 첫 문장의 틀이 뒤 문장까지 잡아 한국어로 남았다). 줄바꿈은 빈칸으로 보인다
  p.body.append(section(`그룹·컴포넌트 ${fmtCount(t.count)}개`, bar, searchBox(d, fill), hint(notes.join('\n')), found, list, cutNote));
  renderDefinitions(p, d, treeDefinitionCounts(t), '컴포넌트 정의별 개수(모든 단계)');
}

/** 구성 찾기 칸: 이름·정의·태그로 거른다(글자를 칠 때마다 목록만 다시 그린다, Esc로 지운다) */
function searchBox(d: SkpDoc, refill: () => void): HTMLElement {
  // 이름은 보이는 이름표인 자리 글과 같은 글(172차 — WCAG 2.5.3: 이름이 「그룹·컴포넌트 찾기(이름·정의·태그)」라 자리 글을 품지 않았다), 무엇을 찾는지는 찾기 영역 이름으로
  const find = '이름·정의·태그로 찾기';
  const input = h('input', {
    class: 'search-input',
    type: 'search',
    placeholder: find,
    'aria-label': find,
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
  return h('div', { class: 'search-box', role: 'search', 'aria-label': '그룹·컴포넌트 찾기(이름·정의·태그)' }, input);
}

/** 찾은 노드 한 줄: 종류·이름(정의·태그)·위치 경로·면 수 — 누르면 고르고 조상을 펼친다, 두 번 누르면 확대 */
function searchRow(p: TabPanel, d: SkpDoc, t: TreeView, n: number): HTMLElement {
  const sel = nodeSelection(d, n);
  const name = nodeName(t, n);
  const def = nodeDefinition(t, n);
  const tag = nodeTag(t, n);
  const path = parentPath(t, n, uiName);
  const kind = t.kind[n] === 0 ? 'group' : t.kind[n] === 2 ? 'image' : 'component';
  const sub = [def && def !== name ? def : null, tag].filter(Boolean).join(' · ');
  const cb = keep(h('input', { type: 'checkbox', 'aria-label': mixText(mix`${nameText(name)} 보이기`), title: '보이기·숨기기' }), 'aria-label');
  cb.checked = !d.hiddenNodes.has(n);
  cb.disabled = !(isSplit(t, n) || !t.runsDropped);
  cb.addEventListener('change', () => p.host.setNodeVisible(n, cb.checked));
  cb.addEventListener('click', (e) => e.stopPropagation());
  const item = h(
    'div',
    {
      class: 'prow pick trow search-row',
      role: 'treeitem',
      'aria-level': '1',
      tabindex: '0',
      'data-sel': selKey(sel),
      'data-node': String(n),
      // 이름과 경로(파일 글)
      title: `${uiName(name)}${path ? ` — ${path}` : ''}`,
      'data-i18n-keep': 'title',
    },
    cb,
    h('span', { class: `kind k-${kind}` }, KIND_LABEL[kind]),
    h('span', { class: 'name' }, uiName(name), sub ? h('small', {}, ` ${sub}`) : null, path ? h('small', { class: 'path' }, path) : null),
    countEl(`면 ${fmtCount(t.faces[n]!)}`),
  );
  // 찾은 항목을 고르면 나무에서도 보이게(찾기를 지웠을 때) 조상을 펼친다
  item.addEventListener('click', () => {
    for (const a of nodePath(t, n).slice(0, -1)) d.expanded.add(a);
  });
  bindPick(p, item, d, sel);
  return item;
}

function nodeRow(p: TabPanel, d: SkpDoc, t: TreeView, n: number): HTMLElement {
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
  const label = nameText(name);
  const twisty = hasKids
    ? keep(h('button', { class: `twisty${open ? ' open' : ''}`, tabindex: '-1', 'aria-label': mixText(open ? mix`${label} 접기` : mix`${label} 펼치기`), html: icon('twisty', 14) }), 'aria-label')
    : h('span', { class: 'twisty-space', title: more ? '안쪽이 더 있지만 노드가 많아 목록에 넣지 않았습니다' : '' }, more ? '…' : '');
  if (hasKids)
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      p.host.setExpanded(n, !open);
    });
  const canHide = split || !t.runsDropped;
  const cb = h('input', {
    type: 'checkbox',
    'aria-label': mixText(mix`${label} 보이기`),
    'data-i18n-keep': 'aria-label',
    title: canHide ? '보이기·숨기기' : '항목이 너무 많아 이 단계는 따로 숨길 수 없습니다 — 위 단계를 숨기세요',
  });
  cb.checked = !d.hiddenNodes.has(n);
  cb.disabled = !canHide;
  cb.addEventListener('change', () => p.host.setNodeVisible(n, cb.checked));
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
      // 이름(파일 글)은 그대로, 도움말만 지금 언어로("› 펼치기"를 붙인 글은 사전 틀이 없어 "{0} 펼치기"로 잘못 옮겨졌다)
      title: `${uiName(name)}${sub ? ` (${sub})` : ''} — ${uiText(hasKids ? '누르면 강조, 두 번 누르면 확대, › 펼치기' : '누르면 강조, 두 번 누르면 확대')}`,
      'data-i18n-keep': 'title',
    },
    twisty,
    cb,
    h('span', { class: `kind k-${kind}` }, KIND_LABEL[kind]),
    h('span', { class: 'name' }, uiName(name), sub ? h('small', {}, ` ${sub}`) : null),
    hiddenInModel ? chip('숨김', '모형에서 숨긴 항목 — "숨긴 형상 보기"를 켜면 보입니다') : null,
    countEl(`면 ${fmtCount(t.faces[n]!)}`),
  );
  bindPick(p, item, d, sel, (e) => {
    if (e.key === 'ArrowRight' && hasKids && !open) {
      e.preventDefault();
      p.host.setExpanded(n, true);
      return true;
    }
    if (e.key === 'ArrowLeft' && open) {
      e.preventDefault();
      p.host.setExpanded(n, false);
      return true;
    }
    return false;
  });
  return item;
}

/** 컴포넌트 정의별 개수 표(미리보기 그림이 있으면 옆에) */
function renderDefinitions(p: TabPanel, d: SkpDoc, defs: { name: string; count: number }[], title: string): void {
  if (!defs.length) return;
  const tbody = h('tbody');
  for (const x of defs.slice(0, 500)) {
    const img = componentImage(d, x.name);
    // 누르면 이 정의의 인스턴스를 모두 고른다(SketchUp 컴포넌트 창의 "인스턴스 고르기"), 두 번 누르면 그것들에 맞춰 본다
    const sel: Selection = { kind: 'definition', name: x.name };
    // 키보드·화면 읽기는 줄 안 단추(44차 — 초점 받는 줄은 역할이 "행"뿐이었다). 마우스는 줄 어디를 눌러도(단추 누르기도 줄로 올라간다)
    const name = F(x.name);
    const tr = keep(
      h(
        'tr',
        { class: 'pick', 'data-sel': selKey(sel), title: mixText(mix`누르면 "${name}" 인스턴스 ${fmtCount(x.count)}개를 모두 고릅니다 · 두 번 누르면 맞춰 보기`) },
        h(
          'td',
          {},
          h('button', { class: 'def-cell' }, img ? keep(h('img', { class: 'thumb', src: img, alt: '', loading: 'lazy', decoding: 'async', title: mixText(mix`${name} 미리보기`) })) : null, x.name),
        ),
        h('td', { class: 'num' }, fmtCount(x.count)),
      ),
    );
    bindPick(p, tr, d, sel);
    tbody.append(tr);
  }
  p.body.append(
    section(
      title,
      hint('줄을 누르면 그 정의의 인스턴스를 모두 고르고, 두 번 누르면 그것들에 맞춰 봅니다.'),
      h('table', { class: 'ptable' }, h('thead', {}, h('tr', {}, h('th', {}, '정의'), h('th', { class: 'num' }, '개수'))), tbody),
    ),
  );
}

function indent(depth: number): number {
  return 4 + (depth - 1) * 14;
}

function countKind(t: TreeView, kind: number): number {
  let n = 0;
  for (let i = 0; i < t.count; i++) if (t.kind[i] === kind) n++;
  return n;
}

// ───────────────────────── 선택(엔티티 정보 — 226차에 panel.ts에서 옮김) ─────────────────────────

/** 받아 둔 속성 사전 칸 조각(attrview.ts — 47차) */
let attrView: typeof import('./attrview') | null = null;
/**
 * 228차: 속성 사전 칸 조각을 받지 못했는지(거듭 그려도 다시 받지 않고 칸 자리에 알림 글 — 다시 시도가 풀고 다시 받는다).
 * 229차: 패널 tabsFail과 같은 셈 — 0 받지 못한 적 없음·1 받지 못함(다시 시도)·2 다시 시도 뒤 또 받지 못함(새로 고침)·-1 다시 시도로 받는 중
 */
let attrFail = 0;
/**
 * 228차: 속성 사전 칸 조각 받기(한 번만 — 선택 탭은 한 번 그릴 때 몸통을 두 번 그려(render·refreshSelection) 받는 동안 거듭 부르면 같은 약속, core.ts onceImport 꼴 —
 * 그것을 가져오면 첫 화면 조각의 내보내기가 하나 는다). 받지 못하면 까닭은 콘솔에 한 번·실패 깃발, 약속은 비워 다시 시도가 다시 받는다
 */
let attrLoad: Promise<typeof import('./attrview')> | null = null;
const loadAttrView = (): Promise<typeof import('./attrview')> =>
  (attrLoad ??= import('./attrview').then(
    (m) => (attrView = m),
    (err: unknown) => {
      console.error(err);
      attrFail = attrFail < 0 ? 2 : 1;
      attrLoad = null;
      throw err;
    },
  ));

/** 고른 것의 정보(SketchUp의 엔티티 정보처럼): 이름·정의·태그·재질·크기·넓이·GUID·설명·속성 사전. 고른 것이 없으면 모형 */
export function renderEntity(p: TabPanel, d: SkpDoc): void {
  const e = entityInfo(selectionEntity(d), d.units, mmPerSceneUnit(d.scene.units));
  const rows = e.rows.map((r) => {
    // 앱 자리 이름이 낀 값(경로의 「(이름 없음)」 — 215차)은 그 조각만 지금 언어로 옮겨 넣는다(파일 글 줄이라 번역층은 건너뛴다 — 언어를 바꾸면 다시 그린다)
    const el = row(r.label, r.parts ? mixText(r.parts) : r.value, r.file);
    if (r.title) el.querySelector('.v')?.setAttribute('title', r.title);
    return el;
  });
  // 그룹을 고른 뒤 누른 면·모서리 하나만 다시 고르기(SketchUp에서 그룹에 들어가 면을 누르는 것처럼)
  const part = partOfPick(d);
  let pickPart: HTMLElement | null = null;
  if (part) {
    pickPart = h('button', { class: 'mini-btn', title: '3D에서 누른 면 하나(넓이)나 모서리 하나(길이)만 고릅니다' }, part === 'face' ? '누른 면만 고르기' : '누른 모서리만 고르기');
    pickPart.addEventListener('click', () => p.host.selectPickedPart());
  }
  // 고른 컴포넌트와 같은 정의의 인스턴스 모두(SketchUp "인스턴스 고르기")
  const def = selectionDefinition(d, d.selection);
  let allOfDef: HTMLElement | null = null;
  if (def) {
    allOfDef = keep(
      h('button', { class: 'mini-btn', title: mixText(mix`"${F(def.name)}" 정의의 인스턴스 ${fmtCount(def.count)}개를 모두 고릅니다`) }, `같은 정의 모두 고르기(${fmtCount(def.count)}개)`),
    );
    allOfDef.addEventListener('click', () => p.host.select({ kind: 'definition', name: def.name }));
  }
  p.body.append(
    section(
      e.title,
      pickBar(p, d),
      rows.length ? h('dl', {}, ...rows) : null,
      pickPart || allOfDef ? h('div', { class: 'pbar' }, pickPart, allOfDef) : null,
      !d.selection ? hint('3D나 구성 목록에서 그룹·컴포넌트·재질을 고르면 그 정보를 보입니다. "면·모서리"로 누르면 면 하나의 넓이·모서리 하나의 길이를 봅니다.') : null,
    ),
  );
  // 속성 사전 칸은 처음 그릴 때 받는 조각(attrview.ts — 47차, 아주 긴 글 값 펼치기와 함께 첫 화면 조각에서 뗐다). 받은 뒤에는 곧바로 그린다
  if (e.dicts.length) {
    const slot = h('div');
    p.body.append(slot);
    const put = (m: typeof import('./attrview')): void => slot.replaceWith(m.attrSection(d, e));
    // 228차: 받지 못하면 칸 자리에 알림 글과 다시 시도(전에는 말없이 칸을 빼 사전이 있는 것을 몰랐다 — WCAG 3.3.1). 까닭 글은 콘솔에만
    // 229차: 다시 시도 뒤 또 받지 못했으면 칸 버튼이 새로 고침
    const fail = (): void => slot.replaceWith(...loadFail(p.body, attrFail > 1 ? null : () => ((attrFail = -1), p.rerender()), '속성 사전'));
    if (attrView) put(attrView);
    else if (attrFail > 0) fail();
    else void loadAttrView().then(put, fail);
  }
}
