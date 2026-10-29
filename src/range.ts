/**
 * 파일을 통째로 들지 않고 필요한 자리만 읽기(skpFileToScene·앱 워커). 2021+ SKP는 머리 + ZIP 꾸러미라,
 * 끝 레코드(파일 끝 64 KiB 안) → 중앙 목록 → 필요한 항목(material.xml·style.xml·그림)만 읽고, 압축된 model.dat는 1 MiB씩 읽으며 푼다.
 * 파일은 Blob·File(브라우저가 디스크에서 읽어 준다), Node 파일 손잡이, 시험용 바이트 어느 것이든 SkpSource로 준다.
 *
 * 항목 하나는 지역 머리부터 내용 끝까지 읽어 그 안 위치로 고친 항목과 함께 readZipItem에 넘긴다 — 파일 전체 바이트로 읽은 것과
 * 같은 값·같은 오류(깨진 머리, 파일 끝에서 잘린 내용)가 난다. 작은 항목은 꾸러미 안에 이어 놓여 있어 WINDOW씩 읽어 둔 덩이에서 낸다.
 * 파일 내용 지문(SHA-256)도 덩이씩 읽으며 구한다(sourceSha256 — 내장 crypto.subtle.digest는 한 버퍼만 받는다).
 */
import { READ_BLOCK, type RangeReader } from './modelstream';
import { Sha256 } from './sha256';
import { findZipEnd, readZipDirectory, readZipItem, ZIP_END_SEARCH, zipLocalDataOffset, type ZipItem } from './zip';

/** 파일 바이트를 자리마다 읽어 주는 곳 */
export interface SkpSource {
  /** 파일 크기(바이트) */
  readonly size: number;
  /** [start, end) 바이트 — 파일 밖은 잘라 낸다. 부르는 쪽이 고쳐도 되는 새 배열(버퍼 전체를 보는 배열)을 낸다 */
  read(start: number, end: number): Promise<Uint8Array<ArrayBuffer>>;
}

const EMPTY: Uint8Array<ArrayBuffer> = new Uint8Array(0);
const clamp = (v: number, size: number): number => Math.max(0, Math.min(Number.isFinite(v) ? Math.floor(v) : 0, size));

/** Blob·File → SkpSource(조각마다 blob.slice(…).arrayBuffer() — 파일은 브라우저가 디스크에서 읽는다) */
export function blobSource(blob: Blob): SkpSource {
  const size = blob.size;
  return {
    size,
    async read(start, end) {
      const a = clamp(start, size);
      const b = Math.max(a, clamp(end, size));
      return b > a ? new Uint8Array(await blob.slice(a, b).arrayBuffer()) : new Uint8Array(0);
    },
  };
}

/** 바이트 → SkpSource(시험·이미 든 바이트용 — 읽을 때마다 사본) */
export function bytesSource(bytes: Uint8Array): SkpSource {
  const size = bytes.length;
  return {
    size,
    async read(start, end) {
      const a = clamp(start, size);
      return bytes.slice(a, Math.max(a, clamp(end, size)));
    },
  };
}

/** 파일 머리를 읽을 길이(머리 문자열 둘 + VFF 블록은 수십 바이트) */
export const HEAD_BYTES = 4096;

/** 끝 레코드 → 중앙 목록(파일 전체로 읽은 readZipDirectory와 같은 목록). ZIP이 아니면 null, 깨졌으면 Error */
export async function readSourceDirectory(src: SkpSource): Promise<ZipItem[] | null> {
  const at = Math.max(0, src.size - ZIP_END_SEARCH);
  const tail = await src.read(at, src.size);
  const end = findZipEnd(tail, at);
  if (!end) return null;
  if (end.cdStart >= at) return readZipDirectory(tail, at);
  return readZipDirectory(await src.read(end.cdStart, src.size), end.cdStart);
}

/** 작은 항목을 이어 읽을 덩이 */
export const WINDOW = 256 * 1024;
/** 이보다 작은 자리만 덩이로 읽는다(큰 그림·model.dat는 그 자리만) */
const WINDOW_MAX = 64 * 1024;
/** 지역 머리의 이름 뒤 덧붙임(extra) 길이를 모를 때 더 읽어 두는 바이트 */
const EXTRA_GUESS = 64;
const utf8 = new TextEncoder();

/** 꾸러미 항목 읽기(한 파일, 한 번 여는 동안) */
export class SourceItems {
  private win: Uint8Array<ArrayBuffer> = EMPTY;
  private winAt = 0;
  /** 파일에서 읽은 횟수(진단·시험용) */
  reads = 0;

  constructor(readonly src: SkpSource) {}

