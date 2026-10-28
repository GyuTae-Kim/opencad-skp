/**
 * model.dat 풀면서 읽기(src/modelstream.ts)와 skpToSceneAsync: 조각을 어떻게 나눠 받든 한 버퍼 읽기(readModelDat)와 같은 모형,
 * 같은 장면을 내야 한다. 조각 경계에 걸친 꼬리표, 짧은·잘린·깨진 model.dat, 재질·글꼴 절이 정의 절보다 뒤에 오는 꼴.
 */
import { describe, expect, it } from 'vitest';
import { readModelDat, TAG } from '../src/model';
import { ModelDatStream, StreamFallback, streamModelDat } from '../src/modelstream';
import { readSkpHeader, skpToScene, skpToSceneAsync, type SkpModelRead } from '../src/index';
import { findSkpZipItems, zipItemData } from '../src/zip';
import { sceneDigest } from '../scripts/sweep/probe';
import {
  concat,
  curves,
  dimPoint,
  edge,
  entities,
  face,
  IDENTITY13,
  instance,
  linearDims,
  modelDat,
  nodeDeflate,
  radialDims,
  skpFile,
  texts,
  tlv,
  u32,
  vertex,
} from './build';
import { mfcFile, squareEntities } from './mfcwrite';

/** 정사각형 판 하나(정점 id0..id0+3, 모서리 id0+10.., 면 id0+20) */
function plate(id0: number, x: number, o: { material?: number } = {}): { vertices: Uint8Array[]; edges: Uint8Array[]; faces: Uint8Array[] } {
  const v = [0, 1, 2, 3].map((k) => id0 + k);
  const e = [0, 1, 2, 3].map((k) => id0 + 10 + k);
  return {
    vertices: [vertex(v[0]!, x, 0, 0), vertex(v[1]!, x + 10, 0, 0), vertex(v[2]!, x + 10, 10, 0), vertex(v[3]!, x, 10, 0)],
    edges: [edge(e[0]!, v[0]!, v[1]!), edge(e[1]!, v[1]!, v[2]!), edge(e[2]!, v[2]!, v[3]!), edge(e[3]!, v[3]!, v[0]!)],
    faces: [face(id0 + 20, [0, 0, 1, 0], [e.map((x) => [x, false] as [number, boolean])], o.material !== undefined ? { material: o.material } : {})],
  };
}

/** 호 하나(정점 base.., 모서리 base+100.., 곡선 curveId) */
function arc(base: number, curveId: number): { vertices: Uint8Array[]; edges: Uint8Array[]; extra: Uint8Array[] } {
  const n = 8;
  const vertices = Array.from({ length: n }, (_, i) => vertex(base + i, 2 * Math.cos((2 * Math.PI * i) / n), 2 * Math.sin((2 * Math.PI * i) / n), 0));
  const edges = Array.from({ length: n }, (_, i) => edge(base + 100 + i, base + i, base + ((i + 1) % n), { flags: 0x0e, curve: curveId }));
  const extra = curves([{ id: curveId, first: base + 100, last: base + 100 + n - 1, arc: [0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 2, 0, 2, 0, 2 * Math.PI] }]);
  return { vertices, edges, extra };
}

/**
 * 정의 여럿·인스턴스 경로·다른 묶음의 정점에 붙은 치수 점·다른 묶음의 호를 재는 반지름 치수·글꼴을 쓰는 문자·무늬 재질·장면이 든 model.dat
 */
function richModel(opts: { fonts?: boolean; defs?: number } = {}): Uint8Array {
  const defs = [];
  const inner = plate(1, 0, { material: 2 });
  defs.push({ name: 'inner', entities: entities(50, inner) });
  defs.push({ name: 'mid', entities: entities(60, { components: [instance(61, 50, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 5, 1])] }) });
  const a = arc(1000, 72);
  defs.push({ name: '원', entities: entities(70, { vertices: a.vertices, edges: a.edges, extra: a.extra }) });
  for (let k = 0; k < (opts.defs ?? 6); k++) defs.push({ name: `판 ${k}`, entities: entities(100 + k, plate(5000 + 100 * k, 20 * k)) });
  const root = entities(undefined, {
    ...plate(10, -30),
    components: [
      instance(62, 60, [1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 0, 0, 1]),
      instance(63, 70, IDENTITY13),
      ...defs.slice(3).map((_, k) => instance(200 + k, 100 + k, IDENTITY13)),
    ],
    extra: [
      linearDims([
        // 정의 50의 정점 1·모서리 13(경로 62 → 61), 같은 묶음 정점 10, 찾지 못한 대상
        { id: 80, start: dimPoint(2, [0, 0, 0], 1, [62, 61]), end: dimPoint(4, [9, 9, 9], 13, [62, 61]) },
        { id: 81, start: dimPoint(2, [0, 0, 0], 10), end: dimPoint(2, [4, 4, 4], 999, [62]) },
      ]),
      radialDims([{ id: 82, edge: 1101 }]),
      texts([{ id: 83, text: '글', point: dimPoint(1, [1, 1, 0]), leader: [1, 1, 1], leaderType: 2, font: 7 }]),
    ],
  });
  return modelDat({
    materials: [
      [2, '무늬A'],
      [3, '색'],
    ],
    layers: [
      [1, 'Layer0'],
      [4, '벽'],
    ],
    ...(opts.fonts === false ? {} : { fonts: [{ id: 7, face: 'Arial' }] }),
    camera: { eye: [10, 10, 10], target: [0, 0, 0], up: [0, 0, 1] },
    pages: { list: [{ id: 300, name: '장면 1', flags: 0x80, hidden: [62] }], active: 0 },
    definitions: defs,
    root,
  });
}

