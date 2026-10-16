import { describe, expect, it } from 'vitest';
import { skpToScene } from '../src/index';
import { readModelDat } from '../src/model';
import { buildSceneParts, type SkpOutlineEntry, type SkpTagStat } from '../src/scene';
import { IDENTITY13, edge, entities, face, instance, materialXml, modelDat, skpFile, vertex } from './build';

/** 한 변 10인 정사각형 면(z = 0) 하나와 모서리 넷 */
function square(defId: number | undefined, base: number, o: { material?: number; layer?: number } = {}): Uint8Array {
  const v = (i: number): number => base + i;
  return entities(defId, {
    vertices: [vertex(v(0), 0, 0, 0), vertex(v(1), 10, 0, 0), vertex(v(2), 10, 10, 0), vertex(v(3), 0, 10, 0)],
    edges: [edge(v(4), v(0), v(1)), edge(v(5), v(1), v(2)), edge(v(6), v(2), v(3)), edge(v(7), v(3), v(0))],
    faces: [
      face(
        v(8),
        [0, 0, 1, 0],
        [
          [
            [v(4), false],
            [v(5), false],
            [v(6), false],
            [v(7), false],
          ],
        ],
        o,
      ),
    ],
  });
}

const at = (x: number): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, 0, 0, 1];

/** 모형: 바로 놓인 면 1 + 그룹 1(태그 Walls) + 컴포넌트 2(같은 정의, 재질 다름) + 숨긴 컴포넌트 1 + 정의 없는 인스턴스 1 */
function outlineModel(): Uint8Array {
  const root = entities(undefined, {
    vertices: [vertex(1, 0, 0, -5), vertex(2, 1, 0, -5), vertex(3, 0, 1, -5)],
    edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
    faces: [
      face(
        7,
        [0, 0, 1, 5],
        [
          [
            [4, false],
            [5, false],
            [6, false],
          ],
        ],
        { material: 2 },
      ),
    ],
    groups: [instance(20, 60, at(0), { layer: 2 })],
    components: [
      instance(21, 50, at(100), { material: 1, name: '왼쪽' }),
      instance(22, 50, at(200), { material: 2 }),
      instance(23, 50, at(300), { flags: 7 }),
      instance(24, 99, IDENTITY13),
    ],
  });
  return modelDat({
    materials: [
      [1, '빨강'],
      [2, '초록'],
    ],
    layers: [
      [1, 'Layer0'],
      [2, 'Walls'],
      [3, '빈 태그'],
    ],
    defaultLayer: 1,
    definitions: [
      { name: '판', entities: square(50, 500) },
      { name: '그룹#1', entities: square(60, 600) },
    ],
    root,
  });
}

const MATS: [string, string][] = [
  ['빨강', materialXml('빨강', [255, 0, 0])],
  ['초록', materialXml('초록', [0, 255, 0])],
];

