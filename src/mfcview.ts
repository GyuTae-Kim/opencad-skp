/**
 * SketchUp 2020 이하(MFC)의 보기 자료: 카메라(CCamera), 렌더링 설정 덩어리, 스타일(CSkpStyle), 장면(CViewPage), 글꼴(CSkFont),
 * 선 종류(CCustomLineStyle)와 모형 꼬리(뿌리 요소 뒤: 위치·장면·축·문자/치수 기본값·글꼴·선 종류·스타일). 형상은 없다.
 * 형식 지식은 2026-10 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의 legacy 해석기에서 옮긴 것이다(docs/formats/skp.md).
 *
 * 렌더링 설정은 클래스 꼬리표 없이 고정 길이 덩어리로 쓴다(CRenderingOptions 스키마마다 길이·칸 자리가 다르고, 장면 안에서는 8바이트 짧고,
 * SketchUp 2017+는 앞에 1바이트가 더 있다). SketchUp은 렌더링 설정을 스타일로 받치므로 색·켜고 끄기는 스타일 값이 이기고,
 * 면 스타일(그리기 방식)·무늬·X-ray·숨긴 형상·단면 채우기는 덩어리 값이 이긴다(장면은 스타일 사본을 건드리지 않고 덩어리만 바꾼다).
 * 이것을 2021+와 같은 꼴(SkpRenderingRaw의 0x733c 자식 꼬리표 값 + style.xml 항목 번호 글)로 옮겨 styles.ts가 함께 푼다.
 */

import type { SkpAnnotationDefaults, SkpAxes, SkpCamera, SkpFont, SkpPage, SkpRenderingRaw, SkpShadowInfo } from './model';
import { axesOf } from './vffroot';
import { MfcError, type MfcReadFn } from './mfcstream';
import { C, type MfcState } from './mfcstate';
import { arrowName, leaderName, textAlignmentName } from './vffcommon';

/** CRenderingOptions 스키마 → 모형 카메라 뒤 덩어리 길이(장면 안은 8 짧다) */
export const RENDERING_BLOCK: Readonly<Record<number, number>> = { 33: 190, 35: 197, 36: 216, 37: 221, 38: 222, 39: 223 };

type Field = 'xray' | 'background' | 'foreground' | 'texture' | 'profiles' | 'hiddenGeometry' | 'front' | 'back' | 'sky' | 'ground' | 'drawSky' | 'drawGround' | 'sectionFill';

/** 덩어리 안 칸 자리(2017+ 앞 1바이트를 뺀 뒤) */
const RO_36: Partial<Record<Field, number>> = {
  xray: 6,
  background: 13,
  foreground: 17,
  texture: 32,
  profiles: 42,
  hiddenGeometry: 58,
  front: 63,
  back: 67,
  sky: 123,
  ground: 131,
  drawSky: 135,
  drawGround: 136,
};
const RO_38: Partial<Record<Field, number>> = {
  xray: 6,
  background: 14,
  foreground: 18,
  texture: 33,
  profiles: 43,
  hiddenGeometry: 59,
  front: 64,
  back: 68,
  sky: 124,
  ground: 132,
  drawSky: 136,
  drawGround: 137,
  sectionFill: 167,
};
const RO_FIELDS: Readonly<Record<number, Partial<Record<Field, number>>>> = {
  33: RO_36,
  35: RO_36,
  36: RO_36,
  37: { ...RO_36, sectionFill: 166 },
  38: RO_38,
  39: { ...RO_38, front: 65, back: 69, sky: 125, ground: 133, drawSky: 137, drawGround: 138, sectionFill: 168 },
};

