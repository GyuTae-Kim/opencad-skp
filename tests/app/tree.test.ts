import { describe, expect, it } from 'vitest';
import type { Pick3d, Scene3d } from 'opencad-viewer3d';
import {
  INCREMENTAL_PRIMS,
  canHideNode,
  componentImage,
  createDoc,
  hiddenNodeRanges,
  isBigScene,
  selectionRanges,
  docImages,
  fileSafeName,
  itemVisible,
  materialImage,
  nodeSelection,
  selectedNode,
  selectionForPick,
  selectionIds,
  selectionSegments,
  selectionText,
} from '../../src/app/doc';
import { sampleModelDat, sampleSkpBytes } from '../../src/app/sample';
import {
  addRange,
  childrenOf,
  deepestNodeAt,
  isSplit,
  levelNode,
  mergeNodeRanges,
  nodeBox,
  nodeName,
  nodePath,
  nodeRanges,
  normalizeRanges,
  readTree,
  subtractRanges,
  treeDefinitionCounts,
} from '../../src/app/tree';
import { readSkpImages, skpToScene } from '../../src/index';
import { readModelDat } from '../../src/model';
import { buildSceneParts } from '../../src/scene';

const sampleDoc = (extras = false) => createDoc('예제.skp', 1, { scene: skpToScene(sampleSkpBytes(), { name: '예제', outline: true, extras }), ms: 1 });

/** 노드 n의 첫 그물 삼각형을 누른 것처럼 */
function pickAt(scene: Scene3d, meshIndex: number, tri = 0): Pick3d {
  return { kind: 'mesh', id: scene.meshes[meshIndex]!.id, index: tri, point: [0, 0, 0] };
}

