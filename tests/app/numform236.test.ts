// @vitest-environment jsdom
/**
 * 236차: 화면 글에 넣는 수 꼴. SKP는 수 꼴이 모두 고정이다 — 셈 수는 fmtCount(천 단위 쉼표 — ko-KR, 해석기·워커 글은 같은 글 en-US),
 * 측정 값은 모형 단위 글(formatLength — 천 단위 없이 「.」). 화면 언어 꼴로 바꾸지 않는다: 측정값 칸이 측정 값 글을 다시 읽고 복사 글도 그 글이며,
 * 코어가 3D에 그리는 측정 수도 언어와 상관없이 「.」이다(셈 수만 바꾸면 독일어 화면에서 「.」이 셈 수에서는 천 단위, 측정 값에서는 소수점 — 디자인 결정).
 * 고친 것: 셈 수를 fmtCount(해석기·워커는 toLocaleString('en-US'))를 비켜 날 수로 넣어 1,000이 넘는 수가 「1000」으로 보이던 칸(곁 칸은 「1,000」) —
 * 패널 단면 평면·태그·재질 칸 머리와 「처음 2000개만」 안내, 정보 탭 장면·장면 그림·경고 칸 머리와 구성 「처음 2000개만」, 해석기·워커 경고의 셈.
 * 이 시험: 고친 칸이 한국어·독일어(사전 틀 {0}에 같은 수 글)에서, 독일어에서 영어로 바꾼 뒤에도 같은 꼴, 측정값 칸·복사 글은 독일어 화면에서도
 * 고정 「.」 그대로, 소스에서 셈 낱말(개·자) 앞에 날 수를 넣는 자리는 1,000을 넘지 않는 수만(한도와 함께 목록 — 목록 밖 새 자리·목록에 있는데 없어짐이면 실패).
 * 탭 몸통 조각은 beforeAll에서 미리 받는다(공용 규칙 5번). 번역층 기다림은 DOM이 잇달아 조용할 때까지, 마감 5초(13번).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { TRACK_MAX } from 'opencad-viewer3d/track';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SECTION_PLANES, MEASURE_LOG_LIMIT, measureLine, type TagRow } from '../../src/app/doc';
import { installLocalization, uiText } from '../../src/app/i18n';
import { MAX_GUIDE_LINES, MAX_GUIDE_POINTS, type MeasureToolResult } from '../../src/app/measure';
import { Panel, loadPanelTabs, type PanelHost } from '../../src/app/panel';
import { DEFAULT_UNITS, formatLength, parseLength, usesDecimalComma } from '../../src/app/units';
import { catalogs } from '../../site/i18n.mjs';
import { rowDoc } from './rowdoc';

const noop = (): void => {};
const host: PanelHost = {
  setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop, setExpanded: noop, collapseAll: noop, setPickMode: noop,
  setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop, setFileSection: noop, applyPage: noop,
  hideSelection: noop, isolateSelection: noop, unhideAll: noop, isolated: false, measureHint: null, measureLogList: [],
  copyMeasure: noop, clearMeasureLog: noop,
  select: noop, selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
};

let tabs: Awaited<ReturnType<typeof loadPanelTabs>>;
let dispose: (() => void) | undefined;
beforeAll(async () => {
  tabs = await loadPanelTabs();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

/** 번역층을 기다린다: (lang이면 문서 언어가 그 언어가 된 뒤) DOM이 매크로 작업 네 차례 잇달아 조용할 때까지, 마감 5초(i18n.test switched 꼴) */
async function settle(lang?: string): Promise<void> {
  let changed = false;
  const watch = new MutationObserver(() => {
    changed = true;
  });
  watch.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try {
    for (let quiet = 0, end = Date.now() + 5_000; quiet < 4 && Date.now() < end; ) {
      changed = false;
      await new Promise((r) => setTimeout(r, 0));
      quiet = (lang === undefined || document.documentElement.lang === lang) && !changed ? quiet + 1 : 0;
    }
  } finally {
    watch.disconnect();
  }
}
async function install(code: 'ko' | 'de'): Promise<void> {
  dispose?.();
  document.body.innerHTML = '';
  history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
  dispose = await installLocalization(document.body);
}
const heads = (root: Element): string[] => [...root.querySelectorAll('section.psec > h3')].map((el) => el.textContent ?? '');
/** 그 언어 사전 틀(한국어는 원문 틀)에 수 글을 끼운 글 */
const filled = (code: string, key: string, n: string): string => (code === 'ko' ? key : catalogs[code]![key]!).replace('{0}', n);

