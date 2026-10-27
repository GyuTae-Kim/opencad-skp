/**
 * 무늬(텍스처): material.xml 무늬 읽기, 면 무늬 투영(평면 틀·저장된 행렬·원근 q), 재질 물려받기·앞뒤 따로,
 * 장면의 무늬 좌표·무늬 그림, 한도, 색 바꾼 무늬 규칙, 워커 손질의 순수 부분.
 * 시험 파일은 쓰기 도구(skpwrite)로 무늬 재질·면 투영 바이트를 직접 만든다.
 */
import { describe, expect, it } from 'vitest';
import type { Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import { readSkpImages, skpToScene, type SkpImages, type SkpTextureInfo } from '../src/index';
import { abgrColor, parseMaterialXml } from '../src/materials';
import { readModelDat } from '../src/model';
import { applyFaceUvq, faceUvq, planeAxes } from '../src/projection';
import { averageRgb, colorizeRgba, rgbToHls } from '../src/colorize';
import { dropTexture, needsDecode, prepareSceneTextures, usesAlpha } from '../src/worker/textures';
import { textureLimitsFor } from '../src/app/texlimits';
import { IDENTITY13, edge, entities, face, instance, materialXml, modelDat, pngRgb, skpFile, type TextureMapOpts, vertex } from './build';
import { faceAt } from '../src/entities';

const TILE_A = { w: 10, h: 20 };
const TILE_B = 5;

/** 재질 번호: 1 무늬A(10×20 인치), 2 무늬B(5×5), 3 보통 색, 4 색 바꾼 무늬(type 2), 5 무늬인데 그림 없음 */
const MATS: [number, string][] = [
  [1, '무늬A'],
  [2, '무늬B'],
  [3, '색'],
  [4, '바꾼색'],
  [5, '그림없음'],
];

const png = pngRgb(2, 2, (x, y) => [x * 200, y * 200, 50]);

function xmls(): [string, string][] {
  return [
    ['무늬A', materialXml('무늬A', [120, 100, 80], 1, 0, true, { file: 'a.png', width: TILE_A.w, height: TILE_A.h, average: [120, 100, 80] })],
    ['무늬B', materialXml('무늬B', [90, 90, 90], 1, 0, true, { file: 'b.png', width: TILE_B, height: TILE_B })],
    ['색', materialXml('색', [200, 10, 10])],
    ['바꾼색', materialXml('바꾼색', [30, 60, 200], 1, 0, true, { file: 'c.png', width: 8, height: 8, average: [100, 100, 100], colorizeType: 1 })],
    ['그림없음', materialXml('그림없음', [1, 2, 3], 1, 0, true, { file: 'z.png', width: 8, height: 8 })],
  ];
}

const images = (): { name: string; data: Uint8Array }[] => [
  { name: 'materials/무늬A/a.png', data: png },
  { name: 'materials/무늬B/b.png', data: png },
  { name: 'materials/바꾼색/c.png', data: png },
];

interface FaceSpec {
  material?: number;
  back?: number;
  frontMap?: TextureMapOpts;
  backMap?: TextureMapOpts;
}

/** 정의 하나: 10 × 10 인치 정사각형 면(z = 0, 법선 +Z) */
function squareDef(defId: number, f: FaceSpec): Uint8Array {
  const b = defId * 100;
  const P: [number, number, number][] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ];
  const verts = P.map((p, i) => vertex(b + i, ...p));
  const edges = [0, 1, 2, 3].map((i) => edge(b + 10 + i, b + i, b + ((i + 1) % 4)));
  const opts: Parameters<typeof face>[3] = {};
  if (f.material !== undefined) opts.material = f.material;
  if (f.back !== undefined) opts.back = f.back;
  if (f.frontMap) opts.frontMap = f.frontMap;
  if (f.backMap) opts.backMap = f.backMap;
  return entities(defId, {
    vertices: verts,
    edges,
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
        opts,
      ),
    ],
  });
}

/** 13값 변환: 크기 s, (x, y, z)로 옮김 */
const place = (x: number, y = 0, z = 0, s = 1): number[] => [s, 0, 0, 0, s, 0, 0, 0, s, x, y, z, 1];

interface Placed {
  def: FaceSpec;
  material?: number;
  at: number;
  scale?: number;
  layer?: number;
}

