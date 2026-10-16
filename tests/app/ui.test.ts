import { describe, expect, it } from 'vitest';
import { computeFrame, defaultCamera, projectToScreen, type CameraState } from 'opencad-viewer3d/camera';
import { keyAction } from '../../src/app/keys';
import {
  LAYOUT_KEY,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  SHEET_DEFAULT,
  clampPanelWidth,
  clampSheetFraction,
  readLayout,
  storeLayout,
} from '../../src/app/layout';
import { THEME_CHOICES, applyThemeChoice, themeChoiceOf } from '../../src/app/theme';
import { cameraForBox, keepViewOnHeightChange } from '../../src/app/view';

describe('Esc 차례·열기 키', () => {
  const base = { hasDoc: true };
  it('측정 중: 점이 있으면 뷰어가 지우고, 없으면(두 번째 Esc) 측정을 끈다', () => {
    expect(keyAction({ ...base, key: 'Escape', measureMode: true, measurePoints: 2 })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: 'Escape', measureMode: true, measurePoints: 0 })).toEqual({ kind: 'measureOff' });
    expect(keyAction({ ...base, key: 'Escape', measureMode: false, measurePoints: 0 })).toEqual({ kind: 'clearSelection' });
  });

  it('여는 중이면 Esc로 취소, Ctrl/⌘+O는 문서가 없어도 열기', () => {
    expect(keyAction({ key: 'Escape', busy: true })).toEqual({ kind: 'cancelOpen' });
    expect(keyAction({ key: 'o', ctrl: true })).toEqual({ kind: 'open' });
    expect(keyAction({ key: 'O', meta: true })).toEqual({ kind: 'open' });
    expect(keyAction({ key: 'o', ctrl: true, alt: true })).toBeNull();
    expect(keyAction({ key: 'o', ctrl: true, editable: true })).toBeNull();
    expect(keyAction({ key: 'o' })).toBeNull();
  });
});

describe('테마 고르기', () => {
  it('시스템 설정 따르기로 되돌리면 기억을 지운다', () => {
    expect(THEME_CHOICES.map((c) => c.choice)).toEqual(['system', 'light', 'dark']);
    expect(themeChoiceOf(null)).toBe('system');
    expect(themeChoiceOf('dark')).toBe('dark');
    expect(applyThemeChoice('system', true)).toEqual({ stored: null, theme: 'dark' });
    expect(applyThemeChoice('system', false)).toEqual({ stored: null, theme: 'light' });
    expect(applyThemeChoice('light', true)).toEqual({ stored: 'light', theme: 'light' });
  });
});

describe('패널 크기', () => {
  it('폭은 240~720px, 창 폭의 70% 이하', () => {
    expect(clampPanelWidth(100, 1400)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(5000, 3000)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(600, 800)).toBe(560);
    expect(clampPanelWidth(NaN, 1400)).toBe(PANEL_WIDTH_DEFAULT);
    expect(clampPanelWidth(400.4, 1400)).toBe(400);
  });

  it('시트 높이는 120px 이상, 3D 보기 80px 이상 남게', () => {
    expect(clampSheetFraction(0.05, 600)).toBeCloseTo(120 / 600);
    expect(clampSheetFraction(0.99, 600)).toBeCloseTo(0.85);
    expect(clampSheetFraction(0.99, 400)).toBeCloseTo(0.8);
    expect(clampSheetFraction(0.5, 600)).toBe(0.5);
    expect(clampSheetFraction(NaN, 600)).toBe(SHEET_DEFAULT);
    expect(clampSheetFraction(0.5, 0)).toBe(SHEET_DEFAULT);
  });

  it('기억하고 읽기(깨진 값·못 쓰는 저장소를 견딘다)', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    storeLayout({ panelWidth: 420, sheet: 0.6 }, s);
    expect(readLayout(s)).toEqual({ panelWidth: 420, sheet: 0.6 });
    m.set(LAYOUT_KEY, '{bad');
    expect(readLayout(s)).toEqual({});
    m.set(LAYOUT_KEY, JSON.stringify({ panelWidth: 'x', sheet: 0.3 }));
    expect(readLayout(s)).toEqual({ sheet: 0.3 });
    const broken = {
      getItem: () => {
        throw new Error('막힘');
      },
      setItem: () => {
        throw new Error('막힘');
      },
    };
    expect(readLayout(broken)).toEqual({});
    expect(() => storeLayout({ sheet: 0.5 }, broken)).not.toThrow();
  });
});

describe('시트를 열고 닫을 때 확대해 둔 보기 지키기', () => {
  const sphere = { center: [0, 0, 0], radius: 50 };
  const cam = (projection: CameraState['projection']): CameraState => ({ ...defaultCamera(), target: [3, -2, 1], distance: 40, projection });

  for (const projection of ['perspective', 'orthographic'] as const)
    it(`위쪽에 보이던 점은 같은 자리에 남는다(${projection})`, () => {
      const W = 390;
      const H0 = 700;
      const H1 = 380;
      const c0 = cam(projection);
      const f0 = computeFrame(c0, W, H0, sphere);
      // 대상점 깊이 면 위, 화면 위쪽(가운데 위 100px)에 보이는 점
      const b = f0.basis;
      const wpp = (2 * c0.distance * Math.tan(c0.fovY / 2)) / H0;
      const p: [number, number, number] = [c0.target[0] + b.up[0] * 250 * wpp, c0.target[1] + b.up[1] * 250 * wpp, c0.target[2] + b.up[2] * 250 * wpp];
      const s0 = projectToScreen(f0, p)!;
      expect(s0[1]).toBeLessThan(H1);
      const c1 = keepViewOnHeightChange(c0, H0, H1);
      const s1 = projectToScreen(computeFrame(c1, W, H1, sphere), p)!;
      expect(s1[0]).toBeCloseTo(s0[0], 3);
      expect(s1[1]).toBeCloseTo(s0[1], 3);
      // 다시 닫으면 처음 카메라
      const c2 = keepViewOnHeightChange(c1, H1, H0);
      expect(c2.distance).toBeCloseTo(c0.distance, 9);
      for (let a = 0; a < 3; a++) expect(c2.target[a]).toBeCloseTo(c0.target[a]!, 9);
    });

  it('높이가 그대로거나 0이면 그대로', () => {
    const c = cam('perspective');
    expect(keepViewOnHeightChange(c, 500, 500)).toBe(c);
    expect(keepViewOnHeightChange(c, 0, 500)).toBe(c);
  });

  it('범위에 맞춰 보는 카메라는 방향을 지킨다', () => {
    const c = cam('perspective');
    const f = cameraForBox(c, { min: [0, 0, 0], max: [2, 2, 2] }, 1.5);
    expect(f.yaw).toBe(c.yaw);
    expect(f.pitch).toBe(c.pitch);
    expect(f.target).toEqual([1, 1, 1]);
    expect(cameraForBox(c, { min: [0, 0, 0], max: [2, 2, 2] }, NaN).target).toEqual([1, 1, 1]);
  });
});
