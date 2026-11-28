// @vitest-environment jsdom
/**
 * 235차: 포인터 대상 크기(WCAG 2.5.8 대상 크기(최소) — 24×24 CSS px. 작으면 대상 상자 가운데 지름 24px 원이 다른 대상·다른 작은 대상의 원과 겹치지 않아야 하고(간격 예외),
 * 같은 기능의 다른 포인터 대상·글줄 안 링크·브라우저 기본 꼴·꼭 그 꼴이어야 함도 예외 — 키보드 길은 예외가 아님).
 * 43차는 손가락 화면, 169차는 마우스 화면을 styles.css로 손셈했다. 이 시험은
 * (1) 실제 앱 틀(SkpViewerApp.mount)에 번역층(언어 메뉴)과 예제 문서를 넣어 넓은 화면·휴대폰 꼴(matchMedia 흉내 — 앱이 미디어 질의로 고르는 마디까지)로 처음 화면·제목 막대·도구 막대·
 *     측정 띠·고른 것 카드·카메라 띠·새 판 띠·상태 막대·장면 탭·패널 네 탭(나무는 모두 펼침)·앱 설정 메뉴·알림을 그리고, 누를 수 있는 마디를 모두 모아 감사 표(AUDIT —
 *     .runtime/r235/progress.md 표의 줄 번호)의 한 줄에 드는지 본다. 새 누를 칸이 생기면 표에 크기와 판정을 더해야 통과한다(크기 감사가 낡지 않게).
 * (2) 고친 것: 나무 줄 펼치기(18×18)의 누르는 자리를 마우스 화면에서도 투명 ::after로 24×24(줄 안쪽 3px·옆 체크와 사이 6px 틈의 반 — 보이는 꼴 그대로, 손가락 화면은 43차 규칙).
 * (3) 고르지 않고 둔 것(나무 줄 보이기 체크 15·창 가르개 6·좁은 마우스 창 시트 손잡이 14)은 지금도 24 아래임을 본다(고치면 표와 이 줄을 함께 고친다 — 214차 LEFT 꼴).
 * jsdom은 배치를 하지 않으므로 크기는 styles.css 규칙을 미디어 조건(폭·높이·pointer)으로 골라, 같은 선택자의 선언을 원문 차례로 덮어 읽는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { skpToScene } from '../../src/index';
import { createDoc, type SkpDoc } from '../../src/app/doc';
import { SAMPLE_NAME, sampleSkpBytes } from '../../src/app/sample';
import { installLocalization } from '../../src/app/i18n';
import { SkpViewerApp } from '../../src/app/app';
import type { Panel } from '../../src/app/panel';

// ───────────────────────── styles.css 규칙 읽기 ─────────────────────────

interface Rule {
  sels: string[];
  body: string;
  media: string[];
}

/** 규칙 목록(주석을 뺀 글 — @media는 안으로 들어가며 조건을 쌓고, 다른 @ 규칙은 건너뜀) */
function readRules(src: string, media: string[] = [], out: Rule[] = []): Rule[] {
  for (let i = 0; ; ) {
    const open = src.indexOf('{', i);
    if (open < 0) return out;
    let depth = 1;
    let j = open + 1;
    for (; j < src.length && depth; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    const head = src.slice(i, open).trim();
    const inner = src.slice(open + 1, j - 1);
    if (head.startsWith('@media')) readRules(inner, [...media, head.slice(6).trim()], out);
    else if (!head.startsWith('@')) out.push({ sels: head.split(',').map((s) => s.trim()), body: inner, media });
    i = j;
  }
}

const RULES = readRules(readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));

/** 화면 꼴(CSS 폭·높이, 손가락이면 pointer: coarse) */
interface Form {
  name: string;
  w: number;
  h: number;
  coarse: boolean;
}
const WIDE: Form = { name: '넓은 화면(마우스 1280×800)', w: 1280, h: 800, coarse: false };
const NARROW: Form = { name: '좁은 마우스 창(600×800 — 400% 확대·작은 창)', w: 600, h: 800, coarse: false };
const PHONE: Form = { name: '휴대폰(손가락 390×844)', w: 390, h: 844, coarse: true };
const TABLET: Form = { name: '태블릿(손가락 1024×768)', w: 1024, h: 768, coarse: true };

