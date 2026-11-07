import { describe, expect, it } from 'vitest';
import earcutRef from 'earcut';
import { faceAt, facesFrom } from '../src/entities';
import { F64, U32 } from '../src/grow';
import { skpToScene } from '../src/index';
import { parseMaterialXml } from '../src/materials';
import { matrixFrom13, readModelDat } from '../src/model';
import { triangulateFace } from '../src/scene';
import { TlvReader } from '../src/tlv';
import {
  IDENTITY13,
  edge,
  entities,
  face,
  instance,
  materialXml,
  modelDat,
  oldSkpHeader,
  skpFile,
  tlv,
  uintLE,
  utf8,
  vertex,
} from './build';

/** 정의 하나: 10×10 정사각형 면(가운데 4×4 구멍) + 숨긴 모서리 + 부드러운 모서리 */
function squareWithHole(defId: number, back?: number): Uint8Array {
  const P: [number, number, number][] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [3, 3, 0],
    [7, 3, 0],
    [7, 7, 0],
    [3, 7, 0],
  ];
  const vid = (i: number): number => 100 + i;
  const verts = P.map((p, i) => vertex(vid(i), ...p));
  // 바깥 0→1→2→3, 안쪽은 4→5→6→7 모서리를 뒤집어 7→6→5→4 차례로 돈다
  const edges = [
    edge(200, vid(0), vid(1)),
    edge(201, vid(1), vid(2)),
    edge(202, vid(2), vid(3)),
    edge(203, vid(3), vid(0)),
    edge(204, vid(4), vid(5)),
    edge(205, vid(5), vid(6)),
    edge(206, vid(6), vid(7)),
    edge(207, vid(7), vid(4)),
    edge(208, vid(0), vid(2), { flags: 0x07 }),
    edge(209, vid(1), vid(3), { flags: 0x1e }),
  ];
  const faces = [
    face(
      300,
      [0, 0, 1, 0],
      [
        [
          [200, false],
          [201, false],
          [202, false],
          [203, false],
        ],
        [
          [206, true],
          [205, true],
          [204, true],
          [207, true],
        ],
      ],
      back !== undefined ? { back } : {},
    ),
  ];
  return entities(defId, { vertices: verts, edges, faces });
}

const ROT_Z90_AT_100 = [0, -1, 0, 1, 0, 0, 0, 0, 1, 100, 0, 0, 1];

function testModel(lengthUnit = 0): Uint8Array {
  const root = entities(undefined, {
    vertices: [vertex(1, 0, 0, -5), vertex(2, 1, 0, -5), vertex(3, 0, 1, -5)],
    edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
    faces: [
      face(
        7,
        [0, 0, -1, -5],
        [
          [
            [4, false],
            [5, false],
            [6, false],
          ],
        ],
        { material: 11 },
      ),
    ],
    components: [instance(20, 50, ROT_Z90_AT_100, { material: 10 }), instance(22, 50, IDENTITY13, { flags: 0x07 })],
    groups: [instance(21, 50, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 50, 1], { layer: 2 }), instance(23, 999, IDENTITY13)],
  });
  return modelDat({
    materials: [
      [10, '빨강'],
      [11, 'Green & Co'],
      [12, '파랑'],
    ],
    layers: [
      [1, 'Layer0'],
      [2, 'Walls'],
    ],
    definitions: [{ name: '구멍판', entities: squareWithHole(50, 12) }],
    root,
    lengthUnit,
  });
}

const MATERIALS: [string, string][] = [
  ['빨강', materialXml('빨강', [255, 0, 0])],
  ['Green', materialXml('Green & Co', [0, 255, 0])],
  ['파랑', materialXml('파랑', [0, 0, 255], 0.5, 1)],
];

function triArea(pos: Float32Array, idx: Uint32Array): number {
  let a = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t]! * 3, idx[t + 1]! * 3, idx[t + 2]! * 3];
    const u = [pos[j]! - pos[i]!, pos[j + 1]! - pos[i + 1]!, pos[j + 2]! - pos[i + 2]!];
    const v = [pos[k]! - pos[i]!, pos[k + 1]! - pos[i + 1]!, pos[k + 2]! - pos[i + 2]!];
    a += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
  }
  return a;
}

