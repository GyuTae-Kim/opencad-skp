/**
 * 요소 묶음의 면·모서리 표(형식 배열). 칸마다 형식 배열 하나에 면·모서리 차례대로 둔다.
 *
 * 면·모서리를 객체로 두면 큰 모형(면 64만·모서리 106만)에서 중간 모형이 heap을 700 MB 넘게 잡았다
 * (면 하나에 객체·고리 배열 넷·법선 배열 — 면 하나에 1 KB 남짓, 모서리 하나에 100 B 남짓). 표로 두면 면 하나에 90 B,
 * 모서리 하나에 37 B 안팎이고, 형식 배열은 heap 밖(external)에 있어 GC가 훑지 않는다.
 *
 * 고리는 두 단계 구간이다: 면 k의 고리는 loopStart[k] ~ loopStart[k + 1](고리 차례), 고리 j의 꼭짓점은
 * cornerStart[j] ~ cornerStart[j + 1](꼭짓점 차례). 그래서 한 면의 꼭짓점은 고리를 이어 붙인 차례로 이어진 구간이다.
 * 없는 번호(태그·재질·영구 번호)는 NaN이다(번호는 2^53까지 읽고, 2020 이하 장면 숨김용 임시 영구 번호는 음수라 -1을 쓸 수 없다).
 * 면·모서리 하나를 객체로 보고 싶으면(시험·진단) faceAt·edgeAt, 객체 목록에서 표를 만들 때는 facesFrom·edgesFrom.
 */
import { F64, I32, U32, U8 } from './grow';
import type { SkpAttrDicts, SkpEdge, SkpFace, SkpTextureMap } from './model';

/** 고리의 모서리 번호를 모른다(그 고리의 꼭짓점 모두 — 그 고리는 정점 짝으로 모서리를 찾는다) */
export const EDGE_UNKNOWN = -2;

/** 모서리 표 */
export interface SkpEdges {
  readonly length: number;
  /** 두 끝 정점(SkpEntities.points 차례) */
  a: Int32Array;
  b: Int32Array;
  /** 깃발(model.ts FLAG_*) */
  flags: Uint8Array;
  /** 태그·재질·영구 번호(없으면 NaN) */
  layer: Float64Array;
  material: Float64Array;
  pid: Float64Array;
  /** SkpEntities.curves 차례(-1 = 곡선 아님) */
  curve: Int32Array;
  /** 모서리 차례 → 속성 사전(있는 모서리만) */
  attrs?: Map<number, SkpAttrDicts>;
}

/** 면 표 */
export interface SkpFaces {
  readonly length: number;
  /** 면 k의 고리 = [loopStart[k], loopStart[k + 1]) — 길이 = 면 수 + 1. 첫 고리가 바깥, 나머지는 구멍 */
  loopStart: Uint32Array;
  /** 고리 j의 꼭짓점 = [cornerStart[j], cornerStart[j + 1]) — 길이 = 고리 수 + 1 */
  cornerStart: Uint32Array;
  /** 꼭짓점마다 정점 번호(SkpEntities.points 차례) */
  vertex: Int32Array;
  /**
   * 꼭짓점마다 그 꼭짓점에서 나가는 모서리(SkpEntities.edges 차례 — 매끈한 모서리 건너 법선 잇기·닫힌 입체 가리기용).
   * 모르는 고리는 EDGE_UNKNOWN, 어느 면도 모르면 null(정점 짝으로 모서리를 찾는다)
   */
  edge: Int32Array | null;
  /** 면마다 평면 법선 xyz(앞면 쪽) */
  normal: Float64Array;
  flags: Uint8Array;
  /** 앞·뒤 재질, 태그, 영구 번호(0x05DE — 장면의 숨긴 목록이 가리킨다). 없으면 NaN */
  front: Float64Array;
  back: Float64Array;
  layer: Float64Array;
  pid: Float64Array;
  /** 면 차례 → 속성 사전(있는 면만) */
  attrs?: Map<number, SkpAttrDicts>;
  /** 앞·뒷면 무늬 투영(그쪽 재질이 무늬 재질이고 저장된 투영이 있는 면만 — 그런 면이 없으면 없다). 꺼낼 때는 textureMapAt */
  frontMaps?: SkpTextureMaps;
  backMaps?: SkpTextureMaps;
}

