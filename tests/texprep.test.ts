/**
 * 처음 열 때 무늬 손질 줄이기(33차 — src/colorize.ts 기억 칸, src/worker/textures.ts 미리 풀기·견본 모아 기다리기):
 * - 색 바꾸기는 같은 색 화소의 결과를 기억해 다시 쓰되, 결과는 화소마다 따로 계산한 것과 바이트까지 같다(바이트 배열·일반 배열·어긋난 자리).
 * - 무늬 손질은 다음 무늬를 미리 하나만 풀고(다른 스레드), 견본 PNG는 굳히기가 끝난 차례와 상관없이 무늬 차례로 넣으며, 풀기·견본이 실패해도 예전과 같다.
 * Node에는 그림 풀기가 없어 가짜 createImageBitmap·OffscreenCanvas로 차례와 결과를 본다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../src/index';
import { colorizeRgba, type ColorizeSpec } from '../src/colorize';
import { prepareSceneTextures } from '../src/worker/textures';

const SPECS: ColorizeSpec[] = [
  { type: 'shift', color: [64, 64, 66], average: [139, 140, 143] },
  { type: 'shift', color: [242, 241, 234], average: [229, 221, 205] },
  { type: 'tint', color: [30, 120, 200], average: [100, 100, 100] },
  { type: 'shift', color: [255, 255, 255], average: [0, 0, 0] },
  { type: 'shift', color: [10, 250, 3], average: [250, 3, 10] },
];

/** 고른 난수(되풀이할 수 있게) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8;
}

/** 화소 n개: 색이 되풀이되고(앞 화소 그대로·적은 색 무리) 섞인 RGBA */
function pixels(n: number, seed: number): Uint8ClampedArray {
  const r = rng(seed);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = i && i % 3 === 0 ? (out[(i - 1) * 4]! << 16) | (out[(i - 1) * 4 + 1]! << 8) | out[(i - 1) * 4 + 2]! : i % 2 ? r() & 0x3f3f3f : r() & 0xffffff;
    out.set([c >>> 16, (c >>> 8) & 255, c & 255, r() & 255], i * 4);
  }
  return out;
}

/** 화소마다 따로 바꾼 결과(화소 하나짜리 배열로 부른다 — 기억 칸이 다른 화소를 쓰지 못한다) */
function perPixel(src: Uint8ClampedArray, spec: ColorizeSpec): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i + 3 < src.length; i += 4) out.set(colorizeRgba(src.slice(i, i + 4), spec), i);
  return out;
}

describe('색 바꾸기 기억 칸(33차)', () => {
  it('같은 색 화소를 다시 써도 화소마다 계산한 것과 바이트까지 같다(알파는 그대로)', () => {
    for (const [k, spec] of SPECS.entries()) {
      const src = pixels(20000, 7 + k);
      const want = perPixel(src, spec);
      const got = colorizeRgba(src.slice(), spec);
      expect(got).toEqual(want);
      for (let i = 3; i < src.length; i += 4) if (got[i] !== src[i]) throw new Error(`알파가 바뀌었다 @${i}`);
      // Uint8Array도 같은 값
      expect([...colorizeRgba(new Uint8Array(src), spec)]).toEqual([...want]);
    }
  });

  it('기억 칸이 겹치는(해시가 같은) 많은 색에서도 같다', () => {
    const r = rng(99);
    const src = new Uint8ClampedArray(70000 * 4);
    for (let i = 0; i < 70000; i++) src.set([r() & 255, r() & 255, r() & 255, 255], i * 4);
    expect(colorizeRgba(src.slice(), SPECS[0]!)).toEqual(perPixel(src, SPECS[0]!));
  });

  it('평균색을 주지 않으면 원래 화소 평균으로(기억 칸 전에 잰다), 4바이트 자리가 아닌 배열·일반 배열은 화소마다', () => {
    const src = pixels(3000, 3);
    const spec: ColorizeSpec = { type: 'shift', color: [200, 100, 50] };
    const whole = colorizeRgba(src.slice(), spec);
    // 일반 배열은 반올림한 수 그대로 둔다 — 바이트 배열에 넣은 값으로 견준다
    const plain = colorizeRgba(Array.from(src), spec);
    expect(Uint8ClampedArray.from(plain)).toEqual(whole);
    const buf = new Uint8ClampedArray(src.length + 1);
    buf.set(src, 1);
    const shifted = colorizeRgba(buf.subarray(1), spec);
    expect([...shifted]).toEqual([...whole]);
  });
});

