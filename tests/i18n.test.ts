import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization, uiText } from '../src/app/i18n';
import { GUIDE_CLEAR_FILE_LABEL, GUIDE_DELETE_KEY_HINT, GUIDE_DELETE_TEXT, GUIDE_KIND_NAMES, GUIDE_REDO_LABEL, GUIDE_UNDO_LABEL, GUIDES_SHOWN_LABEL, LOCK_HINTS, LOCK_MENU_LABEL, guideKeyHint, lockHint, measureHint, trackHint } from '../src/app/measure';
import { GUIDE_HIDE_LABEL, GUIDE_HIDE_TEXT, GUIDE_SELECT_ALL_LABEL, GUIDE_SELECT_ALL_TEXT, GUIDE_UNHIDE_LABEL, guideCountText, guideDeleteLabel } from '../src/app/measure';
import { AXIS_LABELS, FACE_PERPENDICULAR_LABEL, GUIDE_LINE_LABEL, SNAP_LABELS, TRACK_ALIGN_LABEL, TRACK_AXIS_LABELS, TRACK_PAIR_LABELS } from '../src/app/snap';
import { SHORTCUTS } from '../src/app/shortcuts';
import { chunkFailText } from '../src/app/core';
import { CONTEXT_LOST_TEXT, CONTEXT_LOST_TITLE, RESTORE_FAIL_TEXT, RESTORE_FAIL_TITLE, RESTORE_TEXT, RESTORE_TITLE } from '../src/app/release';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';

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
    expect(translate('그룹 3 · 컴포넌트 5 · 그림 3(모든 단계, 4단계까지).', 'en')).toBe('Group 3 · Component 5 · Picture 3 (all steps, up to step 4).');
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
      // 22차 한 손 잠금: 측정 띠 위 잠글 방향 고르기 줄(이름과 단추 — 단추 글은 잠금 안내와 같다)
      LOCK_MENU_LABEL, ...Object.values(LOCK_HINTS),
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

});
