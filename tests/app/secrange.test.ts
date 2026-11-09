/**
 * 그룹 안 단면을 구간으로(55차 — 코어 0.44.0 setSections items의 { id, start, count, edges? }): 나누지 않은 깊은 그룹은 해석기가 재질·태그로 합친 그물 안의
 * 그 그룹 구간만 자른다. 해석기 장면(buildSceneParts — 모형 바로 아래 항목이 목록 한도를 넘어 나누지 않은 것과 같은 maxOutline 0)을
 * 가짜 WebGL2 위 코어 뷰어에 올려, 나눈 장면(같은 모형을 나눠 그룹이 따로 그물)과 같은 삼각형·선분만 자르는지 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SectionItemRange, SectionPlane } from 'opencad-viewer3d';
import { Viewer3d } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import { edgesFrom, facesFrom } from '../../src/entities';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpFace, SkpInstance, SkpModel } from '../../src/model';
import { buildSceneParts } from '../../src/scene';
import { sectionItems, sectionPlanesFor } from '../../src/app/sections';
import { readTree, type TreeView } from '../../src/app/tree';
import { type FakeElement, installDom } from '../fakegl/fakedom';
import type { DrawEntry, FakeGL } from '../fakegl/fakegl';

const at = (x: number, y = 0, z = 0): Float64Array => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

/** 바깥에서 반시계로 감은 면 고리들 → 정점·면·모서리 */
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

/**
 * 모형: 감싼 그룹(Wrap) 안에 짝 그룹(Pair — 닫힌 상자 둘과 카메라를 보는 판 하나)과 상자 하나, 모형 바로 아래에 상자 하나.
 * 단면은 Pair만 자른다(SketchUp 그룹 안 단면)
 */
function model(): SkpModel {
  const defs = new Map<number, SkpDefinition>([
    [1, { id: 1, name: 'Box', entities: cube() }],
    [2, { id: 2, name: 'Sign', entities: shell([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], [[0, 1, 2, 3]]), behavior: { alwaysFaceCamera: true, cutsOpening: false, shadowsFaceSun: false } }],
    [3, { id: 3, name: 'Pair', entities: group([inst(1, at(0)), inst(1, at(3)), inst(2, at(6))]) }],
    [4, { id: 4, name: 'Wrap', entities: group([inst(3, at(0)), inst(1, at(0, 5))]) }],
  ]);
  return {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: defs,
    root: group([inst(4, at(0)), inst(1, at(10))]),
    counts: { vertices: 0, edges: 0, faces: 0, instances: 7 },
    warnings: [],
  };
}

/** 해석기 장면: split = 나눈 장면(기본 — 그룹마다 따로 그물), 아니면 나누지 않은 장면(모든 그룹이 재질·태그 묶음 하나로 합쳐짐) */
function parsed(split: boolean): { scene: Scene3d; tree: TreeView; pair: number } {
  const p = buildSceneParts(model(), new Map(), 1, { outline: true, ...(split ? {} : { maxOutline: 0 }) });
  const scene: Scene3d = { name: 't', units: 'mm', meshes: p.meshes, lines: p.lines, meta: { tree: p.tree } };
  const tree = readTree(scene)!;
  const pair = [...Array(tree.count).keys()].find((i) => tree.definitionNames[tree.definition[i]!] === 'Pair')!;
  return { scene, tree, pair };
}
/** Pair만 z > 0.5 쪽을 잘라 내는 파일 단면(코어 평면) */
function pairPlanes(s: ReturnType<typeof parsed>, caps: 'closed' | 'none' = 'closed'): SectionPlane[] {
  return sectionPlanesFor({ tree: s.tree, scene: s.scene }, [{ index: 0, plane: { node: s.pair }, normal: [0, 0, 1], offset: 0.5 }], caps).planes;
}

let dom: ReturnType<typeof installDom>;
const views: Viewer3d[] = [];
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  for (const v of views) v.dispose();
  views.length = 0;
  dom.restore();
});

type W = { v: Viewer3d; gl: FakeGL };
function view(scene: Scene3d, mode: 'shaded' | 'shadedEdges' = 'shaded'): W {
  const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, renderMode: mode, viewCube: false, grid: false });
  views.push(v);
  const gl = (v.canvas as unknown as FakeElement).gl!;
  gl.logDraws = true;
  v.setScene(scene);
  v.setView('seIso', false);
  v.fit(false);
  return { v, gl };
}
function frame(w: W): DrawEntry[] {
  w.gl.draws = [];
  w.v.renderNow();
  return w.gl.draws;
}
function uni(e: DrawEntry, name: string): unknown[] | undefined {
  return new Map(JSON.parse(e.uniforms) as [string, unknown[]][]).get(name);
}
const K = (w: W, name: string): number => (w.gl as unknown as Record<string, number>)[name]!;
/** 여러 단면 그물 면 그리기의 [색인 수, 평면 수](잘린 면 홀짝·채운 다각형은 아니다) */
function faceDraws(w: W, d: DrawEntry[]): [number, number][] {
  return d
    .filter((e) => e.op === 'drawElements' && e.args[0] === K(w, 'TRIANGLES') && uni(e, 'u_nclip') !== undefined && uni(e, 'u_mv') !== undefined)
    .map((e) => [e.args[1]!, (uni(e, 'u_nclip') as number[])[0]!]);
}
/** 평면 수가 n인 그리기의 색인 합 */
const indicesWith = (f: [number, number][], n: number): number => f.filter((x) => x[1] === n).reduce((a, x) => a + x[0], 0);

