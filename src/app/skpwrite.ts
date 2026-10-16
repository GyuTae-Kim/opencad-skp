/**
 * SKP 바이트 쓰기 도구: 형식 기록(docs/formats/skp.md — 공개 표본 바이트로 추론 + PRISME 엔진에서 옮긴 형식 지식)의 구조를 손으로 옮긴 작은 쓰기 도구.
 * 브라우저의 예제 모형(sample.ts)과 시험(tests/build.ts)이 함께 쓴다. 의존성이 없어 브라우저·Node 어디서나 돈다.
 *
 * ZIP 압축은 바깥에서 넘긴다(compress). 넘기지 않으면 저장(무압축, 방식 0)으로 쓴다 — 해석기는 둘 다 읽는다.
 * 실제 SketchUp 파일을 흉내 내는 것은 해석기가 읽는 범위까지이고, SketchUp에서 다시 열리는 것은 확인하지 않았다.
 */

const enc = new TextEncoder();

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}

export function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
}

export function i32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
}

/** 가장 짧은 리틀 엔디언 정수(번호 꼴) */
export function uintLE(v: number): Uint8Array {
  const out: number[] = [];
  do {
    out.push(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return new Uint8Array(out);
}

export function f64(...vs: number[]): Uint8Array {
  const b = new Uint8Array(8 * vs.length);
  const dv = new DataView(b.buffer);
  vs.forEach((v, i) => dv.setFloat64(8 * i, v, true));
  return b;
}

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function f32(...vs: number[]): Uint8Array {
  const b = new Uint8Array(4 * vs.length);
  const dv = new DataView(b.buffer);
  vs.forEach((v, i) => dv.setFloat32(4 * i, v, true));
  return b;
}

export const u8 = (v: number): Uint8Array => new Uint8Array([v & 0xff]);

/** r, g, b, a 4바이트 */
export const rgba = (r: number, g: number, b: number, a = 255): Uint8Array => new Uint8Array([r, g, b, a]);

/** 묶은 번호 목록: [u8 크기 n][n바이트 번호]의 반복 */
export const packedIds = (ids: readonly number[]): Uint8Array =>
  concat(
    ids.flatMap((id) => {
      const b = uintLE(id);
      return [u8(b.length), b];
    }),
  );

/** [u16 꼬리표][u32 길이][내용] */
export function tlv(tag: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u16(tag), u32(body.length), body]);
}

export const idBox = (id: number): Uint8Array => tlv(0x05dc, tlv(0x05de, uintLE(id)));

/** 형 있는 값 0x38a4 */
export const val = {
  nil: (): Uint8Array => tlv(0x38a4),
  byte: (v: number): Uint8Array => tlv(0x38a4, tlv(0x38a5, u8(v))),
  i16: (v: number): Uint8Array => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, v, true);
    return tlv(0x38a4, tlv(0x38a6, b));
  },
  i32: (v: number): Uint8Array => tlv(0x38a4, tlv(0x38a7, i32(v))),
  f32: (v: number): Uint8Array => tlv(0x38a4, tlv(0x38a8, f32(v))),
  f64: (v: number): Uint8Array => tlv(0x38a4, tlv(0x38a9, f64(v))),
  bool: (v: boolean): Uint8Array => tlv(0x38a4, tlv(0x38aa, u8(v ? 1 : 0))),
  color: (r: number, g: number, b: number, a = 255): Uint8Array => tlv(0x38a4, tlv(0x38ab, rgba(r, g, b, a))),
  time: (s: number): Uint8Array => tlv(0x38a4, tlv(0x38ac, i32(s))),
  str: (s: string): Uint8Array => tlv(0x38a4, tlv(0x38ad, utf8(s))),
  arr: (...items: Uint8Array[]): Uint8Array => tlv(0x38a4, tlv(0x38ae, ...items)),
  length: (inch: number): Uint8Array => tlv(0x38a4, tlv(0x38af, f64(inch))),
  point: (x: number, y: number, z: number): Uint8Array => tlv(0x38a4, tlv(0x38b4, f64(x, y, z))),
  vec: (x: number, y: number, z: number): Uint8Array => tlv(0x38a4, tlv(0x38b5, f64(x, y, z))),
  /** 해석기가 모르는 꼴(시험용) */
  raw: (tag: number, payload: Uint8Array): Uint8Array => tlv(0x38a4, tlv(tag, payload)),
};

/** 속성 사전들: [사전 이름, [열쇠, val.…][]][] */
export type AttrDictsSpec = [string, [string, Uint8Array][]][];

/**
 * 속성 목록 0x36b1 → 36b2 → 36b3(36b0, 이름 36b4, 칸 36b5 = 열쇠 36b6·값 38a4 번갈아, 36b7).
 * items는 사전 뒤에 같은 목록에 넣을 다른 항목(면의 무늬 위치 2710 등)
 */
export const attrList = (dicts: AttrDictsSpec, items: Uint8Array[] = []): Uint8Array =>
  tlv(
    0x36b1,
    tlv(
      0x36b2,
      ...dicts.map(([name, kv]) =>
        tlv(0x36b3, tlv(0x36b0), tlv(0x36b4, utf8(name)), tlv(0x36b5, ...kv.flatMap(([k, v]) => [tlv(0x36b6, utf8(k)), v])), tlv(0x36b7, i32(0))),
      ),
      ...items,
    ),
  );

/** 객체 머리 05dc: 05de 번호(+ 05dd 속성 목록: 사전과 다른 항목) */
export const header = (id: number, attrs?: AttrDictsSpec, items?: Uint8Array[]): Uint8Array =>
  tlv(0x05dc, tlv(0x05de, uintLE(id)), ...(attrs || items?.length ? [tlv(0x05dd, attrList(attrs ?? [], items))] : []));

