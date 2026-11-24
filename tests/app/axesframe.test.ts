/**
 * 그리기 축 자리의 격자 축선(107차 — 코어 0.101.0 setAxesFrame): SketchUp은 빨강·초록 축선을 옮기거나 돌린 그리기 축 자리에 그린다.
 * 코어는 0.100.0까지 격자 X·Y축선을 늘 세계 원점에 그렸고 축 틀을 주는 길이 없었다. 앱은 지금 그리기 축(doc.drawAxes — 파일의 축, 축을 기억하는 장면을 고르면
 * 그 장면의 축, null = 기본 축)이 정해질 때마다 코어에 그 틀을 준다: 문서를 열 때(setDoc — showDrawAxes), 장면을 고를 때(applyPage — applyScene).
 * 기본 축이면 null(세계 원점·세계 축 — 앞 문서의 틀을 거둔다). 축 원점은 해석기가 장면 좌표(형상 정점과 같은 단위·변환)로 넘긴다.
 * 시험은 실제 코어 뷰어를 가짜 DOM·가짜 WebGL2 위에 띄워 코어가 받은 틀(axesFrame)과 부른 수를 본다.
 * 113차(코어 0.108.0 setAxesStyle): 같은 자리에서 축선 모양도 SketchUp처럼 — 원점 양의 쪽 실선·음의 쪽 점선·파랑 Z축선, 좌표축이 켜져 있으면 격자를 꺼도 축선만.
 * 좌표축 버튼(앱 toggleAxes — showAxes)이 왼쪽 아래 축 표시와 함께 격자 없는 축선(withoutGrid)을 켜고 끈다. 앱 클래스는 DOM·뷰어 전체를 만들어야 해 그 몫은 원문으로 본다.
 * 114차: 스타일의 축 보이기(style.axes — DisplaySketchAxes, 스타일 Modeling Settings의 Model Axes 칸)가 좌표축 상태를 정한다 — 문서를 열 때 문서 스타일(showDocAxes),
 * 장면을 고를 때 그 장면 스타일(applyScene — 스타일을 담지 않았거나 칸이 없는 장면은 그대로). 칸이 없는 파일은 켬.
 * 117차(코어 0.113.0 축선 모양 칸 hidden): 좌표축이 꺼져 있으면(버튼·스타일·장면) 격자가 보여도 장면 안 축선(X·Y·Z축선·음의 쪽 점선)이 없다 — SketchUp은 축을 숨기면 축선이 없다.
 * 좌표축이 켜져 있으면 113차 모양 그대로(hidden: false는 코어에 주지 않은 것과 같다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d, type AxesFrame, type AxesStyle } from 'opencad-viewer3d';
import { gridLines, gridSpec, type GridLines } from 'opencad-viewer3d/grid';
import { applyScene, showAxes, showDocAxes, showDrawAxes } from '../../src/app/annotations';
import { createDoc, type SkpDoc } from '../../src/app/doc';
import { skpToScene } from '../../src/index';
import type { SkpAxesMeta, SkpMetaExtras } from '../../src/meta';
import { parseStyleXml, resolveStyle } from '../../src/styles';
import { edge, entities, face, modelDat, rendering, skpFile, styleXml, u8, vertex } from '../build';
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

/** 장면을 올린 뒤 그 문서의 그리기 축(파일의 축)을 코어에 준다(앱 setDoc의 축 틀 몫 — 114차부터 setDoc은 축 보이기도 정하는 showDocAxes, 아래 openDoc) */
function open(v: Viewer3d, d: SkpDoc): void {
  v.setScene(d.scene);
  showDrawAxes(v, d.drawAxes);
}

