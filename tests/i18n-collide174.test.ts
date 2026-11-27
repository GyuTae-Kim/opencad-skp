/**
 * 174차: 다른 일을 하는 두 원문이 한 언어 사전에서 같은 값인 것(173차 감사 표 3 — WCAG 2.4.6 이름표가 무엇을 하는지 알려 줌)을
 * 그 언어 값 하나만 같은 사전 안의 다른 맞는 낱말로 갈랐다(원문·코드·짝의 다른 쪽은 그대로 — README 개발 절 174차 문단).
 * - 태그 탭 「모두 보기」(태그 모두 켜기)와 패널 아래 띠 「모두 보이기」(숨긴 그룹·컴포넌트 다시 보이기 — 태그 탭과 한 화면에 함께 보일 수 있다):
 *   de Alle anzeigen → Alle einblenden(이 사전의 보이기·숨기기 Einblenden/Ausblenden), ja すべて表示 → すべて再表示(그 버튼 풀이 글),
 *   zh 全部显示 → 全部重新显示(「다시 보이는 숨긴 개체」 重新显示的隐藏对象)
 * - 고른 것 종류 「치수」(치수 개체)와 줄 이름 「크기」: zh 尺寸 → 尺寸标注(이 사전의 치수 목록 尺寸标注列表)
 * - 보조선 보기 칸 수 「묶음 N」과 그룹 수 「그룹 N」: ja グループ → セット(이 사전의 「화면에 올리는 중 · 묶음 {0}/{1}」)
 * 짝마다 언어마다 다른 값이고 번역층의 거꾸로 찾기(sourceMessage — 같은 값이면 뒤 열쇠가 이긴다)가 제 원문으로 돌아오는지,
 * 고친 값이 근거 줄과 같은 낱말인지 본다.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
type Lang = (typeof LANGS)[number];

/** 다른 일을 하는 원문 짝 */
const PAIRS: [a: string, b: string][] = [
  ['모두 보기', '모두 보이기'],
  ['치수', '크기'],
  ['묶음 {0}', '그룹 {0}'],
];

describe('다른 일을 하는 원문 둘이 한 언어에서 같은 값이 되지 않게(174차)', () => {
  it('짝마다 네 언어 모두 다른 값이고, 옮긴 글을 거꾸로 찾으면 제 원문으로 돌아온다', () => {
    for (const [a, b] of PAIRS)
      for (const lang of LANGS) {
        const va = catalogs[lang]![a]!;
        const vb = catalogs[lang]![b]!;
        expect(va, `${lang}: ${a}`).toBeTruthy();
        expect(vb, `${lang}: ${b}`).toBeTruthy();
        expect(va, `${lang}: ${a} ↔ ${b}`).not.toBe(vb);
        expect(sourceMessage(va), `${lang}: ${va}`).toBe(a);
        expect(sourceMessage(vb), `${lang}: ${vb}`).toBe(b);
      }
  });

  it('고친 줄은 같은 사전의 맞는 낱말을 쓰고, 짝의 다른 쪽은 그대로다', () => {
    const fixed: [key: string, lang: Lang, value: string][] = [
      ['모두 보이기', 'de', 'Alle einblenden'],
      ['모두 보이기', 'ja', 'すべて再表示'],
      ['모두 보이기', 'zh-CN', '全部重新显示'],
      ['치수', 'zh-CN', '尺寸标注'],
      ['묶음 {0}', 'ja', 'セット {0}'],
    ];
    for (const [key, lang, value] of fixed) expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
    // 새 값이 다른 열쇠의 값과 같지 않다(139차 꼴 — 번역층의 거꾸로 찾기가 다른 열쇠로 가지 않게)
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [key, lang, value] of fixed) expect(all.filter((v) => v === value).length, `${lang}: ${key}`).toBe(1);
    // 근거 줄: 같은 사전이 이 낱말을 쓴다
    const basis: [key: string, lang: Lang, has: string][] = [
      ['보이기·숨기기', 'de', 'Einblenden'],
      ['숨기기', 'de', 'Ausblenden'],
      ['숨긴 그룹·컴포넌트를 모두 다시 보입니다(태그는 그대로)', 'ja', 'すべて再表示'],
      ['장면에서 다시 보이는 숨긴 개체가 너무 많아(노드 {0}개·정점 {1}개 한도) 일부는 장면에서도 숨긴 채 둡니다', 'zh-CN', '重新显示'],
      ['치수 목록', 'zh-CN', '尺寸标注'],
      ['화면에 올리는 중 · 묶음 {0}/{1}', 'ja', 'セット {0}/{1}'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    // 짝의 다른 쪽(태그 탭 「모두 보기」·줄 이름 「크기」·그룹 수 「그룹 {0}」)은 그대로
    expect(LANGS.map((lang) => catalogs[lang]!['모두 보기'])).toEqual(['See all', 'すべて表示', '全部显示', 'Alle anzeigen']);
    expect(catalogs['zh-CN']!['크기']).toBe('尺寸');
    expect(catalogs.ja!['그룹 {0}']).toBe('グループ {0}');
    // 틀로 옮기는 글(수를 끼움 — 태그 탭 보조선 보기 칸 수 글·구성 탭 그룹 수)
    expect(translate('묶음 3', 'ja')).toBe('セット 3');
    expect(translate('그룹 3', 'ja')).toBe('グループ 3');
  });
});
