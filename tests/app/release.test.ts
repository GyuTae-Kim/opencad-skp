/**
 * 큰 모형 놓기와 그래픽 문맥 잃음·되찾음(src/app/release.ts — 27차, 코어 0.25.0, 29차에 되찾기를 바꿈): 놓기는 푼 무늬 그림만,
 * 색을 바꾼 무늬의 바이트는 장면에서 빼 Blob으로 쥐기, 손질 워커 한 번 쓰고 끝내기, 잃으면 안내·되찾으면 거두고 가림 판정 다시 하기,
 * 쥐어 둔 무늬만 다시 손질해 코어에 주기(파일을 읽지 않음 — 실패·또 잃음·여러 번 잃음·새 문서·새 파일 여는 동안 멈춤),
 * 30차부터 안내는 코어 끝 알림(0.29.0 onContextRestoreDone — 코어가 무늬까지 다 풀어 올림)에 거두기.
 * 41차부터 놓기는 무늬 원본 모두(그림 바이트도): 바이트가 있는 무늬는 모두 Blob으로 쥐고(나머지 무늬는 raw — 견본 주소도 그 Blob으로),
 * 되찾을 때 raw는 손질 워커 없이 바이트를 그대로 코어에 다시 준다(한 번에 넷까지 — 또 잃음·새 문서·멈춤·읽지 못함).
 * 가짜 뷰어(코어 Viewer3d의 일부 — 끝 알림은 코어처럼 되찾음 알림들 뒤, 앱이 다 주고 코어가 풀 무늬가 없을 때)와 가짜 Worker로 차례를 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextRestoreNeed, TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../../src/index';
import type { DeferredTexture, HeldTexture, RecolorRequest, RecolorResult } from '../../src/app/protocol';
import type { DocImages } from '../../src/app/doc';
import {
  CONTEXT_LOST_TITLE,
  ContextWatch,
  RAW_RESTORE_LANES,
  RELEASE_OPTIONS,
  RESTORE_FAIL_TITLE,
  RESTORE_TITLE,
  prepareRelease,
  recolorJob,
  swapSwatches,
  type ContextUi,
  type WatchViewer,
} from '../../src/app/release';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  posted: { msg: RecolorRequest; transfer: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: RecolorRequest, transfer?: unknown): void {
    this.posted.push({ msg, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}
const make = (): Worker => new FakeWorker() as unknown as Worker;

/**
 * 가짜 뷰어: 기다리는 무늬(코어가 원본을 놓았고 장면에 바이트가 없는 무늬)를 들고, 받은 것을 지운다. meshes는 놓은 배열(이 앱은 놓지 않는다).
 * decoding은 코어가 장면의 그림 바이트를 다시 푸는 무늬 수(0.29.0 — 다 풀고 앱이 다 줘야 끝 알림)
 */
class FakeViewer implements WatchViewer {
  scene: Scene3d | null = null;
  missMeshes: string[] = [];
  missTex = new Set<string>();
  gotTex: [string, TextureSource][] = [];
  decoding = 0;
  pending = false;
  private lostCb: (() => void) | null = null;
  private restoreCb: ((need: ContextRestoreNeed) => unknown) | null = null;
  private doneCb: (() => void) | null = null;
  get restoreNeed(): ContextRestoreNeed | null {
    const n = this.need();
    return n.meshes.length || n.textures.length ? n : null;
  }
  get restorePending(): boolean {
    return this.pending;
  }
  need(): ContextRestoreNeed {
    return { meshes: this.missMeshes.map((id) => ({ id, normals: true, uvs: false, backUvs: false })), textures: [...this.missTex] };
  }
  onContextLost(cb: () => void): () => void {
    this.lostCb = cb;
    return () => (this.lostCb = null);
  }
  onContextRestore(cb: (need: ContextRestoreNeed) => unknown): () => void {
    this.restoreCb = cb;
    return () => (this.restoreCb = null);
  }
  onContextRestoreDone(cb: () => void): () => void {
    this.doneCb = cb;
    return () => (this.doneCb = null);
  }
  /** 코어처럼 받은 무늬를 올린 뒤(약속이 풀리기 전) 끝인지 본다 */
  restoreTexture(id: string, src: TextureSource): Promise<boolean> {
    if (!this.missTex.delete(id)) return Promise.resolve(false);
    this.gotTex.push([id, src]);
    return Promise.resolve().then(() => {
      this.checkDone();
      return true;
    });
  }
  lose(): void {
    this.pending = true;
    this.lostCb?.();
  }
  /** 되찾음: 코어는 장면 바이트가 없는 무늬(쥐어 둔 것)를 다시 기다리고, decode장은 장면의 그림 바이트로 다시 푼다. 알림들 뒤에 끝인지 본다 */
  restore(wait: string[] = [], decode = 0): void {
    this.pending = true;
    for (const id of wait) this.missTex.add(id);
    this.decoding = decode;
    void this.restoreCb?.(this.need());
    this.checkDone();
  }
  /** 코어가 그림 바이트로 다시 풀던 무늬를 다 올렸다 */
  decoded(): void {
    this.decoding = 0;
    this.checkDone();
  }
  /** 끝 알림만 부른다(차례와 무관하게 — 받는 쪽이 거르는지 볼 때) */
  emitDone(): void {
    this.doneCb?.();
  }
  protected checkDone(): void {
    if (!this.pending || this.decoding || this.restoreNeed) return;
    this.pending = false;
    this.doneCb?.();
  }
}

