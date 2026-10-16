import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { annotationShown, createDoc, folderHidden, folderTags, itemVisible, readMetaExtras, tagHidden } from '../../src/app/doc';
import { keyAction } from '../../src/app/keys';

/** 태그 폴더·장면·주석이 든 손으로 만든 장면 */
function scene(): Scene3d {
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const seg = new Float32Array([0, 0, 0, 1, 0, 0]);
  return {
    name: 't',
    units: 'mm',
    meshes: [{ id: 'skp-mesh-0', positions: tri, color: [1, 1, 1, 1], group: 'Walls' }],
    lines: [
      { id: 'skp-edges-0', positions: seg, group: 'Walls' },
      { id: 'skp-dims-0', positions: seg, group: 'Dims' },
      { id: 'skp-guides-0', positions: seg, group: 'Layer0', dashed: true },
    ],
    meta: {
      version: '26.1.194',
      container: 'zip',
      lengthUnit: 'cm',
      units: { lengthUnit: 'cm', lengthFormat: 'decimal', lengthPrecision: 1, anglePrecision: 1, areaUnit: null, areaPrecision: null, volumeUnit: null, volumePrecision: null, suppressUnits: false },
      tagStats: [
        { name: 'Layer0', default: true, faces: 0, edges: 0 },
        { name: 'Walls', default: false, faces: 1, edges: 1, visible: true, color: [1, 0, 0, 1], folder: 1 },
        { name: 'Dims', default: false, faces: 0, edges: 1, visible: false, folder: 0, lineStyle: 'Dash' },
      ],
      tagFolders: [
        { name: 'Furniture', visible: true, parent: -1 },
        { name: 'Inner', visible: false, parent: 0 },
      ],
      pages: [{ name: '앞' }, { name: '위', hiddenTags: ['Walls'] }, { bogus: 1 }],
      activePage: 1,
      style: { faceStyle: 'shaded', texts: false, dimensions: true },
      annotationItems: { dimensions: ['skp-dims-0'], leaders: [], guides: ['skp-guides-0'], sectionPlanes: [] },
      sectionPlanes: [{ name: 'S', plane: [1, 0, 0, -5], active: true, tag: 'Layer0', hidden: false, node: -1, size: 10 }, { name: 'bad', plane: [1] }],
      modelName: '집',
    },
  };
}

describe('meta 더한 칸 읽기', () => {
  it('장면·스타일·주석 묶음을 안전하게 읽는다', () => {
    const x = readMetaExtras(scene());
    expect(x.units.lengthUnit).toBe('cm');
    expect(x.units.lengthPrecision).toBe(1);
    // 꼴이 이상한 장면도 차례를 지키려고 이름을 붙여 남긴다(activePage가 차례를 가리킨다)
    expect(x.pages.map((p) => p.name)).toEqual(['앞', '위', '장면 3']);
    expect(x.activePage).toBe(1);
    expect(x.sectionPlanes.map((p) => p.index)).toEqual([0]);
    expect(x.sectionPlanesRaw).toHaveLength(2);
    expect(x.annotationKind.get('skp-dims-0')).toBe('dimensions');
    expect(x.showTexts).toBe(false);
    expect(x.showDimensions).toBe(true);
    expect(x.modelName).toBe('집');
    // 옛 꼴 meta(더한 칸 없음)도 빈 값으로
    const old = readMetaExtras({ name: 'x', units: 'inch', meshes: [], lines: [], meta: { lengthUnit: 'ft' } });
    expect(old.pages).toEqual([]);
    expect(old.units.lengthUnit).toBe('feet');
    expect(old.annotationItems).toBeNull();
    expect(old.showTexts).toBe(true);
  });
});

describe('태그 폴더와 실제 숨김', () => {
  it('파일에서 숨긴 태그·폴더는 처음부터 숨고, 폴더가 숨으면 안의 태그도 숨는다', () => {
    const d = createDoc('t.skp', 1, { scene: scene(), ms: 1 });
    expect(d.hiddenTags.has('Dims')).toBe(true);
    expect(d.hiddenFolders.has(1)).toBe(true);
    expect(folderHidden(d, 1)).toBe(true);
    expect(folderHidden(d, 0)).toBe(false);
    // Walls 자신은 보이지만 숨긴 폴더 Inner 안에 있다
    expect(tagHidden(d, 'Walls')).toBe(true);
    expect(tagHidden(d, 'Layer0')).toBe(false);
    d.hiddenFolders.delete(1);
    expect(tagHidden(d, 'Walls')).toBe(false);
    d.hiddenFolders.add(0);
    expect(tagHidden(d, 'Walls')).toBe(true);
    expect(folderTags(d, 0).sort()).toEqual(['Dims', 'Walls']);
    expect(folderTags(d, 1)).toEqual(['Walls']);
    const walls = d.tags.find((t) => t.name === 'Walls')!;
    expect(walls.color).toEqual([1, 0, 0, 1]);
    expect(d.tags.find((t) => t.name === 'Dims')!.lineStyle).toBe('Dash');
  });
});

describe('주석 켜고 끄기', () => {
  it('치수·보조선 묶음은 켜짐을 따른다', () => {
    const d = createDoc('t.skp', 1, { scene: scene(), ms: 1 });
    const dimItem = d.scene.meshes.length + 1;
    const guideItem = d.scene.meshes.length + 2;
    expect(itemVisible(d, dimItem)).toBe(true);
    d.showDimensions = false;
    expect(itemVisible(d, dimItem)).toBe(false);
    expect(annotationShown(d, 'guides')).toBe(true);
    d.showGuides = false;
    expect(itemVisible(d, guideItem)).toBe(false);
    // 보통 모서리는 그대로
    expect(itemVisible(d, d.scene.meshes.length)).toBe(true);
  });
});

describe('장면·줄자 키', () => {
  it('장면이 있으면 PageUp·PageDown, T는 줄자', () => {
    const base = { hasDoc: true };
    expect(keyAction({ ...base, key: 'PageDown', hasPages: true })).toEqual({ kind: 'page', delta: 1 });
    expect(keyAction({ ...base, key: 'PageUp', hasPages: true })).toEqual({ kind: 'page', delta: -1 });
    expect(keyAction({ ...base, key: 'PageDown' })).toEqual({ kind: 'viewer' });
    expect(keyAction({ ...base, key: 't' })).toEqual({ kind: 'tape' });
    expect(keyAction({ ...base, key: 't', ctrl: true })).toBeNull();
    expect(keyAction({ key: 't' })).toBeNull();
  });
});
