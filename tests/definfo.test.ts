/**
 * 45차: 정의를 불러온 파일(1580)·정의 미리보기 그림 경로(1585 → 251c → 251e → 2328 → 232a)·분류 체계(0205 → 6784 → 6786).
 * 꼴은 실제 2021~2026 파일에서 센 것(docs/formats/skp.md "정의 미리보기·불러온 파일·분류 체계")을 손으로 옮긴 합성 바이트로 시험한다.
 */
import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpMetaExtras } from '../src/meta';
import { readSkpHeader, readSkpImages, skpToScene } from '../src/index';
import { readModelDat } from '../src/model';
import { readMfcModel } from '../src/mfcmodel';
import { componentImage, createDoc, docImages } from '../src/app/doc';
import { entityInfo, nodeEntity } from '../src/app/entity';
import { DEFAULT_UNITS } from '../src/app/units';
import { readTree } from '../src/app/tree';
import { edge, entities, face, instance, modelDat, pngRgb, skpFile, tlv, utf8, vertex } from './build';
import { ID13, mfcFile, squareEntities } from './mfcwrite';

const at = (x: number): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, 0, 0, 1];

/** 한 변 1인 정사각형 면 하나(번호 base부터) */
function square(base: number) {
  const v = (i: number): number => base + i;
  return {
    vertices: [vertex(v(0), 0, 0, 0), vertex(v(1), 1, 0, 0), vertex(v(2), 1, 1, 0), vertex(v(3), 0, 1, 0)],
    edges: [0, 1, 2, 3].map((i) => edge(v(4 + i), v(i), v((i + 1) % 4))),
    faces: [face(v(8), [0, 0, 1, 0], [[0, 1, 2, 3].map((i) => [v(4 + i), false] as [number, boolean])])],
  };
}

/** 분류 체계 절(0205): 6784마다 6785 원래 경로, 6786 이름, 6787 꾸러미 경로 */
const classification = (name: string): Uint8Array =>
  tlv(0x6784, tlv(0x6785, utf8(`C:/Lib/${name}.skc`)), tlv(0x6786, utf8(name)), tlv(0x6787, utf8(`classifications/${name}.skc`)));

/**
 * 정의 셋: 경로·미리보기가 모두 있는 '의자.dae#1'(이름과 그림 파일 이름이 다르다 — 이름으로는 못 찾는 꼴), 미리보기만 있는 '탁자',
 * 아무것도 없는 '선반'(예전 파일과 같은 꼴)
 */
function model(o: { classes?: string[] } = {}): Uint8Array {
  return modelDat({
    definitions: [
      { name: '의자.dae#1', entities: entities(50, square(500)), path: 'C:\\Users\\me\\Downloads\\의자.skp', thumbnail: 'thumbnails/의자_1.png' },
      { name: '탁자', entities: entities(60, square(600)), thumbnail: 'thumbnails/탁자.png' },
      { name: '선반', entities: entities(70, square(700)) },
    ],
    root: entities(undefined, {
      components: [instance(200, 50, at(0), { name: 'A' }), instance(201, 60, at(5)), instance(202, 70, at(10))],
    }),
    sections: o.classes ? [tlv(0x0205, ...o.classes.map(classification))] : [],
  });
}

const png = pngRgb(2, 2, () => [200, 100, 50]);
const pngB = pngRgb(3, 2, () => [10, 20, 30]);

function file(o: { classes?: string[] } = {}): Uint8Array {
  return skpFile(model(o), {
    extra: [
      { name: 'thumbnails/의자_1.png', data: png },
      { name: 'thumbnails/탁자.png', data: pngB },
      { name: 'thumbnails/선반.png', data: png },
    ],
  });
}

const extras = (s: Scene3d): SkpMetaExtras => s.meta as SkpMetaExtras;

