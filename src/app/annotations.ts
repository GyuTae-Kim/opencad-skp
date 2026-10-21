/**
 * 문자·치수 라벨 덧그림: 해석기가 meta.texts·meta.dimensions에 적은 글을 3D 보기 위 DOM 글로 그린다(덧그림 층 Overlay의 'annotations').
 * 지시선·치수선·연장선은 해석기가 장면 선(LineSet3d, meta.annotationItems)으로 이미 그리므로 여기서는 글만 그린다.
 *
 * - 자리: 지시선 글은 글 자리(textPoint) — 지시선 붙는 점의 반대쪽 옆에 3px 띄워 둔다(SketchUp처럼), 지시선이 없는 글은 그 점 가운데,
 *   화면 고정 글은 화면 비율 자리(왼쪽 위 기준), 치수 글은 글 자리 가운데. 치수 글이 선에 맞춰 놓이면(alignedText) 치수선 방향으로
 *   돌리되 아래·오른쪽에서 읽히게 한다(세로는 위로 읽는다).
 * - 글: 치수 글이 비었거나 '<>'가 들어 있으면 잰 값을 모형 단위 글로 채운다.
 * - 글꼴: 화면 크기 글은 pointSize pt × 96/72 px(Windows SketchUp 규칙 — 파일 글꼴이 Windows 글꼴이라 PRISME도 이것을 따른다),
 *   세계 크기 글(worldHeight)은 그 깊이에서 화소로 바꾼다 — 2px보다 작으면 숨기고 512px에서 자른다. 굵게·기울임·색도 파일을 따른다.
 * - 숨김: 화면 밖·눈 뒤, 끈 종류(글·치수), 숨긴 태그, 숨긴 노드(조상 포함은 부른 쪽 판정), 숨긴 형상(hidden: true, 숨긴 형상 보기가 꺼졌을 때),
 *   단면에 잘린 쪽(글 자리 기준).
 * - 겹침: 우선순위(화면 고정 글 → 치수 → 문자, 같은 종류는 파일 차례)대로 놓으며, 앞서 놓인 라벨과 상자가 겹치는 라벨은
 *   숨기거나('hide', 기본) 흐리게('fade' — 흐린 라벨은 자리를 차지하지 않는다) 한다. 상자 크기는 글자 수로 어림한다(DOM을 재지 않는다).
 * - 많을 때: 한 번에 그리는 라벨은 LABEL_LIMIT(400)개까지, DOM 요소는 모아 두고 다시 쓴다(바뀐 속성만 쓴다).
 * - 가림(형상 뒤 글 숨기기): 카메라가 OCCLUSION_SETTLE_MS 멈추면 라벨 기준점(지시선 글은 붙는 점, 치수·지시선 없는 글은 글 자리)의
 *   화면 자리에서 부른 쪽의 가림 판정(코어 고르기 — 단면에 잘린 쪽·숨긴 항목은 고르지 않는다)으로 형상에 가린 라벨을 숨긴다.
 *   움직이는 동안은 앞의 판정을 쓰고(PRISME처럼 멈춘 뒤 CPU 광선), 화면 고정 글은 가리지 않는다. 한 번에 OCCLUSION_LIMIT개까지 판정한다.
 * 규칙은 PRISME 서비스 SKP 뷰어(skp_viewer_annotations.js)에서 옮겼다.
 */
import { projectToScreen, worldPerPixel, type ViewFrame } from 'opencad-viewer3d/camera';
import type { SkpDimensionMeta, SkpFontMeta, Vec3 } from '../meta';
import type { Overlay } from './overlay';
import { DEFAULT_UNITS, formatLength, mmPerSceneUnit, type UnitsDisplay } from './units';

