/**
 * 문맥 복구 때 쥐어 둔 색 바꾼 무늬 다시 손질하기(src/worker/textures.ts recolorTextures — 29차, recolor.worker.ts가 부른다):
 * 화면이 장면에서 뺀 원래 그림 바이트(Blob)를 해석기가 넣은 꼴(그림 머리의 크기)로 되돌려 처음 열 때와 같은 손질을 한다.
 * Node에는 그림 풀기가 없어 가짜 createImageBitmap·OffscreenCanvas로 차례(줄이는 크기·색 바꾸기·견본 없음)와 결과 화소를 견준다.
 * 62차: 손질 워커를 받지 못하면 놓기 조각이 화면에서 같은 손질(recolorHere)을 한다 — 결과 그림·견본이 워커의 손질과 같은지도 본다.
 * 103차(코어 0.95.0 setTexture): 큰 모형은 손질할 무늬를 알파를 재는 무늬까지 모두 pending으로 장면부터 올리고, 손질 결과를 setTexture로 같은 id·잰 alpha로 준다.
 * 가짜 WebGL2(tests/fakegl)로 코어 뷰어를 돌려 setScene이 손질보다 먼저인지, 다 준 뒤 그리기 기록이 102차 길(해석 워커가 먼저 손질)과 같은지,
 * 주는 도중 문서를 바꾸면 앞 문서의 손질 결과를 새 문서에 주지 않는지 본다.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Viewer3d, type TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../src/index';
import type { DocImages } from '../src/app/doc';
import type { HeldTexture, RecolorResult } from '../src/app/protocol';
import { ContextWatch, prepareRelease, RELEASE_OPTIONS, type HereRecolor, type WatchViewer } from '../src/app/release';
import { heldAsTexture, markDeferredTrim, prepareSceneTextures, recolorTextures } from '../src/worker/textures';
import { installDom } from './fakegl/fakedom';
import type { DrawEntry, FakeGL } from './fakegl/fakegl';

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
  tag?: string;
  closed?: boolean;
  close(): void;
}

/**
 * 가짜 그림 풀기: 그림 머리의 크기로 풀고(바이트 첫 값으로 화소를 채운다), 주면 그 크기로 줄인다. 부른 선택을 적어 둔다.
 * OffscreenCanvas는 그린 그림의 화소를 들고, transferToImageBitmap은 그 화소를 담은 그림을 준다
 */
function fakeDecode(): { calls: { w: number; h: number; opts: ImageBitmapOptions | undefined }[]; pngs: number } {
  const log = { calls: [] as { w: number; h: number; opts: ImageBitmapOptions | undefined }[], pngs: 0 };
  // tag: 가짜 GL이 올린 무늬의 꼬리표로 적는다(103차 — 그리기 기록이 그림 크기와 첫 화소까지 견주게)
  const bitmap = (width: number, height: number, px: Uint8ClampedArray | null): FakeBitmap => ({
    width,
    height,
    px,
    tag: `${width}x${height}:${px ? [...px.slice(0, 4)].join(',') : '-'}`,
    close() {
      this.closed = true;
    },
  });
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
    expect([...markDeferredTrim(scene)]).toEqual(['a', 'b']);
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
      // 103차: 손질 결과는 setTexture로 준다(색만 바꾸는 무늬는 잰 alpha가 없어 그림만)
      setTexture: (id, src) => v.restoreTexture(id, src as TextureSource),
    };
    const shown: string[] = [];
    // 손질 워커를 받지 못한다(만들 때 던짐 — 스크립트를 받지 못한 브라우저는 오류 사건, 둘 다 같은 길)
    const w = new ContextWatch(v, { show: (_k, t) => shown.push(t), hide: () => undefined, refresh: () => undefined }, () => {
      throw new Error('워커 스크립트를 받지 못했습니다');
    });
    w.setSource({ scene, textures: held, textureLimit: 2048 });
    // CI 14차(공용 규칙 13번 — 횟수가 아니라 마감 시간과 조건): 조건 그대로, setTimeout(1) 이백 번(200 ms 남짓) → 마감 5초
    for (const end = Date.now() + 5_000; waiting.size && Date.now() < end; ) await new Promise((r) => setTimeout(r, 1));
    expect(got.map(([id, b]) => [id, b.width, b.height, [...b.px!.slice(0, 8)]])).toEqual(
      want.textures.map((t) => [t.id, t.width, t.height, [...(t.bitmap as unknown as FakeBitmap).px!.slice(0, 8)]]),
    );
    // 견본 PNG도 같은 수만큼 만들어 재질 목록 견본을 바꾼다(가짜 굳히기는 [1])
    // CI 14차: 조건 그대로, setTimeout(1) 쉰 번(50 ms 남짓) → 마감 5초
    for (const end = Date.now() + 5_000; images.materials.get('b')!.url === 'blob:old-b' && Date.now() < end; ) await new Promise((r) => setTimeout(r, 1));
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