export interface BaseOpts {
  material?: number;
  layer?: number;
  flags?: number;
  /** 바탕 머리(05dc → 05dd)의 속성 사전 */
  attrs?: AttrDictsSpec;
}

/** 면 한쪽 무늬 투영: 종류(0 그대로, 1 위치 잡음, 2·3 방향 투영), 행렬 9개(열 우선, 무늬 인치 → 면 평면 틀), 투영 방향 */
export interface TextureMapOpts {
  kind?: number;
  matrix: readonly number[];
  dir?: readonly [number, number, number];
}

const texSide = (o: TextureMapOpts): Uint8Array =>
  tlv(0x2713, tlv(0x2714, i32(o.kind ?? 1)), tlv(0x2715, f64(...o.matrix)), tlv(0x2716, f64(...(o.dir ?? [0, 0, 0]))), tlv(0x2717));

/** 면 무늬 위치 항목(속성 목록 36b2 안: 2710 → 2711 앞·2712 뒤 → 2713 …) */
export function textureMapping(front?: TextureMapOpts, back?: TextureMapOpts): Uint8Array {
  const sides: Uint8Array[] = [tlv(0x36b0)];
  if (front) sides.push(tlv(0x2711, texSide(front)));
  if (back) sides.push(tlv(0x2712, texSide(back)));
  return tlv(0x2710, ...sides);
}

/** 바탕 07d0. attrItems는 머리 속성 목록에 사전 뒤로 넣을 항목(면의 무늬 위치) */
export function base(id: number | undefined, o: BaseOpts & { attrItems?: Uint8Array[] } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (id !== undefined) parts.push(header(id, o.attrs, o.attrItems));
  if (o.material !== undefined) parts.push(tlv(0x07d1, uintLE(o.material)));
  if (o.layer !== undefined) parts.push(tlv(0x07d2, uintLE(o.layer)));
  parts.push(tlv(0x07d3, new Uint8Array([o.flags ?? 6])));
  return tlv(0x07d0, ...parts);
}

export const vertex = (id: number, x: number, y: number, z: number): Uint8Array => tlv(0x09c4, idBox(id), tlv(0x09c5, f64(x, y, z)));

export interface EdgeOpts extends BaseOpts {
  /** 곡선(4a38) 영구 번호 → 0bbb */
  curve?: number;
}

export const edge = (id: number, a: number, b: number, o: EdgeOpts = {}): Uint8Array =>
  tlv(0x0bb8, base(id, o), tlv(0x0bb9, uintLE(a)), tlv(0x0bba, uintLE(b)), ...(o.curve !== undefined ? [tlv(0x0bbb, uintLE(o.curve))] : []));

export interface FaceOpts extends BaseOpts {
  back?: number;
  /** 앞·뒷면 무늬 투영(무늬 위치 도구로 옮긴 무늬) */
  frontMap?: TextureMapOpts;
  backMap?: TextureMapOpts;
}

/** loops: 고리마다 [모서리 번호, 뒤집힘] */
export function face(id: number, plane: [number, number, number, number], loops: [number, boolean][][], o: FaceOpts = {}): Uint8Array {
  const parts = [base(id, o.frontMap || o.backMap ? { ...o, attrItems: [textureMapping(o.frontMap, o.backMap)] } : o)];
  if (o.back !== undefined) parts.push(tlv(0x0daf, uintLE(o.back)));
  parts.push(tlv(0x0dad, f64(...plane)));
  parts.push(
    tlv(
      0x0dae,
      ...loops.map((l) =>
        tlv(0x1194, tlv(0x1195, ...l.map(([e, rev]) => tlv(0x0fa0, tlv(0x0fa1, uintLE(e)), tlv(0x0fa2, new Uint8Array([rev ? 1 : 0])))))),
      ),
    ),
  );
  return tlv(0x0dac, ...parts);
}

/** 13개 f64: 3×3 행 우선, 이동, 나눔수. guid: 16바이트(없으면 0 16바이트 = 해석기는 GUID 없음으로 본다) */
export function instance(id: number, def: number, m13: number[], o: BaseOpts & { name?: string; guid?: Uint8Array } = {}): Uint8Array {
  return tlv(
    0x1964,
    base(id, o),
    tlv(0x1965, utf8(o.name ?? '')),
    tlv(0x1966, f64(...m13)),
    tlv(0x1967, uintLE(def)),
    tlv(0x1968, o.guid ?? new Uint8Array(16)),
  );
}

