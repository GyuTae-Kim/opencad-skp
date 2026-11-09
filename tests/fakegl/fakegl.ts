/**
 * 시험용 가짜 WebGL2 문맥(브라우저 없이 Renderer3d·Viewer3d를 돌린다).
 * 3D 뷰어 코어(opencad-viewer3d, MIT) 시험 도우미 tests/fakegl.ts를 이 앱이 고정한 코어 판(972d344)에서 그대로 옮겼다(55차 — 코어 구간 단면·PBR 그림을
 * 앱 장면으로 확인하려고). 코어 판을 올려 렌더러가 새 GL 호출을 쓰면 그 판의 같은 파일로 바꾼다.
 *
 * - 버퍼마다 바이트 내용을 실제로 들고(bufferData·bufferSubData), 올린 횟수·바이트를 센다 — "다른 묶음 버퍼를 다시 올리지 않았는지" 시험용
 * - VAO마다 속성(버퍼·크기·간격·시작)과 색인 버퍼를 기록하고, 그리기 호출마다 그 버퍼들의 내용 해시와 쓰는 프로그램의 균일 변수 값을
 *   그리기 기록(draws)에 남긴다 — 서로 다른 GPU 객체로 그린 두 뷰어가 같은 것을 그렸는지 값으로 견준다
 * - 셰이더 번역·연결은 늘 성공, 확장은 없음, 틀 버퍼는 늘 완전
 */

export interface FakeBuffer {
  id: number;
  bytes: Uint8Array;
  /** bufferData 횟수(크기 잡기 포함) */
  dataCalls: number;
  /** bufferSubData 횟수 */
  subCalls: number;
  /** 올린 바이트(bufferData(배열)·bufferSubData) */
  uploaded: number;
  deleted: boolean;
  ver: number;
  hash?: { ver: number; h: string };
}

export interface Attrib {
  buf: FakeBuffer | null;
  size: number;
  stride: number;
  offset: number;
  divisor: number;
  enabled: boolean;
  /** 0.26.0: 값 꼴 상수 이름(FLOAT·BYTE·SHORT·UNSIGNED_SHORT)과 정규화 — 그리기 기록에는 FLOAT·정규화 아님이 아닐 때만 붙인다(예전 기록과 같게) */
  type: string;
  norm: boolean;
}

interface FakeVao {
  id: number;
  attribs: Map<number, Attrib>;
  element: FakeBuffer | null;
  deleted: boolean;
}

interface FakeProgram {
  id: number;
  shaders: { src: string }[];
  key: string;
  uniforms: Map<string, unknown[]>;
}

export interface DrawEntry {
  op: string;
  args: number[];
  prog: string;
  attribs: string[];
  element: string | null;
  uniforms: string;
  /** 0.25.0: 묶인 무늬(단위 이름:올린 그림 꼬리표 — logTextures를 켰을 때만) */
  tex?: string;
}

/** 0.25.0: 가짜 무늬(texImage2D로 올린 그림의 꼬리표를 든다) */
export interface FakeTexture {
  id: number;
  /** 올린 그림의 tag(없으면 가로x세로), 올리지 않았으면 '' */
  src: string;
  /** texImage2D 횟수 */
  uploads: number;
  deleted: boolean;
  /** 0.42.0: 크기만 잡은(9인자) 그림의 가로·세로와 texSubImage2D로 올린 실수 텍셀(RGBA — 자리 자료 그림 시험용) */
  w?: number;
  h?: number;
  floats?: Float32Array;
}

