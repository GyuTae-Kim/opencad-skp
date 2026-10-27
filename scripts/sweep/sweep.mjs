/**
 * 실제 파일 훑기: 로컬 표본 폴더를 재귀로 훑어 .skp를 고르고, 내용 sha256으로 같은 파일을 뺀 뒤
 * 앱 워커와 같은 길(scripts/sweep/probe.ts)로 해석해 파일마다 한 줄(records.jsonl)과 요약(summary.json)을 남긴다.
 *   npm run sweep -- [--dirs <폴더1>:<폴더2>] [--out .runtime/sweep/<이름>] [--jobs N] [--limit N] [--min-mb N] [--timeout 초] [--mem]
 * 표본 폴더가 없으면(--dirs도 OPENCAD_SWEEP_DIRS도 없음) 쓰는 법만 찍고 0으로 끝난다(CI에서 돌지 않는다).
 * probe.ts는 Vite로 한 파일(<out>/.probe/probe.mjs)로 묶어 Node 자식 프로세스(child.mjs)가 부른다 — 훑기는 Node만으로 돈다.
 * 파일 하나가 시간 한도를 넘거나 자식이 죽으면 그 파일을 예외로 적고 새 자식으로 이어 간다.
 * 결과는 로컬(.runtime/) 전용이다. 경로는 records.jsonl의 paths에만 있고 열쇠는 내용 해시다.
 */
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { opendir, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSIONS, SKIP_DIRS, USAGE, classify, editionOf, formatSummary, parseArgs, summarize } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/** 폴더를 재귀로 훑어 앱이 여는 확장자 파일을 모은다(이름 묶음 폴더·기호 링크는 건너뛴다) */
async function walk(dir, found, stats) {
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    stats.unreadableDirs++;
    return;
  }
  try {
    for await (const ent of handle) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.includes(ent.name)) await walk(p, found, stats);
      } else if (ent.isFile() && EXTENSIONS.includes(extname(ent.name).toLowerCase())) found.push(p);
    }
  } catch {
    stats.unreadableDirs++;
  }
}

function sha256File(path) {
  return new Promise((done, fail) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (d) => h.update(d));
    s.on('error', fail);
    s.on('end', () => done(h.digest('hex')));
  });
}

async function mapLimit(items, n, fn) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

/** probe.ts → <out>/.probe/probe.mjs(의존까지 한 파일, Node용 ESM) */
async function bundleProbe(outDir) {
  const { build } = await import('vite');
  const dir = join(outDir, '.probe');
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    publicDir: false,
    build: {
      ssr: join(here, 'probe.ts'),
      outDir: dir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'node20',
      reportCompressedSize: false,
      copyPublicDir: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'probe.mjs' } },
    },
    ssr: { noExternal: true, target: 'node' },
  });
  return join(dir, 'probe.mjs');
}

/** 결과가 어느 소스에서 나왔는지(커밋·작업 트리 변경 여부·묶은 probe 해시) */
function sourceInfo(bundle) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const status = git(['status', '--porcelain', '--', 'src', 'scripts/sweep', 'package-lock.json']);
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
    probeSha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

/**
 * 자식 프로세스 jobs개로 파일을 나눠 해석한다. mem이면 파일마다 새 자식(그 파일의 최대 rss를 재려고)
 * @returns {Promise<void>}
 */
