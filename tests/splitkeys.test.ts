/**
 * 나눌 단계를 정할 때 정의를 통째로 삼각화하지 않고 묶음 열쇠만 세기(33차 — src/scene.ts prepareKeys):
 * - prepareKeys는 prepare 뒤 preparedKeys와 같은 열쇠·수를 낸다(재질·뒷면·태그 묶음 차례, 삼각화하지 못한 면, 숨긴 면·모서리, 부드러운 모서리, extras 켬·끔).
 * - 들고 있을 한도 0(모두 열쇠만)과 기본 한도로 만든 장면·경고·나무 정보가 같다 — 열쇠만 센 정의가 끝내 옮겨지지 않아도(너무 깊은 배치) 경고 수가 같다.
 * - preparedBound는 실제 Prepared 바이트보다 작지 않다.
 */
import { describe, expect, it } from 'vitest';
import { readModelDat } from '../src/model';
import { buildSceneParts, prepare, prepareKeys, preparedBound, preparedKeys } from '../src/scene';
import { IDENTITY13, edge, entities, face, instance, modelDat, vertex } from './build';

const HIDDEN = 0x07;
const SOFT = 0x0e;
const SMOOTH = 0x16;

interface QuadOpts {
  material?: number;
  back?: number;
  layer?: number;
  flags?: number;
  edgeFlags?: number;
  edgeLayer?: number;
  /** 네 점을 한 줄에(삼각화하지 못하는 면) */
  flat?: boolean;
}

/** 정점 4·모서리 4·면 1(정점 id+0..3, 모서리 id+4..7, 면 id+8) */
function quad(id: number, x: number, o: QuadOpts = {}): { vertices: Uint8Array[]; edges: Uint8Array[]; faces: Uint8Array[] } {
  const P: [number, number, number][] = o.flat
    ? [
        [x, 0, 0],
        [x + 1, 0, 0],
        [x + 2, 0, 0],
        [x + 3, 0, 0],
      ]
    : [
        [x, 0, 0],
        [x + 10, 0, 0],
        [x + 10, 10, 0],
        [x, 10, 0],
      ];
  const eo = { ...(o.edgeFlags !== undefined ? { flags: o.edgeFlags } : {}), ...(o.edgeLayer !== undefined ? { layer: o.edgeLayer } : {}) };
  const fo = { ...(o.material !== undefined ? { material: o.material } : {}), ...(o.back !== undefined ? { back: o.back } : {}), ...(o.layer !== undefined ? { layer: o.layer } : {}), ...(o.flags !== undefined ? { flags: o.flags } : {}) };
  return {
    vertices: P.map((p, i) => vertex(id + i, ...p)),
    edges: [0, 1, 2, 3].map((i) => edge(id + 4 + i, id + i, id + ((i + 1) % 4), eo)),
    faces: [face(id + 8, [0, 0, 1, 0], [[0, 1, 2, 3].map((i) => [id + 4 + i, false] as [number, boolean])], fo)],
  };
}

function merge(parts: ReturnType<typeof quad>[]): { vertices: Uint8Array[]; edges: Uint8Array[]; faces: Uint8Array[] } {
  return { vertices: parts.flatMap((p) => p.vertices), edges: parts.flatMap((p) => p.edges), faces: parts.flatMap((p) => p.faces) };
}

/** 섞인 정의: 같은 재질·태그에 뒷면만 다른 묶음, 삼각화하지 못하는 면만 든 묶음, 숨긴 면, 부드러운·매끈한·숨긴 모서리, 여러 태그 */
const mixed = (): ReturnType<typeof merge> =>
  merge([
    quad(100, 0, { material: 5, layer: 1 }),
    quad(110, 20, { material: 5, back: 7, layer: 1 }),
    quad(120, 40, { material: 6, layer: 2, edgeFlags: SOFT, edgeLayer: 2 }),
    quad(130, 60, { material: 8, layer: 1, flat: true }),
    quad(140, 80, { material: 5, layer: 1, flat: true }),
    quad(150, 100, { flags: HIDDEN, material: 9, edgeFlags: HIDDEN }),
    quad(160, 120, { flags: HIDDEN, flat: true, edgeFlags: SMOOTH, edgeLayer: 3 }),
    quad(170, 140, { layer: 4 }),
  ]);