/** FNV-1a 32비트(바이트) */
export function fnv(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let h = 0x811c9dc5;
  for (let i = start; i < end; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const strHash = (s: string): string => fnv(new TextEncoder().encode(s));

function viewBytes(src: ArrayBufferView, srcOffset = 0, length?: number): Uint8Array {
  const bpe = (src as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
  const n = length ?? src.byteLength / bpe - srcOffset;
  return new Uint8Array(src.buffer, src.byteOffset + srcOffset * bpe, n * bpe);
}

export class FakeGL {
  readonly buffers: FakeBuffer[] = [];
  readonly vaos: FakeVao[] = [];
  draws: DrawEntry[] = [];
  /** 그리기 기록을 남길지(시험이 견줄 때만 켠다) */
  logDraws = false;
  /** 0.25.0: 그리기 기록에 묶인 무늬의 그림 꼬리표도 남길지 */
  logTextures = false;
  readonly textures: FakeTexture[] = [];
  private unit: number | null = null;
  private texUnits = new Map<number, FakeTexture | null>();
  canvas: { width: number; height: number };
  private ids = 0;
  private consts = new Map<string, number>();
  private arrayBinding: FakeBuffer | null = null;
  private defaultVao: FakeVao = { id: 0, attribs: new Map(), element: null, deleted: false };
  private vao: FakeVao = this.defaultVao;
  private prog: FakeProgram | null = null;
  private fb: unknown = null;

  constructor(canvas: { width: number; height: number } = { width: 800, height: 600 }) {
    this.canvas = canvas;
    // 대문자 상수는 이름마다 다른 수(같은 이름은 같은 수), 없는 메서드는 아무것도 하지 않는 함수
    return new Proxy(this, {
      get: (t, k, r) => {
        if (typeof k === 'string' && !(k in t)) {
          if (/^[A-Z][A-Z0-9_]*$/.test(k)) {
            let v = t.consts.get(k);
            if (v === undefined) t.consts.set(k, (v = 0x1000 + t.consts.size));
            return v;
          }
          return () => undefined;
        }
        return Reflect.get(t, k, r);
      },
    });
  }

  get drawingBufferWidth(): number {
    return this.canvas.width;
  }
  get drawingBufferHeight(): number {
    return this.canvas.height;
  }

  private C(name: string): number {
    return (this as unknown as Record<string, number>)[name]!;
  }

  // ── 버퍼 ──
  createBuffer(): FakeBuffer {
    const b: FakeBuffer = { id: ++this.ids, bytes: new Uint8Array(0), dataCalls: 0, subCalls: 0, uploaded: 0, deleted: false, ver: 0 };
    this.buffers.push(b);
    return b;
  }
  deleteBuffer(b: FakeBuffer | null): void {
    if (b) b.deleted = true;
  }
  private bound(target: number): FakeBuffer | null {
    return target === this.C('ELEMENT_ARRAY_BUFFER') ? this.vao.element : this.arrayBinding;
  }
  bindBuffer(target: number, b: FakeBuffer | null): void {
    if (target === this.C('ELEMENT_ARRAY_BUFFER')) this.vao.element = b;
    else this.arrayBinding = b;
  }
  bufferData(target: number, src: number | ArrayBufferView, _usage: number): void {
    const b = this.bound(target);
    if (!b) throw new Error('bufferData: 묶인 버퍼가 없습니다');
    if (b.deleted) throw new Error('bufferData: 지운 버퍼');
    b.dataCalls++;
    b.ver++;
    if (typeof src === 'number') b.bytes = new Uint8Array(src);
    else {
      b.bytes = viewBytes(src).slice();
      b.uploaded += b.bytes.length;
    }
  }
  bufferSubData(target: number, dst: number, src: ArrayBufferView, srcOffset = 0, length?: number): void {
    const b = this.bound(target);
    if (!b) throw new Error('bufferSubData: 묶인 버퍼가 없습니다');
    if (b.deleted) throw new Error('bufferSubData: 지운 버퍼');
    const bytes = viewBytes(src, srcOffset, length);
    if (dst + bytes.length > b.bytes.length) throw new Error(`bufferSubData: 버퍼 밖(${dst}+${bytes.length} > ${b.bytes.length})`);
    b.bytes.set(bytes, dst);
    b.subCalls++;
    b.uploaded += bytes.length;
    b.ver++;
  }

  // ── VAO ──
  createVertexArray(): FakeVao {
    const v: FakeVao = { id: ++this.ids, attribs: new Map(), element: null, deleted: false };
    this.vaos.push(v);
    return v;
  }
  deleteVertexArray(v: FakeVao | null): void {
    if (v) v.deleted = true;
  }
  bindVertexArray(v: FakeVao | null): void {
    if (v?.deleted) throw new Error('bindVertexArray: 지운 VAO');
    this.vao = v ?? this.defaultVao;
  }
  private attrib(i: number): Attrib {
    let a = this.vao.attribs.get(i);
    if (!a) this.vao.attribs.set(i, (a = { buf: null, size: 4, stride: 0, offset: 0, divisor: 0, enabled: false, type: 'FLOAT', norm: false }));
    return a;
  }
  /** 0.26.0: VAO의 속성 하나(시험이 속성 꼴을 본다) */
  attribOf(v: FakeVao, i: number): Attrib | undefined {
    return v.attribs.get(i);
  }
  enableVertexAttribArray(i: number): void {
    this.attrib(i).enabled = true;
  }
  disableVertexAttribArray(i: number): void {
    this.attrib(i).enabled = false;
  }
  vertexAttribPointer(i: number, size: number, type: number, norm: boolean, stride: number, offset: number): void {
    const a = this.attrib(i);
    a.buf = this.arrayBinding;
    a.size = size;
    a.stride = stride;
    a.offset = offset;
    a.type = this.nameOf(type) ?? String(type);
    a.norm = !!norm;
  }
  vertexAttribDivisor(i: number, d: number): void {
    this.attrib(i).divisor = d;
  }

  // ── 프로그램 ──
  createShader(): { src: string } {
    return { src: '' };
  }
  shaderSource(s: { src: string }, src: string): void {
    s.src = src;
  }
  getShaderParameter(): boolean {
    return true;
  }
  /** 0.42.0: KHR_parallel_shader_compile 흉내(parallel이 켜졌을 때만 확장을 준다) — COMPLETION_STATUS_KHR(0x91B1)는 compileDone */
  parallel = false;
  compileDone = true;
  getProgramParameter(_p: unknown, pname?: number): boolean {
    if (pname === 0x91b1) return this.compileDone;
    return true;
  }
  createProgram(): FakeProgram {
    return { id: ++this.ids, shaders: [], key: '', uniforms: new Map() };
  }
  attachShader(p: FakeProgram, s: { src: string }): void {
    p.shaders.push(s);
  }
  linkProgram(p: FakeProgram): void {
    p.key = strHash(p.shaders.map((s) => s.src).join('\n--\n'));
  }
  useProgram(p: FakeProgram | null): void {
    this.prog = p;
  }
  getUniformLocation(p: FakeProgram, name: string): { p: FakeProgram; name: string } {
    return { p, name };
  }
  private setU(loc: { p: FakeProgram; name: string } | null, v: unknown[]): void {
    if (!loc) return;
    loc.p.uniforms.set(loc.name, v.map((x) => (ArrayBuffer.isView(x) ? Array.from(x as Float32Array) : x)));
  }
  uniform1f(l: { p: FakeProgram; name: string }, ...v: number[]): void {
    this.setU(l, v);
  }
  uniform2f(l: { p: FakeProgram; name: string }, ...v: number[]): void {
    this.setU(l, v);
  }
  uniform3f(l: { p: FakeProgram; name: string }, ...v: number[]): void {
    this.setU(l, v);
  }
  uniform4f(l: { p: FakeProgram; name: string }, ...v: number[]): void {
    this.setU(l, v);
  }
  uniform1i(l: { p: FakeProgram; name: string }, ...v: number[]): void {
    this.setU(l, v);
  }
  uniform4fv(l: { p: FakeProgram; name: string }, v: Float32Array): void {
    this.setU(l, [v]);
  }
  uniformMatrix3fv(l: { p: FakeProgram; name: string }, _t: boolean, v: Float32Array): void {
    this.setU(l, [v]);
  }
  uniformMatrix4fv(l: { p: FakeProgram; name: string }, _t: boolean, v: Float32Array): void {
    this.setU(l, [v]);
  }

  // ── 그 밖 ──
  getParameter(p: number): unknown {
    if (p === this.C('MAX_TEXTURE_SIZE') || p === this.C('MAX_RENDERBUFFER_SIZE')) return 4096;
    if (p === this.C('MAX_VIEWPORT_DIMS')) return new Int32Array([4096, 4096]);
    if (p === this.C('MAX_SAMPLES')) return 4;
    if (p === this.C('FRAMEBUFFER_BINDING')) return this.fb;
    return 0;
  }
  getContextAttributes(): { stencil: boolean } {
    return { stencil: true };
  }
  getExtension(name?: string): object | null {
    return this.parallel && name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 0x91b1 } : null;
  }
  isContextLost(): boolean {
    return false;
  }
  checkFramebufferStatus(): number {
    return this.C('FRAMEBUFFER_COMPLETE');
  }
  bindFramebuffer(_t: number, fb: unknown): void {
    this.fb = fb;
  }
  createTexture(): FakeTexture {
    const t: FakeTexture = { id: ++this.ids, src: '', uploads: 0, deleted: false };
    this.textures.push(t);
    return t;
  }
  deleteTexture(t: FakeTexture | null): void {
    if (t) t.deleted = true;
  }
  activeTexture(u: number): void {
    this.unit = u;
  }
  bindTexture(_target: number, t: FakeTexture | null): void {
    this.texUnits.set(this.unit ?? this.C('TEXTURE0'), t);
  }
  /** 0.25.0: 그림(ImageBitmap 꼴 — 6인자)을 올리면 그 tag(없으면 가로x세로)를 무늬에 적는다. 크기만 잡는 9인자는 'empty' */
  texImage2D(...a: unknown[]): void {
    const t = this.texUnits.get(this.unit ?? this.C('TEXTURE0'));
    if (!t) return;
    const src = a.length === 6 ? (a[5] as { tag?: string; width?: number; height?: number } | null) : null;
    t.src = src ? (src.tag ?? `${src.width}x${src.height}`) : 'empty';
    t.uploads++;
    if (a.length === 9) {
      t.w = a[3] as number;
      t.h = a[4] as number;
      t.floats = undefined;
    }
  }
  /** 0.42.0: 실수 배열(Float32Array)을 올리면 그 영역 텍셀을 무늬에 적는다(자리 자료 그림 — RGBA 4값) */
  texSubImage2D(_t: number, _l: number, x: number, y: number, w: number, h: number, _f: number, _ty: number, src: unknown, srcOffset = 0): void {
    const t = this.texUnits.get(this.unit ?? this.C('TEXTURE0'));
    if (!t || !(src instanceof Float32Array) || !t.w || !t.h) return;
    t.floats ??= new Float32Array(t.w * t.h * 4);
    for (let j = 0; j < h; j++) t.floats.set(src.subarray(srcOffset + j * w * 4, srcOffset + (j + 1) * w * 4), ((y + j) * t.w + x) * 4);
  }
  createFramebuffer(): object {
    return { id: ++this.ids };
  }
  createRenderbuffer(): object {
    return { id: ++this.ids };
  }

  // ── 그리기 ──
  private bufHash(b: FakeBuffer | null): string {
    if (!b) return '-';
    if (b.deleted) throw new Error('그리기: 지운 버퍼를 씁니다');
    if (b.hash?.ver !== b.ver) b.hash = { ver: b.ver, h: `${b.bytes.length}:${fnv(b.bytes)}` };
    return b.hash.h;
  }
  private log(op: string, args: number[]): void {
    if (this.vao.deleted) throw new Error('그리기: 지운 VAO');
    if (!this.logDraws) return;
    const attribs: string[] = [];
    for (const [i, a] of [...this.vao.attribs].sort((x, y) => x[0] - y[0]))
      if (a.enabled) attribs.push(`${i}:${a.size}/${a.stride}/${a.offset}/${a.divisor}${a.type === 'FLOAT' && !a.norm ? '' : `/${a.type}${a.norm ? 'n' : ''}`}:${this.bufHash(a.buf)}`);
    const p = this.prog;
    const uniforms = p ? JSON.stringify([...p.uniforms].sort((x, y) => (x[0] < y[0] ? -1 : 1))) : '';
    const e: DrawEntry = { op, args, prog: p?.key ?? '', attribs, element: this.vao.element ? this.bufHash(this.vao.element) : null, uniforms };
    if (this.logTextures) {
      const name = (u: number): string => [...this.consts].find(([, v]) => v === u)?.[0] ?? String(u);
      e.tex = [...this.texUnits]
        .filter(([, t]) => t && !t.deleted)
        .map(([u, t]) => `${name(u)}:${t!.src}`)
        .sort()
        .join(',');
    }
    this.draws.push(e);
  }
  drawArrays(mode: number, first: number, count: number): void {
    this.log('drawArrays', [mode, first, count]);
  }
  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.log('drawElements', [mode, count, type, offset]);
  }
  drawArraysInstanced(mode: number, first: number, count: number, n: number): void {
    this.log('drawArraysInstanced', [mode, first, count, n]);
  }
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, n: number): void {
    this.log('drawElementsInstanced', [mode, count, type, offset, n]);
  }
  /** 0.42.0: 지금 무늬 단위에 묶인 무늬(자리 자료 그림 — 단위 5) */
  textureAt(unit: number): FakeTexture | null {
    return this.texUnits.get(this.C('TEXTURE0') + unit) ?? null;
  }

  /**
   * 0.25.0: 상수 값 → 이름(없으면 null). 상수 값은 문맥마다 처음 쓴 차례로 정해지므로, 부르는 차례가 다른 두 뷰어(문맥 복구 등)의
   * 그리기 기록을 견줄 때 그리기 꼴(TRIANGLES 등)·색인 꼴을 이름으로 바꿔 견준다
   */
  nameOf(v: number): string | null {
    for (const [k, x] of this.consts) if (x === v) return k;
    return null;
  }

  /** 지우지 않은 버퍼 수 */
  get liveBuffers(): number {
    return this.buffers.filter((b) => !b.deleted).length;
  }
}

/** 2D 캔버스 문맥 흉내(덧그림·뷰 큐브): 모든 호출을 받아 넘기고 값은 들고만 있는다 */
export function fake2d(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', globalAlpha: 1 };
  const ret = { width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, addColorStop() {} };
  return new Proxy(store, {
    get: (t, k) => (k in t ? t[k] : () => ret),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
