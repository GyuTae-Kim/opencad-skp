/**
 * ZIP 읽기(의존성 없음) — SketchUp 2021 이후 파일 안의 꾸러미용. 파일 전체 바이트로 읽거나(동기), 끝 레코드·중앙 목록·항목 자리만
 * 따로 읽어 줄 수도 있게 위치를 파일 전체 기준으로 둔다(src/range.ts — 큰 파일을 통째로 들지 않고 열기).
 * 공개된 ZIP 구조(끝 레코드 EOCD → 중앙 목록 → 지역 머리)만 쓴다. ZIP64·암호·분할 꾸러미는 다루지 않는다.
 * SKP는 ZIP 앞에 머리(UTF-16 표지·버전·VFF 블록)가 붙고 ZIP 안의 위치는 ZIP 시작 기준이라,
 * 끝 레코드 위치에서 중앙 목록 크기·위치를 빼서 앞붙이 길이(base)를 구한다.
 */

import { inflateRaw, inflateRawPartial } from './inflate';

export interface ZipItem {
  /** 꾸러미 안 경로(UTF-8로 읽는다 — SketchUp은 비트 11 없이 UTF-8 이름을 쓴다) */
  name: string;
  /** 0 저장, 8 DEFLATE */
  method: number;
  compressedSize: number;
  size: number;
  /** 파일 전체 기준 지역 머리 위치 */
  localOffset: number;
  /** 지역 머리를 따라 찾았는데 내용이 파일 끝에서 잘린 항목(scanZipLocal) */
  truncated?: boolean;
}

const utf8 = new TextDecoder('utf-8');

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** 끝 레코드에서 읽은 것(위치는 파일 전체 기준) */
export interface ZipEnd {
  /** 항목 수 */
  count: number;
  /** ZIP 앞붙이 길이(ZIP 안 위치 + base = 파일 위치) */
  base: number;
  /** 중앙 목록 시작 */
  cdStart: number;
}

/** 끝 레코드 꼬리 길이(22바이트 + 설명 최대 65535) — 파일 끝에서 이만큼만 보면 끝 레코드를 찾는다 */
export const ZIP_END_SEARCH = 22 + 0xffff;

/**
 * 끝 레코드(EOCD)를 찾는다. b는 파일 위치 at부터 파일 끝까지의 바이트(at = 0이면 파일 전체) — 끝에서 ZIP_END_SEARCH 안을 보므로
 * 꼬리만 읽어도 파일 전체로 찾은 것과 같다. ZIP이 아니거나 앞붙이 길이가 음수면 null, ZIP64면 Error
 */
