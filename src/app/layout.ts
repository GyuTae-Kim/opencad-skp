/**
 * 패널 크기(순수 함수): 넓은 화면의 오른쪽 패널 폭, 좁은 화면의 아래 시트 높이(작업 영역에 대한 비율).
 * 끌어서 바꾼 크기는 이 브라우저에만 기억한다(localStorage — 못 쓰면 이번 창에서만).
 */

export const PANEL_WIDTH_DEFAULT = 330;
export const PANEL_WIDTH_MIN = 240;
export const PANEL_WIDTH_MAX = 720;
/** 아래 시트 기본 높이(작업 영역 높이에 대한 비율) */
export const SHEET_DEFAULT = 0.46;
export const SHEET_MIN_PX = 120;
export const SHEET_MAX = 0.85;
/** 3D 보기에 늘 남길 높이(px) */
export const VIEW_MIN_PX = 80;

export const LAYOUT_KEY = 'opencad-skp.layout';

/** 패널 폭: 240~720px, 그리고 창 폭의 70%를 넘지 않게 */
export function clampPanelWidth(w: number, viewportW: number): number {
  const max = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.floor(viewportW * 0.7)));
  if (!Number.isFinite(w)) return Math.min(PANEL_WIDTH_DEFAULT, max);
  return Math.round(Math.min(max, Math.max(PANEL_WIDTH_MIN, w)));
}

/** 시트 높이 비율: 120px 이상, 3D 보기 80px 이상 남게, 85% 이하 */
export function clampSheetFraction(f: number, workspaceH: number): number {
  if (!(workspaceH > 0)) return SHEET_DEFAULT;
  const min = Math.min(0.5, SHEET_MIN_PX / workspaceH);
  const max = Math.max(min, Math.min(SHEET_MAX, 1 - VIEW_MIN_PX / workspaceH));
  if (!Number.isFinite(f)) return Math.min(max, Math.max(min, SHEET_DEFAULT));
  return Math.min(max, Math.max(min, f));
}

export interface StoredLayout {
  panelWidth?: number;
  sheet?: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readLayout(s: StorageLike | null = storage()): StoredLayout {
  try {
    const raw = s?.getItem(LAYOUT_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: StoredLayout = {};
    if (typeof o.panelWidth === 'number' && Number.isFinite(o.panelWidth)) out.panelWidth = o.panelWidth;
    if (typeof o.sheet === 'number' && Number.isFinite(o.sheet)) out.sheet = o.sheet;
    return out;
  } catch {
    return {};
  }
}

export function storeLayout(l: StoredLayout, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(LAYOUT_KEY, JSON.stringify(l));
  } catch {
    /* 저장소를 못 쓰면 이번 창에서만 */
  }
}
