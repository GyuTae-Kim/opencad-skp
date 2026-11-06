/**
 * 부드러운 음영 시험 도움(tests/smoothroots.test.ts): 36차 전 cornerNormals 차례 그대로(견줄 기준)와 합성 굽은 띠 정의 만들기.
 * 실제 SketchUp 파일은 쓰지 않는다.
 */
import { loopEdgesKnown } from '../src/entities';
import { FLAG_SMOOTH, readModelDat, type SkpEntities } from '../src/model';
import { faceUnitNormal, SMOOTH_MIN_DOT, type CornerNormals } from '../src/scene-smooth';
import { edge, entities, face, instance, IDENTITY13, modelDat, vertex } from './build';

/** 36차 전 cornerNormals(꼭짓점마다 뿌리를 두 번 찾고 꼭짓점마다 정규화) 그대로 */
export function cornerNormalsBefore(ents: SkpEntities): CornerNormals | null {
  const edges = ents.edges;
  const faces = ents.faces;
  const E = edges.length;
  const F = faces.length;
  if (!E || F < 2) return null;
  const EF = edges.flags;
  let anySmooth = false;
  for (let e = 0; e < E; e++)
    if (EF[e]! & FLAG_SMOOTH) {
      anySmooth = true;
      break;
    }
  if (!anySmooth) return null;
  const uses = new Uint8Array(E);
  const f0 = new Int32Array(E);
  const f1 = new Int32Array(E);
  const use = (e: number, f: number): void => {
    if (!(e >= 0 && e < E) || !(EF[e]! & FLAG_SMOOTH)) return;
    const c = uses[e]!;
    if (c === 0) f0[e] = f;
    else if (c === 1) f1[e] = f;
    if (c < 255) uses[e] = c + 1;
  };
  let pairs: Map<number, number> | null = null;
  const V = Math.max(1, Math.floor(ents.points.length / 3));
  const pairKey = (a: number, b: number): number => (a < b ? a * V + b : b * V + a);
  const LS = faces.loopStart;
  const CS = faces.cornerStart;
  const VX = faces.vertex;
  const ED = faces.edge;
  for (let f = 0; f < F; f++)
    for (let li = LS[f]!; li < LS[f + 1]!; li++) {
      const s = CS[li]!;
      const n = CS[li + 1]! - s;
      if (loopEdgesKnown(faces, li)) {
        for (let k = 0; k < n; k++) use(ED![s + k]!, f);
        continue;
      }
      if (!pairs) {
        pairs = new Map();
        for (let e = 0; e < E; e++) {
          const a = edges.a[e]!;
          const b = edges.b[e]!;
          if (EF[e]! & FLAG_SMOOTH && !pairs.has(pairKey(a, b))) pairs.set(pairKey(a, b), e);
        }
      }
      for (let k = 0; k < n; k++) {
        const e = pairs.get(pairKey(VX[s + k]!, VX[s + ((k + 1) % n)]!));
        if (e !== undefined) use(e, f);
      }
    }
  const fn = new Float64Array(F * 3);
  const N = faces.normal;
  const nrm = [0, 0, 0];
  for (let f = 0; f < F; f++) {
    nrm[0] = N[3 * f]!;
    nrm[1] = N[3 * f + 1]!;
    nrm[2] = N[3 * f + 2]!;
    faceUnitNormal(nrm, fn, 3 * f);
  }
  const dotF = (a: number, b: number): number => fn[3 * a]! * fn[3 * b]! + fn[3 * a + 1]! * fn[3 * b + 1]! + fn[3 * a + 2]! * fn[3 * b + 2]!;
  const faceIndex = new Int32Array(F).fill(-1);
  const picked: number[] = [];
  const joins: number[] = [];
  for (let e = 0; e < E; e++) {
    if (uses[e] !== 2) continue;
    const a = f0[e]!;
    const b = f1[e]!;
    if (dotF(a, b) < SMOOTH_MIN_DOT) continue;
    joins.push(e);
    if (faceIndex[a]! < 0) {
      faceIndex[a] = picked.length;
      picked.push(a);
    }
    if (faceIndex[b]! < 0) {
      faceIndex[b] = picked.length;
      picked.push(b);
    }
  }
  if (!joins.length) return null;
  const start = new Uint32Array(picked.length + 1);
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i]!;
    start[i + 1] = start[i]! + (CS[LS[f + 1]!]! - CS[LS[f]!]!);
  }
  const C = start[picked.length]!;
  const parent = new Int32Array(C);
  for (let c = 0; c < C; c++) parent[c] = c;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const cornerOf = (f: number, v: number): number => {
    const s = CS[LS[f]!]!;
    const e = CS[LS[f + 1]!]!;
    for (let c = s; c < e; c++) if (VX[c] === v) return start[faceIndex[f]!]! + (c - s);
    return -1;
  };
  const join = (e: number, v: number): void => {
    const c0 = cornerOf(f0[e]!, v);
    const c1 = cornerOf(f1[e]!, v);
    if (c0 < 0 || c1 < 0) return;
    const r0 = find(c0);
    const r1 = find(c1);
    if (r0 !== r1) parent[r0] = r1;
  };
  for (const e of joins) {
    join(e, edges.a[e]!);
    join(e, edges.b[e]!);
  }
  const normals = new Float32Array(C * 3);
  const sum = new Float64Array(C * 3);
  for (let i = 0; i < picked.length; i++) {
    const f = picked[i]!;
    for (let c = start[i]!; c < start[i + 1]!; c++) {
      const r = find(c);
      sum[3 * r] += fn[3 * f]!;
      sum[3 * r + 1] += fn[3 * f + 1]!;
      sum[3 * r + 2] += fn[3 * f + 2]!;
    }
  }
  for (let c = 0; c < C; c++) {
    const r = find(c);
    const x = sum[3 * r]!;
    const y = sum[3 * r + 1]!;
    const z = sum[3 * r + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    normals[3 * c] = x / l;
    normals[3 * c + 1] = y / l;
    normals[3 * c + 2] = z / l;
  }
  return { faceIndex, start, normals };
}

