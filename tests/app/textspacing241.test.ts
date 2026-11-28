/**
 * 241차: 글 간격(WCAG 1.4.12 Text Spacing — 사용자가 줄 높이를 글자 크기의 1.5배·문단 뒤 간격 2배·글자 간격 0.12em·낱말 간격 0.16em으로 넓혀도 글·기능을 잃지 않음).
 * styles.css를 235차 꼴(주석 뺌, @media 조건 쌓음)로 읽어, 글 칸이 넓어진 간격을 받지 못할 수 있는 규칙 — 고정 height·max-height(px·em), overflow hidden, 말줄임,
 * 줄 바꿈 금지, 줄 수 자르기, px 줄 높이, 절대 위치 칸 — 을 모두 감사 표(SPACING — 줄 번호는 .runtime/r241/progress.md 표)에 두고 줄마다 판정을 본다:
 * 한 줄 고정 높이(fits)는 글 크기 × 1.5 + 위아래 안쪽 여백·테두리 ≤ 높이, 늘어남(grows)은 그 규칙이 맞는 꼴에서 마지막 높이·최대 높이를 px·em으로 못 박지 않음,
 * 굴림(scroll)은 그 칸이 굴림, 말줄임(alt)은 온 글을 얻는 다른 길(앱 코드의 title 등 — 소스 글로 찾음)이 있음. 글 없음(none)·3D 보기 안 글(view)은 표에만.
 * 표 밖에 그런 규칙이 새로 생기거나 표의 줄이 없어지면 실패한다 — 새 칸은 판정을 표에 더한다(235차 AUDIT 꼴).
 * 고친 것(잘려 읽을 수 없고 다른 길도 없던 칸 — 말줄임 대신 줄 바꿈, 위험 선언이 없어져 표 밖): 최근 문서 이름(표 19번), 여는 중 단계 글(26번), 단면 줄 이름(32번 안).
 * jsdom은 배치를 하지 않으므로 규칙 글만 읽는다(앱을 그리지 않음).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────── styles.css 규칙 읽기(235차 꼴) ─────────────────────────

interface Rule {
  sels: string[];
  body: string;
  media: string[];
}

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

const APP = resolve(__dirname, '../../src/app');
const CSS_RAW = readFileSync(resolve(APP, 'styles.css'), 'utf8');
const RULES = readRules(CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, ''));

interface Form {
  name: string;
  w: number;
  h: number;
  coarse: boolean;
}
const WIDE: Form = { name: '넓은 화면(마우스 1280×800)', w: 1280, h: 800, coarse: false };
const NARROW: Form = { name: '좁은 마우스 창(600×800)', w: 600, h: 800, coarse: false };
const PHONE: Form = { name: '휴대폰(손가락 390×844)', w: 390, h: 844, coarse: true };
const TABLET: Form = { name: '태블릿(손가락 1024×768)', w: 1024, h: 768, coarse: true };
const FORMS = [WIDE, NARROW, PHONE, TABLET];

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

/** 본문의 선언(같은 속성은 뒤가 이김) */
function declsOf(body: string, out = new Map<string, string>()): Map<string, string> {
  for (const d of body.split(';')) {
    const c = d.indexOf(':');
    if (c > 0) out.set(d.slice(0, c).trim(), d.slice(c + 1).trim());
  }
  return out;
}
/** 선택자들(구체성 낮은 것부터)이 그 꼴에서 받는 선언 — 조건이 맞는 규칙을 선택자 차례·원문 차례로 덮음 */
function decls(m: Form, ...sels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const sel of sels) for (const r of RULES) if (r.sels.includes(sel) && r.media.every((q) => mediaMatch(q, m))) declsOf(r.body, out);
  return out;
}
const px = (v: string | undefined): number => (v && /^-?\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : 0);
/** 줄임 꼴(1~4 값) → 위·오른쪽·아래·왼쪽 */
function sides(v: string | undefined): [number, number, number, number] {
  const p = (v ?? '').split(/\s+/).filter(Boolean).map(px);
  const [t = 0, r = t, b = t, l = r] = p;
  return [t, r, b, l];
}

// ───────────────────────── 넓힌 간격을 받지 못할 수 있는 규칙 ─────────────────────────

