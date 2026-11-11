import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, contrastRatio, cssRgba, fitContrast, parseColor } from 'opencad-viewer3d/theme';
import { FILE_BACKGROUND_KEY, cssHex, isLightBackground, loadFileBackground, luminance, skyBackground, storeFileBackground, styleBackground, viewerTheme } from '../../src/app/backdrop';
import { pagePlan } from '../../src/app/pages';
import { createDoc } from '../../src/app/doc';
import { skpToScene } from '../../src/index';
import { mfcFile, squareEntities } from '../mfcwrite';

describe('파일·장면 배경', () => {
  it('스타일 배경 색 → 코어 테마(배경 밝기에 맞는 격자·큐브 색)', () => {
    expect(styleBackground({ background: [0.8, 0.8, 0.79] })).toEqual([0.8, 0.8, 0.79]);
    expect(styleBackground({ background: [2, -1, 0.5] })).toEqual([1, 0, 0.5]);
    expect(styleBackground({})).toBeNull();
    expect(styleBackground(null)).toBeNull();
    expect(styleBackground({ background: ['x', 1, 1] as never })).toBeNull();
    expect(cssHex([1, 1, 1])).toBe('#ffffff');
    expect(cssHex([0.8, 0.8, 0.79])).toBe('#ccccc9');
    expect(luminance([1, 1, 1])).toBeCloseTo(1);
    expect(isLightBackground([1, 1, 1])).toBe(true);
    expect(isLightBackground([0.13, 0.16, 0.19])).toBe(false);
    // 어두운 앱 테마여도 흰 배경 파일은 밝은 쪽 색으로 격자를 그린다(66차 — 파일 배경이면 좌표축 대비도 켠다)
    expect(viewerTheme('dark', [1, 1, 1])).toEqual({ base: 'light', background: '#ffffff', axisContrast: true });
    expect(viewerTheme('light', [0, 0, 0])).toEqual({ base: 'dark', background: '#000000', axisContrast: true });
    // 앱 테마 바탕(파일 배경을 끔)은 테마 이름 그대로 — 축 색을 고치지 않는다
    expect(viewerTheme('dark', null)).toBe('dark');
    expect(viewerTheme('light', null)).toBe('light');
  });

  it('66차 좌표축 대비: 파일 배경과 3:1이 안 되는 축만 코어가 고치고, 이미 닿는 바탕(흰색)은 받은 색 그대로', () => {
    // 표본에 있는 배경(0~255): 회색 204·191 계열, 노란 회색, 어두운 70 — 고치기 전에는 축 하나 이상이 3:1 아래
    const low: [number, number, number][] = [
      [204, 204, 201],
      [191, 191, 198],
      [210, 208, 185],
      [218, 216, 212],
      [196, 207, 210],
      [70, 70, 70],
    ];
    const axes = ['axisX', 'axisY', 'axisZ'] as const;
    const fitted = (rgb255: [number, number, number]) => {
      const t = viewerTheme('dark', rgb255.map((v) => v / 255) as [number, number, number]);
      if (typeof t !== 'object' || !t.axisContrast) throw new Error('파일 배경 테마가 아니다');
      const base = t.base === 'light' ? LIGHT_THEME : DARK_THEME;
      const bg = parseColor(t.background!)!;
      return axes.map((a) => {
        const was = parseColor(base[a])!;
        const fit = fitContrast(was, bg);
        return { was, fit, before: contrastRatio(was, bg), after: contrastRatio(fit, bg) };
      });
    };
    for (const c of low) {
      const r = fitted(c);
      expect(Math.min(...r.map((x) => x.before)), c.join()).toBeLessThan(3);
      for (const x of r) {
        expect(x.after, c.join()).toBeGreaterThanOrEqual(3);
        // 이미 닿은 축은 받은 값 그대로(같은 그림)
        if (x.before >= 3) expect(x.fit).toBe(x.was);
      }
    }
    // 회색 204(가장 많은 회색 배경): X·Y만 불투명도를 올리고 Z는 그대로
    const g204 = fitted([204, 204, 201]);
    expect(g204.map((x) => x.before.toFixed(2))).toEqual(['2.54', '2.88', '3.01']);
    expect(g204.map((x) => (x.fit === x.was ? null : cssRgba(x.fit)))).toEqual(['rgba(205,50,50,0.9373)', 'rgba(25,120,25,0.8902)', null]);
    // 흰 바탕(표본 대부분)과 거의 흰 바탕은 셋 모두 이미 3:1 이상 — 코어가 테마 글을 그대로 둔다
    for (const c of [
      [255, 255, 255],
      [254, 254, 255],
      [255, 255, 251],
    ] as [number, number, number][])
      for (const x of fitted(c)) {
        expect(x.before).toBeGreaterThanOrEqual(3);
        expect(x.fit).toBe(x.was);
      }
  });

  it('사용자 설정: 기본 켬, 끄면 기억하고 못 쓰는 저장소는 무시한다', () => {
    const map = new Map<string, string>();
    const st = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(loadFileBackground(st)).toBe(true);
    storeFileBackground(st, false);
    expect(map.get(FILE_BACKGROUND_KEY)).toBe('0');
    expect(loadFileBackground(st)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadFileBackground(broken)).toBe(true);
    expect(() => storeFileBackground(broken, true)).not.toThrow();
    expect(loadFileBackground(null)).toBe(true);
  });

  it('옛 판 모형 스타일·장면 스타일의 배경 색을 읽어 문서·장면 계획에 둔다', () => {
    const bytes = mfcFile({
      schemas: 'v20',
      rendering: { background: [30, 60, 90] },
      root: squareEntities(),
      pages: [{ name: '앞', flags: 0x3, camera: { eye: [0, -50, 10], target: [0, 0, 0], up: [0, 0, 1] }, rendering: { background: [200, 220, 240] } }],
    });
    const d = createDoc('배경.skp', 1, { scene: skpToScene(bytes, { outline: true }), ms: 1 });
    expect(styleBackground(d.style)!.map((x) => Math.round(x * 255))).toEqual([30, 60, 90]);
    const plan = pagePlan(d.pages[0]!);
    expect(styleBackground(plan.style)!.map((x) => Math.round(x * 255))).toEqual([200, 220, 240]);
  });
});

