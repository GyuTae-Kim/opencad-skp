/**
 * 면·모서리 고르기(순수 함수, DOM 없음): SketchUp에서 면 하나를 누르면 넓이, 모서리를 누르면 길이(곡선이면 곡선 전체)를 보이는 것과 같게.
 *
 * 해석기가 meta.faceRuns(그물마다 면 경계 — 면 k의 삼각형은 [runs[k], runs[k + 1]))와 meta.segmentCurves(모서리 묶음마다
 * 선분의 놓인 곡선 번호)를 적는다. 고른 삼각형(Pick3d.raw)이 든 면을 이분 찾기로 찾고, 넓이·법선·가운데는 그 삼각형들을
 * 세계 좌표(묶음 원점·변환 포함)로 옮겨 잰다. 곡선은 같은 번호의 선분을 모아 길이를 더하고, 점들이 한 원 위에 있으면 반지름도 잰다.
 */
import type { IndexRange, LineSet3d, Mesh3d, Scene3d } from 'opencad-viewer3d';

type V3 = [number, number, number];

/** meta.faceRuns·segmentCurves(장면 차례와 길이가 맞는 것만, 아니면 그 칸은 null) */
export interface FaceIndex {
  faceRuns: (Uint32Array | null)[];
  segmentCurves: (Int32Array | null)[];
}

export function readFaceIndex(scene: Scene3d): FaceIndex {
  const m = (scene.meta ?? {}) as Record<string, unknown>;
  const runs = Array.isArray(m.faceRuns) ? m.faceRuns : [];
  const curves = Array.isArray(m.segmentCurves) ? m.segmentCurves : [];
  return {
    faceRuns: scene.meshes.map((mesh, i) => {
      const r = runs[i];
      return r instanceof Uint32Array && r.length && r[0] === 0 && r[r.length - 1]! < triangleCount(mesh) ? r : null;
    }),
    segmentCurves: scene.lines.map((l, i) => {
      const c = curves[i];
      return c instanceof Int32Array && c.length === l.positions.length / 6 ? c : null;
    }),
  };
}

export function triangleCount(m: Mesh3d): number {
  return Math.floor((m.indices ? m.indices.length : m.positions.length / 3) / 3);
}

/** 고른 삼각형 → 그 면의 삼각형 구간(면 차례 face, [start, start + count)). 경계가 없거나 범위 밖이면 null */
export function faceOfTriangle(runs: Uint32Array | null, tri: number, triangles: number): { face: number; start: number; count: number } | null {
  if (!runs || !runs.length || !(tri >= 0) || tri >= triangles) return null;
  // runs[k] ≤ tri < runs[k + 1]인 가장 큰 k
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid]! <= tri) lo = mid;
    else hi = mid - 1;
  }
  const start = runs[lo]!;
  const end = lo + 1 < runs.length ? runs[lo + 1]! : triangles;
  return end > start ? { face: lo, start, count: end - start } : null;
}

/** 그물 정점 i의 세계 좌표(묶음 원점 + 변환) */
function worldPoint(m: Mesh3d, i: number): V3 {
  const p = m.positions;
  const o = m.origin;
  let x = p[3 * i]! + (o ? o[0] : 0);
  let y = p[3 * i + 1]! + (o ? o[1] : 0);
  let z = p[3 * i + 2]! + (o ? o[2] : 0);
  const t = m.matrix;
  if (t) {
    const w = t[3]! * x + t[7]! * y + t[11]! * z + t[15]!;
    const X = t[0]! * x + t[4]! * y + t[8]! * z + t[12]!;
    const Y = t[1]! * x + t[5]! * y + t[9]! * z + t[13]!;
    const Z = t[2]! * x + t[6]! * y + t[10]! * z + t[14]!;
    const k = w && Number.isFinite(w) ? 1 / w : 1;
    x = X * k;
    y = Y * k;
    z = Z * k;
  }
  return [x, y, z];
}

export interface FaceGeometry {
  /** 넓이(장면 단위²) */
  area: number;
  /** 단위 법선(세계, 넓이 가중 — 0이면 [0, 0, 0]) */
  normal: V3;
  /** 넓이 가중 가운데(세계) */
  center: V3;
}

