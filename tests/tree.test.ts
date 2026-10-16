import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../src/index';
import { readModelDat } from '../src/model';
import { TREE_HIDDEN, TREE_MORE, buildSceneParts, type SkpExtraItems, type SkpOutlineEntry, type SkpTree } from '../src/scene';
import { edge, entities, face, instance, materialXml, modelDat, skpFile, vertex } from './build';

/** 한 변 s인 정사각형 면(z) 하나와 모서리 넷. 번호는 base부터 */
function square(base: number, s: number, z = 0, o: { faceFlags?: number; edgeFlags?: number[] } = {}) {
  const v = (i: number): number => base + i;
  const ef = o.edgeFlags ?? [];
  return {
    vertices: [vertex(v(0), 0, 0, z), vertex(v(1), s, 0, z), vertex(v(2), s, s, z), vertex(v(3), 0, s, z)],
    edges: [0, 1, 2, 3].map((i) => edge(v(4 + i), v(i), v((i + 1) % 4), ef[i] !== undefined ? { flags: ef[i]! } : {})),
    faces: [
      face(
        v(8),
        [0, 0, 1, -z],
        [
          [
            [v(4), false],
            [v(5), false],
            [v(6), false],
            [v(7), false],
          ],
        ],
        o.faceFlags !== undefined ? { flags: o.faceFlags } : {},
      ),
    ],
  };
}

const at = (x: number, y = 0, z = 0): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z, 1];

/**
 * 모형: 바로 놓인 정사각형(z -5) + 그룹 G(정의 위판: 자기 판 + 안쪽 그룹 mid) + 컴포넌트 C(정의 중판) + 숨긴 컴포넌트 H(잎판).
 * 중판 = 자기 판(10) + 잎판 컴포넌트 L1·L2(z 5). 잎판 = 1×1 판.
 */
function nestedModel(): Uint8Array {
  const leaf = entities(70, square(700, 1));
  const mid = entities(60, {
    ...square(600, 10),
    components: [instance(610, 70, at(2, 0, 5), { name: 'L1' }), instance(611, 70, at(5, 0, 5), { name: 'L2' })],
  });
  const top = entities(50, { ...square(500, 10), groups: [instance(510, 60, at(0, 20), { name: 'mid' })] });
  const root = entities(undefined, {
    ...square(100, 1, -5),
    groups: [instance(200, 50, at(0), { name: 'G', layer: 2 })],
    components: [instance(201, 60, at(100), { name: 'C' }), instance(202, 70, at(300), { name: 'H', flags: 7 })],
  });
  return modelDat({
    materials: [[1, '빨강']],
    layers: [
      [1, 'Layer0'],
      [2, 'Walls'],
    ],
    definitions: [
      { name: '잎판', entities: leaf },
      { name: '중판', entities: mid },
      { name: '그룹#1', entities: top },
    ],
    root,
  });
}

const MATS: [string, string][] = [['빨강', materialXml('빨강', [255, 0, 0])]];

/** 구간 r의 끝(같은 항목의 다음 구간 시작, 없으면 항목 끝) */
function runEnds(t: SkpTree, s: Scene3d): Uint32Array {
  const ends = new Uint32Array(t.runItem.length);
  const last = new Map<number, number>();
  const total = (item: number): number =>
    item < s.meshes.length ? s.meshes[item]!.indices!.length / 3 : s.lines[item - s.meshes.length]!.positions.length / 6;
  for (let r = 0; r < t.runItem.length; r++) {
    const it = t.runItem[r]!;
    const prev = last.get(it);
    if (prev !== undefined) ends[prev] = t.runStart[r]!;
    last.set(it, r);
  }
  for (const [it, r] of last) ends[r] = total(it);
  return ends;
}

/** 노드(-1 = 모형)가 직접 낸 그물 삼각형 정점의 범위 */
function ownBox(t: SkpTree, s: Scene3d, node: number): { min: number[]; max: number[] } {
  const ends = runEnds(t, s);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let r = 0; r < t.runItem.length; r++) {
    if (t.runNode[r] !== node || t.runItem[r]! >= s.meshes.length) continue;
    const m = s.meshes[t.runItem[r]!]!;
    for (let tri = t.runStart[r]!; tri < ends[r]!; tri++)
      for (let k = 0; k < 3; k++) {
        const v = m.indices![3 * tri + k]!;
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a]!, m.positions[3 * v + a]!);
          max[a] = Math.max(max[a]!, m.positions[3 * v + a]!);
        }
      }
  }
  return { min, max };
}