export const IDENTITY13 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 16진 글 → 바이트(GUID 등) */
export function hex(s: string): Uint8Array {
  const t = s.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(t.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export interface EntitiesOpts {
  vertices?: Uint8Array[];
  edges?: Uint8Array[];
  faces?: Uint8Array[];
  /** 그룹 인스턴스(instance(…)) → 138d 아래 1d4c 감싸개 → 1964 */
  groups?: Uint8Array[];
  /** 컴포넌트 인스턴스(instance(…)) → 138c 아래 1964 */
  components?: Uint8Array[];
  /** 그림 인스턴스(instance(…), 정의 종류 2) → 1390 아래 1f40 감싸개 → 1964 */
  images?: Uint8Array[];
  /** 묶음 머리(07d0 → 05dc → 05dd) 속성 사전 — 정의 속성(뿌리면 모형 속성). 번호가 있을 때만 쓴다 */
  attrs?: AttrDictsSpec;
  /** 그 밖 목록(curves·texts·linearDims·radialDims·guideLines·guidePoints·sectionPlanes로 만든 것) — 인스턴스 뒤에 붙인다 */
  extra?: Uint8Array[];
  /** 이 묶음의 활성 단면 영구 번호 → 1394 */
  activeSection?: number;
}

/**
 * 요소 묶음 1388. 엔진(SketchUp) 배치: 138c = 컴포넌트(1964 바로), 138d = 그룹(1d4c → 1964), 1390 = 그림(1f40 → 1964).
 * 쓰는 차례는 그룹 목록 → 컴포넌트 목록 → 그림 목록이다(예전 쓰기 도구와 같은 인스턴스 차례 — 해석기는 차례에 기대지 않는다).
 */
export function entities(id: number | undefined, o: EntitiesOpts): Uint8Array {
  const parts = [base(id, o.attrs ? { attrs: o.attrs } : {})];
  parts.push(tlv(0x1389, ...(o.vertices ?? [])));
  parts.push(tlv(0x138a, ...(o.edges ?? [])));
  parts.push(tlv(0x138b, ...(o.faces ?? [])));
  if (o.groups) parts.push(tlv(0x138d, ...o.groups.map((g) => tlv(0x1d4c, g))));
  if (o.components) parts.push(tlv(0x138c, ...o.components));
  if (o.images) parts.push(tlv(0x1390, ...o.images.map((g) => tlv(0x1f40, g))));
  if (o.extra) parts.push(...o.extra);
  if (o.activeSection !== undefined) parts.push(tlv(0x1394, uintLE(o.activeSection)));
  parts.push(tlv(0x139b, tlv(0x639f, tlv(0x63a0))));
  return tlv(0x1388, ...parts);
}

// ── 곡선·주석(요소 묶음의 extra에 넣는다) ─────────────────────────

export interface CurveOpts {
  id: number;
  /** 첫·끝 모서리 영구 번호 */
  first?: number;
  last?: number;
  edgeCount?: number;
  polygon?: boolean;
  /** 호 자료 f64×16: 중심 3, 법선 3, d, x축 3(길이 = 반지름), y축 3, 반지름, 시작각, 끝각 */
  arc?: number[];
}

function curveBody(c: CurveOpts): Uint8Array {
  return tlv(
    0x4a38,
    idBox(c.id),
    tlv(0x4a39, i32(c.edgeCount ?? 0)),
    tlv(0x4a3a, u8(c.polygon ? 1 : 0)),
    ...(c.first !== undefined ? [tlv(0x4a3b, uintLE(c.first))] : []),
    ...(c.last !== undefined ? [tlv(0x4a3c, uintLE(c.last))] : []),
  );
}

/** 곡선 목록: 호 자료가 없는 것은 1396 → 4a38, 있는 것은 1397 → 4c2c → {4a38, 4c2d} */
export function curves(list: CurveOpts[]): Uint8Array[] {
  const plain = list.filter((c) => !c.arc);
  const arcs = list.filter((c) => c.arc);
  const out: Uint8Array[] = [];
  if (plain.length) out.push(tlv(0x1396, ...plain.map(curveBody)));
  if (arcs.length) out.push(tlv(0x1397, ...arcs.map((c) => tlv(0x4c2c, curveBody(c), tlv(0x4c2d, f64(...c.arc!))))));
  return out;
}

/** 치수 점 0x5208: 종류(0 화면, 1 자유, 2 정점, 4 모서리 가운데), 저장 위치, 붙은 대상과 인스턴스 경로(바깥 것부터) */
export function dimPoint(kind: number, p: [number, number, number], ref?: number, path: number[] = []): Uint8Array {
  return tlv(
    0x5208,
    tlv(0x5209, i32(kind)),
    tlv(0x520a, f64(...p)),
    tlv(0x520b, tlv(0x53fc, ...(ref !== undefined ? [tlv(0x53fd, uintLE(ref))] : []), tlv(0x53fe, packedIds(path)))),
  );
}

export interface TextOpts extends BaseOpts {
  id: number;
  text: string;
  /** 붙는 점 0x5208(dimPoint(…)) */
  point?: Uint8Array;
  leader?: [number, number, number];
  screen?: [number, number];
  /** 0 none · 1 view_based · 2 pushpin */
  leaderType?: number;
  font?: number;
  arrow?: number;
}

/** 문자 목록 1398 → 55f0 */
export function texts(list: TextOpts[]): Uint8Array {
  return tlv(
    0x1398,
    ...list.map((t) =>
      tlv(
        0x55f0,
        base(t.id, t),
        tlv(0x55f1, utf8(t.text)),
        tlv(0x55ff),
        tlv(0x55f2, f64(t.screen?.[0] ?? 0.5)),
        tlv(0x55f3, f64(t.screen?.[1] ?? 0.5)),
        tlv(0x55f4, t.point ?? dimPoint(1, [0, 0, 0])),
        tlv(0x55f5, f64(...(t.leader ?? [0, 0, 0]))),
        tlv(0x55f6, u8(0)),
        tlv(0x55f7, f64(0, 0, 1)),
        ...(t.font !== undefined ? [tlv(0x55f9, uintLE(t.font))] : []),
        ...(t.arrow !== undefined ? [tlv(0x55fa, i32(t.arrow))] : []),
        tlv(0x55fd, i32(t.leaderType ?? 0)),
      ),
    ),
  );
}

export interface DimOpts extends BaseOpts {
  id: number;
  text?: string;
  font?: number;
  aligned?: boolean;
  /** 0 none · 1 slash · 2 dot · 3 closed · 4 open */
  arrow?: number;
}

const dimBase = (d: DimOpts): Uint8Array =>
  tlv(
    0x59d8,
    base(d.id, d),
    tlv(0x59d9, utf8(d.text ?? '')),
    ...(d.font !== undefined ? [tlv(0x59da, uintLE(d.font))] : []),
    tlv(0x59db, u8(d.aligned ? 1 : 0)),
    tlv(0x59dc, i32(d.arrow ?? 0)),
  );

export interface LinearDimOpts extends DimOpts {
  /** dimPoint(…) */
  start: Uint8Array;
  end: Uint8Array;
  normal?: [number, number, number];
  xaxis?: [number, number, number];
  /** 0 두 점 방향 · 1 x축 · 2 법선×x축 */
  alignment?: number;
  /** 치수선 띄움 거리(인치) */
  offset?: number;
  /** 0 above · 1 center · 3 outside */
  textPos?: number;
}

/** 선형 치수 목록 1399 → 5bcc */
export function linearDims(list: LinearDimOpts[]): Uint8Array {
  return tlv(
    0x1399,
    ...list.map((d) =>
      tlv(
        0x5bcc,
        dimBase(d),
        tlv(0x5bcd, d.start),
        tlv(0x5bce, d.end),
        tlv(0x5bcf, f64(...(d.normal ?? [0, 0, 1]))),
        tlv(0x5bd0, f64(...(d.xaxis ?? [1, 0, 0]))),
        tlv(0x5bd1, i32(d.alignment ?? 0)),
        tlv(0x5bd3, f64(0)),
        tlv(0x5bd2, f64(d.offset ?? 0)),
        ...(d.textPos !== undefined ? [tlv(0x5bd4, i32(d.textPos))] : []),
      ),
    ),
  );
}

export interface RadialDimOpts extends DimOpts {
  /** 잰 호의 모서리 영구 번호 */
  edge: number;
  /** 라디안(호 x축에서) */
  angle?: number;
  /** 글까지 거리(반지름 배수) */
  leader?: number;
  diameter?: boolean;
}

/** 반지름·지름 치수 목록 139a → 5dc0 */
export function radialDims(list: RadialDimOpts[]): Uint8Array {
  return tlv(
    0x139a,
    ...list.map((d) =>
      tlv(0x5dc0, dimBase(d), tlv(0x5dc1, uintLE(d.edge)), tlv(0x5dc3, f64(d.angle ?? 0)), tlv(0x5dc4, f64(d.leader ?? 1)), tlv(0x5dc5, u8(d.diameter ? 1 : 0))),
    ),
  );
}

export interface GuideLineOpts extends BaseOpts {
  id: number;
  point: [number, number, number];
  /** 단위 방향 */
  direction: [number, number, number];
  /** 매개변수 범위(±1e30 = 끝없음) */
  range?: [number, number];
}

/** 보조선 목록 1391 → 4269(바탕 4268 → 07d0, 자료 426a f64×8) */
export function guideLines(list: GuideLineOpts[]): Uint8Array {
  return tlv(
    0x1391,
    ...list.map((g) =>
      tlv(0x4269, tlv(0x4268, base(g.id, g)), tlv(0x426a, f64(...g.point, ...g.direction, ...(g.range ?? [-1e30, 1e30]))), tlv(0x426b, new Uint8Array([0xff, 0xff]))),
    ),
  );
}

export interface GuidePointOpts extends BaseOpts {
  id: number;
  point: [number, number, number];
  /** 선으로 보이는 보조점의 기준점 */
  anchor?: [number, number, number];
}

/** 보조점 목록 1392 → 426c */
export function guidePoints(list: GuidePointOpts[]): Uint8Array {
  return tlv(
    0x1392,
    ...list.map((g) =>
      tlv(0x426c, tlv(0x4268, base(g.id, g)), tlv(0x426d, f64(...g.point)), tlv(0x426e, f64(...(g.anchor ?? [0, 0, 0]))), tlv(0x426f, u8(g.anchor ? 1 : 0))),
    ),
  );
}

export interface SectionOpts extends BaseOpts {
  id: number;
  plane: [number, number, number, number];
  name?: string;
  symbol?: string;
}

/** 단면 목록 1393 → 445c(활성은 entities의 activeSection) */
export function sectionPlanes(list: SectionOpts[]): Uint8Array {
  return tlv(0x1393, ...list.map((p) => tlv(0x445c, base(p.id, p), tlv(0x445d, f64(...p.plane)), tlv(0x445e, utf8(p.name ?? '')), tlv(0x445f, utf8(p.symbol ?? '')))));
}

// ── 뿌리 절 ────────────────────────────────────────────────────

/** 설정 공급자들: [공급자 이름(UnitsOptions·PageOptions·SlideshowOptions …), [열쇠, val.…][]][] */
export type OptionsSpec = [string, [string, Uint8Array][]][];

/** 설정 절 0200 → 61a8 → 61a9 → 61aa*(이름 61ab, 값 61ac = 열쇠 61ad·값 38a4) */
export const options = (providers: OptionsSpec): Uint8Array =>
  tlv(
    0x0200,
    tlv(0x61a8, tlv(0x61a9, ...providers.map(([name, kv]) => tlv(0x61aa, tlv(0x61ab, utf8(name)), tlv(0x61ac, ...kv.flatMap(([k, v]) => [tlv(0x61ad, utf8(k)), v])))))),
  );

export interface CamOpts {
  eye: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** 기본 원근 */
  perspective?: boolean;
  /** 세로 시야각(도) */
  fov?: number;
  /** 평행 투영 화면 높이(인치) */
  height?: number;
  aspect?: number;
  twoPoint?: boolean;
}

/** 카메라 34bc(저장 차례: 시야각 34c4가 높이 34c3보다 먼저) */
export const camera = (c: CamOpts): Uint8Array =>
  tlv(
    0x34bc,
    tlv(0x34bd, f64(...c.eye)),
    tlv(0x34be, f64(...c.target)),
    tlv(0x34bf, f64(...c.up)),
    tlv(0x34c0, f64(1)),
    tlv(0x34c1, f64(1000)),
    tlv(0x34c2, u8(c.perspective === false ? 0 : 1)),
    tlv(0x34c4, f64(c.fov ?? 35)),
    tlv(0x34c3, f64(c.height ?? 0)),
    tlv(0x34c5, f64(c.aspect ?? 0)),
    tlv(0x34c6, u8(1)),
    tlv(0x34ca, u8(c.twoPoint ? 1 : 0)),
  );

export interface TagSpec {
  id: number;
  name: string;
  hidden?: boolean;
  /** 태그 색 재질 이름(materials/<이름>/material.xml) */
  color?: string;
  /** 새 장면에서 기본 숨김(3c90 = 1) */
  sceneHidden?: boolean;
  /** 선 종류 영구 번호 */
  lineStyle?: number;
  attrs?: AttrDictsSpec;
}

const tagItem = (t: TagSpec, colorId: number): Uint8Array =>
  tlv(
    0x3c8c,
    header(t.id, t.attrs),
    tlv(0x3c8d, utf8(t.name)),
    tlv(0x3c8e, u8(t.hidden ? 1 : 0)),
    ...(t.color !== undefined ? [tlv(0x3c8f, tlv(0x32c8, idBox(colorId), tlv(0x32cc, utf8(t.color)), tlv(0x32ca, u8(1)), tlv(0x32cb)))] : []),
    tlv(0x3c90, i32(t.sceneHidden ? 1 : 0)),
    ...(t.lineStyle !== undefined ? [tlv(0x3c91, uintLE(t.lineStyle))] : []),
  );

export interface FolderSpec {
  id?: number;
  name: string;
  hidden?: boolean;
  /** 이 폴더에 든 태그 번호 */
  tags?: number[];
  children?: FolderSpec[];
}

const folderItem = (f: FolderSpec): Uint8Array =>
  tlv(
    0x3e80,
    ...(f.id !== undefined ? [idBox(f.id)] : []),
    tlv(0x3e81, utf8(f.name)),
    tlv(0x3e83, ...(f.children ?? []).map(folderItem)),
    tlv(0x3e84, packedIds(f.tags ?? [])),
    tlv(0x3e82, u8(f.hidden ? 1 : 0)),
    tlv(0x3e85, u8(0)),
  );

export interface StylesSpec {
  /** [번호, 이름] — 이름 = styles/<이름>/style.xml 폴더 */
  list: [number, string][];
  /** 활성 스타일 번호 */
  active?: number;
  /** 작업 사본 이름(번호 없음) */
  working?: string;
}

/** 스타일 절 0206 → 6978(목록 6979, 활성 697a, 작업 사본 697b) */
export const stylesSection = (st: StylesSpec): Uint8Array =>
  tlv(
    0x0206,
    tlv(
      0x6978,
      tlv(0x6979, ...st.list.map(([id, name]) => tlv(0x6b6c, idBox(id), tlv(0x6b6d, new Uint8Array(16)), tlv(0x6b6e), tlv(0x6b6f, utf8(name))))),
      ...(st.active !== undefined ? [tlv(0x697a, uintLE(st.active))] : []),
      ...(st.working !== undefined ? [tlv(0x697b, tlv(0x6b6c, tlv(0x6b6d, new Uint8Array(16)), tlv(0x6b6e), tlv(0x6b6f, utf8(st.working))))] : []),
    ),
  );

/** 렌더링 레코드 733c: [꼬리표(0x733d~0x738b), 내용][] */
export const rendering = (fields: [number, Uint8Array][]): Uint8Array => tlv(0x733c, ...fields.map(([t, v]) => tlv(t, v)));

/** style.xml 글: [항목 번호, variant 꼴(1 bool·4 int·7 float), 값 글][] */
export function styleXml(items: [number, number, string][], name = 'Style'): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<styleDocument xmlns="http://sketchup.google.com/schemas/sketchup/1.0/style" xmlns:sty="http://sketchup.google.com/schemas/sketchup/1.0/style">\n' +
    `  <sty:style xmlns:t="http://sketchup.google.com/schemas/1.0/types" name="${name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" desc="">\n` +
    items.map(([id, ty, v]) => `    <sty:item id="${id}">\n      <t:variant type="${ty}">${v}</t:variant>\n    </sty:item>\n`).join('') +
    '  </sty:style>\n</styleDocument>\n'
  );
}

