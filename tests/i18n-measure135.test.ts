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
import { LOCK_HINTS, LOCK_PICK_LABELS, measureHint } from '../src/app/measure';
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
    // 213차: 마우스·키보드 갈래 줄자 안내 넷의 동사 click → press(기기를 가리지 않는 「누르세요」 — i18n.test 213차)
    const fixed: [key: string, lang: Lang, value: string][] = [
      [END_GUIDE, 'en', 'Tape Measure: press the end point · type a length for a guide point · Esc to cancel'],
      [END_EDGE, 'en', 'Tape Measure: press the end point · type a length for a guide line parallel to the edge · Esc to cancel'],
      [AT_EDGE, 'en', 'Tape Measure: press where to place a guide line parallel to the edge · type a length to place it at that distance · Esc to cancel'],
      [AT_POINT, 'en', 'Tape Measure: press where to place a guide point · type a length to place it at that distance · Esc to cancel'],
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

/**
 * 210차: 잠글 방향 줄(측정 띠 위 — 방향 잠금 버튼이 펼친다)의 버튼 넷이 지금 상태인 잠금 안내 열쇠(LOCK_HINTS — 「빨강 축으로 잠금」)를 함께 써서,
 * 번역에서 누를 버튼이 「잠갔음」 꼴(en Locked to red axis·zh 已锁定到红色轴·de Auf rote Achse gesperrt)이었다(WCAG 2.4.6·3.3.2 — 버튼 이름은 할 일, 안내는 지금 상태).
 * 번역층은 원문 글 그대로가 열쇠라 같은 원문은 늘 한 번역이다 — 버튼만 할 일 꼴 원문(LOCK_PICK_LABELS 「…잠그기」 — 띠 잠금 버튼 풀이 「지금 방향 잠그기」의 낱말)을 두고
 * 네 사전에 할 일 꼴 값을 더했다(같은 사전의 바로 가기 화살표·↓ 줄 낱말). 측정 띠·상태 막대의 잠금 안내는 그대로다(README 개발 절 210차 문단).
 */
describe('잠글 방향 줄 버튼은 할 일, 잠금 안내는 지금 상태(210차)', () => {
  it('버튼 원문 넷은 잠금 안내와 다른 할 일 꼴이고, 네 사전 값도 할 일 꼴·하나뿐이라 거꾸로 찾기가 제 원문으로 돌아오며, 안내 쪽 값은 그대로다', () => {
    expect(LOCK_PICK_LABELS).toEqual({ x: '빨강 축으로 잠그기', y: '녹색 축으로 잠그기', z: '파랑 축으로 잠그기', parallel: '모서리와 나란히 잠그기' });
    const choices = ['x', 'y', 'z', 'parallel'] as const;
    for (const c of choices) expect(LOCK_PICK_LABELS[c], c).not.toBe(LOCK_HINTS[c]);
    // 쓰는 곳: 잠글 방향 줄 버튼은 새 원문, 측정 띠·상태 막대의 잠금 안내(lockHint)는 LOCK_HINTS
    const src = readFileSync(resolve(__dirname, '../src/app/measure.ts'), 'utf8');
    expect(src).toContain('b.append(sw, LOCK_PICK_LABELS[c]);');
    expect(src).toContain('return lock ? LOCK_HINTS[lock] :');
    const pick: Record<Lang, Record<(typeof choices)[number], string>> = {
      en: { x: 'Lock to red axis', y: 'Lock to green axis', z: 'Lock to blue axis', parallel: 'Lock parallel to edge' },
      ja: { x: '赤軸にロックする', y: '緑軸にロックする', z: '青軸にロックする', parallel: 'エッジに平行でロックする' },
      'zh-CN': { x: '锁定到红色轴', y: '锁定到绿色轴', z: '锁定到蓝色轴', parallel: '锁定为平行于边线' },
      de: { x: 'Auf rote Achse sperren', y: 'Auf grüne Achse sperren', z: 'Auf blaue Achse sperren', parallel: 'Parallel zur Kante sperren' },
    };
    // 안내 쪽(LOCK_HINTS 여섯 — 축 셋·모서리와 나란히·모서리에 수직·면에 수직)은 지금 상태 꼴 그대로
    const state: Record<Lang, string[]> = {
      en: ['Locked to red axis', 'Locked to green axis', 'Locked to blue axis', 'Locked parallel to edge', 'Locked perpendicular to edge', 'Locked perpendicular to face'],
      ja: ['赤軸にロック', '緑軸にロック', '青軸にロック', 'エッジに平行でロック', 'エッジに垂直でロック', '面に垂直でロック'],
      'zh-CN': ['已锁定到红色轴', '已锁定到绿色轴', '已锁定到蓝色轴', '已锁定为平行于边线', '已锁定为垂直于边线', '已锁定为垂直于面'],
      de: ['Auf rote Achse gesperrt', 'Auf grüne Achse gesperrt', 'Auf blaue Achse gesperrt', 'Parallel zur Kante gesperrt', 'Senkrecht zur Kante gesperrt', 'Senkrecht zur Fläche gesperrt'],
    };
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const lang of LANGS) {
      for (const c of choices) {
        const v = pick[lang][c];
        expect(catalogs[lang]![LOCK_PICK_LABELS[c]], `${lang}: ${c}`).toBe(v);
        expect(translate(LOCK_PICK_LABELS[c], lang)).toBe(v);
        expect(all.filter((x) => x === v).length, `${lang}: ${v}`).toBe(1);
        expect(sourceMessage(v), v).toBe(LOCK_PICK_LABELS[c]);
      }
      expect(Object.values(LOCK_HINTS).map((k) => catalogs[lang]![k]), lang).toEqual(state[lang]);
    }
    // 할 일 꼴: 버튼 값에 상태 꼴(Locked·已锁定·gesperrt)이 없고 안내 값에는 있다 — 일본어 버튼은 동사 ロックする(안내는 명사 끝 ロック)
    for (const c of choices) {
      const k = LOCK_PICK_LABELS[c];
      expect(catalogs.en![k]).toMatch(/^Lock (to|parallel) /);
      expect(catalogs.en![LOCK_HINTS[c]]).toMatch(/^Locked /);
      expect(catalogs['zh-CN']![k]).toMatch(/^锁定/);
      expect(catalogs['zh-CN']![LOCK_HINTS[c]]).toMatch(/^已锁定/);
      expect(catalogs.de![k]).toMatch(/ sperren$/);
      expect(catalogs.de![LOCK_HINTS[c]]).toMatch(/ gesperrt$/);
      expect(catalogs.ja![k]).toMatch(/ロックする$/);
      expect(catalogs.ja![LOCK_HINTS[c]]).toMatch(/ロック$/);
    }
    // 근거 줄: 같은 사전이 같은 할 일(축·모서리와 나란히 잠그기)을 이 낱말로 부른다 — 바로 가기 화살표·↓ 줄, 띠 잠금 버튼 풀이, 줄 이름
    const ARROWS = '줄자 끝점·각도기 방향을 잡는 동안: 빨강·녹색·파랑 축으로 잠금(다시 누르면 풀기), 각도기 중심 전에는 그 축 평면에 고정';
    const DOWN = '줄자 끝점·각도기 방향을 잡는 동안: 모서리와 나란히·수직으로 잠금(다시 누르면 풀기)';
    const shortcutLabels = SHORTCUTS.flatMap((g) => g.items.map((s) => s.label));
    for (const t of [ARROWS, DOWN]) expect(shortcutLabels, t).toContain(t);
    const basis: [key: string, lang: Lang, has: string][] = [
      [ARROWS, 'en', 'lock to the red, green or blue axis'],
      [DOWN, 'en', 'lock parallel or perpendicular to an edge'],
      ['지금 방향 잠그기(다시 누르면 풀기)', 'en', 'Lock the current direction'],
      [ARROWS, 'zh-CN', '锁定到红、绿、蓝轴'],
      [DOWN, 'zh-CN', '锁定为平行或垂直于边线'],
      [ARROWS, 'de', 'auf rote, grüne oder blaue Achse sperren'],
      [DOWN, 'de', 'parallel oder senkrecht zur Kante sperren'],
      ['잠글 방향 고르기', 'ja', 'ロックする'],
      [DOWN, 'ja', 'エッジに平行・垂直でロック'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
  });
});