describe('여러 단계 나무(meta.tree)', () => {
  it('넓이 우선 노드·부모·단계·이름·안쪽 면 수', () => {
    const s = skpToScene(skpFile(nestedModel(), { materials: MATS }), { outline: true });
    const t = s.meta!.tree as SkpTree;
    expect(t.count).toBe(7);
    expect(t.rootCount).toBe(2);
    expect([...t.parent]).toEqual([-1, -1, 0, 1, 1, 2, 2]);
    expect([...t.depth]).toEqual([1, 1, 2, 2, 2, 3, 3]);
    expect(t.names).toEqual(['G', 'C', 'mid', 'L1', 'L2', 'L1', 'L2']);
    expect([...t.kind]).toEqual([0, 1, 0, 1, 1, 1, 1]);
    expect([...t.definition].map((i) => t.definitionNames[i])).toEqual(['그룹#1', '중판', '중판', '잎판', '잎판', '잎판', '잎판']);
    expect([...t.tag].map((i) => t.tagNames[i])).toEqual(['Walls', 'Layer0', 'Layer0', 'Layer0', 'Layer0', 'Layer0', 'Layer0']);
    expect([...t.firstChild]).toEqual([2, 3, 5, -1, -1, -1, -1]);
    expect([...t.childCount]).toEqual([1, 2, 2, 0, 0, 0, 0]);
    expect([...t.faces]).toEqual([4, 3, 3, 1, 1, 1, 1]);
    expect([...t.edges]).toEqual([16, 12, 12, 4, 4, 4, 4]);
    expect(t.listedDepth).toBe(3);
    expect(t.unlisted).toBe(false);
    expect([...t.flags].every((f) => f === 0)).toBe(true);
  });

  it('작은 모형은 모든 단계를 나누고, 노드 항목 범위는 안쪽을 품는다', () => {
    const s = skpToScene(skpFile(nestedModel(), { materials: MATS }), { outline: true });
    const t = s.meta!.tree as SkpTree;
    expect(t.splitDepth).toBe(3);
    for (let i = 0; i < t.count; i++) {
      expect(t.meshFirst[i]).toBeGreaterThanOrEqual(0);
      expect(t.meshEnd[i]! - t.meshFirst[i]!).toBeGreaterThan(0);
      const p = t.parent[i]!;
      if (p >= 0) {
        expect(t.meshFirst[i]).toBeGreaterThanOrEqual(t.meshFirst[p]!);
        expect(t.meshEnd[i]).toBeLessThanOrEqual(t.meshEnd[p]!);
        expect(t.lineFirst[i]).toBeGreaterThanOrEqual(t.lineFirst[p]!);
        expect(t.lineEnd[i]).toBeLessThanOrEqual(t.lineEnd[p]!);
      }
    }
    // 항목 주인: 그 항목을 따로 가진 노드(안쪽의 가장 깊은 나눈 노드)
    expect(t.itemOwner.length).toBe(s.meshes.length + s.lines.length);
    for (let i = 0; i < t.count; i++)
      for (let m = t.meshFirst[i]!; m < t.meshEnd[i]!; m++) {
        let o = t.itemOwner[m]!;
        while (o >= 0 && o !== i) o = t.parent[o]!;
        expect(o).toBe(i);
      }
    // outline(윗단계)은 예전처럼: 바로 놓인 형상 + G + C, 항목은 안쪽까지 모두
    const outline = s.meta!.outline as SkpOutlineEntry[];
    expect(outline.map((o) => [o.kind, o.name, o.node ?? null, o.faces])).toEqual([
      ['loose', '모형에 바로 놓인 형상', null, 1],
      ['group', 'G', 0, 4],
      ['component', 'C', 1, 3],
    ]);
    const all = outline.flatMap((o) => o.ids);
    expect(new Set(all).size).toBe(s.meshes.length + s.lines.length);
  });

  it('구간으로 삼각형마다 가장 안쪽 노드를 찾는다', () => {
    const s = skpToScene(skpFile(nestedModel(), { materials: MATS }), { outline: true });
    const t = s.meta!.tree as SkpTree;
    expect(t.runsDropped).toBe(false);
    const box = (n: number): string => {
      const b = ownBox(t, s, n);
      return [...b.min, ...b.max].map((x) => Math.round(x)).join(',');
    };
    expect(box(-1)).toBe('0,0,-5,1,1,-5');
    expect(box(0)).toBe('0,0,0,10,10,0'); // G 자기 판
    expect(box(2)).toBe('0,20,0,10,30,0'); // G 안 mid
    expect(box(5)).toBe('2,20,5,3,21,5'); // mid 안 L1
    expect(box(6)).toBe('5,20,5,6,21,5');
    expect(box(1)).toBe('100,0,0,110,10,0'); // C
    expect(box(3)).toBe('102,0,5,103,1,5');
    expect(box(4)).toBe('105,0,5,106,1,5');
    // 노드 구간 범위 [runFirst, runEnd)는 안쪽 노드의 구간을 모두 품는다
    for (let r = 0; r < t.runNode.length; r++) {
      let n = t.runNode[r]!;
      while (n >= 0) {
        expect(r).toBeGreaterThanOrEqual(t.runFirst[n]!);
        expect(r).toBeLessThan(t.runEnd[n]!);
        n = t.parent[n]!;
      }
    }
  });

  it('항목 한도가 작으면 윗단계만 나누고, 깊은 노드는 구간으로만 찾는다', () => {
    const model = readModelDat(nestedModel());
    const parts = buildSceneParts(model, new Map(), 1, { outline: true, maxSplitItems: 1 });
    const t = parts.tree!;
    expect(t.splitDepth).toBe(1);
    expect(t.meshFirst[0]).toBeGreaterThanOrEqual(0);
    expect(t.meshFirst[2]).toBe(-1);
    expect(t.meshFirst[5]).toBe(-1);
    const s: Scene3d = { name: 'x', units: 'inch', meshes: parts.meshes, lines: parts.lines };
    expect(ownBox(t, s, 5).min.map(Math.round)).toEqual([2, 20, 5]);
    // 나누지 않은 기본 호출보다 그물이 많고(윗단계 셋), 단계를 모두 나눈 것보다 적다
    const flat = buildSceneParts(model, new Map()).meshes.length;
    const full = buildSceneParts(model, new Map(), 1, { outline: true }).meshes.length;
    expect(parts.meshes.length).toBeGreaterThan(flat);
    expect(parts.meshes.length).toBeLessThan(full);
  });

  it('노드 한도를 넘으면 단계 단위로 자르고, 깊은 배치는 목록에 든 조상에 붙인다', () => {
    const model = readModelDat(nestedModel());
    const parts = buildSceneParts(model, new Map(), 1, { outline: true, maxTreeNodes: 4 });
    const t = parts.tree!;
    expect(t.count).toBe(2);
    expect(t.listedDepth).toBe(1);
    expect(t.unlisted).toBe(true);
    expect([...t.flags]).toEqual([TREE_MORE, TREE_MORE]);
    expect([...t.faces]).toEqual([4, 3]);
    expect([...new Set(t.runNode)].sort()).toEqual([-1, 0, 1]);
  });

  it('윗단계가 한도보다 많으면 나누지 않아도 나무와 구간은 남는다', () => {
    const model = readModelDat(nestedModel());
    const parts = buildSceneParts(model, new Map(), 1, { outline: true, maxOutline: 1 });
    expect(parts.outlineSkipped).toBe(2);
    expect(parts.outline).toBeUndefined();
    const t = parts.tree!;
    expect(t.splitDepth).toBe(0);
    expect([...t.meshFirst].every((v) => v === -1)).toBe(true);
    expect(parts.meshes.length).toBe(buildSceneParts(model, new Map()).meshes.length);
    const s: Scene3d = { name: 'x', units: 'inch', meshes: parts.meshes, lines: parts.lines };
    expect(ownBox(t, s, 4).min.map(Math.round)).toEqual([105, 0, 5]);
  });

  it('구간이 한도를 넘으면 버리고 경고한다', () => {
    const parts = buildSceneParts(readModelDat(nestedModel()), new Map(), 1, { outline: true, maxTreeRuns: 3 });
    expect(parts.tree!.runsDropped).toBe(true);
    expect(parts.tree!.runItem.length).toBe(0);
    expect(parts.warnings.some((w) => w.includes('3D에서 눌러 고를 수 없습니다'))).toBe(true);
  });

  it('기본 호출에는 나무·extras가 없다', () => {
    const s = skpToScene(skpFile(nestedModel(), { materials: MATS }));
    expect(s.meta!.tree).toBeUndefined();
    expect(s.meta!.extraItems).toBeUndefined();
    // 숨긴 H(x 300)는 그리지 않는다
    expect(s.bounds!.max[0]).toBeCloseTo(110);
  });
});