/** 그물의 삼각형 구간 → 넓이·법선·가운데(세계 좌표) */
export function faceGeometry(m: Mesh3d, start: number, count: number): FaceGeometry {
  const idx = m.indices;
  let area = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = triangleCount(m);
  for (let t = Math.max(0, start); t < Math.min(n, start + count); t++) {
    const a = worldPoint(m, idx ? idx[3 * t]! : 3 * t);
    const b = worldPoint(m, idx ? idx[3 * t + 1]! : 3 * t + 1);
    const c = worldPoint(m, idx ? idx[3 * t + 2]! : 3 * t + 2);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let x = uy * vz - uz * vy;
    let y = uz * vx - ux * vz;
    let z = ux * vy - uy * vx;
    const s = Math.hypot(x, y, z) / 2;
    if (!Number.isFinite(s)) continue;
    // 한 면이라 모두 한 평면이다 — 삼각형 방향이 섞여도 법선이 지워지지 않게 앞에 모은 쪽으로 맞춘다
    if (nx * x + ny * y + nz * z < 0) {
      x = -x;
      y = -y;
      z = -z;
    }
    nx += x;
    ny += y;
    nz += z;
    area += s;
    cx += ((a[0] + b[0] + c[0]) / 3) * s;
    cy += ((a[1] + b[1] + c[1]) / 3) * s;
    cz += ((a[2] + b[2] + c[2]) / 3) * s;
  }
  const l = Math.hypot(nx, ny, nz);
  return {
    area,
    normal: l > 0 ? [nx / l + 0, ny / l + 0, nz / l + 0] : [0, 0, 0],
    center: area > 0 ? [cx / area, cy / area, cz / area] : [0, 0, 0],
  };
}

/** 선분 i의 두 끝(세계) */
function segmentPoints(l: LineSet3d, i: number): [V3, V3] {
  const p = l.positions;
  const o = l.origin ?? [0, 0, 0];
  return [
    [p[6 * i]! + o[0], p[6 * i + 1]! + o[1], p[6 * i + 2]! + o[2]],
    [p[6 * i + 3]! + o[0], p[6 * i + 4]! + o[1], p[6 * i + 5]! + o[2]],
  ];
}

export interface EdgeGeometry {
  /** 고른 선분(곡선이면 그 곡선의 모든 선분) — 선분 번호 구간 */
  ranges: IndexRange[];
  /** 선분 수 */
  segments: number;
  /** 길이 합(장면 단위) */
  length: number;
  /** 곡선(호·원·곡선)의 선분인지 */
  curve: boolean;
  /** 끝이 처음으로 돌아오는 곡선(원 등) */
  closed: boolean;
  /** 점들이 한 원 위에 있으면 반지름(장면 단위), 아니면 null */
  radius: number | null;
  /** 그 원의 가운데(세계, 반지름이 있을 때만) — 측정 도구의 "중심" 추정 */
  center: V3 | null;
}

/** 선분 번호 목록 → 이어진 구간 */
function toRanges(list: number[]): IndexRange[] {
  const out: IndexRange[] = [];
  for (const i of list) {
    const last = out[out.length - 1];
    if (last && last.start + last.count === i) last.count++;
    else out.push({ start: i, count: 1 });
  }
  return out;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 세 점의 외접원(가운데·반지름). 거의 한 직선이면 null */
export function circumcircle(a: V3, b: V3, c: V3): { center: V3; radius: number } | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  const scale = Math.max(dot(ab, ab), dot(ac, ac));
  if (!(nn > 1e-12 * scale * scale)) return null;
  // 가운데 = a + ((|ac|²)(n × ab) + (|ab|²)(ac × n)) / (2|n|²)
  const t1 = cross(n, ab);
  const t2 = cross(ac, n);
  const k1 = dot(ac, ac);
  const k2 = dot(ab, ab);
  const center: V3 = [a[0] + (k1 * t1[0] + k2 * t2[0]) / (2 * nn), a[1] + (k1 * t1[1] + k2 * t2[1]) / (2 * nn), a[2] + (k1 * t1[2] + k2 * t2[2]) / (2 * nn)];
  const radius = Math.hypot(...sub(a, center));
  return Number.isFinite(radius) ? { center, radius } : null;
}

