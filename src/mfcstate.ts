/**
 * SketchUp 2020 이하(MFC) 해석의 공용 상태와 모든 클래스가 쓰는 앞머리 읽기.
 * 형식 지식은 2026-10 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의 legacy 해석기에서 옮긴 것이다(docs/formats/skp.md).
 *
 *   CEntity 앞머리: CAttributeContainer 포인터, (CEntity 스키마 5 이상 = SketchUp 2017+) 영구 번호 = 바이트 가면 u8 + 가면이 고른 바이트(리틀 엔디언)
 *   CDrawingElement: CMaterial 포인터, 깃발 6바이트(0 숨김, 3 soft, 4 smooth, 5 잠김), CLayer 포인터
 *   형 있는 값: u8 꼴(0 nil, 2 byte, 3 int16, 4 int32, 5 float, 6 double, 7 bool, 8 색, 9 시각, 10 글, 11 배열, 12 길이, 17 점, 18 벡터) + 값
 * 요소 묶음(모형 뿌리와 정의마다 하나)의 정점·모서리·면·인스턴스 값은 (묶음 번호, 묶음 안 차례)를 수 하나로 묶어 돌려준다(packed).
 */

import type { SkpAttr, SkpAttrDicts, SkpDimension, SkpEdge, SkpFace, SkpFont, SkpGuide, SkpInstance, SkpSectionPlane, SkpText } from './model';
import { BAD_REF, MfcError, type MfcStream } from './mfcstream';

/** 묶음 번호와 차례를 묶는 자리값(차례는 2^32 미만) */
const SHIFT = 4294967296;

export const pack = (cid: number, index: number): number => cid * SHIFT + index;
export const cidOf = (packed: number): number => Math.floor(packed / SHIFT);
export const indexOf = (packed: number): number => packed % SHIFT;

/** 클래스 이름 묶음(readObject의 거르개) */
const set = (...names: string[]): ReadonlySet<string> => new Set(names);
export const C = {
  ATTRIBUTE_CONTAINER: set('CAttributeContainer'),
  ATTRIBUTE_ITEMS: set('CAttributeNamed', 'CFaceTextureCoords'),
  CAMERA: set('CCamera'),
  CURVE: set('CCurve', 'CArcCurve'),
  DEFINITION: set('CComponentDefinition'),
  DIB: set('CDib'),
  EDGE: set('CEdge'),
  EDGE_USE: set('CEdgeUse'),
  FONT: set('CSkFont'),
  LAYER: set('CLayer'),
  LAYER_FOLDER: set('CLayerGroup'),
  LINE_STYLE: set('CCustomLineStyle'),
  LOOP: set('CLoop'),
  MATERIAL: set('CMaterial'),
  PAGE: set('CViewPage'),
  SECTION_PLANE: set('CSectionPlane'),
  STYLE: set('CSkpStyle'),
  THUMBNAIL: set('CThumbnail'),
  VERSION_MAP: set('CVersionMap'),
  VERTEX: set('CVertex'),
} as const;

/** 곡선(CCurve/CArcCurve) 읽은 값 — 모서리가 곡선을 가리키고, 곡선은 모서리 목록이 없다 */
export interface CurveRaw {
  pid?: number;
  polygon: boolean;
  arc?: { center: [number, number, number]; normal: [number, number, number]; xaxis: [number, number, number]; start: number; end: number };
}

/** 모형 뿌리나 정의 하나의 요소 */
export interface Collection {
  cid: number;
  /** 정점 xyz…(인치) */
  pos: number[];
  /** a·b가 -1이면 읽다 끊긴 모서리 */
  edges: SkpEdge[];
  /** 모서리마다 곡선 차례(-1 없음) */
  edgeCurve: number[];
  faces: SkpFace[];
  curves: CurveRaw[];
  instances: SkpInstance[];
  texts: SkpText[];
  dimensions: SkpDimension[];
  guides: SkpGuide[];
  sections: SkpSectionPlane[];
  attrs?: SkpAttrDicts;
}

export function newCollection(cid: number): Collection {
  return { cid, pos: [], edges: [], edgeCurve: [], faces: [], curves: [], instances: [], texts: [], dimensions: [], guides: [], sections: [] };
}

/** 면 무늬 위치(CFaceTextureCoords) — 아직 무늬 좌표를 쓰지 않아 읽기만 한다 */
export interface FaceTextureCoords {
  front: number[];
  back: number[];
  frontFlags: number;
  backFlags: number;
}

/** CAttributeContainer 값 */
export interface AttrContainer {
  dicts: SkpAttrDicts;
  texture?: FaceTextureCoords;
}

/** 앞머리(CEntity) */
export interface Preamble {
  attrs?: SkpAttrDicts;
  texture?: FaceTextureCoords;
  pid?: number;
}

/** 그리기 요소(CDrawingElement): 재질(-1 없음)·깃발 6바이트·태그(-1 없음, 읽은 차례) */
export interface Drawing {
  material: number;
  flags: Uint8Array;
  layer: number;
}

