import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, type RenderMode, type Rgba } from 'opencad-viewer3d';
import {
  BACKGROUND_LINE_MODES,
  LineContrast,
  MIN_LINE_CONTRAST,
  DEFAULT_EDGE_COLOR,
  billboardEdgeColor,
  edgeLooks,
  isModelEdgeSet,
  THEME_LINE,
  contrastRatio,
  lineBackdrops,
  lineColorOverrides,
  minContrast,
  readableLineColor,
  viewBackground,
  viewBase,
  type LineView,
} from '../../src/app/linecontrast';
import { skyBackground } from '../../src/app/backdrop';
import { createDoc } from '../../src/app/doc';
import { sampleSkpBytes } from '../../src/app/sample';
import { skpToScene } from '../../src/index';
import { ANNOTATION_COLOR, EDGE_COLOR, GUIDE_COLOR, HIDDEN_EDGE_COLOR, SECTION_COLOR, SOFT_EDGE_COLOR } from '../../src/scene';

const ALL_MODES: RenderMode[] = ['shaded', 'shadedEdges', 'wireframe', 'xray', 'hiddenLine', 'monochrome', 'noTexture'];
const view = (mode: RenderMode, theme: 'light' | 'dark', backdrop: LineView['backdrop'] = null, sky: LineView['sky'] = null): LineView => ({ mode, theme, backdrop, sky });

/** 장면이 쓰는 기본 선·점 색(단면 평면 표시는 따로) */
const SCENE_LINES = [
  { id: 'skp-edges-0', color: EDGE_COLOR },
  { id: 'skp-reveal-edges-1', color: EDGE_COLOR },
  { id: 'skp-soft-2', color: SOFT_EDGE_COLOR },
  { id: 'skp-hidden-edges-3', color: HIDDEN_EDGE_COLOR },
  { id: 'skp-dims-4', color: ANNOTATION_COLOR },
  { id: 'skp-guides-5', color: GUIDE_COLOR },
  { id: 'skp-section-6', color: SECTION_COLOR },
  { id: 'theme-colored' },
];
const skipSection = (id: string): boolean => id === 'skp-section-6';

describe('선 색 대비(WCAG)', () => {
  it('대비 비율: 검정·흰색 21:1, 같은 색 1:1, 순서 상관없음', () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastRatio([0.3, 0.4, 0.5], [0.3, 0.4, 0.5])).toBeCloseTo(1, 9);
    expect(contrastRatio([0.2, 0.2, 0.2, 1] as Rgba, [0.9, 0.9, 0.9])).toBeCloseTo(contrastRatio([0.9, 0.9, 0.9], [0.2, 0.2, 0.2]), 9);
    expect(MIN_LINE_CONTRAST).toBe(3);
  });

  it('코어 테마 선 색(숨은 모서리 점선·외곽선)은 두 테마 바탕에서 모두 읽힌다', () => {
    expect(viewBackground('dark', null)).toEqual([0x21 / 255, 0x28 / 255, 0x30 / 255]);
    expect(viewBackground('light', null)).toEqual([0xf4 / 255, 0xf5 / 255, 0xf7 / 255]);
    expect(DARK_THEME.background).toBe('#212830');
    expect(LIGHT_THEME.background).toBe('#f4f5f7');
    expect(contrastRatio(THEME_LINE.dark, viewBackground('dark', null))).toBeGreaterThan(10);
    expect(contrastRatio(THEME_LINE.light, viewBackground('light', null))).toBeGreaterThan(10);
    // 파일 배경: 코어가 배경 밝기 쪽(base) 선 색을 쓰므로 흰·검은 배경에서도 읽힌다
    expect(contrastRatio(THEME_LINE[viewBase('dark', [1, 1, 1])], [1, 1, 1])).toBeGreaterThan(10);
    expect(contrastRatio(THEME_LINE[viewBase('light', [0, 0, 0])], [0, 0, 0])).toBeGreaterThan(10);
  });

  it('어두운 테마 바탕에서 검은 모서리는 1:1에 가깝고, 밝은 테마에서는 15:1', () => {
    expect(contrastRatio(EDGE_COLOR, viewBackground('dark', null))).toBeLessThan(1.2);
    expect(contrastRatio(EDGE_COLOR, viewBackground('light', null))).toBeGreaterThan(14);
  });
});