/** 덩어리 값이 이기는 칸: [0x733c 자식 꼬리표, 칸] */
const BLOCK_FLAGS: readonly [number, Field][] = [
  [0x7340, 'texture'],
  [0x733e, 'xray'],
  [0x7380, 'hiddenGeometry'],
  [0x7376, 'sectionFill'],
];
/** 스타일 값이 이기는 색: [꼬리표, 칸, 스타일 항목] */
const STYLE_COLORS: readonly [number, Field, number][] = [
  [0x7357, 'background', 4000],
  [0x7358, 'foreground', 1014],
  [0x735c, 'front', 2002],
  [0x735d, 'back', 2003],
  [0x7365, 'sky', 4001],
  [0x7367, 'ground', 4003],
];
/** 스타일 값이 이기는 켜고 끄기 */
const STYLE_FLAGS: readonly [number, Field, number][] = [
  [0x7368, 'drawSky', 4002],
  [0x7369, 'drawGround', 4004],
  [0x734f, 'profiles', 1006],
];

/** 스타일(CSkpStyle) */
export interface MfcStyle {
  /** 스타일 사본마다 다른 열쇠(styles 모음의 열쇠 = SkpRenderingRaw.styleName) */
  key: string;
  name: string;
  /** 항목 번호 → 값 글(2021+ style.xml과 같은 번호·글 꼴) */
  items: Map<number, string>;
  /** 항목 번호 → 저장 꼴(1 참/거짓, 4 수, 5 색, 6 float, 7 double) */
  kinds: Map<number, number>;
}

/** 장면 하나와, 모형 전체를 읽은 뒤 풀 참조 */
export interface MfcPage {
  page: SkpPage;
  /** 숨긴 개체 목록(클래스와 묶은 차례) */
  hidden: { cls: string; packed: number }[];
  /** 숨긴 개체 목록 중 읽지 않은 대상을 가리킨 수 */
  unresolved: number;
  /** 숨긴 태그(읽은 차례) */
  layers: number[];
  /** 활성 단면(묶은 차례) */
  sections: number[];
}

/** 장면 숨긴 목록이 가리킬 수 있는 클래스 */
export const HIDDEN_CLASSES: ReadonlySet<string> = new Set([
  'CFace',
  'CEdge',
  'CComponentInstance',
  'CGroup',
  'CImage',
  'CText',
  'CDimensionLinear',
  'CDimensionRadial',
  'CConstructionLine',
  'CConstructionPoint',
  'CSectionPlane',
]);

/** CViewPage use 깃발 */
const PAGE_CAMERA = 0x1;
const PAGE_RENDERING = 0x2;
const PAGE_SHADOWS = 0x4;
const PAGE_AXES = 0x8;
const PAGE_HIDDEN = 0x10;
const PAGE_LAYERS = 0x20;
const PAGE_SECTIONS = 0x40;
/** SketchUp 2020.1부터 0x10(숨긴 것)을 숨긴 형상 0x80 · 숨긴 개체 0x100으로 나눴다 */
const PAGE_HIDDEN_SPLIT = 0x180;

const SOLID_LINE_STYLES = new Set(['', 'Solid Basic']);
const MAX_POINTS = 10_000;
const FACE_LIMIT = 256;

/** 보기 자료 읽기(장면·스타일은 모형 꼬리에서 읽고, 모형을 다 읽은 뒤 mfcmodel.ts가 마무리한다) */
export class MfcView {
  readonly st: MfcState;
  readonly pages: MfcPage[] = [];
  activePage: number | undefined;
  /** 모형의 작업 스타일 사본(없으면 스타일 목록 끝) */
  modelStyle: MfcStyle | undefined;
  activeStyle: MfcStyle | undefined;
  defaults: SkpAnnotationDefaults | undefined;
  /** 모형 위치·그림자(모형 꼬리 CShadowInfo)와 그리기 축(CSketchCS, 기본 축이면 없음) */
  shadow: SkpShadowInfo | undefined;
  axesValue: SkpAxes | undefined;
  /** 스타일 열쇠 → 항목(index.ts가 장면·모형 스타일을 풀 때 쓴다) */
  readonly styles = new Map<string, Map<number, string>>();

  constructor(st: MfcState) {
    this.st = st;
  }

