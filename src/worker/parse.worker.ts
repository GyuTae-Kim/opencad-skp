/**
 * 해석 워커: SketchUp(.skp) 파일을 화면 밖에서 해석해 Scene3d로 돌려준다.
 * 화면이 그룹·컴포넌트를 여러 단계로 고를 수 있게 outline(나무)을, 부드러운 모서리·숨긴 형상(숨긴 주석 선분 포함)을 켜고 끌 수 있게 extras를,
 * 곡면을 SketchUp처럼 부드럽게 칠하게 smooth(꼭짓점 법선)를 켜고 읽는다.
 * 꾸러미 안 그림(무늬·미리보기)을 먼저 꺼내(개수·크기 한도) 무늬 재질 그림은 해석기에 넘겨 3D 무늬로 입히고(scene.textures),
 * 색을 바꾼 무늬·알파 그림은 여기서 풀어 손질한다(textures.ts). 그림 바이트는 화면이 Blob 주소로 바꾼다(견본·미리보기).
 * 결과의 형식 배열·ImageBitmap은 복사 없이 넘긴다(app/protocol.ts collectTransfers).
 * 파일은 Blob·File로 받아 통째로 읽지 않는다: 2021+ 꾸러미는 목록과 필요한 항목만 읽고 model.dat는 덩이씩 읽으며 푼다(skpFileToScene, src/range.ts).
 * 결과를 보낸 뒤 파일 내용 지문(SHA-256)을 덩이씩 읽으며 구해 따로 보낸다(측정 안내를 파일별로 기억하는 열쇠 — 화면을 기다리게 하지 않는다).
 * 34차: 큰 모형(isBigScene)은 지문을 여기서 구하지 않고 결과에 separatePrint를 단다 — 화면이 이 워커를 곧바로 끝내(heap과 해석하며 남긴 쓰레기를
 * 한꺼번에 놓는다) 지문 워커(print.worker.ts)에 묻는다.
 * 큰 모형(화면이 나눠 올리는 기준 isBigScene)은 넘기기 전에 법선·무늬 좌표를 작은 정수 배열로 줄인다(pack.ts — 28차, 코어 0.26.0).
 * 그래픽 문맥 복구 때 이 워커로 파일을 다시 풀지 않는다(29차 — 화면이 쥔 것을 코어가 다시 올리고, 색 바꾼 무늬만 작은 recolor.worker.ts가 다시 손질한다).
 */
/// <reference lib="webworker" />
import { TEXTURE_LIMIT } from 'opencad-viewer3d/texture';
import { skpFileToScene, STREAM_MIN_BYTES, type SkpFileResult, type SkpImages } from '../index';
import { collectTransfers, errorText, isBigScene, sceneHasGeometry, type DeferNotice, type ParseRequest, type ParseResponse, type ParseResult } from '../app/protocol';
import { deferAllowed, dropPbrMaps, markDeferredRecolor, PBR_MIN_TEXTURE_LIMIT, prepareSceneTextures } from './textures';
import { damageNotice, emptySceneNotice, unsupportedNotice } from './notice';
import { packBigScene } from './pack';
import { filePrint } from './print';
import { splitLongAttrs } from './attrlong';
import { progressFor } from './progress';
import { pipeInflate } from '../inflatepipe';
import { pumpInflate } from '../modelstream';
import type { SkpAttrDictsMeta } from '../meta';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: ParseResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

/** 풀기 워커(49차 — inflate.worker.ts). 워커 안에서 워커를 띄울 수 없는 곳이면 null(같은 스레드에서 푼다) */
function inflateWorker(): Worker | null {
  if (typeof Worker !== 'function') return null;
  try {
    return new Worker(new URL('./inflate.worker.ts', import.meta.url), { type: 'module', name: 'opencad-skp-inflate' });
  } catch {
    return null;
  }
}

/**
 * 파일 → 장면과 그림. 그림을 먼저 꺼내고(개수·한 장·전체 크기 한도는 readSkpImages 기본값 — 없어도 된다. 2020 이하는 여기서 모형을 다 읽고 해석기가 이어 쓴다)
 * 그 무늬 그림으로 장면을 만든다. 큰 2021+ 모형의 model.dat(압축 1 MiB 이상)는 파일에서 덩이씩 읽어 브라우저 내장 풀기로
 * 조각조각 풀면서 읽는다(직접 푸는 것보다 몇 배 빠르고, 파일 바이트도 풀린 model.dat 전체도 들지 않는다 — 안 되면 해석기가 직접 푼다).
 * 49차: 풀기는 풀기 워커가 맡아 이 워커의 객체 읽기와 겹친다(src/inflatepipe.ts — 풀면서 읽을 때만 띄우고 다 쓰면 끈다.
 * 그림·재질을 읽는 동안 미리 띄워 두는 것과 처음 열기 때가 같았다)
 */
function readScene(file: Blob, rawName: string, progress: (fraction: number, stage: string) => void): Promise<SkpFileResult> {
  const name = rawName.replace(/^.*[\\/]/, '');
  const streamMin = STREAM_MIN_BYTES;
  progress(0.01, '그림 꺼내는 중');
  const inflate = pipeInflate(inflateWorker, pumpInflate);
  // 훑기 도구(scripts/sweep/probe.ts)가 같은 선택을 쓰는지 시험이 이 줄을 견준다(tests/sweep.test.ts)
  return skpFileToScene(file, { name, outline: true, extras: true, smooth: true, onProgress: progress, streamMin, images: { onProgress: (f) => progress(0.02 + 0.6 * f, '모형 요소 읽는 중') }, inflate });
}