describe('선 뒤 색(그리기 방식별)', () => {
  it('음영·음영+모서리·무늬 없음·단색은 면 위라 파일 색 그대로(null)', () => {
    for (const m of ['shaded', 'shadedEdges', 'noTexture', 'monochrome'] as RenderMode[]) {
      expect(BACKGROUND_LINE_MODES.has(m)).toBe(false);
      expect(lineBackdrops(view(m, 'dark'))).toBeNull();
      expect(lineBackdrops(view(m, 'light'))).toBeNull();
    }
  });

  it('와이어프레임·숨은 선(면 = 바탕 색)·X-ray는 바탕 색', () => {
    for (const m of ['wireframe', 'hiddenLine', 'xray'] as RenderMode[]) {
      expect(lineBackdrops(view(m, 'dark'))).toEqual([viewBackground('dark', null)]);
      expect(lineBackdrops(view(m, 'light', [1, 1, 1]))).toEqual([[1, 1, 1]]);
    }
  });

  it('파일 하늘·지면: 지평선 위는 하늘, 아래는 지면 색(숨은 선은 면 = 바탕 색도)', () => {
    const sky = skyBackground({ sky: [0.4, 0.6, 0.9], ground: [0.3, 0.25, 0.2] })!;
    const wire = lineBackdrops(view('wireframe', 'light', [1, 1, 1], sky))!;
    expect(wire).toHaveLength(4);
    expect(wire[0]).toEqual([0.4, 0.6, 0.9]);
    expect(wire).not.toContainEqual([1, 1, 1]);
    expect(lineBackdrops(view('hiddenLine', 'light', [1, 1, 1], sky))).toContainEqual([1, 1, 1]);
    // 하늘만 켜면 지평선 아래는 바탕 색
    const skyOnly = lineBackdrops(view('wireframe', 'light', [1, 1, 1], skyBackground({ sky: [0.4, 0.6, 0.9], ground: null })))!;
    expect(skyOnly).toContainEqual([1, 1, 1]);
    expect(skyOnly).toHaveLength(3);
  });
});

