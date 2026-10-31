/**
 * 요소 바탕 한 번에 읽기(33차 — src/vffcommon.ts readBase, src/tlv.ts firstIn):
 * 바탕(07d0)의 자식을 한 번만 돌아도 32차까지의 식(꼬리표마다 r.first — 아래 옛 식)과 같은 값을 내고,
 * 길이가 넘친 자식이 있으면 그 앞에서 찾지 못한 꼬리표에서 같은 글로 던지는지(차례·겹친 꼬리표·빈 내용·없는 바탕) 본다.
 */
import { describe, expect, it } from 'vitest';
import { concat, tlv, u16, u32, u8, uintLE } from './build';
import { TlvReader, type TlvNode } from '../src/tlv';
import { readBase, type BaseInfo } from '../src/vffcommon';
import { TAG } from '../src/vfftags';

/** 32차 readBase(꼬리표마다 r.first) */
function oldReadBase(r: TlvReader, n: TlvNode): BaseInfo {
  const base = r.first(n, TAG.BASE);
  if (!base) return { flags: 0 };
  const out: BaseInfo = { flags: r.u8(r.first(base, TAG.FLAGS)) ?? 0 };
  const header = r.first(base, TAG.ID_BOX);
  if (header) out.header = header;
  const id = header && r.uint(r.first(header, TAG.ID));
  if (id !== undefined) out.id = id;
  const m = r.uint(r.first(base, TAG.MATERIAL));
  if (m !== undefined) out.material = m;
  const l = r.uint(r.first(base, TAG.LAYER));
  if (l !== undefined) out.layer = l;
  return out;
}

/** 길이가 실제보다 긴 자식(그 자리에서 목록이 깨진다) */
const overflow = (tag: number, payload: Uint8Array, extra: number): Uint8Array => concat([u16(tag), u32(payload.length + extra), payload]);

const call = (fn: () => BaseInfo): BaseInfo | string => {
  try {
    return fn();
  } catch (e) {
    return `throw: ${(e as Error).message}`;
  }
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8;
}

/** 바탕 자식 후보: 깃발·머리(번호)·재질·태그·모르는 꼬리표, 빈 내용·긴 번호 */
function child(r: () => number): Uint8Array {
  switch (r() % 8) {
    case 0:
      return tlv(TAG.FLAGS, u8(r() & 255));
    case 1:
      return tlv(TAG.ID_BOX, tlv(TAG.ID, uintLE(r() % 100000)));
    case 2:
      return tlv(TAG.MATERIAL, uintLE(r() % 500));
    case 3:
      return tlv(TAG.LAYER, uintLE(r() % 70));
    case 4:
      return tlv(0x07d9, u8(1));
    case 5:
      return tlv([TAG.FLAGS, TAG.MATERIAL, TAG.LAYER][r() % 3]!);
    case 6:
      return tlv(TAG.ID_BOX, tlv(0x05dd, u8(0)));
    default:
      return tlv(TAG.MATERIAL, new Uint8Array(9).fill(255));
  }
}

describe('요소 바탕 한 번에 읽기(33차)', () => {
  it('차례·겹친 꼬리표·빈 내용이 섞인 바탕에서 옛 식과 같은 값, 넘친 자식은 같은 글로 던진다', () => {
    const r = rng(5);
    let threw = 0;
    for (let k = 0; k < 3000; k++) {
      const kids: Uint8Array[] = [];
      const n = r() % 7;
      for (let i = 0; i < n; i++) kids.push(child(r));
      // 넘친 자식(바탕 안 어디든, 또는 바탕 머리를 감싼 요소 쪽)
      const broken = r() % 4 === 0;
      if (broken) kids.splice(r() % (kids.length + 1), 0, overflow([TAG.FLAGS, TAG.MATERIAL, 0x07d9][r() % 3]!, u8(1), 1 + (r() % 40)));
      const baseBytes = concat(kids);
      const wrapper = r() % 10 === 0 ? concat([tlv(0x09c5, u8(0)), tlv(TAG.BASE, baseBytes)]) : r() % 15 === 0 ? tlv(0x09c5, u8(0)) : tlv(TAG.BASE, baseBytes);
      const bytes = concat([wrapper, tlv(0x1234, u8(9))]);
      const reader = new TlvReader(bytes);
      const node: TlvNode = { tag: 0, start: 0, end: bytes.length };
      const want = call(() => oldReadBase(reader, node));
      const got = call(() => readBase(reader, node));
      expect(got).toEqual(want);
      if (typeof want === 'string') threw++;
    }
    expect(threw).toBeGreaterThan(50);
  });

  it('firstIn은 first와 같다(범위로)', () => {
    const bytes = concat([tlv(1, u8(1)), tlv(2, u8(2)), tlv(1, u8(3)), overflow(3, u8(4), 5)]);
    const r = new TlvReader(bytes);
    const n: TlvNode = { tag: 0, start: 0, end: bytes.length };
    expect(r.firstIn(0, bytes.length, 2)).toEqual(r.first(n, 2));
    expect(r.firstIn(0, bytes.length, 1)).toEqual({ tag: 1, start: 6, end: 7 });
    expect(() => r.firstIn(0, bytes.length, 9)).toThrow(/꼬리표 0x3 @21/);
    expect(() => r.first(n, 9)).toThrow(/꼬리표 0x3 @21/);
  });
});
