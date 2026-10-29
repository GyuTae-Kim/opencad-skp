/**
 * 조각으로 받는 SHA-256(src/sha256.ts): 길이(덩이 경계 둘레)와 나눠 넣는 방법에 상관없이 node:crypto와 같은 값.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, sha256 } from '../src/sha256';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const ref = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('Sha256', () => {
  it('알려진 값', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('덩이 경계 둘레 길이마다 node:crypto와 같다', () => {
    const data = new Uint8Array(randomBytes(70_000));
    for (const n of [1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 16_383, 16_384, 16_385, 16_448, 70_000]) {
      const b = data.subarray(0, n);
      expect(hex(sha256(b)), `길이 ${n}`).toBe(ref(b));
    }
  });

  it('어떻게 나눠 넣어도 같다(빈 조각·1바이트 조각·덩이를 걸친 조각, 다른 버퍼의 보기)', () => {
    const all = new Uint8Array(randomBytes(200_000));
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 8) % n;
    };
    for (const max of [1, 7, 64, 100, 5000, 40_000]) {
      // 작은 조각은 짧은 바이트로(조각 수를 수만 개 안으로)
      const data = all.subarray(0, Math.min(all.length, max * 3000));
      const want = ref(data);
      const h = new Sha256();
      for (let p = 0; p < data.length; ) {
        const k = Math.min(data.length - p, rnd(max + 1));
        // 다른 버퍼의 가운데를 보는 배열로도 넣는다
        const host = new Uint8Array(k + 10);
        host.set(data.subarray(p, p + k), 5);
        h.update(host.subarray(5, 5 + k));
        p += k;
      }
      expect(hex(h.digest()), `조각 최대 ${max}`).toBe(want);
    }
  });

  it('수 MB를 한 번에 넣어도 같다', () => {
    const data = new Uint8Array(randomBytes(3 * 1024 * 1024 + 17));
    expect(hex(new Sha256().update(data.subarray(0, 1_000_001)).update(data.subarray(1_000_001)).digest())).toBe(ref(data));
  });
});