describe('읽히는 선 색 고르기', () => {
  it('대비가 충분하면 null(파일 색 그대로), 모자라면 테마 선 색(불투명도는 그대로)', () => {
    const dark = [viewBackground('dark', null)];
    expect(readableLineColor(EDGE_COLOR, [viewBackground('light', null)], 'light')).toBeNull();
    expect(readableLineColor(EDGE_COLOR, dark, 'dark')).toEqual(THEME_LINE.dark);
    expect(readableLineColor([0.1, 0.1, 0.1, 0.5], dark, 'dark')).toEqual([...THEME_LINE.dark.slice(0, 3), 0.5]);
    expect(readableLineColor(EDGE_COLOR, [], 'dark')).toBeNull();
  });

  it('바탕 쪽 선 색도 모자라면(회색 바탕) 두 선 색 가운데 대비가 큰 쪽, 둘 다 파일 색보다 못하면 그대로', () => {
    // 밝기 0.19쯤 회색: 바탕 쪽(밝음 → 어두운 선)은 3:1이 안 되고 밝은 선이 낫다
    const grey: [number, number, number] = [0.47, 0.47, 0.47];
    expect(viewBase('dark', grey)).toBe('light');
    expect(minContrast(THEME_LINE.light, [grey])).toBeLessThan(3);
    // 검은 모서리는 이 회색 위에서도 3.7:1이라 그대로, 중간 회색 선은 묻힌다
    expect(readableLineColor(EDGE_COLOR, [grey], 'light')).toBeNull();
    const pick = readableLineColor([0.4, 0.4, 0.4, 1], [grey], 'light')!;
    expect(pick).toEqual(THEME_LINE.dark);
    expect(contrastRatio(pick, grey)).toBeGreaterThan(contrastRatio(THEME_LINE.light, grey));
    // 흑백 하늘·지면처럼 어느 색도 3:1이 안 되면 가장 나은 색, 파일 색이 이미 가장 나으면 null
    const both: [number, number, number][] = [[0, 0, 0], [1, 1, 1]];
    expect(minContrast([0.75, 0.75, 0.75], both)).toBeLessThan(3);
    expect(readableLineColor([0.75, 0.75, 0.75, 1], both, 'light')).toBeNull();
    expect(readableLineColor([0.9, 0.9, 0.9, 1], both, 'light')).toEqual(THEME_LINE.light);
  });

  it('밝은 테마: 모든 그리기 방식에서 기본 선 색을 바꾸지 않는다(SketchUp 모습)', () => {
    for (const m of ALL_MODES) expect(lineColorOverrides(SCENE_LINES, view(m, 'light'), skipSection).size).toBe(0);
  });

  it('어두운 테마: 와이어프레임·숨은 선·X-ray에서 검은 모서리·주석·안내선만 밝은 선 색으로', () => {
    for (const m of ALL_MODES) {
      const o = lineColorOverrides(SCENE_LINES, view(m, 'dark'), skipSection);
      if (!BACKGROUND_LINE_MODES.has(m)) {
        expect(o.size).toBe(0);
        continue;
      }
      expect([...o.keys()].sort()).toEqual(['skp-dims-4', 'skp-edges-0', 'skp-guides-5', 'skp-reveal-edges-1']);
      for (const c of o.values()) expect(c).toEqual(THEME_LINE.dark);
      // 회색 부드러운·숨긴 모서리는 어두운 바탕에서도 3:1 이상이라 그대로
      expect(o.has('skp-soft-2')).toBe(false);
      expect(o.has('skp-hidden-edges-3')).toBe(false);
    }
    // 단면 평면 표시는 skip이 빼고, 색이 없는 묶음은 코어가 이미 테마 선 색으로 그린다
    const noSkip = lineColorOverrides(SCENE_LINES, view('wireframe', 'dark'));
    expect(noSkip.has('theme-colored')).toBe(false);
    expect(noSkip.has('skp-section-6')).toBe(false);
  });

  it('파일 배경: 흰 배경 파일은 어두운 테마에서도 검은 모서리(SketchUp처럼), 검은 배경 파일은 밝은 선', () => {
    for (const m of ['wireframe', 'hiddenLine', 'xray'] as RenderMode[]) {
      expect(lineColorOverrides(SCENE_LINES, view(m, 'dark', [1, 1, 1]), skipSection).size).toBe(0);
      const black = lineColorOverrides(SCENE_LINES, view(m, 'light', [0, 0, 0]), skipSection);
      expect(black.get('skp-edges-0')).toEqual(THEME_LINE.dark);
    }
    // 흰 배경 + 어두운 지면: 지평선 아래 지면에 묻히므로 바꾼다
    const sky = skyBackground({ sky: [0.75, 0.85, 0.95], ground: [0.08, 0.08, 0.1] });
    const o = lineColorOverrides(SCENE_LINES, view('wireframe', 'dark', [1, 1, 1], sky), skipSection);
    expect(o.has('skp-edges-0')).toBe(true);
  });
});