describe('TLV 읽기', () => {
  it('꼬리표·길이·내용과 가장 짧은 리틀 엔디언 번호', () => {
    const b = tlv(0x1234, tlv(0x05de, uintLE(0x1f2d)), tlv(0x32cc, utf8('Layer0')));
    const r = new TlvReader(b);
    const root = r.children({ tag: 0, start: 0, end: b.length })[0]!;
    expect(root.tag).toBe(0x1234);
    expect(r.uint(r.first(root, 0x05de))).toBe(7981);
    expect(r.str(r.first(root, 0x32cc))).toBe('Layer0');
    expect(r.first(root, 0x9999)).toBeUndefined();
  });

  it('길이가 범위를 넘으면 오류', () => {
    const b = tlv(0x1, new Uint8Array(4));
    b[2] = 99;
    const r = new TlvReader(b);
    expect(() => r.children({ tag: 0, start: 0, end: b.length })).toThrow();
  });
});

describe('model.dat → 중간 모형', () => {
  it('재질·태그·정의·인스턴스·단위', () => {
    const m = readModelDat(testModel(2));
    expect([...m.materials]).toEqual([
      [10, '빨강'],
      [11, 'Green & Co'],
      [12, '파랑'],
    ]);
    expect(m.layers.get(2)).toBe('Walls');
    expect(m.defaultLayer).toBe(1);
    expect(m.lengthUnit).toBe(2);
    const def = m.definitions.get(50)!;
    expect(def.name).toBe('구멍판');
    expect(def.entities.points.length).toBe(8 * 3);
    expect(def.entities.edges.length).toBe(10);
    expect(faceAt(def.entities.faces, 0).loops).toEqual([
      [0, 1, 2, 3],
      [7, 6, 5, 4],
    ]);
    expect(faceAt(def.entities.faces, 0).back).toBe(12);
    // 쓰기 도구의 파일 차례: 그룹(138d/1d4c) 다음 컴포넌트(138c)
    expect(m.root.instances.map((i) => i.definition)).toEqual([50, 999, 50, 50]);
    expect(m.counts.faces).toBe(2);
  });

  it('변환: 3×3 행 우선 + 이동 → 열 우선 4×4', () => {
    const c = matrixFrom13(ROT_Z90_AT_100);
    // x축(1,0,0) → (0,1,0), 이동 (100,0,0)
    expect([c[0], c[1], c[2]]).toEqual([0, 1, 0]);
    expect([c[4], c[5], c[6]]).toEqual([-1, 0, 0]);
    expect([c[12], c[13], c[14], c[15]]).toEqual([100, 0, 0, 1]);
  });

  it('뿌리 꼬리표가 다르면 오류', () => {
    expect(() => readModelDat(tlv(0x1234))).toThrow();
  });
});

describe('material.xml', () => {
  it('색·불투명도·이름의 XML 이스케이프', () => {
    const a = parseMaterialXml(materialXml('A & "B"', [255, 128, 0]))!;
    expect(a.name).toBe('A & "B"');
    expect(a.color[0]).toBe(1);
    expect(a.color[1]).toBeCloseTo(128 / 255);
    expect(a.color[3]).toBe(1);
    expect(parseMaterialXml(materialXml('g', [1, 2, 3], 0.4, 1))!.color[3]).toBeCloseTo(0.4);
    // trans=0·useTrans=1은 불투명으로 둔다(표본 미리보기에서 불투명)
    expect(parseMaterialXml(materialXml('h', [1, 2, 3], 0, 1))!.color[3]).toBe(1);
    expect(parseMaterialXml('<nothing/>')).toBeNull();
  });
});

/** 고리·법선으로 면 하나짜리 표 */
const oneFace = (loops: number[][], normal: [number, number, number]) => facesFrom([{ loops, normal, flags: 0 }]);

