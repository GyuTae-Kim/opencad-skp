/**
 * 장면 배열 쌓기(src/grow.ts): 버퍼를 옮겨 키우든(transfer) 복사해 키우든 쌓은 값과 낸 배열이 같고,
 * 끝낸 배열은 꼭 맞는 길이이며 쌓던 큰 버퍼를 붙들지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { CAN_TRANSFER, F32, F64, Grow, I32, U32, U8, freeTyped, resizeTyped } from '../src/grow';

describe('장면 배열 쌓기', () => {
  it('51차: 꼴별 쌓기는 모두 같은 클래스(Grow)이고, 쌓을 자리(cap)는 늘 배열 길이와 같다 — 키우는 크기는 예전처럼 두 배씩', () => {
    const all = [new F64(), new F32(3), new U32(1), new I32(0), new U8(5)];
    for (const g of all) {
      expect(g).toBeInstanceOf(Grow);
      expect(Object.getPrototypeOf(g)).toBe(Grow.prototype);
      expect(g.cap).toBe(g.a.length);
    }
    expect(all.map((g) => g.a.constructor)).toEqual([Float64Array, Float32Array, Uint32Array, Int32Array, Uint8Array]);
    expect(new F64().a.length).toBe(1024);
    // 0칸에서 시작해도 push가 1 → 2 → 4 …로 키운다
    const z = new I32(0);
    const caps: number[] = [];
    for (let i = 0; i < 9; i++) {
      z.push(-i);
      caps.push(z.cap);
      expect(z.cap).toBe(z.a.length);
    }
    expect(caps).toEqual([1, 2, 4, 4, 8, 8, 8, 8, 16]);
    expect(Array.from(z.done())).toEqual([0, -1, -2, -3, -4, -5, -6, -7, -8]);
    expect(z.cap).toBe(9);
    // reserve는 모자랄 때만 키우고(한 번에 여러 배), 넉넉하면 그대로
    const f = new F32(3);
    f.reserve(3);
    expect(f.cap).toBe(3);
    f.n = 3;
    f.reserve(10);
    expect([f.cap, f.a.length]).toEqual([24, 24]);
    expect(f.done().length).toBe(3);
    expect([f.cap, f.a.length]).toEqual([3, 3]);
  });

  it('resizeTyped: 옮기든 복사하든 앞 keep개와 0으로 채운 뒤가 같다', () => {
    for (const useTransfer of [true, false]) {
      const a = new Float32Array(8);
      for (let i = 0; i < 8; i++) a[i] = i + 1;
      // 쌓은 값(keep) 뒤에 남은 값은 새로 잡은 배열처럼 0이 된다
      const grown = resizeTyped(a, 5, 12, Float32Array, useTransfer);
      expect(Array.from(grown)).toEqual([1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0]);
      const b = Uint32Array.from([9, 8, 7, 6]);
      const shrunk = resizeTyped(b, 3, 3, Uint32Array, useTransfer);
      expect(Array.from(shrunk)).toEqual([9, 8, 7]);
      expect(shrunk.buffer.byteLength).toBe(12);
      if (useTransfer && CAN_TRANSFER) {
        // 옮긴 옛 버퍼는 떼어져 곧바로 놓인다
        expect(a.length).toBe(0);
        expect(b.buffer.byteLength).toBe(0);
      } else expect(a.length).toBe(8);
    }
  });

  it('여러 번 키워도 값이 그대로이고, done은 꼭 맞는 길이의 같은 배열', () => {
    const f = new F32();
    for (let i = 0; i < 5000; i++) {
      f.reserve(3);
      f.a[f.n++] = i;
      f.a[f.n++] = -i;
      f.a[f.n++] = i / 2;
    }
    const out = f.done();
    expect(out.length).toBe(15000);
    expect(out.buffer.byteLength).toBe(15000 * 4);
    expect([out[0], out[1], out[2], out[14997], out[14998], out[14999]]).toEqual([0, -0, 0, 4999, -4999, 2499.5]);
    // 다시 불러도 같은 배열(이미 꼭 맞다), 쌓던 자리도 그 배열이다
    expect(f.done()).toBe(out);
    expect(f.a).toBe(out);

    const u = new U32(1);
    for (let i = 0; i < 1000; i++) u.push(i * 7);
    const uo = u.done();
    expect(uo.length).toBe(1000);
    expect(uo[999]).toBe(6993);

    const c = new I32(64);
    c.reserve(10);
    c.a.fill(-1, 0, 10);
    c.n = 10;
    expect(Array.from(c.done())).toEqual(new Array(10).fill(-1));
    // 빈 쌓기는 길이 0
    expect(new F32().done().length).toBe(0);
  });

  it('freeTyped: 다 쓴 배열의 버퍼를 곧바로 떼어 놓는다(같은 버퍼의 다른 배열도 길이 0), 뗀 버퍼·빈 배열·없음은 그대로', () => {
    const a = Float64Array.from([1, 2, 3]);
    const view = new Uint8Array(a.buffer, 8, 8);
    if (CAN_TRANSFER) {
      expect(freeTyped(a)).toBe(true);
      expect(a.length).toBe(0);
      expect(a.buffer.byteLength).toBe(0);
      expect(view.length).toBe(0);
      expect(freeTyped(a)).toBe(false);
    } else {
      expect(freeTyped(a)).toBe(false);
      expect(a.length).toBe(3);
    }
    expect(freeTyped(new Float32Array(0))).toBe(false);
    expect(freeTyped(null)).toBe(false);
    expect(freeTyped(undefined)).toBe(false);
    if (typeof SharedArrayBuffer === 'function') {
      const sh = new Int32Array(new SharedArrayBuffer(16));
      expect(freeTyped(sh)).toBe(false);
      expect(sh.length).toBe(4);
    }
  });
});
