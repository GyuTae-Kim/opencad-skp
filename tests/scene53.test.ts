/**
 * 53차 장면 만들기 빠르게 하기가 값을 바꾸지 않는지:
 *  - 부드러운 음영(cornerNormals): 모서리가 지나는 꼭짓점 자리로 첫 꼭짓점을 바로 찾는 길(cornerAt)이 36차 전 차례(tests/smoothref.ts)와 같은지 —
 *    같은 정점이 두 번 든 면, 꼭짓점이 16개를 넘는 면, 모서리 번호를 모르는 고리(정점 짝), 표 밖 모서리 번호가 섞인 무작위 요소 묶음에서.
 *  - 정의 준비(prepare)의 모서리 묶음: 같은 갈래·태그가 이어지는 구간마다 한 번만 세고 찾아도, 묶음 차례(처음 나온 차례)·선분 차례·곡선·재질 값이 같은지.
 *  - 무늬 투영(faceUvqInto): 부르는 쪽이 구해 둔 평면 틀을 넘겨도 같은 행렬인지.
 * 실제 SketchUp 파일은 쓰지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { EDGE_UNKNOWN, type SkpEdges, type SkpFaces } from '../src/entities';
import { FLAG_HIDDEN, FLAG_SMOOTH, FLAG_SOFT, type SkpEntities } from '../src/model';
import { faceUvqInto, planeAxesInto } from '../src/projection';
import { prepare } from '../src/scene';
import { cornerNormals } from '../src/scene-smooth';
import { cornerNormalsBefore, rng } from './smoothref';

/** 무작위 요소 묶음: 작은 정점 무리에서 고른 꼭짓점(같은 정점이 한 면에 두 번 들 수 있다), 3~24 꼭짓점 고리, 매끈한 모서리 많이 */
function randomEntities(seed: number, o: { unknownEdges?: boolean; noEdgeTable?: boolean } = {}): SkpEntities {
  const r = rng(seed);
  const nv = 12 + Math.floor(r() * 30);
  const points = new Float64Array(3 * nv);
  for (let i = 0; i < points.length; i++) points[i] = (r() - 0.5) * 100;
  // 모서리: 정점 짝(무작위) — 앞쪽에 고리 모서리를 그대로 넣어 둔다
  const ea: number[] = [];
  const eb: number[] = [];
  const nf = 20 + Math.floor(r() * 40);
  const loopStart = [0];
  const cornerStart = [0];
  const vertex: number[] = [];
  const edge: number[] = [];
  const normal: number[] = [];
  for (let f = 0; f < nf; f++) {
    const loops = r() < 0.15 ? 2 : 1;
    for (let l = 0; l < loops; l++) {
      const n = r() < 0.1 ? 17 + Math.floor(r() * 8) : 3 + Math.floor(r() * 5);
      const vs: number[] = [];
      for (let k = 0; k < n; k++) vs.push(Math.floor(r() * nv));
      for (let k = 0; k < n; k++) {
        vertex.push(vs[k]!);
        // 고리 모서리: 앞서 만든 같은 정점 짝이 있으면 그것을 다시 쓴다(두 면이 한 모서리를 함께 쓰게), 가끔 모르는 번호·표 밖 번호
        const a = vs[k]!;
        const b = vs[(k + 1) % n]!;
        let e = -1;
        for (let i = 0; i < ea.length && e < 0; i++) if ((ea[i] === a && eb[i] === b) || (ea[i] === b && eb[i] === a)) e = i;
        if (e < 0 || r() < 0.1) {
          e = ea.length;
          ea.push(a);
          eb.push(b);
        }
        const roll = r();
        edge.push(o.unknownEdges && roll < 0.2 ? EDGE_UNKNOWN : roll < 0.03 ? 999999 : e);
      }
      cornerStart.push(vertex.length);
    }
    loopStart.push(cornerStart.length - 1);
    // 법선: 대체로 비슷한 방향(이어 칠하게), 가끔 크게 꺾임
    const t = r() < 0.15 ? Math.PI * r() : 0.3 * r();
    normal.push(Math.sin(t), 0.1 * r(), Math.cos(t));
  }
  const E = ea.length;
  const flags = new Uint8Array(E);
  for (let i = 0; i < E; i++) flags[i] = r() < 0.8 ? FLAG_SMOOTH | FLAG_SOFT : 0;
  const nan = (n: number): Float64Array => new Float64Array(n).fill(NaN);
  const faces: SkpFaces = {
    length: nf,
    loopStart: Uint32Array.from(loopStart),
    cornerStart: Uint32Array.from(cornerStart),
    vertex: Int32Array.from(vertex),
    edge: o.noEdgeTable ? null : Int32Array.from(edge),
    normal: Float64Array.from(normal),
    flags: new Uint8Array(nf),
    front: nan(nf),
    back: nan(nf),
    layer: nan(nf),
    pid: nan(nf),
  };
  const edges: SkpEdges = {
    length: E,
    a: Int32Array.from(ea),
    b: Int32Array.from(eb),
    flags,
    layer: nan(E),
    material: nan(E),
    pid: nan(E),
    curve: new Int32Array(E).fill(-1),
  };
  return { points, faces, edges, instances: [] };
}

