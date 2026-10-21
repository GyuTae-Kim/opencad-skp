import { describe, expect, it } from 'vitest';
import { readSkpHeader } from '../src/header';
import { readSkpImages, skpToScene } from '../src/index';
import { MfcRefused, chainCurveEdges, readMfcModel } from '../src/mfcmodel';
import { MfcError, MfcStream } from '../src/mfcstream';
import type { SkpModel } from '../src/model';
import { styleFor } from '../src/scene-meta';
import { pngRgb } from './build';
import { ID13, MFC_SCHEMAS, mfcFile, move13, mv, squareEntities, type MfcEntitiesSpec, type MfcSpec } from './mfcwrite';

const read = (spec: MfcSpec): ReturnType<typeof readMfcModel> => {
  const bytes = mfcFile(spec);
  return readMfcModel(bytes, readSkpHeader(bytes)!);
};
const model = (spec: MfcSpec): SkpModel => read(spec).model;
const tiny = pngRgb(2, 2, (x, y) => [x * 255, y * 255, 0]);
const ALL = ['v6', 'v7', 'v8', 'v15', 'v17', 'v18', 'v19', 'v20'] as const;

/** 가운데에 구멍이 난 정사각형(구멍 고리를 먼저 쓰고 바깥 고리를 둘째로 쓴다) */
const holed = (): MfcEntitiesSpec => ({
  vertices: [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [4, 4, 0],
    [6, 4, 0],
    [6, 6, 0],
    [4, 6, 0],
  ],
  edges: [
    { a: 0, b: 1 },
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 0, hidden: true },
    { a: 4, b: 5, soft: true },
    { a: 5, b: 6, smooth: true },
    { a: 6, b: 7, soft: true, smooth: true },
    { a: 7, b: 4 },
  ],
  faces: [
    {
      plane: [0, 0, 1, 0],
      loops: [
        {
          outer: false,
          uses: [
            [7, true],
            [6, true],
            [5, true],
            [4, true],
          ],
        },
        {
          outer: true,
          uses: [
            [0, false],
            [1, false],
            [2, false],
            [3, false],
          ],
        },
      ],
      front: 0,
      back: 1,
      hidden: true,
    },
  ],
});

describe('MFC 바이트 커서', () => {
  /** 바이트 → 커서(클래스 X의 읽는 함수는 u8 하나를 읽어 돌려준다) */
  const cursor = (bytes: number[]): MfcStream => {
    const s = new MfcStream(new Uint8Array(bytes), 0, 100);
    s.readers.set('X', () => s.u8());
    return s;
  };

  it('새 클래스·같은 클래스의 새 객체·참조·없음, 칸 번호는 클래스와 객체가 같이 센다', () => {
    // 새 클래스 X(칸 1) + 객체(칸 2, 값 7), 클래스 1의 새 객체(칸 3, 값 9), 칸 2 참조, 없음
    const s = cursor([0xff, 0xff, 0, 0, 1, 0, 0x58, 7, 0x01, 0x80, 9, 2, 0, 0, 0]);
    expect(s.readObject()).toBe(7);
    expect(s.readObject()).toBe(9);
    expect(s.readObject()).toBe(7);
    expect(s.lastClass).toBe('X');
    expect(s.readObject()).toBeNull();
    expect(s.lastClass).toBe('');
    expect(s.names).toEqual(['', 'X', 'X', 'X']);
  });

  it('큰 칸 번호(0x7FFF + u32): 클래스 표시가 서면 새 객체, 아니면 참조', () => {
    const s = cursor([0xff, 0xff, 0, 0, 1, 0, 0x58, 5, 0xff, 0x7f, 1, 0, 0, 0x80, 6, 0xff, 0x7f, 3, 0, 0, 0]);
    expect(s.readObject()).toBe(5);
    expect(s.readObject()).toBe(6);
    expect(s.readObject()).toBe(6);
  });

  it('CString: 좁은 글(latin-1), UTF-16, 긴 길이(0xFF + u16)', () => {
    const wide = [0xff, 0xfe, 0xff, 2, 0x5c, 0xd5, 0x00, 0xae];
    const long = [0xff, 0x2c, 0x01, ...new Array(300).fill(0x61)];
    const s = cursor([3, 0x41, 0xe9, 0x42, ...wide, ...long, 0]);
    expect(s.cstr()).toBe('AéB');
    expect(s.cstr()).toBe('한글');
    expect(s.cstr()).toBe('a'.repeat(300));
    expect(s.cstr()).toBe('');
  });

  it('깨진 꼬리표와 모르는 클래스는 까닭과 자리를 담은 MfcError', () => {
    const err = (bytes: number[], fn?: (s: MfcStream) => void): MfcError => {
      const s = cursor(bytes);
      try {
        (fn ?? ((x) => x.readObject()))(s);
      } catch (e) {
        return e as MfcError;
      }
      throw new Error('예외가 나야 합니다');
    };
    expect(err([5, 0]).kind).toBe('corrupt'); // 아직 없는 칸
    const twice = (x: MfcStream): void => {
      x.readObject();
      x.readObject();
    };
    expect(err([0xff, 0xff, 0, 0, 1, 0, 0x58, 1, 1, 0], twice).kind).toBe('corrupt'); // 클래스 칸을 객체로
    expect(err([0x05, 0x80]).kind).toBe('corrupt'); // 클래스가 아닌 칸의 새 객체
    const unknown = err([0xff, 0xff, 0, 0, 1, 0, 0x59]);
    expect(unknown.kind).toBe('unsupported');
    expect(unknown.message).toContain('Y');
    expect(err([0xff, 0xff, 0, 0, 0, 0]).kind).toBe('corrupt'); // 이름 길이 0
    expect(err([0xff, 0xff, 0, 0, 1, 0, 0x58, 1, 0x01, 0x80, 2], (s) => {
      s.readObject();
      s.readObject(new Set(['Z']));
    }).kind).toBe('corrupt'); // 바라지 않은 클래스
    const cut = err([5], (s) => s.u32());
    expect(cut.kind).toBe('truncated');
    expect(cut.message).toContain('잘렸습니다');
    expect(err([0xff, 0xff, 0xff, 0xff, 0x7f], (s) => s.count(10, '항목')).kind).toBe('corrupt');
  });

  it('칸 수 한도', () => {
    // 칸 0(없음) + 클래스 + 객체 둘 = 4칸까지
    const s = new MfcStream(new Uint8Array([0xff, 0xff, 0, 0, 1, 0, 0x58, 1, 0x01, 0x80, 2, 0x01, 0x80, 3]), 0, 4);
    s.readers.set('X', () => s.u8());
    s.readObject();
    s.readObject();
    expect(() => s.readObject()).toThrow(/넘습니다/);
  });
});

