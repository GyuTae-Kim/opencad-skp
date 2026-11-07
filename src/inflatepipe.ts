/**
 * model.dat 풀기를 다른 워커에 맡기기(49차). 큰 2021+ 모형은 압축된 model.dat를 덩이씩 읽어 내장 풀기(DecompressionStream)로 풀며 읽는데
 * (src/modelstream.ts), 내장 풀기는 부른 스레드에서 돈다 — 해석 워커에서 풀기(165 MB 표본 0.35초)와 객체 읽기(1.1초)가 번갈아 돌았다.
 * 여기서는 풀기 워커(src/worker/inflate.worker.ts)가 파일(Blob)의 압축된 자리를 직접 읽어 풀고, 풀린 바이트를 PIPE_BLOCK씩 모아
 * 해석 워커로 옮겨(복사 없이) 넘긴다 — 해석 워커는 받은 조각을 읽는 동안 다음 조각이 다른 스레드에서 풀린다.
 *
 * 흐름 조절: 해석 워커가 조각 하나를 읽을 때마다 하나 더 보내도 된다고 알린다(credit). 넘긴 채 아직 읽지 않은 조각은 많아야 PIPE_CREDIT개라
 * 풀기가 앞서 달려도 풀린 바이트가 쌓이지 않는다(예전 길은 풀린 조각을 바로 읽었다 — 더 드는 것은 많아야 PIPE_CREDIT × PIPE_BLOCK).
 * 결과(받는 바이트와 차례)는 같은 스레드에서 풀 때와 같다. 풀기가 실패하면(깨진 흐름·파일을 못 읽음) false — 같은 스레드에서 풀다 실패할 때와 같다.
 * 풀기 워커를 띄우지 못했거나(워커 안 워커가 없는 곳) 조각을 하나도 받기 전에 그 워커가 죽으면 같은 스레드에서 푼다(fallback).
 */
import { inflateReader, type InflateInput, type InflatePump, type RangeReader } from './modelstream';

/** 풀기 워커가 한 번에 넘기는 풀린 바이트(마지막 조각은 덜) */
export const PIPE_BLOCK = 1 << 20;
/**
 * 넘긴 채 아직 읽지 않은 조각 수의 위 한도. 16이면 큰 정의를 읽느라 해석 워커가 멈춘 동안 더 앞서 풀어 165 MB 표본이 0.08초 더 빨랐지만
 * 82 MB 표본의 해석 워커 최고치가 그만큼(+16 MiB 안팎) 올라 4로 둔다(49차)
 */
export const PIPE_CREDIT = 4;

/** 해석 워커 → 풀기 워커 */
export type PipeRequest =
  /** 파일 blob의 [start, end)(압축된 model.dat)를 풀어 넘겨라. credit = 처음에 보내도 되는 조각 수 */
  | { type: 'start'; blob: Blob; start: number; end: number; credit: number }
  /** 조각을 더 보내도 된다 */
  | { type: 'credit'; n: number };

/** 풀기 워커 → 해석 워커 */
export type PipeReply =
  | { type: 'chunk'; bytes: Uint8Array }
  /** 다 풀었다(ok) 또는 풀기·읽기가 실패했다 */
  | { type: 'end'; ok: boolean };

/** 메시지를 주고받는 곳(Worker·워커 전역·MessagePort) */
export interface PipePort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
}

/** 풀기 워커 손잡이(띄운 Worker — 다 쓰면 끈다) */
export interface PipeWorker extends PipePort {
  addEventListener(type: 'message' | 'error', fn: (e: MessageEvent) => void): void;
  terminate(): void;
}

/** Blob의 [start, end) 바이트를 자리마다 읽어 주는 곳(src/range.ts의 RangeReader 꼴) */
function blobRange(blob: Blob, start: number, end: number): RangeReader {
  const length = Math.max(0, end - start);
  return {
    length,
    read: async (a, b) => new Uint8Array(await blob.slice(start + a, start + Math.min(b, length)).arrayBuffer()),
  };
}

