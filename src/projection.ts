/**
 * SketchUp 면 무늬 투영(비공개 참조 해석기의 무늬 투영 기록을 옮김 — SketchUp 2026 C API로 실제 모형에서 잰 규칙).
 *
 * 면 평면 틀: x = (Z × n) 정규화, n의 x·y가 모두 1e-3보다 작으면(거의 수평인 면) (Y × n). y = n × x. 원점은 정의(컴포넌트) 원점.
 * 기본 투영(저장된 투영이 없는 면, 물려받은 재질로 칠하는 면): u = p·x / 무늬 가로, v = p·y / 무늬 세로(p는 정의 좌표, 인치).
 * 저장된 투영(model.ts SkpTextureMap): 행렬 M이 무늬 좌표(인치) → 평면 틀 좌표의 동차 변환이므로
 *   (U, V, Q) = diag(1/w, 1/h, 1) · M⁻¹ · (p·x, p·y, 1),  u = U / Q, v = V / Q.
 *   종류 2·3은 면 법선 대신 저장된 방향으로 평면 틀을 잡는다. M을 뒤집을 수 없으면 기본 투영.
 *   M의 마지막 줄이 (0, 0, 1)이 아니면(사진 맞춤처럼 일그러뜨린 무늬) Q가 면 위에서 바뀌어 원근 무늬가 된다.
 */
import { hypot3 } from './hypot';

type V3 = [number, number, number];

/** 거의 수평으로 보는 법선 기준(SketchUp: 8.5e-4 기운 법선은 Y, 1.1e-3은 Z를 썼다) */
export const NEAR_Z = 1e-3;

/**
 * 면 평면 틀(planeAxes와 같은 값)을 out[0, 6)에 적는다: x 축 3값, y 축 3값. 법선은 n[k, k + 3).
 * 큰 모형의 장면 만들기가 면마다 부르므로 배열을 새로 잡지 않는다(33차 — 165 MB 표본에서 무늬 투영 계산이 장면 만들기의 4분의 1이었다).
 * 길이는 Math.hypot과 같은 값의 hypot3(51차 — V8 Math.hypot은 부를 때마다 인자 배열을 잡는다)
 */
export function planeAxesInto(n: ArrayLike<number>, k: number, out: number[]): void {
  let nx = n[k]!, ny = n[k + 1]!, nz = n[k + 2]!;
  const l = hypot3(nx, ny, nz);
  if (l > 0) {
    nx /= l;
    ny /= l;
    nz /= l;
  }
  // ref × n: Z × n = (−ny, nx, 0), Y × n = (nz, 0, −nx)
  let x0: number, x1: number, x2: number;
  if (Math.abs(nx) < NEAR_Z && Math.abs(ny) < NEAR_Z) (x0 = nz), (x1 = 0), (x2 = -nx);
  else (x0 = -ny), (x1 = nx), (x2 = 0);
  const xl = hypot3(x0, x1, x2);
  if (xl > 0) (x0 = x0 / xl), (x1 = x1 / xl), (x2 = x2 / xl);
  const y0 = ny * x2 - nz * x1, y1 = nz * x0 - nx * x2, y2 = nx * x1 - ny * x0;
  // −0을 0으로(값은 같다 — 비교·출력을 깔끔하게)
  out[0] = x0 + 0;
  out[1] = x1 + 0;
  out[2] = x2 + 0;
  out[3] = y0 + 0;
  out[4] = y1 + 0;
  out[5] = y2 + 0;
}

/** 면 평면 틀의 (x 축, y 축) */
export function planeAxes(normal: readonly number[]): [V3, V3] {
  const a = [0, 0, 0, 0, 0, 0];
  planeAxesInto(normal, 0, a);
  return [[a[0]!, a[1]!, a[2]!], [a[3]!, a[4]!, a[5]!]];
}

/** 3×3 역행렬(행 우선 a0…a8)을 out[0, 9)에. 뒤집을 수 없거나 유한하지 않으면 false */
function inv3Into(a0: number, a1: number, a2: number, a3: number, a4: number, a5: number, a6: number, a7: number, a8: number, out: number[]): boolean {
  const c0 = a4 * a8 - a5 * a7, c1 = a5 * a6 - a3 * a8, c2 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c1 + a2 * c2;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return false;
  const k = 1 / det;
  out[0] = c0 * k;
  out[1] = (a2 * a7 - a1 * a8) * k;
  out[2] = (a1 * a5 - a2 * a4) * k;
  out[3] = c1 * k;
  out[4] = (a0 * a8 - a2 * a6) * k;
  out[5] = (a2 * a3 - a0 * a5) * k;
  out[6] = c2 * k;
  out[7] = (a1 * a6 - a0 * a7) * k;
  out[8] = (a0 * a4 - a1 * a3) * k;
  for (let i = 0; i < 9; i++) if (!Number.isFinite(out[i]!)) return false;
  return true;
}

