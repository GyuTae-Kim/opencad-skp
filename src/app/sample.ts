/**
 * 예제 SketchUp 파일: 저장소에 표본 파일을 두지 않으려고(저작권) 브라우저에서 직접 만든다.
 * 집(벽·바닥·문·유리창) + 박공지붕 + 탁자·의자 4개(같은 컴포넌트를 돌려 놓기) + 나무 3그루(크기를 바꿔 놓기)를
 * 태그 넷(벽·지붕·가구·조경)과 재질 색으로 만든다. 길이는 mm로 짓고, SketchUp처럼 인치로 바꿔 적는다(단위 설정 mm).
 * 겹친 단계 확인용으로 의자 안에 다리 컴포넌트 넷, 나무 안에 줄기·수관 그룹을 두고, 숨긴 그룹(옛 담장) 하나를 둔다.
 * 꾸러미에는 조사 기록에서 본 자리에 작은 그림을 넣는다: 모형 미리보기, 무늬 재질(잔디·기와·마루)의 무늬 그림,
 * 컴포넌트 미리보기(의자·탁자·나무), 장면 미리보기 둘. 그림은 의존성 없이 PNG로 직접 만든다.
 * 장면 넷(앞마당·식탁·단면·위에서)과 저장 카메라, 현관 지시선 글·화면 글, 집 폭·깊이 치수, 보조선, 집 단면 평면,
 * 태그 폴더(건물·주석)와 태그 색, 의자 속성 사전, 모형 이름·설명, 단위 형식(mm 십진)도 넣는다.
 *
 * model.dat는 브라우저의 CompressionStream('deflate-raw')로 압축한다(없으면 저장 방식) — 실제 파일처럼 해석기의 풀기 경로를 탄다.
 */

import {
  dimPoint,
  edge as edgeBytes,
  entities,
  face as faceBytes,
  guideLines,
  instance,
  linearDims,
  materialXml,
  modelDat,
  pngRgb,
  sectionPlanes,
  skpFile,
  texts,
  val,
  vertex as vertexBytes,
  type AttrDictsSpec,
  type CamOpts,
  type Compressor,
  type ZipEntry,
} from './skpwrite';

export const SAMPLE_NAME = 'OpenCAD 예제 집.skp';
/** 예제 파일 머리에 적는 판 */
export const SAMPLE_VERSION = '26.1.194';

type V3 = [number, number, number];

const MM = 1 / 25.4;
/** 깃발: 보통 6, 부드러운·매끈한 모서리 0x1e(SketchUp 화면에서 숨는 곡면 모서리) */
const FLAG_SOFT = 0x1e;

