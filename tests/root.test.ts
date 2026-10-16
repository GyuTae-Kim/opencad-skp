import { describe, expect, it } from 'vitest';
import { readModelDat } from '../src/model';
import { parseStyleXml, resolveStyle } from '../src/styles';
import { TlvReader } from '../src/tlv';
import { IDENTITY13, edge, entities, face, f64, i32, instance, modelDat, packedIds, rendering, rgba, styleXml, tlv, u8, uintLE, val, vertex, type CamOpts } from './build';

/** 삼각형 하나(모형 요소) — 뿌리 절 시험에서 형상이 그대로 읽히는지 보려고 */
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
    components: [instance(8, 50, IDENTITY13)],
  });

const DEF = { name: '판', entities: entities(50, {}) };

/** 엔진 표준 파일 scenes.skp의 UnitsOptions(F:scenes): 건축 형식, 정밀도 4 */
const UNITS: [string, Uint8Array][] = [
  ['LengthPrecision', val.i32(4)],
  ['LengthFormat', val.i32(1)],
  ['LengthUnit', val.i32(0)],
  ['AnglePrecision', val.i32(1)],
  ['SuppressUnitsDisplay', val.bool(false)],
  ['ForceInchDisplay', val.bool(false)],
  ['AreaUnit', val.i32(0)],
  ['VolumeUnit', val.i32(0)],
  ['AreaPrecision', val.i32(2)],
  ['VolumePrecision', val.i32(2)],
  ['LengthSnapLength', val.f64(0.25)],
];

describe('단위 설정(UnitsOptions)', () => {
  it('엔진 표준 파일 값: 길이·넓이·부피 단위와 형식·정밀도', () => {
    const m = readModelDat(modelDat({ root: tri(), options: [['UnitsOptions', UNITS]] }));
    expect(m.units).toEqual({
      lengthUnit: 'inch',
      lengthFormat: 'architectural',
      lengthPrecision: 4,
      anglePrecision: 1,
      areaUnit: 'square_inch',
      areaPrecision: 2,
      volumeUnit: 'cubic_inch',
      volumePrecision: 2,
      suppressUnits: false,
    });
    expect(m.lengthUnit).toBe(0);
  });

  it('mm·㎡·리터, 없는 열쇠는 null, 모르는 코드는 inch·decimal·null', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        options: [['UnitsOptions', [['LengthUnit', val.i32(2)], ['AreaUnit', val.i32(4)], ['VolumeUnit', val.i32(6)], ['SuppressUnitsDisplay', val.bool(true)]]]],
      }),
    );
    expect(m.units).toMatchObject({ lengthUnit: 'mm', lengthFormat: 'decimal', lengthPrecision: 1, areaUnit: 'square_m', areaPrecision: null, volumeUnit: 'liter', suppressUnits: true });
    expect(m.lengthUnit).toBe(2);
    const odd = readModelDat(modelDat({ root: tri(), options: [['UnitsOptions', [['LengthUnit', val.i32(9)], ['LengthFormat', val.i32(7)], ['AreaUnit', val.i32(42)]]]] }));
    expect(odd.units).toMatchObject({ lengthUnit: 'inch', lengthFormat: 'decimal', areaUnit: null, volumeUnit: null });
  });

  it('예전 lengthUnit만 쓴 파일도 같고, 설정이 없으면 units를 비운다', () => {
    expect(readModelDat(modelDat({ root: tri(), lengthUnit: 4 })).units?.lengthUnit).toBe('m');
    expect(readModelDat(modelDat({ root: tri() })).units).toBeUndefined();
  });

  it('장면 전환·지연 모형 기본값(PageOptions·SlideshowOptions)', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        options: [
          ['PageOptions', [['ShowTransition', val.bool(true)], ['TransitionTime', val.f64(1.5)]]],
          ['SlideshowOptions', [['LoopSlideshow', val.bool(true)], ['SlideTime', val.f64(1)]]],
        ],
      }),
    );
    expect(m.animation).toEqual({ showTransition: true, transitionTime: 1.5, sceneDelay: 1, loop: true });
  });
});

const MODEL_CAM: CamOpts = { eye: [120, -150, 90], target: [20, 15, 10], up: [-0.19852029587371403, 0.3275584881916281, 0.9237397517373755], fov: 40 };

