/**
 * 큰 모형의 푼 무늬 그림 놓기와 그래픽 문맥 잃음·되찾음(27차 — 코어 0.25.0, 29차에 되찾기를 바꿈. 파일을 열 때 함께 받는 조각, core.ts loadRelease).
 *
 * 놓기: 나눠 올리는 큰 모형(protocol.ts isBigScene)은 setScene(scene, { release: RELEASE_OPTIONS })로 준다. 코어는 GPU에 올린 뒤 무늬 원본
 *   (해석 워커가 손질한 ImageBitmap과 그림 바이트 data)을 닫고 지운다. 앱은 그 전에 무늬마다 원래 그림 바이트를 Blob으로 쥐어 둔다(prepareRelease).
 *   워커가 색을 바꾼 무늬는 푼 그림이 바이트와 다른 그림이라 바이트를 장면에서 미리 빼 두고(되찾을 때 다시 손질), 나머지(코어가 푸는 JPEG·알파 없는 PNG,
 *   워커가 알파를 잰 무늬)는 되찾을 때 그 바이트를 코어에 그대로 다시 준다(raw — 코어는 처음과 같은 한도로 푼다. 41차).
 *   40차까지는 나머지의 바이트를 장면에 두어(textures: 'bitmap') 되찾을 때 코어가 스스로 다시 풀었다 — 165 MB 표본에서 화면의 ArrayBuffer 27.3 MB를
 *   문서를 연 동안 들었다. Blob은 렌더러의 형식 배열이 아니라 브라우저가 따로 들고(큰 것은 디스크로 내보낼 수 있다), 재질 목록 견본 주소가
 *   같은 바이트(같은 폴더의 그림)면 그 주소를 이 Blob으로 바꿔 브라우저도 한 벌만 든다.
 *   법선·무늬 좌표는 놓지 않는다(29차): 해석 워커가 작은 정수 배열로 줄인 것(28차 — 165 MB 표본에서 23.8 MB)을 장면에 두면 문맥을 되찾을 때
 *   코어가 그대로 다시 올린다(코어 README 0.25.0 "주지 않으면 장면 배열을 붙잡고 문맥 복구 때 그대로 다시 올린다").
 *   27·28차는 둘 다 놓았다가 되찾을 때 같은 파일을 해석 워커로 다시 풀어 받았다(20~40초, 그 워커 heap 260~412 MB — 렌더러 최고치가 처음 열 때만큼 오름).
 *   이제 되찾을 때 파일을 읽지 않으므로 파일이 바뀌거나 지워져도, 주소로 받은 파일(메모리의 Blob)도 놓고 되찾는다. 작은 모형은 놓지 않는다.
 *   앱은 장면의 무늬 원본(푼 그림·색 바꾼 무늬의 바이트)을 읽지 않는다(고르기·측정·안내·단면·그림 저장은 위치·색인만 — 27차에 찾아 봄).
 *
 * 문맥 잃음·되찾음(ContextWatch — 놓기와 무관하게 모든 문서): 잃으면 짧은 안내를 보이고, 되찾으면(코어가 위치·색·법선·무늬 좌표로 다시 올리기 시작한 뒤)
 *   라벨 가림 판정을 다시 한다. 코어가 다시 달라는 무늬 가운데 쥐어 둔 색 바꾼 무늬는 작은 손질 워커(worker/recolor.worker.ts)가
 *   처음 열 때와 같은 손질로 다시 그림을 만들어 restoreTexture로 주고 워커를 끝낸다. 나머지 쥐어 둔 무늬는 Blob의 바이트를 읽어 그대로 준다
 *   (한 번에 RAW_RESTORE_LANES장까지 — 코어가 받는 대로 푸므로 코어가 스스로 풀 때와 같은 수만큼). 그동안 그 무늬 면은 평균색이다.
 *   손질하지 못하면 평균색으로 그린다고 알린다. 손질하는 동안 또 잃으면 받은 그림을 쥐었다가 되찾을 때 준다.
 *   안내는 코어가 다시 올리기를 다 마쳤다고 알릴 때(코어 0.29.0 onContextRestoreDone — 나눠 올리기, 앱이 다시 줄 것, 코어가 장면의 그림 바이트를
 *   다시 풀어 올리기까지 모두) 거둔다(30차). 29차까지는 되찾음 알림(또는 앱이 다 준 때)에 거둬, 놓아 올린 큰 모형은 코어가 남은 무늬를 다시 푸는 동안에도
 *   안내 없이 무늬 면이 평균색이었다. 놓아 올린 문서는 그동안 무늬를 다시 준비한다고 알리고(RESTORE_TITLE), 그 밖의 문서는 잃음 안내를 그대로 둔다
 *   (코어가 쥔 그림으로 곧 끝난다 — 무늬가 없으면 되찾음 알림 바로 뒤에 끝 알림이 온다).
 *
 * 처음 열 때 미룬 색 바꾸기(61차 — 코어 0.38.0 Texture3d.pending ↔ restoreTexture): 큰 모형은 해석 워커가 알파를 잴 필요 없는 색 바꾸기
 *   (그림 머리에 알파 칸이 없는 무늬)를 손질하지 않고 pending으로 넘긴다(바이트는 deferredData). 놓기 준비가 그 바이트를 색 바꾼 무늬로 쥐고,
 *   setSource 뒤 ContextWatch.fill이 같은 손질 워커로 손질해(견본 PNG까지 — 해석 워커와 같은 그림) restoreTexture로 주고 재질 목록 견본을 바꾼다.
 *   그동안 그 무늬 면은 그물 색(평균색)이고 알림은 띄우지 않는다. 165 MB 표본에서 해석 워커가 결과를 보내기 전 손질 57장 가운데 48장이 이 몫이었다
 */