describe('판 거르기', () => {
  it('SketchUp 3~5는 까닭을 적어 거절하고, 장면은 meta.unsupported', () => {
    const bytes = mfcFile({ schemas: 'v4', root: squareEntities() });
    expect(() => readMfcModel(bytes, readSkpHeader(bytes)!)).toThrow(MfcRefused);
    const s = skpToScene(bytes);
    expect(s.meshes.length).toBe(0);
    expect(s.warnings![0]).toContain('SketchUp 3~5');
    expect(s.meta?.unsupported).toBe(true);
    expect(s.meta?.container).toBe('mfc');
  });

  it('모르는 스키마(2020 뒤 같은 값)도 거절한다', () => {
    const bytes = mfcFile({ schemas: { ...MFC_SCHEMAS.v20, CSketchUpModel: 30 }, root: squareEntities() });
    expect(() => readMfcModel(bytes, readSkpHeader(bytes)!)).toThrow(/확인한 SketchUp 6~2020 형식과 달라/);
  });

  it.each(ALL)('%s: 면·모서리·고리·재질·태그를 같은 중간 모형으로', (v) => {
    const m = model({
      schemas: v,
      materials: [
        { name: '앞', color: [200, 0, 0] },
        { name: '뒤', color: [0, 0, 200] },
      ],
      root: holed(),
    });
    expect(m.warnings).toEqual([]);
    expect(m.counts).toEqual({ vertices: 8, edges: 8, faces: 1, instances: 0 });
    const f = m.root.faces[0]!;
    // 바깥 고리를 앞으로, 뒤집힌 모서리 사용은 끝 정점에서 시작
    expect(f.loops).toEqual([
      [0, 1, 2, 3],
      [4, 7, 6, 5],
    ]);
    expect(f.loopEdges).toEqual([
      [0, 1, 2, 3],
      [7, 6, 5, 4],
    ]);
    expect(f.normal).toEqual([0, 0, 1]);
    expect([f.front, f.back, f.flags]).toEqual([0, 1, 1]);
    expect(m.root.edges.map((e) => e.flags)).toEqual([0, 0, 0, 1, 8, 16, 24, 0]);
    expect([...m.root.points.subarray(12, 15)]).toEqual([4, 4, 0]);
    expect([...m.materials.values()]).toEqual(['앞', '뒤']);
    expect(m.tags!.map((t) => t.name)).toEqual(['Layer0']);
    expect(m.defaultLayer).toBe(0);
  });

  it('영구 번호는 2017+(CEntity 5)만', () => {
    const spec = (v: 'v15' | 'v17'): MfcSpec => ({
      schemas: v,
      root: squareEntities({ edges: [{ a: 0, b: 1, pid: 300 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }] }),
    });
    expect(model(spec('v17')).root.edges[0]!.pid).toBe(300);
    expect(model(spec('v15')).root.edges[0]!.pid).toBeUndefined();
  });
});

describe('재질·태그·폴더', () => {
  it('재질 색·불투명도·표시 이름·무늬 평균색, 같은 이름은 열쇠를 가른다', () => {
    const r = read({
      materials: [
        { name: '유리', color: [100, 150, 200], transparency: 0.6, useAlpha: true },
        { name: '<Black>', display: '검정', color: [0, 0, 0] },
        { name: '나무', color: [0, 0, 0, 0], texture: { image: tiny, path: 'C:\\무늬\\나무.png', avg: [120, 80, 40, 255] } },
        { name: '유리', color: [1, 2, 3] },
        { name: '거의 투명', color: [9, 9, 9], transparency: 0.99, useAlpha: true },
      ],
      root: squareEntities(),
    });
    const keys = [...r.model.materials.values()];
    expect(keys).toEqual(['유리', '<Black>', '나무', '유리 (4)', '거의 투명']);
    const info = (k: string) => r.materials.get(k)!;
    expect(info('유리').color[3]).toBeCloseTo(0.4);
    expect(info('<Black>').name).toBe('검정');
    expect(info('나무').textured).toBe(true);
    expect(info('나무').color.slice(0, 3).map((x) => Math.round(x * 255))).toEqual([120, 80, 40]);
    expect(info('거의 투명').color[3]).toBe(0.15);
    expect(r.images.find((i) => i.kind === 'material')).toMatchObject({ folder: '나무', name: '나무.png' });
  });

  it('기본 태그를 맨 앞으로, 색 없는 태그는 회색, 숨김·활성 태그·요소 태그 차례', () => {
    const r = read({
      layers: [{ name: '벽', color: [10, 20, 30] }, { name: 'Layer0' }, { name: '지붕', hidden: true, color: [200, 0, 0] }],
      activeLayer: 2,
      root: squareEntities({ edges: [{ a: 0, b: 1, layer: 0 }, { a: 1, b: 2, layer: 1 }, { a: 2, b: 3, layer: 2 }, { a: 3, b: 0 }] }),
    });
    const m = r.model;
    expect(m.tags!.map((t) => [t.id, t.name, t.visible])).toEqual([
      [0, 'Layer0', true],
      [1, '벽', true],
      [2, '지붕', false],
    ]);
    expect([...m.layers]).toEqual([
      [0, 'Layer0'],
      [1, '벽'],
      [2, '지붕'],
    ]);
    const rgb = (i: number) => r.materials.get(m.tags![i]!.colorMaterial!)!.color.slice(0, 3).map((x) => Math.round(x * 255));
    expect(rgb(0)).toEqual([64, 64, 64]);
    expect(rgb(1)).toEqual([10, 20, 30]);
    expect(m.root.edges.map((e) => e.layer)).toEqual([1, 0, 2, undefined]);
    expect(m.activeLayer).toBe(2);
  });

  it('2019: 선 종류(앞머리를 두 번 쓴다), 실선은 없음', () => {
    const m = model({
      schemas: 'v19',
      layers: [{ name: 'Layer0', lineStyle: 'Solid Basic' }, { name: '점선', lineStyle: 'Dash' }],
      lineStyles: ['Solid Basic', 'Dash'],
      root: squareEntities(),
    });
    expect(m.tags!.map((t) => t.lineStyle)).toEqual([undefined, 'Dash']);
  });

  it('2020: 태그 폴더(뿌리 폴더는 빼고 앞 순회, 숨김, 든 태그)', () => {
    const m = model({
      schemas: 'v20',
      layers: [{ name: 'Layer0' }, { name: '1층 벽' }, { name: '1층 문' }, { name: '지붕' }],
      folders: [
        { name: '1층', layers: [1], children: [{ name: '문', hidden: true, layers: [2] }] },
        { name: '위', layers: [3] },
      ],
      root: squareEntities(),
    });
    expect(m.tagFolders).toEqual([
      { name: '1층', visible: true, parent: -1 },
      { name: '문', visible: false, parent: 0 },
      { name: '위', visible: true, parent: -1 },
    ]);
    expect(m.tags!.map((t) => t.folder)).toEqual([undefined, 0, 1, 2]);
  });
});

