/**
 * 243차: 초점이 가려지지 않음(WCAG 2.4.11 최소 — 키보드 초점을 받은 칸이 앱이 만든 다른 내용에 통째로 가려지지 않음. 일부면 통과,
 * 사용자가 연 내용이 초점을 옮기지 않고 닫히면 예외). styles.css를 235·241차 꼴(주석 뺌, @media 조건 쌓음)로 읽어 떠 있는 칸 규칙
 * (position fixed·absolute·sticky 또는 z-index)을 모두 감사 표(FLOAT — 줄 번호는 .runtime/r243/progress.md 표)에 두고 줄마다 판정을 본다 —
 * 표 밖에 떠 있는 칸 규칙이 새로 생기거나 표의 줄이 없어지면 실패한다(새 칸은 판정을 표에 더한다).
 * 3D 보기(.stage — 굴리지 않는다) 안 칸끼리 통째로 가릴 수 있던 짝(PAIRS — 184차가 고르지 않은 ②④⑤⑥⑦⑪와 이번에 찾은 것)은 규칙 셈으로 근거를 보이고,
 * 고친 것: 키보드 초점(:focus-visible)이 든 칸을 그동안만 맨 위(z 8)로, 측정 띠 안 초점 버튼을 측정값 칸 말풍선 위(z 4)로 — 쌓임 차례만 바꿔 보통 화면은 그대로.
 * jsdom은 배치를 하지 않으므로 규칙 글과 앱 원문만 읽는다(앱을 그리지 않음).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────── styles.css 규칙 읽기(235·241차 꼴) ─────────────────────────

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

const ROOT = resolve(__dirname, '../..');
const SRC = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');
const RULES = readRules(SRC('src/app/styles.css').replace(/\/\*[\s\S]*?\*\//g, ''));

interface Form {
  name: string;
  w: number;
  h: number;
  coarse: boolean;
}
const WIDE: Form = { name: '넓은 화면(마우스 1280×800)', w: 1280, h: 800, coarse: false };
const LOW: Form = { name: '낮은 창(마우스 1280×280 — 400% 확대)', w: 1280, h: 280, coarse: false };
const PHONE: Form = { name: '휴대폰(손가락 390×844)', w: 390, h: 844, coarse: true };
const LOW_TOUCH: Form = { name: '휴대폰 가로(손가락 568×280)', w: 568, h: 280, coarse: true };

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
/** 테두리 줄임 꼴의 굵기(`1px solid …`) */
const borderOf = (v: string | undefined): number => px(v?.split(/\s+/)[0]);
/** 앱 글 줄 높이(body `13px/1.45` — 숫자라 글 크기마다 그대로 물려받음) */
const LH = Number(/\/([\d.]+)/.exec(decls(WIDE, 'body').get('font') ?? '')?.[1]);

// ───────────────────────── 떠 있는 칸 규칙 감사 표 ─────────────────────────

/** 떠 있는 칸 규칙(하나라도 있으면 표에 든다) */
const FLOATING = /position:\s*(fixed|absolute|sticky)|z-index:/;
const key = (r: Rule): string => [r.media.join(' and '), r.sels.join(', ')].filter(Boolean).join(' | ');
const FLOATS = RULES.filter((r) => FLOATING.test(r.body));

/**
 * 판정: none 가리는 초점 칸 없음 · partial 일부만(통과) · exempt 사용자가 연 칸(초점을 옮기지 않고 닫힘)·모달 ·
 * whole-fixed 통째로 가릴 수 있었고 고친 규칙으로 초점 든 칸이 앞으로(짝은 PAIRS) · whole-left 통째로 가릴 수 있고 고르지 않음(까닭) · fix 고친 규칙
 */
type Verdict = 'none' | 'partial' | 'exempt' | 'whole-fixed' | 'whole-left' | 'fix';
interface Float {
  row: number;
  verdict: Verdict;
  /** 덮는 자리·밑에 깔리는 초점 칸 */
  what: string;
  /** 판정 근거 */
  why: string;
}

const RAISE_KEY = ['.scene-tabs', '.measure-bar', '.vcb', '.notice', '.busy', '.export-dialog'].map((s) => `.stage > ${s}:has(:focus-visible)`).join(', ');
const BTN_KEY = '.measure-bar .mb-btn:focus-visible';