const SMOOTH_EDGE = 0x16;

/** 결정적인 난수(시험마다 같은 값) */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export interface StripParts {
  vertices: Uint8Array[];
  edges: Uint8Array[];
  faces: Uint8Array[];
}

/**
 * 굽은 띠(원기둥 조각): 사각형 n개(n < 1000 — 정점·모서리·면 번호는 id부터 1000칸씩), 세로 모서리는 안쪽만 매끈
 * (ring이면 끝을 이어 고리, smooth: false면 매끈한 모서리 없음). crease 번째 사각형은 크게 돌아(이웃 면과 약 97°) 그 양쪽 매끈한 모서리는
 * 이어 칠하지 않는다(SMOOTH_MIN_DOT). 무작위로 반지름·각·높이를 흔들고, 몇 면은 고리를 다른 모서리에서 시작해 꼭짓점 차례가 다르게 한다
 */
export function strip(id: number, n: number, r: () => number, o: { ring?: boolean; crease?: number; smooth?: boolean } = {}): StripParts {
  const ring = !!o.ring;
  const R = 50 + 200 * r();
  const steps = Array.from({ length: n }, (_, i) => (i === o.crease ? 3.3 : 0.05 + 0.15 * r()));
  if (ring) {
    const total = steps.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) steps[i] = (steps[i]! * 2 * Math.PI) / total;
  }
  const ang = [0];
  for (const s of steps) ang.push(ang[ang.length - 1]! + s);
  const cols = ring ? n : n + 1;
  const vertices: Uint8Array[] = [];
  for (let i = 0; i < cols; i++) {
    const t = ang[i]!;
    vertices.push(vertex(id + i, R * Math.cos(t), R * Math.sin(t), r()));
    vertices.push(vertex(id + 1000 + i, R * Math.cos(t), R * Math.sin(t), 30 + 20 * r()));
  }
  const v = (i: number): number => id + (ring ? i % n : i);
  const w = (i: number): number => id + 1000 + (ring ? i % n : i);
  const edges: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    edges.push(edge(id + 2000 + i, v(i), v(i + 1)));
    edges.push(edge(id + 3000 + i, w(i), w(i + 1)));
  }
  for (let i = 0; i < cols; i++) {
    const inner = ring || (i > 0 && i < n);
    edges.push(edge(id + 4000 + i, v(i), w(i), inner && o.smooth !== false ? { flags: SMOOTH_EDGE } : {}));
  }
  const s = (i: number): number => id + 4000 + (ring ? i % n : i);
  const faces: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const t = (ang[i]! + ang[i + 1]!) / 2;
    const loop: [number, boolean][] = [
      [id + 2000 + i, false],
      [s(i + 1), false],
      [id + 3000 + i, true],
      [s(i), true],
    ];
    // 몇 면은 고리를 다른 모서리에서 시작(꼭짓점 차례가 다르다)
    const k = Math.floor(r() * 4);
    faces.push(face(id + 5000 + i, [Math.cos(t), Math.sin(t), 0, -R], [[...loop.slice(k), ...loop.slice(0, k)]]));
  }
  return { vertices, edges, faces };
}

/** 띠 여럿을 정의 하나로(번호 90) 읽은 요소 묶음 */
export function stripDefinition(parts: StripParts[]): SkpEntities {
  const body = { vertices: parts.flatMap((p) => p.vertices), edges: parts.flatMap((p) => p.edges), faces: parts.flatMap((p) => p.faces) };
  const m = readModelDat(modelDat({ definitions: [{ name: '띠', entities: entities(90, body) }], root: entities(undefined, { components: [instance(1, 90, IDENTITY13)] }) }));
  return m.definitions.get(90)!.entities;
}
