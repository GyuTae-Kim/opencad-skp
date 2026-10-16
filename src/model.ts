/**
 * SketchUp 2021 이후 model.dat(TLV) → 형상 중간 모형.
 * 꼬리표의 뜻은 공개 표본 12개(21.0~26.1)의 바이트를 견주어 추론했다(docs/formats/skp.md). 모르는 꼬리표는 건너뛴다.
 *
 * 쓰는 경로(관찰):
 *   01f4 뿌리 ─ 0200 설정(61a8/61a9/61aa: 이름 61ab, 값 묶음 61ac = 열쇠 61ad·값 38a4)
 *            ├ 01f7 재질 30d4/30d5/32c8(번호 05dc/05de, 이름 32cc)
 *            ├ 01f8 태그(도면층) 3a98 ─ 3a99/3c8c(번호, 이름 3c8d), 3a9a 기본 태그 번호
 *            ├ 01f9 정의 1770/1771/157c(요소 1388, 이름 157e)
 *            └ 01f6 모형 요소 1388
 *   요소 1388 ─ 07d0 바탕(번호 = 정의 번호), 1389 정점 09c4(번호, 좌표 09c5 = f64×3)
 *            ├ 138a 모서리 0bb8(바탕 07d0, 시작 0bb9, 끝 0bba, 곡선 0bbb)
 *            ├ 138b 면 0dac(바탕, 평면 0dad = f64×4, 뒷면 재질 0daf, 고리 0dae/1194/1195/0fa0(모서리 0fa1, 뒤집힘 0fa2))
 *            ├ 138c 그룹 1964, 138d 컴포넌트 1d4c/1964(바탕, 이름 1965, 변환 1966 = f64×13, 정의 1967)
 *   바탕 07d0 ─ 05dc/05de 번호, 07d1 재질, 07d2 태그, 07d3 깃발(비트 0 숨김, 0x08·0x10 부드러운·매끈한 모서리)
 *   면 무늬 투영(관찰 + PRISME 엔진 기록): 면 바탕 07d0 → 05dc → 속성 05dd → 36b1 → 36b2 → 2710 무늬 위치
 *     ─ 2711 앞 · 2712 뒤 ─ 2713 ─ 2714 종류(i32: 0 그대로, 1 위치 잡음, 2·3 방향으로 투영), 2715 행렬(f64×9, 열 우선),
 *       2716 투영 방향(f64×3, 종류 2·3), 2717 핀(무늬 위치 도구의 점 — 읽지 않는다)
 */

import { TlvReader, type TlvNode } from './tlv';

/** 꼬리표(관찰로 붙인 이름) */
export const TAG = {
  ROOT: 0x01f4,
  OPTIONS: 0x0200,
  MODEL_ENTITIES: 0x01f6,
  MATERIALS: 0x01f7,
  LAYERS: 0x01f8,
  DEFINITIONS: 0x01f9,

  ENTITIES: 0x1388,
  BASE: 0x07d0,
  ID_BOX: 0x05dc,
  ID: 0x05de,
  MATERIAL: 0x07d1,
  LAYER: 0x07d2,
  FLAGS: 0x07d3,

  VERTICES: 0x1389,
  VERTEX: 0x09c4,
  POINT: 0x09c5,
  EDGES: 0x138a,
  EDGE: 0x0bb8,
  EDGE_START: 0x0bb9,
  EDGE_END: 0x0bba,
  FACES: 0x138b,
  FACE: 0x0dac,
  FACE_PLANE: 0x0dad,
  FACE_LOOPS: 0x0dae,
  FACE_BACK: 0x0daf,
  LOOP: 0x1194,
  LOOP_USES: 0x1195,
  EDGE_USE: 0x0fa0,
  USE_EDGE: 0x0fa1,
  USE_REVERSED: 0x0fa2,
  GROUPS: 0x138c,
  COMPONENTS: 0x138d,
  COMPONENT: 0x1d4c,
  INSTANCE: 0x1964,
  INSTANCE_NAME: 0x1965,
  INSTANCE_XFORM: 0x1966,
  INSTANCE_DEF: 0x1967,

  DEF_LIST: 0x1770,
  DEF_ITEMS: 0x1771,
  DEFINITION: 0x157c,
  DEF_NAME: 0x157e,

  MAT_LIST: 0x30d4,
  MAT_ITEMS: 0x30d5,
  MAT: 0x32c8,
  MAT_NAME: 0x32cc,

  LAYER_LIST: 0x3a98,
  LAYER_ITEMS: 0x3a99,
  LAYER_ITEM: 0x3c8c,
  LAYER_NAME: 0x3c8d,
  LAYER_DEFAULT: 0x3a9a,

  OPT_A: 0x61a8,
  OPT_B: 0x61a9,
  OPT_GROUP: 0x61aa,
  OPT_GROUP_NAME: 0x61ab,
  OPT_VALUES: 0x61ac,
  OPT_KEY: 0x61ad,
  VARIANT: 0x38a4,
  VARIANT_INT: 0x38a7,

  OBJ_ATTRS: 0x05dd,
  ATTR_LIST: 0x36b1,
  ATTR_ITEMS: 0x36b2,
  TEX_MAP: 0x2710,
  TEX_FRONT: 0x2711,
  TEX_BACK: 0x2712,
  TEX_SIDE: 0x2713,
  TEX_KIND: 0x2714,
  TEX_MATRIX: 0x2715,
  TEX_DIR: 0x2716,
} as const;

