/**
 * model.dat 뿌리 절 읽기: 카메라(01fa), 렌더링(01fb), 태그·태그 폴더(01f8), 선 종류(0208), 스타일(0206), 장면(0207),
 * 글꼴(01fd), 문자·치수 기본값(01fe·01ff), 모형 속성(0209).
 * 뜻은 공개 표본 바이트로 추론한 것과 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 형식 지식을 옮긴 것이다.
 * 부르는 쪽(model.ts)이 절마다 try/catch로 감싼다 — 여기서 던진 예외는 그 절만 버리게 한다.
 */

import type { SkpAnimation, SkpAnnotationDefaults, SkpAttrDicts, SkpAxes, SkpCamera, SkpFont, SkpPage, SkpRenderingRaw, SkpShadowInfo, SkpTag, SkpTagFolder } from './model';
import type { TlvNode, TlvReader } from './tlv';
import { arrowName, leaderName, readAttrList, readHeaderAttrs, rgbOf, textAlignmentName, type Warn } from './vffcommon';
import { TAG } from './vfftags';

/** 묶음 안 같은 꼬리표 자식들(깨진 곳 앞까지, 잘린 것은 뺀다) */
function each(r: TlvReader, n: TlvNode | undefined, tag: number, fn: (c: TlvNode) => void): boolean {
  if (!n) return true;
  return r.eachSafe(n.start, n.end, (t, s, e, clipped) => {
    if (t === tag && !clipped) fn({ tag: t, start: s, end: e });
  });
}

// ── 카메라 ──────────────────────────────────────────────────────

/**
 * 카메라 0x34bc. 눈·목표·위가 있는데 24바이트가 아니거나, 비유한이거나, 눈 = 목표면 undefined(그 카메라만 버린다).
 * 시야각은 원근일 때만, 화면 높이는 평행 투영일 때만 둔다. 종횡비 0 = 창을 따름(없음).
 */
export function readCamera(r: TlvReader, cam: TlvNode, warn: Warn): SkpCamera | undefined {
  const vec = (tag: number, d: [number, number, number]): [number, number, number] | null => {
    const n = r.firstSafe(cam, tag);
    if (!n) return d;
    return r.vec3(n) ?? null;
  };
  const eye = vec(TAG.CAMERA_EYE, [0, 0, 1]);
  const target = vec(TAG.CAMERA_TARGET, [0, 0, 0]);
  const up = vec(TAG.CAMERA_UP, [0, 1, 0]);
  if (!eye || !target || !up || ![...eye, ...target, ...up].every(Number.isFinite) || (eye[0] === target[0] && eye[1] === target[1] && eye[2] === target[2])) {
    warn('깨진 카메라를 건너뛰었습니다');
    return undefined;
  }
  const p = r.firstSafe(cam, TAG.CAMERA_PERSPECTIVE);
  const perspective = p ? p.end === p.start || r.b[p.start] !== 0 : true;
  const num = (tag: number): number | undefined => {
    const v = r.f64Exact(r.firstSafe(cam, tag));
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  };
  const out: SkpCamera = { eye, target, up, perspective, twoPoint: r.flag(r.firstSafe(cam, TAG.CAMERA_TWO_POINT)) ?? false };
  if (perspective) {
    const fov = num(TAG.CAMERA_FOV);
    if (fov !== undefined) out.fov = fov;
  } else {
    const h = num(TAG.CAMERA_HEIGHT);
    if (h !== undefined) out.height = h;
  }
  const aspect = num(TAG.CAMERA_ASPECT);
  if (aspect) out.aspect = aspect;
  return out;
}

// ── 위치·그림자·그리기 축 ─────────────────────────────────────────

/** 위치·그림자 글 길이 한도 */
const PLACE_CHARS = 256;

/**
 * 위치·그림자 6590(참조 해석기와 같은 칸): 크기가 다르거나 수가 아닌 칸은 빠진다(보기 설정이라 모형을 거절하지 않는다)
 */
