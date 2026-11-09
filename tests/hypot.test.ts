/**
 * 세 값의 길이 hypot3: Math.hypot(x, y, z)와 같은 값(이 시험이 도는 V8에서는 비트까지)을 내는지 넓은 범위의 값으로 견준다.
 * 장면 만들기(법선 옮기기·면 법선·무늬 평면 틀)와 법선 줄이기가 Math.hypot 대신 쓴다 — 값이 하나라도 다르면 장면 바이트가 바뀐다.
 * 51차에 앱이 V8 셈을 옮긴 사본(src/hypot.ts)을 두었고, 54차에 같은 셈을 코어 0.51.0이 내보내 그것을 쓴다(사본은 지웠다 —
 * 51·53차 장면도 Math.hypot과 비트까지 같았으므로 이 시험이 지나면 장면 바이트가 같다).
 */
import { describe, expect, it } from 'vitest';
import { hypot3 } from 'opencad-viewer3d/math';

/** 시험마다 같은 값이 나오는 작은 난수 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('hypot3 — Math.hypot과 같은 값', () => {
  it('특수 값: 0·−0·NaN·무한·아주 작은 값·아주 큰 값', () => {
    const vals = [0, -0, 1, -1, 3, 4, 12, NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-310, Number.MAX_VALUE, -Number.MAX_VALUE, 1e300, 1e-300, 0.1, 2 ** 52 + 1];
    for (const x of vals) for (const y of vals) for (const z of vals) expect(Object.is(hypot3(x, y, z), Math.hypot(x, y, z)), `${x}, ${y}, ${z}`).toBe(true);
  });

  it('단위 법선 가까이(Float32로 적은 값) 20만 개', () => {
    const r = rng(51);
    const f = new Float32Array(3);
    for (let i = 0; i < 200_000; i++) {
      f[0] = r() * 2 - 1;
      f[1] = r() * 2 - 1;
      f[2] = r() * 2 - 1;
      const l = Math.hypot(f[0]!, f[1]!, f[2]!);
      f[0] = f[0]! / l;
      f[1] = f[1]! / l;
      f[2] = f[2]! / l;
      const a = hypot3(f[0]!, f[1]!, f[2]!);
      if (a !== Math.hypot(f[0]!, f[1]!, f[2]!)) expect([f[0], f[1], f[2], a]).toEqual(Math.hypot(f[0]!, f[1]!, f[2]!));
    }
  });

  it('크기가 크게 다른 값(10^−300 ~ 10^300, 부호 섞임) 20만 개', () => {
    const r = rng(7);
    const v = (): number => (r() < 0.5 ? -1 : 1) * r() * 10 ** Math.floor(r() * 600 - 300);
    for (let i = 0; i < 200_000; i++) {
      const x = v();
      const y = r() < 0.1 ? 0 : v();
      const z = r() < 0.1 ? x : v();
      const a = hypot3(x, y, z);
      if (!Object.is(a, Math.hypot(x, y, z))) expect([x, y, z, a]).toEqual(Math.hypot(x, y, z));
    }
  });

  it('여인수 행렬로 옮긴 법선처럼 축마다 배율이 다른 값 20만 개', () => {
    const r = rng(3);
    for (let i = 0; i < 200_000; i++) {
      const x = (r() * 2 - 1) * 25.4 * 25.4;
      const y = (r() * 2 - 1) * 0.001;
      const z = (r() * 2 - 1) * 1e5;
      const a = hypot3(x, y, z);
      if (a !== Math.hypot(x, y, z)) expect([x, y, z, a]).toEqual(Math.hypot(x, y, z));
    }
  });
});
