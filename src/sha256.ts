/**
 * SHA-256(FIPS 180-4)을 조각조각 받아 구한다 — 의존성 없음. 앱은 파일 내용 지문(측정 도구가 안내를 파일별로 기억하는 열쇠)을
 * 파일 전체 바이트를 한 번에 들지 않고 구하려고 쓴다(브라우저 내장 crypto.subtle.digest는 한 버퍼만 받는다).
 * 값은 내장 SHA-256과 같다(tests/sha256.test.ts가 node:crypto와 견준다).
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 압축 함수를 한 번에 돌리는 길이 */
const STEP = 16 * 1024;

/** SHA-256 조각 받기: update로 차례대로 넣고 digest로 32바이트를 받는다(digest 뒤에는 다시 쓰지 않는다) */
export class Sha256 {
  private readonly h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly w = new Int32Array(64);
  /** 64바이트를 다 채우지 못한 꼬리 */
  private readonly tail = new Uint8Array(64);
  private tailLen = 0;
  /** 받은 바이트 수(2^53까지) */
  private total = 0;

  update(data: Uint8Array): this {
    let o = 0;
    const n = data.length;
    this.total += n;
    if (this.tailLen) {
      const k = Math.min(64 - this.tailLen, n);
      this.tail.set(data.subarray(0, k), this.tailLen);
      this.tailLen += k;
      o = k;
      if (this.tailLen < 64) return this;
      this.blocks(this.tail, 0, 64);
      this.tailLen = 0;
    }
    const whole = o + ((n - o) & ~63);
    // 16 KiB씩 나눠 부른다: 큰 조각 하나를 한 번에 넘기면 엔진이 그 긴 반복을 최적화하기 전까지 느리게 돈다(처음 64 MB가 세 배 느렸다)
    for (let s = o; s < whole; s += STEP) this.blocks(data, s, Math.min(whole, s + STEP));
    if (whole < n) {
      this.tail.set(data.subarray(whole), 0);
      this.tailLen = n - whole;
    }
    return this;
  }

  digest(): Uint8Array {
    const bits = this.total * 8;
    const pad = new Uint8Array(this.tailLen < 56 ? 64 : 128);
    pad.set(this.tail.subarray(0, this.tailLen));
    pad[this.tailLen] = 0x80;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits >>> 0;
    const e = pad.length;
    pad[e - 8] = hi >>> 24;
    pad[e - 7] = hi >>> 16;
    pad[e - 6] = hi >>> 8;
    pad[e - 5] = hi;
    pad[e - 4] = lo >>> 24;
    pad[e - 3] = lo >>> 16;
    pad[e - 2] = lo >>> 8;
    pad[e - 1] = lo;
    this.blocks(pad, 0, e);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const v = this.h[i]!;
      out[4 * i] = v >>> 24;
      out[4 * i + 1] = v >>> 16;
      out[4 * i + 2] = v >>> 8;
      out[4 * i + 3] = v;
    }
    return out;
  }

  /** [from, to) 64바이트 덩이들 */
  private blocks(b: Uint8Array, from: number, to: number): void {
    const w = this.w;
    const h = this.h;
    let h0 = h[0]!,
      h1 = h[1]!,
      h2 = h[2]!,
      h3 = h[3]!,
      h4 = h[4]!,
      h5 = h[5]!,
      h6 = h[6]!,
      h7 = h[7]!;
    for (let p = from; p < to; p += 64) {
      for (let i = 0, q = p; i < 16; i++, q += 4) w[i] = (b[q]! << 24) | (b[q + 1]! << 16) | (b[q + 2]! << 8) | b[q + 3]!;
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15]!;
        const y = w[i - 2]!;
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
      }
      let a = h0,
        bb = h1,
        c = h2,
        d = h3,
        e = h4,
        f = h5,
        g = h6,
        hh = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = bb;
        bb = a;
        a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0;
      h1 = (h1 + bb) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
      h5 = (h5 + f) | 0;
      h6 = (h6 + g) | 0;
      h7 = (h7 + hh) | 0;
    }
    h[0] = h0;
    h[1] = h1;
    h[2] = h2;
    h[3] = h3;
    h[4] = h4;
    h[5] = h5;
    h[6] = h6;
    h[7] = h7;
  }
}

/** 한 번에 받기(시험·작은 바이트용) */
export function sha256(data: Uint8Array): Uint8Array {
  return new Sha256().update(data).digest();
}
