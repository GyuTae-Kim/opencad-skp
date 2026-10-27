import { describe, expect, it } from 'vitest';
import type { SkpMaterialInfo } from '../src/materials';
import { FLAG_HIDDEN, type SkpDefinition, type SkpEdge, type SkpEntities, type SkpFace, type SkpInstance, type SkpModel } from '../src/model';
import { BoxSet, MAX_CAP_SPLITS, buildSceneParts } from '../src/scene';
import { solidInfo } from '../src/solid';
import { edgeList, edgesFrom, facesFrom } from '../src/entities';

const at = (x: number, y = 0, z = 0, s = 1): Float64Array => Float64Array.from([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1]);

/** 바깥에서 반시계로 감은 면 고리들 → 정점·면·모서리(고리의 모서리 번호까지) */
function shell(points: number[], loops: number[][], o: { withLoopEdges?: boolean; hidden?: number[]; material?: number } = {}): SkpEntities {
  const edges: SkpEdge[] = [];
  const index = new Map<string, number>();
  const edgeOf = (a: number, b: number): number => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let i = index.get(key);
    if (i === undefined) {
      index.set(key, (i = edges.length));
      edges.push({ a, b, flags: 0 });
    }
    return i;
  };
  const faces: SkpFace[] = loops.map((loop, fi) => {
    const via = loop.map((v, k) => edgeOf(v, loop[(k + 1) % loop.length]!));
    // 면 법선(Newell) — 삼각화가 법선의 가장 큰 축을 버린다
    const n = [0, 0, 0];
    loop.forEach((v, k) => {
      const w = loop[(k + 1) % loop.length]!;
      const [ax, ay, az] = [points[3 * v]!, points[3 * v + 1]!, points[3 * v + 2]!];
      const [bx, by, bz] = [points[3 * w]!, points[3 * w + 1]!, points[3 * w + 2]!];
      n[0]! += (ay - by) * (az + bz);
      n[1]! += (az - bz) * (ax + bx);
      n[2]! += (ax - bx) * (ay + by);
    });
    const f: SkpFace = { loops: [loop], normal: [n[0]!, n[1]!, n[2]!], flags: o.hidden?.includes(fi) ? FLAG_HIDDEN : 0 };
    if (o.withLoopEdges !== false) f.loopEdges = [via];
    if (o.material !== undefined) f.front = o.material;
    return f;
  });
  return { points: Float64Array.from(points), faces: facesFrom(faces), edges: edgesFrom(edges), instances: [] };
}

/** 한 변 s인 정육면체(면 여섯, 바깥 방향으로 감음) */
const CUBE_LOOPS = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
];
const cubePoints = (s: number, o = 0): number[] => [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s].map((v, i) => v + (i % 3 === 0 ? o : 0));
const cube = (s = 1, o: Parameters<typeof shell>[2] = {}): SkpEntities => shell(cubePoints(s), CUBE_LOOPS, o);

describe('닫힌 입체·부피(solidInfo)', () => {
  it('정육면체는 닫혔고 부피는 한 변의 세제곱(멀리 놓여도 정밀하게)', () => {
    expect(solidInfo(cube(2))).toEqual({ closed: true, volume: 8 });
    const far = solidInfo(shell(cubePoints(3, 1e7), CUBE_LOOPS));
    expect(far.closed).toBe(true);
    expect(far.volume).toBeCloseTo(27, 6);
  });

  it('고리의 모서리 번호가 없으면 정점 쌍으로 모서리를 가린다', () => {
    expect(solidInfo(cube(1, { withLoopEdges: false }))).toEqual({ closed: true, volume: 1 });
  });

  it('구멍(면 하나 빠짐)·모서리를 세 면이 쓰는 것·면이 넷보다 적은 것은 닫히지 않았다', () => {
    expect(solidInfo(shell(cubePoints(1), CUBE_LOOPS.slice(1))).closed).toBe(false);
    // 바닥에 같은 정사각형을 한 번 더(모서리 넷을 세 면이 쓴다)
    expect(solidInfo(shell(cubePoints(1), [...CUBE_LOOPS, [0, 1, 2, 3]])).closed).toBe(false);
    expect(solidInfo(shell([0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 1, 2], [0, 2, 1]])).closed).toBe(false);
  });

  it('뒤집힌 면이 섞이면 채우기용으로는 닫혔지만 SketchUp 입체가 아니라 부피가 없다', () => {
    const loops = CUBE_LOOPS.map((l, i) => (i === 2 ? [...l].reverse() : l));
    expect(solidInfo(shell(cubePoints(1), loops))).toEqual({ closed: true });
  });

  it('숨긴 면이 있으면 채우기에서 빼고(그물에 없다) 부피는 둔다', () => {
    expect(solidInfo(cube(1, { hidden: [0] }))).toEqual({ closed: false, volume: 1 });
  });

  it('떠 있는 모서리·안쪽 인스턴스가 있으면 입체가 아니다(채우기는 된다)', () => {
    const e = cube(1);
    e.edges = edgesFrom([...edgeList(e.edges), { a: 0, b: 6, flags: 0 }]);
    expect(solidInfo(e)).toEqual({ closed: true });
    const g = cube(1);
    g.instances.push({ definition: 9, matrix: at(0), flags: 0 });
    expect(solidInfo(g)).toEqual({ closed: true });
  });
});

