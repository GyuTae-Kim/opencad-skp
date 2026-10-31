/**
 * 지문 워커(34차): 파일 내용 지문(SHA-256)만 구해 보낸다(해석기를 싣지 않는다). 큰 모형은 화면이 결과를 받자마자 해석 워커를 끝내므로
 * (app/client.ts — 그 워커의 heap과 해석하며 남긴 쓰레기를 한꺼번에 놓으려고) 지문은 이 워커가 구하고, 보내면 화면이 이 워커도 끝낸다.
 */
/// <reference lib="webworker" />
import type { ParseResponse, PrintRequest } from '../app/protocol';
import { filePrint } from './print';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<PrintRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'print') return;
  const digest = await filePrint(req.file);
  const msg: ParseResponse = { id: req.id, type: 'print', digest };
  ctx.postMessage(msg, digest ? [digest] : []);
};
