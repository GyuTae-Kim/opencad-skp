/**
 * SketchUp 파일 안의 그림 꺼내기(동기, 의존성 없음). 2021 이후는 꾸러미(ZIP) 안 파일, 2020 이하는 객체 직렬화 안의 CDib 기록이다.
 * 조사 기록(docs/formats/skp.md)에서 표본으로 본 자리만 쓴다:
 *   meta/model_thumbnail.png(·meta/preview_thumbnail.png) 모형 미리보기,
 *   materials/<재질 폴더>/(material.xml 말고) 무늬 그림 jpg/png — 폴더에 그림이 여럿이면(PBR 그림 등) material.xml이 가리키는 것,
 *   thumbnails/<컴포넌트>.png 컴포넌트 미리보기,
 *   scene_thumbnails/<장면>.png 장면 미리보기.
 * 그림 자체만 돌려준다(화면의 견본·목록용, 무늬 재질 그림은 skpToScene의 textures로 넘기면 3D에 입힌다).
 *
 * 2020 이하(src/mfcmodel.ts가 읽으며 모은 자리): 모형 미리보기, 재질 무늬(폴더 = 재질 열쇠), 컴포넌트 미리보기(CThumbnail),
 * 2020 장면 미리보기. 날 Windows DIB(아주 옛 파일)는 BMP 파일 머리를 붙여 브라우저가 그릴 수 있게 한다.
 *
 * 그림 꼴은 이름이 아니라 첫 바이트(PNG·JPEG·GIF·BMP·WebP 표지)로 가린다. 브라우저가 못 그리는 꼴은 건너뛴다.
 * 큰 파일·많은 파일에서 메모리가 터지지 않게 개수·한 장 크기·전체 크기 한도를 둔다(풀기 전에 중앙 목록의 크기로 거른다).
 */

import { readSkpHeader } from './header';
import { parseMaterialPbr, parseMaterialXml, pbrFiles, type SkpMaterialInfo, type SkpPbrRole } from './materials';
import type { MfcImageRef } from './mfcstate';
import { mfcImageRefs } from './mfcmodel';
import { findSkpZipItems, runZipReads, type ZipItem, type ZipReads } from './zip';

export interface SkpImage {
  /** 꾸러미 안 경로 */
  path: string;
  /** 표시 이름(파일 이름에서 확장자를 뺀 것, 무늬는 파일 이름) */
  name: string;
  /** image/png · image/jpeg · image/gif · image/bmp · image/webp */
  mime: string;
  bytes: Uint8Array;
}

export interface SkpImages {
  /** 모형 미리보기(meta/model_thumbnail.png, 없으면 meta/preview_thumbnail.png) */
  model?: SkpImage;
  /**
   * 재질 무늬 그림(폴더 = model.dat의 재질 이름 = meta.materialStats[].folder) — 폴더마다 하나(material.xml이 가리키는 것, 없으면 첫 그림).
   * 색 무늬 없는 PBR 재질은 PBR 그림이 아닌 그림(재질 미리보기)이고, 폴더 그림이 모두 PBR 그림이면 그 폴더는 없다(57차)
   */
  materials: (SkpImage & { folder: string })[];
  /** 컴포넌트 미리보기(name = 파일 이름 = 컴포넌트 정의 이름으로 보임) */
  components: SkpImage[];
  /** 장면 미리보기(name = 장면 이름으로 보임). 장면 카메라는 아직 읽지 못한다 */
  scenes: SkpImage[];
  /** 한도·모르는 꼴로 건너뛴 그림 수 */
  skipped: number;
  warnings: string[];
  /**
   * 무늬 재질의 PBR 그림(material.xml <mat:pbrMR>에서 켠 법선·거칠기·금속 그림 — 55차). 2021+ 꾸러미에서 무늬(색 그림)가 있는 재질(56차부터 색 무늬 없이 그림 한 장 크기가 있는 재질도, 57차부터 그림이 하나뿐인 재질 폴더도)만, 다른 그림을 다 넣은 뒤
   * 남은 한도 안에서. 그림 하나가 여러 쓰임이면 roles가 여럿. 없으면 칸이 없다(앱 워커는 화면에 넘기기 전에 이 칸을 뗀다 — 바이트는 장면 무늬가 든다).
   * skpFileToScene(앱 워커)은 61차부터 모형을 읽은 뒤 모형이 쓰는 재질(면 앞·뒤, 그룹·컴포넌트)의 PBR 그림만 꺼낸다(readSkpImages는 모두)
   */
  pbr?: (SkpImage & { folder: string; roles: SkpPbrRole[] })[];
  /** 한도로 넣지 못한 PBR 그림 수(경고 없이 — PBR 그림이 없으면 그 재질은 색 무늬만 그린다) */
  pbrSkipped?: number;
}

