/**
 * 훑기 자식 프로세스: 묶은 probe.mjs(scripts/sweep/probe.ts)를 읽고, 부모(sweep.mjs)가 보낸 파일을 하나씩 해석해 결과를 돌려준다.
 * 해석 전에 머리 판을 먼저 알린다(멈추거나 죽어도 부모가 판을 적게). 예외는 결과로 돌려주고, 멈춤·죽음은 부모가 시간 한도·종료로 잡는다.
 * 부모가 IPC를 끊으면 끝난다. 쓰는 법: node [--expose-gc] child.mjs <probe.mjs>
 */
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const bundle = process.argv[2];
const { headerInfo, probeSkp } = await import(pathToFileURL(bundle).href);
const gc = typeof globalThis.gc === 'function' ? globalThis.gc : undefined;
const send = (msg) => new Promise((done) => process.send(msg, () => done()));

/** 파일 손잡이 → 자리마다 읽어 주는 곳(src/range.ts SkpSource — 앱 워커가 File을 조각으로 읽듯 파일을 통째로 들지 않는다) */
async function fileSource(path) {
  const fh = await open(path, 'r');
  const size = (await fh.stat()).size;
  return {
    size,
    fh,
    async read(start, end) {
      const a = Math.max(0, Math.min(start, size));
      const b = Math.max(a, Math.min(end, size));
      const out = new Uint8Array(b - a);
      let got = 0;
      while (got < out.length) {
        const { bytesRead } = await fh.read(out, got, out.length - got, a + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return got < out.length ? out.slice(0, got) : out;
    },
  };
}

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'file') return;
  const reply = { type: 'result', id: msg.id };
  let src = null;
  try {
    src = await fileSource(msg.path);
    let header = null;
    try {
      header = headerInfo(await src.read(0, 4096));
    } catch {
      /* 머리를 못 읽으면 해석기가 알린다 */
    }
    await send({ type: 'start', id: msg.id, header });
    const opts = { name: basename(msg.path), mem: !!msg.mem, gc };
    if (typeof msg.streamMin === 'number') opts.streamMin = msg.streamMin;
    reply.result = await probeSkp(src, opts);
    // 파일마다 새 프로세스(--mem)일 때 이 값이 그 파일의 최대 rss다(KB → MB)
    if (reply.result.mem) reply.result.mem.maxRssMB = Math.round((process.resourceUsage().maxRSS * 1024) / 1e5) / 10;
  } catch (e) {
    reply.error = (e instanceof Error ? (e.stack ?? e.message) : String(e)).slice(0, 800);
  } finally {
    await src?.fh.close().catch(() => {});
  }
  await send(reply);
});
await send({ type: 'ready' });