export interface PageOpts {
  id: number;
  name: string;
  description?: string;
  /** use 깃발: 0x01 카메라, 0x02 스타일, 0x04 그림자, 0x20 숨긴 태그, 0x40 단면, 0x80 숨긴 형상, 0x100 숨긴 개체 */
  flags: number;
  camera?: CamOpts;
  /** 숨긴 요소 영구 번호 */
  hidden?: number[];
  /** 스타일 번호(StylesSpec.list)와 장면 렌더링 레코드(rendering(…)) */
  style?: number;
  render?: Uint8Array;
  /** 기본과 보임이 다른 태그 번호 */
  tags?: number[];
  sections?: number[];
  include?: boolean;
  /** 초(음수 = 모형 기본) */
  transition?: number;
  delay?: number;
  thumbnail?: string;
}

const pageItem = (p: PageOpts): Uint8Array =>
  tlv(
    0x7148,
    tlv(0x6f54, idBox(p.id), tlv(0x6f55, utf8(p.name)), tlv(0x6f56, utf8(p.description ?? ''))),
    tlv(0x7149, i32(p.flags)),
    ...(p.camera ? [tlv(0x714a, camera(p.camera))] : []),
    tlv(0x714b, packedIds(p.hidden ?? [])),
    ...(p.style !== undefined ? [tlv(0x714c, uintLE(p.style))] : []),
    ...(p.render ? [tlv(0x714d, p.render)] : []),
    tlv(0x7150, packedIds(p.tags ?? [])),
    tlv(0x7159),
    tlv(0x7151, packedIds(p.sections ?? [])),
    tlv(0x7152, u8(p.include === false ? 0 : 1)),
    tlv(0x7153),
    tlv(0x7154, f64(p.transition ?? -1)),
    tlv(0x7155, f64(p.delay ?? -1)),
    tlv(0x7157, u8(1)),
    ...(p.thumbnail ? [tlv(0x7158, tlv(0x2134, utf8(p.thumbnail)))] : []),
  );