/** 앱 setDoc의 축 몫(114차): 장면을 올린 뒤 문서 스타일의 축 보이기와 그리기 축 틀을 코어에 준다 */
function openDoc(v: Viewer3d, d: SkpDoc): void {
  v.setScene(d.scene);
  showDocAxes(v, d);
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

/**
 * 코어가 가진 SketchUp 축선 모양(getter axesStyle): 좌표축이 켜져 있으면 격자를 꺼도 축선만(113차), 꺼져 있으면 격자가 보여도 축선 없음(117차 — 코어 0.113.0 hidden).
 * 코어 getter는 hidden을 켰을 때만 그 칸이 있다(켜지 않은 모양은 113차 세 칸 그대로)
 */
const SKETCHUP = (on: boolean): AxesStyle =>
  on ? { negativeDashed: true, z: true, withoutGrid: true } : { negativeDashed: true, z: true, withoutGrid: false, hidden: true };
/** 앱이 setAxesStyle에 넘기는 모양(117차 — 켬이면 hidden: false, 코어에는 주지 않은 것과 같다) */
const GIVEN = (on: boolean): AxesStyle => ({ negativeDashed: true, z: true, withoutGrid: on, hidden: !on });

/** 코어 뷰어(가짜 WebGL2) — setAxesStyle에 넘긴 값을 적는다 */
function styled(): { v: Viewer3d; styles: (AxesStyle | null)[] } {
  const { v } = viewer();
  const styles: (AxesStyle | null)[] = [];
  const set = v.setAxesStyle.bind(v);
  v.setAxesStyle = (s) => (styles.push(s), set(s));
  return { v, styles };
}

describe('그리기 축 자리 축선의 SketchUp 모양(113차 — 코어 0.108.0 setAxesStyle)', () => {
  it('문서 열기: 기본 축(null 틀)에서도, 옮기고 돌린 축에서도 음의 쪽 점선·파랑 Z·격자를 꺼도 축선(좌표축 켬)', () => {
    const { v, styles } = styled();
    expect(v.axesStyle).toBeNull();
    const plain = docOf(file2021(), '기본 축.skp');
    open(v, plain);
    expect(v.axesFrame).toBeNull();
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    const moved = docOf(mfcFile({ schemas: 'v20', root: squareEntities(), axes: [1, 2, 3, 0, 1, 0, -1, 0, 0, 0, 0, 1] }), '옮긴 축.skp');
    open(v, moved);
    frameIs(v, moved.drawAxes!);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    // 문서마다 같은 모양을 다시 준다(코어는 같은 모양이면 격자를 다시 만들지 않는다)
    expect(styles).toEqual([GIVEN(true), GIVEN(true)]);
  });

  it('장면 고르기: 옮긴 축·돌린 축·기본 축 장면 뒤에도 같은 모양', () => {
    const { v } = styled();
    const d = docOf(file2021());
    open(v, d);
    for (const i of [0, 1, 3, 2, 4]) {
      applyScene(d, d.pages[i]!, i, v);
      expect(v.axesStyle, `장면 ${i}`).toEqual(SKETCHUP(true));
    }
    expect(v.axesFrame).not.toBeNull();
  });

  it('좌표축 버튼(showAxes): 끄면 왼쪽 아래 축 표시와 격자 없는 축선을 함께 끄고, 켜면 함께 켠다 — 그 뒤 스타일을 담지 않은 장면·틀 바꾸기도 그 상태를 따른다', () => {
    const { v } = styled();
    const d = docOf(file2021());
    open(v, d);
    showAxes(v, false);
    expect(v.axesVisible).toBe(false);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    // 좌표축을 끈 동안 틀이 바뀌는 장면(돌린 축)·새 문서의 틀(showDrawAxes)도 격자 없는 축선은 끈 채로(문서 열기의 축 보이기는 114차부터 문서 스타일 — 아래 showDocAxes)
    applyScene(d, d.pages[3]!, 3, v);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    open(v, docOf(file2021(), '다른 파일.skp'));
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    showAxes(v, true);
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    // 격자 버튼은 모양을 바꾸지 않는다(격자를 꺼도 좌표축이 켜져 있으면 코어가 축선만 그린다)
    v.setGridVisible(false);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    // 뷰어가 없으면(문서를 열기 전) 아무것도 하지 않는다
    expect(() => showAxes(null, false)).not.toThrow();
  });

  it('앱 원문: 좌표축 버튼은 annotations.ts showAxes로(뷰어와 함께 받는 조각 — 모양 상수를 첫 화면 조각에 두지 않음), 문서 열기는 showDocAxes(114차 — 틀은 그 안 showDrawAxes)', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const start = app.indexOf('toggleAxes(on = !this.axesOn): void {');
    expect(start).toBeGreaterThan(0);
    const body = app.slice(start, app.indexOf('\n  }\n', start));
    expect(body).toContain('annotating?.showAxes(this.viewer, on);');
    expect(body).not.toContain('setAxesStyle');
    expect(app).toContain('annotating?.showDocAxes(v, d);');
    // 메뉴 「좌표축」과 도구 막대 버튼 둘 다 toggleAxes
    expect(app).toContain("tbtn('좌표축', 'axes', '좌표축 보이기', () => this.toggleAxes())");
    expect(app).toContain("{ label: '좌표축', checked: this.axesOn, toggle: true, run: () => this.toggleAxes() }");
  });
});

