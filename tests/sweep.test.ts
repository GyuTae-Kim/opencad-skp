/**
 * 실제 파일 훑기 도구(scripts/sweep): 순수 함수(인자·판·분류·코드·백분위·요약·비교), 앱 워커와 같은 해석 길(probe),
 * 합성 표본 폴더로 훑기·비교 명령 끝까지. 실제 SketchUp 파일은 쓰지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classify, compareRuns, editionOf, exceptionCode, formatCompare, parseArgs, percentiles, summarize, warningCode } from '../scripts/sweep/lib.mjs';
import { headerInfo, probeSkp, sceneDigest } from '../scripts/sweep/probe';
import { skpToScene } from '../src/index';
import { edge, entities, face, modelDat, skpFile, vertex } from './build';
import { mfcFile, squareEntities } from './mfcwrite';

const root = resolve(__dirname, '..');

/** 정점·모서리·면 n×n 격자(2021+ 꼴) */
function gridSkp(n: number): Uint8Array {
  const vertices: Uint8Array[] = [];
  const edges: Uint8Array[] = [];
  const faces: Uint8Array[] = [];
  const id = (i: number, j: number): number => 1 + i * (n + 1) + j;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) vertices.push(vertex(id(i, j), i * 10, j * 10, 0));
  let e = 100000;
  let f = 500000;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const ids = [e++, e++, e++, e++];
      const [a, b, c, d] = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
      edges.push(edge(ids[0]!, a, b), edge(ids[1]!, b, c), edge(ids[2]!, c, d), edge(ids[3]!, d, a));
      faces.push(face(f++, [0, 0, 1, 0], [ids.map((x) => [x, false] as [number, boolean])]));
    }
  return skpFile(modelDat({ root: entities(undefined, { vertices, edges, faces }) }));
}

const rec = (o: Record<string, unknown>) => ({
  sha256: 'a'.repeat(64),
  size: 100,
  count: 1,
  header: { version: '26.0.1', major: 26, container: 'zip' },
  edition: '2026',
  warnings: [] as string[],
  flags: [] as string[],
  ms: { total: 10 },
  metrics: { meshes: 1, lines: 1, tri: 2, seg: 4, faces: 1, edges: 4 },
  ...o,
});

