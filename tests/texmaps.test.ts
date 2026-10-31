/**
 * 모서리·면·면 무늬 투영 읽기(34차 — src/model.ts readEdgeItem·readFaceItem·readTextureMaps, src/tlv.ts firstEach):
 * 자식을 한 번만 돌고(firstEach), 고리·쓰임 목록을 그 자리에서 돌며, 모서리·면 객체 없이 표에 적고, 무늬 투영 행렬을 면마다 새로 잡지 않고 다시 쓰는 자리에 적어도
 * 33차까지의 식(아래 옛 식 — 꼬리표마다 r.first, r.each 콜백, 객체를 만들어 표에 push)과 같은 표·같은 경고·같은 번호표를 내고,
 * 길이가 넘친 자식·잘린 머리·겹친 꼬리표·빠진 꼬리표·표 밖 모서리 번호가 섞여도 같은 항목에서 같은 글로 던지는지(그 앞에 적은 것까지 같은지) 본다.
 */
import { describe, expect, it } from 'vitest';
import { attrList, concat, f64, i32, tlv, u16, u32, u8, uintLE, val } from './build';
import { firstFound, TlvReader, type TlvNode } from '../src/tlv';
import { readEdgeItem, readFaceItem, readTextureMaps, type ItemReadState, type SkpEdge, type SkpFace, type SkpTextureMap } from '../src/model';
import { EdgeTableBuilder, edgesFrom, FaceTableBuilder, type SkpEdges } from '../src/entities';
import { readBase, readHeaderAttrs } from '../src/vffcommon';
import { TAG } from '../src/vfftags';

// ── 33차 식 ──────────────────────────────────────────────

function oldReadTextureMaps(r: TlvReader, faceNode: TlvNode): { front?: SkpTextureMap; back?: SkpTextureMap } {
  const out: { front?: SkpTextureMap; back?: SkpTextureMap } = {};
  const items = r.path(faceNode, TAG.BASE, TAG.ID_BOX, TAG.ATTRS, TAG.ATTR_LIST, TAG.ATTR_ITEMS);
  if (!items) return out;
  r.each(items.start, items.end, (tag, start, end) => {
    if (tag !== TAG.TEX_MAP) return;
    r.each(start, end, (st, ss, se) => {
      if (st !== TAG.TEX_FRONT && st !== TAG.TEX_BACK) return;
      const side = r.firstIn(ss, se, TAG.TEX_SIDE);
      if (!side) return;
      const mn = r.first(side, TAG.TEX_MATRIX);
      if (!mn || mn.end - mn.start < 72) return;
      const matrix = new Float64Array(9);
      for (let i = 0; i < 9; i++) matrix[i] = r.f64(mn, i);
      const kn = r.first(side, TAG.TEX_KIND);
      const map: SkpTextureMap = { kind: r.i32(kn) ?? r.u8(kn) ?? 0, matrix };
      const d = r.f64s(r.first(side, TAG.TEX_DIR));
      if (d && d.length >= 3) map.dir = [d[0]!, d[1]!, d[2]!];
      if (st === TAG.TEX_FRONT) out.front ??= map;
      else out.back ??= map;
    });
  });
  return out;
}

function oldReadEdge(r: TlvReader, start: number, end: number, s: ItemReadState): void {
  const node = { tag: TAG.EDGE, start, end };
  const b = readBase(r, node);
  const a = s.vIndex.get(r.uint(r.first(node, TAG.EDGE_START)) ?? -1);
  const z = s.vIndex.get(r.uint(r.first(node, TAG.EDGE_END)) ?? -1);
  if (a === undefined || z === undefined) {
    s.warn('정점을 찾지 못한 모서리를 건너뛰었습니다');
    return;
  }
  const e: SkpEdge = { a, b: z, flags: b.flags };
  if (b.layer !== undefined) e.layer = b.layer;
  if (b.material !== undefined) e.material = b.material;
  if (b.id !== undefined) {
    e.pid = b.id;
    if (!s.eIndex.has(b.id)) s.eIndex.set(b.id, s.edgeTable.length);
  }
  const curve = r.uint(r.first(node, TAG.EDGE_CURVE));
  if (curve !== undefined) s.edgeCurve.set(s.edgeTable.length, curve);
  const attrs = readHeaderAttrs(r, b.header, s.warn);
  if (attrs) e.attrs = attrs;
  s.edgeTable.push(e);
}