export interface FaceUvq {
  /** 3×4 행 우선: (U, V, Q) = m · (x, y, z, 1) — 무늬 한 장 단위 */
  m: Float64Array;
  /** 저장된 행렬을 뒤집지 못해 기본 투영으로 바꿨으면 true */
  singular: boolean;
}

/** faceUvqInto가 면마다 다시 쓰는 자리: 평면 틀, P(평면 틀 투영 3×4 = [x 0; y 0; 0 0 0 1] — 0·1 칸은 그대로 둔다), 역행렬 */
const axesAt = [0, 0, 0, 0, 0, 0];
const planeP = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
const invAt = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * 면 한쪽의 투영 행렬을 out(12칸, 3×4 행 우선)에 적는다(faceUvq와 같은 값 — 배열을 새로 잡지 않는다). 뒤집지 못한 투영이면 true.
 * 저장된 투영은 t[o, o + 14)(entities.ts 무늬 투영 표 꼴: 종류, 방향이 있는지, 행렬 9칸 열 우선, 방향 3칸) — t가 없거나 o < 0이면 기본 투영.
 * 법선은 normal[0, 3), w·h는 무늬 한 장 가로·세로(인치).
 * axes: 부르는 쪽이 이미 구한 normal의 평면 틀(planeAxesInto(normal, 0, …)과 같은 값 — 53차, 장면 만들기가 면마다 앞·뒤 무늬와 물려받기 평면 좌표에 한 번만 구한다)
 */
export function faceUvqInto(normal: ArrayLike<number>, t: ArrayLike<number> | undefined, o: number, w: number, h: number, out: Float64Array, axes?: ArrayLike<number>): boolean {
  const stored = !!t && o >= 0;
  let dirAt = -1;
  if (stored && (t[o] === 2 || t[o] === 3) && t[o + 1]) {
    const l = hypot3(t[o + 11]!, t[o + 12]!, t[o + 13]!);
    if (l > 1e-12 && Number.isFinite(l)) dirAt = o + 11;
  }
  let A: ArrayLike<number> = axesAt;
  if (dirAt >= 0) planeAxesInto(t!, dirAt, axesAt);
  else if (axes) A = axes;
  else planeAxesInto(normal, 0, axesAt);
  const P = planeP;
  P[0] = A[0]!;
  P[1] = A[1]!;
  P[2] = A[2]!;
  P[4] = A[3]!;
  P[5] = A[4]!;
  P[6] = A[5]!;
  let inv = false;
  if (stored) {
    // 열 우선 저장 → 행 우선 M[r][c] = s[c * 3 + r]
    const s = o + 2;
    inv = inv3Into(t[s]!, t[s + 3]!, t[s + 6]!, t[s + 1]!, t[s + 4]!, t[s + 7]!, t[s + 2]!, t[s + 5]!, t[s + 8]!, invAt);
  }
  // 51차: 3×4 고리를 풀어 썼다(칸마다 같은 식·같은 차례 — 줄 0은 ÷w, 줄 1은 ÷h, 줄 2는 그대로)
  if (inv) {
    const I = invAt;
    for (let c = 0; c < 4; c++) {
      const p0 = P[c]!, p1 = P[4 + c]!, p2 = P[8 + c]!;
      out[c] = (I[0]! * p0 + I[1]! * p1 + I[2]! * p2) / w;
      out[4 + c] = (I[3]! * p0 + I[4]! * p1 + I[5]! * p2) / h;
      out[8 + c] = I[6]! * p0 + I[7]! * p1 + I[8]! * p2;
    }
  } else
    for (let c = 0; c < 4; c++) {
      out[c] = P[c]! / w;
      out[4 + c] = P[4 + c]! / h;
      out[8 + c] = P[8 + c]!;
    }
  return stored && !inv;
}

/**
 * 면 한쪽의 투영 행렬. map이 없으면 기본 투영. w·h는 무늬 한 장 가로·세로(인치).
 * matrix는 저장한 그대로 열 우선(matrix[c * 3 + r]).
 */
export function faceUvq(normal: readonly number[], map: { kind: number; matrix: ArrayLike<number>; dir?: readonly number[] } | undefined, w: number, h: number): FaceUvq {
  const m = new Float64Array(12);
  if (!map) return { m, singular: faceUvqInto(normal, undefined, -1, w, h, m) };
  const t = [map.kind, map.dir ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NaN, NaN, NaN];
  for (let i = 0; i < 9; i++) t[2 + i] = map.matrix[i]!;
  if (map.dir) for (let i = 0; i < 3; i++) t[11 + i] = map.dir[i]!;
  return { m, singular: faceUvqInto(normal, t, 0, w, h, m) };
}

