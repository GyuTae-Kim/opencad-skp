/**
 * 스타일: 꾸러미의 styles/<이름>/style.xml과 model.dat 렌더링 설정(0x733c)을 합쳐 화면용 스타일(SkpStyleMeta)로 푼다.
 * 값 정하기 차례: 렌더링 레코드 → (없거나 "unset"이면) style.xml 항목 → 비움.
 * 꼬리표·항목 번호와 값 읽기 규칙은 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 형식 지식을 옮긴 것이다(docs/formats/skp.md).
 */
import type { Rgb, SkpFaceStyle, SkpStyleMeta } from './meta';
import type { SkpRenderingRaw } from './model';

/** 낱값 항목(워터마크 목록 5001 같은 XML 값은 [^<]*에 걸리지 않아 빠진다) */
const ITEM = /<sty:item id="(\d{1,9})">\s*<t:variant type="\d+"[^>]*>([^<]*)<\/t:variant>/g;

/** style.xml 글 → 항목 번호 → 값 글(앞뒤 공백 없앰). 같은 번호는 뒤 것 */
export function parseStyleXml(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of text.matchAll(ITEM)) out.set(Number(m[1]), m[2]!.trim());
  return out;
}

type Kind = 'bool' | 'bit0' | 'bit1' | 'int' | 'float' | 'color';
type Value = boolean | number | [number, number, number, number];

/** 렌더링 레코드(0x733c 자식) 내용 읽기. undefined면 style.xml로 넘어간다 */
function fromRecord(kind: Kind, b: Uint8Array): Value | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (kind) {
    case 'bool':
      // 빈 내용은 거짓(style.xml로 넘어가지 않는다)
      return b.length > 0 && b[0] !== 0;
    case 'bit0':
    case 'bit1': {
      const mask = b.length === 4 ? dv.getInt32(0, true) : b.length ? b[0]! : 0;
      return (mask & (kind === 'bit0' ? 1 : 2)) !== 0;
    }
    case 'int':
      return b.length === 4 ? dv.getInt32(0, true) : b.length ? b[0]! : undefined;
    case 'float':
      return b.length === 4 ? dv.getFloat32(0, true) : b.length === 8 ? dv.getFloat64(0, true) : undefined;
    case 'color':
      // 네 바이트가 모두 0이면 "unset": 스타일이 색을 쥐고 있다
      if (b.length !== 4 || (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0)) return undefined;
      return [b[0]!, b[1]!, b[2]!, b[3]!];
  }
}

/** 정수 글(파이썬 int()처럼 앞뒤 공백·부호 허용, 소수점은 안 됨) */
function bigText(t: string): bigint | undefined {
  const s = t.trim();
  return /^[+-]?\d{1,40}$/.test(s) ? BigInt(s) : undefined;
}

/** style.xml 글 읽기(수로 못 읽으면 undefined). 색은 부호 있는 i32 = r | g<<8 | b<<16 | a<<24 */
function fromStyle(kind: Kind, t: string): Value | undefined {
  switch (kind) {
    case 'bool':
      return t !== '0' && t !== '' && t !== 'false';
    case 'bit0':
    case 'bit1': {
      const v = bigText(t);
      return v === undefined ? undefined : (v & (kind === 'bit0' ? 1n : 2n)) !== 0n;
    }
    case 'int': {
      const v = bigText(t);
      return v === undefined ? undefined : Number(v);
    }
    case 'float': {
      const s = t.trim();
      if (!s) return undefined;
      const v = Number(s);
      return Number.isNaN(v) && !/^[+-]?nan$/i.test(s) ? undefined : v;
    }
    case 'color': {
      const v = bigText(t);
      if (v === undefined) return undefined;
      const u = Number(BigInt.asUintN(32, v));
      return [u & 255, (u >>> 8) & 255, (u >>> 16) & 255, u >>> 24];
    }
  }
}

