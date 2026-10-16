import { describe, expect, it } from 'vitest';
import { readModelDat } from '../src/model';
import { linearLayout } from '../src/vffannot';
import { ifcGuid } from '../src/vffcommon';
import {
  IDENTITY13,
  curves,
  dimPoint,
  edge,
  entities,
  face,
  guideLines,
  guidePoints,
  hex,
  instance,
  linearDims,
  modelDat,
  radialDims,
  sectionPlanes,
  texts,
  vertex,
} from './build';

const FONT = [{ id: 2, face: 'Lucida Grande', points: 12 }];

/** 원(또는 호) 모서리 n개: 정점 base.., 모서리 base+100.., 곡선 번호 curveId. 각도 a0..a1 */
function ring(o: { base: number; n: number; c: [number, number, number]; r: number; a1: number; curveId: number; closed?: boolean }): {
  vertices: Uint8Array[];
  edges: Uint8Array[];
  first: number;
  last: number;
} {
  const count = o.closed ? o.n : o.n + 1;
  const vertices = Array.from({ length: count }, (_, i) => {
    const a = (o.a1 * i) / o.n;
    return vertex(o.base + i, o.c[0] + o.r * Math.cos(a), o.c[1] + o.r * Math.sin(a), o.c[2]);
  });
  const edges = Array.from({ length: o.n }, (_, i) => edge(o.base + 100 + i, o.base + i, o.base + ((i + 1) % count), { flags: 0x0e, curve: o.curveId }));
  return { vertices, edges, first: o.base + 100, last: o.base + 100 + o.n - 1 };
}

describe('곡선·호(1396·1397)', () => {
  it('F:curves 호·원·호: 종류·중심·반지름·각도, 모서리를 이은 차례', () => {
    const a = ring({ base: 1000, n: 6, c: [0, 0, 0], r: 10, a1: Math.PI / 2, curveId: 95 });
    const b = ring({ base: 2000, n: 24, c: [25, 0, 0], r: 5, a1: 2 * Math.PI, curveId: 96, closed: true });
    const c = ring({ base: 3000, n: 8, c: [50, 0, 5], r: 10, a1: Math.PI, curveId: 97 });
    // 모서리를 섞어 적는다: 이은 차례는 첫 모서리에서 따라간 차례
    const shuffled = [...a.edges.slice(3), ...a.edges.slice(0, 3)];
    const root = entities(undefined, {
      vertices: [...a.vertices, ...b.vertices, ...c.vertices],
      edges: [...shuffled, ...b.edges, ...c.edges],
      extra: curves([
        { id: 95, first: a.first, last: a.last, edgeCount: 6, arc: [0, 0, 0, 0, 0, 1, 0, 10, 0, 0, 0, 10, 0, 10, 0, Math.PI / 2] },
        { id: 96, first: b.first, last: b.last, edgeCount: 24, arc: [25, 0, 0, 0, 0, 1, 0, 5, 0, 0, 0, 5, 0, 5, 0, 2 * Math.PI] },
        { id: 97, first: c.first, last: c.last, edgeCount: 8, arc: [50, 0, 5, 0, 1, 0, 0, -10, 0, 0, 0, 0, 10, 10, 0, Math.PI] },
      ]),
    });
    const m = readModelDat(modelDat({ root }));
    const cs = m.root.curves!;
    expect(cs.map((x) => [x.pid, x.kind, x.edges.length, x.radius])).toEqual([
      [95, 'arc', 6, 10],
      [96, 'circle', 24, 5],
      [97, 'arc', 8, 10],
    ]);
    expect(cs[0]!.center).toEqual([0, 0, 0]);
    expect(cs[0]!.endAngle).toBeCloseTo(Math.PI / 2);
    expect(cs[2]!.xaxis).toEqual([-10, 0, 0]);
    expect(cs[2]!.normal).toEqual([0, 1, 0]);
    // 적은 차례 [3,4,5,0,1,2] → 첫 모서리(원래 0번 = 적은 차례 3)부터
    expect(cs[0]!.edges).toEqual([3, 4, 5, 0, 1, 2]);
    expect(cs[1]!.edges).toEqual(Array.from({ length: 24 }, (_, i) => 6 + i));
    expect(m.root.edges.every((e) => e.curve !== undefined)).toBe(true);
    expect(m.root.edges[0]!.curve).toBe(0);
    expect(m.root.edges[6]!.curve).toBe(1);
    expect(m.warnings).toEqual([]);
  });

  it('닫힌 곡선은 끝 모서리 반대쪽으로 떠나고, 다각형·보통 곡선·끊긴 곡선 번호', () => {
    const sq = [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 1, 1, 0), vertex(4, 0, 1, 0)];
    // 첫 모서리 10(1→2), 끝 모서리 13(4→1): 첫 모서리의 시작 정점을 끝 모서리와 공유 → 끝 정점 쪽으로 떠난다
    const es = [edge(10, 1, 2, { curve: 50 }), edge(11, 2, 3, { curve: 50 }), edge(12, 3, 4, { curve: 50 }), edge(13, 4, 1, { curve: 50 }), edge(14, 1, 3, { curve: 51 }), edge(15, 2, 4, { curve: 77 })];
    const root = entities(undefined, {
      vertices: sq,
      edges: es,
      extra: curves([
        { id: 50, first: 10, last: 13, polygon: true },
        { id: 51, first: 14, last: 14 },
      ]),
    });
    const m = readModelDat(modelDat({ root }));
    expect(m.root.curves!.map((c) => [c.kind, c.edges])).toEqual([
      ['polygon', [0, 1, 2, 3]],
      ['curve', [4]],
    ]);
    expect(m.root.edges[5]!.curve).toBeUndefined();
    expect(m.warnings.some((w) => w.includes('곡선을 찾지 못한 모서리'))).toBe(true);
  });
});

