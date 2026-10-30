/**
 * 무늬 손질 워커(29차 — 큰 모형의 그래픽 문맥 복구, app/release.ts): 화면이 쥐어 둔 색 바꾼 무늬의 원래 그림 바이트(Blob)만 받아
 * 처음 열 때와 같은 손질(textures.ts recolorTextures)로 다시 그림을 만들어 돌려준다(ImageBitmap — 복사 없이).
 * 해석기·파일을 싣지 않는 작은 워커라, 메모리가 모자라 문맥을 잃은 뒤에도 해석 워커처럼 큰 heap을 쓰지 않는다. 화면은 받으면 바로 끝낸다.
 */
/// <reference lib="webworker" />
import { TEXTURE_LIMIT } from 'opencad-viewer3d/texture';
import { errorText, type RecolorRequest, type RecolorResponse } from '../app/protocol';
import { recolorTextures } from './textures';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<RecolorRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'recolor') return;
  const post = (msg: RecolorResponse, transfer: Transferable[] = []): void => ctx.postMessage(msg, transfer);
  try {
    const limit = req.textureLimit && req.textureLimit > 0 ? req.textureLimit : TEXTURE_LIMIT;
    const result = await recolorTextures(req.textures, limit);
    post({ id: req.id, type: 'recolored', result }, result.textures.map((t) => t.bitmap));
  } catch (e) {
    post({ id: req.id, type: 'error', message: errorText(e) });
  }
};
