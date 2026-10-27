/**
 * 치수·지시선 끝 표시를 화면 크기로(덧그림 층 SVG 'anno-marks'): 해석기는 치수선·연장선·지시선만 장면 선분으로 내고,
 * 끝 표시(빗금·점·열린·닫힌 화살)와 연장선 넘침은 자리·방향만 meta.annotationMarks로 넘긴다(scene-annotations.ts linearLines).
 * 여기서 매 화면 같은 화소 크기(SketchUp과 비공개 참조 뷰어처럼 표시 9화소, 넘침은 그 0.6)로 그려, 확대·축소해도 너무 크거나 작아지지 않는다.
 *
 * - 크기: 표시가 붙은 선의 화면 길이 × 0.15와 MARK_PX 가운데 작은 것(짧게 보이는 치수는 표시도 작게 — 옛 장면 선분의 길이 × 0.15 규칙과 같다).
 *   MIN_MARK_PX보다 작으면 그리지 않는다.
 * - 모양은 화면 평면에서 만든다: 화살은 끝점에서 선 쪽으로 ±20° 날개(닫힌 화살은 채운 삼각형), 빗금은 선과 45°("/" — 모든 빗금이 치수 평면의
 *   같은 쪽으로 기운다), 점은 채운 원, 넘침은 연장선 방향으로 짧은 선.
 * - 보이기: 그 선분 묶음이 보일 때만(부른 쪽 판정 — 태그·숨김·주석 종류 켜고 끄기·숨긴 그룹), 표시가 놓인 노드가 숨지 않았을 때,
 *   단면에 잘린 쪽이 아닐 때(코어처럼 그 묶음을 자르는 단면만), 화면 안일 때. 색은 그 묶음이 지금 띠는 색(선 색 대비로 바꾼 색 포함).
 * - 가림: 형상 뒤의 치수선은 코어가 깊이로 가리지만 덧그림은 늘 위라, 카메라가 OCCLUSION_SETTLE_MS 멈추면 표시 자리마다 라벨과 같은
 *   가림 판정을 해 형상에 가린 표시를 숨긴다(움직이는 동안은 앞의 판정, 한 번에 OCCLUSION_LIMIT개).
 * - 그림 저장: 덧그림 SVG에 있으므로 exporter가 함께 합친다(글·치수 넣기를 끄어도 이 묶음은 넣는다 — 치수선은 그림에 있으므로).
 */
import { projectToScreen, worldPerPixel, type ViewFrame } from 'opencad-viewer3d/camera';
import type { SkpAnnotationMarks } from '../meta';
import { OCCLUSION_LIMIT, OCCLUSION_SETTLE_MS, frameKey, type OcclusionTest } from './annotations';
import { svgEl, type Overlay } from './overlay';

/** 덧그림 층 열쇠 */
export const MARKS_KEY = 'annotation-marks';
/** 끝 표시 크기(화소) — 화살 길이는 1.1배 */
export const MARK_PX = 9;
/** 이보다 작으면 그리지 않는다(화소) */
export const MIN_MARK_PX = 1.5;
/** 연장선 넘침 = 표시 크기 × 이 값(MARK_PX면 약 5.4화소) */
export const OVERSHOOT_RATIO = 0.6;
/** 짧은 선: 표시 크기 상한 = 선의 화면 길이 × 이 값 */
export const SPAN_RATIO = 0.15;
/** 한 화면에 그리는 표시 수 상한 */
export const MARK_LIMIT = 20000;

/** 꼴 번호(meta.annotationMarks.kind — scene-annotations.ts MARK_KIND·MARK_OVERSHOOT와 같다) */
export const KIND_SLASH = 1;
export const KIND_DOT = 2;
export const KIND_CLOSED = 3;
export const KIND_OPEN = 4;
export const KIND_OVERSHOOT = 5;