/** 덧그림 층 열쇠 */
export const ANNOTATIONS_KEY = 'annotations';
/** 한 번에 그리는 라벨 수 */
export const LABEL_LIMIT = 400;
/** 화면 크기 글: pt당 CSS 화소(Windows 100 %) */
export const SCREEN_PX_PER_PT = 96 / 72;
/** 크기가 없는 글꼴의 pt(SketchUp 기본 글 크기) */
export const DEFAULT_TEXT_PT = 12;
/** 글꼴이 없는 라벨의 글 크기(px) */
export const DEFAULT_LABEL_PX = 12;
/** 라벨 글 크기 상한(px) — 이상한 크기나 세계 크기 글 안에 들어간 카메라 */
export const MAX_LABEL_PX = 512;
/** 세계 크기 글이 이보다 작게 보이면 그리지 않는다(px) */
export const WORLD_TEXT_MIN_PX = 2;
/** 지시선 끝에서 글까지(px) */
export const LEADER_GAP_PX = 3;
/** 라벨을 화면 가장자리 안에 둘 여유(px) */
export const EDGE_MARGIN_PX = 2;
/** 이보다 밝은 글(상대 휘도)은 어두운 테두리(.is-light) */
export const LIGHT_INK = 0.6;
/** 라벨 글 길이 상한 */
export const MAX_TEXT_CHARS = 2000;
/** 카메라가 이만큼 멈춘 뒤 가림을 판정한다(ms) */
export const OCCLUSION_SETTLE_MS = 160;
/** 한 번에 가림을 판정할 라벨 수(화면 안 후보 차례대로) */
export const OCCLUSION_LIMIT = 2000;

/**
 * 가림 판정: 라벨 기준점 p(세계)와 그 화면 자리(x, y) → 형상에 가렸으면 true. 부른 쪽이 코어 고르기로 판정한다
 * (ViewFrame은 깊이 비교용 — occludedBy 참고)
 */
export type OcclusionTest = (p: Vec3, x: number, y: number, f: ViewFrame) => boolean;

/** 시선 방향 깊이(눈 앞이 +) */
export function viewDepthOf(f: Pick<ViewFrame, 'eye' | 'basis'>, p: readonly number[]): number {
  const b = f.basis.back;
  return -((p[0]! - f.eye[0]) * b[0] + (p[1]! - f.eye[1]) * b[1] + (p[2]! - f.eye[2]) * b[2]);
}

/**
 * 고른 점 hit(세계)이 라벨 기준점 p보다 시선 방향으로 tol보다 앞에 있으면 가렸다. tol은 기준점 깊이의 0.5 %와 abs 중 큰 것 —
 * 면 위에 붙은 지시선 점은 그 면을 고르므로(같은 깊이) 가리지 않는다
 */
export function occludedBy(f: Pick<ViewFrame, 'eye' | 'basis'>, p: readonly number[], hit: readonly number[], abs = 0): boolean {
  const dp = viewDepthOf(f, p);
  const dh = viewDepthOf(f, hit);
  const tol = Math.max(abs, Math.abs(dp) * 0.005);
  return dh < dp - tol;
}

/** 카메라·크기가 같은지 가리는 열쇠 */
export function frameKey(f: Pick<ViewFrame, 'eye' | 'basis' | 'width' | 'height' | 'projection' | 'pixelPerDepth' | 'pixelConst'>): string {
  const r = (v: number): string => (Number.isFinite(v) ? v.toPrecision(7) : 'x');
  return [f.width, f.height, f.projection, ...f.eye.map(r), ...f.basis.back.map(r), ...f.basis.up.map(r), r(f.pixelPerDepth), r(f.pixelConst)].join(',');
}
/** 라벨 상자 안쪽 여백(px, 어림 크기에 더한다 — CSS padding 1px 2px와 맞춘다) */
const PAD_X = 4;
const PAD_Y = 2;
const LINE_EM = 1.2;

export type LabelKind = 'text' | 'screen' | 'dim';
/** 자리 기준점에 대한 라벨 상자 자리 */
export type LabelAlign = 'center' | 'right' | 'left' | 'above' | 'below' | 'topLeft';

/** 그리기 준비를 마친 라벨 하나(setData 때 한 번 만든다) */
export interface AnnotationItem {
  kind: LabelKind;
  text: string;
  /** 글 자리(세계). 화면 고정 글은 null */
  at: Vec3 | null;
  /** 지시선이 붙는 점(지시선 글만) */
  anchor: Vec3 | null;
  /** 화면 고정 글: 화면 비율 0~1(왼쪽 위 원점) */
  screen: [number, number] | null;
  /** 글을 맞출 치수선 방향(세계 단위, alignedText 치수만) */
  dir: Vec3 | null;
  tag: string;
  hidden: boolean;
  node: number;
  /** 화면 크기 글(px). null = 기본 크기 */
  px: number | null;
  /** 세계 크기 글 높이(장면 단위). null = 화면 크기 */
  worldHeight: number | null;
  /** CSS font-family('' = 기본) */
  family: string;
  bold: boolean;
  italic: boolean;
  /** CSS 색('' = 기본) */
  color: string;
  /** 밝은 글(어두운 테두리가 필요) */
  light: boolean;
  /** 1px 글꼴에서 어림한 글 크기 [가로, 세로](px) */
  em: [number, number];
}

