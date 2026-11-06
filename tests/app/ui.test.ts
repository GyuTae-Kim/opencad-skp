import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('다른 언어의 긴 글이 휴대폰 폭에서 잘리거나 겹치지 않게(31차 — 스타일 규칙)', () => {
  const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');
  /** 선택자 하나의 첫 규칙 본문 */
  const rule = (sel: string): string => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

  it('도구 막대 메뉴는 화면 폭 안에 두고, 긴 항목은 다음 항목에 겹치지 않고 줄을 바꿔 높아진다(한 줄이면 32px 그대로)', () => {
    expect(rule('.menu')).toMatch(/max-width:\s*calc\(100vw - 16px\)/);
    expect(rule('.menu-item')).toMatch(/min-height:\s*32px/);
    expect(rule('.menu-item')).not.toMatch(/(^|\s)height:\s*32px/);
  });

  it('잠글 방향 고르기 단추는 독일어처럼 긴 이름을 자르지 않고 두 줄로(한 줄이면 띠 단추와 같은 38px)', () => {
    const r = rule('.mb-lockpick');
    expect(r).toMatch(/white-space:\s*normal/);
    expect(r).toMatch(/min-height:\s*38px/);
    expect(r).not.toMatch(/overflow:\s*hidden/);
  });
});

describe('휴대폰 점검(43차 — 스타일 규칙)', () => {
  const css = readFileSync(resolve(__dirname, '../../src/app/styles.css'), 'utf8');
  const part = css.slice(css.lastIndexOf('/*', css.indexOf('휴대폰 점검(43차)'))).replace(/\/\*[\s\S]*?\*\//g, '');
  /** 43차에 덧붙인 곳에서 그 선택자(쉼표로 이은 목록 안이어도)가 받는 규칙 본문을 모두 */
  const bodies = (sel: string): string =>
    [...part.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel))
      .map((m) => m[2])
      .join(';');

  it('맨 끝에 있어 앞 규칙(손가락 기기 메뉴 항목 높이 40px 고정 등)을 덮는다', () => {
    expect(css.indexOf('휴대폰 점검(43차)')).toBeGreaterThan(css.lastIndexOf('@media (pointer: coarse) {', css.indexOf('휴대폰 점검(43차)')));
    expect(css.slice(css.indexOf('휴대폰 점검(43차)'))).toContain('@media (pointer: coarse) {');
  });

  it('카메라 띠 단추 줄은 모자라면 줄을 바꾼다(320px 휴대폰에서 걷는 동안 닫기가 화면 밖으로 나가지 않게)', () => {
    const r = bodies('.cam-bar .mb-acts');
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).toMatch(/flex-shrink:\s*1/);
    expect(r).toMatch(/min-width:\s*0/);
  });

  it('측정 띠 안 측정값 칸은 6em 아래로 줄지 않고 뒤 단추가 다음 줄로(영어 320px에서 칸이 22px로 줄어 친 값이 안 보이던 것)', () => {
    expect(bodies('.measure-bar .vcb')).toMatch(/flex-wrap:\s*wrap/);
    expect(bodies('.measure-bar .vcb-input')).toMatch(/flex:\s*1 1 6em/);
    expect(bodies('.measure-bar .vcb-input')).toMatch(/min-width:\s*6em/);
  });

  it('좁은 화면의 패널 탭은 폭을 나눠 갖고 모자라면 두 줄로(영어 "Information" 같은 고른 탭이 가로 스크롤 밖으로 숨지 않게)', () => {
    expect(bodies('.ptabs')).toMatch(/flex-wrap:\s*wrap/);
    expect(bodies('.ptabs')).toMatch(/overflow-x:\s*visible/);
    expect(bodies('.ptab')).toMatch(/flex:\s*1 1 0/);
    expect(bodies('.ptab')).toMatch(/height:\s*auto/);
  });

  it('손가락 기기: 메뉴·언어 목록·패널 줄·탭·시트 단추는 높이 44px(WCAG 2.5.5), 메뉴 항목은 높이를 못 박지 않는다', () => {
    for (const sel of ['.menu-item', '.language-list button', '.prow', '.ptab', '.btn', '.mini-btn', '.seg-btn', '.ml-copy-btn']) expect(bodies(sel), sel).toMatch(/min-height:\s*44px/);
    for (const sel of ['.menu-item', '.mini-btn', '.seg-btn', '.ml-copy-btn']) expect(bodies(sel), sel).toMatch(/(^|[;\s])height:\s*auto/);
    expect(bodies('.icon-btn')).toMatch(/min-width:\s*44px/);
    expect(bodies('.icon-btn')).toMatch(/(^|[;\s])height:\s*44px/);
  });

  it('나무 줄 안의 작은 표적(펼치기·보이기 체크)은 24px 넘게(WCAG 2.5.8 — 줄 표적과 붙어 있다), 시트 손잡이는 24px', () => {
    expect(bodies(".prow.pick > input[type='checkbox']")).toMatch(/width:\s*24px[\s\S]*height:\s*24px/);
    expect(bodies('.trow .twisty')).toMatch(/position:\s*relative/);
    expect(bodies('.trow .twisty::after')).toMatch(/inset:\s*-13px -3px/);
    expect(bodies('.resizer')).toMatch(/flex-basis:\s*24px/);
    expect(bodies('.resizer')).toMatch(/margin-top:\s*-10px/);
    expect(bodies('.resizer::after')).toMatch(/top:\s*14px/);
  });

  it('3D 보기를 덮는 막대의 단추는 보이는 크기 그대로 막대 안쪽 여백까지 누르기 자리를 넓힌다(이웃과 겹치지 않게 틈의 반까지)', () => {
    // inset은 padding 상자에서 재므로 테두리 1px 단추는 1px 더: 테두리 밖 위아래 3px(38 → 44)·옆 1px(2px 틈의 반)
    for (const sel of ['.titlebar .tbtn', '.language-trigger', '.toolbar .tbtn', '.vcb-btn', '.mb-btn', '.scene-play']) {
      expect(bodies(sel), sel).toMatch(/position:\s*relative/);
      expect(bodies(`${sel}::after`), sel).toMatch(/content:\s*''[\s\S]*inset:\s*-4px -2px/);
    }
    expect(bodies('.mb-btn::after')).toMatch(/inset:\s*-4px -3px\s*;?\s*$/);
    expect(bodies('.scene-play::after')).toMatch(/inset:\s*-3px -1px\s*;?\s*$/);
    // 장면 탭은 글을 줄이는 overflow 안이라 ::after가 잘린다 — 넓히지 않는다
    expect(bodies('.scene-tab::after')).toBe('');
  });

  it('320px 손가락 기기에서는 로고 옆 글을 숨긴다("O…"로 잘리지 않게)', () => {
    expect(part).toMatch(/@media \(max-width: 359\.98px\) \{\s*\.brand-text \{\s*display: none;/);
  });
});
