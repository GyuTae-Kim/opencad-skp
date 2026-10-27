/**
 * SKP 중간 모형 → Scene3d. 그룹·컴포넌트 인스턴스를 변환을 곱해 펼치고(세계 좌표),
 * 면(바깥 고리 + 구멍)은 평면 법선의 가장 큰 축을 버린 2D 투영으로 earcut 삼각화한다.
 * 그물은 (태그, 재질)마다 하나로 모으고, 모서리는 태그마다 LineSet3d 하나로 모은다.
 *
 * outline 선택을 켜면 화면이 그룹·컴포넌트를 하나씩 고르고 강조·숨기기할 수 있게 한다.
 *   - 나무(meta.tree): 인스턴스 배치마다 노드 하나. 넓이 우선으로 단계를 내려가며 노드 한도(MAX_TREE_NODES)까지 넣는다.
 *   - 나누기: 그리기 호출 수가 터지지 않게, 항목 수 어림이 한도(MAX_SPLIT_ITEMS) 안인 가장 깊은 단계(splitDepth)까지만
 *     노드마다 그물·모서리를 따로 모은다. 그보다 깊은 노드는 그 단계 조상의 그물에 함께 들어간다.
 *     모형 바로 아래 단계(1)는 예전처럼 늘 나눈다(윗단계가 MAX_OUTLINE_ENTRIES를 넘으면 나누지 않는다).
 *   - 구간(runs): 펼치기는 깊이 우선이라 한 노드의 안쪽 전부가 각 그물·모서리 묶음 안에서 이어진 구간이 된다.
 *     덧붙일 때마다 (항목, 시작 삼각형·선분, 노드)를 적어 두면, 화면이 고른 삼각형에서 가장 안쪽 노드를 찾고
 *     나누지 않은 깊은 노드도 그 구간으로 강조·맞춰 보기할 수 있다.
 * extras 선택을 켜면 부드러운·매끈한 모서리와 숨긴 형상(숨긴 면·모서리·인스턴스)을 따로 묶어 낸다(화면에서 켜고 끄기용).
 *
 * smooth 선택을 켜면 매끈한 모서리(0x10)로 이어진 면의 꼭짓점 법선을 평균해 Mesh3d.normals로 낸다(scene-smooth.ts).
 *   인스턴스 변환은 역전치(여인수 행렬)로 곱하고, 이어 칠한 면이 든 그물만 법선을 갖는다(나머지는 예전처럼 평면 음영).
 *
 * 주석(문자·치수·보조선·단면)도 배치마다 변환을 곱해 모은다: 선분은 종류·태그마다 LineSet3d(장면 범위에는 넣지 않는다),
 * 보조점은 PointSet3d, 글·잰 값·단면 평면은 meta(texts·dimensions·sectionPlanes, src/meta.ts 꼴)로 낸다.
 * 숨긴 주석(깃발·감싼 숨긴 인스턴스)은 meta에 hidden: true로 넣고, 선분은 extras일 때만 따로 묶어 extraItems.hidden에도 적는다.
 *
 * 재질 물려받기(SketchUp 화면과 같게 잡은 규칙, 앞·뒤 따로): 앞면은 면 앞 재질 → 감싼 인스턴스 재질(안쪽부터) → 기본색(스타일 앞면 색),
 *   뒷면은 면 뒤 재질 → 감싼 인스턴스 재질 → 스타일 뒷면 색. 뒷면이 앞면과 다르면 그물에 backColor(뒷면 무늬면 backTexture·backUvs)를 단다.
 *   삼각형은 면 법선 쪽에서 반시계로 감는다(거울상 배치도 바로잡는다 — 코어가 시계 방향으로 보이는 쪽을 뒷면으로 칠한다).
 * 태그 물려받기: 요소 태그가 없거나 기본 태그면 감싼 인스턴스의 태그를 따른다.
 *
 * 무늬(textures 선택): 칠하는 재질이 무늬 재질이면 그물에 무늬 좌표(uvs)와 무늬 id를 둔다(projection.ts).
 *   - 면 자기 재질(앞, 또는 물려받을 것이 없어 뒤)로 칠하면 그쪽에 저장된 투영(없으면 기본 투영)과 그 재질의 무늬 크기.
 *   - 인스턴스 재질을 물려받아 칠하면 기본 투영(정의 원점·면 평면 틀)과 물려받은 재질의 무늬 크기 — 정의마다 평면 좌표(인치)를
 *     한 번 구해 두고 배치마다 무늬 크기로 나눈다. 무늬 좌표는 정의 좌표로 구하므로 인스턴스를 늘리면 무늬도 함께 늘어난다.
 *   - 원근 무늬(면 위에서 q가 바뀌는 투영)가 하나라도 든 그물은 (u·q, v·q, q) 3값, 아니면 (u, v) 2값.
 */

import earcut from 'earcut';
import type { Box3, LineSet3d, Mesh3d, PointSet3d, Rgba } from 'opencad-viewer3d/types';
import {
  FLAG_HIDDEN,
  FLAG_LOCKED,
  FLAG_SOFT_SMOOTH,
  type SkpDefinition,
  type SkpEntities,
  type SkpInstance,
  type SkpModel,
  type SkpTag,
} from './model';
import type { SkpMaterialInfo } from './materials';
import type {
  Rgb,
  SkpAnnotationItems,
  SkpAttrDictsMeta,
  SkpDimensionMeta,
  SkpFontMeta,
  SkpSectionPlaneMeta,
  SkpTextMeta,
  SkpTreeInfo,
  Vec3,
} from './meta';
import * as A from './scene-annotations';
import { AttrPool, PAGE_USE_HIDDEN_OBJECTS } from './scene-meta';
import { cornerNormals, faceUnitNormal } from './scene-smooth';
import { F32, I32, U32 } from './grow';
import { applyFaceUvq, faceUvq, planeAxes } from './projection';
import { solidInfo } from './solid';

export const DEFAULT_FACE_COLOR: Rgba = [0.82, 0.82, 0.8, 1];
export const EDGE_COLOR: Rgba = [0.12, 0.12, 0.12, 1];
/** 부드러운·매끈한 모서리 색(extras) — 보통 모서리보다 옅게 */
export const SOFT_EDGE_COLOR: Rgba = [0.52, 0.52, 0.52, 1];
/** 숨긴 모서리 색(extras, 점선으로 그린다) */
export const HIDDEN_EDGE_COLOR: Rgba = [0.45, 0.45, 0.52, 1];
/** 숨긴 면의 불투명도(extras) */
export const HIDDEN_FACE_ALPHA = 0.28;
/** 펼친 뒤 면 정점 수 한도(브라우저 메모리 보호) */
export const MAX_OUTPUT_VERTICES = 12_000_000;
/** 펼친 뒤 모서리 선분 수 한도(넘으면 선만 그만 그리고 면은 계속) */
export const MAX_OUTPUT_SEGMENTS = 3_000_000;
/** extras(숨긴 면) 정점 수 한도 — 보통 형상 한도와 따로 센다 */
export const MAX_EXTRA_VERTICES = 4_000_000;
/** extras(부드러운·숨긴 모서리) 선분 수 한도 */
export const MAX_EXTRA_SEGMENTS = 2_000_000;
/** 인스턴스 배치 수 한도(서로를 여러 번 품는 정의가 기하급수로 불어나는 깨진 파일 보호) */
export const MAX_PLACEMENTS = 2_000_000;
/** 인스턴스 겹 깊이 한도(자기 자신을 품는 깨진 파일 보호) */
const MAX_DEPTH = 64;
/** outline으로 따로 나눌 윗단계 인스턴스 수 기본 한도(그리기 호출 수 보호) */
export const MAX_OUTLINE_ENTRIES = 1000;
/** 나무에 넣는 노드 수 한도(넓이 우선, 단계 단위로 자른다) */
export const MAX_TREE_NODES = 50_000;
/** 깊은 단계까지 나눌 때 그물·모서리 항목 수 어림 한도(= 그리기 호출 수 어림) */
export const MAX_SPLIT_ITEMS = 3000;
/** 구간(runs) 수 한도 — 넘으면 구간을 버린다(나무와 나눈 항목은 남는다) */
export const MAX_TREE_RUNS = 2_000_000;
/** 무늬 좌표를 다는 정점 수 한도(넘으면 그 뒤 그물은 무늬 없이 평균색 — 정점마다 8~12바이트가 더 든다) */
export const MAX_UV_VERTICES = 6_000_000;
/** 장면이 다시 보이는 모형 숨김 인스턴스(revealItems): 노드 수·정점 수 한도(한 번 더 그리는 형상이라 작게) */
export const MAX_REVEAL_NODES = 200;
export const MAX_REVEAL_VERTICES = 2_000_000;
/** "항상 카메라 보기" 컴포넌트를 따로 돌릴 그물로 낼 배치 수 한도(넘는 배치는 저장된 방향 그대로 다른 형상과 함께) */
export const MAX_BILLBOARDS = 500;
/**
 * 나누는 단계보다 깊어도 따로 나눌 나무 노드 수 한도: 단면 평면이 든 그룹·컴포넌트(그 그룹만 자르는 단면 — 코어 setSections의 items)와
 * "항상 카메라 보기" 컴포넌트(돌리는 그물·윤곽선을 항목째 숨기기)
 */
export const MAX_FORCED_SPLITS = 256;
/**
 * 한 칸 안에서 단면 채우기 묶음(capGroup)을 나눌 수 한도: 코어는 묶음 안을 홀짝으로 채워(겹친 두 입체의 겹친 곳이 비고 고르기도 지나간다),
 * 범위 상자가 겹치는 닫힌 입체 배치는 다른 묶음에 넣는다. 모두 겹치면 예전처럼 첫 묶음
 */
export const MAX_CAP_SPLITS = 4;
/** 채우기 묶음을 나눌 때 상자 비교 수 한도(넘으면 그 뒤 배치는 예전처럼 첫 묶음 — 아주 큰 모형의 시간 보호) */
export const MAX_CAP_TESTS = 4_000_000;

/**
 * 범위 상자(최소 xyz, 최대 xyz) 모음과 겹침 찾기: 크기 단계(상자보다 큰 2의 거듭제곱 칸)마다 격자에 넣어, 찾을 상자가 덮는 칸만 본다
 * (덮는 칸이 너무 많은 작은 단계는 그 단계 상자를 모두 본다). 닿기만 한 상자(맞붙은 벽·쌓은 상자)는 겹치지 않은 것으로 본다
 */
export class BoxSet {
  private readonly boxes: number[] = [];
  private readonly seen: number[] = [];
  private query = 0;
  private readonly levels = new Map<number, { cells: Map<string, number[]>; members: number[] }>();

  get size(): number {
    return this.boxes.length / 6;
  }

  private static level(b: ArrayLike<number>): number {
    const ext = Math.max(b[3]! - b[0]!, b[4]! - b[1]!, b[5]! - b[2]!, 1e-12);
    return Math.ceil(Math.log2(ext));
  }

  add(b: ArrayLike<number>): void {
    const id = this.boxes.length / 6;
    for (let k = 0; k < 6; k++) this.boxes.push(b[k]!);
    this.seen.push(0);
    const L = BoxSet.level(b);
    let lv = this.levels.get(L);
    if (!lv) this.levels.set(L, (lv = { cells: new Map(), members: [] }));
    lv.members.push(id);
    const c = 2 ** L;
    for (let x = Math.floor(b[0]! / c); x <= Math.floor(b[3]! / c); x++)
      for (let y = Math.floor(b[1]! / c); y <= Math.floor(b[4]! / c); y++)
        for (let z = Math.floor(b[2]! / c); z <= Math.floor(b[5]! / c); z++) {
          const key = `${x},${y},${z}`;
          const list = lv.cells.get(key);
          if (list) list.push(id);
          else lv.cells.set(key, [id]);
        }
  }

  /** b와 부피가 겹치는 상자가 있는지. budget.left(비교 수)가 다 떨어지면 null(모른다) */
  overlaps(b: ArrayLike<number>, budget: { left: number }): boolean | null {
    const q = ++this.query;
    const B = this.boxes;
    const test = (id: number): boolean => {
      if (this.seen[id] === q) return false;
      this.seen[id] = q;
      budget.left--;
      const o = 6 * id;
      for (let k = 0; k < 3; k++) {
        const lo = Math.max(B[o + k]!, b[k]!);
        const hi = Math.min(B[o + 3 + k]!, b[3 + k]!);
        // 닿기만 한 것(겹친 길이가 작은 쪽 폭의 백만분의 1 또는 좌표 반올림 오차 안)은 겹치지 않은 것으로
        const ext = Math.min(B[o + 3 + k]! - B[o + k]!, b[3 + k]! - b[k]!);
        if (!(hi - lo > ext * 1e-6 + Math.max(Math.abs(lo), Math.abs(hi)) * 1e-13)) return false;
      }
      return true;
    };
    for (const [L, lv] of this.levels) {
      const c = 2 ** L;
      const x0 = Math.floor(b[0]! / c), x1 = Math.floor(b[3]! / c);
      const y0 = Math.floor(b[1]! / c), y1 = Math.floor(b[4]! / c);
      const z0 = Math.floor(b[2]! / c), z1 = Math.floor(b[5]! / c);
      const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (!(cells <= 64) || cells > lv.members.length) {
        for (const id of lv.members) {
          if (budget.left <= 0) return null;
          if (test(id)) return true;
        }
        continue;
      }
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const list = lv.cells.get(`${x},${y},${z}`);
            if (!list) continue;
            for (const id of list) {
              if (budget.left <= 0) return null;
              if (test(id)) return true;
            }
          }
    }
    return false;
  }
}

/**
 * 큰 좌표 기준(인치): 덧붙이는 형상(배치 하나의 한 묶음)의 첫 정점이 원점에서 이보다 멀면(어느 축이든),
 * 그 형상은 1 km 칸(기준 × 10)마다 따로 모은 묶음에 넣고, 묶음에 origin(처음 넣은 정점을 반올림)을 두어
 * positions를 그만큼 빼서 적는다(float32 떨림 방지, 코어 v0.4의 묶음 원점). 1e5 mm = 100 m.
 * 모든 형상이 이보다 가까운 모형은 묶음 열쇠·출력이 예전과 바이트까지 같다.
 */
export const LARGE_COORD_INCH = 1e5 / 25.4;

/** 주석 한도: 문자·치수·보조선(보조점 포함)은 각각, 단면 평면, 주석 선분 전체 */
export const MAX_TEXTS = 20_000;
export const MAX_DIMENSIONS = 20_000;
export const MAX_GUIDES = 20_000;
export const MAX_SECTION_PLANES = 1000;
export const MAX_ANNOTATION_SEGMENTS = 1_000_000;
/** 주석 선 색(재질·모형 기본값이 없을 때) */
export const ANNOTATION_COLOR: Rgba = [0, 0, 0, 1];
export const GUIDE_COLOR: Rgba = [0.25, 0.25, 0.32, 1];
export const SECTION_COLOR: Rgba = [0.9, 0.45, 0.1, 1];

/** 주석 선분 묶음 id 머리(skp-<머리>-<scene.lines 차례>)와 이름 */
const ANNOTATION_ID: Record<keyof SkpAnnotationItems, string> = { dimensions: 'dims', leaders: 'leaders', guides: 'guides', sectionPlanes: 'sections' };
const ANNOTATION_LABEL: Record<keyof SkpAnnotationItems, string> = { dimensions: '치수', leaders: '지시선', guides: '보조선', sectionPlanes: '단면 기호' };

/** 나무 노드 깃발: 모형에서 숨긴 인스턴스(또는 그 안쪽) */
export const TREE_HIDDEN = 1;
/** 나무 노드 깃발: 안쪽 인스턴스가 있지만 노드 한도로 목록에 넣지 않음 */
export const TREE_MORE = 2;

/** 재질 열쇠(앞·뒤 따로): ≥0 면의 그쪽 재질, -1 물려받기(감싼 인스턴스 재질, 없으면 스타일 앞면·뒷면 색) */
type MatKey = number;

interface Batch {
  mat: MatKey;
  /** 뒷면 재질 열쇠 */
  back: MatKey;
  /** 태그 번호, -1이면 물려받기 */
  layer: number;
  pos: Float64Array;
  idx: Uint32Array;
  /** 삼각화한 면 수 */
  faces: number;
  /** 면 넓이 합(로컬 인치²) */
  area: number;
  /** 면마다 넓이와 단위 법선(배율이 축마다 다른 배치의 넓이를 셀 때) */
  fa: Float64Array;
  fn: Float32Array;
  /** smooth 선택일 때 꼭짓점 법선(로컬, 위치와 같은 차례)과 이어 칠한 면이 들었는지 */
  nrm?: Float32Array;
  smoothed?: boolean;
  /** 자기 앞 재질이 무늬 재질일 때 무늬 좌표(무늬 한 장 단위) */
  uv?: Float32Array;
  uvStride?: 2 | 3;
  /** 자기 뒷면 재질이 무늬 재질일 때 뒷면 무늬 좌표 */
  buv?: Float32Array;
  buvStride?: 2 | 3;
  /** 물려받은 무늬 재질용 기본 투영 평면 좌표(인치, 정점마다 2값 — 무늬 크기로 나눠 쓴다) */
  plane?: Float32Array;
  /** 면마다 삼각형 수(면 차례 — 한 면의 삼각형은 idx 안에서 이어진다) */
  ft: Uint32Array;
}

/** 무늬 재질(model.dat 재질 번호 → 무늬 id·무늬 한 장 크기(인치)) */
export interface SceneTexture {
  id: string;
  w: number;
  h: number;
}

