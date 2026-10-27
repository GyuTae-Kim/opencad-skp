/**
 * 열린 SketchUp 문서의 상태와 패널 목록 만들기(순수 함수, DOM 없음).
 * 해석기가 scene.meta에 적은 것(판·단위·통계·tagStats·materialStats·outline·tree·extraItems)을 안전하게 읽어 화면용 꼴로 바꾼다.
 * meta가 비었거나 옛 꼴이어도 장면(그물 이름·묶음)에서 최소한의 목록을 만든다.
 */
import type { IndexRange, Pick3d, RangeSelection, Scene3d, SectionPlane } from 'opencad-viewer3d';
import { MAX_SECTION_PLANES } from 'opencad-viewer3d/section';
import type { SkpImages } from '../images';
import type {
  SkpAnnotationItems,
  SkpAttrDictsMeta,
  SkpAxesMeta,
  SkpLocationMeta,
  SkpShadowMeta,
  SkpCameraMeta,
  SkpDimensionMeta,
  SkpPageMeta,
  SkpSectionPlaneMeta,
  SkpStyleMeta,
  SkpTagFolderMeta,
  SkpTextMeta,
  SkpTreeInfo,
} from '../meta';
import { nodeEntity, type EntityInput } from './entity';
import { definitionNodes } from './search';
import { edgeGeometry, faceBox, faceGeometry, faceOfTriangle, readFaceIndex, segmentsBox, triangleCount, type FaceIndex, type PartBox } from './faces';
import type { MeasureToolResult } from './measure';
import { readActivePage, readPages, readSectionPlane, readShadow } from './pages';
import { formatAngle, formatArea, formatLength, mmPerSceneUnit, readUnits, type UnitsDisplay } from './units';
import { fmtCount } from './format';
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

export type PanelTab = 'tags' | 'outline' | 'entity' | 'info';

/** 주석 묶음 종류(meta.annotationItems의 칸) */
export type AnnotationKind = keyof SkpAnnotationItems;

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
  /** 파일에서 태그 자신이 보이는지(폴더 보임과는 따로, 모르면 true) */
  visible: boolean;
  /** 태그 색(0~1 RGBA, 모르면 null) */
  color: [number, number, number, number] | null;
  /** 든 태그 폴더(SkpDoc.tagFolders 차례, 없으면 -1) */
  folder: number;
  /** 선 종류 이름(실선·모르면 null) */
  lineStyle: string | null;
}

export interface MaterialRow {
  name: string;
  /** model.dat의 재질 이름(= 꾸러미의 materials/<폴더>) — 무늬 그림 찾기용 */
  folder: string | null;
  color: [number, number, number, number];
  textured: boolean;
  /** 3D에 입힌 무늬 그림 id(Scene3d.textures에 있을 때만, 없으면 평균색) */
  texture: string | null;
  faces: number | null;
  /** 이 재질을 뒷면에만 칠한 면 수(없으면 0) */
  backFaces: number;
  /** 이 재질 면의 넓이 합(장면 단위², 모르면 null) */
  area: number | null;
  meshIds: string[];
}

export interface OutlineRow {
  index: number;
  /** meta.tree의 노드(바로 놓인 형상·옛 장면은 null) */
  node: number | null;
  name: string;
  kind: 'group' | 'component' | 'image' | 'loose';
  definition: string | null;
  tag: string;
  faces: number;
  edges: number;
  /** 보통 면 넓이 합(장면 단위², 모르면 null) */
  area: number | null;
  ids: string[];
}

/**
 * 고른 것: outline = 윗단계 항목(바로 놓인 형상 포함), node = 나무의 더 깊은 노드, material = 재질, item = 그물·선 하나,
 * face = SketchUp 면 하나(그물 차례 item의 삼각형 구간), edge = 모서리 하나(모서리 묶음 차례 item의 선분 seg — 곡선이면 곡선 전체)
 */
export type Selection =
  | { kind: 'outline'; index: number }
  | { kind: 'node'; index: number }
  | { kind: 'material'; name: string }
  | { kind: 'item'; id: string }
  | { kind: 'face'; item: number; start: number; count: number }
  | { kind: 'edge'; item: number; seg: number }
  | { kind: 'definition'; name: string };

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
  /** 장면 미리보기(path = ZIP 경로, 장면의 thumbnail과 잇는다) */
  scenes: { name: string; url: string; path: string }[];
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
  /** 그물·모서리 묶음 id → 장면 차례(면·모서리 고르기) */
  meshIndex: Map<string, number>;
  lineIndex: Map<string, number>;
  /** 면 경계·곡선 번호(meta.faceRuns·segmentCurves) */
  faceIndex: FaceIndex;
  /** 모형에서 숨겼지만 장면이 다시 보이는 노드의 보통 색 항목(meta.revealItems): 항목 id → 노드 */
  revealOf: Map<string, number>;
  /** 지금 장면이 다시 보이게 한 노드(처음엔 없음 — 숨긴 개체를 기억하는 장면을 고르면 바뀐다) */
  revealNodes: Set<number>;
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
  /** 사용자(또는 파일·장면)가 숨긴 태그 — 실제 숨김은 tagHidden(폴더 숨김까지) */
  hiddenTags: Set<string>;
  /** 숨긴 태그 폴더(tagFolders 차례) */
  hiddenFolders: Set<number>;
  /** 숨긴 outline 차례 */
  hiddenOutline: Set<number>;
  /** 숨긴 나무 노드 */
  hiddenNodes: Set<number>;
  /** 펼친 나무 노드(3D 고르기 단계도 이것을 따른다) */
  expanded: Set<number>;
  /** 노드마다 보일 자식 수(아주 많을 때 "더 보기") */
  childLimit: Map<number, number>;
  /** 3D 고르기 방식: open = 펼친 단계, deepest = 가장 안쪽, face = 면·모서리 하나 */
  pickMode: PickMode;
  /** 구성 탭 찾기 글(빈 글이면 나무 그대로) */
  outlineQuery: string;
  showSoft: boolean;
  showHidden: boolean;
  selection: Selection | null;
  pick: Pick3d | null;
  /** 줄자·각도기 결과 */
  measure: MeasureToolResult | null;
  panelTab: PanelTab;
  // ── 형식이 더 알려 준 것(meta, 없으면 빈 값) ──
  /** 모형 표시 단위 */
  units: UnitsDisplay;
  /** 저장 당시 카메라 */
  camera: SkpCameraMeta | null;
  pages: SkpPageMeta[];
  /** 파일의 활성 장면 차례 */
  activePage: number | null;
  /** 모형 스타일 */
  style: SkpStyleMeta | null;
  tagFolders: SkpTagFolderMeta[];
  modelName: string | null;
  modelDescription: string | null;
  texts: SkpTextMeta[];
  dimensions: SkpDimensionMeta[];
  /** 읽을 수 있는 단면(index = meta.sectionPlanes 차례) */
  sectionPlanes: (SkpSectionPlaneMeta & { index: number })[];
  /** meta.sectionPlanes 원본(장면의 단면 차례가 가리킨다) */
  sectionPlanesRaw: readonly unknown[];
  annotationItems: SkpAnnotationItems | null;
  /** 주석 항목 id → 종류(켜고 끄기용) */
  annotationKind: Map<string, AnnotationKind>;
  /** 주석 선분 묶음 id → 나무 노드 구간(선분 차례 start[k]부터 노드 node[k] — 숨긴 노드 안 주석 선을 숨긴다). 나무가 없으면 비어 있다 */
  annotationRuns: Map<string, AnnotationRuns>;
  attributes: SkpAttrDictsMeta[];
  modelAttrs: number | null;
  treeInfo: SkpTreeInfo | null;
  /** 위치·그림자 설정·그리기 축(없으면 null) */
  location: SkpLocationMeta | null;
  shadow: SkpShadowMeta | null;
  axes: SkpAxesMeta | null;
  // ── 보기 상태(더한 것) ──
  /** 마지막으로 고른 장면(사용자가 장면 탭을 누른 것, 처음엔 null) */
  page: number | null;
  showTexts: boolean;
  showDimensions: boolean;
  showGuides: boolean;
  showSectionPlanes: boolean;
  /** 적용한 파일 단면(meta.sectionPlanes 차례, 모형 단면 먼저 — 없으면 빈 목록) */
  fileSections: number[];
  /** 마지막으로 적용하려던 파일 단면 가운데 적용하지 못한 수: 그 그룹만 자를 수 없는 그룹 안 단면 · 코어 평면 수 한도를 넘은 것 */
  sectionSkipped: { scope: number; limit: number };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** 0~1 RGB(A) 배열 → RGBA(꼴이 아니면 null) */