  readers(): Record<string, MfcReadFn> {
    return {
      CCamera: () => this.camera(),
      CSkFont: (slot) => this.font(slot),
      CCustomLineStyle: () => this.lineStyle(),
      CSkpStyle: (slot) => this.style(slot),
      CViewPage: (slot) => this.page(slot),
    };
  }

  /** CCamera: 눈·목표·위, 16바이트, u8 원근, 시야각, 평행 높이, 24바이트, 종횡비(0 = 창), 2바이트, 설명, 그림 너비, u8 2점 투시, 24바이트 */
  camera(): SkpCamera | null {
    const s = this.st.s;
    const eye = s.vec3();
    const target = s.vec3();
    const up = s.vec3();
    s.skip(16);
    const perspective = s.u8() !== 0;
    const fov = s.f64();
    const height = s.f64();
    s.skip(24);
    const aspect = s.f64();
    s.skip(2);
    s.cstr();
    s.f64();
    const twoPoint = s.u8() !== 0;
    s.skip(24);
    if (![...eye, ...target, ...up].every(Number.isFinite) || (eye[0] === target[0] && eye[1] === target[1] && eye[2] === target[2])) {
      this.st.note('깨진 카메라를 건너뛰었습니다');
      return null;
    }
    const out: SkpCamera = { eye, target, up, perspective, twoPoint };
    if (perspective) {
      if (Number.isFinite(fov)) out.fov = fov;
    } else if (Number.isFinite(height)) out.height = height;
    if (Number.isFinite(aspect) && aspect > 0) out.aspect = aspect;
    return out;
  }

  /** CSkFont: 글꼴 이름, u8 굵게, u8 기울임, i32 점 크기, u8 세계 크기 쓰기, f64 세계 크기(인치). 값은 글꼴 번호(= 칸) */
  font(slot: number): number {
    const st = this.st;
    const s = st.s;
    st.preamble();
    const face = s.cstr().slice(0, FACE_LIMIT);
    const bold = s.u8() !== 0;
    const italic = s.u8() !== 0;
    const points = s.i32();
    const world = s.u8() !== 0;
    const size = s.f64();
    const f: SkpFont = { face, bold, italic };
    if (points > 0 && points <= MAX_POINTS) f.pointSize = points;
    if (world && Number.isFinite(size) && size > 0) f.worldSize = size;
    st.fonts.set(slot, f);
    return slot;
  }

  /** CCustomLineStyle: (스키마 2 이하는 앞머리를 두 번) 이름, 점선 글, 24바이트. 실선이면 null */
  lineStyle(): string | null {
    const st = this.st;
    const s = st.s;
    st.preamble();
    if (st.schema('CCustomLineStyle') <= 2) st.preamble();
    const name = s.cstr();
    s.cstr();
    s.skip(24);
    return SOLID_LINE_STYLES.has(name) ? null : name;
  }

  /** CSkpStyle: 16바이트 GUID, 글, u32, 이름, 설명, 설정(u32 항목, u32 있음, u32 꼴, 값) */
  style(slot: number): MfcStyle {
    const st = this.st;
    const s = st.s;
    st.preamble();
    s.skip(16);
    s.cstr();
    s.u32();
    const name = s.cstr();
    s.cstr();
    const items = new Map<number, string>();
    const kinds = new Map<number, number>();
    const n = s.count(100_000, '스타일 설정');
    for (let i = 0; i < n; i++) {
      const key = s.u32();
      if (!s.u32()) continue;
      const at = s.pos;
      const kind = s.u32();
      let v: string;
      if (kind === 1) v = s.u8() ? '1' : '0';
      else if (kind === 4 || kind === 5) v = String(s.i32());
      else if (kind === 6) v = String(s.f32());
      else if (kind === 7) v = String(s.f64());
      else throw new MfcError('unsupported', `아직 읽지 못하는 스타일 값 꼴 ${kind}`, at);
      items.set(key, v);
      kinds.set(key, kind);
    }
    const style: MfcStyle = { key: `${name}\u0000${slot}`, name, items, kinds };
    this.styles.set(style.key, items);
    return style;
  }

