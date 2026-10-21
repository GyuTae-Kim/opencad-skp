/**
 * 최근 문서: 고른 파일(또는 끌어다 놓은 파일)을 연 뒤 이 브라우저의 IndexedDB에만 저장한다(서버로 보내지 않는다).
 * 휴대폰 브라우저는 뒤로 보낸 탭(특히 WebGL 페이지)을 버렸다가 돌아오면 다시 읽어, 열어 둔 파일을 다시 골라야 한다 —
 * 시작 화면의 최근 문서에서 바로 다시 연다.
 *
 * - 새것부터 8개까지, 60 MB보다 큰 파일은 저장하지 않는다(예제 모형도 저장하지 않는다).
 * - 같은 이름·같은 크기는 한 항목(다시 열면 시간만 새로).
 * - 목록은 이름·크기·시간만 읽는다(파일 바이트는 따로 두어, 목록을 그릴 때 수백 MB를 읽지 않게).
 * - IndexedDB를 쓸 수 없으면(비공개 창 등) 조용히 빈 목록.
 * 순서·개수·크기 규칙은 저장소 바탕(RecentBackend)을 바꿔 끼워 시험한다.
 */

export interface RecentEntry {
  /** `${이름}:${크기}` */
  id: string;
  name: string;
  /** 바이트 */
  size: number;
  /** 마지막으로 연 시각(ms) */
  time: number;
}

/** 저장소 바탕: 이름·크기·시간(목록)과 파일 바이트를 따로 둔다 */
export interface RecentBackend {
  entries(): Promise<RecentEntry[]>;
  /** 항목과 바이트를 함께 저장(같은 id는 바꾼다) */
  put(entry: RecentEntry, data: ArrayBuffer): Promise<void>;
  /** 항목만 바꾼다(시간 새로) */
  touch(entry: RecentEntry): Promise<void>;
  data(id: string): Promise<ArrayBuffer | null>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

export const RECENT_MAX = 8;
export const RECENT_MAX_BYTES = 60 * 1024 * 1024;
export const RECENT_DB = 'opencad-skp';
export const RECENT_STORE = 'recent';
/** 파일 바이트(목록과 따로) */
export const RECENT_DATA_STORE = 'recent-data';

export const recentId = (name: string, size: number): string => `${name}:${size}`;

/** 저장할 수 있는 크기인지(빈 파일·60 MB 초과는 아님) */
export const canKeepRecent = (size: number): boolean => Number.isFinite(size) && size > 0 && size <= RECENT_MAX_BYTES;

/** 새것부터(같은 시각이면 이름 차례), 모양이 이상한 항목은 뺀다 */
export function sortRecent(list: readonly RecentEntry[]): RecentEntry[] {
  return list
    .filter((e) => e && typeof e.id === 'string' && typeof e.name === 'string' && Number.isFinite(e.size) && Number.isFinite(e.time))
    .map(({ id, name, size, time }) => ({ id, name, size, time }))
    .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name));
}

/** 개수 한도를 넘어 지울 항목 id(오래된 것부터) */
export function overflowIds(list: readonly RecentEntry[], max = RECENT_MAX): string[] {
  return sortRecent(list)
    .slice(Math.max(0, max))
    .map((e) => e.id);
}

