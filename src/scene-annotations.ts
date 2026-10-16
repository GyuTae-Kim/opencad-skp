/**
 * 주석(치수·지시선·보조선·단면 기호)을 세계 선분으로 그리는 순수 함수들. scene.ts가 배치마다 변환을 곱한 점으로 부른다.
 *
 * 치수선 배치는 PRISME 뷰어(dimensionGeometry)와 같다:
 *   A = S + offset, B = (잰 축이 있으면) A + u·((E−S)·u), 아니면 E + offset. 잰 값 = |(E−S)·u|(축이 없으면 |E−S|).
 *   연장선 S→A·E→B(길이가 있을 때만)는 치수선 너머로 조금 더 긋는다.
 * 뷰어는 끝 표시·연장선 넘침을 화면 크기(9·6 화소)로 그리지만, 장면 선분은 세계 좌표라 크기(mark)를 세계 길이로 받는다.
 * 끝 표시 꼴(빗금·점·열린·닫힌 화살표)도 뷰어를 따랐다(화살 날개 ±20°, 닫힌 화살은 밑변과 채움선 몇 개).
 */
import type { Vec3 } from './meta';

export type Arrow = 'none' | 'slash' | 'dot' | 'closed' | 'open';

export const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const mulS = (a: readonly number[], s: number): Vec3 => [a[0]! * s, a[1]! * s, a[2]! * s];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
export const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
/** 단위 벡터(길이가 0이거나 비유한이면 null) */
export function unit(a: readonly number[]): Vec3 | null {
  const l = len(a);
  return l > 1e-12 && Number.isFinite(l) ? [a[0]! / l, a[1]! / l, a[2]! / l] : null;
}
export const isVec = (v: readonly number[] | undefined): v is Vec3 =>
  !!v && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/** d(단위)에 수직인 단위 벡터 하나 — ref(단위, 선택)가 있으면 그 쪽으로 */
export function perpendicular(d: Vec3, ref?: Vec3 | null): Vec3 {
  if (ref) {
    const p = unit(sub(ref, mulS(d, dot(ref, d))));
    if (p) return p;
  }
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  const axis: Vec3 = az <= ax && az <= ay ? [0, 0, 1] : ay <= ax ? [0, 1, 0] : [1, 0, 0];
  return unit(cross(cross(d, axis), d)) ?? [0, 0, 1];
}

/** 선분 하나를 쌓는다 */
export function seg(out: number[], a: readonly number[], b: readonly number[]): void {
  out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
}

export interface LinearLayout {
  a: Vec3;
  b: Vec3;
  extA: [Vec3, Vec3] | null;
  extB: [Vec3, Vec3] | null;
  value: number;
}

/** 선형 치수 배치(세계): S·E 끝점, off 띄움 벡터, axis 잰 축(단위) */
export function linearLayout(S: Vec3, E: Vec3, off: Vec3 | null, axis: Vec3 | null): LinearLayout {
  const a = off ? add(S, off) : S;
  const along = axis ? dot(sub(E, S), axis) : 0;
  const b = axis ? add(a, mulS(axis, along)) : off ? add(E, off) : E;
  const value = axis ? Math.abs(along) : len(sub(E, S));
  return { a, b, extA: len(sub(a, S)) > 1e-9 ? [S, a] : null, extB: len(sub(b, E)) > 1e-9 ? [E, b] : null, value };
}

/**
 * 끝 표시 하나(세계 선분). p 끝점, dir = 그 끝을 향하는(바깥쪽) 선 방향(단위), perp = 치수 평면에서 선에 수직(단위), size = 표시 크기
 */
export function endMark(out: number[], p: Vec3, dir: Vec3, perp: Vec3, kind: Arrow | undefined, size: number): void {
  if (!kind || kind === 'none' || !(size > 0)) return;
  if (kind === 'slash') {
    // 선과 45°, 두 끝 모두 같은 쪽으로("/")
    const s = unit(add(dir, perp));
    if (!s) return;
    seg(out, add(p, mulS(s, -size / 2)), add(p, mulS(s, size / 2)));
    return;
  }
  if (kind === 'dot') {
    // 작은 팔각형
    const r = size * 0.18;
    let prev: Vec3 | null = null;
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      const q = add(p, add(mulS(dir, Math.cos(t) * r), mulS(perp, Math.sin(t) * r)));
      if (prev) seg(out, prev, q);
      prev = q;
    }
    return;
  }
  // 화살: 끝점에서 안쪽으로 ±20° 날개
  const c = Math.cos((20 * Math.PI) / 180);
  const s = Math.sin((20 * Math.PI) / 180);
  const l = size * 1.1;
  const tipA = add(p, mulS(add(mulS(dir, -c), mulS(perp, s)), l));
  const tipB = add(p, mulS(add(mulS(dir, -c), mulS(perp, -s)), l));
  seg(out, p, tipA);
  seg(out, p, tipB);
  if (kind === 'closed') {
    seg(out, tipA, tipB);
    for (const t of [0.2, 0.4, 0.6, 0.8]) seg(out, p, add(mulS(tipA, 1 - t), mulS(tipB, t)));
  }
}