describe('구성 나무(화면)', () => {
  it('예제의 나무: 윗단계 10 + 의자 다리 16 + 나무의 줄기·수관 6', () => {
    const d = sampleDoc();
    const t = d.tree!;
    expect(t.count).toBe(32);
    expect(childrenOf(t, -1).map((n) => nodeName(t, n))).toEqual(['집', '지붕', '탁자', '의자 북', '의자 남', '의자 동', '의자 서', '나무', '나무', '나무']);
    const east = 5;
    expect(childrenOf(t, east).map((n) => nodeName(t, n))).toEqual(['앞 왼쪽 다리', '앞 오른쪽 다리', '뒤 왼쪽 다리', '뒤 오른쪽 다리']);
    expect(childrenOf(t, 7).map((n) => nodeName(t, n))).toEqual(['줄기', '수관']);
    expect(t.splitDepth).toBe(2);
    expect(treeDefinitionCounts(t)).toEqual([
      { name: '의자 다리', count: 16 },
      { name: '의자', count: 4 },
      { name: '나무', count: 3 },
      { name: '탁자', count: 1 },
    ]);
    // 윗단계 노드 ↔ outline 항목
    expect(nodeSelection(d, east)).toEqual({ kind: 'outline', index: d.outline.findIndex((r) => r.name === '의자 동') });
    expect(selectedNode(d, nodeSelection(d, east))).toBe(east);
  });

  it('3D 고르기: 접혀 있으면 윗단계, 펼치면 안쪽, 가장 안쪽 방식·Alt는 바로 안쪽', () => {
    const d = sampleDoc();
    const t = d.tree!;
    const east = 5;
    const leg = childrenOf(t, east)[0]!;
    expect(isSplit(t, leg)).toBe(true);
    const p = pickAt(d.scene, t.meshFirst[leg]!);
    expect(deepestNodeAt(t, d.scene, p.id, 0)).toBe(leg);
    expect(levelNode(t, leg, new Set(), 'open')).toBe(east);
    expect(levelNode(t, leg, new Set([east]), 'open')).toBe(leg);
    expect(levelNode(t, leg, new Set(), 'deepest')).toBe(leg);
    // 접혀 있으면 예전처럼 윗단계 항목 전체
    const top = selectionForPick(d, p)!;
    expect(top.kind).toBe('outline');
    expect(selectionText(d, top, p)).toContain('의자 동');
    // 가장 안쪽(Alt)
    const deep = selectionForPick(d, p, true)!;
    expect(deep).toEqual({ kind: 'node', index: leg });
    expect(selectionText(d, deep, p)).toBe('컴포넌트 앞 왼쪽 다리 (의자 다리) · 위치 의자 동 · 태그 Layer0 · 재질 파란 천 · 면 5');
    expect(selectionIds(d, deep).length).toBeGreaterThan(0);
    expect(selectionSegments(d, deep)).toBeNull();
    // 펼친 단계
    d.expanded.add(east);
    expect(selectionForPick(d, p)).toEqual({ kind: 'node', index: leg });
    d.pickMode = 'deepest';
    d.expanded.clear();
    expect(selectionForPick(d, p)).toEqual({ kind: 'node', index: leg });
    // 바로 놓인 형상(잔디)은 바로 놓인 형상 항목
    const loose = d.outline.findIndex((r) => r.kind === 'loose');
    const looseMesh = d.scene.meshes.findIndex((m) => m.id === d.outline[loose]!.ids[0]);
    expect(selectionForPick(d, pickAt(d.scene, looseMesh))).toEqual({ kind: 'outline', index: loose });
    expect(nodePath(t, leg)).toEqual([east, leg]);
  });

  it('숨기기: 노드를 숨기면 안쪽까지, 안쪽만 숨기면 그것만', () => {
    const d = sampleDoc();
    const t = d.tree!;
    const east = 5;
    const leg = childrenOf(t, east)[0]!;
    const items = (n: number): number[] => {
      const out: number[] = [];
      for (let i = t.meshFirst[n]!; i < t.meshEnd[n]!; i++) out.push(i);
      for (let i = t.lineFirst[n]!; i < t.lineEnd[n]!; i++) out.push(t.meshCount + i);
      return out;
    };
    d.hiddenNodes.add(east);
    expect(items(east).every((i) => !itemVisible(d, i))).toBe(true);
    d.hiddenNodes.clear();
    d.hiddenNodes.add(leg);
    expect(items(leg).every((i) => !itemVisible(d, i))).toBe(true);
    const seat = items(east).filter((i) => !items(leg).includes(i));
    expect(seat.length).toBeGreaterThan(0);
    expect(seat.every((i) => itemVisible(d, i))).toBe(true);
  });

  it('부드러운·숨긴 형상은 처음에 숨기고, 켜면 보인다', () => {
    const d = sampleDoc(true);
    const x = d.extras!;
    expect(x.soft.size).toBeGreaterThan(0);
    expect(x.hidden.size).toBeGreaterThan(0);
    expect(x.hiddenFaces).toBe(5); // 옛 담장 상자(바닥 없음)
    const idx = (id: string): number => {
      const m = d.scene.meshes.findIndex((mm) => mm.id === id);
      return m >= 0 ? m : d.scene.meshes.length + d.scene.lines.findIndex((l) => l.id === id);
    };
    const soft = idx([...x.soft][0]!);
    const hid = idx([...x.hidden][0]!);
    expect(itemVisible(d, soft)).toBe(false);
    expect(itemVisible(d, hid)).toBe(false);
    d.showSoft = true;
    d.showHidden = true;
    expect(itemVisible(d, soft)).toBe(true);
    expect(itemVisible(d, hid)).toBe(true);
    // 숨긴 그룹은 나무에 숨김 노드로
    const t = d.tree!;
    expect(t.count).toBe(33);
    const fence = childrenOf(t, -1).find((n) => nodeName(t, n) === '옛 담장')!;
    expect(t.flags[fence]! & 1).toBe(1);
  });

  it('나누지 않은 깊은 노드는 구간에서 모서리 선분·범위를 모은다', () => {
    const parts = buildSceneParts(readModelDat(sampleModelDat()), new Map(), 1, { outline: true, maxSplitItems: 1 });
    const scene: Scene3d = { name: 'x', units: 'inch', meshes: parts.meshes, lines: parts.lines, meta: { tree: parts.tree, outline: parts.outline } };
    const d = createDoc('x', 1, { scene, ms: 1 });
    const t = d.tree!;
    expect(t.splitDepth).toBe(1);
    const leg = childrenOf(t, 5)[0]!;
    expect(isSplit(t, leg)).toBe(false);
    const sel = nodeSelection(d, leg);
    expect(sel).toEqual({ kind: 'node', index: leg });
    expect(selectionIds(d, sel)).toEqual([]);
    const seg = selectionSegments(d, sel)!;
    // 다리 상자(위 면 없음) 모서리 12개, 작은 모형이라 원점 없음
    expect(seg.positions.length).toBe(12 * 6);
    expect(seg.origin).toBeUndefined();
    const box = nodeBox(t, scene, leg)!;
    expect(box.max[2] - box.min[2]).toBeCloseTo(430 / 25.4, 3);
    expect(box.max[0] - box.min[0]).toBeCloseTo(40 / 25.4, 3);
    // 3D에서 다리를 누르면(가장 안쪽) 그 다리
    const owner = t.itemOwner;
    const m = scene.meshes.findIndex((_, i) => owner[i] === 5);
    let found = -2;
    for (let tri = 0; tri < scene.meshes[m]!.indices!.length / 3; tri++) {
      const n = deepestNodeAt(t, scene, scene.meshes[m]!.id, tri);
      if (n === leg) {
        found = tri;
        break;
      }
    }
    expect(found).toBeGreaterThanOrEqual(0);
    expect(selectionForPick(d, pickAt(scene, m, found), true)).toEqual({ kind: 'node', index: leg });
    // 보이지 않는 항목은 빼고 모은다
    expect(selectionSegments(d, sel, () => false)).toBeNull();
  });

  it('나무 꼴이 맞지 않으면 받지 않는다', () => {
    const s = skpToScene(sampleSkpBytes(), { outline: true });
    expect(readTree({ ...s, meta: { ...s.meta, tree: { count: 3, parent: [1, 2, 3] } } })).toBeNull();
    expect(readTree({ ...s, meta: { ...s.meta, tree: undefined } })).toBeNull();
    expect(readTree({ ...s, meshes: s.meshes.slice(1) })).toBeNull();
  });
});