describe('부드러운 음영 — 모서리가 지나는 꼭짓점 자리로 첫 꼭짓점 찾기(53차)', () => {
  it('36차 전 차례와 값·차례가 같다(같은 정점이 두 번 든 면·16개 넘는 고리·모르는 모서리·표 밖 번호·모서리 표 없음)', () => {
    let joined = 0;
    let repeated = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const o of [{}, { unknownEdges: true }, { noEdgeTable: true }]) {
        const ents = randomEntities(seed, o);
        const want = cornerNormalsBefore(ents);
        const got = cornerNormals(ents);
        if (!want) {
          expect(got).toBeNull();
          continue;
        }
        expect(got!.faceIndex).toEqual(want.faceIndex);
        expect(got!.start).toEqual(want.start);
        expect(got!.normals).toEqual(want.normals);
        joined += want.start.length - 1;
        const F = ents.faces;
        for (let f = 0; f < F.length; f++) {
          const vs = F.vertex.subarray(F.cornerStart[F.loopStart[f]!]!, F.cornerStart[F.loopStart[f + 1]!]!);
          if (want.faceIndex[f]! >= 0 && new Set(vs).size < vs.length) repeated++;
        }
      }
    }
    // 이어 칠한 면이 충분히 있고, 그 가운데 같은 정점이 두 번 든 면(예전처럼 처음부터 찾는 길)도 섞였다
    expect(joined).toBeGreaterThan(2000);
    expect(repeated).toBeGreaterThan(100);
  });
});

