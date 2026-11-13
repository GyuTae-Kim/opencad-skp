// @vitest-environment jsdom
/**
 * 장면 그리기 축(73차): 장면 속성 "Axes Location"(use 깃발 0x008 — 공개 Ruby API Page#axes·use_axes?, C API FLAG_USE_AXES)을 기억하는 장면은
 * 2021+ 714f → 4650, 2020 이하 CViewPage 안 CSketchCS에 그 축을 둔다. 해석기는 meta.pages[].axes(원점은 장면 단위, 기본 축이면 null)로 넘기고,
 * 화면은 그 장면을 고르면 그리기 축(줄자·각도기의 축 고정·기본 평면·축 성분, 정보 탭)을 그 축으로 바꾸며 기억하지 않는 장면은 그대로 둔다.
 */
import { describe, expect, it } from 'vitest';
import { createDoc } from '../../src/app/doc';
import { infoSections } from '../../src/app/infotab';
import { pagePlan, readPage } from '../../src/app/pages';
import { skpToScene } from '../../src/index';
import type { SkpMetaExtras } from '../../src/meta';
import { readModelDat } from '../../src/model';
import { edge, entities, face, modelDat, skpFile, tlv, u8, uintLE, i32, f64, vertex } from '../build';
import { mfcFile, squareEntities } from '../mfcwrite';

/** 삼각형 하나 */
const tri = (): Uint8Array =>
  entities(undefined, {
    vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
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
/** 원점만 옮긴 축(인치) */
const MOVED = [10, 20, -1, 1, 0, 0, 0, 1, 0, 0, 0, 1];
/** 원점을 옮기고 빨강 = −Y, 초록 = −X(실제 2026 표본 장면 축과 같은 꼴) */
const TURNED = [30, 40, 0, 0, -1, 0, -1, 0, 0, 0, 0, 1];

/**
 * 2021+ 장면 넷: A(축 깃발 + 옮긴 축), B(축 깃발 없음 — 714f도 없음), C(축 깃발 + 기본 축), D(축 깃발 + 돌린 축), E(축 깃발이지만 714f 없음)
 */
function file2021(lengthUnit = 2): Uint8Array {
  return skpFile(
    modelDat({
      root: tri(),
      lengthUnit,
      pages: {
        list: [
          { id: 60, name: 'A', flags: 0x1 | 0x8, camera: { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1] }, axes: MOVED },
          { id: 61, name: 'B', flags: 0x1, camera: { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1] } },
          { id: 62, name: 'C', flags: 0x8, axes: DEFAULT },
          { id: 63, name: 'D', flags: 0x8, axes: TURNED },
          { id: 64, name: 'E', flags: 0x8 },
        ],
      },
    }),
  );
}

const metaOf = (bytes: Uint8Array): SkpMetaExtras => skpToScene(bytes, { outline: true }).meta as SkpMetaExtras;