/** 렌더링 레코드 7343(DisplaySketchAxes — 스타일 Modeling Settings의 Model Axes 칸) 하나 */
const axesRec = (on: boolean): [number, Uint8Array][] => [[0x7343, u8(on ? 1 : 0)]];

/**
 * 114차 — 스타일의 축 보이기를 담은 2021+ 파일: 모형 렌더링의 축 보이기(docAxes — 주지 않으면 모형 렌더링 레코드 없음 = 칸 없음),
 * 장면 A(스타일 — 축 켬), B(카메라만 — 스타일을 담지 않음), C(스타일 — 글만 끔, 축 칸 없음), D(스타일 축 끔 + 돌린 축)
 */
function styledFile(docAxes?: boolean): Uint8Array {
  return skpFile(
    modelDat({
      root: tri(),
      lengthUnit: 2,
      ...(docAxes === undefined ? {} : { rendering: axesRec(docAxes) }),
      pages: {
        list: [
          { id: 60, name: 'A', flags: 0x2, render: rendering(axesRec(true)) },
          { id: 61, name: 'B', flags: 0x1, camera: { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1] } },
          { id: 62, name: 'C', flags: 0x2, render: rendering([[0x7344, u8(0)]]) },
          { id: 63, name: 'D', flags: 0x2 | 0x8, render: rendering(axesRec(false)), axes: TURNED },
        ],
      },
    }),
  );
}

const metaOf = (bytes: Uint8Array): SkpMetaExtras => skpToScene(bytes, { outline: true }).meta as SkpMetaExtras;
/** 돌린 축 장면 D의 틀(장면 단위 mm) */
const TURNED_MM: SkpAxesMeta = { origin: [762, 1016, 0], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] };

