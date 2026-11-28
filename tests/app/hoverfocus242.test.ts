// @vitest-environment jsdom
/**
 * 242차: 올림·초점으로 뜨는 내용(WCAG 1.4.13 Content on Hover or Focus) — 앱이 포인터 올림·키보드 초점으로 띄우는 내용은
 * (가) 포인터·초점을 옮기지 않고 닫을 수 있고(다른 내용을 가리지 않거나 입력 오류 알림이면 예외), (나) 포인터로 띄웠으면 포인터를 그 위로 옮겨도 사라지지 않고,
 * (다) 올림·초점이 걷히거나 사용자가 닫거나 정보가 낡을 때까지 남는다(시간으로 저절로 사라지지 않음). 브라우저 title 말풍선은 사용자 에이전트 몫이라 셈 밖.
 * 감사 표(HOVER — 줄 번호는 .runtime/r242/progress.md 표)와 src의 올림·초점 사건 자리(LISTEN)를 소스 글로 대 보고 — 표 밖에 새 자리가 생기면 실패한다 —
 * styles.css의 :hover·:focus 규칙이 트리거 자신의 꼴(배경·글 색·테두리·초점 테두리)만 바꾸는지 본다(새 내용을 띄우는 규칙이 생기면 실패).
 * 고친 것: 측정 툴팁(마우스·펜 커서 옆 스냅 이름·값)은 모형을 가리는데 점을 둔 채 닫는 길이 없었다 — 측정 도구가 받은 Esc가 그 누름에 툴팁도 닫고,
 * 포인터가 4화소 넘게 움직이거나 찍기·Tab 돌리기를 하면 다시 뜬다(Esc 차례는 그대로 — 근거는 progress.md). 실제 측정 도구·덧그림·코어 고르기로 (가)(나)(다)를 본다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3d } from 'opencad-viewer3d';
import { buildBvh } from 'opencad-viewer3d/bvh';
import type { CameraState } from 'opencad-viewer3d/camera';
import { pickScene } from 'opencad-viewer3d/scenepick';
import type { LineSet3d, Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import { MeasureTool, type MeasureViewer } from '../../src/app/measure';
import { Overlay, frameFor } from '../../src/app/overlay';
import { DEFAULT_UNITS } from '../../src/app/units';

// ───────────────────────── 감사 표 ─────────────────────────

type Verdict = '고침' | '지킴' | '셈 밖';
interface Row {
  what: string;
  verdict: Verdict;
  /** 앱이 띄우는 내용이면 (가)(나)(다) 판정 — 셈 밖이면 까닭 하나 */
  a?: string;
  b?: string;
  c?: string;
  why?: string;
}

