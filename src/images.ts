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
import { parseMaterialXml } from './materials';
import type { MfcImageRef } from './mfcstate';
import { mfcImageRefs } from './mfcmodel';
import { findSkpZipItems, readZipItem, type ZipItem } from './zip';

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
  /** 재질 무늬 그림(폴더 = model.dat의 재질 이름 = meta.materialStats[].folder) — 폴더마다 하나(material.xml이 가리키는 것, 없으면 첫 그림) */
  materials: (SkpImage & { folder: string })[];
  /** 컴포넌트 미리보기(name = 파일 이름 = 컴포넌트 정의 이름으로 보임) */
  components: SkpImage[];
  /** 장면 미리보기(name = 장면 이름으로 보임). 장면 카메라는 아직 읽지 못한다 */
  scenes: SkpImage[];
  /** 한도·모르는 꼴로 건너뛴 그림 수 */
  skipped: number;
  warnings: string[];
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
  const maxCount = opts.maxCount ?? MAX_IMAGE_COUNT;
  const maxEach = opts.maxBytesEach ?? MAX_IMAGE_BYTES;
  const maxTotal = opts.maxTotalBytes ?? MAX_IMAGE_TOTAL;

  type Kind = 'model' | 'preview' | 'material' | 'component' | 'scene';
  const want: { item: ZipItem; kind: Kind; name: string; folder?: string }[] = [];
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
  // 재질 폴더마다 그림 하나: 여럿이면 material.xml의 무늬 그림 이름과 같은 것
  const text = new TextDecoder('utf-8');
  for (const [folder, f] of folders) {
    if (!f.images.length) continue;
    let pick = f.images[0]!;
    if (f.images.length > 1 && f.xml && f.xml.size < 1 << 20)
      try {
        const file = parseMaterialXml(text.decode(readZipItem(bytes, f.xml)))?.texture?.file;
        const hit = file ? f.images.find((it) => it.name.slice(it.name.lastIndexOf('/') + 1) === file) : undefined;
        if (hit) pick = hit;
      } catch {
        /* 첫 그림 */
      }
    want.push({ item: pick, kind: 'material', name: pick.name.slice(pick.name.lastIndexOf('/') + 1), folder });
  }
  // 한도 안에서 먼저 넣을 차례: 모형 → 장면 → 재질 → 컴포넌트
  const order: Record<Kind, number> = { model: 0, preview: 1, scene: 2, material: 3, component: 4 };
  want.sort((a, b) => order[a.kind] - order[b.kind]);
  let count = 0;
  let total = 0;
  for (const w of want) {
    if (w.kind === 'preview' && out.model) continue;
    if (count >= maxCount || w.item.size > maxEach || w.item.compressedSize > maxEach || total + w.item.size > maxTotal || w.item.truncated) {
      out.skipped++;
      continue;
    }
    let data: Uint8Array;
    try {
      data = readZipItem(bytes, w.item);
    } catch {
      out.skipped++;
      continue;
    }
    const mime = imageMime(data);
    if (!mime || data.length > maxEach) {
      out.skipped++;
      continue;
    }
    count++;
    total += data.length;
    const img: SkpImage = { path: w.item.name, name: w.name, mime, bytes: data };
    if (w.kind === 'model' || w.kind === 'preview') out.model = img;
    else if (w.kind === 'material') out.materials.push({ ...img, folder: w.folder! });
    else if (w.kind === 'component') out.components.push(img);
    else out.scenes.push(img);
  }
  if (out.skipped) out.warnings.push(`그림 ${out.skipped}개는 너무 크거나 많거나 모르는 꼴이라 건너뛰었습니다`);
  return out;
}