/** 그림 머리만 있는 PNG(가로·세로) — 바이트 30번 값으로 화소를 채운다 */
function pngHead(w: number, h: number, fill: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[24] = 8;
  b[25] = 2;
  b[30] = fill;
  return b;
}

interface FakeBitmap {
  width: number;
  height: number;
  px: Uint8ClampedArray;
  close(): void;
}

const info = (id: string, colorize: boolean, alphaPossible = false): SkpTextureInfo => ({
  id,
  material: id,
  folder: `f-${id}`,
  path: `${id}.png`,
  tile: [1, 1],
  alphaPossible,
  ...(colorize ? { colorize: { type: 'shift' as const, color: [200, 100, 50] as [number, number, number], average: [90, 90, 90] as [number, number, number] } } : {}),
});

/**
 * 가짜 그림 풀기와 그리기: 파일 바이트 풀기는 부를 때 차례로 적고(log 'decode#<차례>') 정한 만큼 늦게 끝난다, 화소 읽기는 'read:<채움 값>'.
 * 견본 굳히기(convertToBlob)는 무늬마다 늦는 정도를 달리해 끝나는 차례를 뒤집을 수 있다
 */
function fakeImages(opts: { decodeDelay?: (fill: number) => number; pngDelay?: (fill: number) => number; failDecode?: number; failPng?: number } = {}): string[] {
  const log: string[] = [];
  const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let calls = 0;
  vi.stubGlobal('createImageBitmap', async (src: Blob | FakeBitmap, o?: ImageBitmapOptions) => {
    let w: number, h: number, fill: number;
    if (src instanceof Blob) {
      log.push(`decode#${++calls}`);
      const head = new Uint8Array(await src.slice(0, 33).arrayBuffer());
      const dv = new DataView(head.buffer);
      w = dv.getUint32(16);
      h = dv.getUint32(20);
      fill = head[30]!;
      await later(opts.decodeDelay?.(fill) ?? 0);
      if (fill === opts.failDecode) throw new Error('풀지 못함');
    } else {
      w = src.width;
      h = src.height;
      fill = src.px[0]!;
    }
    const ow = o?.resizeWidth ?? w, oh = o?.resizeHeight ?? h;
    return { width: ow, height: oh, px: new Uint8ClampedArray(ow * oh * 4).fill(fill), close: () => undefined } satisfies FakeBitmap;
  });
  class Canvas {
    px: Uint8ClampedArray;
    fill = -1;
    constructor(
      public width: number,
      public height: number,
    ) {
      this.px = new Uint8ClampedArray(width * height * 4);
    }
    getContext(): unknown {
      return {
        drawImage: (b: FakeBitmap | Canvas) => {
          if (b.px.length === this.px.length) this.px.set(b.px);
          this.fill = b instanceof Canvas ? b.fill : b.px[0]!;
        },
        getImageData: () => {
          log.push(`read:${this.fill}`);
          return { data: this.px.slice(), width: this.width, height: this.height };
        },
        putImageData: (img: { data: Uint8ClampedArray }) => this.px.set(img.data),
      };
    }
    transferToImageBitmap(): FakeBitmap {
      return { width: this.width, height: this.height, px: this.px.slice(), close: () => undefined };
    }
    async convertToBlob(): Promise<Blob> {
      const fill = this.fill;
      await later(opts.pngDelay?.(fill) ?? 0);
      log.push(`png:${fill}`);
      if (fill === opts.failPng) throw new Error('굳히지 못함');
      return new Blob([new Uint8Array([fill, this.width])]);
    }
  }
  vi.stubGlobal('OffscreenCanvas', Canvas);
  return log;
}