/** [꼴, 레코드 꼬리표, style.xml 항목] */
const KEYS = {
  RenderMode: ['int', 0x733d, 2001],
  ModelTransparency: ['bool', 0x733e, 2004],
  Texture: ['bool', 0x7340, 2007],
  DisplaySketchAxes: ['bool', 0x7343, 7008],
  DisplayText: ['bool', 0x7344, undefined],
  DisplayDims: ['bool', 0x7345, undefined],
  HideConstructionGeometry: ['bool', 0x7346, 7012],
  DisplayColorByLayer: ['bool', 0x7347, 7011],
  DrawSilhouettes: ['bool', 0x734f, 1006],
  SilhouetteWidth: ['int', 0x7350, 1007],
  DrawBackEdges: ['bool', 0x7356, 1015],
  BackgroundColor: ['color', 0x7357, 4000],
  ForegroundColor: ['color', 0x7358, 1014],
  // 모서리 색 방식(0 재질별 · 1 모두 같게 · 2 축별 — 공개 Ruby·C API의 EdgeColorMode 값). 꼬리표는 SketchUp에 딸린 파일에서 맞췄다:
  // 사람 컴포넌트 표본 둘만 레코드 7348 = 0이고 그 작업 사본 스타일의 1002도 0, 나머지 1,200여 파일은 둘 다 1.
  // 딸린 스타일 가운데 설명이 "colored by material"인 것만 1002 = 0이다(docs/formats/skp.md "모서리 색 방식")
  EdgeColorMode: ['int', 0x7348, 1002],
  FaceFrontColor: ['color', 0x735c, 2002],
  FaceBackColor: ['color', 0x735d, 2003],
  SkyColor: ['color', 0x7365, 4001],
  GroundColor: ['color', 0x7367, 4003],
  DrawHorizon: ['bool', 0x7368, 4002],
  DrawGround: ['bool', 0x7369, 4004],
  DisplaySectionPlanes: ['bit0', 0x7375, 7013],
  DisplaySectionCuts: ['bit1', 0x7375, 7013],
  SectionCutFilled: ['bool', 0x7376, 7015],
  DrawHiddenGeometry: ['bool', 0x7380, 7017],
  DrawHiddenObjects: ['bool', 0x7381, 7018],
  EdgeDisplayMode: ['int', undefined, 1000],
  // 안개(2021+ 렌더링 레코드만 — style.xml에는 없다). 꼬리표는 표준 파일(C API 값: DisplayFog 거짓, FogColor 미설정, FogUseBkColor 참,
  // FogStartDist·FogEndDist −1)과 실제 파일(시작 < 끝)의 값으로 맞춘 것이다(◐)
  DisplayFog: ['bool', 0x735f, undefined],
  FogColor: ['color', 0x7360, undefined],
  FogUseBkColor: ['bool', 0x7361, undefined],
  FogStartDist: ['float', 0x7362, undefined],
  FogEndDist: ['float', 0x7363, undefined],
} as const satisfies Record<string, readonly [Kind, number | undefined, number | undefined]>;

type Key = keyof typeof KEYS;

/** RenderMode 0 와이어, 1 은선, 5 단색. 그 밖(2·3·4·6·모름)은 Texture가 꺼져 있으면 음영, 아니면(없어도) 무늬 음영 */
function faceStyle(mode: Value | undefined, texture: Value | undefined): SkpFaceStyle {
  if (mode === 0) return 'wireframe';
  if (mode === 1) return 'hiddenLine';
  if (mode === 5) return 'monochrome';
  return texture === false || texture === 0 ? 'shaded' : 'textured';
}

/**
 * 렌더링 레코드 + 그 스타일의 style.xml 항목 → 화면용 스타일. 레코드·항목 어디에도 없는 값은 빠진다.
 * scale은 인치 → 장면 단위(안개 거리)
 */