describe('정의·인스턴스·곡선', () => {
  const guid = new Uint8Array([0x78, 0x56, 0x34, 0x12, 0xbc, 0x9a, 0xf0, 0xde, 1, 2, 3, 4, 5, 6, 7, 8]);

  it('변환·이름·GUID(2014+)·숨김·잠김·정의 종류·동작, 정의 안 태그는 같은 이름의 모형 태그', () => {
    const m = model({
      layers: [{ name: 'Layer0' }, { name: '가구' }],
      definitions: [
        {
          name: '의자',
          description: '나무 의자',
          guid,
          entities: squareEntities({ edges: [{ a: 0, b: 1, layer: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }] }),
          behavior: { glue: true, snap: 1, cuts: true, faceCamera: true, noScale: 5 },
          vestigialLayers: ['Layer0', '가구'],
        },
        { name: 'Group#1', entities: squareEntities() },
        { name: '사진', entities: squareEntities() },
      ],
      root: {
        instances: [
          { def: 0, xform: [0, 1, 0, -1, 0, 0, 0, 0, 1, 5, 6, 7, 1], name: '왼쪽', guid, layer: 1, material: undefined },
          { def: 0, xform: ID13, hidden: true, locked: true },
          { kind: 'group', def: 1, xform: move13(1, 2, 3) },
          { kind: 'image', def: 2, xform: ID13, guid },
        ],
      },
    });
    const [a, b, g, img] = m.root.instances;
    // 3×3은 행으로 저장, 4×4는 열 우선
    expect([...a!.matrix]).toEqual([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    expect([a!.name, a!.kind, a!.layer]).toEqual(['왼쪽', 'component', 1]);
    expect(a!.guid).toHaveLength(22);
    expect(b!.flags).toBe(0x21);
    expect(g!.kind).toBe('group');
    expect([img!.kind, img!.guid]).toEqual(['image', undefined]);
    const defs = [...m.definitions.values()];
    expect(defs.map((d) => [d.id, d.name, d.kind])).toEqual([
      [0, '의자', 'component'],
      [1, 'Group#1', 'group'],
      [2, '사진', 'image'],
    ]);
    expect(defs[0]!.guid).toBe(a!.guid);
    expect(defs[0]!.description).toBe('나무 의자');
    expect(defs[0]!.behavior).toEqual({ alwaysFaceCamera: true, cutsOpening: true, shadowsFaceSun: false, snapTo: 'horizontal', noScaleMask: 5 });
    expect(defs[2]!.behavior).toBeUndefined();
    expect(defs[0]!.entities.edges[0]!.layer).toBe(1);
    expect(m.tags!.length).toBe(2);
    expect(m.counts.instances).toBe(4);
  });

  it('겹친 정의(정의 안의 인스턴스가 뒤 정의를 줄 안에 쓴다)', () => {
    const m = model({
      schemas: 'v18',
      definitions: [
        { name: '바깥', entities: { instances: [{ def: 1, xform: move13(0, 0, 10) }] } },
        { name: '안', entities: squareEntities() },
      ],
      root: { instances: [{ def: 0, xform: ID13, pid: 9 }] },
    });
    const outer = m.definitions.get(0)!;
    expect(outer.entities.instances[0]!.definition).toBe(1);
    expect(m.definitions.get(1)!.entities.faces.length).toBe(1);
    expect(m.root.instances[0]!.pid).toBe(9);
    const s = skpToScene(mfcFile({ schemas: 'v18', definitions: [{ name: '바깥', entities: { instances: [{ def: 1, xform: move13(0, 0, 10) }] } }, { name: '안', entities: squareEntities() }], root: { instances: [{ def: 0, xform: ID13 }] } }));
    expect(s.bounds!.min[2]).toBeCloseTo(10);
  });

  it('곡선: 닫힌 호는 시작각 정점에서 법선 둘레 반시계로, 다각형, 반지름 = x축 길이', () => {
    const N = 6;
    const vertices = Array.from({ length: N }, (_, i): [number, number, number] => [2 * Math.cos((i * 2 * Math.PI) / N), 2 * Math.sin((i * 2 * Math.PI) / N), 0]);
    // 모서리를 뒤섞어 쓴다(잇는 차례는 해석기가 정한다)
    const ring = Array.from({ length: N }, (_, i) => ({ a: i, b: (i + 1) % N, curve: 0 }));
    const edges = [ring[3]!, ring[0]!, ring[5]!, ring[1]!, ring[4]!, ring[2]!];
    const m = model({
      root: {
        vertices,
        edges: [...edges, { a: 0, b: 3, curve: 1 }],
        curves: [{ arc: { center: [0, 0, 0], normal: [0, 0, 1], xaxis: [2, 0, 0], start: (2 * Math.PI) / N, end: 2 * Math.PI } }, { polygon: true }],
      },
    });
    const [circle, poly] = m.root.curves!;
    expect(circle!.kind).toBe('circle');
    expect(circle!.radius).toBe(2);
    // 시작각 60° = 원 위 1번 점 → 1-2, 2-3, …, 0-1 차례(정점 번호는 모서리에서 처음 나온 차례라 각도로 견준다)
    const k = (v: number): number => (Math.round((Math.atan2(m.root.points[3 * v + 1]!, m.root.points[3 * v]!) * 3) / Math.PI) + 6) % 6;
    const order = circle!.edges.map((e) => [k(m.root.edges[e]!.a), k(m.root.edges[e]!.b)].sort((x, y) => x - y));
    expect(order).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [0, 5],
      [0, 1],
    ]);
    expect(poly!.kind).toBe('polygon');
    expect(m.root.edges[6]!.curve).toBe(1);
  });

  it('곡선 잇기: 열린 곡선은 자유 끝에서, 갈라지면 읽은 차례', () => {
    const edges = [
      { a: 1, b: 2, flags: 0 },
      { a: 0, b: 1, flags: 0 },
      { a: 2, b: 3, flags: 0 },
    ];
    const pos = [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0];
    expect(chainCurveEdges([0, 1, 2], edges, pos, { polygon: false })).toEqual([1, 0, 2]);
    const forked = [...edges, { a: 1, b: 3, flags: 0 }];
    expect(chainCurveEdges([0, 1, 2, 3], forked, pos, { polygon: false })).toEqual([0, 1, 2, 3]);
  });
});

