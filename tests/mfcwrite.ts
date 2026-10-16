/**
 * 시험용 SketchUp 2020 이하(MFC CArchive 객체 직렬화) 바이트 쓰기 도구.
 * 형식 기록(docs/formats/skp.md "SketchUp 7~2020: MFC CArchive" — PRISME 엔진에서 옮긴 형식 지식)의 구조를 손으로 옮겼다.
 * 실제 SketchUp 파일은 저장소에 넣지 않는다. 해석기가 읽는 범위까지만 흉내 내고, SketchUp에서 다시 열리는 것은 확인하지 않았다.
 *
 * 객체는 MFC처럼 처음 나올 때 새 객체로(클래스도 처음이면 새 클래스 꼬리표와 함께) 쓰고, 다시 나오면 칸 번호 참조로 쓴다.
 * 정점은 처음 쓰는 모서리 안에, 모서리는 요소 목록에서(면의 고리는 그 모서리를 참조), 곡선은 처음 쓰는 모서리 안에 쓴다.
 * 그래서 해석 결과의 정점 차례는 "모서리 목록에서 처음 나온 차례"다.
 */

import { concat, utf16String } from './build';

export type Vec3 = [number, number, number];

/** 판별 클래스 스키마(엔진 표준 파일의 CVersionMap에서 해석기가 쓰는 것만) */
const BASE = {
  CArcCurve: 3,
  CAttributeContainer: 0,
  CAttributeNamed: 1,
  CCamera: 5,
  CComponentDefinition: 10,
  CComponentInstance: 5,
  CConstructionLine: 1,
  CConstructionPoint: 0,
  CCurve: 4,
  CDib: 3,
  CDimensionLinear: 6,
  CDimensionRadial: 2,
  CDrawingElement: 9,
  CEdge: 2,
  CEdgeUse: 1,
  CEntity: 3,
  CFace: 3,
  CFaceTextureCoords: 4,
  CGroup: 1,
  CImage: 1,
  CLayer: 2,
  CLayerManager: 4,
  CLoop: 1,
  CMaterial: 12,
  CRenderingOptions: 36,
  CSectionPlane: 2,
  CSkFont: 1,
  CSketchUpModel: 24,
  CSkpStyle: 1,
  CText: 9,
  CThumbnail: 1,
  CVertex: 0,
  CViewPage: 12,
};
export const MFC_SCHEMAS: Record<'v4' | 'v7' | 'v8' | 'v15' | 'v17' | 'v18' | 'v19' | 'v20', Record<string, number>> = {
  v4: { ...BASE, CSketchUpModel: 12, CRenderingOptions: 25, CComponentInstance: 3, CDrawingElement: 8, CViewPage: 9, CArcCurve: 1 },
  v7: { ...BASE, CSketchUpModel: 22, CRenderingOptions: 35, CComponentInstance: 4, CViewPage: 11, CArcCurve: 1 },
  v8: { ...BASE, CSketchUpModel: 22, CRenderingOptions: 36, CComponentInstance: 4, CArcCurve: 1 },
  v15: { ...BASE },
  v17: { ...BASE, CSketchUpModel: 26, CEntity: 5 },
  v18: { ...BASE, CSketchUpModel: 28, CRenderingOptions: 37, CEntity: 5, CComponentInstance: 6, CComponentDefinition: 11, CSectionPlane: 3 },
  v19: {
    ...BASE,
    CSketchUpModel: 29,
    CRenderingOptions: 38,
    CEntity: 5,
    CComponentInstance: 6,
    CComponentDefinition: 11,
    CSectionPlane: 3,
    CLayer: 3,
    CLineStyleManager: 1,
    CCustomLineStyle: 2,
  },
  v20: {
    ...BASE,
    CSketchUpModel: 29,
    CRenderingOptions: 39,
    CEntity: 5,
    CComponentInstance: 6,
    CComponentDefinition: 11,
    CSectionPlane: 3,
    CLayer: 3,
    CLineStyleManager: 1,
    CCustomLineStyle: 3,
    CLayerManager: 7,
    CLayerGroup: 2,
    CViewPage: 13,
    CSkpStyle: 2,
  },
};

/** 판 → 머리 판 글 */
export const MFC_VERSIONS: Record<keyof typeof MFC_SCHEMAS, string> = {
  v4: '4.0.1',
  v7: '7.0.1',
  v8: '8.0.1',
  v15: '15.0.1',
  v17: '17.0.1',
  v18: '18.0.1',
  v19: '19.0.1',
  v20: '20.0.1',
};

/** 객체 꼬리표·칸 번호를 MFC처럼 매기는 바이트 쓰개 */
export class MfcWriter {
  private buf = new Uint8Array(4096);
  private n = 0;
  private readonly classes = new Map<string, number>();
  private next = 1;
  readonly schemas: Record<string, number>;

  constructor(schemas: Record<string, number>) {
    this.schemas = schemas;
  }

  get pids(): boolean {
    return (this.schemas.CEntity ?? 0) >= 5;
  }

  schema(name: string): number {
    return this.schemas[name] ?? 0;
  }

  private grow(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }

  raw(b: ArrayLike<number>): void {
    this.grow(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }

  zeros(k: number): void {
    this.grow(k);
    this.buf.fill(0, this.n, this.n + k);
    this.n += k;
  }

  u8(v: number): void {
    this.raw([v & 0xff]);
  }

  u16(v: number): void {
    this.raw([v & 0xff, (v >> 8) & 0xff]);
  }

  u32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.raw(b);
  }