function oldReadFace(r: TlvReader, start: number, end: number, s: ItemReadState, edges: SkpEdges, faceTable: FaceTableBuilder): void {
  const edgeIn = (i: number): number => {
    if (!(i >= 0 && i < edges.length)) throw new RangeError('모서리 번호가 표 밖입니다');
    return i;
  };
  const node = { tag: TAG.FACE, start, end };
  const b = readBase(r, node);
  const plane = r.f64s(r.first(node, TAG.FACE_PLANE));
  const loopsN = r.first(node, TAG.FACE_LOOPS);
  if (!plane || plane.length < 3 || !loopsN) {
    s.warn('평면·고리가 없는 면을 건너뛰었습니다');
    return;
  }
  const loops: number[][] = [];
  const loopEdges: number[][] = [];
  const missing = { n: 0 };
  r.each(loopsN.start, loopsN.end, (lt, ls, le) => {
    if (lt !== TAG.LOOP) return;
    const uses = r.first({ tag: lt, start: ls, end: le }, TAG.LOOP_USES);
    if (!uses) return;
    const loop: number[] = [];
    const via: number[] = [];
    r.each(uses.start, uses.end, (ut, us, ue) => {
      if (ut !== TAG.EDGE_USE) return;
      const u = { tag: ut, start: us, end: ue };
      const ei = s.eIndex.get(r.uint(r.first(u, TAG.USE_EDGE)) ?? -1);
      if (ei === undefined) {
        missing.n++;
        return;
      }
      edgeIn(ei);
      loop.push(r.u8(r.first(u, TAG.USE_REVERSED)) ? edges.b[ei]! : edges.a[ei]!);
      via.push(ei);
    });
    if (loop.length >= 3) {
      loops.push(loop);
      loopEdges.push(via);
    }
  });
  if (missing.n > 0) s.warn('모서리를 찾지 못한 면 고리가 있습니다');
  if (loops.length === 0) return;
  const f: SkpFace = { loops, normal: [plane[0]!, plane[1]!, plane[2]!], flags: b.flags, loopEdges };
  if (b.material !== undefined) f.front = b.material;
  const back = r.uint(r.first(node, TAG.FACE_BACK));
  if (back !== undefined) f.back = back;
  if (b.layer !== undefined) f.layer = b.layer;
  if (b.id !== undefined) f.pid = b.id;
  const attrs = readHeaderAttrs(r, b.header, s.warn);
  if (attrs) f.attrs = attrs;
  const tf = f.front !== undefined && s.texturedIds.has(f.front);
  const tb = back !== undefined && s.texturedIds.has(back);
  if (tf || tb) {
    try {
      const maps = oldReadTextureMaps(r, node);
      if (tf && maps.front) f.frontMap = maps.front;
      if (tb && maps.back) f.backMap = maps.back;
    } catch {
      s.warn('깨진 무늬 투영을 건너뛰었습니다(기본 투영으로 칠합니다)');
    }
  }
  faceTable.push(f);
}

// ── 바이트 만들기 ──────────────────────────────────────────

/** 길이가 실제보다 긴 자식(그 자리에서 목록이 깨진다) */
const overflow = (tag: number, payload: Uint8Array, extra: number): Uint8Array => concat([u16(tag), u32(payload.length + extra), payload]);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8;
}

