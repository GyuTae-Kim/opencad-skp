/**
 * 여러 단계 그룹·컴포넌트 나무(해석기의 meta.tree)를 화면에서 쓰는 도움(순수 함수, DOM 없음).
 *
 * - 3D 고르기: 고른 그물 삼각형(또는 선분)을 구간(runs)에서 찾아 가장 안쪽 노드를 얻고,
 *   "펼친 단계" 방식이면 뿌리에서 내려가며 처음 만나는 접힌 노드를 고른다(SketchUp에서 그룹에 들어가 고르는 것과 비슷하게).
 * - 강조·숨기기·맞춰 보기: 따로 나눈 노드는 항목 id(그물·모서리)로, 나누지 않은 깊은 노드는 구간에서 모은 선분·범위로 한다.
 */
import type { Box3, IndexRange, Scene3d } from 'opencad-viewer3d';

/** 해석기 SkpTree와 같은 꼴(화면 쪽에서 검사해 받는다) */
export interface TreeData {
  count: number;
  parent: Int32Array;
  depth: Uint8Array;
  kind: Uint8Array;
  flags: Uint8Array;
  names: string[];
  definition: Int32Array;
  definitionNames: string[];
  tag: Int32Array;
  tagNames: string[];
  faces: Uint32Array;
  edges: Uint32Array;
  firstChild: Int32Array;
  childCount: Uint32Array;
  rootCount: number;
  meshFirst: Int32Array;
  meshEnd: Int32Array;
  lineFirst: Int32Array;
  lineEnd: Int32Array;
  runFirst: Uint32Array;
  runEnd: Uint32Array;
  runItem: Uint32Array;
  runStart: Uint32Array;
  runNode: Int32Array;
  runsDropped: boolean;
  itemOwner: Int32Array;
  splitDepth: number;
  listedDepth: number;
  unlisted: boolean;
}

/** 해석기와 같은 깃발 값 */
export const NODE_HIDDEN = 1;
export const NODE_MORE = 2;

/** 화면 쪽 나무: 자료 + 항목 차례 찾기 + 구간 끝(처음 쓸 때 만든다) */
export interface TreeView extends TreeData {
  /** 항목 id → 항목 차례(그물 차례, 모서리는 그물 수 + 모서리 차례) */
  itemIndex: Map<string, number>;
  meshCount: number;
  /** 항목마다 구간 차례들(시작 차례대로) — 처음 고를 때 만든다 */
  itemRuns?: Map<number, number[]>;
  /** 구간마다 끝(같은 항목 다음 구간의 시작, 없으면 항목 끝) */
  runStop?: Uint32Array;
}

const isTyped = <T>(v: unknown, C: { new (...a: never[]): T }, n: number): v is T => v instanceof C && (v as unknown as { length: number }).length === n;

/** scene.meta.tree를 검사해 받는다(꼴이 다르거나 항목 수가 맞지 않으면 null) */
export function readTree(scene: Scene3d): TreeView | null {
  const m = scene.meta;
  const t = m && typeof m === 'object' ? (m.tree as Partial<TreeData> | undefined) : undefined;
  if (!t || typeof t !== 'object' || typeof t.count !== 'number' || t.count <= 0) return null;
  const n = t.count;
  const items = scene.meshes.length + scene.lines.length;
  const ok =
    isTyped(t.parent, Int32Array, n) &&
    isTyped(t.depth, Uint8Array, n) &&
    isTyped(t.kind, Uint8Array, n) &&
    isTyped(t.flags, Uint8Array, n) &&
    Array.isArray(t.names) &&
    t.names.length === n &&
    isTyped(t.definition, Int32Array, n) &&
    Array.isArray(t.definitionNames) &&
    isTyped(t.tag, Int32Array, n) &&
    Array.isArray(t.tagNames) &&
    isTyped(t.faces, Uint32Array, n) &&
    isTyped(t.edges, Uint32Array, n) &&
    isTyped(t.firstChild, Int32Array, n) &&
    isTyped(t.childCount, Uint32Array, n) &&
    isTyped(t.meshFirst, Int32Array, n) &&
    isTyped(t.meshEnd, Int32Array, n) &&
    isTyped(t.lineFirst, Int32Array, n) &&
    isTyped(t.lineEnd, Int32Array, n) &&
    isTyped(t.runFirst, Uint32Array, n) &&
    isTyped(t.runEnd, Uint32Array, n) &&
    t.runItem instanceof Uint32Array &&
    t.runStart instanceof Uint32Array &&
    t.runNode instanceof Int32Array &&
    t.runItem.length === t.runStart.length &&
    t.runItem.length === t.runNode.length &&
    isTyped(t.itemOwner, Int32Array, items) &&
    typeof t.rootCount === 'number';
  if (!ok) return null;
  const itemIndex = new Map<string, number>();
  scene.meshes.forEach((x, i) => itemIndex.set(x.id, i));
  scene.lines.forEach((x, i) => itemIndex.set(x.id, scene.meshes.length + i));
  return { ...(t as TreeData), itemIndex, meshCount: scene.meshes.length };
}

