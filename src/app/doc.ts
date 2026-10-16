/**
 * 열린 SketchUp 문서의 상태와 패널 목록 만들기(순수 함수, DOM 없음).
 * 해석기가 scene.meta에 적은 것(판·단위·통계·tagStats·materialStats·outline·tree·extraItems)을 안전하게 읽어 화면용 꼴로 바꾼다.
 * meta가 비었거나 옛 꼴이어도 장면(그물 이름·묶음)에서 최소한의 목록을 만든다.
 */
import type { IndexRange, MeasureResult, Pick3d, Scene3d } from 'opencad-viewer3d';
import type { SkpImages } from '../images';
import type { ParseResult } from './protocol';
import {
  deepestNodeAt,
  hiddenByNodes,
  isSplit,
  levelNode,
  mergeNodeRanges,
  nodeDefinition,
  nodeItemIds,
  nodeName,
  nodePath,
  nodeRanges,
  nodeSegments,
  nodeTag,
  readTree,
  type PickMode,
  type SegmentSet,
  type TreeView,
} from './tree';

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
  /** model.dat의 재질 이름(= 꾸러미의 materials/<폴더>) — 무늬 그림 찾기용 */
  folder: string | null;
  color: [number, number, number, number];
  textured: boolean;
  faces: number | null;
  meshIds: string[];
}

export interface OutlineRow {
  index: number;
  /** meta.tree의 노드(바로 놓인 형상·옛 장면은 null) */
  node: number | null;
  name: string;
  kind: 'group' | 'component' | 'loose';
  definition: string | null;
  tag: string;
  faces: number;
  edges: number;
  ids: string[];
}

/** 고른 것: outline = 윗단계 항목(바로 놓인 형상 포함), node = 나무의 더 깊은 노드, material = 재질, item = 그물·선 하나 */
export type Selection =
  | { kind: 'outline'; index: number }
  | { kind: 'node'; index: number }
  | { kind: 'material'; name: string }
  | { kind: 'item'; id: string };

/** 부드러운·숨긴 형상(해석기 extras) */
export interface DocExtras {
  soft: Set<string>;
  hidden: Set<string>;
  softSegments: number;
  hiddenFaces: number;
  hiddenSegments: number;
}

