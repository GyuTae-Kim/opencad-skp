/**
 * 장면이 숨기는 맨 위 주석(70차): 숨긴 형상을 기억하는 장면(use 깃발 0x80 — 2019 이하 0x10)의 숨긴 목록은 맨 위(모형에 바로 놓인) 요소 가운데
 * 인스턴스가 아닌 것의 보임을 정한다(공개 Ruby API Page#hidden_entities — 안쪽은 인스턴스만). 해석기는 모형에서 보이는데 그런 장면이 숨기는
 * 맨 위 문자·치수·단면 기호를 숨기는 장면이 같은 것끼리 묶음 k로 모아 노드 −2 − k에 두고(meta.pages[].hiddenAnnotations), 화면은 그 장면을 고른 동안
 * 그 노드를 숨긴다(라벨·선분 구간·끝 표시). 단면 meta의 node는 자르는 범위라 그대로 −1이다.
 */
import { describe, expect, it } from 'vitest';
import { annotationHiddenRanges, applySceneHidden } from '../../src/app/annotations';
import { createDoc, itemVisible, nodeHiddenForLabels, type SkpDoc } from '../../src/app/doc';
import { readPage } from '../../src/app/pages';
import { skpToScene } from '../../src/index';
import type { SkpMetaExtras } from '../../src/meta';
import { mfcFile, move13, squareEntities, type MfcLinearDimSpec, type MfcPageSpec, type MfcSpec } from '../mfcwrite';

