/**
 * 선 색 대비(순수 함수, DOM 없음): 모서리·주석 선이 그 뒤 색에 묻히지 않게 한다.
 * SketchUp처럼 선은 파일 색(모서리는 검정에 가까운 색)으로 그리지만, 와이어프레임(면 없음)·숨은 선(코어가 면을 배경 색으로 채운다)·
 * X-ray(면이 22%만 비친다)에서는 선 뒤가 배경(파일 배경을 쓰면 그 색과 하늘·지면)이다. 그 색들과 대비가 3:1(WCAG 그래픽 기준)보다
 * 모자라면 코어 테마의 선 색(밝은 배경 → 어두운 선, 어두운 배경 → 밝은 선)으로 그린다. 어두운 앱 테마에서 검은 모서리가 남색 배경에
 * 묻히던 문제를 고친다 — 밝은 테마에서는 모든 기본 선 색이 기준을 넘어 그대로다.
 * 음영·음영+모서리·무늬 없음·단색 방식은 선이 면 색 위에 있어(단색 면은 두 테마에서 같은 밝은 회색) 파일 색 그대로 둔다.
 * 단면 평면 표시(주황)는 뜻이 있는 색이라 바꾸지 않고, 고른 것 강조 색은 코어가 따로 칠한다. 태그 색 칠하기는 면(그물)에만 건다.
 * 숨은 모서리 점선과 외곽선(실루엣)은 코어가 이미 테마 선 색으로 그려 배경 위에서 묻히지 않는다(테스트가 확인).
 */
import { DARK_THEME, LIGHT_THEME, type BackgroundOptions, type RenderMode, type Rgba } from 'opencad-viewer3d';
import type { Rgb } from '../meta';
import { isLightBackground, luminance } from './backdrop';

/** 선이 뒤 색과 이만큼은 달라야 읽힌다(WCAG 2.1 1.4.11 그래픽 대비) */
export const MIN_LINE_CONTRAST = 3;

