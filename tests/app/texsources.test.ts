// @vitest-environment jsdom
/**
 * 다 올린 큰 모형의 무늬 원본 놓기(texsources.ts — 23차). 시간은 가짜 시계로 옮긴다(느린 CI에서도 흔들리지 않게).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Texture3d } from 'opencad-viewer3d/types';
import {
  TEXTURE_KEEP_BYTES,
  TEXTURE_LOST_TEXT,
  TEXTURE_LOST_TITLE,
  releaseTextureSources,
  releaseWhenSettled,
  textureSourceBytes,
  texturesSettled,
  type TexViewer,
} from '../../src/app/texsources';

/** 가짜 ImageBitmap(닫으면 크기가 0 — 브라우저처럼) */
function bitmap(w: number, h: number): ImageBitmap & { closed: number } {
  const b = {
    width: w,
    height: h,
    closed: 0,
    close() {
      b.closed++;
      b.width = 0;
      b.height = 0;
    },
  };
  return b as unknown as ImageBitmap & { closed: number };
}

const big = (): Texture3d[] => [
  { id: 'a', bitmap: bitmap(2048, 2048), width: 2048, height: 2048, alpha: true },
  { id: 'b', data: new Uint8Array(20 * 1024 * 1024), mime: 'image/jpeg', width: 4000, height: 3000 },
  { id: 'c', data: new Uint8Array(1000), mime: 'image/png' },
];

describe('무늬 원본 바이트·놓기', () => {
  it('원본 바이트: 열린 그림의 화소 RGBA와 그림 파일 바이트(닫힌 그림은 0)', () => {
    const b = bitmap(10, 20);
    expect(textureSourceBytes([{ id: 'x', bitmap: b }, { id: 'y', data: new Uint8Array(100) }, { id: 'z' }])).toBe(10 * 20 * 4 + 100);
    b.close();
    expect(textureSourceBytes([{ id: 'x', bitmap: b }])).toBe(0);
    expect(textureSourceBytes(undefined)).toBe(0);
  });

  it('한도보다 작으면 그대로, 넘으면 그림은 닫고 바이트는 뺀다(id·크기·알파는 둔다)', () => {
    const small: Texture3d[] = [{ id: 's', data: new Uint8Array(1000) }];
    expect(releaseTextureSources(small)).toBe(0);
    expect(small[0]!.data).toBeDefined();
    const t = big();
    const bmp = t[0]!.bitmap as unknown as { closed: number };
    const n = 2048 * 2048 * 4 + 20 * 1024 * 1024 + 1000;
    expect(n).toBeGreaterThan(TEXTURE_KEEP_BYTES);
    expect(releaseTextureSources(t)).toBe(n);
    expect(bmp.closed).toBe(1);
    expect(t.map((x) => [x.id, 'bitmap' in x, 'data' in x])).toEqual([
      ['a', false, false],
      ['b', false, false],
      ['c', false, false],
    ]);
    expect(t[0]).toMatchObject({ width: 2048, height: 2048, alpha: true });
    expect(t[1]).toMatchObject({ mime: 'image/jpeg', width: 4000, height: 3000 });
    expect(textureSourceBytes(t)).toBe(0);
    // keep을 주면 그 한도로
    expect(releaseTextureSources([{ id: 'k', data: new Uint8Array(10) }], 5)).toBe(10);
  });

  it('쓰는 무늬가 모두 풀렸거나 못 풀렸는지', () => {
    expect(texturesSettled({ count: 3, ready: 2, failed: 0 })).toBe(false);
    expect(texturesSettled({ count: 3, ready: 2, failed: 1 })).toBe(true);
    expect(texturesSettled({ count: 0, ready: 0, failed: 0 })).toBe(true);
    expect(texturesSettled(null)).toBe(false);
  });
});

describe('다 올린 뒤 무늬가 모두 풀리면 놓기(releaseWhenSettled)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const viewer = (): TexViewer & { tex: { count: number; ready: number; failed: number } } => {
    const tex = { count: 2, ready: 0, failed: 0 };
    return { canvas: document.createElement('canvas'), stats: { textures: tex }, tex } as unknown as TexViewer & { tex: typeof tex };
  };

  it('무늬가 작으면 기다리지 않고 0', async () => {
    const v = viewer();
    const lost = vi.fn();
    const p = releaseWhenSettled(v, { textures: [{ id: 's', data: new Uint8Array(10) }] }, () => true, lost);
    await expect(p).resolves.toBe(0);
  });

  it('모두 풀릴 때까지 기다렸다 놓고, 그 뒤 문맥을 되찾으면(같은 문서면) 알린다', async () => {
    const v = viewer();
    const scene = { textures: big() };
    let current = true;
    const lost = vi.fn();
    let got: number | null = null;
    void releaseWhenSettled(v, scene, () => current, lost).then((n) => (got = n));
    await vi.advanceTimersByTimeAsync(2000);
    expect(got).toBeNull();
    expect(scene.textures[1]!.data).toBeDefined();
    v.tex.ready = 1;
    v.tex.failed = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toBeGreaterThan(TEXTURE_KEEP_BYTES);
    expect(scene.textures[1]!.data).toBeUndefined();
    expect(lost).not.toHaveBeenCalled();
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(lost).toHaveBeenCalledWith(TEXTURE_LOST_TITLE, TEXTURE_LOST_TEXT);
    // 다른 문서를 열었으면 알리지 않고 듣기를 그만둔다
    current = false;
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    current = true;
    v.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('다 풀리기 전에 다른 문서를 열었거나 너무 오래 걸리면 놓지 않는다', async () => {
    const v = viewer();
    const a = { textures: big() };
    let current = true;
    const pa = releaseWhenSettled(v, a, () => current, vi.fn());
    await vi.advanceTimersByTimeAsync(1000);
    current = false;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pa).resolves.toBe(0);
    expect(a.textures[1]!.data).toBeDefined();
    const b = { textures: big() };
    const pb = releaseWhenSettled(v, b, () => true, vi.fn(), { max: 5000 });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(pb).resolves.toBe(0);
    expect(b.textures[1]!.data).toBeDefined();
  });
});