import type { ContextRestoreNeed, TextureSource } from 'opencad-viewer3d';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpTextureInfo } from '../index';
import type { DocImages } from './doc';
import type { DeferredTexture, HeldTexture, RecolorRequest, RecolorResponse, RecolorResult } from './protocol';

/**
 * 큰 모형을 올릴 때 코어에 주는 놓기 선택: 무늬 원본(푼 그림과 그림 바이트 — 앱이 Blob으로 쥐었다가 되찾을 때 다시 준다).
 * 법선·무늬 좌표는 장면에 둔다(되찾을 때 코어가 그대로 다시 올린다)
 */
export const RELEASE_OPTIONS = { textures: true } as const;

/** 되찾을 때 바이트 그대로 다시 주는 무늬를 한 번에 몇 장까지 줄지(코어가 장면의 바이트를 스스로 풀 때의 수 — 코어 TEXTURE_DECODES) */
export const RAW_RESTORE_LANES = 4;

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
 * 놓기 전(setScene 앞): 그림 바이트가 있는 무늬마다 그 바이트를 Blob으로 쥐어 돌려준다(코어가 올린 뒤 지우므로 되찾을 때 다시 줄 것).
 * - 워커가 색을 바꾼 무늬(푼 그림이 바이트와 다른 그림): 바이트를 장면에서 뺀다(되찾을 때 다시 손질 — 재질 목록 견본은 워커가 따로 만든 바꾼 색 PNG).
 * - 나머지(raw): 바이트는 코어가 처음 올릴 때 풀어야 하므로 장면에 둔다(코어가 올린 뒤 지운다). 재질 목록 견본 주소가 같은 폴더의 그림
 *   (해석기는 그 그림 바이트 배열을 그대로 무늬에 쓴다 — 폴더마다 그림 하나)이면 아직 그리기 전이므로 그 주소를 이 Blob의 주소로 바꾼다(브라우저가 한 벌만 든다).
 *   PBR 그림(55차 — meta.textures의 pbr)도 raw로 쥐지만 견본 주소는 바꾸지 않는다(같은 폴더의 색 그림이 견본이다).
 * Blob은 화면의 형식 배열이 아니라 브라우저가 따로 들고(큰 것은 디스크로 내보낼 수 있다), 손질 워커에 복사 없이 넘어간다.
 * 61차: 해석 워커가 첫 그림 뒤로 미룬 색 바꾸기(pending — 바이트는 deferredData, protocol.ts DeferredTexture)도 색 바꾼 무늬로 쥔다
 *   (코어는 그 무늬를 기다리며 그물 색으로 그리고, ContextWatch.fill이 손질해 준다 — 재질 목록 견본도 그때 바꾼다)
 */
