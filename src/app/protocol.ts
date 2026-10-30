/**
 * 해석 워커(src/worker/parse.worker.ts)와 화면 사이의 메시지 꼴과 직렬화 도움(순수 함수, DOM 없음).
 *
 * 파일은 Blob·File 그대로 화면 → 워커로 넘기고(바이트를 복사하지 않는다 — 워커가 필요한 자리만 읽는다), 결과 장면의 형식 배열·무늬 ImageBitmap은
 * 워커 → 화면으로 이전한다(복사 없이). 한 메시지 안에서 같은 버퍼를 여러 곳이 가리킬 수 있으므로 이전 목록은 버퍼마다 한 번만 넣는다.
 * 워커는 결과를 보낸 뒤 파일 내용 지문(SHA-256 — 측정 안내를 파일별로 기억하는 열쇠)을 덩이씩 읽으며 구해 따로 보낸다.
 * 큰 모형을 놓아 올린 뒤 그래픽 문맥을 되찾으면 화면이 같은 파일을 다시 넘겨 놓은 법선·무늬 좌표와 색을 바꾼 무늬만 받는다(arrays — 27차, release.ts).
 * 큰 모형은 워커가 법선·무늬 좌표를 작은 정수 배열로 줄여 넘기고(packed — 28차, worker/pack.ts), 문맥 복구 때도 같은 꼴로 받는다.
 */
import type { NormalArray, Scene3d, UvArray, UvTransform } from 'opencad-viewer3d/types';
import type { SkpImages } from '../images';
import type { PackStats } from '../worker/pack';

export interface ParseRequest {
  id: number;
  type: 'open';
  /** 파일 이름(장면 이름) */
  name: string;
  /** 파일(Blob·File — 복사 없이 넘어가고 워커가 필요한 자리만 읽는다) */
  file: Blob;
  /** 워커가 푸는 무늬 그림(색 바꾸기·알파 재기)의 긴 변 한도(화소, 기본 코어 TEXTURE_LIMIT) — 뷰어의 textureLimit과 같게 */
  textureLimit?: number;
}

/** 다시 받을 그물 하나: id, 정점 수(위치 값 수 / 3 — 다시 푼 그물과 다르면 파일이 바뀐 것이라 주지 않는다), 다시 받을 배열 */
export interface ArraysWant {
  id: string;
  nv: number;
  normals: boolean;
  uvs: boolean;
  backUvs: boolean;
  /**
   * 처음 열 때 워커가 줄인 앞·뒷면 무늬 좌표의 변환(장면 그물의 uvTransform·backUvTransform — 코어 놓기는 지우지 않는다, 28차).
   * 있으면 워커가 다시 줄여 변환이 같을 때만 주고, 없으면(Float32로 두었던 그물) Float32로 준다
   */
  uvT?: UvTransform | null;
  backUvT?: UvTransform | null;
}

/** 같은 파일을 다시 풀어 놓은 배열·무늬만 받기(문맥 복구 — 처음 열 때와 같은 선택으로 푼다) */
export interface ArraysRequest {
  id: number;
  type: 'arrays';
  name: string;
  file: Blob;
  meshes: ArraysWant[];
  /** 다시 풀어 색을 바꿀 무늬 id(처음 열 때 워커가 손질한 그림) */
  textures: string[];
  textureLimit?: number;
  /** 처음 열 때 워커가 법선을 줄였다(ParseResult.packed — 28차). 다시 준 법선도 같은 꼴(Int8 정점 4값)로 */
  pack?: boolean;
}

/** 다시 받은 그물 배열(그물 객체 꼴의 이름 — 코어 0.26.0부터 작은 정수 배열도 받는다)과 무늬(손질한 그림, 손질하지 않은 무늬는 그림 바이트) */
export interface ArraysResult {
  meshes: { id: string; normals?: NormalArray; uvs?: UvArray; backUvs?: UvArray }[];
  textures: { id: string; bitmap?: ImageBitmap; data?: Uint8Array; mime?: string; width?: number; height?: number }[];
  /** 다시 푼 시간(ms) */
  ms: number;
}

export type ParseResponse =
  | { id: number; type: 'progress'; fraction: number; stage: string }
  | { id: number; type: 'done'; result: ParseResult }
  | { id: number; type: 'arrays'; result: ArraysResult }
  | { id: number; type: 'error'; message: string }
  /** 결과(done) 뒤: 파일 내용 SHA-256 32바이트(못 구하면 null) */
  | { id: number; type: 'print'; digest: ArrayBuffer | null };

