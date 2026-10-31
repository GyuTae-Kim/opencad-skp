/**
 * 큰 모형의 푼 무늬 그림 놓기와 그래픽 문맥 잃음·되찾음(27차 — 코어 0.25.0, 29차에 되찾기를 바꿈. 파일을 열 때 함께 받는 조각, core.ts loadRelease).
 *
 * 놓기: 나눠 올리는 큰 모형(protocol.ts isBigScene)은 setScene(scene, { release: RELEASE_OPTIONS })로 준다. 코어는 GPU에 올린 뒤 무늬의 푼 그림
 *   (해석 워커가 손질한 ImageBitmap)만 닫고 지우며, 그림 바이트(data)는 장면에 두었다가 문맥을 되찾으면 스스로 다시 푼다.
 *   워커가 색을 바꾼 무늬는 푼 그림이 바이트와 다른 그림이라 그 바이트를 장면에서 빼 Blob으로 쥐어 둔다(prepareRelease — 되찾을 때 코어가
 *   원래 색으로 풀지 않고 앱에 다시 달라고 하게).
 *   법선·무늬 좌표는 놓지 않는다(29차): 해석 워커가 작은 정수 배열로 줄인 것(28차 — 165 MB 표본에서 23.8 MB)을 장면에 두면 문맥을 되찾을 때
 *   코어가 그대로 다시 올린다(코어 README 0.25.0 "주지 않으면 장면 배열을 붙잡고 문맥 복구 때 그대로 다시 올린다").
 *   27·28차는 둘 다 놓았다가 되찾을 때 같은 파일을 해석 워커로 다시 풀어 받았다(20~40초, 그 워커 heap 260~412 MB — 렌더러 최고치가 처음 열 때만큼 오름).
 *   이제 되찾을 때 파일을 읽지 않으므로 파일이 바뀌거나 지워져도, 주소로 받은 파일(메모리의 Blob)도 놓고 되찾는다. 작은 모형은 놓지 않는다.
 *   앱은 장면의 무늬 원본(푼 그림·색 바꾼 무늬의 바이트)을 읽지 않는다(고르기·측정·안내·단면·그림 저장은 위치·색인만 — 27차에 찾아 봄).
 *
 * 문맥 잃음·되찾음(ContextWatch — 놓기와 무관하게 모든 문서): 잃으면 짧은 안내를 보이고, 되찾으면(코어가 위치·색·법선·무늬 좌표로 다시 올리기 시작한 뒤)
 *   라벨 가림 판정을 다시 한다. 코어가 다시 달라는 무늬(쥐어 둔 색 바꾼 무늬)는 작은 손질 워커(worker/recolor.worker.ts)가
 *   처음 열 때와 같은 손질로 다시 그림을 만들어 restoreTexture로 주고 워커를 끝낸다. 그동안 그 무늬 면은 평균색이다.
 *   손질하지 못하면 평균색으로 그린다고 알린다. 손질하는 동안 또 잃으면 받은 그림을 쥐었다가 되찾을 때 준다.
 *   안내는 코어가 다시 올리기를 다 마쳤다고 알릴 때(코어 0.29.0 onContextRestoreDone — 나눠 올리기, 앱이 다시 줄 것, 코어가 장면의 그림 바이트를
 *   다시 풀어 올리기까지 모두) 거둔다(30차). 29차까지는 되찾음 알림(또는 앱이 다 준 때)에 거둬, 놓아 올린 큰 모형은 코어가 남은 무늬를 다시 푸는 동안에도
 *   안내 없이 무늬 면이 평균색이었다. 놓아 올린 문서는 그동안 무늬를 다시 준비한다고 알리고(RESTORE_TITLE), 그 밖의 문서는 잃음 안내를 그대로 둔다
 *   (코어가 쥔 그림으로 곧 끝난다 — 무늬가 없으면 되찾음 알림 바로 뒤에 끝 알림이 온다).
 */
