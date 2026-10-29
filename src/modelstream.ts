/**
 * model.dat를 풀면서 읽기. 큰 2021+ 모형의 model.dat는 풀면 수백 MB(165 MB 파일에서 323 MB)라, 통째로 풀어 들고 읽으면
 * 해석하는 동안 그만큼을 더 잡는다. 여기서는 내장 풀기(DecompressionStream 'deflate-raw')가 내는 조각을 받는 대로 읽는다.
 *
 * model.dat의 뿌리 절은 실제 파일 모두에서 설정·카메라·재질(01F7)·태그·글꼴(01FD) … → 정의(01F9) → 모형 요소(01F6) → 장면·스타일 차례이고,
 * 크기의 거의 전부가 정의 절이다(정의 수백~수천 개, 가장 큰 정의는 전체의 5분의 1쯤). 그래서
 * - 정의 절 밖의 뿌리 절은 절마다 따로 복사해 두고(모두 합쳐 수 MB),
 * - 정의 절은 정의(0x157C) 하나씩 받아 그 바이트만 들고 읽은 뒤 놓는다(정의를 읽는 데 쓰는 재질·글꼴 절이 앞에 와 있을 때).
 * 정의 안(정점 → 곡선 → 모서리 → 면 …)은 곡선이 모서리보다 먼저 오는 등 앞으로만 읽을 수 없어 정의 하나는 통째로 받는다.
 * 읽는 차례·경고 차례·결과는 한 버퍼 읽기(readModelDat)와 같다(src/model.ts ModelParse를 같이 쓴다).
 *
 * 뿌리·정의 목록의 꼬리표 길이가 깨졌거나 잘린 꼴은 한 버퍼 읽기가 앞부분을 살리는 길이 따로 있어, 여기서는 StreamFallback을 던진다 —
 * 부르는 쪽(skpToSceneAsync)이 예전처럼 통째로 풀어 읽는다(같은 결과).
 */
import { ModelParse, type ReadModelOptions, type SkpModel, TAG } from './model';
import { TlvReader } from './tlv';

/** 이보다 작은 압축 model.dat는 통째로 풀어도 작고 빠르다(내장 풀기를 띄우는 값이 더 든다) — 앱 워커의 문턱 */
export const STREAM_MIN_BYTES = 1 << 20;

/** 내장 풀기에 한 번에 넣는 압축 바이트. 내장 풀기는 넣은 조각을 한 번에 다 풀어 내므로 작게 넣어야 풀린 조각이 쌓이지 않는다 */
const INPUT_STEP = 1 << 16;

/** 압축 바이트를 파일에서 읽어 올 때 한 번에 읽는 덩이(다음 덩이를 미리 하나 더 읽어 둔다 — 많아야 둘을 든다) */
export const READ_BLOCK = 1 << 20;

/** 정해진 길이의 바이트를 자리마다 읽어 주는 곳(파일 조각 — src/range.ts). read(a, b)는 [a, b)를 낸다(파일이 짧으면 덜) */
export interface RangeReader {
  readonly length: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/** 풀 압축 바이트: 한 버퍼, 또는 덩이씩 읽어 줄 곳(파일 전체를 들지 않는다) */
export type InflateInput = Uint8Array | RangeReader;

/** 조각으로 읽을 수 없는 꼴(깨지거나 잘린 뿌리·정의 목록, 받은 길이가 다름) — 한 버퍼로 다시 읽는다 */
export class StreamFallback extends Error {}

/** 읽기 요청: n바이트를 새 버퍼로 받기, 또는 n바이트 건너뛰기 */
type Op = { read: number } | { skip: number };

const EMPTY = new Uint8Array(0);
const u16 = (b: Uint8Array): number => b[0]! | (b[1]! << 8);
const u32 = (b: Uint8Array): number => (b[2]! | (b[3]! << 8) | (b[4]! << 16)) + b[5]! * 0x1000000;

/**
 * model.dat 조각 받기(동기). push로 받은 차례대로 읽고, 다 받으면 end가 모형을 낸다(readModelDat와 같은 결과).
 * total은 풀린 길이(꾸러미 목록의 원래 크기) — 받은 길이가 다르면 StreamFallback.
 */
export class ModelDatStream {
  private readonly parse: ModelParse;
  private readonly gen: Generator<Op, void, Uint8Array>;
  private op: Op | undefined;
  private buf = EMPTY;
  private filled = 0;
  private skipLeft = 0;
  private received = 0;
  /** 정의를 하나씩 읽었는지(재질·글꼴 절이 정의 절보다 뒤에 오거나 없으면 정의 절을 통째로 들고 읽는다) */
  streamedDefinitions = false;

