import { describe, expect, it } from 'vitest';
import { skpToScene } from '../src/index';
import { locationMeta, northAngleOf } from '../src/scene-meta';
import { axesOf } from '../src/vffroot';
import { entities, f64, i32, modelDat, skpFile, tlv, u8, uintLE, utf8, val } from './build';
import { mfcFile, squareEntities } from './mfcwrite';

/** 2021+ 위치·그림자(0204 → 6590)와 그리기 축(01fc → 4650) 절 */
function sections(o: { axes?: number[] } = {}): Uint8Array[] {
  const shadow = tlv(
    0x0204,
    tlv(
      0x6590,
      tlv(0x6591, new Uint8Array([0x58, 0x4b, 0x37, 0x6a])),
      tlv(0x6593, utf8('서울')),
      tlv(0x6594, utf8('한국')),
      tlv(0x6595, f64(127)),
      tlv(0x6596, f64(37.5)),
      tlv(0x6597, f64(9)),
      tlv(0x6598, f64(Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0)),
      tlv(0x6599, u8(1)),
      tlv(0x659b, u8(1)),
      tlv(0x659c, u8(0)),
      tlv(0x659e, i32(70)),
      tlv(0x659f, i32(30)),
      tlv(0x65a0, u8(0)),
    ),
  );
  const a = o.axes ?? [10, 20, 0, 0, 1, 0, -1, 0, 0, 0, 0, 1];
  const axes = tlv(0x01fc, tlv(0x4650, tlv(0x4651, f64(...a.slice(0, 3))), tlv(0x4652, f64(...a.slice(3, 6))), tlv(0x4653, f64(...a.slice(6, 9))), tlv(0x4654, f64(...a.slice(9, 12)))));
  return [shadow, axes];
}

describe('위치·그림자·그리기 축', () => {
  it('2021+: 도시·나라·위경도·시간대·북쪽 각, 그림자 밝음·어둠·깃발, 축(원점은 장면 단위)', () => {
    const file = skpFile(
      modelDat({
        root: entities(undefined, {}),
        lengthUnit: 2,
        properties: [['GeoReference', [['UsesGeoReferencing', val.bool(true)]]]],
        sections: sections(),
      }),
    );
    const m = skpToScene(file).meta as Record<string, any>;
    expect(m.location).toEqual({ georeferenced: true, city: '서울', country: '한국', latitude: 37.5, longitude: 127, tz: 9, northAngle: 30 });
    expect(m.shadow).toMatchObject({ time: 0x6a374b58, light: 70, dark: 30, display: true, onFaces: true, onGround: false, useSun: false });
    expect(m.axes.origin).toEqual([254, 508, 0]);
    expect(m.axes.x).toEqual([0, 1, 0]);
    expect(m.axes.y).toEqual([-1, 0, 0]);
    // 기본 축은 적지 않는다
    const plain = skpToScene(skpFile(modelDat({ root: entities(undefined, {}), sections: sections({ axes: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }) })));
    expect((plain.meta as Record<string, any>).axes).toBeUndefined();
    expect((plain.meta as Record<string, any>).location.georeferenced).toBe(false);
  });

  it('2020 이하: 모형 꼬리 CShadowInfo·CSketchCS(깃발은 자리를 몰라 넣지 않는다)', () => {
    const bytes = mfcFile({
      schemas: 'v20',
      root: squareEntities(),
      shadow: { time: 1_600_000_000, city: 'Москва', country: 'RU', lon: 37.6, lat: 55.75, tz: 3, north: [0, 1, 0], light: 60, dark: 40 },
      axes: [1, 2, 3, 0, 1, 0, -1, 0, 0, 0, 0, 1],
    });
    const m = skpToScene(bytes).meta as Record<string, any>;
    expect(m.location).toMatchObject({ city: 'Москва', country: 'RU', latitude: 55.75, longitude: 37.6, tz: 3, northAngle: 0, georeferenced: false });
    expect(m.shadow).toEqual({ time: 1_600_000_000, city: 'Москва', country: 'RU', longitude: 37.6, latitude: 55.75, tz: 3, north: [0, 1, 0], light: 60, dark: 40 });
    expect(m.axes).toEqual({ origin: [1, 2, 3], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] });
    // 기본 꼬리(단위 축)
    expect((skpToScene(mfcFile({ schemas: 'v20', root: squareEntities() })).meta as Record<string, any>).axes).toBeUndefined();
  });

  it('북쪽 각·축 다듬기·GeoReference 사전의 위경도가 앞선다', () => {
    expect(northAngleOf([0, 1, 0])).toBe(0);
    expect(northAngleOf([1, 0, 0])).toBe(90);
    expect(northAngleOf([-1, 0, 0])).toBe(270);
    expect(northAngleOf([0, 0, 1])).toBeUndefined();
    expect(axesOf([0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4])).toBeUndefined();
    expect(axesOf([0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1])).toBeUndefined();
    expect(axesOf([0, 0, 0], [0, 2, 0], [-1, 0, 0], [0, 0, 1])!.x).toEqual([0, 1, 0]);
    const loc = locationMeta({ shadowInfo: { latitude: 1, longitude: 2 }, properties: { GeoReference: { UsesGeoReferencing: true, Latitude: 37.5665, Longitude: 126.978 } } })!;
    expect(loc).toMatchObject({ georeferenced: true, latitude: 37.5665, longitude: 126.978 });
    expect(locationMeta({})).toBeUndefined();
    // 지리 참조를 쓰지 않으면 GeoReference에 남은 기본 위경도(볼더)보다 그림자 설정의 위경도
    expect(locationMeta({ shadowInfo: { latitude: 37.5, longitude: 127 }, properties: { GeoReference: { Latitude: 40.0183, Longitude: -105.2421 } } })).toMatchObject({ georeferenced: false, latitude: 37.5, longitude: 127 });
    expect(uintLE(1).length).toBeGreaterThan(0);
  });
});