/** 뿌리 절을 꼬리표 차례대로 다시 엮는다(앞에 둘 꼬리표 → 나머지는 원래 차례) */
function reorder(dat: Uint8Array, first: number[]): Uint8Array {
  const dv = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
  const parts: { tag: number; bytes: Uint8Array }[] = [];
  for (let p = 6; p < dat.length; ) {
    const len = dv.getUint32(p + 2, true);
    parts.push({ tag: dv.getUint16(p, true), bytes: dat.subarray(p, p + 6 + len) });
    p += 6 + len;
  }
  const head = parts.filter((x) => first.includes(x.tag)).sort((a, b) => first.indexOf(a.tag) - first.indexOf(b.tag));
  const rest = parts.filter((x) => !first.includes(x.tag));
  const body = concat([...head, ...rest].map((x) => x.bytes));
  return concat([dat.subarray(0, 2), u32(body.length), body]);
}

/** model.dat를 size바이트씩 나눠 받은 모형 */
function streamed(dat: Uint8Array, size: number, textured?: string[]): { model: ReturnType<typeof readModelDat>; defs: boolean } {
  const s = new ModelDatStream(dat.length, textured ? { textured } : {});
  for (let o = 0; o < dat.length; o += size) s.push(dat.slice(o, o + size));
  return { model: s.end(), defs: s.streamedDefinitions };
}

describe('ModelDatStream: 조각으로 받아도 한 버퍼 읽기와 같은 모형', () => {
  const dat = richModel();
  const whole = readModelDat(dat, undefined, { textured: ['무늬A'] });

  it('조각 크기와 관계없이(꼬리표 머리·정의가 조각 경계에 걸쳐도) 같다', () => {
    // 같은 모형인지 먼저 본다: 다른 묶음에 붙은 치수 점·반지름 치수·문자 글꼴을 풀었다
    expect(whole.root.dimensions!.map((d) => d.start)).toEqual([[100, 0, 5], [-30, 0, 0], undefined]);
    expect(whole.root.dimensions![2]).toMatchObject({ kind: 'radial', center: [0, 0, 0] });
    expect(whole.root.texts![0]!.font).toBe(7);
    expect(whole.definitions.size).toBe(9);
    for (const size of [1, 5, 6, 7, 64, 1000, dat.length]) {
      const r = streamed(dat, size, ['무늬A']);
      expect(r.defs).toBe(true);
      expect(r.model).toEqual(whole);
    }
  });

  it('재질·글꼴 절이 정의 절보다 뒤에 오거나 글꼴 절이 없으면 정의 절을 통째로 들고 읽는다(같은 모형)', () => {
    const late = reorder(dat, [TAG.DEFINITIONS]);
    const r = streamed(late, 7, ['무늬A']);
    expect(r.defs).toBe(false);
    expect(r.model).toEqual(readModelDat(late, undefined, { textured: ['무늬A'] }));
    // 모형 요소 절이 정의 절보다 앞에 와도 정의를 먼저 읽는다(한 버퍼 읽기와 같은 차례)
    const rootFirst = reorder(dat, [TAG.MODEL_ENTITIES]);
    const r2 = streamed(rootFirst, 11);
    expect(r2.defs).toBe(true);
    expect(r2.model).toEqual(readModelDat(rootFirst));
    const noFonts = richModel({ fonts: false });
    const r3 = streamed(noFonts, 64);
    expect(r3.defs).toBe(false);
    expect(r3.model).toEqual(readModelDat(noFonts));
  });

  it('짧은·잘린·깨진 뿌리와 정의 목록은 StreamFallback(한 버퍼로 다시 읽는다)', () => {
    expect(() => new ModelDatStream(3)).toThrow(StreamFallback);
    // 뿌리 꼬리표가 다름
    const bad = dat.slice();
    bad[0] = 0;
    expect(() => streamed(bad, 64)).toThrow(StreamFallback);
    // 뿌리 길이가 전체보다 김(잘린 model.dat)
    expect(() => streamed(dat.subarray(0, dat.length - 10), 64)).toThrow(StreamFallback);
    // 받은 길이가 목록의 크기와 다름
    const s = new ModelDatStream(dat.length + 4);
    s.push(dat);
    expect(() => s.end()).toThrow(StreamFallback);
    expect(() => new ModelDatStream(dat.length - 1).push(dat)).toThrow(StreamFallback);
    // 정의 목록 안 정의 길이가 넘침
    const broken = breakFirstDefinition(dat);
    expect(() => streamed(broken, 64)).toThrow(StreamFallback);
    // 한 버퍼 읽기는 그 정의를 잘린 것으로 살린다(그래서 조각 읽기는 그 길로 넘긴다)
    expect(readModelDat(broken).damaged).toBe(true);
  });
});

