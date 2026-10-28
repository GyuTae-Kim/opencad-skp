import { metadataForLanguage } from '../site/i18n.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { installLocalization } from '../src/app/i18n';
import { guideKeyHint, lockHint, measureHint } from '../src/app/measure';
import { SHORTCUTS } from '../src/app/shortcuts';
import { chunkFailText } from '../src/app/core';
import { catalogs, currentLanguage, languageUrl, languages, translate } from '../site/i18n.mjs';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });
describe('language URLs and UI presentation', () => {
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
      '고른 안내점 지우기', '고른 안내선 지우기', '고른 안내점 지우기 (Delete)', '고른 안내선 지우기 (Delete)']) texts.add(t);
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
      '잠글 방향이 없습니다: 길게 눌러 조준하며 축·나란한 방향에 맞춘 뒤 누르세요', '잠글 방향이 없습니다: 커서를 축·나란한 방향에 맞춘 뒤 누르세요',
      '줄자 (T): 두 점 거리 — 끝점·중간점·모서리·면에 붙고, 축·모서리와 나란한 방향이면 그 선에 고정(Shift·화살표로 잠금) · Esc 지우기',
      '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정·방향 잠금) · Esc 지우기']) texts.add(t);
    texts.delete('');
    for (const {code} of languages.filter(item => item.code !== 'ko'))
      for (const t of texts) expect(translate(t, code), `${code}: ${t}`).not.toMatch(hangul);
    expect(translate('빨강 축에 · 잠금 · 60 mm', 'en')).toBe('On red axis · Locked · 60 mm');
    expect(translate('안내 5', 'en')).toBe('Guides 5');
    expect(translate('안내점 2', 'en')).toBe('Guide points 2');
    expect(translate('Option: 안내 두기', 'en')).toBe('Option: place guides');
    expect(translate('Ctrl: 안내 두기 끄기', 'de')).toBe('Ctrl: Hilfslinien nicht mehr setzen');
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
    const dom = new JSDOM(`<!doctype html><html><head><title>OpenCAD</title><meta property="og:image"><meta property="og:image:secure_url"><meta name="twitter:image"><script type="application/ld+json">{"@graph":[{"@type":"WebApplication"}]}</script></head><body><div id="app"><header class="titlebar"><button>열기</button></header><a id="brand" title="OpenCAD SketchUp 뷰어 처음 화면">OpenCAD</a><button id="theme" title="앱 설정 · 테마: 시스템 설정 따르기(지금 어두움) — 눌러서 바꾸기">Settings</button><div class="scene-tabs" aria-label="장면"><button title="열기">열기</button></div><span class="docname">열기.skp</span></div></body></html>`, {url:languageUrl(korean.url,'en')+'?sample#view'});
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
