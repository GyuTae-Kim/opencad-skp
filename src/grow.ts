/**
 * 길이를 모르고 쌓는 형식 배열(장면 배열 — scene.ts). 두 배씩 키우며 쌓고, 끝에 꼭 맞는 길이로 낸다.
 *
 * 큰 모형에서 이 배열들이 장면 배열 크기의 몇 배를 잡았다: 키울 때마다 새로 잡고 복사한 옛 버퍼는 GC를 기다리며 쌓이고,
 * 끝에 slice로 한 벌 더 복사한 뒤에도 쌓던 큰 버퍼를 함수가 끝날 때까지 붙들었다(165 MB 모형: 장면 배열 200 MB에 external +560 MB).
 * 그래서 ArrayBuffer.prototype.transfer(새 길이)를 쓸 수 있으면(현대 브라우저, Node 21+) 키울 때와 끝낼 때 옛 버퍼를 곧바로
 * 떼어 놓고(detach — GC를 기다리지 않고 놓인다), 끝낸 배열을 쌓던 배열 자리에 둔다. 없으면 예전처럼 복사하되 끝낸 뒤에는
 * 큰 버퍼를 붙들지 않는다. 어느 길이든 내는 값은 같다.
 */

type Typed = Float32Array | Uint32Array | Int32Array;

interface TypedCtor<T extends Typed> {
  new (length: number): T;
  new (buffer: ArrayBuffer): T;
  readonly BYTES_PER_ELEMENT: number;
}

type Transfer = (this: ArrayBuffer, newByteLength?: number) => ArrayBuffer;
const nativeTransfer = (ArrayBuffer.prototype as unknown as { transfer?: Transfer }).transfer;

/** 이 실행 환경에서 ArrayBuffer.prototype.transfer를 쓰는지 */
export const CAN_TRANSFER = typeof nativeTransfer === 'function';

/**
 * a의 앞 keep개를 지닌 길이 size 배열. useTransfer면 a의 버퍼를 옮겨(a는 떼어져 길이 0이 된다) 늘리거나 줄인다.
 * 늘린 자리는 0이다(새로 잡은 배열과 같다)
 */
export function resizeTyped<T extends Typed>(a: T, keep: number, size: number, C: TypedCtor<T>, useTransfer = CAN_TRANSFER): T {
  const buf = a.buffer;
  const had = a.length;
  if (useTransfer && nativeTransfer && buf instanceof ArrayBuffer && a.byteOffset === 0 && a.byteLength === buf.byteLength) {
    const out = new C(nativeTransfer.call(buf, size * C.BYTES_PER_ELEMENT));
    // 옮긴 버퍼는 a의 쌓은 값 뒤(keep 뒤)도 지닌다 — 새로 잡은 배열처럼 0으로
    if (keep < size && keep < had) out.fill(0, keep, Math.min(size, had));
    return out;
  }
  const b = new C(size);
  b.set(a.subarray(0, Math.min(keep, size)) as never);
  return b;
}

/** 두 배씩 키우는 쌓기. a[0, n)이 쌓은 값이다(쓰는 쪽이 reserve 뒤 a에 바로 쓰고 n을 옮긴다) */
class Grow<T extends Typed> {
  a: T;
  n = 0;
  constructor(
    private readonly C: TypedCtor<T>,
    size: number,
  ) {
    this.a = new C(size);
  }
  /** k개를 더 쓸 자리 */
  reserve(k: number): void {
    if (this.n + k <= this.a.length) return;
    let size = Math.max(1, this.a.length * 2);
    while (size < this.n + k) size *= 2;
    this.a = resizeTyped(this.a, this.n, size, this.C);
  }
  push(v: number): void {
    this.reserve(1);
    this.a[this.n++] = v;
  }
  /** 쌓은 값만큼의 배열(쌓던 큰 버퍼는 놓는다). 끝낸 뒤 다시 부르면 같은 배열 — 끝낸 뒤에는 더 쌓지 않는다 */
  done(): T {
    if (this.a.length !== this.n) this.a = resizeTyped(this.a, this.n, this.n, this.C);
    return this.a;
  }
}

export class F32 extends Grow<Float32Array> {
  constructor(size = 1024) {
    super(Float32Array, size);
  }
}

export class U32 extends Grow<Uint32Array> {
  constructor(size = 1024) {
    super(Uint32Array, size);
  }
}

export class I32 extends Grow<Int32Array> {
  constructor(size = 1024) {
    super(Int32Array, size);
  }
}