/** 부드러운·숨긴 모서리와 숨긴 면이 있는 모형 */
function extrasModel(): Uint8Array {
  const a = square(100, 10, 0, { edgeFlags: [6, 0x1e, 0x07, 6] });
  const b = square(200, 4, 3, { faceFlags: 0x07 });
  const root = entities(undefined, {
    vertices: [...a.vertices, ...b.vertices],
    edges: [...a.edges, ...b.edges],
    faces: [...a.faces, ...b.faces],
    components: [instance(300, 70, at(50), { name: 'H', flags: 7 })],
  });
  return modelDat({ definitions: [{ name: '잎판', entities: entities(70, square(700, 1)) }], root });
}

describe('부드러운·숨긴 형상(extras)', () => {
  it('따로 묶어 내고 meta.extraItems에 id를 적는다(범위·통계에는 넣지 않는다)', () => {
    const plain = skpToScene(skpFile(extrasModel()));
    const s = skpToScene(skpFile(extrasModel()), { extras: true, outline: true });
    const ex = s.meta!.extraItems as SkpExtraItems;
    expect(ex.softSegments).toBe(1);
    // 숨긴 모서리: 판 a의 1개 + 숨긴 면 b는 면만 숨김(모서리 4개는 보통) + 숨긴 인스턴스 H의 모서리 4개
    expect(ex.hiddenSegments).toBe(1 + 4);
    // 숨긴 면: b 1개 + H 1개
    expect(ex.hiddenFaces).toBe(2);
    const soft = s.lines.filter((l) => ex.soft.includes(l.id));
    expect(soft.length).toBe(1);
    const hiddenLines = s.lines.filter((l) => ex.hidden.includes(l.id));
    expect(hiddenLines.every((l) => l.dashed)).toBe(true);
    const hiddenMeshes = s.meshes.filter((m) => ex.hidden.includes(m.id));
    expect(hiddenMeshes.length).toBeGreaterThan(0);
    expect(hiddenMeshes.every((m) => m.color[3] < 0.5)).toBe(true);
    // 보통 형상·범위·태그 통계는 extras가 없을 때와 같다
    const normal = (sc: Scene3d, skip: Set<string>) => sc.meshes.filter((m) => !skip.has(m.id)).map((m) => m.positions.length);
    expect(normal(s, new Set(ex.hidden))).toEqual(normal(plain, new Set()));
    expect(s.bounds).toEqual(plain.bounds);
    expect(s.meta!.tagStats).toEqual(plain.meta!.tagStats);
    expect(s.meta!.segments).toBe(plain.meta!.segments);
    // 숨긴 인스턴스는 나무에 숨김 표시로 들어가고, outline(윗단계 목록)에는 넣지 않는다
    const t = s.meta!.tree as SkpTree;
    expect(t.count).toBe(1);
    expect(t.flags[0]! & TREE_HIDDEN).toBeTruthy();
    expect((s.meta!.outline as SkpOutlineEntry[]).map((o) => o.kind)).toEqual(['loose']);
  });
});

