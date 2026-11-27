import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization, localizeCubeFaces, uiText } from '../src/app/i18n';
import { reopenMenu } from '../src/app/dom';
import { GUIDE_CLEAR_FILE_LABEL, GUIDE_DELETE_KEY_HINT, GUIDE_DELETE_TEXT, GUIDE_KIND_NAMES, GUIDE_REDO_LABEL, GUIDE_UNDO_LABEL, GUIDES_SHOWN_LABEL, LOCK_HINTS, LOCK_MENU_LABEL, LOCK_PICK_LABELS, guideKeyHint, lockHint, measureHint, trackHint } from '../src/app/measure';
import { GUIDE_HIDE_LABEL, GUIDE_HIDE_TEXT, GUIDE_SELECT_ALL_LABEL, GUIDE_SELECT_ALL_TEXT, GUIDE_UNHIDE_LABEL, guideCountText, guideDeleteLabel } from '../src/app/measure';
import { AXIS_LABELS, FACE_PERPENDICULAR_LABEL, GUIDE_LINE_LABEL, SNAP_LABELS, TRACK_ALIGN_LABEL, TRACK_AXIS_LABELS, TRACK_PAIR_LABELS } from '../src/app/snap';
import { SHORTCUTS } from '../src/app/shortcuts';
import { chunkFailText } from '../src/app/core';
import { CONTEXT_LOST_TEXT, CONTEXT_LOST_TITLE, RESTORE_FAIL_TEXT, RESTORE_FAIL_TITLE, RESTORE_TEXT, RESTORE_TITLE } from '../src/app/release';
import { catalogs, currentLanguage, languageUrl, languages, sourceMessage, translate } from '../site/i18n.mjs';
import { DEFAULT_UNITS, unitsLabel } from '../src/app/units';
import { THEME_CHOICES } from '../src/app/theme';
import { KeyPick } from '../src/app/keypick';
import type { KeyboardSnapOptions, Viewer3d } from 'opencad-viewer3d';
import type { KeySnapMessageFn, KeySnapMessageKey } from 'opencad-viewer3d/keysnap';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });
describe('language URLs and UI presentation', () => {
  it.each(['en', 'ja', 'zh-CN', 'de'])('localizes scene playback controls and redraws without translating scene names in %s', async code => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header><div class="scene-tabs" role="tablist" aria-label="장면"><button class="scene-play" title="장면 재생" aria-label="장면 재생"></button><button class="scene-tab" role="tab" title="장면 재생">장면 재생</button></div></div></body></html>', {url:languageUrl(metadataForLanguage('ko').url,code)});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    const play = root.querySelector<HTMLButtonElement>('.scene-play')!;
    expect(play.getAttribute('aria-label')).toBe(translate('장면 재생',code));
    expect(play.getAttribute('aria-label')).not.toMatch(/[가-힣]/);
    const replacement = play.cloneNode() as HTMLButtonElement;
    replacement.title = '장면 재생 멈추기';
    replacement.setAttribute('aria-label', '장면 재생 멈추기');
    play.replaceWith(replacement);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(replacement.getAttribute('aria-label')).toBe(translate('장면 재생 멈추기',code));
    expect(replacement.title).toBe(translate('장면 재생 멈추기',code));
    expect(replacement.title).not.toMatch(/[가-힣]/);
    const scene = root.querySelector<HTMLButtonElement>('.scene-tab')!;
    expect(scene.textContent).toBe('장면 재생');
    expect(scene.title).toBe('장면 재생');
    // Changing language must traverse the toolbar while keeping model-authored names intact.
    (document.querySelector('.language-list [data-language="ko"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(replacement.getAttribute('aria-label')).toBe('장면 재생 멈추기');
    expect(scene.textContent).toBe('장면 재생');
    dispose(); dispose=undefined; dom.window.close();
  });
  it('keeps launch parameters and fragments, with explicit language URLs', () => {
    expect(currentLanguage('https://example.test/opencad-skp/ja/?sample#view')).toBe('ja');
    expect(currentLanguage('https://example.test/opencad-skp/?lang=de')).toBe('de');
    const url = new URL(languageUrl('https://gyutae-kim.github.io/opencad-skp/?sample&open=a.skp#view','en'));
    expect(url.pathname).toBe('/opencad-skp/en/'); expect(url.searchParams.has('sample')).toBe(true);
    expect(url.searchParams.get('open')).toBe('a.skp'); expect(url.hash).toBe('#view');
  });
  it('ships matching catalogs and preserves numbered parameters', () => {
    const keys = Object.keys(catalogs['en']).sort();
    for (const {code} of languages.filter(item => item.code !== 'ko')) {
      expect(Object.keys(catalogs[code]).sort()).toEqual(keys);
      for (const key of keys) expect((catalogs[code][key].match(/\{\d+\}/g) ?? []).sort()).toEqual((key.match(/\{\d+\}/g) ?? []).sort());
    }
    expect(translate('열기 ▾','en')).toBe('Open ▾');
    const template = Object.keys(catalogs.en).find(key => key.includes('{0}') && /[가-힣]/.test(key))!;
    const example = template.replace(/\{\d+\}/g, 'FILE_A.skp');
    expect(translate(example,'en')).toContain('FILE_A.skp');
    expect(translate(example,'en')).not.toBe(example);
  });
  it('translates the unit format row of the Info tab in every format and length unit (43rd round: "십진" stayed Korean)', () => {
    // "{0} · {1} · 소수 {2}자리"는 잡은 값을 그대로 넣어 형식 이름(십진)·단위 이름(인치·피트·야드)·공학 이름이 한국어로 남았다
    const labels: string[] = [];
    for (const lengthUnit of ['mm', 'cm', 'm', 'inch', 'feet', 'yard'] as const) labels.push(unitsLabel({ ...DEFAULT_UNITS, lengthFormat: 'decimal', lengthUnit, lengthPrecision: 2 }));
    for (const lengthFormat of ['architectural', 'engineering', 'fractional'] as const) labels.push(unitsLabel({ ...DEFAULT_UNITS, lengthFormat, lengthUnit: 'inch', lengthPrecision: 3 }));
    expect(labels).toContain('mm · 십진 · 소수 2자리');
    expect(labels).toContain('공학(소수 피트) · 소수 3자리');
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const label of labels) expect(translate(label, code), `${code}: ${label}`).not.toMatch(/[가-힣]/);
    expect(translate('mm · 십진 · 소수 0자리', 'en')).toBe('mm · Decimal · 0 decimal places');
    expect(translate('인치 · 십진 · 소수 2자리', 'en')).toBe('Inch · Decimal · 2 decimal places');
    expect(translate('공학(소수 피트) · 소수 2자리', 'de')).toBe('Ingenieurwesen (Dezimalfuß) · Dezimalstellen 2');
    expect(translate('mm · 소수 2자리', 'ja')).toBe('mm・小数点以下2桁');
  });
  it('translates each line of a multi-line message, even when a trailing {0} would swallow the next line', () => {
    // 경고 둘을 줄바꿈으로 이은 글: "…: {0}"의 {0}이 다음 줄까지 잡아 둘째 줄이 한국어로 남던 것(공용 번역기 맞춤)
    const tip = 'SketchUp 파일을 읽지 못했습니다: model.dat\nZIP 지역 머리가 깨졌습니다: model.dat';
    for (const {code} of languages.filter(item => item.code !== 'ko')) expect(translate(tip, code), code).not.toMatch(/[가-힣]/);
    expect(translate(tip, 'en')).toBe(`${translate('SketchUp 파일을 읽지 못했습니다: model.dat', 'en')}\n${translate('ZIP 지역 머리가 깨졌습니다: model.dat', 'en')}`);
  });
  it('translates every piece of a " · "-joined sentence, even when a short pattern would swallow the rest', () => {
    const hangul = /[가-힣]/;
    // "면 {0}"·"재질 {0}"·"모서리 · {0}"이 문장 끝까지 잡아 나머지가 한국어로 남던 줄(고른 것·재질 목록)
    const lines = ['면 · 넓이 12.5 m² · 재질 Wood · 태그 Walls', '모서리 · 길이 300 mm · 태그 Walls', '곡선 · 길이 30 mm · 반지름 5 mm', '면 12 · 뒷면 4', '재질 Wood · 면 1,234',
      '그룹 Wall · 위치 House · 면 12', 'SketchUp 2015 · 15.0.1  |  단위 mm  |  1.23 MB  |  면 8,268 · 모서리 13,852  |  읽기 54 ms','컴포넌트 Chair (Chair#1) · 태그 Furniture · 재질 Wood · 면 1,234', '그룹 3 · 컴포넌트 5 · 그림 3(모든 단계, 4단계까지).'];
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const line of lines) expect(translate(line, code), `${code}: ${line}`).not.toMatch(hangul);
    expect(translate('면 · 넓이 12.5 m² · 재질 Wood · 태그 Walls', 'en')).toBe('Face · Area 12.5 m² · Material Wood · Tag Walls');
    expect(translate('면 12 · 뒷면 4', 'en')).toBe('Face 12 · Back 4');
    expect(translate('그룹 Wall · 면 12', 'en')).toBe('Group Wall · Face 12');
    expect(translate('그룹 3 · 컴포넌트 5 · 그림 3(모든 단계, 4단계까지).', 'en')).toBe('Group 3 · Component 5 · Picture 3 (all levels, up to level 4).');
    // 잡은 값(파일의 이름)은 그대로: 이름에 " · "가 들거나 이름이 앱 낱말과 같아도 바꾸지 않는다
    expect(translate('재질 나무 · 참나무', 'en')).toBe('Material 나무 · 참나무');
    expect(translate('재질 나무 · 면 88', 'en')).toBe('Material 나무 · Face 88');
    expect(translate('태그 Walls · Level 1', 'en')).toBe('Tag Walls · Level 1');
  });
  it('translates every measuring hint, shortcut and Measurements box message (angles, guide lines)', () => {
    const hangul = /[가-힣]/;
    const texts = new Set<string>();
    for (const mode of ['tape', 'protractor'] as const)
      for (const n of [0, 1, 2]) for (const has of [false, true]) for (const touch of [false, true]) for (const edge of [false, true]) for (const guide of [false, true]) texts.add(measureHint(mode, n, has, touch, edge, guide) ?? '');
    // 안내 두기(누르기로 안내점·안내선): 키 안내(키 이름은 그대로 끼운다)·측정 띠 단추·알림·바로 가기
    for (const guide of [false, true]) for (const key of ['Control', 'Alt'] as const) texts.add(guideKeyHint('tape', 0, guide, key) ?? '');
    for (const t of ['안내 두기', '안내 두기: 누르기로 안내점·안내선 두기(다시 누르면 재기만)', '안내 두기 켬: 누르면 안내점·안내선을 둡니다', '안내 두기 끔: 재기만 합니다', '다시 재기',
      '고른 안내점 지우기', '고른 안내선 지우기', '고른 안내점 지우기 (Delete)', '고른 안내선 지우기 (Delete)',
      // 안내 되돌리기·다시 하기 단추(측정 띠)·보기 설정의 안내 보이기·이 파일의 안내 모두 지우기
      GUIDE_UNDO_LABEL, GUIDE_REDO_LABEL, GUIDES_SHOWN_LABEL, GUIDE_CLEAR_FILE_LABEL]) texts.add(t);
    for (const g of SHORTCUTS) for (const item of g.items) texts.add(item.label);
    for (const t of ['각도', '각도 넣기', '각도를 치세요', '각도를 읽지 못했습니다', '각도(도, 경사 1:6)를 치고 Enter: 중심을 지나 그 각도로 돈 안내선을 둡니다',
      '안내선 3', '안내 5', '안내점 2', '안내선 2개 지우기', '안내점 1개와 안내선 2개 지우기', '안내선에', '안내선에 · 45.0°', '0이 아닌 각도를 치세요',
      '커서를 돌릴 쪽으로 옮긴 뒤 치세요', '먼저 중심점과 기준 방향을 누르세요']) texts.add(t);
    // 추론 잠금·나란함: 잠금 안내(축·나란히·수직·각도기 평면), 툴팁, 측정 띠 단추·알림, 도구 막대 풀이
    const locks = [null, 'x', 'y', 'z', 'parallel', 'perpendicular', 'facePerpendicular'] as const;
    for (const mode of ['tape', 'protractor'] as const)
      for (const n of [0, 1, 2]) for (const lock of locks) for (const plane of [null, 'x', 'y', 'z'] as const) for (const touch of [false, true]) texts.add(lockHint(mode, n, lock, plane, touch) ?? '');
    for (const t of ['모서리와 나란히 · 50 mm', '빨강 축에 · 잠금 · 60 mm', '녹색 축에 · 잠금', '파랑 축에 · 잠금 · 30 mm', '모서리와 나란히 · 잠금 · 78 mm', '면에 수직 · 잠금 · 12 mm',
      '지금 방향 잠그기(다시 누르면 풀기)', '방향 잠금', '방향 잠금 풀기',
      // 22차 한 손 잠금: 측정 띠 위 잠글 방향 고르기 줄(이름과 버튼 — 210차부터 버튼 글은 할 일 「…잠그기」로 잠금 안내 「…잠금」과 원문이 다르다)
      LOCK_MENU_LABEL, ...Object.values(LOCK_PICK_LABELS), ...Object.values(LOCK_HINTS),
      '줄자 (T): 두 점 거리 — 끝점·중간점·모서리·면에 붙고, 축·모서리와 나란한 방향이면 그 선에 고정(Shift·화살표로 잠금) · Esc 지우기',
      '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정·방향 잠금) · Esc 지우기']) texts.add(t);
    // 다른 점에서 끌어온 축: 툴팁(끌어온 점의 축 · 시작점 축 위 줄 맞춘 자리 · 길이)과 상태 줄·측정 띠의 끌어온 점 수(잠금 안내 뒤에 " · "로)
    for (const axis of ['x', 'y', 'z'] as const) {
      texts.add(TRACK_AXIS_LABELS[axis]);
      texts.add(`${TRACK_AXIS_LABELS[axis]} · 62 mm`);
      texts.add(`${AXIS_LABELS[axis]} · ${TRACK_ALIGN_LABEL} · 40 mm`);
      // 끌어온 축이 모서리·안내선과 만나는 점(축 글 · 모서리에 · 길이), 잠갔으면 잠금도
      for (const on of [SNAP_LABELS.onEdge, GUIDE_LINE_LABEL]) {
        texts.add(`${TRACK_AXIS_LABELS[axis]} · ${on}`);
        texts.add(`${TRACK_AXIS_LABELS[axis]} · ${on} · 35 mm`);
        texts.add(`${TRACK_AXIS_LABELS[axis]} · ${on} · 잠금 · 35 mm`);
      }
      // 19차: 시작점 축이 모서리·안내선과 만나는 점, 시작점 축·끌어온 축이 면을 뚫는 점(축 글 · 모서리에/안내선에/면에 · 길이·각도)
      for (const on of [SNAP_LABELS.onEdge, GUIDE_LINE_LABEL, SNAP_LABELS.onFace])
        for (const tail of ['', ' · 55 mm', ' · 30.0°']) texts.add(`${AXIS_LABELS[axis]} · ${on}${tail}`);
      for (const tail of ['', ' · 55 mm', ' · 30.0°']) texts.add(`${TRACK_AXIS_LABELS[axis]} · ${SNAP_LABELS.onFace}${tail}`);
    }
    // 20차: 잠근 선(축·나란함·수직)이 모서리·안내선과 만나는 점, 면을 뚫는 점(잠금 글 · 모서리에/안내선에/면에 · 잠금 · 길이·각도)
    for (const lock of [...Object.values(AXIS_LABELS), SNAP_LABELS.parallel, SNAP_LABELS.perpendicular, FACE_PERPENDICULAR_LABEL])
      for (const on of [SNAP_LABELS.onEdge, GUIDE_LINE_LABEL, SNAP_LABELS.onFace])
        for (const tail of ['', ' · 55 mm', ' · 30.0°']) texts.add(`${lock} · ${on} · 잠금${tail}`);
    // 24차(코어 0.21.0): 잠근 선이 끌어온 점의 축과 만나는 점, 축으로 잠근 선 위 끌어온 점과 줄 맞춘 자리(잠금 글 · 끌어온 점의 축/줄 맞춤 · 잠금 · 길이·각도)
    for (const lock of [...Object.values(AXIS_LABELS), SNAP_LABELS.parallel, SNAP_LABELS.perpendicular, FACE_PERPENDICULAR_LABEL])
      for (const on of [...Object.values(TRACK_AXIS_LABELS), TRACK_ALIGN_LABEL])
        for (const tail of ['', ' · 60 mm', ' · 30.0°']) texts.add(`${lock} · ${on} · 잠금${tail}`);
    // 끌어온 축끼리의 교차점(글만 · 길이 · 각도)
    for (const t of Object.values(TRACK_PAIR_LABELS)) for (const tail of ['', ' · 70 mm', ' · 45.0°', ' · 잠금 · 70 mm']) texts.add(`${t}${tail}`);
    for (const n of [1, 2, 3]) {
      texts.add(trackHint(n)!);
      texts.add(`Ctrl: 안내 두기 · ${trackHint(n)}`);
      texts.add(`${lockHint('tape', 1, null, null, false)} · ${trackHint(n)}`);
      texts.add(`${lockHint('tape', 1, 'x', null, false)} · ${trackHint(n)}`);
    }
    texts.delete('');
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate('빨강 축에 · 잠금 · 60 mm', 'en')).toBe('On red axis · Locked · 60 mm');
    expect(translate(`${AXIS_LABELS.x} · ${TRACK_ALIGN_LABEL} · 40 mm`, 'en')).toBe('On red axis · Aligned with tracked point · 40 mm');
    expect(translate(`${TRACK_AXIS_LABELS.z} · 62 mm`, 'de')).toBe('Auf blauer Achse vom verfolgten Punkt · 62 mm');
    expect(translate(`${TRACK_AXIS_LABELS.y} · ${SNAP_LABELS.onEdge} · 35 mm`, 'en')).toBe('On green axis from tracked point · On edge · 35 mm');
    expect(translate(`${TRACK_PAIR_LABELS.xy} · 70 mm`, 'en')).toBe('Intersection of tracked red and green axes · 70 mm');
    expect(translate(TRACK_PAIR_LABELS.yz, 'ja')).toBe('追跡点の緑軸と青軸の交点');
    expect(translate(`${AXIS_LABELS.x} · ${SNAP_LABELS.onEdge} · 55 mm`, 'en')).toBe('On red axis · On edge · 55 mm');
    expect(translate(`${AXIS_LABELS.z} · ${SNAP_LABELS.onFace}`, 'en')).toBe('On blue axis · On face');
    expect(translate(`${AXIS_LABELS.y} · ${SNAP_LABELS.onEdge} · 잠금 · 100 mm`, 'en')).toBe('On green axis · On edge · Locked · 100 mm');
    expect(translate(`${SNAP_LABELS.parallel} · ${SNAP_LABELS.onFace} · 잠금`, 'de')).toBe(`${translate(SNAP_LABELS.parallel, 'de')} · ${translate(SNAP_LABELS.onFace, 'de')} · ${translate('잠금', 'de')}`);
    expect(translate(`${TRACK_AXIS_LABELS.z} · ${SNAP_LABELS.onFace} · 55 mm`, 'en')).toBe('On blue axis from tracked point · On face · 55 mm');
    expect(translate(`${AXIS_LABELS.y} · ${TRACK_AXIS_LABELS.x} · 잠금 · 60 mm`, 'en')).toBe('On green axis · On red axis from tracked point · Locked · 60 mm');
    expect(translate(`${AXIS_LABELS.y} · ${TRACK_ALIGN_LABEL} · 잠금`, 'ja')).toBe(`${translate(AXIS_LABELS.y, 'ja')} · ${translate(TRACK_ALIGN_LABEL, 'ja')} · ${translate('잠금', 'ja')}`);
    expect(translate(`Ctrl: 안내 두기 · ${trackHint(2)}`, 'en')).toBe('Ctrl: place guides · Tracked points: 2');
    expect(translate(trackHint(3)!, 'ja')).toBe('追跡点 3個');
    expect(translate('안내 5', 'en')).toBe('Guides 5');
    expect(translate('안내점 2', 'en')).toBe('Guide points 2');
    expect(translate('Option: 안내 두기', 'en')).toBe('Option: place guides');
    expect(translate('Ctrl: 안내 두기 끄기', 'de')).toBe('Ctrl: Hilfslinien nicht mehr setzen');
    // "{0} 보이기" 틀이 아니라 제 글로(안내점·안내선이 한국어로 남지 않게)
    expect(translate(GUIDES_SHOWN_LABEL, 'en')).toBe('Show guide points and guide lines');
    expect(translate(GUIDE_CLEAR_FILE_LABEL, 'en')).toBe('Clear all guides for this file');
    expect(translate(GUIDE_REDO_LABEL, 'de')).toBe('Rückgängig gemachte Änderung an Hilfselementen wiederherstellen');
    expect(translate('안내점·안내선을 두거나 지운 것 되돌리기(100단계)', 'ja')).toBe('ガイド点・ガイド線の配置や消去を元に戻す（100段階まで）');
  });
  it('206차: 각도기 Shift(지금 평면에 고정)를 부르는 값 셋 — 바로 가기 안내 줄·각도기 버튼 풍선·측정 안내 — 은 네 언어 모두 같은 「고정」 낱말(독일어 풍선 sperren → fixieren, 3.2.4)', () => {
    const app = readFileSync(resolve(__dirname, '../src/app/app.ts'), 'utf8');
    const shortcuts = readFileSync(resolve(__dirname, '../src/app/shortcuts.ts'), 'utf8');
    const LINE = '각도기: 지금 평면에 고정';
    const TITLE = '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정·방향 잠금) · Esc 지우기';
    const HINT = '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정';
    // 쓰는 자리: 바로 가기 안내 Shift 줄, 각도기 버튼 풍선(화면 읽기 이름), 측정 띠·상태 막대의 각도기 첫 안내
    expect(shortcuts).toContain(`{ keys: ['Shift'], label: '${LINE}' }`);
    expect(app).toContain(`tbtn('각도기', 'protractor', '${TITLE}', `);
    expect(measureHint('protractor', 0, false)).toBe(HINT);
    // 원문 셋 모두 평면은 「고정」 — 언어마다 한 낱말(독일어는 평면 fixieren·방향 sperren으로 가른다: 화살표 줄·상태 글과 같게,
    // 중국어도 207차에 평면 固定·방향 锁定으로 — 아래 207차)
    const word: Record<string, RegExp> = { en: /\block\b/i, de: /\bfixier/, ja: /固定/, 'zh-CN': /固定/ };
    for (const [code, re] of Object.entries(word))
      for (const k of [LINE, TITLE, HINT]) expect(catalogs[code][k], `${code}: ${k}`).toMatch(re);
    // 고친 값: 평면은 fixieren, 방향은 그대로 sperren — 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로
    const value = 'Winkelmesser: Mittelpunkt → Bezugsrichtung → Messrichtung (Shift = Ebene fixieren oder Richtung sperren) · Esc zum Löschen';
    expect(catalogs.de[TITLE]).toBe(value);
    expect(value).not.toMatch(/Ebene oder Richtung sperren/);
    const all = Object.keys(word).flatMap((code) => Object.values(catalogs[code]));
    expect(all.filter((v) => v === value).length).toBe(1);
    expect(sourceMessage(value)).toBe(TITLE);
  });
  it('207차: 중국어는 원문 「고정」(각도기 평면·축 따라가기)을 固定, 「잠금」(방향)을 锁定으로 가른다 — 각도기 Shift 셋·정보 탭 축 고정만 锁定이라 화살표 평면 고정 줄·상태 글·줄자 풍선의 固定과 달랐다(3.2.4)', () => {
    const zh = catalogs['zh-CN'];
    const read = (f: string) => readFileSync(resolve(__dirname, `../src/app/${f}`), 'utf8');
    const TITLE = '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정·방향 잠금) · Esc 지우기';
    const HINT = '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정';
    const AXES = '줄자·각도기의 축 고정·기본 평면과 줄자 결과의 dx·dy·dz는 옮긴 그리기 축을 따릅니다.';
    // 쓰는 자리(원문): 바로 가기 안내 Shift 줄, 각도기 버튼 풍선(화면 읽기 이름), 측정 띠·상태 막대 첫 안내, 정보 탭(그리기 축을 옮긴 모형)
    expect(read('shortcuts.ts')).toContain(`{ keys: ['Shift'], label: '각도기: 지금 평면에 고정' }`);
    expect(read('app.ts')).toContain(`tbtn('각도기', 'protractor', '${TITLE}', `);
    expect(measureHint('protractor', 0, false)).toBe(HINT);
    expect(read('infotab.ts')).toContain(`hint('${AXES}')`);
    // 원문 가름: 고정 = 붙잡아 둠(평면 고정·축 따라가기), 잠금·잠그기·잠글·잠김 = 방향 잠금(「잠시」 같은 다른 낱말은 셈 밖) — 열쇠 26개, 섞인 셋은 두 낱말 모두
    // (210차: 잠글 방향 줄 버튼의 할 일 원문 넷 「…잠그기」 — 锁定 — 이 더해져 30개)
    const fix = /고정/;
    const lock = /잠[금그글김]/;
    const keys = Object.keys(zh).filter((k) => fix.test(k) || lock.test(k));
    expect(keys.length).toBe(30);
    for (const k of keys) {
      expect(/固定/.test(zh[k]), `固定: ${k}`).toBe(fix.test(k));
      expect(/锁定/.test(zh[k]), `锁定: ${k}`).toBe(lock.test(k));
    }
    expect(Object.entries(zh).filter(([k, v]) => !keys.includes(k) && /锁定|固定/.test(v))).toEqual([]);
    // 고친 값 넷: 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로
    const fixed: Record<string, string> = {
      '각도기: 지금 평면에 고정': '量角器：固定到当前平面',
      [TITLE]: '量角器：中心 → 参考方向 → 测量方向（Shift = 固定平面或锁定方向）· Esc清除',
      // 213차: 중심점을 가리키는 누름은 고르기 낱말 选择(213차 「자리 가리키기」) — 固定 그대로
      [HINT]: '量角器：选择中心点 · 按住 Shift 键固定平面',
      [AXES]: '卷尺·量角器的轴固定和默认平面，以及卷尺结果的 dx·dy·dz，都遵循移动后的绘图轴。',
    };
    const all = ['en', 'zh-CN', 'de', 'ja'].flatMap((code) => Object.values(catalogs[code]));
    for (const [k, v] of Object.entries(fixed)) {
      expect(zh[k], k).toBe(v);
      expect(all.filter((x) => x === v).length, v).toBe(1);
      expect(sourceMessage(v)).toBe(k);
    }
  });
  it('translates the select-tool guide selection (status, card)', () => {
    const hangul = /[가-힣]/;
    const texts: string[] = [GUIDE_DELETE_TEXT, '고른 것'];
    for (const k of ['point', 'line'] as const) texts.push(GUIDE_KIND_NAMES[k], `${GUIDE_KIND_NAMES[k]} · ${GUIDE_DELETE_KEY_HINT}`);
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate(`${GUIDE_KIND_NAMES.line} · ${GUIDE_DELETE_KEY_HINT}`, 'en')).toBe('Guide line · Delete or Backspace to delete');
    expect(translate(GUIDE_KIND_NAMES.point, 'de')).toBe('Hilfspunkt');
  });
  it('translates several selected guides, the hide button, the unhide menu item (25th round) and the touch select-all button (29th)', () => {
    const hangul = /[가-힣]/;
    const texts: string[] = [GUIDE_HIDE_TEXT, GUIDE_HIDE_LABEL, GUIDE_UNHIDE_LABEL, GUIDE_SELECT_ALL_TEXT, GUIDE_SELECT_ALL_LABEL];
    expect(translate(GUIDE_SELECT_ALL_LABEL, 'en')).toBe('Select all visible guides');
    for (const [p, l] of [[2, 0], [0, 3], [1, 1], [12, 4]] as const) {
      const t = guideCountText(p, l)!;
      const d = guideDeleteLabel(p, l);
      texts.push(t, `${t} · ${GUIDE_DELETE_KEY_HINT}`, d, `${d} (Delete)`);
    }
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate(`${guideCountText(2, 1)} · ${GUIDE_DELETE_KEY_HINT}`, 'en')).toBe('Guide points: 2, guide lines: 1 · Delete or Backspace to delete');
    expect(translate(guideCountText(3, 0)!, 'ja')).toBe('ガイド点 3 個');
    expect(translate(guideCountText(0, 2)!, 'de')).toBe('Hilfslinien: 2');
    expect(translate(`${guideDeleteLabel(2, 1)} (Delete)`, 'zh-CN')).toBe('删除选中的 3 个参考对象 (Delete)');
  });
  it('translates the graphics context lost and restore notices (large models recolor the textures they kept)', () => {
    const texts = [CONTEXT_LOST_TITLE, CONTEXT_LOST_TEXT, RESTORE_TITLE, RESTORE_TEXT, RESTORE_FAIL_TITLE, RESTORE_FAIL_TEXT];
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(CONTEXT_LOST_TITLE, 'en')).toBe('Restoring 3D graphics');
    // 30차: 놓아 올린 문서는 코어가 놓은 무늬를 다시 푸는 동안에도 이 안내라 색 바꾼 무늬에 한정하지 않는다
    expect(translate(RESTORE_TITLE, 'en')).toBe('Preparing textures again');
    expect(translate(RESTORE_TITLE, 'ja')).toBe('テクスチャを準備し直しています');
    expect(translate(RESTORE_FAIL_TITLE, 'de')).toBe('Einige Texturen konnten nicht neu vorbereitet werden');
  });
  it('translates the split-chunk loading and failure notices (measuring tools, 3D view)', () => {
    const hangul = /[가-힣]/;
    const texts = ['측정 도구를 받는 중…', '측정 도구를 열 수 없습니다', '3D 보기를 열 수 없습니다'];
    for (const what of ['measure', 'viewer'] as const) for (const online of [false, true]) texts.push(chunkFailText(what, online));
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
  });
  it('translates parsing (해석 — reading the file) as parsing, not interpreting', () => {
    for (const key of Object.keys(catalogs.en).filter(k => k.includes('해석'))) {
      expect(catalogs.de[key], key).not.toMatch(/Dolmetsch|Interpretation/);
      expect(catalogs['zh-CN'][key], key).not.toMatch(/译员|解释/);
    }
  });
  it('translates CAD homonyms by their CAD meaning and keeps no machine-translation leftovers (31st round)', () => {
    // 같은 소리 다른 뜻: 면(face — 솜·얼굴 아님), 모서리(edge — 구석 아님), 판(version — 판자 아님), 분수(fraction — 분수대 아님),
    // 소수(decimal — 소수점 아래, 적은 수·소수(素數) 아님), 카메라 기록(history — 녹화 아님)
    const rules: [RegExp, Record<string, RegExp>][] = [
      [/(^|[\s·(:])면($|[\s·):0-9{]|에|을|이|의|은)/, { en: /cotton|noodle/i, de: /Baumwoll|Gesicht/, ja: /綿|麺/, 'zh-CN': /棉|面部|面条/ }],
      [/모서리/, { en: /corner/i, de: /Ecke/, ja: /コーナー|角(?!度)/, 'zh-CN': /角落/ }],
      [/판입니다|^판$/, { en: /section|plate|board|panel/i, de: /Platte|Ref\./, ja: /プレート|パネル|板/, 'zh-CN': /板|参考/ }],
      [/분수/, { en: /fountain/i, de: /Brunnen/, ja: /噴水/, 'zh-CN': /喷泉/ }],
      [/소수/, { en: /prime|minority/i, de: /Primzahl|Minderheit/, ja: /素数|少数/, 'zh-CN': /素数|少数/ }],
      [/카메라 기록/, { en: /recording/i, de: /Aufnahme/, ja: /録画|録音/, 'zh-CN': /录制/ }],
    ];
    for (const [key, bad] of rules)
      for (const k of Object.keys(catalogs.en).filter(x => key.test(x) && !x.includes('구석')))
        for (const [code, re] of Object.entries(bad)) expect(catalogs[code][k], `${code}: ${k}`).not.toMatch(re);
    // 기계 번역이 다음 문장 머리를 줄바꿈 뒤에 덧붙인 것(원문에 없는 줄)
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const [k, v] of Object.entries(catalogs[code])) expect((v.match(/\n/g) ?? []).length, `${code}: ${k}`).toBe((k.match(/\n/g) ?? []).length);
    // 측정 툴팁의 "중심"(호·원의 중심)과 "중간점"을 다른 낱말로(독일어가 Mittelpunkt 하나로 겹쳤다)
    for (const {code} of languages.filter(item => item.code !== 'ko')) expect(translate('중심', code), code).not.toBe(translate('중간점', code));
    expect(translate('건축(피트·인치·분수)', 'ja')).toBe('建築（フィート・インチ・分数）');
    expect(translate('건축(피트·인치·분수)', 'zh-CN')).toBe('建筑（英尺·英寸·分数）');
    expect(translate('mm · 소수 2자리', 'ja')).toBe('mm・小数点以下2桁');
    expect(translate('다음 보기', 'en')).toBe('Next view');
    // 측정 기록 줄(30차까지는 번역에서 빼 한국어로 남았다): "거리·각도"를 옮기고 값·축 이름은 그대로
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const line of ['거리 4,061 mm (dx 1,234 mm · dy -2 mm · dz 3 mm)', `거리 13' 4 1/2" (dx 1' · dy 2' · dz 0")`, '각도 45.0°'])
        expect(translate(line, code), `${code}: ${line}`).not.toMatch(/[가-힣]/);
    expect(translate('거리 4,061 mm (dx 1,234 mm · dy -2 mm · dz 3 mm)', 'en')).toBe('Distance 4,061 mm (dx 1,234 mm · dy -2 mm · dz 3 mm)');
  });
  it('keeps SketchUp terms, Korean homonyms, directions and negations right in every catalog (50th round)', () => {
    const codes = ['en', 'de', 'ja', 'zh-CN'];
    // [열쇠 정규식, 언어(*는 넷 다), 있어야 할 말(없으면 null), 없어야 할 말, 뺄 열쇠] — 50차에 이 앱 사전에서 찾은 오역의 꼴
    const rules: [RegExp, string, RegExp | null, RegExp, RegExp?][] = [
      // 무늬=텍스처(SketchUp 공식: Texture·Textur·テクスチャ, zh 纹理) — Pattern·Muster·柄·图案은 다른 개념
      [/무늬/, 'en', /textur/i, /pattern/i], [/무늬/, 'de', /[Tt]extur/, /Muster/], [/무늬/, 'ja', /テクスチャ/, /パターン|柄|模様/], [/무늬/, 'zh-CN', /纹理/, /图案/],
      // 단면=Section(SketchUp Section Plane·Schnittebene·断面平面) — Cross section·Querschnitt·Abschnitt(단락)·截面과 섞지 않는다, 단면(斷面)≠단면(單面)
      [/단면/, 'en', null, /Cross|Single-sided/i], [/단면/, 'de', null, /Querschnitt|Abschnitt|Einseitig/], [/단면/, 'zh-CN', null, /截面|部分|分区/],
      // 숨긴 형상=Hidden Geometry(Ausgeblendete Geometrie·非表示のジオメトリ) — features·Funktionen·特征 아님
      [/숨긴 형상/, 'en', /geometry/i, /feature|shape/i], [/숨긴 형상/, 'de', /Geometrie/, /Funktion|Form\b/], [/숨긴 형상/, 'zh-CN', /几何体/, /特征/],
      // 고름(고른 것)→고름(膿), 쪽(side)→쪽(page), 그물(mesh)→net·grid, 구간(range)→section, 합성(만든 시험 장면)→복합, 상자(box)→칸·네모
      [/고름:/, '*', null, /Pus|Eiter|膿|脓|更正/], [/쪽 뒤집기/, '*', null, /\bpage\b|页面|ページ/i],
      [/그물/, '*', null, /\bnets?\b|グリッド/], [/구간/, '*', null, /\bsections?\b|Abschnitt|部分|区間|区画/], [/합성 장면/, '*', null, /Composite|Komposition|複合/],
      [/상자/, '*', null, /\bFeld\b|Quadrat|方框|框$/],
      // 단계(level)→step(되돌리기 100단계·크기 단계는 step이 맞다), 풀다(decode·resolve)→solve, 쓰다(use)→write, 열(open)→column
      [/단계/, '*', null, /\bsteps?\b|Schritt|ステップ|步骤/, /되돌리기|크기 단계/],
      [/풀지 못|풀거나/, '*', null, /\bsolve|\blösen|\bgelöst|解く|解决/], [/씁니다/, '*', null, /\bwritten\b|geschrieben|書き込|写入/], [/^열 파일/, '*', null, /column|Spalte|列/],
      // 머리(header)→head, 부호(code)→sign, 겹치다(nest)→overlap, 문자(글 개체)→character, 칸(slot)→cell, 집(house)→collection, 고리(loop)→Gori·ring·side
      [/머리/, '*', null, /\bhead\b|abgeschlagen|頭|砍/], [/부호/, '*', null, /\bsigns?\b|Zeichen|記号|标志/], [/겹쳤/, '*', null, /overlap|überlapp|重叠|重なり/],
      [/^문자/, '*', null, /character|\bZeichen|字符/], [/칸 \{|칸을|^칸$/, '*', null, /\bcell\b|Zelle|カーン|セル|单元格/], [/예제 집/, '*', null, /collection|Sammlung|集合/],
      [/^고리/, '*', null, /Gori|\bring\b|\bRing\b|\bside\b|\bSeite\b/],
      // 끌기 단추(왼쪽 끌기=왼쪽 단추로 끌기)를 끄는 방향으로, F 전체 보기를 온 화면으로, 두 번 눌러 들어가기를 나가기로(zh)
      [/왼쪽 끌기/, '*', null, /Nach links ziehen|Nach rechts ziehen|向左拖动|向右拖动|Vollbild|全屏/], [/한 단계 들어/, 'zh-CN', /进入/, /返回上一级/],
      [/윗단계로/, '*', null, /including|nächste Ebene|下一级/],
      // 원점(origin)→출신·기원, 허용(허락)→공차, 뷰 큐브(view 명사)→查看(보다), 여는 중→개막, 올리다(GPU 올림)→들어 올림·올림 반올림, 접기→숨기기
      [/원점/, '*', null, /Herkunft|起源/], [/^허용$/, 'zh-CN', null, /容差/], [/뷰 큐브/, 'zh-CN', /视图立方体/, /查看立方体|立方体视图/], [/뷰 큐브/, 'de', /Ansichtswürfel/, /Würfel anzeigen/],
      [/여는 중/, 'de', null, /Eröffnung/], [/올리는 중|다 올림/, '*', null, /Anheben|提升|上へ|向上取整/], [/모두 접기/, 'de', null, /ausblenden/i],
      // 부정·조건 뒤집힘: "읽지 못했습니다"를 "읽지 않은 것을 읽지 못함"으로, "건너뛰었다"를 "건너뛰기엔 너무 크다"로, "나가지 않습니다"를 "나가지 않았다"로
      [/태그 폴더를 읽지 못했습니다/, '*', null, /ungelesen|未读取/], [/너무 커서 건너뛰었습니다/, 'de', null, /zum Überspringen/], [/나가지 않습니다/, 'zh-CN', /不会/, /未离开/],
      // 예제 집 이름: 남(南)→男, 서(西)→서다, 수관(樹冠)→水管, 탁자→표, 줄기→낱말 줄기, 마루→소리 옮김, 나무(tree)→목재, 기와→기울기
      [/^의자 남$/, '*', null, /männlich|男/], [/^의자 서$/, '*', null, /Steh|站立/], [/^수관$/, '*', null, /pipe|Wasserpfeife|水管|管轄/], [/^탁자$/, '*', null, /Tabelle|表格/],
      [/^줄기$/, 'zh-CN', null, /词干/], [/^마루$/, '*', null, /Maru/], [/^나무$/, 'zh-CN', /树/, /木材/], [/^기와$/, '*', null, /傾斜|平铺/],
      // 읽어 봅니다(해 보겠다)를 사용자에게 시킴(Read it·お読みください)
      [/읽어 봅니다/, '*', null, /Read it|Lesen Sie|お読みください|阅读/],
    ];
    for (const [term, lang, need, ban, skip] of rules)
      for (const code of lang === '*' ? codes : [lang])
        for (const [key, value] of Object.entries(catalogs[code])) {
          if (!term.test(key) || skip?.test(key)) continue;
          if (need) expect(value, `${code}: ${key}`).toMatch(need);
          expect(value, `${code}: ${key}`).not.toMatch(ban);
        }
    // 열쇠와 상관없이: 구(球)를 구(區)로, 초를 둘째(第二)로, 보이지 않는 글자, 알림의 1인칭(만든 사람 소개·1인칭 시점 걷기는 빼고)
    const firstPerson: Record<string, RegExp> = { en: /\bI\b|\bwe\b/i, de: /\bich\b|\bwir\b/i, ja: /私|僕/, 'zh-CN': /我/ };
    for (const code of codes)
      for (const [key, value] of Object.entries(catalogs[code])) {
        expect(value, `${code}: ${key}`).not.toMatch(/District|Bezirk|第二$|[​-‍﻿]/);
        if (!/다룹니다|1인칭/.test(key)) expect(value, `${code}: ${key}`).not.toMatch(firstPerson[code]);
        // 형식·코드 이름(STEP·DEFLATE·ZIP·TLV·createImageBitmap 등)은 옮기지 않는다
        for (const name of key.replace(/\{\d+\}/g, '').match(/\b[A-Z][A-Z0-9_]{2,}\b|\b[a-z]+[A-Z][A-Za-z0-9]+\b/g) ?? []) expect(value, `${code}: ${key}`).toContain(name);
      }
    expect(codes.map((code) => translate('무늬', code))).toEqual(['Texture', 'Textur', 'テクスチャ', '纹理']);
    expect(codes.map((code) => translate('단면', code))).toEqual(['Section', 'Schnitt', '断面', '剖面']);
    expect(codes.map((code) => translate('(원점)', code))).toEqual(['(origin)', '(Ursprung)', '(原点)', '（原点）']);
    expect(codes.map((code) => translate('숨긴 형상 보기', code))).toEqual(['Show hidden geometry', 'Ausgeblendete Geometrie anzeigen', '非表示のジオメトリを表示', '显示隐藏的几何体']);
    expect(codes.map((code) => translate('3D에서 누를 때 고르는 단계', code))).toEqual(['Level selected by a click in 3D', 'Ebene, die ein Klick in 3D auswählt', '3Dでクリックしたときに選ぶ階層', '在 3D 中点击时选择的层级']);
    expect(translate('1.25초', 'zh-CN')).toBe('1.25 秒');
    expect(translate('허용', 'zh-CN')).toBe('允许');
    expect(translate('누르기: 고르기(펼친 단계) · Alt+누르기: 가장 안쪽 · 두 번 누르기: 한 단계 들어가기', 'zh-CN')).toBe('单击：选择（展开的层级）· Alt+单击：最内层 · 双击：进入下一级');
  });
  it('lets the localization layer translate the recent-measurement rows (no data-i18n-skip around measureLine — 31st round) and copies them in the UI language', () => {
    for (const file of ['src/app/app.ts', 'src/app/panel.ts']) {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(src, file).toMatch(/measureLine\(m, d\.units, mm\)/);
      expect(src, file).not.toMatch(/'data-i18n-skip': '' \}, measureLine\(/);
    }
    expect(readFileSync(resolve(__dirname, '../src/app/app.ts'), 'utf8')).toMatch(/uiText\(measureLine\(m, d\.units, mm\)\)/);
  });
  it('uiText follows the active language, and the localization layer leaves data-i18n-skip text alone (measuring tooltip, toolbar menus — 31st round)', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header></div></body></html>', {url:languageUrl(metadataForLanguage('ko').url,'de')});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    // 번역층을 붙이기 전(그리고 닫은 뒤)은 한국어 그대로
    expect(uiText('끝점 · 1,200 mm')).toBe('끝점 · 1,200 mm');
    dispose = await installLocalization(root);
    expect(uiText('끝점 · 1,200 mm')).toBe(`${translate('끝점','de')} · 1,200 mm`);
    expect(uiText('보기 설정')).toBe(translate('보기 설정','de'));
    // 앱이 옮겨 넣은 글(data-i18n-skip)은 번역층이 원문으로 되찾아 다시 옮기지 않는다
    const tip = document.createElement('div'); tip.setAttribute('data-i18n-skip',''); tip.textContent = uiText('중심'); root.append(tip);
    const plain = document.createElement('div'); plain.textContent = '중심'; root.append(plain);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(tip.textContent).toBe('Zentrum'); expect(plain.textContent).toBe('Zentrum');
    (document.querySelector('.language-list [data-language="ja"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(uiText('끝점')).toBe(translate('끝점','ja'));
    // 건너뛴 요소는 앱이 다시 그릴 때 새 언어로(측정 도구는 languagechange에 다시 그린다)
    expect(tip.textContent).toBe('Zentrum'); expect(plain.textContent).toBe(translate('중심','ja'));
    dispose(); dispose=undefined;
    expect(uiText('끝점')).toBe('끝점');
    dom.window.close();
  });
  it('gives the core the keyboard-pick message templates of the UI language and keeps the announcement region out of the localization layer (56th round)', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header><div id="view"><canvas></canvas></div></div></body></html>', {url:languageUrl(metadataForLanguage('ko').url,'en')});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    const given: (KeyboardSnapOptions | boolean | null)[] = [];
    const viewer = { canvas: document.querySelector('canvas')!, keyboardCursor: null, setKeyboardSnap: (o: KeyboardSnapOptions | boolean | null) => given.push(o) };
    const kp = new KeyPick(viewer as unknown as Viewer3d, document.getElementById('view')!, () => null);
    root.addEventListener('languagechange', () => kp.relocalize());
    kp.set(true);
    // 코어 0.53.0부터 messages는 틀 객체 또는 글 함수 — 63차부터 고르기 모드는 글 함수(말 차례 틀까지 코어 글로 — 값 없이 부르면 틀 그대로)
    const msg = (o: KeyboardSnapOptions, key: KeySnapMessageKey): string | null | undefined => (o.messages as KeySnapMessageFn)(key, []);
    const first = given.at(-1) as KeyboardSnapOptions;
    expect(msg(first, 'start')).toBe('Virtual cursor on. {0}. {1}');
    expect(msg(first, 'pick.line')).toBe('Edge of {0}');
    // 알림 칸 글은 앱이 이미 옮긴 글 — 번역층이 파일 글("모서리 · Layer0"처럼 사전 낱말과 같은 이름)을 바꾸지 않는다
    first.announce!({ reason: 'move', mode: 'pick', x: 0, y: 0, snap: null, index: 0, count: 0, pick: null, text: '모서리 · Layer0' });
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(kp.text).toBe('모서리 · Layer0');
    const plain = document.createElement('div'); plain.textContent = '모서리 · Layer0'; root.append(plain);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(plain.textContent).toBe('Edge · Layer0');
    (document.querySelector('.language-list [data-language="ja"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(msg(given.at(-1) as KeyboardSnapOptions, 'start')).toBe(translate('가상 커서를 켰습니다. {0}. {1}','ja'));
    expect(kp.text).toBe('모서리 · Layer0');
    kp.set(false);
    expect(given.at(-1)).toBe(false);
    dispose(); dispose=undefined; dom.window.close();
  });
  it('reopens an open toolbar menu in the new language on languagechange, keeping the focused item or the outside focus and the scroll (32nd round)', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header><button id="more">보기 설정</button></div></body></html>', {url:languageUrl(metadataForLanguage('ko').url,'de')});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    // 앱 openMenu처럼: 글은 지금 언어로 옮겨 넣고 번역층에서 뺀다(data-i18n-skip), 단추를 누를 때마다 새로 만든다
    const labels = ['외곽선(윤곽 굵게)', '안개', '걷기(1인칭)'];
    let menu = null as HTMLElement | null;
    const open = (): void => {
      menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('data-i18n-skip','');
      for (const l of labels) { const b = document.createElement('button'); b.className = 'menu-item'; b.textContent = uiText(l); menu.append(b); }
      document.body.append(menu); (menu.firstElementChild as HTMLElement).focus();
    };
    const close = (): void => { menu?.remove(); menu = null; };
    const more = document.getElementById('more') as HTMLButtonElement;
    more.addEventListener('click', () => { if (menu) close(); else open(); });
    let reopened = 0;
    root.addEventListener('languagechange', () => { const m = menu; if (m) { reopened++; reopenMenu(m, () => { close(); more.click(); return menu; }); } });
    more.click();
    const texts = (): string[] => [...menu!.querySelectorAll('.menu-item')].map((e) => e.textContent!);
    expect(texts()).toEqual(labels.map((l) => translate(l,'de')));
    // 키보드로 메뉴에서 언어 고르기 단추로 옮겨(Tab — 메뉴는 열린 채) 고르면 새 언어로 다시 열고, 초점은 언어 고르기 단추에 남는다(새 메뉴가 가져가지 않게)
    const trigger = root.querySelector<HTMLButtonElement>('.language-trigger')!;
    trigger.focus();
    const first = menu;
    (document.querySelector('.language-list [data-language="ja"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(reopened).toBe(1);
    expect(menu).not.toBe(first); expect(first!.isConnected).toBe(false);
    expect(texts()).toEqual(labels.map((l) => translate(l,'ja')));
    expect(texts().join('')).not.toMatch(/[가-힣]/);
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelectorAll('.menu')).toHaveLength(1);
    // 굴린 자리는 그대로, 초점이 메뉴 안이었으면 새 메뉴의 처음 초점(앱 openMenu처럼 첫 항목)
    (menu!.querySelectorAll('.menu-item')[2] as HTMLElement).focus();
    Object.defineProperty(menu!, 'scrollTop', { value: 40, writable: true });
    const second = menu!;
    expect(reopenMenu(second, () => { close(); more.click(); Object.defineProperty(menu!, 'scrollTop', { value: 0, writable: true }); return menu; })).toBe(menu);
    expect(menu).not.toBe(second);
    expect(document.activeElement).toBe(menu!.querySelectorAll('.menu-item')[0]);
    expect(menu!.scrollTop).toBe(40);
    (document.querySelector('.language-list [data-language="ko"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(reopened).toBe(2);
    expect(texts()).toEqual(labels);
    // 메뉴가 닫혀 있으면 아무것도 열지 않는다
    close();
    (document.querySelector('.language-list [data-language="en"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(reopened).toBe(2); expect(document.querySelector('.menu')).toBeNull();
    // 다시 열지 못하면(단추가 꺼짐 등) null — 앞 메뉴는 닫힌 채
    open();
    expect(reopenMenu(menu!, () => { close(); return null; })).toBeNull();
    expect(document.querySelector('.menu')).toBeNull();
    dispose(); dispose=undefined;
    dom.window.close();
  });
  it('updates dynamic UI and switches languages without changing document data or listeners', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"><button>열기</button><span class="docname">열기</span></header><canvas></canvas><div class="anno-layer">열기</div><input value="열기" placeholder="열기"><div contenteditable="true">열기</div><div translate="no">열기</div><p id="status">열기</p></div></body></html>', {url:'https://gyutae-kim.github.io/opencad-skp/en/?sample#view'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    const existing=document.createElement('p');existing.id='pretranslated';existing.textContent=translate('열기','en');root.append(existing);
    const canvas = root.querySelector('canvas');
    const button = root.querySelector('button')!; const clicked = vi.fn(); button.addEventListener('click',clicked);
    dispose=await installLocalization(root);
    expect(button.textContent).toBe(translate('열기','en'));
    expect(root.querySelector('.docname')!.textContent).toBe('열기'); expect(root.querySelector('input')!.value).toBe('열기');
    expect(root.querySelector('input')!.placeholder).toBe(translate('열기','en'));
    expect(root.querySelector('[contenteditable]')!.textContent).toBe('열기');
    expect(root.querySelector('.anno-layer')!.textContent).toBe('열기');
    const status = document.getElementById('status')!; status.textContent='닫기';
    await new Promise(resolve=>setTimeout(resolve,0)); expect(status.textContent).toBe(translate('닫기','en'));
    const dialog=document.createElement('div');dialog.textContent='닫기';document.body.append(dialog);
    await new Promise(resolve=>setTimeout(resolve,0));expect(dialog.textContent).toBe(translate('닫기','en'));
    const trigger=root.querySelector<HTMLButtonElement>('.language-trigger')!;
    trigger.click();expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu=document.querySelector<HTMLElement>('.language-list')!;
    expect(menu.hidden).toBe(false);expect(menu.querySelectorAll('[role=menuitemradio]')).toHaveLength(5);
    (menu.querySelector('[data-language=de]') as HTMLButtonElement).click();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(document.getElementById('pretranslated')!.textContent).toBe(translate('열기','de'));
    expect(document.documentElement.lang).toBe('de');expect(button.textContent).toBe(translate('열기','de'));
    expect(dialog.textContent).toBe(translate('닫기','de'));
    expect(location.search).toBe('?sample');expect(location.hash).toBe('#view');
    expect(menu.hidden).toBe(true);
    expect(menu.querySelector('[data-language=de]')!.getAttribute('aria-checked')).toBe('true');
    trigger.click();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    expect(menu.hidden).toBe(true);expect(document.activeElement).toBe(trigger);
    trigger.click();(menu.querySelector('[data-language=ko]') as HTMLButtonElement).click();
    await new Promise(resolve=>setTimeout(resolve,0));expect(button.textContent).toBe('열기');
    expect(root.querySelector('canvas')).toBe(canvas);button.click();expect(clicked).toHaveBeenCalledOnce();
    expect(root.querySelector('[translate="no"]:not(.language-control):not(.language-list)')!.textContent).toBe('열기');
    dispose();dispose=undefined;dom.window.close();
  });
  it('switches actual sharing image URLs and native control names while preserving source data', async () => {
    const korean = metadataForLanguage('ko');
    const dom = new JSDOM(`<!doctype html><html><head><title>OpenCAD</title><meta property="og:image"><meta property="og:image:secure_url"><meta name="twitter:image"><script type="application/ld+json">{"@graph":[{"@type":"WebApplication"}]}</script></head><body><div id="app"><header class="titlebar"><button>열기</button></header><a id="brand" title="OpenCAD SketchUp 뷰어 처음 화면">OpenCAD</a><button id="theme" title="앱 설정 · 테마: 시스템 설정 따르기(지금 어두움) — 눌러서 바꾸기">Settings</button><div class="scene-tabs" aria-label="장면"><button class="scene-tab" role="tab" title="열기">열기</button></div><span class="docname">열기.skp</span></div></body></html>`, {url:languageUrl(korean.url,'en')+'?sample#view'});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose=await installLocalization(root);
    const labels = {en:'Choose language', de:'Sprache wählen', ko:'언어 선택'};
    for (const code of ['en','de','ko'] as const) {
      if (code!=='en') {
        (document.querySelector(`.language-list [data-language="${code}"]`) as HTMLButtonElement).click();
        for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
      }
      const image = code==='ko' ? korean.image.url : `https://gyutae-kim.github.io/assets/i18n/${code}/og/opencad.jpg`;
      for (const selector of ['meta[property="og:image"]','meta[property="og:image:secure_url"]','meta[name="twitter:image"]']) expect(document.querySelector(selector)!.getAttribute('content')).toBe(image);
      expect(JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!)['@graph'][0].image).toBe(image);
      expect(root.querySelector('.language-trigger')!.getAttribute('aria-label')).toBe(labels[code]);
      expect(root.querySelector('.docname')!.textContent).toBe('열기.skp');
      if (code!=='ko') { expect(root.querySelector('#brand')!.getAttribute('title')).not.toMatch(/[가-힣]/); expect(root.querySelector('#theme')!.getAttribute('title')).not.toMatch(/[가-힣]/); expect(root.querySelector('.scene-tabs')!.getAttribute('aria-label')).not.toMatch(/[가-힣]/); } expect(root.querySelector('.scene-tabs button')!.textContent).toBe('열기');
    }
    dispose();dispose=undefined;dom.window.close();
  });

  it('뷰 큐브 면 글은 코어와 함께 받은 뒤에 맡겨도 지금 언어로 옮기고 언어를 바꾸면 따르며 닫으면 되돌린다(54차)', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header></div></body></html>', {url:languageUrl(metadataForLanguage('ko').url,'en')});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose=await installLocalization(root);
    // 번역층을 켠 뒤에 받은 것(코어 조각을 문서를 열 때 받는다)
    const faces = ['앞','뒤','오른쪽','왼쪽','위','아래'].map(label=>({label}));
    localizeCubeFaces(faces);
    expect(faces.map(f=>f.label)).toEqual(['Front','Back','Right','Left','Top','Bottom']);
    (document.querySelector('.language-list [data-language="de"]') as HTMLButtonElement).click();
    for (let i=0;i<4;i++) await new Promise(resolve=>setTimeout(resolve,0));
    expect(faces.map(f=>f.label)).toEqual(['Vorne','Hinten','Rechts','Links','Oben','Unten']);
    dispose();dispose=undefined;
    expect(faces.map(f=>f.label)).toEqual(['앞','뒤','오른쪽','왼쪽','위','아래']);
    dom.window.close();
  });

  // 212차: 앱 설정(테마) 버튼 title — 밝은·어두운 테마일 때는 통째 열쇠가 없어 틀 「앱 설정 · 테마: {0}{1} — 눌러서 바꾸기」로 옮겨지고, 번역층은 틀 자리 글을
  // 그대로 끼워(「밝은 테마」·「어두운 테마」) 네 언어 title에 한국어가 남았다(WCAG 3.1.2). 시스템 상태 둘처럼 상태마다 통째 열쇠로, 끝 낱말은 상태마다
  // Click ↔ Tap으로 갈리던 것을 같은 사전의 기기를 가리지 않는 「눌러서」 낱말 하나로(키보드로 눌러도 맞는 말)
  it.each(['en', 'ja', 'zh-CN', 'de'])('212차: 테마 버튼 title은 네 상태 모두 %s 글(한국어 남지 않음)이고 끝 낱말이 하나다', async code => {
    const app = readFileSync(resolve(__dirname, '../src/app/app.ts'), 'utf8');
    // 앱이 넣는 원문(applyTheme — 고른 상태 이름, 시스템이면 지금 밝기를 덧붙임)
    expect(app).toContain("b.title = `앱 설정 · 테마: ${label}${choice === 'system' ? `(지금 ${this.theme === 'dark' ? '어두움' : '밝음'})` : ''} — 눌러서 바꾸기`;");
    const label = (choice: string): string => THEME_CHOICES.find((c) => c.choice === choice)!.label;
    const source = (choice: string, now?: string): string => `앱 설정 · 테마: ${label(choice)}${now ? `(지금 ${now})` : ''} — 눌러서 바꾸기`;
    const states = [source('light'), source('dark'), source('system', '어두움'), source('system', '밝음')];
    expect(states).toEqual([
      '앱 설정 · 테마: 밝은 테마 — 눌러서 바꾸기',
      '앱 설정 · 테마: 어두운 테마 — 눌러서 바꾸기',
      '앱 설정 · 테마: 시스템 설정 따르기(지금 어두움) — 눌러서 바꾸기',
      '앱 설정 · 테마: 시스템 설정 따르기(지금 밝음) — 눌러서 바꾸기',
    ]);
    const want: Record<string, string[]> = {
      en: [
        'App settings · Theme: Light theme — Press to change',
        'App settings · Theme: Dark theme — Press to change',
        'App settings · Theme: Follow system (currently dark) — Press to change',
        'App settings · Theme: Follow system (currently light) — Press to change',
      ],
      ja: [
        'アプリ設定 · テーマ: 明るいテーマ — 押して変更',
        'アプリ設定 · テーマ: ダークテーマ — 押して変更',
        'アプリ設定 · テーマ: システム設定に従う（現在はダーク） — 押して変更',
        'アプリ設定 · テーマ: システム設定に従う（現在はライト） — 押して変更',
      ],
      'zh-CN': [
        '应用设置 · 主题：亮色主题 — 按下切换',
        '应用设置 · 主题：深色主题 — 按下切换',
        '应用设置 · 主题：跟随系统（当前为深色） — 按下切换',
        '应用设置 · 主题：跟随系统（当前为浅色） — 按下切换',
      ],
      de: [
        'App-Einstellungen · Design: Helles Design — Zum Ändern drücken',
        'App-Einstellungen · Design: Dunkles Design — Zum Ändern drücken',
        'App-Einstellungen · Design: Systemeinstellung (aktuell dunkel) — Zum Ändern drücken',
        'App-Einstellungen · Design: Systemeinstellung (aktuell hell) — Zum Ändern drücken',
      ],
    };
    // 기기를 가리지 않는 끝 낱말 — 근거: 같은 사전의 「눌러서 이 결과 복사」·「끌거나 눌러서 패널 크기 바꾸기」
    const end: Record<string, string> = { en: ' — Press to change', ja: ' — 押して変更', 'zh-CN': ' — 按下切换', de: ' — Zum Ändern drücken' };
    const basis: Record<string, [string, string]> = {
      en: ['눌러서 이 결과 복사', 'Press to '],
      ja: ['눌러서 이 결과 복사', '押して'],
      'zh-CN': ['눌러서 이 결과 복사', '按下'],
      de: ['끌거나 눌러서 패널 크기 바꾸기 · 두 번 누르면 처음 크기', 'Drücken'],
    };
    expect(catalogs[code][basis[code][0]]).toContain(basis[code][1]);
    const dom = new JSDOM(`<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"><button id="theme" class="tbtn icon-only" title="${states[0]}" aria-label="앱 설정"><span class="lbl">설정</span></button></header></div></body></html>`, {url:languageUrl(metadataForLanguage('ko').url,code)});
    for (const name of ['window','document','Node','Element','HTMLAnchorElement','MutationObserver','location','history','localStorage','CustomEvent']) vi.stubGlobal(name,(dom.window as unknown as Record<string,unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    const theme = root.querySelector<HTMLButtonElement>('#theme')!;
    // 앱처럼 상태가 바뀔 때마다 한국어 원문을 다시 넣는다(번역층이 title 바뀜을 보고 옮긴다)
    const got: string[] = [];
    for (const [i, text] of states.entries()) {
      if (i) { theme.title = text; await new Promise(resolve=>setTimeout(resolve,0)); }
      got.push(theme.title);
    }
    expect(got).toEqual(want[code]);
    for (const t of got) { expect(t).not.toMatch(/[가-힣]/); expect(t.endsWith(end[code])).toBe(true); }
    // 이름(aria-label)·보이는 글은 그대로 옮겨진다
    expect(theme.getAttribute('aria-label')).toBe(translate('앱 설정', code));
    expect(theme.textContent).toBe(translate('설정', code));
    // 사전: 상태마다 통째 열쇠 — 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로(언어를 바꿀 때 번역층이 되찾는다), 틀 값도 같은 끝 낱말
    const all = ['en', 'ja', 'zh-CN', 'de'].flatMap((c) => Object.values(catalogs[c]));
    states.forEach((text, i) => {
      expect(catalogs[code][text], text).toBe(want[code][i]);
      expect(all.filter((v) => v === want[code][i]).length, want[code][i]).toBe(1);
      expect(sourceMessage(want[code][i])).toBe(text);
    });
    expect(catalogs[code]['앱 설정 · 테마: {0}{1} — 눌러서 바꾸기'].endsWith(end[code])).toBe(true);
    // 상태 이름은 테마 메뉴 항목 값 그대로(메뉴와 title이 같은 이름 — 3.2.4)
    expect(want[code][0]).toContain(translate('밝은 테마', code));
    expect(want[code][1]).toContain(translate('어두운 테마', code));
    dispose(); dispose=undefined; dom.window.close();
  });

});

/**
 * 213차(212차 꼴 — WCAG 3.3.2, 입력 방식과 상관없는 안내): 원문이 기기를 가리지 않는 「누르다」(누르면·눌러서·누르세요·누른·누를·두 번 누르면)인데
 * 네 언어 값에 한 기기 낱말(마우스 Click·Klicken·クリック·点击·双击·Doppelklick, 손가락 Tap·Tippen·angetippt·タップ·点按)이 섞여 마우스·손가락·키보드(Enter·Space)
 * 가운데 한쪽만 말하던 풀이·안내를 212차 근거(같은 사전의 「눌러서 …」 Press·押して·按下·drücken)와 같은 사전의 두 번 누름 낱말(double-press·2回押す·按两次·
 * zweimal drücken)로 맞췄다(사전만 — README 개발 절 213차 문단). 정말 한 기기만 되는 자리(손가락 기기 측정 안내·걷기 줄·마우스 스냅·수식 키 누르기)와
 * 화면에 안 쓰이는 옛 열쇠는 두고, 독일어 40곳 한도로 드물게 보는 여덟 열쇠는 네 언어 모두 남겼다(213차에 보고 둔 것).
 */
describe('213차: 기기를 가리지 않는 「누르다」 원문의 번역은 기기를 가리지 않는 낱말(WCAG 3.3.2)', () => {
  const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
  type Lang = (typeof LANGS)[number];
  // 한 기기 낱말(영어 Tape·독일어 eintippen(글 치기)은 셈 밖)
  const DEVICE: Record<Lang, RegExp> = {
    en: /\b(?:taps?|tapped|tapping|click\w*|double[- ]tap\w*|touch\w*)\b/i,
    ja: /タップ|クリック|タッチ/,
    'zh-CN': /点按|点击|单击|双击|触碰|轻点|轻触/,
    de: /(?<!ein)tipp|klick|berühr/i,
  };
  const PRESS = /누르|눌러|누른|누를|눌렀/;
  /** 손가락 기기만(measureHint touch 갈래 — 앱이 (pointer: coarse)일 때 넘김) */
  const TOUCH_ONLY = [
    '각도기: 기준 방향의 점을 누르세요', '각도기: 다시 누르면 새로 잽니다', '각도기: 안내선을 둘 방향의 점을 누르세요', '각도기: 잴 방향의 점을 누르세요',
    '각도기: 중심점을 누르세요 · 길게 누르면 정밀 조준', '줄자: 끝점을 누르세요', '줄자: 다시 누르면 새로 잽니다', '줄자: 모서리와 나란한 안내선을 둘 곳을 누르세요',
    '줄자: 안내를 둘 시작점을 누르세요 · 길게 누르면 정밀 조준', '줄자: 안내점을 둘 곳을 누르세요', '줄자: 잴 시작점을 누르세요 · 길게 누르면 정밀 조준',
  ];
  /** 정말 한 기기만 되는 자리: 손가락·손가락 아닌 걷기 줄(끌기·두 손가락과 한 줄), 마우스 스냅, 수식 키 + 누르기·끌기 상자, 기기를 밝힌 원문, 정보 탭 데스크톱 줄·Alt+누르기 */
  const ONE_DEVICE = [
    '한 손가락 끌기: 둘러보기 · 조이스틱: 걷기 · 두 손가락: 벌려 앞으로·끌어 옆/위아래 · 두 번 누르기: 그 자리에 서기',
    '끌기: 둘러보기 · W/S·↑/↓: 앞뒤 · A/D: 옆 · ←/→: 돌기 · Q/E: 위아래 · Shift: 빠르게 · 두 번 누르기: 그 자리에 서기 · Esc: 끝내기',
    '끌기: 둘러보기 · W/S·↑/↓: 앞뒤 · A/D: 옆 · ←/→: 돌기 · Shift: 빠르게 · 두 번 누르기: 그 자리에 서기 · Esc: 끝내기(중력을 끄면 Q/E로 위아래)',
    '줄자·각도기 마우스 스냅: 커서 자리에 겹친 스냅 후보가 둘 이상이면 다음·앞 후보(누르면 그 후보를 찍고, Esc는 돌리기만 풀기 — 그 밖에는 초점 이동)',
    '줄자·각도기를 끈 동안 안내를 누르거나 끌기: Ctrl(Mac은 Option)은 더하기, Shift는 넣고 빼기, Shift+Ctrl(Shift+Option)은 빼기 — 끌면 고르기 상자(오른쪽으로 끌면 다 든 것, 왼쪽은 걸친 것까지)',
    '패널 크기 가르개: 다음 크기 단계 · 가장 작게 · 가장 크게(화살표는 조금씩, 마우스·손가락은 한 번 누르기)',
    '누르기: 고르기(펼친 단계) · Alt+누르기: 가장 안쪽 · 두 번 누르기: 한 단계 들어가기',
    '누른 곳을 품은 가장 안쪽 그룹·컴포넌트를 바로 고릅니다(Alt+누르기도 같음)',
  ];
  /** 화면에 안 쓰이는 옛 열쇠(지우기는 정적 소개·check:i18n 대조와 함께 볼 일) */
  const UNUSED = [
    '{0}{1} — 누르면 강조, 두 번 누르면 확대{2}', '각도기: 잴 방향의 점을 누르세요 · Esc 취소', '누르면 단면을 끕니다', '누르면 이 단면으로 모형을 자릅니다',
    '줄자: 끝점을 누르세요 · Esc 취소', '3D에서 누를 때 고르는 단계',
  ];
  /** 213차에 보고 둔 것(독일어 40곳 한도 — 아주 큰 모형 알림·바로 가기 안내 창 줄·장면이 있는 파일·정보 탭 조작 줄) — 214차에 213차 근거 낱말로 고쳐 둔 자리에서 뺐다(아래 214차 시험) */
  const LEFT = [
    '그룹·컴포넌트가 너무 많아 깊은 단계는 3D에서 눌러 고를 수 없습니다(목록에서는 고를 수 있습니다)',
    '노드가 많아 {0}단계부터는 목록에 넣지 않았습니다(그 안을 누르면 {1}단계 항목을 고릅니다).',
    '항목이 너무 많아 3D에서 깊은 단계를 눌러 고르지는 못합니다.',
    '눌러서 고른 안내점·안내선 지우기(여럿이면 함께, 줄자·각도기를 끈 동안에도)',
    '줄자·각도기: 안내 두기 켜고 끄기(그 키만 눌렀다 떼기, Mac은 Option) — 줄자 둘째·각도기 셋째 누르기로 안내점·안내선',
    '장면 재생: 장면을 전환 시간과 지연 시간마다 차례로 넘깁니다(3D를 누르거나 장면을 고르면 멈춤)',
    '누르면 그 장면으로 바꿉니다(카메라·숨긴 태그·숨긴 개체·단면·스타일·그림자·그리기 축 중 장면이 기억하는 것). PageUp·PageDown으로도 넘깁니다.',
    '패널 가장자리를 끌면 폭(좁은 화면은 높이)이 바뀝니다. 두 번 누르면 처음 크기로',
  ];
  const keep = [...TOUCH_ONLY, ...ONE_DEVICE, ...UNUSED];
  const hasDevice = (k: string): boolean => LANGS.some((l) => DEVICE[l].test(catalogs[l][k] ?? ''));

  it('「누르다」 원문 열쇠 가운데 기기 낱말이 남은 것은 둔 자리·보고 둔 것뿐이고, 나머지는 네 언어 모두 기기를 가리지 않는 값·하나뿐(거꾸로 찾기 제 원문)', () => {
    const keys = Object.keys(catalogs.en).filter((k) => PRESS.test(k));
    for (const k of keep) expect(keys, k).toContain(k);
    // 목록 밖 열쇠가 기기 낱말을 들고 오면(새 열쇠·되돌린 값) 여기서 걸린다
    expect(keys.filter(hasDevice).sort()).toEqual([...keep].sort());
    const all = LANGS.flatMap((l) => Object.values(catalogs[l]));
    for (const k of keys.filter((x) => !keep.includes(x)))
      for (const l of LANGS) {
        const v = catalogs[l][k];
        expect(v, `${l}: ${k}`).not.toMatch(DEVICE[l]);
        expect(all.filter((x) => x === v).length, `${l}: ${v}`).toBe(1);
        expect(sourceMessage(v), v).toBe(k);
      }
  });

  it('쓰는 곳: 측정 안내는 손가락 기기 갈래만 손가락 낱말이고 마우스·키보드 갈래는 네 언어 모두 기기를 가리지 않는다, 둔 옛 열쇠는 화면에 안 쓰인다', () => {
    const touch = new Set<string>();
    const fine = new Set<string>();
    for (const mode of ['tape', 'protractor'] as const)
      for (const n of [0, 1, 2]) for (const has of [false, true]) for (const t of [false, true]) for (const edge of [false, true]) for (const guide of [false, true])
        (t ? touch : fine).add(measureHint(mode, n, has, t, edge, guide)!);
    expect([...touch].sort()).toEqual([...TOUCH_ONLY].sort());
    expect(fine.size).toBe(12);
    for (const k of fine) for (const l of LANGS) expect(translate(k, l), `${l}: ${k}`).not.toMatch(DEVICE[l]);
    // 화면에 안 쓰이는 옛 열쇠: 앱 원문·코어(뷰 큐브 풀이를 넣는 곳)에 그 글 리터럴이 없다
    const src = ['src/app/app.ts', 'src/app/panel.ts', 'src/app/measure.ts', 'src/app/infotab.ts', 'src/app/shortcuts.ts', 'src/scene.ts', 'node_modules/opencad-viewer3d/src/viewer.ts']
      .map((f) => readFileSync(resolve(__dirname, '..', f), 'utf8'))
      .join('\n');
    for (const k of UNUSED) expect(src.includes(`'${k}'`), k).toBe(false);
    // 쓰이는 자리 둘: 뷰 큐브 풀이는 코어가 넣고(번역층이 옮김), 구성 나무 줄 title은 통째 열쇠 둘(틀 열쇠 {0}{1}…{2}는 안 씀)
    expect(src).toContain(`cube.title = '뷰 큐브: 면·모서리·구석을 누르면 그 방향으로 봅니다';`);
    expect(src).toContain(`uiText(hasKids ? '누르면 강조, 두 번 누르면 확대, › 펼치기' : '누르면 강조, 두 번 누르면 확대')`);
  });

  it('고친 값(자주 보는 것)은 네 언어 새 값 그대로이고, 근거는 같은 사전의 기기를 가리지 않는 한 번·두 번 누름 낱말', () => {
    const want: [key: string, values: Record<Lang, string>][] = [
      ['누르면 강조, 두 번 누르면 확대', { en: 'Press to highlight, double-press to zoom in', ja: '押すと強調、2回押すと拡大', 'zh-CN': '按一下高亮显示，按两次放大', de: 'Zum Hervorheben drücken, zum Vergrößern zweimal drücken' }],
      ['누르면 강조, 두 번 누르면 확대, › 펼치기', { en: 'Press to highlight, double-press to zoom in, › to expand', ja: '押すと強調、2回押すと拡大、›で展開', 'zh-CN': '按一下高亮显示，按两次放大，按 › 展开', de: 'Zum Hervorheben drücken, zum Vergrößern zweimal drücken, › zum Aufklappen' }],
      ['그룹 {0} · 컴포넌트 {1}. 누르면 강조하고, 두 번 누르면 그쪽으로 확대합니다.', {
        en: 'Group {0} · Component {1}. Press to highlight it, double-press to zoom in on it.',
        ja: 'グループ {0} · コンポーネント {1}。押すと強調表示され、2回押すとその箇所にズームします。',
        'zh-CN': '组 {0} · 组件 {1}。按一下高亮显示，按两次放大。',
        de: 'Gruppe {0} · Komponente {1}. Drücken Sie, um es hervorzuheben, und drücken Sie zweimal, um es zu vergrößern.',
      }],
      // 3D에서 자리를 가리키는 한 번 누름은 고르기 낱말(아래 「자리 가리키기」 it), 두 번 누름은 그대로 double-press·2回押す·按两次·zweimal drücken
      ['줄자: 잴 시작점을 누르세요 · 모서리를 두 번 누르면 그 위에 안내선', {
        en: 'Tape Measure: Select the starting point for measurement · Double-press an edge to place a guide line on it',
        ja: 'メジャー: 計測の始点を選択してください · エッジを2回押すとその上にガイド線',
        'zh-CN': '卷尺：选择起点进行测量 · 按两次边线可在其上放置参考线',
        de: 'Maßband: Startpunkt auswählen, um zu messen · Zweimaliges Drücken auf eine Kante setzt eine Hilfslinie darauf',
      }],
      ['각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정', {
        en: 'Protractor: select the center point · hold Shift to lock the plane',
        ja: '分度器: 中心点を選択してください · Shiftキーを押している間は平面を固定',
        'zh-CN': '量角器：选择中心点 · 按住 Shift 键固定平面',
        de: 'Winkelmesser: Mittelpunkt auswählen · Umschalttaste gedrückt halten, um die Ebene zu fixieren',
      }],
      ['누르면 이 단면으로 자릅니다(같은 그룹의 다른 단면은 꺼짐)', {
        en: 'Press to cut with this section (other sections in the same group turn off)',
        ja: '押すとこの断面で切断します(同じグループの他の断面はオフ)',
        'zh-CN': '按下用此剖面剖切(同一组中的其他剖面将关闭)',
        de: 'Drücken, um mit diesem Schnitt zu schneiden (andere Schnitte derselben Gruppe werden ausgeschaltet)',
      }],
      ['누르면 이 단면을 끕니다', { en: 'Press to turn this section off', ja: '押すとこの断面をオフにします', 'zh-CN': '按下关闭此剖面', de: 'Drücken, um diesen Schnitt auszuschalten' }],
      ['뷰 큐브: 면·모서리·구석을 누르면 그 방향으로 봅니다', {
        en: 'View Cube: Select a face, edge, or corner to view in that direction.',
        ja: 'ビューキューブ: 面、エッジ、または角を選択すると、その方向からの表示に切り替わります。',
        'zh-CN': '视图立方体：选择面、边或角即可朝该方向查看',
        de: 'Ansichtswürfel: Wählen Sie eine Fläche, Kante oder Ecke aus, um in diese Richtung zu sehen.',
      }],
      ['3D 누르기', { en: 'Select in 3D', ja: '3Dで選択', 'zh-CN': '3D 选择', de: 'Auswählen in 3D' }],
      // 안내 두기 버튼 풀이: 3D를 가리키는 누름은 고르기 낱말, 버튼을 다시 누름(토글)은 press again·もう一度押す·再按一次·erneut drücken 그대로
      ['안내 두기: 누르기로 안내점·안내선 두기(다시 누르면 재기만)', {
        en: 'Place guides: selecting a point places guide points and guide lines (press again to only measure)',
        ja: 'ガイド配置: 選択してガイド点・ガイド線を置く（もう一度押すと計測のみ）',
        'zh-CN': '放置参考：选择位置放置参考点和参考线（再按一次只测量）',
        de: 'Hilfslinien setzen: Auswählen setzt Hilfspunkte und Hilfslinien (erneut drücken = nur messen)',
      }],
    ];
    for (const [key, values] of want)
      for (const l of LANGS) {
        expect(catalogs[l][key], `${l}: ${key}`).toBe(values[l]);
        expect(translate(key, l), `${l}: ${key}`).toBe(values[l]);
      }
    // 근거 줄: 같은 사전이 버튼·줄·토글의 기기를 가리지 않는 누름을 이 낱말로 부른다(212차 「눌러서 이 결과 복사」·「다시 누르면」, 두 번 누름은 구성 나무 안내·정의 줄 안내)
    const basis: [key: string, lang: Lang, has: string][] = [
      ['눌러서 이 결과 복사', 'en', 'Press to copy this result'],
      ['눌러서 이 결과 복사', 'ja', '押してこの結果をコピー'],
      ['눌러서 이 결과 복사', 'zh-CN', '按下复制此结果'],
      ['줄자: 다시 누르면 새로 잽니다 · Esc 지우기', 'de', 'Erneut drücken'],
      ['› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.', 'en', 'double-press to zoom'],
      ['› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.', 'de', 'zum Zoomen zweimal drücken'],
      ['줄을 누르면 그 정의의 인스턴스를 모두 고르고, 두 번 누르면 그것들에 맞춰 봅니다.', 'ja', '2回押すと'],
      ['줄을 누르면 그 정의의 인스턴스를 모두 고르고, 두 번 누르면 그것들에 맞춰 봅니다.', 'zh-CN', '按两次'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang][key], `${lang}: ${key}`).toContain(has);
  });

  // 213차 리드 검토: 「누르기」 낱말은 버튼·줄·손잡이·토글(「다시 누르면」)에 두고, 3D에서 자리·대상(점·중심점·끝점·면·모서리)을 가리키는 누름은
  // 같은 사전의 고르기 낱말로(영어 press a point·Press in 3D가 어색) — 두 번 누름(Double-press 등)과 「누른 면」 꼴 꾸밈(고르기 낱말이면 「고른 면만 고르기」로 겹침)은 그대로
  it('자리 가리키기: 3D에서 점·중심점·끝점·면·모서리를 가리키는 누름은 네 언어 모두 같은 사전의 고르기 낱말(기기 낱말 없음)', () => {
    // 고르기 낱말 — 사전에서 셈(고르기 원문(고르·고른·고를·골라) 열쇠 값: en select 41·pick 0, de auswählen 25·wählen 14, ja 選択 28·選ぶ 23, zh 选择 37·选取 0)
    const SELECT: Record<Lang, RegExp> = { en: /\bselect/i, ja: /選択/, 'zh-CN': /选择/, de: /wähl/i };
    const POINT = [
      '3D 누르기',
      '3D나 구성 목록에서 그룹·컴포넌트·재질을 고르면 그 정보를 보입니다. "면·모서리"로 누르면 면 하나의 넓이·모서리 하나의 길이를 봅니다.',
      '각도기: 기준 방향의 점을 누르세요 · Esc 취소', '각도기: 안내선을 둘 방향의 점을 누르세요 · 각도를 치면 그 각도에 · Esc 취소',
      '각도기: 잴 방향의 점을 누르세요 · 각도를 치면 안내선 · Esc 취소', '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정',
      '먼저 시작점을 누르세요', '먼저 중심점과 기준 방향을 누르세요', '뷰 큐브: 면·모서리·구석을 누르면 그 방향으로 봅니다',
      '안내 두기 켬: 누르면 안내점·안내선을 둡니다', '안내 두기: 누르기로 안내점·안내선 두기(다시 누르면 재기만)',
      '줄자: 끝점을 누르세요 · 길이를 치면 모서리와 나란한 안내선 · Esc 취소', '줄자: 끝점을 누르세요 · 길이를 치면 안내점 · Esc 취소',
      '줄자: 모서리와 나란한 안내선을 둘 곳을 누르세요 · 길이를 치면 그 거리에 · Esc 취소', '줄자: 안내를 둘 시작점을 누르세요 · 모서리 위면 나란한 안내선, 점이면 안내점',
      '줄자: 안내점을 둘 곳을 누르세요 · 길이를 치면 그 거리에 · Esc 취소', '줄자: 잴 시작점을 누르세요 · 모서리를 두 번 누르면 그 위에 안내선',
      '측정: 점을 누르세요', '측정: 점을 누르세요 · Esc = 지우기, 한 번 더 = 끄기',
    ];
    for (const k of POINT)
      for (const l of LANGS) {
        expect(catalogs[l][k], `${l}: ${k}`).toMatch(SELECT[l]);
        expect(catalogs[l][k], `${l}: ${k}`).not.toMatch(DEVICE[l]);
      }
    // 쓰는 곳: 측정 안내 마우스·키보드 갈래 12 가운데 「다시 누르면 새로 잽니다」 둘(다시 누름 — press again 그대로) 밖은 모두 자리 가리키기
    const fine = new Set<string>();
    for (const mode of ['tape', 'protractor'] as const)
      for (const n of [0, 1, 2]) for (const has of [false, true]) for (const edge of [false, true]) for (const guide of [false, true]) fine.add(measureHint(mode, n, has, false, edge, guide)!);
    expect([...fine].filter((k) => !POINT.includes(k)).sort()).toEqual(['각도기: 다시 누르면 새로 잽니다 · Esc 지우기', '줄자: 다시 누르면 새로 잽니다 · Esc 지우기']);
    // 근거 줄: 같은 사전이 3D에서 고르는 일을 이 낱말로 부른다
    const PANEL = '3D나 구성 목록에서 그룹·컴포넌트·재질을 고르면 그 정보를 보입니다. "면·모서리"로 누르면 면 하나의 넓이·모서리 하나의 길이를 봅니다.';
    const basis: [key: string, lang: Lang, has: string][] = [
      [PANEL, 'en', 'Select a group·component·material in 3D'],
      [PANEL, 'ja', 'マテリアルを選択すると'],
      [PANEL, 'zh-CN', '在 3D 或结构列表中选择'],
      ['3D에서 누를 때 고르는 것', 'de', 'in 3D auswählt'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang][key], `${lang}: ${key}`).toContain(has);
  });

  // 214차: 213차가 독일어 40곳 한도로 남긴 여덟을 213차 근거 낱말로 — 버튼·키·토글·손잡이(장면 카드·장면 재생을 멈추는 3D 누름·패널 가장자리 두 번 누름)는 누르기,
  // 3D에서 대상을 가리키는 누름(깊은 단계 고르기·안내 고르기·안내를 두는 점)은 고르기 낱말(문장 동사가 이미 「고르다」면 누름 낱말만 뺌 — 「눌러 고를 수 없음」 → 「고를 수 없음」).
  // 「그 안을 누르면 …항목을 고릅니다」는 같은 구성 탭 풀이의 「› 버튼으로 펼치면 3D에서 누를 때도 …」(when you press in 3D)와 같은 누르기(고르기 낱말이면 「고르면 고릅니다」로 겹침)
  it('214차: 213차가 남긴 여덟(아주 큰 모형 알림 셋·바로 가기 안내 창 줄 둘·장면 재생·장면 카드·정보 탭 패널 가장자리 줄)은 네 언어 모두 213차 근거 낱말이고 기기 낱말이 없다', () => {
    const want: [key: string, values: Record<Lang, string>][] = [
      [LEFT[0]!, {
        en: 'There are too many groups/components to select deep levels in 3D (you can select them from a list)',
        ja: 'グループ・コンポーネントが多すぎるため、深い階層の要素は3Dビュー上で選択できません（リストからは選択可能です）',
        'zh-CN': '组/组件过多，无法在 3D 中选择深层级（可在列表中选择）。',
        de: 'Es gibt zu viele Gruppen/Komponenten, um tiefe Ebenen in 3D auszuwählen (Sie können sie aus einer Liste auswählen)',
      }],
      [LEFT[1]!, {
        en: 'Because there are many nodes, levels from {0} on are not listed (pressing inside selects the level-{1} item).',
        ja: 'ノードが多いため、{0}段階以降はリストに含めていません（その箇所を押すと、{1}段階の項目が選択されます）。',
        'zh-CN': '由于节点数量庞大，列表中未包含从 {0} 开始的层级（在其中按下将选中 {1} 层级的项目）。',
        de: 'Wegen vieler Knoten sind Ebenen ab {0} nicht in der Liste (ein Drücken darin wählt das Element der Ebene {1}).',
      }],
      [LEFT[2]!, {
        en: 'There are too many items to select by drilling down in 3D.',
        ja: '要素が多すぎるため、3Dの深い階層から選択することはできません。',
        'zh-CN': '项目过多，无法在 3D 中选择深层级。',
        de: 'Zu viele Elemente, um tiefe Ebenen in 3D auszuwählen.',
      }],
      [LEFT[3]!, {
        en: 'Delete the selected guide points and guide lines (together if there are several; also while Tape Measure and Protractor are off)',
        ja: '選択したガイド点・ガイド線を消去（複数ならまとめて、メジャー・分度器がオフのときも）',
        'zh-CN': '删除选中的参考点和参考线（多个时一起删除，卷尺·量角器关闭时也可以）',
        de: 'Die ausgewählten Hilfspunkte und Hilfslinien löschen (mehrere gemeinsam, auch wenn Maßband und Winkelmesser aus sind)',
      }],
      [LEFT[4]!, {
        en: 'Tape Measure and Protractor: turn guide placing on or off (press and release that key alone; Option on Mac) — selecting the second Tape Measure point or third Protractor point places a guide point or guide line',
        ja: 'メジャー・分度器: ガイド配置のオン・オフ（そのキーだけを押して離す、MacはOption）— メジャーの2回目・分度器の3回目の選択でガイド点・ガイド線',
        'zh-CN': '卷尺·量角器：开启或关闭放置参考（单独按下并松开该键，Mac 为 Option）— 卷尺第二次、量角器第三次选择位置即放置参考点或参考线',
        de: 'Maßband und Winkelmesser: Hilfslinien setzen ein/aus (nur diese Taste drücken und loslassen, am Mac Option) — das zweite Maßband- bzw. dritte Winkelmesser-Auswählen setzt einen Hilfspunkt oder eine Hilfslinie',
      }],
      [LEFT[5]!, {
        en: 'Play scenes: steps through the scenes after each transition and delay time (stops when you press in the 3D view or choose a scene)',
        ja: 'シーンを再生: 切り替え時間と待機時間ごとに順にシーンを進めます（3Dを押すかシーンを選ぶと停止）',
        'zh-CN': '播放场景：按过渡时间和延迟时间依次切换场景（按下 3D 视图或选择场景时停止）',
        de: 'Szenen abspielen: wechselt nach Übergangs- und Verzögerungszeit zur nächsten Szene (stoppt beim Drücken in der 3D-Ansicht oder bei Szenenwahl)',
      }],
      [LEFT[6]!, {
        en: 'Press to switch to that scene (whatever the scene remembers among camera, hidden tags, hidden objects, sections, style, shadows and drawing axes). PageUp and PageDown also switch scenes.',
        ja: '押すとそのシーンに切り替わります（カメラ、非表示タグ、非表示オブジェクト、断面、スタイル、影、描画軸など、シーンに記録されている情報が反映されます）。PageUpキーやPageDownキーでも切り替え可能です。',
        'zh-CN': '按下切换到该场景（场景记住的相机、隐藏标签、隐藏对象、剖面、样式、阴影、绘图轴）。也可以用 PageUp·PageDown 切换。',
        de: 'Drücken, um zu dieser Szene zu wechseln (was die Szene speichert: Kamera, ausgeblendete Tags, ausgeblendete Objekte, Schnitte, Stil, Schatten, Zeichenachsen). Auch PageUp und PageDown wechseln die Szene.',
      }],
      [LEFT[7]!, {
        en: 'Drag the edge of the panel to change its width (or height, on narrow screens). Double-press to reset to original size',
        ja: 'パネルの端をドラッグすると、幅（画面が狭い場合は高さ）が変更されます。2回押すと元のサイズに',
        'zh-CN': '拖动面板边缘可更改宽度（窄屏幕上可更改高度）。按两次恢复原尺寸',
        de: 'Ziehen Sie am Rand des Bedienfelds, um die Breite (bzw. Höhe auf schmalen Bildschirmen) zu ändern. Zweimal drücken, um zur Originalgröße zurückzukehren',
      }],
    ];
    expect(want.map(([k]) => k)).toEqual(LEFT);
    for (const [key, values] of want)
      for (const l of LANGS) {
        expect(catalogs[l][key], `${l}: ${key}`).toBe(values[l]);
        expect(values[l], `${l}: ${key}`).not.toMatch(DEVICE[l]);
        expect(sourceMessage(values[l]), values[l]).toBe(key);
      }
    // 쓰는 곳(원문 그대로 — 사전만): 해석기 경고·구성 탭 풀이 둘·바로 가기 안내 둘·장면 재생 버튼·정보 탭 장면 카드·조작 줄
    const src = ['src/scene.ts', 'src/app/panel.ts', 'src/app/shortcuts.ts', 'src/app/app.ts', 'src/app/infotab.ts'].map((f) => readFileSync(resolve(__dirname, '..', f), 'utf8')).join('\n');
    for (const k of LEFT) expect(src.includes(k.replace('{0}단계', '${t.listedDepth + 1}단계').replace('{1}단계', '${t.listedDepth}단계')), k).toBe(true);
    // 근거 줄(같은 사전): 누르기 — 단면 줄·패널 크기 손잡이·같은 구성 탭 풀이, 고르기 — 안내 두기 켬
    const PANEL_NOTE = '› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.';
    const basis: [key: string, lang: Lang, has: string][] = [
      ['누르면 이 단면을 끕니다', 'en', 'Press to '],
      ['누르면 이 단면을 끕니다', 'ja', '押すと'],
      ['누르면 이 단면을 끕니다', 'zh-CN', '按下'],
      ['누르면 이 단면을 끕니다', 'de', 'Drücken, um '],
      ['끌거나 눌러서 패널 크기 바꾸기 · 두 번 누르면 처음 크기', 'en', 'Double-press'],
      ['끌거나 눌러서 패널 크기 바꾸기 · 두 번 누르면 처음 크기', 'ja', '2回押すと'],
      ['끌거나 눌러서 패널 크기 바꾸기 · 두 번 누르면 처음 크기', 'zh-CN', '按两次'],
      ['끌거나 눌러서 패널 크기 바꾸기 · 두 번 누르면 처음 크기', 'de', 'Zweimal drücken'],
      [PANEL_NOTE, 'en', 'when you press in 3D'],
      [PANEL_NOTE, 'de', 'wenn Sie in 3D darauf drücken'],
      ['안내 두기 켬: 누르면 안내점·안내선을 둡니다', 'en', 'selecting a point places'],
      ['안내 두기 켬: 누르면 안내점·안내선을 둡니다', 'zh-CN', '选择位置即放置'],
      ['안내 두기 켬: 누르면 안내점·안내선을 둡니다', 'de', 'Auswählen setzt'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang][key], `${lang}: ${key}`).toContain(has);
  });

  // 215차: 중국어 「노드가 많아 …(그 안을 누르면 {1}단계 항목을 고릅니다)」가 「그 안」(목록에 넣지 않은 깊은 단계 — 3D에서 그 안을 누름)을 목록 줄 列表项으로,
  // 「{1}단계 항목」을 단계(层级)로만 옮겼다 — 같은 구성 탭 풀이 「› 버튼으로 펼치면 … 그 안의 항목을 고릅니다」의 其中的项目(그 안·항목) 낱말로(누르기 낱말 按下는 214차 그대로)
  it('215차: 중국어 「노드가 많아 …」의 「그 안」은 같은 구성 탭 풀이의 其中, 「항목」은 项目이고 목록 줄 낱말이 없다', () => {
    const key = LEFT[1]!;
    const zh = catalogs['zh-CN'][key];
    expect(zh).toBe('由于节点数量庞大，列表中未包含从 {0} 开始的层级（在其中按下将选中 {1} 层级的项目）。');
    expect(zh).not.toContain('列表项');
    expect(zh).not.toMatch(DEVICE['zh-CN']);
    expect(Object.values(catalogs['zh-CN']).filter((v) => v === zh)).toHaveLength(1);
    expect(sourceMessage(zh)).toBe(key);
    // 근거 줄: 같은 구성 탭 풀이(그 안의 항목 — 其中的项目)·누르기
    expect(catalogs['zh-CN']['› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.']).toContain('其中的项目');
    expect(catalogs['zh-CN']['누르면 이 단면을 끕니다']).toContain('按下');
    // 다른 세 언어는 「그 안」 뜻 그대로(214차 값)
    expect(catalogs.en[key]).toContain('pressing inside');
    expect(catalogs.ja[key]).toContain('その箇所を押すと');
    expect(catalogs.de[key]).toContain('ein Drücken darin');
  });
});