describe('붙은 치수 점의 정점 찾기(읽을 때 적은 기록)', () => {
  it('목록 틀이 깨져 건너뛴 정의의 정점도 찾는다(예전 두 번째 훑기와 같게), 조각으로 읽어도 같다', () => {
    // 정의 50: 정점·모서리는 멀쩡하고 면 목록 길이가 묶음 끝을 넘는다 → 정의는 건너뛰지만 정점은 찾기에 든다
    const def = entities(50, plate(1, 0));
    const broken = def.slice();
    const dv = new DataView(broken.buffer);
    let at = -1;
    for (let p = 0; p + 6 < broken.length; p++) if (dv.getUint16(p, true) === TAG.FACES && dv.getUint16(p + 6, true) === TAG.FACE) at = p;
    expect(at).toBeGreaterThan(0);
    dv.setUint32(at + 2, dv.getUint32(at + 2, true) + 50, true);
    const root = entities(undefined, {
      components: [instance(62, 50, [1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 0, 0, 1])],
      extra: [linearDims([{ id: 80, start: dimPoint(2, [0, 0, 0], 3, [62]), end: dimPoint(2, [1, 1, 1], 4, [62]) }])],
    });
    const dat = modelDat({ fonts: [{ id: 7, face: 'Arial' }], definitions: [{ name: '깨진 판', entities: broken }], root });
    const m = readModelDat(dat);
    expect(m.definitions.has(50)).toBe(false);
    expect(m.warnings.some((w) => w.includes('깨진 컴포넌트 정의'))).toBe(true);
    expect(m.root.dimensions![0]).toMatchObject({ start: [110, 10, 0], end: [100, 10, 0] });
    expect(streamed(dat, 3).model).toEqual(m);
  });
});

/** 첫 정의(0x157c)의 길이를 목록 끝 너머로 늘린 model.dat */
function breakFirstDefinition(dat: Uint8Array): Uint8Array {
  const out = dat.slice();
  const dv = new DataView(out.buffer);
  for (let p = 6; p + 6 < out.length; p++)
    if (dv.getUint16(p, true) === TAG.DEFINITION && dv.getUint16(p + 6, true) === TAG.ENTITIES) {
      dv.setUint32(p + 2, dv.getUint32(p + 2, true) + 1_000_000, true);
      return out;
    }
  throw new Error('정의를 찾지 못했다');
}

const MATERIAL_XML = '<material name="무늬A" type="1"><color r="200" g="100" b="50"/></material>';

/** 2021+ 파일: richModel을 담는다 */
function richSkp(dat = richModel()): Uint8Array {
  return skpFile(dat, { materials: [['무늬A', MATERIAL_XML]] });
}

const modelItemOf = (bytes: Uint8Array) => findSkpZipItems(bytes, readSkpHeader(bytes)!.bodyOffset).items!.find((d) => d.name === 'model.dat')!;

/** 같은 선택으로 skpToScene(통째로)과 skpToSceneAsync(풀면서) → 장면 해시·경고가 같은지, 어떻게 읽었는지 */
async function both(bytes: Uint8Array, streamMin = 1): Promise<{ how: SkpModelRead | undefined; same: boolean; warnings: string[] }> {
  const o = { outline: true, extras: true, smooth: true } as const;
  const a = skpToScene(bytes.slice(), o);
  let how: SkpModelRead | undefined;
  const b = await skpToSceneAsync(bytes.slice(), { ...o, streamMin, onModelRead: (h) => (how = h) });
  return { how, same: sceneDigest(a) === sceneDigest(b) && JSON.stringify(a.warnings) === JSON.stringify(b.warnings), warnings: b.warnings ?? [] };
}

