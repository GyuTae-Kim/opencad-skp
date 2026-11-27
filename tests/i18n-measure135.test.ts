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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogs, sourceMessage, translate } from '../site/i18n.mjs';
import { measureHint } from '../src/app/measure';
import { SHORTCUTS } from '../src/app/shortcuts';

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

/**
 * 209차: 측정 묶음(줄자·각도기 안내·측정 띠·바로 가기·정보 탭)을 네 언어로 다시 대조해, (가) 뜻이 코드와 다른 번역과 (다) 한 기능을 부르는
 * 버튼·풍선·안내·바로 가기 줄이 한 언어에서 다른 낱말인 것을 같은 사전 안의 맞는 낱말로 고쳤다(원문·코드 그대로 — README 개발 절 209차 문단).
 * - 가상 커서 Esc 줄 「없으면 커서 끄기」: en then·de danach(한 번 누름이 둘 다 하는 듯) → 없을 때만(keypick.ts — 지울 것이 있으면 측정이 받고 끝)
 * - 영어 줄자 안내 넷의 도구 이름 Tape → Tape Measure(줄자 버튼 보이는 글·다른 줄자 안내)
 * - 일본어 Esc 두 줄(바로 가기·정보 탭)과 각도기 풍선: 측정 計測 → 測定(측정 띠 「測定」·「測定を終了」), 지우기 クリア → 消去,
 *   「찍은 뒤」 0~9 두 줄 置いた(안내를 두다) → 指定した(찍다 — 「点を指定」·「始点を指定しました」)
 * - 중국어 각도기 「찍은 뒤」 确定 → 放置(짝 줄자 줄·「已放置参考方向」), 독일어 기준 방향 Referenzrichtung → Bezugsrichtung(나머지 기준 방향 다섯)
 */
