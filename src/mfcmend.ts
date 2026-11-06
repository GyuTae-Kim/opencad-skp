/**
 * SketchUp 2020 이하(MFC) 파일의 "글 왕복" 손상을 알아보고 고쳐 읽는 데 쓰는 도구(docs/formats/skp.md "글 왕복 손상").
 *
 * SKP 파일은 UTF-16LE 표지(FF FE)로 시작한다. 어떤 글 도구가 파일 전체를 UTF-16LE 글로 읽었다가 줄 끝을 고르며 다시 쓰면
 * 짝수 자리 낱자 CR(0D 00)이 LF(0A 00)로 바뀌고 줄·문단 나눔 U+2028·U+2029(28 20·29 20)가 지워진다.
 * 2바이트가 빠지면 기록 길이가 없는 MFC 흐름이 거기서 어긋나 형상 읽기가 멈춘다.
 * 실제 2015 파일 하나(10.4 MB)는 짝수 자리 CR·U+2028·U+2029가 0개인데 홀수 자리는 CR 7,471·U+2028 20·U+2029 22개였고,
 * 멈춘 자리의 모서리 참조 `FF 7F 28 20 01 00`에서 `28 20`이 빠져 있었다(고리를 닫는 유일한 모서리로 확인).
 *
 * 알아보는 법(textRoundTrip): 짝수 자리 CR·U+2028·U+2029가 하나도 없고 홀수 자리 CR이 MIN_ODD_CR개 이상.
 * 손상과 관계없는 파일이 우연히 그럴 확률은 짝·홀이 고른 바이트에서 약 2^-MIN_ODD_CR이다.
 * 이 꼴일 때만, 그리고 보통 읽기가 형상에서 멈췄을 때만 고쳐 읽는다(멀쩡한 파일은 예전 길 그대로).
 */

/** 짝수 자리 CR이 없을 때 손상으로 볼 홀수 자리 CR 수 */
export const MIN_ODD_CR = 16;
/** 메울 수 있는 곳 수(사본에 미리 잡는 자리) */
export const MAX_MENDS = 4096;

/** 글 왕복 꼴의 근거(센 수) */
export interface TextRoundTrip {
  /** 홀수 자리 CR(0D 00) 수(짝수 자리는 0) */
  oddCr: number;
  /** 홀수 자리 U+2028·U+2029 수(짝수 자리는 0) */
  oddSeparators: number;
  /** 짝수 자리 LF(0A 00) 수 — CR이 바뀐 것이 섞여 홀수 자리보다 많다 */
  evenLf: number;
  oddLf: number;
}

/** 파일 전체를 짝수·홀수 자리 UTF-16LE 낱자로 세어 글 왕복 꼴이면 그 수, 아니면 null */
export function textRoundTrip(b: Uint8Array): TextRoundTrip | null {
  let oddCr = 0;
  let oddSeparators = 0;
  let evenLf = 0;
  let oddLf = 0;
  const n = b.length - 1;
  for (let p = 0; p < n; p++) {
    const hi = b[p + 1]!;
    if (hi === 0) {
      const lo = b[p]!;
      if (lo === 0x0d) {
        if (!(p & 1)) return null;
        oddCr++;
      } else if (lo === 0x0a) {
        if (p & 1) oddLf++;
        else evenLf++;
      }
    } else if (hi === 0x20) {
      const lo = b[p]!;
      if (lo === 0x28 || lo === 0x29) {
        if (!(p & 1)) return null;
        oddSeparators++;
      }
    }
  }
  return oddCr >= MIN_ODD_CR ? { oddCr, oddSeparators, evenLf, oddLf } : null;
}

/**
 * 빠진 2바이트를 메워 가는 바이트 사본. 시험 넣기(put)는 한 곳만 들고, 자리를 옮길 때는 그 사이 바이트만 민다
 * (파일 전체를 옮기는 것은 첫 시험 넣기 한 번). keep으로 굳히고 drop으로 거둔다.
 */
export class MendBuffer {
  private readonly buf: Uint8Array;
  /** 굳힌 길이(시험 넣기 2바이트는 뺀 것) */
  private used: number;
  /** 시험으로 넣어 둔 자리(-1 없음) */
  private trial = -1;
  /** 굳힌 넣기 자리(그때의 사본 자리, 굳힌 차례) */
  readonly inserts: number[] = [];

  constructor(src: Uint8Array, room = MAX_MENDS) {
    this.buf = new Uint8Array(src.length + 2 * room);
    this.buf.set(src);
    this.used = src.length;
  }

  /** 지금 읽을 바이트(시험 넣기 포함) */
  view(): Uint8Array {
    return this.buf.subarray(0, this.used + (this.trial >= 0 ? 2 : 0));
  }

  /** 더 넣을 자리가 있는지 */
  get roomLeft(): boolean {
    return this.used + 2 <= this.buf.length;
  }

  /** 시험 넣기가 없을 때 자리 p의 바이트 */
  byteAt(p: number): number {
    return this.buf[p]!;
  }

  /** 자리 q(지금 굳힌 사본 자리)에 낱자 unit(리틀 엔디언 2바이트)을 시험으로 넣는다 — 앞서 시험으로 넣은 것은 옮긴다 */
  put(q: number, unit: number): void {
    const b = this.buf;
    const t = this.trial;
    if (t < 0) b.copyWithin(q + 2, q, this.used);
    else if (q < t) b.copyWithin(q + 2, q, t);
    else if (q > t) b.copyWithin(t, t + 2, q + 2);
    b[q] = unit & 0xff;
    b[q + 1] = unit >> 8;
    this.trial = q;
  }

  /** 시험 넣기를 거둔다 */
  drop(): void {
    const t = this.trial;
    if (t < 0) return;
    this.buf.copyWithin(t, t + 2, this.used + 2);
    this.trial = -1;
  }

  /** 시험 넣기를 굳힌다 */
  keep(): void {
    if (this.trial < 0) return;
    this.inserts.push(this.trial);
    this.used += 2;
    this.trial = -1;
  }

  /** 사본 자리 → 원래 파일 자리(넣은 바이트 자체면 -1) */
  toOriginal(p: number): number {
    for (let k = this.inserts.length - 1; k >= 0; k--) {
      const q = this.inserts[k]!;
      if (p >= q + 2) p -= 2;
      else if (p >= q) return -1;
    }
    return p;
  }
}
