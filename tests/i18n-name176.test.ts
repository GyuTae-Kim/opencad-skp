/**
 * 176차: 제목 막대·도구 막대 버튼(class tbtn — 175차가 「전체 보기」 하나를 고친 꼴)의 화면 읽기 이름(title·aria-label 열쇠)이
 * 번역에서 보이는 글(보이는 글 열쇠)을 품지 않던 것(WCAG 2.5.3 이름 안의 이름표, 3.2.4 같은 버튼의 풍선·이름이 다른 낱말):
 * ja 원근 遠近法 ↔ 遠近投影, ja 격자 格子 ↔ 床グリッド (F7), de 원근 Perspektive ↔ Perspektivische Projektion,
 * de 격자 Raster ↔ Bodengitter (F7), de 패널 Bedienfeld ↔ Panel öffnen/schließen, de 표준 뷰 Standardansichten ↔ Menü der Standardansicht,
 * de OpenCAD 도구 OpenCAD-Tools ↔ OpenCAD-Werkzeugliste (neues Fenster).
 * 이름 열쇠 값에 같은 사전의 보이는 글 값을 넣었다(원문·코드 그대로 — README 개발 절 176차 문단). 처음 화면 키 줄·정보 탭 조작 줄
 * (통째 열쇠)의 「F 전체 보기」 낱말도 버튼의 보이는 글 값으로 맞췄다(en View all, ja 全体表示, zh 查看全部).
 * 판정은 대소문자·붙임표(-)·띄어쓰기를 가리지 않는다(175차 표와 같은 셈 — 음성 조작은 붙임표를 낱말 사이로 듣는다).
 * 204차: 바로 가기 안내 F7 줄(ja 床グリッドの表示切替)만 남은 グリッド를 같은 기능 값 넷의 格子로(床の格子の表示切替).
 * 205차: 같은 줄의 영어 ground·중국어 地面·독일어 붙은 말 Bodenraster를 버튼 이름 낱말로(floor·地板·Raster am Boden).
 * 206차: 표준 뷰 일곱(1~7)의 바로 가기 안내 줄·버튼 풍선·정보 탭 조작 줄 낱말을 메뉴 항목 낱말로(중국어 위·아래 上·下,
 * 독일어 앞·뒤·등각 Vorne·Hinten·Isometrie, 일본어 등각 アイソメ — 메뉴 항목은 뷰 큐브 면 글과 같은 열쇠라 그대로).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VIEW_KEYS, VIEW_LABELS } from 'opencad-viewer3d/viewkeys';
import { CUBE_FACES } from 'opencad-viewer3d/viewcube';
import { describe, expect, it } from 'vitest';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
type Lang = (typeof LANGS)[number];

const app = readFileSync(resolve(__dirname, '../src/app/app.ts'), 'utf8');
const infotab = readFileSync(resolve(__dirname, '../src/app/infotab.ts'), 'utf8');

const norm = (s: string): string => s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

/** 글이 보이는 제목 막대·도구 막대 버튼의 [보이는 글, 화면 읽기 이름](icon-only·narrow-only 버튼은 글이 늘 숨어 뺀다) */
function shownButtons(): [label: string, name: string][] {
  const out: [string, string][] = [];
  // 한 줄 tbtn('보이는 글', '아이콘', 'title', 할 일, 클래스?, true?) — 이름은 끝 true면 보이는 글, 아니면 title(173차 a11y 시험과 같은 읽기)
  for (const m of app.matchAll(/tbtn\('([^']*)', '[^']*', '([^']*)', (.*)$/gm)) {
    const tail = /(?:, '([^']*)')?(?:, (true))?\)[\],;]*$/.exec(m[3]!);
    if ((tail?.[1] ?? '').split(' ').includes('icon-only')) continue;
    out.push([m[1]!, tail?.[2] === 'true' ? m[1]! : m[2]!]);
  }
  // 제목 막대 링크 link('보이는 글', '아이콘', 주소, 'title') — 이름은 title
  for (const m of app.matchAll(/link\('([^']*)', '[^']*', [A-Z_]+, '([^']*)'\)/g)) out.push([m[1]!, m[2]!]);
  // 표준 뷰 메뉴 버튼(보이는 글과 이름을 따로 적음)
  expect(app).toContain("'aria-label': '표준 뷰 메뉴',");
  expect(app).toContain('<span class="lbl">표준 뷰</span>${icon(\'chevron\', 14)}');
  out.push(['표준 뷰', '표준 뷰 메뉴']);
  // 그리기 방식 일곱(이름은 「그리기: 그 이름」 통째 열쇠)
  expect(app).toContain('tbtn(label, ico, `그리기: ${label}`');
  const modes = /const RENDER_MODES[^=]*= \[([\s\S]*?)\n\];/.exec(app)![1]!;
  for (const m of modes.matchAll(/\['\w+', '([^']*)', '\w+'\]/g)) out.push([m[1]!, `그리기: ${m[1]}`]);
  // 단면 축 버튼(보이는 글 X·Y·Z, 이름은 틀 「{0}축 단면」)
  expect(app).toContain("'aria-label': `${axis.toUpperCase()}축 단면` }, axis.toUpperCase())");
  for (const axis of ['X', 'Y', 'Z']) out.push([axis, `${axis}축 단면`]);
  // 보기 설정(menuBtn — 넓은 화면에서도 보이게 narrow-only를 뺀다. 단면 메뉴 버튼은 narrow-only라 글이 늘 숨음)
  const more = /const moreBtn = menuBtn\('([^']*)', '[^']*', '([^']*)'\);\n\s*moreBtn\.classList\.remove\('narrow-only'\)/.exec(app);
  out.push([more![1]!, more![2]!]);
  return out;
}

