/**
 * SketchUp 2021 이후 꾸러미(ZIP) 안의 그림 꺼내기(동기, 의존성 없음).
 * 조사 기록(docs/formats/skp.md)에서 표본으로 본 자리만 쓴다:
 *   meta/model_thumbnail.png(·meta/preview_thumbnail.png) 모형 미리보기,
 *   materials/<재질 폴더>/(material.xml 말고) 무늬 그림 jpg/png,
 *   thumbnails/<컴포넌트>.png 컴포넌트 미리보기,
 *   scene_thumbnails/<장면>.png 장면 미리보기.
 * 무늬 좌표(UV)나 장면 카메라는 아직 모르므로 그림 자체만 돌려준다(화면의 견본·목록용).
 *
 * 그림 꼴은 이름이 아니라 첫 바이트(PNG·JPEG·GIF·BMP·WebP 표지)로 가린다. 브라우저가 못 그리는 꼴은 건너뛴다.
 * 큰 파일·많은 파일에서 메모리가 터지지 않게 개수·한 장 크기·전체 크기 한도를 둔다(풀기 전에 중앙 목록의 크기로 거른다).
 */

import { readSkpHeader } from './header';
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
  /** 재질 무늬 그림(폴더 = model.dat의 재질 이름 = meta.materialStats[].folder) — 폴더마다 첫 그림 하나 */
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

/** 꾸러미 안 그림을 꺼낸다. SketchUp 2021 이후 파일이 아니면 빈 결과 */
export function readSkpImages(bytes: Uint8Array, opts: SkpImageOptions = {}): SkpImages {
  const out: SkpImages = { materials: [], components: [], scenes: [], skipped: 0, warnings: [] };
  const header = readSkpHeader(bytes);
  if (!header || header.container !== 'zip') return out;
  const found = findSkpZipItems(bytes, header.bodyOffset);
  const dir = found.items;
  if (!dir) return out;
  const maxCount = opts.maxCount ?? MAX_IMAGE_COUNT;
  const maxEach = opts.maxBytesEach ?? MAX_IMAGE_BYTES;
  const maxTotal = opts.maxTotalBytes ?? MAX_IMAGE_TOTAL;

  type Kind = 'model' | 'preview' | 'material' | 'component' | 'scene';
  const want: { item: ZipItem; kind: Kind; name: string; folder?: string }[] = [];
  const seenFolders = new Set<string>();
  for (const item of dir) {
    const n = item.name;
    if (n === 'meta/model_thumbnail.png') want.push({ item, kind: 'model', name: '모형 미리보기' });
    else if (n === 'meta/preview_thumbnail.png') want.push({ item, kind: 'preview', name: '모형 미리보기' });
    else {
      let m = /^materials\/(.+)\/([^/]+)$/.exec(n);
      if (m) {
        const folder = m[1]!;
        const file = m[2]!;
        if (file === 'material.xml' || !IMAGE_EXT.test(file) || seenFolders.has(folder)) continue;
        seenFolders.add(folder);
        want.push({ item, kind: 'material', name: file, folder });
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
