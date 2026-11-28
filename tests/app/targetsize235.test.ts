// @vitest-environment jsdom
/**
 * 235차: 포인터 대상 크기(WCAG 2.5.8 대상 크기(최소) — 24×24 CSS px. 작으면 대상 상자 가운데 지름 24px 원이 다른 대상·다른 작은 대상의 원과 겹치지 않아야 하고(간격 예외),
 * 같은 기능의 다른 포인터 대상·글줄 안 링크·브라우저 기본 꼴·꼭 그 꼴이어야 함도 예외 — 키보드 길은 예외가 아님).
 * 43차는 손가락 화면, 169차는 마우스 화면을 styles.css로 손셈했다. 이 시험은
 * (1) 실제 앱 틀(SkpViewerApp.mount)에 번역층(언어 메뉴)과 예제 문서를 넣어 넓은 화면·휴대폰 꼴(matchMedia 흉내 — 앱이 미디어 질의로 고르는 마디까지)로 처음 화면·제목 막대·도구 막대·
 *     측정 띠·고른 것 카드·카메라 띠·새 판 띠·상태 막대·장면 탭·패널 네 탭(나무는 모두 펼침)·앱 설정 메뉴·알림을 그리고, 누를 수 있는 마디를 모두 모아 감사 표(AUDIT —
 *     .runtime/r235/progress.md 표의 줄 번호)의 한 줄에 드는지 본다. 새 누를 칸이 생기면 표에 크기와 판정을 더해야 통과한다(크기 감사가 낡지 않게).
 * (2) 고친 것: 나무 줄 펼치기(18×18)의 누르는 자리를 마우스 화면에서도 투명 ::after로 24×24(줄 안쪽 3px·옆 체크와 사이 6px 틈의 반 — 보이는 꼴 그대로, 손가락 화면은 43차 규칙).
 * (3) 고르지 않고 둔 것(창 가르개 6·좁은 마우스 창 시트 손잡이 14)은 지금도 24 아래임을 본다(고치면 표와 이 줄을 함께 고친다 — 214차 LEFT 꼴).
 * (4) 237차 고친 것: 나무·윗단계·찾기 줄의 보이기 체크(마우스 15×15 — 235차 「고르지 않음」)는 보이는 꼴·마디 그대로 두고, 체크 둘레 줄 바탕 누름을 체크로 넘겨 누르는 자리 24×24
 *     (infotab.ts treeBox 캡처 — 라벨로 감싸지 않아 rove·손가락 규칙·키·이름 그대로, .runtime/r237/progress.md 표).
 * (5) 239차: 같은 표의 줄마다 키보드 길(KEYS — WCAG 2.1.1 키보드·2.4.7 초점 보임·2.5.7 끌기 움직임, .runtime/r239/progress.md 표). 그린 마디마다 키보드로 닿는 꼴(Tab 차례·무리 안 화살표·
 *     열린 메뉴·같은 일을 하는 다른 칸·바로 가기)과 기본 동작이 없는 마디의 키 처리 자리가 표에 맞아야 통과한다(새 누를 칸은 키보드 판정도 표에 더한다). 초점 꼴을 다시 적는 styles.css 규칙,
 *     끌기로 하는 일의 끌지 않는 길(창 가르개 한 번 누르기·키, 조이스틱 누르고 있기)도 본다. 고친 것: 찾은 줄의 조상 펼치기를 누르기처럼 Enter·Space로도(infotab.ts searchRow).
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
import { SHORTCUTS } from '../../src/app/shortcuts';
import { WalkStick } from '../../src/app/joystick';
import { PANEL_WIDTH_STEPS, SHEET_STEPS } from '../../src/app/layout';
import { nodeName, nodePath } from '../../src/app/tree';

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

// ───────────────────────── 239차: 줄마다 키보드 길 ─────────────────────────

/** 키보드로 닿는 꼴: Tab 차례 · 무리(tablist·tree) 안 화살표로 돎(로빙) · 메뉴 버튼으로 연 메뉴 안 · 같은 일을 하는 다른 칸이 닿음 · 같은 일을 하는 바로 가기 */
type Reach = 'tab' | 'rove' | 'menu' | 'via' | 'keys';