export function prepareRelease(d: { scene: Pick<Scene3d, 'textures' | 'meta'>; images?: DocImages | null }): HeldTexture[] {
  const scene = d.scene;
  const infos = new Map(((scene.meta?.textures ?? []) as SkpTextureInfo[]).map((t) => [t.id, t] as const));
  const held: HeldTexture[] = [];
  if (d.images) sceneImages.set(scene, d.images);
  for (const t of (scene.textures ?? []) as DeferredTexture[]) {
    const info = infos.get(t.id);
    if (t.deferredData && info?.colorize) {
      held.push({ id: t.id, blob: new Blob([t.deferredData as BlobPart], t.mime ? { type: t.mime } : {}), info });
      delete t.deferredData;
      continue;
    }
    if (!t.data?.length || !info) continue;
    const blob = new Blob([t.data as BlobPart], t.mime ? { type: t.mime } : {});
    if (t.bitmap && info.colorize) {
      held.push({ id: t.id, blob, info });
      delete t.data;
    } else {
      held.push({ id: t.id, blob, info, raw: true });
      // PBR 그림(55차 — 법선·거칠기·금속)은 같은 재질 폴더라도 견본 그림이 아니다
      if (!info.pbr) swapSwatch(d.images, info.folder, blob);
    }
  }
  return held;
}

/** 61차: 놓아 올린 장면 → 그 문서의 그림(prepareRelease가 적는다 — 첫 그림 뒤로 미룬 손질의 재질 목록 견본을 바꿀 때) */
const sceneImages = new WeakMap<object, DocImages>();

/**
 * 61차: 첫 그림 뒤로 미룬 손질이 만든 색 바꾼 견본 PNG로 재질 목록 견본 주소를 바꾼다(해석 워커가 하던 견본 바꾸기 — 그 전까지는 원래 색 그림).
 * 이미 그린 재질 목록의 견본 그림(img)도 새 주소로 바꾼다(앞 주소는 푼다). 바꾼 수를 돌려준다
 */
export function swapSwatches(images: DocImages | null | undefined, list: readonly { folder: string; png: Uint8Array }[]): number {
  let n = 0;
  for (const s of list) {
    const old = images?.materials.get(s.folder)?.url;
    if (!old || !swapSwatch(images, s.folder, new Blob([s.png as BlobPart], { type: 'image/png' }))) continue;
    n++;
    const url = images!.materials.get(s.folder)!.url;
    if (typeof document !== 'undefined') for (const img of document.querySelectorAll('img')) if (img.getAttribute('src') === old) img.src = url;
  }
  return n;
}

