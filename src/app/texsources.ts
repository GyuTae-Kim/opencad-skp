/**
 * GPU에 다 올린 무늬 그림의 원본 놓기(23차 — 문서를 연 뒤 나눠 받는 조각, core.ts loadTexSources).
 *
 * 코어는 무늬마다 원본(해석 워커가 색을 바꾸거나 알파를 잰 ImageBitmap, 아니면 그림 파일 바이트)을 GPU 한도에 맞춰 다시 풀어 올린 뒤에도
 * 원본을 장면(Scene3d.textures)에 둔 채 쥐고 있다 — 그래픽 문맥을 잃었다 되찾을 때 다시 올리려고. 큰 모형은 이 원본이 화면 쪽 메모리의
 * 큰 몫이다(165 MB 표본: 무늬 115장 — 그림 51장의 화소 148 MB 어림과 그림 파일 바이트 43 MB, 다 올린 뒤 ArrayBuffer 272 MB 가운데).
 * 그래서 장면을 다 올리고 쓰는 무늬가 모두 풀린(또는 못 풀린) 뒤 원본이 모두 합쳐 TEXTURE_KEEP_BYTES 이상이면 그림은 닫고 바이트는 놓는다.
 * 작은 모형은 그대로 둔다(문맥을 되찾아도 무늬가 그대로).
 *
 * 놓은 뒤 문맥을 잃었다 되찾으면 코어가 무늬를 다시 풀지 못해(그 무늬는 '못 풂') 그 면을 평균색(그물 색)으로 그린다 — 그때 알린다.
 * 그물의 법선·무늬 좌표 배열도 GPU에만 쓰지만 코어 렌더러가 다시 묶을 때 배열 길이를 다시 보고(구간 강조·숨김의 VAO) 문맥 복구에도 써서
 * 앱이 놓지 않는다(코어 요청 거리).
 */
import type { Scene3d, Texture3d } from 'opencad-viewer3d/types';

/** 이만큼(그림 화소 RGBA + 바이트) 넘는 무늬 원본만 놓는다 — 작은 모형은 문맥 복구 때 무늬가 그대로이게 */
export const TEXTURE_KEEP_BYTES = 32 * 1024 * 1024;

/** 쓰는 무늬가 모두 풀렸는지 볼 간격과 그만 볼 때(ms) */
const SETTLE_EVERY_MS = 400;
const SETTLE_MAX_MS = 5 * 60 * 1000;

/** 원본을 놓은 뒤 문맥을 되찾았을 때 알림 */
export const TEXTURE_LOST_TITLE = '무늬 그림을 평균색으로 그렸습니다';
export const TEXTURE_LOST_TEXT =
  '그래픽 장치를 다시 잡는 동안 이 모형의 무늬 그림을 다시 올리지 못했습니다(큰 모형은 메모리를 아끼려고 무늬를 올린 뒤 원본을 놓습니다). 파일을 다시 열면 무늬가 돌아옵니다.';

/** 무늬 원본 바이트: 열린 그림의 화소(RGBA 4바이트)와 그림 파일 바이트 */
export function textureSourceBytes(textures: readonly Texture3d[] | undefined): number {
  let n = 0;
  for (const t of textures ?? []) {
    const b = t.bitmap;
    if (b && b.width > 0 && b.height > 0) n += b.width * b.height * 4;
    if (t.data) n += t.data.byteLength;
  }
  return n;
}

/** 쓰는 무늬가 모두 풀렸거나 못 풀렸는지(코어 Viewer3d.stats.textures) */
export function texturesSettled(s: { count: number; ready: number; failed: number } | null | undefined): boolean {
  return !!s && s.ready + s.failed >= s.count;
}

/** 무늬 원본을 놓는다(그림은 닫고 바이트는 뺀다 — 무늬 id·크기·알파는 둔다). 원본이 keep보다 작으면 그대로. 놓은 바이트(어림)를 준다 */
export function releaseTextureSources(textures: readonly Texture3d[] | undefined, keep = TEXTURE_KEEP_BYTES): number {
  const n = textureSourceBytes(textures);
  if (!textures?.length || n < keep) return 0;
  for (const t of textures) {
    try {
      t.bitmap?.close();
    } catch {
      /* 이미 닫혔다 */
    }
    delete t.bitmap;
    delete t.data;
  }
  return n;
}

/** 이 조각이 쓰는 뷰어(코어 Viewer3d의 일부) */
export interface TexViewer {
  readonly canvas: HTMLCanvasElement;
  readonly stats: { textures: { count: number; ready: number; failed: number } };
}

/**
 * 장면을 다 올린 뒤(앱이 부른다): 쓰는 무늬가 모두 풀릴 때까지 SETTLE_EVERY_MS마다 보다가 원본을 놓는다(releaseTextureSources).
 * current()가 거짓이 되면(다른 문서를 열었다) 그만둔다. 놓았으면 그 뒤 문맥을 되찾을 때(그 문서가 그대로면) lost(제목, 글)로 알린다.
 * 놓은 바이트(놓지 않았으면 0)를 준다
 */
export function releaseWhenSettled(
  v: TexViewer,
  scene: Pick<Scene3d, 'textures'>,
  current: () => boolean,
  lost: (title: string, text: string) => void,
  o: { keep?: number; every?: number; max?: number } = {},
): Promise<number> {
  const keep = o.keep ?? TEXTURE_KEEP_BYTES;
  // 무늬가 없거나 작으면 기다리지 않는다
  if (textureSourceBytes(scene.textures) < keep) return Promise.resolve(0);
  const every = o.every ?? SETTLE_EVERY_MS;
  const t0 = Date.now();
  return new Promise((resolve) => {
    const step = (): void => {
      if (!current()) return resolve(0);
      let settled = false;
      try {
        settled = texturesSettled(v.stats.textures);
      } catch {
        return resolve(0);
      }
      if (!settled) {
        if (Date.now() - t0 > (o.max ?? SETTLE_MAX_MS)) return resolve(0);
        setTimeout(step, every);
        return;
      }
      const n = releaseTextureSources(scene.textures, keep);
      if (n) {
        const restored = (): void => {
          if (!current()) {
            v.canvas.removeEventListener('webglcontextrestored', restored);
            return;
          }
          lost(TEXTURE_LOST_TITLE, TEXTURE_LOST_TEXT);
        };
        v.canvas.addEventListener('webglcontextrestored', restored);
      }
      resolve(n);
    };
    setTimeout(step, 0);
  });
}