export interface SkpImageOptions {
  /** 그림 수 한도(모든 종류 합) */
  maxCount?: number;
  /** 한 장 크기 한도(풀었을 때 바이트) */
  maxBytesEach?: number;
  /** 전체 크기 한도(풀었을 때 바이트) */
  maxTotalBytes?: number;
  /**
   * 진행(0~1). 2020 이하는 그림 자리를 찾으려고 모형 전체를 읽으므로 오래 걸린다(그 모형은 바로 이어 부르는
   * skpToScene이 다시 읽지 않고 쓴다). 2021+ 꾸러미는 부르지 않는다
   */
  onProgress?: (fraction: number) => void;
}

export const MAX_IMAGE_COUNT = 600;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_TOTAL = 64 * 1024 * 1024;

/** 첫 바이트로 그림 꼴 가리기(모르면 null) */
export function imageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  return null;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tiff?|tga)$/i;
/** material.xml이 꾸러미 뿌리 꼴 경로로 그림을 가리키는지(77차 — 다른 재질 폴더의 그림을 함께 쓰는 재질, materials.ts SkpMaterialTexture.path) */
const SHARED_IMAGE = /\bpath="materials[\\/]/;

function stem(file: string): string {
  return file.replace(/\.[^./]+$/, '');
}

/**
 * 날 DIB(BITMAPINFOHEADER + 색 표 + 화소) → BMP 파일(14바이트 파일 머리를 붙인다). 머리를 모르면 null.
 * 화소 시작 = 파일 머리 + 정보 머리 + (BI_BITFIELDS 40바이트 머리면 가면 12바이트) + 색 표.
 */
export function dibToBmp(dib: Uint8Array): Uint8Array | null {
  if (dib.length < 40) return null;
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = dv.getUint32(0, true);
  const bits = dv.getUint16(14, true);
  const compression = dv.getUint32(16, true);
  const used = dv.getUint32(32, true);
  if (headerSize < 40 || headerSize > dib.length || ![1, 4, 8, 16, 24, 32].includes(bits)) return null;
  const palette = 4 * (used || (bits <= 8 ? 1 << bits : 0));
  const masks = compression === 3 && headerSize === 40 ? 12 : 0;
  const offset = 14 + headerSize + masks + palette;
  if (offset > 14 + dib.length) return null;
  const out = new Uint8Array(14 + dib.length);
  const ov = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  ov.setUint32(2, out.length, true);
  ov.setUint32(10, offset, true);
  out.set(dib, 14);
  return out;
}

/** 2020 이하: 모은 그림 자리 → 그림(한도·꼴 거르기는 꾸러미와 같다) */
function mfcImages(bytes: Uint8Array, refs: readonly MfcImageRef[], out: SkpImages, maxCount: number, maxEach: number, maxTotal: number): SkpImages {
  const order: Record<MfcImageRef['kind'], number> = { model: 0, scene: 1, material: 2, component: 3 };
  const seenFolders = new Set<string>();
  let count = 0;
  let total = 0;
  for (const ref of [...refs].sort((a, b) => order[a.kind] - order[b.kind])) {
    if (ref.kind === 'model' && out.model) continue;
    if (ref.kind === 'material' && (ref.folder === undefined || seenFolders.has(ref.folder))) continue;
    const size = ref.end - ref.start;
    if (count >= maxCount || size > maxEach || total + size > maxTotal || ref.end > bytes.length) {
      out.skipped++;
      continue;
    }
    const raw = bytes.subarray(ref.start, ref.end);
    let data: Uint8Array | null = imageMime(raw) ? raw.slice() : null;
    if (!data && (ref.dib || raw[0] === 40)) data = dibToBmp(raw);
    const mime = data && imageMime(data);
    if (!data || !mime) {
      out.skipped++;
      continue;
    }
    count++;
    total += data.length;
    const path = ref.path ?? `${ref.kind}/${ref.name}`;
    const img: SkpImage = { path, name: ref.name, mime, bytes: data };
    if (ref.kind === 'model') out.model = img;
    else if (ref.kind === 'material') {
      seenFolders.add(ref.folder!);
      out.materials.push({ ...img, folder: ref.folder! });
    } else if (ref.kind === 'component') out.components.push(img);
    else out.scenes.push(img);
  }
  if (out.skipped) out.warnings.push(`그림 ${out.skipped}개는 너무 크거나 많거나 모르는 꼴이라 건너뛰었습니다`);
  return out;
}