describe('주석', () => {
  const ents = (): MfcEntitiesSpec =>
    squareEntities({
      curves: [{ arc: { center: [30, 0, 0], normal: [0, 0, 1], xaxis: [5, 0, 0], start: 0, end: Math.PI } }],
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
        [35, 0, 0],
        [25, 0, 0],
      ],
      edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }, { a: 4, b: 5, curve: 0 }],
      texts: [
        { text: '모서리 · Corner', leader: 2, at: { vertex: 2 }, leaderVec: [5, 5, 10], font: 0 },
        { text: '화면 글', leader: 0, screen: [0.1, 0.2] },
        { text: '가운데', leader: 1, at: { edge: 0, t: 0.25 }, leaderVec: [0, 0, 3], hidden: true },
      ],
      linearDims: [{ start: { edge: 0, t: 0 }, end: { edge: 0, t: 1 }, normal: [0, 0, 1], xaxis: [1, 0, 0], alignment: 0, distance: -4, textPos: 3, arrow: 1, aligned: true }],
      radialDims: [{ edge: 4, angle: Math.PI / 2, distance: 1.5, diameter: true }],
      guides: [
        { kind: 'line', point: [0, 0, 0], dir: [0, 1, 0], range: [-2, 8] },
        { kind: 'line', point: [1, 1, 1], dir: [1, 0, 0] },
        { kind: 'point', point: [3, 3, 3], hidden: true },
      ],
      sections: [
        { plane: [1, 0, 0, -5], name: '앞', symbol: 'A' },
        { plane: [0, 1, 0, -2], active: true },
      ],
    });

  it('문자: 붙은 점(정점·모서리 매개변수), 지시선, 화면 글, 글꼴', () => {
    const m = model({ schemas: 'v20', fonts: [{ face: '맑은 고딕', points: 14, bold: true }], root: ents() });
    const [pin, screen, mid] = m.root.texts!;
    expect(pin).toMatchObject({ text: '모서리 · Corner', leaderType: 'pushpin', point: [10, 10, 0], leader: [5, 5, 10] });
    expect(m.fonts!.get(pin!.font!)).toEqual({ face: '맑은 고딕', bold: true, italic: false, pointSize: 14 });
    expect(screen).toMatchObject({ leaderType: 'none', screen: [0.1, 0.2] });
    expect(screen!.point).toBeUndefined();
    expect(mid).toMatchObject({ leaderType: 'view_based', point: [2.5, 0, 0], flags: 1 });
  });

  it('치수: 선형(모서리에 붙은 끝, 2021+와 같은 띄움)과 지름(호의 중심·호 위 점·글 점)', () => {
    const m = model({ schemas: 'v20', root: ents() });
    const [lin, dia] = m.root.dimensions!;
    expect(lin).toMatchObject({ kind: 'linear', start: [0, 0, 0], end: [10, 0, 0], measureAxis: [1, 0, 0], arrow: 'slash', alignedText: true, textAlignment: 'outside' });
    expect(lin!.offset![1]).toBeCloseTo(-4);
    expect(dia!.kind).toBe('diameter');
    expect(dia!.center).toEqual([30, 0, 0]);
    expect(dia!.arcPoint![0]).toBeCloseTo(30);
    expect(dia!.arcPoint![1]).toBeCloseTo(5);
    expect(dia!.attach![1]).toBeCloseTo(7.5);
  });

  it('보조선(끝 있음·끝없음)·보조점, 단면 평면(활성·이름)', () => {
    const m = model({ schemas: 'v20', root: ents() });
    const [bounded, infinite, point] = m.root.guides!;
    expect(bounded).toMatchObject({ kind: 'line', start: [0, -2, 0], end: [0, 8, 0], point: [0, -2, 0], direction: [0, 1, 0] });
    expect(infinite!.start).toBeUndefined();
    expect(point).toMatchObject({ kind: 'point', point: [3, 3, 3], flags: 1 });
    expect(m.root.sections!.map((s) => [s.name, s.symbol, s.active])).toEqual([
      ['앞', 'A', false],
      ['', '', true],
    ]);
  });

  it('2018 전 파일은 단면 이름이 없어 SketchUp처럼 번호를 붙인다', () => {
    const m = model({ schemas: 'v15', definitions: [{ name: '판', entities: { sections: [{ plane: [0, 0, 1, 0] }] } }], root: ents() });
    expect(m.root.sections!.map((s) => [s.name, s.symbol])).toEqual([
      ['Section 1', '1'],
      ['Section 2', '2'],
    ]);
    expect(m.definitions.get(0)!.entities.sections![0]!.name).toBe('Section 3');
  });
});

