import { describe, expect, it } from 'vitest';
import type { Mesh3d, Rgba } from 'opencad-viewer3d/types';
import type { SkpMaterialInfo } from '../src/materials';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpFace, SkpInstance, SkpModel } from '../src/model';
import { buildSceneParts } from '../src/scene';
import { edgesFrom, facesFrom } from '../src/entities';

/** 면 하나(고리 차례 그대로, 법선은 Newell)와 그 모서리 */
function faceEnts(points: number[], loop: number[], o: Partial<SkpFace> = {}): SkpEntities {
  const n = [0, 0, 0];
  loop.forEach((v, k) => {
    const w = loop[(k + 1) % loop.length]!;
    n[0]! += (points[3 * v + 1]! - points[3 * w + 1]!) * (points[3 * v + 2]! + points[3 * w + 2]!);
    n[1]! += (points[3 * v + 2]! - points[3 * w + 2]!) * (points[3 * v]! + points[3 * w]!);
    n[2]! += (points[3 * v]! - points[3 * w]!) * (points[3 * v + 1]! + points[3 * w + 1]!);
  });
  const edges: SkpEdge[] = loop.map((v, k) => ({ a: v, b: loop[(k + 1) % loop.length]!, flags: 0 }));
  const face: SkpFace = { loops: [loop], normal: [n[0]!, n[1]!, n[2]!], flags: 0, ...o };
  return { points: Float64Array.from(points), faces: facesFrom([face]), edges: edgesFrom(edges), instances: [] };
}

const SQ = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
const at = (m: number[]): Float64Array => Float64Array.from(m);
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 50, 0, 0, 1];

function modelOf(defs: [number, SkpEntities][], insts: SkpInstance[], root: SkpEntities | null = null): SkpModel {
  return {
    materials: new Map([
      [1, 'Red'],
      [2, 'Blue'],
    ]),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: new Map(defs.map(([id, e]): [number, SkpDefinition] => [id, { id, name: `D${id}`, entities: e }])),
    root: root ?? { points: new Float64Array(), faces: facesFrom([]), edges: edgesFrom([]), instances: insts },
    counts: { vertices: 0, edges: 0, faces: 1, instances: insts.length },
    warnings: [],
  };
}
const MATS = new Map<string, SkpMaterialInfo>([
  ['Red', { name: 'Red', color: [1, 0, 0, 1], textured: false }],
  ['Blue', { name: 'Blue', color: [0, 0, 1, 1], textured: false }],
]);
const STYLE_BACK: Rgba = [0.6, 0.65, 0.8, 1];

/** 그물의 삼각형마다 (감김 넓이 벡터 · n)의 부호 */
function windings(m: Mesh3d, n: readonly number[]): number[] {
  const p = m.positions;
  const ix = m.indices!;
  const out: number[] = [];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [3 * ix[t]!, 3 * ix[t + 1]!, 3 * ix[t + 2]!];
    const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const x = u[1]! * v[2]! - u[2]! * v[1]!;
    const y = u[2]! * v[0]! - u[0]! * v[2]!;
    const z = u[0]! * v[1]! - u[1]! * v[0]!;
    out.push(Math.sign(x * n[0]! + y * n[1]! + z * n[2]!));
  }
  return out;
}

describe('앞·뒷면(감김·뒷면 색)', () => {
  it('삼각형은 면 법선 쪽에서 반시계로 감는다(위·아래·옆을 보는 면 모두)', () => {
    for (const [pts, loop, n] of [
      [SQ, [0, 1, 2, 3], [0, 0, 1]],
      [SQ, [3, 2, 1, 0], [0, 0, -1]],
      [[0, 0, 0, 0, 0, 10, 0, 10, 10, 0, 10, 0], [0, 1, 2, 3], [-1, 0, 0]],
      [[0, 0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10], [0, 1, 2, 3], [1, 0, 0]],
    ] as [number[], number[], number[]][]) {
      const p = buildSceneParts(modelOf([], [], faceEnts(pts, loop)), MATS, 1);
      expect(windings(p.meshes[0]!, n).every((s) => s === 1)).toBe(true);
    }
  });

  it('거울상 배치(행렬식 < 0)도 세계 법선 쪽에서 반시계', () => {
    const p = buildSceneParts(modelOf([[7, faceEnts(SQ, [0, 1, 2, 3])]], [{ definition: 7, matrix: at(MIRROR_X), flags: 0 }]), MATS, 1);
    // x를 뒤집어도 면 법선(+z)은 그대로 — 뒤집힌 감김을 바로잡는다
    expect(windings(p.meshes[0]!, [0, 0, 1]).every((s) => s === 1)).toBe(true);
  });

  it('재질 없는 뒷면은 스타일 뒷면 색, 뒤 재질이 있으면 그 색, 앞뒤가 같으면 뒷면 색이 없다', () => {
    const insts: SkpInstance[] = [
      { definition: 1, matrix: at(ID), flags: 0 },
      { definition: 2, matrix: at(ID), flags: 0 },
      { definition: 1, matrix: at(ID), flags: 0, material: 2 },
      { definition: 3, matrix: at(ID), flags: 0 },
    ];
    const defs: [number, SkpEntities][] = [
      [1, faceEnts(SQ, [0, 1, 2, 3])],
      [2, faceEnts(SQ, [0, 1, 2, 3], { front: 1, back: 2 })],
      [3, faceEnts(SQ, [0, 1, 2, 3], { front: 1, back: 1 })],
    ];
    const p = buildSceneParts(modelOf(defs, insts), MATS, 1, { defaultBackColor: STYLE_BACK });
    const byName = new Map(p.meshes.map((m) => [m.name, m]));
    // 재질 없음: 앞은 기본색, 뒤는 스타일 뒷면 색
    expect(byName.get('기본 재질 · Layer0')!.backColor).toEqual(STYLE_BACK);
    // 앞 빨강·뒤 파랑과 앞뒤 모두 빨강은 따로 모은다
    const reds = p.meshes.filter((m) => m.name === 'Red · Layer0');
    expect(reds.map((m) => m.backColor ?? null)).toEqual([null, [0, 0, 1, 1]]);
    // 인스턴스 재질(파랑)은 재질 없는 앞·뒤 모두에 물린다 → 양면 파랑(뒷면 색 없음)
    expect(byName.get('Blue · Layer0')!.backColor).toBeUndefined();
    // 스타일 뒷면 색을 모르면 재질 없는 뒷면은 앞면과 같게
    const q = buildSceneParts(modelOf(defs, insts), MATS, 1);
    expect(q.meshes.find((m) => m.name === '기본 재질 · Layer0')!.backColor).toBeUndefined();
  });
});