export interface AnnotationFilter {
  /** 문자(글·화면 고정 글) 보이기 */
  texts: boolean;
  /** 치수 글 보이기 */
  dimensions: boolean;
  hiddenTags: ReadonlySet<string>;
  /** 노드(−1 = 모형 바로 아래)가 (조상 포함) 숨겨졌는지 — 부른 쪽이 판정한다 */
  isNodeHidden: ((node: number) => boolean) | null;
  /** 숨긴 형상 보기(hidden: true인 것도 그린다) */
  showHidden: boolean;
  /** 단면(코어 setSection 꼴: normal·p > offset 쪽이 잘린다). null = 없음 */
  section: { normal: readonly number[]; offset: number } | null;
}

export interface LayoutOptions {
  /** 한 번에 그릴 라벨 수 */
  limit?: number;
  /** 겹친 라벨: 'hide' = 숨김(기본), 'fade' = 흐리게(.is-crowded), 'off' = 그대로 */
  crowd?: 'hide' | 'fade' | 'off';
  /** 화면 크기 글 상한(px, 좁은 화면에서 줄일 때) */
  maxScreenPx?: number;
  /** 글꼴이 없는 라벨의 글 크기(px) */
  defaultPx?: number;
}

/** 놓은 라벨 하나 */
export interface Placement {
  /** items 차례 */
  item: number;
  /** 기준점(화면 CSS 화소, 가장자리 안으로 옮긴 뒤) */
  x: number;
  y: number;
  align: LabelAlign;
  /** 돌림(CSS 각도, 시계 방향) */
  angle: number;
  /** 글 크기(px) */
  px: number;
  /** 어림 상자(돌린 뒤의 둘레 상자, 왼쪽 위 기준) */
  box: { x: number; y: number; w: number; h: number };
  /** 겹쳐 흐리게 그리는지('fade') */
  crowded: boolean;
}

export const DEFAULT_FILTER: Readonly<AnnotationFilter> = Object.freeze({
  texts: true,
  dimensions: true,
  hiddenTags: new Set<string>(),
  isNodeHidden: null,
  showHidden: false,
  section: null,
});

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [x, y, z] = v as unknown[];
  return isNum(x) && isNum(y) && isNum(z) ? [x, y, z] : null;
}

// ───────────────────────── 글꼴·색(순수) ─────────────────────────

/** 파일 글꼴(모르는 꼴이어도 안전하게) → 글꼴. 객체가 아니면 null */
export function readFont(v: unknown): SkpFontMeta | null {
  const o = obj(v);
  if (!o) return null;
  const f: SkpFontMeta = { face: typeof o.face === 'string' ? o.face : '', bold: o.bold === true, italic: o.italic === true };
  if (isNum(o.pointSize) && o.pointSize > 0 && o.pointSize <= 10000) f.pointSize = o.pointSize;
  if (isNum(o.worldHeight) && o.worldHeight > 0) f.worldHeight = o.worldHeight;
  return f;
}

/** 글꼴 이름 → CSS font-family(이름을 깨끗이 해 따옴표로 감싸고 앱 글꼴 목록을 뒤에). 이름이 없으면 '' */
export function fontFamilyCss(face: unknown): string {
  const name = String(face ?? '')
    .replace(/[\u0000-\u001f\u007f"'\\;{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return name ? `"${name}", var(--font)` : '';
}

/** 화면 크기 글의 px(글꼴이 없으면 null = 기본 크기, 크기가 없으면 12pt) */
export function screenFontPx(font: SkpFontMeta | null): number | null {
  if (!font) return null;
  return Math.min(MAX_LABEL_PX, (font.pointSize ?? DEFAULT_TEXT_PT) * SCREEN_PX_PER_PT);
}

/** 0~1 RGB → CSS 색(꼴이 아니면 '') */
export function annotationColor(c: unknown): string {
  const v = vec3(c);
  if (!v) return '';
  const b = v.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
  return `rgb(${b[0]}, ${b[1]}, ${b[2]})`;
}

/** 밝은 글인지(상대 휘도 > LIGHT_INK — 어두운 테두리가 필요) */
export function isLightInk(c: unknown): boolean {
  const v = vec3(c);
  if (!v) return false;
  const lin = (x: number): number => {
    const s = Math.min(1, Math.max(0, x));
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]) > LIGHT_INK;
}

/** 넓은 글자(한글·한자·가나·전각) */
function wideChar(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    c >= 0x1f300
  );
}

