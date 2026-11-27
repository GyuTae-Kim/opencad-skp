/**
 * 175차: 도구 막대 「전체 보기」 버튼(뷰어 fit — 모형 전체로 맞춰 보기)은 보이는 글 열쇠 「전체 보기」와 이름(title·aria-label) 열쇠
 * 「전체 보기 (F)」가 따로라, 영어·일본어·중국어 사전에서 이름이 보이는 글을 품지 않았다(en Fit to view ↔ View all (F),
 * ja 全体を表示 ↔ 全体表示 (F), zh 适合窗口 ↔ 查看全部 (F) — WCAG 2.5.3 이름 안의 이름표, 3.2.4 같은 버튼의 풍선·이름이 다른 낱말).
 * 이름 열쇠 값을 같은 사전의 보이는 글 값 + 「 (F)」로 맞췄다(독일어는 139차가 Gesamtansicht (F)로 이미 같은 꼴 — 원문·코드 그대로,
 * README 개발 절 175차 문단). 바로 가기 안내의 F 줄은 보이는 글과 같은 열쇠라 같은 글이다.
 * 처음 화면 키 줄·정보 탭 조작 줄은 통째 열쇠라 이번에 바꾸지 않았다(README 남은 일).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
type Lang = (typeof LANGS)[number];

const app = readFileSync(resolve(__dirname, '../src/app/app.ts'), 'utf8');
const shortcuts = readFileSync(resolve(__dirname, '../src/app/shortcuts.ts'), 'utf8');

describe('「전체 보기」 버튼의 이름이 다섯 언어 모두 보이는 글을 품는다(175차)', () => {
  it('도구 막대 버튼의 이름(title·aria-label)은 보이는 글을 품고, 바로 가기 안내 F 줄은 보이는 글과 같다', () => {
    // tbtn('보이는 글', 'fit', 'title — named가 아니라 aria-label도 이 글', …)
    const button = /tbtn\('([^']*)', 'fit', '([^']*)'/.exec(app);
    const keyF = /\{ keys: \['F'\], label: '([^']*)' \}/.exec(shortcuts);
    expect([button?.[1], button?.[2], keyF?.[1]]).toEqual(['전체 보기', '전체 보기 (F)', '전체 보기']);
    const label = button![1]!;
    const title = button![2]!;
    for (const lang of ['ko', ...LANGS]) {
      const shown = translate(label, lang);
      expect(translate(title, lang), `${lang}: 이름이 보이는 글을 품음`).toContain(shown);
      expect(translate(keyF![1]!, lang), `${lang}: 바로 가기 안내 F 줄`).toBe(shown);
    }
  });

  it('이름 열쇠 값은 같은 사전의 보이는 글 값 + 「 (F)」이고, 네 사전에서 하나뿐이라 거꾸로 찾기가 제 원문으로 돌아온다', () => {
    const fixed: [lang: Lang, value: string][] = [
      ['en', 'Fit to view (F)'],
      ['ja', '全体を表示 (F)'],
      ['zh-CN', '适合窗口 (F)'],
      ['de', 'Gesamtansicht (F)'],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [lang, value] of fixed) {
      expect(catalogs[lang]!['전체 보기 (F)'], `${lang}: 전체 보기 (F)`).toBe(value);
      // 근거 줄: 같은 사전의 보이는 글 「전체 보기」(바로 가기 안내 F 줄도 이 열쇠)
      expect(value, `${lang}: 근거`).toBe(`${catalogs[lang]!['전체 보기']} (F)`);
      expect(all.filter((v) => v === value).length, `${lang}: ${value}`).toBe(1);
      expect(sourceMessage(value), `${lang}: ${value}`).toBe('전체 보기 (F)');
    }
  });
});