/** 깃발 비트(관찰: 06 보통, 07 숨김, 1e 부드러운·매끈한 곡면 모서리) */
export const FLAG_HIDDEN = 0x01;
export const FLAG_SOFT_SMOOTH = 0x18;

/**
 * 면 한쪽의 무늬 투영(무늬 위치 도구로 옮긴 무늬). 행렬은 무늬 좌표(인치) → 면 평면 틀 좌표(projection.ts의 planeAxes)의
 * 3×3 동차 변환이고 저장한 그대로 열 우선(matrix[c * 3 + r]). 종류 2·3은 면 법선 대신 dir 방향으로 투영한다.
 */
export interface SkpTextureMap {
  kind: number;
  matrix: Float64Array;
  dir?: [number, number, number];
}

export interface SkpFace {
  /** 고리마다 정점 번호(SkpEntities.points 안). 첫 고리가 바깥, 나머지는 구멍(표본에서 확인) */
  loops: number[][];
  /** 평면 법선(앞면 쪽) */
  normal: [number, number, number];
  front?: number;
  back?: number;
  layer?: number;
  flags: number;
  /** 앞·뒷면 무늬 투영(그쪽 재질이 무늬 재질이고 저장된 투영이 있을 때만 — readModelDat의 textured) */
  frontMap?: SkpTextureMap;
  backMap?: SkpTextureMap;
}

export interface SkpEdge {
  a: number;
  b: number;
  flags: number;
  layer?: number;
}

export interface SkpInstance {
  definition: number;
  /** 4×4 열 우선(SketchUp의 3×3은 행 우선 저장 — 붙인 컴포넌트의 z축이 면 법선과 맞는 쪽으로 확인) */
  matrix: Float64Array;
  material?: number;
  layer?: number;
  flags: number;
  name?: string;
  /** 어느 목록에서 왔는지(138c 그룹 · 138d 컴포넌트) — 화면 목록용 */
  kind?: 'group' | 'component';
}

export interface SkpEntities {
  /** 정점 좌표 xyz…(인치) */
  points: Float64Array;
  faces: SkpFace[];
  edges: SkpEdge[];
  instances: SkpInstance[];
}

export interface SkpDefinition {
  id: number;
  name: string;
  entities: SkpEntities;
}

export interface SkpModel {
  materials: Map<number, string>;
  layers: Map<number, string>;
  /** 기본 태그(Layer0·Untagged) 번호 */
  defaultLayer?: number;
  definitions: Map<number, SkpDefinition>;
  root: SkpEntities;
  /** 표시 길이 단위(UnitsOptions/LengthUnit: 0 인치, 1 피트, 2 mm, 3 cm, 4 m — 표본으로 0·2·3·4 확인) */
  lengthUnit?: number;
  counts: { vertices: number; edges: number; faces: number; instances: number };
  warnings: string[];
  /** 잘렸거나 꼬리표 길이가 깨진 곳을 만나 일부만 읽었는지 */
  damaged?: boolean;
}