/**
 * 면 무늬 투영 표(한쪽): 면 k의 투영은 at[k]번째(-1 = 없음). 투영마다 MAP_STRIDE칸 —
 * 종류, 방향이 있는지(1·0), 행렬 9칸(열 우선), 방향 3칸. 투영을 객체로 두면 큰 무늬 모형에서 heap을 수백 MB 잡았다
 */
export interface SkpTextureMaps {
  at: Int32Array;
  data: Float64Array;
}

export const MAP_STRIDE = 14;

/** 면 k의 무늬 투영(없으면 undefined). 행렬은 표를 보는 배열(복사하지 않는다) */
export function textureMapAt(t: SkpTextureMaps | undefined, k: number): SkpTextureMap | undefined {
  const i = t ? t.at[k]! : -1;
  if (!(i >= 0)) return undefined;
  const d = t!.data;
  const o = i * MAP_STRIDE;
  const m: SkpTextureMap = { kind: d[o]!, matrix: d.subarray(o + 2, o + 11) };
  if (d[o + 1]) m.dir = [d[o + 11]!, d[o + 12]!, d[o + 13]!];
  return m;
}

/** 무늬 투영 표 쌓기(첫 투영이 나올 때 만든다 — 그 앞 면은 -1) */
class MapTableBuilder {
  private readonly at: I32;
  private readonly data = new F64(MAP_STRIDE * 4);
  private count = 0;
  constructor(faces: number) {
    this.at = new I32(Math.max(16, faces));
    this.at.a.fill(-1, 0, faces);
    this.at.n = faces;
  }
  add(m: Readonly<SkpTextureMap> | undefined): void {
    if (!m) {
      this.at.push(-1);
      return;
    }
    this.at.push(this.count++);
    const d = this.data;
    d.reserve(MAP_STRIDE);
    const o = d.n;
    d.a[o] = m.kind;
    d.a[o + 1] = m.dir ? 1 : 0;
    for (let i = 0; i < 9; i++) d.a[o + 2 + i] = m.matrix[i]!;
    for (let i = 0; i < 3; i++) d.a[o + 11 + i] = m.dir ? m.dir[i]! : NaN;
    d.n = o + MAP_STRIDE;
  }
  done(): SkpTextureMaps {
    return { at: this.at.done(), data: this.data.done() };
  }
}

/** NaN(없음)이면 undefined */
export const opt = (v: number): number | undefined => (v === v ? v : undefined);
const num = (v: number | undefined): number => (v === undefined ? NaN : v);

/** 모서리 표 쌓기(길이를 모를 때). 끝내면(done) 칸마다 꼭 맞는 길이 */
export class EdgeTableBuilder {
  private readonly a = new I32(16);
  private readonly b = new I32(16);
  private readonly flags = new U8(16);
  private readonly layer = new F64(16);
  private readonly material = new F64(16);
  private readonly pid = new F64(16);
  private readonly curve = new I32(16);
  private attrs?: Map<number, SkpAttrDicts>;

  get length(): number {
    return this.a.n;
  }

  /** 모서리 하나를 더하고 그 차례를 돌려준다 */
  push(e: Readonly<SkpEdge>): number {
    const i = this.a.n;
    this.a.push(e.a);
    this.b.push(e.b);
    this.flags.push(e.flags);
    this.layer.push(num(e.layer));
    this.material.push(num(e.material));
    this.pid.push(num(e.pid));
    this.curve.push(e.curve ?? -1);
    if (e.attrs) (this.attrs ??= new Map()).set(i, e.attrs);
    return i;
  }