async function open(req: ParseRequest): Promise<ParseResult> {
  // 진행 알림(같은 단계 글은 40 ms마다, 첫 알림·나아간 새 단계 글은 곧바로 — progress.ts)
  const progress = progressFor((fraction, stage) => post({ id: req.id, type: 'progress', fraction, stage }));
  const t0 = performance.now();
  const read = await readScene(req.file, req.name, progress);
  const scene = read.scene;
  const images: SkpImages | undefined = read.images;
  const result: ParseResult = { scene, ms: 0 };
  // 55차: PBR 그림 바이트는 장면 무늬가 든다(같은 배열) — 화면 쪽 그림 목록에는 넘기지 않는다(놓기 뒤에도 화면이 붙들지 않게)
  if (images) delete images.pbr;
  if (images && (images.model || images.materials.length || images.components.length || images.scenes.length)) result.images = images;
  if (scene.textures?.length) {
    const limit = req.textureLimit && req.textureLimit > 0 ? req.textureLimit : TEXTURE_LIMIT;
    // 휴대 기기·작은 메모리(무늬 한도가 작다)는 PBR 그림을 넣지 않는다(값만 준 거칠기·금속은 둔다)
    if (limit < PBR_MIN_TEXTURE_LIMIT) dropPbrMaps(scene);
    // 61차: 큰 모형(화면이 놓아 올린다)은 알파를 잴 필요 없는 색 바꾸기를 첫 그림 뒤로 미룬다 — pending을 달고 바이트는 그대로 넘기면
    // 화면이 쥐었다가 손질 워커(recolor.worker.ts)로 손질해 준다(app/release.ts ContextWatch.fill. 165 MB 표본에서 손질 57장 가운데 48장).
    // 62차: 화면이 놓기 조각을 받았다고 알린 뒤에만(DeferNotice — 받지 못했으면 예전처럼 여기서 손질한다)
    const skip = isBigScene({ scene }) && (await deferAllowed(() => deferOk)) ? markDeferredRecolor(scene) : undefined;
    const prep = await prepareSceneTextures(scene, limit, (d, n) => progress(0.96 + (0.02 * d) / Math.max(1, n), '무늬 그림 손질하는 중'), skip?.size ? { skip } : {});
    // 색을 바꾼 무늬는 재질 목록 견본도 바꾼 색으로
    if (images && prep.swatches.size)
      images.materials = images.materials.map((m) => {
        const sw = prep.swatches.get(m.folder);
        return sw ? { ...m, bytes: sw, mime: 'image/png' } : m;
      });
  }
  // 큰 모형은 법선(Int8 정점 4값)·무늬 좌표(Int16과 변환 — 오차가 큰 그물은 Float32)를 줄여 넘긴다. 무늬 손질(무늬를 빼면 그 무늬 좌표도 지운다) 뒤에
  const packed = packBigScene(scene);
  if (packed) result.packed = packed;
  // 일부만 읽었거나 고쳐 읽은 파일의 알림(41차 — 글을 첫 화면 JS에 두지 않으려고 여기서 만든다. 화면은 그대로 보인다)
  const notice = damageNotice(scene, req.name);
  if (notice) result.notice = notice;
  // 그릴 것이 없는 장면의 알림도(53차 — 같은 까닭으로 여기서 만든다)
  if (!sceneHasGeometry(scene)) result.empty = emptySceneNotice(scene, req.name);
  // 아직 읽지 못하는 옛 판의 알림도(62차 — 같은 까닭으로 여기서 만든다. 화면은 이 알림이 있으면 장면을 보이지 않는다)
  const old = unsupportedNotice(scene, req.name);
  if (old) result.unsupported = old;
  // 아주 긴 속성 글 값은 앞부분만 장면 정보로, 원래 글은 Blob으로(47차 — 펼칠 때 화면이 잘라 읽는다)
  const long = splitLongAttrs((scene.meta as { attributes?: SkpAttrDictsMeta[] } | undefined)?.attributes);
  if (long) result.attrLong = long;
  progress(0.98, '화면으로 넘기는 중');
  result.ms = performance.now() - t0;
  return result;
}

/** 62차: 화면이 놓기 조각을 받았다고 알렸는지(DeferNotice — 받은 조각은 그 페이지에 남으므로 이 워커가 끝날 때까지 참) */
let deferOk = false;

ctx.onmessage = async (ev: MessageEvent<ParseRequest | DeferNotice>) => {
  const req = ev.data;
  if (req?.type === 'defer') {
    deferOk = true;
    return;
  }
  if (!req || req.type !== 'open') return;
  let result: ParseResult;
  try {
    result = await open(req);
  } catch (e) {
    post({ id: req.id, type: 'error', message: errorText(e) });
    return;
  }
  // 큰 모형은 지문을 지문 워커가 구한다(넘기면 배열이 비므로 넘기기 전에 가른다)
  const done: ParseResponse = isBigScene(result) ? { id: req.id, type: 'done', result, separatePrint: true } : { id: req.id, type: 'done', result };
  try {
    post(done, collectTransfers(result));
  } catch {
    // 이전이 막히면(드문 경우) 복사로 보낸다
    post(done);
  }
  if ('separatePrint' in done) return;
  // 파일 내용 지문: 결과를 보낸 뒤 덩이씩 읽으며(파일 전체를 들지 않는다). 못 구하면 null(그 파일은 안내를 기억하지 않는다)
  const digest = await filePrint(req.file);
  post({ id: req.id, type: 'print', digest }, digest ? [digest] : []);
};