describe('큰 좌표 묶음 원점', () => {
  const far = (x: number): Uint8Array => {
    const root = entities(undefined, { ...square(100, 1, -5), groups: [instance(200, 50, at(x), { name: 'G' })] });
    return modelDat({ definitions: [{ name: '그룹#1', entities: entities(50, square(500, 10)) }], root, lengthUnit: 2 });
  };

  it('100 m보다 먼 묶음은 origin을 두고 positions를 그만큼 뺀다(세계 = origin + position)', () => {
    const x = 1e6 / 25.4; // 1,000 m
    const s = skpToScene(skpFile(far(x)));
    expect(s.units).toBe('mm');
    const withOrigin = s.meshes.filter((m) => m.origin);
    expect(withOrigin.length).toBe(1);
    const m = withOrigin[0]!;
    expect(m.origin![0]).toBe(1e6);
    const xs = Array.from(m.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(254, 4);
    expect(s.lines.some((l) => l.origin?.[0] === 1e6)).toBe(true);
    // 범위는 세계 좌표
    expect(s.bounds!.max[0]).toBeCloseTo(1e6 + 254, 3);
    // 가까운 바로 놓인 판은 원점 없이 예전 그대로
    expect(s.meshes.filter((mm) => !mm.origin).length).toBe(1);
  });

  it('가까운 모형은 원점 없이 예전과 같고, 기준을 무한으로 두면 끈다', () => {
    const near = skpToScene(skpFile(far(100)));
    expect(near.meshes.every((m) => !m.origin) && near.lines.every((l) => !l.origin)).toBe(true);
    const model = readModelDat(far(1e6));
    const off = buildSceneParts(model, new Map(), 25.4, { originThreshold: Infinity });
    expect(off.meshes.every((m) => !m.origin)).toBe(true);
  });
});
