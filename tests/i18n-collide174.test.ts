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
 *
 * 217차: 같은 언어 안에서 서로 다른 열쇠가 같은 값인 겹침 모두(README 개발 절 217차 문단). 거꾸로 찾기는 받은 사전 모두의 값을 한 지도에 넣어
 * 같은 값이면 뒤 열쇠로만 되돌린다. 번역층(src/app/i18n.ts value)은 원문 기록이 있는 글(앱이 한국어로 넣은 글)은 그 원문에서 옮기고,
 * 기록이 없는 번역 글(정적 언어 쪽 글·앱이 이미 옮긴 글을 번역층이 보는 칸에 넣을 때)만 거꾸로 찾는다 — 그 글이 진 열쇠의 값이면
 * 언어를 바꿀 때 이긴 열쇠(다른 원문)의 번역이 나온다.
 * - 해가 있는 겹침(쓰는 열쇠가 지고 다른 언어 번역이 다름)은 같은 사전 근거로 갈랐다: 「기본값」(재질 없음) en·zh·de, 「숨김」(지금 상태 칩) ja·zh,
 *   「전체」(쓰는 곳 없음 — 쓰는 「모두」가 이것에 졌다) en·zh·de.
 * - 남는 겹침은 목록(LEFT)으로 고정한다 — 목록 밖 새 겹침, 목록에 있는데 이제 안 겹침이면 실패. 까닭마다 그 까닭이 지금도 맞는지 본다.
 * - jsdom(i18n.test 꼴 — 실제 번역층·언어 메뉴): 앱 길(한국어 원문)은 언어를 바꿀 때·다시 그릴 때 늘 제 원문의 번역,
 *   거꾸로 찾기 길(기록 없는 번역 글)에서 틀린 번역이 나는 (언어·열쇠 → 바꾼 언어)는 목록의 「쓰지 않음·파일 글·같은 것」뿐.
 * 공용 규칙 9번(NC 201차 기호 열쇠 ':' 사고): 네 사전 열쇠는 한글이나 {n} 틀을 품는다(og 그림 주소 하나 뺌).
 *
 * 218차: 쓰는 곳이 없는 열쇠 58개를 네 사전에서 지웠다(README 개발 절 218차 문단 — 앱 src·코어 src·사이트 키트·index.html·public·사이트 정보에
 * 그 글이 그대로도·조립으로도 없음). 지는 쪽이 쓰지 않는 열쇠이던 겹침 넷(「면 고르기·면 선택」·「어두움·어둡게」·「밝게·밝음」·「소스 코드·코드」)과
 * 사람 이름 겹침(「김규태 Sean Kim」)이 없어져 목록에서 뺐다. 지운 열쇠(REMOVED)가 다시 쓰이면 사전에 없어 다른 언어 화면에 한국어가 남으니 실패한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogs, languageUrl, metadataForLanguage, normalize, sourceMessage, translate } from '../site/i18n.mjs';
import { installLocalization } from '../src/app/i18n';

const { JSDOM } = createRequire(import.meta.url)('jsdom');

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

/**
 * 남는 겹침의 까닭(217차 progress 표):
 * same — 묶음의 열쇠들이 네 언어 모두 같은 값(다른 언어로 바꿔도 보이는 글 그대로 — 한국어로 돌아올 때만 같은 뜻의 다른 원문)
 * unused — 거꾸로 찾기에서 지는 열쇠를 앱이 쓰지 않는다(src에 따옴표 글로 없음 — 쓰는 열쇠가 이긴다)
 * file — 예제 모형 안 이름(파일 글 — 번역층이 건너뛰는 칸에만 들어간다)
 * same-thing — 원문이 같은 것으로 적은 두 이름(「보조선(안내선)·보조점…」 — SketchUp 독일어 Hilfslinie·Hilfspunkt 하나라 같은 사전에 가를 다른 낱말이 없음)
 * template — 틀 열쇠끼리(그린 글에는 수가 들어가 값과 같아지지 않아 거꾸로 찾기가 닿지 않는다)
 * untranslated — 거꾸로 찾지 않는 이름(site-kit OPENCAD_SITE untranslated — 사람 이름 「Sean Kim」은 그 글 그대로. 218차에 「김규태 Sean Kim」을 지워 지금은 없다)
 * (「숨긴」은 해석기 이름의 틀 자리 값 `'숨긴 '`(scene.ts)로, 「와이어」는 코어 개발 쪽 글로 쓰일 수 있어 218차에 지우지 않았다 — 앱 원문 따옴표 글로는 없다)
 */
