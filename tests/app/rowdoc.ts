/**
 * 겹친 것 고르기 시험 모형(56차 keypick.test.ts에서 옮김 — 57차 picklist.test.ts도 쓴다):
 * 감싼 그룹 Row 안에 x 방향으로 늘어선 상자 둘(Near x 3~4, Far x 0~1) — 오른쪽(+x)에서 보면 가운데 시선이 두 상자를 꿰뚫는다.
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import { createDoc } from '../../src/app/doc';
import { edgesFrom, facesFrom } from '../../src/entities';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpFace, SkpInstance, SkpModel } from '../../src/model';
import { buildSceneParts } from '../../src/scene';

const at = (x: number, y = 0, z = 0): Float64Array => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
function shell(points: number[], loops: number[][]): SkpEntities {
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
  const faces: SkpFace[] = loops.map((loop) => {
    const via = loop.map((v, k) => edgeOf(v, loop[(k + 1) % loop.length]!));
    const n = [0, 0, 0];
    loop.forEach((v, k) => {
      const w = loop[(k + 1) % loop.length]!;
      const [ax, ay, az] = [points[3 * v]!, points[3 * v + 1]!, points[3 * v + 2]!];
      const [bx, by, bz] = [points[3 * w]!, points[3 * w + 1]!, points[3 * w + 2]!];
      n[0]! += (ay - by) * (az + bz);
      n[1]! += (az - bz) * (ax + bx);
      n[2]! += (ax - bx) * (ay + by);
    });
    return { loops: [loop], normal: [n[0]!, n[1]!, n[2]!], flags: 0, loopEdges: [via] };
  });
  return { points: Float64Array.from(points), faces: facesFrom(faces), edges: edgesFrom(edges), instances: [] };
}
const CUBE = [
  [0, 3, 2, 1],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [3, 7, 6, 2],
  [0, 4, 7, 3],
  [1, 2, 6, 5],
];
const cube = (): SkpEntities => shell([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], CUBE);
const inst = (definition: number, matrix: Float64Array): SkpInstance => ({ definition, matrix, flags: 0, kind: 'group' });
const group = (list: SkpInstance[]): SkpEntities => ({ ...shell([], []), instances: list });

export function rowDoc(): ReturnType<typeof createDoc> {
  const defs = new Map<number, SkpDefinition>([
    [1, { id: 1, name: 'Far', entities: cube() }],
    [2, { id: 2, name: 'Near', entities: cube() }],
    [3, { id: 3, name: 'Row', entities: group([inst(1, at(0)), inst(2, at(3))]) }],
  ]);
  const model: SkpModel = {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: defs,
    root: group([inst(3, at(0))]),
    counts: { vertices: 0, edges: 0, faces: 0, instances: 3 },
    warnings: [],
  };
  const p = buildSceneParts(model, new Map(), 1, { outline: true });
  const scene: Scene3d = { name: 't', units: 'inch', meshes: p.meshes, lines: p.lines, meta: { tree: p.tree, outline: p.outline, faceRuns: p.faceRuns } };
  return createDoc('row.skp', 1, { scene, ms: 1 });
}
