/**
 * 해석 워커: SketchUp(.skp) 파일을 화면 밖에서 해석해 Scene3d로 돌려준다.
 * 화면이 그룹·컴포넌트를 하나씩 고를 수 있게 outline을 켜고 읽는다.
 * 결과의 형식 배열은 이전 가능한 버퍼로 넘긴다(app/protocol.ts collectTransfers).
 */
/// <reference lib="webworker" />
import { skpToScene } from '../index';
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
  const scene = skpToScene(bytes, { name, outline: true, onProgress: progress });
  progress(0.98, '화면으로 넘기는 중');
  return { scene, ms: performance.now() - t0 };
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
