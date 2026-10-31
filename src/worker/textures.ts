/**
 * 해석 워커의 무늬 손질: 해석기가 장면에 넣은 무늬 그림(scene.textures, meta.textures) 가운데
 *   - 색을 바꾼 무늬(재질 type 2)는 그림을 풀어 colorize.ts 규칙으로 화소 색을 바꾸고 ImageBitmap으로 넘긴다
 *     (재질 목록 견본도 바꾼 색이 되게 작은 PNG를 함께 만든다).
 *   - 투명 화소를 담을 수 있는 꼴(PNG 알파 등)은 풀어서 실제로 투명 화소를 쓰는지 재고, 쓰면 alpha를 켜고 푼 그림을 넘긴다.
 *   - 나머지(JPEG·알파 없는 PNG)는 바이트 그대로 둔다(뷰어 코어가 풀면서 줄인다).
 * 푸는 그림은 긴 변 limit 안으로 줄인다. OffscreenCanvas가 없는 곳에서는 알파는 끈 채로 두고,
 * 색을 바꾼 무늬는 그림 대신 재질 색(평균색)으로 칠하게 무늬를 뺀다(원래 색 그림이 보이면 틀리므로).
 * 브라우저 API에만 기대므로 Node 시험은 순수 부분(dropTexture·needsDecode·usesAlpha)과 가짜 그림 풀기로 차례를 본다.
 * 29차: 큰 모형의 문맥 복구는 화면이 쥐어 둔 색 바꾼 무늬의 원래 그림 바이트만 받아(recolor.worker.ts) 처음 열 때와 같은 손질로 다시 그림을 만든다
 * (recolorTextures — 그림 크기는 해석기처럼 그림 머리에서 읽는다. 처음 손질이 장면 무늬의 크기를 올린 그림 크기로 바꿔 두므로).
 * 33차: 처음 열 때 이 손질이 해석 끝의 큰 몫이었다(165 MB 표본 1.7초 — 색 바꾸기 계산과 그림 풀기를 기다리는 동안). 색 바꾸기는 같은 색 화소를
 * 기억해 다시 쓰고(colorize.ts), 무늬를 손질하는 동안 다음 무늬를 미리 하나 풀며, 견본 PNG 굳히기는 끝에 모아 기다린다(결과 그림·견본은 같다).
 */
import type { Scene3d, Texture3d } from 'opencad-viewer3d/types';
import { fitSize, imageInfo } from 'opencad-viewer3d/texture';
import { colorizeRgba } from '../colorize';
import type { SkpTextureInfo } from '../index';
import type { HeldTexture, RecolorResult } from '../app/protocol';

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

/** 무늬 하나 풀기(긴 변 limit 안으로 줄여). 그림 풀기는 브라우저가 다른 스레드에서 하므로 앞 무늬를 손질하는 동안 미리 풀어 둔다 */
async function decodeTexture(t: Texture3d, limit: number): Promise<ImageBitmap> {
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
  return bmp;
}

/**
 * 푼 무늬 하나 손질 → 손질한 ImageBitmap(보통 방향) 또는 null(손질할 것이 없음). swatches가 false면 견본 그림을 만들지 않는다.
 * 견본 PNG는 굳히기(convertToBlob)를 기다리지 않고 약속으로 준다(못 만들면 undefined — 견본은 원래 그림 그대로)
 */
function prepDecoded(
  bmp: ImageBitmap,
  info: SkpTextureInfo,
  swatches: boolean,
): { bitmap: ImageBitmap | null; alpha: boolean; colorized: boolean; swatch?: Promise<Uint8Array | undefined> } {
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
  let swatch: Promise<Uint8Array | undefined> | undefined;
  if (info.colorize) {
    colorizeRgba(img.data, info.colorize);
    ctx.putImageData(img, 0, 0);
    if (swatches)
      try {
        const k = Math.min(1, SWATCH_SIDE / Math.max(w, h));
        const sc = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
        sc.getContext('2d')?.drawImage(canvas, 0, 0, sc.width, sc.height);
        swatch = sc
          .convertToBlob({ type: 'image/png' })
          .then(async (b) => new Uint8Array(await b.arrayBuffer()))
          .catch(() => undefined);
      } catch {
        /* 견본은 원래 그림 그대로 */
      }
  }
  if (!alpha && !info.colorize) return { bitmap: null, alpha: false, colorized: false };
  const out: { bitmap: ImageBitmap; alpha: boolean; colorized: boolean; swatch?: Promise<Uint8Array | undefined> } = { bitmap: canvas.transferToImageBitmap(), alpha, colorized: !!info.colorize };
  if (swatch) out.swatch = swatch;
  return out;
}

