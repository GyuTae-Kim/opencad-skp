/**
 * 고른 것의 정보 행 만들기(순수 함수, DOM 없음) — SketchUp 엔티티 정보 창과 같은 차례로 이름·정의·놓인 수·태그·재질·크기·넓이·
 * 설명·GUID·상태를 행으로, 속성 사전을 사전 이름·열쇠 차례의 목록으로 낸다.
 *
 * 입력은 꾸러미 꼴(EntityInput)이라 그룹·컴포넌트 노드뿐 아니라 재질·바로 놓인 형상·모형에도 쓴다(없는 칸은 행을 만들지 않는다).
 * 길이·넓이는 장면 단위로 받아 mm로 바꾼 뒤 모형 단위 글(units.ts)로 쓴다.
 * 규칙은 PRISME 서비스 SKP 뷰어(skp_viewer_model.js entityInfo, skp_viewer_trays.js entityRows·attributeText)에서 옮겼다.
 */
import type { SkpAttrDictsMeta, SkpAttrValueMeta, SkpTreeInfo } from '../meta';
import { formatArea, formatLength, withLengthUnit, type UnitsDisplay } from './units';
import { nodeDefinition, nodeName, nodePath, nodeTag, type TreeData } from './tree';

/** 속성 값 글은 이 글자 수에서 자른다 */
export const ATTR_VALUE_CHARS = 2000;
/** 사전 하나에서 보일 열쇠 수 · 보일 사전 수(나머지는 more로 센다) */
export const ATTR_KEY_LIMIT = 1000;
export const ATTR_DICT_LIMIT = 200;

export type EntityKind = 'group' | 'component' | 'image' | 'loose' | 'material' | 'face' | 'edge' | 'text' | 'dimension' | 'section' | 'model' | 'mixed';

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  group: '그룹',
  component: '컴포넌트',
  image: '그림',
  loose: '형상',
  material: '재질',
  face: '면',
  edge: '모서리',
  text: '문자',
  dimension: '치수',
  section: '단면',
  model: '모형',
  mixed: '여러 종류',
};

/** 정보를 만들 고른 것(모두 선택 칸 — 없는 칸은 행을 만들지 않는다) */
export interface EntityInput {
  kind: EntityKind;
  /** 고른 수(여럿이면 제목에 "n개") */
  count?: number;
  /** 인스턴스 이름(그룹·컴포넌트·그림) 또는 이름 */
  name?: string | null;
  /** 정의 이름 */
  definition?: string | null;
  /** 그 정의가 모형에 놓인 수 */
  instances?: number | null;
  /** 나무 경로("집 › 1층") */
  path?: string | null;
  tag?: string | null;
  /** 재질 이름. 칸이 있고 null이면 "기본값" */
  material?: string | null;
  /** 인스턴스(또는 그것 자신)의 GUID */
  guid?: string | null;
  /** 정의 GUID(컴포넌트) */
  definitionGuid?: string | null;
  description?: string | null;
  /** 가로·세로·높이(장면 단위) */
  size?: readonly number[] | null;
  /** 넓이(장면 단위²) */
  area?: number | null;
  /** 길이(장면 단위) */
  length?: number | null;
  faces?: number | null;
  edges?: number | null;
  locked?: boolean | null;
  hidden?: boolean | null;
  /** 인스턴스(또는 그것 자신)의 속성 사전 */
  attrs?: SkpAttrDictsMeta | null;
  /** 정의의 속성 사전 */
  definitionAttrs?: SkpAttrDictsMeta | null;
  /** 더 붙일 행(재질 색 등, 끝에 붙는다) */
  extra?: readonly InfoRow[];
}

export interface InfoRow {
  label: string;
  value: string;
  /** 도움말(전체 글·단위를 붙인 글) */
  title?: string;
}

export interface AttrDictView {
  name: string;
  /** 'instance' = 고른 것 자신, 'definition' = 그 정의 */
  source: 'instance' | 'definition';
  /** [열쇠, 값 글] — 열쇠 차례 */
  entries: [string, string][];
  /** ATTR_KEY_LIMIT를 넘어 뺀 열쇠 수 */
  more: number;
}