describe('그림 주소', () => {
  it('꾸러미 그림 → 주소 묶음, 재질 폴더·컴포넌트 이름으로 찾기', () => {
    let k = 0;
    const made: string[] = [];
    const imgs = docImages(readSkpImages(sampleSkpBytes()), (b, mime) => {
      const u = `blob:${mime}:${b.length}:${k++}`;
      made.push(u);
      return u;
    })!;
    expect(imgs.urls).toEqual(made);
    expect(imgs.model?.url).toMatch(/^blob:image\/png/);
    expect([...imgs.materials.keys()].sort()).toEqual(['기와', '마루', '잔디']);
    expect(imgs.scenes.map((x) => x.name)).toEqual(['앞마당', '식탁']);
    const d = { images: imgs };
    expect(componentImage(d, '의자')).toBe(imgs.components.get('의자'));
    expect(componentImage(d, '없음')).toBeNull();
    const row = { name: '잔디', folder: '잔디', color: [0, 0, 0, 1] as [number, number, number, number], textured: true, texture: null, faces: 1, meshIds: [] };
    expect(materialImage(d, row)).toBe(imgs.materials.get('잔디')!.url);
    expect(materialImage(d, { ...row, folder: null })).toBeNull();
    expect(docImages(undefined, () => 'x')).toBeNull();
    // 못 쓰는 글자를 _로 바꾼 이름으로도 찾는다(확인하지 못한 규칙 — 같은 이름이 먼저)
    expect(fileSafeName('Chair <1>*')).toBe('Chair _1__');
    const d2 = { images: { ...imgs, components: new Map([['Chair _1_', 'u']]) } };
    expect(componentImage(d2, 'Chair <1>')).toBe('u');
  });

  it('문서를 만들 때 주소 만들기를 넘기면 그림을 붙인다', () => {
    const bytes = sampleSkpBytes();
    const d = createDoc('예제', 1, { scene: skpToScene(bytes, { outline: true }), ms: 1, images: readSkpImages(bytes) }, { makeUrl: () => 'blob:x' });
    expect(d.images?.components.size).toBe(3);
    expect(d.materials.find((m) => m.name === '잔디')!.folder).toBe('잔디');
    expect(materialImage(d, d.materials.find((m) => m.name === '잔디')!)).toBe('blob:x');
    expect(createDoc('예제', 1, { scene: skpToScene(bytes), ms: 1 }).images).toBeNull();
  });
});

