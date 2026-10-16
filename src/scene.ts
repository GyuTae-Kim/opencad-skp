/**
 * SKP 중간 모형 → Scene3d. 그룹·컴포넌트 인스턴스를 변환을 곱해 펼치고(세계 좌표),
 * 면(바깥 고리 + 구멍)은 평면 법선의 가장 큰 축을 버린 2D 투영으로 earcut 삼각화한다.
 * 그물은 (태그, 재질)마다 하나로 모으고, 모서리는 태그마다 LineSet3d 하나로 모은다.
 * outline 선택을 켜면 모형 바로 아래 그룹·컴포넌트(와 모형에 바로 놓인 형상)마다 따로 모아, 화면이 하나씩 고르고 강조할 수 있게 한다.
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
/** 펼친 뒤 면 정점 수 한도(브라우저 메모리 보호) */
export const MAX_OUTPUT_VERTICES = 12_000_000;
/** 펼친 뒤 모서리 선분 수 한도(넘으면 선만 그만 그리고 면은 계속) */
export const MAX_OUTPUT_SEGMENTS = 3_000_000;
/** 인스턴스 겹 깊이 한도(자기 자신을 품는 깨진 파일 보호) */
const MAX_DEPTH = 64;
/** outline으로 따로 나눌 윗단계 인스턴스 수 기본 한도(그리기 호출 수 보호) */
export const MAX_OUTLINE_ENTRIES = 1000;

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

interface LineBatch {
  layer: number;
  pos: Float64Array;
}