/** 파일 안 그림을 꺼낸다. SketchUp 파일이 아니면 빈 결과 */
export function readSkpImages(bytes: Uint8Array, opts: SkpImageOptions = {}): SkpImages {
  const out: SkpImages = { materials: [], components: [], scenes: [], skipped: 0, warnings: [] };
  const header = readSkpHeader(bytes);
  if (!header) return out;
  if (header.container === 'mfc')
    return mfcImages(
      bytes,
      mfcImageRefs(bytes, header, opts.onProgress),
      out,
      opts.maxCount ?? MAX_IMAGE_COUNT,
      opts.maxBytesEach ?? MAX_IMAGE_BYTES,
      opts.maxTotalBytes ?? MAX_IMAGE_TOTAL,
    );
  const found = findSkpZipItems(bytes, header.bodyOffset);
  const dir = found.items;
  if (!dir) return out;
  return runZipReads(zipImageReads(dir, opts, out), bytes);
}

type ImageKind = 'model' | 'preview' | 'material' | 'component' | 'scene' | 'pbr';

/** 꺼낼 그림 하나. rank: 같은 종류 안의 차례(작은 것이 먼저 — PBR 그림만 쓴다) */
interface ImageWant {
  item: ZipItem;
  kind: ImageKind;
  name: string;
  folder?: string;
  roles?: SkpPbrRole[];
  rank?: number;
}

/** 그림 한도(선택의 기본값을 채운 것) */
interface ImageLimits {
  maxCount: number;
  maxEach: number;
  maxTotal: number;
}

/**
 * 뒤로 미룬 PBR 그림 꺼내기(61차 — zipImageReads의 deferPbr가 받는다): PBR 그림 후보(넣을 차례 — 색 무늬 없는 재질의 그림이 먼저)와
 * 그 앞 그림까지 넣은 수·바이트(같은 한도를 이어 건다). pbrImageReads로 이어 꺼낸다
 */
export interface SkpPbrReads {
  readonly want: readonly ImageWant[];
  readonly count: number;
  readonly total: number;
  readonly limits: ImageLimits;
}

/** 이 그림을 넣으면 한도를 넘는지(꾸러미 목록의 크기로 — 받은 바이트의 크기는 받은 뒤 다시 본다) */
const overLimit = (w: ImageWant, count: number, total: number, l: ImageLimits): boolean =>
  count >= l.maxCount || w.item.size > l.maxEach || w.item.compressedSize > l.maxEach || total + w.item.size > l.maxTotal || !!w.item.truncated;

/**
 * 미리 읽기 차례 어림(48차): 그림마다 목록의 크기만큼 받는다고 보고 readWants와 같은 한도를 건다.
 * 재질 그림으로 이미 바란 항목을 다른 재질이 또 바라면 readWants처럼 다시 세지 않는다(77차)
 */
function planWants(wants: readonly ImageWant[], count: number, total: number, model: boolean, l: ImageLimits): ZipItem[] {
  const list: ZipItem[] = [];
  const material = new Set<ZipItem>();
  let n = count;
  let sum = total;
  for (const w of wants) {
    if (w.kind === 'material') {
      if (material.has(w.item)) continue;
      material.add(w.item);
    }
    if ((w.kind === 'preview' && model) || overLimit(w, n, sum, l)) continue;
    list.push(w.item);
    n++;
    sum += w.item.size;
    if (w.kind === 'model' || w.kind === 'preview') model = true;
  }
  return list;
}