function rgba(v: unknown): [number, number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const c = v.slice(0, 4).map((x) => num(x));
  if (c.some((x) => x === null)) return null;
  return [c[0]!, c[1]!, c[2]!, c[3] ?? 1];
}
/** 객체 배열만 거른다(worker가 넘긴 meta를 믿지 않는다) */
function objects<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : [];
}

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

/**
 * 아직 읽지 못하는 아주 옛 판(SketchUp 3~5)이면 판 문자열, 아니면 null.
 * 해석기가 거절한 파일(meta.unsupported)이거나 판 번호가 6보다 낮으면 그렇다. 6·7·8·2013~2020은 읽는다.
 */
export function unsupportedVersion(scene: Scene3d): string | null {
  const info = readInfo(scene);
  if (meta(scene).unsupported === true || (info.major !== null && info.major < 6)) return info.version ?? '알 수 없음';
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
      rows.push({
        name,
        default: o.default === true,
        faces: num(o.faces),
        edges: num(o.edges),
        hasGeometry: groups.has(name),
        visible: o.visible !== false,
        color: rgba(o.color),
        folder: num(o.folder) ?? -1,
        lineStyle: str(o.lineStyle),
      });
    }
  for (const g of groups)
    if (!seen.has(g)) rows.push({ name: g, default: false, faces: null, edges: null, hasGeometry: true, visible: true, color: null, folder: -1, lineStyle: null });
  return rows;
}

/** 재질 목록: meta.materialStats — 없으면 그물 이름("재질 · 태그")에서. 많이 쓴 차례 */
export function materialRows(scene: Scene3d): MaterialRow[] {
  const stats = meta(scene).materialStats;
  const ids = new Set(scene.meshes.map((m) => m.id));
  const texIds = new Set((scene.textures ?? []).map((t) => t.id));
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
      const tex = str(o.texture);
      rows.push({
        name,
        folder: str(o.folder),
        color,
        textured: o.textured === true,
        texture: tex !== null && texIds.has(tex) ? tex : null,
        faces: num(o.faces),
        backFaces: num(o.backFaces) ?? 0,
        area: num(o.area),
        meshIds,
      });
    }
  } else {
    const map = new Map<string, MaterialRow>();
    for (const m of scene.meshes) {
      const name = (m.name ?? '').split(' · ')[0] || '기본 재질';
      let r = map.get(name);
      if (!r) map.set(name, (r = { name, folder: null, color: [m.color[0], m.color[1], m.color[2], m.color[3]], textured: false, texture: null, faces: null, backFaces: 0, area: null, meshIds: [] }));
      r.meshIds.push(m.id);
    }
    rows.push(...map.values());
  }
  return rows.sort((a, b) => (b.faces ?? 0) - (a.faces ?? 0) || b.backFaces - a.backFaces || a.name.localeCompare(b.name, 'ko'));
}

/** 재질 목록 줄의 수: 면 수, 뒷면에 칠한 면이 있으면 "뒷면 n"(뒷면만이면 그것만) */
export function materialCount(m: Pick<MaterialRow, 'faces' | 'backFaces'>): string {
  const back = m.backFaces > 0 ? `뒷면 ${fmtCount(m.backFaces)}` : '';
  if (m.faces === null || (m.faces === 0 && back)) return back;
  return back ? `면 ${fmtCount(m.faces)} · ${back}` : `면 ${fmtCount(m.faces)}`;
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
    const kind = o.kind === 'group' || o.kind === 'component' || o.kind === 'image' || o.kind === 'loose' ? o.kind : 'component';
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
      area: num(o.area),
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

export const KIND_LABEL: Record<OutlineRow['kind'], string> = { group: '그룹', component: '컴포넌트', image: '그림', loose: '형상' };

let serial = 0;

/** meta.revealItems → 항목 id → 노드(꼴이 다르거나 장면에 없는 id는 뺀다) */
export function readReveal(scene: Scene3d): Map<string, number> {
  const list = meta(scene).revealItems;
  const out = new Map<string, number>();
  if (!Array.isArray(list)) return out;
  const known = new Set<string>([...scene.meshes.map((m) => m.id), ...scene.lines.map((l) => l.id)]);
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (!Number.isInteger(o.node) || (o.node as number) < 0 || !Array.isArray(o.ids)) continue;
    for (const id of o.ids) if (typeof id === 'string' && known.has(id)) out.set(id, o.node as number);
  }
  return out;
}

