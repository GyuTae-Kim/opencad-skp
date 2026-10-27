/**
 * SketchUp 2020 이하 본문(MFC CArchive 객체 직렬화) 바이트 커서.
 * 형식 지식은 MFC 직렬화 규칙(Microsoft "TN002: Persistent Object Data Format", CArchive 설명)과,
 * 사용자가 허락한 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 legacy 부분에서 옮긴 것이다(docs/formats/skp.md).
 *
 * 객체 꼬리표(u16):
 *   0x0000 없음(null) · 0xFFFF 새 클래스(u16 스키마, u16 이름 길이, ASCII 이름) 뒤에 그 객체 ·
 *   0x8000 | n 칸 n 클래스의 새 객체 · n(< 0x7FFF) 이미 읽은 객체 칸 n 참조 ·
 *   0x7FFF + u32 = 칸이 0x7FFF 이상일 때(0x80000000이 서 있으면 클래스 칸).
 * 클래스와 객체가 칸 번호 하나를 같이 센다(칸 0 = 없음). 객체는 칸을 먼저 받고 나서 칸을 읽으므로 안쪽 칸이 바깥 객체를 되가리킬 수 있다.
 * 문자열(CString): u8 길이, 0xFF면 u16, 그것도 0xFFFF면 u32. 0xFF 0xFFFE가 앞에 오면 UTF-16LE(그 뒤 길이를 다시 같은 꼴로).
 * 기록에 길이가 없어서 모르는 클래스는 건너뛸 수 없다 — 읽는 함수가 없는 클래스를 만나면 거기서 멈춘다(MfcError 'unsupported').
 */

export type MfcErrorKind = 'truncated' | 'corrupt' | 'unsupported' | 'too_large';

/** 읽기를 멈춘 까닭과 자리 */
export class MfcError extends Error {
  readonly kind: MfcErrorKind;
  readonly offset: number;
  constructor(kind: MfcErrorKind, message: string, offset: number) {
    super(message);
    this.kind = kind;
    this.offset = offset;
  }
}

const NEW_CLASS_TAG = 0xffff;
const CLASS_TAG = 0x8000;
const BIG_OBJECT_TAG = 0x7fff;
const BIG_CLASS_TAG = 0x80000000;
const MAX_CLASS_NAME = 64;

/** 클래스 칸의 값 */
const CLASS = Symbol('class');
/** 칸을 읽고 있는 객체의 값(읽는 함수가 칸 값을 먼저 정하지 않았을 때) */
export const IN_PROGRESS = Symbol('in-progress');
/**
 * 너그럽게 읽은 참조가 맞지 않을 때의 값(readObject의 lenient). 참조 꼬리표는 클래스와 관계없이 2(또는 6)바이트라
 * 칸 번호 하나가 깨져도 뒤 바이트 줄은 그대로다 — 그 참조만 버리고 이어 읽는다
 */
export const BAD_REF = Symbol('bad-ref');

/** 클래스 하나를 읽는 함수: 받은 칸 번호 → 그 객체의 값(참조로 다시 돌려줄 값) */
export type MfcReadFn = (slot: number) => unknown;

const utf16 = new TextDecoder('utf-16le');

export class MfcStream {
  readonly b: Uint8Array;
  readonly dv: DataView;
  pos: number;
  readonly end: number;
  /** 칸마다 클래스 이름(객체 칸은 그 객체의 클래스) */
  readonly names: string[] = [''];
  /** 칸마다 값(클래스 칸은 CLASS) */
  readonly values: unknown[] = [null];
  readonly readers = new Map<string, MfcReadFn>();
  /** 마지막 readObject가 돌려준 객체의 클래스(없음이면 '') */
  lastClass = '';
  /** 칸 수 한도(객체·클래스 합) */
  maxRecords: number;
  /** 새 객체를 하나 읽을 때마다(진행 알림용) */
  onObject: (() => void) | undefined;
  /** 너그럽게 읽다 버린 참조 수와 첫 자리(readObject의 lenient) */
  badRefs = 0;
  firstBadRef = -1;

