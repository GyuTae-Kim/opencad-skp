/**
 * SketchUp 2020 이하(머리 뒤 MFC CArchive 객체 직렬화) → 중간 모형(SkpModel, 2021+ 해석기와 같은 꼴).
 * SketchUp 7·8·2013~2020(CSketchUpModel 스키마 21~29)을 읽고, SketchUp 3~6은 분명한 까닭과 함께 거절한다(MfcRefused).
 * 형식 지식은 MFC 직렬화 규칙(Microsoft TN002)과, 사용자가 허락한 2026-10 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의
 * legacy 해석기·문서에서 옮긴 것이다(docs/formats/skp.md). 코드는 opencad-skp 꼴로 새로 썼다.
 *
 * 차례(클래스마다 스키마는 파일의 CVersionMap이 알린다):
 *   CString "SketchUp Model", CString "{판}", 16바이트 GUID, CString 경로, u32 시각
 *   CVersionMap(클래스 이름 → 스키마, "End-Of-Version-Map"까지)
 *   CSketchUpModel 본문: 12바이트, (스키마 26+) u64 다음 영구 번호, 미리보기 CDib, 14/15바이트, 설명, 설정 묶음,
 *     CAttributeContainer(ModelProperties 등), CDib, CCamera, 렌더링 덩어리, 뿌리 앞머리(모형 속성),
 *     CComponent 본문(재질·태그·(2020) 태그 폴더·정의·요소) + 꼬리(관계 0개, 활성 단면), 모형 꼬리(mfcview.ts)
 *   CComponentDefinition: CComponent 본문 + 꼬리, GUID, 이름, 설명, 경로, 시각, 동작 42/43바이트, CThumbnail
 *
 * 기록에 길이가 없어 하나라도 못 읽으면 그 뒤를 읽을 수 없다. 형상을 읽다 멈추면 그때까지 읽은 형상을 살려 damaged로 돌려주고,
 * 형상 뒤(장면·스타일)에서 멈추면 형상은 그대로 두고 경고한다.
 */

import type { SkpHeader } from './header';
import type { SkpMaterialInfo } from './materials';
import {
  FLAG_HIDDEN,
  FLAG_SMOOTH,
  FLAG_SOFT,
  matrixFrom13,
  type SkpAttr,
  type SkpAttrDicts,
  type SkpBehavior,
  type SkpCamera,
  type SkpCurve,
  type SkpDefinition,
  type SkpEdge,
  type SkpEntities,
  type SkpFace,
  type SkpInstance,
  type SkpModel,
  type SkpPage,
  type SkpTag,
  type SkpTagFolder,
  type SkpTextureMap,
} from './model';
import { annotationReaders, elementFlags } from './mfcannot';
import {
  C,
  cidOf,
  indexOf,
  newCollection,
  pack,
  type AttrContainer,
  type Collection,
  type CurveRaw,
  type FaceTextureCoords,
  type MfcImageRef,
  MfcState,
} from './mfcstate';
import { MfcError, MfcStream } from './mfcstream';
import { HIDDEN_CLASSES, MfcView, RENDERING_BLOCK, type MfcPage } from './mfcview';
import { animationFromOptions, ifcGuid, lengthUnitCode, unitsFromOptions, type SkpOptions } from './vffcommon';

/** 읽는 CSketchUpModel 스키마: SketchUp 7(21) ~ 2020(29) */
const MIN_MODEL_SCHEMA = 21;
const MAX_MODEL_SCHEMA = 29;
/** 칸(클래스·객체) 수 한도 — 브라우저 메모리 보호 */
export const MFC_MAX_RECORDS = 60_000_000;
const MAX_DEFINITIONS = 1_000_000;
/** 정의 안에 정의를 바로 쓴 겹 한도(자기를 품는 깨진 파일·스택 보호) */
const MAX_NESTING = 64;
const DEFAULT_LAYER_NAMES = new Set(['Layer0', 'Untagged']);
/** 색을 정하지 않은 태그(SketchUp은 회색으로 보인다) */
const UNSET_LAYER_COLOR: [number, number, number] = [64, 64, 64];
const SNAP_TO = ['any', 'horizontal', 'vertical', 'sloped'] as const;

/** SketchUp 3~6처럼 읽지 않는 옛 판 */
export class MfcRefused extends Error {
  readonly modelSchema: number;
  readonly renderingSchema: number;
  constructor(message: string, modelSchema: number, renderingSchema: number) {
    super(message);
    this.modelSchema = modelSchema;
    this.renderingSchema = renderingSchema;
  }
}

export interface MfcResult {
  model: SkpModel;
  /** 재질 열쇠(model.materials의 값) → 색·무늬 여부 */
  materials: Map<string, SkpMaterialInfo>;
  /** 스타일 열쇠(SkpRenderingRaw.styleName) → 항목(2021+ style.xml 꼴) */
  styles: Map<string, Map<number, string>>;
  images: MfcImageRef[];
}

interface MaterialRec {
  key: string;
  info: SkpMaterialInfo;
  /** 반투명(SketchUp 7 파일은 반투명 재질을 면 양쪽에 보인다) */
  translucent: boolean;
}

interface LayerRec {
  name: string;
  hidden: boolean;
  color: [number, number, number];
  folder?: number;
  lineStyle?: string;
  attrs?: SkpAttrDicts;
}

interface DefRec {
  coll: Collection;
  name: string;
  description: string;
  guid?: string;
  behavior?: SkpBehavior;
  kinds: Set<'component' | 'group' | 'image'>;
  attrs?: SkpAttrDicts;
}

/** 고리(CLoop) 읽는 동안 모은 모서리 사용 */
interface LoopRec {
  edges: number[];
  rev: number[];
  outer: boolean;
  used: boolean;
}

interface DibRef {
  kind: number;
  start: number;
  end: number;
}

const isDib = (v: unknown): v is DibRef => !!v && typeof v === 'object' && 'kind' in v && 'start' in v;

/** 그림 길(엔진 image_name: 경로의 마지막 이름) */
const baseName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? '';

/** 속성 사전에 넣기(__proto__ 같은 이름도 제 칸으로) */
function put<T>(o: Record<string, T>, k: string, v: T): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

class Decoder {
  readonly st: MfcState;
  readonly s: MfcStream;
  readonly view: MfcView;
  readonly header: SkpHeader;
  readonly materials: MaterialRec[] = [];
  private readonly materialKeys = new Set<string>();
  readonly layers: LayerRec[] = [];
  private readonly layerByName = new Map<string, number>();
  readonly folders: SkpTagFolder[] = [];
  readonly defs: DefRec[] = [];
  private modelLayerPhase = true;
  private folderParent = -1;
  private folderKeep = true;
  private loop: LoopRec | null = null;
  activeLayer: number | undefined;
  damaged = false;

