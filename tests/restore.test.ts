/**
 * 문맥 복구 때 쥐어 둔 색 바꾼 무늬 다시 손질하기(src/worker/textures.ts recolorTextures — 29차, recolor.worker.ts가 부른다):
 * 화면이 장면에서 뺀 원래 그림 바이트(Blob)를 해석기가 넣은 꼴(그림 머리의 크기)로 되돌려 처음 열 때와 같은 손질을 한다.
 * Node에는 그림 풀기가 없어 가짜 createImageBitmap·OffscreenCanvas로 차례(줄이는 크기·색 바꾸기·견본 없음)와 결과 화소를 견준다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../src/index';
import { prepareRelease } from '../src/app/release';
import { heldAsTexture, prepareSceneTextures, recolorTextures } from '../src/worker/textures';

/** 그림 머리만 있는 PNG(가로·세로·색 형식) — 해석기·코어 imageInfo가 읽는 자리 */
function pngHead(w: number, h: number, colorType = 2): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[24] = 8;
  b[25] = colorType;
  return b;
}

const info = (id: string, colorize = true): SkpTextureInfo => ({
  id,
  material: id,
  folder: id,
  path: `${id}.png`,
  tile: [1, 1],
  alphaPossible: false,
  ...(colorize ? { colorize: { type: 'tint' as const, color: [200, 100, 50] as [number, number, number] } } : {}),
});

interface FakeBitmap {
  width: number;
  height: number;
  px: Uint8ClampedArray | null;
  close(): void;
}

/**
 * 가짜 그림 풀기: 그림 머리의 크기로 풀고(바이트 첫 값으로 화소를 채운다), 주면 그 크기로 줄인다. 부른 선택을 적어 둔다.
 * OffscreenCanvas는 그린 그림의 화소를 들고, transferToImageBitmap은 그 화소를 담은 그림을 준다
 */
function fakeDecode(): { calls: { w: number; h: number; opts: ImageBitmapOptions | undefined }[]; pngs: number } {
  const log = { calls: [] as { w: number; h: number; opts: ImageBitmapOptions | undefined }[], pngs: 0 };
  const bitmap = (width: number, height: number, px: Uint8ClampedArray | null): FakeBitmap => ({ width, height, px, close: () => undefined });
  vi.stubGlobal('createImageBitmap', async (src: Blob | FakeBitmap, opts?: ImageBitmapOptions) => {
    let w: number, h: number, fill: number;
    if (src instanceof Blob) {
      const b = new Uint8Array(await src.arrayBuffer());
      const dv = new DataView(b.buffer);
      w = dv.getUint32(16);
      h = dv.getUint32(20);
      fill = b[30]!;
    } else {
      w = src.width;
      h = src.height;
      fill = src.px?.[0] ?? 0;
    }
    log.calls.push({ w, h, opts });
    const ow = opts?.resizeWidth ?? w, oh = opts?.resizeHeight ?? h;
    return bitmap(ow, oh, new Uint8ClampedArray(ow * oh * 4).fill(fill));
  });
  class Canvas {
    px: Uint8ClampedArray;
    constructor(
      public width: number,
      public height: number,
    ) {
      this.px = new Uint8ClampedArray(width * height * 4);
    }
    getContext(): unknown {
      return {
        drawImage: (b: FakeBitmap) => {
          if (b.px && b.px.length === this.px.length) this.px.set(b.px);
        },
        getImageData: () => ({ data: this.px.slice(), width: this.width, height: this.height }),
        putImageData: (img: { data: Uint8ClampedArray }) => this.px.set(img.data),
      };
    }
    transferToImageBitmap(): FakeBitmap {
      return bitmap(this.width, this.height, this.px.slice());
    }
    async convertToBlob(): Promise<Blob> {
      log.pngs++;
      return new Blob([new Uint8Array([1])]);
    }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas);
  return log;
}