describe('문자(1398)', () => {
  /** F:texts 세 글 */
  const textModel = (): Uint8Array =>
    modelDat({
      root: entities(undefined, {
        extra: [
          texts([
            { id: 26, text: 'Corner · 모서리', point: dimPoint(1, [10, 10, 0]), leader: [5, 5, 10], leaderType: 2, screen: [0.5, 0.5], font: 2, arrow: 0, material: 69, layer: 3 },
            { id: 27, text: 'No leader', point: dimPoint(1, [0, 0, 0]), leaderType: 0, screen: [0.5, 0.5], font: 2 },
            { id: 28, text: 'Screen note', point: dimPoint(0, [0, 0, 0]), leaderType: 0, screen: [0.1, 0.2], font: 99, flags: 0x26 },
          ]),
        ],
      }),
      fonts: FONT,
    });

  it('지시선 글(pushpin)은 점 + 지시선, 화면 위치는 쓰지 않는다', () => {
    const t = readModelDat(textModel()).root.texts!;
    expect(t[0]).toEqual({ flags: 6, pid: 26, layer: 3, material: 69, text: 'Corner · 모서리', leaderType: 'pushpin', point: [10, 10, 0], leader: [5, 5, 10], font: 2, arrow: 'none' });
  });

  it('지시선 없는 글은 화면 위치, 화면 글(점 종류 0)은 점이 없다. 끊긴 글꼴 참조는 뺀다', () => {
    const t = readModelDat(textModel()).root.texts!;
    expect(t[1]).toMatchObject({ text: 'No leader', leaderType: 'none', point: [0, 0, 0], screen: [0.5, 0.5] });
    expect(t[1]!.leader).toBeUndefined();
    expect(t[2]).toEqual({ flags: 0x26, pid: 28, text: 'Screen note', leaderType: 'none', screen: [0.1, 0.2] });
  });
});