  constructor(bytes: Uint8Array, header: SkpHeader) {
    this.header = header;
    this.s = new MfcStream(bytes, header.bodyOffset, MFC_MAX_RECORDS);
    this.st = new MfcState(this.s);
    this.view = new MfcView(this.st);
    const r = this.s.readers;
    const add = (o: Record<string, (slot: number) => unknown>): void => {
      for (const [k, fn] of Object.entries(o)) r.set(k, fn);
    };
    add({
      CVersionMap: () => this.versionMap(),
      CDib: () => this.dib(),
      CAttributeContainer: () => this.attributeContainer(),
      CAttributeNamed: () => this.attributeNamed(),
      CFaceTextureCoords: () => this.faceTextureCoords(),
      CThumbnail: () => this.thumbnail(),
      CMaterial: (slot) => this.material(slot),
      CLayer: (slot) => this.layer(slot),
      CLayerGroup: (slot) => this.layerFolder(slot),
      CComponentDefinition: (slot) => this.definition(slot),
      CComponentInstance: () => this.instance('component'),
      CGroup: () => this.instance('group'),
      CImage: () => this.instance('image'),
      CVertex: () => this.vertex(),
      CEdge: (slot) => this.edge(slot),
      CCurve: (slot) => this.curve(slot, false),
      CArcCurve: (slot) => this.curve(slot, true),
      CEdgeUse: () => this.edgeUse(),
      CLoop: (slot) => this.loopRecord(slot),
      CFace: () => this.face(),
    });
    add(annotationReaders(this.st));
    add(this.view.readers());
  }

  // ── 머리 ──────────────────────────────────────────────────────

  /** 머리 나머지(GUID·경로·시각)와 CVersionMap, 판 확인 */
  readHead(): void {
    const s = this.s;
    s.skip(16);
    s.cstr();
    s.u32();
    s.readObject(C.VERSION_MAP);
    const model = this.st.schemas.get('CSketchUpModel') ?? -1;
    const rendering = this.st.schemas.get('CRenderingOptions') ?? -1;
    if (!(model >= MIN_MODEL_SCHEMA && model <= MAX_MODEL_SCHEMA) || !(rendering in RENDERING_BLOCK)) {
      const old = model >= 0 && model < MIN_MODEL_SCHEMA;
      throw new MfcRefused(
        old
          ? `SketchUp ${this.header.version} 파일은 SketchUp 3~6의 아주 옛 형식(모형 스키마 ${model})이라 아직 읽지 못합니다. SketchUp 7 이상(가능하면 2021 이상)에서 다시 저장한 뒤 열어 주세요.`
          : `SketchUp ${this.header.version} 파일의 형식(모형 스키마 ${model}, 렌더링 스키마 ${rendering})은 확인한 SketchUp 7~2020 형식과 달라 읽지 못합니다.`,
        model,
        rendering,
      );
    }
  }

  private versionMap(): boolean {
    const s = this.s;
    const map = this.st.schemas;
    for (;;) {
      const name = s.cstr();
      const v = s.i32();
      if (name === 'End-Of-Version-Map') break;
      if (map.size > 4096) throw new MfcError('corrupt', 'CVersionMap이 너무 깁니다', s.pos);
      map.set(name, v);
    }
    this.st.entityPids = (map.get('CEntity') ?? 0) >= 5;
    return true;
  }

  // ── 모형 본문 ───────────────────────────────────────────────────

  /** 모형 본문 앞부분(형상 앞): 설명·설정·모형 속성·카메라·렌더링 덩어리 */
  readModelHead(): { description: string; options: SkpOptions; properties?: SkpAttrDicts; camera?: SkpCamera; block: Uint8Array } {
    const s = this.s;
    const st = this.st;
    const schema = st.schema('CSketchUpModel');
    s.skip(12);
    if (schema >= 26) s.skip(8); // 다음 영구 번호
    const thumb = s.readObject(C.DIB);
    if (isDib(thumb)) this.image('model', '모형 미리보기', thumb);
    s.skip(schema >= 26 ? 15 : 14);
    const description = s.cstr();
    const options = this.options();
    // SketchUp 자신의 기록 사전(ModelProperties 등) — 2021+의 모형 속성 절(0x0209)과 같다
    const props = s.readObject(C.ATTRIBUTE_CONTAINER) as AttrContainer | null;
    s.readObject(C.DIB);
    const camera = s.readObject(C.CAMERA) as SkpCamera | null;
    const block = this.view.renderingBlock(false);
    const out: ReturnType<Decoder['readModelHead']> = { description, options, block };
    if (props && Object.keys(props.dicts).length) out.properties = props.dicts;
    if (camera) out.camera = camera;
    return out;
  }

  /** 뿌리 요소(형상 전체). 뿌리 앞머리의 속성 = 모형 속성 */
  readRoot(): Collection {
    const st = this.st;
    const root = newCollection(0);
    st.collections.push(root);
    st.stack.push(root);
    const pre = st.preamble();
    if (pre.attrs) root.attrs = pre.attrs;
    this.componentBody(true);
    st.stack.pop();
    this.componentTail(root);
    return root;
  }

  /** 설정 묶음: u32, 묶음 수 × (이름, 열쇠 + 형 있는 값 … 빈 열쇠) */
  private options(): SkpOptions {
    const s = this.s;
    s.u32();
    const out: SkpOptions = new Map();
    const n = s.count(4096, '설정 묶음');
    for (let i = 0; i < n; i++) {
      const name = s.cstr();
      const entries = new Map<string, SkpAttr>();
      for (;;) {
        const key = s.cstr();
        if (!key) break;
        entries.set(key, this.st.typedValue());
      }
      out.set(name, entries);
    }
    return out;
  }

  /** CComponent 본문(모형과 정의가 같이 쓴다) */
  private componentBody(isModel: boolean): void {
    const s = this.s;
    const st = this.st;
    s.skip(st.entityPids ? 13 : 12);
    const mats = s.count(1_000_000, '재질');
    for (let i = 0; i < mats; i++) s.readObject(C.MATERIAL);
    s.u32();
    if (st.entityPids) s.u8();
    this.modelLayerPhase = isModel;
    const layers = s.count(1_000_000, '태그');
    for (let i = 0; i < layers; i++) s.readObject(C.LAYER);
    const active = s.readObject(C.LAYER);
    if (isModel && typeof active === 'number') this.activeLayer = active;
    this.modelLayerPhase = false;
    // SketchUp 2020 태그 폴더: 태그 관리자가 뿌리 폴더를 줄 안에 쓴다
    if (st.schema('CLayerManager') >= 7) this.folderBody(-1, isModel, true);
    const defs = s.count(MAX_DEFINITIONS, '정의');
    for (let i = 0; i < defs; i++) s.readObject(C.DEFINITION);
    const ents = s.count(50_000_000, '요소');
    for (let i = 0; i < ents; i++) s.readObject();
  }

  /** 관계(CRelationship, 0개여야 한다)와 활성 단면 */
  private componentTail(coll: Collection): void {
    const s = this.s;
    const at = s.pos;
    if (s.count(1_000_000, '관계')) throw new MfcError('unsupported', '아직 읽지 못하는 기록 CRelationship(정의 관계)', at);
    this.st.stack.push(coll);
    const active = s.readObject(C.SECTION_PLANE);
    this.st.stack.pop();
    if (typeof active === 'number' && active >= 0) {
      const sp = this.st.collections[cidOf(active)]?.sections[indexOf(active)];
      if (sp) sp.active = true;
    }
  }

  // ── 여러 클래스가 쓰는 기록 ─────────────────────────────────────────