/** 정의 준비 때 무늬 맥락 */
interface PrepTex {
  tile: (mat: number) => SceneTexture | undefined;
  /** 물려받을 무늬 재질(인스턴스 재질)이 있어 평면 좌표가 필요한지 */
  plane: boolean;
  /** 원근 없이 칠한 면(Q 부호가 바뀌거나 소실점 가까이), 뒤집지 못한 투영 행렬 수 */
  flat: number;
  singular: number;
}

/** 모서리 갈래: 0 보통 · 1 부드러운·매끈한 · 2 숨긴 */
type LineCls = 0 | 1 | 2;

interface LineBatch {
  layer: number;
  pos: Float64Array;
  cls: LineCls;
  /** 선분마다 정의 안 곡선 차례(-1 = 곡선 아님). 곡선 모서리가 없으면 없다 */
  curve?: Int32Array;
}

interface Prepared {
  /** 보통 면 */
  batches: Batch[];
  /** 보통 모서리 */
  lines: LineBatch[];
  /** 숨긴 면(extras일 때만) */
  hiddenBatches: Batch[];
  /** 부드러운·숨긴 모서리(extras일 때만) */
  extraLines: LineBatch[];
  /** 보통 면이 닫힌 껍질(숨긴 면·삼각화 못 한 면 없음) — 단면 채우기 묶음(capGroup)에 넣는다 */
  closed: boolean;
  /** SketchUp 입체면 부피(로컬 인치³, solid.ts) */
  volume?: number;
}

/** 면 하나를 삼각화해 (위치, 삼각형) 추가. 실패하면 false */
export function triangulateFace(
  points: Float64Array,
  loops: readonly (readonly number[])[],
  normal: readonly [number, number, number],
  pos: number[],
  idx: number[],
): boolean {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  // 버릴 축: 법선이 가장 큰 축
  const drop = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
  const u = drop === 0 ? 1 : 0;
  const v = drop === 2 ? 1 : 2;
  const flat: number[] = [];
  const holes: number[] = [];
  const base = pos.length / 3;
  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]!;
    if (li > 0) holes.push(flat.length / 2);
    for (const k of loop) {
      const o = 3 * k;
      flat.push(points[o + u]!, points[o + v]!);
      pos.push(points[o]!, points[o + 1]!, points[o + 2]!);
    }
  }
  const tri = earcut(flat, holes.length ? holes : undefined, 2);
  if (tri.length === 0) {
    pos.length = base * 3;
    return false;
  }
  for (const t of tri) idx.push(base + t);
  return true;
}

interface FaceGroup {
  mat: MatKey;
  back: MatKey;
  layer: number;
  pos: number[];
  idx: number[];
  faces: number;
  /** 자기 무늬 재질의 무늬 좌표(정점마다 u, v, q) — 앞면·뒷면 */
  uv: number[] | null;
  buv: number[] | null;
  /** 기본 투영 평면 좌표(정점마다 x, y 인치) */
  plane: number[] | null;
  /** 면마다 삼각형 수 */
  ft: number[];
  area: number;
  fa: number[];
  fn: number[];
  nrm: number[] | null;
  smoothed: boolean;
}

/** 면 고리 하나의 넓이(Newell 합을 단위 법선 n에 투영, 첫 정점 기준으로 빼서 큰 좌표에서도 정밀하게) */
function loopArea(points: Float64Array, loop: readonly number[], n: ArrayLike<number>): number {
  const len = loop.length;
  if (len < 3) return 0;
  const o = 3 * loop[0]!;
  const ox = points[o]!;
  const oy = points[o + 1]!;
  const oz = points[o + 2]!;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 1; i < len - 1; i++) {
    const a = 3 * loop[i]!;
    const b = 3 * loop[i + 1]!;
    const ax = points[a]! - ox;
    const ay = points[a + 1]! - oy;
    const az = points[a + 2]! - oz;
    const bx = points[b]! - ox;
    const by = points[b + 1]! - oy;
    const bz = points[b + 2]! - oz;
    sx += ay * bz - az * by;
    sy += az * bx - ax * bz;
    sz += ax * by - ay * bx;
  }
  const d = sx * n[0]! + sy * n[1]! + sz * n[2]!;
  return Math.abs(n[0] || n[1] || n[2] ? d : Math.hypot(sx, sy, sz)) / 2;
}

/** 원근 무늬 면이 없으면 (u, v, q) 무늬 좌표를 (u, v) 2값으로 줄인다 */
function compactUv(src: number[]): { uv: Float32Array; stride: 2 | 3 } {
  let q = false;
  for (let i = 2; i < src.length && !q; i += 3) q = src[i] !== 1;
  if (q) return { uv: Float32Array.from(src), stride: 3 };
  const uv = new Float32Array((src.length / 3) * 2);
  for (let i = 0, o = 0; i < src.length; i += 3, o += 2) {
    uv[o] = src[i]!;
    uv[o + 1] = src[i + 1]!;
  }
  return { uv, stride: 2 };
}

/** idx[from…] 삼각형들의 감김이 법선 n 쪽에서 보아 시계 방향인지(넓이 벡터 합 · n < 0) */
function windingAgainst(pos: readonly number[], idx: readonly number[], from: number, n: ArrayLike<number>): boolean {
  let s = 0;
  for (let t = from; t + 2 < idx.length; t += 3) {
    const a = 3 * idx[t]!;
    const b = 3 * idx[t + 1]!;
    const c = 3 * idx[t + 2]!;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    s += (uy * vz - uz * vy) * n[0]! + (uz * vx - ux * vz) * n[1]! + (ux * vy - uy * vx) * n[2]!;
  }
  return s < 0;
}

/** 면 넓이(바깥 고리 − 구멍, 0 아래로는 내려가지 않는다) */
export function faceArea(points: Float64Array, loops: readonly (readonly number[])[], n: ArrayLike<number>): number {
  let a = 0;
  for (let li = 0; li < loops.length; li++) a += (li ? -1 : 1) * loopArea(points, loops[li]!, n);
  return Math.max(0, a);
}

function prepare(
  ents: SkpEntities,
  defaultLayer: number | undefined,
  counter: { failed: number },
  extras: boolean,
  smooth: boolean,
  onFaces?: (n: number) => void,
  tex?: PrepTex | null,
): Prepared {
  const layerKey = (l: number | undefined): number => (l === undefined || l === defaultLayer ? -1 : l);
  const groups = new Map<string, FaceGroup>();
  const hidden = new Map<string, FaceGroup>();
  const cn = smooth ? cornerNormals(ents) : null;
  const fu = new Float64Array(3);
  let k = 0;
  let failedHere = 0;
  for (let fi = 0; fi < ents.faces.length; fi++) {
    const f = ents.faces[fi]!;
    if (onFaces && ++k % 2048 === 0) onFaces(2048);
    const isHidden = (f.flags & FLAG_HIDDEN) !== 0;
    if (isHidden && !extras) continue;
    const mat: MatKey = f.front !== undefined ? f.front : -1;
    const back: MatKey = f.back !== undefined ? f.back : -1;
    const layer = layerKey(f.layer);
    const key = `${mat}|${back}|${layer}`;
    const map = isHidden ? hidden : groups;
    let g = map.get(key);
    if (!g) {
      const own = tex && mat >= 0 ? tex.tile(mat) : undefined;
      const ownBack = tex && back >= 0 ? tex.tile(back) : undefined;
      map.set(
        key,
        (g = {
          mat,
          back,
          layer,
          pos: [],
          idx: [],
          faces: 0,
          area: 0,
          fa: [],
          fn: [],
          nrm: smooth ? [] : null,
          smoothed: false,
          uv: own ? [] : null,
          buv: ownBack ? [] : null,
          plane: tex?.plane && (mat < 0 || back < 0) ? [] : null,
          ft: [],
        }),
      );
    }
    const before = g.pos.length;
    const tri0 = g.idx.length;
    if (!triangulateFace(ents.points, f.loops, f.normal, g.pos, g.idx)) {
      if (!isHidden) counter.failed++;
      failedHere++;
      continue;
    }
    g.faces++;
    g.ft.push((g.idx.length - tri0) / 3);
    faceUnitNormal(f.normal, fu, 0);
    // 삼각형 감김을 면 법선 쪽에서 반시계로(코어가 시계 방향으로 보이는 쪽을 뒷면으로 칠한다). earcut은 한 면의 삼각형을 같은 방향으로 내므로 합으로 본다
    if (windingAgainst(g.pos, g.idx, tri0, fu)) for (let t = tri0; t < g.idx.length; t += 3) [g.idx[t + 1], g.idx[t + 2]] = [g.idx[t + 2]!, g.idx[t + 1]!];
    const area = faceArea(ents.points, f.loops, fu);
    g.area += area;
    g.fa.push(area);
    g.fn.push(fu[0]!, fu[1]!, fu[2]!);
    if (g.nrm) {
      // 꼭짓점 법선: 이어 칠하는 면이면 무리 평균, 아니면 면 법선
      const corners = (g.pos.length - before) / 3;
      const ci = cn ? cn.faceIndex[fi]! : -1;
      if (ci >= 0) {
        const s = 3 * cn!.start[ci]!;
        for (let c = 0; c < 3 * corners; c++) g.nrm.push(cn!.normals[s + c]!);
        g.smoothed = true;
      } else for (let c = 0; c < corners; c++) g.nrm.push(fu[0]!, fu[1]!, fu[2]!);
    }
    // 무늬 좌표: 자기 무늬 재질이면 저장된 투영(없으면 기본), 물려받을 수 있으면 기본 투영 평면 좌표(인치)
    const v0 = before / 3;
    const nv = (g.pos.length - before) / 3;
    if (g.uv) {
      const t = tex!.tile(mat)!;
      const r = faceUvq(f.normal, f.frontMap, t.w, t.h);
      if (r.singular) tex!.singular++;
      if (applyFaceUvq(r.m, g.pos, v0, nv, g.uv).flat) tex!.flat++;
    }
    if (g.buv) {
      const t = tex!.tile(back)!;
      const r = faceUvq(f.normal, f.backMap, t.w, t.h);
      if (r.singular) tex!.singular++;
      if (applyFaceUvq(r.m, g.pos, v0, nv, g.buv).flat) tex!.flat++;
    }
    if (g.plane) {
      const [x, y] = planeAxes(f.normal);
      for (let i = before; i < g.pos.length; i += 3) {
        const px = g.pos[i]!, py = g.pos[i + 1]!, pz = g.pos[i + 2]!;
        g.plane.push(px * x[0] + py * x[1] + pz * x[2], px * y[0] + py * y[1] + pz * y[2]);
      }
    }
  }
  if (onFaces && k % 2048) onFaces(k % 2048);
  const toBatches = (m: Map<string, FaceGroup>): Batch[] => {
    const out: Batch[] = [];
    for (const g of m.values()) {
      if (!g.idx.length) continue;
      const b: Batch = {
        mat: g.mat,
        back: g.back,
        layer: g.layer,
        pos: Float64Array.from(g.pos),
        idx: Uint32Array.from(g.idx),
        faces: g.faces,
        area: g.area,
        fa: Float64Array.from(g.fa),
        fn: Float32Array.from(g.fn),
        ft: Uint32Array.from(g.ft),
      };
      if (g.nrm) {
        b.nrm = Float32Array.from(g.nrm);
        b.smoothed = g.smoothed;
      }
      if (g.uv) {
        const c = compactUv(g.uv);
        b.uv = c.uv;
        b.uvStride = c.stride;
      }
      if (g.buv) {
        const c = compactUv(g.buv);
        b.buv = c.uv;
        b.buvStride = c.stride;
      }
      if (g.plane) b.plane = Float32Array.from(g.plane);
      out.push(b);
    }
    return out;
  };

  // 모서리는 태그마다 모은다. 곡선(호·원·곡선) 모서리면 선분마다 정의 안 곡선 차례를 함께 적는다(화면이 고른 선분의 곡선 전체 길이를 잰다)
  interface LineGroup {
    pos: number[];
    curve: number[] | null;
  }
  const lineGroups = new Map<number, LineGroup>();
  const softGroups = new Map<number, LineGroup>();
  const hiddenLines = new Map<number, LineGroup>();
  const p = ents.points;
  for (const e of ents.edges) {
    let map: Map<number, LineGroup>;
    if (e.flags & FLAG_HIDDEN) {
      if (!extras) continue;
      map = hiddenLines;
    } else if (e.flags & FLAG_SOFT_SMOOTH) {
      if (!extras) continue;
      map = softGroups;
    } else map = lineGroups;
    const layer = layerKey(e.layer);
    let g = map.get(layer);
    if (!g) map.set(layer, (g = { pos: [], curve: null }));
    const k = e.curve !== undefined && e.curve >= 0 ? e.curve : -1;
    if (k >= 0 && !g.curve) g.curve = new Array<number>(g.pos.length / 6).fill(-1);
    g.curve?.push(k);
    g.pos.push(p[3 * e.a]!, p[3 * e.a + 1]!, p[3 * e.a + 2]!, p[3 * e.b]!, p[3 * e.b + 1]!, p[3 * e.b + 2]!);
  }
  const batchOf = (layer: number, g: LineGroup, cls: LineCls): LineBatch => {
    const l: LineBatch = { layer, pos: Float64Array.from(g.pos), cls };
    if (g.curve) l.curve = Int32Array.from(g.curve);
    return l;
  };
  const lines: LineBatch[] = [];
  for (const [layer, g] of lineGroups) lines.push(batchOf(layer, g, 0));
  const extraLines: LineBatch[] = [];
  for (const [layer, g] of softGroups) extraLines.push(batchOf(layer, g, 1));
  for (const [layer, g] of hiddenLines) extraLines.push(batchOf(layer, g, 2));
  // 닫힌 입체: 단면에서 잘린 면을 채울 수 있다(삼각화하지 못한 면이 있으면 그물에 틈이 생기므로 빼고)
  const solid = solidInfo(ents);
  const out: Prepared = { batches: toBatches(groups), lines, hiddenBatches: toBatches(hidden), extraLines, closed: solid.closed && !failedHere };
  if (solid.volume !== undefined) out.volume = solid.volume;
  return out;
}

/** 열 우선 4×4 곱 a·b */
export function mul4(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

/** 배치 변환의 3×3 정보: 여인수 행렬 열(= det·M⁻ᵀ, 법선·넓이용), 행렬식, 등각(회전 × 고른 배율)인지와 그 배율² */
interface Linear {
  k: Float64Array;
  det: number;
  conformal: boolean;
  s2: number;
}

function linearOf(m: Float64Array): Linear {
  // 배치마다 부르므로 작은 배열을 만들지 않고 바로 셈한다(scene-annotations.ts cofactor와 같은 식)
  const w = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] !== 0 && Number.isFinite(m[15]) ? m[15]! : 1;
  const ax = m[0]! / w;
  const ay = m[1]! / w;
  const az = m[2]! / w;
  const bx = m[4]! / w;
  const by = m[5]! / w;
  const bz = m[6]! / w;
  const cx = m[8]! / w;
  const cy = m[9]! / w;
  const cz = m[10]! / w;
  const k = new Float64Array(9);
  k[0] = by * cz - bz * cy;
  k[1] = bz * cx - bx * cz;
  k[2] = bx * cy - by * cx;
  k[3] = cy * az - cz * ay;
  k[4] = cz * ax - cx * az;
  k[5] = cx * ay - cy * ax;
  k[6] = ay * bz - az * by;
  k[7] = az * bx - ax * bz;
  k[8] = ax * by - ay * bx;
  const det = ax * k[0]! + ay * k[1]! + az * k[2]!;
  const a = ax * ax + ay * ay + az * az;
  const b = bx * bx + by * by + bz * bz;
  const c = cx * cx + cy * cy + cz * cz;
  const tol = 1e-9 * Math.max(a, b, c);
  const conformal =
    Math.abs(a - b) <= tol &&
    Math.abs(a - c) <= tol &&
    Math.abs(ax * bx + ay * by + az * bz) <= tol &&
    Math.abs(ax * cx + ay * cy + az * cz) <= tol &&
    Math.abs(bx * cx + by * cy + bz * cz) <= tol;
  return { k, det, conformal, s2: (a + b + c) / 3 };
}

/** 묶음의 면 넓이를 배치 변환 뒤로(등각이면 배율²배, 아니면 면마다 |K·n|배) */
function placedArea(b: Batch, L: Linear): number {
  if (L.conformal) return b.area * L.s2;
  const k = L.k;
  let s = 0;
  for (let i = 0; i < b.fa.length; i++) {
    const x = b.fn[3 * i]!;
    const y = b.fn[3 * i + 1]!;
    const z = b.fn[3 * i + 2]!;
    s += b.fa[i]! * Math.hypot(k[0]! * x + k[3]! * y + k[6]! * z, k[1]! * x + k[4]! * y + k[7]! * z, k[2]! * x + k[5]! * y + k[8]! * z);
  }
  return s;
}

/** 태그마다 펼친 뒤 그린 면·모서리 수(화면 태그 목록용) */
export interface SkpTagStat {
  name: string;
  /** 기본 태그(Layer0·Untagged) */
  default: boolean;
  faces: number;
  edges: number;
  /** 태그 자신의 보임(0x3C8E, 폴더 보임과는 따로) — 모형이 태그 목록을 읽었을 때만 */
  visible?: boolean;
  /** 태그 색(0~1 RGBA, 태그 색 재질의 material.xml) */
  color?: [number, number, number, number];
  /** 든 태그 폴더(meta.tagFolders 차례) */
  folder?: number;
  /** 선 종류 이름(실선이면 없음) */
  lineStyle?: string;
  /** 선 종류가 실선이 아니면 true — 그 태그의 모서리 LineSet3d도 점선이다 */
  dashed?: boolean;
}