/** 처음 열 때의 장면(해석기 꼴 — 원래 그림 크기와 바이트) */
function openedScene(): Scene3d {
  const big = pngHead(4096, 1024);
  big[30] = 90;
  const small = pngHead(300, 200);
  small[30] = 40;
  return {
    name: 's',
    units: 'mm',
    meshes: [],
    lines: [],
    textures: [
      { id: 'a', data: big, mime: 'image/png', width: 4096, height: 1024 },
      { id: 'b', data: small, mime: 'image/png', width: 300, height: 200 },
    ],
    meta: { textures: [info('a'), info('b')] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('쥐어 둔 무늬를 해석기 꼴로', () => {
  it('바이트·꼴과 그림 머리의 크기(처음 손질이 장면 무늬의 크기를 올린 그림 크기로 바꿔 두므로)', async () => {
    const data = pngHead(4096, 1024);
    const t = await heldAsTexture({ id: 'x', blob: new Blob([data], { type: 'image/png' }) });
    expect(t).toMatchObject({ id: 'x', mime: 'image/png', width: 4096, height: 1024 });
    expect([...t.data!]).toEqual([...data]);
    const odd = await heldAsTexture({ id: 'y', blob: new Blob([new Uint8Array([1, 2, 3])]) });
    expect(odd).toEqual({ id: 'y', data: new Uint8Array([1, 2, 3]) });
  });
});

describe('되찾을 때 다시 손질하기', () => {
  it('처음 열 때와 같은 크기로 줄이고 같은 색으로 바꾼다(견본 그림은 만들지 않는다)', async () => {
    const log = fakeDecode();
    const scene = openedScene();
    const prep = await prepareSceneTextures(scene, 2048);
    expect(prep).toMatchObject({ decoded: 2, colorized: 2, dropped: 0 });
    expect(log.pngs).toBe(2);
    const first = log.calls.map((c) => c.opts?.resizeWidth ?? null);
    const opened = (scene.textures ?? []).map((t) => ({ id: t.id, w: t.bitmap!.width, h: t.bitmap!.height, px: [...(t.bitmap as unknown as FakeBitmap).px!.slice(0, 8)] }));
    expect(opened.map((o) => [o.w, o.h])).toEqual([
      [2048, 512],
      [300, 200],
    ]);
    // 장면 무늬의 크기는 올린 그림 크기로 바뀌었다 — 이것으로 풀면 크기를 모르고 풀어 차례가 달라진다
    expect(scene.textures![0]).toMatchObject({ width: 2048, height: 512 });
    const held = prepareRelease(scene);
    expect(held.map((h) => h.id)).toEqual(['a', 'b']);
    log.calls.length = 0;
    const res = await recolorTextures(held, 2048);
    expect(log.calls.map((c) => c.opts?.resizeWidth ?? null)).toEqual(first);
    expect(log.pngs).toBe(2);
    expect(res.textures.map((t) => ({ id: t.id, w: t.width, h: t.height, px: [...(t.bitmap as unknown as FakeBitmap).px!.slice(0, 8)] }))).toEqual(opened);
    // 색을 바꾼 화소(원래 90·40 그대로가 아니다)
    expect(opened[0]!.px.slice(0, 3)).not.toEqual([90, 90, 90]);
  });

  it('풀지 못한 무늬는 빼고 나머지만 준다', async () => {
    fakeDecode();
    const scene = openedScene();
    await prepareSceneTextures(scene, 2048);
    const held = prepareRelease(scene);
    const bad = { ...held[0]!, blob: new Blob([new Uint8Array([9])], { type: 'image/png' }) };
    vi.stubGlobal('createImageBitmap', async (src: Blob) => {
      if ((await src.arrayBuffer()).byteLength < 8) throw new Error('풀지 못함');
      return { width: 4, height: 4, close: () => undefined };
    });
    const res = await recolorTextures([bad, held[1]!], 2048);
    expect(res.textures.map((t) => t.id)).toEqual(['b']);
  });

  it('그림을 풀 수 없는 곳에서는 아무것도 주지 않는다(화면은 그 무늬를 평균색으로 둔다)', async () => {
    const h = { id: 'a', blob: new Blob([pngHead(8, 8)], { type: 'image/png' }), info: info('a') };
    expect((await recolorTextures([h], 1024)).textures).toEqual([]);
  });
});