describe('정의 준비 모서리 묶음 — 갈래·태그 구간마다 한 번 세기(53차)', () => {
  it('갈래·태그가 섞여 이어져도 묶음 차례·선분·곡선·재질 값이 모서리 차례 그대로', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const ents = randomEntities(seed);
      const E = ents.edges;
      // 갈래(보통·부드러운·숨긴)와 태그(없음·1·2·3)를 구간으로 섞는다
      let cls = 0;
      let layer = NaN;
      for (let i = 0; i < E.length; i++) {
        if (r() < 0.3) cls = Math.floor(r() * 3);
        if (r() < 0.3) layer = [NaN, 1, 2, 3][Math.floor(r() * 4)]!;
        E.flags[i] = cls === 2 ? FLAG_HIDDEN : cls === 1 ? FLAG_SMOOTH : 0;
        E.layer[i] = layer;
        E.material[i] = r() < 0.5 ? Math.floor(r() * 5) : NaN;
        E.curve[i] = r() < 0.2 ? Math.floor(r() * 4) : -1;
      }
      for (const extras of [false, true]) {
        const p = prepare(ents, 2, { failed: 0 }, extras, false, undefined, null, true);
        // 기대값: 모서리 차례대로 (갈래, 태그 열쇠) 묶음을 처음 나온 차례로 모은다(기본 태그 2와 없음은 -1)
        const want = new Map<string, { cls: number; layer: number; pos: number[]; curve: number[]; mat: number[]; anyCurve: boolean }>();
        for (let i = 0; i < E.length; i++) {
          const f = E.flags[i]!;
          const c = f & FLAG_HIDDEN ? 2 : f & FLAG_SMOOTH ? 1 : 0;
          if (c && !extras) continue;
          const l = E.layer[i]!;
          const key = l === l && l !== 2 ? l : -1;
          let g = want.get(`${c}|${key}`);
          if (!g) want.set(`${c}|${key}`, (g = { cls: c, layer: key, pos: [], curve: [], mat: [], anyCurve: false }));
          const a = 3 * E.a[i]!;
          const b = 3 * E.b[i]!;
          g.pos.push(...ents.points.subarray(a, a + 3), ...ents.points.subarray(b, b + 3));
          g.curve.push(E.curve[i]!);
          if (E.curve[i]! >= 0) g.anyCurve = true;
          g.mat.push(E.material[i]!);
        }
        const all = [...p.lines, ...p.extraLines];
        const order = (c: number): typeof all => [...want.values()].filter((g) => g.cls === c).map((g) => all.find((l) => l.cls === c && l.layer === g.layer)!);
        expect(p.lines.map((l) => l.layer)).toEqual([...want.values()].filter((g) => g.cls === 0).map((g) => g.layer));
        expect(p.extraLines.map((l) => `${l.cls}|${l.layer}`)).toEqual([
          ...[...want.values()].filter((g) => g.cls === 1).map((g) => `1|${g.layer}`),
          ...[...want.values()].filter((g) => g.cls === 2).map((g) => `2|${g.layer}`),
        ]);
        for (const c of [0, 1, 2]) {
          const gs = [...want.values()].filter((g) => g.cls === c);
          order(c).forEach((l, i) => {
            const g = gs[i]!;
            expect([...l.pos]).toEqual(g.pos);
            if (g.anyCurve) expect([...l.curve!]).toEqual(g.curve);
            else expect(l.curve).toBeUndefined();
            if (c === 0) expect([...l.mat!]).toEqual(g.mat);
            else expect(l.mat).toBeUndefined();
          });
        }
      }
    }
  });
});

describe('무늬 투영 — 구해 둔 평면 틀 넘기기(53차)', () => {
  it('평면 틀을 넘겨도 넘기지 않은 것과 같은 행렬·같은 뒤집지 못함 표시', () => {
    const r = rng(53);
    const a = new Float64Array(12);
    const b = new Float64Array(12);
    const axes = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      const n = i % 7 === 0 ? [1e-4 * r(), 1e-4 * r(), 1] : [r() - 0.5, r() - 0.5, r() - 0.5];
      // 저장된 투영: 없음 · 보통 행렬 · 방향이 있는 종류 2·3 · 뒤집지 못하는 행렬
      const t = new Float64Array(14);
      const kind = i % 4;
      t[0] = kind === 2 ? 2 : 1;
      t[1] = kind === 2 ? 1 : 0;
      for (let k = 2; k < 11; k++) t[k] = kind === 3 ? 0 : r() - 0.5;
      t[11] = r() - 0.5;
      t[12] = r() - 0.5;
      t[13] = r() - 0.5;
      const o = kind === 0 ? -1 : 0;
      planeAxesInto(n, 0, axes);
      const w = 1 + 10 * r();
      const h = 1 + 10 * r();
      expect(faceUvqInto(n, t, o, w, h, b, axes)).toBe(faceUvqInto(n, t, o, w, h, a));
      expect([...b]).toEqual([...a]);
    }
  });
});
