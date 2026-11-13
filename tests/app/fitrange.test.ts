/**
 * 화면 맞춤 범위와 주석(73차 → 76차 코어 0.65.0): 해석기 장면은 fitRange 'visible'이라 코어가 숨김과 상관없이 보이는 묶음(형상·치수선·지시선·단면 기호) 범위의 합으로
 * 화면을 맞춘다(SketchUp 도움말 Zoom Extents: 모형 전체가 보이게). 72차까지는 숨김이 없으면 장면 범위(형상만)로 맞춰 치수선·단면 기호가 빠지고, 안쪽 배치 하나만 숨겨도
 * 들어가 맞춤 거리가 달라졌다. 73~75차는 앱이 어떤 묶음도 쓰지 않는 그룹을 늘 숨겨(FIT_GROUP 우회) 같은 범위를 얻었다 — 76차에 걷고 이 규칙으로 바꿨다.
 * 장면 범위(Scene3d.bounds — 형상만)·격자·단면 범위는 그대로다(장면 범위에 주석을 넣으면 격자가 단면 기호 아래 끝으로 내려가고 단면 평면 크기·위치 범위가 바뀌었다).
 * 76차: 보조선·보조점 묶음은 맞춤에서 뺀다(fit: false — 73~75차는 넣었다). 끝없는 보조선은 해석기가 형상 범위의 10% 여유까지 잘라 그려 그 여유가 맞춤을 넓혔다.
 * 그리기·가까운·먼 면(보이는 범위)에는 그대로 들고, 맞출 다른 묶음이 보이지 않으면 코어가 보이는 범위(보조 포함)로 맞춘다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import type { CameraState } from 'opencad-viewer3d/camera';
import type { Box3, Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { installDom } from '../fakegl/fakedom';
import { mfcFile, move13, squareEntities, type MfcLinearDimSpec, type MfcSpec } from '../mfcwrite';

const dim = (y: number): MfcLinearDimSpec => ({ start: [0, y, 0], end: [10, y, 0], normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, distance: -4 });

/** 뿌리: 판 하나, 판 배치 넷(x 20·40·60·80 — 가운데 둘이 안쪽), 단면 하나(x = 50 — 기호는 그 범위에 맞춘 크기), 치수 하나, 숨긴 보조선 하나(y = 500) */
function spec(): MfcSpec {
  return {
    schemas: 'v15',
    definitions: [{ name: '판', entities: squareEntities() }],
    root: squareEntities({
      instances: [20, 40, 60, 80].map((x, i) => ({ def: 0, xform: move13(x, 0, 0), name: `판 ${i + 1}` })),
      linearDims: [dim(-30)],
      sections: [{ plane: [1, 0, 0, -50] }],
      guides: [{ kind: 'line', point: [0, 500, 0], dir: [1, 0, 0], range: [0, 10], hidden: true }],
    }),
  };
}

type Meta = { extraItems?: { hidden?: string[] }; outline?: { name: string; ids: string[] }[] };
const metaOf = (s: Scene3d): Meta => s.meta as Meta;
/** 뷰어 안쪽(시험이 견주는 값만) */
type Inner = { visVer: number; hiddenGroups: Set<string>; grid: unknown; visibleBox(): Box3 };
const at = (v: Viewer3d): Inner => v as unknown as Inner;

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

