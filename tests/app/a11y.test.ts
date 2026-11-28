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
import { h } from '../../src/app/dom';

const css = readFileSync(process.env.A11Y_CSS || resolve(__dirname, '../../src/app/styles.css'), 'utf8');
const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');

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
  it('앱: 코어 맞춰 보기·표준 뷰·뷰 큐브와 앱 카메라 옮기기(장면 전환·고른 것 맞춰 보기·이전 보기)를 바로 둔다 — 54차: 코어 animate \'auto\'와 flyTo', () => {
    // 코어 0.48.0 'auto'가 prefers-reduced-motion을 듣고(연 뒤 바꾼 설정도) 따르므로 앱은 제 질의를 두지 않는다
    expect(app).toMatch(/animate: 'auto',/);
    expect(app).not.toMatch(/media\('\(prefers-reduced-motion/);
    // 앱 카메라 옮기기는 코어 flyTo(움직이지 않는 설정이면 코어가 바로 옮긴다) — 앱의 requestAnimationFrame 고리·바로 두기 갈래는 없다
    expect(app).toMatch(/v\.flyTo\(to, undefined, \{ duration: ms \}\)/);
    expect(app).not.toMatch(/cancelAnimationFrame/);
    // 새 문서를 올리면 앞 문서의 움직임을 먼저 끝낸다(그 끝 알림이 새 문서의 2점 투시를 켜지 않게) — 2점 투시를 끄기 전에
    const setDoc = app.slice(app.indexOf('private setDoc('), app.indexOf('private setDoc(') + 3000);
    expect(setDoc.indexOf('this.stopCameraAnim();')).toBeGreaterThan(0);
    expect(setDoc.indexOf('this.stopCameraAnim();')).toBeLessThan(setDoc.indexOf('this.twoPointOn = false;'));
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
    // 보통 화면의 .prow.sel .count·.prow.sel .name small(흐린 글 색 — 구체성이 * 보다 높다)도 덮는다
    for (const s of ['.prow.sel *', '.prow.sel .count', '.prow.sel .name small', '.ptable tr.pick.sel *', 'button.scene-card.sel *']) expect(bodies(s, at), s).toMatch(/color:\s*HighlightText/);
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

  // 200차: 1.4.10은 폭만 정한다 — 폭 320px이면 높이와 상관없이(320px 휴대폰 세로·높은 창 400%). @media 머리를 그 창(마우스)에 맞춰 본다
  const mediaFits = (q: string, w: number, ht: number): boolean =>
    q.split(',').some((part) => {
      const f = [...part.matchAll(/\(([\w-]+):\s*([^)]+)\)/g)];
      return f.length > 0 && f.every(([, k, v]) => (k === 'max-width' ? w <= parseFloat(v) : k === 'max-height' ? ht <= parseFloat(v) : k === 'pointer' && v.trim() === 'fine'));
    });
  /** @media 블록마다 머리와 안 글(주석 뺌) */
  const mediaBlocks = (): { q: string; src: string }[] => {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...src.matchAll(/@media ([^{]+)\{/g)].map((m) => {
      const open = m.index! + m[0].length;
      let depth = 1;
      let i = open;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
      }
      return { q: m[1]!.trim(), src: src.slice(open, i - 1) };
    });
  };
  /** 그 창에 맞는 @media 블록 안에서 선택자(쉼표 목록 안이어도)가 받는 규칙 본문 */
  const fitting = (sel: string, w: number, ht: number): string =>
    mediaBlocks()
      .filter((b) => mediaFits(b.q, w, ht))
      .flatMap((b) => [...b.src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]!))
      .join(';');
  const twoRows = (w: number, ht: number): boolean => /flex-wrap:\s*wrap/.test(fitting('.measure-bar', w, ht)) && /flex:\s*1 1 100%/.test(fitting('.measure-bar .mb-text', w, ht));

  it('폭 320px은 높이 300px을 넘어도 측정 띠·고른 것 카드의 글을 한 줄에 두고 버튼을 다음 줄로 — 버튼 옆이면 글 칸 68px라 영어 measurement·독일어 Winkelmesser:가 버튼 밑으로 넘쳐 가렸다', () => {
    // 손셈(띠 한 줄): 띠 폭 = 3D 보기 320 − 16, 안 폭 = − 테두리 둘 − 여백(오른 6·왼 12), 글 칸 = − 사이 10 − 버튼 다섯(38px — 「다시 재기」는 430px 아래 아이콘만)·사이 넷
    const bar = bodies('.measure-bar');
    const num = (re: RegExp, s: string): number => Number(re.exec(s)?.[1]);
    const pad = /padding:\s*\d+px (\d+)px \d+px (\d+)px/.exec(bar);
    const inner = 320 - num(/max-width:\s*calc\(100% - (\d+)px\)/, bar) - 2 * num(/border:\s*(\d+)px/, bar) - Number(pad?.[1]) - Number(pad?.[2]);
    const btn = num(/width:\s*(\d+)px/, bodies('.mb-btn.icon'));
    const gap = num(/gap:\s*(\d+)px/, bodies('.mb-acts'));
    expect([inner, inner - num(/(?:^|;)\s*gap:\s*(\d+)px/, bar) - (5 * btn + 4 * gap)]).toEqual([284, 68]);
    // 두 줄이면 글은 284px 줄, 버튼 줄에는 여섯(방향 잠금·복사가 함께여도)이 들어간다
    expect(6 * btn + 5 * gap).toBeLessThanOrEqual(inner);
    // 47차 낮은 창(1280×1024 창 400% = 320×256)과 320px 휴대폰 세로(320×568) 모두 두 줄, 띠 폭을 넘는 띄어쓰기 없는 파일 이름은 띠 안에서 끊는다
    expect([twoRows(320, 256), twoRows(320, 568)]).toEqual([true, true]);
    expect(fitting('.measure-bar .mb-text', 320, 568)).toMatch(/overflow-wrap:\s*anywhere/);
    // 넓은 창·375px 휴대폰 세로는 그대로 한 줄(넓은 화면은 바꾸지 않는다)
    expect([twoRows(375, 667), twoRows(1280, 800)]).toEqual([false, false]);
  });

  // 201차: 그림 저장 창(exporter.ts)은 3D 보기(.stage — 넘침 숨김) 안에 붙는데 높이 한도가 없어, 400% 확대(320×256 — 3D 보기 143px)에서 265px 창의 위(닫기 ✕·크기)가 잘렸다
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @media 밖 규칙 본문(들여 쓰지 않은 그 선택자 한 줄) */
  const top = (sel: string): string => new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(plain)?.[1] ?? '';
  const cascade = (sel: string, w: number, ht: number): string => `${top(sel)};${fitting(sel, w, ht)}`;
  /** 마지막으로 이기는 그 속성의 px 값(min-height는 height로 세지 않음) */
  const px = (prop: string, s: string): number => Number([...s.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`, 'g'))].pop()?.[1]);
  // 손셈(3D 보기 높이): 창 − 제목 막대(+ 아래 선 1) − 도구 막대 한 줄(위아래 여백 + 버튼 + 아래 선 1) − 상태 막대(+ 위 선 1)
  const stage = (w: number, ht: number): number =>
    ht - (px('height', cascade('.titlebar', w, ht)) + 1) - (2 * px('padding', cascade('.toolbar', w, ht)) + px('height', cascade('.tbtn', w, ht)) + 1) - (px('height', cascade('.statusbar', w, ht)) + 1);
  const sizes: [number, number][] = [[320, 256], [320, 300], [320, 400], [1280, 300], [1280, 400], [1280, 800], [320, 568]];
  it('그림 저장 창은 3D 보기 안 남은 높이까지만 두고 그 안에서 굴린다(47차 알림 꼴 — 반대쪽 8px), 넓은 화면·높은 창은 한도에 닿지 않아 그대로', () => {
    expect(sizes.map(([w, ht]) => stage(w, ht))).toEqual([143, 187, 287, 185, 285, 685, 455]);
    // 손셈(창 높이, 마우스): 테두리 둘 + 위아래 여백 + 머리(닫기 버튼 + 아래 사이) + 크기 묶음(이름 12px 한 줄 + 아래 사이, 라디오 둘, 아래 사이) + 확인 줄 둘 + 버튼 줄(위 사이 + 버튼) + 알림 줄(위 사이 + 1em)
    const d = top('.export-dialog');
    const pad = /padding:\s*(\d+)px \d+px (\d+)px/.exec(d);
    const lh = Number(/font:\s*\d+px\/([\d.]+)/.exec(plain)?.[1]);
    const legend = top('.ex-group legend');
    const opt = px('min-height', top('.ex-opt'));
    const H =
      2 * px('border', d) + Number(pad?.[1]) + Number(pad?.[2]) + px('height', top('.icon-btn')) + px('margin-bottom', top('.ex-head')) +
      px('font-size', legend) * lh + px('margin-bottom', legend) + 2 * opt + Number(/margin:\s*0 0 (\d+)px/.exec(top('.ex-group'))?.[1]) +
      2 * opt + px('margin-top', top('.ex-acts')) + px('height', top('.btn')) + px('margin', top('.ex-status')) + px('font-size', top('.ex-status'));
    expect(Math.round(H)).toBe(265);
    // 창(마우스)마다 [한도에 닿는지, 붙는 쪽(좁으면 아래 12px, 넓으면 위 56px) 반대쪽에 남는 높이]
    const place = (w: number, ht: number): [boolean, number] => {
      const s = cascade('.export-dialog', w, ht);
      const cut = [...s.matchAll(/max-height:\s*calc\(100% - (\d+)px\)/g)].pop()?.[1];
      const limit = cut === undefined ? Infinity : stage(w, ht) - Number(cut);
      const at = /bottom:\s*\d+px/.test(fitting('.export-dialog', w, ht)) ? px('bottom', s) : px('top', s);
      return [H > limit, Math.round(stage(w, ht) - at - Math.min(H, limit))];
    };
    expect(/overflow-y:\s*auto/.test(top('.export-dialog'))).toBe(true);
    // 3D 보기보다 높아 잘리던 창(좁은 320×256·300, 넓은 높이 300·400)은 한도까지 줄고 반대쪽 8px을 남겨 그 안에서 굴린다 — 320×400·1280×800·320×568은 한도에 닿지 않아 그대로
    expect(sizes.map(([w, ht]) => place(w, ht))).toEqual([
      [true, 8],
      [true, 8],
      [false, 10],
      [true, 8],
      [true, 8],
      [false, 364],
      [false, 178],
    ]);
  });

  // 207차: 새 판 띠(app.ts — 서비스 워커가 받은 새 판 알림)도 3D 보기 안 위 8px에 붙는데 높이 한도가 없었다. left 50%에 폭이 없어 띠는 shrink-to-fit이고 쓸 폭은
  // 오른쪽을 0으로 둔 「3D 보기 − left」(CSS 2.1 10.3.7)라 3D 보기 절반까지 — 320px 3D 보기면 글 칸 134px에서 독일어가 글 6줄·버튼 두 줄로 143px 3D 보기를 넘어 버튼이 모두 잘렸다
  // (208차부터 1.4.10 창은 아래 폭 규칙이 이겨 반 폭이 아니다 — 207차 셈은 반 폭 띠도 높이 한도가 막는지 본다)
  const bar = top('.update-bar');
  const pad = /padding:\s*(\d+)px (\d+)px (\d+)px (\d+)px/.exec(bar);
  const [t, r, b, l] = [1, 2, 3, 4].map((i) => Number(pad?.[i]));
  const at = px('top', bar);
  const lh = px('font-size', bar) * Number(/font:\s*\d+px\/([\d.]+)/.exec(plain)?.[1]);
  /** 띠 높이: [글 줄, 버튼 줄] — 테두리 둘 + 위아래 여백 + 글 줄 × 줄 높이 + 버튼 줄마다 (사이 + 작은 버튼 높이) */
  const H = ([lines, rows]: [number, number]): number => 2 * px('border', bar) + t! + b! + lines * lh + rows * (px('gap', bar) + px('min-height', top('.mini-btn')));
  /** 창(마우스)마다 [한도에 닿는지, 띠 아래 남는 높이] */
  const place = (w: number, ht: number, h: number): [boolean, number] => {
    const cut = [...cascade('.update-bar', w, ht).matchAll(/max-height:\s*calc\(100% - (\d+)px\)/g)].pop()?.[1];
    const limit = cut === undefined ? Infinity : stage(w, ht) - Number(cut);
    return [h > limit, Math.round(stage(w, ht) - at - Math.min(h, limit))];
  };
  it('새 판 띠는 3D 보기 안 남은 높이까지만 두고 그 안에서 굴린다(47차 알림 꼴 — 위아래 8px), 넓은 창·높은 창은 한도에 닿지 않아 그대로', () => {
    // 손셈(글 칸 폭): 3D 보기 폭 × (1 − left) − 테두리 둘 − 왼오른 여백 — 좁은 화면(패널은 시트) 3D 보기 320px면 134, 1280 창(패널 330 열림 — 3D 보기 950)이면 449
    const left = Number(/left:\s*(\d+)%/.exec(bar)?.[1]) / 100;
    const inner = (sw: number): number => sw * (1 - left) - 2 * px('border', bar) - r! - l!;
    expect([inner(320), inner(950)]).toEqual([134, 449]);
    // 손셈(글 칸 134px의 [글 줄, 버튼 줄] — 라틴은 Helvetica 폭표 13px, 한중일은 한 글자 1em, 띄어쓰기·글자 사이에서 끊음, 버튼은 12px 글 + 여백 9 둘 + 테두리 둘):
    //   글 한 줄 폭 ko 437(한글 30·띄어쓰기 11)·en 483·zh-CN 299(23자)·de 646·ja 585(45자), 버튼 둘 + 사이 8은 ko 135.3·en 113.3·zh-CN 96·de 138.1·ja 132(134를 넘으면 두 줄).
    //   넓은 창(글 칸 449)은 다섯 언어 모두 글 두 줄 안(가장 긴 독일어 646)·버튼 한 줄
    const narrow: Record<string, [number, number]> = { ko: [4, 2], en: [5, 1], 'zh-CN': [3, 1], de: [6, 2], ja: [5, 1] };
    expect(Object.values(narrow).map((n) => Math.round(H(n) * 100) / 100)).toEqual([157.4, 144.25, 106.55, 195.1, 144.25]);
    // 한도가 없으면 320×256(3D 보기 143)에서 위 8 + 띠가 넘는 언어 — 독일어는 60px 넘어 버튼 두 줄이 모두 밖
    expect(Object.keys(narrow).filter((k) => at + H(narrow[k]) > stage(320, 256))).toEqual(['ko', 'en', 'de', 'ja']);
    expect(Math.round(stage(320, 256) - at - H(narrow.de))).toBe(-60);
    expect(/overflow-y:\s*auto/.test(bar)).toBe(true);
    // 320×256: 넘던 넷은 한도(127px)까지 줄고 아래 8px을 남겨 그 안에서 굴린다 — 중국어는 한도에 닿지 않아 그대로
    expect(Object.values(narrow).map((n) => place(320, 256, H(n)))).toEqual([[true, 8], [true, 8], [false, 28], [true, 8], [true, 8]]);
    // 창마다 가장 높은 띠(좁은 창 독일어, 넓은 창 글 두 줄·버튼 한 줄): 320×300도 굴리고, 320×400·넓은 창·320×568은 한도에 닿지 않아 그대로
    expect(sizes.map(([w, ht]) => place(w, ht, w === 320 ? H(narrow.de) : H([2, 1])))).toEqual([
      [true, 8],
      [true, 8],
      [false, 84],
      [false, 89],
      [false, 189],
      [false, 589],
      [false, 252],
    ]);
  });

  // 208차: 반 폭은 폭이 없는 shrink-to-fit 탓이라 띠 규칙의 max-width(3D 보기 − 24px — 알림 상자와 같은 값)가 어느 창에서도 닿지 않았다. 같은 꼴(left 50% + translateX)로
  // 가운데 두는 측정 띠·잠깐 알림은 width: max-content, 알림 상자는 폭을 준다. 1.4.10 창(200차 측정 띠 두 줄 블록 — 폭 360px 아래·낮고 좁은 창)만 max-content로 넓혀
  // 다섯 언어 모두 굴리지 않고 버튼까지 보이게 — 넓은 창·360~479px 휴대폰은 반 폭 그대로(넓히면 긴 언어가 오른쪽 위 뷰 큐브를 새로 덮어 상한을 정해야 함 — 설계 결정)
  it('1.4.10 창의 새 판 띠는 3D 보기 폭(− 24px)까지 넓어져 다섯 언어 모두 한도 안에 든다 — 넓은 창·360px 넘는 휴대폰은 반 폭 그대로', () => {
    expect(top('.measure-bar')).toMatch(/(?:^|[;\s])width:\s*max-content/);
    expect(bar).not.toMatch(/(?:^|[;\s])width:/);
    const grown = (w: number, ht: number): boolean => /(?:^|[;\s])width:\s*max-content/.test(fitting('.update-bar', w, ht));
    expect(sizes.map(([w, ht]) => grown(w, ht))).toEqual([true, true, true, false, false, false, true]);
    expect([grown(359, 800), grown(400, 300), grown(375, 667), grown(414, 896), grown(768, 1024)]).toEqual([true, true, false, false, false]);
    // 손셈(글 칸): 다섯 언어 모두 max-content(글 한 줄 + 사이 8 + 버튼 둘·사이 + 테두리·여백 26)가 296보다 넓어 띠 = 3D 보기 320 − 24 → 글 칸 270
    const cut = Number(/max-width:\s*calc\(100% - (\d+)px\)/.exec(bar)?.[1]);
    const side = 2 * px('border', bar) + r! + l!;
    const text = [437, 483.4, 299, 646, 585];
    const btns = [135.3, 113.3, 96, 138.1, 132];
    expect(text.map((x, i) => Math.round(x + px('gap', bar) + btns[i]! + side))).toEqual([606, 631, 429, 818, 751]);
    expect(320 - cut - side).toBe(270);
    // [글 줄, 버튼 줄] — 글 칸 270: ko 2(437)·en 2(483 — 10% 넓은 글꼴 532도 2)·zh-CN 2(23자, 20자 줄)·de 3(646 — 711도 3)·ja 3(45자 — 。、 앞에서 끊지 않아 19·20·6자), 버튼 둘은 270 안 한 줄
    expect(btns.every((x) => x <= 270)).toBe(true);
    const grownLines: [number, number][] = [[2, 1], [2, 1], [2, 1], [3, 1], [3, 1]];
    expect(grownLines.map((n) => Math.round(H(n) * 100) / 100)).toEqual([87.7, 87.7, 87.7, 106.55, 106.55]);
    // 320×256: 다섯 모두 한도(127px) 안이라 굴리지 않고 버튼까지 보인다(207차 반 폭이면 넷이 한도에서 굴렸다 — 위 [true, 8])
    expect(grownLines.map((n) => place(320, 256, H(n)))).toEqual([[false, 47], [false, 47], [false, 47], [false, 28], [false, 28]]);
    // 창마다 가장 높은 띠(1.4.10 창은 넓힌 독일어, 넓은 창은 반 폭의 글 두 줄·버튼 한 줄): 모두 한도에 닿지 않는다
    expect(sizes.map(([w, ht]) => place(w, ht, grown(w, ht) ? H([3, 1]) : H([2, 1])))).toEqual([
      [false, 28],
      [false, 72],
      [false, 172],
      [false, 89],
      [false, 189],
      [false, 589],
      [false, 340],
    ]);
  });
});

describe('단추 기본 type(47차 — 첫 화면 조각 줄이기)', () => {
  it('h(button)은 type을 주지 않으면 button(폼 안에서도 보내지 않음), 준 type은 그대로', () => {
    expect(h('button').type).toBe('button');
    expect(h('button', { type: 'submit' }).type).toBe('submit');
    const f = h('form', {}, h('button', { class: 'x' }));
    expect((f.querySelector('button') as HTMLButtonElement).type).toBe('button');
  });
});

describe('초점 테두리 둘레 대비(170차 — WCAG 2.4.7·1.4.11 3:1)', () => {
  /** 선택자 규칙의 outline-offset(px — 마지막 값), 없으면 NaN */
  const offsetOf = (sel: string): number => {
    const m = [...bodies(sel).matchAll(/outline-offset:\s*(-?\d+)px/g)].pop();
    return m ? Number(m[1]) : NaN;
  };
  // 바로 가기 안내(모달) 본문은 굴리려고 Tab으로 초점을 받는 영역(shortcuts.ts — 닫기 버튼과 둘뿐)이고 상자 폭을 꽉 채운다.
  // 테두리가 바깥(전역 :focus-visible — 1px 띄움)이면 띄운 1px이 상자 테두리, 테두리 2px은 상자 밖 어두운 바탕(.sc-backdrop을 앱 바탕에 섞은 색) 위다
  const ringBelow = (T: Record<string, string>): string[] => {
    const own = offsetOf('.sc-body:focus-visible');
    const off = Number.isNaN(own) ? offsetOf(':focus-visible') : own;
    const S = surfaces(T);
    const dim = rgba(/background:\s*([^;]+)/.exec(bodies('.sc-backdrop'))?.[1]);
    const ring = rgba(T['--accent']);
    const sides: [string, Rgba][] = [['상자 테두리', rgba(T['--border'])], off <= -2 ? ['본문 바탕', S.elev!] : ['상자 밖 어두운 바탕', over(dim, S.app!)]];
    return sides.filter(([, c]) => contrast(ring, c) < 3).map(([k, c]) => `${k} ${contrast(ring, c).toFixed(2)}`);
  };
  for (const [name, T] of THEMES) {
    it(`${name}: 바로 가기 안내 본문의 초점 테두리는 맞닿은 두 색과 모두 3:1(밝은 테마는 상자 밖이면 어두운 바탕 위 1.9:1)`, () => {
      expect(ringBelow(T)).toEqual([]);
    });
  }
  it('그 테두리는 메뉴 항목과 같은 꼴(강조색 2px, 안쪽 -2px)이고 상자 안쪽 둥근 모서리(10px − 테두리 1px)를 따른다', () => {
    const b = bodies('.sc-body:focus-visible');
    expect(b).toMatch(/outline:\s*2px solid var\(--accent\)/);
    expect(b).toMatch(/outline-offset:\s*-2px/);
    expect(b).toMatch(/border-radius:\s*0 0 9px 9px/);
    expect(bodies('.sc-box')).toMatch(/border:\s*1px solid var\(--border\)/);
    expect(bodies('.sc-box')).toMatch(/border-radius:\s*10px/);
  });
});

describe('제목 막대·도구 막대 버튼의 화면 읽기 이름(173차 — WCAG 3.2.4 일관된 식별·2.5.3 이름 안의 이름표)', () => {
  // 한 줄 tbtn('보이는 글', '아이콘', 'title', 할 일, 클래스?, true?) 부르기 — 이름은 끝 true면 보이는 글, 아니면 title(풀이)
  const calls = [...app.matchAll(/tbtn\('([^']*)', '[^']*', '([^']*)', (.*)$/gm)].map((m) => {
    const tail = /(?:, '([^']*)')?(?:, (true))?\)[\],;]*$/.exec(m[3]!);
    return { label: m[1]!, title: m[2]!, cls: tail?.[1] ?? '', named: tail?.[2] === 'true' };
  });
  // 글이 보이는 버튼(icon-only는 글이 늘 숨어 보이는 이름표가 없다 — 이름은 풀이 그대로)
  const shown = calls.filter((c) => !c.cls.split(' ').includes('icon-only'));

  it('글이 보이는 버튼은 화면 읽기 이름이 보이는 글을 그대로 품는다(풀이 글이 이름이면 「그림 저장」·「예제 열기」가 이름에 없었다)', () => {
    expect(shown.length).toBeGreaterThanOrEqual(13);
    expect(shown.filter((c) => !(c.named ? c.label : c.title).includes(c.label)).map((c) => c.label)).toEqual([]);
  });

  it('이름을 보이는 글로 둔 버튼은 같은 기능의 다른 자리(처음 화면 버튼·보기 설정 메뉴·그림 저장 창)와 같은 글이고 네 언어 사전에 그 열쇠가 있다', () => {
    expect(shown.filter((c) => c.named).map((c) => c.label)).toEqual(['예제 열기', '그림 저장']);
    const exporter = readFileSync(resolve(__dirname, '../../src/app/exporter.ts'), 'utf8');
    expect(app).toContain("html: `${icon('sample')}<span>예제 열기</span>`");
    expect(app).toContain("label: '그림 저장…'");
    expect(exporter).toContain("'aria-label': '그림 저장'");
    for (const lang of ['en', 'de', 'ja', 'zh-CN']) {
      const dict = JSON.parse(readFileSync(resolve(__dirname, `../../site/locales/${lang}.json`), 'utf8')) as Record<string, string>;
      for (const k of ['예제 열기', '그림 저장', '그림 저장…']) expect(dict[k], `${lang}: ${k}`).toBeTruthy();
    }
  });
});

describe('색만으로 전하지 않음(185차 — WCAG 1.4.1 색 사용: 밝기 차가 3:1 아래면 모양·글·굵기가 함께)', () => {
  const panel = readFileSync(resolve(__dirname, '../../src/app/panel.ts'), 'utf8');
  // 226차: 구성 탭 나무 줄(nodeRow — 빈 줄 클래스)은 탭 몸통 조각 infotab.ts로 옮겼다(흐림을 맞추는 refreshVisibility는 패널에 남음)
  const tabs = readFileSync(resolve(__dirname, '../../src/app/infotab.ts'), 'utf8');
  for (const [name, T] of THEMES) {
    it(`${name}: 숨긴 폴더·그룹 아래 줄·그릴 것이 없는 줄은 흐린 글 색이 보통 글과 3:1 아래라 이름을 기울인다 — 모형에서 숨긴 줄과 같은 꼴`, () => {
      // 흐린 줄은 제 보이기 체크가 켠 그대로이고 위 단계가 숨음(refreshVisibility), 빈 줄은 면·모서리 0(수 글은 「면 0」뿐 — 모서리만 있는 줄과 같음)
      expect(panel).toMatch(/el\.classList\.toggle\('dimmed', /);
      expect(tabs).toContain("t.faces[n] || t.edges[n] ? '' : ' empty'");
      expect(bodies('.prow.dimmed')).toMatch(/color:\s*var\(--text-dim\)/);
      expect(contrast(rgba(T['--text']), rgba(T['--text-dim']))).toBeLessThan(3);
      for (const s of ['.prow.model-hidden .name', '.prow.dimmed .name', '.prow.empty .name']) expect(bodies(s), s).toMatch(/font-style:\s*italic/);
    });
  }
  it('다른 켬·고름 표시는 색 말고 모양·굵기·밝기 차가 함께(고른 줄 왼쪽 막대, 탭 밑줄·굵기, 장면 카드 두꺼운 테두리, 뺀 장면 기울임, 잠근 각도기 굵기, 눌린 띠 버튼 테두리는 끈 테두리와 3:1)', () => {
    for (const s of ['.prow.sel', '.ptable tr.pick.sel']) expect(bodies(s), s).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--accent\)/);
    expect(bodies('.ptab.on')).toMatch(/border-bottom-color:\s*var\(--accent\)[\s\S]*font-weight:\s*600/);
    expect(bodies('.seg-btn.on')).toMatch(/font-weight:\s*600/);
    expect(bodies('button.scene-card.sel')).toMatch(/box-shadow:\s*0 0 0 1px var\(--accent\)/);
    expect(bodies('.scene-tab.no-play:not(.on)')).toMatch(/font-style:\s*italic/);
    expect(bodies('.measure-protractor.is-locked')).toMatch(/stroke-width:\s*2/);
    expect(bodies('.mb-btn')).toMatch(/border:\s*1px solid var\(--border-soft\)/);
    expect(bodies('.mb-btn.on')).toMatch(/border-color:\s*var\(--accent\)/);
    for (const [name, T] of THEMES) expect(contrast(rgba(T['--accent']), rgba(T['--border-soft'])), name).toBeGreaterThanOrEqual(3);
  });
});

describe('눌린 띠 버튼 글 대비(197차 — WCAG 1.4.3: 47차 짝 목록에 없던 측정·카메라 띠의 켬 상태)', () => {
  /** 규칙의 그 속성 값 — 첫 규칙(보통 화면, 고대비 @media 규칙은 파일 뒤) */
  const prop = (sel: string, p: string): string => new RegExp(`(?:^|[;\\s])${p}:\\s*([^;]+)`).exec(bodies(sel))?.[1]?.trim() ?? '';
  /** 토큰 하나, color-mix(in srgb, var(--가) P%, var(--나)), linear-gradient(var(--가) 0 0), var(--나)(나 위에 반투명 가를 겹침)를 그 테마 색으로 */
  const paint = (T: Record<string, string>, v: string): Rgba => {
    let m = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(v);
    if (m) {
      const [a, b, p] = [rgba(T[m[1]!]), rgba(T[m[3]!]), Number(m[2]) / 100];
      return [0, 1, 2].map((i) => a[i]! * p + b[i]! * (1 - p)).concat(1) as Rgba;
    }
    m = /^linear-gradient\(var\((--[\w-]+)\) 0 0\), var\((--[\w-]+)\)$/.exec(v);
    if (m) return over(rgba(T[m[1]!]), rgba(T[m[2]!]));
    return rgba(T[/^var\((--[\w-]+)\)$/.exec(v)?.[1] ?? '']);
  };
  for (const [name, T] of THEMES) {
    it(`${name}: 눌린 띠 버튼(걷기·2점 투시·중력·부딪힘·방향 잠금·안내 두기) 글은 제 바탕 위 4.5:1(밝은 테마 강조색 18% 바탕 위 강조색 글은 3.4:1)`, () => {
      // 걷기를 켜면 중력·부딪힘은 처음부터 눌린 채(app.ts press — class on), 카메라 띠는 넓은 화면에도 보인다
      const fg = paint(T, prop('.mb-btn.on', 'color'));
      const bg = paint(T, prop('.mb-btn.on', 'background'));
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      // 테두리는 그대로 강조색(끈 테두리와 3:1 — 185차), 띠 버튼 바탕은 입력 칸 바탕
      expect(prop('.mb-btn.on', 'border-color')).toBe('var(--accent)');
      expect(prop('.mb-btn', 'background')).toBe('var(--bg-input)');
    });
  }
});

describe('상태 막대 경고 칩 글 대비(198차 — WCAG 1.4.3: 경고 글 전용 토큰, 경고 아이콘·테두리는 경고색 그대로)', () => {
  const prop = (sel: string, p: string): string => new RegExp(`(?:^|[;\\s])${p}:\\s*([^;]+)`).exec(bodies(sel))?.[1]?.trim() ?? '';
  /** 색 값 또는 var(--이름) — 토큰이 다른 토큰을 가리키면 그 테마에서 따라간다 */
  const tok = (T: Record<string, string>, v: string): Rgba => {
    const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
    return m ? tok(T, T[m[1]!] ?? '') : rgba(v);
  };
  for (const [name, T] of THEMES) {
    it(`${name}: 「경고 N」 칩(11.5px 굵게) 글은 경고 바탕 위 4.5:1(밝은 테마 경고색 글은 3.38:1), 알림의 경고 아이콘·테두리는 경고색으로 3:1`, () => {
      expect(prop('.st-warn', 'background')).toBe('var(--warn-bg)');
      const bg = tok(T, prop('.st-warn', 'background'));
      expect(contrast(tok(T, prop('.st-warn', 'color')), bg)).toBeGreaterThanOrEqual(4.5);
      // 글 아닌 표시(1.4.11)는 --warn 그대로: 아이콘은 경고 바탕 위, 테두리는 3D 보기 배경 위
      expect(bodies('.notice.warn .notice-icon')).toMatch(/color:\s*var\(--warn\)/);
      expect(bodies('.notice.warn')).toMatch(/border-color:\s*var\(--warn\)/);
      expect(contrast(rgba(T['--warn']), bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(rgba(T['--warn']), rgba(T['--stage-bg']))).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('끌어 놓기 카드 글 대비(199·204차 — WCAG 1.4.3: 덮개 토큰, 199차 밝은 테마·204차 어두운 테마도 짙게)', () => {
  const prop = (sel: string, p: string): string => new RegExp(`(?:^|[;\\s])${p}:\\s*([^;]+)`).exec(bodies(sel))?.[1]?.trim() ?? '';
  /** 색 값(#fff 꼴 세 자리 포함) 또는 var(--이름) — 그 테마 색으로 */
  const tok = (T: Record<string, string>, v: string): Rgba => {
    const t = v.trim();
    const m = /^var\((--[\w-]+)\)$/.exec(t);
    if (m) return tok(T, T[m[1]!] ?? '');
    return rgba(t.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, '#$1$1$2$2$3$3'));
  };
  for (const [name, T] of THEMES) {
    it(`${name}: 「놓으면 엽니다」 카드 흰 글(16px)은 덮개를 섞은 처음 화면 흰 칸·3D 보기·앱 바탕·3D 보기 흰 모형 면 위 4.5:1(덮개 55%는 흰 칸·흰 면 위 4.35:1)`, () => {
      // 카드는 바탕이 없어 반투명 덮개가 곧 글 바탕 — 그 밑은 처음 화면 끌어 놓기 칸·3D 보기·처음 화면 바탕(카드는 창 가운데)
      const veil = tok(T, prop('.dropcover', 'background'));
      const fg = tok(T, prop('.dropcover-card', 'color'));
      const bases: [string, string][] = [
        ['처음 화면 흰 칸', prop('.dropzone', 'background')],
        ['3D 보기', prop('.stage', 'background')],
        ['앱 바탕', prop('.start', 'background')],
      ];
      expect(bases.map(([, v]) => v)).toEqual(['var(--bg-elev)', 'var(--stage-bg)', 'var(--bg)']);
      // 204차: 3D 보기에서는 모형의 흰 면(가장 밝은 바탕)도 카드 밑에 온다 — 어두운 테마 덮개 55%는 그 위 4.35:1
      bases.push(['3D 보기 흰 모형 면', '#fff']);
      const low =bases.map(([k, v]) => [k, contrast(fg, over(veil, tok(T, v)))] as const).filter(([, c]) => c < 4.5);
      expect(low.map(([k, c]) => `${k} ${c.toFixed(2)}`)).toEqual([]);
    });
  }
  it('덮개는 테마 토큰 — 두 테마 모두 같은 검정에서 불투명도를 흰 바탕 위 4.5:1을 처음 넘는 0.01 걸음으로(199차 밝은·204차 어두운, 0.56은 흰 바탕 위 4.4975:1)', () => {
    expect(prop('.dropcover', 'background')).toBe('var(--drop-veil)');
    const white: Rgba = [255, 255, 255, 1];
    for (const [name, T] of THEMES) {
      const veil = tok(T, 'var(--drop-veil)');
      expect(veil.slice(0, 3), name).toEqual([8, 12, 18]);
      // 흰 바탕 위에서 4.5:1이면 덮개 밑이 어떤 색이어도 카드 흰 글이 4.5:1, 한 걸음 옅으면 미달(가장 작은 값)
      expect(contrast(white, over(veil, white)), name).toBeGreaterThanOrEqual(4.5);
      const lighter: Rgba = [8, 12, 18, Math.round(veil[3] * 100 - 1) / 100];
      expect(contrast(white, over(lighter, white)), name).toBeLessThan(4.5);
    }
    expect([tok(DARK, 'var(--drop-veil)')[3], tok(LIGHT, 'var(--drop-veil)')[3]]).toEqual([0.57, 0.57]);
    expect(prop('.dropcover-card', 'color')).toBe('#fff');
  });
});
