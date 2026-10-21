import { describe, expect, it } from 'vitest';
import type { SkpAttrDictsMeta, SkpTreeInfo } from '../../src/meta';
import { ATTR_VALUE_CHARS, attributeDicts, attributeText, cardName, cardRows, entityInfo, entityTitle, nodeEntity, type EntityInput } from '../../src/app/entity';
import type { TreeData } from '../../src/app/tree';
import { DEFAULT_UNITS, type UnitsDisplay } from '../../src/app/units';

const u = (o: Partial<UnitsDisplay>): UnitsDisplay => ({ ...DEFAULT_UNITS, ...o });
const rowMap = (rows: { label: string; value: string }[]): Record<string, string> => Object.fromEntries(rows.map((r) => [r.label, r.value]));

describe('엔티티 정보 행', () => {
  const chair: EntityInput = {
    kind: 'component',
    name: '왼쪽 의자',
    definition: '의자',
    instances: 12,
    path: '집 › 1층',
    tag: '가구',
    material: null,
    size: [1000, 500, 2000],
    area: 2e6,
    faces: 1234,
    edges: 3456,
    description: '나무 의자',
    guid: 'abc',
    definitionGuid: 'def',
    locked: true,
    hidden: false,
  };

  it('SketchUp 엔티티 정보 차례로 행을 만든다(크기는 가로 × 세로 × 높이, 모형 단위)', () => {
    const info = entityInfo(chair, u({ lengthUnit: 'mm', lengthPrecision: 0 }), 1);
    expect(info.title).toBe('컴포넌트');
    // 그룹·컴포넌트의 넓이는 안쪽 면 전부의 합이라 "면 넓이 합"(면 하나의 "넓이"와 헷갈리지 않게)
    expect(info.rows.map((r) => r.label)).toEqual(['인스턴스', '정의', '놓인 수', '위치', '태그', '재질', '크기', '면 넓이 합', '면', '모서리', '설명', 'GUID', '정의 GUID', '상태']);
    const m = rowMap(info.rows);
    expect(m['놓인 수']).toBe('12개');
    expect(m['재질']).toBe('기본값');
    expect(m['크기']).toBe('1000 mm × 500 mm × 2000 mm');
    expect(m['면 넓이 합']).toBe('2.00 m²');
    expect(m['면']).toBe('1,234');
    expect(m['상태']).toBe('잠김');
    expect(info.rows.find((r) => r.label === '설명')!.title).toBeUndefined();
  });

  it('장면 단위(인치)를 mm로 바꿔 모형 단위로 쓴다', () => {
    const m = rowMap(entityInfo({ kind: 'group', size: [10, 20, 30], area: 100, length: 10 }, u({ lengthUnit: 'cm', lengthPrecision: 1, areaUnit: 'square_cm' }), 25.4).rows);
    expect(m['크기']).toBe('25.4 cm × 50.8 cm × 76.2 cm');
    expect(m['면 넓이 합']).toBe('645.16 cm²');
    expect(m['길이']).toBe('25.4 cm');
  });

  it('면 하나는 "넓이", 곡선 모서리는 길이·반지름·선분 수', () => {
    const face = rowMap(entityInfo({ kind: 'face', area: 1e6, tag: '벽', material: '벽돌' }, DEFAULT_UNITS, 1).rows);
    expect(face['넓이']).toBe('1.00 m²');
    expect(face['면 넓이 합']).toBeUndefined();
    const arc = entityInfo({ kind: 'edge', length: 157.0796, radius: 100, segments: 12 }, u({ lengthUnit: 'mm', lengthPrecision: 1 }), 1);
    expect(rowMap(arc.rows)).toMatchObject({ 길이: '~ 157.1 mm', 반지름: '100.0 mm', 선분: '12' });
    // 선분 하나는 선분 수 행을 만들지 않는다
    expect(rowMap(entityInfo({ kind: 'edge', length: 10, segments: 1 }, DEFAULT_UNITS, 1).rows)['선분']).toBeUndefined();
    expect(cardRows(arc).map((r) => r.label)).toEqual(['길이', '반지름']);
  });

  it('단위를 숨긴 모형은 도움말에 단위를 붙인다', () => {
    const info = entityInfo({ kind: 'loose', size: [1000, 20, 3] }, u({ suppressUnits: true }), 1);
    const size = info.rows.find((r) => r.label === '크기')!;
    expect(size.value).toBe('1000 × 20 × 3');
    expect(size.title).toBe('1000 mm × 20 mm × 3 mm');
  });

  it('그룹은 정의 이름·정의 GUID를 보이지 않고, 없는 칸은 행을 만들지 않는다', () => {
    const info = entityInfo({ kind: 'group', name: '벽', definition: 'Group#3', definitionGuid: 'x' }, DEFAULT_UNITS, 1);
    expect(info.rows).toEqual([{ label: '인스턴스', value: '벽' }]);
    // 재질 칸이 없으면 재질 행도 없다(재질을 모르는 것과 기본값은 다르다)
    expect(info.rows.some((r) => r.label === '재질')).toBe(false);
  });

  it('재질·여럿 고르기에도 쓴다', () => {
    const mat = entityInfo({ kind: 'material', name: '참나무', faces: 40, area: 1e6, extra: [{ label: '색', value: '#aa8844' }] }, DEFAULT_UNITS, 1);
    expect(mat.title).toBe('재질');
    expect(mat.rows.map((r) => r.label)).toEqual(['이름', '면 넓이 합', '면', '색']);
    expect(entityTitle({ kind: 'face', count: 3 })).toBe('면 3개');
    expect(entityTitle({ kind: 'mixed', count: 1200 })).toBe('여러 종류 1,200개');
  });
});

