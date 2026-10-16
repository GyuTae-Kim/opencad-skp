/**
 * 예제 SketchUp 파일: 저장소에 표본 파일을 두지 않으려고(저작권) 브라우저에서 직접 만든다.
 * 집(벽·바닥·문·유리창) + 박공지붕 + 탁자·의자 4개(같은 컴포넌트를 돌려 놓기) + 나무 3그루(크기를 바꿔 놓기)를
 * 태그 넷(벽·지붕·가구·조경)과 재질 색으로 만든다. 길이는 mm로 짓고, SketchUp처럼 인치로 바꿔 적는다(단위 설정 mm).
 *
 * model.dat는 브라우저의 CompressionStream('deflate-raw')로 압축한다(없으면 저장 방식) — 실제 파일처럼 해석기의 풀기 경로를 탄다.
 */

import {
  edge as edgeBytes,
  entities,
  face as faceBytes,
  instance,
  materialXml,
  modelDat,
  skpFile,
  vertex as vertexBytes,
  type Compressor,
} from './skpwrite';

export const SAMPLE_NAME = 'OpenCAD 예제 집.skp';
/** 예제 파일 머리에 적는 판 */
export const SAMPLE_VERSION = '26.1.194';

type V3 = [number, number, number];

const MM = 1 / 25.4;
/** 깃발: 보통 6, 부드러운·매끈한 모서리 0x1e(SketchUp 화면에서 숨는 곡면 모서리) */
const FLAG_SOFT = 0x1e;

/** 태그 번호 */
const TAG = { untagged: 1, walls: 2, roof: 3, furniture: 4, landscape: 5 } as const;
const LAYERS: [number, string][] = [
  [TAG.untagged, 'Layer0'],
  [TAG.walls, '벽'],
  [TAG.roof, '지붕'],
  [TAG.furniture, '가구'],
  [TAG.landscape, '조경'],
];

/** 재질 [번호, 이름, rgb, 불투명도] */
const MATERIALS: [number, string, [number, number, number], number?][] = [
  [1, '잔디', [118, 164, 84]],
  [2, '벽 흰색', [236, 231, 220]],
  [3, '기와', [158, 72, 56]],
  [4, '유리', [150, 200, 232], 0.35],
  [5, '문 나무', [122, 82, 52]],
  [6, '마루', [196, 156, 106]],
  [7, '원목', [176, 126, 76]],
  [8, '줄기', [104, 74, 48]],
  [9, '잎', [72, 142, 74]],
  [10, '파란 천', [64, 104, 172]],
  [11, '돌', [158, 156, 150]],
];
const MAT = Object.fromEntries(MATERIALS.map(([id, name]) => [name, id])) as Record<string, number>;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 고리 법선(Newell, 정규화) */
export function loopNormal(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function centroid(pts: readonly V3[]): V3 {
  const c: V3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0] / pts.length;
    c[1] += p[1] / pts.length;
    c[2] += p[2] / pts.length;
  }
  return c;
}

/** 번호 나눠 주기(파일 안에서 하나뿐이게) */
class Ids {
  private n = 100;
  next(): number {
    return ++this.n;
  }
}

interface FaceOpt {
  material?: number;
  back?: number;
  layer?: number;
}

/** 요소 묶음(정점·모서리·면·인스턴스) 짓기. 좌표는 mm */
class Ents {
  private vIds = new Map<string, number>();
  private vBytes: Uint8Array[] = [];
  private edges = new Map<string, { id: number; a: number; b: number; flags: number }>();
  private faces: Uint8Array[] = [];
  private groups: Uint8Array[] = [];
  private comps: Uint8Array[] = [];

  constructor(private readonly ids: Ids) {}

  private v(p: V3): number {
    const key = p.map((x) => Math.round(x * 1000) / 1000).join(',');
    let id = this.vIds.get(key);
    if (id === undefined) {
      id = this.ids.next();
      this.vIds.set(key, id);
      this.vBytes.push(vertexBytes(id, p[0] * MM, p[1] * MM, p[2] * MM));
    }
    return id;
  }

