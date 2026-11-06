/**
 * SketchUp 2020 이하(머리 뒤 MFC CArchive 객체 직렬화) → 중간 모형(SkpModel, 2021+ 해석기와 같은 꼴).
 * SketchUp 3(CSketchUpModel 스키마 10 + CRenderingOptions 22)·4·5(12 + 25·28)·6(18)·7·8·2013~2020(21~29)을 읽고, 그보다 옛 판이나 모르는 스키마는
 * 분명한 까닭과 함께 거절한다(MfcRefused).
 * 형식 지식은 MFC 직렬화 규칙(Microsoft TN002)과, 사용자가 허락한 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의
 * legacy 부분과 문서에서 옮긴 것이다(docs/formats/skp.md). 코드는 opencad-skp 꼴로 새로 썼다.
 *
 * 차례(클래스마다 스키마는 파일의 CVersionMap이 알린다):
 *   CString "SketchUp Model", CString "{판}", 16바이트 GUID, CString 경로, u32 시각
 *   CVersionMap(클래스 이름 → 스키마, "End-Of-Version-Map"까지)
 *   CSketchUpModel 본문: 12바이트(3~5는 8), (스키마 26+) u64 다음 영구 번호, 미리보기 CDib, 14/15바이트(4~6은 10, 3은 7 — 설정 묶음부터 두 번째 CDib까지 없음), 설명, 설정 묶음,
 *     CAttributeContainer(ModelProperties 등), CDib, CCamera(3은 줄 안), 렌더링 덩어리, 뿌리 앞머리(모형 속성),
 *     CComponent 본문(재질·태그·(2020) 태그 폴더·정의·요소) + 꼬리(관계 0개, 활성 단면), 모형 꼬리(mfcview.ts)
 *   CComponentDefinition: CComponent 본문 + 꼬리, GUID, 이름, 설명, 경로, 시각, 동작 42/43바이트, CThumbnail
 *
 * 기록에 길이가 없어 하나라도 못 읽으면 그 뒤를 읽을 수 없다. 형상을 읽다 멈추면 그때까지 읽은 형상을 살려 damaged로 돌려주고,
 * 형상 뒤(장면·스타일)에서 멈추면 형상은 그대로 두고 경고한다.
 */

import { edgesFrom, emptyEdges, emptyFaces, facesFrom } from './entities';
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
import { MendBuffer, textRoundTrip, type TextRoundTrip } from './mfcmend';
import { MfcError, MfcStream } from './mfcstream';
import { HIDDEN_CLASSES, MfcView, RENDERING_BLOCK, type MfcPage } from './mfcview';
import { animationFromOptions, ifcGuid, lengthUnitCode, unitsFromOptions, type SkpOptions } from './vffcommon';

/** 읽는 CSketchUpModel 스키마: SketchUp 7(21) ~ 2020(29) */
const MIN_MODEL_SCHEMA = 21;
const MAX_MODEL_SCHEMA = 29;
/** SketchUp 6(CSketchUpModel 18): 머리에 설정 묶음·모형 속성이 없고 설정 묶음은 뿌리 요소 뒤에 온다 */
const SU6_MODEL_SCHEMA = 18;
/**
 * SketchUp 5(CSketchUpModel 12 + CRenderingOptions 28): 6의 꼴에 더해 모형 머리가 4바이트 짧고, 카메라·렌더링 덩어리·글꼴·문자 기본값이 짧으며
 * 스타일이 없다. SketchUp 4도 모형 스키마가 12라 렌더링 스키마(4는 25)로 가른다
 */
const SU5_MODEL_SCHEMA = 12;
const SU5_RENDERING_SCHEMA = 28;
/** SketchUp 4(CSketchUpModel 12 + CRenderingOptions 25): 5의 꼴에 더해 잠김(그리기 요소 깃발·잠긴 색)·인스턴스 이름이 없고 렌더링 덩어리가 짧다 */
const SU4_RENDERING_SCHEMA = 25;
/**
 * SketchUp 3(CSketchUpModel 10 + CRenderingOptions 22): 4의 꼴에 더해 앞머리(CEntity 2)가 비었고(속성 클래스가 없다), 카메라는 객체가 아니라 줄 안에
 * 눈·보는 방향·위로 쓰며, 모형 머리·렌더링 덩어리·컴포넌트 본문 앞·태그·곡선·정의·장면·모형 꼬리가 짧다
 */
const SU3_MODEL_SCHEMA = 10;
const SU3_RENDERING_SCHEMA = 22;
/** 칸(클래스·객체) 수 한도 — 브라우저 메모리 보호 */
export const MFC_MAX_RECORDS = 60_000_000;
const MAX_DEFINITIONS = 1_000_000;
/** 정의 안에 정의를 바로 쓴 겹 한도(자기를 품는 깨진 파일·스택 보호) */
const MAX_NESTING = 64;
const DEFAULT_LAYER_NAMES = new Set(['Layer0', 'Untagged']);
/** 색을 정하지 않은 태그(SketchUp은 회색으로 보인다) */
const UNSET_LAYER_COLOR: [number, number, number] = [64, 64, 64];
const SNAP_TO = ['any', 'horizontal', 'vertical', 'sloped'] as const;

/** SketchUp 3보다 옛 판이나 모르는 스키마처럼 읽지 않는 파일 */
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
  /** 고쳐 읽기: CR로 되돌린 참조나 확신할 수 없는 구간의 모서리 사용이 있다(그 면은 끝에 면 평면으로 확인) */
  mended?: boolean;
  /** 고쳐 읽기: 모서리 사용 차례 → 참조 꼬리표의 LF를 CR로 되돌리면 가리킬 다른 모서리들 */
  alts?: Map<number, number[]>;
}

interface DibRef {
  kind: number;
  start: number;
  end: number;
}

const isDib = (v: unknown): v is DibRef => !!v && typeof v === 'object' && 'kind' in v && 'start' in v;

/** 그림 길(참조 해석기와 같게 경로의 마지막 이름) */
const baseName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? '';

/** 속성 사전에 넣기(__proto__ 같은 이름도 제 칸으로) */
function put<T>(o: Record<string, T>, k: string, v: T): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** 글 왕복 손상 고쳐 읽기(mfcmend.ts)의 상태 */
interface Mend {
  buf: MendBuffer;
  sig: TextRoundTrip;
  /** 시험 읽는 중(안쪽 목록은 고쳐 읽지 않고 던진다) */
  inTrial: boolean;
  /** 메운 곳 수, 시험 수, 시험으로 다시 읽은 바이트 */
  mended: number;
  trials: number;
  trialBytes: number;
  /** 시험 바이트 한도(파일 크기의 몇 배 — 아주 큰 정의를 거듭 다시 읽지 않게) */
  trialBudget: number;
  /** 넣을 자리·낱자가 여럿 맞아 바이트를 확신할 수 없는 구간(사본 자리) — 그 안의 정점·면·고리는 끝에 면 평면으로 확인한다 */
  span: [number, number] | null;
  /** 그 구간을 만든 굳힌 넣기 자리와, 벌점이 같았던 넣기들(굳히기 전 자리) */
  kept: number;
  ties: { q: number; unit: number }[];
  /** 확인할 정점(묶은 번호)과 같은 벌점의 넣기마다 읽혔을 좌표(첫째가 굳힌 것) — 되돌리기는 길이로 */
  verts: { v: number; alts: number[][] }[];
  faces: SkpFace[];
  edges: SkpEdge[];
  /** 끝 정점 참조의 LF를 CR로 되돌리면 다른 정점이 되는 모서리(시작·끝 정점 후보, 묶음 번호) */
  vertAlts: [SkpEdge, number[], number[], number][];
  /** 면마다 고리의 모서리 사용 뒤집힘(끝에 모서리 끝을 바꿔 면 정점을 다시 만들 때) */
  revs: Map<SkpFace, number[][]>;
  /** 시험 읽기가 더한 정의 종류(되돌리기) */
  kinds: [DefRec, 'component' | 'group' | 'image'][];
}