describe('측정 묶음의 같은 기능 같은 낱말·뜻 맞춤(209차)', () => {
  it('고친 값은 같은 사전의 맞는 낱말이고, 하나뿐이라 거꾸로 찾기가 제 원문으로 돌아오며, 옛 낱말은 남지 않는다', () => {
    const read = (f: string): string => readFileSync(resolve(__dirname, `../src/app/${f}`), 'utf8');
    const END_GUIDE = '줄자: 끝점을 누르세요 · 길이를 치면 안내점 · Esc 취소';
    const END_EDGE = '줄자: 끝점을 누르세요 · 길이를 치면 모서리와 나란한 안내선 · Esc 취소';
    const AT_EDGE = '줄자: 모서리와 나란한 안내선을 둘 곳을 누르세요 · 길이를 치면 그 거리에 · Esc 취소';
    const AT_POINT = '줄자: 안내점을 둘 곳을 누르세요 · 길이를 치면 그 거리에 · Esc 취소';
    const BASE_TOUCH = '각도기: 기준 방향의 점을 누르세요';
    const KEY_ESC = '줄자·각도기의 가상 커서를 켠 동안: 찍은 점·결과를 먼저 지우고, 없으면 커서 끄기';
    const ESC = '여는 중이면 취소 → 측정 점 지우기 → 측정 끄기 → 고른 것 지우기';
    const TAPE_VCB = '줄자 시작점을 찍은 뒤: 측정값 칸에 길이 넣기(그 길이에 안내점, 모서리 위에서 시작하면 나란한 안내선)';
    const ANGLE_VCB = '각도기 기준 방향을 찍은 뒤: 측정값 칸에 각도 넣기(그 각도로 안내선)';
    const INFO_ESC = 'Esc: 측정 점 지우기 → 한 번 더 누르면 측정 끄기 · 측정 중이 아니면 고른 것 지우기';
    const PROTRACTOR = '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정·방향 잠금) · Esc 지우기';
    // 쓰는 자리(원문): 측정 띠·상태 막대 안내(마우스 줄자 둘째 점 둘·안내 두기 둘, 손가락 각도기 기준 방향), 바로 가기 안내 셋, 정보 탭 조작 줄, 각도기 버튼 풍선
    expect([measureHint('tape', 1, false), measureHint('tape', 1, false, false, true), measureHint('tape', 1, false, false, true, true), measureHint('tape', 1, false, false, false, true), measureHint('protractor', 1, false, true)])
      .toEqual([END_GUIDE, END_EDGE, AT_EDGE, AT_POINT, BASE_TOUCH]);
    const shortcutLabels = SHORTCUTS.flatMap((g) => g.items.map((s) => s.label));
    for (const t of [KEY_ESC, ESC, TAPE_VCB, ANGLE_VCB]) expect(shortcutLabels, t).toContain(t);
    expect(read('infotab.ts')).toContain(`h('li', {}, '${INFO_ESC}')`);
    expect(read('app.ts')).toContain(`tbtn('각도기', 'protractor', '${PROTRACTOR}', `);
    const fixed: [key: string, lang: Lang, value: string][] = [
      [END_GUIDE, 'en', 'Tape Measure: click the end point · type a length for a guide point · Esc to cancel'],
      [END_EDGE, 'en', 'Tape Measure: click the end point · type a length for a guide line parallel to the edge · Esc to cancel'],
      [AT_EDGE, 'en', 'Tape Measure: click where to place a guide line parallel to the edge · type a length to place it at that distance · Esc to cancel'],
      [AT_POINT, 'en', 'Tape Measure: click where to place a guide point · type a length to place it at that distance · Esc to cancel'],
      [KEY_ESC, 'en', 'While the Tape Measure or Protractor virtual cursor is on: clear the placed points and the result first; if there are none, turn off the cursor'],
      [ESC, 'ja', '読み込み中ならキャンセル → 測定点を消去 → 測定をオフ → 選択を解除'],
      [INFO_ESC, 'ja', 'Esc：測定点を消去→もう一度押すと測定をオフ・測定中でなければ選択を解除'],
      [PROTRACTOR, 'ja', '分度器：中心 → 基準方向 → 測定方向（Shift = 平面の固定・方向のロック）・Escキーで消去'],
      [TAPE_VCB, 'ja', 'メジャーの始点を指定した後: 測定値欄に長さを入力（その長さにガイド点、エッジ上から始めると平行なガイド線）'],
      [ANGLE_VCB, 'ja', '分度器の基準方向を指定した後: 測定値欄に角度を入力（その角度でガイド線）'],
      [ANGLE_VCB, 'zh-CN', '放置量角器参考方向后：在测量值框中输入角度（按该角度放置参考线）'],
      [BASE_TOUCH, 'de', 'Winkelmesser: Punkt in Bezugsrichtung antippen'],
      [KEY_ESC, 'de', 'Solange der virtuelle Cursor von Maßband oder Winkelmesser an ist: zuerst gesetzte Punkte und das Ergebnis löschen; sind keine da, den Cursor ausschalten'],
    ];
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [key, lang, value] of fixed) {
      expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
      expect(all.filter((v) => v === value).length, `${lang}: ${value}`).toBe(1);
      expect(sourceMessage(value), value).toBe(key);
    }
    // 옛 낱말이 그 기능의 화면 값에 남지 않는다
    const entries = (lang: Lang, key: RegExp): [string, string][] => Object.entries(catalogs[lang]!).filter(([k]) => key.test(k));
    expect(entries('en', /^줄자: /).filter(([, v]) => v.startsWith('Tape:'))).toEqual([]);
    for (const k of [ESC, INFO_ESC]) expect(catalogs.ja![k], k).not.toMatch(/計測|クリア/);
    expect(catalogs.ja![PROTRACTOR]).not.toMatch(/クリア/);
    for (const k of [TAPE_VCB, ANGLE_VCB]) expect(catalogs.ja![k], k).not.toMatch(/置い/);
    expect(catalogs['zh-CN']![ANGLE_VCB]).not.toMatch(/确定/);
    expect(entries('de', /기준 방향/).filter(([, v]) => /Referenzrichtung/.test(v))).toEqual([]);
    for (const v of [catalogs.en![KEY_ESC], catalogs.de![KEY_ESC]]) expect(v).not.toMatch(/then turn off|danach den Cursor/);
    // 근거 줄: 같은 사전이 그 기능을 이 낱말로 부른다(버튼 보이는 글·이름·알림·짝 줄)
    const basis: [key: string, lang: Lang, has: string][] = [
      ['줄자', 'en', 'Tape Measure'],
      ['줄자: 끝점을 누르세요', 'en', 'Tape Measure: Tap the end point'],
      ['측정: 점을 누르세요 · Esc = 지우기, 한 번 더 = 끄기', 'en', 'Esc = Clear, press again = Exit'],
      ['측정', 'ja', '測定'],
      ['측정 끝내기', 'ja', '測定を終了'],
      ['찍은 점과 결과 지우기', 'ja', '消去'],
      ['줄자: 다시 누르면 새로 잽니다 · Esc 지우기', 'ja', 'Escキーで消去'],
      ['찍기 Enter', 'ja', '点を指定'],
      ['기준 방향을 찍었습니다. {0}', 'ja', '基準方向を指定しました'],
      ['줄자 시작점을 찍은 뒤: 측정값 칸에 길이 넣기(그 길이에 안내점, 모서리 위에서 시작하면 나란한 안내선)', 'zh-CN', '放置卷尺起点后'],
      ['기준 방향을 찍었습니다. {0}', 'zh-CN', '已放置参考方向'],
      ['각도기: 기준 방향의 점을 누르세요 · Esc 취소', 'de', 'Bezugsrichtung'],
      ['기준 방향을 찍었습니다. {0}', 'de', 'Bezugsrichtung gesetzt'],
      [KEY_ESC, 'ja', 'なければカーソルをオフ'],
      [KEY_ESC, 'zh-CN', '没有时关闭光标'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    // 화면 글(바로 가기 안내·측정 안내)이 고친 값으로 옮겨진다
    expect(translate(measureHint('tape', 1, false)!, 'en')).toBe(fixed[0]![2]);
    expect(translate(ESC, 'ja')).toBe(fixed[5]![2]);
  });
});