/** 노드 표시 이름(인스턴스 이름, 없으면 정의 이름) */
export function nodeName(t: TreeData, i: number): string {
  return t.names[i] || t.definitionNames[t.definition[i]!] || '(이름 없음)';
}

export function nodeDefinition(t: TreeData, i: number): string {
  return t.definitionNames[t.definition[i]!] ?? '';
}

export function nodeTag(t: TreeData, i: number): string {
  return t.tagNames[t.tag[i]!] ?? '';
}

/** 뿌리 쪽에서 i까지의 노드들 */
export function nodePath(t: TreeData, i: number): number[] {
  const out: number[] = [];
  for (let k = i; k >= 0 && out.length < 300; k = t.parent[k]!) out.push(k);
  return out.reverse();
}

/** 자식 노드 차례(i = -1이면 모형 바로 아래) */
export function childrenOf(t: TreeData, i: number): number[] {
  const first = i < 0 ? 0 : t.firstChild[i]!;
  const n = i < 0 ? t.rootCount : t.childCount[i]!;
  if (first < 0) return [];
  return Array.from({ length: n }, (_, k) => first + k);
}

/** a가 b의 조상(또는 같음)인지 */
export function isAncestor(t: TreeData, a: number, b: number): boolean {
  for (let k = b; k >= 0; k = t.parent[k]!) if (k === a) return true;
  return false;
}

/** 따로 나눈 노드인지(자기 항목으로 강조·숨기기 가능) */
export function isSplit(t: TreeData, i: number): boolean {
  return t.meshFirst[i]! >= 0 && t.lineFirst[i]! >= 0;
}

function itemTotal(scene: Scene3d, meshCount: number, item: number): number {
  if (item < meshCount) {
    const m = scene.meshes[item]!;
    return Math.floor((m.indices ? m.indices.length : m.positions.length / 3) / 3);
  }
  const l = scene.lines[item - meshCount];
  return l ? Math.floor(l.positions.length / 6) : 0;
}

/** 항목별 구간 목록과 구간 끝을 처음 쓸 때 만든다 */
function ensureRuns(t: TreeView, scene: Scene3d): void {
  if (t.itemRuns && t.runStop) return;
  const itemRuns = new Map<number, number[]>();
  const stop = new Uint32Array(t.runItem.length);
  const last = new Map<number, number>();
  for (let r = 0; r < t.runItem.length; r++) {
    const it = t.runItem[r]!;
    let list = itemRuns.get(it);
    if (!list) itemRuns.set(it, (list = []));
    list.push(r);
    const prev = last.get(it);
    if (prev !== undefined) stop[prev] = t.runStart[r]!;
    last.set(it, r);
  }
  for (const [it, r] of last) stop[r] = itemTotal(scene, t.meshCount, it);
  t.itemRuns = itemRuns;
  t.runStop = stop;
}

/**
 * 고른 항목(id)과 그 안의 삼각형·선분 차례 → 그것을 낸 가장 안쪽 노드.
 * -1 = 모형에 바로 놓인 형상, null = 모름(구간이 없거나 모르는 항목)
 */