  done(): SkpEdges {
    const out: SkpEdges = {
      length: this.a.n,
      a: this.a.done(),
      b: this.b.done(),
      flags: this.flags.done(),
      layer: this.layer.done(),
      material: this.material.done(),
      pid: this.pid.done(),
      curve: this.curve.done(),
    };
    if (this.attrs) out.attrs = this.attrs;
    return out;
  }
}

/** 면 표 쌓기(길이를 모를 때). 면은 고리를 다 모은 뒤 한 번에 더한다(깨진 면을 건너뛸 때 되돌릴 것이 없게) */
export class FaceTableBuilder {
  private readonly loopStart = new U32(16);
  private readonly cornerStart = new U32(16);
  private readonly vertex = new I32(64);
  private readonly edge = new I32(64);
  /** 모서리 번호를 아는 고리가 하나라도 있었는지(없으면 표의 edge는 null) */
  private anyEdge = false;
  private readonly normal = new F64(48);
  private readonly flags = new U8(16);
  private readonly front = new F64(16);
  private readonly back = new F64(16);
  private readonly layer = new F64(16);
  private readonly pid = new F64(16);
  private attrs?: Map<number, SkpAttrDicts>;
  private frontMaps?: MapTableBuilder;
  private backMaps?: MapTableBuilder;

  constructor() {
    this.loopStart.push(0);
    this.cornerStart.push(0);
  }

  get length(): number {
    return this.flags.n;
  }

  /**
   * 면 하나를 더하고 그 차례를 돌려준다. 고리마다 모서리 목록(loopEdges)이 있고 길이가 고리와 같으면 그 번호를,
   * 아니면 그 고리는 EDGE_UNKNOWN
   */
  push(f: Readonly<SkpFace>): number {
    const k = this.flags.n;
    for (let li = 0; li < f.loops.length; li++) {
      const loop = f.loops[li]!;
      const via = f.loopEdges?.[li];
      const known = !!via && via.length === loop.length;
      if (known) this.anyEdge = true;
      this.vertex.reserve(loop.length);
      this.edge.reserve(loop.length);
      for (let c = 0; c < loop.length; c++) {
        this.vertex.a[this.vertex.n++] = loop[c]!;
        this.edge.a[this.edge.n++] = known ? via![c]! : EDGE_UNKNOWN;
      }
      this.cornerStart.push(this.vertex.n);
    }
    this.loopStart.push(this.cornerStart.n - 1);
    this.normal.reserve(3);
    for (let i = 0; i < 3; i++) this.normal.a[this.normal.n++] = f.normal[i]!;
    this.flags.push(f.flags);
    this.front.push(num(f.front));
    this.back.push(num(f.back));
    this.layer.push(num(f.layer));
    this.pid.push(num(f.pid));
    if (f.attrs) (this.attrs ??= new Map()).set(k, f.attrs);
    if (f.frontMap) this.frontMaps ??= new MapTableBuilder(k);
    this.frontMaps?.add(f.frontMap);
    if (f.backMap) this.backMaps ??= new MapTableBuilder(k);
    this.backMaps?.add(f.backMap);
    return k;
  }

  done(): SkpFaces {
    const edge = this.edge.done();
    const out: SkpFaces = {
      length: this.flags.n,
      loopStart: this.loopStart.done(),
      cornerStart: this.cornerStart.done(),
      vertex: this.vertex.done(),
      edge: this.anyEdge ? edge : null,
      normal: this.normal.done(),
      flags: this.flags.done(),
      front: this.front.done(),
      back: this.back.done(),
      layer: this.layer.done(),
      pid: this.pid.done(),
    };
    if (this.attrs) out.attrs = this.attrs;
    if (this.frontMaps) out.frontMaps = this.frontMaps.done();
    if (this.backMaps) out.backMaps = this.backMaps.done();
    return out;
  }
}