interface KeyPath {
  /** (가) 그 줄 마디가 키보드로 닿는 꼴 — 그린 마디마다 센 꼴이 이 가운데 하나여야 한다. 빈 목록은 누름 대상 아님 */
  reach: readonly Reach[];
  /** (나) 기본 동작(Enter·Space)이 없는 마디 가운데 키 처리 자리가 있는 꼴(그 선택자에 드는 마디만 — 자리는 why) */
  own?: string;
  /** reach keys: 바로 가기 안내(SHORTCUTS)의 묶음과 줄 글 */
  shortcut?: readonly [group: string, labels: readonly string[]];
  /** (다) 초점 꼴: 전역 :focus-visible 테두리, 그 칸 규칙 선택자(styles.css에 있어야 함), 코어가 그리는 3D 보기 테두리 */
  focus: string;
  /** (라) 포인터 끌기로 하는 일이 있으면 끌지 않는 길 */
  drag?: string;
  /** 근거(코드 자리) */
  why: string;
}

/** 키보드 길 표(줄 번호는 AUDIT·progress.md 표와 같음 — 34번 3D 보기는 코어 캔버스라 jsdom에 그리지 않아 표에만) */
const KEYS: Readonly<Record<number, KeyPath>> = {
  1: { reach: ['tab'], focus: '전역', why: '제목 막대 button·a' },
  2: { reach: ['tab'], focus: '전역', why: 'a[href]' },
  3: { reach: ['tab'], focus: '.language-trigger:focus-visible', why: '사이트 키트 button(↑↓로도 목록 열기)' },
  4: { reach: ['menu'], focus: '.language-list button:focus-visible', why: '열면 지금 언어로 초점, ↑↓·Home·End(사이트 키트 language-menu)' },
  5: { reach: ['tab'], focus: '전역', why: '도구 막대 button, ←→·Home·End(kbd.ts toolbarKeys)' },
  6: { reach: ['tab'], focus: '전역', drag: '손잡이 끌기 — 막대 위 누르기·화살표·Home·End(브라우저 기본)', why: 'input range' },
  7: { reach: ['tab', 'rove'], focus: '전역', why: '고른 탭만 Tab, ←→·Home·End(app.ts renderSceneTabs)' },
  8: { reach: ['tab'], focus: '전역', why: 'button(장면 재생 막대는 없음 — 재생·멈추기 버튼과 장면 탭뿐)' },
  9: { reach: ['tab', 'rove'], focus: '전역', why: '고른 탭만 Tab, ←→·Home·End(panel.ts 탭 줄)' },
  10: { reach: ['tab'], focus: '전역', why: 'button' },
  11: { reach: ['tab', 'rove'], focus: '전역', why: 'button(나무 더 보기는 treeitem — 돎)' },
  12: { reach: ['tab'], focus: '전역', why: 'button' },
  13: { reach: ['tab'], focus: '전역', why: 'button' },
  14: { reach: ['tab', 'rove', 'via'], own: '[role=treeitem]', focus: '전역', why: '라벨 줄은 안 체크, 단면·재질은 button, 나무 줄은 treeKeys·rove와 bindPick Enter·Space(두 번 누르기 확대는 키 없음 — 고르지 않음)' },
  15: { reach: ['via'], focus: '전역', why: '그 줄의 →·←(infotab.ts nodeRow)' },
  16: { reach: ['tab', 'rove'], focus: '전역', why: '지금 줄의 체크만 Tab(kbd.ts rove withBox), Space는 체크 몫' },
  17: { reach: ['tab'], focus: '전역', why: 'input' },
  18: { reach: ['tab'], focus: '.search-input:focus-visible', why: 'input search(Esc로 지움)' },
  19: { reach: ['tab'], focus: '전역', why: 'summary' },
  20: { reach: ['tab'], focus: '전역', why: 'summary' },
  21: { reach: ['tab', 'via'], focus: '전역', why: '줄은 줄 안 버튼(누름이 줄로 오름 — 두 번 누르기 맞춰 보기는 키 없음, 고르지 않음)' },
  22: { reach: ['tab'], focus: '전역', why: 'button' },
  23: { reach: ['tab'], focus: '전역', why: 'button' },
  24: { reach: ['tab', 'via'], focus: '전역', why: 'input·button, 이름표는 for로 입력' },
  25: { reach: ['tab', 'via'], focus: '전역', drag: '6과 같음', why: 'input range, 라벨은 안 막대' },
  26: { reach: ['tab'], focus: '전역', why: 'button' },
  27: { reach: ['tab', 'via'], focus: '전역', drag: '파일 끌어 놓기 — 파일 열기 버튼 누르기·Ctrl+O', why: '칸은 안 두 버튼(44차)' },
  28: { reach: ['tab'], focus: '전역', why: 'a[href]' },
  29: { reach: ['tab'], focus: '전역', why: 'button' },
  30: { reach: ['menu'], focus: '.menu-item:focus-visible', why: '열면 고른 항목·첫 항목으로 초점, ↑↓·Home·End, Tab은 닫고 다음(app.ts openMenu)' },
  31: { reach: ['via'], focus: '전역', why: '라벨 안 radio·checkbox' },
  32: { reach: ['tab'], focus: '전역', why: 'button' },
  33: { reach: ['keys'], shortcut: ['걷기(1인칭)', ['앞 · 뒤로', '옆으로']], focus: '코어', drag: '손잡이 끌기 — 누르고 있기만 해도 누른 자리 쪽으로(joystick.ts pointerdown)', why: '3D 보기 초점에서 걷기 키(walkkeys)' },
  34: { reach: ['tab'], focus: '코어', drag: '돌리기·옮기기 끌기 — 뷰 큐브·표준 뷰는 정한 방향만, 자유 각도는 없음(고르지 않음)', why: '코어 캔버스 tabindex 0, 가상 커서·1~7·F·PageUp·PageDown·Shift+F10' },
  35: { reach: ['tab'], focus: '전역', why: 'textarea' },
  36: { reach: ['tab'], own: '[role=separator]', focus: '.resizer:focus-visible::after', drag: '끌기 — 한 번 누르기 다음 크기 단계·두 번 누르기 처음 크기', why: 'app.ts bindResizer 화살표·Shift·Enter·Space·Home·End, applyLayout aria-valuenow' },
  37: { reach: [], own: '.sc-body', focus: '.sc-body:focus-visible', why: '누름 대상 아님(숨긴 파일 입력, 굴리는 본문은 브라우저 굴리기 키)' },
};

