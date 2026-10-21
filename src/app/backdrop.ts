/**
 * 3D 보기 배경(순수 함수, DOM 없음): SketchUp 파일·장면 스타일의 배경 색으로 그린다(SketchUp·Viewer와 같은 모습).
 * 앱 테마(밝게·어둡게)는 창 둘레만 바꾸고, 3D 보기 안의 격자·뷰 큐브·글 색은 배경 밝기에 맞는 쪽(밝은 배경 → 밝은 테마 색)을 쓴다.
 * 하늘·지면(스타일의 DrawHorizon·DrawGround)은 코어 setBackground의 하늘·땅 기울기 바탕으로 그린다(지평선은 카메라 앙각을 따른다).
 * 하늘은 위가 하늘 색이고 지평선 쪽으로 밝아지며, 땅은 지평선 쪽이 하늘 지평선 색에 조금 섞인다(SketchUp 화면처럼).
 * 끄면(사용자 설정) 예전처럼 앱 테마의 배경이다.
 */
import type { BackgroundOptions, Viewer3dOptions } from 'opencad-viewer3d';
import type { Rgb, SkpStyleMeta } from '../meta';

/** 사용자 설정 기억 열쇠 */
export const FILE_BACKGROUND_KEY = 'opencad-skp.fileBackground';

const isRgb = (v: unknown): v is Rgb => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));

/** 스타일의 배경 색(0~1 RGB, 없으면 null) */
export function styleBackground(style: Pick<SkpStyleMeta, 'background'> | null | undefined): Rgb | null {
  const c = style?.background;
  return isRgb(c) ? [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])] : null;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: Rgb): [number, number, number, number] => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2]), 1];

/**
 * 스타일의 하늘·지면 → 코어 바탕(setBackground). 둘 다 꺼졌거나 모르면 null(한 색 배경).
 * 하늘만 켜면 지평선 아래는 배경 색 그대로(코어가 테마 바탕을 쓴다)
 */
export function skyBackground(style: Pick<SkpStyleMeta, 'sky' | 'ground'> | null | undefined): BackgroundOptions | null {
  const sky = isRgb(style?.sky) ? style!.sky! : null;
  const ground = isRgb(style?.ground) ? style!.ground! : null;
  if (!sky && !ground) return null;
  const out: BackgroundOptions = {};
  const horizon = sky ? mix(sky, [1, 1, 1], 0.55) : null;
  if (sky && horizon) {
    out.sky = rgba(sky);
    out.skyHorizon = rgba(horizon);
  }
  if (ground) {
    out.ground = rgba(ground);
    out.groundHorizon = rgba(horizon ? mix(ground, horizon, 0.3) : ground);
  }
  return out;
}

/** 0~1 RGB → CSS #rrggbb */
export function cssHex(c: Rgb): string {
  return `#${c.map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 상대 휘도(sRGB, WCAG) */
export function luminance(c: Rgb): number {
  const ch = (x: number): number => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(clamp01(c[0])) + 0.7152 * ch(clamp01(c[1])) + 0.0722 * ch(clamp01(c[2]));
}

/** 밝은 배경인지(격자·뷰 큐브·덧그림 글을 밝은 테마 색으로) */
export const isLightBackground = (c: Rgb): boolean => luminance(c) > 0.18;

/**
 * 코어 테마: 파일 배경을 쓰면 { base: 배경 밝기 쪽, background: 파일 색 }, 아니면 앱 테마 그대로.
 * base는 격자·축·뷰 큐브·측정 글처럼 배경 위에 그리는 색을 고른다(흰 배경에 흰 격자가 보이지 않게)
 */
export function viewerTheme(app: 'dark' | 'light', background: Rgb | null): NonNullable<Viewer3dOptions['theme']> {
  if (!background) return app;
  return { base: isLightBackground(background) ? 'light' : 'dark', background: cssHex(background) };
}

/** localStorage(막혀 있으면 null — 접근만으로 예외가 나는 브라우저가 있다) */
export function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 기억한 설정(없거나 못 읽으면 켬) */
export function loadFileBackground(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(FILE_BACKGROUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function storeFileBackground(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(FILE_BACKGROUND_KEY, on ? '1' : '0');
  } catch {
    /* 비공개 창 등 — 이번만 */
  }
}