/** 미디어 조건 하나(이 앱이 쓰는 것만 — 폭·높이·pointer, 나머지(움직임 줄이기·고대비·인쇄·홈 화면 앱)는 맞지 않음) */
function feature(f: string, m: Form): boolean {
  const q = f.trim().match(/^\(\s*([\w-]+)\s*:\s*([^)]*?)\s*\)$/);
  if (!q) return ['screen', 'all'].includes(f.trim());
  const [, k, v] = q as unknown as [string, string, string];
  if (k === 'pointer') return v === (m.coarse ? 'coarse' : 'fine');
  if (k === 'max-width') return m.w <= parseFloat(v);
  if (k === 'min-width') return m.w >= parseFloat(v);
  if (k === 'max-height') return m.h <= parseFloat(v);
  if (k === 'min-height') return m.h >= parseFloat(v);
  return false;
}
const mediaMatch = (q: string, m: Form): boolean => q.split(',').some((part) => part.split(/\s+and\s+/).every((f) => feature(f, m)));

/** 선택자들(구체성 낮은 것부터)이 그 꼴에서 받는 선언 — 조건이 맞는 규칙을 선택자 차례·원문 차례로 덮음 */
function decls(m: Form, ...sels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sel of sels)
    for (const r of RULES)
      if (r.sels.includes(sel) && r.media.every((q) => mediaMatch(q, m)))
        for (const d of r.body.split(';')) {
          const c = d.indexOf(':');
          if (c > 0) out.set(d.slice(0, c).trim(), d.slice(c + 1).trim());
        }
  return out;
}
const px = (v: string | undefined): number => (v && /^-?\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : 0);
/** inset 줄임 꼴(1~4 값) → 위·오른쪽·아래·왼쪽 */
function insets(v: string | undefined): [number, number, number, number] {
  const p = (v ?? '').split(/\s+/).filter(Boolean).map(px);
  const [t = 0, r = t, b = t, l = r] = p;
  return [t, r, b, l];
}

/** 나무 줄 펼치기의 누르는 자리(단추 상자 + 투명 ::after — inset은 단추 안쪽 여백 상자에서 잼, 단추 테두리 0) */
function twistyHit(m: Form): { w: number; h: number; position: string | undefined; content: string | undefined; ext: [number, number, number, number] } {
  const box = decls(m, '.twisty');
  const after = decls(m, '.trow .twisty::after');
  const ext = insets(after.get('inset')).map((v) => Math.max(0, -v)) as [number, number, number, number];
  const on = after.get('content') !== undefined && after.get('position') === 'absolute';
  return {
    w: px(box.get('width')) + (on ? ext[1] + ext[3] : 0),
    h: px(box.get('height')) + (on ? ext[0] + ext[2] : 0),
    position: decls(m, '.trow .twisty').get('position'),
    content: after.get('content'),
    ext,
  };
}

/** flex 줄임 꼴의 기준 크기(flex-basis가 있으면 그것 — 이 원문은 flex 뒤에만 flex-basis를 둔다) */
const basis = (d: Map<string, string>): number => px(d.get('flex-basis')) || px(d.get('flex')?.split(/\s+/)[2]);

describe('235차: 나무 줄 펼치기는 마우스 화면에서도 누르는 자리 24×24(WCAG 2.5.8 — 보이는 꼴 그대로)', () => {
  it.each([WIDE, NARROW, PHONE, TABLET])('$name: 펼치기 18×18에 투명 ::after — 누르는 자리 24 이상, 줄 밖·옆 체크 쪽 틈의 반을 넘지 않음', (m) => {
    const t = twistyHit(m);
    // 단추 상자는 보이는 꼴 그대로(18×18 — 169·180차: 키우면 이름 열이 밀림)
    expect(px(decls(m, '.twisty').get('width')), m.name).toBe(18);
    expect(px(decls(m, '.twisty').get('height')), m.name).toBe(18);
    // ::after는 펼치기 단추를 기준으로(position: relative가 없으면 가까운 자리 잡은 조상 — 패널 전체를 덮는다)
    expect(t.position, m.name).toBe('relative');
    expect(t.content, m.name).toBe("''");
    expect(t.w, m.name).toBeGreaterThanOrEqual(24);
    expect(t.h, m.name).toBeGreaterThanOrEqual(24);
    // 줄(고르기 대상) 안: 위아래로 넓힌 몫은 줄 높이(최소 높이)에서 단추를 뺀 반 이하, 오른쪽은 옆 보이기 체크와 사이 틈의 반 이하(체크 쪽 반은 남김)
    const row = decls(m, '.prow', '.prow.trow');
    const rowMin = px(row.get('min-height'));
    expect(Math.max(t.ext[0], t.ext[2]), m.name).toBeLessThanOrEqual((rowMin - 18) / 2);
    expect(t.ext[1], m.name).toBeLessThanOrEqual(px(row.get('gap')) / 2);
  });
});