describe('치수(1399·139a)', () => {
  it('F:dimensions 선형: 축 (1,0,0), 띄움 (0,0,0), 글 가운데', () => {
    const root = entities(undefined, {
      extra: [linearDims([{ id: 68, start: dimPoint(1, [0, 0, 0]), end: dimPoint(1, [20, 0, 0]), normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, offset: 0, textPos: 1 }])],
    });
    const d = readModelDat(modelDat({ root })).root.dimensions![0]!;
    expect(d).toEqual({
      flags: 6,
      pid: 68,
      kind: 'linear',
      text: '',
      alignedText: false,
      arrow: 'none',
      normal: [0, 0, 1],
      start: [0, 0, 0],
      end: [20, 0, 0],
      measureAxis: [1, 0, 0],
      offset: [0, 0, 0],
      textAlignment: 'center',
    });
  });

  it('엔진 시험: t=5·a=1 → 띄움 (0,5,0)·slash·aligned, 이상한 법선·거리·정렬', () => {
    const S: [number, number, number] = [0, 0, 0];
    const E: [number, number, number] = [20, 0, 0];
    expect(linearLayout(S, E, [0, 0, 1], [1, 0, 0], 1, 5)).toEqual({ axis: [1, 0, 0], offset: [0, 5, 0] });
    expect(linearLayout(S, E, [Number.NaN, 0, 1], [1, 0, 0], 0, 5)).toEqual({ axis: [1, 0, 0] });
    expect(linearLayout(S, E, [0, 0, 7], [1, 0, 0], 0, 2).offset).toEqual([0, 2, 0]);
    expect(linearLayout(S, E, [0, 0, 1], [1, 0, 0], 0, Infinity)).toEqual({ axis: [1, 0, 0] });
    expect(linearLayout(S, E, [0, 0, 1], [1, 0, 0], 7, 5)).toEqual({});
    // 정렬 2: 법선 × x축 = y축
    expect(linearLayout(S, [3, 4, 0], [0, 0, 1], [1, 0, 0], 2, 1)).toEqual({ axis: [0, 1, 0], offset: [-1, 0, 0] });
    const root = entities(undefined, {
      extra: [linearDims([{ id: 68, start: dimPoint(1, S), end: dimPoint(1, E), alignment: 1, offset: 5, arrow: 1, aligned: true, text: '<> mm' }])],
    });
    const d = readModelDat(modelDat({ root })).root.dimensions![0]!;
    expect(d).toMatchObject({ offset: [0, 5, 0], arrow: 'slash', alignedText: true, text: '<> mm' });
  });

  it('F:dimensions 지름: 호 중심 (35,0,0), r 5, θ 0, L 1.5 → (35,0,0)·(40,0,0)·(42.5,0,0)', () => {
    const b = ring({ base: 1000, n: 24, c: [35, 0, 0], r: 5, a1: 2 * Math.PI, curveId: 72, closed: true });
    const root = entities(undefined, {
      vertices: b.vertices,
      edges: b.edges,
      extra: [
        ...curves([{ id: 72, first: b.first, last: b.last, arc: [35, 0, 0, 0, 0, 1, 0, 5, 0, 0, 0, 5, 0, 5, 0, 2 * Math.PI] }]),
        radialDims([
          { id: 70, edge: 1105, angle: 0, leader: 1.5, diameter: true, arrow: 3, font: 2, material: 69 },
          { id: 71, edge: 1100, angle: Math.PI / 2, diameter: false },
          { id: 72, edge: 4242 },
        ]),
      ],
    });
    const m = readModelDat(modelDat({ root, fonts: FONT }));
    const [d, r] = m.root.dimensions!;
    expect(d).toEqual({
      flags: 6,
      pid: 70,
      material: 69,
      kind: 'diameter',
      text: '',
      font: 2,
      alignedText: false,
      arrow: 'closed',
      center: [35, 0, 0],
      arcPoint: [40, 0, 0],
      attach: [42.5, 0, 0],
      normal: [0, 0, 1],
    });
    expect(r!.kind).toBe('radial');
    expect(r!.arcPoint![0]).toBeCloseTo(35);
    expect(r!.arcPoint![1]).toBeCloseTo(5);
    // 호를 찾지 못한 치수는 빠진다
    expect(m.root.dimensions!.length).toBe(2);
    expect(m.warnings.some((w) => w.includes('잰 호를 찾지 못한'))).toBe(true);
  });

  it('반지름 치수가 다른 묶음의 호를 재면 모형 전체에서 찾는다', () => {
    const b = ring({ base: 1000, n: 8, c: [0, 0, 0], r: 2, a1: 2 * Math.PI, curveId: 72, closed: true });
    const def = entities(50, { vertices: b.vertices, edges: b.edges, extra: curves([{ id: 72, first: b.first, last: b.last, arc: [0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 2, 0, 2, 0, 2 * Math.PI] }]) });
    const root = entities(undefined, { components: [instance(60, 50, IDENTITY13)], extra: [radialDims([{ id: 70, edge: 1101 }])] });
    const m = readModelDat(modelDat({ root, definitions: [{ name: '원', entities: def }] }));
    expect(m.root.dimensions![0]).toMatchObject({ kind: 'radial', center: [0, 0, 0], arcPoint: [2, 0, 0], attach: [2, 0, 0] });
  });

  it('붙은 점: 정점(2)·모서리 가운데(4), 인스턴스 경로(바깥 것부터)로 옮긴다', () => {
    // 정의 60 안에 정의 50 인스턴스(이동 (0,0,5)), 정의 50 안에 정점 1·2와 모서리 3
    const inner = entities(50, { vertices: [vertex(1, 1, 0, 0), vertex(2, 3, 0, 0)], edges: [edge(3, 1, 2)] });
    const mid = entities(60, { components: [instance(61, 50, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 5, 1])] });
    const root = entities(undefined, {
      vertices: [vertex(10, 7, 7, 7)],
      // 바깥 인스턴스 62(이동 (100,0,0))
      components: [instance(62, 60, [1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 0, 0, 1])],
      extra: [
        linearDims([
          { id: 70, start: dimPoint(2, [0, 0, 0], 1, [62, 61]), end: dimPoint(4, [9, 9, 9], 3, [62, 61]) },
          // 같은 묶음 정점(경로 없음) · 찾지 못한 대상(저장 위치)
          { id: 71, start: dimPoint(2, [0, 0, 0], 10), end: dimPoint(2, [4, 4, 4], 999, [62]) },
        ]),
      ],
    });
    const m = readModelDat(modelDat({ root, definitions: [{ name: 'inner', entities: inner }, { name: 'mid', entities: mid }] }));
    const [a, b] = m.root.dimensions!;
    expect(a!.start).toEqual([101, 0, 5]);
    expect(a!.end).toEqual([102, 0, 5]);
    // 풀린 점으로 다시 잰 축
    expect(a!.measureAxis).toEqual([1, 0, 0]);
    expect(b!.start).toEqual([7, 7, 7]);
    expect(b!.end).toEqual([4, 4, 4]);
    expect(m.warnings.some((w) => w.includes('붙은 치수 점 1개'))).toBe(true);
  });
});