/** 그런 선언(하나라도 있으면 표에 든다) */
const RISK: readonly (readonly [string, RegExp])[] = [
  ['고정 높이', /(^|[;\s])height:\s*-?[\d.]+(px|em)\b/],
  ['최대 높이', /max-height:\s*[\d.]+(px|em)\b/],
  ['넘침 숨김', /overflow(-[xy])?:\s*hidden/],
  ['말줄임', /text-overflow:\s*ellipsis/],
  ['줄 바꿈 금지', /white-space:\s*nowrap/],
  ['줄 수 자르기', /line-clamp/],
  ['px 줄 높이', /line-height:\s*[\d.]+px|(^|[;\s])font:\s*[\d.]+px\/[\d.]+px/],
  ['절대 위치', /position:\s*(absolute|fixed)/],
];
const key = (r: Rule): string => [r.media.join(' and '), r.sels.join(', ')].filter(Boolean).join(' | ');
const RISKY = RULES.filter((r) => RISK.some(([, re]) => re.test(r.body)));

// ───────────────────────── 앱 코드(다른 길의 근거 — 소스 글) ─────────────────────────

const SRC = new Map<string, string>();
const src = (file: string): string => {
  let s = SRC.get(file);
  if (s === undefined) SRC.set(file, (s = file === 'styles.css' ? CSS_RAW : readFileSync(resolve(APP, file), 'utf8')));
  return s;
};
/** [파일(src/app 안), 그 길이 있는 코드] */
type Src = readonly [file: string, code: RegExp];

const BRAND_TITLE: Src = ['app.ts', /h\('a', \{ class: 'brand', href: '\.\/', title: `\$\{APP_TITLE\} 처음 화면` \}/];
const DOC_TITLE: Src = ['app.ts', /e\.docName\.title = d \? `\$\{d\.name\} \(/];
const INFO_NAME: Src = ['infotab.ts', /row\('이름', d\.name, true\)/];
const SEL_TITLE: Src = ['app.ts', /e\.stSel\.title = statusTitle\(/];
const SEARCH_TITLE: Src = ['infotab.ts', /title: `\$\{uiName\(name\)\}\$\{path \? ` — \$\{path\}` : ''\}`/];
/** 이름 칸(.prow .name) 8곳 — 줄마다 온 이름을 얻는 길 */
const NAME_ROWS: readonly (readonly [row: string, ways: readonly Src[]])[] = [
  ['보기 켜기(앱 글 — 47차 줄 바꿈)', [['panel.ts', /class: `prow opt\$\{disabled \? ' off' : ''\}`, title \}, cb, h\('span', \{ class: 'name' \}, label\)/], ['styles.css', /\.prow\.opt \.name \{\s*white-space: normal;/]]],
  [
    '단면(241차 줄 바꿈 — 줄 풀이는 누를 때 할 일이라 이름이 없다)',
    [['panel.ts', /h\('span', \{ class: 'swatch sec', 'aria-hidden': 'true' \}\),\s*h\('span', \{ class: 'name' \}, sp\.name/], ['styles.css', /\.swatch\.sec \+ \.name \{\s*white-space: normal;\s*overflow-wrap: anywhere;/]],
  ],
  ['태그(줄 풀이 「이름: 면 · 모서리」)', [['panel.ts', /title: mixText\(!t\.hasGeometry \? mix`\$\{name\}: 그릴 것이 없는 태그`/]]],
  ['태그 폴더(줄 풀이)', [['panel.ts', /title: mixText\(mix`태그 폴더 \$\{name\} — 숨기면 안의 태그가 모두 숨습니다`\)/]]],
  ['재질(줄 풀이)', [['panel.ts', /title: mixText\(mix`\$\{nameText\(m\.name\)\} — 누르면 이 재질의 면을 강조합니다`\)/]]],
  ['윗단계(누르면 고름 → 상태 막대 고른 것 칸 풀이·고른 것 탭)', [['infotab.ts', /function outlineRow\([\s\S]*?bindPick\(p, item, d, sel\);/], SEL_TITLE]],
  ['찾은 줄(줄 풀이 「이름 — 경로」)', [SEARCH_TITLE]],
  ['나무(줄 풀이 「이름 (정의) — 풀이」)', [['infotab.ts', /title: `\$\{uiName\(name\)\}\$\{sub \? ` \(\$\{sub\}\)` : ''\} — \$\{uiText\(hasKids/]]],
];