/** 대비 비율(1~21, 순서 상관없음) */
export function contrastRatio(a: Rgb | Rgba, b: Rgb | Rgba): number {
  const la = luminance([a[0], a[1], a[2]]);
  const lb = luminance([b[0], b[1], b[2]]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 코어 테마의 선 색(opencad-viewer3d 0.7.1 viewer.ts applyTheme의 colors.line과 같은 값).
 * 코어는 숨은 선 방식의 면 윤곽선·뒤 모서리 점선·외곽선을 이 색으로 그린다
 */
export const THEME_LINE: Readonly<Record<'light' | 'dark', Rgba>> = {
  light: [0.15, 0.2, 0.28, 1],
  dark: [0.85, 0.88, 0.92, 1],
};

/** 선 뒤가 면이 아니라 배경인 그리기 방식 */
export const BACKGROUND_LINE_MODES: ReadonlySet<RenderMode> = new Set<RenderMode>(['wireframe', 'hiddenLine', 'xray']);

/** 3D 보기 모습: 그리기 방식, 앱 테마, 파일 배경(쓰지 않으면 null), 파일 하늘·지면(쓰지 않으면 null) */
export interface LineView {
  mode: RenderMode;
  theme: 'light' | 'dark';
  backdrop: Rgb | null;
  sky: BackgroundOptions | null;
}

const hexRgb = (s: string): Rgb => {
  const h = s.replace('#', '');
  const ch = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
  return [ch(0), ch(2), ch(4)];
};

/** 코어가 그리는 바탕 색(파일 배경이 없으면 앱 테마 바탕) */
export function viewBackground(theme: 'light' | 'dark', backdrop: Rgb | null): Rgb {
  return backdrop ?? hexRgb(theme === 'dark' ? DARK_THEME.background : LIGHT_THEME.background);
}

/** 코어 테마 바탕 쪽(격자·선 색을 고른다 — backdrop.ts viewerTheme과 같은 규칙) */
export function viewBase(theme: 'light' | 'dark', backdrop: Rgb | null): 'light' | 'dark' {
  return backdrop ? (isLightBackground(backdrop) ? 'light' : 'dark') : theme;
}

const rgbOf = (c: Rgba | string | undefined): Rgb | null => (Array.isArray(c) && c.length >= 3 ? [c[0]!, c[1]!, c[2]!] : null);

/**
 * 선 뒤에 오는 색들(배경이 선 뒤가 아닌 방식이면 null). 하늘·지면을 쓰면 지평선 위는 하늘(꼭대기~지평선), 아래는 지면 색이고
 * 하나만 켜면 나머지 쪽은 바탕 색이다. 숨은 선은 면도 바탕 색으로 채운다
 */
export function lineBackdrops(view: LineView): Rgb[] | null {
  if (!BACKGROUND_LINE_MODES.has(view.mode)) return null;
  const bg = viewBackground(view.theme, view.backdrop);
  const s = view.sky;
  const sky = rgbOf(s?.sky);
  const ground = rgbOf(s?.ground);
  const out: Rgb[] = [];
  if (sky) out.push(sky, rgbOf(s?.skyHorizon) ?? sky);
  else out.push(bg);
  if (ground) out.push(ground, rgbOf(s?.groundHorizon) ?? ground);
  else out.push(bg);
  if (view.mode === 'hiddenLine') out.push(bg);
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = c.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 뒤 색들 가운데 가장 낮은 대비 */
export function minContrast(color: Rgb | Rgba, behind: readonly Rgb[]): number {
  let m = Infinity;
  for (const b of behind) m = Math.min(m, contrastRatio(color, b));
  return m;
}

/**
 * 읽히는 선 색: 뒤 색들과 모두 3:1 이상이면 null(파일 색 그대로). 아니면 테마 바탕 쪽 선 색, 그것도 모자라면 밝은·어두운 선 색 가운데
 * 대비가 가장 큰 색(파일 색이 오히려 낫다면 null)
 */
export function readableLineColor(color: Rgba, behind: readonly Rgb[], base: 'light' | 'dark'): Rgba | null {
  if (!behind.length) return null;
  const own = minContrast(color, behind);
  if (own >= MIN_LINE_CONTRAST) return null;
  const first = THEME_LINE[base];
  const firstC = minContrast(first, behind);
  if (firstC >= MIN_LINE_CONTRAST) return [first[0], first[1], first[2], color[3]];
  const other = THEME_LINE[base === 'light' ? 'dark' : 'light'];
  const otherC = minContrast(other, behind);
  const best = otherC > firstC ? other : first;
  if (Math.max(firstC, otherC) <= own) return null;
  return [best[0], best[1], best[2], color[3]];
}

/** 색을 가진 장면 항목(선분·점 묶음) */
export interface ColoredItem {
  id: string;
  color?: Rgba;
}

/**
 * 덮어쓸 색(id → 색). skip(id)이 참인 항목(단면 평면 표시)과 색이 없는 항목(코어가 테마 선 색으로 그린다)은 빼고,
 * 배경이 선 뒤가 아닌 방식이면 비어 있다
 */
export function lineColorOverrides(items: Iterable<ColoredItem>, view: LineView, skip: (id: string) => boolean = () => false): Map<string, Rgba> {
  const out = new Map<string, Rgba>();
  const behind = lineBackdrops(view);
  if (!behind) return out;
  const base = viewBase(view.theme, view.backdrop);
  const memo = new Map<string, Rgba | null>();
  for (const it of items) {
    const c = it.color;
    if (!c || skip(it.id)) continue;
    const k = c.join(',');
    let r = memo.get(k);
    if (r === undefined) memo.set(k, (r = readableLineColor(c, behind, base)));
    if (r) out.set(it.id, r);
  }
  return out;
}

/** 코어 쪽(setItemColor — null이면 되돌림) */
export interface LineColorTarget {
  setItemColor(id: string, color: Rgba | null): void;
}

/**
 * 건 색을 기억해 바뀐 것만 코어에 건다(항목 하나마다 코어가 겉모습을 다시 셈한다).
 * 장면을 새로 올리면 코어가 겉모습을 모두 풀므로 reset()한 뒤 다시 apply한다
 */
export class LineContrast {
  private applied = new Map<string, string>();

  reset(): void {
    this.applied.clear();
  }

  /** 덮어쓴 항목 수 */
  get size(): number {
    return this.applied.size;
  }

  /** want로 맞춘다 → 코어에 건 횟수 */
  apply(target: LineColorTarget, want: ReadonlyMap<string, Rgba>): number {
    let calls = 0;
    for (const id of [...this.applied.keys()]) {
      if (want.has(id)) continue;
      target.setItemColor(id, null);
      this.applied.delete(id);
      calls++;
    }
    for (const [id, c] of want) {
      const k = c.join(',');
      if (this.applied.get(id) === k) continue;
      target.setItemColor(id, c);
      this.applied.set(id, k);
      calls++;
    }
    return calls;
  }
}