interface Ctx {
  r: TlvReader;
  warn: Map<string, number>;
  counts: SkpModel['counts'];
  /** 진행 알림(읽은 바이트 위치 기준 0~1) */
  tick: (pos: number) => void;
  /** 깨지거나 잘린 곳을 만났는지 */
  damaged: boolean;
  /** 무늬 투영을 읽을 재질 번호(무늬 재질) */
  texturedIds: Set<number>;
}

/** 목록 틀(꼬리표 길이)이 깨진 정의 — 정의를 통째로 건너뛰게 한다 */
class BrokenList extends Error {}

/** 목록 안 항목을 이만큼 읽을 때마다 진행을 알린다 */
const TICK_EVERY = 4096;

function note(ctx: Ctx, msg: string): void {
  ctx.warn.set(msg, (ctx.warn.get(msg) ?? 0) + 1);
}

/** 바탕(07d0)이나 05dc를 품은 노드의 번호 */
function idOf(r: TlvReader, n: TlvNode): number | undefined {
  const base = r.first(n, TAG.BASE) ?? n;
  return r.uint(r.path(base, TAG.ID_BOX, TAG.ID));
}

interface BaseInfo {
  id?: number;
  material?: number;
  layer?: number;
  flags: number;
}

function baseOf(r: TlvReader, n: TlvNode): BaseInfo {
  const base = r.first(n, TAG.BASE);
  if (!base) return { flags: 0 };
  const out: BaseInfo = { flags: r.u8(r.first(base, TAG.FLAGS)) ?? 0 };
  const id = r.uint(r.path(base, TAG.ID_BOX, TAG.ID));
  if (id !== undefined) out.id = id;
  const m = r.uint(r.first(base, TAG.MATERIAL));
  if (m !== undefined) out.material = m;
  const l = r.uint(r.first(base, TAG.LAYER));
  if (l !== undefined) out.layer = l;
  return out;
}

/** 면 바탕의 무늬 투영(앞·뒤). 없거나 깨졌으면 빈 결과 */
function readTextureMaps(r: TlvReader, face: TlvNode): { front?: SkpTextureMap; back?: SkpTextureMap } {
  const out: { front?: SkpTextureMap; back?: SkpTextureMap } = {};
  const items = r.path(face, TAG.BASE, TAG.ID_BOX, TAG.OBJ_ATTRS, TAG.ATTR_LIST, TAG.ATTR_ITEMS);
  if (!items) return out;
  r.each(items.start, items.end, (tag, start, end) => {
    if (tag !== TAG.TEX_MAP) return;
    r.each(start, end, (st, ss, se) => {
      if (st !== TAG.TEX_FRONT && st !== TAG.TEX_BACK) return;
      const side = r.first({ tag: st, start: ss, end: se }, TAG.TEX_SIDE);
      if (!side) return;
      const m = r.f64s(r.first(side, TAG.TEX_MATRIX));
      if (!m || m.length < 9) return;
      const map: SkpTextureMap = { kind: r.i32(r.first(side, TAG.TEX_KIND)) ?? r.u8(r.first(side, TAG.TEX_KIND)) ?? 0, matrix: Float64Array.from(m.slice(0, 9)) };
      const d = r.f64s(r.first(side, TAG.TEX_DIR));
      if (d && d.length >= 3) map.dir = [d[0]!, d[1]!, d[2]!];
      if (st === TAG.TEX_FRONT) out.front ??= map;
      else out.back ??= map;
    });
  });
  return out;
}

/** 13개 f64(3×3 행 우선, 이동 3, 나눔수 1) → 4×4 열 우선 */
export function matrixFrom13(m: ArrayLike<number>): Float64Array {
  const c = new Float64Array(16);
  c[0] = m[0]!;
  c[1] = m[3]!;
  c[2] = m[6]!;
  c[4] = m[1]!;
  c[5] = m[4]!;
  c[6] = m[7]!;
  c[8] = m[2]!;
  c[9] = m[5]!;
  c[10] = m[8]!;
  c[12] = m[9]!;
  c[13] = m[10]!;
  c[14] = m[11]!;
  const w = m[12]!;
  c[15] = Number.isFinite(w) && w !== 0 ? w : 1;
  return c;
}

