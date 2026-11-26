/**
 * 139차: 패널(모형 트리·태그·장면·구성 요소·속성·정보 탭)·그림 저장·보기 설정·시작 화면의 보이는 글을 네 언어 사전과 대조해,
 * 낱말 뜻이 코드가 하는 일(SketchUp·CAD 뜻)과 다른 번역만 같은 사전 안의 맞는 번역으로 고쳤다(뜻이 맞는 다른 말투는 그대로 — README 개발 절 139차 문단).
 * - 재질(Material)을 물건 재료로: zh 材料 → 材质(이 사전의 기본 재질 默认材质), ja 材料 → マテリアル(이 사전의 재질)
 * - 목록이 깨져 「뒷부분」을 읽지 못함을 뒤쪽 부분으로: ja 後部 → 以降(장면 목록 줄), zh 后部分 → 后面的内容(정점 목록 줄)
 * - 보기(패널 칸·바로 가기 무리의 머리 — 명사)를 동사로: zh 查看(보다) → 视图(보기 설정 视图设置 — 50차 뷰 큐브와 같은 꼴)
 * - 넓이를 면 낱말로: de Fläche (Fläche)·die Fläche der … Fläche → Flächeninhalt(이 사전의 넓이 — 135차 남은 일)
 * - 치수(치수 개체)를 크기로: de Abmessung·Maße → Bemaßung(이 사전의 치수 목록·치수 보기)
 * - 컴포넌트(고른 개체 하나의 종류 이름)를 여럿으로: de Komponenten → Komponente
 * - 부드러운 모서리(soft)를 매끈한(smooth) 낱말로: en Smooth·de Glatte → Soft·Weiche(같은 칸 설명의 「부드러운·매끈한」)
 * - 전체 보기(F — 모형 전체로 맞춰 보기)를 「모두 보이기」 낱말로: de Alle(s) anzeigen → Gesamtansicht(바로 가기 목록의 전체 보기)
 * - 시작 화면 「아직 못 읽음」(아직 읽지 못하는 형식)을 「아직 읽지 않음」(상태)으로: 네 언어 → 이 사전의 「아직 읽지 못하는 … 꼴」 낱말
 * - 「› 버튼으로 펼치면 …」 en: 앞의 「펼치면」이 빠진 글 → Expand with the › button …
 * 옛 오역이 다시 들어오지 않게 그 낱말을 막고, 고친 줄이 같은 사전의 맞는 낱말(근거 줄과 같은 말)을 쓰는지 본다.
 */
import { describe, expect, it } from 'vitest';
import { catalogs, translate } from '../site/i18n.mjs';

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
type Lang = (typeof LANGS)[number];