export interface EntityInfo {
  title: string;
  rows: InfoRow[];
  dicts: AttrDictView[];
  /** ATTR_DICT_LIMIT를 넘어 뺀 사전 수 */
  moreDicts: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const byText = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** 속성 값 → 화면 글(목록은 [a, b], 객체는 JSON, 긴 글은 ATTR_VALUE_CHARS에서 자르고 …) */
export function attributeText(value: unknown): string {
  let s: string;
  if (value === null || value === undefined) s = '';
  else if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else if (typeof value === 'number') s = Number.isInteger(value) || !Number.isFinite(value) ? String(value) : String(Number(value.toPrecision(12)));
  else if (Array.isArray(value)) s = `[${value.map((x) => attributeText(x)).join(', ')}]`;
  else if (typeof value === 'object') {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  } else s = String(value);
  return s.length > ATTR_VALUE_CHARS ? `${s.slice(0, ATTR_VALUE_CHARS)}…` : s;
}

/** 속성 사전 → 화면 목록(사전 이름·열쇠는 글 차례, 객체가 아닌 사전은 뺀다) */
export function attributeDicts(dicts: SkpAttrDictsMeta | null | undefined, source: AttrDictView['source'] = 'instance'): AttrDictView[] {
  if (!dicts || typeof dicts !== 'object') return [];
  const out: AttrDictView[] = [];
  for (const name of Object.keys(dicts).sort(byText)) {
    const d = (dicts as Record<string, unknown>)[name];
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    const keys = Object.keys(d).sort(byText);
    const shown = keys.slice(0, ATTR_KEY_LIMIT);
    out.push({
      name,
      source,
      entries: shown.map((k) => [k, attributeText((d as Record<string, SkpAttrValueMeta>)[k])]),
      more: keys.length - shown.length,
    });
  }
  return out;
}

/** 고른 것의 제목("컴포넌트", 여럿이면 "면 3개") */
export function entityTitle(e: Pick<EntityInput, 'kind' | 'count'>): string {
  const label = ENTITY_KIND_LABEL[e.kind] ?? '고른 것';
  const n = isNum(e.count) ? Math.floor(e.count) : 1;
  return n > 1 ? `${label} ${n.toLocaleString('ko-KR')}개` : label;
}

const INSTANCE_KINDS = new Set<EntityKind>(['group', 'component', 'image']);

/**
 * 고른 것 → 정보(제목·행·속성 사전).
 * mmPerUnit은 장면 한 단위의 mm(mmPerSceneUnit(scene.units)). 단위를 숨긴 모형이면 길이 행의 도움말에 단위를 붙인다.
 */
export function entityInfo(e: EntityInput, units: UnitsDisplay, mmPerUnit: number): EntityInfo {
  const k = isNum(mmPerUnit) && mmPerUnit > 0 ? mmPerUnit : 1;
  const rows: InfoRow[] = [];
  const add = (label: string, value: string, title?: string): void => {
    if (!value) return;
    rows.push(title && title !== value ? { label, value, title } : { label, value });
  };
  const length = (v: number): string => formatLength(v * k, units);
  const instance = INSTANCE_KINDS.has(e.kind);
  const name = text(e.name);
  const definition = text(e.definition);
  add(instance ? '인스턴스' : '이름', name);
  // 그룹 정의 이름("Group#3")은 SketchUp도 보이지 않는다
  if (definition && e.kind !== 'group' && (instance || definition !== name)) add('정의', definition);
  if (e.kind === 'component' && isNum(e.instances) && e.instances >= 0) add('놓인 수', `${Math.floor(e.instances).toLocaleString('ko-KR')}개`);
  add('위치', text(e.path));
  add('태그', text(e.tag));
  if ('material' in e && e.material !== undefined) add('재질', text(e.material) || '기본값');
  if (Array.isArray(e.size) && e.size.length >= 3 && e.size.slice(0, 3).every(isNum)) {
    const parts = e.size.slice(0, 3).map((v) => length(Math.abs(v)));
    const value = parts.join(' × ');
    add('크기', value, units.suppressUnits ? parts.map((p) => withLengthUnit(p, units)).join(' × ') : undefined);
  }
  if (isNum(e.length) && e.length >= 0) {
    const value = length(e.length);
    add('길이', value, units.suppressUnits ? withLengthUnit(value, units) : undefined);
  }
  if (isNum(e.area) && e.area > 0) add('넓이', formatArea(e.area * k * k, units));
  if (isNum(e.faces) && e.faces >= 0) add('면', Math.floor(e.faces).toLocaleString('ko-KR'));
  if (isNum(e.edges) && e.edges >= 0) add('모서리', Math.floor(e.edges).toLocaleString('ko-KR'));
  const description = text(e.description);
  add('설명', description, description);
  add('GUID', text(e.guid));
  if (e.kind !== 'group' && text(e.definitionGuid) !== text(e.guid)) add('정의 GUID', text(e.definitionGuid));
  const state = [e.hidden === true ? '숨김' : '', e.locked === true ? '잠김' : ''].filter(Boolean).join(' · ');
  add('상태', state);
  for (const r of e.extra ?? []) if (r && r.label && r.value) rows.push({ ...r });
  const all = [...attributeDicts(e.attrs, 'instance'), ...attributeDicts(e.definitionAttrs, 'definition')];
  const dicts = all.slice(0, ATTR_DICT_LIMIT);
  return { title: entityTitle(e), rows, dicts, moreDicts: all.length - dicts.length };
}

/** meta.attributes 차례 → 사전(차례가 없거나 -1이면 null) */
function dictsAt(attributes: readonly SkpAttrDictsMeta[] | null | undefined, index: number | undefined): SkpAttrDictsMeta | null {
  if (!attributes || index === undefined || !Number.isInteger(index) || index < 0) return null;
  const d = attributes[index];
  return d && typeof d === 'object' ? d : null;
}

/**
 * 나무 노드 → 정보 입력(meta.tree + meta.treeInfo + meta.attributes). 크기·넓이·GUID·잠김·속성은 treeInfo가 있을 때만.
 * instances는 정의 이름 → 놓인 수(treeDefinitionCounts 등, 없으면 행을 만들지 않는다).
 * hidden은 부른 쪽이 넘긴다(파일 숨김 깃발 NODE_HIDDEN 또는 보기에서 숨김).
 */
export function nodeEntity(
  t: TreeData,
  node: number,
  info: SkpTreeInfo | null | undefined,
  attributes: readonly SkpAttrDictsMeta[] | null | undefined,
  o: { instances?: ReadonlyMap<string, number>; hidden?: boolean } = {},
): EntityInput | null {
  if (!Number.isInteger(node) || node < 0 || node >= t.count) return null;
  const definition = nodeDefinition(t, node);
  const parent = t.parent[node]!;
  const e: EntityInput = {
    kind: t.kind[node] === 0 ? 'group' : 'component',
    name: t.names[node] || '',
    definition,
    instances: o.instances?.get(definition) ?? null,
    path: parent >= 0 ? nodePath(t, parent).map((n) => nodeName(t, n)).join(' › ') : null,
    tag: nodeTag(t, node),
    faces: t.faces[node] ?? null,
    edges: t.edges[node] ?? null,
    hidden: o.hidden ?? null,
  };
  if (!info) return e;
  if (info.size && info.size.length >= (node + 1) * 3) e.size = [info.size[node * 3]!, info.size[node * 3 + 1]!, info.size[node * 3 + 2]!];
  if (info.area && node < info.area.length) e.area = info.area[node]!;
  if (info.locked && node < info.locked.length) e.locked = info.locked[node] !== 0;
  if (info.guid && typeof info.guid[node] === 'string') e.guid = info.guid[node] || null;
  if (info.attrs && node < info.attrs.length) e.attrs = dictsAt(attributes, info.attrs[node]);
  const def = t.definition[node]!;
  if (def >= 0) {
    if (info.definitionDescription && typeof info.definitionDescription[def] === 'string') e.description = info.definitionDescription[def] || null;
    // 정의 GUID는 컴포넌트 정의에만 뜻이 있다(그룹은 entityInfo가 행을 만들지 않는다)
    if (info.definitionGuid && typeof info.definitionGuid[def] === 'string') e.definitionGuid = info.definitionGuid[def] || null;
    if (info.definitionAttrs && def < info.definitionAttrs.length) e.definitionAttrs = dictsAt(attributes, info.definitionAttrs[def]);
  }
  return e;
}
