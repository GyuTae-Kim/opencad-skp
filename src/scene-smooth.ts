/**
 * 부드러운 음영(정점 법선): 매끈한 모서리(깃발 0x10 smooth)로 이어진 두 면의 꼭짓점을 한 무리로 묶어 법선을 평균한다.
 * 규칙은 비공개 참조 뷰어와 같다:
 *   - 모서리를 쓰는 면이 정확히 둘일 때만, 두 면 법선의 내적이 SMOOTH_MIN_DOT(약 88.85°)보다 작으면 각진 채로 둔다.
 *   - 0x08(soft)만으로는 이어 칠하지 않는다. 숨김 깃발은 보지 않는다.
 *   - 무리 법선 = 꼭짓점(면 법선) 합을 정규화(넓이·각도 가중치 없음).
 * 꼭짓점 = 면 고리 안의 정점 자리. 차례는 면마다 고리를 이어 붙인 차례(scene.ts triangulateFace가 위치를 쌓는 차례와 같다).
 * 큰 모형을 생각해 이어 칠하는 면만 꼭짓점 배열을 잡는다.
 */
import { loopEdgesKnown } from './entities';
import { FLAG_SMOOTH, type SkpEntities } from './model';

export const SMOOTH_MIN_DOT = 0.02;

export interface CornerNormals {
  /** 면마다 아래 배열 안의 차례(-1 = 이어 칠하지 않는 면 → 면 법선 그대로) */
  faceIndex: Int32Array;
  /** 고른 면마다 꼭짓점 시작(길이 = 고른 면 수 + 1) */
  start: Uint32Array;
  /** 고른 면의 꼭짓점 법선 xyz…(단위) */
  normals: Float32Array;
}

/** 면 평면 법선(단위, 0이면 0) */
export function faceUnitNormal(n: ArrayLike<number>, out: Float64Array, o: number): void {
  const x = n[0] ?? 0;
  const y = n[1] ?? 0;
  const z = n[2] ?? 0;
  const l = Math.hypot(x, y, z);
  out[o] = l > 0 ? x / l : 0;
  out[o + 1] = l > 0 ? y / l : 0;
  out[o + 2] = l > 0 ? z / l : 0;
}

/** 요소 묶음 하나의 꼭짓점 법선. 이어 칠할 곳이 없으면 null */
export function cornerNormals(ents: SkpEntities): CornerNormals | null {
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

  // 고리 모서리 쓰임(매끈한 모서리만): 쓰임 수(255에서 멈춤)와 처음 두 면
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
  // 모서리 번호를 모르는 고리는 정점 짝으로 매끈한 모서리를 찾는다(처음 필요할 때 만든다)
  let pairs: Map<number, number> | null = null;
  const V = Math.max(1, Math.floor(ents.points.length / 3));
  const pairKey = (a: number, b: number): number => (a < b ? a * V + b : b * V + a);
  const LS = faces.loopStart;
  const CS = faces.cornerStart;
  const VX = faces.vertex;
  const ED = faces.edge;
  for (let f = 0; f < F; f++) {
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

  // 이어 칠할 모서리의 두 면을 고른다
  const faceIndex = new Int32Array(F).fill(-1);
  const picked: number[] = [];
  const joins: number[] = [];
  for (let e = 0; e < E; e++) {
    if (uses[e] !== 2) continue;
    const a = f0[e]!;
    const b = f1[e]!;
    if (dotF(a, b) < SMOOTH_MIN_DOT) continue;
    joins.push(e);
    // 두 면 차례로(모서리마다 작은 배열을 만들지 않는다 — 33차)
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
  // 고른 면의 꼭짓점 수 = 면의 꼭짓점 구간 길이(고리를 이어 붙인 차례 — faceCorners와 같은 자리)
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
  /** 고른 면 f(전체 차례)에서 정점 v의 첫 꼭짓점(고른 면 꼭짓점 차례), 없으면 -1 */
  const cornerOf = (f: number, v: number): number => {
    const s = CS[LS[f]!]!;
    const e = CS[LS[f + 1]!]!;
    for (let c = s; c < e; c++) if (VX[c] === v) return start[faceIndex[f]!]! + (c - s);
    return -1;
  };
  /** 모서리 e의 두 면에서 정점 v의 꼭짓점을 한 무리로 */
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
  // 무리 뿌리에 면 법선을 모아 정규화하고, 나머지 꼭짓점은 뿌리 값을 옮겨 적는다
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
