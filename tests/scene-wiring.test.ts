/**
 * skpToScene가 중간 모형의 뿌리 절·주석·나무 정보를 meta로 잇는지(바이트 읽기와 따로 보려고 readModelDat만 손으로 만든 모형으로 바꾼다).
 * 꾸러미(ZIP)·style.xml은 실제로 읽는다.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SkpMetaExtras } from '../src/meta';
import type { SkpEntities, SkpModel } from '../src/model';

const hold = vi.hoisted(() => ({ model: null as unknown }));
vi.mock('../src/model', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/model')>();
  return { ...orig, readModelDat: (...a: Parameters<typeof orig.readModelDat>) => (hold.model as SkpModel | null) ?? orig.readModelDat(...a) };
});

import { skpToScene } from '../src/index';
import { entities, modelDat, skpFile, styleXml, utf8 } from './build';

const at = (x: number, y = 0, z = 0): Float64Array => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

function square(s: number): SkpEntities {
  return {
    points: Float64Array.from([0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0]),
    faces: [{ loops: [[0, 1, 2, 3]], normal: [0, 0, 1], flags: 0 }],
    edges: [0, 1, 2, 3].map((i) => ({ a: i, b: (i + 1) % 4, flags: 0 })),
    instances: [],
  };
}

function handModel(lengthUnit = 2): SkpModel {
  const inner: SkpEntities = { ...square(1), sections: [{ pid: 500, flags: 0, plane: [0, 0, 1, -0.5], name: 'Cut', symbol: 'A', active: true }] };
  const root: SkpEntities = {
    ...square(10),
    instances: [{ definition: 20, matrix: at(20), flags: 0, pid: 11, name: '상자', kind: 'group' }],
    texts: [{ text: '메모', flags: 0, point: [1, 1, 0], leaderType: 'pushpin', leader: [0, 0, 1] }],
    guides: [{ kind: 'point', flags: 0, point: [1, 2, 3] }],
  };
  return {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: new Map([[20, { id: 20, name: '상자', entities: inner, kind: 'group', description: '설명' }]]),
    root,
    lengthUnit,
    counts: { vertices: 8, edges: 8, faces: 2, instances: 1 },
    warnings: [],
    units: {
      lengthUnit: 'mm',
      lengthFormat: 'decimal',
      lengthPrecision: 1,
      anglePrecision: 1,
      areaUnit: null,
      areaPrecision: null,
      volumeUnit: null,
      volumePrecision: null,
      suppressUnits: false,
    },
    camera: { eye: [100, 0, 0], target: [0, 0, 0], up: [0, 0, 1], perspective: true, fov: 35, twoPoint: false },
    rendering: { values: new Map(), styleName: 'Style' },
    pages: [
      { name: '보기 1', description: '', flags: 0x1 | 0x2 | 0x40 | 0x100, camera: { eye: [0, -50, 0], target: [0, 0, 0], up: [0, 0, 1], perspective: false, height: 10, twoPoint: false }, hiddenIds: [11], hiddenTags: [], sectionIds: [500], rendering: { values: new Map(), styleName: 'Scene' } },
      { name: '보기 2', description: '', flags: 0, hiddenIds: [], hiddenTags: [], sectionIds: [] },
    ],
    activePage: 1,
    tagFolders: [{ name: '폴더', visible: false, parent: -1 }],
    name: '집',
    description: '모형 설명',
    properties: { ModelProperties: { Name: '집' } },
  };
}

function file(): Uint8Array {
  const front = (v: string) => utf8(styleXml([[2002, 4, v]]));
  return skpFile(modelDat({ root: entities(undefined, {}) }), {
    extra: [
      { name: 'styles/Style/style.xml', data: front('-1') },
      // 파랑(r 0, g 0, b 255): v = b << 16 | 불투명
      { name: 'styles/Scene/style.xml', data: front(String((255 << 16) | (255 << 24))) },
    ],
  });
}

describe('skpToScene meta 잇기', () => {
  it('단위·카메라·스타일(style.xml)·장면·폴더·이름·주석·나무 정보', () => {
    hold.model = handModel();
    try {
      const s = skpToScene(file(), { outline: true, smooth: true });
      const m = s.meta as Record<string, unknown> & SkpMetaExtras;
      expect(s.units).toBe('mm');
      expect(m.lengthUnit).toBe('mm');
      expect(m.units!.lengthUnit).toBe('mm');
      expect(m.camera!.eye).toEqual([2540, 0, 0]);
      expect(m.camera!.fovY).toBe(35);
      // 모형 스타일: 앞면 흰색 → 재질 없는 면도 흰색
      expect(m.style!.front).toEqual([1, 1, 1]);
      expect(s.meshes.every((x) => x.color.join() === '1,1,1,1')).toBe(true);
      // 장면: 카메라(평행 높이 × 배율)·장면 스타일·단면(배치 차례)·숨긴 노드
      const [p0, p1] = m.pages!;
      expect(p0!.camera).toMatchObject({ perspective: false, height: 254 });
      expect(p0!.style!.front).toEqual([0, 0, 1]);
      expect(p0!.sectionPlanes).toEqual([0]);
      expect(p0!.hiddenNodes).toEqual([0]);
      expect(p1).toEqual({ name: '보기 2' });
      expect(m.activePage).toBe(1);
      expect(m.tagFolders).toEqual([{ name: '폴더', visible: false, parent: -1 }]);
      expect([m.modelName, m.modelDescription]).toEqual(['집', '모형 설명']);
      // 주석: 세계 좌표(mm), 단면은 인스턴스 안 → 노드 0
      expect(m.texts![0]!.textPoint).toEqual([25.4, 25.4, 25.4]);
      expect(m.sectionPlanes![0]).toMatchObject({ name: 'Cut', active: true, node: 0 });
      expect(m.sectionPlanes![0]!.plane[3]).toBeCloseTo(-12.7, 9);
      expect(m.annotationItems!.guides).toEqual([s.points![0]!.id]);
      expect(m.annotationItems!.leaders).toHaveLength(1);
      // 나무 정보·속성
      expect(m.treeInfo!.definitionDescription).toEqual(['설명']);
      expect(m.treeInfo!.area[0]).toBeCloseTo(25.4 * 25.4, 6);
      expect(m.attributes![m.modelAttrs!]).toEqual({ ModelProperties: { Name: '집' } });
    } finally {
      hold.model = null;
    }
  });

  it('야드 모형은 인치 장면에 표시 단위만 야드', () => {
    hold.model = handModel(5);
    try {
      const s = skpToScene(file());
      expect(s.units).toBe('inch');
      expect(s.meta!.lengthUnit).toBe('yd');
      expect((s.meta as SkpMetaExtras).camera!.eye).toEqual([100, 0, 0]);
      // outline이 없으면 나무가 없어 숨긴 개체는 노드로 바꾸지 않는다
      expect((s.meta as SkpMetaExtras).pages![0]!.hiddenNodes).toBeUndefined();
      expect((s.meta as SkpMetaExtras).treeInfo).toBeUndefined();
    } finally {
      hold.model = null;
    }
  });
});
