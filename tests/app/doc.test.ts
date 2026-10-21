import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import {
  EDGE_STUB,
  addEdgeStubs,
  createDoc,
  hiddenSelection,
  sectionIndexOfId,
  sectionPlanesFor,
  tagColors,
  definitionCounts,
  docLabel,
  majorOf,
  materialCount,
  materialRows,
  outlineRows,
  panelTabs,
  readInfo,
  releaseName,
  sceneCounts,
  selectionEntity,
  selectionForPick,
  selectionIds,
  selectionText,
  tagRows,
  unitSummary,
  unsupportedVersion,
} from '../../src/app/doc';
import { readSkpImages, skpToScene } from '../../src/index';
import { oldSkpHeader } from '../build';
import { mfcFile, squareEntities } from '../mfcwrite';
import { sampleSkpBytes } from '../../src/app/sample';

const sampleScene = (): Scene3d => skpToScene(sampleSkpBytes(), { name: '예제', outline: true });

describe('판·단위 글', () => {
  it('판 → 제품 이름', () => {
    expect(majorOf('26.1.194')).toBe(26);
    expect(releaseName('26.1.194')).toBe('SketchUp 2026');
    expect(releaseName('21.0.339')).toBe('SketchUp 2021');
    expect(releaseName('13.0.1')).toBe('SketchUp 2013');
    expect(releaseName('8.0.1')).toBe('SketchUp 8');
    expect(releaseName(null)).toBe('SketchUp');
    expect(releaseName('이상함')).toBe('SketchUp');
  });

  it('SketchUp 3~5만 아직 못 읽는 판으로 가린다(6·7·8·2013~2020은 읽는다)', () => {
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v4', root: squareEntities() })))).toBe('4.0.1');
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v6', root: squareEntities() })))).toBeNull();
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v8', root: squareEntities() })))).toBeNull();
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v20', root: squareEntities() })))).toBeNull();
    // 잘린 2017 파일은 판 안내가 아니라 열지 못한 파일이다
    expect(unsupportedVersion(skpToScene(oldSkpHeader('17.2.2555')))).toBeNull();
    expect(unsupportedVersion(sampleScene())).toBeNull();
    expect(unsupportedVersion({ name: 'x', units: 'unknown', meshes: [], lines: [], meta: { version: '5.0.1', container: 'mfc' } })).toBe('5.0.1');
    expect(unsupportedVersion({ name: 'x', units: 'unknown', meshes: [], lines: [], meta: { version: '6.0.1', container: 'mfc' } })).toBeNull();
    expect(unsupportedVersion({ name: 'x', units: 'unknown', meshes: [], lines: [], meta: { version: '20.0.1', container: 'mfc' } })).toBeNull();
  });

  it('정보·단위 요약', () => {
    const s = sampleScene();
    const info = readInfo(s);
    expect(info.version).toBe('26.1.194');
    expect(info.container).toBe('zip');
    expect(info.lengthUnit).toBe('mm');
    expect(info.tags).toBe(6);
    expect(docLabel(info)).toBe('SketchUp 2026 · 26.1.194');
    expect(unitSummary(info, 'mm')).toBe('mm');
    expect(unitSummary({ ...info, lengthUnit: 'cm' }, 'mm')).toBe('cm · 좌표 mm');
    expect(unitSummary({ ...info, lengthUnit: 'inch' }, 'inch')).toBe('in');
    expect(unitSummary({ ...info, lengthUnit: null }, 'unknown')).toBe('모름');
    expect(readInfo({ name: 'x', units: 'mm', meshes: [], lines: [] }).version).toBeNull();
  });
});

