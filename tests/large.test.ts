/**
 * 큰 합성 모형: 해석이 멈추지 않고(진행 알림이 고르게 오고) 시간이 적당한지 본다.
 * 기본 시험은 작게(면 수만 개), SKP_BIG=1이면 수십만 면으로 시간을 재서 찍고 .runtime/tmp/에 파일을 쓴다(브라우저 확인용, 확인 뒤 지운다).
 * 쓰기는 tests/build.ts의 작은 도구 대신 버퍼에 바로 쓴다(수십만 면을 빨리 만들려고) — 꼴은 같다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { skpToScene } from '../src/index';
import { skpFile as writeSkpFile } from '../src/app/skpwrite';

const BIG = !!process.env.SKP_BIG;

/** 꼬리표-길이-값을 버퍼에 바로 쓰는 도구 */
class W {
  b = new Uint8Array(1 << 20);
  dv = new DataView(this.b.buffer);
  n = 0;
  private stack: number[] = [];
  ensure(k: number): void {
    if (this.n + k <= this.b.length) return;
    let size = this.b.length * 2;
    while (size < this.n + k) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.b.subarray(0, this.n));
    this.b = nb;
    this.dv = new DataView(nb.buffer);
  }
  open(tag: number): void {
    this.ensure(6);
    this.dv.setUint16(this.n, tag, true);
    this.stack.push(this.n + 2);
    this.n += 6;
  }
  close(): void {
    const at = this.stack.pop()!;
    this.dv.setUint32(at, this.n - at - 4, true);
  }
  u32v(tag: number, v: number): void {
    this.open(tag);
    this.ensure(4);
    this.dv.setUint32(this.n, v, true);
    this.n += 4;
    this.close();
  }
  u8v(tag: number, v: number): void {
    this.open(tag);
    this.ensure(1);
    this.b[this.n++] = v;
    this.close();
  }
  f64v(tag: number, ...vs: number[]): void {
    this.open(tag);
    this.ensure(8 * vs.length);
    for (const v of vs) {
      this.dv.setFloat64(this.n, v, true);
      this.n += 8;
    }
    this.close();
  }
  str(tag: number, s: string): void {
    const e = new TextEncoder().encode(s);
    this.open(tag);
    this.ensure(e.length);
    this.b.set(e, this.n);
    this.n += e.length;
    this.close();
  }
  idBox(id: number): void {
    this.open(0x05dc);
    this.u32v(0x05de, id);
    this.close();
  }
  base(id: number | undefined): void {
    this.open(0x07d0);
    if (id !== undefined) this.idBox(id);
    this.u8v(0x07d3, 6);
    this.close();
  }
  done(): Uint8Array {
    return this.b.slice(0, this.n);
  }
}

/** 정사각형 n개(가로 cols줄)를 쓴 요소 묶음 + 인스턴스 */
function writeEntities(w: W, defId: number | undefined, n: number, cols: number, size: number, instances: { def: number; x: number; y: number; name: string; group: boolean }[] = []): void {
  w.open(0x1388);
  w.base(defId);
  let id = 1;
  const at = (k: number): [number, number] => [(k % cols) * size * 1.25, Math.floor(k / cols) * size * 1.25];
  w.open(0x1389);
  for (let k = 0; k < n; k++) {
    const [x, y] = at(k);
    const pts = [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ];
    for (let v = 0; v < 4; v++) {
      w.open(0x09c4);
      w.idBox(id + v);
      w.f64v(0x09c5, pts[v]![0]!, pts[v]![1]!, 0);
      w.close();
    }
    id += 9;
  }
  w.close();
  w.open(0x138a);
  id = 1;
  for (let k = 0; k < n; k++) {
    for (let e = 0; e < 4; e++) {
      w.open(0x0bb8);
      w.base(id + 4 + e);
      w.u32v(0x0bb9, id + e);
      w.u32v(0x0bba, id + ((e + 1) % 4));
      w.close();
    }
    id += 9;
  }
  w.close();
  w.open(0x138b);
  id = 1;
  for (let k = 0; k < n; k++) {
    w.open(0x0dac);
    w.base(id + 8);
    w.f64v(0x0dad, 0, 0, 1, 0);
    w.open(0x0dae);
    w.open(0x1194);
    w.open(0x1195);
    for (let e = 0; e < 4; e++) {
      w.open(0x0fa0);
      w.u32v(0x0fa1, id + 4 + e);
      w.u8v(0x0fa2, 0);
      w.close();
    }
    w.close();
    w.close();
    w.close();
    w.close();
    id += 9;
  }
  w.close();
  const groups = instances.filter((i) => i.group);
  const comps = instances.filter((i) => !i.group);
  const inst = (i: (typeof instances)[number], k: number): void => {
    w.open(0x1964);
    w.base(9_000_000 + k);
    w.str(0x1965, i.name);
    w.f64v(0x1966, 1, 0, 0, 0, 1, 0, 0, 0, 1, i.x, i.y, 0, 1);
    w.u32v(0x1967, i.def);
    w.close();
  };
  if (groups.length) {
    w.open(0x138c);
    groups.forEach(inst);
    w.close();
  }
  if (comps.length) {
    w.open(0x138d);
    comps.forEach((c, k) => {
      w.open(0x1d4c);
      inst(c, k + groups.length);
      w.close();
    });
    w.close();
  }
  w.close();
}

