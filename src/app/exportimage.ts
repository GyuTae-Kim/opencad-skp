/**
 * 그림 내보내기 도움(순수 함수, DOM 없음): 크기 고르기, 투명 배경 풀기(검정·흰 배경 두 장의 차이), 문자·치수 라벨을 캔버스에 그릴 명령.
 *
 * - 크기: "화면" = 지금 캔버스(CSS 크기 × 기기 화소 비율, 코어 상한 2), "2배" = CSS 크기의 2배 화소(기기 비율이 2보다 낮을 때만 다르다).
 * - 투명 배경: 코어 캔버스는 불투명이라 배경을 검정·흰색으로 바꿔 두 번 그리고 화소마다 α = 1 − (흰 − 검정), 색 = 검정 / α로 푼다
 *   (차이 매트). 불투명 형상은 두 장이 같아 α = 1, 배경은 α = 0, 반투명·가장자리는 그 사이.
 * - 라벨: 화면의 DOM 라벨(annotations.ts Placement)을 같은 자리·정렬·돌림·글꼴로 캔버스에 그리는 명령으로 바꾼다(CSS 화소 기준).
 */
import type { AnnotationItem, LabelAlign, Placement } from './annotations';

/** 코어 화소 비율 상한(Viewer3dOptions.maxPixelRatio 기본) */
export const MAX_EXPORT_RATIO = 2;

export interface ExportSize {
  ratio: number;
  width: number;
  height: number;
}

/** 내보낼 크기 후보: [화면] 또는 [화면, 2배](2배가 더 클 때만) */
export function exportSizes(cssW: number, cssH: number, deviceRatio: number): ExportSize[] {
  const w = Math.max(1, Math.round(cssW));
  const h = Math.max(1, Math.round(cssH));
  const screen = Math.max(0.5, Math.min(Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1, MAX_EXPORT_RATIO));
  const out: ExportSize[] = [{ ratio: screen, width: Math.round(w * screen), height: Math.round(h * screen) }];
  if (screen < MAX_EXPORT_RATIO) out.push({ ratio: MAX_EXPORT_RATIO, width: w * MAX_EXPORT_RATIO, height: h * MAX_EXPORT_RATIO });
  return out;
}

/**
 * 차이 매트: 같은 장면을 검정(black)·흰(white) 배경으로 그린 RGBA 화소 → 투명 배경 RGBA(out, 같은 길이).
 * α는 채널 차이의 가장 큰 값으로 잰다(색 번짐으로 채널마다 조금 다를 때 배경을 남기지 않게)
 */
export function unmatte(black: ArrayLike<number>, white: ArrayLike<number>, out: { [i: number]: number; length: number }): void {
  const n = Math.min(black.length, white.length, out.length);
  for (let i = 0; i + 3 < n; i += 4) {
    const d = Math.max(white[i]! - black[i]!, white[i + 1]! - black[i + 1]!, white[i + 2]! - black[i + 2]!);
    const a = Math.min(255, Math.max(0, 255 - d));
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    out[i] = Math.min(255, Math.round(black[i]! * k));
    out[i + 1] = Math.min(255, Math.round(black[i + 1]! * k));
    out[i + 2] = Math.min(255, Math.round(black[i + 2]! * k));
    out[i + 3] = a;
  }
}

/** 캔버스에 라벨 하나를 그릴 명령(CSS 화소, 내보낼 때 배율을 곱한다) */
export interface LabelOp {
  lines: string[];
  /** 기준점(화면 CSS 화소) */
  x: number;
  y: number;
  align: LabelAlign;
  /** 시계 방향 각도(도) */
  angle: number;
  px: number;
  /** canvas font 글 */
  font: string;
  color: string;
  /** 테두리 색(밝은 글은 어두운 테두리) */
  halo: string;
  /** 흐린 라벨(겹친 것) */
  alpha: number;
}

/** 화면 라벨 배치 → 그리기 명령(색이 없으면 기본 글 색) */
export function labelOps(placements: readonly Placement[], items: readonly AnnotationItem[], defaultColor = '#1d2530', defaultFamily = 'system-ui, sans-serif'): LabelOp[] {
  const out: LabelOp[] = [];
  for (const p of placements) {
    const it = items[p.item];
    if (!it || !it.text) continue;
    const family = it.family || defaultFamily;
    const font = `${it.italic ? 'italic ' : ''}${it.bold ? '700 ' : ''}${Math.max(1, Math.round(p.px * 10) / 10)}px ${family}`;
    out.push({
      lines: it.text.split('\n'),
      x: p.x,
      y: p.y,
      align: p.align,
      angle: p.angle,
      px: p.px,
      font,
      color: it.color || defaultColor,
      halo: it.light ? 'rgba(0,0,0,0.85)' : '#ffffff',
      alpha: p.crowded ? 0.35 : 1,
    });
  }
  return out;
}

/** 라벨 상자(가로 w, 세로 h)의 왼쪽 위 — 기준점에 대한 자리(CSS translate와 같은 정렬) */
export function labelBoxOrigin(align: LabelAlign, w: number, h: number): [number, number] {
  switch (align) {
    case 'right':
      return [0, -h / 2];
    case 'left':
      return [-w, -h / 2];
    case 'above':
      return [-w / 2, -h];
    case 'below':
      return [-w / 2, 0];
    case 'topLeft':
      return [0, 0];
    default:
      return [-w / 2, -h / 2];
  }
}

/** 내보낼 파일 이름(확장자 뺀 문서 이름, 2배면 @2x, 투명이면 -transparent) */
export function exportFileName(docName: string, ratioTag: boolean, transparent: boolean): string {
  const stem = docName.replace(/\.[^./\\]+$/, '') || 'model';
  return `${stem}${ratioTag ? '@2x' : ''}${transparent ? '-transparent' : ''}.png`;
}