type Why = 'same' | 'unused' | 'file' | 'same-thing' | 'template' | 'untranslated';
const LEFT: Record<Lang, [value: string, keys: string[], why: Why][]> = {
  en: [
    ['Hidden', ['숨긴', '숨김'], 'unused'],
    ['Locked', ['잠김', '잠금'], 'same'],
    ['Unknown', ['모름', '알 수 없음'], 'same'],
    ['{0} recent measurements', ['최근 측정 {0}개', '최근 측정 기록 {0}개'], 'template'],
  ],
  ja: [
    ['テーブル', ['식탁', '탁자'], 'file'],
    ['ロック', ['잠김', '잠금'], 'same'],
    ['不明', ['모름', '알 수 없음'], 'same'],
  ],
  'zh-CN': [
    ['已锁定', ['잠김', '잠금'], 'same'],
    ['已隐藏', ['숨긴', '숨김'], 'unused'],
    ['未知', ['모름', '알 수 없음'], 'same'],
    ['线框', ['와이어', '와이어프레임'], 'unused'],
    ['警告 {0}', ['경고 {0}', '경고 {0}개'], 'template'],
  ],
  de: [
    ['Gesperrt', ['잠김', '잠금'], 'same'],
    ['Hilfslinie', ['보조선', '안내선'], 'same-thing'],
    ['Hilfspunkt', ['보조점', '안내점'], 'same-thing'],
    ['Unbekannt', ['모름', '알 수 없음'], 'same'],
    ['Versteckt', ['숨긴', '숨김'], 'unused'],
    ['{0} letzte Messungen', ['최근 측정 {0}개', '최근 측정 기록 {0}개'], 'template'],
  ],
};
/**
 * 거꾸로 찾기 길(기록 없는 번역 글)에서 틀린 번역이 나는 「언어 열쇠 → 바꾼 언어」(한국어로 바꾸면 늘 이긴 원문 — 빼고 센다). 모두 위 목록의 unused·file·same-thing 묶음의 진 열쇠.
 * 218차: 「밝게」·「소스 코드」(zh-CN·de 각 둘)를 지워 23줄 → 15줄
 */
const REVERSE_WRONG = [
  'en 숨긴 → ja',
  'ja 식탁 → en', 'ja 식탁 → zh-CN', 'ja 식탁 → de',
  'zh-CN 숨긴 → ja',
  'zh-CN 와이어 → en', 'zh-CN 와이어 → ja', 'zh-CN 와이어 → de',
  'de 보조선 → en', 'de 보조선 → ja', 'de 보조선 → zh-CN',
  'de 보조점 → en', 'de 보조점 → ja', 'de 보조점 → zh-CN', 'de 숨긴 → ja',
];

/** 한 언어 사전의 겹친 값 묶음(거꾸로 찾기와 같은 normalize 꼴): 값 → 열쇠들 */
function groups(lang: Lang): Record<string, string[]> {
  const by = new Map<string, string[]>();
  for (const [key, text] of Object.entries(catalogs[lang]!)) {
    if (!text) continue;
    const v = normalize(text);
    by.set(v, [...(by.get(v) ?? []), key]);
  }
  return Object.fromEntries([...by].filter(([, keys]) => keys.length > 1).map(([v, keys]) => [v, [...keys].sort()]));
}
const listed = (lang: Lang): Record<string, string[]> => Object.fromEntries(LEFT[lang].map(([v, keys]) => [v, [...keys].sort()]));