  /** 렌더링 설정 덩어리(2017+ 앞 1바이트는 버린다) */
  renderingBlock(insidePage: boolean): Uint8Array {
    const st = this.st;
    const size = (RENDERING_BLOCK[st.schema('CRenderingOptions')] ?? 0) - (insidePage ? 8 : 0);
    const extra = st.schema('CSketchUpModel') >= 26 ? 1 : 0;
    return st.s.bytes(size + extra).subarray(extra);
  }

  /** 덩어리 + 스타일 → 2021+ 꼴 렌더링 원본. 덩어리 꼴을 모르면 undefined */
  rendering(block: Uint8Array, style: MfcStyle | undefined): SkpRenderingRaw | undefined {
    const fields = RO_FIELDS[this.st.schema('CRenderingOptions')];
    if (!fields || block.length < 8) return undefined;
    const values = new Map<number, Uint8Array>();
    values.set(0x733d, block.slice(2, 6)); // RenderMode u32
    const at = (f: Field, n: number): number | undefined => {
      const o = fields[f];
      return o !== undefined && o + n <= block.length ? o : undefined;
    };
    const flag = (tag: number, f: Field): void => {
      const o = at(f, 1);
      if (o !== undefined) values.set(tag, new Uint8Array([block[o] ? 1 : 0]));
    };
    for (const [tag, f] of BLOCK_FLAGS) flag(tag, f);
    for (const [tag, f, item] of STYLE_COLORS) {
      const k = style?.kinds.get(item);
      if (k === 4 || k === 5) continue;
      const o = at(f, 4);
      // 알파 칸은 255로(2021+에서 네 바이트 0은 "스타일에 맡김"이다)
      if (o !== undefined) values.set(tag, new Uint8Array([block[o]!, block[o + 1]!, block[o + 2]!, 255]));
    }
    for (const [tag, f, item] of STYLE_FLAGS) if (style?.kinds.get(item) !== 1) flag(tag, f);
    const raw: SkpRenderingRaw = { values };
    if (style) {
      raw.styleName = style.key;
      raw.activeName = style.name;
    }
    return raw;
  }

  /** CViewPage: 장면 하나. 저장된 부분은 use 깃발이 정한다 */
  page(slot: number): MfcPage {
    const st = this.st;
    const s = st.s;
    const pre = st.preamble();
    const name = s.cstr();
    const description = s.cstr();
    const stored = s.u32();
    const page: SkpPage = { name, description, flags: pageFlags(stored), hiddenIds: [], hiddenTags: [], sectionIds: [] };
    if (pre.pid !== undefined) page.pid = pre.pid;
    const out: MfcPage = { page, hidden: [], unresolved: 0, layers: [], sections: [] };
    if (stored & PAGE_CAMERA) {
      const cam = s.readObject(C.CAMERA) as SkpCamera | null;
      if (cam) page.camera = cam;
    }
    if (stored & PAGE_RENDERING) {
      const block = this.renderingBlock(true);
      const style = s.readObject(C.STYLE) as MfcStyle | null;
      const raw = this.rendering(block, style ?? undefined);
      if (raw) page.rendering = raw;
    }
    if (stored & PAGE_SHADOWS) page.shadowInfo = this.shadowInfo();
    if (stored & PAGE_AXES) this.axes();
    if (stored & PAGE_HIDDEN) {
      const n = s.count(10_000_000, '장면 숨긴 개체');
      for (let i = 0; i < n; i++) {
        const v = s.readObject();
        const cls = s.lastClass;
        if (!HIDDEN_CLASSES.has(cls)) continue;
        if (typeof v === 'number' && v >= 0) out.hidden.push({ cls, packed: v });
        else out.unresolved++;
      }
    }
    if (stored & PAGE_LAYERS) {
      const n = s.count(1_000_000, '장면 태그');
      for (let i = 0; i < n; i++) {
        const l = s.readObject(C.LAYER);
        if (typeof l === 'number' && l >= 0) out.layers.push(l);
      }
    }
    if (stored & PAGE_SECTIONS) {
      const n = s.count(1_000_000, '장면 단면');
      for (let i = 0; i < n; i++) {
        const sec = s.readObject(C.SECTION_PLANE);
        if (typeof sec === 'number' && sec >= 0) out.sections.push(sec);
      }
    }
    page.includeInAnimation = s.u8() !== 0;
    const transition = s.f64();
    const delay = s.f64();
    if (Number.isFinite(transition) && transition >= 0) page.transition = transition;
    if (Number.isFinite(delay) && delay >= 0) page.delay = delay;
    s.readObject(C.DIB);
    if (st.schema('CViewPage') >= 12) {
      s.u8();
      if (s.u8()) {
        s.u8();
        const n = s.count(s.end, '장면 그림 바이트');
        const start = s.pos;
        s.skip(n);
        if (n > 0) {
          const path = `scene_thumbnails/${slot}-${name}`;
          page.thumbnail = path;
          st.images.push({ kind: 'scene', name, path, start, end: start + n, dib: false });
        }
      }
    }
    return out;
  }

