/**
 * 길이를 모르고 쌓는 형식 배열(장면 배열 — scene.ts, 면·모서리 표 — entities.ts). 두 배씩 키우며 쌓고, 끝에 꼭 맞는 길이로 낸다.
 *
 * 큰 모형에서 이 배열들이 장면 배열 크기의 몇 배를 잡았다: 키울 때마다 새로 잡고 복사한 옛 버퍼는 GC를 기다리며 쌓이고,
 * 끝에 slice로 한 벌 더 복사한 뒤에도 쌓던 큰 버퍼를 함수가 끝날 때까지 붙들었다(165 MB 모형: 장면 배열 200 MB에 external +560 MB).
 * 그래서 ArrayBuffer.prototype.transfer(새 길이)를 쓸 수 있으면(현대 브라우저, Node 21+) 키울 때와 끝낼 때 옛 버퍼를 곧바로
 * 떼어 놓고(detach — GC를 기다리지 않고 놓인다), 끝낸 배열을 쌓던 배열 자리에 둔다. 없으면 예전처럼 복사하되 끝낸 뒤에는
 * 큰 버퍼를 붙들지 않는다. 어느 길이든 내는 값은 같다.
 */

type Typed = Float64Array | Float32Array | Uint32Array | Int32Array | Uint8Array;

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

/**
 * 다 쓴 배열의 버퍼를 곧바로 놓는다(ArrayBuffer.prototype.transfer(0)으로 떼어 낸다 — GC를 기다리지 않는다). 버퍼를 함께 쓰는 다른 배열도 길이 0이 되므로
 * 그 버퍼를 혼자 지닌 쪽만 부른다. transfer가 없거나 SharedArrayBuffer·이미 뗀 버퍼면 아무것도 하지 않는다(그때는 예전처럼 GC가 놓는다). 놓았으면 true
 */
export function freeTyped(a: Typed | null | undefined): boolean {
  const buf = a?.buffer;
  if (!nativeTransfer || !(buf instanceof ArrayBuffer) || !buf.byteLength) return false;
  nativeTransfer.call(buf, 0);
  return true;
}

/**
 * 두 배씩 키우는 쌓기. a[0, n)이 쌓은 값이다(쓰는 쪽이 reserve 뒤 a에 바로 쓰고 n을 옮긴다).
 * 51차: 쌓을 자리(cap = a.length)를 따로 들고, 꼴별 쌓기(F64·F32·U32·I32·U8)를 하위 클래스가 아니라 이 클래스 하나로 만든다.
 * 하위 클래스 다섯이면 V8이 reserve·push 안의 this.n·this.a.length 읽기를 여러 숨은 꼴(map)과 여러 배열 꼴로 보고 느린 길로 돌았다
 * (165 MB 표본 장면 만들기에서 정의 준비가 면마다 부르는 reserve만 50 ms 남짓). 쌓는 값·키우는 크기·낸 배열은 같다
 */
export class Grow<T extends Typed> {
  a: T;
  n = 0;
  /** a의 길이(쌓을 자리) — a를 바꾸는 곳(만들 때·키울 때·끝낼 때)에서만 함께 바꾼다 */
  cap: number;
  constructor(
    private readonly C: TypedCtor<T>,
    size: number,
  ) {
    this.a = new C(size);
    this.cap = size;
  }
  /** k개를 더 쓸 자리 */
  reserve(k: number): void {
    if (this.n + k <= this.cap) return;
    this.grow(k);
  }
  private grow(k: number): void {
    let size = Math.max(1, this.a.length * 2);
    while (size < this.n + k) size *= 2;
    this.a = resizeTyped(this.a, this.n, size, this.C);
    this.cap = size;
  }
  push(v: number): void {
    if (this.n >= this.cap) this.grow(1);
    this.a[this.n++] = v;
  }
  /** 쌓은 값만큼의 배열(쌓던 큰 버퍼는 놓는다). 끝낸 뒤 다시 부르면 같은 배열 — 끝낸 뒤에는 더 쌓지 않는다 */
  done(): T {
    if (this.cap !== this.n) {
      this.a = resizeTyped(this.a, this.n, this.n, this.C);
      this.cap = this.n;
    }
    return this.a;
  }
}

/** 꼴별 쌓기를 만드는 함수에 new를 붙여 부르는 꼴(new F64(n) — 돌려준 Grow가 그대로 결과다) */
type GrowCtor<T extends Typed> = new (size?: number) => Grow<T>;
const growOf = <T extends Typed>(C: TypedCtor<T>): GrowCtor<T> =>
  function (size = 1024): Grow<T> {
    return new Grow(C, size);
  } as unknown as GrowCtor<T>;

export type F64 = Grow<Float64Array>;
export const F64 = growOf(Float64Array);
export type F32 = Grow<Float32Array>;
export const F32 = growOf(Float32Array);
export type U32 = Grow<Uint32Array>;
export const U32 = growOf(Uint32Array);
export type I32 = Grow<Int32Array>;
export const I32 = growOf(Int32Array);
export type U8 = Grow<Uint8Array>;
export const U8 = growOf(Uint8Array);