export function deepestNodeAt(t: TreeView, scene: Scene3d, id: string, local: number): number | null {
  if (t.runsDropped) return null;
  const item = t.itemIndex.get(id);
  if (item === undefined) return null;
  ensureRuns(t, scene);
  const list = t.itemRuns!.get(item);
  if (!list?.length) return null;
  // 시작 ≤ local인 마지막 구간
  let lo = 0;
  let hi = list.length - 1;
  if (local < t.runStart[list[0]!]!) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.runStart[list[mid]!]! <= local) lo = mid;
    else hi = mid - 1;
  }
  return t.runNode[list[lo]!]!;
}

/** 3D 누르기 방식: open = 펼친 단계, deepest = 가장 안쪽 노드, face = 면·모서리 하나(나무 단계는 deepest처럼 본다) */
export type PickMode = 'open' | 'deepest' | 'face';

/**
 * 가장 안쪽 노드 → 고를 노드. open: 뿌리에서 내려가며 처음 만나는 접힌(펼치지 않은) 노드, 모두 펼쳤으면 가장 안쪽.
 * deepest: 가장 안쪽 그대로.
 */
export function levelNode(t: TreeData, deepest: number, expanded: ReadonlySet<number>, mode: PickMode): number {
  if (mode !== 'open' || deepest < 0) return deepest;
  for (const n of nodePath(t, deepest)) if (!expanded.has(n)) return n;
  return deepest;
}

/** 따로 나눈 노드의 항목 id(안쪽 포함). 나누지 않은 노드는 빈 목록 */
export function nodeItemIds(t: TreeData, scene: Scene3d, i: number): string[] {
  if (!isSplit(t, i)) return [];
  const ids: string[] = [];
  for (let k = t.meshFirst[i]!; k < t.meshEnd[i]!; k++) ids.push(scene.meshes[k]!.id);
  for (let k = t.lineFirst[i]!; k < t.lineEnd[i]!; k++) ids.push(scene.lines[k]!.id);
  return ids;
}

/** 강조 선분 수 한도(이보다 많으면 앞부분만) */
export const MAX_HIGHLIGHT_SEGMENTS = 2_000_000;

/** 정렬된 구간 목록에 구간을 더한다(맞닿거나 겹치면 합친다). list는 시작 차례로 정렬돼 있어야 한다 */
export function addRange(list: IndexRange[], start: number, count: number): void {
  if (count <= 0) return;
  const last = list[list.length - 1];
  if (last && start >= last.start && start <= last.start + last.count) {
    last.count = Math.max(last.count, start + count - last.start);
    return;
  }
  list.push({ start, count });
  if (last && start < last.start) normalizeRanges(list);
}

/** 정렬하고 겹치거나 맞닿은 구간을 합친다(제자리) */
export function normalizeRanges(list: IndexRange[]): IndexRange[] {
  list.sort((a, b) => a.start - b.start);
  let w = 0;
  for (const r of list) {
    if (r.count <= 0) continue;
    const prev = w > 0 ? list[w - 1]! : null;
    if (prev && r.start <= prev.start + prev.count) prev.count = Math.max(prev.count, r.start + r.count - prev.start);
    else list[w++] = { start: r.start, count: r.count };
  }
  list.length = w;
  return list;
}

/** a에서 b(둘 다 합친 구간 목록)를 뺀다 */
export function subtractRanges(a: readonly IndexRange[], b: readonly IndexRange[] | undefined): IndexRange[] {
  if (!b?.length) return a.map((r) => ({ ...r }));
  const out: IndexRange[] = [];
  let j = 0;
  for (const r of a) {
    let s = r.start;
    const e = r.start + r.count;
    while (j < b.length && b[j]!.start + b[j]!.count <= s) j++;
    let k = j;
    while (s < e && k < b.length && b[k]!.start < e) {
      const h = b[k]!;
      if (h.start > s) out.push({ start: s, count: h.start - s });
      s = Math.max(s, h.start + h.count);
      k++;
    }
    if (s < e) out.push({ start: s, count: e - s });
  }
  return out;
}