describe('보조선·보조점(1391·1392)', () => {
  it('F:guides: 끝 있는 선·끝없는 선·점', () => {
    const root = entities(undefined, {
      extra: [
        guideLines([
          { id: 17, point: [0, 0, 0], direction: [0.894427191, 0.4472135955, 0], range: [0, 11.180339887] },
          { id: 18, point: [0, 0, 5], direction: [0, 0, 1], layer: 3 },
        ]),
        guidePoints([
          { id: 19, point: [3, 4, 5] },
          { id: 20, point: [-7.5, 2.25, 0], anchor: [1, 1, 0] },
        ]),
      ],
    });
    const g = readModelDat(modelDat({ root })).root.guides!;
    expect(g[0]!.kind).toBe('line');
    expect(g[0]!.start).toEqual([0, 0, 0]);
    expect(g[0]!.end![0]).toBeCloseTo(10);
    expect(g[0]!.end![1]).toBeCloseTo(5);
    expect(g[1]).toEqual({ flags: 6, kind: 'line', point: [0, 0, 5], direction: [0, 0, 1], pid: 18, layer: 3 });
    expect(g[2]).toEqual({ flags: 6, kind: 'point', point: [3, 4, 5], pid: 19 });
    expect(g[3]).toEqual({ flags: 6, kind: 'point', point: [-7.5, 2.25, 0], pid: 20, start: [1, 1, 0] });
  });
});

describe('단면 평면(1393·1394)', () => {
  it('F:section_planes: 뿌리 둘(하나 활성) + 그룹 정의 안 하나', () => {
    const inner = entities(73, { extra: [sectionPlanes([{ id: 74, plane: [0, 1, 0, -5], name: 'Inner', symbol: 'C' }])], activeSection: 74 });
    const root = entities(undefined, {
      groups: [instance(45, 73, IDENTITY13)],
      extra: [
        sectionPlanes([
          { id: 43, plane: [1, 0, 0, -10], name: 'Cut A', symbol: 'A' },
          { id: 44, plane: [0, 0, -1, 15], name: 'Cut B', symbol: 'B' },
        ]),
      ],
      activeSection: 43,
    });
    const m = readModelDat(modelDat({ root, definitions: [{ name: 'Group', entities: inner, kind: 1 }] }));
    expect(m.root.sections!.map((s) => [s.pid, s.name, s.symbol, s.plane, s.active])).toEqual([
      [43, 'Cut A', 'A', [1, 0, 0, -10], true],
      [44, 'Cut B', 'B', [0, 0, -1, 15], false],
    ]);
    expect(m.definitions.get(73)!.entities.sections).toEqual([{ flags: 6, pid: 74, plane: [0, 1, 0, -5], name: 'Inner', symbol: 'C', active: true }]);
    expect(m.definitions.get(73)!.kind).toBe('group');
  });
});

