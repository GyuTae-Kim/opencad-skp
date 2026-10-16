import { describe, expect, it } from 'vitest';
import type { LineSet3d, Mesh3d } from 'opencad-viewer3d/types';
import type { SkpMaterialInfo } from '../src/materials';
import type { SkpDefinition, SkpEdge, SkpEntities, SkpFace, SkpInstance, SkpModel } from '../src/model';
import { DEFAULT_FACE_COLOR, buildSceneParts } from '../src/scene';
import { xfNormal, xfPlane } from '../src/scene-annotations';

// ── 손으로 만드는 중간 모형 ──

const at = (x: number, y = 0, z = 0, sx = 1, sy = 1, sz = 1): Float64Array => Float64Array.from([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]);

function ents(o: Partial<SkpEntities> = {}): SkpEntities {
  return { points: new Float64Array(), faces: [], edges: [], instances: [], ...o };
}

/** 한 변 s인 z=0 정사각형 면 하나와 모서리 넷 */
function square(s = 1, o: { material?: number; layer?: number; edgeLayer?: number } = {}): SkpEntities {
  const face: SkpFace = { loops: [[0, 1, 2, 3]], normal: [0, 0, 1], flags: 0, loopEdges: [[0, 1, 2, 3]] };
  if (o.material !== undefined) face.front = o.material;
  if (o.layer !== undefined) face.layer = o.layer;
  const edges: SkpEdge[] = [0, 1, 2, 3].map((i) => ({ a: i, b: (i + 1) % 4, flags: 0, ...(o.edgeLayer !== undefined ? { layer: o.edgeLayer } : {}) }));
  return ents({ points: Float64Array.from([0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0]), faces: [face], edges });
}

function model(root: SkpEntities, o: Partial<SkpModel> = {}): SkpModel {
  return {
    materials: new Map(),
    layers: new Map([
      [1, 'Layer0'],
      [2, 'Dims'],
    ]),
    defaultLayer: 1,
    definitions: new Map(),
    root,
    counts: { vertices: 0, edges: 0, faces: 1, instances: 0 },
    warnings: [],
    ...o,
  };
}

const def = (id: number, name: string, e: SkpEntities, o: Partial<SkpDefinition> = {}): [number, SkpDefinition] => [id, { id, name, entities: e, ...o }];
const inst = (definition: number, matrix: Float64Array, o: Partial<SkpInstance> = {}): SkpInstance => ({ definition, matrix, flags: 0, ...o });
const NO_MATS = new Map<string, SkpMaterialInfo>();

const segs = (l: LineSet3d): number[][] => {
  const out: number[][] = [];
  const o = l.origin ?? [0, 0, 0];
  for (let i = 0; i < l.positions.length; i += 6)
    out.push([0, 1, 2, 3, 4, 5].map((k) => Math.round((l.positions[i + k]! + o[k % 3]!) * 1e6) / 1e6));
  return out;
};
const close = (a: readonly number[] | undefined, b: readonly number[], d = 9): void => {
  expect(a).toBeDefined();
  expect(a!.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a![i]!).toBeCloseTo(b[i]!, d);
};

