/**
 * 해석 워커(src/worker/parse.worker.ts)와 화면 사이의 메시지 꼴과 직렬화 도움(순수 함수, DOM 없음).
 *
 * 파일 바이트는 화면 → 워커로 이전(transfer)하고, 결과 장면의 형식 배열·무늬 ImageBitmap은 워커 → 화면으로 이전한다(복사 없이).
 * 한 메시지 안에서 같은 버퍼를 여러 곳이 가리킬 수 있으므로 이전 목록은 버퍼마다 한 번만 넣는다.
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { SkpImages } from '../images';

export interface ParseRequest {
  id: number;
  type: 'open';
  /** 파일 이름(장면 이름) */
  name: string;
  /** 파일 바이트(이전된다) */
  bytes: ArrayBuffer;
  /** 워커가 푸는 무늬 그림(색 바꾸기·알파 재기)의 긴 변 한도(화소, 기본 코어 TEXTURE_LIMIT) — 뷰어의 textureLimit과 같게 */
  textureLimit?: number;
}

export type ParseResponse =
  | { id: number; type: 'progress'; fraction: number; stage: string }
  | { id: number; type: 'done'; result: ParseResult }
  | { id: number; type: 'error'; message: string };

export interface ParseResult {
  scene: Scene3d;
  /** 해석 시간(ms) */
  ms: number;
  /** 꾸러미 안 그림(워커가 꺼낸 바이트 — 화면이 Blob 주소로 바꾼다) */
  images?: SkpImages;
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
