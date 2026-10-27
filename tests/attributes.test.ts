import { describe, expect, it } from 'vitest';
import { readModelDat } from '../src/model';
import { IDENTITY13, attrList, edge, entities, face, f64, instance, modelDat, tlv, u8, uintLE, utf8, val, vertex, type AttrDictsSpec } from './build';
import { edgeAt, faceAt } from '../src/entities';

/** F:attributes의 definition_dict(엔진 표준 파일 값, C API 기대값과 같음) */
const ALL_TYPES: AttrDictsSpec = [
  [
    'definition_dict',
    [
      ['array', val.arr(val.i32(1), val.f64(2.5), val.str('three'), val.arr(val.bool(true), val.bool(false)))],
      ['bool', val.bool(true)],
      ['byte', val.byte(7)],
      ['color', val.color(10, 20, 30, 255)],
      ['double', val.f64(3.25)],
      ['empty_string', val.str('')],
      ['float', val.f32(1.5)],
      ['int16', val.i16(-1234)],
      ['int32', val.i32(42)],
      ['negative', val.i32(-7)],
      ['nil', val.nil()],
      ['string', val.str('한글 text')],
      ['time', val.time(1760000000)],
      ['vector', val.vec(1, -2, 0.5)],
      ['length', val.length(12.5)],
      ['point', val.point(1, 2, 3)],
    ],
  ],
];

const EXPECTED = {
  array: [1, 2.5, 'three', [true, false]],
  bool: true,
  byte: 7,
  color: { kind: 'color', rgba: [10, 20, 30, 255] },
  double: 3.25,
  empty_string: '',
  float: 1.5,
  int16: -1234,
  int32: 42,
  negative: -7,
  nil: null,
  string: '한글 text',
  time: { kind: 'time', epoch: 1760000000 },
  vector: { kind: 'vector', xyz: [1, -2, 0.5] },
  length: { kind: 'length', inch: 12.5 },
  point: { kind: 'point', xyz: [1, 2, 3] },
};

const tri = (o: { faceAttrs?: AttrDictsSpec; edgeAttrs?: AttrDictsSpec; instAttrs?: AttrDictsSpec; rootAttrs?: AttrDictsSpec } = {}): Uint8Array =>
  entities(0, {
    vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
    edges: [edge(4, 1, 2, o.edgeAttrs ? { attrs: o.edgeAttrs } : {}), edge(5, 2, 3), edge(6, 3, 1)],
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
        o.faceAttrs ? { attrs: o.faceAttrs } : {},
      ),
    ],
    components: [instance(8, 50, IDENTITY13, o.instAttrs ? { attrs: o.instAttrs } : {})],
    ...(o.rootAttrs ? { attrs: o.rootAttrs } : {}),
  });

