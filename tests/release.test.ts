/**
 * 장면을 만들며 다 놓은 정의를 놓기(buildSceneParts releaseModel): 마지막 배치를 놓은 정의의 삼각화 배열과 중간 모형 표를
 * 놓아도 장면은 같아야 하고, 아직 놓을 배치가 남은 정의·장면이 다시 그리는 숨김 인스턴스 안쪽·자기를 품는 정의는 놓지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { readModelDat, type SkpModel } from '../src/model';
import { buildSceneParts } from '../src/scene';
import { IDENTITY13, edge, entities, face, instance, modelDat, sectionPlanes, vertex } from './build';

/** 한 변 10인 정사각형 면 하나(정점 base..base+3, 모서리 base+4.., 면 base+8) */
function square(base: number, extra: Uint8Array[] = []): { vertices: Uint8Array[]; edges: Uint8Array[]; faces: Uint8Array[]; extra: Uint8Array[] } {
  const v = (i: number): number => base + i;
  return {
    vertices: [vertex(v(0), 0, 0, 0), vertex(v(1), 10, 0, 0), vertex(v(2), 10, 10, 0), vertex(v(3), 0, 10, 0)],
    edges: [edge(v(4), v(0), v(1)), edge(v(5), v(1), v(2)), edge(v(6), v(2), v(3)), edge(v(7), v(3), v(0))],
    faces: [face(v(8), [0, 0, 1, 0], [[v(4), v(5), v(6), v(7)].map((x) => [x, false] as [number, boolean])])],
    extra,
  };
}
const at = (x: number, y = 0): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, 0, 1];

/**
 * 정의 50(판)을 모형에 셋, 정의 60(판 50 둘 + 단면 평면)을 모형에 둘 → 50은 일곱 번 놓인다. 정의 70은 숨긴 인스턴스(15)로만.
 * reveal: 숨긴 개체를 기억하며 아무것도 숨기지 않는 장면(숨긴 인스턴스를 보통 색으로 한 번 더 그린다)
 */
function shared(o: { reveal?: boolean } = {}): Uint8Array {
  const mid = entities(60, {
    components: [instance(61, 50, at(0, 20)), instance(62, 50, at(20, 20))],
    extra: [sectionPlanes([{ id: 63, plane: [1, 0, 0, -5], name: '자르기', symbol: 'A' }])],
  });
  const root = entities(undefined, {
    ...square(1),
    components: [instance(10, 50, at(0)), instance(11, 50, at(20)), instance(12, 50, at(40)), instance(13, 60, at(0, 50)), instance(14, 60, at(50, 50)), instance(15, 70, at(-50), { flags: 0x01 })],
  });
  return modelDat({
    definitions: [
      { name: '판', entities: entities(50, square(100)) },
      { name: '두 판', entities: mid },
      { name: '숨긴 판', entities: entities(70, square(200)) },
    ],
    root,
    ...(o.reveal ? { pages: { list: [{ id: 300, name: 'A', flags: 0x100, hidden: [] }] } } : {}),
  });
}

const build = (m: SkpModel, releaseModel: boolean) => buildSceneParts(m, new Map(), 1, { outline: true, extras: true, smooth: true, releaseModel });

/** 장면 조각 비교용(형식 배열은 수 목록으로) */
const plain = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));