  constructor(b: Uint8Array, pos: number, maxRecords: number) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.pos = pos;
    this.end = b.length;
    this.maxRecords = maxRecords;
  }

  // ── 낱값 ──────────────────────────────────────────────────────

  /** n바이트가 남았는지 */
  need(n: number): void {
    if (n < 0 || this.pos + n > this.end) throw new MfcError('truncated', '파일이 끝나기 전에 잘렸습니다', this.pos);
  }

  u8(): number {
    this.need(1);
    return this.b[this.pos++]!;
  }

  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  vec3(): [number, number, number] {
    this.need(24);
    const p = this.pos;
    this.pos = p + 24;
    return [this.dv.getFloat64(p, true), this.dv.getFloat64(p + 8, true), this.dv.getFloat64(p + 16, true)];
  }

  doubles(n: number): number[] {
    this.need(8 * n);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.dv.getFloat64(this.pos + 8 * i, true);
    this.pos += 8 * n;
    return out;
  }

  /** n바이트(복사 없는 보기) */
  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  /** u32 개수: 한도를 넘거나 남은 바이트보다 크면 깨진 것 */
  count(limit: number, what: string): number {
    const at = this.pos;
    const v = this.u32();
    if (v > limit || v > this.end - this.pos) throw new MfcError('corrupt', `${what} 수 ${v}가 말이 되지 않습니다`, at);
    return v;
  }

  /** CString(좁은 글은 latin-1, 0xFF 0xFFFE 앞붙이면 UTF-16LE) */
  cstr(): string {
    const at = this.pos;
    let n = this.u8();
    let wide = false;
    if (n === 0xff) {
      n = this.u16();
      if (n === 0xfffe) {
        wide = true;
        n = this.u8();
        if (n === 0xff) {
          n = this.u16();
          if (n === 0xffff) n = this.u32();
        }
      } else if (n === 0xffff) n = this.u32();
    }
    const size = wide ? 2 * n : n;
    if (this.pos + size > this.end) throw new MfcError('truncated', `${n}자 문자열이 파일 끝을 넘습니다(파일이 잘렸습니다)`, at);
    const p = this.pos;
    this.pos += size;
    if (!size) return '';
    if (wide) return utf16.decode(this.b.subarray(p, p + size));
    let s = '';
    for (let i = p; i < p + size; i++) s += String.fromCharCode(this.b[i]!);
    return s;
  }

  // ── 객체 ──────────────────────────────────────────────────────

  /**
   * 객체 포인터 하나: 읽는 함수의 값(참조면 그 칸의 값), 없음이면 null.
   * expected를 주면 그 클래스가 아닌 객체·참조는 깨진 것으로 본다.
   * lenient면 이미 읽은 객체를 가리키는 참조가 맞지 않을 때(아직 없는 칸·클래스 칸·다른 클래스) 던지지 않고 BAD_REF를 돌려준다
   * (새 객체는 그 뒤 바이트를 읽는 법이 클래스마다 달라 늘 던진다).
   */
  readObject(expected?: ReadonlySet<string>, lenient = false): unknown {
    const at = this.pos;
    let tag = this.u16();
    if (tag === 0) {
      this.lastClass = '';
      return null;
    }
    if (tag === BIG_OBJECT_TAG) {
      tag = this.u32();
      if (tag & BIG_CLASS_TAG) return this.newObject(this.className((tag & ~BIG_CLASS_TAG) >>> 0, at), expected, at);
    } else if (tag >= CLASS_TAG) {
      if (tag === NEW_CLASS_TAG) return this.newClassObject(expected, at);
      return this.newObject(this.className(tag & ~CLASS_TAG, at), expected, at);
    }
    // 이미 읽은 객체 참조
    if (tag >= this.names.length) return this.badRef(lenient, `아직 읽지 않은 칸 ${tag}를 가리킵니다`, at);
    const value = this.values[tag];
    if (value === CLASS) return this.badRef(lenient, `클래스 칸 ${tag}를 객체로 가리킵니다`, at);
    const name = this.names[tag]!;
    if (expected && !expected.has(name)) return this.badRef(lenient, `${[...expected].join('/')} 자리에 ${name} 참조가 있습니다`, at);
    this.lastClass = name;
    return value;
  }

  private badRef(lenient: boolean, message: string, at: number): typeof BAD_REF {
    if (!lenient) throw new MfcError('corrupt', message, at);
    if (!this.badRefs++) this.firstBadRef = at;
    this.lastClass = '';
    return BAD_REF;
  }

  private newClassObject(expected: ReadonlySet<string> | undefined, at: number): unknown {
    this.u16(); // 스키마: 옛 파일은 CVersionMap으로 스키마를 알린다(내려 저장한 파일은 여기에 지금 판 스키마를 적는다)
    const size = this.u16();
    if (!(size > 0 && size <= MAX_CLASS_NAME)) throw new MfcError('corrupt', `클래스 이름 길이 ${size}가 말이 되지 않습니다`, at);
    const raw = this.bytes(size);
    let name = '';
    for (const c of raw) name += String.fromCharCode(c < 0x80 ? c : 0xfffd);
    this.claim(at);
    this.names.push(name);
    this.values.push(CLASS);
    return this.newObject(name, expected, at);
  }

  private className(index: number, at: number): string {
    if (index >= this.names.length || this.values[index] !== CLASS) throw new MfcError('corrupt', `객체 꼬리표가 클래스가 아닌 칸 ${index}를 가리킵니다`, at);
    return this.names[index]!;
  }

  private claim(at: number): void {
    if (this.values.length >= this.maxRecords) throw new MfcError('too_large', `객체가 ${this.maxRecords.toLocaleString('en-US')}개를 넘습니다`, at);
  }

  private newObject(name: string, expected: ReadonlySet<string> | undefined, at: number): unknown {
    if (expected && !expected.has(name)) throw new MfcError('corrupt', `${[...expected].join('/')} 자리에 새 ${name} 객체가 있습니다`, at);
    const reader = this.readers.get(name);
    if (!reader) throw new MfcError('unsupported', `아직 읽지 못하는 기록 ${name}`, at);
    this.claim(at);
    const slot = this.values.length;
    this.names.push(name);
    this.values.push(IN_PROGRESS);
    this.onObject?.();
    const value = reader(slot);
    this.values[slot] = value;
    this.lastClass = name;
    return value;
  }
}
