/**
 * 중간 모형(SkpModel)의 뿌리 절 → 화면용 meta 꼴(src/meta.ts) 바꾸기. 순수 함수만 둔다(시험하기 좋게).
 *
 * - 단위: UnitsOptions/LengthUnit → 장면 단위와 인치에서의 배율(unitsFor).
 * - 카메라: 위치·평행 투영 높이는 인치 → 장면 단위(× scale), 위 벡터·시야각(도)·종횡비는 그대로(cameraMeta).
 * - 장면: use 깃발(0x1 카메라, 0x2 스타일, 0x4 그림자, 0x20 숨긴 태그, 0x40 단면, 0x100 숨긴 개체)이 켜진 것만 그 칸을 적는다(pagesMeta).
 * - 위치·그림자·그리기 축: 그림자 설정(0204·CShadowInfo)과 모형 속성 GeoReference → 위치(locationMeta), 축 원점은 장면 단위(axesMeta).
 *   숨긴 개체 목록은 영구 번호라 나무 노드로 바꾼다: 정의 안 인스턴스 하나의 번호는 그 정의가 놓인 모든 자리의 노드가 된다.
 *   활성 단면 번호는 meta.sectionPlanes 차례(배치마다 하나)로 바꾼다.
 * - 속성 사전: 형 있는 값을 화면에 보일 글·수로 푼다(attrDictsMeta).
 * 형식 지식은 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 뿌리 절 해석에서 옮겼다.
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpAttrDictsMeta, SkpAttrValueMeta, SkpAxesMeta, SkpCameraMeta, SkpEdgeColorMode, SkpLocationMeta, SkpPageMeta, SkpShadowMeta, SkpStyleMeta, Vec3 } from './meta';
import type { SkpAttr, SkpAttrDicts, SkpAxes, SkpCamera, SkpModel, SkpRenderingRaw, SkpShadowInfo } from './model';
import { resolveStyle } from './styles';

/** 장면 use 깃발 */
export const PAGE_USE_CAMERA = 0x001;
export const PAGE_USE_STYLE = 0x002;
export const PAGE_USE_HIDDEN_TAGS = 0x020;
export const PAGE_USE_SECTIONS = 0x040;
export const PAGE_USE_HIDDEN_OBJECTS = 0x100;
export const PAGE_USE_SHADOW = 0x004;

/** 위치·그림자 설정 → meta(그대로 옮기고 북쪽은 사본) */
export function shadowMeta(s: SkpShadowInfo): SkpShadowMeta {
  const out: SkpShadowMeta = { ...s };
  if (s.north) out.north = [s.north[0], s.north[1], s.north[2]];
  return out;
}

/** 북쪽 방향 → 북쪽 각(도, +Y에서 +X 쪽으로 0~360). 수평 성분이 없으면 undefined */
export function northAngleOf(north: readonly number[] | undefined): number | undefined {
  if (!north || !(Math.hypot(north[0]!, north[1]!) > 1e-12)) return undefined;
  const a = (Math.atan2(north[0]!, north[1]!) * 180) / Math.PI;
  return Math.round(((a % 360) + 360) % 360 * 1e6) / 1e6;
}

/**
 * 모형 위치: 그림자 설정의 도시·나라·위경도·시간대·북쪽 각과 지리 참조 여부(모형 속성 GeoReference.UsesGeoReferencing).
 * 2020 이하는 GeoReference 사전에 위경도가 있으면 그 값(참조 해석기와 같다). 아무 칸도 없으면 undefined
 */