  /** 두 정점 사이 모서리(같은 모서리는 한 번만). [번호, 뒤집힘] */
  private e(a: number, b: number): [number, boolean] {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let ed = this.edges.get(key);
    if (!ed) this.edges.set(key, (ed = { id: this.ids.next(), a, b, flags: 6 }));
    return [ed.id, ed.a !== a];
  }

  /** 모서리를 부드럽게(곡면처럼 숨김) */
  soften(p: V3, q: V3): void {
    const a = this.v(p);
    const b = this.v(q);
    const ed = this.edges.get(a < b ? `${a}-${b}` : `${b}-${a}`);
    if (ed) ed.flags = FLAG_SOFT;
  }

  /**
   * 면 하나. outer는 바깥 고리, holes는 구멍 고리들. want를 주면 법선이 그쪽을 보게 고리 차례를 맞춘다.
   * 구멍은 바깥과 반대로 돈다(SketchUp처럼).
   */
  face(outer: V3[], o: FaceOpt & { holes?: V3[][]; want?: V3 } = {}): void {
    let ring = outer;
    let n = loopNormal(ring);
    if (o.want && dot(n, o.want) < 0) {
      ring = [...ring].reverse();
      n = [-n[0], -n[1], -n[2]];
    }
    const loops = [ring, ...(o.holes ?? []).map((h) => (dot(loopNormal(h), n) > 0 ? [...h].reverse() : h))];
    const uses = loops.map((l) => {
      const vs = l.map((p) => this.v(p));
      return vs.map((a, i) => this.e(a, vs[(i + 1) % vs.length]!));
    });
    const d = -dot(n, ring[0]!) * MM;
    const fo: FaceOpt = {};
    if (o.material !== undefined) fo.material = o.material;
    if (o.back !== undefined) fo.back = o.back;
    if (o.layer !== undefined) fo.layer = o.layer;
    this.faces.push(faceBytes(this.ids.next(), [n[0], n[1], n[2], d], uses, fo));
  }

  /**
   * 바닥 고리를 dir만큼 밀어 올린 각기둥. skip: 'bottom'·'top'을 빼고 싶을 때(겹치는 면이 깜빡이지 않게).
   * softSides면 옆 세로 모서리를 부드럽게.
   */
  prism(loop: V3[], dir: V3, o: { material?: number; skip?: ('bottom' | 'top')[]; softSides?: boolean } = {}): void {
    const top = loop.map((p) => add(p, dir));
    const c = centroid(loop);
    const mat: FaceOpt = o.material !== undefined ? { material: o.material } : {};
    if (!o.skip?.includes('bottom')) this.face(loop, { ...mat, want: [-dir[0], -dir[1], -dir[2]] });
    if (!o.skip?.includes('top')) this.face(top, { ...mat, want: dir });
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const mid = centroid([a, b]);
      this.face([a, b, add(b, dir), add(a, dir)], { ...mat, want: sub(mid, c) });
    }
    if (o.softSides) for (const p of loop) this.soften(p, add(p, dir));
  }

  /** 축에 나란한 상자 */
  box(min: V3, max: V3, o: { material?: number; skip?: ('bottom' | 'top')[] } = {}): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    this.prism(
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, z1 - z0],
      o,
    );
  }

  group(def: number, m13: number[], o: { name?: string; layer?: number; material?: number } = {}): void {
    this.groups.push(instance(this.ids.next(), def, m13, o));
  }

  component(def: number, m13: number[], o: { name?: string; layer?: number; material?: number } = {}): void {
    this.comps.push(instance(this.ids.next(), def, m13, o));
  }

  bytes(id: number | undefined): Uint8Array {
    const edges = [...this.edges.values()].map((e) => edgeBytes(e.id, e.a, e.b, { flags: e.flags }));
    const o: Parameters<typeof entities>[1] = { vertices: this.vBytes, edges, faces: this.faces };
    if (this.groups.length) o.groups = this.groups;
    if (this.comps.length) o.components = this.comps;
    return entities(id, o);
  }
}

