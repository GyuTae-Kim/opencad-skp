/**
 * 내장 풀기(DecompressionStream 'deflate-raw')로 통째로 풀기(src/modelstream.ts inflateNative)와
 * 해석기의 inflated 선택: 미리 푼 바이트를 쓰든 직접 풀든 장면이 같아야 한다. 풀면서 읽기는 tests/modelstream.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { inflateNative } from '../src/modelstream';
import { readSkpHeader, skpToScene } from '../src/index';
import { findSkpZipItems, readZipItem, zipItemData } from '../src/zip';
import { edge, entities, face, modelDat, skpFile, vertex } from './build';
import { mfcFile, squareEntities } from './mfcwrite';

/** 정점·모서리·면 n×n 격자(model.dat가 몇백 KB가 되게) */
function gridModel(n: number): Uint8Array {
  const vertices: Uint8Array[] = [];
  const edges: Uint8Array[] = [];
  const faces: Uint8Array[] = [];
  const id = (i: number, j: number): number => 1 + i * (n + 1) + j;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) vertices.push(vertex(id(i, j), i * 10, j * 10, 0));
  let e = 100000;
  let f = 500000;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      const ids = [e++, e++, e++, e++];
      edges.push(edge(ids[0]!, a, b), edge(ids[1]!, b, c), edge(ids[2]!, c, d), edge(ids[3]!, d, a));
      faces.push(face(f++, [0, 0, 1, 0], [ids.map((x) => [x, false] as [number, boolean])]));
    }
  return skpFile(modelDat({ root: entities(undefined, { vertices, edges, faces }) }));
}

const modelItem = (bytes: Uint8Array) => findSkpZipItems(bytes, readSkpHeader(bytes)!.bodyOffset).items!.find((d) => d.name === 'model.dat')!;

describe('내장 풀기와 미리 푼 model.dat', () => {
  it('inflateNative: 원래 크기와 정확히 같을 때만 돌려준다', async () => {
    const raw = new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff);
    const packed = new Uint8Array(deflateRawSync(raw));
    expect(await inflateNative(packed, raw.length)).toEqual(raw);
    expect(await inflateNative(packed, raw.length - 1)).toBeNull();
    expect(await inflateNative(packed, raw.length + 1)).toBeNull();
    expect(await inflateNative(new Uint8Array([0xff, 0xff, 0xff]), 10)).toBeNull();
    expect(await inflateNative(packed, 0)).toBeNull();
  });

  it('inflateNative: 압축된 model.dat를 직접 푼 것과 같은 바이트', async () => {
    const bytes = gridModel(40);
    const item = modelItem(bytes);
    expect(item.method).toBe(8);
    expect(await inflateNative(zipItemData(bytes, item), item.size)).toEqual(readZipItem(bytes, item));
  });

  it('skpToScene: 미리 푼 model.dat를 쓰든 직접 풀든 같은 장면, 길이가 다르면 직접 푼다', async () => {
    const bytes = gridModel(20);
    const pre = new Map([['model.dat', readZipItem(bytes, modelItem(bytes))]]);
    const a = skpToScene(bytes, { outline: true });
    const b = skpToScene(bytes, { outline: true, inflated: pre });
    // 해석기는 꺼내 쓴 항목을 Map에서 지운다(장면을 만드는 동안 풀린 바이트를 붙들지 않게)
    expect(pre.has('model.dat')).toBe(false);
    expect(b.meshes.map((m) => [...m.positions].length)).toEqual(a.meshes.map((m) => [...m.positions].length));
    expect(b.meta?.faces).toBe(400);
    expect(b.meta?.faces).toBe(a.meta?.faces);
    expect(b.lines.map((l) => l.positions.length)).toEqual(a.lines.map((l) => l.positions.length));
    // 길이가 맞지 않는 바이트(잘못 넘김)는 쓰지 않는다
    const bad = new Map([['model.dat', new Uint8Array(10)]]);
    const wrong = skpToScene(bytes, { inflated: bad });
    expect(bad.size).toBe(0);
    expect(wrong.meta?.faces).toBe(400);
    expect(wrong.warnings ?? []).toEqual(a.warnings ?? []);
  });

  it('releaseBytes: 파일 바이트를 다 쓰면 버퍼를 떼어 놓고, 장면은 그대로', async () => {
    const bytes = gridModel(20);
    const keep = skpToScene(bytes, { outline: true });
    const copy = bytes.slice();
    const pre = new Map([['model.dat', readZipItem(copy, modelItem(copy))]]);
    const freed = skpToScene(copy, { outline: true, inflated: pre, releaseBytes: true });
    expect(copy.length).toBe(0);
    expect(copy.buffer.byteLength).toBe(0);
    expect(freed.meshes.map((m) => [...m.positions])).toEqual(keep.meshes.map((m) => [...m.positions]));
    expect(freed.meta?.faces).toBe(400);
    // 미리 풀지 않아도(해석기가 직접 푼 뒤), 2020 이하도
    const direct = bytes.slice();
    expect(skpToScene(direct, { releaseBytes: true }).meta?.faces).toBe(400);
    expect(direct.length).toBe(0);
    const mfc = mfcFile({ schemas: 'v17', root: squareEntities() });
    const mfcKeep = skpToScene(mfc);
    const mfcCopy = mfc.slice();
    const mfcFreed = skpToScene(mfcCopy, { releaseBytes: true });
    expect(mfcCopy.length).toBe(0);
    expect(mfcFreed.meshes.map((m) => [...m.positions])).toEqual(mfcKeep.meshes.map((m) => [...m.positions]));
    // 버퍼 일부만 보는 바이트는 떼어 놓지 않는다
    const big = new Uint8Array(bytes.length + 8);
    big.set(bytes, 8);
    const part = big.subarray(8);
    expect(skpToScene(part, { releaseBytes: true }).meta?.faces).toBe(400);
    expect(part.length).toBe(bytes.length);
  });
});
