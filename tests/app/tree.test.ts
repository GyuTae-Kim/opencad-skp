import { describe, expect, it } from 'vitest';
import type { Pick3d, Scene3d } from 'opencad-viewer3d';
import {
  componentImage,
  createDoc,
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
import { childrenOf, deepestNodeAt, isSplit, levelNode, nodeBox, nodeName, nodePath, readTree, treeDefinitionCounts } from '../../src/app/tree';
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
    const row = { name: '잔디', folder: '잔디', color: [0, 0, 0, 1] as [number, number, number, number], textured: true, faces: 1, meshIds: [] };
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
