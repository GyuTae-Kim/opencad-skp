import { describe, expect, it } from 'vitest';
import type { SkpMaterialInfo } from '../src/materials';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpFace, SkpInstance, SkpModel } from '../src/model';
import { buildSceneParts } from '../src/scene';

/** XZ 평면(y = 0)에 선 2×3 판 하나(앞 = −Y)와 모서리 넷 — 2D 사람처럼 */
function cutout(): SkpEntities {
  const face: SkpFace = { loops: [[0, 1, 2, 3]], normal: [0, -1, 0], flags: 0, loopEdges: [[0, 1, 2, 3]] };
  const edges: SkpEdge[] = [0, 1, 2, 3].map((i) => ({ a: i, b: (i + 1) % 4, flags: 0 }));
  return { points: Float64Array.from([0, 0, 0, 2, 0, 0, 2, 0, 3, 0, 0, 3]), faces: [face], edges, instances: [] };
}

/** 바닥 정사각형 하나(보통 형상) */
function floor(): SkpEntities {
  const face: SkpFace = { loops: [[0, 1, 2, 3]], normal: [0, 0, 1], flags: 0 };
  const edges: SkpEdge[] = [0, 1, 2, 3].map((i) => ({ a: i, b: (i + 1) % 4, flags: 0 }));
  return { points: Float64Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]), faces: [face], edges, instances: [] };
}