/**
 * 요소 묶음(1388) 읽기.
 * tolerant: 목록 틀(길이)이 깨지면 그 앞까지만 읽고 경고한다(모형 요소, 파일 끝에서 잘린 정의).
 * 아니면 목록 틀이 깨진 정의는 BrokenList로 통째로 건너뛴다(쓰레기를 그리지 않게). 항목 하나의 속이 깨진 것은 그 항목만 건너뛴다.
 */
function readEntities(ctx: Ctx, n: TlvNode, tolerant: boolean): SkpEntities {
  const r = ctx.r;
  const parts: TlvNode[] = [];
  const whole = r.eachSafe(n.start, n.end, (tag, start, end, clipped) => {
    // 잘린 묶음은 목록 꼬리표일 때만 쓴다(값 꼬리표는 잘린 내용을 쓰면 안 된다)
    if (clipped && tag !== TAG.VERTICES && tag !== TAG.EDGES && tag !== TAG.FACES && tag !== TAG.GROUPS && tag !== TAG.COMPONENTS) return;
    parts.push({ tag, start, end });
  }, tolerant);
  const broken = (what: string): void => {
    if (!tolerant) throw new BrokenList(what);
    ctx.damaged = true;
    note(ctx, `${what}이 깨져 뒷부분을 읽지 못했습니다`);
  };
  if (!whole) broken('요소 묶음');
  const vertsN = parts.find((c) => c.tag === TAG.VERTICES);
  const edgesN = parts.find((c) => c.tag === TAG.EDGES);
  const facesN = parts.find((c) => c.tag === TAG.FACES);
  const instN = parts.filter((c) => c.tag === TAG.GROUPS || c.tag === TAG.COMPONENTS);
  /** 목록 돌기: 항목 속이 깨지면 그 항목만 건너뛰고, 목록 틀이 깨지면 broken */
  const list = (node: TlvNode | undefined, what: string, itemWhat: string, fn: (tag: number, start: number, end: number) => void): void => {
    if (!node) return;
    let k = 0;
    const ok = r.eachSafe(node.start, node.end, (tag, start, end, clipped) => {
      if (clipped) return;
      if (++k % TICK_EVERY === 0) ctx.tick(start);
      try {
        fn(tag, start, end);
      } catch {
        ctx.damaged = true;
        note(ctx, `깨진 ${itemWhat}을 건너뛰었습니다`);
      }
    });
    if (!ok) broken(what);
  };

  // 정점
  const vIndex = new Map<number, number>();
  const pts: number[] = [];
  list(vertsN, '정점 목록', '정점', (tag, start, end) => {
    if (tag !== TAG.VERTEX) return;
    const node = { tag, start, end };
    const id = idOf(r, node);
    const p = r.first(node, TAG.POINT);
    if (id === undefined || !p || p.end - p.start < 24) {
      note(ctx, '좌표가 없는 정점을 건너뛰었습니다');
      return;
    }
    vIndex.set(id, pts.length / 3);
    pts.push(r.f64(p, 0), r.f64(p, 1), r.f64(p, 2));
  });
  ctx.counts.vertices += pts.length / 3;

  // 모서리
  const eIndex = new Map<number, [number, number]>();
  const edges: SkpEdge[] = [];
  list(edgesN, '모서리 목록', '모서리', (tag, start, end) => {
    if (tag !== TAG.EDGE) return;
    const node = { tag, start, end };
    const b = baseOf(r, node);
    const a = vIndex.get(r.uint(r.first(node, TAG.EDGE_START)) ?? -1);
    const z = vIndex.get(r.uint(r.first(node, TAG.EDGE_END)) ?? -1);
    if (a === undefined || z === undefined) {
      note(ctx, '정점을 찾지 못한 모서리를 건너뛰었습니다');
      return;
    }
    if (b.id !== undefined) eIndex.set(b.id, [a, z]);
    const e: SkpEdge = { a, b: z, flags: b.flags };
    if (b.layer !== undefined) e.layer = b.layer;
    edges.push(e);
  });
  ctx.counts.edges += edges.length;

  // 면
  const faces: SkpFace[] = [];
  list(facesN, '면 목록', '면', (tag, start, end) => {
    if (tag !== TAG.FACE) return;
    const node = { tag, start, end };
    const b = baseOf(r, node);
    const plane = r.f64s(r.first(node, TAG.FACE_PLANE));
    const loopsN = r.first(node, TAG.FACE_LOOPS);
    if (!plane || plane.length < 3 || !loopsN) {
      note(ctx, '평면·고리가 없는 면을 건너뛰었습니다');
      return;
    }
    const loops: number[][] = [];
    const missing = { n: 0 };
    r.each(loopsN.start, loopsN.end, (lt, ls, le) => {
      if (lt !== TAG.LOOP) return;
      const uses = r.first({ tag: lt, start: ls, end: le }, TAG.LOOP_USES);
      if (!uses) return;
      const loop: number[] = [];
      r.each(uses.start, uses.end, (ut, us, ue) => {
        if (ut !== TAG.EDGE_USE) return;
        const u = { tag: ut, start: us, end: ue };
        const e = eIndex.get(r.uint(r.first(u, TAG.USE_EDGE)) ?? -1);
        if (!e) {
          missing.n++;
          return;
        }
        // 뒤집힘이면 모서리 끝 정점에서 시작한다(모든 표본에서 고리가 이어지는 것으로 확인)
        loop.push(r.u8(r.first(u, TAG.USE_REVERSED)) ? e[1] : e[0]);
      });
      if (loop.length >= 3) loops.push(loop);
    });
    if (missing.n > 0) note(ctx, '모서리를 찾지 못한 면 고리가 있습니다');
    if (loops.length === 0) return;
    const f: SkpFace = { loops, normal: [plane[0]!, plane[1]!, plane[2]!], flags: b.flags };
    if (b.material !== undefined) f.front = b.material;
    const back = r.uint(r.first(node, TAG.FACE_BACK));
    if (back !== undefined) f.back = back;
    if (b.layer !== undefined) f.layer = b.layer;
    // 무늬 투영은 그쪽 재질이 무늬 재질인 면만 읽는다(무늬를 지운 재질의 면에도 남아 있다)
    const tf = f.front !== undefined && ctx.texturedIds.has(f.front);
    const tb = back !== undefined && ctx.texturedIds.has(back);
    if (tf || tb) {
      try {
        const maps = readTextureMaps(r, node);
        if (tf && maps.front) f.frontMap = maps.front;
        if (tb && maps.back) f.backMap = maps.back;
      } catch {
        note(ctx, '깨진 무늬 투영을 건너뛰었습니다(기본 투영으로 칠합니다)');
      }
    }
    faces.push(f);
  });
  ctx.counts.faces += faces.length;

  // 그룹·컴포넌트 인스턴스
  const instances: SkpInstance[] = [];
  const readInstance = (node: TlvNode, kind: SkpInstance['kind']): void => {
    const b = baseOf(r, node);
    const def = r.uint(r.first(node, TAG.INSTANCE_DEF));
    const xf = r.f64s(r.first(node, TAG.INSTANCE_XFORM));
    if (def === undefined || !xf || xf.length < 12) {
      note(ctx, '정의·변환이 없는 인스턴스를 건너뛰었습니다');
      return;
    }
    if (xf.length < 13) xf.push(1);
    const inst: SkpInstance = { definition: def, matrix: matrixFrom13(xf), flags: b.flags };
    if (b.material !== undefined) inst.material = b.material;
    if (b.layer !== undefined) inst.layer = b.layer;
    const name = r.str(r.first(node, TAG.INSTANCE_NAME));
    if (name) inst.name = name;
    if (kind) inst.kind = kind;
    instances.push(inst);
  };
  for (const listN of instN) {
    const kind = listN.tag === TAG.GROUPS ? 'group' : 'component';
    list(listN, '인스턴스 목록', '인스턴스', (tag, start, end) => {
      if (tag === TAG.INSTANCE) readInstance({ tag, start, end }, kind);
      else if (tag === TAG.COMPONENT) {
        const inner = r.first({ tag, start, end }, TAG.INSTANCE);
        if (inner) readInstance(inner, kind);
      }
    });
  }
  ctx.counts.instances += instances.length;

  return { points: Float64Array.from(pts), faces, edges, instances };
}