/** 표시를 그릴지 정하는 보기 상태(부른 쪽이 문서 상태로 답한다) */
export interface MarkVisibility {
  /** 선분 묶음이 지금 보이는지(태그·숨김·주석 종류·숨긴 그룹) */
  lineVisible: (id: string) => boolean;
  /** 나무 노드(−1 = 모형 바로 아래)가 보기에서 숨었는지 — 그 안 표시를 숨긴다 */
  nodeHidden: (node: number) => boolean;
  /** 그 묶음이 지금 띠는 CSS 색 */
  color: (id: string) => string;
  /** 점선 묶음(숨긴 주석)인지 — 흐리게 */
  faint?: (id: string) => boolean;
  /** 켜진 단면들(코어 꼴: normal·p > offset 쪽이 잘린다, items가 있으면 그 묶음만 자른다) */
  sections: readonly { normal: readonly number[]; offset: number; items?: readonly string[] | null }[];
}

/** 화면 표시 하나(그리기 준비) */
export interface ScreenMark {
  kind: number;
  /** 끝점(화면) */
  x: number;
  y: number;
  /** 바깥 방향(화면 단위) */
  dx: number;
  dy: number;
  /** 표시 기울 쪽(화면 단위, dx·dy에 수직) */
  nx: number;
  ny: number;
  /** 크기(화소) */
  size: number;
}

/**
 * 세계 표시 → 화면 표시(눈 뒤·화면 밖·방향이 화면에 비치지 않으면 null). p·dir·perp는 meta 꼴, span은 선의 세계 길이
 */