describe('정의를 불러온 파일·미리보기 그림 경로(2021+)', () => {
  it('정의 칸으로 읽고, 없는 정의는 칸이 없다', () => {
    const m = readModelDat(model());
    const byName = new Map([...m.definitions.values()].map((d) => [d.name, d]));
    expect(byName.get('의자.dae#1')!.path).toBe('C:\\Users\\me\\Downloads\\의자.skp');
    expect(byName.get('의자.dae#1')!.thumbnail).toBe('thumbnails/의자_1.png');
    expect(byName.get('탁자')!.path).toBeUndefined();
    expect(byName.get('탁자')!.thumbnail).toBe('thumbnails/탁자.png');
    expect('path' in byName.get('선반')!).toBe(false);
    expect('thumbnail' in byName.get('선반')!).toBe(false);
  });

  it('빈 경로는 없는 것으로 본다', () => {
    const m = readModelDat(modelDat({ definitions: [{ name: 'D', entities: entities(50, square(500)), path: '', thumbnail: '' }], root: entities(undefined, {}) }));
    const d = m.definitions.get(50)!;
    expect(d.path).toBeUndefined();
    expect(d.thumbnail).toBeUndefined();
  });

  it('나무 정보에 정의 차례로 싣고, 가진 정의가 없으면 칸을 만들지 않는다', () => {
    const s = skpToScene(file(), { outline: true });
    const info = extras(s).treeInfo!;
    const names = (s.meta as { tree: { definitionNames: string[] } }).tree.definitionNames;
    expect(names).toEqual(['의자.dae#1', '탁자', '선반']);
    expect(info.definitionPath).toEqual(['C:\\Users\\me\\Downloads\\의자.skp', '', '']);
    expect(info.definitionThumbnail).toEqual(['thumbnails/의자_1.png', 'thumbnails/탁자.png', '']);
    const plain = skpToScene(
      skpFile(modelDat({ definitions: [{ name: '선반', entities: entities(70, square(700)) }], root: entities(undefined, { components: [instance(202, 70, at(0))] }) })),
      { outline: true },
    );
    expect(extras(plain).treeInfo).toBeDefined();
    expect('definitionPath' in extras(plain).treeInfo!).toBe(false);
    expect('definitionThumbnail' in extras(plain).treeInfo!).toBe(false);
  });

  it('미리보기 그림: 정의가 적은 경로가 먼저, 없으면 예전처럼 이름으로', () => {
    const bytes = file();
    let k = 0;
    const d = createDoc('t', bytes.length, { scene: skpToScene(bytes, { outline: true }), ms: 1, images: readSkpImages(bytes) }, { makeUrl: (b) => `blob:${b.length}:${k++}` });
    const imgs = d.images!.components;
    // 꾸러미 경로와 파일 이름 둘 다 열쇠(그림 하나에 주소 하나)
    expect(imgs.get('thumbnails/의자_1.png')).toBe(imgs.get('의자_1'));
    expect(d.images!.urls.length).toBe(3 + (d.images!.model ? 1 : 0));
    // '의자.dae#1'은 이름이 그림 파일 이름과 달라 예전에는 그림이 없었다
    expect(componentImage(d, '의자.dae#1')).toBe(imgs.get('thumbnails/의자_1.png'));
    expect(componentImage({ images: d.images }, '의자.dae#1')).toBeNull();
    expect(componentImage(d, '탁자')).toBe(imgs.get('thumbnails/탁자.png'));
    expect(componentImage(d, '선반')).toBe(imgs.get('선반'));
    expect(componentImage(d, '없음')).toBeNull();
  });

  it('적은 경로의 그림이 꾸러미에 없으면 이름으로 찾는다', () => {
    const bytes = skpFile(model(), { extra: [{ name: 'thumbnails/탁자.png', data: png }] });
    const d = createDoc('t', bytes.length, { scene: skpToScene(bytes, { outline: true }), ms: 1, images: readSkpImages(bytes) }, { makeUrl: () => 'blob:x' });
    expect(componentImage(d, '의자.dae#1')).toBeNull();
    expect(componentImage(d, '탁자')).toBe('blob:x');
  });

  it('엔티티 정보: 불러온 파일은 줄에 파일 이름, 도움말에 전체 경로', () => {
    const s = skpToScene(file(), { outline: true });
    const tree = readTree(s)!;
    const info = extras(s).treeInfo!;
    const node = tree.names.indexOf('A');
    const e = nodeEntity(tree, node, info, [], {});
    expect(e!.definitionPath).toBe('C:\\Users\\me\\Downloads\\의자.skp');
    const rows = entityInfo(e!, DEFAULT_UNITS, 25.4).rows;
    expect(rows.find((r) => r.label === '불러온 파일')).toEqual({ label: '불러온 파일', value: '의자.skp', title: 'C:\\Users\\me\\Downloads\\의자.skp' });
    const other = nodeEntity(tree, tree.names.findIndex((_, i) => i !== node &&tree.definitionNames[tree.definition[i]!] === '탁자'), info, [], {});
    expect(entityInfo(other!, DEFAULT_UNITS, 25.4).rows.some((r) => r.label === '불러온 파일')).toBe(false);
    // 슬래시 경로도 마지막 이름만
    expect(entityInfo({ kind: 'component', definitionPath: '/Users/me/Library/의자.skp' }, DEFAULT_UNITS, 1).rows).toContainEqual({ label: '불러온 파일', value: '의자.skp', title: '/Users/me/Library/의자.skp' });
  });
});