describe('하늘·지면 바탕', () => {
  it('켜진 하늘·지면만 코어 바탕으로(하늘은 지평선 쪽이 밝고, 땅은 지평선 쪽이 하늘에 조금 섞인다)', () => {
    expect(skyBackground(null)).toBeNull();
    expect(skyBackground({ sky: null, ground: null })).toBeNull();
    expect(skyBackground({})).toBeNull();
    const both = skyBackground({ sky: [0.4, 0.6, 1], ground: [0.2, 0.5, 0.2] })!;
    expect(both.sky).toEqual([0.4, 0.6, 1, 1]);
    const h = both.skyHorizon as readonly number[];
    expect(h[0]).toBeCloseTo(0.4 + 0.6 * 0.55, 9);
    expect(h[2]).toBe(1);
    expect(both.ground).toEqual([0.2, 0.5, 0.2, 1]);
    expect((both.groundHorizon as readonly number[])[0]).toBeCloseTo(0.2 + (h[0]! - 0.2) * 0.3, 9);
    // 하늘만: 지평선 아래는 배경 그대로(땅을 주지 않는다)
    const skyOnly = skyBackground({ sky: [0.4, 0.6, 1], ground: null })!;
    expect(skyOnly.ground).toBeUndefined();
    const groundOnly = skyBackground({ ground: [0.2, 0.5, 0.2] })!;
    expect(groundOnly.sky).toBeUndefined();
    expect(groundOnly.groundHorizon).toEqual([0.2, 0.5, 0.2, 1]);
  });
});