type R = () => number;
const pick = <T>(r: R, xs: readonly T[]): T => xs[r() % xs.length]!;
const maybe = (r: R, k: number): boolean => r() % k === 0;
/** 자리에서 섞기(엔진의 정렬 차례에 기대지 않게) */
function shuffle<T>(r: R, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = r() % (i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

/** 가끔 넘친 자식을 아무 자리에 끼운다 */
function withBreaks(r: R, kids: Uint8Array[], k: number, tags: readonly number[]): Uint8Array[] {
  if (maybe(r, k)) kids.splice(r() % (kids.length + 1), 0, overflow(pick(r, tags), u8(1), 1 + (r() % 40)));
  return kids;
}

/** 투영 한쪽(2713) 자식: 종류(i32·u8·빈 것), 행렬(9·8·10칸), 방향(2·3·4칸·모자란 바이트), 핀, 넘친 자식 */
function sideKids(r: R): Uint8Array[] {
  const kids: Uint8Array[] = [];
  const n = 1 + (r() % 6);
  for (let i = 0; i < n; i++) {
    switch (r() % 9) {
      case 0:
        kids.push(tlv(TAG.TEX_KIND, i32(r() % 4)));
        break;
      case 1:
        kids.push(tlv(TAG.TEX_KIND, u8(r() % 4)));
        break;
      case 2:
        kids.push(tlv(TAG.TEX_KIND));
        break;
      case 3:
      case 4:
        kids.push(tlv(TAG.TEX_MATRIX, f64(...Array.from({ length: pick(r, [9, 9, 8, 10]) }, () => (r() % 2001) / 100 - 10))));
        break;
      case 5:
        kids.push(tlv(TAG.TEX_DIR, f64(...Array.from({ length: pick(r, [3, 3, 2, 4]) }, () => (r() % 201) / 100 - 1))));
        break;
      case 6:
        kids.push(tlv(0x2717));
        break;
      case 7:
        if (maybe(r, 3)) kids.push(overflow(pick(r, [TAG.TEX_KIND, TAG.TEX_DIR, 0x2717]), u8(1), 1 + (r() % 30)));
        break;
      default:
        kids.push(tlv(TAG.TEX_DIR, new Uint8Array(r() % 30)));
    }
  }
  return kids;
}

/** 무늬 위치 항목(2710): 앞·뒤가 겹치거나 빠지고, 투영 쪽(2713)이 없거나 다른 자식 뒤에 오는 꼴 */
function mapping(r: R): Uint8Array {
  const sides: Uint8Array[] = [tlv(0x36b0)];
  const n = r() % 4;
  for (let i = 0; i < n; i++) {
    const tag = maybe(r, 5) ? 0x2719 : r() % 2 ? TAG.TEX_FRONT : TAG.TEX_BACK;
    const inner = maybe(r, 6) ? [tlv(0x2718, u8(1))] : [];
    if (!maybe(r, 8)) inner.push(tlv(TAG.TEX_SIDE, ...sideKids(r)));
    sides.push(tlv(tag, ...inner));
  }
  return tlv(TAG.TEX_MAP, ...sides);
}

/** 바탕(07d0): 머리(번호·속성 사전·무늬 위치), 재질, 태그, 깃발 — 빠지거나 겹치고 넘친 자식이 끼기도 한다 */
function baseBytes(r: R, mats: readonly number[], withMaps: boolean): Uint8Array {
  const kids: Uint8Array[] = [];
  if (!maybe(r, 10)) {
    const items: Uint8Array[] = [];
    if (withMaps) for (let i = r() % 3; i > 0; i--) items.push(maybe(r, 4) ? tlv(0x36b3, u8(0)) : mapping(r));
    const dicts: [string, [string, Uint8Array][]][] = maybe(r, 5) ? [['d', [['k', val.i32(r() % 9)]]]] : [];
    const head = [tlv(TAG.ID, uintLE(r() % 40))];
    if (dicts.length || items.length) head.push(tlv(TAG.ATTRS, dicts.length || !maybe(r, 3) ? attrList(dicts, items) : tlv(TAG.ATTR_LIST, tlv(TAG.ATTR_ITEMS, ...items))));
    kids.push(tlv(TAG.ID_BOX, ...head));
  }
  if (!maybe(r, 4)) kids.push(tlv(TAG.MATERIAL, uintLE(pick(r, mats))));
  if (maybe(r, 3)) kids.push(tlv(TAG.LAYER, uintLE(r() % 5)));
  if (!maybe(r, 6)) kids.push(tlv(TAG.FLAGS, u8(r() & 0x3f)));
  if (maybe(r, 12)) kids.push(tlv(TAG.MATERIAL, uintLE(7)));
  return tlv(TAG.BASE, ...withBreaks(r, shuffle(r, kids), 12, [TAG.FLAGS, TAG.MATERIAL, 0x07d9]));
}

/** 모서리(0bb8): 바탕·시작·끝·곡선(모르는 정점 번호, 9바이트 번호, 겹친 꼬리표, 빠진 꼬리표, 넘친 자식) */
function edgeBytes(r: R): Uint8Array {
  const kids: Uint8Array[] = [];
  if (!maybe(r, 12)) kids.push(baseBytes(r, [1, 2, 3], false));
  const vid = (): Uint8Array => (maybe(r, 15) ? new Uint8Array(9).fill(1) : uintLE(r() % 24));
  if (!maybe(r, 10)) kids.push(tlv(TAG.EDGE_START, vid()));
  if (!maybe(r, 10)) kids.push(tlv(TAG.EDGE_END, vid()));
  if (maybe(r, 3)) kids.push(tlv(TAG.EDGE_CURVE, uintLE(r() % 6)));
  if (maybe(r, 8)) kids.push(tlv(TAG.EDGE_START, vid()));
  if (maybe(r, 8)) kids.push(tlv(0x0bbc, u8(1)));
  if (maybe(r, 6)) shuffle(r, kids);
  return concat(withBreaks(r, kids, 6, [TAG.EDGE_CURVE, 0x0bbc, TAG.EDGE_END]));
}

/** 모서리 쓰임 목록(1195): 쓰임(0fa0)마다 모서리 번호(모르는 번호·표 밖 차례)·뒤집힘, 다른 꼬리표, 잘린 머리 */
function usesBytes(r: R): Uint8Array {
  const kids: Uint8Array[] = [];
  const n = maybe(r, 5) ? r() % 3 : 3 + (r() % 5);
  for (let i = 0; i < n; i++) {
    if (maybe(r, 15)) {
      kids.push(tlv(0x0fa3, u8(0)));
      continue;
    }
    const u: Uint8Array[] = [];
    // 번호 28·29는 표 밖 차례, 30~33은 모르는 번호
    if (!maybe(r, 12)) u.push(tlv(TAG.USE_EDGE, uintLE(maybe(r, 12) ? 28 + (r() % 6) : r() % 28)));
    if (!maybe(r, 5)) u.push(tlv(TAG.USE_REVERSED, u8(r() % 2)));
    if (maybe(r, 10)) u.push(tlv(TAG.USE_REVERSED));
    if (maybe(r, 6)) u.reverse();
    kids.push(tlv(TAG.EDGE_USE, ...withBreaks(r, u, 14, [TAG.USE_REVERSED, 0x0fa4])));
  }
  const body = concat(withBreaks(r, kids, 25, [TAG.EDGE_USE, 0x0fa3]));
  return maybe(r, 25) ? concat([body, new Uint8Array(1 + (r() % 5))]) : body;
}

/** 면(0dac): 바탕, 뒷면 재질, 평면(4칸·2칸), 고리 목록(고리마다 쓰임 목록) */
function faceBytes(r: R): Uint8Array {
  const kids: Uint8Array[] = [];
  if (!maybe(r, 15)) kids.push(baseBytes(r, [1, 2, 3, 4], true));
  if (maybe(r, 2)) kids.push(tlv(TAG.FACE_BACK, uintLE(pick(r, [1, 2, 3, 5]))));
  if (!maybe(r, 15)) kids.push(tlv(TAG.FACE_PLANE, f64(...Array.from({ length: pick(r, [4, 4, 4, 2, 3]) }, () => (r() % 200) / 100 - 1))));
  if (!maybe(r, 15)) {
    const loops: Uint8Array[] = [];
    for (let i = r() % 4; i > 0; i--) {
      if (maybe(r, 8)) loops.push(tlv(0x1196, u8(0)));
      else loops.push(tlv(TAG.LOOP, ...(maybe(r, 10) ? [tlv(0x1197)] : []), ...(maybe(r, 12) ? [] : [tlv(TAG.LOOP_USES, usesBytes(r))])));
    }
    const body = concat(withBreaks(r, loops, 30, [TAG.LOOP, 0x1196]));
    kids.push(tlv(TAG.FACE_LOOPS, maybe(r, 30) ? concat([body, new Uint8Array(1 + (r() % 5))]) : body));
  }
  if (maybe(r, 10)) kids.push(tlv(TAG.FACE_BACK, uintLE(2)));
  if (maybe(r, 8)) shuffle(r, kids);
  return concat(withBreaks(r, kids, 10, [TAG.FACE_BACK, 0x0db0, TAG.FACE_PLANE]));
}

// ── 견주기 ──────────────────────────────────────────────

function state(): ItemReadState & { warnings: string[] } {
  const warnings: string[] = [];
  const vIndex = new Map<number, number>();
  for (let i = 0; i < 20; i++) vIndex.set(i, i * 2);
  const eIndex = new Map<number, number>();
  // 모서리 번호 0~29 → 차례(28·29는 표 밖)
  for (let i = 0; i < 30; i++) eIndex.set(i, i < 28 ? (i * 7) % 28 : 40 + i);
  return { warnings, vIndex, eIndex, edgeTable: new EdgeTableBuilder(), edgeCurve: new Map(), warn: (m) => warnings.push(m), texturedIds: new Set([1, 2]) };
}

/** list()처럼 항목마다 던진 것을 잡아 경고로(글도 남겨 견준다) */
function run(fn: () => void, s: { warnings: string[] }, what: string): void {
  try {
    fn();
  } catch (e) {
    s.warnings.push(`깨진 ${what}: ${(e as Error).constructor.name} ${(e as Error).message}`);
  }
}

const plain = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>, (n) => (Number.isNaN(n) ? 'NaN' : n)) : v instanceof Map ? [...v] : v)));