class FakeUi implements ContextUi {
  shown: string[] = [];
  open: string | null = null;
  refreshed = 0;
  show(kind: 'info' | 'warn', title: string): void {
    this.shown.push(`${kind}:${title}`);
    this.open = title;
  }
  hide(): void {
    this.open = null;
  }
  refresh(): void {
    this.refreshed++;
  }
}

const info = (id: string, colorize: boolean): SkpTextureInfo => ({
  id,
  material: id,
  folder: id,
  path: `${id}.png`,
  tile: [1, 1],
  alphaPossible: false,
  ...(colorize ? { colorize: { type: 'shift' as const, color: [1, 2, 3] as [number, number, number] } } : {}),
});
const held = (id: string): HeldTexture => ({ id, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), info: info(id, true) });
const mesh = (id: string, nv: number): Scene3d['meshes'][number] => ({ id, positions: new Float32Array(nv * 3), color: [1, 1, 1, 1] });
const sceneOf = (): Scene3d => ({ name: 's', units: 'mm', meshes: [mesh('m1', 3), mesh('m2', 4)], lines: [] });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const bmp = (): ImageBitmap => ({ width: 2, height: 2, close: vi.fn() }) as unknown as ImageBitmap;
const result = (...ids: string[]): RecolorResult => ({ textures: ids.map((id) => ({ id, bitmap: bmp(), width: 2, height: 2 })), ms: 3 });

/** 놓아 올린 문서(색 바꾼 무늬 t1·t2를 쥐었다) */
function setup(): { v: FakeViewer; ui: FakeUi; w: ContextWatch; s: Scene3d; textures: HeldTexture[] } {
  const v = new FakeViewer();
  const ui = new FakeUi();
  const w = new ContextWatch(v, ui, make);
  const s = sceneOf();
  const textures = [held('t1'), held('t2')];
  v.scene = s;
  w.setSource({ scene: s, textures, textureLimit: 1024 });
  return { v, ui, w, s, textures };
}