/**
 * 패널 태그 탭 문서: rowDoc의 태그를 1,000개로(그 탭은 태그 줄을 모두 그린다). 단면 평면(1,000까지)·재질·「처음 2,000개만」 칸 머리는 줄을 1,000~2,000개 그려야 해
 * jsdom에서 무거워(처음 시험 18초 — 저부하) 고친 꼴은 아래 소스 시험이 지키고, 그린 칸은 태그 칸 머리 하나로 본다
 */
function tagDoc(): ReturnType<typeof rowDoc> {
  const d = rowDoc();
  d.tags = Array.from({ length: 1000 }, (_, i): TagRow => ({ name: `T${i}`, default: false, faces: 1, edges: 4, hasGeometry: true, visible: true, color: null, folder: -1, lineStyle: null }));
  return d;
}
/** 정보 탭 문서: 장면 1,000(카드는 처음 200장만 그린다)·경고 1,000(줄은 처음 300줄만) */
function infoDoc(): ReturnType<typeof rowDoc> {
  const d = rowDoc();
  d.pages = Array.from({ length: 1000 }, (_, i) => ({ name: `P${i}` }));
  d.scene.warnings = Array.from({ length: 1000 }, (_, i) => `w${i}`);
  return d;
}

describe('셈 수를 날 수로 넣던 칸이 fmtCount 꼴(천 단위 쉼표) — 독일어 화면, 언어를 바꾼 뒤에도', () => {
  it('패널 태그 칸 머리: 독일어 사전 틀에 「1,000」, 영어로 바꾸면 번역층이 원문의 같은 수 글을 새 언어 틀에 끼운다', async () => {
    await install('de');
    const panel = new Panel(host);
    document.body.append(panel.el);
    panel.el.hidden = false;
    panel.show(tagDoc());
    await settle('de');
    expect(heads(panel.el)).toContain(filled('de', '태그 {0}개', '1,000'));
    document.querySelector<HTMLButtonElement>('.language-list [data-language="en"]')!.click();
    await settle('en');
    expect(document.documentElement.lang).toBe('en');
    expect(heads(panel.el)).toContain(filled('en', '태그 {0}개', '1,000'));
  });

  it('정보 탭: 장면·경고 칸 머리 — 한국어·독일어', async () => {
    for (const code of ['ko', 'de'] as const) {
      await install(code);
      const box = document.createElement('div');
      document.body.append(box);
      box.append(...tabs.infoSections(infoDoc(), noop));
      await settle(code);
      expect.soft(heads(box), code).toContain(filled(code, '장면 {0}개', '1,000'));
      expect.soft(heads(box), code).toContain(filled(code, '경고 {0}개', '1,000'));
    }
  });
});

describe('기계가 다시 읽는 글은 화면 언어와 상관없이 고정 「.」', () => {
  it('독일어 화면: 측정값 칸에 넣는 측정 값 글과 측정 복사 글은 「1234.5 mm」 그대로이고 칸이 그 글을 다시 읽는다', async () => {
    await install('de');
    expect(document.documentElement.lang).toBe('de');
    const units = { ...DEFAULT_UNITS, lengthPrecision: 1 };
    const shown = formatLength(1234.5, units);
    expect(shown).toBe('1234.5 mm');
    // 독일어는 소수 쉼표를 쓰는 언어라 칸은 쳐 넣은 「1,5」도 1.5로 읽고, 칸에 보인 측정 값 글(「.」)도 그대로 다시 읽는다
    const comma = usesDecimalComma(document.documentElement.lang);
    expect(comma).toBe(true);
    expect(parseLength(shown, units, comma)).toBe(1234.5);
    expect(parseLength('1,5', units, comma)).toBe(1.5);
    // 화면 언어 꼴(「1.234,5」)로 보였다면 지금 읽기 규칙(점이 있으면 쉼표를 소수점으로 보지 않음)으로 읽지 못한다 — 측정 값을 바꾸지 않는 까닭
    expect(parseLength('1.234,5 mm', units, comma)).toBeNull();
    // 복사 글(app.ts copyMeasure — 화면 언어로 옮기되 수 글은 그대로)
    const m: MeasureToolResult = { kind: 'tape', a: [0, 0, 0], b: [1234.5, 0, 0], distance: 1234.5, dx: 1234.5, dy: 0, dz: 0 };
    const line = uiText(measureLine(m, units, 1));
    expect(line).toContain('1234.5 mm');
    expect(line).not.toContain('1.234,5');
    expect(line).not.toMatch(/[가-힣]/);
  });
});

