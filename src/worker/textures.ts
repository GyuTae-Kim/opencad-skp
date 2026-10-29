/**
 * 해석 워커의 무늬 손질: 해석기가 장면에 넣은 무늬 그림(scene.textures, meta.textures) 가운데
 *   - 색을 바꾼 무늬(재질 type 2)는 그림을 풀어 colorize.ts 규칙으로 화소 색을 바꾸고 ImageBitmap으로 넘긴다
 *     (재질 목록 견본도 바꾼 색이 되게 작은 PNG를 함께 만든다).
 *   - 투명 화소를 담을 수 있는 꼴(PNG 알파 등)은 풀어서 실제로 투명 화소를 쓰는지 재고, 쓰면 alpha를 켜고 푼 그림을 넘긴다.
 *   - 나머지(JPEG·알파 없는 PNG)는 바이트 그대로 둔다(뷰어 코어가 풀면서 줄인다).
 * 푸는 그림은 긴 변 limit 안으로 줄인다. OffscreenCanvas가 없는 곳에서는 알파는 끈 채로 두고,
 * 색을 바꾼 무늬는 그림 대신 재질 색(평균색)으로 칠하게 무늬를 뺀다(원래 색 그림이 보이면 틀리므로).
 * 브라우저 API에만 기대므로 순수 부분(dropTexture·needsDecode·usesAlpha)만 Node 시험에서 확인한다.
 */
import type { Scene3d, Texture3d } from 'opencad-viewer3d/types';
import { fitSize } from 'opencad-viewer3d/texture';
import { colorizeRgba } from '../colorize';
import type { SkpTextureInfo } from '../index';

/** 이 알파 아래 화소가 있으면 투명 화소를 쓰는 그림으로 본다 */
const ALPHA_CUT = 250;
/** 색을 바꾼 무늬의 견본 그림 긴 변(화소) */
const SWATCH_SIDE = 128;

export interface TexturePrepResult {
  /** 워커에서 푼 그림 수 */
  decoded: number;
  /** 색을 바꾼 그림 수 */
  colorized: number;
  /** 투명 화소를 쓰는 그림 수 */
  alpha: number;
  /** 풀지 못하거나 색을 바꿀 수 없어 뺀 무늬 수(그 그물은 평균색) */
  dropped: number;
  /** 색을 바꾼 무늬의 견본 PNG(재질 폴더 → 바이트) — 재질 목록 견본을 바꿀 때 */
  swatches: Map<string, Uint8Array>;
}

/** 무늬를 장면에서 뺀다: 그 무늬를 쓰던 그물은 무늬 좌표도 지워 평균색으로 칠한다 */
export function dropTexture(scene: Scene3d, id: string): void {
  if (!scene.textures) return;
  scene.textures = scene.textures.filter((t) => t.id !== id);
  for (const m of scene.meshes) {
    if (m.texture === id) {
      delete m.texture;
      delete m.uvs;
    }
    if (m.backTexture === id) {
      delete m.backTexture;
      delete m.backUvs;
    }
  }
  const infos = (scene.meta?.textures ?? []) as SkpTextureInfo[];
  if (scene.meta) scene.meta.textures = infos.filter((t) => t.id !== id);
  const stats = scene.meta?.materialStats as { texture?: string }[] | undefined;
  for (const s of stats ?? []) if (s.texture === id) delete s.texture;
  if (!scene.textures.length) {
    delete scene.textures;
    if (scene.meta) delete scene.meta.textures;
  }
}

/** 워커에서 풀어야 하는 무늬인지(색 바꾸기 또는 알파 재기) */
export function needsDecode(info: SkpTextureInfo | undefined): boolean {
  return !!info && (!!info.colorize || info.alphaPossible);
}

/** RGBA 화소에 투명 화소(알파 < ALPHA_CUT)가 있는지 */
export function usesAlpha(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i]! < ALPHA_CUT) return true;
  return false;
}

const canDecode = (): boolean => typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function';