/** 기본 동작(Enter·Space — 링크는 Enter)이 있는 마디 */
const NATIVE = 'button, a[href], input, textarea, select, summary';
/** 스스로 Tab 차례(jsdom tabIndex — 기본 초점 칸이면 0, tabindex 속성이면 그 값) */
const tabbable = (el: Element): boolean => (el as HTMLElement).tabIndex >= 0;
/** 꺼진 칸(꺼진 입력을 품은 라벨도)은 누름 대상이 아니다 */
const off = (el: Element): boolean => (el as HTMLButtonElement).disabled === true || (el instanceof HTMLLabelElement && (el.control as HTMLInputElement | null)?.disabled === true);
/** 같은 일을 하는 키보드 칸: 라벨은 그 입력, 정의 표 줄·끌어 놓기 칸은 안 버튼, 펼치기는 펼침 상태가 있는 그 줄(→·←) */
function viaOf(el: Element): Element | null {
  if (el instanceof HTMLLabelElement) return el.control ?? el.querySelector('input, select, textarea');
  if (el.matches('tr.pick, .dropzone')) return el.querySelector('button');
  if (el.matches('.trow .twisty')) return el.closest('[role=treeitem][aria-expanded]');
  return null;
}
/** 바로 가기 안내에 그 묶음·줄이 있는가 */
const hasShortcut = (s: KeyPath['shortcut']): boolean => !!s && s[1].every((label) => SHORTCUTS.some((g) => g.title === s[0] && g.items.some((it) => it.label === label)));

/** 마디가 키보드로 닿는 꼴(없으면 none) */
function reachOf(el: Element, k?: KeyPath): Reach | 'none' {
  if (tabbable(el)) return 'tab';
  if (el.closest('[role=menu]')) return 'menu';
  // 로빙: 같은 무리의 같은 꼴(탭·나무 줄, 나무 줄 안 체크) 하나가 Tab 차례
  const group = el.closest('[role=tablist], [role=tree]');
  const peers = el.matches('[role=tab], [role=treeitem]') ? '[role=tab], [role=treeitem]' : el.matches('[role=treeitem] > input[type=checkbox]') ? '[role=treeitem] > input[type=checkbox]' : null;
  if (group && peers && [...group.querySelectorAll(peers)].some(tabbable)) return 'rove';
  const via = viaOf(el);
  if (via && via !== el && reachOf(via) !== 'none') return 'via';
  if (hasShortcut(k?.shortcut)) return 'keys';
  return 'none';
}