export function locationMeta(model: Pick<SkpModel, 'shadowInfo' | 'properties'> & { root?: Pick<SkpModel['root'], 'attrs'> }): SkpLocationMeta | undefined {
  const s = model.shadowInfo;
  // GeoReference 사전은 모형 속성 절에 있거나(2021+) 뿌리 요소 묶음 머리 사전에 있다(meta.attributes의 모형 속성은 둘을 합친 것)
  const geo = model.properties?.['GeoReference'] ?? model.root?.attrs?.['GeoReference'];
  const uses = geo?.['UsesGeoReferencing'] === true;
  if (!s && !uses) return undefined;
  const out: SkpLocationMeta = { georeferenced: uses };
  if (s?.city) out.city = s.city;
  if (s?.country) out.country = s.country;
  // 지리 참조를 쓰는 모형이면 GeoReference의 위경도(2020 이하 참조 해석기와 같다), 아니면 그림자 설정의 위경도(GeoReference에는 기본값이 남아 있을 수 있다)
  const lat = uses && typeof geo?.['Latitude'] === 'number' ? (geo['Latitude'] as number) : s?.latitude;
  const lon = uses && typeof geo?.['Longitude'] === 'number' ? (geo['Longitude'] as number) : s?.longitude;
  if (lat !== undefined && Number.isFinite(lat) && Math.abs(lat) <= 90) out.latitude = lat;
  if (lon !== undefined && Number.isFinite(lon) && Math.abs(lon) <= 360) out.longitude = lon;
  if (s?.tz !== undefined && Number.isFinite(s.tz)) out.tz = s.tz;
  const na = northAngleOf(s?.north);
  if (na !== undefined) out.northAngle = na;
  return out;
}

/** 그리기 축 → meta(원점은 장면 단위) */
export function axesMeta(a: SkpAxes | undefined, scale: number): SkpAxesMeta | undefined {
  if (!a) return undefined;
  return { origin: [a.origin[0] * scale, a.origin[1] * scale, a.origin[2] * scale], x: [...a.x], y: [...a.y], z: [...a.z] };
}
/** 장면 전환·지연 시간 상한(초) — 참조 뷰어와 같게 */
export const MAX_TRANSITION_S = 60;
export const MAX_DELAY_S = 3600;

/** UnitsOptions/LengthUnit(0 인치, 1 피트, 2 mm, 3 cm, 4 m, 5 야드) → 장면 단위와 인치에서의 배율, 옛 meta.lengthUnit 글 */
export function unitsFor(lengthUnit: number | undefined): { units: Scene3d['units']; scale: number; label: string } {
  switch (lengthUnit) {
    case 2:
      return { units: 'mm', scale: 25.4, label: 'mm' };
    case 3:
      return { units: 'mm', scale: 25.4, label: 'cm' };
    case 4:
      return { units: 'm', scale: 0.0254, label: 'm' };
    case 1:
      return { units: 'inch', scale: 1, label: 'ft' };
    case 5:
      // 장면 단위에 야드가 없어 피트처럼 인치 장면으로 두고 표시만 야드로 한다
      return { units: 'inch', scale: 1, label: 'yd' };
    default:
      return { units: 'inch', scale: 1, label: 'inch' };
  }
}

const finite3 = (v: readonly number[] | undefined): v is Vec3 =>
  !!v && v.length >= 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

/** 모형·장면 카메라 → 장면 좌표 카메라. 눈 = 목표이거나 비유한이면 없음 */
export function cameraMeta(c: SkpCamera | undefined, scale: number): SkpCameraMeta | undefined {
  if (!c || !finite3(c.eye) || !finite3(c.target) || !(Number.isFinite(scale) && scale !== 0)) return undefined;
  const eye: Vec3 = [c.eye[0] * scale, c.eye[1] * scale, c.eye[2] * scale];
  const target: Vec3 = [c.target[0] * scale, c.target[1] * scale, c.target[2] * scale];
  if (!(Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]) > 0)) return undefined;
  const up: Vec3 = finite3(c.up) && Math.hypot(c.up[0], c.up[1], c.up[2]) > 0 ? [c.up[0], c.up[1], c.up[2]] : [0, 0, 1];
  const out: SkpCameraMeta = { eye, target, up, perspective: c.perspective !== false };
  if (out.perspective) {
    if (c.fov !== undefined && Number.isFinite(c.fov) && c.fov > 0 && c.fov < 180) out.fovY = c.fov;
  } else if (c.height !== undefined && Number.isFinite(c.height) && c.height > 0) out.height = c.height * Math.abs(scale);
  if (c.aspect !== undefined && Number.isFinite(c.aspect) && c.aspect > 0) out.aspect = c.aspect;
  if (c.twoPoint) out.twoPoint = true;
  return out;
}