/** 원근 무늬로 칠할 만큼 Q가 바뀌는 상대 크기 */
const Q_VARYING = 1e-6;
/** 면 위 |Q| 최솟값 / 최댓값이 이보다 작으면(소실점 가까이) 원근 없이 칠한다 */
const Q_FLOOR = 1e-3;

/**
 * 면 하나의 정점들에 투영을 적용해 out에 (u, v, q) 3값씩 적는다(start 정점부터 count개, points는 xyz…).
 * Q가 면 위에서 바뀌면 (U, V, Q)를 면의 가장 큰 |Q|로 나눠 그대로 두고(셰이더가 조각마다 나눈다), 아니면 q = 1.
 * 무늬는 되풀이되므로 면마다 u·v의 정수 부분을 빼 값이 작게(float32 정밀도) 한다. Q의 부호가 바뀌거나 0에 가까우면
 * 원근 없이 칠하고 flat을 돌려준다.
 */
export function applyFaceUvq(m: ArrayLike<number>, points: ArrayLike<number>, start: number, count: number, out: number[]): { flat: boolean } {
  const tmp = new Float64Array(3 * count);
  const flat = applyFaceUvqAt(m, points, start, count, tmp, 0);
  for (let i = 0; i < tmp.length; i++) out.push(tmp[i]!);
  return { flat };
}

/**
 * applyFaceUvq와 같은 값을 형식 배열 out[at, at + 3·count)에 바로 적는다(51차 — 장면 만들기가 면마다 부른다: 면마다 작은 배열을 비우고
 * 다시 채운 뒤 옮겨 적던 것을 줄인다). 원근 없이 칠했으면 true
 */
export function applyFaceUvqAt(m: ArrayLike<number>, points: ArrayLike<number>, start: number, count: number, out: Float64Array, at: number): boolean {
  const base = at;
  const end = at + 3 * count;
  let qlo = Infinity, qhi = -Infinity;
  const linearQ = m[8] !== 0 || m[9] !== 0 || m[10] !== 0;
  // 53차: 행렬 값은 정점마다 다시 읽지 않는다(out과 같은 형식 배열 꼴이라 V8이 고리 밖으로 꺼내지 못했다 — 같은 식·같은 값)
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!, m3 = m[3]!, m4 = m[4]!, m5 = m[5]!, m6 = m[6]!, m7 = m[7]!, m8 = m[8]!, m9 = m[9]!, m10 = m[10]!, m11 = m[11]!;
  for (let i = 0, w = base; i < count; i++, w += 3) {
    const o = (start + i) * 3;
    const px = points[o]!, py = points[o + 1]!, pz = points[o + 2]!;
    const U = m0 * px + m1 * py + m2 * pz + m3;
    const V = m4 * px + m5 * py + m6 * pz + m7;
    const Q = m8 * px + m9 * py + m10 * pz + m11;
    out[w] = U;
    out[w + 1] = V;
    out[w + 2] = Q;
    if (Q < qlo) qlo = Q;
    if (Q > qhi) qhi = Q;
  }
  const scale = Math.abs(qhi) >= Math.abs(qlo) ? qhi : qlo;
  const mag = Math.abs(scale);
  const varying = linearQ && qhi - qlo > Q_VARYING * mag;
  const usable = varying && (qlo > 0 || qhi < 0) && Math.min(Math.abs(qlo), Math.abs(qhi)) >= Q_FLOOR * mag;
  // 면마다 정수 부분 빼기(같은 면 안에서는 같은 정수라 무늬가 이어진다)
  let umin = Infinity, vmin = Infinity;
  for (let i = base; i < end; i += 3) {
    const q = Math.abs(out[i + 2]!) < 1e-12 ? 1 : out[i + 2]!;
    if (usable) {
      out[i] = out[i]! / scale;
      out[i + 1] = out[i + 1]! / scale;
      out[i + 2] = out[i + 2]! / scale;
    } else {
      out[i] = out[i]! / q;
      out[i + 1] = out[i + 1]! / q;
      out[i + 2] = 1;
    }
    const k = out[i + 2]!;
    umin = Math.min(umin, out[i]! / k);
    vmin = Math.min(vmin, out[i + 1]! / k);
  }
  const ku = Number.isFinite(umin) ? Math.floor(umin) : 0;
  const kv = Number.isFinite(vmin) ? Math.floor(vmin) : 0;
  if (ku || kv)
    for (let i = base; i < end; i += 3) {
      out[i] = out[i]! - ku * out[i + 2]!;
      out[i + 1] = out[i + 1]! - kv * out[i + 2]!;
    }
  return varying && !usable;
}
