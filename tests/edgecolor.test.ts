import { describe, expect, it } from 'vitest';
import type { LineSet3d } from 'opencad-viewer3d/types';
import type { SkpMaterialInfo } from '../src/materials';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpInstance, SkpModel, SkpPage } from '../src/model';
import { AXIS_EDGE_COLORS, EDGE_COLOR, buildSceneParts } from '../src/scene';
import { edgeColoringFor } from '../src/scene-meta';
import { parseStyleXml, resolveStyle } from '../src/styles';
import { edgesFrom, facesFrom } from '../src/entities';
import { lineColorOverrides } from '../src/app/linecontrast';
import { i32, styleXml } from './build';

/** 모서리만 있는 요소 묶음 */
function edgeEnts(points: number[], edges: SkpEdge[], instances: SkpInstance[] = []): SkpEntities {
  return { points: Float64Array.from(points), faces: facesFrom([]), edges: edgesFrom(edges), instances };
}
const ID = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function modelOf(root: SkpEntities, defs: [number, SkpEntities][] = []): SkpModel {
  return {
    materials: new Map([
      [1, 'Red'],
      [2, 'Blue'],
    ]),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: new Map(defs.map(([id, e]): [number, SkpDefinition] => [id, { id, name: `D${id}`, entities: e }])),
    root,
    counts: { vertices: 0, edges: 0, faces: 0, instances: 0 },
    warnings: [],
  };
}
const MATS = new Map<string, SkpMaterialInfo>([
  ['Red', { name: 'Red', color: [1, 0, 0, 0.5], textured: false }],
  ['Blue', { name: 'Blue', color: [0, 0, 1, 1], textured: false }],
]);
const FG: [number, number, number, number] = [0.3, 0.3, 0.3, 1];
/** 선분마다 첫 정점 색(rgba) */
const segColors = (l: LineSet3d): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < l.colors!.length; i += 8) {
    expect([...l.colors!.subarray(i + 4, i + 8)]).toEqual([...l.colors!.subarray(i, i + 4)]);
    out.push([...l.colors!.subarray(i, i + 4)]);
  }
  return out;
};
/** 정점 색은 f32 — 기대 색도 f32로 */
const c6 = (c: readonly number[]): number[] => c.map((x) => Math.fround(x));
const close = (a: readonly number[], b: readonly number[]): void => a.forEach((x, i) => expect(x).toBeCloseTo(b[i]!, 6));