export function readShadowInfo(r: TlvReader, rec: TlvNode): SkpShadowInfo {
  const out: SkpShadowInfo = {};
  const at = (tag: number): TlvNode | undefined => r.firstSafe(rec, tag);
  const t = at(TAG.SHADOW_TIME);
  if (t && t.end - t.start === 4) out.time = r.uint(t)!;
  const text = (tag: number): string | undefined => {
    const n = at(tag);
    const v = n && n.end - n.start <= PLACE_CHARS * 4 ? r.str(n) : undefined;
    return v ? v.slice(0, PLACE_CHARS) : undefined;
  };
  const city = text(TAG.SHADOW_CITY);
  if (city) out.city = city;
  const country = text(TAG.SHADOW_COUNTRY);
  if (country) out.country = country;
  const real = (tag: number): number | undefined => {
    const v = r.f64Exact(at(tag));
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  };
  const lat = real(TAG.SHADOW_LATITUDE);
  if (lat !== undefined) out.latitude = lat;
  const lon = real(TAG.SHADOW_LONGITUDE);
  if (lon !== undefined) out.longitude = lon;
  const tz = real(TAG.SHADOW_TZ);
  if (tz !== undefined) out.tz = tz;
  const north = r.vec3(at(TAG.SHADOW_NORTH));
  if (north && north.every(Number.isFinite)) out.north = north;
  const int = (tag: number): number | undefined => r.i32Exact(at(tag));
  const light = int(TAG.SHADOW_LIGHT);
  if (light !== undefined) out.light = light;
  const dark = int(TAG.SHADOW_DARK);
  if (dark !== undefined) out.dark = dark;
  const flag = (tag: number): boolean | undefined => {
    const n = at(tag);
    return n && n.end - n.start === 1 ? r.b[n.start] !== 0 : undefined;
  };
  const display = flag(TAG.SHADOW_DISPLAY);
  if (display !== undefined) out.display = display;
  const onFaces = flag(TAG.SHADOW_ON_FACES);
  if (onFaces !== undefined) out.onFaces = onFaces;
  const onGround = flag(TAG.SHADOW_ON_GROUND);
  if (onGround !== undefined) out.onGround = onGround;
  const useSun = flag(TAG.SHADOW_USE_SUN);
  if (useSun !== undefined) out.useSun = useSun;
  return out;
}

/** 그리기 축 4650: 원점·x·y·z(f64×3씩). 칸이 모자라거나 축이 0이면 undefined, 기본 축(원점 0, 단위 축)이면 undefined */
export function readAxes(r: TlvReader, rec: TlvNode): SkpAxes | undefined {
  const v = (tag: number): [number, number, number] | undefined => {
    const x = r.vec3(r.firstSafe(rec, tag));
    return x && x.every(Number.isFinite) ? x : undefined;
  };
  return axesOf(v(TAG.AXES_ORIGIN), v(TAG.AXES_X), v(TAG.AXES_Y), v(TAG.AXES_Z));
}

/** 원점·세 축 → 축(단위 벡터로). 모자라거나 축 길이가 0이면, 또는 기본 축이면 undefined */
export function axesOf(origin?: [number, number, number], x?: [number, number, number], y?: [number, number, number], z?: [number, number, number]): SkpAxes | undefined {
  if (!origin || !x || !y || !z) return undefined;
  const unit = (a: [number, number, number]): [number, number, number] | null => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : null;
  };
  const ux = unit(x);
  const uy = unit(y);
  const uz = unit(z);
  if (!ux || !uy || !uz) return undefined;
  const near = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) < 1e-12;
  if (near(origin, [0, 0, 0]) && near(ux, [1, 0, 0]) && near(uy, [0, 1, 0]) && near(uz, [0, 0, 1])) return undefined;
  return { origin, x: ux, y: uy, z: uz };
}

// ── 선 종류·태그·태그 폴더 ─────────────────────────────────────────

/** 선 종류 0x0208 → 번호 → 이름 */
export function readLineStyles(r: TlvReader, sec: TlvNode): Map<number, string> {
  const out = new Map<number, string>();
  const list = r.firstSafe(sec, TAG.LINESTYLE_A);
  const items = list && r.firstSafe(list, TAG.LINESTYLE_LIST);
  each(r, items, TAG.LINESTYLE, (n) => {
    try {
      const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
      const name = r.str(r.firstSafe(n, TAG.LINESTYLE_NAME));
      if (id !== undefined && name !== undefined && !out.has(id)) out.set(id, name);
    } catch {
      /* 이 선 종류만 버린다 */
    }
  });
  return out;
}

/** 실선(선 종류 없음과 같다) */
const SOLID_LINE_STYLE = 'Solid Basic';
/** 태그 폴더 겹침 한도 */
const FOLDER_DEPTH = 64;

