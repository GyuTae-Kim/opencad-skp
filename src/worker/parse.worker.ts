/**
 * 해석 워커: SketchUp(.skp) 파일을 화면 밖에서 해석해 Scene3d로 돌려준다.
 * 화면이 그룹·컴포넌트를 여러 단계로 고를 수 있게 outline(나무)을, 부드러운 모서리·숨긴 형상을 켜고 끌 수 있게 extras를 켜고 읽는다.
 * 꾸러미 안 그림(무늬·미리보기)도 여기서 꺼내 바이트로 넘긴다(화면이 Blob 주소로 바꾼다 — 워커가 끝나도 주소가 살아 있게).
 * 결과의 형식 배열은 이전 가능한 버퍼로 넘긴다(app/protocol.ts collectTransfers).
 */
/// <reference lib="webworker" />
import { readSkpImages, skpToScene } from '../index';
import { collectTransfers, errorText, type ParseRequest, type ParseResponse, type ParseResult } from '../app/protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: ParseResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function open(req: ParseRequest): ParseResult {
  const id = req.id;
  let last = 0;
  const progress = (fraction: number, stage: string): void => {
    const now = performance.now();
    if (fraction < 1 && now - last < 40) return;
    last = now;
    post({ id, type: 'progress', fraction: Math.max(0, Math.min(1, fraction)), stage });
  };
  const t0 = performance.now();
  const bytes = new Uint8Array(req.bytes);
  const name = req.name.replace(/^.*[\\/]/, '');
  const scene = skpToScene(bytes, { name, outline: true, extras: true, onProgress: progress });
  const result: ParseResult = { scene, ms: 0 };
  progress(0.96, '그림 꺼내는 중');
  try {
    const images = readSkpImages(bytes);
    if (images.model || images.materials.length || images.components.length || images.scenes.length) result.images = images;
  } catch {
    /* 그림은 없어도 된다 */
  }
  progress(0.98, '화면으로 넘기는 중');
  result.ms = performance.now() - t0;
  return result;
}

ctx.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'open') return;
  let result: ParseResult;
  try {
    result = open(req);
  } catch (e) {
    post({ id: req.id, type: 'error', message: errorText(e) });
    return;
  }
  try {
    post({ id: req.id, type: 'done', result }, collectTransfers(result));
  } catch {
    // 이전이 막히면(드문 경우) 복사로 보낸다
    post({ id: req.id, type: 'done', result });
  }
};