/** 선형 치수 선분: 치수선 + 연장선(넘침 over) + 두 끝 표시 */
export function linearSegments(out: number[], L: LinearLayout, perp: Vec3, arrow: Arrow | undefined, mark: number): void {
  seg(out, L.a, L.b);
  const over = mark * 0.6;
  for (const ext of [L.extA, L.extB]) {
    if (!ext) continue;
    const d = unit(sub(ext[1], ext[0]));
    seg(out, ext[0], d ? add(ext[1], mulS(d, over)) : ext[1]);
  }
  const d = unit(sub(L.b, L.a));
  if (!d) return;
  endMark(out, L.a, mulS(d, -1), perp, arrow, mark);
  endMark(out, L.b, d, perp, arrow, mark);
}

/** 선 P + t·d를 상자에 맞춰 자른 [t0, t1]. 상자를 지나지 않으면 null */
export function clipLine(P: Vec3, d: Vec3, min: readonly number[], max: readonly number[]): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const p = P[i]!;
    const v = d[i]!;
    if (Math.abs(v) < 1e-15) {
      if (p < min[i]! || p > max[i]!) return null;
      continue;
    }
    let a = (min[i]! - p) / v;
    let b = (max[i]! - p) / v;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return Number.isFinite(t0) && Number.isFinite(t1) ? [t0, t1] : null;
}

/** 열 우선 4×4의 실제 3×3 열(이동 없는 아핀 변환이 나눔수 m[15]를 가지면 그만큼 나눈다) */
export function linearColumns(m: ArrayLike<number>): [Vec3, Vec3, Vec3] {
  const w = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] !== 0 && Number.isFinite(m[15]) ? m[15]! : 1;
  return [
    [m[0]! / w, m[1]! / w, m[2]! / w],
    [m[4]! / w, m[5]! / w, m[6]! / w],
    [m[8]! / w, m[9]! / w, m[10]! / w],
  ];
}

/** 3×3 여인수 행렬 열(k0 = c1×c2, k1 = c2×c0, k2 = c0×c1 = det·M⁻ᵀ)과 행렬식 */
export function cofactor(m: ArrayLike<number>): { k: Float64Array; det: number } {
  const [c0, c1, c2] = linearColumns(m);
  const k0 = cross(c1, c2);
  const k1 = cross(c2, c0);
  const k2 = cross(c0, c1);
  return { k: Float64Array.of(...k0, ...k1, ...k2), det: dot(c0, k0) };
}

/** 열 우선 4×4로 점 옮기기(w로 나눈다) */
export function xfPoint(m: ArrayLike<number>, p: readonly number[]): Vec3 {
  const x = p[0]!;
  const y = p[1]!;
  const z = p[2]!;
  let w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!w) w = 1;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

/** 열 우선 4×4의 3×3으로 벡터 옮기기 */
export function xfVector(m: ArrayLike<number>, v: readonly number[]): Vec3 {
  const [c0, c1, c2] = linearColumns(m);
  return [c0[0] * v[0]! + c1[0] * v[1]! + c2[0] * v[2]!, c0[1] * v[0]! + c1[1] * v[1]! + c2[1] * v[2]!, c0[2] * v[0]! + c1[2] * v[1]! + c2[2] * v[2]!];
}

/** 법선 옮기기(역전치, 거울상이면 방향을 바로잡는다). 단위, 못 하면 null */
export function xfNormal(m: ArrayLike<number>, n: readonly number[]): Vec3 | null {
  const { k, det } = cofactor(m);
  const s = det < 0 ? -1 : 1;
  return unit([
    s * (k[0]! * n[0]! + k[3]! * n[1]! + k[6]! * n[2]!),
    s * (k[1]! * n[0]! + k[4]! * n[1]! + k[7]! * n[2]!),
    s * (k[2]! * n[0]! + k[5]! * n[1]! + k[8]! * n[2]!),
  ]);
}

/** 평면 a·x+b·y+c·z+d = 0(남는 쪽 ≥ 0)을 m으로 옮긴 세계 평면((a,b,c) 단위). 못 하면 null */
export function xfPlane(m: ArrayLike<number>, plane: readonly number[]): [number, number, number, number] | null {
  const n = [plane[0]!, plane[1]!, plane[2]!];
  const l2 = dot(n, n);
  if (!(l2 > 0) || !Number.isFinite(plane[3])) return null;
  const p0 = xfPoint(m, mulS(n, -plane[3]! / l2));
  const n2 = xfNormal(m, n);
  if (!n2 || !isVec(p0)) return null;
  return [n2[0], n2[1], n2[2], -dot(n2, p0)];
}

/** 단면 기호: 평면 위 center를 가운데로 한 반 크기 size의 사각형과 남는 쪽(+법선)을 가리키는 화살 둘 */
export function sectionSymbol(out: number[], center: Vec3, n: Vec3, size: number): void {
  if (!(size > 0)) return;
  const u = perpendicular(n);
  const v = cross(n, u);
  const corner = (a: number, b: number): Vec3 => add(center, add(mulS(u, a * size), mulS(v, b * size)));
  const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  for (let i = 0; i < 4; i++) seg(out, q[i]!, q[(i + 1) % 4]!);
  const shaft = size * 0.35;
  for (const side of [-1, 1]) {
    const base = add(center, mulS(u, side * size));
    const tip = add(base, mulS(n, shaft));
    seg(out, base, tip);
    endMark(out, tip, n, u, 'open', shaft * 0.35);
  }
}