describe('장면·스타일·설정', () => {
  const pageSpec = (schemas: 'v6' | 'v15' | 'v17' | 'v20'): MfcSpec => ({
    schemas,
    layers: [{ name: 'Layer0' }, { name: '지붕' }],
    definitions: [{ name: '상자', entities: squareEntities({ sections: [{ plane: [0, 0, 1, -1], pid: 51 }] }) }],
    root: squareEntities({ instances: [{ def: 0, xform: ID13, pid: 41 }, { def: 0, xform: move13(20, 0, 0), pid: 42 }], sections: [{ plane: [1, 0, 0, 0], pid: 50, active: true }] }),
    options: [
      ['UnitsOptions', [['LengthUnit', mv.i32(2)], ['LengthFormat', mv.i32(0)], ['LengthPrecision', mv.i32(1)]]],
      ['PageOptions', [['ShowTransition', mv.bool(true)], ['TransitionTime', mv.f64(1.5)]]],
      ['SlideshowOptions', [['SlideTime', mv.f64(2)], ['LoopSlideshow', mv.bool(true)]]],
    ],
    camera: { eye: [100, -100, 80], target: [20, 15, 10], up: [0, 0, 1], fov: 35 },
    styles: [
      { name: '기본 스타일', items: [[2002, 5, [10, 20, 30, 255]], [1000, 4, 1], [7013, 4, 1], [4002, 1, true]] },
      { name: '와이어', items: [[4000, 5, [0, 0, 0, 255]]] },
    ],
    activeStyle: 0,
    currentStyle: { name: '기본 스타일', items: [[2002, 5, [10, 20, 30, 255]], [1000, 4, 1], [7013, 4, 1], [4002, 1, true]] },
    pages: [
      { name: '원근', description: '앞에서', flags: 0x21, camera: { eye: [10, 0, 0], target: [0, 0, 0], up: [0, 0, 1], fov: 40 }, layers: [1], include: true },
      {
        name: '평행',
        flags: 0x5f,
        camera: { eye: [0, 0, 50], target: [0, 0, 0], up: [0, 1, 0], perspective: false, height: 30 },
        rendering: { mode: 0 },
        style: 1,
        hidden: [{ kind: 'instance', index: 1 }, { kind: 'face', index: 0, def: 0 }],
        sections: [{ index: 0, def: 0 }],
        transition: 3,
        delay: 0,
        include: false,
      },
    ],
    activePage: 1,
    fonts: [{ face: 'Arial', points: 12 }, { face: 'Tahoma', points: 10, worldSize: 6 }],
    defaults: { dimFont: 0, textFont: 1, leaderFont: 0, textColor: [1, 2, 3], leaderColor: [4, 5, 6], leaderType: 2, leaderArrow: 2, dimColor: [7, 8, 9], dimArrow: 4, dimAligned: true, dimTextPos: 0 },
  });

  it('장면: 카메라·숨긴 태그·깃발(0x10 → 숨긴 형상 + 숨긴 개체)·전환·활성 장면', () => {
    const m = model(pageSpec('v17'));
    const [a, b] = m.pages!;
    expect([a!.name, a!.description, a!.flags]).toEqual(['원근', '앞에서', 0x21]);
    expect(a!.camera).toMatchObject({ eye: [10, 0, 0], perspective: true, fov: 40 });
    expect(a!.hiddenTags).toEqual([1]);
    // 장면 값이 없으면 모형 기본(PageOptions·SlideshowOptions)
    expect([a!.transition, a!.delay, a!.includeInAnimation]).toEqual([1.5, 2, true]);
    expect(b!.flags).toBe((0x5f & ~0x10) | 0x180);
    expect(b!.camera).toMatchObject({ perspective: false, height: 30 });
    expect([b!.transition, b!.delay, b!.includeInAnimation]).toEqual([3, 0, false]);
    expect(b!.hiddenIds.sort()).toEqual([42, m.definitions.get(0)!.entities.faces[0]!.pid].sort());
    expect(b!.sectionIds).toEqual([51]);
    expect(m.activePage).toBe(1);
    expect(m.animation).toEqual({ showTransition: true, transitionTime: 1.5, sceneDelay: 2, loop: true });
  });

  it('SketchUp 6: 설정 묶음(단위·장면 넘기기)은 꼬리에서, 속성 사전 끝 u32·늘이지 않음 마스크는 없다', () => {
    const base = pageSpec('v6');
    const m = model({
      ...base,
      rootAttrs: [['모형', [['수', mv.i32(3)]]]],
      definitions: [{ ...base.definitions![0]!, behavior: { glue: true, snap: 1, faceCamera: true, noScale: 5 } }],
    });
    expect(m.warnings).toEqual([]);
    expect(m.lengthUnit).toBe(2);
    expect(m.units).toMatchObject({ lengthUnit: 'mm' });
    expect(m.animation).toEqual({ showTransition: true, transitionTime: 1.5, sceneDelay: 2, loop: true });
    expect(m.camera).toMatchObject({ eye: [100, -100, 80], fov: 35 });
    expect(m.pages!.map((p) => p.name)).toEqual(['원근', '평행']);
    expect(m.activePage).toBe(1);
    expect(m.root.attrs).toEqual({ 모형: { 수: 3 } });
    // 동작 덩어리가 38바이트라 늘이지 않음 마스크 칸이 없다
    expect(m.definitions.get(0)!.behavior).toEqual({ alwaysFaceCamera: true, cutsOpening: false, shadowsFaceSun: false, snapTo: 'horizontal' });
    expect(m.root.instances).toHaveLength(2);
    expect(m.annotationDefaults).toMatchObject({ dimColor: [7, 8, 9], textColor: [1, 2, 3] });
  });

  it('영구 번호가 없는 파일(2016 이하)은 숨긴 대상에 음수 임시 번호를 붙여 잇는다', () => {
    const m = model(pageSpec('v15'));
    const b = m.pages![1]!;
    const inst = m.root.instances[1]!;
    expect(inst.pid).toBeLessThan(0);
    expect(b.hiddenIds).toContain(inst.pid);
    expect(b.sectionIds).toEqual([m.definitions.get(0)!.entities.sections![0]!.pid]);
    // 장면 적용: 숨긴 인스턴스가 나무 노드로 이어진다
    const s = skpToScene(mfcFile(pageSpec('v15')), { outline: true });
    const pages = s.meta!.pages as { name: string; hiddenNodes?: number[]; sectionPlanes?: number[] }[];
    expect(pages[1]!.hiddenNodes).toEqual([1]);
    expect(pages[1]!.sectionPlanes!.length).toBeGreaterThan(0);
  });

  it('스타일: 색·켜고 끄기는 스타일 값이, 그리기 방식은 렌더링 덩어리가 이긴다', () => {
    const r = read(pageSpec('v20'));
    const m = r.model;
    const st = styleFor(m.rendering, r.styles)!;
    expect(st.name).toBe('기본 스타일');
    expect(st.front!.map((x) => Math.round(x * 255))).toEqual([10, 20, 30]);
    expect(st.faceStyle).toBe('textured');
    expect([st.edges, st.sectionPlanes, st.sectionCuts]).toEqual([true, true, false]);
    // 하늘: 스타일이 켰지만 덩어리에 색이 없다 → 켜짐만 알고 색은 덩어리 값(0)
    expect(st.sky).toEqual([0, 0, 0]);
    const page = styleFor(m.pages![1]!.rendering, r.styles)!;
    expect(page.name).toBe('와이어');
    expect(page.faceStyle).toBe('wireframe');
    expect(page.background).toEqual([0, 0, 0]);
  });

  it('작업 사본이 있으면 모형 스타일은 그것, 없으면 스타일 목록 끝', () => {
    const r = read({ ...pageSpec('v20'), currentStyle: { name: '기본 스타일', items: [[2002, 5, [90, 90, 90, 255]]] } });
    expect(styleFor(r.model.rendering, r.styles)!.front!.map((x) => Math.round(x * 255))).toEqual([90, 90, 90]);
    const plain = read({ ...pageSpec('v20'), activeStyle: undefined, currentStyle: undefined });
    expect(styleFor(plain.model.rendering, plain.styles)!.name).toBe('와이어');
  });

  it('카메라·단위(2019 전 파일은 넓이·부피를 길이 단위로)·글꼴·문자/치수 기본값·이름', () => {
    const m = model({ ...pageSpec('v17'), name: '작은 집', description: '설명 글' });
    expect(m.camera).toMatchObject({ eye: [100, -100, 80], target: [20, 15, 10], perspective: true, fov: 35, twoPoint: false });
    expect(m.lengthUnit).toBe(2);
    expect(m.units).toMatchObject({ lengthUnit: 'mm', areaUnit: 'square_mm', areaPrecision: 2, volumeUnit: 'cubic_mm', volumePrecision: 2 });
    expect([m.name, m.description]).toEqual(['작은 집', '설명 글']);
    expect(m.properties!['ModelProperties']).toEqual({ Name: '작은 집' });
    const fonts = [...m.fonts!.values()];
    expect(fonts).toEqual([
      { face: 'Arial', bold: false, italic: false, pointSize: 12 },
      { face: 'Tahoma', bold: false, italic: false, pointSize: 10, worldSize: 6 },
    ]);
    const d = m.annotationDefaults!;
    expect(m.fonts!.get(d.textFont!)!.face).toBe('Tahoma');
    expect(m.fonts!.get(d.dimFont!)!.face).toBe('Arial');
    expect(d).toMatchObject({ textColor: [1, 2, 3], leaderColor: [4, 5, 6], leaderType: 'pushpin', leaderArrow: 'dot', dimColor: [7, 8, 9], dimArrow: 'open', dimAlignedText: true, dimTextAlignment: 'above' });
  });

  it('속성 사전: 모든 값 꼴과 모형·정의·인스턴스·면·모서리·태그', () => {
    const dicts = (n: string): [string, [string, ReturnType<typeof mv.i32>][]][] => [[n, [['수', mv.i32(-5)]]]];
    const m = model({
      schemas: 'v20',
      rootAttrs: [
        [
          '모두',
          [
            ['nil', mv.nil()],
            ['byte', mv.byte(200)],
            ['i16', mv.i16(-300)],
            ['i32', mv.i32(70000)],
            ['f32', mv.f32(0.5)],
            ['f64', mv.f64(1.25)],
            ['bool', mv.bool(true)],
            ['color', mv.color(1, 2, 3, 4)],
            ['time', mv.time(1_700_000_000)],
            ['str', mv.str('한글')],
            ['arr', mv.arr(mv.i32(1), mv.str('x'))],
            ['length', mv.length(12)],
            ['point', mv.point(1, 2, 3)],
            ['vec', mv.vec(0, 0, 1)],
            ['__proto__', mv.i32(1)],
          ],
        ],
      ],
      layers: [{ name: 'Layer0', attrs: dicts('태그') }],
      definitions: [{ name: '판', entities: { ...squareEntities(), attrs: dicts('정의') } }],
      root: squareEntities({
        edges: [{ a: 0, b: 1, attrs: dicts('모서리') }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }],
        faces: [{ ...squareEntities().faces![0]!, attrs: dicts('면'), textureCoords: true }],
        instances: [{ def: 0, xform: ID13, attrs: dicts('인스턴스') }],
      }),
    });
    const all = m.root.attrs!['모두']!;
    expect(all).toMatchObject({
      nil: null,
      byte: 200,
      i16: -300,
      i32: 70000,
      f32: 0.5,
      f64: 1.25,
      bool: true,
      color: { kind: 'color', rgba: [1, 2, 3, 4] },
      time: { kind: 'time', epoch: 1_700_000_000 },
      str: '한글',
      arr: [1, 'x'],
      length: { kind: 'length', inch: 12 },
      point: { kind: 'point', xyz: [1, 2, 3] },
      vec: { kind: 'vector', xyz: [0, 0, 1] },
    });
    expect(Object.prototype.hasOwnProperty.call(all, '__proto__')).toBe(true);
    expect(m.tags![0]!.attrs).toEqual({ 태그: { 수: -5 } });
    expect(m.definitions.get(0)!.entities.attrs).toEqual({ 정의: { 수: -5 } });
    expect(m.root.edges[0]!.attrs).toEqual({ 모서리: { 수: -5 } });
    expect(m.root.faces[0]!.attrs).toEqual({ 면: { 수: -5 } });
    expect(m.root.instances[0]!.attrs).toEqual({ 인스턴스: { 수: -5 } });
  });

  it('SketchUp 7: 재질 없는 면 쪽은 다른 쪽의 반투명 재질을 보인다', () => {
    const spec = (v: 'v7' | 'v8'): MfcSpec => ({
      schemas: v,
      materials: [{ name: '유리', color: [0, 0, 255], transparency: 0.5, useAlpha: true }],
      root: squareEntities({ faces: [{ ...squareEntities().faces![0]!, front: 0 }] }),
    });
    expect(model(spec('v7')).root.faces[0]!.back).toBe(0);
    expect(model(spec('v8')).root.faces[0]!.back).toBeUndefined();
  });
});