/** 닫혔는지 살필 곡선 선분 수 한도(끝점끼리 모두 견준다) */
const MAX_CLOSED_CHECK = 1024;

/**
 * 고른 선분 → 모서리(곡선이면 같은 곡선 번호의 선분 전체)의 길이·구간. 곡선 점들이 한 원 위에(반지름의 0.1 % 안) 있으면 반지름.
 * curves가 없거나 그 선분이 곡선이 아니면 그 선분 하나
 */
export function edgeGeometry(l: LineSet3d, curves: Int32Array | null, seg: number): EdgeGeometry | null {
  const n = l.positions.length / 6;
  if (!(seg >= 0) || seg >= n) return null;
  const id = curves ? curves[seg]! : -1;
  const list: number[] = [];
  if (id >= 0) {
    for (let i = 0; i < n; i++) if (curves![i] === id) list.push(i);
  } else list.push(seg);
  let length = 0;
  const pts: V3[] = [];
  for (const i of list) {
    const [a, b] = segmentPoints(l, i);
    length += Math.hypot(...sub(b, a));
    pts.push(a, b);
  }
  const curve = id >= 0;
  // 닫힌 곡선: 모든 끝점에 다른 선분의 끝점이 닿는다(float32 좌표라 길이의 백만분의 일 안이면 같은 점). 선분이 아주 많으면 열린 것으로 둔다
  let closed = false;
  if (curve && list.length >= 3 && list.length <= MAX_CLOSED_CHECK) {
    const eps = Math.max(1e-9, length * 1e-6);
    closed = pts.every((p, i) => pts.some((q, j) => j !== i && (j >> 1) !== (i >> 1) && Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps && Math.abs(p[2] - q[2]) <= eps));
  }
  let radius: number | null = null;
  let center: V3 | null = null;
  if (curve && list.length >= 2) {
    const a = pts[0]!;
    const b = pts[Math.floor(pts.length / 3)]!;
    const c = pts[Math.floor((2 * pts.length) / 3)]!;
    const circ = circumcircle(a, b, c) ?? circumcircle(a, pts[1]!, pts[pts.length - 1]!);
    if (circ && pts.every((p) => Math.abs(Math.hypot(...sub(p, circ.center)) - circ.radius) <= 1e-3 * circ.radius)) {
      radius = circ.radius;
      center = circ.center;
    }
  }
  return { ranges: toRanges(list), segments: list.length, length, curve, closed, radius, center };
}

/** 범위 상자(세계) */
export interface PartBox {
  min: V3;
  max: V3;
}

/** 그물 삼각형 구간의 범위 상자(세계) — 면 하나 맞춰 보기 */
export function faceBox(m: Mesh3d, start: number, count: number): PartBox | null {
  const idx = m.indices;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const n = triangleCount(m);
  for (let t = Math.max(0, start); t < Math.min(n, start + count); t++)
    for (let c = 0; c < 3; c++) {
      const p = worldPoint(m, idx ? idx[3 * t + c]! : 3 * t + c);
      for (let k = 0; k < 3; k++) {
        if (p[k]! < lo[k]!) lo[k] = p[k]!;
        if (p[k]! > hi[k]!) hi[k] = p[k]!;
      }
    }
  return lo[0] <= hi[0] ? { min: lo, max: hi } : null;
}

/** 선분 구간들의 범위 상자(세계) — 모서리·곡선 맞춰 보기 */
export function segmentsBox(l: LineSet3d, ranges: readonly IndexRange[]): PartBox | null {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const n = l.positions.length / 6;
  for (const r of ranges)
    for (let i = Math.max(0, r.start); i < Math.min(n, r.start + r.count); i++)
      for (const p of segmentPoints(l, i))
        for (let k = 0; k < 3; k++) {
          if (p[k]! < lo[k]!) lo[k] = p[k]!;
          if (p[k]! > hi[k]!) hi[k] = p[k]!;
        }
  return lo[0] <= hi[0] ? { min: lo, max: hi } : null;
}
