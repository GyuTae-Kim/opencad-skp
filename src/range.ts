/**
 * 파일을 통째로 들지 않고 필요한 자리만 읽기(skpFileToScene·앱 워커). 2021+ SKP는 머리 + ZIP 꾸러미라,
 * 끝 레코드(파일 끝 64 KiB 안) → 중앙 목록 → 필요한 항목(material.xml·style.xml·그림)만 읽고, 압축된 model.dat는 1 MiB씩 읽으며 푼다.
 * 파일은 Blob·File(브라우저가 디스크에서 읽어 준다), Node 파일 손잡이, 시험용 바이트 어느 것이든 SkpSource로 준다.
 *
 * 항목 하나는 지역 머리부터 내용 끝까지 읽어 그 안 위치로 고친 항목과 함께 readZipItem에 넘긴다 — 파일 전체 바이트로 읽은 것과
 * 같은 값·같은 오류(깨진 머리, 파일 끝에서 잘린 내용)가 난다. 작은 항목은 꾸러미 안에 이어 놓여 있어 WINDOW씩 읽어 둔 덩이에서 낸다.
 * 파일 내용 지문(SHA-256)도 덩이씩 읽으며 구한다(sourceSha256 — 내장 crypto.subtle.digest는 한 버퍼만 받는다).
 */
import { freeTyped } from './grow';
import { READ_BLOCK, type RangeReader } from './modelstream';
import { Sha256 } from './sha256';
import { findZipEnd, readZipDirectory, readZipItem, ZIP_END_SEARCH, zipLocalDataOffset, type ZipItem } from './zip';

/** 파일 바이트를 자리마다 읽어 주는 곳 */
export interface SkpSource {
  /** 파일 크기(바이트) */
  readonly size: number;
  /** [start, end) 바이트 — 파일 밖은 잘라 낸다. 부르는 쪽이 고쳐도 되는 새 배열(버퍼 전체를 보는 배열)을 낸다 */
  read(start: number, end: number): Promise<Uint8Array<ArrayBuffer>>;
  /** 읽는 파일이 Blob이면 그 Blob(49차 — 압축된 model.dat를 풀기 워커가 직접 읽게 넘긴다) */
  readonly blob?: Blob;
}

const EMPTY: Uint8Array<ArrayBuffer> = new Uint8Array(0);
const clamp = (v: number, size: number): number => Math.max(0, Math.min(Number.isFinite(v) ? Math.floor(v) : 0, size));

