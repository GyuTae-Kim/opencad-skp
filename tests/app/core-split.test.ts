/**
 * 3D 뷰어 코어와 측정 도구를 문서를 열 때 나눠 받기(app/core.ts): 앱 입구(src/app/main.ts)에서 정적 가져오기로 닿는 모듈은 코어 입구(opencad-viewer3d)와
 * 무거운 모듈(viewer·renderer 등)을 값으로 가져오지 않는다(`import type`만). 값은 작은 코어 모듈만, 입구는 core.ts의 import()로만.
 * 측정 도구(measure.ts·snap.ts와 코어 inference)도 첫 화면 그래프 밖에 두고 core.ts의 import()로만 받는다(앱은 measurehints.ts의 키 규칙만).
 * 이 규칙이 깨지면 번들러가 코어 전체나 측정 도구를 첫 화면 JS에 다시 넣는다.
 *
 * src/ 전체가 아니라 main.ts에서 닿는 그래프만 본다 — 해석기 입구(src/index.ts)와 워커는 다른 묶음이다(워커는 new URL로 만든다).
 * verbatimModuleSyntax라 `import { type A } from '…'`는 빈 가져오기(모듈을 그대로 불러온다)로 남으므로 값 가져오기로 센다.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CORE = join(ROOT, 'node_modules/opencad-viewer3d/src');
/**
 * 첫 화면에서 바로 가져와도 되는 코어 모듈(작고 다른 코어 모듈을 거의 끌어오지 않는다 — inference는 측정 도구 조각과 함께 받는다).
 * extent는 코어 0.31.0에서 bounds의 itemExtent·itemsExtent를 옮긴 작은 모듈이다(bounds가 같은 이름으로 다시 내보내 그래프에 닿는다 — bounds·math만 가져오고,
 * 앱은 그 함수를 쓰지 않아 첫 화면 JS는 같다)
 */
const SMALL = new Set(['camera', 'pointer', 'viewcube', 'theme', 'section', 'types', 'math', 'bounds', 'extent']);
/** 문서를 열 때 나눠 받는 앱 모듈(첫 화면 그래프에 없어야 한다 — release.ts는 큰 모형 놓기·문맥 잃음과 되찾음) */
const SPLIT_APP = ['src/app/measure.ts', 'src/app/snap.ts', 'src/app/release.ts'];

/** 주석을 뺀 글(주석 속 예시를 가져오기로 세지 않게) */
const stripComments = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

/** 값으로 가져오는(또는 다시 내보내는) 정적 지정자들 — `import type`·`export type`은 뺀다 */
function staticSpecs(text: string): string[] {
  const t = stripComments(text);
  const out: string[] = [];
  for (const m of t.matchAll(/^\s*import\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/gm)) if (!m[1]) out.push(m[2]!);
  for (const m of t.matchAll(/^\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[\w\s,$]*\})\s+from\s+['"]([^'"]+)['"]/gm)) if (!m[1]) out.push(m[2]!);
  return out;
}

/** 코어 입구를 받는 import() 수(타입 자리 typeof import(…)는 뺀다) */
const dynamicCore = (text: string): number => [...stripComments(text).matchAll(/(?<!typeof )import\(\s*'opencad-viewer3d(?:\/[\w-]+)?'\s*\)/g)].length;
/** 동적 import()의 지정자들(타입 자리는 뺀다) */
const dynamicSpecs = (text: string): string[] => [...stripComments(text).matchAll(/(?<!typeof )\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);

type Reader = (path: string) => string | null;
const diskReader: Reader = (p) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);

/** 지정자 → 따라갈 파일(코드가 아니면 null). coreName: 코어 모듈이면 그 이름(입구는 'index') */
function resolveSpec(from: string, spec: string, read: Reader): { file: string | null; coreName?: string } {
  if (spec === 'opencad-viewer3d') return { file: join(CORE, 'index.ts'), coreName: 'index' };
  const sub = /^opencad-viewer3d\/([\w-]+)$/.exec(spec);
  if (sub) return { file: join(CORE, `${sub[1]}.ts`), coreName: sub[1]! };
  if (!spec.startsWith('.')) return { file: null };
  const base = resolve(dirname(from), spec);
  const inCore = base.startsWith(CORE + '/');
  for (const cand of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (!/\.(ts|mjs|js)$/.test(cand) || read(cand) === null) continue;
    return inCore ? { file: cand, coreName: relative(CORE, cand).replace(/\.ts$/, '') } : { file: cand };
  }
  return { file: null };
}