import type { ContextRestoreNeed, TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../index';
import type { HeldTexture, RecolorRequest, RecolorResponse, RecolorResult } from './protocol';

/** 큰 모형을 올릴 때 코어에 주는 놓기 선택: 푼 무늬 그림만(그림 바이트·법선·무늬 좌표는 장면에 둔다 — 되찾을 때 코어가 그대로 다시 올린다) */
export const RELEASE_OPTIONS = { textures: 'bitmap' } as const;

/** 문맥을 잃었을 때 */
export const CONTEXT_LOST_TITLE = '3D 그래픽을 다시 준비하는 중입니다';
export const CONTEXT_LOST_TEXT = '브라우저가 그래픽 장치를 잠시 놓았습니다. 되찾는 대로 모형을 다시 그립니다.';
/** 놓아 올린 문서: 되찾은 뒤 무늬를 다 올릴 때까지(앱이 쥐어 둔 색 바꾼 무늬를 다시 손질하고 코어가 놓은 그림을 다시 푸는 동안 — 30차부터 코어 끝 알림까지) */
export const RESTORE_TITLE = '무늬를 다시 준비하는 중입니다';
export const RESTORE_TEXT = '메모리를 아끼려고 놓아 둔 무늬 그림을 다시 만듭니다. 그동안 그 무늬 면은 평균색으로 보입니다.';
/** 다시 손질하지 못했을 때 */
export const RESTORE_FAIL_TITLE = '무늬 일부를 다시 준비하지 못했습니다';
export const RESTORE_FAIL_TEXT = '그 무늬 면은 평균색으로 그립니다. 파일을 다시 열면 돌아옵니다.';

/**
 * 놓기 전(setScene 앞): 워커가 색을 바꾼 무늬(푼 그림이 바이트와 다른 그림)의 그림 바이트를 장면에서 빼 Blob으로 돌려준다(되찾을 때 다시 손질할 것).
 * Blob은 화면의 형식 배열이 아니라 브라우저가 따로 들고(큰 것은 디스크로 내보낼 수 있다), 손질 워커에 복사 없이 넘어간다.
 * 재질 목록 견본은 워커가 따로 만든 바꾼 색 PNG라 이 바이트를 쓰지 않는다
 */
export function prepareRelease(scene: Pick<Scene3d, 'textures' | 'meta'>): HeldTexture[] {
  const infos = new Map(((scene.meta?.textures ?? []) as SkpTextureInfo[]).map((t) => [t.id, t] as const));
  const held: HeldTexture[] = [];
  for (const t of scene.textures ?? []) {
    const info = infos.get(t.id);
    if (!t.bitmap || !t.data || !info?.colorize) continue;
    held.push({ id: t.id, blob: new Blob([t.data as BlobPart], t.mime ? { type: t.mime } : {}), info });
    delete t.data;
  }
  return held;
}

/** 문맥 복구용 손질 워커 만들기(시험은 가짜를 준다) */
export type WorkerFactory = () => Worker;

const newRecolorWorker: WorkerFactory = () => new Worker(new URL('../worker/recolor.worker.ts', import.meta.url), { type: 'module', name: 'opencad-skp-recolor' });

/** 다시 손질 하나: 다 받거나 실패하거나 멈추면 워커를 끝낸다 */
export interface RecolorJob {
  readonly done: Promise<RecolorResult>;
  cancel(): void;
}

export function recolorJob(make: WorkerFactory, req: Omit<RecolorRequest, 'id' | 'type'>): RecolorJob {
  let w: Worker | null = null;
  let fail: (e: Error) => void = () => undefined;
  const end = (): void => {
    if (!w) return;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
    w = null;
  };
  const done = new Promise<RecolorResult>((resolve, reject) => {
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
    w.onmessage = (ev: MessageEvent<RecolorResponse>) => {
      const m = ev.data;
      if (!m || m.id !== 1) return;
      if (m.type === 'recolored') {
        end();
        resolve(m.result);
      } else if (m.type === 'error') fail(new Error(m.message));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      fail(new Error(ev.message || 'recolor worker stopped'));
    };
    const msg: RecolorRequest = { id: 1, type: 'recolor', ...req };
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
function dropResult(res: RecolorResult | null): void {
  for (const t of res?.textures ?? [])
    try {
      t.bitmap.close();
    } catch {
      /* 이미 닫혔다 */
    }
}

/** ContextWatch가 쓰는 뷰어(코어 Viewer3d의 일부) */
export interface WatchViewer {
  readonly scene: Scene3d | null;
  readonly restoreNeed: ContextRestoreNeed | null;
  /** 코어 0.29.0: 잃은 뒤 다시 올리기가 아직 끝나지 않았는지(잃는 순간 true, 끝 알림 직전 false) */
  readonly restorePending: boolean;
  onContextLost(cb: () => void): () => void;
  onContextRestore(cb: (need: ContextRestoreNeed) => void | Promise<unknown>): () => void;
  /** 코어 0.29.0: 되찾은 뒤 다시 올리기를 다 마쳤을 때(나눠 올리기·앱이 다시 줄 것·무늬 다시 풀기 — 앱이 주지 않은 것이 남으면 오지 않는다) */
  onContextRestoreDone(cb: () => void): () => void;
  restoreTexture(id: string, src: TextureSource): Promise<boolean>;
}

/** 앱 쪽 안내(알림 보이기·우리 알림이 떠 있으면 거두기)와 라벨·치수 끝 표시 가림 판정 다시 하기 */
export interface ContextUi {
  show(kind: 'info' | 'warn', title: string, text: string): void;
  hide(): void;
  refresh(): void;
}

/** 놓아 올린 문서: 장면, 쥐어 둔 색 바꾼 무늬(prepareRelease), 처음 열 때의 무늬 한도 */
export interface ReleaseSource {
  scene: Scene3d;
  textures: readonly HeldTexture[];
  textureLimit: number;
}

/**
 * ok: 그대로 · lost: 잃음 · restoring: 되찾고 다시 올리는 중(쥐어 둔 무늬를 다시 손질하거나 코어가 무늬를 다시 풀어 올리는 중 — 코어 끝 알림까지) ·
 * partial: 다시 손질하지 못해 그 무늬를 평균색으로 그리는 중
 */
export type GraphicsState = 'ok' | 'lost' | 'restoring' | 'partial';

/** 마지막으로 놓은 것을 다시 준 기록(되찾은 때부터 다 준 때까지 ms, 받은 무늬 수, 남은 것 수) */
export interface RestoreRecord {
  ms: number;
  textures: number;
  left: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ContextWatch {
  state: GraphicsState = 'ok';
  last: RestoreRecord | null = null;
  private src: ReleaseSource | null = null;
  private job: RecolorJob | null = null;
  /** 다시 손질하는 동안 또 잃었을 때 받은 것(되찾으면 준다) */
  private stash: { src: ReleaseSource; res: RecolorResult; t0: number } | null = null;
  /** 새 파일을 여는 동안 멈춘 다시 손질(열기가 실패하면 resume) */
  private paused = false;
  private readonly offs: (() => void)[];

  constructor(
    private readonly v: WatchViewer,
    private readonly ui: ContextUi,
    private readonly makeWorker: WorkerFactory = newRecolorWorker,
  ) {
    this.offs = [v.onContextLost(() => this.lost()), v.onContextRestore((need) => this.restored(need)), v.onContextRestoreDone(() => this.done())];
  }

  /** 새 문서마다: 놓아 올렸으면 그 장면과 쥐어 둔 무늬(아니면 null). 앞 문서의 다시 손질은 거둔다 */
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

  /** 새 파일을 여는 동안 다시 손질을 멈춘다(해석과 겹치지 않게) */
  pause(): void {
    if (!this.job) return;
    this.job.cancel();
    this.job = null;
    this.paused = true;
  }

  /** 열기가 실패해 그 문서가 그대로면 멈춘 다시 손질을 잇는다 */
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
    // 안내는 코어 끝 알림(done)에 거둔다 — 그때까지 다시 올리는 중
    this.state = 'restoring';
    if (!need.meshes.length && !need.textures.length) {
      // 앱이 줄 것이 없다. 놓아 올린 문서는 코어가 놓은 그림을 다시 푸는 동안 무늬를 다시 준비한다고 알리고, 그 밖의 문서는 잃음 안내를 그대로 둔다
      // (무늬가 없으면 이 알림 바로 뒤에 끝 알림이 와 곧 거둔다)
      if (this.released) this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
      return;
    }
    const st = this.stash;
    if (st) {
      this.stash = null;
      if (st.src === this.src && this.v.scene === st.src.scene) {
        // 앞서 다시 손질해 쥐고 있던 것을 바로 준다
        this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
        void this.apply(st.src, st.res, st.t0);
        return;
      }
      dropResult(st.res);
    }
    if (this.job) {
      // 앞서 잃기 전에 시작한 다시 손질이 아직 돈다 — 끝나면 준다
      this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
      return;
    }
    this.start(need);
  }

  /**
   * 코어가 되찾은 뒤 다시 올리기를 다 마쳤다(0.29.0 onContextRestoreDone — 앱이 다 줬고 코어가 무늬까지 다 풀어 올림): 안내를 거둔다.
   * 다시 올리는 중이 아니면(새 문서·평균색 안내·다시 잃음) 그대로
   */
  private done(): void {
    if (this.state !== 'restoring' || this.job) return;
    this.state = 'ok';
    this.ui.hide();
  }

  /** 쥐어 둔 무늬 가운데 코어가 바라는 것을 다시 손질하기 시작한다(바라는 것을 쥐지 않았으면 바로 알린다) */
  private start(need: ContextRestoreNeed): void {
    const src = this.src;
    const t0 = now();
    const want = new Set(need.textures);
    const held = src && this.v.scene === src.scene ? src.textures.filter((t) => want.has(t.id)) : [];
    if (!src || !held.length) {
      this.finish(src, t0, 0);
      return;
    }
    this.state = 'restoring';
    this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
    const job = recolorJob(this.makeWorker, { textures: held.map((t) => ({ id: t.id, blob: t.blob, info: t.info })), textureLimit: src.textureLimit });
    this.job = job;
    job.done.then(
      (res) => {
        if (this.job !== job || this.src !== src || this.v.scene !== src.scene) return dropResult(res);
        this.job = null;
        // 다시 손질하는 동안 또 잃었다 — 되찾으면 준다
        if (this.state === 'lost') this.stash = { src, res, t0 };
        else void this.apply(src, res, t0);
      },
      () => {
        if (this.job !== job) return;
        this.job = null;
        if (this.state !== 'lost') this.finish(src, t0, 0);
      },
    );
  }

  private async apply(src: ReleaseSource, res: RecolorResult, t0: number): Promise<void> {
    let textures = 0;
    // 코어가 기다리지 않는 무늬면 false(받은 그림은 코어가 닫는다)
    for (const t of res.textures) if (await this.v.restoreTexture(t.id, t.bitmap)) textures++;
    this.finish(src, t0, textures);
  }

  /**
   * 앱 몫이 끝났다: 남았으면 평균색으로 그린다고 알린다. 다 주었으면 코어가 아직 무늬를 다시 푸는 동안(restorePending) 끝 알림까지 안내를 두고,
   * 이미 끝났으면(마지막 무늬를 올리며 끝 알림이 먼저 왔으면) 여기서 거둔다
   */
  private finish(src: ReleaseSource | null, t0: number, textures: number): void {
    if (src !== this.src || this.state === 'lost') return;
    const left = this.v.restoreNeed;
    this.last = { ms: Math.round(now() - t0), textures, left: left ? left.meshes.length + left.textures.length : 0 };
    this.ui.refresh();
    if (left) {
      this.state = 'partial';
      this.ui.show('warn', RESTORE_FAIL_TITLE, RESTORE_FAIL_TEXT);
    } else if (!this.v.restorePending) this.done();
  }
}