  /**
   * 줄 안에 쓴 CShadowInfo: 2021+ 6590과 같은 차례 — 앞머리, u32 시각, u8, 도시, 나라, f64 경도·위도·시간대, f64×3 북쪽, 4바이트 깃발,
   * i32 밝음·어둠, 2바이트. 깃발 넷은 2020 이하 파일이 모두 0 1 1 0이라 어느 것이 그림자 보이기인지 몰라 넣지 않는다(엔진 legacy와 같다)
   */
  shadowInfo(): SkpShadowInfo {
    const st = this.st;
    const s = st.s;
    st.preamble();
    const out: SkpShadowInfo = { time: s.u32() };
    s.u8();
    const city = s.cstr().slice(0, 256);
    const country = s.cstr().slice(0, 256);
    if (city) out.city = city;
    if (country) out.country = country;
    const v = s.doubles(6);
    const fin = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
    if (fin(v[0])) out.longitude = v[0];
    if (fin(v[1])) out.latitude = v[1];
    if (fin(v[2])) out.tz = v[2];
    if (fin(v[3]) && fin(v[4]) && fin(v[5])) out.north = [v[3], v[4], v[5]];
    s.skip(4);
    out.light = s.i32();
    out.dark = s.i32();
    s.skip(2);
    return out;
  }

  /**
   * 줄 안에 쓴 CSketchCS(그리기 축): 앞머리, 10바이트, f64×12(원점, x·y·z 축 — 2021+ 4651~4654와 같은 차례로 본다), u8.
   * 기본 축이면 undefined
   */
  axes(): SkpAxes | undefined {
    this.st.preamble();
    const s = this.st.s;
    s.skip(10);
    const v = s.doubles(12);
    s.skip(1);
    const p = (i: number): [number, number, number] => [v[i]!, v[i + 1]!, v[i + 2]!];
    return v.every(Number.isFinite) ? axesOf(p(0), p(3), p(6), p(9)) : undefined;
  }