describe('skpToSceneAsync: 풀면서 읽어도 skpToScene과 같은 장면', () => {
  it('2021+ 파일: 정의를 하나씩 읽고 같은 장면, 문턱 아래는 통째로', async () => {
    const bytes = richSkp();
    expect(await both(bytes)).toMatchObject({ how: 'stream', same: true });
    expect(await both(bytes, 1 << 20)).toMatchObject({ how: 'whole', same: true });
    // 정의 절이 재질·글꼴 절보다 앞
    expect(await both(richSkp(reorder(richModel(), [TAG.DEFINITIONS])))).toMatchObject({ how: 'held', same: true });
  });

  it('releaseBytes: model.dat를 다 읽은 뒤 파일 버퍼를 떼어 놓는다', async () => {
    const bytes = richSkp();
    const keep = skpToScene(bytes);
    const copy = bytes.slice();
    const scene = await skpToSceneAsync(copy, { releaseBytes: true, streamMin: 1 });
    expect(copy.length).toBe(0);
    expect(sceneDigest(scene)).toBe(sceneDigest(keep));
  });

  it('깨진 정의 목록(꼬리표 길이)은 통째로 풀어 읽는다 — 잘린 정의를 살리는 같은 결과', async () => {
    const r = await both(richSkp(breakFirstDefinition(richModel())));
    expect(r).toMatchObject({ how: 'shape', same: true });
    expect(r.warnings.length).toBeGreaterThan(0);
    // 너무 짧은 model.dat·뿌리 꼬리표가 다른 model.dat
    expect(await both(skpFile(new Uint8Array([0xf4, 0x01, 0])))).toMatchObject({ how: 'shape', same: true });
    const odd = richModel();
    odd[0] = 0x63;
    expect(await both(richSkp(odd))).toMatchObject({ how: 'shape', same: true });
  });

  it('압축이 깨진 model.dat는 예전처럼 직접 풀어 앞부분을 살린다', async () => {
    const bytes = richSkp(richModel({ defs: 40 }));
    const item = modelItemOf(bytes);
    const data = zipItemData(bytes, item);
    // 압축 흐름 가운데를 망가뜨린다
    const at = data.byteOffset + Math.floor(data.length / 2);
    for (let k = 0; k < 16; k++) bytes[at + k] = 0xff;
    const r = await both(bytes);
    expect(r.same).toBe(true);
    expect(['inflate', 'shape']).toContain(r.how);
  });

  it('2020 이하·SketchUp 아님·잘린 꾸러미', async () => {
    expect(await both(mfcFile({ schemas: 'v17', root: squareEntities() }))).toMatchObject({ how: undefined, same: true });
    expect(await both(new Uint8Array([1, 2, 3]))).toMatchObject({ how: undefined, same: true });
    const bytes = richSkp();
    expect(await both(bytes.subarray(0, bytes.length - 40))).toMatchObject({ how: 'whole', same: true });
  });
});

describe('streamModelDat', () => {
  it('내장 풀기 조각을 받는 대로 읽어 같은 모형, 길이가 다르면 inflate', async () => {
    const dat = richModel({ defs: 30 });
    const packed = nodeDeflate(dat);
    const r = await streamModelDat(packed, dat.length);
    expect(typeof r).toBe('object');
    if (typeof r === 'object') {
      expect(r.held).toBe(false);
      expect(r.model).toEqual(readModelDat(dat));
    }
    // 목록의 크기가 짧으면 뿌리 길이가 넘쳐 shape, 길면 다 풀어도 모자라 inflate — 어느 쪽이든 예전 길로 다시 읽는다
    expect(await streamModelDat(packed, dat.length - 1)).toBe('shape');
    expect(await streamModelDat(packed, dat.length + 1)).toBe('inflate');
    expect(await streamModelDat(new Uint8Array([0xff, 0xff, 0xff]), 10)).toBe('inflate');
    // 압축 조각(64 KiB)보다 큰 model.dat도 — 풀린 조각이 쌓이지 않게 조금씩 넣는다
    const big = richModel({ defs: 3000 });
    const bigPacked = nodeDeflate(concat([big]));
    expect(bigPacked.length).toBeGreaterThan(1 << 16);
    const rb = await streamModelDat(bigPacked, big.length);
    expect(typeof rb === 'object' && rb.model.definitions.size).toBe(3003);
  });

  it('root 꼬리표·짧은 model.dat는 shape', async () => {
    expect(await streamModelDat(nodeDeflate(new Uint8Array([1, 2, 3])), 3)).toBe('shape');
    expect(await streamModelDat(nodeDeflate(tlv(0x0063, new Uint8Array(10))), 16)).toBe('shape');
  });
});