describe('패널 목록', () => {
  it('태그: 모형 차례, 기본 태그 표시, 그릴 것이 있는지', () => {
    const rows = tagRows(sampleScene());
    expect(rows.map((r) => r.name)).toEqual(['Layer0', '벽', '지붕', '가구', '조경', '치수']);
    expect(rows[0]!.default).toBe(true);
    // 치수 태그에는 치수선·지시선만 있다
    expect(rows.filter((r) => r.name !== '치수').every((r) => r.hasGeometry && (r.faces ?? 0) > 0)).toBe(true);
    expect(rows.find((r) => r.name === '치수')).toMatchObject({ hasGeometry: true, faces: 0, folder: 1 });
    expect(rows.find((r) => r.name === '벽')).toMatchObject({ folder: 0, visible: true });
    expect(rows.find((r) => r.name === '벽')!.color![0]).toBeCloseTo(214 / 255);
    const furniture = rows.find((r) => r.name === '가구')!;
    // 탁자 26면 + 의자 31면 × 4
    expect(furniture.faces).toBe(26 + 31 * 4);
  });

  it('태그: meta가 없으면 장면 묶음에서', () => {
    const s: Scene3d = {
      name: 'x',
      units: 'mm',
      meshes: [{ id: 'a', positions: new Float32Array(9), color: [1, 1, 1, 1], group: 'A' }],
      lines: [{ id: 'b', positions: new Float32Array(6), group: 'B' }],
    };
    expect(tagRows(s).map((r) => [r.name, r.faces, r.hasGeometry])).toEqual([
      ['A', null, true],
      ['B', null, true],
    ]);
  });

  it('재질: 많이 쓴 차례, 색·투명·그물 id', () => {
    const s = sampleScene();
    const rows = materialRows(s);
    expect(rows.length).toBe(11);
    expect(rows[0]!.name).toBe('잎');
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.faces!).toBeGreaterThanOrEqual(rows[i]!.faces!);
    const glass = rows.find((r) => r.name === '유리')!;
    expect(glass.color[3]).toBeCloseTo(0.35);
    const ids = new Set(s.meshes.map((m) => m.id));
    expect(rows.every((r) => r.meshIds.length > 0 && r.meshIds.every((id) => ids.has(id)))).toBe(true);
  });

  it('재질: 뒷면에 칠한 면 수(뒷면만이면 그것만)', () => {
    const s: Scene3d = {
      name: 'x',
      units: 'mm',
      meshes: [{ id: 'a', positions: new Float32Array(9), color: [1, 1, 1, 1], backColor: [0, 0, 1, 1] }],
      lines: [],
      meta: {
        materialStats: [
          { name: '기본 재질', color: [1, 1, 1, 1], faces: 3, meshIds: ['a'] },
          { name: '파랑', color: [0, 0, 1, 1], faces: 0, backFaces: 3, meshIds: ['a'] },
          { name: '빨강', color: [1, 0, 0, 1], faces: 2, backFaces: 1, meshIds: ['a'] },
        ],
      },
    };
    const rows = materialRows(s);
    expect(rows.map((r) => [r.name, materialCount(r)])).toEqual([
      ['기본 재질', '면 3'],
      ['빨강', '면 2 · 뒷면 1'],
      ['파랑', '뒷면 3'],
    ]);
    expect(materialCount({ faces: null, backFaces: 0 })).toBe('');
  });

  it('재질: meta가 없으면 그물 이름에서', () => {
    const s: Scene3d = {
      name: 'x',
      units: 'mm',
      meshes: [
        { id: 'a', name: '벽돌 · Layer0', positions: new Float32Array(9), color: [1, 0, 0, 1] },
        { id: 'b', name: '벽돌 · 벽', positions: new Float32Array(9), color: [1, 0, 0, 1] },
        { id: 'c', positions: new Float32Array(9), color: [0, 0, 0, 1] },
      ],
      lines: [],
    };
    expect(materialRows(s).map((r) => [r.name, r.meshIds])).toEqual([
      ['기본 재질', ['c']],
      ['벽돌', ['a', 'b']],
    ]);
  });

  it('구성: 윗단계 항목과 정의별 개수', () => {
    const rows = outlineRows(sampleScene());
    expect(rows.length).toBe(11);
    expect(rows[0]!.kind).toBe('loose');
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.name)).toEqual(['집', '지붕']);
    expect(definitionCounts(rows).map((d) => [d.name, d.count])).toEqual([
      ['의자', 4],
      ['나무', 3],
      ['박공지붕', 1],
      ['집 벽체', 1],
      ['탁자', 1],
    ]);
    expect(outlineRows({ name: 'x', units: 'mm', meshes: [], lines: [], meta: { outline: 'bad' } })).toEqual([]);
  });

  it('장면 크기', () => {
    const c = sceneCounts(sampleScene());
    expect(c.triangles).toBeGreaterThan(500);
    expect(c.segments).toBeGreaterThan(300);
  });
});