describe('속성 사전', () => {
  it('값 글: 목록·참거짓·소수, 긴 글은 자른다', () => {
    expect(attributeText(null)).toBe('');
    expect(attributeText(true)).toBe('true');
    expect(attributeText(0.1 + 0.2)).toBe('0.3');
    expect(attributeText(42)).toBe('42');
    expect(attributeText([1, 'a', [false]])).toBe('[1, a, [false]]');
    expect(attributeText({ a: 1 })).toBe('{"a":1}');
    const long = attributeText('가'.repeat(ATTR_VALUE_CHARS + 500));
    expect(long).toHaveLength(ATTR_VALUE_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('사전 이름·열쇠는 글 차례(숫자는 크기 차례), 사전이 아닌 것은 뺀다', () => {
    const dicts = attributeDicts({ b: { k10: 1, k2: 2, K1: 'x' }, A: { z: null }, bad: 5 as never }, 'definition');
    expect(dicts.map((d) => d.name)).toEqual(['A', 'b']);
    expect(dicts[1]!.entries).toEqual([
      ['K1', 'x'],
      ['k2', '2'],
      ['k10', '1'],
    ]);
    expect(dicts[1]!.source).toBe('definition');
    expect(dicts[1]!.more).toBe(0);
    expect(attributeDicts(null)).toEqual([]);
  });

  it('인스턴스 사전 뒤에 정의 사전', () => {
    const info = entityInfo({ kind: 'component', attrs: { inst: { a: 1 } }, definitionAttrs: { def: { b: 2 } } }, DEFAULT_UNITS, 1);
    expect(info.dicts.map((d) => [d.name, d.source])).toEqual([
      ['inst', 'instance'],
      ['def', 'definition'],
    ]);
    expect(info.moreDicts).toBe(0);
  });
});

describe('나무 노드 → 정보 입력', () => {
  const t = {
    count: 3,
    parent: Int32Array.from([-1, 0, 0]),
    kind: Uint8Array.from([0, 1, 1]),
    names: ['집', '', '왼쪽 의자'],
    definition: Int32Array.from([0, 1, 1]),
    definitionNames: ['Group#1', '의자'],
    tag: Int32Array.from([0, 1, 1]),
    tagNames: ['Untagged', '가구'],
    faces: Uint32Array.from([100, 10, 10]),
    edges: Uint32Array.from([300, 30, 30]),
  } as unknown as TreeData;
  const info: SkpTreeInfo = {
    guid: ['', 'g1', ''],
    attrs: Int32Array.from([-1, 0, -1]),
    size: Float32Array.from([4000, 3000, 2500, 450, 500, 900, 450, 500, 900]),
    area: Float64Array.from([5e7, 2e6, 2e6]),
    locked: Uint8Array.from([0, 1, 0]),
    definitionDescription: ['', '나무 의자'],
    definitionGuid: ['', 'dg'],
    definitionAttrs: Int32Array.from([-1, 1]),
  };
  const attributes: SkpAttrDictsMeta[] = [{ dynamic_attributes: { lenx: 10 } }, { maker: { name: 'A' } }];

  it('컴포넌트 노드: 크기·넓이·GUID·잠김·속성·정의 설명', () => {
    const e = nodeEntity(t, 1, info, attributes, { instances: new Map([['의자', 2]]) })!;
    expect(e.kind).toBe('component');
    expect(e.name).toBe('');
    expect(e.path).toBe('집');
    expect(e.tag).toBe('가구');
    expect(e.size).toEqual([450, 500, 900]);
    expect(e.locked).toBe(true);
    expect(e.guid).toBe('g1');
    expect(e.definitionGuid).toBe('dg');
    expect(e.description).toBe('나무 의자');
    expect(e.attrs).toEqual({ dynamic_attributes: { lenx: 10 } });
    expect(e.definitionAttrs).toEqual({ maker: { name: 'A' } });
    const m = rowMap(entityInfo(e, DEFAULT_UNITS, 1).rows);
    expect(m['정의']).toBe('의자');
    expect(m['놓인 수']).toBe('2개');
    expect(m['크기']).toBe('450 mm × 500 mm × 900 mm');
    expect(m['인스턴스']).toBeUndefined();
  });

  it('입체 노드: 제목이 "입체 그룹·입체 컴포넌트"이고 부피 행(모형 부피 단위), 입체가 아니면(NaN) 행이 없다', () => {
    const solid = { ...info, volume: Float64Array.from([Number.NaN, 2.5e8, Number.NaN]) };
    const e = nodeEntity(t, 1, solid, attributes)!;
    expect(e.volume).toBe(2.5e8);
    const ei = entityInfo(e, u({ volumeUnit: 'cubic_m', volumePrecision: 3 }), 1);
    expect(ei.title).toBe('입체 컴포넌트');
    expect(rowMap(ei.rows)['부피']).toBe('0.250 m³');
    expect(ei.rows.findIndex((r) => r.label === '부피')).toBe(ei.rows.findIndex((r) => r.label === '면 넓이 합') + 1);
    // 인치 장면: 부피는 세제곱으로 바꾼다
    expect(rowMap(entityInfo({ kind: 'group', volume: 1 }, u({ volumeUnit: 'cubic_cm', volumePrecision: 2 }), 25.4).rows)['부피']).toBe('~ 16.39 cm³');
    expect(entityTitle({ kind: 'group', volume: 0 })).toBe('입체 그룹');
    const plain = nodeEntity(t, 2, solid, attributes)!;
    expect(plain.volume).toBeUndefined();
    expect(entityInfo(plain, DEFAULT_UNITS, 1).title).toBe('컴포넌트');
    expect(cardRows(entityInfo(e, DEFAULT_UNITS, 1)).map((r) => r.label)).toEqual(['크기', '부피', '면 넓이 합', '태그']);
  });

  it('treeInfo가 없으면 나무에서 아는 것만, 범위 밖 노드는 null', () => {
    const e = nodeEntity(t, 0, null, null, { hidden: true })!;
    expect(e).toMatchObject({ kind: 'group', name: '집', path: null, tag: 'Untagged', faces: 100, hidden: true });
    expect(e.size).toBeUndefined();
    expect(nodeEntity(t, 3, info, attributes)).toBeNull();
    expect(nodeEntity(t, -1, info, attributes)).toBeNull();
  });
});

describe('고른 것 카드(휴대폰)', () => {
  it('치수(크기·길이·넓이)와 놓인 수·태그·재질만 이 차례로 네 개까지, 이름은 인스턴스 → 이름 → 정의', () => {
    const info = entityInfo(
      { kind: 'component', name: '', definition: '탁자', instances: 2, tag: '가구', size: [1200, 800, 760], area: 2.5e6, faces: 26, guid: 'abc' },
      DEFAULT_UNITS,
      1,
    );
    expect(cardRows(info).map((r) => r.label)).toEqual(['크기', '면 넓이 합', '놓인 수', '태그']);
    expect(cardRows(info)[0]!.value).toContain('1200');
    expect(cardName(info)).toBe('탁자');
    expect(cardName(entityInfo({ kind: 'group', name: '벽' }, DEFAULT_UNITS, 1))).toBe('벽');
    expect(cardName({ rows: [] })).toBe('');
    expect(cardRows({ rows: [{ label: 'GUID', value: 'x' }] })).toEqual([]);
  });
});