  i32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.raw(b);
  }

  f32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.raw(b);
  }

  f64(...vs: number[]): void {
    const b = new Uint8Array(8 * vs.length);
    const dv = new DataView(b.buffer);
    vs.forEach((v, i) => dv.setFloat64(8 * i, v, true));
    this.raw(b);
  }

  /** CString: ASCII면 좁은 글, 아니면 0xFF 0xFFFE + UTF-16LE */
  str(s: string): void {
    const ascii = [...s].every((c) => c.charCodeAt(0) < 0x80);
    const len = (k: number): void => {
      if (k < 0xff) this.u8(k);
      else if (k < 0xfffe) {
        this.u8(0xff);
        this.u16(k);
      } else {
        this.u8(0xff);
        this.u16(0xffff);
        this.u32(k);
      }
    };
    if (ascii) {
      len(s.length);
      this.raw([...s].map((c) => c.charCodeAt(0)));
      return;
    }
    this.u8(0xff);
    this.u16(0xfffe);
    len(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
  }

  nil(): void {
    this.u16(0);
  }

  /** 이미 쓴 객체 칸 참조 */
  ref(slot: number): void {
    if (slot < 0x7fff) this.u16(slot);
    else {
      this.u16(0x7fff);
      this.u32(slot);
    }
  }

  /** 새 객체: 꼬리표(클래스가 처음이면 새 클래스)를 쓰고 칸을 받은 뒤 body로 칸을 쓴다. 객체 칸 번호를 돌려준다 */
  obj(cls: string, body: (slot: number) => void): number {
    const known = this.classes.get(cls);
    if (known === undefined) {
      this.u16(0xffff);
      this.u16(this.schema(cls));
      this.u16(cls.length);
      this.raw([...cls].map((c) => c.charCodeAt(0)));
      this.classes.set(cls, this.next++);
    } else if (known < 0x7fff) this.u16(0x8000 | known);
    else {
      this.u16(0x7fff);
      this.u32((0x80000000 | known) >>> 0);
    }
    const slot = this.next++;
    body(slot);
    return slot;
  }

  /** 지금까지 쓴 바이트 수 */
  get length(): number {
    return this.n;
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

// ── 형 있는 값 ─────────────────────────────────────────────────────

export type MfcVal = (w: MfcWriter) => void;
const typed =
  (kind: number, fn: (w: MfcWriter) => void): MfcVal =>
  (w) => {
    w.u8(kind);
    fn(w);
  };
export const mv = {
  nil: (): MfcVal => typed(0, () => {}),
  byte: (v: number): MfcVal => typed(2, (w) => w.u8(v)),
  i16: (v: number): MfcVal =>
    typed(3, (w) => {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setInt16(0, v, true);
      w.raw(b);
    }),
  i32: (v: number): MfcVal => typed(4, (w) => w.i32(v)),
  f32: (v: number): MfcVal => typed(5, (w) => w.f32(v)),
  f64: (v: number): MfcVal => typed(6, (w) => w.f64(v)),
  bool: (v: boolean): MfcVal => typed(7, (w) => w.u8(v ? 1 : 0)),
  color: (r: number, g: number, b: number, a = 255): MfcVal => typed(8, (w) => w.raw([r, g, b, a])),
  time: (s: number): MfcVal => typed(9, (w) => w.u32(s)),
  str: (s: string): MfcVal => typed(10, (w) => w.str(s)),
  arr: (...items: MfcVal[]): MfcVal =>
    typed(11, (w) => {
      w.u32(items.length);
      for (const it of items) it(w);
    }),
  length: (inch: number): MfcVal => typed(12, (w) => w.f64(inch)),
  point: (x: number, y: number, z: number): MfcVal => typed(17, (w) => w.f64(x, y, z)),
  vec: (x: number, y: number, z: number): MfcVal => typed(18, (w) => w.f64(x, y, z)),
  /** 해석기가 모르는 꼴(시험용) */
  raw: (kind: number): MfcVal => (w) => w.u8(kind),
};

/** 속성 사전들: [사전 이름, [열쇠, 값][]][] */
export type MfcDicts = [string, [string, MfcVal][]][];

// ── 모형 명세 ─────────────────────────────────────────────────────

export interface MfcEdgeSpec {
  a: number;
  b: number;
  hidden?: boolean;
  soft?: boolean;
  smooth?: boolean;
  /** MfcSpec.layers 차례 */
  layer?: number;
  material?: number;
  /** 요소 묶음의 curves 차례 */
  curve?: number;
  pid?: number;
  attrs?: MfcDicts;
}

export interface MfcLoopSpec {
  /** 기본: 첫 고리가 바깥 */
  outer?: boolean;
  /** [모서리 차례, 뒤집힘] */
  uses: [number, boolean][];
}

export interface MfcFaceSpec {
  plane: [number, number, number, number];
  loops: MfcLoopSpec[];
  front?: number;
  back?: number;
  layer?: number;
  hidden?: boolean;
  pid?: number;
  attrs?: MfcDicts;
  /** 앞면 무늬 위치(CFaceTextureCoords, 읽기만 하는지 본다) */
  textureCoords?: boolean;
}

export interface MfcInstanceSpec {
  kind?: 'component' | 'group' | 'image';
  /** MfcSpec.definitions 차례 */
  def: number;
  /** 3×3 행 + 이동 + w(13개) */
  xform: number[];
  name?: string;
  guid?: Uint8Array;
  hidden?: boolean;
  locked?: boolean;
  layer?: number;
  material?: number;
  pid?: number;
  attrs?: MfcDicts;
}

export interface MfcCurveSpec {
  polygon?: boolean;
  arc?: { center: Vec3; normal: Vec3; xaxis: Vec3; start: number; end: number };
  pid?: number;
}

/** 붙는 점: 자유 점, 모서리 매개변수, 정점 */
export type MfcAnchor = Vec3 | { edge: number; t: number } | { vertex: number };

export interface MfcTextSpec {
  text: string;
  /** 0 none, 1 view based, 2 pushpin */
  leader: number;
  at?: MfcAnchor;
  leaderVec?: Vec3;
  screen?: [number, number];
  /** MfcSpec.fonts 차례 */
  font?: number;
  layer?: number;
  hidden?: boolean;
  material?: number;
  pid?: number;
}

export interface MfcLinearDimSpec {
  text?: string;
  start: MfcAnchor;
  end: MfcAnchor;
  normal: Vec3;
  xaxis: Vec3;
  alignment: number;
  distance: number;
  textPos?: number;
  arrow?: number;
  aligned?: boolean;
  font?: number;
  pid?: number;
}

export interface MfcRadialDimSpec {
  /** 잰 호: 모서리 차례(그 모서리의 곡선) 또는 곡선 차례 */
  edge?: number;
  curve?: number;
  angle: number;
  distance: number;
  diameter?: boolean;
  arrow?: number;
}

export interface MfcGuideSpec {
  kind: 'line' | 'point';
  point: Vec3;
  dir?: Vec3;
  /** 선 끝 매개변수(없으면 끝없음 ±1e30) */
  range?: [number, number];
  layer?: number;
  hidden?: boolean;
  pid?: number;
}

export interface MfcSectionSpec {
  plane: [number, number, number, number];
  name?: string;
  symbol?: string;
  active?: boolean;
  layer?: number;
  pid?: number;
}

export interface MfcEntitiesSpec {
  vertices?: Vec3[];
  edges?: MfcEdgeSpec[];
  faces?: MfcFaceSpec[];
  curves?: MfcCurveSpec[];
  instances?: MfcInstanceSpec[];
  texts?: MfcTextSpec[];
  linearDims?: MfcLinearDimSpec[];
  radialDims?: MfcRadialDimSpec[];
  guides?: MfcGuideSpec[];
  sections?: MfcSectionSpec[];
  attrs?: MfcDicts;
  /** 요소 목록 끝에 읽는 함수가 없는 클래스 객체를 넣는다(시험용) */
  unknownClass?: string;
}

export interface MfcDefinitionSpec {
  name: string;
  description?: string;
  guid?: Uint8Array;
  entities: MfcEntitiesSpec;
  behavior?: { glue?: boolean; cuts?: boolean; snap?: number; faceCamera?: boolean; shadowsSun?: boolean; noScale?: number };
  /** 컴포넌트 미리보기(부호화한 그림) */
  thumbnail?: Uint8Array;
  pid?: number;
  /** 같은 이름의 쓰지 않는 태그 목록(정의의 태그 관리자) */
  vestigialLayers?: string[];
}

export interface MfcMaterialSpec {
  name: string;
  /** r, g, b, a(a = 0이면 "색을 정하지 않음") */
  color: [number, number, number, number?];
  display?: string;
  transparency?: number;
  useAlpha?: boolean;
  texture?: { image: Uint8Array; kind?: 0 | 1 | 4; path: string; width?: number; height?: number; avg?: [number, number, number, number] };
  type?: number;
}

export interface MfcLayerSpec {
  name: string;
  hidden?: boolean;
  /** 없으면 색을 정하지 않은 태그(알파 0) */
  color?: [number, number, number];
  /** (2019+) 선 종류 이름 */
  lineStyle?: string;
  attrs?: MfcDicts;
  pid?: number;
}

export interface MfcFolderSpec {
  name: string;
  hidden?: boolean;
  layers?: number[];
  children?: MfcFolderSpec[];
}

export interface MfcCameraSpec {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  perspective?: boolean;
  fov?: number;
  height?: number;
  aspect?: number;
  twoPoint?: boolean;
}

export interface MfcRenderSpec {
  mode?: number;
  texture?: boolean;
  xray?: boolean;
  background?: Vec3;
  foreground?: Vec3;
  front?: Vec3;
  back?: Vec3;
  sky?: Vec3;
  ground?: Vec3;
  drawSky?: boolean;
  drawGround?: boolean;
  profiles?: boolean;
  hiddenGeometry?: boolean;
  sectionFill?: boolean;
}

/** 스타일 설정: [항목 번호, 꼴(1 bool, 4 수, 5 색, 6 float, 7 double), 값(색은 [r,g,b,a])] */
export type MfcStyleItem = [number, 1 | 4 | 5 | 6 | 7, number | boolean | [number, number, number, number]];

export interface MfcStyleSpec {
  name: string;
  items?: MfcStyleItem[];
}

/** 장면 숨긴 개체: 요소 종류와 차례(def가 있으면 그 정의 안) */
export interface MfcHiddenRef {
  kind: 'face' | 'edge' | 'instance' | 'text' | 'guide' | 'section';
  index: number;
  def?: number;
}

export interface MfcPageSpec {
  name: string;
  description?: string;
  /** 저장 깃발(0x1 카메라, 0x2 스타일, 0x4 그림자, 0x8 축, 0x10 숨긴 것, 0x20 태그, 0x40 단면, 0x80/0x100 2020.1) */
  flags: number;
  camera?: MfcCameraSpec;
  rendering?: MfcRenderSpec;
  /** MfcSpec.styles 차례(없으면 새 스타일 사본 하나) */
  style?: number;
  hidden?: MfcHiddenRef[];
  layers?: number[];
  sections?: { index: number; def?: number }[];
  include?: boolean;
  transition?: number;
  delay?: number;
  /** (CViewPage 12+) 부호화한 장면 미리보기 */
  thumbnail?: Uint8Array;
  pid?: number;
}

export interface MfcFontSpec {
  face: string;
  points?: number;
  bold?: boolean;
  italic?: boolean;
  worldSize?: number;
}

export interface MfcDefaultsSpec {
  dimFont?: number;
  textFont?: number;
  leaderFont?: number;
  textColor?: Vec3;
  leaderColor?: Vec3;
  leaderType?: number;
  leaderArrow?: number;
  dimColor?: Vec3;
  dimArrow?: number;
  dimAligned?: boolean;
  dimTextPos?: number;
}

export interface MfcSpec {
  /** 클래스 스키마 묶음(기본 v15) 또는 직접 */
  schemas?: keyof typeof MFC_SCHEMAS | Record<string, number>;
  /** 머리 판 글(기본: 스키마 묶음의 판) */
  version?: string;
  description?: string;
  /** ModelProperties.Name */
  name?: string;
  options?: [string, [string, MfcVal][]][];
  /** 모형 뿌리 앞머리 속성(모형 속성) */
  rootAttrs?: MfcDicts;
  camera?: MfcCameraSpec;
  rendering?: MfcRenderSpec;
  /** 모형 미리보기(부호화한 그림) */
  thumbnail?: Uint8Array;
  materials?: MfcMaterialSpec[];
  layers?: MfcLayerSpec[];
  /** 활성 태그(layers 차례, 기본 0) */
  activeLayer?: number;
  /** (2020) 태그 폴더(뿌리 폴더 아래) */
  folders?: MfcFolderSpec[];
  definitions?: MfcDefinitionSpec[];
  root: MfcEntitiesSpec;
  fonts?: MfcFontSpec[];
  defaults?: MfcDefaultsSpec;
  pages?: MfcPageSpec[];
  activePage?: number;
  /** (2019+) 선 종류 관리자 목록 */
  lineStyles?: string[];
  styles?: MfcStyleSpec[];
  activeStyle?: number;
  /** 모형 작업 사본(없으면 null을 써서 스타일 목록 끝을 쓰게 한다) */
  currentStyle?: MfcStyleSpec;
}

// ── 쓰기 ──────────────────────────────────────────────────────

/** 렌더링 덩어리 칸 자리(src/mfcview.ts와 같은 형식 기록에서) */
const BLOCK_SIZE: Record<number, number> = { 25: 160, 33: 190, 35: 197, 36: 216, 37: 221, 38: 222, 39: 223 };
const F36 = { xray: 6, background: 13, foreground: 17, texture: 32, profiles: 42, hiddenGeometry: 58, front: 63, back: 67, sky: 123, ground: 131, drawSky: 135, drawGround: 136 };
const F38 = { ...F36, background: 14, foreground: 18, texture: 33, profiles: 43, hiddenGeometry: 59, front: 64, back: 68, sky: 124, ground: 132, drawSky: 136, drawGround: 137, sectionFill: 167 };
const FIELDS: Record<number, Record<string, number>> = {
  25: F36,
  35: F36,
  36: F36,
  37: { ...F36, sectionFill: 166 },
  38: F38,
  39: { ...F38, front: 65, back: 69, sky: 125, ground: 133, drawSky: 137, drawGround: 138, sectionFill: 168 },
};

/** 요소 묶음마다 쓴 객체 칸 */
interface Slots {
  vertices: number[];
  edges: number[];
  curves: number[];
  faces: number[];
  instances: number[];
  texts: number[];
  dims: number[];
  guides: number[];
  sections: number[];
}

const emptySlots = (): Slots => ({ vertices: [], edges: [], curves: [], faces: [], instances: [], texts: [], dims: [], guides: [], sections: [] });

/** 2020 이하 꼴의 SKP 파일 전체 */
export function mfcFile(spec: MfcSpec): Uint8Array {
  const preset = typeof spec.schemas === 'string' ? spec.schemas : spec.schemas ? undefined : 'v15';
  const schemas = typeof spec.schemas === 'object' ? spec.schemas : MFC_SCHEMAS[preset!];
  const version = spec.version ?? (preset ? MFC_VERSIONS[preset] : '15.0.1');
  const w = new MfcWriter(schemas);
  const pids = w.pids;
  const head = concat([utf16String('SketchUp Model'), utf16String(`{${version}}`)]);
  w.zeros(16); // 모형 GUID
  w.str(''); // 마지막 저장 경로
  w.u32(0x5eb2f812); // 저장 시각
  w.obj('CVersionMap', () => {
    for (const [k, v] of Object.entries(schemas)) {
      w.str(k);
      w.i32(v);
    }
    w.str('End-Of-Version-Map');
    w.i32(0);
  });

  const materialSlots: number[] = [];
  const layerSlots: number[] = [];
  const defSlots: (number | undefined)[] = [];
  const defEntSlots: Slots[] = [];
  const fontSlots: (number | undefined)[] = [];
  const styleSlots: (number | undefined)[] = [];
  let rootSlots = emptySlots();

  const pre = (attrs?: MfcDicts, pid?: number, texture = false): void => {
    if (attrs?.length || texture) container(attrs ?? [], texture);
    else w.nil();
    if (pids) {
      if (pid === undefined) w.u8(0);
      else {
        // 가면: 0이 아닌 바이트만 쓴다
        const bytes: number[] = [];
        let v = pid;
        for (let i = 0; i < 8; i++) {
          bytes.push(v % 256);
          v = Math.floor(v / 256);
        }
        let mask = 0;
        bytes.forEach((b, i) => {
          if (b) mask |= 1 << i;
        });
        w.u8(mask);
        bytes.forEach((b) => b && w.u8(b));
      }
    }
  };
  const container = (dicts: MfcDicts, texture = false): void => {
    w.obj('CAttributeContainer', () => {
      pre();
      for (const [name, entries] of dicts)
        w.obj('CAttributeNamed', () => {
          pre();
          w.u32(0);
          w.str(name);
          for (const [k, v] of entries) {
            w.str(k);
            v(w);
          }
          w.str('');
          w.u32(0);
        });
      if (texture)
        w.obj('CFaceTextureCoords', () => {
          pre();
          w.u32(0);
          w.f64(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);
          w.u32(1);
          w.zeros(32);
          w.u32(0);
          w.u32(1);
          w.u32(0);
        });
      w.nil();
    });
  };
  const dib = (image: Uint8Array | undefined, kind: 0 | 1 | 4 = 4): void => {
    if (!image) {
      w.nil();
      return;
    }
    w.obj('CDib', () => {
      w.u32(kind);
      w.u32(image.length);
      w.raw(image);
      if (kind === 1) w.u32(90);
    });
  };
  const camera = (c: MfcCameraSpec | undefined): void => {
    if (!c) {
      w.nil();
      return;
    }
    w.obj('CCamera', () => {
      w.f64(...c.eye, ...c.target, ...c.up);
      w.zeros(16);
      w.u8(c.perspective === false ? 0 : 1);
      w.f64(c.fov ?? 35, c.height ?? 0);
      w.zeros(24);
      w.f64(c.aspect ?? 0);
      w.zeros(2);
      w.str('');
      w.f64(0);
      w.u8(c.twoPoint ? 1 : 0);
      w.zeros(24);
    });
  };
  const block = (r: MfcRenderSpec | undefined, insidePage: boolean): void => {
    const schema = w.schema('CRenderingOptions');
    const size = (BLOCK_SIZE[schema] ?? 216) - (insidePage ? 8 : 0);
    const b = new Uint8Array(size);
    const f = FIELDS[schema] ?? F36;
    new DataView(b.buffer).setUint32(2, r?.mode ?? 2, true);
    const put = (k: string, v: number): void => {
      if (f[k] !== undefined) b[f[k]!] = v;
    };
    const rgb = (k: string, c: Vec3 | undefined): void => {
      if (!c || f[k] === undefined) return;
      b.set([c[0], c[1], c[2], 255], f[k]!);
    };
    put('texture', r?.texture === false ? 0 : 1);
    put('xray', r?.xray ? 1 : 0);
    put('profiles', r?.profiles === false ? 0 : 1);
    put('hiddenGeometry', r?.hiddenGeometry ? 1 : 0);
    put('sectionFill', r?.sectionFill ? 1 : 0);
    put('drawSky', r?.drawSky ? 1 : 0);
    put('drawGround', r?.drawGround ? 1 : 0);
    rgb('background', r?.background ?? [255, 255, 255]);
    rgb('foreground', r?.foreground ?? [0, 0, 0]);
    rgb('front', r?.front ?? [255, 255, 255]);
    rgb('back', r?.back ?? [164, 178, 187]);
    rgb('sky', r?.sky);
    rgb('ground', r?.ground);
    if (w.schema('CSketchUpModel') >= 26) w.u8(0);
    w.raw(b);
  };
  const materialBody = (m: MfcMaterialSpec): void => {
    w.str(m.name);
    w.u8(m.texture ? 1 : 0);
    if (m.texture) {
      pre();
      dib(m.texture.image, m.texture.kind ?? 4);
      w.f64(m.texture.width ?? 10, m.texture.height ?? 10);
      w.str(m.texture.path);
      w.raw(m.texture.avg ?? [128, 128, 128, 255]);
    }
    w.u8(0);
    w.raw([m.color[0], m.color[1], m.color[2], m.color[3] ?? 255]);
    w.str(m.display ?? m.name);
    w.u32(m.type ?? (m.texture ? 1 : 0));
    w.u32(0);
    w.f64(m.transparency ?? 0);
    w.u8(m.useAlpha ? 1 : 0);
  };
  const lineStyle = (name: string): void => {
    w.obj('CCustomLineStyle', () => {
      pre();
      if (w.schema('CCustomLineStyle') <= 2) pre();
      w.str(name);
      w.str(name === 'Solid Basic' ? '' : '12.0, -6.0');
      w.zeros(24);
    });
  };
  const layerObj = (l: MfcLayerSpec): number =>
    w.obj('CLayer', () => {
      pre(l.attrs, l.pid);
      w.str(l.name);
      w.u8(l.hidden ? 1 : 0);
      pre();
      materialBody({ name: l.name, color: l.color ? [l.color[0], l.color[1], l.color[2], 255] : [0, 0, 0, 0] });
      w.zeros(4);
      if (w.schema('CLayer') >= 3) {
        if (l.lineStyle) lineStyle(l.lineStyle);
        else w.nil();
      }
    });
  const mref = (i: number | undefined): void => (i === undefined ? w.nil() : w.ref(materialSlots[i]!));
  const lref = (i: number | undefined): void => (i === undefined ? w.nil() : w.ref(layerSlots[i]!));
  const drawing = (material: number | undefined, flags: { hidden?: boolean; soft?: boolean; smooth?: boolean; locked?: boolean }, layer: number | undefined): void => {
    mref(material);
    w.raw([flags.hidden ? 1 : 0, 0, 0, flags.soft ? 1 : 0, flags.smooth ? 1 : 0, flags.locked ? 1 : 0]);
    lref(layer);
  };
  const fontRef = (i: number | undefined): void => {
    if (i === undefined) {
      w.nil();
      return;
    }
    const known = fontSlots[i];
    if (known !== undefined) {
      w.ref(known);
      return;
    }
    const f = spec.fonts?.[i] ?? { face: 'Arial' };
    fontSlots[i] = w.obj('CSkFont', () => {
      pre();
      w.str(f.face);
      w.u8(f.bold ? 1 : 0);
      w.u8(f.italic ? 1 : 0);
      w.i32(f.points ?? 12);
      w.u8(f.worldSize !== undefined ? 1 : 0);
      w.f64(f.worldSize ?? 10);
    });
  };
  const styleObj = (st: MfcStyleSpec): number =>
    w.obj('CSkpStyle', () => {
      pre();
      w.zeros(16);
      w.str('');
      w.u32(0);
      w.str(st.name);
      w.str('');
      const items = st.items ?? [];
      w.u32(items.length + 1);
      // 없는 항목 하나(있음 = 0): 꼴·값 없이 지나간다
      w.u32(9999);
      w.u32(0);
      for (const [key, kind, v] of items) {
        w.u32(key);
        w.u32(1);
        w.u32(kind);
        if (kind === 1) w.u8(v ? 1 : 0);
        else if (kind === 5 && Array.isArray(v)) w.raw(v);
        else if (kind === 4 || kind === 5) w.i32(Number(v));
        else if (kind === 6) w.f32(Number(v));
        else w.f64(Number(v));
      }
    });
  const styleRef = (i: number): void => {
    const known = styleSlots[i];
    if (known !== undefined) w.ref(known);
    else styleSlots[i] = styleObj(spec.styles![i]!);
  };
  const shadow = (): void => {
    pre();
    w.u32(0);
    w.u8(0);
    w.str('Boulder');
    w.str('USA');
    w.f64(-105.27, 40.01, -7, 0, 1, 0);
    w.raw([0, 1, 1, 0]);
    w.i32(80);
    w.i32(20);
    w.raw([0, 0]);
  };
  const axes = (): void => {
    pre();
    w.zeros(10);
    w.f64(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    w.u8(0);
  };
  const folderBody = (f: MfcFolderSpec): void => {
    pre();
    w.str(f.name);
    const kids = f.children ?? [];
    w.u32(kids.length);
    for (const k of kids) w.obj('CLayerGroup', () => folderBody(k));
    const members = f.layers ?? [];
    w.u32(members.length);
    for (const l of members) lref(l);
    w.u8(f.hidden ? 1 : 0);
  };

  /** 붙는 점 */
  const anchor = (a: MfcAnchor, slots: Slots): void => {
    w.zeros(8);
    if (Array.isArray(a)) {
      w.f64(...a);
      w.nil();
    } else if ('edge' in a) {
      w.f64(a.t, 0, 0);
      w.ref(slots.edges[a.edge]!);
    } else {
      w.f64(0, 0, 0);
      w.ref(slots.vertices[a.vertex]!);
    }
    w.zeros(10);
  };

  const entities = (e: MfcEntitiesSpec, slots: Slots): void => {
    const vertexRef = (i: number): void => {
      const known = slots.vertices[i];
      if (known !== undefined) {
        w.ref(known);
        return;
      }
      slots.vertices[i] = w.obj('CVertex', () => {
        pre();
        w.f64(...e.vertices![i]!);
      });
    };
    const curveRef = (i: number | undefined): void => {
      if (i === undefined) {
        w.nil();
        return;
      }
      const known = slots.curves[i];
      if (known !== undefined) {
        w.ref(known);
        return;
      }
      const c = e.curves![i]!;
      slots.curves[i] = w.obj(c.arc ? 'CArcCurve' : 'CCurve', () => {
        pre(undefined, c.pid);
        w.u8(c.polygon ? 1 : 0);
        w.u32(0);
        if (c.arc) {
          const a = c.arc;
          const y: Vec3 = [a.normal[1] * a.xaxis[2] - a.normal[2] * a.xaxis[1], a.normal[2] * a.xaxis[0] - a.normal[0] * a.xaxis[2], a.normal[0] * a.xaxis[1] - a.normal[1] * a.xaxis[0]];
          w.f64(...a.center, ...a.normal, ...a.xaxis, a.start, a.end, ...y);
        }
      });
    };
    const edgeObj = (i: number): number => {
      const ed = e.edges![i]!;
      return w.obj('CEdge', () => {
        pre(ed.attrs, ed.pid);
        drawing(ed.material, ed, ed.layer);
        vertexRef(ed.a);
        vertexRef(ed.b);
        curveRef(ed.curve);
      });
    };
    const list: (() => void)[] = [];
    (e.edges ?? []).forEach((_, i) => list.push(() => (slots.edges[i] = edgeObj(i))));
    (e.faces ?? []).forEach((f, i) =>
      list.push(() => {
        slots.faces[i] = w.obj('CFace', () => {
          pre(f.attrs, f.pid, !!f.textureCoords);
          drawing(f.front, f, f.layer);
          w.f64(...f.plane);
          w.u32(f.loops.length);
          f.loops.forEach((l, li) => {
            w.obj('CLoop', (loopSlot) => {
              pre();
              w.u8((l.outer ?? li === 0) ? 1 : 0);
              w.u8(0);
              for (const [edge, rev] of l.uses)
                w.obj('CEdgeUse', () => {
                  pre();
                  w.ref(slots.edges[edge]!);
                  w.u8(rev ? 1 : 0);
                  w.ref(loopSlot);
                });
              w.nil();
            });
          });
          mref(f.back);
        });
      }),
    );
    (e.instances ?? []).forEach((inst, i) =>
      list.push(() => {
        const kind = inst.kind ?? 'component';
        slots.instances[i] = w.obj(kind === 'group' ? 'CGroup' : kind === 'image' ? 'CImage' : 'CComponentInstance', () => {
          pre(inst.attrs, inst.pid);
          drawing(inst.material, inst, inst.layer);
          defRef(inst.def);
          w.f64(...inst.xform);
          w.str(inst.name ?? '');
          if (w.schema('CComponentInstance') >= 5) w.raw(inst.guid ?? new Uint8Array(16));
        });
      }),
    );
    (e.texts ?? []).forEach((t, i) =>
      list.push(() => {
        slots.texts[i] = w.obj('CText', () => {
          pre(undefined, t.pid);
          drawing(t.material, t, t.layer);
          fontRef(t.font);
          w.f64(...(t.screen ?? [0, 0]));
          anchor(t.at ?? [0, 0, 0], slots);
          w.f64(...(t.leaderVec ?? [0, 0, 0]));
          w.zeros(24);
          w.u32(t.leader);
          w.raw([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
          w.str(t.text);
          w.zeros(5);
        });
      }),
    );
    const dimHead = (text: string, font: number | undefined, aligned: boolean | undefined, arrow: number | undefined, pid: number | undefined): void => {
      pre(undefined, pid);
      drawing(undefined, {}, undefined);
      w.str(text);
      fontRef(font);
      w.u8(aligned ? 1 : 0);
      w.u32(arrow ?? 3);
    };
    (e.linearDims ?? []).forEach((d, i) =>
      list.push(() => {
        slots.dims[i] = w.obj('CDimensionLinear', () => {
          dimHead(d.text ?? '', d.font, d.aligned, d.arrow, d.pid);
          anchor(d.start, slots);
          anchor(d.end, slots);
          w.f64(...d.normal, ...d.xaxis);
          w.i32(d.alignment);
          w.f64(0, d.distance);
          w.i32(d.textPos ?? 1);
        });
      }),
    );
    (e.radialDims ?? []).forEach((d, i) =>
      list.push(() => {
        slots.dims[(e.linearDims?.length ?? 0) + i] = w.obj('CDimensionRadial', () => {
          dimHead('', undefined, false, d.arrow, undefined);
          if (d.curve !== undefined) w.ref(slots.curves[d.curve]!);
          else w.ref(slots.edges[d.edge!]!);
          w.f64(d.angle, d.distance);
          w.u8(d.diameter ? 1 : 0);
        });
      }),
    );
    (e.guides ?? []).forEach((g, i) =>
      list.push(() => {
        slots.guides[i] = w.obj(g.kind === 'line' ? 'CConstructionLine' : 'CConstructionPoint', () => {
          pre(undefined, g.pid);
          drawing(undefined, g, g.layer);
          w.f64(...g.point);
          if (g.kind === 'line') {
            w.f64(...(g.dir ?? [1, 0, 0]));
            w.f64(...(g.range ?? [-1e30, 1e30]));
            w.zeros(4);
          } else w.zeros(25);
        });
      }),
    );
    (e.sections ?? []).forEach((sp, i) =>
      list.push(() => {
        slots.sections[i] = w.obj('CSectionPlane', () => {
          pre(undefined, sp.pid);
          drawing(undefined, {}, sp.layer);
          w.f64(...sp.plane);
          if (w.schema('CSectionPlane') >= 3) {
            w.str(sp.name ?? '');
            w.str(sp.symbol ?? '');
          }
        });
      }),
    );
    if (e.unknownClass) list.push(() => w.obj(e.unknownClass!, () => w.zeros(4)));
    w.u32(list.length);
    for (const fn of list) fn();
  };

  const componentBody = (isModel: boolean, e: MfcEntitiesSpec, slots: Slots, vestigial: string[] = []): void => {
    w.zeros(pids ? 13 : 12);
    if (isModel) {
      const mats = spec.materials ?? [];
      w.u32(mats.length);
      for (const m of mats)
        materialSlots.push(
          w.obj('CMaterial', () => {
            pre();
            materialBody(m);
          }),
        );
    } else w.u32(0);
    w.u32(0);
    if (pids) w.u8(0);
    if (isModel) {
      const layers = spec.layers ?? [{ name: 'Layer0', color: [255, 255, 255] }];
      w.u32(layers.length);
      for (const l of layers) layerSlots.push(layerObj(l));
      lref(spec.activeLayer ?? 0);
    } else {
      w.u32(vestigial.length);
      let first: number | undefined;
      for (const name of vestigial) {
        const s = layerObj({ name });
        first ??= s;
      }
      if (first === undefined) w.nil();
      else w.ref(first);
    }
    if (w.schema('CLayerManager') >= 7) folderBody({ name: '', children: isModel ? (spec.folders ?? []) : [] });
    if (isModel) {
      const defs = spec.definitions ?? [];
      w.u32(defs.length);
      defs.forEach((_, i) => defRef(i));
    } else w.u32(0);
    entities(e, slots);
  };
  const componentTail = (e: MfcEntitiesSpec, slots: Slots): void => {
    w.u32(0);
    const active = (e.sections ?? []).findIndex((s) => s.active);
    if (active >= 0) w.ref(slots.sections[active]!);
    else w.nil();
  };
  const defRef = (i: number): void => {
    const known = defSlots[i];
    if (known !== undefined) {
      w.ref(known);
      return;
    }
    const d = spec.definitions![i]!;
    const slots = emptySlots();
    defEntSlots[i] = slots;
    defSlots[i] = w.obj('CComponentDefinition', () => {
      pre(d.entities.attrs, d.pid);
      componentBody(false, d.entities, slots, d.vestigialLayers);
      componentTail(d.entities, slots);
      w.raw(d.guid ?? new Uint8Array(16));
      w.str(d.name);
      w.str(d.description ?? '');
      w.str('');
      w.u32(0);
      const b = new Uint8Array(pids ? 43 : 42);
      const s = pids ? 1 : 0;
      const bh = d.behavior ?? {};
      b[27 + s] = bh.glue ? 1 : 0;
      b[28 + s] = bh.cuts ? 1 : 0;
      b[29 + s] = bh.snap ?? 0;
      b[33 + s] = (bh.faceCamera ? 1 : 0) | (bh.shadowsSun ? 2 : 0);
      b[34 + s] = bh.noScale ?? 0;
      w.raw(b);
      if (d.thumbnail)
        w.obj('CThumbnail', () => {
          pre();
          w.nil();
          dib(d.thumbnail);
        });
      else w.nil();
    });
  };

  // CSketchUpModel 본문
  const modelSchema = w.schema('CSketchUpModel');
  w.zeros(12);
  if (modelSchema >= 26) w.zeros(8);
  dib(spec.thumbnail);
  w.zeros(modelSchema >= 26 ? 15 : 14);
  w.str(spec.description ?? '');
  const opts = spec.options ?? [];
  w.u32(0);
  w.u32(opts.length);
  for (const [group, entries] of opts) {
    w.str(group);
    for (const [k, v] of entries) {
      w.str(k);
      v(w);
    }
    w.str('');
  }
  if (spec.name !== undefined) container([['ModelProperties', [['Name', mv.str(spec.name)]]]]);
  else w.nil();
  w.nil();
  camera(spec.camera);
  block(spec.rendering, false);
  rootSlots = emptySlots();
  pre(spec.rootAttrs);
  componentBody(true, spec.root, rootSlots);
  componentTail(spec.root, rootSlots);

  // 모형 꼬리
  shadow();
  w.zeros(pids ? 2 : 1);
  const pages = spec.pages ?? [];
  const pageSlots: number[] = [];
  w.u32(pages.length);
  for (const p of pages)
    pageSlots.push(
      w.obj('CViewPage', () => {
        pre(undefined, p.pid);
        w.str(p.name);
        w.str(p.description ?? '');
        w.u32(p.flags);
        if (p.flags & 0x1) camera(p.camera);
        if (p.flags & 0x2) {
          block(p.rendering, true);
          if (p.style !== undefined) styleRef(p.style);
          else styleObj({ name: `${p.name} 스타일` });
        }
        if (p.flags & 0x4) shadow();
        if (p.flags & 0x8) axes();
        if (p.flags & 0x10) {
          const hidden = p.hidden ?? [];
          w.u32(hidden.length);
          for (const h of hidden) {
            const s = h.def === undefined ? rootSlots : defEntSlots[h.def]!;
            const list = { face: s.faces, edge: s.edges, instance: s.instances, text: s.texts, guide: s.guides, section: s.sections }[h.kind];
            w.ref(list[h.index]!);
          }
        }
        if (p.flags & 0x20) {
          w.u32(p.layers?.length ?? 0);
          for (const l of p.layers ?? []) lref(l);
        }
        if (p.flags & 0x40) {
          w.u32(p.sections?.length ?? 0);
          for (const sec of p.sections ?? []) w.ref((sec.def === undefined ? rootSlots : defEntSlots[sec.def]!).sections[sec.index]!);
        }
        w.u8(p.include === false ? 0 : 1);
        w.f64(p.transition ?? -1, p.delay ?? -1);
        w.nil();
        if (w.schema('CViewPage') >= 12) {
          w.u8(0);
          w.u8(p.thumbnail ? 1 : 0);
          if (p.thumbnail) {
            w.u8(0);
            w.u32(p.thumbnail.length);
            w.raw(p.thumbnail);
          }
        }
      }),
    );
  if (spec.activePage !== undefined) w.ref(pageSlots[spec.activePage]!);
  else w.nil();
  axes();
  w.zeros(pids ? 70 : 69);
  const d = spec.defaults ?? {};
  fontRef(d.dimFont);
  const dim = new Uint8Array(58);
  const dv = new DataView(dim.buffer);
  dim[0] = d.dimAligned ? 1 : 0;
  dv.setInt32(14, d.dimArrow ?? 3, true);
  dim.set([...(d.dimColor ?? [0, 0, 0]), 255], 46);
  dv.setInt32(54, d.dimTextPos ?? 1, true);
  w.raw(dim);
  w.zeros(pids ? 3 : 2);
  fontRef(d.textFont);
  const text = new Uint8Array(22);
  const tv = new DataView(text.buffer);
  tv.setInt32(0, d.leaderType ?? 2, true);
  tv.setInt32(9, d.leaderArrow ?? 2, true);
  text.set([...(d.textColor ?? [0, 0, 0]), 255], 14);
  text.set([...(d.leaderColor ?? [0, 0, 0]), 255], 18);
  w.raw(text);
  fontRef(d.leaderFont);
  w.zeros(pids ? 3 : 2);
  const fonts = spec.fonts ?? [];
  w.u32(fonts.length);
  fonts.forEach((_, i) => fontRef(i));
  if (w.schema('CLineStyleManager') >= 1) {
    w.zeros(3);
    const ls = spec.lineStyles ?? [];
    w.u32(ls.length);
    for (const name of ls) lineStyle(name);
    w.zeros(5);
  } else w.zeros(pids ? 5 : 4);
  const styles = spec.styles ?? [];
  w.u32(styles.length);
  styles.forEach((_, i) => styleRef(i));
  if (spec.activeStyle !== undefined) w.ref(styleSlots[spec.activeStyle]!);
  else w.nil();
  if (spec.currentStyle) styleObj(spec.currentStyle);
  else w.nil();
  // 워터마크·분류 체계 …는 해석기가 읽지 않는다(아무 바이트나 와도 된다)
  w.zeros(16);
  return concat([head, w.bytes()]);
}

/** 단위 행렬 13개(3×3 행, 이동, w) */
export const ID13 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
/** 이동만 있는 13개 */
export const move13 = (x: number, y: number, z: number): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z, 1];

/** 정사각형 면 하나(정점 4·모서리 4·면 1, z = 0, 한 변 10인치) */
export function squareEntities(extra: Partial<MfcEntitiesSpec> = {}): MfcEntitiesSpec {
  return {
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ],
    edges: [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 0 },
    ],
    faces: [
      {
        plane: [0, 0, 1, 0],
        loops: [
          {
            uses: [
              [0, false],
              [1, false],
              [2, false],
              [3, false],
            ],
          },
        ],
      },
    ],
    ...extra,
  };
}