describe('모서리 색 방식(EdgeColorMode — 레코드 7348·style.xml 1002)', () => {
  it('레코드 7348: 0 재질별 · 2 축별, 1(모두 같게)·모르는 값은 넣지 않는다. 레코드가 없으면 style.xml 1002', () => {
    const mode = (v: number) => resolveStyle({ values: new Map([[0x7348, i32(v)]]) }, undefined).edgeColorMode;
    expect([mode(0), mode(1), mode(2), mode(7)]).toEqual(['material', undefined, 'axis', undefined]);
    const xml = (v: number) => resolveStyle({ values: new Map(), styleName: 'S' }, parseStyleXml(styleXml([[1002, 4, String(v)]], 'S'))).edgeColorMode;
    expect([xml(0), xml(1), xml(2)]).toEqual(['material', undefined, 'axis']);
    // 레코드가 먼저
    expect(resolveStyle({ values: new Map([[0x7348, i32(1)]]), styleName: 'S' }, parseStyleXml(styleXml([[1002, 4, '0']], 'S'))).edgeColorMode).toBeUndefined();
  });

  it('정점 색으로 칠할 방식: 모형 스타일이 먼저, 모두 같게면 스타일을 쓰는 첫 장면의 방식', () => {
    const page = (flags: number, v: number): SkpPage => ({ name: 'p', description: '', flags, hiddenIds: [], hiddenTags: [], sectionIds: [], rendering: { values: new Map([[0x7348, i32(v)]]) } }) as SkpPage;
    expect(edgeColoringFor({ pages: [page(2, 2)] }, { edgeColorMode: 'material' }, undefined)).toBe('material');
    expect(edgeColoringFor({ pages: [page(0, 0), page(2, 1), page(2, 2)] }, {}, undefined)).toBe('axis');
    expect(edgeColoringFor({ pages: [page(0, 0)] }, undefined, undefined)).toBeUndefined();
  });

  it('재질별: 모서리 재질 → 감싼 인스턴스 재질 → 모서리 색(불투명), 부드러운 모서리·주석은 칠하지 않는다', () => {
    const inner = edgeEnts([0, 0, 0, 10, 0, 0, 10, 10, 0], [
      { a: 0, b: 1, flags: 0, material: 2 },
      { a: 1, b: 2, flags: 0 },
    ]);
    const root = edgeEnts([0, 0, 0, 0, 0, 10, 5, 5, 5], [
      { a: 0, b: 1, flags: 0, material: 1 },
      { a: 1, b: 2, flags: 0 },
    ], [
      { definition: 7, matrix: ID, flags: 0, material: 1 },
      { definition: 7, matrix: ID, flags: 0 },
    ]);
    const p = buildSceneParts(modelOf(root, [[7, inner]]), MATS, 1, { edgeColor: FG, edgeColoring: 'material' });
    expect(p.edgeColoring).toBe('material');
    const edges = p.lines.filter((l) => l.id.startsWith('skp-edges-'));
    expect(edges).toHaveLength(1);
    const cs = segColors(edges[0]!);
    expect(cs).toEqual(
      [
        [1, 0, 0, 1], // 모형의 빨강 모서리(재질 알파는 쓰지 않는다)
        FG, // 재질 없는 모형 모서리 → 모서리 색
        [0, 0, 1, 1], // 빨강 인스턴스 안 파랑 모서리 → 자기 재질
        [1, 0, 0, 1], // 빨강 인스턴스 안 재질 없는 모서리 → 인스턴스 재질
        [0, 0, 1, 1], // 재질 없는 인스턴스 안 파랑 모서리
        FG, // 재질 없는 인스턴스 안 재질 없는 모서리 → 모서리 색
      ].map(c6),
    );
    expect(edges[0]!.color).toEqual(FG);
  });

  it('축별: 그리기 축과 나란한 모서리만 축 색, 비스듬한 모서리는 모서리 색 — 배치 행렬로 돌린 모서리도 세계 방향으로', () => {
    const ents = edgeEnts([0, 0, 0, 10, 0, 0, 0, 7, 0, 0, 0, 3, 4, 4, 0], [
      { a: 0, b: 1, flags: 0 },
      { a: 0, b: 2, flags: 0 },
      { a: 3, b: 0, flags: 0 },
      { a: 0, b: 4, flags: 0 },
    ]);
    const p = buildSceneParts(modelOf(ents), MATS, 1, { edgeColor: FG, edgeColoring: 'axis' });
    expect(segColors(p.lines.find((l) => l.id.startsWith('skp-edges-'))!)).toEqual([AXIS_EDGE_COLORS[0]!, AXIS_EDGE_COLORS[1]!, AXIS_EDGE_COLORS[2]!, FG].map(c6));
    // 그리기 축을 Z 둘레로 45° 돌리면 대각선 모서리가 X축, 원래 X·Y 모서리는 비스듬함
    const s = Math.SQRT1_2;
    const q = buildSceneParts(modelOf(ents), MATS, 1, { edgeColor: FG, edgeColoring: 'axis', axes: [[s, s, 0], [-s, s, 0], [0, 0, 1]] });
    const cq = segColors(q.lines.find((l) => l.id.startsWith('skp-edges-'))!);
    expect(cq[0]).toEqual(c6(FG));
    expect(cq[2]).toEqual(c6(AXIS_EDGE_COLORS[2]!));
    expect(cq[3]).toEqual(c6(AXIS_EDGE_COLORS[0]!));
    // 인스턴스를 Z 둘레로 90° 돌려 놓으면 정의의 X 모서리가 세계 Y축
    const R = Float64Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 100, 0, 0, 1]);
    const inst = buildSceneParts(modelOf(edgeEnts([], [], [{ definition: 9, matrix: R, flags: 0 }]), [[9, ents]]), MATS, 1, { edgeColor: FG, edgeColoring: 'axis' });
    const ci = segColors(inst.lines.find((l) => l.id.startsWith('skp-edges-'))!);
    expect(ci.slice(0, 2)).toEqual([AXIS_EDGE_COLORS[1]!, AXIS_EDGE_COLORS[0]!].map(c6));
    close(ci[3]!, FG);
  });

  it('방식을 주지 않으면 정점 색이 없고 예전과 같다', () => {
    const ents = edgeEnts([0, 0, 0, 10, 0, 0], [{ a: 0, b: 1, flags: 0, material: 1 }]);
    const p = buildSceneParts(modelOf(ents), MATS, 1, { edgeColor: FG });
    expect(p.edgeColoring).toBeUndefined();
    for (const l of p.lines) expect(l.colors).toBeUndefined();
    expect(p.lines[0]!.color).toEqual(FG);
  });
});

describe('선 색 대비: 정점 색을 단 모형 모서리 묶음', () => {
  const lines = [
    { id: 'skp-edges-0', color: EDGE_COLOR, colors: new Float32Array(8) },
    { id: 'skp-edges-1', color: EDGE_COLOR },
  ];
  const shaded = { mode: 'shaded' as const, theme: 'dark' as const, backdrop: null, sky: null };
  const wire = { mode: 'wireframe' as const, theme: 'dark' as const, backdrop: null, sky: null };
  it('지금 스타일이 그 방식이면 음영에서는 덮지 않아 정점 색이 보이고, 대비가 모자란 와이어프레임에서는 한 색으로', () => {
    expect(lineColorOverrides(lines, shaded, undefined, null, true).size).toBe(0);
    const o = lineColorOverrides(lines, wire, undefined, null, true);
    expect(o.has('skp-edges-0')).toBe(true);
    expect(o.get('skp-edges-0')).toEqual(o.get('skp-edges-1'));
  });
  it('지금 스타일이 모두 같게면 정점 색 묶음을 늘 스타일 모서리 색 한 색으로 덮는다(정점 색이 없는 묶음은 예전처럼)', () => {
    const o = lineColorOverrides(lines, shaded, undefined, null, false);
    expect([...o.keys()]).toEqual(['skp-edges-0']);
    expect(o.get('skp-edges-0')).toEqual(EDGE_COLOR);
    const g = lineColorOverrides(lines, shaded, undefined, [0.5, 0.5, 0.5], false);
    expect(g.get('skp-edges-0')).toEqual([0.5, 0.5, 0.5, 1]);
    expect(g.get('skp-edges-1')).toEqual([0.5, 0.5, 0.5, 1]);
  });
});