describe('면 삼각화', () => {
  it('구멍 있는 다각형', () => {
    const pts = new Float64Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 3, 3, 0, 7, 3, 0, 7, 7, 0, 3, 7, 0]);
    const pos = new F64();
    const idx = new U32();
    expect(triangulateFace(pts, oneFace([[0, 1, 2, 3], [7, 6, 5, 4]], [0, 0, 1]), 0, pos, idx)).toBe(true);
    expect(idx.n / 3).toBe(8);
    expect(triArea(new Float32Array(pos.done()), idx.done())).toBeCloseTo(84);
  });

  it('세로 면(법선 x)도 투영해 나눈다', () => {
    const pts = new Float64Array([5, 0, 0, 5, 2, 0, 5, 2, 3, 5, 0, 3]);
    const pos = new F64();
    const idx = new U32();
    expect(triangulateFace(pts, oneFace([[0, 1, 2, 3]], [1, 0, 0]), 0, pos, idx)).toBe(true);
    expect(triArea(new Float32Array(pos.done()), idx.done())).toBeCloseTo(6);
  });

  it('면적 0이면 false', () => {
    const pos = new F64();
    const idx = new U32();
    expect(triangulateFace(new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), oneFace([[0, 1, 2]], [0, 0, 1]), 0, pos, idx)).toBe(false);
    expect([pos.n, idx.n]).toEqual([0, 0]);
  });

  it('51차: 면마다 꼭 맞게 잡은 earcut 입력이 50차의 다시 쓰는 배열과 같은 위치·삼각형·실패를 낸다(구멍·여러 구멍·겹친 점·한 줄 점·세로 면)', () => {
    // 50차 triangulateFace(다시 쓰는 배열을 length = 0으로 비우고 push) — 그대로 옮겨 둔 것
    const flat0: number[] = [];
    const holes0: number[] = [];
    const before = (points: Float64Array, faces: ReturnType<typeof facesFrom>, k: number, pos: F64, idx: U32): boolean => {
      const N = faces.normal;
      const ax = Math.abs(N[3 * k]!), ay = Math.abs(N[3 * k + 1]!), az = Math.abs(N[3 * k + 2]!);
      const drop = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
      const u = drop === 0 ? 1 : 0;
      const v = drop === 2 ? 1 : 2;
      flat0.length = 0;
      holes0.length = 0;
      const base = pos.n / 3;
      const C = faces.cornerStart;
      for (let li = faces.loopStart[k]!; li < faces.loopStart[k + 1]!; li++) {
        if (li > faces.loopStart[k]!) holes0.push(flat0.length / 2);
        pos.reserve(3 * (C[li + 1]! - C[li]!));
        for (let c = C[li]!; c < C[li + 1]!; c++) {
          const o = 3 * faces.vertex[c]!;
          flat0.push(points[o + u]!, points[o + v]!);
          pos.a[pos.n++] = points[o]!;
          pos.a[pos.n++] = points[o + 1]!;
          pos.a[pos.n++] = points[o + 2]!;
        }
      }
      const tri = earcutRef(flat0, holes0.length ? holes0 : undefined, 2);
      if (tri.length === 0) {
        pos.n = base * 3;
        return false;
      }
      for (const t of tri) idx.push(base + t);
      return true;
    };
    let s = 51;
    const r = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const pts: number[] = [];
    const ring = (cx: number, cy: number, rad: number, n: number, rev: boolean, plane: 0 | 1 | 2): number[] => {
      const ids: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = ((rev ? -i : i) * 2 * Math.PI) / n;
        const p = [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
        const xyz = plane === 2 ? [p[0]!, p[1]!, 5] : plane === 0 ? [5, p[0]!, p[1]!] : [p[0]!, 5, p[1]!];
        ids.push(pts.length / 3);
        pts.push(...xyz);
      }
      return ids;
    };
    const list: Parameters<typeof facesFrom>[0][number][] = [];
    for (let f = 0; f < 400; f++) {
      const plane = (f % 3) as 0 | 1 | 2;
      const normal: [number, number, number] = plane === 2 ? [0, 0, 1] : plane === 0 ? [1, 0, 0] : [0, -1, 0];
      const n = 3 + Math.floor(r() * 10);
      const cx = r() * 100, cy = r() * 100, rad = 2 + r() * 5;
      const loops = [ring(cx, cy, rad, n, false, plane)];
      const holes = f % 5 === 0 ? 1 : f % 17 === 0 ? 3 : 0;
      for (let h = 0; h < holes; h++) loops.push(ring(cx + (h - 1) * 1.2, cy, 0.4, 3 + h, true, plane));
      // 겹친 점·한 줄 점(삼각화 실패)도 섞는다
      if (f % 23 === 0) loops[0] = [loops[0]![0]!, loops[0]![0]!, loops[0]![1]!];
      if (f % 29 === 0) {
        const a = pts.length / 3;
        pts.push(0, 0, 0, 1, 0, 0, 2, 0, 0);
        loops.splice(0, loops.length, [a, a + 1, a + 2]);
      }
      list.push({ loops, normal, flags: 0 });
    }
    const faces = facesFrom(list);
    const points = Float64Array.from(pts);
    const p0 = new F64(), i0 = new U32(), p1 = new F64(), i1 = new U32();
    let fails = 0;
    for (let k = 0; k < faces.length; k++) {
      const a = before(points, faces, k, p0, i0);
      expect(triangulateFace(points, faces, k, p1, i1)).toBe(a);
      if (!a) fails++;
    }
    expect(fails).toBeGreaterThan(0);
    expect(Array.from(p1.done())).toEqual(Array.from(p0.done()));
    expect(Array.from(i1.done())).toEqual(Array.from(i0.done()));
  });
});

