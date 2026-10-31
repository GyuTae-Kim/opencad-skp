/**
 * 해석 워커(src/worker/parse.worker.ts)와 화면 사이의 메시지 꼴과 직렬화 도움(순수 함수, DOM 없음).
 *
 * 파일은 Blob·File 그대로 화면 → 워커로 넘기고(바이트를 복사하지 않는다 — 워커가 필요한 자리만 읽는다), 결과 장면의 형식 배열·무늬 ImageBitmap은
 * 워커 → 화면으로 이전한다(복사 없이). 한 메시지 안에서 같은 버퍼를 여러 곳이 가리킬 수 있으므로 이전 목록은 버퍼마다 한 번만 넣는다.
 * 워커는 결과를 보낸 뒤 파일 내용 지문(SHA-256 — 측정 안내를 파일별로 기억하는 열쇠)을 덩이씩 읽으며 구해 따로 보낸다
 * (큰 모형은 화면이 해석 워커를 결과 뒤 곧바로 끝내고 지문 워커 worker/print.worker.ts에 따로 묻는다 — 34차, PrintRequest).
 * 큰 모형은 워커가 법선·무늬 좌표를 작은 정수 배열로 줄여 넘긴다(packed — 28차, worker/pack.ts).
 * 큰 모형을 올린 뒤 그래픽 문맥을 되찾으면 화면이 쥐고 있던 색을 바꾼 무늬의 원래 그림 바이트만 작은 손질 워커(worker/recolor.worker.ts)에 넘겨
 * 다시 손질한 그림을 받는다(recolor — 29차, release.ts. 27·28차는 같은 파일을 해석 워커로 다시 풀었다).
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpImages } from '../images';
import type { SkpTextureInfo } from '../index';
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

/**
 * 쥐어 둔 무늬 하나(29차): 해석 워커가 색을 바꾼 무늬의 원래 그림 파일 바이트(Blob — 그림 꼴은 type)와 그 무늬의 손질 정보(meta.textures — 색 바꾸기·알파).
 * 문맥을 되찾으면 처음 열 때와 같은 손질(worker/textures.ts)로 다시 그림을 만든다
 */
export interface HeldTexture {
  id: string;
  blob: Blob;
  info: SkpTextureInfo;
}

/** 쥐어 둔 무늬를 다시 손질해 받기(문맥 복구 — 처음 열 때와 같은 한도로 푼다). Blob은 복사 없이 넘어간다 */
export interface RecolorRequest {
  id: number;
  type: 'recolor';
  textures: HeldTexture[];
  /** 처음 열 때 해석 워커에 준 무늬 한도(ParseRequest.textureLimit) */
  textureLimit?: number;
}

/** 다시 손질한 무늬(손질한 그림과 크기 — 풀지 못한 무늬는 빠진다) */
export interface RecolorResult {
  textures: { id: string; bitmap: ImageBitmap; width: number; height: number }[];
  /** 다시 손질한 시간(ms) */
  ms: number;
}

export type RecolorResponse = { id: number; type: 'recolored'; result: RecolorResult } | { id: number; type: 'error'; message: string };

/**
 * 파일 내용 지문만 구하기(34차 — 지문 워커 worker/print.worker.ts). 큰 모형은 화면이 결과를 받자마자 해석 워커를 끝내고(그 heap과 해석하며 남긴
 * 쓰레기를 한꺼번에 놓으려고) 지문은 이 요청으로 따로 묻는다. 답은 ParseResponse의 print
 */
export interface PrintRequest {
  id: number;
  type: 'print';
  file: Blob;
}

export type ParseResponse =
  | { id: number; type: 'progress'; fraction: number; stage: string }
  /** separatePrint: 이 결과의 지문은 해석 워커가 보내지 않는다(큰 모형 — 화면이 해석 워커를 끝내고 지문 워커에 묻는다, 34차) */
  | { id: number; type: 'done'; result: ParseResult; separatePrint?: boolean }
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
  /** 큰 모형이라 워커가 법선·무늬 좌표를 줄였으면 그 셈(worker/pack.ts — 28차) */
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