/** 태그 번호 */
const TAG = { untagged: 1, walls: 2, roof: 3, furniture: 4, landscape: 5, dims: 6 } as const;
const LAYERS: [number, string][] = [
  [TAG.untagged, 'Layer0'],
  [TAG.walls, '벽'],
  [TAG.roof, '지붕'],
  [TAG.furniture, '가구'],
  [TAG.landscape, '조경'],
  [TAG.dims, '치수'],
];
/** 태그 색(태그 색 재질 이름 → 꾸러미의 materials/<이름>/material.xml) */
const TAG_COLORS: [number, string, [number, number, number]][] = [
  [TAG.walls, 'Layer_벽', [214, 190, 150]],
  [TAG.roof, 'Layer_지붕', [190, 80, 60]],
  [TAG.furniture, 'Layer_가구', [120, 150, 210]],
  [TAG.landscape, 'Layer_조경', [96, 170, 96]],
  [TAG.dims, 'Layer_치수', [120, 120, 120]],
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
/** 무늬(텍스처) 재질로 적는 재질 — 꾸러미에 무늬 그림을 넣고 material.xml에 hasTexture="1" */
const TEXTURED = new Set(['잔디', '기와', '마루']);
/** 숨김 깃발(07d3 비트 0) */
const FLAG_HIDDEN_INST = 0x07;

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

interface InstOpt {
  name?: string;
  layer?: number;
  material?: number;
  flags?: number;
  attrs?: AttrDictsSpec;
  guid?: Uint8Array;
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
  /** 주석 목록(texts·linearDims·guideLines·sectionPlanes로 만든 것) */
  readonly extra: Uint8Array[] = [];
  /** 이 묶음의 활성 단면 번호 */
  activeSection?: number;
  /** 묶음 머리 속성 사전(정의 속성) */
  attrs?: AttrDictsSpec;

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

  group(def: number, m13: number[], o: InstOpt = {}): void {
    this.groups.push(instance(this.ids.next(), def, m13, o));
  }

  component(def: number, m13: number[], o: InstOpt = {}): void {
    this.comps.push(instance(this.ids.next(), def, m13, o));
  }

  bytes(id: number | undefined): Uint8Array {
    const edges = [...this.edges.values()].map((e) => edgeBytes(e.id, e.a, e.b, { flags: e.flags }));
    const o: Parameters<typeof entities>[1] = { vertices: this.vBytes, edges, faces: this.faces };
    if (this.groups.length) o.groups = this.groups;
    if (this.comps.length) o.components = this.comps;
    if (this.extra.length) o.extra = this.extra;
    if (this.activeSection !== undefined) o.activeSection = this.activeSection;
    if (this.attrs) o.attrs = this.attrs;
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
  /** 0 컴포넌트 · 1 그룹 */
  kind?: number;
  description?: string;
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
  return { id: ids.next(), name: '집 벽체', ents: e, kind: 1 };
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
  return { id: ids.next(), name: '박공지붕', ents: e, kind: 1 };
}

/** 의자 다리: 40 × 40 × 430 mm, 원점이 한 구석(재질은 의자 인스턴스에서 물려받는다) */
function chairLeg(ids: Ids): Def {
  const e = new Ents(ids);
  e.box([0, 0, 0], [40, 40, 430], { skip: ['top'] });
  return { id: ids.next(), name: '의자 다리', ents: e, description: '의자 다리 하나(네 번 놓는다)' };
}

/** 의자: 원점이 가운데, 등받이는 +y 쪽(앉은 사람은 -y를 본다). 다리는 안쪽 컴포넌트 넷. 재질은 인스턴스에서 물려받는다 */
function chair(ids: Ids, leg: Def): Def {
  const e = new Ents(ids);
  const s = 225;
  e.box([-s, -s, 430], [s, s, 470]);
  const legs: [string, number, number][] = [
    ['앞 왼쪽 다리', -s, -s],
    ['앞 오른쪽 다리', s - 40, -s],
    ['뒤 왼쪽 다리', -s, s - 40],
    ['뒤 오른쪽 다리', s - 40, s - 40],
  ];
  for (const [name, x, y] of legs) e.component(leg.id, placement(x, y, 0), { name });
  e.box([-s, s - 40, 470], [s, s, 920], { skip: ['bottom'] });
  // 정의 속성 사전(SketchUp 확장이 붙이는 꼴): 엔티티 정보의 "정의" 사전으로 보인다
  e.attrs = [['제품', [['이름', val.str('식탁 의자')], ['가격', val.i32(120000)], ['폭', val.length(450 * MM)], ['쌓을 수 있음', val.bool(true)]]]];
  return { id: ids.next(), name: '의자', ents: e, description: '네 다리 나무 의자(인스턴스마다 재질을 바꿔 놓았다)' };
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
  return { id: ids.next(), name: '탁자', ents: e, description: '네 사람 식탁' };
}

/** 나무: 육각 줄기 그룹 + 여덟 모 수관 그룹(곡면처럼 모서리를 부드럽게). 정의 셋(줄기·수관 그룹 정의와 나무)을 돌려준다 */
function tree(ids: Ids): [Def, Def, Def] {
  const trunk = new Ents(ids);
  const crown = new Ents(ids);
  const ring = (r: number, z: number, k = 8, phase = 0): V3[] =>
    Array.from({ length: k }, (_, i) => {
      const a = phase + (i / k) * Math.PI * 2;
      return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)), z] as V3;
    });
  trunk.prism(ring(120, 0, 6), [0, 0, 1300], { material: MAT['줄기']!, skip: ['top'], softSides: true });
  const e = crown;
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
  const trunkDef: Def = { id: ids.next(), name: '그룹#1', ents: trunk, kind: 1 };
  const crownDef: Def = { id: ids.next(), name: '그룹#2', ents: crown, kind: 1 };
  const whole = new Ents(ids);
  whole.group(trunkDef.id, placement(0, 0, 0), { name: '줄기' });
  whole.group(crownDef.id, placement(0, 0, 0), { name: '수관' });
  return [trunkDef, crownDef, { id: ids.next(), name: '나무', ents: whole }];
}