  constructor(
    readonly total: number,
    opts: ReadModelOptions = {},
    onProgress?: (fraction: number) => void,
  ) {
    this.parse = new ModelParse(total, onProgress, opts);
    this.gen = this.walk();
    this.next(EMPTY);
  }

  /** 다음 풀린 조각(조각은 복사해 두므로 부르는 쪽이 다시 써도 된다) */
  push(chunk: Uint8Array): void {
    this.received += chunk.length;
    if (this.received > this.total) throw new StreamFallback('model.dat가 목록의 크기보다 깁니다');
    let o = 0;
    while (o < chunk.length && this.op) {
      if ('skip' in this.op) {
        const k = Math.min(this.skipLeft, chunk.length - o);
        this.skipLeft -= k;
        o += k;
        if (this.skipLeft === 0) this.next(this.buf);
      } else {
        const k = Math.min(this.op.read - this.filled, chunk.length - o);
        this.buf.set(chunk.subarray(o, o + k), this.filled);
        this.filled += k;
        o += k;
        if (this.filled === this.op.read) this.next(this.buf);
      }
    }
  }

  /** 다 받았다 → 모형 */
  end(): SkpModel {
    if (this.received !== this.total || this.op) throw new StreamFallback('model.dat를 끝까지 받지 못했습니다');
    return this.parse.finish();
  }

  /** 읽기를 이어 가 다음 요청을 받는다(0바이트 요청은 바로 채운다) */
  private next(v: Uint8Array): void {
    for (;;) {
      const r = this.gen.next(v);
      if (r.done) {
        this.op = undefined;
        return;
      }
      const op = r.value;
      this.op = op;
      if ('skip' in op) {
        // 다 읽은 정의 바이트를 다음 받기까지 붙들지 않는다
        this.buf = EMPTY;
        this.skipLeft = op.skip;
        if (op.skip > 0) return;
      } else {
        this.buf = new Uint8Array(op.read);
        this.filled = 0;
        if (op.read > 0) return;
      }
      v = this.buf;
    }
  }

  /** 뿌리: 절마다 머리(6바이트)를 받고 절을 복사해 두거나 정의를 하나씩 읽는다 */
  private *walk(): Generator<Op, void, Uint8Array> {
    const total = this.total;
    if (total < 6) throw new StreamFallback('model.dat가 너무 짧습니다');
    const head = yield { read: 6 };
    if (u16(head) !== TAG.ROOT) throw new StreamFallback('model.dat 뿌리 꼬리표가 다릅니다');
    const rootEnd = 6 + u32(head);
    if (rootEnd > total) throw new StreamFallback('model.dat 뿌리가 잘렸습니다');
    const seen = new Set<number>();
    let p = 6;
    while (p < rootEnd) {
      if (p + 6 > rootEnd) throw new StreamFallback('뿌리 꼬리표가 깨졌습니다');
      const h = yield { read: 6 };
      const tag = u16(h);
      const len = u32(h);
      const s = p + 6;
      const e = s + len;
      if (e > rootEnd) throw new StreamFallback('뿌리 절 길이가 깨졌습니다');
      if (seen.has(tag)) yield { skip: len };
      else {
        seen.add(tag);
        // 정의 절: 정의를 읽는 데 쓰는 재질·글꼴 절이 이미 왔으면 정의를 하나씩. 아니면 다른 절처럼 통째로 둔다(한 버퍼 읽기와 같다)
        if (tag === TAG.DEFINITIONS && this.parse.has(TAG.MATERIALS) && this.parse.has(TAG.FONT_SECTION)) {
          this.parse.beginDefinitions();
          this.streamedDefinitions = true;
          yield* this.firstChild(s, e, TAG.DEF_LIST, (ls, le) => this.firstChild(ls, le, TAG.DEF_ITEMS, (is, ie) => this.definitions(is, ie)));
        } else {
          const b = yield { read: len };
          this.parse.addSection(tag, { r: new TlvReader(b), n: { tag, start: 0, end: len }, clipped: false });
        }
      }
      p = e;
    }
    if (rootEnd < total) yield { skip: total - rootEnd };
  }

