/**
 * 훑기 자식 프로세스: 묶은 probe.mjs(scripts/sweep/probe.ts)를 읽고, 부모(sweep.mjs)가 보낸 파일을 하나씩 해석해 결과를 돌려준다.
 * 해석 전에 머리 판을 먼저 알린다(멈추거나 죽어도 부모가 판을 적게). 예외는 결과로 돌려주고, 멈춤·죽음은 부모가 시간 한도·종료로 잡는다.
 * 부모가 IPC를 끊으면 끝난다. 쓰는 법: node [--expose-gc] child.mjs <probe.mjs>
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundle = process.argv[2];
const { headerInfo, probeSkp } = await import(pathToFileURL(bundle).href);
const gc = typeof globalThis.gc === 'function' ? globalThis.gc : undefined;
const send = (msg) => new Promise((done) => process.send(msg, () => done()));

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'file') return;
  const reply = { type: 'result', id: msg.id };
  try {
    // 워커처럼 읽은 버퍼를 그대로 본다(new Uint8Array(buf)는 한 벌 더 복사한다)
    const buf = await readFile(msg.path);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let header = null;
    try {
      header = headerInfo(bytes);
    } catch {
      /* 머리를 못 읽으면 해석기가 알린다 */
    }
    await send({ type: 'start', id: msg.id, header });
    reply.result = await probeSkp(bytes, { name: basename(msg.path), mem: !!msg.mem, gc });
    // 파일마다 새 프로세스(--mem)일 때 이 값이 그 파일의 최대 rss다(KB → MB)
    if (reply.result.mem) reply.result.mem.maxRssMB = Math.round((process.resourceUsage().maxRSS * 1024) / 1e5) / 10;
  } catch (e) {
    reply.error = (e instanceof Error ? (e.stack ?? e.message) : String(e)).slice(0, 800);
  }
  await send(reply);
});
await send({ type: 'ready' });