/** Blob·File → SkpSource(조각마다 blob.slice(…).arrayBuffer() — 파일은 브라우저가 디스크에서 읽는다) */
export function blobSource(blob: Blob): SkpSource {
  const size = blob.size;
  return {
    size,
    blob,
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

/** 미리 읽기(plan)로 함께 보내 두는 읽기 수의 위 한도 */
export const AHEAD_READS = 8;
/** 미리 읽기로 받아 두는(아직 쓰지 않은) 바이트의 위 한도(넘으면 앞 것을 쓸 때까지 더 보내지 않는다 — 한 읽기만큼 넘을 수 있다) */
export const AHEAD_BYTES = 16 * 1024 * 1024;

/** 미리 읽기 한 번: 계획한 항목(차례로 이어진 작은 항목들은 덩이 하나, 큰 항목은 그 자리만)이 들어갈 [start, end) */
interface Ahead {
  /** 계획 안 차례 */
  index: number;
  start: number;
  end: number;
  /** 이 읽기에서 받아 갈 항목들(받아 가면 빠진다) */
  items: ZipItem[];
  /** 작은 항목 덩이(WINDOW — 받아 가면 다음 작은 항목이 쓸 덩이가 된다). 아니면 큰 항목 하나의 자리 */
  window: boolean;
  bytes?: Promise<Uint8Array<ArrayBuffer>>;
  /** 계획할 때 이미 든 덩이를 쓴다(새로 읽지 않는다 — 보낸 수·바이트에 세지 않는다) */
  kept?: boolean;
  /** 다 받아 갔거나 버렸다 */
  done?: boolean;
}

/** 꾸러미 항목 읽기(한 파일, 한 번 여는 동안) */
export class SourceItems {
  private win: Uint8Array<ArrayBuffer> = EMPTY;
  private winAt = 0;
  /** 미리 읽기: 계획한 읽기 차례, 항목 → 그 읽기, 아직 보내지 않은 첫 차례, 받아 가지 않은 가장 앞 차례, 보낸 수·바이트 */
  private queue: Ahead[] = [];
  private aheadOf = new Map<ZipItem, Ahead>();
  private next = 0;
  private low = 0;
  private sent = 0;
  private held = 0;
  /** 파일에서 읽은 횟수(진단·시험용) */
  reads = 0;
  /** 한꺼번에 보낸(아직 끝나지 않은) 읽기 수의 최대(진단·시험용) */
  mostOpen = 0;
  private open = 0;

  constructor(readonly src: SkpSource) {}

  /**
   * 곧 읽을 항목 차례를 알린다(48차). 항목마다 읽기를 하나씩 기다리지 않고 AHEAD_READS·AHEAD_BYTES 안에서 앞질러 보내 둔다 —
   * Blob 읽기는 한 번마다 브라우저를 오가므로(큰 모형은 그림·재질 항목 수백 개) 기다림을 겹친다. 읽는 자리(작은 항목은 WINDOW 덩이, 큰 항목은 그 자리)와
   * 내는 값은 하나씩 읽을 때와 같다. 계획에 없거나 차례가 어긋난 항목은 예전처럼 그때 읽고, 미리 읽기가 실패한 항목도 그때 다시 읽는다
   * (같은 오류·같은 값). 새 계획은 앞 계획에서 받아 가지 않은 것을 버린다. 받아 간 항목보다 앞선 차례의 읽기는 쓰지 않을 것으로 보고 놓는다.
   * 덩이를 정하는 법은 하나씩 읽을 때(range)와 같다: 작은 항목이 지금 덩이(계획 차례로 마지막 작은 항목 덩이 — 처음에는 이미 든 덩이) 안이면
   * 그 덩이에서, 아니면 그 항목 자리부터 새 덩이. 그래서 계획대로 받아 가면 읽는 자리·횟수도 하나씩 읽을 때와 같다
   */
  plan(list: readonly ZipItem[]): void {
    for (let k = this.low; k < this.queue.length; k++) this.drop(this.queue[k]!);
    this.queue = [];
    this.aheadOf.clear();
    this.next = this.low = 0;
    const size = this.src.size;
    let cur: Ahead | null = null;
    const add = (a: Ahead, item: ZipItem): void => {
      a.items.push(item);
      this.aheadOf.set(item, a);
    };
    for (const item of list) {
      if (this.aheadOf.has(item)) continue;
      const [s, e] = this.headRange(item);
      if (e - s > WINDOW_MAX) {
        const a: Ahead = { index: this.queue.length, start: s, end: e, items: [], window: false };
        this.queue.push(a);
        add(a, item);
        continue;
      }
      if (cur && s >= cur.start && e <= cur.end) {
        add(cur, item);
        continue;
      }
      if (!cur && this.win.length && s >= this.winAt && e <= this.winAt + this.win.length) {
        cur = { index: this.queue.length, start: this.winAt, end: this.winAt + this.win.length, items: [], window: true, kept: true, bytes: Promise.resolve(this.win) };
      } else cur = { index: this.queue.length, start: s, end: Math.min(size, s + WINDOW), items: [], window: true };
      this.queue.push(cur);
      add(cur, item);
    }
    this.pump();
  }

  /** 항목을 처음 읽을 자리(region이 처음 부르는 range와 같다 — 파일 밖은 잘라 낸다) */
  private headRange(item: ZipItem): [number, number] {
    const size = this.src.size;
    const p = item.localOffset;
    const s = clamp(p, size);
    return [s, Math.max(s, clamp(p + 30 + utf8.encode(item.name).length + EXTRA_GUESS + item.compressedSize, size))];
  }

  private send(a: Ahead): void {
    if (a.bytes || a.done) return;
    this.reads++;
    this.sent++;
    this.held += a.end - a.start;
    this.open++;
    this.mostOpen = Math.max(this.mostOpen, this.open);
    a.bytes = this.src.read(a.start, a.end).finally(() => this.open--);
    // 받아 갈 때 다시 본다(처리되지 않은 거부로 남지 않게)
    a.bytes.catch(() => undefined);
  }

  private drop(a: Ahead): void {
    if (a.done) return;
    a.done = true;
    for (const it of a.items) if (this.aheadOf.get(it) === a) this.aheadOf.delete(it);
    a.items = [];
    if (a.bytes && !a.kept) {
      this.sent--;
      this.held -= a.end - a.start;
    }
    a.bytes = undefined;
  }

  private pump(): void {
    while (this.next < this.queue.length && this.sent < AHEAD_READS && this.held < AHEAD_BYTES) this.send(this.queue[this.next++]!);
  }

  /** 계획한 항목의 처음 자리 바이트(미리 읽은 것). 계획에 없거나 미리 읽기가 실패하면 null */
  private async planned(item: ZipItem, s: number, e: number): Promise<Uint8Array | null> {
    const a = this.aheadOf.get(item);
    if (!a) return null;
    this.aheadOf.delete(item);
    // 받아 간 차례보다 앞선 읽기는 쓰지 않는다(계획과 달리 건너뛴 항목)
    for (; this.low < a.index; this.low++) this.drop(this.queue[this.low]!);
    this.send(a);
    const pending = a.bytes!;
    a.items = a.items.filter((it) => it !== item);
    let got: Uint8Array<ArrayBuffer> | null;
    try {
      got = await pending;
    } catch {
      got = null;
    }
    if (!a.items.length) this.drop(a);
    this.pump();
    if (!got || s < a.start) return null;
    // 받아 간 작은 항목 덩이가 지금 덩이(range와 다음 계획이 쓴다 — 하나씩 읽을 때 마지막으로 읽은 덩이와 같다)
    if (a.window) {
      this.win = got;
      this.winAt = a.start;
    }
    return got.subarray(s - a.start, Math.min(e - a.start, got.length));
  }

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
    const [hs, he] = this.headRange(item);
    let b = (await this.planned(item, hs, he)) ?? (await this.range(p, p + 30 + utf8.encode(item.name).length + EXTRA_GUESS + item.compressedSize));
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

  /**
   * 압축된 내용을 덩이씩 읽어 줄 곳(zipItemData와 같은 검사 — 깨진 머리·파일 끝을 넘는 내용은 Error).
   * 파일이 Blob이면 그 자리(file)도 알려 풀기 워커가 직접 읽을 수 있게 한다(49차 — 그쪽 읽기는 reads에 세지 않는다)
   */
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
      ...(src.blob ? { file: { blob: src.blob, start } } : {}),
    };
  }
}

