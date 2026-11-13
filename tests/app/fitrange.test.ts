/**
 * 화면 맞춤 범위와 주석(73차): 코어 뷰어는 아무것도 숨기지 않았을 때만 장면 범위(Scene3d.bounds — 해석기가 형상만 넣는다)로, 무엇이든 숨기면 보이는 묶음 범위를 합쳐
 * 화면을 맞춘다. 72차까지는 숨김이 없으면 치수선·단면 기호가 빠지고, 안쪽 배치 하나만 숨겨도 들어가 맞춤 거리가 달라졌다(71차 합성 파일 두 배 넘게).
 * 앱은 어떤 묶음도 쓰지 않는 그룹(FIT_GROUP)을 늘 숨겨 두어 숨김 여부와 상관없이 보이는 묶음(형상·주석) 범위로 맞춘다(SketchUp 도움말 Zoom Extents: 모형 전체가 보이게).
 * 장면 범위·격자·단면 범위는 그대로다(장면 범위에 주석을 넣으면 격자가 단면 기호 아래 끝으로 내려가고 단면 평면 크기·위치 범위가 바뀌었다).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import type { CameraState } from 'opencad-viewer3d/camera';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { FIT_GROUP } from '../../src/app/view';
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
const fitCam = (v: Viewer3d): CameraState => (v.fit(false), v.getCamera());
/** 앱이 장면을 올린 뒤 하는 것(app.ts — 어떤 묶음도 쓰지 않는 그룹을 숨김) */
const keepFitVisible = (v: Viewer3d): void => v.setGroupVisible(FIT_GROUP, false);
const close = (a: CameraState, b: CameraState): void => {
  expect(a.distance).toBeCloseTo(b.distance, 6);
  for (let k = 0; k < 3; k++) expect(a.target[k]!).toBeCloseTo(b.target[k]!, 6);
};

describe('화면 맞춤 범위와 주석', () => {
  it('장면 범위는 형상만 그대로(격자·단면 범위 — 72차와 같음)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true, extras: true });
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [90, 10, 0] });
  });

  it('코어 뷰어: 숨김이 없을 때(72차) 맞춤은 형상만이라 안쪽 배치 하나를 숨기면 달라지고, FIT_GROUP을 숨겨 두면 둘 다 보이는 묶음 범위로 같다', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const inner = metaOf(s).outline!.find((o) => o.name === '판 2')!.ids;
    expect(inner.length).toBeGreaterThan(0);
    // 72차 길: 아무것도 숨기지 않으면 장면 범위(형상만)
    const old = view(s);
    const oldAll = fitCam(old);
    for (const id of inner) old.setItemVisible(id, false);
    const oldSome = fitCam(old);
    expect(oldSome.distance).toBeGreaterThan(oldAll.distance * 1.2);
    // 73차 길
    const v = view(s);
    const grid0 = JSON.stringify((v as unknown as { grid: unknown }).grid);
    keepFitVisible(v);
    const all = fitCam(v);
    for (const id of inner) v.setItemVisible(id, false);
    const some = fitCam(v);
    close(some, all);
    // 숨김이 있던 72차 맞춤(보이는 묶음 합)과도 같다 — 치수선·단면 기호가 든다
    close(all, oldSome);
    // 빈 그룹은 묶음 목록에 없고, 격자(장면 범위)는 그대로
    expect(v.groups().some((g) => g.name === FIT_GROUP)).toBe(false);
    expect(JSON.stringify((v as unknown as { grid: unknown }).grid)).toBe(grid0);
  });

  it('코어 0.64.0(같은 값 보이기 호출은 아무것도 하지 않음): 장면을 올릴 때·장면을 고를 때·모두 보이기 뒤에도 FIT_GROUP은 숨은 채이고 맞춤은 보이는 묶음 범위', () => {
    type Inner = { visVer: number; hiddenGroups: Set<string> };
    const at = (v: Viewer3d): Inner => v as unknown as Inner;
    const s = skpToScene(mfcFile(spec()), { outline: true });
    const inner = [...new Set(metaOf(s).outline!.find((o) => o.name === '판 2')!.ids)];
    const ids = [...s.meshes, ...s.lines, ...(s.points ?? [])].map((x) => x.id);
    // 기준: 숨김이 있을 때의 맞춤(보이는 묶음 합 — 안쪽 배치는 범위를 바꾸지 않는다)
    const ref = view(s);
    for (const id of inner) ref.setItemVisible(id, false);
    const want = fitCam(ref);
    // 앱처럼 상태를 모두 다시 부르기(app.ts applyTagVisibility·refreshItemVisibility — 상태가 같은 항목·묶음도 부른다)
    const hidden = new Set<string>();
    const refresh = (v: Viewer3d): void => {
      for (const g of v.groups()) v.setGroupVisible(g.name, g.visible);
      for (const id of ids) v.setItemVisible(id, !hidden.has(id));
    };
    const v = view(s);
    // 장면을 올릴 때: 모두 보이는 상태에 보이기는 판을 올리지 않고, FIT_GROUP 숨기기는 바뀐 것이라 판이 하나 오른다
    const ver0 = at(v).visVer;
    refresh(v);
    expect(at(v).visVer).toBe(ver0);
    keepFitVisible(v);
    expect(at(v).visVer).toBe(ver0 + 1);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(true);
    close(fitCam(v), want);
    // 같은 값을 다시(FIT_GROUP 숨기기·모든 항목): 판도 숨김도 그대로
    const ver1 = at(v).visVer;
    keepFitVisible(v);
    refresh(v);
    expect(at(v).visVer).toBe(ver1);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(true);
    close(fitCam(v), want);
    // 장면을 고를 때(안쪽 배치를 숨기는 장면): 바뀐 항목만 판을 올린다
    for (const id of inner) hidden.add(id);
    refresh(v);
    expect(at(v).visVer).toBe(ver1 + inner.length);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(true);
    close(fitCam(v), want);
    // 모두 보이기와 한 번 더
    hidden.clear();
    refresh(v);
    const ver2 = at(v).visVer;
    expect(ver2).toBe(ver1 + 2 * inner.length);
    close(fitCam(v), want);
    refresh(v);
    expect(at(v).visVer).toBe(ver2);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(true);
    close(fitCam(v), want);
    // 다시 올리기: setScene이 숨긴 그룹을 비우므로 앱은 올릴 때마다 FIT_GROUP을 다시 숨긴다
    v.setScene(s);
    v.setView('seIso', false);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(false);
    refresh(v);
    keepFitVisible(v);
    expect(at(v).hiddenGroups.has(FIT_GROUP)).toBe(true);
    close(fitCam(v), want);
  });

  it('숨긴 묶음은 맞춤에 들지 않는다(숨긴 보조선 y = 500)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true, extras: true });
    const hidden = metaOf(s).extraItems?.hidden ?? [];
    expect(hidden.length).toBeGreaterThan(0);
    const v = view(s);
    keepFitVisible(v);
    const c = fitCam(v);
    // 보이는 묶음(형상 y 0~10, 치수선 y −30쪽, 단면 기호)의 가운데 — 숨긴 보조선까지 들면 y 가운데가 200을 넘는다
    expect(c.target[1]).toBeLessThan(100);
  });
});
