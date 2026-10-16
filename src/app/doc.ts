/**
 * 열린 SketchUp 문서의 상태와 패널 목록 만들기(순수 함수, DOM 없음).
 * 해석기가 scene.meta에 적은 것(판·단위·통계·tagStats·materialStats·outline)을 안전하게 읽어 화면용 꼴로 바꾼다.
 * meta가 비었거나 옛 꼴이어도 장면(그물 이름·묶음)에서 최소한의 목록을 만든다.
 */
import type { MeasureResult, Pick3d, Scene3d } from 'opencad-viewer3d';
import type { ParseResult } from './protocol';

export type PanelTab = 'tags' | 'outline' | 'info';

export interface SkpInfo {
  /** "26.1.194" */
  version: string | null;
  major: number | null;
  container: 'zip' | 'mfc' | null;
  /** 모형의 표시 길이 단위(mm·cm·m·ft·inch) */
  lengthUnit: string | null;
  definitions: number | null;
  instances: number | null;
  faces: number | null;
  edges: number | null;
  materials: number | null;
  tags: number | null;
  triangles: number | null;
  segments: number | null;
}

export interface TagRow {
  name: string;
  default: boolean;
  /** 펼친 뒤 그린 면 수(모르면 null) */
  faces: number | null;
  edges: number | null;
  /** 장면에 이 태그의 그물·모서리가 있는지(없으면 켜고 끌 것이 없다) */
  hasGeometry: boolean;
}

export interface MaterialRow {
  name: string;
  color: [number, number, number, number];
  textured: boolean;
  faces: number | null;
  meshIds: string[];
}

export interface OutlineRow {
  index: number;
  name: string;
  kind: 'group' | 'component' | 'loose';
  definition: string | null;
  tag: string;
  faces: number;
  edges: number;
  ids: string[];
}

export type Selection =
  | { kind: 'outline'; index: number }
  | { kind: 'material'; name: string }
  | { kind: 'item'; id: string };

export interface SkpDoc {
  readonly id: number;
  name: string;
  size: number;
  scene: Scene3d;
  /** 해석 시간(ms) */
  ms: number;
  info: SkpInfo;
  tags: TagRow[];
  materials: MaterialRow[];
  outline: OutlineRow[];
  /** 윗단계 인스턴스가 너무 많아 하나씩 고르기를 끈 경우 그 수(아니면 0) */
  outlineSkipped: number;
  /** 항목 id → outline 차례 */
  itemOutline: Map<string, number>;
  /** 그물 id → 재질 이름 */
  meshMaterial: Map<string, string>;
  // ── 보기 상태 ──
  hiddenTags: Set<string>;
  /** 숨긴 outline 차례 */
  hiddenOutline: Set<number>;
  selection: Selection | null;
  pick: Pick3d | null;
  measure: MeasureResult | null;
  panelTab: PanelTab;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function meta(scene: Scene3d): Record<string, unknown> {
  return scene.meta && typeof scene.meta === 'object' ? scene.meta : {};
}

/** 판 문자열의 주 번호("26.1.194" → 26) */
export function majorOf(version: string | null | undefined): number | null {
  const m = /^(\d+)\./.exec(version ?? '');
  return m ? Number(m[1]) : null;
}

/** 판 → 제품 이름("26.1.194" → "SketchUp 2026", "8.0.1" → "SketchUp 8") */
export function releaseName(version: string | null | undefined): string {
  const major = majorOf(version);
  if (major === null) return 'SketchUp';
  return major >= 13 ? `SketchUp 20${String(major).padStart(2, '0')}` : `SketchUp ${major}`;
}

/** meta → 정보 */
export function readInfo(scene: Scene3d): SkpInfo {
  const m = meta(scene);
  const version = str(m.version);
  const container = m.container === 'zip' || m.container === 'mfc' ? m.container : null;
  return {
    version,
    major: majorOf(version),
    container,
    lengthUnit: str(m.lengthUnit),
    definitions: num(m.definitions),
    instances: num(m.instances),
    faces: num(m.faces),
    edges: num(m.edges),
    materials: num(m.materials),
    tags: Array.isArray(m.tags) ? m.tags.length : null,
    triangles: num(m.triangles),
    segments: num(m.segments),
  };
}

/** 아직 읽지 못하는 옛 판(2020 이하)이면 판 문자열, 아니면 null */
export function unsupportedVersion(scene: Scene3d): string | null {
  const info = readInfo(scene);
  if (info.container === 'mfc' || (info.major !== null && info.major < 21)) return info.version ?? '알 수 없음';
  return null;
}

/** 장면 단위 → 글 */
export function unitLabel(u: Scene3d['units']): string {
  return u === 'mm' ? 'mm' : u === 'inch' ? 'in' : u === 'm' ? 'm' : '';
}

/** 단위 요약: 모형 표시 단위와 좌표 단위가 다르면 함께("cm · 좌표 mm") */
export function unitSummary(info: SkpInfo, units: Scene3d['units']): string {
  const coord = unitLabel(units);
  const model = info.lengthUnit === 'inch' ? 'in' : info.lengthUnit;
  if (model && coord && model !== coord) return `${model} · 좌표 ${coord}`;
  return model || coord || '모름';
}

/** 형식 설명("SketchUp 2026 · 26.1.194") */
export function docLabel(info: SkpInfo): string {
  return info.version ? `${releaseName(info.version)} · ${info.version}` : 'SketchUp';
}

/** 장면 크기 요약 */
export function sceneCounts(s: Scene3d): { triangles: number; segments: number } {
  let triangles = 0;
  let segments = 0;
  for (const m of s.meshes) triangles += (m.indices ? m.indices.length : m.positions.length / 3) / 3;
  for (const l of s.lines) segments += l.positions.length / 6;
  return { triangles: Math.round(triangles), segments: Math.round(segments) };
}

/** 장면의 묶음(태그) 이름들 — 처음 나온 차례 */
function sceneGroups(s: Scene3d): Set<string> {
  const out = new Set<string>();
  for (const m of s.meshes) if (m.group !== undefined) out.add(m.group);
  for (const l of s.lines) if (l.group !== undefined) out.add(l.group);
  return out;
}

/** 태그 목록: meta.tagStats(모형 차례) — 없으면 장면 묶음에서 */
export function tagRows(scene: Scene3d): TagRow[] {
  const groups = sceneGroups(scene);
  const stats = meta(scene).tagStats;
  const rows: TagRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(stats))
    for (const t of stats) {
      if (!t || typeof t !== 'object') continue;
      const o = t as Record<string, unknown>;
      const name = str(o.name);
      if (name === null || seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, default: o.default === true, faces: num(o.faces), edges: num(o.edges), hasGeometry: groups.has(name) });
    }
  for (const g of groups) if (!seen.has(g)) rows.push({ name: g, default: false, faces: null, edges: null, hasGeometry: true });
  return rows;
}