describe('outline(윗단계 그룹·컴포넌트 나누기)', () => {
  it('켜면 윗단계 항목마다 그물·모서리를 나누고 meta.outline에 적는다', () => {
    const s = skpToScene(skpFile(outlineModel(), { materials: MATS }), { outline: true });
    const outline = s.meta!.outline as SkpOutlineEntry[];
    expect(outline.map((o) => [o.kind, o.name, o.definition ?? null, o.tag])).toEqual([
      ['loose', '모형에 바로 놓인 형상', null, 'Layer0'],
      ['group', '그룹#1', '그룹#1', 'Walls'],
      ['component', '왼쪽', '판', 'Layer0'],
      ['component', '판', '판', 'Layer0'],
    ]);
    expect(outline.map((o) => o.faces)).toEqual([1, 1, 1, 1]);
    expect(outline.map((o) => o.edges)).toEqual([3, 4, 4, 4]);
    // 항목의 id는 겹치지 않고, 모두 장면에 있다
    const all = outline.flatMap((o) => o.ids);
    expect(new Set(all).size).toBe(all.length);
    const ids = new Set([...s.meshes.map((m) => m.id), ...s.lines.map((l) => l.id)]);
    expect(all.every((id) => ids.has(id))).toBe(true);
    expect(all.length).toBe(ids.size);
    // 같은 정의라도 놓인 자리마다 따로 — 왼쪽(빨강)은 x 100~110
    const left = s.meshes.find((m) => m.id === outline[2]!.ids.find((id) => id.startsWith('skp-mesh')))!;
    expect(left.name).toBe('빨강 · Layer0');
    expect(Math.min(...Array.from(left.positions).filter((_, i) => i % 3 === 0))).toBeCloseTo(100);
    expect(s.meta!.outlineSkipped).toBeUndefined();
  });

  it('끄면(기본) 예전처럼 (태그, 재질)마다 하나로 모은다', () => {
    const s = skpToScene(skpFile(outlineModel(), { materials: MATS }));
    expect(s.meta!.outline).toBeUndefined();
    // 바로 놓인 면(초록) + 컴포넌트(초록)는 한 그물, 빨강 하나, 그룹(Walls, 기본색) 하나
    expect(s.meshes.map((m) => m.name).sort()).toEqual(['기본 재질 · Walls', '빨강 · Layer0', '초록 · Layer0']);
    expect(s.lines.map((l) => l.group)).toEqual(['Layer0', 'Walls']);
  });

  it('태그·재질 통계(펼친 뒤 면·모서리 수)', () => {
    const s = skpToScene(skpFile(outlineModel(), { materials: MATS }));
    const tags = s.meta!.tagStats as SkpTagStat[];
    expect(tags).toEqual([
      { name: 'Layer0', default: true, faces: 3, edges: 11 },
      { name: 'Walls', default: false, faces: 1, edges: 4 },
      { name: '빈 태그', default: false, faces: 0, edges: 0 },
    ]);
    const mats = s.meta!.materialStats as { name: string; faces: number; meshIds: string[]; color: number[]; textured: boolean }[];
    const byName = new Map(mats.map((m) => [m.name, m]));
    expect(byName.get('초록')!.faces).toBe(2);
    expect(byName.get('빨강')!.faces).toBe(1);
    expect(byName.get('빨강')!.color).toEqual([1, 0, 0, 1]);
    expect(byName.get('기본 재질')!.faces).toBe(1);
    for (const m of mats) for (const id of m.meshIds) expect(s.meshes.some((x) => x.id === id && x.name!.startsWith(m.name))).toBe(true);
  });

  it('윗단계 인스턴스가 한도보다 많으면 나누지 않고 수만 적는다', () => {
    const model = readModelDat(outlineModel());
    const parts = buildSceneParts(model, new Map(), 1, { outline: true, maxOutline: 2 });
    expect(parts.outline).toBeUndefined();
    expect(parts.outlineSkipped).toBe(3);
    expect(parts.meshes.length).toBe(buildSceneParts(model, new Map()).meshes.length);
  });

  it('인스턴스 종류(그룹 138c · 컴포넌트 138d)를 읽는다', () => {
    const model = readModelDat(outlineModel());
    expect(model.root.instances.map((i) => i.kind)).toEqual(['group', 'component', 'component', 'component', 'component']);
  });

  it('진행 알림을 단계마다 부르고, 알림 쪽 오류는 해석을 멈추지 않는다', () => {
    const seen: [number, string][] = [];
    const s = skpToScene(skpFile(outlineModel(), { materials: MATS }), {
      onProgress: (f, stage) => {
        seen.push([f, stage]);
        if (seen.length === 2) throw new Error('무시돼야 함');
      },
    });
    expect(s.meshes.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < seen.length; i++) expect(seen[i]![0]).toBeGreaterThan(seen[i - 1]![0]);
    expect(seen.every(([f]) => f > 0 && f < 1)).toBe(true);
  });
});
