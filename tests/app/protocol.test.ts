import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { collectTransfers, errorText, sceneHasGeometry } from '../../src/app/protocol';

const scene = (o: Partial<Scene3d> = {}): Scene3d => ({ name: 's', units: 'mm', meshes: [], lines: [], ...o });

describe('collectTransfers', () => {
  it('형식 배열의 버퍼를 버퍼마다 한 번만 모은다', () => {
    const shared = new Float32Array(12);
    const idx = new Uint32Array([0, 1, 2]);
    const s = scene({
      meshes: [
        { id: 'a', positions: shared, indices: idx, color: [1, 1, 1, 1] },
        { id: 'b', positions: shared, color: [1, 1, 1, 1] },
      ],
      lines: [{ id: 'l', positions: new Float32Array(6) }],
      meta: { nested: { list: [new Uint8Array(4)], map: new Map([['k', new Float64Array(2)]]), set: new Set([new Int32Array(1)]) } },
    });
    const t = collectTransfers({ scene: s, ms: 1 });
    expect(t.length).toBe(6);
    expect(new Set(t).size).toBe(t.length);
    expect(t).toContain(shared.buffer);
    expect(t).toContain(idx.buffer);
  });

  it('빈 버퍼·원시 값·순환 참조를 견딘다', () => {
    const o: Record<string, unknown> = { n: 1, s: 'x', empty: new Uint8Array(0), raw: new ArrayBuffer(8) };
    o.self = o;
    const t = collectTransfers(o);
    expect(t.length).toBe(1);
    expect((t[0] as ArrayBuffer).byteLength).toBe(8);
    expect(collectTransfers(null)).toEqual([]);
    expect(collectTransfers(42)).toEqual([]);
  });

  it('같은 버퍼의 여러 보기(subarray)도 한 번', () => {
    const big = new Float32Array(30);
    expect(collectTransfers([big.subarray(0, 6), big.subarray(6, 12)]).length).toBe(1);
  });
});

describe('sceneHasGeometry · errorText', () => {
  it('그릴 것이 있는지', () => {
    expect(sceneHasGeometry(scene())).toBe(false);
    expect(sceneHasGeometry(scene({ meshes: [{ id: 'm', positions: new Float32Array(6), color: [1, 1, 1, 1] }] }))).toBe(false);
    expect(sceneHasGeometry(scene({ meshes: [{ id: 'm', positions: new Float32Array(9), color: [1, 1, 1, 1] }] }))).toBe(true);
    expect(sceneHasGeometry(scene({ lines: [{ id: 'l', positions: new Float32Array(6) }] }))).toBe(true);
    expect(sceneHasGeometry(scene({ points: [{ id: 'p', positions: new Float32Array(3) }] }))).toBe(true);
  });

  it('오류 글', () => {
    expect(errorText(new Error('깨짐'))).toBe('깨짐');
    expect(errorText(new TypeError(''))).toBe('TypeError');
    expect(errorText('글')).toBe('글');
  });
});