/** 시험에서 부르는 앱 안쪽(문서를 연 뒤 앱이 부르는 화면 갱신 함수·메뉴·알림 — uilang214 꼴) */
interface Inner {
  doc: SkpDoc | null;
  panel: Panel;
  refreshChrome(): void;
  renderSceneTabs(): void;
  toggleThemeMenu(): void;
  closeMenu(): void;
  showNotice(kind: 'warn', title: string, text: string): boolean;
  select(sel: null): void;
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

/** 앱은 만들 때 미디어 질의(좁은 화면·휴대폰·손가락)를 잡는다 — 그 꼴의 matchMedia로 */
const stubMedia = (m: Form): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: mediaMatch(q, m), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
};

/** 그 꼴로 앱 화면을 차례로 그리며 누를 수 있는 마디를 모은다 — 마디마다 처음 본 때(문서에 붙어 있을 때 — 다시 그리면 떼어진다)의 키보드로 닿는 꼴과 함께(239차) */
async function collect(m: Form): Promise<Map<Element, Reach | 'none'>> {
  stubMedia(m);
  history.replaceState(null, '', '/opencad-skp/');
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new SkpViewerApp(root);
  app.mount();
  const a = app as unknown as Inner;
  dispose = await installLocalization(root);
  await tick();
  const seen = new Map<Element, Reach | 'none'>();
  const take = (): void =>
    document.querySelectorAll(CLICK).forEach((el) => {
      if (seen.has(el)) return;
      const hit = AUDIT.find(([sel]) => el.matches(sel));
      seen.set(el, reachOf(el, hit ? KEYS[hit[1]] : undefined));
    });
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
  return seen;
}

describe('235차: 앱 화면의 누를 수 있는 마디는 모두 크기 감사 표의 한 줄에 든다(새 누를 칸은 표에 크기와 판정을 더한다)', () => {
  it.each([WIDE, PHONE])('$name', async (m) => {
    const seen = await collect(m);
    const els = [...seen.keys()];
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
    // 239차: 마디마다 (가) 키보드로 닿는 꼴이 그 줄 KEYS에 들고, (나) 기본 동작이 없는 마디는 그 줄의 키 처리 꼴(꺼진 칸·누름 대상 아님은 뺌)
    const noKey = new Set<string>();
    const ways = new Map<Reach | 'none', number>();
    for (const el of els) {
      const hit = AUDIT.find(([sel]) => el.matches(sel));
      const k = hit ? KEYS[hit[1]] : undefined;
      if (!hit || !k || !k.reach.length || off(el)) continue;
      const how = seen.get(el)!;
      ways.set(how, (ways.get(how) ?? 0) + 1);
      if (!(k.reach as readonly string[]).includes(how)) noKey.add(`${sig(el)} — 표 ${hit[1]}번 줄: ${how}`);
      else if ((how === 'tab' || how === 'rove' || how === 'menu') && !el.matches(NATIVE) && !(k.own && el.matches(k.own))) noKey.add(`${sig(el)} — 표 ${hit[1]}번 줄: 키 처리 꼴 없음`);
    }
    expect([...noKey].sort(), m.name).toEqual([]);
    // 셈이 비지 않음: 그린 화면에 다섯 꼴이 모두 있다(돎 — 탭·나무, 메뉴 — 앱 설정·언어, 대신 — 라벨·펼치기·끌어 놓기 칸, 바로 가기 — 조이스틱)
    for (const w of ['tab', 'rove', 'menu', 'via', 'keys'] as const) expect(ways.get(w) ?? 0, `${m.name}: ${w}`).toBeGreaterThan(0);
  });
});

// ───────────────────────── 237차: 줄 안 보이기 체크의 누르는 자리 ─────────────────────────

const rectOf = (x: number, y: number, w: number, h: number): DOMRect => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;

/**
 * 줄 칸 상자를 styles.css 규칙으로 놓는다(줄 왼쪽 위 (900, 300)·폭 320·높이 최소 높이, 칸은 가운데 맞춤·틈 gap — 들여쓰기는 줄의 인라인 padding-left,
 * 펼치기·빈 자리·체크는 규칙 크기, 종류·이름·칩·수 칸은 폭 40·높이 18로 어림)
 */