  /** CDib: u32 꼴(0 날 DIB, 1 JPEG + 뒤 u32 품질, 4 부호화한 그림 파일), u32 길이, 바이트 */
  private dib(): DibRef {
    const s = this.s;
    const at = s.pos;
    const kind = s.u32();
    const size = s.u32();
    const start = s.pos;
    s.skip(size);
    if (kind === 1) s.u32();
    else if (kind !== 0 && kind !== 4) throw new MfcError('unsupported', `아직 읽지 못하는 그림 꼴 ${kind}`, at);
    return { kind, start, end: start + size };
  }

  private image(kind: MfcImageRef['kind'], name: string, d: DibRef, folder?: string): void {
    if (d.end <= d.start) return;
    const ref: MfcImageRef = { kind, name, start: d.start, end: d.end, dib: d.kind === 0 };
    if (folder !== undefined) ref.folder = folder;
    this.st.images.push(ref);
  }

  /** CAttributeContainer: 앞머리, CAttributeNamed·CFaceTextureCoords … 없음까지 */
  private attributeContainer(): AttrContainer {
    const s = this.s;
    this.st.preamble();
    const out: AttrContainer = { dicts: {} };
    for (;;) {
      const item = s.readObject(C.ATTRIBUTE_ITEMS);
      if (item === null) break;
      if (item && typeof item === 'object') {
        if ('frontFlags' in item) out.texture = item as FaceTextureCoords;
        else if ('name' in item && 'entries' in item) {
          const named = item as { name: string; entries: Record<string, SkpAttr> };
          put(out.dicts, named.name, named.entries);
        }
      }
    }
    return out;
  }

  /** CAttributeNamed: 앞머리, u32, 이름, 열쇠 + 형 있는 값 … 빈 열쇠, u32 */
  private attributeNamed(): { name: string; entries: Record<string, SkpAttr> } {
    const s = this.s;
    this.st.preamble();
    s.u32();
    const name = s.cstr();
    const entries: Record<string, SkpAttr> = {};
    for (;;) {
      const key = s.cstr();
      if (!key) break;
      put(entries, key, this.st.typedValue());
    }
    s.u32();
    return { name, entries };
  }

  /** CFaceTextureCoords: 앞머리, u32, f64×24(앞·뒤 3×4), 쪽마다 핀 수 × 32바이트, u32 앞·뒤 깃발(비트 0 = 위치 정함) */
  private faceTextureCoords(): FaceTextureCoords {
    const s = this.s;
    this.st.preamble();
    s.u32();
    const v = s.doubles(24);
    for (let side = 0; side < 2; side++) s.skip(32 * s.count(1024, '무늬 핀'));
    const frontFlags = s.u32();
    const backFlags = s.u32();
    return { front: v.slice(0, 12), back: v.slice(12), frontFlags, backFlags };
  }

  /** CThumbnail: 앞머리, CCamera, CDib */
  private thumbnail(): DibRef | null {
    const s = this.s;
    this.st.preamble();
    s.readObject(C.CAMERA);
    const d = s.readObject(C.DIB);
    return isDib(d) ? d : null;
  }

  // ── 재질·태그 ───────────────────────────────────────────────────