export interface LayerSet {
  /** 번호 → 이름(옛 칸) */
  layers: Map<number, string>;
  tags: SkpTag[];
  folders: SkpTagFolder[];
  /** 태그 번호 → tags 차례 */
  index: Map<number, number>;
  /** 새 장면에서 기본 숨김(0x3c90 = 1)인 태그 차례 */
  defaultHidden: Set<number>;
  /** 기본 태그(목록 첫째) 번호 */
  defaultLayer?: number;
  /** 활성 태그(0x3a9a) 번호 */
  activeLayer?: number;
}

/** 태그 절 0x01f8 → 3a98(목록 3a99, 활성 3a9a, 폴더 3a9b) */
export function readLayers(r: TlvReader, sec: TlvNode, lineStyles: Map<number, string>, warn: Warn): LayerSet {
  const out: LayerSet = { layers: new Map(), tags: [], folders: [], index: new Map(), defaultHidden: new Set() };
  const list = r.firstSafe(sec, TAG.LAYER_LIST, true);
  if (!list) return out;
  const items = r.firstSafe(list, TAG.LAYER_ITEMS, true);
  if (items)
    r.eachSafe(items.start, items.end, (tag, start, end, clipped) => {
      if (tag !== TAG.LAYER_ITEM || clipped) return;
      const n = { tag, start, end };
      try {
        const header = r.first(n, TAG.ID_BOX);
        const id = header && r.uint(r.first(header, TAG.ID));
        if (id === undefined) return;
        const name = r.str(r.first(n, TAG.LAYER_NAME)) ?? `태그 ${id}`;
        const t: SkpTag = { id, name, visible: !r.flag(r.first(n, TAG.LAYER_HIDDEN)), sceneHidden: false };
        const colorN = r.first(n, TAG.LAYER_COLOR);
        const mat = colorN && r.first(colorN, TAG.MAT);
        const matName = mat && r.str(r.first(mat, TAG.MAT_NAME));
        if (matName) t.colorMaterial = matName;
        const sceneN = r.first(n, TAG.LAYER_SCENE_HIDDEN);
        if (sceneN && sceneN.end > sceneN.start && sceneN.end - sceneN.start <= 8 && r.uint(sceneN) === 1) t.sceneHidden = true;
        const ls = r.uint(r.first(n, TAG.LAYER_LINE_STYLE));
        const lsName = ls !== undefined ? lineStyles.get(ls) : undefined;
        if (lsName !== undefined && lsName !== SOLID_LINE_STYLE) t.lineStyle = lsName;
        const attrs = readHeaderAttrs(r, header, warn);
        if (attrs) t.attrs = attrs;
        if (!out.layers.has(id)) out.layers.set(id, name);
        if (!out.index.has(id)) out.index.set(id, out.tags.length);
        if (t.sceneHidden) out.defaultHidden.add(out.tags.length);
        out.tags.push(t);
      } catch {
        warn('깨진 태그 항목을 건너뛰었습니다');
      }
    });
  if (out.tags.length) out.defaultLayer = out.tags[0]!.id;
  const active = r.uint(r.firstSafe(list, TAG.LAYER_ACTIVE));
  if (active !== undefined) out.activeLayer = active;
  try {
    readFolders(r, r.firstSafe(list, TAG.LAYER_FOLDERS), out, warn);
  } catch {
    out.folders = [];
    for (const t of out.tags) delete t.folder;
    warn('태그 폴더를 읽지 못했습니다');
  }
  return out;
}

/** 태그 폴더: 뿌리 폴더는 빼고 앞 순회로 펼친다. 태그의 folder = 그 태그를 담은(나중) 폴더 차례 */
function readFolders(r: TlvReader, holder: TlvNode | undefined, set: LayerSet, warn: Warn): void {
  if (!holder) return;
  let deep = false;
  const visit = (n: TlvNode, parent: number, root: boolean, depth: number): void => {
    let index = parent;
    if (!root) {
      const f: SkpTagFolder = { name: r.str(r.firstSafe(n, TAG.FOLDER_NAME)) ?? '', visible: !r.flag(r.firstSafe(n, TAG.FOLDER_HIDDEN)), parent };
      index = set.folders.length;
      set.folders.push(f);
      const listed = r.packedIds(r.firstSafe(n, TAG.FOLDER_LAYERS));
      for (const id of listed.ids) {
        const t = set.index.get(id);
        if (t !== undefined) set.tags[t]!.folder = index;
      }
    }
    if (depth >= FOLDER_DEPTH) {
      deep = true;
      return;
    }
    r.eachSafe(n.start, n.end, (tag, s, e, clipped) => {
      if (tag !== TAG.FOLDER_CHILDREN || clipped) return;
      each(r, { tag, start: s, end: e }, TAG.FOLDER, (c) => visit(c, index, false, depth + 1));
    });
  };
  each(r, holder, TAG.FOLDER, (root) => visit(root, -1, true, 0));
  if (deep) warn(`태그 폴더가 ${FOLDER_DEPTH}겹보다 깊어 안쪽을 읽지 않았습니다`);
}

