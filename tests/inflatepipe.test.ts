/**
 * model.dat 풀기를 다른 워커에 맡기기(src/inflatepipe.ts — 49차): 풀기 워커 쪽(serveInflate)과 해석 워커 쪽(pipeInflate)을 MessageChannel로 잇고
 * 같은 스레드에서 풀 때(pumpInflate)와 같은 바이트·같은 결과(깨진 흐름은 false), 흐름 조절(읽지 않은 조각 수), 맡길 수 없을 때 같은 스레드로 돌아가기.
 * 그리고 앱 워커 길(skpFileToScene에 Blob)로 열면 맡겨 풀어도 장면이 같다.
 */
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sceneDigest } from '../scripts/sweep/probe';
import { PIPE_BLOCK, PIPE_CREDIT, pipeInflate, serveInflate, type PipePort, type PipeReply, type PipeWorker } from '../src/inflatepipe';
import { skpFileToScene, type SkpModelRead } from '../src/index';
import { pumpInflate, type InflatePump, type RangeReader } from '../src/modelstream';
import { blobSource, bytesSource } from '../src/range';
import { edge, entities, face, IDENTITY13, instance, materialXml, modelDat, skpFile, vertex } from './build';

/** 풀면 n바이트인 꽤 줄어드는 바이트(되풀이 + 섞음) */
function payload(n: number): Uint8Array {
  const b = new Uint8Array(n);
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = i % 7 === 0 ? x >>> 24 : (i >> 4) & 0xff;
  }
  return b;
}

/** 앞뒤에 다른 바이트를 둔 Blob 안의 압축된 자리 */
function inBlob(raw: Uint8Array): { reader: RangeReader; blob: Blob } {
  const comp = new Uint8Array(deflateRawSync(raw));
  const head = new Uint8Array(100).fill(7);
  const blob = new Blob([head as BlobPart, comp as BlobPart, new Uint8Array(50) as BlobPart]);
  const src = blobSource(blob);
  const reader: RangeReader = { length: comp.length, read: (a, b) => src.read(100 + a, 100 + Math.min(b, comp.length)), file: { blob, start: 100 } };
  return { reader, blob };
}

/** MessageChannel 양 끝: 한쪽은 풀기 워커(serveInflate), 다른 쪽은 해석 워커가 쥐는 손잡이 */
function fakeWorker(o: { serve?: boolean } = {}): PipeWorker & { terminated: boolean; fail(): void } {
  const { port1, port2 } = new MessageChannel();
  if (o.serve !== false) {
    serveInflate(port2 as unknown as PipePort);
    port2.start();
  }
  const errors: ((e: MessageEvent) => void)[] = [];
  const w = {
    terminated: false,
    postMessage: (m: unknown, t: Transferable[]) => port1.postMessage(m, t as never),
    addEventListener: (type: 'message' | 'error', fn: (e: MessageEvent) => void) => {
      if (type === 'error') errors.push(fn);
      else {
        port1.addEventListener('message', fn as never);
        port1.start();
      }
    },
    terminate: () => {
      w.terminated = true;
      port1.close();
      port2.close();
    },
    fail: () => errors.forEach((f) => f(new MessageEvent('error'))),
  };
  return w;
}

async function collect(pump: InflatePump, data: RangeReader | Uint8Array): Promise<{ ok: boolean; bytes: Uint8Array; sizes: number[] }> {
  const parts: Uint8Array[] = [];
  const ok = await pump(data, (c) => {
    parts.push(c.slice());
    return true;
  });
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { ok, bytes, sizes: parts.map((p) => p.length) };
}

/** 조건이 될 때까지(시간으로) 기다린다 */
async function until(f: () => boolean, ms = 5000): Promise<void> {
  const t0 = performance.now();
  while (!f() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 5));
}