  /**
   * 재질 칸(태그 색에도 줄 안에 쓴다): 이름, u8 무늬, [CTexture: 앞머리, CDib, 너비, 높이(인치), 경로, 평균 RGBA], u8, RGBA, 표시 이름,
   * u32 꼴(0 색 · 1 무늬 · 2 색을 바꾼 무늬), u32 색 바꾸기 방식(0 shift · 1 tint), f64 투명도, u8 알파 쓰기
   */
  private materialBody(): {
    name: string;
    display: string;
    rgb: [number, number, number];
    colorAlpha: number;
    alpha: number;
    textured: boolean;
    translucent: boolean;
    /** 무늬 한 장 크기(인치)·원래 그림 평균색(무늬 재질이면) */
    tile?: { width: number; height: number; average: [number, number, number] };
    texture?: { dib: DibRef; path: string };
    colorize?: 'shift' | 'tint';
  } {
    const s = this.s;
    const name = s.cstr();
    const textured = s.u8() !== 0;
    let avg: Uint8Array = new Uint8Array([0, 0, 0, 255]);
    let texture: { dib: DibRef; path: string } | undefined;
    let width = 0;
    let height = 0;
    if (textured) {
      this.st.preamble();
      const d = s.readObject(C.DIB);
      width = s.f64();
      height = s.f64();
      const path = s.cstr();
      avg = s.bytes(4);
      if (isDib(d)) texture = { dib: d, path };
    }
    s.u8();
    const c = s.bytes(4);
    let rgb: [number, number, number] = [c[0]!, c[1]!, c[2]!];
    // 색을 정하지 않은 무늬 재질은 무늬 평균색
    if (!c[3] && textured) rgb = [avg[0]!, avg[1]!, avg[2]!];
    const display = s.cstr();
    const type = s.u32();
    const colorize = s.u32();
    const transparency = s.f64();
    const useAlpha = s.u8() !== 0;
    const opacity = useAlpha && Number.isFinite(transparency) ? Math.max(0, Math.min(1, 1 - transparency)) : 1;
    const out: ReturnType<Decoder['materialBody']> = {
      name,
      display,
      rgb,
      colorAlpha: c[3]!,
      alpha: opacity,
      textured,
      translucent: avg[3]! < 255 || opacity < 1,
    };
    // 무늬 크기: 2021+ material.xml의 xScale·yScale과 같은 뜻(인치). 0·음수·수가 아니면 1인치(2021+ 읽기와 같게)
    if (textured) {
      const size = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 1);
      out.tile = { width: size(width), height: size(height), average: [avg[0]!, avg[1]!, avg[2]!] };
    }
    if (texture) out.texture = texture;
    // 색을 바꾼 무늬(꼴 2): 재질 색이 바꾼 색, 평균색이 원래 그림 평균색(2021+ type 2와 같다)
    if (textured && type === 2) out.colorize = colorize === 1 ? 'tint' : 'shift';
    return out;
  }

  /** CMaterial: 앞머리 + 재질 칸. 값은 재질 차례 */
  private material(slot: number): number {
    this.st.preamble();
    const index = this.materials.length;
    this.s.values[slot] = index;
    const m = this.materialBody();
    let key = m.name || `재질 ${index + 1}`;
    if (this.materialKeys.has(key)) key = `${key} (${index + 1})`;
    this.materialKeys.add(key);
    // 2021+ material.xml 읽기와 같게: 알파를 쓰고 0 < 불투명도 < 1이면 그 값(너무 옅으면 0.15)
    const alpha = m.alpha < 1 && m.alpha > 0 ? Math.max(0.15, m.alpha) : 1;
    const info: SkpMaterialInfo = { name: m.display || m.name || key, color: [m.rgb[0] / 255, m.rgb[1] / 255, m.rgb[2] / 255, alpha], textured: m.textured };
    // 무늬: 크기·평균색(그림 바이트는 readSkpImages가 이 재질 열쇠를 폴더로 꺼낸다 — 무늬 좌표는 skpToScene의 textures로 입힌다)
    if (m.tile) {
      info.texture = { width: m.tile.width, height: m.tile.height, average: m.tile.average };
      const file = m.texture ? baseName(m.texture.path) : '';
      if (file) info.texture.file = file;
    }
    if (m.colorize) info.colorize = m.colorize;
    this.materials.push({ key, info, translucent: m.translucent });
    if (m.texture) this.image('material', baseName(m.texture.path) || key, m.texture.dib, key);
    return index;
  }

  /** CLayer: 앞머리, 이름, u8 숨김, 앞머리 + 색 재질 칸, 4바이트, (스키마 3+ = 2019+) CCustomLineStyle. 값은 읽은 태그 차례 */
  private layer(slot: number): number {
    const s = this.s;
    const st = this.st;
    const pre = st.preamble();
    const name = s.cstr();
    const hidden = s.u8() !== 0;
    st.preamble();
    const color = this.materialBody();
    s.skip(4);
    let lineStyle: string | undefined;
    if (st.schema('CLayer') >= 3) {
      const ls = s.readObject(C.LINE_STYLE);
      if (typeof ls === 'string') lineStyle = ls;
    }
    // 정의는 쓰지 않는 태그 목록을 따로 갖고 있다 — 그 안 요소는 같은 이름의 모형 태그를 가리킨다
    const known = this.layerByName.get(name);
    if (!this.modelLayerPhase && known !== undefined) {
      s.values[slot] = known;
      return known;
    }
    const rec: LayerRec = { name, hidden, color: color.colorAlpha ? color.rgb : UNSET_LAYER_COLOR };
    if (lineStyle) rec.lineStyle = lineStyle;
    if (pre.attrs) rec.attrs = pre.attrs;
    const index = this.layers.length;
    this.layers.push(rec);
    if (known === undefined) this.layerByName.set(name, index);
    return index;
  }

  /** 태그 폴더(CLayerGroup) 객체: 줄 안 뿌리 폴더 밑의 폴더 */
  private layerFolder(slot: number): number {
    const index = this.folderBody(this.folderParent, this.folderKeep, false);
    this.s.values[slot] = index;
    return index;
  }

  /** 태그 폴더 칸: 앞머리, 이름, 아래 폴더 수 × CLayerGroup, 든 태그 수 × CLayer, u8 숨김. 정의의 폴더는 읽기만 한다 */
  private folderBody(parent: number, keep: boolean, root: boolean): number {
    const s = this.s;
    this.st.preamble();
    const name = s.cstr();
    let index = -1;
    if (keep && !root) {
      index = this.folders.length;
      this.folders.push({ name, visible: true, parent });
    }
    const outer = [this.folderParent, this.folderKeep] as const;
    this.folderParent = index;
    this.folderKeep = keep;
    const kids = s.count(1_000_000, '태그 폴더');
    for (let i = 0; i < kids; i++) s.readObject(C.LAYER_FOLDER);
    [this.folderParent, this.folderKeep] = outer;
    const members = s.count(1_000_000, '폴더 태그');
    for (let i = 0; i < members; i++) {
      const l = s.readObject(C.LAYER);
      if (index >= 0 && typeof l === 'number' && this.layers[l]) this.layers[l]!.folder = index;
    }
    if (s.u8() && index >= 0) this.folders[index]!.visible = false;
    return index;
  }

  // ── 정의·인스턴스 ─────────────────────────────────────────────────

  private definition(slot: number): number {
    const s = this.s;
    const st = this.st;
    if (st.stack.length > MAX_NESTING) throw new MfcError('too_large', `정의가 ${MAX_NESTING}겹보다 깊게 겹쳤습니다`, s.pos);
    if (this.defs.length >= MAX_DEFINITIONS) throw new MfcError('too_large', `정의가 ${MAX_DEFINITIONS.toLocaleString('en-US')}개를 넘습니다`, s.pos);
    const pre = st.preamble();
    const coll = newCollection(st.collections.length);
    st.collections.push(coll);
    const rec: DefRec = { coll, name: '', description: '', kinds: new Set() };
    if (pre.attrs) {
      rec.attrs = pre.attrs;
      coll.attrs = pre.attrs;
    }
    const index = this.defs.length;
    this.defs.push(rec);
    s.values[slot] = index;
    st.stack.push(coll);
    this.componentBody(false);
    st.stack.pop();
    this.componentTail(coll);
    const guid = ifcGuid(s.bytes(16));
    if (guid) rec.guid = guid;
    rec.name = s.cstr();
    rec.description = s.cstr();
    s.cstr();
    s.u32();
    const block = s.bytes(st.entityPids ? 43 : 42);
    rec.behavior = behavior(block, st.entityPids ? 1 : 0);
    const thumb = s.readObject(C.THUMBNAIL);
    if (isDib(thumb)) this.image('component', rec.name || `정의 ${index + 1}`, thumb);
    return index;
  }

  /** CComponentInstance·CGroup·CImage: 그리기 요소, 정의, f64×13(3×3 행, 이동, w), 이름, (CComponentInstance 5+ = 2014+) GUID */
  private instance(kind: 'component' | 'group' | 'image'): number {
    const s = this.s;
    const st = this.st;
    const pre = st.preamble();
    const d = st.drawing();
    const def = s.readObject(C.DEFINITION);
    if (typeof def !== 'number' || !this.defs[def]) throw new MfcError('corrupt', '정의가 없는 인스턴스입니다', s.pos);
    const at = s.pos;
    const rows = s.doubles(13);
    if (!rows.every(Number.isFinite)) throw new MfcError('corrupt', '인스턴스 변환이 수가 아닙니다', at);
    const name = s.cstr();
    const guid = st.schema('CComponentInstance') >= 5 ? ifcGuid(s.bytes(16)) : undefined;
    this.defs[def]!.kinds.add(kind);
    const inst: SkpInstance = { definition: def, matrix: matrixFrom13(rows), flags: elementFlags(d.flags), kind };
    if (d.material >= 0) inst.material = d.material;
    if (d.layer >= 0) inst.layer = d.layer;
    if (name) inst.name = name;
    if (pre.pid !== undefined) inst.pid = pre.pid;
    if (guid && kind !== 'image') inst.guid = guid;
    if (pre.attrs) inst.attrs = pre.attrs;
    const c = st.top;
    c.instances.push(inst);
    return pack(c.cid, c.instances.length - 1);
  }

  // ── 형상 ──────────────────────────────────────────────────────

  private vertex(): number {
    const s = this.s;
    this.st.preamble();
    const at = s.pos;
    const p = s.vec3();
    if (!(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))) throw new MfcError('corrupt', '정점 위치가 수가 아닙니다', at);
    const c = this.st.top;
    c.pos.push(p[0], p[1], p[2]);
    return pack(c.cid, c.pos.length / 3 - 1);
  }

  /** CEdge: 그리기 요소, 시작·끝 CVertex, CCurve/CArcCurve. 칸 값을 먼저 정한다(곡선이 되가리킬 수 있다) */
  private edge(slot: number): number {
    const s = this.s;
    const st = this.st;
    const c = st.top;
    const index = c.edges.length;
    const e: SkpEdge = { a: -1, b: -1, flags: 0 };
    c.edges.push(e);
    c.edgeCurve.push(-1);
    const packed = pack(c.cid, index);
    s.values[slot] = packed;
    const pre = st.preamble();
    const d = st.drawing();
    const a = st.local(s.readObject(C.VERTEX), '모서리 정점');
    const b = st.local(s.readObject(C.VERTEX), '모서리 정점');
    const curve = s.readObject(C.CURVE);
    e.a = a;
    e.b = b;
    e.flags = (d.flags[0] ? FLAG_HIDDEN : 0) | (d.flags[3] ? FLAG_SOFT : 0) | (d.flags[4] ? FLAG_SMOOTH : 0);
    if (d.layer >= 0) e.layer = d.layer;
    if (d.material >= 0) e.material = d.material;
    if (pre.pid !== undefined) e.pid = pre.pid;
    if (pre.attrs) e.attrs = pre.attrs;
    if (typeof curve === 'number' && curve >= 0 && cidOf(curve) === c.cid) c.edgeCurve[index] = indexOf(curve);
    return packed;
  }

  /** CCurve: u8 다각형, u32 모서리 수. CArcCurve는 f64×14(중심, 법선, x축(길이 = 반지름), 시작각, 끝각, y축)가 더 있다 */
  private curve(slot: number, arc: boolean): number {
    const s = this.s;
    const st = this.st;
    const c = st.top;
    const index = c.curves.length;
    const packed = pack(c.cid, index);
    s.values[slot] = packed;
    const pre = st.preamble();
    const raw: CurveRaw = { polygon: s.u8() !== 0 };
    s.u32();
    if (arc) {
      const v = s.doubles(14);
      if (v.every(Number.isFinite))
        raw.arc = { center: [v[0]!, v[1]!, v[2]!], normal: [v[3]!, v[4]!, v[5]!], xaxis: [v[6]!, v[7]!, v[8]!], start: v[9]!, end: v[10]! };
    }
    if (pre.pid !== undefined) raw.pid = pre.pid;
    c.curves.push(raw);
    return packed;
  }

  /** CEdgeUse: 앞머리, CEdge, u8 뒤집힘, 든 CLoop(지금 읽는 고리여야 한다) */
  private edgeUse(): boolean {
    const s = this.s;
    const st = this.st;
    st.preamble();
    const edge = st.local(s.readObject(C.EDGE), '고리 모서리');
    const rev = s.u8();
    const owner = s.readObject(C.LOOP);
    const loop = this.loop;
    if (!loop || owner !== loop) throw new MfcError('corrupt', '고리 밖에서 모서리 사용을 만났습니다', s.pos);
    loop.edges.push(edge);
    loop.rev.push(rev ? 1 : 0);
    return true;
  }

  /** CLoop: 앞머리, u8 바깥 고리, u8, CEdgeUse … 없음까지 */
  private loopRecord(slot: number): LoopRec {
    const s = this.s;
    const rec: LoopRec = { edges: [], rev: [], outer: false, used: false };
    const outer = this.loop;
    this.loop = rec;
    s.values[slot] = rec;
    this.st.preamble();
    rec.outer = s.u8() !== 0;
    s.u8();
    while (s.readObject(C.EDGE_USE) !== null);
    this.loop = outer;
    return rec;
  }

  /** CFace: 그리기 요소(앞면 재질), 평면 f64×4, 고리 수 × CLoop, 뒷면 CMaterial. 맞지 않는 면은 건너뛴다(-1) */
  private face(): number {
    const s = this.s;
    const st = this.st;
    const c = st.top;
    const pre = st.preamble();
    const d = st.drawing();
    const plane = s.doubles(4);
    const n = s.count(1_000_000, '고리');
    const loops: LoopRec[] = [];
    let bad = '';
    for (let i = 0; i < n; i++) {
      const l = s.readObject(C.LOOP) as LoopRec | null;
      // 고리는 이 면이 처음 쓰는 새 CLoop여야 한다
      if (!l || l.used) bad = '고리가 맞지 않는 면을 건너뛰었습니다';
      else {
        l.used = true;
        loops.push(l);
      }
    }
    const back = s.readObject(C.MATERIAL);
    if (!bad && !loops.length) bad = '고리가 없는 면을 건너뛰었습니다';
    if (!bad && loops.some((l) => l.edges.length < 3)) bad = '모서리가 셋보다 적은 고리를 가진 면을 건너뛰었습니다';
    if (!bad && !plane.slice(0, 3).every(Number.isFinite)) bad = '평면이 수가 아닌 면을 건너뛰었습니다';
    // 바깥 고리를 앞으로(나머지는 구멍)
    if (!bad && !loops[0]!.outer) loops.sort((x, y) => (x.outer === y.outer ? 0 : x.outer ? -1 : 1));
    const vloops: number[][] = [];
    if (!bad)
      for (const l of loops) {
        const vs: number[] = [];
        for (let k = 0; k < l.edges.length; k++) {
          const e = c.edges[l.edges[k]!];
          const v = e ? (l.rev[k] ? e.b : e.a) : -1;
          if (v < 0) {
            bad = '정점을 찾지 못한 면을 건너뛰었습니다';
            break;
          }
          vs.push(v);
        }
        vloops.push(vs);
      }
    if (bad) {
      st.note(bad);
      return -1;
    }
    const f: SkpFace = { loops: vloops, normal: [plane[0]!, plane[1]!, plane[2]!], flags: d.flags[0] ? FLAG_HIDDEN : 0, loopEdges: loops.map((l) => l.edges) };
    if (d.material >= 0) f.front = d.material;
    if (typeof back === 'number' && back >= 0) f.back = back;
    if (d.layer >= 0) f.layer = d.layer;
    if (pre.pid !== undefined) f.pid = pre.pid;
    if (pre.attrs) f.attrs = pre.attrs;
    // 무늬 위치(CFaceTextureCoords): 그쪽 재질이 무늬 재질이고 깃발 비트 0(위치 정함)이 있을 때만(2021+ 읽기와 같게 —
    // 무늬를 지운 재질의 면에도 남아 있다). 쪽마다 f64 12개 중 앞 9개가 2021+와 같은 열 우선 3×3 행렬이다(엔진 legacy 해석기)
    const t = pre.texture;
    if (t) {
      const map = (v: readonly number[], flags: number, mat: number | undefined): SkpTextureMap | undefined => {
        if (!(flags & 1) || mat === undefined || !this.materials[mat]?.info.texture) return undefined;
        const m = v.slice(0, 9);
        return m.length === 9 && m.every(Number.isFinite) ? { kind: 0, matrix: Float64Array.from(m) } : undefined;
      };
      const fm = map(t.front, t.frontFlags, f.front);
      const bm = map(t.back, t.backFlags, f.back);
      if (fm) f.frontMap = fm;
      if (bm) f.backMap = bm;
    }
    c.faces.push(f);
    return pack(c.cid, c.faces.length - 1);
  }
}