export function findZipEnd(b: Uint8Array, at = 0): ZipEnd | null {
  // EOCD: 'PK\5\6' + 18바이트 + 설명(최대 65535)
  const min = Math.max(0, b.length - ZIP_END_SEARCH);
  let eocd = -1;
  for (let p = b.length - 22; p >= min; p--) {
    if (b[p] === 0x50 && b[p + 1] === 0x4b && b[p + 2] === 0x05 && b[p + 3] === 0x06) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  const cdSize = u32(b, eocd + 12);
  const cdOffset = u32(b, eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('ZIP64 꾸러미는 아직 읽지 못합니다');
  const base = at + eocd - cdSize - cdOffset;
  if (base < 0) return null;
  return { count, base, cdStart: base + cdOffset };
}

/**
 * 중앙 목록을 읽는다. ZIP이 아니면 null. b는 파일 위치 at부터 파일 끝까지의 바이트(기본은 파일 전체) —
 * 중앙 목록 시작(findZipEnd의 cdStart)부터 읽은 꼬리만 줘도 파일 전체로 읽은 것과 같은 목록이 나온다(항목 위치는 파일 전체 기준)
 */
export function readZipDirectory(b: Uint8Array, at = 0): ZipItem[] | null {
  const end = findZipEnd(b, at);
  if (!end) return null;
  const { count, base } = end;
  if (end.cdStart < at) throw new Error('ZIP 중앙 목록이 주어진 바이트 밖에 있습니다');
  const items: ZipItem[] = [];
  let p = end.cdStart - at;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error('ZIP 중앙 목록이 깨졌습니다');
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLen));
    items.push({ name, method, compressedSize, size, localOffset: base + local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return items;
}

/** 지역 머리 뒤 내용 시작 위치(머리가 깨졌으면 Error) */
function dataStart(b: Uint8Array, item: ZipItem): number {
  const p = item.localOffset;
  if (p < 0 || p + 30 > b.length || u32(b, p) !== 0x04034b50) throw new Error(`ZIP 지역 머리가 깨졌습니다: ${item.name}`);
  return p + 30 + u16(b, p + 26) + u16(b, p + 28);
}

/** 항목의 저장된(압축된) 바이트 보기(복사 없음). 지역 머리가 깨졌거나 내용이 파일 끝을 넘으면 Error */
export function zipItemData(b: Uint8Array, item: ZipItem): Uint8Array {
  const start = dataStart(b, item);
  const end = start + item.compressedSize;
  if (end > b.length || item.truncated) throw new Error(`ZIP 항목이 잘렸습니다: ${item.name}`);
  return b.subarray(start, end);
}

/**
 * 지역 머리 바이트(b[0]이 항목의 지역 머리)에서 내용 시작까지 거리. 머리가 깨졌거나 30바이트가 안 되면 Error(zipItemData와 같은 글)
 */
export function zipLocalDataOffset(b: Uint8Array, item: ZipItem): number {
  return dataStart(b, { ...item, localOffset: 0 });
}

/** 항목 내용을 꺼낸다(저장·DEFLATE만) */
export function readZipItem(b: Uint8Array, item: ZipItem, onProgress?: (fraction: number) => void): Uint8Array {
  const data = zipItemData(b, item);
  if (item.method === 0) return data.slice();
  if (item.method === 8) return inflateRaw(data, item.size, onProgress);
  throw new Error(`지원하지 않는 ZIP 압축 방식 ${item.method}: ${item.name}`);
}

/**
 * 항목 내용을 꺼내되, 파일 끝에서 잘렸거나 압축 흐름이 중간에 깨졌으면 앞부분만이라도 돌려준다(complete = false).
 * 잘린 파일에서 model.dat의 앞부분이라도 살리려고 쓴다.
 */
export function readZipItemPartial(b: Uint8Array, item: ZipItem, onProgress?: (fraction: number) => void): { data: Uint8Array; complete: boolean } {
  const start = dataStart(b, item);
  const want = start + item.compressedSize;
  const end = Math.min(b.length, want);
  const cut = want > b.length || !!item.truncated;
  const data = b.subarray(start, Math.max(start, end));
  if (item.method === 0) {
    const out = data.slice();
    return { data: out, complete: !cut && out.length === item.size };
  }
  if (item.method === 8) {
    const r = inflateRawPartial(data, item.size, onProgress);
    return { data: r.data, complete: r.complete && !cut };
  }
  throw new Error(`지원하지 않는 ZIP 압축 방식 ${item.method}: ${item.name}`);
}

/**
 * 꾸러미 항목을 읽어 가며 일하는 생성기: 항목을 내면(yield) 부르는 쪽이 그 내용(readZipItem과 같은 값)을 돌려주고,
 * 못 읽으면 그 예외를 생성기 안 yield 자리로 던진다. 같은 일을 파일 전체 바이트(runZipReads)로도, 필요한 자리만 읽는 곳(range.ts)으로도 한다.
 */
export type ZipReads<R> = Generator<ZipItem, R, Uint8Array>;

/** 파일 전체 바이트로 항목 요청을 채운다(동기) */
export function runZipReads<R>(gen: ZipReads<R>, bytes: Uint8Array): R {
  let r = gen.next();
  while (!r.done) {
    let data: Uint8Array;
    try {
      data = readZipItem(bytes, r.value);
    } catch (e) {
      r = gen.throw(e);
      continue;
    }
    r = gen.next(data);
  }
  return r.value;
}

/** 항목 요청을 비동기로 채운다(read가 readZipItem과 같은 값을 내거나 같은 예외를 던진다) */
export async function runZipReadsAsync<R>(gen: ZipReads<R>, read: (item: ZipItem) => Promise<Uint8Array>): Promise<R> {
  let r = gen.next();
  while (!r.done) {
    let data: Uint8Array;
    try {
      data = await read(r.value);
    } catch (e) {
      r = gen.throw(e);
      continue;
    }
    r = gen.next(data);
  }
  return r.value;
}

/** 파일 끝에서 찾아볼 범위 밖의 앞부분에서 첫 지역 머리를 찾을 거리 */
const LOCAL_SEARCH = 1 << 16;

/**
 * 중앙 목록 없이 지역 머리(PK 3 4)를 앞에서부터 따라가며 항목을 찾는다 — 끝(중앙 목록·끝 레코드)이 잘렸거나 깨진 파일용.
 * 공개 ZIP 구조만 쓴다: 지역 머리에도 압축 크기가 있고, SketchUp 표본은 데이터 서술자(깃발 비트 3)를 쓰지 않았다.
 * 데이터 서술자가 있는 항목을 만나면 크기를 몰라 거기서 멈춘다. 마지막 항목이 파일 끝에서 잘리면 truncated로 표시한다.
 */
export function scanZipLocal(b: Uint8Array, start = 0): { items: ZipItem[]; truncated: boolean } {
  const items: ZipItem[] = [];
  let p = -1;
  for (let q = Math.max(0, start), e = Math.min(b.length - 4, start + LOCAL_SEARCH); q <= e; q++)
    if (b[q] === 0x50 && b[q + 1] === 0x4b && b[q + 2] === 0x03 && b[q + 3] === 0x04) {
      p = q;
      break;
    }
  if (p < 0) return { items, truncated: false };
  let truncated = false;
  while (p >= 0) {
    if (p + 30 > b.length) {
      truncated = p < b.length;
      break;
    }
    if (u32(b, p) !== 0x04034b50) break;
    const flags = u16(b, p + 6);
    const method = u16(b, p + 8);
    const compressedSize = u32(b, p + 18);
    const size = u32(b, p + 22);
    const nameLen = u16(b, p + 26);
    const extraLen = u16(b, p + 28);
    if (p + 30 + nameLen > b.length) {
      truncated = true;
      break;
    }
    const name = utf8.decode(b.subarray(p + 30, p + 30 + nameLen));
    const data = p + 30 + nameLen + extraLen;
    const item: ZipItem = { name, method, compressedSize, size, localOffset: p };
    if (flags & 8) {
      // 데이터 서술자: 지역 머리의 크기가 0일 수 있어 다음 항목 위치를 모른다
      if (compressedSize > 0 && data + compressedSize <= b.length) items.push(item);
      break;
    }
    if (data + compressedSize > b.length) {
      item.truncated = true;
      items.push(item);
      truncated = true;
      break;
    }
    items.push(item);
    p = data + compressedSize;
  }
  return { items, truncated };
}

/**
 * 꾸러미 목록 찾기: 끝 레코드·중앙 목록이 멀쩡하면 그것을, 없거나 깨졌으면 지역 머리를 앞에서부터 따라간다(끝이 잘린 파일).
 * 돌려주는 salvaged가 true면 지역 머리로 찾은 것이다.
 */
export function findSkpZipItems(bytes: Uint8Array, bodyOffset = 0): { items: ZipItem[] | null; salvaged: boolean; truncated: boolean; error?: string } {
  let items: ZipItem[] | null = null;
  let error: string | undefined;
  try {
    items = readZipDirectory(bytes);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (items && items.some((d) => d.name === 'model.dat')) return { items, salvaged: false, truncated: false };
  const scan = scanZipLocal(bytes, bodyOffset);
  if (scan.items.length) {
    const r: { items: ZipItem[]; salvaged: boolean; truncated: boolean; error?: string } = { items: scan.items, salvaged: true, truncated: scan.truncated };
    if (error !== undefined) r.error = error;
    return r;
  }
  const r: { items: ZipItem[] | null; salvaged: boolean; truncated: boolean; error?: string } = { items, salvaged: false, truncated: false };
  if (error !== undefined) r.error = error;
  return r;
}