describe('skpToScene', () => {
  it('인스턴스를 펼치고 재질·태그를 물려받는다', () => {
    const s = skpToScene(skpFile(testModel(0), { materials: MATERIALS }), { name: '시험' });
    expect(s.name).toBe('시험');
    expect(s.units).toBe('inch');
    expect(s.meta?.version).toBe('26.1.194');

    const byName = new Map(s.meshes.map((m) => [m.name, m]));
    // 회전 인스턴스: 면 재질 없음 → 인스턴스 재질(빨강), 기본 태그
    const red = byName.get('빨강 · Layer0')!;
    expect(red.color).toEqual([1, 0, 0, 1]);
    expect(red.indices!.length / 3).toBe(8);
    expect(triArea(red.positions, red.indices!)).toBeCloseTo(84);
    // (10,0,0) → z축 90° 돌림 + (100,0,0) = (100,10,0)
    const xs: number[] = [];
    for (let i = 0; i < red.positions.length; i += 3) xs.push(red.positions[i]!);
    expect(Math.min(...xs)).toBeCloseTo(90);
    expect(Math.max(...xs)).toBeCloseTo(100);

    // 그룹(태그 Walls, 재질 없음): 앞면은 기본색, 뒷면은 면 뒤 재질(파랑) — 앞·뒤를 따로 칠한다
    const blue = byName.get('기본 재질 · Walls')!;
    expect(blue.group).toBe('Walls');
    expect(blue.backColor![2]).toBe(1);
    expect(blue.color[3]).toBe(1);
    for (let i = 2; i < blue.positions.length; i += 3) expect(blue.positions[i]).toBeCloseTo(50);

    // 모형 바로 아래 면(앞 재질)
    expect(byName.get('Green & Co · Layer0')!.color).toEqual([0, 1, 0, 1]);
    // 숨긴 인스턴스는 빠지고, 메시는 셋
    expect(s.meshes.length).toBe(3);

    // 모서리: 숨김(0x01)·부드러움(0x18)은 빼고 태그마다 묶는다
    const lines = new Map(s.lines.map((l) => [l.group, l]));
    expect(lines.get('Walls')!.positions.length / 6).toBe(8);
    expect(lines.get('Layer0')!.positions.length / 6).toBe(8 + 3);

    expect(s.bounds!.min[2]).toBeCloseTo(-5);
    expect(s.bounds!.max[2]).toBeCloseTo(50);
    expect(s.warnings!.some((w) => w.includes('정의를 찾지 못한 인스턴스 1개'))).toBe(true);
  });

  it('model.dat의 바뀐 재질 이름은 꾸러미 폴더 이름으로 찾는다', () => {
    const root = entities(undefined, {
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
          { material: 13 },
        ),
      ],
    });
    const file = skpFile(modelDat({ materials: [[13, '_Black_']], root }), {
      materials: [['_Black_', materialXml('<Black>', [10, 20, 30])]],
    });
    const s = skpToScene(file);
    expect(s.meshes.length).toBe(1);
    expect(s.meshes[0]!.name).toBe('<Black> · Layer0');
    expect(s.meshes[0]!.color[0]).toBeCloseTo(10 / 255);
  });

  it('미터법 모형은 mm·m로 바꾼다', () => {
    const mm = skpToScene(skpFile(testModel(2), { materials: MATERIALS, deflate: false }));
    expect(mm.units).toBe('mm');
    expect(mm.bounds!.max[2]).toBeCloseTo(50 * 25.4);
    expect(mm.meta?.lengthUnit).toBe('mm');
    const m = skpToScene(skpFile(testModel(4), { materials: MATERIALS }));
    expect(m.units).toBe('m');
    expect(m.bounds!.max[2]).toBeCloseTo(50 * 0.0254);
  });

  it('깨진 정의 하나는 건너뛰고 나머지를 읽는다', () => {
    // 정점 목록 안의 자식 길이가 범위를 넘는 정의
    const broken = tlv(0x1388, tlv(0x07d0, tlv(0x05dc, tlv(0x05de, uintLE(60)))), tlv(0x1389, new Uint8Array([0xc4, 0x09, 0xe7, 0x03, 0, 0, 1, 2])));
    const root = entities(undefined, { components: [instance(20, 50, IDENTITY13), instance(21, 60, IDENTITY13)] });
    const model = modelDat({
      definitions: [
        { name: '깨짐', entities: broken },
        { name: '구멍판', entities: squareWithHole(50) },
      ],
      root,
    });
    const s = skpToScene(skpFile(model));
    expect(s.meshes.reduce((a, m) => a + m.indices!.length / 3, 0)).toBe(8);
    expect(s.warnings!.some((w) => w.includes('깨진 컴포넌트 정의'))).toBe(true);
    expect(s.warnings!.some((w) => w.includes('정의를 찾지 못한 인스턴스 1개'))).toBe(true);
  });

  it('바이트가 망가져도 예외 없이 경고로 끝난다', () => {
    const file = skpFile(testModel(2), { materials: MATERIALS, deflate: false });
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let k = 0; k < 300; k++) {
      const bad = file.slice();
      for (let j = 0; j < 4; j++) bad[60 + rnd(bad.length - 60)] = rnd(256);
      expect(() => skpToScene(bad)).not.toThrow();
    }
  });

  it('확인하지 않은 새 판(27 이상)은 경고하고 같은 형식으로 읽는다', () => {
    const s = skpToScene(skpFile(testModel(0), { version: '27.0.10', materials: MATERIALS }));
    expect(s.meshes.length).toBe(3);
    expect(s.warnings![0]).toContain('확인하지 않은 SketchUp 버전 27.0.10');
  });

  it('2020 이하 판은 MFC 해석기로 읽고, 머리만 있는(잘린) 파일은 경고와 빈 장면', () => {
    const s = skpToScene(oldSkpHeader('17.2.2555'));
    expect(s.meshes.length).toBe(0);
    expect(s.warnings![0]).toContain('SketchUp 파일을 읽지 못했습니다');
    expect(s.warnings![0]).toContain('잘렸습니다');
    expect(s.meta?.container).toBe('mfc');
    expect(s.meta?.unsupported).toBeUndefined();
  });

  it('SketchUp 파일이 아니거나 깨졌으면 경고', () => {
    expect(skpToScene(utf8('hello')).warnings![0]).toContain('SketchUp 파일이 아닙니다');
    const file = skpFile(testModel());
    // 끝의 ZIP 목록(끝 레코드)만 잘린 파일: 예전에는 빈 장면이었지만, 이제 지역 머리를 따라 model.dat를 찾아 읽고 경고한다
    const cut = file.subarray(0, file.length - 30);
    const s = skpToScene(cut);
    expect(s.meshes.length).toBe(3);
    expect(s.warnings!.some((w) => w.includes('꾸러미(ZIP) 목록이 없거나 깨져'))).toBe(true);
    expect(s.meta?.damaged).toBe(true);
    // 머리 뒤가 거의 없으면 빈 장면과 경고
    const head = skpToScene(file.subarray(0, 90));
    expect(head.meshes.length).toBe(0);
    expect(head.warnings!.length).toBeGreaterThan(0);
  });
});