function fileWith(placed: Placed[], opts: { xml?: [string, string][]; imgs?: { name: string; data: Uint8Array }[] } = {}): Uint8Array {
  const defs = placed.map((p, i) => ({ name: `판${i}`, entities: squareDef(50 + i, p.def) }));
  const comps = placed.map((p, i) => {
    const o: Parameters<typeof instance>[3] = {};
    if (p.material !== undefined) o.material = p.material;
    if (p.layer !== undefined) o.layer = p.layer;
    return instance(900 + i, 50 + i, place(p.at, 0, 0, p.scale ?? 1), o);
  });
  const model = modelDat({
    materials: MATS,
    layers: [
      [1, 'Layer0'],
      [2, '둘째'],
    ],
    definitions: defs,
    root: entities(undefined, { components: comps }),
  });
  return skpFile(model, { materials: opts.xml ?? xmls(), extra: opts.imgs ?? images() });
}

function open(bytes: Uint8Array, o: Parameters<typeof skpToScene>[1] = {}): Scene3d {
  return skpToScene(bytes, { textures: readSkpImages(bytes).materials, ...o });
}

/** 그물의 정점마다 [x, y, u, v, q](세계 좌표, origin 반영). back이면 뒷면 무늬 좌표 */
function corners(m: Mesh3d, back = false): number[][] {
  const nv = m.positions.length / 3;
  const uvs = back ? m.backUvs! : m.uvs!;
  const st = uvs.length / nv;
  const o = m.origin ?? [0, 0, 0];
  const out: number[][] = [];
  for (let i = 0; i < nv; i++) {
    const q = st === 3 ? uvs[i * 3 + 2]! : 1;
    out.push([m.positions[i * 3]! + o[0], m.positions[i * 3 + 1]! + o[1], uvs[i * st]! / q, uvs[i * st + 1]! / q, q]);
  }
  return out;
}

/** 꼭짓점 (x, y)에서의 무늬 좌표(위 corners에서 찾기) */
const uvAt = (c: number[][], x: number, y: number): [number, number] => {
  const hit = c.find((p) => Math.abs(p[0]! - x) < 1e-6 && Math.abs(p[1]! - y) < 1e-6)!;
  expect(hit).toBeDefined();
  return [hit[2]!, hit[3]!];
};

const meshOf = (s: Scene3d, mat: string): Mesh3d => s.meshes.find((m) => m.name?.startsWith(`${mat} ·`))!;

describe('material.xml 무늬', () => {
  it('무늬 크기(인치)·그림 이름·평균색, 색 바꾼 무늬(type 2)', () => {
    const a = parseMaterialXml(xmls()[0]![1])!;
    expect(a.textured).toBe(true);
    expect(a.texture).toEqual({ width: 10, height: 20, file: 'a.png', average: [120, 100, 80] });
    expect(a.colorize).toBeUndefined();
    const c = parseMaterialXml(xmls()[3]![1])!;
    expect(c.colorize).toBe('tint');
    expect(parseMaterialXml(materialXml('p', [1, 2, 3]))!.texture).toBeUndefined();
  });

  it('실제 꼴: 이름 공간·경로(./)·PBR 그림 뒤의 image는 보지 않는다', () => {
    const xml =
      '<mat:material name="이녹스" type="1" colorRed="184" colorGreen="184" colorBlue="184" colorizeType="0" hasTexture="1">' +
      '<mat:texture textureFilename="C:\\Users\\x\\inox.png" xScale="23.622047244094489" yScale="13.267716535433072" avgColor="4290295992">' +
      '<mat:images><mat:image id="1" path="./inox.png" file_name="inox.png"/></mat:images></mat:texture>' +
      '<mat:pbrMR><mat:normal_texture><mat:image path="./n.png"/></mat:normal_texture></mat:pbrMR></mat:material>';
    const m = parseMaterialXml(xml)!;
    expect(m.texture!.file).toBe('inox.png');
    expect(m.texture!.width).toBeCloseTo(600 / 25.4, 9);
    expect(m.texture!.average).toEqual([184, 184, 184]);
    // hasTexture="0"이면 texture 꼬리표가 남아 있어도 무늬 없음
    expect(parseMaterialXml(xml.replace('hasTexture="1"', 'hasTexture="0"'))!.texture).toBeUndefined();
  });

  it('avgColor: ABGR(부호 있는 정수도)', () => {
    expect(abgrColor('4291544512')).toEqual([192, 197, 203]);
    expect(abgrColor(String(4291544512 - 2 ** 32))).toEqual([192, 197, 203]);
    expect(abgrColor('x')).toBeUndefined();
  });

  it('readSkpImages: 재질 폴더에 그림이 여럿이면 material.xml이 가리키는 그림', () => {
    const bytes = fileWith([{ def: { material: 1 }, at: 0 }], {
      imgs: [
        { name: 'materials/무늬A/aaa_normal.png', data: pngRgb(1, 1, () => [0, 0, 255]) },
        { name: 'materials/무늬A/a.png', data: png },
      ],
    });
    const m = readSkpImages(bytes).materials.find((x) => x.folder === '무늬A')!;
    expect(m.path).toBe('materials/무늬A/a.png');
  });
});

