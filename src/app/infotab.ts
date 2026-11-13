/**
 * 패널 정보 탭(52차 — 처음 열 때 받는 조각): 파일·모형 통계·위치와 그림자·장면·경고·조작 칸.
 * 문서를 연 뒤 정보 탭을 고를 때만 쓰는 글이라 첫 화면 JS에서 뗐다(47차 속성 사전 칸 attrview.ts처럼 — 파일 글을 번역층에서 빼느라 늘어난
 * 첫 화면 몫을 이것으로 갚는다). 받은 뒤에는 패널이 곧바로 그린다.
 */
import type { SkpAxesMeta } from '../meta';
import { h, icon } from './dom';
import { boundsSize, docLabel, latLonText, releaseName, shadowTimeText, tzText, unitLabel, unitSummary, type SkpDoc } from './doc';
import { fileText as F, mix } from './filetext';
import { fmtCount, fmtNum, fmtPt, formatBytes, formatMs } from './format';
import { mixNodes, mixText, uiText } from './i18n';
import { chip, hint, keep, row, section } from './panel';
import { sunForShadow } from './sun';
import { unitsLabel } from './units';
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
  out.push(section('모형 통계', ...rows));
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
  if (axPage) place.push(row('그리기 축을 정한 장면', axPage.name, true));
  // 파일과 다른 축을 기억하는 장면이 있거나 장면이 축을 정했으면 장면 규칙을 알린다
  const key = (a: SkpAxesMeta | null | undefined): string => JSON.stringify(a ?? null);
  const sceneAxes = !!axPage || d.pages.some((p) => p.axes !== undefined && key(p.axes) !== key(d.axes));
  if (place.length || sceneAxes)
    out.push(
      section(
        '위치·그림자',
        ...place,
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
      // 도움말은 장면 이름·설명(파일 글). 이름 칸(.scene-cap)은 번역층이 건너뛰므로 앱 글(이름 없는 장면·활성)은 여기서 옮긴다
      const card = h(
        'button',
        { class: `scene-card pick${on ? ' sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: [pg.name, pg.description].filter(Boolean).join('\n'), 'data-i18n-keep': 'title' },
        url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'scene-blank', html: icon('scene', 28) }),
        h('span', { class: 'scene-cap' }, pg.name || uiText(`장면 ${i + 1}`), d.activePage === i ? chip(uiText('활성'), uiText('파일을 저장할 때 고른 장면')) : null),
      );
      card.addEventListener('click', () => applyPage(i));
      grid.append(card);
    });
    out.push(section(`장면 ${d.pages.length}개`, hint('누르면 그 장면으로 바꿉니다(카메라·숨긴 태그·숨긴 개체·단면·스타일·그림자·그리기 축 중 장면이 기억하는 것). PageUp·PageDown으로도 넘깁니다.'), grid));
  } else if (scenes.length) {
    const grid = h('div', { class: 'scene-grid' });
    for (const sc of scenes.slice(0, 100))
      grid.append(h('figure', { class: 'scene-card', title: sc.name, translate: 'no' }, h('img', { src: sc.url, alt: '', loading: 'lazy', decoding: 'async' }), h('figcaption', {}, sc.name)));
    out.push(section(`장면 그림 ${scenes.length}개`, hint('파일 안의 장면 미리보기 그림입니다(장면 목록을 읽지 못한 파일).'), grid));
  }
  const warns = s.warnings ?? [];
  // 54차: 3D 뷰어 코어가 장면을 받으며 빼거나 고쳐 그린 깨진 입력(코어 0.50.0 sceneIssues)을 해석기 경고 뒤로 잇는다
  const issues = d.coreIssues;
  const count = warns.length + issues.length;
  out.push(
    section(
      count ? `경고 ${count}개` : '경고',
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
