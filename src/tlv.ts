/**
 * SketchUp 2021 이후 model.dat의 꼬리표-길이-값(TLV) 읽기.
 * 바이트에서 확인한 꼴: [u16 꼬리표][u32 길이][길이만큼 내용], 모두 리틀 엔디언. 내용은 자식 TLV들이거나 값이다.
 * 어느 꼬리표가 묶음인지는 자료에 적혀 있지 않아 해석기가 아는 경로로만 내려간다(모르는 꼬리표는 길이로 건너뛴다).
 * 값 꼴: 식별 번호(영구 번호)는 길이 1~8바이트의 부호 없는 리틀 엔디언 정수, 좌표·평면·변환은 f64 배열, 이름은 UTF-8.
 */

/** 내용 범위 [start, end)와 꼬리표 */
export interface TlvNode {
  tag: number;
  start: number;
  end: number;
}

const utf8 = new TextDecoder('utf-8');

export class TlvReader {
  readonly b: Uint8Array;
  readonly dv: DataView;
  constructor(b: Uint8Array) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  /** [start, end) 안의 자식 TLV를 차례로 돈다. 길이가 범위를 넘으면 Error */
  each(start: number, end: number, fn: (tag: number, s: number, e: number) => void): void {
    let p = start;
    while (p < end) {
      if (p + 6 > end) throw new Error(`TLV 머리가 잘렸습니다(@${p})`);
      const tag = this.dv.getUint16(p, true);
      const len = this.dv.getUint32(p + 2, true);
      const s = p + 6;
      const e = s + len;
      if (e > end) throw new Error(`TLV 길이가 범위를 넘습니다(꼬리표 0x${tag.toString(16)} @${p})`);
      fn(tag, s, e);
      p = e;
    }
  }

  /**
   * 깨진 곳을 견디며 돈다: 머리가 잘렸거나 길이가 범위를 넘는 자식을 만나면 거기서 멈추고 false(그 앞 자식은 모두 넘겼다).
   * clip이면 길이가 넘친 그 자식을 범위 끝까지 잘라 clipped = true로 한 번 넘긴다 — 잘린 파일에서 묶음(목록)의 앞부분을 살리는 용도.
   * 값(좌표·이름) 꼬리표는 잘린 것을 쓰면 안 되므로, 받는 쪽이 묶음 꼬리표일 때만 clipped를 쓴다.
   */
  eachSafe(start: number, end: number, fn: (tag: number, s: number, e: number, clipped: boolean) => void, clip = false): boolean {
    let p = start;
    while (p < end) {
      if (p + 6 > end) return false;
      const tag = this.dv.getUint16(p, true);
      const len = this.dv.getUint32(p + 2, true);
      const s = p + 6;
      const e = s + len;
      if (e > end) {
        if (clip && s < end) fn(tag, s, end, true);
        return false;
      }
      fn(tag, s, e, false);
      p = e;
    }
    return true;
  }

  /** 첫 자식 중 꼬리표가 같은 것을 깨진 곳 앞까지만 찾는다(clip이면 길이가 넘친 그 자식도 잘라서 돌려준다) */
  firstSafe(n: TlvNode, tag: number, clip = false): TlvNode | undefined {
    let found: TlvNode | undefined;
    let p = n.start;
    while (p + 6 <= n.end) {
      const t = this.dv.getUint16(p, true);
      const len = this.dv.getUint32(p + 2, true);
      const e = p + 6 + len;
      if (e > n.end) {
        if (clip && t === tag) found = { tag: t, start: p + 6, end: n.end };
        break;
      }
      if (t === tag) return { tag: t, start: p + 6, end: e };
      p = e;
    }
    return found;
  }

  children(n: TlvNode): TlvNode[] {
    const out: TlvNode[] = [];
    this.each(n.start, n.end, (tag, start, end) => out.push({ tag, start, end }));
    return out;
  }

  /** 첫 자식 중 꼬리표가 같은 것 */
  first(n: TlvNode, tag: number): TlvNode | undefined {
    return this.firstIn(n.start, n.end, tag);
  }

  /** [start, end) 안 첫 자식 중 꼬리표가 같은 것(first와 같다 — 노드 객체 없이 범위로) */
  firstIn(start: number, end: number, tag: number): TlvNode | undefined {
    let p = start;
    while (p + 6 <= end) {
      const t = this.dv.getUint16(p, true);
      const len = this.dv.getUint32(p + 2, true);
      const e = p + 6 + len;
      if (e > end) throw new Error(`TLV 길이가 범위를 넘습니다(꼬리표 0x${t.toString(16)} @${p})`);
      if (t === tag) return { tag: t, start: p + 6, end: e };
      p = e;
    }
    return undefined;
  }