/**
 * 노드 안쪽 전부의 구간(항목 차례 → 삼각형·선분 번호 구간). 나누지 않은 깊은 노드 숨기기·강조(코어 setHiddenRanges·highlightRanges)용.
 * 구간이 없으면(버렸으면) 빈 Map
 */
export function nodeRanges(t: TreeView, scene: Scene3d, i: number): Map<number, IndexRange[]> {
  const out = new Map<number, IndexRange[]>();
  if (t.runsDropped) return out;
  ensureRuns(t, scene);
  const stop = t.runStop!;
  for (let r = t.runFirst[i]!; r < t.runEnd[i]!; r++) {
    const it = t.runItem[r]!;
    let list = out.get(it);
    if (!list) out.set(it, (list = []));
    addRange(list, t.runStart[r]!, stop[r]! - t.runStart[r]!);
  }
  return out;
}

/** 여러 노드의 구간을 항목마다 합친다 */
export function mergeNodeRanges(t: TreeView, scene: Scene3d, nodes: Iterable<number>): Map<number, IndexRange[]> {
  const out = new Map<number, IndexRange[]>();
  for (const n of nodes)
    for (const [it, list] of nodeRanges(t, scene, n)) {
      const cur = out.get(it);
      if (cur) {
        cur.push(...list);
        normalizeRanges(cur);
      } else out.set(it, list);
    }
  return out;
}

/** 강조 선분: 위치(origin 기준 좌표)와 그 원점(코어 v0.4 setHighlightSegments의 origin) */
export interface SegmentSet {
  positions: Float32Array;
  origin?: [number, number, number];
}

type Origin = readonly [number, number, number] | undefined;

/**
 * 나누지 않은 노드 강조용 선분: 노드 안쪽 구간의 모서리 선분을 모은다. 보이는 항목만(visible).
 * 모서리가 하나도 없으면(면만 있는 노드) 삼각형 변으로 대신한다. 없으면 null.
 * 항목마다 묶음 원점(origin)이 다를 수 있어, 처음 만난 항목의 원점을 공통 원점으로 삼고 차이를 double로 더해 적는다.
 */
export function nodeSegments(
  t: TreeView,
  scene: Scene3d,
  i: number,
  visible: (item: number) => boolean = () => true,
  cap = MAX_HIGHLIGHT_SEGMENTS,
  hidden?: ReadonlyMap<number, readonly IndexRange[]>,
): SegmentSet | null {
  if (t.runsDropped) return null;
  // 숨긴 구간을 뺀 노드 구간(항목마다)
  const own = nodeRanges(t, scene, i);
  const parts: [number, IndexRange[]][] = [];
  for (const [it, list] of own) {
    if (!visible(it)) continue;
    const left = subtractRanges(list, hidden?.get(it));
    if (left.length) parts.push([it, left]);
  }
  let common: Origin;
  let commonSet = false;
  /** 이 항목 원점 → 공통 원점 차이 */
  const delta = (o: Origin): [number, number, number] => {
    if (!commonSet) {
      common = o;
      commonSet = true;
    }
    return [(o?.[0] ?? 0) - (common?.[0] ?? 0), (o?.[1] ?? 0) - (common?.[1] ?? 0), (o?.[2] ?? 0) - (common?.[2] ?? 0)];
  };
  const done = (positions: Float32Array): SegmentSet => (common ? { positions, origin: [common[0], common[1], common[2]] } : { positions });
  let n = 0;
  for (const [it, list] of parts) if (it >= t.meshCount) for (const r of list) n += r.count;
  if (n > 0) {
    const out = new Float32Array(Math.min(n, cap) * 6);
    let o = 0;
    for (const [it, list] of parts) {
      if (it < t.meshCount) continue;
      const line = scene.lines[it - t.meshCount]!;
      const d = delta(line.origin);
      const pos = line.positions;
      for (const r of list) {
        if (o >= out.length) break;
        const a = r.start * 6;
        const b = Math.min((r.start + r.count) * 6, a + (out.length - o));
        if (!d[0] && !d[1] && !d[2]) out.set(pos.subarray(a, b), o);
        else for (let k = a; k < b; k++) out[o + k - a] = pos[k]! + d[k % 3]!;
        o += b - a;
      }
    }
    return done(out);
  }
  // 모서리가 없으면 삼각형 변
  let tris = 0;
  for (const [it, list] of parts) if (it < t.meshCount) for (const r of list) tris += r.count;
  if (!tris) return null;
  const out = new Float32Array(Math.min(tris * 3, cap) * 6);
  let o = 0;
  for (const [it, list] of parts) {
    if (it >= t.meshCount) continue;
    const m = scene.meshes[it]!;
    const d = delta(m.origin);
    const P = m.positions;
    for (const r of list)
      for (let tri = r.start; tri < r.start + r.count && o < out.length; tri++) {
        const v = [0, 1, 2].map((k) => (m.indices ? m.indices[3 * tri + k]! : 3 * tri + k));
        for (let k = 0; k < 3 && o < out.length; k++) {
          const a = v[k]! * 3;
          const b = v[(k + 1) % 3]! * 3;
          out.set([P[a]! + d[0], P[a + 1]! + d[1], P[a + 2]! + d[2], P[b]! + d[0], P[b + 1]! + d[1], P[b + 2]! + d[2]], o);
          o += 6;
        }
      }
  }
  return done(out);
}