function runPool(items, { bundle, jobs, timeoutSec, mem, onResult }) {
  return new Promise((resolveAll, rejectAll) => {
    let next = 0;
    let started = false;
    let startupFailures = 0;
    let failed = false;
    const workers = new Set();
    const spawn = () => {
      const child = fork(join(here, 'child.mjs'), [bundle], {
        execArgv: mem ? ['--expose-gc', '--max-old-space-size=8192'] : ['--max-old-space-size=8192'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      const w = { child, ready: false, item: null, header: undefined, timer: null, stderr: '', retired: false, timedOut: false };
      child.stderr.on('data', (d) => {
        w.stderr = (w.stderr + d).slice(-2000);
      });
      child.on('message', (msg) => {
        if (msg?.type === 'ready') {
          w.ready = true;
          started = true;
          startupFailures = 0;
          dispatch(w);
        } else if (msg?.type === 'start' && w.item && msg.id === w.item.id) {
          w.header = msg.header;
        } else if (msg?.type === 'result' && w.item && msg.id === w.item.id) {
          clearTimeout(w.timer);
          const item = w.item;
          w.item = null;
          onResult(item, msg.error ? { error: msg.error, header: w.header } : msg.result);
          if (mem) retire(w);
          else dispatch(w);
        }
      });
      child.on('error', () => {
        /* exit에서 다룬다 */
      });
      child.on('exit', (code, signal) => {
        workers.delete(w);
        clearTimeout(w.timer);
        if (failed) return;
        if (w.item) {
          const item = w.item;
          w.item = null;
          const why = w.timedOut ? `timeout: ${timeoutSec}초 안에 끝나지 않았습니다` : `crash: 자식 프로세스가 끝났습니다(code ${code}, signal ${signal})`;
          onResult(item, { error: `${why}\n${w.stderr.slice(-600)}`, header: w.header });
        } else if (!w.ready && !w.retired) {
          // 파일을 받기도 전에 끝났다 — 되풀이하지 않는다
          startupFailures++;
          if (!started || startupFailures >= 3) {
            failed = true;
            for (const o of workers) o.child.kill('SIGTERM');
            rejectAll(new Error(`자식 프로세스를 띄우지 못했습니다(code ${code}, signal ${signal})\n${w.stderr}`));
            return;
          }
        }
        refill();
      });
      workers.add(w);
    };
    const retire = (w) => {
      w.retired = true;
      if (w.child.connected) w.child.disconnect();
    };
    const dispatch = (w) => {
      if (next >= items.length) return retire(w);
      const item = items[next++];
      w.item = item;
      w.header = undefined;
      w.timer = setTimeout(() => {
        w.timedOut = true;
        w.child.kill('SIGTERM');
        setTimeout(() => {
          if (w.child.exitCode === null && w.child.signalCode === null) w.child.kill('SIGKILL');
        }, 5000).unref();
      }, timeoutSec * 1000);
      w.child.send({ type: 'file', id: item.id, path: item.paths[0], mem });
    };
    const refill = () => {
      while (workers.size < jobs && next < items.length) spawn();
      if (workers.size === 0 && next >= items.length) resolveAll();
    };
    refill();
  });
}

/** 자식 결과 → records.jsonl 한 줄(열쇠 = 내용 해시, 경로는 맨 끝 paths에만) */
function makeRecord(item, res) {
  const header = res.header ?? null;
  const rec = { sha256: item.sha256, size: item.size, count: item.paths.length, edition: editionOf(header?.major), class: '', header };
  if (res.error) rec.error = res.error;
  else {
    const { header: _h, ...rest } = res;
    Object.assign(rec, rest);
  }
  rec.class = classify(rec);
  rec.paths = item.paths;
  return rec;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env, availableParallelism());
  if (opts.errors.length) {
    console.error(opts.errors.join('\n'));
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (opts.help || !opts.dirs.length) {
    console.log(USAGE);
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outDir = resolve(opts.out ?? join(root, '.runtime', 'sweep', stamp));
  const recordsPath = join(outDir, 'records.jsonl');
  const summaryPath = join(outDir, 'summary.json');
  if (existsSync(recordsPath) || existsSync(summaryPath)) {
    console.error(`이미 결과가 있습니다(덮어쓰지 않습니다): ${outDir}`);
    process.exitCode = 2;
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date();

  // 1) 훑기·내용 해시로 같은 파일 빼기
  const stats = { unreadableDirs: 0, unreadableFiles: 0, missingDirs: 0 };
  const found = [];
  for (const d of opts.dirs) {
    const abs = resolve(d);
    const st = await stat(abs).catch(() => null);
    if (!st?.isDirectory()) {
      stats.missingDirs++;
      console.error(`폴더가 아닙니다(건너뜀): ${abs}`);
      continue;
    }
    await walk(abs, found, stats);
  }
  const unique = [...new Set(found)].sort();
  const groups = new Map();
  await mapLimit(unique, 8, async (p) => {
    try {
      const [sha, st] = await Promise.all([sha256File(p), stat(p)]);
      const g = groups.get(sha) ?? { sha256: sha, size: st.size, paths: [] };
      g.paths.push(p);
      groups.set(sha, g);
    } catch {
      stats.unreadableFiles++;
    }
  });
  const all = [...groups.values()].map((g) => ({ ...g, paths: g.paths.sort() })).sort((a, b) => (a.paths[0] < b.paths[0] ? -1 : 1));
  let selected = all.filter((g) => g.size >= opts.minMb * 1e6);
  if (opts.limit !== null) selected = selected.slice(0, opts.limit);
  selected.forEach((g, i) => (g.id = i));
  console.error(`훑기: 파일 ${unique.length}개, 같은 내용을 빼면 ${all.length}개, 해석할 것 ${selected.length}개 → ${outDir}`);

  // 2) probe 묶기
  const bundle = await bundleProbe(outDir);
  const source = sourceInfo(bundle);

  // 3) 해석
  const records = [];
  const out = createWriteStream(recordsPath, { encoding: 'utf8' });
  let done = 0;
  await runPool(selected, {
    bundle,
    jobs: Math.min(opts.jobs, Math.max(1, selected.length)),
    timeoutSec: opts.timeoutSec,
    mem: opts.mem,
    onResult: (item, res) => {
      const rec = makeRecord(item, res);
      records.push(rec);
      out.write(JSON.stringify(rec) + '\n');
      done++;
      if (rec.class !== 'ok') console.error(`  ${rec.class} ${rec.edition} ${rec.sha256.slice(0, 16)} ${rec.ms?.total ?? '-'} ms`);
      if (done % 50 === 0 || done === selected.length) console.error(`훑기: ${done}/${selected.length}`);
    },
  });
  await new Promise((r) => out.end(r));

  // 4) 요약
  const finishedAt = new Date();
  const summary = summarize(records, {
    tool: 'opencad-skp sweep',
    source,
    options: {
      dirs: opts.dirs.map((d) => resolve(d)),
      jobs: opts.jobs,
      limit: opts.limit,
      minMb: opts.minMb,
      timeoutSec: opts.timeoutSec,
      mem: opts.mem,
      extensions: EXTENSIONS,
      skipDirs: SKIP_DIRS,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    wallMs: finishedAt.getTime() - startedAt.getTime(),
    files: {
      found: unique.length,
      unique: all.length,
      duplicates: unique.length - stats.unreadableFiles - all.length,
      selected: selected.length,
      processed: records.length,
      ...stats,
    },
  });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(formatSummary(summary));
  console.log(`결과: ${recordsPath}\n요약: ${summaryPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exitCode = 1;
});