export interface ParseResult {
  scene: Scene3d;
  /** 해석 시간(ms) */
  ms: number;
  /** 꾸러미 안 그림(워커가 꺼낸 바이트 — 화면이 Blob 주소로 바꾼다) */
  images?: SkpImages;
  /** 파일 내용 SHA-256 32바이트(손님이 붙인다 — 워커가 결과 뒤에 보낸다, 못 구하면 null) */
  print?: Promise<ArrayBuffer | null>;
  /** 큰 모형이라 워커가 법선·무늬 좌표를 줄였으면 그 셈(worker/pack.ts — 28차). 화면은 문맥 복구 때 같은 꼴로 다시 받는다 */
  packed?: PackStats;
}

/**
 * 값 안의 모든 ArrayBuffer(형식 배열의 버퍼 포함)와 ImageBitmap을 한 번씩 모은다 — postMessage 이전 목록.
 * 일반 객체·배열·Map·Set을 따라 들어가고, 같은 객체는 한 번만 본다. SharedArrayBuffer는 넣지 않는다.
 */
export function collectTransfers(value: unknown): (ArrayBuffer | ImageBitmap)[] {
  const out = new Set<ArrayBuffer | ImageBitmap>();
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (v instanceof ArrayBuffer) {
      if (v.byteLength > 0) out.add(v);
      continue;
    }
    if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) {
      out.add(v);
      continue;
    }
    if (ArrayBuffer.isView(v)) {
      const b = v.buffer;
      if (b instanceof ArrayBuffer && b.byteLength > 0) out.add(b);
      continue;
    }
    if (Array.isArray(v)) {
      for (const x of v) if (x !== null && typeof x === 'object') stack.push(x);
      continue;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        stack.push(k);
        stack.push(x);
      }
      continue;
    }
    if (v instanceof Set) {
      for (const x of v) stack.push(x);
      continue;
    }
    for (const x of Object.values(v)) if (x !== null && typeof x === 'object') stack.push(x);
  }
  return [...out];
}

/** 나눠 올리기 기준: 삼각형+선분 수 */
export const INCREMENTAL_PRIMS = 1_000_000;
/** 나눠 올리기 기준: 그물·선 묶음 수 */
export const INCREMENTAL_ITEMS = 1500;

/**
 * GPU에 나눠 올릴 만큼 큰 장면인지(작은 모형은 지금처럼 한 번에). 화면은 이 기준으로 나눠 올리고 놓으며(app.ts setDoc — 27차),
 * 해석 워커는 같은 기준으로 법선·무늬 좌표를 줄여 넘긴다(worker/pack.ts — 28차)
 */
export function isBigScene(d: { scene: Pick<Scene3d, 'meshes' | 'lines'> }): boolean {
  const s = d.scene;
  if (s.meshes.length + s.lines.length >= INCREMENTAL_ITEMS) return true;
  let prims = 0;
  for (const m of s.meshes) prims += (m.indices ? m.indices.length : m.positions.length / 3) / 3;
  for (const l of s.lines) prims += l.positions.length / 6;
  return prims >= INCREMENTAL_PRIMS;
}

/** 장면에 그릴 것이 있는지(그물·선분·점) */
export function sceneHasGeometry(s: Scene3d): boolean {
  return (
    s.meshes.some((m) => m.positions.length >= 9) ||
    s.lines.some((l) => l.positions.length >= 6) ||
    (s.points ?? []).some((p) => p.positions.length >= 3)
  );
}

/**
 * 그릴 것이 없는 장면의 알림. 해석기가 까닭(경고)을 남겼거나 깨진 파일이면 "열지 못했습니다"와 첫 경고,
 * 깨지지 않은 SketchUp 파일인데 형상이 없으면 빈 모형이라고 알린다(SketchUp도 빈 화면으로 연다 —
 * 정의만 있고 놓인 것이 없으면 그 수를 함께)
 */
export function emptySceneNotice(s: Scene3d, name: string): { kind: 'error' | 'info'; title: string; text: string } {
  const meta = (s.meta ?? {}) as { damaged?: boolean; version?: string; definitions?: number };
  const why = s.warnings?.[0];
  if (why || meta.damaged || !meta.version) return { kind: 'error', title: `"${name}" 파일을 열지 못했습니다`, text: why ?? '그릴 면이나 모서리를 찾지 못했습니다.' };
  const defs = meta.definitions ?? 0;
  return {
    kind: 'info',
    title: `"${name}" 모형이 비어 있습니다`,
    text: defs
      ? `SketchUp 파일은 맞지만 모형에 놓인 형상이 없습니다(컴포넌트 정의 ${defs.toLocaleString('en-US')}개는 있지만 하나도 놓이지 않았습니다).`
      : 'SketchUp 파일은 맞지만 그릴 면·모서리가 없습니다. SketchUp에서 형상을 넣고 저장했는지 확인해 주세요.',
  };
}

/** 오류 값 → 사람이 읽는 글 */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}
