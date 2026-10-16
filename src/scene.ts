/**
 * SKP 중간 모형 → Scene3d. 그룹·컴포넌트 인스턴스를 변환을 곱해 펼치고(세계 좌표),
 * 면(바깥 고리 + 구멍)은 평면 법선의 가장 큰 축을 버린 2D 투영으로 earcut 삼각화한다.
 * 그물은 (태그, 재질)마다 하나로 모으고, 모서리는 태그마다 LineSet3d 하나로 모은다.
 *
 * outline 선택을 켜면 화면이 그룹·컴포넌트를 하나씩 고르고 강조·숨기기할 수 있게 한다.
 *   - 나무(meta.tree): 인스턴스 배치마다 노드 하나. 넓이 우선으로 단계를 내려가며 노드 한도(MAX_TREE_NODES)까지 넣는다.
 *   - 나누기: 그리기 호출 수가 터지지 않게, 항목 수 어림이 한도(MAX_SPLIT_ITEMS) 안인 가장 깊은 단계(splitDepth)까지만
 *     노드마다 그물·모서리를 따로 모은다. 그보다 깊은 노드는 그 단계 조상의 그물에 함께 들어간다.
 *     모형 바로 아래 단계(1)는 예전처럼 늘 나눈다(윗단계가 MAX_OUTLINE_ENTRIES를 넘으면 나누지 않는다).
 *   - 구간(runs): 펼치기는 깊이 우선이라 한 노드의 안쪽 전부가 각 그물·모서리 묶음 안에서 이어진 구간이 된다.
 *     덧붙일 때마다 (항목, 시작 삼각형·선분, 노드)를 적어 두면, 화면이 고른 삼각형에서 가장 안쪽 노드를 찾고
 *     나누지 않은 깊은 노드도 그 구간으로 강조·맞춰 보기할 수 있다.
 * extras 선택을 켜면 부드러운·매끈한 모서리와 숨긴 형상(숨긴 면·모서리·인스턴스)을 따로 묶어 낸다(화면에서 켜고 끄기용).
 *
 * 재질 물려받기(SketchUp 화면과 같게 잡은 규칙): 면 앞 재질 → 감싼 인스턴스 재질(안쪽부터) → 면 뒤 재질 → 기본색.
 * 태그 물려받기: 요소 태그가 없거나 기본 태그면 감싼 인스턴스의 태그를 따른다.
 */

import earcut from 'earcut';
import type { Box3, LineSet3d, Mesh3d, Rgba } from 'opencad-viewer3d/types';
import { FLAG_HIDDEN, FLAG_SOFT_SMOOTH, type SkpEntities, type SkpInstance, type SkpModel } from './model';
import type { SkpMaterialInfo } from './materials';

export const DEFAULT_FACE_COLOR: Rgba = [0.82, 0.82, 0.8, 1];
export const EDGE_COLOR: Rgba = [0.12, 0.12, 0.12, 1];
/** 부드러운·매끈한 모서리 색(extras) — 보통 모서리보다 옅게 */
export const SOFT_EDGE_COLOR: Rgba = [0.52, 0.52, 0.52, 1];
/** 숨긴 모서리 색(extras, 점선으로 그린다) */
export const HIDDEN_EDGE_COLOR: Rgba = [0.45, 0.45, 0.52, 1];
/** 숨긴 면의 불투명도(extras) */
export const HIDDEN_FACE_ALPHA = 0.28;
/** 펼친 뒤 면 정점 수 한도(브라우저 메모리 보호) */
export const MAX_OUTPUT_VERTICES = 12_000_000;
/** 펼친 뒤 모서리 선분 수 한도(넘으면 선만 그만 그리고 면은 계속) */
export const MAX_OUTPUT_SEGMENTS = 3_000_000;
/** extras(숨긴 면) 정점 수 한도 — 보통 형상 한도와 따로 센다 */
export const MAX_EXTRA_VERTICES = 4_000_000;
/** extras(부드러운·숨긴 모서리) 선분 수 한도 */
export const MAX_EXTRA_SEGMENTS = 2_000_000;
/** 인스턴스 배치 수 한도(서로를 여러 번 품는 정의가 기하급수로 불어나는 깨진 파일 보호) */
export const MAX_PLACEMENTS = 2_000_000;
/** 인스턴스 겹 깊이 한도(자기 자신을 품는 깨진 파일 보호) */
const MAX_DEPTH = 64;
/** outline으로 따로 나눌 윗단계 인스턴스 수 기본 한도(그리기 호출 수 보호) */
export const MAX_OUTLINE_ENTRIES = 1000;
/** 나무에 넣는 노드 수 한도(넓이 우선, 단계 단위로 자른다) */
export const MAX_TREE_NODES = 50_000;
/** 깊은 단계까지 나눌 때 그물·모서리 항목 수 어림 한도(= 그리기 호출 수 어림) */
export const MAX_SPLIT_ITEMS = 3000;
/** 구간(runs) 수 한도 — 넘으면 구간을 버린다(나무와 나눈 항목은 남는다) */
export const MAX_TREE_RUNS = 2_000_000;

/**
 * 큰 좌표 기준(인치): 덧붙이는 형상(배치 하나의 한 묶음)의 첫 정점이 원점에서 이보다 멀면(어느 축이든),
 * 그 형상은 1 km 칸(기준 × 10)마다 따로 모은 묶음에 넣고, 묶음에 origin(처음 넣은 정점을 반올림)을 두어
 * positions를 그만큼 빼서 적는다(float32 떨림 방지, 코어 v0.4의 묶음 원점). 1e5 mm = 100 m.
 * 모든 형상이 이보다 가까운 모형은 묶음 열쇠·출력이 예전과 바이트까지 같다.
 */
export const LARGE_COORD_INCH = 1e5 / 25.4;

/** 나무 노드 깃발: 모형에서 숨긴 인스턴스(또는 그 안쪽) */
export const TREE_HIDDEN = 1;
/** 나무 노드 깃발: 안쪽 인스턴스가 있지만 노드 한도로 목록에 넣지 않음 */
export const TREE_MORE = 2;

/** 재질 열쇠: ≥0 면 앞 재질, -1 물려받기(없으면 기본색), ≤-2 물려받기(없으면 뒤 재질 -(k+2)) */
type MatKey = number;

interface Batch {
  mat: MatKey;
  /** 태그 번호, -1이면 물려받기 */
  layer: number;
  pos: Float64Array;
  idx: Uint32Array;
  /** 삼각화한 면 수 */
  faces: number;
}

/** 모서리 갈래: 0 보통 · 1 부드러운·매끈한 · 2 숨긴 */
type LineCls = 0 | 1 | 2;