/** 정의 동작 덩어리: 붙기 27, 구멍 뚫기 28, 붙는 면 29, 카메라 보기·해 그림자 33(비트 0·1), 늘이지 않음 34(+1: 2017+) */
function behavior(block: Uint8Array, shift: number): SkpBehavior {
  const glue = block[27 + shift]!;
  const snap = block[29 + shift]!;
  const cam = block[33 + shift]!;
  return {
    alwaysFaceCamera: (cam & 1) !== 0,
    cutsOpening: block[28 + shift] !== 0,
    shadowsFaceSun: (cam & 2) !== 0,
    snapTo: glue ? (SNAP_TO[snap] ?? 'any') : 'none',
    noScaleMask: block[34 + shift]!,
  };
}

// ── 맞추기(모형 전체를 읽은 뒤) ───────────────────────────────────────

/**
 * 곡선 모서리 잇기(엔진 _chain_edges): 열린 곡선은 자유 끝에서(호는 시작각 점에 가까운 끝), 닫힌 호는 시작각 정점에서
 * 법선 둘레 반시계 방향으로. 한 정점에 모서리가 셋 이상 모이거나 다 잇지 못하면 읽은 차례 그대로.
 */
export function chainCurveEdges(members: number[], edges: SkpEdge[], pos: ArrayLike<number>, curve: CurveRaw): number[] {
  if (members.length < 2) return members;
  const ends = new Map<number, number[]>();
  for (const e of members) {
    const ed = edges[e]!;
    for (const v of [ed.a, ed.b]) {
      const l = ends.get(v);
      if (l) l.push(e);
      else ends.set(v, [e]);
    }
  }
  for (const l of ends.values()) if (l.length > 2) return members;
  const P = (v: number): [number, number, number] => [pos[3 * v]!, pos[3 * v + 1]!, pos[3 * v + 2]!];
  const arc = curve.arc;
  let startPoint: [number, number, number] | undefined;
  if (arc) {
    const y = [arc.normal[1] * arc.xaxis[2] - arc.normal[2] * arc.xaxis[1], arc.normal[2] * arc.xaxis[0] - arc.normal[0] * arc.xaxis[2], arc.normal[0] * arc.xaxis[1] - arc.normal[1] * arc.xaxis[0]];
    const cs = Math.cos(arc.start);
    const sn = Math.sin(arc.start);
    startPoint = [arc.center[0] + cs * arc.xaxis[0] + sn * y[0]!, arc.center[1] + cs * arc.xaxis[1] + sn * y[1]!, arc.center[2] + cs * arc.xaxis[2] + sn * y[2]!];
  }
  const d2 = (v: number): number => {
    const p = P(v);
    return (p[0] - startPoint![0]) ** 2 + (p[1] - startPoint![1]) ** 2 + (p[2] - startPoint![2]) ** 2;
  };
  const nearest = (vs: Iterable<number>): number => {
    let best = -1;
    let bd = Infinity;
    for (const v of vs) {
      const dd = d2(v);
      if (best < 0 || dd < bd) {
        best = v;
        bd = dd;
      }
    }
    return best;
  };
  const free: number[] = [];
  for (const [v, l] of ends) if (l.length === 1) free.push(v);
  let startVertex: number;
  let startEdge: number;
  if (free.length) {
    startVertex = free[0]!;
    if (startPoint) startVertex = nearest(free);
    else if (free.length === 2 && ends.get(free[1]!)!.includes(members[0]!) && !ends.get(free[0]!)!.includes(members[0]!)) startVertex = free[1]!;
    startEdge = ends.get(startVertex)![0]!;
  } else {
    startEdge = members[0]!;
    startVertex = edges[startEdge]!.a;
    if (startPoint && arc) {
      startVertex = nearest(ends.keys());
      const c = arc.center;
      const o = P(startVertex);
      const origin = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
      const turn = (e: number): number => {
        const ed = edges[e]!;
        const q = P(ed.a === startVertex ? ed.b : ed.a);
        const w = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
        const x = origin[1]! * w[2]! - origin[2]! * w[1]!;
        const y = origin[2]! * w[0]! - origin[0]! * w[2]!;
        const z = origin[0]! * w[1]! - origin[1]! * w[0]!;
        return x * arc.normal[0] + y * arc.normal[1] + z * arc.normal[2];
      };
      let best = -Infinity;
      for (const e of ends.get(startVertex)!) {
        const t = turn(e);
        if (t > best) {
          best = t;
          startEdge = e;
        }
      }
    }
  }
  const ordered: number[] = [];
  const seen = new Set<number>();
  let edge = startEdge;
  let vertex = startVertex;
  while (!seen.has(edge)) {
    ordered.push(edge);
    seen.add(edge);
    const ed = edges[edge]!;
    vertex = ed.a === vertex ? ed.b : ed.a;
    const next = (ends.get(vertex) ?? []).find((x) => !seen.has(x));
    if (next === undefined) break;
    edge = next;
  }
  return ordered.length === members.length ? ordered : members;
}