describe('카메라', () => {
  it('모형 카메라(01fa): 원근이면 시야각만, 평행이면 높이만', () => {
    const m = readModelDat(modelDat({ root: tri(), camera: MODEL_CAM }));
    expect(m.camera).toEqual({ eye: [120, -150, 90], target: [20, 15, 10], up: MODEL_CAM.up, perspective: true, fov: 40, twoPoint: false });
    const p = readModelDat(modelDat({ root: tri(), camera: { eye: [20, 15, 200], target: [20, 15, 0], up: [0, 1, 0], perspective: false, height: 80, aspect: 1.5, twoPoint: true } }));
    expect(p.camera).toEqual({ eye: [20, 15, 200], target: [20, 15, 0], up: [0, 1, 0], perspective: false, height: 80, aspect: 1.5, twoPoint: true });
  });

  it('최소 배치(34bd·34be·34bf만)는 원근, 깨진 벡터·눈 = 목표는 카메라 없음', () => {
    const minimal = tlv(0x01fa, tlv(0x34bc, tlv(0x34bd, f64(1, 2, 3)), tlv(0x34be, f64(0, 0, 0)), tlv(0x34bf, f64(0, 0, 1))));
    expect(readModelDat(modelDat({ root: tri(), sections: [minimal] })).camera).toEqual({ eye: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], perspective: true, twoPoint: false });
    const bad = tlv(0x01fa, tlv(0x34bc, tlv(0x34bd, f64(1, 2)), tlv(0x34be, f64(0, 0, 0))));
    const m = readModelDat(modelDat({ root: tri(), sections: [bad] }));
    expect(m.camera).toBeUndefined();
    expect(m.warnings.some((w) => w.includes('깨진 카메라'))).toBe(true);
    expect(m.root.faces.length).toBe(1);
    expect(readModelDat(modelDat({ root: tri(), camera: { eye: [1, 1, 1], target: [1, 1, 1], up: [0, 0, 1] } })).camera).toBeUndefined();
  });
});

describe('태그·태그 폴더·선 종류', () => {
  /** 엔진 표준 파일 layers.skp와 같은 배치 */
  const layersModel = (activeLayer?: number): Uint8Array =>
    modelDat({
      root: tri(),
      lineStyles: [
        [6, 'Solid Basic', '16.0'],
        [7, 'Dash', '12.0, -6.0'],
      ],
      tags: [
        { id: 3, name: 'Layer0', color: 'Layer_Layer0', lineStyle: 6 },
        { id: 20, name: 'Walls', color: 'Layer_Walls' },
        { id: 22, name: 'Doors', lineStyle: 7 },
        { id: 24, name: 'Hinges' },
        { id: 26, name: 'Secret', hidden: true, sceneHidden: true, attrs: [['tag_dict', [['k', val.str('v')]]]] },
        { id: 28, name: 'Archived' },
      ],
      tagFolders: [
        { id: 17, name: 'Furniture', tags: [22], children: [{ id: 18, name: 'Hardware', tags: [24] }] },
        { id: 19, name: 'Hidden folder', hidden: true, tags: [28] },
      ],
      ...(activeLayer !== undefined ? { activeLayer } : {}),
    });

  it('숨김(3c8e)·색 재질 이름·선 종류(실선은 없음)·장면 기본 숨김·속성', () => {
    const m = readModelDat(layersModel());
    expect(m.tags!.map((t) => [t.name, t.visible, t.colorMaterial ?? null, t.lineStyle ?? null, t.sceneHidden])).toEqual([
      ['Layer0', true, 'Layer_Layer0', null, false],
      ['Walls', true, 'Layer_Walls', null, false],
      ['Doors', true, null, 'Dash', false],
      ['Hinges', true, null, null, false],
      ['Secret', false, null, null, true],
      ['Archived', true, null, null, false],
    ]);
    expect(m.tags![4]!.attrs).toEqual({ tag_dict: { k: 'v' } });
    expect([...m.layers.values()]).toEqual(['Layer0', 'Walls', 'Doors', 'Hinges', 'Secret', 'Archived']);
  });

  it('태그 폴더: 뿌리는 빼고 앞 순회, 부모 차례(-1 = 뿌리 바로 아래), 태그의 폴더', () => {
    const m = readModelDat(layersModel());
    expect(m.tagFolders).toEqual([
      { name: 'Furniture', visible: true, parent: -1 },
      { name: 'Hardware', visible: true, parent: 0 },
      { name: 'Hidden folder', visible: false, parent: -1 },
    ]);
    expect(m.tags!.map((t) => t.folder ?? null)).toEqual([null, null, 0, 1, null, 2]);
  });

  it('기본 태그 = 목록 첫째, 3a9a는 활성 태그(다를 수 있다)', () => {
    const m = readModelDat(layersModel(20));
    expect(m.defaultLayer).toBe(3);
    expect(m.activeLayer).toBe(20);
    const same = readModelDat(layersModel());
    expect(same.defaultLayer).toBe(3);
    expect(same.activeLayer).toBe(3);
  });

  it('쓰기 도구의 defaultLayer는 목록 첫째로 옮겨 쓴다', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        layers: [
          [2, 'Walls'],
          [1, 'Layer0'],
        ],
        defaultLayer: 1,
      }),
    );
    expect(m.defaultLayer).toBe(1);
    expect(m.tags!.map((t) => t.name)).toEqual(['Layer0', 'Walls']);
  });
});