/** 노드 안쪽 형상의 범위(세계 좌표 — 묶음 원점을 더한다, 보이는 항목만). 없으면 null */
export function nodeBox(
  t: TreeView,
  scene: Scene3d,
  i: number,
  visible: (item: number) => boolean = () => true,
  hidden?: ReadonlyMap<number, readonly IndexRange[]>,
): Box3 | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const add = (P: Float32Array, v: number, o: Origin): void => {
    for (let a = 0; a < 3; a++) {
      const x = P[3 * v + a]! + (o?.[a] ?? 0);
      if (x < min[a]!) min[a] = x;
      if (x > max[a]!) max[a] = x;
    }
  };
  if (isSplit(t, i)) {
    for (let k = t.meshFirst[i]!; k < t.meshEnd[i]!; k++) {
      if (!visible(k)) continue;
      const m = scene.meshes[k]!;
      for (let v = 0; v < m.positions.length / 3; v++) add(m.positions, v, m.origin);
    }
    for (let k = t.lineFirst[i]!; k < t.lineEnd[i]!; k++) {
      if (!visible(t.meshCount + k)) continue;
      const l = scene.lines[k]!;
      for (let v = 0; v < l.positions.length / 3; v++) add(l.positions, v, l.origin);
    }
  } else if (!t.runsDropped) {
    for (const [it, list] of nodeRanges(t, scene, i)) {
      if (!visible(it)) continue;
      for (const r of subtractRanges(list, hidden?.get(it))) {
        if (it < t.meshCount) {
          const m = scene.meshes[it]!;
          for (let tri = r.start; tri < r.start + r.count; tri++) for (let k = 0; k < 3; k++) add(m.positions, m.indices ? m.indices[3 * tri + k]! : 3 * tri + k, m.origin);
        } else {
          const l = scene.lines[it - t.meshCount]!;
          for (let p = r.start * 2; p < (r.start + r.count) * 2; p++) add(l.positions, p, l.origin);
        }
      }
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

/** 노드가 (자기 또는 조상이) 숨겨졌는지 */
export function hiddenByNodes(t: TreeData, hidden: ReadonlySet<number>, node: number): boolean {
  if (!hidden.size) return false;
  for (let k = node; k >= 0; k = t.parent[k]!) if (hidden.has(k)) return true;
  return false;
}

/** 나무 전체(목록에 든 모든 단계)에서 컴포넌트 정의별 개수(많은 차례) */
export function treeDefinitionCounts(t: TreeData): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (let i = 0; i < t.count; i++) {
    if (t.kind[i] !== 1) continue;
    const name = nodeDefinition(t, i);
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}