describe('속성 사전(05dd → 36b1)', () => {
  it('값 꼴 전부(F:attributes definition_dict)', () => {
    const m = readModelDat(modelDat({ root: tri(), definitions: [{ name: 'Attributed', entities: entities(50, { attrs: ALL_TYPES }) }] }));
    expect(m.definitions.get(50)!.entities.attrs).toEqual({ definition_dict: EXPECTED });
    expect(m.warnings).toEqual([]);
  });

  it('자리: 모형(뿌리 묶음 머리)·인스턴스·면·모서리', () => {
    const m = readModelDat(
      modelDat({
        root: tri({
          rootAttrs: [['GeoReference', [['UsesGeoReferencing', val.bool(false)]]]],
          instAttrs: [
            ['SU_InstanceSet', [['Owner', val.str('')]]],
            ['dynamic_attributes', [['_lenx', val.f64(12.5)], ['name', val.str('가구')]]],
          ],
          faceAttrs: [['face_dict', [['index', val.i32(3)], ['side', val.str('front')]]]],
          edgeAttrs: [['edge_dict', [['k', val.bool(true)]]]],
        }),
        definitions: [{ name: 'D', entities: entities(50, {}) }],
      }),
    );
    expect(m.root.attrs).toEqual({ GeoReference: { UsesGeoReferencing: false } });
    expect(m.root.instances[0]!.attrs).toEqual({ SU_InstanceSet: { Owner: '' }, dynamic_attributes: { _lenx: 12.5, name: '가구' } });
    expect(faceAt(m.root.faces, 0).attrs).toEqual({ face_dict: { index: 3, side: 'front' } });
    expect(edgeAt(m.root.edges, 0).attrs).toEqual({ edge_dict: { k: true } });
    expect(edgeAt(m.root.edges, 1).attrs).toBeUndefined();
    expect(m.definitions.get(50)!.entities.attrs).toBeUndefined();
  });

  it('모르는 값 꼴·크기가 틀린 값은 그 열쇠만 버리고 센다, 같은 이름 사전은 뒤 것', () => {
    const dicts: AttrDictsSpec = [
      ['d', [['odd', val.raw(0x38b9, f64(1))], ['short', val.raw(0x38a7, new Uint8Array([1, 2]))], ['ok', val.i32(1)]]],
      ['d', [['again', val.str('뒤')]]],
    ];
    const m = readModelDat(modelDat({ root: tri({ faceAttrs: dicts }) }));
    expect(faceAt(m.root.faces, 0).attrs).toEqual({ d: { again: '뒤' } });
    const single = readModelDat(modelDat({ root: tri({ faceAttrs: [dicts[0]!] }) }));
    expect(faceAt(single.root.faces, 0).attrs).toEqual({ d: { ok: 1 } });
    expect(single.warnings.some((w) => w.includes('알 수 없는 속성 값 꼴(0x38b9)'))).toBe(true);
    expect(single.warnings.some((w) => w.includes('0x38a7'))).toBe(true);
  });

  it('면 무늬 위치(2710)처럼 사전이 아닌 항목은 건너뛰고, 열쇠 없는 값은 버린다', () => {
    const list = tlv(
      0x36b1,
      tlv(0x36b2, tlv(0x2710, tlv(0x2711, f64(1, 2))), tlv(0x36b3, tlv(0x36b4, utf8('x')), tlv(0x36b5, val.i32(5), tlv(0x36b6, utf8('k')), val.i32(6)))),
    );
    const use = (e: number): Uint8Array => tlv(0x0fa0, tlv(0x0fa1, uintLE(e)), tlv(0x0fa2, u8(0)));
    const f = tlv(
      0x0dac,
      tlv(0x07d0, tlv(0x05dc, tlv(0x05de, uintLE(7)), tlv(0x05dd, list)), tlv(0x07d3, u8(6))),
      tlv(0x0dad, f64(0, 0, 1, 0)),
      tlv(0x0dae, tlv(0x1194, tlv(0x1195, use(4), use(5), use(6)))),
    );
    const root = entities(undefined, {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
      edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
      faces: [f],
    });
    expect(faceAt(readModelDat(modelDat({ root })).root.faces, 0).attrs).toEqual({ x: { k: 6 } });
  });

  it('깨진 속성 사전은 앞부분만 쓰고, 면은 그대로 읽는다', () => {
    const good = attrList([['ok', [['a', val.i32(1)]]]]);
    // 두 번째 사전의 길이를 망가뜨린다: 36b2 안에 길이가 넘치는 36b3
    const broken = tlv(0x36b1, tlv(0x36b2, good.subarray(12), new Uint8Array([0xb3, 0x36, 0xff, 0, 0, 0, 1])));
    const m = readModelDat(modelDat({ root: tri(), sections: [tlv(0x0209, broken)] }));
    expect(m.properties).toEqual({ ok: { a: 1 } });
    expect(m.warnings.some((w) => w.includes('깨진 속성 사전'))).toBe(true);
    expect(m.root.faces.length).toBe(1);
  });
});
