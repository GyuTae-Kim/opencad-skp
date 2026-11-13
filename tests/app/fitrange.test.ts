/**
 * 화면 맞춤 범위와 주석(73차): 코어 뷰어는 아무것도 숨기지 않으면 장면 범위(Scene3d.bounds)로, 하나라도 숨기면 보이는 묶음 범위를 합쳐 화면을 맞춘다.
 * 72차까지 해석기 장면 범위는 형상만이라, 숨김이 없으면 치수선·단면 기호가 빠지고 안쪽 배치 하나만 숨겨도 들어가 맞춤 거리가 달라졌다(71차 합성 파일 751.6 → 1,587.5).
 * 이제 장면 범위는 보이게 그리는 형상과 주석 묶음(숨긴 형상·숨긴 주석 빼고)이라 두 길이 같은 규칙이다(SketchUp 도움말 Zoom Extents: 모형 전체가 보이게).
 * 정보 탭의 모형 크기는 형상만 범위(meta.modelBounds — 주석이 넓혔을 때만)다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import { sceneBounds } from 'opencad-viewer3d/bounds';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import type { SkpMetaExtras } from '../../src/meta';
import { modelBox } from '../../src/app/infotab';
import { installDom } from '../fakegl/fakedom';
import { mfcFile, move13, squareEntities, type MfcLinearDimSpec, type MfcSpec } from '../mfcwrite';

const dim = (y: number): MfcLinearDimSpec => ({ start: [0, y, 0], end: [10, y, 0], normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, distance: -4 });

/** 뿌리: 판 하나, 판 배치 넷(x 20·40·60·80 — 가운데 둘이 안쪽), 단면 하나(x = 50 — 기호는 그 범위에 맞춘 크기), 치수 하나, (guide) 보조선 하나(끝 있음)·숨긴 보조선 하나 */
function spec(o: { guide?: boolean } = {}): MfcSpec {
  return {
    schemas: 'v15',
    definitions: [{ name: '판', entities: squareEntities() }],
    root: squareEntities({
      instances: [20, 40, 60, 80].map((x, i) => ({ def: 0, xform: move13(x, 0, 0), name: `판 ${i + 1}` })),
      linearDims: [dim(-30)],
      sections: [{ plane: [1, 0, 0, -50] }],
      guides: o.guide
        ? [
            { kind: 'line', point: [0, 0, 0], dir: [0, 0, 1], range: [0, 300] },
            { kind: 'line', point: [0, 500, 0], dir: [1, 0, 0], range: [0, 10], hidden: true },
          ]
        : [],
    }),
  };
}

type Meta = SkpMetaExtras & { extraItems?: { hidden?: string[] }; outline?: { name: string; ids: string[] }[] };
const metaOf = (s: Scene3d): Meta => s.meta as Meta;
const hiddenOf = (s: Scene3d): Set<string> => new Set(metaOf(s).extraItems?.hidden ?? []);

let dom: ReturnType<typeof installDom>;
const views: Viewer3d[] = [];
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  for (const v of views) v.dispose();
  views.length = 0;
  dom.restore();
});

describe('화면 맞춤 범위와 주석', () => {
  it('장면 범위 = 보이게 그리는 형상과 주석 묶음(숨긴 주석 묶음 뺌) — 코어 itemBounds 합과 같고, 형상만 범위는 meta.modelBounds', () => {
    const s = skpToScene(mfcFile(spec({ guide: true })), { outline: true, extras: true });
    const m = metaOf(s);
    const hidden = hiddenOf(s);
    // 숨긴 보조선 묶음이 있다(보이지 않는 묶음은 범위에 넣지 않는다)
    expect(m.annotationItems!.guides.filter((id) => hidden.has(id)).length).toBe(1);
    // 형상(판 다섯: x 0~90, y 0~10)
    expect(m.modelBounds).toEqual({ min: [0, 0, 0], max: [90, 10, 0] });
    // 장면 범위 = 숨긴 묶음을 뺀 모든 묶음의 코어 범위 합(형상은 float64로 센 값이라 가깝게)
    const vis = sceneBounds(s, (it) => !hidden.has(it.id));
    for (let k = 0; k < 3; k++) {
      expect(s.bounds!.min[k]).toBeCloseTo(vis.min[k]!, 9);
      expect(s.bounds!.max[k]).toBeCloseTo(vis.max[k]!, 9);
    }
    // 단면 기호(x = 50 평면, 형상 범위에 맞춘 크기)·치수선(y = −30 쪽)·보조선(z 0~300)이 넓혔다
    expect(s.bounds!.min[1]).toBeLessThan(-30);
    expect(s.bounds!.max[2]).toBe(300);
    expect(s.bounds!.min[2]).toBeLessThan(0);
    // 숨긴 보조선(y = 500)은 들지 않는다
    expect(s.bounds!.max[1]).toBeLessThan(500);
    // 정보 탭 모형 크기는 형상만
    expect(modelBox(s)).toEqual({ min: [0, 0, 0], max: [90, 10, 0] });
  });

  it('주석이 범위를 넓히지 않으면 meta.modelBounds가 없고 정보 탭은 장면 범위', () => {
    const s = skpToScene(mfcFile({ schemas: 'v15', root: squareEntities({ linearDims: [{ ...dim(5), distance: 2 }] }) }), { outline: true });
    expect(metaOf(s).modelBounds).toBeUndefined();
    expect(modelBox(s)).toBe(s.bounds);
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
  });

  it('코어 뷰어: 아무것도 숨기지 않을 때와 안쪽 배치 하나만 숨길 때 화면 맞춤이 같다(주석이 둘 다 든다)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, viewCube: false, grid: false });
    views.push(v);
    v.setScene(s);
    v.setView('seIso', false);
    v.fit(false);
    const all = v.getCamera();
    // 안쪽 배치(x = 40) 그물만 숨긴다(모형 바로 아래 항목마다 나눈 그물 — outline)
    const inner = metaOf(s).outline?.find((o) => o.name === '판 2');
    expect(inner?.ids.length).toBeGreaterThan(0);
    for (const id of inner!.ids) v.setItemVisible(id, false);
    v.fit(false);
    const some = v.getCamera();
    expect(some.distance).toBeCloseTo(all.distance, 6);
    for (let k = 0; k < 3; k++) expect(some.target[k]!).toBeCloseTo(all.target[k]!, 6);
    // 맞춘 범위는 형상만보다 크다(단면 기호·치수선이 든다)
    const geo = sceneBounds({ ...s, meshes: s.meshes, lines: s.lines.filter((l) => !Object.values(metaOf(s).annotationItems!).flat().includes(l.id)), points: [] });
    const r = (b: { min: readonly number[]; max: readonly number[] }): number => Math.hypot(b.max[0]! - b.min[0]!, b.max[1]! - b.min[1]!, b.max[2]! - b.min[2]!);
    expect(r(s.bounds!)).toBeGreaterThan(r(geo) * 1.2);
  });
});