describe('235차: 고르지 않고 둔 작은 대상은 지금도 24 아래(표와 함께 — 고치면 이 줄과 progress.md·README를 함께 고친다)', () => {
  it('나무·윗단계·찾기 줄의 보이기 체크: 마우스 화면 15×15(키우면 그림이 커짐 — 디자인 결정, 입력 칸에는 ::after 자리를 붙이지 못함), 손가락 화면은 43차 24×24', () => {
    const cb = (m: Form): Map<string, string> => decls(m, "input[type='checkbox']", ".prow.pick > input[type='checkbox']");
    for (const m of [WIDE, NARROW]) expect([px(cb(m).get('width')), px(cb(m).get('height'))], m.name).toEqual([15, 15]);
    for (const m of [PHONE, TABLET]) expect([px(cb(m).get('width')), px(cb(m).get('height'))], m.name).toEqual([24, 24]);
  });

  it('창 가르개: 넓은 화면·태블릿 폭 6px, 좁은 마우스 창 시트 손잡이 높이 14px(넓히면 3D 보기나 패널 첫 탭·나무 줄을 덮음), 휴대폰은 43차 24px', () => {
    expect(basis(decls(WIDE, '.resizer'))).toBe(6);
    expect(basis(decls(TABLET, '.resizer'))).toBe(6);
    expect(basis(decls(NARROW, '.resizer'))).toBe(14);
    expect(basis(decls(PHONE, '.resizer'))).toBe(24);
    // 넓은 화면 가르개는 패널 첫 6px 위에 겹쳐 놓인다(margin −6 — 3D 보기는 덮지 않음), 보이는 막대는 가운데 2px
    expect(decls(WIDE, '.resizer').get('margin-right')).toBe('-6px');
    expect(decls(WIDE, '.resizer::after').get('inset')).toBe('0 2px 0 2px');
  });
});

// ───────────────────────── 앱 화면의 누를 수 있는 마디 ─────────────────────────

/**
 * 감사 표(progress.md 표의 줄 번호): 앞에서부터 처음 맞는 선택자 한 줄. 대상 안의 작은 대상(펼치기·체크)과 이름표·막대처럼 앞서 가려야 하는 것을 먼저 둔다
 */
const AUDIT: readonly (readonly [sel: string, row: number])[] = [
  ['.trow .twisty', 15],
  [".prow.pick > input[type='checkbox']", 16],
  ['.fov-range', 25],
  ['.sec-range', 6],
  ['label input', 17],
  ['label.vcb-label', 24],
  ['label.fov', 25],
  ['label.prow', 14],
  ['.prow.pick', 14],
  ['.ml-copy-btn', 12],
  ['.mini-btn', 11],
  ['.seg-btn', 13],
  ['.resizer', 36],
  ['.ptab', 9],
  ['.scene-tab', 7],
  ['.scene-play', 8],
  ['.icon-btn', 10],
  ['.language-trigger', 3],
  ['.language-list button', 4],
  ['.menu-item', 30],
  ['.titlebar .tbtn', 1],
  ['.tbtn', 5],
  ['a.brand', 2],
  ['.mb-btn', 23],
  ['.vcb-btn, .vcb-input', 24],
  ['.st-warn', 26],
  ['.btn, .dropzone', 27],
  ['.start .foot a', 28],
  ['.recent-open, .recent-del, .recent-clear', 29],
  ['.search-input', 18],
  ['.measure-history > summary', 19],
  ['.attr-dict > summary', 20],
  ['tr.pick, button.def-cell', 21],
  ['button.scene-card', 22],
  ['.ex-opt', 31],
  ['.ml-row', 32],
  ['.walk-stick', 33],
  ['textarea.attr-full', 35],
  ["input[type='file'][hidden], .sc-body", 37],
];

/**
 * 누를 수 있는 마디(버튼·링크·입력·접기·라벨·창 가르개·탭·나무 줄·메뉴 항목·조이스틱·초점 받는 칸, 누르면 고르는 표 줄·끌어 놓기 칸).
 * separator는 초점 받는 것(창 가르개)만 — 메뉴 안 가름줄(.menu-sep)은 누를 수 없는 꾸밈(고치기 전 시험이 잡음)
 */
const CLICK =
  'button, a[href], input, textarea, select, summary, label, [role=separator][tabindex], [role=tab], [role=treeitem], [role^=menuitem], [role=application], [tabindex]:not([tabindex="-1"]), tr.pick, .dropzone';

const sig = (el: Element): string => `${el.localName}${[...el.classList].map((c) => `.${c}`).join('')}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`;

/** 시험에서 부르는 앱 안쪽(문서를 연 뒤 앱이 부르는 화면 갱신 함수·메뉴·알림 — uilang214 꼴) */
interface Inner {
  doc: SkpDoc | null;
  panel: Panel;
  refreshChrome(): void;
  renderSceneTabs(): void;
  toggleThemeMenu(): void;
  closeMenu(): void;
  showNotice(kind: 'warn', title: string, text: string): boolean;
}