function placeRow(item: HTMLElement, m: Form): Map<Element, DOMRect> {
  const row = decls(m, '.prow', ...(item.classList.contains('trow') ? ['.prow.trow'] : []));
  const h = px(row.get('min-height'));
  const gap = px(row.get('gap'));
  const side = px(row.get('padding')?.split(/\s+/)[1]);
  const out = new Map<Element, DOMRect>([[item, rectOf(900, 300, 320, h)]]);
  const box = decls(m, '.twisty');
  const cb = decls(m, "input[type='checkbox']", ".prow.pick > input[type='checkbox']");
  let x = 900 + (parseFloat(item.style.paddingLeft) || side);
  for (const el of item.children) {
    const [w, hh] = el.matches('.twisty, .twisty-space')
      ? [px(box.get('width')), px(box.get('height'))]
      : el.matches('input[type=checkbox]')
        ? [px(cb.get('width')), px(cb.get('height'))]
        : [40, 18];
    out.set(el, rectOf(x, 300 + (h - hh) / 2, w, hh));
    x += w + gap;
  }
  return out;
}

/** 나무 탭을 그린 앱(예제 문서 — 모두 펼침) */
async function treeApp(m: Form): Promise<{ a: Inner; d: SkpDoc; rows: HTMLElement[] }> {
  stubMedia(m);
  history.replaceState(null, '', '/opencad-skp/');
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new SkpViewerApp(root);
  app.mount();
  const a = app as unknown as Inner;
  const bytes = sampleSkpBytes(undefined, (s) => s);
  const d = createDoc(SAMPLE_NAME, bytes.length, { scene: skpToScene(bytes, { name: SAMPLE_NAME, outline: true }), ms: 12 });
  a.doc = d;
  d.panelTab = 'outline';
  for (let i = 0; i < (d.tree?.count ?? 0); i++) d.expanded.add(i);
  a.panel.show(d);
  await tick();
  const rows = [...a.panel.el.querySelectorAll<HTMLElement>('.plist.tree > .prow.pick.trow')].filter((el) => el.querySelector<HTMLInputElement>(':scope > input[type=checkbox]')?.disabled === false);
  return { a, d, rows };
}

/** 줄 바탕을 화면 자리 (x, y)에서 누른다(브라우저에서는 그 자리에 줄 안 칸이 없을 때 누름 대상이 줄) */
const press = (el: Element, x: number, y: number): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
};

