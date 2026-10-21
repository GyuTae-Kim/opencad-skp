import { describe, expect, it } from 'vitest';
import type { LineSet3d, Mesh3d } from 'opencad-viewer3d/types';
import { circumcircle, edgeGeometry, faceBox, faceGeometry, faceOfTriangle, readFaceIndex, segmentsBox } from '../../src/app/faces';
import { createDoc, faceOrEdgeSelection, partBox, partOfPick, selectionEntity, selectionForPick, selectionIds, selectionRanges, selectionText } from '../../src/app/doc';
import { skpToScene } from '../../src/index';
import { ID13, mfcFile, move13, squareEntities, type MfcEntitiesSpec } from '../mfcwrite';

/** 정사각형 면 둘(10×10, 5×5 인치)과 원(반지름 2, 12분할) 하나, 그 정의를 놓은 인스턴스 둘 */
function model(): Uint8Array {
  const N = 12;
  const ring: [number, number, number][] = Array.from({ length: N }, (_, i) => [40 + 2 * Math.cos((2 * Math.PI * i) / N), 2 * Math.sin((2 * Math.PI * i) / N), 0]);
  const sq = squareEntities();
  const root: MfcEntitiesSpec = {
    vertices: [...sq.vertices!, [20, 0, 0], [25, 0, 0], [25, 5, 0], [20, 5, 0], ...ring],
    edges: [
      ...sq.edges!,
      { a: 4, b: 5 },
      { a: 5, b: 6 },
      { a: 6, b: 7 },
      { a: 7, b: 4 },
      ...ring.map((_, i) => ({ a: 8 + i, b: 8 + ((i + 1) % N), curve: 0 })),
    ],
    faces: [
      sq.faces![0]!,
      {
        plane: [0, 0, 1, 0],
        loops: [
          {
            uses: [
              [4, false],
              [5, false],
              [6, false],
              [7, false],
            ],
          },
        ],
      },
    ],
    curves: [{ arc: { center: [40, 0, 0], normal: [0, 0, 1], xaxis: [2, 0, 0], start: (2 * Math.PI) / N, end: 2 * Math.PI } }],
    instances: [
      { def: 0, xform: move13(0, 50, 0), name: '판 1' },
      { def: 0, xform: move13(0, 80, 0), name: '판 2' },
    ],
  };
  return mfcFile({ schemas: 'v20', definitions: [{ name: '판', entities: squareEntities() }], root });
}

describe('면 경계·곡선 번호(해석기 meta)', () => {
  it('그물마다 면 경계, 모서리 묶음마다 곡선 번호를 적는다(곡선이 아닌 선분은 -1)', () => {
    const s = skpToScene(model(), { outline: true });
    const idx = readFaceIndex(s);
    expect(idx.faceRuns.length).toBe(s.meshes.length);
    expect(idx.faceRuns.every((r) => r !== null)).toBe(true);
    // 바로 놓인 형상: 정사각형 면 둘 = 경계 둘(각 2삼각형)
    const loose = s.meshes.findIndex((m) => (m.indices?.length ?? 0) / 3 === 4);
    expect(Array.from(idx.faceRuns[loose]!)).toEqual([0, 2]);
    const curves = idx.segmentCurves.find((c) => c && c.some((v) => v >= 0))!;
    expect(curves.filter((v) => v >= 0).length).toBe(12);
    expect(new Set(curves.filter((v) => v >= 0)).size).toBe(1);
    expect(curves.filter((v) => v < 0).length).toBe(8);
  });

  it('meta 꼴이 맞지 않으면(길이·시작) 그 칸은 null', () => {
    const s = skpToScene(model(), { outline: true });
    const meta = s.meta as Record<string, unknown>;
    meta.faceRuns = [new Uint32Array([1]), 'x'];
    meta.segmentCurves = [new Int32Array(1)];
    const idx = readFaceIndex(s);
    expect(idx.faceRuns.every((r) => r === null)).toBe(true);
    expect(idx.segmentCurves.every((c) => c === null)).toBe(true);
  });
});