/** progress.md 표 1~9줄 */
const HOVER: Record<number, Row> = {
  1: {
    what: '측정 툴팁(마우스·펜 커서 옆 스냅 이름·값 — 모형을 가림)',
    verdict: '고침',
    a: '측정 도구가 받은 Esc(찍은 점·끌어온 점·각도기 평면 고정·결과를 지움)가 그 누름에 툴팁도 닫음 — 4화소 넘는 이동·찍기·Tab 돌리기에 다시 뜸',
    b: '따라옴 — pointer-events none, 그릴 때마다 커서 옆으로 옮겨 3D 보기 안에서는 사라지지 않음',
    c: '타이머 없음 — 떠남·끌기·찍기·다시 구하기에만 바뀜',
  },
  2: {
    what: '측정 커서 표식(스냅 표식·추론 선·고무줄·각도기 원판·안내 두기 +)',
    verdict: '지킴',
    a: '예외 — 선·작은 표식만(글·조작을 덮지 않음), 진행 중 선은 Esc가 지움',
    b: '포인터 자리 그 자체',
    c: '타이머 없음',
  },
  3: {
    what: '겹친 것 목록 줄 미리 강조(3D 강조·코어 후보 표식)',
    verdict: '지킴',
    a: '예외(모형 색 강조 — 가리지 않음) + Esc·Tab이 목록을 닫으며 되돌림',
    b: '떠남을 듣지 않아 포인터를 강조된 3D 보기로 옮겨도 그 줄 초점 그대로',
    c: '타이머 없음 — 다른 줄 초점·닫기에만',
  },
  4: { what: '뷰 큐브 올림 강조(코어)', verdict: '셈 밖', why: '큐브 자신의 꼴 바뀜 — 새 내용 아님' },
  5: { what: 'CSS :hover·:focus 규칙', verdict: '셈 밖', why: '트리거 자신의 배경·글 색·테두리·초점 테두리만(아래 it)' },
  6: { what: '측정 띠 잠깐 알림', verdict: '셈 밖', why: '누름·키로 띄움 — 올림은 시간을 멈추기만(166차)' },
  7: { what: '듣기만 하는 자리(끌기·rove·메뉴 닫기·입력 칸)', verdict: '셈 밖', why: '아무것도 띄우지 않음' },
  8: { what: '가상 커서·정밀 조준의 툴팁', verdict: '셈 밖', why: '키·누름으로 띄움' },
  9: { what: '브라우저 title 말풍선', verdict: '셈 밖', why: '사용자 에이전트 몫' },
};

/** src의 올림·초점 사건 문자열 — 파일(src 기준) → 사건 → [수, 표 줄] */
const LISTEN: Record<string, Record<string, [count: number, rows: number[]]>> = {
  'app/app.ts': { pointermove: [2, [7]] },
  'app/flash.ts': { pointerenter: [1, [6]], pointerleave: [1, [6]] },
  'app/infotab.ts': { focusin: [1, [7]] },
  'app/joystick.ts': { pointermove: [1, [7]] },
  'app/kbd.ts': { focusin: [2, [7]] },
  'app/measure.ts': { pointermove: [3, [1, 2, 7]], pointerleave: [1, [1]], blur: [1, [7]] },
  'app/picklist.ts': { pointermove: [2, [3, 7]], pointerleave: [1, [7]], focus: [1, [3]] },
  'app/vcb.ts': { focus: [1, [7]], blur: [1, [7]] },
};