/**
 * 그림을 차례대로 꺼내 out에 넣는다(한도·꼴 거르기). count·total은 앞서 넣은 그림 수·바이트, 넣은 뒤의 값을 돌려준다.
 * 재질 그림으로 이미 바란 항목을 다른 재질이 또 바라면(77차 — 다른 재질 폴더의 그림을 함께 쓰는 재질) 다시 읽지 않는다: 꺼냈으면 같은 바이트를 그 재질 폴더로 넣고
 * (수·바이트 한도에 다시 세지 않는다), 건너뛰었으면 그 재질도 그림 없이 둔다(건너뜀 수에 다시 세지 않는다)
 */
function* readWants(
  wants: readonly ImageWant[],
  count: number,
  total: number,
  l: ImageLimits,
  out: SkpImages,
): Generator<ZipItem, { count: number; total: number }, Uint8Array> {
  /** 재질 그림으로 바란 항목 → 꺼낸 그림(건너뛰었으면 null) */
  const got = new Map<ZipItem, SkpImage | null>();
  for (const w of wants) {
    if (w.kind === 'preview' && out.model) continue;
    if (w.kind === 'material' && got.has(w.item)) {
      const again = got.get(w.item);
      if (again) out.materials.push({ ...again, name: w.name, folder: w.folder! });
      continue;
    }
    // PBR 그림은 건너뛰어도 경고·건너뜀 수에 넣지 않는다(예전 그림·경고가 그대로 — 따로 센다)
    const miss = (): void => {
      if (w.kind === 'pbr') out.pbrSkipped = (out.pbrSkipped ?? 0) + 1;
      else out.skipped++;
      if (w.kind === 'material') got.set(w.item, null);
    };
    if (overLimit(w, count, total, l)) {
      miss();
      continue;
    }
    let data: Uint8Array;
    try {
      data = yield w.item;
    } catch {
      miss();
      continue;
    }
    const mime = imageMime(data);
    if (!mime || data.length > l.maxEach) {
      miss();
      continue;
    }
    count++;
    total += data.length;
    const img: SkpImage = { path: w.item.name, name: w.name, mime, bytes: data };
    if (w.kind === 'model' || w.kind === 'preview') out.model = img;
    else if (w.kind === 'pbr') (out.pbr ??= []).push({ ...img, folder: w.folder!, roles: w.roles! });
    else if (w.kind === 'material') {
      out.materials.push({ ...img, folder: w.folder! });
      got.set(w.item, img);
    }
    else if (w.kind === 'component') out.components.push(img);
    else out.scenes.push(img);
  }
  return { count, total };
}

/**
 * 2021+ 꾸러미 목록에서 그림을 꺼낸다(readSkpImages의 꾸러미 쪽). 항목 내용은 내어(yield) 받는다 — 파일 전체 바이트로도(runZipReads),
 * 필요한 자리만 읽는 곳으로도(src/range.ts) 같은 차례·같은 결과로 돈다.
 * plan을 주면 곧 내어 받을 항목 차례를 미리 알린다(48차 — 자리만 읽는 곳이 읽기를 앞질러 보내 둔다). 알린 차례는 어림이라(그림을 받아 봐야 아는
 * 한도·꼴은 그림 머리의 크기로 어림한다) 실제로 내어 받는 차례와 다를 수 있고, 그래도 결과는 같다.
 * deferPbr를 주면(61차 — skpFileToScene) PBR 그림(맨 뒤 차례)은 꺼내지 않고 그 후보와 한도 상태를 넘긴다 — 모형을 읽은 뒤 쓰는 재질의 것만
 * pbrImageReads로 꺼낸다. 다른 그림·경고는 같다(PBR 그림은 경고·건너뜀 수에 들지 않는다)
 */