export interface FontOpts {
  id: number;
  face: string;
  bold?: boolean;
  italic?: boolean;
  points?: number;
  /** 세계 크기(인치)를 쓰면 */
  worldSize?: number;
}

export interface TextDefaultsOpts {
  font?: number;
  leaderFont?: number;
  arrow?: number;
  leaderType?: number;
  color?: [number, number, number, number];
  leaderColor?: [number, number, number, number];
}

export interface DimDefaultsOpts {
  font?: number;
  aligned?: boolean;
  arrow?: number;
  color?: [number, number, number, number];
  textPos?: number;
}

export interface BehaviorOpts {
  snapTo?: number;
  glued?: boolean;
  noScaleMask?: number;
  cutsOpening?: boolean;
  alwaysFaceCamera?: boolean;
  shadowsFaceSun?: boolean;
}

export interface DefinitionSpec {
  name: string;
  entities: Uint8Array;
  /** 0 컴포넌트(기본) · 1 그룹 · 2 그림 → 1583 */
  kind?: number;
  /** 16바이트(없으면 0 16바이트) */
  guid?: Uint8Array;
  description?: string;
  behavior?: BehaviorOpts;
}

export interface ModelOpts {
  materials?: [number, string][];
  /** 태그 [번호, 이름] — tags를 주면 그쪽을 쓴다 */
  layers?: [number, string][];
  /** 기본 태그 번호(목록 첫째로 옮겨 쓴다 — 기본 태그 = 목록 첫째) */
  defaultLayer?: number;
  /** 활성 태그 번호(3a9a, 기본은 기본 태그) */
  activeLayer?: number;
  /** 태그 전체 칸(숨김·색·장면 기본 숨김·선 종류·속성) */
  tags?: TagSpec[];
  /** 태그 폴더(뿌리 폴더 바로 아래 것들) */
  tagFolders?: FolderSpec[];
  /** 선 종류 [번호, 이름, 무늬] */
  lineStyles?: [number, string, string?][];
  definitions?: DefinitionSpec[];
  root: Uint8Array;
  /** UnitsOptions/LengthUnit만 쓸 때(options를 주면 그쪽을 쓴다) */
  lengthUnit?: number;
  /** 설정 공급자 전체 */
  options?: OptionsSpec;
  /** 모형 카메라(01fa) */
  camera?: CamOpts;
  /** 모형 렌더링 레코드 내용(01fb → 733c) */
  rendering?: [number, Uint8Array][];
  styles?: StylesSpec;
  pages?: { list: PageOpts[]; active?: number };
  fonts?: FontOpts[];
  textDefaults?: TextDefaultsOpts;
  dimDefaults?: DimDefaultsOpts;
  /** 모형 속성 절(0209 → 36b1) 사전 */
  properties?: AttrDictsSpec;
  /** 그 밖 뿌리 절(꼬리표째) — 맨 끝에 붙인다 */
  sections?: Uint8Array[];
}