/** 재질 목록 견본 주소를 쥔 Blob의 주소로(앞 주소는 풀고 문서를 닫을 때 풀 주소 목록도 바꾼다). 바꿨으면 true */
function swapSwatch(images: DocImages | null | undefined, folder: string, blob: Blob): boolean {
  const m = images?.materials.get(folder);
  if (!images || !m || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(blob);
  const i = images.urls.indexOf(m.url);
  try {
    URL.revokeObjectURL(m.url);
  } catch {
    /* 이미 풀렸다 */
  }
  if (i >= 0) images.urls[i] = url;
  else images.urls.push(url);
  m.url = url;
  return true;
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
  /** 바이트 그대로 다시 주는 중인 것(41차 — 거두면 cancelled). 끝나거나 거두면 null */
  private raw: { cancelled: boolean } | null = null;
  /** 이번 다시 주기에서 아직 끝나지 않은 몫(다시 손질·바이트 그대로)과 그동안 받은 무늬 수, 시작한 때 */
  private parts = 0;
  private given = 0;
  private t0 = 0;
  /** 다시 손질하는 동안 또 잃었을 때 받은 것(되찾으면 준다) */
  private stash: { src: ReleaseSource; res: RecolorResult } | null = null;
  /** 새 파일을 여는 동안 멈춘 다시 주기(열기가 실패하면 resume) — 'fill'이면 처음 열 때 미룬 손질 */
  private paused: false | 'restore' | 'fill' = false;
  /** 61차: 처음 열 때 미룬 손질을 주는 중(fill — 알림 없이). 잃거나 거두면 문맥 복구 길이 잇는다 */
  private filling = false;
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
    this.stopRaw();
    dropResult(this.stash?.res ?? null);
    this.stash = null;
    this.paused = false;
    this.filling = false;
    this.src = src;
    if (this.state !== 'lost') this.state = 'ok';
    // 61차: 해석 워커가 첫 그림 뒤로 미룬 색 바꾸기가 있으면 곧바로 손질해 준다
    if (src) this.fill();
  }

  /**
   * 61차: 처음 열 때 해석 워커가 첫 그림 뒤로 미룬 색 바꾸기(Texture3d.pending — 쥐어 둔 색 바꾼 무늬 가운데 코어가 기다리는 것)를 손질 워커로
   * 손질해 준다(setSource 바로 뒤). 알림 없이 — 그동안 그 무늬 면은 그물 색(평균색)이고, 손질하지 못한 무늬도 그대로 평균색이다.
   * 손질한 재질 목록 견본은 ui.swatches로 넘긴다. 그 사이 문맥을 잃으면 문맥 복구 길(start)이 이어받는다(받은 손질은 쥐었다가 되찾을 때 준다)
   */
  fill(): void {
    const src = this.src;
    if (!src || this.v.scene !== src.scene || this.job || this.raw || this.state !== 'ok') return;
    const want = new Set(this.v.restoreNeed?.textures ?? []);
    const list = src.textures.filter((t) => !t.raw && want.has(t.id));
    if (!list.length) return;
    this.filling = true;
    this.t0 = now();
    this.parts = 1;
    this.given = 0;
    this.recolor(src, list, true);
  }

  /** 지금 문서가 놓아 올린 것인지 */
  get released(): boolean {
    return !!this.src && this.v.scene === this.src.scene;
  }

  /** 새 파일을 여는 동안 다시 손질·다시 주기를 멈춘다(해석과 겹치지 않게) */
  pause(): void {
    if (!this.job && !this.raw) return;
    this.job?.cancel();
    this.job = null;
    this.stopRaw();
    this.paused = this.filling ? 'fill' : 'restore';
    this.filling = false;
  }

  private stopRaw(): void {
    if (this.raw) this.raw.cancelled = true;
    this.raw = null;
  }

  /** 열기가 실패해 그 문서가 그대로면 멈춘 다시 손질을 잇는다 */
  resume(): void {
    if (!this.paused) return;
    const fill = this.paused === 'fill';
    this.paused = false;
    if (fill) return this.fill();
    const need = this.v.restoreNeed;
    if (need && this.state !== 'lost') this.start(need);
  }

  dispose(): void {
    this.setSource(null);
    for (const off of this.offs) off();
  }

  private lost(): void {
    this.state = 'lost';
    // 미룬 손질을 주던 중이면 되찾을 때 문맥 복구 길(start)이 잇는다(받은 손질은 쥐었다가 준다)
    this.filling = false;
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
    this.start(need);
  }

  /**
   * 코어가 되찾은 뒤 다시 올리기를 다 마쳤다(0.29.0 onContextRestoreDone — 앱이 다 줬고 코어가 무늬까지 다 풀어 올림): 안내를 거둔다.
   * 다시 올리는 중이 아니면(새 문서·평균색 안내·다시 잃음) 그대로
   */
  private done(): void {
    if (this.state !== 'restoring' || this.job || this.raw) return;
    this.state = 'ok';
    this.ui.hide();
  }

  /**
   * 쥐어 둔 무늬 가운데 코어가 바라는 것을 다시 주기 시작한다(바라는 것을 쥐지 않았으면 바로 알린다).
   * 바이트 그대로 줄 것(raw)은 곧바로 주고, 색 바꾼 무늬는 다시 손질한다 — 앞서 또 잃는 동안 손질해 쥔 것이 있으면 그것을, 잃기 전에 시작한 손질이
   * 아직 돌면 그 결과를 준다(워커를 새로 띄우지 않는다). 두 몫이 다 끝나면 finish
   */
  private start(need: ContextRestoreNeed): void {
    const src = this.src;
    const want = new Set(need.textures);
    const held = src && this.v.scene === src.scene ? src.textures.filter((t) => want.has(t.id)) : [];
    const st = this.stash;
    this.stash = null;
    this.stopRaw();
    this.t0 = now();
    this.parts = 0;
    this.given = 0;
    const raw = held.filter((t) => t.raw);
    const recolor = held.filter((t) => !t.raw);
    const stashed = st && src && st.src === src && this.v.scene === src.scene && recolor.length ? st : null;
    if (st && st !== stashed) dropResult(st.res);
    if (!src || !held.length) {
      this.finish(src, 0);
      return;
    }
    this.state = 'restoring';
    this.ui.show('info', RESTORE_TITLE, RESTORE_TEXT);
    if (raw.length) {
      this.parts++;
      this.giveRaw(src, raw);
    }
    if (!recolor.length) return;
    this.parts++;
    // 앞서 다시 손질해 쥐고 있던 것을 바로 준다
    if (stashed) void this.apply(src, stashed.res);
    // 앞서 잃기 전에 시작한 다시 손질이 아직 돈다 — 끝나면 준다
    else if (!this.job) this.recolor(src, recolor);
  }

  private recolor(src: ReleaseSource, list: readonly HeldTexture[], swatches = false): void {
    const job = recolorJob(this.makeWorker, {
      textures: list.map((t) => ({ id: t.id, blob: t.blob, info: t.info })),
      textureLimit: src.textureLimit,
      ...(swatches ? { swatches: true } : {}),
    });
    this.job = job;
    job.done.then(
      (res) => {
        if (this.job !== job || this.src !== src || this.v.scene !== src.scene) return dropResult(res);
        this.job = null;
        // 다시 손질하는 동안 또 잃었다 — 되찾으면 준다
        if (this.state === 'lost') this.stash = { src, res };
        else void this.apply(src, res);
      },
      () => {
        if (this.job !== job) return;
        this.job = null;
        if (this.state !== 'lost') this.partDone(src, 0);
      },
    );
  }

  private async apply(src: ReleaseSource, res: RecolorResult): Promise<void> {
    // 61차: 처음 열 때 미룬 손질의 재질 목록 견본(해석 워커가 하던 견본 바꾸기)
    if (res.swatches?.length) swapSwatches(sceneImages.get(src.scene), res.swatches);
    let textures = 0;
    // 코어가 기다리지 않는 무늬면 false(받은 그림은 코어가 닫는다)
    for (const t of res.textures) if (await this.v.restoreTexture(t.id, t.bitmap)) textures++;
    this.partDone(src, textures);
  }

  /**
   * 쥐어 둔 바이트를 그대로 코어에 다시 준다(41차 — 코어는 처음 올릴 때와 같은 한도로 풀어 올린다). 한 번에 RAW_RESTORE_LANES장까지,
   * 읽지 못하거나 코어가 받지 않으면 그 무늬는 남는다(finish가 평균색 안내). 또 잃거나 거두면 멈춘다(되찾으면 남은 것을 다시 준다)
   */
  private giveRaw(src: ReleaseSource, list: readonly HeldTexture[]): void {
    const run = { cancelled: false };
    this.raw = run;
    const live = (): boolean => !run.cancelled && this.state !== 'lost' && this.src === src && this.v.scene === src.scene;
    let next = 0;
    let given = 0;
    const lane = async (): Promise<void> => {
      while (next < list.length && live()) {
        const h = list[next++]!;
        let data: Uint8Array;
        try {
          data = new Uint8Array(await h.blob.arrayBuffer());
        } catch {
          continue;
        }
        if (live() && (await this.v.restoreTexture(h.id, data))) given++;
      }
    };
    void Promise.all(Array.from({ length: Math.min(RAW_RESTORE_LANES, list.length) }, lane)).then(() => {
      if (this.raw !== run) return;
      this.raw = null;
      if (this.state !== 'lost') this.partDone(src, given);
    });
  }

  /** 다시 주기 한 몫이 끝났다: 둘 다 끝나면 finish */
  private partDone(src: ReleaseSource, textures: number): void {
    if (src !== this.src) return;
    this.given += textures;
    if (--this.parts > 0) return;
    this.finish(src, this.given);
  }

  /**
   * 앱 몫이 끝났다: 남았으면 평균색으로 그린다고 알린다. 다 주었으면 코어가 아직 무늬를 다시 푸는 동안(restorePending) 끝 알림까지 안내를 두고,
   * 이미 끝났으면(마지막 무늬를 올리며 끝 알림이 먼저 왔으면) 여기서 거둔다
   */
  private finish(src: ReleaseSource | null, textures: number): void {
    if (src !== this.src || this.state === 'lost') return;
    const left = this.v.restoreNeed;
    this.last = { ms: Math.round(now() - this.t0), textures, left: left ? left.meshes.length + left.textures.length : 0 };
    // 61차: 처음 열 때 미룬 손질은 알림 없이 끝낸다(손질하지 못한 무늬는 평균색 — 해석 워커가 손질하지 못한 무늬를 빼던 것과 같은 모습)
    if (this.filling) {
      this.filling = false;
      return;
    }
    this.ui.refresh();
    if (left) {
      this.state = 'partial';
      this.ui.show('warn', RESTORE_FAIL_TITLE, RESTORE_FAIL_TEXT);
    } else if (!this.v.restorePending) this.done();
  }
}