/** 꺼낼 그림 자리(readSkpImages가 바이트를 잘라 낸다) */
export interface MfcImageRef {
  kind: 'model' | 'material' | 'component' | 'scene';
  name: string;
  /** 재질 그림: 재질 열쇠(= meta.materialStats[].folder) */
  folder?: string;
  /** 장면 그림: 장면 thumbnail 칸과 같은 경로 */
  path?: string;
  start: number;
  end: number;
  /** 날 DIB(앞에 BMP 파일 머리를 붙여야 그림이 된다) */
  dib: boolean;
}

/** 영구 번호 한도(이보다 크면 수로 정확히 들 수 없어 버린다) */
const MAX_PID = Number.MAX_SAFE_INTEGER;
/** 속성 배열 겹침 한도 */
const MAX_VALUE_DEPTH = 32;

/** 해석 하나의 공용 상태 */
export class MfcState {
  readonly s: MfcStream;
  /** CVersionMap: 클래스 이름 → 스키마 */
  readonly schemas = new Map<string, number>();
  /** CEntity 5 이상(SketchUp 2017+): 앞머리에 영구 번호가 있다 */
  entityPids = false;
  readonly warn = new Map<string, number>();
  readonly collections: Collection[] = [];
  readonly stack: Collection[] = [];
  readonly fonts = new Map<number, SkpFont>();
  readonly images: MfcImageRef[] = [];

  constructor(s: MfcStream) {
    this.s = s;
  }

  schema(name: string): number {
    return this.schemas.get(name) ?? 0;
  }

  note(msg: string): void {
    this.warn.set(msg, (this.warn.get(msg) ?? 0) + 1);
  }

  /** 지금 읽는 요소 묶음 */
  get top(): Collection {
    const c = this.stack[this.stack.length - 1];
    if (!c) throw new MfcError('corrupt', '요소 묶음 밖에서 형상 기록을 만났습니다', this.s.pos);
    return c;
  }

  /** CEntity 앞머리: 속성 사전 포인터와 (2017+) 영구 번호 */
  preamble(): Preamble {
    const s = this.s;
    const out: Preamble = {};
    if (s.pos + 2 <= s.end && s.b[s.pos] === 0 && s.b[s.pos + 1] === 0) s.pos += 2;
    else {
      const c = s.readObject(C.ATTRIBUTE_CONTAINER) as AttrContainer | null;
      if (c && typeof c === 'object') {
        if (Object.keys(c.dicts).length) out.attrs = c.dicts;
        if (c.texture) out.texture = c.texture;
      }
    }
    if (this.entityPids) {
      const mask = s.u8();
      if (mask) {
        let pid = 0;
        let mul = 1;
        for (let bit = 0; bit < 8; bit++) {
          if (mask & (1 << bit)) pid += s.u8() * mul;
          mul *= 256;
        }
        if (pid <= MAX_PID) out.pid = pid;
      }
    }
    return out;
  }

  /** CDrawingElement: 재질 포인터, 깃발 6바이트, 태그 포인터 */
  drawing(): Drawing {
    const s = this.s;
    const m = s.readObject(C.MATERIAL);
    const flags = s.bytes(6);
    const l = s.readObject(C.LAYER);
    return { material: typeof m === 'number' ? m : -1, flags, layer: typeof l === 'number' ? l : -1 };
  }

  /** 지금 묶음의 정점·모서리 값인지 보고 묶음 안 차례를 돌려준다 */
  local(packed: unknown, what: string): number {
    if (typeof packed !== 'number' || cidOf(packed) !== this.top.cid) throw new MfcError('corrupt', `${what}가 다른 요소 묶음에 속합니다`, this.s.pos);
    return indexOf(packed);
  }

  /** local과 같되 너그럽게 읽다 버린 참조(BAD_REF)는 -1 */
  localOrNone(packed: unknown, what: string): number {
    return packed === BAD_REF ? -1 : this.local(packed, what);
  }

  /** 형 있는 값(속성·설정) */
  typedValue(depth = 0): SkpAttr {
    const s = this.s;
    const at = s.pos;
    const kind = s.u8();
    switch (kind) {
      case 0:
        return null;
      case 2:
        return s.u8();
      case 3:
        return s.i16();
      case 4:
        return s.i32();
      case 5:
        return s.f32();
      case 6:
        return s.f64();
      case 7:
        return s.u8() !== 0;
      case 8: {
        const b = s.bytes(4);
        return { kind: 'color', rgba: [b[0]!, b[1]!, b[2]!, b[3]!] };
      }
      case 9:
        return { kind: 'time', epoch: s.u32() };
      case 10:
        return s.cstr();
      case 11: {
        if (depth >= MAX_VALUE_DEPTH) throw new MfcError('corrupt', '속성 배열이 너무 깊게 겹쳤습니다', at);
        const n = s.count(10_000_000, '속성 배열 항목');
        const out: SkpAttr[] = [];
        for (let i = 0; i < n; i++) out.push(this.typedValue(depth + 1));
        return out;
      }
      case 12:
        return { kind: 'length', inch: s.f64() };
      case 17:
        return { kind: 'point', xyz: s.vec3() };
      case 18:
        return { kind: 'vector', xyz: s.vec3() };
      default:
        throw new MfcError('unsupported', `아직 읽지 못하는 값 꼴 ${kind}`, at);
    }
  }
}