describe('훑기 순수 함수', () => {
  it('parseArgs: 폴더는 --dirs가 환경 변수보다 먼저, 쌍점으로 나눈다', () => {
    expect(parseArgs([], {}, 10).dirs).toEqual([]);
    expect(parseArgs([], { OPENCAD_SWEEP_DIRS: '/a:/b' }, 10).dirs).toEqual(['/a', '/b']);
    expect(parseArgs(['--dirs', '/c'], { OPENCAD_SWEEP_DIRS: '/a:/b' }, 10).dirs).toEqual(['/c']);
    const o = parseArgs(['--jobs', '3', '--limit=2', '--mem', '--timeout', '10', '--min-mb', '5', '--out', 'x'], {}, 10);
    expect(o).toMatchObject({ jobs: 3, limit: 2, mem: true, timeoutSec: 10, minMb: 5, out: 'x', errors: [] });
    expect(parseArgs([], {}, 10).jobs).toBe(4);
    expect(parseArgs([], {}, 2).jobs).toBe(1);
    expect(parseArgs(['--jobs', '0', '--what'], {}, 2).errors).toHaveLength(2);
    // 풀면서 읽는 문턱: 기본은 워커와 같게(null), 0이면 압축된 모든 2021+ 파일
    expect(parseArgs([], {}, 2).streamMin).toBeNull();
    expect(parseArgs(['--stream-min', '0'], {}, 2).streamMin).toBe(0);
    expect(parseArgs(['--stream-min=-1'], {}, 2).errors).toHaveLength(1);
  });

  it('editionOf: 6~8은 그대로, 13 이상은 연도 꼴', () => {
    expect([6, 8, 15, 21, 26].map(editionOf)).toEqual(['6', '8', '2015', '2021', '2026']);
    expect(editionOf(null)).toBe('?');
  });

  it('classify: 예외 > SketchUp 아님 > 읽지 않는 판 > 빈 장면 > 경고 > 정상', () => {
    expect(classify(rec({}))).toBe('ok');
    expect(classify(rec({ warnings: ['x'] }))).toBe('warn');
    expect(classify(rec({ flags: ['damaged'] }))).toBe('warn');
    expect(classify(rec({ metrics: { meshes: 0, lines: 0 } }))).toBe('empty');
    expect(classify(rec({ metrics: { meshes: 0, lines: 0 }, warnings: ['x'] }))).toBe('empty-warn');
    expect(classify(rec({ flags: ['unsupported'], metrics: { meshes: 0, lines: 0 } }))).toBe('unsupported');
    expect(classify(rec({ header: null }))).toBe('not-skp');
    expect(classify(rec({ error: 'boom' }))).toBe('error');
  });

  it('경고·예외 코드: 숫자와 경로를 지워 같은 종류를 한데 센다', () => {
    expect(warningCode('면 12개를 건너뛰었습니다(1,234바이트 자리)')).toBe('면 #개를 건너뛰었습니다(#바이트 자리)');
    expect(exceptionCode("Error: EACCES: permission denied, open '/x/y z.skp'\n    at f")).toBe("Error: EACCES: permission denied, open '<경로> z.skp'");
    expect(exceptionCode('RangeError: Offset 99 is out of bounds')).toBe('RangeError: Offset # is out of bounds');
  });

  it('percentiles: 가장 가까운 순위', () => {
    const p = percentiles(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(p).toMatchObject({ n: 100, p50: 50, p90: 90, p95: 95, p99: 99, max: 100, mean: 50.5 });
    expect(percentiles([])).toEqual({ n: 0 });
  });

  it('summarize: 판·분류 표(같은 파일 수 포함), 경고 코드, 합, 예외', () => {
    const s = summarize([
      rec({ sha256: '1', count: 3 }),
      rec({ sha256: '2', warnings: ['면 3개', '면 4개'] }),
      rec({ sha256: '3', header: { version: '8.0.1', major: 8, container: 'mfc' }, edition: '8', metrics: { meshes: 0, lines: 0 }, warnings: ['잘림'] }),
      rec({ sha256: '4', header: null, edition: '?', metrics: { meshes: 0, lines: 0 } }),
      rec({ sha256: '5', error: 'timeout: 1초\nstderr', ms: undefined, metrics: undefined }),
    ]);
    expect(s.done).toBe(true);
    expect(s.byEdition).toEqual({ '8': { 'empty-warn': 1 }, '2026': { ok: 1, warn: 1, error: 1 }, '?': { 'not-skp': 1 } });
    expect(s.byEditionAllFiles['2026']).toEqual({ ok: 3, warn: 1, error: 1 });
    expect(s.classesAllFiles.ok).toBe(3);
    expect(s.warningFiles).toBe(2);
    expect(s.warningCodes).toEqual({ '면 #개': 1, 잘림: 1 });
    expect(s.exceptions).toEqual({ 'timeout: #초': 1 });
    expect(s.totals.faces).toBe(2);
    expect(s.timingMs.total.n).toBe(4);
    expect(Object.keys(s.byEdition)).toEqual(['8', '2026', '?']);
  });

  it('compareRuns: 분류·지표·경고 변화와 새 예외, 한쪽에만 있는 해시', () => {
    const before = [rec({ sha256: 'a' }), rec({ sha256: 'b' }), rec({ sha256: 'c' }), rec({ sha256: 'd' })];
    expect(compareRuns(before, before).changed).toBe(false);
    const after = [
      rec({ sha256: 'a' }),
      rec({ sha256: 'b', metrics: { meshes: 1, lines: 1, tri: 3, seg: 4, faces: 1, edges: 4 } }),
      rec({ sha256: 'c', warnings: ['새 경고'] }),
      rec({ sha256: 'd', error: 'RangeError: x' }),
      rec({ sha256: 'e' }),
    ].map((r) => ({ ...r, class: classify(r) }));
    const c = compareRuns(before, after, { top: 10 });
    expect(c).toMatchObject({ common: 4, onlyBefore: 0, onlyAfter: 1, classChanged: 2, metricChanged: 2, changed: true });
    expect(c.classChanges.map((x) => [x.sha256, x.before, x.after])).toEqual([
      ['c', 'ok', 'warn'],
      ['d', 'ok', 'error'],
    ]);
    expect(c.metricChanges[0]).toMatchObject({ sha256: 'b', changes: { tri: [2, 3] } });
    expect(c.metricChanges[1]!.changes.warnings).toBeTruthy();
    expect(c.newExceptions).toEqual([{ sha256: 'd', edition: '2026', code: 'RangeError: x' }]);
    expect(formatCompare(c)).toContain('분류가 바뀐 파일 2개');
  });

  it('compareRuns: 장면 출력 해시는 두 결과에 다 있을 때만 견준다', () => {
    const before = [rec({ sha256: 'a' }), { ...rec({ sha256: 'b' }), digest: '0123' }, { ...rec({ sha256: 'c' }), digest: '4567' }];
    const after = [{ ...rec({ sha256: 'a' }), digest: 'aaaa' }, { ...rec({ sha256: 'b' }), digest: '0123' }, { ...rec({ sha256: 'c' }), digest: '89ab' }];
    const c = compareRuns(before, after);
    expect(c.metricChanged).toBe(1);
    expect(c.metricChanges[0]).toMatchObject({ sha256: 'c', changes: { digest: ['4567', '89ab'] } });
  });
});

describe('probe: 앱 워커와 같은 해석 길', () => {
  it('워커와 같은 skpFileToScene 선택·풀면서 읽는 문턱을 쓴다', () => {
    const worker = readFileSync(join(root, 'src/worker/parse.worker.ts'), 'utf8');
    const probe = readFileSync(join(root, 'scripts/sweep/probe.ts'), 'utf8');
    // 그림 진행 알림은 워커가 진행 막대로, probe는 메모리 재기로 받고, probe는 그 뒤에 진단 알림(onModelRead·onFileRead)만 더 단다
    const call = 'skpFileToScene(file, { name, outline: true, extras: true, smooth: true, onProgress: progress, streamMin, images: { onProgress: ';
    expect(worker).toContain(call);
    expect(probe).toContain(call);
    expect(worker).toContain('const streamMin = STREAM_MIN_BYTES;');
    expect(probe).toContain('const streamMin = opts.streamMin ?? STREAM_MIN_BYTES;');
  });

  it('2021+ 꼴: 풀면서 읽는 길을 타도 직접 해석과 같은 지표', async () => {
    const bytes = gridSkp(20);
    const direct = skpToScene(bytes, { outline: true, extras: true, smooth: true });
    // probe는 워커처럼 파일을 자리마다 읽는다(바이트를 주면 읽을 때마다 사본 — 준 바이트는 그대로)
    const copy = bytes.slice();
    const r = await probeSkp(copy, { name: 'grid.skp', streamMin: 1 });
    expect(copy).toEqual(bytes);
    expect(r.fileRead).toBe('parts');
    expect(r.inflated).toBe(true);
    // 합성 격자에는 글꼴 절이 없어 정의 절을 통째로 들고 읽는다(풀면서 읽기는 같다)
    expect(r.modelRead).toBe('held');
    expect(r.header).toMatchObject({ major: 26, container: 'zip' });
    expect(r.metrics.faces).toBe(400);
    expect(r.metrics.faces).toBe(direct.meta?.faces);
    expect(r.metrics.meshes).toBe(direct.meshes.length);
    expect(r.metrics.seg).toBe(direct.lines.reduce((s, l) => s + l.positions.length / 6, 0));
    expect(Object.keys(r.ms)).toEqual(expect.arrayContaining(['total', 'images', 'unpack', 'parse', 'scene']));
    // 기본 문턱(1 MiB)보다 작으면 워커처럼 통째로 푼다
    const small = await probeSkp(bytes.slice());
    expect(small.inflated).toBe(false);
    expect(small.modelRead).toBe('whole');
    expect(small.metrics).toEqual(r.metrics);
    // 장면 출력 해시: 미리 풀든 직접 풀든 같고, 장면 이름(파일 이름)에 따라 바뀌지 않는다
    expect(r.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(small.digest).toBe(r.digest);
    expect(sceneDigest(direct)).toBe(r.digest);
    expect(sceneDigest(skpToScene(bytes, { name: '다른 이름', outline: true, extras: true, smooth: true }))).toBe(sceneDigest(direct));
    expect(sceneDigest(skpToScene(bytes))).not.toBe(sceneDigest(direct));
  });

  it('2020 이하·SketchUp 아님·옛 판', async () => {
    const old = await probeSkp(mfcFile({ schemas: 'v17', root: squareEntities() }));
    expect(old.header).toMatchObject({ major: 17, container: 'mfc' });
    expect(old.fileRead).toBe('whole');
    expect(old.metrics.faces).toBe(1);
    expect(old.ms.unpack).toBeUndefined();
    const none = await probeSkp(new Uint8Array([1, 2, 3, 4]));
    expect(none.header).toBeNull();
    expect(headerInfo(new Uint8Array(8))).toBeNull();
    expect(classify({ ...none, metrics: none.metrics })).toBe('not-skp');
    const v4 = await probeSkp(mfcFile({ schemas: 'v4', root: squareEntities() }));
    expect(v4.flags).toContain('unsupported');
  });

  it('mem: 단계별 최대·끝 heap과 장면 배열 크기', async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const r = await probeSkp(gridSkp(10), { mem: true, gc, streamMin: 1 });
    const m = r.mem!;
    expect(m.stages.scene).toBeTruthy();
    expect(m.stages.parse).toBeTruthy();
    expect(m.stages.images).toBeTruthy();
    for (const s of Object.values(m.stages)) {
      expect(s!.peakHeapMB).toBeGreaterThan(0);
      expect(s!.peakRssMB).toBeGreaterThan(0);
      // 같은 때의 heap + external 합은 그때 heap보다 작을 수 없다
      expect(s!.peakHeapExternalMB).toBeGreaterThanOrEqual(s!.peakHeapMB);
    }
    expect(m.peakHeapMB).toBeGreaterThanOrEqual(m.stages.scene!.peakHeapMB);
    expect(m.peakHeapExternalMB).toBeGreaterThanOrEqual(m.stages.scene!.peakHeapExternalMB);
    expect(m.sceneBuffersMB['mesh.positions']).toBeGreaterThanOrEqual(0);
    expect(m.modelDatMB).toBeDefined();
  });
});

/** node로 scripts/sweep의 명령 하나를 돌린다(표본 폴더 환경 변수는 비운다) */
function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env.OPENCAD_SWEEP_DIRS;
  return new Promise((done) => {
    execFile(process.execPath, args, { cwd: root, env, maxBuffer: 8 << 20, timeout: 110_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : 1) : 0;
      done({ code, stdout, stderr });
    });
  });
}

