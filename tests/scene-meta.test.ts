import { describe, expect, it } from 'vitest';
import type { SkpCamera, SkpEntities, SkpModel, SkpPage } from '../src/model';
import { AttrPool, attrValueMeta, cameraMeta, pagesMeta, styleFor, unitsFor } from '../src/scene-meta';
import { edgesFrom, facesFrom } from '../src/entities';

const ents = (): SkpEntities => ({ points: new Float64Array(), faces: facesFrom([]), edges: edgesFrom([]), instances: [] });

function model(o: Partial<SkpModel> = {}): SkpModel {
  return {
    materials: new Map(),
    layers: new Map([[1, 'Layer0']]),
    defaultLayer: 1,
    definitions: new Map(),
    root: ents(),
    counts: { vertices: 0, edges: 0, faces: 0, instances: 0 },
    warnings: [],
    ...o,
  };
}

const page = (o: Partial<SkpPage>): SkpPage => ({ name: '장면', description: '', flags: 0, hiddenIds: [], hiddenTags: [], sectionIds: [], ...o });

describe('단위', () => {
  it('길이 단위 코드 → 장면 단위·배율·표시 글(야드는 인치 장면)', () => {
    expect(unitsFor(0)).toEqual({ units: 'inch', scale: 1, label: 'inch' });
    expect(unitsFor(1)).toEqual({ units: 'inch', scale: 1, label: 'ft' });
    expect(unitsFor(2)).toEqual({ units: 'mm', scale: 25.4, label: 'mm' });
    expect(unitsFor(3)).toEqual({ units: 'mm', scale: 25.4, label: 'cm' });
    expect(unitsFor(4)).toEqual({ units: 'm', scale: 0.0254, label: 'm' });
    expect(unitsFor(5)).toEqual({ units: 'inch', scale: 1, label: 'yd' });
    expect(unitsFor(undefined).label).toBe('inch');
    expect(unitsFor(9).label).toBe('inch');
  });
});

describe('카메라', () => {
  const persp: SkpCamera = { eye: [120, -150, 90], target: [20, 15, 10], up: [0, 0, 1], perspective: true, fov: 40, height: 99, twoPoint: false };
  it('원근: 위치는 × 배율, 시야각(도)은 그대로, 평행 높이는 버린다', () => {
    const c = cameraMeta(persp, 25.4)!;
    expect(c.eye).toEqual([120 * 25.4, -150 * 25.4, 90 * 25.4]);
    expect(c.target).toEqual([20 * 25.4, 15 * 25.4, 10 * 25.4]);
    expect(c.up).toEqual([0, 0, 1]);
    expect(c.perspective).toBe(true);
    expect(c.fovY).toBe(40);
    expect(c.height).toBeUndefined();
    expect(c.twoPoint).toBeUndefined();
  });
  it('평행: 화면 높이 × 배율, 종횡비·2점 투시', () => {
    const c = cameraMeta({ ...persp, perspective: false, height: 80, aspect: 1.5, twoPoint: true }, 0.0254)!;
    expect(c.perspective).toBe(false);
    expect(c.fovY).toBeUndefined();
    expect(c.height).toBeCloseTo(80 * 0.0254, 12);
    expect(c.aspect).toBe(1.5);
    expect(c.twoPoint).toBe(true);
  });
  it('눈 = 목표이거나 비유한이면 없다', () => {
    expect(cameraMeta({ ...persp, eye: [1, 2, 3], target: [1, 2, 3] }, 1)).toBeUndefined();
    expect(cameraMeta({ ...persp, eye: [NaN, 0, 0] }, 1)).toBeUndefined();
    expect(cameraMeta(undefined, 1)).toBeUndefined();
  });
});