/** 장면 시험 모형: 태그 Layer0(3)·Walls(17)·Roof(19), 스타일 Style(1), 모형 기본 전환 1.5 s·지연 1 s */
function scenesModel(extra: { pagesSection?: Uint8Array } = {}): Uint8Array {
  const top: CamOpts = { eye: [20, 15, 200], target: [20, 15, 0], up: [0, 1, 0], perspective: false, height: 80 };
  const pageRender = rendering([
    [0x733d, i32(0)],
    [0x7357, rgba(0, 0, 0, 0)],
  ]);
  return modelDat({
    root: tri(),
    definitions: [DEF],
    tags: [
      { id: 3, name: 'Layer0' },
      { id: 17, name: 'Walls' },
      { id: 19, name: 'Roof', sceneHidden: true },
    ],
    options: [
      ['PageOptions', [['TransitionTime', val.f64(1.5)]]],
      ['SlideshowOptions', [['SlideTime', val.f64(1)]]],
    ],
    styles: { list: [[1, 'Style']], active: 1, working: 'Style_1' },
    rendering: [[0x733d, i32(2)]],
    ...(extra.pagesSection
      ? { sections: [extra.pagesSection] }
      : {
          pages: {
            list: [
              { id: 47, name: 'Perspective', description: '원근 장면', flags: 0x0ff1, camera: { eye: [100, -100, 80], target: [20, 15, 10], up: [0, 0, 1], fov: 35 } },
              { id: 48, name: 'Top parallel', flags: 0x0ff3, camera: top, style: 1, render: pageRender, tags: [19], transition: 3, delay: 0, thumbnail: 'scene_thumbnails/Top parallel.png' },
              // F:scenes "No walls": 7150 = 01 11 01 13 → Walls·Roof. Roof는 기본 숨김이라 XOR로 빠진다
              { id: 49, name: 'No walls', flags: 0x01a0, tags: [17], hidden: [8, 7, 8], sections: [43], include: false },
            ],
            active: 49,
          },
        }),
  });
}