describe('주석 펼치기', () => {
  /** 바로 놓인 10×10 판 + 문자·치수·보조선·보조점·단면, 2배로 놓인 컴포넌트 안 치수 하나 */
  function annotated(): SkpModel {
    const root = square(10);
    root.texts = [
      { text: '모서리', flags: 0, point: [1, 1, 0], leaderType: 'pushpin', leader: [2, 2, 3], arrow: 'closed' },
      { text: '화면 글', flags: 0, leaderType: 'none', screen: [0.1, 0.2] },
      { text: '숨긴 글', flags: 1, point: [5, 5, 0], leaderType: 'pushpin', leader: [1, 0, 0] },
    ];
    root.dimensions = [{ kind: 'linear', text: '', flags: 0, layer: 2, start: [0, 0, 0], end: [10, 0, 0], measureAxis: [1, 0, 0], offset: [0, -2, 0], arrow: 'slash' }];
    root.guides = [
      { kind: 'line', flags: 0, point: [0, 5, 0], direction: [1, 0, 0] },
      { kind: 'line', flags: 0, point: [0, 0, 0], direction: [0.894427, 0.447214, 0], start: [0, 0, 0], end: [10, 5, 0] },
      { kind: 'point', flags: 0, point: [3, 4, 5], start: [0, 0, 0] },
    ];
    root.sections = [{ pid: 500, flags: 0, plane: [1, 0, 0, -5], name: 'Cut A', symbol: 'A', active: true }];
    const inner = ents({ dimensions: [{ kind: 'linear', text: '<>', flags: 0, start: [0, 0, 0], end: [1, 0, 0], measureAxis: [1, 0, 0] }] });
    root.instances = [inst(50, at(100, 0, 0, 2, 2, 2), { name: '자', pid: 77 })];
    return model(root, { definitions: new Map([def(50, '자 정의', inner)]), annotationDefaults: { dimColor: [64, 64, 64] } });
  }

  it('글·치수·단면을 세계 좌표 meta로, 선분은 종류·태그마다 묶고 범위에는 넣지 않는다', () => {
    const p = buildSceneParts(annotated(), NO_MATS, 1, { outline: true });
    expect(p.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
    // 문자: 붙는 점·글 자리(점 + 지시선), 화면 글, 숨긴 글(선은 extras일 때만)
    expect(p.texts!.map((t) => [t.text, t.leaderType, t.hidden, t.node])).toEqual([
      ['모서리', 'pushpin', false, -1],
      ['화면 글', 'none', false, -1],
      ['숨긴 글', 'pushpin', true, -1],
    ]);
    expect(p.texts![0]!.point).toEqual([1, 1, 0]);
    expect(p.texts![0]!.textPoint).toEqual([3, 3, 3]);
    expect(p.texts![0]!.arrow).toBe('closed');
    expect(p.texts![1]!.point).toBeUndefined();
    expect(p.texts![1]!.screen).toEqual([0.1, 0.2]);
    // 치수: 잰 값은 장면 단위, 글 자리는 치수선 가운데, 색은 모형 기본(0~255 → 0~1)
    const [d0, d1] = p.dimensions!;
    expect([d0!.kind, d0!.value, d0!.tag, d0!.node]).toEqual(['linear', 10, 'Dims', -1]);
    expect(d0!.textPoint).toEqual([5, -2, 0]);
    expect(d0!.direction).toEqual([1, 0, 0]);
    close(d0!.color, [64 / 255, 64 / 255, 64 / 255]);
    // 2배로 놓인 컴포넌트 안 치수: 값 2, 노드는 그 인스턴스
    expect([d1!.value, d1!.text, d1!.node, d1!.tag]).toEqual([2, '<>', 0, 'Layer0']);
    expect(d1!.textPoint).toEqual([101, 0, 0]);
    // 단면: 세계 평면, 기호 크기 = 묶음 범위 대각선의 반
    expect(p.sectionPlanes).toEqual([{ name: 'Cut A', plane: [1, 0, 0, -5], active: true, tag: 'Layer0', hidden: false, node: -1, size: Math.hypot(10, 10) / 2 }]);
    expect(p.sectionPids).toEqual([500]);

    const items = p.annotationItems!;
    const byId = new Map(p.lines.map((l) => [l.id, l]));
    expect(items.dimensions.every((id) => /^skp-dims-\d+$/.test(id))).toBe(true);
    expect(items.leaders.every((id) => /^skp-leaders-\d+$/.test(id))).toBe(true);
    expect(items.sectionPlanes.every((id) => /^skp-sections-\d+$/.test(id))).toBe(true);
    expect(items.dimensions.map((id) => byId.get(id)!.group).sort()).toEqual(['Dims', 'Layer0']);
    // 지시선은 숨긴 글 것을 빼고 하나: 글 자리 → 붙는 점 + 닫힌 화살
    expect(items.leaders).toHaveLength(1);
    const leader = segs(byId.get(items.leaders[0]!)!);
    expect(leader[0]).toEqual([3, 3, 3, 1, 1, 0]);
    expect(leader.length).toBe(1 + 2 + 1 + 4);
    // 치수선 A(0,-2,0) → B(10,-2,0), 연장선 S→A·E→B는 치수선 너머로, 빗금 끝 표시 둘
    const dimLines = segs(byId.get(items.dimensions.find((id) => byId.get(id)!.group === 'Dims')!)!);
    expect(dimLines[0]).toEqual([0, -2, 0, 10, -2, 0]);
    expect(dimLines[1]!.slice(0, 3)).toEqual([0, 0, 0]);
    expect(dimLines[1]![4]!).toBeLessThan(-2);
    expect(dimLines).toHaveLength(5);
    // 끝없는 보조선은 넓힌 장면 범위(대각선의 10%)에서 자르고 점선, 끝 있는 보조선은 그대로
    const guideSet = byId.get(items.guides.find((id) => id.startsWith('skp-guides-'))!)!;
    expect(guideSet.dashed).toBe(true);
    const g = segs(guideSet);
    const pad = Math.hypot(10, 10) * 0.1;
    close(g[0]!, [-pad, 5, 0, 10 + pad, 5, 0], 5);
    expect(g[1]).toEqual([0, 0, 0, 10, 5, 0]);
    expect(g[2]).toEqual([0, 0, 0, 3, 4, 5]);
    // 보조점은 PointSet3d
    expect(p.points).toHaveLength(1);
    expect([...p.points[0]!.positions]).toEqual([3, 4, 5]);
    expect(items.guides).toContain(p.points[0]!.id);
    // 단면 기호: 사각형 넷 + 화살 둘(기둥 + 날개 둘)
    expect(segs(byId.get(items.sectionPlanes[0]!)!)).toHaveLength(4 + 2 * 3);
    // 나무 항목 주인: 주석 선은 어느 노드 것도 아니다
    const t = p.tree!;
    expect(t.itemOwner.length).toBe(p.meshes.length + p.lines.length);
    for (const id of [...items.dimensions, ...items.leaders, ...items.sectionPlanes])
      expect(t.itemOwner[p.meshes.length + p.lines.findIndex((l) => l.id === id)]).toBe(-1);
    // 모서리 통계·선분 수는 형상만 센다
    expect(p.stats.segments).toBe(4);
  });

  it('장면 단위 배율은 잰 값·글 자리·단면 d에 들어간다', () => {
    const p = buildSceneParts(annotated(), NO_MATS, 25.4);
    expect(p.dimensions![0]!.value).toBeCloseTo(254, 9);
    expect(p.dimensions![1]!.value).toBeCloseTo(50.8, 9);
    close(p.dimensions![0]!.textPoint, [127, -50.8, 0]);
    close(p.sectionPlanes![0]!.plane, [1, 0, 0, -127]);
    expect(p.tree).toBeUndefined();
    expect(p.dimensions![1]!.node).toBe(-1);
  });

  it('숨긴 주석: meta에는 hidden으로 넣고, 선분은 extras일 때만 따로 묶어 extraItems.hidden에도 적는다', () => {
    const root = square(10);
    root.dimensions = [{ kind: 'linear', text: '', flags: 1, start: [0, 0, 0], end: [10, 0, 0], measureAxis: [1, 0, 0] }];
    root.guides = [{ kind: 'point', flags: 1, point: [1, 2, 3] }];
    const hiddenInner = ents({ texts: [{ text: '안쪽', flags: 0, point: [0, 0, 0], leaderType: 'pushpin', leader: [1, 0, 0] }] });
    root.instances = [inst(60, at(0, 0, 0), { flags: 1 })];
    const m = model(root, { definitions: new Map([def(60, '숨긴 정의', hiddenInner)]) });

    const plain = buildSceneParts(m, NO_MATS, 1);
    expect(plain.dimensions!.map((d) => d.hidden)).toEqual([true]);
    // 숨긴 인스턴스 안은 extras가 아니면 펼치지 않는다
    expect(plain.texts).toEqual([]);
    expect(plain.annotationItems).toEqual({ dimensions: [], leaders: [], guides: [], sectionPlanes: [] });
    expect(plain.points).toEqual([]);
    expect(plain.lines.map((l) => l.id)).toEqual(['skp-edges-0']);

    const ex = buildSceneParts(m, NO_MATS, 1, { extras: true });
    expect(ex.texts!.map((t) => [t.text, t.hidden])).toEqual([['안쪽', true]]);
    const ids = [...ex.annotationItems!.dimensions, ...ex.annotationItems!.leaders, ...ex.annotationItems!.guides];
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(ex.extras!.hidden).toContain(id);
    const dimSet = ex.lines.find((l) => l.id === ex.annotationItems!.dimensions[0])!;
    expect(dimSet.dashed).toBe(true);
    expect(dimSet.name).toBe('숨긴 치수 · Layer0');
    expect(ex.points[0]!.name).toBe('숨긴 보조점 · Layer0');
  });

  it('반지름·지름 치수: 잰 값, 글 자리, 지름은 맞은편까지', () => {
    const root = square(10);
    root.dimensions = [
      { kind: 'diameter', text: '', flags: 0, center: [35, 0, 0], arcPoint: [40, 0, 0], attach: [42.5, 0, 0], normal: [0, 0, 1] },
      { kind: 'radial', text: '', flags: 0, center: [0, 0, 0], arcPoint: [0, 3, 0], attach: [0, 1.5, 0], normal: [0, 0, 1], arrow: 'none' },
    ];
    const p = buildSceneParts(model(root), NO_MATS, 1);
    expect(p.dimensions!.map((d) => [d.kind, d.value])).toEqual([
      ['diameter', 10],
      ['radial', 3],
    ]);
    expect(p.dimensions![0]!.textPoint).toEqual([42.5, 0, 0]);
    expect(p.dimensions![0]!.direction).toEqual([1, 0, 0]);
    const s = segs(p.lines.find((l) => l.id === p.annotationItems!.dimensions[0])!);
    expect(s[0]).toEqual([30, 0, 0, 40, 0, 0]);
    expect(s[1]).toEqual([40, 0, 0, 42.5, 0, 0]);
    // 반지름(끝 표시 없음, 글이 호 안): 중심 → 호 위 점 하나
    expect(s[s.length - 1]).toEqual([0, 0, 0, 0, 3, 0]);
  });

  it('단면 평면은 인스턴스 변환(배율·거울상)을 역전치로 옮긴다', () => {
    close(xfPlane(at(10, 0, 0, 2, 1, 1), [1, 0, 0, -1])!, [1, 0, 0, -12]);
    // 거울상 x: 로컬 x ≥ 1 ⇔ 세계 x ≤ 9
    close(xfPlane(at(10, 0, 0, -1, 1, 1), [1, 0, 0, -1])!, [-1, 0, 0, 9]);
    close(xfNormal(at(0, 0, 0, 1, 1, 2), [0, Math.SQRT1_2, Math.SQRT1_2])!, [0, 2 / Math.sqrt(5), 1 / Math.sqrt(5)]);
    const inner = ents({ ...square(1), sections: [{ flags: 0, plane: [1, 0, 0, -1], name: 'Inner', symbol: 'C', active: true }] });
    const root = ents({ instances: [inst(70, at(10, 0, 0, -1, 1, 1))] });
    const p = buildSceneParts(model(root, { definitions: new Map([def(70, '판', inner)]) }), NO_MATS, 1, { outline: true });
    close(p.sectionPlanes![0]!.plane, [-1, 0, 0, 9]);
    expect(p.sectionPlanes![0]!.node).toBe(0);
  });

  it('먼 주석 선분은 묶음 원점을 둔다', () => {
    const root = square(10);
    root.dimensions = [{ kind: 'linear', text: '', flags: 0, start: [1e6, 0, 0], end: [1e6 + 10, 0, 0], measureAxis: [1, 0, 0] }];
    const p = buildSceneParts(model(root), NO_MATS, 1);
    const l = p.lines.find((x) => x.id === p.annotationItems!.dimensions[0])!;
    expect(l.origin).toEqual([1e6, 0, 0]);
    expect(segs(l)[0]).toEqual([1e6, 0, 0, 1e6 + 10, 0, 0]);
    expect(Math.abs(l.positions[0]!)).toBeLessThan(1);
  });

  it('주석이 없는 모형은 주석 칸이 없다', () => {
    const p = buildSceneParts(model(square(10)), NO_MATS, 1);
    expect(p.texts).toBeUndefined();
    expect(p.annotationItems).toBeUndefined();
    expect(p.points).toEqual([]);
    expect(p.lines.map((l) => l.id)).toEqual(['skp-edges-0']);
  });
});

describe('태그 칸', () => {
  it('태그 목록을 읽은 모형: 보임·색·폴더·선 종류, 점선 태그의 모서리는 점선', () => {
    const root = square(10, { edgeLayer: 2 });
    const m = model(root, {
      tags: [
        { id: 1, name: 'Layer0', visible: true, sceneHidden: false },
        { id: 2, name: 'Dims', visible: false, sceneHidden: false, colorMaterial: 'Layer_Dims', lineStyle: 'Dash', folder: 0 },
      ],
    });
    const mats = new Map<string, SkpMaterialInfo>([['Layer_Dims', { name: 'Layer_Dims', color: [1, 0.5, 0, 1], textured: false }]]);
    const p = buildSceneParts(m, mats, 1);
    expect(p.tags).toEqual([
      { name: 'Layer0', default: true, faces: 1, edges: 0, visible: true },
      { name: 'Dims', default: false, faces: 0, edges: 4, visible: false, color: [1, 0.5, 0, 1], folder: 0, lineStyle: 'Dash', dashed: true },
    ]);
    expect(p.lines.map((l) => [l.group, l.dashed ?? false])).toEqual([['Dims', true]]);
  });

  it('태그 목록이 없으면 예전 꼴 그대로', () => {
    const p = buildSceneParts(model(square(10)), NO_MATS, 1);
    expect(p.tags[0]).toEqual({ name: 'Layer0', default: true, faces: 1, edges: 4 });
    expect(p.lines[0]!.dashed).toBeUndefined();
  });
});

describe('기본 면 색', () => {
  it('재질 없는 면은 넘긴 스타일 앞면 색, 없으면 기본색', () => {
    const p = buildSceneParts(model(square(10)), NO_MATS, 1, { defaultFaceColor: [1, 1, 1, 1] });
    expect(p.meshes[0]!.color).toEqual([1, 1, 1, 1]);
    expect(p.materials[0]!.color).toEqual([1, 1, 1, 1]);
    expect(buildSceneParts(model(square(10)), NO_MATS, 1).meshes[0]!.color).toEqual(DEFAULT_FACE_COLOR);
  });
});

describe('나무 정보·넓이', () => {
  /** 컴포넌트 A(축마다 2·3·1배, 잠김) 안에 2배로 놓인 잎판, 그림 B */
  function infoModel(): SkpModel {
    const leaf = square(1);
    const plate = ents({ ...square(1), instances: [inst(30, at(5, 0, 0, 2, 2, 2), { pid: 13, name: '잎' })] });
    const picture = square(3);
    const root = ents({
      instances: [
        inst(20, at(0, 0, 0, 2, 3, 1), { pid: 11, guid: '0d0$fa1GVWJ8lKr32n91ou', attrs: { d: { k: 1 } }, flags: 0x20, kind: 'component', name: 'A' }),
        inst(40, at(50, 0, 0), { pid: 12, guid: 'ignored', kind: 'image' }),
      ],
    });
    return model(root, {
      definitions: new Map([
        def(20, '판', { ...plate, attrs: { SU_DefinitionSet: { Price: 3 } } }, { description: '설명', guid: 'DEFGUID', kind: 'component', behavior: { alwaysFaceCamera: true, cutsOpening: false, shadowsFaceSun: false } }),
        def(30, '잎판', leaf, { kind: 'component' }),
        def(40, '그림', picture, { kind: 'image' }),
      ]),
      properties: { ModelProperties: { Name: '집' } },
    });
  }

  it('노드마다 GUID·속성·크기·넓이·잠김, 정의마다 설명·GUID·속성, kind 2 = 그림', () => {
    const p = buildSceneParts(infoModel(), NO_MATS, 1, { outline: true });
    const t = p.tree!;
    expect(t.names).toEqual(['A', '', '잎']);
    expect([...t.kind]).toEqual([1, 2, 1]);
    const info = p.treeInfo!;
    expect(info.guid).toEqual(['0d0$fa1GVWJ8lKr32n91ou', '', '']);
    expect(p.attributes![p.modelAttrs!]).toEqual({ ModelProperties: { Name: '집' } });
    expect(p.attributes![info.attrs[0]!]).toEqual({ d: { k: 1 } });
    expect([...info.attrs].slice(1)).toEqual([-1, -1]);
    // 판 정의 로컬 범위: 자기 판(0..1) + 2배 잎판(x 5..7, y 0..2) → 7 × 2 × 0, 축 배율(2, 3, 1)
    close([...info.size].slice(0, 3), [14, 6, 0], 5);
    close([...info.size].slice(3, 6), [3, 3, 0], 5);
    close([...info.size].slice(6, 9), [2, 2, 0], 5);
    // 넓이(세계): A 자기 판 1 × 6 + 잎판 (1 × 4) × 6 = 30, 잎 24, 그림 9
    close([...info.area], [30, 9, 24], 6);
    expect([...info.locked]).toEqual([1, 0, 0]);
    const names = t.definitionNames;
    const k = names.indexOf('판');
    expect(info.definitionDescription[k]).toBe('설명');
    expect(info.definitionGuid[k]).toBe('DEFGUID');
    expect(p.attributes![info.definitionAttrs[k]!]).toEqual({ SU_DefinitionSet: { Price: 3 } });
    expect(info.definitionFaceCamera![k]).toBe(1);
    expect(info.definitionAttrs[names.indexOf('잎판')]).toBe(-1);
    expect(p.nodePids).toEqual([11, 12, 13]);
    // 윗단계 목록·재질 통계의 넓이
    expect(p.outline!.map((o) => [o.kind, o.name, Math.round(o.area * 1e6) / 1e6])).toEqual([
      ['component', 'A', 30],
      ['image', '그림', 9],
    ]);
    expect(p.materials.reduce((s, m) => s + m.area, 0)).toBeCloseTo(39, 6);
  });

  it('구멍 난 면의 넓이는 바깥 − 구멍', () => {
    const pts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 1, 2, 0, 2, 2, 0, 2, 1, 0];
    const root = ents({ points: Float64Array.from(pts), faces: [{ loops: [[0, 1, 2, 3], [4, 5, 6, 7]], normal: [0, 0, 1], flags: 0 }] });
    const p = buildSceneParts(model(root), NO_MATS, 2);
    expect(p.materials[0]!.area).toBeCloseTo(15 * 4, 9);
  });
});