/** 렌더링 레코드 + 꾸러미 style.xml 모음(폴더 = 스타일 이름) → 화면용 스타일. 레코드도 스타일 글도 없거나 빈 결과면 없음 */
export function styleFor(raw: SkpRenderingRaw | undefined, styles: ReadonlyMap<string, Map<number, string>> | undefined, scale = 1): SkpStyleMeta | undefined {
  const items = raw?.styleName !== undefined ? styles?.get(raw.styleName) : undefined;
  if (!raw && !items) return undefined;
  const s = resolveStyle(raw, items, scale);
  return s && typeof s === 'object' && Object.keys(s).length ? s : undefined;
}

/**
 * 모서리 묶음에 정점 색으로 칠할 모서리 색 방식: 모형 스타일이 재질별·축별이면 그것, 아니면 스타일을 쓰는 첫 장면의 것(없으면 없음 — 모두 같게).
 * 장면마다 방식이 다르면 화면은 이 방식의 정점 색과 한 색(모두 같게) 사이만 바꾼다
 */
export function edgeColoringFor(
  model: Pick<SkpModel, 'pages'>,
  modelStyle: SkpStyleMeta | undefined,
  styles: ReadonlyMap<string, Map<number, string>> | undefined,
  scale = 1,
): SkpEdgeColorMode | undefined {
  if (modelStyle?.edgeColorMode) return modelStyle.edgeColorMode;
  for (const p of model.pages ?? []) {
    if (!(Number.isFinite(p.flags) && p.flags & PAGE_USE_STYLE)) continue;
    const m = styleFor(p.rendering, styles, scale)?.edgeColorMode;
    if (m) return m;
  }
  return undefined;
}

export interface PagesContext {
  /** 꾸러미의 styles/<폴더>/style.xml을 푼 것(폴더 이름 → 항목) */
  styles?: ReadonlyMap<string, Map<number, string>>;
  /** 나무 노드마다 인스턴스 영구 번호(없으면 undefined) — 없으면 장면의 숨긴 개체를 노드로 바꾸지 않는다 */
  nodePids?: readonly (number | undefined)[];
  /** meta.sectionPlanes 차례마다 단면 영구 번호 */
  sectionPids?: readonly (number | undefined)[];
}

const clampTime = (v: number | undefined, max: number): number | undefined => (v !== undefined && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : undefined);

/** 번호 → 그 번호를 가진 차례들 */
function indexByPid(pids: readonly (number | undefined)[] | undefined): Map<number, number[]> | null {
  if (!pids) return null;
  const map = new Map<number, number[]>();
  for (let i = 0; i < pids.length; i++) {
    const p = pids[i];
    if (p === undefined) continue;
    const list = map.get(p);
    if (list) list.push(i);
    else map.set(p, [i]);
  }
  return map;
}

/** 장면 목록 → 화면용 장면(장면 좌표). 장면이 없으면 빈 목록 */
export function pagesMeta(model: SkpModel, scale: number, ctx: PagesContext = {}): { pages: SkpPageMeta[]; activePage?: number } {
  const src = model.pages ?? [];
  const nodesOf = indexByPid(ctx.nodePids);
  const sectionsOf = indexByPid(ctx.sectionPids);
  const pages: SkpPageMeta[] = [];
  for (const p of src) {
    const flags = Number.isFinite(p.flags) ? p.flags : 0;
    const out: SkpPageMeta = { name: typeof p.name === 'string' ? p.name : '' };
    if (p.description) out.description = p.description;
    if (flags & PAGE_USE_CAMERA) {
      const cam = cameraMeta(p.camera, scale);
      if (cam) out.camera = cam;
    }
    if (flags & PAGE_USE_STYLE) {
      const st = styleFor(p.rendering, ctx.styles, scale);
      if (st) out.style = st;
    }
    if (flags & PAGE_USE_HIDDEN_TAGS && model.tags) {
      const names: string[] = [];
      for (const i of p.hiddenTags ?? []) {
        const t = model.tags[i];
        if (t && !names.includes(t.name)) names.push(t.name);
      }
      out.hiddenTags = names;
    }
    if (flags & PAGE_USE_SECTIONS && sectionsOf) {
      const set = new Set<number>();
      for (const id of p.sectionIds ?? []) for (const k of sectionsOf.get(id) ?? []) set.add(k);
      out.sectionPlanes = [...set].sort((a, b) => a - b);
    }
    if (flags & PAGE_USE_HIDDEN_OBJECTS && nodesOf) {
      const set = new Set<number>();
      for (const id of p.hiddenIds ?? []) for (const k of nodesOf.get(id) ?? []) set.add(k);
      out.hiddenNodes = [...set].sort((a, b) => a - b);
    }
    // 장면 값이 없으면 모형 기본(Model Info > Animation). 장면 전환을 끈 모형은 0초
    const anim = model.animation;
    const tr = anim?.showTransition === false ? 0 : clampTime(clampTime(p.transition, Infinity) ?? anim?.transitionTime, MAX_TRANSITION_S);
    if (tr !== undefined) out.transition = tr;
    const dl = clampTime(clampTime(p.delay, Infinity) ?? anim?.sceneDelay, MAX_DELAY_S);
    if (dl !== undefined) out.delay = dl;
    if (p.thumbnail) out.thumbnail = p.thumbnail;
    // 장면 재생(슬라이드 쇼)에서 뺀 장면만 적는다
    if (p.includeInAnimation === false) out.includeInAnimation = false;
    if (flags & PAGE_USE_SHADOW && p.shadowInfo) out.shadow = shadowMeta(p.shadowInfo);
    pages.push(out);
  }
  const res: { pages: SkpPageMeta[]; activePage?: number } = { pages };
  const a = model.activePage;
  if (a !== undefined && Number.isInteger(a) && a >= 0 && a < pages.length) res.activePage = a;
  return res;
}