  /**
   * [s, e) 안 첫 tag 자식을 inner로 읽고 나머지는 건너뛴다(TlvReader.firstSafe와 같은 것을 고른다).
   * 그 앞 자식의 길이가 넘치면 StreamFallback(한 버퍼 읽기는 잘린 목록을 살린다)
   */
  private *firstChild(s: number, e: number, tag: number, inner: (s: number, e: number) => Generator<Op, void, Uint8Array>): Generator<Op, void, Uint8Array> {
    let p = s;
    while (p + 6 <= e) {
      const h = yield { read: 6 };
      const t = u16(h);
      const ce = p + 6 + u32(h);
      if (ce > e) throw new StreamFallback('정의 목록 길이가 깨졌습니다');
      if (t === tag) {
        yield* inner(p + 6, ce);
        if (e > ce) yield { skip: e - ce };
        return;
      }
      yield { skip: ce - p - 6 };
      p = ce;
    }
    if (e > p) yield { skip: e - p };
  }

  /** 정의 목록(0x1771) 안: 정의(0x157C)마다 그 바이트만 받아 읽고 놓는다(TlvReader.eachSafe와 같은 차례) */
  private *definitions(s: number, e: number): Generator<Op, void, Uint8Array> {
    let p = s;
    while (p < e) {
      if (p + 6 > e) {
        yield { skip: e - p };
        return;
      }
      const h = yield { read: 6 };
      const tag = u16(h);
      const cs = p + 6;
      const ce = cs + u32(h);
      if (ce > e) {
        // 길이가 넘친 정의는 한 버퍼 읽기가 앞부분을 살린다
        if (tag === TAG.DEFINITION && cs < e) throw new StreamFallback('정의 길이가 깨졌습니다');
        if (e > cs) yield { skip: e - cs };
        return;
      }
      if (tag === TAG.DEFINITION) {
        const b = yield { read: ce - cs };
        this.parse.definition(new TlvReader(b), { tag, start: 0, end: b.length }, false, cs);
      } else yield { skip: ce - cs };
      p = ce;
    }
  }
}

/** 원시 DEFLATE 바이트를 내장 풀기로 푼다(정확히 expected 바이트일 때만), 아니면 null */
export async function inflateNative(data: Uint8Array, expected: number): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || !(expected > 0)) return null;
  const out = new Uint8Array(expected);
  let o = 0;
  const ok = await pumpInflate(data, (chunk) => {
    if (o + chunk.length > expected) return false;
    out.set(chunk, o);
    o += chunk.length;
    return true;
  });
  return ok && o === expected ? out : null;
}

/**
 * 압축 바이트를 작은 조각으로 내장 풀기에 넣으며 풀린 조각을 onChunk로 넘긴다(받는 쪽이 읽으면 다음 조각을 넣는다).
 * 풀기가 끝까지 되면 true, 내장 풀기가 실패하거나(깨진 흐름) onChunk가 false를 내면 false. onChunk가 던진 예외는 그대로 던진다
 */
async function pumpInflate(data: InflateInput, onChunk: (chunk: Uint8Array) => boolean): Promise<boolean> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const next = data instanceof Uint8Array ? bufferChunks(data) : rangeChunks(data);
    const src = new ReadableStream<Uint8Array>(
      {
        async pull(c) {
          const chunk = await next();
          if (chunk) c.enqueue(chunk);
          else c.close();
        },
      },
      { highWaterMark: 0 },
    );
    reader = src.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  } catch {
    return false;
  }
  let finished = false;
  try {
    for (;;) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await reader.read();
      } catch {
        return false;
      }
      if (r.done) {
        finished = true;
        return true;
      }
      if (!onChunk(r.value)) return false;
    }
  } finally {
    if (!finished) reader.cancel().catch(() => undefined);
  }
}