/** z축 둘레 deg도 돌리고 s배 키운 뒤 (x, y, z) mm로 옮기는 13값 변환 */
export function placement(x: number, y: number, z: number, deg = 0, s = 1): number[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12;
  const sn = Math.round(Math.sin(r) * 1e12) / 1e12;
  return [c * s, -sn * s, 0, sn * s, c * s, 0, 0, 0, s, x * MM, y * MM, z * MM, 1];
}

/** 정의 묶음: 이름과 요소 */
interface Def {
  id: number;
  name: string;
  ents: Ents;
}

function house(ids: Ids): Def {
  const e = new Ents(ids);
  const W = 6000;
  const D = 4000;
  const H = 2800;
  const wall = { material: MAT['벽 흰색']! };
  const glass = { material: MAT['유리']! };
  // 바닥(문 자리에 꼭짓점을 두어 벽·문과 모서리를 나눈다)
  e.face(
    [
      [0, 0, 0],
      [2500, 0, 0],
      [3500, 0, 0],
      [W, 0, 0],
      [W, D, 0],
      [0, D, 0],
    ],
    { material: MAT['마루']!, want: [0, 0, 1] },
  );
  // 앞벽: 문은 바깥 고리의 홈, 창 둘은 구멍
  const win = (x0: number, x1: number, y: number): V3[] => [
    [x0, y, 900],
    [x1, y, 900],
    [x1, y, 1900],
    [x0, y, 1900],
  ];
  const frontWins = [win(700, 1900, 0), win(4100, 5300, 0)];
  e.face(
    [
      [0, 0, 0],
      [2500, 0, 0],
      [2500, 0, 2100],
      [3500, 0, 2100],
      [3500, 0, 0],
      [W, 0, 0],
      [W, 0, H],
      [0, 0, H],
    ],
    { ...wall, holes: frontWins, want: [0, -1, 0] },
  );
  e.face(
    [
      [2500, 0, 0],
      [3500, 0, 0],
      [3500, 0, 2100],
      [2500, 0, 2100],
    ],
    { material: MAT['문 나무']!, want: [0, -1, 0] },
  );
  for (const w of frontWins) e.face(w, { ...glass, want: [0, -1, 0] });
  // 뒷벽
  const backWin = win(2400, 3600, D);
  e.face(
    [
      [0, D, 0],
      [W, D, 0],
      [W, D, H],
      [0, D, H],
    ],
    { ...wall, holes: [backWin], want: [0, 1, 0] },
  );
  e.face(backWin, { ...glass, want: [0, 1, 0] });
  // 옆벽
  for (const [x, nx] of [
    [0, -1],
    [W, 1],
  ] as const) {
    const sw: V3[] = [
      [x, 1400, 900],
      [x, 2600, 900],
      [x, 2600, 1900],
      [x, 1400, 1900],
    ];
    e.face(
      [
        [x, 0, 0],
        [x, D, 0],
        [x, D, H],
        [x, 0, H],
      ],
      { ...wall, holes: [sw], want: [nx, 0, 0] },
    );
    e.face(sw, { ...glass, want: [nx, 0, 0] });
  }
  return { id: ids.next(), name: '집 벽체', ents: e };
}

