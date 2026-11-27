/**
 * 176차: 제목 막대·도구 막대 버튼(class tbtn — 175차가 「전체 보기」 하나를 고친 꼴)의 화면 읽기 이름(title·aria-label 열쇠)이
 * 번역에서 보이는 글(보이는 글 열쇠)을 품지 않던 것(WCAG 2.5.3 이름 안의 이름표, 3.2.4 같은 버튼의 풍선·이름이 다른 낱말):
 * ja 원근 遠近法 ↔ 遠近投影, ja 격자 格子 ↔ 床グリッド (F7), de 원근 Perspektive ↔ Perspektivische Projektion,
 * de 격자 Raster ↔ Bodengitter (F7), de 패널 Bedienfeld ↔ Panel öffnen/schließen, de 표준 뷰 Standardansichten ↔ Menü der Standardansicht,
 * de OpenCAD 도구 OpenCAD-Tools ↔ OpenCAD-Werkzeugliste (neues Fenster).
 * 이름 열쇠 값에 같은 사전의 보이는 글 값을 넣었다(원문·코드 그대로 — README 개발 절 176차 문단). 처음 화면 키 줄·정보 탭 조작 줄
 * (통째 열쇠)의 「F 전체 보기」 낱말도 버튼의 보이는 글 값으로 맞췄다(en View all, ja 全体表示, zh 查看全部).
 * 판정은 대소문자·붙임표(-)·띄어쓰기를 가리지 않는다(175차 표와 같은 셈 — 음성 조작은 붙임표를 낱말 사이로 듣는다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      [START, 'ja', ' · F：全体を表示 · 1～7：標準ビュー · F7：グリッド'],
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
});