/** 꾸러미 안 그림의 Blob 주소 */
export interface DocImages {
  model: { name: string; url: string } | null;
  /** 재질 폴더 → 무늬 그림 */
  materials: Map<string, { name: string; url: string }>;
  /** 컴포넌트 미리보기(파일 이름 = 정의 이름으로 보임) */
  components: Map<string, string>;
  scenes: { name: string; url: string }[];
  skipped: number;
  /** 문서를 닫을 때 풀 주소들 */
  urls: string[];
}

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
  /** 여러 단계 나무(meta.tree, 없으면 null — 윗단계 목록만) */
  tree: TreeView | null;
  /** 윗단계 나무 노드 → outline 차례 */
  nodeOutline: Map<number, number>;
  /** 부드러운·숨긴 형상 항목(없으면 null) */
  extras: DocExtras | null;
  /** 꾸러미 안 그림(없으면 null) */
  images: DocImages | null;
  /** 파일이 잘렸거나 깨져 일부만 읽었는지(meta.damaged) · 출력 한도에 걸렸는지(meta.limited) */
  damaged: boolean;
  limited: boolean;
  // ── 보기 상태 ──
  hiddenTags: Set<string>;
  /** 숨긴 outline 차례 */
  hiddenOutline: Set<number>;
  /** 숨긴 나무 노드 */
  hiddenNodes: Set<number>;
  /** 펼친 나무 노드(3D 고르기 단계도 이것을 따른다) */
  expanded: Set<number>;
  /** 노드마다 보일 자식 수(아주 많을 때 "더 보기") */
  childLimit: Map<number, number>;
  /** 3D 고르기 방식: open = 펼친 단계, deepest = 가장 안쪽 */
  pickMode: PickMode;
  showSoft: boolean;
  showHidden: boolean;
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
      rows.push({ name, folder: str(o.folder), color, textured: o.textured === true, faces: num(o.faces), meshIds });
    }
  } else {
    const map = new Map<string, MaterialRow>();
    for (const m of scene.meshes) {
      const name = (m.name ?? '').split(' · ')[0] || '기본 재질';
      let r = map.get(name);
      if (!r) map.set(name, (r = { name, folder: null, color: [m.color[0], m.color[1], m.color[2], m.color[3]], textured: false, faces: null, meshIds: [] }));
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
      node: num(o.node),
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

/** meta.extraItems → 부드러운·숨긴 형상 */
export function readExtras(scene: Scene3d): DocExtras | null {
  const x = meta(scene).extraItems as Record<string, unknown> | undefined;
  if (!x || typeof x !== 'object') return null;
  const ids = new Set<string>([...scene.meshes.map((m) => m.id), ...scene.lines.map((l) => l.id)]);
  const list = (v: unknown): Set<string> => new Set(Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string' && ids.has(id)) : []);
  return {
    soft: list(x.soft),
    hidden: list(x.hidden),
    softSegments: num(x.softSegments) ?? 0,
    hiddenFaces: num(x.hiddenFaces) ?? 0,
    hiddenSegments: num(x.hiddenSegments) ?? 0,
  };
}

/** 그림 바이트 → 주소 만들기(앱은 Blob 주소, 시험은 가짜) */
export type UrlMaker = (bytes: Uint8Array, mime: string) => string;

/** 꾸러미 그림 → 화면용 주소 묶음 */
export function docImages(images: SkpImages | undefined, make: UrlMaker): DocImages | null {
  if (!images) return null;
  const urls: string[] = [];
  const url = (b: Uint8Array, mime: string): string => {
    const u = make(b, mime);
    urls.push(u);
    return u;
  };
  const out: DocImages = { model: null, materials: new Map(), components: new Map(), scenes: [], skipped: images.skipped ?? 0, urls };
  if (images.model) out.model = { name: images.model.name, url: url(images.model.bytes, images.model.mime) };
  for (const m of images.materials ?? []) if (!out.materials.has(m.folder)) out.materials.set(m.folder, { name: m.name, url: url(m.bytes, m.mime) });
  for (const c of images.components ?? []) if (!out.components.has(c.name)) out.components.set(c.name, url(c.bytes, c.mime));
  for (const sc of images.scenes ?? []) out.scenes.push({ name: sc.name, url: url(sc.bytes, sc.mime) });
  return out;
}

/** 파일 이름에 못 쓰는 글자를 _로(재질 폴더 이름에서 '<'·'>'·'*'가 '_'로 바뀐 것과 같은 꼴로 맞춰 본다 — 컴포넌트 그림 이름 규칙은 확인하지 못했다) */
export function fileSafeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_');
}

/** 컴포넌트 정의 이름 → 미리보기 그림 주소(이름이 같거나, 못 쓰는 글자를 _로 바꾼 이름이 같으면) */
export function componentImage(d: Pick<SkpDoc, 'images'>, definition: string): string | null {
  const imgs = d.images?.components;
  if (!imgs) return null;
  return imgs.get(definition) ?? imgs.get(fileSafeName(definition)) ?? null;
}

/** 재질 줄 → 무늬 그림 주소 */
export function materialImage(d: Pick<SkpDoc, 'images'>, row: MaterialRow): string | null {
  if (!row.folder) return null;
  return d.images?.materials.get(row.folder)?.url ?? null;
}

export function createDoc(name: string, size: number, res: ParseResult, opts: { makeUrl?: UrlMaker } = {}): SkpDoc {
  const scene = res.scene;
  const outline = outlineRows(scene);
  const materials = materialRows(scene);
  const itemOutline = new Map<string, number>();
  for (const r of outline) for (const id of r.ids) itemOutline.set(id, r.index);
  const meshMaterial = new Map<string, string>();
  for (const m of materials) for (const id of m.meshIds) meshMaterial.set(id, m.name);
  const skipped = num(meta(scene).outlineSkipped) ?? 0;
  const tree = readTree(scene);
  const nodeOutline = new Map<number, number>();
  if (tree) for (const r of outline) if (r.node !== null && r.node >= 0 && r.node < tree.count) nodeOutline.set(r.node, r.index);
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
    tree,
    nodeOutline,
    extras: readExtras(scene),
    images: opts.makeUrl ? docImages(res.images, opts.makeUrl) : null,
    damaged: meta(scene).damaged === true,
    limited: meta(scene).limited === true,
    hiddenTags: new Set(),
    hiddenOutline: new Set(),
    hiddenNodes: new Set(),
    expanded: new Set(),
    childLimit: new Map(),
    pickMode: 'open',
    showSoft: false,
    showHidden: false,
    selection: null,
    pick: null,
    measure: null,
    panelTab: 'tags',
  };
}

/** 패널 탭 목록 */
export function panelTabs(d: SkpDoc): [PanelTab, string][] {
  const tabs: [PanelTab, string][] = [['tags', '태그·재질']];
  if (d.outline.length || d.outlineSkipped || d.tree) tabs.push(['outline', '구성']);
  tabs.push(['info', '정보']);
  return tabs;
}

/** 나무 노드 → 고른 것(윗단계 노드는 outline 항목으로 — 예전 고르기와 같은 열쇠) */
export function nodeSelection(d: SkpDoc, node: number): Selection {
  const o = d.nodeOutline.get(node);
  return o !== undefined ? { kind: 'outline', index: o } : { kind: 'node', index: node };
}

/** 고른 것 → 나무 노드(없으면 null, 바로 놓인 형상은 -1) */
export function selectedNode(d: SkpDoc, sel: Selection | null): number | null {
  if (!sel) return null;
  if (sel.kind === 'node') return sel.index;
  if (sel.kind === 'outline') {
    const r = d.outline[sel.index];
    if (!r) return null;
    return r.kind === 'loose' ? -1 : r.node;
  }
  return null;
}

/** 3D에서 고른 것 → 그것을 낸 가장 안쪽 나무 노드(-1 = 바로 놓인 형상, null = 모름) */
export function pickDeepest(d: SkpDoc, p: Pick3d | null): number | null {
  if (!p || !d.tree) return null;
  return deepestNodeAt(d.tree, d.scene, p.id, p.raw ?? p.index);
}

/**
 * 고르기 결과 → 고른 것. 나무가 있으면 펼친 단계(또는 deepest면 가장 안쪽)의 노드를,
 * 없으면 예전처럼 윗단계 항목 전체를 고른다.
 */
export function selectionForPick(d: SkpDoc, p: Pick3d | null, deepest = false): Selection | null {
  if (!p) return null;
  const n = pickDeepest(d, p);
  if (n !== null && d.tree) {
    if (n < 0) {
      const loose = d.outline.findIndex((r) => r.kind === 'loose');
      if (loose >= 0) return { kind: 'outline', index: loose };
    } else return nodeSelection(d, levelNode(d.tree, n, d.expanded, deepest ? 'deepest' : d.pickMode));
  }
  const i = d.itemOutline.get(p.id);
  if (i !== undefined) return { kind: 'outline', index: i };
  return { kind: 'item', id: p.id };
}

/** 고른 것 → 강조할 항목 id(나누지 않은 깊은 노드는 빈 목록 — selectionSegments로 강조) */
export function selectionIds(d: SkpDoc, sel: Selection | null): string[] {
  if (!sel) return [];
  if (sel.kind === 'outline') return d.outline[sel.index]?.ids ?? [];
  if (sel.kind === 'node') return d.tree ? nodeItemIds(d.tree, d.scene, sel.index) : [];
  if (sel.kind === 'material') return d.materials.find((m) => m.name === sel.name)?.meshIds ?? [];
  return [sel.id];
}

/**
 * 나누지 않은 깊은 노드를 고르면 그 안쪽 모서리 선분(강조용, 큰 좌표면 원점과 함께). 그 밖에는 null.
 * hidden(항목 → 숨긴 구간)을 주면 숨긴 부분은 뺀다(숨김과 강조가 겹칠 때)
 */
export function selectionSegments(
  d: SkpDoc,
  sel: Selection | null,
  visible?: (item: number) => boolean,
  hidden?: ReadonlyMap<number, readonly IndexRange[]>,
): SegmentSet | null {
  if (!sel || sel.kind !== 'node' || !d.tree || isSplit(d.tree, sel.index)) return null;
  return nodeSegments(d.tree, d.scene, sel.index, visible, undefined, hidden);
}

/** 나누지 않은 깊은 노드를 고르면 면 강조용 구간(그물 항목만 — 항목 id → 삼각형 구간). 그 밖에는 null */
export function selectionRanges(d: SkpDoc, sel: Selection | null): Map<string, IndexRange[]> | null {
  if (!sel || sel.kind !== 'node' || !d.tree || isSplit(d.tree, sel.index)) return null;
  const out = new Map<string, IndexRange[]>();
  for (const [it, list] of nodeRanges(d.tree, d.scene, sel.index)) if (it < d.scene.meshes.length) out.set(d.scene.meshes[it]!.id, list);
  return out.size ? out : null;
}

/** 숨길 수 있는 노드인지: 따로 나눈 노드(항목째) 또는 구간이 있는 깊은 노드(구간째) */
export function canHideNode(d: SkpDoc, node: number): boolean {
  const t = d.tree;
  if (!t || node < 0 || node >= t.count) return false;
  return isSplit(t, node) || !t.runsDropped;
}

/**
 * 숨긴 나누지 않은 노드들의 구간을 항목마다 합친다(코어 setHiddenRanges용, 항목 차례 → 구간).
 * 조상이 이미 숨은 노드는 건너뛴다(조상 구간·항목 숨김에 들어 있다)
 */
export function hiddenNodeRanges(d: SkpDoc): Map<number, IndexRange[]> {
  const t = d.tree;
  if (!t || !d.hiddenNodes.size || t.runsDropped) return new Map();
  const nodes: number[] = [];
  for (const n of d.hiddenNodes) {
    if (n < 0 || n >= t.count || isSplit(t, n)) continue;
    if (t.parent[n]! >= 0 && hiddenByNodes(t, d.hiddenNodes, t.parent[n]!)) continue;
    nodes.push(n);
  }
  return mergeNodeRanges(t, d.scene, nodes);
}

/** 항목(차례)이 지금 보여야 하는지: 부드러운·숨긴 형상 켜짐, 숨긴 윗단계 항목·나무 노드(태그는 뷰어가 따로 가린다) */
export function itemVisible(d: SkpDoc, item: number): boolean {
  const s = d.scene;
  const id = item < s.meshes.length ? s.meshes[item]?.id : s.lines[item - s.meshes.length]?.id;
  if (id === undefined) return false;
  if (d.extras) {
    if (d.extras.soft.has(id) && !d.showSoft) return false;
    if (d.extras.hidden.has(id) && !d.showHidden) return false;
  }
  if (d.hiddenOutline.size) {
    const o = d.itemOutline.get(id);
    if (o !== undefined && d.hiddenOutline.has(o)) return false;
  }
  if (d.tree && d.hiddenNodes.size) {
    const owner = d.tree.itemOwner[item]!;
    if (owner >= 0 && hiddenByNodes(d.tree, d.hiddenNodes, owner)) return false;
  }
  return true;
}

/** 노드의 경로 글("집 › 의자 › 다리") */
export function nodePathText(d: SkpDoc, node: number): string {
  if (!d.tree) return '';
  return nodePath(d.tree, node)
    .map((n) => nodeName(d.tree!, n))
    .join(' › ');
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
  if (sel.kind === 'node') {
    const t = d.tree;
    if (!t || sel.index < 0 || sel.index >= t.count) return '';
    const i = sel.index;
    const name = nodeName(t, i);
    const def = nodeDefinition(t, i);
    const parts = [`${t.kind[i] === 0 ? '그룹' : '컴포넌트'} ${name}${def && def !== name ? ` (${def})` : ''}`];
    if (t.parent[i]! >= 0) parts.push(`위치 ${nodePathText(d, t.parent[i]!)}`);
    const tag = nodeTag(t, i);
    if (tag) parts.push(`태그 ${tag}`);
    if (pickedMat) parts.push(`재질 ${pickedMat}`);
    parts.push(`면 ${t.faces[i]!.toLocaleString('ko-KR')}`);
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

/** 나눠 올리기 기준: 삼각형+선분 수 */
export const INCREMENTAL_PRIMS = 1_000_000;
/** 나눠 올리기 기준: 그물·선 묶음 수 */
export const INCREMENTAL_ITEMS = 1500;

/** GPU에 나눠 올릴 만큼 큰 장면인지(작은 모형은 지금처럼 한 번에) */
export function isBigScene(d: { scene: Scene3d }): boolean {
  const s = d.scene;
  if (s.meshes.length + s.lines.length >= INCREMENTAL_ITEMS) return true;
  let prims = 0;
  for (const m of s.meshes) prims += (m.indices ? m.indices.length : m.positions.length / 3) / 3;
  for (const l of s.lines) prims += l.positions.length / 6;
  return prims >= INCREMENTAL_PRIMS;
}