describe('깨진 파일·모르는 기록', () => {
  const full = (): Uint8Array =>
    mfcFile({
      schemas: 'v17',
      definitions: [{ name: '판', entities: squareEntities() }],
      root: squareEntities({ instances: [{ def: 0, xform: move13(20, 0, 0) }] }),
      pages: [{ name: '장면', flags: 0x1, camera: { eye: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1] } }],
    });

  it('형상 가운데에서 잘리면 앞부분 형상을 살리고 damaged', () => {
    const bytes = full();
    let cut = bytes.length;
    // 정의 하나가 다 들어가고 뿌리 형상이 덜 들어간 자리를 찾는다
    for (let n = bytes.length - 1; n > 100; n--) {
      const r = readMfcModel(bytes.subarray(0, n), readSkpHeader(bytes)!);
      if (r.model.definitions.size === 1 && r.model.root.faces.length === 0 && r.model.definitions.get(0)!.entities.faces.length === 1) {
        cut = n;
        break;
      }
    }
    expect(cut).toBeLessThan(bytes.length);
    const s = skpToScene(bytes.subarray(0, cut));
    expect(s.meta?.damaged).toBe(true);
    expect(s.warnings!.some((w) => w.includes('형상을 읽다 멈췄습니다') && w.includes('잘렸습니다'))).toBe(true);
    // 읽다 끊긴 모서리는 빼고, 다 읽은 것은 그린다
    const m = readMfcModel(bytes.subarray(0, cut), readSkpHeader(bytes)!).model;
    expect(m.root.edges.every((e) => e.a >= 0 && e.b >= 0)).toBe(true);
  });

  it('형상 뒤(장면·스타일)에서 잘리면 형상은 그대로 두고 경고', () => {
    const bytes = full();
    const m = readMfcModel(bytes.subarray(0, bytes.length - 40), readSkpHeader(bytes)!).model;
    expect(m.root.faces.length).toBe(1);
    expect(m.root.instances.length).toBe(1);
    expect(m.pages).toBeUndefined();
    expect(m.damaged).toBe(true);
    expect(m.warnings.some((w) => w.includes('장면·스타일을 읽지 못했습니다'))).toBe(true);
  });

  it('읽는 함수가 없는 클래스를 만나면 그 앞까지 그리고 까닭을 적는다(손상은 아니다)', () => {
    const m = model({ root: squareEntities({ unknownClass: 'CFutureThing' }) });
    expect(m.root.faces.length).toBe(1);
    expect(m.damaged).toBeUndefined();
    expect(m.warnings.some((w) => w.includes('CFutureThing'))).toBe(true);
  });

  it('형상 앞에서 멈추면 빈 장면과 경고, 머리만 있는 파일도 견딘다', () => {
    const bytes = full();
    const s = skpToScene(bytes.subarray(0, 200));
    expect(s.meshes.length).toBe(0);
    expect(s.warnings![0]).toContain('SketchUp 파일을 읽지 못했습니다');
    expect(s.meta?.unsupported).toBeUndefined();
  });

  it('모서리가 셋보다 적은 고리의 면은 그 면만 건너뛴다', () => {
    const m = model({
      root: squareEntities({
        faces: [
          squareEntities().faces![0]!,
          {
            plane: [0, 0, 1, 0],
            loops: [
              {
                uses: [
                  [0, false],
                  [1, false],
                ],
              },
            ],
          },
        ],
      }),
    });
    expect(m.root.faces.length).toBe(1);
    expect(m.warnings).toContain('모서리가 셋보다 적은 고리를 가진 면을 건너뛰었습니다');
  });

  it('바이트를 무작위로 망가뜨려도 던지지 않는다', () => {
    const bytes = full();
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const bad = bytes.slice();
      for (let j = 0; j < 3; j++) bad[80 + rnd(bad.length - 80)] = rnd(256);
      expect(() => skpToScene(bad)).not.toThrow();
      expect(() => readSkpImages(bad)).not.toThrow();
    }
  });
});