const SRC = resolve(__dirname, '../../src');
const EVENT = /(['"`])(pointer(?:enter|over|move|leave|out)|mouse(?:enter|over|move|leave|out)|focus(?:in|out)?|blur)\1/g;

describe('242차 감사 표 — 올림·초점 자리(소스 글)', () => {
  it('src의 올림·초점 사건 자리가 모두 표(LISTEN)에 들고 그 줄이 판정을 가진다 — 새 자리는 표에 더해야 통과', () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split(sep).join('/'));
    expect(files.length).toBeGreaterThan(40);
    const found: Record<string, Record<string, number>> = {};
    const props: string[] = [];
    for (const f of files) {
      const s = readFileSync(resolve(SRC, f), 'utf8');
      for (const m of s.matchAll(EVENT)) ((found[f] ??= {})[m[2]!] = (found[f]?.[m[2]!] ?? 0) + 1);
      // 사건 속성(onmouseenter = …·onfocus = …)으로 듣는 길도 없다
      for (const m of s.matchAll(/\.on(?:pointer|mouse)(?:enter|over|move|leave|out)\s*=|\.on(?:focus|focusin|focusout|blur)\s*=/g)) props.push(`${f}: ${m[0]}`);
    }
    const want = Object.fromEntries(Object.entries(LISTEN).map(([f, ev]) => [f, Object.fromEntries(Object.entries(ev).map(([e, [n]]) => [e, n]))]));
    expect(found).toEqual(want);
    expect(props).toEqual([]);
    // 표 줄: 1~9, 앱이 띄우는 내용(고침·지킴)은 (가)(나)(다)를, 셈 밖은 까닭을 가진다 — 자리마다 그 줄이 있다
    expect(Object.keys(HOVER).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [n, r] of Object.entries(HOVER)) {
      if (r.verdict === '셈 밖') expect(r.why, n).toBeTruthy();
      else expect([r.a, r.b, r.c].every((t) => !!t), n).toBe(true);
    }
    for (const ev of Object.values(LISTEN)) for (const [, rows] of Object.values(ev)) for (const n of rows) expect(HOVER[n], String(n)).toBeDefined();
    // 셈: 앱이 띄우는 내용 3(고친 것 1), 셈 밖 6
    const by = (v: Verdict): number => Object.values(HOVER).filter((r) => r.verdict === v).length;
    expect([by('고침'), by('지킴'), by('셈 밖')]).toEqual([1, 2, 6]);
  });

  it('styles.css의 :hover·:focus 규칙 30(올림 23·초점 10 — 셋은 둘 다, :focus-within 0)은 트리거 자신의 꼴만 바꾼다 — 내용을 띄우는 규칙이 생기면 실패', () => {
    const css = readFileSync(resolve(SRC, 'app/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: { sels: string[]; body: string }[] = [];
    const read = (src: string): void => {
      for (let i = 0; ; ) {
        const open = src.indexOf('{', i);
        if (open < 0) return;
        let depth = 1;
        let j = open + 1;
        for (; j < src.length && depth; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
        const head = src.slice(i, open).trim();
        const inner = src.slice(open + 1, j - 1);
        if (head.startsWith('@media')) read(inner);
        else if (!head.startsWith('@')) rules.push({ sels: head.split(',').map((s) => s.trim()), body: inner });
        i = j;
      }
    };
    read(css);
    const hov = rules.filter((r) => r.sels.some((s) => s.includes(':hover')));
    const foc = rules.filter((r) => r.sels.some((s) => s.includes(':focus')));
    const both = new Set([...hov, ...foc]);
    expect([hov.length, foc.length, both.size]).toEqual([23, 10, 30]);
    expect(rules.filter((r) => r.sels.some((s) => s.includes(':focus-within')))).toEqual([]);
    const STYLE_ONLY = new Set(['background', 'background-color', 'color', 'border-color', 'outline', 'outline-offset', 'border-radius']);
    const bad: string[] = [];
    for (const r of both)
      for (const d of r.body.split(';')) {
        const c = d.indexOf(':');
        const p = c > 0 ? d.slice(0, c).trim() : '';
        if (p && !STYLE_ONLY.has(p)) bad.push(`${r.sels.join(', ')} { ${p} }`);
      }
    expect(bad).toEqual([]);
  });
});

// ───────────────────────── 측정 툴팁(실제 도구 — measure.test 꼴의 가짜 뷰어) ─────────────────────────

const W = 200;
const FOV = (40 * Math.PI) / 180;
/** 위에서 본 평행 투영: 세계 (X, Y) → 화면 (100 + X, 100 − Y) */
const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };
const lines = (id: string, segs: number[][]): LineSet3d => ({ id, positions: Float32Array.from(segs.flat()) });
/** 모서리 둘(원점에서 +X 100·+Y 50)과 그 아래 면(X 0~100·Y −80~0, Z −1 — 화면 x 100~200·y 100~180: 툴팁이 뜨는 오른쪽 아래) */
const SCENE: Pick<Scene3d, 'meshes' | 'lines' | 'units'> = {
  units: 'mm',
  lines: [lines('e', [[0, 0, 0, 100, 0, 0], [0, 0, 0, 0, 50, 0]])],
  meshes: [
    {
      id: 'f',
      positions: Float32Array.from([0, -80, -1, 100, -80, -1, 100, 0, -1, 0, 0, -1]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      color: [0.8, 0.8, 0.8, 1],
    } satisfies Mesh3d,
  ],
};

interface Rig {
  tool: MeasureTool;
  overlay: Overlay;
  canvas: HTMLCanvasElement;
  move(x: number, y: number): void;
  click(x: number, y: number): void;
  leave(): void;
  key(key: string): boolean;
  tip(): HTMLElement;
  text(): string | null;
}

let rigs: Rig[] = [];
afterEach(() => {
  for (const r of rigs) {
    r.tool.dispose();
    r.overlay.dispose();
  }
  rigs = [];
  document.body.replaceChildren();
  vi.useRealTimers();
});

function rig(): Rig {
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => W });
  Object.defineProperty(canvas, 'clientHeight', { get: () => W });
  host.append(canvas);
  document.body.append(host);
  const items = { meshes: SCENE.meshes, lines: SCENE.lines, points: [] };
  const viewer: MeasureViewer = {
    canvas,
    // 코어 pick처럼: meshesOnly면 메시 면만
    pick: (x, y, o) =>
      pickScene(frameFor(TOP, W, W), x, y, typeof o === 'object' && o.meshesOnly ? { ...items, lines: [] } : items, {
        tol: 6,
        occlude: true,
        bvh: (kind, pos, idx) => (kind === 'triangle' ? buildBvh(kind, pos, idx) : null),
      })?.pick ?? null,
    getCamera: () => TOP,
    onCameraChange: () => () => undefined,
    getRenderMode: () => 'shaded',
    section: null,
  };
  const overlay = new Overlay(host);
  overlay.attach(viewer as unknown as Viewer3d);
  const tool = new MeasureTool(viewer, overlay, { getScene: () => SCENE, getUnits: () => DEFAULT_UNITS, onResult: () => undefined });
  const ptr = (type: string, x: number, y: number, buttons = 0): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
  };
  const r: Rig = {
    tool,
    overlay,
    canvas,
    move(x, y) {
      ptr('pointermove', x, y);
      overlay.paintNow();
    },
    click(x, y) {
      ptr('pointerdown', x, y, 1);
      ptr('pointerup', x, y);
      overlay.paintNow();
    },
    leave() {
      ptr('pointerleave', -10, -10);
      overlay.paintNow();
    },
    key(k) {
      // 앱 창 키 처리(keypick → 측정 도구 handleKey)처럼 3D 보기 캔버스가 대상인 키
      const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
      Object.defineProperty(e, 'target', { value: canvas });
      const handled = tool.handleKey(e);
      overlay.paintNow();
      return handled;
    },
    tip: () => host.querySelector<HTMLElement>('.measure-tip')!,
    text() {
      const el = host.querySelector<HTMLElement>('.measure-tip');
      return el && el.style.display !== 'none' ? el.textContent : null;
    },
  };
  rigs.push(r);
  return r;
}