/** src 아래 .ts 글(파일 이름 → 글) — 열쇠를 따옴표 글로 쓰는지 본다 */
const SRC = resolve(__dirname, '../src');
const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(resolve(SRC, f), 'utf8')] as const);
const usedIn = (key: string): string[] => sources.filter(([, text]) => ["'", '"', '`'].some((q) => text.includes(q + key + q))).map(([f]) => f);

describe('217차: 같은 언어 안 겹친 값 — 해 있는 것은 가르고, 남는 겹침은 목록으로', () => {
  it('언어마다 겹친 값 묶음이 목록과 같다(목록 밖 새 겹침·목록에 있는데 이제 안 겹침이면 실패)', () => {
    for (const lang of LANGS) expect(groups(lang), lang).toEqual(listed(lang));
  });

  it('남는 겹침의 까닭이 지금도 맞다', () => {
    for (const lang of LANGS)
      for (const [value, keys, why] of LEFT[lang]) {
        const winner = sourceMessage(value);
        const at = `${lang}: ${value}`;
        if (why === 'untranslated') expect(winner, at).toBe(value);
        else if (why !== 'template') expect(keys, at).toContain(winner);
        if (why === 'same' || why === 'untranslated') for (const other of LANGS) expect(new Set(keys.map((k) => catalogs[other]![k])).size, `${at} — ${other}`).toBe(1);
        if (why === 'unused') for (const k of keys.filter((k) => k !== winner)) expect(usedIn(k), `${at} — ${k}`).toEqual([]);
        if (why === 'file') for (const k of keys) expect(usedIn(k), `${at} — ${k}`).toEqual(['app/sample.ts']);
        if (why === 'same-thing') expect(catalogs[lang]!['보조선(안내선)·보조점을 점선으로 보입니다'], at).toBeTruthy();
        if (why === 'template') for (const k of keys) expect(k, at).toMatch(/\{\d+\}/);
      }
  });

  it('공용 규칙 9번: 네 사전 열쇠는 한글이나 {n} 틀을 품는다(og 그림 주소 하나 뺌 — 기호 열쇠는 앞뒤 빈칸을 뺀 열쇠로 찾혀 조각 글의 빈칸을 잃는다)', () => {
    for (const lang of LANGS) {
      const bare = Object.keys(catalogs[lang]!).filter((k) => !/[가-힣]/.test(k) && !/\{\d+\}/.test(k));
      expect(bare, lang).toEqual([metadataForLanguage('ko').image.url]);
      expect(bare[0], lang).toMatch(/^https:\/\/\S+\/og-opencad\.jpg$/);
    }
  });

  it('가른 값은 같은 사전의 맞는 낱말이고 거꾸로 찾으면 제 원문, 짝의 다른 쪽은 그대로다', () => {
    const fixed: [key: string, lang: Lang, value: string][] = [
      ['기본값', 'en', 'Default value'],
      ['기본값', 'zh-CN', '默认值'],
      ['기본값', 'de', 'Standardwert'],
      ['숨김', 'ja', '非表示中'],
      ['숨김', 'zh-CN', '已隐藏'],
      ['전체', 'en', 'Whole'],
      ['전체', 'zh-CN', '整个'],
      ['전체', 'de', 'Gesamt'],
    ];
    for (const [key, lang, value] of fixed) {
      expect(catalogs[lang]![key], `${lang}: ${key}`).toBe(value);
      expect(sourceMessage(value), `${lang}: ${value}`).toBe(key);
    }
    // 근거 줄: 같은 사전이 이 낱말을 쓴다
    const basis: [key: string, lang: Lang, has: string][] = [
      ['3D 보기: 재질 값이 깨진 형상 묶음에 기본값을 썼습니다', 'en', 'default values'],
      ['3D 보기: 재질 값이 깨진 형상 묶음에 기본값을 썼습니다', 'zh-CN', '默认值'],
      ['3D 보기: 재질 값이 깨진 형상 묶음에 기본값을 썼습니다', 'de', 'Standardwerte'],
      ['기본값', 'ja', '既定値'],
      ['줄자·각도기를 끈 동안: 보이는 안내점·안내선 모두 고르기(숨긴 안내는 빼고)', 'ja', '表示中'],
      ['숨긴', 'zh-CN', '已隐藏'],
      ['잠김', 'zh-CN', '已锁定'],
      ['누른 면 하나(넓이)나 모서리 하나(길이, 곡선이면 곡선 전체)를 고릅니다', 'en', 'whole curve'],
      // 218차: 217차 근거 줄 「그룹·컴포넌트 안의 단면 — 이 뷰어는 모형 전체를 자릅니다」(整个模型)는 쓰는 곳이 없어 지웠다 — 같은 사전의 다른 「전체(모두)」 줄
      ['최근 문서 목록을 모두 지웁니다(원래 파일은 그대로)', 'zh-CN', '清除整个最近文档列表'],
      ['전체 보기', 'de', 'Gesamt'],
    ];
    for (const [key, lang, has] of basis) expect(catalogs[lang]![key], `${lang}: ${key}`).toContain(has);
    // 짝의 다른 쪽(기본 태그 칩 「기본」·숨기기 버튼 「숨기기」·안내 카드 「모두」)은 그대로이고 이제 제 원문으로 돌아온다
    const kept: [key: string, values: string[]][] = [
      ['기본', ['Default', '既定', '默认', 'Standard']],
      ['숨기기', ['Hide', '非表示', '隐藏', 'Ausblenden']],
      ['모두', ['All', 'すべて', '全部', 'Alle']],
    ];
    for (const [key, values] of kept) {
      expect(LANGS.map((lang) => catalogs[lang]![key]), key).toEqual(values);
      for (const v of values) expect(sourceMessage(v), `${key}: ${v}`).toBe(key);
    }
  });
});