describe('장면 그리기 축: 해석기', () => {
  it('2021+: 깃발 0x008인 장면의 714f → 4650(기본 축이면 null), 깃발이 없거나 칸이 없으면 칸 없음', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        pages: {
          list: [
            { id: 60, name: 'A', flags: 0x8, axes: MOVED },
            { id: 61, name: 'B', flags: 0x1, axes: MOVED },
            { id: 62, name: 'C', flags: 0x8, axes: DEFAULT },
            { id: 63, name: 'D', flags: 0x8, axes: TURNED },
            { id: 64, name: 'E', flags: 0x8 },
          ],
        },
      }),
    );
    const ax = m.pages!.map((p) => p.axes);
    expect(ax[0]).toEqual({ origin: [10, 20, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    // 깃발이 없으면 기록이 있어도 읽지 않는다(장면이 기억하지 않는 속성)
    expect(ax[1]).toBeUndefined();
    expect(ax[2]).toBeNull();
    expect(ax[3]).toEqual({ origin: [30, 40, 0], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    expect(ax[4]).toBeUndefined();
    expect('axes' in m.pages![1]!).toBe(false);
    // 모형 축(01fc)은 그대로 없음(기본)
    expect(m.axes).toBeUndefined();
    expect(m.warnings).toEqual([]);
  });

  it('2021+: 축 칸이 깨졌으면(길이가 맞지 않는 원점) 그 장면만 모른다', () => {
    const page = tlv(
      0x7148,
      tlv(0x6f54, tlv(0x05dc, tlv(0x05de, uintLE(70))), tlv(0x6f55)),
      tlv(0x7149, i32(0x8)),
      tlv(0x714f, tlv(0x4650, tlv(0x07d0, tlv(0x07d3, u8(6))), tlv(0x4651, f64(1, 2)), tlv(0x4652, f64(1, 0, 0)), tlv(0x4653, f64(0, 1, 0)), tlv(0x4654, f64(0, 0, 1)))),
    );
    const m = readModelDat(modelDat({ root: tri(), sections: [tlv(0x0207, tlv(0x6d60, tlv(0x6d61, page)))] }));
    expect(m.pages).toHaveLength(1);
    expect(m.pages![0]!.axes).toBeUndefined();
  });

  it('meta.pages[].axes: 원점은 장면 단위(mm 모형 × 25.4), 기본 축은 null, 기억하지 않는 장면은 칸 없음', () => {
    const pages = metaOf(file2021()).pages!;
    expect(pages.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(pages[0]!.axes).toEqual({ origin: [254, 508, -25.4], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect('axes' in pages[1]!).toBe(false);
    expect(pages[2]!.axes).toBeNull();
    expect(pages[3]!.axes).toEqual({ origin: [762, 1016, 0], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    expect('axes' in pages[4]!).toBe(false);
    // 인치 모형은 원점 그대로
    expect(metaOf(file2021(0)).pages![0]!.axes!.origin).toEqual([10, 20, -1]);
  });

  it('2020 이하: CViewPage 안 CSketchCS(깃발 0x8) — 기본 축은 null, 깃발이 없으면 칸 없음, 모형 꼬리 축과 따로', () => {
    const bytes = mfcFile({
      schemas: 'v20',
      root: squareEntities(),
      axes: [1, 2, 3, 0, 1, 0, -1, 0, 0, 0, 0, 1],
      pages: [
        { name: 'P', flags: 0x8, axes: MOVED },
        { name: 'Q', flags: 0x1, camera: { eye: [0, -10, 5], target: [0, 0, 0], up: [0, 0, 1] } },
        { name: 'R', flags: 0x8, axes: DEFAULT },
      ],
    });
    const s = skpToScene(bytes, { outline: true });
    const m = s.meta as SkpMetaExtras;
    expect(m.axes).toEqual({ origin: [1, 2, 3], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    expect(m.pages!.map((p) => p.name)).toEqual(['P', 'Q', 'R']);
    expect(m.pages![0]!.axes).toEqual({ origin: [10, 20, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect('axes' in m.pages![1]!).toBe(false);
    expect(m.pages![2]!.axes).toBeNull();
    expect(s.warnings ?? []).toEqual([]);
  });
});

describe('장면 그리기 축: 화면', () => {
  it('readPage: null(기본 축)·축 꼴만 받고, 꼴이 다르면 기억하지 않는 장면처럼', () => {
    const a = { origin: [1, 2, 3], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] };
    expect(readPage({ name: 'A', axes: a }, 0).axes).toEqual(a);
    expect(readPage({ name: 'B', axes: null }, 1).axes).toBeNull();
    expect('axes' in readPage({ name: 'C' }, 2)).toBe(false);
    expect('axes' in readPage({ name: 'D', axes: { origin: [1, 2], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } }, 3)).toBe(false);
    expect('axes' in readPage({ name: 'E', axes: 'x' }, 4)).toBe(false);
    // 적용 계획: 기억하는 장면만 축을 바꾼다(undefined = 그대로)
    expect(pagePlan(readPage({ name: 'A', axes: a }, 0)).axes).toEqual(a);
    expect(pagePlan(readPage({ name: 'B', axes: null }, 1)).axes).toBeNull();
    expect(pagePlan(readPage({ name: 'C' }, 2)).axes).toBeUndefined();
  });

  it('문서: 처음 그리기 축은 파일의 축, 장면 차례대로 고르면 기억하는 장면만 바꾸고(기본 축 장면은 되돌림) 정보 탭이 따른다', () => {
    const scene = skpToScene(file2021(), { outline: true });
    const d = createDoc('축.skp', 1, { scene, ms: 1 });
    expect(d.axes).toBeNull();
    expect(d.drawAxes).toBeNull();
    expect(d.axesPage).toBeNull();
    // 앱 applyPage의 축 몫(plan.axes가 있으면 바꾸고 그 장면을 적는다)
    const pick = (i: number): void => {
      const plan = pagePlan(d.pages[i]!);
      if (plan.axes !== undefined) {
        d.drawAxes = plan.axes;
        d.axesPage = i;
      }
    };
    const text = (): string => infoSections(d, () => undefined).map((s) => s.textContent ?? '').join('\n');
    // 열 때: 축 줄 없음, 장면 규칙 안내는 파일과 다른 축을 기억하는 장면이 있어 보인다
    expect(text()).not.toContain('그리기 축 원점');
    expect(text()).toContain('그리기 축을 기억하는 장면을 고르면');
    pick(0);
    expect(d.drawAxes).toEqual({ origin: [254, 508, -25.4], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] });
    expect(d.axesPage).toBe(0);
    let t = text();
    expect(t).toContain('그리기 축 원점');
    expect(t).toContain('254, 508, -25.4');
    expect(t).toContain('그리기 축을 정한 장면');
    expect(t).toContain('줄자·각도기의 축 고정·기본 평면과 줄자 결과의 dx·dy·dz는 옮긴 그리기 축을 따릅니다.');
    // 축을 기억하지 않는 장면: 그대로
    pick(1);
    expect(d.drawAxes!.origin).toEqual([254, 508, -25.4]);
    expect(d.axesPage).toBe(0);
    pick(4);
    expect(d.axesPage).toBe(0);
    // 돌린 축 장면
    pick(3);
    expect(d.drawAxes).toEqual({ origin: [762, 1016, 0], x: [0, -1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    // 기본 축을 기억하는 장면: 기본 축으로 되돌리고, 정보 탭에는 기본 축과 그 장면을 적는다(옮긴 축 안내는 없음)
    pick(2);
    expect(d.drawAxes).toBeNull();
    expect(d.axesPage).toBe(2);
    t = text();
    expect(t).toContain('0, 0, 0');
    expect(t).toContain('그리기 축을 정한 장면');
    expect(t).not.toContain('옮긴 그리기 축을 따릅니다');
  });

  it('모든 장면이 파일과 같은 축을 기억하면 장면 규칙 안내를 띄우지 않는다', () => {
    const bytes = skpFile(modelDat({ root: tri(), pages: { list: [{ id: 60, name: 'A', flags: 0x8, axes: DEFAULT }, { id: 61, name: 'B', flags: 0x1 }] } }));
    const d = createDoc('같은 축.skp', 1, { scene: skpToScene(bytes, { outline: true }), ms: 1 });
    expect(d.pages[0]!.axes).toBeNull();
    const t = infoSections(d, () => undefined).map((s) => s.textContent ?? '').join('\n');
    expect(t).not.toContain('그리기 축을 기억하는 장면을 고르면');
    expect(t).not.toContain('그리기 축 원점');
  });
});
