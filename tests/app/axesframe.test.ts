/**
 * 그리기 축 자리의 격자 축선(107차 — 코어 0.101.0 setAxesFrame): SketchUp은 빨강·초록 축선을 옮기거나 돌린 그리기 축 자리에 그린다.
 * 코어는 0.100.0까지 격자 X·Y축선을 늘 세계 원점에 그렸고 축 틀을 주는 길이 없었다. 앱은 지금 그리기 축(doc.drawAxes — 파일의 축, 축을 기억하는 장면을 고르면
 * 그 장면의 축, null = 기본 축)이 정해질 때마다 코어에 그 틀을 준다: 문서를 열 때(setDoc — showDrawAxes), 장면을 고를 때(applyPage — applyScene).
 * 기본 축이면 null(세계 원점·세계 축 — 앞 문서의 틀을 거둔다). 축 원점은 해석기가 장면 좌표(형상 정점과 같은 단위·변환)로 넘긴다.
 * 시험은 실제 코어 뷰어를 가짜 DOM·가짜 WebGL2 위에 띄워 코어가 받은 틀(axesFrame)과 부른 수를 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d, type AxesFrame } from 'opencad-viewer3d';
import { applyScene, showDrawAxes } from '../../src/app/annotations';
import { createDoc, type SkpDoc } from '../../src/app/doc';
import { skpToScene } from '../../src/index';
import type { SkpAxesMeta, SkpMetaExtras } from '../../src/meta';
import { edge, entities, face, modelDat, skpFile, vertex } from '../build';
import { installDom } from '../fakegl/fakedom';
import { mfcFile, squareEntities } from '../mfcwrite';

/** 삼각형 하나 — 모서리 (10, 20, 0)인치(옮긴 축 MOVED의 원점)에서 x·y로 1인치 */
const tri = (): Uint8Array =>
  entities(undefined, {
    vertices: [vertex(1, 10, 20, 0), vertex(2, 11, 20, 0), vertex(3, 10, 21, 0)],
    edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
    faces: [
      face(
        7,
        [0, 0, 1, 0],
        [
          [
            [4, false],
            [5, false],
            [6, false],
          ],
        ],
      ),
    ],
  });

const DEFAULT = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
/** 원점만 삼각형 모서리로 옮긴 축(인치) */
const MOVED = [10, 20, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
/** 원점을 옮기고 빨강 = −Y, 초록 = −X(실제 2026 표본 장면 축과 같은 꼴 — 73차 시험) */
const TURNED = [30, 40, 0, 0, -1, 0, -1, 0, 0, 0, 0, 1];

/** 2021+ 장면 다섯: A(옮긴 축), B(축을 기억하지 않음), C(기본 축), D(돌린 축), E(A와 같은 값의 축 — 다른 객체) */
function file2021(lengthUnit = 2): Uint8Array {
  return skpFile(
    modelDat({
      root: tri(),
      lengthUnit,
      pages: {
        list: [
          { id: 60, name: 'A', flags: 0x8, axes: MOVED },
          { id: 61, name: 'B', flags: 0x1, camera: { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1] } },
          { id: 62, name: 'C', flags: 0x8, axes: DEFAULT },
          { id: 63, name: 'D', flags: 0x8, axes: TURNED },
          { id: 64, name: 'E', flags: 0x8, axes: MOVED },
        ],
      },
    }),
  );
}

const docOf = (bytes: Uint8Array, name = '축.skp'): SkpDoc => createDoc(name, 1, { scene: skpToScene(bytes, { outline: true }), ms: 1 });

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

/** 코어 뷰어(가짜 WebGL2) — setAxesFrame에 넘긴 값을 적는다 */
function viewer(): { v: Viewer3d; calls: (AxesFrame | null)[] } {
  const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, viewCube: false });
  views.push(v);
  const calls: (AxesFrame | null)[] = [];
  const set = v.setAxesFrame.bind(v);
  v.setAxesFrame = (f) => (calls.push(f), set(f));
  return { v, calls };
}

/** 앱 setDoc의 축 몫: 장면을 올린 뒤 그 문서의 그리기 축(파일의 축)을 코어에 준다 */
function open(v: Viewer3d, d: SkpDoc): void {
  v.setScene(d.scene);
  showDrawAxes(v, d.drawAxes);
}

const near = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 9);
};
/** 코어가 받은 틀이 그리기 축(원점·빨강·초록)과 같다 */
const frameIs = (v: Viewer3d, a: SkpAxesMeta): void => {
  const f = v.axesFrame;
  expect(f).not.toBeNull();
  near(f!.origin, a.origin);
  near(f!.x, a.x);
  near(f!.y, a.y);
};