describe('숨은 선 모드용 윤곽선·태그 색', () => {
  it('윤곽선이 없는 그물에만 길이 0 윤곽선을 달고(첫 정점), 숨길 구간에 늘 그 윤곽선을 넣는다', () => {
    const s: Scene3d = {
      name: 'x',
      units: 'mm',
      meshes: [
        { id: 'a', positions: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), indices: Uint32Array.of(0, 1, 2), color: [1, 1, 1, 1] },
        {
          id: 'b',
          positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: Uint32Array.of(0, 1, 2),
          color: [1, 1, 1, 1],
          edges: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0]),
          billboard: { origin: [0, 0, 0], axis: 'z' },
        },
      ],
      lines: [{ id: 'l', positions: new Float32Array(6) }],
    };
    const ids = addEdgeStubs(s);
    expect([...ids]).toEqual(['a']);
    expect([...s.meshes[0]!.edges!]).toEqual([1, 2, 3, 1, 2, 3]);
    expect(s.meshes[1]!.edges!.length).toBe(12);
    const d = { scene: s, stubEdges: ids };
    expect(hiddenSelection(d, 0, null)).toEqual({ prims: [], edges: EDGE_STUB });
    expect(hiddenSelection(d, 0, [{ start: 0, count: 1 }])).toEqual({ prims: [{ start: 0, count: 1 }], edges: EDGE_STUB });
    // 카메라를 보는 그물: 삼각형을 모두 숨기면 윤곽선(그 배치의 모서리)도
    expect(hiddenSelection(d, 1, [{ start: 0, count: 1 }])).toEqual({ prims: [{ start: 0, count: 1 }], edges: [{ start: 0, count: 2 }] });
    expect(hiddenSelection(d, 1, null)).toBeNull();
    expect(hiddenSelection(d, 2, [{ start: 0, count: 1 }])).toEqual([{ start: 0, count: 1 }]);
  });

  it('태그 색: 그물의 묶음(태그) 색, 불투명도는 작은 쪽, 색을 모르는 태그는 빼고', () => {
    const s: Scene3d = {
      name: 'x',
      units: 'mm',
      meshes: [
        { id: 'a', positions: new Float32Array(9), color: [1, 1, 1, 1], group: '벽' },
        { id: 'h', positions: new Float32Array(9), color: [1, 1, 1, 0.28], group: '벽' },
        { id: 'c', positions: new Float32Array(9), color: [1, 1, 1, 1], group: '모름' },
      ],
      lines: [],
    };
    const tags = [
      { name: '벽', color: [1, 0, 0, 1] as [number, number, number, number] },
      { name: '모름', color: null },
    ];
    const m = tagColors({ scene: s, tags: tags as never });
    expect([...m]).toEqual([
      ['a', [1, 0, 0, 1]],
      ['h', [1, 0, 0, 0.28]],
    ]);
  });
});

describe('파일 단면 → 코어 여러 단면', () => {
  it('모형 단면은 모두, 그룹 안 단면은 따로 나눈 노드의 항목만 자르고, 나누지 않은 노드·한도(6)를 넘는 것은 센다', () => {
    const d = createDoc('예제.skp', 1, { scene: sampleScene(), ms: 1 });
    const t = d.tree!;
    const split = [...Array(t.count).keys()].find((i) => t.meshFirst[i]! >= 0)!;
    const item = (index: number, node: number) => ({ index, plane: { node }, normal: [0, 0, 1], offset: index });
    const r = sectionPlanesFor(d, [item(0, -1), item(1, split)], 'closed');
    expect(r.applied).toEqual([0, 1]);
    expect(r.planes[0]).toEqual({ normal: [0, 0, 1], offset: 0, caps: 'closed', id: 'skp-section-0' });
    expect(r.planes[1]!.items!.length).toBeGreaterThan(0);
    expect(r.planes[1]!.items!.every((id) => d.meshIndex.has(id) || d.lineIndex.has(id))).toBe(true);
    // 나누지 않은 노드(구간으로만 아는 노드)는 그 노드만 자를 수 없다
    const unsplit = { ...d, tree: { ...t, meshFirst: Int32Array.from(t.meshFirst).fill(-1) } };
    expect(sectionPlanesFor(unsplit, [item(1, split)], 'none').skipped).toEqual({ scope: 1, limit: 0 });
    const many = sectionPlanesFor(d, [...Array(8).keys()].map((i) => item(i, -1)), 'none');
    expect(many.planes.length).toBe(6);
    expect(many.skipped).toEqual({ scope: 0, limit: 2 });
    expect(sectionIndexOfId('skp-section-12')).toBe(12);
    expect(sectionIndexOfId('axis')).toBeNull();
    expect(sectionIndexOfId(undefined)).toBeNull();
  });
});