describe('인스턴스·정의 칸', () => {
  it('종류: 138c 컴포넌트, 138d/1d4c 그룹, 1390/1f40 그림(정의 종류 2면 어디서든 그림)', () => {
    const root = entities(undefined, {
      components: [instance(20, 50, IDENTITY13), instance(21, 52, IDENTITY13, { guid: hex('64fa032707054ce08bd4d430b1241cb8') })],
      groups: [instance(22, 51, IDENTITY13)],
      images: [instance(23, 52, [3, 0, 0, 0, 3, 0, 0, 0, 1, 5, 5, 0, 1], { flags: 0x04, guid: hex('64fa032707054ce08bd4d430b1241cb8') })],
    });
    const m = readModelDat(
      modelDat({
        root,
        definitions: [
          { name: 'C', entities: entities(50, {}) },
          { name: 'G', entities: entities(51, {}), kind: 1 },
          { name: 'checker', entities: entities(52, {}), kind: 2 },
        ],
      }),
    );
    expect(m.root.instances.map((i) => [i.pid, i.kind, i.guid ?? null])).toEqual([
      [22, 'group', null],
      [20, 'component', null],
      [21, 'image', null],
      [23, 'image', null],
    ]);
    expect([...m.definitions.values()].map((d) => d.kind)).toEqual(['component', 'group', 'image']);
  });

  it('GUID(F:hidden_locked): 16바이트 → IFC 22자, 잠김 깃발 0x20은 그대로', () => {
    expect(ifcGuid(hex('64fa032707054ce08bd4d430b1241cb8'))).toBe('0d0$fa1GVWJ8lKr32n91ou');
    expect(ifcGuid(new Uint8Array(16))).toBeUndefined();
    expect(ifcGuid(new Uint8Array(15))).toBeUndefined();
    const root = entities(undefined, {
      components: [
        instance(65, 50, IDENTITY13, { flags: 0x07, guid: hex('64fa032707054ce08bd4d430b1241cb8') }),
        instance(66, 50, IDENTITY13, { flags: 0x26 }),
      ],
    });
    const m = readModelDat(modelDat({ root, definitions: [{ name: 'Block', entities: entities(50, {}) }] }));
    expect(m.root.instances.map((i) => [i.pid, i.flags, i.guid ?? null])).toEqual([
      [65, 0x07, '0d0$fa1GVWJ8lKr32n91ou'],
      [66, 0x26, null],
    ]);
  });

  it('정의 GUID·설명·동작(F:component_transforms Chair: 붙는 면 horizontal, 마스크 5)', () => {
    const m = readModelDat(
      modelDat({
        root: entities(undefined, {}),
        definitions: [
          {
            name: 'Chair',
            entities: entities(50, {}),
            guid: hex('64fa032707054ce08bd4d430b1241cb8'),
            description: '의자 · test',
            behavior: { snapTo: 1, glued: true, noScaleMask: 5 },
          },
          { name: 'Free', entities: entities(51, {}), behavior: { snapTo: 1, cutsOpening: true, alwaysFaceCamera: true } },
          { name: 'Odd', entities: entities(52, {}), behavior: { snapTo: 9, glued: true } },
          { name: 'Pic', entities: entities(53, {}), kind: 2, behavior: { glued: true } },
        ],
      }),
    );
    const d = m.definitions;
    expect(d.get(50)).toMatchObject({ guid: '0d0$fa1GVWJ8lKr32n91ou', description: '의자 · test', kind: 'component' });
    expect(d.get(50)!.behavior).toEqual({ alwaysFaceCamera: false, cutsOpening: false, shadowsFaceSun: false, snapTo: 'horizontal', noScaleMask: 5 });
    expect(d.get(51)!.behavior).toMatchObject({ snapTo: 'none', cutsOpening: true, alwaysFaceCamera: true });
    expect(d.get(52)!.behavior!.snapTo).toBe(9);
    expect(d.get(53)!.behavior).toBeUndefined();
    expect(d.get(51)!.guid).toBeUndefined();
  });

  it('모서리 재질·영구 번호, 면의 고리 모서리(loopEdges)·영구 번호', () => {
    const root = entities(undefined, {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
      edges: [edge(4, 1, 2, { material: 13, flags: 0x16 }), edge(5, 2, 3), edge(6, 3, 1)],
      faces: [
        face(
          7,
          [0, 0, 1, 0],
          [
            [
              [6, true],
              [5, true],
              [4, true],
            ],
          ],
          { flags: 0x07 },
        ),
      ],
    });
    const m = readModelDat(modelDat({ root }));
    expect(m.root.edges.map((e) => [e.pid, e.material ?? null, e.flags])).toEqual([
      [4, 13, 0x16],
      [5, null, 6],
      [6, null, 6],
    ]);
    const f = m.root.faces[0]!;
    expect(f.pid).toBe(7);
    expect(f.loops).toEqual([[0, 2, 1]]);
    expect(f.loopEdges).toEqual([[2, 1, 0]]);
  });
});