  /** [start, end)(파일 밖은 잘라 낸다). 작은 자리는 덩이에서 — 내는 배열은 덩이의 보기일 수 있어 고치지 않는다 */
  async range(start: number, end: number): Promise<Uint8Array> {
    const size = this.src.size;
    const s = clamp(start, size);
    const e = Math.max(s, clamp(end, size));
    if (e - s > WINDOW_MAX) {
      this.reads++;
      return this.src.read(s, e);
    }
    if (s >= this.winAt && e <= this.winAt + this.win.length) return this.win.subarray(s - this.winAt, e - this.winAt);
    this.reads++;
    this.win = await this.src.read(s, Math.min(size, s + WINDOW));
    this.winAt = s;
    return this.win.subarray(0, Math.min(e - s, this.win.length));
  }

  /**
   * 항목의 지역 머리부터 내용 끝까지(파일이 짧으면 있는 데까지)와 그 안 위치로 고친 항목(localOffset 0).
   * readZipItem·readZipItemPartial·zipItemData에 넘기면 파일 전체 바이트로 부른 것과 같은 값·같은 오류가 난다
   */
  async region(item: ZipItem): Promise<{ bytes: Uint8Array; item: ZipItem }> {
    const p = item.localOffset;
    const rebased: ZipItem = { ...item, localOffset: 0 };
    let b = await this.range(p, p + 30 + utf8.encode(item.name).length + EXTRA_GUESS + item.compressedSize);
    let start: number;
    try {
      start = zipLocalDataOffset(b, item);
    } catch {
      // 깨진 지역 머리: 그 바이트로 readZipItem이 같은 오류를 낸다
      return { bytes: b.subarray(0, Math.min(30, b.length)), item: rebased };
    }
    const need = start + item.compressedSize;
    if (need > b.length && p + b.length < this.src.size) b = await this.range(p, p + need);
    return { bytes: b.length > need ? b.subarray(0, need) : b, item: rebased };
  }

  /** 항목 내용(readZipItem(파일 전체, item)과 같은 값 — 새 배열) */
  async content(item: ZipItem): Promise<Uint8Array> {
    const r = await this.region(item);
    return readZipItem(r.bytes, r.item);
  }

  /** 압축된 내용을 덩이씩 읽어 줄 곳(zipItemData와 같은 검사 — 깨진 머리·파일 끝을 넘는 내용은 Error) */
  async data(item: ZipItem): Promise<RangeReader> {
    const p = item.localOffset;
    const head = await this.range(p, p + 30);
    const start = p + zipLocalDataOffset(head, item);
    const end = start + item.compressedSize;
    if (end > this.src.size || item.truncated) throw new Error(`ZIP 항목이 잘렸습니다: ${item.name}`);
    const src = this.src;
    return {
      length: item.compressedSize,
      read: (a, b) => {
        this.reads++;
        return src.read(start + a, start + Math.min(b, item.compressedSize));
      },
    };
  }
}

/** 이 크기까지는 지문을 내장 SHA-256(crypto.subtle)으로 한 번에 구한다(파일을 다 읽어도 작다) */
const NATIVE_DIGEST_MAX = 8 * 1024 * 1024;
/** 지문을 구할 때 한 번에 읽는 덩이(다음 덩이를 미리 하나 더 읽어 둔다) */
const DIGEST_BLOCK = 4 * READ_BLOCK;

/**
 * 파일 내용 SHA-256(32바이트) — 파일 전체 바이트로 구한 값과 같다. 작은 파일은 내장 crypto.subtle로 한 번에, 큰 파일(또는 내장이 없을 때 —
 * 보안 연결이 아닌 쪽)은 DIGEST_BLOCK씩 읽으며 sha256.ts로 구해 많아야 덩이 둘을 든다. nativeMax로 문턱을 바꾼다(시험)
 */
export async function sourceSha256(src: SkpSource, nativeMax = NATIVE_DIGEST_MAX): Promise<Uint8Array> {
  const size = src.size;
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (size <= nativeMax && subtle)
    try {
      const all = await src.read(0, size);
      if (all.length === size) return new Uint8Array(await subtle.digest('SHA-256', all));
    } catch {
      /* 내장이 막혔으면 아래로 */
    }
  const h = new Sha256();
  const next = (p: number): Promise<Uint8Array> | null => (p < size ? src.read(p, Math.min(size, p + DIGEST_BLOCK)) : null);
  let ahead = next(0);
  let pos = 0;
  while (ahead) {
    const b = await ahead;
    if (!b.length) throw new Error('파일을 끝까지 읽지 못했습니다');
    pos += b.length;
    ahead = next(pos);
    ahead?.catch(() => undefined);
    h.update(b);
  }
  return h.digest();
}
