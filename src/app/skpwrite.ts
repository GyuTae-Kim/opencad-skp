/**
 * SKP 바이트 쓰기 도구: 공개 표본에서 확인한 구조(docs/formats/skp.md)를 손으로 옮긴 작은 쓰기 도구.
 * 브라우저의 예제 모형(sample.ts)과 시험(tests/build.ts)이 함께 쓴다. 의존성이 없어 브라우저·Node 어디서나 돈다.
 *
 * ZIP 압축은 바깥에서 넘긴다(compress). 넘기지 않으면 저장(무압축, 방식 0)으로 쓴다 — 해석기는 둘 다 읽는다.
 * 실제 SketchUp 파일을 흉내 내는 것은 해석기가 읽는 범위까지이고, SketchUp에서 다시 열리는 것은 확인하지 않았다.
 */

const enc = new TextEncoder();

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}

export function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
}

export function i32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
}

/** 가장 짧은 리틀 엔디언 정수(번호 꼴) */
export function uintLE(v: number): Uint8Array {
  const out: number[] = [];
  do {
    out.push(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return new Uint8Array(out);
}

export function f64(...vs: number[]): Uint8Array {
  const b = new Uint8Array(8 * vs.length);
  const dv = new DataView(b.buffer);
  vs.forEach((v, i) => dv.setFloat64(8 * i, v, true));
  return b;
}

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

/** [u16 꼬리표][u32 길이][내용] */
export function tlv(tag: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([u16(tag), u32(body.length), body]);
}

/** 번호 상자(05dc). attrs를 주면 속성 목록(05dd)을 함께 넣는다 */
export const idBox = (id: number, attrs?: Uint8Array): Uint8Array => tlv(0x05dc, tlv(0x05de, uintLE(id)), ...(attrs ? [tlv(0x05dd, attrs)] : []));

export interface BaseOpts {
  material?: number;
  layer?: number;
  flags?: number;
}

/** 면 한쪽 무늬 투영: 종류(0 그대로, 1 위치 잡음, 2·3 방향 투영), 행렬 9개(열 우선, 무늬 인치 → 면 평면 틀), 투영 방향 */
export interface TextureMapOpts {
  kind?: number;
  matrix: readonly number[];
  dir?: readonly [number, number, number];
}

const texSide = (o: TextureMapOpts): Uint8Array =>
  tlv(0x2713, tlv(0x2714, i32(o.kind ?? 1)), tlv(0x2715, f64(...o.matrix)), tlv(0x2716, f64(...(o.dir ?? [0, 0, 0]))), tlv(0x2717));

/** 면 무늬 위치 속성(36b1 → 36b2 → 2710 → 2711 앞·2712 뒤 → 2713 …) — 05dd 안에 넣는다 */
export function textureMapping(front?: TextureMapOpts, back?: TextureMapOpts): Uint8Array {
  const sides: Uint8Array[] = [tlv(0x36b0)];
  if (front) sides.push(tlv(0x2711, texSide(front)));
  if (back) sides.push(tlv(0x2712, texSide(back)));
  return tlv(0x36b1, tlv(0x36b2, tlv(0x2710, ...sides)));
}

export function base(id: number | undefined, o: BaseOpts & { attrs?: Uint8Array } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (id !== undefined) parts.push(idBox(id, o.attrs));
  if (o.material !== undefined) parts.push(tlv(0x07d1, uintLE(o.material)));
  if (o.layer !== undefined) parts.push(tlv(0x07d2, uintLE(o.layer)));
  parts.push(tlv(0x07d3, new Uint8Array([o.flags ?? 6])));
  return tlv(0x07d0, ...parts);
}

export const vertex = (id: number, x: number, y: number, z: number): Uint8Array => tlv(0x09c4, idBox(id), tlv(0x09c5, f64(x, y, z)));

export const edge = (id: number, a: number, b: number, o: BaseOpts = {}): Uint8Array =>
  tlv(0x0bb8, base(id, o), tlv(0x0bb9, uintLE(a)), tlv(0x0bba, uintLE(b)));

export interface FaceOpts extends BaseOpts {
  back?: number;
  /** 앞·뒷면 무늬 투영(무늬 위치 도구로 옮긴 무늬) */
  frontMap?: TextureMapOpts;
  backMap?: TextureMapOpts;
}

/** loops: 고리마다 [모서리 번호, 뒤집힘] */
export function face(id: number, plane: [number, number, number, number], loops: [number, boolean][][], o: FaceOpts = {}): Uint8Array {
  const attrs = o.frontMap || o.backMap ? textureMapping(o.frontMap, o.backMap) : undefined;
  const parts = [base(id, attrs ? { ...o, attrs } : o)];
  if (o.back !== undefined) parts.push(tlv(0x0daf, uintLE(o.back)));
  parts.push(tlv(0x0dad, f64(...plane)));
  parts.push(
    tlv(
      0x0dae,
      ...loops.map((l) =>
        tlv(0x1194, tlv(0x1195, ...l.map(([e, rev]) => tlv(0x0fa0, tlv(0x0fa1, uintLE(e)), tlv(0x0fa2, new Uint8Array([rev ? 1 : 0])))))),
      ),
    ),
  );
  return tlv(0x0dac, ...parts);
}

/** 13개 f64: 3×3 행 우선, 이동, 나눔수 */
export function instance(id: number, def: number, m13: number[], o: BaseOpts & { name?: string } = {}): Uint8Array {
  return tlv(
    0x1964,
    base(id, o),
    tlv(0x1965, utf8(o.name ?? '')),
    tlv(0x1966, f64(...m13)),
    tlv(0x1967, uintLE(def)),
    tlv(0x1968, new Uint8Array(16)),
  );
}

export const IDENTITY13 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface EntitiesOpts {
  vertices?: Uint8Array[];
  edges?: Uint8Array[];
  faces?: Uint8Array[];
  groups?: Uint8Array[];
  components?: Uint8Array[];
}

export function entities(id: number | undefined, o: EntitiesOpts): Uint8Array {
  const parts = [base(id)];
  parts.push(tlv(0x1389, ...(o.vertices ?? [])));
  parts.push(tlv(0x138a, ...(o.edges ?? [])));
  parts.push(tlv(0x138b, ...(o.faces ?? [])));
  if (o.groups) parts.push(tlv(0x138c, ...o.groups));
  if (o.components) parts.push(tlv(0x138d, ...o.components.map((c) => tlv(0x1d4c, c))));
  parts.push(tlv(0x139b, tlv(0x639f, tlv(0x63a0))));
  return tlv(0x1388, ...parts);
}

export interface ModelOpts {
  materials?: [number, string][];
  layers?: [number, string][];
  defaultLayer?: number;
  definitions?: { name: string; entities: Uint8Array }[];
  root: Uint8Array;
  lengthUnit?: number;
}

export function modelDat(o: ModelOpts): Uint8Array {
  const parts: Uint8Array[] = [tlv(0x020a, utf8('meta/meta.dat'))];
  if (o.lengthUnit !== undefined)
    parts.push(
      tlv(
        0x0200,
        tlv(
          0x61a8,
          tlv(
            0x61a9,
            tlv(
              0x61aa,
              tlv(0x61ab, utf8('UnitsOptions')),
              tlv(0x61ac, tlv(0x61ad, utf8('LengthFormat')), tlv(0x38a4, tlv(0x38a7, i32(1))), tlv(0x61ad, utf8('LengthUnit')), tlv(0x38a4, tlv(0x38a7, i32(o.lengthUnit)))),
            ),
          ),
        ),
      ),
    );
  parts.push(
    tlv(
      0x01f7,
      tlv(0x30d4, tlv(0x30d5, ...(o.materials ?? []).map(([id, n]) => tlv(0x32c8, idBox(id), tlv(0x32cc, utf8(n)), tlv(0x32ca, new Uint8Array([0])))))),
    ),
  );
  const layers = o.layers ?? [[1, 'Layer0']];
  parts.push(
    tlv(
      0x01f8,
      tlv(
        0x3a98,
        tlv(0x3a99, ...layers.map(([id, n]) => tlv(0x3c8c, idBox(id), tlv(0x3c8d, utf8(n)), tlv(0x3c8e, new Uint8Array([0]))))),
        tlv(0x3a9a, uintLE(o.defaultLayer ?? layers[0]![0])),
      ),
    ),
  );
  parts.push(
    tlv(
      0x01f9,
      tlv(
        0x1770,
        tlv(
          0x1771,
          tlv(0x0063, u32(0)),
          ...(o.definitions ?? []).map((d) => tlv(0x157c, d.entities, tlv(0x157d, new Uint8Array(16)), tlv(0x157e, utf8(d.name)))),
        ),
      ),
    ),
  );
  parts.push(tlv(0x01f6, o.root));
  return tlv(0x01f4, ...parts);
}

/** material.xml의 무늬(관찰한 꼴: texture 꼬리표 + images/image) */
export interface MaterialTextureOpts {
  /** 그림 파일 이름(재질 폴더 안) */
  file: string;
  /** 무늬 한 장 가로·세로(인치) */
  width: number;
  height: number;
  /** 원래 그림 평균색(avgColor로 ABGR 정수) */
  average?: readonly [number, number, number];
  /** 색을 바꾼 무늬(type 2)의 방식: 0 shift · 1 tint */
  colorizeType?: 0 | 1;
}

const xmlAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * material.xml 글. hasTexture이고 tex를 주면 texture 꼬리표를 넣는다(colorizeType이 있으면 type 2 — 색을 바꾼 무늬, 아니면 type 1).
 * rgb는 무늬 재질이면 무늬 평균색(type 1) 또는 바꾼 색(type 2)
 */
export function materialXml(name: string, rgb: [number, number, number], trans = 1, useTrans = 0, hasTexture = false, tex?: MaterialTextureOpts): string {
  const type = hasTexture && tex ? (tex.colorizeType !== undefined ? 2 : 1) : 0;
  const head = `  <mat:material name="${xmlAttr(name)}" type="${type}" colorRed="${rgb[0]}" colorGreen="${rgb[1]}" colorBlue="${rgb[2]}" colorizeType="${tex?.colorizeType ?? 0}" trans="${trans}" useTrans="${useTrans}" hasTexture="${hasTexture ? 1 : 0}"`;
  if (!(hasTexture && tex)) return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<materialDocument>\n${head} />\n</materialDocument>\n`;
  const a = tex.average;
  const avg = a ? ` avgColor="${((0xff << 24) | (a[2] << 16) | (a[1] << 8) | a[0]) >>> 0}"` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<materialDocument>\n' +
    `${head}>\n` +
    `    <mat:texture textureFilename="${xmlAttr(tex.file)}" xScale="${tex.width}" yScale="${tex.height}"${avg}>\n` +
    `      <mat:images>\n        <mat:image id="1" path="./${xmlAttr(tex.file)}" file_name="${xmlAttr(tex.file)}"/>\n      </mat:images>\n` +
    '    </mat:texture>\n  </mat:material>\n</materialDocument>\n'
  );
}

let crcTable: Uint32Array | null = null;

/** CRC-32(ZIP과 같은 다항식 0xEDB88320) */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32(zlib 꼬리) */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib 흐름(무압축 저장 블록만 — PNG 그림을 의존성 없이 만들려고) */
export function zlibStored(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let o = 0;
  do {
    const n = Math.min(65535, data.length - o);
    const last = o + n >= data.length ? 1 : 0;
    parts.push(new Uint8Array([last, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff]), data.subarray(o, o + n));
    o += n;
  } while (o < data.length);
  const t = adler32(data);
  parts.push(new Uint8Array([t >>> 24, (t >>> 16) & 0xff, (t >>> 8) & 0xff, t & 0xff]));
  return concat(parts);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = utf8(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([head, data])));
  return concat([len, head, data, crc]);
}

/** 작은 RGB PNG(예제·시험용 그림). pixel(x, y) → [r, g, b] 0~255 */
export function pngRgb(w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + 3 * w);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      raw.set([c[0] & 0xff, c[1] & 0xff, c[2] & 0xff], row + 1 + 3 * x);
    }
  }
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlibStored(raw)), pngChunk('IEND', new Uint8Array(0))]);
}

/** 원시 DEFLATE 압축 함수(Node의 deflateRawSync 등). null을 돌려주거나 함수가 없으면 저장 방식 */
export type Compressor = (data: Uint8Array) => Uint8Array | null;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** compress가 있을 때 압축할지 */
  deflate?: boolean;
}

/** ZIP(지역 머리 + 중앙 목록 + 끝 레코드). 위치는 ZIP 시작 기준(SKP처럼) */
export function zip(entries: ZipEntry[], compress?: Compressor): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let off = 0;
  for (const e of entries) {
    const name = utf8(e.name);
    const packed = e.deflate && compress ? compress(e.data) : null;
    const body = packed ?? e.data;
    const method = packed ? 8 : 0;
    const crc = crc32(e.data);
    const lh = concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(body.length), u32(e.data.length), u16(name.length), u16(0), name]);
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(body.length), u32(e.data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name,
      ]),
    );
    locals.push(lh, body);
    off += lh.length + body.length;
  }
  const cd = concat(central);
  const eocd = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
  return concat([...locals, cd, eocd]);
}

/** 머리 문자열: FF FE FF + 길이 + UTF-16LE */
export function utf16String(s: string): Uint8Array {
  const b = new Uint8Array(4 + 2 * s.length);
  b.set([0xff, 0xfe, 0xff, s.length]);
  for (let i = 0; i < s.length; i++) {
    b[4 + 2 * i] = s.charCodeAt(i) & 0xff;
    b[5 + 2 * i] = s.charCodeAt(i) >> 8;
  }
  return b;
}

export interface SkpFileOpts {
  version?: string;
  /** [꾸러미 폴더 이름(= model.dat의 재질 이름), material.xml 글] */
  materials?: [string, string][];
  /** 압축할지(compress가 있을 때만 뜻이 있다, 기본 true) */
  deflate?: boolean;
  compress?: Compressor;
  /** model.dat 앞에 넣을 항목(그림 등: meta/model_thumbnail.png, materials/<폴더>/<그림>, thumbnails/…, scene_thumbnails/…) */
  extra?: ZipEntry[];
}

/** 2021 이후 꼴의 파일 전체 */
export function skpFile(model: Uint8Array, opts: SkpFileOpts = {}): Uint8Array {
  const head = concat([
    utf16String('SketchUp Model'),
    utf16String(`{${opts.version ?? '26.1.194'}}`),
    utf8('VFF'),
    u16(8),
    u16(1),
    u16(17),
    u32(0x12345678),
  ]);
  const deflate = opts.deflate ?? true;
  const entries: ZipEntry[] = [
    { name: 'meta/meta.dat', data: new Uint8Array([0x64, 0, 0, 0, 0, 0]) },
    ...(opts.materials ?? []).map(([n, xml]) => ({ name: `materials/${n}/material.xml`, data: utf8(xml), deflate })),
    ...(opts.extra ?? []),
    { name: 'model.dat', data: model, deflate },
  ];
  return concat([head, zip(entries, opts.compress)]);
}

/** 2020 이하 꼴의 머리(+ MFC 버전 표 시작) */
export function oldSkpHeader(version: string): Uint8Array {
  return concat([
    utf16String('SketchUp Model'),
    utf16String(`{${version}}`),
    new Uint8Array(16),
    new Uint8Array([0xff, 0xfe, 0xff, 0x00]),
    u32(0x5eb2f812),
    new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x0b, 0x00]),
    utf8('CVersionMap'),
  ]);
}