/** 알파 칸이 있는 무늬 정보(색 바꾸기 여부) */
const alphaInfo = (id: string, colorize: boolean): SkpTextureInfo => ({ ...info(id, colorize), alphaPossible: true });
/** 채움 값으로 화소를 채우는 16 × 8 PNG 머리 */
const pngFill = (fill: number): Uint8Array<ArrayBuffer> => {
  const b = pngHead(16, 8);
  b[30] = fill;
  return b;
};

describe('103차 손질 결과의 잰 alpha와 plain(recolorTextures)', () => {
  it('알파 칸이 있는 무늬는 잰 alpha를 함께 주고, 투명 화소가 없는 알파 재기만 무늬는 plain(손질한 그림 없이 쥔 바이트 그대로) — 견본을 묻든 말든 같다', async () => {
    fakeDecode();
    const blob = (fill: number): Blob => new Blob([pngFill(fill)], { type: 'image/png' });
    // c 색 바꾸기만(알파 칸 없음), ca 색 바꾸기·투명 화소, at 알파 재기만·투명 화소, ao 알파 재기만·불투명(알파 255)
    const list: HeldTexture[] = [
      { id: 'c', blob: blob(90), info: info('c') },
      { id: 'ca', blob: blob(90), info: alphaInfo('ca', true) },
      { id: 'at', blob: blob(90), info: alphaInfo('at', false) },
      { id: 'ao', blob: blob(255), info: alphaInfo('ao', false) },
    ];
    for (const swatches of [true, false]) {
      const res = await recolorTextures(list, 2048, { swatches });
      expect(res.textures.map((t) => [t.id, t.alpha])).toEqual([
        ['c', undefined],
        ['ca', true],
        ['at', true],
      ]);
      expect(res.plain).toEqual(['ao']);
    }
    // 그림을 풀 수 없는 곳: 색 바꾸기는 빠지고(평균색), 알파 재기만 무늬는 plain(바이트 그대로 — 해석 워커가 알파를 끈 채 두던 것과 같다)
    vi.unstubAllGlobals();
    const none = await recolorTextures(list, 2048);
    expect(none.textures).toEqual([]);
    expect(none.plain).toEqual(['at', 'ao']);
  });
});

