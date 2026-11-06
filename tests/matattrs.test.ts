/**
 * 46차: 재질 속성 사전. 2021+는 material.xml 끝의 n0:AttributeDictionaries(꼴 번호 = 2020 이하 형 있는 값 꼴),
 * 2020 이하는 CMaterial 앞머리의 CAttributeContainer. 꼴은 실제 2021~2026 파일(31개)과 표준 파일(C API 기대값 material_dict.sku)에서
 * 센 것(docs/formats/skp.md "재질 속성 사전")을 손으로 옮긴 합성 자료로 시험한다.
 */
import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../src/index';
import { parseMaterialAttrs, parseMaterialXml } from '../src/materials';
import type { SkpMaterialStat } from '../src/scene';
import { edge, entities, face, materialXml, modelDat, skpFile, val, vertex } from './build';
import { mfcFile, mv, squareEntities } from './mfcwrite';

/** 실제 파일에서 본 꼴: 글은 CDATA, 정수·실수·참거짓은 글, 배열은 count와 <value type> */
const BLOCK =
  '<n0:AttributeDictionaries count="2">\n' +
  '      <n0:AttributeDictionary name="렌더러" count="6">\n' +
  '        <n0:Attribute key="class" type="10"><![CDATA[Mtl<Basic> & co]]></n0:Attribute>\n' +
  '        <n0:Attribute key="version" type="4">50003</n0:Attribute>\n' +
  '        <n0:Attribute key="diffuse" type="6">0.59999999999999998</n0:Attribute>\n' +
  '        <n0:Attribute key="hidden" type="7">0</n0:Attribute>\n' +
  '        <n0:Attribute key="on" type="7">1</n0:Attribute>\n' +
  '        <n0:Attribute key="template" type="11" count="3">\n' +
  '          <value type="4">14</value>\n' +
  '          <value type="4">-2</value>\n' +
  '          <value type="6">2.5</value>\n' +
  '        </n0:Attribute>\n' +
  '      </n0:AttributeDictionary>\n' +
  '      <n0:AttributeDictionary name="a &amp; b" count="1">\n' +
  '        <n0:Attribute key="sku" type="10"><![CDATA[M-1]]></n0:Attribute>\n' +
  '      </n0:AttributeDictionary>\n' +
  '    </n0:AttributeDictionaries>';

const PARSED = {
  렌더러: { class: 'Mtl<Basic> & co', version: 50003, diffuse: 0.6, hidden: false, on: true, template: [14, -2, 2.5] },
  'a & b': { sku: 'M-1' },
};

/** materialXml(색 재질, 빈 요소)에 속성 사전 블록을 넣는다(실제 파일처럼 </mat:material> 바로 앞) */
const withBlock = (xml: string, block: string): string =>
  xml.replace(' />\n</materialDocument>', ` xmlns:n0="http://sketchup.google.com/schemas/1.0/types">\n    ${block}\n  </mat:material>\n</materialDocument>`);

describe('material.xml 속성 사전 읽기', () => {
  it('꼴 번호 10·4·6·7·11(배열 안 4·6), 사전·열쇠 이름의 글 이스케이프', () => {
    expect(parseMaterialAttrs(withBlock(materialXml('원목', [1, 2, 3]), BLOCK))).toEqual(PARSED);
  });

  it('속성 사전만 더해지고 이름·색·무늬는 그대로', () => {
    const plain = materialXml('원목', [10, 20, 30], 0.5, 1, true, { file: 'a.png', width: 2, height: 3, average: [1, 2, 3] });
    const xml = plain.replace('  </mat:material>', `    ${BLOCK}\n  </mat:material>`);
    expect(xml).not.toBe(plain);
    const a = parseMaterialXml(plain)!;
    const b = parseMaterialXml(xml)!;
    expect(a.attrs).toBeUndefined();
    expect(b.attrs).toEqual(PARSED);
    expect({ ...b, attrs: undefined }).toEqual(a);
  });

  it('CDATA 안의 꼬리표·나눈 CDATA·이스케이프한 글, 모르는 꼴·맞지 않는 글은 적힌 글 그대로', () => {
    const block =
      '<n0:AttributeDictionaries count="1"><n0:AttributeDictionary name="d" count="6">' +
      '<n0:Attribute key="xml" type="10"><![CDATA[<a></n0:Attribute></n0:AttributeDictionary>]]></n0:Attribute>' +
      '<n0:Attribute key="split" type="10"><![CDATA[a]]]]><![CDATA[>b]]></n0:Attribute>' +
      '<n0:Attribute key="esc" type="10">x &lt; y &#x263A;</n0:Attribute>' +
      '<n0:Attribute key="color" type="8">4278190335</n0:Attribute>' +
      '<n0:Attribute key="bad" type="4">1.5</n0:Attribute>' +
      '<n0:Attribute key="empty" type="10"/>' +
      '</n0:AttributeDictionary></n0:AttributeDictionaries>';
    expect(parseMaterialAttrs(block)).toEqual({
      d: { xml: '<a></n0:Attribute></n0:AttributeDictionary>', split: 'a]]>b', esc: 'x < y ☺', color: '4278190335', bad: '1.5', empty: '' },
    });
  });

  it('__proto__ 열쇠도 보통 칸, 같은 이름 사전은 뒤 것, 없거나 빈 블록은 없음', () => {
    const block =
      '<n0:AttributeDictionaries count="2">' +
      '<n0:AttributeDictionary name="d" count="1"><n0:Attribute key="a" type="4">1</n0:Attribute></n0:AttributeDictionary>' +
      '<n0:AttributeDictionary name="d" count="1"><n0:Attribute key="__proto__" type="4">2</n0:Attribute></n0:AttributeDictionary>' +
      '</n0:AttributeDictionaries>';
    const d = parseMaterialAttrs(block)!;
    expect(Object.keys(d)).toEqual(['d']);
    expect(Object.keys(d.d!)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(d.d!, '__proto__')!.value).toBe(2);
    expect(parseMaterialAttrs(materialXml('x', [1, 2, 3]))).toBeUndefined();
    expect(parseMaterialAttrs('<n0:AttributeDictionaries count="0"/>')).toBeUndefined();
    expect(parseMaterialAttrs('<n0:AttributeDictionaries count="0"></n0:AttributeDictionaries>')).toBeUndefined();
  });

  it('잘린 블록은 읽은 데까지(예외 없이)', () => {
    const cut = BLOCK.slice(0, BLOCK.indexOf('<value type="6">'));
    expect(parseMaterialAttrs(cut)).toEqual({ 렌더러: { ...PARSED.렌더러, template: [14, -2] } });
    for (let n = 0; n < BLOCK.length; n += 7) expect(() => parseMaterialAttrs(BLOCK.slice(0, n))).not.toThrow();
  });
});