describe('237차: 나무·윗단계·찾기 줄의 보이기 체크는 누르는 자리 24×24(WCAG 2.5.8 — 보이는 꼴·마디 그대로, 체크 둘레 줄 바탕 누름을 체크로)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('보이는 체크는 그대로: 마우스 화면 15×15(키우면 그림이 커짐 — 디자인 결정, 입력 칸에는 ::after 자리를 붙이지 못함), 손가락 화면은 43차 24×24', () => {
    const cb = (m: Form): Map<string, string> => decls(m, "input[type='checkbox']", ".prow.pick > input[type='checkbox']");
    for (const m of [WIDE, NARROW]) expect([px(cb(m).get('width')), px(cb(m).get('height'))], m.name).toEqual([15, 15]);
    for (const m of [PHONE, TABLET]) expect([px(cb(m).get('width')), px(cb(m).get('height'))], m.name).toEqual([24, 24]);
  });

  it.each([WIDE, NARROW])('$name: 펼치기 단추 줄·빈 자리 줄 모두 체크 둘레 24×24 누름은 체크(줄 고르기 아님), 그 밖·펼치기 몫·뒤 칸 앞·꺼진 체크는 줄 고르기 그대로', async (m) => {
    const { a, d, rows } = await treeApp(m);
    const withTwisty = rows.find((el) => el.querySelector(':scope > button.twisty'));
    const leaf = rows.find((el) => el.querySelector(':scope > .twisty-space'));
    expect(!!withTwisty && !!leaf, m.name).toBe(true);
    // 펼치기 투명 자리의 오른쪽 넓힘(235차 — 틈 6의 반)
    const twistyRight = -insets(decls(m, '.trow .twisty::after').get('inset'))[1];
    for (const item of [withTwisty!, leaf!]) {
      const rects = placeRow(item, m);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return rects.get(this) ?? rectOf(0, 0, 0, 0);
      });
      const n = Number(item.dataset.node);
      const cb = item.querySelector<HTMLInputElement>(':scope > input[type=checkbox]')!;
      const r = rects.get(cb)!;
      const row = rects.get(item)!;
      const prev = rects.get(cb.previousElementSibling!)!;
      const next = rects.get(cb.nextElementSibling!)!;
      // 기대 자리: 체크를 가운데 둔 24×24 — 앞이 펼치기 단추면 사이 틈의 가운데(앞 반은 펼치기 투명 자리)부터 오른쪽으로 민다
      const twisty = item.querySelector(':scope > button.twisty') !== null;
      const x0 = twisty ? (prev.right + r.left) / 2 : r.left - (24 - r.width) / 2;
      const y0 = r.top - (24 - r.height) / 2;
      const [x1, y1] = [x0 + 24, y0 + 24];
      // 그 자리는 줄 안쪽 틈 안: 펼치기 투명 자리·뒤 칸(종류 칩)·줄 밖과 겹치지 않는다
      if (twisty) expect(x0, m.name).toBeGreaterThanOrEqual(prev.right + twistyRight);
      expect(x1, m.name).toBeLessThanOrEqual(next.left);
      expect([y0 >= row.top, y1 <= row.bottom], m.name).toEqual([true, true]);
      const hidden = (): boolean => d.hiddenNodes.has(n);
      a.select(null);
      let was = hidden();
      // 안(네 모서리와 왼·오른 띠): 누를 때마다 보이기가 바뀌고 줄은 고르지 않으며, 초점은 체크(같은 줄이라 줄·체크가 Tab 차례 — rove 그대로)
      const mid = r.top + r.height / 2;
      for (const [x, y] of [[x0, y0], [x1 - 0.01, y0], [x0, y1 - 0.01], [x1 - 0.01, y1 - 0.01], [x0 + 1, mid], [x1 - 1, mid]] as const) {
        press(item, x, y);
        const at = `${m.name} ${twisty ? '펼치기 줄' : '빈 자리 줄'}: 체크에서 (${x - r.left}, ${y - r.top})`;
        expect(hidden(), at).toBe(!was);
        was = hidden();
        expect(cb.checked, at).toBe(!was);
        expect(d.selection, at).toBeNull();
        expect(document.activeElement, at).toBe(cb);
        expect([item.tabIndex, cb.tabIndex], at).toEqual([0, 0]);
      }
      // 체크를 바로 누르면 한 번만 바뀐다(넘기기가 체크 자신의 누름을 다시 넘기지 않음)
      cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + 7, clientY: r.top + 7, detail: 1 }));
      expect(hidden(), m.name).toBe(!was);
      was = hidden();
      // 밖(자리 바로 바깥 — 앞은 펼치기 몫이거나 틈, 뒤는 종류 칩 안, 위아래는 줄 안쪽 여백): 줄 고르기 그대로, 보이기 그대로
      for (const [x, y] of [[x0 - 0.5, mid], [x1 + 0.5, mid], [r.left + r.width / 2, y0 - 0.5], [r.left + r.width / 2, y1 + 0.5]] as const) {
        a.select(null);
        press(item, x, y);
        const at = `${m.name} ${twisty ? '펼치기 줄' : '빈 자리 줄'}: 밖 (${x - r.left}, ${y - r.top})`;
        expect(hidden(), at).toBe(was);
        expect(d.selection, at).not.toBeNull();
      }
      // 꺼진 체크(나눠 숨길 수 없는 단계)는 넘기지 않는다 — 줄 고르기
      cb.disabled = true;
      a.select(null);
      press(item, x0, y0);
      expect(hidden(), m.name).toBe(was);
      expect(d.selection, m.name).not.toBeNull();
      cb.disabled = false;
      vi.restoreAllMocks();
    }
  });

  it('휴대폰(손가락): 체크가 이미 24×24(43차)라 넘길 띠가 없다 — 체크 옆 줄 바탕은 줄 고르기 그대로', async () => {
    const { a, d, rows } = await treeApp(PHONE);
    const item = rows.find((el) => el.querySelector(':scope > .twisty-space'))!;
    const rects = placeRow(item, PHONE);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rects.get(this) ?? rectOf(0, 0, 0, 0);
    });
    const cb = item.querySelector<HTMLInputElement>(':scope > input[type=checkbox]')!;
    const r = rects.get(cb)!;
    expect([r.width, r.height]).toEqual([24, 24]);
    const n = Number(item.dataset.node);
    const was = d.hiddenNodes.has(n);
    a.select(null);
    press(item, r.left - 1, r.top + r.height / 2);
    expect(d.hiddenNodes.has(n)).toBe(was);
    expect(d.selection).not.toBeNull();
  });
});