/** 글 → 1px 글꼴에서의 어림 크기 [가로, 세로](줄은 '\n', 넓은 글자 1em, 빈칸 0.28em, 대문자 0.65em, 그 밖 0.55em) */
export function estimateEm(text: string): [number, number] {
  const lines = text.split('\n');
  let wMax = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line) {
      const c = ch.codePointAt(0)!;
      if (c === 9) w += 2;
      else if (c < 0x20) continue;
      else if (c === 0x20) w += 0.28;
      else if (wideChar(c)) w += 1;
      else if (c >= 0x41 && c <= 0x5a) w += 0.65;
      else w += 0.55;
    }
    wMax = Math.max(wMax, w);
  }
  return [wMax, lines.length * LINE_EM];
}

/** 선 (x0, y0) → (x1, y1)을 따라 놓을 글의 CSS 각도(시계 방향): 아래·오른쪽에서 읽히게 — 가로 0°, 세로 −90°(위로 읽음) */
export function readableAngle(x0: number, y0: number, x1: number, y1: number): number {
  let a = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  if (a > 80) a -= 180;
  return a;
}

// ───────────────────────── 글 만들기(순수) ─────────────────────────

/** 파일 글이 비었을 때 앞에 붙이는 말(SketchUp 반지름·지름 치수 꼴 — 파일 글이 있으면 쓰지 않는다) */
const DIM_PREFIX: Record<SkpDimensionMeta['kind'], string> = { linear: '', radial: 'R', diameter: 'DIA ' };

/**
 * 치수 글: 파일 글이 비었으면 잰 값(모형 단위), '<>'가 있으면 그 자리를 잰 값으로 채운다. 그 밖에는 파일 글 그대로.
 * value는 장면 단위, mmPerUnit은 장면 한 단위의 mm.
 */
export function dimensionText(d: Partial<Pick<SkpDimensionMeta, 'kind' | 'text' | 'value'>>, units: UnitsDisplay = DEFAULT_UNITS, mmPerUnit = 1): string {
  const raw = typeof d.text === 'string' ? d.text : '';
  const value = isNum(d.value) ? formatLength(Math.abs(d.value) * mmPerUnit, units) : '';
  if (!raw.trim()) return value ? `${DIM_PREFIX[d.kind ?? 'linear'] ?? ''}${value}` : '';
  if (raw.includes('<>')) return raw.split('<>').join(value);
  return raw;
}

const clip = (s: string): string => (s.length > MAX_TEXT_CHARS ? `${s.slice(0, MAX_TEXT_CHARS)}…` : s);

function baseItem(o: Record<string, unknown>, kind: LabelKind, text: string): AnnotationItem {
  const font = readFont(o.font);
  return {
    kind,
    text,
    at: null,
    anchor: null,
    screen: null,
    dir: null,
    tag: typeof o.tag === 'string' ? o.tag : '',
    hidden: o.hidden === true,
    node: Number.isInteger(o.node) ? (o.node as number) : -1,
    px: screenFontPx(font),
    worldHeight: kind !== 'screen' && font?.worldHeight ? font.worldHeight : null,
    family: fontFamilyCss(font?.face),
    bold: font?.bold === true,
    italic: font?.italic === true,
    color: annotationColor(o.color),
    light: isLightInk(o.color),
    em: estimateEm(text),
  };
}

/** meta.texts → 라벨(글이 비었거나 자리가 없는 것은 뺀다) */
export function prepareTexts(texts: readonly unknown[] | null | undefined): AnnotationItem[] {
  const out: AnnotationItem[] = [];
  for (const raw of texts ?? []) {
    const o = obj(raw);
    if (!o || typeof o.text !== 'string' || !o.text.trim()) continue;
    const text = clip(o.text.replace(/\r\n?/g, '\n'));
    const point = vec3(o.point);
    const textPoint = vec3(o.textPoint);
    if (!point && !textPoint) {
      const s = Array.isArray(o.screen) && isNum(o.screen[0]) && isNum(o.screen[1]) ? ([o.screen[0], o.screen[1]] as [number, number]) : null;
      if (!s) continue;
      out.push({ ...baseItem(o, 'screen', text), screen: s });
      continue;
    }
    const item = baseItem(o, 'text', text);
    item.at = textPoint ?? point;
    // 지시선이 보이는 글만 붙는 점의 반대쪽 옆에 둔다
    if (o.leaderType !== 'none' && point && textPoint && (point[0] !== textPoint[0] || point[1] !== textPoint[1] || point[2] !== textPoint[2])) item.anchor = point;
    out.push(item);
  }
  return out;
}