/** 숨긴 옛 담장(숨긴 형상 보기 확인용): 낮은 돌담 */
function oldFence(ids: Ids): Def {
  const e = new Ents(ids);
  e.box([-3000, 6800, 0], [10500, 7000, 600], { material: MAT['돌']!, skip: ['bottom'] });
  return { id: ids.next(), name: '옛 담장', ents: e, kind: 1 };
}

/** 예제 model.dat 바이트 */
export function sampleModelDat(): Uint8Array {
  const ids = new Ids();
  const legDef = chairLeg(ids);
  const [trunkDef, crownDef, treeDef] = tree(ids);
  const houseDef = house(ids);
  const roofDef = roof(ids);
  const tableDef = table(ids);
  const chairDef = chair(ids, legDef);
  const fenceDef = oldFence(ids);
  const defs = [houseDef, roofDef, tableDef, chairDef, treeDef, legDef, trunkDef, crownDef, fenceDef];

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
  root.component(chairDef.id, placement(tx, ty + 650, 0, 0), { name: '의자 북', layer: TAG.furniture, material: MAT['원목']!, attrs: [['배치', [['자리', val.str('북쪽')], ['주인', val.str('집주인')]]]] });
  root.component(chairDef.id, placement(tx, ty - 650, 0, 180), { name: '의자 남', layer: TAG.furniture, material: MAT['원목']! });
  root.component(chairDef.id, placement(tx + 850, ty, 0, -90), { name: '의자 동', layer: TAG.furniture, material: MAT['파란 천']! });
  root.component(chairDef.id, placement(tx - 850, ty, 0, 90), { name: '의자 서', layer: TAG.furniture, material: MAT['파란 천']! });
  // 나무 세 그루(크기를 바꿔 놓기)
  root.component(treeDef.id, placement(-1700, -1600, 0, 0, 1), { layer: TAG.landscape });
  root.component(treeDef.id, placement(8600, 900, 0, 20, 1.25), { layer: TAG.landscape });
  root.component(treeDef.id, placement(8000, 5400, 0, 40, 0.85), { layer: TAG.landscape });
  // 숨긴 그룹(기본으로는 그리지 않는다)
  root.group(fenceDef.id, placement(0, 0, 0), { name: '옛 담장', layer: TAG.landscape, flags: FLAG_HIDDEN_INST });

  // 주석: 현관 지시선 글, 화면 글, 집 폭·깊이 치수(앞·오른쪽으로 띄움), 마당 앞 보조선
  const pt = (x: number, y: number, z: number): [number, number, number] => [x * MM, y * MM, z * MM];
  root.extra.push(
    texts([
      { id: ids.next(), text: '현관', point: dimPoint(1, pt(3000, 0, 2100)), leader: pt(-1400, -1600, 900), leaderType: 2, layer: TAG.dims },
      { id: ids.next(), text: 'OpenCAD 예제 집', point: dimPoint(0, [0, 0, 0]), screen: [0.62, 0.92] },
    ]),
    linearDims([
      { id: ids.next(), start: dimPoint(1, pt(0, 0, 0)), end: dimPoint(1, pt(6000, 0, 0)), xaxis: [1, 0, 0], alignment: 1, offset: -900 * MM, layer: TAG.dims, arrow: 3 },
      { id: ids.next(), start: dimPoint(1, pt(6000, 0, 0)), end: dimPoint(1, pt(6000, 4000, 0)), xaxis: [1, 0, 0], alignment: 2, offset: -900 * MM, layer: TAG.dims, arrow: 3 },
    ]),
    guideLines([{ id: ids.next(), point: pt(-3500, -2600, 0), direction: [1, 0, 0] }]),
  );
  // 집을 x = 4200 mm에서 세로로 자르는 단면(x ≤ 4200 쪽이 남는다). 평소에는 끄고 "단면" 장면에서만 켠다
  const sectionId = ids.next();
  root.extra.push(sectionPlanes([{ id: sectionId, plane: [-1, 0, 0, 4200 * MM], name: '집 단면', symbol: 'A' }]));

  const cam = (eye: V3, target: V3, o: Partial<CamOpts> = {}): CamOpts => {
    // SketchUp은 위 벡터를 시선과 직교로 적는다
    const d = sub(target, eye);
    const right: V3 = [d[1], -d[0], 0];
    const up: V3 = [right[1] * d[2] - right[2] * d[1], right[2] * d[0] - right[0] * d[2], right[0] * d[1] - right[1] * d[0]];
    const len = Math.hypot(...up) || 1;
    return { eye: pt(...eye), target: pt(...target), up: [up[0] / len, up[1] / len, up[2] / len], fov: 35, ...o };
  };
  const front = cam([-4000, -11000, 6200], [3000, 2000, 1200]);
  const pageIds = [ids.next(), ids.next(), ids.next(), ids.next()];
  return modelDat({
    materials: MATERIALS.map(([id, name]) => [id, name]),
    tags: LAYERS.map(([id, name]) => {
      const color = TAG_COLORS.find(([t]) => t === id);
      return color ? { id, name, color: color[1] } : { id, name };
    }),
    // 태그 폴더: 건물(벽·지붕), 주석(치수)
    tagFolders: [
      { id: ids.next(), name: '건물', tags: [TAG.walls, TAG.roof] },
      { id: ids.next(), name: '주석', tags: [TAG.dims] },
    ],
    defaultLayer: TAG.untagged,
    definitions: defs.map((d) => ({
      name: d.name,
      entities: d.ents.bytes(d.id),
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
    })),
    root: root.bytes(undefined),
    options: [
      [
        'UnitsOptions',
        [
          ['LengthUnit', val.i32(2)],
          ['LengthFormat', val.i32(0)],
          ['LengthPrecision', val.i32(0)],
          ['AnglePrecision', val.i32(1)],
          ['AreaUnit', val.i32(4)],
          ['AreaPrecision', val.i32(2)],
          ['SuppressUnitsDisplay', val.bool(false)],
        ],
      ],
      ['PageOptions', [['ShowTransition', val.bool(true)], ['TransitionTime', val.f64(1)]]],
    ],
    properties: [['ModelProperties', [['Name', val.str('예제 집')], ['Description', val.str('브라우저에서 만든 작은 집 모형(장면·치수·단면 시험용)')]]]],
    camera: front,
    pages: {
      // use 깃발: 0x01 카메라, 0x20 숨긴 태그, 0x40 단면
      list: [
        { id: pageIds[0]!, name: '앞마당', description: '집 앞에서 본 모습', flags: 0x21, camera: front, thumbnail: 'scene_thumbnails/앞마당.png' },
        { id: pageIds[1]!, name: '식탁', description: '지붕을 숨기고 위에서 본 식탁', flags: 0x21, camera: cam([3000, -2600, 7600], [3000, 2300, 500]), tags: [TAG.roof], thumbnail: 'scene_thumbnails/식탁.png' },
        { id: pageIds[2]!, name: '단면', description: 'x = 4.2 m에서 자른 집', flags: 0x61, camera: cam([9000, -8000, 4600], [3000, 2000, 1200]), sections: [sectionId] },
        { id: pageIds[3]!, name: '위에서', description: '평행 투영 평면도', flags: 0x21, camera: { eye: pt(3750, 2000, 30000), target: pt(3750, 2000, 0), up: [0, 1, 0], perspective: false, height: 15000 * MM } },
      ],
      // 활성 장면은 장면의 영구 번호로 가리킨다
      active: pageIds[0]!,
    },
  });
}

