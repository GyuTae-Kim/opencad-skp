/**
 * 면 무늬 투영을 자리에 쓰기(33차 — src/projection.ts faceUvqInto·planeAxesInto, scene.ts가 면마다 부른다):
 * 배열을 새로 잡지 않는 길이 32차까지의 식(아래 옛 식 — 그대로 옮겨 둔 것)과 모든 칸이 같은 수(−0·NaN까지)를 내는지 본다.
 * 법선은 축·거의 수평·0·수가 아님, 행렬은 단위·돌림·원근·뒤집을 수 없음·수가 아님, 종류 0~3과 방향(있음·0·수가 아님)을 섞는다.
 */
import { describe, expect, it } from 'vitest';
import { MAP_STRIDE } from '../src/entities';
import { faceUvq, faceUvqInto, NEAR_Z, planeAxes, planeAxesInto } from '../src/projection';

type V3 = [number, number, number];

// ── 옛 식(32차 src/projection.ts) ─────────────────────────────
function oldPlaneAxes(normal: readonly number[]): [V3, V3] {
  let nx = normal[0]!, ny = normal[1]!, nz = normal[2]!;
  const l = Math.hypot(nx, ny, nz);
  if (l > 0) {
    nx /= l;
    ny /= l;
    nz /= l;
  }
  let x: V3 = Math.abs(nx) < NEAR_Z && Math.abs(ny) < NEAR_Z ? [nz, 0, -nx] : [-ny, nx, 0];
  const xl = Math.hypot(x[0], x[1], x[2]);
  if (xl > 0) x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const y: V3 = [ny * x[2] - nz * x[1], nz * x[0] - nx * x[2], nx * x[1] - ny * x[0]];
  return [[x[0] + 0, x[1] + 0, x[2] + 0], [y[0] + 0, y[1] + 0, y[2] + 0]];
}

function oldInv3(a: ArrayLike<number>): number[] | null {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!, a[7]!, a[8]!];
  const c0 = a4 * a8 - a5 * a7, c1 = a5 * a6 - a3 * a8, c2 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c1 + a2 * c2;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const k = 1 / det;
  const out = [c0, a2 * a7 - a1 * a8, a1 * a5 - a2 * a4, c1, a0 * a8 - a2 * a6, a2 * a3 - a0 * a5, c2, a1 * a6 - a0 * a7, a0 * a4 - a1 * a3].map((v) => v * k);
  return out.every(Number.isFinite) ? out : null;
}

function oldFaceUvq(normal: readonly number[], map: { kind: number; matrix: ArrayLike<number>; dir?: readonly number[] } | undefined, w: number, h: number): { m: Float64Array; singular: boolean } {
  let n = normal;
  if (map && (map.kind === 2 || map.kind === 3) && map.dir) {
    const l = Math.hypot(map.dir[0]!, map.dir[1]!, map.dir[2]!);
    if (l > 1e-12 && Number.isFinite(l)) n = map.dir;
  }
  const [x, y] = oldPlaneAxes(n);
  const P = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, 0, 0, 0, 1];
  let I: number[] | null = null;
  let singular = false;
  if (map) {
    const s = map.matrix;
    I = oldInv3([s[0]!, s[3]!, s[6]!, s[1]!, s[4]!, s[7]!, s[2]!, s[5]!, s[8]!]);
    if (!I) singular = true;
  }
  const m = new Float64Array(12);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      const v = I ? I[r * 3]! * P[c]! + I[r * 3 + 1]! * P[4 + c]! + I[r * 3 + 2]! * P[8 + c]! : P[r * 4 + c]!;
      m[r * 4 + c] = r === 0 ? v / w : r === 1 ? v / h : v;
    }
  return { m, singular };
}
// ────────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
};

/** 시험 법선: 축·거의 수평(NEAR_Z 앞뒤)·0·수가 아님·아무 방향 */
function normals(r: () => number, n: number): V3[] {
  const out: V3[] = [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, 0],
    [-0, 0, -0],
    [NEAR_Z * 0.5, -NEAR_Z * 0.9, 1],
    [NEAR_Z * 1.01, 0, -1],
    [NaN, 0, 1],
    [1e-300, 1e-300, 0],
    [3, 4, 12],
  ];
  for (let i = 0; i < n; i++) out.push([r() * 2 - 1, r() * 2 - 1, (r() * 2 - 1) * (i % 4 === 0 ? 1e-4 : 1)]);
  return out;
}

