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

function docOf(name: string, defs: Map<number, SkpDefinition>, root: SkpInstance[]): ReturnType<typeof createDoc> {
  const model: SkpModel = {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: defs,
    root: group(root),
    counts: { vertices: 0, edges: 0, faces: 0, instances: defs.size },
    warnings: [],
  };
  const p = buildSceneParts(model, new Map(), 1, { outline: true });
  const scene: Scene3d = { name: 't', units: 'inch', meshes: p.meshes, lines: p.lines, meta: { tree: p.tree, outline: p.outline, faceRuns: p.faceRuns } };
  return createDoc(name, 1, { scene, ms: 1 });
}

export function rowDoc(): ReturnType<typeof createDoc> {
  const defs = new Map<number, SkpDefinition>([
    [1, { id: 1, name: 'Far', entities: cube() }],
    [2, { id: 2, name: 'Near', entities: cube() }],
    [3, { id: 3, name: 'Row', entities: group([inst(1, at(0)), inst(2, at(3))]) }],
  ]);
  return docOf('row.skp', defs, [inst(3, at(0))]);
}

/**
 * 촘촘한 자리 시험 모형(59차 — 코어 0.53.0 후보 묶음 열쇠): 정사각형 판 n장(x 3부터 0.05 간격, y·z 0~1)을 낱 면으로 담은 그룹 Slats와
 * 그 뒤 상자 그룹 Wall(x 0~1). 오른쪽(+x)에서 보면 가운데 시선이 판 n장을 지나 Wall의 앞·뒤 면에 닿는다.
 * nested면 두 그룹을 그룹 Site 안에 둔다(펼친 단계 방식에서 접힌 그룹 안 — 차례마다 고를 것이 달라 묶음 열쇠가 없다)
 */
export function stackDoc(n: number, nested = false): ReturnType<typeof createDoc> {
  const points: number[] = [];
  const loops: number[][] = [];
  for (let k = 0; k < n; k++) {
    const x = 3 + k * 0.05;
    const b = points.length / 3;
    points.push(x, 0, 0, x, 1, 0, x, 1, 1, x, 0, 1);
    loops.push([b, b + 1, b + 2, b + 3]);
  }
  const defs = new Map<number, SkpDefinition>([
    [1, { id: 1, name: 'Slats', entities: shell(points, loops) }],
    [2, { id: 2, name: 'Wall', entities: cube() }],
  ]);
  const top = [inst(1, at(0)), inst(2, at(0))];
  if (!nested) return docOf('stack.skp', defs, top);
  defs.set(3, { id: 3, name: 'Site', entities: group(top) });
  return docOf('stack.skp', defs, [inst(3, at(0))]);
}