/** 정해진 차례로 도는 간단한 잡음(0~1) — 그림이 늘 같게 */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

type Rgb = readonly [number, number, number];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

/** 무늬 그림 16 × 16(잔디 점무늬 · 기와 줄 · 마루 널) */
function textureImage(name: string, rgb: Rgb): Uint8Array {
  return pngRgb(16, 16, (x, y) => {
    if (name === '기와') return shade(rgb, y % 4 === 3 ? 0.7 : (x + (y >> 2) * 4) % 8 === 0 ? 0.8 : 1.05);
    if (name === '마루') return shade(rgb, (y % 5 === 4 ? 0.75 : 1) * (0.92 + 0.16 * noise(x >> 2, y, 3)));
    return shade(rgb, 0.8 + 0.4 * noise(x, y, 1));
  });
}

/** 그림 위 도형 그리기 도움(그림판 꼴) */
class Canvas {
  readonly px: Rgb[];
  constructor(
    readonly w: number,
    readonly h: number,
    bg: (x: number, y: number) => Rgb,
  ) {
    this.px = Array.from({ length: w * h }, (_, i) => bg(i % w, Math.floor(i / w)));
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: Rgb): this {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.px[y * this.w + x] = c;
    return this;
  }
  disc(cx: number, cy: number, r: number, c: Rgb): this {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }
  /** 위가 뾰족한 삼각형(밑변 y1, 꼭짓점 (cx, y0)) */
  gable(cx: number, y0: number, half: number, y1: number, c: Rgb): this {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      this.rect(Math.round(cx - half * t), y, Math.round(cx + half * t) + 1, y + 1, c);
    }
    return this;
  }
  png(): Uint8Array {
    return pngRgb(this.w, this.h, (x, y) => this.px[y * this.w + x]!);
  }
}

