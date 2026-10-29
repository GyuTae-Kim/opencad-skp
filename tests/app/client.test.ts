/**
 * 해석 워커 손님(src/app/client.ts): 파일(Blob)을 복사·이전 없이 넘기고, 결과 뒤에 오는 파일 내용 지문을 결과에 붙인 약속(print)으로
 * 한 번 알린다(지문을 못 구했거나 멈추거나 워커가 죽으면 null). 가짜 Worker로 메시지 차례를 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParseClient } from '../../src/app/client';
import type { ParseRequest, ParseResult } from '../../src/app/protocol';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  posted: { msg: ParseRequest; transfer: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: ParseRequest, transfer?: unknown): void {
    this.posted.push({ msg, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const result = (): ParseResult => ({ scene: { name: 's', units: 'mm', meshes: [], lines: [] }, ms: 1 });

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ParseClient', () => {
  it('Blob을 그대로 넘기고(이전 목록 없음) 결과에 뒤따라 오는 지문의 약속을 붙인다', async () => {
    const c = new ParseClient();
    const file = new Blob([new Uint8Array([1, 2, 3])]);
    const stages: string[] = [];
    const p = c.open('a.skp', file, (_f, s) => stages.push(s), { textureLimit: 1024 });
    const w = FakeWorker.all[0]!;
    expect(w.posted).toHaveLength(1);
    const { msg, transfer } = w.posted[0]!;
    expect(msg).toMatchObject({ type: 'open', name: 'a.skp', textureLimit: 1024 });
    expect(msg.file).toBe(file);
    expect(transfer).toBeUndefined();
    w.emit({ id: msg.id, type: 'progress', fraction: 0.5, stage: '읽는 중' });
    w.emit({ id: msg.id, type: 'done', result: result() });
    const r = await p;
    expect(r.ms).toBe(1);
    expect(stages).toEqual(['읽는 중']);
    let got: ArrayBuffer | null | undefined;
    void r.print!.then((d) => (got = d));
    await Promise.resolve();
    expect(got).toBeUndefined();
    const d = new Uint8Array(32).fill(7).buffer;
    w.emit({ id: msg.id, type: 'print', digest: d });
    w.emit({ id: msg.id, type: 'print', digest: null });
    expect(await r.print).toBe(d);
    // 결과를 기다리는 요청이 없으면 멈추기는 워커를 끝내지 않는다(앞 파일 지문을 구하던 중일 수 있다)
    c.cancel();
    expect(w.terminated).toBe(false);
  });

  it('지문을 못 구했으면 null, 해석이 실패하면 약속이 없다', async () => {
    const c = new ParseClient();
    const p = c.open('a.skp', new Blob([]));
    const w = FakeWorker.all[0]!;
    w.emit({ id: w.posted[0]!.msg.id, type: 'error', message: '깨짐' });
    await expect(p).rejects.toThrow('깨짐');
    const q = c.open('b.skp', new Blob([]));
    const id = w.posted[1]!.msg.id;
    w.emit({ id, type: 'done', result: result() });
    const r = await q;
    w.emit({ id, type: 'print', digest: null });
    expect(await r.print).toBeNull();
  });

  it('멈추거나 워커가 죽으면 기다리던 지문은 null(결과를 받은 뒤라도)', async () => {
    const c = new ParseClient();
    const a = c.open('a.skp', new Blob([]));
    const w = FakeWorker.all[0]!;
    w.emit({ id: w.posted[0]!.msg.id, type: 'done', result: result() });
    const ra = await a;
    const b = c.open('b.skp', new Blob([]));
    c.cancel();
    await expect(b).rejects.toThrow();
    expect(w.terminated).toBe(true);
    expect(await ra.print).toBeNull();
    // 다음 열기는 새 워커
    const n = c.open('c.skp', new Blob([]));
    const w2 = FakeWorker.all[1]!;
    w2.emit({ id: w2.posted[0]!.msg.id, type: 'done', result: result() });
    const rn = await n;
    w2.onerror?.({ message: '메모리', preventDefault: () => undefined } as unknown as ErrorEvent);
    expect(await rn.print).toBeNull();
  });
});