export function resolveStyle(raw: SkpRenderingRaw | undefined, items: Map<number, string> | undefined, scale = 1): SkpStyleMeta {
  const out: SkpStyleMeta = {};
  const name = raw?.activeName ?? raw?.styleName;
  if (name !== undefined) out.name = name;
  if (!raw && !items) return out;
  const get = (key: Key): Value | undefined => {
    const [kind, tag, item] = KEYS[key];
    let v: Value | undefined;
    const rec = tag !== undefined ? raw?.values.get(tag) : undefined;
    if (rec) v = fromRecord(kind, rec);
    if (v === undefined && item !== undefined) {
      const t = items?.get(item);
      if (t !== undefined) v = fromStyle(kind, t);
    }
    return v;
  };
  const bool = (key: Key): boolean | undefined => {
    const v = get(key);
    return typeof v === 'boolean' ? v : undefined;
  };
  const rgb = (key: Key): Rgb | undefined => {
    const v = get(key);
    return Array.isArray(v) ? [v[0] / 255, v[1] / 255, v[2] / 255] : undefined;
  };
  const set = <K extends keyof SkpStyleMeta>(k: K, v: SkpStyleMeta[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };

  const mode = get('RenderMode');
  const texture = get('Texture');
  if (mode !== undefined || texture !== undefined) out.faceStyle = faceStyle(mode, texture);
  set('xray', bool('ModelTransparency'));
  const edges = get('EdgeDisplayMode');
  if (typeof edges === 'number') out.edges = edges !== 0;
  set('profiles', bool('DrawSilhouettes'));
  const pw = get('SilhouetteWidth');
  if (typeof pw === 'number' && pw > 0 && pw < 1000) out.profileWidth = pw;
  set('backEdges', bool('DrawBackEdges'));
  set('background', rgb('BackgroundColor'));
  // 하늘·지면: 켜져 있을 때만 색, 꺼져 있으면 null(켜짐을 모르면 뺀다)
  const sky = bool('DrawHorizon');
  if (sky === false) out.sky = null;
  else if (sky) set('sky', rgb('SkyColor'));
  const ground = bool('DrawGround');
  if (ground === false) out.ground = null;
  else if (ground) set('ground', rgb('GroundColor'));
  set('front', rgb('FaceFrontColor'));
  set('back', rgb('FaceBackColor'));
  set('edgeColor', rgb('ForegroundColor'));
  // 모서리 색 방식: 모두 같게(거의 모든 파일 — edgeColor 그대로)는 넣지 않고 재질별·축별만
  const ecm = get('EdgeColorMode');
  if (ecm === 0) out.edgeColorMode = 'material';
  else if (ecm === 2) out.edgeColorMode = 'axis';
  set('hiddenGeometry', bool('DrawHiddenGeometry'));
  set('hiddenObjects', bool('DrawHiddenObjects'));
  set('axes', bool('DisplaySketchAxes'));
  set('texts', bool('DisplayText'));
  set('dimensions', bool('DisplayDims'));
  const hideGuides = bool('HideConstructionGeometry');
  if (hideGuides !== undefined) out.guides = !hideGuides;
  set('sectionPlanes', bool('DisplaySectionPlanes'));
  set('sectionCuts', bool('DisplaySectionCuts'));
  set('sectionFill', bool('SectionCutFilled'));
  set('colorByTag', bool('DisplayColorByLayer'));
  // 안개: 거리는 장면 단위(음수 = SketchUp이 모형 크기로 정하는 기본 거리 — 화면이 정한다)
  set('fog', bool('DisplayFog'));
  set('fogColor', rgb('FogColor'));
  set('fogUseBackground', bool('FogUseBkColor'));
  const dist = (key: Key): number | undefined => {
    const v = get(key);
    return typeof v === 'number' && Number.isFinite(v) ? (v < 0 ? -1 : v * Math.abs(scale)) : undefined;
  };
  set('fogStart', dist('FogStartDist'));
  set('fogEnd', dist('FogEndDist'));
  return out;
}