describe('장면 출력과 그림', () => {
  const house = (): Uint8Array =>
    mfcFile({
      schemas: 'v20',
      thumbnail: tiny,
      materials: [
        { name: '벽돌', color: [180, 60, 40] },
        { name: '나무', color: [0, 0, 0, 0], texture: { image: tiny, path: 'wood.png', avg: [140, 100, 60, 255] } },
        { name: '옛 그림', color: [1, 1, 1], texture: { image: dib2x1(), kind: 0, path: 'old.bmp' } },
      ],
      layers: [{ name: 'Layer0' }, { name: '지붕', color: [200, 0, 0] }],
      definitions: [{ name: '의자', entities: squareEntities({ faces: [{ ...squareEntities().faces![0]!, front: 1 }] }), thumbnail: tiny }],
      root: squareEntities({
        faces: [{ ...squareEntities().faces![0]!, front: 0, layer: 1 }],
        instances: [{ def: 0, xform: move13(20, 0, 0), name: '의자 1' }],
        texts: [{ text: '안녕', leader: 2, at: { vertex: 0 }, leaderVec: [0, 0, 5] }],
      }),
      styles: [{ name: '스타일', items: [[2002, 5, [250, 240, 230, 255]]] }],
      pages: [{ name: '앞', flags: 0x1, camera: { eye: [0, -50, 10], target: [0, 0, 0], up: [0, 0, 1] }, thumbnail: tiny }],
      options: [['UnitsOptions', [['LengthUnit', mv.i32(3)]]]],
    });

  /** 2×1 24비트 아래에서 위로 날 DIB(BITMAPINFOHEADER) */
  function dib2x1(): Uint8Array {
    const b = new Uint8Array(40 + 8);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, 40, true);
    dv.setInt32(4, 2, true);
    dv.setInt32(8, 1, true);
    dv.setUint16(12, 1, true);
    dv.setUint16(14, 24, true);
    b.set([0, 0, 255, 0, 255, 0], 40);
    return b;
  }

  it('2021+와 같은 장면: 그물·모서리·meta(판·단위·태그·재질·장면·스타일·문자)', () => {
    const s = skpToScene(house(), { outline: true, extras: true });
    expect(s.warnings).toEqual([]);
    expect(s.units).toBe('mm');
    const meta = s.meta as Record<string, any>;
    expect(meta.container).toBe('mfc');
    expect(meta.version).toBe('20.0.1');
    expect(meta.lengthUnit).toBe('cm');
    expect(meta.faces).toBe(2);
    expect(meta.definitions).toBe(1);
    expect(meta.tags).toEqual(['Layer0', '지붕']);
    const stats = meta.materialStats as { name: string; folder?: string; textured: boolean; color: number[] }[];
    expect(stats.find((m) => m.folder === '나무')?.textured).toBe(true);
    expect(stats.find((m) => m.folder === '벽돌')?.color.slice(0, 3).map((x) => Math.round(x * 255))).toEqual([180, 60, 40]);
    expect(meta.tagStats.find((t: { name: string }) => t.name === '지붕').color.slice(0, 3).map((x: number) => Math.round(x * 255))).toEqual([200, 0, 0]);
    expect(meta.pages[0].name).toBe('앞');
    expect(meta.pages[0].camera.eye[1]).toBeCloseTo(-50 * 25.4);
    expect(meta.style.front.map((x: number) => Math.round(x * 255))).toEqual([250, 240, 230]);
    expect(meta.texts[0].text).toBe('안녕');
    expect(meta.tree).toBeDefined();
    expect(meta.unsupported).toBeUndefined();
    // 판 안내를 띄우지 않는다
    expect(s.meshes.reduce((n, m) => n + m.indices!.length / 3, 0)).toBe(4);
  });

  it('readSkpImages: 모형·재질(폴더 = 재질 열쇠)·컴포넌트·장면 미리보기, 날 DIB는 BMP로', () => {
    const bytes = house();
    const img = readSkpImages(bytes);
    expect(img.model?.mime).toBe('image/png');
    expect(img.materials.map((m) => [m.folder, m.mime])).toEqual([
      ['나무', 'image/png'],
      ['옛 그림', 'image/bmp'],
    ]);
    const bmp = img.materials[1]!.bytes;
    expect(new DataView(bmp.buffer, bmp.byteOffset).getUint32(10, true)).toBe(54);
    expect(img.components.map((c) => c.name)).toEqual(['의자']);
    // 장면 미리보기 경로가 장면의 thumbnail과 같다
    const s = skpToScene(bytes);
    expect(img.scenes[0]!.path).toBe((s.meta as Record<string, any>).pages[0].thumbnail);
    expect(img.skipped).toBe(0);
    // 장면을 만들 때 모은 자리를 쓴다(같은 바이트 객체)
    const again = readSkpImages(bytes);
    expect(again.materials.length).toBe(2);
    expect(readSkpImages(bytes, { maxCount: 1 }).skipped).toBeGreaterThan(0);
  });
});

