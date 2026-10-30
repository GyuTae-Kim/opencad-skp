/**
 * 큰 모형의 법선·무늬 좌표·푼 무늬 그림 놓기와 그래픽 문맥 잃음·되찾음(27차 — 코어 0.25.0, 파일을 열 때 함께 받는 조각, core.ts loadRelease).
 *
 * 놓기: 나눠 올리는 큰 모형(doc.ts isBigScene)을 디스크의 파일(File — 고른 파일·끌어 놓은 파일·최근 문서)에서 열었으면
 *   setScene(scene, { release: RELEASE_OPTIONS })로 준다. 코어는 GPU에 올린 뒤 그물 법선·무늬 좌표와 무늬의 푼 그림(워커가 손질한 ImageBitmap)을
 *   장면 객체에서 지우고, 그림 바이트(data)는 두어 문맥을 되찾으면 스스로 다시 푼다. 워커가 색을 바꾼 무늬는 푼 그림이 바이트와 다른 그림이라
 *   미리 바이트를 빼 둔다(prepareRelease — 되찾을 때 코어가 원래 색으로 풀지 않고 앱에 다시 달라고 하게).
 *   주소로 받은 파일·예제처럼 메모리에 있는 파일은 다시 읽으려면 파일 바이트를 쥐고 있어야 해서 놓지 않는다. 작은 모형도 놓지 않는다.
 *   놓은 뒤에는 앱 어디에서도 장면의 법선·무늬 좌표·무늬 원본을 읽지 않는다(고르기·측정·안내·단면은 위치·색인만 쓴다 — 27차에 찾아 봄).
 *
 * 문맥 잃음·되찾음(ContextWatch — 놓기와 무관하게 모든 문서): 잃으면 짧은 안내를 보이고, 되찾으면(코어가 위치·색으로 다시 올린 뒤) 안내를 거두고
 *   라벨 가림 판정을 다시 한다. 놓은 것이 있으면 같은 파일을 새 해석 워커로 처음 열 때와 같은 선택으로 다시 풀어, 놓은 그물 배열과 색을 바꾼 무늬만
 *   받아 코어에 돌려주고 워커를 끝낸다(restoreMeshArrays·restoreTexture). 그동안 무늬 면은 평균색, 곡면은 각진 음영이다.
 *   다시 읽지 못하면(파일이 바뀌었거나 지워짐) 그대로 그린다고 알린다. 다시 읽는 동안 또 잃으면 받은 것을 쥐었다가 되찾을 때 준다.
 */