  /** 경로를 따라 첫 자식으로 내려간다 */
  path(n: TlvNode, ...tags: number[]): TlvNode | undefined {
    let cur: TlvNode | undefined = n;
    for (const t of tags) {
      if (!cur) return undefined;
      cur = this.first(cur, t);
    }
    return cur;
  }

  /**
   * 길이만큼의 부호 없는 리틀 엔디언 정수(번호·참조, 1~8바이트).
   * 8바이트를 넘거나 값이 2^53 이상이면(JS 수로 정확히 나타낼 수 없다) undefined = 찾지 못함.
   */
  uint(n: TlvNode | undefined): number | undefined {
    if (!n || n.end <= n.start || n.end - n.start > 8) return undefined;
    return this.uintAt(n.start, n.end - n.start);
  }

  /** [p, p+size) 부호 없는 리틀 엔디언 정수(2^53 이상이면 undefined) */
  private uintAt(p: number, size: number): number | undefined {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < size; i++) {
      v += this.b[p + i]! * mul;
      mul *= 256;
    }
    return v <= Number.MAX_SAFE_INTEGER ? v : undefined;
  }

  /**
   * 묶은 번호 목록([u8 크기 n][n바이트 번호]의 반복). 크기가 8을 넘거나 범위를 넘으면 거기서 멈추고 ok = false.
   * 2^53 이상인 번호는 빼고 unsafe로 센다.
   */
  packedIds(n: TlvNode | undefined): { ids: number[]; ok: boolean; unsafe: number } {
    const ids: number[] = [];
    let unsafe = 0;
    if (!n) return { ids, ok: true, unsafe };
    let p = n.start;
    while (p < n.end) {
      const size = this.b[p]!;
      p++;
      if (size > 8 || p + size > n.end) return { ids, ok: false, unsafe };
      const v = this.uintAt(p, size);
      if (v === undefined) unsafe++;
      else ids.push(v);
      p += size;
    }
    return { ids, ok: true, unsafe };
  }

  u8(n: TlvNode | undefined): number | undefined {
    return n && n.end > n.start ? this.b[n.start] : undefined;
  }

  i32(n: TlvNode | undefined): number | undefined {
    return n && n.end - n.start >= 4 ? this.dv.getInt32(n.start, true) : undefined;
  }

  /** 꼭 4바이트인 i32(크기가 다르면 undefined) */
  i32Exact(n: TlvNode | undefined): number | undefined {
    return n && n.end - n.start === 4 ? this.dv.getInt32(n.start, true) : undefined;
  }

  /** 꼭 8바이트인 f64(크기가 다르면 undefined) */
  f64Exact(n: TlvNode | undefined): number | undefined {
    return n && n.end - n.start === 8 ? this.dv.getFloat64(n.start, true) : undefined;
  }

  /** 꼭 8×count바이트인 f64 배열(크기가 다르면 undefined) */
  f64n(n: TlvNode | undefined, count: number): number[] | undefined {
    if (!n || n.end - n.start !== 8 * count) return undefined;
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = this.dv.getFloat64(n.start + 8 * i, true);
    return out;
  }

  /** 꼭 24바이트인 f64×3 */
  vec3(n: TlvNode | undefined): [number, number, number] | undefined {
    if (!n || n.end - n.start !== 24) return undefined;
    return [this.dv.getFloat64(n.start, true), this.dv.getFloat64(n.start + 8, true), this.dv.getFloat64(n.start + 16, true)];
  }

  /** u8 깃발: 첫 바이트가 0이 아니면 참(빈 내용은 거짓). 꼬리표가 없으면 undefined */
  flag(n: TlvNode | undefined): boolean | undefined {
    return n ? n.end > n.start && this.b[n.start] !== 0 : undefined;
  }

  /** 내용 바이트 사본(큰 model.dat 버퍼를 붙잡지 않게 복사한다) */
  bytes(n: TlvNode): Uint8Array {
    return this.b.slice(n.start, n.end);
  }

  f64(n: TlvNode, i: number): number {
    return this.dv.getFloat64(n.start + 8 * i, true);
  }

  /** f64 배열(내용 길이가 8의 배수가 아니면 남는 바이트는 버린다) */
  f64s(n: TlvNode | undefined): number[] | undefined {
    if (!n) return undefined;
    const k = Math.floor((n.end - n.start) / 8);
    const out = new Array<number>(k);
    for (let i = 0; i < k; i++) out[i] = this.dv.getFloat64(n.start + 8 * i, true);
    return out;
  }

  str(n: TlvNode | undefined): string | undefined {
    return n ? utf8.decode(this.b.subarray(n.start, n.end)) : undefined;
  }
}