interface Prepared {
  batches: Batch[];
  lines: LineBatch[];
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
  a = new Uint32Array(1024);
  n = 0;
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    let size = this.a.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint32Array(size);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
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

function prepare(ents: SkpEntities, defaultLayer: number | undefined, counter: { failed: number }): Prepared {
  const layerKey = (l: number | undefined): number => (l === undefined || l === defaultLayer ? -1 : l);
  const groups = new Map<string, { mat: MatKey; layer: number; pos: number[]; idx: number[]; faces: number }>();
  for (const f of ents.faces) {
    if (f.flags & FLAG_HIDDEN) continue;
    const mat: MatKey = f.front !== undefined ? f.front : f.back !== undefined ? -(f.back + 2) : -1;
    const layer = layerKey(f.layer);
    const key = `${mat}|${layer}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat, layer, pos: [], idx: [], faces: 0 }));
    if (triangulateFace(ents.points, f.loops, f.normal, g.pos, g.idx)) g.faces++;
    else counter.failed++;
  }
  const batches: Batch[] = [];
  for (const g of groups.values())
    if (g.idx.length)
      batches.push({ mat: g.mat, layer: g.layer, pos: Float64Array.from(g.pos), idx: Uint32Array.from(g.idx), faces: g.faces });

  const lineGroups = new Map<number, number[]>();
  const p = ents.points;
  for (const e of ents.edges) {
    if (e.flags & (FLAG_HIDDEN | FLAG_SOFT_SMOOTH)) continue;
    const layer = layerKey(e.layer);
    let arr = lineGroups.get(layer);
    if (!arr) lineGroups.set(layer, (arr = []));
    arr.push(p[3 * e.a]!, p[3 * e.a + 1]!, p[3 * e.a + 2]!, p[3 * e.b]!, p[3 * e.b + 1]!, p[3 * e.b + 2]!);
  }
  const lines: LineBatch[] = [];
  for (const [layer, arr] of lineGroups) lines.push({ layer, pos: Float64Array.from(arr) });
  return { batches, lines };
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
  /** 이 항목만 담은 그물·모서리 묶음 id */
  ids: string[];
}

export interface BuildOptions {
  /** 모형 바로 아래 그룹·컴포넌트마다 그물·모서리를 따로 나눈다(기본 false — 나누지 않으면 그리기 호출이 적다) */
  outline?: boolean;
  /** 나눌 윗단계 인스턴스 수 한도(넘으면 나누지 않고 outlineSkipped에 수를 적는다) */
  maxOutline?: number;
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
}

/**
 * 중간 모형을 펼친다. scale은 인치 → 장면 단위 배율.
 * materials는 재질 이름 → 정보(material.xml에서 읽은 색).
 */
export function buildSceneParts(model: SkpModel, materials: Map<string, SkpMaterialInfo>, scale = 1, opts: BuildOptions = {}): SceneParts {
  const warnings: string[] = [];
  const counter = { failed: 0 };
  const cache = new Map<SkpEntities, Prepared>();
  const prep = (e: SkpEntities): Prepared => {
    let p = cache.get(e);
    if (!p) cache.set(e, (p = prepare(e, model.defaultLayer, counter)));
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

  interface Bucket {
    slot: number;
    layer: number;
    mat: number | undefined;
    pos: F32;
    idx: U32;
    faces: number;
  }
  interface LineBucket {
    slot: number;
    layer: number;
    pos: F32;
  }
  const buckets = new Map<string, Bucket>();
  const lineBuckets = new Map<string, LineBucket>();

  // outline: 모형 바로 아래 그릴 인스턴스마다 칸 번호(1부터). 0은 모형에 바로 놓인 형상(나누지 않으면 모두 0)
  const slotOf = new Map<SkpInstance, number>();
  const slotInst: SkpInstance[] = [];
  let outlineSkipped = 0;
  if (opts.outline) {
    const top = model.root.instances.filter((inst) => {
      if (inst.flags & FLAG_HIDDEN) return false;
      const def = model.definitions.get(inst.definition);
      return !!def && def.entities !== model.root;
    });
    if (top.length > (opts.maxOutline ?? MAX_OUTLINE_ENTRIES)) outlineSkipped = top.length;
    else
      for (const inst of top) {
        slotInst.push(inst);
        slotOf.set(inst, slotInst.length);
      }
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let outVerts = 0;
  let outSegs = 0;
  let truncated = false;
  let linesTruncated = false;
  let placements = 0;
  let missingDefs = 0;
  let cycles = 0;

  const put = (dst: F32, src: Float64Array, m: Float64Array): void => {
    dst.reserve(src.length);
    const a = dst.a;
    let n = dst.n;
    const affine = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
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
      a[n++] = X;
      a[n++] = Y;
      a[n++] = Z;
      if (X < min[0]) min[0] = X;
      if (Y < min[1]) min[1] = Y;
      if (Z < min[2]) min[2] = Z;
      if (X > max[0]) max[0] = X;
      if (Y > max[1]) max[1] = Y;
      if (Z > max[2]) max[2] = Z;
    }
    dst.n = n;
  };

  const emit = (
    ents: SkpEntities,
    m: Float64Array,
    inhMat: number | undefined,
    inhLayer: number | undefined,
    depth: number,
    stack: Set<SkpEntities>,
    slot: number,
  ): void => {
    if (truncated) return;
    placements++;
    const p = prep(ents);
    const layerHere = inhLayer ?? model.defaultLayer ?? -1;
    for (const b of p.batches) {
      const nv = b.pos.length / 3;
      if (outVerts + nv > MAX_OUTPUT_VERTICES) {
        truncated = true;
        return;
      }
      const mat = b.mat >= 0 ? b.mat : (inhMat ?? (b.mat <= -2 ? -(b.mat + 2) : undefined));
      const layer = b.layer >= 0 ? b.layer : layerHere;
      const key = `${slot}|${layer}|${mat ?? 'd'}`;
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, (bk = { slot, layer, mat, pos: new F32(), idx: new U32(), faces: 0 }));
      const base = bk.pos.n / 3;
      put(bk.pos, b.pos, m);
      bk.idx.reserve(b.idx.length);
      for (let i = 0; i < b.idx.length; i++) bk.idx.a[bk.idx.n++] = base + b.idx[i]!;
      bk.faces += b.faces;
      outVerts += nv;
    }
    for (const l of p.lines) {
      const ns = l.pos.length / 6;
      if (outSegs + ns > MAX_OUTPUT_SEGMENTS) {
        linesTruncated = true;
        break;
      }
      outSegs += ns;
      const layer = l.layer >= 0 ? l.layer : layerHere;
      const key = `${slot}|${layer}`;
      let lb = lineBuckets.get(key);
      if (!lb) lineBuckets.set(key, (lb = { slot, layer, pos: new F32() }));
      put(lb.pos, l.pos, m);
    }
    if (depth >= MAX_DEPTH) {
      if (ents.instances.length) cycles++;
      return;
    }
    stack.add(ents);
    for (const inst of ents.instances) {
      if (inst.flags & FLAG_HIDDEN) continue;
      const def = model.definitions.get(inst.definition);
      if (!def) {
        missingDefs++;
        continue;
      }
      if (stack.has(def.entities)) {
        cycles++;
        continue;
      }
      const layer = inst.layer !== undefined && inst.layer !== model.defaultLayer ? inst.layer : inhLayer;
      emit(def.entities, mul4(m, inst.matrix), inst.material ?? inhMat, layer, depth + 1, stack, depth === 0 ? (slotOf.get(inst) ?? slot) : slot);
      if (truncated) break;
    }
    stack.delete(ents);
  };

  const rootM = new Float64Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
  emit(model.root, rootM, undefined, undefined, 0, new Set(), 0);

  // 통계: 태그는 모형 차례로 미리 넣는다(그릴 것이 없는 태그도 목록에 보이게)
  const defaultTagName = (model.defaultLayer !== undefined ? model.layers.get(model.defaultLayer) : undefined) ?? 'Layer0';
  const tagStats = new Map<string, SkpTagStat>();
  const tagStat = (name: string): SkpTagStat => {
    let t = tagStats.get(name);
    if (!t) tagStats.set(name, (t = { name, default: name === defaultTagName, faces: 0, edges: 0 }));
    return t;
  };
  for (const name of model.layers.values()) tagStat(name);
  const matStats = new Map<string, SkpMaterialStat>();
  const slotStats = new Map<number, { faces: number; edges: number; ids: string[] }>();
  const slotStat = (slot: number): { faces: number; edges: number; ids: string[] } => {
    let s = slotStats.get(slot);
    if (!s) slotStats.set(slot, (s = { faces: 0, edges: 0, ids: [] }));
    return s;
  };

  const meshes: Mesh3d[] = [];
  let triangles = 0;
  const sorted = [...buckets.values()].sort((a, b) => a.slot - b.slot || a.layer - b.layer || (a.mat ?? -1) - (b.mat ?? -1));
  for (const bk of sorted) {
    const stored = bk.mat !== undefined ? model.materials.get(bk.mat) : undefined;
    // 표시 이름은 material.xml의 원래 이름(model.dat에는 '<Black>'이 '_Black_'처럼 바뀌어 있다)
    const matName =
      bk.mat === undefined ? '기본 재질' : stored !== undefined ? (materials.get(stored)?.name ?? stored) : `재질 ${bk.mat}`;
    const tag = layerName(bk.layer);
    const color = colorOf(bk.mat);
    const mesh: Mesh3d = {
      id: `skp-mesh-${meshes.length}`,
      name: `${matName} · ${tag}`,
      positions: bk.pos.done(),
      indices: bk.idx.done(),
      color,
      group: tag,
      doubleSided: true,
    };
    triangles += mesh.indices!.length / 3;
    meshes.push(mesh);
    tagStat(tag).faces += bk.faces;
    let ms = matStats.get(matName);
    if (!ms) {
      const textured = stored !== undefined && !!materials.get(stored)?.textured;
      matStats.set(matName, (ms = { name: matName, color: [color[0], color[1], color[2], color[3]], textured, faces: 0, meshIds: [] }));
    }
    ms.faces += bk.faces;
    ms.meshIds.push(mesh.id);
    const ss = slotStat(bk.slot);
    ss.faces += bk.faces;
    ss.ids.push(mesh.id);
  }
  const lines: LineSet3d[] = [];
  let segments = 0;
  for (const lb of [...lineBuckets.values()].sort((a, b) => a.slot - b.slot || a.layer - b.layer)) {
    const tag = layerName(lb.layer);
    const positions = lb.pos.done();
    const n = positions.length / 6;
    segments += n;
    const id = `skp-edges-${lines.length}`;
    lines.push({ id, name: `모서리 · ${tag}`, positions, color: EDGE_COLOR, group: tag });
    tagStat(tag).edges += n;
    const ss = slotStat(lb.slot);
    ss.edges += n;
    ss.ids.push(id);
  }

  if (counter.failed) warnings.push(`삼각형으로 나누지 못한 면 ${counter.failed}개를 건너뛰었습니다(면적이 0인 면 등)`);
  if (missingDefs) warnings.push(`정의를 찾지 못한 인스턴스 ${missingDefs}개를 건너뛰었습니다`);
  if (cycles) warnings.push(`자기 자신을 품거나 너무 깊은 인스턴스 ${cycles}개를 건너뛰었습니다`);
  if (truncated)
    warnings.push(`형상이 너무 커서(펼친 면 정점 ${MAX_OUTPUT_VERTICES.toLocaleString('en-US')}개 한도) 일부만 그렸습니다`);
  if (linesTruncated)
    warnings.push(`모서리가 너무 많아(선분 ${MAX_OUTPUT_SEGMENTS.toLocaleString('en-US')}개 한도) 일부 모서리는 그리지 않았습니다`);

  const parts: SceneParts = {
    meshes,
    lines,
    warnings,
    stats: { triangles, segments, placements },
    tags: [...tagStats.values()],
    materials: [...matStats.values()],
  };
  if (min[0] <= max[0]) parts.bounds = { min, max };
  if (opts.outline && !outlineSkipped) {
    const outline: SkpOutlineEntry[] = [];
    const loose = slotStats.get(0);
    if (loose) outline.push({ name: '모형에 바로 놓인 형상', kind: 'loose', tag: defaultTagName, faces: loose.faces, edges: loose.edges, ids: loose.ids });
    slotInst.forEach((inst, i) => {
      const st = slotStats.get(i + 1);
      if (!st) return;
      const def = model.definitions.get(inst.definition)!;
      const tag = inst.layer !== undefined && inst.layer !== model.defaultLayer ? layerName(inst.layer) : defaultTagName;
      outline.push({ name: inst.name || def.name, kind: inst.kind ?? 'component', definition: def.name, tag, faces: st.faces, edges: st.edges, ids: st.ids });
    });
    parts.outline = outline;
  }
  if (outlineSkipped) parts.outlineSkipped = outlineSkipped;
  return parts;
}