/**
 * 218차에 네 사전에서 지운 열쇠 58개(README 개발 절 218차 문단 — 묶음별 까닭): 포트폴리오 사이트 글 27(5개 언어 지원 #11에 다른 사이트 사전에서 함께 들어옴·
 * 옛 분석 묶음 이름), 바뀐 화면 글의 옛 원문 14(213차 시험이 「화면에 안 쓰이는 옛 열쇠」로 둔 여섯 포함), 더 긴 통째 열쇠 안 조각·주석에만 있던 짧은 글 17.
 * 쓰는 곳 셈 길: 앱 src·코어 src·사이트 키트·index.html(빈칸을 모은 글)·public·사이트 정보에 그 글이 그대로도(따옴표 글·HTML 글·나눔 글 조각·틀 꼴),
 * 조립(해석기 `깨진 ${what}…`·`그리기: ${label}` 등 — 하나씩 grep)으로도 없음. 코어·사이트 키트가 쓰는 글(「전체」·「와이어」 — 코어 개발 쪽)과
 * 틀 자리 값으로 쓰일 수 있는 글(「숨긴」)은 두었다. 「고른 안내 {0}개 지우기 (Delete)」는 두 걸음 조립(아래 셋째 it)이라 셈 길이 놓쳐 지웠다가
 * i18n.test 25차 시험(고른 안내 여럿 지우기 버튼 title)이 잡아 되살렸다.
 */
