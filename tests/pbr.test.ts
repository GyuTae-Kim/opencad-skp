/**
 * PBR 금속·거칠기(55차 — 코어 0.43.0 그물 PBR 필드): material.xml <mat:pbrMR> 읽기(켬 깃발이 1인 칸만), 꾸러미의 PBR 그림 꺼내기
 * (무늬 재질만·다른 그림을 다 넣은 뒤 남은 한도·같은 그림은 한 번), 장면의 PBR 무늬와 그물 필드(그림은 앞면 무늬 좌표를 단 그물만, 값은 그 재질 모두),
 * 워커의 PBR 그림 떼기(휴대 기기·무늬 좌표를 잃은 그물), 놓기의 raw 쥐기(견본 주소는 그대로).
 * 꼬리표 이름·값은 이 컴퓨터의 2025+ 표본 material.xml 꼴을 따른다(실제 파일은 저장소에 넣지 않는다).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d } from 'opencad-viewer3d';
import type { Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import { installDom } from './fakegl/fakedom';
import { readSkpImages, skpFileToScene, skpToScene, type SkpTextureInfo } from '../src/index';
import { bytesSource, SourceItems } from '../src/range';
import type { ZipItem } from '../src/zip';
import { parseMaterialPbr, parseMaterialXml } from '../src/materials';
import { dropPbrMaps, dropTexture, needsDecode, PBR_MIN_TEXTURE_LIMIT } from '../src/worker/textures';
import { prepareRelease } from '../src/app/release';
import type { DocImages } from '../src/app/doc';
import { textureLimitsFor } from '../src/app/texlimits';
import { edge, entities, face, instance, materialXml, modelDat, pngRgb, skpFile, vertex } from './build';

/** <mat:pbrMR> 꼴(표본과 같은 차례·꼬리표) */
function pbrBlock(o: {
  metal?: { on: boolean; factor?: number; file?: string };
  rough?: { on: boolean; factor?: number; file?: string; invert?: boolean };
  normal?: { on: boolean; file?: string; scale?: number; style?: 0 | 1 };
}): string {
  const tex = (tag: string, file: string | undefined, id: number): string => (file ? `      <mat:${tag} id="${id}" path="./${file}" file_name="C:/x/${file}"/>\n` : '');
  return (
    '    <mat:pbrMR xScale="10" yScale="10">\n' +
    `      <mat:enable_metalness>${o.metal?.on ? 1 : 0}</mat:enable_metalness>\n` +
    `      <mat:enable_roughness>${o.rough?.on ? 1 : 0}</mat:enable_roughness>\n` +
    `      <mat:roughness_texture_invert>${o.rough?.invert ? 1 : 0}</mat:roughness_texture_invert>\n` +
    `      <mat:enable_normal>${o.normal?.on ? 1 : 0}</mat:enable_normal>\n` +
    '      <mat:enable_occlusion>0</mat:enable_occlusion>\n' +
    tex('metallic_texture', o.metal?.file, 2) +
    tex('roughness_texture', o.rough?.file, 3) +
    tex('normal_texture', o.normal?.file, 4) +
    `      <mat:metallicFactor>${o.metal?.factor ?? 1}</mat:metallicFactor>\n` +
    `      <mat:roughnessFactor>${o.rough?.factor ?? 1}</mat:roughnessFactor>\n` +
    `      <mat:normalMapStyle>${o.normal?.style ?? 1}</mat:normalMapStyle>\n` +
    `      <mat:normalScale>${o.normal?.scale ?? 1}</mat:normalScale>\n` +
    '      <mat:occlusionStrength>1</mat:occlusionStrength>\n' +
    '      <mat:baseColorFactor>4294967295</mat:baseColorFactor>\n' +
    '    </mat:pbrMR>\n'
  );
}
/** 무늬 재질 xml에 PBR 꼬리표를 넣는다(무늬 꼬리표 뒤 — 표본 차례) */
const texturedPbr = (name: string, file: string, block: string): string =>
  materialXml(name, [120, 120, 120], 1, 0, true, { file, width: 10, height: 10 }).replace('  </mat:material>', `${block}  </mat:material>`);
