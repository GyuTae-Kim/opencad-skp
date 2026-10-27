/**
 * 꾸러미(ZIP) 큰 항목을 브라우저 내장 풀기(DecompressionStream 'deflate-raw')로 미리 푼다 — 워커 전용 도움(비동기).
 * 해석기(skpToScene)는 동기라 직접 쓴 DEFLATE 풀기(src/inflate.ts)를 쓰는데, 큰 모형의 model.dat(수백 MB)는 그것이 해석 시간의
 * 3분의 1쯤을 먹는다. 내장 풀기는 몇 배 빨라, 워커가 먼저 풀어 skpToScene의 inflated로 넘긴다.
 * 내장 풀기가 없거나(옛 브라우저) 실패하거나 풀린 길이가 목록의 원래 크기와 다르면 넘기지 않는다 — 해석기가 예전처럼 직접 푼다
 * (잘린·깨진 파일의 앞부분 살리기도 그쪽이 한다).
 */
import { readSkpHeader } from '../header';
import { findSkpZipItems, zipItemData, type ZipItem } from '../zip';

/** 이보다 작은 항목은 직접 풀어도 빠르다(내장 풀기를 띄우는 값이 더 든다) */
export const NATIVE_INFLATE_MIN_BYTES = 1 << 20;

/** 원시 DEFLATE 바이트 → 풀린 바이트(정확히 expected 바이트일 때만), 아니면 null */
export async function inflateNative(data: Uint8Array, expected: number): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || !(expected > 0)) return null;
  try {
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(data);
        c.close();
      },
    });
    const reader = src.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
    const out = new Uint8Array(expected);
    let o = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (o + value.length > expected) {
        await reader.cancel();
        return null;
      }
      out.set(value, o);
      o += value.length;
    }
    return o === expected ? out : null;
  } catch {
    return null;
  }
}

/**
 * 2021+ SKP의 model.dat(DEFLATE, 1 MB 넘음)를 내장 풀기로 푼다 → skpToScene의 inflated. 2020 이하·작은 파일·잘린 꾸러미·풀기 실패는 undefined
 */
export async function preinflateSkp(bytes: Uint8Array, minBytes = NATIVE_INFLATE_MIN_BYTES): Promise<Map<string, Uint8Array> | undefined> {
  const h = readSkpHeader(bytes);
  if (!h || h.container !== 'zip') return undefined;
  let item: ZipItem | undefined;
  try {
    const found = findSkpZipItems(bytes, h.bodyOffset);
    if (!found.items || found.salvaged) return undefined;
    item = found.items.find((d) => d.name === 'model.dat');
  } catch {
    return undefined;
  }
  if (!item || item.method !== 8 || item.truncated || item.compressedSize < minBytes) return undefined;
  let data: Uint8Array;
  try {
    data = zipItemData(bytes, item);
  } catch {
    return undefined;
  }
  const out = await inflateNative(data, item.size);
  return out ? new Map([['model.dat', out]]) : undefined;
}