/** meta.dimensions → 라벨(글 자리가 없거나 글이 비는 것은 뺀다) */
export function prepareDimensions(dims: readonly unknown[] | null | undefined, units: UnitsDisplay = DEFAULT_UNITS, mmPerUnit = 1): AnnotationItem[] {
  const out: AnnotationItem[] = [];
  for (const raw of dims ?? []) {
    const o = obj(raw);
    const at = o ? vec3(o.textPoint) : null;
    if (!o || !at) continue;
    const kind = o.kind === 'radial' || o.kind === 'diameter' ? o.kind : 'linear';
    const text = clip(dimensionText({ kind, text: typeof o.text === 'string' ? o.text : '', value: isNum(o.value) ? o.value : undefined }, units, mmPerUnit));
    if (!text.trim()) continue;
    const item = baseItem(o, 'dim', text);
    item.at = at;
    const d = o.alignedText === true ? vec3(o.direction) : null;
    const l = d ? Math.hypot(d[0], d[1], d[2]) : 0;
    if (d && l > 0) item.dir = [d[0] / l, d[1] / l, d[2] / l];
    out.push(item);
  }
  return out;
}

// ───────────────────────── 고르기·배치(순수) ─────────────────────────

const PRIORITY: Record<LabelKind, number> = { screen: 0, dim: 1, text: 2 };

/** 거르기를 지난 라벨 차례(우선순위 → 파일 차례). 카메라와 상관없는 것만 본다 */
export function annotationCandidates(items: readonly AnnotationItem[], f: AnnotationFilter): number[] {
  const nodeMemo = new Map<number, boolean>();
  const nodeHidden = (n: number): boolean => {
    if (!f.isNodeHidden) return false;
    let v = nodeMemo.get(n);
    if (v === undefined) nodeMemo.set(n, (v = !!f.isNodeHidden(n)));
    return v;
  };
  const sec = f.section;
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.kind === 'dim' ? !f.dimensions : !f.texts) return;
    if (it.hidden && !f.showHidden) return;
    if (f.hiddenTags.has(it.tag)) return;
    if (nodeHidden(it.node)) return;
    if (sec && it.at) {
      const n = sec.normal;
      if (n[0]! * it.at[0] + n[1]! * it.at[1] + n[2]! * it.at[2] > sec.offset) return;
    }
    out.push(i);
  });
  return out.sort((a, b) => PRIORITY[items[a]!.kind] - PRIORITY[items[b]!.kind] || a - b);
}