describe('무늬(2020 이하: CTexture·CFaceTextureCoords)', () => {
  /** 열 우선 3×3(무늬 인치 → 평면 틀): 2배 늘리고 x로 5인치 옮김. 쪽마다 f64 12개(뒤 3개는 해석기가 쓰지 않는다) */
  const moved = [2, 0, 0, 0, 2, 0, 5, 0, 1, 0, 0, 0];
  const spec = (face: Partial<NonNullable<MfcEntitiesSpec['faces']>[number]>, extra: Partial<MfcSpec> = {}): MfcSpec => ({
    schemas: 'v15',
    materials: [
      { name: '벽돌', color: [180, 60, 40] },
      { name: '나무', color: [0, 0, 0, 0], texture: { image: tiny, path: 'C:\\maps\\wood.png', width: 20, height: 10, avg: [140, 100, 60, 255] } },
      { name: '색 바꾼 돌', color: [30, 90, 200], type: 2, texture: { image: tiny, path: 'stone.png', width: 0, height: -3 } },
    ],
    root: squareEntities({ faces: [{ ...squareEntities().faces![0]!, ...face }] }),
    ...extra,
  });
  const uvs = (s: ReturnType<typeof skpToScene>): number[][] => {
    const m = s.meshes.find((x) => x.uvs)!;
    const stride = m.uvs!.length / (m.positions.length / 3);
    const out: number[][] = [];
    for (let i = 0; i < m.positions.length / 3; i++) out.push([m.positions[3 * i]!, m.positions[3 * i + 1]!, m.uvs![stride * i]!, m.uvs![stride * i + 1]!]);
    return out;
  };

  it('재질 무늬 크기(인치)·평균색·색 바꾸기(꼴 2)를 2021+ material.xml과 같은 꼴로 읽는다', () => {
    const r = read(spec({ front: 1 }));
    expect(r.materials.get('나무')!.texture).toEqual({ width: 20, height: 10, average: [140, 100, 60], file: 'wood.png' });
    expect(r.materials.get('나무')!.colorize).toBeUndefined();
    // 크기가 0·음수면 1인치(2021+ 읽기와 같게), 꼴 2는 색 바꾸기(방식 0 = shift)
    expect(r.materials.get('색 바꾼 돌')!.texture).toMatchObject({ width: 1, height: 1 });
    expect(r.materials.get('색 바꾼 돌')!.colorize).toBe('shift');
    expect(r.materials.get('벽돌')!.texture).toBeUndefined();
  });

  it('면 무늬 위치: 그쪽 재질이 무늬 재질이고 깃발 비트 0이 있을 때만 앞 9개를 열 우선 행렬로', () => {
    const face = (f: Parameters<typeof spec>[0]) => model(spec(f)).root.faces[0]!;
    const fm = face({ front: 1, back: 0, textureCoords: { front: moved, back: moved, frontFlags: 1, backFlags: 1 } });
    expect(fm.frontMap).toEqual({ kind: 0, matrix: Float64Array.from(moved.slice(0, 9)) });
    // 뒤 재질(벽돌)은 무늬가 없다 — 남아 있는 위치를 읽지 않는다
    expect(fm.backMap).toBeUndefined();
    expect(face({ front: 1, textureCoords: { front: moved, frontFlags: 0 } }).frontMap).toBeUndefined();
    expect(face({ front: 0, textureCoords: { front: moved, frontFlags: 1 } }).frontMap).toBeUndefined();
    expect(face({ back: 1, textureCoords: { back: moved, backFlags: 1, frontFlags: 0 } }).backMap?.matrix[6]).toBe(5);
  });

  it('readSkpImages의 그림을 넘기면 무늬 좌표·무늬 id·장면 무늬를 둔다(저장된 위치, 없으면 기본 투영)', () => {
    const stored = mfcFile(spec({ front: 1, textureCoords: { front: moved, frontFlags: 1 } }));
    const s = skpToScene(stored, { textures: readSkpImages(stored).materials });
    expect(s.textures?.map((t) => t.mime)).toEqual(['image/png']);
    const meta = s.meta as Record<string, any>;
    expect(meta.textures[0]).toMatchObject({ material: '나무', folder: '나무', tile: [20, 10] });
    expect(meta.materialStats.find((m: { folder: string }) => m.folder === '나무').texture).toBe(s.textures![0]!.id);
    // 저장된 행렬: 무늬 좌표 = M⁻¹·평면 좌표 → 가로 10인치에 u가 10 / 2 / 20 = 0.25 늘어난다
    const a = uvs(s);
    const at = (x: number, y: number) => a.find((p) => Math.abs(p[0]! - x * 25.4) < 1e-3 && Math.abs(p[1]! - y * 25.4) < 1e-3) ?? a.find((p) => p[0] === x && p[1] === y)!;
    expect(at(10, 0)[2]! - at(0, 0)[2]!).toBeCloseTo(0.25);
    expect(at(0, 10)[3]! - at(0, 0)[3]!).toBeCloseTo(0.5);
    // 위치가 없는 면은 기본 투영: u = x / 20, v = y / 10
    const plain = mfcFile(spec({ front: 1 }));
    const b = uvs(skpToScene(plain, { textures: readSkpImages(plain).materials }));
    const bt = (x: number, y: number) => b.find((p) => Math.abs(p[0]! - x * 25.4) < 1e-3 && Math.abs(p[1]! - y * 25.4) < 1e-3) ?? b.find((p) => p[0] === x && p[1] === y)!;
    expect(bt(10, 0)[2]! - bt(0, 0)[2]!).toBeCloseTo(0.5);
    expect(bt(0, 10)[3]! - bt(0, 0)[3]!).toBeCloseTo(1);
    // 그림을 넘기지 않으면 예전처럼 평균색만
    const none = skpToScene(plain);
    expect(none.textures).toBeUndefined();
    expect(none.meshes.some((m) => m.uvs)).toBe(false);
  });

  it('색 바꾼 무늬는 meta.textures에 색 바꾸기를 적고, maxTextures를 넘는 재질은 평균색으로 경고한다', () => {
    const bytes = mfcFile(
      spec(
        { front: 2 },
        { root: squareEntities({ faces: [{ ...squareEntities().faces![0]!, front: 2 }, { ...squareEntities().faces![0]!, plane: [0, 0, -1, 0], front: 1 }] }) },
      ),
    );
    const s = skpToScene(bytes, { textures: readSkpImages(bytes).materials });
    const t = (s.meta as Record<string, any>).textures.find((x: { folder: string }) => x.folder === '색 바꾼 돌');
    expect(t.colorize).toEqual({ type: 'shift', color: [30, 90, 200], average: [128, 128, 128] });
    const limited = skpToScene(bytes, { textures: readSkpImages(bytes).materials, maxTextures: 1 });
    expect(limited.textures?.length).toBe(1);
    expect(limited.warnings?.some((w) => w.includes('1개 한도'))).toBe(true);
  });

  it('그림을 먼저 꺼내면(워커 차례) 그때 읽은 모형을 skpToScene이 이어 써서 두 번 읽지 않는다', async () => {
    const mod = await import('../src/mfcmodel');
    const bytes = mfcFile(spec({ front: 1 }));
    const seen: number[] = [];
    readSkpImages(bytes, { onProgress: (f) => seen.push(f) });
    expect(seen.length).toBeGreaterThanOrEqual(0);
    const kept = mod.takeMfcResult(bytes);
    expect(kept?.model.root.faces.length).toBe(1);
    // 꺼낸 것은 한 번만 쓴다
    expect(mod.takeMfcResult(bytes)).toBeUndefined();
    // skpToScene 뒤에는 남지 않는다
    readSkpImages(bytes);
    skpToScene(bytes);
    expect(mod.takeMfcResult(bytes)).toBeUndefined();
  });
});

describe('성능', () => {
  it('면 2만 개 남짓(격자)을 몇 초 안에', () => {
    const n = 100;
    const vertices: [number, number, number][] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vertices.push([i, j, 0]);
    const at = (i: number, j: number): number => j * (n + 1) + i;
    const edges: { a: number; b: number }[] = [];
    const h = new Map<string, number>();
    const edge = (a: number, b: number): number => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let e = h.get(k);
      if (e === undefined) {
        e = edges.length;
        edges.push({ a, b });
        h.set(k, e);
      }
      return e;
    };
    const faces: MfcEntitiesSpec['faces'] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        const uses: [number, boolean][] = v.map((a, k) => {
          const b = v[(k + 1) % 4]!;
          const e = edge(a, b);
          return [e, edges[e]!.a !== a];
        });
        faces.push({ plane: [0, 0, 1, 0], loops: [{ uses }] });
        faces.push({ plane: [0, 0, 1, 0], loops: [{ uses }] });
      }
    const bytes = mfcFile({ schemas: 'v20', root: { vertices, edges, faces } });
    const t0 = performance.now();
    const m = readMfcModel(bytes, readSkpHeader(bytes)!).model;
    const ms = performance.now() - t0;
    expect(m.counts.faces).toBe(2 * n * n);
    expect(m.warnings).toEqual([]);
    expect(ms).toBeLessThan(5000);
  });
});