/** 정의 157c(요소, GUID, 이름, 설명, 경로, 종류, 시각, 동작) */
const definitionItem = (d: DefinitionSpec): Uint8Array =>
  tlv(
    0x157c,
    d.entities,
    tlv(0x157d, d.guid ?? new Uint8Array(16)),
    tlv(0x157e, utf8(d.name)),
    ...(d.description !== undefined ? [tlv(0x157f, utf8(d.description))] : []),
    ...(d.kind !== undefined ? [tlv(0x1583, i32(d.kind))] : []),
    ...(d.behavior
      ? [
          tlv(
            0x1b58,
            tlv(0x1b59, i32(d.behavior.snapTo ?? 0)),
            tlv(0x1b5a, i32(d.behavior.noScaleMask ?? 0)),
            tlv(0x1b5b, u8(d.behavior.glued ? 1 : 0)),
            tlv(0x1b5c, u8(d.behavior.cutsOpening ? 1 : 0)),
            tlv(0x1b5d, u8(d.behavior.alwaysFaceCamera ? 1 : 0)),
            tlv(0x1b5e, u8(d.behavior.shadowsFaceSun ? 1 : 0)),
          ),
        ]
      : []),
  );

/**
 * model.dat 전체. 뿌리 차례는 SketchUp 2026과 비슷하게:
 * 020a → 0209 → 0200 → 01fa → 01fb → 0208 → 01f7 → 01f8 → 01fd → 01fe → 01ff → 01f9 → 01f6 → 0206 → 0207 → (sections)
 */
