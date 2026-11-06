// @vitest-environment jsdom
/**
 * 크기·간격·움직임·고대비·색 대비(47차 — WCAG 1.4.3·1.4.11·1.4.10·1.4.12·2.3.3, forced-colors).
 * styles.css의 어두운(:root)·밝은(:root[data-theme='light']) 색 토큰으로 글·경계·상태 표시의 대비를 셈하고(반투명 바탕은 섞은 색),
 * 규칙이 그 토큰을 쓰는지, 움직임 줄이기·고대비·낮은 창 규칙이 있는지 본다.
 * 실제 화면의 모든 글·아이콘 대비와 다시 흐르기·글 간격·고대비·움직임은 헤드리스 Chrome으로 쟀다(README 개발 절).
 * A11Y_CSS: 다른 판의 스타일시트로 돌려 볼 때(앞 판에서 실패하는지 확인용)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(process.env.A11Y_CSS || resolve(__dirname, '../../src/app/styles.css'), 'utf8');

type Rgba = [number, number, number, number];

/** 테마 블록의 --이름: 값 */
function tokens(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('\n}', m.index));
  const out: Record<string, string> = {};
  for (const t of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[t[1]!] = t[2]!.trim();
  return out;
}
const DARK = tokens(/^:root \{/m);
const LIGHT = { ...DARK, ...tokens(/^:root\[data-theme='light'\] \{/m) };

function rgba(s: string | undefined): Rgba {
  const t = (s ?? '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  }
  throw new Error(`색 못 읽음: ${s}`);
}
const over = (top: Rgba, bot: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + bot[i]! * (1 - top[3])).concat(1) as Rgba;
const lum = (c: Rgba): number => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a: Rgba, b: Rgba): number => {
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** 테마의 바탕들(반투명 바탕은 놓이는 바탕에 섞는다) */
function surfaces(T: Record<string, string>): Record<string, Rgba> {
  const c = (k: string) => rgba(T[k]);
  const s: Record<string, Rgba> = { app: c('--bg'), bar: c('--bg-bar'), panel: c('--bg-panel'), elev: c('--bg-elev'), input: c('--bg-input') };
  s.softBar = over(c('--accent-soft'), s.bar!);
  s.softPanel = over(c('--accent-soft'), s.panel!);
  s.softInput = over(c('--accent-soft'), s.input!);
  s.hoverPanel = over(c('--bg-hover'), s.panel!);
  s.hoverElev = over(c('--bg-hover'), s.elev!);
  s.groupPanel = over(c('--group-soft'), s.panel!);
  // 고른 줄(옅은 강조) 위 그룹 칩(옅은 파랑)
  s.groupSel = over(c('--group-soft'), s.softPanel!);
  return s;
}

const THEMES: [string, Record<string, string>][] = [
  ['dark', DARK],
  ['light', LIGHT],
];

function below(T: Record<string, string>, fg: string, bgs: string[], need: number): string[] {
  const S = surfaces(T);
  return bgs.filter((b) => contrast(rgba(T[fg]), S[b]!) < need).map((b) => `${fg} on ${b} ${contrast(rgba(T[fg]), S[b]!).toFixed(2)}`);
}

/** 선택자(쉼표 목록 안이어도)가 받는 규칙 본문 모두(주석 뺌). within: 그 @media 블록 안만 */
function bodies(sel: string, within?: string): string {
  let src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (within) {
    const at = src.indexOf(within);
    if (at < 0) return '';
    let depth = 0;
    let end = at;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    src = src.slice(src.indexOf('{', at) + 1, end);
  }
  return [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel))
    .map((m) => m[2])
    .join(';');
}

describe('색 대비 토큰(47차 — 1.4.3 글 4.5:1, 1.4.11 경계·상태 3:1)', () => {
  for (const [name, T] of THEMES) {
    it(`${name}: 옅은 글은 앱·막대·패널·카드·입력 칸 바탕 위 4.5:1`, () => {
      expect(below(T, '--text-faint', ['app', 'bar', 'panel', 'elev', 'input'], 4.5)).toEqual([]);
    });
    it(`${name}: 흐린 글(키 글·고른 줄·마우스 올린 줄의 옅은 글)은 마우스·고른 줄 바탕 위 4.5:1`, () => {
      expect(below(T, '--text-dim', ['hoverPanel', 'hoverElev', 'softPanel', 'elev'], 4.5)).toEqual([]);
    });
    it(`${name}: 강조색 글은 옅은 강조 바탕(눌린 단추·컴포넌트 칩·고른 줄) 위 4.5:1`, () => {
      expect(below(T, '--accent-fg', ['softBar', 'softPanel', 'softInput'], 4.5)).toEqual([]);
    });
    it(`${name}: 그룹 칩 글은 칩 바탕·고른 줄 위 칩 바탕 위 4.5:1`, () => {
      expect(below(T, '--group-fg', ['groupPanel', 'groupSel'], 4.5)).toEqual([]);
    });
    it(`${name}: 입력 칸 경계는 둘레 바탕과 3:1, 눌린 단추 테두리(강조색)는 막대·묶음 바탕과 3:1`, () => {
      expect(below(T, '--border-input', ['app', 'bar', 'panel', 'elev', 'input'], 3)).toEqual([]);
      expect(below(T, '--accent', ['bar', 'input', 'panel'], 3)).toEqual([]);
    });
  }
});

describe('대비 규칙이 토큰을 쓴다(47차)', () => {
  it('눌린 도구 단추는 강조색 테두리 + 강조색 글, seg 단추는 안쪽 테두리(옅은 바탕만으로는 1.2~1.3:1)', () => {
    expect(bodies('.tbtn.on')).toMatch(/border-color:\s*var\(--accent\)/);
    expect(bodies('.tbtn.on')).toMatch(/color:\s*var\(--accent-fg\)/);
    expect(bodies('.seg-btn.on')).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--accent\)/);
  });
  it('칩·키 글·옅은 글: 그룹·컴포넌트 칩, 키 글은 흐린 글, 고른 줄·마우스 줄의 옅은 글도 흐린 글', () => {
    expect(bodies('.k-group')).toMatch(/color:\s*var\(--group-fg\)/);
    expect(bodies('.k-component')).toMatch(/color:\s*var\(--accent-fg\)/);
    expect(bodies('kbd')).toMatch(/color:\s*var\(--text-dim\)/);
    for (const s of ['.prow.sel .count', '.prow:hover .count', '.prow.sel .name small']) expect(bodies(s), s).toMatch(/color:\s*var\(--text-dim\)/);
  });
  it('찾기 칸·측정값 칸 경계는 입력 칸 경계 토큰, 찾기 칸 자리 글은 옅은 글(Chrome 기본 #757575는 2.8:1)', () => {
    expect(bodies('.search-input')).toMatch(/border:\s*1px solid var\(--border-input\)/);
    expect(bodies('.vcb-input')).toMatch(/border:\s*1px solid var\(--border-input\)/);
    expect(bodies('.search-input::placeholder')).toMatch(/color:\s*var\(--text-faint\)/);
  });
  it('숨긴 폴더·그룹 아래 줄·빈 줄·재생에서 뺀 장면 탭은 반투명 대신 글 색(반투명 글 1.9~3.1:1)', () => {
    expect(bodies('.prow.dimmed')).not.toMatch(/opacity/);
    expect(bodies('.prow.dimmed')).toMatch(/color:\s*var\(--text-dim\)/);
    expect(bodies('.prow.empty')).not.toMatch(/opacity/);
    expect(bodies('.scene-tab.no-play:not(.on)')).not.toMatch(/opacity/);
  });
  it('언어 단추 초점 테두리는 강조색(시스템 Highlight는 밝은 테마 막대 위 1.45:1)', () => {
    expect(css).toMatch(/\.language-trigger:focus-visible, \.language-list button:focus-visible \{ outline: 2px solid var\(--accent\);/);
  });
});

describe('움직임 줄이기(47차 — 2.3.3)', () => {
  it('스타일: prefers-reduced-motion이면 전환·애니메이션을 모두 끈다', () => {
    const b = bodies('*', '@media (prefers-reduced-motion: reduce)');
    expect(b).toMatch(/transition:\s*none !important/);
    expect(b).toMatch(/animation:\s*none !important/);
  });
});

describe('고대비(47차 — forced-colors)', () => {
  const at = '@media (forced-colors: active)';
  it('켬·고름 상태는 시스템 강조색 바탕(바탕 색·안쪽 그림자가 지워지고 투명 테두리가 모두 보여 끈 것과 같아졌다)', () => {
    for (const s of ['.tbtn.on', '.seg-btn.on', '.mb-btn.on', '.scene-tab.on', '.scene-play.on', '.ptab.on', '.prow.sel', '.ptable tr.pick.sel', 'button.scene-card.sel']) {
      expect(bodies(s, at), s).toMatch(/background:\s*Highlight/);
      expect(bodies(s, at), s).toMatch(/color:\s*HighlightText/);
    }
  });
  it('고른 줄 안 글(수·경로·칩)도 강조 글 색(제 색이 CanvasText로 바뀌어 강조 바탕 위 1.9~3.4:1)', () => {
    for (const s of ['.prow.sel *', '.ptable tr.pick.sel *', 'button.scene-card.sel *']) expect(bodies(s, at), s).toMatch(/color:\s*HighlightText/);
  });
  it('태그·재질 색 견본은 그대로, 창 가르개 초점 막대는 강조색(::after 바탕이 지워졌다)', () => {
    expect(bodies('.swatch', at)).toMatch(/forced-color-adjust:\s*none/);
    expect(bodies('.resizer:focus-visible::after', at)).toMatch(/background:\s*Highlight/);
  });
});

describe('다시 흐르기(47차 — 1.4.10, 1280px 창 400% = 320×256)', () => {
  it('좁은 창은 마우스여도 로고만(“OpenC…”로 잘렸다)', () => {
    expect(bodies('.brand-text', '@media (max-width: 374.98px) {')).toMatch(/display:\s*none/);
  });
  it('아주 낮은 창: 알림은 위에 붙여 그 안에서 굴리고, 좁으면 측정 띠 단추를 다음 줄로(글이 3D 보기 밖으로 잘렸다)', () => {
    const n = bodies('.notice', '@media (max-height: 300px) {');
    expect(n).toMatch(/top:\s*8px/);
    expect(n).toMatch(/max-height:\s*calc\(100% - 16px\)/);
    expect(n).toMatch(/overflow-y:\s*auto/);
    expect(bodies('.measure-bar', '@media (max-height: 300px) and (max-width: 479.98px)')).toMatch(/flex-wrap:\s*wrap/);
    expect(bodies('.measure-bar .mb-text', '@media (max-height: 300px) and (max-width: 479.98px)')).toMatch(/flex:\s*1 1 100%/);
  });
});