/** 앱처럼: 장면을 올리고 해석기가 따로 묶은 숨긴 묶음(extraItems.hidden)은 숨긴다 */
function view(s: Scene3d): Viewer3d {
  const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, viewCube: false, grid: false });
  views.push(v);
  v.setScene(s);
  for (const id of metaOf(s).extraItems?.hidden ?? []) v.setItemVisible(id, false);
  v.setView('seIso', false);
  return v;
}
/** 맞춤 규칙·맞춤 빼기 표시가 없는 장면(73~75차 해석기와 같은 꼴) */
function scene73(s: Scene3d): Scene3d {
  const old: Scene3d = { ...s, lines: s.lines.map(({ fit: _f, ...l }) => l) };
  if (s.points) old.points = s.points.map(({ fit: _f, ...p }) => p);
  delete old.fitRange;
  return old;
}
/** 73~75차 길: 맞춤 규칙 표시가 없는 장면(0.64.0 기본)에서 어떤 묶음도 쓰지 않는 그룹을 늘 숨겨 둔다 */
const FIT_GROUP_73 = '\u0000fit';
function view73(s: Scene3d): Viewer3d {
  const v = view(scene73(s));
  v.setGroupVisible(FIT_GROUP_73, false);
  return v;
}
const fitCam = (v: Viewer3d): CameraState => (v.fit(false), v.getCamera());
const close = (a: CameraState, b: CameraState): void => {
  expect(a.distance).toBeCloseTo(b.distance, 6);
  for (let k = 0; k < 3; k++) expect(a.target[k]!).toBeCloseTo(b.target[k]!, 6);
};
const sameBox = (a: Box3, b: Box3): void => expect([...a.min, ...a.max]).toEqual([...b.min, ...b.max]);

describe('화면 맞춤 범위와 주석', () => {
  it('장면 범위는 형상만 그대로(격자·단면 범위 — 72차와 같음)이고 맞춤 규칙은 보이는 묶음(fitRange visible)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true, extras: true });
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [90, 10, 0] });
    expect(s.fitRange).toBe('visible');
  });

  it('코어 뷰어: 숨김 없음·안쪽 배치 숨김의 맞춤이 같고 73~75차 길(빈 그룹을 늘 숨김)과 같은 범위, 72차 길(장면 범위)은 숨김 하나로 달라진다', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const inner = metaOf(s).outline!.find((o) => o.name === '판 2')!.ids;
    expect(inner.length).toBeGreaterThan(0);
    // 72차 길(맞춤 규칙 표시 없음): 아무것도 숨기지 않으면 장면 범위(형상만)
    const s72: Scene3d = { ...s };
    delete s72.fitRange;
    const old = view(s72);
    const oldAll = fitCam(old);
    for (const id of inner) old.setItemVisible(id, false);
    const oldSome = fitCam(old);
    expect(oldSome.distance).toBeGreaterThan(oldAll.distance * 1.2);
    // 73~75차 길
    const v73 = view73(s);
    const want = fitCam(v73);
    // 76차: 숨긴 그룹 없이 같은 범위
    const v = view(s);
    expect(at(v).hiddenGroups.size).toBe(0);
    const grid0 = JSON.stringify(at(v).grid);
    const all = fitCam(v);
    sameBox(v.fitBounds, v73.fitBounds);
    close(all, want);
    for (const id of inner) v.setItemVisible(id, false);
    const some = fitCam(v);
    close(some, all);
    // 숨김이 있던 72차 맞춤(보이는 묶음 합)과도 같다 — 치수선·단면 기호가 든다
    close(all, oldSome);
    // 격자(장면 범위)는 그대로이고 73~75차 길과 같다
    expect(JSON.stringify(at(v).grid)).toBe(grid0);
    expect(JSON.stringify(at(v73).grid)).toBe(grid0);
    // 보이는 범위(가까운·먼 면 등)도 73~75차 길과 같다
    sameBox(at(v).visibleBox(), at(v73).visibleBox());
  });

  it('장면을 올릴 때·장면을 고를 때·모두 보이기·다시 올리기에서 숨긴 그룹 없이 맞춤은 보이는 묶음 범위(73~75차와 같음)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const inner = [...new Set(metaOf(s).outline!.find((o) => o.name === '판 2')!.ids)];
    const ids = [...s.meshes, ...s.lines, ...(s.points ?? [])].map((x) => x.id);
    // 기준: 73~75차 길의 맞춤(안쪽 배치는 범위를 바꾸지 않는다)
    const ref = view73(s);
    const want = fitCam(ref);
    const wantBox = ref.fitBounds;
    // 앱처럼 상태를 모두 다시 부르기(app.ts applyTagVisibility·refreshItemVisibility — 상태가 같은 항목·묶음도 부른다)
    const hidden = new Set<string>();
    const refresh = (v: Viewer3d): void => {
      for (const g of v.groups()) v.setGroupVisible(g.name, g.visible);
      for (const id of ids) v.setItemVisible(id, !hidden.has(id));
    };
    const check = (v: Viewer3d): void => {
      expect(at(v).hiddenGroups.size).toBe(0);
      sameBox(v.fitBounds, wantBox);
      close(fitCam(v), want);
    };
    const v = view(s);
    // 장면을 올릴 때: 모두 보이는 상태에 보이기는 판을 올리지 않는다(73~75차는 빈 그룹 숨기기로 판이 하나 올랐다)
    const ver0 = at(v).visVer;
    refresh(v);
    expect(at(v).visVer).toBe(ver0);
    check(v);
    // 장면을 고를 때(안쪽 배치를 숨기는 장면): 바뀐 항목만 판을 올린다
    for (const id of inner) hidden.add(id);
    refresh(v);
    expect(at(v).visVer).toBe(ver0 + inner.length);
    check(v);
    // 모두 보이기와 한 번 더
    hidden.clear();
    refresh(v);
    const ver1 = at(v).visVer;
    expect(ver1).toBe(ver0 + 2 * inner.length);
    check(v);
    refresh(v);
    expect(at(v).visVer).toBe(ver1);
    check(v);
    // 다시 올리기: 앱이 따로 숨길 것이 없다
    v.setScene(s);
    v.setView('seIso', false);
    refresh(v);
    check(v);
  });

  it('숨긴 묶음은 맞춤에 들지 않는다(숨긴 보조선 y = 500)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true, extras: true });
    const hidden = metaOf(s).extraItems?.hidden ?? [];
    expect(hidden.length).toBeGreaterThan(0);
    const v = view(s);
    const c = fitCam(v);
    // 보이는 묶음(형상 y 0~10, 치수선 y −30쪽, 단면 기호)의 가운데 — 숨긴 보조선까지 들면 y 가운데가 200을 넘는다
    expect(c.target[1]).toBeLessThan(100);
    expect(v.fitBounds.max[1]).toBeLessThan(100);
  });
});