// ── 스타일·렌더링 ────────────────────────────────────────────────

export interface StyleSet {
  /** 스타일 번호 → 이름(= styles/<이름>/style.xml 폴더) */
  names: Map<number, string>;
  /** 활성 스타일 이름 */
  active?: string;
  /** 작업 사본 이름(지금 값이 이 스타일의 style.xml에 있다) */
  working?: string;
}

/** 스타일 절 0x0206 → 6978(목록 6979, 활성 697a, 작업 사본 697b) */
export function readStyles(r: TlvReader, sec: TlvNode): StyleSet {
  const out: StyleSet = { names: new Map() };
  const root = r.firstSafe(sec, TAG.STYLES);
  if (!root) return out;
  each(r, r.firstSafe(root, TAG.STYLES_LIST), TAG.STYLE, (n) => {
    try {
      const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
      const name = r.str(r.first(n, TAG.STYLE_NAME)) ?? '';
      if (id !== undefined && !out.names.has(id)) out.names.set(id, name);
    } catch {
      /* 이 스타일만 버린다 */
    }
  });
  const active = r.uint(r.firstSafe(root, TAG.STYLES_ACTIVE));
  const activeName = active !== undefined ? out.names.get(active) : undefined;
  if (activeName !== undefined) out.active = activeName;
  const working = r.firstSafe(root, TAG.STYLES_WORKING);
  const ws = working && r.firstSafe(working, TAG.STYLE);
  const wn = ws && r.str(r.firstSafe(ws, TAG.STYLE_NAME));
  if (wn !== undefined) out.working = wn;
  return out;
}

/** 렌더링 레코드 0x733c → 자식 꼬리표 → 내용 사본(같은 꼬리표는 첫 것) */
export function readRenderingValues(r: TlvReader, n: TlvNode): Map<number, Uint8Array> {
  const values = new Map<number, Uint8Array>();
  r.eachSafe(n.start, n.end, (tag, s, e, clipped) => {
    if (!clipped && !values.has(tag)) values.set(tag, r.bytes({ tag, start: s, end: e }));
  });
  return values;
}

// ── 장면 ────────────────────────────────────────────────────────

/** 썸네일 경로 한도(바이트) */
const THUMB_PATH_LIMIT = 4096;

/** 장면 절 0x0207 → 6d60(목록 6d61, 활성 6d62) */
export function readPages(
  r: TlvReader,
  sec: TlvNode,
  layers: LayerSet,
  styles: StyleSet,
  animation: SkpAnimation | undefined,
  warn: Warn,
): { pages: SkpPage[]; active?: number } {
  const pages: SkpPage[] = [];
  const byId = new Map<number, number>();
  const root = r.firstSafe(sec, TAG.PAGES, true);
  if (!root) return { pages };
  const list = r.firstSafe(root, TAG.PAGES_LIST, true);
  let ok = true;
  if (list)
    ok = each(r, list, TAG.PAGE, (n) => {
      try {
        const page = readPage(r, n, layers, styles, animation, warn);
        if (page.pid !== undefined && !byId.has(page.pid)) byId.set(page.pid, pages.length);
        pages.push(page);
      } catch {
        warn('깨진 장면을 건너뛰었습니다');
      }
    });
  if (!ok) warn('장면 목록이 깨져 뒷부분을 읽지 못했습니다');
  const out: { pages: SkpPage[]; active?: number } = { pages };
  const active = r.uint(r.firstSafe(root, TAG.PAGES_ACTIVE));
  const idx = active !== undefined ? byId.get(active) : undefined;
  if (idx !== undefined) out.active = idx;
  return out;
}