function model(chain = 0): Uint8Array {
  const defs: { name: string; entities: Uint8Array }[] = [{ name: '섞인', entities: entities(50, mixed()) }, { name: '닫힌 판', entities: entities(60, quad(200, 0)) }];
  // 너무 깊은 사슬(MAX_DEPTH 64를 넘는다): 맨 끝 정의는 삼각화하지 못하는 면을 든다
  for (let i = 0; i < chain; i++) {
    const id = 1000 + i;
    const body = i === chain - 1 ? merge([quad(5000, 0, { flat: true, material: 5 })]) : { components: [instance(3000 + i, id + 1, IDENTITY13)] };
    defs.push({ name: `사슬 ${i}`, entities: entities(id, body) });
  }
  const at = (x: number): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, 0, 0, 1];
  const comps = [instance(10, 50, at(0)), instance(11, 50, at(300)), instance(12, 60, at(600))];
  if (chain) comps.push(instance(13, 1000, at(900)));
  return modelDat({ definitions: defs, root: entities(undefined, { ...merge([quad(1, -50, { material: 5 })]), components: comps }) });
}

const plain = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));

describe('묶음 열쇠만 세기(33차)', () => {
  it('prepareKeys는 prepare 뒤 preparedKeys와 같다(extras 켬·끔, 기본 태그)', () => {
    const m = readModelDat(model());
    const ents = m.definitions.get(50)!.entities;
    for (const extras of [false, true])
      for (const defaultLayer of [undefined, 1, 4]) {
        const p = prepare(ents, defaultLayer, { failed: 0 }, extras, true, undefined, null, false);
        const want = preparedKeys(p);
        expect(prepareKeys(ents, defaultLayer, extras), `${extras} ${defaultLayer}`).toEqual(want);
        expect(want.keys.length).toBeGreaterThan(3);
      }
    // 닫힌 판(c 붙음)
    const closed = m.definitions.get(60)!.entities;
    const k = prepareKeys(closed, undefined, true);
    expect(k).toEqual(preparedKeys(prepare(closed, undefined, { failed: 0 }, true, true, undefined, null, false)));
  });

  it('위 한도는 실제 삼각화 바이트보다 작지 않다', () => {
    const m = readModelDat(model());
    for (const id of [50, 60]) {
      const ents = m.definitions.get(id)!.entities;
      const p = prepare(ents, undefined, { failed: 0 }, true, true, undefined, null, true);
      let bytes = 0;
      for (const b of [...p.batches, ...p.hiddenBatches]) bytes += b.pos.byteLength + b.idx.byteLength + b.fa.byteLength + b.fn.byteLength + b.ft.byteLength + (b.nrm?.byteLength ?? 0) + (b.uv?.byteLength ?? 0) + (b.buv?.byteLength ?? 0) + (b.plane?.byteLength ?? 0);
      for (const l of [...p.lines, ...p.extraLines]) bytes += l.pos.byteLength + (l.curve?.byteLength ?? 0) + (l.mat?.byteLength ?? 0);
      expect(preparedBound(ents)).toBeGreaterThanOrEqual(bytes);
    }
  });

  it('들고 있을 한도 0(모두 열쇠만)과 기본 한도의 장면·경고·나무 정보가 같다 — 너무 깊어 옮기지 않은 정의의 경고 수도', () => {
    for (const chain of [0, 70])
      for (const extras of [false, true])
        for (const releaseModel of [false, true]) {
          const opts = { outline: true, extras, smooth: true, releaseModel };
          const base = buildSceneParts(readModelDat(model(chain)), new Map(), 1, opts);
          const keysOnly = buildSceneParts(readModelDat(model(chain)), new Map(), 1, { ...opts, splitPrepBudget: 0 });
          expect(plain(keysOnly), `${chain} ${extras} ${releaseModel}`).toBe(plain(base));
          expect(base.warnings.some((w) => w.includes('삼각형으로 나누지 못한 면'))).toBe(true);
          if (chain) expect(base.warnings.some((w) => w.includes('너무 깊은'))).toBe(true);
        }
  });
});