describe('스타일·장면의 축 보이기를 좌표축 상태로(114차 — DisplaySketchAxes)', () => {
  it('해석기: 모형·장면 렌더링 7343(없으면 style.xml 7008) → style.axes, 칸이 없으면 없음, 스타일을 담지 않은 장면은 스타일 없음', () => {
    const m = metaOf(styledFile(false));
    expect(m.style?.axes).toBe(false);
    const pages = m.pages!;
    expect(pages.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(pages[0]!.style?.axes).toBe(true);
    expect('style' in pages[1]!).toBe(false);
    expect(pages[2]!.style?.texts).toBe(false);
    expect('axes' in pages[2]!.style!).toBe(false);
    expect(pages[3]!.style?.axes).toBe(false);
    expect(metaOf(styledFile(true)).style?.axes).toBe(true);
    expect(metaOf(styledFile()).style?.axes).toBeUndefined();
    const xml = (v: string): boolean | undefined => resolveStyle({ values: new Map(), styleName: 'S' }, parseStyleXml(styleXml([[7008, 1, v]], 'S'))).axes;
    expect([xml('0'), xml('1')]).toEqual([false, true]);
  });

  it('문서 열기: 축을 숨긴 스타일의 파일은 좌표축 꺼짐(왼쪽 아래 축 표시·격자 없는 축선 없음), 칸이 없는 파일·축을 보인 파일은 켬', () => {
    const { v, styles } = styled();
    const hidden = docOf(styledFile(false), '축 숨김.skp');
    expect(hidden.style?.axes).toBe(false);
    openDoc(v, hidden);
    expect(v.axesVisible).toBe(false);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    // 칸이 없는 파일: 앞 문서가 끈 좌표축을 켠다(글·치수 보이기처럼 문서마다 — 칸 없음 = 켬)
    openDoc(v, docOf(styledFile(), '칸 없음.skp'));
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    openDoc(v, docOf(styledFile(false), '축 숨김 2.skp'));
    expect(v.axesVisible).toBe(false);
    openDoc(v, docOf(styledFile(true), '축 보임.skp'));
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    // 보이기를 먼저 정하고 틀·모양을 주므로 문서마다 모양은 한 번
    expect(styles).toEqual([GIVEN(false), GIVEN(true), GIVEN(false), GIVEN(true)]);
    // 좌표축 버튼으로 끈 뒤 연 칸 없는 파일도 켬(SketchUp도 파일의 스타일을 따름)
    showAxes(v, false);
    openDoc(v, docOf(styledFile(), '칸 없음 2.skp'));
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
  });

  it('장면 탭: 스타일을 담은 장면은 그 스타일의 축 보이기로, 스타일을 담지 않았거나 축 칸이 없는 장면은 그대로 — 좌표축 버튼으로 바꾼 뒤에도 장면 스타일이 다시 정함', () => {
    const { v } = styled();
    const d = docOf(styledFile(false));
    openDoc(v, d);
    expect(v.axesVisible).toBe(false);
    const pick = (i: number): void => applyScene(d, d.pages[i]!, i, v);
    // A: 스타일 — 축 켬(축 틀은 기억하지 않음)
    pick(0);
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    expect(v.axesFrame).toBeNull();
    // B: 스타일을 담지 않음 — 그대로
    pick(1);
    expect(v.axesVisible).toBe(true);
    // D: 스타일 축 끔 + 돌린 축 — 틀과 함께 끔
    pick(3);
    expect(v.axesVisible).toBe(false);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    frameIs(v, TURNED_MM);
    // C: 스타일이지만 축 칸 없음 — 그대로
    pick(2);
    expect(v.axesVisible).toBe(false);
    // 좌표축 버튼으로 켠 뒤: 스타일 없는 B는 그대로, D를 다시 고르면(틀 그대로) 장면 스타일이 다시 끔 — 글·치수 보이기와 같은 규칙
    showAxes(v, true);
    pick(1);
    expect(v.axesVisible).toBe(true);
    pick(3);
    expect(v.axesVisible).toBe(false);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    // A: 틀은 그대로(돌린 축), 축 보이기만 켬
    pick(0);
    expect(v.axesVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    frameIs(v, TURNED_MM);
  });

  it('앱 원문: 문서 열기는 showDocAxes 뒤 refreshChrome(도구 막대), 장면 탭은 applyScene 뒤 refreshToolbar — 좌표축 버튼 눌림이 따라오고 휴대폰 메뉴는 열 때 axesOn을 읽음', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const at = app.indexOf('annotating?.showDocAxes(v, d);');
    expect(at).toBeGreaterThan(0);
    expect(app.indexOf('this.refreshChrome();', at)).toBeGreaterThan(at);
    expect(app).not.toContain('showDrawAxes(v, d.drawAxes)');
    const page = app.indexOf('applyPage(index: number, fromSlideshow = false): number {');
    expect(page).toBeGreaterThan(0);
    const body = app.slice(page, app.indexOf('\n  }\n', page));
    const scene = body.indexOf('annotating?.applyScene(d, page, index, v);');
    expect(scene).toBeGreaterThan(0);
    expect(body.lastIndexOf('this.refreshToolbar();')).toBeGreaterThan(scene);
  });
});

/**
 * 코어가 지금 상태로 그릴 격자 선분 — 뷰어가 격자를 다시 만들 때(rebuildGrid) 부르는 같은 순수 함수에 코어가 가진 틀·모양(getter)을 넘긴다.
 * 격자 범위는 세계 원점과 돌린 축 장면의 원점(762, 1016 mm)을 함께 담는 상자(세계 축·틀 축 모두 격자 안 — 축선이 있으면 빈 배열이 아니다)
 */
const linesOf = (v: Viewer3d): GridLines => gridLines(gridSpec({ min: [-50, -50, 0], max: [1500, 1500, 10] }), null, v.axesFrame, v.axesStyle);
/** 장면 안 축선이 하나도 없다(X·Y축선 빈 배열, Z축선·음의 쪽 점선 칸 없음) */
const noAxisLines = (g: GridLines): void => {
  expect(g.axisX.length).toBe(0);
  expect(g.axisY.length).toBe(0);
  expect('axisZ' in g).toBe(false);
  expect('axisDash' in g).toBe(false);
};
/** 113차 SketchUp 축선이 있다(X·Y·Z축선과 음의 쪽 점선) */
const sketchUpAxisLines = (g: GridLines): void => {
  expect(g.axisX.length).toBeGreaterThan(0);
  expect(g.axisY.length).toBeGreaterThan(0);
  expect(g.axisZ!.length).toBeGreaterThan(0);
  expect(g.axisDash!.x.length).toBeGreaterThan(0);
};

describe('좌표축을 끄면 격자가 보여도 장면 안 축선 없음(117차 — 코어 0.113.0 hidden)', () => {
  it('좌표축 버튼: 격자를 켠 채로 끄면 X·Y·Z축선·음의 쪽 점선이 모두 없고, 켜면 113차 모양 그대로(코어 모양에 hidden 칸 없음)', () => {
    const { v } = styled();
    open(v, docOf(file2021()));
    expect(v.gridVisible).toBe(true);
    sketchUpAxisLines(linesOf(v));
    showAxes(v, false);
    expect(v.gridVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    noAxisLines(linesOf(v));
    // 격자를 꺼도 축선 없음(격자 없는 축선도 좌표축을 따름 — 113차 그대로)
    v.setGridVisible(false);
    noAxisLines(linesOf(v));
    v.setGridVisible(true);
    showAxes(v, true);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    expect('hidden' in v.axesStyle!).toBe(false);
    sketchUpAxisLines(linesOf(v));
  });

  it('틀을 옮긴 장면·새 문서도 좌표축을 끈 동안은 축선 없음', () => {
    const { v } = styled();
    const d = docOf(file2021());
    open(v, d);
    showAxes(v, false);
    // 돌린 축 장면(틀 바꿈 — showDrawAxes 안 showAxesStyle)
    applyScene(d, d.pages[3]!, 3, v);
    frameIs(v, TURNED_MM);
    noAxisLines(linesOf(v));
    // 같은 틀에서 좌표축을 켜면 틀 자리 축선이 있다(위 빈 축선은 틀이 격자 밖이라서가 아니다)
    showAxes(v, true);
    sketchUpAxisLines(linesOf(v));
    showAxes(v, false);
    noAxisLines(linesOf(v));
    // 옮긴 축 파일(문서 열기의 틀 — 문서 스타일 칸이 없는 길은 아래 showDocAxes가 켬)
    open(v, docOf(mfcFile({ schemas: 'v20', root: squareEntities(), axes: [1, 2, 3, 0, 1, 0, -1, 0, 0, 0, 0, 1] }), '옮긴 축.skp'));
    expect(v.axesVisible).toBe(false);
    noAxisLines(linesOf(v));
  });

  it('스타일이 축을 숨긴 문서·장면(114차 길)도 격자가 보이는 채로 축선 없음, 축을 보인 장면에서 다시 113차 모양', () => {
    const { v } = styled();
    const d = docOf(styledFile(false), '축 숨김.skp');
    openDoc(v, d);
    expect(v.axesVisible).toBe(false);
    expect(v.gridVisible).toBe(true);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    noAxisLines(linesOf(v));
    // A: 장면 스타일 축 켬
    applyScene(d, d.pages[0]!, 0, v);
    expect(v.axesStyle).toEqual(SKETCHUP(true));
    sketchUpAxisLines(linesOf(v));
    // D: 장면 스타일 축 끔 + 돌린 축
    applyScene(d, d.pages[3]!, 3, v);
    expect(v.axesStyle).toEqual(SKETCHUP(false));
    frameIs(v, TURNED_MM);
    noAxisLines(linesOf(v));
  });
});