interface LineBatch {
  layer: number;
  pos: Float64Array;
  cls: LineCls;
}

interface Prepared {
  /** 보통 면 */
  batches: Batch[];
  /** 보통 모서리 */
  lines: LineBatch[];
  /** 숨긴 면(extras일 때만) */
  hiddenBatches: Batch[];
  /** 부드러운·숨긴 모서리(extras일 때만) */
  extraLines: LineBatch[];
}

class F32 {
  a = new Float32Array(1024);
  n = 0;
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    let size = this.a.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Float32Array(size);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  done(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

class U32 {
  a: Uint32Array;
  n = 0;
  constructor(size = 1024) {
    this.a = new Uint32Array(size);
  }
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    let size = Math.max(1, this.a.length * 2);
    while (size < this.n + k) size *= 2;
    const b = new Uint32Array(size);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  push(v: number): void {
    this.reserve(1);
    this.a[this.n++] = v;
  }
  done(): Uint32Array {
    return this.a.slice(0, this.n);
  }
}

/** 면 하나를 삼각화해 (위치, 삼각형) 추가. 실패하면 false */
export function triangulateFace(
  points: Float64Array,
  loops: readonly (readonly number[])[],
  normal: readonly [number, number, number],
  pos: number[],
  idx: number[],
): boolean {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  // 버릴 축: 법선이 가장 큰 축
  const drop = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
  const u = drop === 0 ? 1 : 0;
  const v = drop === 2 ? 1 : 2;
  const flat: number[] = [];
  const holes: number[] = [];
  const base = pos.length / 3;
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]!;
    if (li > 0) holes.push(flat.length / 2);
    for (const k of loop) {
      const o = 3 * k;
      flat.push(points[o + u]!, points[o + v]!);
      pos.push(points[o]!, points[o + 1]!, points[o + 2]!);
    }
  }
  const tri = earcut(flat, holes.length ? holes : undefined, 2);
  if (tri.length === 0) {
    pos.length = base * 3;
    return false;
  }
  for (const t of tri) idx.push(base + t);
  return true;
}

interface FaceGroup {
  mat: MatKey;
  layer: number;
  pos: number[];
  idx: number[];
  faces: number;
}

function prepare(
  ents: SkpEntities,
  defaultLayer: number | undefined,
  counter: { failed: number },
  extras: boolean,
  onFaces?: (n: number) => void,
): Prepared {
  const layerKey = (l: number | undefined): number => (l === undefined || l === defaultLayer ? -1 : l);
  const groups = new Map<string, FaceGroup>();
  const hidden = new Map<string, FaceGroup>();
  let k = 0;
  for (const f of ents.faces) {
    if (onFaces && ++k % 2048 === 0) onFaces(2048);
    const isHidden = (f.flags & FLAG_HIDDEN) !== 0;
    if (isHidden && !extras) continue;
    const mat: MatKey = f.front !== undefined ? f.front : f.back !== undefined ? -(f.back + 2) : -1;
    const layer = layerKey(f.layer);
    const key = `${mat}|${layer}`;
    const map = isHidden ? hidden : groups;
    let g = map.get(key);
    if (!g) map.set(key, (g = { mat, layer, pos: [], idx: [], faces: 0 }));
    if (triangulateFace(ents.points, f.loops, f.normal, g.pos, g.idx)) g.faces++;
    else if (!isHidden) counter.failed++;
  }
  if (onFaces && k % 2048) onFaces(k % 2048);
  const toBatches = (m: Map<string, FaceGroup>): Batch[] => {
    const out: Batch[] = [];
    for (const g of m.values())
      if (g.idx.length) out.push({ mat: g.mat, layer: g.layer, pos: Float64Array.from(g.pos), idx: Uint32Array.from(g.idx), faces: g.faces });
    return out;
  };

  const lineGroups = new Map<number, number[]>();
  const softGroups = new Map<number, number[]>();
  const hiddenLines = new Map<number, number[]>();
  const p = ents.points;
  for (const e of ents.edges) {
    let map: Map<number, number[]>;
    if (e.flags & FLAG_HIDDEN) {
      if (!extras) continue;
      map = hiddenLines;
    } else if (e.flags & FLAG_SOFT_SMOOTH) {
      if (!extras) continue;
      map = softGroups;
    } else map = lineGroups;
    const layer = layerKey(e.layer);
    let arr = map.get(layer);
    if (!arr) map.set(layer, (arr = []));
    arr.push(p[3 * e.a]!, p[3 * e.a + 1]!, p[3 * e.a + 2]!, p[3 * e.b]!, p[3 * e.b + 1]!, p[3 * e.b + 2]!);
  }
  const lines: LineBatch[] = [];
  for (const [layer, arr] of lineGroups) lines.push({ layer, pos: Float64Array.from(arr), cls: 0 });
  const extraLines: LineBatch[] = [];
  for (const [layer, arr] of softGroups) extraLines.push({ layer, pos: Float64Array.from(arr), cls: 1 });
  for (const [layer, arr] of hiddenLines) extraLines.push({ layer, pos: Float64Array.from(arr), cls: 2 });
  return { batches: toBatches(groups), lines, hiddenBatches: toBatches(hidden), extraLines };
}