const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : String(v));
const triple = (v: readonly number[], k = 1): string => `(${num(v[0]! * k)}, ${num(v[1]! * k)}, ${num(v[2]! * k)})`;

/** 형 있는 값 하나 → 화면용 값. 길이·점은 장면 단위(× scale)로, 색은 rgba 글, 시각은 ISO 글(UTC) */
export function attrValueMeta(v: SkpAttr, scale = 1, depth = 0): SkpAttrValueMeta {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (Array.isArray(v)) {
    if (depth > 8) return '[…]';
    return `[${v
      .slice(0, 256)
      .map((x) => {
        const s = attrValueMeta(x, scale, depth + 1);
        return typeof s === 'string' && !(Array.isArray(x) || (x && typeof x === 'object')) ? JSON.stringify(s) : String(s);
      })
      .join(', ')}${v.length > 256 ? ', …' : ''}]`;
  }
  if (typeof v !== 'object') return null;
  switch (v.kind) {
    case 'color':
      return `rgba(${v.rgba.join(', ')})`;
    case 'time': {
      const d = new Date(v.epoch * 1000);
      return Number.isFinite(d.getTime()) ? d.toISOString().replace(/\.000Z$/, 'Z') : String(v.epoch);
    }
    case 'length':
      return Number.isFinite(v.inch) ? v.inch * scale : null;
    case 'point':
      return triple(v.xyz, scale);
    case 'vector':
      return triple(v.xyz);
    default:
      return null;
  }
}

/** 속성 사전들 → 화면용(사전 이름 → 열쇠 → 값) */
export function attrDictsMeta(d: SkpAttrDicts, scale = 1): SkpAttrDictsMeta {
  const out: SkpAttrDictsMeta = {};
  for (const [name, dict] of Object.entries(d)) {
    if (!dict || typeof dict !== 'object') continue;
    const o: Record<string, SkpAttrValueMeta> = {};
    for (const [k, v] of Object.entries(dict)) o[k] = attrValueMeta(v, scale);
    out[name] = o;
  }
  return out;
}

/** 속성 사전 모음(같은 내용은 한 번만) — meta.attributes와 그 차례 */
export class AttrPool {
  readonly list: SkpAttrDictsMeta[] = [];
  private readonly byKey = new Map<string, number>();
  private readonly byRef = new WeakMap<object, number>();
  constructor(private readonly scale = 1) {}
  /** 사전들의 차례(없거나 비었으면 -1) */
  add(d: SkpAttrDicts | undefined): number {
    if (!d || typeof d !== 'object') return -1;
    const known = this.byRef.get(d);
    if (known !== undefined) return known;
    const m = attrDictsMeta(d, this.scale);
    if (!Object.keys(m).length) {
      this.byRef.set(d, -1);
      return -1;
    }
    const key = JSON.stringify(m);
    let i = this.byKey.get(key);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(m);
      this.byKey.set(key, i);
    }
    this.byRef.set(d, i);
    return i;
  }
}