const readJsonl = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe('훑기·비교 명령(합성 표본 폴더)', () => {
  let dir: string;
  let samples: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencad-sweep-'));
    samples = join(dir, 'samples');
    const grid = gridSkp(6);
    mkdirSync(join(samples, 'sub', 'node_modules'), { recursive: true });
    writeFileSync(join(samples, 'grid.skp'), grid);
    writeFileSync(join(samples, 'sub', 'grid copy.skp'), grid);
    writeFileSync(join(samples, 'sub', 'old.SKP'), mfcFile({ schemas: 'v17', root: squareEntities() }));
    writeFileSync(join(samples, 'sub', 'v4.skp'), mfcFile({ schemas: 'v4', root: squareEntities() }));
    writeFileSync(join(samples, 'broken.skp'), new Uint8Array([1, 2, 3]));
    writeFileSync(join(samples, 'notes.txt'), 'x');
    writeFileSync(join(samples, 'sub', 'node_modules', 'skipped.skp'), grid);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('표본 폴더가 없으면 쓰는 법만 찍고 0', async () => {
    const r = await run(['scripts/sweep/sweep.mjs']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('OPENCAD_SWEEP_DIRS');
    expect((await run(['scripts/sweep/sweep.mjs', '--jobs', 'x'])).code).toBe(2);
  });

  it('훑기 → records·summary, 같은 내용은 한 번, 다시 같은 곳에는 쓰지 않고, 비교는 바뀐 것만 알린다', async () => {
    const out = join(dir, 'run1');
    const r = await run(['scripts/sweep/sweep.mjs', '--dirs', samples, '--out', out, '--jobs', '2']);
    expect(r.stderr).not.toMatch(/Error/);
    expect(r.code).toBe(0);
    const records = readJsonl(join(out, 'records.jsonl'));
    expect(records).toHaveLength(4);
    const byEdition = Object.fromEntries(records.map((x) => [x.edition, x]));
    expect(Object.keys(byEdition).sort()).toEqual(['2017', '2026', '4', '?']);
    const grid = byEdition['2026'];
    expect(grid).toMatchObject({ class: 'ok', count: 2, inflated: false });
    expect(grid.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(grid.paths).toHaveLength(2);
    expect(byEdition['2017'].class).toBe('ok');
    expect(byEdition['?'].class).toBe('not-skp');
    expect(byEdition['4'].class).toBe('unsupported');
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({ done: true, files: { found: 5, unique: 4, duplicates: 1, processed: 4 } });
    expect(summary.byEdition['2017']).toEqual({ ok: 1 });
    expect(summary.byEditionAllFiles['2026']).toEqual({ ok: 2 });
    expect(summary.source.probeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stdout).toContain('같은 내용을 빼면 4개');

    // 이미 결과가 있으면 덮어쓰지 않는다
    expect((await run(['scripts/sweep/sweep.mjs', '--dirs', samples, '--out', out])).code).toBe(2);

    // 같은 결과끼리는 바뀐 것이 없다
    const same = await run(['scripts/sweep/compare.mjs', out, out, '--fail-on-change']);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain('분류가 바뀐 파일 0개');

    // 한 파일의 지표·분류를 바꾼 결과와 견주면 알리고, --fail-on-change면 1
    const changed = join(dir, 'changed');
    mkdirSync(changed);
    const edited = records.map((x) => (x.sha256 === grid.sha256 ? { ...x, class: 'warn', warnings: ['새 경고'], metrics: { ...x.metrics, tri: x.metrics.tri + 1 } } : x));
    writeFileSync(join(changed, 'records.jsonl'), edited.map((x) => JSON.stringify(x)).join('\n') + '\n');
    const diff = await run(['scripts/sweep/compare.mjs', out, changed, '--fail-on-change', '--json', join(dir, 'cmp.json')]);
    expect(diff.code).toBe(1);
    expect(diff.stdout).toContain('분류가 바뀐 파일 1개');
    expect(diff.stdout).toContain(grid.sha256.slice(0, 16));
    expect(JSON.parse(readFileSync(join(dir, 'cmp.json'), 'utf8'))).toMatchObject({ done: true, classChanged: 1, metricChanged: 1 });
    expect((await run(['scripts/sweep/compare.mjs', out, changed])).code).toBe(0);
    expect((await run(['scripts/sweep/compare.mjs', out])).code).toBe(2);
  });

  it('--min-mb: 크기 문턱 위 파일이 없으면 해석하지 않는다', async () => {
    const none = await run(['scripts/sweep/sweep.mjs', '--dirs', samples, '--out', join(dir, 'none'), '--min-mb', '100']);
    expect(none.code).toBe(0);
    expect(readFileSync(join(dir, 'none', 'records.jsonl'), 'utf8')).toBe('');
  });

  it('--mem: 파일마다 새 프로세스로 단계별 메모리와 최대 rss', async () => {
    const out = join(dir, 'mem');
    const r = await run(['scripts/sweep/sweep.mjs', '--dirs', samples, '--out', out, '--mem', '--limit', '2', '--jobs', '1']);
    expect(r.code).toBe(0);
    const records = readJsonl(join(out, 'records.jsonl'));
    expect(records).toHaveLength(2);
    const parsed = records.filter((x) => !x.error);
    expect(parsed).toHaveLength(2);
    for (const x of parsed) {
      expect(x.mem.maxRssMB).toBeGreaterThan(0);
      expect(x.mem.stages.images).toBeTruthy();
    }
    expect(parsed.find((x) => x.header)?.mem.stages.scene).toBeTruthy();
    const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
    expect(summary.options.mem).toBe(true);
    expect(summary.memory.maxRssMB.n).toBe(parsed.length);
  });
});