/** 읽다 끊긴 모서리(정점이 없는 것)를 빼고 차례를 다시 매긴다 */
function compactEdges(c: Collection): void {
  if (c.edges.every((e) => e.a >= 0 && e.b >= 0)) return;
  const map = new Int32Array(c.edges.length).fill(-1);
  const edges: SkpEdge[] = [];
  const curves: number[] = [];
  c.edges.forEach((e, i) => {
    if (e.a < 0 || e.b < 0) return;
    map[i] = edges.length;
    edges.push(e);
    curves.push(c.edgeCurve[i]!);
  });
  c.edges = edges;
  c.edgeCurve = curves;
  for (const f of c.faces) if (f.loopEdges) f.loopEdges = f.loopEdges.map((l) => l.map((e) => map[e]!));
}

function buildCurves(c: Collection): SkpCurve[] {
  const members = c.curves.map((): number[] => []);
  c.edgeCurve.forEach((k, e) => {
    if (k >= 0 && members[k]) members[k]!.push(e);
  });
  return c.curves.map((raw, i) => {
    const list = chainCurveEdges(members[i]!, c.edges, c.pos, raw);
    for (const e of list) c.edges[e]!.curve = i;
    let kind: SkpCurve['kind'] = 'curve';
    if (raw.polygon) kind = 'polygon';
    else if (raw.arc) {
      const a = c.edges[list[0]!];
      const z = c.edges[list[list.length - 1]!];
      const closed = list.length >= 3 && !!a && !!z && (a.a === z.a || a.a === z.b || a.b === z.a || a.b === z.b);
      kind = closed ? 'circle' : 'arc';
    }
    const out: SkpCurve = { edges: list, kind };
    if (raw.pid !== undefined) out.pid = raw.pid;
    if (raw.arc) {
      out.center = raw.arc.center;
      out.normal = raw.arc.normal;
      out.xaxis = raw.arc.xaxis;
      out.radius = Math.hypot(...raw.arc.xaxis);
      out.startAngle = raw.arc.start;
      out.endAngle = raw.arc.end;
    }
    return out;
  });
}