describe('장면', () => {
  it('이름·설명·깃발·카메라·활성 장면', () => {
    const m = readModelDat(scenesModel());
    expect(m.pages!.map((p) => [p.pid, p.name, p.description, p.flags])).toEqual([
      [47, 'Perspective', '원근 장면', 0x0ff1],
      [48, 'Top parallel', '', 0x0ff3],
      [49, 'No walls', '', 0x01a0],
    ]);
    expect(m.activePage).toBe(2);
    expect(m.pages![0]!.camera).toMatchObject({ eye: [100, -100, 80], perspective: true, fov: 35 });
    expect(m.pages![1]!.camera).toEqual({ eye: [20, 15, 200], target: [20, 15, 0], up: [0, 1, 0], perspective: false, height: 80, twoPoint: false });
    expect(m.pages![2]!.camera).toBeUndefined();
  });

  it('숨긴 태그 = 7150 목록 XOR 기본 숨김(3c90), 태그 목록 차례', () => {
    const m = readModelDat(scenesModel());
    // Roof(차례 2)는 기본 숨김: 목록에 없으면 숨고, 목록에 있으면 보인다
    expect(m.pages!.map((p) => p.hiddenTags)).toEqual([[2], [], [1, 2]]);
  });

  it('숨긴 개체(겹침 없이)·단면·재생 포함·썸네일 경로', () => {
    const m = readModelDat(scenesModel());
    const p = m.pages![2]!;
    expect(p.hiddenIds).toEqual([8, 7]);
    expect(p.sectionIds).toEqual([43]);
    expect(p.includeInAnimation).toBe(false);
    expect(m.pages![0]!.includeInAnimation).toBe(true);
    expect(m.pages![1]!.thumbnail).toBe('scene_thumbnails/Top parallel.png');
  });

  it('전환·지연: 장면 값(0 이상), 음수(-1)면 모형 기본', () => {
    const m = readModelDat(scenesModel());
    expect(m.pages!.map((p) => [p.transition, p.delay])).toEqual([
      [1.5, 1],
      [3, 0],
      [1.5, 1],
    ]);
  });

  it('장면 렌더링은 장면 스타일 이름, 모형 렌더링은 작업 사본 → 활성 스타일', () => {
    const m = readModelDat(scenesModel());
    expect(m.pages![1]!.rendering!.styleName).toBe('Style');
    expect(m.pages![1]!.rendering!.values.get(0x733d)).toEqual(i32(0));
    expect(m.pages![0]!.rendering).toBeUndefined();
    expect(m.rendering!.styleName).toBe('Style_1');
    expect(m.rendering!.activeName).toBe('Style');
    // 작업 사본이 없으면 활성 스타일
    const noWorking = readModelDat(modelDat({ root: tri(), styles: { list: [[1, 'Style']], active: 1 }, rendering: [[0x733d, i32(1)]] }));
    expect(noWorking.rendering!.styleName).toBe('Style');
  });

  it('깨진 장면 절은 경고만 남기고 형상·다른 절은 그대로', () => {
    // 6d61 안 장면의 길이가 범위를 넘는다
    const broken = tlv(0x0207, tlv(0x6d60, tlv(0x6d61, new Uint8Array([0x48, 0x71, 0xff, 0, 0, 0, 1, 2]))));
    const m = readModelDat(scenesModel({ pagesSection: broken }));
    expect(m.pages).toBeUndefined();
    expect(m.warnings.some((w) => w.includes('장면'))).toBe(true);
    expect(m.root.faces.length).toBe(1);
    expect(m.tags!.length).toBe(3);
    // 장면 깃발이 4바이트가 아니면 그 장면 깃발만 0
    const odd = tlv(0x0207, tlv(0x6d60, tlv(0x6d61, tlv(0x7148, tlv(0x6f54, tlv(0x05dc, tlv(0x05de, uintLE(5))), tlv(0x6f55)), tlv(0x7149, u8(3))))));
    const o = readModelDat(modelDat({ root: tri(), sections: [odd] }));
    expect(o.pages![0]!.flags).toBe(0);
    expect(o.warnings.some((w) => w.includes('장면 깃발'))).toBe(true);
  });
});

describe('스타일(렌더링 레코드 + style.xml)', () => {
  const xml = styleXml(
    [
      [1000, 4, '1'],
      [1006, 1, '1'],
      [2001, 4, '2'],
      [2002, 4, '-3618591'],
      [2004, 1, '0'],
      [2007, 1, '1'],
      [4000, 4, '-1'],
      [4001, 4, '-23156'],
      [4002, 1, '0'],
      [4003, 4, '-12610753'],
      [4004, 1, '1'],
      [7012, 1, '1'],
      [7013, 4, '2'],
    ],
    'Style',
  );

  it('style.xml 낱값 항목만 읽는다(워터마크 같은 XML 값은 뺀다)', () => {
    const items = parseStyleXml(xml + '<sty:item id="5001"><t:variant type="13"><wmlist/></t:variant></sty:item>');
    expect(items.get(4000)).toBe('-1');
    expect(items.get(2002)).toBe('-3618591');
    expect(items.has(5001)).toBe(false);
    expect(items.size).toBe(13);
  });

  it('레코드 → (없거나 unset이면) style.xml: 배경 unset(0000) → 흰색, 앞면은 레코드', () => {
    const raw = {
      values: new Map<number, Uint8Array>([
        [0x7357, rgba(0, 0, 0, 0)],
        [0x735c, rgba(225, 225, 200)],
        [0x733e, u8(1)],
        [0x7368, new Uint8Array(0)],
      ]),
      styleName: 'Style_1',
      activeName: 'Style',
    };
    const s = resolveStyle(raw, parseStyleXml(xml));
    expect(s.name).toBe('Style');
    expect(s.background).toEqual([1, 1, 1]);
    expect(s.front).toEqual([225 / 255, 225 / 255, 200 / 255]);
    expect(s.xray).toBe(true);
    // 빈 내용 bool은 거짓(style.xml로 넘어가지 않는다) → 하늘 꺼짐 = null
    expect(s.sky).toBeNull();
    // 지면은 style.xml에서 켜짐 → 색(-12610753 = 63, 147, 63)
    expect(s.ground).toEqual([63 / 255, 147 / 255, 63 / 255]);
    expect(s.faceStyle).toBe('textured');
    expect(s.edges).toBe(true);
    expect(s.profiles).toBe(true);
    expect(s.guides).toBe(false);
    // 7013 = 2: 비트 0 단면 평면 꺼짐, 비트 1 단면 자르기 켜짐
    expect(s.sectionPlanes).toBe(false);
    expect(s.sectionCuts).toBe(true);
    expect(s.texts).toBeUndefined();
  });

  it('면 스타일: RenderMode 0 와이어 · 1 은선 · 5 단색 · 그 밖은 Texture로', () => {
    const face = (mode: number, texture?: number): string | undefined =>
      resolveStyle({ values: new Map([[0x733d, i32(mode)], ...(texture !== undefined ? ([[0x7340, u8(texture)]] as [number, Uint8Array][]) : [])]) }, undefined).faceStyle;
    expect([face(0), face(1), face(5), face(2, 0), face(2, 1), face(2), face(6, 0), face(3)]).toEqual(['wireframe', 'hiddenLine', 'monochrome', 'shaded', 'textured', 'textured', 'shaded', 'textured']);
  });

  it('레코드·style.xml이 없으면 빈 스타일', () => {
    expect(resolveStyle(undefined, undefined)).toEqual({});
    expect(resolveStyle({ values: new Map() }, new Map())).toEqual({});
  });
});