describe('부드러운 음영(smooth)', () => {
  /** z=0 판 A와 45°로 꺾인 판 B가 매끈한 모서리(1-2)를 함께 쓴다 + 재질이 다른 각진 판 */
  function folded(withLoopEdges = true): SkpEntities {
    const points = Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 1, 2, 1, 1, 0, 0, 5, 1, 0, 5, 1, 1, 5]);
    const edges: SkpEdge[] = [
      { a: 0, b: 1, flags: 0 },
      { a: 1, b: 2, flags: 0x18 },
      { a: 2, b: 3, flags: 0 },
      { a: 3, b: 0, flags: 0 },
      { a: 1, b: 4, flags: 0 },
      { a: 4, b: 5, flags: 0 },
      { a: 5, b: 2, flags: 0 },
      { a: 6, b: 7, flags: 0 },
      { a: 7, b: 8, flags: 0 },
      { a: 8, b: 6, flags: 0 },
    ];
    const s = Math.SQRT1_2;
    const faces: SkpFace[] = [
      { loops: [[0, 1, 2, 3]], normal: [0, 0, 1], flags: 0, loopEdges: [[0, 1, 2, 3]] },
      { loops: [[1, 4, 5, 2]], normal: [-s, 0, s], flags: 0, loopEdges: [[4, 5, 6, 1]] },
      { loops: [[6, 7, 8]], normal: [0, 0, 1], flags: 0, front: 1, loopEdges: [[7, 8, 9]] },
    ];
    if (!withLoopEdges) for (const f of faces) delete f.loopEdges;
    return ents({ points, faces, edges });
  }
  const normalAt = (m: Mesh3d, p: readonly number[]): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < m.positions.length; i += 3)
      if (Math.abs(m.positions[i]! - p[0]!) < 1e-6 && Math.abs(m.positions[i + 1]! - p[1]!) < 1e-6 && Math.abs(m.positions[i + 2]! - p[2]!) < 1e-6)
        out.push([m.normals![i]!, m.normals![i + 1]!, m.normals![i + 2]!]);
    return out;
  };
  /** 두 면 법선 (0,0,1)·(−s,0,s)의 평균 = 22.5° 기운 법선 */
  const avg = [-Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];

  it('매끈한 모서리의 두 끝 꼭짓점은 두 면 법선의 평균, 나머지는 면 법선. 이어 칠한 면이 없는 그물은 법선이 없다', () => {
    const m = model(folded(), { materials: new Map([[1, '각진']]) });
    const p = buildSceneParts(m, NO_MATS, 1, { smooth: true });
    const curved = p.meshes.find((x) => x.name!.startsWith('기본 재질'))!;
    expect(curved.normals!.length).toBe(curved.positions.length);
    for (const n of [...normalAt(curved, [1, 0, 0]), ...normalAt(curved, [1, 1, 0])]) close(n, avg, 6);
    expect(normalAt(curved, [1, 0, 0])).toHaveLength(2);
    close(normalAt(curved, [0, 0, 0])[0]!, [0, 0, 1], 6);
    close(normalAt(curved, [2, 0, 1])[0]!, [-Math.SQRT1_2, 0, Math.SQRT1_2], 6);
    expect(p.meshes.find((x) => x.name!.startsWith('각진'))!.normals).toBeUndefined();
    // loopEdges가 없으면 정점 짝으로 모서리를 찾아 같은 결과
    const q = buildSceneParts(model(folded(false), { materials: new Map([[1, '각진']]) }), NO_MATS, 1, { smooth: true });
    expect([...q.meshes[0]!.normals!]).toEqual([...curved.normals!]);
  });

  it('끄면(기본) 법선이 없고 위치·삼각형은 같다', () => {
    const m = model(folded(), { materials: new Map([[1, '각진']]) });
    const on = buildSceneParts(m, NO_MATS, 1, { smooth: true });
    const off = buildSceneParts(m, NO_MATS, 1);
    expect(off.meshes.every((x) => x.normals === undefined)).toBe(true);
    expect(off.meshes.map((x) => [x.id, [...x.positions], [...x.indices!]])).toEqual(on.meshes.map((x) => [x.id, [...x.positions], [...x.indices!]]));
  });

  it('크게 접힌 곳(약 89° 넘게)은 평균하지 않는다', () => {
    const e = folded();
    e.points[3 * 4 + 0] = 1;
    e.points[3 * 5 + 0] = 1;
    e.faces[1]!.normal = [-1, 0, 0];
    const p = buildSceneParts(model(e, { materials: new Map([[1, '각진']]) }), NO_MATS, 1, { smooth: true });
    expect(p.meshes.every((x) => x.normals === undefined)).toBe(true);
  });

  it('인스턴스 변환: 거울상·축마다 다른 배율은 역전치로, 먼저 든 평면 묶음은 삼각형으로 채운다', () => {
    const root = square(10, {});
    root.points.set([0, 0, -3, 10, 0, -3, 10, 10, -3, 0, 10, -3]);
    root.instances = [inst(80, at(20, 0, 0, -1, 1, 1)), inst(80, at(40, 0, 0, 1, 1, 2))];
    const f = folded();
    f.faces.pop();
    const m = model(root, { definitions: new Map([def(80, '곡면', f)]) });
    const p = buildSceneParts(m, NO_MATS, 1, { smooth: true });
    expect(p.meshes).toHaveLength(1);
    const mesh = p.meshes[0]!;
    expect(mesh.normals!.length).toBe(mesh.positions.length);
    // 바로 놓인 판(먼저 든 평면 묶음): 법선 ±z
    for (const n of normalAt(mesh, [0, 0, -3])) close(n.map(Math.abs), [0, 0, 1], 6);
    // 거울상(x → −x): 평균 법선의 x 부호가 바뀐다
    for (const n of normalAt(mesh, [19, 0, 0])) close(n, [-avg[0]!, 0, avg[2]!], 6);
    // z 2배: 법선은 (x, y, z/2)를 정규화
    const k = Math.hypot(avg[0]!, avg[2]! / 2);
    for (const n of normalAt(mesh, [41, 0, 0])) close(n, [avg[0]! / k, 0, avg[2]! / 2 / k], 6);
  });
});
