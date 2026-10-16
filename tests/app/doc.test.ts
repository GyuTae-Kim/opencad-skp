import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import {
  createDoc,
  definitionCounts,
  docLabel,
  majorOf,
  materialRows,
  outlineRows,
  panelTabs,
  readInfo,
  releaseName,
  sceneCounts,
  selectionForPick,
  selectionIds,
  selectionText,
  tagRows,
  unitSummary,
  unsupportedVersion,
} from '../../src/app/doc';
import { skpToScene } from '../../src/index';
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

  it('SketchUp 3~6만 아직 못 읽는 판으로 가린다(7·8·2013~2020은 읽는다)', () => {
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v4', root: squareEntities() })))).toBe('4.0.1');
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v8', root: squareEntities() })))).toBeNull();
    expect(unsupportedVersion(skpToScene(mfcFile({ schemas: 'v20', root: squareEntities() })))).toBeNull();
    // 잘린 2017 파일은 판 안내가 아니라 열지 못한 파일이다
    expect(unsupportedVersion(skpToScene(oldSkpHeader('17.2.2555')))).toBeNull();
    expect(unsupportedVersion(sampleScene())).toBeNull();
    expect(unsupportedVersion({ name: 'x', units: 'unknown', meshes: [], lines: [], meta: { version: '6.0.1', container: 'mfc' } })).toBe('6.0.1');
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
  });

  it('재질 고르기', () => {
    const d = createDoc('예제.skp', 1234, { scene: sampleScene(), ms: 5 });
    const sel = { kind: 'material' as const, name: '원목' };
    expect(selectionIds(d, sel)).toEqual(d.materials.find((m) => m.name === '원목')!.meshIds);
    expect(selectionText(d, sel)).toBe('재질 원목 · 면 88');
    expect(selectionIds(d, null)).toEqual([]);
    expect(selectionText(d, null)).toBe('');
  });

  it('outline이 없는 장면은 구성 탭을 숨긴다', () => {
    const d = createDoc('x.skp', 1, { scene: skpToScene(sampleSkpBytes()), ms: 1 });
    expect(d.outline).toEqual([]);
    expect(panelTabs(d).map(([k]) => k)).toEqual(['tags', 'entity', 'info']);
  });
});