describe('큰 좌표(묶음 원점)', () => {
  it('멀리 놓인 모형의 깊은 노드 강조 선분·범위는 원점을 더해 세계 좌표로 맞는다', () => {
    // 예제 모형 전체를 그룹으로 감싸 x 2,000 km(mm 단위 2e9)… 대신 인치 그대로 1e6 인치 옮긴다
    const model = readModelDat(sampleModelDat());
    const shift = 1e6;
    model.root.instances = model.root.instances.map((inst) => {
      const m = Float64Array.from(inst.matrix);
      m[12] = m[12]! + shift;
      return { ...inst, matrix: m };
    });
    const parts = buildSceneParts(model, new Map(), 1, { outline: true, maxSplitItems: 1 });
    const scene: Scene3d = { name: 'x', units: 'inch', meshes: parts.meshes, lines: parts.lines, meta: { tree: parts.tree, outline: parts.outline } };
    expect(parts.meshes.some((m) => m.origin)).toBe(true);
    const d = createDoc('x', 1, { scene, ms: 1 });
    const leg = childrenOf(d.tree!, 5)[0]!;
    const seg = selectionSegments(d, nodeSelection(d, leg))!;
    expect(seg.origin![0]).toBeGreaterThan(shift - 1000);
    // 상대 좌표는 작다(떨림 없음)
    expect(Math.max(...Array.from(seg.positions, Math.abs))).toBeLessThan(1000);
    const box = nodeBox(d.tree!, scene, leg)!;
    expect(box.min[0]).toBeGreaterThan(shift - 1000);
    expect(box.max[2] - box.min[2]).toBeCloseTo(430 / 25.4, 3);
  });
});

/** 그물 안 구간으로 깊은 노드를 숨기고 강조하는 예제(윗단계만 나눔) */
function mergedDoc() {
  const parts = buildSceneParts(readModelDat(sampleModelDat()), new Map(), 1, { outline: true, maxSplitItems: 1 });
  const scene: Scene3d = { name: 'x', units: 'inch', meshes: parts.meshes, lines: parts.lines, meta: { tree: parts.tree, outline: parts.outline } };
  return createDoc('x', 1, { scene, ms: 1 });
}

