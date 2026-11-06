import { afterEach, describe, expect, it, vi } from 'vitest';
import { faceAt } from '../src/entities';
import { readSkpHeader } from '../src/header';
import { skpToScene } from '../src/index';
import { MendBuffer, MIN_ODD_CR, textRoundTrip } from '../src/mfcmend';
import { readMfcModel } from '../src/mfcmodel';
import { MfcStream } from '../src/mfcstream';
import type { SkpModel } from '../src/model';
import { mfcFile, type MfcEdgeSpec, type MfcEntitiesSpec, type MfcFaceSpec, type MfcSpec, type Vec3 } from './mfcwrite';

/** 파일을 UTF-16LE 글로 읽고 줄 끝을 고른 뒤 다시 쓴 꼴: 짝수 자리 CR → LF(CRLF는 LF 하나), U+2028·U+2029는 지운다 */
function textTrip(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let p = 0; p + 1 < b.length; p += 2) {
    const u = b[p]! | (b[p + 1]! << 8);
    if (u === 0x2028 || u === 0x2029) continue;
    if (u === 0x000d) {
      if (p + 3 < b.length && b[p + 2] === 0x0a && b[p + 3] === 0) continue;
      out.push(0x0a, 0);
      continue;
    }
    out.push(b[p]!, b[p + 1]!);
  }
  if (b.length & 1) out.push(b[b.length - 1]!);
  return Uint8Array.from(out);
}

const f64 = (...v: number[]): Uint8Array => new Uint8Array(Float64Array.from(v).buffer);