/** 정렬별 상자 왼쪽 위의 기준점에 대한 자리(상자 가로 w, 세로 h) */
function alignOffset(align: LabelAlign, w: number, h: number): [number, number] {
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

type Box = Placement['box'];
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 겹침 찾기용 화면 칸(CELL_PX 화소 칸마다 그 칸에 걸친 상자) — 후보가 아주 많아도 놓인 상자 전부와 견주지 않는다 */
const CELL_PX = 64;
class BoxGrid {
  private readonly cells = new Map<number, Box[]>();
  private readonly cols: number;
  private readonly rows: number;
  constructor(width: number, height: number) {
    this.cols = Math.max(1, Math.ceil(width / CELL_PX));
    this.rows = Math.max(1, Math.ceil(height / CELL_PX));
  }
  private each(b: Box, fn: (key: number) => boolean | void): boolean {
    const cx = (v: number): number => Math.min(this.cols - 1, Math.max(0, Math.floor(v / CELL_PX)));
    const cy = (v: number): number => Math.min(this.rows - 1, Math.max(0, Math.floor(v / CELL_PX)));
    const x1 = cx(b.x + b.w);
    const y1 = cy(b.y + b.h);
    for (let y = cy(b.y); y <= y1; y++) for (let x = cx(b.x); x <= x1; x++) if (fn(y * this.cols + x) === true) return true;
    return false;
  }
  hits(b: Box): boolean {
    return this.each(b, (key) => this.cells.get(key)?.some((o) => overlaps(b, o)) === true);
  }
  add(b: Box): void {
    this.each(b, (key) => {
      const list = this.cells.get(key);
      if (list) list.push(b);
      else this.cells.set(key, [b]);
    });
  }
}

/**
 * 라벨 배치: 후보 차례대로 화면 자리·글 크기·돌림·어림 상자를 정하고, 앞서 놓인 라벨과 겹치면 숨기거나 흐리게 한다.
 * 화면 밖·눈 뒤·너무 작은 세계 크기 글은 놓지 않는다. 놓은 수가 limit에 닿으면 멈춘다.
 */
export function layoutAnnotations(items: readonly AnnotationItem[], cand: readonly number[], f: ViewFrame, o: LayoutOptions = {}): Placement[] {
  const limit = isNum(o.limit) && o.limit >= 0 ? o.limit : LABEL_LIMIT;
  const crowd = o.crowd ?? 'hide';
  const defaultPx = isNum(o.defaultPx) && o.defaultPx > 0 ? o.defaultPx : DEFAULT_LABEL_PX;
  const maxScreen = isNum(o.maxScreenPx) && o.maxScreenPx > 0 ? o.maxScreenPx : MAX_LABEL_PX;
  const W = f.width;
  const H = f.height;
  const out: Placement[] = [];
  const kept = new BoxGrid(W, H);
  for (const i of cand) {
    if (out.length >= limit) break;
    const it = items[i];
    if (!it) continue;
    let x: number;
    let y: number;
    let px = Math.min(it.px ?? defaultPx, maxScreen);
    let align: LabelAlign = 'center';
    let angle = 0;
    if (it.kind === 'screen' || !it.at) {
      if (!it.screen) continue;
      x = it.screen[0] * W;
      y = it.screen[1] * H;
      if (!(x >= -1 && y >= -1 && x <= W + 1 && y <= H + 1)) continue;
      align = 'topLeft';
    } else {
      const s = projectToScreen(f, it.at);
      if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) continue;
      if (s[0] < -1 || s[1] < -1 || s[0] > W + 1 || s[1] > H + 1) continue;
      x = s[0];
      y = s[1];
      if (it.worldHeight) {
        const wpp = worldPerPixel(f, s[2]);
        const size = wpp > 0 ? it.worldHeight / wpp : 0;
        if (!(size >= WORLD_TEXT_MIN_PX)) continue;
        px = Math.min(size, MAX_LABEL_PX);
      }
      if (it.anchor) {
        const a = projectToScreen(f, it.anchor);
        if (a && Number.isFinite(a[0]) && Number.isFinite(a[1])) {
          const dx = x - a[0];
          const dy = y - a[1];
          if (Math.abs(dx) >= 2) {
            align = dx > 0 ? 'right' : 'left';
            x += dx > 0 ? LEADER_GAP_PX : -LEADER_GAP_PX;
          } else if (Math.abs(dy) >= 2) {
            align = dy < 0 ? 'above' : 'below';
            y += dy < 0 ? -LEADER_GAP_PX : LEADER_GAP_PX;
          }
        }
      }
      if (it.dir) {
        const k = worldPerPixel(f, s[2]) * 40;
        const b = k > 0 ? projectToScreen(f, [it.at[0] + it.dir[0] * k, it.at[1] + it.dir[1] * k, it.at[2] + it.dir[2] * k]) : null;
        if (b && Math.hypot(b[0] - x, b[1] - y) > 1e-6) angle = readableAngle(x, y, b[0], b[1]);
      }
    }
    const w0 = it.em[0] * px + PAD_X;
    const h0 = it.em[1] * px + PAD_Y;
    const r = (angle * Math.PI) / 180;
    const w = angle ? Math.abs(w0 * Math.cos(r)) + Math.abs(h0 * Math.sin(r)) : w0;
    const h = angle ? Math.abs(w0 * Math.sin(r)) + Math.abs(h0 * Math.cos(r)) : h0;
    // 돌린 라벨은 가운데 기준(둘레 상자도 가운데)
    const [ox, oy] = alignOffset(angle ? 'center' : align, w, h);
    // 가장자리 안으로(상자가 화면보다 크면 왼쪽·위에 붙인다)
    const left = Math.min(Math.max(x + ox, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, W - EDGE_MARGIN_PX - w));
    const top = Math.min(Math.max(y + oy, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, H - EDGE_MARGIN_PX - h));
    const box = { x: left, y: top, w, h };
    let crowded = false;
    if (crowd !== 'off' && kept.hits(box)) {
      if (crowd === 'hide') continue;
      crowded = true;
    } else kept.add(box);
    out.push({ item: i, x: left - ox, y: top - oy, align: angle ? 'center' : align, angle, px, box, crowded });
  }
  return out;
}

// ───────────────────────── DOM ─────────────────────────

/** 라벨을 얹을 덧그림 층(Overlay의 일부 — 시험에서는 가짜를 넘길 수 있다) */
export type AnnotationHost = Pick<Overlay, 'labels' | 'set' | 'invalidate'>;