/** 이 크기까지는 지문을 내장 SHA-256(crypto.subtle)으로 한 번에 구한다(파일을 다 읽어도 작다) */
const NATIVE_DIGEST_MAX = 8 * 1024 * 1024;
/** 지문을 구할 때 한 번에 읽는 덩이(다음 덩이를 미리 하나 더 읽어 둔다) */
const DIGEST_BLOCK = 4 * READ_BLOCK;

/**
 * 파일 내용 SHA-256(32바이트) — 파일 전체 바이트로 구한 값과 같다. 작은 파일은 내장 crypto.subtle로 한 번에, 큰 파일(또는 내장이 없을 때 —
 * 보안 연결이 아닌 쪽)은 DIGEST_BLOCK씩 읽으며 sha256.ts로 구해 많아야 덩이 둘을 든다. nativeMax로 문턱을 바꾼다(시험).
 * 다 읽은 덩이는 GC를 기다리지 않고 곧바로 놓는다(41차 — read는 부르는 쪽 것인 새 배열을 준다. 165 MB 파일의 지문 워커가
 * 다 쓴 덩이를 GC까지 쥐어 ArrayBuffer가 60~70 MB까지 쌓였다 — 화면이 장면을 올리는 동안이라 렌더러 프로세스 최고치 무렵과 겹친다)
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
    freeTyped(b);
  }
  return h.digest();
}