const FLOAT: Readonly<Record<string, Float>> = {
  '.view-host': { row: 1, verdict: 'none', what: '3D 보기 밑판(캔버스 자리)', why: '다른 칸을 덮지 않음 — 캔버스 자신은 뜬 칸에 일부만 가려짐(아래 it)' },
  '.start': { row: 2, verdict: 'whole-left', what: '처음 화면 — 문서 없이 뷰어만 있는 드문 상태의 캔버스', why: '캔버스를 Tab 밖으로 하는 길은 app.ts(첫 화면 조각), CSS로 숨기면 44차 초점 옮김이 깨짐(아래 it)' },
  '.notice': { row: 3, verdict: 'whole-fixed', what: '알림 — 낮은 창의 장면 탭, 낮은 3D 보기의 아래 띠·측정값 칸(처음 화면 줄은 일부·고르지 않음)', why: '앱이 띄운 칸, ✕는 초점을 옮겨야' },
  '.busy': { row: 4, verdict: 'exempt', what: '진행 덮개(반투명, 가운데 카드)', why: '사용자가 연 파일 열기 — Esc가 초점을 옮기지 않고 취소' },
  '.dropcover': { row: 5, verdict: 'none', what: '끌어 놓기 덮개', why: '파일을 끄는 동안만 — 누르기 통과·반투명' },
  '.menu': { row: 6, verdict: 'exempt', what: '도구 막대 메뉴·앱 설정·겹친 것 목록', why: '사용자가 연 메뉴 — 밖 초점·바깥 누르기·Esc에 닫힘' },
  '.resizer': { row: 7, verdict: 'partial', what: '창 가르개·시트 손잡이(패널 왼쪽 6px·위 14px)', why: '투명 — 막대만 칠함' },
  '.resizer::after': { row: 8, verdict: 'partial', what: '가르개 막대(넓은 화면 2px·좁은 화면 44×4 — 패널 탭 위 2px)', why: '시트는 3D 보기 아래 flex 형제라 3D 보기 칸이 덮지 않음' },
  '.scene-tabs': { row: 9, verdict: 'partial', what: '장면 탭 줄 — 캔버스', why: '캔버스만 덮음' },
  '.overlay': { row: 10, verdict: 'partial', what: '덧그림 층 — 캔버스', why: '투명, 누르기 통과' },
  '.overlay-svg': { row: 11, verdict: 'partial', what: '측정 선·표식 — 캔버스', why: '선만' },
  '.overlay-labels': { row: 12, verdict: 'partial', what: '측정 결과 글 — 캔버스', why: '글 칸만' },
  '.trow .twisty::after': { row: 13, verdict: 'none', what: '펼치기 투명 누름 자리', why: '칠하지 않음' },
  '.measure-bar': { row: 14, verdict: 'whole-fixed', what: '측정 띠·고른 것 카드·카메라 띠 — 카메라 띠가 측정 띠를, 띠 안 목록·잠글 방향 줄이 장면 탭을', why: '같은 z 3 — DOM 뒤가 위(184차 ②)' },
  '.vcb': { row: 15, verdict: 'partial', what: '넓은 화면 측정값 칸 — 캔버스', why: '카메라 띠는 184차 liftAbove로 비킴' },
  '.vcb-msg': { row: 16, verdict: 'whole-fixed', what: '측정값 칸 말풍선 — 띠 안이면 첫 줄 버튼', why: '두 줄 말풍선이 버튼 높이를 넘음(아래 it), 넣기 잘못 뒤 입력·Esc에만 거둠' },
  '.walk-stick': { row: 17, verdict: 'partial', what: '조이스틱 — 캔버스', why: '초점 받지 않음' },
  '.anno-layer': { row: 18, verdict: 'partial', what: '문자·치수 라벨 — 캔버스', why: '누르기 통과' },
  '.measure-tip': { row: 19, verdict: 'partial', what: '측정 툴팁 — 캔버스', why: '242차 Esc로 닫힘' },
  '.language-control-floating': { row: 20, verdict: 'none', what: '떠 있는 언어 버튼 자리', why: '쓰지 않음 — 제목 막대가 있으면 그 안' },
  '.language-list': { row: 21, verdict: 'exempt', what: '언어 목록', why: '사용자가 연 메뉴 — Tab·Esc에 닫힘' },
  '.export-dialog': { row: 22, verdict: 'whole-fixed', what: '그림 저장 창 — 알림 ✕·띠 버튼·측정값 칸·낮은 화면 장면 탭', why: '비모달 — Esc는 창 안 초점일 때만이라 예외 아님(184차)' },
  '.measure-log': { row: 23, verdict: 'whole-fixed', what: '최근 측정 목록 — 낮은 3D 보기의 장면 탭', why: '닫기는 기록 버튼(초점을 옮겨야)' },
  '.mb-lockmenu': { row: 24, verdict: 'whole-fixed', what: '잠글 방향 줄 — 아주 낮은 3D 보기의 장면 탭', why: '닫기는 고르기·버튼' },
  '.measure-flash': { row: 25, verdict: 'partial', what: '잠깐 알림(24px) — 최근 측정 줄·잠글 방향 버튼', why: '24 < 38, 1.6초' },
  '.update-bar': { row: 26, verdict: 'whole-fixed', what: '새 판 띠 — 장면 탭·알림 버튼·그림 저장 창·진행 취소·좁고 낮은 창의 띠(처음 화면 줄은 고르지 않음)', why: '앱이 띄운 칸, 「나중에」는 초점을 옮겨야' },
  '.sc-backdrop': { row: 27, verdict: 'exempt', what: '바로 가기 안내', why: '모달 — 뒤 문서 inert' },
  '(pointer: coarse) | .trow .twisty::after': { row: 28, verdict: 'none', what: '펼치기 투명 누름 자리(손가락)', why: '칠하지 않음' },
  '(pointer: coarse) | .titlebar .tbtn::after, .language-trigger::after, .toolbar .tbtn::after, .vcb-btn::after, .scene-play::after, .mb-btn::after': {
    row: 29,
    verdict: 'none',
    what: '막대 단추 투명 누름 자리(43차)',
    why: '칠하지 않음',
  },
  [RAISE_KEY]: { row: 30, verdict: 'fix', what: '키보드 초점이 든 3D 보기 칸을 그동안 맨 위로', why: 'PAIRS 짝 모두' },
  [BTN_KEY]: { row: 31, verdict: 'fix', what: '측정 띠 안 키보드 초점 버튼을 측정값 칸(말풍선) 위로', why: '16번 줄' },
};

