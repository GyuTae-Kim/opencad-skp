/**
 * 문맥 복구 때 쥐어 둔 색 바꾼 무늬 다시 손질하기(src/worker/textures.ts recolorTextures — 29차, recolor.worker.ts가 부른다):
 * 화면이 장면에서 뺀 원래 그림 바이트(Blob)를 해석기가 넣은 꼴(그림 머리의 크기)로 되돌려 처음 열 때와 같은 손질을 한다.
 * Node에는 그림 풀기가 없어 가짜 createImageBitmap·OffscreenCanvas로 차례(줄이는 크기·색 바꾸기·견본 없음)와 결과 화소를 견준다.
 * 62차: 손질 워커를 받지 못하면 놓기 조각이 화면에서 같은 손질(recolorHere)을 한다 — 결과 그림·견본이 워커의 손질과 같은지도 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../src/index';
import type { DocImages } from '../src/app/doc';
import { ContextWatch, prepareRelease, type WatchViewer } from '../src/app/release';
import { heldAsTexture, markDeferredRecolor, prepareSceneTextures, recolorTextures } from '../src/worker/textures';

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
    const held = prepareRelease({ scene });
    expect(held.map((h) => [h.id, !!h.raw])).toEqual([
      ['a', false],
      ['b', false],
    ]);
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
    const held = prepareRelease({ scene });
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

describe('62차 손질 워커를 받지 못하면 화면에서 같은 손질(놓기 조각의 기본 recolorHere)', () => {
  it('처음 열 때 미룬 무늬를 워커와 같은 그림·견본으로 손질해 코어에 주고 재질 목록 견본을 바꾼다', async () => {
    const log = fakeDecode();
    // 해석 워커가 미룬 꼴(큰 모형): pending과 deferredData
    const scene = openedScene();
    expect([...markDeferredRecolor(scene)]).toEqual(['a', 'b']);
    const images: DocImages = {
      model: null,
      materials: new Map([
        ['a', { name: 'a.png', url: 'blob:old-a' }],
        ['b', { name: 'b.png', url: 'blob:old-b' }],
      ]),
      components: new Map(),
      scenes: [],
      skipped: 0,
      urls: ['blob:old-a', 'blob:old-b'],
    };
    const held = prepareRelease({ scene, images });
    // 워커가 했을 손질(recolor.worker.ts와 같은 함수·한도·견본)
    const want = await recolorTextures(held, 2048, { swatches: true });
    const pngs = log.pngs;
    expect(want.swatches!.map((s) => s.folder)).toEqual(['a', 'b']);
    const waiting = new Set(['a', 'b']);
    const got: [string, FakeBitmap][] = [];
    const v: WatchViewer = {
      scene,
      get restoreNeed() {
        return waiting.size ? { meshes: [], textures: [...waiting] } : null;
      },
      restorePending: false,
      onContextLost: () => () => undefined,
      onContextRestore: () => () => undefined,
      onContextRestoreDone: () => () => undefined,
      restoreTexture: async (id, src) => {
        if (!waiting.delete(id)) return false;
        got.push([id, src as unknown as FakeBitmap]);
        return true;
      },
    };
    const shown: string[] = [];
    // 손질 워커를 받지 못한다(만들 때 던짐 — 스크립트를 받지 못한 브라우저는 오류 사건, 둘 다 같은 길)
    const w = new ContextWatch(v, { show: (_k, t) => shown.push(t), hide: () => undefined, refresh: () => undefined }, () => {
      throw new Error('워커 스크립트를 받지 못했습니다');
    });
    w.setSource({ scene, textures: held, textureLimit: 2048 });
    for (let i = 0; i < 200 && waiting.size; i++) await new Promise((r) => setTimeout(r, 1));
    expect(got.map(([id, b]) => [id, b.width, b.height, [...b.px!.slice(0, 8)]])).toEqual(
      want.textures.map((t) => [t.id, t.width, t.height, [...(t.bitmap as unknown as FakeBitmap).px!.slice(0, 8)]]),
    );
    // 견본 PNG도 같은 수만큼 만들어 재질 목록 견본을 바꾼다(가짜 굳히기는 [1])
    for (let i = 0; i < 50 && images.materials.get('b')!.url === 'blob:old-b'; i++) await new Promise((r) => setTimeout(r, 1));
    expect(log.pngs - pngs).toBe(2);
    const { resolveObjectURL } = await import('node:buffer');
    for (const f of ['a', 'b']) {
      const url = images.materials.get(f)!.url;
      expect(url).not.toBe(`blob:old-${f}`);
      expect([...new Uint8Array(await resolveObjectURL(url)!.arrayBuffer())]).toEqual([...want.swatches!.find((s) => s.folder === f)!.png]);
      URL.revokeObjectURL(url);
    }
    expect(shown).toEqual([]);
    expect(w.last).toMatchObject({ textures: 2, left: 0 });
  });
});
