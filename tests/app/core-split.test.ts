/**
 * 3D 뷰어 코어를 문서를 열 때 나눠 받기(app/core.ts): 앱 입구(src/app/main.ts)에서 정적 가져오기로 닿는 모듈은 코어 입구(opencad-viewer3d)와
 * 무거운 모듈(viewer·renderer 등)을 값으로 가져오지 않는다(`import type`만). 값은 작은 코어 모듈만, 입구는 core.ts의 import()로만.
 * 이 규칙이 깨지면 번들러가 코어 전체를 첫 화면 JS에 다시 넣는다.
 *
 * src/ 전체가 아니라 main.ts에서 닿는 그래프만 본다 — 해석기 입구(src/index.ts)와 워커는 다른 묶음이다(워커는 new URL로 만든다).
 * verbatimModuleSyntax라 `import { type A } from '…'`는 빈 가져오기(모듈을 그대로 불러온다)로 남으므로 값 가져오기로 센다.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CORE = join(ROOT, 'node_modules/opencad-viewer3d/src');
/** 첫 화면에서 바로 가져와도 되는 코어 모듈(작고 다른 코어 모듈을 거의 끌어오지 않는다) */
const SMALL = new Set(['camera', 'pointer', 'viewcube', 'theme', 'section', 'inference', 'types', 'math', 'bounds']);

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
    expect(rel).toContain('src/app/measure.ts');
    expect(rel).toContain('src/app/core.ts');
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