import type { ContextRestoreNeed, MeshArrays, TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../index';
import type { ArraysRequest, ArraysResult, ArraysWant, ParseResponse } from './protocol';

/** 큰 모형을 올릴 때 코어에 주는 놓기 선택: 법선·무늬 좌표와 푼 그림만(그림 바이트는 둔다) */
export const RELEASE_OPTIONS = { normals: true, uvs: true, textures: 'bitmap' } as const;

/** 문맥을 잃었을 때 */
export const CONTEXT_LOST_TITLE = '3D 그래픽을 다시 준비하는 중입니다';
export const CONTEXT_LOST_TEXT = '브라우저가 그래픽 장치를 잠시 놓았습니다. 되찾는 대로 모형을 다시 그립니다.';
/** 되찾은 뒤 놓은 것을 파일에서 다시 읽는 동안 */
export const RESTORE_TITLE = '무늬와 곡면 음영을 다시 읽는 중입니다';
export const RESTORE_TEXT = '메모리를 아끼려고 놓아 둔 무늬와 음영 자료를 파일에서 다시 읽습니다. 그동안 무늬 면은 평균색으로, 곡면은 각진 음영으로 보입니다.';
/** 다시 읽지 못했을 때 */
export const RESTORE_FAIL_TITLE = '무늬와 곡면 음영을 다시 읽지 못했습니다';
export const RESTORE_FAIL_TEXT = '무늬 면은 평균색으로, 곡면은 각진 음영으로 그립니다. 파일을 다시 열면 돌아옵니다.';

/**
 * 놓기 전(setScene 앞): 워커가 색을 바꾼 무늬(푼 그림이 바이트와 다른 그림)의 그림 바이트를 뺀다. 뺀 무늬 수.
 * 재질 목록 견본은 워커가 따로 만든 바꾼 색 PNG라 이 바이트를 쓰지 않는다
 */
export function prepareRelease(scene: Pick<Scene3d, 'textures' | 'meta'>): number {
  const infos = new Map(((scene.meta?.textures ?? []) as SkpTextureInfo[]).map((t) => [t.id, t] as const));
  let n = 0;
  for (const t of scene.textures ?? [])
    if (t.bitmap && t.data && infos.get(t.id)?.colorize) {
      delete t.data;
      n++;
    }
  return n;
}

/** 문맥 복구용 해석 워커 만들기(시험은 가짜를 준다) */
export type WorkerFactory = () => Worker;

const newParseWorker: WorkerFactory = () => new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module', name: 'opencad-skp-restore' });

/** 다시 풀어 받기 하나: 다 받거나 실패하거나 멈추면 워커를 끝낸다(다시 푸는 동안 커진 워커 메모리를 바로 놓는다) */
export interface ArraysJob {
  readonly done: Promise<ArraysResult>;
  cancel(): void;
}

export function arraysJob(make: WorkerFactory, req: Omit<ArraysRequest, 'id' | 'type'>): ArraysJob {
  let w: Worker | null = null;
  let fail: (e: Error) => void = () => undefined;
  const end = (): void => {
    if (!w) return;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
    w = null;
  };
  const done = new Promise<ArraysResult>((resolve, reject) => {
    fail = (e) => {
      end();
      reject(e);
    };
    try {
      w = make();
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    w.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const m = ev.data;
      if (!m || m.id !== 1) return;
      if (m.type === 'arrays') {
        end();
        resolve(m.result);
      } else if (m.type === 'error') fail(new Error(m.message));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      fail(new Error(ev.message || 'restore worker stopped'));
    };
    const msg: ArraysRequest = { id: 1, type: 'arrays', ...req };
    try {
      w.postMessage(msg);
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
  });
  done.catch(() => undefined);
  return { done, cancel: () => fail(new Error('cancelled')) };
}

/** 받은 것을 쓰지 않을 때: 손질한 그림을 닫는다 */
function dropResult(res: ArraysResult | null): void {
  for (const t of res?.textures ?? [])
    try {
      t.bitmap?.close();
    } catch {
      /* 이미 닫혔다 */
    }
}

/** ContextWatch가 쓰는 뷰어(코어 Viewer3d의 일부) */
export interface WatchViewer {
  readonly scene: Scene3d | null;
  readonly restoreNeed: ContextRestoreNeed | null;
  onContextLost(cb: () => void): () => void;
  onContextRestore(cb: (need: ContextRestoreNeed) => void | Promise<unknown>): () => void;
  restoreMeshArrays(id: string, arrays: MeshArrays): boolean;
  restoreTexture(id: string, src: TextureSource): Promise<boolean>;
}

/** 앱 쪽 안내(알림 보이기·우리 알림이 떠 있으면 거두기)와 라벨·치수 끝 표시 가림 판정 다시 하기 */
export interface ContextUi {
  show(kind: 'info' | 'warn', title: string, text: string): void;
  hide(): void;
  refresh(): void;
}

/** 놓아 올린 문서: 다시 읽을 파일과 처음 열 때의 무늬 한도 */
export interface ReleaseSource {
  scene: Scene3d;
  file: Blob;
  name: string;
  textureLimit: number;
}

/** ok: 그대로 · lost: 잃음 · restoring: 되찾고 놓은 것을 다시 읽는 중 · partial: 다시 읽지 못해 위치·색으로 그리는 중 */
export type GraphicsState = 'ok' | 'lost' | 'restoring' | 'partial';

/** 마지막으로 놓은 것을 다시 준 기록(되찾은 때부터 다 준 때까지 ms, 받은 그물·무늬 수, 남은 것 수) */
export interface RestoreRecord {
  ms: number;
  meshes: number;
  textures: number;
  left: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ContextWatch {
  state: GraphicsState = 'ok';
  last: RestoreRecord | null = null;
  private src: ReleaseSource | null = null;
  private job: ArraysJob | null = null;
  /** 다시 읽는 동안 또 잃었을 때 받은 것(되찾으면 준다) */
  private stash: { src: ReleaseSource; res: ArraysResult; t0: number } | null = null;
  /** 새 파일을 여는 동안 멈춘 다시 읽기(열기가 실패하면 resume) */
  private paused = false;
  private readonly offs: (() => void)[];

  constructor(
    private readonly v: WatchViewer,
    private readonly ui: ContextUi,
    private readonly makeWorker: WorkerFactory = newParseWorker,
  ) {
    this.offs = [v.onContextLost(() => this.lost()), v.onContextRestore((need) => this.restored(need))];
  }

  /** 새 문서마다: 놓아 올렸으면 다시 읽을 파일(아니면 null). 앞 문서의 다시 읽기는 거둔다 */
  setSource(src: ReleaseSource | null): void {
    this.job?.cancel();
    this.job = null;
    dropResult(this.stash?.res ?? null);
    this.stash = null;
    this.paused = false;
    this.src = src;
    if (this.state !== 'lost') this.state = 'ok';
  }

  /** 지금 문서가 놓아 올린 것인지 */
  get released(): boolean {
    return !!this.src && this.v.scene === this.src.scene;
  }

  /** 새 파일을 여는 동안 다시 읽기를 멈춘다(큰 해석 둘이 겹치지 않게) */
  pause(): void {
    if (!this.job) return;
    this.job.cancel();
    this.job = null;
    this.paused = true;
  }

  /** 열기가 실패해 그 문서가 그대로면 멈춘 다시 읽기를 잇는다 */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const need = this.v.restoreNeed;
    if (need && this.state !== 'lost') this.start(need);
  }

  dispose(): void {
    this.setSource(null);
    for (const off of this.offs) off();
  }

  private lost(): void {
    this.state = 'lost';
    this.ui.show('info', CONTEXT_LOST_TITLE, CONTEXT_LOST_TEXT);
  }

  private restored(need: ContextRestoreNeed): void {
    this.ui.refresh();
    if (!need.meshes.length && !need.textures.length) {
      this.state = 'ok';
      this.ui.hide();
      return;
    }
    const st = this.stash;
    if (st) {
      this.stash = null;
      if (st.src === this.src && this.v.scene === st.src.scene) {
        // 앞서 다시 읽어 쥐고 있던 것을 바로 준다
        this.state = 'restoring';
        void this.apply(st.src, st.res, st.t0);
        return;
      }
      dropResult(st.res);
    }
    if (this.job) {
      // 앞서 잃기 전에 시작한 다시 읽기가 아직 돈다 — 끝나면 준다
      this.state = 'restoring';
      this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
      return;
    }
    this.start(need);
  }

  /** 놓은 것을 파일에서 다시 읽기 시작한다 */
  private start(need: ContextRestoreNeed): void {
    const src = this.src;
    const t0 = now();
    if (!src || this.v.scene !== src.scene) {
      this.finish(src, t0, 0, 0);
      return;
    }
    this.state = 'restoring';
    this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
    const byId = new Map(src.scene.meshes.map((m) => [m.id, m] as const));
    const meshes: ArraysWant[] = need.meshes.map((m) => ({
      id: m.id,
      nv: (byId.get(m.id)?.positions.length ?? 0) / 3,
      normals: m.normals,
      uvs: m.uvs,
      backUvs: m.backUvs,
    }));
    const job = arraysJob(this.makeWorker, { name: src.name, file: src.file, meshes, textures: [...need.textures], textureLimit: src.textureLimit });
    this.job = job;
    job.done.then(
      (res) => {
        if (this.job !== job || this.src !== src || this.v.scene !== src.scene) return dropResult(res);
        this.job = null;
        // 다시 읽는 동안 또 잃었다 — 되찾으면 준다
        if (this.state === 'lost') this.stash = { src, res, t0 };
        else void this.apply(src, res, t0);
      },
      () => {
        if (this.job !== job) return;
        this.job = null;
        if (this.state !== 'lost') this.finish(src, t0, 0, 0);
      },
    );
  }

  private async apply(src: ReleaseSource, res: ArraysResult, t0: number): Promise<void> {
    let meshes = 0;
    let textures = 0;
    for (const m of res.meshes) if (this.v.restoreMeshArrays(m.id, m)) meshes++;
    for (const t of res.textures) if (await this.v.restoreTexture(t.id, t.bitmap ?? t)) textures++;
    this.finish(src, t0, meshes, textures);
  }

  /** 다 주었으면 안내를 거두고, 남았으면 위치·색으로 그린다고 알린다 */
  private finish(src: ReleaseSource | null, t0: number, meshes: number, textures: number): void {
    if (src !== this.src || this.state === 'lost') return;
    const left = this.v.restoreNeed;
    this.last = { ms: Math.round(now() - t0), meshes, textures, left: left ? left.meshes.length + left.textures.length : 0 };
    this.ui.refresh();
    if (!left) {
      this.state = 'ok';
      this.ui.hide();
    } else {
      this.state = 'partial';
      this.ui.show('warn', RESTORE_FAIL_TITLE, RESTORE_FAIL_TEXT);
    }
  }
}