/** z축 둘레 deg도 돌리고 (x, y, z)에 놓기(열 우선) */
function placeAt(x: number, y: number, z: number, deg = 0): Float64Array {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return Float64Array.from([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function model(): SkpModel {
  const g = (definition: number, matrix: Float64Array, o: Partial<SkpInstance> = {}): SkpInstance => ({ definition, matrix, flags: 0, kind: 'component', ...o });
  const group: SkpEntities = { ...floor(), instances: [g(1, placeAt(5, 5, 0))] };
  const defs = new Map<number, SkpDefinition>([
    [1, { id: 1, name: 'Person', entities: cutout(), behavior: { alwaysFaceCamera: true, cutsOpening: false, shadowsFaceSun: true } }],
    [2, { id: 2, name: 'Floor', entities: floor() }],
    [3, { id: 3, name: 'Yard', entities: group }],
  ]);
  return {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: defs,
    root: { points: new Float64Array(), faces: [], edges: [], instances: [g(1, placeAt(0, 0, 0)), g(1, placeAt(10, 0, 0, 90)), g(2, placeAt(0, 20, 0)), g(3, placeAt(30, 0, 0), { kind: 'group' })] },
    counts: { vertices: 0, edges: 0, faces: 0, instances: 4 },
    warnings: [],
  };
}
const NO_MATS = new Map<string, SkpMaterialInfo>();

describe('"항상 카메라 보기" 컴포넌트(코어 billboard)', () => {
  it('배치마다 따로 모은 그물에 원점·앞 방향을 달고, 모서리는 그 그물의 윤곽선으로 함께 돌린다', () => {
    const p = buildSceneParts(model(), NO_MATS, 1, { outline: true });
    const bbs = p.meshes.filter((m) => m.billboard);
    expect(bbs.length).toBe(3);
    const at = (x: number, y: number): (typeof bbs)[number] => bbs.find((m) => m.billboard!.origin[0] === x && m.billboard!.origin[1] === y)!;
    const first = at(0, 0).billboard!;
    expect(first.axis).toBe('z');
    expect(first.origin.map((v) => v + 0)).toEqual([0, 0, 0]);
    expect(first.front!.map((v) => v + 0)).toEqual([0, -1, 0]);
    // z축 90° 돌린 배치: 컴포넌트 −Y가 세계 +X 쪽
    const turned = at(10, 0).billboard!;
    expect(turned.front![0]).toBeCloseTo(1, 12);
    expect(turned.front![1]).toBeCloseTo(0, 12);
    // 그룹 안의 배치(그룹 (30,0) + (5,5))
    expect(at(35, 5)).toBeDefined();
    for (const m of bbs) expect(m.edges!.length / 6).toBe(4);
    // 카메라를 보는 배치의 모서리는 선분 묶음에 들지 않는다(바닥 둘만 — 바로 놓인 바닥·그룹 바닥)
    const segs = p.lines.reduce((n, l) => n + l.positions.length / 6, 0);
    expect(segs).toBe(8);
    // 태그 통계의 모서리 수에는 넣는다
    expect(p.tags.find((t) => t.name === 'Layer0')!.edges).toBe(8 + 12);
    // 보통 형상은 그대로
    expect(p.meshes.filter((m) => !m.billboard).every((m) => m.edges === undefined)).toBe(true);
  });

  it('나누는 단계보다 깊은 카메라 보기 노드도 따로 나눈다(항목째 숨기기)', () => {
    const p = buildSceneParts(model(), NO_MATS, 1, { outline: true, maxSplitItems: 1 });
    const t = p.tree!;
    expect(t.splitDepth).toBe(1);
    // 그룹(노드 3) 안의 사람(깊이 2)
    const deep = [...Array(t.count).keys()].find((i) => t.depth[i] === 2)!;
    expect(t.meshFirst[deep]).toBeGreaterThanOrEqual(0);
    expect(t.meshEnd[deep]! - t.meshFirst[deep]!).toBe(1);
    expect(p.meshes[t.meshFirst[deep]!]!.billboard!.origin).toEqual([35, 5, 0]);
    // 그 조상(그룹)의 범위에도 든다
    const yard = t.parent[deep]!;
    expect(t.meshFirst[yard]).toBeLessThanOrEqual(t.meshFirst[deep]!);
    expect(t.meshEnd[yard]).toBeGreaterThanOrEqual(t.meshEnd[deep]!);
  });

  it('모서리는 같은 태그의 그물에 실어 태그를 숨기면 함께 숨는다(그 태그의 그물이 없으면 첫 그물)', () => {
    // 판 둘: 왼쪽 판·모서리는 Layer0, 오른쪽 판·모서리는 Glass, 모서리 하나는 면 없는 Lines 태그
    const pts = Float64Array.from([0, 0, 0, 2, 0, 0, 2, 0, 3, 0, 0, 3, 3, 0, 0, 5, 0, 0, 5, 0, 3, 3, 0, 3, 0, 0, 4, 5, 0, 4]);
    const quad = (o: number, layer: number): SkpFace => ({ loops: [[o, o + 1, o + 2, o + 3]], normal: [0, -1, 0], flags: 0, layer });
    const ring = (o: number, layer: number): SkpEdge[] => [0, 1, 2, 3].map((i) => ({ a: o + i, b: o + ((i + 1) % 4), flags: 0, layer }));
    const ents: SkpEntities = { points: pts, faces: [quad(0, 1), quad(4, 2)], edges: [...ring(0, 1), ...ring(4, 2), { a: 8, b: 9, flags: 0, layer: 3 }], instances: [] };
    const m: SkpModel = {
      materials: new Map(),
      layers: new Map([
        [1, 'Layer0'],
        [2, 'Glass'],
        [3, 'Lines'],
      ]),
      defaultLayer: 1,
      definitions: new Map([[1, { id: 1, name: 'Sign', entities: ents, behavior: { alwaysFaceCamera: true, cutsOpening: false, shadowsFaceSun: true } }]]),
      root: { points: new Float64Array(), faces: [], edges: [], instances: [{ definition: 1, matrix: placeAt(0, 0, 0), flags: 0, kind: 'component' }] },
      counts: { vertices: 0, edges: 0, faces: 0, instances: 1 },
      warnings: [],
    };
    const p = buildSceneParts(m, NO_MATS, 1, { outline: true });
    const bbs = p.meshes.filter((x) => x.billboard);
    expect(bbs.map((x) => x.group).sort()).toEqual(['Glass', 'Layer0']);
    const of = (tag: string) => bbs.find((x) => x.group === tag)!;
    // Glass 판의 모서리 넷은 Glass 그물에, Layer0 넷과 면 없는 Lines 하나는 첫 그물(Layer0)에
    expect(of('Glass').edges!.length / 6).toBe(4);
    expect(of('Layer0').edges!.length / 6).toBe(5);
    expect(Math.min(...Array.from(of('Glass').edges!).filter((_, i) => i % 3 === 0))).toBe(3);
    expect(p.tags.find((t) => t.name === 'Glass')!.edges).toBe(4);
  });
});