// ───────────────────────── 3D 보기 칸(app.ts 차례) ─────────────────────────

/** app.ts 769 `stage` 자식 차례(같은 z면 DOM 뒤가 위) + 그 뒤 그림 저장 창(exporter.ts — parent = stage) */
const STAGE: readonly (readonly [name: string, sel: string])[] = [
  ['sceneTabs', '.scene-tabs'],
  ['viewHost', '.view-host'],
  ['measureBar', '.measure-bar'],
  ['selBar', '.measure-bar'],
  ['camBar', '.measure-bar'],
  ['vcb', '.vcb'],
  ['stick', '.walk-stick'],
  ['start', '.start'],
  ['notice', '.notice'],
  ['busy', '.busy'],
  ['updateBar', '.update-bar'],
  ['exportDialog', '.export-dialog'],
];
const selOf = (name: string): string => STAGE.find(([n]) => n === name)![1];
const at = (name: string): number => STAGE.findIndex(([n]) => n === name);
/** 바탕 규칙의 z-index(auto는 0) */
const zOf = (name: string): number => Number(decls(WIDE, selOf(name)).get('z-index') ?? 0);
/** 키보드 초점이 들었을 때의 z(올리는 규칙이 없으면 바탕 그대로) */
function focusedZ(name: string): number {
  const r = RULES.find((x) => !x.media.length && x.sels.includes(`.stage > ${selOf(name)}:has(:focus-visible)`));
  const z = r ? declsOf(r.body).get('z-index') : undefined;
  return z === undefined ? zOf(name) : Number(z);
}
/** a가 b 위인가(z가 크거나, 같으면 DOM 뒤) */
const above = (za: number, a: string, zb: number, b: string): boolean => za > zb || (za === zb && at(a) > at(b));