export function screenMark(f: ViewFrame, kind: number, p: readonly number[], dir: readonly number[], perp: readonly number[], span: number, margin = 24): ScreenMark | null {
  const s = projectToScreen(f, p);
  if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) return null;
  if (f.projection === 'perspective' && !(s[2] > f.near * 0.5)) return null;
  if (s[0] < -margin || s[1] < -margin || s[0] > f.width + margin || s[1] > f.height + margin) return null;
  const wpp = worldPerPixel(f, Math.max(s[2], 0)) || 1;
  const k = wpp * 16;
  const q = projectToScreen(f, [p[0]! + dir[0]! * k, p[1]! + dir[1]! * k, p[2]! + dir[2]! * k]);
  if (!q) return null;
  let dx = q[0] - s[0];
  let dy = q[1] - s[1];
  const dl = Math.hypot(dx, dy);
  // 선이 눈 쪽을 향하면(화면에 거의 점) 끝 표시가 뜻이 없다
  if (!(dl > 1e-3 * 16)) return null;
  dx /= dl;
  dy /= dl;
  // 기울 쪽: 치수 평면의 수직을 화면에 비춘 쪽(화면에서 선에 수직인 두 쪽 가운데)
  let nx = -dy;
  let ny = dx;
  const r = projectToScreen(f, [p[0]! + perp[0]! * k, p[1]! + perp[1]! * k, p[2]! + perp[2]! * k]);
  if (r && (r[0] - s[0]) * nx + (r[1] - s[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  // 선의 화면 길이(다른 끝은 표시에서 선 안쪽으로 span) — 짧게 보이는 선은 표시도 작게
  const o = projectToScreen(f, [p[0]! - dir[0]! * span, p[1]! - dir[1]! * span, p[2]! - dir[2]! * span]);
  const spanPx = o && Number.isFinite(o[0]) && Number.isFinite(o[1]) ? Math.hypot(o[0] - s[0], o[1] - s[1]) : Infinity;
  const size = Math.min(MARK_PX, spanPx * SPAN_RATIO);
  if (!(size >= MIN_MARK_PX)) return null;
  return { kind, x: s[0], y: s[1], dx, dy, nx, ny, size };
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** 화면 표시 → SVG 경로 조각: 선(stroke)과 채움(fill) */
export function markPath(m: ScreenMark): { stroke: string; fill: string } {
  const { x, y, dx, dy, nx, ny, size } = m;
  if (m.kind === KIND_OVERSHOOT) {
    const l = size * OVERSHOOT_RATIO;
    return { stroke: `M${f1(x)} ${f1(y)}L${f1(x + dx * l)} ${f1(y + dy * l)}`, fill: '' };
  }
  if (m.kind === KIND_SLASH) {
    // 선과 45°: 바깥 방향 + 기울 쪽
    const h = (size / 2) * Math.SQRT1_2;
    const sx = (dx + nx) * h;
    const sy = (dy + ny) * h;
    return { stroke: `M${f1(x - sx)} ${f1(y - sy)}L${f1(x + sx)} ${f1(y + sy)}`, fill: '' };
  }
  if (m.kind === KIND_DOT) {
    const r = Math.max(1.5, size * 0.25);
    return { stroke: '', fill: `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z` };
  }
  // 화살: 끝점에서 선 쪽(−바깥)으로 ±20° 날개
  const c = Math.cos((20 * Math.PI) / 180);
  const s = Math.sin((20 * Math.PI) / 180);
  const l = size * 1.1;
  const ax = x + (-dx * c + nx * s) * l;
  const ay = y + (-dy * c + ny * s) * l;
  const bx = x + (-dx * c - nx * s) * l;
  const by = y + (-dy * c - ny * s) * l;
  if (m.kind === KIND_CLOSED) return { stroke: '', fill: `M${f1(x)} ${f1(y)}L${f1(ax)} ${f1(ay)}L${f1(bx)} ${f1(by)}Z` };
  return { stroke: `M${f1(ax)} ${f1(ay)}L${f1(x)} ${f1(y)}L${f1(bx)} ${f1(by)}`, fill: '' };
}

/** 표시를 얹을 덧그림 층(시험에서는 가짜) */
export type MarksHost = Pick<Overlay, 'svg' | 'set' | 'invalidate'>;

interface Entry {
  id: string;
  m: SkpAnnotationMarks;
}

/**
 * 끝 표시 덧그림. 쓰는 차례: new AnnotationMarks(overlay) → setData(meta.annotationMarks) → setVisibility(보기 상태가 바뀔 때마다)
 * → setOcclusion(라벨과 같은 가림 판정) → dispose(문서를 닫을 때)
 */
export class AnnotationMarks {
  readonly g: SVGGElement;
  private readonly host: MarksHost;
  private entries: Entry[] = [];
  private vis: MarkVisibility | null = null;
  private occlusion: OcclusionTest | null = null;
  /** 형상에 가린 표시(묶음 차례 · 표시 차례) */
  private occluded = new Set<string>();
  private occKey = '';
  private lastKey = '';
  private occTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private drawn = 0;
  private disposed = false;
  readonly painter = (f: ViewFrame): void => this.paint(f);

  constructor(host: MarksHost) {
    this.host = host;
    this.g = svgEl('g', { class: 'anno-marks' });
    host.svg.prepend(this.g);
    host.set(MARKS_KEY, this.painter);
  }

  /** meta.annotationMarks(없으면 비움) */
  setData(marks: Record<string, SkpAnnotationMarks> | null | undefined): void {
    this.entries = [];
    for (const [id, m] of Object.entries(marks ?? {})) {
      const n = m?.kind?.length ?? 0;
      if (n && m.geom?.length >= n * 9 && m.span?.length >= n && m.node?.length >= n) this.entries.push({ id, m });
    }
    this.resetOcclusion();
  }

  /** 보기 상태(태그·숨김·단면·색이 바뀔 때마다) — 가림도 다시 판정한다 */
  setVisibility(v: MarkVisibility | null): void {
    this.vis = v;
    this.resetOcclusion();
  }

  setOcclusion(test: OcclusionTest | null): void {
    this.occlusion = test;
    this.resetOcclusion();
  }

  /** 표시 수(데이터) */
  get size(): number {
    let n = 0;
    for (const e of this.entries) n += e.m.kind.length;
    return n;
  }

  /** 마지막 그림에서 그린 표시 수 */
  get drawnCount(): number {
    return this.drawn;
  }

  /** 형상에 가려 숨긴 표시 수(마지막 판정) */
  get occludedCount(): number {
    return this.occluded.size;
  }

  resetOcclusion(): void {
    this.occluded.clear();
    this.occKey = '';
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = 0;
    this.host.invalidate();
  }

  /** 지금 보기에서 그릴 표시(묶음 차례, 표시 차례, 세계 끝점, 화면 표시) */
  private *visibleMarks(f: ViewFrame): Generator<{ key: string; id: string; p: [number, number, number]; s: ScreenMark }> {
    const v = this.vis;
    if (!v) return;
    let n = 0;
    const nodeMemo = new Map<number, boolean>();
    for (let e = 0; e < this.entries.length; e++) {
      const { id, m } = this.entries[e]!;
      if (!v.lineVisible(id)) continue;
      const cuts = v.sections.filter((s) => !s.items || s.items.includes(id));
      for (let i = 0; i < m.kind.length; i++) {
        const node = m.node[i]!;
        let hid = nodeMemo.get(node);
        if (hid === undefined) nodeMemo.set(node, (hid = v.nodeHidden(node)));
        if (hid) continue;
        const g = m.geom;
        const p: [number, number, number] = [g[i * 9]!, g[i * 9 + 1]!, g[i * 9 + 2]!];
        if (cuts.some((c) => c.normal[0]! * p[0] + c.normal[1]! * p[1] + c.normal[2]! * p[2] > c.offset + 1e-9 * (Math.abs(c.offset) + 1))) continue;
        const s = screenMark(f, m.kind[i]!, p, [g[i * 9 + 3]!, g[i * 9 + 4]!, g[i * 9 + 5]!], [g[i * 9 + 6]!, g[i * 9 + 7]!, g[i * 9 + 8]!], m.span[i]!);
        if (!s) continue;
        if (++n > MARK_LIMIT) return;
        yield { key: `${e}:${i}`, id, p, s };
      }
    }
  }

  private scheduleOcclusion(f: ViewFrame, key: string): void {
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = setTimeout(() => {
      this.occTimer = 0;
      if (this.disposed || !this.occlusion || this.lastKey !== key) return;
      const out = new Set<string>();
      let n = 0;
      for (const { key: k, p, s } of this.visibleMarks(f)) {
        if (s.x < 0 || s.y < 0 || s.x > f.width || s.y > f.height) continue;
        if (++n > OCCLUSION_LIMIT) break;
        try {
          if (this.occlusion(p, s.x, s.y, f)) out.add(k);
        } catch {
          /* 판정을 못 하면 보인다 */
        }
      }
      this.occluded = out;
      this.occKey = key;
      this.host.invalidate();
    }, OCCLUSION_SETTLE_MS);
  }

  paint(f: ViewFrame): void {
    if (this.disposed) return;
    if (this.g.parentNode !== this.host.svg) this.host.svg.prepend(this.g);
    if (!this.entries.length || !this.vis) {
      if (this.g.firstChild) this.g.replaceChildren();
      this.drawn = 0;
      return;
    }
    if (this.occlusion) {
      const key = frameKey(f);
      this.lastKey = key;
      if (key !== this.occKey) this.scheduleOcclusion(f, key);
    }
    // 같은 색·흐림끼리 경로 하나(선)·하나(채움)로
    const groups = new Map<string, { color: string; faint: boolean; stroke: string[]; fill: string[] }>();
    let drawn = 0;
    for (const { key, id, s } of this.visibleMarks(f)) {
      if (this.occluded.has(key)) continue;
      const color = this.vis.color(id);
      const faint = !!this.vis.faint?.(id);
      const gk = `${color}|${faint ? 1 : 0}`;
      let gr = groups.get(gk);
      if (!gr) groups.set(gk, (gr = { color, faint, stroke: [], fill: [] }));
      const d = markPath(s);
      if (d.stroke) gr.stroke.push(d.stroke);
      if (d.fill) gr.fill.push(d.fill);
      drawn++;
    }
    this.drawn = drawn;
    const els: SVGElement[] = [];
    for (const gr of groups.values()) {
      const op: Record<string, number> = gr.faint ? { opacity: 0.6 } : {};
      if (gr.stroke.length) els.push(svgEl('path', { d: gr.stroke.join(''), fill: 'none', stroke: gr.color, 'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...op }));
      if (gr.fill.length) els.push(svgEl('path', { d: gr.fill.join(''), fill: gr.color, stroke: gr.color, 'stroke-width': 0.75, 'stroke-linejoin': 'round', ...op }));
    }
    this.g.replaceChildren(...els);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.occTimer) clearTimeout(this.occTimer);
    this.occTimer = 0;
    this.host.set(MARKS_KEY, null);
    this.g.remove();
    this.entries = [];
  }
}