describe('242차 측정 툴팁 — (가) 닫기·(나) 올리기·(다) 남음', () => {
  it('(가) 찍은 점이 있을 때 Esc는 점을 지우며 툴팁도 닫는다 — 4화소 안 이동은 닫힌 채, 넘으면·떠났다 오면 다시 뜬다', () => {
    const r = rig();
    r.tool.setMode('tape');
    r.move(102, 103);
    expect(r.text()).toBe('끝점');
    // 지울 것이 없는 Esc는 받지 않는다(앱이 도구를 끈다 — 툴팁 칸을 뗌) — 툴팁은 그대로
    expect(r.key('Escape')).toBe(false);
    expect(r.text()).toBe('끝점');
    r.click(102, 103);
    expect(r.tool.pointCount).toBe(1);
    r.move(153, 101);
    expect(r.text()).toMatch(/^중간점 · 50 mm$/);
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.pointCount).toBe(0);
    expect(r.text()).toBeNull();
    // 표식(포인터 자리)은 그대로 — 닫는 것은 가리는 툴팁만
    expect(document.querySelector('.measure-snap-midpoint')).not.toBeNull();
    // 4화소 안(떨림)은 닫힌 채, 4화소 넘게 움직이면 그 자리의 추정으로 다시 뜬다
    r.move(155, 102);
    expect(r.text()).toBeNull();
    r.move(157, 101);
    expect(r.text()).toBeNull();
    r.move(158, 101);
    expect(r.text()).not.toBeNull();
    // 떠났다 다시 오면(트리거를 다시 얹음) 그 자리에서도 뜬다
    r.click(158, 101);
    expect(r.tool.pointCount).toBe(1);
    expect(r.key('Escape')).toBe(true);
    expect(r.text()).toBeNull();
    r.leave();
    r.move(158, 101);
    expect(r.text()).not.toBeNull();
  });

  it('(가) 결과를 지우는 Esc도 닫고, 그 자리 찍기·Tab 돌리기는 다시 띄운다 — 돌리기만 푸는 Esc는 닫지 않는다(첫 후보 글)', () => {
    const r = rig();
    r.tool.setMode('tape');
    r.move(102, 103);
    r.click(102, 103);
    r.move(198, 101);
    r.click(198, 101);
    expect(r.tool.result).not.toBeNull();
    expect(r.text()).toMatch(/^끝점/);
    // 돌리는 중 Esc: 돌리기만 풀고 첫 후보 글(툴팁 알림이 그 글을 읽힘) — 닫지 않는다
    r.move(102, 103);
    expect(r.key('Tab')).toBe(true);
    expect(r.text()).toMatch(/ 2\/\d+$/);
    expect(r.key('Escape')).toBe(true);
    expect(r.text()).toBe('끝점');
    expect(r.tool.result).not.toBeNull();
    // 다음 Esc(결과 지우기)가 닫는다
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.result).toBeNull();
    expect(r.text()).toBeNull();
    // 그 자리 찍기: 새 정보(시작점)라 다시 뜬다
    r.click(102, 103);
    expect(r.tool.pointCount).toBe(1);
    expect(r.text()).toMatch(/^끝점/);
    // 점을 지우며 닫은 자리의 Tab 돌리기: 그 차례 글로 다시 뜬다
    r.move(153, 101);
    expect(r.key('Escape')).toBe(true);
    expect(r.tool.pointCount).toBe(0);
    expect(r.text()).toBeNull();
    expect(r.key('Tab')).toBe(true);
    expect(r.text()).toMatch(/ \d+\/\d+$/);
  });

  it('(나) 포인터를 툴팁이 있던 자리로 옮겨도 사라지지 않고 커서 옆으로 옮겨 간다(누르기 통과 — 포인터 밑에 오지 않음)', () => {
    const r = rig();
    r.tool.setMode('tape');
    r.move(102, 103);
    const tip = r.tip();
    expect(r.text()).toBe('끝점');
    expect(tip.style.pointerEvents).toBe('none');
    expect(tip.parentElement!.style.pointerEvents).toBe('none');
    // 커서 오른쪽 아래(14·18 — tooltipPosition)
    expect([tip.style.left, tip.style.top]).toEqual(['116px', '121px']);
    // 툴팁이 덮던 자리 안(면 위)으로: 그 자리 추정(면에)으로 보이고 다시 커서 오른쪽 아래
    r.move(120, 125);
    expect(r.text()).toBe('면에');
    expect([tip.style.left, tip.style.top]).toEqual(['134px', '143px']);
    expect(r.tip()).toBe(tip);
  });

  it('(다) 포인터를 그대로 두면 시간이 흘러도(가짜 시계 60초) 남는다', () => {
    vi.useFakeTimers();
    const r = rig();
    r.tool.setMode('tape');
    r.move(102, 103);
    expect(r.text()).toBe('끝점');
    for (let s = 0; s < 6; s++) {
      vi.advanceTimersByTime(10_000);
      r.overlay.paintNow();
      expect(r.text(), `${(s + 1) * 10}초`).toMatch(/^끝점/);
    }
  });
});