describe('그물 안 구간(나누지 않은 깊은 노드)', () => {
  it('구간 더하기·합치기·빼기', () => {
    const l: { start: number; count: number }[] = [];
    addRange(l, 0, 3);
    addRange(l, 3, 2);
    addRange(l, 10, 1);
    expect(l).toEqual([
      { start: 0, count: 5 },
      { start: 10, count: 1 },
    ]);
    addRange(l, 4, 0);
    expect(normalizeRanges([{ start: 8, count: 4 }, { start: 0, count: 2 }, { start: 1, count: 3 }, { start: 5, count: 0 }])).toEqual([
      { start: 0, count: 4 },
      { start: 8, count: 4 },
    ]);
    expect(subtractRanges([{ start: 0, count: 10 }], [{ start: 2, count: 3 }, { start: 8, count: 5 }])).toEqual([
      { start: 0, count: 2 },
      { start: 5, count: 3 },
    ]);
    expect(subtractRanges([{ start: 0, count: 4 }, { start: 6, count: 2 }], [{ start: 0, count: 10 }])).toEqual([]);
    expect(subtractRanges([{ start: 3, count: 2 }], undefined)).toEqual([{ start: 3, count: 2 }]);
  });

  it('노드 구간: 의자 다리 하나 = 그물 삼각형 10 + 모서리 선분 12, 다리 넷을 합치면 항목마다 한 목록', () => {
    const d = mergedDoc();
    const t = d.tree!;
    const legs = childrenOf(t, 5);
    const r = nodeRanges(t, d.scene, legs[0]!);
    let tris = 0;
    let segs = 0;
    for (const [it, list] of r) for (const x of list) (it < t.meshCount ? (tris += x.count) : (segs += x.count));
    expect(tris).toBe(10);
    expect(segs).toBe(12);
    const all = mergeNodeRanges(t, d.scene, legs);
    for (const list of all.values()) for (let i = 1; i < list.length; i++) expect(list[i]!.start).toBeGreaterThan(list[i - 1]!.start + list[i - 1]!.count);
    let total = 0;
    for (const [it, list] of all) if (it < t.meshCount) for (const x of list) total += x.count;
    expect(total).toBe(40);
  });

  it('숨김: 깊은 노드도 숨길 수 있고, 여러 노드는 항목마다 합치며, 조상이 숨으면 건너뛴다', () => {
    const d = mergedDoc();
    const t = d.tree!;
    const legs = childrenOf(t, 5);
    expect(isSplit(t, legs[0]!)).toBe(false);
    expect(canHideNode(d, legs[0]!)).toBe(true);
    d.hiddenNodes.add(legs[0]!);
    d.hiddenNodes.add(legs[1]!);
    const h = hiddenNodeRanges(d);
    const legsOnly = mergeNodeRanges(t, d.scene, [legs[0]!, legs[1]!]);
    expect([...h.keys()].sort()).toEqual([...legsOnly.keys()].sort());
    // 의자 자체(나눈 노드)를 숨기면 그 항목째 숨으므로 다리 구간은 따로 넘기지 않는다
    d.hiddenNodes.add(5);
    expect(hiddenNodeRanges(d).size).toBe(0);
    // 구간을 버린 나무는 깊은 노드를 숨길 수 없다
    expect(canHideNode({ ...d, tree: { ...t, runsDropped: true } }, legs[0]!)).toBe(false);
  });

  it('강조: 면은 그물 구간, 숨긴 구간과 겹치면 강조 선분에서 뺀다', () => {
    const d = mergedDoc();
    const t = d.tree!;
    const leg = childrenOf(t, 5)[0]!;
    const sel = nodeSelection(d, leg);
    const ranges = selectionRanges(d, sel)!;
    expect([...ranges.keys()].every((id) => id.startsWith('skp-mesh'))).toBe(true);
    expect([...ranges.values()].flat().reduce((a, r) => a + r.count, 0)).toBe(10);
    expect(selectionRanges(d, nodeSelection(d, 5))).toBeNull();
    d.hiddenNodes.add(leg);
    expect(selectionSegments(d, sel, undefined, hiddenNodeRanges(d))).toBeNull();
    // 범위도 숨긴 부분을 빼면 비어 맞춰 볼 것이 없다
    expect(nodeBox(t, d.scene, leg, undefined, hiddenNodeRanges(d))).toBeNull();
  });

  it('큰 장면만 나눠 올린다', () => {
    const d = sampleDoc();
    expect(isBigScene(d)).toBe(false);
    const big = new Uint32Array(3 * INCREMENTAL_PRIMS);
    expect(isBigScene({ scene: { ...d.scene, meshes: [{ id: 'a', positions: new Float32Array(9), indices: big, color: [1, 1, 1, 1] }] } })).toBe(true);
    const many = Array.from({ length: 1600 }, (_, i) => ({ id: `l${i}`, positions: new Float32Array(6) }));
    expect(isBigScene({ scene: { ...d.scene, meshes: [], lines: many } })).toBe(true);
  });
});