/** 정렬별 CSS 이동(transform-origin 0 0 기준) */
const ALIGN_SHIFT: Record<LabelAlign, string> = {
  center: ' translate(-50%, -50%)',
  right: ' translate(0, -50%)',
  left: ' translate(-100%, -50%)',
  above: ' translate(-50%, -100%)',
  below: ' translate(-50%, 0)',
  topLeft: '',
};

/** 요소마다 마지막으로 쓴 값(바뀐 것만 다시 쓴다) */
interface ElState {
  cls: string;
  text: string;
  font: string;
  family: string;
  weight: string;
  style: string;
  color: string;
  transform: string;
  shown: boolean;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * 문자·치수 라벨 덧그림. 만들면 덧그림 층에 'annotations' 그리기 함수를 둔다.
 * 쓰는 차례: new AnnotationLabels(overlay) → setData(문서 글·치수·장면 단위·모형 단위) → setFilter(보기 상태가 바뀔 때마다) → dispose(문서를 닫을 때).
 */
export class AnnotationLabels {
  /** 라벨을 담는 층(overlay.labels 아래 .anno-layer) */
  readonly el: HTMLDivElement;
  private readonly host: AnnotationHost;
  private items: AnnotationItem[] = [];
  private filter: AnnotationFilter = { ...DEFAULT_FILTER };
  private options: LayoutOptions = {};
  private cand: number[] | null = null;
  private pool: HTMLDivElement[] = [];
  private states: ElState[] = [];
  private last: Placement[] = [];
  private disposed = false;
  /** 가림 판정(없으면 가리지 않는다)·형상에 가린 라벨(items 차례)·판정한 카메라 열쇠·기다리는 판정 */
  private occlusion: OcclusionTest | null = null;
  private occluded = new Set<number>();
  private occKey = '';
  private lastKey = '';
  private occTimer: ReturnType<typeof setTimeout> | 0 = 0;
  /** 덧그림 층이 부르는 그리기 함수 */
  readonly painter = (f: ViewFrame): void => this.paint(f);

  constructor(host: AnnotationHost, options: LayoutOptions = {}) {
    this.host = host;
    this.options = { ...options };
    this.el = document.createElement('div');
    this.el.className = 'anno-layer';
    host.labels.append(this.el);
    host.set(ANNOTATIONS_KEY, this.painter);
  }

  /** 문서의 글·치수(meta.texts·meta.dimensions), 장면 좌표 단위(scene.units), 모형 표시 단위 */
  setData(texts: readonly unknown[] | null | undefined, dims: readonly unknown[] | null | undefined, sceneUnits: string | undefined, units: UnitsDisplay = DEFAULT_UNITS): void {
    this.items = [...prepareTexts(texts), ...prepareDimensions(dims, units, mmPerSceneUnit(sceneUnits))];
    this.cand = null;
    this.resetOcclusion();
  }

  /** 보기 상태(주지 않은 칸은 앞의 값). 보이는 형상(태그·노드·단면)이 바뀌므로 가림도 다시 판정한다 */
  setFilter(f: Partial<AnnotationFilter>): void {
    this.filter = { ...this.filter, ...f };
    this.cand = null;
    this.resetOcclusion();
  }

  setOptions(o: LayoutOptions): void {
    this.options = { ...this.options, ...o };
    this.host.invalidate();
  }

  /** 그릴 라벨 수(setData 뒤, 거르기 전) */
  get size(): number {
    return this.items.length;
  }

  /** 마지막 그림의 배치(상태 막대·그림 내보내기·시험용) */
  get placements(): readonly Placement[] {
    return this.last;
  }

  /** 라벨 자료(placements의 item 차례 — 그림 내보내기가 같은 글꼴·색으로 그린다) */
  get itemList(): readonly AnnotationItem[] {
    return this.items;
  }

  /** 가림 판정을 둔다(null이면 끈다). 숨긴 태그·노드·단면이 바뀌면 setFilter가 다시 판정하게 한다 */
  setOcclusion(test: OcclusionTest | null): void {
    this.occlusion = test;
    this.resetOcclusion();
  }

  /** 다음 그림에서 가림을 다시 판정한다(보이는 형상이 바뀌었을 때) */
  resetOcclusion(): void {
    this.occluded.clear();
    this.occKey = '';
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = 0;
    this.host.invalidate();
  }

  /** 형상에 가려 숨긴 라벨 수(마지막 판정) */
  get occludedCount(): number {
    return this.occluded.size;
  }