/** 장면 계획의 숨긴 노드 목록 → 다시 보일 노드(모형 숨김 노드 가운데 그 장면이 숨기지 않는 것). 숨긴 개체를 기억하지 않는 장면은 null(그대로) */
export function revealNodesFor(d: Pick<SkpDoc, 'revealOf'>, hiddenNodes: ReadonlySet<number> | null): Set<number> | null {
  if (!hiddenNodes) return null;
  const out = new Set<number>();
  for (const n of d.revealOf.values()) if (!hiddenNodes.has(n)) out.add(n);
  return out;
}

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
  for (const sc of images.scenes ?? []) out.scenes.push({ name: sc.name, url: url(sc.bytes, sc.mime), path: sc.path });
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
  prepareEdgeDisplay(scene);
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
  const doc: SkpDoc = {
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
    meshIndex: new Map(scene.meshes.map((m, i) => [m.id, i])),
    lineIndex: new Map(scene.lines.map((l, i) => [l.id, i])),
    faceIndex: readFaceIndex(scene),
    revealOf: readReveal(scene),
    revealNodes: new Set(),
    tree,
    nodeOutline,
    extras: readExtras(scene),
    images: opts.makeUrl ? docImages(res.images, opts.makeUrl) : null,
    damaged: meta(scene).damaged === true,
    limited: meta(scene).limited === true,
    hiddenTags: new Set(),
    hiddenFolders: new Set(),
    hiddenOutline: new Set(),
    hiddenNodes: new Set(),
    expanded: new Set(),
    childLimit: new Map(),
    pickMode: 'open',
    outlineQuery: '',
    showSoft: false,
    showHidden: false,
    selection: null,
    pick: null,
    measure: null,
    panelTab: 'tags',
    ...readMetaExtras(scene),
  };
  // 파일에서 숨긴 태그·폴더는 처음부터 숨긴다(SketchUp에서 연 것과 같게)
  for (const t of doc.tags) if (!t.visible) doc.hiddenTags.add(t.name);
  doc.tagFolders.forEach((f, i) => {
    if (f.visible === false) doc.hiddenFolders.add(i);
  });
  return doc;
}

/** 모형 모서리 선분 묶음 id 머리(보통·부드러운·숨긴·장면에서 다시 보이는 개체 모서리 — 주석의 치수·지시선·보조선·단면 기호는 아님) */
const MODEL_EDGE_ID = /^skp-(edges|soft|hidden-edges|reveal-edges)-/;

/**
 * 모서리 그리기(코어 0.7.1, 장면을 뷰어에 올리기 전에): SketchUp 모서리는 따로 선분 묶음이라, 그물은 와이어프레임·숨은 선에서
 * 삼각형 변을 그리지 않고(triangleEdges: false — 카메라를 보는 그물은 그 배치의 모서리 윤곽선만), 모형 모서리 묶음은 숨은 선 방식의
 * 뒤 모서리 점선(setRenderOptions({ hiddenEdges }))을 받는다(hiddenEdges: true)
 */
export function prepareEdgeDisplay(scene: Scene3d): void {
  for (const m of scene.meshes) m.triangleEdges = false;
  for (const l of scene.lines) if (MODEL_EDGE_ID.test(l.id)) l.hiddenEdges = true;
}

/**
 * 태그 색으로 칠하기(스타일 "태그 색으로", 코어 setItemColor): 그물 id → 그 태그(묶음) 색. 태그 색을 모르면 넣지 않는다.
 * 불투명도는 태그 색과 그물 색(숨긴 형상은 반투명) 가운데 작은 것
 */
export function tagColors(d: Pick<SkpDoc, 'scene' | 'tags'>): Map<string, [number, number, number, number]> {
  const byTag = new Map<string, [number, number, number, number]>();
  for (const t of d.tags) if (t.color) byTag.set(t.name, t.color);
  const out = new Map<string, [number, number, number, number]>();
  for (const m of d.scene.meshes) {
    const c = m.group !== undefined ? byTag.get(m.group) : undefined;
    if (c) out.set(m.id, [c[0], c[1], c[2], Math.min(c[3], m.color[3])]);
  }
  return out;
}

/**
 * 항목의 숨길 구간(코어 setHiddenRanges): 삼각형·선분 구간에 더해, 카메라를 보는 그물(윤곽선 = 그 배치의 모서리)은 삼각형을 모두 숨기면
 * 윤곽선도 숨긴다. 숨길 것이 없으면 null(숨김 풀기)
 */
export function hiddenSelection(d: Pick<SkpDoc, 'scene'>, item: number, prims: readonly IndexRange[] | null): RangeSelection | null {
  const mesh = item < d.scene.meshes.length ? d.scene.meshes[item] : undefined;
  if (!prims?.length) return null;
  if (mesh?.edges && mesh.edges.length >= 6) {
    const tris = triangleCount(mesh);
    if (prims.length === 1 && prims[0]!.start <= 0 && prims[0]!.start + prims[0]!.count >= tris) return { prims, edges: [{ start: 0, count: Math.floor(mesh.edges.length / 6) }] };
  }
  return prims;
}

/**
 * 파일 단면(activeSections) → 코어 setSections 평면: 모형 단면은 장면 전체, 그룹·컴포넌트 안 단면은 그 노드의 항목(따로 나눈 노드만 — 해석기가
 * 단면이 든 노드를 따로 나눈다)만 자른다. 나누지 않은 노드라 항목을 모르는 단면과 코어 한도(MAX_SECTION_PLANES)를 넘는 단면은 건너뛰고 수를 센다
 */
export function sectionPlanesFor(
  d: Pick<SkpDoc, 'tree' | 'scene'>,
  list: readonly { index: number; plane: Pick<SkpSectionPlaneMeta, 'node'>; normal: readonly number[]; offset: number }[],
  caps: 'closed' | 'none' | 'all',
): { planes: SectionPlane[]; applied: number[]; skipped: { scope: number; limit: number } } {
  const planes: SectionPlane[] = [];
  const applied: number[] = [];
  const skipped = { scope: 0, limit: 0 };
  for (const s of list) {
    const base: SectionPlane = { normal: [s.normal[0]!, s.normal[1]!, s.normal[2]!], offset: s.offset, caps, id: `skp-section-${s.index}` };
    const node = s.plane.node;
    if (node >= 0) {
      const t = d.tree;
      const ids = t && node < t.count && isSplit(t, node) ? nodeItemIds(t, d.scene, node) : [];
      if (!ids.length) {
        skipped.scope++;
        continue;
      }
      base.items = ids;
    }
    if (planes.length >= MAX_SECTION_PLANES) {
      skipped.limit++;
      continue;
    }
    planes.push(base);
    applied.push(s.index);
  }
  return { planes, applied, skipped };
}