function readLengthUnit(r: TlvReader, options: TlvNode): number | undefined {
  const list = r.path(options, TAG.OPT_A, TAG.OPT_B);
  if (!list) return undefined;
  let unit: number | undefined;
  r.each(list.start, list.end, (tag, start, end) => {
    if (tag !== TAG.OPT_GROUP || unit !== undefined) return;
    const g = { tag, start, end };
    if (r.str(r.first(g, TAG.OPT_GROUP_NAME)) !== 'UnitsOptions') return;
    const vals = r.first(g, TAG.OPT_VALUES);
    if (!vals) return;
    let key: string | undefined;
    r.each(vals.start, vals.end, (t, s, e) => {
      if (t === TAG.OPT_KEY) key = r.str({ tag: t, start: s, end: e });
      else if (t === TAG.VARIANT && key === 'LengthUnit') {
        const v = r.i32(r.first({ tag: t, start: s, end: e }, TAG.VARIANT_INT));
        if (v !== undefined) unit = v;
      }
    });
  });
  return unit;
}

export interface ReadModelOptions {
  /** 무늬 재질 이름(model.dat의 재질 이름 = 꾸러미 폴더 이름). 이 재질을 칠한 면 쪽의 무늬 투영을 읽는다 */
  textured?: Iterable<string>;
}