  /**
   * 모형 꼬리(뿌리 요소 뒤): 위치, 장면 목록과 활성 장면, 축, 문자·치수 기본값과 글꼴, 글꼴 목록, (2019+) 선 종류, 스타일 목록·활성·작업 사본.
   * 그 뒤(워터마크·분류 체계 …)는 읽지 않는다.
   */
  readTail(): void {
    const st = this.st;
    const s = st.s;
    const pids = st.entityPids;
    this.shadow = this.shadowInfo();
    s.skip(pids ? 2 : 1);
    const seen = new Set<MfcPage>();
    const n = s.count(100_000, '장면');
    for (let i = 0; i < n; i++) {
      const p = s.readObject(C.PAGE) as MfcPage | null;
      // 이미 든 장면을 다시 가리키면 같은 장면이다
      if (p && !seen.has(p)) {
        seen.add(p);
        this.pages.push(p);
      }
    }
    const active = s.readObject(C.PAGE) as MfcPage | null;
    const ai = active ? this.pages.indexOf(active) : -1;
    if (ai >= 0) this.activePage = ai;
    this.axesValue = this.axes();
    // Model Info 기본값: 치수 글꼴 + 58바이트(2021+ 24502..24518과 같은 차례), 문자 글꼴 + 22바이트, 지시선 글꼴
    s.skip(pids ? 70 : 69);
    const dimFont = s.readObject(C.FONT);
    const dim = s.bytes(58);
    s.skip((pids ? 61 : 60) - 58);
    const textFont = s.readObject(C.FONT);
    const text = s.bytes(22);
    const leaderFont = s.readObject(C.FONT);
    s.skip(pids ? 3 : 2);
    this.defaults = annotationDefaults(dim, text, dimFont, textFont, leaderFont);
    const fonts = s.count(100_000, '글꼴');
    for (let i = 0; i < fonts; i++) s.readObject(C.FONT);
    if (st.schema('CLineStyleManager') >= 1) {
      s.skip(3);
      const k = s.count(100_000, '선 종류');
      for (let i = 0; i < k; i++) s.readObject(C.LINE_STYLE);
      s.skip(5);
    } else s.skip(pids ? 5 : 4);
    const styles: MfcStyle[] = [];
    const k = s.count(100_000, '스타일');
    for (let i = 0; i < k; i++) {
      const v = s.readObject(C.STYLE) as MfcStyle | null;
      if (v) styles.push(v);
    }
    this.activeStyle = (s.readObject(C.STYLE) as MfcStyle | null) ?? undefined;
    const current = s.readObject(C.STYLE) as MfcStyle | null;
    this.modelStyle = current ?? styles[styles.length - 1];
  }
}

/** 저장 깃발 → 2021+ 꼴(0x10 숨긴 것 = 숨긴 형상 0x80 + 숨긴 개체 0x100, 2020.1의 나눈 깃발은 그대로) */
function pageFlags(stored: number): number {
  let f = stored & ~PAGE_HIDDEN;
  if (!(stored & PAGE_HIDDEN_SPLIT) && stored & PAGE_HIDDEN) f |= PAGE_HIDDEN_SPLIT;
  return f >>> 0;
}

const i32At = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset + o, 4).getInt32(0, true);

/**
 * Model Info 문자·치수 기본값.
 * 치수 58바이트: u8 글 정렬, u8, i32×5(넷째 = 끝 표시), u8, 4바이트, u8, u8, f64, u8, f64, 4바이트 색, 4바이트, i32 글 자리.
 * 문자 22바이트: i32 지시선 종류, i32, u8, i32 끝 표시, u8, 4바이트 화면 글 색, 4바이트 지시선 글 색.
 */
function annotationDefaults(dim: Uint8Array, text: Uint8Array, dimFont: unknown, textFont: unknown, leaderFont: unknown): SkpAnnotationDefaults {
  const out: SkpAnnotationDefaults = {};
  const font = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const set = <K extends keyof SkpAnnotationDefaults>(k: K, v: SkpAnnotationDefaults[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  set('textFont', font(textFont));
  set('leaderFont', font(leaderFont));
  set('textColor', [text[14]!, text[15]!, text[16]!]);
  set('leaderColor', [text[18]!, text[19]!, text[20]!]);
  set('leaderArrow', arrowName(i32At(text, 9)));
  set('leaderType', leaderName(i32At(text, 0)));
  set('dimFont', font(dimFont));
  set('dimColor', [dim[46]!, dim[47]!, dim[48]!]);
  set('dimArrow', arrowName(i32At(dim, 14)));
  set('dimAlignedText', dim[0] !== 0);
  set('dimTextAlignment', textAlignmentName(i32At(dim, 54)));
  return out;
}