describe('103차 첫 그림 뒤로 미룬 손질을 setTexture로(가짜 WebGL2 — 코어 0.95.0 Viewer3d)', () => {
  let dom: ReturnType<typeof installDom>;
  beforeAll(() => {
    dom = installDom();
  });
  afterAll(() => dom.restore());

  const LIMIT = 2048;
  const IDS = ['c', 'ca', 'at', 'ao', 'j'] as const;
  /**
   * 네모 다섯(무늬 하나씩): c 색 바꾸기, ca 색 바꾸기·투명 화소, at 알파 재기만·투명 화소, ao 알파 재기만·불투명, j 손질 없음(코어가 바이트를 푼다).
   * fills로 무늬마다 채움 값(그림)을 바꾼다
   */
  function texScene(fills: Partial<Record<(typeof IDS)[number], number>> = {}): Scene3d {
    const fill = { c: 90, ca: 80, at: 70, ao: 255, j: 60, ...fills };
    return {
      name: 's',
      units: 'mm',
      meshes: IDS.map((id, k) => ({
        id: `m-${id}`,
        positions: Float32Array.of(k, 0, 0, k + 1, 0, 0, k + 1, 1, 0, k, 1, 0),
        indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        uvs: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
        texture: id,
        color: [0.5, 0.5, 0.5, 1] as [number, number, number, number],
      })),
      lines: [],
      textures: IDS.map((id) => ({ id, data: pngFill(fill[id]), mime: 'image/png', width: 16, height: 8 })),
      meta: { textures: [info('c'), alphaInfo('ca', true), alphaInfo('at', false), alphaInfo('ao', false), info('j', false)] },
    };
  }
  const newViewer = (): { v: Viewer3d; gl: FakeGL } => {
    const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, viewCube: false, grid: false, textureLimit: LIMIT });
    return { v, gl: (v.canvas as unknown as { gl: FakeGL }).gl };
  };
  /** 코어가 무늬를 다 올리고 앱 몫(약속)까지 끝날 때까지 */
  const ready = async (v: Viewer3d): Promise<void> => {
    // CI 14차(공용 규칙 13번 — 고치는 시험의 같은 꼴도): 조건 그대로, setTimeout(1) 사백 번(400 ms 남짓) → 마감 5초
    for (const end = Date.now() + 5_000; Date.now() < end; ) {
      const t = v.stats.textures;
      if (t.count && t.ready + t.failed === t.count && !v.restoreNeed) break;
      await new Promise((r) => setTimeout(r, 1));
    }
    // CI 14차(공용 규칙 13번): setTimeout(0) 열 번(10 ms 남짓) → 마감 15 ms까지(적어도 한 차례 — 그 앞에 쌓인 약속은 다 돈다)
    const end = Date.now() + 15;
    do await new Promise((r) => setTimeout(r, 0));
    while (Date.now() < end);
  };
  /** 한 번 그린 그리기 기록(무늬 꼬리표 포함 — 차례와 무관하게 견준다) */
  const drawsOf = (v: Viewer3d, gl: FakeGL): string[] => {
    gl.logDraws = true;
    gl.logTextures = true;
    gl.draws = [];
    v.renderNow();
    const out = gl.draws.map((d: DrawEntry) => JSON.stringify(d)).sort();
    gl.logDraws = false;
    return out;
  };
  const noWorker = (): Worker => {
    throw new Error('손질 워커 없음');
  };
  const quietUi = { show: () => undefined, hide: () => undefined, refresh: () => undefined };
  const alphaOf = (src: unknown): boolean | undefined => (src && typeof src === 'object' && 'alpha' in src ? (src as { alpha?: boolean }).alpha : undefined);
  const bitmapOf = (src: unknown): FakeBitmap | undefined =>
    src && typeof src === 'object' ? ('close' in src ? (src as FakeBitmap) : (src as { bitmap?: FakeBitmap }).bitmap) : undefined;

  /** 102차 길: 해석 워커가 결과를 보내기 전에 손질하고(알파를 장면에 적음) 화면이 그 장면을 놓아 올린다 */
  async function drawsBefore(): Promise<string[]> {
    const s = texScene();
    await prepareSceneTextures(s, LIMIT);
    prepareRelease({ scene: s });
    const { v, gl } = newViewer();
    try {
      v.setScene(s, { release: RELEASE_OPTIONS });
      await ready(v);
      expect(v.stats.textures).toMatchObject({ count: 5, ready: 5, missing: 0 });
      return drawsOf(v, gl);
    } finally {
      v.dispose();
    }
  }

  it('setScene이 손질보다 먼저 — 손질 결과는 setTexture로 같은 id·잰 alpha로 가고, 다 준 뒤 그리기 기록이 102차 길(해석 워커가 먼저 손질)과 같다', async () => {
    fakeDecode();
    const before = await drawsBefore();
    const s = texScene();
    expect([...markDeferredTrim(s)]).toEqual(['c', 'ca', 'at', 'ao']);
    const held = prepareRelease({ scene: s });
    const { v, gl } = newViewer();
    const events: string[] = [];
    const given: [string, boolean | undefined][] = [];
    const setScene = v.setScene.bind(v);
    v.setScene = (scene, opts) => {
      events.push('setScene');
      setScene(scene, opts);
    };
    const setTexture = v.setTexture.bind(v);
    v.setTexture = (id, src) => {
      events.push(`set:${id}`);
      given.push([id, alphaOf(src)]);
      return setTexture(id, src);
    };
    const restoreTexture = v.restoreTexture.bind(v);
    v.restoreTexture = (id, src) => {
      events.push(`restore:${id}`);
      return restoreTexture(id, src);
    };
    const here: HereRecolor = async (req) => {
      events.push('trim');
      const r = await recolorTextures(req.textures, req.textureLimit ?? LIMIT, { swatches: !!req.swatches });
      events.push('trimmed');
      return r;
    };
    const w = new ContextWatch(v, quietUi, noWorker, here);
    try {
      // 화면 차례(app.ts setDoc): 놓기 준비 → setScene → setSource
      v.setScene(s, { release: RELEASE_OPTIONS });
      // 장면을 올린 때 코어는 손질할 무늬 넷을 기다린다(그 그물은 평균색) — 손질은 아직 하지 않았다
      expect(v.restoreNeed?.textures.slice().sort()).toEqual(['ao', 'at', 'c', 'ca']);
      expect(v.stats.textures).toMatchObject({ count: 5, missing: 4 });
      w.setSource({ scene: s, textures: held, textureLimit: LIMIT });
      await ready(v);
      expect(events).toEqual(['setScene', 'trim', 'trimmed', 'set:c', 'set:ca', 'set:at', 'set:ao']);
      // 같은 id·잰 alpha(색만 바꾸는 무늬는 그림만, 투명 화소가 없는 알파 재기 무늬는 바이트와 alpha 거짓)
      expect(given).toEqual([
        ['c', undefined],
        ['ca', true],
        ['at', true],
        ['ao', false],
      ]);
      expect(v.stats.textures).toMatchObject({ count: 5, ready: 5, missing: 0 });
      expect(w.last).toMatchObject({ textures: 4, left: 0 });
      expect(drawsOf(v, gl)).toEqual(before);
    } finally {
      w.dispose();
      v.dispose();
    }
  });

  it('주는 도중 새 문서로 바꾸면 앞 문서의 손질 결과를 새 문서에 주지 않고(같은 무늬 id라도) 남은 그림은 닫는다 — 새 문서는 제 손질만 받는다', async () => {
    fakeDecode();
    const s1 = texScene();
    markDeferredTrim(s1);
    const held1 = prepareRelease({ scene: s1 });
    // 새 문서: 같은 무늬 id, 다른 그림(채움 값)
    const s2 = texScene({ c: 20, ca: 21, at: 22, ao: 250 });
    markDeferredTrim(s2);
    const held2 = prepareRelease({ scene: s2 });
    const { v } = newViewer();
    const jobs: RecolorResult[] = [];
    const here: HereRecolor = async (req) => {
      const r = await recolorTextures(req.textures, req.textureLimit ?? LIMIT, { swatches: !!req.swatches });
      jobs.push(r);
      return r;
    };
    const w = new ContextWatch(v, quietUi, noWorker, here);
    const given: { doc: number; id: string; src: unknown }[] = [];
    let switched = false;
    // 화면 차례(app.ts setDoc): 앞 문서 거두기 → setScene → setSource
    const openSecond = (): void => {
      switched = true;
      w.setSource(null);
      v.setScene(s2, { release: RELEASE_OPTIONS });
      w.setSource({ scene: s2, textures: held2, textureLimit: LIMIT });
    };
    // 앞 문서의 첫 무늬를 주는(코어가 푸는) 동안 새 문서를 연다
    const setTexture = v.setTexture.bind(v);
    v.setTexture = (id, src) => {
      given.push({ doc: v.scene === s2 ? 2 : 1, id, src });
      const p = setTexture(id, src);
      if (!switched) openSecond();
      return p;
    };
    const restoreTexture = v.restoreTexture.bind(v);
    v.restoreTexture = (id, src: TextureSource) => {
      given.push({ doc: v.scene === s2 ? 2 : 1, id, src });
      const p = restoreTexture(id, src);
      if (!switched) openSecond();
      return p;
    };
    try {
      v.setScene(s1, { release: RELEASE_OPTIONS });
      w.setSource({ scene: s1, textures: held1, textureLimit: LIMIT });
      await ready(v);
      expect(switched).toBe(true);
      expect(jobs).toHaveLength(2);
      const [r1, r2] = jobs as [RecolorResult, RecolorResult];
      // 앞 문서에는 첫 무늬만 갔다
      expect(given.filter((g) => g.doc === 1).map((g) => g.id)).toEqual(['c']);
      // 새 문서가 받은 것은 모두 새 문서의 손질 결과(그림) 또는 새 문서의 바이트(plain — 채움 250)
      const mine = new Set<unknown>(r2.textures.map((t) => t.bitmap));
      const second = given.filter((g) => g.doc === 2);
      expect(second.map((g) => g.id)).toEqual(['c', 'ca', 'at', 'ao']);
      for (const g of second) {
        const b = bitmapOf(g.src);
        if (b) expect(mine.has(b), g.id).toBe(true);
        else expect((g.src as { data: Uint8Array }).data[30], g.id).toBe(250);
      }
      // 앞 문서의 남은 손질 그림은 주지 않고 닫았다
      expect(r1.textures.slice(1).map((t) => [t.id, (t.bitmap as unknown as FakeBitmap).closed])).toEqual([
        ['ca', true],
        ['at', true],
      ]);
      expect(v.stats.textures).toMatchObject({ count: 5, ready: 5, missing: 0 });
      expect(w.last).toMatchObject({ textures: 4, left: 0 });
    } finally {
      w.dispose();
      v.dispose();
    }
  });
});