/** 고쳐 읽기에서 목록 항목 하나를 다시 읽을 자리(그때까지 쌓인 것의 길이) */
interface Mark {
  index: number;
  pos: number;
  slots: number;
  badRefs: number;
  firstBadRef: number;
  crFixed: number;
  crLog: number;
  suspect: number;
  notes: number;
  colls: number;
  stack: number;
  defs: number;
  mats: number;
  layers: number;
  images: number;
  fonts: number;
  top: Collection | undefined;
  lens: number[];
  side: number;
  loop: LoopRec | null;
  verts: number;
  faces: number;
  edges: number;
  vertAlts: number;
  kinds: number;
}

/** 고쳐 읽기: 멈춘 자리에서 거꾸로 볼 바이트, 멈춘 자리 뒤 볼 바이트(참조 꼬리표 7FFF 뒤 u32 안), 시험으로 더 읽을 항목 수, 나아갔다고 볼 바이트 */
const MEND_BACK = 96;
const MEND_AHEAD = 6;
const MEND_LOOKAHEAD = 4;
const MEND_GAIN = 64;
/** 시험으로 다시 읽을 바이트 한도 = 파일 크기 × 이 값 */
const MEND_BUDGET = 64;
/** 메워 볼 낱자: U+2028, U+2029(지워진 줄·문단 나눔), U+000D(CRLF의 CR — 짝수 자리 LF 앞에만) */
const MEND_UNITS = [0x2028, 0x2029] as const;
/** 이미 고쳐 보다 못한 멈춤(바깥 목록이 같은 자리를 다시 시험하지 않게) */
const unmendable = new WeakSet<object>();

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
  /** SketchUp 3: 요소 묶음마다 요소 목록의 모서리 차례(reorderEdges) */
  private readonly edgeOrders = new Map<Collection, number[]>();
  activeLayer: number | undefined;
  damaged = false;
  /** 글 왕복 손상 고쳐 읽기(두 번째 읽기에서만) */
  readonly mend: Mend | null;

  constructor(bytes: Uint8Array, header: SkpHeader, mend: { buf: MendBuffer; sig: TextRoundTrip } | null = null) {
    this.header = header;
    this.mend = mend
      ? {
          buf: mend.buf,
          sig: mend.sig,
          inTrial: false,
          mended: 0,
          trials: 0,
          trialBytes: 0,
          trialBudget: MEND_BUDGET * bytes.length,
          span: null,
          kept: -1,
          ties: [],
          verts: [],
          faces: [],
          edges: [],
          vertAlts: [],
          revs: new Map(),
          kinds: [],
        }
      : null;
    this.s = new MfcStream(mend ? mend.buf.view() : bytes, header.bodyOffset, MFC_MAX_RECORDS);
    this.st = new MfcState(this.s);
    if (mend) {
      this.s.crFix = true;
      this.st.notes = [];
    }
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
    const su45 = model === SU5_MODEL_SCHEMA && (rendering === SU5_RENDERING_SCHEMA || rendering === SU4_RENDERING_SCHEMA);
    const su3 = model === SU3_MODEL_SCHEMA && rendering === SU3_RENDERING_SCHEMA;
    const known = (model >= MIN_MODEL_SCHEMA && model <= MAX_MODEL_SCHEMA) || model === SU6_MODEL_SCHEMA || su45 || su3;
    if (!known || !(rendering in RENDERING_BLOCK)) {
      // SketchUp 3(모형 10)보다 옛 판 — 표본이 없어 배치를 모른다
      const old = model >= 0 && model < SU3_MODEL_SCHEMA;
      throw new MfcRefused(
        old
          ? `SketchUp ${this.header.version} 파일은 SketchUp 3보다 옛 형식(모형 스키마 ${model})이라 아직 읽지 못합니다. SketchUp 3 이상(가능하면 2021 이상)에서 다시 저장한 뒤 열어 주세요.`
          : `SketchUp ${this.header.version} 파일의 형식(모형 스키마 ${model}, 렌더링 스키마 ${rendering})은 확인한 SketchUp 3~2020 형식과 달라 읽지 못합니다.`,
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
    this.st.entityAttrs = (map.get('CEntity') ?? 3) >= 3;
    this.st.drawingFlagBytes = (map.get('CDrawingElement') ?? 9) >= 9 ? 6 : 5;
    return true;
  }

  // ── 모형 본문 ───────────────────────────────────────────────────

  /** 모형 본문 앞부분(형상 앞): 설명·설정·모형 속성·카메라·렌더링 덩어리 */
  readModelHead(): { description: string; options: SkpOptions; properties?: SkpAttrDicts; camera?: SkpCamera; block: Uint8Array } {
    const s = this.s;
    const st = this.st;
    const schema = st.schema('CSketchUpModel');
    // SketchUp 5(모형 스키마 12)는 미리보기 앞이 8바이트(6 이상은 12)
    s.skip(schema >= SU6_MODEL_SCHEMA ? 12 : 8);
    if (schema >= 26) s.skip(8); // 다음 영구 번호
    const thumb = s.readObject(C.DIB);
    if (isDib(thumb)) this.image('model', '모형 미리보기', thumb);
    // SketchUp 3(모형 스키마 10)은 7바이트
    s.skip(schema >= 26 ? 15 : schema >= MIN_MODEL_SCHEMA ? 14 : schema >= SU5_MODEL_SCHEMA ? 10 : 7);
    const description = s.cstr();
    if (schema < MIN_MODEL_SCHEMA) {
      // SketchUp 3은 CCamera 클래스가 없고 카메라를 줄 안에 쓴다
      const camera = this.st.schemas.has('CCamera') ? (s.readObject(C.CAMERA) as SkpCamera | null) : this.view.inlineCamera();
      const block = this.view.renderingBlock(false);
      const out: ReturnType<Decoder['readModelHead']> = { description, options: new Map(), block };
      if (camera) out.camera = camera;
      return out;
    }
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
  options(): SkpOptions {
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
    // 앞 12바이트에 그리기 요소 깃발이 든다(SketchUp 4는 깃발이 5바이트라 11, SketchUp 3은 9 — 재질 목록 뒤 u32도 2바이트)
    const su3 = !st.entityAttrs;
    s.skip(su3 ? 9 : (st.entityPids ? 13 : 12) - (6 - st.drawingFlagBytes));
    const mats = s.count(1_000_000, '재질');
    for (let i = 0; i < mats; i++) s.readObject(C.MATERIAL);
    s.skip(su3 ? 2 : 4);
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
    if (this.mend) this.items(defs, () => s.readObject(C.DEFINITION));
    else for (let i = 0; i < defs; i++) s.readObject(C.DEFINITION);
    const entsAt = s.pos;
    const ents = s.count(50_000_000, '요소');
    // SketchUp 3(CCurve 3)은 곡선의 끝 모서리를 곡선 안에서 먼저 읽는다 — 요소 목록의 모서리 차례를 적어 두고 다 읽은 뒤 그 차례로 되돌린다(C API와 같은 차례)
    const c = st.top;
    const order: number[] | null = (st.schemas.get('CCurve') ?? 4) < 4 ? [] : null;
    const one = (): void => {
      const v = s.readObject();
      if (order && s.lastClass === 'CEdge' && typeof v === 'number' && cidOf(v) === c.cid) order.push(indexOf(v));
    };
    if (this.mend) {
      this.items(ents, one, order ?? undefined);
      this.moreItems(entsAt, ents, one, order ?? undefined);
    } else for (let i = 0; i < ents; i++) one();
    if (order) this.edgeOrders.set(c, order);
  }

  /**
   * 고쳐 읽기: 요소 수(u32)에 걸친 짝수 자리 LF가 CR이었다면 글 왕복이 수를 줄였다(실제 파일 하나에서 0D8E → 0A8E).
   * 요소 목록 뒤에 꼬리(관계 수 0)가 바로 오지 않으면 LF를 CR로 되돌린 수까지 더 읽어 본다 — 시험으로(고치지 않고) 더 읽어
   * 꼬리가 오거나 몇 항목 넘게 읽히면, 되돌려서 고쳐 가며 다시 읽고 수 바이트를 CR로 고친다
   */
  private moreItems(countAt: number, n: number, one: () => void, side?: number[]): void {
    const s = this.s;
    const m = this.mend!;
    const tailAhead = (): boolean => s.pos + 4 <= s.end && s.dv.getUint32(s.pos, true) === 0;
    if (tailAhead()) return;
    for (const alt of crAlternatives(s.b, countAt, 4)) {
      const more = s.dv.getUint32(countAt, true) === n ? alt.value - n : -1;
      if (more <= 0 || more > 50_000_000) continue;
      const k = this.mark(n, side);
      const outer = m.inTrial;
      m.inTrial = true;
      let ok = false;
      let read = 0;
      try {
        for (; read < more; read++) one();
        ok = tailAhead();
      } catch {
        ok = read >= Math.min(8, more);
      } finally {
        m.inTrial = outer;
        this.rollback(k, side);
      }
      if (!ok) continue;
      for (const p of alt.patch) {
        s.b[p] = 0x0d;
        s.crLog.push(p);
      }
      s.crFixed++;
      this.items(more, one, side);
      return;
    }
  }

  // ── 글 왕복 손상 고쳐 읽기(mfcmend.ts) ──────────────────────────────────

  /**
   * 고쳐 읽기의 목록 읽기: 항목마다 되돌릴 자리를 두고, 항목을 읽다 멈추면(mendItems) 멈춘 자리 둘레 짝수 자리에 지워진 낱자를 넣어 보아
   * 그 항목과 뒤 몇 항목이 가장 깨끗하게 읽히는 것을 굳힌 뒤 거기서부터 다시 읽는다. 고치지 못하면 예전처럼 던진다
   */
  private items(n: number, one: () => void, side?: number[]): void {
    let prev: Mark | null = null;
    for (let i = 0; i < n; ) {
      const cur = this.mark(i, side);
      try {
        one();
        prev = cur;
        i++;
      } catch (e) {
        const base = this.mendItems(e, prev, cur, n, one, side);
        if (!base) {
          if (e && typeof e === 'object') unmendable.add(e);
          throw e;
        }
        i = base.index;
        prev = null;
      }
    }
  }

  private mark(index: number, side?: number[]): Mark {
    const s = this.s;
    const st = this.st;
    const m = this.mend!;
    const top = st.stack[st.stack.length - 1];
    return {
      index,
      pos: s.pos,
      slots: s.values.length,
      badRefs: s.badRefs,
      firstBadRef: s.firstBadRef,
      crFixed: s.crFixed,
      crLog: s.crLog.length,
      suspect: s.suspect,
      notes: st.notes!.length,
      colls: st.collections.length,
      stack: st.stack.length,
      defs: this.defs.length,
      mats: this.materials.length,
      layers: this.layers.length,
      images: st.images.length,
      fonts: st.fonts.size,
      top,
      lens: top
        ? [top.pos.length, top.edges.length, top.edgeCurve.length, top.faces.length, top.curves.length, top.instances.length, top.texts.length, top.dimensions.length, top.guides.length, top.sections.length]
        : [],
      side: side?.length ?? 0,
      loop: this.loop,
      verts: m.verts.length,
      faces: m.faces.length,
      edges: m.edges.length,
      vertAlts: m.vertAlts.length,
      kinds: m.kinds.length,
    };
  }

  /** 목록 항목 하나를 읽기 전으로 되돌린다(시험 읽기가 고친 CR 바이트도 되돌린다) */
  private rollback(k: Mark, side?: number[]): void {
    const s = this.s;
    const st = this.st;
    const m = this.mend!;
    for (let j = s.crLog.length - 1; j >= k.crLog; j--) s.b[s.crLog[j]!] = 0x0a;
    s.crLog.length = k.crLog;
    s.pos = k.pos;
    s.names.length = k.slots;
    s.values.length = k.slots;
    s.badRefs = k.badRefs;
    s.firstBadRef = k.firstBadRef;
    s.crFixed = k.crFixed;
    s.suspect = k.suspect;
    s.lastClass = '';
    st.undoNotes(k.notes);
    for (let j = st.collections.length - 1; j >= k.colls; j--) this.edgeOrders.delete(st.collections[j]!);
    st.collections.length = k.colls;
    st.stack.length = k.stack;
    if (k.top) st.stack[k.stack - 1] = k.top;
    this.defs.length = k.defs;
    for (const r of this.materials.splice(k.mats)) this.materialKeys.delete(r.key);
    if (this.layers.length > k.layers) {
      this.layers.length = k.layers;
      for (const [name, i] of this.layerByName) if (i >= k.layers) this.layerByName.delete(name);
    }
    st.images.length = k.images;
    if (st.fonts.size > k.fonts) for (const slot of [...st.fonts.keys()]) if (slot >= k.slots) st.fonts.delete(slot);
    const t = k.top;
    if (t) {
      const l = k.lens;
      t.pos.length = l[0]!;
      t.edges.length = l[1]!;
      t.edgeCurve.length = l[2]!;
      t.faces.length = l[3]!;
      t.curves.length = l[4]!;
      t.instances.length = l[5]!;
      t.texts.length = l[6]!;
      t.dimensions.length = l[7]!;
      t.guides.length = l[8]!;
      t.sections.length = l[9]!;
    }
    if (side) side.length = k.side;
    this.loop = k.loop;
    m.verts.length = k.verts;
    m.faces.length = k.faces;
    m.edges.length = k.edges;
    m.vertAlts.length = k.vertAlts;
    for (const [d, kind] of m.kinds.splice(k.kinds)) d.kinds.delete(kind);
  }

  /**
   * 목록 항목을 읽다 멈춘 자리(e.offset = F)에서: 앞 항목 시작(없으면 이 항목 시작)과 F − MEND_BACK 가운데 뒤쪽부터 F + MEND_AHEAD까지의
   * 짝수 자리 q마다 U+2028·U+2029(그 자리 낱자가 LF면 CR도)를 넣고, 되돌린 자리부터 이 항목과 뒤 MEND_LOOKAHEAD 항목을 다시 읽어 본다.
   * 끝까지(또는 F + MEND_GAIN 너머까지) 읽힌 것 가운데 벌점(맞지 않는 참조·경고·그럴듯하지 않은 값·이어지지 않는 고리)이 가장 적은 것을 굳힌다.
   * 벌점이 같은 것이 여럿이면 가장 앞 자리를 굳히고, 그 자리들이 걸친 구간을 확신할 수 없는 구간(span)으로 둔다(끝에 면 평면으로 확인).
   * 굳힌 뒤 다시 읽을 자리를 돌려준다(고치지 못하면 null)
   */
  private mendItems(e: unknown, prev: Mark | null, cur: Mark, n: number, one: () => void, side?: number[]): Mark | null {
    const m = this.mend!;
    const s = this.s;
    const st = this.st;
    if (!(e instanceof MfcError) || e.kind === 'too_large' || m.inTrial || unmendable.has(e)) return null;
    if (!m.buf.roomLeft || m.trialBytes > m.trialBudget) return null;
    const F = e.offset;
    const first = prev ?? cur;
    let lo = Math.max(first.pos, F - MEND_BACK);
    lo += lo & 1;
    let hi = Math.min(F + MEND_AHEAD, s.end - 2);
    hi -= hi & 1;
    const stop = Math.min(n, cur.index + 1 + MEND_LOOKAHEAD);
    interface Try {
      q: number;
      unit: number;
      score: number;
      reach: number;
    }
    const tried: Try[] = [];
    m.inTrial = true;
    try {
      for (let q = hi; q >= lo; q -= 2) {
        const base = q >= cur.pos ? cur : prev;
        if (!base) continue;
        const units: number[] = [...MEND_UNITS];
        if (m.buf.byteAt(q) === 0x0a && m.buf.byteAt(q + 1) === 0) units.push(0x000d);
        for (const unit of units) {
          this.rollback(base, side);
          m.buf.put(q, unit);
          s.useBuffer(m.buf.view());
          m.trials++;
          let reach = Infinity;
          try {
            for (let j = base.index; j < stop; j++) one();
          } catch (e2) {
            reach = e2 instanceof MfcError ? e2.offset : -1;
          }
          m.trialBytes += Math.max(0, (Number.isFinite(reach) ? reach : s.pos) - base.pos);
          if (reach <= F + MEND_GAIN) continue;
          const score = s.badRefs - base.badRefs + (s.suspect - base.suspect) + (st.notes!.length - base.notes);
          tried.push({ q, unit, score, reach });
        }
        if (m.trialBytes > m.trialBudget) break;
      }
    } finally {
      m.inTrial = false;
      this.rollback(first, side);
      m.buf.drop();
      s.useBuffer(m.buf.view());
    }
    if (!tried.length) return null;
    // 벌점이 적고, 끝까지 읽혔고(또는 더 멀리), 앞 자리인 것
    let best = tried[0]!;
    for (const t of tried) {
      if (t.score < best.score || (t.score === best.score && (t.reach > best.reach || (t.reach === best.reach && t.q < best.q)))) best = t;
    }
    const ties = tried.filter((t) => t.score === best.score && t.reach === best.reach);
    // 시험이 앞 항목을 여러 바이트로 다시 읽었으므로 앞 항목(없으면 이 항목)부터 다시 읽는다(finally가 그 자리로 되돌려 두었다)
    m.buf.put(best.q, best.unit);
    m.buf.keep();
    s.useBuffer(m.buf.view());
    m.mended++;
    if (ties.length > 1) {
      let a = best.q;
      let b = best.q + 2;
      for (const t of ties) {
        a = Math.min(a, t.q);
        b = Math.max(b, t.q + 4);
      }
      m.span = [a, b];
      m.kept = best.q;
      m.ties = [best, ...ties.filter((t) => t !== best)].map((t) => ({ q: t.q, unit: t.unit }));
    } else m.span = null;
    return first;
  }

  /**
   * 확신할 수 없는 구간에 걸친 정점 좌표(지금 사본 자리 at부터 24바이트)를 벌점이 같았던 넣기마다 다시 풀어 본다(첫째가 굳힌 것).
   * 좌표가 굳힌 넣기 자리보다 앞에서 시작할 때만(그 뒤면 굳힌 것 하나)
   */
  private altPositions(at: number, chosen: number[]): number[][] {
    const m = this.mend!;
    const b = this.s.b;
    const k = m.kept;
    const out = [chosen];
    if (!(at < k)) return out;
    const tmp = new Uint8Array(24);
    const dv = new DataView(tmp.buffer);
    // 굳히기 전 바이트(자리 i) = 지금 사본에서 굳힌 2바이트를 뺀 것
    const before = (i: number): number => b[i < k ? i : i + 2]!;
    for (const t of m.ties.slice(1)) {
      if (t.q < at) continue;
      for (let i = 0; i < 24; i++) {
        const j = at + i;
        tmp[i] = j < t.q ? before(j) : j === t.q ? t.unit & 0xff : j === t.q + 1 ? t.unit >> 8 : before(j - 2);
      }
      const p = [dv.getFloat64(0, true), dv.getFloat64(8, true), dv.getFloat64(16, true)];
      if (p.every(plausible)) out.push(p);
    }
    return out;
  }

  /** 고쳐 읽기에서 확신할 수 없는 구간에 걸친 바이트인지 */
  private inSpan(from: number, to: number): boolean {
    const sp = this.mend?.span;
    return !!sp && from < sp[1] && to > sp[0];
  }

  /**
   * SketchUp 3: 요소 묶음마다 모서리를 요소 목록 차례로 다시 매긴다(곡선 안에서 먼저 읽은 끝 모서리를 제자리로).
   * 면의 고리 모서리와 장면이 숨긴 모서리 참조도 함께 옮긴다. 목록에 없는 모서리는 읽은 차례로 뒤에 둔다
   */
  reorderEdges(): void {
    const maps = new Map<number, Int32Array>();
    for (const [c, order] of this.edgeOrders) {
      const n = c.edges.length;
      const seen = new Uint8Array(n);
      const perm: number[] = [];
      for (const i of order)
        if (i < n && !seen[i]) {
          seen[i] = 1;
          perm.push(i);
        }
      for (let i = 0; i < n; i++) if (!seen[i]) perm.push(i);
      if (perm.every((v, i) => v === i)) continue;
      const map = new Int32Array(n);
      perm.forEach((old, i) => (map[old] = i));
      c.edges = perm.map((i) => c.edges[i]!);
      c.edgeCurve = perm.map((i) => c.edgeCurve[i]!);
      for (const f of c.faces) if (f.loopEdges) f.loopEdges = f.loopEdges.map((l) => l.map((e) => (e >= 0 && e < n ? map[e]! : e)));
      maps.set(c.cid, map);
    }
    if (!maps.size) return;
    for (const p of this.view.pages)
      for (const h of p.hidden) {
        const map = h.cls === 'CEdge' ? maps.get(cidOf(h.packed)) : undefined;
        const i = indexOf(h.packed);
        if (map && i < map.length) h.packed = pack(cidOf(h.packed), map[i]!);
      }
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

  /**
   * CDib: u32 꼴(0 날 DIB, 1 JPEG + 뒤 u32 품질, 4 부호화한 그림 파일), u32 길이, 바이트.
   * CDib 2(SketchUp 5)는 JPEG 뒤 품질이 없다(무늬 안에 줄로 쓴 그림에서 확인)
   */
  private dib(): DibRef {
    const s = this.s;
    const at = s.pos;
    const kind = s.u32();
    const size = s.u32();
    const start = s.pos;
    s.skip(size);
    if (kind === 1) {
      if ((this.st.schemas.get('CDib') ?? 3) >= 3) s.u32();
    } else if (kind !== 0 && kind !== 4) throw new MfcError('unsupported', `아직 읽지 못하는 그림 꼴 ${kind}`, at);
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
    // SketchUp 6(CAttributeNamed 0)은 끝 u32가 없다
    if ((this.st.schemas.get('CAttributeNamed') ?? 1) >= 1) s.u32();
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

  /** CThumbnail: 앞머리, CCamera, CDib. SketchUp 3(CThumbnail 0, CCamera 클래스 없음)은 카메라를 줄 안에 쓴다 */
  private thumbnail(): DibRef | null {
    const s = this.s;
    this.st.preamble();
    if (this.st.schemas.has('CCamera')) s.readObject(C.CAMERA);
    else this.view.inlineCamera();
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
      let d: unknown = null;
      if ((this.st.schemas.get('CTexture') ?? 6) < 5) {
        // CTexture 4(SketchUp 5): 앞머리가 없고 그림은 객체가 아니라 u8(있음) 뒤 줄 안 CDib
        if (s.u8()) d = this.dib();
      } else {
        this.st.preamble();
        d = s.readObject(C.DIB);
      }
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
    // CLayer 1(SketchUp 3)은 색 재질 칸 뒤 4바이트가 없다
    if (st.schema('CLayer') >= 2) s.skip(4);
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
    // 동작 덩어리: CComponentBehavior 5(SketchUp 7+) 42바이트, 4(SketchUp 4~6) 38바이트(늘이지 않음 마스크가 없다),
    // 3(SketchUp 3) 35바이트(붙기·구멍·붙는 면이 2 앞 — 카메라 보기·해 그림자 칸은 표준 파일이 모두 꺼져 있어 자리를 몰라 읽지 않는다)
    const bv = st.schemas.get('CComponentBehavior') ?? 5;
    const old = bv < 5;
    const su3 = bv < 4;
    const block = s.bytes((su3 ? 35 : old ? 38 : 42) + (st.entityPids ? 1 : 0));
    rec.behavior = behavior(block, (st.entityPids ? 1 : 0) - (su3 ? 2 : 0), old, su3);
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
    // CComponentInstance 3(SketchUp 4)은 이름이 없다
    const name = (st.schemas.get('CComponentInstance') ?? 4) >= 4 ? s.cstr() : '';
    const guid = st.schema('CComponentInstance') >= 5 ? ifcGuid(s.bytes(16)) : undefined;
    const m = this.mend;
    if (m) {
      if (!rows.every(plausible)) s.suspect++;
      if (!this.defs[def]!.kinds.has(kind)) m.kinds.push([this.defs[def]!, kind]);
    }
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
    const packed = pack(c.cid, c.pos.length / 3 - 1);
    const m = this.mend;
    if (m) {
      // 어긋나게 읽은 좌표는 지수 바이트가 뒤섞여 아주 크거나 아주 작다
      if (!p.every(plausible)) s.suspect++;
      if (this.inSpan(at, at + 24)) m.verts.push({ v: packed, alts: this.altPositions(at, p) });
    }
    return packed;
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
    // 정점 참조 하나가 깨진 모서리는 버리고(a·b = -1 — 그 모서리를 쓰는 면도 건너뜀) 이어 읽는다
    const m = this.mend;
    const refAt = s.pos;
    const cr = s.crFixed;
    const a = st.localOrNone(s.readObject(C.VERTEX, true), '모서리 정점');
    const bAt = s.pos;
    const b = st.localOrNone(s.readObject(C.VERTEX, true), '모서리 정점');
    if (m) {
      // 고쳐 읽기: CR로 되돌린 참조나 확신할 수 없는 구간의 참조를 쓴 모서리는 끝에 면 평면으로 확인한다
      if (s.crFixed !== cr || this.inSpan(refAt, s.pos)) m.edges.push(e);
      // 맞는 참조여도 LF를 CR로 되돌리면 다른 정점을 가리키는 끝 — 면이 평평하지 않을 때 끝에 바꿔 본다
      const altA = a >= 0 ? this.crRefAlternatives(refAt, 'CVertex', a) : [];
      const altB = b >= 0 ? this.crRefAlternatives(bAt, 'CVertex', b) : [];
      if (altA.length || altB.length) m.vertAlts.push([e, altA, altB, c.cid]);
    }
    const curve = s.readObject(C.CURVE, true);
    e.a = a < 0 || b < 0 ? -1 : a;
    e.b = a < 0 || b < 0 ? -1 : b;
    e.flags = (d.flags[0] ? FLAG_HIDDEN : 0) | (d.flags[3] ? FLAG_SOFT : 0) | (d.flags[4] ? FLAG_SMOOTH : 0);
    if (d.layer >= 0) e.layer = d.layer;
    if (d.material >= 0) e.material = d.material;
    if (pre.pid !== undefined) e.pid = pre.pid;
    if (pre.attrs) e.attrs = pre.attrs;
    if (typeof curve === 'number' && curve >= 0 && cidOf(curve) === c.cid) c.edgeCurve[index] = indexOf(curve);
    return packed;
  }

  /**
   * CCurve: u8 다각형, u32 모서리 수. CArcCurve는 f64×14(중심, 법선, x축(길이 = 반지름), 시작각, 끝각, y축)가 더 있다.
   * CCurve 3(SketchUp 3)은 앞에 첫 모서리·끝 모서리 포인터가 있다 — 첫 모서리는 곡선을 처음 가리킨(읽는 중인) 모서리이고, 끝 모서리는 대개 여기서 새 객체로 나온다
   */
  private curve(slot: number, arc: boolean): number {
    const s = this.s;
    const st = this.st;
    const c = st.top;
    const index = c.curves.length;
    const packed = pack(c.cid, index);
    s.values[slot] = packed;
    const pre = st.preamble();
    const raw: CurveRaw = { polygon: false };
    const su3 = (st.schemas.get('CCurve') ?? 4) < 4;
    if (su3) {
      // 끝 모서리를 읽는 동안 다른 곡선이 같은 차례를 받지 않게 먼저 자리를 잡는다
      c.curves.push(raw);
      s.readObject(C.EDGE, true);
      s.readObject(C.EDGE, true);
    }
    raw.polygon = s.u8() !== 0;
    s.u32();
    if (arc) {
      const v = s.doubles(14);
      if (v.every(Number.isFinite))
        raw.arc = { center: [v[0]!, v[1]!, v[2]!], normal: [v[3]!, v[4]!, v[5]!], xaxis: [v[6]!, v[7]!, v[8]!], start: v[9]!, end: v[10]! };
    }
    if (pre.pid !== undefined) raw.pid = pre.pid;
    if (!su3) c.curves.push(raw);
    return packed;
  }

  /** CEdgeUse: 앞머리, CEdge, u8 뒤집힘, 든 CLoop(지금 읽는 고리여야 한다) */
  private edgeUse(): boolean {
    const s = this.s;
    const st = this.st;
    st.preamble();
    // 모서리 참조가 깨지면 -1(면을 만들 때 그 면을 건너뛴다)
    const refAt = s.pos;
    const cr = s.crFixed;
    const edge = st.localOrNone(s.readObject(C.EDGE, true), '고리 모서리');
    const rev = s.u8();
    const owner = s.readObject(C.LOOP);
    const loop = this.loop;
    if (!loop || owner !== loop) throw new MfcError('corrupt', '고리 밖에서 모서리 사용을 만났습니다', s.pos);
    loop.edges.push(edge);
    loop.rev.push(rev ? 1 : 0);
    if (this.mend) {
      if (rev > 1) s.suspect++;
      if (s.crFixed !== cr || this.inSpan(refAt, s.pos)) loop.mended = true;
      // 맞는 참조여도 글 왕복이 CR을 LF로 바꿔 다른 모서리를 가리키게 됐을 수 있다 — CR로 되돌린 모서리를 적어 두고
      // 고리가 이어지지 않을 때 face()에서 바꿔 본다
      const alts = this.crEdgeAlternatives(refAt, edge);
      if (alts.length) (loop.alts ??= new Map()).set(loop.edges.length - 1, alts);
    }
    return true;
  }

  /**
   * 고쳐 읽기: 고리에서 앞뒤 모서리 사용과 이어지지 않는(또는 모르는) 모서리 사용을, 참조의 LF를 CR로 되돌린 모서리로 바꿔
   * 앞뒤가 모두 이어지면 그것으로 둔다(글 왕복이 맞는 참조를 다른 모서리로 바꾼 곳)
   */
  private mendChain(l: LoopRec, edges: readonly SkpEdge[]): void {
    const n = l.edges.length;
    const known = (i: number): SkpEdge | undefined => {
      const e = edges[l.edges[(i + n) % n]!];
      return e && e.a >= 0 ? e : undefined;
    };
    /** i번째와 그다음이 이어지는지(둘 중 모르는 것이 있으면 i가 바꿔 볼 자리면 false, 아니면 true) */
    const joins = (i: number, at: number): boolean => {
      const e = known(i);
      const f = known(i + 1);
      if (!e || !f) return i !== at && (i + 1) % n !== at;
      return (l.rev[(i + n) % n] ? e.a : e.b) === (l.rev[(i + 1) % n] ? f.b : f.a);
    };
    for (const [k, alts] of l.alts!) {
      if (joins(k - 1, k) && joins(k, k)) continue;
      const orig = l.edges[k]!;
      let fixed = false;
      for (const a of alts) {
        l.edges[k] = a;
        if (joins(k - 1, k) && joins(k, k)) {
          fixed = true;
          break;
        }
      }
      if (fixed) {
        l.mended = true;
        this.s.crFixed++;
      } else l.edges[k] = orig;
    }
  }

  /** 고쳐 읽기: 자리 at의 모서리 참조 꼬리표에서 짝수 자리 LF를 CR로 되돌린, 같은 길이·같은 묶음의 다른 모서리들(묶음 안 차례) */
  private crEdgeAlternatives(at: number, now: number): number[] {
    return this.crRefAlternatives(at, 'CEdge', now);
  }

  /**
   * 고쳐 읽기: 자리 at의 참조 꼬리표(새 객체가 아닌 것)에서 짝수 자리 LF를 CR로 되돌리면 가리킬, 같은 묶음의 cls 객체들(묶음 안 차례, now는 뺌)
   */
  private crRefAlternatives(at: number, cls: string, now: number): number[] {
    const s = this.s;
    const b = s.b;
    const tag = b[at]! | (b[at + 1]! << 8);
    if (tag === 0 || (tag >= 0x8000 && tag !== 0x7fff) || tag === 0xffff) return [];
    const big = tag === 0x7fff;
    if (big && (b[at + 5]! & 0x80) !== 0) return [];
    const out: number[] = [];
    for (const alt of crAlternatives(b, big ? at + 2 : at, big ? 4 : 2)) {
      const slot = alt.value;
      if (big ? slot >= 0x80000000 : slot >= 0x7fff) continue;
      if (slot <= 0 || slot >= s.names.length || s.names[slot] !== cls) continue;
      const v = s.values[slot];
      if (typeof v !== 'number' || cidOf(v) !== this.st.top.cid || indexOf(v) === now) continue;
      out.push(indexOf(v));
    }
    return out;
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
    const planeAt = s.pos;
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
    if (this.mend) for (const l of loops) if (l.alts) this.mendChain(l, c.edges);
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
    const m = this.mend;
    if (m) {
      // 고쳐 읽기 시험의 벌점: 단위가 아닌 법선, 이어지지 않는 고리
      if (!(Math.abs(Math.hypot(plane[0]!, plane[1]!, plane[2]!) - 1) < 1e-6)) s.suspect++;
      for (const l of loops) s.suspect += chainBreaks(l, c.edges);
    }
    if (bad) {
      st.note(bad);
      return -1;
    }
    const f: SkpFace = { loops: vloops, normal: [plane[0]!, plane[1]!, plane[2]!], flags: d.flags[0] ? FLAG_HIDDEN : 0, loopEdges: loops.map((l) => l.edges) };
    // 법선(평면 앞 세 값)이나 고리의 모서리 사용을 확신할 수 없으면 끝에 면 평면으로 확인한다(d는 쓰지 않는다)
    if (m) {
      if (this.inSpan(planeAt, planeAt + 24) || loops.some((l) => l.mended)) m.faces.push(f);
      m.revs.set(
        f,
        loops.map((l) => l.rev),
      );
    }
    if (d.material >= 0) f.front = d.material;
    if (typeof back === 'number' && back >= 0) f.back = back;
    if (d.layer >= 0) f.layer = d.layer;
    if (pre.pid !== undefined) f.pid = pre.pid;
    if (pre.attrs) f.attrs = pre.attrs;
    // 무늬 위치(CFaceTextureCoords): 그쪽 재질이 무늬 재질이고 깃발 비트 0(위치 정함)이 있을 때만(2021+ 읽기와 같게 —
    // 무늬를 지운 재질의 면에도 남아 있다). 쪽마다 f64 12개 중 앞 9개가 2021+와 같은 열 우선 3×3 행렬이다(참조 해석기와 같다)
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

/**
 * 고쳐 읽기: 자리 at부터 len바이트 u32(리틀 엔디언)에 걸친 짝수 자리 LF 낱자(0A 00)를 CR(0D 00)로 되돌린 값들(작은 것부터, 바꿀 바이트 자리와 함께).
 * 낱자의 둘째 바이트(00)는 칸 밖이어도 된다
 */
function crAlternatives(b: Uint8Array, at: number, len: number): { value: number; patch: number[] }[] {
  const units: number[] = [];
  for (let p = at + (at & 1); p < at + len; p += 2) if (b[p] === 0x0a && b[p + 1] === 0) units.push(p);
  const out: { value: number; patch: number[] }[] = [];
  for (let mask = 1; mask < 1 << units.length; mask++) {
    const patch = units.filter((_, i) => mask & (1 << i));
    let value = 0;
    for (let i = len - 1; i >= 0; i--) value = value * 256 + (patch.includes(at + i) ? 0x0d : b[at + i]!);
    out.push({ value, patch });
  }
  return out.sort((x, y) => x.value - y.value);
}

/** 고쳐 읽기: 그럴듯한 좌표·변환 값(0 또는 1e-30 < |v| < 1e9 — 어긋나게 읽은 f64는 지수 바이트가 뒤섞여 이 밖으로 나간다) */
const plausible = (v: number): boolean => v === 0 || (Math.abs(v) > 1e-30 && Math.abs(v) < 1e9);

/** 고리에서 앞 모서리 사용의 끝 정점과 다음 모서리 사용의 시작 정점이 다른 곳 수(모르는 모서리는 빼고) */
function chainBreaks(l: LoopRec, edges: readonly SkpEdge[]): number {
  let k = 0;
  const n = l.edges.length;
  for (let i = 0; i < n; i++) {
    const e = edges[l.edges[i]!];
    const f = edges[l.edges[(i + 1) % n]!];
    if (!e || !f || e.a < 0 || f.a < 0) continue;
    const end = l.rev[i] ? e.a : e.b;
    const start = l.rev[(i + 1) % n] ? f.b : f.a;
    if (end !== start) k++;
  }
  return k;
}

/** 정의 동작 덩어리: 붙기 27, 구멍 뚫기 28, 붙는 면 29, 카메라 보기·해 그림자 33(비트 0·1), 늘이지 않음 34(+1: 2017+, −2: SketchUp 3) */
function behavior(block: Uint8Array, shift: number, noMask = false, noCam = false): SkpBehavior {
  const glue = block[27 + shift]!;
  const snap = block[29 + shift]!;
  const cam = noCam ? 0 : block[33 + shift]!;
  const out: SkpBehavior = {
    alwaysFaceCamera: (cam & 1) !== 0,
    cutsOpening: block[28 + shift] !== 0,
    shadowsFaceSun: (cam & 2) !== 0,
    snapTo: glue ? (SNAP_TO[snap] ?? 'any') : 'none',
  };
  if (!noMask) out.noScaleMask = block[34 + shift]!;
  return out;
}

// ── 맞추기(모형 전체를 읽은 뒤) ───────────────────────────────────────

/**
 * 곡선 모서리 잇기(참조 해석기와 같은 차례): 열린 곡선은 자유 끝에서(호는 시작각 점에 가까운 끝), 닫힌 호는 시작각 정점에서
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

function assemble(
  dec: Decoder,
  head: ReturnType<Decoder['readModelHead']>,
  drop?: ReadonlySet<SkpFace>,
): { model: SkpModel; materials: Map<string, SkpMaterialInfo> } {
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
    // 면·모서리 표는 맨 끝에 만든다(장면 마무리가 숨긴 면·모서리에 임시 영구 번호를 붙인다 — finishPages)
    const ents: SkpEntities = { points: Float64Array.from(c.pos), faces: emptyFaces(), edges: emptyEdges(), instances: c.instances };
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

  const root = built[0] ?? { points: new Float64Array(0), faces: emptyFaces(), edges: emptyEdges(), instances: [] };
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
  // 읽는 동안 쓴 면·모서리 객체를 표로 옮기고 놓는다(큰 모형에서 객체가 heap을 크게 잡는다).
  // 고쳐 읽기에서 면 평면과 맞지 않은 면(drop)은 장면 마무리(숨긴 개체 찾기)가 끝난 여기서 뺀다
  st.collections.forEach((c, i) => {
    const ents = built[i];
    if (!ents) return;
    if (drop?.size) {
      const kept = c.faces.filter((f) => !drop.has(f));
      counts.faces -= c.faces.length - kept.length;
      c.faces = kept;
    }
    ents.faces = facesFrom(c.faces);
    ents.edges = edgesFrom(c.edges);
    c.faces = [];
    c.edges = [];
  });
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

/** 멈춘 까닭 → 사람이 읽는 글(at: 고쳐 읽기 사본 자리 → 원래 파일 자리) */
function why(e: unknown, at: (p: number) => number = (p) => p): string {
  if (e instanceof MfcError) return `${e.message}(${Math.max(0, at(e.offset)).toLocaleString('en-US')}바이트 자리)`;
  if (e instanceof RangeError) return '객체가 너무 깊게 겹쳤습니다';
  return e instanceof Error ? e.message : String(e);
}

/** 형상을 읽다 멈춘 것이 파일 손상인지(모르는 기록은 손상이 아니다 — 그래도 앞부분만 그린다) */
const isDamage = (e: unknown): boolean => !(e instanceof MfcError) || e.kind === 'truncated' || e.kind === 'corrupt';

/**
 * 2020 이하 SKP 바이트 → 중간 모형. 머리가 MFC 꼴이어야 한다(readSkpHeader의 container = 'mfc').
 * SketchUp 3보다 옛 판이나 모르는 스키마는 MfcRefused, 형상 앞에서 멈추면 그 까닭의 Error를 던진다.
 * onProgress는 읽은 바이트 위치로 진행(0~1)을 알린다.
 */
export function readMfcModel(bytes: Uint8Array, header: SkpHeader, onProgress?: (fraction: number) => void): MfcResult {
  let last = 0;
  const progress = onProgress
    ? (s: MfcStream): void => {
        let k = 0;
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
      }
    : undefined;
  let pass = readPass(bytes, header, null, progress);
  // 형상을 읽다 멈췄거나 맞지 않는 참조를 버렸고, 파일이 글 왕복 꼴이면(mfcmend.ts) 빠진 2바이트를 메우고 LF를 CR로 되돌려 가며 한 번 더 읽는다 —
  // 더 멀리 읽었거나(같은 데까지면 버린 참조가 줄었을 때) 그것을 쓴다
  const stop = pass.stop;
  const stopped = stop instanceof MfcError && stop.kind !== 'too_large';
  if (stopped || (stop === null && pass.dec.s.badRefs)) {
    const sig = textRoundTrip(bytes);
    if (sig)
      try {
        const second = readPass(bytes, header, { buf: new MendBuffer(bytes), sig }, progress);
        const m = second.dec.mend!;
        const reach = (p: Pass, at: (o: number) => number): number => (p.stop === null ? Infinity : p.stop instanceof MfcError ? at(p.stop.offset) : -1);
        const r1 = reach(pass, (o) => o);
        const r2 = reach(second, (o) => m.buf.toOriginal(o));
        if ((m.mended || second.dec.s.crFixed) && (r2 > r1 || (r2 === r1 && second.dec.s.badRefs < pass.dec.s.badRefs))) pass = second;
      } catch {
        /* 처음 읽은 것을 쓴다 */
      }
  }
  return finishPass(pass);
}

/** 한 번 읽기(보통 읽기, 또는 고쳐 읽기)의 결과 */
interface Pass {
  dec: Decoder;
  head: ReturnType<Decoder['readModelHead']>;
  /** 형상을 읽다 멈춘 까닭(끝까지 읽었으면 null) */
  stop: unknown;
}

function readPass(bytes: Uint8Array, header: SkpHeader, mend: { buf: MendBuffer; sig: TextRoundTrip } | null, progress: ((s: MfcStream) => void) | undefined): Pass {
  const dec = new Decoder(bytes, header, mend);
  progress?.(dec.s);
  const at = mend ? (p: number): number => mend.buf.toOriginal(p) : undefined;
  let head: ReturnType<Decoder['readModelHead']>;
  try {
    dec.readHead();
    head = dec.readModelHead();
  } catch (e) {
    if (e instanceof MfcRefused) throw e;
    throw new Error(`형상 앞에서 읽기를 멈췄습니다: ${why(e, at)}`, { cause: e });
  }
  let stop: unknown = null;
  try {
    dec.readRoot();
  } catch (e) {
    stop = e;
    if (isDamage(e)) dec.damaged = true;
    dec.st.note(`형상을 읽다 멈췄습니다 — 그 앞까지만 그립니다: ${why(e, at)}`);
  }
  if (stop === null)
    try {
      // SketchUp 6은 설정 묶음(단위·장면 넘기기)을 머리가 아니라 꼬리(축 뒤)에 쓴다
      dec.view.readTail(dec.st.schema('CSketchUpModel') < MIN_MODEL_SCHEMA ? () => (head.options = dec.options()) : undefined);
    } catch (e) {
      // 뿌리 요소 뒤는 보기 자료(위치·장면·스타일)뿐이다 — 형상은 다 읽었다
      dec.view.pages.length = 0;
      dec.view.activePage = undefined;
      if (e instanceof MfcError && e.kind === 'truncated') dec.damaged = true;
      dec.st.note(`형상 뒤의 장면·스타일을 읽지 못했습니다(형상은 다 읽었습니다): ${why(e, at)}`);
    }
  return { dec, head, stop };
}

function finishPass(pass: Pass): MfcResult {
  const { dec, head } = pass;
  const s = dec.s;
  const m = dec.mend;
  let drop: Set<SkpFace> | undefined;
  if (m) {
    dec.damaged = true;
    const v = verifyMended(dec);
    drop = v.drop;
    dec.st.note(
      `글로 한 번 저장되며 깨진 파일을 고쳐 읽었습니다 — 빠진 2바이트 ${m.mended.toLocaleString('en-US')}곳을 메우고 바뀐 참조 ${(s.crFixed + v.repointed).toLocaleString('en-US')}개를 되돌렸습니다(면 평면과 맞지 않아 뺀 면 ${v.drop.size.toLocaleString('en-US')}개, 정점 ${v.lost.toLocaleString('en-US')}개)`,
    );
  }
  if (s.badRefs) {
    // 칸 번호가 깨진 참조(바이트 하나가 바뀐 파일 등): 그 모서리·면만 빼고 끝까지 읽었다
    dec.damaged = true;
    const first = m ? Math.max(0, m.buf.toOriginal(s.firstBadRef)) : s.firstBadRef;
    dec.st.note(
      `깨진 참조 ${s.badRefs.toLocaleString('en-US')}개를 건너뛰었습니다(첫 자리 ${first.toLocaleString('en-US')}바이트) — 그 모서리와 그 모서리를 쓰는 면은 그리지 않습니다`,
    );
  }
  dec.reorderEdges();
  const { model, materials } = assemble(dec, head, drop);
  let images = dec.st.images;
  if (m) {
    // 그림 자리를 원래 파일 자리로(메운 바이트가 든 그림은 버린다)
    images = [];
    for (const r of dec.st.images) {
      const start = m.buf.toOriginal(r.start);
      const end = m.buf.toOriginal(r.end - 1) + 1;
      if (start >= 0 && end - start === r.end - r.start) images.push({ ...r, start, end });
    }
  }
  return { model, materials, styles: dec.view.styles, images };
}

/** 고쳐 읽기 끝 확인의 면 평면 허용 거리(인치 — SketchUp 길이 허용 오차 0.001인치) */
const MEND_PLANE_TOL = 1e-3;
/**
 * 고쳐 읽은 파일에서 고치지 않은 면의 허용 거리(인치). 실제 파일의 작은 곡면 삼각형은 저장된 평면에서 0.0015인치쯤 벗어나기도 해
 * 그보다 넉넉히 둔다(틀린 정점 참조는 보통 0.1인치 넘게 벗어난다)
 */
const MEND_LOOSE_TOL = 1e-2;

/**
 * 고쳐 읽기에서 확신할 수 없는 바이트로 읽은 면·정점·모서리를 면 평면으로 확인한다.
 * 면: 고리의 모든 정점이 그 면 법선 방향으로 MEND_PLANE_TOL 안에 있고(평평함), 바깥 고리가 도는 방향의 법선이 저장된 법선과 같은 쪽이어야 한다.
 * 정점: 그 정점을 쓰는 면이 하나 이상 있고 모두 맞아야 한다(아니면 그 정점을 쓰는 모서리를 버린다).
 * 고치지 않은 면은 저장된 평면에서 MEND_LOOSE_TOL 넘게 벗어날 때만 뺀다. 맞지 않는 면은 drop에 넣어 그리지 않는다
 */
function verifyMended(dec: Decoder): { drop: Set<SkpFace>; lost: number; checked: number; picked: number; repointed: number } {
  const m = dec.mend!;
  const drop = new Set<SkpFace>();
  /** 묶음마다 확인할 정점 → 같은 벌점의 넣기마다 읽혔을 좌표 */
  const verts = new Map<number, Map<number, number[][]>>();
  for (const { v, alts } of m.verts) {
    const map = verts.get(cidOf(v)) ?? new Map<number, number[][]>();
    map.set(indexOf(v), alts);
    verts.set(cidOf(v), map);
  }
  const faces = new Set(m.faces);
  const edges = new Set(m.edges);
  const altsOf = new Map<number, [SkpEdge, number[], number[], number][]>();
  for (const r of m.vertAlts) {
    const list = altsOf.get(r[3]) ?? [];
    list.push(r);
    altsOf.set(r[3], list);
  }
  let checked = 0;
  let lost = 0;
  let picked = 0;
  let repointed = 0;
  for (const c of dec.st.collections) {
    const vs = verts.get(c.cid);
    // 확신할 수 없는 정점: 그 정점을 쓰는 면들이 가장 평평해지는 좌표를 고른다(다른 확신할 수 없는 정점이 고쳐지면 다시 — 몇 바퀴)
    const uses = new Map<number, SkpFace[]>();
    const settled = new Set<number>();
    if (vs) {
      for (const f of c.faces)
        for (const l of f.loops)
          for (const v of l)
            if (vs.has(v)) {
              const list = uses.get(v) ?? [];
              if (!list.includes(f)) list.push(f);
              uses.set(v, list);
            }
      // 후보 좌표 p가 면 f의 평면에서 떨어진 거리: 평면 높이는 f의 믿을 수 있는 정점(확인할 정점이 아니거나 이미 정한 것)에서 잰다(없으면 NaN)
      const off = (f: SkpFace, v: number, p: readonly number[]): number => {
        const [nx, ny, nz] = f.normal;
        const len = Math.hypot(nx, ny, nz) || 1;
        for (const l of f.loops)
          for (const u of l)
            if (u !== v && (!vs.has(u) || settled.has(u)))
              return Math.abs(nx * (p[0]! - c.pos[3 * u]!) + ny * (p[1]! - c.pos[3 * u + 1]!) + nz * (p[2]! - c.pos[3 * u + 2]!)) / len;
        return NaN;
      };
      for (let round = 0; round < 8; round++) {
        let moved = false;
        for (const [v, alts] of vs) {
          if (settled.has(v)) continue;
          const fs = uses.get(v) ?? [];
          // 후보마다 쓰는 면 평면에서 가장 먼 거리(잴 면이 없으면 -1)
          const fits = alts.map((p) => {
            let worst = -1;
            for (const f of fs) {
              const d = off(f, v, p);
              if (!Number.isNaN(d)) worst = Math.max(worst, d);
            }
            return worst;
          });
          let best = -1;
          fits.forEach((w, k) => {
            if (w >= 0 && w <= MEND_PLANE_TOL && (best < 0 || w < fits[best]!)) best = k;
          });
          if (best < 0) continue;
          // 다른 자리의 후보(1e-6인치 넘게 떨어진 것)가 가장 맞는 것의 100배 안으로 맞으면 면들이 정점 자리를 가르지 못한 것 — 믿지 않는다
          // (손상 없는 SketchUp 면은 정점이 평면에서 1e-10인치 안이다)
          const p = alts[best]!;
          const near = Math.max(100 * fits[best]!, 1e-9);
          const far = (q: readonly number[]): boolean => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!) > 1e-6;
          if (alts.some((q, k) => k !== best && fits[k]! >= 0 && fits[k]! <= near && far(q))) continue;
          c.pos[3 * v] = p[0]!;
          c.pos[3 * v + 1] = p[1]!;
          c.pos[3 * v + 2] = p[2]!;
          settled.add(v);
          moved = true;
          if (best > 0) picked++;
        }
        if (!moved) break;
      }
    }
    // 끝 정점 참조의 LF를 CR로 되돌리면 다른 정점이 되는 모서리: 그 모서리를 쓰는 면이 평평하지 않으면 끝을 바꿔 보고,
    // 쓰는 면이 모두 평평해지면 그것으로 둔다(글 왕복이 맞는 정점 참조를 다른 정점으로 바꾼 곳)
    const alts = altsOf.get(c.cid);
    if (alts) {
      const index = new Map<SkpEdge, number>();
      c.edges.forEach((e, i) => index.set(e, i));
      const facesOf = new Map<number, SkpFace[]>();
      for (const f of c.faces)
        for (const l of f.loopEdges ?? [])
          for (const e of l) {
            const list = facesOf.get(e) ?? [];
            if (!list.includes(f)) list.push(f);
            facesOf.set(e, list);
          }
      const rebuild = (f: SkpFace): void => {
        const revs = m.revs.get(f);
        if (!revs || !f.loopEdges) return;
        f.loops = f.loopEdges.map((l, j) => l.map((e, k) => (revs[j]![k] ? (c.edges[e]?.b ?? -1) : (c.edges[e]?.a ?? -1))));
      };
      const worst = (fs: readonly SkpFace[]): number => Math.max(...fs.map((f) => (f.loops.every((l) => l.every((v) => v >= 0)) ? faceFit(f, c.pos) : Infinity)));
      for (const [e, altA, altB] of alts) {
        const fs = facesOf.get(index.get(e)!) ?? [];
        if (!fs.length || worst(fs) <= MEND_PLANE_TOL) continue;
        const a0 = e.a;
        const b0 = e.b;
        let fit = Infinity;
        let pick: [number, number] | null = null;
        for (const a of [a0, ...altA])
          for (const b of [b0, ...altB]) {
            if ((a === a0 && b === b0) || a === b) continue;
            e.a = a;
            e.b = b;
            fs.forEach(rebuild);
            const w = worst(fs);
            if (w < fit) {
              fit = w;
              pick = [a, b];
            }
          }
        if (pick && fit <= MEND_PLANE_TOL) {
          [e.a, e.b] = pick;
          edges.add(e);
          for (const f of fs) faces.add(f);
          repointed++;
        } else {
          e.a = a0;
          e.b = b0;
        }
        fs.forEach(rebuild);
      }
    }
    /** 맞지 않는 면이 쓰는 확인할 정점 */
    const bad = new Set<number>();
    for (const f of c.faces) {
      let touch = faces.has(f);
      if (!touch && vs) touch = f.loops.some((l) => l.some((v) => vs.has(v)));
      if (!touch && edges.size && f.loopEdges) touch = f.loopEdges.some((l) => l.some((e) => e >= 0 && edges.has(c.edges[e]!)));
      if (!touch) {
        // 고치지 않은 면도 글 왕복이 같은 길이로 바꾼 참조(알아볼 수 없는 CR → LF)로 정점이 틀렸을 수 있다 — 저장된 평면에서 크게 벗어난 면은 그리지 않는다
        if (faceFit(f, c.pos, false) > MEND_LOOSE_TOL) drop.add(f);
        continue;
      }
      checked++;
      const ok = faceFit(f, c.pos) <= MEND_PLANE_TOL;
      if (!ok) drop.add(f);
      if (vs && !ok) for (const l of f.loops) for (const v of l) if (vs.has(v)) bad.add(v);
    }
    if (!vs) continue;
    // 정점은 면 평면으로 하나로 정해졌고(settled) 그 정점을 쓰는 면이 모두 맞을 때만 믿는다
    const gone = new Set<number>();
    for (const v of vs.keys()) if (bad.has(v) || !settled.has(v)) gone.add(v);
    lost += gone.size;
    if (!gone.size) continue;
    for (const f of c.faces) if (!drop.has(f) && f.loops.some((l) => l.some((v) => gone.has(v)))) drop.add(f);
    for (const e of c.edges)
      if (gone.has(e.a) || gone.has(e.b)) {
        e.a = -1;
        e.b = -1;
      }
  }
  return { drop, lost, checked, picked, repointed };
}

/**
 * 면이 저장된 평면에 맞는 정도: 정점들의 법선 방향 퍼짐(인치). 바깥 고리 방향(뉴웰 법선)이 저장된 법선과 다른 쪽이거나
 * 넓이가 없으면 Infinity
 */
function faceFit(f: SkpFace, pos: readonly number[], orient = true): number {
  const [nx, ny, nz] = f.normal;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0.5)) return orient ? Infinity : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of f.loops)
    for (const v of l) {
      const x = pos[3 * v];
      const y = pos[3 * v + 1];
      const z = pos[3 * v + 2];
      if (x === undefined || y === undefined || z === undefined) return Infinity;
      const t = (nx * x + ny * y + nz * z) / len;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  if (!orient) return hi - lo;
  if (!(hi - lo <= MEND_PLANE_TOL)) return hi - lo || Infinity;
  const outer = f.loops[0]!;
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i]!;
    const b = outer[(i + 1) % outer.length]!;
    const [x1, y1, z1] = [pos[3 * a]!, pos[3 * a + 1]!, pos[3 * a + 2]!];
    const [x2, y2, z2] = [pos[3 * b]!, pos[3 * b + 1]!, pos[3 * b + 2]!];
    ax += (y1 - y2) * (z1 + z2);
    ay += (z1 - z2) * (x1 + x2);
    az += (x1 - x2) * (y1 + y2);
  }
  const area = Math.hypot(ax, ay, az);
  return area > 0 && (ax * nx + ay * ny + az * nz) / (area * len) > 0.99 ? hi - lo : Infinity;
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