/** 한 버퍼를 INPUT_STEP씩(끝나면 null) */
function bufferChunks(data: Uint8Array): () => Promise<Uint8Array | null> {
  let pos = 0;
  return async () => {
    if (pos >= data.length) return null;
    const end = Math.min(data.length, pos + INPUT_STEP);
    const out = data.subarray(pos, end);
    pos = end;
    return out;
  };
}

/**
 * 읽어 줄 곳을 READ_BLOCK씩 읽어(다음 덩이는 미리 읽어 둔다) INPUT_STEP씩 낸다. 끝나면 null.
 * 다 읽기 전에 파일이 끝나면(읽은 길이 0) Error — 풀기가 실패해 부르는 쪽이 다른 길로 읽는다
 */
function rangeChunks(src: RangeReader): () => Promise<Uint8Array | null> {
  const total = src.length;
  let pos = 0;
  let block: Uint8Array = EMPTY;
  let off = 0;
  let ahead: Promise<Uint8Array> | null = null;
  const fetch = (p: number): Promise<Uint8Array> => src.read(p, Math.min(total, p + READ_BLOCK));
  return async () => {
    if (off >= block.length) {
      if (pos >= total) return null;
      const got = ahead ?? fetch(pos);
      ahead = null;
      block = await got;
      off = 0;
      if (!block.length) throw new Error('파일을 끝까지 읽지 못했습니다');
      pos += block.length;
      if (pos < total) {
        ahead = fetch(pos);
        // 쓰기 전에 실패해도 처리되지 않은 거부로 남지 않게(쓸 때 다시 던진다)
        ahead.catch(() => undefined);
      }
    }
    const end = Math.min(block.length, off + INPUT_STEP);
    const out = block.subarray(off, end);
    off = end;
    return out;
  };
}

/**
 * 꾸러미의 압축된 model.dat(원시 DEFLATE)를 내장 풀기로 풀면서 읽는다 → 모형.
 * 'inflate': 내장 풀기가 없거나 실패했거나 풀린 길이가 expected와 다르다(예전에 미리 풀기가 실패했을 때처럼 해석기가 직접 푼다).
 * 'shape': 풀기는 되지만 조각으로 읽을 수 없는 꼴(깨진 뿌리 등) — 통째로 풀어 한 버퍼로 읽는다.
 * 모형과 함께 held(정의 절을 하나씩 읽지 못하고 통째로 들고 읽었는지)를 낸다. onProgress는 풀린 바이트 비율(0~1)
 */
export async function streamModelDat(
  data: InflateInput,
  expected: number,
  opts: ReadModelOptions = {},
  onProgress?: (fraction: number) => void,
): Promise<{ model: SkpModel; held: boolean } | 'inflate' | 'shape'> {
  if (typeof DecompressionStream === 'undefined' || !(expected > 0)) return 'inflate';
  let stream: ModelDatStream;
  try {
    stream = new ModelDatStream(expected, opts);
  } catch (e) {
    // 너무 짧은 model.dat
    if (e instanceof StreamFallback) return 'shape';
    throw e;
  }
  let got = 0;
  let next = 0;
  const step = Math.max(1, Math.floor(expected / 50));
  let shape = false;
  let ok: boolean;
  try {
    ok = await pumpInflate(data, (chunk) => {
      got += chunk.length;
      if (got > expected) return false;
      stream.push(chunk);
      if (onProgress && got >= next) {
        next = got + step;
        try {
          onProgress(got / expected);
        } catch {
          /* 알림 쪽 오류는 무시 */
        }
      }
      return true;
    });
  } catch (e) {
    if (!(e instanceof StreamFallback)) throw e;
    shape = true;
    ok = true;
  }
  if (!ok || (!shape && got !== expected)) return 'inflate';
  if (shape) return 'shape';
  try {
    return { model: stream.end(), held: !stream.streamedDefinitions };
  } catch (e) {
    if (e instanceof StreamFallback) return 'shape';
    throw e;
  }
}
