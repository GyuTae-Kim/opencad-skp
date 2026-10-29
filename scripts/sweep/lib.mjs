/**
 * 실제 파일 훑기 도구의 순수 함수: 인자 읽기, 판 이름, 분류, 경고·예외 코드, 백분위, 요약, 두 결과 비교, 글로 찍기.
 * 파일·프로세스는 sweep.mjs(훑기)와 compare.mjs(비교)가 다룬다. 시험은 tests/sweep.test.ts.
 */

/** 앱이 여는 확장자(대소문자 무시) */
export const EXTENSIONS = ['.skp'];
/** 훑지 않는 폴더 이름(의존 묶음·git·에이전트 작업 사본) */
export const SKIP_DIRS = ['node_modules', '.git', '.claude'];
/** 결과 형식 판(records·summary가 바뀌면 올린다) */
export const SCHEMA = 1;

/** 분류(차례 = 표의 열 차례) */
export const CLASSES = ['ok', 'warn', 'empty', 'empty-warn', 'unsupported', 'not-skp', 'error'];
export const CLASS_LABELS = {
  ok: '정상',
  warn: '경고',
  empty: '빈 장면',
  'empty-warn': '빈 장면+경고',
  unsupported: '읽지 않는 판',
  'not-skp': 'SketchUp 파일 아님',
  error: '예외',
};

/** 비교하는 지표(probe의 metrics) */
export const METRIC_KEYS = [
  'meshes',
  'lines',
  'points',
  'tri',
  'seg',
  'faces',
  'edges',
  'defs',
  'inst',
  'mats',
  'tex',
  'tags',
  'tree',
  'pages',
  'texts',
  'dims',
  'sections',
  'units',
  'bounds',
];

export const USAGE = `쓰는 법: npm run sweep -- [--dirs <폴더1>:<폴더2>] [--out .runtime/sweep/<이름>] [--jobs N] [--limit N]
                      [--min-mb N] [--timeout 초] [--mem] [--stream-min 바이트]
  폴더를 재귀로 훑어 .skp를 고르고 내용 sha256으로 같은 파일을 뺀 뒤 앱 워커와 같은 길로 해석합니다.
  표본 폴더는 --dirs나 환경 변수 OPENCAD_SWEEP_DIRS(쌍점으로 구분)로 줍니다. 둘 다 없으면 이 안내만 찍고 끝납니다.
  --out     결과 폴더(기본 .runtime/sweep/<UTC 시각>) — records.jsonl(파일마다 한 줄)과 summary.json. 이미 결과가 있으면 멈춥니다
  --jobs    동시에 해석할 자식 프로세스 수(기본 CPU 절반, 많아야 4)
  --limit   같은 파일을 뺀 뒤 앞에서 N개만
  --min-mb  이 크기(MB) 이상인 파일만
  --timeout 파일 하나 시간 한도(초, 기본 300) — 넘거나 프로세스가 죽으면 예외로 적고 다음 파일로
  --mem     파일마다 새 프로세스로 해석하며 단계별(그림·꾸러미·해석·장면) 최대 heap·rss를 잽니다(느립니다)
  --stream-min  model.dat를 풀면서 읽는 문턱(압축 바이트, 기본은 워커와 같은 1 MiB). 0이면 압축된 모든 2021+ 파일이 그 길을 탑니다
비교: npm run sweep:compare -- <전 결과 폴더> <후 결과 폴더> [--top N] [--json <파일>] [--fail-on-change]`;

/**
 * 명령줄 → 선택. 모르는 인자·잘못된 값은 errors에 모은다
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {number} cpus
 */