describe('모형 속성·글꼴·문자·치수 기본값', () => {
  it('0209 ModelProperties의 이름·설명과 사전 전체', () => {
    const m = readModelDat(
      modelDat({ root: tri(), properties: [['ModelProperties', [['Name', val.str('single face')], ['Description', val.str('설명')], ['IsLive', val.bool(false)]]]] }),
    );
    expect(m.name).toBe('single face');
    expect(m.description).toBe('설명');
    expect(m.properties).toEqual({ ModelProperties: { Name: 'single face', Description: '설명', IsLive: false } });
    const notText = readModelDat(modelDat({ root: tri(), properties: [['ModelProperties', [['Name', val.i32(3)]]]] }));
    expect(notText.name).toBeUndefined();
  });

  it('글꼴(F:texts: Lucida Grande 12pt), 세계 크기는 켜져 있을 때만, 이상한 포인트는 뺀다', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        fonts: [
          { id: 2, face: 'Lucida Grande', points: 12 },
          { id: 5, face: 'Arial', bold: true, points: 0, worldSize: 10 },
        ],
      }),
    );
    expect([...m.fonts!]).toEqual([
      [2, { face: 'Lucida Grande', bold: false, italic: false, pointSize: 12 }],
      [5, { face: 'Arial', bold: true, italic: false, worldSize: 10 }],
    ]);
  });

  it('문자·치수 기본값(F:texts·F:dimensions 값)', () => {
    const m = readModelDat(
      modelDat({
        root: tri(),
        fonts: [{ id: 2, face: 'Lucida Grande', points: 12 }],
        textDefaults: { font: 2, leaderFont: 2, arrow: 3, leaderType: 2, color: [0, 0, 0, 255], leaderColor: [0, 0, 0, 255] },
        dimDefaults: { font: 2, aligned: false, arrow: 3, color: [64, 64, 64, 255], textPos: 1 },
      }),
    );
    expect(m.annotationDefaults).toEqual({
      textFont: 2,
      leaderFont: 2,
      leaderArrow: 'closed',
      leaderType: 'pushpin',
      textColor: [0, 0, 0],
      leaderColor: [0, 0, 0],
      dimFont: 2,
      dimAlignedText: false,
      dimArrow: 'closed',
      dimColor: [64, 64, 64],
      dimTextAlignment: 'center',
    });
    // 끊긴 글꼴 참조는 뺀다
    expect(readModelDat(modelDat({ root: tri(), textDefaults: { font: 99 } })).annotationDefaults).toEqual({});
  });
});