/** 입구에서 정적 가져오기로 닿는 파일과 코어 모듈 */
function walk(entry: string, read: Reader = diskReader): { files: Set<string>; core: Set<string> } {
  const files = new Set<string>();
  const core = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    const text = read(f);
    if (text === null) continue;
    files.add(f);
    for (const spec of staticSpecs(text)) {
      const r = resolveSpec(f, spec, read);
      if (r.coreName) core.add(r.coreName);
      if (r.file && !files.has(r.file)) todo.push(r.file);
    }
  }
  return { files, core };
}

describe('코어 나눠 받기', () => {
  it('main.ts에서 닿는 값 가져오기는 작은 코어 모듈만, 코어 입구는 core.ts의 import()로만', () => {
    const { files, core } = walk(join(ROOT, 'src/app/main.ts'));
    const rel = [...files].map((f) => relative(ROOT, f));
    // 그래프가 실제로 앱을 따라갔는지
    expect(rel).toContain('src/app/app.ts');
    expect(rel).toContain('src/app/measurehints.ts');
    expect(rel).toContain('src/app/core.ts');
    // 측정 도구(줄자·각도기·추정·안내 두기)는 첫 화면 그래프 밖
    expect(rel.filter((f) => SPLIT_APP.includes(f))).toEqual([]);
    // 해석기 입구·워커는 첫 화면 그래프에 없다
    expect(rel.filter((f) => f === 'src/index.ts' || f.includes('/worker/'))).toEqual([]);
    expect([...core].filter((n) => !SMALL.has(n)).sort()).toEqual([]);
    expect(core.has('camera')).toBe(true);
    let dynamic = 0;
    const bad: string[] = [];
    for (const f of files) {
      if (f.startsWith(CORE)) continue;
      const n = dynamicCore(readFileSync(f, 'utf8'));
      if (!n) continue;
      if (f.endsWith('/src/app/core.ts')) dynamic += n;
      else bad.push(relative(ROOT, f));
    }
    expect(bad).toEqual([]);
    expect(dynamic).toBe(1);
    // 측정 도구 조각도 core.ts의 import() 하나로만 받는다
    const measureDyn: string[] = [];
    for (const f of files) if (!f.startsWith(CORE) && dynamicSpecs(readFileSync(f, 'utf8')).includes('./measure')) measureDyn.push(relative(ROOT, f));
    expect(measureDyn).toEqual(['src/app/core.ts']);
    // 큰 모형 놓기·문맥 복구 조각도 core.ts의 import() 하나로만
    const releaseDyn: string[] = [];
    for (const f of files) if (!f.startsWith(CORE) && dynamicSpecs(readFileSync(f, 'utf8')).includes('./release')) releaseDyn.push(relative(ROOT, f));
    expect(releaseDyn).toEqual(['src/app/core.ts']);
  });

  it('훑기는 인라인 type만 쓴 가져오기와 다시 내보내기도 값 가져오기로 잡는다', () => {
    const files: Record<string, string> = {
      '/x/a.ts': "import { b } from './b';\nimport type { Viewer3d } from 'opencad-viewer3d';\n// import { Viewer3d } from 'opencad-viewer3d';\n",
      '/x/b.ts': "import {\n  type Pick3d,\n} from 'opencad-viewer3d';\nexport { c } from './c';\nexport const b = 1;\n",
      '/x/c.ts': "export * from 'opencad-viewer3d/renderer';\nexport type { X } from 'opencad-viewer3d/viewer';\nexport const c = 2;\n",
    };
    const { files: seen, core } = walk('/x/a.ts', (p) => files[p] ?? null);
    expect([...seen].sort()).toEqual(['/x/a.ts', '/x/b.ts', '/x/c.ts']);
    expect([...core].sort()).toEqual(['index', 'renderer']);
    expect(dynamicCore("type Core = typeof import('opencad-viewer3d');\nconst p = import('opencad-viewer3d');")).toBe(1);
    expect(dynamicSpecs("type M = typeof import('./measure');\nconst m = () => import('./measure');\n// import('./x')")).toEqual(['./measure']);
  });

  it('코어 입구를 한 번만 받고 같은 모듈을 준다', async () => {
    const { loadViewerCore } = await import('../../src/app/core');
    const a = loadViewerCore();
    expect(loadViewerCore()).toBe(a);
    const m = await a;
    expect(typeof m.Viewer3d).toBe('function');
    // 앱이 바로 가져온 작은 모듈과 코어가 같은 객체를 쓴다(뷰 이름 번역이 코어 그림에도 닿게, 테마 색이 같게)
    const { VIEW_LABELS } = await import('opencad-viewer3d/camera');
    expect(m.VIEW_LABELS).toBe(VIEW_LABELS);
    const { DARK_THEME } = await import('opencad-viewer3d/theme');
    expect(m.DARK_THEME).toBe(DARK_THEME);
    // 첫 화면용으로 앱이 둔 단면 수 한도가 코어와 같다
    const { MAX_SECTION_PLANES } = await import('../../src/app/doc');
    expect(MAX_SECTION_PLANES).toBe(m.MAX_SECTION_PLANES);
  });
});

