/**
 * 파일별 안내 기억: 줄자·각도기로 둔 안내점·안내선을 파일 내용 지문(SHA-256, 16진 64글자)을 열쇠로 이 브라우저 localStorage의 한 열쇠에 둔다.
 * 같은 파일을 다시 열면(새로 고침, 다른 파일을 열었다 돌아오기, 최근 문서) measure.ts가 되살린다. 파일 이름·경로는 두지 않는다(지문만).
 *
 * - 파일 GUIDE_FILES_MAX개까지 두고, 넘거나 저장 글이 GUIDE_STORE_MAX_CHARS를 넘으면 오래 쓰지 않은(안내를 바꾸거나 되살린 때가 먼) 파일부터 버린다.
 *   한 파일은 안내점·안내선 각 50개(measure.ts 한도)라 많아야 10 KB쯤이다.
 * - 안내를 모두 지우면 그 파일 항목을 뺀다(항목이 하나도 없으면 열쇠도 지운다).
 * - 숨긴 안내(25차 Edit › Hide)는 그 번호를 함께 두어 숨긴 채 되살린다(숨긴 것이 없으면 꼴이 예전과 같고, 예전 항목은 모두 보이는 것으로 읽는다).
 * - 저장이 막히면(사생활 보호 창·저장 공간 가득) 오래된 파일 절반을 버리고 한 번 더 해 보고, 그래도 안 되면 그만둔다 — 앱은 그대로 돌고 이번 세션만 기억한다.
 * - 읽은 값은 모양을 확인한다(열쇠 꼴, 수가 아닌 좌표, 길이 0 방향은 버린다). 좌표는 자르지 않고 그대로 둔다(되살린 안내에 그대로 붙게).
 *
 * 이 모듈은 측정 도구 조각(measure.ts)에서만 가져온다 — 첫 화면 JS 밖.
 */
import type { V3 } from 'opencad-viewer3d/math';
import type { GuideLine } from './snap';

/** 저장 열쇠(안내 보이기 설정 'opencad-skp.guides'와 다르다) */
export const GUIDE_STORE_KEY = 'opencad-skp.guides-by-file';
/** 기억하는 파일 수 */
export const GUIDE_FILES_MAX = 40;
/** 저장 글 길이 한도(localStorage는 보통 5백만 글자 — 다른 설정과 나눠 쓴다) */
export const GUIDE_STORE_MAX_CHARS = 400_000;

/** 기억한 안내 */
export interface SavedGuides {
  pts: V3[];
  lns: GuideLine[];
  /** 숨긴 안내(25차 Edit › Hide — pts·lns에 든 객체 그대로, 없으면 빈 목록) */
  hid: (V3 | GuideLine)[];
}

/**
 * 저장 꼴: 파일 지문 → { t: 마지막으로 쓴 시각(ms), p: 안내점 [x, y, z], l: 안내선 [점 x, y, z, 방향 x, y, z],
 * hp·hl: 숨긴 안내점·안내선의 p·l 번호(25차 — 숨긴 것이 있을 때만. 앞 판은 이 칸을 모르고 모두 보인다) }
 */
interface Entry {
  t: number;
  p: number[][];
  l: number[][];
  hp?: number[];
  hl?: number[];
}

/** 숨긴 번호 칸(0 이상 정수 목록 — 아니면 없는 것으로) */
const indexList = (a: unknown): number[] | undefined => (Array.isArray(a) && a.every((i) => Number.isInteger(i) && i >= 0) ? a : undefined);

type Files = Record<string, Entry>;

/** 이 모듈이 쓰는 저장소 기능(removeItem이 없으면 빈 꼴을 쓴다) */
export type GuideStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

/** 파일 지문 열쇠 꼴(SHA-256 16진) */
export const isGuideKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

/** SHA-256 바이트 → 16진 열쇠 */
export function digestHex(b: ArrayBuffer | ArrayBufferView): string {
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  let s = '';
  for (const x of u) s += x.toString(16).padStart(2, '0');
  return s;
}

const finite = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every((v) => typeof v === 'number' && Number.isFinite(v));

/** 저장된 파일 목록(못 읽거나 모양이 다르면 빈 목록 — 모양이 다른 항목만 뺀다) */
export function readGuideFiles(storage: GuideStorage | null): Files {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(GUIDE_STORE_KEY) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  const files = (data as { v?: unknown; files?: unknown } | null)?.files;
  if ((data as { v?: unknown })?.v !== 1 || !files || typeof files !== 'object') return {};
  const out: Files = {};
  for (const [k, e] of Object.entries(files as Record<string, unknown>)) {
    const x = e as Partial<Entry> | null;
    if (!isGuideKey(k) || !x || typeof x.t !== 'number' || !Number.isFinite(x.t) || !Array.isArray(x.p) || !Array.isArray(x.l)) continue;
    const entry: Entry = { t: x.t, p: x.p, l: x.l };
    const hp = indexList(x.hp), hl = indexList(x.hl);
    if (hp?.length) entry.hp = hp;
    if (hl?.length) entry.hl = hl;
    out[k] = entry;
  }
  return out;
}

