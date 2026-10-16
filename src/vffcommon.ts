/**
 * model.dat 공용 읽기: 요소 바탕(07d0), 형 있는 값(38a4), 속성 사전(05dd → 36b1), 설정 공급자(0200), GUID 글, 이름 표.
 * 뜻은 공개 표본 바이트로 추론한 것과 2026-10 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의 형식 지식을 옮긴 것이다.
 * 여기 함수는 깨진 곳에서 예외를 던질 수 있다(r.first·r.each) — 부르는 쪽이 항목 단위로 감싼다. 속성 사전은 스스로 견딘다.
 */

import type { SkpUnitsMeta } from './meta';
import type { SkpAnimation, SkpArrow, SkpAttr, SkpAttrDicts, SkpLeaderType, Vec3 } from './model';
import type { TlvNode, TlvReader } from './tlv';
import { TAG } from './vfftags';

/** 경고 하나 세기(같은 글은 모아 센다) */
export type Warn = (msg: string) => void;

export interface BaseInfo {
  id?: number;
  material?: number;
  layer?: number;
  flags: number;
  /** 객체 머리 05dc(속성 사전 05dd를 읽을 때) */
  header?: TlvNode;
}

/** n의 첫 자식 바탕(07d0): 번호·재질·태그·깃발 */
export function readBase(r: TlvReader, n: TlvNode): BaseInfo {
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

/** 바탕(07d0)이나 05dc를 품은 노드의 번호 */
export function idOf(r: TlvReader, n: TlvNode): number | undefined {
  const base = r.first(n, TAG.BASE) ?? n;
  return r.uint(r.path(base, TAG.ID_BOX, TAG.ID));
}

// ── 형 있는 값·속성 사전 ──────────────────────────────────────────

/** 모르는 값 꼴을 뜻하는 표시(nil = null과 가른다) */
const UNKNOWN = Symbol('unknown');

/**
 * 형 있는 값 0x38a4: 자식이 없으면 null(nil), 아니면 첫 자식의 꼬리표가 꼴이다.
 * 크기가 꼴과 맞지 않거나 모르는 꼬리표면 undefined(그 값은 버린다)와 경고.
 */
export function readValue(r: TlvReader, n: TlvNode, warn: Warn, depth = 0): SkpAttr | undefined {
  const v = valueOf(r, n, warn, depth);
  return v === UNKNOWN ? undefined : v;
}

function valueOf(r: TlvReader, n: TlvNode, warn: Warn, depth: number): SkpAttr | typeof UNKNOWN {
  let out: SkpAttr | typeof UNKNOWN = null;
  let seen = false;
  r.eachSafe(n.start, n.end, (tag, s, e, clipped) => {
    if (seen) return;
    seen = true;
    if (clipped) {
      out = UNKNOWN;
      return;
    }
    out = typed(r, tag, s, e, warn, depth);
  });
  if (!seen && n.end > n.start) out = UNKNOWN; // 머리도 못 읽을 만큼 깨진 내용
  return out;
}

function typed(r: TlvReader, tag: number, s: number, e: number, warn: Warn, depth: number): SkpAttr | typeof UNKNOWN {
  const len = e - s;
  const dv = r.dv;
  const bad = (): typeof UNKNOWN => {
    warn(`알 수 없는 속성 값 꼴(0x${tag.toString(16)})을 건너뛰었습니다`);
    return UNKNOWN;
  };
  switch (tag) {
    case TAG.VALUE_STRING:
      return r.str({ tag, start: s, end: e }) ?? '';
    case TAG.VALUE_BYTE:
      return len === 1 ? r.b[s]! : bad();
    case TAG.VALUE_INT16:
      return len === 2 ? dv.getInt16(s, true) : bad();
    case TAG.VARIANT_INT:
      return len === 4 ? dv.getInt32(s, true) : bad();
    case TAG.VALUE_FLOAT:
      return len === 4 ? dv.getFloat32(s, true) : bad();
    case TAG.VALUE_DOUBLE:
      return len === 8 ? dv.getFloat64(s, true) : bad();
    case TAG.VALUE_BOOL:
      return len === 1 ? r.b[s] !== 0 : bad();
    case TAG.VALUE_COLOR:
      return len === 4 ? { kind: 'color', rgba: [r.b[s]!, r.b[s + 1]!, r.b[s + 2]!, r.b[s + 3]!] } : bad();
    case TAG.VALUE_TIME:
      return len === 4 ? { kind: 'time', epoch: dv.getInt32(s, true) } : bad();
    case TAG.VALUE_LENGTH:
      return len === 8 ? { kind: 'length', inch: dv.getFloat64(s, true) } : bad();
    case TAG.VALUE_POINT:
    case TAG.VALUE_VECTOR:
      return len === 24
        ? { kind: tag === TAG.VALUE_POINT ? 'point' : 'vector', xyz: [dv.getFloat64(s, true), dv.getFloat64(s + 8, true), dv.getFloat64(s + 16, true)] }
        : bad();
    case TAG.VALUE_ARRAY: {
      if (depth >= 32) return bad();
      const items: SkpAttr[] = [];
      r.eachSafe(s, e, (t, is, ie, clipped) => {
        if (t !== TAG.VARIANT || clipped) return;
        const v = valueOf(r, { tag: t, start: is, end: ie }, warn, depth + 1);
        items.push(v === UNKNOWN ? null : v);
      });
      return items;
    }
    default:
      return bad();
  }
}

/**
 * 속성 목록 0x36b1 → 사전 이름 → 열쇠 → 값. 같은 이름 사전이 둘이면 뒤 것이 이긴다.
 * 깨진 곳 앞까지만 읽는다(예외를 던지지 않는다). 사전이 하나도 없으면 undefined.
 * 면의 무늬 위치 항목(0x2710)처럼 사전이 아닌 항목은 건너뛴다.
 */
export function readAttrList(r: TlvReader, list: TlvNode, warn: Warn): SkpAttrDicts | undefined {
  let out: SkpAttrDicts | undefined;
  let broken = false;
  const safe = (n: TlvNode, fn: (tag: number, s: number, e: number) => void): void => {
    if (!r.eachSafe(n.start, n.end, (tag, s, e, clipped) => (clipped ? undefined : fn(tag, s, e)))) broken = true;
  };
  safe(list, (tag, s, e) => {
    if (tag !== TAG.ATTR_ITEMS) return;
    safe({ tag, start: s, end: e }, (it, is, ie) => {
      if (it !== TAG.ATTR_DICT) return;
      let name = '';
      const entries: Record<string, SkpAttr> = {};
      safe({ tag: it, start: is, end: ie }, (ft, fs, fe) => {
        if (ft === TAG.ATTR_DICT_NAME) name = r.str({ tag: ft, start: fs, end: fe }) ?? '';
        else if (ft === TAG.ATTR_ENTRIES) {
          let key: string | undefined;
          safe({ tag: ft, start: fs, end: fe }, (et, es, ee) => {
            if (et === TAG.ATTR_KEY) key = r.str({ tag: et, start: es, end: ee });
            else if (et === TAG.VARIANT && key !== undefined) {
              const v = readValue(r, { tag: et, start: es, end: ee }, warn);
              if (v !== undefined) entries[key] = v;
              key = undefined;
            }
          });
        }
      });
      (out ??= {})[name] = entries;
    });
  });
  if (broken) warn('깨진 속성 사전의 뒷부분을 건너뛰었습니다');
  return out;
}

/** 객체 머리(05dc) 안 05dd → 36b1 속성 사전 */
export function readHeaderAttrs(r: TlvReader, header: TlvNode | undefined, warn: Warn): SkpAttrDicts | undefined {
  if (!header) return undefined;
  const holder = r.firstSafe(header, TAG.ATTRS);
  const list = holder && r.firstSafe(holder, TAG.ATTR_LIST);
  return list ? readAttrList(r, list, warn) : undefined;
}

/** 바탕(07d0) → 05dc → 05dd 속성 사전(바탕이 없으면 undefined) */
export function readBaseAttrs(r: TlvReader, base: TlvNode | undefined, warn: Warn): SkpAttrDicts | undefined {
  if (!base) return undefined;
  return readHeaderAttrs(r, r.firstSafe(base, TAG.ID_BOX), warn);
}

// ── 설정 공급자(0200: UnitsOptions·PageOptions·SlideshowOptions …) ─────────

export type SkpOptions = Map<string, Map<string, SkpAttr>>;

/** 설정 절 0x0200 → 공급자 이름 → 열쇠 → 값 */
export function readOptions(r: TlvReader, options: TlvNode, warn: Warn): SkpOptions {
  const out: SkpOptions = new Map();
  const list = r.path(options, TAG.OPT_A, TAG.OPT_B);
  if (!list) return out;
  r.eachSafe(list.start, list.end, (tag, start, end, clipped) => {
    if (tag !== TAG.OPT_GROUP || clipped) return;
    let name = '';
    const entries = new Map<string, SkpAttr>();
    r.eachSafe(start, end, (t, s, e, c) => {
      if (c) return;
      if (t === TAG.OPT_GROUP_NAME) name = r.str({ tag: t, start: s, end: e }) ?? '';
      else if (t === TAG.OPT_VALUES) {
        let key: string | undefined;
        r.eachSafe(s, e, (vt, vs, ve, vc) => {
          if (vc) return;
          if (vt === TAG.OPT_KEY) key = r.str({ tag: vt, start: vs, end: ve });
          else if (vt === TAG.VARIANT && key !== undefined) {
            const v = readValue(r, { tag: vt, start: vs, end: ve }, warn);
            if (v !== undefined) entries.set(key, v);
            key = undefined;
          }
        });
      }
    });
    out.set(name, entries);
  });
  return out;
}

const LENGTH_UNITS: SkpUnitsMeta['lengthUnit'][] = ['inch', 'feet', 'mm', 'cm', 'm', 'yard'];
const LENGTH_FORMATS: SkpUnitsMeta['lengthFormat'][] = ['decimal', 'architectural', 'engineering', 'fractional'];
const AREA_UNITS = ['square_inch', 'square_feet', 'square_mm', 'square_cm', 'square_m', 'square_yard'];
const VOLUME_UNITS = ['cubic_inch', 'cubic_feet', 'cubic_mm', 'cubic_cm', 'cubic_m', 'cubic_yard', 'liter', 'us_gallon'];

/** 수(참/거짓 제외)면 0 쪽으로 자른 정수 */
function intOf(v: SkpAttr | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

/** 파이썬 bool()처럼(빈 글·0·빈 배열·nil = 거짓) */
function truthy(v: SkpAttr | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** UnitsOptions 공급자 → 단위 표시 설정(공급자가 없으면 undefined). 모르는 길이 코드는 inch, 형식은 decimal */
export function unitsFromOptions(options: SkpOptions): SkpUnitsMeta | undefined {
  const u = options.get('UnitsOptions');
  if (!u) return undefined;
  const num = (k: string, d: number): number => intOf(u.get(k)) ?? d;
  const code = (k: string, table: string[]): string | null => {
    if (!u.has(k)) return null;
    return table[num(k, -1)] ?? null;
  };
  return {
    lengthUnit: LENGTH_UNITS[num('LengthUnit', 0)] ?? 'inch',
    lengthFormat: LENGTH_FORMATS[num('LengthFormat', 0)] ?? 'decimal',
    lengthPrecision: num('LengthPrecision', 1),
    anglePrecision: num('AnglePrecision', 1),
    areaUnit: code('AreaUnit', AREA_UNITS),
    areaPrecision: u.has('AreaPrecision') ? num('AreaPrecision', 0) : null,
    volumeUnit: code('VolumeUnit', VOLUME_UNITS),
    volumePrecision: u.has('VolumePrecision') ? num('VolumePrecision', 0) : null,
    suppressUnits: truthy(u.get('SuppressUnitsDisplay')),
  };
}

/** UnitsOptions/LengthUnit 코드(옛 lengthUnit 칸, 정수 값일 때만) */
export function lengthUnitCode(options: SkpOptions): number | undefined {
  const v = options.get('UnitsOptions')?.get('LengthUnit');
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
}

/** Model Info > Animation(PageOptions·SlideshowOptions). 둘 다 없으면 undefined */
export function animationFromOptions(options: SkpOptions): SkpAnimation | undefined {
  const pages = options.get('PageOptions');
  const slides = options.get('SlideshowOptions');
  if (!pages && !slides) return undefined;
  const out: SkpAnimation = {};
  const flag = (g: Map<string, SkpAttr> | undefined, k: string): boolean | undefined => {
    const v = g?.get(k);
    return typeof v === 'boolean' ? v : undefined;
  };
  const seconds = (g: Map<string, SkpAttr> | undefined, k: string): number | undefined => {
    const v = g?.get(k);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const show = flag(pages, 'ShowTransition');
  if (show !== undefined) out.showTransition = show;
  const t = seconds(pages, 'TransitionTime');
  if (t !== undefined) out.transitionTime = t;
  const d = seconds(slides, 'SlideTime');
  if (d !== undefined) out.sceneDelay = d;
  const loop = flag(slides, 'LoopSlideshow');
  if (loop !== undefined) out.loop = loop;
  return out;
}

// ── GUID·이름 표 ───────────────────────────────────────────────

const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/**
 * 16바이트 GUID(Windows GUID 구조체: 앞 4·2·2바이트 리틀 엔디언, 뒤 8바이트 빅 엔디언) → IFC 22자 글.
 * 16바이트가 아니거나 모두 0이면 undefined(쓰기 도구·빈 GUID).
 */
export function ifcGuid(b: Uint8Array): string | undefined {
  if (b.length !== 16 || b.every((x) => x === 0)) return undefined;
  const le = (o: number, n: number): bigint => {
    let v = 0n;
    for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]!);
    return v;
  };
  let tail = 0n;
  for (let i = 8; i < 16; i++) tail = (tail << 8n) | BigInt(b[i]!);
  const v = (le(0, 4) << 96n) | (le(4, 2) << 80n) | (le(6, 2) << 64n) | tail;
  let s = IFC_CHARS[Number(v >> 126n)]!;
  for (let i = 0; i < 21; i++) s += IFC_CHARS[Number((v >> BigInt(120 - 6 * i)) & 63n)]!;
  return s;
}

const ARROWS: SkpArrow[] = ['none', 'slash', 'dot', 'closed', 'open'];
const LEADERS: SkpLeaderType[] = ['none', 'view_based', 'pushpin'];

/** SUArrowType 코드 0..4 → 이름(범위 밖은 undefined) */
export function arrowName(code: number | undefined): SkpArrow | undefined {
  return code === undefined ? undefined : ARROWS[code];
}

/** 지시선 종류 0..2 → 이름(범위 밖은 undefined) */
export function leaderName(code: number | undefined): SkpLeaderType | undefined {
  return code === undefined ? undefined : LEADERS[code];
}

/** 치수 글 자리(SketchUp 메뉴 표 코드): 0 above, 1 center, 3 outside */
export function textAlignmentName(code: number | undefined): 'above' | 'center' | 'outside' | undefined {
  return code === 0 ? 'above' : code === 1 ? 'center' : code === 3 ? 'outside' : undefined;
}

/** 4바이트 r,g,b,a → [r, g, b](0~255). 꼭 4바이트일 때만 */
export function rgbOf(r: TlvReader, n: TlvNode | undefined): [number, number, number] | undefined {
  if (!n || n.end - n.start !== 4) return undefined;
  return [r.b[n.start]!, r.b[n.start + 1]!, r.b[n.start + 2]!];
}

// ── 벡터 ───────────────────────────────────────────────────────

export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const finite3 = (a: Vec3): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

/** 길이 1로(없음·0·비유한이면 undefined) */
export function unit3(v: Vec3 | undefined): Vec3 | undefined {
  if (!v) return undefined;
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!l || !Number.isFinite(l)) return undefined;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 4×4 열 우선 행렬로 점 옮기기(w로 나눈다, w = 0이면 1) */
export function apply4(m: ArrayLike<number>, p: Vec3): Vec3 {
  const [x, y, z] = p;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
  return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w];
}