/** model.dat: defs = [정의 번호, 면 수, 인스턴스]… 뿌리는 바로 놓인 면 rootFaces개 + 인스턴스 */
function bigModel(rootFaces: number, defs: { id: number; faces: number; instances?: { def: number; x: number; y: number; name: string; group: boolean }[] }[], rootInst: { def: number; x: number; y: number; name: string; group: boolean }[]): Uint8Array {
  const w = new W();
  w.open(0x01f4);
  w.str(0x020a, 'meta/meta.dat');
  w.open(0x01f8);
  w.open(0x3a98);
  w.open(0x3a99);
  w.open(0x3c8c);
  w.idBox(1);
  w.str(0x3c8d, 'Layer0');
  w.close();
  w.close();
  w.u32v(0x3a9a, 1);
  w.close();
  w.close();
  w.open(0x01f9);
  w.open(0x1770);
  w.open(0x1771);
  for (const d of defs) {
    w.open(0x157c);
    writeEntities(w, d.id, d.faces, Math.ceil(Math.sqrt(d.faces)), 10, d.instances);
    w.str(0x157e, `정의 ${d.id}`);
    w.close();
  }
  w.close();
  w.close();
  w.close();
  w.open(0x01f6);
  writeEntities(w, undefined, rootFaces, Math.ceil(Math.sqrt(Math.max(1, rootFaces))), 10, rootInst);
  w.close();
  w.close();
  return w.done();
}

const deflate = (d: Uint8Array): Uint8Array => new Uint8Array(deflateRawSync(d, { level: 1 }));

function measure(label: string, file: Uint8Array): { ms: number; progress: number; maxGap: number; faces: number; triangles: number } {
  const marks: number[] = [];
  const t0 = performance.now();
  const s = skpToScene(file, { outline: true, extras: true, onProgress: () => marks.push(performance.now()) });
  const ms = performance.now() - t0;
  let maxGap = 0;
  let prev = t0;
  for (const m of marks) {
    maxGap = Math.max(maxGap, m - prev);
    prev = m;
  }
  maxGap = Math.max(maxGap, performance.now() - prev);
  const out = { ms: Math.round(ms), progress: marks.length, maxGap: Math.round(maxGap), faces: s.meta!.faces as number, triangles: s.meta!.triangles as number };
  if (BIG) console.log(label, JSON.stringify({ ...out, fileMB: +(file.length / 1048576).toFixed(1), meshes: s.meshes.length, lines: s.lines.length, warnings: s.warnings }));
  return out;
}

describe('큰 합성 모형', () => {
  it('바로 놓인 면이 많아도 진행 알림이 고르게 오고 끝난다', () => {
    const faces = BIG ? 200_000 : 20_000;
    const model = bigModel(faces, [], []);
    const file = writeSkpFile(model, { compress: deflate });
    if (BIG) {
      mkdirSync('.runtime/tmp', { recursive: true });
      writeFileSync('.runtime/tmp/big-root.skp', file);
    }
    const r = measure('바로 놓인 면', file);
    expect(r.faces).toBe(faces);
    expect(r.triangles).toBe(faces * 2);
    expect(r.progress).toBeGreaterThan(10);
    // 진행 알림 사이가 길게 비지 않는다(멈춘 듯 보이지 않게) — 부하가 높은 시험 기계를 생각해 넉넉히
    expect(r.maxGap).toBeLessThan(BIG ? 8000 : 4000);
  });

  it('인스턴스로 불어난 면(정의 하나를 여러 번)', () => {
    const per = BIG ? 2000 : 400;
    const count = BIG ? 250 : 50;
    const defs = [
      { id: 500, faces: per },
      { id: 600, faces: 0, instances: [{ def: 500, x: 0, y: 0, name: '판들', group: false }] },
    ];
    const rootInst = Array.from({ length: count }, (_, k) => ({ def: 600, x: (k % 20) * 800, y: Math.floor(k / 20) * 800, name: `묶음 ${k}`, group: true }));
    const file = writeSkpFile(bigModel(0, defs, rootInst), { compress: deflate });
    if (BIG) writeFileSync('.runtime/tmp/big-inst.skp', file);
    const r = measure('인스턴스', file);
    expect(r.triangles).toBe(per * count * 2);
    expect(r.progress).toBeGreaterThan(5);
  });
});