export function modelDat(o: ModelOpts): Uint8Array {
  const parts: Uint8Array[] = [tlv(0x020a, utf8('meta/meta.dat'))];
  if (o.properties) parts.push(tlv(0x0209, attrList(o.properties)));
  if (o.options) parts.push(options(o.options));
  // lengthUnit만 주면 십진 형식(decimal)으로 쓴다(예전 쓰기 도구는 LengthFormat 1 = architectural을 채워 넣었다)
  else if (o.lengthUnit !== undefined) parts.push(options([['UnitsOptions', [['LengthFormat', val.i32(0)], ['LengthUnit', val.i32(o.lengthUnit)]]]]));
  if (o.camera) parts.push(tlv(0x01fa, camera(o.camera)));
  if (o.rendering) parts.push(tlv(0x01fb, rendering(o.rendering)));
  if (o.lineStyles)
    parts.push(tlv(0x0208, tlv(0x4074, tlv(0x4075, ...o.lineStyles.map(([id, n, pat]) => tlv(0x4076, idBox(id), tlv(0x4077, utf8(n)), tlv(0x4078, utf8(pat ?? '16.0'))))))));
  parts.push(
    tlv(
      0x01f7,
      tlv(0x30d4, tlv(0x30d5, ...(o.materials ?? []).map(([id, n]) => tlv(0x32c8, idBox(id), tlv(0x32cc, utf8(n)), tlv(0x32ca, new Uint8Array([0])))))),
    ),
  );
  let tags: TagSpec[] = o.tags ?? (o.layers ?? [[1, 'Layer0']]).map(([id, name]) => ({ id, name }));
  // 기본 태그 = 목록 첫째
  if (o.defaultLayer !== undefined) {
    const i = tags.findIndex((t) => t.id === o.defaultLayer);
    if (i > 0) tags = [tags[i]!, ...tags.slice(0, i), ...tags.slice(i + 1)];
  }
  // 태그 색 재질의 번호(재질 목록에 없는 번호)
  let colorId = 900_000;
  parts.push(
    tlv(
      0x01f8,
      tlv(
        0x3a98,
        tlv(0x3a99, ...tags.map((t) => tagItem(t, colorId++))),
        tlv(0x3a9a, uintLE(o.activeLayer ?? tags[0]?.id ?? 0)),
        tlv(0x3a9b, folderItem({ name: '', children: o.tagFolders ?? [] })),
      ),
    ),
  );
  if (o.fonts)
    parts.push(
      tlv(
        0x01fd,
        tlv(
          0x4e20,
          tlv(
            0x4e21,
            ...o.fonts.map((f) =>
              tlv(
                0x5014,
                idBox(f.id),
                tlv(0x5015, utf8(f.face)),
                tlv(0x5016, u8(f.bold ? 1 : 0)),
                tlv(0x5017, u8(f.italic ? 1 : 0)),
                tlv(0x5018, i32(f.points ?? 12)),
                tlv(0x5019, u8(f.worldSize !== undefined ? 1 : 0)),
                tlv(0x501a, f64(f.worldSize ?? 1)),
              ),
            ),
          ),
        ),
      ),
    );
  const t = o.textDefaults;
  if (t)
    parts.push(
      tlv(
        0x01fe,
        tlv(
          0x57e4,
          ...(t.font !== undefined ? [tlv(0x57e5, uintLE(t.font))] : []),
          ...(t.leaderFont !== undefined ? [tlv(0x57e6, uintLE(t.leaderFont))] : []),
          ...(t.arrow !== undefined ? [tlv(0x57e7, i32(t.arrow))] : []),
          tlv(0x57e8, i32(0)),
          ...(t.leaderType !== undefined ? [tlv(0x57ea, i32(t.leaderType))] : []),
          ...(t.color ? [tlv(0x57ec, rgba(...t.color))] : []),
          ...(t.leaderColor ? [tlv(0x57ed, rgba(...t.leaderColor))] : []),
        ),
      ),
    );
  const d = o.dimDefaults;
  if (d)
    parts.push(
      tlv(
        0x01ff,
        tlv(
          0x5fb4,
          ...(d.font !== undefined ? [tlv(0x5fb5, uintLE(d.font))] : []),
          ...(d.aligned !== undefined ? [tlv(0x5fb6, u8(d.aligned ? 1 : 0))] : []),
          ...(d.arrow !== undefined ? [tlv(0x5fbb, i32(d.arrow))] : []),
          ...(d.color ? [tlv(0x5fc4, rgba(...d.color))] : []),
          ...(d.textPos !== undefined ? [tlv(0x5fc6, i32(d.textPos))] : []),
        ),
      ),
    );
  parts.push(tlv(0x01f9, tlv(0x1770, tlv(0x1771, tlv(0x0063, u32(0)), ...(o.definitions ?? []).map(definitionItem)))));
  parts.push(tlv(0x01f6, o.root));
  if (o.styles) parts.push(stylesSection(o.styles));
  if (o.pages)
    parts.push(
      tlv(0x0207, tlv(0x6d60, tlv(0x6d61, ...o.pages.list.map(pageItem)), ...(o.pages.active !== undefined ? [tlv(0x6d62, uintLE(o.pages.active))] : []))),
    );
  if (o.sections) parts.push(...o.sections);
  return tlv(0x01f4, ...parts);
}

/** material.xml의 무늬(관찰한 꼴: texture 꼬리표 + images/image) */
export interface MaterialTextureOpts {
  /** 그림 파일 이름(재질 폴더 안) */
  file: string;
  /** 무늬 한 장 가로·세로(인치) */
  width: number;
  height: number;
  /** 원래 그림 평균색(avgColor로 ABGR 정수) */
  average?: readonly [number, number, number];
  /** 색을 바꾼 무늬(type 2)의 방식: 0 shift · 1 tint */
  colorizeType?: 0 | 1;
}

const xmlAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * material.xml 글. hasTexture이고 tex를 주면 texture 꼬리표를 넣는다(colorizeType이 있으면 type 2 — 색을 바꾼 무늬, 아니면 type 1).
 * rgb는 무늬 재질이면 무늬 평균색(type 1) 또는 바꾼 색(type 2)
 */