/** 모서리 객체 목록 → 표 */
export function edgesFrom(list: readonly Readonly<SkpEdge>[]): SkpEdges {
  const t = new EdgeTableBuilder();
  for (const e of list) t.push(e);
  return t.done();
}

/** 면 객체 목록 → 표 */
export function facesFrom(list: readonly Readonly<SkpFace>[]): SkpFaces {
  const t = new FaceTableBuilder();
  for (const f of list) t.push(f);
  return t.done();
}

/** 빈 표 */
export const emptyEdges = (): SkpEdges => edgesFrom([]);
export const emptyFaces = (): SkpFaces => facesFrom([]);

/** 모서리 i를 객체로(시험·진단용 — 표를 바꾸지 않는다) */
export function edgeAt(t: SkpEdges, i: number): SkpEdge {
  const e: SkpEdge = { a: t.a[i]!, b: t.b[i]!, flags: t.flags[i]! };
  const layer = opt(t.layer[i]!);
  if (layer !== undefined) e.layer = layer;
  const pid = opt(t.pid[i]!);
  if (pid !== undefined) e.pid = pid;
  const material = opt(t.material[i]!);
  if (material !== undefined) e.material = material;
  if (t.curve[i]! >= 0) e.curve = t.curve[i]!;
  const attrs = t.attrs?.get(i);
  if (attrs) e.attrs = attrs;
  return e;
}

/** 면 k를 객체로(시험·진단용). 모서리 번호를 모르는 고리는 loopEdges에서 빠진다(모든 고리를 모르면 loopEdges가 없다) */
export function faceAt(t: SkpFaces, k: number): SkpFace {
  const loops: number[][] = [];
  const loopEdges: number[][] = [];
  let known = true;
  for (let j = t.loopStart[k]!; j < t.loopStart[k + 1]!; j++) {
    const s = t.cornerStart[j]!;
    const e = t.cornerStart[j + 1]!;
    loops.push(Array.from(t.vertex.subarray(s, e)));
    if (t.edge && e > s && t.edge[s] !== EDGE_UNKNOWN) loopEdges.push(Array.from(t.edge.subarray(s, e)));
    else known = false;
  }
  const f: SkpFace = { loops, normal: [t.normal[3 * k]!, t.normal[3 * k + 1]!, t.normal[3 * k + 2]!], flags: t.flags[k]! };
  const front = opt(t.front[k]!);
  if (front !== undefined) f.front = front;
  const back = opt(t.back[k]!);
  if (back !== undefined) f.back = back;
  const layer = opt(t.layer[k]!);
  if (layer !== undefined) f.layer = layer;
  const pid = opt(t.pid[k]!);
  if (pid !== undefined) f.pid = pid;
  if (known && loopEdges.length) f.loopEdges = loopEdges;
  const attrs = t.attrs?.get(k);
  if (attrs) f.attrs = attrs;
  const fm = textureMapAt(t.frontMaps, k);
  if (fm) f.frontMap = fm;
  const bm = textureMapAt(t.backMaps, k);
  if (bm) f.backMap = bm;
  return f;
}

/** 표 → 객체 목록(시험·진단용) */
export const edgeList = (t: SkpEdges): SkpEdge[] => Array.from({ length: t.length }, (_, i) => edgeAt(t, i));
export const faceList = (t: SkpFaces): SkpFace[] => Array.from({ length: t.length }, (_, k) => faceAt(t, k));

/** 면 k의 꼭짓점 구간 [시작, 끝) — 고리를 이어 붙인 차례 */
export function faceCorners(t: SkpFaces, k: number): [number, number] {
  return [t.cornerStart[t.loopStart[k]!]!, t.cornerStart[t.loopStart[k + 1]!]!];
}

/** 고리 j의 모서리 번호를 아는지 */
export function loopEdgesKnown(t: SkpFaces, j: number): boolean {
  const s = t.cornerStart[j]!;
  return !!t.edge && s < t.cornerStart[j + 1]! && t.edge[s] !== EDGE_UNKNOWN;
}