/** DOM이 매크로 작업 k 차례 잇달아 조용할 때까지(MutationObserver — 공용 규칙 13번, 마감 5초) */
const tick = async (k = 3): Promise<void> => {
  let changed = false;
  const watch = new MutationObserver(() => {
    changed = true;
  });
  watch.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try {
    for (let quiet = 0, end = Date.now() + 5_000; quiet < k && Date.now() < end; ) {
      changed = false;
      await new Promise((r) => setTimeout(r, 0));
      quiet = changed ? 0 : quiet + 1;
    }
  } finally {
    watch.disconnect();
  }
};
/** 처음 그릴 때 받는 조각(정보 탭·속성 사전 칸)을 시간으로 기다린다 */
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  await tick();
};

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 패널이 기다리지 않고 받는 조각(탭 몸통 — panel.ts loadPanelTabs, 속성 사전 — infotab.ts)을 미리(ci-guard 5 — 시험 파일이 끝난 뒤 모듈을 평가하지 않게, uilang214 꼴)
  await (await import('../../src/app/panel')).loadPanelTabs();
  await import('../../src/app/attrview');
  // jsdom에는 scrollIntoView가 없다(장면 탭·패널이 고른 줄을 보이는 자리로 굴린다)
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** 그 꼴로 앱 화면을 차례로 그리며 누를 수 있는 마디를 모은다 */
async function collect(m: Form): Promise<Element[]> {
  // 앱은 만들 때 미디어 질의(좁은 화면·휴대폰·손가락)를 잡는다 — 그 꼴의 matchMedia로
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: mediaMatch(q, m), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  history.replaceState(null, '', '/opencad-skp/');
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new SkpViewerApp(root);
  app.mount();
  const a = app as unknown as Inner;
  dispose = await installLocalization(root);
  await tick();
  const seen = new Set<Element>();
  const take = (): void => document.querySelectorAll(CLICK).forEach((el) => seen.add(el));
  take();
  // 예제 문서(앱의 「예제 열기」와 같은 모형) — 장면 탭·상태 막대·패널
  const bytes = sampleSkpBytes(undefined, (s) => s);
  const d = createDoc(SAMPLE_NAME, bytes.length, { scene: skpToScene(bytes, { name: SAMPLE_NAME, outline: true }), ms: 12 });
  a.doc = d;
  a.refreshChrome();
  a.renderSceneTabs();
  await tick();
  take();
  for (const tab of ['tags', 'outline', 'info'] as const) {
    d.panelTab = tab;
    a.panel.show(d);
    await (tab === 'info' ? until(() => !!a.panel.el.querySelector('.scene-card')) : tick());
    take();
  }
  d.panelTab = 'outline';
  for (let i = 0; i < (d.tree?.count ?? 0); i++) d.expanded.add(i);
  a.panel.rerender();
  await tick();
  take();
  // 고른 것 탭(속성 사전 칸·패널 아래 띠 버튼 줄)
  d.panelTab = 'entity';
  d.selection = { kind: 'node', index: 0 };
  a.panel.rerender();
  await until(() => !a.panel.el.querySelector('.pbody > div:empty'), 2000);
  take();
  // 앱 설정 메뉴·알림
  a.toggleThemeMenu();
  await tick();
  take();
  a.closeMenu();
  a.showNotice('warn', '시험 알림', '알림 본문');
  await tick();
  take();
  return [...seen];
}

describe('235차: 앱 화면의 누를 수 있는 마디는 모두 크기 감사 표의 한 줄에 든다(새 누를 칸은 표에 크기와 판정을 더한다)', () => {
  it.each([WIDE, PHONE])('$name', async (m) => {
    const els = await collect(m);
    const rows = new Set<number>();
    const missing = new Set<string>();
    for (const el of els) {
      const hit = AUDIT.find(([sel]) => el.matches(sel));
      if (hit) rows.add(hit[1]);
      else missing.add(sig(el));
    }
    expect([...missing].sort(), m.name).toEqual([]);
    // 그린 화면이 주요 칸을 다 품었는지(제목·도구 막대·패널 탭·닫기·작은 버튼·누르기 방식·패널 줄·펼치기·보이기 체크·장면 탭·측정 띠·상태 막대 경고·메뉴·언어·가르개)
    for (const r of [1, 3, 4, 5, 7, 9, 10, 11, 13, 14, 15, 16, 23, 24, 26, 27, 30, 36]) expect(rows.has(r), `${m.name}: 표 ${r}번 줄`).toBe(true);
  });
});