describe('분류 체계(2021+ 0205)', () => {
  it('이름을 차례대로 한 번씩 읽어 meta·문서에 싣는다', () => {
    const m = readModelDat(model({ classes: ['IFC 2x3', 'IFC4', 'IFC4'] }));
    expect(m.classifications).toEqual(['IFC 2x3', 'IFC4']);
    const s = skpToScene(file({ classes: ['IFC 2x3', 'IFC4'] }), { outline: true });
    expect(extras(s).classifications).toEqual(['IFC 2x3', 'IFC4']);
    expect(createDoc('t', 1, { scene: s, ms: 1 }).classifications).toEqual(['IFC 2x3', 'IFC4']);
  });

  it('빈 절·없는 절은 칸을 만들지 않는다', () => {
    expect('classifications' in readModelDat(model({ classes: [] }))).toBe(false);
    expect('classifications' in readModelDat(model())).toBe(false);
    const s = skpToScene(file(), { outline: true });
    expect('classifications' in (s.meta as object)).toBe(false);
    expect(createDoc('t', 1, { scene: s, ms: 1 }).classifications).toEqual([]);
  });
});

describe('정의를 불러온 파일(2020 이하 CComponentDefinition 경로)', () => {
  it('경로 칸을 읽는다(빈 글은 없음)', () => {
    const bytes = mfcFile({
      schemas: 'v20',
      definitions: [
        { name: '의자', path: 'C:\\Lib\\의자.skp', entities: squareEntities() },
        { name: '탁자', entities: squareEntities() },
      ],
      root: { instances: [{ def: 0, xform: ID13 }, { def: 1, xform: ID13 }] },
    });
    const m = readMfcModel(bytes, readSkpHeader(bytes)!).model;
    expect(m.definitions.get(0)!.path).toBe('C:\\Lib\\의자.skp');
    expect('path' in m.definitions.get(1)!).toBe(false);
    const s = skpToScene(bytes, { outline: true });
    expect(extras(s).treeInfo!.definitionPath).toEqual(['C:\\Lib\\의자.skp', '']);
  });
});

it('docImages: 같은 경로의 그림은 한 번만 주소를 만든다', () => {
  const imgs = docImages(
    {
      components: [
        { path: 'thumbnails/a.png', name: 'a', mime: 'image/png', bytes: png },
        { path: 'thumbnails/a.png', name: 'a', mime: 'image/png', bytes: png },
        { path: 'thumbnails/a.jpg', name: 'a', mime: 'image/jpeg', bytes: png },
      ],
      materials: [],
      scenes: [],
      skipped: 0,
      warnings: [],
    },
    (_, mime) => `blob:${mime}`,
  )!;
  expect(imgs.urls).toEqual(['blob:image/png', 'blob:image/jpeg']);
  // 이름 열쇠는 처음 것
  expect(imgs.components.get('a')).toBe('blob:image/png');
  expect(imgs.components.get('thumbnails/a.jpg')).toBe('blob:image/jpeg');
});