  /** 카메라가 멈췄으면 그 프레임으로 가림을 판정해 두고 다시 그린다 */
  private scheduleOcclusion(f: ViewFrame, key: string): void {
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = setTimeout(() => {
      this.occTimer = 0;
      if (this.disposed || !this.occlusion || this.lastKey !== key) return;
      this.occluded = this.computeOcclusion(f);
      this.occKey = key;
      this.host.invalidate();
    }, OCCLUSION_SETTLE_MS);
  }

  /** 후보 라벨의 기준점마다 가림 판정(화면 안·눈 앞만, OCCLUSION_LIMIT개까지) */
  private computeOcclusion(f: ViewFrame): Set<number> {
    const out = new Set<number>();
    const test = this.occlusion;
    if (!test || !this.cand) return out;
    let n = 0;
    for (const i of this.cand) {
      const it = this.items[i];
      const p = it ? (it.anchor ?? it.at) : null;
      if (!it || !p || it.kind === 'screen') continue;
      const s = projectToScreen(f, p);
      if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1]) || s[0] < 0 || s[1] < 0 || s[0] > f.width || s[1] > f.height) continue;
      if (++n > OCCLUSION_LIMIT) break;
      try {
        if (test(p, s[0], s[1], f)) out.add(i);
      } catch {
        /* 판정을 못 하면 보인다 */
      }
    }
    return out;
  }

  /** 지금 프레임으로 그린다(덧그림 층이 부른다) */
  paint(f: ViewFrame): void {
    if (this.disposed) return;
    if (!this.cand) this.cand = annotationCandidates(this.items, this.filter);
    let cand = this.cand;
    if (this.occlusion && cand.length) {
      const key = frameKey(f);
      this.lastKey = key;
      if (key !== this.occKey) this.scheduleOcclusion(f, key);
      if (this.occluded.size) cand = cand.filter((i) => !this.occluded.has(i));
    }
    const list = cand.length ? layoutAnnotations(this.items, cand, f, this.options) : [];
    this.last = list;
    list.forEach((p, k) => this.write(k, p, this.items[p.item]!));
    for (let k = list.length; k < this.pool.length; k++) {
      const st = this.states[k]!;
      if (st.shown) {
        this.pool[k]!.style.display = 'none';
        st.shown = false;
      }
    }
  }

  private element(k: number): [HTMLDivElement, ElState] {
    let el = this.pool[k];
    if (!el) {
      el = document.createElement('div');
      const s = el.style;
      // 자리 잡기에 꼭 필요한 것만 직접 둔다(모양은 CSS .anno-label)
      s.position = 'absolute';
      s.left = '0';
      s.top = '0';
      s.transformOrigin = '0 0';
      s.whiteSpace = 'pre';
      s.pointerEvents = 'none';
      s.display = 'none';
      this.el.append(el);
      this.pool[k] = el;
      this.states[k] = { cls: '', text: '', font: '', family: '', weight: '', style: '', color: '', transform: '', shown: false };
    }
    return [el, this.states[k]!];
  }

  private write(k: number, p: Placement, it: AnnotationItem): void {
    const [el, st] = this.element(k);
    const s = el.style;
    const cls = `anno-label anno-${it.kind}${it.light ? ' is-light' : ''}${p.crowded ? ' is-crowded' : ''}`;
    if (st.cls !== cls) el.className = st.cls = cls;
    if (st.text !== it.text) el.textContent = st.text = it.text;
    const font = `${r1(p.px)}px`;
    if (st.font !== font) s.fontSize = st.font = font;
    if (st.family !== it.family) s.fontFamily = st.family = it.family;
    const weight = it.bold ? '700' : '';
    if (st.weight !== weight) s.fontWeight = st.weight = weight;
    const style = it.italic ? 'italic' : '';
    if (st.style !== style) s.fontStyle = st.style = style;
    if (st.color !== it.color) s.color = st.color = it.color;
    const transform = `translate(${r1(p.x)}px, ${r1(p.y)}px)${p.angle ? ` rotate(${r1(p.angle)}deg)` : ''}${ALIGN_SHIFT[p.align]}`;
    if (st.transform !== transform) s.transform = st.transform = transform;
    if (!st.shown) {
      s.display = '';
      st.shown = true;
    }
  }

  /** 덧그림 층에서 빼고 요소를 지운다 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = 0;
    this.host.set(ANNOTATIONS_KEY, null);
    this.el.remove();
    this.pool = [];
    this.states = [];
    this.items = [];
    this.last = [];
  }
}