/** 시험 투영: 단위·돌림·늘림·원근(마지막 줄)·뒤집을 수 없음·수가 아님, 종류 0~3, 방향 있음·0·수가 아님 */
function maps(r: () => number, n: number): { kind: number; matrix: Float64Array; dir?: V3 }[] {
  const out: { kind: number; matrix: Float64Array; dir?: V3 }[] = [
    { kind: 1, matrix: Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1) },
    { kind: 0, matrix: Float64Array.of(0, 1, 0, -1, 0, 0, 3, 4, 1) },
    { kind: 1, matrix: Float64Array.of(1, 2, 3, 2, 4, 6, 0, 0, 1) },
    { kind: 2, matrix: Float64Array.of(1, 0, 0.01, 0, 1, 0.02, 5, 6, 1), dir: [0, 1, 0] },
    { kind: 3, matrix: Float64Array.of(2, 0, 0, 0, 2, 0, 0, 0, 1), dir: [0, 0, 0] },
    { kind: 3, matrix: Float64Array.of(2, 0, 0, 0, 2, 0, 0, 0, 1), dir: [NaN, 1, 0] },
    { kind: 2, matrix: Float64Array.of(NaN, 0, 0, 0, 1, 0, 0, 0, 1), dir: [1, 1, 1] },
    { kind: 1, matrix: Float64Array.of(1e-200, 0, 0, 0, 1e-200, 0, 0, 0, 1) },
    { kind: 1, matrix: Float64Array.of(1e200, 0, 0, 0, 1e200, 0, 0, 0, 1e200) },
  ];
  for (let i = 0; i < n; i++) {
    const m = Float64Array.from({ length: 9 }, () => (r() * 2 - 1) * 10);
    if (i % 3) (m[2] = 0), (m[5] = 0), (m[8] = 1);
    const e: { kind: number; matrix: Float64Array; dir?: V3 } = { kind: i % 4, matrix: m };
    if (i % 2) e.dir = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    out.push(e);
  }
  return out;
}

/** 투영 하나를 entities.ts 무늬 투영 표 꼴로(종류, 방향이 있는지, 행렬 9, 방향 3) — 앞에 다른 투영 하나를 두어 자리를 옮긴다 */
function table(m: { kind: number; matrix: ArrayLike<number>; dir?: V3 }): Float64Array {
  const t = new Float64Array(MAP_STRIDE * 2).fill(7);
  const o = MAP_STRIDE;
  t[o] = m.kind;
  t[o + 1] = m.dir ? 1 : 0;
  for (let i = 0; i < 9; i++) t[o + 2 + i] = m.matrix[i]!;
  for (let i = 0; i < 3; i++) t[o + 11 + i] = m.dir ? m.dir[i]! : NaN;
  return t;
}

describe('면 무늬 투영 자리 쓰기(33차)', () => {
  it('평면 틀: 옛 식과 모든 칸이 같다(−0·NaN까지)', () => {
    const out = [9, 9, 9, 9, 9, 9];
    for (const n of normals(rng(1), 400)) {
      const [x, y] = oldPlaneAxes(n);
      planeAxesInto([5, ...n], 1, out);
      expect(same(out, [...x, ...y]), JSON.stringify(n)).toBe(true);
      const [a, b] = planeAxes(n);
      expect(same([...a, ...b], [...x, ...y])).toBe(true);
    }
  });

  it('투영 행렬: 저장된 투영(표 꼴)·기본 투영 모두 옛 식과 같은 행렬과 뒤집지 못함 표시', () => {
    const r = rng(2);
    const ns = normals(r, 60);
    const ms = maps(r, 120);
    const out = new Float64Array(12).fill(5);
    let singular = 0;
    for (const n of ns)
      for (const [k, m] of ms.entries()) {
        const w = 1 + (k % 7) * 3.5, h = 2 + (k % 5) * 0.75;
        const want = oldFaceUvq(n, m, w, h);
        const s = faceUvqInto(n, table(m), MAP_STRIDE, w, h, out);
        expect(s).toBe(want.singular);
        if (!same(out, want.m)) throw new Error(`다르다: ${JSON.stringify({ n, k })}`);
        const via = faceUvq(n, m, w, h);
        expect(via.singular).toBe(want.singular);
        expect(same(via.m, want.m)).toBe(true);
        if (s) singular++;
        // 기본 투영(표 없음·자리 없음)
        const plain = oldFaceUvq(n, undefined, w, h);
        expect(faceUvqInto(n, undefined, -1, w, h, out)).toBe(false);
        expect(same(out, plain.m)).toBe(true);
        expect(faceUvqInto(n, table(m), -1, w, h, out)).toBe(false);
        expect(same(out, plain.m)).toBe(true);
      }
    // 뒤집을 수 없는 행렬도 섞였다
    expect(singular).toBeGreaterThan(0);
  });
});