beforeEach(() => {
  FakeWorker.all = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('놓기 준비', () => {
  it('놓기는 무늬 원본 모두(41차 — 푼 그림과 그림 바이트. 법선·무늬 좌표는 장면에 둔다 — 되찾을 때 코어가 그대로 다시 올린다)', () => {
    expect(RELEASE_OPTIONS).toEqual({ textures: true });
    expect(RAW_RESTORE_LANES).toBe(4);
  });

  it('바이트가 있는 무늬는 모두 Blob으로 쥔다: 색을 바꾼 무늬(워커가 그림을 바꾼 것)는 바이트를 장면에서 빼고, 알파만 잰 무늬·바이트뿐인 무늬는 raw로 두고 장면에도 둔다', async () => {
    const pic = {} as ImageBitmap;
    const c = new Uint8Array([1, 2, 3, 4]);
    const scene: Pick<Scene3d, 'textures' | 'meta'> = {
      textures: [
        { id: 'c', bitmap: pic, data: c, mime: 'image/jpeg' },
        { id: 'a', bitmap: pic, data: new Uint8Array([2]), alpha: true },
        { id: 'p', data: new Uint8Array([3]), mime: 'image/png' },
        { id: 'n', data: new Uint8Array([4]) },
        { id: 'e', data: new Uint8Array(0) },
        { id: 'x', data: new Uint8Array([5]) },
      ],
      meta: { textures: [info('c', true), { ...info('a', false), alphaPossible: true }, info('p', false), info('n', true), info('e', false)] },
    };
    const got = prepareRelease({ scene });
    // 색 바꿈 정보가 있어도 워커가 손질한 그림이 없으면(n) 코어가 바이트로 푼 그대로 — raw. 빈 바이트(e)·정보 없는 무늬(x)는 쥐지 않는다
    expect(got.map((h) => [h.id, h.blob.type, h.blob.size, h.info.colorize?.type, !!h.raw])).toEqual([
      ['c', 'image/jpeg', 4, 'shift', false],
      ['a', '', 1, undefined, true],
      ['p', 'image/png', 1, undefined, true],
      ['n', '', 1, 'shift', true],
    ]);
    expect([...new Uint8Array(await got[0]!.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect([...new Uint8Array(await got[2]!.blob.arrayBuffer())]).toEqual([3]);
    expect(got[0]!.info).toBe((scene.meta!.textures as SkpTextureInfo[])[0]);
    expect(scene.textures!.map((t) => [t.id, !!t.data, !!t.bitmap])).toEqual([
      ['c', false, true],
      ['a', true, true],
      ['p', true, false],
      ['n', true, false],
      ['e', true, false],
      ['x', true, false],
    ]);
    expect(prepareRelease({ scene: {} })).toEqual([]);
  });

  it('raw 무늬의 재질 목록 견본 주소는 쥔 Blob의 주소로 바꾸고 앞 주소는 푼다(닫을 때 풀 목록도) — 색 바꾼 무늬의 견본(바꾼 색 PNG)은 그대로', async () => {
    const revoked: string[] = [];
    const real = URL.revokeObjectURL.bind(URL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revoked.push(u);
      real(u);
    });
    try {
      const pic = {} as ImageBitmap;
      const scene: Pick<Scene3d, 'textures' | 'meta'> = {
        textures: [
          { id: 'c', bitmap: pic, data: new Uint8Array([1, 2]), mime: 'image/jpeg' },
          { id: 'p', data: new Uint8Array([7, 8, 9]), mime: 'image/png' },
          { id: 'q', data: new Uint8Array([6]), mime: 'image/png' },
        ],
        meta: { textures: [info('c', true), info('p', false), info('q', false)] },
      };
      const images: DocImages = {
        model: null,
        materials: new Map([
          ['c', { name: 'c.png', url: 'blob:old-c' }],
          ['p', { name: 'p.png', url: 'blob:old-p' }],
        ]),
        components: new Map(),
        scenes: [],
        skipped: 0,
        urls: ['blob:model', 'blob:old-c', 'blob:old-p'],
      };
      const got = prepareRelease({ scene, images });
      const p = images.materials.get('p')!;
      expect(p.url).not.toBe('blob:old-p');
      expect(p.url.startsWith('blob:')).toBe(true);
      expect(images.materials.get('c')!.url).toBe('blob:old-c');
      expect(images.urls).toEqual(['blob:model', 'blob:old-c', p.url]);
      expect(revoked).toEqual(['blob:old-p']);
      // 새 주소가 가리키는 것은 쥔 Blob(같은 바이트)
      const { resolveObjectURL } = await import('node:buffer');
      const b = resolveObjectURL(p.url)!;
      expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([7, 8, 9]);
      expect(got.find((h) => h.id === 'p')!.blob.size).toBe(3);
      // 견본이 없는 무늬(q)는 주소를 만들지 않는다
      expect(images.urls).toHaveLength(3);
      real(p.url);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('손질 워커', () => {
  it('쥐어 둔 무늬를 그대로 넘기고(Blob은 이전 목록 없이) 받으면 워커를 끝낸다', async () => {
    const t = held('t');
    const job = recolorJob(make, { textures: [t], textureLimit: 512 });
    const w = FakeWorker.all[0]!;
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.msg).toMatchObject({ id: 1, type: 'recolor', textureLimit: 512 });
    expect(w.posted[0]!.msg.textures[0]!.blob).toBe(t.blob);
    expect(w.posted[0]!.transfer).toBeUndefined();
    w.emit({ id: 2, type: 'recolored', result: result('x') });
    expect(w.terminated).toBe(false);
    const res = result('t');
    w.emit({ id: 1, type: 'recolored', result: res });
    await expect(job.done).resolves.toBe(res);
    expect(w.terminated).toBe(true);
  });

  it('오류·워커 멈춤·멈추기는 거부하고 워커를 끝낸다', async () => {
    const req = { textures: [] };
    const a = recolorJob(make, req);
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: '깨짐' });
    await expect(a.done).rejects.toThrow('깨짐');
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const b = recolorJob(make, req);
    const ev = { message: '', preventDefault: vi.fn() } as unknown as ErrorEvent;
    FakeWorker.all[1]!.onerror!(ev);
    await expect(b.done).rejects.toThrow();
    expect(FakeWorker.all[1]!.terminated).toBe(true);
    const c = recolorJob(make, req);
    c.cancel();
    await expect(c.done).rejects.toThrow();
    expect(FakeWorker.all[2]!.terminated).toBe(true);
    const d = recolorJob(() => {
      throw new Error('워커 없음');
    }, req);
    await expect(d.done).rejects.toThrow('워커 없음');
  });
});

describe('그래픽 문맥 잃음·되찾음', () => {
  it('잃으면 안내, 다시 받을 것 없이 되찾고(빈 need — 코어가 장면 배열·바이트로 다시 올림) 코어가 다 올렸다고 알리면 거둔다 — 가림 판정을 다시 하고 워커는 쓰지 않는다', () => {
    const { v, ui, w } = setup();
    expect(w.released).toBe(true);
    v.lose();
    expect(w.state).toBe('lost');
    expect(ui.open).toBe(CONTEXT_LOST_TITLE);
    // 풀 무늬가 없으면 끝 알림이 되찾음 알림 바로 뒤에 온다
    v.restore();
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(ui.refreshed).toBe(1);
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('놓아 올린 문서: 코어가 놓은 무늬를 그림 바이트로 다시 푸는 동안은 무늬를 다시 준비한다고 알리고, 끝 알림에 거둔다(30차 — 29차는 되찾음 알림에 거둠)', () => {
    const { v, ui, w } = setup();
    v.lose();
    v.restore([], 3);
    expect(v.restorePending).toBe(true);
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    expect(ui.refreshed).toBe(1);
    v.decoded();
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('앱이 색 바꾼 무늬를 다 준 뒤에도 코어가 무늬를 푸는 중이면 끝 알림까지 안내를 둔다(앱 몫의 기록은 그때 남긴다)', async () => {
    const { v, ui, w } = setup();
    v.lose();
    v.restore(['t1'], 2);
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await flush();
    expect(v.gotTex.map(([id]) => id)).toEqual(['t1']);
    expect(v.restoreNeed).toBeNull();
    expect(w.last).toMatchObject({ textures: 1, left: 0 });
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    v.decoded();
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('놓아 올리지 않은 문서(작은 모형): 코어가 쥔 그림을 다시 올리는 동안 잃음 안내를 그대로 두고 끝 알림에 거둔다', () => {
    const v = new FakeViewer();
    const ui = new FakeUi();
    const w = new ContextWatch(v, ui, make);
    v.scene = sceneOf();
    w.setSource(null);
    v.lose();
    v.restore([], 1);
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(CONTEXT_LOST_TITLE);
    expect(ui.shown).toEqual([`info:${CONTEXT_LOST_TITLE}`]);
    v.decoded();
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('끝 알림은 다시 올리는 중일 때만 안내를 거둔다(잃은 동안·손질하는 동안·평균색 안내·새 문서는 그대로)', async () => {
    const { v, ui, w } = setup();
    v.lose();
    v.emitDone();
    expect(w.state).toBe('lost');
    expect(ui.open).toBe(CONTEXT_LOST_TITLE);
    v.restore(['t1']);
    v.emitDone();
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: '풀지 못함' });
    await flush();
    expect(w.state).toBe('partial');
    v.emitDone();
    expect(w.state).toBe('partial');
    expect(ui.open).toBe(RESTORE_FAIL_TITLE);
    w.setSource(null);
    v.emitDone();
    expect(w.state).toBe('ok');
    expect(ui.open).toBe(RESTORE_FAIL_TITLE);
  });

  it('놓아 올린 문서: 되찾으면 코어가 바라는 쥐어 둔 무늬만 다시 손질해 주고 안내를 거둔다(파일은 읽지 않는다)', async () => {
    const { v, ui, w, textures } = setup();
    v.lose();
    v.restore(['t2']);
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    const wk = FakeWorker.all[0]!;
    const msg = wk.posted[0]!.msg;
    expect(msg.textureLimit).toBe(1024);
    expect(msg.textures.map((t) => t.id)).toEqual(['t2']);
    expect(msg.textures[0]!.blob).toBe(textures[1]!.blob);
    expect(msg.textures[0]!.info).toBe(textures[1]!.info);
    const res = result('t2');
    wk.emit({ id: 1, type: 'recolored', result: res });
    await flush();
    expect(v.gotTex).toEqual([['t2', res.textures[0]!.bitmap]]);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(w.last).toMatchObject({ textures: 1, left: 0 });
    expect(wk.terminated).toBe(true);
    expect(ui.refreshed).toBe(2);
  });

  it('여러 번 잃어도 쥐어 둔 무늬로 또 되찾는다(휴대폰은 앱을 뒤로 보낼 때마다 잃을 수 있다)', async () => {
    const { v, w } = setup();
    for (let k = 0; k < 3; k++) {
      v.lose();
      v.restore(['t1', 't2']);
      FakeWorker.all[k]!.emit({ id: 1, type: 'recolored', result: result('t1', 't2') });
      await flush();
      expect(w.state).toBe('ok');
      expect(FakeWorker.all[k]!.posted[0]!.msg.textures.map((t) => t.id)).toEqual(['t1', 't2']);
    }
    expect(v.gotTex).toHaveLength(6);
    expect(FakeWorker.all.every((x) => x.terminated)).toBe(true);
  });

  it('다시 손질하지 못하거나 덜 받으면 평균색으로 그린다고 알리고, 다시 잃었다 되찾으면 또 해 본다', async () => {
    const { v, ui, w } = setup();
    v.restore(['t1', 't2']);
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: '풀지 못함' });
    await flush();
    expect(w.state).toBe('partial');
    expect(ui.shown.at(-1)).toBe(`warn:${RESTORE_FAIL_TITLE}`);
    v.lose();
    v.restore();
    // 하나는 풀지 못해 빠졌다
    FakeWorker.all[1]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await flush();
    expect(w.state).toBe('partial');
    expect(w.last).toMatchObject({ textures: 1, left: 1 });
  });

  it('쥐지 않은 것(놓은 그물 배열, 쥐어 두지 않은 무늬)만 바라면 워커 없이 바로 알린다', () => {
    const { v, ui, w } = setup();
    v.missMeshes = ['m1'];
    v.restore(['zz']);
    expect(FakeWorker.all).toHaveLength(0);
    expect(w.state).toBe('partial');
    expect(ui.open).toBe(RESTORE_FAIL_TITLE);
    expect(w.last).toMatchObject({ textures: 0, left: 2 });
  });

  it('다시 손질하는 동안 또 잃으면 받은 것을 쥐었다가 되찾을 때 준다(워커는 한 번만)', async () => {
    const { v, ui, w } = setup();
    v.restore(['t1']);
    v.lose();
    expect(w.state).toBe('lost');
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await flush();
    expect(v.gotTex).toEqual([]);
    v.restore();
    await flush();
    expect(FakeWorker.all).toHaveLength(1);
    expect(v.gotTex.map(([id]) => id)).toEqual(['t1']);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('잃었다 되찾는 사이 앞 다시 손질이 돌면 새로 시작하지 않고 그 결과를 준다', async () => {
    const { v, w } = setup();
    v.restore(['t1']);
    v.lose();
    v.restore();
    expect(FakeWorker.all).toHaveLength(1);
    expect(w.state).toBe('restoring');
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await flush();
    expect(w.state).toBe('ok');
    expect(v.restoreNeed).toBeNull();
  });

  it('새 문서로 바꾸면 앞 다시 손질을 거두고 받은 그림을 닫는다', async () => {
    const { v, w } = setup();
    v.restore(['t1']);
    const wk = FakeWorker.all[0]!;
    v.scene = sceneOf();
    w.setSource(null);
    expect(wk.terminated).toBe(true);
    expect(w.state).toBe('ok');
    expect(w.released).toBe(false);
    const res = result('t1');
    wk.emit({ id: 1, type: 'recolored', result: res });
    await flush();
    expect(v.gotTex).toEqual([]);
  });

  it('새 문서로 바꾸면 또 잃은 동안 쥐었던 그림도 닫는다', async () => {
    const { v, w } = setup();
    v.restore(['t1']);
    v.lose();
    const res = result('t1');
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: res });
    await flush();
    w.setSource(null);
    expect(res.textures[0]!.bitmap.close).toHaveBeenCalled();
  });

  it('새 파일을 여는 동안 멈추고, 열지 못해 그 문서가 그대로면 다시 손질을 잇는다', async () => {
    const { v, w } = setup();
    v.restore(['t1']);
    w.pause();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(w.state).toBe('restoring');
    w.resume();
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await flush();
    expect(w.state).toBe('ok');
    // 다시 손질이 없을 때 멈추기·잇기는 아무것도 하지 않는다
    w.pause();
    w.resume();
    expect(FakeWorker.all).toHaveLength(2);
  });

  it('바라는 것이 남았는데 지금 장면이 놓아 올린 문서가 아니면 바로 알린다', () => {
    const { v, ui, w } = setup();
    v.scene = sceneOf();
    v.restore(['t1']);
    expect(FakeWorker.all).toHaveLength(0);
    expect(w.state).toBe('partial');
    expect(ui.open).toBe(RESTORE_FAIL_TITLE);
  });

  it('없애면 알림을 더 받지 않는다', () => {
    const { v, ui, w } = setup();
    w.dispose();
    v.lose();
    expect(ui.shown).toEqual([]);
    expect(w.state).toBe('ok');
  });
});

/**
 * 바이트(Uint8Array)로 받는 무늬는 코어처럼 풀어 올리는 동안 기다리게 하는 가짜 뷰어(한 번에 몇 장을 받는지 본다).
 * 풀어 올릴 때 그 무늬가 아직 기다리는 중이면 받고, 그 사이 잃었거나 이미 받았으면 false(코어 restoreTexture — 다시 기다린다)
 */
class GatedViewer extends FakeViewer {
  inflight = 0;
  maxInflight = 0;
  lostNow = false;
  private gates: (() => void)[] = [];
  override restoreTexture(id: string, src: TextureSource): Promise<boolean> {
    if (!(src instanceof Uint8Array)) return super.restoreTexture(id, src);
    if (!this.missTex.has(id) || this.lostNow) return Promise.resolve(false);
    this.inflight++;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    return new Promise<boolean>((res) =>
      this.gates.push(() => {
        this.inflight--;
        if (this.lostNow || !this.missTex.delete(id)) return res(false);
        this.gotTex.push([id, src]);
        res(true);
        void Promise.resolve().then(() => this.checkDone());
      }),
    );
  }
  /** 기다리는 것 n개(기본 모두)를 풀어 올린다 */
  open(n = Infinity): number {
    const g = this.gates.splice(0, n);
    for (const f of g) f();
    return g.length;
  }
  override lose(): void {
    this.lostNow = true;
    super.lose();
    // 잃는 동안 풀던 것은 받지 못한다(다시 기다린다)
    this.open();
  }
  override restore(wait: string[] = [], decode = 0): void {
    this.lostNow = false;
    super.restore(wait, decode);
  }
}

const rawHeld = (id: string, bytes: number[]): HeldTexture => ({ id, blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), info: info(id, false), raw: true });
/** Blob 읽기·약속이 몇 번 돌 때까지 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};
/** 다 줄 때까지 열어 준다 */
const drain = async (v: GatedViewer): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await settle();
    if (!v.open()) break;
  }
  await settle();
};

/** 놓아 올린 문서(raw 무늬 r1~r6, 색 바꾼 무늬 t1) */
function setupRaw(): { v: GatedViewer; ui: FakeUi; w: ContextWatch; s: Scene3d; textures: HeldTexture[] } {
  const v = new GatedViewer();
  const ui = new FakeUi();
  const w = new ContextWatch(v, ui, make);
  const s = sceneOf();
  const textures = [1, 2, 3, 4, 5, 6].map((k) => rawHeld(`r${k}`, [k, k])).concat([held('t1')]);
  v.scene = s;
  w.setSource({ scene: s, textures, textureLimit: 1024 });
  return { v, ui, w, s, textures };
}
const RAW = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];

describe('되찾을 때 바이트 그대로 다시 주기(41차 — raw)', () => {
  it('raw는 손질 워커 없이 쥔 바이트를 그대로 코어에 준다(한 번에 넷까지), 색 바꾼 무늬는 손질 워커로 — 둘 다 끝나고 코어 끝 알림에 거둔다', async () => {
    const { v, ui, w } = setupRaw();
    v.lose();
    v.restore([...RAW, 't1']);
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    // 손질 워커에는 색 바꾼 무늬만
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0]!.posted[0]!.msg.textures.map((t) => t.id)).toEqual(['t1']);
    await settle();
    expect(v.inflight).toBe(RAW_RESTORE_LANES);
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: result('t1') });
    await settle();
    // 손질한 무늬를 줬어도 raw가 남았으면 그대로
    expect(w.state).toBe('restoring');
    await drain(v);
    expect(v.maxInflight).toBe(RAW_RESTORE_LANES);
    const got = new Map(v.gotTex);
    expect([...got.keys()].sort()).toEqual([...RAW, 't1']);
    for (const [k, id] of RAW.entries()) {
      const src = got.get(id) as Uint8Array;
      expect(src).toBeInstanceOf(Uint8Array);
      expect([...src]).toEqual([k + 1, k + 1]);
    }
    expect(w.last).toMatchObject({ textures: 7, left: 0 });
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('raw만 바라면 워커를 띄우지 않는다', async () => {
    const { v, w } = setupRaw();
    v.restore(['r2', 'r5']);
    await drain(v);
    expect(FakeWorker.all).toHaveLength(0);
    expect(v.gotTex.map(([id]) => id).sort()).toEqual(['r2', 'r5']);
    expect(w.state).toBe('ok');
    expect(w.last).toMatchObject({ textures: 2, left: 0 });
  });

  it('주는 동안 또 잃으면 멈추고, 되찾으면 남은 것을 다시 준다(같은 무늬를 두 번 받지 않는다)', async () => {
    const { v, ui, w } = setupRaw();
    v.restore([...RAW]);
    await settle();
    v.open(2);
    await settle();
    expect(v.gotTex.map(([id]) => id)).toEqual(['r1', 'r2']);
    v.lose();
    await settle();
    expect(w.state).toBe('lost');
    expect(ui.open).toBe(CONTEXT_LOST_TITLE);
    // 잃은 동안에는 더 주지 않는다
    expect(v.inflight).toBe(0);
    v.restore();
    await drain(v);
    expect(v.gotTex.map(([id]) => id).sort()).toEqual(RAW);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('새 파일을 여는 동안 멈추고, 열지 못하면 남은 것을 잇는다', async () => {
    const { v, w } = setupRaw();
    v.restore([...RAW]);
    await settle();
    w.pause();
    // 멈춘 뒤 받은 것은 앞 몫이라 셈하지 않고, 더 주지 않는다
    v.open();
    await settle();
    expect(v.inflight).toBe(0);
    expect(w.state).toBe('restoring');
    w.resume();
    await drain(v);
    expect(v.gotTex.map(([id]) => id).sort()).toEqual(RAW);
    expect(w.state).toBe('ok');
  });

  it('쥔 바이트를 읽지 못하면 그 무늬는 남아 평균색으로 그린다고 알린다', async () => {
    const { v, ui, w } = setupRaw();
    const broken = { size: 3, type: 'image/png', arrayBuffer: () => Promise.reject(new Error('읽지 못함')) } as unknown as Blob;
    w.setSource({ scene: v.scene!, textures: [rawHeld('r1', [1]), { ...rawHeld('r2', [2]), blob: broken }], textureLimit: 1024 });
    v.restore(['r1', 'r2']);
    await drain(v);
    expect(v.gotTex.map(([id]) => id)).toEqual(['r1']);
    expect(w.state).toBe('partial');
    expect(ui.open).toBe(RESTORE_FAIL_TITLE);
    expect(w.last).toMatchObject({ textures: 1, left: 1 });
  });

  it('새 문서로 바꾸면 주던 것을 거둔다(앞 문서 몫은 끝을 알리지 않는다)', async () => {
    const { v, ui, w } = setupRaw();
    v.restore([...RAW]);
    await settle();
    v.scene = sceneOf();
    w.setSource(null);
    v.open();
    await settle();
    expect(v.inflight).toBe(0);
    expect(w.state).toBe('ok');
    expect(w.last).toBeNull();
    expect(ui.shown.filter((s) => s.startsWith('warn'))).toEqual([]);
  });
});

describe('61차 처음 열 때 첫 그림 뒤로 미룬 색 바꾸기(pending — ContextWatch.fill)', () => {
  /** 재질 목록 견본(폴더 t1·t2의 원래 색 그림 주소) */
  const swatchImages = (): DocImages => ({
    model: null,
    materials: new Map([
      ['t1', { name: 't1.jpg', url: 'blob:old-t1' }],
      ['t2', { name: 't2.jpg', url: 'blob:old-t2' }],
    ]),
    components: new Map(),
    scenes: [],
    skipped: 0,
    urls: ['blob:old-t1', 'blob:old-t2'],
  });
  /** 놓아 올린 문서를 연다: 코어는 wait 무늬(장면에 바이트가 없는 pending)를 기다린다. t1·t2는 쥔 색 바꾼 무늬, t3은 raw */
  function opened(wait: string[] = ['t1', 't2']): { v: FakeViewer; ui: FakeUi; w: ContextWatch; s: Scene3d; images: DocImages } {
    const v = new FakeViewer();
    const ui = new FakeUi();
    const w = new ContextWatch(v, ui, make);
    const s = sceneOf();
    const images = swatchImages();
    // 화면 차례: 놓기 준비(문서 그림을 적는다) → setScene → setSource
    prepareRelease({ scene: s, images });
    v.scene = s;
    for (const id of wait) v.missTex.add(id);
    w.setSource({ scene: s, textures: [held('t1'), held('t2'), { ...held('t3'), raw: true }], textureLimit: 1024 });
    return { v, ui, w, s, images };
  }

  it('놓기 준비: 워커가 미룬 색 바꾸기(pending — 바이트는 deferredData)도 색 바꾼 무늬로 쥐고 장면에서 뺀다(코어가 그 무늬를 기다린다)', () => {
    const scene: Pick<Scene3d, 'textures' | 'meta'> = {
      textures: [
        { id: 'd', pending: true, deferredData: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', width: 4, height: 2 } as DeferredTexture,
        { id: 'n', data: new Uint8Array([4]) },
        { id: 'z', pending: true, deferredData: new Uint8Array([5]) } as DeferredTexture,
      ],
      meta: { textures: [info('d', true), info('n', true)] },
    };
    const got = prepareRelease({ scene });
    // 정보가 없는 미룬 무늬(z)는 쥐지 않는다(그 무늬는 평균색 그대로)
    expect(got.map((h) => [h.id, h.blob.type, h.blob.size, !!h.raw])).toEqual([
      ['d', 'image/jpeg', 3, false],
      ['n', '', 1, true],
    ]);
    expect(scene.textures!.map((t) => [t.id, !!t.data, !!(t as DeferredTexture).deferredData, !!t.pending])).toEqual([
      ['d', false, false, true],
      ['n', true, false, false],
      ['z', false, true, true],
    ]);
  });

  it('setSource가 코어가 기다리는 쥔 색 바꾼 무늬를 알림 없이 손질 워커(견본 포함)로 손질해 주고 재질 목록 견본을 바꾼다', async () => {
    const { v, ui, w, images } = opened();
    expect(FakeWorker.all).toHaveLength(1);
    const wk = FakeWorker.all[0]!;
    const msg = wk.posted[0]!.msg;
    expect(msg.swatches).toBe(true);
    expect(msg.textureLimit).toBe(1024);
    expect(msg.textures.map((t) => t.id)).toEqual(['t1', 't2']);
    const res: RecolorResult = { ...result('t1', 't2'), swatches: [{ folder: 't1', png: new Uint8Array([9, 8]) }] };
    wk.emit({ id: 1, type: 'recolored', result: res });
    await flush();
    expect(v.gotTex.map(([id]) => id)).toEqual(['t1', 't2']);
    // 견본이 온 폴더(t1)만 새 주소(받은 PNG), t2는 그대로
    const t1 = images.materials.get('t1')!.url;
    expect(t1).not.toBe('blob:old-t1');
    expect(images.materials.get('t2')!.url).toBe('blob:old-t2');
    expect(images.urls).toEqual([t1, 'blob:old-t2']);
    const { resolveObjectURL } = await import('node:buffer');
    expect([...new Uint8Array(await resolveObjectURL(t1)!.arrayBuffer())]).toEqual([9, 8]);
    URL.revokeObjectURL(t1);
    expect(ui.shown).toEqual([]);
    expect(ui.refreshed).toBe(0);
    expect(w.state).toBe('ok');
    expect(w.last).toMatchObject({ textures: 2, left: 0 });
    expect(wk.terminated).toBe(true);
  });

  it('코어가 기다리는 쥔 색 바꾼 무늬가 없으면(작게 연 장면·raw만) 워커를 띄우지 않는다', () => {
    opened([]);
    opened(['t3']);
    expect(FakeWorker.all).toHaveLength(0);
  });

  it('손질하지 못해도 알림 없이 평균색으로 둔다(해석 워커가 손질하지 못한 무늬를 빼던 것과 같은 모습)', async () => {
    const { ui, w } = opened();
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: 'x' });
    await flush();
    expect(ui.shown).toEqual([]);
    expect(w.state).toBe('ok');
    expect(w.last).toMatchObject({ textures: 0, left: 2 });
  });

  it('손질하는 동안 문맥을 잃으면 받은 것을 쥐었다가 되찾을 때 문맥 복구 길로 준다(워커는 한 번만)', async () => {
    const { v, ui, w } = opened();
    v.lose();
    FakeWorker.all[0]!.emit({ id: 1, type: 'recolored', result: result('t1', 't2') });
    await flush();
    expect(v.gotTex).toEqual([]);
    v.restore();
    await flush();
    expect(FakeWorker.all).toHaveLength(1);
    expect(v.gotTex.map(([id]) => id)).toEqual(['t1', 't2']);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(ui.shown).toEqual([`info:${CONTEXT_LOST_TITLE}`, `info:${RESTORE_TITLE}`]);
  });

  it('새 파일을 여는 동안 멈추고, 열지 못해 그 문서가 그대로면 알림 없이 다시 손질한다', async () => {
    const { v, ui, w } = opened();
    w.pause();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    w.resume();
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[1]!.posted[0]!.msg.swatches).toBe(true);
    FakeWorker.all[1]!.emit({ id: 1, type: 'recolored', result: result('t1', 't2') });
    await flush();
    expect(v.gotTex).toHaveLength(2);
    expect(ui.shown).toEqual([]);
    expect(w.state).toBe('ok');
  });

  it('견본 바꾸기: 재질 목록 견본 주소와 이미 그린 견본 그림을 받은 PNG의 주소로 바꾸고 앞 주소는 푼다 — 견본이 없는 폴더는 그대로', async () => {
    const images: DocImages = {
      model: null,
      materials: new Map([['a', { name: 'a.jpg', url: 'blob:old-a' }]]),
      components: new Map(),
      scenes: [],
      skipped: 0,
      urls: ['blob:old-a'],
    };
    // 이미 그린 재질 목록(견본 그림 둘 — 하나가 a의 앞 주소)
    const imgs = ['blob:old-a', 'blob:other'].map((src) => ({ src, getAttribute: function (this: { src: string }) { return this.src; } }));
    vi.stubGlobal('document', { querySelectorAll: () => imgs });
    expect(swapSwatches(images, [{ folder: 'zz', png: new Uint8Array([1]) }])).toBe(0);
    expect(swapSwatches(null, [{ folder: 'a', png: new Uint8Array([1]) }])).toBe(0);
    expect(swapSwatches(images, [{ folder: 'a', png: new Uint8Array([5, 6]) }])).toBe(1);
    const a = images.materials.get('a')!;
    expect(a.url).not.toBe('blob:old-a');
    expect(images.urls).toEqual([a.url]);
    expect(imgs.map((i) => i.src)).toEqual([a.url, 'blob:other']);
    const { resolveObjectURL } = await import('node:buffer');
    const b = resolveObjectURL(a.url)!;
    expect(b.type).toBe('image/png');
    expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([5, 6]);
    URL.revokeObjectURL(a.url);
  });
});
