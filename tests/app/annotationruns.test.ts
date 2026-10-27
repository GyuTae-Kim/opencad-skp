/**
 * 주석 선분을 나무 노드별로 숨기기: 해석기가 주석 선분 묶음마다 노드 구간(meta.annotationRuns)을 적고,
 * 화면은 숨긴 그룹·컴포넌트 안 치수선·지시선 구간만 숨긴다(라벨과 같게). 예전에는 모형에 바로 놓인 형상을 숨길 때만 모두 함께 숨겼다.
 */
import { describe, expect, it } from 'vitest';
import { annotationHiddenRanges, createDoc, itemVisible, readAnnotationRuns } from '../../src/app/doc';
import { skpToScene } from '../../src/index';
import { dimPoint, entities, IDENTITY13, instance, linearDims, modelDat, skpFile } from '../build';

/** 뿌리에 치수 하나, 그룹 둘(각각 안에 치수 하나)을 둔 모형 */
function bytes(): Uint8Array {
  const dim = (id: number, y: number) => linearDims([{ id, start: dimPoint(1, [0, y, 0]), end: dimPoint(1, [20, y, 0]), normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, offset: 2 }]);
  const inner = (id: number, dimId: number, y: number) => entities(id, { extra: [dim(dimId, y)] });
  const root = entities(undefined, {
    groups: [instance(45, 73, IDENTITY13), instance(46, 74, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])],
    extra: [dim(60, 0)],
  });
  return skpFile(
    modelDat({
      root,
      definitions: [
        { name: 'A', entities: inner(73, 61, 10), kind: 1 },
        { name: 'B', entities: inner(74, 62, 20), kind: 1 },
      ],
    }),
  );
}

describe('주석 선분 노드 구간', () => {
  it('해석기: 나무가 있으면 치수선 묶음에 노드 구간(뿌리 -1, 그룹 0·1)을 적고, 없으면 적지 않는다', () => {
    const s = skpToScene(bytes(), { outline: true });
    const runs = (s.meta as { annotationRuns?: Record<string, { start: Uint32Array; node: Int32Array }> }).annotationRuns!;
    expect(runs).toBeDefined();
    const ids = Object.keys(runs);
    expect(ids.length).toBe(1);
    const r = runs[ids[0]!]!;
    expect([...r.node].sort()).toEqual([-1, 0, 1]);
    expect(r.start[0]).toBe(0);
    expect([...r.start]).toEqual([...r.start].sort((a, b) => a - b));
    // 나무 없이 읽으면(outline 끔) 구간이 없다 — 출력은 예전과 같다
    expect((skpToScene(bytes()).meta as { annotationRuns?: unknown }).annotationRuns).toBeUndefined();
  });

  it('화면: 그룹 하나를 숨기면 그 그룹 치수선 구간만, 모두 숨기면 묶음째 숨긴다', () => {
    const d = createDoc('a.skp', 1, { scene: skpToScene(bytes(), { outline: true }), ms: 1 });
    expect(d.annotationRuns.size).toBe(1);
    const [id, runs] = [...d.annotationRuns][0]!;
    const item = d.scene.meshes.length + d.lineIndex.get(id)!;
    const total = d.scene.lines[d.lineIndex.get(id)!]!.positions.length / 6;
    expect(annotationHiddenRanges(d).size).toBe(0);
    // 그룹 0 숨김 → 그 구간만
    d.hiddenNodes.add(0);
    const k = runs.node.indexOf(0);
    const end = k + 1 < runs.start.length ? runs.start[k + 1]! : total;
    expect(annotationHiddenRanges(d).get(item)).toEqual([{ start: runs.start[k]!, count: end - runs.start[k]! }]);
    expect(itemVisible(d, item)).toBe(true);
    // 분리해서 보기(그룹 0만): 그룹 1과 바로 놓인 형상을 숨긴다 → 그룹 0 치수선만 남는다
    d.hiddenNodes.clear();
    d.hiddenNodes.add(1);
    const loose = d.outline.findIndex((o) => o.kind === 'loose');
    if (loose >= 0) d.hiddenOutline.add(loose);
    const ranges = annotationHiddenRanges(d).get(item)!;
    const shown = total - ranges.reduce((a, r) => a + r.count, 0);
    const len = (node: number): number => {
      const j = runs.node.indexOf(node);
      return (j + 1 < runs.start.length ? runs.start[j + 1]! : total) - runs.start[j]!;
    };
    // 바로 놓인 형상 항목이 없으면(뿌리에 면이 없음) 뿌리 치수는 라벨처럼 남는다
    expect(shown).toBe(len(0) + (loose < 0 ? len(-1) : 0));
    expect(ranges.reduce((a, r) => a + r.count, 0)).toBe(len(1) + (loose >= 0 ? len(-1) : 0));
    // 모든 구간의 노드를 숨기면 묶음째(뿌리 구간이 남으면 그 구간만 보인다)
    d.hiddenNodes.add(0);
    if (loose >= 0) {
      expect(itemVisible(d, item)).toBe(false);
      expect(annotationHiddenRanges(d).has(item)).toBe(false);
    } else expect(annotationHiddenRanges(d).get(item)!.reduce((a, r) => a + r.count, 0)).toBe(len(0) + len(1));
  });

  it('readAnnotationRuns: 주석 항목이 아니거나 꼴·노드 차례가 틀린 칸은 버린다', () => {
    const kinds = new Map([['skp-dims-1', 'dimensions' as const]]);
    const ok = { start: Uint32Array.from([0, 3]), node: Int32Array.from([-1, 2]) };
    expect(readAnnotationRuns({ 'skp-dims-1': ok }, kinds, 3).get('skp-dims-1')).toEqual(ok);
    expect(readAnnotationRuns({ 'skp-dims-1': ok }, kinds, 2).size).toBe(0);
    expect(readAnnotationRuns({ 'skp-edges-1': ok }, kinds, 3).size).toBe(0);
    expect(readAnnotationRuns({ 'skp-dims-1': { start: [0, 3], node: [-1, 2] } }, kinds, 3).size).toBe(0);
    expect(readAnnotationRuns({ 'skp-dims-1': { start: Uint32Array.from([3, 0]), node: Int32Array.from([-1, 2]) } }, kinds, 3).size).toBe(0);
    expect(readAnnotationRuns(null, kinds, 3).size).toBe(0);
  });
});
