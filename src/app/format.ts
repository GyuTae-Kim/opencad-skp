/**
 * 화면 글 만들기(순수 함수): 크기·시간·숫자·좌표·파일 이름.
 */

/** 열기 상자 accept(대소문자 확장자 모두) */
export const SKP_ACCEPT = '.skp,.SKP';

/** 한 번에 여는 파일 크기 한도(브라우저 메모리 보호) */
export const MAX_FILE_BYTES = 1536 * 1024 * 1024;

/** 바이트 수 → "12.3 KB" */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(digits)).toLocaleString('ko-KR', { maximumFractionDigits: digits })} ${units[i]}`;
}

/** 밀리초 → "45 ms" · "1.2초" · "1분 5초" */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number(s.toFixed(s < 10 ? 2 : 1))}초`;
  const m = Math.floor(s / 60);
  return `${m}분 ${Math.round(s - m * 60)}초`;
}

/** 숫자 → 글(소수 digits 자리까지, 끝 0 없이, 천 단위 쉼표) */
export function fmtNum(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? '0' : r.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

/** 개수 → "1,234" */
export function fmtCount(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}

/** 점 → "x, y, z" */
export function fmtPt(p: readonly number[] | undefined | null, digits = 3): string {
  if (!p) return '—';
  return `${fmtNum(p[0], digits)}, ${fmtNum(p[1], digits)}, ${fmtNum(p[2], digits)}`;
}

/** RGBA(0~1) → CSS rgb() */
export function rgbCss(c: readonly number[]): string {
  const ch = (x: number | undefined): number => Math.round(Math.min(1, Math.max(0, x ?? 0)) * 255);
  return `rgb(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])})`;
}

/** 경로를 뺀 파일 이름 */
export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '');
}

/** 파일 이름의 확장자(소문자, 점 없이). 없으면 '' */
export function fileExtension(name: string): string {
  const m = /\.([^.]+)$/.exec(baseName(name));
  return m ? m[1]!.toLowerCase() : '';
}

/** 확장자를 뺀 이름(그림 저장 이름 등) */
export function stripExtension(name: string): string {
  const b = baseName(name);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(0, i) : b;
}

/** SketchUp 확장자인지 */
export function isSkpName(name: string): boolean {
  return fileExtension(name) === 'skp';
}
