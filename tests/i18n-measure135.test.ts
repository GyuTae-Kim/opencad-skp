/**
 * 135차: 줄자·각도기·측정값 칸·안내점·안내선·스냅 이름·잠금 안내·측정 띠·가상 커서 알림 화면의 보이는 글을 네 언어 사전과 대조해,
 * 낱말 뜻이 코드가 하는 일(SketchUp·CAD 뜻)과 다른 번역만 같은 사전 안의 맞는 번역으로 고쳤다(뜻이 맞는 다른 말투는 그대로 — README 개발 절 135차 문단).
 * - 찍은 점(줄자·각도기로 둔 점)을 「고른 것」 낱말로: en picked(이 사전의 고름 Picked)·zh 已选(고른 것) → placed points·已放置的点(Esc 바로 가기 줄과 같게)
 * - 각도기 중심을 호·원 중심 스냅 낱말로: zh 圆心(이 사전 스냅 「중심」) → 中心点(각도기 중심점) — 알림이 「已放置圆心。端点: …」처럼 스냅 종류와 섞였다
 * - 보조선 묶음 수를 상품 꾸러미로: zh 捆绑包 → 组(이 사전의 선 묶음 线组·점 묶음 点组)
 * - 보조선(안내선)이 같은 낱말 되풀이: de Hilfslinien (Hilfslinien) → 괄호 뺌(이 사전에서 보조선·안내선이 모두 Hilfslinie)
 * 옛 오역이 다시 들어오지 않게 그 낱말을 막고, 고친 줄이 같은 사전의 맞는 낱말(근거 줄과 같은 말)을 쓰는지 본다.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
type Lang = (typeof LANGS)[number];

describe('줄자·각도기·안내 화면 글의 네 언어 번역(135차)', () => {
  it('옛 오역 낱말이 다시 들어오지 않는다', () => {
    // [열쇠에 든 말, 언어, 없어야 할 낱말]
    const bans: [term: RegExp, lang: Lang, ban: RegExp][] = [
      [/찍은 점/, 'en', /picked/i],
      [/찍은 점/, 'zh-CN', /已选/],
      [/각도기|중심점|중심을 찍/, 'zh-CN', /圆心/],
      [/묶음/, 'zh-CN', /捆绑/],
    ];
    for (const [term, lang, ban] of bans)
      for (const [key, value] of Object.entries(catalogs[lang]!)) if (term.test(key)) expect(value, `${lang}: ${key}`).not.toMatch(ban);
    // 보조선·보조점·안내 열쇠에 같은 낱말을 괄호로 되풀이한 번역이 없다("Hilfslinien (Hilfslinien)")
    for (const lang of LANGS)
      for (const [key, value] of Object.entries(catalogs[lang]!)) if (/보조선|보조점|안내/.test(key)) expect(value, `${lang}: ${key}`).not.toMatch(/(\p{L}{2,}) \(\1\)/u);
  });

  it('고친 줄은 같은 사전의 맞는 낱말을 쓴다', () => {
    const fixed: [key: string, lang: Lang, value: string][] = [
      ['찍은 점과 결과 지우기', 'en', 'Clear placed points and result'],
      ['찍은 점과 결과 지우기', 'zh-CN', '清除已放置的点和结果'],
      ['중심을 찍었습니다. {0}', 'zh-CN', '已放置中心点。{0}'],
      ['묶음 {0}', 'zh-CN', '{0} 组'],
      ['보조선(안내선)·보조점을 점선으로 보입니다', 'de', 'Hilfslinien und Hilfspunkte werden als gepunktete Linien dargestellt.'],
    ];
    for (const [key, lang, value] of fixed) expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
    // 근거 줄: 같은 사전이 찍은 점·각도기 중심점·선 묶음을 이 낱말로 옮긴다(스냅 「중심」은 호·원의 중심이라 圆心 그대로)
    const basis: [key: string, lang: Lang, has: string][] = [
      ['줄자·각도기의 가상 커서를 켠 동안: 찍은 점·결과를 먼저 지우고, 없으면 커서 끄기', 'en', 'placed points'],
      ['줄자·각도기의 가상 커서를 켠 동안: 찍은 점·결과를 먼저 지우고, 없으면 커서 끄기', 'zh-CN', '已放置的点'],
      ['각도기: 중심점을 누르세요 · 길게 누르면 정밀 조준', 'zh-CN', '中心点'],
      ['3D 보기: 굵기가 깨진 선 묶음을 1화소 굵기로 그렸습니다', 'zh-CN', '线组'],
      ['보조선', 'de', 'Hilfslinie'],
      ['안내선', 'de', 'Hilfslinie'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    expect(catalogs['zh-CN']!['중심']).toBe('圆心');
    // 가상 커서 Enter 알림(각도기 중심 — 자리 글을 끼움)
    expect(translate('중심을 찍었습니다. {0}', 'zh-CN').replace('{0}', () => '端点: X 0 mm, Y 0 mm, Z 0 mm')).toBe('已放置中心点。端点: X 0 mm, Y 0 mm, Z 0 mm');
  });
});