/** 재질마다 펼친 뒤 그린 면 수와 그 재질의 그물 id(화면 재질 목록용) */
export interface SkpMaterialStat {
  /** 표시 이름(material.xml의 원래 이름), 재질이 없으면 '기본 재질' */
  name: string;
  /** model.dat의 재질 이름(= 꾸러미의 materials/<폴더> 이름). 재질이 없으면 없다 */
  folder?: string;
  color: [number, number, number, number];
  /** 무늬(텍스처) 재질이면 true — 색은 무늬 평균색 */
  textured: boolean;
  /** 3D에 무늬 그림을 입힌 그물이 있으면 그 무늬 id(Scene3d.textures) */
  texture?: string;
  faces: number;
  /** 이 재질을 뒷면에 칠한 면 수(앞면 재질이 다른 면 — 있을 때만) */
  backFaces?: number;
  /** 그린 면 넓이 합(세계, 장면 단위²) */
  area: number;
  meshIds: string[];
}

/** 모형 바로 아래 그룹·컴포넌트 하나(outline 선택일 때) */
export interface SkpOutlineEntry {
  /** 인스턴스 이름, 없으면 정의 이름 */
  name: string;
  /** loose = 그룹·컴포넌트 밖, 모형에 바로 놓인 면·모서리 */
  kind: 'group' | 'component' | 'image' | 'loose';
  /** 컴포넌트 정의 이름 */
  definition?: string;
  /** 인스턴스의 태그 이름 */
  tag: string;
  faces: number;
  edges: number;
  /** 안쪽까지 그린 보통 면 넓이 합(세계, 장면 단위²) */
  area: number;
  /** 이 항목(안쪽 포함)만 담은 그물·모서리 묶음 id */
  ids: string[];
  /** meta.tree의 노드 차례(나무가 있을 때) */
  node?: number;
}

/**
 * 여러 단계 그룹·컴포넌트 나무(outline 선택일 때 meta.tree). 노드는 넓이 우선 차례라 부모가 먼저 오고,
 * 한 노드의 자식은 firstChild부터 childCount개가 이어진다. 형식 배열이라 워커에서 복사 없이 넘긴다.
 *
 * 항목 차례(item): 그물은 scene.meshes 차례, 모서리는 meshes.length + scene.lines 차례.
 */
export interface SkpTree {
  count: number;
  /** 부모 노드(-1 = 모형 바로 아래) */
  parent: Int32Array;
  /** 단계(1 = 모형 바로 아래) */
  depth: Uint8Array;
  /** 0 그룹 · 1 컴포넌트 · 2 그림 */
  kind: Uint8Array;
  /** TREE_HIDDEN · TREE_MORE */
  flags: Uint8Array;
  /** 인스턴스 이름('' = 이름 없음 → 화면은 정의 이름을 쓴다) */
  names: string[];
  /** definitionNames 차례 */
  definition: Int32Array;
  definitionNames: string[];
  /** 인스턴스 자기 태그(없거나 기본이면 기본 태그) — tagNames 차례 */
  tag: Int32Array;
  tagNames: string[];
  /** 안쪽까지 펼친 뒤 그린(보통) 면·모서리 수 */
  faces: Uint32Array;
  edges: Uint32Array;
  /** 첫 자식 노드(-1 = 없음)와 자식 수 */
  firstChild: Int32Array;
  childCount: Uint32Array;
  /** 모형 바로 아래 노드 수(노드 0부터) */
  rootCount: number;
  /** 따로 나눈 노드면 안쪽까지의 그물 범위 [meshFirst, meshEnd)·모서리 범위(scene.lines 차례), 아니면 -1 */
  meshFirst: Int32Array;
  meshEnd: Int32Array;
  lineFirst: Int32Array;
  lineEnd: Int32Array;
  /** 노드 안쪽 전부의 구간 범위 [runFirst, runEnd) */
  runFirst: Uint32Array;
  runEnd: Uint32Array;
  /** 구간: 항목 차례·그 항목 안 시작(삼각형 또는 선분 차례)·그것을 낸 가장 안쪽 노드(-1 = 모형에 바로 놓인 형상) */
  runItem: Uint32Array;
  runStart: Uint32Array;
  runNode: Int32Array;
  /** 구간이 한도를 넘어 버렸으면 true(이때 run 배열은 비었다) */
  runsDropped: boolean;
  /** 항목마다 그것을 따로 가진 노드(-1 = 모형에 바로 놓인 형상) */
  itemOwner: Int32Array;
  /** 따로 나눈 가장 깊은 단계(0 = 나누지 않음) */
  splitDepth: number;
  /** 목록에 넣은 가장 깊은 단계 */
  listedDepth: number;
  /** 노드 한도로 더 깊은 단계를 넣지 않았는지 */
  unlisted: boolean;
}

/** 부드러운·숨긴 형상 항목(extras 선택일 때 meta.extraItems) */
export interface SkpExtraItems {
  soft: string[];
  hidden: string[];
  softSegments: number;
  hiddenFaces: number;
  hiddenSegments: number;
}

export interface BuildOptions {
  /** 그룹·컴포넌트마다 그물·모서리를 나누고 outline·나무를 적는다(기본 false — 나누지 않으면 그리기 호출이 적다) */
  outline?: boolean;
  /** 나눌 윗단계 인스턴스 수 한도(넘으면 나누지 않고 outlineSkipped에 수를 적는다) */
  maxOutline?: number;
  /** 깊은 단계 나누기의 항목 수 어림 한도 */
  maxSplitItems?: number;
  /** 나무 노드 수 한도 */
  maxTreeNodes?: number;
  /** 구간 수 한도 */
  maxTreeRuns?: number;
  /** 단면 채우기 묶음을 나눌 때 상자 비교 수 한도(기본 MAX_CAP_TESTS — 시험용) */
  maxCapTests?: number;
  /** 부드러운 모서리·숨긴 형상을 따로 묶어 낸다(기본 false) */
  extras?: boolean;
  /** 인스턴스 배치 수 한도 */
  maxPlacements?: number;
  /** 매끈한 모서리로 이어진 면의 꼭짓점 법선을 평균해 Mesh3d.normals로 낸다(기본 false — 끄면 예전과 같다) */
  smooth?: boolean;
  /** 주석(문자·치수·보조선·단면)을 펼친다(기본 true, 모형에 주석이 없으면 출력이 같다) */
  annotations?: boolean;
  /** 재질 없는 면의 색(기본 DEFAULT_FACE_COLOR) — 모형 스타일의 앞면 색을 넘긴다 */
  defaultFaceColor?: Rgba;
  /**
   * 재질 없는 뒷면의 색(모형 스타일의 뒷면 색). 주면 앞·뒤 재질이 다른 면을 따로 모아 그물에 뒷면 색·무늬(backColor·backTexture·backUvs)를 단다.
   * 없으면 재질 없는 뒷면은 앞면과 같은 색으로 둔다
   */
  defaultBackColor?: Rgba;
  /** 모서리 색(기본 EDGE_COLOR) — 모형 스타일의 모서리 색(ForegroundColor, SketchUp 스타일 "모서리 색: 모두 같게")을 넘긴다 */
  edgeColor?: Rgba;
  /** 큰 좌표 기준(장면 단위). 기본은 LARGE_COORD_INCH × scale(= 100 m). Infinity면 origin을 쓰지 않는다 */
  originThreshold?: number;
  /** 무늬를 입힐 재질(model.dat 재질 번호 → 무늬 id·한 장 크기). 없으면 무늬 좌표를 만들지 않는다 */
  textures?: ReadonlyMap<number, SceneTexture>;
  /** 무늬 좌표를 다는 정점 수 한도 */
  maxUvVertices?: number;
  /** 진행 알림(0~1) */
  onProgress?: (fraction: number) => void;
}

export interface SceneParts {
  meshes: Mesh3d[];
  lines: LineSet3d[];
  bounds?: Box3;
  warnings: string[];
  stats: { triangles: number; segments: number; placements: number };
  /** 태그별 통계(모형의 태그 차례, 그릴 것이 없는 태그도 넣는다) */
  tags: SkpTagStat[];
  /** 재질별 통계(그린 면이 있는 재질만, 처음 나온 차례) */
  materials: SkpMaterialStat[];
  /** outline 선택일 때 윗단계 항목(첫 항목은 loose — 그릴 것이 있을 때만) */
  outline?: SkpOutlineEntry[];
  /** outline을 원했지만 윗단계 인스턴스가 한도보다 많아 나누지 않았으면 그 수 */
  outlineSkipped?: number;
  /** outline 선택일 때 여러 단계 나무 */
  tree?: SkpTree;
  /** extras 선택일 때 부드러운·숨긴 형상 항목 */
  extras?: SkpExtraItems;
  /** 출력 한도에 걸려 일부만 그렸는지 */
  limited?: boolean;
  /** 보조점(PointSet3d) */
  points: PointSet3d[];
  /**
   * 그물마다(meshes 차례) 면 경계: 면 k의 삼각형은 [runs[k], runs[k + 1])(마지막 면은 그물 끝까지). 면마다 삼각형을 이어 붙이므로
   * 고른 삼각형이 든 SketchUp 면 하나를 구간으로 찾는다(화면의 면 넓이·강조)
   */
  faceRuns: Uint32Array[];
  /** 모서리 묶음마다(lines 차례) 선분의 놓인 곡선 번호(-1 = 곡선 아님, 같은 수 = 같은 곡선의 한 배치). 곡선이 없는 묶음은 null, 곡선이 하나도 없으면 없다 */
  segmentCurves?: (Int32Array | null)[];
  /** 주석(모형에 주석이 있을 때만): meta.texts·dimensions·sectionPlanes·annotationItems 꼴 */
  texts?: SkpTextMeta[];
  dimensions?: SkpDimensionMeta[];
  sectionPlanes?: SkpSectionPlaneMeta[];
  annotationItems?: SkpAnnotationItems;
  /** 주석 선분 묶음마다 나무 노드 구간(meta.annotationRuns 꼴 — 나무가 있고 그룹·컴포넌트 안 주석이 있을 때만) */
  annotationRuns?: Record<string, { start: Uint32Array; node: Int32Array }>;
  /** sectionPlanes 차례마다 단면 영구 번호(장면의 활성 단면 잇기용) */
  sectionPids?: (number | undefined)[];
  /** 나무 노드·정의의 더 많은 정보(tree가 있을 때) */
  treeInfo?: SkpTreeInfo;
  /** 나무 노드마다 인스턴스 영구 번호(장면의 숨긴 개체 잇기용) */
  nodePids?: (number | undefined)[];
  /** 속성 사전 모음(meta.attributes)과 모형 속성 차례 */
  attributes?: SkpAttrDictsMeta[];
  modelAttrs?: number;
  /** 모형에서 숨겼지만 장면이 다시 보이는 인스턴스 노드와 그 안쪽을 보통 색으로 그린 항목(meta.revealItems) */
  revealItems?: { node: number; ids: string[] }[];
}

/** 넓이 우선으로 모은 나무(펼치기 전) */
interface TreeBuild {
  n: number;
  parent: number[];
  depth: number[];
  inst: SkpInstance[];
  ents: SkpEntities[];
  hidden: boolean[];
  firstChild: number[];
  childCount: number[];
  more: boolean[];
  rootCount: number;
  listedDepth: number;
  unlisted: boolean;
}

/**
 * 중간 모형을 펼친다. scale은 인치 → 장면 단위 배율.
 * materials는 재질 이름 → 정보(material.xml에서 읽은 색).
 */