/**
 * 장면의 무늬 손질(위 설명). 손질한 무늬는 bitmap·크기·alpha를 채운다(바이트 data는 견본용 그림과 같은 배열이라 그대로 둔다).
 * onEach는 무늬 하나를 마칠 때마다(진행 표시용). swatches: false면 색 바꾼 무늬의 견본 그림을 만들지 않는다(문맥 복구 — 29차).
 */
export async function prepareSceneTextures(
  scene: Scene3d,
  limit: number,
  onEach?: (done: number, total: number) => void,
  opts: { swatches?: boolean } = {},
): Promise<TexturePrepResult> {
  const res: TexturePrepResult = { decoded: 0, colorized: 0, alpha: 0, dropped: 0, swatches: new Map() };
  const infos = new Map(((scene.meta?.textures ?? []) as SkpTextureInfo[]).map((t) => [t.id, t] as const));
  const list = [...(scene.textures ?? [])].filter((t) => needsDecode(infos.get(t.id)));
  const swatches = opts.swatches !== false;
  const ok = canDecode();
  // 33차: 무늬를 손질하는 동안 다음 무늬를 미리 하나 풀어 두고(그림 풀기는 다른 스레드), 견본 PNG는 끝에 모아 기다린다 — 무늬마다 하는 일·결과는 같다
  const decode = (t: Texture3d | undefined): Promise<ImageBitmap> | null => {
    if (!ok || !t?.data) return null;
    const p = decodeTexture(t, limit);
    // 기다릴 때 다시 던진다(처리되지 않은 거부로 남지 않게)
    p.catch(() => undefined);
    return p;
  };
  const swatchOf: { folder: string; png: Promise<Uint8Array | undefined> }[] = [];
  let next = decode(list[0]);
  let done = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i]!;
    const info = infos.get(t.id)!;
    const cur = next;
    next = decode(list[i + 1]);
    if (!cur) {
      if (info.colorize) {
        dropTexture(scene, t.id);
        res.dropped++;
      }
    } else
      try {
        const r = prepDecoded(await cur, info, swatches);
        res.decoded++;
        if (r.bitmap) {
          t.bitmap = r.bitmap;
          t.width = r.bitmap.width;
          t.height = r.bitmap.height;
        }
        if (r.alpha) {
          t.alpha = true;
          res.alpha++;
        }
        if (r.colorized) res.colorized++;
        if (r.swatch) swatchOf.push({ folder: info.folder, png: r.swatch });
      } catch {
        dropTexture(scene, t.id);
        res.dropped++;
      }
    onEach?.(++done, list.length);
  }
  // 견본은 무늬 차례대로 넣는다(굳히기가 끝난 차례와 상관없이)
  const pngs = await Promise.all(swatchOf.map((s) => s.png));
  swatchOf.forEach((s, k) => {
    const png = pngs[k];
    if (png) res.swatches.set(s.folder, png);
  });
  if (res.dropped) (scene.warnings ??= []).push(`무늬 그림 ${res.dropped}개는 풀거나 색을 바꾸지 못해 평균색으로 그렸습니다`);
  return res;
}

/**
 * 쥐어 둔 무늬 하나를 해석기가 장면에 넣은 꼴로(그림 바이트·꼴, 그림 머리의 크기 — src/index.ts와 같은 imageInfo).
 * 처음 손질은 이 꼴에서 시작했으므로 같은 한도로 손질하면 같은 그림이 나온다
 */
export async function heldAsTexture(h: Pick<HeldTexture, 'id' | 'blob'>): Promise<Texture3d> {
  const data = new Uint8Array(await h.blob.arrayBuffer());
  const t: Texture3d = { id: h.id, data };
  if (h.blob.type) t.mime = h.blob.type;
  const head = imageInfo(data);
  if (head?.width && head.height) {
    t.width = head.width;
    t.height = head.height;
  }
  return t;
}

/**
 * 문맥 복구(29차): 쥐어 둔 색 바꾼 무늬를 처음 열 때와 같은 손질(prepareSceneTextures — 견본은 빼고)로 다시 그림을 만든다.
 * 하나씩 풀어 워커가 그림 바이트를 한 장씩만 든다. 풀지 못한 무늬는 빠진다(화면은 그 무늬를 평균색으로 둔다)
 */
export async function recolorTextures(list: readonly HeldTexture[], limit: number): Promise<RecolorResult> {
  const t0 = performance.now();
  const out: RecolorResult['textures'] = [];
  for (const h of list) {
    const scene: Scene3d = { name: '', units: 'unknown', meshes: [], lines: [], textures: [await heldAsTexture(h)], meta: { textures: [h.info] } };
    await prepareSceneTextures(scene, limit, undefined, { swatches: false });
    const t = scene.textures?.[0];
    if (t?.bitmap) out.push({ id: h.id, bitmap: t.bitmap, width: t.bitmap.width, height: t.bitmap.height });
  }
  return { textures: out, ms: performance.now() - t0 };
}
