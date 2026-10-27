/**
 * 면·모서리 표(src/entities.ts): 객체 목록 ↔ 표가 같은 값을 지니는지, 없는 번호(NaN)·모르는 고리 모서리·무늬 투영 표,
 * 그리고 2021+ 해석기가 표로 읽은 면·모서리.
 */
import { describe, expect, it } from 'vitest';
import {
  EDGE_UNKNOWN,
  MAP_STRIDE,
  edgeAt,
  edgeList,
  edgesFrom,
  faceAt,
  faceCorners,
  faceList,
  facesFrom,
  loopEdgesKnown,
  textureMapAt,
} from '../src/entities';
import type { SkpEdge, SkpFace } from '../src/model';
import { readModelDat } from '../src/model';
import { edge, entities, face, modelDat, vertex } from './build';

const square: SkpFace = { loops: [[0, 1, 2, 3]], normal: [0, 0, 1], flags: 0, loopEdges: [[0, 1, 2, 3]] };

describe('면·모서리 표', () => {
  it('모서리: 객체 ↔ 표가 같고, 없는 칸은 NaN·곡선은 -1', () => {
    const list: SkpEdge[] = [
      { a: 0, b: 1, flags: 0 },
      { a: 1, b: 2, flags: 0x18, layer: 3, material: 2 ** 40, pid: 7, curve: 0, attrs: { d: { k: 1 } } },
      // 2020 이하 장면 숨김용 임시 영구 번호는 음수다
      { a: 2, b: 0, flags: 1, pid: -4 },
    ];
    const t = edgesFrom(list);
    expect(t.length).toBe(3);
    expect(Array.from(t.a)).toEqual([0, 1, 2]);
    expect(Number.isNaN(t.layer[0]!)).toBe(true);
    expect(t.material[1]).toBe(2 ** 40);
    expect(Array.from(t.curve)).toEqual([-1, 0, -1]);
    expect(t.attrs?.size).toBe(1);
    expect(edgeList(t)).toEqual(list);
    expect(edgeAt(t, 2).pid).toBe(-4);
    expect(edgesFrom([]).length).toBe(0);
  });

  it('면: 고리 구간·꼭짓점 구간과 모르는 고리 모서리', () => {
    const holed: SkpFace = {
      loops: [
        [4, 5, 6, 7],
        [8, 9, 10],
      ],
      normal: [0, -1, 0],
      flags: 1,
      front: 2,
      back: 5,
      layer: 1,
      pid: 99,
      // 둘째 고리는 모서리 목록 길이가 고리와 달라 모른다
      loopEdges: [[4, 5, 6, 7], [8]],
    };
    const t = facesFrom([square, holed]);
    expect(t.length).toBe(2);
    expect(Array.from(t.loopStart)).toEqual([0, 1, 3]);
    expect(Array.from(t.cornerStart)).toEqual([0, 4, 8, 11]);
    expect(faceCorners(t, 1)).toEqual([4, 11]);
    expect(Array.from(t.edge!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, EDGE_UNKNOWN, EDGE_UNKNOWN, EDGE_UNKNOWN]);
    expect([0, 1, 2].map((j) => loopEdgesKnown(t, j))).toEqual([true, true, false]);
    expect(faceAt(t, 0)).toEqual(square);
    // 모르는 고리가 있으면 객체 꼴에서 loopEdges가 빠진다
    const back = faceAt(t, 1);
    expect(back.loopEdges).toBeUndefined();
    expect({ ...back, loopEdges: holed.loopEdges }).toEqual(holed);
    // 어느 면도 고리 모서리를 모르면 edge는 null
    const bare = facesFrom([{ loops: [[0, 1, 2]], normal: [0, 0, 1], flags: 0 }]);
    expect(bare.edge).toBeNull();
    expect(loopEdgesKnown(bare, 0)).toBe(false);
    expect(faceList(facesFrom([])).length).toBe(0);
  });

  it('무늬 투영 표: 투영이 있는 면만, 방향이 있는 것과 없는 것', () => {
    const m1 = { kind: 1, matrix: Float64Array.from([1, 0, 0, 0, 1, 0, 0.5, 0.25, 1]) };
    const m2 = { kind: 2, matrix: Float64Array.from([2, 0, 0, 0, 2, 0, 0, 0, 1]), dir: [0, 0, 1] as [number, number, number] };
    const t = facesFrom([square, { ...square, frontMap: m1 }, { ...square, frontMap: m2, backMap: m1 }]);
    expect(Array.from(t.frontMaps!.at)).toEqual([-1, 0, 1]);
    expect(t.frontMaps!.data.length).toBe(2 * MAP_STRIDE);
    expect(Array.from(t.backMaps!.at)).toEqual([-1, -1, 0]);
    expect(textureMapAt(t.frontMaps, 0)).toBeUndefined();
    expect(textureMapAt(t.frontMaps, 1)).toEqual(m1);
    expect(textureMapAt(t.frontMaps, 2)).toEqual(m2);
    expect(faceAt(t, 2).backMap).toEqual(m1);
    expect(facesFrom([square]).frontMaps).toBeUndefined();
  });

  it('2021+ 해석기는 면·모서리를 표로 읽는다(고리는 모서리 쓰임 차례, 뒤집힘이면 끝 정점부터)', () => {
    const root = entities(undefined, {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 1, 1, 0)],
      edges: [edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 1)],
      faces: [
        face(20, [0, 0, 1, 0], [
          [
            [10, false],
            [11, false],
            [12, false],
          ],
        ]),
        face(21, [0, 0, -1, 0], [
          [
            [12, true],
            [11, true],
            [10, true],
          ],
        ]),
      ],
    });
    const m = readModelDat(modelDat({ root }));
    const F = m.root.faces;
    expect(F.length).toBe(2);
    expect(Array.from(F.vertex)).toEqual([0, 1, 2, 0, 2, 1]);
    expect(Array.from(F.edge!)).toEqual([0, 1, 2, 2, 1, 0]);
    expect(Array.from(F.pid)).toEqual([20, 21]);
    expect(Array.from(m.root.edges.pid)).toEqual([10, 11, 12]);
    expect(m.counts).toMatchObject({ faces: 2, edges: 3 });
  });
});