/** 최근 문서 시각 글: 방금 · n분 전 · n시간 전 · 날짜(YYYY-MM-DD, 그 시각 지역 날짜) */
export function recentTimeText(time: number, now: number): string {
  const dt = now - time;
  if (!Number.isFinite(dt)) return '';
  if (dt < 60_000) return '방금';
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}분 전`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}시간 전`;
  const d = new Date(time);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class RecentStore {
  constructor(private readonly backend: RecentBackend | null = idbBackend()) {}

  /** 새것부터 최대 8개(못 읽으면 빈 목록) */
  async list(): Promise<RecentEntry[]> {
    if (!this.backend) return [];
    try {
      return sortRecent(await this.backend.entries()).slice(0, RECENT_MAX);
    } catch {
      return [];
    }
  }

  /** 연 파일 저장(크기 한도 밖이면 저장하지 않음). 저장했으면 true */
  async add(name: string, data: ArrayBuffer, now = Date.now()): Promise<boolean> {
    if (!this.backend || !canKeepRecent(data.byteLength)) return false;
    try {
      const entry: RecentEntry = { id: recentId(name, data.byteLength), name, size: data.byteLength, time: now };
      await this.backend.put(entry, data);
      const extra = overflowIds(await this.backend.entries());
      if (extra.length) await this.backend.remove(extra);
      return true;
    } catch {
      /* 저장 공간을 쓸 수 없는 환경(비공개 창·저장 공간 부족 등) */
      return false;
    }
  }

  /** 저장한 파일 바이트(다시 열기 — 시간을 새로 한다). 없으면 null */
  async open(id: string, now = Date.now()): Promise<{ entry: RecentEntry; data: ArrayBuffer } | null> {
    if (!this.backend) return null;
    try {
      const entry = (await this.backend.entries()).find((e) => e.id === id);
      const data = entry ? await this.backend.data(id) : null;
      if (!entry || !data) return null;
      const fresh = { ...entry, time: now };
      await this.backend.touch(fresh).catch(() => undefined);
      return { entry: fresh, data };
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.backend?.remove([id]);
    } catch {
      /* 못 지우면 그대로 */
    }
  }

  async clear(): Promise<void> {
    try {
      await this.backend?.clear();
    } catch {
      /* 못 지우면 그대로 */
    }
  }
}

// ───────────────────────── IndexedDB ─────────────────────────

const done = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const finished = (t: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('IndexedDB 기록이 취소되었습니다'));
  });

/** IndexedDB 바탕(없거나 못 열면 각 호출이 실패 → RecentStore가 조용히 넘긴다) */
export function idbBackend(given?: IDBFactory): RecentBackend | null {
  let factory = given;
  try {
    factory ??= globalThis.indexedDB;
  } catch {
    /* 막힌 환경(샌드박스 틀 등)은 읽기만 해도 오류 */
  }
  if (!factory) return null;
  const idb = factory;
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = idb.open(RECENT_DB, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(RECENT_STORE)) d.createObjectStore(RECENT_STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(RECENT_DATA_STORE)) d.createObjectStore(RECENT_DATA_STORE);
      };
      req.onsuccess = () => {
        const d = req.result;
        // 다른 탭이 판을 올리려 하면 닫아 막지 않는다(다음 호출이 다시 연다)
        d.onversionchange = () => {
          d.close();
          db = null;
        };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB가 다른 탭에 막혔습니다'));
    }).catch((e: unknown) => {
      db = null;
      throw e;
    });
    return db;
  };
  const both = [RECENT_STORE, RECENT_DATA_STORE];
  return {
    async entries() {
      const t = (await open()).transaction(RECENT_STORE, 'readonly');
      return (await done(t.objectStore(RECENT_STORE).getAll())) as RecentEntry[];
    },
    async put(entry, data) {
      const t = (await open()).transaction(both, 'readwrite');
      t.objectStore(RECENT_STORE).put(entry);
      t.objectStore(RECENT_DATA_STORE).put(data, entry.id);
      await finished(t);
    },
    async touch(entry) {
      const t = (await open()).transaction(RECENT_STORE, 'readwrite');
      t.objectStore(RECENT_STORE).put(entry);
      await finished(t);
    },
    async data(id) {
      const t = (await open()).transaction(RECENT_DATA_STORE, 'readonly');
      const v = await done(t.objectStore(RECENT_DATA_STORE).get(id));
      return v instanceof ArrayBuffer ? v : null;
    },
    async remove(ids) {
      const t = (await open()).transaction(both, 'readwrite');
      for (const id of ids) {
        t.objectStore(RECENT_STORE).delete(id);
        t.objectStore(RECENT_DATA_STORE).delete(id);
      }
      await finished(t);
    },
    async clear() {
      const t = (await open()).transaction(both, 'readwrite');
      t.objectStore(RECENT_STORE).clear();
      t.objectStore(RECENT_DATA_STORE).clear();
      await finished(t);
    },
  };
}