describe('패널·그림 저장·보기 설정·시작 화면 글의 네 언어 번역(139차)', () => {
  it('옛 오역 낱말이 다시 들어오지 않는다', () => {
    // [열쇠에 든 말, 언어, 없어야 할 낱말]
    const bans: [term: RegExp, lang: Lang, ban: RegExp][] = [
      [/재질/, 'zh-CN', /材料/],
      [/재질/, 'ja', /材料/],
      [/뒷부분을 읽지 못/, 'ja', /後部/],
      // 틀 줄 「{0} 깨져 …」의 最后部分(마지막 부분 — 영어 the last part와 같은 뜻)은 그대로 둔다
      [/뒷부분을 읽지 못/, 'zh-CN', /(^|[^最])后部分/],
      [/^보기$/, 'zh-CN', /查看/],
      [/넓이/, 'de', /Fläche \(Fläche\)|die Fläche (der|einer)/],
      [/치수/, 'de', /Abmessung|\bMaße\b/],
      [/^컴포넌트$/, 'de', /Komponenten/],
      [/부드러운 모서리/, 'en', /smooth/i],
      [/부드러운 모서리/, 'de', /glatt/i],
      [/전체 보기/, 'de', /Alles? anzeigen/],
      [/^아직 못 읽음$/, 'en', /Not yet read/i],
      [/^아직 못 읽음$/, 'ja', /未読/],
      [/^아직 못 읽음$/, 'zh-CN', /尚未读取/],
      [/^아직 못 읽음$/, 'de', /Ungelesen/i],
    ];
    for (const [term, lang, ban] of bans)
      for (const [key, value] of Object.entries(catalogs[lang]!)) if (term.test(key)) expect(value, `${lang}: ${key}`).not.toMatch(ban);
    // [열쇠에 든 말, 언어, 있어야 할 낱말, 뺄 열쇠] — 같은 낱말 무리가 모두 맞는 낱말을 쓴다
    const needs: [term: RegExp, lang: Lang, need: RegExp, skip?: RegExp][] = [
      [/넓이/, 'de', /Flächeninhalt/, /면 넓이 합/],
      [/치수/, 'de', /Bemaßung/],
      [/부드러운 모서리/, 'en', /soft/i],
      [/부드러운 모서리/, 'de', /weich/i],
      [/전체 보기/, 'de', /Gesamtansicht/],
      [/뒷부분을 읽지 못/, 'ja', /以降を読み込めませんでした/],
    ];
    for (const [term, lang, need, skip] of needs) {
      const keys = Object.keys(catalogs[lang]!).filter((key) => term.test(key) && !skip?.test(key));
      expect(keys.length, `${lang}: ${term}`).toBeGreaterThan(0);
      for (const key of keys) expect(catalogs[lang]![key], `${lang}: ${key}`).toMatch(need);
    }
  });

  it('고친 줄은 같은 사전의 맞는 낱말을 쓴다', () => {
    const fixed: [key: string, lang: Lang, value: string][] = [
      ['› 버튼으로 펼치면 3D에서 누를 때도 그 안의 항목을 고릅니다. 누르면 강조, 두 번 누르면 확대합니다.', 'en', 'Expand with the › button to also select the items inside it when you press in 3D. Press to highlight, double-press to zoom.'],
      ['부드러운 모서리 · {0}', 'en', 'Soft Edges · {0}'],
      ['부드러운 모서리 보기', 'en', 'Show soft edges'],
      ['{0} — 누르면 이 재질의 면을 강조합니다', 'ja', '{0} - 押すとこのマテリアルの面を強調します'],
      ['면 목록이 깨져 뒷부분을 읽지 못했습니다', 'ja', '面リストが破損しているため、以降を読み込めませんでした'],
      ['model.dat 안의 꼬리표 길이가 깨져 뒷부분을 읽지 못했습니다', 'ja', 'model.dat内のタグの長さが破損しているため、以降を読み込めませんでした'],
      ['재질', 'zh-CN', '材质'],
      ['재질 {0}개', 'zh-CN', '材质 {0} 件'],
      ['반투명 재질', 'zh-CN', '半透明材质'],
      ['재질 파일을 읽지 못했습니다: {0}', 'zh-CN', '无法读取材质文件：{0}'],
      ['보기', 'zh-CN', '视图'],
      ['model.dat 안의 꼬리표 길이가 깨져 뒷부분을 읽지 못했습니다', 'zh-CN', 'model.dat中的标签长度已损坏，后面的内容无法读取。'],
      ['치수', 'de', 'Bemaßung'],
      ['컴포넌트', 'de', 'Komponente'],
      ['글·치수·측정 넣기', 'de', 'Texte·Bemaßungen·Messungen einschließen'],
      ['누른 면 하나의 넓이만 보기', 'de', 'Nur den Flächeninhalt der angetippten Fläche zeigen'],
      ['3D에서 누른 면 하나(넓이)나 모서리 하나(길이)만 고릅니다', 'de', 'Wählt nur die in 3D angetippte Fläche (Flächeninhalt) oder Kante (Länge)'],
      ['부드러운 모서리 보기', 'de', 'Weiche Kanten anzeigen'],
      ['전체 보기 (F)', 'de', 'Gesamtansicht (F)'],
    ];
    for (const [key, lang, value] of fixed) expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
    // 새 값이 다른 열쇠의 값과 같지 않다(번역층의 거꾸로 찾기가 다른 열쇠로 가지 않게)
    const all = LANGS.flatMap((lang) => Object.values(catalogs[lang]!));
    for (const [key, lang, value] of fixed) expect(all.filter((v) => v === value).length, `${lang}: ${key}`).toBe(1);
    // 시작 화면 「아직 못 읽음」(지원 형식 옆 — 아직 읽지 못하는 형식)
    expect(LANGS.map((lang) => translate('아직 못 읽음', lang))).toEqual(['Not supported yet', 'まだ読み込めない', '尚无法读取', 'Noch nicht lesbar']);
    // 근거 줄: 같은 사전이 이 낱말을 쓴다
    const basis: [key: string, lang: Lang, has: string][] = [
      ['기본 재질', 'zh-CN', '材质'],
      ['재질이 없습니다.', 'zh-CN', '材质'],
      ['재질', 'ja', 'マテリアル'],
      ['장면 목록이 깨져 뒷부분을 읽지 못했습니다', 'ja', '以降を読み込めませんでした'],
      ['정점 목록이 깨져 뒷부분을 읽지 못했습니다', 'zh-CN', '后面的内容无法读取'],
      ['보기 설정', 'zh-CN', '视图'],
      ['넓이', 'de', 'Flächeninhalt'],
      ['치수 목록', 'de', 'Bemaßung'],
      ['입체 컴포넌트', 'de', '-Komponente'],
      ['곡면을 이루는 부드러운·매끈한 모서리를 옅은 선으로 보입니다(SketchUp 화면에서는 숨는 선)', 'en', 'soft and smooth'],
      ['곡면을 이루는 부드러운·매끈한 모서리를 옅은 선으로 보입니다(SketchUp 화면에서는 숨는 선)', 'de', 'weichen und glatten'],
      ['전체 보기', 'de', 'Gesamtansicht'],
      ['아직 읽지 못하는 그림 꼴 {0}', 'en', 'not supported yet'],
      ['아직 읽지 못하는 그림 꼴 {0}', 'ja', 'まだ読み込めない'],
      ['아직 읽지 못하는 그림 꼴 {0}', 'zh-CN', '尚无法读取'],
      ['아직 읽지 못하는 그림 꼴 {0}', 'de', 'noch nicht gelesen werden kann'],
      ['{0} 펼치기', 'en', 'Expand'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    // 틀로 옮기는 글(수를 끼움)·목록 경고 글
    expect(translate('재질 3개', 'zh-CN')).toBe('材质 3 件');
    expect(translate('인스턴스 목록이 깨져 뒷부분을 읽지 못했습니다', 'ja')).toBe('インスタンスリストが破損しているため、以降を読み込めませんでした');
  });
});