function roof(ids: Ids): Def {
  const e = new Ents(ids);
  const W = 6000;
  const D = 4000;
  const H = 2800;
  const ridge = 4300;
  const over = 300;
  const slope = (ridge - H) / (D / 2);
  const eaveZ = H - over * slope;
  const t = 120;
  // 앞·뒤 지붕판(두께 t, 판에 수직으로 밀어 올림)
  for (const side of [-1, 1] as const) {
    const yEave = side < 0 ? -over : D + over;
    const loop: V3[] = [
      [-over, yEave, eaveZ],
      [W + over, yEave, eaveZ],
      [W + over, D / 2, ridge],
      [-over, D / 2, ridge],
    ];
    let n = loopNormal(loop);
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    e.prism(loop, [n[0] * t, n[1] * t, n[2] * t], { material: MAT['기와']! });
  }
  // 박공(벽과 같은 재질)
  for (const [x, nx] of [
    [0, -1],
    [W, 1],
  ] as const)
    e.face(
      [
        [x, 0, H],
        [x, D, H],
        [x, D / 2, ridge],
      ],
      { material: MAT['벽 흰색']!, want: [nx, 0, 0] },
    );
  return { id: ids.next(), name: '박공지붕', ents: e };
}

/** 의자: 원점이 가운데, 등받이는 +y 쪽(앉은 사람은 -y를 본다). 재질은 인스턴스에서 물려받는다 */
function chair(ids: Ids): Def {
  const e = new Ents(ids);
  const s = 225;
  e.box([-s, -s, 430], [s, s, 470]);
  for (const [x, y] of [
    [-s, -s],
    [s - 40, -s],
    [-s, s - 40],
    [s - 40, s - 40],
  ] as const)
    e.box([x, y, 0], [x + 40, y + 40, 430], { skip: ['top'] });
  e.box([-s, s - 40, 470], [s, s, 920], { skip: ['bottom'] });
  return { id: ids.next(), name: '의자', ents: e };
}

function table(ids: Ids): Def {
  const e = new Ents(ids);
  e.box([-600, -400, 720], [600, 400, 760]);
  for (const [x, y] of [
    [-560, -360],
    [510, -360],
    [-560, 310],
    [510, 310],
  ] as const)
    e.box([x, y, 0], [x + 50, y + 50, 720], { skip: ['top'] });
  return { id: ids.next(), name: '탁자', ents: e };
}

/** 나무: 육각 줄기 + 여덟 모 수관(곡면처럼 모서리를 부드럽게) */
function tree(ids: Ids): Def {
  const e = new Ents(ids);
  const ring = (r: number, z: number, k = 8, phase = 0): V3[] =>
    Array.from({ length: k }, (_, i) => {
      const a = phase + (i / k) * Math.PI * 2;
      return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)), z] as V3;
    });
  e.prism(ring(120, 0, 6), [0, 0, 1300], { material: MAT['줄기']!, skip: ['top'], softSides: true });
  const leaf = { material: MAT['잎']! };
  const rings = [ring(700, 1700, 8, Math.PI / 8), ring(950, 2450, 8, Math.PI / 8), ring(620, 3150, 8, Math.PI / 8)];
  const bottom: V3 = [0, 0, 1250];
  const top: V3 = [0, 0, 3650];
  const center: V3 = [0, 0, 2450];
  const k = 8;
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    const tri1: V3[] = [bottom, rings[0]![j]!, rings[0]![i]!];
    e.face(tri1, { ...leaf, want: sub(centroid(tri1), center) });
    for (let r = 0; r < rings.length - 1; r++) {
      const q: V3[] = [rings[r]![i]!, rings[r]![j]!, rings[r + 1]![j]!, rings[r + 1]![i]!];
      e.face(q, { ...leaf, want: sub(centroid(q), center) });
    }
    const tri2: V3[] = [rings[2]![i]!, rings[2]![j]!, top];
    e.face(tri2, { ...leaf, want: sub(centroid(tri2), center) });
  }
  // 수관의 모서리는 모두 부드럽게(곡면처럼 선이 안 보이게)
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    e.soften(bottom, rings[0]![i]!);
    e.soften(top, rings[2]![i]!);
    for (let r = 0; r < rings.length; r++) e.soften(rings[r]![i]!, rings[r]![j]!);
    for (let r = 0; r < rings.length - 1; r++) e.soften(rings[r]![i]!, rings[r + 1]![i]!);
  }
  return { id: ids.next(), name: '나무', ents: e };
}