/** 무늬 하나 풀기 → 손질한 ImageBitmap(보통 방향) 또는 null(손질할 것이 없음) */
async function prepOne(t: Texture3d, info: SkpTextureInfo, limit: number): Promise<{ bitmap: ImageBitmap | null; alpha: boolean; colorized: boolean; swatch?: Uint8Array }> {
  const blob = new Blob([t.data as Uint8Array<ArrayBuffer>], { type: t.mime ?? 'application/octet-stream' });
  const base: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const fit = t.width && t.height ? fitSize(t.width, t.height, limit) : null;
  let bmp = await createImageBitmap(blob, fit ? { ...base, resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: 'high' } : base);
  const later = fitSize(bmp.width, bmp.height, limit);
  if (later) {
    const small = await createImageBitmap(bmp, { ...base, resizeWidth: later.width, resizeHeight: later.height, resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  const w = bmp.width, h = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bmp.close();
    throw new Error('2D 그리기 문맥이 없습니다');
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const alpha = info.alphaPossible && usesAlpha(img.data);
  let swatch: Uint8Array | undefined;
  if (info.colorize) {
    colorizeRgba(img.data, info.colorize);
    ctx.putImageData(img, 0, 0);
    try {
      const k = Math.min(1, SWATCH_SIDE / Math.max(w, h));
      const sc = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      sc.getContext('2d')?.drawImage(canvas, 0, 0, sc.width, sc.height);
      swatch = new Uint8Array(await (await sc.convertToBlob({ type: 'image/png' })).arrayBuffer());
    } catch {
      /* 견본은 원래 그림 그대로 */
    }
  }
  if (!alpha && !info.colorize) return { bitmap: null, alpha: false, colorized: false };
  const out: { bitmap: ImageBitmap; alpha: boolean; colorized: boolean; swatch?: Uint8Array } = { bitmap: canvas.transferToImageBitmap(), alpha, colorized: !!info.colorize };
  if (swatch) out.swatch = swatch;
  return out;
}

/**
 * 장면의 무늬 손질(위 설명). 손질한 무늬는 bitmap·크기·alpha를 채우고 그림 파일 바이트(data)는 뺀다 — 뷰어 코어는 bitmap이 있으면 그것만 풀고,
 * 재질 목록 견본은 같은 바이트를 images에서 따로 받는다(23차 — 화면이 이 바이트를 끝까지 쥐지 않게). onEach는 무늬 하나를 마칠 때마다(진행 표시용).
 */
export async function prepareSceneTextures(scene: Scene3d, limit: number, onEach?: (done: number, total: number) => void): Promise<TexturePrepResult> {
  const res: TexturePrepResult = { decoded: 0, colorized: 0, alpha: 0, dropped: 0, swatches: new Map() };
  const infos = new Map(((scene.meta?.textures ?? []) as SkpTextureInfo[]).map((t) => [t.id, t] as const));
  const list = [...(scene.textures ?? [])].filter((t) => needsDecode(infos.get(t.id)));
  const ok = canDecode();
  let done = 0;
  for (const t of list) {
    const info = infos.get(t.id)!;
    if (!ok || !t.data) {
      if (info.colorize) {
        dropTexture(scene, t.id);
        res.dropped++;
      }
    } else
      try {
        const r = await prepOne(t, info, limit);
        res.decoded++;
        if (r.bitmap) {
          t.bitmap = r.bitmap;
          t.width = r.bitmap.width;
          t.height = r.bitmap.height;
          delete t.data;
        }
        if (r.alpha) {
          t.alpha = true;
          res.alpha++;
        }
        if (r.colorized) res.colorized++;
        if (r.swatch) res.swatches.set(info.folder, r.swatch);
      } catch {
        dropTexture(scene, t.id);
        res.dropped++;
      }
    onEach?.(++done, list.length);
  }
  if (res.dropped) (scene.warnings ??= []).push(`무늬 그림 ${res.dropped}개는 풀거나 색을 바꾸지 못해 평균색으로 그렸습니다`);
  return res;
}