describe('바뀐 것만 코어에 건다', () => {
  it('처음에 걸고, 같으면 건너뛰고, 빠지면 되돌리고, reset 뒤에는 다시 건다', () => {
    const calls: [string, Rgba | null][] = [];
    const target = { setItemColor: (id: string, c: Rgba | null): void => void calls.push([id, c]) };
    const lc = new LineContrast();
    const want = new Map<string, Rgba>([
      ['a', THEME_LINE.dark],
      ['b', THEME_LINE.dark],
    ]);
    expect(lc.apply(target, want)).toBe(2);
    expect(lc.size).toBe(2);
    expect(lc.apply(target, want)).toBe(0);
    expect(lc.apply(target, new Map([['a', THEME_LINE.light]]))).toBe(2);
    expect(calls.slice(2)).toEqual([
      ['b', null],
      ['a', THEME_LINE.light],
    ]);
    expect(lc.apply(target, new Map())).toBe(1);
    expect(lc.size).toBe(0);
    lc.apply(target, want);
    // 장면을 새로 올리면 코어가 겉모습을 풀었으므로 기억도 지우고 다시 건다
    lc.reset();
    expect(lc.apply(target, want)).toBe(2);
  });

  it('예제 집: 어두운 테마 숨은 선에서 모든 모형 모서리와 치수선을 바꾸고 단면 표시는 그대로, 밝은 테마로 돌아가면 모두 되돌린다', () => {
    const d = createDoc('예제.skp', 1, { scene: skpToScene(sampleSkpBytes(), { name: '예제', outline: true }), ms: 1 });
    const items = [...d.scene.lines, ...(d.scene.points ?? [])];
    const skip = (id: string): boolean => d.annotationKind.get(id) === 'sectionPlanes';
    const dark = lineColorOverrides(items, view('hiddenLine', 'dark'), skip);
    const edges = d.scene.lines.filter((l) => /^skp-edges-/.test(l.id));
    expect(edges.length).toBeGreaterThan(0);
    for (const l of edges) expect(dark.get(l.id)).toEqual(THEME_LINE.dark);
    const dims = [...d.annotationKind].filter(([, k]) => k === 'dimensions').map(([id]) => id);
    expect(dims.length).toBeGreaterThan(0);
    for (const id of dims) expect(dark.has(id)).toBe(true);
    const sections = [...d.annotationKind].filter(([, k]) => k === 'sectionPlanes').map(([id]) => id);
    for (const id of sections) expect(dark.has(id)).toBe(false);
    // 같은 순서로 앱이 하는 일: 어두운 테마 → 밝은 테마(시스템 테마가 바뀜) → 음영+모서리
    const calls: [string, Rgba | null][] = [];
    const target = { setItemColor: (id: string, c: Rgba | null): void => void calls.push([id, c]) };
    const lc = new LineContrast();
    lc.apply(target, dark);
    expect(calls.length).toBe(dark.size);
    calls.length = 0;
    lc.apply(target, lineColorOverrides(items, view('hiddenLine', 'light'), skip));
    expect(calls.length).toBe(dark.size);
    expect(calls.every(([, c]) => c === null)).toBe(true);
    expect(lineColorOverrides(items, view('shadedEdges', 'dark'), skip).size).toBe(0);
  });
});