describe('측정 도구 나눠 받기', () => {
  it('측정 도구 조각을 한 번만 받고, 앱이 쓰는 키 규칙은 첫 화면 모듈(measurehints)과 같은 것', async () => {
    const { loadMeasure } = await import('../../src/app/core');
    const a = loadMeasure();
    expect(loadMeasure()).toBe(a);
    const m = await a;
    expect(typeof m.MeasureTool).toBe('function');
    const hints = await import('../../src/app/measurehints');
    expect(m.guideKeyFor).toBe(hints.guideKeyFor);
    // 잠금·안내 두기 키 안내 글과 잠근 방향 이름은 도구를 켠 뒤에만 쓰므로 조각에 있다(15차 — 첫 화면에는 키 고르기만)
    expect(Object.keys(hints).sort()).toEqual(['guideKeyFor']);
    const snap = await import('../../src/app/snap');
    expect(m.lockName({ kind: 'perpendicular', label: snap.FACE_PERPENDICULAR_LABEL })).toBe('facePerpendicular');
  });

  it('onceImport: 받는 동안·받은 뒤는 같은 약속, 받지 못하면 다음 부름에서 다시 받는다', async () => {
    const { onceImport } = await import('../../src/app/core');
    let n = 0;
    let fail = true;
    const load = onceImport(async () => {
      n++;
      if (fail) throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/measure-x.js');
      return 'ok';
    });
    const p1 = load();
    expect(load()).toBe(p1);
    await expect(p1).rejects.toThrow(/dynamically imported/);
    expect(n).toBe(1);
    fail = false;
    const p2 = load();
    expect(p2).not.toBe(p1);
    await expect(p2).resolves.toBe('ok');
    expect(load()).toBe(p2);
    expect(n).toBe(2);
  });

  it('FirstUse: 받는 동안 여러 번 눌러도 받기는 한 번, 마지막으로 바란 것을 켜고 다시 누르면 거둔다', async () => {
    const { FirstUse } = await import('../../src/app/core');
    let resolve!: () => void;
    const load = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const done = vi.fn();
    const f = new FirstUse<'tape' | 'protractor'>(load, done);
    expect(f.wanted).toBeNull();
    f.request(null);
    expect(load).not.toHaveBeenCalled();
    f.request('tape');
    f.request('protractor');
    f.request('tape');
    expect(load).toHaveBeenCalledTimes(1);
    expect(f.loading).toBe(true);
    expect(f.wanted).toBe('tape');
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledWith('tape', null);
    expect(f.loading).toBe(false);
    expect(f.wanted).toBeNull();
    // 받는 동안 같은 단추를 다시 눌러 거두면 받은 뒤 켜지 않는다
    f.request('tape');
    f.request(null);
    expect(f.wanted).toBeNull();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenLastCalledWith(null, null);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('FirstUse: 받지 못하면 바란 것과 오류를 넘기고, 다음 누르기에서 다시 받는다', async () => {
    const { FirstUse } = await import('../../src/app/core');
    const err = new TypeError('Importing a module script failed.');
    const load = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(undefined);
    const done = vi.fn();
    const f = new FirstUse<'tape'>(load, done);
    f.request('tape');
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('tape', err));
    expect(f.loading).toBe(false);
    f.request('tape');
    await vi.waitFor(() => expect(done).toHaveBeenLastCalledWith('tape', null));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('조각 받기 실패를 알아보고 쉬운 안내를 준다(연결 끊김·새 판)', async () => {
    const { chunkFailText, isChunkLoadError } = await import('../../src/app/core');
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/measure-a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/measure-a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('이 브라우저는 WebGL2를 지원하지 않아 3D 보기를 열 수 없습니다'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(chunkFailText('measure', false)).toMatch(/연결/);
    expect(chunkFailText('measure', true)).toMatch(/새로 고친/);
    expect(chunkFailText('viewer', false)).toMatch(/3D 보기/);
    expect(new Set([chunkFailText('measure', false), chunkFailText('measure', true), chunkFailText('viewer', false), chunkFailText('viewer', true)]).size).toBe(4);
  });
});