/** 재질 목록: meta.materialStats — 없으면 그물 이름("재질 · 태그")에서. 많이 쓴 차례 */
export function materialRows(scene: Scene3d): MaterialRow[] {
  const stats = meta(scene).materialStats;
  const ids = new Set(scene.meshes.map((m) => m.id));
  const rows: MaterialRow[] = [];
  if (Array.isArray(stats)) {
    for (const x of stats) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const name = str(o.name);
      if (name === null) continue;
      const c = Array.isArray(o.color) ? o.color : [];
      const color: [number, number, number, number] = [num(c[0]) ?? 0.8, num(c[1]) ?? 0.8, num(c[2]) ?? 0.8, num(c[3]) ?? 1];
      const meshIds = Array.isArray(o.meshIds) ? o.meshIds.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
      rows.push({ name, color, textured: o.textured === true, faces: num(o.faces), meshIds });
    }
  } else {
    const map = new Map<string, MaterialRow>();
    for (const m of scene.meshes) {
      const name = (m.name ?? '').split(' · ')[0] || '기본 재질';
      let r = map.get(name);
      if (!r) map.set(name, (r = { name, color: [m.color[0], m.color[1], m.color[2], m.color[3]], textured: false, faces: null, meshIds: [] }));
      r.meshIds.push(m.id);
    }
    rows.push(...map.values());
  }
  return rows.sort((a, b) => (b.faces ?? 0) - (a.faces ?? 0) || a.name.localeCompare(b.name, 'ko'));
}

/** 윗단계 그룹·컴포넌트 목록(meta.outline) */
export function outlineRows(scene: Scene3d): OutlineRow[] {
  const list = meta(scene).outline;
  if (!Array.isArray(list)) return [];
  const known = new Set<string>([...scene.meshes.map((m) => m.id), ...scene.lines.map((l) => l.id)]);
  const rows: OutlineRow[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const kind = o.kind === 'group' || o.kind === 'component' || o.kind === 'loose' ? o.kind : 'component';
    const ids = Array.isArray(o.ids) ? o.ids.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
    rows.push({
      index: rows.length,
      name: str(o.name) || '(이름 없음)',
      kind,
      definition: str(o.definition),
      tag: str(o.tag) ?? '',
      faces: num(o.faces) ?? 0,
      edges: num(o.edges) ?? 0,
      ids,
    });
  }
  return rows;
}