// ───────────────────────── 감사 표 ─────────────────────────

type Way =
  /** 글 없음(아이콘·그림·막대·틀·투명 누름 자리) */
  | { way: 'none' }
  /** 한 줄 고정 높이: (규칙의 글 크기, 없으면 font) × 1.5 + edge(위아래 안쪽 여백·테두리 — content-box 칸은 그 안 칸의 것) ≤ 규칙의 height */
  | { way: 'fits'; font?: number; edge: number }
  /** 늘어남·넓어짐: 그 규칙이 맞는 꼴에서 마지막 height·max-height가 px·em이 아님(뒤 규칙이 덮는 것까지) */
  | { way: 'grows' }
  /** 넘치면 그 칸(inner면 안 칸)이 굴림 */
  | { way: 'scroll'; inner?: string }
  /** 말줄임·잘림 — 온 글을 얻는 다른 길(모두 있어야 함) */
  | { way: 'alt'; alt: readonly Src[] }
  /** 3D 보기 안 글(지시문 — 앞 판정대로: 그릴 때 재어 놓음·파일 글 크기 어림) */
  | { way: 'view' };
type Cell = Way & { row: number; text: string };

/** 규칙(미디어 | 선택자) → 판정. 19·26번은 241차에 고쳐 위험 선언이 없어져 표 밖(아래 「고친 것」 시험) */
const SPACING: Readonly<Record<string, Cell>> = {
  'html, body': { row: 1, way: 'none', text: '쪽 틀' },
  "input[type='checkbox']": { row: 2, way: 'none', text: '확인 칸' },
  '.app': { row: 3, way: 'none', text: '앱 틀' },
  '.titlebar': { row: 4, way: 'fits', font: 15, edge: 8, text: '제목 막대(로고 글 15px + 링크 안쪽 4+4, content-box)' },
  '.brand': { row: 5, way: 'grows', text: '처음 화면 링크 — 넓어지면 앱 이름 칸이 줄어듦' },
  '.brand-text': { row: 6, way: 'alt', alt: [BRAND_TITLE], text: '앱 이름' },
  '.docname': { row: 7, way: 'alt', alt: [DOC_TITLE, INFO_NAME], text: '문서 이름(파일 글)' },
  '.tbtn': { row: 8, way: 'fits', font: 13, edge: 2, text: '도구·제목 막대 버튼' },
  '.tgroup.seg .tbtn': { row: 9, way: 'fits', font: 13, edge: 2, text: '묶음 안 버튼' },
  '.tsep': { row: 10, way: 'none', text: '가름 선' },
  '.stage': { row: 11, way: 'none', text: '3D 보기 자리(안에 뜨는 칸은 절대 위치 줄마다)' },
  '.view-host': { row: 12, way: 'none', text: '3D 캔버스 자리' },
  '.statusbar': { row: 13, way: 'fits', edge: 0, text: '상태 막대(content-box) — 넓어지면 모형 정보·고른 것 칸이 줄어듦' },
  '.st-main': {
    row: 14,
    way: 'alt',
    alt: [
      ['app.ts', /e\.stMain\.title = parts\.join\(/],
      // 문서 전 글은 처음 화면 지원 형식 줄이 같은 뜻
      ['app.ts', /e\.stMain\.textContent = '파일을 열면 여기에 모형 정보가 보입니다 · SketchUp 3~2027\(\.skp\)'/],
      ['app.ts', /h\('b', \{\}, '지원 형식 '\), 'SketchUp 3~8·2013~2027에서 저장한 파일/],
    ],
    text: '모형 정보 줄',
  },
  '.st-warn': { row: 15, way: 'fits', edge: 0, text: '상태 막대 경고 N' },
  '.st-sel': { row: 16, way: 'alt', alt: [SEL_TITLE], text: '고른 것·측정 안내' },
  '.start': { row: 17, way: 'scroll', text: '처음 화면' },
  '.btn': { row: 18, way: 'fits', font: 13, edge: 2, text: '처음 화면·그림 저장 버튼' },
  '.recent-meta': { row: 20, way: 'grows', text: '최근 문서 크기·시각 — 넓어지면 이름 칸이 줄어듦(400px 아래는 다음 줄)' },
  '.notice': { row: 21, way: 'grows', text: '알림(3D 보기 위 — 장면 탭 줄 아래, 아래 시험)' },
  '.icon-btn': { row: 22, way: 'none', text: '닫기 ✕(아이콘 — 이름은 aria-label·title)' },
  '.busy': { row: 23, way: 'grows', text: '여는 중 덮개(가운데 카드)' },
  '.busy-title': {
    row: 24,
    way: 'alt',
    // 여는 동안만 보이는 글 — 덮개는 aria-live(화면 읽기 온 글), 다 열면 정보 탭 이름 줄·제목 막대 문서 이름 풀이
    alt: [['app.ts', /\{ class: 'busy', hidden: true, 'aria-live': 'polite' \}/], INFO_NAME, DOC_TITLE],
    text: '「<파일> 여는 중…」',
  },
  '.bar': { row: 25, way: 'none', text: '진행 막대' },
  '.dropcover': { row: 27, way: 'grows', text: '끌어 놓기 덮개' },
  '.menu': { row: 28, way: 'scroll', text: '메뉴(항목은 줄 바꿈)' },
  '.menu-sep': { row: 29, way: 'none', text: '메뉴 가름' },
  kbd: { row: 30, way: 'grows', text: '키 글(px 줄 높이 — 사용자 줄 높이가 덮고, 높이 못 박지 않은 칸 안)' },
  '.ptab': { row: 31, way: 'fits', font: 13, edge: 2, text: '패널 탭' },
  '.prow .name': { row: 32, way: 'alt', alt: NAME_ROWS.flatMap(([, ways]) => ways), text: '패널 줄 이름(8곳 — 아래 시험)' },
  '.chip': { row: 33, way: 'grows', text: '칩(px 줄 높이)' },
  '.swatch': { row: 34, way: 'none', text: '색 견본' },
  '.kind': { row: 35, way: 'grows', text: '종류 칩(px 줄 높이)' },
  '.search-input': { row: 36, way: 'fits', edge: 2, text: '구성 찾기 칸' },
  '.search-row .name .path': { row: 37, way: 'alt', alt: [SEARCH_TITLE], text: '찾은 줄 경로(파일 글)' },
  '(pointer: coarse) | .search-input': { row: 38, way: 'fits', edge: 2, text: '구성 찾기 칸(손가락 16px)' },
  '.resizer::after': { row: 39, way: 'none', text: '가르개 막대' },
  '.thumb': { row: 40, way: 'none', text: '정의 그림' },
  '.model-thumb': { row: 41, way: 'none', text: '모형 미리보기 그림' },
  '.scene-card': { row: 42, way: 'grows', text: '장면 카드 틀(둥근 모서리 자름)' },
  '.scene-card figcaption': { row: 43, way: 'alt', alt: [['infotab.ts', /h\('figure', \{ class: 'scene-card', title: sc\.name, translate: 'no' \}/]], text: '장면 그림 이름(파일 글)' },
  '.scene-cap': {
    row: 44,
    way: 'alt',
    alt: [['infotab.ts', /class: `scene-card pick\$\{on \? ' sel' : ''\}`, 'aria-pressed': on \? 'true' : 'false', title: \[name, pg\.description\]/]],
    text: '장면 카드 이름',
  },
  '.scene-tabs': { row: 45, way: 'scroll', text: '장면 탭 줄(가로 굴림, 높이는 늘어남)' },
  '.scene-tab': { row: 46, way: 'alt', alt: [['app.ts', /'aria-selected': on \? 'true' : 'false',\s*title: \[name, pg\.description\]\.filter\(Boolean\)\.join\('\\n'\)/]], text: '장면 탭 이름' },
  '.swatch.tag': { row: 47, way: 'none', text: '태그 색' },
  '.overlay': { row: 48, way: 'view', text: '3D 위 덧그림 층' },
  '.overlay-svg': { row: 49, way: 'none', text: '측정 선' },
  '.overlay-labels': { row: 50, way: 'view', text: '결과 글 층' },
  '.twisty, .twisty-space': { row: 51, way: 'fits', edge: 0, text: '펼치기(아이콘)·빈 자리(「…」 한 자)' },
  '.trow .twisty::after': { row: 52, way: 'none', text: '투명 누름 자리(줄 안쪽 틈 위)' },
  '.measure-bar': { row: 53, way: 'grows', text: '측정 띠·고른 것 카드·카메라 띠(위로 늘어남)' },
  '.mb-axis': { row: 54, way: 'grows', text: '축 이름 조각' },
  '.mb-btn': { row: 55, way: 'fits', edge: 2, text: '띠 버튼' },
  '.vcb': { row: 56, way: 'grows', text: '측정값 칸(넓은 화면)' },
  '.vcb-label': { row: 57, way: 'grows', text: '측정값 칸 이름표' },
  '.vcb-input': { row: 58, way: 'fits', font: 13, edge: 2, text: '측정값 칸' },
  '.vcb-btn': { row: 59, way: 'fits', font: 12, edge: 2, text: '측정값 칸 버튼(「안내점 N ✕」 12px)' },
  '.vcb-clear': { row: 60, way: 'grows', text: '「안내점 N ✕」(폭 auto — 높이는 59번 셈)' },
  '.vcb-msg': { row: 61, way: 'grows', text: '측정값 칸 위 말풍선' },
  '.measure-bar .vcb-undo:not([hidden]), .measure-bar .vcb-redo:not([hidden])': { row: 62, way: 'none', text: '되돌리기·다시 하기(아이콘)' },
  '(pointer: coarse) | .vcb-input': { row: 63, way: 'fits', edge: 2, text: '측정값 칸(손가락 16px)' },
  '(pointer: coarse) | .vcb-btn': { row: 64, way: 'fits', font: 12, edge: 2, text: '측정값 칸 버튼(손가락)' },
  '.walk-stick': { row: 65, way: 'none', text: '걷기 조이스틱' },
  '.stick-knob': { row: 66, way: 'none', text: '조이스틱 손잡이' },
  '(pointer: coarse) | .menu-item': { row: 67, way: 'grows', text: '메뉴 항목(손가락 40 — 뒤 규칙 height auto가 덮음)' },
  '(pointer: coarse) | .tbtn': { row: 68, way: 'fits', font: 13, edge: 2, text: '도구·제목 막대 버튼(손가락)' },
  '(pointer: coarse) | .tgroup.seg .tbtn': { row: 69, way: 'fits', font: 13, edge: 2, text: '묶음 안 버튼(손가락)' },
  "(pointer: coarse) | input[type='checkbox']": { row: 70, way: 'none', text: '확인 칸(손가락)' },
  '(max-width: 759.98px) | .titlebar': { row: 71, way: 'fits', font: 14, edge: 8, text: '제목 막대(좁은 화면 로고 글 14px)' },
  '(max-width: 759.98px) | .resizer::after': { row: 72, way: 'none', text: '시트 손잡이 막대' },
  '.anno-layer': { row: 73, way: 'view', text: '문자·치수 라벨 층(파일 글 — 크기 어림, 남은 일)' },
  '.measure-tip': { row: 74, way: 'view', text: '커서 옆 툴팁(그릴 때마다 재어 3D 보기 안에)' },
  '.measure-label': { row: 75, way: 'view', text: '측정 결과 글(그릴 때 재어 비킴)' },
  '.language-trigger': { row: 76, way: 'none', text: '언어 버튼(지구 아이콘)' },
  '.language-control-floating': { row: 77, way: 'none', text: '언어 버튼 자리' },
  '.language-list': { row: 78, way: 'grows', text: '언어 목록' },
  '.language-list button': { row: 79, way: 'grows', text: '언어 이름(원어 — 가장 긴 이름도 칸 안)' },
  '(max-width: 767px) | .titlebar': { row: 80, way: 'fits', font: 14, edge: 8, text: '제목 막대(767px 아래)' },
  '(max-width: 767px) | .language-trigger': { row: 81, way: 'none', text: '언어 버튼' },
  '(max-width: 767px) | .titlebar .brand': { row: 82, way: 'alt', alt: [BRAND_TITLE], text: '앱 이름 링크' },
  '(pointer: coarse) | .language-trigger': { row: 83, way: 'none', text: '언어 버튼(손가락)' },
  '.export-dialog': { row: 84, way: 'scroll', text: '그림 저장 창(201차)' },
  '.measure-log': { row: 85, way: 'scroll', text: '최근 측정 목록' },
  '.mb-lockmenu': { row: 86, way: 'grows', text: '잠글 방향 줄(위로 늘어남)' },
  '.mb-lockswatch': { row: 87, way: 'none', text: '잠글 방향 색 점' },
  '.measure-flash': { row: 88, way: 'grows', text: '띠 위 잠깐 알림' },
  '.ml-copy-btn': { row: 89, way: 'none', text: '최근 측정 복사(아이콘 — aria-label·title)' },
  '.update-bar': { row: 90, way: 'scroll', text: '새 판 띠(207차)' },
  '(pointer: coarse) | .update-bar .mini-btn': { row: 91, way: 'fits', font: 12, edge: 2, text: '새 판 띠 버튼(손가락)' },
  '.sc-backdrop': { row: 92, way: 'scroll', inner: '.sc-body', text: '바로 가기 안내(본문 굴림)' },
  '(pointer: coarse) | .icon-btn': { row: 93, way: 'none', text: '닫기(손가락)' },
  '(pointer: coarse) | .sec-range': { row: 94, way: 'none', text: '단면 위치 밀대' },
  '(pointer: coarse) | .cam-bar .fov-range': { row: 95, way: 'none', text: '시야각 밀대' },
  '(pointer: coarse) | .trow .twisty::after': { row: 96, way: 'none', text: '투명 누름 자리(손가락)' },
  "(pointer: coarse) | .prow.pick > input[type='checkbox']": { row: 97, way: 'none', text: '보이기 체크(손가락)' },
  '(pointer: coarse) | .titlebar .tbtn::after, .language-trigger::after, .toolbar .tbtn::after, .vcb-btn::after, .scene-play::after, .mb-btn::after': {
    row: 98,
    way: 'none',
    text: '투명 누름 자리(막대 안쪽 여백 위)',
  },
};

const ruleOf = (k: string): Rule => RISKY.find((r) => key(r) === k)!;
const cellsOf = <W extends Way['way']>(w: W): [string, Extract<Cell, { way: W }>][] =>
  Object.entries(SPACING).filter((e): e is [string, Extract<Cell, { way: W }>] => e[1].way === w);
/** 그 규칙의 미디어 조건이 맞는 꼴 */
const formsOf = (r: Rule): Form[] => FORMS.filter((m) => r.media.every((q) => mediaMatch(q, m)));
const fixed = (v: string | undefined): boolean => !!v && /^-?[\d.]+(px|em)$/.test(v);

describe('241차: 글 간격을 넓혀도(WCAG 1.4.12) 글이 든 칸이 잘리지 않거나 온 글을 얻는 다른 길이 있다(styles.css 규칙 감사 표)', () => {
  it('표: 넓힌 간격을 받지 못할 수 있는 규칙은 모두 표의 한 줄 — 표 밖에 새 규칙이 생기거나 표의 줄이 없어지면 실패', () => {
    const keys = RISKY.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => !(k in SPACING)).sort()).toEqual([]);
    expect(Object.keys(SPACING).filter((k) => !keys.includes(k)).sort()).toEqual([]);
    // 줄 번호는 progress.md 표 1~98에서 고친 두 줄(19·26)을 뺀 것, 셈이 비지 않음(판정 여섯 꼴이 모두 있음)
    const rows = Object.values(SPACING).map((c) => c.row);
    expect(rows).toEqual(Array.from({ length: 98 }, (_, i) => i + 1).filter((n) => n !== 19 && n !== 26));
    for (const w of ['none', 'fits', 'grows', 'scroll', 'alt', 'view'] as const) expect(cellsOf(w).length, w).toBeGreaterThan(0);
  });

  it('한 줄 고정 높이 칸: 글 크기 × 1.5 + 위아래 안쪽 여백·테두리 ≤ 그 규칙의 높이(177차 셈을 미디어 규칙까지)', () => {
    const over: string[] = [];
    for (const [k, c] of cellsOf('fits')) {
      const d = declsOf(ruleOf(k).body);
      const h = px(d.get('height'));
      const font = px(d.get('font-size')) || c.font || 0;
      expect([h > 0, font > 0], k).toEqual([true, true]);
      if (font * 1.5 + c.edge > h) over.push(`${c.row} ${k}: ${font} × 1.5 + ${c.edge} > ${h}`);
    }
    expect(over).toEqual([]);
  });

  it('늘어남·넓어짐 칸: 그 규칙이 맞는 꼴마다 마지막 height·max-height를 px·em으로 못 박지 않는다(손가락 메뉴 항목 40은 뒤 규칙 auto가 덮음)', () => {
    const stuck: string[] = [];
    for (const [k, c] of cellsOf('grows')) {
      const r = ruleOf(k);
      const forms = formsOf(r);
      expect(forms.length, k).toBeGreaterThan(0);
      for (const m of forms)
        for (const sel of r.sels) {
          const d = decls(m, sel);
          if (fixed(d.get('height')) || fixed(d.get('max-height'))) stuck.push(`${c.row} ${k} — ${m.name}: ${d.get('height') ?? ''} ${d.get('max-height') ?? ''}`);
        }
    }
    expect(stuck).toEqual([]);
  });

  it('굴림 칸: 넘치는 글은 그 칸(또는 안 칸) 안에서 굴린다', () => {
    for (const [k, c] of cellsOf('scroll')) {
      const r = ruleOf(k);
      const d = decls(formsOf(r)[0]!, c.inner ?? r.sels[0]!);
      expect([d.get('overflow'), d.get('overflow-y'), d.get('overflow-x')].some((v) => v === 'auto' || v === 'scroll'), `${c.row} ${k}`).toBe(true);
    }
  });

  it('말줄임 칸: 온 글을 얻는 다른 길(풀이 title·다른 자리·줄 바꿈)이 앱 코드에 있다', () => {
    const lost: string[] = [];
    for (const [k, c] of cellsOf('alt')) for (const [file, code] of c.alt) if (!code.test(src(file))) lost.push(`${c.row} ${k} — ${file} ${code.source.slice(0, 60)}`);
    expect(lost).toEqual([]);
  });

  it('패널 줄 이름 칸(.prow .name)은 앱 코드 8곳 — 새 이름 줄은 다른 길을 이 목록에 더한다', () => {
    const files = readdirSync(APP).filter((f) => f.endsWith('.ts'));
    const count = files.reduce((n, f) => n + (src(f).match(/\{ class: 'name'/g)?.length ?? 0), 0);
    expect(count).toBe(NAME_ROWS.length);
    expect(NAME_ROWS.length).toBe(8);
  });

  it('241차 고친 것: 최근 문서 이름·여는 중 단계 글·단면 줄 이름은 말줄임 대신 줄을 바꾼다(다른 길이 없었다 — 다른 이름 줄·칸은 말줄임 그대로)', () => {
    for (const m of [WIDE, PHONE]) {
      for (const sel of ['.recent-name', '.busy-stage']) {
        const d = decls(m, sel);
        expect([d.get('white-space'), d.get('text-overflow'), d.get('overflow'), d.get('overflow-wrap')], `${m.name} ${sel}`).toEqual([undefined, undefined, undefined, 'anywhere']);
      }
      const sec = decls(m, '.prow .name', '.swatch.sec + .name');
      expect([sec.get('white-space'), sec.get('overflow-wrap')], m.name).toEqual(['normal', 'anywhere']);
      // 다른 이름 줄(파일 글 — 풀이가 있음)은 그대로 말줄임
      expect([decls(m, '.prow .name').get('white-space'), decls(m, '.prow .name').get('text-overflow')], m.name).toEqual(['nowrap', 'ellipsis']);
    }
  });

  it('3D 보기 위 알림은 넓힌 줄 높이에서도 장면 탭 줄 아래에 뜬다(겹치지 않음 — 넓은 화면·좁은 창·휴대폰·태블릿)', () => {
    for (const m of FORMS) {
      const bar = decls(m, '.scene-tabs');
      const tab = decls(m, '.scene-tab');
      const [pt, , pb] = sides(bar.get('padding'));
      const [tt, , tb] = sides(tab.get('padding'));
      const border = px(bar.get('border')?.split(/\s+/)[0]);
      const tabH = Math.max(px(tab.get('font-size')) * 1.5 + tt + tb, px(tab.get('min-height')));
      const bottom = px(bar.get('top')) + border * 2 + pt + pb + tabH;
      const top = px(decls(m, '.notice', '.scene-tabs:not([hidden]) ~ .notice').get('top'));
      expect(bottom, m.name).toBeGreaterThan(30);
      expect(bottom, m.name).toBeLessThan(top);
    }
  });
});