export function parseArgs(argv, env = {}, cpus = 2) {
  const opts = {
    dirs: /** @type {string[]} */ ([]),
    out: /** @type {string | null} */ (null),
    jobs: Math.max(1, Math.min(4, Math.floor(cpus / 2))),
    limit: /** @type {number | null} */ (null),
    minMb: 0,
    timeoutSec: 300,
    mem: false,
    /** 풀면서 읽는 문턱(압축된 model.dat 바이트) — null이면 워커와 같은 기본 */
    streamMin: /** @type {number | null} */ (null),
    help: false,
    errors: /** @type {string[]} */ ([]),
  };
  const intArg = (name, v, min) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < min) {
      opts.errors.push(`${name}에는 ${min} 이상의 수를 줍니다`);
      return null;
    }
    return n;
  };
  let dirsArg;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--dirs':
        dirsArg = value() ?? '';
        break;
      case '--out':
        opts.out = value() ?? null;
        if (!opts.out) opts.errors.push('--out에는 폴더를 줍니다');
        break;
      case '--jobs': {
        const n = intArg('--jobs', value(), 1);
        if (n !== null) opts.jobs = Math.floor(n);
        break;
      }
      case '--limit': {
        const n = intArg('--limit', value(), 1);
        if (n !== null) opts.limit = Math.floor(n);
        break;
      }
      case '--min-mb': {
        const n = intArg('--min-mb', value(), 0);
        if (n !== null) opts.minMb = n;
        break;
      }
      case '--timeout': {
        const n = intArg('--timeout', value(), 1);
        if (n !== null) opts.timeoutSec = n;
        break;
      }
      case '--mem':
        opts.mem = true;
        break;
      case '--stream-min': {
        const n = intArg('--stream-min', value(), 0);
        if (n !== null) opts.streamMin = Math.floor(n);
        break;
      }
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        opts.errors.push(`모르는 인자: ${a}`);
    }
  }
  const raw = dirsArg ?? env.OPENCAD_SWEEP_DIRS ?? '';
  opts.dirs = raw
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean);
  return opts;
}

/**
 * 판 이름: 6·7·8은 그대로, 13 이상은 2013~ 꼴, 모르면 '?'
 * @param {number | null | undefined} major
 */
export function editionOf(major) {
  if (typeof major !== 'number' || !Number.isFinite(major)) return '?';
  return major >= 13 ? String(2000 + major) : String(major);
}

/** 판 이름 차례(수, '?'는 끝) */
export function editionOrder(a, b) {
  const na = a === '?' ? Infinity : Number(a);
  const nb = b === '?' ? Infinity : Number(b);
  return na - nb || String(a).localeCompare(String(b));
}

/**
 * 기록 하나의 분류
 * @param {{ error?: string, header?: unknown, flags?: string[], warnings?: string[], metrics?: { meshes?: number, lines?: number } }} rec
 */
export function classify(rec) {
  if (rec.error) return 'error';
  if (!rec.header) return 'not-skp';
  const flags = rec.flags ?? [];
  if (flags.includes('unsupported')) return 'unsupported';
  const warned = (rec.warnings?.length ?? 0) > 0;
  if (!(rec.metrics?.meshes ?? 0) && !(rec.metrics?.lines ?? 0)) return warned ? 'empty-warn' : 'empty';
  if (warned || flags.includes('damaged') || flags.includes('limited')) return 'warn';
  return 'ok';
}

/** 경고 글 → 코드(숫자를 #로 — 같은 종류를 한데 센다) */
export function warningCode(msg) {
  return String(msg)
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .slice(0, 120);
}