/** 한 변 1인 정사각형 면 하나(번호 base부터, x만큼 옮김, 앞면 재질) */
function square(base: number, x: number, material: number) {
  const v = (i: number): number => base + i;
  const P: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  return {
    vertices: P.map(([a, b], i) => vertex(v(i), a + x, b, 0)),
    edges: [0, 1, 2, 3].map((i) => edge(v(4 + i), v(i), v((i + 1) % 4))),
    faces: [face(v(8), [0, 0, 1, 0], [[0, 1, 2, 3].map((i) => [v(4 + i), false] as [number, boolean])], { material })],
  };
}

/** 2021+ 파일: 재질 1(속성 사전), 2(모형 속성과 같은 사전), 3(없음) 면 하나씩, 모형 속성 {모형: {수: 3}} */
function vffScene(): Scene3d {
  const sq = [square(100, 0, 1), square(200, 2, 2), square(300, 4, 3)];
  const root = entities(0, {
    vertices: sq.flatMap((s) => s.vertices),
    edges: sq.flatMap((s) => s.edges),
    faces: sq.flatMap((s) => s.faces),
    attrs: [['모형', [['수', val.i32(3)]]]],
  });
  const model = modelDat({
    materials: [
      [1, '색칠'],
      [2, '같은사전'],
      [3, '없음'],
    ],
    root,
  });
  const same = '<n0:AttributeDictionaries count="1"><n0:AttributeDictionary name="모형" count="1"><n0:Attribute key="수" type="4">3</n0:Attribute></n0:AttributeDictionary></n0:AttributeDictionaries>';
  return skpToScene(
    skpFile(model, {
      materials: [
        ['색칠', withBlock(materialXml('색칠', [200, 10, 10]), BLOCK)],
        ['같은사전', withBlock(materialXml('같은사전', [10, 200, 10]), same)],
        ['없음', materialXml('없음', [10, 10, 200])],
      ],
    }),
    { name: 'm', outline: true },
  );
}

const stat = (s: Scene3d, name: string): SkpMaterialStat => (s.meta!.materialStats as SkpMaterialStat[]).find((m) => m.name === name)!;

describe('장면 정보의 재질 속성 사전', () => {
  it('2021+: materialStats[].attrs = meta.attributes 차례(모형 속성 차례는 그대로, 같은 사전은 한 번만)', () => {
    const s = vffScene();
    const m = s.meta as Record<string, unknown>;
    expect(m.modelAttrs).toBe(0);
    const attrs = m.attributes as Record<string, unknown>[];
    expect(attrs[0]).toEqual({ 모형: { 수: 3 } });
    expect(stat(s, '색칠').attrs).toBe(1);
    expect(stat(s, '같은사전').attrs).toBe(0);
    expect('attrs' in stat(s, '없음')).toBe(false);
    // 화면용 값: 배열은 글로(모형·정의 속성과 같은 꼴)
    expect(attrs[1]).toEqual({ 렌더러: { class: 'Mtl<Basic> & co', version: 50003, diffuse: 0.6, hidden: false, on: true, template: '[14, -2, 2.5]' }, 'a & b': { sku: 'M-1' } });
    expect(attrs).toHaveLength(2);
  });

  it('2020 이하: CMaterial 앞머리 속성 사전(표준 파일 attributes.skp의 material_dict 꼴)', () => {
    const bytes = mfcFile({
      schemas: 'v20',
      materials: [{ name: 'Tagged material', color: [100, 150, 200, 255], attrs: [['material_dict', [['sku', mv.str('M-1')]]]] }, { name: '빈 재질', color: [1, 2, 3, 255] }],
      root: squareEntities({ faces: [{ ...squareEntities().faces![0]!, front: 0, back: 1 }] }),
    });
    const s = skpToScene(bytes, { name: 'm', outline: true });
    const m = s.meta as Record<string, unknown>;
    const t = stat(s, 'Tagged material');
    expect((m.attributes as unknown[])[t.attrs!]).toEqual({ material_dict: { sku: 'M-1' } });
    expect('attrs' in stat(s, '빈 재질')).toBe(false);
  });
});