describe('그리기 축 자리의 격자 축선(코어 setAxesFrame)', () => {
  it('해석기: 장면 축 원점은 형상 정점과 같은 장면 좌표(mm 모형 × 25.4, 인치 모형 그대로 — 옮기지 않음)', () => {
    for (const [unit, k] of [
      [2, 25.4],
      [0, 1],
    ] as const) {
      const s = skpToScene(file2021(unit), { outline: true });
      const axes = (s.meta as SkpMetaExtras).pages![0]!.axes!;
      near(axes.origin, [10 * k, 20 * k, 0]);
      // 삼각형 모서리 정점(파일 (10, 20, 0)인치)이 장면에서 축 원점과 같은 자리(묶음 원점이 있으면 더한 세계 자리)
      let best = Infinity;
      for (const m of s.meshes) {
        const o = m.origin ?? [0, 0, 0];
        const p = m.positions;
        for (let i = 0; i < p.length; i += 3) best = Math.min(best, Math.hypot(p[i]! + o[0]! - axes.origin[0], p[i + 1]! + o[1]! - axes.origin[1], p[i + 2]! + o[2]! - axes.origin[2]));
      }
      expect(best).toBeLessThan(1e-4 * k);
    }
  });

  it('문서 열기: 옮기고 돌린 파일 축이면 그 틀, 다음에 기본 축 문서를 열면 null(앞 문서의 틀을 거둠)', () => {
    const { v, calls } = viewer();
    // 2020 이하 모형 꼬리 축(CSketchCS): 원점 (1, 2, 3)인치, 빨강 = +Y, 초록 = −X
    const moved = docOf(mfcFile({ schemas: 'v20', root: squareEntities(), axes: [1, 2, 3, 0, 1, 0, -1, 0, 0, 0, 0, 1] }), '옮긴 축.skp');
    expect(moved.drawAxes).not.toBeNull();
    open(v, moved);
    frameIs(v, moved.drawAxes!);
    near(v.axesFrame!.origin, [1, 2, 3]);
    const plain = docOf(file2021(), '기본 축.skp');
    expect(plain.drawAxes).toBeNull();
    open(v, plain);
    expect(v.axesFrame).toBeNull();
    expect(calls).toEqual([moved.drawAxes, null]);
  });

  it('장면 탭: 축을 기억하는 장면만 새 틀로(기본 축 장면은 null), 기억하지 않는 장면·같은 값의 틀은 다시 부르지 않음', () => {
    const { v, calls } = viewer();
    const d = docOf(file2021());
    open(v, d);
    expect(v.axesFrame).toBeNull();
    // A: 옮긴 축(장면 단위 mm)
    applyScene(d, d.pages[0]!, 0, v);
    expect(d.drawAxes).toEqual({ origin: [254, 508, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect(d.axesPage).toBe(0);
    frameIs(v, d.drawAxes!);
    // B: 축을 기억하지 않음 — 문서·코어 틀 그대로
    applyScene(d, d.pages[1]!, 1, v);
    expect(d.axesPage).toBe(0);
    frameIs(v, { origin: [254, 508, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    // E: A와 같은 값(다른 객체) — 그 장면을 적지만 코어는 다시 부르지 않음(격자를 다시 만들지 않는다)
    const before = calls.length;
    applyScene(d, d.pages[4]!, 4, v);
    expect(d.axesPage).toBe(4);
    expect(calls.length).toBe(before);
    // D: 돌린 축
    applyScene(d, d.pages[3]!, 3, v);
    frameIs(v, { origin: [762, 1016, 0], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    // C: 기본 축을 기억하는 장면 — 세계 원점·세계 축
    applyScene(d, d.pages[2]!, 2, v);
    expect(d.drawAxes).toBeNull();
    expect(d.axesPage).toBe(2);
    expect(v.axesFrame).toBeNull();
    expect(calls).toEqual([null, d.pages[0]!.axes, d.pages[3]!.axes, null]);
  });

  it('장면 탭: 숨긴 노드도 전처럼 장면 목록 쪽으로(applySceneHidden 몫)', () => {
    const { v } = viewer();
    const d = docOf(file2021());
    open(v, d);
    d.hiddenNodes.add(5);
    d.hiddenNodes.add(-2);
    // 숨긴 개체를 기억하는 장면: 나무 노드를 비우고, 숨긴 형상을 기억하는 장면: 묶음 노드를 그 장면 것으로
    applyScene(d, { hiddenNodes: [], hiddenAnnotations: [1] }, 0, v);
    expect([...d.hiddenNodes]).toEqual([-3]);
    expect(v.axesFrame).toBeNull();
  });

  it('코어가 받지 않는 축(나란한 빨강·초록 같은 깨진 축)은 세계 축 — 앞 틀을 남기지 않음', () => {
    const { v, calls } = viewer();
    const d = docOf(file2021());
    open(v, d);
    applyScene(d, d.pages[0]!, 0, v);
    expect(v.axesFrame).not.toBeNull();
    const broken: SkpAxesMeta = { origin: [1, 2, 3], x: [1, 0, 0], y: [2, 0, 0], z: [0, 0, 1] };
    applyScene(d, { axes: broken }, 1, v);
    expect(d.drawAxes).toBe(broken);
    expect(v.axesFrame).toBeNull();
    expect(calls.slice(-2)).toEqual([broken, null]);
    // 다시 열 때도 같다
    showDrawAxes(v, { origin: [0, 0, 0], x: [0, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect(v.axesFrame).toBeNull();
  });
});