describe('면·모서리 셈(순수 함수)', () => {
  it('삼각형 → 면 구간(이분 찾기)', () => {
    const runs = Uint32Array.from([0, 2, 5]);
    expect(faceOfTriangle(runs, 0, 9)).toEqual({ face: 0, start: 0, count: 2 });
    expect(faceOfTriangle(runs, 4, 9)).toEqual({ face: 1, start: 2, count: 3 });
    expect(faceOfTriangle(runs, 8, 9)).toEqual({ face: 2, start: 5, count: 4 });
    expect(faceOfTriangle(runs, 9, 9)).toBeNull();
    expect(faceOfTriangle(null, 0, 9)).toBeNull();
  });

  it('넓이·법선·가운데는 묶음 원점과 변환을 더한 세계 좌표로', () => {
    // 2×1 직사각형(삼각형 둘, 방향이 섞여도 법선이 지워지지 않는다)
    const m: Mesh3d = {
      id: 'm',
      positions: new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 3, 2]),
      color: [1, 1, 1, 1],
      origin: [100, 0, 0],
    };
    const g = faceGeometry(m, 0, 2);
    expect(g.area).toBeCloseTo(2);
    expect(Math.abs(g.normal[2])).toBeCloseTo(1);
    expect(g.center[0]).toBeCloseTo(101);
    // 3배 늘린 변환: 넓이 9배
    const scaled = { ...m, origin: undefined, matrix: new Float64Array([3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]) };
    expect(faceGeometry(scaled, 0, 2).area).toBeCloseTo(18);
    expect(faceBox(m, 0, 2)).toEqual({ min: [100, 0, 0], max: [102, 1, 0] });
  });

  it('곡선: 같은 번호의 선분을 모아 길이·닫힘·반지름, 곡선이 아니면 선분 하나', () => {
    const N = 8;
    const pos: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      const b = (2 * Math.PI * (i + 1)) / N;
      pos.push(5 * Math.cos(a), 5 * Math.sin(a), 0, 5 * Math.cos(b), 5 * Math.sin(b), 0);
    }
    pos.push(0, 0, 0, 3, 4, 0);
    const l: LineSet3d = { id: 'l', positions: new Float32Array(pos) };
    const curves = Int32Array.from([...Array(N).fill(7), -1]);
    const circle = edgeGeometry(l, curves, 3)!;
    expect(circle.segments).toBe(N);
    expect(circle.closed).toBe(true);
    expect(circle.radius).toBeCloseTo(5, 4);
    expect(circle.length).toBeCloseTo(N * 2 * 5 * Math.sin(Math.PI / N), 4);
    expect(circle.ranges).toEqual([{ start: 0, count: N }]);
    const line = edgeGeometry(l, curves, N)!;
    expect(circle.center!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0]);
    expect(line).toMatchObject({ segments: 1, length: 5, curve: false, closed: false, radius: null, center: null, ranges: [{ start: N, count: 1 }] });
    expect(edgeGeometry(l, null, 0)!.segments).toBe(1);
    expect(edgeGeometry(l, curves, 99)).toBeNull();
    expect(segmentsBox(l, [{ start: N, count: 1 }])).toEqual({ min: [0, 0, 0], max: [3, 4, 0] });
  });

  it('외접원: 한 직선 위의 세 점은 null', () => {
    const c = circumcircle([1, 0, 0], [0, 1, 0], [-1, 0, 0])!;
    expect(c.radius).toBeCloseTo(1);
    expect(c.center.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 0]);
    expect(circumcircle([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeNull();
  });
});

describe('면·모서리 고르기(문서)', () => {
  const doc = () => createDoc('판.skp', 1, { scene: skpToScene(model(), { outline: true }), ms: 1 });
  const meshPick = (_d: ReturnType<typeof doc>, id: string, raw: number) => ({ kind: 'mesh' as const, id, index: raw, raw, point: [0, 0, 0] as [number, number, number] });

  it('면·모서리 방식: 누른 삼각형의 면 하나(넓이), 누른 원의 선분은 원 전체(길이·반지름)', () => {
    const d = doc();
    d.pickMode = 'face';
    const loose = d.scene.meshes.find((m) => (m.indices?.length ?? 0) / 3 === 4)!;
    const p = meshPick(d, loose.id, 3);
    const sel = selectionForPick(d, p)!;
    expect(sel).toMatchObject({ kind: 'face', start: 2, count: 2 });
    d.selection = sel;
    d.pick = p;
    // 5×5 인치(단위 설정이 없는 모형은 인치 좌표)
    expect(d.scene.units).toBe('inch');
    expect(selectionEntity(d).area).toBeCloseTo(25, 4);
    expect(selectionIds(d, sel)).toEqual([]);
    expect(selectionRanges(d, sel)).toEqual(new Map([[loose.id, [{ start: 2, count: 2 }]]]));
    expect(selectionText(d, sel)).toMatch(/^면 · 넓이 /);
    expect(partBox(d, sel)).toMatchObject({ min: [20, 0, 0], max: [25, 5, 0] });
    // 모서리: 원 선분 하나를 누르면 원 전체
    const li = d.faceIndex.segmentCurves.findIndex((c) => c && c.some((v) => v >= 0));
    const line = d.scene.lines[li]!;
    const seg = Array.from(d.faceIndex.segmentCurves[li]!).findIndex((v) => v >= 0);
    const ep = { kind: 'line' as const, id: line.id, index: seg, raw: seg, point: [0, 0, 0] as [number, number, number] };
    const es = selectionForPick(d, ep)!;
    expect(es).toEqual({ kind: 'edge', item: li, seg });
    d.selection = es;
    const e = selectionEntity(d);
    expect(e).toMatchObject({ kind: 'edge', segments: 12 });
    expect(e.radius).toBeCloseTo(2, 4);
    expect(selectionText(d, es)).toMatch(/^곡선 · 길이 .* · 반지름 /);
    expect(selectionRanges(d, es)!.get(line.id)!.reduce((n, r) => n + r.count, 0)).toBe(12);
  });

  it('보통 방식에서는 그룹을 고르고, 누른 자리의 면만 다시 고를 수 있다', () => {
    const d = doc();
    const inst = d.outline.find((r) => r.name === '판 1')!;
    const id = inst.ids.find((x) => x.startsWith('skp-mesh'))!;
    const p = meshPick(d, id, 0);
    const sel = selectionForPick(d, p)!;
    expect(sel.kind).toBe('outline');
    d.selection = sel;
    d.pick = p;
    expect(partOfPick(d)).toBe('face');
    const part = faceOrEdgeSelection(d, p)!;
    expect(part.kind).toBe('face');
    d.selection = part;
    expect(partOfPick(d)).toBeNull();
    // 단면의 잘린 면·모르는 항목은 고르지 않는다
    expect(faceOrEdgeSelection(d, { ...p, section: true })).toBeNull();
    expect(faceOrEdgeSelection(d, { ...p, id: 'x' })).toBeNull();
  });

  it('그룹·재질의 넓이는 면 넓이 합으로 둔다(엔티티 입력은 같은 area 칸)', () => {
    const d = doc();
    const inst = d.outline.find((r) => r.name === '판 2')!;
    d.selection = { kind: 'outline', index: inst.index };
    expect(selectionEntity(d).area).toBeCloseTo(100, 4);
    expect(ID13.length).toBe(13);
  });
});