/** 통째로 가릴 수 있던 짝: [덮는 칸, 가려지던 초점 칸을 품은 칸, 덮는 칸의 표 줄, 어떤 때] */
const PAIRS: readonly (readonly [cover: string, covered: string, rows: readonly number[], when: string])[] = [
  ['notice', 'sceneTabs', [3], '높이 300px 아래 창 — 알림이 위 8px(47차, 184차 ④)'],
  ['notice', 'measureBar', [3], '낮은 3D 보기 — 긴 알림이 아래 띠까지(242차 (ㄷ))'],
  ['notice', 'selBar', [3], '낮은 3D 보기(같음)'],
  ['notice', 'camBar', [3], '낮은 3D 보기(같음)'],
  ['notice', 'vcb', [3], '낮은 3D 보기 — 넓은 화면 측정값 칸'],
  ['camBar', 'measureBar', [14], '넓은 창에서 둘 다 연 채 좁힘(184차 ②)'],
  ['measureBar', 'sceneTabs', [23, 24], '낮은 3D 보기 — 띠 안 최근 측정 목록·잠글 방향 줄이 위 끝까지'],
  ['exportDialog', 'notice', [22], '넓은 화면 — 장면 탭이 있을 때 알림 ✕(184차 ⑥)'],
  ['exportDialog', 'measureBar', [22], '좁은 화면 — 창 아래 12px(184차 ⑦)'],
  ['exportDialog', 'selBar', [22], '좁은 화면(같음)'],
  ['exportDialog', 'camBar', [22], '좁은 화면(같음)'],
  ['exportDialog', 'vcb', [22], '넓은 화면 3D 보기 높이 약 330px 아래 — 창 아래 끝이 3D 보기 아래 8px'],
  ['exportDialog', 'sceneTabs', [22], '좁고 낮은 화면 — 창 위 끝이 8px까지'],
  ['updateBar', 'sceneTabs', [26], '위 8px 같은 줄(184차 ⑤ — 아래 it 셈)'],
  ['updateBar', 'notice', [26], '넓은 3D 보기 — 띠 한 줄이 알림 「다시 시도」·「새로 고침」을'],
  ['updateBar', 'exportDialog', [26], '좁은 화면 — 창 위 끝이 띠 밑'],
  ['updateBar', 'busy', [26], '좁고 낮은 창(띠 폭 max-content — 208차) — 진행 「취소」'],
  ['updateBar', 'measureBar', [26], '좁고 낮은 창의 긴 언어 — 띠 최대 높이 100%−16px'],
  ['updateBar', 'selBar', [26], '좁고 낮은 창(같음)'],
  ['updateBar', 'camBar', [26], '좁고 낮은 창(같음)'],
  ['updateBar', 'vcb', [26], '좁고 낮은 창(같음)'],
];

/** 초점 칸을 품는 3D 보기 칸 가운데 올리지 않는 것과 까닭(조이스틱은 초점을 받지 않아 뺌) */
const KEEP: Readonly<Record<string, string>> = {
  viewHost: '캔버스는 3D 보기 전체라 뜬 칸에 일부만 가려짐 — 올리면 그동안 띠·탭·측정값 칸이 모두 그 밑',
  start: '처음 화면을 올리면 키보드로 연 열기의 실패 알림이 곧바로 덮임(초점이 「파일 열기」에 남음)',
  updateBar: '3D 보기 칸 가운데 맨 위(가장 큰 z·DOM 뒤)',
};
const FOCUS_BOXES = STAGE.map(([n]) => n).filter((n) => n !== 'stick');