function assemble(dec: Decoder, head: ReturnType<Decoder['readModelHead']>): { model: SkpModel; materials: Map<string, SkpMaterialInfo> } {
  const st = dec.st;
  const view = dec.view;
  // 태그: 기본 태그(Layer0·Untagged)를 맨 앞으로, 나머지는 읽은 차례
  if (!dec.layers.length) dec.layers.push({ name: 'Layer0', hidden: false, color: UNSET_LAYER_COLOR });
  const defaultRaw = Math.max(
    0,
    dec.layers.findIndex((l) => DEFAULT_LAYER_NAMES.has(l.name)),
  );
  const order = [defaultRaw, ...dec.layers.map((_, i) => i).filter((i) => i !== defaultRaw)];
  const final = new Int32Array(dec.layers.length);
  order.forEach((raw, i) => (final[raw] = i));
  const L = (raw: number | undefined): number | undefined => (raw === undefined || raw < 0 || raw >= final.length ? undefined : final[raw]);
  const relayer = (o: { layer?: number }): void => {
    const l = L(o.layer);
    if (l === undefined) delete o.layer;
    else o.layer = l;
  };

  // 2018 전 파일은 단면 이름을 적지 않는다 — SketchUp이 열 때 붙이는 번호를 똑같이 붙인다
  if (st.schema('CSectionPlane') < 3) {
    let n = 0;
    for (const c of st.collections)
      for (const sp of c.sections) {
        n++;
        sp.name = `Section ${n}`;
        sp.symbol = String(n);
      }
  }

  const translucent = dec.materials.map((m) => m.translucent);
  const sevenOrOlder = dec.header.major <= 7;
  const counts = { vertices: 0, edges: 0, faces: 0, instances: 0 };
  const built: SkpEntities[] = st.collections.map((c) => {
    compactEdges(c);
    const curves = buildCurves(c);
    for (const e of c.edges) relayer(e);
    for (const f of c.faces) {
      relayer(f);
      // SketchUp 7 파일: 재질 없는 면 쪽은 다른 쪽의 반투명 재질을 보인다(SketchUp이 열 때 그렇게 한다)
      if (sevenOrOlder) {
        if (f.back === undefined && f.front !== undefined && translucent[f.front]) f.back = f.front;
        else if (f.front === undefined && f.back !== undefined && translucent[f.back]) f.front = f.back;
      }
    }
    for (const i of c.instances) relayer(i);
    for (const t of c.texts) relayer(t);
    for (const d of c.dimensions) relayer(d);
    for (const g of c.guides) relayer(g);
    for (const sp of c.sections) relayer(sp);
    counts.vertices += c.pos.length / 3;
    counts.edges += c.edges.length;
    counts.faces += c.faces.length;
    counts.instances += c.instances.length;
    const ents: SkpEntities = { points: Float64Array.from(c.pos), faces: c.faces, edges: c.edges, instances: c.instances };
    if (curves.length) ents.curves = curves;
    if (c.texts.length) ents.texts = c.texts;
    if (c.dimensions.length) ents.dimensions = c.dimensions;
    if (c.guides.length) ents.guides = c.guides;
    if (c.sections.length) ents.sections = c.sections;
    if (c.attrs) ents.attrs = c.attrs;
    return ents;
  });

  // 정의: 그림이 놓은 정의는 그림(동작 없음), 그룹만 쓰는 정의는 그룹, 그 밖은 컴포넌트
  const definitions = new Map<number, SkpDefinition>();
  dec.defs.forEach((d, i) => {
    const kind = d.kinds.has('image') ? 'image' : d.kinds.has('group') && !d.kinds.has('component') ? 'group' : 'component';
    const def: SkpDefinition = { id: i, name: d.name || `정의 ${i + 1}`, entities: built[d.coll.cid]!, kind };
    if (d.guid && kind !== 'image') def.guid = d.guid;
    if (d.description) def.description = d.description;
    if (d.behavior && kind !== 'image') def.behavior = d.behavior;
    definitions.set(i, def);
  });
  for (const ents of built)
    for (const inst of ents.instances)
      if (definitions.get(inst.definition)?.kind === 'image') {
        inst.kind = 'image';
        delete inst.guid;
      }

  // 재질과 태그 색(태그 색은 보이지 않는 열쇠로 재질 모음에 넣는다)
  const materials = new Map<string, SkpMaterialInfo>();
  const matNames = new Map<number, string>();
  dec.materials.forEach((m, i) => {
    matNames.set(i, m.key);
    materials.set(m.key, m.info);
  });
  const tags: SkpTag[] = [];
  const layers = new Map<number, string>();
  order.forEach((raw, i) => {
    const l = dec.layers[raw]!;
    const colorKey = `\u0000tag-color:${i}`;
    materials.set(colorKey, { name: l.name, color: [l.color[0] / 255, l.color[1] / 255, l.color[2] / 255, 1], textured: false });
    const t: SkpTag = { id: i, name: l.name, visible: !l.hidden, colorMaterial: colorKey, sceneHidden: false };
    if (l.lineStyle) t.lineStyle = l.lineStyle;
    if (l.folder !== undefined && l.folder >= 0) t.folder = l.folder;
    if (l.attrs) t.attrs = l.attrs;
    tags.push(t);
    layers.set(i, l.name);
  });

  const root = built[0] ?? { points: new Float64Array(0), faces: [], edges: [], instances: [] };
  const model: SkpModel = { materials: matNames, layers, defaultLayer: 0, definitions, root, counts, warnings: [], tags };
  if (dec.folders.length) model.tagFolders = dec.folders;
  const active = L(dec.activeLayer);
  if (active !== undefined) model.activeLayer = active;
  if (st.fonts.size) model.fonts = st.fonts;
  if (dec.damaged) model.damaged = true;

  // 설정: 2019 전 파일은 넓이·부피 단위가 없다 — SketchUp처럼 길이 단위와 소수 둘째 자리로
  const units = head.options.get('UnitsOptions');
  if (units) {
    const lu = units.get('LengthUnit');
    const derived = typeof lu === 'number' && lu >= 0 && lu <= 5 ? lu : 0;
    if (!units.has('AreaUnit')) units.set('AreaUnit', derived);
    if (!units.has('VolumeUnit')) units.set('VolumeUnit', derived);
    if (!units.has('AreaPrecision')) units.set('AreaPrecision', 2);
    if (!units.has('VolumePrecision')) units.set('VolumePrecision', 2);
  }
  const lu = lengthUnitCode(head.options);
  if (lu !== undefined) model.lengthUnit = lu;
  const um = unitsFromOptions(head.options);
  if (um) model.units = um;
  const animation = animationFromOptions(head.options);
  if (animation) model.animation = animation;
  if (head.camera) model.camera = head.camera;
  if (head.properties) {
    model.properties = head.properties;
    const name = head.properties['ModelProperties']?.['Name'];
    if (typeof name === 'string' && name) model.name = name;
  }
  if (head.description) model.description = head.description;
  const rendering = view.rendering(head.block, view.modelStyle);
  if (rendering) {
    const shown = view.activeStyle?.name ?? view.modelStyle?.name;
    if (shown !== undefined) rendering.activeName = shown;
    model.rendering = rendering;
  }
  if (view.defaults) model.annotationDefaults = view.defaults;
  if (view.shadow) model.shadowInfo = view.shadow;
  if (view.axesValue) model.axes = view.axesValue;
  if (view.pages.length) {
    model.pages = finishPages(dec, view.pages, final, animation);
    if (view.activePage !== undefined) model.activePage = view.activePage;
  }
  model.warnings = [...st.warn].map(([m, k]) => (k > 1 ? `${m} (${k}개)` : m));
  return { model, materials };
}