// ───────────────────────── 239차: 키보드 길·초점 보임·끌기 대안 ─────────────────────────

describe('239차: 누르는 칸마다 키보드 길(WCAG 2.1.1)·초점 보임(2.4.7)·끌지 않는 길(2.5.7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('표: KEYS가 감사 표 1~37줄과 AUDIT 줄을 모두 품고, 초점 꼴 선택자는 styles.css에, 바로 가기는 안내(SHORTCUTS)에 있다', () => {
    expect(Object.keys(KEYS).map(Number)).toEqual(Array.from({ length: 37 }, (_, i) => i + 1));
    for (const [, row] of AUDIT) expect(KEYS[row], `표 ${row}번 줄`).toBeDefined();
    for (const [row, k] of Object.entries(KEYS)) {
      if (k.focus.startsWith('.')) expect(RULES.some((r) => r.sels.includes(k.focus)), `표 ${row}번 줄 ${k.focus}`).toBe(true);
      if (k.shortcut) expect(hasShortcut(k.shortcut), `표 ${row}번 줄`).toBe(true);
    }
  });

  it('(다) 초점 꼴: outline을 다시 적는 규칙은 표의 일곱 곳뿐이고, 지우는 둘(메뉴 항목·창 가르개)은 대신 꼴이 있다 — 넓은 화면·휴대폰', () => {
    const touch = RULES.filter((r) => /(^|;)\s*outline(-[\w-]+)?\s*:/.test(r.body)).map((r) => [r.media.join(' and '), r.sels.join(', ')].filter(Boolean).join(' | '));
    expect(touch).toEqual([
      ':focus-visible',
      '.menu-item:hover, .menu-item:focus-visible',
      '.search-input:focus-visible',
      '.resizer:focus-visible',
      '.language-trigger:focus-visible, .language-list button:focus-visible',
      '.sc-body:focus-visible',
      '.menu-item:focus-visible',
    ]);
    for (const m of [WIDE, PHONE]) {
      expect(decls(m, ':focus-visible').get('outline'), m.name).toBe('2px solid var(--accent)');
      // 메뉴 항목은 마우스 올림과 같은 배경 규칙(none) 뒤에 안쪽 테두리로 되살린다(170차)
      for (const s of ['.menu-item:focus-visible', '.search-input:focus-visible', '.language-trigger:focus-visible', '.language-list button:focus-visible', '.sc-body:focus-visible'])
        expect(decls(m, ':focus-visible', s).get('outline'), `${m.name} ${s}`).toBe('2px solid var(--accent)');
      // 창 가르개는 테두리 대신 가운데 강조색 막대
      expect(decls(m, ':focus-visible', '.resizer:focus-visible').get('outline'), m.name).toBe('none');
      expect(decls(m, '.resizer:focus-visible::after').get('background'), m.name).toBe('var(--accent)');
    }
    // 3D 보기 캔버스 테두리는 코어가 그리고(:focus-visible일 때 안쪽 2px) 색만 앱 강조색
    expect(decls(WIDE, '.view-host').get('--v3d-focus')).toBe('var(--accent)');
  });

  it.each([WIDE, PHONE])('$name: 창 가르개(시트 손잡이)는 Tab 차례 separator — 값·방향, 화살표·Shift·Enter·Space·Home·End, 끌지 않은 한 번 누르기는 다음 크기 단계(2.5.7)', (m) => {
    stubMedia(m);
    history.replaceState(null, '', '/opencad-skp/');
    localStorage.clear();
    const root = document.body.appendChild(document.createElement('div'));
    root.id = 'app';
    new SkpViewerApp(root).mount();
    const r = root.querySelector<HTMLElement>('.resizer')!;
    vi.spyOn(root.querySelector<HTMLElement>('.workspace')!, 'getBoundingClientRect').mockReturnValue(rectOf(0, 0, window.innerWidth, window.innerHeight));
    const narrow = m === PHONE;
    const now = (): number => Number(r.getAttribute('aria-valuenow'));
    const key = (k: string, shiftKey = false): boolean => !r.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
    expect([r.getAttribute('role'), r.tabIndex, r.getAttribute('aria-controls'), r.getAttribute('aria-orientation')]).toEqual(['separator', 0, 'side-panel', narrow ? 'horizontal' : 'vertical']);
    const [min, max] = [Number(r.getAttribute('aria-valuemin')), Number(r.getAttribute('aria-valuemax'))];
    const steps = narrow ? SHEET_STEPS.map((s) => Math.round(s * 100)) : [...PANEL_WIDTH_STEPS];
    expect(now()).toBe(steps[1]);
    expect(r.getAttribute('aria-valuetext')).toBe(`${steps[1]}${narrow ? '%' : 'px'}`);
    // 화살표: 넓은 화면 ←→(세로 가르개)·좁은 화면 ↑↓(시트 위 가장자리), Shift는 더 크게, 다른 쪽 화살표는 다루지 않음
    const [grow, shrink, other] = narrow ? ['ArrowUp', 'ArrowDown', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight', 'ArrowUp'];
    const v0 = now();
    expect(key(grow)).toBe(true);
    const v1 = now();
    expect(key(grow, true)).toBe(true);
    const v2 = now();
    expect([v1 > v0, v2 - v1 > v1 - v0]).toEqual([true, true]);
    expect(key(shrink)).toBe(true);
    expect(now()).toBeLessThan(v2);
    const v3 = now();
    expect(key(other)).toBe(false);
    expect(now()).toBe(v3);
    expect([key('Home'), now(), key('End'), now()]).toEqual([true, min, true, max]);
    // Enter·Space는 다음 크기 단계(가장 크면 가장 작은 단계로), 끌지 않은 한 번 누르기도 다음 단계, 두 번 누르기는 처음 크기
    expect([key('Enter'), now(), key(' '), now()]).toEqual([true, steps[0], true, steps[1]]);
    r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(now()).toBe(steps[2]);
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    expect(now()).toBe(steps[1]);
    localStorage.clear();
  });

  it('걷기 조이스틱: 손잡이를 끌지 않고 누르고 있기만 해도 누른 자리 쪽으로 걷고(2.5.7 — 끌기 아님), 떼면 멈춘다. 키로는 바로 가기 안내의 걷기 키', () => {
    const got: { forward: number; right: number }[] = [];
    const stick = new WalkStick((i) => got.push(i));
    document.body.append(stick.el);
    vi.spyOn(stick.el, 'getBoundingClientRect').mockReturnValue(rectOf(100, 100, 112, 112));
    const ev = (type: string, x: number, y: number): MouseEvent => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: 7 });
    // 원판 위쪽 끝을 누름(가운데 (156, 156) — 움직이지 않음): 앞으로
    stick.el.dispatchEvent(ev('pointerdown', 156, 104));
    expect(got.length).toBe(1);
    expect(got[0]!.forward).toBeGreaterThan(0.5);
    expect(got[0]!.right).toBe(0);
    stick.el.dispatchEvent(ev('pointerup', 156, 104));
    expect(got.at(-1)).toEqual({ forward: 0, right: 0 });
    expect(hasShortcut(KEYS[33]!.shortcut)).toBe(true);
  });

  it('찾은 줄: 누르기처럼 Enter·Space로 골라도 조상을 펼친다(찾기를 지운 나무에서 고른 줄이 보이게 — 고치기 전에는 누르기만)', async () => {
    const { a, d } = await treeApp(WIDE);
    const t = d.tree!;
    // 조상이 있는(둘째 단계부터) 이름 있는 노드
    let n = -1;
    for (let i = 0; i < t.count && n < 0; i++) if (nodePath(t, i).length > 1 && nodeName(t, i)) n = i;
    expect(n).toBeGreaterThanOrEqual(0);
    const up = nodePath(t, n).slice(0, -1);
    d.outlineQuery = nodeName(t, n);
    for (const how of ['click', 'Enter', ' '] as const) {
      d.expanded.clear();
      a.select(null);
      a.panel.rerender();
      await tick();
      const item = a.panel.el.querySelector<HTMLElement>(`.search-row[data-node="${n}"]`);
      expect(item, how).not.toBeNull();
      item!.focus();
      if (how === 'click') item!.click();
      else item!.dispatchEvent(new KeyboardEvent('keydown', { key: how, bubbles: true, cancelable: true }));
      expect(d.selection, how).not.toBeNull();
      expect(up.filter((x) => !d.expanded.has(x)), `${how}: 펼치지 않은 조상`).toEqual([]);
    }
  });
});
