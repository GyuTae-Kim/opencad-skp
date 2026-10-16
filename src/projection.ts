/**
 * SketchUp 면 무늬 투영(PRISME 엔진 projection.py·vff/entities.py의 기록을 옮김 — SketchUp 2026 C API로 실제 모형에서 잰 규칙).
 *
 * 면 평면 틀: x = (Z × n) 정규화, n의 x·y가 모두 1e-3보다 작으면(거의 수평인 면) (Y × n). y = n × x. 원점은 정의(컴포넌트) 원점.
 * 기본 투영(저장된 투영이 없는 면, 물려받은 재질로 칠하는 면): u = p·x / 무늬 가로, v = p·y / 무늬 세로(p는 정의 좌표, 인치).
 * 저장된 투영(model.ts SkpTextureMap): 행렬 M이 무늬 좌표(인치) → 평면 틀 좌표의 동차 변환이므로
 *   (U, V, Q) = diag(1/w, 1/h, 1) · M⁻¹ · (p·x, p·y, 1),  u = U / Q, v = V / Q.
 *   종류 2·3은 면 법선 대신 저장된 방향으로 평면 틀을 잡는다. M을 뒤집을 수 없으면 기본 투영.
 *   M의 마지막 줄이 (0, 0, 1)이 아니면(사진 맞춤처럼 일그러뜨린 무늬) Q가 면 위에서 바뀌어 원근 무늬가 된다.
 */

type V3 = [number, number, number];

/** 거의 수평으로 보는 법선 기준(SketchUp: 8.5e-4 기운 법선은 Y, 1.1e-3은 Z를 썼다) */
export const NEAR_Z = 1e-3;

/** 면 평면 틀의 (x 축, y 축) */
export function planeAxes(normal: readonly number[]): [V3, V3] {
  let nx = normal[0]!, ny = normal[1]!, nz = normal[2]!;
  const l = Math.hypot(nx, ny, nz);
  if (l > 0) {
    nx /= l;
    ny /= l;
    nz /= l;
  }
  // ref × n: Z × n = (−ny, nx, 0), Y × n = (nz, 0, −nx)
  let x: V3 = Math.abs(nx) < NEAR_Z && Math.abs(ny) < NEAR_Z ? [nz, 0, -nx] : [-ny, nx, 0];
  const xl = Math.hypot(x[0], x[1], x[2]);
  if (xl > 0) x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const y: V3 = [ny * x[2] - nz * x[1], nz * x[0] - nx * x[2], nx * x[1] - ny * x[0]];
  // −0을 0으로(값은 같다 — 비교·출력을 깔끔하게)
  return [[x[0] + 0, x[1] + 0, x[2] + 0], [y[0] + 0, y[1] + 0, y[2] + 0]];
}

/** 3×3 역행렬(행 우선 a[r * 3 + c]). 뒤집을 수 없거나 유한하지 않으면 null */
function inv3(a: ArrayLike<number>): number[] | null {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!, a[7]!, a[8]!];
  const c0 = a4 * a8 - a5 * a7, c1 = a5 * a6 - a3 * a8, c2 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c1 + a2 * c2;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const k = 1 / det;
  const out = [c0, a2 * a7 - a1 * a8, a1 * a5 - a2 * a4, c1, a0 * a8 - a2 * a6, a2 * a3 - a0 * a5, c2, a1 * a6 - a0 * a7, a0 * a4 - a1 * a3].map((v) => v * k);
  return out.every(Number.isFinite) ? out : null;
}

export interface FaceUvq {
  /** 3×4 행 우선: (U, V, Q) = m · (x, y, z, 1) — 무늬 한 장 단위 */
  m: Float64Array;
  /** 저장된 행렬을 뒤집지 못해 기본 투영으로 바꿨으면 true */
  singular: boolean;
}

/**
 * 면 한쪽의 투영 행렬. map이 없으면 기본 투영. w·h는 무늬 한 장 가로·세로(인치).
 * matrix는 저장한 그대로 열 우선(matrix[c * 3 + r]).
 */
export function faceUvq(normal: readonly number[], map: { kind: number; matrix: ArrayLike<number>; dir?: readonly number[] } | undefined, w: number, h: number): FaceUvq {
  let n = normal;
  if (map && (map.kind === 2 || map.kind === 3) && map.dir) {
    const l = Math.hypot(map.dir[0]!, map.dir[1]!, map.dir[2]!);
    if (l > 1e-12 && Number.isFinite(l)) n = map.dir;
  }
  const [x, y] = planeAxes(n);
  // P: 평면 틀 투영(3×4) = [x 0; y 0; 0 0 0 1]
  const P = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, 0, 0, 0, 1];
  let I: number[] | null = null;
  let singular = false;
  if (map) {
    const s = map.matrix;
    // 열 우선 저장 → 행 우선 M[r][c] = s[c * 3 + r]
    I = inv3([s[0]!, s[3]!, s[6]!, s[1]!, s[4]!, s[7]!, s[2]!, s[5]!, s[8]!]);
    if (!I) singular = true;
  }
  const m = new Float64Array(12);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      let v: number;
      if (I) v = I[r * 3]! * P[c]! + I[r * 3 + 1]! * P[4 + c]! + I[r * 3 + 2]! * P[8 + c]!;
      else v = P[r * 4 + c]!;
      m[r * 4 + c] = r === 0 ? v / w : r === 1 ? v / h : v;
    }
  return { m, singular };
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
  const base = out.length;
  let qlo = Infinity, qhi = -Infinity;
  const linearQ = m[8] !== 0 || m[9] !== 0 || m[10] !== 0;
  for (let i = 0; i < count; i++) {
    const o = (start + i) * 3;
    const px = points[o]!, py = points[o + 1]!, pz = points[o + 2]!;
    const U = m[0]! * px + m[1]! * py + m[2]! * pz + m[3]!;
    const V = m[4]! * px + m[5]! * py + m[6]! * pz + m[7]!;
    const Q = m[8]! * px + m[9]! * py + m[10]! * pz + m[11]!;
    out.push(U, V, Q);
    if (Q < qlo) qlo = Q;
    if (Q > qhi) qhi = Q;
  }
  const scale = Math.abs(qhi) >= Math.abs(qlo) ? qhi : qlo;
  const mag = Math.abs(scale);
  const varying = linearQ && qhi - qlo > Q_VARYING * mag;
  const usable = varying && (qlo > 0 || qhi < 0) && Math.min(Math.abs(qlo), Math.abs(qhi)) >= Q_FLOOR * mag;
  // 면마다 정수 부분 빼기(같은 면 안에서는 같은 정수라 무늬가 이어진다)
  let umin = Infinity, vmin = Infinity;
  for (let i = base; i < out.length; i += 3) {
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
    for (let i = base; i < out.length; i += 3) {
      out[i] = out[i]! - ku * out[i + 2]!;
      out[i + 1] = out[i + 1]! - kv * out[i + 2]!;
    }
  return { flat: varying && !usable };
}