/** 기억한 그 파일의 안내(없거나 비었으면 null). 점·선은 maxPoints·maxLines개까지(새것 쪽), 모양이 다른 것은 뺀다. 숨긴 안내는 숨긴 채(hid) */
export function loadGuides(storage: GuideStorage | null, key: string, maxPoints = 50, maxLines = 50): SavedGuides | null {
  const e = readGuideFiles(storage)[key];
  if (!e) return null;
  const hp = new Set(e.hp ?? []), hl = new Set(e.hl ?? []);
  const hidden = new Set<V3 | GuideLine>();
  let pts: V3[] = [];
  e.p.forEach((p, i) => {
    if (!finite(p, 3)) return;
    const v: V3 = [p[0]!, p[1]!, p[2]!];
    pts.push(v);
    if (hp.has(i)) hidden.add(v);
  });
  pts = pts.slice(-maxPoints);
  let lns: GuideLine[] = [];
  e.l.forEach((l, i) => {
    if (!finite(l, 6)) return;
    const d = Math.hypot(l[3]!, l[4]!, l[5]!);
    if (!(d > 0)) return;
    const g: GuideLine = { point: [l[0]!, l[1]!, l[2]!], dir: [l[3]! / d, l[4]! / d, l[5]! / d] };
    lns.push(g);
    if (hl.has(i)) hidden.add(g);
  });
  lns = lns.slice(-maxLines);
  const hid = [...pts, ...lns].filter((g) => hidden.has(g));
  return pts.length || lns.length ? { pts, lns, hid } : null;
}

/** 오래 쓰지 않은 것부터 차례(새것이 앞) */
const byAge = (files: Files): string[] => Object.keys(files).sort((a, b) => files[b]!.t - files[a]!.t || (a < b ? -1 : 1));

/** 저장 글(파일이 없으면 null) */
function serialize(files: Files): string | null {
  return Object.keys(files).length ? JSON.stringify({ v: 1, files }) : null;
}

/** 글을 저장(null이면 열쇠를 지운다). 됐으면 true */
function write(storage: GuideStorage, text: string | null): boolean {
  try {
    if (text !== null) storage.setItem(GUIDE_STORE_KEY, text);
    else if (storage.removeItem) storage.removeItem(GUIDE_STORE_KEY);
    else storage.setItem(GUIDE_STORE_KEY, '');
    return true;
  } catch {
    return false;
  }
}

/**
 * 그 파일의 안내 기억하기(now = 지금 시각 ms — 오래된 것 버리기에 쓴다). 안내가 없으면 그 항목을 뺀다. hidden에 든 안내(pts·lns의 객체)는 숨긴 것으로 둔다.
 * 파일 수·글 길이 한도를 넘으면 오래된 파일부터 버리고, 저장이 막히면 오래된 절반을 버려 한 번 더 해 본다. 저장했으면 true
 */
export function saveGuides(
  storage: GuideStorage | null,
  key: string,
  pts: readonly (readonly number[])[],
  lns: readonly GuideLine[],
  now: number,
  hidden?: ReadonlySet<unknown> | null,
): boolean {
  if (!storage || !isGuideKey(key)) return false;
  const files = readGuideFiles(storage);
  if (pts.length || lns.length) {
    const e: Entry = { t: now, p: pts.map((p) => [p[0]!, p[1]!, p[2]!]), l: lns.map((l) => [l.point[0], l.point[1], l.point[2], l.dir[0], l.dir[1], l.dir[2]]) };
    if (hidden?.size) {
      const hp = pts.flatMap((p, i) => (hidden.has(p) ? [i] : []));
      const hl = lns.flatMap((l, i) => (hidden.has(l) ? [i] : []));
      if (hp.length) e.hp = hp;
      if (hl.length) e.hl = hl;
    }
    files[key] = e;
  } else if (files[key]) delete files[key];
  else return true;
  const order = byAge(files);
  for (const k of order.slice(GUIDE_FILES_MAX)) if (k !== key) delete files[k];
  let text = serialize(files);
  // 글이 길면 오래된 것부터(지금 파일은 남긴다)
  for (let i = order.length - 1; text !== null && text.length > GUIDE_STORE_MAX_CHARS && i >= 0; i--) {
    const k = order[i]!;
    if (k === key || !files[k]) continue;
    delete files[k];
    text = serialize(files);
  }
  if (write(storage, text)) return true;
  // 저장 공간이 모자라면 오래된 절반을 버리고 한 번 더
  const rest = byAge(files).filter((k) => k !== key);
  for (const k of rest.slice(Math.floor(rest.length / 2))) delete files[k];
  return write(storage, serialize(files));
}