function readPage(r: TlvReader, n: TlvNode, layers: LayerSet, styles: StyleSet, animation: SkpAnimation | undefined, warn: Warn): SkpPage {
  const head = r.first(n, TAG.PAGE_HEADER);
  const page: SkpPage = {
    name: (head && r.str(r.first(head, TAG.PAGE_NAME))) ?? '',
    description: (head && r.str(r.first(head, TAG.PAGE_DESCRIPTION))) ?? '',
    flags: 0,
    hiddenIds: [],
    hiddenTags: [],
    sectionIds: [],
  };
  const pid = head && r.uint(r.path(head, TAG.ID_BOX, TAG.ID));
  if (pid !== undefined) page.pid = pid;
  const flagsN = r.first(n, TAG.PAGE_FLAGS);
  if (flagsN) {
    const f = r.i32Exact(flagsN);
    if (f === undefined) warn('장면 깃발의 크기가 맞지 않아 0으로 둡니다');
    else page.flags = f;
  }
  const camHolder = r.first(n, TAG.PAGE_CAMERA);
  const cam = camHolder && r.first(camHolder, TAG.CAMERA);
  const camera = cam && readCamera(r, cam, warn);
  if (camera) page.camera = camera;
  const ids = (tag: number, what: string): number[] => {
    const p = r.packedIds(r.first(n, tag));
    if (!p.ok) warn(`깨진 장면 ${what} 목록의 뒷부분을 건너뛰었습니다`);
    if (p.unsafe) warn(`장면 ${what} 목록의 너무 큰 번호를 건너뛰었습니다`);
    return p.ids;
  };
  page.hiddenIds = [...new Set(ids(TAG.PAGE_HIDDEN, '숨긴 개체'))];
  const listed = new Set<number>();
  for (const id of ids(TAG.PAGE_LAYERS, '태그')) {
    const t = layers.index.get(id);
    if (t !== undefined) listed.add(t);
  }
  const hidden = new Set(listed);
  for (const t of layers.defaultHidden) {
    if (hidden.has(t)) hidden.delete(t);
    else hidden.add(t);
  }
  page.hiddenTags = [...hidden].sort((a, b) => a - b);
  page.sectionIds = ids(TAG.PAGE_SECTIONS, '단면');
  const renderHolder = r.first(n, TAG.PAGE_RENDERING);
  const render = renderHolder && r.first(renderHolder, TAG.RENDERING);
  if (render) {
    const raw: SkpRenderingRaw = { values: readRenderingValues(r, render) };
    const sid = r.uint(r.first(n, TAG.PAGE_STYLE));
    const sname = sid !== undefined ? styles.names.get(sid) : undefined;
    if (sname !== undefined) raw.styleName = sname;
    page.rendering = raw;
  }
  const time = (tag: number, fallback: number | undefined): number | undefined => {
    const v = r.f64Exact(r.first(n, tag));
    return v !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const transition = time(TAG.PAGE_TRANSITION, animation?.transitionTime);
  if (transition !== undefined) page.transition = transition;
  const delay = time(TAG.PAGE_DELAY, animation?.sceneDelay);
  if (delay !== undefined) page.delay = delay;
  const inAnim = r.first(n, TAG.PAGE_IN_ANIMATION);
  page.includeInAnimation = !inAnim || inAnim.end === inAnim.start || r.b[inAnim.start] !== 0;
  // 이 장면이 기억하는 그림자 설정(깃발 0x004)
  if (page.flags & 0x004) {
    const holder = r.first(n, TAG.PAGE_SHADOW);
    const rec = holder && r.first(holder, TAG.SHADOW_INFO);
    if (rec) page.shadowInfo = readShadowInfo(r, rec);
  }
  const thumb = r.first(n, TAG.PAGE_THUMBNAIL);
  const path = thumb && r.first(thumb, TAG.TEXTURE_PATH);
  if (path && path.end - path.start <= THUMB_PATH_LIMIT) {
    const p = r.str(path);
    if (p) page.thumbnail = p;
  }
  return page;
}

// ── 글꼴·문자·치수 기본값 ────────────────────────────────────────

const MAX_POINTS = 10_000;
const FACE_LIMIT = 256;

/** 글꼴 절 0x01fd → 4e20 → 4e21 → 5014* : 영구 번호 → 글꼴 */
export function readFonts(r: TlvReader, sec: TlvNode): Map<number, SkpFont> {
  const out = new Map<number, SkpFont>();
  const a = r.firstSafe(sec, TAG.FONTS);
  const list = a && r.firstSafe(a, TAG.FONTS_LIST);
  each(r, list, TAG.FONT, (n) => {
    try {
      const id = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
      if (id === undefined || out.has(id)) return;
      const f: SkpFont = {
        face: (r.str(r.first(n, TAG.FONT_FACE)) ?? '').slice(0, FACE_LIMIT),
        bold: r.flag(r.first(n, TAG.FONT_BOLD)) ?? false,
        italic: r.flag(r.first(n, TAG.FONT_ITALIC)) ?? false,
      };
      const pt = r.i32Exact(r.first(n, TAG.FONT_POINTS));
      if (pt !== undefined && pt > 0 && pt <= MAX_POINTS) f.pointSize = pt;
      const world = r.f64Exact(r.first(n, TAG.FONT_WORLD_SIZE));
      if (r.flag(r.first(n, TAG.FONT_USE_WORLD)) && world !== undefined && Number.isFinite(world) && world > 0) f.worldSize = world;
      out.set(id, f);
    } catch {
      /* 이 글꼴만 버린다 */
    }
  });
  return out;
}

/** Model Info > 문자(0x01fe → 57e4)·치수(0x01ff → 5fb4) 기본값. 둘 다 없으면 undefined */
export function readAnnotationDefaults(
  textSec: { r: TlvReader; n: TlvNode } | undefined,
  dimSec: { r: TlvReader; n: TlvNode } | undefined,
  fonts: Map<number, SkpFont>,
): SkpAnnotationDefaults | undefined {
  // 두 절은 따로 받은 버퍼일 수 있다(조각으로 읽을 때) — 절마다 그 reader로 읽는다
  const t = textSec && textSec.r.firstSafe(textSec.n, TAG.TEXT_DEFAULTS);
  const d = dimSec && dimSec.r.firstSafe(dimSec.n, TAG.DIM_DEFAULTS);
  if (!t && !d) return undefined;
  const out: SkpAnnotationDefaults = {};
  const font = (r: TlvReader, n: TlvNode | undefined, tag: number): number | undefined => {
    const id = n && r.uint(r.firstSafe(n, tag));
    return id !== undefined && fonts.has(id) ? id : undefined;
  };
  const int = (r: TlvReader, n: TlvNode | undefined, tag: number): number | undefined => (n ? r.i32Exact(r.firstSafe(n, tag)) : undefined);
  const set = <K extends keyof SkpAnnotationDefaults>(k: K, v: SkpAnnotationDefaults[K] | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  if (t) {
    const r = textSec!.r;
    set('textFont', font(r, t, TAG.TEXT_DEFAULTS_FONT));
    set('leaderFont', font(r, t, TAG.TEXT_DEFAULTS_LEADER_FONT));
    set('leaderArrow', arrowName(int(r, t, TAG.TEXT_DEFAULTS_ARROW)));
    set('leaderType', leaderName(int(r, t, TAG.TEXT_DEFAULTS_LEADER_TYPE)));
    set('textColor', rgbOf(r, r.firstSafe(t, TAG.TEXT_DEFAULTS_COLOR)));
    set('leaderColor', rgbOf(r, r.firstSafe(t, TAG.TEXT_DEFAULTS_LEADER_COLOR)));
  }
  if (d) {
    const r = dimSec!.r;
    set('dimFont', font(r, d, TAG.DIM_DEFAULTS_FONT));
    set('dimAlignedText', r.flag(r.firstSafe(d, TAG.DIM_DEFAULTS_ALIGNED)));
    set('dimArrow', arrowName(int(r, d, TAG.DIM_DEFAULTS_ARROW)));
    set('dimColor', rgbOf(r, r.firstSafe(d, TAG.DIM_DEFAULTS_COLOR)));
    set('dimTextAlignment', textAlignmentName(int(r, d, TAG.DIM_DEFAULTS_TEXT_POS)));
  }
  return out;
}

// ── 모형 속성 ────────────────────────────────────────────────────

/** 모형 속성 절 0x0209 → 36b1: 사전 전체와 ModelProperties의 Name·Description(문자열일 때만) */
export function readModelProperties(r: TlvReader, sec: TlvNode, warn: Warn): { properties?: SkpAttrDicts; name?: string; description?: string } {
  const list = r.firstSafe(sec, TAG.ATTR_LIST);
  const dicts = list && readAttrList(r, list, warn);
  if (!dicts) return {};
  const out: { properties?: SkpAttrDicts; name?: string; description?: string } = { properties: dicts };
  const mp = dicts['ModelProperties'];
  if (typeof mp?.['Name'] === 'string') out.name = mp['Name'];
  if (typeof mp?.['Description'] === 'string') out.description = mp['Description'];
  return out;
}