export function buildSceneParts(model: SkpModel, materials: Map<string, SkpMaterialInfo>, scale = 1, opts: BuildOptions = {}): SceneParts {
  const warnings: string[] = [];
  const counter = { failed: 0 };
  const extras = !!opts.extras;
  const smooth = !!opts.smooth;
  const annotate = opts.annotations !== false;
  const maxPlacements = opts.maxPlacements ?? MAX_PLACEMENTS;
  const defaultColor = opts.defaultFaceColor ?? DEFAULT_FACE_COLOR;
  const defaultBack = opts.defaultBackColor ?? null;
  const edgeColor = opts.edgeColor ?? EDGE_COLOR;

  // ── 진행: 삼각화한 면 수(정의마다 한 번)와 펼친 배치 수의 반반 ──
  const totalFaces = Math.max(1, model.counts.faces);
  let facesDone = 0;
  let placementsTotal = 1;
  let lastProgress = 0;
  let placements = 0;
  const report = (placementsNow: number): void => {
    if (!opts.onProgress) return;
    const f = 0.5 * Math.min(1, facesDone / totalFaces) + 0.5 * Math.min(1, placementsNow / placementsTotal);
    if (f < lastProgress + 0.005) return;
    lastProgress = f;
    try {
      opts.onProgress(f);
    } catch {
      /* 알림 쪽 오류는 무시 */
    }
  };
  const onFaces = opts.onProgress
    ? (n: number): void => {
        facesDone += n;
        report(placements);
      }
    : undefined;

  // 무늬: 물려받을 무늬 재질(인스턴스 재질)이 하나라도 있을 때만 정의마다 평면 좌표를 구해 둔다
  const texMap = opts.textures && opts.textures.size ? opts.textures : null;
  let prepTex: PrepTex | null = null;
  if (texMap) {
    let inherits = false;
    const scan = (e: SkpEntities): void => {
      for (const inst of e.instances) if (inst.material !== undefined && texMap.has(inst.material)) inherits = true;
    };
    scan(model.root);
    for (const d of model.definitions.values()) if (!inherits) scan(d.entities);
    prepTex = { tile: (m) => texMap.get(m), plane: inherits, flat: 0, singular: 0 };
  }
  const maxUv = opts.maxUvVertices ?? MAX_UV_VERTICES;
  let uvVerts = 0;
  let uvLimited = false;

  const cache = new Map<SkpEntities, Prepared>();
  const prep = (e: SkpEntities): Prepared => {
    let p = cache.get(e);
    if (!p) cache.set(e, (p = prepare(e, model.defaultLayer, counter, extras, smooth, onFaces, prepTex)));
    return p;
  };

  const colorOf = (id: number | undefined): Rgba => {
    if (id === undefined) return defaultColor;
    const name = model.materials.get(id);
    const info = name !== undefined ? materials.get(name) : undefined;
    return info ? info.color : DEFAULT_FACE_COLOR;
  };
  const layerName = (id: number): string =>
    model.layers.get(id) ?? (model.defaultLayer !== undefined ? model.layers.get(model.defaultLayer) : undefined) ?? 'Layer0';
  const defaultTagName = (model.defaultLayer !== undefined ? model.layers.get(model.defaultLayer) : undefined) ?? 'Layer0';

  /** 펼칠 자식 인스턴스(emit과 같은 거르기·차례). anc: 조상(자기 포함) 요소 묶음 */
  const validChildren = (ents: SkpEntities, anc: Set<SkpEntities>, depth: number): { inst: SkpInstance; ents: SkpEntities }[] => {
    const out: { inst: SkpInstance; ents: SkpEntities }[] = [];
    if (depth >= MAX_DEPTH) return out;
    for (const inst of ents.instances) {
      if (inst.flags & FLAG_HIDDEN && !extras) continue;
      const def = model.definitions.get(inst.definition);
      if (!def || anc.has(def.entities)) continue;
      out.push({ inst, ents: def.entities });
    }
    return out;
  };

  // 진행 어림용 전체 배치 수(정의마다 한 번 세어 곱한다, 순환은 0으로)
  if (opts.onProgress) {
    const memo = new Map<SkpEntities, number>();
    const visiting = new Set<SkpEntities>();
    const count = (e: SkpEntities): number => {
      const m = memo.get(e);
      if (m !== undefined) return m;
      if (visiting.has(e)) return 0;
      visiting.add(e);
      let c = 0;
      for (const inst of e.instances) {
        if (inst.flags & FLAG_HIDDEN && !extras) continue;
        const def = model.definitions.get(inst.definition);
        if (def && def.entities !== e) c += 1 + count(def.entities);
        if (c > maxPlacements) break;
      }
      visiting.delete(e);
      memo.set(e, c);
      return c;
    };
    placementsTotal = Math.max(1, Math.min(maxPlacements, 1 + count(model.root)));
  }

  // ── 나무(넓이 우선, 단계 단위로 노드 한도까지) ──
  let tb: TreeBuild | null = null;
  let visibleTop = 0;
  if (opts.outline) {
    for (const c of validChildren(model.root, new Set([model.root]), 0)) if (!(c.inst.flags & FLAG_HIDDEN)) visibleTop++;
    const maxNodes = opts.maxTreeNodes ?? MAX_TREE_NODES;
    const t: TreeBuild = {
      n: 0,
      parent: [],
      depth: [],
      inst: [],
      ents: [],
      hidden: [],
      firstChild: [],
      childCount: [],
      more: [],
      rootCount: 0,
      listedDepth: 0,
      unlisted: false,
    };
    const ancOf = (i: number): Set<SkpEntities> => {
      const s = new Set<SkpEntities>([model.root]);
      for (let k = i; k >= 0; k = t.parent[k]!) s.add(t.ents[k]!);
      return s;
    };
    let level: number[] = [-1];
    for (let d = 0; level.length; d++) {
      const next: { p: number; inst: SkpInstance; ents: SkpEntities }[] = [];
      const kids = new Map<number, number>();
      for (const p of level) {
        const ents = p < 0 ? model.root : t.ents[p]!;
        const ch = validChildren(ents, ancOf(p), d);
        kids.set(p, ch.length);
        for (const c of ch) next.push({ p, inst: c.inst, ents: c.ents });
      }
      if (!next.length) break;
      if (t.n + next.length > maxNodes) {
        t.unlisted = true;
        for (const p of level) if (p >= 0 && (kids.get(p) ?? 0) > 0) t.more[p] = true;
        break;
      }
      const added: number[] = [];
      for (const c of next) {
        const i = t.n++;
        t.parent.push(c.p);
        t.depth.push(d + 1);
        t.inst.push(c.inst);
        t.ents.push(c.ents);
        t.hidden.push((c.p >= 0 && t.hidden[c.p]!) || (c.inst.flags & FLAG_HIDDEN) !== 0);
        t.firstChild.push(-1);
        t.childCount.push(0);
        t.more.push(false);
        if (c.p >= 0) {
          if (t.firstChild[c.p]! < 0) t.firstChild[c.p] = i;
          t.childCount[c.p]!++;
        } else t.rootCount++;
        added.push(i);
      }
      t.listedDepth = d + 1;
      level = added;
    }
    if (t.n > 0) tb = t;
  }

  // ── 나눌 단계 정하기 ──
  let splitDepth = 0;
  let outlineSkipped = 0;
  if (opts.outline) {
    if (visibleTop > (opts.maxOutline ?? MAX_OUTLINE_ENTRIES)) outlineSkipped = visibleTop;
    else if (tb) {
      const t = tb;
      splitDepth = 1;
      const budget = opts.maxSplitItems ?? MAX_SPLIT_ITEMS;
      const own = (e: SkpEntities): number => {
        const p = prep(e);
        return p.batches.length + p.lines.length + p.hiddenBatches.length + p.extraLines.length;
      };
      const subMemo = new Map<SkpEntities, Set<string>>();
      const visiting = new Set<SkpEntities>();
      const subKeys = (e: SkpEntities): Set<string> => {
        const m = subMemo.get(e);
        if (m) return m;
        const s = new Set<string>();
        if (visiting.has(e)) return s;
        visiting.add(e);
        const p = prep(e);
        for (const b of p.batches) s.add(`f${b.mat}|${b.layer}${p.closed ? 'c' : ''}`);
        for (const b of p.hiddenBatches) s.add(`h${b.mat}|${b.layer}`);
        for (const l of p.lines) s.add(`l${l.layer}`);
        for (const l of p.extraLines) s.add(`x${l.cls}|${l.layer}`);
        for (const inst of e.instances) {
          if (s.size > 512) break;
          if (inst.flags & FLAG_HIDDEN && !extras) continue;
          const def = model.definitions.get(inst.definition);
          if (def && def.entities !== e) for (const k of subKeys(def.entities)) s.add(k);
        }
        visiting.delete(e);
        subMemo.set(e, s);
        return s;
      };
      const rootOwn = own(model.root);
      const itemsAt = (D: number): number => {
        let items = rootOwn;
        for (let i = 0; i < t.n; i++) {
          const d = t.depth[i]!;
          if (d < D) items += own(t.ents[i]!);
          else if (d === D) items += subKeys(t.ents[i]!).size;
          else break;
          if (items > budget) break;
        }
        return items;
      };
      for (let D = 2; D <= t.listedDepth; D++) {
        if (itemsAt(D) > budget) break;
        splitDepth = D;
      }
    } else if (visibleTop > 0) outlineSkipped = visibleTop;
  }

  // ── 단계보다 깊어도 따로 나눌 노드: 단면 평면이 든 그룹·컴포넌트, "항상 카메라 보기" 컴포넌트(한도 안에서 넓이 우선 차례) ──
  const forced = new Set<number>();
  if (tb && splitDepth >= 1)
    for (let i = 0; i < tb.n && forced.size < MAX_FORCED_SPLITS; i++) {
      if (tb.depth[i]! <= splitDepth || tb.hidden[i]) continue;
      const ents = tb.ents[i]!;
      if (ents.sections?.length || model.definitions.get(tb.inst[i]!.definition)?.behavior?.alwaysFaceCamera) forced.add(i);
    }

  /** 무늬 좌표를 쌓는 곳(앞면은 묶음 자신, 뒷면은 bk.back) */
  interface UvSink {
    /** 무늬 재질이면 무늬 좌표(정점마다 uvStride값). 한도에 걸리면 null로 버린다 */
    uv: F32 | null;
    uvStride: 2 | 3;
  }
  /** 앞과 다른 뒷면: 뒷면 재질(undefined = 스타일 뒷면 색)과 그 무늬 좌표 */
  interface BackSide extends UvSink {
    mat: number | undefined;
  }
  interface Bucket extends UvSink {
    serial: number;
    slot: number;
    /** 0 보통 · 1 숨긴 면 */
    cls: number;
    layer: number;
    mat: number | undefined;
    pos: F32;
    idx: U32;
    faces: number;
    /** 면 넓이 합(세계, 장면 단위²) */
    area: number;
    /** 꼭짓점 법선(이어 칠한 면이 처음 들어올 때 만든다) */
    nrm?: F32;
    /** 큰 좌표면 묶음 원점(처음 넣을 때 정한다, null = 원점 없음) */
    origin?: [number, number, number] | null;
    /** 면마다 첫 삼각형 차례(SketchUp 면 하나 = 이어진 삼각형 구간) */
    fs: U32;
    /** 닫힌 입체 배치만 모은 묶음(단면 채우기 묶음 capGroup = 칸마다 하나, 겹치는 입체는 cap번째 묶음) */
    closed: boolean;
    /** 칸 안 채우기 묶음 번호(0 = 예전과 같은 skp-solid-<칸>) */
    cap: number;
    /** 앞과 다른 뒷면(없으면 양면이 앞면 재질) */
    back: BackSide | null;
    /** "항상 카메라 보기" 배치(그 배치만 모은 묶음 — 코어 billboard) */
    bb: Billboard | null;
  }
  /** 카메라를 보는 컴포넌트 배치: 묶음 열쇠 꼬리, 세계 원점(Z축 둘레로 돈다)과 저장된 앞 방향(컴포넌트 −Y) */
  interface Billboard {
    key: string;
    origin: [number, number, number];
    front: [number, number, number];
    /** 그 배치의 보통 모서리(세계 좌표, 태그마다 — 같은 태그의 첫 그물, 없으면 첫 그물의 윤곽선으로 함께 돌린다) */
    edges: Map<number, number[]>;
  }
  interface LineBucket {
    serial: number;
    slot: number;
    cls: LineCls;
    layer: number;
    pos: F32;
    origin?: [number, number, number] | null;
    /** 선분마다 놓인 곡선 번호(-1 = 곡선 아님) — 곡선 선분이 처음 들어올 때 만든다 */
    curves: I32 | null;
  }
  const originLimit = opts.originThreshold ?? LARGE_COORD_INCH * Math.abs(scale);
  const cellSize = originLimit * 10;
  /** 덧붙일 형상의 첫 정점(변환 뒤)이 멀면 그 점을 반올림한 원점과 칸 열쇠, 가까우면 null */
  const farCell = (src: Float64Array, m: Float64Array): { key: string; origin: [number, number, number] } | null => {
    if (!(originLimit < Infinity) || src.length < 3) return null;
    const x = src[0]!;
    const y = src[1]!;
    const z = src[2]!;
    let w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (!w) w = 1;
    const X = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
    const Y = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
    const Z = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
    if (!(Math.max(Math.abs(X), Math.abs(Y), Math.abs(Z)) > originLimit)) return null;
    return { key: `@${Math.round(X / cellSize)},${Math.round(Y / cellSize)},${Math.round(Z / cellSize)}`, origin: [Math.round(X), Math.round(Y), Math.round(Z)] };
  };
  const buckets = new Map<string, Bucket>();
  const lineBuckets = new Map<string, LineBucket>();
  let serials = 0;

  // 칸(slot): 0은 모형에 바로 놓인 형상, 나눈 노드는 깊이 우선 앞차례로 1부터 → 노드 안쪽의 칸은 [slot, slotEnd)로 이어진다
  const T = tb;
  const nodeSlot = T ? new Int32Array(T.n).fill(-1) : null;
  const nodeSlotEnd = T ? new Int32Array(T.n).fill(-1) : null;
  const slotNode: number[] = [-1];
  const runFirst = T ? new Uint32Array(T.n) : null;
  const runEnd = T ? new Uint32Array(T.n) : null;
  const ownFaces = T ? new Float64Array(T.n) : null;
  const ownEdges = T ? new Float64Array(T.n) : null;
  const ownArea = T ? new Float64Array(T.n) : null;
  // "항상 카메라 보기" 배치
  let billboards = 0;
  let billboardsSkipped = 0;
  const billboardList: Billboard[] = [];
  /** 그물 윤곽선으로 옮긴 모서리 수(태그마다 — 태그 통계) */
  const bbEdgeCount = new Map<string, number>();
  /** 배치의 앞 방향: 컴포넌트 −Y(SketchUp 앞 뷰에서 보이는 쪽)를 세계로 옮겨 수평으로 */
  const frontOf = (m: Float64Array): [number, number, number] => {
    const x = -m[4]!;
    const y = -m[5]!;
    const l = Math.hypot(x, y);
    return l > 1e-12 ? [x / l, y / l, 0] : [0, -1, 0];
  };
  /** 노드마다 SketchUp 입체면 부피(장면 단위³ — 정의 부피 × 배치 변환 행렬식), 아니면 NaN */
  const nodeVolume = T ? new Float64Array(T.n).fill(NaN) : null;
  const runItem = new U32(T ? 4096 : 1);
  const runStart = new U32(T ? 4096 : 1);
  const runNode1 = new U32(T ? 4096 : 1);
  const maxRuns = opts.maxTreeRuns ?? MAX_TREE_RUNS;
  let runsDropped = false;
  let lastRunSerial = -1;
  let lastRunNode = -2;
  const addRun = (serial: number, start: number, node: number): void => {
    // REVEAL_NODE: 장면이 다시 보이는 숨김 인스턴스의 두 번째 그림 — 나무 구간에 넣지 않는다(고르기는 그 항목 그대로)
    if (!T || runsDropped || node < -1) return;
    if (serial === lastRunSerial && node === lastRunNode) return;
    if (runItem.n >= maxRuns) {
      runsDropped = true;
      return;
    }
    runItem.push(serial);
    runStart.push(start);
    runNode1.push(node + 1);
    lastRunSerial = serial;
    lastRunNode = node;
  };

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let outVerts = 0;
  let outSegs = 0;
  let extraVerts = 0;
  let extraSegs = 0;
  let truncated = false;
  let linesTruncated = false;
  let extrasTruncated = false;
  let placementsStopped = false;
  let missingDefs = 0;
  let cycles = 0;

  // ── 단면 채우기 묶음 나누기: 칸마다 묶음별 범위 상자 모음(겹치는 닫힌 입체 배치는 다른 묶음) ──
  const localBoxes = new Map<Prepared, Float64Array>();
  /** 배치의 세계 범위 상자(정의의 보통 면 범위 상자 여덟 구석을 옮긴 것 — 돌린 배치는 조금 넉넉하다) */
  const placedBox = (p: Prepared, m: Float64Array): Float64Array => {
    let lb = localBoxes.get(p);
    if (!lb) {
      lb = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      for (const b of p.batches)
        for (let i = 0; i < b.pos.length; i += 3)
          for (let k = 0; k < 3; k++) {
            const v = b.pos[i + k]!;
            if (v < lb[k]!) lb[k] = v;
            if (v > lb[3 + k]!) lb[3 + k] = v;
          }
      localBoxes.set(p, lb);
    }
    const out = Float64Array.from([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (let c = 0; c < 8; c++) {
      const x = lb[c & 1 ? 3 : 0]!, y = lb[c & 2 ? 4 : 1]!, z = lb[c & 4 ? 5 : 2]!;
      let w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (!w) w = 1;
      const X = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
      const Y = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
      const Z = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w;
      for (const [k, v] of [X, Y, Z].entries()) {
        if (v < out[k]!) out[k] = v;
        if (v > out[3 + k]!) out[3 + k] = v;
      }
    }
    return out;
  };
  const capSets = new Map<number, BoxSet[]>();
  const capBudget = { left: opts.maxCapTests ?? MAX_CAP_TESTS };
  /** 닫힌 입체 배치의 채우기 묶음 번호: 범위 상자가 겹치지 않는 첫 묶음(없거나 비교 한도를 넘으면 0 — 예전과 같다) */
  const capOf = (slot: number, box: Float64Array): number => {
    if (!box.every(Number.isFinite)) return 0;
    let sets = capSets.get(slot);
    if (!sets) capSets.set(slot, (sets = []));
    for (let g = 0; g < MAX_CAP_SPLITS; g++) {
      const set = sets[g] ?? (sets[g] = new BoxSet());
      const hit = set.size ? set.overlaps(box, capBudget) : false;
      if (hit === null) return 0;
      if (!hit) {
        set.add(box);
        return g;
      }
    }
    sets[0]!.add(box);
    return 0;
  };

  const put = (dst: F32, src: Float64Array, m: Float64Array, bounds: boolean, origin?: [number, number, number] | null): void => {
    dst.reserve(src.length);
    const a = dst.a;
    let n = dst.n;
    const affine = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
    const ox = origin ? origin[0] : 0;
    const oy = origin ? origin[1] : 0;
    const oz = origin ? origin[2] : 0;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]!;
      const y = src[i + 1]!;
      const z = src[i + 2]!;
      let X = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      let Y = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      let Z = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      if (!affine) {
        const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
        if (w !== 0) {
          X /= w;
          Y /= w;
          Z /= w;
        }
      }
      // 원점은 double로 뺀 뒤 float32로 적는다(큰 좌표에서도 묶음 안 상대 좌표는 정밀하게)
      a[n++] = X - ox;
      a[n++] = Y - oy;
      a[n++] = Z - oz;
      if (!bounds) continue;
      if (X < min[0]) min[0] = X;
      if (Y < min[1]) min[1] = Y;
      if (Z < min[2]) min[2] = Z;
      if (X > max[0]) max[0] = X;
      if (Y > max[1]) max[1] = Y;
      if (Z > max[2]) max[2] = Z;
    }
    dst.n = n;
  };

  /**
   * 묶음의 뒷면: 앞면 재질(자기 → 물려받기)과 뒷면 재질(자기 → 물려받기)이 같으면 null(양면이 앞면 재질 — 뒷면 재질이 없는데 스타일 뒷면 색을 모를 때도),
   * 다르면 뒷면 재질(undefined = 스타일 뒷면 색)
   */
  const sideBack = (b: Batch, inhMat: number | undefined): number | undefined | null => {
    const front = b.mat >= 0 ? b.mat : inhMat;
    const back = b.back >= 0 ? b.back : inhMat;
    // 재질 없는 뒷면인데 스타일 뒷면 색을 모르면 앞면과 같게
    if (back === undefined && !defaultBack) return null;
    return front === back && front !== undefined ? null : back;
  };
  /** back: 앞과 다른 뒷면 재질(undefined = 스타일 뒷면 색), null = 뒷면도 앞면 재질 */
  const newBack = (back: number | undefined | null): BackSide | null =>
    back === null ? null : { mat: back, uv: back !== undefined && texMap?.has(back) ? new F32() : null, uvStride: 2 };
  const faceBucket = (
    slot: number,
    cls: number,
    layer: number,
    mat: number | undefined,
    far: ReturnType<typeof farCell>,
    closed: boolean,
    // 기본값을 두지 않는다: undefined(스타일 뒷면 색)를 넘기면 기본값 null로 바뀌기 때문
    back: number | undefined | null,
    bb: Billboard | null = null,
    cap = 0,
  ): Bucket => {
    // 보통(가까운) 형상의 열쇠는 예전과 같다(기본 호출 출력이 바뀌지 않게). 닫힌 입체는 따로(|c), 앞과 다른 뒷면은 그 재질(|b),
    // 카메라를 보는 배치는 배치마다(|bb), 먼 형상은 칸 열쇠를 붙인다
    const key =
      (cls ? `${slot}|h|${layer}|${mat ?? 'd'}` : `${slot}|${layer}|${mat ?? 'd'}`) +
      (closed ? (cap ? `|c${cap}` : '|c') : '') +
      (back !== null ? `|b${back ?? 'd'}` : '') +
      (bb ? bb.key : '') +
      (far ? far.key : '');
    let bk = buckets.get(key);
    if (!bk)
      buckets.set(
        key,
        (bk = {
          serial: serials++,
          slot,
          cls,
          layer,
          mat,
          pos: new F32(),
          idx: new U32(),
          faces: 0,
          area: 0,
          origin: far ? far.origin : null,
          uv: mat !== undefined && texMap?.has(mat) ? new F32() : null,
          uvStride: 2,
          fs: new U32(64),
          closed,
          cap: closed ? cap : 0,
          back: newBack(back),
          bb,
        }),
      );
    return bk;
  };
  const lineBucket = (slot: number, cls: LineCls, layer: number, far: ReturnType<typeof farCell>): LineBucket => {
    const key = (cls === 0 ? `${slot}|${layer}` : `${slot}|${cls === 1 ? 's' : 'x'}|${layer}`) + (far ? far.key : '');
    let lb = lineBuckets.get(key);
    if (!lb) lineBuckets.set(key, (lb = { serial: serials++, slot, cls, layer, pos: new F32(), origin: far ? far.origin : null, curves: null }));
    return lb;
  };
  /** 묶음의 무늬 좌표를 3값으로 넓힌다(원근 무늬가 처음 들어올 때, q = 1을 끼운다) */
  const widenUv = (bk: UvSink): void => {
    const old = bk.uv!;
    const nv = old.n / 2;
    const w = new F32();
    w.reserve(nv * 3);
    for (let i = 0; i < nv; i++) {
      w.a[i * 3] = old.a[i * 2]!;
      w.a[i * 3 + 1] = old.a[i * 2 + 1]!;
      w.a[i * 3 + 2] = 1;
    }
    w.n = nv * 3;
    bk.uv = w;
    bk.uvStride = 3;
  };
  /**
   * 무늬 좌표 덧붙이기. src: 자기 재질 무늬 좌표(stride 2·3) 또는 물려받은 재질용 평면 좌표와 무늬 크기 역수(scale).
   * src가 없으면(그럴 일은 없지만) 0으로 채워 정점 수를 맞춘다
   */
  const appendUv = (bk: UvSink, nv: number, src: { arr: Float32Array; stride: 2 | 3; scale?: [number, number] } | null): void => {
    if (!bk.uv) return;
    if (uvVerts + nv > maxUv) {
      // 한도: 이 묶음은 무늬 없이(평균색) 그린다
      bk.uv = null;
      uvLimited = true;
      return;
    }
    uvVerts += nv;
    if (src && src.stride === 3 && bk.uvStride === 2) widenUv(bk);
    const st = bk.uvStride;
    const dst = bk.uv;
    dst.reserve(nv * st);
    let n = dst.n;
    const a = dst.a;
    const sx = src?.scale?.[0] ?? 1, sy = src?.scale?.[1] ?? 1;
    for (let i = 0; i < nv; i++) {
      if (!src) {
        a[n++] = 0;
        a[n++] = 0;
        if (st === 3) a[n++] = 1;
        continue;
      }
      const o = i * src.stride;
      a[n++] = src.arr[o]! * sx;
      a[n++] = src.arr[o + 1]! * sy;
      if (st === 3) a[n++] = src.stride === 3 ? src.arr[o + 2]! : 1;
    }
    dst.n = n;
  };
  /** 이어 칠한 면이 처음 들어온 묶음: 이미 든 정점의 법선을 삼각형에서 채운다(같은 면 정점은 한 평면이라 면 법선과 같다) */
  const backfillNormals = (bk: Bucket, base: number): F32 => {
    const nrm = new F32();
    nrm.reserve(base * 3);
    const a = nrm.a;
    const p = bk.pos.a;
    const ix = bk.idx.a;
    for (let t = 0; t < bk.idx.n; t += 3) {
      const i0 = 3 * ix[t]!;
      const i1 = 3 * ix[t + 1]!;
      const i2 = 3 * ix[t + 2]!;
      const ux = p[i1]! - p[i0]!;
      const uy = p[i1 + 1]! - p[i0 + 1]!;
      const uz = p[i1 + 2]! - p[i0 + 2]!;
      const vx = p[i2]! - p[i0]!;
      const vy = p[i2 + 1]! - p[i0 + 1]!;
      const vz = p[i2 + 2]! - p[i0 + 2]!;
      const x = uy * vz - uz * vy;
      const y = uz * vx - ux * vz;
      const z = ux * vy - uy * vx;
      const l = Math.hypot(x, y, z);
      if (!(l > 0)) continue;
      for (const i of [i0, i1, i2]) {
        a[i] = x / l;
        a[i + 1] = y / l;
        a[i + 2] = z / l;
      }
    }
    nrm.n = base * 3;
    return nrm;
  };
  /** 로컬 꼭짓점 법선을 배치 변환의 역전치(여인수 행렬, 거울상이면 부호를 바로잡는다)로 옮겨 쌓는다 */
  const putNormals = (dst: F32, src: Float32Array, L: Linear): void => {
    dst.reserve(src.length);
    const a = dst.a;
    let n = dst.n;
    const k = L.k;
    const sg = L.det < 0 ? -1 : 1;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i]!;
      const y = src[i + 1]!;
      const z = src[i + 2]!;
      const X = k[0]! * x + k[3]! * y + k[6]! * z;
      const Y = k[1]! * x + k[4]! * y + k[7]! * z;
      const Z = k[2]! * x + k[5]! * y + k[8]! * z;
      const l = Math.hypot(X, Y, Z);
      const f = l > 0 ? sg / l : 0;
      a[n++] = X * f;
      a[n++] = Y * f;
      a[n++] = Z * f;
    }
    dst.n = n;
  };
  /** 묶음 하나를 덧붙이고 그 배치의 면 넓이(세계)를 돌려준다 */
  const appendFaces = (bk: Bucket, b: Batch, m: Float64Array, node: number, L: Linear): number => {
    const base = bk.pos.n / 3;
    addRun(bk.serial, bk.idx.n / 3, node);
    put(bk.pos, b.pos, m, bk.cls === 0, bk.origin);
    if (b.nrm) {
      if (!bk.nrm && b.smoothed) bk.nrm = backfillNormals(bk, base);
      if (bk.nrm) putNormals(bk.nrm, b.nrm, L);
    }
    // 면 경계: 이 묶음의 면마다 첫 삼각형 차례(삼각형은 면 차례대로 이어 붙는다)
    bk.fs.reserve(b.ft.length);
    let tri = bk.idx.n / 3;
    for (let i = 0; i < b.ft.length; i++) {
      bk.fs.a[bk.fs.n++] = tri;
      tri += b.ft[i]!;
    }
    bk.idx.reserve(b.idx.length);
    const ix = bk.idx.a;
    let n = bk.idx.n;
    // 거울상 배치(행렬식 < 0)는 감김이 뒤집히므로 바로잡는다(앞면이 면 법선 쪽에 남게 — 뒷면 색)
    if (L.det < 0)
      for (let i = 0; i < b.idx.length; i += 3) {
        ix[n++] = base + b.idx[i]!;
        ix[n++] = base + b.idx[i + 2]!;
        ix[n++] = base + b.idx[i + 1]!;
      }
    else for (let i = 0; i < b.idx.length; i++) ix[n++] = base + b.idx[i]!;
    bk.idx.n = n;
    bk.faces += b.faces;
    // 무늬 좌표: 그쪽 자기 재질로 칠하면 그 무늬 좌표, 물려받은 재질이면 평면 좌표 ÷ 무늬 크기
    const side = (sink: UvSink, own: boolean, uv: Float32Array | undefined, stride: 2 | 3 | undefined, mat: number | undefined): void => {
      let src: Parameters<typeof appendUv>[2] = null;
      if (own && uv) src = { arr: uv, stride: stride ?? 2 };
      else if (!own && b.plane && mat !== undefined) {
        const t = texMap!.get(mat)!;
        src = { arr: b.plane, stride: 2, scale: [1 / t.w, 1 / t.h] };
      }
      appendUv(sink, b.pos.length / 3, src);
    };
    if (bk.uv) side(bk, b.mat >= 0, b.uv, b.uvStride, bk.mat);
    if (bk.back?.uv) side(bk.back, b.back >= 0, b.buv, b.buvStride, bk.back.mat);
    const area = placedArea(b, L);
    bk.area += area;
    return area;
  };
  /** 놓인 곡선 번호: 배치마다 그 정의의 곡선 수만큼 새 번호를 쓴다(같은 정의를 여러 번 놓아도 곡선마다 따로) */
  let curveSerial = 0;
  const curveBase = new Map<SkpEntities, number>();
  const curvePlacement = new Map<SkpEntities, number>();
  const appendLines = (lb: LineBucket, l: LineBatch, m: Float64Array, node: number, ents: SkpEntities, placement: number): void => {
    const seg0 = lb.pos.n / 6;
    addRun(lb.serial, seg0, node);
    put(lb.pos, l.pos, m, lb.cls === 0, lb.origin);
    const ns = l.pos.length / 6;
    if (!l.curve && !lb.curves) return;
    if (!lb.curves) {
      lb.curves = new I32(Math.max(64, seg0 + ns));
      lb.curves.a.fill(-1, 0, seg0);
      lb.curves.n = seg0;
    }
    const c = lb.curves;
    c.reserve(ns);
    if (!l.curve) {
      c.a.fill(-1, c.n, c.n + ns);
      c.n += ns;
      return;
    }
    // 이 배치에서 처음 보는 정의면 그 곡선 수만큼 번호를 잡는다(배치가 바뀌면 새로)
    let base = curveBase.get(ents);
    if (base === undefined || curvePlacement.get(ents) !== placement) {
      base = curveSerial;
      curveSerial += Math.max(1, ents.curves?.length ?? 0);
      curveBase.set(ents, base);
      curvePlacement.set(ents, placement);
    }
    for (let i = 0; i < ns; i++) {
      const k = l.curve[i]!;
      c.a[c.n++] = k >= 0 ? base + k : -1;
    }
  };

  // ── 정의 로컬 범위(인치, 안쪽 인스턴스 포함 — 단면 기호 크기·나무 정보 크기용, 처음 쓸 때 정의마다 한 번) ──
  const boundsMemo = new Map<SkpEntities, Float64Array | null>();
  const localBounds = (e: SkpEntities, depth = 0): Float64Array | null => {
    if (boundsMemo.has(e)) return boundsMemo.get(e)!;
    if (depth > MAX_DEPTH) return null;
    boundsMemo.set(e, null); // 자기 자신을 품는 정의 보호
    const b = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    const grow = (x: number, y: number, z: number): void => {
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return;
      if (x < b[0]!) b[0] = x;
      if (y < b[1]!) b[1] = y;
      if (z < b[2]!) b[2] = z;
      if (x > b[3]!) b[3] = x;
      if (y > b[4]!) b[4] = y;
      if (z > b[5]!) b[5] = z;
    };
    const p = e.points;
    for (let i = 0; i + 2 < p.length; i += 3) grow(p[i]!, p[i + 1]!, p[i + 2]!);
    for (const inst of e.instances) {
      const def = model.definitions.get(inst.definition);
      const cb = def ? localBounds(def.entities, depth + 1) : null;
      if (!cb) continue;
      for (let c = 0; c < 8; c++) {
        const q = A.xfPoint(inst.matrix, [cb[c & 1 ? 3 : 0]!, cb[c & 2 ? 4 : 1]!, cb[c & 4 ? 5 : 2]!]);
        grow(q[0], q[1], q[2]);
      }
    }
    const out = b[0]! <= b[3]! ? b : null;
    boundsMemo.set(e, out);
    return out;
  };
  /** 배치의 세계 범위(정의 로컬 범위의 여덟 꼭짓점을 옮긴 상자) */
  const worldBox = (e: SkpEntities, m: Float64Array): { min: Vec3; max: Vec3 } | null => {
    const lb = localBounds(e);
    if (!lb) return null;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const q = A.xfPoint(m, [lb[c & 1 ? 3 : 0]!, lb[c & 2 ? 4 : 1]!, lb[c & 4 ? 5 : 2]!]);
      for (let i = 0; i < 3; i++) {
        if (q[i]! < lo[i]!) lo[i] = q[i]!;
        if (q[i]! > hi[i]!) hi[i] = q[i]!;
      }
    }
    return A.isVec(lo) && A.isVec(hi) ? { min: lo, max: hi } : null;
  };

  // ── 주석 모으기(배치마다 세계 좌표로). 선분은 장면 범위가 정해진 뒤(끝 표시 크기·끝없는 보조선 자르기) 그린다 ──
  type AnnKind = keyof SkpAnnotationItems;
  interface AnnRec {
    kind: AnnKind;
    tag: string;
    hidden: boolean;
    color: Rgba;
    /** 묶음 원점을 정할 첫 점 */
    first: Vec3;
    /** 주석이 놓인 나무 노드(-1 = 모형에 바로, 나무가 없으면 -1) */
    node: number;
    draw: (out: number[], mark: (length: number) => number, clip: (p: Vec3, d: Vec3) => [Vec3, Vec3]) => void;
  }
  const defaults = model.annotationDefaults ?? {};
  const texts: SkpTextMeta[] = [];
  const dims: SkpDimensionMeta[] = [];
  const sections: SkpSectionPlaneMeta[] = [];
  const sectionPids: (number | undefined)[] = [];
  const recs: AnnRec[] = [];
  const guidePoints: { p: Vec3; tag: string; hidden: boolean }[] = [];
  let guideCount = 0;
  let annSeen = false;
  const annLimited = { texts: false, dimensions: false, guides: false, sections: false, segments: false };
  const annMin: Vec3 = [Infinity, Infinity, Infinity];
  const annMax: Vec3 = [-Infinity, -Infinity, -Infinity];
  const extendAnn = (p: Vec3): void => {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < annMin[i]!) annMin[i] = p[i]!;
      if (p[i]! > annMax[i]!) annMax[i] = p[i]!;
    }
  };
  /** 숨긴 주석의 선분은 extras일 때만 그린다 */
  const keepLines = (hidden: boolean): boolean => !hidden || extras;
  const elemTag = (layer: number | undefined, here: number): string => layerName(layer !== undefined && layer !== model.defaultLayer ? layer : here);
  /** 0~255로 적힌 색이면 0~1로 */
  const rgb01 = (c: readonly number[]): Rgb => (c.some((v) => v > 1) ? [c[0]! / 255, c[1]! / 255, c[2]! / 255] : [c[0]!, c[1]!, c[2]!]);
  const matRgb = (mat: number | undefined): Rgb | undefined => {
    if (mat === undefined) return undefined;
    const name = model.materials.get(mat);
    const info = name !== undefined ? materials.get(name) : undefined;
    return info ? [info.color[0], info.color[1], info.color[2]] : undefined;
  };
  const lineColor = (c: Rgb | undefined, fallback: Rgba): Rgba => (c ? [c[0], c[1], c[2], 1] : fallback);
  const fontCache = new Map<number, SkpFontMeta | null>();
  const fontMeta = (id: number | undefined): SkpFontMeta | undefined => {
    if (id === undefined || !model.fonts) return undefined;
    let f = fontCache.get(id);
    if (f === undefined) {
      const src = model.fonts.get(id);
      f = null;
      if (src) {
        f = { face: src.face, bold: !!src.bold, italic: !!src.italic };
        if (src.pointSize !== undefined && Number.isFinite(src.pointSize)) f.pointSize = src.pointSize;
        if (src.worldSize !== undefined && Number.isFinite(src.worldSize) && src.worldSize > 0) f.worldHeight = src.worldSize * Math.abs(scale);
      }
      fontCache.set(id, f);
    }
    return f ?? undefined;
  };
  const hasAnnotations = (e: SkpEntities): boolean => !!(e.texts?.length || e.dimensions?.length || e.guides?.length || e.sections?.length);
  const midpoint = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

  const collectAnnotations = (ents: SkpEntities, m: Float64Array, here: number, node: number, hiddenSub: boolean): void => {
    annSeen = true;
    for (const t of ents.texts ?? []) {
      if (texts.length >= MAX_TEXTS) {
        annLimited.texts = true;
        break;
      }
      const hidden = hiddenSub || (t.flags & FLAG_HIDDEN) !== 0;
      const tag = elemTag(t.layer, here);
      const leaderType = t.leaderType ?? 'none';
      const tm: SkpTextMeta = { text: typeof t.text === 'string' ? t.text : '', leaderType, tag, hidden, node };
      const at = A.isVec(t.point) ? A.xfPoint(m, t.point) : undefined;
      if (at && A.isVec(at)) tm.point = at;
      const withLeader = leaderType !== 'none' && !!tm.point;
      if (withLeader) tm.textPoint = A.isVec(t.leader) ? A.xfPoint(m, A.add(t.point!, t.leader)) : tm.point;
      if (t.screen && Number.isFinite(t.screen[0]) && Number.isFinite(t.screen[1])) tm.screen = [t.screen[0], t.screen[1]];
      const arrow = t.arrow ?? (withLeader ? defaults.leaderArrow : undefined);
      if (arrow) tm.arrow = arrow;
      const font = fontMeta(t.font ?? defaults.textFont);
      if (font) tm.font = font;
      const color = matRgb(t.material) ?? (defaults.textColor ? rgb01(defaults.textColor) : undefined);
      if (color) tm.color = color;
      texts.push(tm);
      if (tm.point) extendAnn(tm.point);
      const a = tm.point;
      const b = tm.textPoint;
      if (withLeader && a && b && A.len(A.sub(b, a)) > 0 && keepLines(hidden))
        recs.push({
          kind: 'leaders',
          tag,
          hidden,
          node,
          color: lineColor(color, ANNOTATION_COLOR),
          first: a,
          draw: (out, mark) => {
            A.seg(out, b, a);
            const d = A.unit(A.sub(a, b));
            if (d) A.endMark(out, a, d, A.perpendicular(d), arrow, mark(A.len(A.sub(a, b))));
          },
        });
    }
    for (const d of ents.dimensions ?? []) {
      if (dims.length >= MAX_DIMENSIONS) {
        annLimited.dimensions = true;
        break;
      }
      const hidden = hiddenSub || (d.flags & FLAG_HIDDEN) !== 0;
      const tag = elemTag(d.layer, here);
      const color = matRgb(d.material) ?? (defaults.dimColor ? rgb01(defaults.dimColor) : undefined);
      const arrow = d.arrow ?? defaults.dimArrow ?? 'closed';
      const nrm = A.isVec(d.normal) ? A.xfNormal(m, d.normal) : null;
      let dm: SkpDimensionMeta;
      let first: Vec3;
      let draw: AnnRec['draw'];
      if (d.kind === 'linear') {
        if (!A.isVec(d.start) || !A.isVec(d.end)) continue;
        const S = A.xfPoint(m, d.start);
        const E = A.xfPoint(m, d.end);
        const offV = A.isVec(d.offset) ? A.xfVector(m, d.offset) : null;
        const off = offV && A.len(offV) > 0 ? offV : null;
        const axis = A.isVec(d.measureAxis) ? A.unit(A.xfVector(m, d.measureAxis)) : null;
        const lay = A.linearLayout(S, E, off, axis);
        if (![...lay.a, ...lay.b, lay.value].every(Number.isFinite)) continue;
        const dir = A.unit(A.sub(lay.b, lay.a)) ?? axis ?? A.unit(A.sub(E, S));
        dm = { kind: 'linear', text: typeof d.text === 'string' ? d.text : '', value: lay.value, textPoint: midpoint(lay.a, lay.b), tag, hidden, node };
        if (dir) dm.direction = dir;
        const perp: Vec3 = !dir ? [0, 0, 1] : off ? A.perpendicular(dir, A.unit(off)) : nrm ? (A.unit(A.cross(nrm, dir)) ?? A.perpendicular(dir)) : A.perpendicular(dir);
        first = lay.a;
        draw = (out, mark) => A.linearSegments(out, lay, perp, arrow, mark(A.len(A.sub(lay.b, lay.a))));
        extendAnn(S);
        extendAnn(E);
        extendAnn(lay.a);
        extendAnn(lay.b);
      } else {
        if (!A.isVec(d.center) || !A.isVec(d.arcPoint)) continue;
        const c = A.xfPoint(m, d.center);
        const ap = A.xfPoint(m, d.arcPoint);
        const at = A.isVec(d.attach) ? A.xfPoint(m, d.attach) : ap;
        const r = A.len(A.sub(ap, c));
        const diameter = d.kind === 'diameter';
        if (![...c, ...ap, ...at, r].every(Number.isFinite)) continue;
        dm = { kind: diameter ? 'diameter' : 'radial', text: typeof d.text === 'string' ? d.text : '', value: r * (diameter ? 2 : 1), textPoint: at, tag, hidden, node };
        const dir = A.unit(A.sub(ap, c));
        if (dir) dm.direction = dir;
        const perp: Vec3 = !dir ? [0, 0, 1] : nrm ? (A.unit(A.cross(nrm, dir)) ?? A.perpendicular(dir)) : A.perpendicular(dir);
        first = ap;
        draw = (out, mark) => {
          if (!dir) return;
          // 반지름: 중심 → 호 위 점, 지름: 맞은편 점 → 호 위 점. 글이 호 밖이면 글 자리까지 잇는다
          const op = diameter ? A.sub(A.mulS(c, 2), ap) : c;
          A.seg(out, op, ap);
          if (A.len(A.sub(at, c)) > r * (1 + 1e-9) && A.dot(A.sub(at, c), dir) > 0) A.seg(out, ap, at);
          const size = mark(diameter ? 2 * r : r);
          A.endMark(out, ap, dir, perp, arrow, size);
          if (diameter) A.endMark(out, op, A.mulS(dir, -1), perp, arrow, size);
        };
        extendAnn(c);
        extendAnn(ap);
        extendAnn(at);
      }
      const aligned = d.alignedText ?? defaults.dimAlignedText;
      if (aligned !== undefined) dm.alignedText = aligned;
      const font = fontMeta(d.font ?? defaults.dimFont);
      if (font) dm.font = font;
      if (color) dm.color = color;
      dims.push(dm);
      if (keepLines(hidden)) recs.push({ kind: 'dimensions', tag, hidden, node, color: lineColor(color, ANNOTATION_COLOR), first, draw });
    }
    for (const g of ents.guides ?? []) {
      if (guideCount >= MAX_GUIDES) {
        annLimited.guides = true;
        break;
      }
      if (!A.isVec(g.point)) continue;
      guideCount++;
      const hidden = hiddenSub || (g.flags & FLAG_HIDDEN) !== 0;
      if (!keepLines(hidden)) continue;
      const tag = elemTag(g.layer, here);
      const P = A.xfPoint(m, g.point);
      if (g.kind === 'point') {
        guidePoints.push({ p: P, tag, hidden });
        extendAnn(P);
        if (A.isVec(g.start)) {
          const S = A.xfPoint(m, g.start);
          recs.push({ kind: 'guides', tag, hidden, node, color: GUIDE_COLOR, first: S, draw: (out) => A.seg(out, S, P) });
          extendAnn(S);
        }
        continue;
      }
      if (A.isVec(g.start) && A.isVec(g.end)) {
        const S = A.xfPoint(m, g.start);
        const E = A.xfPoint(m, g.end);
        recs.push({ kind: 'guides', tag, hidden, node, color: GUIDE_COLOR, first: S, draw: (out) => A.seg(out, S, E) });
        extendAnn(S);
        extendAnn(E);
        continue;
      }
      const dir = A.isVec(g.direction) ? A.unit(A.xfVector(m, g.direction)) : null;
      if (!dir) continue;
      extendAnn(P);
      recs.push({
        kind: 'guides',
        tag,
        hidden,
        node,
        color: GUIDE_COLOR,
        first: P,
        draw: (out, _mark, clip) => {
          const [a, b] = clip(P, dir);
          A.seg(out, a, b);
        },
      });
    }
    for (const sp of ents.sections ?? []) {
      if (sections.length >= MAX_SECTION_PLANES) {
        annLimited.sections = true;
        break;
      }
      const plane = Array.isArray(sp.plane) && sp.plane.length >= 4 ? A.xfPlane(m, sp.plane) : null;
      if (!plane) continue;
      const hidden = hiddenSub || (sp.flags & FLAG_HIDDEN) !== 0;
      const tag = elemTag(sp.layer, here);
      const n: Vec3 = [plane[0], plane[1], plane[2]];
      const wb = worldBox(ents, m);
      let center: Vec3 = A.mulS(n, -plane[3]);
      let size = 0;
      if (wb) {
        const c = midpoint(wb.min, wb.max);
        center = A.sub(c, A.mulS(n, A.dot(n, c) + plane[3]));
        size = 0.5 * A.len(A.sub(wb.max, wb.min));
      }
      if (!(size > 0)) size = 50 * Math.abs(scale);
      sections.push({ name: sp.name || sp.symbol || '', plane, active: !!sp.active, tag, hidden, node, size });
      sectionPids.push(sp.pid);
      extendAnn(center);
      if (keepLines(hidden)) recs.push({ kind: 'sectionPlanes', tag, hidden, node, color: SECTION_COLOR, first: center, draw: (out) => A.sectionSymbol(out, center, n, size) });
    }
  };

  // ── 장면이 다시 보이는 모형 숨김 인스턴스: 숨긴 개체를 기억하는 장면 중 하나라도 숨기지 않는 인스턴스(영구 번호)는
  //    숨긴 형상(반투명 extras)과 따로 보통 색으로 한 번 더 그려 둔다(화면은 그 장면에서만 보인다). 나무가 있을 때만(노드로 잇는다)
  const revealPids = new Set<number>();
  if (extras && T && model.pages?.length) {
    const hiddenPids: number[] = [];
    const scanHidden = (e: SkpEntities): void => {
      for (const inst of e.instances) if (inst.flags & FLAG_HIDDEN && inst.pid !== undefined) hiddenPids.push(inst.pid);
    };
    scanHidden(model.root);
    for (const d of model.definitions.values()) scanHidden(d.entities);
    if (hiddenPids.length)
      for (const pg of model.pages) {
        if (!(Number.isFinite(pg.flags) && pg.flags & PAGE_USE_HIDDEN_OBJECTS)) continue;
        const shown = new Set(pg.hiddenIds ?? []);
        for (const pid of hiddenPids) if (!shown.has(pid)) revealPids.add(pid);
      }
  }
  const REVEAL_NODE = -2;
  const REVEAL_SLOT = Number.MAX_SAFE_INTEGER;
  const revealFaces = new Map<string, Bucket & { node: number }>();
  const revealLines = new Map<string, LineBucket & { node: number }>();
  const revealNodes = new Set<number>();
  let revealVerts = 0;
  let revealLimited = false;
  /** 다시 보일 숨김 인스턴스 안쪽(그 안에서 또 숨긴 인스턴스는 빼고)을 노드 몫 묶음에 보통 색으로 덧붙인다 */
  let revealPlacement = -1;
  const reveal = (ents: SkpEntities, m: Float64Array, inhMat: number | undefined, inhLayer: number | undefined, depth: number, stack: Set<SkpEntities>, node: number): void => {
    if (revealLimited) return;
    const p = prep(ents);
    const layerHere = inhLayer ?? model.defaultLayer ?? -1;
    const matOf = (b: Batch): number | undefined => (b.mat >= 0 ? b.mat : inhMat);
    const backOf = (b: Batch): number | undefined | null => sideBack(b, inhMat);
    const L = linearOf(m);
    for (const b of p.batches) {
      const nv = b.pos.length / 3;
      if (revealVerts + nv > MAX_REVEAL_VERTICES) {
        revealLimited = true;
        return;
      }
      revealVerts += nv;
      const layer = b.layer >= 0 ? b.layer : layerHere;
      const mat = matOf(b);
      const back = backOf(b);
      const far = farCell(b.pos, m);
      const key = `${node}|${layer}|${mat ?? 'd'}${back !== null ? `|b${back ?? 'd'}` : ''}${far ? far.key : ''}`;
      let bk = revealFaces.get(key);
      if (!bk)
        revealFaces.set(
          key,
          (bk = {
            serial: -1,
            slot: REVEAL_SLOT,
            // 0이 아닌 갈래: 장면 범위(bounds)에 넣지 않는다(숨긴 형상처럼)
            cls: 2,
            layer,
            mat,
            pos: new F32(),
            idx: new U32(),
            faces: 0,
            area: 0,
            origin: far ? far.origin : null,
            uv: mat !== undefined && texMap?.has(mat) ? new F32() : null,
            uvStride: 2,
            fs: new U32(64),
            closed: false,
            cap: 0,
            back: newBack(back),
            bb: null,
            node,
          }),
        );
      appendFaces(bk, b, m, REVEAL_NODE, L);
    }
    const placement = revealPlacement--;
    for (const l of p.lines) {
      const layer = l.layer >= 0 ? l.layer : layerHere;
      const far = farCell(l.pos, m);
      const key = `${node}|${layer}${far ? far.key : ''}`;
      let lb = revealLines.get(key);
      if (!lb) revealLines.set(key, (lb = { serial: -1, slot: REVEAL_SLOT, cls: 2, layer, pos: new F32(), origin: far ? far.origin : null, curves: null, node }));
      appendLines(lb, l, m, REVEAL_NODE, ents, placement);
    }
    if (depth >= MAX_DEPTH) return;
    stack.add(ents);
    for (const inst of ents.instances) {
      if (inst.flags & FLAG_HIDDEN) continue;
      const def = model.definitions.get(inst.definition);
      if (!def || stack.has(def.entities)) continue;
      const layer = inst.layer !== undefined && inst.layer !== model.defaultLayer ? inst.layer : inhLayer;
      reveal(def.entities, mul4(m, inst.matrix), inst.material ?? inhMat, layer, depth + 1, stack, node);
      if (revealLimited) break;
    }
    stack.delete(ents);
  };

  /**
   * 요소 묶음 하나를 놓는다. node: 이 배치를 맡는 나무 노드(목록에 없는 깊은 배치는 목록에 든 조상, -1 = 모형).
   * hiddenSub: 숨긴 인스턴스 안쪽(extras일 때만 온다)
   */
  const emit = (
    ents: SkpEntities,
    m: Float64Array,
    inhMat: number | undefined,
    inhLayer: number | undefined,
    depth: number,
    stack: Set<SkpEntities>,
    slot: number,
    node: number,
    hiddenSub: boolean,
    bb: Billboard | null = null,
  ): void => {
    if (truncated || placementsStopped) return;
    if (placements >= maxPlacements) {
      placementsStopped = true;
      return;
    }
    placements++;
    if (opts.onProgress && (placements & 511) === 0) report(placements);
    const p = prep(ents);
    const layerHere = inhLayer ?? model.defaultLayer ?? -1;
    if (annotate && hasAnnotations(ents)) collectAnnotations(ents, m, layerHere, node, hiddenSub);
    const matOf = (b: Batch): number | undefined => (b.mat >= 0 ? b.mat : inhMat);
    const backOf = (b: Batch): number | undefined | null => sideBack(b, inhMat);
    const L = linearOf(m);
    // 닫힌 입체는 따로 모은다(단면 채우기). 반투명 재질이 든 배치는 코어가 채우기에서 빼므로 홀짝이 어긋나지 않게 보통 묶음으로
    const closedHere = !bb && p.closed && !hiddenSub && p.batches.every((b) => colorOf(matOf(b))[3] >= 0.999);
    const cap = closedHere ? capOf(slot, placedBox(p, m)) : 0;
    // 보통 면(숨긴 인스턴스 안쪽이면 숨긴 면으로)
    for (const b of p.batches) {
      const nv = b.pos.length / 3;
      const layer = b.layer >= 0 ? b.layer : layerHere;
      if (hiddenSub) {
        if (extraVerts + nv > MAX_EXTRA_VERTICES) {
          extrasTruncated = true;
          continue;
        }
        extraVerts += nv;
        appendFaces(faceBucket(slot, 1, layer, matOf(b), farCell(b.pos, m), false, null), b, m, node, L);
        continue;
      }
      if (outVerts + nv > MAX_OUTPUT_VERTICES) {
        truncated = true;
        return;
      }
      const area = appendFaces(faceBucket(slot, 0, layer, matOf(b), farCell(b.pos, m), closedHere, backOf(b), bb, cap), b, m, node, L);
      outVerts += nv;
      if (node >= 0) {
        ownFaces![node]! += b.faces;
        ownArea![node]! += area;
      }
    }
    // 숨긴 면
    for (const b of p.hiddenBatches) {
      const nv = b.pos.length / 3;
      if (extraVerts + nv > MAX_EXTRA_VERTICES) {
        extrasTruncated = true;
        continue;
      }
      extraVerts += nv;
      appendFaces(faceBucket(slot, 1, b.layer >= 0 ? b.layer : layerHere, matOf(b), farCell(b.pos, m), false, null), b, m, node, L);
    }
    // 보통 모서리(예전 규칙 그대로: 한도에 걸리면 이 배치의 나머지 보통 모서리는 건너뛴다)
    for (const l of p.lines) {
      const ns = l.pos.length / 6;
      const layer = l.layer >= 0 ? l.layer : layerHere;
      if (hiddenSub) {
        if (extraSegs + ns > MAX_EXTRA_SEGMENTS) {
          extrasTruncated = true;
          continue;
        }
        extraSegs += ns;
        appendLines(lineBucket(slot, 2, layer, farCell(l.pos, m)), l, m, node, ents, placements);
        continue;
      }
      if (outSegs + ns > MAX_OUTPUT_SEGMENTS) {
        linesTruncated = true;
        break;
      }
      outSegs += ns;
      if (node >= 0) ownEdges![node]! += ns;
      // 카메라를 보는 배치의 모서리는 그물 윤곽선으로 함께 돌린다(선분 묶음은 돌지 않는다)
      if (bb) {
        const tmp = new F32();
        put(tmp, l.pos, m, true, null);
        let list = bb.edges.get(layer);
        if (!list) bb.edges.set(layer, (list = []));
        for (let i = 0; i < tmp.n; i++) list.push(tmp.a[i]!);
        bbEdgeCount.set(layerName(layer), (bbEdgeCount.get(layerName(layer)) ?? 0) + ns);
        continue;
      }
      appendLines(lineBucket(slot, 0, layer, farCell(l.pos, m)), l, m, node, ents, placements);
    }
    // 부드러운·숨긴 모서리(숨긴 인스턴스 안의 부드러운 모서리는 그리지 않는다. 카메라를 보는 배치는 돌릴 수 없어 뺀다)
    for (const l of p.extraLines) {
      if ((hiddenSub && l.cls === 1) || bb) continue;
      const ns = l.pos.length / 6;
      if (extraSegs + ns > MAX_EXTRA_SEGMENTS) {
        extrasTruncated = true;
        continue;
      }
      extraSegs += ns;
      appendLines(lineBucket(slot, l.cls, l.layer >= 0 ? l.layer : layerHere, farCell(l.pos, m)), l, m, node, ents, placements);
    }
    if (depth >= MAX_DEPTH) {
      if (ents.instances.length) cycles++;
      return;
    }
    stack.add(ents);
    // 나무: 이 노드의 자식이 목록에 있으면 k번째 자식 = firstChild + k(넓이 우선으로 모을 때와 같은 거르기·차례)
    const listed = T !== null && (node < 0 ? depth === 0 : T.childCount[node]! > 0);
    const first = !T ? -1 : node < 0 ? 0 : T.firstChild[node]!;
    let k = 0;
    for (const inst of ents.instances) {
      const hiddenInst = (inst.flags & FLAG_HIDDEN) !== 0;
      if (hiddenInst && !extras) continue;
      const def = model.definitions.get(inst.definition);
      if (!def) {
        missingDefs++;
        continue;
      }
      if (stack.has(def.entities)) {
        cycles++;
        continue;
      }
      const child = listed ? first + k : node;
      k++;
      const own = T !== null && child !== node && child >= 0;
      let childSlot = slot;
      if (own) {
        if (T.depth[child]! <= splitDepth || forced.has(child)) {
          childSlot = slotNode.length;
          slotNode.push(child);
          nodeSlot![child] = childSlot;
        }
        runFirst![child] = runItem.n;
      }
      const layer = inst.layer !== undefined && inst.layer !== model.defaultLayer ? inst.layer : inhLayer;
      const placed = mul4(m, inst.matrix);
      if (own) {
        const vol = prep(def.entities).volume;
        if (vol !== undefined) nodeVolume![child] = vol * Math.abs(linearOf(placed).det);
      }
      // "항상 카메라 보기" 컴포넌트: 그 배치(안쪽 포함)를 따로 모아 코어가 Z축 둘레로 돌리게(안쪽의 같은 깃발은 바깥 배치를 따른다)
      let childBb = bb;
      if (!bb && !hiddenSub && !hiddenInst && def.behavior?.alwaysFaceCamera) {
        if (billboards < MAX_BILLBOARDS) childBb = { key: `|bb${billboards++}`, origin: A.xfPoint(placed, [0, 0, 0]), front: frontOf(placed), edges: new Map() };
        else billboardsSkipped++;
        if (childBb) billboardList.push(childBb);
      }
      emit(def.entities, placed, inst.material ?? inhMat, layer, depth + 1, stack, childSlot, child, hiddenSub || hiddenInst, childBb);
      // 모형에서 숨겼지만 어떤 장면에서는 보이는 인스턴스: 그 노드 몫으로 보통 색 그림을 하나 더(숨긴 안쪽의 안쪽은 이미 숨김 그대로)
      if (hiddenInst && !hiddenSub && own && inst.pid !== undefined && revealPids.has(inst.pid) && !revealLimited) {
        if (revealNodes.size >= MAX_REVEAL_NODES && !revealNodes.has(child)) revealLimited = true;
        else {
          revealNodes.add(child);
          reveal(def.entities, placed, inst.material ?? inhMat, layer, depth + 1, new Set(stack), child);
        }
      }
      if (own) {
        runEnd![child] = runItem.n;
        if (childSlot !== slot) nodeSlotEnd![child] = slotNode.length;
      }
      if (truncated || placementsStopped) break;
    }
    stack.delete(ents);
  };

  const rootM = new Float64Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]);
  emit(model.root, rootM, undefined, undefined, 0, new Set(), 0, -1, false);
  if (billboardsSkipped)
    warnings.push(`"항상 카메라 보기" 컴포넌트가 너무 많아(${MAX_BILLBOARDS}개 한도) ${billboardsSkipped}개는 저장된 방향 그대로 둡니다`);
  report(placementsTotal);

  // 통계: 태그는 모형 차례로 미리 넣는다(그릴 것이 없는 태그도 목록에 보이게)
  // 태그 목록(model.tags)을 읽었으면 태그 자신의 보임·색·폴더·선 종류를 붙인다(없으면 예전 꼴 그대로)
  const tagInfo = new Map<string, SkpTag>();
  for (const t of model.tags ?? []) if (t && typeof t.name === 'string' && !tagInfo.has(t.name)) tagInfo.set(t.name, t);
  const dashedTags = new Set<string>();
  const tagStats = new Map<string, SkpTagStat>();
  const tagStat = (name: string): SkpTagStat => {
    let t = tagStats.get(name);
    if (!t) {
      tagStats.set(name, (t = { name, default: name === defaultTagName, faces: 0, edges: 0 }));
      const info = tagInfo.get(name);
      if (info) {
        t.visible = info.visible !== false;
        const c = info.colorMaterial !== undefined ? materials.get(info.colorMaterial)?.color : undefined;
        if (c) t.color = [c[0], c[1], c[2], c[3]];
        if (info.folder !== undefined && info.folder >= 0) t.folder = info.folder;
        if (info.lineStyle && info.lineStyle !== 'Solid Basic') {
          t.lineStyle = info.lineStyle;
          t.dashed = true;
          dashedTags.add(name);
        }
      }
    }
    return t;
  };
  for (const name of model.layers.values()) tagStat(name);
  for (const [tag, n] of bbEdgeCount) tagStat(tag).edges += n;
  const matStats = new Map<string, SkpMaterialStat>();
  const matStatOf = (name: string, stored: string | undefined, color: Rgba): SkpMaterialStat => {
    let ms = matStats.get(name);
    if (!ms) {
      const textured = stored !== undefined && !!materials.get(stored)?.textured;
      ms = { name, color: [color[0], color[1], color[2], color[3]], textured, faces: 0, area: 0, meshIds: [] };
      if (stored !== undefined) ms.folder = stored;
      matStats.set(name, ms);
    }
    return ms;
  };
  const slotStats = new Map<number, { faces: number; edges: number; area: number }>();
  const slotStat = (slot: number): { faces: number; edges: number; area: number } => {
    let s = slotStats.get(slot);
    if (!s) slotStats.set(slot, (s = { faces: 0, edges: 0, area: 0 }));
    return s;
  };

  /** 버킷 일련번호 → 항목 차례(그물 차례, 모서리는 그물 수 + 모서리 차례) */
  const serialItem = new Int32Array(serials);
  const meshes: Mesh3d[] = [];
  const meshSlots: number[] = [];
  /** 그물마다 면 경계(면마다 첫 삼각형 차례) — meta.faceRuns */
  const faceRuns: Uint32Array[] = [];
  const softIds: string[] = [];
  const hiddenIds: string[] = [];
  let hiddenFaces = 0;
  let triangles = 0;
  /** 무늬 재질 묶음이면 무늬 좌표·무늬 id를 단다. 앞과 다른 뒷면이면 뒷면 색(재질 색 또는 스타일 뒷면 색)과 뒷면 무늬도 */
  const withTexture = (mesh: Mesh3d, bk: Bucket): void => {
    const nv = bk.pos.n / 3;
    const t = bk.uv && bk.mat !== undefined ? texMap?.get(bk.mat) : undefined;
    if (t && bk.uv!.n === nv * bk.uvStride) {
      mesh.uvs = bk.uv!.done();
      mesh.texture = t.id;
    }
    const back = bk.back;
    if (!back) return;
    mesh.backColor = back.mat !== undefined ? colorOf(back.mat) : defaultBack!;
    const bt = back.uv && back.mat !== undefined ? texMap?.get(back.mat) : undefined;
    if (bt && back.uv!.n === nv * back.uvStride) {
      mesh.backUvs = back.uv!.done();
      mesh.backTexture = bt.id;
    }
  };
  /** 같은 칸·재질 묶음의 차례: 뒷면 없음 → 스타일 뒷면 색 → 뒷면 재질 번호 */
  const backRank = (bk: Bucket): number => (!bk.back ? -2 : (bk.back.mat ?? -1));
  const sorted = [...buckets.values()].sort(
    (a, b) => a.slot - b.slot || a.cls - b.cls || a.layer - b.layer || (a.mat ?? -1) - (b.mat ?? -1) || Number(a.closed) - Number(b.closed) || a.cap - b.cap || backRank(a) - backRank(b),
  );
  // 카메라를 보는 배치의 모서리를 실을 그물: 태그마다 그 태그의 첫 그물(태그를 숨기면 모서리도 함께 숨게), 그 태그의 그물이 없으면 첫 그물
  const bbEdgeHost = new Map<Bucket, number[]>();
  {
    const first = new Map<Billboard, Bucket>();
    const byTag = new Map<Billboard, Map<number, Bucket>>();
    for (const bk of sorted) {
      if (!bk.bb || bk.cls) continue;
      if (!first.has(bk.bb)) first.set(bk.bb, bk);
      let m = byTag.get(bk.bb);
      if (!m) byTag.set(bk.bb, (m = new Map()));
      if (!m.has(bk.layer)) m.set(bk.layer, bk);
    }
    for (const [bb, host] of first)
      for (const [layer, e] of bb.edges) {
        const to = byTag.get(bb)?.get(layer) ?? host;
        const list = bbEdgeHost.get(to);
        if (list) for (const v of e) list.push(v);
        else bbEdgeHost.set(to, [...e]);
      }
  }
  for (const bk of sorted) {
    const stored = bk.mat !== undefined ? model.materials.get(bk.mat) : undefined;
    // 표시 이름은 material.xml의 원래 이름(model.dat에는 '<Black>'이 '_Black_'처럼 바뀌어 있다)
    const matName =
      bk.mat === undefined ? '기본 재질' : stored !== undefined ? (materials.get(stored)?.name ?? stored) : `재질 ${bk.mat}`;
    const tag = layerName(bk.layer);
    const color = colorOf(bk.mat);
    serialItem[bk.serial] = meshes.length;
    meshSlots.push(bk.slot);
    if (bk.cls) {
      const id = `skp-hidden-${meshes.length}`;
      const hm: Mesh3d = {
        id,
        name: `숨긴 형상 · ${matName} · ${tag}`,
        positions: bk.pos.done(),
        indices: bk.idx.done(),
        color: [color[0], color[1], color[2], Math.min(color[3], HIDDEN_FACE_ALPHA)],
        group: tag,
        doubleSided: true,
      };
      if (bk.nrm) hm.normals = bk.nrm.done();
      if (bk.origin) hm.origin = bk.origin;
      withTexture(hm, bk);
      meshes.push(hm);
      faceRuns.push(bk.fs.done());
      hiddenIds.push(id);
      hiddenFaces += bk.faces;
      continue;
    }
    // 닫힌 입체 배치만 모은 묶음은 칸마다 같은 채우기 묶음(capGroup): 재질·태그로 나뉜 그물이 함께 하나의 입체를 이룬다.
    // 범위 상자가 겹치는 입체는 그 칸의 다른 묶음(skp-solid-<칸>-<번호>) — 홀짝 채우기에서 겹친 곳이 비지 않게
    // 나머지(열린 면·얇은 판)는 채우지 않고 단면 테두리만
    const mesh: Mesh3d = {
      id: `skp-mesh-${meshes.length}`,
      name: `${matName} · ${tag}`,
      positions: bk.pos.done(),
      indices: bk.idx.done(),
      color,
      group: tag,
      doubleSided: true,
    };
    if (bk.nrm) mesh.normals = bk.nrm.done();
    if (bk.origin) mesh.origin = bk.origin;
    if (bk.closed) mesh.capGroup = bk.cap ? `skp-solid-${bk.slot}-${bk.cap}` : `skp-solid-${bk.slot}`;
    if (bk.bb) {
      mesh.billboard = { origin: bk.bb.origin, axis: 'z', front: bk.bb.front };
      // 그 배치의 모서리는 같은 태그 그물의 윤곽선으로(함께 돈다)
      const own = bbEdgeHost.get(bk);
      if (own?.length) {
        const e = Float32Array.from(own);
        if (bk.origin) for (let i = 0; i < e.length; i += 3) for (let c = 0; c < 3; c++) e[i + c]! -= bk.origin[c]!;
        mesh.edges = e;
        slotStat(bk.slot).edges += e.length / 6;
      }
    }
    withTexture(mesh, bk);
    triangles += mesh.indices!.length / 3;
    meshes.push(mesh);
    faceRuns.push(bk.fs.done());
    tagStat(tag).faces += bk.faces;
    const ms = matStatOf(matName, stored, color);
    if (mesh.texture) ms.texture = mesh.texture;
    ms.faces += bk.faces;
    ms.area += bk.area;
    ms.meshIds.push(mesh.id);
    // 뒷면 재질도 목록에(뒷면 수로 세고, 고르면 이 그물도 강조)
    const bm = bk.back?.mat;
    if (bm !== undefined) {
      const bStored = model.materials.get(bm);
      const bs = matStatOf(bStored !== undefined ? (materials.get(bStored)?.name ?? bStored) : `재질 ${bm}`, bStored, colorOf(bm));
      bs.backFaces = (bs.backFaces ?? 0) + bk.faces;
      if (mesh.backTexture) bs.texture = mesh.backTexture;
      if (!bs.meshIds.includes(mesh.id)) bs.meshIds.push(mesh.id);
    }
    const ss = slotStat(bk.slot);
    ss.faces += bk.faces;
    ss.area += bk.area;
  }
  // 장면이 다시 보이는 숨김 인스턴스의 보통 색 그림(통계·나무 구간에는 넣지 않는다 — 노드 몫 항목 id만 meta.revealItems에)
  const revealIds = new Map<number, string[]>();
  const revealId = (node: number, id: string): void => {
    const list = revealIds.get(node);
    if (list) list.push(id);
    else revealIds.set(node, [id]);
  };
  for (const bk of [...revealFaces.values()].sort((a, b) => a.node - b.node || a.layer - b.layer || (a.mat ?? -1) - (b.mat ?? -1))) {
    if (!bk.idx.n) continue;
    const stored = bk.mat !== undefined ? model.materials.get(bk.mat) : undefined;
    const matName = bk.mat === undefined ? '기본 재질' : stored !== undefined ? (materials.get(stored)?.name ?? stored) : `재질 ${bk.mat}`;
    const tag = layerName(bk.layer);
    const id = `skp-reveal-${meshes.length}`;
    const mesh: Mesh3d = { id, name: `장면에서 보이는 숨긴 개체 · ${matName} · ${tag}`, positions: bk.pos.done(), indices: bk.idx.done(), color: colorOf(bk.mat), group: tag, doubleSided: true };
    if (bk.nrm) mesh.normals = bk.nrm.done();
    if (bk.origin) mesh.origin = bk.origin;
    withTexture(mesh, bk);
    meshes.push(mesh);
    meshSlots.push(REVEAL_SLOT);
    faceRuns.push(bk.fs.done());
    revealId(bk.node, id);
  }
  const lines: LineSet3d[] = [];
  const lineSlots: number[] = [];
  /** 모서리 묶음마다 선분의 놓인 곡선 번호(곡선 선분이 없는 묶음·주석 선분은 null) — meta.segmentCurves */
  const segmentCurves: (Int32Array | null)[] = [];
  let segments = 0;
  let softSegments = 0;
  let hiddenSegments = 0;
  for (const lb of [...lineBuckets.values()].sort((a, b) => a.slot - b.slot || a.cls - b.cls || a.layer - b.layer)) {
    const tag = layerName(lb.layer);
    const positions = lb.pos.done();
    const n = positions.length / 6;
    serialItem[lb.serial] = meshes.length + lines.length;
    lineSlots.push(lb.slot);
    segmentCurves.push(lb.curves ? lb.curves.done() : null);
    const withOrigin = <T extends LineSet3d>(l: T): T => {
      if (lb.origin) l.origin = lb.origin;
      return l;
    };
    if (lb.cls === 1) {
      const id = `skp-soft-${lines.length}`;
      lines.push(withOrigin({ id, name: `부드러운 모서리 · ${tag}`, positions, color: SOFT_EDGE_COLOR, group: tag }));
      softIds.push(id);
      softSegments += n;
      continue;
    }
    if (lb.cls === 2) {
      const id = `skp-hidden-edges-${lines.length}`;
      lines.push(withOrigin({ id, name: `숨긴 모서리 · ${tag}`, positions, color: HIDDEN_EDGE_COLOR, dashed: true, group: tag }));
      hiddenIds.push(id);
      hiddenSegments += n;
      continue;
    }
    segments += n;
    const id = `skp-edges-${lines.length}`;
    const edgeSet: LineSet3d = { id, name: `모서리 · ${tag}`, positions, color: edgeColor, group: tag };
    if (dashedTags.has(tag)) edgeSet.dashed = true;
    lines.push(withOrigin(edgeSet));
    tagStat(tag).edges += n;
    slotStat(lb.slot).edges += n;
  }

  for (const lb of [...revealLines.values()].sort((a, b) => a.node - b.node || a.layer - b.layer)) {
    if (!lb.pos.n) continue;
    const tag = layerName(lb.layer);
    const id = `skp-reveal-edges-${lines.length}`;
    const l: LineSet3d = { id, name: `장면에서 보이는 숨긴 개체 모서리 · ${tag}`, positions: lb.pos.done(), color: edgeColor, group: tag };
    if (dashedTags.has(tag)) l.dashed = true;
    if (lb.origin) l.origin = lb.origin;
    lines.push(l);
    lineSlots.push(REVEAL_SLOT);
    segmentCurves.push(lb.curves ? lb.curves.done() : null);
    revealId(lb.node, id);
  }
  if (revealLimited) warnings.push(`장면에서 다시 보이는 숨긴 개체가 너무 많아(노드 ${MAX_REVEAL_NODES}개·정점 ${MAX_REVEAL_VERTICES.toLocaleString('en-US')}개 한도) 일부는 장면에서도 숨긴 채 둡니다`);

  // ── 주석 선분·보조점(형상 모서리 뒤에 붙인다 — 나무 항목 차례는 그대로) ──
  const points: PointSet3d[] = [];
  const annItems: SkpAnnotationItems = { dimensions: [], leaders: [], guides: [], sectionPlanes: [] };
  let annotationRuns: Record<string, { start: Uint32Array; node: Int32Array }> | undefined;
  if (recs.length || guidePoints.length) {
    // 크기 기준: 장면 범위(형상이 없으면 주석 범위)의 대각선
    const useScene = min[0] <= max[0];
    const bmin = useScene ? min : annMin;
    const bmax = useScene ? max : annMax;
    const hasBox = bmin[0]! <= bmax[0]!;
    const diag = hasBox ? A.len(A.sub(bmax, bmin)) : 0;
    const unitLen = diag > 0 ? diag : 50 * Math.abs(scale) || 1;
    const mark = (length: number): number => {
      const cap = unitLen * 0.012;
      return length > 0 ? Math.min(length * 0.15, cap) : cap;
    };
    const pad = unitLen * 0.1;
    const cmin: Vec3 | null = hasBox ? [bmin[0]! - pad, bmin[1]! - pad, bmin[2]! - pad] : null;
    const cmax: Vec3 | null = hasBox ? [bmax[0]! + pad, bmax[1]! + pad, bmax[2]! + pad] : null;
    /** 끝없는 보조선을 (넓힌) 범위 상자에 맞춰 자른다. 상자를 비껴가면 상자 가운데에 가장 가까운 점 둘레로 대각선 길이만큼 */
    const clip = (P: Vec3, d: Vec3): [Vec3, Vec3] => {
      const t = cmin && cmax ? A.clipLine(P, d, cmin, cmax) : null;
      if (t) return [A.add(P, A.mulS(d, t[0])), A.add(P, A.mulS(d, t[1]))];
      const c = cmin && cmax ? midpoint(cmin, cmax) : P;
      const tc = A.dot(A.sub(c, P), d);
      return [A.add(P, A.mulS(d, tc - unitLen / 2)), A.add(P, A.mulS(d, tc + unitLen / 2))];
    };
    /** 큰 좌표면 묶음 원점(형상과 같은 기준·칸) */
    const farWorld = (p: Vec3): { key: string; origin: [number, number, number] } | null => {
      if (!(originLimit < Infinity) || !(Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) > originLimit)) return null;
      return { key: `@${Math.round(p[0] / cellSize)},${Math.round(p[1] / cellSize)},${Math.round(p[2] / cellSize)}`, origin: [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])] };
    };
    const toF32 = (src: number[], o: [number, number, number] | null): Float32Array => {
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        out[i] = src[i]! - (o ? o[0] : 0);
        out[i + 1] = src[i + 1]! - (o ? o[1] : 0);
        out[i + 2] = src[i + 2]! - (o ? o[2] : 0);
      }
      return out;
    };
    interface Sink {
      kind: AnnKind;
      tag: string;
      hidden: boolean;
      color: Rgba;
      pos: number[];
      origin: [number, number, number] | null;
      /** 나무 노드 구간: 선분 차례 runStart[k]부터 노드 runNode[k](다음 구간 전까지) */
      runStart: number[];
      runNode: number[];
    }
    const sinks = new Map<string, Sink>();
    let annSegs = 0;
    const tmp: number[] = [];
    for (const r of recs) {
      tmp.length = 0;
      r.draw(tmp, mark, clip);
      const ns = tmp.length / 6;
      if (!ns || !tmp.every(Number.isFinite)) continue;
      if (annSegs + ns > MAX_ANNOTATION_SEGMENTS) {
        annLimited.segments = true;
        break;
      }
      annSegs += ns;
      const far = farWorld(r.first);
      const key = `${r.kind}|${r.tag}|${r.hidden ? 1 : 0}|${r.color.join(',')}${far ? far.key : ''}`;
      let sk = sinks.get(key);
      if (!sk) sinks.set(key, (sk = { kind: r.kind, tag: r.tag, hidden: r.hidden, color: r.color, pos: [], origin: far ? far.origin : null, runStart: [], runNode: [] }));
      if (sk.runNode[sk.runNode.length - 1] !== r.node) {
        sk.runStart.push(sk.pos.length / 6);
        sk.runNode.push(r.node);
      }
      for (const v of tmp) sk.pos.push(v);
    }
    const annRuns: Record<string, { start: Uint32Array; node: Int32Array }> = {};
    let annNodes = false;
    for (const sk of sinks.values()) {
      const id = `skp-${ANNOTATION_ID[sk.kind]}-${lines.length}`;
      segmentCurves.push(null);
      const l: LineSet3d = { id, name: `${sk.hidden ? '숨긴 ' : ''}${ANNOTATION_LABEL[sk.kind]} · ${sk.tag}`, positions: toF32(sk.pos, sk.origin), color: sk.color, group: sk.tag };
      if (sk.kind === 'guides' || sk.hidden) l.dashed = true;
      if (sk.origin) l.origin = sk.origin;
      lines.push(l);
      annItems[sk.kind].push(id);
      if (sk.hidden) hiddenIds.push(id);
      // 나무가 있으면 선분 구간마다 놓인 노드(화면이 그룹·컴포넌트를 숨기면 그 안 주석 선도 숨긴다)
      if (T) {
        annRuns[id] = { start: Uint32Array.from(sk.runStart), node: Int32Array.from(sk.runNode) };
        if (sk.runNode.some((x) => x >= 0)) annNodes = true;
      }
    }
    if (annNodes) annotationRuns = annRuns;
    const ptSinks = new Map<string, { tag: string; hidden: boolean; pos: number[]; origin: [number, number, number] | null }>();
    for (const g of guidePoints) {
      const far = farWorld(g.p);
      const key = `${g.tag}|${g.hidden ? 1 : 0}${far ? far.key : ''}`;
      let sk = ptSinks.get(key);
      if (!sk) ptSinks.set(key, (sk = { tag: g.tag, hidden: g.hidden, pos: [], origin: far ? far.origin : null }));
      sk.pos.push(g.p[0], g.p[1], g.p[2]);
    }
    for (const sk of ptSinks.values()) {
      const id = `skp-guide-points-${points.length}`;
      const ps: PointSet3d = { id, name: `${sk.hidden ? '숨긴 ' : ''}보조점 · ${sk.tag}`, positions: toF32(sk.pos, sk.origin), color: GUIDE_COLOR, size: 5, group: sk.tag };
      if (sk.origin) ps.origin = sk.origin;
      points.push(ps);
      annItems.guides.push(id);
      if (sk.hidden) hiddenIds.push(id);
    }
  }
  if (annLimited.texts) warnings.push(`문자가 너무 많아 ${MAX_TEXTS.toLocaleString('en-US')}개까지만 담았습니다`);
  if (annLimited.dimensions) warnings.push(`치수가 너무 많아 ${MAX_DIMENSIONS.toLocaleString('en-US')}개까지만 담았습니다`);
  if (annLimited.guides) warnings.push(`보조선이 너무 많아 ${MAX_GUIDES.toLocaleString('en-US')}개까지만 담았습니다`);
  if (annLimited.sections) warnings.push(`단면 평면이 너무 많아 ${MAX_SECTION_PLANES.toLocaleString('en-US')}개까지만 담았습니다`);
  if (annLimited.segments) warnings.push(`주석 선분이 너무 많아(${MAX_ANNOTATION_SEGMENTS.toLocaleString('en-US')}개 한도) 일부 주석은 선을 그리지 않았습니다`);

  if (counter.failed) warnings.push(`삼각형으로 나누지 못한 면 ${counter.failed}개를 건너뛰었습니다(면적이 0인 면 등)`);
  if (missingDefs) warnings.push(`정의를 찾지 못한 인스턴스 ${missingDefs}개를 건너뛰었습니다`);
  if (cycles) warnings.push(`자기 자신을 품거나 너무 깊은 인스턴스 ${cycles}개를 건너뛰었습니다`);
  if (truncated)
    warnings.push(`형상이 너무 커서(펼친 면 정점 ${MAX_OUTPUT_VERTICES.toLocaleString('en-US')}개 한도) 일부만 그렸습니다`);
  if (linesTruncated)
    warnings.push(`모서리가 너무 많아(선분 ${MAX_OUTPUT_SEGMENTS.toLocaleString('en-US')}개 한도) 일부 모서리는 그리지 않았습니다`);
  if (placementsStopped)
    warnings.push(
      `인스턴스 배치가 너무 많아(${maxPlacements.toLocaleString('en-US')}번 한도) 일부만 그렸습니다 — 서로를 여러 번 품는 컴포넌트 정의가 있을 수 있습니다`,
    );
  if (extrasTruncated) warnings.push('부드러운 모서리·숨긴 형상이 너무 많아 일부만 담았습니다');
  if (uvLimited) warnings.push(`무늬를 입힐 면이 너무 많아(정점 ${maxUv.toLocaleString('en-US')}개 한도) 일부 면은 무늬 없이 평균색으로 그렸습니다`);
  if (prepTex?.singular) warnings.push(`무늬 위치 행렬을 뒤집을 수 없는 면 ${prepTex.singular}개는 기본 투영으로 칠했습니다`);
  if (prepTex?.flat) warnings.push(`원근으로 일그러뜨린 무늬 중 ${prepTex.flat}개 면은 원근 없이 칠했습니다(투영이 면 위에서 뒤집힘)`);

  const parts: SceneParts = {
    meshes,
    lines,
    warnings,
    stats: { triangles, segments, placements },
    tags: [...tagStats.values()],
    materials: [...matStats.values()],
    points,
    faceRuns,
  };
  if (segmentCurves.some((c) => c)) parts.segmentCurves = segmentCurves;
  if (annSeen) {
    parts.texts = texts;
    parts.dimensions = dims;
    parts.sectionPlanes = sections;
    parts.sectionPids = sectionPids;
    parts.annotationItems = annItems;
    if (annotationRuns) parts.annotationRuns = annotationRuns;
  }
  // 속성 사전: 모형 속성(0x0209 모형 속성 + 뿌리 묶음 머리 사전)을 먼저, 나무 노드·정의는 아래에서
  const pool = new AttrPool(scale);
  const modelDicts = model.properties || model.root.attrs ? { ...(model.properties ?? {}), ...(model.root.attrs ?? {}) } : undefined;
  const modelAttrs = pool.add(modelDicts);
  if (modelAttrs >= 0) parts.modelAttrs = modelAttrs;
  if (truncated || linesTruncated || placementsStopped) parts.limited = true;
  if (min[0] <= max[0]) parts.bounds = { min, max };
  if (extras) parts.extras = { soft: softIds, hidden: hiddenIds, softSegments, hiddenFaces, hiddenSegments };

  // ── 나무·outline ──
  const nMesh = meshes.length;
  const slotCount = slotNode.length;
  /** 칸 s 이상인 첫 항목 차례(s = 0…slotCount) */
  const firstAtSlot = (slots: number[]): Int32Array => {
    const out = new Int32Array(slotCount + 1);
    let i = 0;
    for (let s = 0; s <= slotCount; s++) {
      while (i < slots.length && slots[i]! < s) i++;
      out[s] = i;
    }
    return out;
  };
  const meshAt = firstAtSlot(meshSlots);
  const lineAt = firstAtSlot(lineSlots);
  const rangeIds = (s0: number, s1: number): string[] => {
    const ids: string[] = [];
    for (let i = meshAt[s0]!; i < meshAt[s1]!; i++) ids.push(meshes[i]!.id);
    for (let i = lineAt[s0]!; i < lineAt[s1]!; i++) ids.push(lines[i]!.id);
    return ids;
  };
  const looseEntry = (): SkpOutlineEntry | null => {
    const loose = slotStats.get(0);
    return loose
      ? { name: '모형에 바로 놓인 형상', kind: 'loose', tag: defaultTagName, faces: loose.faces, edges: loose.edges, area: loose.area, ids: rangeIds(0, 1) }
      : null;
  };
  /** 노드 종류: 그림 정의면 어느 목록에 있든 그림 */
  const kindOf = (inst: SkpInstance, def: SkpDefinition | undefined): 'group' | 'component' | 'image' =>
    inst.kind === 'image' || def?.kind === 'image' ? 'image' : (inst.kind ?? 'component');

  if (T) {
    const n = T.n;
    const faces = new Float64Array(n);
    const edges = new Float64Array(n);
    const area = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      faces[i]! += ownFaces![i]!;
      edges[i]! += ownEdges![i]!;
      area[i]! += ownArea![i]!;
      const p = T.parent[i]!;
      if (p >= 0) {
        faces[p]! += faces[i]!;
        edges[p]! += edges[i]!;
        area[p]! += area[i]!;
      }
    }
    const defIndex = new Map<string, number>();
    const definitionNames: string[] = [];
    const tagIndex = new Map<string, number>();
    const tagNames: string[] = [];
    const idx = (map: Map<string, number>, list: string[], s: string): number => {
      let i = map.get(s);
      if (i === undefined) {
        map.set(s, (i = list.length));
        list.push(s);
      }
      return i;
    };
    /** definitionNames 차례마다 처음 만난 정의(이름이 같은 정의는 한 줄로 묶인다) */
    const defOfIndex: (SkpDefinition | undefined)[] = [];
    const defIdx = (inst: SkpInstance): number => {
      const def = model.definitions.get(inst.definition);
      const i = idx(defIndex, definitionNames, def?.name ?? `정의 ${inst.definition}`);
      if (defOfIndex.length <= i) defOfIndex[i] = def;
      return i;
    };
    const tagOf = (inst: SkpInstance): string => (inst.layer !== undefined && inst.layer !== model.defaultLayer ? layerName(inst.layer) : defaultTagName);
    const tree: SkpTree = {
      count: n,
      parent: Int32Array.from(T.parent),
      depth: Uint8Array.from(T.depth, (d) => Math.min(255, d)),
      kind: Uint8Array.from(T.inst, (i) => {
        const k = kindOf(i, model.definitions.get(i.definition));
        return k === 'group' ? 0 : k === 'image' ? 2 : 1;
      }),
      flags: Uint8Array.from({ length: n }, (_, i) => (T.hidden[i] ? TREE_HIDDEN : 0) | (T.more[i] ? TREE_MORE : 0)),
      names: T.inst.map((i) => i.name ?? ''),
      definition: Int32Array.from(T.inst, (i) => defIdx(i)),
      definitionNames,
      tag: Int32Array.from(T.inst, (i) => idx(tagIndex, tagNames, tagOf(i))),
      tagNames,
      faces: Uint32Array.from(faces),
      edges: Uint32Array.from(edges),
      firstChild: Int32Array.from(T.firstChild),
      childCount: Uint32Array.from(T.childCount),
      rootCount: T.rootCount,
      meshFirst: new Int32Array(n).fill(-1),
      meshEnd: new Int32Array(n).fill(-1),
      lineFirst: new Int32Array(n).fill(-1),
      lineEnd: new Int32Array(n).fill(-1),
      runFirst: runsDropped ? new Uint32Array(n) : runFirst!,
      runEnd: runsDropped ? new Uint32Array(n) : runEnd!,
      runItem: new Uint32Array(0),
      runStart: new Uint32Array(0),
      runNode: new Int32Array(0),
      runsDropped,
      itemOwner: new Int32Array(nMesh + lines.length),
      splitDepth,
      listedDepth: T.listedDepth,
      unlisted: T.unlisted,
    };
    for (let i = 0; i < n; i++) {
      const s0 = nodeSlot![i]!;
      const s1 = nodeSlotEnd![i]!;
      if (s0 < 0 || s1 < 0) continue;
      tree.meshFirst[i] = meshAt[s0]!;
      tree.meshEnd[i] = meshAt[s1]!;
      tree.lineFirst[i] = lineAt[s0]!;
      tree.lineEnd[i] = lineAt[s1]!;
    }
    for (let i = 0; i < nMesh; i++) tree.itemOwner[i] = slotNode[meshSlots[i]!] ?? -1;
    for (let i = 0; i < lines.length; i++) tree.itemOwner[nMesh + i] = slotNode[lineSlots[i]!] ?? -1;
    if (!runsDropped) {
      const items = runItem.done();
      for (let i = 0; i < items.length; i++) items[i] = serialItem[items[i]!]!;
      tree.runItem = items;
      tree.runStart = runStart.done();
      tree.runNode = Int32Array.from(runNode1.done(), (v) => v - 1);
    } else warnings.push('그룹·컴포넌트가 너무 많아 깊은 단계는 3D에서 눌러 고를 수 없습니다(목록에서는 고를 수 있습니다)');
    parts.tree = tree;
    parts.nodePids = T.inst.map((i) => i.pid);

    // 나무 정보: 노드마다 GUID·속성·크기(정의 로컬 범위 × 인스턴스 축 배율)·넓이·잠김, 정의마다 설명·GUID·속성
    const size = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lb = localBounds(T.ents[i]!);
      if (!lb) continue;
      const [c0, c1, c2] = A.linearColumns(T.inst[i]!.matrix);
      const s = Math.abs(scale);
      size[3 * i] = (lb[3]! - lb[0]!) * A.len(c0) * s;
      size[3 * i + 1] = (lb[4]! - lb[1]!) * A.len(c1) * s;
      size[3 * i + 2] = (lb[5]! - lb[2]!) * A.len(c2) * s;
    }
    const info: SkpTreeInfo = {
      guid: T.inst.map((i) => (i.kind === 'image' || typeof i.guid !== 'string' ? '' : i.guid)),
      attrs: Int32Array.from(T.inst, (i) => pool.add(i.attrs)),
      size,
      area,
      locked: Uint8Array.from(T.inst, (i) => (i.flags & FLAG_LOCKED ? 1 : 0)),
      definitionDescription: definitionNames.map((_, k) => defOfIndex[k]?.description ?? ''),
      definitionGuid: definitionNames.map((_, k) => defOfIndex[k]?.guid ?? ''),
      definitionAttrs: Int32Array.from(definitionNames, (_, k) => pool.add(defOfIndex[k]?.entities.attrs)),
      definitionFaceCamera: Uint8Array.from(definitionNames, (_, k) => (defOfIndex[k]?.behavior?.alwaysFaceCamera ? 1 : 0)),
    };
    if (nodeVolume!.some(Number.isFinite)) info.volume = nodeVolume!;
    parts.treeInfo = info;

    if (!outlineSkipped) {
      const outline: SkpOutlineEntry[] = [];
      const loose = looseEntry();
      if (loose) outline.push(loose);
      for (let i = 0; i < T.rootCount; i++) {
        if (T.hidden[i]) continue;
        const s0 = nodeSlot![i]!;
        const s1 = nodeSlotEnd![i]!;
        if (s0 < 0 || s1 < 0 || (!faces[i] && !edges[i])) continue;
        const inst = T.inst[i]!;
        const def = model.definitions.get(inst.definition)!;
        outline.push({
          name: inst.name || def.name,
          kind: kindOf(inst, def),
          definition: def.name,
          tag: tagOf(inst),
          faces: faces[i]!,
          edges: edges[i]!,
          area: area[i]!,
          ids: rangeIds(s0, s1),
          node: i,
        });
      }
      parts.outline = outline;
    }
  } else if (opts.outline && !outlineSkipped) {
    // 그룹·컴포넌트가 없는 모형: 바로 놓인 형상만
    const loose = looseEntry();
    parts.outline = loose ? [loose] : [];
  }
  if (outlineSkipped) parts.outlineSkipped = outlineSkipped;
  if (pool.list.length) parts.attributes = pool.list;
  if (revealIds.size) parts.revealItems = [...revealIds].map(([node, ids]) => ({ node, ids }));
  return parts;
}