describe('단면 채우기 묶음과 노드 부피(buildSceneParts)', () => {
  function model(): SkpModel {
    const defs = new Map<number, SkpDefinition>([
      [1, { id: 1, name: 'Box', entities: cube(1) }],
      [2, { id: 2, name: 'Plate', entities: shell([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [[0, 1, 2, 3]]) }],
    ]);
    const inst = (definition: number, matrix: Float64Array, o: Partial<SkpInstance> = {}): SkpInstance => ({ definition, matrix, flags: 0, kind: 'group', ...o });
    return {
      materials: new Map([[5, 'Glass']]),
      layers: new Map([[1, 'Layer0']]),
      defaultLayer: 1,
      definitions: defs,
      root: { points: new Float64Array(), faces: facesFrom([]), edges: edgesFrom([]), instances: [inst(1, at(0)), inst(1, at(5, 0, 0, 2)), inst(2, at(0, 5)), inst(1, at(0, 9), { material: 5 })] },
      counts: { vertices: 0, edges: 0, faces: 0, instances: 4 },
      warnings: [],
    };
  }
  const mats = new Map<string, SkpMaterialInfo>([['Glass', { name: 'Glass', color: [0.5, 0.7, 0.9, 0.4], textured: false }]]);

  it('닫힌 입체 배치는 따로 모아 칸마다 같은 capGroup을 주고, 열린 면·반투명 재질 배치는 보통 그물에 둔다', () => {
    const p = buildSceneParts(model(), mats, 1, { outline: true });
    const capped = p.meshes.filter((m) => m.capGroup);
    // 윗단계 노드마다 칸이 나뉜다: 상자 둘은 각자 칸(채우기 묶음 둘), 판·유리 상자는 채우지 않는다
    expect(capped.map((m) => m.capGroup)).toEqual(['skp-solid-1', 'skp-solid-2']);
    expect(p.meshes.filter((m) => !m.capGroup).length).toBe(2);
    expect(p.meshes.find((m) => m.color[3] < 1)?.capGroup).toBeUndefined();
    // 노드 부피: 1, 2³ = 8(배치 배율), 판은 NaN, 유리 상자도 입체(부피는 재질과 상관없다)
    const v = p.treeInfo!.volume!;
    expect([...v.slice(0, 2)]).toEqual([1, 8]);
    expect(Number.isNaN(v[2]!)).toBe(true);
    expect(v[3]).toBe(1);
  });

  it('나무가 없어도(outline 없음) 같은 칸의 닫힌 입체는 한 채우기 묶음', () => {
    const p = buildSceneParts(model(), mats, 25.4);
    expect(p.meshes.filter((m) => m.capGroup).map((m) => m.capGroup)).toEqual(['skp-solid-0']);
    expect(p.treeInfo).toBeUndefined();
  });

  it('닫힌 입체가 없는 모형은 예전과 같은 그물(capGroup 없음)', () => {
    const m = model();
    m.root.instances = m.root.instances.filter((i) => i.definition === 2);
    const p = buildSceneParts(m, mats, 1, { outline: true });
    expect(p.meshes.every((x) => x.capGroup === undefined)).toBe(true);
    expect(p.treeInfo!.volume).toBeUndefined();
  });

  /** 같은 칸(나무 없음 → 칸 0)에 정육면체 배치들: [x, y, z, 배율] */
  function cubes(places: [number, number, number, number][]): SkpModel {
    return {
      materials: new Map(),
      layers: new Map([[1, 'Layer0']]),
      defaultLayer: 1,
      definitions: new Map<number, SkpDefinition>([[1, { id: 1, name: 'Box', entities: cube(1) }]]),
      root: { points: new Float64Array(), faces: facesFrom([]), edges: edgesFrom([]), instances: places.map(([x, y, z, k]) => ({ definition: 1, matrix: at(x, y, z, k), flags: 0, kind: 'group' as const })) },
      counts: { vertices: 0, edges: 0, faces: 0, instances: places.length },
      warnings: [],
    };
  }
  /** 채우기 묶음마다 부호 있는 부피(바깥 감김이면 +) */
  const capVolumes = (p: ReturnType<typeof buildSceneParts>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of p.meshes) {
      if (!m.capGroup) continue;
      const P = m.positions, I = m.indices!, o = m.origin ?? [0, 0, 0];
      let v = 0;
      for (let k = 0; k < I.length; k += 3) {
        const [a, b, c] = [3 * I[k]!, 3 * I[k + 1]!, 3 * I[k + 2]!].map((i) => [P[i]! + o[0], P[i + 1]! + o[1], P[i + 2]! + o[2]]) as [number[], number[], number[]];
        v += a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
      }
      out.set(m.capGroup, (out.get(m.capGroup) ?? 0) + v / 6);
    }
    return out;
  };

  it('같은 칸에서 겹치거나 안에 든 닫힌 입체는 다른 채우기 묶음(홀짝 채우기에서 겹친 곳이 비지 않게)', () => {
    // 겹친 두 상자, 큰 상자 안의 작은 상자
    const overlap = buildSceneParts(cubes([[0, 0, 0, 1], [0.5, 0.5, 0, 1]]), mats, 25.4);
    expect(overlap.meshes.map((m) => m.capGroup)).toEqual(['skp-solid-0', 'skp-solid-0-1']);
    const nested = capVolumes(buildSceneParts(cubes([[0, 0, 0, 3], [1, 1, 1, 1]]), mats, 1));
    expect([...nested.keys()]).toEqual(['skp-solid-0', 'skp-solid-0-1']);
    expect(nested.get('skp-solid-0')).toBeCloseTo(27, 6);
    expect(nested.get('skp-solid-0-1')).toBeCloseTo(1, 6);
  });

  it('닿기만 한(맞붙은·쌓은) 상자와 떨어진 상자는 예전처럼 한 그물·한 채우기 묶음', () => {
    const p = buildSceneParts(cubes([[0, 0, 0, 1], [1, 0, 0, 1], [0, 0, 1, 1], [5, 5, 5, 1]]), mats, 1);
    expect(p.meshes.map((m) => m.capGroup)).toEqual(['skp-solid-0']);
    expect(capVolumes(p).get('skp-solid-0')).toBeCloseTo(4, 6);
  });

  it('묶음 수 한도(모두 겹치면 첫 묶음)·비교 수 한도(넘으면 예전처럼 첫 묶음)', () => {
    const stack = Array.from({ length: MAX_CAP_SPLITS + 2 }, (_, i): [number, number, number, number] => [0.1 * i, 0, 0, 1]);
    const p = buildSceneParts(cubes(stack), mats, 1);
    expect(p.meshes.map((m) => m.capGroup)).toEqual(Array.from({ length: MAX_CAP_SPLITS }, (_, g) => (g ? `skp-solid-0-${g}` : 'skp-solid-0')));
    // 넘친 둘은 첫 묶음에(예전과 같은 홀짝): 부피 합은 그대로
    const v = capVolumes(p);
    expect([...v.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(MAX_CAP_SPLITS + 2, 6);
    expect(v.get('skp-solid-0')).toBeCloseTo(3, 6);
    const capped = buildSceneParts(cubes([[0, 0, 0, 1], [0.5, 0.5, 0, 1]]), mats, 1, { maxCapTests: 0 });
    expect(capped.meshes.map((m) => m.capGroup)).toEqual(['skp-solid-0']);
  });

  it('범위 상자 모음: 크기가 크게 다른 상자도 찾고, 닿기만 하면 겹치지 않는다', () => {
    const set = new BoxSet();
    const budget = { left: 1e6 };
    set.add([0, 0, 0, 1000, 1000, 10]);
    for (let i = 0; i < 50; i++) set.add([2000 + i, 0, 0, 2000 + i + 0.5, 0.5, 0.5]);
    expect(set.overlaps([500, 500, 5, 500.001, 500.001, 5.001], budget)).toBe(true);
    expect(set.overlaps([1000, 0, 0, 1500, 10, 10], budget)).toBe(false);
    expect(set.overlaps([2010.2, 0.1, 0.1, 2010.3, 0.2, 0.2], budget)).toBe(true);
    expect(set.overlaps([1500, -100, -100, 3000, 100, 100], budget)).toBe(true);
    expect(set.overlaps([0, 0, 10, 1000, 1000, 20], budget)).toBe(false);
    expect(set.overlaps([0, 0, 0, 1, 1, 1], { left: 0 })).toBeNull();
  });
});