describe('그룹 안 단면 구간(sectionItems → 코어 setSections)', () => {
  it('나누지 않은 장면: Pair 구간(상자 둘 = 합친 그물 삼각형 0~23, 모서리 선분 0~23, 카메라를 보는 판과 그 윤곽선)만 준다', () => {
    const s = parsed(false);
    expect(s.tree.splitDepth).toBe(0);
    const items = sectionItems(s.tree, s.scene, s.pair) as SectionItemRange[];
    const solid = s.scene.meshes.find((m) => m.capGroup)!;
    const sign = s.scene.meshes.find((m) => m.billboard)!;
    const edges = s.scene.lines[0]!;
    expect(solid.indices!.length / 3).toBe(48);
    expect(items).toEqual([
      { id: solid.id, start: 0, count: 24 },
      { id: edges.id, start: 0, count: 24 },
      { id: sign.id, start: 0, count: 2 },
      { id: sign.id, start: 0, count: sign.edges!.length / 6, edges: true },
    ]);
    // 나눈 장면은 같은 노드가 따로 그물(항목 id)
    const t = parsed(true);
    expect(sectionItems(t.tree, t.scene, t.pair).every((x) => typeof x === 'string')).toBe(true);
  });

  it('가짜 WebGL: 구간 단면은 그 구간만 평면 하나로 그리고, 나눈 장면의 항목 단면과 같은 삼각형 수를 자른다', () => {
    const u = parsed(false);
    const w = view(u.scene);
    w.v.setSections(pairPlanes(u));
    const f = faceDraws(w, frame(w));
    // 합친 상자 그물: Pair 갈래(삼각형 24 = 색인 72)만 평면 하나, 나머지(상자 둘 = 72)는 평면 0개. 카메라를 보는 판(삼각형 2)은 통째로 Pair 갈래
    expect(f).toContainEqual([72, 1]);
    expect(f).toContainEqual([72, 0]);
    expect(f).toContainEqual([6, 1]);
    expect(indicesWith(f, 1)).toBe(78);
    expect(indicesWith(f, 0)).toBe(72);
    expect(w.v.sections[0]!.items).toEqual([]);
    expect(w.v.sections[0]!.ranges!.length).toBe(4);
    // 나눈 장면 + 항목 단면: 자르는 삼각형(평면 하나)이 같다 — 상자 둘 24 + 판 2 = 색인 78, 나머지 상자 둘 72
    const sp = parsed(true);
    const ws = view(sp.scene);
    ws.v.setSections(pairPlanes(sp));
    const fs = faceDraws(ws, frame(ws));
    expect(indicesWith(fs, 1)).toBe(78);
    expect(indicesWith(fs, 0)).toBe(72);
  });

  it('잘린 면 채우기는 닫힌 입체 구간(Pair의 상자 둘 — 같은 capGroup 갈래)만 홀짝을 세고 채운 면 하나, 끄면 없다', () => {
    const u = parsed(false);
    const w = view(u.scene);
    w.v.setSections(pairPlanes(u, 'closed'));
    const d = frame(w);
    const stencil = d.filter((e) => e.op === 'drawElements' && uni(e, 'u_clip') !== undefined && uni(e, 'u_nclip') === undefined);
    expect(stencil.map((e) => e.args[1])).toEqual([72]);
    expect(d.filter((e) => e.op === 'drawArrays' && e.args[0] === K(w, 'TRIANGLE_FAN')).length).toBe(1);
    w.v.setSections(pairPlanes(u, 'none'));
    const d2 = frame(w);
    expect(d2.filter((e) => e.op === 'drawElements' && uni(e, 'u_clip') !== undefined && uni(e, 'u_nclip') === undefined).length).toBe(0);
  });

  it('모서리 선분 묶음은 Pair 선분만, 카메라를 보는 판의 윤곽선은 edges 구간으로 자른다', () => {
    const u = parsed(false);
    const w = view(u.scene, 'shadedEdges');
    w.v.setSections(pairPlanes(u));
    const lines = frame(w)
      .filter((e) => e.op === 'drawArrays' && e.args[0] === K(w, 'LINES') && uni(e, 'u_nclip') !== undefined)
      .map((e) => [e.args[1]!, e.args[2]!, (uni(e, 'u_nclip') as number[])[0]!]);
    // 선분 묶음(선분 48 = 정점 96): 0~23 평면 하나, 24~47 평면 0개
    expect(lines).toContainEqual([0, 48, 1]);
    expect(lines).toContainEqual([48, 48, 0]);
    // 판 윤곽선 4개(정점 8)는 평면 하나
    expect(lines).toContainEqual([0, 8, 1]);
  });
});