describe('면 평면 틀·투영', () => {
  it('평면 틀: 수평은 x = X, y = Y, 벽은 v가 위로, 거의 수평의 기준은 1e-3', () => {
    const [x, y] = planeAxes([0, 0, 1]);
    expect(x).toEqual([1, 0, 0]);
    expect(y).toEqual([0, 1, 0]);
    const [wx, wy] = planeAxes([0, -1, 0]);
    expect(wx).toEqual([1, 0, 0]);
    expect(wy[2]).toBeCloseTo(1, 12);
    // 8.5e-4 기운 법선은 Y 기준(x ≈ (1, 0, ·)), 1.1e-3 기운 법선은 Z 기준(x는 기운 방향에 수직)
    const nearY = planeAxes([8.5e-4, 0, 1])[0];
    expect(nearY[0]).toBeCloseTo(1, 5);
    const nearZ = planeAxes([1.1e-3, 0, 1])[0];
    expect(Math.abs(nearZ[1])).toBeCloseTo(1, 5);
  });

  it('단위 행렬 투영은 기본 투영과 같고, 뒤집을 수 없는 행렬은 기본 투영 + singular', () => {
    const clean = (m: ArrayLike<number>): number[] => Array.from(m, (v) => v + 0);
    const d = faceUvq([0, 0, 1], undefined, 10, 20);
    const i = faceUvq([0, 0, 1], { kind: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, 10, 20);
    expect(clean(i.m)).toEqual(clean(d.m));
    expect(clean(d.m)).toEqual([0.1, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0, 1]);
    const z = faceUvq([0, 0, 1], { kind: 1, matrix: new Array(9).fill(0) }, 10, 20);
    expect(z.singular).toBe(true);
    expect(clean(z.m)).toEqual(clean(d.m));
  });

  it('면마다 정수 부분을 빼도 정점 사이 차이는 그대로', () => {
    const m = faceUvq([0, 0, 1], undefined, 1, 1).m;
    const out: number[] = [];
    applyFaceUvq(m, [1000.25, 7, 0, 1001.75, 9.5, 0], 0, 2, out);
    expect(out).toEqual([0.25, 0, 1, 1.75, 2.5, 1]);
  });

  it('원근 투영: q가 바뀌면 (U, V, Q)를 가장 큰 |Q|로 나눠 두고, 부호가 바뀌면 원근 없이(flat)', () => {
    const m = faceUvq([0, 0, 1], { kind: 1, matrix: [1, 0, 0.05, 0, 1, 0, 0, 0, 1] }, 10, 10).m;
    const out: number[] = [];
    expect(applyFaceUvq(m, [0, 0, 0, 10, 0, 0], 0, 2, out).flat).toBe(false);
    // x = 10: Q = 1 − 0.05·10 = 0.5, u = 10 / 0.5 / 10 = 2
    expect(out[2]).toBeCloseTo(1, 12);
    expect(out[5]).toBeCloseTo(0.5, 12);
    expect(out[3]! / out[5]!).toBeCloseTo(2, 12);
    const bad = faceUvq([0, 0, 1], { kind: 1, matrix: [1, 0, 0.2, 0, 1, 0, 0, 0, 1] }, 10, 10).m;
    const o2: number[] = [];
    expect(applyFaceUvq(bad, [0, 0, 0, 10, 0, 0], 0, 2, o2).flat).toBe(true);
    expect(o2[2]).toBe(1);
    expect(o2[5]).toBe(1);
  });
});

describe('면 무늬 투영 읽기(model.dat)', () => {
  const MAP: TextureMapOpts = { kind: 3, matrix: [0.5, 0, 0, 0, 0.5, 0, 1, 2, 1], dir: [0, -1, 0] };

  it('무늬 재질 쪽만 앞·뒤 투영을 읽는다', () => {
    const model = modelDat({
      materials: MATS,
      root: entities(undefined, { components: [instance(900, 50, IDENTITY13)] }),
      definitions: [{ name: '판', entities: squareDef(50, { material: 1, back: 3, frontMap: MAP, backMap: MAP }) }],
    });
    const f = faceAt(readModelDat(model, undefined, { textured: ['무늬A'] }).definitions.get(50)!.entities.faces, 0);
    expect(f.frontMap!.kind).toBe(3);
    expect([...f.frontMap!.matrix]).toEqual(MAP.matrix);
    expect(f.frontMap!.dir).toEqual([0, -1, 0]);
    // 뒤 재질(색)은 무늬 재질이 아니라 읽지 않는다
    expect(f.backMap).toBeUndefined();
    // textured를 주지 않으면 읽지 않는다(예전과 같은 모형)
    expect(faceAt(readModelDat(model).definitions.get(50)!.entities.faces, 0).frontMap).toBeUndefined();
  });
});

describe('장면의 무늬 좌표', () => {
  it('그림을 넘기지 않으면 예전처럼 무늬 없이(무늬 좌표·textures 없음)', () => {
    const bytes = fileWith([{ def: { material: 1 }, at: 0 }]);
    const s = skpToScene(bytes);
    expect(s.textures).toBeUndefined();
    expect(s.meshes.every((m) => !m.uvs && !m.texture)).toBe(true);
  });

  it('자기 재질 기본 투영: u = x / 가로, v = y / 세로, 그림 바이트는 복사하지 않는다', () => {
    const bytes = fileWith([{ def: { material: 1 }, at: 0 }]);
    const imgs = readSkpImages(bytes);
    const s = skpToScene(bytes, { textures: imgs.materials });
    const m = meshOf(s, '무늬A');
    expect(m.texture).toBe('skp-tex-1');
    const c = corners(m);
    expect(uvAt(c, 10, 10)[0] - uvAt(c, 0, 0)[0]).toBeCloseTo(1, 6);
    expect(uvAt(c, 10, 10)[1] - uvAt(c, 0, 0)[1]).toBeCloseTo(0.5, 6);
    expect(s.textures!.length).toBe(1);
    expect(s.textures![0]!.data).toBe(imgs.materials.find((x) => x.folder === '무늬A')!.bytes);
    expect(s.textures![0]).toMatchObject({ mime: 'image/png', width: 2, height: 2 });
    const info = (s.meta!.textures as SkpTextureInfo[])[0]!;
    expect(info).toMatchObject({ id: 'skp-tex-1', material: '무늬A', folder: '무늬A', tile: [10, 20], alphaPossible: false });
    expect((s.meta!.materialStats as { name: string; texture?: string }[]).find((x) => x.name === '무늬A')!.texture).toBe('skp-tex-1');
  });

  it('저장된 투영(90° 돌림)을 따른다', () => {
    // 무늬 (s, t) → 평면 (x, y) = (−t, s): u = y / 10, v = −x / 20
    const rot: TextureMapOpts = { kind: 1, matrix: [0, 1, 0, -1, 0, 0, 0, 0, 1] };
    const s = open(fileWith([{ def: { material: 1, frontMap: rot }, at: 0 }]));
    const c = corners(meshOf(s, '무늬A'));
    const [u0, v0] = uvAt(c, 0, 0);
    const [u1, v1] = uvAt(c, 10, 0);
    const [u2, v2] = uvAt(c, 0, 10);
    expect(u1 - u0).toBeCloseTo(0, 6);
    expect(v1 - v0).toBeCloseTo(-0.5, 6);
    expect(u2 - u0).toBeCloseTo(1, 6);
    expect(v2 - v0).toBeCloseTo(0, 6);
  });

  it('방향 투영(종류 3)은 저장된 방향으로 평면 틀을 잡는다', () => {
    const along: TextureMapOpts = { kind: 3, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], dir: [0, -1, 0] };
    const s = open(fileWith([{ def: { material: 1, frontMap: along }, at: 0 }]));
    const c = corners(meshOf(s, '무늬A'));
    // 방향 (0, −1, 0)의 틀: x = X, y = Z → 바닥 면 위에서는 v가 늘 같다
    expect(uvAt(c, 10, 0)[0] - uvAt(c, 0, 0)[0]).toBeCloseTo(1, 6);
    for (const p of c) expect(p[3]).toBeCloseTo(c[0]![3]!, 9);
  });

  it('인스턴스 재질을 물려받으면 기본 투영 ÷ 물려받은 재질의 무늬 크기(늘린 인스턴스는 무늬도 늘어난다)', () => {
    const s = open(
      fileWith([
        { def: {}, material: 2, at: 0, scale: 2 },
        { def: {}, material: 3, at: 100 },
      ]),
    );
    const m = meshOf(s, '무늬B');
    expect(m.texture).toBe('skp-tex-2');
    const c = corners(m);
    // 정의 좌표 10인치 = 무늬 두 장(5인치), 세계로는 20인치
    expect(uvAt(c, 20, 20)[0] - uvAt(c, 0, 0)[0]).toBeCloseTo(2, 6);
    expect(uvAt(c, 20, 20)[1] - uvAt(c, 0, 0)[1]).toBeCloseTo(2, 6);
    // 보통 색 재질은 무늬 없음
    expect(meshOf(s, '색').uvs).toBeUndefined();
    expect(meshOf(s, '색').texture).toBeUndefined();
  });

  it('앞·뒤 따로: 앞면은 앞 재질 → 물려받기 → 기본색, 뒷면은 뒤 재질과 뒤 투영(backTexture·backUvs)', () => {
    const backMap: TextureMapOpts = { kind: 1, matrix: [2, 0, 0, 0, 2, 0, 0, 0, 1] };
    const s = open(
      fileWith([
        // 뒤 재질 무늬B(뒤 투영: 무늬 두 배 크기)만 있는 면 — 앞면은 기본색, 뒷면은 무늬B
        { def: { back: 2, backMap }, at: 0 },
        // 같은 면을 무늬A 인스턴스로 칠하면 앞면은 물려받은 무늬A(기본 투영), 뒷면은 그대로 자기 뒤 재질 무늬B
        { def: { back: 2, backMap }, material: 1, at: 100 },
      ]),
    );
    const plain = meshOf(s, '기본 재질');
    expect(plain.texture).toBeUndefined();
    expect(plain.backTexture).toBe('skp-tex-2');
    const b = corners(plain, true);
    // 뒤 투영: 평면 10인치 = 무늬 5인치 = 한 장
    expect(uvAt(b, 10, 10)[0] - uvAt(b, 0, 0)[0]).toBeCloseTo(1, 6);
    const am = meshOf(s, '무늬A');
    expect(am.backTexture).toBe('skp-tex-2');
    const a = corners(am);
    expect(uvAt(a, 110, 10)[0] - uvAt(a, 100, 0)[0]).toBeCloseTo(1, 6);
    expect(uvAt(a, 110, 10)[1] - uvAt(a, 100, 0)[1]).toBeCloseTo(0.5, 6);
    expect(uvAt(corners(am, true), 110, 10)[0] - uvAt(corners(am, true), 100, 0)[0]).toBeCloseTo(1, 6);
    // 쓰인 무늬(뒷면만 쓰는 무늬B도)를 장면에 넣는다
    expect(s.textures!.map((t) => t.id).sort()).toEqual(['skp-tex-1', 'skp-tex-2']);
  });

  it('원근 무늬가 섞인 그물은 3값(u·q, v·q, q), 나머지 면은 q = 1', () => {
    const persp: TextureMapOpts = { kind: 1, matrix: [1, 0, 0.05, 0, 1, 0, 0, 0, 1] };
    const s = open(
      fileWith([
        { def: { material: 1 }, at: 0 },
        { def: { material: 1, frontMap: persp }, at: 100 },
      ]),
    );
    const m = meshOf(s, '무늬A');
    expect(m.uvs!.length).toBe((m.positions.length / 3) * 3);
    const c = corners(m);
    expect(c.filter((p) => p[0]! < 50).every((p) => p[4] === 1)).toBe(true);
    // 원근 면: x = 10(정의 좌표)에서 Q는 0.5 — 나눈 u는 2(가로 10인치)
    const far = c.filter((p) => p[0]! > 105);
    expect(far.every((p) => Math.abs(p[4]! - 0.5) < 1e-6)).toBe(true);
    expect(uvAt(c, 110, 0)[0] - uvAt(c, 100, 0)[0]).toBeCloseTo(2, 5);
  });

  it('원근이 뒤집히는 투영·뒤집을 수 없는 행렬은 경고와 함께 원근 없이·기본 투영으로', () => {
    const s = open(
      fileWith([
        { def: { material: 1, frontMap: { kind: 1, matrix: [1, 0, 0.2, 0, 1, 0, 0, 0, 1] } }, at: 0 },
        { def: { material: 1, frontMap: { kind: 1, matrix: new Array(9).fill(0) } }, at: 100 },
      ]),
    );
    expect(s.warnings!.some((w) => w.includes('원근 없이'))).toBe(true);
    expect(s.warnings!.some((w) => w.includes('뒤집을 수 없는'))).toBe(true);
    expect(meshOf(s, '무늬A').uvs!.length).toBe((meshOf(s, '무늬A').positions.length / 3) * 2);
  });

  it('그림이 없는 무늬 재질은 평균색, 색 바꾼 무늬는 meta에 바꾸는 방식', () => {
    const s = open(
      fileWith([
        { def: { material: 5 }, at: 0 },
        { def: { material: 4 }, at: 100 },
      ]),
    );
    expect(meshOf(s, '그림없음').uvs).toBeUndefined();
    const info = (s.meta!.textures as SkpTextureInfo[]).find((t) => t.material === '바꾼색')!;
    expect(info.colorize).toEqual({ type: 'tint', color: [30, 60, 200], average: [100, 100, 100] });
  });

  it('한도: 무늬 재질 수, 무늬 좌표 정점 수', () => {
    const bytes = fileWith([
      { def: { material: 1 }, at: 0 },
      { def: { material: 2 }, at: 100 },
    ]);
    const one = open(bytes, { maxTextures: 1 });
    expect(one.textures!.length).toBe(1);
    expect(one.warnings!.some((w) => w.includes('무늬 재질이 너무 많아'))).toBe(true);
    const few = open(bytes, { maxUvVertices: 4 });
    expect(few.meshes.filter((m) => m.uvs).length).toBe(1);
    expect(few.textures!.length).toBe(1);
    expect(few.warnings!.some((w) => w.includes('정점'))).toBe(true);
  });
});