/** 단면 상태 id(sectionPlanesFor의 id) → 파일 단면 차례(파일 단면이 아니면 null) */
export function sectionIndexOfId(id: string | undefined): number | null {
  const m = id ? /^skp-section-(\d+)$/.exec(id) : null;
  return m ? Number(m[1]) : null;
}

/** 태그 폴더가 (자신이나 조상이) 숨었는지 */
export function folderHidden(d: Pick<SkpDoc, 'tagFolders' | 'hiddenFolders'>, folder: number): boolean {
  for (let f = folder, k = 0; f >= 0 && f < d.tagFolders.length && k < 64; f = d.tagFolders[f]!.parent ?? -1, k++) if (d.hiddenFolders.has(f)) return true;
  return false;
}

/** 태그가 실제로 숨었는지(태그 자신 또는 든 폴더) */
export function tagHidden(d: Pick<SkpDoc, 'tags' | 'tagFolders' | 'hiddenFolders' | 'hiddenTags'>, name: string): boolean {
  if (d.hiddenTags.has(name)) return true;
  const t = d.tags.find((x) => x.name === name);
  return !!t && t.folder >= 0 && folderHidden(d, t.folder);
}

/** 폴더(와 그 아래 폴더)에 든 태그 이름 */
export function folderTags(d: Pick<SkpDoc, 'tags' | 'tagFolders'>, folder: number): string[] {
  const inside = (f: number): boolean => {
    for (let x = f, k = 0; x >= 0 && x < d.tagFolders.length && k < 64; x = d.tagFolders[x]!.parent ?? -1, k++) if (x === folder) return true;
    return false;
  };
  return d.tags.filter((t) => t.folder >= 0 && inside(t.folder)).map((t) => t.name);
}

/** 주석 선분 묶음의 나무 노드 구간(meta.annotationRuns 한 칸) */
export interface AnnotationRuns {
  start: Uint32Array;
  node: Int32Array;
}

/** meta.annotationRuns → 주석 항목 id → 구간. 주석 항목이 아니거나 꼴·노드 차례가 맞지 않는 칸은 버린다 */
export function readAnnotationRuns(v: unknown, kinds: ReadonlyMap<string, AnnotationKind>, nodeCount: number): Map<string, AnnotationRuns> {
  const out = new Map<string, AnnotationRuns>();
  if (!v || typeof v !== 'object' || !nodeCount) return out;
  for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
    if (!kinds.has(id) || !r || typeof r !== 'object') continue;
    const { start, node } = r as Partial<AnnotationRuns>;
    if (!(start instanceof Uint32Array) || !(node instanceof Int32Array) || start.length !== node.length || !start.length) continue;
    let ok = true;
    for (let k = 0; k < node.length && ok; k++) ok = node[k]! >= -1 && node[k]! < nodeCount && (k === 0 || start[k]! > start[k - 1]!);
    if (ok) out.set(id, { start, node });
  }
  return out;
}

/** meta의 더한 칸(장면·스타일·주석·나무 정보) → 문서 칸. 꼴이 다르면 빈 값 */
export function readMetaExtras(scene: Scene3d): Pick<
  SkpDoc,
  | 'units'
  | 'camera'
  | 'pages'
  | 'activePage'
  | 'style'
  | 'tagFolders'
  | 'modelName'
  | 'modelDescription'
  | 'texts'
  | 'dimensions'
  | 'sectionPlanes'
  | 'sectionPlanesRaw'
  | 'annotationItems'
  | 'annotationKind'
  | 'annotationRuns'
  | 'attributes'
  | 'modelAttrs'
  | 'treeInfo'
  | 'location'
  | 'shadow'
  | 'axes'
  | 'page'
  | 'showTexts'
  | 'showDimensions'
  | 'showGuides'
  | 'showSectionPlanes'
  | 'fileSections'
  | 'sectionSkipped'
> {
  const m = meta(scene);
  // 차례는 파일 그대로(activePage·장면의 단면 차례가 이 차례를 가리킨다)
  const pages = readPages(m);
  const rawPlanes: readonly unknown[] = Array.isArray(m.sectionPlanes) ? m.sectionPlanes : [];
  const sectionPlanes: SkpDoc['sectionPlanes'] = [];
  rawPlanes.forEach((p, index) => {
    const sp = readSectionPlane(p);
    if (sp) sectionPlanes.push({ ...sp, index });
  });
  const style = m.style && typeof m.style === 'object' ? (m.style as SkpStyleMeta) : null;
  const items = m.annotationItems && typeof m.annotationItems === 'object' ? (m.annotationItems as Partial<SkpAnnotationItems>) : null;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const cam = m.camera && typeof m.camera === 'object' ? (m.camera as SkpCameraMeta) : null;
  const annotationItems: SkpAnnotationItems | null = items
    ? { dimensions: ids(items.dimensions), leaders: ids(items.leaders), guides: ids(items.guides), sectionPlanes: ids(items.sectionPlanes) }
    : null;
  const annotationKind = new Map<string, AnnotationKind>();
  if (annotationItems) for (const k of Object.keys(annotationItems) as AnnotationKind[]) for (const id of annotationItems[k]) annotationKind.set(id, k);
  const tree = readTree(scene);
  const annotationRuns = readAnnotationRuns(m.annotationRuns, annotationKind, tree?.count ?? 0);
  const info = m.treeInfo && typeof m.treeInfo === 'object' ? (m.treeInfo as SkpTreeInfo) : null;
  const infoOk = !!info && !!tree && info.attrs instanceof Int32Array && info.attrs.length === tree.count && info.size instanceof Float32Array && info.size.length === tree.count * 3;
  return {
    units: readUnits(m.units, str(m.lengthUnit)),
    camera: cam && Array.isArray(cam.eye) && Array.isArray(cam.target) ? cam : null,
    pages,
    activePage: readActivePage(m, pages.length),
    style,
    tagFolders: objects<SkpTagFolderMeta>(m.tagFolders),
    modelName: str(m.modelName),
    modelDescription: str(m.modelDescription),
    texts: objects<SkpTextMeta>(m.texts),
    dimensions: objects<SkpDimensionMeta>(m.dimensions),
    sectionPlanes,
    sectionPlanesRaw: rawPlanes,
    annotationItems,
    annotationKind,
    annotationRuns,
    attributes: objects<SkpAttrDictsMeta>(m.attributes),
    modelAttrs: num(m.modelAttrs),
    treeInfo: infoOk ? info : null,
    location: readLocation(m.location),
    shadow: readShadow(m.shadow),
    axes: readAxes(m.axes),
    page: null,
    showTexts: style?.texts !== false,
    showDimensions: style?.dimensions !== false,
    showGuides: style?.guides !== false,
    showSectionPlanes: style?.sectionPlanes !== false,
    fileSections: [],
    sectionSkipped: { scope: 0, limit: 0 },
  };
}