describe('문서·고르기', () => {
  it('고르기 결과는 윗단계 항목 전체를 강조한다', () => {
    const d = createDoc('예제.skp', 1234, { scene: sampleScene(), ms: 5 });
    expect(panelTabs(d).map(([k]) => k)).toEqual(['tags', 'outline', 'entity', 'info']);
    const chair = d.outline.find((r) => r.name === '의자 동')!;
    const meshId = chair.ids.find((id) => id.startsWith('skp-mesh'))!;
    const pick = { kind: 'mesh' as const, id: meshId, index: 0, point: [0, 0, 0] as [number, number, number] };
    const sel = selectionForPick(d, pick);
    expect(sel).toEqual({ kind: 'outline', index: chair.index });
    expect(selectionIds(d, sel)).toEqual(chair.ids);
    expect(selectionText(d, sel, pick)).toBe('컴포넌트 의자 동 (의자) · 태그 가구 · 재질 파란 천 · 면 31');
    expect(selectionForPick(d, null)).toBeNull();
    expect(selectionForPick(d, { ...pick, id: 'unknown' })).toEqual({ kind: 'item', id: 'unknown' });
    // 그물 윤곽선 고르기(kind 'edge')는 그 그물의 첫 삼각형 노드로(윤곽선 번호를 삼각형 번호로 읽지 않는다)
    expect(selectionForPick(d, { ...pick, kind: 'edge', index: 99999, raw: 99999 })).toEqual(sel);
  });

  it('재질 고르기', () => {
    const d = createDoc('예제.skp', 1234, { scene: sampleScene(), ms: 5 });
    const sel = { kind: 'material' as const, name: '원목' };
    expect(selectionIds(d, sel)).toEqual(d.materials.find((m) => m.name === '원목')!.meshIds);
    expect(selectionText(d, sel)).toBe('재질 원목 · 면 88');
    expect(selectionIds(d, null)).toEqual([]);
    expect(selectionText(d, null)).toBe('');
  });

  it('무늬 재질의 엔티티 정보는 3D에 무늬를 입혔는지를 목록 칩과 같은 기준으로 적는다', () => {
    const bytes = sampleSkpBytes();
    const withTex = createDoc('예제.skp', 1, { scene: skpToScene(bytes, { name: '예제', outline: true, textures: readSkpImages(bytes).materials }), ms: 1 });
    const tile = withTex.materials.find((m) => m.name === '기와')!;
    expect(tile.textured).toBe(true);
    expect(tile.texture).not.toBeNull();
    withTex.selection = { kind: 'material', name: '기와' };
    expect(selectionEntity(withTex).extra).toContainEqual({ label: '무늬', value: '그림 재질(3D에 무늬를 입힘)' });
    // 무늬 그림을 넘기지 않으면(옛 판·한도 초과) 평균색
    const plain = createDoc('예제.skp', 1, { scene: sampleScene(), ms: 1 });
    expect(plain.materials.find((m) => m.name === '기와')!.texture).toBeNull();
    plain.selection = { kind: 'material', name: '기와' };
    expect(selectionEntity(plain).extra).toContainEqual({ label: '무늬', value: '그림 재질(3D는 평균색)' });
  });

  it('outline이 없는 장면은 구성 탭을 숨긴다', () => {
    const d = createDoc('x.skp', 1, { scene: skpToScene(sampleSkpBytes()), ms: 1 });
    expect(d.outline).toEqual([]);
    expect(panelTabs(d).map(([k]) => k)).toEqual(['tags', 'entity', 'info']);
  });
});