/** 무늬 셋(채움 값 10·255·30), b는 알파만 재는 무늬(알파 255 — 투명 화소 없음) */
function scene3(): Scene3d {
  return {
    name: 's',
    units: 'mm',
    meshes: [
      { id: 'm1', positions: new Float32Array(9), color: [1, 1, 1, 1], texture: 'a', uvs: new Float32Array(6) },
      { id: 'm2', positions: new Float32Array(9), color: [1, 1, 1, 1], texture: 'b', uvs: new Float32Array(6) },
      { id: 'm3', positions: new Float32Array(9), color: [1, 1, 1, 1], texture: 'c', uvs: new Float32Array(6) },
    ],
    lines: [],
    textures: [
      { id: 'a', data: pngHead(64, 32, 10), mime: 'image/png', width: 64, height: 32 },
      { id: 'b', data: pngHead(16, 16, 255), mime: 'image/png', width: 16, height: 16 },
      { id: 'c', data: pngHead(300, 100, 30), mime: 'image/png', width: 300, height: 100 },
    ],
    meta: { textures: [info('a', true), info('b', false, true), info('c', true)] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('무늬 손질 차례(33차)', () => {
  it('다음 무늬를 미리 하나만 풀고, 견본은 무늬 차례대로(굳히기가 끝난 차례와 상관없이) — 결과는 차례대로 한 것과 같다', async () => {
    const log = fakeImages({ decodeDelay: (f) => (f === 10 ? 15 : 1), pngDelay: (f) => (f === 10 ? 30 : 1) });
    const s = scene3();
    const done: number[] = [];
    const r = await prepareSceneTextures(s, 128, (d) => done.push(d));
    // 둘째 무늬는 첫 무늬를 읽기 전에, 셋째 무늬는 첫 무늬를 읽은 뒤 둘째 무늬를 읽기 전에 풀기 시작한다(앞서 푸는 것은 하나뿐)
    expect(log.filter((x) => !x.startsWith('png'))).toEqual(['decode#1', 'decode#2', 'read:10', 'decode#3', 'read:255', 'read:30']);
    // 첫 무늬의 견본 굳히기가 가장 늦게 끝나도 견본은 무늬 차례
    expect(log.filter((x) => x.startsWith('png'))).toEqual(['png:30', 'png:10']);
    expect([...r.swatches.keys()]).toEqual(['f-a', 'f-c']);
    expect([...r.swatches.get('f-a')!]).toEqual([10, 64]);
    expect([...r.swatches.get('f-c')!]).toEqual([30, 128]);
    expect(r).toMatchObject({ decoded: 3, colorized: 2, alpha: 0, dropped: 0 });
    expect(done).toEqual([1, 2, 3]);
    const [a, b, c] = s.textures!;
    // 줄인 크기(긴 변 128)와 색 바꾼 화소, 알파만 잰 무늬는 바이트 그대로
    expect([a!.width, a!.height, c!.width, c!.height]).toEqual([64, 32, 128, 43]);
    expect(b!.bitmap).toBeUndefined();
    expect([...(a!.bitmap as unknown as FakeBitmap).px.slice(0, 4)]).toEqual([...colorizeRgba(new Uint8ClampedArray([10, 10, 10, 10]), info('a', true).colorize!)]);
  });

  it('풀지 못한 무늬는 빼고(평균색) 나머지는 손질한다, 견본을 굳히지 못하면 견본만 없다', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      // 둘째 무늬 풀기는 기다리기 전에 실패한다(앞서 푼 것이 처리되지 않은 거부로 남지 않는다)
      fakeImages({ failDecode: 255, failPng: 30, decodeDelay: (f) => (f === 255 ? 0 : 5) });
      const s = scene3();
      const r = await prepareSceneTextures(s, 128);
      await new Promise((ok) => setTimeout(ok, 20));
      expect(r).toMatchObject({ decoded: 2, colorized: 2, dropped: 1 });
      expect(s.textures!.map((t) => t.id)).toEqual(['a', 'c']);
      expect(s.meshes[1]!.texture).toBeUndefined();
      expect([...r.swatches.keys()]).toEqual(['f-a']);
      expect(s.textures![1]!.bitmap).toBeDefined();
      expect(s.warnings!.some((w) => w.includes('평균색'))).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('견본을 만들지 않으면(문맥 복구) 굳히기를 부르지 않는다', async () => {
    const log = fakeImages();
    const r = await prepareSceneTextures(scene3(), 128, undefined, { swatches: false });
    expect(log.some((x) => x.startsWith('png'))).toBe(false);
    expect(r.swatches.size).toBe(0);
    expect(r.colorized).toBe(2);
  });
});