describe('model.dat 풀기를 다른 워커에 맡기기', () => {
  it('파일 자리를 맡겨 풀어도 같은 스레드에서 푼 것과 같은 바이트(조각은 PIPE_BLOCK씩)', async () => {
    const raw = payload(2 * PIPE_BLOCK + 12345);
    const { reader } = inBlob(raw);
    const workers: ReturnType<typeof fakeWorker>[] = [];
    let fell = 0;
    const pump = pipeInflate(
      () => {
        const w = fakeWorker();
        workers.push(w);
        return w;
      },
      (d, f) => {
        fell++;
        return pumpInflate(d, f);
      },
    );
    const got = await collect(pump, reader);
    expect(got.ok).toBe(true);
    expect(fell).toBe(0);
    expect(workers.length).toBe(1);
    expect(workers[0]!.terminated).toBe(true);
    expect(got.sizes).toEqual([PIPE_BLOCK, PIPE_BLOCK, 12345]);
    expect(Buffer.from(got.bytes).equals(Buffer.from(raw))).toBe(true);
    const same = await collect(pumpInflate, reader);
    expect(same.ok).toBe(true);
    expect(Buffer.from(same.bytes).equals(Buffer.from(raw))).toBe(true);
  });

  it('깨진 흐름은 같은 스레드에서 풀 때처럼 false', async () => {
    const raw = payload(300_000);
    const comp = new Uint8Array(deflateRawSync(raw));
    // 첫 블록 머리를 쓰지 않는 블록 꼴(11)로
    comp[0] = comp[0]! | 0x06;
    const blob = new Blob([comp as BlobPart]);
    const src = blobSource(blob);
    const reader: RangeReader = { length: comp.length, read: (a, b) => src.read(a, Math.min(b, comp.length)), file: { blob, start: 0 } };
    const there = await collect(pumpInflate, reader);
    const piped = await collect(pipeInflate(() => fakeWorker(), pumpInflate), reader);
    expect(there.ok).toBe(false);
    expect(piped.ok).toBe(false);
  });

  it('받는 쪽이 false를 내면 멈추고 false, 던지면 그 예외 — 풀기 워커는 끈다', async () => {
    const { reader } = inBlob(payload(3 * PIPE_BLOCK));
    let w = fakeWorker();
    let n = 0;
    const stop = await pipeInflate(() => w, pumpInflate)(reader, () => ++n < 2);
    expect(stop).toBe(false);
    expect(n).toBe(2);
    expect(w.terminated).toBe(true);
    w = fakeWorker();
    const boom = new Error('읽다 멈춤');
    await expect(
      pipeInflate(() => w, pumpInflate)(reader, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(w.terminated).toBe(true);
  });

  it('맡길 수 없으면 같은 스레드에서: 파일 자리를 모름(한 버퍼)·워커 없음·띄우다 실패·조각 전에 워커가 죽음', async () => {
    const raw = payload(PIPE_BLOCK + 99);
    const { reader } = inBlob(raw);
    const comp = new Uint8Array(deflateRawSync(raw));
    let fell = 0;
    const fallback: InflatePump = (d, f) => {
      fell++;
      return pumpInflate(d, f);
    };
    let spawned = 0;
    const r1 = await collect(
      pipeInflate(() => {
        spawned++;
        return fakeWorker();
      }, fallback),
      comp,
    );
    expect([r1.ok, spawned, fell]).toEqual([true, 0, 1]);
    expect(Buffer.from(r1.bytes).equals(Buffer.from(raw))).toBe(true);
    const { file: _file, ...plain } = reader;
    expect((await collect(pipeInflate(() => fakeWorker(), fallback), plain)).ok).toBe(true);
    expect(fell).toBe(2);
    expect((await collect(pipeInflate(() => null, fallback), reader)).ok).toBe(true);
    expect(fell).toBe(3);
    const r4 = await collect(
      pipeInflate(() => {
        throw new Error('워커 없음');
      }, fallback),
      reader,
    );
    expect([r4.ok, fell]).toEqual([true, 4]);
    // 스크립트를 못 받은 워커(조각을 보내지 않고 오류)
    const dead = fakeWorker({ serve: false });
    const p = collect(pipeInflate(() => dead, fallback), reader);
    dead.fail();
    const r5 = await p;
    expect([r5.ok, fell, dead.terminated]).toEqual([true, 5, true]);
    expect(Buffer.from(r5.bytes).equals(Buffer.from(raw))).toBe(true);
  });

  it('흐름 조절: 읽었다는 알림 없이는 PIPE_CREDIT개까지만 넘긴다', async () => {
    const raw = payload((PIPE_CREDIT + 3) * PIPE_BLOCK);
    const { blob, reader } = inBlob(raw);
    const { port1, port2 } = new MessageChannel();
    serveInflate(port2 as unknown as PipePort);
    port2.start();
    const got: PipeReply[] = [];
    port1.addEventListener('message', (e) => got.push((e as MessageEvent).data as PipeReply));
    port1.start();
    port1.postMessage({ type: 'start', blob, start: 100, end: 100 + reader.length, credit: PIPE_CREDIT });
    await until(() => got.length >= PIPE_CREDIT);
    // 더 기다려도 늘지 않는다
    await new Promise((r) => setTimeout(r, 150));
    expect(got.length).toBe(PIPE_CREDIT);
    port1.postMessage({ type: 'credit', n: 2 });
    await until(() => got.length >= PIPE_CREDIT + 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(got.length).toBe(PIPE_CREDIT + 2);
    port1.postMessage({ type: 'credit', n: 10 });
    await until(() => got.some((m) => m.type === 'end'));
    expect(got.map((m) => m.type)).toEqual([...Array(PIPE_CREDIT + 3).fill('chunk'), 'end']);
    expect(got.at(-1)).toEqual({ type: 'end', ok: true });
    port1.close();
    port2.close();
  });
});

/** 정사각형 판 정의 n개가 든 2021+ 파일(model.dat를 압축) */
function plates(n: number): Uint8Array {
  const plate = (id0: number, x: number) => {
    const v = [0, 1, 2, 3].map((k) => id0 + k);
    const e = [0, 1, 2, 3].map((k) => id0 + 10 + k);
    return {
      vertices: [vertex(v[0]!, x, 0, 0), vertex(v[1]!, x + 10, 0, 0), vertex(v[2]!, x + 10, 10, 0), vertex(v[3]!, x, 10, 0)],
      edges: [edge(e[0]!, v[0]!, v[1]!), edge(e[1]!, v[1]!, v[2]!), edge(e[2]!, v[2]!, v[3]!), edge(e[3]!, v[3]!, v[0]!)],
      faces: [face(id0 + 20, [0, 0, 1, 0], [e.map((x) => [x, false] as [number, boolean])], { material: 3 })],
    };
  };
  const defs = Array.from({ length: n }, (_, k) => ({ name: `판 ${k}`, entities: entities(100 + k, plate(1000 + 100 * k, 20 * k)) }));
  const dat = modelDat({
    materials: [[3, '색']],
    fonts: [{ id: 7, face: 'Arial' }],
    definitions: defs,
    root: entities(undefined, { ...plate(10, -30), components: defs.map((_, k) => instance(200 + k, 100 + k, IDENTITY13)) }),
  });
  return skpFile(dat, { materials: [['색', materialXml('색', [200, 10, 10])]] });
}

describe('앱 워커 길(skpFileToScene)에 풀기 워커', () => {
  it('Blob으로 열면 model.dat를 풀기 워커에 맡기고, 장면은 같은 스레드에서 풀 때와 같다', async () => {
    const bytes = plates(300);
    const opts = { name: 'p.skp', outline: true, extras: true, smooth: true, streamMin: 1 } as const;
    const how: SkpModelRead[] = [];
    const want = await skpFileToScene(new Blob([bytes as BlobPart]), { ...opts, onModelRead: (h) => how.push(h) });
    let spawned = 0;
    let fell = 0;
    const inflate = pipeInflate(
      () => {
        spawned++;
        return fakeWorker();
      },
      (d, f) => {
        fell++;
        return pumpInflate(d, f);
      },
    );
    const got = await skpFileToScene(new Blob([bytes as BlobPart]), { ...opts, inflate, onModelRead: (h) => how.push(h) });
    expect(how).toEqual(['stream', 'stream']);
    expect([spawned, fell]).toEqual([1, 0]);
    expect(sceneDigest(got.scene)).toBe(sceneDigest(want.scene));
    expect(got.scene.warnings).toEqual(want.scene.warnings);
    // 파일 자리를 모르는 곳(바이트·파일 손잡이 — 훑기 도구)은 풀기 워커를 띄우지 않고 같은 스레드에서
    const plain = await skpFileToScene(bytesSource(bytes), { ...opts, inflate });
    expect([spawned, fell]).toEqual([1, 1]);
    expect(sceneDigest(plain.scene)).toBe(sceneDigest(want.scene));
  });

  it('해석 워커는 풀기 워커(inflate.worker.ts)를 풀기에 쓴다', () => {
    const src = readFileSync(new URL('../src/worker/parse.worker.ts', import.meta.url), 'utf8');
    expect(src).toContain("new Worker(new URL('./inflate.worker.ts', import.meta.url)");
    expect(src).toContain('pipeInflate(inflateWorker, pumpInflate)');
    expect(src).toMatch(/skpFileToScene\(file, \{[^\n]*, inflate \}\)/);
  });
});