const cam = { eye: [0, -50, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
const dim = (y: number): MfcLinearDimSpec => ({ start: [0, y, 0], end: [10, y, 0], normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, distance: -4 });

/**
 * 뿌리: 글 둘(둘째는 모형에서 숨김)·치수 둘·단면 하나, 정의 안: 치수 하나(배치 하나).
 * 장면 A: 글 0·치수 0·정의 안 치수·숨긴 글을 숨김, B: 치수 0·단면을 숨김, C: 숨긴 형상을 기억하지만 아무것도 숨기지 않음, D: 카메라만.
 * 숨기는 장면 묶음: 글 0 = [A] → 0, 치수 0 = [A, B] → 1, 단면 = [B] → 2(모으는 차례 — 글·치수·단면)
 */
function spec(pages?: MfcPageSpec[]): MfcSpec {
  return {
    schemas: 'v15',
    definitions: [{ name: '판', entities: squareEntities({ linearDims: [dim(0)] }) }],
    root: squareEntities({
      instances: [{ def: 0, xform: move13(20, 0, 0), name: '판 1' }],
      texts: [
        { text: '메모', leader: 2, at: [1, 1, 0], leaderVec: [0, 0, 5] },
        { text: '숨긴 글', leader: 2, at: [2, 2, 0], leaderVec: [0, 0, 5], hidden: true },
      ],
      linearDims: [dim(0), dim(5)],
      sections: [{ plane: [1, 0, 0, -5] }],
    }),
    pages: pages ?? [
      {
        name: 'A',
        flags: 0x1 | 0x10,
        camera: cam,
        hidden: [
          { kind: 'text', index: 0 },
          { kind: 'dimension', index: 0 },
          { kind: 'dimension', index: 0, def: 0 },
          { kind: 'text', index: 1 },
        ],
      },
      { name: 'B', flags: 0x1 | 0x10, camera: cam, hidden: [{ kind: 'dimension', index: 0 }, { kind: 'section', index: 0 }] },
      { name: 'C', flags: 0x1 | 0x10, camera: cam },
      { name: 'D', flags: 0x1, camera: cam },
    ],
  };
}

const metaOf = (s: ReturnType<typeof skpToScene>): SkpMetaExtras => s.meta as SkpMetaExtras;

/** 장면 적용 흉내(앱 applyPage의 숨긴 노드 몫): annotations.ts applySceneHidden 뒤 장면의 나무 노드 */
function apply(d: SkpDoc, index: number): void {
  const page = d.pages[index]!;
  applySceneHidden(d.hiddenNodes, page);
  for (const n of page.hiddenNodes ?? []) d.hiddenNodes.add(n);
}

describe('장면이 숨기는 맨 위 주석', () => {
  it('해석기: 맨 위에서 모형에 보이는 문자·치수·단면 기호만 숨기는 장면 묶음 노드로, 장면마다 숨기는 묶음', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const m = metaOf(s);
    expect(m.texts!.map((t) => t.node)).toEqual([-2, -1]);
    // 뿌리 치수 둘(장면이 숨기는 것 −3, 아닌 것 −1) 뒤 정의 안 치수(나무 노드 0 — 안쪽 요소는 장면 숨긴 형상이 정하지 않는다)
    expect(m.dimensions!.map((x) => x.node)).toEqual([-3, -1, 0]);
    expect(m.sectionPlanes!.map((x) => x.node)).toEqual([-1]);
    expect(m.pages!.map((p) => p.hiddenAnnotations)).toEqual([[0, 1], [1, 2], [], undefined]);
    // 선분 구간: 치수선 묶음에 −3·−1·0, 지시선에 −2, 단면 기호에 −4
    const runs = m.annotationRuns!;
    const nodesOf = (kind: 'dimensions' | 'leaders' | 'sectionPlanes'): number[] => [...new Set(m.annotationItems![kind].flatMap((id) => [...(runs[id]?.node ?? [])]))].sort((a, b) => a - b);
    expect(nodesOf('dimensions')).toEqual([-3, -1, 0]);
    expect(nodesOf('leaders')).toEqual([-2]);
    expect(nodesOf('sectionPlanes')).toEqual([-4]);
    // 끝 표시도 같은 노드
    const marks = m.annotationMarks!;
    expect([...new Set(m.annotationItems!.dimensions.flatMap((id) => [...(marks[id]?.node ?? [])]))].sort((a, b) => a - b)).toEqual([-3, -1, 0]);
  });

  it('해석기: 숨긴 형상을 기억하는 장면이 맨 위 주석을 숨기지 않으면 예전과 같다(칸 없음, 나무 없이 읽으면 구간도 없음)', () => {
    const quiet = spec([
      { name: 'A', flags: 0x1 | 0x10, camera: cam, hidden: [{ kind: 'dimension', index: 0, def: 0 }, { kind: 'text', index: 1 }] },
      { name: 'D', flags: 0x1, camera: cam },
    ]);
    const s = skpToScene(mfcFile(quiet), { outline: true });
    const m = metaOf(s);
    expect(m.texts!.map((t) => t.node)).toEqual([-1, -1]);
    expect(m.dimensions!.map((x) => x.node)).toEqual([-1, -1, 0]);
    expect(m.pages!.map((p) => p.hiddenAnnotations)).toEqual([undefined, undefined]);
    expect(metaOf(skpToScene(mfcFile(quiet))).annotationRuns).toBeUndefined();
    // 묶음이 있으면 나무 없이 읽어도 구간을 적는다(뿌리 −1과 묶음 노드)
    const bare = metaOf(skpToScene(mfcFile(spec())));
    expect(bare.annotationRuns).toBeDefined();
    expect(bare.pages!.map((p) => p.hiddenAnnotations)).toEqual([[0, 1], [1, 2], [], undefined]);
  });

  it('화면: 장면을 고르면 그 장면이 숨기는 묶음의 라벨·선분 구간을 숨기고, 숨긴 형상을 기억하지 않는 장면은 그대로 둔다', () => {
    const d = createDoc('a.skp', 1, { scene: skpToScene(mfcFile(spec()), { outline: true }), ms: 1 });
    expect(d.pages.map((p) => p.hiddenAnnotations)).toEqual([[0, 1], [1, 2], [], undefined]);
    const items = metaOf(d.scene).annotationItems!;
    const itemOf = (id: string): number => d.scene.meshes.length + d.lineIndex.get(id)!;
    const dimItem = itemOf(items.dimensions[0]!);
    const secItem = itemOf(items.sectionPlanes[0]!);
    const dimRuns = d.annotationRuns.get(items.dimensions[0]!)!;
    const runOf = (node: number): { start: number; count: number } => {
      const k = dimRuns.node.indexOf(node);
      const total = d.scene.lines[d.lineIndex.get(items.dimensions[0]!)!]!.positions.length / 6;
      const end = k + 1 < dimRuns.start.length ? dimRuns.start[k + 1]! : total;
      return { start: dimRuns.start[k]!, count: end - dimRuns.start[k]! };
    };
    expect(annotationHiddenRanges(d).size).toBe(0);
    // A: 글 0(묶음 0)·치수 0(묶음 1)
    apply(d, 0);
    expect([nodeHiddenForLabels(d, -2), nodeHiddenForLabels(d, -3), nodeHiddenForLabels(d, -4), nodeHiddenForLabels(d, -1)]).toEqual([true, true, false, false]);
    expect(annotationHiddenRanges(d).get(dimItem)).toEqual([runOf(-3)]);
    expect(itemVisible(d, dimItem)).toBe(true);
    expect(itemVisible(d, secItem)).toBe(true);
    // B: 치수 0·단면 기호(단면 기호 묶음은 구간이 모두 숨어 묶음째)
    apply(d, 1);
    expect([nodeHiddenForLabels(d, -2), nodeHiddenForLabels(d, -3), nodeHiddenForLabels(d, -4)]).toEqual([false, true, true]);
    expect(itemVisible(d, secItem)).toBe(false);
    // D: 숨긴 형상을 기억하지 않는 장면 — 그대로
    apply(d, 3);
    expect(itemVisible(d, secItem)).toBe(false);
    // C: 기억하지만 아무것도 숨기지 않음 — 모두 보인다
    apply(d, 2);
    expect(d.hiddenNodes.size).toBe(0);
    expect(itemVisible(d, secItem)).toBe(true);
    expect(annotationHiddenRanges(d).size).toBe(0);
    // 보기에서 숨긴 그룹: 숨긴 개체를 기억하는 장면(A)은 장면 목록으로 비우고, 카메라만 기억하는 장면(D)은 그대로 둔다
    d.hiddenNodes.add(0);
    apply(d, 3);
    expect([...d.hiddenNodes]).toEqual([0]);
    apply(d, 0);
    expect([...d.hiddenNodes].sort((a, b) => a - b)).toEqual([-3, -2]);
  });

  it('applySceneHidden: 기억하는 쪽만 바꾼다(숨긴 개체만 — 묶음 노드는 둔다, 숨긴 형상만 — 나무 노드는 둔다)', () => {
    const set = (): Set<number> => new Set([-3, -2, 0, 4]);
    const objectsOnly = set();
    applySceneHidden(objectsOnly, { hiddenNodes: [4] });
    expect([...objectsOnly]).toEqual([-3, -2]);
    const geometryOnly = set();
    applySceneHidden(geometryOnly, { hiddenAnnotations: [2] });
    expect([...geometryOnly].sort((a, b) => a - b)).toEqual([-4, 0, 4]);
    const neither = set();
    applySceneHidden(neither, {});
    expect([...neither]).toEqual([-3, -2, 0, 4]);
  });

  it('readPage: 묶음 목록은 0 이상 정수만', () => {
    expect(readPage({ name: 'A', hiddenAnnotations: [1, -1, 2.5, 'x', 0] }, 0).hiddenAnnotations).toEqual([1, 0]);
    expect(readPage({ name: 'B' }, 0).hiddenAnnotations).toBeUndefined();
  });
});