export function materialXml(name: string, rgb: [number, number, number], trans = 1, useTrans = 0, hasTexture = false, tex?: MaterialTextureOpts): string {
  const type = hasTexture && tex ? (tex.colorizeType !== undefined ? 2 : 1) : 0;
  const head = `  <mat:material name="${xmlAttr(name)}" type="${type}" colorRed="${rgb[0]}" colorGreen="${rgb[1]}" colorBlue="${rgb[2]}" colorizeType="${tex?.colorizeType ?? 0}" trans="${trans}" useTrans="${useTrans}" hasTexture="${hasTexture ? 1 : 0}"`;
  if (!(hasTexture && tex)) return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<materialDocument>\n${head} />\n</materialDocument>\n`;
  const a = tex.average;
  const avg = a ? ` avgColor="${((0xff << 24) | (a[2] << 16) | (a[1] << 8) | a[0]) >>> 0}"` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<materialDocument>\n' +
    `${head}>\n` +
    `    <mat:texture textureFilename="${xmlAttr(tex.file)}" xScale="${tex.width}" yScale="${tex.height}"${avg}>\n` +
    `      <mat:images>\n        <mat:image id="1" path="./${xmlAttr(tex.file)}" file_name="${xmlAttr(tex.file)}"/>\n      </mat:images>\n` +
    '    </mat:texture>\n  </mat:material>\n</materialDocument>\n'
  );
}

let crcTable: Uint32Array | null = null;

/** CRC-32(ZIP과 같은 다항식 0xEDB88320) */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32(zlib 꼬리) */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib 흐름(무압축 저장 블록만 — PNG 그림을 의존성 없이 만들려고) */
export function zlibStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let o = 0;
  do {
    const n = Math.min(65535, data.length - o);
    const last = o + n >= data.length ? 1 : 0;
    parts.push(new Uint8Array([last, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff]), data.subarray(o, o + n));
    o += n;
  } while (o < data.length);
  const t = adler32(data);
  parts.push(new Uint8Array([t >>> 24, (t >>> 16) & 0xff, (t >>> 8) & 0xff, t & 0xff]));
  return concat(parts);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = utf8(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([head, data])));
  return concat([len, head, data, crc]);
}

/** 작은 RGB PNG(예제·시험용 그림). pixel(x, y) → [r, g, b] 0~255 */
export function pngRgb(w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + 3 * w);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      raw.set([c[0] & 0xff, c[1] & 0xff, c[2] & 0xff], row + 1 + 3 * x);
    }
  }
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibStored(raw)), pngChunk('IEND', new Uint8Array(0))]);
}

/** 원시 DEFLATE 압축 함수(Node의 deflateRawSync 등). null을 돌려주거나 함수가 없으면 저장 방식 */
export type Compressor = (data: Uint8Array) => Uint8Array | null;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** compress가 있을 때 압축할지 */
  deflate?: boolean;
}

/** ZIP(지역 머리 + 중앙 목록 + 끝 레코드). 위치는 ZIP 시작 기준(SKP처럼) */
export function zip(entries: ZipEntry[], compress?: Compressor): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const e of entries) {
    const name = utf8(e.name);
    const packed = e.deflate && compress ? compress(e.data) : null;
    const body = packed ?? e.data;
    const method = packed ? 8 : 0;
    const crc = crc32(e.data);
    const lh = concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(body.length), u32(e.data.length), u16(name.length), u16(0), name]);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(body.length), u32(e.data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name,
      ]),
    );
    locals.push(lh, body);
    off += lh.length + body.length;
  }
  const cd = concat(central);
  const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
  return concat([...locals, cd, eocd]);
}

/** 머리 문자열: FF FE FF + 길이 + UTF-16LE */
export function utf16String(s: string): Uint8Array {
  const b = new Uint8Array(4 + 2 * s.length);
  b.set([0xff, 0xfe, 0xff, s.length]);
  for (let i = 0; i < s.length; i++) {
    b[4 + 2 * i] = s.charCodeAt(i) & 0xff;
    b[5 + 2 * i] = s.charCodeAt(i) >> 8;
  }
  return b;
}

export interface SkpFileOpts {
  version?: string;
  /** [꾸러미 폴더 이름(= model.dat의 재질 이름), material.xml 글] */
  materials?: [string, string][];
  /** 압축할지(compress가 있을 때만 뜻이 있다, 기본 true) */
  deflate?: boolean;
  compress?: Compressor;
  /** model.dat 앞에 넣을 항목(그림 등: meta/model_thumbnail.png, materials/<폴더>/<그림>, thumbnails/…, scene_thumbnails/…) */
  extra?: ZipEntry[];
}

/** 2021 이후 꼴의 파일 전체 */
export function skpFile(model: Uint8Array, opts: SkpFileOpts = {}): Uint8Array {
  const head = concat([
    utf16String('SketchUp Model'),
    utf16String(`{${opts.version ?? '26.1.194'}}`),
    utf8('VFF'),
    u16(8),
    u16(1),
    u16(17),
    u32(0x12345678),
  ]);
  const deflate = opts.deflate ?? true;
  const entries: ZipEntry[] = [
    { name: 'meta/meta.dat', data: new Uint8Array([0x64, 0, 0, 0, 0, 0]) },
    ...(opts.materials ?? []).map(([n, xml]) => ({ name: `materials/${n}/material.xml`, data: utf8(xml), deflate })),
    ...(opts.extra ?? []),
    { name: 'model.dat', data: model, deflate },
  ];
  return concat([head, zip(entries, opts.compress)]);
}

/** 2020 이하 꼴의 머리(+ MFC 버전 표 시작) */
export function oldSkpHeader(version: string): Uint8Array {
  return concat([
    utf16String('SketchUp Model'),
    utf16String(`{${version}}`),
    new Uint8Array(16),
    new Uint8Array([0xff, 0xfe, 0xff, 0x00]),
    u32(0x5eb2f812),
    new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x0b, 0x00]),
    utf8('CVersionMap'),
  ]);
}