describe('스타일 모서리 색(장면 스타일)', () => {
  const grey: [number, number, number] = [0.36, 0.36, 0.36];
  const red: [number, number, number] = [1, 0, 0];

  it('모형 모서리 묶음만 스타일 모서리 색을 받는다(부드러운·숨긴 모서리·주석·안내선은 아니다)', () => {
    expect(isModelEdgeSet('skp-edges-0')).toBe(true);
    expect(isModelEdgeSet('skp-reveal-edges-1')).toBe(true);
    for (const id of ['skp-soft-2', 'skp-hidden-edges-3', 'skp-dims-4', 'skp-guides-5']) expect(isModelEdgeSet(id)).toBe(false);
    const want = lineColorOverrides(SCENE_LINES, view('shadedEdges', 'light'), skipSection, red);
    expect([...want.keys()].sort()).toEqual(['skp-edges-0', 'skp-reveal-edges-1']);
    expect(want.get('skp-edges-0')).toEqual([1, 0, 0, 1]);
  });

  it('장면에 적힌 색과 같은 스타일 색이면 덮어쓰지 않는다(모형 스타일 그대로)', () => {
    const lines = [{ id: 'skp-edges-0', color: [grey[0], grey[1], grey[2], 1] as Rgba }];
    expect(lineColorOverrides(lines, view('shaded', 'light'), undefined, grey).size).toBe(0);
    expect(lineColorOverrides(lines, view('shaded', 'dark'), undefined, null).size).toBe(0);
  });

  it('배경이 선 뒤인 방식에서는 스타일 색에 대비 규칙을 건다: 어두운 테마의 빨강은 그대로, 회색은 밝은 선', () => {
    const dark = view('wireframe', 'dark');
    const redWant = lineColorOverrides(SCENE_LINES, dark, skipSection, red);
    // 빨강(휘도 0.21)은 남색 바탕과 3:1을 넘지 못하면 밝은 선, 넘으면 빨강 — 어느 쪽이든 3:1 이상
    for (const id of ['skp-edges-0', 'skp-reveal-edges-1']) expect(minContrast(redWant.get(id)!, lineBackdrops(dark)!)).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST);
    const greyWant = lineColorOverrides(SCENE_LINES, dark, skipSection, grey);
    expect(greyWant.get('skp-edges-0')).toEqual(THEME_LINE.dark);
    // 밝은 테마의 회색 모서리는 그대로 회색(대비 충분)
    expect(lineColorOverrides(SCENE_LINES, view('wireframe', 'light'), skipSection, grey).get('skp-edges-0')).toEqual([...grey, 1]);
  });

  it('카메라를 보는 컴포넌트 윤곽선 색: 스타일 모서리 색, 배경이 선 뒤인 방식에서는 대비 규칙', () => {
    expect(billboardEdgeColor(view('shadedEdges', 'dark'), grey, EDGE_COLOR)).toEqual([...grey, 1]);
    expect(billboardEdgeColor(view('shadedEdges', 'light'), null, EDGE_COLOR)).toEqual(EDGE_COLOR);
    expect(billboardEdgeColor(view('xray', 'dark'), null, EDGE_COLOR)).toEqual(THEME_LINE.dark);
    expect(billboardEdgeColor(view('wireframe', 'light'), [0, 0, 0], EDGE_COLOR)).toEqual([0, 0, 0, 1]);
  });
});

describe('코어 0.8.0 선 색 선택(edgeLooks)', () => {
  it('화면 쪽 기본 모서리 색은 해석기의 EDGE_COLOR와 같다', () => {
    expect(DEFAULT_EDGE_COLOR).toEqual(EDGE_COLOR);
  });

  it('그물 윤곽선·뒤 모서리 색 = 지금 방식에서 모형 모서리가 띠는 색, 외곽선 = 바탕과 읽히는 모서리 색', () => {
    const grey: [number, number, number] = [0.36, 0.36, 0.36];
    // 밝은 테마 음영: 스타일 색 그대로
    expect(edgeLooks(view('shaded', 'light'), grey, EDGE_COLOR)).toEqual({ edge: [...grey, 1], profile: [...grey, 1] });
    // 어두운 테마 음영: 모서리는 면 위라 그대로, 외곽선은 남색 바탕 앞이라 밝은 선
    const darkShaded = edgeLooks(view('shaded', 'dark'), null, EDGE_COLOR);
    expect(darkShaded.edge).toEqual(EDGE_COLOR);
    expect(darkShaded.profile).toEqual(THEME_LINE.dark);
    // 어두운 테마 와이어프레임·X-ray: 카메라를 보는 컴포넌트 윤곽선도 밝은 선(재질 색에 묻히지 않게)
    for (const m of ['wireframe', 'xray', 'hiddenLine'] as const) {
      const l = edgeLooks(view(m, 'dark'), [0, 0, 0], EDGE_COLOR);
      expect(minContrast(l.edge, lineBackdrops(view(m, 'dark'))!)).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST);
    }
    // 흰 배경 파일은 어두운 테마에서도 검은 외곽선(SketchUp처럼)
    expect(edgeLooks(view('shaded', 'dark', [1, 1, 1]), [0, 0, 0], EDGE_COLOR).profile).toEqual([0, 0, 0, 1]);
  });
});