/** 예제 model.dat 바이트 */
export function sampleModelDat(): Uint8Array {
  const ids = new Ids();
  const defs = [house(ids), roof(ids), table(ids), chair(ids), tree(ids)];
  const [houseDef, roofDef, tableDef, chairDef, treeDef] = defs as [Def, Def, Def, Def, Def];

  const root = new Ents(ids);
  // 잔디 마당(집 자리는 구멍) + 문 앞 돌길
  root.face(
    [
      [-3500, -3500, 0],
      [11000, -3500, 0],
      [11000, 7500, 0],
      [-3500, 7500, 0],
    ],
    {
      material: MAT['잔디']!,
      want: [0, 0, 1],
      holes: [
        [
          [0, 0, 0],
          [6000, 0, 0],
          [6000, 4000, 0],
          [0, 4000, 0],
        ],
      ],
    },
  );
  root.box([2500, -3500, 0], [3500, 0, 30], { material: MAT['돌']!, skip: ['bottom'] });

  root.group(houseDef.id, placement(0, 0, 0), { name: '집', layer: TAG.walls });
  root.group(roofDef.id, placement(0, 0, 0), { name: '지붕', layer: TAG.roof });
  // 식탁 한 벌(같은 의자 컴포넌트를 돌려 놓고, 인스턴스마다 재질을 바꾼다)
  const tx = 3000;
  const ty = 2300;
  root.component(tableDef.id, placement(tx, ty, 0), { layer: TAG.furniture, material: MAT['원목']! });
  root.component(chairDef.id, placement(tx, ty + 650, 0, 0), { name: '의자 북', layer: TAG.furniture, material: MAT['원목']! });
  root.component(chairDef.id, placement(tx, ty - 650, 0, 180), { name: '의자 남', layer: TAG.furniture, material: MAT['원목']! });
  root.component(chairDef.id, placement(tx + 850, ty, 0, -90), { name: '의자 동', layer: TAG.furniture, material: MAT['파란 천']! });
  root.component(chairDef.id, placement(tx - 850, ty, 0, 90), { name: '의자 서', layer: TAG.furniture, material: MAT['파란 천']! });
  // 나무 세 그루(크기를 바꿔 놓기)
  root.component(treeDef.id, placement(-1700, -1600, 0, 0, 1), { layer: TAG.landscape });
  root.component(treeDef.id, placement(8600, 900, 0, 20, 1.25), { layer: TAG.landscape });
  root.component(treeDef.id, placement(8000, 5400, 0, 40, 0.85), { layer: TAG.landscape });

  return modelDat({
    materials: MATERIALS.map(([id, name]) => [id, name]),
    layers: LAYERS,
    defaultLayer: TAG.untagged,
    definitions: defs.map((d) => ({ name: d.name, entities: d.ents.bytes(d.id) })),
    root: root.bytes(undefined),
    lengthUnit: 2,
  });
}

function sampleFile(model: Uint8Array, compress?: Compressor): Uint8Array {
  const opts: Parameters<typeof skpFile>[1] = {
    version: SAMPLE_VERSION,
    materials: MATERIALS.map(([, name, rgb, alpha]) => [name, alpha !== undefined ? materialXml(name, rgb, alpha, 1) : materialXml(name, rgb)]),
  };
  if (compress) opts.compress = compress;
  return skpFile(model, opts);
}

/** 예제 파일 전체(동기). compress가 없으면 저장 방식 ZIP */
export function sampleSkpBytes(compress?: Compressor): Uint8Array {
  return sampleFile(sampleModelDat(), compress);
}

/** 원시 DEFLATE(CompressionStream 'deflate-raw'). 브라우저가 모르면 null */
export async function deflateRawAsync(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** 예제 파일(model.dat는 되면 DEFLATE로 압축하고, 재질 XML은 저장 방식) */
export async function createSampleSkp(): Promise<Uint8Array> {
  const model = sampleModelDat();
  const packed = await deflateRawAsync(model);
  return sampleFile(model, packed ? (d) => (d === model ? packed : null) : undefined);
}