/** 뿌리: 판 하나(0~10), 치수 하나(y −30쪽), 보이는 보조 셋 — 판을 지나는 끝없는 선(y = 5), 끝 있는 선(y = 300, x 0~10), 보조점(y = −400) */
function guideSpec(withFaces = true): MfcSpec {
  const guides: MfcSpec['root'] = {
    guides: [
      { kind: 'line', point: [0, 5, 0], dir: [1, 0, 0] },
      { kind: 'line', point: [0, 300, 0], dir: [1, 0, 0], range: [0, 10] },
      { kind: 'point', point: [5, -400, 0] },
    ],
  };
  return { schemas: 'v15', root: withFaces ? squareEntities({ linearDims: [dim(-30)], ...guides }) : guides };
}
type Item = { id: string; fit?: boolean; positions: ArrayLike<number> };
const guideIdsOf = (s: Scene3d): string[] => (s.meta as { annotationItems?: { guides: string[] } }).annotationItems?.guides ?? [];

describe('보조선·보조점은 화면 맞춤에서 뺀다(76차)', () => {
  it('해석기: 보조선·보조점 묶음만 fit: false(형상·치수선은 표시 없음)', () => {
    const s = skpToScene(mfcFile(guideSpec()), { outline: true });
    const guides = new Set(guideIdsOf(s));
    expect(guides.size).toBeGreaterThanOrEqual(2);
    const all: Item[] = [...s.meshes, ...s.lines, ...(s.points ?? [])];
    for (const it of all) expect(it.fit).toBe(guides.has(it.id) ? false : undefined);
    expect((s.points ?? []).length).toBe(1);
    expect(s.points![0]!.fit).toBe(false);
  });

  it('맞춤 범위는 보조를 뺀 보이는 묶음 합(숨김과 상관없이), 보이는 범위에는 들고, 73~75차 길은 보조까지 넣었다', () => {
    const s = skpToScene(mfcFile(guideSpec()), { outline: true });
    const guides = new Set(guideIdsOf(s));
    // 보조를 아예 뺀 장면의 맞춤 범위와 같다
    const bare: Scene3d = { ...s, lines: s.lines.filter((l) => !guides.has(l.id)) };
    delete bare.points;
    const ref = view(bare);
    const v = view(s);
    sameBox(v.fitBounds, ref.fitBounds);
    close(fitCam(v), fitCam(ref));
    expect(v.fitBounds.min[1]).toBeGreaterThan(-100);
    expect(v.fitBounds.max[1]).toBeLessThan(100);
    // 끝없는 보조선을 자른 여유(형상 범위 대각선의 10%)도 맞춤을 넓히지 않는다: x는 형상·치수선 범위 그대로
    expect(v.fitBounds.min[0]).toBeGreaterThanOrEqual(-1e-6);
    expect(v.fitBounds.max[0]).toBeLessThanOrEqual(10 + 1e-6);
    // 보이는 범위(가까운·먼 면·그림자)에는 보조가 든다
    const vis = at(v).visibleBox();
    expect(vis.min[1]).toBeLessThanOrEqual(-400);
    expect(vis.max[1]).toBeGreaterThanOrEqual(300);
    // 보조 하나를 숨겨도 맞춤은 같다
    const pointId = s.points![0]!.id;
    v.setItemVisible(pointId, false);
    sameBox(v.fitBounds, ref.fitBounds);
    v.setItemVisible(pointId, true);
    // 73~75차 길: 보조까지 넣어 맞춤이 멀었다(이 차수 결정이 바꾼 칸)
    const v73 = view73(s);
    expect(v73.fitBounds.min[1]).toBeLessThanOrEqual(-400);
    expect(v73.fitBounds.max[1]).toBeGreaterThanOrEqual(300);
    expect(fitCam(v73).distance).toBeGreaterThan(fitCam(v).distance * 5);
    // 격자(장면 범위 — 형상만)는 같다
    expect(JSON.stringify(at(v).grid)).toBe(JSON.stringify(at(v73).grid));
  });

  it('고른 보조는 fitItems로 맞춰 본다', () => {
    const s = skpToScene(mfcFile(guideSpec()), { outline: true });
    const v = view(s);
    void v.fitItems([s.points![0]!.id], false);
    const c = v.getCamera();
    expect(c.target[0]).toBeCloseTo(5, 6);
    expect(c.target[1]).toBeCloseTo(-400, 6);
  });

  it('맞출 다른 묶음이 보이지 않으면(보조만 있는 파일·형상과 치수를 모두 숨김) 보이는 범위(보조 포함)로 맞춘다', () => {
    // 보조만 있는 파일: 장면 범위 없음, 맞춤 범위 = 보이는 범위
    const only = skpToScene(mfcFile(guideSpec(false)), { outline: true });
    expect(only.bounds).toBeUndefined();
    expect(only.meshes.length).toBe(0);
    const g = view(only);
    sameBox(g.fitBounds, at(g).visibleBox());
    expect(g.fitBounds.min[1]).toBeLessThanOrEqual(-400);
    expect(g.fitBounds.max[1]).toBeGreaterThanOrEqual(300);
    expect(Number.isFinite(fitCam(g).distance)).toBe(true);
    // 형상·치수선을 모두 숨긴 때
    const s = skpToScene(mfcFile(guideSpec()), { outline: true });
    const guides = new Set(guideIdsOf(s));
    const v = view(s);
    for (const it of [...s.meshes, ...s.lines]) if (!guides.has(it.id)) v.setItemVisible(it.id, false);
    sameBox(v.fitBounds, at(v).visibleBox());
    expect(v.fitBounds.min[1]).toBeLessThanOrEqual(-400);
  });
});