describe('색 바꾼 무늬(HLS)', () => {
  it('평균 화소는 재질 색이 된다(shift), tint는 색상을 재질 색으로', () => {
    const px = new Uint8ClampedArray([200, 100, 50, 255, 100, 50, 25, 255]);
    const avg = averageRgb(px);
    const shifted = colorizeRgba(new Uint8ClampedArray([avg[0], avg[1], avg[2], 255]), { type: 'shift', color: [30, 120, 200], average: avg });
    expect(Math.abs(shifted[0]! - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(shifted[1]! - 120)).toBeLessThanOrEqual(1);
    expect(Math.abs(shifted[2]! - 200)).toBeLessThanOrEqual(1);
    const tinted = colorizeRgba(px.slice(), { type: 'tint', color: [30, 120, 200] });
    expect(rgbToHls(tinted[0]!, tinted[1]!, tinted[2]!)[0]).toBeCloseTo(rgbToHls(30, 120, 200)[0], 0);
    expect(tinted[3]).toBe(255);
  });

  it('회색 재질 색이면 회색 화소, 투명 화소는 평균에서 뺀다', () => {
    const g = colorizeRgba(new Uint8ClampedArray([200, 100, 50, 255]), { type: 'shift', color: [128, 128, 128] });
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    expect(averageRgb([255, 0, 0, 255, 0, 255, 0, 0])).toEqual([255, 0, 0]);
  });
});

describe('워커 무늬 손질(순수 부분)', () => {
  const sceneWith = (): Scene3d =>
    open(
      fileWith([
        { def: { material: 1 }, at: 0 },
        { def: { material: 4 }, at: 100 },
      ]),
    );

  it('dropTexture: 그물의 무늬 좌표·id, meta, 재질 통계에서 뺀다', () => {
    const s = sceneWith();
    const id = (s.meta!.textures as SkpTextureInfo[]).find((t) => t.colorize)!.id;
    dropTexture(s, id);
    expect(s.textures!.some((t) => t.id === id)).toBe(false);
    expect(s.meshes.some((m) => m.texture === id || (m.name?.startsWith('바꾼색') && m.uvs))).toBe(false);
    expect((s.meta!.textures as SkpTextureInfo[]).some((t) => t.id === id)).toBe(false);
    dropTexture(s, 'skp-tex-1');
    expect(s.textures).toBeUndefined();
    expect(s.meta!.textures).toBeUndefined();
  });

  it('dropTexture: 뒷면 무늬도 뺀다(뒷면은 재질 색으로)', () => {
    const backMap: TextureMapOpts = { kind: 1, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const s = open(fileWith([{ def: { back: 2, backMap }, at: 0 }]));
    const m = s.meshes.find((x) => x.backTexture)!;
    expect(m.backUvs).toBeDefined();
    dropTexture(s, m.backTexture!);
    expect(m.backTexture).toBeUndefined();
    expect(m.backUvs).toBeUndefined();
    expect(m.backColor).toBeDefined();
  });

  it('풀 무늬 고르기·투명 화소 재기', () => {
    const base: SkpTextureInfo = { id: 'a', material: 'm', folder: 'm', path: 'p', tile: [1, 1], alphaPossible: false };
    expect(needsDecode(base)).toBe(false);
    expect(needsDecode({ ...base, alphaPossible: true })).toBe(true);
    expect(needsDecode({ ...base, colorize: { type: 'shift', color: [1, 2, 3] } })).toBe(true);
    expect(usesAlpha([1, 2, 3, 255, 4, 5, 6, 255])).toBe(false);
    expect(usesAlpha([1, 2, 3, 255, 4, 5, 6, 10])).toBe(true);
  });

  it('그림을 풀 수 없는 곳(Node)에서는 색 바꾼 무늬를 평균색으로 돌린다', async () => {
    const s = sceneWith();
    const r = await prepareSceneTextures(s, 1024);
    expect(r.dropped).toBe(1);
    expect(s.textures!.map((t) => t.id)).toEqual(['skp-tex-1']);
    expect(s.warnings!.some((w) => w.includes('평균색'))).toBe(true);
  });
});

describe('기기별 무늬 한도', () => {
  it('메모리가 적거나 손가락·좁은 화면이면 줄인다', () => {
    expect(textureLimitsFor({})).toEqual({ limit: 2048, budget: 256 * 1024 * 1024 });
    expect(textureLimitsFor({ deviceMemory: 8, coarse: true, narrow: false }).limit).toBe(2048);
    expect(textureLimitsFor({ coarse: true, narrow: true }).limit).toBe(1024);
    expect(textureLimitsFor({ deviceMemory: 4 }).limit).toBe(1024);
    expect(textureLimitsFor({ deviceMemory: 2 })).toEqual({ limit: 512, budget: 48 * 1024 * 1024 });
  });
});

describe('예제 모형의 무늬', () => {
  it('잔디(기본 투영)·마루(돌린 저장된 투영)·기와(지붕 그룹에서 물려받기)', async () => {
    const { sampleSkpBytes } = await import('../src/app/sample');
    const bytes = sampleSkpBytes();
    const imgs: SkpImages = readSkpImages(bytes);
    const s = skpToScene(bytes, { textures: imgs.materials, outline: true });
    expect(s.warnings).toEqual([]);
    const tex = new Map((s.meta!.textures as SkpTextureInfo[]).map((t) => [t.material, t.id]));
    expect([...tex.keys()].sort()).toEqual(['기와', '마루', '잔디']);
    for (const name of ['잔디', '마루', '기와']) {
      const ms = s.meshes.filter((m) => m.texture === tex.get(name));
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) expect(m.uvs!.length).toBe((m.positions.length / 3) * 2);
    }
    // 마루(6 m × 4 m, 무늬 800 mm를 90° 돌림): u는 y 방향 4000/800 = 5장, v는 x 방향 7.5장
    // 부드러운 음영(smooth) 꼭짓점 법선과 무늬 좌표는 같은 정점 차례로 쌓인다
    const sm = skpToScene(bytes, { textures: imgs.materials, outline: true, smooth: true });
    for (const m of sm.meshes.filter((x) => x.texture)) {
      const nv = m.positions.length / 3;
      expect(m.uvs!.length).toBe(nv * 2);
      if (m.normals) expect(m.normals.length).toBe(nv * 3);
    }
    expect(sm.meshes.filter((x) => x.texture).map((x) => [...x.uvs!])).toEqual(s.meshes.filter((x) => x.texture).map((x) => [...x.uvs!]));
    const floor = s.meshes.find((m) => m.texture === tex.get('마루'))!;
    const c = corners(floor);
    const us = c.map((p) => p[2]!), vs = c.map((p) => p[3]!);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(5, 4);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(7.5, 4);
  });
});