/** 윗단계 컴포넌트를 정의별로 센다(많은 차례) */
export function definitionCounts(rows: readonly OutlineRow[]): { name: string; kind: OutlineRow['kind']; count: number }[] {
  const map = new Map<string, { name: string; kind: OutlineRow['kind']; count: number }>();
  for (const r of rows) {
    if (r.kind === 'loose' || !r.definition) continue;
    const key = `${r.kind}:${r.definition}`;
    const e = map.get(key);
    if (e) e.count++;
    else map.set(key, { name: r.definition, kind: r.kind, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

export const KIND_LABEL: Record<OutlineRow['kind'], string> = { group: '그룹', component: '컴포넌트', loose: '형상' };

let serial = 0;

export function createDoc(name: string, size: number, res: ParseResult): SkpDoc {
  const scene = res.scene;
  const outline = outlineRows(scene);
  const materials = materialRows(scene);
  const itemOutline = new Map<string, number>();
  for (const r of outline) for (const id of r.ids) itemOutline.set(id, r.index);
  const meshMaterial = new Map<string, string>();
  for (const m of materials) for (const id of m.meshIds) meshMaterial.set(id, m.name);
  const skipped = num(meta(scene).outlineSkipped) ?? 0;
  return {
    id: ++serial,
    name,
    size,
    scene,
    ms: res.ms,
    info: readInfo(scene),
    tags: tagRows(scene),
    materials,
    outline,
    outlineSkipped: skipped,
    itemOutline,
    meshMaterial,
    hiddenTags: new Set(),
    hiddenOutline: new Set(),
    selection: null,
    pick: null,
    measure: null,
    panelTab: 'tags',
  };
}

/** 패널 탭 목록 */
export function panelTabs(d: SkpDoc): [PanelTab, string][] {
  const tabs: [PanelTab, string][] = [['tags', '태그·재질']];
  if (d.outline.length || d.outlineSkipped) tabs.push(['outline', '구성']);
  tabs.push(['info', '정보']);
  return tabs;
}

/** 고르기 결과 → 고른 것(윗단계 항목에 들어 있으면 그 항목 전체) */
export function selectionForPick(d: SkpDoc, p: Pick3d | null): Selection | null {
  if (!p) return null;
  const i = d.itemOutline.get(p.id);
  if (i !== undefined) return { kind: 'outline', index: i };
  return { kind: 'item', id: p.id };
}

/** 고른 것 → 강조할 항목 id */
export function selectionIds(d: SkpDoc, sel: Selection | null): string[] {
  if (!sel) return [];
  if (sel.kind === 'outline') return d.outline[sel.index]?.ids ?? [];
  if (sel.kind === 'material') return d.materials.find((m) => m.name === sel.name)?.meshIds ?? [];
  return [sel.id];
}

/** 고른 것 한 줄 설명(상태 막대·패널 아래) */
export function selectionText(d: SkpDoc, sel: Selection | null, pick: Pick3d | null = null): string {
  if (!sel) return '';
  const pickedMat = pick && pick.kind === 'mesh' ? d.meshMaterial.get(pick.id) : undefined;
  if (sel.kind === 'outline') {
    const r = d.outline[sel.index];
    if (!r) return '';
    const parts = [`${KIND_LABEL[r.kind]} ${r.name}${r.definition && r.definition !== r.name ? ` (${r.definition})` : ''}`];
    if (r.kind !== 'loose' && r.tag) parts.push(`태그 ${r.tag}`);
    if (pickedMat) parts.push(`재질 ${pickedMat}`);
    parts.push(`면 ${r.faces.toLocaleString('ko-KR')}`);
    return parts.join(' · ');
  }
  if (sel.kind === 'material') {
    const m = d.materials.find((x) => x.name === sel.name);
    return m ? `재질 ${m.name}${m.faces !== null ? ` · 면 ${m.faces.toLocaleString('ko-KR')}` : ''}` : '';
  }
  const mesh = d.scene.meshes.find((m) => m.id === sel.id);
  const line = mesh ? undefined : d.scene.lines.find((l) => l.id === sel.id);
  const item = mesh ?? line;
  if (!item) return sel.id;
  return `${item.name ?? item.id}`;
}

/** 범위 크기(x, y, z) */
export function boundsSize(s: Scene3d): [number, number, number] | null {
  const b = s.bounds;
  if (!b) return null;
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}