describe('번호 읽기(TLV)', () => {
  it('7~8바이트 번호: 2^53 이상은 찾지 못함, 9바이트 이상도', () => {
    const r = new TlvReader(new Uint8Array([1, 2, 3, 4, 5, 6, 0x1f, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(r.uint({ tag: 0, start: 0, end: 8 })).toBe(0x1f060504030201);
    expect(r.uint({ tag: 0, start: 8, end: 16 })).toBeUndefined();
    expect(r.uint({ tag: 0, start: 16, end: 25 })).toBeUndefined();
  });

  it('묶은 번호 목록: 크기 8 초과·범위 넘음은 거기서 멈춘다', () => {
    const ok = packedIds([17, 19, 70000]);
    const r = new TlvReader(ok);
    expect(r.packedIds({ tag: 0, start: 0, end: ok.length })).toEqual({ ids: [17, 19, 70000], ok: true, unsafe: 0 });
    const bad = new TlvReader(new Uint8Array([1, 17, 9, 1, 2]));
    expect(bad.packedIds({ tag: 0, start: 0, end: 5 })).toEqual({ ids: [17], ok: false, unsafe: 0 });
  });

  it('너무 큰 태그 참조는 기본 태그로(찾지 못함)', () => {
    const root = entities(undefined, {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0)],
      edges: [tlv(0x0bb8, tlv(0x07d0, tlv(0x05dc, tlv(0x05de, uintLE(4))), tlv(0x07d2, new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0x80]))), tlv(0x0bb9, uintLE(1)), tlv(0x0bba, uintLE(2)))],
    });
    const m = readModelDat(modelDat({ root }));
    expect(m.root.edges[0]!.layer).toBeUndefined();
  });
});

describe('견딤: 뿌리 절·주석이 깨져도 멈추지 않는다', () => {
  /** 장면·스타일·태그·글꼴·속성·주석이 모두 든 모형 */
  const rich = (): Uint8Array => {
    const root = entities(undefined, {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
      edges: [edge(4, 1, 2, { curve: 90 }), edge(5, 2, 3, { curve: 90 }), edge(6, 3, 1)],
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
          { attrs: [['d', [['k', val.str('v')]]]] },
        ),
      ],
      components: [instance(8, 50, IDENTITY13, { attrs: [['i', [['n', val.i32(1)]]]] })],
      extra: [
        tlv(0x1397, tlv(0x4c2c, tlv(0x4a38, tlv(0x05dc, tlv(0x05de, uintLE(90))), tlv(0x4a3b, uintLE(4)), tlv(0x4a3c, uintLE(5))), tlv(0x4c2d, f64(...Array.from({ length: 16 }, (_, i) => i))))),
        tlv(0x1398, tlv(0x55f0, tlv(0x55f1, u8(65)), tlv(0x55fd, i32(2)))),
        tlv(0x139a, tlv(0x5dc0, tlv(0x5dc1, uintLE(4)))),
      ],
    });
    return modelDat({
      root,
      definitions: [DEF],
      tags: [
        { id: 3, name: 'Layer0' },
        { id: 17, name: 'Walls', sceneHidden: true, color: 'Layer_Walls' },
      ],
      tagFolders: [{ id: 30, name: 'F', tags: [17], children: [{ id: 31, name: 'G' }] }],
      options: [['UnitsOptions', UNITS]],
      camera: MODEL_CAM,
      styles: { list: [[1, 'Style']], active: 1 },
      rendering: [[0x733d, i32(2)]],
      fonts: FONT_LIST,
      textDefaults: { font: 2, arrow: 3 },
      properties: [['ModelProperties', [['Name', val.str('M')]]]],
      pages: { list: [{ id: 47, name: 'S', flags: 0x1a3, camera: MODEL_CAM, hidden: [8, 7], tags: [17], style: 1, render: rendering([[0x733d, i32(0)]]) }], active: 47 },
    });
  };
  const FONT_LIST = [{ id: 2, face: 'Tahoma', points: 12 }];

  it('온전한 파일은 경고 없이 다 읽는다', () => {
    const m = readModelDat(rich());
    expect(m.warnings).toEqual([]);
    expect(m.pages!.length).toBe(1);
    expect(m.root.curves!.length).toBe(1);
    expect(m.root.dimensions!.length).toBe(1);
  });

  it('바이트를 마구 바꾸거나 잘라도 예외 없이 끝난다', () => {
    const file = rich();
    let seed = 11;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let k = 0; k < 400; k++) {
      const bad = file.slice();
      for (let j = 0; j < 4; j++) bad[6 + rnd(bad.length - 6)] = rnd(256);
      expect(() => readModelDat(bad)).not.toThrow();
    }
    for (let k = 1; k < 60; k++) expect(() => readModelDat(file.subarray(0, Math.floor((file.length * k) / 60)))).not.toThrow();
  });
});