const SKY: Rgb = [176, 206, 236];
const GRASS: Rgb = [118, 164, 84];
const WALL: Rgb = [236, 231, 220];
const ROOF: Rgb = [158, 72, 56];
const WOOD: Rgb = [176, 126, 76];
const LEAF: Rgb = [72, 142, 74];
const TRUNK: Rgb = [104, 74, 48];
const GLASS: Rgb = [150, 200, 232];

/** 앞에서 본 집(모형 미리보기·장면 미리보기) */
function houseView(w: number, h: number): Canvas {
  const g = Math.round(h * 0.68);
  const c = new Canvas(w, h, (_, y) => (y < g ? mix(SKY, [232, 240, 250], y / g) : shade(GRASS, 0.9 + 0.2 * noise(_, y, 5))));
  const x0 = Math.round(w * 0.3);
  const x1 = Math.round(w * 0.7);
  const top = Math.round(h * 0.38);
  c.rect(x0, top, x1, g, WALL);
  c.gable(Math.round((x0 + x1) / 2), Math.round(h * 0.16), Math.round((x1 - x0) * 0.62), top, ROOF);
  const dw = Math.max(2, Math.round((x1 - x0) * 0.16));
  c.rect(Math.round((x0 + x1) / 2 - dw / 2), Math.round(g - (g - top) * 0.62), Math.round((x0 + x1) / 2 + dw / 2), g, [122, 82, 52]);
  const ww = Math.max(2, Math.round((x1 - x0) * 0.18));
  const wy = Math.round(top + (g - top) * 0.25);
  const wh = Math.max(2, Math.round((g - top) * 0.3));
  c.rect(x0 + Math.round(ww * 0.6), wy, x0 + Math.round(ww * 1.6), wy + wh, GLASS);
  c.rect(x1 - Math.round(ww * 1.6), wy, x1 - Math.round(ww * 0.6), wy + wh, GLASS);
  for (const [tx, s] of [
    [0.12, 1],
    [0.86, 1.2],
  ] as const) {
    const cx = Math.round(w * tx);
    c.rect(cx - 1, Math.round(g - h * 0.12 * s), cx + 2, g, TRUNK);
    c.disc(cx, Math.round(g - h * 0.2 * s), h * 0.1 * s, LEAF);
  }
  return c;
}