const SRC = resolve(__dirname, '../../src');
const read = (f: string): string => readFileSync(resolve(SRC, f), 'utf8');
/** 주석 줄과 줄 끝 주석을 뺀 줄(i18n-collide174 codeText 꼴 — 줄 차례는 그대로) */
const codeLines = (text: string): string[] =>
  text.split('\n').map((l) => (/^\s*(?:\/\/|\/\*|\*)/.test(l) ? '' : l.replace(/(^|[\s;,){])\/\/(?!\/).*$/, '$1')));
const constOf = (f: string, name: string): number => Number(new RegExp(`export const ${name} = ([\\d_]+);`).exec(read(f))![1]!.replace(/_/g, ''));
/** 셈 낱말(개·자) 바로 앞에 끼운 수 */
const SLOT = /\$\{([^{}]*)\}(?=개|자[ )(])/g;
/** 천 단위 꼴: 앱 fmtCount, 해석기·워커·앱 바로 쓰기 toLocaleString('en-US'·'ko-KR') */
const GROUPED = /^fmtCount\(|\.toLocaleString\('(?:ko-KR|en-US)'\)$/;
/** 날 수로 두는 자리 — 늘 1,000 아래라 천 단위 꼴과 보이는 글이 같다: [파일, 식, 한도, 까닭] */
const BOUNDED: [file: string, expr: string, limit: number, why: string][] = [
  ['app/app.ts', 'this.measureLog.length', MEASURE_LOG_LIMIT, '최근 측정 기록 칸 수'],
  ['app/measure.ts', 'n', TRACK_MAX, '끌어온 점 — 코어 MeasureTracker가 최근 TRACK_MAX개까지'],
  ['app/measure.ts', 'points', MAX_GUIDE_POINTS, '고른 안내점 — 두는 안내점 한도'],
  ['app/measure.ts', 'lines', MAX_GUIDE_LINES, '고른 안내선 — 두는 안내선 한도'],
  ['app/measure.ts', 'points + lines', MAX_GUIDE_POINTS + MAX_GUIDE_LINES, '고른 안내'],
  ['app/vcb.ts', 'p', MAX_GUIDE_POINTS, '측정값 칸 안내점 지우기'],
  ['app/vcb.ts', 'l', MAX_GUIDE_LINES, '측정값 칸 안내선 지우기'],
  ['app/panel.ts', 'MAX_FILE_SECTIONS', MAX_SECTION_PLANES, '한 번에 쓰는 파일 단면'],
  ['scene.ts', 'MAX_BILLBOARDS', constOf('scene.ts', 'MAX_BILLBOARDS'), '카메라를 보는 컴포넌트 한도'],
  ['scene.ts', 'MAX_REVEAL_NODES', constOf('scene.ts', 'MAX_REVEAL_NODES'), '장면에서 다시 보이는 숨긴 노드 한도'],
  ['index.ts', 'max', constOf('index.ts', 'MAX_SKP_TEXTURES'), '무늬 재질 한도(앱·워커는 maxTextures를 넘기지 않는다)'],
];

describe('소스: 셈 낱말 앞에 날 수를 넣는 자리', () => {
  it('천 단위 꼴을 비켜 날 수를 넣는 자리는 1,000을 넘지 않는 수만(목록), 천 단위 꼴 자리는 앱·해석기 모두에 있다', () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split(sep).join('/'));
    const slots = files.flatMap((file) =>
      codeLines(read(file)).flatMap((line, i) => [...line.matchAll(SLOT)].map((m) => ({ at: `${file}:${i + 1}`, file, expr: m[1]!.trim() }))),
    );
    const grouped = slots.filter((s) => GROUPED.test(s.expr));
    const raw = slots.filter((s) => !GROUPED.test(s.expr));
    expect(raw.filter((s) => !BOUNDED.some(([f, e]) => f === s.file && e === s.expr)).map((s) => `${s.at} ${s.expr}`)).toEqual([]);
    for (const [f, e, limit, why] of BOUNDED) {
      expect(raw.some((s) => s.file === f && s.expr === e), `${f}: ${e}`).toBe(true);
      expect(limit, `${f}: ${e} — ${why}`).toBeLessThan(1000);
    }
    expect(files.filter((f) => /^(?:app|worker)\//.test(f) && read(f).includes('maxTextures'))).toEqual([]);
    // 셈이 비지 않는 대조: 236차 뒤 64자리(앞 41 + 고친 23)
    expect(grouped.length).toBeGreaterThanOrEqual(60);
    expect(grouped.some((s) => s.file.startsWith('app/'))).toBe(true);
    expect(grouped.some((s) => !s.file.startsWith('app/'))).toBe(true);
  });
});