const START = '왼쪽 끌기 돌리기 · 오른쪽 끌기 옮기기 · 휠 확대 · F 전체 보기 · 1~7 표준 뷰 · F7 격자';
const INFO = 'F: 전체 보기 · 1~7: 앞·뒤·왼쪽·오른쪽·위·아래·등각 · F7: 격자 · Ctrl/⌘+O: 열기';

describe('제목 막대·도구 막대 버튼의 이름이 다섯 언어 모두 보이는 글을 품는다(176차)', () => {
  it('글이 보이는 버튼 27개는 다섯 언어 모두 화면 읽기 이름(title·aria-label)이 보이는 글을 품는다', () => {
    const buttons = shownButtons();
    expect(buttons.length).toBe(27);
    const miss: string[] = [];
    for (const [label, name] of buttons)
      for (const lang of ['ko', ...LANGS]) {
        const shown = translate(label, lang);
        const named = translate(name, lang);
        if (!norm(named).includes(norm(shown))) miss.push(`${lang} ${label}: ${shown} ↔ ${named}`);
      }
    expect(miss).toEqual([]);
  });

  it('고친 이름 값은 같은 사전의 보이는 글 값을 품고 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로 돌아오며, 통째 열쇠의 F 줄도 같은 낱말이다', () => {
    // [이름 열쇠, 언어, 고친 값, 근거 열쇠(그 버튼의 보이는 글)]
    const fixed: [key: string, lang: Lang, value: string, basis: string][] = [
      ['원근 투영', 'ja', '遠近法投影', '원근'],
      ['원근 투영', 'de', 'Perspektive (Projektion)', '원근'],
      ['바닥 격자 (F7)', 'ja', '床の格子 (F7)', '격자'],
      ['바닥 격자 (F7)', 'de', 'Raster am Boden (F7)', '격자'],
      ['패널 열기·닫기', 'de', 'Bedienfeld öffnen/schließen', '패널'],
      ['표준 뷰 메뉴', 'de', 'Standardansichten-Menü', '표준 뷰'],
      ['OpenCAD 도구 목록(새 창)', 'de', 'OpenCAD-Tools-Liste (neues Fenster)', 'OpenCAD 도구'],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [key, lang, value, basis] of fixed) {
      expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
      expect(norm(value), `${lang}: ${key} 근거 ${basis}`).toContain(norm(catalogs[lang]![basis]!));
      expect(all.filter((v) => v === value).length, `${lang}: ${value}`).toBe(1);
      expect(sourceMessage(value), `${lang}: ${value}`).toBe(key);
    }
    // 처음 화면 키 줄(app.ts)·정보 탭 조작 줄(infotab.ts) — 통째 열쇠라 F 줄의 낱말만 바꿨다
    expect(app).toContain(`'${START}'`);
    expect(infotab).toContain(`'${INFO}'`);
    const segments: [key: string, lang: Lang, has: string][] = [
      // 처음 화면 키 줄은 F 줄부터 끝까지(뒤 두 줄의 띄어쓰기 · 낱말이 그대로인지 함께)
      // F7 줄은 181차에 버튼의 보이는 글 格子로(아래 181차 시험)
      [START, 'ja', ' · F：全体を表示 · 1～7：標準ビュー · F7：格子'],
      [START, 'zh-CN', ' · F 适合窗口 · 1~7 标准视图 · F7 网格'],
      [INFO, 'en', 'F: Fit to view · '],
      [INFO, 'ja', 'F：全体を表示・'],
      [INFO, 'zh-CN', 'F：适合窗口 · '],
    ];
    for (const [key, lang, has] of segments) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    for (const key of [START, INFO])
      for (const lang of LANGS) {
        const value = catalogs[lang]![key]!;
        expect(norm(value), `${lang}: ${key}`).toContain(norm(catalogs[lang]!['전체 보기']!));
        expect(value, `${lang}: ${key}`).not.toMatch(/View all|全体表示|查看全部/);
        expect(all.filter((v) => v === value).length, `${lang}: ${key}`).toBe(1);
        expect(sourceMessage(value), `${lang}: ${key}`).toBe(key);
      }
  });

  it('181차: 이름이 아닌 풀이(title)·통째 열쇠의 낱말도 그 버튼의 보이는 글 값 낱말 — 독일어 표준 뷰 풀이·영어 예제 열기 풀이·일본어 처음 화면 키 줄 F7 줄(3.2.4)', () => {
    const VIEWS = '표준 뷰 (1 앞 · 2 뒤 · 3 왼쪽 · 4 오른쪽 · 5 위 · 6 아래 · 7 등각)';
    const SAMPLE = '예제 모형 열기(브라우저에서 만든 집 모형)';
    // 쓰는 자리: 표준 뷰 버튼 title(보이는 글 「표준 뷰」), 예제 열기 버튼 title(보이는 글 「예제 열기」 — 이름은 보이는 글), 처음 화면 키 줄(도구 막대 「격자」 버튼)
    expect(app).toContain(`title: '${VIEWS}',`);
    expect(app).toContain(`tbtn('예제 열기', 'sample', '${SAMPLE}', `);
    expect(app).toContain("tbtn('격자', 'grid', '바닥 격자 (F7)', ");
    // [열쇠, 언어, 고친 값, 근거 열쇠(그 버튼의 보이는 글), 옛 낱말]
    const fixed: [key: string, lang: Lang, value: string, basis: string, old: RegExp][] = [
      // 독일어 표준 뷰 풀이는 206차에 앞·뒤·등각 낱말도 메뉴 항목 낱말로 맞췄다(아래 206차 시험)
      [VIEWS, 'de', 'Standardansichten (1 Vorne · 2 Hinten · 3 Links · 4 Rechts · 5 Oben · 6 Unten · 7 Isometrie)', '표준 뷰', /Standardansicht\b/],
      [SAMPLE, 'en', 'Open sample model (house model created in the browser)', '예제 열기', /example/i],
      [START, 'ja', '左ドラッグ：回転 · 右ドラッグ：移動 · ホイール：拡大 · F：全体を表示 · 1～7：標準ビュー · F7：格子', '격자', /グリッド/],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [key, lang, value, basis, old] of fixed) {
      expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
      expect(norm(translate(key, lang)), `${lang}: ${key} 근거 ${basis}`).toContain(norm(translate(basis, lang)));
      expect(value, `${lang}: ${key}`).not.toMatch(old);
      expect(all.filter((v) => v === value).length, `${lang}: ${value}`).toBe(1);
      expect(sourceMessage(value), `${lang}: ${value}`).toBe(key);
    }
    expect(catalogs.ja!['격자']).toBe('格子');
  });

  it('204차: 바닥 격자(F7)를 부르는 일본어 값 다섯은 모두 같은 낱말 格子 — 바로 가기 안내 F7 줄도 버튼 이름 「床の格子」(3.2.4·2.5.3)', () => {
    const shortcuts = readFileSync(resolve(__dirname, '../src/app/shortcuts.ts'), 'utf8');
    const TOGGLE = '바닥 격자 켜고 끄기';
    // 쓰는 자리: 바로 가기 안내 F7 줄, 도구 막대 「격자」 버튼(보이는 글·이름)과 휴대폰 보기 설정 메뉴 항목, 처음 화면 키 줄, 정보 탭 조작 줄
    expect(shortcuts).toContain(`{ keys: ['F7'], label: '${TOGGLE}' }`);
    expect(app).toContain("tbtn('격자', 'grid', '바닥 격자 (F7)', ");
    expect(app).toContain("{ label: '격자', checked: this.gridOn, ");
    expect(app).toContain(`'${START}'`);
    expect(infotab).toContain(`'${INFO}'`);
    const keys = ['격자', '바닥 격자 (F7)', TOGGLE, START, INFO].sort();
    // 일본어 사전에서 격자를 부르는 열쇠·값은 이 다섯뿐(다른 격자 기능은 없음)이고 모두 格子 — グリッド는 사전에 남지 않는다
    const ja = catalogs.ja!;
    expect(Object.keys(ja).filter((k) => k.includes('격자')).sort()).toEqual(keys);
    expect(Object.entries(ja).filter(([, v]) => /格子|グリッド/.test(v)).map(([k]) => k).sort()).toEqual(keys);
    for (const k of keys) expect(ja[k], k).toContain('格子');
    expect(Object.values(ja).filter((v) => v.includes('グリッド'))).toEqual([]);
    // 고친 값: 버튼 이름 床の格子 (F7)의 낱말 그대로 — 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로
    const value = '床の格子の表示切替';
    expect(ja[TOGGLE]).toBe(value);
    expect(value).toContain(ja['바닥 격자 (F7)']!.replace(' (F7)', ''));
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    expect(all.filter((v) => v === value).length).toBe(1);
    expect(sourceMessage(value)).toBe(TOGGLE);
    // 다른 언어는 205차에 같은 꼴로 맞췄다(아래 205차 시험)
    expect(LANGS.filter((lang) => lang !== 'ja').map((lang) => catalogs[lang]![TOGGLE])).toEqual(['Toggle floor grid', '显示或隐藏地板网格', 'Raster am Boden ein/aus']);
  });

  it('205차: 바닥 격자(F7)를 부르는 값 다섯은 네 언어 모두 보이는 글을 품고, 바로 가기 안내 F7 줄은 버튼 이름 낱말을 품는다 — 영어 floor·중국어 地板·독일어 Raster am Boden(3.2.4·2.5.3)', () => {
    const shortcuts = readFileSync(resolve(__dirname, '../src/app/shortcuts.ts'), 'utf8');
    const NAME = '바닥 격자 (F7)';
    const TOGGLE = '바닥 격자 켜고 끄기';
    // 쓰는 자리(204차와 같음): 도구 막대 「격자」 버튼(보이는 글·이름)·휴대폰 보기 설정 메뉴 항목, 바로 가기 안내 F7 줄, 처음 화면 키 줄, 정보 탭 조작 줄
    expect(app).toContain(`tbtn('격자', 'grid', '${NAME}', `);
    expect(app).toContain("{ label: '격자', checked: this.gridOn, ");
    expect(shortcuts).toContain(`{ keys: ['F7'], label: '${TOGGLE}' }`);
    expect(app).toContain(`'${START}'`);
    expect(infotab).toContain(`'${INFO}'`);
    const keys = ['격자', NAME, TOGGLE, START, INFO];
    for (const lang of LANGS) {
      const cat = catalogs[lang]!;
      expect(Object.keys(cat).filter((k) => k.includes('격자')).sort(), lang).toEqual([...keys].sort());
      // 다섯 값 모두 버튼의 보이는 글(격자)을 품고, 바로 가기 안내 줄은 버튼 이름(풍선 — 「 (F7)」을 뗀 값)을 품는다
      for (const k of keys) expect(norm(cat[k]!), `${lang}: ${k}`).toContain(norm(cat['격자']!));
      const name = cat[NAME]!.replace(' (F7)', '');
      expect(norm(cat[TOGGLE]!), `${lang}: ${TOGGLE}`).toContain(norm(name));
      // 그 버튼 이름 낱말을 품은 값은 이름과 바로 가기 안내 줄 둘뿐(다른 기능과 같은 이름이 아님)
      expect(Object.entries(cat).filter(([, v]) => norm(v).includes(norm(name))).map(([k]) => k).sort(), lang).toEqual([NAME, TOGGLE].sort());
    }
    // [언어, 고친 값, 옛 낱말] — 새 값은 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로
    const fixed: [lang: Lang, value: string, old: RegExp][] = [
      ['en', 'Toggle floor grid', /ground/i],
      ['zh-CN', '显示或隐藏地板网格', /地面/],
      ['de', 'Raster am Boden ein/aus', /Bodenraster/],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [lang, value, old] of fixed) {
      expect(catalogs[lang]![TOGGLE], lang).toBe(value);
      expect(value, lang).not.toMatch(old);
      expect(all.filter((v) => v === value).length, value).toBe(1);
      expect(sourceMessage(value), value).toBe(TOGGLE);
    }
    // 영어 ground·중국어 地面은 이제 지면(배경 버튼 풀이)·걷기 바닥 줄에만 — 바닥 격자와 겹치지 않는다
    for (const [lang, word] of [['en', /\bground\b/i], ['zh-CN', /地面/]] as const)
      for (const k of keys) expect(catalogs[lang]![k], `${lang}: ${k}`).not.toMatch(word);
    // 원문·일본어(204차)는 그대로
    expect(translate(TOGGLE, 'ko')).toBe(TOGGLE);
    expect(catalogs.ja![TOGGLE]).toBe('床の格子の表示切替');
  });

  it('206차: 표준 뷰 일곱(1~7)을 부르는 값은 네 언어 모두 메뉴 항목 낱말 — 바로 가기 안내 1~7 줄·표준 뷰 버튼 풍선·정보 탭 조작 줄(중국어 上·下, 독일어 Vorne·Hinten·Isometrie, 일본어 アイソメ — 3.2.4·2.5.3)', () => {
    const shortcuts = readFileSync(resolve(__dirname, '../src/app/shortcuts.ts'), 'utf8');
    const VIEWS = '표준 뷰 (1 앞 · 2 뒤 · 3 왼쪽 · 4 오른쪽 · 5 위 · 6 아래 · 7 등각)';
    const KEYS = '앞 · 뒤 · 왼쪽 · 오른쪽 · 위 · 아래 · 남동 등각';
    // 쓰는 자리: 표준 뷰 메뉴 항목(코어 VIEW_LABELS), 표준 뷰 버튼 풍선, 바로 가기 안내 1~7 줄, 정보 탭 조작 줄
    expect(app).toContain('{ label: VIEW_LABELS[v], run: () => this.setView(v) }');
    expect(app).toContain(`title: '${VIEWS}',`);
    expect(shortcuts).toContain(`{ keys: ['1', '2', '3', '4', '5', '6', '7'], label: '${KEYS}' }`);
    expect(infotab).toContain(`'${INFO}'`);
    // 키 1~7의 메뉴 항목 원문 — 뷰 큐브 면 글(그림 안 글)도 같은 열쇠라 메뉴 항목 값은 바꾸지 않는다
    const menu = ['1', '2', '3', '4', '5', '6', '7'].map((k) => VIEW_LABELS[VIEW_KEYS[k]!]);
    expect(menu).toEqual(['앞', '뒤', '왼쪽', '오른쪽', '위', '아래', '남동 등각']);
    expect(KEYS.split(' · ')).toEqual(menu);
    for (const face of CUBE_FACES) expect(face.label, face.name).toBe(VIEW_LABELS[face.name]);
    const miss: string[] = [];
    for (const lang of LANGS) {
      const cat = catalogs[lang]!;
      const names = menu.map((k) => norm(cat[k]!));
      const keys = cat[KEYS]!.split(' · ').map(norm);
      // 풀이는 「(1 앞 · … · 7 등각)」, 정보 탭은 「1~7: 앞·…·등각 · F7」 꼴(괄호·쌍점·물결·나눔표는 언어마다 반각·전각)
      const title = [...cat[VIEWS]!.matchAll(/(\d) ([^·()（）]+?)\s*(?=·|\)|）)/g)].map((m) => norm(m[2]!));
      const info = /1[~〜～]7[:：]\s*(.+?)\s*[·・]\s*F7/.exec(cat[INFO]!)![1]!.split(/[,、・]\s*/).map(norm);
      expect([keys.length, title.length, info.length], lang).toEqual([7, 7, 7]);
      const iso = info[6]!; // 방위 없는 「등각」 한 낱말
      names.forEach((name, i) => {
        if (keys[i] !== name) miss.push(`${lang} 안내 줄 ${i + 1}: ${keys[i]} ↔ 메뉴 ${name}`);
        // 짧은 글(메뉴 항목)이 풀이 긴 이름의 앞 낱말 — 7은 방위를 뺀 등각 낱말
        if (!title[i]!.startsWith(i < 6 ? name : iso)) miss.push(`${lang} 풀이 ${i + 1}: ${title[i]} ↔ 메뉴 ${name}`);
        if (i < 6 ? info[i] !== name : !name.includes(iso)) miss.push(`${lang} 정보 탭 ${i + 1}: ${info[i]} ↔ 메뉴 ${name}`);
      });
    }
    expect(miss).toEqual([]);
    // [언어, 열쇠, 고친 값, 옛 낱말] — 새 값은 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로
    const fixed: [lang: Lang, key: string, value: string, old: RegExp][] = [
      ['zh-CN', KEYS, '前 · 后 · 左 · 右 · 上 · 下 · 东南等轴测', /顶|底/],
      ['zh-CN', VIEWS, '标准视图（1 前视图 · 2 后视图 · 3 左视图 · 4 右视图 · 5 上视图 · 6 下视图 · 7 等轴测图）', /俯|底/],
      ['de', VIEWS, 'Standardansichten (1 Vorne · 2 Hinten · 3 Links · 4 Rechts · 5 Oben · 6 Unten · 7 Isometrie)', /Vorderansicht|Rückansicht|isometrisch/i],
      ['de', INFO, 'F: Gesamtansicht · 1~7: Vorne, hinten, links, rechts, oben, unten, Isometrie · F7: Raster · Strg/⌘+O: Öffnen', /isometrisch/i],
      ['ja', KEYS, '前 · 後 · 左 · 右 · 上 · 下 · 南東アイソメ', /等角/],
      ['ja', VIEWS, '標準ビュー（1 前 · 2 後 · 3 左 · 4 右 · 5 上 · 6 下 · 7 アイソメ）', /等角/],
      ['ja', INFO, 'F：全体を表示・1〜7：前・後・左・右・上・下・アイソメ・F7：格子・Ctrl/⌘+O：開く', /等角/],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [lang, key, value, old] of fixed) {
      expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
      expect(value, `${lang}: ${key}`).not.toMatch(old);
      expect(all.filter((v) => v === value).length, value).toBe(1);
      expect(sourceMessage(value), value).toBe(key);
    }
    // 옛 낱말은 사전에 남지 않는다(일본어 等角, 독일어 Vorderansicht·Rückansicht·isometrisch, 중국어 俯视图·底视图)
    expect(Object.values(catalogs.ja!).filter((v) => v.includes('等角'))).toEqual([]);
    expect(Object.values(catalogs.de!).filter((v) => /Vorderansicht|Rückansicht|isometrisch/i.test(v))).toEqual([]);
    expect(Object.values(catalogs['zh-CN']!).filter((v) => /俯视图|底视图/.test(v))).toEqual([]);
    // 메뉴 항목·뷰 큐브 면 값(짧은 열쇠)·영어·원문은 그대로
    expect(['위', '아래'].map((k) => catalogs['zh-CN']![k])).toEqual(['上', '下']);
    expect(['앞', '뒤', '남동 등각'].map((k) => catalogs.de![k])).toEqual(['Vorne', 'Hinten', 'SO-Isometrie']);
    expect(catalogs.ja!['남동 등각']).toBe('南東アイソメ');
    expect([KEYS, VIEWS].map((k) => catalogs.en![k])).toEqual(['Front · Back · Left · Right · Top · Bottom · SE isometric', 'Standard Views (1 Front · 2 Back · 3 Left · 4 Right · 5 Top · 6 Bottom · 7 Isometric)']);
    expect(translate(VIEWS, 'ko')).toBe(VIEWS);
  });
});