/** 위에서 본 식탁 한 벌(장면 미리보기) */
function diningView(w: number, h: number): Canvas {
  const c = new Canvas(w, h, (x, y) => shade([196, 156, 106], (y % 6 === 5 ? 0.82 : 1) * (0.94 + 0.12 * noise(x >> 3, y, 7))));
  const cx = w / 2;
  const cy = h / 2;
  c.rect(Math.round(cx - w * 0.22), Math.round(cy - h * 0.2), Math.round(cx + w * 0.22), Math.round(cy + h * 0.2), WOOD);
  const s = Math.round(Math.min(w, h) * 0.12);
  for (const [dx, dy, col] of [
    [0, -0.36, WOOD],
    [0, 0.36, WOOD],
    [-0.36, 0, [64, 104, 172] as Rgb],
    [0.36, 0, [64, 104, 172] as Rgb],
  ] as const) {
    const x = Math.round(cx + dx * w);
    const y = Math.round(cy + dy * h);
    c.rect(x - s, y - s, x + s, y + s, shade(col, 0.85));
  }
  return c;
}

/** 컴포넌트 미리보기 32 × 32 */
function componentThumb(name: string): Uint8Array {
  const c = new Canvas(32, 32, () => [244, 245, 247]);
  if (name === '의자') c.rect(9, 4, 23, 8, WOOD).rect(9, 15, 23, 18, WOOD).rect(9, 4, 12, 28, shade(WOOD, 0.85)).rect(20, 18, 23, 28, shade(WOOD, 0.85));
  else if (name === '탁자') c.rect(3, 10, 29, 14, WOOD).rect(5, 14, 8, 28, shade(WOOD, 0.85)).rect(24, 14, 27, 28, shade(WOOD, 0.85));
  else c.rect(14, 18, 18, 30, TRUNK).disc(16, 12, 10, LEAF);
  return c.png();
}

/** 꾸러미에 넣는 그림 항목(조사 기록에서 본 자리) */
function sampleImages(): ZipEntry[] {
  const out: ZipEntry[] = [{ name: 'meta/model_thumbnail.png', data: houseView(96, 64).png() }];
  for (const [, name, rgb] of MATERIALS) if (TEXTURED.has(name)) out.push({ name: `materials/${name}/${name}.png`, data: textureImage(name, rgb) });
  for (const name of ['의자', '탁자', '나무']) out.push({ name: `thumbnails/${name}.png`, data: componentThumb(name) });
  out.push({ name: 'scene_thumbnails/앞마당.png', data: houseView(80, 50).png() }, { name: 'scene_thumbnails/식탁.png', data: diningView(80, 50).png() });
  // 직접 만든 PNG는 압축하지 않은 zlib 흐름이라, 압축 함수가 있으면 꾸러미에서 DEFLATE로 줄인다
  for (const e of out) e.deflate = true;
  return out;
}

function sampleFile(model: Uint8Array, compress?: Compressor): Uint8Array {
  const opts: Parameters<typeof skpFile>[1] = {
    version: SAMPLE_VERSION,
    materials: [
      ...MATERIALS.map(([, name, rgb, alpha]): [string, string] => [
        name,
        alpha !== undefined ? materialXml(name, rgb, alpha, 1) : materialXml(name, rgb, 1, 0, TEXTURED.has(name)),
      ]),
      // 태그 색 재질(재질 목록에는 없고 태그 안에서만 가리킨다)
      ...TAG_COLORS.map(([, name, rgb]): [string, string] => [name, materialXml(name, rgb)]),
    ],
    extra: sampleImages(),
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