const REMOVED = [
  '3D 형상을 다룹니다', 'OpenCAD 가이드', 'OpenCAD 소개', '가공 데이터까지,', '가구 설계부터', '개념 모델', '개발 노트', '개발에 연결하는 방법', '김규태 Sean Kim',
  '다음 문제를', '도면·3D 모델·공구 경로를 엽니다', '무료 캐드 뷰어로', '본문으로 건너뛰기', '실제 화면', '어떤 도구인가요?', '연구', '연락', '오픈캐드', '작성', '정지',
  '주요 메뉴', '지금 쓸 수 있는 뷰어', '지원 범위와 확인할 점', '처음 사용하는 순서', '캐드 뷰어 사용 안내', '함께 풀어 보고 싶습니다', '현재 위치',
  '각도기: 잴 방향의 점을 누르세요 · Esc 취소', '줄자: 끝점을 누르세요 · Esc 취소', '누르면 단면을 끕니다', '누르면 이 단면으로 모형을 자릅니다',
  '그룹·컴포넌트 안의 단면 — 이 뷰어는 모형 전체를 자릅니다', '켬(이 뷰어는 아직 그림자를 그리지 않음)', '파일 스타일의 배경 색으로 보기(끄면 앱 테마 배경)',
  '지금 화면을 PNG 그림으로 저장', '3D에서 누를 때 고르는 단계', ', › 펼치기', '3D나 구성 목록에서 그룹·컴포넌트·재질을 고르면 그 정보를 보입니다.',
  '"{0}" 파일을 읽지 못했습니다', '{0}{1} — 누르면 강조, 두 번 누르면 확대{2}', '고른 것: {0}',
  '갱신', '도면층', '면 선택', '밝게', '비용', '면 고르기', '사용법·지원 범위', '설치', '소스 코드', '시스템', '어둡게', '오류', '재생', '준비 중', '코드', '프로젝트', '확인',
];

/** 화면에 글을 내는 곳: 앱 src, 코어 src, 사이트 키트, 정적 쪽 글(index.html·홈 화면 정보·사이트 정보·오프라인 쪽) */
const ROOT = resolve(__dirname, '..');
const walk = (dir: string, ext: RegExp): string[] => (readdirSync(resolve(ROOT, dir), { recursive: true }) as string[]).filter((f) => ext.test(f)).map((f) => `${dir}/${f}`);
const SHOWN = [
  ...walk('src', /\.ts$/),
  ...walk('node_modules/opencad-viewer3d/src', /\.ts$/),
  ...walk('node_modules/opencad-site-kit', /\.(?:ts|mjs|js)$/),
  ...walk('tools', /\.(?:mjs|js)$/),
  'index.html', 'public/manifest.webmanifest', 'site/metadata.json', 'site/i18n-core.mjs', 'vite.config.ts',
];
/** 주석 줄과 줄 끝 주석을 빼고 빈칸을 하나로 모은 글(줄을 나눈 HTML 글도 한 줄로 — 공용 규칙 2번) */
const codeText = (text: string): string =>
  text.split('\n').filter((l) => !/^\s*(?:\/\/|\/\*|\*)/.test(l)).map((l) => l.replace(/(^|[\s;,){])\/\/(?!\/).*$/, '$1')).join('\n').replace(/\s+/g, ' ');
const SHOWN_TEXT = SHOWN.map((f) => [f, codeText(readFileSync(resolve(ROOT, f), 'utf8'))] as const);
/**
 * 글 text에서 열쇠 key를 쓰는 꼴: 같은 따옴표로 감싼 글(앞뒤 빈칸 하나까지 — 번역층은 앞뒤 빈칸을 빼고 찾는다), HTML 글(`>…<`),
 * 나눔 글 조각(` · `·` — `·` | ` 뒤 — 번역층이 통째 열쇠가 없으면 그 조각으로 나눠 찾는다), 틀 열쇠는 조각 사이에 `${…}`·`{n}`이 든 꼴
 */