type Src = readonly [file: string, code: RegExp];
/** 예외·고르지 않음의 근거 코드(표 줄 → 소스) */
const EVIDENCE: Readonly<Record<number, readonly Src[]>> = {
  // 2: 처음 화면을 숨기기 앞에 캔버스로 초점을 옮긴다(44차) — CSS로 처음 화면 동안 캔버스를 숨기면 이 초점 옮김이 깨짐. 뷰어는 seq 확인 앞에 만든다(드문 상태)
  2: [
    ['src/app/app.ts', /if \(d && e\.start\.contains\(document\.activeElement\)\) focusIfLost\(this\.viewer\?\.canvas, e\.start\);\n\s*e\.start\.hidden = !!d;/],
    ['src/app/app.ts', /if \(!\(await this\.ensureViewer\(again\)\) \|\| seq !== this\.openSeq\) return false;/],
    ['node_modules/opencad-viewer3d/src/viewer.ts', /canvas\.tabIndex = 0;/],
  ],
  4: [['src/app/keys.ts', /if \(k\.key === 'Escape' && k\.busy && !mod && !k\.alt\) return \{ kind: 'cancelOpen' \};/]],
  6: [
    ['src/app/app.ts', /this\.menuOff = closeOutside\(\[menu, btn\], \(\) => this\.closeMenu\(\)\);/],
    ['src/app/app.ts', /if \(this\.menu && ev\.key === 'Escape'\) \{/],
    ['src/app/picklist.ts', /closeOutside\(\[menu\], \(\) => this\.close\(\)\)/],
  ],
  // 16: 말풍선은 칸 안(칸이 띠 안 relative·z 3), 입력·Esc·숨김에만 거두고 칸을 떠나도 남는다
  16: [
    ['src/app/vcb.ts', /this\.clearBtn,\n\s*this\.msg,\n\s*\);/],
    ['src/app/vcb.ts', /this\.input\.addEventListener\('input', \(\) => this\.setMessage\(null\)\);/],
    ['src/app/vcb.ts', /private stopEditing\(\): void \{\n\s*this\.editingValue = false;\n\s*this\.input\.value = this\.live;\n\s*\}/],
  ],
  20: [['src/app/i18n.ts', /if \(host\) \{ control\.element\.classList\.remove\('language-control-floating'\);/]],
  21: [
    ['node_modules/opencad-site-kit/i18n/language-menu.ts', /if \(event\.key === 'Tab'\) close\(true\);/],
    ['node_modules/opencad-site-kit/i18n/language-menu.ts', /event\.key === 'Escape'\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); close\(true\);/],
  ],
  // 22: Esc는 창 안 키에만(창 밖 초점의 Esc는 앱 창 키) — 예외가 아니다
  22: [['src/app/exporter.ts', /el\.addEventListener\('keydown', \(e\) => \{\n\s*if \(e\.key === 'Escape'\) \{\n\s*e\.stopPropagation\(\);\n\s*this\.close\(\);/]],
  // 26: 앱이 띄우고(서비스 워커) 「나중에」를 눌러야 닫힘
  26: [
    ['src/app/app.ts', /offerUpdate\(apply: \(\) => void\): void \{\n\s*const n = this\.els\.updateBar;\n\s*n\.hidden = false;/],
    ['src/app/app.ts', /updLater\.addEventListener\('click', \(\) => \{\n\s*updateBar\.hidden = true;/],
  ],
  27: [['src/app/shortcuts.ts', /for \(const el of back\) el\.setAttribute\('inert', ''\);/]],
};

describe('243차: 키보드 초점 칸이 앱이 띄운 다른 칸에 통째로 가려지지 않는다(WCAG 2.4.11 — styles.css 떠 있는 칸 감사 표)', () => {
  it('표: 떠 있는 칸 규칙(position fixed·absolute·sticky 또는 z-index)은 모두 표의 한 줄 — 표 밖에 새 규칙이 생기거나 표의 줄이 없어지면 실패', () => {
    const keys = FLOATS.map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => !(k in FLOAT)).sort()).toEqual([]);
    expect(Object.keys(FLOAT).filter((k) => !keys.includes(k)).sort()).toEqual([]);
    // sticky 머리·띠는 없다(굴리는 칸 안에서 초점 칸을 덮는 칸이 없음 — 184차)
    expect(RULES.filter((r) => /position:\s*sticky/.test(r.body)).map(key)).toEqual([]);
    // 줄 번호 1~31(progress.md 표), 판정 여섯 꼴의 셈
    expect(Object.values(FLOAT).map((f) => f.row)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    const by = (v: Verdict): number[] => Object.values(FLOAT).filter((f) => f.verdict === v).map((f) => f.row);
    expect([by('none'), by('partial'), by('exempt'), by('whole-fixed'), by('whole-left'), by('fix')]).toEqual([
      [1, 5, 13, 20, 28, 29],
      [7, 8, 9, 10, 11, 12, 15, 17, 18, 19, 25],
      [4, 6, 21, 27],
      [3, 14, 16, 22, 23, 24, 26],
      [2],
      [30, 31],
    ]);
    for (const f of Object.values(FLOAT)) expect([f.what, f.why].every(Boolean), String(f.row)).toBe(true);
    // 통째→고침 줄은 짝을 가진다(16번은 띠 안 — 아래 it)
    const paired = new Set(PAIRS.flatMap(([, , rows]) => rows));
    for (const n of by('whole-fixed')) expect(n === 16 || paired.has(n), `표 ${n}번 줄`).toBe(true);
    for (const [, , rows] of PAIRS) for (const n of rows) expect(by('whole-fixed')).toContain(n);
    expect(PAIRS.length).toBe(21);
  });

  it('3D 보기 칸 차례(app.ts)와 바탕 z: 3D 보기는 쌓임 맥락이 아니고, 장면 탭·띠·측정값 칸·처음 화면 3 < 알림·그림 저장 창 6 < 진행·새 판 띠 7 < 사용자가 연 층', () => {
    const app = SRC('src/app/app.ts');
    const line = /const stage = h\('div', \{ class: 'stage' \}, ([^)]*)\);/.exec(app)?.[1];
    expect(line?.split(', ')).toEqual(['sceneTabs', 'viewHost', 'measureBar', 'selBar', 'camBar', 'this.vcb.el', 'this.stick.el', 'start', 'notice', 'busy', 'updateBar']);
    // 그림 저장 창은 그 뒤(3D 보기 칸 끝에 붙임)
    expect(app).toMatch(/new m\.ExportDialog\(\{[^\n]*\}, stage\);/);
    expect(SRC('src/app/exporter.ts')).toContain('this.parent.append(el);');
    expect(Object.fromEntries(STAGE.map(([n]) => [n, zOf(n)]))).toEqual({
      sceneTabs: 3,
      viewHost: 0,
      measureBar: 3,
      selBar: 3,
      camBar: 3,
      vcb: 3,
      stick: 3,
      start: 3,
      notice: 6,
      busy: 7,
      updateBar: 7,
      exportDialog: 6,
    });
    // 3D 보기·작업 공간은 relative에 z·쌓임을 만드는 속성이 없다(안 칸의 z가 그대로 겨룸), 띠는 transform으로 제 쌓임 맥락
    for (const sel of ['.stage', '.workspace']) {
      const d = decls(WIDE, sel);
      expect([d.get('position'), d.get('z-index'), d.get('isolation'), d.get('transform')], sel).toEqual(['relative', undefined, undefined, undefined]);
    }
    expect(decls(WIDE, '.measure-bar').get('transform')).toBe('translateX(-50%)');
    // 사용자가 연 fixed 층(메뉴·안내 상자·끌기 덮개·언어 목록)
    expect(['.menu', '.sc-backdrop', '.dropcover', '.language-list'].map((s) => [decls(WIDE, s).get('position'), Number(decls(WIDE, s).get('z-index'))])).toEqual([
      ['fixed', 50],
      ['fixed', 60],
      ['fixed', 100],
      ['fixed', 10001],
    ]);
  });

  it('통째였던 근거(규칙 셈): 새 판 띠·낮은 창 알림은 장면 탭 높이를 품고, 측정값 칸 말풍선 두 줄은 띠 첫 줄 버튼 높이를 넘는다', () => {
    expect(LH).toBe(1.45);
    // 장면 탭(넓은 화면): 띠 위 8 + 테두리 1 + 안쪽 3 = 12, 높이 12.5 × 1.45 + 4 + 4 / 손가락: 8 + 1 + 2 = 11, 최소 높이 38
    const tab = (m: Form): [number, number] => {
      const bar = decls(m, '.scene-tabs');
      const t = decls(m, '.scene-tab');
      const [pt, , pb] = sides(t.get('padding'));
      const top = px(bar.get('top')) + borderOf(bar.get('border')) + sides(bar.get('padding'))[0];
      return [top, top + Math.max(px(t.get('font-size')) * LH + pt + pb, px(t.get('min-height')))];
    };
    // 새 판 띠: 위 8, 테두리 1 + 안쪽 8 + max(글 13 × 1.45, 버튼 높이) + 8 + 1 — 버튼은 마우스 최소 24, 손가락 max(36, 최소 44)
    const upd = (m: Form): [number, number] => {
      const d = decls(m, '.update-bar');
      const b = decls(m, '.mini-btn', '.update-bar .mini-btn');
      const [pt, , pb] = sides(d.get('padding'));
      const top = px(d.get('top'));
      return [top, top + 2 * borderOf(d.get('border')) + pt + pb + Math.max(px(d.get('font-size')) * LH, px(b.get('height')), px(b.get('min-height')))];
    };
    for (const [m, t, u] of [
      [WIDE, [12, 38.125], [8, 50]],
      [PHONE, [11, 49], [8, 70]],
    ] as const) {
      const [tt, tb] = tab(m);
      const [ut, ub] = upd(m);
      expect([tt, tb, ut, ub].map((v) => Math.round(v * 1000) / 1000), m.name).toEqual([...t, ...u]);
      expect(ut <= tt && ub >= tb, `${m.name}: 새 판 띠 ⊃ 장면 탭(높이)`).toBe(true);
    }
    // 높이 300px 아래 창(47차): 알림은 장면 탭이 있어도 위 8px, 높이 ≥ 테두리 1 + 안쪽 12 + ✕ + 12 + 1(✕ 마우스 30·손가락 44)
    for (const [m, low] of [
      [LOW, 64],
      [LOW_TOUCH, 78],
    ] as const) {
      const n = decls(m, '.notice', '.scene-tabs:not([hidden]) ~ .notice');
      const [pt, , pb] = sides(n.get('padding'));
      const top = px(n.get('top'));
      const bottom = top + 2 * borderOf(n.get('border')) + pt + pb + px(decls(m, '.icon-btn').get('height'));
      const [tt, tb] = tab(m);
      expect([top, bottom], m.name).toEqual([8, low]);
      expect(top <= tt && bottom >= tb, `${m.name}: 알림 ⊃ 장면 탭(높이)`).toBe(true);
      // 탭 줄 아래로 비키는 규칙(50px)은 이 창에서 위 8px가 덮는다
      expect(px(decls(WIDE, '.notice', '.scene-tabs:not([hidden]) ~ .notice').get('top'))).toBe(50);
    }
    // 측정값 칸 말풍선(띠 안 — 칸은 띠 둘째 줄 전체 폭): 아래 끝이 칸 위 6px = 첫 줄 아래 끝(줄 틈 6), 오른쪽 맞춤(첫 줄 버튼 쪽)
    const msg = decls(PHONE, '.vcb-msg');
    expect([msg.get('right'), /calc\(100% \+ (\d+)px\)/.exec(msg.get('bottom') ?? '')?.[1], decls(PHONE, '.measure-bar.has-vcb').get('row-gap')]).toEqual(['0', '6', '6px']);
    expect(decls(PHONE, '.measure-bar .vcb').get('flex')).toBe('1 1 100%');
    const [mt, , mb] = sides(msg.get('padding'));
    const h = (lines: number): number => mt + mb + lines * px(msg.get('font-size')) * LH + 2 * borderOf(msg.get('border'));
    const btn = px(decls(PHONE, '.mb-btn').get('height'));
    expect([h(1), h(2), btn].map((v) => Math.round(v * 1000) / 1000)).toEqual([30.125, 48.25, 38]);
    // 한 줄(한국어 알림)은 버튼 위 8px가 남아 일부, 두 줄(영어·독일어)은 통째
    expect([h(1) < btn, h(2) >= btn]).toEqual([true, true]);
  });

  it('고친 것: 키보드 초점이 든 3D 보기 칸은 그동안 덮던 칸 위 — 짝마다(고치기 전에는 덮던 칸이 위)', () => {
    const under: string[] = [];
    for (const [cover, covered, , when] of PAIRS) {
      // 짝의 전제: 바탕 차례로는 덮는 칸이 위
      expect(above(zOf(cover), cover, zOf(covered), covered), `${cover} → ${covered}: 바탕 차례`).toBe(true);
      if (!above(focusedZ(covered), covered, zOf(cover), cover)) under.push(`${covered}(z ${focusedZ(covered)}) 밑 ${cover}(z ${zOf(cover)}) — ${when}`);
    }
    expect(under).toEqual([]);
  });

  it('고친 것: 측정 띠 안 키보드 초점 버튼은 측정값 칸(띠 안 relative·z 3 — 말풍선이 그 안) 위(고치기 전에는 말풍선이 첫 줄 버튼을 덮음)', () => {
    for (const m of [PHONE, LOW_TOUCH, { ...WIDE, name: '좁은 마우스 창(600×800)', w: 600 }]) {
      const vcb = decls(m, '.vcb', '.measure-bar .vcb');
      expect([vcb.get('position'), vcb.get('z-index')], m.name).toEqual(['relative', '3']);
      const b = decls(m, '.mb-btn', BTN_KEY);
      expect(b.get('position'), m.name).toBe('relative');
      expect(Number(b.get('z-index')), m.name).toBeGreaterThan(Number(vcb.get('z-index')));
    }
  });

  it('올리는 규칙은 쌓임 차례만(자리·크기·보이기 그대로 — 보통 화면 그대로) — 초점 칸을 품는 3D 보기 칸은 모두 올리거나 까닭, 올린 z는 3D 보기 칸 위·사용자가 연 층 밑', () => {
    const raise = RULES.find((r) => !r.media.length && r.sels.every((s) => /^\.stage > \.[\w-]+:has\(:focus-visible\)$/.test(s)));
    expect(raise && key(raise)).toBe(RAISE_KEY);
    expect([...declsOf(raise!.body).keys()]).toEqual(['z-index']);
    const z = Number(declsOf(raise!.body).get('z-index'));
    expect(z).toBeGreaterThan(Math.max(...STAGE.map(([n]) => zOf(n))));
    expect(z).toBeLessThan(Math.min(...['.menu', '.sc-backdrop', '.dropcover', '.language-list'].map((s) => Number(decls(WIDE, s).get('z-index')))));
    const raised = raise!.sels.map((s) => /^\.stage > (\.[\w-]+):has/.exec(s)![1]);
    for (const n of FOCUS_BOXES) expect(raised.includes(selOf(n)) !== n in KEEP, n).toBe(true);
    // 새 판 띠는 가장 큰 바탕 z이고 같은 z(진행)보다 DOM 뒤 — 3D 보기 칸 가운데 맨 위
    for (const [n] of STAGE) if (n !== 'updateBar') expect(above(zOf('updateBar'), 'updateBar', zOf(n), n), n).toBe(true);
    // 띠 안 버튼 규칙도 relative(자리 그대로)와 z뿐
    const btn = RULES.find((r) => key(r) === BTN_KEY);
    expect(btn && [...declsOf(btn.body).entries()]).toEqual([
      ['position', 'relative'],
      ['z-index', '4'],
    ]);
  });

  it('예외·고르지 않음·통째의 근거 코드: 사용자가 연 칸은 초점을 옮기지 않고 닫히고(메뉴·언어 목록·진행)·모달(안내), 그림 저장 창·새 판 띠는 아님, 처음 화면 몫은 까닭', () => {
    const lost: string[] = [];
    for (const [row, srcs] of Object.entries(EVIDENCE)) for (const [file, code] of srcs) if (!code.test(SRC(file))) lost.push(`${row} ${file} ${code.source.slice(0, 60)}`);
    expect(lost).toEqual([]);
    // 예외 줄은 모두 근거가 있다
    for (const f of Object.values(FLOAT)) if (f.verdict === 'exempt' || f.verdict === 'whole-left') expect(EVIDENCE[f.row], String(f.row)).toBeDefined();
    expect(Object.values(KEEP).every(Boolean)).toBe(true);
  });
});