describe('장면(페이지)', () => {
  const tags = [
    { id: 1, name: 'Layer0', visible: true, sceneHidden: false },
    { id: 17, name: 'Walls', visible: true, sceneHidden: false },
    { id: 19, name: 'Roof', visible: true, sceneHidden: false },
  ];
  const cam: SkpCamera = { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1], perspective: true, fov: 35, twoPoint: false };

  it('use 깃발이 켜진 칸만 적는다: 카메라·숨긴 태그·단면·숨긴 개체(노드)', () => {
    const m = model({
      tags,
      pages: [
        page({ name: 'All', description: '설명', flags: 0x0ff1, camera: cam, hiddenTags: [1, 2], sectionIds: [500, 999], hiddenIds: [11, 404] }),
        page({ name: '카메라 없음', flags: 0x002 | 0x020, camera: cam, hiddenTags: [] }),
      ],
      activePage: 1,
    });
    const { pages, activePage } = pagesMeta(m, 2, { nodePids: [11, 12, 11, undefined], sectionPids: [undefined, 500, 500] });
    expect(activePage).toBe(1);
    expect(pages[0]!.name).toBe('All');
    expect(pages[0]!.description).toBe('설명');
    expect(pages[0]!.camera!.eye).toEqual([0, -20, 10]);
    expect(pages[0]!.hiddenTags).toEqual(['Walls', 'Roof']);
    // 단면 번호 하나 = 그 단면이 든 정의의 모든 배치, 못 찾은 번호는 버린다
    expect(pages[0]!.sectionPlanes).toEqual([1, 2]);
    // 정의 안 인스턴스 하나를 숨기면 그 정의가 놓인 모든 자리의 노드
    expect(pages[0]!.hiddenNodes).toEqual([0, 2]);
    expect(pages[1]!.camera).toBeUndefined();
    expect(pages[1]!.hiddenTags).toEqual([]);
    expect(pages[1]!.hiddenNodes).toBeUndefined();
    expect(pages[1]!.sectionPlanes).toBeUndefined();
    expect(pages[1]!.description).toBeUndefined();
  });

  it('나무가 없으면 숨긴 개체를 노드로 바꾸지 않는다, 활성 장면이 범위 밖이면 없다', () => {
    const m = model({ pages: [page({ flags: 0x100, hiddenIds: [5] })], activePage: 3 });
    const r = pagesMeta(m, 1);
    expect(r.pages[0]!.hiddenNodes).toBeUndefined();
    expect(r.activePage).toBeUndefined();
    expect(pagesMeta(model(), 1).pages).toEqual([]);
  });

  it('전환·지연 시간: 장면 값 → 없으면 모형 기본, 상한에서 자르고 전환을 끈 모형은 0초', () => {
    const m = model({
      pages: [page({ transition: 2, delay: 5000 }), page({}), page({ transition: -1 })],
      animation: { transitionTime: 1.5, sceneDelay: 1 },
    });
    const p = pagesMeta(m, 1).pages;
    expect([p[0]!.transition, p[0]!.delay]).toEqual([2, 3600]);
    expect([p[1]!.transition, p[1]!.delay]).toEqual([1.5, 1]);
    expect(p[2]!.transition).toBe(1.5);
    const off = pagesMeta(model({ pages: [page({ transition: 2 })], animation: { showTransition: false } }), 1).pages;
    expect(off[0]!.transition).toBe(0);
    expect(pagesMeta(model({ pages: [page({})] }), 1).pages[0]!.transition).toBeUndefined();
  });

  it('스타일을 기억하는 장면(0x2)만 그 렌더링 + style.xml로 스타일을 푼다', () => {
    const styles = new Map([['Scene style', new Map([[2002, '-1']])]]);
    const rendering = { values: new Map<number, Uint8Array>(), styleName: 'Scene style' };
    const m = model({ pages: [page({ flags: 0x2, rendering }), page({ flags: 0, rendering }), page({ flags: 0x2, thumbnail: 'scene_thumbnails/x.png' })] });
    const p = pagesMeta(m, 1, { styles }).pages;
    expect(p[0]!.style!.front).toEqual([1, 1, 1]);
    expect(p[0]!.style!.name).toBe('Scene style');
    expect(p[1]!.style).toBeUndefined();
    expect(p[2]!.style).toBeUndefined();
    expect(p[2]!.thumbnail).toBe('scene_thumbnails/x.png');
    expect(styleFor(undefined, styles)).toBeUndefined();
  });
});

describe('속성 사전', () => {
  it('형 있는 값을 화면용 글·수로 푼다(길이·점은 장면 단위)', () => {
    expect(attrValueMeta(null)).toBeNull();
    expect(attrValueMeta(true)).toBe(true);
    expect(attrValueMeta(42)).toBe(42);
    expect(attrValueMeta('한글 text')).toBe('한글 text');
    expect(attrValueMeta([1, 2.5, 'three', [true, false]])).toBe('[1, 2.5, "three", [true, false]]');
    expect(attrValueMeta({ kind: 'color', rgba: [10, 20, 30, 255] })).toBe('rgba(10, 20, 30, 255)');
    expect(attrValueMeta({ kind: 'time', epoch: 1760000000 })).toBe('2025-10-09T08:53:20Z');
    expect(attrValueMeta({ kind: 'length', inch: 2 }, 25.4)).toBeCloseTo(50.8, 12);
    expect(attrValueMeta({ kind: 'point', xyz: [1, 2, 3] }, 10)).toBe('(10, 20, 30)');
    expect(attrValueMeta({ kind: 'vector', xyz: [1, -2, 0.5] }, 10)).toBe('(1, -2, 0.5)');
  });

  it('모음은 같은 내용을 한 번만 넣고, 빈 사전은 -1', () => {
    const pool = new AttrPool();
    const a = { d: { k: 1 } };
    expect(pool.add(a)).toBe(0);
    expect(pool.add(a)).toBe(0);
    expect(pool.add({ d: { k: 1 } })).toBe(0);
    expect(pool.add({ d: { k: 2 } })).toBe(1);
    expect(pool.add({})).toBe(-1);
    expect(pool.add(undefined)).toBe(-1);
    expect(pool.list).toEqual([{ d: { k: 1 } }, { d: { k: 2 } }]);
  });
});