const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** meta.location(꼴이 다르면 null) */
export function readLocation(v: unknown): SkpLocationMeta | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: SkpLocationMeta = { georeferenced: o.georeferenced === true };
  for (const k of ['city', 'country'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of ['latitude', 'longitude', 'tz', 'northAngle'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) out[k] = o[k] as number;
  return out;
}

/** meta.axes(꼴이 다르면 null) */
export function readAxes(v: unknown): SkpAxesMeta | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return isVec3(o.origin) && isVec3(o.x) && isVec3(o.y) && isVec3(o.z) ? { origin: o.origin, x: o.x, y: o.y, z: o.z } : null;
}

/** 위도·경도 글("37.5665° N, 126.9780° E") */
export function latLonText(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** 시간대 글(UTC+9, UTC−3:30) */
export function tzText(tz: number): string {
  const sign = tz < 0 ? '−' : '+';
  const a = Math.abs(tz);
  const h = Math.floor(a);
  const m = Math.round((a - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** 그림자 시각(그곳 시각을 UTC 초처럼 적은 값) → "2026-06-21 13:30" */
export function shadowTimeText(time: number): string {
  const d = new Date(time * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 패널 탭 목록 */
export function panelTabs(d: SkpDoc): [PanelTab, string][] {
  const tabs: [PanelTab, string][] = [['tags', '태그·재질']];
  if (d.outline.length || d.outlineSkipped || d.tree) tabs.push(['outline', '구성']);
  tabs.push(['entity', '선택'], ['info', '정보']);
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
  // 그물 윤곽선(kind 'edge')의 번호는 삼각형 번호가 아니다 — 윤곽선을 가진 그물(카메라를 보는 배치 하나)의 첫 삼각형으로
  return deepestNodeAt(d.tree, d.scene, p.id, p.kind === 'edge' ? 0 : (p.raw ?? p.index));
}

/**
 * 고른 그물 삼각형·모서리 선분 → 면 하나·모서리 하나(곡선이면 그 곡선). 면 경계가 없는 그물(옛 장면), 주석 선분,
 * 단면의 잘린 면은 null(부른 쪽이 그룹 고르기로 돌아간다)
 */
export function faceOrEdgeSelection(d: SkpDoc, p: Pick3d | null): Selection | null {
  if (!p || p.section) return null;
  const at = p.raw ?? p.index;
  if (p.kind === 'mesh') {
    const item = d.meshIndex.get(p.id);
    const mesh = item === undefined ? undefined : d.scene.meshes[item];
    if (item === undefined || !mesh) return null;
    const f = faceOfTriangle(d.faceIndex.faceRuns[item] ?? null, at, triangleCount(mesh));
    return f ? { kind: 'face', item, start: f.start, count: f.count } : null;
  }
  if (p.kind === 'line') {
    const item = d.lineIndex.get(p.id);
    const line = item === undefined ? undefined : d.scene.lines[item];
    if (item === undefined || !line || d.annotationKind.has(p.id) || !(at >= 0) || at >= line.positions.length / 6) return null;
    return { kind: 'edge', item, seg: at };
  }
  return null;
}

/** 그룹·컴포넌트를 고른 뒤 누른 자리의 면·모서리 하나를 고를 수 있으면 그 종류(이미 면·모서리를 골랐거나 누른 자리가 없으면 null) */
export function partOfPick(d: SkpDoc): 'face' | 'edge' | null {
  const sel = d.selection;
  if (!sel || sel.kind === 'face' || sel.kind === 'edge' || sel.kind === 'material') return null;
  const part = faceOrEdgeSelection(d, d.pick);
  return part?.kind === 'face' ? 'face' : part?.kind === 'edge' ? 'edge' : null;
}

/**
 * 고르기 결과 → 고른 것. 면·모서리 방식이면 누른 면·모서리 하나를, 나무가 있으면 펼친 단계(또는 deepest면 가장 안쪽)의 노드를,
 * 없으면 예전처럼 윗단계 항목 전체를 고른다.
 */
export function selectionForPick(d: SkpDoc, p: Pick3d | null, deepest = false): Selection | null {
  if (!p) return null;
  if (d.pickMode === 'face' && !deepest) {
    const fe = faceOrEdgeSelection(d, p);
    if (fe) return fe;
  }
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
  // 면·모서리 하나는 항목 통째가 아니라 구간으로 강조한다(selectionRanges)
  if (sel.kind === 'face' || sel.kind === 'edge') return [];
  if (sel.kind === 'definition') {
    // 정의의 인스턴스 모두: 나무가 있으면 따로 나눈 노드의 항목(나누지 않은 노드는 구간 강조), 없으면 윗단계 항목
    if (!d.tree) return d.outline.filter((r) => r.definition === sel.name && r.kind === 'component').flatMap((r) => r.ids);
    const ids = new Set<string>();
    for (const n of definitionNodes(d.tree, sel.name)) if (isSplit(d.tree, n)) for (const id of nodeItemIds(d.tree, d.scene, n)) ids.add(id);
    return [...ids];
  }
  return [sel.id];
}

/** 고른 컴포넌트의 정의와 그 정의가 놓인 수(둘 이상일 때만 — "이 정의 모두 고르기"용). 그 밖에는 null */
export function selectionDefinition(d: SkpDoc, sel: Selection | null): { name: string; count: number } | null {
  let name: string | null = null;
  const n = selectedNode(d, sel);
  if (d.tree && n !== null && n >= 0) {
    if (d.tree.kind[n] === 1) name = nodeDefinition(d.tree, n);
  } else if (sel?.kind === 'outline') {
    const r = d.outline[sel.index];
    if (r?.kind === 'component' && r.definition) name = r.definition;
  }
  if (!name) return null;
  const count = d.tree ? definitionNodes(d.tree, name).length : d.outline.filter((r) => r.kind === 'component' && r.definition === name).length;
  return count >= 2 ? { name, count } : null;
}

/** 정의를 고른 것의 인스턴스 노드(나무가 없으면 빈 목록) */
export function selectedDefinitionNodes(d: SkpDoc, sel: Selection | null): number[] {
  return sel?.kind === 'definition' && d.tree ? definitionNodes(d.tree, sel.name) : [];
}

/** 고른 면·모서리의 범위 상자(맞춰 보기용, 다른 고른 것은 null) */
export function partBox(d: SkpDoc, sel: Selection | null): PartBox | null {
  if (sel?.kind === 'face') {
    const mesh = d.scene.meshes[sel.item];
    return mesh ? faceBox(mesh, sel.start, sel.count) : null;
  }
  if (sel?.kind === 'edge') {
    const line = d.scene.lines[sel.item];
    const e = selectedEdge(d, sel);
    return line && e ? segmentsBox(line, e.ranges) : null;
  }
  return null;
}

/** 고른 모서리(곡선이면 곡선 전체)의 길이·구간 */
export function selectedEdge(d: SkpDoc, sel: Extract<Selection, { kind: 'edge' }>): ReturnType<typeof edgeGeometry> {
  const line = d.scene.lines[sel.item];
  return line ? edgeGeometry(line, d.faceIndex.segmentCurves[sel.item] ?? null, sel.seg) : null;
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

/**
 * 구간 강조(코어 highlightRanges, 항목 id → 구간): 면 하나는 그 삼각형 구간, 모서리 하나는 그 선분(곡선이면 곡선 전체),
 * 나누지 않은 깊은 노드는 면 구간(그물 항목만). 그 밖에는 null
 */
export function selectionRanges(d: SkpDoc, sel: Selection | null): Map<string, IndexRange[]> | null {
  if (sel?.kind === 'face') {
    const mesh = d.scene.meshes[sel.item];
    return mesh ? new Map([[mesh.id, [{ start: sel.start, count: sel.count }]]]) : null;
  }
  if (sel?.kind === 'edge') {
    const line = d.scene.lines[sel.item];
    const e = selectedEdge(d, sel);
    return line && e ? new Map([[line.id, e.ranges]]) : null;
  }
  if (sel?.kind === 'definition' && d.tree) {
    // 나누지 않은 인스턴스 노드: 면·모서리 구간 모두(모서리 구간은 코어가 굵게 강조한다)
    const deep = selectedDefinitionNodes(d, sel).filter((n) => !isSplit(d.tree!, n));
    const out = new Map<string, IndexRange[]>();
    for (const [it, list] of mergeNodeRanges(d.tree, d.scene, deep)) {
      const id = it < d.scene.meshes.length ? d.scene.meshes[it]?.id : d.scene.lines[it - d.scene.meshes.length]?.id;
      if (id) out.set(id, list);
    }
    return out.size ? out : null;
  }
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

/**
 * 장면이 다시 보이게 한 노드의 반투명 숨긴 형상 구간(숨긴 형상 보기를 켰을 때 보통 색 그림과 겹치지 않게 숨긴다).
 * 항목 차례 → 구간, 숨긴 형상 항목(extras.hidden)만
 */
export function revealGhostRanges(d: SkpDoc): Map<number, IndexRange[]> {
  const t = d.tree;
  if (!t || !d.revealNodes.size || !d.showHidden || !d.extras || t.runsDropped) return new Map();
  const out = new Map<number, IndexRange[]>();
  for (const [item, list] of mergeNodeRanges(t, d.scene, d.revealNodes)) {
    const id = item < d.scene.meshes.length ? d.scene.meshes[item]?.id : d.scene.lines[item - d.scene.meshes.length]?.id;
    if (id && d.extras.hidden.has(id)) out.set(item, list);
  }
  return out;
}

/** 주석 종류가 지금 켜져 있는지 */
export function annotationShown(d: Pick<SkpDoc, 'showTexts' | 'showDimensions' | 'showGuides' | 'showSectionPlanes'>, kind: AnnotationKind): boolean {
  return kind === 'dimensions' ? d.showDimensions : kind === 'leaders' ? d.showTexts : kind === 'guides' ? d.showGuides : d.showSectionPlanes;
}

/** 항목(차례)이 지금 보여야 하는지: 부드러운·숨긴 형상 켜짐, 주석 켜짐, 숨긴 윗단계 항목·나무 노드(태그는 뷰어가 따로 가린다) */
export function itemVisible(d: SkpDoc, item: number): boolean {
  const s = d.scene;
  const id = item < s.meshes.length ? s.meshes[item]?.id : s.lines[item - s.meshes.length]?.id;
  if (id === undefined) return false;
  // 장면이 다시 보이는 숨김 인스턴스: 그 장면을 고른 동안만, 그 노드·조상을 숨기지 않았을 때
  const rn = d.revealOf.get(id);
  if (rn !== undefined) {
    if (!d.revealNodes.has(rn)) return false;
    if (d.tree && d.tree.parent[rn] !== undefined && d.tree.parent[rn]! >= 0 && hiddenByNodes(d.tree, d.hiddenNodes, d.tree.parent[rn]!)) return false;
    if (d.hiddenNodes.has(rn)) return false;
    if (d.tree && d.hiddenOutline.size) {
      const o = d.nodeOutline.get(nodePath(d.tree, rn)[0]!);
      if (o !== undefined && d.hiddenOutline.has(o)) return false;
    }
    return true;
  }
  const ak = d.annotationKind.get(id);
  if (ak) {
    if (!annotationShown(d, ak)) return false;
    const runs = d.annotationRuns.get(id);
    if (runs) {
      // 구간마다 놓인 노드를 안다: 모든 구간의 노드를 숨겼으면 묶음째(일부만이면 annotationHiddenRanges가 그 구간만)
      if (runs.node.every((n) => nodeHiddenByUser(d, n))) return false;
    } else {
      // 노드를 모르는 주석 선분(나무 없음): 모형에 바로 놓인 형상을 숨기면(분리해서 보기 등) 함께 숨긴다
      const loose = d.outline.findIndex((r) => r.kind === 'loose');
      if (loose >= 0 && d.hiddenOutline.has(loose)) return false;
    }
  }
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

/** 고른 것 설명의 재질 조각: 재질이 없는 면(앱이 붙인 이름 "기본 재질")은 그 이름만("재질 기본 재질"로 겹치지 않고, 다른 언어에서도 바뀌게) */
const materialPart = (name: string): string => (name === '기본 재질' ? name : `재질 ${name}`);

/** 고른 것 한 줄 설명(상태 막대·패널 아래) */
export function selectionText(d: SkpDoc, sel: Selection | null, pick: Pick3d | null = null): string {
  if (!sel) return '';
  const pickedMat = pick && pick.kind === 'mesh' ? d.meshMaterial.get(pick.id) : undefined;
  if (sel.kind === 'outline') {
    const r = d.outline[sel.index];
    if (!r) return '';
    // 모형에 바로 놓인 형상은 이름이 곧 설명이다("형상 모형에 바로 놓인 형상"처럼 겹치지 않게)
    const parts = [r.kind === 'loose' ? r.name : `${KIND_LABEL[r.kind]} ${r.name}${r.definition && r.definition !== r.name ? ` (${r.definition})` : ''}`];
    if (r.kind !== 'loose' && r.tag) parts.push(`태그 ${r.tag}`);
    if (pickedMat) parts.push(materialPart(pickedMat));
    parts.push(`면 ${r.faces.toLocaleString('ko-KR')}`);
    return parts.join(' · ');
  }
  if (sel.kind === 'node') {
    const t = d.tree;
    if (!t || sel.index < 0 || sel.index >= t.count) return '';
    const i = sel.index;
    const name = nodeName(t, i);
    const def = nodeDefinition(t, i);
    const parts = [`${treeKindLabel(t.kind[i]!)} ${name}${def && def !== name ? ` (${def})` : ''}`];
    if (t.parent[i]! >= 0) parts.push(`위치 ${nodePathText(d, t.parent[i]!)}`);
    const tag = nodeTag(t, i);
    if (tag) parts.push(`태그 ${tag}`);
    if (pickedMat) parts.push(materialPart(pickedMat));
    parts.push(`면 ${t.faces[i]!.toLocaleString('ko-KR')}`);
    return parts.join(' · ');
  }
  if (sel.kind === 'material') {
    const m = d.materials.find((x) => x.name === sel.name);
    return m ? `재질 ${m.name}${m.faces !== null ? ` · 면 ${m.faces.toLocaleString('ko-KR')}` : ''}` : '';
  }
  if (sel.kind === 'definition') {
    const n = d.tree ? selectedDefinitionNodes(d, sel).length : d.outline.filter((r) => r.definition === sel.name && r.kind === 'component').length;
    return `컴포넌트 정의 ${sel.name} · 놓인 수 ${n.toLocaleString('ko-KR')}개`;
  }
  if (sel.kind === 'face' || sel.kind === 'edge') {
    const e = selectionEntity(d);
    const k = mmPerSceneUnit(d.scene.units);
    const parts: string[] = [];
    if (e.kind === 'face') parts.push(`면 · 넓이 ${formatArea((e.area ?? 0) * k * k, d.units)}`);
    else {
      parts.push(`${e.segments && e.segments > 1 ? '곡선' : '모서리'} · 길이 ${formatLength((e.length ?? 0) * k, d.units)}`);
      if (e.radius) parts.push(`반지름 ${formatLength(e.radius * k, d.units)}`);
    }
    if (e.material) parts.push(materialPart(e.material));
    if (e.tag) parts.push(`태그 ${e.tag}`);
    return parts.join(' · ');
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

/** 나무 노드 kind 숫자 → 이름(해석기 SkpTree: 0 그룹, 1 컴포넌트, 2 그림) */
export function treeKindLabel(kind: number): string {
  return kind === 0 ? '그룹' : kind === 2 ? '그림' : '컴포넌트';
}

/**
 * 노드를 사용자가 보기에서 숨겼는지(나무 체크·숨기기·분리해서 보기 — 노드나 조상, 그 노드의 윗단계 목록 항목). 노드 -1(모형에 바로 놓인 것)은
 * "바로 놓인 형상" 목록 항목을 숨겼을 때. 태그는 보지 않는다(주석 선분은 태그 묶음이라 뷰어가 따로 가린다)
 */
export function nodeHiddenByUser(d: Pick<SkpDoc, 'tree' | 'outline' | 'hiddenOutline' | 'hiddenNodes' | 'nodeOutline'>, node: number): boolean {
  const t = d.tree;
  if (node < 0 || !t || node >= t.count) {
    const loose = d.outline.findIndex((r) => r.kind === 'loose');
    return loose >= 0 && d.hiddenOutline.has(loose);
  }
  if (hiddenByNodes(t, d.hiddenNodes, node)) return true;
  const o = d.nodeOutline.get(nodePath(t, node)[0]!);
  return o !== undefined && d.hiddenOutline.has(o);
}

/**
 * 주석 선분 묶음에서 숨긴 노드의 구간(항목 차례 → 선분 구간). 묶음의 모든 구간을 숨겼으면 넣지 않는다(itemVisible이 묶음째 숨긴다)
 */
export function annotationHiddenRanges(d: SkpDoc): Map<number, IndexRange[]> {
  const out = new Map<number, IndexRange[]>();
  if (!d.annotationRuns.size || (!d.hiddenNodes.size && !d.hiddenOutline.size)) return out;
  const memo = new Map<number, boolean>();
  const hidden = (n: number): boolean => {
    let v = memo.get(n);
    if (v === undefined) memo.set(n, (v = nodeHiddenByUser(d, n)));
    return v;
  };
  for (const [id, runs] of d.annotationRuns) {
    const li = d.lineIndex.get(id);
    const line = li === undefined ? undefined : d.scene.lines[li];
    if (!line) continue;
    const total = Math.floor(line.positions.length / 6);
    const list: IndexRange[] = [];
    let all = true;
    for (let k = 0; k < runs.node.length; k++) {
      if (!hidden(runs.node[k]!)) {
        all = false;
        continue;
      }
      const start = runs.start[k]!;
      const end = k + 1 < runs.start.length ? runs.start[k + 1]! : total;
      if (end <= start) continue;
      const last = list[list.length - 1];
      if (last && last.start + last.count === start) last.count += end - start;
      else list.push({ start, count: end - start });
    }
    if (list.length && !all) out.set(d.scene.meshes.length + li!, list);
  }
  return out;
}

/**
 * 라벨용: 노드(-1 = 모형 바로 아래)가 보기에서 숨었는지 — 노드·조상이 숨었거나, 노드·조상 인스턴스의 태그가 숨었으면 참.
 * 모형 바로 아래 글은 바로 놓인 형상(loose)을 숨겼을 때 함께 숨긴다.
 */
export function nodeHiddenForLabels(d: SkpDoc, node: number): boolean {
  const t = d.tree;
  if (nodeHiddenByUser(d, node)) return true;
  if (node < 0 || !t || node >= t.count) return false;
  for (let n = node, k = 0; n >= 0 && k < 64; n = t.parent[n]!, k++) {
    const tag = t.tagNames[t.tag[n]!];
    if (tag && tagHidden(d, tag)) return true;
  }
  return false;
}

/** 정의 이름 → 나무에 놓인 수(펼친 배치 기준) */
function definitionPlacements(d: SkpDoc): Map<string, number> {
  const out = new Map<string, number>();
  const t = d.tree;
  if (!t) return out;
  for (let i = 0; i < t.count; i++) {
    const name = nodeDefinition(t, i);
    if (name) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
}

/** 고른 면·모서리를 낸 나무 노드의 경로(누른 자리가 있을 때) */
function pickPath(d: SkpDoc): string | null {
  const n = d.pick ? pickDeepest(d, d.pick) : null;
  return n !== null && n >= 0 ? nodePathText(d, n) : null;
}

/** 지금 고른 것(없으면 모형) → 엔티티 정보 입력 */
export function selectionEntity(d: SkpDoc): EntityInput {
  const sel = d.selection;
  if (sel?.kind === 'face') {
    const mesh = d.scene.meshes[sel.item];
    if (mesh) {
      const g = faceGeometry(mesh, sel.start, sel.count);
      return { kind: 'face', area: g.area, material: d.meshMaterial.get(mesh.id) ?? null, tag: mesh.group ?? null, path: pickPath(d) };
    }
  }
  if (sel?.kind === 'definition') {
    const t = d.tree;
    const nodes = selectedDefinitionNodes(d, sel);
    const rows = t ? [] : d.outline.filter((r) => r.definition === sel.name && r.kind === 'component');
    const count = t ? nodes.length : rows.length;
    const e: EntityInput = { kind: 'component', count, definition: sel.name, instances: count };
    if (t) {
      let faces = 0;
      let area = 0;
      for (const n of nodes) {
        faces += t.faces[n] ?? 0;
        area += d.treeInfo?.area[n] ?? 0;
      }
      e.faces = faces;
      if (d.treeInfo) e.area = area;
      const first = nodes[0];
      if (first !== undefined && d.treeInfo) {
        const def = t.definition[first]!;
        e.description = d.treeInfo.definitionDescription[def] || null;
        e.definitionGuid = d.treeInfo.definitionGuid[def] || null;
      }
    } else {
      e.faces = rows.reduce((s, r) => s + r.faces, 0);
      e.area = rows.reduce((s, r) => s + (r.area ?? 0), 0);
    }
    return e;
  }
  if (sel?.kind === 'edge') {
    const line = d.scene.lines[sel.item];
    const e = selectedEdge(d, sel);
    if (line && e)
      return {
        kind: 'edge',
        length: e.length,
        radius: e.radius,
        segments: e.segments,
        tag: line.group ?? null,
        path: pickPath(d),
        extra: e.curve ? [{ label: '곡선', value: e.closed ? '닫힌 곡선' : '열린 곡선' }] : [],
      };
  }
  const node = selectedNode(d, sel);
  if (node !== null && node >= 0 && d.tree) {
    const e = nodeEntity(d.tree, node, d.treeInfo, d.attributes, {
      instances: definitionPlacements(d),
      hidden: d.hiddenNodes.has(node) || (d.tree.flags[node]! & 1) !== 0,
    });
    if (e) {
      if (d.tree.kind[node] === 2) e.kind = 'image';
      const mat = d.pick && d.pick.kind === 'mesh' ? d.meshMaterial.get(d.pick.id) : undefined;
      if (mat) e.material = mat;
      return e;
    }
  }
  if (sel?.kind === 'outline') {
    const r = d.outline[sel.index];
    if (r) return { kind: r.kind, name: r.name, definition: r.definition, tag: r.kind === 'loose' ? null : r.tag, faces: r.faces, edges: r.edges, area: r.area, hidden: d.hiddenOutline.has(sel.index) };
  }
  if (sel?.kind === 'material') {
    const m = d.materials.find((x) => x.name === sel.name);
    if (m)
      return {
        kind: 'material',
        name: m.name,
        faces: m.faces,
        area: m.area,
        extra: [
          { label: '색', value: `RGB ${m.color.slice(0, 3).map((c) => Math.round(c * 255)).join(', ')}` },
          ...(m.color[3] < 0.999 ? [{ label: '불투명도', value: `${Math.round(m.color[3] * 100)} %` }] : []),
          // 무늬를 3D에 입혔는지는 목록 칩(무늬 · 무늬 · 평균색)과 같은 기준(입힌 무늬 id가 장면에 있는지)으로 적는다
          ...(m.textured ? [{ label: '무늬', value: m.texture ? '그림 재질(3D에 무늬를 입힘)' : '그림 재질(3D는 평균색)' }] : []),
        ],
      };
  }
  const attrs = d.modelAttrs !== null ? (d.attributes[d.modelAttrs] ?? null) : null;
  return { kind: 'model', name: d.modelName ?? d.name, description: d.modelDescription, faces: d.info.faces, edges: d.info.edges, attrs };
}

/** 측정 결과 한 줄(모형 단위) */
export function measureText(m: MeasureToolResult, units: UnitsDisplay, mmPerUnit: number): string {
  return m.kind === 'tape' ? `거리 ${formatLength(m.distance * mmPerUnit, units)}` : `각도 ${formatAngle(m.angle, units)}`;
}

/** 측정 기록 한 줄(복사용): "거리 1234 mm (dx … · dy … · dz …)" 또는 "각도 45.0°" */
export function measureLine(m: MeasureToolResult, units: UnitsDisplay, mmPerUnit: number): string {
  const axes = measureAxes(m, units, mmPerUnit);
  return axes ? `${measureText(m, units, mmPerUnit)} (${axes})` : measureText(m, units, mmPerUnit);
}

/** 측정 기록 칸 수 */
export const MEASURE_LOG_LIMIT = 10;

/** 측정 기록에 결과를 더한다(새것이 앞, 바로 앞과 같은 결과는 다시 넣지 않는다, MEASURE_LOG_LIMIT개까지) */
export function pushMeasure(log: readonly MeasureToolResult[], m: MeasureToolResult | null): MeasureToolResult[] {
  if (!m) return [...log];
  const last = log[0];
  const same =
    !!last &&
    last.kind === m.kind &&
    (m.kind === 'tape'
      ? last.kind === 'tape' && [...last.a, ...last.b].every((v, i) => v === [...m.a, ...m.b][i])
      : last.kind === 'protractor' && [...last.center, ...last.a, ...last.b].every((v, i) => v === [...m.center, ...m.a, ...m.b][i]));
  return same ? [...log] : [m, ...log].slice(0, MEASURE_LOG_LIMIT);
}

/** 줄자 결과의 축 성분(모형 단위, 각도기는 null) */
export function measureAxes(m: MeasureToolResult, units: UnitsDisplay, mmPerUnit: number): string | null {
  if (m.kind !== 'tape') return null;
  const f = (v: number): string => formatLength(v * mmPerUnit, units);
  return `dx ${f(m.dx)} · dy ${f(m.dy)} · dz ${f(m.dz)}`;
}