/** 무늬 없는 재질 xml에 PBR 꼬리표 */
const plainPbr = (name: string, block: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<materialDocument>\n  <mat:material name="${name}" type="0" colorRed="90" colorGreen="90" colorBlue="95" colorizeType="0" trans="1" useTrans="0" hasTexture="0">\n${block}  </mat:material>\n</materialDocument>\n`;

/**
 * 재질: 1 금속판(무늬 + 법선·거칠기·금속 그림), 2 금속(무늬 없음 — 값만), 3 보통(무늬, PBR 모두 끔), 4 같은그림(거칠기·금속 한 그림), 5 빠짐(그림 없는 칸 + 값),
 * 6 법선만(56차 — 색 무늬 없이 법선·거칠기 그림, 그림 한 장 20 × 5 인치, 폴더에 재질 미리보기 그림도 — 표본 꼴)
 */
const MATS: [number, string][] = [
  [1, '금속판'],
  [2, '금속'],
  [3, '보통'],
  [4, '같은그림'],
  [5, '빠짐'],
  [6, '법선만'],
];
const XMLS: [string, string][] = [
  [
    '금속판',
    texturedPbr(
      '금속판',
      'a.png',
      pbrBlock({ metal: { on: true, file: 'm.png' }, rough: { on: true, factor: 0.6, file: 'r.png', invert: true }, normal: { on: true, file: 'n.png', scale: 0.5, style: 1 } }),
    ),
  ],
  ['금속', plainPbr('금속', pbrBlock({ metal: { on: true, factor: 0.3 }, rough: { on: true, factor: 0.25 }, normal: { on: true } }))],
  ['보통', texturedPbr('보통', 'b.png', pbrBlock({ rough: { on: false, file: 'off.png' } }))],
  ['같은그림', texturedPbr('같은그림', 'c.png', pbrBlock({ metal: { on: true, file: 'rm.png' }, rough: { on: true, file: 'rm.png' }, normal: { on: true, file: 'cn.png', style: 0 } }))],
  ['빠짐', texturedPbr('빠짐', 'd.png', pbrBlock({ metal: { on: true, factor: 0.5 }, rough: { on: true, file: 'gone.png' }, normal: { on: true, file: 'gone-n.png' } }))],
  [
    '법선만',
    plainPbr('법선만', pbrBlock({ rough: { on: true, factor: 0.7, file: 'pr.png' }, normal: { on: true, file: 'pn.png', style: 0 } })).replace(
      'xScale="10" yScale="10"',
      'xScale="20" yScale="5"',
    ),
  ],
];
const png = (seed: number): Uint8Array => pngRgb(2, 2, (x, y) => [x * 100 + seed, y * 100, seed * 3]);
const IMGS = [
  ['금속판/a.png', 1],
  ['금속판/n.png', 2],
  ['금속판/r.png', 3],
  ['금속판/m.png', 4],
  ['보통/b.png', 5],
  ['보통/off.png', 6],
  ['같은그림/c.png', 7],
  ['같은그림/rm.png', 8],
  ['같은그림/cn.png', 9],
  ['빠짐/d.png', 10],
  ['법선만/pn.png', 11],
  ['법선만/pr.png', 12],
  ['법선만/thumbnail.png', 13],
].map(([n, s]) => ({ name: `materials/${n}`, data: png(s as number) }));

/** 10 × 10 인치 정사각형 면 하나(재질 mat, 기본 무늬 투영)인 정의 */
function squareDef(defId: number, mat: number): Uint8Array {
  const b = defId * 100;
  const P: [number, number, number][] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ];
  return entities(defId, {
    vertices: P.map((p, i) => vertex(b + i, ...p)),
    edges: [0, 1, 2, 3].map((i) => edge(b + 10 + i, b + i, b + ((i + 1) % 4))),
    faces: [
      face(
        b + 20,
        [0, 0, 1, 0],
        [
          [
            [b + 10, false],
            [b + 11, false],
            [b + 12, false],
            [b + 13, false],
          ],
        ],
        { material: mat },
      ),
    ],
  });
}
/** 재질마다 정사각형 면 하나를 놓은 꾸러미 */
function pack(mats: [number, string][], xmls: [string, string][], imgs: { name: string; data: Uint8Array }[]): Uint8Array {
  const defs = mats.map(([id], i) => ({ name: `판${i}`, entities: squareDef(50 + i, id) }));
  const comps = mats.map((_, i) => instance(900 + i, 50 + i, [1, 0, 0, 0, 1, 0, 0, 0, 1, i * 20, 0, 0, 1]));
  const model = modelDat({ materials: mats, layers: [[1, 'Layer0']], definitions: defs, root: entities(undefined, { components: comps }) });
  return skpFile(model, { materials: xmls, extra: imgs });
}
const file = (): Uint8Array => pack(MATS, XMLS, IMGS);
const meshOf = (s: Scene3d, mat: string): Mesh3d => s.meshes.find((m) => m.name?.startsWith(`${mat} ·`))!;
const PBR_KEYS = ['normalTexture', 'normalScale', 'normalFlipY', 'roughnessTexture', 'roughness', 'roughnessInvert', 'metallicTexture', 'metallic'] as const;
const pbrOf = (m: Mesh3d): Record<string, unknown> => Object.fromEntries(PBR_KEYS.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));

describe('material.xml <mat:pbrMR>', () => {
  it('켬 깃발이 1인 칸만: 그림 파일·배율·매끈함 그림·DirectX 꼴(normalMapStyle 1)', () => {
    expect(parseMaterialPbr(XMLS[0]![1])).toEqual({
      metallic: { factor: 1, file: 'm.png' },
      roughness: { factor: 0.6, file: 'r.png', invert: true },
      normal: { file: 'n.png', scale: 0.5, directX: true },
      tile: { width: 10, height: 10 },
    });
    // 값만(법선은 켰어도 그림이 없으면 없음) — 그림이 없으면 그림 한 장 크기도 두지 않는다
    expect(parseMaterialPbr(XMLS[1]![1])).toEqual({ metallic: { factor: 0.3 }, roughness: { factor: 0.25, invert: false } });
    // 56차: 색 무늬 없는 재질도 그림이 있으면 <mat:pbrMR xScale yScale>을 그림 한 장 크기로
    expect(parseMaterialPbr(XMLS[5]![1])).toEqual({ roughness: { factor: 0.7, file: 'pr.png', invert: false }, normal: { file: 'pn.png', scale: 1, directX: false }, tile: { width: 20, height: 5 } });
    expect(parseMaterialXml(XMLS[5]![1])!.texture).toBeUndefined();
    // 모두 끔(SketchUp이 거의 모든 재질에 적는 기본 꼴) → 없음, 재질 정보에도 칸이 없다
    expect(parseMaterialPbr(XMLS[2]![1])).toBeUndefined();
    expect(parseMaterialXml(XMLS[2]![1])!.pbr).toBeUndefined();
    expect(parseMaterialXml(XMLS[0]![1])!.pbr!.normal!.directX).toBe(true);
    expect(parseMaterialPbr(XMLS[3]![1])!.normal).toEqual({ file: 'cn.png', scale: 1, directX: false });
  });

  it('꼴이 다르거나 없는 값: 꼬리표 없음·범위 밖 값은 자르고, normalMapStyle이 없으면 기본(1), 안에 <mat:image>를 둔 꼴도 읽는다', () => {
    expect(parseMaterialPbr('<mat:material name="x"/>')).toBeUndefined();
    const odd =
      '<mat:pbrMR><mat:enable_metalness>1</mat:enable_metalness><mat:metallicFactor>7</mat:metallicFactor>' +
      '<mat:enable_roughness>1</mat:enable_roughness><mat:roughnessFactor>abc</mat:roughnessFactor>' +
      '<mat:enable_normal>1</mat:enable_normal><mat:normal_texture><mat:image path="./n2.png"/></mat:normal_texture><mat:normalScale>-2</mat:normalScale></mat:pbrMR>';
    expect(parseMaterialPbr(odd)).toEqual({ metallic: { factor: 1 }, roughness: { factor: 1, invert: false }, normal: { file: 'n2.png', scale: 0, directX: true } });
    // 그림 한 장 크기가 0·음수·글이면 두지 않는다
    for (const bad of ['xScale="0" yScale="5"', 'xScale="-1" yScale="5"', 'xScale="a" yScale="5"', 'yScale="5"'])
      expect(parseMaterialPbr(odd.replace('<mat:pbrMR>', `<mat:pbrMR ${bad}>`))!.tile, bad).toBeUndefined();
    expect(parseMaterialPbr(odd.replace('<mat:pbrMR>', '<mat:pbrMR xScale="3.5" yScale="7">'))!.tile).toEqual({ width: 3.5, height: 7 });
  });
});

describe('꾸러미의 PBR 그림', () => {
  it('무늬 재질(56차부터 그림 한 장 크기가 있는 색 무늬 없는 재질도)의 켠 그림만, 같은 그림은 쓰임을 합쳐 한 번 — 다른 그림·경고는 예전과 같다', () => {
    const img = readSkpImages(file());
    // 색 무늬 없는 PBR 재질의 견본은 PBR 그림이 아닌 그림(재질 미리보기 — 꾸러미 차례로는 법선 그림이 먼저)
    expect(img.materials.map((m) => [m.folder, m.name])).toEqual([
      ['금속판', 'a.png'],
      ['보통', 'b.png'],
      ['같은그림', 'c.png'],
      ['빠짐', 'd.png'],
      ['법선만', 'thumbnail.png'],
    ]);
    // 색 무늬 없는 재질의 PBR 그림이 먼저(그 재질에는 유일한 결), 그다음 무늬 재질의 PBR 그림(꾸러미 차례)
    expect(img.pbr!.map((p) => [p.folder, p.name, p.roles])).toEqual([
      ['법선만', 'pn.png', ['normal']],
      ['법선만', 'pr.png', ['roughness']],
      ['금속판', 'n.png', ['normal']],
      ['금속판', 'r.png', ['roughness']],
      ['금속판', 'm.png', ['metallic']],
      ['같은그림', 'cn.png', ['normal']],
      ['같은그림', 'rm.png', ['roughness', 'metallic']],
    ]);
    expect(img.skipped).toBe(0);
    expect(img.warnings).toEqual([]);
    expect(img.pbrSkipped).toBeUndefined();
  });

  it('PBR 그림은 맨 뒤 차례: 한도가 모자라면 경고·건너뜀 수 없이 pbrSkipped로만 센다(다른 그림은 그대로)', () => {
    const all = readSkpImages(file());
    const some = readSkpImages(file(), { maxCount: all.materials.length + 2 });
    expect(some.materials.length).toBe(all.materials.length);
    expect(some.pbr!.map((p) => p.name)).toEqual(['pn.png', 'pr.png']);
    expect(some.pbrSkipped).toBe(5);
    expect(some.skipped).toBe(0);
    expect(some.warnings).toEqual([]);
  });
});

/**
 * 57차 그림이 하나뿐인 재질 폴더(56차까지 material.xml을 읽지 않아 그 그림이 PBR 그림이어도 빠졌다):
 * 1 법선한장(색 무늬 없이 법선 그림 한 장뿐 — 재질 미리보기 그림도 없음, 한 장 20 × 5 인치), 2 같은한장(색 무늬와 같은 파일을 거칠기 그림으로),
 * 3 값한장(색 무늬 + 금속성 값만), 4 빈폴더(값만, 그림 없음)
 */
const ONE_MATS: [number, string][] = [
  [1, '법선한장'],
  [2, '같은한장'],
  [3, '값한장'],
  [4, '빈폴더'],
];
const ONE_XMLS: [string, string][] = [
  ['법선한장', plainPbr('법선한장', pbrBlock({ normal: { on: true, file: 'only-n.png' } })).replace('xScale="10" yScale="10"', 'xScale="20" yScale="5"')],
  ['같은한장', texturedPbr('같은한장', 'e.png', pbrBlock({ rough: { on: true, factor: 0.8, file: 'e.png' } }))],
  ['값한장', texturedPbr('값한장', 'f.png', pbrBlock({ metal: { on: true, factor: 0.4 } }))],
  ['빈폴더', plainPbr('빈폴더', pbrBlock({ rough: { on: true, factor: 0.2 } }))],
];
const ONE_IMGS = [
  ['법선한장/only-n.png', 21],
  ['같은한장/e.png', 22],
  ['값한장/f.png', 23],
].map(([n, s]) => ({ name: `materials/${n}`, data: png(s as number) }));
const oneFile = (): Uint8Array => pack(ONE_MATS, ONE_XMLS, ONE_IMGS);

describe('57차 그림이 하나뿐인 재질 폴더의 PBR 그림', () => {
  it('그 그림이 PBR 그림이면 넣는다: 색 무늬 없는 재질의 법선 그림(견본 그림은 두지 않는다)·색 무늬와 같은 파일의 거칠기 그림 — 값만인 재질은 예전과 같다', () => {
    const img = readSkpImages(oneFile());
    // 폴더 그림이 모두 PBR 그림인 색 무늬 없는 재질은 견본 그림이 없다(재질 목록은 재질 색)
    expect(img.materials.map((m) => [m.folder, m.name])).toEqual([
      ['같은한장', 'e.png'],
      ['값한장', 'f.png'],
    ]);
    expect(img.pbr!.map((p) => [p.folder, p.name, p.roles, p.path])).toEqual([
      ['법선한장', 'only-n.png', ['normal'], 'materials/법선한장/only-n.png'],
      ['같은한장', 'e.png', ['roughness'], 'materials/같은한장/e.png'],
    ]);
    expect(img.pbr![1]!.bytes).toEqual(img.materials[0]!.bytes);
    expect(img.skipped).toBe(0);
    expect(img.warnings).toEqual([]);
    expect(img.pbrSkipped).toBeUndefined();
  });

  it('장면: 법선 그림 한 장뿐인 재질은 무늬 좌표만(한 장 20 × 5 인치)·법선 그림, 같은 파일 거칠기는 색 무늬 좌표를 함께 쓴다 — 색 무늬·값은 PBR 그림이 없을 때와 같다', () => {
    const bytes = oneFile();
    const img = readSkpImages(bytes);
    const s = skpToScene(bytes, { textures: img.materials, pbrTextures: img.pbr });
    const n = meshOf(s, '법선한장');
    expect(n.texture).toBeUndefined();
    expect(pbrOf(n)).toEqual({ normalTexture: 'skp-pbr-1-normal', normalFlipY: true });
    const uv = Array.from(n.uvs!);
    const us = uv.filter((_, i) => i % 2 === 0);
    const vs = uv.filter((_, i) => i % 2 === 1);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.5, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2, 6);
    const same = meshOf(s, '같은한장');
    expect(same.texture).toBe('skp-tex-2');
    expect(pbrOf(same)).toEqual({ roughnessTexture: 'skp-pbr-2-roughness', roughness: 0.8 });
    expect(pbrOf(meshOf(s, '값한장'))).toEqual({ metallic: 0.4 });
    expect(pbrOf(meshOf(s, '빈폴더'))).toEqual({ roughness: 0.2 });
    expect(s.textures!.map((t) => t.id)).toEqual(['skp-tex-2', 'skp-tex-3', 'skp-pbr-1-normal', 'skp-pbr-2-roughness']);
    expect(s.textures!.find((t) => t.id === 'skp-pbr-1-normal')!.data).toBe(img.pbr![0]!.bytes);
    // PBR 그림을 주지 않으면(56차까지와 같은 입력) 그 칸만 빠진다: 그림을 받지 못한 거칠기는 배율을 값으로 쓰지 않는다
    const base = skpToScene(bytes, { textures: img.materials });
    expect(pbrOf(meshOf(base, '법선한장'))).toEqual({});
    expect(meshOf(base, '법선한장').uvs).toBeUndefined();
    expect(pbrOf(meshOf(base, '같은한장'))).toEqual({});
    expect(pbrOf(meshOf(base, '값한장'))).toEqual({ metallic: 0.4 });
    const arrays = (x: Scene3d): unknown[] => x.meshes.filter((m) => !m.name?.startsWith('법선한장')).map((m) => [m.id, m.positions, m.uvs, m.texture, m.color]);
    expect(arrays(s)).toEqual(arrays(base));
    expect(s.meta!.materialStats).toEqual(base.meta!.materialStats);
  });

  it('자리만 읽는 길(skpFileToScene)도 같은 그림·장면이고, 미리 읽기 계획에 그림이 하나뿐인 폴더의 material.xml이 든다', async () => {
    const bytes = oneFile();
    const plans: string[][] = [];
    const src = bytesSource(bytes);
    const orig = SourceItems.prototype.plan;
    SourceItems.prototype.plan = function (this: SourceItems, list: readonly ZipItem[]) {
      plans.push(list.map((x) => x.name));
      return orig.call(this, list);
    };
    let r: Awaited<ReturnType<typeof skpFileToScene>>;
    try {
      r = await skpFileToScene(src);
    } finally {
      SourceItems.prototype.plan = orig;
    }
    expect(plans[0]).toEqual(['materials/법선한장/material.xml', 'materials/같은한장/material.xml', 'materials/값한장/material.xml']);
    const img = readSkpImages(bytes);
    expect(r.images!.pbr!.map((p) => [p.folder, p.name, p.roles])).toEqual(img.pbr!.map((p) => [p.folder, p.name, p.roles]));
    expect(r.images!.materials.map((m) => m.folder)).toEqual(img.materials.map((m) => m.folder));
    expect(pbrOf(meshOf(r.scene, '법선한장'))).toEqual({ normalTexture: 'skp-pbr-1-normal', normalFlipY: true });
  });
});

describe('장면의 PBR 무늬·그물 필드', () => {
  const open = (o: { pbr?: boolean } = {}): { s: Scene3d; img: ReturnType<typeof readSkpImages> } => {
    const bytes = file();
    const img = readSkpImages(bytes);
    return { s: skpToScene(bytes, { textures: img.materials, ...(o.pbr === false ? {} : { pbrTextures: img.pbr }) }), img };
  };

  it('무늬 재질: 법선·거칠기·금속 그림 id와 배율(기본 배율 1·OpenGL 꼴은 뺀다), 그림 바이트는 복사하지 않는다', () => {
    const { s, img } = open();
    const m = meshOf(s, '금속판');
    expect(m.texture).toBe('skp-tex-1');
    expect(pbrOf(m)).toEqual({
      normalTexture: 'skp-pbr-1-normal',
      normalScale: 0.5,
      normalFlipY: true,
      roughnessTexture: 'skp-pbr-1-roughness',
      roughness: 0.6,
      roughnessInvert: true,
      metallicTexture: 'skp-pbr-1-metallic',
    });
    // 같은 그림이 거칠기·금속이면 무늬 하나, OpenGL 꼴(normalMapStyle 0)은 뒤집지 않는다
    expect(pbrOf(meshOf(s, '같은그림'))).toEqual({ normalTexture: 'skp-pbr-4-normal', roughnessTexture: 'skp-pbr-4-roughness-metallic', metallicTexture: 'skp-pbr-4-roughness-metallic' });
    // 값만(무늬 없는 재질 — 무늬 좌표 없음)
    const plain = meshOf(s, '금속');
    expect(pbrOf(plain)).toEqual({ roughness: 0.25, metallic: 0.3 });
    expect(plain.uvs).toBeUndefined();
    // 모두 끈 재질은 없음, 그림을 받지 못한 칸은 배율을 값으로 쓰지 않고 뺀다(값만 켠 금속성은 둔다)
    expect(pbrOf(meshOf(s, '보통'))).toEqual({});
    expect(pbrOf(meshOf(s, '빠짐'))).toEqual({ metallic: 0.5 });
    // 장면 무늬: 색 무늬(예전 차례) 다음 PBR 그림, 바이트는 꺼낸 그림 배열 그대로
    expect(s.textures!.map((t) => t.id)).toEqual([
      'skp-tex-1',
      'skp-tex-3',
      'skp-tex-4',
      'skp-tex-5',
      'skp-pbr-1-normal',
      'skp-pbr-1-roughness',
      'skp-pbr-1-metallic',
      'skp-pbr-4-normal',
      'skp-pbr-4-roughness-metallic',
      'skp-pbr-6-normal',
      'skp-pbr-6-roughness',
    ]);
    const nrm = s.textures!.find((t) => t.id === 'skp-pbr-1-normal')!;
    expect(nrm.data).toBe(img.pbr!.find((p) => p.name === 'n.png')!.bytes);
    expect(nrm).toMatchObject({ mime: 'image/png', width: 2, height: 2 });
    const infos = s.meta!.textures as SkpTextureInfo[];
    expect(infos.find((t) => t.id === 'skp-pbr-4-roughness-metallic')).toEqual({
      id: 'skp-pbr-4-roughness-metallic',
      material: '같은그림',
      folder: '같은그림',
      path: 'materials/같은그림/rm.png',
      tile: [10, 10],
      alphaPossible: false,
      pbr: ['roughness', 'metallic'],
    });
    // 워커는 PBR 그림을 풀거나 색을 바꾸지 않는다
    expect(infos.filter((t) => t.pbr).every((t) => !needsDecode(t))).toBe(true);
    // 색 무늬 정보·재질 통계는 PBR이 없을 때와 같다
    const base = open({ pbr: false }).s;
    expect(infos.filter((t) => !t.pbr)).toEqual(base.meta!.textures);
    expect(s.meta!.materialStats).toEqual(base.meta!.materialStats);
  });

  it('56차 색 무늬 없는 PBR 재질: 그 그림이 쓸 무늬 좌표만(무늬 id 없음 — 한 장 크기는 <mat:pbrMR xScale yScale>), 그림 칸·정보의 한 장 크기도 그 값', () => {
    const { s } = open();
    const m = meshOf(s, '법선만');
    expect(m.texture).toBeUndefined();
    expect(m.backTexture).toBeUndefined();
    expect(m.backUvs).toBeUndefined();
    expect(pbrOf(m)).toEqual({ normalTexture: 'skp-pbr-6-normal', roughnessTexture: 'skp-pbr-6-roughness', roughness: 0.7 });
    // 10 × 10 인치 정사각형(z = 0, 기본 투영) ÷ 한 장 20 × 5 인치 → u 0~0.5, v 0~2
    const uv = Array.from(m.uvs!);
    expect(uv.length).toBe((m.positions.length / 3) * 2);
    const us = uv.filter((_, i) => i % 2 === 0);
    const vs = uv.filter((_, i) => i % 2 === 1);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.5, 6);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2, 6);
    const infos = s.meta!.textures as SkpTextureInfo[];
    expect(infos.find((t) => t.id === 'skp-pbr-6-normal')).toEqual({
      id: 'skp-pbr-6-normal',
      material: '법선만',
      folder: '법선만',
      path: 'materials/법선만/pn.png',
      tile: [20, 5],
      alphaPossible: false,
      pbr: ['normal'],
    });
    // 색 무늬 목록·재질 통계에는 무늬가 없다(무늬 좌표만 만드는 재질은 장면 무늬가 아니다)
    expect(infos.some((t) => t.id.startsWith('skp-uv-'))).toBe(false);
    expect((s.meta!.materialStats as { name: string; texture?: string }[]).find((x) => x.name === '법선만')!.texture).toBeUndefined();
  });

  it('PBR 그림을 주지 않으면 그림 칸은 없고 값만 — 색 무늬·그물 배열은 같다(색 무늬 없는 PBR 재질은 무늬 좌표도 없다)', () => {
    const { s } = open({ pbr: false });
    expect(s.textures!.map((t) => t.id)).toEqual(['skp-tex-1', 'skp-tex-3', 'skp-tex-4', 'skp-tex-5']);
    expect(pbrOf(meshOf(s, '금속판'))).toEqual({});
    expect(pbrOf(meshOf(s, '금속'))).toEqual({ roughness: 0.25, metallic: 0.3 });
    expect(pbrOf(meshOf(s, '법선만'))).toEqual({});
    expect(meshOf(s, '법선만').uvs).toBeUndefined();
    const full = open().s;
    const arrays = (x: Scene3d): unknown[] => x.meshes.filter((m) => !m.name?.startsWith('법선만')).map((m) => [m.id, m.positions, m.uvs, m.texture]);
    expect(arrays(s)).toEqual(arrays(full));
    expect(s.meshes.map((m) => [m.id, m.positions])).toEqual(full.meshes.map((m) => [m.id, m.positions]));
  });

  it('2025 이전 꼴(PBR 꼬리표 없음)·그림을 넘기지 않은 장면은 예전과 같다', () => {
    const bytes = file();
    const s = skpToScene(bytes);
    expect(s.textures).toBeUndefined();
    // 무늬가 없어도 값만 켠 칸은 단다(그물 색 칠하기와 무관)
    expect(pbrOf(meshOf(s, '금속'))).toEqual({ roughness: 0.25, metallic: 0.3 });
    expect(pbrOf(meshOf(s, '금속판'))).toEqual({});
  });
});

describe('워커·놓기의 PBR 그림', () => {
  const scene = (): Scene3d => {
    const bytes = file();
    const img = readSkpImages(bytes);
    return skpToScene(bytes, { textures: img.materials, pbrTextures: img.pbr });
  };

  it('휴대 기기(무늬 한도 < 2048)는 PBR 그림을 뗀다: 그림·그 배율 칸·장면 무늬·정보를 빼고 값은 둔다', () => {
    expect(PBR_MIN_TEXTURE_LIMIT).toBe(2048);
    expect(textureLimitsFor({}).limit).toBe(PBR_MIN_TEXTURE_LIMIT);
    expect(textureLimitsFor({ coarse: true, narrow: true }).limit).toBeLessThan(PBR_MIN_TEXTURE_LIMIT);
    expect(textureLimitsFor({ deviceMemory: 2 }).limit).toBeLessThan(PBR_MIN_TEXTURE_LIMIT);
    const s = scene();
    expect(meshOf(s, '법선만').uvs).toBeDefined();
    expect(dropPbrMaps(s)).toBe(7);
    // 56차: 색 무늬 없이 PBR 그림만 쓰던 그물은 무늬 좌표도 지운다(무늬 좌표는 그 그림만 썼다), 색 무늬 그물은 그대로
    expect(meshOf(s, '법선만').uvs).toBeUndefined();
    expect(meshOf(s, '금속판').uvs).toBeDefined();
    expect(s.meshes.every((m) => !m.normalTexture && !m.roughnessTexture && !m.metallicTexture && m.normalScale === undefined && m.roughnessInvert === undefined)).toBe(true);
    expect(pbrOf(meshOf(s, '금속판'))).toEqual({});
    expect(pbrOf(meshOf(s, '금속'))).toEqual({ roughness: 0.25, metallic: 0.3 });
    expect(pbrOf(meshOf(s, '빠짐'))).toEqual({ metallic: 0.5 });
    expect(s.textures!.map((t) => t.id)).toEqual(['skp-tex-1', 'skp-tex-3', 'skp-tex-4', 'skp-tex-5']);
    expect((s.meta!.textures as SkpTextureInfo[]).some((t) => t.pbr)).toBe(false);
    expect(dropPbrMaps(s)).toBe(0);
  });

  it('색 무늬를 빼면(풀지 못함) 그 그물의 PBR 그림도 뺀다(무늬 좌표를 함께 쓴다) — 다른 재질 PBR은 그대로', () => {
    const s = scene();
    dropTexture(s, 'skp-tex-1');
    const m = meshOf(s, '금속판');
    expect(m.uvs).toBeUndefined();
    expect(pbrOf(m)).toEqual({});
    expect(s.textures!.map((t) => t.id)).toEqual(['skp-tex-3', 'skp-tex-4', 'skp-tex-5', 'skp-pbr-4-normal', 'skp-pbr-4-roughness-metallic', 'skp-pbr-6-normal', 'skp-pbr-6-roughness']);
    expect(pbrOf(meshOf(s, '같은그림')).roughnessTexture).toBe('skp-pbr-4-roughness-metallic');
    // 색 무늬 없는 PBR 재질: 그림 하나를 빼면(풀지 못함) 남은 그림이 좌표를 쓴다, 둘 다 빼면 좌표도 지운다
    dropTexture(s, 'skp-pbr-6-normal');
    expect(pbrOf(meshOf(s, '법선만'))).toEqual({ roughnessTexture: 'skp-pbr-6-roughness', roughness: 0.7 });
    expect(meshOf(s, '법선만').uvs).toBeDefined();
    dropTexture(s, 'skp-pbr-6-roughness');
    expect(pbrOf(meshOf(s, '법선만'))).toEqual({});
    expect(meshOf(s, '법선만').uvs).toBeUndefined();
    expect(meshOf(s, '같은그림').uvs).toBeDefined();
  });

  it('놓기: PBR 그림도 raw로 쥐되 재질 목록 견본 주소는 바꾸지 않는다(같은 폴더의 색 그림이 견본)', () => {
    const s = scene();
    const images: DocImages = {
      model: null,
      materials: new Map([
        ['금속판', { name: 'a.png', url: 'blob:old-a' }],
        ['같은그림', { name: 'c.png', url: 'blob:old-c' }],
      ]),
      components: new Map(),
      scenes: [],
      skipped: 0,
      urls: ['blob:old-a', 'blob:old-c'],
    };
    const held = prepareRelease({ scene: s, images });
    const pbr = held.filter((h) => h.info.pbr);
    expect(pbr.map((h) => [h.id, !!h.raw, h.blob.type])).toEqual([
      ['skp-pbr-1-normal', true, 'image/png'],
      ['skp-pbr-1-roughness', true, 'image/png'],
      ['skp-pbr-1-metallic', true, 'image/png'],
      ['skp-pbr-4-normal', true, 'image/png'],
      ['skp-pbr-4-roughness-metallic', true, 'image/png'],
      ['skp-pbr-6-normal', true, 'image/png'],
      ['skp-pbr-6-roughness', true, 'image/png'],
    ]);
    // 견본은 색 그림의 Blob 주소로만 바뀐다(PBR 그림이 뒤에 와도 덮지 않는다)
    const a = images.materials.get('금속판')!.url;
    const c = images.materials.get('같은그림')!.url;
    const colorBlob = held.find((h) => h.id === 'skp-tex-1')!.blob;
    expect(a).not.toBe('blob:old-a');
    expect(images.urls).toEqual([a, c]);
    expect(held.find((h) => h.id === 'skp-tex-1')!.raw).toBe(true);
    expect(colorBlob.size).toBe(s.textures!.find((t) => t.id === 'skp-tex-1')!.data!.length);
    for (const u of images.urls) URL.revokeObjectURL(u);
  });
});

describe('코어에 올리기(가짜 WebGL2 — 56차 색 무늬 없는 PBR 재질)', () => {
  let dom: ReturnType<typeof installDom>;
  beforeAll(() => {
    dom = installDom();
  });
  afterAll(() => dom.restore());

  it('무늬 그림 없이 PBR 그림만 단 그물도 코어가 무늬 좌표를 GPU에 올리고, PBR 그림을 떼면(휴대 기기) 무늬 좌표도 없다', () => {
    const bytes = file();
    const img = readSkpImages(bytes);
    const s = skpToScene(bytes, { textures: img.materials, pbrTextures: img.pbr });
    const m = meshOf(s, '법선만');
    const only = (x: Scene3d): Scene3d => ({ ...x, meshes: x.meshes.filter((y) => y.name?.startsWith('법선만')), lines: [], textures: (x.textures ?? []).filter((t) => t.id.startsWith('skp-pbr-6-')) });
    const v = new Viewer3d(dom.host() as unknown as HTMLElement, { animate: false, keyboard: false, viewCube: false, grid: false });
    try {
      v.setScene(only(s));
      v.renderNow();
      expect(v.stats.buffers.uvs).toBe(m.uvs!.byteLength);
      expect(v.stats.buffers.uvs).toBeGreaterThan(0);
      dropPbrMaps(s);
      v.setScene(only(s));
      v.renderNow();
      expect(v.stats.buffers.uvs).toBe(0);
    } finally {
      v.dispose();
    }
  });
});