function usesAt(text: string, key: string): string[] {
  const out: string[] = [];
  if (/\{\d+\}/.test(key)) {
    const pieces = key.split(/\{\d+\}/);
    if (!text.includes([...pieces].sort((a, b) => b.length - a.length)[0]!)) return out;
    const re = new RegExp(pieces.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\$\\{[^}]*\\}|\\{\\d+\\})'), 'g');
    for (const m of text.matchAll(re)) out.push(m[0]);
    return out;
  }
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const before = text.slice(Math.max(0, i - 2), i);
    const after = text.slice(i + key.length, i + key.length + 2);
    const open = before.match(/(['"`]) ?$/)?.[1];
    const quoted = open !== undefined && open === after.match(/^ ?(['"`])/)?.[1];
    const html = /> ?$/.test(before) && /^ ?</.test(after);
    const joined = /[·—|] $/.test(before) && /^(?: [·—|]| ?['"`<])/.test(after);
    if (quoted || html || joined) out.push(text.slice(Math.max(0, i - 20), i + key.length + 20));
  }
  return out;
}
const usedFiles = (key: string): string[] => SHOWN_TEXT.filter(([, text]) => usesAt(text, key).length).map(([f]) => f);

describe('218차: 쓰는 곳 없는 사전 열쇠를 지웠다 — 다시 쓰이면 실패', () => {
  it('지운 열쇠는 네 사전 어디에도 없고, 네 사전 열쇠 집합은 같다', () => {
    expect(new Set(REMOVED).size).toBe(REMOVED.length);
    expect(REMOVED.length).toBe(58);
    for (const lang of LANGS) {
      expect(REMOVED.filter((k) => k in catalogs[lang]!), lang).toEqual([]);
      expect(Object.keys(catalogs[lang]!).sort(), lang).toEqual(Object.keys(catalogs.en!).sort());
    }
  });

  it('지운 열쇠의 글이 앱·코어·사이트 키트·정적 쪽 글에 다시 나오지 않는다(주석 빼고 — 나오면 사전에 없어 다른 언어 화면에 한국어가 남는다)', () => {
    expect(REMOVED.flatMap((k) => SHOWN_TEXT.flatMap(([f, text]) => usesAt(text, k).map((at) => `${k} — ${f}: ${at}`)))).toEqual([]);
  });

  it('셈 길은 남긴 열쇠의 쓰는 꼴을 잡는다(앞뒤 빈칸 낀 따옴표 글·HTML 글·틀), 셈 길 밖 두 걸음 조립은 둔 열쇠로 고정', () => {
    // 두 걸음 조립: 고른 안내 여럿 지우기 버튼 title은 guideDeleteLabel의 「고른 안내 ${n}개 지우기」 뒤에 ` (Delete)`를 붙인다 —
    // 틀 열쇠 「고른 안내 {0}개 지우기 (Delete)」의 조각이 한 글에 이어 있지 않아 usesAt이 못 잡는다(218차에 지웠다가 되살림)
    const measure = readFileSync(resolve(ROOT, 'src/app/measure.ts'), 'utf8');
    expect(measure).toContain('return `고른 안내 ${points + lines}개 지우기`;');
    expect(measure).toContain('b.title = `${t} (Delete)`;');
    expect(REMOVED).not.toContain('고른 안내 {0}개 지우기 (Delete)');
    for (const lang of LANGS) expect(catalogs[lang]!['고른 안내 {0}개 지우기 (Delete)'], lang).toContain('{0}');
    // 브랜드 글 칸 ' SketchUp 뷰어'(앞 빈칸 — 처음 셈에서 지울 뻔한 열쇠)·'아직 못 읽음 '(끝 빈칸)
    expect(usedFiles('SketchUp 뷰어')).toContain('src/app/app.ts');
    expect(usedFiles('아직 못 읽음')).toContain('src/app/app.ts');
    // index.html 링크 글·여러 줄 소개 글(빈칸을 모은 글)
    expect(usedFiles('GitHub 소스 코드')).toContain('index.html');
    // 틀: 패널 찾기 결과 수 글
    expect(usedFiles('찾은 항목 {0}개 중 처음 {1}개')).toContain('src/app/panel.ts');
    for (const k of ['GitHub 소스 코드', '찾은 항목 {0}개 중 처음 {1}개', 'SketchUp 뷰어', '아직 못 읽음']) expect(catalogs.en![k], k).toBeTruthy();
  });
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});
const tick = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('217차 jsdom: 겹친 값과 언어 바꾸기(실제 번역층)', () => {
  const wrong: string[] = [];
  it.each(LANGS)('%s: 앱 길(한국어 원문)은 언어를 바꿀 때·다시 그릴 때 제 원문의 번역, 거꾸로 찾기 길은 목록의 진 열쇠만 다른 원문의 번역', async (lang) => {
    const dom = new JSDOM('<!doctype html><html><head><title>OpenCAD</title></head><body><div id="app"><header class="titlebar"></header></div></body></html>', { url: languageUrl(metadataForLanguage('ko').url, lang) });
    for (const name of ['window', 'document', 'Node', 'Element', 'HTMLAnchorElement', 'MutationObserver', 'location', 'history', 'localStorage', 'CustomEvent'])
      vi.stubGlobal(name, (dom.window as unknown as Record<string, unknown>)[name]);
    const root = document.getElementById('app')!;
    dispose = await installLocalization(root);
    const keys = [...new Set(Object.values(groups(lang)).flat())];
    const put = (text: string): HTMLSpanElement => {
      const el = document.createElement('span');
      el.textContent = text;
      el.title = text;
      root.append(el);
      return el;
    };
    // 앱 길: 앱이 한국어 원문을 넣는다(번역층이 원문 기록을 남김)
    const app = keys.map((k) => [k, put(k)] as const);
    // 거꾸로 찾기 길: 원문 기록 없이 들어온 그 언어 번역 글(정적 언어 쪽 글·이미 옮긴 글을 보는 칸에 넣을 때) — 틀 열쇠는 그린 글에 수가 들어가 빼고
    const rev = keys.filter((k) => !/\{\d+\}/.test(k)).map((k) => [k, put(catalogs[lang]![k]!)] as const);
    await tick();
    for (const [k, el] of app) expect([el.textContent, el.title], `${lang}: ${k}`).toEqual([translate(k, lang), translate(k, lang)]);
    for (const [k, el] of rev) expect(el.textContent, `${lang}: ${k}`).toBe(catalogs[lang]![k]);
    for (const next of [...LANGS.filter((l) => l !== lang), 'ko']) {
      (document.querySelector(`.language-list [data-language="${next}"]`) as HTMLButtonElement).click();
      await tick();
      for (const [k, el] of app) expect([el.textContent, el.title], `${lang} → ${next}: ${k}`).toEqual([translate(k, next), translate(k, next)]);
      for (const [k, el] of rev) {
        // 거꾸로 찾기는 이긴 열쇠로만 되돌린다 — 그 번역이 제 원문의 번역과 다르면 다른 원문의 번역이 보인다
        expect([el.textContent, el.title], `${lang} → ${next}: ${k}`).toEqual([translate(sourceMessage(catalogs[lang]![k]!), next), translate(sourceMessage(catalogs[lang]![k]!), next)]);
        if (next !== 'ko' && el.textContent !== translate(k, next)) wrong.push(`${lang} ${k} → ${next}`);
      }
      // 다시 그리기: 앱이 같은 원문을 다시 넣는다
      for (const [k, el] of app) {
        el.textContent = k;
        el.title = k;
      }
      await tick();
      for (const [k, el] of app) expect([el.textContent, el.title], `${lang} → ${next} 다시 그림: ${k}`).toEqual([translate(k, next), translate(k, next)]);
    }
    dispose();
    dispose = undefined;
    dom.window.close();
  });

  it('거꾸로 찾기 길에서 틀린 번역이 나는 것은 목록의 unused·file·same-thing 묶음의 진 열쇠뿐', () => {
    expect(wrong.sort()).toEqual([...REVERSE_WRONG].sort());
    const allowed = new Set(LANGS.flatMap((lang) => LEFT[lang].filter(([, , why]) => why === 'unused' || why === 'file' || why === 'same-thing').flatMap(([v, keys]) => keys.filter((k) => k !== sourceMessage(v)).map((k) => `${lang} ${k}`))));
    for (const w of REVERSE_WRONG) expect(allowed.has(w.split(' → ')[0]!), w).toBe(true);
  });
});