export function* zipImageReads(
  dir: readonly ZipItem[],
  opts: SkpImageOptions = {},
  out: SkpImages = { materials: [], components: [], scenes: [], skipped: 0, warnings: [] },
  plan?: (items: readonly ZipItem[]) => void,
  deferPbr?: (later: SkpPbrReads) => void,
): ZipReads<SkpImages> {
  const limits: ImageLimits = {
    maxCount: opts.maxCount ?? MAX_IMAGE_COUNT,
    maxEach: opts.maxBytesEach ?? MAX_IMAGE_BYTES,
    maxTotal: opts.maxTotalBytes ?? MAX_IMAGE_TOTAL,
  };
  const want: ImageWant[] = [];
  /** 재질 폴더 → 그림 후보(꾸러미 차례)·material.xml */
  const folders = new Map<string, { images: ZipItem[]; xml?: ZipItem }>();
  for (const item of dir) {
    const n = item.name;
    if (n === 'meta/model_thumbnail.png') want.push({ item, kind: 'model', name: '모형 미리보기' });
    else if (n === 'meta/preview_thumbnail.png') want.push({ item, kind: 'preview', name: '모형 미리보기' });
    else {
      let m = /^materials\/(.+)\/([^/]+)$/.exec(n);
      if (m) {
        const folder = m[1]!;
        const file = m[2]!;
        let f = folders.get(folder);
        if (!f) folders.set(folder, (f = { images: [] }));
        if (file === 'material.xml') f.xml = item;
        else if (IMAGE_EXT.test(file)) f.images.push(item);
        continue;
      }
      m = /^thumbnails\/([^/]+)$/.exec(n);
      if (m && IMAGE_EXT.test(m[1]!)) {
        want.push({ item, kind: 'component', name: stem(m[1]!) });
        continue;
      }
      m = /^scene_thumbnails\/([^/]+)$/.exec(n);
      if (m && IMAGE_EXT.test(m[1]!)) want.push({ item, kind: 'scene', name: stem(m[1]!) });
    }
  }
  // 재질 폴더마다 그림 하나: 여럿이면 material.xml의 무늬 그림 이름과 같은 것.
  // 57차: 그림이 하나뿐인 폴더도 material.xml을 읽는다 — 그 그림이 PBR 그림(색 무늬 없는 재질의 법선 그림, 색 무늬와 같은 파일을 쓰는 거칠기 그림 등)일 수 있다
  // 77차: 그림이 없는 폴더도 읽는다 — 2021+ 꾸러미는 여러 재질이 같은 그림을 쓰면 그림을 한 재질 폴더에만 두고, 다른 재질의 material.xml은
  // 꾸러미 뿌리 꼴 경로(materials/<폴더>/<그림>)로 그 그림을 가리킨다(그 재질 폴더는 비었거나 미리보기 thumbnail.jpg·PBR 그림만 있음)
  const text = new TextDecoder('utf-8');
  const pickXml = (f: { images: ZipItem[]; xml?: ZipItem }): ZipItem | undefined => (f.xml && f.xml.size < 1 << 20 ? f.xml : undefined);
  plan?.([...folders.values()].map(pickXml).filter((x): x is ZipItem => !!x));
  const fileOf = (it: ZipItem): string => it.name.slice(it.name.lastIndexOf('/') + 1);
  /** 재질 폴더의 그림 항목(꾸러미 경로 → 항목) — material.xml이 다른 폴더의 그림을 가리킬 때 */
  const imageAt = new Map<string, ZipItem>();
  for (const f of folders.values()) for (const it of f.images) imageAt.set(it.name, it);
  for (const [folder, f] of folders) {
    const xml = pickXml(f);
    if (!f.images.length && !xml) continue;
    let pick: ZipItem | undefined = f.images[0];
    let info: SkpMaterialInfo | null = null;
    if (xml)
      try {
        const s = text.decode(yield xml);
        // 그림이 하나뿐이면 PBR 그림 파일이 있거나 다른 폴더 그림을 가리킬 때만 재질 정보를 다 푼다(고를 그림이 하나라 무늬 그림 이름이 필요 없다 —
        // 2025+ 재질은 거의 모두 꺼진 PBR 꼬리표를 둔다). 그림이 없는 폴더는 다른 폴더 그림을 가리킬 때만
        const shared = SHARED_IMAGE.test(s);
        if (f.images.length > 1 || shared || (f.images.length === 1 && pbrFiles(parseMaterialPbr(s)).length)) info = parseMaterialXml(s);
        const file = info?.texture?.file;
        const at = info?.texture?.path ? imageAt.get(info.texture.path) : undefined;
        const hit = at ?? (file ? f.images.find((it) => fileOf(it) === file) : undefined);
        if (hit) pick = hit;
        else if (!file && info?.pbr) {
          // 56차: 색 무늬 없는 PBR 재질의 견본은 PBR 그림(법선 그림 등)이 아닌 그림(재질 미리보기)으로.
          // 57차: 그런 그림이 없으면(폴더 그림이 모두 PBR 그림) 견본 그림을 두지 않는다 — 재질 목록은 재질 색을 보인다
          const maps = new Set(pbrFiles(info.pbr).map((x) => x[1]));
          pick = maps.size ? f.images.find((it) => !maps.has(fileOf(it))) : pick;
        }
      } catch {
        /* 첫 그림 */
      }
    if (pick) want.push({ item: pick, kind: 'material', name: fileOf(pick), folder });
    // 55차: 무늬(색 그림)가 있는 재질의 PBR 그림(법선·거칠기·금속) — 무늬 좌표는 색 무늬와 같다. 56차: 색 무늬 없이 PBR 그림만 있는 재질도
    // 그림 한 장 크기(<mat:pbrMR xScale yScale> — pbr.tile)가 있으면 넣는다(장면이 그 크기로 무늬 좌표만 만든다). 그림 하나가 여러 쓰임이면 한 번만 읽는다
    if (info?.texture || info?.pbr?.tile) {
      const roles = new Map<ZipItem, SkpPbrRole[]>();
      for (const [role, file] of pbrFiles(info.pbr)) {
        const hit = f.images.find((it) => fileOf(it) === file);
        if (!hit) continue;
        const list = roles.get(hit);
        if (list) list.push(role);
        else roles.set(hit, [role]);
      }
      // 색 무늬 없는 재질의 PBR 그림이 먼저(rank 0 — 그 재질에는 이 그림이 유일한 결이다), 무늬 재질의 PBR 그림은 그다음
      for (const [item, r] of roles) want.push({ item, kind: 'pbr', name: fileOf(item), folder, roles: r, rank: info.texture ? 1 : 0 });
    }
  }
  // 한도 안에서 먼저 넣을 차례: 모형 → 장면 → 재질 → 컴포넌트 → PBR 그림(55차 — 예전 그림을 그대로 넣고 남은 한도만 쓴다)
  const order: Record<ImageKind, number> = { model: 0, preview: 1, scene: 2, material: 3, component: 4, pbr: 5 };
  want.sort((a, b) => order[a.kind] - order[b.kind] || (a.rank ?? 0) - (b.rank ?? 0));
  // 61차: PBR 그림을 미루면 그 앞 그림만 꺼낸다(PBR 그림은 맨 뒤 차례라 앞 그림의 차례·한도는 같다)
  const first = deferPbr ? want.filter((w) => w.kind !== 'pbr') : want;
  if (plan) plan(planWants(first, 0, 0, !!out.model, limits));
  const at = yield* readWants(first, 0, 0, limits, out);
  if (deferPbr) deferPbr({ want: want.filter((w) => w.kind === 'pbr'), count: at.count, total: at.total, limits });
  if (out.skipped) out.warnings.push(`그림 ${out.skipped}개는 너무 크거나 많거나 모르는 꼴이라 건너뛰었습니다`);
  return out;
}

/**
 * 미룬 PBR 그림 꺼내기(61차 — zipImageReads의 deferPbr로 받은 later): keep이 참인 재질 폴더의 그림만, 미루지 않았을 때와 같은 차례로
 * 앞 그림까지 넣은 수·바이트에서 같은 한도를 이어 건다. 고르지 않은 폴더의 그림은 읽지 않고 pbrSkipped에도 세지 않는다(한도는 꺼낸 그림만 쓴다).
 * 그림은 out.pbr에 더한다
 */
export function* pbrImageReads(later: SkpPbrReads, keep: (folder: string) => boolean, out: SkpImages, plan?: (items: readonly ZipItem[]) => void): ZipReads<SkpImages> {
  const wants = later.want.filter((w) => keep(w.folder!));
  if (plan) plan(planWants(wants, later.count, later.total, true, later.limits));
  yield* readWants(wants, later.count, later.total, later.limits, out);
  return out;
}