function indexOfBytes(b: Uint8Array, pat: Uint8Array): number {
  outer: for (let i = 0; i + pat.length <= b.length; i++) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

/** n×n 칸의 기울어진 땅(칸마다 삼각형 둘 — 면 법선이 여러 방향이라 정점 x가 틀리면 면 평면에서 벗어난다). move로 정점 하나를 옮길 수 있다 */
function terrain(n: number, move?: { at: number; x: number }, flatPlane?: number): MfcEntitiesSpec {
  const V: Vec3[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V.push([i * 3, j * 3, ((i * 7 + j * 3) % 5) * 0.4]);
  if (move) V[move.at]![0] = move.x;
  const edges: MfcEdgeSpec[] = [];
  const key = new Map<string, number>();
  const use = (a: number, b: number): [number, boolean] => {
    const k = `${Math.min(a, b)},${Math.max(a, b)}`;
    let e = key.get(k);
    if (e === undefined) {
      e = edges.length;
      edges.push({ a: Math.min(a, b), b: Math.max(a, b) });
      key.set(k, e);
    }
    return [e, a > b];
  };
  const faces: MfcFaceSpec[] = [];
  const tri = (a: number, b: number, c: number): void => {
    const [p, q, r] = [V[a]!, V[b]!, V[c]!];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let nx = u[1]! * v[2]! - u[2]! * v[1]!;
    let ny = u[2]! * v[0]! - u[0]! * v[2]!;
    let nz = u[0]! * v[1]! - u[1]! * v[0]!;
    const l = Math.hypot(nx, ny, nz);
    [nx, ny, nz] = [nx / l, ny / l, nz / l];
    faces.push({ plane: [nx, ny, nz, -(nx * p[0] + ny * p[1] + nz * p[2])], loops: [{ uses: [use(a, b), use(b, c), use(c, a)] }] });
  };
  const id = (i: number, j: number): number => j * (n + 1) + i;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      tri(id(i, j), id(i + 1, j), id(i + 1, j + 1));
      tri(id(i, j), id(i + 1, j + 1), id(i, j + 1));
    }
  // 저장된 평면이 정점과 맞지 않는 면(같은 길이로 바뀐 참조로 정점이 틀린 것 흉내): 기울어진 삼각형에 바닥 평면을 적는다
  if (flatPlane !== undefined) faces[flatPlane]!.plane = [0, 0, 1, 0];
  return { vertices: V, edges, faces };
}

/** 모형 설명에 홀수 자리 CR(0D 00) 낱자를 넣는다(앞 pad로 짝·홀을, 뒤 tail로 그 뒤 바이트의 자리를 1씩 옮긴다) */
const crDescription = (pad: number, tail: number): string => 'x'.repeat(pad) + '\r\0'.repeat(MIN_ODD_CR + 4) + 'y'.repeat(tail);

/** 설명의 CR 낱자가 홀수 자리에 오고 check가 맞는 파일(앞·뒤 덧붙임을 바꿔 가며) */
function buildAligned(spec: (desc: string) => MfcSpec, check: (b: Uint8Array) => boolean = () => true): Uint8Array {
  for (const tail of [0, 1])
    for (const pad of [0, 1]) {
      const bytes = mfcFile(spec(crDescription(pad, tail)));
      const at = indexOfBytes(bytes, Uint8Array.from([0x0d, 0, 0x0d, 0, 0x0d, 0, 0x0d, 0]));
      if (at >= 0 && at & 1 && textRoundTrip(textTrip(bytes)) && check(bytes)) return bytes;
    }
  throw new Error('자리를 맞추지 못함');
}

const readM = (bytes: Uint8Array): SkpModel => readMfcModel(bytes, readSkpHeader(bytes)!).model;

/** 형상 비교용: 묶음마다 면(정점 좌표 차례) */
function faceCoords(m: SkpModel): number[][][] {
  const ents = [m.root, ...[...m.definitions.values()].map((d) => d.entities)];
  return ents.map((e) => {
    const out: number[][] = [];
    for (let i = 0; i < e.faces.length; i++) {
      const f = faceAt(e.faces, i);
      out.push(f.loops.flat().flatMap((v) => [e.points[3 * v]!, e.points[3 * v + 1]!, e.points[3 * v + 2]!]));
    }
    return out;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('글 왕복 손상 알아보기(textRoundTrip)', () => {
  it('짝수 자리 CR·U+2028·U+2029가 없고 홀수 자리 CR이 MIN_ODD_CR개 이상일 때만', () => {
    const b = new Uint8Array(4 * MIN_ODD_CR + 8);
    for (let i = 0; i < MIN_ODD_CR; i++) b.set([0x0d, 0], 1 + 4 * i);
    expect(textRoundTrip(b)).toMatchObject({ oddCr: MIN_ODD_CR });
    // 홀수 자리 CR이 하나 모자라면 근거가 모자라다
    const few = b.slice();
    few[1] = 0x41;
    expect(textRoundTrip(few)).toBeNull();
    // 짝수 자리 CR이나 U+2028·U+2029가 하나라도 있으면 글 왕복을 거치지 않은 것
    for (const unit of [[0x0d, 0], [0x28, 0x20], [0x29, 0x20]]) {
      const even = b.slice();
      even.set(unit, b.length - 4);
      expect(textRoundTrip(even)).toBeNull();
    }
  });

  it('textTrip을 거친 파일은 알아보고, 거치지 않은 보통 파일은 알아보지 않는다', () => {
    const bytes = buildAligned((description) => ({ description, root: terrain(2) }));
    expect(textRoundTrip(textTrip(bytes))).not.toBeNull();
    expect(textRoundTrip(mfcFile({ root: terrain(2) }))).toBeNull();
  });
});

describe('메우기 사본(MendBuffer)', () => {
  it('시험 넣기를 옮기고 거두고 굳히며, 사본 자리를 원래 자리로 되돌린다', () => {
    const src = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const m = new MendBuffer(src, 4);
    m.put(6, 0x2028);
    expect([...m.view()]).toEqual([0, 1, 2, 3, 4, 5, 0x28, 0x20, 6, 7]);
    m.put(2, 0x2029);
    expect([...m.view()]).toEqual([0, 1, 0x29, 0x20, 2, 3, 4, 5, 6, 7]);
    m.put(4, 0x000d);
    expect([...m.view()]).toEqual([0, 1, 2, 3, 0x0d, 0, 4, 5, 6, 7]);
    m.drop();
    expect([...m.view()]).toEqual([...src]);
    m.put(2, 0x2028);
    m.keep();
    m.put(6, 0x2029);
    m.keep();
    expect([...m.view()]).toEqual([0, 1, 0x28, 0x20, 2, 3, 0x29, 0x20, 4, 5, 6, 7]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((p) => m.toOriginal(p))).toEqual([0, 1, -1, -1, 2, 3, -1, -1, 4, 5, 6, 7]);
    // 자리가 다 차면 더 넣지 않는다
    const full = new MendBuffer(src, 1);
    full.put(0, 0x2028);
    full.keep();
    expect(full.roomLeft).toBe(false);
  });
});

describe('글 왕복 손상 고쳐 읽기', () => {
  /** 땅 n×n(정점 at의 x를 바꿀 수 있다) + 설명에 홀수 자리 CR */
  const spec = (n: number, move?: { at: number; x: number }) => (description: string): MfcSpec => ({ description, root: terrain(n, move) });

  it('정점 좌표 안에서 지워진 U+2028을 메우고, 같은 벌점의 넣을 자리가 여럿이면 면 평면으로 좌표를 고른다', () => {
    const n = 6;
    const at = 3 * (n + 1) + 3;
    // 정점 at의 x(9.0)를, 짝수 자리에 28 20이 오는 값으로 바꾼다(그 자리가 지수 쪽이라 메울 자리마다 x가 크게 달라진다)
    let bytes: Uint8Array | null = null;
    for (const tail of [0, 1])
      for (const pad of [0, 1]) {
        const desc = crDescription(pad, tail);
        const base = mfcFile(spec(n)(desc));
        const s = indexOfBytes(base, f64(9, 9, ((3 * 7 + 3 * 3) % 5) * 0.4));
        const cr = indexOfBytes(base, Uint8Array.from([0x0d, 0, 0x0d, 0, 0x0d, 0, 0x0d, 0]));
        if (s < 0 || !(cr & 1)) continue;
        const x = base.slice(s, s + 8);
        // 짝수 자리: x의 4·5바이트, 홀수 자리: x의 5·6바이트(지수 낮은 4비트가 바뀐다)
        const k = s & 1 ? 5 : 4;
        x[k] = 0x28;
        x[k + 1] = 0x20;
        const moved = new DataView(x.buffer).getFloat64(0, true);
        expect(Math.abs(moved - 9)).toBeGreaterThan(1e-3);
        bytes = mfcFile(spec(n, { at, x: moved })(desc));
        // 같은 배치(바꾼 값만 다르다)
        expect(bytes.length).toBe(base.length);
        break;
      }
    expect(bytes).not.toBeNull();
    const good = readM(bytes!);
    expect(good.warnings).toEqual([]);
    const bad = textTrip(bytes!);
    expect(bad.length).toBeLessThan(bytes!.length);
    const m = readM(bad);
    expect(m.damaged).toBe(true);
    expect(m.warnings.find((w) => w.startsWith('글로 한 번 저장되며 깨진 파일을 고쳐 읽었습니다'))).toMatch(/빠진 2바이트 1곳을 메우고 .*뺀 면 0개, 정점 0개/);
    expect(m.warnings.some((w) => w.startsWith('형상을 읽다 멈췄습니다'))).toBe(false);
    // 면 수·차례·좌표가 손상 전과 같다(메운 정점의 x도 면 평면으로 맞게 골랐다)
    const want = faceCoords(good);
    const got = faceCoords(m);
    expect(got.map((c) => c.length)).toEqual(want.map((c) => c.length));
    got.forEach((c, i) => c.forEach((f, j) => f.forEach((v, k) => expect(Math.abs(v - want[i]![j]![k]!)).toBeLessThan(1e-6))));
  });

  it('면 평면 d(그리지 않는 값) 안에서 지워진 낱자를 메우고, 장면은 손상 전과 같은 삼각형을 그린다', () => {
    const n = 5;
    const bytes = buildAligned(spec(n));
    // 넷째 면 평면의 d 바이트에서 짝수 자리 낱자를 28 20으로 바꾼다(손상 전 파일도 같은 바이트 — d는 그리기에 쓰지 않는다)
    const p = terrain(n).faces![3]!.plane;
    const s = indexOfBytes(bytes, f64(...p));
    expect(s).toBeGreaterThan(0);
    const q = s + 24 + (s & 1 ? 1 : 0);
    const planted = bytes.slice();
    planted[q] = 0x28;
    planted[q + 1] = 0x20;
    const good = readM(planted);
    expect(good.warnings).toEqual([]);
    const bad = textTrip(planted);
    const m = readM(bad);
    expect(m.warnings.some((w) => w.startsWith('글로 한 번 저장되며'))).toBe(true);
    expect(faceCoords(m)).toEqual(faceCoords(good));
    const tri = (b: Uint8Array): number => skpToScene(b).meshes.reduce((k, mesh) => k + (mesh.indices?.length ?? 0) / 3, 0);
    expect(tri(bad)).toBe(tri(planted));
  });

  it('고쳐 읽은 파일에서는 저장된 평면과 0.01인치 넘게 어긋난 면을 그리지 않는다(보통 읽기는 그대로 그림)', () => {
    const n = 5;
    const bytes = buildAligned((description) => ({ description, root: terrain(n, undefined, 0) }));
    const s = indexOfBytes(bytes, f64(...terrain(n).faces![3]!.plane));
    const q = s + 24 + (s & 1 ? 1 : 0);
    const planted = bytes.slice();
    planted[q] = 0x28;
    planted[q + 1] = 0x20;
    const good = readM(planted);
    const m = readM(textTrip(planted));
    expect(good.root.faces.length).toBe(2 * n * n);
    expect(m.root.faces.length).toBe(2 * n * n - 1);
    expect(m.warnings.find((w) => w.startsWith('글로 한 번 저장되며'))).toContain('뺀 면 1개, 정점 0개');
    // 뺀 것은 바닥 평면을 적은 첫 면뿐
    expect(faceCoords(m)[0]).toEqual(faceCoords(good)[0]!.slice(1));
  });

  it('요소 수의 LF를 CR로 되돌려 남은 요소를 마저 읽는다(0x0D개 → 0x0A개로 줄어든 목록)', () => {
    // 정의 하나에 모서리 13개(요소 13 = 0D 00 00 00). 그 수가 짝수 자리에 오게 맞춘다
    const chain = (): MfcEntitiesSpec => ({
      vertices: Array.from({ length: 14 }, (_, i): Vec3 => [i, (i * i) % 3, 0]),
      edges: Array.from({ length: 13 }, (_, i) => ({ a: i, b: i + 1 })),
    });
    let countAt = -1;
    const find = (b: Uint8Array): boolean => {
      const spy = vi.spyOn(MfcStream.prototype, 'count');
      countAt = -1;
      spy.mockImplementation(function (this: MfcStream, limit: number, what: string) {
        const at = this.pos;
        const v = this.u32();
        if (what === '요소' && v === 13) countAt = at;
        if (v > limit || v > this.end - this.pos) throw new Error('count');
        return v;
      });
      try {
        readM(b);
      } finally {
        spy.mockRestore();
      }
      return countAt >= 0 && !(countAt & 1);
    };
    const bytes = buildAligned((description) => ({ description, definitions: [{ name: '사슬', entities: chain() }], root: terrain(3) }), find);
    const good = readM(bytes);
    expect(good.definitions.get(0)!.entities.edges.length).toBe(13);
    const bad = textTrip(bytes);
    expect(bad[countAt]).toBe(0x0a);
    const m = readM(bad);
    expect(m.definitions.get(0)!.entities.edges.length).toBe(13);
    expect(faceCoords(m)).toEqual(faceCoords(good));
    expect(m.warnings.some((w) => w.startsWith('글로 한 번 저장되며'))).toBe(true);
  });

  it('글 왕복 꼴이 아닌 깨진 파일은 예전처럼 멈춘 자리까지만 읽는다(두 번째 읽기 없음)', () => {
    const bytes = mfcFile({ root: terrain(4) });
    // 가운데 정점 하나의 좌표에서 2바이트를 지운다(CR 근거가 없는 파일)
    const s = indexOfBytes(bytes, f64(6, 6));
    const cut = Uint8Array.from([...bytes.subarray(0, s + 2), ...bytes.subarray(s + 4)]);
    const spy = vi.spyOn(MfcStream.prototype, 'useBuffer');
    const m = readM(cut);
    expect(spy).not.toHaveBeenCalled();
    expect(m.warnings.some((w) => w.startsWith('형상을 읽다 멈췄습니다'))).toBe(true);
    expect(m.warnings.some((w) => w.startsWith('글로 한 번 저장되며'))).toBe(false);
  });
});