/** 예외 글 → 코드(첫 줄, 경로·숫자를 지운다) */
export function exceptionCode(err) {
  const first = String(err).split('\n')[0] ?? '';
  return first
    .replace(/(?:[A-Za-z]:)?[\\/][^\s'"():]+/g, '<경로>')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .slice(0, 120);
}

/**
 * 백분위(가장 가까운 순위)·최대·평균. 값이 없으면 n: 0만
 * @param {number[]} values
 */
export function percentiles(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const at = (p) => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
  const sum = v.reduce((s, x) => s + x, 0);
  return { n: v.length, p50: at(50), p90: at(90), p95: at(95), p99: at(99), max: v[v.length - 1], mean: Math.round((sum / v.length) * 10) / 10 };
}

const bump = (obj, key, by = 1) => {
  obj[key] = (obj[key] ?? 0) + by;
};
const sortedCounts = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const short = (sha) => String(sha).slice(0, 16);

/** 큰·느린 파일 한 줄 */
function fileBrief(r) {
  const out = { sha256: short(r.sha256), sizeMB: Math.round(r.size / 1e5) / 10, edition: r.edition, class: r.class, ms: r.ms ?? null };
  if (r.inflated) out.inflated = true;
  if (r.heapMB !== undefined) out.heapMB = r.heapMB;
  if (r.rssMB !== undefined) out.rssMB = r.rssMB;
  if (r.mem) {
    out.peakHeapMB = r.mem.peakHeapMB;
    out.peakExternalMB = r.mem.peakExternalMB;
    out.peakRssMB = r.mem.peakRssMB;
    if (r.mem.peakHeapExternalMB !== undefined) out.peakHeapExternalMB = r.mem.peakHeapExternalMB;
    if (r.mem.maxRssMB !== undefined) out.maxRssMB = r.mem.maxRssMB;
  }
  return out;
}

/**
 * records → summary.json 본문(done: true)
 * @param {any[]} records
 * @param {Record<string, unknown>} info 실행 정보(source·options·시각·파일 수)
 */
export function summarize(records, info = {}) {
  const classes = {};
  const classesAll = {};
  const byEdition = {};
  const byEditionAll = {};
  const byContainer = {};
  const warningCodes = {};
  const exceptions = {};
  const flags = {};
  const totals = { faces: 0, edges: 0, definitions: 0, instances: 0, materials: 0, textures: 0, triangles: 0, segments: 0, meshes: 0, lines: 0 };
  const stageNames = ['inflate', 'images', 'unpack', 'parse', 'scene'];
  const times = { total: [] };
  for (const s of stageNames) times[s] = [];
  const mem = { heapMB: [], rssMB: [], peakHeapMB: [], peakExternalMB: [], peakHeapExternalMB: [], peakRssMB: [], maxRssMB: [] };
  let warningFiles = 0;
  let exceptionFiles = 0;
  let inflated = 0;
  /** 2021+ model.dat를 어떻게 읽었는지(stream 풀면서 · held 풀면서 읽었지만 정의 절은 통째로 · whole 통째로 · shape·inflate 풀면서 읽다 통째로 다시) */
  const modelRead = {};
  /** 파일을 어떻게 읽었는지(parts 2021+ 꾸러미에서 필요한 자리만 · whole 파일 전체) */
  const fileRead = {};
  for (const r of records) {
    const cls = r.class ?? classify(r);
    const ed = r.edition ?? editionOf(r.header?.major);
    const weight = Math.max(1, r.count ?? 1);
    bump(classes, cls);
    bump(classesAll, cls, weight);
    byEdition[ed] ??= {};
    byEditionAll[ed] ??= {};
    bump(byEdition[ed], cls);
    bump(byEditionAll[ed], cls, weight);
    const ct = r.header?.container ?? 'none';
    byContainer[ct] ??= {};
    bump(byContainer[ct], cls);
    if (r.error) {
      exceptionFiles++;
      bump(exceptions, exceptionCode(r.error));
      continue;
    }
    if (r.warnings?.length) {
      warningFiles++;
      for (const code of new Set(r.warnings.map(warningCode))) bump(warningCodes, code);
    }
    for (const f of r.flags ?? []) bump(flags, f);
    if (r.inflated) inflated++;
    if (r.modelRead) bump(modelRead, r.modelRead);
    if (r.fileRead) bump(fileRead, r.fileRead);
    const m = r.metrics ?? {};
    totals.faces += m.faces ?? 0;
    totals.edges += m.edges ?? 0;
    totals.definitions += m.defs ?? 0;
    totals.instances += m.inst ?? 0;
    totals.materials += m.mats ?? 0;
    totals.textures += m.tex ?? 0;
    totals.triangles += m.tri ?? 0;
    totals.segments += m.seg ?? 0;
    totals.meshes += m.meshes ?? 0;
    totals.lines += m.lines ?? 0;
    if (r.ms) {
      times.total.push(r.ms.total);
      for (const s of stageNames) if (r.ms[s] !== undefined) times[s].push(r.ms[s]);
    }
    if (r.heapMB !== undefined) mem.heapMB.push(r.heapMB);
    if (r.rssMB !== undefined) mem.rssMB.push(r.rssMB);
    if (r.mem) {
      mem.peakHeapMB.push(r.mem.peakHeapMB);
      mem.peakExternalMB.push(r.mem.peakExternalMB);
      if (r.mem.peakHeapExternalMB !== undefined) mem.peakHeapExternalMB.push(r.mem.peakHeapExternalMB);
      mem.peakRssMB.push(r.mem.peakRssMB);
      if (r.mem.maxRssMB !== undefined) mem.maxRssMB.push(r.mem.maxRssMB);
    }
  }
  const sortEd = (o) => Object.fromEntries(Object.keys(o).sort(editionOrder).map((k) => [k, o[k]]));
  const timingMs = {};
  for (const [k, v] of Object.entries(times)) if (v.length) timingMs[k] = percentiles(v);
  const memory = {};
  for (const [k, v] of Object.entries(mem)) if (v.length) memory[k] = percentiles(v);
  const parsed = records.filter((r) => !r.error);
  return {
    done: true,
    schema: SCHEMA,
    ...info,
    classes: sortedCounts(classes),
    classesAllFiles: sortedCounts(classesAll),
    byEdition: sortEd(byEdition),
    byEditionAllFiles: sortEd(byEditionAll),
    byContainer,
    warningFiles,
    warningCodes: sortedCounts(warningCodes),
    exceptionFiles,
    exceptions: sortedCounts(exceptions),
    flags: sortedCounts(flags),
    inflatedFiles: inflated,
    modelRead: sortedCounts(modelRead),
    fileRead: sortedCounts(fileRead),
    totals,
    timingMs,
    memory,
    largest: [...records].sort((a, b) => b.size - a.size).slice(0, 10).map(fileBrief),
    slowest: [...parsed]
      .filter((r) => r.ms)
      .sort((a, b) => b.ms.total - a.ms.total)
      .slice(0, 10)
      .map(fileBrief),
  };
}

/** 표 한 줄 맞추기 */
const pad = (s, n) => {
  const t = String(s);
  // 한글은 두 칸으로 센다
  const w = [...t].reduce((x, c) => x + (/[ᄀ-ￜ]/.test(c) ? 2 : 1), 0);
  return t + ' '.repeat(Math.max(0, n - w));
};

/** summary → 사람이 읽는 몇 줄(판 × 분류 표 — 칸은 "같은 내용을 뺀 수(모든 파일 수)") */
export function formatSummary(s) {
  const lines = [];
  const f = s.files ?? {};
  lines.push(`파일 ${f.found ?? '?'}개, 같은 내용을 빼면 ${f.unique ?? '?'}개, 해석 ${f.processed ?? '?'}개`);
  const cols = CLASSES.filter((c) => (s.classes ?? {})[c]);
  lines.push([pad('판', 6), ...cols.map((c) => pad(CLASS_LABELS[c] ?? c, 14))].join(' | '));
  for (const [ed, row] of Object.entries(s.byEdition ?? {})) {
    const all = s.byEditionAllFiles?.[ed] ?? {};
    lines.push([pad(ed, 6), ...cols.map((c) => pad(row[c] ? `${row[c]}(${all[c] ?? row[c]})` : '-', 14))].join(' | '));
  }
  lines.push(`경고 파일 ${s.warningFiles ?? 0}개, 예외 ${s.exceptionFiles ?? 0}개, 풀면서 읽기 ${s.inflatedFiles ?? 0}개`);
  const again = Object.entries(s.modelRead ?? {}).filter(([k]) => k === 'held' || k === 'shape' || k === 'inflate');
  if (again.length) lines.push(`  정의를 하나씩 읽지 못한 파일: ${again.map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  const reads = Object.entries(s.fileRead ?? {});
  if (reads.length) lines.push(`  파일 읽기: ${reads.map(([k, n]) => `${k === 'parts' ? '필요한 자리만' : k === 'whole' ? '통째로' : k} ${n}`).join(' · ')}`);
  for (const [code, n] of Object.entries(s.warningCodes ?? {}).slice(0, 12)) lines.push(`  경고 ${String(n).padStart(4)}  ${code}`);
  for (const [code, n] of Object.entries(s.exceptions ?? {}).slice(0, 12)) lines.push(`  예외 ${String(n).padStart(4)}  ${code}`);
  const t = s.timingMs?.total;
  if (t?.n) lines.push(`해석 시간(ms) p50 ${t.p50} · p90 ${t.p90} · p95 ${t.p95} · p99 ${t.p99} · 최대 ${t.max}`);
  for (const b of (s.largest ?? []).slice(0, 5)) {
    const both = b.peakHeapExternalMB !== undefined ? ` · 최대 heap+external ${b.peakHeapExternalMB} MB` : '';
    const memText = b.peakRssMB !== undefined ? ` 최대 heap ${b.peakHeapMB} MB${both} · 최대 rss ${b.maxRssMB ?? b.peakRssMB} MB` : b.heapMB !== undefined ? ` heap +${b.heapMB} MB · rss ${b.rssMB} MB` : '';
    lines.push(`  큰 파일 ${b.sha256} ${b.sizeMB} MB ${b.edition} ${b.class} ${b.ms?.total ?? '-'} ms${memText}`);
  }
  return lines.join('\n');
}

/** 지표 두 벌의 다른 열쇠 → { 열쇠: [전, 후] } */
function metricDiff(a, b) {
  const out = {};
  for (const k of METRIC_KEYS) {
    const x = a?.[k] ?? null;
    const y = b?.[k] ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)) out[k] = [x, y];
  }
  return out;
}

/** 경고 코드 목록(정렬)이 다른지 */
function warningDiff(a, b) {
  const x = (a ?? []).map(warningCode).sort();
  const y = (b ?? []).map(warningCode).sort();
  return JSON.stringify(x) === JSON.stringify(y) ? null : [x, y];
}

/** 바뀐 크기(삼각형·선분·면 수의 상대 변화 최대값) — 목록 차례 */
function changeWeight(changes) {
  let w = 0;
  for (const k of ['tri', 'seg', 'faces', 'edges', 'meshes', 'lines']) {
    const c = changes[k];
    if (!c) continue;
    const [x, y] = c.map((v) => (typeof v === 'number' ? v : 0));
    w = Math.max(w, Math.abs(y - x) / Math.max(1, Math.abs(x)));
  }
  return w || (Object.keys(changes).length ? 1e-9 : 0);
}

/**
 * 두 결과(records) 비교: 분류가 바뀐 파일, 지표·경고가 바뀐 해시(상위 top), 새 예외, 한쪽에만 있는 파일
 * @param {any[]} before
 * @param {any[]} after
 * @param {{ top?: number }} opts
 */
export function compareRuns(before, after, opts = {}) {
  const top = opts.top ?? 20;
  const a = new Map(before.map((r) => [r.sha256, r]));
  const b = new Map(after.map((r) => [r.sha256, r]));
  const classChanges = [];
  const metricChanges = [];
  const newExceptions = [];
  const fixedExceptions = [];
  let common = 0;
  for (const [sha, x] of a) {
    const y = b.get(sha);
    if (!y) continue;
    common++;
    const cx = x.class ?? classify(x);
    const cy = y.class ?? classify(y);
    if (cx !== cy) classChanges.push({ sha256: sha, edition: y.edition ?? x.edition, before: cx, after: cy });
    if (y.error && !x.error) newExceptions.push({ sha256: sha, edition: y.edition ?? x.edition, code: exceptionCode(y.error) });
    if (x.error && !y.error) fixedExceptions.push({ sha256: sha, edition: y.edition, code: exceptionCode(x.error) });
    if (x.error || y.error) continue;
    const changes = metricDiff(x.metrics, y.metrics);
    const w = warningDiff(x.warnings, y.warnings);
    if (w) changes.warnings = w;
    // 장면 출력 해시는 두 결과에 다 있을 때만 본다(해시가 없던 옛 결과와도 견줄 수 있게)
    if (x.digest && y.digest && x.digest !== y.digest) changes.digest = [x.digest, y.digest];
    const fx = JSON.stringify([...(x.flags ?? [])].sort());
    const fy = JSON.stringify([...(y.flags ?? [])].sort());
    if (fx !== fy) changes.flags = [x.flags ?? [], y.flags ?? []];
    if (Object.keys(changes).length) metricChanges.push({ sha256: sha, edition: y.edition ?? x.edition, weight: changeWeight(changes), changes });
  }
  metricChanges.sort((p, q) => q.weight - p.weight || p.sha256.localeCompare(q.sha256));
  const onlyBefore = [...a.keys()].filter((k) => !b.has(k));
  const onlyAfter = [...b.keys()].filter((k) => !a.has(k));
  const timing = (rs) => percentiles(rs.filter((r) => r.ms && !r.error && b.has(r.sha256) && a.has(r.sha256)).map((r) => r.ms.total));
  return {
    common,
    onlyBefore: onlyBefore.length,
    onlyAfter: onlyAfter.length,
    classChanged: classChanges.length,
    classChanges: classChanges.slice(0, top),
    metricChanged: metricChanges.length,
    metricChanges: metricChanges.slice(0, top).map(({ weight: _w, ...rest }) => rest),
    newExceptions,
    fixedExceptions,
    timingMs: { before: timing(before), after: timing(after) },
    changed: classChanges.length + metricChanges.length + newExceptions.length > 0,
  };
}

/** 비교 → 사람이 읽는 몇 줄 */
export function formatCompare(c) {
  const lines = [];
  lines.push(`같은 해시 ${c.common}개(전에만 ${c.onlyBefore} · 후에만 ${c.onlyAfter})`);
  lines.push(`분류가 바뀐 파일 ${c.classChanged}개, 지표·경고가 바뀐 파일 ${c.metricChanged}개, 새 예외 ${c.newExceptions.length}개, 없어진 예외 ${c.fixedExceptions.length}개`);
  for (const x of c.classChanges) lines.push(`  분류 ${short(x.sha256)} ${x.edition}: ${x.before} → ${x.after}`);
  for (const x of c.metricChanges) {
    const parts = Object.entries(x.changes).map(([k, [p, q]]) => `${k} ${JSON.stringify(p)} → ${JSON.stringify(q)}`);
    lines.push(`  지표 ${short(x.sha256)} ${x.edition}: ${parts.join(', ').slice(0, 400)}`);
  }
  for (const x of c.newExceptions) lines.push(`  새 예외 ${short(x.sha256)} ${x.edition}: ${x.code}`);
  const tb = c.timingMs?.before;
  const ta = c.timingMs?.after;
  if (tb?.n && ta?.n) lines.push(`해석 시간(ms, 같은 해시) p50 ${tb.p50} → ${ta.p50} · p95 ${tb.p95} → ${ta.p95} · 최대 ${tb.max} → ${ta.max}`);
  return lines.join('\n');
}