/**
 * 장면 마무리: 숨긴 태그를 최종 태그 차례로, 활성 단면·숨긴 개체를 영구 번호로.
 * 영구 번호가 없는 파일(2016 이하)의 대상에는 음수 임시 번호를 붙인다(저장된 번호와 겹치지 않는다) — 장면 적용이 같은 번호로 찾는다.
 * 전환·지연 시간이 없으면 모형 기본값(Model Info > Animation).
 */
function finishPages(dec: Decoder, raws: MfcPage[], final: Int32Array, animation: SkpModel['animation']): SkpPage[] {
  const st = dec.st;
  let next = -1;
  const idOf = (o: { pid?: number }): number => {
    if (o.pid === undefined) o.pid = next--;
    return o.pid;
  };
  let unresolved = 0;
  const pages = raws.map((r) => {
    const p = r.page;
    p.hiddenTags = [...new Set(r.layers.map((l) => (l >= 0 && l < final.length ? final[l]! : -1)).filter((l) => l >= 0))].sort((a, b) => a - b);
    const sections: number[] = [];
    for (const v of r.sections) {
      const sp = st.collections[cidOf(v)]?.sections[indexOf(v)];
      if (sp) sections.push(idOf(sp));
    }
    p.sectionIds = sections;
    const hidden = new Set<number>();
    unresolved += r.unresolved;
    for (const h of r.hidden) {
      const c = st.collections[cidOf(h.packed)];
      const i = indexOf(h.packed);
      let target: { pid?: number } | undefined;
      if (c && HIDDEN_CLASSES.has(h.cls))
        switch (h.cls) {
          case 'CFace':
            target = c.faces[i];
            break;
          case 'CEdge':
            target = c.edges[i];
            break;
          case 'CComponentInstance':
          case 'CGroup':
          case 'CImage':
            target = c.instances[i];
            break;
          case 'CText':
            target = c.texts[i];
            break;
          case 'CDimensionLinear':
          case 'CDimensionRadial':
            target = c.dimensions[i];
            break;
          case 'CConstructionLine':
          case 'CConstructionPoint':
            target = c.guides[i];
            break;
          case 'CSectionPlane':
            target = c.sections[i];
            break;
        }
      if (target) hidden.add(idOf(target));
      else unresolved++;
    }
    p.hiddenIds = [...hidden];
    if (p.transition === undefined && animation?.transitionTime !== undefined) p.transition = animation.transitionTime;
    if (p.delay === undefined && animation?.sceneDelay !== undefined) p.delay = animation.sceneDelay;
    return p;
  });
  if (unresolved) st.note(`장면이 숨긴 개체 ${unresolved}개를 찾지 못했습니다`);
  return pages;
}

/** 멈춘 까닭 → 사람이 읽는 글 */
function why(e: unknown): string {
  if (e instanceof MfcError) return `${e.message}(${e.offset.toLocaleString('en-US')}바이트 자리)`;
  if (e instanceof RangeError) return '객체가 너무 깊게 겹쳤습니다';
  return e instanceof Error ? e.message : String(e);
}

/** 형상을 읽다 멈춘 것이 파일 손상인지(모르는 기록은 손상이 아니다 — 그래도 앞부분만 그린다) */
const isDamage = (e: unknown): boolean => !(e instanceof MfcError) || e.kind === 'truncated' || e.kind === 'corrupt';

/**
 * 2020 이하 SKP 바이트 → 중간 모형. 머리가 MFC 꼴이어야 한다(readSkpHeader의 container = 'mfc').
 * SketchUp 3~6이나 모르는 스키마는 MfcRefused, 형상 앞에서 멈추면 그 까닭의 Error를 던진다.
 * onProgress는 읽은 바이트 위치로 진행(0~1)을 알린다.
 */
export function readMfcModel(bytes: Uint8Array, header: SkpHeader, onProgress?: (fraction: number) => void): MfcResult {
  const dec = new Decoder(bytes, header);
  const s = dec.s;
  let k = 0;
  let last = 0;
  if (onProgress)
    s.onObject = () => {
      if (++k % 4096) return;
      const f = s.pos / Math.max(1, bytes.length);
      if (f <= last) return;
      last = f;
      try {
        onProgress(f);
      } catch {
        /* 알림 쪽 오류는 무시 */
      }
    };
  let head: ReturnType<Decoder['readModelHead']>;
  try {
    dec.readHead();
    head = dec.readModelHead();
  } catch (e) {
    if (e instanceof MfcRefused) throw e;
    throw new Error(`형상 앞에서 읽기를 멈췄습니다: ${why(e)}`, { cause: e });
  }
  let geometry = false;
  try {
    dec.readRoot();
    geometry = true;
  } catch (e) {
    if (isDamage(e)) dec.damaged = true;
    dec.st.note(`형상을 읽다 멈췄습니다 — 그 앞까지만 그립니다: ${why(e)}`);
  }
  if (geometry)
    try {
      dec.view.readTail();
    } catch (e) {
      // 뿌리 요소 뒤는 보기 자료(위치·장면·스타일)뿐이다 — 형상은 다 읽었다
      dec.view.pages.length = 0;
      dec.view.activePage = undefined;
      if (e instanceof MfcError && e.kind === 'truncated') dec.damaged = true;
      dec.st.note(`형상 뒤의 장면·스타일을 읽지 못했습니다(형상은 다 읽었습니다): ${why(e)}`);
    }
  const { model, materials } = assemble(dec, head);
  return { model, materials, styles: dec.view.styles, images: dec.st.images };
}

// ── 그림(readSkpImages가 다시 풀지 않게, 장면을 만들 때 모은 자리를 잠깐 둔다) ─────────────

const imageCache = new WeakMap<Uint8Array, MfcImageRef[]>();
/** readSkpImages가 그림 자리를 얻으려고 읽은 모형(바로 이어 부르는 skpToScene이 다시 읽지 않게 한 번만 쓴다) */
const resultCache = new WeakMap<Uint8Array, MfcResult>();

/** skpToScene이 읽으며 모은 그림 자리를 둔다(같은 바이트로 readSkpImages를 부르면 다시 풀지 않는다) */
export function rememberMfcImages(bytes: Uint8Array, refs: MfcImageRef[]): void {
  imageCache.set(bytes, refs);
}

/** readSkpImages가 먼저 읽어 둔 모형(있으면 꺼내고 버린다) — 무늬를 입히려고 그림을 먼저 꺼내는 순서(워커)에서 두 번 읽지 않는다 */
export function takeMfcResult(bytes: Uint8Array): MfcResult | undefined {
  const r = resultCache.get(bytes);
  if (r) resultCache.delete(bytes);
  return r;
}

/**
 * 그림 자리: 둔 것이 있으면 그것(한 번 쓰고 버린다), 없으면 파일을 읽는다(그 모형은 skpToScene이 쓰게 둔다).
 * 형상 앞에서 멈추는 파일은 빈 목록. onProgress는 읽은 바이트 위치(0~1)
 */
export function mfcImageRefs(bytes: Uint8Array, header: SkpHeader, onProgress?: (fraction: number) => void): MfcImageRef[] {
  const known = imageCache.get(bytes);
  if (known) {
    imageCache.delete(bytes);
    return known;
  }
  try {
    const res = readMfcModel(bytes, header, onProgress);
    resultCache.set(bytes, res);
    return res.images;
  } catch {
    return [];
  }
}