/**
 * 풀기 워커 쪽: 'start'를 받으면 풀어 PIPE_BLOCK씩 넘기고, credit이 없으면 기다린다. 한 워커는 한 번만 푼다(해석 워커가 다 쓰면 끈다)
 */
export function serveInflate(port: PipePort): void {
  let credit = 0;
  let wake: (() => void) | null = null;
  let started = false;
  port.addEventListener('message', (e) => {
    const m = e.data as PipeRequest;
    if (m?.type === 'credit') {
      credit += m.n;
      wake?.();
      wake = null;
    } else if (m?.type === 'start' && !started) {
      started = true;
      credit += m.credit;
      void run(m.blob, m.start, m.end);
    }
  });
  const send = async (bytes: Uint8Array): Promise<void> => {
    while (credit <= 0) await new Promise<void>((r) => (wake = r));
    credit--;
    port.postMessage({ type: 'chunk', bytes } satisfies PipeReply, [bytes.buffer as ArrayBuffer]);
  };
  const run = async (blob: Blob, start: number, end: number): Promise<void> => {
    let ok = false;
    try {
      const reader = inflateReader(blobRange(blob, start, end));
      let buf = new Uint8Array(PIPE_BLOCK);
      let n = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const c = r.value;
        for (let o = 0; o < c.length; ) {
          const k = Math.min(PIPE_BLOCK - n, c.length - o);
          buf.set(c.subarray(o, o + k), n);
          n += k;
          o += k;
          if (n === PIPE_BLOCK) {
            await send(buf);
            buf = new Uint8Array(PIPE_BLOCK);
            n = 0;
          }
        }
      }
      if (n) await send(buf.subarray(0, n));
      ok = true;
    } catch {
      /* 깨진 흐름·파일을 못 읽음 — 같은 스레드에서 풀다 실패할 때와 같다 */
    }
    port.postMessage({ type: 'end', ok } satisfies PipeReply, []);
  };
}

/**
 * 해석 워커 쪽 풀기(InflatePump — modelstream.ts pumpInflate와 같은 약속): data가 파일 Blob의 자리를 알면(RangeReader.file) spawn이 준
 * 풀기 워커에 맡기고, 아니면(한 버퍼·파일 손잡이) 또는 워커가 없으면 fallback(같은 스레드). onChunk가 false를 내면 거기서 멈추고 false,
 * onChunk가 던진 예외는 그대로 던진다. 다 쓴 풀기 워커는 끈다
 */
export function pipeInflate(spawn: () => PipeWorker | null, fallback: InflatePump): InflatePump {
  return (data: InflateInput, onChunk: (chunk: Uint8Array) => boolean): Promise<boolean> => {
    const file = data instanceof Uint8Array ? undefined : data.file;
    let w: PipeWorker | null = null;
    if (file)
      try {
        w = spawn();
      } catch {
        w = null;
      }
    if (!file || !w) return fallback(data, onChunk);
    const worker = w;
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let got = 0;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        worker.terminate();
        fn();
      };
      worker.addEventListener('message', (e) => {
        if (settled) return;
        const m = e.data as PipeReply;
        if (m?.type === 'chunk') {
          got++;
          let more: boolean;
          try {
            more = onChunk(m.bytes);
          } catch (err) {
            finish(() => reject(err));
            return;
          }
          if (!more) finish(() => resolve(false));
          else worker.postMessage({ type: 'credit', n: 1 } satisfies PipeRequest, []);
        } else if (m?.type === 'end') finish(() => resolve(m.ok));
      });
      // 워커를 띄우지 못함(스크립트를 못 받음 등): 조각을 받기 전이면 같은 스레드에서 처음부터, 받은 뒤면 실패(부르는 쪽이 다른 길로 읽는다)
      worker.addEventListener('error', () => finish(() => (got ? resolve(false) : fallback(data, onChunk).then(resolve, reject))));
      worker.postMessage({ type: 'start', blob: file.blob, start: file.start, end: file.start + data.length, credit: PIPE_CREDIT } satisfies PipeRequest, []);
    });
  };
}