/** 열 우선 4×4 곱 a·b */
export function mul4(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

/** 태그마다 펼친 뒤 그린 면·모서리 수(화면 태그 목록용) */
export interface SkpTagStat {
  name: string;
  /** 기본 태그(Layer0·Untagged) */
  default: boolean;
  faces: number;
  edges: number;
}

/** 재질마다 펼친 뒤 그린 면 수와 그 재질의 그물 id(화면 재질 목록용) */
export interface SkpMaterialStat {
  /** 표시 이름(material.xml의 원래 이름), 재질이 없으면 '기본 재질' */
  name: string;
  /** model.dat의 재질 이름(= 꾸러미의 materials/<폴더> 이름). 재질이 없으면 없다 */
  folder?: string;
  color: [number, number, number, number];
  /** 무늬(텍스처) 재질이면 true — 색은 무늬 평균색 */
  textured: boolean;
  faces: number;
  meshIds: string[];
}

/** 모형 바로 아래 그룹·컴포넌트 하나(outline 선택일 때) */
export interface SkpOutlineEntry {
  /** 인스턴스 이름, 없으면 정의 이름 */
  name: string;
  /** loose = 그룹·컴포넌트 밖, 모형에 바로 놓인 면·모서리 */
  kind: 'group' | 'component' | 'loose';
  /** 컴포넌트 정의 이름 */
  definition?: string;
  /** 인스턴스의 태그 이름 */
  tag: string;
  faces: number;
  edges: number;
  /** 이 항목(안쪽 포함)만 담은 그물·모서리 묶음 id */
  ids: string[];
  /** meta.tree의 노드 차례(나무가 있을 때) */
  node?: number;
}

/**
 * 여러 단계 그룹·컴포넌트 나무(outline 선택일 때 meta.tree). 노드는 넓이 우선 차례라 부모가 먼저 오고,
 * 한 노드의 자식은 firstChild부터 childCount개가 이어진다. 형식 배열이라 워커에서 복사 없이 넘긴다.
 *
 * 항목 차례(item): 그물은 scene.meshes 차례, 모서리는 meshes.length + scene.lines 차례.
 */
export interface SkpTree {
  count: number;
  /** 부모 노드(-1 = 모형 바로 아래) */
  parent: Int32Array;
  /** 단계(1 = 모형 바로 아래) */
  depth: Uint8Array;
  /** 0 그룹 · 1 컴포넌트 */
  kind: Uint8Array;
  /** TREE_HIDDEN · TREE_MORE */
  flags: Uint8Array;
  /** 인스턴스 이름('' = 이름 없음 → 화면은 정의 이름을 쓴다) */
  names: string[];
  /** definitionNames 차례 */
  definition: Int32Array;
  definitionNames: string[];
  /** 인스턴스 자기 태그(없거나 기본이면 기본 태그) — tagNames 차례 */
  tag: Int32Array;
  tagNames: string[];
  /** 안쪽까지 펼친 뒤 그린(보통) 면·모서리 수 */
  faces: Uint32Array;
  edges: Uint32Array;
  /** 첫 자식 노드(-1 = 없음)와 자식 수 */
  firstChild: Int32Array;
  childCount: Uint32Array;
  /** 모형 바로 아래 노드 수(노드 0부터) */
  rootCount: number;
  /** 따로 나눈 노드면 안쪽까지의 그물 범위 [meshFirst, meshEnd)·모서리 범위(scene.lines 차례), 아니면 -1 */
  meshFirst: Int32Array;
  meshEnd: Int32Array;
  lineFirst: Int32Array;
  lineEnd: Int32Array;
  /** 노드 안쪽 전부의 구간 범위 [runFirst, runEnd) */
  runFirst: Uint32Array;
  runEnd: Uint32Array;
  /** 구간: 항목 차례·그 항목 안 시작(삼각형 또는 선분 차례)·그것을 낸 가장 안쪽 노드(-1 = 모형에 바로 놓인 형상) */
  runItem: Uint32Array;
  runStart: Uint32Array;
  runNode: Int32Array;
  /** 구간이 한도를 넘어 버렸으면 true(이때 run 배열은 비었다) */
  runsDropped: boolean;
  /** 항목마다 그것을 따로 가진 노드(-1 = 모형에 바로 놓인 형상) */
  itemOwner: Int32Array;
  /** 따로 나눈 가장 깊은 단계(0 = 나누지 않음) */
  splitDepth: number;
  /** 목록에 넣은 가장 깊은 단계 */
  listedDepth: number;
  /** 노드 한도로 더 깊은 단계를 넣지 않았는지 */
  unlisted: boolean;
}

/** 부드러운·숨긴 형상 항목(extras 선택일 때 meta.extraItems) */
export interface SkpExtraItems {
  soft: string[];
  hidden: string[];
  softSegments: number;
  hiddenFaces: number;
  hiddenSegments: number;
}

export interface BuildOptions {
  /** 그룹·컴포넌트마다 그물·모서리를 나누고 outline·나무를 적는다(기본 false — 나누지 않으면 그리기 호출이 적다) */
  outline?: boolean;
  /** 나눌 윗단계 인스턴스 수 한도(넘으면 나누지 않고 outlineSkipped에 수를 적는다) */
  maxOutline?: number;
  /** 깊은 단계 나누기의 항목 수 어림 한도 */
  maxSplitItems?: number;
  /** 나무 노드 수 한도 */
  maxTreeNodes?: number;
  /** 구간 수 한도 */
  maxTreeRuns?: number;
  /** 부드러운 모서리·숨긴 형상을 따로 묶어 낸다(기본 false) */
  extras?: boolean;
  /** 인스턴스 배치 수 한도 */
  maxPlacements?: number;
  /** 큰 좌표 기준(장면 단위). 기본은 LARGE_COORD_INCH × scale(= 100 m). Infinity면 origin을 쓰지 않는다 */
  originThreshold?: number;
  /** 진행 알림(0~1) */
  onProgress?: (fraction: number) => void;
}

export interface SceneParts {
  meshes: Mesh3d[];
  lines: LineSet3d[];
  bounds?: Box3;
  warnings: string[];
  stats: { triangles: number; segments: number; placements: number };
  /** 태그별 통계(모형의 태그 차례, 그릴 것이 없는 태그도 넣는다) */
  tags: SkpTagStat[];
  /** 재질별 통계(그린 면이 있는 재질만, 처음 나온 차례) */
  materials: SkpMaterialStat[];
  /** outline 선택일 때 윗단계 항목(첫 항목은 loose — 그릴 것이 있을 때만) */
  outline?: SkpOutlineEntry[];
  /** outline을 원했지만 윗단계 인스턴스가 한도보다 많아 나누지 않았으면 그 수 */
  outlineSkipped?: number;
  /** outline 선택일 때 여러 단계 나무 */
  tree?: SkpTree;
  /** extras 선택일 때 부드러운·숨긴 형상 항목 */
  extras?: SkpExtraItems;
  /** 출력 한도에 걸려 일부만 그렸는지 */
  limited?: boolean;
}

/** 넓이 우선으로 모은 나무(펼치기 전) */
interface TreeBuild {
  n: number;
  parent: number[];
  depth: number[];
  inst: SkpInstance[];
  ents: SkpEntities[];
  hidden: boolean[];
  firstChild: number[];
  childCount: number[];
  more: boolean[];
  rootCount: number;
  listedDepth: number;
  unlisted: boolean;
}

/**
 * 중간 모형을 펼친다. scale은 인치 → 장면 단위 배율.
 * materials는 재질 이름 → 정보(material.xml에서 읽은 색).
 */
export function buildSceneParts(model: SkpModel, materials: Map<string, SkpMaterialInfo>, scale = 1, opts: BuildOptions = {}): SceneParts {
  const warnings: string[] = [];
  const counter = { failed: 0 };
  const extras = !!opts.extras;
  const maxPlacements = opts.maxPlacements ?? MAX_PLACEMENTS;

  // ── 진행: 삼각화한 면 수(정의마다 한 번)와 펼친 배치 수의 반반 ──
  const totalFaces = Math.max(1, model.counts.faces);
  let facesDone = 0;
  let placementsTotal = 1;
  let lastProgress = 0;
  let placements = 0;
  const report = (placementsNow: number): void => {
    if (!opts.onProgress) return;
    const f = 0.5 * Math.min(1, facesDone / totalFaces) + 0.5 * Math.min(1, placementsNow / placementsTotal);
    if (f < lastProgress + 0.005) return;
    lastProgress = f;
    try {
      opts.onProgress(f);
    } catch {
      /* 알림 쪽 오류는 무시 */
    }
  };
  const onFaces = opts.onProgress
    ? (n: number): void => {
        facesDone += n;
        report(placements);
      }
    : undefined;

  const cache = new Map<SkpEntities, Prepared>();
  const prep = (e: SkpEntities): Prepared => {
    let p = cache.get(e);
    if (!p) cache.set(e, (p = prepare(e, model.defaultLayer, counter, extras, onFaces)));
    return p;
  };

  const colorOf = (id: number | undefined): Rgba => {
    if (id === undefined) return DEFAULT_FACE_COLOR;
    const name = model.materials.get(id);
    const info = name !== undefined ? materials.get(name) : undefined;
    return info ? info.color : DEFAULT_FACE_COLOR;
  };
  const layerName = (id: number): string =>
    model.layers.get(id) ?? (model.defaultLayer !== undefined ? model.layers.get(model.defaultLayer) : undefined) ?? 'Layer0';
  const defaultTagName = (model.defaultLayer !== undefined ? model.layers.get(model.defaultLayer) : undefined) ?? 'Layer0';

  /** 펼칠 자식 인스턴스(emit과 같은 거르기·차례). anc: 조상(자기 포함) 요소 묶음 */
  const validChildren = (ents: SkpEntities, anc: Set<SkpEntities>, depth: number): { inst: SkpInstance; ents: SkpEntities }[] => {
    const out: { inst: SkpInstance; ents: SkpEntities }[] = [];
    if (depth >= MAX_DEPTH) return out;
    for (const inst of ents.instances) {
      if (inst.flags & FLAG_HIDDEN && !extras) continue;
      const def = model.definitions.get(inst.definition);
      if (!def || anc.has(def.entities)) continue;
      out.push({ inst, ents: def.entities });
    }
    return out;
  };

  // 진행 어림용 전체 배치 수(정의마다 한 번 세어 곱한다, 순환은 0으로)
  if (opts.onProgress) {
    const memo = new Map<SkpEntities, number>();
    const visiting = new Set<SkpEntities>();
    const count = (e: SkpEntities): number => {
      const m = memo.get(e);
      if (m !== undefined) return m;
      if (visiting.has(e)) return 0;
      visiting.add(e);
      let c = 0;
      for (const inst of e.instances) {
        if (inst.flags & FLAG_HIDDEN && !extras) continue;
        const def = model.definitions.get(inst.definition);
        if (def && def.entities !== e) c += 1 + count(def.entities);
        if (c > maxPlacements) break;
      }
      visiting.delete(e);
      memo.set(e, c);
      return c;
    };
    placementsTotal = Math.max(1, Math.min(maxPlacements, 1 + count(model.root)));
  }

  // ── 나무(넓이 우선, 단계 단위로 노드 한도까지) ──
  let tb: TreeBuild | null = null;
  let visibleTop = 0;
  if (opts.outline) {
    for (const c of validChildren(model.root, new Set([model.root]), 0)) if (!(c.inst.flags & FLAG_HIDDEN)) visibleTop++;
    const maxNodes = opts.maxTreeNodes ?? MAX_TREE_NODES;
    const t: TreeBuild = {
      n: 0,
      parent: [],
      depth: [],
      inst: [],
      ents: [],
      hidden: [],
      firstChild: [],
      childCount: [],
      more: [],
      rootCount: 0,
      listedDepth: 0,
      unlisted: false,
    };
    const ancOf = (i: number): Set<SkpEntities> => {
      const s = new Set<SkpEntities>([model.root]);
      for (let k = i; k >= 0; k = t.parent[k]!) s.add(t.ents[k]!);
      return s;
    };
    let level: number[] = [-1];
    for (let d = 0; level.length; d++) {
      const next: { p: number; inst: SkpInstance; ents: SkpEntities }[] = [];
      const kids = new Map<number, number>();
      for (const p of level) {
        const ents = p < 0 ? model.root : t.ents[p]!;
        const ch = validChildren(ents, ancOf(p), d);
        kids.set(p, ch.length);
        for (const c of ch) next.push({ p, inst: c.inst, ents: c.ents });
      }
      if (!next.length) break;
      if (t.n + next.length > maxNodes) {
        t.unlisted = true;
        for (const p of level) if (p >= 0 && (kids.get(p) ?? 0) > 0) t.more[p] = true;
        break;
      }
      const added: number[] = [];
      for (const c of next) {
        const i = t.n++;
        t.parent.push(c.p);
        t.depth.push(d + 1);
        t.inst.push(c.inst);
        t.ents.push(c.ents);
        t.hidden.push((c.p >= 0 && t.hidden[c.p]!) || (c.inst.flags & FLAG_HIDDEN) !== 0);
        t.firstChild.push(-1);
        t.childCount.push(0);
        t.more.push(false);
        if (c.p >= 0) {
          if (t.firstChild[c.p]! < 0) t.firstChild[c.p] = i;
          t.childCount[c.p]!++;
        } else t.rootCount++;
        added.push(i);
      }
      t.listedDepth = d + 1;
      level = added;
    }
    if (t.n > 0) tb = t;
  }

  // ── 나눌 단계 정하기 ──
  let splitDepth = 0;
  let outlineSkipped = 0;
  if (opts.outline) {
    if (visibleTop > (opts.maxOutline ?? MAX_OUTLINE_ENTRIES)) outlineSkipped = visibleTop;
    else if (tb) {
      const t = tb;
      splitDepth = 1;
      const budget = opts.maxSplitItems ?? MAX_SPLIT_ITEMS;
      const own = (e: SkpEntities): number => {
        const p = prep(e);
        return p.batches.length + p.lines.length + p.hiddenBatches.length + p.extraLines.length;
      };
      const subMemo = new Map<SkpEntities, Set<string>>();
      const visiting = new Set<SkpEntities>();
      const subKeys = (e: SkpEntities): Set<string> => {
        const m = subMemo.get(e);
        if (m) return m;
        const s = new Set<string>();
        if (visiting.has(e)) return s;
        visiting.add(e);
        const p = prep(e);
        for (const b of p.batches) s.add(`f${b.mat}|${b.layer}`);
        for (const b of p.hiddenBatches) s.add(`h${b.mat}|${b.layer}`);
        for (const l of p.lines) s.add(`l${l.layer}`);
        for (const l of p.extraLines) s.add(`x${l.cls}|${l.layer}`);
        for (const inst of e.instances) {
          if (s.size > 512) break;
          if (inst.flags & FLAG_HIDDEN && !extras) continue;
          const def = model.definitions.get(inst.definition);
          if (def && def.entities !== e) for (const k of subKeys(def.entities)) s.add(k);
        }
        visiting.delete(e);
        subMemo.set(e, s);
        return s;
      };
      const rootOwn = own(model.root);
      const itemsAt = (D: number): number => {
        let items = rootOwn;
        for (let i = 0; i < t.n; i++) {
          const d = t.depth[i]!;
          if (d < D) items += own(t.ents[i]!);
          else if (d === D) items += subKeys(t.ents[i]!).size;
          else break;
          if (items > budget) break;
        }
        return items;
      };
      for (let D = 2; D <= t.listedDepth; D++) {
        if (itemsAt(D) > budget) break;
        splitDepth = D;
      }
    } else if (visibleTop > 0) outlineSkipped = visibleTop;
  }

  interface Bucket {
    serial: number;
    slot: number;
    /** 0 보통 · 1 숨긴 면 */
    cls: number;
    layer: number;
    mat: number | undefined;
    pos: F32;
    idx: U32;
    faces: number;
    /** 큰 좌표면 묶음 원점(처음 넣을 때 정한다, null = 원점 없음) */
    origin?: [number, number, number] | null;
  }
  interface LineBucket {
    serial: number;
    slot: number;
    cls: LineCls;
    layer: number;
    pos: F32;
    origin?: [number, number, number] | null;
  }
  const originLimit = opts.originThreshold ?? LARGE_COORD_INCH * Math.abs(scale);
  const cellSize = originLimit * 10;
  /** 덧붙일 형상의 첫 정점(변환 뒤)이 멀면 그 점을 반올림한 원점과 칸 열쇠, 가까우면 null */
  const farCell = (src: Float64Array, m: Float64Array): { key: string; origin: [number, number, number] } | null => {
    if (!(originLimit < Infinity) || src.length < 3) return null;
    const x = src[0]!;
    const y = src[1]!;
    const z = src[2]!;
    let w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (!w) w = 1;
    const X = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
    const Y = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
    const Z = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    if (!(Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) > originLimit)) return null;
    return { key: `@${Math.round(X / cellSize)},${Math.round(Y / cellSize)},${Math.round(Z / cellSize)}`, origin: [Math.round(X), Math.round(Y), Math.round(Z)] };
  };
  const buckets = new Map<string, Bucket>();
  const lineBuckets = new Map<string, LineBucket>();
  let serials = 0;

  // 칸(slot): 0은 모형에 바로 놓인 형상, 나눈 노드는 깊이 우선 앞차례로 1부터 → 노드 안쪽의 칸은 [slot, slotEnd)로 이어진다
  const T = tb;
  const nodeSlot = T ? new Int32Array(T.n).fill(-1) : null;
  const nodeSlotEnd = T ? new Int32Array(T.n).fill(-1) : null;
  const slotNode: number[] = [-1];
  const runFirst = T ? new Uint32Array(T.n) : null;
  const runEnd = T ? new Uint32Array(T.n) : null;
  const ownFaces = T ? new Float64Array(T.n) : null;
  const ownEdges = T ? new Float64Array(T.n) : null;
  const runItem = new U32(T ? 4096 : 1);
  const runStart = new U32(T ? 4096 : 1);
  const runNode1 = new U32(T ? 4096 : 1);
  const maxRuns = opts.maxTreeRuns ?? MAX_TREE_RUNS;
  let runsDropped = false;
  let lastRunSerial = -1;
  let lastRunNode = -2;
  const addRun = (serial: number, start: number, node: number): void => {
    if (!T || runsDropped) return;
    if (serial === lastRunSerial && node === lastRunNode) return;
    if (runItem.n >= maxRuns) {
      runsDropped = true;
      return;
    }
    runItem.push(serial);
    runStart.push(start);
    runNode1.push(node + 1);
    lastRunSerial = serial;
    lastRunNode = node;
  };

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let outVerts = 0;
  let outSegs = 0;
  let extraVerts = 0;
  let extraSegs = 0;
  let truncated = false;
  let linesTruncated = false;
  let extrasTruncated = false;
  let placementsStopped = false;
  let missingDefs = 0;
  let cycles = 0;

  const put = (dst: F32, src: Float64Array, m: Float64Array, bounds: boolean, origin?: [number, number, number] | null): void => {
    dst.reserve(src.length);
    const a = dst.a;
    let n = dst.n;
    const affine = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
    const ox = origin ? origin[0] : 0;
    const oy = origin ? origin[1] : 0;
    const oz = origin ? origin[2] : 0;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]!;
      const y = src[i + 1]!;
      const z = src[i + 2]!;
      let X = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      let Y = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      let Z = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      if (!affine) {
        const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
        if (w !== 0) {
          X /= w;
          Y /= w;
          Z /= w;
        }
      }
      // 원점은 double로 뺀 뒤 float32로 적는다(큰 좌표에서도 묶음 안 상대 좌표는 정밀하게)
      a[n++] = X - ox;
      a[n++] = Y - oy;
      a[n++] = Z - oz;
      if (!bounds) continue;
      if (X < min[0]) min[0] = X;
      if (Y < min[1]) min[1] = Y;
      if (Z < min[2]) min[2] = Z;
      if (X > max[0]) max[0] = X;
      if (Y > max[1]) max[1] = Y;
      if (Z > max[2]) max[2] = Z;
    }
    dst.n = n;
  };

  const faceBucket = (slot: number, cls: number, layer: number, mat: number | undefined, far: ReturnType<typeof farCell>): Bucket => {
    // 보통(가까운) 형상의 열쇠는 예전과 같다(기본 호출 출력이 바뀌지 않게). 먼 형상은 칸 열쇠를 붙인다
    const key = (cls ? `${slot}|h|${layer}|${mat ?? 'd'}` : `${slot}|${layer}|${mat ?? 'd'}`) + (far ? far.key : '');
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, (bk = { serial: serials++, slot, cls, layer, mat, pos: new F32(), idx: new U32(), faces: 0, origin: far ? far.origin : null }));
    return bk;
  };
  const lineBucket = (slot: number, cls: LineCls, layer: number, far: ReturnType<typeof farCell>): LineBucket => {
    const key = (cls === 0 ? `${slot}|${layer}` : `${slot}|${cls === 1 ? 's' : 'x'}|${layer}`) + (far ? far.key : '');
    let lb = lineBuckets.get(key);
    if (!lb) lineBuckets.set(key, (lb = { serial: serials++, slot, cls, layer, pos: new F32(), origin: far ? far.origin : null }));
    return lb;
  };
  const appendFaces = (bk: Bucket, b: Batch, m: Float64Array, node: number): void => {
    const base = bk.pos.n / 3;
    addRun(bk.serial, bk.idx.n / 3, node);
    put(bk.pos, b.pos, m, bk.cls === 0, bk.origin);
    bk.idx.reserve(b.idx.length);
    for (let i = 0; i < b.idx.length; i++) bk.idx.a[bk.idx.n++] = base + b.idx[i]!;
    bk.faces += b.faces;
  };
  const appendLines = (lb: LineBucket, l: LineBatch, m: Float64Array, node: number): void => {
    addRun(lb.serial, lb.pos.n / 6, node);
    put(lb.pos, l.pos, m, lb.cls === 0, lb.origin);
  };

  /**
   * 요소 묶음 하나를 놓는다. node: 이 배치를 맡는 나무 노드(목록에 없는 깊은 배치는 목록에 든 조상, -1 = 모형).
   * hiddenSub: 숨긴 인스턴스 안쪽(extras일 때만 온다)
   */
  const emit = (
    ents: SkpEntities,
    m: Float64Array,
    inhMat: number | undefined,
    inhLayer: number | undefined,
    depth: number,
    stack: Set<SkpEntities>,
    slot: number,
    node: number,
    hiddenSub: boolean,
  ): void => {
    if (truncated || placementsStopped) return;
    if (placements >= maxPlacements) {
      placementsStopped = true;
      return;
    }
    placements++;
    if (opts.onProgress && (placements & 511) === 0) report(placements);
    const p = prep(ents);
    const layerHere = inhLayer ?? model.defaultLayer ?? -1;
    const matOf = (b: Batch): number | undefined => (b.mat >= 0 ? b.mat : (inhMat ?? (b.mat <= -2 ? -(b.mat + 2) : undefined)));
    // 보통 면(숨긴 인스턴스 안쪽이면 숨긴 면으로)
    for (const b of p.batches) {
      const nv = b.pos.length / 3;
      const layer = b.layer >= 0 ? b.layer : layerHere;
      if (hiddenSub) {
        if (extraVerts + nv > MAX_EXTRA_VERTICES) {
          extrasTruncated = true;
          continue;
        }
        extraVerts += nv;
        appendFaces(faceBucket(slot, 1, layer, matOf(b), farCell(b.pos, m)), b, m, node);
        continue;
      }
      if (outVerts + nv > MAX_OUTPUT_VERTICES) {
        truncated = true;
        return;
      }
      appendFaces(faceBucket(slot, 0, layer, matOf(b), farCell(b.pos, m)), b, m, node);
      outVerts += nv;
      if (node >= 0) ownFaces![node]! += b.faces;
    }
    // 숨긴 면
    for (const b of p.hiddenBatches) {
      const nv = b.pos.length / 3;
      if (extraVerts + nv > MAX_EXTRA_VERTICES) {
        extrasTruncated = true;
        continue;
      }
      extraVerts += nv;
      appendFaces(faceBucket(slot, 1, b.layer >= 0 ? b.layer : layerHere, matOf(b), farCell(b.pos, m)), b, m, node);
    }
    // 보통 모서리(예전 규칙 그대로: 한도에 걸리면 이 배치의 나머지 보통 모서리는 건너뛴다)
    for (const l of p.lines) {
      const ns = l.pos.length / 6;
      const layer = l.layer >= 0 ? l.layer : layerHere;
      if (hiddenSub) {
        if (extraSegs + ns > MAX_EXTRA_SEGMENTS) {
          extrasTruncated = true;
          continue;
        }
        extraSegs += ns;
        appendLines(lineBucket(slot, 2, layer, farCell(l.pos, m)), l, m, node);
        continue;
      }
      if (outSegs + ns > MAX_OUTPUT_SEGMENTS) {
        linesTruncated = true;
        break;
      }
      outSegs += ns;
      appendLines(lineBucket(slot, 0, layer, farCell(l.pos, m)), l, m, node);
      if (node >= 0) ownEdges![node]! += ns;
    }
    // 부드러운·숨긴 모서리(숨긴 인스턴스 안의 부드러운 모서리는 그리지 않는다)
    for (const l of p.extraLines) {
      if (hiddenSub && l.cls === 1) continue;
      const ns = l.pos.length / 6;
      if (extraSegs + ns > MAX_EXTRA_SEGMENTS) {
        extrasTruncated = true;
        continue;
      }
      extraSegs += ns;
      appendLines(lineBucket(slot, l.cls, l.layer >= 0 ? l.layer : layerHere, farCell(l.pos, m)), l, m, node);
    }
    if (depth >= MAX_DEPTH) {
      if (ents.instances.length) cycles++;
      return;
    }
    stack.add(ents);
    // 나무: 이 노드의 자식이 목록에 있으면 k번째 자식 = firstChild + k(넓이 우선으로 모을 때와 같은 거르기·차례)
    const listed = T !== null && (node < 0 ? depth === 0 : T.childCount[node]! > 0);
    const first = !T ? -1 : node < 0 ? 0 : T.firstChild[node]!;
    let k = 0;
    for (const inst of ents.instances) {
      const hiddenInst = (inst.flags & FLAG_HIDDEN) !== 0;
      if (hiddenInst && !extras) continue;
      const def = model.definitions.get(inst.definition);
      if (!def) {
        missingDefs++;
        continue;
      }
      if (stack.has(def.entities)) {
        cycles++;
        continue;
      }
      const child = listed ? first + k : node;
      k++;
      const own = T !== null && child !== node && child >= 0;
      let childSlot = slot;
      if (own) {
        if (T.depth[child]! <= splitDepth) {
          childSlot = slotNode.length;
          slotNode.push(child);
          nodeSlot![child] = childSlot;
        }
        runFirst![child] = runItem.n;
      }
      const layer = inst.layer !== undefined && inst.layer !== model.defaultLayer ? inst.layer : inhLayer;
      emit(def.entities, mul4(m, inst.matrix), inst.material ?? inhMat, layer, depth + 1, stack, childSlot, child, hiddenSub || hiddenInst);
      if (own) {
        runEnd![child] = runItem.n;
        if (childSlot !== slot) nodeSlotEnd![child] = slotNode.length;
      }
      if (truncated || placementsStopped) break;
    }
    stack.delete(ents);
  };

  const rootM = new Float64Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
  emit(model.root, rootM, undefined, undefined, 0, new Set(), 0, -1, false);
  report(placementsTotal);

  // 통계: 태그는 모형 차례로 미리 넣는다(그릴 것이 없는 태그도 목록에 보이게)
  const tagStats = new Map<string, SkpTagStat>();
  const tagStat = (name: string): SkpTagStat => {
    let t = tagStats.get(name);
    if (!t) tagStats.set(name, (t = { name, default: name === defaultTagName, faces: 0, edges: 0 }));
    return t;
  };
  for (const name of model.layers.values()) tagStat(name);
  const matStats = new Map<string, SkpMaterialStat>();
  const slotStats = new Map<number, { faces: number; edges: number }>();
  const slotStat = (slot: number): { faces: number; edges: number } => {
    let s = slotStats.get(slot);
    if (!s) slotStats.set(slot, (s = { faces: 0, edges: 0 }));
    return s;
  };

  /** 버킷 일련번호 → 항목 차례(그물 차례, 모서리는 그물 수 + 모서리 차례) */
  const serialItem = new Int32Array(serials);
  const meshes: Mesh3d[] = [];
  const meshSlots: number[] = [];
  const softIds: string[] = [];
  const hiddenIds: string[] = [];
  let hiddenFaces = 0;
  let triangles = 0;
  const sorted = [...buckets.values()].sort((a, b) => a.slot - b.slot || a.cls - b.cls || a.layer - b.layer || (a.mat ?? -1) - (b.mat ?? -1));
  for (const bk of sorted) {
    const stored = bk.mat !== undefined ? model.materials.get(bk.mat) : undefined;
    // 표시 이름은 material.xml의 원래 이름(model.dat에는 '<Black>'이 '_Black_'처럼 바뀌어 있다)
    const matName =
      bk.mat === undefined ? '기본 재질' : stored !== undefined ? (materials.get(stored)?.name ?? stored) : `재질 ${bk.mat}`;
    const tag = layerName(bk.layer);
    const color = colorOf(bk.mat);
    serialItem[bk.serial] = meshes.length;
    meshSlots.push(bk.slot);
    if (bk.cls) {
      const id = `skp-hidden-${meshes.length}`;
      const hm: Mesh3d = {
        id,
        name: `숨긴 형상 · ${matName} · ${tag}`,
        positions: bk.pos.done(),
        indices: bk.idx.done(),
        color: [color[0], color[1], color[2], Math.min(color[3], HIDDEN_FACE_ALPHA)],
        group: tag,
        doubleSided: true,
      };
      if (bk.origin) hm.origin = bk.origin;
      meshes.push(hm);
      hiddenIds.push(id);
      hiddenFaces += bk.faces;
      continue;
    }
    // SKP는 면이 닫힌 입체인지 모르므로 closed는 두지 않는다(단면에서 잘린 면은 채우지 않고 테두리만)
    const mesh: Mesh3d = {
      id: `skp-mesh-${meshes.length}`,
      name: `${matName} · ${tag}`,
      positions: bk.pos.done(),
      indices: bk.idx.done(),
      color,
      group: tag,
      doubleSided: true,
    };
    if (bk.origin) mesh.origin = bk.origin;
    triangles += mesh.indices!.length / 3;
    meshes.push(mesh);
    tagStat(tag).faces += bk.faces;
    let ms = matStats.get(matName);
    if (!ms) {
      const textured = stored !== undefined && !!materials.get(stored)?.textured;
      ms = { name: matName, color: [color[0], color[1], color[2], color[3]], textured, faces: 0, meshIds: [] };
      if (stored !== undefined) ms.folder = stored;
      matStats.set(matName, ms);
    }
    ms.faces += bk.faces;
    ms.meshIds.push(mesh.id);
    slotStat(bk.slot).faces += bk.faces;
  }
  const lines: LineSet3d[] = [];
  const lineSlots: number[] = [];
  let segments = 0;
  let softSegments = 0;
  let hiddenSegments = 0;
  for (const lb of [...lineBuckets.values()].sort((a, b) => a.slot - b.slot || a.cls - b.cls || a.layer - b.layer)) {
    const tag = layerName(lb.layer);
    const positions = lb.pos.done();
    const n = positions.length / 6;
    serialItem[lb.serial] = meshes.length + lines.length;
    lineSlots.push(lb.slot);
    const withOrigin = <T extends LineSet3d>(l: T): T => {
      if (lb.origin) l.origin = lb.origin;
      return l;
    };
    if (lb.cls === 1) {
      const id = `skp-soft-${lines.length}`;
      lines.push(withOrigin({ id, name: `부드러운 모서리 · ${tag}`, positions, color: SOFT_EDGE_COLOR, group: tag }));
      softIds.push(id);
      softSegments += n;
      continue;
    }
    if (lb.cls === 2) {
      const id = `skp-hidden-edges-${lines.length}`;
      lines.push(withOrigin({ id, name: `숨긴 모서리 · ${tag}`, positions, color: HIDDEN_EDGE_COLOR, dashed: true, group: tag }));
      hiddenIds.push(id);
      hiddenSegments += n;
      continue;
    }
    segments += n;
    const id = `skp-edges-${lines.length}`;
    lines.push(withOrigin({ id, name: `모서리 · ${tag}`, positions, color: EDGE_COLOR, group: tag }));
    tagStat(tag).edges += n;
    slotStat(lb.slot).edges += n;
  }

  if (counter.failed) warnings.push(`삼각형으로 나누지 못한 면 ${counter.failed}개를 건너뛰었습니다(면적이 0인 면 등)`);
  if (missingDefs) warnings.push(`정의를 찾지 못한 인스턴스 ${missingDefs}개를 건너뛰었습니다`);
  if (cycles) warnings.push(`자기 자신을 품거나 너무 깊은 인스턴스 ${cycles}개를 건너뛰었습니다`);
  if (truncated)
    warnings.push(`형상이 너무 커서(펼친 면 정점 ${MAX_OUTPUT_VERTICES.toLocaleString('en-US')}개 한도) 일부만 그렸습니다`);
  if (linesTruncated)
    warnings.push(`모서리가 너무 많아(선분 ${MAX_OUTPUT_SEGMENTS.toLocaleString('en-US')}개 한도) 일부 모서리는 그리지 않았습니다`);
  if (placementsStopped)
    warnings.push(
      `인스턴스 배치가 너무 많아(${maxPlacements.toLocaleString('en-US')}번 한도) 일부만 그렸습니다 — 서로를 여러 번 품는 컴포넌트 정의가 있을 수 있습니다`,
    );
  if (extrasTruncated) warnings.push('부드러운 모서리·숨긴 형상이 너무 많아 일부만 담았습니다');

  const parts: SceneParts = {
    meshes,
    lines,
    warnings,
    stats: { triangles, segments, placements },
    tags: [...tagStats.values()],
    materials: [...matStats.values()],
  };
  if (truncated || linesTruncated || placementsStopped) parts.limited = true;
  if (min[0] <= max[0]) parts.bounds = { min, max };
  if (extras) parts.extras = { soft: softIds, hidden: hiddenIds, softSegments, hiddenFaces, hiddenSegments };

  // ── 나무·outline ──
  const nMesh = meshes.length;
  const slotCount = slotNode.length;
  /** 칸 s 이상인 첫 항목 차례(s = 0…slotCount) */
  const firstAtSlot = (slots: number[]): Int32Array => {
    const out = new Int32Array(slotCount + 1);
    let i = 0;
    for (let s = 0; s <= slotCount; s++) {
      while (i < slots.length && slots[i]! < s) i++;
      out[s] = i;
    }
    return out;
  };
  const meshAt = firstAtSlot(meshSlots);
  const lineAt = firstAtSlot(lineSlots);
  const rangeIds = (s0: number, s1: number): string[] => {
    const ids: string[] = [];
    for (let i = meshAt[s0]!; i < meshAt[s1]!; i++) ids.push(meshes[i]!.id);
    for (let i = lineAt[s0]!; i < lineAt[s1]!; i++) ids.push(lines[i]!.id);
    return ids;
  };
  const looseEntry = (): SkpOutlineEntry | null => {
    const loose = slotStats.get(0);
    return loose ? { name: '모형에 바로 놓인 형상', kind: 'loose', tag: defaultTagName, faces: loose.faces, edges: loose.edges, ids: rangeIds(0, 1) } : null;
  };

  if (T) {
    const n = T.n;
    const faces = new Float64Array(n);
    const edges = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      faces[i]! += ownFaces![i]!;
      edges[i]! += ownEdges![i]!;
      const p = T.parent[i]!;
      if (p >= 0) {
        faces[p]! += faces[i]!;
        edges[p]! += edges[i]!;
      }
    }
    const defIndex = new Map<string, number>();
    const definitionNames: string[] = [];
    const tagIndex = new Map<string, number>();
    const tagNames: string[] = [];
    const idx = (map: Map<string, number>, list: string[], s: string): number => {
      let i = map.get(s);
      if (i === undefined) {
        map.set(s, (i = list.length));
        list.push(s);
      }
      return i;
    };
    const tagOf = (inst: SkpInstance): string => (inst.layer !== undefined && inst.layer !== model.defaultLayer ? layerName(inst.layer) : defaultTagName);
    const tree: SkpTree = {
      count: n,
      parent: Int32Array.from(T.parent),
      depth: Uint8Array.from(T.depth, (d) => Math.min(255, d)),
      kind: Uint8Array.from(T.inst, (i) => (i.kind === 'group' ? 0 : 1)),
      flags: Uint8Array.from({ length: n }, (_, i) => (T.hidden[i] ? TREE_HIDDEN : 0) | (T.more[i] ? TREE_MORE : 0)),
      names: T.inst.map((i) => i.name ?? ''),
      definition: Int32Array.from(T.inst, (i) => idx(defIndex, definitionNames, model.definitions.get(i.definition)?.name ?? `정의 ${i.definition}`)),
      definitionNames,
      tag: Int32Array.from(T.inst, (i) => idx(tagIndex, tagNames, tagOf(i))),
      tagNames,
      faces: Uint32Array.from(faces),
      edges: Uint32Array.from(edges),
      firstChild: Int32Array.from(T.firstChild),
      childCount: Uint32Array.from(T.childCount),
      rootCount: T.rootCount,
      meshFirst: new Int32Array(n).fill(-1),
      meshEnd: new Int32Array(n).fill(-1),
      lineFirst: new Int32Array(n).fill(-1),
      lineEnd: new Int32Array(n).fill(-1),
      runFirst: runsDropped ? new Uint32Array(n) : runFirst!,
      runEnd: runsDropped ? new Uint32Array(n) : runEnd!,
      runItem: new Uint32Array(0),
      runStart: new Uint32Array(0),
      runNode: new Int32Array(0),
      runsDropped,
      itemOwner: new Int32Array(nMesh + lines.length),
      splitDepth,
      listedDepth: T.listedDepth,
      unlisted: T.unlisted,
    };
    for (let i = 0; i < n; i++) {
      const s0 = nodeSlot![i]!;
      const s1 = nodeSlotEnd![i]!;
      if (s0 < 0 || s1 < 0) continue;
      tree.meshFirst[i] = meshAt[s0]!;
      tree.meshEnd[i] = meshAt[s1]!;
      tree.lineFirst[i] = lineAt[s0]!;
      tree.lineEnd[i] = lineAt[s1]!;
    }
    for (let i = 0; i < nMesh; i++) tree.itemOwner[i] = slotNode[meshSlots[i]!] ?? -1;
    for (let i = 0; i < lines.length; i++) tree.itemOwner[nMesh + i] = slotNode[lineSlots[i]!] ?? -1;
    if (!runsDropped) {
      const items = runItem.done();
      for (let i = 0; i < items.length; i++) items[i] = serialItem[items[i]!]!;
      tree.runItem = items;
      tree.runStart = runStart.done();
      tree.runNode = Int32Array.from(runNode1.done(), (v) => v - 1);
    } else warnings.push('그룹·컴포넌트가 너무 많아 깊은 단계는 3D에서 눌러 고를 수 없습니다(목록에서는 고를 수 있습니다)');
    parts.tree = tree;

    if (!outlineSkipped) {
      const outline: SkpOutlineEntry[] = [];
      const loose = looseEntry();
      if (loose) outline.push(loose);
      for (let i = 0; i < T.rootCount; i++) {
        if (T.hidden[i]) continue;
        const s0 = nodeSlot![i]!;
        const s1 = nodeSlotEnd![i]!;
        if (s0 < 0 || s1 < 0 || (!faces[i] && !edges[i])) continue;
        const inst = T.inst[i]!;
        const def = model.definitions.get(inst.definition)!;
        outline.push({
          name: inst.name || def.name,
          kind: inst.kind ?? 'component',
          definition: def.name,
          tag: tagOf(inst),
          faces: faces[i]!,
          edges: edges[i]!,
          ids: rangeIds(s0, s1),
          node: i,
        });
      }
      parts.outline = outline;
    }
  } else if (opts.outline && !outlineSkipped) {
    // 그룹·컴포넌트가 없는 모형: 바로 놓인 형상만
    const loose = looseEntry();
    parts.outline = loose ? [loose] : [];
  }
  if (outlineSkipped) parts.outlineSkipped = outlineSkipped;
  return parts;
}
