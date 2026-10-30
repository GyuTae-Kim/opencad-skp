/**
 * 큰 모형 놓기와 그래픽 문맥 잃음·되찾음(src/app/release.ts — 27차, 코어 0.25.0): 색을 바꾼 무늬의 바이트만 빼 두기, 다시 풀기 워커 한 번 쓰고 끝내기,
 * 잃으면 안내·되찾으면 거두고 가림 판정 다시 하기, 놓은 것을 파일에서 다시 읽어 코어에 주기(실패·또 잃음·새 문서·새 파일 여는 동안 멈춤).
 * 가짜 뷰어(코어 Viewer3d의 일부)와 가짜 Worker로 차례를 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextRestoreNeed, MeshArrays, TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { ArraysRequest, ArraysResult } from '../../src/app/protocol';
import {
  CONTEXT_LOST_TITLE,
  ContextWatch,
  RELEASE_OPTIONS,
  RESTORE_FAIL_TITLE,
  RESTORE_TITLE,
  arraysJob,
  prepareRelease,
  type ContextUi,
  type WatchViewer,
} from '../../src/app/release';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  posted: { msg: ArraysRequest; transfer: unknown }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: ArraysRequest, transfer?: unknown): void {
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

/** 가짜 뷰어: 놓은 그물(id → 다시 받을 배열)과 기다리는 무늬를 들고, 받은 것을 지운다 */
class FakeViewer implements WatchViewer {
  scene: Scene3d | null = null;
  missMeshes = new Map<string, { normals: boolean; uvs: boolean; backUvs: boolean }>();
  missTex = new Set<string>();
  gotMeshes: [string, MeshArrays][] = [];
  gotTex: [string, TextureSource][] = [];
  private lostCb: (() => void) | null = null;
  private restoreCb: ((need: ContextRestoreNeed) => unknown) | null = null;
  get restoreNeed(): ContextRestoreNeed | null {
    const n = this.need();
    return n.meshes.length || n.textures.length ? n : null;
  }
  need(): ContextRestoreNeed {
    return { meshes: [...this.missMeshes].map(([id, m]) => ({ id, ...m })), textures: [...this.missTex] };
  }
  onContextLost(cb: () => void): () => void {
    this.lostCb = cb;
    return () => (this.lostCb = null);
  }
  onContextRestore(cb: (need: ContextRestoreNeed) => unknown): () => void {
    this.restoreCb = cb;
    return () => (this.restoreCb = null);
  }
  restoreMeshArrays(id: string, a: MeshArrays): boolean {
    const m = this.missMeshes.get(id);
    if (!m) return false;
    this.gotMeshes.push([id, a]);
    this.missMeshes.delete(id);
    return true;
  }
  restoreTexture(id: string, src: TextureSource): Promise<boolean> {
    if (!this.missTex.delete(id)) return Promise.resolve(false);
    this.gotTex.push([id, src]);
    return Promise.resolve(true);
  }
  lose(): void {
    this.lostCb?.();
  }
  restore(): void {
    void this.restoreCb?.(this.need());
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

const mesh = (id: string, nv: number): Scene3d['meshes'][number] => ({ id, positions: new Float32Array(nv * 3), color: [1, 1, 1, 1] });
const sceneOf = (): Scene3d => ({ name: 's', units: 'mm', meshes: [mesh('m1', 3), mesh('m2', 4)], lines: [] });
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** 놓아 올린 문서와 문맥을 잃었다 되찾은 상태(m1 법선·무늬 좌표, m2 법선, 무늬 t1을 다시 받아야 함) */
function setup(): { v: FakeViewer; ui: FakeUi; w: ContextWatch; s: Scene3d; file: Blob } {
  const v = new FakeViewer();
  const ui = new FakeUi();
  const w = new ContextWatch(v, ui, make);
  const s = sceneOf();
  const file = new Blob([new Uint8Array([1, 2, 3])]);
  v.scene = s;
  w.setSource({ scene: s, file, name: 'a.skp', textureLimit: 1024 });
  v.missMeshes.set('m1', { normals: true, uvs: true, backUvs: false });
  v.missMeshes.set('m2', { normals: true, uvs: false, backUvs: false });
  v.missTex.add('t1');
  return { v, ui, w, s, file };
}

const fullResult = (): ArraysResult => ({
  meshes: [
    { id: 'm1', normals: new Float32Array(9), uvs: new Float32Array(6) },
    { id: 'm2', normals: new Float32Array(12) },
  ],
  textures: [{ id: 't1', bitmap: { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap, width: 2, height: 2 }],
  ms: 5,
});

beforeEach(() => {
  FakeWorker.all = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('놓기 준비', () => {
  it('색을 바꾼 무늬(워커가 그림을 바꾼 것)만 그림 바이트를 빼고, 알파만 잰 무늬·바이트뿐인 무늬는 둔다', () => {
    const bmp = {} as ImageBitmap;
    const scene: Pick<Scene3d, 'textures' | 'meta'> = {
      textures: [
        { id: 'c', bitmap: bmp, data: new Uint8Array([1]) },
        { id: 'a', bitmap: bmp, data: new Uint8Array([2]), alpha: true },
        { id: 'p', data: new Uint8Array([3]) },
        { id: 'n', data: new Uint8Array([4]) },
      ],
      meta: {
        textures: [
          { id: 'c', colorize: { type: 'tint', color: [1, 2, 3] } },
          { id: 'a', alphaPossible: true },
          { id: 'p' },
          { id: 'n', colorize: { type: 'shift', color: [1, 2, 3] } },
        ],
      },
    };
    expect(prepareRelease(scene)).toBe(1);
    expect(scene.textures!.map((t) => [t.id, !!t.data, !!t.bitmap])).toEqual([
      ['c', false, true],
      ['a', true, true],
      ['p', true, false],
      ['n', true, false],
    ]);
    expect(prepareRelease({})).toBe(0);
    expect(RELEASE_OPTIONS).toEqual({ normals: true, uvs: true, textures: 'bitmap' });
  });
});

describe('다시 풀기 워커', () => {
  it('파일을 그대로 넘기고(이전 목록 없음) 받으면 워커를 끝낸다', async () => {
    const file = new Blob([new Uint8Array([1])]);
    const job = arraysJob(make, { name: 'a.skp', file, meshes: [{ id: 'm', nv: 3, normals: true, uvs: false, backUvs: false }], textures: ['t'], textureLimit: 512 });
    const w = FakeWorker.all[0]!;
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.msg).toMatchObject({ id: 1, type: 'arrays', name: 'a.skp', textures: ['t'], textureLimit: 512 });
    expect(w.posted[0]!.msg.file).toBe(file);
    expect(w.posted[0]!.transfer).toBeUndefined();
    w.emit({ id: 1, type: 'progress', fraction: 0.5, stage: '읽는 중' });
    expect(w.terminated).toBe(false);
    const res = fullResult();
    w.emit({ id: 1, type: 'arrays', result: res });
    await expect(job.done).resolves.toBe(res);
    expect(w.terminated).toBe(true);
  });

  it('오류·워커 멈춤·멈추기는 거부하고 워커를 끝낸다', async () => {
    const req = { name: 'a', file: new Blob([]), meshes: [], textures: [] };
    const a = arraysJob(make, req);
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: '깨짐' });
    await expect(a.done).rejects.toThrow('깨짐');
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    const b = arraysJob(make, req);
    const ev = { message: '', preventDefault: vi.fn() } as unknown as ErrorEvent;
    FakeWorker.all[1]!.onerror!(ev);
    await expect(b.done).rejects.toThrow();
    expect(FakeWorker.all[1]!.terminated).toBe(true);
    const c = arraysJob(make, req);
    c.cancel();
    await expect(c.done).rejects.toThrow();
    expect(FakeWorker.all[2]!.terminated).toBe(true);
    const d = arraysJob(() => {
      throw new Error('워커 없음');
    }, req);
    await expect(d.done).rejects.toThrow('워커 없음');
  });
});

describe('그래픽 문맥 잃음·되찾음', () => {
  it('잃으면 안내, 놓은 것 없이 되찾으면(빈 need) 거두고 가림 판정을 다시 한다 — 워커는 쓰지 않는다', () => {
    const v = new FakeViewer();
    const ui = new FakeUi();
    const w = new ContextWatch(v, ui, make);
    v.scene = sceneOf();
    v.lose();
    expect(w.state).toBe('lost');
    expect(ui.open).toBe(CONTEXT_LOST_TITLE);
    v.restore();
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(ui.refreshed).toBe(1);
    expect(FakeWorker.all).toHaveLength(0);
    expect(w.released).toBe(false);
  });

  it('놓아 올린 문서: 되찾으면 파일을 다시 풀어 바란 그물 배열·무늬를 코어에 주고 안내를 거둔다', async () => {
    const { v, ui, w, file } = setup();
    expect(w.released).toBe(true);
    v.lose();
    v.restore();
    expect(w.state).toBe('restoring');
    expect(ui.open).toBe(RESTORE_TITLE);
    const wk = FakeWorker.all[0]!;
    const msg = wk.posted[0]!.msg;
    expect(msg.file).toBe(file);
    expect(msg.textureLimit).toBe(1024);
    expect(msg.meshes).toEqual([
      { id: 'm1', nv: 3, normals: true, uvs: true, backUvs: false },
      { id: 'm2', nv: 4, normals: true, uvs: false, backUvs: false },
    ]);
    expect(msg.textures).toEqual(['t1']);
    const res = fullResult();
    wk.emit({ id: 1, type: 'arrays', result: res });
    await flush();
    expect(v.gotMeshes.map(([id]) => id)).toEqual(['m1', 'm2']);
    expect(v.gotMeshes[0]![1].uvs).toBe(res.meshes[0]!.uvs);
    expect(v.gotTex).toEqual([['t1', res.textures[0]!.bitmap]]);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
    expect(w.last).toMatchObject({ meshes: 2, textures: 1, left: 0 });
    expect(wk.terminated).toBe(true);
    expect(ui.refreshed).toBe(2);
  });

  it('다시 읽지 못하거나 덜 받으면 위치·색으로 그린다고 알린다', async () => {
    const { v, ui, w } = setup();
    v.restore();
    FakeWorker.all[0]!.emit({ id: 1, type: 'error', message: '파일을 읽지 못함' });
    await flush();
    expect(w.state).toBe('partial');
    expect(ui.shown.at(-1)).toBe(`warn:${RESTORE_FAIL_TITLE}`);
    // 다시 잃었다 되찾으면 또 해 본다: 이번엔 그물 하나가 빠졌다(파일이 바뀜 — 워커가 정점 수로 뺌)
    v.lose();
    v.restore();
    const res = fullResult();
    res.meshes = res.meshes.slice(0, 1);
    FakeWorker.all[1]!.emit({ id: 1, type: 'arrays', result: res });
    await flush();
    expect(w.state).toBe('partial');
    expect(w.last).toMatchObject({ meshes: 1, textures: 1, left: 1 });
  });

  it('다시 읽는 동안 또 잃으면 받은 것을 쥐었다가 되찾을 때 준다(워커는 한 번만)', async () => {
    const { v, ui, w } = setup();
    v.restore();
    v.lose();
    expect(w.state).toBe('lost');
    FakeWorker.all[0]!.emit({ id: 1, type: 'arrays', result: fullResult() });
    await flush();
    expect(v.gotMeshes).toEqual([]);
    v.restore();
    await flush();
    expect(FakeWorker.all).toHaveLength(1);
    expect(v.gotMeshes.map(([id]) => id)).toEqual(['m1', 'm2']);
    expect(w.state).toBe('ok');
    expect(ui.open).toBeNull();
  });

  it('잃었다 되찾는 사이 앞 다시 읽기가 돌면 새로 시작하지 않고 그 결과를 준다', async () => {
    const { v, w } = setup();
    v.restore();
    v.lose();
    v.restore();
    expect(FakeWorker.all).toHaveLength(1);
    expect(w.state).toBe('restoring');
    FakeWorker.all[0]!.emit({ id: 1, type: 'arrays', result: fullResult() });
    await flush();
    expect(w.state).toBe('ok');
    expect(v.restoreNeed).toBeNull();
  });

  it('새 문서로 바꾸면 앞 다시 읽기를 거두고 받은 그림을 닫는다', async () => {
    const { v, w } = setup();
    v.restore();
    const wk = FakeWorker.all[0]!;
    const next = sceneOf();
    v.scene = next;
    w.setSource(null);
    expect(wk.terminated).toBe(true);
    expect(w.state).toBe('ok');
    expect(w.released).toBe(false);
    const res = fullResult();
    wk.emit({ id: 1, type: 'arrays', result: res });
    await flush();
    expect(v.gotMeshes).toEqual([]);
  });

  it('새 파일을 여는 동안 멈추고, 열지 못해 그 문서가 그대로면 다시 읽기를 잇는다', async () => {
    const { v, w } = setup();
    v.restore();
    w.pause();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(w.state).toBe('restoring');
    w.resume();
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1]!.emit({ id: 1, type: 'arrays', result: fullResult() });
    await flush();
    expect(w.state).toBe('ok');
    // 다시 읽기가 없을 때 멈추기·잇기는 아무것도 하지 않는다
    w.pause();
    w.resume();
    expect(FakeWorker.all).toHaveLength(2);
  });

  it('놓은 것이 남았는데 다시 읽을 파일이 없으면(지금 장면이 그 문서가 아님) 바로 알린다', () => {
    const { v, ui, w } = setup();
    v.scene = sceneOf();
    v.restore();
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
