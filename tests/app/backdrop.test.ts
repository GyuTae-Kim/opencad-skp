import { describe, expect, it } from 'vitest';
import { FILE_BACKGROUND_KEY, cssHex, isLightBackground, loadFileBackground, luminance, storeFileBackground, styleBackground, viewerTheme } from '../../src/app/backdrop';
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
    // 어두운 앱 테마여도 흰 배경 파일은 밝은 쪽 색으로 격자를 그린다
    expect(viewerTheme('dark', [1, 1, 1])).toEqual({ base: 'light', background: '#ffffff' });
    expect(viewerTheme('light', [0, 0, 0])).toEqual({ base: 'dark', background: '#000000' });
    expect(viewerTheme('dark', null)).toBe('dark');
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