describe('모서리·면·무늬 투영 읽기(34차)', () => {
  it('firstEach + firstFound는 꼬리표마다 first와 같은 값, 같은 글로 던진다', () => {
    const r = rng(7);
    for (let k = 0; k < 2000; k++) {
      const kids: Uint8Array[] = [];
      for (let i = r() % 7; i > 0; i--) kids.push(tlv(pick(r, [1, 2, 3, 4]), new Uint8Array(r() % 4)));
      withBreaks(r, kids, 4, [2, 5]);
      const bytes = concat([...kids, new Uint8Array(r() % 6)]);
      const rd = new TlvReader(bytes);
      const out: (TlvNode | undefined)[] = [];
      const tags = [3, 1, 4];
      const broken = rd.firstEach(0, bytes.length, tags, out);
      for (let i = 0; i < tags.length; i++) {
        const want = (() => {
          try {
            return rd.firstIn(0, bytes.length, tags[i]!);
          } catch (e) {
            return (e as Error).message;
          }
        })();
        const got = (() => {
          try {
            return firstFound(out[i], broken);
          } catch (e) {
            return (e as Error).message;
          }
        })();
        expect(got).toEqual(want);
      }
    }
  });

  it('무늬 투영: 겹친 앞·뒤·빠진 꼬리표·짧은 행렬·방향·넘친 자식이 섞여도 옛 식과 같다', () => {
    const r = rng(34);
    const snapshot = (fn: () => { front?: SkpTextureMap; back?: SkpTextureMap }): unknown => {
      try {
        const o = fn();
        const one = (m?: SkpTextureMap) => (m ? { kind: m.kind, matrix: Array.from(m.matrix), dir: m.dir ? [...m.dir] : undefined } : undefined);
        return { front: one(o.front), back: one(o.back) };
      } catch (e) {
        return `throw: ${(e as Error).message}`;
      }
    };
    let threw = 0;
    let both = 0;
    for (let k = 0; k < 4000; k++) {
      const bytes = concat([tlv(TAG.FACE, baseBytes(r, [1], true)), tlv(0x1234, u8(9))]);
      const reader = new TlvReader(bytes);
      const node: TlvNode = { tag: TAG.FACE, start: 6, end: bytes.length - 7 };
      const want = snapshot(() => oldReadTextureMaps(reader, node));
      const got = snapshot(() => readTextureMaps(reader, node));
      expect(got).toEqual(want);
      if (typeof want === 'string') threw++;
      else if ((want as { front?: unknown; back?: unknown }).front && (want as { back?: unknown }).back) both++;
    }
    expect(threw).toBeGreaterThan(50);
    expect(both).toBeGreaterThan(50);
  });

  it('모서리: 같은 표·번호표·곡선·경고, 던지는 항목과 그 앞에 적은 번호도 같다', () => {
    const r = rng(1388);
    let threw = 0;
    let added = 0;
    for (let round = 0; round < 300; round++) {
      const list = Array.from({ length: 1 + (r() % 12) }, () => edgeBytes(r));
      const bytes = concat(list.map((b) => tlv(TAG.EDGE, b)));
      const reader = new TlvReader(bytes);
      const a = state();
      const b = state();
      let p = 0;
      for (const item of list) {
        const s = p + 6;
        const e = s + item.length;
        run(() => oldReadEdge(reader, s, e, a), a, '모서리');
        run(() => readEdgeItem(reader, s, e, b), b, '모서리');
        p = e;
      }
      expect(plain(b.warnings)).toEqual(plain(a.warnings));
      expect(plain(b.eIndex)).toEqual(plain(a.eIndex));
      expect(plain(b.edgeCurve)).toEqual(plain(a.edgeCurve));
      const ta = a.edgeTable.done();
      const tb = b.edgeTable.done();
      expect(plain(tb)).toEqual(plain(ta));
      threw += a.warnings.filter((w) => w.startsWith('깨진')).length;
      added += ta.length;
    }
    expect(threw).toBeGreaterThan(100);
    expect(added).toBeGreaterThan(500);
  });

  it('면: 같은 표(고리·모서리·무늬 투영 표·속성)·같은 경고, 던지는 항목도 같다', () => {
    const r = rng(3500);
    const edges = edgesFrom(Array.from({ length: 28 }, (_, i) => ({ a: i % 20, b: (i * 3 + 1) % 20, flags: 0 })));
    let threw = 0;
    let faces = 0;
    let mapped = 0;
    for (let round = 0; round < 700; round++) {
      const list = Array.from({ length: 1 + (r() % 8) }, () => faceBytes(r));
      const bytes = concat(list.map((b) => tlv(TAG.FACE, b)));
      const reader = new TlvReader(bytes);
      const a = state();
      const b = state();
      const fa = new FaceTableBuilder();
      const fb = new FaceTableBuilder();
      let p = 0;
      for (const item of list) {
        const s = p + 6;
        const e = s + item.length;
        run(() => oldReadFace(reader, s, e, a, edges, fa), a, '면');
        run(() => readFaceItem(reader, s, e, b, edges, fb), b, '면');
        p = e;
      }
      expect(plain(b.warnings)).toEqual(plain(a.warnings));
      const ta = fa.done();
      const tb = fb.done();
      expect(plain(tb)).toEqual(plain(ta));
      threw += a.warnings.filter((w) => w.startsWith('깨진')).length;
      faces += ta.length;
      mapped += (ta.frontMaps?.data.length ?? 0) + (ta.backMaps?.data.length ?? 0);
    }
    expect(threw).toBeGreaterThan(100);
    expect(faces).toBeGreaterThan(300);
    expect(mapped).toBeGreaterThan(100);
  });
});