describe('장면을 만들며 다 놓은 정의를 놓기', () => {
  it('여러 번 놓인 정의도 마지막 배치 뒤에 놓고, 장면은 놓지 않을 때와 같다', () => {
    const keep = readModelDat(shared());
    const freed = readModelDat(shared());
    const a = build(keep, false);
    const b = build(freed, true);
    expect(plain(b)).toBe(plain(a));
    // 단면 평면이 든 정의의 나무 정보(크기)도 같다 — 표를 비우기 전에 범위를 구했다
    expect(a.treeInfo).toBeTruthy();
    expect(plain(b.treeInfo)).toBe(plain(a.treeInfo));
    // 놓지 않으면 모형은 그대로, 놓으면 펼친 정의와 모형 요소의 표가 비었다
    expect(keep.definitions.get(50)!.entities.faces.length).toBe(1);
    expect(freed.definitions.get(50)!.entities.faces.length).toBe(0);
    expect(freed.definitions.get(60)!.entities.edges.length).toBe(0);
    expect(freed.root.points.length).toBe(0);
    // 인스턴스·주석은 그대로 둔다
    expect(freed.definitions.get(60)!.entities.sections).toHaveLength(1);
    expect(freed.root.instances).toHaveLength(6);
  });

  it('비운 표의 배열 버퍼는 GC를 기다리지 않고 곧바로 놓는다(22차 — transfer(0)로 떼어 길이 0), 놓지 않으면 그대로', () => {
    const tables = (m: SkpModel) => {
      const e = m.definitions.get(50)!.entities;
      return { points: e.points, vertex: e.faces.vertex, normal: e.faces.normal, a: e.edges.a, root: m.root.points };
    };
    const keep = readModelDat(shared());
    const freed = readModelDat(shared());
    const k = tables(keep);
    const f = tables(freed);
    const lengths = (t: ReturnType<typeof tables>) => Object.values(t).map((a) => a.byteLength);
    const before = lengths(f);
    expect(before.every((n) => n > 0)).toBe(true);
    expect(plain(build(freed, true))).toBe(plain(build(keep, false)));
    expect(lengths(k)).toEqual(before);
    // 이 Node(21+)는 ArrayBuffer.prototype.transfer가 있어 놓은 표의 버퍼가 떼어졌다
    expect(lengths(f).every((n) => n === 0)).toBe(true);
    // 장면이 다시 그리는 숨김 인스턴스 안쪽은 놓지 않아 버퍼도 그대로
    const pinned = readModelDat(shared({ reveal: true }));
    const p = pinned.definitions.get(70)!.entities.faces.vertex;
    build(pinned, true);
    expect(p.byteLength).toBeGreaterThan(0);
    expect(pinned.definitions.get(70)!.entities.faces.vertex).toBe(p);
  });

  it('extras를 끄면 숨긴 인스턴스만 가리키는 정의는 펼치지 않아 놓지 않는다', () => {
    const m = readModelDat(shared());
    buildSceneParts(m, new Map(), 1, { releaseModel: true });
    expect(m.definitions.get(70)!.entities.faces.length).toBe(1);
    expect(m.definitions.get(50)!.entities.faces.length).toBe(0);
  });

  it('자기 자신을 품는 정의가 있으면 놓지 않는다', () => {
    const loop = entities(80, { ...square(300), components: [instance(81, 80, at(30))] });
    const dat = modelDat({ definitions: [{ name: '고리', entities: loop }], root: entities(undefined, { components: [instance(82, 80, IDENTITY13)] }) });
    const keep = readModelDat(dat);
    const freed = readModelDat(dat);
    expect(plain(build(freed, true))).toBe(plain(build(keep, false)));
    expect(freed.definitions.get(80)!.entities.faces.length).toBe(1);
  });

  it('나눌 단계를 정하며 삼각화한 정의를 한도 넘게 들지 않고 펼칠 때 다시 삼각화해도(splitPrepBudget) 장면·경고·나무 정보가 같다', () => {
    for (const reveal of [false, true])
      for (const releaseModel of [false, true]) {
        const base = buildSceneParts(readModelDat(shared({ reveal })), new Map(), 1, { outline: true, extras: true, smooth: true, releaseModel });
        // 한도 0: 나눌 단계를 정한 삼각화를 모두 곧바로 놓는다(앞서 준비해 둔 것만 남는다)
        const redo = buildSceneParts(readModelDat(shared({ reveal })), new Map(), 1, { outline: true, extras: true, smooth: true, releaseModel, splitPrepBudget: 0 });
        expect(plain(redo), `${reveal} ${releaseModel}`).toBe(plain(base));
        expect(base.outline?.length, `${reveal} ${releaseModel}`).toBeGreaterThan(0);
      }
  });

  it('장면이 다시 그리는 숨김 인스턴스(영구 번호 15) 안쪽은 놓지 않는다(같은 장면)', () => {
    const keep = readModelDat(shared({ reveal: true }));
    const freed = readModelDat(shared({ reveal: true }));
    const a = build(keep, false);
    const b = build(freed, true);
    expect(a.revealItems).toHaveLength(1);
    expect(plain(b)).toBe(plain(a));
    expect(freed.definitions.get(70)!.entities.faces.length).toBe(1);
    expect(freed.definitions.get(50)!.entities.faces.length).toBe(0);
  });
});