/**
 * model.dat 바이트 → 중간 모형. 뿌리가 맞지 않으면 Error.
 * 잘렸거나 꼬리표 길이가 깨진 곳이 있으면 그 앞까지 읽고 경고한다(모형이 damaged).
 * onProgress는 읽은 바이트 위치로 진행(0~1)을 알린다.
 */
export function readModelDat(bytes: Uint8Array, onProgress?: (fraction: number) => void, opts: ReadModelOptions = {}): SkpModel {
  const r = new TlvReader(bytes);
  if (bytes.length < 6 || r.dv.getUint16(0, true) !== TAG.ROOT) throw new Error('model.dat 뿌리 꼬리표가 다릅니다');
  const rootLen = r.dv.getUint32(2, true);
  const root: TlvNode = { tag: TAG.ROOT, start: 6, end: Math.min(bytes.length, 6 + rootLen) };
  let last = 0;
  const tick = (pos: number): void => {
    const f = pos / Math.max(1, bytes.length);
    if (!onProgress || f <= last) return;
    last = f;
    try {
      onProgress(f);
    } catch {
      /* 알림 쪽 오류는 무시 */
    }
  };
  const ctx: Ctx = { r, warn: new Map(), counts: { vertices: 0, edges: 0, faces: 0, instances: 0 }, tick, damaged: false, texturedIds: new Set() };
  if (6 + rootLen > bytes.length) {
    ctx.damaged = true;
    note(ctx, 'model.dat가 잘렸습니다(파일 끝까지 받지 못했을 수 있습니다) — 읽을 수 있는 앞부분만 씁니다');
  }

  // 뿌리의 절(section)들: 깨진 곳 앞까지. 정의·모형 요소 묶음은 잘렸어도 앞부분을 살린다
  const sections = new Map<number, TlvNode & { clipped: boolean }>();
  const rootOk = r.eachSafe(
    root.start,
    root.end,
    (tag, start, end, clipped) => {
      if (clipped && tag !== TAG.DEFINITIONS && tag !== TAG.MODEL_ENTITIES) return;
      if (!sections.has(tag)) sections.set(tag, { tag, start, end, clipped });
    },
    true,
  );
  if (!rootOk && 6 + rootLen <= bytes.length) {
    ctx.damaged = true;
    note(ctx, 'model.dat 안의 꼬리표 길이가 깨져 뒷부분을 읽지 못했습니다');
  }

  /** 절 안을 경로대로 내려가기(깨진 것은 undefined) */
  const at = (sec: TlvNode | undefined, ...tags: number[]): TlvNode | undefined => {
    let cur = sec;
    for (const t of tags) {
      if (!cur) return undefined;
      cur = r.firstSafe(cur, t, true);
    }
    return cur;
  };

  const materials = new Map<number, string>();
  const matItems = at(sections.get(TAG.MATERIALS), TAG.MAT_LIST, TAG.MAT_ITEMS);
  if (matItems)
    r.eachSafe(matItems.start, matItems.end, (tag, start, end, clipped) => {
      if (tag !== TAG.MAT || clipped) return;
      const n = { tag, start, end };
      try {
        const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
        if (id !== undefined) materials.set(id, r.str(r.first(n, TAG.MAT_NAME)) ?? `재질 ${id}`);
      } catch {
        note(ctx, '깨진 재질 항목을 건너뛰었습니다');
      }
    });
  const texturedNames = new Set(opts.textured ?? []);
  if (texturedNames.size) for (const [id, n] of materials) if (texturedNames.has(n)) ctx.texturedIds.add(id);

  const layers = new Map<number, string>();
  let defaultLayer: number | undefined;
  const layerList = at(sections.get(TAG.LAYERS), TAG.LAYER_LIST);
  if (layerList) {
    const items = r.firstSafe(layerList, TAG.LAYER_ITEMS, true);
    if (items)
      r.eachSafe(items.start, items.end, (tag, start, end, clipped) => {
        if (tag !== TAG.LAYER_ITEM || clipped) return;
        const n = { tag, start, end };
        try {
          const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
          if (id !== undefined) layers.set(id, r.str(r.first(n, TAG.LAYER_NAME)) ?? `태그 ${id}`);
        } catch {
          note(ctx, '깨진 태그 항목을 건너뛰었습니다');
        }
      });
    defaultLayer = r.uint(r.firstSafe(layerList, TAG.LAYER_DEFAULT));
  }

  const definitions = new Map<number, SkpDefinition>();
  const defItems = at(sections.get(TAG.DEFINITIONS), TAG.DEF_LIST, TAG.DEF_ITEMS);
  if (defItems)
    r.eachSafe(
      defItems.start,
      defItems.end,
      (tag, start, end, clipped) => {
        if (tag !== TAG.DEFINITION) return;
        const n = { tag, start, end };
        ctx.tick(start);
        // 정의 하나가 깨져도 나머지는 읽는다. 파일 끝에서 잘린 정의는 앞부분만 살린다
        try {
          const ents = r.firstSafe(n, TAG.ENTITIES, clipped);
          if (!ents) return;
          const id = idOf(r, ents);
          if (id === undefined) {
            note(ctx, '번호가 없는 정의를 건너뛰었습니다');
            return;
          }
          let name: string | undefined;
          try {
            name = r.str(r.firstSafe(n, TAG.DEF_NAME));
          } catch {
            /* 이름 없이 */
          }
          definitions.set(id, { id, name: name ?? `정의 ${id}`, entities: readEntities(ctx, ents, clipped) });
          if (clipped) ctx.damaged = true;
        } catch {
          ctx.damaged = true;
          note(ctx, '깨진 컴포넌트 정의를 건너뛰었습니다');
        }
      },
      true,
    );

  const empty = (): SkpEntities => ({ points: new Float64Array(0), faces: [], edges: [], instances: [] });
  const modelEnts = at(sections.get(TAG.MODEL_ENTITIES), TAG.ENTITIES);
  let rootEnts = empty();
  if (!modelEnts) note(ctx, '모형 요소(01f6)를 찾지 못했습니다');
  else
    try {
      rootEnts = readEntities(ctx, modelEnts, true);
    } catch {
      ctx.damaged = true;
      note(ctx, '모형 요소(01f6)가 깨져 읽지 못했습니다');
    }

  const options = sections.get(TAG.OPTIONS);
  let lengthUnit: number | undefined;
  try {
    lengthUnit = options && !options.clipped ? readLengthUnit(r, options) : undefined;
  } catch {
    note(ctx, '단위 설정을 읽지 못했습니다');
  }

  const warnings = [...ctx.warn].map(([m, k]) => (k > 1 ? `${m} (${k}개)` : m));
  const model: SkpModel = { materials, layers, definitions, root: rootEnts, counts: ctx.counts, warnings };
  if (defaultLayer !== undefined) model.defaultLayer = defaultLayer;
  if (lengthUnit !== undefined) model.lengthUnit = lengthUnit;
  if (ctx.damaged) model.damaged = true;
  return model;
}
